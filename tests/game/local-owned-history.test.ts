import {localOwnerRoomAccess} from '../../server/local-owned-room-access.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AuthoritativeGameService} from '../../server/service.js';
import {loadLocalReleaseQuestionSource} from '../../server/local-release-question-source.js';
import {createLocalOwnedRoom,localVerifiedHost} from '../../server/local-owned-room-creation.js';
import type {FirebaseClaims} from '../../services/enta/server/src/identity.js';
const owner=(uid:string):FirebaseClaims=>({aud:'demo-almaidan-local',iss:'https://securetoken.google.com/demo-almaidan-local',sub:uid,uid,currentUser:{disabled:false,emailVerified:true,email:'history@almaidan.local'},firebase:{sign_in_provider:'password'}});
test('local history is read-only, owner-scoped, excludes legacy rooms and exposes only safe summaries',async()=>{
 const source=await loadLocalReleaseQuestionSource(),dir=await mkdtemp('D:/projects/huroof_wa_oloof/local/almaidan/history-review-'),path=join(dir,'rooms.sqlite');
 const service=new AuthoritativeGameService({dbPath:path,secret:'history-review-only',localFirestoreQuestionSource:source});
 try{
  assert.deepEqual(service.store.localOwnedHistory('owner'),{items:[],nextOffset:null});
  service.create('legacy',true,{categories:source.inventory.recommendedHuroofCategoryIds});
  const request={requestKey:randomUUID(),demo:true,displayName:'History',categories:source.inventory.recommendedHuroofCategoryIds};
  const a=await createLocalOwnedRoom(service,'Bearer test',request,async()=>owner('a'));
  const b=await createLocalOwnedRoom(service,'Bearer test',request,async()=>owner('b'));
  const access=await localOwnerRoomAccess(service,'Bearer test',a.roomId,async()=>owner('a'));assert.equal(access.token,a.token);assert.equal(access.audienceToken,a.audienceToken);assert.ok(service.metadata(access.roomId,access.token));
  await assert.rejects(localOwnerRoomAccess(service,'Bearer test',a.roomId,async()=>owner('b')),/LOCAL_OWNED_ROOM_NOT_FOUND/);
  await assert.rejects(localOwnerRoomAccess(service,undefined,a.roomId),/LOCAL_HOST_AUTHENTICATION_REQUIRED/);
  const before=createHash('sha256').update(await readFile(path)).digest('hex');
  const result=service.store.localOwnedHistory('a');
  assert.equal(result.items.length,1);assert.equal(result.items[0].id,a.roomId);assert.notEqual(result.items[0].id,b.roomId);
  assert.equal(result.items[0].phase,'LOBBY');assert.equal(result.items[0].complete,false);assert.ok(result.items[0].source.snapshot);assert.ok(result.items[0].categories.every(c=>c.labelAr));
  const payload=JSON.stringify(result);for(const secret of [a.token,a.audienceToken,b.token])assert.ok(!payload.includes(secret));
  assert.deepEqual(Object.keys(result.items[0]).sort(),['id','code','revision','createdAt','updatedAt','phase','complete','teams','settings','categories','scores','roundWins','currentRound','winner','completionReason','source','predecessor'].sort());
  assert.deepEqual(service.store.localOwnedHistory('unknown').items,[]);assert.deepEqual(service.store.localOwnedHistory('a',1).items,[]);assert.throws(()=>service.store.localOwnedHistory('a',-1));
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),before);
  await assert.rejects(localVerifiedHost(undefined),/LOCAL_HOST_AUTHENTICATION_REQUIRED/);
  await assert.rejects(localVerifiedHost('Bearer bad',async()=>({...owner('a'),firebase:{sign_in_provider:'anonymous'}})),/LOCAL_VERIFIED_HOST_REQUIRED/);
 }finally{service.close();}
});
