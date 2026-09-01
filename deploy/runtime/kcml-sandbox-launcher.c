#define _GNU_SOURCE

/*
 * KCML generated-handler launcher.
 *
 * This is deliberately a small, fail-closed supervisor. It is not a
 * general-purpose container runtime: the only executable accepted is an
 * already digested file below the release directory and the only channel
 * handed to the child is one end of an anonymous SOCK_STREAM at fd 3.
 *
 * The launcher needs CAP_SYS_ADMIN/CAP_SETUID/CAP_SETGID in the trusted
 * runtime-host service. A host without those capabilities is an environmental
 * failure, never a degraded unsandboxed launch.
 */

#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/limits.h>
#include <linux/openat2.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <linux/securebits.h>
#include <openssl/evp.h>
#include <limits.h>
#include <signal.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/mount.h>
#include <sys/poll.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

static void fail(const char *message) {
  fprintf(stderr, "kcml-sandbox-launcher: %s: %s\n", message, strerror(errno));
  _exit(70);
}

static void fail_code(const char *message, int code) {
  fprintf(stderr, "kcml-sandbox-launcher: %s\n", message);
  _exit(code);
}

static const char *argument(int argc, char **argv, const char *name) {
  for (int i = 1; i + 1 < argc; i++) if (strcmp(argv[i], name) == 0) return argv[i + 1];
  return NULL;
}

static int separator(int argc, char **argv) {
  for (int i = 1; i < argc; i++) if (strcmp(argv[i], "--") == 0) return i;
  return -1;
}

static bool decimal_id(const char *value) {
  if (!value || *value == '\0') return false;
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) {
    if (*cursor < '0' || *cursor > '9') return false;
  }
  return true;
}

static bool contained(const char *root, const char *path) {
  const size_t length = strlen(root);
  return strncmp(root, path, length) == 0 && (path[length] == '/' || path[length] == '\0');
}

static const char *release_relative(const char *root, const char *path) {
  if (!contained(root, path)) return NULL;
  const char *relative = path + strlen(root);
  while (*relative == '/') relative++;
  if (*relative == '\0' || strstr(relative, "../") != NULL || strcmp(relative, "..") == 0) return NULL;
  return relative;
}

static int open_release_file(int release_fd, const char *relative, int flags) {
  struct open_how how;
  memset(&how, 0, sizeof(how));
  how.flags = (uint64_t)flags;
  how.resolve = RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV;
  return (int)syscall(SYS_openat2, release_fd, relative, &how, sizeof(how));
}

static void verify_regular_release_file(int release_fd, const char *relative, const char *label) {
  int fd = open_release_file(release_fd, relative, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) fail(label);
  struct stat status;
  if (fstat(fd, &status) != 0) fail(label);
  if (!S_ISREG(status.st_mode) || (status.st_mode & (S_ISUID | S_ISGID)) != 0 || status.st_nlink != 1) {
    close(fd);
    fail_code("release file type/mode/link contract failed", 66);
  }
  close(fd);
}

static void file_sha256(int fd, char output[65]) {
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (!context) fail("EVP_MD_CTX_new");
  if (EVP_DigestInit_ex(context, EVP_sha256(), NULL) != 1) fail("EVP_DigestInit");
  unsigned char buffer[65536];
  ssize_t size;
  if (lseek(fd, 0, SEEK_SET) < 0) fail("lseek executable");
  while ((size = read(fd, buffer, sizeof(buffer))) > 0) {
    if (EVP_DigestUpdate(context, buffer, (size_t)size) != 1) fail("EVP_DigestUpdate");
  }
  if (size < 0) fail("read executable");
  unsigned char digest[EVP_MAX_MD_SIZE];
  unsigned int length = 0;
  if (EVP_DigestFinal_ex(context, digest, &length) != 1 || length != 32) fail("EVP_DigestFinal");
  EVP_MD_CTX_free(context);
  for (unsigned int i = 0; i < length; i++) (void)snprintf(output + i * 2, 3, "%02x", digest[i]);
  output[64] = '\0';
}

static void write_proc_file(pid_t child, const char *name, const char *value) {
  char path[64];
  if (snprintf(path, sizeof(path), "/proc/%ld/%s", (long)child, name) >= (int)sizeof(path)) fail_code("proc mapping path too long", 65);
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) fail("open namespace mapping");
  const size_t length = strlen(value);
  if (write(fd, value, length) != (ssize_t)length) fail("write namespace mapping");
  if (close(fd) != 0) fail("close namespace mapping");
}

static void configure_user_mapping(pid_t child, uid_t uid, gid_t gid) {
  char map[128];
  if (snprintf(map, sizeof(map), "0 %lu 1\n", (unsigned long)uid) >= (int)sizeof(map)) fail_code("uid map too long", 65);
  write_proc_file(child, "uid_map", map);
  write_proc_file(child, "setgroups", "deny\n");
  if (snprintf(map, sizeof(map), "0 %lu 1\n", (unsigned long)gid) >= (int)sizeof(map)) fail_code("gid map too long", 65);
  write_proc_file(child, "gid_map", map);
}

static void mount_tmpfs(const char *path, const char *size) {
  char options[64];
  if (snprintf(options, sizeof(options), "size=%s", size) >= (int)sizeof(options)) fail_code("tmpfs option too long", 65);
  if (mount("tmpfs", path, "tmpfs", MS_NODEV | MS_NOSUID | MS_NOEXEC, options) != 0) fail("mount private tmpfs");
}

static void mkdir_required(const char *path) {
  if (mkdir(path, 0755) != 0 && errno != EEXIST) fail("mkdir sandbox path");
}

static void bind_readonly(const char *source, const char *target) {
  if (mount(source, target, NULL, MS_BIND | MS_REC, NULL) != 0) fail("bind immutable release");
  if (mount(NULL, target, NULL, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID, NULL) != 0) fail("remount immutable release");
}

static void bind_device(const char *source, const char *target) {
  int fd = open(target, O_CREAT | O_RDONLY | O_CLOEXEC, 0600);
  if (fd < 0) fail("create private device placeholder");
  close(fd);
  if (mount(source, target, NULL, MS_BIND, NULL) != 0) fail("bind minimal device");
}

static void setup_mount_namespace(int release_fd) {
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) fail("make mounts private");
  mkdir_required("/newroot");
  mount_tmpfs("/newroot", "1G");
  mkdir_required("/newroot/runtime");
  mkdir_required("/newroot/tmp");
  mkdir_required("/newroot/run");
  mkdir_required("/newroot/work");
  mkdir_required("/newroot/proc");
  mkdir_required("/newroot/dev");
  mkdir_required("/newroot/home");
  mkdir_required("/newroot/work/home");
  mkdir_required("/newroot/.oldroot");

  char release_source[64];
  if (snprintf(release_source, sizeof(release_source), "/proc/self/fd/%d", release_fd) >= (int)sizeof(release_source)) fail_code("release fd path too long", 65);
  bind_readonly(release_source, "/newroot/runtime");
  if (mount("proc", "/newroot/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) != 0) fail("mount private proc");
  mount_tmpfs("/newroot/tmp", "64M");
  mount_tmpfs("/newroot/run", "16M");
  mount_tmpfs("/newroot/work", "256M");
  mount_tmpfs("/newroot/dev", "16M");
  bind_device("/dev/null", "/newroot/dev/null");
  bind_device("/dev/zero", "/newroot/dev/zero");
  bind_device("/dev/random", "/newroot/dev/random");
  bind_device("/dev/urandom", "/newroot/dev/urandom");

  if (syscall(SYS_pivot_root, "/newroot", "/newroot/.oldroot") != 0) fail("pivot private root");
  if (umount2("/.oldroot", MNT_DETACH) != 0) fail("detach host root");
  if (rmdir("/.oldroot") != 0) fail("remove old root");
  if (mount(NULL, "/", NULL, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID, NULL) != 0) fail("make sandbox root readonly");
  if (chdir("/work") != 0) fail("chdir workspace");
  if (sethostname("kcml-sandbox", sizeof("kcml-sandbox") - 1) != 0) fail("set fixed UTS name");
}

static void drop_capabilities(void) {
  struct __user_cap_header_struct header;
  struct __user_cap_data_struct data[2];
  memset(&header, 0, sizeof(header));
  memset(data, 0, sizeof(data));
  header.version = _LINUX_CAPABILITY_VERSION_3;
  if (capset(&header, data) != 0) fail("drop capability sets");
  (void)prctl(PR_SET_SECUREBITS, SECBIT_NOROOT | SECBIT_NO_SETUID_FIXUP | SECBIT_NO_CAP_AMBIENT_RAISE, 0, 0, 0);
  (void)prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0);
  for (unsigned int capability = 0; capability < 64; capability++) {
    if (prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) != 0 && errno != EINVAL && errno != EPERM) fail("drop capability bounding set");
  }
}

/*
 * The generated Node.js profile is an allowlist. clone is admitted only
 * when all flags describe a pthread-style thread and CLONE_THREAD/CLONE_VM
 * are present. clone3 is intentionally absent: its pointer argument cannot
 * be safely inspected by classic BPF; runtime child processes use the
 * trusted context.runtime broker instead.
 */
static void install_seccomp_allowlist(void) {
  static const int allowed[] = {
    SYS_read, SYS_write, SYS_close, SYS_fstat, SYS_newfstatat, SYS_lseek,
    SYS_mmap, SYS_mprotect, SYS_munmap, SYS_brk, SYS_rt_sigaction, SYS_rt_sigprocmask,
    SYS_rt_sigreturn, SYS_sigaltstack, SYS_ioctl, SYS_pread64, SYS_pwrite64,
    SYS_readv, SYS_writev, SYS_access, SYS_pipe, SYS_pipe2, SYS_poll, SYS_ppoll,
    SYS_pselect6, SYS_sched_yield, SYS_mremap, SYS_mincore, SYS_madvise, SYS_dup,
    SYS_dup2, SYS_dup3, SYS_nanosleep, SYS_getpid, SYS_getppid, SYS_getuid, SYS_geteuid,
    SYS_getgid, SYS_getegid, SYS_gettid, SYS_futex, SYS_set_robust_list, SYS_set_tid_address,
    SYS_rseq, SYS_arch_prctl, SYS_clock_gettime, SYS_clock_getres, SYS_clock_nanosleep,
    SYS_exit, SYS_exit_group, SYS_openat, SYS_unlinkat, SYS_renameat, SYS_mkdirat,
    SYS_statx, SYS_faccessat2, SYS_getrandom, SYS_prctl, SYS_fcntl, SYS_getcwd,
    SYS_chdir, SYS_fchdir, SYS_readlink, SYS_readlinkat, SYS_getdents64, SYS_fsync,
    SYS_fdatasync, SYS_ftruncate, SYS_getrlimit, SYS_prlimit64, SYS_uname, SYS_times,
    SYS_sched_getaffinity, SYS_getcpu, SYS_epoll_create1, SYS_epoll_ctl, SYS_epoll_wait,
    SYS_epoll_pwait, SYS_eventfd2, SYS_timerfd_create, SYS_timerfd_settime, SYS_signalfd4,
    SYS_recvfrom, SYS_sendto, SYS_recvmsg, SYS_sendmsg, SYS_getsockname, SYS_getpeername,
    SYS_getsockopt, SYS_setsockopt, SYS_shutdown, SYS_restart_syscall, SYS_membarrier,
    SYS_setrlimit
  };
  const uint32_t thread_flags = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD |
    CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID | CLONE_CHILD_SETTID | CLONE_CHILD_CLEARTID;
  struct sock_filter filter[sizeof(allowed) / sizeof(allowed[0]) + 16];
  size_t index = 0;
  filter[index++] = BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch));
  filter[index++] = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_NATIVE, 1, 0);
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  filter[index++] = BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr));
  filter[index++] = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 9);
  filter[index++] = BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
  filter[index++] = BPF_STMT(BPF_ALU | BPF_AND | BPF_K, ~thread_flags);
  filter[index++] = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 1, 0);
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  filter[index++] = BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]));
  filter[index++] = BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_VM | CLONE_THREAD);
  filter[index++] = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, CLONE_VM | CLONE_THREAD, 1, 0);
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  for (size_t i = 0; i < sizeof(allowed) / sizeof(allowed[0]); i++) {
    if (allowed[i] == SYS_clone) continue;
    filter[index++] = BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)allowed[i], 1, 0);
  }
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS);
  filter[index++] = BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW);
  struct sock_fprog program = { .len = (unsigned short)index, .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) fail("install seccomp allowlist");
}

static char *rewrite_release_path(const char *root, const char *path) {
  const char *relative = release_relative(root, path);
  if (!relative || path[0] != '/') return strdup(path);
  const size_t length = strlen(relative) + sizeof("/runtime/");
  char *rewritten = calloc(length, 1);
  if (!rewritten) fail("allocate rewritten command");
  (void)snprintf(rewritten, length, "/runtime/%s", relative);
  return rewritten;
}

static char **build_child_argv(int argc, char **argv, int split, const char *release, const char *bootstrap, const char *entrypoint) {
  const int original_args = argc - split - 1;
  const int extra = bootstrap ? 4 : 0;
  char **child = calloc((size_t)original_args + (size_t)extra + 1, sizeof(*child));
  if (!child) fail("allocate child argv");
  int index = 0;
  child[index++] = rewrite_release_path(release, argv[split + 1]);
  if (bootstrap) {
    child[index++] = rewrite_release_path(release, bootstrap);
    child[index++] = strdup("--entrypoint");
    child[index++] = rewrite_release_path(release, entrypoint);
    child[index++] = strdup("--");
    for (int i = split + 2; i < argc; i++) child[index++] = rewrite_release_path(release, argv[i]);
  } else {
    for (int i = split + 2; i < argc; i++) child[index++] = rewrite_release_path(release, argv[i]);
  }
  child[index] = NULL;
  return child;
}

static void child_main(int release_fd, int executable_fd, int capability_fd, int sync_read, char **child_argv,
                       const char *execution_id) {
  unsigned char ready;
  if (read(sync_read, &ready, 1) != 1) fail("read namespace mapping barrier");
  close(sync_read);
  setup_mount_namespace(release_fd);
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0 || prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) fail("process supervision setup");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no_new_privs");
  drop_capabilities();

  if (dup3(capability_fd, 3, 0) < 0) fail("dup capability fd 3");
  if (fcntl(3, F_SETFD, 0) < 0) fail("clear capability fd cloexec for bootstrap");
  close(capability_fd);
  close(release_fd);
  if (close_range(5, UINT_MAX, CLOSE_RANGE_UNSHARE) != 0) fail("close non-allowlisted fds");
  struct stat descriptor;
  for (int fd = 0; fd <= 3; fd++) if (fstat(fd, &descriptor) != 0) fail("verify inherited fd");
  if (fcntl(4, F_GETFD) < 0) fail("verify executable fd");

  if (clearenv() != 0) fail("clear inherited environment");
  (void)setenv("LANG", "C.UTF-8", 1);
  (void)setenv("LC_ALL", "C.UTF-8", 1);
  (void)setenv("TZ", "UTC", 1);
  (void)setenv("NODE_ENV", "production", 1);
  (void)setenv("HOME", "/work/home", 1);
  (void)setenv("TMPDIR", "/tmp", 1);
  (void)setenv("PATH", "/runtime/bin", 1);
  (void)setenv("UV_USE_IO_URING", "0", 1);
  (void)setenv("KCML_CONTEXT_FD", "3", 1);
  (void)setenv("KCML_CONTEXT_FD_CLOEXEC", "BOOTSTRAP_REQUIRED", 1);
  if (execution_id) (void)setenv("KCML_EXECUTION_ID", execution_id, 1);
  install_seccomp_allowlist();
  fexecve(4, child_argv, environ);
  fail("fexecve trusted Node/bootstrap entrypoint");
}

int main(int argc, char **argv) {
  const char *uid_text = argument(argc, argv, "--uid");
  const char *gid_text = argument(argc, argv, "--gid");
  const char *release_input = argument(argc, argv, "--release-root");
  const char *work_input = argument(argc, argv, "--workspace-root");
  const char *expected_input = argument(argc, argv, "--executable-digest");
  const char *bootstrap = argument(argc, argv, "--bootstrap");
  const char *entrypoint = argument(argc, argv, "--handler-entrypoint");
  const int split = separator(argc, argv);
  if (!decimal_id(uid_text) || !decimal_id(gid_text) || !release_input || !work_input || !expected_input || split < 0 || split + 1 >= argc) {
    fputs("invalid sandbox launcher arguments\n", stderr);
    return 64;
  }
  if ((bootstrap == NULL) != (entrypoint == NULL)) fail_code("bootstrap and handler entrypoint must be supplied together", 64);
  const uid_t uid = (uid_t)strtoul(uid_text, NULL, 10);
  const gid_t gid = (gid_t)strtoul(gid_text, NULL, 10);
  char release[PATH_MAX], work[PATH_MAX], executable[PATH_MAX], bootstrap_real[PATH_MAX], entrypoint_real[PATH_MAX];
  if (!realpath(release_input, release) || !realpath(work_input, work) || !realpath(argv[split + 1], executable)) fail("realpath launch input");
  if (!contained(release, executable)) fail_code("executable escapes release", 65);
  const char *executable_relative = release_relative(release, executable);
  if (!executable_relative) fail_code("executable path is not release-relative", 65);
  const int release_fd = open(release, O_PATH | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (release_fd < 0) fail("open immutable release directory");
  const int executable_fd = open_release_file(release_fd, executable_relative, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (executable_fd < 0) fail("open executable with openat2");
  if (release_fd != 3 || executable_fd != 4) fail_code("launcher requires reserved fd layout 0..4", 68);
  struct stat executable_status;
  if (fstat(executable_fd, &executable_status) != 0 || !S_ISREG(executable_status.st_mode) || executable_status.st_nlink != 1 || (executable_status.st_mode & (S_ISUID | S_ISGID)) != 0) fail_code("executable is not an immutable regular file", 66);
  char actual[65];
  file_sha256(executable_fd, actual);
  const char *expected = strncmp(expected_input, "sha256:", 7) == 0 ? expected_input + 7 : expected_input;
  if (strlen(expected) != 64 || strcmp(actual, expected) != 0) fail_code("executable digest mismatch", 67);
  if (bootstrap) {
    if (!realpath(bootstrap, bootstrap_real) || !contained(release, bootstrap_real) || !realpath(entrypoint, entrypoint_real) || !contained(release, entrypoint_real)) fail_code("bootstrap or handler escapes release", 65);
    const char *bootstrap_relative = release_relative(release, bootstrap_real);
    const char *entrypoint_relative = release_relative(release, entrypoint_real);
    if (!bootstrap_relative || !entrypoint_relative) fail_code("bootstrap or handler is not release-relative", 65);
    verify_regular_release_file(release_fd, bootstrap_relative, "verify Node bootstrap");
    verify_regular_release_file(release_fd, entrypoint_relative, "verify generated handler");
    char addon_relative[PATH_MAX];
    const char *last_separator = strrchr(bootstrap_relative, '/');
    if (last_separator) {
      const size_t directory_length = (size_t)(last_separator - bootstrap_relative);
      if (directory_length + sizeof("/kcml-fd-cloexec.node") > sizeof(addon_relative)) fail_code("fd CLOEXEC addon path too long", 65);
      (void)snprintf(addon_relative, sizeof(addon_relative), "%.*s/kcml-fd-cloexec.node", (int)directory_length, bootstrap_relative);
    } else {
      (void)snprintf(addon_relative, sizeof(addon_relative), "kcml-fd-cloexec.node");
    }
    verify_regular_release_file(release_fd, addon_relative, "verify fd CLOEXEC addon");
  }
  if (chdir(work) != 0) fail("workspace root");
  (void)setrlimit(RLIMIT_NPROC, &(struct rlimit){64, 64});
  (void)setrlimit(RLIMIT_NOFILE, &(struct rlimit){1024, 1024});
  (void)setrlimit(RLIMIT_CORE, &(struct rlimit){0, 0});
  (void)setrlimit(RLIMIT_FSIZE, &(struct rlimit){1024ULL * 1024ULL * 1024ULL, 1024ULL * 1024ULL * 1024ULL});

  int capability[2];
  int barrier[2];
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, capability) != 0) fail("create anonymous capability socketpair");
  if (pipe2(barrier, O_CLOEXEC) != 0) fail("create namespace mapping barrier");
  struct clone_args clone_arguments;
  memset(&clone_arguments, 0, sizeof(clone_arguments));
  clone_arguments.flags = CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWNET | CLONE_NEWIPC | CLONE_NEWUTS | CLONE_NEWPID | CLONE_NEWCGROUP;
  clone_arguments.exit_signal = SIGCHLD;
  char **child_argv = build_child_argv(argc, argv, split, release, bootstrap, entrypoint);
  const char *execution_id = getenv("KCML_EXECUTION_ID");
  const pid_t child = (pid_t)syscall(SYS_clone3, &clone_arguments, sizeof(clone_arguments));
  if (child < 0) fail("clone3 namespace setup");
  if (child == 0) {
    close(capability[0]);
    close(barrier[1]);
    child_main(release_fd, executable_fd, capability[1], barrier[0], child_argv, execution_id);
  }
  const int pidfd = (int)syscall(SYS_pidfd_open, child, 0);
  if (pidfd < 0) fail("pidfd tracking unavailable");
  close(capability[1]);
  close(barrier[0]);
  configure_user_mapping(child, uid, gid);
  close(release_fd);
  close(executable_fd);
  if (write(barrier[1], "1", 1) != 1) fail("release namespace mapping barrier");
  close(barrier[1]);
  int status = 0;
  struct pollfd child_exit = { .fd = pidfd, .events = POLLIN };
  if (poll(&child_exit, 1, -1) < 0) fail("poll sandbox pidfd");
  if (waitpid(child, &status, 0) < 0) fail("wait sandbox child");
  close(pidfd);
  close(capability[0]);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 70;
}
