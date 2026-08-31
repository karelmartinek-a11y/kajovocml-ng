#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const steps=[
  ['ssot-surface',process.execPath,['scripts/compile-ssot-surface.mjs','--check']],
  ['contract-pack',process.execPath,['scripts/compile-contract-pack.mjs','--check']],
  ['contract-validate',process.execPath,['scripts/validate-contract-pack.mjs']],
  ['repository-verify','pnpm',['verify']],
  ['property-tests','pnpm',['test:property']],
  ['model-fast-chaos','pnpm',['test:chaos']],
  ['systemd-contracts','pnpm',['test:systemd']],
  ['repository-consistency','bash',['scripts/repository-consistency.sh']],
  ['forensic-audit',process.execPath,['scripts/forensic-ssot-audit.mjs']],
  ['deep-forensic-audit',process.execPath,['scripts/deep-forensic-audit.mjs']]
];
const result=[];let failed=false;
for(const [name,command,args] of steps){const run=spawnSync(command,args,{stdio:'pipe',encoding:'utf8'});const stdout=(run.stdout??'').trim();const stderr=(run.stderr??'').trim();const environmental=/NOT_EXECUTED_ENVIRONMENTAL/u.test(`${stdout}\n${stderr}`);const status=run.status!==0?'FAIL':environmental?'NOT_EXECUTED_ENVIRONMENTAL':'PASS';result.push({name,status,exitCode:run.status,stdout:stdout.slice(-4000),stderr:stderr.slice(-4000)});if(run.status!==0)failed=true;}
process.stdout.write(`${JSON.stringify({status:failed?'FAIL':'PASS',steps:result},null,2)}\n`);if(failed)process.exitCode=1;
