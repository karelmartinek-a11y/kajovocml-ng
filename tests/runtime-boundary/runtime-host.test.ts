import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildRuntimeLaunchManifest } from '../../packages/worker-runtime/src/runtime-host.js';

const digest = (byte: number) => Buffer.alloc(32, byte);
const sha = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function runtimeRow() {
  return {
    id:'11111111-1111-4111-8111-111111111111',runtime_generation:'7',component_id:'22222222-2222-4222-8222-222222222222',source_revision_id:'33333333-3333-4333-8333-333333333333',release_id:'44444444-4444-4444-8444-444444444444',
    artifact_digest:digest(1),runtime_digest:digest(2),dependency_lock_digest:digest(3),binding_set_revision_id:'55555555-5555-4555-8555-555555555555',activation_epoch:'9',application_deployment_epoch:'10',platform_incarnation_id:'66666666-6666-4666-8666-666666666666',
    systemd_unit_name:'kcml-runtime-host@11111111-1111-4111-8111-111111111111.service',expected_service_class:'kcml-runtime-host',resource_profile_digest:digest(4),namespace_profile_digest:digest(5),seccomp_profile_digest:digest(6),environment_profile_digest:digest(7),fd_profile_digest:digest(8),
    canonical_manifest:{
      runtime:{kind:'NODE24_GENERATED_HANDLER',executable:'runtime/bin/node',executableDigest:sha('node'),nodeBootstrap:'deploy/runtime/kcml-node-bootstrap.mjs',handlerEntrypoint:'handler/index.mjs',handlerDigest:sha('handler'),stateSchemaRevision:'state/v1',cleanupInventoryTemplate:{channels:'close',processTree:'terminate'}},
      tools:[
        {name:'zeta',inputSchema:{type:'object',properties:{value:{type:'string'}}},outputSchema:{type:'object'}},
        {name:'alpha',inputSchema:{type:'object'},outputSchema:{type:'object',properties:{ok:{type:'boolean'}}}}
      ]
    }
  };
}

describe('runtime host launch manifest', () => {
  it('builds the immutable start snapshot from server-side runtime and revision data', () => {
    const manifest = buildRuntimeLaunchManifest(runtimeRow());
    expect(manifest.schemaVersion).toBe('KCML-RUNTIME-LAUNCH-MANIFEST/1');
    expect(manifest.runtimeInstanceId).toBe('11111111-1111-4111-8111-111111111111');
    expect(manifest.runtimeGeneration).toBe('7');
    expect(manifest.systemdUnitName).toBe('kcml-runtime-host@11111111-1111-4111-8111-111111111111.service');
    expect(manifest.handlerEntrypoint).toBe('handler/index.mjs');
    expect(manifest.exportDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(manifest.inputSchemaDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(manifest.outputSchemaDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(manifest.cleanupInventoryTemplate).toEqual({channels:'close',processTree:'terminate'});
  });

  it('rejects duplicate handler tool aliases before any sandbox launch', () => {
    const row = runtimeRow();
    row.canonical_manifest.tools = [row.canonical_manifest.tools[0], row.canonical_manifest.tools[0]];
    expect(() => buildRuntimeLaunchManifest(row)).toThrow('RUNTIME_HANDLER_TOOL_DUPLICATE');
  });

  it('rejects non-canonical generated handler paths', () => {
    const row = runtimeRow();
    row.canonical_manifest.runtime.handlerEntrypoint = '../escape.mjs';
    expect(() => buildRuntimeLaunchManifest(row)).toThrow('RUNTIME_COMPONENT_MANIFEST_INVALID');
  });
});