import { describe, expect, it } from 'vitest';
import { browserActionNames, browserActionRegistry, validateBrowserActionDescriptor } from '@kcml/schemas';
import { assertObservationFence, targetReferenceSchema } from '@kcml/browser-runtime-contracts';

const ids = {
  session: '11111111-1111-4111-8111-111111111111',
  target: '22222222-2222-4222-8222-222222222222',
  page: '33333333-3333-4333-8333-333333333333',
  frame: '44444444-4444-4444-8444-444444444444',
  document: '55555555-5555-4555-8555-555555555555',
  observation: '66666666-6666-4666-8666-666666666666'
};

describe('browser action and LocatorRef contract', () => {
  it('has exactly one complete descriptor for every accepted action', () => {
    expect(Object.keys(browserActionRegistry).sort()).toEqual([...browserActionNames].sort());
    expect(() => validateBrowserActionDescriptor('CLICK', null, {})).toThrow('BROWSER_TARGET_REQUIRED');
    expect(() => validateBrowserActionDescriptor('NAVIGATE', ids.target, { url: 'https://example.com' })).toThrow('BROWSER_TARGET_FORBIDDEN');
    expect(validateBrowserActionDescriptor('FILL', ids.target, { value: 'safe' }).effect).toBe('POSSIBLE_MUTATION');
  });

  it('invalidates a LocatorRef on any context, page, frame, or document fence change', () => {
    const reference = targetReferenceSchema.parse({ schemaVersion: '1.0', targetReferenceId: ids.target, sessionId: ids.session, contextGeneration: 2, pageId: ids.page, pageGeneration: 3, frameId: ids.frame, framePath: [0], documentId: ids.document, documentEpoch: 4, semanticDescription: 'Submit button', locatorAst: { kind: 'role', role: 'button', name: 'Submit' }, fingerprint: `sha256:${'a'.repeat(64)}`, createdFromObservationRevision: 5 });
    const observation = { observationId: ids.observation, sessionId: ids.session, observationRevision: 6n, contextGeneration: 2n, pageId: ids.page, pageGeneration: 3n, frameId: ids.frame, documentEpoch: 4n, url: 'https://example.com/', title: 'Example', viewport: { width: 100, height: 100, deviceScaleFactor: 1 }, semanticSnapshot: {}, networkSummary: {}, consoleSummary: {}, screenshotArtifactId: null, digest: `sha256:${'b'.repeat(64)}`, observedAt: '2026-09-04T00:00:00.000Z' };
    expect(() => assertObservationFence(reference, observation)).not.toThrow();
    expect(() => assertObservationFence(reference, { ...observation, pageGeneration: 4n })).toThrow('BROWSER_TARGET_REFERENCE_STALE');
    expect(() => assertObservationFence(reference, { ...observation, documentEpoch: 5n })).toThrow('BROWSER_TARGET_REFERENCE_STALE');
  });
});
