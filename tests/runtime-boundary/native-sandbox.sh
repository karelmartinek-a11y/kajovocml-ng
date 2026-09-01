#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native namespace/seccomp tests require Linux Ubuntu 24.04'
  exit 0
fi
if [[ ! -r /etc/os-release ]] || ! grep -qx 'ID=ubuntu' /etc/os-release || ! grep -qx 'VERSION_ID="24.04"' /etc/os-release || [[ ! -d /run/systemd/system ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native namespace/seccomp tests require Ubuntu 24.04 with booted systemd'
  exit 0
fi
if [[ ! -x /usr/bin/node ]] || [[ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" != 24 ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native sandbox test requires Node.js 24 runtime'
  exit 0
fi

launcher="${KCML_SANDBOX_LAUNCHER_TEST:-/tmp/kcml-sandbox-launcher-td19}"
probe="${KCML_SANDBOX_PROBE_TEST:-/tmp/kcml-sandbox-probe-td19}"
cc -O2 -Wall -Wextra -Werror deploy/runtime/kcml-sandbox-launcher.c -lcrypto -o "$launcher"
if ! cc -static -O2 -Wall -Wextra -Werror deploy/runtime/kcml-sandbox-probe.c -o "$probe" 2>/tmp/kcml-sandbox-probe-build.err; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Ubuntu static libc fixture is unavailable'
  exit 0
fi

release=$(mktemp -d)
workspace=$(mktemp -d)
cleanup() { rm -rf "$release" "$workspace"; }
trap cleanup EXIT
cp "$probe" "$release/probe"
chmod 0555 "$release/probe"
digest=$(sha256sum "$release/probe" | awk '{print $1}')

run_sandbox() {
  "$launcher" --uid "$(id -u)" --gid "$(id -g)" --release-root "$release" --workspace-root "$workspace" \
    --socket-directory "$workspace/socket" --timeout-ms 5000 --executable-digest "sha256:$digest" -- "$release/probe" "$1"
}

allow_output=$(run_sandbox allow)
grep -qx 'SANDBOX_ALLOW_PASS' <<<"$allow_output"

set +e
run_sandbox deny >/tmp/kcml-sandbox-deny-td19.out 2>/tmp/kcml-sandbox-deny-td19.err
deny_status=$?
set -e
if [[ "$deny_status" -ne 159 ]]; then
  echo "seccomp deny probe returned $deny_status, expected SIGSYS (159)" >&2
  cat /tmp/kcml-sandbox-deny-td19.err >&2
  exit 1
fi
echo 'SANDBOX_DENY_SOCKET_PASS'
