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
    expect(source).toContain('.services.ready==true');
    expect(source).toContain("service_name='kcml-browser-host'");
    expect(source).toContain("status='READY'");
    expect(source).toContain("source_sha=:'sha'");
    expect(source).toContain("deployment_epoch=:'epoch'::bigint");
  });
});
