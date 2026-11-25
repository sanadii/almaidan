import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AuthoritativeGameService} from '../../server/service.js';
import {loadLocalReleaseQuestionSource} from '../../server/local-release-question-source.js';
import {createLocalOwnedRoom} from '../../server/local-owned-room-creation.js';
import {createLocalOwnedRematch} from '../../server/local-owned-room-rematch.js';
const claims=(uid='rematch-owner')=>({aud:'demo-almaidan-local',iss:'https://securetoken.google.com/demo-almaidan-local',sub:uid,uid,currentUser:{disabled:false,emailVerified:true,email:'owner@almaidan.local'},firebase:{sign_in_provider:'password'}});
// These suites read the private local Almaidan content and need its explicit local environment.
const localEnvironment=process.env.ALMAIDAN_LOCAL_ONLY==='true'&&process.env.FIREBASE_PROJECT_ID==='demo-almaidan-local'&&process.env.GAME_HOST==='127.0.0.1';
const localOnly={skip:localEnvironment?false:'requires ALMAIDAN_LOCAL_ONLY=true, FIREBASE_PROJECT_ID=demo-almaidan-local and GAME_HOST=127.0.0.1'};
test('local Huroof rematch retains source/settings, excludes consumed concepts, recovers receipt and publishes the successor on the finished parent',localOnly,async()=>{
 const source=await loadLocalReleaseQuestionSource(),dir=await mkdtemp('D:/projects/huroof_wa_oloof/local/almaidan/huroof-rematch-review-'),path=join(dir,'rooms.sqlite');let service=new AuthoritativeGameService({dbPath:path,secret:'rematch-test',localFirestoreQuestionSource:source});
 try{
  const parent=await createLocalOwnedRoom(service,'Bearer identity',{requestKey:randomUUID(),demo:true,categories:source.inventory.recommendedHuroofCategoryIds,questionSeconds:45,teams:{horizontal:'الأول',vertical:'الثاني'}},async()=>claims());
  let revision=parent.revision;const send=async(type:string,payload:Record<string,unknown>={})=>{const result=await service.intent(parent.roomId,parent.token,{type:type as never,intentId:randomUUID(),expectedRevision:revision,payload});revision=result.revision;};
  await send('START_MATCH');await send('ROUND_READY');const board=service.metadata(parent.roomId,parent.token).projection.board!;await send('SELECT_CELL',{cellId:board.find(c=>c.kind==='letter')!.id});
  const question=service.store.load(parent.roomId)!.activeQuestion!;await assert.rejects(createLocalOwnedRematch(service,'Bearer identity',parent.token,parent.roomId,{requestKey:randomUUID()},async()=>claims()),/LOCAL_REMATCH_NOT_FINISHED/);await send('PAUSE');await send('END_WITHOUT_WINNER');const original=service.store.load(parent.roomId)!;
  service.replaceLocalQuestionSource({...source,snapshotId:'a'.repeat(64)});
  const key=randomUUID();const next=await createLocalOwnedRematch(service,'Bearer identity',parent.token,parent.roomId,{requestKey:key},async()=>claims());assert.equal(next.source.snapshotId,source.snapshotId);assert.equal(next.predecessorRoomId,parent.roomId);assert.notEqual(next.roomId,parent.roomId);
  const successor=service.store.load(next.roomId)!;assert.deepEqual(successor.config,original.config);assert.ok(successor.localRematch!.excludedQuestionIds.includes(question.id));assert.ok(successor.localRematch!.excludedAnswerConceptIds.includes(question.answerConceptId));const linked=service.store.load(parent.roomId)!;assert.deepEqual(linked.successor,{roomId:next.roomId,roomCode:next.roomCode});assert.equal(linked.revision,original.revision+1);assert.deepEqual(linked.game,original.game);
  const effective=await (service as any).effectiveQuestions(successor);assert.ok(effective.every((q:any)=>q.id!==question.id&&q.answerConceptId!==question.answerConceptId));
  await assert.rejects(createLocalOwnedRematch(service,'Bearer identity',parent.audienceToken,parent.roomId,{requestKey:randomUUID()},async()=>claims()),/LOCAL_REMATCH_HOST_REQUIRED/);await assert.rejects(createLocalOwnedRematch(service,'Bearer identity',parent.token,parent.roomId,{requestKey:randomUUID()},async()=>claims('foreign-owner')),/LOCAL_REMATCH_HOST_REQUIRED/);
  service.close();service=new AuthoritativeGameService({dbPath:path,secret:'rematch-test',localFirestoreQuestionSource:source});const retry=await createLocalOwnedRematch(service,'Bearer identity',parent.token,parent.roomId,{requestKey:key},async()=>claims());assert.equal(retry.roomId,next.roomId);assert.equal(retry.token,next.token);assert.equal(retry.idempotent,true);assert.equal(service.store.rooms().length,2);
  let nextRevision=service.metadata(next.roomId,next.token).revision;for(const type of ['START_MATCH','ROUND_READY','PAUSE','END_WITHOUT_WINNER'])nextRevision=(await service.intent(next.roomId,next.token,{type:type as never,intentId:randomUUID(),expectedRevision:nextRevision,payload:{}})).revision;const inherited=await createLocalOwnedRematch(service,'Bearer identity',next.token,next.roomId,{requestKey:randomUUID()},async()=>claims());assert.ok(service.store.load(inherited.roomId)!.localRematch!.excludedQuestionIds.includes(question.id));
 }finally{service.close();}
});
test('legacy owner attribution and successor are atomic; missing source fails closed',localOnly,async()=>{
 const source=await loadLocalReleaseQuestionSource(),dir=await mkdtemp('D:/projects/huroof_wa_oloof/local/almaidan/huroof-legacy-rematch-review-'),service=new AuthoritativeGameService({dbPath:join(dir,'rooms.sqlite'),secret:'legacy-rematch-test',localFirestoreQuestionSource:source});
 try{const legacy=service.create('legacy',true,{categories:source.inventory.recommendedHuroofCategoryIds});let revision=legacy.revision;for(const type of ['START_MATCH','ROUND_READY','PAUSE','END_WITHOUT_WINNER'])revision=(await service.intent(legacy.roomId,legacy.token,{type:type as never,intentId:randomUUID(),expectedRevision:revision,payload:{}})).revision;const broken=service.store.load(legacy.roomId)!;const snapshot=broken.questionSourceSnapshot;broken.questionSourceSnapshot='missing';service.store.save(broken);
  await assert.rejects(createLocalOwnedRematch(service,'Bearer identity',legacy.token,legacy.roomId,{requestKey:randomUUID()},async()=>claims()),error=>error instanceof Error&&error.message==='LOCAL_REMATCH_SOURCE_UNAVAILABLE');assert.equal(service.store.localRoomOwner(legacy.roomId),undefined);assert.equal(service.store.rooms().length,1);broken.questionSourceSnapshot=snapshot;service.store.save(broken);const successor=await createLocalOwnedRematch(service,'Bearer identity',legacy.token,legacy.roomId,{requestKey:randomUUID()},async()=>claims());assert.equal(service.store.localRoomOwner(legacy.roomId),claims().uid);assert.equal(service.store.localRoomOwner(successor.roomId),claims().uid);assert.deepEqual(service.store.load(legacy.roomId)!.successor,{roomId:successor.roomId,roomCode:successor.roomCode});assert.equal(service.store.rooms().length,2);
 }finally{service.close();}
});
