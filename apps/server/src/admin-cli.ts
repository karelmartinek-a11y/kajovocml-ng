#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabasePool, verifyDatabaseContract } from '@kcml/database';
import { EnvelopeCipher, OwnerAuthenticationService, SecretManager } from '@kcml/domain';

async function stdin():Promise<string>{const chunks:Buffer[]=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/u,'');}
const releaseRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const command=process.argv[2];const pool=createDatabasePool({applicationName:'kcml-admin-cli',max:2});
try{
  const cipher=await EnvelopeCipher.fromEnvironment();
  if(command==='sync-password'){const value=await stdin();if(!value)throw new Error('PASS must be provided on standard input');await new OwnerAuthenticationService(pool,cipher).synchronizeDeploymentPassword(value);process.stdout.write('OWNER password synchronized and verified\n');}
  else if(command==='ensure-owner-api-key'){const owner=await pool.query(`SELECT id FROM kcml.owner_identity WHERE singleton_key=1`);const result=await new SecretManager(pool,cipher).ensureOwnerApiKey(owner.rows[0].id);process.stdout.write(`${JSON.stringify({created:result.created,fingerprint:result.fingerprint})}\n`);}
  else if(command==='self-test'){const database=await verifyDatabaseContract(pool);const catalog=await import('@kcml/contract-pack').then(module=>module.loadOperationCatalog(releaseRoot));const key=await pool.query(`SELECT secret_id,secret_version_id,fingerprint,credential_version FROM kcml.owner_api_credential WHERE singleton_key=1`);if(!key.rows[0]?.secret_id)throw new Error('KCML_OWNER_API_KEY is absent');process.stdout.write(`${JSON.stringify({status:'PASS',database,operationCount:catalog.records.length,ownerApiKey:{fingerprint:key.rows[0].fingerprint,credentialVersion:String(key.rows[0].credential_version)}},null,2)}\n`);}
  else throw new Error('Usage: admin-cli.ts sync-password|ensure-owner-api-key|self-test');
}finally{await pool.end();}
