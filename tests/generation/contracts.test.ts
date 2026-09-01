import { describe, expect, it } from 'vitest';
import { generationJobInputSchema } from '@kcml/schemas';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenerationWorkspace } from '../../packages/generation-workspace/src/index.js';
import { GENERATION_PHASES, PHASE_RUN_STATES } from '../../packages/domain/src/generation-lifecycle.js';
describe('generation intake',()=>it('rejects empty objectives and accepts a bounded canonical request',()=>{expect(()=>generationJobInputSchema.parse({mode:'CREATE',objective:''})).toThrow();expect(generationJobInputSchema.parse({mode:'REPAIR',objective:'Restore verified release'}).mode).toBe('REPAIR');}));

describe('generation persisted contract',()=>{
  it('exposes only the SSOT lifecycle and its linear happy path',()=>{
    expect(GENERATION_PHASES).toEqual(['DISCUSSING','ANALYZING','IMPLEMENTING','INTEGRATING','VALIDATING','CML_CONFORMANCE','ACTIVATING']);
    expect(PHASE_RUN_STATES).toEqual(['QUEUED','RUNNING','WAITING_FOR_DEPENDENCY','WAITING_FOR_OWNER','REPAIRING','SUCCEEDED','FAILED','CANCEL_REQUESTED','CANCELLED']);
    expect(GENERATION_PHASES).not.toContain('INTAKE' as never);
  });

  it('publishes a complete workspace snapshot through an atomic pointer',async()=>{
    const root=await mkdtemp(join(tmpdir(),'kcml-generation-'));try{
      const workspace=new GenerationWorkspace(root);
      const published=await workspace.materializeSnapshotAtomic(7n,[{path:'src/generated.ts',content:Buffer.from('export const generated = true;\n')}]);
      expect(published.revision).toBe(7n);
      expect(await workspace.currentMaterializedRevision()).toBe(7n);
      await expect(readFile(join(root,'.kcml-versions','7','src/generated.ts'),'utf8')).resolves.toContain('generated = true');
    }finally{await rm(root,{recursive:true,force:true});}
  });

  it('keeps the published revision when snapshot staging fails before pointer publish',async()=>{
    const root=await mkdtemp(join(tmpdir(),'kcml-generation-crash-'));try{
      const workspace=new GenerationWorkspace(root);
      await workspace.materializeSnapshotAtomic(1n,[{path:'stable.txt',content:Buffer.from('stable\n')}]);
      await expect(workspace.materializeSnapshotAtomic(2n,[
        {path:'partial.txt',content:Buffer.from('partial\n')},
        {path:'partial.txt',content:Buffer.from('duplicate\n')}
      ])).rejects.toThrow();
      expect(await workspace.currentMaterializedRevision()).toBe(1n);
      await expect(readFile(join(root,'.kcml-versions','1','stable.txt'),'utf8')).resolves.toBe('stable\n');
      await expect(readdir(join(root,'.kcml-versions'))).resolves.toEqual(expect.not.arrayContaining([expect.stringMatching(/^\.staging-/u)]));
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
