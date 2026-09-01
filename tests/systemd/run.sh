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
  systemd-analyze verify deploy/systemd/*.service deploy/systemd/*.socket deploy/systemd/*.target
  echo 'SYSTEMD_RUNTIME_BEHAVIOR: PASS'
else
  echo 'SYSTEMD_RUNTIME_BEHAVIOR: NOT_EXECUTED_ENVIRONMENTAL: complete systemd verify requires booted systemd and /usr/bin/node on Ubuntu 24.04'
fi
echo 'SYSTEMD_STATIC_AND_NATIVE: PASS'
