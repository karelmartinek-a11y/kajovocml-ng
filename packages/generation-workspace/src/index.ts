import { createHash } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface WorkspacePatch {path:string;expectedDigest:string|null;content:Uint8Array;mode?:number;}
export interface AppliedPatch {path:string;previousDigest:string|null;digest:string;size:number;}

function digest(value:Uint8Array):string{return `sha256:${createHash('sha256').update(value).digest('hex')}`;}
function safeRelative(path:string):string{const normalized=path.replaceAll('\\','/');if(isAbsolute(normalized)||normalized.split('/').some(segment=>segment==='..'||segment===''))throw new Error('WORKSPACE_PATH_INVALID');return normalized;}

export class GenerationWorkspace {
  public constructor(readonly root:string){}
  public async initialize():Promise<void>{await mkdir(this.root,{recursive:true,mode:0o700});}
  public resolve(relativePath:string):string{const target=resolve(this.root,safeRelative(relativePath));const rel=relative(resolve(this.root),target);if(rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error('WORKSPACE_PATH_ESCAPE');return target;}
  public async read(relativePath:string):Promise<{content:Buffer;digest:string}>{const content=await readFile(this.resolve(relativePath));return{content,digest:digest(content)};}
  public async applyAtomic(revision:bigint,patches:readonly WorkspacePatch[]):Promise<AppliedPatch[]>{
    await this.initialize();const transactionRoot=join(this.root,'.kcml-transactions',revision.toString());await mkdir(transactionRoot,{recursive:true,mode:0o700});const applied:AppliedPatch[]=[];
    for(const patch of patches){const relativePath=safeRelative(patch.path);const target=this.resolve(relativePath);let previousDigest:string|null=null;try{previousDigest=digest(await readFile(target));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(previousDigest!==patch.expectedDigest)throw new Error(`WORKSPACE_CAS_CONFLICT:${relativePath}`);const staged=join(transactionRoot,relativePath);await mkdir(dirname(staged),{recursive:true,mode:0o700});await writeFile(staged,patch.content,{mode:patch.mode??0o600,flag:'wx'});const handle=await open(staged,'r');await handle.sync();await handle.close();applied.push({path:relativePath,previousDigest,digest:digest(patch.content),size:patch.content.byteLength});}
    for(const item of applied){const target=this.resolve(item.path);const staged=join(transactionRoot,item.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await rename(staged,target);}
    const rootHandle=await open(this.root,'r');await rootHandle.sync();await rootHandle.close();return applied;
  }
  public async verifyNoSymlink(relativePath:string):Promise<void>{const target=this.resolve(relativePath);const canonicalRoot=await realpath(this.root);const canonicalTarget=await realpath(target);if(relative(canonicalRoot,canonicalTarget).startsWith('..'))throw new Error('WORKSPACE_SYMLINK_ESCAPE');if(!(await stat(canonicalTarget)).isFile())throw new Error('WORKSPACE_ARTIFACT_NOT_FILE');}
}
