import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('production acceptance contract', () => {
  it('authenticates protected probes and uses canonical SSOT routes', async () => {
    const source = await readFile('tests/production/run.sh', 'utf8');
    expect(source).toContain('-H "Authorization: Bearer $KCML_OWNER_API_KEY" "$origin/api/v1/system/version"');
    expect(source).toContain('"$origin/api/v1/operations/catalog"');
    expect(source).not.toContain('"$origin/api/v1/operations"');
  });

  it('gates deployment completion on exact service heartbeat evidence', async () => {
    const source = await readFile('deploy/scripts/deploy-production.sh', 'utf8');
    const query = await readFile('deploy/sql/verify-service-heartbeat.sql', 'utf8');
    expect(source).toContain('.services.ready==true');
    expect(source).toContain('-v service="kcml-browser-host"');
    expect(source).toContain('-Atqf "${release_path}/deploy/sql/verify-service-heartbeat.sql"');
    expect(query).toContain("status = 'READY'");
    expect(query).toContain("source_sha = :'sha'");
    expect(query).toContain("deployment_epoch = :'epoch'::bigint");
  });

  it('feeds variable-bearing SQL through files so substitutions are evaluated independently of loop stdin', async () => {
    const deploy = await readFile('deploy/scripts/deploy-production.sh', 'utf8');
    const rollback = await readFile('deploy/scripts/rollback-production.sh', 'utf8');
    expect(`${deploy}\n${rollback}`).not.toMatch(/psql[^\n]*-v[^\n]*\s-c\s/u);
    expect(deploy).not.toMatch(/psql[^\n]*-v\s+service=[^\n]*-Atqc\b/u);
    expect(deploy).not.toMatch(/psql[^\n]*-v\s+release=[^\n]*-Atqc\b/u);
    expect(deploy).toContain('deploy/sql/verify-service-heartbeat.sql');
  });

  it('loads deployment self-test registries from the immutable release instead of the runner working directory', async () => {
    const adminCli = await readFile('apps/server/src/admin-cli.ts', 'utf8');
    expect(adminCli).toContain("resolve(dirname(fileURLToPath(import.meta.url)),'../../..')");
    expect(adminCli).toContain('loadOperationCatalog(releaseRoot)');
  });

  it('loads the stable error registry from the service working directory instead of a pnpm package symlink', async () => {
    const registry = await readFile('packages/schemas/src/error-retry-registry.ts', 'utf8');
    expect(registry).toContain("resolve(process.cwd(), 'contracts/registries/errors/errors.json')");
    expect(registry).not.toContain("new URL('../../../contracts/registries/errors/errors.json', import.meta.url)");
  });

  it('evaluates release and source SHA assertions against the full version response', async () => {
    const acceptance = await readFile('tests/production/run.sh', 'utf8');
    expect(acceptance).toContain("jq -e '(.releaseId | length > 0) and (.sourceSha | length == 40)'");
  });

  it('uses password-authenticated PostgreSQL Unix sockets inside AF_UNIX-only services', async () => {
    const bootstrap = await readFile('deploy/scripts/bootstrap-production-server.sh', 'utf8');
    expect(bootstrap).toContain('local kajovocml_ng kajovocml_app scram-sha-256');
    expect(bootstrap).toContain('@localhost/kajovocml_ng?host=%2Fvar%2Frun%2Fpostgresql');
    expect(bootstrap).not.toContain('@127.0.0.1:5432/kajovocml_ng');
  });

  it('keeps the runtime gateway in the release traversal group', async () => {
    const unit = await readFile('deploy/systemd/kcml-runtime-gateway.service', 'utf8');
    expect(unit).toContain('Group=kcml-runtime-callers');
    expect(unit).toContain('SupplementaryGroups=kcml-platform');
  });
});
