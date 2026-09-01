#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Spusťte přes sudo.' >&2; exit 77; fi
repository_root=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
template=${repository_root}/deploy/systemd/kcml-service.service.in
manifest=${repository_root}/deploy/systemd/services.tsv
backup_root=/var/lib/kajovocml-ng/backups/config-$(date -u +%Y%m%dT%H%M%SZ)
install_changed(){ local source=$1 target=$2 mode=${3:-0644}; if [[ -e ${target} ]] && ! cmp -s "${source}" "${target}"; then install -d -m 0700 "${backup_root}"; cp -a "${target}" "${backup_root}/$(basename "${target}")"; fi; install -m "${mode}" "${source}" "${target}"; }
while IFS='|' read -r unit app service_user families writable dependency enabled; do
  [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue
  dependency=${dependency## }; dependency=${dependency%% }
  extra_environment=''
  if [[ ${dependency} == Environment=* ]]; then extra_environment=${dependency}; dependency=''; fi
  # The manifest stores multiple [Unit] directives in one TSV field; render
  # them as separate systemd lines rather than treating `After=` as a socket
  # unit name inside `Requires=`.
  dependency=${dependency// After=/\\nAfter=}
  dependency=${dependency// Wants=/\\nWants=}
  rendered=$(mktemp)
  sed -e "s|{{UNIT}}|${unit}|g" -e "s|{{APP}}|${app}|g" -e "s|{{USER}}|${service_user}|g" \
    -e "s|{{ADDRESS_FAMILIES}}|${families}|g" -e "s|{{READ_WRITE_PATHS}}|${writable}|g" \
    -e "s|{{SOCKET_DEPENDENCIES}}|${dependency}|g" -e "s|{{EXTRA_ENVIRONMENT}}|${extra_environment}|g" "${template}" >"${rendered}"
  install_changed "${rendered}" "/etc/systemd/system/${unit}.service"
  rm -f "${rendered}"
  if [[ ${enabled} == yes ]]; then systemctl enable "${unit}.service" >/dev/null; fi
done <"${manifest}"
for unit in kcml.target kcml-platform-recovery.service kcml-web-api.socket kcml-runtime-gateway.socket kcml-runtime-gateway.service kcml-secret-broker.socket kcml-state-broker.socket kcml-egress-gateway.socket kcml-runtime-host@.service kcml-browser-host@.service kcml-backup.service kcml-backup.timer kcml-tls-renew.service kcml-tls-renew.timer; do install_changed "${repository_root}/deploy/systemd/${unit}" "/etc/systemd/system/${unit}"; done
install_changed "${repository_root}/deploy/tmpfiles/kajovocml-ng.conf" /etc/tmpfiles.d/kajovocml-ng.conf
systemd-tmpfiles --create /etc/tmpfiles.d/kajovocml-ng.conf
systemctl daemon-reload
systemctl enable kcml.target kcml-web-api.socket kcml-runtime-gateway.socket kcml-secret-broker.socket kcml-state-broker.socket kcml-egress-gateway.socket kcml-browser-host@primary.service kcml-backup.timer kcml-tls-renew.timer >/dev/null
if [[ -e /opt/kajovocml-ng/current ]]; then systemd-analyze verify /etc/systemd/system/kcml*.service /etc/systemd/system/kcml*.socket /etc/systemd/system/kcml.target; fi
