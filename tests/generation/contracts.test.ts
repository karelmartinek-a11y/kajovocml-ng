import { describe, expect, it } from 'vitest';
import { generationJobInputSchema } from '@kcml/schemas';
describe('generation intake',()=>it('rejects empty objectives and accepts a bounded canonical request',()=>{expect(()=>generationJobInputSchema.parse({mode:'CREATE',objective:''})).toThrow();expect(generationJobInputSchema.parse({mode:'REPAIR',objective:'Restore verified release'}).mode).toBe('REPAIR');}));
