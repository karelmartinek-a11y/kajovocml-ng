import type { BrowserInteractionService } from '@kcml/browser-interaction';
import { canonicalDigest, type CanonicalJsonValue, z } from '@kcml/schemas';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { DatabasePool } from '@kcml/database';
import { inTransaction } from '@kcml/database';

function requiredSourceSha(): string {
  const value = process.env.KCML_SOURCE_SHA;
  if (!value || !/^[0-9a-f]{40}$/iu.test(value)) throw new Error('KCML_SOURCE_SHA_REQUIRED');
  return value.toLowerCase();
}

export const automationDefinitionSchema=z.object({name:z.string().min(1),revision:z.number().int().positive(),runtimeBuildId:z.string().min(1),accountBindingId:z.string().uuid().nullable(),allowedOrigins:z.array(z.string().url()),steps:z.array(z.object({key:z.string().min(1),action:z.string().min(1),targetReferenceId:z.string().uuid().nullable(),payload:z.record(z.string(),z.unknown()),precondition:z.record(z.string(),z.unknown()),postcondition:z.record(z.string(),z.unknown()),mutationTrigger:z.string().nullable()}).strict()).min(1)}).strict();
export type AutomationDefinition=z.infer<typeof automationDefinitionSchema>;
export function compileAutomation(value:unknown):AutomationDefinition&{digest:string}{const definition=automationDefinitionSchema.parse(value);return{...definition,digest:canonicalDigest(JSON.parse(JSON.stringify(definition)) as CanonicalJsonValue)};}
export class AutomationRunner{public constructor(private readonly browser:BrowserInteractionService){}public async run(session:{id:string;controlEpoch:bigint;documentEpoch:bigint;observationRevision:bigint},definition:AutomationDefinition,onStep?:(event:unknown)=>void):Promise<unknown[]>{const outcomes:unknown[]=[];let controlEpoch=session.controlEpoch;for(const step of definition.steps){onStep?.({step:step.key,state:'RUNNING'});const outcome=await this.browser.action({sessionId:session.id,action:step.action,targetReferenceId:step.targetReferenceId,payload:step.payload,expectedControlEpoch:controlEpoch,expectedDocumentEpoch:session.documentEpoch,expectedObservationRevision:session.observationRevision});outcomes.push(outcome);if(outcome.phase==='UNKNOWN'||outcome.phase==='FAILED_FINAL')throw new Error(`AUTOMATION_STEP_FAILED:${step.key}`);onStep?.({step:step.key,state:'SUCCEEDED',outcome});}return outcomes;}}

interface ManagedContext{context:BrowserContext;page:Page;contextGeneration:bigint;pageId:string;frameId:string;documentEpoch:bigint;observationRevision:bigint;}
export interface ManagedBrowserHostOptions{artifactRoot:string;runtimeBuildId:string;headless?:boolean;}

export class ManagedBrowserHost{
  #browser:Browser|null=null;
  readonly #contexts=new Map<string,ManagedContext>();
  readonly #hostId=randomUUID();
  #platformIncarnationId:string|null=null;
  #applicationDeploymentEpoch:bigint|null=null;
  public constructor(private readonly pool:DatabasePool,private readonly options:ManagedBrowserHostOptions){}

  public async start():Promise<void>{
    await mkdir(this.options.artifactRoot,{recursive:true,mode:0o700});
    const authority=(await this.pool.query(`SELECT p.platform_incarnation_id,d.current_epoch AS application_deployment_epoch
      FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d
      WHERE p.singleton_key=1 AND d.singleton_key=1`)).rows[0];
    if(!authority)throw new Error('BROWSER_HOST_AUTHORITY_MISSING');
    this.#platformIncarnationId=String(authority.platform_incarnation_id);this.#applicationDeploymentEpoch=BigInt(authority.application_deployment_epoch);
    this.#browser=await chromium.launch({headless:this.options.headless??true,args:['--disable-dev-shm-usage','--no-first-run','--disable-background-networking']});
    await this.heartbeat('READY');
  }
  public async stop():Promise<void>{await this.heartbeat('DRAINING');for(const managed of this.#contexts.values())await managed.context.close().catch(()=>undefined);this.#contexts.clear();await this.#browser?.close();this.#browser=null;}
  public async tick():Promise<void>{await this.attachOne();await this.executeOne();await this.heartbeat('READY');}

  private async attachOne():Promise<void>{
    const result=await this.pool.query(`SELECT * FROM kcml.browser_session WHERE execution_target='SERVER_MANAGED' AND lifecycle IN('CREATING','RECOVERING') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
    const session=result.rows[0];if(!session||this.#contexts.has(session.id))return;if(!this.#browser)throw new Error('BROWSER_HOST_NOT_STARTED');
    const context=await this.#browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900},locale:'cs-CZ',timezoneId:'Europe/Prague',serviceWorkers:'block'});const page=await context.newPage();
    const pageId=randomUUID();const frameId=randomUUID();const contextGeneration=BigInt(session.context_generation)+1n;
    const managed={context,page,contextGeneration,pageId,frameId,documentEpoch:BigInt(session.document_epoch)+1n,observationRevision:BigInt(session.observation_revision)};this.#contexts.set(session.id,managed);
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())managed.documentEpoch+=1n;});page.on('close',()=>this.#contexts.delete(session.id));
    if(session.current_url)await page.goto(session.current_url,{waitUntil:'domcontentloaded',timeout:30_000}).catch(()=>undefined);
    await this.pool.query(`UPDATE kcml.browser_session SET host_or_bridge_id=$2,runtime_build_id=$3,context_generation=$4,page_generation=page_generation+1,current_page_id=$5,current_frame_id=$6,document_epoch=$7,lifecycle='AI_CONTROLLED',control_holder='AI',control_epoch=control_epoch+1,control_fence=control_fence+1,control_expires_at=clock_timestamp()+interval '5 minutes',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1 AND lifecycle IN('CREATING','RECOVERING')`,[session.id,this.#hostId,this.options.runtimeBuildId,contextGeneration.toString(),pageId,frameId,managed.documentEpoch.toString()]);
    await this.observe(session.id,managed);
  }

  private async executeOne():Promise<void>{
    const claim=await inTransaction(this.pool,'READ COMMITTED',async client=>{const result=await client.query(`SELECT a.*,s.control_epoch,s.document_epoch,s.observation_revision,s.control_holder,s.context_generation FROM kcml.browser_action_run a JOIN kcml.browser_session s ON s.id=a.session_id WHERE a.dispatch_phase='INTENT_RECORDED' ORDER BY a.created_at FOR UPDATE OF a SKIP LOCKED LIMIT 1`);const row=result.rows[0];if(!row)return null;if(BigInt(row.expected_control_epoch)!==BigInt(row.control_epoch)||BigInt(row.expected_document_epoch)!==BigInt(row.document_epoch)||BigInt(row.expected_observation_revision)!==BigInt(row.observation_revision)){await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase='FAILED_FINAL',outcome=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id,{code:'BROWSER_FENCE_CONFLICT'}]);return null;}await client.query(`UPDATE kcml.browser_action_run SET dispatch_phase='PRECONDITION_VERIFIED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[row.id]);return row;});
    if(!claim)return;const managed=this.#contexts.get(claim.session_id);if(!managed){await this.pool.query(`UPDATE kcml.browser_action_run SET dispatch_phase='UNKNOWN',outcome=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.id,{code:'BROWSER_CONTEXT_UNAVAILABLE'}]);await this.pool.query(`UPDATE kcml.browser_session SET lifecycle='RECOVERING',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.session_id]);return;}
    let possibleSideEffect=false;
    try{await this.pool.query(`UPDATE kcml.browser_action_run SET dispatch_phase='DISPATCH_AUTHORIZED',state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.id]);const target=claim.target_reference_id?await this.pool.query(`SELECT * FROM kcml.browser_target_reference WHERE id=$1`,[claim.target_reference_id]).then(value=>value.rows[0]):null;const locator=target?this.resolveLocator(managed.page,target.locator_ast):null;possibleSideEffect=await this.dispatch(managed.page,claim.action,locator,claim.payload);if(possibleSideEffect)await this.pool.query(`UPDATE kcml.browser_action_run SET dispatch_phase='POSSIBLE_EFFECT',earliest_mutation_trigger=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.id,claim.action]);const observation=await this.observe(claim.session_id,managed);await this.pool.query(`UPDATE kcml.browser_action_run SET dispatch_phase='CONFIRMED_APPLIED',outcome=$2,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.id,{possibleSideEffect,postcondition:'OBSERVATION_COMMITTED',observationId:observation.id,observationRevision:observation.revision}]);}
    catch(error){await this.pool.query(`UPDATE kcml.browser_action_run SET dispatch_phase=$2,outcome=$3,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[claim.id,possibleSideEffect?'UNKNOWN':'FAILED_FINAL',{code:'BROWSER_ACTION_FAILED',message:error instanceof Error?error.message:String(error),possibleSideEffect}]);}
  }

  private resolveLocator(page:Page,ast:Record<string,unknown>):Locator{const kind=String(ast.kind??'role');if(kind==='role')return page.getByRole(String(ast.role??'button') as never,{exact:ast.exact===true,...(typeof ast.name==='string'?{name:ast.name}:{})});if(kind==='label')return page.getByLabel(String(ast.label),{exact:ast.exact===true});if(kind==='text')return page.getByText(String(ast.text),{exact:ast.exact===true});if(kind==='testId')return page.getByTestId(String(ast.testId));throw new Error('BROWSER_LOCATOR_KIND_DENIED');}
  private async dispatch(page:Page,action:string,target:Locator|null,payload:Record<string,unknown>):Promise<boolean>{switch(action){case'NAVIGATE':await page.goto(String(payload.url),{waitUntil:'domcontentloaded',timeout:30_000});return true;case'CLICK':if(!target)throw new Error('BROWSER_TARGET_REQUIRED');await target.click({timeout:15_000});return true;case'FILL':if(!target)throw new Error('BROWSER_TARGET_REQUIRED');await target.fill(String(payload.value));return true;case'TYPE':if(!target)throw new Error('BROWSER_TARGET_REQUIRED');await target.pressSequentially(String(payload.value),{delay:Math.min(Number(payload.delayMs??25),250)});return true;case'KEYBOARD':await page.keyboard.press(String(payload.key));return true;case'POINTER':await page.mouse.click(Number(payload.x),Number(payload.y),{button:payload.button==='right'?'right':'left'});return true;case'TOUCH':await page.touchscreen.tap(Number(payload.x),Number(payload.y));return true;case'UPLOAD':if(!target)throw new Error('BROWSER_TARGET_REQUIRED');{const file=String(payload.path??'');if(!file)throw new Error('BROWSER_UPLOAD_PATH_REQUIRED');await access(file);await target.setInputFiles(file);return true;}case'DOWNLOAD':{const downloadPromise=page.waitForEvent('download',{timeout:30_000});if(!target)throw new Error('BROWSER_TARGET_REQUIRED');await target.click({timeout:15_000});const download=await downloadPromise;const destination=String(payload.path??'');if(!destination)throw new Error('BROWSER_DOWNLOAD_PATH_REQUIRED');await download.saveAs(destination);return true;}case'CHALLENGE':{const kind=String(payload.kind??'CAPTCHA');const challengeKinds=['CAPTCHA','OTP','PUSH','WEBAUTHN','PASSKEY','CLIENT_CERTIFICATE'];if(!challengeKinds.includes(kind))throw new Error('BROWSER_CHALLENGE_KIND_UNSUPPORTED');throw new Error(`BROWSER_CHALLENGE_REQUIRED:${kind.toLowerCase()}`);}case'PASSKEY':{const passkey='passkey';throw new Error(`BROWSER_CHALLENGE_REQUIRED:${passkey}`);}case'OBSERVE':return false;default:throw new Error(`BROWSER_ACTION_UNSUPPORTED:${action}`);}}

  private async observe(sessionId:string,managed:ManagedContext):Promise<{id:string;revision:string}>{
    managed.observationRevision+=1n;const id=randomUUID();const title=await managed.page.title();const url=managed.page.url()||'about:blank';const semanticSnapshot={aria:await managed.page.locator('body').ariaSnapshot({timeout:10_000}).catch(()=>''),frames:managed.page.frames().map(frame=>({url:frame.url(),name:frame.name()}))};const screenshot=await managed.page.screenshot({type:'jpeg',quality:72,fullPage:false});const artifactName=`${sessionId}-${managed.observationRevision}.jpg`;await writeFile(join(this.options.artifactRoot,artifactName),screenshot,{mode:0o600});const document={sessionId,revision:managed.observationRevision.toString(),contextGeneration:managed.contextGeneration.toString(),pageId:managed.pageId,frameId:managed.frameId,documentEpoch:managed.documentEpoch.toString(),url,title,semanticSnapshot,artifactName};const digest=canonicalDigest(JSON.parse(JSON.stringify(document)) as CanonicalJsonValue);
    await inTransaction(this.pool,'SERIALIZABLE',async client=>{await client.query(`INSERT INTO kcml.browser_observation(id,session_id,observation_revision,context_generation,page_id,page_generation,frame_id,document_epoch,url,title,semantic_snapshot,network_summary,console_summary,canonical_digest)VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,'{}','{}',$11)`,[id,sessionId,managed.observationRevision.toString(),managed.contextGeneration.toString(),managed.pageId,managed.frameId,managed.documentEpoch.toString(),url,title,semanticSnapshot,Buffer.from(digest.slice(7),'hex')]);await client.query(`UPDATE kcml.browser_session SET current_url=$2,document_epoch=$3,observation_revision=$4,state_version=state_version+1,updated_at=clock_timestamp() WHERE id=$1`,[sessionId,url,managed.documentEpoch.toString(),managed.observationRevision.toString()]);});return{id,revision:managed.observationRevision.toString()};
  }
  private async heartbeat(status:'READY'|'DRAINING'):Promise<void>{
    if(!this.#platformIncarnationId||this.#applicationDeploymentEpoch===null)throw new Error('BROWSER_HOST_AUTHORITY_NOT_PINNED');
    const written=await this.pool.query(`INSERT INTO kcml.platform_worker_heartbeat(service_name,instance_id,release_id,source_sha,deployment_epoch,platform_incarnation_id,heartbeat_sequence,nonce,status,details,expires_at)
      SELECT 'kcml-browser-host',$1,$2,$3,$4,$5,1,$6,$7,$8,clock_timestamp()+interval '30 seconds'
      WHERE EXISTS (SELECT 1 FROM kcml.platform_incarnation p CROSS JOIN kcml.application_deployment_head d WHERE p.singleton_key=1 AND d.singleton_key=1 AND p.platform_incarnation_id=$5 AND d.current_epoch=$4)
      ON CONFLICT(service_name,instance_id)DO UPDATE SET status=EXCLUDED.status,details=EXCLUDED.details,observed_at=clock_timestamp(),expires_at=EXCLUDED.expires_at,heartbeat_sequence=kcml.platform_worker_heartbeat.heartbeat_sequence+1,nonce=EXCLUDED.nonce
      WHERE kcml.platform_worker_heartbeat.platform_incarnation_id=EXCLUDED.platform_incarnation_id AND kcml.platform_worker_heartbeat.deployment_epoch=EXCLUDED.deployment_epoch RETURNING heartbeat_sequence`,[
      this.#hostId,process.env.KCML_RELEASE_ID??'development',requiredSourceSha(),this.#applicationDeploymentEpoch.toString(),this.#platformIncarnationId,randomUUID(),status,{contexts:this.#contexts.size,runtimeBuildId:this.options.runtimeBuildId}
    ]);if(written.rowCount!==1)throw new Error('BROWSER_HOST_HEARTBEAT_AUTHORITY_STALE');
  }
}
