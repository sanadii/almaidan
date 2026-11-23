import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,link,readFile,unlink} from 'node:fs/promises';
/** Publish a complete immutable object atomically. Directory is chosen only by trusted server code. */
export async function archiveOverlayBytes(directory:string,bytes:string){
 const revision=createHash('sha256').update(bytes).digest('hex');
 await mkdir(directory,{recursive:true});const target=`${directory}/${revision}.json`,temporary=`${directory}/${revision}.${randomUUID()}.tmp`;
 await writeFile(temporary,bytes,{flag:'wx',mode:0o600});
 try{
  try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(createHash('sha256').update(await readFile(target)).digest('hex')!==revision)throw Error('LOCAL_OVERLAY_ARCHIVE_INVALID');}
 }finally{await unlink(temporary);}
 return revision;
}
