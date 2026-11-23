import type {Express,Request,RequestHandler} from 'express';
import type {Principal} from '../identity';
import {assertContentAdmin} from './content-admin-identity';
import {createContentAdminStore,ContentAdminError,type ContentEntity} from './content-admin-store';
import {realContent,originalRealContent,localContentOverlays} from './real-content';
const challengeOverlay=()=>require('../../../../../server/local-challenge-overlay') as {originalChallengeDefinition:(question:unknown)=>{publicData:unknown;privateGrading:unknown}};
import {localMediaOptions} from './content-admin-media-options';
import {assertLocalDevelopment} from './guard';
import {publishContentOverlays} from './content-admin-snapshot';
import {adminCategories,adminQuestionPage} from './content-admin-catalogue';
export async function registerLocalContentAdmin(app:Express,authenticate:RequestHandler){
 assertLocalDevelopment();const store=createContentAdminStore();await store.initialize();await publishContentOverlays(await store.overlays());
 const handle=(work:(req:Request,principal:Principal)=>Promise<unknown>):RequestHandler=>async(req,res)=>{try{const p=(req as Request&{principal:Principal}).principal;await assertContentAdmin(p);res.json(await work(req,p));}catch(error){res.status(error instanceof ContentAdminError?error.status:503).json({error:error instanceof ContentAdminError?error.code:'LOCAL_ADMIN_UNAVAILABLE'});}};
 let activationQueue:Promise<unknown>=Promise.resolve();
 const prefix='/api/v1/local-admin';
 app.get(`${prefix}/session`,authenticate,handle(async(_req,p)=>({localOnly:true,uid:p.uid,email:p.email,sourceReleaseId:originalRealContent().source.releaseId,activeReleaseId:realContent().source.releaseId})));
 app.get(`${prefix}/categories`,authenticate,handle(async req=>({categories:adminCategories(String(req.query.q??'').slice(0,200).toLocaleLowerCase())})));
 app.get(`${prefix}/questions`,authenticate,handle(async req=>{const q=String(req.query.q??'').slice(0,200).toLocaleLowerCase(),category=String(req.query.category??''),offset=Number(req.query.offset??0);if(!Number.isSafeInteger(offset)||offset<0||offset>200000)throw new ContentAdminError(400,'INVALID_OFFSET');return adminQuestionPage(q,category,offset);}));
 app.get(`${prefix}/media-options`,authenticate,handle(async req=>{const type=req.query.type;if(type!=='image'&&type!=='video')throw new ContentAdminError(400,'INVALID_MEDIA_TYPE');return {options:localMediaOptions().filter(x=>x.type===type)};}));
 app.get(`${prefix}/challenge-definition`,authenticate,handle(async req=>{const id=req.query.questionId;if(typeof id!=='string')throw new ContentAdminError(400,'INVALID_ENTITY');const question=originalRealContent().questions.find(q=>q.id===id&&q.challenge);if(!question)throw new ContentAdminError(404,'QUESTION_NOT_FOUND');const definition=challengeOverlay().originalChallengeDefinition(question),row=localContentOverlays().find(r=>r.entity==='question'&&r.entityId===id);return {publicData:row?.payload.publicData??definition.publicData,privateGrading:row?.payload.privateGrading??definition.privateGrading};}));
 app.get(`${prefix}/revisions`,authenticate,handle(async req=>{const entity=req.query.entity,entityId=req.query.entityId;if((entity!=='question'&&entity!=='category')||typeof entityId!=='string')throw new ContentAdminError(400,'INVALID_ENTITY');return {revisions:await store.revisions(entity as ContentEntity,entityId)};}));
 app.post(`${prefix}/drafts`,authenticate,handle((req,p)=>store.draft(p.uid,req.body)));
 app.post(`${prefix}/revisions/:id/review`,authenticate,handle((req,p)=>store.review(p.uid,req.params.id)));
 // Re-read all active heads after commit. Runtime refresh failure is explicit; persisted revisions remain recoverable.
 app.post(`${prefix}/revisions/:id/activate`,authenticate,handle(async(req,p)=>{const run=activationQueue.then(async()=>{const result=await store.activate(p.uid,req.params.id,req.body?.expectedRevisionId);await publishContentOverlays(await store.overlays());return {...result,activeReleaseId:realContent().source.releaseId,huroofRefresh:'next-room'};});activationQueue=run.catch(()=>undefined);return run;}));
 app.post(`${prefix}/restore-original`,authenticate,handle(async(req,p)=>{const run=activationQueue.then(async()=>{const result=await store.restoreOriginal(p.uid,req.body?.entity,req.body?.entityId,req.body?.expectedRevisionId);await publishContentOverlays(await store.overlays());return result;});activationQueue=run.catch(()=>undefined);return run;}));
 return store;
}
