import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseSsotEntities, parseSsotRoutes, surfaceFingerprint } from './ssot-surface.mjs';

async function exists(path){try{await access(path);return true;}catch{return false;}}
async function walk(root, rels){const out=[];for(const rel of rels){const base=join(root,rel);if(!(await exists(base)))continue;const stack=[base];while(stack.length){const current=stack.pop();for(const e of await readdir(current,{withFileTypes:true})){if(['node_modules','dist','build','coverage','.git','.venv','.pytest_cache','__pycache__'].includes(e.name))continue;const p=join(current,e.name);if(e.isDirectory())stack.push(p);else out.push(p);}}}return out;}
const shaPrefix=/^sha256:[0-9a-f]{64}$/u;

export async function runForensicAudit(root=process.cwd()){
  const ssot=await readFile(join(root,'SSOT_CURRENT.md'),'utf8');
  const entities=parseSsotEntities(ssot); const routes=parseSsotRoutes(ssot);
  const entityNames=new Set(entities.map(x=>x.name)); const routeKeys=new Set(routes.map(x=>x.routeKey));
  const findings=[]; const add=(code,message,evidence=[])=>findings.push({code,message,evidence});
  if(entities.length!==220)add('SSOT_ENTITY_CARDINALITY_DRIFT',`Expected 220 chapter-25 entities, parsed ${entities.length}`);
  if(routes.length!==503)add('SSOT_ROUTE_CARDINALITY_DRIFT',`Expected 503 chapter-26 routes, parsed ${routes.length}`);
  if(entityNames.size!==entities.length)add('SSOT_DUPLICATE_ENTITY','SSOT entity catalog contains duplicates');
  if(routeKeys.size!==routes.length)add('SSOT_DUPLICATE_ROUTE','SSOT API catalog contains duplicates');

  const generatedEntities=JSON.parse(await readFile(join(root,'contracts/ssot-surface/entities.json'),'utf8'));
  const generatedRoutes=JSON.parse(await readFile(join(root,'contracts/ssot-surface/routes.json'),'utf8'));
  const generatedEntityNames=generatedEntities.records.map(x=>x.name);
  const generatedRouteKeys=generatedRoutes.records.map(x=>x.routeKey);
  const expectedFp=surfaceFingerprint(entities, generatedRoutes.records);
  if(generatedEntities.fingerprint!==generatedRoutes.fingerprint||generatedRoutes.fingerprint!==expectedFp)add('SSOT_SURFACE_FINGERPRINT_DRIFT','Generated SSOT surface fingerprint is stale');
  const missGeneratedEntities=[...entityNames].filter(x=>!generatedEntityNames.includes(x));
  const extraGeneratedEntities=generatedEntityNames.filter(x=>!entityNames.has(x));
  if(missGeneratedEntities.length||extraGeneratedEntities.length)add('GENERATED_ENTITY_SURFACE_DRIFT','Generated entity registry is not exact',[...missGeneratedEntities.map(x=>`missing:${x}`),...extraGeneratedEntities.map(x=>`extra:${x}`)]);
  const generatedRouteSet=new Set(generatedRouteKeys);
  const missGeneratedRoutes=[...routeKeys].filter(x=>!generatedRouteSet.has(x));
  const extraGeneratedRoutes=generatedRouteKeys.filter(x=>!routeKeys.has(x));
  if(missGeneratedRoutes.length||extraGeneratedRoutes.length)add('GENERATED_ROUTE_SURFACE_DRIFT','Generated route registry is not exact',[...missGeneratedRoutes.map(x=>`missing:${x}`),...extraGeneratedRoutes.map(x=>`extra:${x}`)]);
  const badBindings=generatedRoutes.records.filter(x=>!entityNames.has(x.entity));
  if(badBindings.length)add('ROUTE_ENTITY_BINDING_INVALID','Generated routes bind outside Chapter-25 entities',badBindings.map(x=>`${x.routeKey}:${x.entity}`));

  const sqlFiles=(await walk(root,['database/baseline','database/migrations'])).filter(x=>x.endsWith('.sql'));
  const sql=(await Promise.all(sqlFiles.map(x=>readFile(x,'utf8')))).join('\n');
  const physical=new Set([...sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:kcml\.)?(?:"([a-z][a-z0-9_]*)"|([a-z][a-z0-9_]*))/giu)].map(m=>m[1]??m[2]));
  const missingTables=entities.map(x=>x.name).filter(x=>!physical.has(x));
  if(missingTables.length)add('DATABASE_ENTITY_SURFACE_INCOMPLETE',`${missingTables.length} Chapter-25 entities lack physical PostgreSQL tables`,missingTables);
  for(const forbidden of ['domain_object','domain_revision','ssot_entity_registry'])if(physical.has(forbidden))add('FORBIDDEN_GENERIC_STORAGE',`Forbidden generic storage table exists: ${forbidden}`);

  const opsDoc=JSON.parse(await readFile(join(root,'contracts/registries/operations/operations.json'),'utf8'));
  const opNames=opsDoc.records.map(x=>x.operationName); const opSet=new Set(opNames);
  const handlerSource=await readFile(join(root,'packages/domain/src/operation-handler-catalog.ts'),'utf8');
  const handlers=[...handlerSource.matchAll(/\{operation:'([^']+)',family:'([^']+)',entity:'([^']+)',strategy:'([^']+)'/gu)].map(m=>({operation:m[1],family:m[2],entity:m[3],strategy:m[4]}));
  const handlerOps=new Set(handlers.map(x=>x.operation));
  const missingHandlers=opNames.filter(x=>!handlerOps.has(x)); const extraHandlers=handlers.filter(x=>!opSet.has(x.operation)).map(x=>x.operation);
  if(missingHandlers.length||extraHandlers.length||handlerOps.size!==handlers.length)add('OPERATION_HANDLER_SURFACE_DRIFT','Operation handler catalog is not a one-to-one mapping',[...missingHandlers.map(x=>`missing:${x}`),...extraHandlers.map(x=>`extra:${x}`)]);
  const handlerBadEntities=handlers.filter(x=>!entityNames.has(x.entity)); if(handlerBadEntities.length)add('OPERATION_HANDLER_ENTITY_INVALID','Operation handlers reference non-SSOT entities',handlerBadEntities.map(x=>`${x.operation}:${x.entity}`));

  const serverSource=await readFile(join(root,'apps/server/src/server.ts'),'utf8');
  const routerSource=await readFile(join(root,'apps/server/src/ssot-router.ts'),'utf8');
  const wsSource=await readFile(join(root,'apps/server/src/preview-ws.ts'),'utf8');
  const literalApiRoutes=[...serverSource.matchAll(/app\.(get|post|put|patch|delete)\(\s*['`]\/api\/v1([^'`]+)['`]/giu)].map(m=>`${m[1].toUpperCase()} ${m[2]}`);
  const extraApi=literalApiRoutes.filter(x=>!routeKeys.has(x)); if(extraApi.length)add('NON_SSOT_API_ROUTE','Server registers API routes outside Chapter 26',extraApi);
  const specialKeys=[...serverSource.matchAll(/'((?:GET|POST|PUT|PATCH|DELETE|WSS) \/[^']+)'/gu)].map(m=>m[1]).filter(x=>x.includes(' /'));
  const badSpecial=[...new Set(specialKeys)].filter(x=>!routeKeys.has(x)); if(badSpecial.length)add('SPECIAL_ROUTE_OUTSIDE_SSOT','Special route registry contains non-SSOT routes',badSpecial);
  if(!routerSource.includes('for (const route of SSOT_ROUTES)')||!routerSource.includes('specialRouteKeys.has(route.routeKey)'))add('COMPILED_ROUTER_NOT_EXHAUSTIVE','Compiled router does not iterate the full generated SSOT route registry');
  if(!(wsSource.includes('browser-sessions\\/')&&wsSource.includes('preview\\/ws')))add('WSS_ROUTE_MISSING','Canonical browser preview WSS route is not registered');
  if(!serverSource.includes('IDEMPOTENCY_KEY_REQUIRED')||!serverSource.includes("['POST','PUT','PATCH','DELETE'].includes(request.method)"))add('MUTATION_IDEMPOTENCY_GATE_MISSING','Server lacks a global Idempotency-Key gate for all API mutations');
  const authSource=await readFile(join(root,'packages/domain/src/auth.ts'),'utf8');
  if(!serverSource.includes('auth.login(input.username, input.password')||!authSource.includes('validUsername')||!authSource.includes('timingSafeEqual(suppliedUsernameDigest, persistedUsernameDigest)'))add('LOGIN_USERNAME_ENTRY_GATE_MISSING','Login must require an explicitly entered username and compare it to the singleton persisted identity without exposing an alternate account selector');
  const readinessSource=await readFile(join(root,'apps/server/src/readiness.ts'),'utf8');
  for(const marker of ['missingServices','unhealthyServices','staleServices','mismatchedServices'])if(!readinessSource.includes(marker))add('SERVICE_READINESS_DIMENSION_MISSING',`Service readiness does not evaluate ${marker}`);
  for(const marker of ['evaluateServiceReadiness','SERVICE_READINESS_BLOCKED','OPENAI_CONFIGURATION_REQUIRED'])if(!serverSource.includes(marker))add('FAIL_CLOSED_READINESS_MISSING',`Server readiness/capability path lacks ${marker}`);
  if(!serverSource.includes("!/^[0-9a-f]{40}$/iu.test(sourceSha)"))add('READINESS_SOURCE_SHA_VALIDATION_MISSING','Readiness does not fail closed when the deployed source SHA is absent or invalid');
  if(/system\/readiness[\s\S]{0,1200}ready:\s*true/gu.test(serverSource))add('READINESS_FALSE_PASS','System readiness contains an unconditional ready=true result');

  const productionAcceptance=await readFile(join(root,'tests/production/run.sh'),'utf8');
  if(!productionAcceptance.includes('Authorization: Bearer $KCML_OWNER_API_KEY')||!productionAcceptance.includes('/api/v1/system/version'))add('PRODUCTION_AUTH_EVIDENCE_MISSING','Production acceptance does not authenticate protected system evidence');
  if(!productionAcceptance.includes('/api/v1/operations/catalog')||productionAcceptance.includes('"$origin/api/v1/operations"'))add('PRODUCTION_CANONICAL_ROUTE_MISSING','Production acceptance does not use the canonical operations catalog route');
  const deploymentSource=await readFile(join(root,'deploy/scripts/deploy-production.sh'),'utf8');
  const heartbeatQuery=await readFile(join(root,'deploy/sql/verify-service-heartbeat.sql'),'utf8');
  const deploymentReadinessSource=`${deploymentSource}\n${heartbeatQuery}`;
  for(const marker of ['-v service="kcml-browser-host"',"status = 'READY'","source_sha = :'sha'","deployment_epoch = :'epoch'::bigint",'.services.ready==true'])if(!deploymentReadinessSource.includes(marker))add('DEPLOYMENT_READINESS_EVIDENCE_MISSING',`Deployment verification lacks ${marker}`);
  const propertySource=await readFile(join(root,'tests/property/run.ts'),'utf8');
  const chaosSource=await readFile(join(root,'tests/chaos/run.ts'),'utf8');
  if(!propertySource.includes('numRuns: 10_000')||!propertySource.includes('KCML_PROPERTY_SEED'))add('MODEL_FAST_PROPERTY_DEPTH_MISSING','MODEL_FAST property suite lacks 10,000 exact-seed runs');
  if(!chaosSource.includes('SCHEDULE_COUNT = 10_000')||!chaosSource.includes('THREE_WAY_SCHEDULES.length'))add('MODEL_FAST_NEMESIS_DEPTH_MISSING','MODEL_FAST chaos suite lacks 10,000 schedules and mandatory three-way coverage');

  const productionFiles=(await walk(root,['apps','packages','database','deploy','scripts'])).filter(x=>/\.(?:ts|tsx|mjs|js|sql|sh|json)$/u.test(x) && !x.endsWith('/scripts/lib/forensic-audit.mjs'));
  const sourceBlobs=[]; for(const file of productionFiles)sourceBlobs.push([file,await readFile(file,'utf8')]);
  const antiPatterns=[
    ['SESSION_ADVISORY_LOCK',/\bpg_advisory_lock\s*\(/giu],
    ['MAX_PLUS_ONE_ALLOCATOR',/(?:coalesce\s*\(\s*max\s*\([^)]*\)[\s\S]{0,40}\+\s*1|max\s*\([^)]*\)\s*\+\s*1)/giu],
    ['FORBIDDEN_DOMAIN_OBJECT_TOKEN',/\b(?:DOMAIN_OBJECT|ssot_entity_registry)\b/gu],
    ['FAKE_SOURCE_SHA',/['"]0['"]\.repeat\(40\)/gu]
  ];
  for(const [code,re] of antiPatterns){const evidence=[];for(const [file,text] of sourceBlobs){re.lastIndex=0;if(re.test(text))evidence.push(relative(root,file));}if(evidence.length)add(code,`Forbidden implementation anti-pattern detected: ${code}`,[...new Set(evidence)]);}
  for(const oldPath of ['/auth/me','/auth/mfa/enroll','/auth/mfa/verify','/auth/mfa/complete','/browser/sessions','/owner-api-key','/chat/responses','/tests/runs','/objects?','/auth/sessions']){
    const evidence=[];for(const [file,text] of sourceBlobs.filter(([f])=>f.includes('/apps/owner-ui/'))){if(text.includes(oldPath))evidence.push(relative(root,file));}if(evidence.length)add('LEGACY_UI_API_PATH',`Owner UI still calls legacy API path ${oldPath}`,[...new Set(evidence)]);
  }
  if(!serverSource.includes("process.env.KCML_SOURCE_SHA ?? null"))add('SOURCE_SHA_SYNTHESIS_RISK','System endpoints do not expose missing source SHA as explicit absence');
  const secretSql=await readFile(join(root,'database/baseline/00000000000000_greenfield.sql'),'utf8');
  const secretSource=await readFile(join(root,'packages/domain/src/secrets.ts'),'utf8');
  for(const marker of ['secret_version_one_active_uq','protect_secret_version_row','activation_logical_operation_id','secret_access_event'])if(!secretSql.includes(marker)&&!secretSource.includes(marker))add('SECRET_LIFECYCLE_CONTRACT_MISSING',`Secret implementation lacks ${marker}`);
  if(!secretSource.includes("'CREATED'")||!secretSource.includes("lifecycle='RETIRED'")||!secretSource.includes("lifecycle='ACTIVE'"))add('SECRET_LIFECYCLE_SEQUENCE_MISSING','Secret rotation does not implement CREATED -> ACTIVE -> RETIRED semantics');
  const dbSource=await readFile(join(root,'packages/database/src/index.ts'),'utf8'); const dbCli=await readFile(join(root,'packages/database/src/cli.ts'),'utf8');
  for(const marker of ['loadBaseline','loadForwardMigrations','allocateContiguousSequence'])if(!dbSource.includes(marker))add('DATABASE_ENGINE_CONTRACT_MISSING',`Database package lacks ${marker}`);
  if(!dbCli.includes('loadForwardMigrations')||!dbCli.includes('loadBaseline'))add('MIGRATION_ENGINE_INCOMPLETE','Database migration CLI does not apply baseline and forward migration sources');
  if(!sql.includes('checksum')||!dbCli.includes('checksum'))add('MIGRATION_CHECKSUM_CHAIN_MISSING','Migration ledger/checker lacks checksum evidence');

  const removedPaths=['apps/ssot-api','packages/ssot-domain-runtime','database/migrations/99999_ssot_explicit_domain_storage.sql','database/migrations/100000_ssot_compatibility_gateway_views.sql','database/migrations/100001_ssot_runtime_hardening.sql'];
  for(const rel of removedPaths)if(await exists(join(root,rel)))add('LEGACY_BYPASS_RUNTIME_PRESENT',`Legacy bypass artifact still exists: ${rel}`);

  const totals={expectedDatabaseEntities:entities.length,physicalSsotEntities:entities.filter(x=>physical.has(x.name)).length,expectedApiRoutes:routes.length,compiledApiRoutes:generatedRouteSet.size,operations:opNames.length,explicitOperationHandlers:handlerOps.size,findings:findings.length};
  return {schemaVersion:'2.0',authority:'SSOT_CURRENT.md',surfaceFingerprint:generatedRoutes.fingerprint,status:findings.length?'FAIL':'PASS',totals,findings};
}
