#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char **argv) {
  int fd = argc == 2 ? atoi(argv[1]) : 3;
  struct ucred credential;
  socklen_t length = sizeof(credential);
  memset(&credential, 0, sizeof(credential));
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &credential, &length) != 0) {
    fprintf(stderr, "SO_PEERCRED failed: %s\n", strerror(errno));
    return 70;
  }
  if (length != sizeof(credential) || credential.pid <= 0) {
    fputs("SO_PEERCRED returned an invalid identity\n", stderr);
    return 71;
  }
  printf("{\"pid\":%d,\"uid\":%u,\"gid\":%u}\n", credential.pid, credential.uid, credential.gid);
  return 0;
}
