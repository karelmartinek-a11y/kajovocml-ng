import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserHostRequestSchema } from '@kcml/browser-automation-runtime/host';

const uuid=(digit:string)=>`${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const request={protocol:'KCML-BROWSER-HOST/1',requestId:uuid('1'),deadlineAt:'2026-09-04T15:00:00.000Z',kind:'ACTION',identity:{sessionId:uuid('2'),hostGeneration:'1',contextGeneration:'2',pageId:uuid('3'),pageGeneration:'4',frameId:uuid('4'),documentId:uuid('5'),documentEpoch:'6'},lease:{leaseId:uuid('6'),fencingToken:'7',expiresAt:'2026-09-04T15:00:00.000Z'},actionId:uuid('7'),actionFence:'8',action:'CLICK',locatorAst:{kind:'role',role:'button',name:'Save'},payload:{},allowedOrigins:['https://example.com']} as const;

describe('browser host capability boundary',()=>{
  it('requires the complete server-issued identity, action, and lease fence',()=>{
    expect(browserHostRequestSchema.parse(request).kind).toBe('ACTION');
    const {documentId:_,...withoutDocument}=request.identity;
    expect(()=>browserHostRequestSchema.parse({...request,identity:withoutDocument})).toThrow();
    expect(()=>browserHostRequestSchema.parse({...request,lease:{...request.lease,fencingToken:'0'}})).toThrow();
  });

  it('contains no PostgreSQL authority in the loaded browser-host process graph',()=>{
    const host=readFileSync('packages/browser-automation-runtime/src/host.ts','utf8');
    const entry=readFileSync('apps/browser-host/src/index.ts','utf8');
    expect(host).not.toMatch(/@kcml\/database|\bpg\b|\.query\s*\(/u);
    expect(entry).not.toMatch(/@kcml\/database|createDatabasePool|\.query\s*\(/u);
    expect(entry).toContain('@kcml/browser-automation-runtime/host');
  });
});
