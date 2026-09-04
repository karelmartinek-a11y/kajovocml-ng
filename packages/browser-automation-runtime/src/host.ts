import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { browserActionNames, validateBrowserActionDescriptor, z, type BrowserActionName } from '@kcml/schemas';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { BrowserArtifactOwnerClient } from './artifact-owner.js';

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const identitySchema = z.object({
  sessionId: z.string().uuid(), hostGeneration: z.coerce.bigint().positive(), contextGeneration: z.coerce.bigint().positive(),
  pageId: z.string().uuid(), pageGeneration: z.coerce.bigint().positive(), frameId: z.string().uuid(), documentId: z.string().uuid(), documentEpoch: z.coerce.bigint().nonnegative()
}).strict();
const leaseSchema = z.object({ leaseId: z.string().uuid(), fencingToken: z.coerce.bigint().positive(), expiresAt: z.string().datetime({ offset: true }) }).strict();
const requestBase = { protocol: z.literal('KCML-BROWSER-HOST/1'), requestId: z.string().uuid(), deadlineAt: z.string().datetime({ offset: true }) } as const;
export const browserHostRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...requestBase, kind: z.literal('ATTACH'), identity: identitySchema, lease: leaseSchema, initialUrl: z.string().url().nullable() }).strict(),
  z.object({ ...requestBase, kind: z.literal('SYNCHRONIZE'), identity: identitySchema, lease: leaseSchema }).strict(),
  z.object({ ...requestBase, kind: z.literal('ACTION'), identity: identitySchema, lease: leaseSchema, actionId: z.string().uuid(), actionFence: z.coerce.bigint().positive(), action: z.enum(browserActionNames), locatorAst: z.record(z.string(),z.unknown()).nullable(), payload: z.record(z.string(),z.unknown()), allowedOrigins: z.array(z.string().url()).min(1).max(64) }).strict(),
  z.object({ ...requestBase, kind: z.literal('OBSERVE'), identity: identitySchema, lease: leaseSchema }).strict(),
  z.object({ ...requestBase, kind: z.literal('CLOSE'), identity: identitySchema, lease: leaseSchema }).strict(),
  z.object({ ...requestBase, kind: z.literal('STATUS') }).strict()
]);
export type BrowserHostRequest = z.infer<typeof browserHostRequestSchema>;
export const browserHostResponseSchema = z.object({ protocol:z.literal('KCML-BROWSER-HOST/1'),requestId:z.string().uuid(),ok:z.boolean(),runtimeBuildId:z.string().min(1),evidence:z.record(z.string(),z.unknown()).optional(),error:z.object({code:z.string(),message:z.string()}).strict().optional() }).strict();
export type BrowserHostResponse = z.infer<typeof browserHostResponseSchema>;

export class BrowserHostProtocolClient {
  public constructor(private readonly socketPath:string) {}
  public invoke(request:BrowserHostRequest):Promise<BrowserHostResponse> {
    const validated=browserHostRequestSchema.parse(request);
    return new Promise((resolve,reject)=>{const socket=createConnection(this.socketPath);let pending='';const timeout=Math.max(1,new Date(validated.deadlineAt).getTime()-Date.now());
      socket.setTimeout(timeout,()=>socket.destroy(new Error('BROWSER_HOST_DEADLINE_EXCEEDED')));socket.once('error',reject);
      socket.on('data',(chunk:Buffer)=>{pending+=chunk.toString('utf8');if(Buffer.byteLength(pending)>MAX_FRAME_BYTES){socket.destroy(new Error('BROWSER_HOST_FRAME_TOO_LARGE'));return;}const newline=pending.indexOf('\n');if(newline<0)return;try{const response=browserHostResponseSchema.parse(JSON.parse(pending.slice(0,newline)));if(response.requestId!==validated.requestId)throw new Error('BROWSER_HOST_REQUEST_MISMATCH');socket.end();resolve(response);}catch(error){socket.destroy();reject(error);}});
      socket.once('connect',()=>socket.write(`${JSON.stringify(validated,(_,value)=>typeof value==='bigint'?value.toString():value)}\n`));
    });
  }
}

interface ManagedContext { context:BrowserContext;page:Page;identity:z.infer<typeof identitySchema>;lease:z.infer<typeof leaseSchema>;lastActionFence:bigint; }
export interface BrowserHostProtocolOptions { socketPath:string;artifactOwnerSocketPath:string;runtimeBuildId:string;headless?:boolean; }

function sameIdentity(left:z.infer<typeof identitySchema>,right:z.infer<typeof identitySchema>):boolean {
  return left.sessionId===right.sessionId && left.hostGeneration===right.hostGeneration && left.contextGeneration===right.contextGeneration && left.pageId===right.pageId && left.pageGeneration===right.pageGeneration && left.frameId===right.frameId && left.documentId===right.documentId && left.documentEpoch===right.documentEpoch;
}
function currentOrigin(page:Page):string { const url=new URL(page.url()); return url.origin; }
function exactOriginAllowed(origin:string,allowedOrigins:readonly string[]):boolean { return allowedOrigins.some(value=>new URL(value).origin===origin); }

/** External-effect adapter only. It has no database credential and accepts work
 * exclusively through a fenced, typed UDS protocol owned by BrowserSessionService. */
export class BrowserHostProtocolServer {
  #browser:Browser|null=null; #server:Server|null=null; readonly #contexts=new Map<string,ManagedContext>(); readonly #artifacts:BrowserArtifactOwnerClient;
  public constructor(private readonly options:BrowserHostProtocolOptions) { this.#artifacts=new BrowserArtifactOwnerClient(options.artifactOwnerSocketPath); }

  public async start():Promise<void> {
    await mkdir(dirname(this.options.socketPath),{recursive:true,mode:0o750});
    await unlink(this.options.socketPath).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
    this.#browser=await chromium.launch({headless:this.options.headless??true,args:['--disable-dev-shm-usage','--no-first-run','--disable-background-networking']});
    this.#server=createServer(socket=>this.accept(socket));
    await new Promise<void>((resolve,reject)=>{this.#server!.once('error',reject);this.#server!.listen(this.options.socketPath,()=>{this.#server!.off('error',reject);resolve();});});
    await chmod(this.options.socketPath,0o660);
  }
  public async stop():Promise<void> {
    await new Promise<void>(resolve=>this.#server?.close(()=>resolve())??resolve());this.#server=null;
    for(const managed of this.#contexts.values())await managed.context.close().catch(()=>undefined);this.#contexts.clear();
    await this.#browser?.close();this.#browser=null;await unlink(this.options.socketPath).catch(()=>undefined);
  }

  private accept(socket:Socket):void {
    let pending='';
    socket.setTimeout(35_000,()=>socket.destroy(new Error('BROWSER_HOST_IDLE_TIMEOUT')));
    socket.on('data',(chunk:Buffer)=>{pending+=chunk.toString('utf8');if(Buffer.byteLength(pending)>MAX_FRAME_BYTES){socket.destroy(new Error('BROWSER_HOST_FRAME_TOO_LARGE'));return;}for(;;){const newline=pending.indexOf('\n');if(newline<0)return;const frame=pending.slice(0,newline);pending=pending.slice(newline+1);void this.respond(socket,frame);}});
  }
  private async respond(socket:Socket,frame:string):Promise<void> {
    let requestId:string=randomUUID();
    try { const parsed=JSON.parse(frame) as {requestId?:unknown};if(typeof parsed.requestId==='string')requestId=parsed.requestId;const request=browserHostRequestSchema.parse(parsed);if(new Date(request.deadlineAt).getTime()<=Date.now())throw new Error('BROWSER_HOST_DEADLINE_EXCEEDED');const evidence=await this.handle(request);this.write(socket,{protocol:'KCML-BROWSER-HOST/1',requestId:request.requestId,ok:true,runtimeBuildId:this.options.runtimeBuildId,evidence}); }
    catch(error){this.write(socket,{protocol:'KCML-BROWSER-HOST/1',requestId,ok:false,runtimeBuildId:this.options.runtimeBuildId,error:{code:error instanceof Error?error.message.split(':')[0]!:'BROWSER_HOST_FAILURE',message:error instanceof Error?error.message:String(error)}});}
  }
  private write(socket:Socket,response:BrowserHostResponse):void { const line=`${JSON.stringify(response,(_,value)=>typeof value==='bigint'?value.toString():value)}\n`;if(Buffer.byteLength(line)>MAX_FRAME_BYTES)throw new Error('BROWSER_HOST_FRAME_TOO_LARGE');socket.write(line); }

  private current(request:Exclude<BrowserHostRequest,{kind:'STATUS'}>):ManagedContext {
    const managed=this.#contexts.get(request.identity.sessionId);if(!managed)throw new Error('BROWSER_HOST_CONTEXT_MISSING');
    if(!sameIdentity(managed.identity,request.identity))throw new Error('BROWSER_HOST_IDENTITY_STALE');
    if(managed.lease.leaseId!==request.lease.leaseId || managed.lease.fencingToken!==request.lease.fencingToken || new Date(request.lease.expiresAt).getTime()<=Date.now())throw new Error('BROWSER_HOST_LEASE_STALE');
    return managed;
  }
  private async handle(request:BrowserHostRequest):Promise<Record<string,unknown>> {
    if(request.kind==='STATUS')return {status:'READY',contexts:this.#contexts.size,protocol:'KCML-BROWSER-HOST/1'};
    if(request.kind==='ATTACH') {
      if(this.#contexts.has(request.identity.sessionId))throw new Error('BROWSER_HOST_CONTEXT_EXISTS');if(!this.#browser)throw new Error('BROWSER_HOST_NOT_STARTED');
      const context=await this.#browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},locale:'cs-CZ',timezoneId:'Europe/Prague',serviceWorkers:'block'});const page=await context.newPage();
      const managed={context,page,identity:request.identity,lease:request.lease,lastActionFence:0n};this.#contexts.set(request.identity.sessionId,managed);page.on('close',()=>this.#contexts.delete(request.identity.sessionId));
      if(request.initialUrl)await page.goto(request.initialUrl,{waitUntil:'domcontentloaded',timeout:30_000});return {attached:true,url:page.url()};
    }
    if(request.kind==='SYNCHRONIZE'){const managed=this.#contexts.get(request.identity.sessionId);if(!managed)throw new Error('BROWSER_HOST_CONTEXT_MISSING');if(managed.lease.fencingToken>request.lease.fencingToken)throw new Error('BROWSER_HOST_LEASE_STALE');managed.identity=request.identity;managed.lease=request.lease;return {synchronized:true};}
    const managed=this.current(request);
    if(request.kind==='CLOSE'){await managed.context.close();this.#contexts.delete(request.identity.sessionId);return {closed:true};}
    if(request.kind==='OBSERVE')return this.observe(managed,randomUUID(),managed.lastActionFence+1n);
    if(request.actionFence<=managed.lastActionFence)throw new Error('BROWSER_HOST_ACTION_FENCE_STALE');
    const descriptor=validateBrowserActionDescriptor(request.action,request.locatorAst?request.actionId:null,request.payload);
    const origin=request.action==='NAVIGATE'?new URL(String(request.payload.url)).origin:currentOrigin(managed.page);if(!exactOriginAllowed(origin,request.allowedOrigins))throw new Error('BROWSER_HOST_ORIGIN_DENIED');
    managed.lastActionFence=request.actionFence;
    const locator=request.locatorAst?this.resolveLocator(managed.page,request.locatorAst):null;const dispatched=await this.dispatch(managed.page,request.action,locator,request.payload);
    return {actionId:request.actionId,actionFence:request.actionFence.toString(),descriptor,origin,...dispatched,observation:await this.observe(managed,request.actionId,request.actionFence)};
  }
  private resolveLocator(page:Page,ast:Record<string,unknown>):Locator {const kind=String(ast.kind??'');if(kind==='role')return page.getByRole(String(ast.role) as never,{exact:ast.exact===true,...(typeof ast.name==='string'?{name:ast.name}:{})});if(kind==='label')return page.getByLabel(String(ast.label),{exact:ast.exact===true});if(kind==='text')return page.getByText(String(ast.text),{exact:ast.exact===true});if(kind==='testId')return page.getByTestId(String(ast.testId));throw new Error('BROWSER_LOCATOR_KIND_DENIED');}
  private async dispatch(page:Page,action:BrowserActionName,target:Locator|null,payload:Record<string,unknown>):Promise<Record<string,unknown>> {
    switch(action){case'NAVIGATE':await page.goto(String(payload.url),{waitUntil:'domcontentloaded',timeout:30_000});return{mutationTriggerObserved:false,navigationObserved:true};case'CLICK':await target!.click({timeout:15_000});return{mutationTriggerObserved:true};case'FILL':await target!.fill(String(payload.value));return{mutationTriggerObserved:true};case'TYPE':await target!.pressSequentially(String(payload.value),{delay:Math.min(Number(payload.delayMs??25),250)});return{mutationTriggerObserved:true};case'KEYBOARD':await page.keyboard.press(String(payload.key));return{mutationTriggerObserved:true};case'POINTER':await page.mouse.click(Number(payload.x),Number(payload.y));return{mutationTriggerObserved:true};case'TOUCH':await page.touchscreen.tap(Number(payload.x),Number(payload.y));return{mutationTriggerObserved:true};case'DOWNLOAD':case'UPLOAD':throw new Error('BROWSER_ARTIFACT_OWNER_PORT_REQUIRED');case'DIALOG':case'PERMISSION':case'CHALLENGE':return{mutationTriggerObserved:false,challengeRequired:true,challengeType:action};case'OBSERVE':return{mutationTriggerObserved:false,readOnly:true};}
  }
  private async observe(managed:ManagedContext,actionId:string,actionFence:bigint):Promise<Record<string,unknown>> {const screenshot=await managed.page.screenshot({type:'jpeg',quality:72,fullPage:false});const digest=createHash('sha256').update(screenshot).digest('hex');const stored=await this.#artifacts.put({sessionId:managed.identity.sessionId,actionId,actionFence,contentDigest:`sha256:${digest}`,sizeBytes:screenshot.length,mimeType:'image/jpeg',contentBase64:screenshot.toString('base64')});if(!stored.ok||!stored.artifact)throw new Error(stored.error?.code??'BROWSER_ARTIFACT_PERSIST_FAILED');return{url:managed.page.url(),title:await managed.page.title(),identity:managed.identity,semanticSnapshot:{aria:await managed.page.locator('body').ariaSnapshot({timeout:10_000}).catch(()=>''),frames:managed.page.frames().map(frame=>({url:frame.url(),name:frame.name()}))},screenshotCandidate:stored.artifact,observedAt:new Date().toISOString()};}
}
