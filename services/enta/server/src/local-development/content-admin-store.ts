import {Prisma,PrismaClient} from '@prisma/client';
import {randomUUID,createHash} from 'node:crypto';
import {assertLocalDevelopment} from './guard';
import {originalRealContent} from './real-content';
import {kidsCategories,supplementalFormatCategories} from './content-pack';
import {checkedLocalMedia} from './content-admin-media-options';
// Local-only adapter: loaded lazily under the local TypeScript launcher.
const challengeOverlay=()=>require('../../../../../server/local-challenge-overlay') as {deriveChallengeEnvelope:(question:unknown,payload:Record<string,unknown>)=>unknown};
import {text as roundText} from '../rounds/validation';
export type ContentEntity='question'|'category';
export type ContentOverlay={entity:ContentEntity;entityId:string;revisionId:string;payload:Record<string,unknown>};
export class ContentAdminError extends Error {constructor(public status:number,public code:string){super(code);}}
const fail=(status:number,code:string):never=>{throw new ContentAdminError(status,code);};
const text=(x:unknown,max:number)=>{try{roundText(x,1,max);return true;}catch{return false;}};
export function validateContentDraft(entity:unknown,entityId:unknown,payload:unknown,sourceOverride?:ReturnType<typeof originalRealContent>){
 if((entity!=='question'&&entity!=='category')||typeof entityId!=='string'||entityId.length>180||!payload||typeof payload!=='object'||Array.isArray(payload))fail(400,'INVALID_CONTENT_DRAFT');
 const p=payload as Record<string,unknown>,source=sourceOverride??originalRealContent();
 if(entity==='category'){
  if(!source.categories.some(c=>c.id===entityId)&&!kidsCategories.some(c=>c.key===entityId)&&!supplementalFormatCategories.some(c=>c.key===entityId))fail(404,'CATEGORY_NOT_FOUND');
  if(Object.keys(p).some(k=>k!=='labelAr')||!text(p.labelAr,100))fail(400,'INVALID_CATEGORY_LABEL');
  return {entity:entity as ContentEntity,entityId:entityId as string,payload:{labelAr:roundText(p.labelAr,1,100)}};
 }
 const kid=kidsCategories.flatMap(c=>c.questions).find(q=>q.sourceQuestionId===entityId);
 const formatted=supplementalFormatCategories.flatMap(c=>c.prompts).find(q=>q.sourceId===entityId);
 if(formatted){
  if(formatted.format==='DRAWING_TARGET'){
   if(Object.keys(p).some(k=>!['promptAr','target','points'].includes(k))||!text(p.promptAr,2000)||!text(p.target,500)||p.points!==formatted.points)fail(400,'INVALID_QUESTION_CONTENT');
   return {entity:'question' as const,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),target:roundText(p.target,1,500),points:p.points as number}};
  }
  if(Object.keys(p).some(k=>!['promptAr','items'].includes(k))||!text(p.promptAr,2000)||!Array.isArray(p.items)||p.items.length!==formatted.items.length||p.items.some(v=>!text(v,500)))fail(400,'INVALID_QUESTION_CONTENT');
  return {entity:'question' as const,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),items:(p.items as string[]).map(v=>roundText(v,1,500))}};
 }
 const original=source.questions.find(q=>q.id===entityId);if(!original&&!kid)return fail(404,'QUESTION_NOT_FOUND');
 if(kid){
  if(Object.keys(p).some(k=>!['promptAr','canonicalAnswer','acceptedAnswers','points'].includes(k))||!text(p.promptAr,2000)||!text(p.canonicalAnswer,500)||!Array.isArray(p.acceptedAnswers)||p.acceptedAnswers.length<1||p.acceptedAnswers.length>30||p.acceptedAnswers.some(a=>!text(a,500))||p.points!==kid.points)fail(400,'INVALID_QUESTION_CONTENT');
  const canonical=roundText(p.canonicalAnswer,1,500),answers=[...new Set((p.acceptedAnswers as string[]).map(a=>roundText(a,1,500)))];if(!answers.includes(canonical))fail(400,'CANONICAL_ANSWER_REQUIRED');
  return {entity:'question' as const,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),canonicalAnswer:canonical,acceptedAnswers:answers,points:p.points as number}};
 }

 if(!original)return fail(404,'QUESTION_NOT_FOUND');
 if(original.challenge){
  if(Object.keys(p).some(k=>!['promptAr','publicData','privateGrading'].includes(k))||!text(p.promptAr,2000)||!p.publicData||typeof p.publicData!=='object'||Array.isArray(p.publicData)||!p.privateGrading||typeof p.privateGrading!=='object'||Array.isArray(p.privateGrading)||JSON.stringify(p).length>262144)fail(400,'INVALID_CHALLENGE_CONTENT');
  try{challengeOverlay().deriveChallengeEnvelope(original,p);}catch{return fail(400,'INVALID_CHALLENGE_CONTENT');}
  return {entity:'question' as const,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),publicData:p.publicData,privateGrading:p.privateGrading}};
 }
 if(original.media||original.answerMedia){
  if(Object.keys(p).some(k=>!['promptAr','canonicalAnswer','acceptedAnswers','media','answerMedia'].includes(k))||!text(p.promptAr,2000)||!text(p.canonicalAnswer,500)||!Array.isArray(p.acceptedAnswers)||p.acceptedAnswers.length<1||p.acceptedAnswers.length>30||p.acceptedAnswers.some(a=>!text(a,500)))fail(400,'INVALID_QUESTION_CONTENT');
  const media=checkedLocalMedia(p.media,original.modality,source),answerMedia=p.answerMedia===null?null:checkedLocalMedia(p.answerMedia,undefined,source);if(!media||answerMedia===undefined||answerMedia&&answerMedia.assetSha256===media.assetSha256)fail(400,'INVALID_MEDIA_BINDING');
  const canonical=roundText(p.canonicalAnswer,1,500),answers=[...new Set((p.acceptedAnswers as string[]).map(a=>roundText(a,1,500)))];if(!answers.includes(canonical))fail(400,'CANONICAL_ANSWER_REQUIRED');
  return {entity:'question' as const,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),canonicalAnswer:canonical,acceptedAnswers:answers,media,answerMedia}};
 }
 if(original.modality!=='classic')fail(409,'LOCAL_TEXT_EDIT_ONLY');
 if(Object.keys(p).some(k=>!['promptAr','canonicalAnswer','acceptedAnswers','points'].includes(k))||!text(p.promptAr,2000)||!text(p.canonicalAnswer,500)||!Array.isArray(p.acceptedAnswers)||p.acceptedAnswers.length<1||p.acceptedAnswers.length>30||p.acceptedAnswers.some(a=>!text(a,500))||![200,400,600].includes(p.points as number))fail(400,'INVALID_QUESTION_CONTENT');
 const canonical=roundText(p.canonicalAnswer,1,500),answers=[...new Set((p.acceptedAnswers as string[]).map(a=>roundText(a,1,500)))];
 if(!answers.includes(canonical))fail(400,'CANONICAL_ANSWER_REQUIRED');
 return {entity:entity as ContentEntity,entityId:entityId as string,payload:{promptAr:roundText(p.promptAr,1,2000),canonicalAnswer:canonical,acceptedAnswers:answers,points:p.points as number}};
}
export function createContentAdminStore(){
 const prisma=new PrismaClient({datasourceUrl:assertLocalDevelopment()});
 return {
 async initialize(){
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS local_development');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.content_revision (id text PRIMARY KEY, entity text NOT NULL, entity_id text NOT NULL, payload jsonb NOT NULL, digest text NOT NULL, author_uid text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.content_review (revision_id text PRIMARY KEY REFERENCES local_development.content_revision(id), reviewer_uid text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.content_head (entity text NOT NULL, entity_id text NOT NULL, revision_id text REFERENCES local_development.content_revision(id), PRIMARY KEY(entity,entity_id))');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.category_availability (category_key text PRIMARY KEY, disabled boolean NOT NULL, actor_uid text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.content_activation (id text PRIMARY KEY, entity text NOT NULL, entity_id text NOT NULL, revision_id text NOT NULL, previous_revision_id text, actor_uid text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
 },
 async draft(uid:string,input:unknown){assertLocalDevelopment();const body=input as Record<string,unknown>;if(!body||typeof body!=='object')fail(400,'INVALID_CONTENT_DRAFT');const d=validateContentDraft(body.entity,body.entityId,body.payload),id=randomUUID(),digest=createHash('sha256').update(JSON.stringify(d)).digest('hex');await prisma.$executeRaw(Prisma.sql`INSERT INTO local_development.content_revision(id,entity,entity_id,payload,digest,author_uid) VALUES (${id},${d.entity},${d.entityId},${JSON.stringify(d.payload)}::jsonb,${digest},${uid})`);return {id,...d,digest,status:'draft'};},
 async revisions(entity:ContentEntity,entityId:string){assertLocalDevelopment();return prisma.$queryRaw(Prisma.sql`SELECT r.id,r.entity,r.entity_id AS "entityId",r.payload,r.digest,r.author_uid AS "authorUid",r.created_at AS "createdAt",v.reviewer_uid AS "reviewerUid",h.revision_id=r.id AS active FROM local_development.content_revision r LEFT JOIN local_development.content_review v ON v.revision_id=r.id LEFT JOIN local_development.content_head h ON h.entity=r.entity AND h.entity_id=r.entity_id WHERE r.entity=${entity} AND r.entity_id=${entityId} ORDER BY r.created_at DESC,r.id LIMIT 100`);},
 async review(uid:string,id:string){assertLocalDevelopment();return prisma.$transaction(async tx=>{const rows=await tx.$queryRaw<{entity:ContentEntity;entity_id:string;payload:Record<string,unknown>}[]>(Prisma.sql`SELECT entity,entity_id,payload FROM local_development.content_revision WHERE id=${id}`);if(!rows[0])fail(404,'REVISION_NOT_FOUND');validateContentDraft(rows[0].entity,rows[0].entity_id,rows[0].payload);await tx.$executeRaw(Prisma.sql`INSERT INTO local_development.content_review(revision_id,reviewer_uid) VALUES (${id},${uid}) ON CONFLICT DO NOTHING`);return {id,status:'reviewed'};});},
 async activate(uid:string,id:string,expectedRevisionId:unknown){assertLocalDevelopment();if(expectedRevisionId!==null&&(typeof expectedRevisionId!=='string'||expectedRevisionId.length>100))fail(400,'EXPECTED_REVISION_REQUIRED');return prisma.$transaction(async tx=>{
  const rows=await tx.$queryRaw<{entity:ContentEntity;entity_id:string;payload:Record<string,unknown>}[]>(Prisma.sql`SELECT r.entity,r.entity_id,r.payload FROM local_development.content_revision r JOIN local_development.content_review v ON v.revision_id=r.id WHERE r.id=${id}`);const row=rows[0];if(!row)fail(409,'REVIEW_REQUIRED');validateContentDraft(row.entity,row.entity_id,row.payload);
  await tx.$executeRaw(Prisma.sql`INSERT INTO local_development.content_head(entity,entity_id,revision_id) VALUES (${row.entity},${row.entity_id},NULL) ON CONFLICT DO NOTHING`);
  const heads=await tx.$queryRaw<{revision_id:string|null}[]>(Prisma.sql`SELECT revision_id FROM local_development.content_head WHERE entity=${row.entity} AND entity_id=${row.entity_id} FOR UPDATE`);const previous=heads[0].revision_id;if(previous===id)return {id,status:'active',idempotent:true};if(previous!==expectedRevisionId)fail(409,'ACTIVE_REVISION_CONFLICT');
  await tx.$executeRaw(Prisma.sql`UPDATE local_development.content_head SET revision_id=${id} WHERE entity=${row.entity} AND entity_id=${row.entity_id}`);await tx.$executeRaw(Prisma.sql`INSERT INTO local_development.content_activation(id,entity,entity_id,revision_id,previous_revision_id,actor_uid) VALUES (${randomUUID()},${row.entity},${row.entity_id},${id},${previous},${uid})`);return {id,status:'active',idempotent:false};
 });},
 async restoreOriginal(uid:string,entity:ContentEntity,entityId:string,expectedRevisionId:string){assertLocalDevelopment();if(!['question','category'].includes(entity)||typeof entityId!=='string'||typeof expectedRevisionId!=='string')fail(400,'INVALID_ENTITY');return prisma.$transaction(async tx=>{const heads=await tx.$queryRaw<{revision_id:string|null}[]>(Prisma.sql`SELECT revision_id FROM local_development.content_head WHERE entity=${entity} AND entity_id=${entityId} FOR UPDATE`);if(!heads[0]||heads[0].revision_id!==expectedRevisionId)fail(409,'ACTIVE_REVISION_CONFLICT');await tx.$executeRaw(Prisma.sql`UPDATE local_development.content_head SET revision_id=NULL WHERE entity=${entity} AND entity_id=${entityId}`);await tx.$executeRaw(Prisma.sql`INSERT INTO local_development.content_activation(id,entity,entity_id,revision_id,previous_revision_id,actor_uid) VALUES (${randomUUID()},${entity},${entityId},${'original'},${expectedRevisionId},${uid})`);return {status:'original'};});},
 async overlays():Promise<ContentOverlay[]>{assertLocalDevelopment();return prisma.$queryRaw(Prisma.sql`SELECT r.entity,r.entity_id AS "entityId",r.id AS "revisionId",r.payload FROM local_development.content_head h JOIN local_development.content_revision r ON r.id=h.revision_id JOIN local_development.content_review v ON v.revision_id=r.id ORDER BY r.entity,r.entity_id`);},
 async disabledCategories():Promise<string[]>{assertLocalDevelopment();const rows=await prisma.$queryRaw<{category_key:string}[]>(Prisma.sql`SELECT category_key FROM local_development.category_availability WHERE disabled ORDER BY category_key`);return rows.map(r=>r.category_key);},
 async setCategoryDisabled(uid:string,key:string,disabled:boolean){assertLocalDevelopment();await prisma.$executeRaw(Prisma.sql`INSERT INTO local_development.category_availability(category_key,disabled,actor_uid) VALUES (${key},${disabled},${uid}) ON CONFLICT (category_key) DO UPDATE SET disabled=EXCLUDED.disabled,actor_uid=EXCLUDED.actor_uid,updated_at=now()`);},
 close:()=>prisma.$disconnect(),
 };
}
