#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || exit 77
source /etc/kajovocml-ng/runtime.env
backup_id=$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid)
target=/var/lib/kajovocml-ng/backups/scheduled-${backup_id}
install -d -o root -g root -m 0700 "${target}"
pg_dump --format=custom --compress=9 --file="${target}/database.dump" "${DATABASE_URL}"
tar -C /etc -czf "${target}/configuration.tar.gz" kajovocml-ng
readlink -f /opt/kajovocml-ng/current >"${target}/current-release"
find "${target}" -type f -printf '%f\0' | sort -z | while IFS= read -r -d '' file; do sha256sum "${target}/${file}"; done >"${target}/SHA256SUMS"
(cd "${target}" && sha256sum -c SHA256SUMS)
find "${target}" -type f -exec chmod 0400 {} +
find /var/lib/kajovocml-ng/backups -mindepth 1 -maxdepth 1 -type d -mtime +35 -name 'scheduled-*' -print0 | xargs -0r --no-run-if-empty rm -rf --
echo "BACKUP STATUS: PASS id=${backup_id} path=${target}"
