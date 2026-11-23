import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {test} from 'node:test';
import {fixtureCompetitionGame} from './enta-competition-fixture';import {reduceCompetitionCommand} from '../src/rounds/competition-engine';import {parseCompetitionCommand} from '../src/rounds/competition-rules';import {settleCompetitiveClock} from '../src/rounds/competition-clock';import {validateCapacity} from '../src/rounds/competition-capacity';import type {CompetitionGame} from '../src/rounds/competition-types';
const start=Date.parse('2026-10-08T20:00:00Z');
function run(game:CompetitionGame,input:Record<string,unknown>,now=start){return reduceCompetitionCommand(game,parseCompetitionCommand({commandId:randomUUID(),expectedVersion:game.version,...input}),now).next;}
function claimDisposition(game:CompetitionGame,kind:string,sourceId:string){const claim=game.capacityReservations.find(c=>c.sourceKind===kind&&c.sourceId===sourceId)!;return game.capacityDispositions.find(d=>d.reservationId===claim.id);}
test('both anchored board expiries consume ROUND at actual no-score closure, never earlier STEAL_OPENED',()=>{
 let game=fixtureCompetitionGame('TIER_BOARD');const rid=game.rounds[0].id;game=run(game,{type:'OPEN_ROUND',roundId:rid});const before=game.events.length;
 assert.equal(settleCompetitiveClock(game,start+40001),true);const batch=game.events.slice(before);assert.deepEqual(batch.map(e=>e.type),['STEAL_OPENED','RECORDING_CLOSED']);
 assert.deepEqual(claimDisposition(game,'ROUND',rid),{reservationId:game.capacityReservations.find(c=>c.sourceKind==='ROUND'&&c.sourceId===rid)!.id,eventId:batch[1].id,kind:'CONSUME'});
 const forged=structuredClone(game);claimDisposition(forged,'ROUND',rid)!.eventId=batch[0].id;assert.throws(()=>validateCapacity(forged));validateCapacity(game);
});
test('PHONE_ENDED plus phase transfer and recording close preserve three event-specific dispositions',()=>{
 let game=fixtureCompetitionGame('TIER_BOARD');const rid=game.rounds[0].id;game=run(game,{type:'OPEN_ROUND',roundId:rid});game=run(game,{type:'USE_AID',roundId:rid,teamId:game.teams[0].id,aid:'PHONE_A_FRIEND'});
 const pause=game.rounds[0].pause!,before=game.events.length;assert.equal(settleCompetitiveClock(game,pause.resumeAt!+pause.phaseRemaining!+10001),true);
 const batch=game.events.slice(before);assert.deepEqual(batch.map(e=>e.type),['PHONE_ENDED','STEAL_OPENED','RECORDING_CLOSED']);assert.equal(claimDisposition(game,'PAUSE',pause.eventId)!.eventId,batch[0].id);assert.equal(claimDisposition(game,'ROUND',rid)!.eventId,batch[2].id);validateCapacity(game);
});
test('accepted pending evidence survives both expiries and drains from AWAITING_RULING at its genuine original event',()=>{
 let game=fixtureCompetitionGame('TIER_BOARD');const rid=game.rounds[0].id;game=run(game,{type:'OPEN_ROUND',roundId:rid});game=run(game,{type:'RECORD_ATTEMPT',roundId:rid,itemId:null,teamId:game.teams[0].id,playerId:game.teams[0].players[0].id});const accepted=structuredClone(game.attempts[0]);
 settleCompetitiveClock(game,start+40001);assert.equal(game.rounds[0].phase,'AWAITING_RULING');assert.equal(claimDisposition(game,'ROUND',rid),undefined);assert.deepEqual(game.attempts[0],accepted);
 game=run(game,{type:'PUBLIC_REVEAL',roundId:rid,itemId:null},start+40001);game=run(game,{type:'FINAL_RULING',roundId:rid,itemId:null,classifications:[[accepted.id,true]]},start+40001);assert.equal(game.classifications[0].correct,true);assert.equal(claimDisposition(game,'ROUND',rid)!.eventId,game.events.at(-1)!.id);assert.equal(claimDisposition(game,'ROUND',rid)!.kind,'CONSUME');validateCapacity(game);
});
test('item review at expiry releases only unused items and ROUND at RECORDING_CLOSED, retaining review and original consumption',()=>{
 let game=fixtureCompetitionGame('STANDALONE_LIST');const rid=game.rounds[0].id,item=game.rounds[0].pin.items[0];game=run(game,{type:'NEXT_ROUND'});game=run(game,{type:'RECORD_ATTEMPT',roundId:rid,itemId:item.id,teamId:game.teams[0].id,playerId:game.teams[0].players[0].id});game=run(game,{type:'PUBLIC_REVEAL',roundId:rid,itemId:item.id});game=run(game,{type:'FINAL_RULING',roundId:rid,itemId:item.id,classifications:[[game.attempts[0].id,true]]});const original=game.effects.at(-1)!;game=run(game,{type:'UNDO_EFFECT',effectId:original.id,effectHash:original.hash});const review=game.itemReviews[0],at=game.rounds[0].overallDeadline!+1;
 settleCompetitiveClock(game,at);const close=game.events.at(-1)!;assert.equal(close.type,'RECORDING_CLOSED');assert.equal(game.openItemReview,review.id);assert.equal(claimDisposition(game,'REVIEW',review.id),undefined);assert.equal(claimDisposition(game,'ITEM',item.id)!.eventId,original.eventId);assert.equal(claimDisposition(game,'ROUND',rid)!.eventId,close.id);assert.equal(claimDisposition(game,'ROUND',rid)!.kind,'RELEASE');
 for(const unused of game.rounds[0].pin.items.filter(i=>i.id!==item.id))assert.equal(claimDisposition(game,'ITEM',unused.id)!.eventId,close.id);
 game=run(game,{type:'RESOLVE_ITEM_REVIEW',reviewId:review.id,reviewHash:review.hash,rulingVersion:2,mode:'RESTORE_ORIGINAL',correctAttemptIds:[],reason:'استعادة الحكم الأصلي'},at);assert.equal(game.openItemReview,null);assert.equal(game.rounds[0].phase,'RESOLVED');validateCapacity(game);
});
test('fresh READY/RESOLVED final is refused without partial mutation; active empty final and exact saved retry remain valid',()=>{
 let game=fixtureCompetitionGame('STANDALONE_LIST');const rid=game.rounds[0].id,ready=structuredClone(game);assert.throws(()=>run(game,{type:'FINAL_RULING',roundId:rid,itemId:null,classifications:[]}));assert.deepEqual(game,ready);
 game=run(game,{type:'NEXT_ROUND'});game=run(game,{type:'PUBLIC_REVEAL',roundId:rid,itemId:null});const command=parseCompetitionCommand({commandId:randomUUID(),expectedVersion:game.version,type:'FINAL_RULING',roundId:rid,itemId:null,classifications:[]});game=reduceCompetitionCommand(game,command,start).next;assert.equal(game.rounds[0].phase,'RESOLVED');assert.equal(game.effects.at(-1)!.kind,'NO_SCORE');assert.equal(game.effects.at(-1)!.reversible,false);const closed=structuredClone(game);
 assert.throws(()=>run(game,{type:'FINAL_RULING',roundId:rid,itemId:null,classifications:[]}));assert.deepEqual(game,closed);assert.equal(reduceCompetitionCommand(game,command,start).idempotent,true);assert.deepEqual(game,closed);
});
