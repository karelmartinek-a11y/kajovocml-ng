#define _GNU_SOURCE

/*
 * KCML generated-handler sandbox launcher.
 *
 * This is a fail-closed Linux supervisor, not a general-purpose container
 * runtime. The runtime host must pass one connected AF_UNIX SOCK_STREAM on fd
 * 3. The handler receives that same descriptor during the trusted bootstrap
 * exec and no other inherited descriptor.
 * FD 3 is the only platform capability; it is never replaced by a path-based
 * socket or a launcher-created broker connection.
 *
 * The launcher deliberately requires clone3, pidfds, user/cgroup namespaces,
 * openat2 and pivot_root. A host which cannot provide these primitives is an
 * environmental launch failure; it is never allowed to fall back to an
 * unsandboxed process.
 */

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/capability.h>
#include <linux/filter.h>
#include <linux/limits.h>
#include <linux/openat2.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <linux/securebits.h>
#include <limits.h>
#include <openssl/evp.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef SYS_clone3
#define SYS_clone3 __NR_clone3
#endif
#ifndef SYS_close_range
#define SYS_close_range __NR_close_range
#endif
#ifndef SYS_execveat
#define SYS_execveat __NR_execveat
#endif
#ifndef SYS_pidfd_open
#define SYS_pidfd_open __NR_pidfd_open
#endif
#ifndef SYS_pidfd_send_signal
#define SYS_pidfd_send_signal __NR_pidfd_send_signal
#endif
#ifndef CLOSE_RANGE_UNSHARE
#define CLOSE_RANGE_UNSHARE 2U
#endif
#define TRUSTED_EXECUTABLE_FD 1024
#ifndef AT_EMPTY_PATH
#define AT_EMPTY_PATH 0x1000
#endif
#ifndef AUDIT_ARCH_NATIVE
#if defined(__x86_64__)
#define AUDIT_ARCH_NATIVE AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define AUDIT_ARCH_NATIVE AUDIT_ARCH_AARCH64
#elif defined(__i386__)
#define AUDIT_ARCH_NATIVE AUDIT_ARCH_I386
#elif defined(__arm__)
#define AUDIT_ARCH_NATIVE AUDIT_ARCH_ARM
#else
#error "KCML sandbox requires an explicitly supported Linux audit architecture"
#endif
#endif

extern char **environ;

static void fail(const char *message) {
  fprintf(stderr, "kcml-sandbox-launcher: %s: %s\n", message, strerror(errno));
  _exit(70);
}

static void fail_code(const char *message, int code) {
  fprintf(stderr, "kcml-sandbox-launcher: %s\n", message);
  _exit(code);
}

static const char *argument(int argc, char **argv, int end, const char *name) {
  const int limit = end > 0 ? end : argc;
  for (int index = 1; index + 1 < limit; index++) {
    if (strcmp(argv[index], name) == 0) return argv[index + 1];
  }
  return NULL;
}

static int separator(int argc, char **argv) {
  for (int index = 1; index < argc; index++) {
    if (strcmp(argv[index], "--") == 0) return index;
  }
  return -1;
}

static bool decimal_id(const char *value) {
  if (value == NULL || *value == '\0') return false;
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor != '\0'; cursor++) {
    if (*cursor < '0' || *cursor > '9') return false;
  }
  return true;
}

static bool parse_fd3(const char *value) {
  return value != NULL && strcmp(value, "3") == 0;
}

static bool parse_uuid(const char *value) {
  if (value == NULL || strlen(value) != 36) return false;
  for (size_t index = 0; index < 36; index++) {
    const bool hyphen = index == 8 || index == 13 || index == 18 || index == 23;
    if (hyphen) {
      if (value[index] != '-') return false;
    } else {
      const char character = value[index];
      const bool digit = character >= '0' && character <= '9';
      const bool lower = character >= 'a' && character <= 'f';
      if (!digit && !lower) return false;
    }
  }
  return true;
}

static bool contained(const char *root, const char *path) {
  const size_t length = strlen(root);
  return strncmp(root, path, length) == 0 && (path[length] == '/' || path[length] == '\0');
}

static bool valid_relative_path(const char *relative) {
  if (relative == NULL || *relative == '\0' || *relative == '/') return false;
  const char *component = relative;
  for (const char *cursor = relative;; cursor++) {
    if (*cursor == '/' || *cursor == '\0') {
      const size_t length = (size_t)(cursor - component);
      if (length == 0 || (length == 1 && component[0] == '.') ||
          (length == 2 && component[0] == '.' && component[1] == '.')) return false;
      if (*cursor == '\0') break;
      component = cursor + 1;
    }
  }
  return true;
}

static const char *release_relative(const char *root, const char *path) {
  if (!contained(root, path)) return NULL;
  const char *relative = path + strlen(root);
  while (*relative == '/') relative++;
  return valid_relative_path(relative) ? relative : NULL;
}

static int openat2_path(int directory_fd, const char *path, uint64_t flags, uint64_t resolve) {
  struct open_how how;
  memset(&how, 0, sizeof(how));
  how.flags = flags;
  how.resolve = resolve;
  return (int)syscall(SYS_openat2, directory_fd, path, &how, sizeof(how));
}

static int open_release_root(const char *path) {
  return openat2_path(AT_FDCWD, path, O_PATH | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW,
                      RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV);
}

static int open_release_file(int release_fd, const char *relative, int flags) {
  return openat2_path(release_fd, relative, (uint64_t)flags,
                      RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV);
}

static void verify_regular_release_file(int release_fd, const char *relative, const char *label) {
  const int fd = open_release_file(release_fd, relative, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) fail(label);
  struct stat status;
  const bool valid = fstat(fd, &status) == 0 && S_ISREG(status.st_mode) && status.st_nlink == 1 &&
    (status.st_mode & (S_ISUID | S_ISGID | S_IWGRP | S_IWOTH)) == 0;
  close(fd);
  if (!valid) fail_code("release file type/mode/link contract failed", 66);
}

static void file_sha256(int fd, char output[65]) {
  EVP_MD_CTX *context = EVP_MD_CTX_new();
  if (context == NULL) fail("EVP_MD_CTX_new");
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
  for (unsigned int index = 0; index < length; index++) (void)snprintf(output + index * 2, 3, "%02x", digest[index]);
  output[64] = '\0';
}

static int validate_capability_fd(void) {
  struct stat status;
  if (fstat(3, &status) != 0 || !S_ISSOCK(status.st_mode)) return -1;
  int socket_type = 0;
  socklen_t socket_type_length = sizeof(socket_type);
  if (getsockopt(3, SOL_SOCKET, SO_TYPE, &socket_type, &socket_type_length) != 0 || socket_type != SOCK_STREAM) return -1;
  int accepting = 1;
  socklen_t accepting_length = sizeof(accepting);
  if (getsockopt(3, SOL_SOCKET, SO_ACCEPTCONN, &accepting, &accepting_length) != 0 || accepting != 0) return -1;
  struct sockaddr_storage peer;
  socklen_t peer_length = sizeof(peer);
  if (getpeername(3, (struct sockaddr *)&peer, &peer_length) != 0) return -1;
  return 0;
}

static int write_proc_file(pid_t child, const char *name, const char *value) {
  char path[64];
  if (snprintf(path, sizeof(path), "/proc/%ld/%s", (long)child, name) >= (int)sizeof(path)) return -1;
  const int fd = open(path, O_WRONLY | O_CLOEXEC);
  if (fd < 0) return -1;
  const size_t length = strlen(value);
  const ssize_t written = write(fd, value, length);
  const int close_status = close(fd);
  return written == (ssize_t)length && close_status == 0 ? 0 : -1;
}

static int configure_user_mapping(pid_t child, uid_t uid, gid_t gid) {
  char map[128];
  if (snprintf(map, sizeof(map), "0 %lu 1\n", (unsigned long)uid) >= (int)sizeof(map)) return -1;
  if (write_proc_file(child, "uid_map", map) != 0) return -1;
  if (write_proc_file(child, "setgroups", "deny\n") != 0) return -1;
  if (snprintf(map, sizeof(map), "0 %lu 1\n", (unsigned long)gid) >= (int)sizeof(map)) return -1;
  return write_proc_file(child, "gid_map", map);
}

static void terminate_child(pid_t child, int pidfd) {
  if (pidfd < 0 || syscall(SYS_pidfd_send_signal, pidfd, SIGKILL, NULL, 0U) != 0) (void)kill(child, SIGKILL);
  int status;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
}

static void mkdir_required(const char *path, mode_t mode) {
  if (mkdir(path, mode) != 0 && errno != EEXIST) fail("mkdir sandbox path");
  struct stat status;
  if (lstat(path, &status) != 0 || !S_ISDIR(status.st_mode)) fail_code("sandbox path is not a directory", 65);
}

static const char *sandbox_path(char buffer[PATH_MAX], const char *staging, const char *suffix) {
  if (snprintf(buffer, PATH_MAX, "%s%s", staging, suffix) >= PATH_MAX) fail_code("sandbox path too long", 65);
  return buffer;
}

static void mount_tmpfs(const char *path, const char *size, const char *inodes, mode_t mode) {
  char options[128];
  if (snprintf(options, sizeof(options), "size=%s,nr_inodes=%s,mode=%o", size, inodes, mode) >= (int)sizeof(options)) fail_code("tmpfs option too long", 65);
  if (mount("tmpfs", path, "tmpfs", MS_NODEV | MS_NOSUID | MS_NOEXEC, options) != 0) fail("mount private tmpfs");
}

static void attach_release_readonly(int release_fd, const char *release_path, const char *target) {
  /* openat2 anchored all release files before this mount. The path is only
     used to attach that same immutable directory before pivot_root; the
     source fd/inode is compared immediately after mount to close a rename or
     replacement race. */
  if (mount(release_path, target, NULL, MS_BIND | MS_REC, NULL) != 0) fail("bind immutable release");
  struct stat source_status;
  struct stat target_status;
  if (fstat(release_fd, &source_status) != 0 || stat(target, &target_status) != 0 ||
      source_status.st_dev != target_status.st_dev || source_status.st_ino != target_status.st_ino) fail("immutable release mount identity mismatch");
  if (mount(NULL, target, NULL, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV, NULL) != 0) fail("remount immutable release");
}

static void bind_device(const char *source, const char *target) {
  const int fd = open(target, O_CREAT | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) fail("create private device placeholder");
  close(fd);
  if (mount(source, target, NULL, MS_BIND, NULL) != 0) fail("bind minimal device");
}

static void expose_release_loader_directory(const char *staging, const char *name) {
  char release_path[PATH_MAX];
  char root_path[PATH_MAX];
  if (snprintf(release_path, sizeof(release_path), "%s/runtime/%s", staging, name) >= (int)sizeof(release_path) ||
      snprintf(root_path, sizeof(root_path), "%s/%s", staging, name) >= (int)sizeof(root_path)) fail_code("loader path too long", 65);
  struct stat status;
  if (lstat(release_path, &status) != 0) {
    if (errno == ENOENT) return;
    fail("inspect release loader directory");
  }
  if (!S_ISDIR(status.st_mode)) fail_code("release loader path is not a directory", 66);
  char target[PATH_MAX];
  if (snprintf(target, sizeof(target), "/runtime/%s", name) >= (int)sizeof(target)) fail_code("loader target path too long", 65);
  if (symlink(target, root_path) != 0) fail("expose release loader directory");
}

static void setup_mount_namespace(int release_fd, const char *release_path, const char *staging) {
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) fail("make mounts private");
  mkdir_required(staging, 0700);
  mount_tmpfs(staging, "1G", "65536", 0755);

  char path[PATH_MAX];
  mkdir_required(sandbox_path(path, staging, "/runtime"), 0755);
  mkdir_required(sandbox_path(path, staging, "/tmp"), 0700);
  mkdir_required(sandbox_path(path, staging, "/run"), 0700);
  mkdir_required(sandbox_path(path, staging, "/work"), 0700);
  mkdir_required(sandbox_path(path, staging, "/proc"), 0555);
  mkdir_required(sandbox_path(path, staging, "/dev"), 0755);
  mkdir_required(sandbox_path(path, staging, "/.oldroot"), 0700);

  attach_release_readonly(release_fd, release_path, sandbox_path(path, staging, "/runtime"));
  expose_release_loader_directory(staging, "lib");
  expose_release_loader_directory(staging, "lib64");
  if (mount("proc", sandbox_path(path, staging, "/proc"), "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, "hidepid=2") != 0) fail("mount private proc");
  mount_tmpfs(sandbox_path(path, staging, "/tmp"), "64M", "8192", 0700);
  mount_tmpfs(sandbox_path(path, staging, "/run"), "16M", "2048", 0700);
  mount_tmpfs(sandbox_path(path, staging, "/work"), "256M", "32768", 0700);
  mkdir_required(sandbox_path(path, staging, "/work/home"), 0700);
  mount_tmpfs(sandbox_path(path, staging, "/dev"), "16M", "4096", 0755);
  bind_device("/dev/null", sandbox_path(path, staging, "/dev/null"));
  bind_device("/dev/zero", sandbox_path(path, staging, "/dev/zero"));
  bind_device("/dev/random", sandbox_path(path, staging, "/dev/random"));
  bind_device("/dev/urandom", sandbox_path(path, staging, "/dev/urandom"));
  if (symlink("/proc/self/fd", sandbox_path(path, staging, "/dev/fd")) != 0) fail("create private /dev/fd");
  if (symlink("/proc/self/fd/0", sandbox_path(path, staging, "/dev/stdin")) != 0) fail("create private stdin link");
  if (symlink("/proc/self/fd/1", sandbox_path(path, staging, "/dev/stdout")) != 0) fail("create private stdout link");
  if (symlink("/proc/self/fd/2", sandbox_path(path, staging, "/dev/stderr")) != 0) fail("create private stderr link");

  if (syscall(SYS_pivot_root, staging, sandbox_path(path, staging, "/.oldroot")) != 0) fail("pivot private root");
  if (umount2("/.oldroot", MNT_DETACH) != 0) fail("detach host root");
  if (rmdir("/.oldroot") != 0) fail("remove old root");
  if (mount(NULL, "/", NULL, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) != 0) fail("make sandbox root readonly");
  if (chdir("/work") != 0) fail("chdir workspace");
  if (sethostname("kcml-sandbox", sizeof("kcml-sandbox") - 1) != 0) fail("set fixed UTS name");
}

static void drop_capabilities(void) {
  const unsigned int securebits = SECBIT_NOROOT | SECBIT_NOROOT_LOCKED |
    SECBIT_NO_SETUID_FIXUP | SECBIT_NO_SETUID_FIXUP_LOCKED |
    SECBIT_NO_CAP_AMBIENT_RAISE | SECBIT_NO_CAP_AMBIENT_RAISE_LOCKED;
  if (prctl(PR_SET_SECUREBITS, securebits, 0, 0, 0) != 0) fail("securebits");
  if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0) fail("clear ambient capabilities");
  for (unsigned int capability = 0; capability < 64; capability++) {
    const int present = prctl(PR_CAPBSET_READ, capability, 0, 0, 0);
    if (present == 1 && prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) != 0) fail("drop capability bounding set");
    if (present < 0 && errno != EINVAL) fail("read capability bounding set");
  }
  struct __user_cap_header_struct header;
  struct __user_cap_data_struct data[2];
  memset(&header, 0, sizeof(header));
  memset(data, 0, sizeof(data));
  header.version = _LINUX_CAPABILITY_VERSION_3;
  if (syscall(SYS_capset, &header, &data) != 0) fail("drop capability sets");
}

static struct sock_filter filter_stmt(uint16_t code, uint32_t constant) {
  return (struct sock_filter){ .code = code, .jt = 0, .jf = 0, .k = constant };
}

static struct sock_filter filter_jump(uint16_t code, uint32_t constant, uint8_t jump_true, uint8_t jump_false) {
  return (struct sock_filter){ .code = code, .jt = jump_true, .jf = jump_false, .k = constant };
}

static void append_filter(struct sock_filter *filter, size_t *index, struct sock_filter instruction) {
  filter[(*index)++] = instruction;
}

/*
 * KCML_GENERATED_NODE_SECCOMP_PROFILE_V1
 *
 * The profile is an explicit allowlist. Unknown syscalls and every network or
 * namespace-changing syscalls are killed. clone is admitted only for a
 * pthread-style thread. clone3 returns ENOSYS because classic BPF cannot
 * safely dereference its pointed-to clone_args; glibc falls back to clone for
 * the Node pthread path. execveat is admitted only once, for the already
 * verified trusted executable fd and AT_EMPTY_PATH; that fd is CLOEXEC and is
 * gone when the bootstrap starts. Its reserved descriptor is above the
 * runtime's RLIMIT_NOFILE, so generated code cannot recreate the numeric fd.
 * prctl is similarly restricted to harmless
 * runtime operations. The first three instructions are the architecture
 * guard: native arch jumps over the kill, every other arch is killed.
 */
static void install_seccomp_allowlist(int executable_fd) {
  static const int allowed[] = {
    SYS_read, SYS_write, SYS_close, SYS_fstat, SYS_newfstatat, SYS_lseek,
    SYS_mmap, SYS_mprotect, SYS_munmap, SYS_brk, SYS_rt_sigaction, SYS_rt_sigprocmask,
    SYS_rt_sigreturn, SYS_sigaltstack, SYS_ioctl, SYS_pread64, SYS_pwrite64,
    SYS_readv, SYS_writev, SYS_access, SYS_pipe, SYS_pipe2, SYS_poll, SYS_ppoll,
    SYS_pselect6, SYS_sched_yield, SYS_mremap, SYS_mincore, SYS_madvise, SYS_dup,
    SYS_dup2, SYS_dup3, SYS_nanosleep, SYS_getpid, SYS_getppid, SYS_getuid, SYS_geteuid,
    SYS_getgid, SYS_getegid, SYS_gettid, SYS_futex, SYS_set_robust_list, SYS_set_tid_address,
    SYS_rseq, SYS_arch_prctl, SYS_clock_gettime, SYS_clock_getres, SYS_clock_nanosleep,
    SYS_gettimeofday,
    SYS_exit, SYS_exit_group, SYS_openat, SYS_unlinkat, SYS_renameat, SYS_mkdirat,
    SYS_statx, SYS_faccessat2, SYS_getrandom, SYS_fcntl, SYS_close_range, SYS_unlink, SYS_getcwd,
    SYS_chdir, SYS_fchdir, SYS_readlink, SYS_readlinkat, SYS_getdents64, SYS_fsync,
    SYS_fdatasync, SYS_ftruncate, SYS_getrlimit, SYS_setrlimit, SYS_prlimit64, SYS_uname,
    SYS_times, SYS_sched_getaffinity, SYS_getcpu, SYS_epoll_create1, SYS_epoll_ctl,
    SYS_epoll_wait, SYS_epoll_pwait, SYS_eventfd2, SYS_timerfd_create, SYS_timerfd_settime,
    SYS_signalfd4, SYS_recvfrom, SYS_sendto, SYS_recvmsg, SYS_sendmsg, SYS_getsockname,
    SYS_getpeername, SYS_getsockopt, SYS_setsockopt, SYS_shutdown, SYS_restart_syscall,
    SYS_membarrier, SYS_tgkill, SYS_tkill, SYS_capget
  };
  static const int allowed_prctl[] = {
    PR_SET_NAME, PR_GET_NAME, PR_GET_DUMPABLE, PR_SET_DUMPABLE, PR_SET_VMA
  };
  const uint32_t thread_flags = (uint32_t)(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |
    CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID |
    CLONE_CHILD_SETTID | CLONE_CHILD_CLEARTID);
  struct sock_filter filter[256];
  size_t index = 0;
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)));
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_NATIVE, 1, 0));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)));

  /* libuv probes io_uring during Node startup even with UV_USE_IO_URING=0.
     Return EPERM for the three io_uring entrypoints so the runtime falls back
     to ordinary I/O, while the profile still never grants io_uring authority. */
  const int io_uring_syscalls[] = { SYS_io_uring_setup, SYS_io_uring_enter, SYS_io_uring_register };
  for (size_t syscall_index = 0; syscall_index < sizeof(io_uring_syscalls) / sizeof(io_uring_syscalls[0]); syscall_index++) {
    append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K,
                                               (uint32_t)io_uring_syscalls[syscall_index], 0, 1));
    append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM));
  }

  /* clone3 takes a userspace pointer to struct clone_args, which classic BPF
     cannot safely dereference. Reject it so libc uses the checked clone path. */
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS));

  const size_t clone_block_length = 9;
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, (uint8_t)clone_block_length));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
  append_filter(filter, &index, filter_stmt(BPF_ALU | BPF_AND | BPF_K, (uint32_t)~thread_flags));
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, 0, 1, 0));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
  append_filter(filter, &index, filter_stmt(BPF_ALU | BPF_AND | BPF_K, CLONE_VM | CLONE_THREAD));
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, CLONE_VM | CLONE_THREAD, 1, 0));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

  const size_t execveat_block_length = 7;
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, SYS_execveat, 0, (uint8_t)execveat_block_length));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)executable_fd, 1, 0));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[4])));
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, AT_EMPTY_PATH, 1, 0));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

  const size_t prctl_block_length = 1 + sizeof(allowed_prctl) / sizeof(allowed_prctl[0]) + 2;
  append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, SYS_prctl, 0, (uint8_t)prctl_block_length));
  append_filter(filter, &index, filter_stmt(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])));
  for (size_t operation = 0; operation < sizeof(allowed_prctl) / sizeof(allowed_prctl[0]); operation++) {
    const size_t remaining = sizeof(allowed_prctl) / sizeof(allowed_prctl[0]) - operation;
    append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)allowed_prctl[operation], (uint8_t)remaining, 0));
  }
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));

  for (size_t syscall_index = 0; syscall_index < sizeof(allowed) / sizeof(allowed[0]); syscall_index++) {
    const size_t remaining = sizeof(allowed) / sizeof(allowed[0]) - syscall_index;
    append_filter(filter, &index, filter_jump(BPF_JMP | BPF_JEQ | BPF_K, (uint32_t)allowed[syscall_index], (uint8_t)remaining, 0));
  }
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS));
  append_filter(filter, &index, filter_stmt(BPF_RET | BPF_K, SECCOMP_RET_ALLOW));
  if (index > UINT16_MAX) fail_code("seccomp program too long", 68);
  struct sock_fprog program = { .len = (unsigned short)index, .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program) != 0) fail("install seccomp allowlist");
}

static char *duplicate_string(const char *value) {
  char *copy = strdup(value);
  if (copy == NULL) fail("allocate launcher argument");
  return copy;
}

static char *rewrite_release_path(const char *root, const char *path) {
  const char *relative = release_relative(root, path);
  if (relative == NULL || path[0] != '/') return duplicate_string(path);
  const size_t length = strlen(relative) + sizeof("/runtime/");
  char *rewritten = calloc(length, 1);
  if (rewritten == NULL) fail("allocate rewritten command");
  (void)snprintf(rewritten, length, "/runtime/%s", relative);
  return rewritten;
}

static char **build_child_argv(int argc, char **argv, int split, const char *release,
                               const char *bootstrap, const char *entrypoint) {
  const int original_args = argc - split - 1;
  const int extra = bootstrap == NULL ? 0 : 4;
  char **child = calloc((size_t)original_args + (size_t)extra + 1, sizeof(*child));
  if (child == NULL) fail("allocate child argv");
  int index = 0;
  child[index++] = rewrite_release_path(release, argv[split + 1]);
  if (bootstrap != NULL) {
    child[index++] = rewrite_release_path(release, bootstrap);
    child[index++] = duplicate_string("--entrypoint");
    child[index++] = rewrite_release_path(release, entrypoint);
    child[index++] = duplicate_string("--");
  }
  for (int argument_index = split + 2; argument_index < argc; argument_index++) {
    child[index++] = rewrite_release_path(release, argv[argument_index]);
  }
  child[index] = NULL;
  return child;
}

static int close_range_except(int executable_fd) {
  if (executable_fd > 4 && syscall(SYS_close_range, 4U, (unsigned int)executable_fd - 1U, CLOSE_RANGE_UNSHARE) != 0) return -1;
  if ((unsigned int)executable_fd < UINT_MAX && syscall(SYS_close_range, (unsigned int)executable_fd + 1U, UINT_MAX, 0U) != 0) return -1;
  return 0;
}

static void child_main(int release_fd, int executable_fd, int barrier_read, char **child_argv,
                       const char *release_path, const char *staging, const char *execution_id) {
  /* The launcher is outside the new PID namespace, so getppid() is 0 here.
     Install parent-death handling before waiting for the mapping barrier;
     closing that barrier also fail-closes a launcher that died too early. */
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) != 0) fail("set parent-death signal");
  unsigned char ready = 0;
  do {
    if (read(barrier_read, &ready, 1) == 1) break;
  } while (errno == EINTR);
  if (ready != 1) fail("read namespace mapping barrier");
  close(barrier_read);
  if (setresgid(0, 0, 0) != 0 || setresuid(0, 0, 0) != 0) fail("enter mapped identity");
  if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0 || prctl(PR_SET_DUMPABLE, 0) != 0) fail("process supervision setup");
  setup_mount_namespace(release_fd, release_path, staging);
  struct rlimit descriptor_limit;
  if (getrlimit(RLIMIT_NOFILE, &descriptor_limit) != 0 || descriptor_limit.rlim_max <= TRUSTED_EXECUTABLE_FD) fail_code("trusted executable fd exceeds the hard descriptor limit", 70);
  if (descriptor_limit.rlim_cur <= TRUSTED_EXECUTABLE_FD) {
    struct rlimit raised_limit = { descriptor_limit.rlim_max, descriptor_limit.rlim_max };
    if (setrlimit(RLIMIT_NOFILE, &raised_limit) != 0) fail("raise descriptor limit for trusted executable fd");
  }
  if (executable_fd == TRUSTED_EXECUTABLE_FD || dup3(executable_fd, TRUSTED_EXECUTABLE_FD, O_CLOEXEC) < 0) fail("reserve trusted executable fd");
  if (setrlimit(RLIMIT_NPROC, &(struct rlimit){64, 64}) != 0 ||
      setrlimit(RLIMIT_NOFILE, &(struct rlimit){1024, 1024}) != 0 ||
      setrlimit(RLIMIT_CORE, &(struct rlimit){0, 0}) != 0 ||
      setrlimit(RLIMIT_FSIZE, &(struct rlimit){1024ULL * 1024ULL * 1024ULL, 1024ULL * 1024ULL * 1024ULL}) != 0) fail("set runtime resource limits");
  drop_capabilities();
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("PR_SET_NO_NEW_PRIVS");
  close(release_fd);
  if (close_range_except(TRUSTED_EXECUTABLE_FD) != 0) fail("close non-allowlisted fds");
  if (validate_capability_fd() != 0) fail_code("inherited capability fd 3 is not a connected AF_UNIX stream", 68);
  struct stat descriptor;
  for (int fd = 0; fd <= 3; fd++) if (fstat(fd, &descriptor) != 0) fail("verify inherited fd");
  if (fcntl(TRUSTED_EXECUTABLE_FD, F_GETFD) < 0) fail("verify trusted executable fd");
  char *execution_id_copy = execution_id == NULL ? NULL : strdup(execution_id);
  if (execution_id != NULL && execution_id_copy == NULL) fail("copy execution ID");
  if (clearenv() != 0) fail("clear inherited environment");
  if (setenv("LANG", "C.UTF-8", 1) != 0 || setenv("LC_ALL", "C.UTF-8", 1) != 0 ||
      setenv("TZ", "UTC", 1) != 0 || setenv("NODE_ENV", "production", 1) != 0 ||
      setenv("HOME", "/work/home", 1) != 0 || setenv("TMPDIR", "/tmp", 1) != 0 ||
      setenv("PATH", "/runtime/bin", 1) != 0 || setenv("UV_USE_IO_URING", "0", 1) != 0 ||
      setenv("KCML_CONTEXT_FD", "3", 1) != 0 || setenv("KCML_CONTEXT_FD_CLOEXEC", "BOOTSTRAP_REQUIRED", 1) != 0) fail("set exact runtime environment");
  if (execution_id_copy != NULL && setenv("KCML_EXECUTION_ID", execution_id_copy, 1) != 0) fail("set execution environment");
  free(execution_id_copy);
  install_seccomp_allowlist(TRUSTED_EXECUTABLE_FD);
  fexecve(TRUSTED_EXECUTABLE_FD, child_argv, environ);
  fail("fexecve trusted Node/bootstrap entrypoint");
}

int main(int argc, char **argv) {
  const int split = separator(argc, argv);
  const char *uid_text = argument(argc, argv, split, "--uid");
  const char *gid_text = argument(argc, argv, split, "--gid");
  const char *release_input = argument(argc, argv, split, "--release-root");
  const char *work_input = argument(argc, argv, split, "--workspace-root");
  const char *expected_input = argument(argc, argv, split, "--executable-digest");
  const char *capability_fd_text = argument(argc, argv, split, "--capability-fd");
  const char *bootstrap = argument(argc, argv, split, "--bootstrap");
  const char *entrypoint = argument(argc, argv, split, "--handler-entrypoint");
  if (!decimal_id(uid_text) || !decimal_id(gid_text) || !release_input || !work_input || !expected_input ||
      !parse_fd3(capability_fd_text) || split < 0 || split + 1 >= argc) {
    fputs("invalid sandbox launcher arguments\n", stderr);
    return 64;
  }
  if ((bootstrap == NULL) != (entrypoint == NULL)) {
    fputs("bootstrap and handler entrypoint must be supplied together\n", stderr);
    return 64;
  }
  errno = 0;
  char *uid_end = NULL;
  char *gid_end = NULL;
  const unsigned long uid_value = strtoul(uid_text, &uid_end, 10);
  const unsigned long gid_value = strtoul(gid_text, &gid_end, 10);
  if (errno != 0 || uid_end == uid_text || *uid_end != '\0' || gid_end == gid_text || *gid_end != '\0' ||
      uid_value > UINT_MAX || gid_value > UINT_MAX || uid_value == 0 || gid_value == 0) {
    fputs("runtime host UID/GID must be non-root decimal identities\n", stderr);
    return 64;
  }
  if (validate_capability_fd() != 0) {
    fputs("capability fd 3 must be a connected AF_UNIX stream\n", stderr);
    return 68;
  }
  const uid_t uid = (uid_t)uid_value;
  const gid_t gid = (gid_t)gid_value;
  char release[PATH_MAX], work[PATH_MAX], executable[PATH_MAX], bootstrap_real[PATH_MAX], entrypoint_real[PATH_MAX];
  if (!realpath(release_input, release) || !realpath(work_input, work) || !realpath(argv[split + 1], executable)) fail("realpath launch input");
  if (!contained(release, executable)) fail_code("executable escapes release", 65);
  const char *executable_relative = release_relative(release, executable);
  if (!executable_relative) fail_code("executable path is not canonical release-relative", 65);
  struct stat release_status;
  if (stat(release, &release_status) != 0 || !S_ISDIR(release_status.st_mode) || (release_status.st_mode & (S_IWGRP | S_IWOTH)) != 0) fail_code("release root is writable or not a directory", 66);
  const int release_fd = open_release_root(release);
  if (release_fd < 0) fail("open immutable release directory with openat2");
  const int executable_fd = open_release_file(release_fd, executable_relative, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (executable_fd < 0) fail("open executable with openat2");
  struct stat executable_status;
  if (fstat(executable_fd, &executable_status) != 0 || !S_ISREG(executable_status.st_mode) || executable_status.st_nlink != 1 ||
      (executable_status.st_mode & (S_ISUID | S_ISGID | S_IWGRP | S_IWOTH)) != 0) fail_code("executable is not an immutable regular file", 66);
  char actual[65];
  file_sha256(executable_fd, actual);
  const char *expected = strncmp(expected_input, "sha256:", 7) == 0 ? expected_input + 7 : expected_input;
  if (strlen(expected) != 64 || strcmp(actual, expected) != 0) fail_code("executable digest mismatch", 67);
  if (bootstrap != NULL) {
    if (!realpath(bootstrap, bootstrap_real) || !contained(release, bootstrap_real) ||
        !realpath(entrypoint, entrypoint_real) || !contained(release, entrypoint_real)) fail_code("bootstrap or handler escapes release", 65);
    const char *bootstrap_relative = release_relative(release, bootstrap_real);
    const char *entrypoint_relative = release_relative(release, entrypoint_real);
    if (!bootstrap_relative || !entrypoint_relative) fail_code("bootstrap or handler is not canonical release-relative", 65);
    verify_regular_release_file(release_fd, bootstrap_relative, "verify Node bootstrap");
    verify_regular_release_file(release_fd, entrypoint_relative, "verify generated handler");
    char addon_relative[PATH_MAX];
    const char *last_separator = strrchr(bootstrap_relative, '/');
    const size_t directory_length = last_separator == NULL ? 0 : (size_t)(last_separator - bootstrap_relative);
    if (directory_length + sizeof("/kcml-fd-cloexec.node") > sizeof(addon_relative)) fail_code("fd CLOEXEC addon path too long", 65);
    if (last_separator == NULL) (void)snprintf(addon_relative, sizeof(addon_relative), "kcml-fd-cloexec.node");
    else (void)snprintf(addon_relative, sizeof(addon_relative), "%.*s/kcml-fd-cloexec.node", (int)directory_length, bootstrap_relative);
    verify_regular_release_file(release_fd, addon_relative, "verify fd CLOEXEC addon");
  }
  const int work_fd = openat2_path(AT_FDCWD, work, O_PATH | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW, RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV);
  if (work_fd < 0) fail("open workspace root");
  close(work_fd);
  const char *execution_id = getenv("KCML_EXECUTION_ID");
  if (execution_id != NULL && !parse_uuid(execution_id)) fail_code("execution ID is not a lowercase UUID", 64);
  char staging[PATH_MAX];
  if (snprintf(staging, sizeof(staging), "%s/.kcml-sandbox-%ld", work, (long)getpid()) >= (int)sizeof(staging)) fail_code("sandbox staging path too long", 65);
  char **child_argv = build_child_argv(argc, argv, split, release, bootstrap, entrypoint);
  int barrier[2];
  if (pipe2(barrier, O_CLOEXEC) != 0) fail("create namespace mapping barrier");
  int pidfd = -1;
  struct clone_args clone_arguments;
  memset(&clone_arguments, 0, sizeof(clone_arguments));
  clone_arguments.flags = CLONE_PIDFD | CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWNET | CLONE_NEWIPC |
    CLONE_NEWUTS | CLONE_NEWPID | CLONE_NEWCGROUP;
  clone_arguments.pidfd = (uintptr_t)&pidfd;
  clone_arguments.exit_signal = SIGCHLD;
  const pid_t child = (pid_t)syscall(SYS_clone3, &clone_arguments, sizeof(clone_arguments));
  if (child < 0) {
    close(barrier[0]);
    close(barrier[1]);
    fail("clone3 namespace setup");
  }
  if (child == 0) {
    close(barrier[1]);
    child_main(release_fd, executable_fd, barrier[0], child_argv, release, staging, execution_id);
  }
  close(barrier[0]);
  close(3);
  if (pidfd < 0) {
    pidfd = (int)syscall(SYS_pidfd_open, child, 0U);
    if (pidfd < 0) {
      terminate_child(child, -1);
      close(barrier[1]);
      close(release_fd);
      close(executable_fd);
      (void)rmdir(staging);
      return 70;
    }
  }
  if (configure_user_mapping(child, uid, gid) != 0) {
    terminate_child(child, pidfd);
    close(pidfd);
    close(barrier[1]);
    close(release_fd);
    close(executable_fd);
    (void)rmdir(staging);
    fputs("kcml-sandbox-launcher: user namespace mapping failed\n", stderr);
    return 70;
  }
  close(release_fd);
  close(executable_fd);
  if (write(barrier[1], "\1", 1) != 1) {
    terminate_child(child, pidfd);
    close(pidfd);
    close(barrier[1]);
    (void)rmdir(staging);
    fputs("kcml-sandbox-launcher: release namespace mapping barrier failed\n", stderr);
    return 70;
  }
  close(barrier[1]);
  struct pollfd child_exit = { .fd = pidfd, .events = POLLIN };
  int poll_status;
  do {
    poll_status = poll(&child_exit, 1, -1);
  } while (poll_status < 0 && errno == EINTR);
  if (poll_status < 0) {
    terminate_child(child, pidfd);
    close(pidfd);
    (void)rmdir(staging);
    return 70;
  }
  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) {
      close(pidfd);
      (void)rmdir(staging);
      return 70;
    }
  }
  close(pidfd);
  (void)rmdir(staging);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 70;
}
