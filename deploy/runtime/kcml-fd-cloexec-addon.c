#define _GNU_SOURCE

#include <fcntl.h>
#include <node_api.h>
#include <stddef.h>

static napi_value initialize(napi_env environment, napi_value exports) {
  if (fcntl(3, F_SETFD, FD_CLOEXEC) < 0) {
    napi_throw_error(environment, "KCML_FD_CLOEXEC", "capability fd 3 cannot be made close-on-exec");
    return NULL;
  }
  return exports;
}

NAPI_MODULE_INIT() { return initialize(env, exports); }
