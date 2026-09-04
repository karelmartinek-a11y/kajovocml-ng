#!/usr/bin/env bash
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
if [[ ${EUID} -ne 0 ]]; then echo 'Spusťte přes sudo.' >&2; exit 77; fi
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
source /etc/os-release
if [[ ${ID} != ubuntu || ${VERSION_ID} != 24.04 ]]; then echo "Vyžadováno Ubuntu 24.04 LTS, nalezeno ${PRETTY_NAME}." >&2; exit 78; fi
if [[ $(dpkg --print-architecture) != amd64 && $(dpkg --print-architecture) != arm64 ]]; then echo 'Podporováno je amd64 nebo arm64.' >&2; exit 78; fi

backup_if_changed(){ local target=$1 candidate=$2; if [[ -e ${target} ]] && ! cmp -s "${target}" "${candidate}"; then local dir=/var/lib/kajovocml-ng/backups/bootstrap-$(date -u +%Y%m%dT%H%M%SZ); install -d -m 0700 "${dir}"; cp -a "${target}" "${dir}/$(basename "${target}")"; fi; }
install_packages(){ apt-get update; apt-get install -y --no-install-recommends ca-certificates curl gnupg jq openssl git rsync unzip zip xz-utils build-essential pkg-config libssl-dev postgresql-16 postgresql-contrib-16 nginx ufw certbot minisign acl libcap2-bin sudo; }
install_node(){ if command -v node >/dev/null && [[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]]; then return; fi; install -d -m 0755 /etc/apt/keyrings; curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg; printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main' >/etc/apt/sources.list.d/nodesource.list; apt-get update; apt-get install -y nodejs; }
create_group(){ getent group "$1" >/dev/null || groupadd --system "$1"; }
create_user(){ local name=$1 primary_group=$2; getent passwd "${name}" >/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid "${primary_group}" "${name}"; usermod --gid "${primary_group}" "${name}"; }

install_packages
install_node
corepack enable
corepack prepare pnpm@11.19.0 --activate
for group in kcml-platform kcml-release-readers kcml-runtime-callers kcml-runtime-gateway kcml-browser-worker kcml-runtime-host kcml-browser-host kcml-recovery kcml-deploy; do create_group "${group}"; done
while IFS='|' read -r unit primary_group supplementary_groups database_role credentials read_only_paths; do [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue; create_group "${primary_group}"; done <"${repository_root}/deploy/security/service-capabilities.tsv"
while IFS='|' read -r unit app service_user rest; do
  [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue
  security_row=$(awk -F'|' -v unit="${unit}" '$1==unit {print}' "${repository_root}/deploy/security/service-capabilities.tsv")
  IFS='|' read -r security_unit primary_group supplementary_groups database_role credentials read_only_paths <<<"${security_row}"
  create_user "${service_user}" "${primary_group}"
  [[ -n ${supplementary_groups} ]] && usermod -a -G "${supplementary_groups// /,}" "${service_user}"
done <"${repository_root}/deploy/systemd/services.tsv"
create_user kcml-runtime-host kcml-runtime-host; create_user kcml-browser-host kcml-browser-host; create_user kcml-recovery kcml-recovery; create_user kcml-deploy kcml-deploy
# A shared production host can already have the deployment account running an
# unrelated GitHub runner. Never mutate a live account's home directory: its
# active process would be disrupted and SSH key resolution could change during
# bootstrap. Fresh accounts retain the dedicated KCML deployment home.
if ! pgrep -u kcml-deploy >/dev/null 2>&1; then usermod --home /var/lib/kajovocml-ng/deploy-home --shell /bin/bash kcml-deploy; fi
usermod -a -G kcml-runtime-callers,kcml-release-readers kcml-runtime-gateway
usermod -a -G kcml-runtime-callers kcml-runtime-host
usermod -a -G kcml-browser-worker kcml-browser-worker

install -d -o root -g kcml-release-readers -m 0750 /opt/kajovocml-ng /opt/kajovocml-ng/releases
install -d -o root -g root -m 0750 /etc/kajovocml-ng /etc/kajovocml-ng/tls /etc/kajovocml-ng/credentials
install -d -o root -g kcml-platform -m 0750 /srv/kajovocml-ng
install -d -o kcml-deploy -g kcml-platform -m 0750 /srv/kajovocml-ng/repository
install -d -o kcml-deploy -g kcml-platform -m 0750 /var/lib/kajovocml-ng/deploy-home
install -d -o kcml-deploy -g kcml-platform -m 0700 /var/lib/kajovocml-ng/deploy-home/.ssh
install -d -o kcml-deploy -g kcml-platform -m 0750 /var/lib/kajovocml-ng/deployments
for path in data generation components runtime browser audit backups; do install -d -o root -g kcml-platform -m 0770 "/var/lib/kajovocml-ng/${path}"; done
install -d -o kcml-browser-host -g kcml-platform -m 0770 /var/lib/kajovocml-ng/browser/hosts /var/lib/kajovocml-ng/browser/sessions /var/lib/kajovocml-ng/browser/artifacts /var/lib/kajovocml-ng/browser/runtime-builds
install -d -o kcml-runtime-host -g kcml-platform -m 0770 /var/lib/kajovocml-ng/runtime/instances
install -d -o www-data -g www-data -m 0750 /var/lib/kajovocml-ng/acme
while IFS='|' read -r unit app service_user families writable dependency enabled; do
  [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue
  for writable_path in ${writable}; do [[ ! -e ${writable_path} ]] || setfacl -m "u:${service_user}:rwx" "${writable_path}"; done
done <"${repository_root}/deploy/systemd/services.tsv"
setfacl -m u:kcml-runtime-host:rwx /var/lib/kajovocml-ng/runtime /var/lib/kajovocml-ng/runtime/instances /run/kajovocml-ng/runtime-hosts 2>/dev/null || true
setfacl -m u:kcml-browser-host:rwx /var/lib/kajovocml-ng/browser /var/lib/kajovocml-ng/browser/hosts /var/lib/kajovocml-ng/browser/sessions /var/lib/kajovocml-ng/browser/artifacts /var/lib/kajovocml-ng/browser/runtime-builds 2>/dev/null || true

if [[ ! -s /etc/kajovocml-ng/master.key ]]; then openssl rand -base64 32 >/etc/kajovocml-ng/master.key; fi
chown root:root /etc/kajovocml-ng/master.key; chmod 0400 /etc/kajovocml-ng/master.key
if [[ ! -s /etc/kajovocml-ng/postgres-app-password ]]; then openssl rand -hex 36 >/etc/kajovocml-ng/postgres-app-password; chmod 0400 /etc/kajovocml-ng/postgres-app-password; chown root:root /etc/kajovocml-ng/postgres-app-password; fi
db_password=$(</etc/kajovocml-ng/postgres-app-password)
runuser -u postgres -- psql --set=ON_ERROR_STOP=1 --set=app_password="${db_password}" <<'SQL'
DO $block$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kajovocml_app') THEN CREATE ROLE kajovocml_app LOGIN; END IF;
END $block$;
SELECT format('ALTER ROLE kajovocml_app PASSWORD %L', :'app_password') \gexec
SELECT 'CREATE DATABASE kajovocml_ng OWNER kajovocml_app TEMPLATE template0 ENCODING ''UTF8''' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='kajovocml_ng') \gexec
REVOKE ALL ON DATABASE kajovocml_ng FROM PUBLIC;
SQL
hba_file=$(runuser -u postgres -- psql -Atqc 'SHOW hba_file')
hba_candidate=$(mktemp)
{
  printf '%s\n' 'local kajovocml_ng kajovocml_app scram-sha-256' 'local kajovocml_ng +kcml_service_login scram-sha-256'
  grep -vxF -e 'local kajovocml_ng kajovocml_app scram-sha-256' -e 'local kajovocml_ng +kcml_service_login scram-sha-256' "${hba_file}"
} >"${hba_candidate}"
backup_if_changed "${hba_file}" "${hba_candidate}"
install -o postgres -g postgres -m 0640 "${hba_candidate}" "${hba_file}"
rm -f "${hba_candidate}"
runuser -u postgres -- psql -c 'SELECT pg_reload_conf()' >/dev/null
"${repository_root}/deploy/scripts/provision-service-credentials.sh" "${repository_root}"
runtime_candidate=$(mktemp)
cat >"${runtime_candidate}" <<EOF
KCML_MASTER_KEY_ID=host-master-v1
KCML_PUBLIC_ORIGIN=https://kaja.hcasc.cz
KCML_RELEASE_ID=bootstrap
KCML_SOURCE_SHA=0000000000000000000000000000000000000000
KCML_BROWSER_ARTIFACT_ROOT=/var/lib/kajovocml-ng/browser/artifacts
KCML_BROWSER_RUNTIME_BUILD=playwright-1.58.2
PLAYWRIGHT_BROWSERS_PATH=/var/lib/kajovocml-ng/browser/runtime-builds/1.58.2
KCML_ALLOWED_PEER_UIDS=$(id -u kcml-runtime-host),$(id -u kcml-runtime-gateway)
EOF
backup_if_changed /etc/kajovocml-ng/runtime.env "${runtime_candidate}"; install -o root -g kcml-release-readers -m 0440 "${runtime_candidate}" /etc/kajovocml-ng/runtime.env; rm -f "${runtime_candidate}"
deploy_candidate=$(mktemp)
printf '%s\n' "DATABASE_URL=postgresql://kajovocml_app:${db_password}@localhost/kajovocml_ng?host=%2Fvar%2Frun%2Fpostgresql" 'KCML_MASTER_KEY_FILE=/etc/kajovocml-ng/master.key' >"${deploy_candidate}"
backup_if_changed /etc/kajovocml-ng/deploy.env "${deploy_candidate}"; install -o root -g root -m 0400 "${deploy_candidate}" /etc/kajovocml-ng/deploy.env; rm -f "${deploy_candidate}"

install -d -m 0755 /usr/libexec/kajovocml-ng
cc -O2 -Wall -Wextra -Werror "${repository_root}/deploy/runtime/kcml-peercred.c" -o /usr/libexec/kajovocml-ng/kcml-peercred
cc -O2 -Wall -Wextra -Werror "${repository_root}/deploy/runtime/kcml-sandbox-launcher.c" -lcrypto -o /usr/libexec/kajovocml-ng/kcml-sandbox-launcher
chown root:root /usr/libexec/kajovocml-ng/kcml-*; chmod 0755 /usr/libexec/kajovocml-ng/kcml-*

"${repository_root}/deploy/scripts/install-systemd.sh" "${repository_root}"
while IFS='|' read -r unit app service_user families writable dependency enabled; do
  [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue
  for writable_path in ${writable}; do setfacl -m "u:${service_user}:rwx" "${writable_path}"; done
done <"${repository_root}/deploy/systemd/services.tsv"
setfacl -m u:kcml-runtime-host:rwx /var/lib/kajovocml-ng/runtime /var/lib/kajovocml-ng/runtime/instances /run/kajovocml-ng/runtime-hosts
setfacl -m u:kcml-browser-host:rwx /var/lib/kajovocml-ng/browser /var/lib/kajovocml-ng/browser/hosts /var/lib/kajovocml-ng/browser/sessions /var/lib/kajovocml-ng/browser/artifacts /var/lib/kajovocml-ng/browser/runtime-builds /run/kajovocml-ng/browser-hosts
install -o root -g root -m 0755 "${repository_root}/deploy/scripts/deploy-production.sh" /usr/local/sbin/kcml-deploy-production
sudoers_candidate=$(mktemp)
cat >"${sudoers_candidate}" <<'EOF'
kcml-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kcml-deploy-production *
EOF
visudo -cf "${sudoers_candidate}"; backup_if_changed /etc/sudoers.d/kajovocml-ng-deploy "${sudoers_candidate}"; install -o root -g root -m 0440 "${sudoers_candidate}" /etc/sudoers.d/kajovocml-ng-deploy; rm -f "${sudoers_candidate}"
nginx_candidate=$(mktemp); cp "${repository_root}/deploy/nginx/kajovocml-ng.conf" "${nginx_candidate}"
backup_if_changed /etc/nginx/sites-available/kajovocml-ng.conf "${nginx_candidate}"; install -m 0644 "${nginx_candidate}" /etc/nginx/sites-available/kajovocml-ng.conf; rm -f "${nginx_candidate}"; ln -sfn /etc/nginx/sites-available/kajovocml-ng.conf /etc/nginx/sites-enabled/kajovocml-ng.conf
if [[ ! -s /etc/kajovocml-ng/tls/fullchain.pem || ! -s /etc/kajovocml-ng/tls/privkey.pem ]]; then openssl req -x509 -newkey rsa:3072 -nodes -days 2 -subj '/CN=kaja.hcasc.cz' -addext 'subjectAltName=DNS:kaja.hcasc.cz,DNS:*.kaja.hcasc.cz' -keyout /etc/kajovocml-ng/tls/privkey.pem -out /etc/kajovocml-ng/tls/fullchain.pem; chmod 0600 /etc/kajovocml-ng/tls/privkey.pem; fi
nginx -t; systemctl enable --now nginx postgresql
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
PLAYWRIGHT_BROWSERS_PATH=/var/lib/kajovocml-ng/browser/runtime-builds/1.58.2 pnpm dlx playwright@1.58.2 install --with-deps chromium firefox webkit
chown -R kcml-browser-host:kcml-browser-host /var/lib/kajovocml-ng/browser/runtime-builds
"${repository_root}/deploy/scripts/verify-production-prerequisites.sh"
echo 'Bootstrap dokončen. Pokračujte souborem START_HERE.md, FÁZE 4.'
