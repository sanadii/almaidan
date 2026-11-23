import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {fail,type MatchRecord} from '../gameplay/types';
import {localCategories} from './catalogue';
import {kidsCategories,SUPPLEMENT_RELEASE,SUPPLEMENT_ROOT} from './content-pack';
import {deriveSupplement,currentSupplement} from './supplement-overlay';
import {validateContentDraft} from './content-admin-store';
import {buildRealCategories,deriveRealContent,originalRealContent,realCategories,realContent,realContentEnabled,type Overlay} from './real-content';
const archive='D:/projects/huroof_wa_oloof/local/almaidan/overlay-history';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Categories=ReturnType<typeof realCategories>|typeof localCategories;
let cached:{releaseId:string;root:string;projectionVersion?:string;categories:Categories}|undefined;
/** Resolve the predecessor's exact published release. Never borrow an active revision's questions. */
export function retainedClassicCatalogue(game:MatchRecord):Categories {
 if(game.mode==='KIDS'){
  if(game.releaseId===SUPPLEMENT_RELEASE&&game.releaseRootHash===SUPPLEMENT_ROOT)return kidsCategories;
  const current=currentSupplement();if(current.releaseId===game.releaseId&&current.root===game.releaseRootHash)return current.kids;
  let files:string[]=[];try{files=readdirSync(archive);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  for(const file of files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){
   const rows=JSON.parse(readFileSync(`${archive}/${file}`,'utf8')) as Overlay[];if(!Array.isArray(rows)||hash(rows)!==file.slice(0,-5))return fail(409,'REMATCH_SOURCE_UNAVAILABLE');
   const ids=new Set<string>();for(const row of rows){const id=`${row.entity}:${row.entityId}`;if(!row||typeof row.revisionId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(row.revisionId)||ids.has(id))return fail(409,'REMATCH_SOURCE_UNAVAILABLE');try{validateContentDraft(row.entity,row.entityId,row.payload);}catch{return fail(409,'REMATCH_SOURCE_UNAVAILABLE');}ids.add(id);}
   const candidate=deriveSupplement(rows);if(candidate.releaseId===game.releaseId&&candidate.root===game.releaseRootHash)return candidate.kids;
  }
  return fail(409,'REMATCH_SOURCE_UNAVAILABLE');
 }
 if(game.releaseId==='local-practice-v1'&&game.releaseRootHash===hash(localCategories))return localCategories;
 if(!realContentEnabled())return fail(409,'REMATCH_SOURCE_UNAVAILABLE');
 const current=realContent();
 if(current.source.releaseId===game.releaseId&&current.source.sha256===game.releaseRootHash)return buildRealCategories(current,game.localCategoryProjectionVersion);
 if(cached?.releaseId===game.releaseId&&cached.root===game.releaseRootHash&&cached.projectionVersion===game.localCategoryProjectionVersion)return cached.categories;
 const original=originalRealContent();let content:ReturnType<typeof realContent>|undefined;
 if(original.source.releaseId===game.releaseId&&original.source.sha256===game.releaseRootHash)content=original;
 else if(/^local-overlay-[a-f0-9]{32}$/.test(game.releaseId)){
  const prefix=game.releaseId.slice('local-overlay-'.length);let files:string[]=[];
  try{files=readdirSync(archive);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  for(const file of files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name)&&name.startsWith(prefix))){
   const rows=JSON.parse(readFileSync(`${archive}/${file}`,'utf8')) as Overlay[];
   if(!Array.isArray(rows)||hash(rows)!==file.slice(0,-5))return fail(409,'REMATCH_SOURCE_UNAVAILABLE');
   const identities=new Set<string>();
   for(const row of rows){if(!row||typeof row.revisionId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(row.revisionId)||identities.has(`${row.entity}:${row.entityId}`))return fail(409,'REMATCH_SOURCE_UNAVAILABLE');try{validateContentDraft(row.entity,row.entityId,row.payload);}catch{return fail(409,'REMATCH_SOURCE_UNAVAILABLE');}identities.add(`${row.entity}:${row.entityId}`);}
   const candidate=deriveRealContent(rows);
   if(candidate.source.releaseId===game.releaseId&&candidate.source.sha256===game.releaseRootHash){content=candidate;break;}
  }
 }
 if(!content)return fail(409,'REMATCH_SOURCE_UNAVAILABLE');
 const categories=buildRealCategories(content,game.localCategoryProjectionVersion);cached={releaseId:game.releaseId,root:game.releaseRootHash,projectionVersion:game.localCategoryProjectionVersion,categories};return categories;
}
