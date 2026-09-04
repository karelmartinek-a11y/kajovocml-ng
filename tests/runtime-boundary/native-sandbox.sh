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
if ! command -v python3 >/dev/null; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native sandbox test requires python3 for an inherited socketpair fixture'
  exit 0
fi
if [[ "$(id -u)" == 0 || "$(id -g)" == 0 ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: native sandbox test requires a non-root runtime-host identity for UID/GID mapping'
  exit 0
fi

launcher="${KCML_SANDBOX_LAUNCHER_TEST:-/tmp/kcml-sandbox-launcher-td19}"
probe="${KCML_SANDBOX_PROBE_TEST:-/tmp/kcml-sandbox-probe-td19}"
cc -O2 -Wall -Wextra -Werror deploy/runtime/kcml-sandbox-launcher.c -lcrypto -o "$launcher"
if ! cc -static -O2 -Wall -Wextra -Werror deploy/runtime/kcml-sandbox-probe.c -o "$probe" 2>/tmp/kcml-sandbox-probe-build.err; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Ubuntu static libc fixture is unavailable'
  exit 0
fi
if [[ ! -r /usr/include/node/node_api.h ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Node.js 24 development headers are unavailable for the bootstrap fixture'
  exit 0
fi

release=$(mktemp -d)
workspace=$(mktemp -d)
cleanup() { rm -rf "$release" "$workspace"; }
trap cleanup EXIT
install -d "$release/bin" "$release/deploy/runtime"
cp "$probe" "$release/probe"
cp /usr/bin/node "$release/bin/node"
ldd /usr/bin/node | sed -n 's/.*=> \(\/[^ ]*\).*/\1/p; s/^[[:space:]]*\(\/[^ ]*\).*/\1/p' | sort -u | while IFS= read -r library; do
  [[ -f "$library" ]] && cp --parents "$library" "$release"
done
cp deploy/runtime/kcml-node-bootstrap.mjs "$release/deploy/runtime/kcml-node-bootstrap.mjs"
if ! cc -O2 -Wall -Wextra -Werror -fPIC -shared -I/usr/include/node deploy/runtime/kcml-fd-cloexec-addon.c \
    -o "$release/deploy/runtime/kcml-fd-cloexec.node"; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: Node.js 24 addon toolchain is unavailable'
  exit 0
fi
/usr/bin/node -e 'const net=require("node:net");const addon=require(process.argv[1]);const fds=addon.createSocketPair();if(!Array.isArray(fds)||fds.length!==2||fds[0]===fds[1])throw new Error("SOCKETPAIR_IDENTITY_INVALID");const host=new net.Socket({fd:fds[0],readable:true,writable:true});const child=new net.Socket({fd:fds[1],readable:true,writable:true});child.once("data",value=>{if(value.toString()!=="KCML_SOCKETPAIR_PROBE")process.exitCode=1;host.destroy();child.destroy();});host.write("KCML_SOCKETPAIR_PROBE");' "$release/deploy/runtime/kcml-fd-cloexec.node"
echo 'ANONYMOUS_SOCKETPAIR_PASS'
cp tests/runtime-boundary/fixtures/node-handler.mjs "$release/runtime-handler.mjs"
chmod 0755 "$release"
chmod 0555 "$release/probe"
probe_digest=$(sha256sum "$release/probe" | awk '{print $1}')
node_digest=$(sha256sum "$release/bin/node" | awk '{print $1}')

run_sandbox() {
  local digest=$1
  shift
  python3 - "$launcher" --uid "$(id -u)" --gid "$(id -g)" --release-root "$release" --workspace-root "$workspace" \
    --socket-directory "$workspace/socket" --timeout-ms 5000 --capability-fd 3 --executable-digest "sha256:$digest" "$@" <<'PY'
import os
import socket
import sys

host_end, child_end = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
child_pid = os.fork()
if child_pid == 0:
    host_end.close()
    os.dup2(child_end.fileno(), 3, inheritable=True)
    child_end.close()
    os.execv(sys.argv[1], sys.argv[1:])
child_end.close()
_, status = os.waitpid(child_pid, 0)
host_end.close()
if os.WIFEXITED(status):
    raise SystemExit(os.WEXITSTATUS(status))
raise SystemExit(128 + os.WTERMSIG(status))
PY
}

set +e
inspect_output=$(run_sandbox "$probe_digest" -- "$release/probe" inspect 2>/tmp/kcml-sandbox-inspect-td19.err)
inspect_status=$?
set -e
if [[ "$inspect_status" -eq 70 ]] && grep -Eq 'clone3 namespace setup|user namespace mapping failed|mount private tmpfs|pivot private root|trusted executable fd exceeds|raise descriptor limit|Operation not permitted|Function not implemented' /tmp/kcml-sandbox-inspect-td19.err; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: kernel or service policy does not permit the required sandbox primitives'
  exit 0
fi
if [[ "$inspect_status" -ne 0 ]]; then
  cat /tmp/kcml-sandbox-inspect-td19.err >&2
  echo "sandbox inspect returned $inspect_status" >&2
  exit 1
fi
grep -qx 'SANDBOX_INSPECT_PASS' <<<"$inspect_output"

allow_output=$(run_sandbox "$probe_digest" -- "$release/probe" allow)
grep -qx 'SANDBOX_ALLOW_PASS' <<<"$allow_output"

set +e
run_sandbox "$probe_digest" -- "$release/probe" deny >/tmp/kcml-sandbox-deny-td19.out 2>/tmp/kcml-sandbox-deny-td19.err
deny_status=$?
set -e
if [[ "$deny_status" -ne 159 ]]; then
  echo "seccomp deny probe returned $deny_status, expected SIGSYS (159)" >&2
  cat /tmp/kcml-sandbox-deny-td19.err >&2
  exit 1
fi
echo 'SANDBOX_DENY_SOCKET_PASS'

io_uring_output=$(run_sandbox "$probe_digest" -- "$release/probe" io_uring)
grep -qx 'SANDBOX_DENY_IO_URING_PASS' <<<"$io_uring_output"
echo 'SANDBOX_DENY_IO_URING_PASS'

set +e
node_output=$(run_sandbox "$node_digest" --bootstrap "$release/deploy/runtime/kcml-node-bootstrap.mjs" \
  --handler-entrypoint "$release/runtime-handler.mjs" -- "$release/bin/node" 2>/tmp/kcml-sandbox-node-td19.err)
node_status=$?
set -e
if [[ "$node_status" -eq 70 ]] && grep -Eq 'mount private tmpfs|pivot private root|Operation not permitted|Function not implemented' /tmp/kcml-sandbox-node-td19.err; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: kernel or service policy does not permit the Node bootstrap sandbox fixture'
  exit 0
fi
if [[ "$node_status" -ne 0 ]]; then
  cat /tmp/kcml-sandbox-node-td19.err >&2
  echo "Node bootstrap returned $node_status" >&2
  exit 1
fi
grep -qx 'NODE_BOOTSTRAP_PASS' <<<"$node_output"
echo 'NODE_BOOTSTRAP_PASS'
