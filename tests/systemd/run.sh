#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native systemd/seccomp verification requires Linux';
  exit 0
fi
for file in deploy/systemd/*.service deploy/systemd/*.socket deploy/systemd/*.target; do
  grep -Eq '^\[(Unit|Socket)\]' "$file"
done
cc -O2 -Wall -Wextra -Werror deploy/runtime/kcml-peercred.c -o /tmp/kcml-peercred-test
cc -O2 -Wall -Wextra -Werror deploy/runtime/kcml-sandbox-launcher.c -lcrypto -o /tmp/kcml-sandbox-launcher-test
if [[ -f /usr/include/node/node_api.h ]]; then
  cc -O2 -Wall -Wextra -Werror -fPIC -shared -I/usr/include/node deploy/runtime/kcml-fd-cloexec-addon.c -o /tmp/kcml-fd-cloexec-td19.node
else
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Node.js 24 headers unavailable for fd CLOEXEC addon'
fi
KCML_SANDBOX_LAUNCHER_TEST=/tmp/kcml-sandbox-launcher-test bash tests/runtime-boundary/native-sandbox.sh
if command -v systemd-analyze >/dev/null && [[ -x /usr/bin/node ]] && [[ -d /run/systemd/system ]]; then
  systemd-analyze verify deploy/systemd/*.socket deploy/systemd/*.target deploy/systemd/kcml-runtime-host@.service deploy/systemd/kcml-browser-host@.service
else
  echo 'NOT_EXECUTED_ENVIRONMENTAL: complete systemd verify requires booted systemd and /usr/bin/node on Ubuntu 24.04'
fi
echo 'SYSTEMD_STATIC_AND_NATIVE: PASS'
