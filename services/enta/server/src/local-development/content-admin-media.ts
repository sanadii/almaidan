import {readFileSync} from 'node:fs';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,relative,resolve} from 'node:path';
import {assertLocalDevelopment} from './guard';
import {ContentAdminError} from './content-admin-store';

type Entry={mediaId:string;assetSha256:string;path:string|null;verified:boolean;byteSize:number;contentType:string};
const INDEX='D:/projects/huroof_wa_oloof/local/almaidan/media-index.json';
const ROOT=resolve('D:/projects/huroof_wa_oloof');
const TYPES=new Set(['image/png','image/jpeg','image/webp','video/mp4']);
let entries:Map<string,Entry>|undefined;

function index(){
 if(entries)return entries;
 const parsed=JSON.parse(readFileSync(INDEX,'utf8'));
 if(parsed.schemaVersion!==1||parsed.captureSha256!=='e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a'||!Array.isArray(parsed.entries))throw Error('LOCAL_MEDIA_INDEX_INVALID');
 entries=new Map((parsed.entries as Entry[]).filter(e=>e.verified&&e.path).map(e=>[`${e.mediaId}\0${e.assetSha256}`,e]));
 return entries;
}

/** Reads one verified local media file for the admin preview. Paths never come from the request. */
export async function adminMediaBytes(mediaId:unknown,assetSha256:unknown):Promise<{bytes:Buffer;contentType:string}>{
 assertLocalDevelopment();
 if(typeof mediaId!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(mediaId)||typeof assetSha256!=='string'||!/^[a-f0-9]{64}$/.test(assetSha256))throw new ContentAdminError(400,'INVALID_MEDIA');
 const entry=index().get(`${mediaId}\0${assetSha256}`);
 if(!entry?.path||!TYPES.has(entry.contentType))throw new ContentAdminError(404,'MEDIA_NOT_FOUND');
 if((await lstat(entry.path)).isSymbolicLink())throw new ContentAdminError(404,'MEDIA_NOT_FOUND');
 const target=await realpath(entry.path),rel=relative(ROOT,target);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new ContentAdminError(404,'MEDIA_NOT_FOUND');
 const bytes=await readFile(target);
 if(bytes.length!==entry.byteSize||createHash('sha256').update(bytes).digest('hex')!==assetSha256)throw new ContentAdminError(409,'MEDIA_ASSET_INVALID');
 return {bytes,contentType:entry.contentType};
}
