#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/io_uring.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

static int inspect_sandbox(void) {
  struct stat descriptor;
  int socket_type = 0;
  socklen_t socket_type_length = sizeof(socket_type);
  if (getpid() != 1 || getuid() != 0 || getgid() != 0) return 70;
  if (fstat(3, &descriptor) != 0 || !S_ISSOCK(descriptor.st_mode) ||
      getsockopt(3, SOL_SOCKET, SO_TYPE, &socket_type, &socket_type_length) != 0 || socket_type != SOCK_STREAM) return 71;
  const int capability_flags = fcntl(3, F_GETFD);
  if (capability_flags < 0 || (capability_flags & FD_CLOEXEC) != 0) return 72;
  errno = 0;
  if (fstat(4, &descriptor) == 0 || errno != EBADF) return 73;
  errno = 0;
  const int sys_fd = open("/sys", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (sys_fd >= 0) {
    close(sys_fd);
    return 74;
  }
  if (errno != ENOENT) return 74;
  errno = 0;
  const int host_run_fd = open("/run/kajovocml-ng", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (host_run_fd >= 0) {
    close(host_run_fd);
    return 75;
  }
  if (errno != ENOENT) return 75;
  const int writable = open("/work/td19-write-check", O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0600);
  if (writable < 0) return 76;
  close(writable);
  if (unlink("/work/td19-write-check") != 0) return 77;
  errno = 0;
  const int read_only = open("/runtime/td19-write-check", O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, 0600);
  if (read_only >= 0) {
    close(read_only);
    unlink("/runtime/td19-write-check");
    return 78;
  }
  if (errno != EROFS && errno != EACCES) return 79;
  const char message[] = "SANDBOX_INSPECT_PASS\n";
  return write(STDOUT_FILENO, message, sizeof(message) - 1) == (ssize_t)(sizeof(message) - 1) ? 0 : 80;
}

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  if (strcmp(argv[1], "inspect") == 0) return inspect_sandbox();
  if (strcmp(argv[1], "allow") == 0) {
    const char message[] = "SANDBOX_ALLOW_PASS\n";
    if (write(STDOUT_FILENO, message, sizeof(message) - 1) != (ssize_t)(sizeof(message) - 1)) return 65;
    return getpid() > 0 ? 0 : 66;
  }
  if (strcmp(argv[1], "deny") == 0) {
    /* socket is intentionally absent from the generated-handler BPF allowlist. */
    (void)socket(AF_UNIX, SOCK_STREAM, 0);
    return errno == EPERM ? 67 : 68;
  }
  if (strcmp(argv[1], "io_uring") == 0) {
    struct io_uring_params parameters;
    memset(&parameters, 0, sizeof(parameters));
    errno = 0;
    const int ring = (int)syscall(SYS_io_uring_setup, 1U, &parameters);
    if (ring >= 0) {
      close(ring);
      return 69;
    }
    const char message[] = "SANDBOX_DENY_IO_URING_PASS\n";
    return errno == EPERM && write(STDOUT_FILENO, message, sizeof(message) - 1) == (ssize_t)(sizeof(message) - 1) ? 0 : 70;
  }
  return 64;
}
