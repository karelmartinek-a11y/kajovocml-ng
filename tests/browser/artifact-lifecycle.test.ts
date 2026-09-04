import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserArtifactOwnerClient, BrowserArtifactOwnerServer } from '../../packages/browser-automation-runtime/src/artifact-owner.js';
import { BrowserHostProtocolClient, BrowserHostProtocolServer, type BrowserHostRequest } from '../../packages/browser-automation-runtime/src/host.js';

describe('browser artifact and owner-challenge lifecycle',()=>{
  const cleanups:Array<()=>Promise<void>>=[];
  afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});

  it('uses opaque upload bytes, pre-arms a complete download, and reports passkey challenge',async()=>{
    const root=await mkdtemp(join(tmpdir(),'kcml-browser-artifact-lifecycle-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
    const pageServer=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(`<!doctype html><title>initial</title><label>Upload<input type="file" aria-label="Upload"></label><a download="proof.txt" href="data:text/plain,download-proof">Download</a><script>document.querySelector('input').addEventListener('change',event=>document.title=event.target.files[0].name)</script>`);});
    await new Promise<void>((resolve,reject)=>{pageServer.once('error',reject);pageServer.listen(0,'127.0.0.1',resolve);});cleanups.push(()=>new Promise<void>(resolve=>pageServer.close(()=>resolve())));
    const address=pageServer.address();if(!address||typeof address==='string')throw new Error('TEST_HTTP_ADDRESS_MISSING');const url=`http://127.0.0.1:${address.port}/`;
    const artifactSocket=join(root,'artifact.sock'),hostSocket=join(root,'host.sock'),artifactRoot=join(root,'artifacts');const artifactOwner=new BrowserArtifactOwnerServer(artifactSocket,artifactRoot);await artifactOwner.start();cleanups.push(()=>artifactOwner.stop());
    const host=new BrowserHostProtocolServer({socketPath:hostSocket,artifactOwnerSocketPath:artifactSocket,runtimeBuildId:'test-playwright',headless:true});await host.start();cleanups.push(()=>host.stop());
    const artifacts=new BrowserArtifactOwnerClient(artifactSocket),client=new BrowserHostProtocolClient(hostSocket);const sessionId=randomUUID(),leaseId=randomUUID();const identity={sessionId,hostGeneration:1n,contextGeneration:1n,pageId:randomUUID(),pageGeneration:1n,frameId:randomUUID(),documentId:randomUUID(),documentEpoch:1n};const lease={leaseId,fencingToken:1n,expiresAt:new Date(Date.now()+60_000).toISOString()};
    const invoke=(request:Omit<Extract<BrowserHostRequest,{kind:'ACTION'}>,'protocol'|'requestId'|'deadlineAt'|'identity'|'lease'|'allowedOrigins'>)=>client.invoke({protocol:'KCML-BROWSER-HOST/1',requestId:randomUUID(),deadlineAt:new Date(Date.now()+30_000).toISOString(),identity,lease,allowedOrigins:[url],...request});
    expect((await client.invoke({protocol:'KCML-BROWSER-HOST/1',requestId:randomUUID(),deadlineAt:new Date(Date.now()+30_000).toISOString(),kind:'ATTACH',identity,lease,initialUrl:url})).ok).toBe(true);
    const uploadContent=Buffer.from('opaque-upload-proof'),uploadDigest=`sha256:${createHash('sha256').update(uploadContent).digest('hex')}`,uploadActionId=randomUUID();const storedUpload=await artifacts.put({sessionId,actionId:uploadActionId,actionFence:1n,contentDigest:uploadDigest,sizeBytes:uploadContent.length,mimeType:'text/plain',contentBase64:uploadContent.toString('base64')});expect(storedUpload.ok).toBe(true);
    const uploaded=await invoke({kind:'ACTION',actionId:uploadActionId,actionFence:1n,action:'UPLOAD',locatorAst:{kind:'label',label:'Upload',exact:true},payload:{uploadHandleId:randomUUID()},uploadArtifact:{handleId:randomUUID(),storageReference:storedUpload.artifact!.storageReference,contentDigest:uploadDigest,sizeBytes:uploadContent.length,mimeType:'text/plain',safeName:'proof.txt'},downloadId:null,downloadArtifactId:null});expect(uploaded.ok).toBe(true);expect(uploaded.evidence?.uploadConsumedCandidate).toBeTruthy();expect((uploaded.evidence?.observation as Record<string,unknown>)?.title).toBe('proof.txt');
    const downloadActionId=randomUUID(),downloadId=randomUUID(),downloadArtifactId=randomUUID();const downloaded=await invoke({kind:'ACTION',actionId:downloadActionId,actionFence:2n,action:'DOWNLOAD',locatorAst:{kind:'text',text:'Download',exact:true},payload:{},uploadArtifact:null,downloadId,downloadArtifactId});expect(downloaded.ok).toBe(true);const candidate=downloaded.evidence?.downloadCandidate as Record<string,unknown>;expect(candidate.downloadId).toBe(downloadId);expect(candidate.artifactId).toBe(downloadArtifactId);const downloadedBytes=await artifacts.get({sessionId,actionId:downloadActionId,actionFence:2n,storageReference:String(candidate.storageReference),contentDigest:String(candidate.contentDigest),sizeBytes:Number(candidate.sizeBytes),mimeType:String(candidate.mimeType)});expect(Buffer.from(downloadedBytes.contentBase64!,'base64').toString()).toBe('download-proof');
    const challenge=await invoke({kind:'ACTION',actionId:randomUUID(),actionFence:3n,action:'CHALLENGE',locatorAst:null,payload:{kind:'PASSKEY'},uploadArtifact:null,downloadId:null,downloadArtifactId:null});expect(challenge.ok).toBe(true);expect(challenge.evidence).toMatchObject({challengeRequired:true,challengeType:'PASSKEY',allowedResolutionMethods:['OWNER_DEVICE_WEBAUTHN']});
  });
});
