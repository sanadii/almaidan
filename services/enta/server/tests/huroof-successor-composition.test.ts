import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuccessorSetup,parseSuccessorStart } from '../src/huroof-pg/successor';
import { createHuroofSuccessorRepository,createHuroofSuccessorPrivateAdapters,createHuroofPrivateQueryEffect } from '../src/huroof-pg/successor-postgres';
import type { AuthenticatedContext } from '../src/huroof-pg/identity-policy';
import type { SuccessorTransactionBoundary } from '../src/huroof-pg/successor-postgres';
const config={policyVersion:1,demo:false,releaseDemoFixture:false,releaseId:'release-1',releaseRootSha256:'a'.repeat(64),gameKind:'huroof',modality:'classic',categories:['category-1'],mapPresentation:'ordinary',questionSeconds:20,opponentSeconds:10,teams:{horizontal:'الأول',vertical:'الثاني'},mode:'classic',difficulty:'mixed',labelledColours:false};
const setup={version:1,setupKey:'setup1',parentMatchId:'parent1',expectedResultVersion:1,expectedResultHash:'a'.repeat(64),config,displayName:'Host'};
const start={version:1,requestKey:'request1',logicalMatchId:'logical1',setupKey:'setup1',expectedRevision:0,profileScope:'scope1'};
test('PG successor inputs reject overrides and use current lobby validator',()=>{
 assert.equal(parseSuccessorSetup(setup).parentMatchId,'parent1');assert.equal(parseSuccessorStart(start).setupKey,'setup1');
 assert.throws(()=>parseSuccessorSetup({...setup,ownerId:'attacker'}),/INVALID_REQUEST/);
 assert.throws(()=>parseSuccessorStart({...start,namespace:'other'}),/INVALID_REQUEST/);
 assert.throws(()=>parseSuccessorSetup({...setup,config:{...config,demo:true}}),/INVALID_REQUEST/);
});
test('PG retry adapter binds captured context and validates replay, SQL I/O inert',async()=>{
 const c={identityId:'identity',principal:{projectId:'project',uid:'uid',anonymous:false,verifiedAccount:true},policy:{namespace:'ns',revision:'1',hash:'b'.repeat(64),projectId:'project',issuer:'issuer',audience:'project',clientProjectId:'project'}} as AuthenticatedContext;
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{strings:string[],values:unknown[]})=>{assert.match(q.strings.join(' '),/eng03_06_successor_retry/);const context=JSON.parse(q.values[0] as string);assert.deepEqual(Object.keys(context).sort(),['identityId','namespace','policyHash','policyRevision','projectId','uid']);return [{value:{admissionId:'ha_'+'a'.repeat(64),matchId:'hm_'+'b'.repeat(64),roomId:'l_'+'c'.repeat(64),status:'STARTED',state:'COMMITTED',revision:1,sequence:1,replayed:true}}];}})} as unknown as SuccessorTransactionBoundary;
 assert.equal((await createHuroofSuccessorRepository(db).retry(c,parseSuccessorStart(start)))?.replayed,true);
});
import { createHash } from 'node:crypto';
import { createHuroofSuccessorService } from '../src/huroof-pg/successor';
import type { IdentityDependencies } from '../src/huroof-pg/identity-policy';
import type { HuroofSuccessorRepository } from '../src/huroof-pg/successor-postgres';
import type { LobbyRepository, PaidRepository, LobbyState } from '../src/huroof-pg/repository';
function identity(verified:boolean):IdentityDependencies {
 const policy={schema:'huroof-identity-policy-v1',namespace:'ns',projectId:'project',issuer:'https://securetoken.google.com/project',audience:'project',clientProjectId:'project'};const raw=Buffer.from(JSON.stringify(policy));
 return {namespace:'ns',clientProjectId:'project',readActivePolicy:async()=>({namespace:'ns',revision:'1',hash:createHash('sha256').update(raw).digest('hex'),raw,projectId:'project',issuer:policy.issuer,audience:{projectId:'project'}}),verifyToken:async()=>({aud:'project',iss:policy.issuer,sub:'uid',email:'host@example.test',email_verified:verified,currentUser:{disabled:false,emailVerified:verified,email:'host@example.test'},firebase:{sign_in_provider:'password'}}),resolveIdentity:async()=> 'identity'};
}
test('setup exact retry precedes host eligibility; miss does not prepare fresh state',async()=>{
 let nativeCalls=0,setupCalls=0;
 const native={deriveCreateIdentity:async()=>{nativeCalls++;throw Error('unexpected create');}} as unknown as LobbyRepository & PaidRepository;
 const saved={roomId:'l_'+'a'.repeat(64),locator:'M2-Ab12Cd34',revision:0,replayed:true};
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{values:unknown[]})=>{setupCalls++;assert.equal(q.values[2],null);return [{value:saved}];}})} as unknown as SuccessorTransactionBoundary;
 const repository=createHuroofSuccessorRepository(db);
 const service=createHuroofSuccessorService({identity:identity(false),repository,native,clock:()=>0});
 assert.deepEqual(await service.setup('token',setup),saved);assert.equal(nativeCalls,0);assert.equal(setupCalls,1);
 const missDb={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async()=>[{value:null}]})} as unknown as SuccessorTransactionBoundary;const miss=createHuroofSuccessorRepository(missDb);
 await assert.rejects(createHuroofSuccessorService({identity:identity(false),repository:miss,native,clock:()=>0}).setup('token',setup),/VERIFIED_ACCOUNT_REQUIRED/);assert.equal(nativeCalls,0);
});
test('setup probe binds SQL NULL and accepts a null result',async()=>{
 let stateArg:unknown='unset';const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{values:unknown[]})=>{stateArg=q.values[2];return [{value:null}];}})} as unknown as SuccessorTransactionBoundary;
 const c={identityId:'identity',principal:{projectId:'project',uid:'uid',anonymous:false,verifiedAccount:false},policy:{namespace:'ns',revision:'1',hash:'b'.repeat(64),projectId:'project',issuer:'issuer',audience:'project',clientProjectId:'project'}} as AuthenticatedContext;
 assert.equal(await createHuroofSuccessorRepository(db).setup(c,parseSuccessorSetup(setup),null),null);assert.equal(stateArg,null);
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
test('PG setup SQL source separates null probe from locked fresh creation; not SQL execution',()=>{
 const sql=readFileSync(resolve('services/enta/server/prisma/migrations/20261027230000_eng03_06_successor_composition/migration.sql'),'utf8');
 const start=sql.indexOf('CREATE FUNCTION public.eng03_06_successor_setup('),body=sql.slice(start);
 assert.ok(start>=0);assert.match(body,/IF saved IS NOT NULL OR state IS NULL THEN/);assert.match(body,/IF state='null'::JSONB THEN/);
 const room=body.indexOf('PERFORM public.eng03_06_lock_parent'),members=body.indexOf('PERFORM public.eng03_06_lock_room_dependents'),policy=body.indexOf('PERFORM public.eng03_03_assert_current',members),parent=body.indexOf('parent:=public.eng03_06_assert_parent',policy),create=body.indexOf('created:=public.eng03_03_setup_create',parent);
 assert.ok(room>=0&&room<members&&members<policy&&policy<parent&&parent<create);
 assert.match(sql,/ENG03_06_IMPLEMENTATION_INCOMPLETE/);
});
test('PG setup miss and creation use two distinct adapter transactions, DB I/O inert',async()=>{
 const seen: Array<{tx:number;args:unknown[]}> = [];let counter=0;
 const roomId='l_'+'d'.repeat(64),locator='M2-Ab12Cd34', ident=identity(true), policy=await ident.readActivePolicy('ns');
 const context={namespace:'ns',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:policy!.hash};
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const tx=++counter;return fn({$queryRaw:async(q:{strings:readonly string[];values:unknown[]})=>{const sql=q.strings.join(' ');if(sql.includes('read_context'))return [{value:context}];if(sql.includes('eng03_03_create_identity'))return [{value:{roomId,code:'Ab12Cd34'}}];if(sql.includes('eng03_06_successor_setup')){seen.push({tx,args:q.values});return [{value:q.values[2]===null?null:{roomId,locator,revision:0,replayed:false}}];}throw Error('unexpected fixed query');}});}} as unknown as SuccessorTransactionBoundary;
 const admission={id:'admission',fence:1n} as import('../src/history-rematch/capacity-contract').Admission;
 const adapters=createHuroofSuccessorPrivateAdapters(createHuroofPrivateQueryEffect(db),admission);
 const service=createHuroofSuccessorService({identity:ident,repository:adapters.repository,native:adapters.native,capacity:adapters.boundary,clock:()=>0});
 const outcome=await service.setup('token',setup);assert.equal(outcome.roomId,roomId);assert.equal(seen.length,2);assert.notEqual(seen[0].tx,seen[1].tx);assert.equal(seen[0].args[2],null);assert.equal(typeof seen[1].args[2],'string');assert.equal(seen[0].args[0],seen[1].args[0]);assert.equal(seen[0].args[1],seen[1].args[1]);
});
import { createHuroofSuccessorAdapters } from '../src/huroof-pg/successor-postgres';
import type { PrismaClient } from '@prisma/client';
test('paired PG preparation waits for outer transaction completion and exposes no mutation API',async()=>{
 let release!:()=>void, callbackFinished=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 const prisma={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const result=await fn({$queryRaw:async()=>[{value:{roomId:'l_'+'d'.repeat(64),code:'Ab12Cd34'}}]});callbackFinished=true;await gate;return result;}} as unknown as PrismaClient;
 const adapters=createHuroofSuccessorAdapters(prisma),c={identityId:'identity',principal:{projectId:'project',uid:'uid',anonymous:false,verifiedAccount:true},policy:{namespace:'ns',revision:'1',hash:'b'.repeat(64),projectId:'project',issuer:'issuer',audience:'project',clientProjectId:'project'}} as AuthenticatedContext;
 let finished=false;const pending=adapters.native.deriveCreateIdentity(c,'setupkey').then(value=>{finished=true;return value;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(callbackFinished,true);assert.equal(finished,false);assert.equal('startPaid' in adapters.native,false);assert.equal('createLobby' in adapters.native,false);
 release();assert.equal((await pending).code,'Ab12Cd34');assert.equal(finished,true);
});
test('PG source preserves existing same-room guard and seals before link without parsing SQL',()=>{
 const sql=readFileSync(resolve('services/enta/server/prisma/migrations/20261027230000_eng03_06_successor_composition/migration.sql'),'utf8');const old=readFileSync(resolve('services/enta/server/prisma/migrations/20261026100000_eng03_02_huroof_owned_history/migration.sql'),'utf8');
 const start=old.indexOf(' IF NOT EXISTS(SELECT 1 FROM public."HuroofMatch" child JOIN public."HuroofMatch" prior'),end=old.indexOf(' RETURN NEW;',start);assert.ok(start>0&&end>start);assert.ok(sql.includes(old.slice(start,end)));
 const paid=sql.slice(sql.indexOf('CREATE FUNCTION public.eng03_06_successor_start('));const stage=paid.indexOf('INSERT INTO public."HuroofSuccessorStartReservation"'),native=paid.indexOf('reply:=public.eng03_03_paid_start'),seal=paid.indexOf('INSERT INTO public."HuroofSuccessorSeal"'),link=paid.indexOf('INSERT INTO public."HuroofRematchLink"'),closure=paid.indexOf('PERFORM public.eng03_06_assert_closure');assert.ok(stage<native&&native<seal&&seal<link&&link<closure);assert.match(paid,/SUCCESSOR_CAPACITY_UNAVAILABLE/);
});
test('paired preparation transaction failure aborts before setup creation',async()=>{
 const calls:string[]=[],ident=identity(true),policy=await ident.readActivePolicy('ns');
 const context={namespace:'ns',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:policy!.hash};
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{let statement='';const value=await fn({$queryRaw:async(q:{strings:readonly string[];values:unknown[]})=>{statement=q.strings.join(' ');calls.push(statement);if(statement.includes('read_context'))return [{value:context}];if(statement.includes('eng03_06_successor_setup'))return [{value:null}];if(statement.includes('eng03_03_create_identity'))return [{value:{roomId:'l_'+'d'.repeat(64),code:'Ab12Cd34'}}];throw Error('unexpected fixed query');}});if(statement.includes('eng03_03_create_identity'))throw Error('PREPARATION_COMMIT_FAILED raw detail');return value;}} as unknown as SuccessorTransactionBoundary;
 const admission={id:'admission',fence:1n} as import('../src/history-rematch/capacity-contract').Admission;
 const adapters=createHuroofSuccessorPrivateAdapters(createHuroofPrivateQueryEffect(db),admission),service=createHuroofSuccessorService({identity:ident,repository:adapters.repository,native:adapters.native,capacity:adapters.boundary,clock:()=>0});
 await assert.rejects(service.setup('token',setup),error=>error instanceof Error&&error.message==='CAPACITY_UNAVAILABLE');assert.equal(calls.filter(x=>x.includes('eng03_06_successor_setup')).length,1);assert.equal(calls.filter(x=>x.includes('eng03_03_create_identity')).length,1);
});
test('paired preparation never shares a transaction across concurrent calls',async()=>{
 let calls=0;const seen:number[]=[];const prisma={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{const n=++calls;return fn({$queryRaw:async()=>{seen.push(n);await new Promise(resolve=>setImmediate(resolve));return [{value:{roomId:'l_'+'d'.repeat(64),code:'Ab12Cd34'}}];}});}} as unknown as PrismaClient;
 const native=createHuroofSuccessorAdapters(prisma).native,c={identityId:'identity',principal:{projectId:'project',uid:'uid',anonymous:false,verifiedAccount:true},policy:{namespace:'ns',revision:'1',hash:'b'.repeat(64),projectId:'project',issuer:'issuer',audience:'project',clientProjectId:'project'}} as AuthenticatedContext;
 await Promise.all([native.deriveCreateIdentity(c,'key1'),native.deriveCreateIdentity(c,'key2')]);assert.deepEqual(seen.sort(),[1,2]);
});
test('setup probe rejects malformed outcomes and full create rejects null',async()=>{
 const c={identityId:'identity',principal:{projectId:'project',uid:'uid',anonymous:false,verifiedAccount:true},policy:{namespace:'ns',revision:'1',hash:'b'.repeat(64),projectId:'project',issuer:'issuer',audience:'project',clientProjectId:'project'}} as AuthenticatedContext;
 for(const rows of [[],[{},{}],[{value:{roomId:'bad',locator:'bad',revision:0,replayed:true}}]]) {
  const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async()=>rows})} as unknown as SuccessorTransactionBoundary;
  await assert.rejects(createHuroofSuccessorRepository(db).setup(c,parseSuccessorSetup(setup),null),/DATABASE_RESPONSE_INVALID/);
 }
 const miss={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async()=>[{value:null}]})} as unknown as SuccessorTransactionBoundary;
 await assert.rejects(createHuroofSuccessorRepository(miss).setup(c,parseSuccessorSetup(setup),{} as LobbyState),/DATABASE_RESPONSE_INVALID/);
});
test('PG sealed retry source does not require mutable active or parent eligibility',()=>{
 const sql=readFileSync(resolve('services/enta/server/prisma/migrations/20261027230000_eng03_06_successor_composition/migration.sql'),'utf8');const start=sql.indexOf('CREATE FUNCTION public.eng03_06_successor_retry('),end=sql.indexOf('CREATE FUNCTION public.eng03_06_native_material(',start);assert.ok(start>=0&&end>start);const retry=sql.slice(start,end);assert.doesNotMatch(retry,/assert_parent|native_material|m\."state"/);assert.match(retry,/SUCCESSOR_SEALED_RETRY_INVALID/);assert.match(retry,/jsonb_build_object\('replayed',true\)/);
});
test('PG ACL source grants only three backend entries and six link columns',()=>{
 const role=readFileSync(resolve('services/enta/server/prisma/roles/eng03_06_successor_roles.sql'),'utf8');
 const runtime=role.split(/\r?\n/).filter(line=>line.startsWith('GRANT EXECUTE ON FUNCTION')&&line.endsWith('TO huroof_pg_runtime;'));assert.equal(runtime.length,3);for(const name of ['eng03_06_successor_setup','eng03_06_successor_retry','eng03_06_successor_start'])assert.equal(runtime.filter(line=>line.includes(name)).length,1);
 assert.match(role,/ENG03_06_ROLE_IMPLEMENTATION_INCOMPLETE/);assert.match(role,/pg_has_role\('huroof_pg_runtime','huroof_pg_owner','MEMBER'\)/);assert.doesNotMatch(role,/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*TO huroof_pg_runtime/i);
 const link=role.split(/\r?\n/).find(line=>line.startsWith('GRANT INSERT (')&&line.includes('HuroofRematchLink'));assert.ok(link);assert.doesNotMatch(link,/createdAt|UPDATE|DELETE|TRUNCATE|GRANT OPTION/);
});
test('paid sealed retry returns before fresh hosting, lobby, or catalog checks',async()=>{
 let prepares=0;const native={deriveCreateIdentity:async()=>{prepares++;throw Error('unexpected preparation');}} as unknown as LobbyRepository & PaidRepository;
 const outcome={admissionId:'ha_'+'a'.repeat(64),matchId:'hm_'+'b'.repeat(64),roomId:'l_'+'c'.repeat(64),status:'STARTED' as const,state:'COMMITTED' as const,revision:1,sequence:1,replayed:true};
 const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async()=>[{value:outcome}]})} as unknown as SuccessorTransactionBoundary;const repository=createHuroofSuccessorRepository(db);
 const service=createHuroofSuccessorService({identity:identity(false),repository,native,clock:()=>0});assert.deepEqual(await service.start('token',start),outcome);assert.equal(prepares,0);
});

test('PG fresh setup rejects an injected boundary before preparation',async()=>{
 let nativeCalls=0,boundaryCalls=0;
 const repository={setup:async()=>null} as unknown as HuroofSuccessorRepository;
 const native={deriveCreateIdentity:async()=>{nativeCalls++;throw Error('unexpected');}} as unknown as LobbyRepository & PaidRepository;
 const fake={assertCurrent:async()=>{boundaryCalls++;}};
 const service=createHuroofSuccessorService({identity:identity(true),repository,native,capacity:fake,clock:()=>0});
 await assert.rejects(()=>service.setup('token',setup),/SUCCESSOR_CAPACITY_UNAVAILABLE/);
 assert.equal(nativeCalls,0);assert.equal(boundaryCalls,0);
});
test('PG private boundary rejects protected-context mismatch before preparation',async()=>{
 const calls:string[]=[], db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{strings:readonly string[]})=>{const sql=q.strings.join(' ');calls.push(sql);if(sql.includes('eng03_06_successor_setup'))return [{value:null}];if(sql.includes('read_context'))return [{value:{namespace:'other',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:'b'.repeat(64)}}];throw Error('unexpected preparation');}})} as unknown as SuccessorTransactionBoundary;
 const admission={id:'admission',fence:1n} as import('../src/history-rematch/capacity-contract').Admission;
 const adapters=createHuroofSuccessorPrivateAdapters(createHuroofPrivateQueryEffect(db),admission),service=createHuroofSuccessorService({identity:identity(true),repository:adapters.repository,native:adapters.native,capacity:adapters.boundary,clock:()=>0});
 await assert.rejects(()=>service.setup('token',setup),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,2);assert.ok(calls.every(x=>!x.includes('eng03_03_create_identity')));
});

test('legacy PG repository cannot prepare a fresh setup after a retry miss',async()=>{
 let prepares=0,calls=0;const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async()=>{calls++;return [{value:null}];}})} as unknown as SuccessorTransactionBoundary;
 const native={deriveCreateIdentity:async()=>{prepares++;throw Error('unexpected preparation');}} as unknown as LobbyRepository & PaidRepository;
 const service=createHuroofSuccessorService({identity:identity(true),repository:createHuroofSuccessorRepository(db),native,clock:()=>0});
 await assert.rejects(()=>service.setup('token',setup),/SUCCESSOR_CAPACITY_UNAVAILABLE/);assert.equal(calls,1);assert.equal(prepares,0);
});

test('PG capsule checks admitted context and protected spool before exact setup replay, once',async()=>{
 const {HuroofSuccessorCapsule}=await import('../src/huroof-pg/successor');
 const ident=identity(true),policy=(await ident.readActivePolicy('ns'))!,context={namespace:'ns',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:policy.hash};
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'identity',route:'route',operation:'PG_SETUP' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const calls:string[]=[],saved={roomId:'l_'+'a'.repeat(64),locator:'M2-Ab12Cd34',revision:0,replayed:true};
 const effect={query:async(sql:string)=>{calls.push(sql);if(sql.includes('capacity_begin'))return [{value:null}];if(sql.includes('read_context'))return [{value:context}];if(sql.includes('policy_read')||sql.includes('pro262_capacity_pg_policy'))return [{value:{...policy,rawBase64:Buffer.from(policy.raw).toString('base64')}}];if(sql.includes('identity_find'))return [{value:'identity'}];if(sql.includes('read_spool'))return [{value:Buffer.from(JSON.stringify(setup))}];if(sql.includes('assert_spool_request'))return [{value:null}];if(sql.includes('eng03_06_successor_setup'))return [{value:saved}];throw Error('unexpected query');}};
 const capsule=new HuroofSuccessorCapsule(effect,ident.verifyToken,'token',()=>0),spool={id:'spool',digest:'d'.repeat(64),envelope:'parent'};
 assert.deepEqual(await capsule.executeOne(admission,spool),saved);assert.ok(calls.findIndex(x=>x.includes('read_context'))<calls.findIndex(x=>x.includes('read_spool')));assert.ok(calls.findIndex(x=>x.includes('assert_spool_request'))<calls.findIndex(x=>x.includes('eng03_06_successor_setup')));
 const count=calls.length;await assert.rejects(()=>capsule.executeOne(admission,spool),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,count);
});

test('PG capsule denies the wrong admitted subject before reading the spool',async()=>{
 const {HuroofSuccessorCapsule}=await import('../src/huroof-pg/successor');const ident=identity(true),calls:string[]=[];
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'identity',route:'route',operation:'PG_SETUP' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const effect={query:async(sql:string)=>{calls.push(sql);if(sql.includes('capacity_begin'))return [{value:null}];return [{value:{namespace:'other',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:'a'.repeat(64)}}];}};
 await assert.rejects(()=>new HuroofSuccessorCapsule(effect,ident.verifyToken,'token',()=>0).executeOne(admission,{id:'spool',digest:'d'.repeat(64),envelope:'parent'}),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,2);assert.match(calls[0],/capacity_begin/);assert.match(calls[1],/read_context/);
});

test('PG private adapter stops before spool or native preparation when the owning policy fence denies rotation',async()=>{
 const {HuroofSuccessorCapsule}=await import('../src/huroof-pg/successor');const ident=identity(true),policy=(await ident.readActivePolicy('ns'))!,calls:string[]=[];
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'identity',route:'route',operation:'PG_SETUP' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const effect={query:async(sql:string)=>{calls.push(sql);if(sql.includes('capacity_begin'))return [{value:null}];if(sql.includes('read_context'))return [{value:{namespace:'ns',projectId:'project',uid:'uid',identityId:'identity',policyRevision:'1',policyHash:policy.hash}}];if(sql.includes('pro262_capacity_pg_policy'))throw Error('policy rotated');throw Error('unexpected downstream effect');}};
 await assert.rejects(()=>new HuroofSuccessorCapsule(effect,ident.verifyToken,'token',()=>0).executeOne(admission,{id:'spool',digest:'d'.repeat(64),envelope:'parent'}),/CAPACITY_UNAVAILABLE/);assert.ok(calls.some(sql=>sql.includes('pro262_capacity_pg_policy')));assert.ok(calls.every(sql=>!sql.includes('read_spool')&&!sql.includes('eng03_06_successor_setup')));
});
