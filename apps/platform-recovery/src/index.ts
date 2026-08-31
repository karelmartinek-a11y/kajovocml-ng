import { randomUUID } from 'node:crypto';
import { createDatabasePool } from '@kcml/database';
import { PlatformRecoveryCoordinator } from '@kcml/domain';

const pool=createDatabasePool({applicationName:'kcml-platform-recovery',max:2});
try{
  const result=await new PlatformRecoveryCoordinator(pool).recover(randomUUID());
  process.stdout.write(`${JSON.stringify(result,(_key,value)=>typeof value==='bigint'?value.toString():value)}\n`);
  if(result.state!=='READY')throw new Error(`PLATFORM_RECOVERY_${result.state}:${result.unresolvedObjectIds.join(',')}`);
}finally{await pool.end();}
