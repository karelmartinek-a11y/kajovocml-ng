#!/usr/bin/env bash
set -Eeuo pipefail
sudo /opt/kajovocml-ng/current/deploy/scripts/verify-production-prerequisites.sh
systemctl is-active kcml.target nginx postgresql
curl --fail --silent https://kajovocml.hcasc.cz/health | jq -e '.status=="healthy"' >/dev/null
echo 'INFRASTRUCTURE_ACCEPTANCE: PASS'
