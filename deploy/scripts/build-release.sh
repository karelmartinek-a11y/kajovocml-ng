#!/usr/bin/env bash
set -Eeuo pipefail
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
output_dir=${1:-${repository_root}/release-output}
source_sha=${GITHUB_SHA:-$(git -C "${repository_root}" rev-parse HEAD)}
[[ ${source_sha} =~ ^[0-9a-f]{40}$ ]] || { echo 'Source SHA musí mít 40 lowercase hex znaků.' >&2; exit 64; }
release_id=${KCML_RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-${source_sha:0:12}}
[[ ${release_id} =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Neplatné release ID.' >&2; exit 64; }
stage=$(mktemp -d); trap 'rm -rf -- "${stage}"' EXIT
install -d "${stage}/release/apps" "${stage}/release/contracts" "${stage}/release/database" "${stage}/release/deploy"
cd "${repository_root}"
pnpm install --frozen-lockfile
pnpm contracts:check
pnpm -r --if-present build
while IFS= read -r package_file; do
  package_name=$(jq -r .name "${package_file}"); app_dir=$(dirname "${package_file}"); app_name=$(basename "${app_dir}")
  [[ ${app_name} == owner-ui || ${app_name} == owner-device-bridge ]] && continue
  pnpm --filter "${package_name}" deploy --prod --legacy "${stage}/release/apps/${app_name}"
done < <(find apps -mindepth 2 -maxdepth 2 -name package.json -print | sort)
install -d "${stage}/release/apps/owner-ui"; cp -a apps/owner-ui/dist "${stage}/release/apps/owner-ui/dist"
cp -a contracts/. "${stage}/release/contracts/"; cp -a database/. "${stage}/release/database/"; cp -a deploy/. "${stage}/release/deploy/"
node_include_dir=${KCML_NODE_INCLUDE_DIR:-$(node -e "const path=require('node:path');process.stdout.write(path.resolve(path.dirname(process.execPath),'../include/node'))")}
if [[ -f ${node_include_dir}/node_api.h ]]; then
  cc -O2 -Wall -Wextra -Werror -fPIC -shared -I"${node_include_dir}" deploy/runtime/kcml-fd-cloexec-addon.c -o "${stage}/release/deploy/runtime/kcml-fd-cloexec.node"
else
  echo "Node.js 24 headers unavailable at ${node_include_dir}; release cannot contain the required fd CLOEXEC addon." >&2
  exit 77
fi
cp package.json pnpm-lock.yaml pnpm-workspace.yaml SSOT_CURRENT.md "${stage}/release/"
printf '%s\n' "${source_sha}" >"${stage}/release/SOURCE_SHA"; printf '%s\n' "${release_id}" >"${stage}/release/RELEASE_ID"
node -e 'const fs=require("fs");const p=process.argv;fs.writeFileSync(p[1],JSON.stringify({format:"KCML-RELEASE/1",releaseId:p[2],sourceSha:p[3],builtAt:new Date().toISOString(),node:process.version,pnpm:p[4],platform:process.platform,architecture:process.arch},null,2)+"\n")' "${stage}/release/release.json" "${release_id}" "${source_sha}" "$(pnpm --version)"
(cd "${stage}/release" && find . -type f ! -name FILES.sha256 -print0 | sort -z | xargs -0 sha256sum >FILES.sha256)
install -d "${output_dir}"
tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner -C "${stage}" -czf "${output_dir}/${release_id}.tar.gz" release
(cd "${output_dir}" && sha256sum "${release_id}.tar.gz" >"${release_id}.tar.gz.sha256")
cp "${stage}/release/release.json" "${output_dir}/${release_id}.release.json"
if [[ -n ${KCML_MINISIGN_SECRET_KEY_FILE:-} ]]; then minisign -S -s "${KCML_MINISIGN_SECRET_KEY_FILE}" -m "${output_dir}/${release_id}.tar.gz" -x "${output_dir}/${release_id}.tar.gz.minisig" -t "KájovoCML NG ${release_id} ${source_sha}"; else echo 'KCML_MINISIGN_SECRET_KEY_FILE není nastaven; release není určen k produkčnímu deployi.' >&2; fi
printf '%s\n' "${release_id}" >"${output_dir}/RELEASE_ID"
echo "RELEASE_BUNDLE=${output_dir}/${release_id}.tar.gz"
