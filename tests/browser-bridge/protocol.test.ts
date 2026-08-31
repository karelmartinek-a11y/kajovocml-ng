import { describe, expect, it } from 'vitest';
import { runtimeBuildManifestSchema } from '@kcml/browser-runtime-contracts';

describe('browser bridge runtime identity', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  it('requires a pinned three-engine build manifest', () => {
    const manifest = runtimeBuildManifestSchema.parse({
      buildId: 'playwright-1.58.2-linux-x64', playwrightVersion: '1.58.2', chromiumRevision: 'rev-c', firefoxRevision: 'rev-f',
      webkitRevision: 'rev-w', executableDigests: { chromium: digest, firefox: digest, webkit: digest }, capabilityDigest: digest,
      createdAt: '2026-08-30T00:00:00.000Z'
    });
    expect(Object.keys(manifest.executableDigests).sort()).toEqual(['chromium', 'firefox', 'webkit']);
  });

  it('rejects a bridge manifest without a browser identity', () => {
    expect(() => runtimeBuildManifestSchema.parse({ buildId: 'x', playwrightVersion: '1.58.2' })).toThrow();
  });
});
