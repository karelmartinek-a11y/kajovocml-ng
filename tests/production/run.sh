#!/usr/bin/env bash
set -Eeuo pipefail
if [[ -z ${KCML_PRODUCTION_ORIGIN:-} ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: production acceptance requires explicit KCML_PRODUCTION_ORIGIN'
  exit 0
fi
if [[ -z ${KCML_OWNER_API_KEY:-} ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: authenticated production acceptance requires KCML_OWNER_API_KEY'
  exit 0
fi
origin=$KCML_PRODUCTION_ORIGIN
curl --fail --silent --show-error "$origin/health" | jq -e '.status=="healthy"' >/dev/null
curl --fail --silent --show-error "$origin/ready" | jq -e '.status=="ready"' >/dev/null
version=$(curl --fail --silent --show-error -H "Authorization: Bearer $KCML_OWNER_API_KEY" "$origin/api/v1/system/version")
jq -e '(.releaseId | length > 0) and (.sourceSha | length == 40)' <<<"$version" >/dev/null
curl --fail --silent --show-error -H "Authorization: Bearer $KCML_OWNER_API_KEY" "$origin/api/v1/operations/catalog" | jq -e '.operations|length>250' >/dev/null
for sample in 1 2 3 4 5; do curl --fail --silent "$origin/ready" | jq -e '.status=="ready"' >/dev/null; sleep 2; done
echo 'PRODUCTION_ACCEPTANCE: PASS'
