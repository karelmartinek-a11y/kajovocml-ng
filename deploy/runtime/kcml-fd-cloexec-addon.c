#define _GNU_SOURCE
#include <fcntl.h>
#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <unistd.h>

static int fd_argument(napi_env environment, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  int32_t fd = -1;
  if (napi_get_cb_info(environment, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1 ||
      napi_get_value_int32(environment, argv[0], &fd) != napi_ok || fd < 0) {
    napi_throw_type_error(environment, "KCML_FD_ARGUMENT", "a non-negative file descriptor is required");
    return -1;
  }
  return fd;
}

static void set_named_bool(napi_env environment, napi_value object, const char *name, int value) {
  napi_value item;
  if (napi_get_boolean(environment, value != 0, &item) != napi_ok || napi_set_named_property(environment, object, name, item) != napi_ok)
    napi_throw_error(environment, "KCML_NATIVE_EXPORT", "boolean socket metadata cannot be exported");
}

static void set_named_string(napi_env environment, napi_value object, const char *name, const char *value) {
  napi_value item;
  if (napi_create_string_utf8(environment, value, NAPI_AUTO_LENGTH, &item) != napi_ok || napi_set_named_property(environment, object, name, item) != napi_ok)
    napi_throw_error(environment, "KCML_NATIVE_EXPORT", "string socket metadata cannot be exported");
}

static void set_named_bigint(napi_env environment, napi_value object, const char *name, uint64_t value) {
  napi_value item;
  if (napi_create_bigint_uint64(environment, value, &item) != napi_ok || napi_set_named_property(environment, object, name, item) != napi_ok)
    napi_throw_error(environment, "KCML_NATIVE_EXPORT", "integer socket metadata cannot be exported");
}

static napi_value set_fd_cloexec(napi_env environment, napi_callback_info info) {
  int fd = fd_argument(environment, info);
  if (fd < 0) return NULL;
  int flags = fcntl(fd, F_GETFD);
  if (flags < 0 || fcntl(fd, F_SETFD, flags | FD_CLOEXEC) < 0) {
    napi_throw_error(environment, "KCML_FD_CLOEXEC", "file descriptor cannot be made close-on-exec");
    return NULL;
  }
  napi_value result;
  if (napi_get_undefined(environment, &result) != napi_ok) return NULL;
  return result;
}

static napi_value inspect_socket_fd(napi_env environment, napi_callback_info info) {
  int fd = fd_argument(environment, info);
  if (fd < 0) return NULL;
  int socket_type = 0;
  int accepting = 0;
  socklen_t option_length = sizeof(int);
  struct sockaddr_un address;
  socklen_t address_length = sizeof(address);
  struct stat metadata;
  memset(&address, 0, sizeof(address));
  if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &socket_type, &option_length) < 0 ||
      getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &accepting, &option_length) < 0 ||
      getsockname(fd, (struct sockaddr *)&address, &address_length) < 0 || fstat(fd, &metadata) < 0) {
    napi_throw_error(environment, "KCML_SOCKET_METADATA", "socket metadata cannot be read");
    return NULL;
  }
  int status_flags = fcntl(fd, F_GETFL);
  int descriptor_flags = fcntl(fd, F_GETFD);
  if (status_flags < 0 || descriptor_flags < 0) {
    napi_throw_error(environment, "KCML_SOCKET_FLAGS", "socket flags cannot be read");
    return NULL;
  }
  napi_value result;
  if (napi_create_object(environment, &result) != napi_ok) return NULL;
  set_named_string(environment, result, "family", address.sun_family == AF_UNIX ? "AF_UNIX" : "OTHER");
  set_named_string(environment, result, "socketType", socket_type == SOCK_STREAM ? "SOCK_STREAM" : "OTHER");
  set_named_bool(environment, result, "accepting", accepting);
  set_named_bool(environment, result, "nonBlocking", status_flags & O_NONBLOCK);
  set_named_bool(environment, result, "closeOnExec", descriptor_flags & FD_CLOEXEC);
  set_named_bigint(environment, result, "device", (uint64_t)metadata.st_dev);
  set_named_bigint(environment, result, "inode", (uint64_t)metadata.st_ino);
  if (address.sun_family == AF_UNIX && address.sun_path[0] != '\0') set_named_string(environment, result, "localPath", address.sun_path);
  else set_named_string(environment, result, "localPath", "");
  return result;
}

static napi_value open_pidfd(napi_env environment, napi_callback_info info) {
  int pid = fd_argument(environment, info);
  if (pid <= 0) return NULL;
#ifdef SYS_pidfd_open
  int pidfd = (int)syscall(SYS_pidfd_open, pid, 0);
  if (pidfd < 0 || fcntl(pidfd, F_SETFD, FD_CLOEXEC) < 0 || fcntl(pidfd, F_SETFL, fcntl(pidfd, F_GETFL) | O_NONBLOCK) < 0) {
    if (pidfd >= 0) (void)close(pidfd);
    napi_throw_error(environment, "KCML_PIDFD_OPEN", "peer process cannot be pinned with pidfd");
    return NULL;
  }
  napi_value result;
  if (napi_create_int32(environment, pidfd, &result) != napi_ok) { (void)close(pidfd); return NULL; }
  return result;
#else
  napi_throw_error(environment, "KCML_PIDFD_UNSUPPORTED", "pidfd_open is required by the runtime boundary");
  return NULL;
#endif
}

static napi_value create_socket_pair(napi_env environment, napi_callback_info info) {
  (void)info;
  int descriptors[2] = {-1, -1};
  int socket_type = SOCK_STREAM;
#ifdef SOCK_CLOEXEC
  socket_type |= SOCK_CLOEXEC;
#endif
#ifdef SOCK_NONBLOCK
  socket_type |= SOCK_NONBLOCK;
#endif
  if (socketpair(AF_UNIX, socket_type, 0, descriptors) < 0 ||
      fcntl(descriptors[0], F_SETFD, FD_CLOEXEC) < 0 || fcntl(descriptors[1], F_SETFD, FD_CLOEXEC) < 0 ||
      fcntl(descriptors[0], F_SETFL, fcntl(descriptors[0], F_GETFL) | O_NONBLOCK) < 0 ||
      fcntl(descriptors[1], F_SETFL, fcntl(descriptors[1], F_GETFL) | O_NONBLOCK) < 0) {
    if (descriptors[0] >= 0) (void)close(descriptors[0]);
    if (descriptors[1] >= 0) (void)close(descriptors[1]);
    napi_throw_error(environment, "KCML_SOCKETPAIR_CREATE", "anonymous capability socketpair cannot be created");
    return NULL;
  }
  napi_value result, host, child;
  if (napi_create_array_with_length(environment, 2, &result) != napi_ok || napi_create_int32(environment, descriptors[0], &host) != napi_ok ||
      napi_create_int32(environment, descriptors[1], &child) != napi_ok || napi_set_element(environment, result, 0, host) != napi_ok || napi_set_element(environment, result, 1, child) != napi_ok) {
    (void)close(descriptors[0]); (void)close(descriptors[1]);
    napi_throw_error(environment, "KCML_SOCKETPAIR_EXPORT", "anonymous capability socketpair cannot be exported");
    return NULL;
  }
  return result;
}

static napi_value initialize(napi_env environment, napi_value exports) {
  if (getenv("KCML_CONTEXT_FD") != NULL && fcntl(3, F_SETFD, FD_CLOEXEC) < 0) {
    napi_throw_error(environment, "KCML_FD_CLOEXEC", "capability fd 3 cannot be made close-on-exec");
    return NULL;
  }
  struct { const char *name; napi_callback callback; } functions[] = {
    {"createSocketPair", create_socket_pair}, {"setFdCloexec", set_fd_cloexec}, {"inspectSocketFd", inspect_socket_fd}, {"openPidfd", open_pidfd}
  };
  for (size_t i = 0; i < sizeof(functions) / sizeof(functions[0]); i++) {
    napi_value function;
    if (napi_create_function(environment, functions[i].name, NAPI_AUTO_LENGTH, functions[i].callback, NULL, &function) != napi_ok ||
        napi_set_named_property(environment, exports, functions[i].name, function) != napi_ok) {
      napi_throw_error(environment, "KCML_NATIVE_EXPORT", "native runtime function cannot be exported");
      return NULL;
    }
  }
  return exports;
}

NAPI_MODULE_INIT() { return initialize(env, exports); }
