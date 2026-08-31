import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signRequest, verifyRequest } from '@kcml/runtime-capability-ipc';
describe('runtime capability channel',()=>it('authenticates execution, payload and deadline',()=>{const key=Buffer.alloc(32,5);const request=signRequest({protocol:'KCML-CAPABILITY-IPC/1',requestId:randomUUID(),executionId:randomUUID(),capability:'STATE_READ',operation:'state.read',payload:{key:'a'},deadlineAt:new Date(Date.now()+5000).toISOString()},key);expect(verifyRequest(request,key)).toEqual(request);expect(()=>verifyRequest({...request,payload:{key:'b'}},key)).toThrow('IPC_AUTHENTICATION_FAILED');}));
