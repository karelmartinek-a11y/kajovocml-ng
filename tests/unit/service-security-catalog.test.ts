import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type SecurityRow = { unit: string; group: string; supplementary: string[]; databaseRole: string; credentials: string[]; readOnlyPaths: string[] };

function securityRows(): SecurityRow[] {
  return readFileSync('deploy/security/service-capabilities.tsv', 'utf8').split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => {
    const columns = line.split('|');
    if (columns.length !== 6) throw new Error(`SECURITY_CATALOG_ROW_INVALID:${line}`);
    return { unit: columns[0]!, group: columns[1]!, supplementary: columns[2]!.split(' ').filter(Boolean), databaseRole: columns[3]!, credentials: columns[4]!.split(',').filter(Boolean), readOnlyPaths: columns[5]!.split(' ') };
  });
}

describe('service security catalog', () => {
  it('assigns one unique primary identity and database login to every service', () => {
    const rows = securityRows();
    const serviceUnits = readFileSync('deploy/systemd/services.tsv', 'utf8').split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => line.split('|')[0]!);
    expect(new Set(rows.map((row) => row.unit)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.group)).size).toBe(rows.length);
    expect(new Set(rows.filter((row) => row.databaseRole !== '-').map((row) => row.databaseRole)).size).toBe(rows.length - 1);
    for (const unit of serviceUnits) expect(rows.filter((row) => row.unit === unit)).toHaveLength(1);
    for (const row of rows) {
      if (row.unit === 'kcml-browser-host') {
        expect(row.databaseRole).toBe('-');
        expect(row.credentials).toEqual([]);
      } else {
        expect(row.databaseRole).toMatch(/^kcml_[a-z0-9_]+$/u);
        expect(row.credentials).toContain('database-url');
      }
      expect(row.supplementary).not.toContain('kcml-platform');
      expect(row.readOnlyPaths).not.toContain('/etc/kajovocml-ng');
    }
  });

  it('keeps the external-effect-only browser host outside PostgreSQL authority', () => {
    const app = readFileSync('apps/browser-host/src/index.ts', 'utf8');
    const manifest = JSON.parse(readFileSync('apps/browser-host/package.json', 'utf8')) as { dependencies: Record<string,string> };
    const unit = readFileSync('deploy/systemd/kcml-browser-host@.service', 'utf8');
    expect(app).not.toContain('@kcml/database');
    expect(manifest.dependencies).not.toHaveProperty('@kcml/database');
    expect(unit).not.toContain('KCML_DATABASE_URL');
    expect(unit).not.toContain('database-url');
  });

  it('limits the master key to the three exact decrypting boundaries', () => {
    const holders = securityRows().filter((row) => row.credentials.includes('master-key')).map((row) => row.unit).sort();
    expect(holders).toEqual(['kcml-egress-gateway','kcml-secret-broker','kcml-web-api']);
    const template = readFileSync('deploy/systemd/kcml-service.service.in', 'utf8');
    expect(template).toContain('{{LOAD_CREDENTIALS}}');
    expect(readFileSync('deploy/scripts/install-systemd.sh', 'utf8')).toContain('LoadCredential=${credential}');
    expect(template).not.toContain('Group=kcml-platform');
    expect(template).not.toContain('SupplementaryGroups=kcml-platform');
  });
});
