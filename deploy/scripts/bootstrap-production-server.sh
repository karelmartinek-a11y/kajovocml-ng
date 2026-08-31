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
create_user(){ local name=$1; getent passwd "${name}" >/dev/null || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --gid kcml-platform "${name}"; }

install_packages
install_node
corepack enable
corepack prepare pnpm@11.19.0 --activate
for group in kcml-platform kcml-runtime-callers kcml-runtime-gateway kcml-browser-worker; do create_group "${group}"; done
while IFS='|' read -r unit app service_user rest; do [[ -z ${unit} || ${unit:0:1} == '#' ]] && continue; create_user "${service_user}"; done <"${repository_root}/deploy/systemd/services.tsv"
create_user kcml-runtime-host; create_user kcml-browser-host; create_user kcml-deploy
usermod --home /var/lib/kajovocml-ng/deploy-home --shell /bin/bash kcml-deploy
usermod -a -G kcml-runtime-callers,kcml-runtime-gateway kcml-runtime-gateway
usermod -a -G kcml-runtime-callers kcml-runtime-host
usermod -a -G kcml-browser-worker kcml-browser-worker

install -d -o root -g kcml-platform -m 0750 /opt/kajovocml-ng /opt/kajovocml-ng/releases /srv/kajovocml-ng /etc/kajovocml-ng /etc/kajovocml-ng/tls
install -d -o kcml-deploy -g kcml-platform -m 0750 /srv/kajovocml-ng/repository
install -d -o kcml-deploy -g kcml-platform -m 0750 /var/lib/kajovocml-ng/deploy-home
install -d -o kcml-deploy -g kcml-platform -m 0700 /var/lib/kajovocml-ng/deploy-home/.ssh
install -d -o kcml-deploy -g kcml-platform -m 0750 /var/lib/kajovocml-ng/deployments
for path in data generation components runtime browser audit backups; do install -d -o root -g kcml-platform -m 0770 "/var/lib/kajovocml-ng/${path}"; done
install -d -o kcml-browser-host -g kcml-platform -m 0770 /var/lib/kajovocml-ng/browser/hosts /var/lib/kajovocml-ng/browser/sessions /var/lib/kajovocml-ng/browser/artifacts /var/lib/kajovocml-ng/browser/runtime-builds
install -d -o kcml-runtime-host -g kcml-platform -m 0770 /var/lib/kajovocml-ng/runtime/instances
install -d -o www-data -g www-data -m 0750 /var/lib/kajovocml-ng/acme

if [[ ! -s /etc/kajovocml-ng/master.key ]]; then openssl rand -base64 32 >/etc/kajovocml-ng/master.key; fi
chown root:kcml-platform /etc/kajovocml-ng/master.key; chmod 0440 /etc/kajovocml-ng/master.key
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
runtime_candidate=$(mktemp)
cat >"${runtime_candidate}" <<EOF
DATABASE_URL=postgresql://kajovocml_app:${db_password}@127.0.0.1:5432/kajovocml_ng
KCML_MASTER_KEY_FILE=/etc/kajovocml-ng/master.key
KCML_MASTER_KEY_ID=host-master-v1
KCML_PUBLIC_ORIGIN=https://kajovocml.hcasc.cz
KCML_RELEASE_ID=bootstrap
KCML_SOURCE_SHA=0000000000000000000000000000000000000000
KCML_BROWSER_ARTIFACT_ROOT=/var/lib/kajovocml-ng/browser/artifacts
KCML_BROWSER_RUNTIME_BUILD=playwright-1.58.2
PLAYWRIGHT_BROWSERS_PATH=/var/lib/kajovocml-ng/browser/runtime-builds/1.58.2
KCML_ALLOWED_PEER_UIDS=$(id -u kcml-runtime-host),$(id -u kcml-runtime-gateway)
EOF
backup_if_changed /etc/kajovocml-ng/runtime.env "${runtime_candidate}"; install -o root -g kcml-platform -m 0640 "${runtime_candidate}" /etc/kajovocml-ng/runtime.env; rm -f "${runtime_candidate}"

install -d -m 0755 /usr/libexec/kajovocml-ng
cc -O2 -Wall -Wextra -Werror "${repository_root}/deploy/runtime/kcml-peercred.c" -o /usr/libexec/kajovocml-ng/kcml-peercred
cc -O2 -Wall -Wextra -Werror "${repository_root}/deploy/runtime/kcml-sandbox-launcher.c" -lcrypto -o /usr/libexec/kajovocml-ng/kcml-sandbox-launcher
chown root:root /usr/libexec/kajovocml-ng/kcml-*; chmod 0755 /usr/libexec/kajovocml-ng/kcml-*

"${repository_root}/deploy/scripts/install-systemd.sh" "${repository_root}"
install -o root -g root -m 0755 "${repository_root}/deploy/scripts/deploy-production.sh" /usr/local/sbin/kcml-deploy-production
sudoers_candidate=$(mktemp)
cat >"${sudoers_candidate}" <<'EOF'
kcml-deploy ALL=(root) NOPASSWD: /usr/local/sbin/kcml-deploy-production *
EOF
visudo -cf "${sudoers_candidate}"; backup_if_changed /etc/sudoers.d/kajovocml-ng-deploy "${sudoers_candidate}"; install -o root -g root -m 0440 "${sudoers_candidate}" /etc/sudoers.d/kajovocml-ng-deploy; rm -f "${sudoers_candidate}"
nginx_candidate=$(mktemp); cp "${repository_root}/deploy/nginx/kajovocml-ng.conf" "${nginx_candidate}"
backup_if_changed /etc/nginx/sites-available/kajovocml-ng.conf "${nginx_candidate}"; install -m 0644 "${nginx_candidate}" /etc/nginx/sites-available/kajovocml-ng.conf; rm -f "${nginx_candidate}"; ln -sfn /etc/nginx/sites-available/kajovocml-ng.conf /etc/nginx/sites-enabled/kajovocml-ng.conf
if [[ ! -s /etc/kajovocml-ng/tls/fullchain.pem || ! -s /etc/kajovocml-ng/tls/privkey.pem ]]; then openssl req -x509 -newkey rsa:3072 -nodes -days 2 -subj '/CN=kajovocml.hcasc.cz' -addext 'subjectAltName=DNS:kajovocml.hcasc.cz,DNS:*.kajovocml.hcasc.cz' -keyout /etc/kajovocml-ng/tls/privkey.pem -out /etc/kajovocml-ng/tls/fullchain.pem; chmod 0600 /etc/kajovocml-ng/tls/privkey.pem; fi
nginx -t; systemctl enable --now nginx postgresql
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
PLAYWRIGHT_BROWSERS_PATH=/var/lib/kajovocml-ng/browser/runtime-builds/1.58.2 pnpm dlx playwright@1.58.2 install --with-deps chromium firefox webkit
chown -R kcml-browser-host:kcml-platform /var/lib/kajovocml-ng/browser/runtime-builds
"${repository_root}/deploy/scripts/verify-production-prerequisites.sh"
echo 'Bootstrap dokončen. Pokračujte souborem START_HERE.md, FÁZE 4.'
