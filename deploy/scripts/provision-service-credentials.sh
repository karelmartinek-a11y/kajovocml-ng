#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Provisioning service credentials requires root.' >&2; exit 77; }
repository_root=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
manifest=${repository_root}/deploy/security/service-capabilities.tsv
while IFS='|' read -r unit primary_group supplementary_groups database_role credentials read_only_paths; do
  [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue
  [[ ${database_role} == '-' ]] && continue
  [[ ${database_role} =~ ^kcml_[a-z0-9_]+$ ]] || { echo "Invalid database role for ${unit}." >&2; exit 78; }
  credential_root="/etc/kajovocml-ng/credentials/${unit}"
  password_path="${credential_root}/database-password"
  install -d -o root -g root -m 0700 "${credential_root}"
  if [[ ! -s ${password_path} ]]; then openssl rand -hex 36 >"${password_path}"; fi
  chmod 0400 "${password_path}"; chown root:root "${password_path}"
  service_password=$(<"${password_path}")
  runuser -u postgres -- psql --set=ON_ERROR_STOP=1 --set=service_role="${database_role}" --set=service_password="${service_password}" --dbname=kajovocml_ng <<'SQL'
SELECT 'CREATE ROLE kcml_service_login NOLOGIN' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kcml_service_login') \gexec
SELECT format('CREATE ROLE %I LOGIN NOINHERIT', :'service_role') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=:'service_role') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'service_role', :'service_password') \gexec
SELECT format('GRANT kcml_service_login TO %I', :'service_role') \gexec
SELECT format('GRANT CONNECT ON DATABASE kajovocml_ng TO %I', :'service_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA kcml TO %I', :'service_role') WHERE to_regnamespace('kcml') IS NOT NULL \gexec
SELECT format('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA kcml TO %I', :'service_role') WHERE to_regnamespace('kcml') IS NOT NULL \gexec
SELECT format('GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA kcml TO %I', :'service_role') WHERE to_regnamespace('kcml') IS NOT NULL \gexec
SELECT format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA kcml TO %I', :'service_role') WHERE to_regnamespace('kcml') IS NOT NULL \gexec
SQL
  printf 'postgresql://%s:%s@localhost/kajovocml_ng?host=%%2Fvar%%2Frun%%2Fpostgresql\n' "${database_role}" "${service_password}" >"${credential_root}/database-url"
  chmod 0400 "${credential_root}/database-url"; chown root:root "${credential_root}/database-url"
done <"${manifest}"
