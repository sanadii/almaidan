import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createMatchQuestionSelection } from '../src/features/game/runtime/question-selector.js';
import type { ImportedQuestion, LocalRuntimeQuestionSource } from './local-firestore-question-source.js';
import { isHosted } from '../services/enta/server/src/config-policy.js';
import { ChallengeDefinitionRepository } from './challenge-definition-repository.js';
import { validateContentDraft } from '../services/enta/server/src/local-development/content-admin-store.js';
import {deriveChallengeEnvelope} from './local-challenge-overlay.js';
import {isYouTubeMediaDescriptor,youtubeDescriptorBytes} from '../src/features/game/runtime/youtube-media.js';

export const localContentPath='D:/projects/huroof_wa_oloof/local/almaidan/real-content.json';
export const localMediaIndexPath='D:/projects/huroof_wa_oloof/local/almaidan/media-index.json';
export function assertLocalRealContent(){
 if(isHosted(process.env)||process.env.NETLIFY||process.env.ALMAIDAN_LOCAL_ONLY!=='true'||process.env.FIREBASE_PROJECT_ID!=='demo-almaidan-local'||process.env.GAME_HOST!=='127.0.0.1')throw Error('LOCAL_REAL_CONTENT_ONLY');
}
export async function localRoomSecret(){
 assertLocalRealContent();const path='D:/projects/huroof_wa_oloof/local/almaidan/room-signing.private';
 try{await writeFile(path,randomBytes(48).toString('hex'),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
 const value=await readFile(path,'utf8');if(!/^[a-f0-9]{96}$/.test(value))throw Error('LOCAL_SIGNING_SECRET_INVALID');return value;
}
export async function localRealChallengeDefinitions(){
 assertLocalRealContent();const bytes=await readFile('D:/projects/huroof_wa_oloof/local/almaidan/real-challenge-definitions.json');
 if(createHash('sha256').update(bytes).digest('hex')!=='68ae1daf28e2b68ca46bd95948d75bbd21d44840fce3a654f1aa90372b6492e5')throw Error('LOCAL_CHALLENGE_SOURCE_HASH_MISMATCH');
 return JSON.parse(bytes.toString('utf8'));
}
type MediaEntry={mediaId:string;assetSha256:string;path:string|null;verified:boolean;byteSize:number;contentType:string};
let mediaEntries:Map<string,MediaEntry>|undefined;
export async function localMediaEntry(id:string,sha:string){
 assertLocalRealContent();
 if(!mediaEntries){const index=JSON.parse(await readFile(localMediaIndexPath,'utf8'));if(index.schemaVersion!==1||index.captureSha256!=='e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a')throw Error('LOCAL_MEDIA_INDEX_INVALID');mediaEntries=new Map(index.entries.filter((e:MediaEntry)=>e.verified&&e.path).map((e:MediaEntry)=>[`${e.mediaId}\0${e.assetSha256}`,e]));}
 return mediaEntries.get(`${id}\0${sha}`);
}
export async function availableLocalQuestionMedia(media:any){
 if(!media||typeof media.mediaId!=='string'||!/^[A-Za-z0-9:_-]{1,128}$/.test(media.mediaId)||typeof media.assetSha256!=='string'||!/^[a-f0-9]{64}$/.test(media.assetSha256))return false;
 if(media.youtube!==undefined)return media.type==='video'&&isYouTubeMediaDescriptor(media.youtube)&&createHash('sha256').update(youtubeDescriptorBytes(media.youtube)).digest('hex')===media.assetSha256;
 return Boolean(await localMediaEntry(media.mediaId,media.assetSha256));
}
const overlayArchive='D:/projects/huroof_wa_oloof/local/almaidan/overlay-history';
// Share unchanged verified source rows across retained snapshots.
const sharedOriginalQuestions=new Map<string,ImportedQuestion>();
export async function retainedLocalReleaseSources(){
 assertLocalRealContent();const baseline=await loadLocalReleaseQuestionSource([]),sources=[baseline];
 const legacyCategories=baseline.inventory.categories.map(c=>({...c,...(c.unavailableReason==='لا توجد إجابات مختلفة كافية لإنشاء اللوحة'?{unavailableReason:'لا توجد أسئلة كافية لإنشاء اللوحة'}:{})}));
 const legacyId=createHash('sha256').update(await readFile(localContentPath)).update(JSON.stringify(legacyCategories)).digest('hex');
 sources.push({...baseline,snapshotId:legacyId,inventory:{...baseline.inventory,snapshotId:legacyId,categories:legacyCategories}});
 try{for(const file of await readdir(overlayArchive)){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;const data=JSON.parse(await readFile(`${overlayArchive}/${file}`,'utf8'));if(createHash('sha256').update(JSON.stringify(data)).digest('hex')!==file.slice(0,-5))throw Error('LOCAL_OVERLAY_ARCHIVE_INVALID');sources.push(await loadLocalReleaseQuestionSource(data));}}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 return sources;
}
export async function loadLocalReleaseQuestionSource(retained?:any[]):Promise<LocalRuntimeQuestionSource>{
 assertLocalRealContent();
 const bytes=await readFile(localContentPath),raw=JSON.parse(bytes.toString('utf8'));
 if(createHash('sha256').update(bytes).digest('hex')!=='7ce29d3d9e58f8ca89cb32f50bf47342f86e138d90f85b283ecefbf5eca28a54')throw Error('LOCAL_REAL_CONTENT_HASH_MISMATCH');
 if(raw.schemaVersion!==1||raw.source.sha256!=='e3d4bcf074489eb0751767793c3ba5af12f719e5c94f4ed8e1be1949193bb23a'||raw.categories.length!==530||raw.questions.length!==115636)throw Error('LOCAL_REAL_CONTENT_INVALID');
 let overlays:any[]=retained??[];
 if(retained===undefined){try{const snapshot=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/content-overlays.json','utf8'));if(snapshot.schemaVersion!==1||snapshot.sourceSha256!==raw.source.sha256||!Array.isArray(snapshot.overlays)||createHash('sha256').update(JSON.stringify(snapshot.overlays)).digest('hex')!==snapshot.revision)throw Error('LOCAL_OVERLAY_INVALID');overlays=snapshot.overlays;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 const overlayRevision=createHash('sha256').update(JSON.stringify(overlays)).digest('hex');
 const questionsById=new Map<string,any>(raw.questions.map((q:any)=>[q.id,q]));
 const seenOverlay=new Set<string>();
 const addedDefinitions:import('../src/features/game/challenges/integration.js').ChallengeDefinitionEnvelope[]=[];
 const validText=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\p{Cc}\p{Cf}<>]/u.test(v);
 for(const overlay of overlays){
  if(!overlay||typeof overlay.entityId!=='string'||!validText(overlay.revisionId,100)||!overlay.payload||typeof overlay.payload!=='object'||Array.isArray(overlay.payload)||seenOverlay.has(`${overlay.entity}:${overlay.entityId}`))throw Error('LOCAL_OVERLAY_INVALID');
  seenOverlay.add(`${overlay.entity}:${overlay.entityId}`);
  const payload=overlay.payload;
  if((overlay.entity==='question'&&!questionsById.has(overlay.entityId))||(overlay.entity==='category'&&!raw.categories.some((c:any)=>c.id===overlay.entityId))){try{validateContentDraft(overlay.entity,overlay.entityId,payload,raw);}catch{throw Error('LOCAL_OVERLAY_INVALID');}continue;}
  if(overlay.entity==='category'&&(!validText(payload.labelAr,100)||Object.keys(payload).some(k=>k!=='labelAr')))throw Error('LOCAL_OVERLAY_INVALID');
  if(overlay.entity==='question'&&!questionsById.get(overlay.entityId)?.challenge&&!questionsById.get(overlay.entityId)?.media&&(!validText(payload.promptAr,2000)||!validText(payload.canonicalAnswer,500)||!Array.isArray(payload.acceptedAnswers)||payload.acceptedAnswers.length<1||payload.acceptedAnswers.length>30||payload.acceptedAnswers.some((a:unknown)=>!validText(a,500))||!payload.acceptedAnswers.includes(payload.canonicalAnswer)||![200,400,600].includes(payload.points)))throw Error('LOCAL_OVERLAY_INVALID');
  if(overlay.entity==='category'){const category=raw.categories.find((c:any)=>c.id===overlay.entityId);if(!category||typeof overlay.payload.labelAr!=='string')throw Error('LOCAL_OVERLAY_INVALID');category.labelAr=overlay.payload.labelAr;}
  else if(overlay.entity==='question'){const q=questionsById.get(overlay.entityId);if(!q)throw Error('LOCAL_OVERLAY_INVALID');
   try{validateContentDraft(overlay.entity,overlay.entityId,payload,raw);}catch{throw Error('LOCAL_OVERLAY_INVALID');}
   if(q.challenge){const envelope=deriveChallengeEnvelope(q,payload);addedDefinitions.push(envelope);q.promptAr=payload.promptAr;q.challenge={...q.challenge,definition:{id:envelope.id,schemaVersion:envelope.schemaVersion,definitionSha256:envelope.definitionSha256,manifestSha256:envelope.manifestSha256}};}else Object.assign(q,payload);
   q.sourceContentHash=createHash('sha256').update(JSON.stringify([q.sourceContentHash,overlay.revisionId,overlay.payload])).digest('hex');}

  else throw Error('LOCAL_OVERLAY_INVALID');
 }
 if(overlays.length&&retained===undefined){await mkdir(overlayArchive,{recursive:true});try{await writeFile(`${overlayArchive}/${overlayRevision}.json`,JSON.stringify(overlays),{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(createHash('sha256').update(await readFile(`${overlayArchive}/${overlayRevision}.json`)).digest('hex')!==overlayRevision)throw Error('LOCAL_OVERLAY_ARCHIVE_INVALID');}}
 const questions:ImportedQuestion[]=[],held:Record<string,number>={},groups=new Map<string,ImportedQuestion[]>(),sourceCounts=new Map<string,number>();
 const cats=new Map<string,any>(raw.categories.map((c:any)=>[c.id,c]));
 const definitions=new ChallengeDefinitionRepository([...(await localRealChallengeDefinitions()),...addedDefinitions]);
 const normalize=(value:string)=>value.normalize('NFKC').replace(/[\u064B-\u065F\u0670]/gu,'').replace(/[أإآ]/gu,'ا').replace(/ى/gu,'ي').trim();
 const hold=(reason:string)=>{held[reason]=(held[reason]??0)+1;};
 for(const row of raw.questions){
  sourceCounts.set(row.categoryId,(sourceCounts.get(row.categoryId)??0)+1);
  if(row.challenge){definitions.resolveBound(row);}else if(cats.get(row.categoryId)?.challengeOnly){hold('missing_challenge_definition');continue;}
  if(!row.id||!row.promptAr||!row.canonicalAnswer||!Array.isArray(row.acceptedAnswers)||!row.acceptedAnswers.length||!['classic','image','video'].includes(row.modality)){hold('invalid_question');continue;}
  if(row.modality!=='classic'&&(!await availableLocalQuestionMedia(row.media)||row.answerMedia&&!await availableLocalQuestionMedia(row.answerMedia))){hold('missing_local_media');continue;}
  const declared=normalize(row.targetLetter??''),letterEligible=row.modality==='classic'&&row.letterModeEligible!==false&&row.categoryModeOnly!==true&&/^[ابتثجحخدذرزسشصضطظعغفقكلمنهوي]$/u.test(declared)&&row.acceptedAnswers.some((a:string)=>normalize(a).startsWith(declared));
  const modified=seenOverlay.has(`question:${row.id}`);
  let q=modified?undefined:sharedOriginalQuestions.get(row.id);
  if(!q){q={...row,targetLetter:letterEligible?declared:undefined,status:'draft_test_import',difficulty:row.difficulty??'source-unspecified',sourceContentHash:row.sourceContentHash??createHash('sha256').update(JSON.stringify(row)).digest('hex')};}
  if(!q)throw new Error('LOCAL_DB_QUESTION_SOURCE_UNAVAILABLE');
  if(!modified)sharedOriginalQuestions.set(row.id,q);
  questions.push(q);const list=groups.get(q.categoryId)??[];list.push(q);groups.set(q.categoryId,list);
 }
 const recommended:string[]=[];let selectionSucceeded=false;
 for(const [id,rows] of [...groups.entries()].sort((a,b)=>b[1].filter(q=>q.targetLetter).length-a[1].filter(q=>q.targetLetter).length)){
  if(!rows.some(q=>q.targetLetter))continue;recommended.push(id);
  try{createMatchQuestionSelection(questions,{categories:recommended,modality:'classic',seed:1});selectionSucceeded=true;break;}catch{if(recommended.length===10)break;}
 }
 if(!selectionSucceeded)recommended.length=0;
 const categories=raw.categories.map((c:any)=>{const rows=groups.get(c.id)??[],count=sourceCounts.get(c.id)??0,eligible=new Set(rows.map(q=>q.answerConceptId)).size>=14;return {id:c.id,labelAr:c.labelAr,sourceOnly:false,questionCount:rows.length,sourceQuestionCount:count,heldQuestionCount:count-rows.length,classicQuestionCount:rows.filter(q=>q.modality==='classic').length,huroofQuestionCount:rows.filter(q=>q.targetLetter).length,categoryGameEligible:eligible,availability:eligible?'ready':rows.length?'insufficient_questions':'held_only',unavailableReason:c.challengeOnly?'تحتاج هذه الفئة آلية التحدي الخاصة بها':rows.length<count?'بعض الوسائط غير موجودة محلياً':eligible?undefined:'لا توجد إجابات مختلفة كافية لإنشاء اللوحة'};});
 const snapshotId=createHash('sha256').update(bytes).update(JSON.stringify(categories)).update(overlays.length?overlayRevision:'').digest('hex');
 return {snapshotId,questions,challengeDefinitions:addedDefinitions,inventory:{source:'local_saved_release',snapshotId,bundleSha256:raw.source.sha256,boundedReadCount:0,sourceCandidateCount:raw.questions.length,usableQuestionCount:questions.length,heldQuestionCount:raw.questions.length-questions.length,heldByReason:held,huroofAvailable:recommended.length>0,recommendedHuroofCategoryIds:recommended,categories}};
}
