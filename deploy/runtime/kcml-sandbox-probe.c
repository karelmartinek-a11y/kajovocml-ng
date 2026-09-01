#define _GNU_SOURCE

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
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
  return 64;
}
