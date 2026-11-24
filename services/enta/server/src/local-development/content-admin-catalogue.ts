import {kidsCategories,supplementalFormatCategories,SUPPLEMENT_RELEASE,SUPPLEMENT_ROOT} from './content-pack';
import {realContent,realCategories} from './real-content';
import {CURRENT_CATEGORY_PROJECTION,canonicalCategoryId,hasCategoryGroup} from './category-projection';
import {isCategoryDisabled} from './category-availability';
import {currentSupplement} from './supplement-overlay';

// Private admin projections. Never reuse these answers/targets in a public catalogue.
const authoredSource=()=>({sourceKind:'local-authored',releaseId:currentSupplement().releaseId,releaseRootHash:currentSupplement().root,editable:true});
export function authoredAdminCategories(){return [
 ...currentSupplement().kids.map(c=>({...authoredSource(),id:c.key,labelAr:c.label,questionCount:c.questions.length,format:'KIDS',ageBand:'7-10',revisionId:c.revisionId})),
 ...currentSupplement().formats.map(c=>({...authoredSource(),id:c.key,labelAr:c.label,questionCount:c.prompts.length,format:c.format,revisionId:`${c.key}-v1`}))
];}
export function authoredAdminQuestions(){return [
 ...currentSupplement().kids.flatMap(c=>c.questions.map(q=>({...authoredSource(),id:q.sourceQuestionId,categoryId:c.key,promptAr:q.prompt,canonicalAnswer:q.answers.find(a=>a.isCorrect)?.text,acceptedAnswers:q.answers.filter(a=>a.isCorrect).map(a=>a.text),points:q.points,format:'KIDS',ageBand:'7-10',revisionId:q.revisionId,contentHash:q.contentHash,localTierAssigned:q.localTierAssigned}))),
 ...currentSupplement().formats.flatMap(c=>c.prompts.map(q=>({...authoredSource(),id:q.sourceId,categoryId:c.key,promptAr:q.prompt,target:q.target,items:q.items,points:q.points,format:q.format,revisionId:q.revisionId,contentHash:q.hash,rules:q.rules,media:q.media})))
];}
export function adminCategories(query=''){
 const data=realContent(),counts=new Map<string,number>();for(const q of data.questions)counts.set(q.categoryId,(counts.get(q.categoryId)??0)+1);
 const playable=new Set(realCategories().map(c=>c.key));
 const saved=data.categories.map(c=>{const availabilityKey=canonicalCategoryId(c.id,CURRENT_CATEGORY_PROJECTION);return {id:c.id,labelAr:c.labelAr,questionCount:counts.get(c.id)??0,editable:true,sourceKind:'saved-release',releaseId:data.source.releaseId,releaseRootHash:data.source.sha256,availabilityKey,grouped:hasCategoryGroup(c.id,CURRENT_CATEGORY_PROJECTION),playable:playable.has(availabilityKey),disabled:isCategoryDisabled(availabilityKey)};});
 const authored=authoredAdminCategories().map(c=>({...c,availabilityKey:c.id,grouped:false,playable:true,disabled:isCategoryDisabled(c.id)}));
 return [...saved,...authored].filter(c=>!query||String(c.labelAr).toLocaleLowerCase().includes(query)||c.id.includes(query));
}
/** The public key a category toggle controls; undefined when the admin id is unknown. */
export function categoryAvailabilityKey(id:string):string|undefined{return adminCategories().find(c=>c.id===id)?.availabilityKey;}
export type AdminQuestionKind=''|'text'|'image'|'video'|'challenge';
export const adminQuestionKinds:readonly AdminQuestionKind[]=['','text','image','video','challenge'];
/** Review filter by what the player sees: plain text, a picture, a video or an interactive challenge. */
function kindOf(x:{modality?:unknown;challenge?:unknown;format?:unknown}):AdminQuestionKind{if(x.challenge)return 'challenge';if(x.modality==='image')return 'image';if(x.modality==='video')return 'video';if(x.modality==='classic'||x.format==='KIDS')return 'text';return '';}
export function adminQuestionPage(query='',category='',offset=0,kind:AdminQuestionKind=''){
 const data=realContent();const matches=(x:{id:string;categoryId:string;promptAr:string})=>(!category||x.categoryId===category)&&(!kind||kindOf(x as {modality?:unknown;challenge?:unknown;format?:unknown})===kind)&&(!query||String(x.promptAr).toLocaleLowerCase().includes(query)||x.id.includes(query));
 const original=data.questions.filter(x=>matches(x as {id:string;categoryId:string;promptAr:string}));
 const authored=authoredAdminQuestions().filter(matches),total=original.length+authored.length;
 const questions=[...original.slice(offset,offset+30).map(x=>({...x,sourceKind:'saved-release',releaseId:data.source.releaseId,releaseRootHash:data.source.sha256,editable:true})),...authored.slice(Math.max(0,offset-original.length),Math.max(0,offset+30-original.length))];
 return {total,offset,nextOffset:offset+30<total?offset+30:null,questions};
}
