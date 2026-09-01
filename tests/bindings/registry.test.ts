import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BindingRegistry, bindingKinds, pinRuntimeBinding, type ExactBindingRecord, type RuntimeBindingRequest } from '../../packages/domain/src/binding-registry.js';

const digest = (seed: string): `sha256:${string}` => `sha256:${createHash('sha256').update(seed).digest('hex')}`;

function record(kind: ExactBindingRecord['bindingKind'] = 'ROUTE_BINDING'): ExactBindingRecord {
  return {
    recordId: 'binding-1', recordKind: 'BINDING_REGISTRY', schemaVersion: '1.0', sourceRelations: [{ sourceRef: 'ssot://55.10/55-10-binding-registry/atom-36' }], canonicalName: 'binding-1', supersedes: [], supersededBy: [], extensions: {},
    bindingId: 'binding-1', bindingKind: kind, bindingRevision: 4n, bindingDigest: digest('binding'),
    sourceObjectId: 'source-1', sourceRevisionId: 'source-revision-1', targetObjectId: 'target-1', targetRevisionId: 'target-revision-1',
    targetOperationOrRoute: 'component.state.read', contractSchemaDigest: digest('schema'), secretVersionSelector: kind === 'SECRET_BINDING' ? { selector: 'ACTIVE' } : null,
    externalTargetOrOrigin: kind === 'EXTERNAL_TARGET_BINDING' ? 'https://api.example.test' : null,
    accountOrTenantConstraint: kind === 'BROWSER_ACCOUNT_BINDING' ? { account: 'owner', tenant: 'default' } : null,
    purpose: 'test:binding', lifecycle: 'ACTIVE', bindingSetRevision: 'binding-set-revision-4', activationSetId: 'activation-set-4', activationEpoch: 9n,
    validFrom: '2020-01-01T00:00:00.000Z', validUntil: null, canonicalWriterId: 'WRITER-BINDING_SET', targetOperationId: 'OP-1', routeOperationId: 'component.state.read',
    contractDigest: digest('contract'), exact: true, requirementIds: ['REQ-1'], authoritySourceRefs: ['ssot://55.10/55-10-binding-registry/atom-36'], canonicalDigest: digest('canonical')
  };
}

function request(overrides: Partial<RuntimeBindingRequest> = {}): RuntimeBindingRequest {
  return {
    bindingId: 'binding-1', bindingRevision: 4n, bindingDigest: digest('binding'), sourceObjectId: 'source-1', sourceRevisionId: 'source-revision-1',
    targetObjectId: 'target-1', targetRevisionId: 'target-revision-1', targetOperationOrRoute: 'component.state.read', contractSchemaDigest: digest('schema'),
    secretVersionSelector: null, externalTargetOrOrigin: null, accountOrTenantConstraint: null, purpose: 'test:binding', bindingSetRevision: 'binding-set-revision-4',
    activationSetId: 'activation-set-4', activationEpoch: 9n, ...overrides
  };
}

describe('TD-04 exact binding registry and runtime pinning', () => {
  it('accepts all nine binding kinds only as active exact records', async () => {
    const generated = JSON.parse(await readFile('contracts/registries/bindings/bindings.json', 'utf8')) as { records: ExactBindingRecord[] };
    const present = new Set(generated.records.map((item) => item.bindingKind));
    expect(bindingKinds.every((kind) => present.has(kind))).toBe(true);
    expect(generated.records.every((item) => item.exact === true && item.activationSetId && item.bindingSetRevision && item.purpose)).toBe(true);
    expect(new BindingRegistry(generated.records).records().length).toBe(generated.records.length);
  });

  it.each(bindingKinds)('rejects a cross-target dispatch for %s', async (kind) => {
    const generated = JSON.parse(await readFile('contracts/registries/bindings/bindings.json', 'utf8')) as { records: ExactBindingRecord[] };
    const source = generated.records.find((item) => item.bindingKind === kind);
    expect(source).toBeDefined();
    if (!source) return;
    const exactRequest: RuntimeBindingRequest = {
      bindingId: source.bindingId, bindingRevision: source.bindingRevision, bindingDigest: source.bindingDigest,
      sourceObjectId: source.sourceObjectId, sourceRevisionId: source.sourceRevisionId, targetObjectId: source.targetObjectId,
      targetRevisionId: source.targetRevisionId, targetOperationOrRoute: source.targetOperationOrRoute, contractSchemaDigest: source.contractSchemaDigest,
      secretVersionSelector: source.secretVersionSelector, externalTargetOrOrigin: source.externalTargetOrOrigin,
      accountOrTenantConstraint: source.accountOrTenantConstraint, purpose: source.purpose, bindingSetRevision: source.bindingSetRevision,
      activationSetId: source.activationSetId, activationEpoch: source.activationEpoch
    };
    expect(() => pinRuntimeBinding(source, { ...exactRequest, targetObjectId: `${source.targetObjectId}-other` })).toThrow('BINDING_TARGET_OBJECT_ID_MISMATCH');
  });

  it.each([
    ['source revision', { sourceRevisionId: 'other-source-revision' }, 'BINDING_SOURCE_REVISION_MISMATCH'],
    ['target revision', { targetRevisionId: 'other-target-revision' }, 'BINDING_TARGET_REVISION_MISMATCH'],
    ['contract schema digest', { contractSchemaDigest: digest('other-schema') }, 'BINDING_CONTRACT_SCHEMA_DIGEST_MISMATCH'],
    ['purpose', { purpose: 'other-purpose' }, 'BINDING_PURPOSE_MISMATCH'],
    ['binding-set revision', { bindingSetRevision: 'other-binding-set' }, 'BINDING_BINDING_SET_REVISION_MISMATCH'],
    ['activation epoch', { activationEpoch: 10n }, 'BINDING_ACTIVATION_EPOCH_MISMATCH'],
    ['external target', { externalTargetOrOrigin: 'https://other.example.test' }, 'BINDING_EXTERNAL_TARGET_MISMATCH']
  ])('rejects cross-target %s before dispatch', (_label, mutation, code) => {
    expect(() => pinRuntimeBinding(record(), request(mutation))).toThrow(code);
  });

  it('rejects stale lifecycle, secret version and account/tenant cross-targets', () => {
    expect(() => pinRuntimeBinding({ ...record(), lifecycle: 'RETIRED' }, request())).toThrow('BINDING_NOT_ACTIVE');
    expect(() => pinRuntimeBinding(record('SECRET_BINDING'), request({ secretVersionSelector: { selector: 'VERSION', version: 2 } }))).toThrow('BINDING_SECRET_VERSION_MISMATCH');
    expect(() => pinRuntimeBinding(record('BROWSER_ACCOUNT_BINDING'), request({ accountOrTenantConstraint: { account: 'other', tenant: 'default' } }))).toThrow('BINDING_ACCOUNT_CONSTRAINT_MISMATCH');
  });

  it('returns a server-derived immutable pin, never caller identity', () => {
    const pin = pinRuntimeBinding(record(), request());
    expect(pin).toMatchObject({ bindingId: 'binding-1', bindingKind: 'ROUTE_BINDING', bindingRevision: 4n, activationEpoch: 9n, bindingSetRevision: 'binding-set-revision-4' });
    expect(Object.keys(pin)).toEqual(expect.arrayContaining(['bindingId', 'bindingDigest', 'targetRevisionId', 'targetOperationOrRoute', 'activationEpoch']));
  });
});
