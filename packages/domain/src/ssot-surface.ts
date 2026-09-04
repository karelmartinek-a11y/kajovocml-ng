import type { DatabaseClient, DatabasePool } from '@kcml/database';
import { DomainError } from './errors.js';

const SAFE_IDENTIFIER=/^[a-z][a-z0-9_]*$/u;

function ident(value:string):string{
  if(!SAFE_IDENTIFIER.test(value))throw new DomainError('OPERATION_CONTRACT_INCOMPLETE','Entity identifier is outside the compiled SSOT surface',500);
  return `"${value}"`;
}

function snake(value:string):string{return value.replace(/([a-z0-9])([A-Z])/g,'$1_$2').replace(/[^a-zA-Z0-9_]+/g,'_').toLowerCase();}

export interface SurfaceMutationInput {
  entity:string;
  routeKey:string;
  method:'POST'|'PUT'|'PATCH'|'DELETE';
  targetId:string|null;
  body:unknown;
  expectedStateVersion:bigint|null;
  idempotencyKey:string;
  callerFingerprint:string;
  actorId:string;
  correlationId:string;
}

interface ColumnInfo {name:string;nullable:boolean;hasDefault:boolean;generated:boolean;}

/**
 * Read-only projection for SSOT entities. Mutations without an exact operation
 * binding deliberately fail closed and can never become an alternate writer.
 */
export class SsotSurfaceService {
  private readonly columnCache=new Map<string,Map<string,ColumnInfo>>();
  public constructor(private readonly pool:DatabasePool,private readonly allowedEntities:ReadonlySet<string>){}

  private assertEntity(entity:string):void{
    if(!this.allowedEntities.has(entity))throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`Entity ${entity} is not in the compiled SSOT surface`,500);
    ident(entity);
  }

  private async columns(client:DatabaseClient|DatabasePool,entity:string):Promise<Map<string,ColumnInfo>>{
    const cached=this.columnCache.get(entity);if(cached)return cached;
    const result=await client.query(`SELECT a.attname AS name,NOT a.attnotnull AS nullable,ad.adbin IS NOT NULL AS has_default,a.attgenerated<>'' AS generated
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      WHERE n.nspname='kcml' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[entity]);
    if(!result.rows.length)throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`Physical table kcml.${entity} is missing`,503);
    const columns=new Map<string,ColumnInfo>(result.rows.map((row)=>[String(row.name),{name:String(row.name),nullable:Boolean(row.nullable),hasDefault:Boolean(row.has_default),generated:Boolean(row.generated)}]));this.columnCache.set(entity,columns);return columns;
  }

  public async read(entity:string,targetId:string|null,limit=200,scope:Readonly<Record<string,string>>={}):Promise<unknown>{
    this.assertEntity(entity);const columns=await this.columns(this.pool,entity);const table=ident(entity);
    if(targetId&&columns.has('id')){const result=await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.id::text=$1 LIMIT 1`,[targetId]);if(!result.rows[0])throw new DomainError('KCIP_TARGET_NOT_FOUND',`${entity} row does not exist`,404);return result.rows[0].row;}
    if(targetId&&columns.has('stable_key')){const result=await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t WHERE t.stable_key=$1 LIMIT 1`,[targetId]);if(!result.rows[0])throw new DomainError('KCIP_TARGET_NOT_FOUND',`${entity} row does not exist`,404);return result.rows[0].row;}
    const predicates:string[]=[];const values:unknown[]=[];const usedColumns=new Set<string>();
    for(const [key,value] of Object.entries(scope)){const candidates=[snake(key),key==='parentId'?'parent_id':'',key==='id'?'parent_id':''].filter(Boolean);const column=candidates.find((candidate)=>columns.has(candidate)&&!usedColumns.has(candidate));if(!column)continue;usedColumns.add(column);values.push(value);predicates.push(`t.${ident(column)}::text=$${values.length}`);}
    if(columns.has('deleted_at'))predicates.push('t.deleted_at IS NULL');const bounded=Math.max(1,Math.min(500,limit));values.push(bounded);
    const order=columns.has('updated_at')?' ORDER BY t.updated_at DESC':columns.has('created_at')?' ORDER BY t.created_at DESC':'';const where=predicates.length?` WHERE ${predicates.join(' AND ')}`:'';
    return (await this.pool.query(`SELECT to_jsonb(t) AS row FROM kcml.${table} t${where}${order} LIMIT $${values.length}`,values)).rows.map((row)=>row.row);
  }

  public async mutate(input:SurfaceMutationInput):Promise<never>{
    this.assertEntity(input.entity);
    throw new DomainError('OPERATION_CONTRACT_INCOMPLETE',`Mutating route ${input.routeKey} has no exact canonical operation binding and is fail-closed`,501,'DO_NOT_RETRY',{routeKey:input.routeKey,entity:input.entity});
  }
}
