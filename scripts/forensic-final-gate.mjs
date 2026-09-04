#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const steps=[
  ['ssot-surface',process.execPath,['scripts/compile-ssot-surface.mjs','--check'],null],
  ['contract-pack',process.execPath,['scripts/compile-contract-pack.mjs','--check'],null],
  ['contract-validate',process.execPath,['scripts/validate-contract-pack.mjs'],null],
  ['repository-verify','pnpm',['verify'],'NONE'],
  ['postgres-behavioral-evidence','pnpm',['test:postgres'],'KCML_FINAL_POSTGRES_DATABASE_URL'],
  ['operation-integration-evidence','pnpm',['test:integration'],'KCML_FINAL_INTEGRATION_DATABASE_URL'],
  ['property-tests','pnpm',['test:property'],'KCML_FINAL_PROPERTY_DATABASE_URL'],
  ['model-fast-chaos','pnpm',['test:chaos'],'KCML_FINAL_CHAOS_DATABASE_URL'],
  ['systemd-contracts','pnpm',['test:systemd'],null],
  ['repository-consistency','bash',['scripts/repository-consistency.sh'],null],
  ['forensic-audit',process.execPath,['scripts/forensic-ssot-audit.mjs'],null],
  ['deep-forensic-audit',process.execPath,['scripts/deep-forensic-audit.mjs'],null]
];
const result=[];let failed=false;
for(const [name,command,args,databaseEnvironment] of steps){const env={...process.env};if(databaseEnvironment==='NONE')delete env.DATABASE_URL;else if(databaseEnvironment){env.DATABASE_URL=process.env[databaseEnvironment]??process.env.DATABASE_URL??'';}const run=spawnSync(command,args,{stdio:'pipe',encoding:'utf8',env});const stdout=(run.stdout??'').trim();const stderr=(run.stderr??'').trim();const environmental=/NOT_EXECUTED_ENVIRONMENTAL/u.test(`${stdout}\n${stderr}`);const status=run.status!==0?'FAIL':environmental?'NOT_EXECUTED_ENVIRONMENTAL':'PASS';result.push({name,status,exitCode:run.status,stdout:stdout.slice(-4000),stderr:stderr.slice(-4000)});if(run.status!==0||environmental)failed=true;}
process.stdout.write(`${JSON.stringify({status:failed?'FAIL':'PASS',steps:result},null,2)}\n`);if(failed)process.exitCode=1;
