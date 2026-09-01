#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || exit 77
live=/etc/letsencrypt/live/kaja.hcasc.cz
test -s "${live}/fullchain.pem"; test -s "${live}/privkey.pem"
openssl x509 -in "${live}/fullchain.pem" -noout -checkend 1209600
sans=$(openssl x509 -in "${live}/fullchain.pem" -noout -ext subjectAltName)
grep -Fq 'DNS:kaja.hcasc.cz' <<<"${sans}"
grep -Fq 'DNS:*.kaja.hcasc.cz' <<<"${sans}"
cert_pub=$(openssl x509 -in "${live}/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "${live}/privkey.pem" -pubout -outform DER | sha256sum | cut -d' ' -f1)
test "${cert_pub}" = "${key_pub}"
target=/etc/kajovocml-ng/tls; install -d -o root -g root -m 0700 "${target}"
chain_temp=$(mktemp "${target}/fullchain.XXXXXX"); key_temp=$(mktemp "${target}/privkey.XXXXXX")
trap 'rm -f -- "${chain_temp}" "${key_temp}"' EXIT
install -o root -g root -m 0644 "${live}/fullchain.pem" "${chain_temp}"
install -o root -g root -m 0600 "${live}/privkey.pem" "${key_temp}"
mv -f "${chain_temp}" "${target}/fullchain.pem"; mv -f "${key_temp}" "${target}/privkey.pem"
nginx -t; systemctl reload nginx
curl --fail --silent --show-error --resolve kaja.hcasc.cz:443:127.0.0.1 https://kaja.hcasc.cz/health | jq -e '.status=="healthy"' >/dev/null
echo 'TLS MATERIALIZATION: PASS'
