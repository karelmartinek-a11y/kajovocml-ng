#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Spusťte přes sudo.' >&2; exit 77; }
source /etc/os-release
[[ ${ID} == ubuntu && ${VERSION_ID} == 24.04 ]]
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]]
[[ $(pnpm --version) == 11.* ]]
psql --version | grep -q ' 16\.'
nginx -t
if [[ -e /opt/kajovocml-ng/current ]]; then systemd-analyze verify /etc/systemd/system/kcml*.service /etc/systemd/system/kcml*.socket /etc/systemd/system/kcml.target; fi
test -x /usr/libexec/kajovocml-ng/kcml-peercred
test -x /usr/libexec/kajovocml-ng/kcml-sandbox-launcher
test "$(stat -c %a /etc/kajovocml-ng/master.key)" = 400
test "$(stat -c %a /etc/kajovocml-ng/runtime.env)" = 440
test "$(stat -c %a /etc/kajovocml-ng/deploy.env)" = 400
ss -lnt | awk '{print $4}' | grep -Ev '(^|:)(22|80|443)$|^Local' | grep -q . && echo 'Upozornění: server má i jiné poslouchající TCP porty; bootstrap je nezměnil.' >&2 || true
echo 'PRODUCTION_PREREQUISITES: PASS'
