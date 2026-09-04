#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Rollback musí běžet přes sudo.' >&2; exit 77; }
release_path='';failed_release='';while (($#));do case "$1" in --release-path)release_path=$2;shift 2;;--failed-release)failed_release=$2;shift 2;;*)exit 64;;esac;done
[[ ${release_path} == /opt/kajovocml-ng/releases/* && -d ${release_path} ]]||{ echo 'Neplatná rollback release path.' >&2;exit 64; }
source /etc/kajovocml-ng/deploy.env;source /etc/kajovocml-ng/runtime.env;export DATABASE_URL
release_id=$(<"${release_path}/RELEASE_ID");source_sha=$(<"${release_path}/SOURCE_SHA");deployment_id=$(cat /proc/sys/kernel/random/uuid)
if grep -q 'KCML_DATABASE_URL_FILE=%d/database-url' "${release_path}/deploy/systemd/kcml-service.service.in";then
  sed -i -E '/^(DATABASE_URL|KCML_MASTER_KEY_FILE)=/d' /etc/kajovocml-ng/runtime.env
  chown root:kcml-release-readers /etc/kajovocml-ng/runtime.env;chmod 0440 /etc/kajovocml-ng/runtime.env
  chown root:root /etc/kajovocml-ng/master.key;chmod 0400 /etc/kajovocml-ng/master.key
else
  sed -i -E '/^(DATABASE_URL|KCML_MASTER_KEY_FILE)=/d' /etc/kajovocml-ng/runtime.env
  printf 'DATABASE_URL=%s\nKCML_MASTER_KEY_FILE=/etc/kajovocml-ng/master.key\n' "${DATABASE_URL}" >>/etc/kajovocml-ng/runtime.env
  chown root:kcml-release-readers /etc/kajovocml-ng/runtime.env;chmod 0440 /etc/kajovocml-ng/runtime.env
  chown root:kcml-platform /etc/kajovocml-ng/master.key;chmod 0440 /etc/kajovocml-ng/master.key
fi
"${release_path}/deploy/scripts/install-systemd.sh" "${release_path}"
epoch=$(psql "${DATABASE_URL}" -Atqc "UPDATE kcml.application_deployment_head SET current_epoch=current_epoch+1,current_release_id='${release_id}',source_sha='${source_sha}',deployment_id='${deployment_id}',state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 RETURNING current_epoch")
sed -i -E "s/^KCML_RELEASE_ID=.*/KCML_RELEASE_ID=${release_id}/;s/^KCML_SOURCE_SHA=.*/KCML_SOURCE_SHA=${source_sha}/;s/^KCML_DEPLOYMENT_EPOCH=.*/KCML_DEPLOYMENT_EPOCH=${epoch}/" /etc/kajovocml-ng/runtime.env
nginx_target=/etc/nginx/sites-available/kajovocml-ng.conf;nginx_backup=$(mktemp);cp "${nginx_target}" "${nginx_backup}";install -o root -g root -m 0644 "${release_path}/deploy/nginx/kajovocml-ng.conf" "${nginx_target}";if ! nginx -t;then install -o root -g root -m 0644 "${nginx_backup}" "${nginx_target}";rm -f "${nginx_backup}";exit 1;fi;rm -f "${nginx_backup}"
ln -s "${release_path}" /opt/kajovocml-ng/current.rollback;mv -Tf /opt/kajovocml-ng/current.rollback /opt/kajovocml-ng/current
systemctl daemon-reload;systemctl restart kcml-platform-recovery.service;systemctl restart kcml.target;while IFS='|' read -r unit app user families writable dependency enabled;do [[ ${enabled} == yes ]]&&systemctl restart "${unit}.service";done <"${release_path}/deploy/systemd/services.tsv";systemctl restart kcml-browser-host@primary.service;systemctl reload nginx
for attempt in {1..45};do result=$(curl --silent --unix-socket /run/kajovocml-ng/web-api.sock http://localhost/ready||true);jq -e '.status=="ready"'<<<"${result}">/dev/null&&break;sleep 2;done
jq -e '.status=="ready"'<<<"${result}">/dev/null
if [[ -n ${failed_release} ]]; then
  psql "${DATABASE_URL}" -v failed_release="${failed_release}" >/dev/null <<'SQL'
UPDATE kcml.deployment_run SET status='ROLLED_BACK',current_step='ROLLBACK_VERIFIED',completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE release_id=:'failed_release' AND status IN('FAILED','ROLLING_BACK');
SQL
fi
echo "ROLLBACK STATUS: PASS current=${release_id} failed=${failed_release:-manual} epoch=${epoch}"
