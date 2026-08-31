import { describe, expect, it } from 'vitest';
import { assertNoUntrustedAuthority, compileProvenance } from '@kcml/content-provenance';
import { canonicalDigest } from '@kcml/schemas';
describe('semantic authority',()=>it('never grants authority from retrieved content',()=>{const now=new Date().toISOString();const envelope=compileProvenance({sources:[{sourceRef:'web:1',sourceKind:'TOOL_RESULT',trustClass:'UNTRUSTED_CONTENT',contentDigest:canonicalDigest('x'),observedAt:now}],derivations:[],untrustedInstructionsIgnored:[]});expect(()=>assertNoUntrustedAuthority(envelope,['web:1'])).toThrow('UNTRUSTED_CONTENT_CANNOT_GRANT_AUTHORITY');}));
