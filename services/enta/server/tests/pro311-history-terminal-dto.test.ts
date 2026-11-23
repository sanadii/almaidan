import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHistoryTerminalDto } from '../src/huroof-pg/history-terminal-dto';
const version='9223372036854775807';
const abandoned={schemaVersion:1,kind:'ABANDONED',matchId:'match',resultVersion:version,occurredAt:'2024-02-29T00:00:00.000Z'};
test('abandoned is strict, exact and retains bigint precision',()=>{
 assert.deepEqual(parseHistoryTerminalDto('ABANDONED',abandoned,'match',version),abandoned);
 for(const bad of [{...abandoned,score:0},{...abandoned,kind:'FINISHED'},{...abandoned,resultVersion:'1'},{...abandoned,occurredAt:'2023-02-29T00:00:00.000Z'}, {...abandoned,schemaVersion:'1'}])assert.throws(()=>parseHistoryTerminalDto('ABANDONED',bad,'match',version));
 assert.throws(()=>parseHistoryTerminalDto('ABANDONED',abandoned,'match','9223372036854775808')); assert.throws(()=>parseHistoryTerminalDto('OTHER',abandoned,'match',version));
});
test('captures getter values once and delegates finished to accepted closed codec',()=>{
 let calls=0;const raw={...abandoned,get occurredAt(){calls++;return calls===1?'2024-02-29T00:00:00.000Z':({alias:true} as unknown as string)}};const result=parseHistoryTerminalDto('ABANDONED',raw,'match',version);assert.equal(calls,1);assert.equal(result.occurredAt,'2024-02-29T00:00:00.000Z');
 const finished={schemaVersion:1,matchId:'match',resultVersion:version,occurredAt:abandoned.occurredAt,questionScores:{horizontal:0,vertical:1},roundWins:{horizontal:0,vertical:2},matchWinner:null,matchWinReason:null,endedWithoutWinner:false};assert.deepEqual(parseHistoryTerminalDto('FINISHED',finished,'match',version),finished);assert.throws(()=>parseHistoryTerminalDto('FINISHED',{...finished,kind:'FINISHED'},'match',version));
});
