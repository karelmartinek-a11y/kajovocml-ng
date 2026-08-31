import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('architecture readiness',()=>it('contains all normative production homes',async()=>{for(const path of ['apps/server','apps/runtime-gateway','apps/runtime-host','packages/domain','packages/openai-runtime','contracts/registries','database/baseline','deploy/systemd','deploy/nginx'])await access(path);expect(await readFile('SSOT_CURRENT.md','utf8')).toContain('KájovoCML NG');}));
