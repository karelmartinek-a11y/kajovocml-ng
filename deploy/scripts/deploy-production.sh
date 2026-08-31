#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Deployment musí běžet přes sudo.' >&2; exit 77; }
bundle=''; signature=''; expected_sha=''; release_id='';
while (($#)); do case "$1" in --bundle) bundle=$2;shift 2;;--signature) signature=$2;shift 2;;--source-sha) expected_sha=$2;shift 2;;--release-id) release_id=$2;shift 2;;*) echo "Neznámý argument $1" >&2;exit 64;;esac; done
[[ -f ${bundle} && -f ${signature} && ${expected_sha} =~ ^[0-9a-f]{40}$ && ${release_id} =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Neplatné deployment parametry.' >&2; exit 64; }
IFS= read -r pass_value
[[ -n ${pass_value} ]] || { echo 'PASS nebyl dodán přes standardní vstup.' >&2; exit 65; }
source /etc/kajovocml-ng/runtime.env
export DATABASE_URL KCML_MASTER_KEY_FILE KCML_MASTER_KEY_ID
release_path=/opt/kajovocml-ng/releases/${release_id}; previous_path=$(readlink -f /opt/kajovocml-ng/current 2>/dev/null || true); previous_release=''
[[ -n ${previous_path} ]] && previous_release=$(basename "${previous_path}")
deployment_id=$(cat /proc/sys/kernel/random/uuid); stage_path=/opt/kajovocml-ng/releases/.incoming-${release_id}-${deployment_id}; started_ns=$(date +%s%N); rolling_back=0
log_step(){ local name=$1 start=$2 result=$3; local elapsed=$((($(date +%s%N)-start)/1000000)); printf '{"step":"%s","elapsedMs":%d,"result":"%s"}\n' "${name}" "${elapsed}" "${result}"; }
record_step(){ local name=$1 result=$2 elapsed=$3;psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -v deployment_id="${deployment_id}" -v step="${name}" -v result="${result}" -v elapsed="${elapsed}" -c "UPDATE kcml.deployment_run SET current_step=:'step',evidence=evidence||jsonb_build_object(:'step',jsonb_build_object('result',:'result','elapsedMs',(:'elapsed')::bigint,'at',clock_timestamp())),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=:'deployment_id'::uuid" >/dev/null;}
run_step(){ local name=$1;shift;local start=$(date +%s%N);"$@";local elapsed=$((($(date +%s%N)-start)/1000000));log_step "${name}" "${start}" PASS;if psql "${DATABASE_URL}" -Atqc "SELECT to_regclass('kcml.deployment_run') IS NOT NULL" 2>/dev/null|grep -qx t;then record_step "${name}" PASS "${elapsed}";fi; }
fail(){ local status=$?; trap - ERR; unset pass_value;rm -rf -- "${stage_path}" 2>/dev/null||true;psql "${DATABASE_URL}" -v deployment_id="${deployment_id}" -v status="${status}" -c "UPDATE kcml.deployment_run SET status='FAILED',evidence=evidence||jsonb_build_object('failureExit',(:'status')::int),completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=:'deployment_id'::uuid" >/dev/null 2>&1||true; if [[ ${rolling_back} -eq 0 && -n ${previous_path} && -d ${previous_path} ]]; then rolling_back=1; /opt/kajovocml-ng/current/deploy/scripts/rollback-production.sh --release-path "${previous_path}" --failed-release "${release_id}" || true; fi; echo "DEPLOYMENT FAILED exit=${status}" >&2; exit "${status}"; }
trap fail ERR
verify_bundle(){ minisign -Vm "${bundle}" -x "${signature}" -p /etc/kajovocml-ng/release-signing.pub >/dev/null;(cd "$(dirname "${bundle}")"&&sha256sum --check "$(basename "${bundle}").sha256"); }
create_backup(){ local path=/var/lib/kajovocml-ng/backups/pre-${release_id}-$(date -u +%Y%m%dT%H%M%SZ);install -d -o root -g kcml-platform -m 0700 "${path}";pg_dump --format=custom --file="${path}/database.dump" "${DATABASE_URL}";tar -C /etc -czf "${path}/configuration.tar.gz" kajovocml-ng;sha256sum "${path}"/* >"${path}/SHA256SUMS"; }
stage_release(){ [[ ! -e ${release_path} && ! -e ${stage_path} ]] || { echo 'Release ID již existuje.' >&2; return 1; };install -d -m 0755 "${stage_path}";tar -xzf "${bundle}" -C "${stage_path}" --strip-components=1;grep -qx "${expected_sha}" "${stage_path}/SOURCE_SHA";grep -qx "${release_id}" "${stage_path}/RELEASE_ID";(cd "${stage_path}"&&sha256sum -c FILES.sha256); }
install_release(){ mv "${stage_path}" "${release_path}";chown -R root:root "${release_path}";find "${release_path}" -type d -exec chmod a-w {} +;find "${release_path}" -type f -exec chmod a-w {} +;"${release_path}/deploy/scripts/install-systemd.sh" "${release_path}"; }
preflight(){ node --version|grep -q '^v24\.';pnpm --version|grep -q '^11\.';psql "${DATABASE_URL}" -Atqc 'SELECT current_setting('"'"'server_version_num'"'"')::int >= 160000';test -s /etc/kajovocml-ng/master.key;nginx -t; }
reconcile_platform(){
  test "$(stat -c %a /etc/kajovocml-ng/master.key)" = 440
  test "$(stat -c %a /etc/kajovocml-ng/runtime.env)" = 640
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -Atqc "SELECT
    (SELECT count(*) FROM kcml.platform_incarnation)=1 AND
    (SELECT count(*) FROM kcml.application_deployment_head)=1 AND
    (SELECT count(*) FROM kcml.activation_head)=1 AND
    (SELECT count(*) FROM kcml.owner_identity WHERE username='KRMAR78')=1 AND
    (SELECT count(*) FROM kcml.owner_api_credential)=1" | grep -qx t
  install -d -o root -g kcml-platform -m 0770 /var/lib/kajovocml-ng/data /var/lib/kajovocml-ng/generation /var/lib/kajovocml-ng/components /var/lib/kajovocml-ng/runtime /var/lib/kajovocml-ng/browser /var/lib/kajovocml-ng/audit
}
begin_deployment_record(){ psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -v deployment_id="${deployment_id}" -v release="${release_id}" -v sha="${expected_sha}" -v previous="${previous_release}" -c "INSERT INTO kcml.deployment_run(id,release_id,source_sha,previous_release_id,deployment_epoch,status,current_step,platform_incarnation_id,application_deployment_epoch) SELECT :'deployment_id'::uuid,:'release',:'sha',nullif(:'previous',''),d.current_epoch+1,'PREFLIGHT','forward_migrations',p.platform_incarnation_id,d.current_epoch FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1" >/dev/null;}
capability_inventory(){
  local openai_status=OPENAI_CONFIGURATION_REQUIRED wedos_status=WEDOS_CONFIGURATION_REQUIRED
  psql "${DATABASE_URL}" -Atqc "SELECT EXISTS(SELECT 1 FROM kcml.secret_record s JOIN kcml.secret_version v ON v.id=s.active_version_id WHERE s.stable_name='OPENAI_API_KEY' AND v.lifecycle='ACTIVE')" | grep -qx t && openai_status=READY || true
  psql "${DATABASE_URL}" -Atqc "SELECT (SELECT count(*) FROM kcml.secret_record s JOIN kcml.secret_version v ON v.id=s.active_version_id WHERE s.stable_name IN('WEDOS_WAPI_LOGIN','WEDOS_WAPI_WPASS') AND v.lifecycle='ACTIVE')=2" | grep -qx t && wedos_status=READY || true
  install -d -o root -g kcml-platform -m 0770 /var/lib/kajovocml-ng/audit/deployments
  jq -n --arg release "${release_id}" --arg sha "${expected_sha}" --arg openai "${openai_status}" --arg wedos "${wedos_status}" '{releaseId:$release,sourceSha:$sha,core:"READY",openai:$openai,wedos:$wedos,browser:"READY",postgres:"READY"}' >"/var/lib/kajovocml-ng/audit/deployments/${deployment_id}-capabilities.json"
}
update_runtime_env(){ local epoch=$1;sed -i -E "s/^KCML_RELEASE_ID=.*/KCML_RELEASE_ID=${release_id}/;s/^KCML_SOURCE_SHA=.*/KCML_SOURCE_SHA=${expected_sha}/" /etc/kajovocml-ng/runtime.env;if grep -q '^KCML_DEPLOYMENT_EPOCH=' /etc/kajovocml-ng/runtime.env;then sed -i "s/^KCML_DEPLOYMENT_EPOCH=.*/KCML_DEPLOYMENT_EPOCH=${epoch}/" /etc/kajovocml-ng/runtime.env;else echo "KCML_DEPLOYMENT_EPOCH=${epoch}" >>/etc/kajovocml-ng/runtime.env;fi; }
switch_release(){ local epoch;epoch=$(psql "${DATABASE_URL}" -Atqc "UPDATE kcml.application_deployment_head SET current_epoch=current_epoch+1,current_release_id='${release_id}',source_sha='${expected_sha}',deployment_id='${deployment_id}',state_version=state_version+1,updated_at=clock_timestamp() WHERE singleton_key=1 RETURNING current_epoch");update_runtime_env "${epoch}";ln -s "${release_path}" /opt/kajovocml-ng/current.next;mv -Tf /opt/kajovocml-ng/current.next /opt/kajovocml-ng/current; }
restart_services(){ systemctl daemon-reload;systemctl restart kcml-web-api.socket kcml-runtime-gateway.socket kcml-secret-broker.socket kcml-state-broker.socket kcml-egress-gateway.socket;systemctl restart kcml.target;while IFS='|' read -r unit app user families writable dependency enabled;do [[ ${enabled} == yes ]]&&systemctl restart "${unit}.service";done <"${release_path}/deploy/systemd/services.tsv";systemctl restart kcml-browser-host@primary.service;systemctl reload nginx; }
verify_runtime(){ local response;for attempt in {1..45};do response=$(curl --silent --show-error --unix-socket /run/kajovocml-ng/web-api.sock http://localhost/ready||true);jq -e '.status=="ready"'<<<"${response}" >/dev/null&&break;sleep 2;done;jq -e --arg sha "${expected_sha}" --arg release "${release_id}" '.status=="ready" and .sourceSha==$sha and .releaseId==$release and .services.ready==true'<<<"${response}">/dev/null;curl --fail --silent --unix-socket /run/kajovocml-ng/web-api.sock http://localhost/health|jq -e '.status=="healthy"'>/dev/null; }
verify_heartbeats(){
  local epoch service app user families writable dependency enabled missing=0
  epoch=$(psql "${DATABASE_URL}" -Atqc "SELECT current_epoch FROM kcml.application_deployment_head WHERE singleton_key=1")
  while IFS='|' read -r service app user families writable dependency enabled; do
    [[ -z ${service} || ${service:0:1} == '#' || ${enabled} != yes || ${service} == kcml-web-api ]] && continue
    psql "${DATABASE_URL}" -v service="${service}" -v release="${release_id}" -v sha="${expected_sha}" -v epoch="${epoch}" -Atqc "SELECT EXISTS(SELECT 1 FROM kcml.platform_worker_heartbeat WHERE service_name=:'service' AND status='READY' AND expires_at>clock_timestamp() AND release_id=:'release' AND source_sha=:'sha' AND deployment_epoch=:'epoch'::bigint)" | grep -qx t || missing=$((missing+1))
  done <"${release_path}/deploy/systemd/services.tsv"
  psql "${DATABASE_URL}" -v release="${release_id}" -v sha="${expected_sha}" -v epoch="${epoch}" -Atqc "SELECT EXISTS(SELECT 1 FROM kcml.platform_worker_heartbeat WHERE service_name='kcml-browser-host' AND status='READY' AND expires_at>clock_timestamp() AND release_id=:'release' AND source_sha=:'sha' AND deployment_epoch=:'epoch'::bigint)" | grep -qx t || missing=$((missing+1))
  [[ ${missing} -eq 0 ]]
}
healthy_samples(){ for sample in {1..5};do curl --fail --silent --unix-socket /run/kajovocml-ng/web-api.sock http://localhost/ready|jq -e '.status=="ready"'>/dev/null;sleep 3;done; }

run_step verify_source_and_signature verify_bundle
run_step backup create_backup
run_step verified_candidate_staging stage_release
run_step forward_migrations env KCML_RELEASE_ID="${release_id}" KCML_SOURCE_SHA="${expected_sha}" node "${stage_path}/apps/server/node_modules/@kcml/database/dist/cli.js" migrate
run_step deployment_record begin_deployment_record
run_step platform_identity_config_reconciliation reconcile_platform
run_step platform_preflight preflight
run_step provider_capability_inventory capability_inventory
run_step pass_sync bash -c 'printf "%s" "$1" | node "$2/apps/server/dist/admin-cli.js" sync-password' _ "${pass_value}" "${stage_path}"
unset pass_value
run_step owner_api_key node "${stage_path}/apps/server/dist/admin-cli.js" ensure-owner-api-key
run_step immutable_release_install install_release
run_step atomic_switch switch_release
run_step service_restart restart_services
run_step health_version_readiness verify_runtime
run_step service_heartbeats verify_heartbeats
run_step self_test node "${release_path}/apps/server/dist/admin-cli.js" self-test
run_step healthy_samples healthy_samples
install -o root -g root -m 0755 "${release_path}/deploy/scripts/deploy-production.sh" /usr/local/sbin/kcml-deploy-production
psql "${DATABASE_URL}" -v deployment_id="${deployment_id}" -c "UPDATE kcml.deployment_run SET status='SUCCEEDED',current_step='COMPLETED',completed_at=clock_timestamp(),state_version=state_version+1,updated_at=clock_timestamp() WHERE id=:'deployment_id'::uuid" >/dev/null
trap - ERR
printf 'DEPLOYMENT STATUS: PASS release=%s sha=%s elapsedMs=%d\n' "${release_id}" "${expected_sha}" "$((($(date +%s%N)-started_ns)/1000000))"
