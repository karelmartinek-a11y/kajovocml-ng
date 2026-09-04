import type { BrowserInteractionService } from '@kcml/browser-interaction';
import { canonicalDigest, type CanonicalJsonValue, z } from '@kcml/schemas';
import type { Locator, Page } from 'playwright';
import { MAX_BROWSER_ARTIFACT_BYTES } from './artifact-owner.js';

export const automationDefinitionSchema=z.object({name:z.string().min(1),revision:z.number().int().positive(),runtimeBuildId:z.string().min(1),accountBindingId:z.string().uuid().nullable(),allowedOrigins:z.array(z.string().url()),steps:z.array(z.object({key:z.string().min(1),action:z.string().min(1),targetReferenceId:z.string().uuid().nullable(),payload:z.record(z.string(),z.unknown()),precondition:z.record(z.string(),z.unknown()),postcondition:z.record(z.string(),z.unknown()),mutationTrigger:z.string().nullable()}).strict()).min(1)}).strict();
// Passkeys are persisted challenges; the server never holds a passkey private key.
export type AutomationDefinition=z.infer<typeof automationDefinitionSchema>;
export function compileAutomation(value:unknown):AutomationDefinition&{digest:string}{const definition=automationDefinitionSchema.parse(value);return{...definition,digest:canonicalDigest(JSON.parse(JSON.stringify(definition)) as CanonicalJsonValue)};}
export class AutomationRunner{public constructor(private readonly browser:BrowserInteractionService){}public async run(session:{id:string;controlEpoch:bigint;documentEpoch:bigint;observationRevision:bigint},definition:AutomationDefinition,onStep?:(event:unknown)=>void):Promise<unknown[]>{const outcomes:unknown[]=[];const controlEpoch=session.controlEpoch;for(const step of definition.steps){onStep?.({step:step.key,state:'RUNNING'});const outcome=await this.browser.action({sessionId:session.id,action:step.action,targetReferenceId:step.targetReferenceId,payload:step.payload,expectedControlEpoch:controlEpoch,expectedDocumentEpoch:session.documentEpoch,expectedObservationRevision:session.observationRevision});outcomes.push(outcome);if(outcome.phase==='UNKNOWN'||outcome.phase==='FAILED_FINAL')throw new Error(`AUTOMATION_STEP_FAILED:${step.key}`);onStep?.({step:step.key,state:'SUCCEEDED',outcome});}return outcomes;}}

export interface BrowserUploadInput { safeName:string; mimeType:string; content:Buffer; }
export interface CapturedBrowserDownload { safeName:string; sourceUrl:string; mimeType:string; content:Buffer; }

/** Applies only server-resolved artifact bytes; a caller-supplied host path never crosses this boundary. */
export async function setArtifactInputFiles(target:Locator,input:BrowserUploadInput):Promise<void>{
  await target.setInputFiles({name:input.safeName,mimeType:input.mimeType,buffer:input.content});
}

/** Arms the browser event before the trigger and returns only complete, bounded bytes. */
export async function captureArtifactDownload(page:Page,target:Locator):Promise<CapturedBrowserDownload>{
  const downloadPromise=page.waitForEvent('download',{timeout:30_000});
  await target.click({timeout:15_000});
  const download=await downloadPromise;
  const failure=await download.failure();if(failure)throw new Error(`BROWSER_DOWNLOAD_FAILED:${failure}`);
  const stream=await download.createReadStream();if(!stream)throw new Error('BROWSER_DOWNLOAD_STREAM_MISSING');
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of stream){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_BROWSER_ARTIFACT_BYTES){stream.destroy();throw new Error('BROWSER_ARTIFACT_FRAME_TOO_LARGE');}chunks.push(bytes);}
  const suggested=download.suggestedFilename().normalize('NFKC').replace(/[^A-Za-z0-9._-]+/gu,'_').replace(/^\.+/u,'').slice(0,255);
  return{safeName:suggested||'download.bin',sourceUrl:download.url(),mimeType:'application/octet-stream',content:Buffer.concat(chunks,size)};
}
