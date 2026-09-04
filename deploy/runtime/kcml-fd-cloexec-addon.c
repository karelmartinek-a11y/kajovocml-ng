#define _GNU_SOURCE

#include <fcntl.h>
#include <node_api.h>
#include <stddef.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <unistd.h>

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
      fcntl(descriptors[0], F_SETFD, FD_CLOEXEC) < 0 ||
      fcntl(descriptors[1], F_SETFD, FD_CLOEXEC) < 0 ||
      fcntl(descriptors[0], F_SETFL, fcntl(descriptors[0], F_GETFL) | O_NONBLOCK) < 0 ||
      fcntl(descriptors[1], F_SETFL, fcntl(descriptors[1], F_GETFL) | O_NONBLOCK) < 0) {
    if (descriptors[0] >= 0) (void)close(descriptors[0]);
    if (descriptors[1] >= 0) (void)close(descriptors[1]);
    napi_throw_error(environment, "KCML_SOCKETPAIR_CREATE", "anonymous capability socketpair cannot be created");
    return NULL;
  }
  napi_value result;
  napi_value host;
  napi_value child;
  if (napi_create_array_with_length(environment, 2, &result) != napi_ok ||
      napi_create_int32(environment, descriptors[0], &host) != napi_ok ||
      napi_create_int32(environment, descriptors[1], &child) != napi_ok ||
      napi_set_element(environment, result, 0, host) != napi_ok ||
      napi_set_element(environment, result, 1, child) != napi_ok) {
    (void)close(descriptors[0]);
    (void)close(descriptors[1]);
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
  napi_value function;
  if (napi_create_function(environment, "createSocketPair", NAPI_AUTO_LENGTH, create_socket_pair, NULL, &function) != napi_ok ||
      napi_set_named_property(environment, exports, "createSocketPair", function) != napi_ok) {
    napi_throw_error(environment, "KCML_SOCKETPAIR_EXPORT", "createSocketPair export cannot be initialized");
    return NULL;
  }
  return exports;
}

NAPI_MODULE_INIT() { return initialize(env, exports); }
