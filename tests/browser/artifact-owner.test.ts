import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BrowserArtifactOwnerClient, BrowserArtifactOwnerServer } from '../../packages/browser-automation-runtime/src/artifact-owner.js';

describe('browser content-addressed artifact owner', () => {
  it('stores verified bytes atomically and returns only an opaque locator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kcml-artifact-owner-'));
    const socket = join(root, 'owner.sock'), artifacts = join(root, 'artifacts');
    const server = new BrowserArtifactOwnerServer(socket, artifacts); await server.start();
    try {
      const content = Buffer.from('browser-screenshot-evidence');
      const contentDigest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
      const response = await new BrowserArtifactOwnerClient(socket).put({ sessionId: crypto.randomUUID(), actionId: crypto.randomUUID(), actionFence: 1n, contentDigest, sizeBytes: content.length, mimeType: 'image/jpeg', contentBase64: content.toString('base64') });
      expect(response, JSON.stringify(response)).toMatchObject({ ok: true, artifact: { storageReference: `artifact:${contentDigest}`, contentDigest, sizeBytes: content.length, mimeType: 'image/jpeg' } });
      await expect(readFile(join(artifacts, contentDigest.slice('sha256:'.length)))).resolves.toEqual(content);
    } finally { await server.stop(); await rm(root, { recursive: true, force: true }); }
  });

  it('fails closed when producer bytes do not match the declared digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kcml-artifact-owner-'));
    const socket = join(root, 'owner.sock'); const server = new BrowserArtifactOwnerServer(socket, join(root, 'artifacts')); await server.start();
    try {
      const content = Buffer.from('tampered');
      const response = await new BrowserArtifactOwnerClient(socket).put({ sessionId: crypto.randomUUID(), actionId: crypto.randomUUID(), actionFence: 1n, contentDigest: `sha256:${'0'.repeat(64)}`, sizeBytes: content.length, mimeType: 'image/jpeg', contentBase64: content.toString('base64') });
      expect(response).toMatchObject({ ok: false, error: { code: 'BROWSER_ARTIFACT_DIGEST_MISMATCH' } });
    } finally { await server.stop(); await rm(root, { recursive: true, force: true }); }
  });

  it('keeps the browser host free of direct artifact filesystem writes', async () => {
    const source = await readFile('packages/browser-automation-runtime/src/host.ts', 'utf8');
    expect(source).not.toMatch(/writeFile|artifactRoot/u);
    expect(source).toContain('BrowserArtifactOwnerClient');
  });
});
