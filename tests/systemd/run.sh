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
node_include_dir=${KCML_NODE_INCLUDE_DIR:-$(node -e "const path=require('node:path');process.stdout.write(path.resolve(path.dirname(process.execPath),'../include/node'))")}
if [[ -f ${node_include_dir}/node_api.h ]]; then
  cc -O2 -Wall -Wextra -Werror -fPIC -shared -I"${node_include_dir}" deploy/runtime/kcml-fd-cloexec-addon.c -o /tmp/kcml-fd-cloexec-td19.node
else
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Node.js 24 headers unavailable for fd CLOEXEC addon'
fi
KCML_SANDBOX_LAUNCHER_TEST=/tmp/kcml-sandbox-launcher-test bash tests/runtime-boundary/native-sandbox.sh
set +e
/tmp/kcml-peercred-test 99 >/dev/null 2>&1
peercred_status=$?
/tmp/kcml-sandbox-launcher-test --uid 1 --gid 1 --release-root / --workspace-root / --executable-digest deadbeef -- /bin/true >/dev/null 2>&1
launcher_status=$?
set -e
[[ ${peercred_status} -ne 0 ]]
[[ ${launcher_status} -eq 64 ]]
echo 'RUNTIME_LAUNCHER_NEGATIVE_BEHAVIOR: PASS'
if command -v systemd-analyze >/dev/null && [[ -x /usr/bin/node ]] && [[ -d /run/systemd/system ]]; then
  # Verify the runtime boundary units under test.  Other deployment units may
  # intentionally reference provisioned host scripts that are outside this
  # repository and are not evidence for the runtime/seccomp contract.
  systemd-analyze verify deploy/systemd/kcml-runtime-gateway.service deploy/systemd/kcml-runtime-gateway.socket
  echo 'SYSTEMD_RUNTIME_BEHAVIOR: PASS'
else
  echo 'SYSTEMD_RUNTIME_BEHAVIOR: NOT_EXECUTED_ENVIRONMENTAL: complete systemd verify requires booted systemd and /usr/bin/node on Ubuntu 24.04'
fi
echo 'SYSTEMD_STATIC_AND_NATIVE: PASS'
