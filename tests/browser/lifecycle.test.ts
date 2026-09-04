import { describe, expect, it } from 'vitest';
import { loadOperationCatalog } from '../../packages/contract-pack/src/index.js';
import { validateCanonicalOperationCommand } from '../../packages/domain/src/canonical-operation-handlers.js';

const catalog = await loadOperationCatalog();
const operation = (name: string) => {
  const record = catalog.records.find((candidate) => candidate.operationName === name);
  if (!record) throw new Error(`missing operation ${name}`);
  return record;
};
const id = '00000000-0000-4000-8000-000000000001';
const digest = `sha256:${'a'.repeat(64)}`;

describe('TD-05 persisted Browser Interaction Plane contract', () => {
  it('rejects arbitrary host paths in every nested browser payload', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.action.start'), id, {
      sessionId: id,
      action: 'UPLOAD',
      payload: { filePath: '/etc/passwd' }
    })).toThrowError(expect.objectContaining({ code: 'BROWSER_ACTIONABILITY_FAILED' }));
  });

  it('requires a content-addressed artifact handle for artifacts', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.artifact.created'), null, {
      sessionId: id,
      artifactType: 'DOWNLOAD',
      storageReference: '/tmp/download.bin',
      artifactDigest: digest,
      sizeBytes: 1,
      safeName: 'download.bin'
    })).toThrowError(expect.objectContaining({ code: 'BROWSER_ARTIFACT_INVALID' }));
  });

  it('accepts a persisted challenge request without treating an exception as its state', () => {
    const expiry = new Date(Date.now() + 60_000).toISOString();
    expect(() => validateCanonicalOperationCommand(operation('browser.challenge.required'), null, {
      sessionId: id,
      challengeType: 'WEBAUTHN_ASSERTION',
      pendingActionDigest: digest,
      controlEpoch: 4,
      deadlineAt: expiry,
      expiresAt: expiry,
      safePrompt: 'Complete the authentication challenge for the visible origin.',
      allowedResolutionMethods: ['OWNER_DEVICE_BRIDGE']
    })).not.toThrow();
  });

  it('does not allow outcome resolution without independent read-back evidence', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.action.reconcile'), id, {
      outcome: 'CONFIRMED_APPLIED'
    })).toThrowError(expect.objectContaining({ code: 'BROWSER_RECONCILIATION_REQUIRED' }));
  });

  it('only admits the canonical monotonic host dispatch phases', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.action.dispatchPhase'), id, {
      phase: 'OBSERVATION_SAVED',
      evidence: { source: 'fixture' }
    })).toThrowError(expect.objectContaining({ code: 'BROWSER_ACTIONABILITY_FAILED' }));
  });

  it('requires a persisted artifact before a download can become complete', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.download.persist'), id, {
      contentDigest: digest,
      sizeBytes: 10
    })).toThrowError(expect.objectContaining({ code: 'TOOL_ARGUMENT_SCHEMA_INVALID' }));
  });

  it('accepts only opaque upload handles, never a host path', () => {
    expect(() => validateCanonicalOperationCommand(operation('browser.download.started'), null, {
      sessionId: id,
      downloadId: id,
      tempHandle: 'upload:/tmp/download.bin'
    })).toThrowError(expect.objectContaining({ code: 'BROWSER_ARTIFACT_INVALID' }));
    expect(() => validateCanonicalOperationCommand(operation('browser.download.started'), null, {
      sessionId: id,
      downloadId: id,
      tempHandle: `download:${id}`
    })).not.toThrow();
  });
});
