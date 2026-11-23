import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalHistory, type LocalHistoryEntry } from './history';
import { LOCAL_PROJECT } from './guard';
import { parseHistory } from '../../../../../src/features/enta/history';
const p={projectId:LOCAL_PROJECT,uid:'owner',email:'host@example.test',verifiedAccount:true,anonymous:false};
function entry(i:number):LocalHistoryEntry {return {row:{id:`match-${String(i).padStart(3,'0')}`,admissionProtocol:3,mode:'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:'enta-classic-3',route:'LEGACY',status:'FINISHED',createdAt:new Date(1700000000000+i).toISOString(),finishedAt:new Date(1700000001000+i).toISOString(),teams:[{name:'أحمد',score:200},{name:'يوسف',score:0}],summary:{reason:'HOST_ENDED',unplayedCount:35,isTie:false}},result:{schemaVersion:1,id:`match-${String(i).padStart(3,'0')}`,physicalProtocol:3,mode:'CLASSIC',executionFormat:'TIER_BOARD',retainedRulesProfile:'enta-classic-3',reason:'HOST_ENDED',unplayedCount:35,isTie:false,teams:[{name:'أحمد',score:200,winner:true},{name:'يوسف',score:0,winner:false}]}};}
test('local history matches client contract, pages without duplicates and binds cursor to owner and filters',async()=>{
 const history=createLocalHistory([async owner=>owner.uid==='owner'?Array.from({length:27},(_,i)=>entry(i)):[]],Buffer.alloc(32,7));
 const first=await history.page(p,{});assert.equal(parseHistory(first).matches.length,25);assert.ok(first.nextCursor);
 const second=await history.page(p,{cursor:first.nextCursor});assert.equal(parseHistory(second).matches.length,2);assert.equal(second.nextCursor,null);assert.equal(new Set([...first.matches,...second.matches].map(r=>r.id)).size,27);
 await assert.rejects(history.page({...p,uid:'other'},{cursor:first.nextCursor}));
 await assert.rejects(history.page(p,{cursor:first.nextCursor,mode:'KIDS'}));
 await assert.rejects(history.page(p,{cursor:first.nextCursor!.slice(0,-4)+'AAAA'}));
 assert.equal((await history.page(p,{mode:'KIDS'})).matches.length,0);
 assert.equal((await history.original(p,'match-026')).teams[0].winner,true);
 await assert.rejects(history.original({...p,uid:'other'},'match-026'));
 await assert.rejects(history.page({...p,verifiedAccount:false},{}));
});
test('ambiguous IDs across local providers fail closed instead of selecting a different result',async()=>{
 const history=createLocalHistory([async()=>[entry(1)],async()=>[entry(1)]],Buffer.alloc(32,7));
 await assert.rejects(history.page(p,{}),/HISTORY_DATA_UNAVAILABLE/);
 await assert.rejects(history.original(p,'match-001'),/HISTORY_DATA_UNAVAILABLE/);
});
