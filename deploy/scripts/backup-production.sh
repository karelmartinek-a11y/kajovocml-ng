#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || exit 77
source /etc/kajovocml-ng/deploy.env

backup_id=$(date -u +%Y%m%dT%H%M%SZ)-$(cat /proc/sys/kernel/random/uuid)
target=/var/lib/kajovocml-ng/backups/scheduled-${backup_id}
manifest_tmp=$(mktemp /var/lib/kajovocml-ng/backups/.sha256sums.XXXXXX)
trap 'rm -f "${manifest_tmp}"' EXIT

install -d -o root -g root -m 0700 "${target}"

# The database snapshot and filesystem snapshot belong to the same backup ID.
# Persistent application bytes are required for restoring DB references after a
# complete host loss; the backup tree itself is explicitly excluded to prevent
# recursive backups.
pg_dump --format=custom --compress=9 --file="${target}/database.dump" "${DATABASE_URL}"
tar -C /etc -czf "${target}/configuration.tar.gz" kajovocml-ng
readlink -f /opt/kajovocml-ng/current >"${target}/current-release"

state_roots=()
for root in generation components browser artifacts runtime data; do
  [[ -e "/var/lib/kajovocml-ng/${root}" ]] && state_roots+=("${root}")
done
if ((${#state_roots[@]} == 0)); then
  echo 'BACKUP STATUS: FAIL reason=no-persistent-application-state' >&2
  exit 1
fi
tar --one-file-system --numeric-owner --acls --xattrs \
  -C /var/lib/kajovocml-ng \
  -czf "${target}/application-state.tar.gz" \
  "${state_roots[@]}"

# Create the checksum manifest outside the target tree. This makes the manifest
# non-self-referential and guarantees that sha256sum -c verifies immutable
# bytes rather than a file that was still being written while it was hashed.
(
  cd "${target}"
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0r sha256sum
) >"${manifest_tmp}"
install -o root -g root -m 0400 "${manifest_tmp}" "${target}/SHA256SUMS"
(cd "${target}" && sha256sum -c SHA256SUMS)

find "${target}" -type f -exec chmod 0400 {} +
find /var/lib/kajovocml-ng/backups -mindepth 1 -maxdepth 1 -type d -mtime +35 -name 'scheduled-*' -print0 | xargs -0r --no-run-if-empty rm -rf --
echo "BACKUP STATUS: PASS id=${backup_id} path=${target}"
