import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AuthoritativeGameService } from '../../server/service.js';
import { loadLocalReleaseQuestionSource,localRealChallengeDefinitions } from '../../server/local-release-question-source.js';
const source=await loadLocalReleaseQuestionSource(), definitions=await localRealChallengeDefinitions();
assert.equal(source.questions.length,115636);
const mechanics=['memory','missing_tile','navigation','word_search'] as const;
const dbPath=`D:/projects/huroof_wa_oloof/local/almaidan/review-challenges-${randomUUID()}.sqlite`;
let service=new AuthoritativeGameService({dbPath,secret:'isolated-review',localFirestoreQuestionSource:source,challengeDefinitions:definitions,enabledChallengeMechanics:[...mechanics]});
const saved=[];
try{
for(const kind of mechanics){
 const categories=[...new Set(definitions.map((d:any)=>JSON.parse(d.canonicalJson)).filter((d:any)=>d.kind===kind).map((d:any)=>d.categoryId))] as string[];
 const challengeCategory=categories[0];
 if(categories.length===1)categories.push(source.inventory.categories.find((c:any)=>c.categoryGameEligible&&!source.questions.some(q=>q.categoryId===c.id&&q.challenge))!.id);
 const capability={protocolVersion:'t36-challenge-runtime-v1' as const,mechanics:[...mechanics],definitionSchemas:[...new Set(definitions.map((d:any)=>d.schemaVersion))] as any};
 const room=service.create('review',true,{gameKind:'categories',categories,challenge:capability});
 const guest=await service.join(room.roomCode,'guide',capability);let revision=guest.revision;
 const send=async(type:string,payload:Record<string,unknown>={})=>{const result=await service.intent(room.roomId,room.token,{type:type as never,intentId:`${type}-${revision}`,expectedRevision:revision,payload});revision=result.revision;return result;};
 await send('LOBBY_ADD_MANUAL_PLAYER',{displayName:'opponent',team:'vertical'});
 await send('LOBBY_ASSIGN_TEAM',{memberUid:service.verify(guest.token)!.uid,team:'horizontal'});
 revision=(await service.intent(room.roomId,guest.token,{type:'LOBBY_SET_READY',intentId:`ready-${revision}`,expectedRevision:revision,payload:{ready:true}})).revision;
 await send('START_MATCH');await send('ROUND_READY');
 const cell=service.metadata(room.roomId,room.token).projection.board!.find((c:any)=>c.categoryId===challengeCategory)!;
 const selected=await send('SELECT_CELL',{cellId:cell.id});
 assert.equal(selected.projection.projection.challenge?.stage,'setup');
 assert.equal(selected.projection.projection.question,undefined);
 assert.ok(service.store.load(room.roomId)!.activeQuestion?.challenge);
 saved.push(room);console.log(`${kind}: actual-source admission and safe setup projection passed`);
}
service.close();service=new AuthoritativeGameService({dbPath,secret:'isolated-review',localFirestoreQuestionSource:source,challengeDefinitions:definitions,enabledChallengeMechanics:[...mechanics]});
for(const room of saved)assert.equal(service.metadata(room.roomId,room.token).projection.challenge?.stage,'setup');
console.log('Four actual challenge rooms persisted and authenticated after reconnect');
}finally{service.close();}
