#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${EUID} -ne 0 ]]; then echo 'Spusťte přes sudo.' >&2; exit 77; fi
repository_root=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
template=${repository_root}/deploy/systemd/kcml-service.service.in
manifest=${repository_root}/deploy/systemd/services.tsv
security_manifest=${repository_root}/deploy/security/service-capabilities.tsv
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
  security_row=$(awk -F'|' -v unit="${unit}" '$1==unit {print; found++} END {if(found!=1) exit 1}' "${security_manifest}") || { echo "Chybí právě jeden security catalog row pro ${unit}." >&2; exit 78; }
  IFS='|' read -r security_unit primary_group supplementary_groups database_role credential_names read_only_paths <<<"${security_row}"
  [[ ${security_unit} == "${unit}" && -n ${primary_group} && -n ${database_role} && -n ${credential_names} && -n ${read_only_paths} ]] || { echo "Neplatný security catalog row pro ${unit}." >&2; exit 78; }
  supplementary_directive=''
  [[ -n ${supplementary_groups} ]] && supplementary_directive="SupplementaryGroups=${supplementary_groups}"
  load_credentials=''; credential_environment=''
  IFS=',' read -ra credentials <<<"${credential_names}"
  for credential in "${credentials[@]}"; do
    [[ ${credential} =~ ^[a-z][a-z0-9-]{0,63}$ ]] || { echo "Neplatný credential ${credential} pro ${unit}." >&2; exit 78; }
    credential_source="/etc/kajovocml-ng/credentials/${unit}/${credential}"
    [[ ${credential} == master-key ]] && credential_source=/etc/kajovocml-ng/master.key
    load_credentials+="LoadCredential=${credential}:${credential_source}"$'\\n'
    case ${credential} in
      database-url) credential_environment+="Environment=KCML_DATABASE_URL_FILE=%d/database-url"$'\\n' ;;
      master-key) credential_environment+="Environment=KCML_MASTER_KEY_FILE=%d/master-key"$'\\n' ;;
    esac
  done
  load_credentials=${load_credentials%$'\\n'}; credential_environment=${credential_environment%$'\\n'}
  rendered=$(mktemp)
  sed -e "s|{{UNIT}}|${unit}|g" -e "s|{{APP}}|${app}|g" -e "s|{{USER}}|${service_user}|g" \
    -e "s|{{GROUP}}|${primary_group}|g" -e "s|{{SUPPLEMENTARY_GROUPS}}|${supplementary_directive}|g" \
    -e "s|{{LOAD_CREDENTIALS}}|${load_credentials}|g" -e "s|{{CREDENTIAL_ENVIRONMENT}}|${credential_environment}|g" \
    -e "s|{{READ_ONLY_PATHS}}|${read_only_paths}|g" \
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
# Retire the pre-NG certificate timer after the NG timer is durably enabled.
# Leaving both active creates competing Certbot locks and a stale failed unit.
if systemctl list-unit-files kcml-canonical-tls-renew.timer --no-legend 2>/dev/null | grep -q '^kcml-canonical-tls-renew.timer'; then
  systemctl disable --now kcml-canonical-tls-renew.timer >/dev/null
  systemctl reset-failed kcml-canonical-tls-renew.service 2>/dev/null || true
fi
if [[ -e /opt/kajovocml-ng/current ]]; then systemd-analyze verify /etc/systemd/system/kcml*.service /etc/systemd/system/kcml*.socket /etc/systemd/system/kcml.target; fi
