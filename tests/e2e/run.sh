#!/usr/bin/env bash
set -Eeuo pipefail

if [[ -z ${KCML_E2E_BASE_URL:-} ]]; then
  echo 'NOT_EXECUTED_ENVIRONMENTAL: browser E2E requires explicit KCML_E2E_BASE_URL'
  exit 0
fi

curl --fail --silent --show-error "$KCML_E2E_BASE_URL/health" >/dev/null
pnpm exec playwright test
