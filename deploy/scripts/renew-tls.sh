#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || exit 77
certbot renew --cert-name kaja.hcasc.cz --non-interactive --deploy-hook /opt/kajovocml-ng/current/deploy/scripts/materialize-tls.sh
