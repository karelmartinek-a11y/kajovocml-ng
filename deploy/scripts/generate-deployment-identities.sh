#!/usr/bin/env bash
set -Eeuo pipefail
output=${1:-deployment-identities-$(date -u +%Y%m%dT%H%M%SZ)}
[[ ! -e ${output} ]]||{ echo 'Výstupní adresář již existuje.' >&2;exit 64; }
install -d -m 0700 "${output}"
ssh-keygen -q -t ed25519 -a 100 -N '' -C 'kajovocml-github-actions-production' -f "${output}/github-actions-deploy.key"
ssh-keygen -q -t ed25519 -a 100 -N '' -C 'kajovocml-server-repository-readonly' -f "${output}/repository-read.key"
minisign -G -p "${output}/release-signing.pub" -s "${output}/release-signing.key" -W
chmod 0600 "${output}"/*;chmod 0644 "${output}"/*.pub
cat >"${output}/INSTALLATION_MAP.txt" <<'MAP'
github-actions-deploy.key          GitHub production Secret DEPLOY_SSH_PRIVATE_KEY
github-actions-deploy.key.pub      /var/lib/kajovocml-ng/deploy-home/.ssh/authorized_keys na serveru
repository-read.key                /srv/kajovocml-ng/repository/.ssh/id_ed25519 na serveru
repository-read.key.pub            GitHub repository Deploy key (read-only)
release-signing.key                GitHub production Secret RELEASE_SIGNING_KEY
release-signing.pub                /etc/kajovocml-ng/release-signing.pub na serveru
MAP
echo "Identity vznikly v ${output}; soukromé části přenášejte pouze šifrovaným kanálem."
