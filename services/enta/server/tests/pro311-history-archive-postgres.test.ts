import assert from 'node:assert/strict';
import test from 'node:test';
import {createPrivateArchive, type CleanupBoundary} from '../src/huroof-pg/history-archive-postgres';
import {ReservationLedger,RESOURCE_HOLDERS,type ResourceEnvelope} from '../src/huroof-pg/history-archive-resource';
const request={namespace:'n',owner:'o',policyRevision:'1',policyHash:'a'.repeat(64),matchId:'m',resultVersion:'9223372036854775807'};
const identity={job:'job',profile:'p',producer:'source',epoch:'e',session:'s',fence:'1'};
const admission={identity,envelope:Object.fromEntries(RESOURCE_HOLDERS.map(k=>[k,1n])) as ResourceEnvelope,expiresAt:100,profile:'p',epoch:'e'};
test('fixed parameterized calls, precision and denied mismatch before IO',async()=>{
 const calls:Array<{sql:string;args:readonly unknown[]}>=[];const db={async query<T>(sql:string,args:readonly unknown[]){calls.push({sql,args});return {rows:[{value:sql.includes('preflight')?{job:'d'.repeat(64),bytes:'12',resultHash:'b'.repeat(64)}:{status:'COMPLETE',identity:'c'.repeat(64)}} as T]};}};
 const ledger=new ReservationLedger(16n);const service=createPrivateArchive(db,ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);
 assert.equal((await service.preflight(request,{...admission,identity:{...identity,job:'preflight'}})).bytes,'12');assert.equal(calls[0].args[5],request.resultVersion);assert.equal(calls[0].args[6],'preflight');
 await assert.rejects(service.derive(request,{...admission,profile:'bad'}),/RESOURCE_UNQUALIFIED/);assert.equal(calls.length,1);
 const next=createPrivateArchive(db,ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);
 assert.deepEqual(await next.derive(request,{...admission,identity:{...identity,session:'s2'}}),{status:'COMPLETE',identity:'c'.repeat(64)});assert.equal(calls[1].args[6],'job');assert.equal(ledger.state('job'),'RELEASED');
});
test('lost response and uncertain cleanup quarantine live reservation',async()=>{
 const ledger=new ReservationLedger(16n);
 const actual=createPrivateArchive({async query<T>(){throw Error('lost response');}},ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:false}}},()=>1);
 await assert.rejects(actual.derive(request,admission),/RESULT_UNAVAILABLE/);assert.equal(ledger.state('job'),'QUARANTINED');const retry=createPrivateArchive({async query<T>(){throw Error('unexpected');}},ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);await assert.rejects(retry.derive(request,admission),/RESOURCE_BUSY/);
});
test('bounded response validation and closed terminal projection',async()=>{
 const response={terminalType:'ABANDONED',projection:{schemaVersion:1,kind:'ABANDONED',matchId:'m',resultVersion:request.resultVersion,occurredAt:'2024-02-29T00:00:00.000Z'}};
 const service=createPrivateArchive({async query<T>(){return {rows:[{value:response} as T]};}},new ReservationLedger(16n),{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);assert.deepEqual(await service.read(request,admission),response.projection);
});
test('inventory calls are fixed, preserve incomplete and reject unbounded replies',async()=>{
 const calls:string[]=[];const db={async query<T>(sql:string){calls.push(sql);return {rows:[{value:sql.includes('create')?'e'.repeat(64):'INCOMPLETE'} as T]};}};const ledger=new ReservationLedger(16n);const cleanup:CleanupBoundary={async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}};const service=createPrivateArchive(db,ledger,cleanup,()=>1);
 assert.equal(await service.inventoryCreate('e'.repeat(64),admission),'e'.repeat(64));const next=createPrivateArchive(db,ledger,cleanup,()=>1);assert.equal(await next.inventoryFinish('e'.repeat(64),{...admission,identity:{...identity,session:'s2'}}),'INCOMPLETE');assert.deepEqual(calls,['SELECT public.pro311_inventory_create($1,$2,$3) AS value','SELECT public.pro311_inventory_finish($1,$2,$3) AS value']);
});

test('driver details never escape and uncertain cleanup still retains capacity',async()=>{
 const ledger=new ReservationLedger(16n);const service=createPrivateArchive({async query<T>(){throw Object.assign(new Error('SECRET_RAW_FRAGMENT'),{detail:'private semantic bytes'});}},ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:false}}},()=>1);
 await assert.rejects(service.derive(request,admission),{message:'RESULT_UNAVAILABLE'});assert.equal(ledger.state('job'),'QUARANTINED');
});

test('throwing driver response accessor is sanitized and retains uncertain reservation',async()=>{
 const ledger=new ReservationLedger(16n);const service=createPrivateArchive({async query<T>(){return {rows:[{get value(){throw new Error('PRIVATE_RAW_IN_ACCESSOR')}} as T]};}},ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:false}}},()=>1);
 await assert.rejects(service.derive(request,admission),{message:'RESULT_UNAVAILABLE'});assert.equal(ledger.state('job'),'QUARANTINED');
});

test('cleanup requires every matching step including confirmed termination',async()=>{
 const stages:string[]=[]; const ledger=new ReservationLedger(16n);
 const service=createPrivateArchive({async query<T>(){return {rows:[{value:{status:'COMPLETE',identity:'c'.repeat(64)}} as T]};}},ledger,{async perform(stage,identity){stages.push(stage);return {stage,session:identity.session,fence:identity.fence,done:stage!=='TERMINATION_VERIFIED'}}},()=>1);
 assert.equal((await service.derive(request,admission)).status,'COMPLETE');assert.deepEqual(stages,['QUERY_SETTLED','ROLLBACK_DRAINED','PROTOCOL_DRAINED','SESSION_TERMINATED','TERMINATION_VERIFIED']);assert.equal(ledger.state('job'),'QUARANTINED');
});

test('changing response accessors cannot expand or alias bounded output',async()=>{
 let reads=0;const response={status:'COMPLETE',get identity(){reads++;return reads===1?'a'.repeat(64):{private:'data'}}}; const ledger=new ReservationLedger(16n);
 const service=createPrivateArchive({async query<T>(){return {rows:[{value:response} as T]};}},ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);
 const result=await service.derive(request,admission);assert.equal(result.identity,'a'.repeat(64));assert.equal(reads,1);
});
test('cancellation acknowledgement while query is live does not release or overlap',async()=>{
 let finishQuery:(value:{rows:Array<{value:{status:string;identity:string}}>})=>void=()=>{throw Error('not started')};let cancels=0;
 const db={query<T>(){return new Promise<{rows:T[]}>(resolve=>{finishQuery=resolve as typeof finishQuery;});},async cancel(){cancels++;}};
 const ledger=new ReservationLedger(16n);const service=createPrivateArchive(db,ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);
 const pending=service.derive(request,admission);await service.requestCancel('job');assert.equal(cancels,1);assert.equal(ledger.state('job'),'QUARANTINED');const retry=createPrivateArchive(db,ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);await assert.rejects(retry.derive(request,admission),/RESOURCE_BUSY/);
 finishQuery({rows:[{value:{status:'COMPLETE',identity:'a'.repeat(64)}}]});await pending;assert.equal(ledger.state('job'),'RELEASED');
});
test('unqualified identities and expiry deny before any database call',async()=>{
 let calls=0;const db={async query<T>(){calls++;return {rows:[] as T[]}}};const ledger=new ReservationLedger(16n);const service=createPrivateArchive(db,ledger,{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>100);
 for(const candidate of [{...admission,expiresAt:100},{...admission,expiresAt:101,epoch:'different'},{...admission,expiresAt:101,identity:{...identity,fence:'01'}},{...admission,expiresAt:101,identity:{...identity,session:''}}]) await assert.rejects(service.derive(request,candidate),/RESOURCE_UNQUALIFIED/);
 assert.equal(calls,0);
});
test('distinct correction versions and conflict results remain isolated',async()=>{
 const calls:readonly unknown[][]=[] as unknown as readonly unknown[][]; const mutable=calls as unknown as unknown[][];
 const db={async query<T>(_sql:string,args:readonly unknown[]){mutable.push([...args]); if(args[5]==='2') throw new Error('raw detail or conflict'); return {rows:[{value:{status:'COMPLETE',identity:'a'.repeat(64)}} as T]};}};
 const ledger=new ReservationLedger(16n);const cleanup:CleanupBoundary={async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}};const service=createPrivateArchive(db,ledger,cleanup,()=>1);
 await service.derive({...request,resultVersion:'1'},admission);const next=createPrivateArchive(db,ledger,cleanup,()=>1);await assert.rejects(next.derive({...request,resultVersion:'2'},{...admission,identity:{...identity,session:'s2'}}),{message:'RESULT_UNAVAILABLE'});
 assert.equal(calls[0][5],'1');assert.equal(calls[1][5],'2');
});

test('a terminated dedicated adapter cannot silently reuse its connection',async()=>{
 const service=createPrivateArchive({async query<T>(){return {rows:[{value:{status:'COMPLETE',identity:'a'.repeat(64)}} as T]};}},new ReservationLedger(16n),{async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}},()=>1);
 await service.derive(request,admission);await assert.rejects(service.derive(request,admission),/RESOURCE_UNAVAILABLE/);
});
test('inventory retries preserve the stable boundary and completed result across dedicated sessions',async()=>{
 const boundary='e'.repeat(64);const calls:string[]=[];let members=['before'];let stored:string[]|undefined;let completed=false;
 const db={async query<T>(sql:string,args:readonly unknown[]){calls.push(sql);assert.equal(args[0],boundary);if(sql.includes('create')){if(!stored)stored=[...members];return {rows:[{value:boundary} as T]};}if(sql.includes('finish')){completed=true;return {rows:[{value:'COMPLETE'} as T]};}throw Error('unexpected');}};
 const ledger=new ReservationLedger(16n);const cleanup:CleanupBoundary={async perform(stage,identity){return {stage,session:identity.session,fence:identity.fence,done:true}}};
 const session=(n:number)=>createPrivateArchive(db,ledger,cleanup,()=>1);const admit=(n:number)=>({...admission,identity:{...identity,job:'job'+n,session:'session'+n}});
 assert.equal(await session(1).inventoryCreate(boundary,admit(1)),boundary);members.push('later');assert.equal(await session(2).inventoryCreate(boundary,admit(2)),boundary);assert.deepEqual(stored,['before']);
 assert.equal(await session(3).inventoryFinish(boundary,admit(3)),'COMPLETE');assert.equal(await session(4).inventoryFinish(boundary,admit(4)),'COMPLETE');assert.equal(completed,true);assert.equal(calls.length,4);
});
