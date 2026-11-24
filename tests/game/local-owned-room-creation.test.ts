import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AuthoritativeGameService} from '../../server/service.js';
import {loadLocalReleaseQuestionSource} from '../../server/local-release-question-source.js';
import {createLocalOwnedRoom} from '../../server/local-owned-room-creation.js';
import type {FirebaseClaims} from '../../services/enta/server/src/identity.js';
const owner=(uid='review-host'):FirebaseClaims=>({aud:'demo-almaidan-local',iss:'https://securetoken.google.com/demo-almaidan-local',sub:uid,uid,currentUser:{disabled:false,emailVerified:true,email:'review@almaidan.local'},firebase:{sign_in_provider:'password'}});
// These suites read the private local Almaidan content and need its explicit local environment.
const localEnvironment=process.env.ALMAIDAN_LOCAL_ONLY==='true'&&process.env.FIREBASE_PROJECT_ID==='demo-almaidan-local'&&process.env.GAME_HOST==='127.0.0.1';
const localOnly={skip:localEnvironment?false:'requires ALMAIDAN_LOCAL_ONLY=true, FIREBASE_PROJECT_ID=demo-almaidan-local and GAME_HOST=127.0.0.1'};
test('authenticated local creation is owner scoped, atomic and replays exact host authority after reconnect',localOnly,async()=>{
 const source=await loadLocalReleaseQuestionSource(),dir=await mkdtemp('D:/projects/huroof_wa_oloof/local/almaidan/owned-create-review-'),path=join(dir,'rooms.sqlite');
 let service=new AuthoritativeGameService({dbPath:path,secret:'review-only-secret',localFirestoreQuestionSource:source});
 const request={requestKey:randomUUID(),demo:true,displayName:'مراجعة',categories:source.inventory.recommendedHuroofCategoryIds};
 try{
  await assert.rejects(createLocalOwnedRoom(service,undefined,request,async()=>owner()),/LOCAL_HOST_AUTHENTICATION_REQUIRED/);
  await assert.rejects(createLocalOwnedRoom(service,'Bearer test',request,async()=>({...owner(),firebase:{sign_in_provider:'anonymous'}})),/LOCAL_VERIFIED_HOST_REQUIRED/);
  const creations=await Promise.all(Array.from({length:4},()=>createLocalOwnedRoom(service,'Bearer test',request,async()=>owner())));assert.equal(new Set(creations.map(c=>c.roomId)).size,1);assert.equal(creations.filter(c=>!c.idempotent).length,1);assert.equal(service.store.rooms().length,1);
  const original=creations[0];await assert.rejects(createLocalOwnedRoom(service,'Bearer test',{...request,displayName:'تغيير'},async()=>owner()),/LOCAL_CREATE_KEY_CONFLICT/);assert.equal(service.store.rooms().length,1);
  const another=await createLocalOwnedRoom(service,'Bearer test',request,async()=>owner('other-owner'));assert.notEqual(another.roomId,original.roomId);assert.notEqual(another.token,original.token);
  const rollbackKey=randomUUID();await assert.rejects(createLocalOwnedRoom(service,'Bearer test',{...request,requestKey:rollbackKey,categories:['not-available']},async()=>owner()));assert.equal(service.store.rooms().length,2);
  await createLocalOwnedRoom(service,'Bearer test',{...request,requestKey:rollbackKey},async()=>owner());assert.equal(service.store.rooms().length,3);
  // Failure after room/snapshot/event writes must leave no partial room or receipt.
  const db=(service.store as unknown as {db:{exec(sql:string):void}}).db;
  db.exec("CREATE TEMP TRIGGER fail_owned_receipt BEFORE INSERT ON local_owned_room_creations BEGIN SELECT RAISE(ABORT,'review forced failure'); END");
  const failedKey=randomUUID();await assert.rejects(createLocalOwnedRoom(service,'Bearer test',{...request,requestKey:failedKey},async()=>owner()),error=>error instanceof Error&&error.message==='LOCAL_CREATE_UNAVAILABLE');assert.equal(service.store.rooms().length,3);db.exec('DROP TRIGGER fail_owned_receipt');
  const recovered=await createLocalOwnedRoom(service,'Bearer test',{...request,requestKey:failedKey},async()=>owner());assert.equal(recovered.idempotent,false);assert.equal(service.store.rooms().length,4);
  service.close();service=new AuthoritativeGameService({dbPath:path,secret:'review-only-secret',localFirestoreQuestionSource:source});const resumed=await createLocalOwnedRoom(service,'Bearer test',request,async()=>owner());assert.equal(resumed.roomId,original.roomId);assert.equal(resumed.token,original.token);assert.equal(resumed.audienceToken,original.audienceToken);assert.equal(resumed.idempotent,true);assert.ok(service.metadata(resumed.roomId,resumed.token));assert.equal(service.store.rooms().length,4);
 }finally{service.close();}
});
test('real local emulator host verification admits verified account and rejects forged identity',localOnly,async()=>{
 const identity=JSON.parse(await readFile('D:/projects/huroof_wa_oloof/local/almaidan/admin-identity.private.json','utf8'));
 const response=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:identity.email,password:identity.password,returnSecureToken:true})});assert.equal(response.status,200);const login=await response.json();
 const source=await loadLocalReleaseQuestionSource(),dir=await mkdtemp('D:/projects/huroof_wa_oloof/local/almaidan/owned-auth-review-'),service=new AuthoritativeGameService({dbPath:join(dir,'rooms.sqlite'),secret:'review-auth-only',localFirestoreQuestionSource:source});
 try{const request={requestKey:randomUUID(),demo:true,categories:source.inventory.recommendedHuroofCategoryIds};await assert.rejects(createLocalOwnedRoom(service,'Bearer invalid',request),/LOCAL_HOST_AUTHENTICATION_REQUIRED/);const created=await createLocalOwnedRoom(service,`Bearer ${login.idToken}`,request);assert.equal(created.idempotent,false);assert.equal(service.store.rooms().length,1);}finally{service.close();}
});
