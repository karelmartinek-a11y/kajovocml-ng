#!/usr/bin/env bash
set -Eeuo pipefail
trap 'printf "REPOSITORY_CONSISTENCY: FAIL line=%s\n" "$LINENO" >&2' ERR
expected_ssot=85fc3cd817f3fb14b9b357625542be1c28957af7485fddec3e5112fff18a3488
test "$(sha256sum SSOT_CURRENT.md | cut -d' ' -f1)" = "$expected_ssot"
for path in apps packages contracts database deploy tests docs .github/workflows; do test -d "$path"; done
for file in package.json pnpm-workspace.yaml pnpm-lock.yaml AGENTS.md README.md START_HERE.md BOOTSTRAP_REQUIRED_VALUES.md; do test -s "$file"; done
while IFS= read -r script; do bash -n "$script"; done < <(find deploy tests scripts -type f -name '*.sh' ! -name '._*' -print | sort)
node --input-type=module <<'NODE'
import { readFile, readdir } from 'node:fs/promises';
import YAML from 'yaml';
for (const file of await readdir('.github/workflows')) {
  if (file.startsWith('._')) continue;
  const value = YAML.parse(await readFile(`.github/workflows/${file}`, 'utf8'));
  if (!value?.name || !value?.on || !value?.jobs) throw new Error(`Invalid workflow ${file}`);
}
NODE
test "$(find apps -mindepth 1 -maxdepth 1 -type d | wc -l)" -ge 26
test "$(find packages -mindepth 1 -maxdepth 1 -type d | wc -l)" -ge 22
node scripts/lint.mjs
echo 'REPOSITORY_CONSISTENCY: PASS'
