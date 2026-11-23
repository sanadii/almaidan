import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { runSuccessor } from '../src/history-rematch/capacity-ingress';
import { OperationLifetime, ObservationSource, SqlCleanupBoundary } from '../src/history-rematch/capacity-supervisor';
import { createCapacityRoleEffect, type PrivateQueryEffect } from '../src/history-rematch/capacity-producer';
import type { EntaSuccessorDatabase } from '../src/history-rematch/successor-postgres';
function role(effect:PrivateQueryEffect):PrivateQueryEffect {return createCapacityRoleEffect({$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{text:string;values:unknown[]})=>effect.query(q.text,q.values)})} as unknown as EntaSuccessorDatabase);}
let slotSequence=0;function capture(row:unknown){return {reservationId:'slot-'+(++slotSequence),source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify(row));}}))};}
function observerAllocator(){return role({query:async()=>[{value:{status:'CREATED',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}]});}
function fakeInstall(controlKey:string,kind:'REPLAY'|'PRODUCER'){
 const publisher=role({query:async(sql)=>[{value:sql.includes('read_observer_input_limit')?'65536':'observation'}]});
 const fields=['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'];
 const source=new ObservationSource(lease=>({async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({observationVersion:'1',observationId:'observation',trustId:'trust',trustGeneration:'1',controlKey,kind,credentialEpoch:'credential',launchEpoch:'launch',principalName:'login',principalOid:'100',pid:'42',backendStart:'2030-01-01T00:00:00Z',host:'host',boot:'boot',processTree:'tree',installationGeneration:'1',installationEvidenceHash:'a'.repeat(64),installation:Object.fromEntries(fields.map(k=>[k,k])),observedAt:'2030-01-01T00:00:00Z',validUntil:'2030-01-01T00:01:00Z',evidence:'YQ==',evidenceHash:'b'.repeat(64),inputClaimId:lease.inputClaimId}));}}));
 return {publisher,allocator:observerAllocator(),input:{reservationId:'install-'+(++slotSequence),source}};
}
import type { Admission, Incarnation, Subject } from '../src/history-rematch/capacity-contract';
const subject: Subject={namespace:'n',project:'p',owner:'o',route:'r',operation:'PG_SETUP',requestDigest:'a'.repeat(64)};
const request={namespace:'n',project:'p',owner:'o',route:'r',operation:'PG_SETUP' as const,requestIdentity:'request'};
const process: Incarnation={host:'h',boot:'b',processTree:'p',backendPrincipal:'q',backendPid:1,backendStart:'s'};
const admission: Admission={id:'i',fence:1n,subject,incarnation:process,qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE',domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED'};
test('missing injected authority denies before input',async()=>{
  await assert.rejects(()=>runSuccessor({request,now:()=>1}),/CAPACITY_UNAVAILABLE/);
});
test('lifetime is single use and missing cleanup cannot release',async()=>{
  let releases=0, quarantines=0;
  const port={current:async()=>admission,quarantine:async()=>{quarantines++;},readCleanup:async()=>null,release:async()=>{releases++;}};
  const lifetime=new OperationLifetime(port,admission,()=>1);
  await lifetime.begin(subject,process);
  await assert.rejects(()=>lifetime.begin(subject,process),/CAPACITY_UNAVAILABLE/);
  await lifetime.finish(); await assert.rejects(()=>lifetime.release('receipt'),/CAPACITY_UNAVAILABLE/);
  assert.equal(quarantines,1);assert.equal(releases,0);
});
test('quarantine during pending admission prevents execution',async()=>{
  let resolveCurrent!: (v: Admission) => void;
  const current=new Promise<Admission>(resolve=>{resolveCurrent=resolve;});
  const port={current:async()=>current,quarantine:async()=>{},readCleanup:async()=>null,release:async()=>{}};
  const lifetime=new OperationLifetime(port,admission,()=>1);
  const pending=lifetime.begin(subject,process);
  await lifetime.finish();resolveCurrent(admission);
  await assert.rejects(()=>pending,/CAPACITY_UNAVAILABLE/);
});

test('unprotected injected ingress cannot execute or reserve operation',async()=>{
  const events:string[]=[];
  const ingress={
    reserveControl:async()=>({id:'control',envelope:'parent'}),
    reserveReplay:async()=>({id:'replay',control:'control',envelope:'replay-envelope'}),
    pullOnce:async()=>({id:'spool',digest:'d'.repeat(64),envelope:'parent'}),
    executeReplay:async()=>({kind:'MISS' as const,receiptId:'forged'}),
    readProtectedMiss:async()=>null,
    reserveOperation:async()=>{events.push('operation');return admission;},
    quarantineControl:async()=>{events.push('quarantine');},
  };
  const supervisor={current:async()=>admission,quarantine:async()=>{},readCleanup:async()=>null,release:async()=>{}};
  await assert.rejects(()=>runSuccessor({ingress:ingress as never,supervisor,request,now:()=>1}),/CAPACITY_UNAVAILABLE/);
  assert.deepEqual(events,[]);
});

test('fixed query effect denies unknown call and sanitizes driver detail',async()=>{
  const { privateFixedCall } = await import('../src/history-rematch/capacity-producer');
  let calls=0;
  const effect={query:async()=>{calls++;throw new Error('secret raw driver detail');}};
  await assert.rejects(()=>privateFixedCall(effect,'pgRetry',[{},{}]),e=>e instanceof Error && e.message==='CAPACITY_UNAVAILABLE');
  await assert.rejects(()=>privateFixedCall(effect,'DROP TABLE' as never,[]),/CAPACITY_UNAVAILABLE/);
  assert.equal(calls,1);
});

test('protected replay adapter fixes SQL and rejects spoofed or malformed miss handles',async()=>{
  const { protectedReplayProbe }=await import('../src/history-rematch/capacity-producer');
  const seen: string[]=[];
  const effect={query:async(statement:string)=>{seen.push(statement);return [{value:{kind:'MISS',receiptId:'other'}}];}};
  await assert.rejects(()=>protectedReplayProbe(effect,'replay','spool'),/CAPACITY_UNAVAILABLE/);
  assert.deepEqual(seen,['SELECT public.pro262_capacity_replay_probe($1,$2) AS value']);
  await assert.rejects(()=>protectedReplayProbe({query:async()=>[{value:{kind:'MISS',receiptId:'replay',extra:true}}]},'replay','spool'),/CAPACITY_UNAVAILABLE/);
});
test('spool adapter rejects malformed returned identity and copies original bytes',async()=>{
  const { protectedSpoolCommit }=await import('../src/history-rematch/capacity-producer');
  const bytes=new Uint8Array([1,2,3]);let captured: readonly unknown[]=[];
  const effect={query:async(_sql:string,parameters:readonly unknown[])=>{captured=parameters;return [{value:'bad'}];}};
  await assert.rejects(()=>protectedSpoolCommit(effect,'replay',bytes),/CAPACITY_UNAVAILABLE/);
  bytes[0]=9;assert.equal((captured[1] as Uint8Array)[0],1);
});

test('protected miss descriptor is exact, detached, and tied to the probed replay',async()=>{
  const { protectedReadMiss }=await import('../src/history-rematch/capacity-producer');
  const descriptor={id:'replay',replay:'replay',requestIdentity:'request',spool:{id:'spool',digest:'d'.repeat(64),envelope:'parent'},subject,incarnation:process};
  const read=await protectedReadMiss({query:async()=>[{value:descriptor}]},'replay');
  descriptor.spool.id='changed';assert.equal(read.spool.id,'spool');
  await assert.rejects(()=>protectedReadMiss({query:async()=>[{value:{...descriptor,id:'other'}}]},'replay'),/CAPACITY_UNAVAILABLE/);
});

test('private driver preserves only bounded connection state for reconciliation',async()=>{
 const {privateFixedCall}=await import('../src/history-rematch/capacity-producer');
 await assert.rejects(()=>privateFixedCall({query:async()=>{throw Object.assign(new Error('raw sensitive detail'),{code:'08006'});}},'pgRetry',[{},{}]),error=>error instanceof Error&&error.message==='COMMIT_UNKNOWN'&&(error as {code?:string}).code==='08006');
});

test('SQL supervisor decodes BIGINT exactly and rejects incomplete cleanup before release',async()=>{
 const {createSqlSupervisorAuthority}=await import('../src/history-rematch/capacity-supervisor');let releases=0;
 const raw={id:'i',fence:'9007199254740993',subject,incarnation:process,qualification:{id:'q',generation:'9007199254740994',evidenceHash:'b'.repeat(64),validUntil:'2030-01-01T00:00:00.000Z',reuse:'ONE_USE',domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:'2030-01-01T00:00:00.000Z',state:'RESERVED'};
 const supervisor=role({query:async(sql:string)=>sql.includes('read_admission')?[{value:raw}]:sql.includes('read_cleanup')?[{value:{admissionId:'i',fence:'9007199254740993',incarnation:process,outcome:'ROLLED_BACK',protocolDrained:true,ipcDrained:true,parentDrained:false,processTreeTerminated:true,backendAbsent:true,observerGeneration:'1'}}]:[{value:null}]});
 const release=role({query:async()=>{releases++;return [{value:null}];}}),authority=createSqlSupervisorAuthority(supervisor,release);
 const a=await authority.current('i',9007199254740993n);assert.equal(a!.fence,9007199254740993n);assert.equal(a!.qualification.generation,9007199254740994n);
 await assert.rejects(()=>authority.readCleanup('i',9007199254740993n,'receipt'),/CAPACITY_UNAVAILABLE/);assert.equal(releases,0);
});

test('actual SQL ingress reserves control and replay before pulling and enforces qualified max',async()=>{
 const {SqlProtectedIngress}=await import('../src/history-rematch/capacity-ingress');const calls:string[]=[];let pulls=0;
 const allocator=role({query:async(sql:string)=>{calls.push('allocator:'+sql);return [{value:null}];}});
 const supervisor=role({query:async(sql:string)=>{calls.push('supervisor:'+sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_replay_profile'))return [{value:{id:'replay-profile',proofHash:'a'.repeat(64),maxBodyBytes:'3',parentEnvelope:'parent'}}];throw Error('unexpected effect');}});
 const input={async *[Symbol.asyncIterator](){pulls++;yield new Uint8Array([1,2,3,4]);}};
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'uid',holderEnvelope:'holder',parentEnvelope:'parent',launchEnvelope:'launch',replayEnvelope:'replay-profile',storageProof:'proof',expiry:'2030-01-01T00:00:00Z',parentHost:'host',parentBoot:'boot',parentProcessTree:'parent-tree',expectedReplayPrincipal:'replay-login',expectedProducerPrincipal:'producer-login',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input,lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'replay-profile'},install:fakeInstall('control','REPLAY'),executor:role({query:async()=>{throw Error('unexpected');}})}),operation:async()=>{throw Error('unexpected');},capsule:async()=>{throw Error('unexpected');},quarantineUncertain:async()=>{}}});
 const control=await ingress.reserveControl(request);assert.equal(pulls,0);const replay=await ingress.reserveReplay(control,request);assert.equal(pulls,0);
 await assert.rejects(()=>ingress.pullOnce(replay),/CAPACITY_UNAVAILABLE/);assert.equal(pulls,1);assert.ok(calls.some(x=>x.includes('read_replay_profile')));assert.ok(calls.every(x=>!x.includes('spool_commit')));
 await assert.rejects(()=>ingress.pullOnce(replay),/CAPACITY_UNAVAILABLE/);assert.equal(pulls,1);
});

test('actual SQL ingress returns bounded exact replay and quarantines control without producer launch',async()=>{
 const {SqlProtectedIngress,runSuccessor}=await import('../src/history-rematch/capacity-ingress');const {createSqlSupervisorAuthority}=await import('../src/history-rematch/capacity-supervisor');
 const calls:string[]=[];let launched=0;
 const allocator=role({query:async(sql:string)=>{calls.push(sql);return [{value:null}];}});
 const supervisor=role({query:async(sql:string)=>{calls.push(sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_replay_profile'))return [{value:{id:'replay-profile',proofHash:'a'.repeat(64),maxBodyBytes:'16',parentEnvelope:'parent'}}];if(sql.includes('spool_commit'))return [{value:'d'.repeat(64)}];if(sql.includes('quarantine_control'))return [{value:null}];throw Error('unexpected');}});
 const saved={roomId:'l_'+'a'.repeat(64),locator:'M2-Ab12Cd34',revision:0,replayed:true};
 const replayExecutor=role({query:async(sql:string)=>{calls.push(sql);return [{value:{kind:'OUTCOME',outcome:saved}}];}});
 const input={async *[Symbol.asyncIterator](){yield Buffer.from('{}');}};
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'uid',holderEnvelope:'holder',parentEnvelope:'parent',launchEnvelope:'launch',replayEnvelope:'replay-profile',storageProof:'proof',expiry:'2030-01-01T00:00:00Z',parentHost:'host',parentBoot:'boot',parentProcessTree:'parent-tree',expectedReplayPrincipal:'replay-login',expectedProducerPrincipal:'producer-login',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input,lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'replay-profile'},install:fakeInstall('control','REPLAY'),executor:replayExecutor}),operation:async()=>{launched++;throw Error('unexpected');},capsule:async()=>{launched++;throw Error('unexpected');},quarantineUncertain:async()=>{}}});
 const result=await runSuccessor({ingress,supervisor:createSqlSupervisorAuthority(supervisor,allocator),request,now:()=>1});assert.deepEqual(result,saved);assert.equal(launched,0);assert.ok(calls.findIndex(x=>x.includes('read_replay_profile'))<calls.findIndex(x=>x.includes('spool_commit')));assert.ok(calls.at(-1)!.includes('quarantine_control'));
});

test('uncertain control registration quarantines without reading input',async()=>{
 const {SqlProtectedIngress}=await import('../src/history-rematch/capacity-ingress');let pulls=0;const events:string[]=[];
 const allocator=role({query:async()=>[{value:null}]}),supervisor=role({query:async(sql:string)=>{if(sql.includes('register_control'))throw Object.assign(new Error('raw detail'),{code:'08007'});if(sql.includes('quarantine_control')){events.push('sql-quarantine');return [{value:null}];}throw Error('unexpected');}});
 const input={async *[Symbol.asyncIterator](){pulls++;yield new Uint8Array([1]);}};
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'uid',holderEnvelope:'holder',parentEnvelope:'parent',launchEnvelope:'launch',replayEnvelope:'replay-profile',storageProof:'proof',expiry:'2030-01-01T00:00:00Z',parentHost:'host',parentBoot:'boot',parentProcessTree:'parent-tree',expectedReplayPrincipal:'replay-login',expectedProducerPrincipal:'producer-login',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input,lifecycle:{replay:async()=>{throw Error('unexpected');},operation:async()=>{throw Error('unexpected');},capsule:async()=>{throw Error('unexpected');},quarantineUncertain:async(stage,id)=>{events.push(stage+':'+id);}}});
 await assert.rejects(()=>ingress.reserveControl(request),/CAPACITY_UNAVAILABLE/);assert.equal(pulls,0);assert.deepEqual(events,['sql-quarantine','CONTROL:control']);
});

test('pre-parser HTTP ingress authenticates then reserves before reading body, using fixed SQL effects',async()=>{
 const {createCapacityHttpIngress}=await import('../src/history-rematch/capacity-ingress');let pulls=0,status=0;let response:unknown;const calls:string[]=[];
 const allocator=role({query:async(sql)=>{calls.push(sql);return [{value:null}];}}),supervisor=role({query:async(sql)=>{calls.push(sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_replay_profile'))return [{value:{id:'replay-profile',proofHash:'a'.repeat(64),maxBodyBytes:'16',parentEnvelope:'parent'}}];if(sql.includes('spool_commit'))return [{value:'d'.repeat(64)}];if(sql.includes('quarantine_control'))return [{value:null}];throw Error('unexpected');}}),replayExecutor=role({query:async(sql)=>{calls.push(sql);return [{value:{kind:'OUTCOME',outcome:{roomId:'l_'+'a'.repeat(64),locator:'M2-Ab12Cd34',revision:0,replayed:true}}}];}}),issuer=role({query:async()=>{throw Error('unexpected');}}),releaseAuthority=role({query:async()=>{throw Error('unexpected');}});
 const handler=createCapacityHttpIngress({namespace:'ns',project:'project',route:'/successor',operation:'PG_SETUP',now:()=>1,verifyToken:async()=>({aud:'project',iss:'https://securetoken.google.com/project',sub:'uid',currentUser:{disabled:false,emailVerified:true,email:'a@example.test'},firebase:{sign_in_provider:'password'}}),supervisor:{prepare:async(principal,_token,metadata)=>({request:{namespace:'ns',project:'project',owner:'owner',route:metadata.route,operation:metadata.operation,requestIdentity:metadata.requestIdentity},releaseAuthority,config:{controlKey:'control',uid:principal.uid,holderEnvelope:'holder',parentEnvelope:'parent',launchEnvelope:'launch',replayEnvelope:'replay-profile',storageProof:'proof',expiry:'2030-01-01T00:00:00Z',parentHost:'host',parentBoot:'boot',parentProcessTree:'parent',expectedReplayPrincipal:'replay-login',expectedProducerPrincipal:'producer-login',allocator,supervisor,issuer,lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'replay-profile'},install:fakeInstall('control','REPLAY'),executor:replayExecutor}),operation:async()=>{throw Error('unexpected');},capsule:async()=>{throw Error('unexpected');},quarantineUncertain:async()=>{}}}})}});
 const req={method:'POST',path:'/successor',get:()=> 'Bearer test-token',async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('{}');}},res={status(n:number){status=n;return this;},json(v:unknown){response=v;return this;}};
 await handler(req as never,res as never,(()=>{throw Error('unexpected next');}) as never);assert.equal(status,200);assert.equal((response as {replayed:boolean}).replayed,true);assert.equal(pulls,1);assert.ok(calls.findIndex(x=>x.includes('register_replay'))<calls.findIndex(x=>x.includes('read_replay_profile')));assert.ok(calls.at(-1)!.includes('quarantine_control'));
});

test('pre-parser HTTP ingress preserves authentication failure before unavailable supervisor',async()=>{
 const {createCapacityHttpIngress}=await import('../src/history-rematch/capacity-ingress');let pulls=0,status=0;let response:unknown;
 const handler=createCapacityHttpIngress({namespace:'ns',project:'project',route:'/successor',operation:'PG_SETUP',now:()=>1,verifyToken:async()=>{throw Error('raw authentication detail');}});
 const req={method:'POST',path:'/successor',get:()=> 'Bearer invalid',async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('{}');}},res={status(n:number){status=n;return this;},json(v:unknown){response=v;return this;}};
 await handler(req as never,res as never,(()=>{}) as never);assert.equal(status,401);assert.deepEqual(response,{error:'INVALID_ID_TOKEN'});assert.equal(pulls,0);
});

test('cleanup boundary rejects incomplete observation before fixed SQL effects',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');let calls=0;
 const publisher=role({query:async()=>{calls++;return [{value:'receipt'}];}}),releaser=role({query:async()=>{calls++;return [{value:null}];}}),cleanup=new SqlCleanupBoundary(publisher,releaser,observerAllocator());
 const observation={host:'host',boot:'boot',parentProcessTree:'tree',parentEnvelope:'parent',ipcDrained:true,parentDrained:false,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'observer'};
 await assert.rejects(()=>cleanup.publishControl('control','receipt',observation),/CAPACITY_UNAVAILABLE/);assert.equal(calls,0);
});

test('pre-parser HTTP ingress with no configured supervisor denies before body pull',async()=>{
 const {createCapacityHttpIngress}=await import('../src/history-rematch/capacity-ingress');let pulls=0,status=0;
 const handler=createCapacityHttpIngress({namespace:'ns',project:'project',route:'/successor',operation:'PG_SETUP',now:()=>1,verifyToken:async()=>({aud:'project',iss:'https://securetoken.google.com/project',sub:'uid',currentUser:{disabled:false,emailVerified:true,email:'a@example.test'},firebase:{sign_in_provider:'password'}})});
 const req={method:'POST',path:'/successor',get:()=> 'Bearer token',async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('{}');}},res={status(n:number){status=n;return this;},json(){return this;}};
 await handler(req as never,res as never,(()=>{}) as never);assert.equal(status,503);assert.equal(pulls,0);
});

test('lost private connection intent or replay registration quarantines before input',async()=>{
 const {SqlProtectedIngress}=await import('../src/history-rematch/capacity-ingress');
 for(const fail of ['prepare_connection','reserve_launch','register_replay']) {
  const events:string[]=[];let launches=0,pulls=0;
  const allocator=role({query:async()=>[{value:null}]});
  const supervisor=role({query:async(sql)=>{events.push(sql);if(sql.includes(fail))throw Error('lost response');if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];throw Error('unexpected');}});
  const ingress=new SqlProtectedIngress({controlKey:'control',uid:'u',holderEnvelope:'h',parentEnvelope:'p',launchEnvelope:'l',replayEnvelope:'rp',storageProof:'s',expiry:'2030-01-01T00:00:00Z',parentHost:'h',parentBoot:'b',parentProcessTree:'tree',expectedReplayPrincipal:'r',expectedProducerPrincipal:'p',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input:{async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('x');}},lifecycle:{replay:async()=>{launches++;return {replayId:'replay',record:{replayProofIdentity:'rp'},install:fakeInstall('control','REPLAY'),executor:role({query:async()=>{throw Error('unexpected');}})};},operation:async()=>{throw Error('unexpected');},capsule:async()=>{throw Error('unexpected');},quarantineUncertain:async(stage,id)=>{events.push(stage+':'+id);}}});
  const control=await ingress.reserveControl(request);await assert.rejects(()=>ingress.reserveReplay(control,request),/CAPACITY_UNAVAILABLE/);
  assert.equal(launches,fail==='register_replay'?1:0);assert.equal(pulls,0);assert.ok(events.includes('REPLAY:'+(launches?'replay':'control')));
 }
});

test('protected observer adapter accepts explicit never-opened observation and rejects malformed evidence',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');const calls:{sql:string,values:readonly unknown[]}[]=[];
 const publisher=role({query:async(sql,values)=>{calls.push({sql,values});return [{value:sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit')?'4096':null}];}}),releaser=role({query:async()=>{throw Error('unexpected');}});
 const boundary=new SqlCleanupBoundary(publisher,releaser,observerAllocator());
 const observation={controlKey:'c',kind:'REPLAY',outcome:'NEVER_OPENED',expectedPrincipal:'r',host:'h',boot:'b',processTree:'tree',pid:null,backendStart:null,observerGeneration:'1',trustId:'observer',traceId:'trace',evidence:Buffer.from('inert fixture').toString('base64')};
 await boundary.observeConnection('c','REPLAY',capture(observation));assert.equal(calls.length,5);assert.match(calls[4].sql,/pro262_capacity_observe_connection/);
 await assert.rejects(()=>boundary.observeConnection('c','REPLAY',capture({...observation,evidence:''})),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,7);assert.ok(calls.slice(5).every(call=>!call.sql.includes('observe_connection')));
});

test('lost producer registration quarantines the preregistered operation without launching capsule',async()=>{
 const {SqlProtectedIngress}=await import('../src/history-rematch/capacity-ingress');const events:string[]=[];let capsules=0;
 const digest='b'.repeat(64),spool={id:'d'.repeat(64),digest,envelope:'p'},miss={id:'replay',replay:'replay',requestIdentity:'request',spool,subject,incarnation:process};
 const allocator=role({query:async()=>[{value:null}]}),supervisor=role({query:async(sql)=>{events.push(sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_miss'))return [{value:miss}];if(sql.includes('register_issuance'))throw Error('lost registration response');throw Error('unexpected');}});
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'u',holderEnvelope:'h',parentEnvelope:'p',launchEnvelope:'l',replayEnvelope:'rp',storageProof:'s',expiry:'2030-01-01T00:00:00Z',parentHost:'h',parentBoot:'b',parentProcessTree:'tree',expectedReplayPrincipal:'r',expectedProducerPrincipal:'p',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input:{async *[Symbol.asyncIterator](){}},lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'rp'},install:fakeInstall('control','REPLAY'),executor:role({query:async()=>{throw Error('unexpected');}})}),operation:async()=>({issuanceKey:'issuance',record:{replayId:'replay',spoolDigest:digest,subject},install:fakeInstall('control','PRODUCER')}),capsule:async()=>{capsules++;throw Error('unexpected');},quarantineUncertain:async(stage,id)=>{events.push(stage+':'+id);}}});
 const control=await ingress.reserveControl(request);await ingress.reserveReplay(control,request);await assert.rejects(()=>ingress.reserveOperation(control,'replay',spool),/CAPACITY_UNAVAILABLE/);
 assert.equal(capsules,0);assert.ok(events.includes('OPERATION:issuance'));assert.ok(events.findIndex(x=>x.includes('prepare_connection') && events.indexOf(x)>events.findIndex(y=>y.includes('register_replay')))<events.findIndex(x=>x.includes('register_issuance')));
});

test('closed-scope publisher requires complete authenticated observation shape before fixed SQL',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');const calls:string[]=[];
 const boundary=new SqlCleanupBoundary(role({query:async(sql)=>{calls.push(sql);return [{value:sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit')?'4096':null}];}}),role({query:async()=>{throw Error('unexpected');}}),observerAllocator());
 const receipt={controlKey:'c',replayOid:'100',producerOid:'101',credentialEpoch:'credential-epoch',launchEpoch:'launch-epoch',sourceIdentity:'source',supervisorIdentity:'supervisor',host:'h',boot:'b',parentProcessTree:'tree',priorAttemptsQuiesced:true,credentialsClosed:true,socketsDrained:true,ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',trustId:'observer',evidence:Buffer.from('inert observer receipt').toString('base64')};
 for(const bad of [{...receipt,priorAttemptsQuiesced:false},{...receipt,credentialsClosed:false},{...receipt,socketsDrained:false},{...receipt,replayOid:'101'},{...receipt,launchEpoch:''}])await assert.rejects(()=>boundary.publishClosedScope('c',capture(bad)),/CAPACITY_UNAVAILABLE/);
 assert.equal(calls.length,10);await boundary.publishClosedScope('c',capture(receipt));assert.equal(calls.length,15);assert.match(calls[10],/pro262_capacity_read_observer_input_limit/);assert.match(calls[11],/pro262_capacity_read_cleanup_limit/);assert.match(calls[14],/pro262_capacity_accept_closed_scope/);
});

test('closed-scope publisher rejects oversize observation after reading the protected limit',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');const calls:string[]=[];
 const boundary=new SqlCleanupBoundary(role({query:async(sql)=>{calls.push(sql);return [{value:'8'}];}}),role({query:async()=>{throw Error('unexpected');}}),observerAllocator());
 const receipt={controlKey:'c',replayOid:'100',producerOid:'101',credentialEpoch:'epoch',launchEpoch:'launch',sourceIdentity:'source',supervisorIdentity:'supervisor',host:'h',boot:'b',parentProcessTree:'tree',priorAttemptsQuiesced:true,credentialsClosed:true,socketsDrained:true,ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',trustId:'observer',evidence:Buffer.from('inert').toString('base64')};
 await assert.rejects(()=>boundary.publishClosedScope('c',capture(receipt)),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,1);assert.match(calls[0],/read_observer_input_limit/);
});

test('producer prelaunch denial occurs before producer factory',async()=>{
 const {SqlProtectedIngress}=await import('../src/history-rematch/capacity-ingress');let factories=0;const events:string[]=[];const digest='b'.repeat(64),spool={id:'d'.repeat(64),digest,envelope:'p'},miss={id:'replay',replay:'replay',requestIdentity:'request',spool,subject,incarnation:process};
 const allocator=role({query:async()=>[{value:null}]}),supervisor=role({query:async(sql,values)=>{events.push(sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection'))return [{value:'CREATED'}];if(sql.includes('reserve_launch'))return [{value:values[1]==='PRODUCER'?null:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_miss'))return [{value:miss}];throw Error('unexpected');}});
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'u',holderEnvelope:'h',parentEnvelope:'p',launchEnvelope:'l',replayEnvelope:'rp',storageProof:'s',expiry:'2030-01-01T00:00:00Z',parentHost:'h',parentBoot:'b',parentProcessTree:'tree',expectedReplayPrincipal:'r',expectedProducerPrincipal:'p',allocator,supervisor,issuer:role({query:async()=>{throw Error('unexpected');}}),input:{async *[Symbol.asyncIterator](){}},lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'rp'},install:fakeInstall('control','REPLAY'),executor:role({query:async()=>{throw Error('unexpected');}})}),operation:async()=>{factories++;throw Error('unexpected');},capsule:async()=>{throw Error('unexpected');},quarantineUncertain:async(stage)=>{events.push(stage);}}});
 const control=await ingress.reserveControl(request);await ingress.reserveReplay(control,request);await assert.rejects(()=>ingress.reserveOperation(control,'replay',spool),/CAPACITY_UNAVAILABLE/);assert.equal(factories,0);assert.ok(events.includes('OPERATION'));
});

test('each cleanup kind denies over its authenticated input envelope before decoding or payload SQL',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');
 const base={host:'h',boot:'b',processTree:'tree',backendPrincipal:'p',backendPid:1,backendStart:'start',protocolDrain:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'};
 const rows={OPERATION:{...base,outcome:'ROLLED_BACK',IPCDrain:true,parentDrain:true,termination:true},REPLAY:{...base,ipcDrain:true,parentDrain:true,termination:true},CONTROL:{host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'},CONNECTION:{controlKey:'c',kind:'REPLAY',outcome:'NEVER_OPENED',expectedPrincipal:'p',host:'h',boot:'b',processTree:'tree',pid:null,backendStart:null,observerGeneration:'1',trustId:'t',traceId:'trace',evidence:'YQ=='}};
 for(const kind of Object.keys(rows) as Array<keyof typeof rows>){
  const calls:string[]=[];const publisher=role({query:async(sql)=>{calls.push(sql);return [{value:'1'}];}}),boundary=new SqlCleanupBoundary(publisher,role({query:async()=>{throw Error('unexpected');}}),observerAllocator());
  const prior=Buffer.from;let decoded=0;(Buffer as unknown as {from:typeof Buffer.from}).from=((...args:Parameters<typeof Buffer.from>)=>{decoded++;return prior(...args);}) as typeof Buffer.from;
  try {const invoke=kind==='OPERATION'?()=>boundary.publishOperation('a',1n,'r',capture(rows.OPERATION)):kind==='REPLAY'?()=>boundary.publishReplay('p','r',capture(rows.REPLAY)):kind==='CONTROL'?()=>boundary.publishControl('c','r',capture(rows.CONTROL)):()=>boundary.observeConnection('c','REPLAY',capture(rows.CONNECTION));await assert.rejects(invoke,/CAPACITY_UNAVAILABLE/);} finally {(Buffer as unknown as {from:typeof Buffer.from}).from=prior;}
  assert.equal(decoded,0);assert.equal(calls.length,1);assert.match(calls[0],/read_observer_input_limit/);
 }
});

test('cleanup qualified envelope accepts its conservative maximum and rejects maximum minus one for every kind',async()=>{
 const {SqlCleanupBoundary}=await import('../src/history-rematch/capacity-supervisor');const base={host:'h',boot:'b',processTree:'tree',backendPrincipal:'p',backendPid:1,backendStart:'start',protocolDrain:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'};
 const entries=[{kind:'OPERATION',key:'a',ids:['r'],fence:1n,row:{...base,outcome:'ROLLED_BACK',IPCDrain:true,parentDrain:true,termination:true}},{kind:'REPLAY',key:'p',ids:['r'],fence:null,row:{...base,ipcDrain:true,parentDrain:true,termination:true}},{kind:'CONTROL',key:'c',ids:['r'],fence:null,row:{host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'}},{kind:'CONNECTION',key:'c',ids:['REPLAY'],fence:null,row:{controlKey:'c',kind:'REPLAY',outcome:'NEVER_OPENED',expectedPrincipal:'p',host:'h',boot:'b',processTree:'tree',pid:null,backendStart:null,observerGeneration:'1',trustId:'t',traceId:'trace',evidence:'YQ=='}}] as const;
 for(const entry of entries){let need=2n;for(const id of [entry.kind,entry.key,...entry.ids])need+=BigInt(id.length)*6n+2n;if(entry.fence!==null)need+=BigInt(entry.fence.toString().length);for(const [key,v] of Object.entries(entry.row))need+=BigInt(key.length)*6n+4n+(typeof v==='string'?BigInt(v.length)*6n+2n:typeof v==='number'?24n:5n);
  for(const fit of [true,false]){const calls:string[]=[];const bound=(need-(fit?0n:1n)).toString();const p=role({query:async(sql)=>{calls.push(sql);return [{value:sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit')?bound:entry.kind==='CONNECTION'?null:'r'}];}}),boundary=new SqlCleanupBoundary(p,role({query:async()=>{throw Error('unexpected');}}),observerAllocator());
   const run=entry.kind==='OPERATION'?()=>boundary.publishOperation(entry.key,1n,'r',capture(entry.row)):entry.kind==='REPLAY'?()=>boundary.publishReplay(entry.key,'r',capture(entry.row)):entry.kind==='CONTROL'?()=>boundary.publishControl(entry.key,'r',capture(entry.row)):()=>boundary.observeConnection(entry.key,'REPLAY',capture(entry.row));
   if(fit){await run();assert.equal(calls.length,5);}else{await assert.rejects(run,/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,3);assert.ok(calls.every(sql=>!sql.includes('accept_')&&!sql.includes('observe_connection')));}
  }
 }
});

test('lifecycle retains quarantine when protected release denies another incarnation, then retries after closure',async()=>{
 const {createSqlSupervisorAuthority}=await import('../src/history-rematch/capacity-supervisor');let closed=false,releaseAttempts=0,quarantines=0;
 const observed={admissionId:'i',fence:'1',incarnation:process,outcome:'ROLLED_BACK',protocolDrained:true,ipcDrained:true,parentDrained:true,processTreeTerminated:true,backendAbsent:true,observerGeneration:'1'};
 const supervisor=role({query:async(sql)=>{if(sql.includes('quarantine')){quarantines++;return [{value:null}];}if(sql.includes('read_cleanup'))return [{value:observed}];throw Error('unexpected');}}),releaser=role({query:async(sql)=>{if(!sql.includes('capacity_release('))throw Error('unexpected');releaseAttempts++;if(!closed)throw Error('another incarnation still active');return [{value:null}];}});
 const lifetime=new OperationLifetime(createSqlSupervisorAuthority(supervisor,releaser),admission,()=>1);await lifetime.finish();await assert.rejects(()=>lifetime.release('receipt'),/CAPACITY_UNAVAILABLE/);assert.equal(quarantines,1);assert.equal(releaseAttempts,1);closed=true;await lifetime.release('receipt');assert.equal(releaseAttempts,2);assert.equal(quarantines,1);
});

test('whole delivery coalesces across boundaries, caches success, and rejects conflicting identities',async()=>{
 let pulls=0,claims=0,payloads=0,finish!:()=>void;const publisher=role({query:async(sql)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];if(sql.includes('accept_control_cleanup')){payloads++;await new Promise<void>(r=>{finish=r});return [{value:'receipt'}];}throw Error('unexpected');}}),allocator=role({query:async()=>{claims++;return [{value:{status:'CREATED',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}];}}),releaser=role({query:async()=>[{value:null}]});
 const row={host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'},source=new ObservationSource(()=>({async *[Symbol.asyncIterator](){pulls++;yield Buffer.from(JSON.stringify(row));}})),input={reservationId:'delivery-coalesce',source};
 const first=new SqlCleanupBoundary(publisher,releaser,allocator),second=new SqlCleanupBoundary(publisher,releaser,allocator),pending=first.publishControl('control','receipt',input);while(!finish)await new Promise(r=>setTimeout(r,0));
 const duplicates=Array.from({length:8},()=>second.publishControl('control','receipt',input));assert.ok(duplicates.every(p=>p===pending));await assert.rejects(()=>second.publishControl('control','other',input),/CAPACITY_UNAVAILABLE/);await assert.rejects(()=>second.observeConnection('control','REPLAY',input),/CAPACITY_UNAVAILABLE/);await assert.rejects(()=>new SqlCleanupBoundary(role({query:async()=>[{value:null}]}),releaser,allocator).publishControl('control','receipt',input),/CAPACITY_UNAVAILABLE/);await assert.rejects(()=>new SqlCleanupBoundary(publisher,releaser,observerAllocator()).publishControl('control','receipt',input),/CAPACITY_UNAVAILABLE/);assert.equal(claims,1);assert.equal(pulls,1);assert.equal(payloads,1);finish();await Promise.all([pending,...duplicates]);await first.publishControl('control','receipt',input);assert.equal(payloads,1);assert.equal(claims,1);assert.equal(pulls,1);
 await assert.rejects(()=>first.publishControl('control','receipt',{reservationId:'delivery-coalesce',source:new ObservationSource(()=>{throw Error('must not open');})}),/CAPACITY_UNAVAILABLE/);
});
test('rejected or uncertain delivery never reopens the source or issues another payload',async()=>{
 let pulls=0,claims=0,payloads=0;const publisher=role({query:async(sql)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];if(sql.includes('accept_control_cleanup')){payloads++;throw Object.assign(Error('raw'),{code:'08007'});}throw Error('unexpected');}}),allocator=role({query:async()=>{claims++;return [{value:{status:'CREATED',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}];}}),releaser=role({query:async()=>[{value:null}]});
 const row={host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'},input={reservationId:'delivery-unknown',source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){pulls++;yield Buffer.from(JSON.stringify(row));}}))},boundary=new SqlCleanupBoundary(publisher,releaser,allocator);
 await assert.rejects(()=>boundary.publishControl('c','r',input),/COMMIT_UNKNOWN/);await assert.rejects(()=>boundary.publishControl('c','r',input),/COMMIT_UNKNOWN/);assert.equal(pulls,1);assert.equal(claims,1);assert.equal(payloads,1);
});

test('installed observation uses an independent claimed source before the fixed publisher',async()=>{
 const {ObservationSource,publishInstallObservation}=await import('../src/history-rematch/capacity-supervisor');const calls:string[]=[];let pulls=0;const claim='a'.repeat(64);
 const publisher=role({query:async(sql)=>{calls.push(sql);return [{value:sql.includes('read_observer_input_limit')?'65536':'observation'}];}}),allocator=role({query:async(sql)=>{calls.push(sql);return [{value:{status:'CREATED',inputClaimId:claim,maxInputBytes:'65536'}}];}});
 const fields=['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'];
 const source=new ObservationSource(lease=>({async *[Symbol.asyncIterator](){pulls++;const row={observationVersion:'1',observationId:'observation',trustId:'trust',trustGeneration:'1',controlKey:'control',kind:'REPLAY',credentialEpoch:'credential',launchEpoch:'launch',principalName:'login',principalOid:'100',pid:'42',backendStart:'2030-01-01T00:00:00Z',host:'host',boot:'boot',processTree:'tree',installationGeneration:'1',installationEvidenceHash:'a'.repeat(64),installation:Object.fromEntries(fields.map(k=>[k,k])),observedAt:'2030-01-01T00:00:00Z',validUntil:'2030-01-01T00:01:00Z',evidence:Buffer.from('inert').toString('base64'),evidenceHash:'b'.repeat(64),inputClaimId:lease.inputClaimId};yield Buffer.from(JSON.stringify(row));}}));
 await publishInstallObservation({publisher,allocator,input:{reservationId:'install-observation-unique',source}},'control','REPLAY');assert.equal(pulls,1);assert.match(calls[0],/read_observer_input_limit/);assert.match(calls[1],/claim_observer_input/);assert.match(calls[2],/accept_install_observation/);
});

test('length-prefixed observer event identity distinguishes embedded separators',async()=>{
 const keys:string[]=[];const publisher=role({query:async(sql)=>[{value:sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit')?'65536':'r'}]}),allocator=role({query:async(_sql,values)=>{keys.push(String(values[1]));return [{value:{status:'CREATED',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}];}}),releaser=role({query:async()=>[{value:null}]}),boundary=new SqlCleanupBoundary(publisher,releaser,allocator);
 const row={host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'};
 await boundary.publishControl('a:b','c',capture(row)).catch(()=>{});await boundary.publishControl('a','b:c',capture(row)).catch(()=>{});assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);
});

test('caller cancellation while delivery is pending cannot reopen or start another payload',async()=>{
 let opens=0,calls=0,finish!:()=>void;const publisher=role({query:async(sql)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];calls++;await new Promise<void>(r=>{finish=r});return [{value:'r'}];}}),allocator=observerAllocator(),boundary=new SqlCleanupBoundary(publisher,role({query:async()=>[{value:null}]}),allocator),row={host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'},input={reservationId:'cancel-held',source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){opens++;yield Buffer.from(JSON.stringify(row));}}))};
 const pending=boundary.publishControl('c','r',input);while(!finish)await new Promise(r=>setTimeout(r,0));await Promise.race([pending,Promise.resolve('caller-cancelled')]);const other=boundary.publishControl('c','r',input);assert.equal(calls,1);assert.equal(opens,1);finish();await Promise.all([pending,other]);assert.equal(calls,1);
});

test('fenced publisher preserves valid wire fragments and rejects unbounded or ambiguous capture',async()=>{
 const row={host:'h',boot:'b',parentProcessTree:'tree',parentEnvelope:'env',ipcDrained:true,parentDrained:true,descendantsTerminated:true,observerGeneration:'1',evidence:'YQ==',trustId:'t'};
 const raw=Buffer.from(' '+JSON.stringify(row)+' ');
 const spoofedLength=Object.defineProperty(Buffer.alloc(65537,1),'byteLength',{value:1});
 const cases = {
  exact: [raw.subarray(0, 19), raw.subarray(19)],
  utf8: [Buffer.from([0xff])],
  oversize: [Buffer.alloc(65537, 1)],
  spoofedLength: [spoofedLength],
  sharedBacking: [Buffer.from(new SharedArrayBuffer(1))],
  duplicate: [Buffer.from(`{"\\u0068ost":"other",${JSON.stringify(row).slice(1)}`)],
  depth: [Buffer.from(`${'['.repeat(10)}0${']'.repeat(10)}`)],
  emptyChunk: [Buffer.alloc(0), raw],
 };
 for(const [scenario,chunks] of Object.entries(cases)){
  let payload=0,opens=0;
  const seen:unknown[][]=[];
  const publisher=role({query:async(sql,values)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];payload++;seen.push([...values]);return [{value:'r'}];}});
  const boundary=new SqlCleanupBoundary(publisher,role({query:async()=>[{value:null}]}),observerAllocator());
  const input={reservationId:'capture-'+scenario,source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){opens++;yield* chunks;}}))};
  if(scenario==='exact'){await boundary.publishControl('c','r',input);assert.equal(payload,1);assert.deepEqual(seen[0].at(-1),raw);}
  else{await assert.rejects(()=>boundary.publishControl('c','r',input),/CAPACITY_UNAVAILABLE/);assert.equal(payload,0);}
  assert.equal(opens,1);
 }
});

test('a previously claimed slot cannot recapture in a new source',async()=>{
 let pulls=0,payloads=0;const publisher=role({query:async(sql)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];payloads++;return [{value:null}];}}),allocator=role({query:async()=>[{value:{status:'EXISTING',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}]}),boundary=new SqlCleanupBoundary(publisher,role({query:async()=>[{value:null}]}),allocator),input={reservationId:'existing-not-recaptured',source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('{}');}}))};
 await assert.rejects(()=>boundary.publishControl('c','r',input),/CAPACITY_UNAVAILABLE/);assert.equal(pulls,0);assert.equal(payloads,0);
});

test('invalid operation fence is denied without coercion or any private effect',async()=>{
 let touched=0;const effect=role({query:async()=>{touched++;return [{value:null}];}}),boundary=new SqlCleanupBoundary(effect,role({query:async()=>[{value:null}]}),observerAllocator()),bad={toString(){touched++;return '1';}};await assert.rejects(()=>boundary.publishOperation('a',bad as unknown as bigint,'r',capture({})),/CAPACITY_UNAVAILABLE/);assert.equal(touched,0);
});

test('scope denial at protected claim leaves observation source unopened',async()=>{
 let pulls=0,payloads=0;const publisher=role({query:async(sql)=>{if(sql.includes('read_observer_input_limit')||sql.includes('read_cleanup_limit'))return [{value:'65536'}];payloads++;return [{value:null}];}}),allocator=role({query:async()=>{throw Error('unmatched observer group or bound');}}),boundary=new SqlCleanupBoundary(publisher,role({query:async()=>[{value:null}]}),allocator);const input={reservationId:'scope-denied',source:new ObservationSource(()=>({async *[Symbol.asyncIterator](){pulls++;yield Buffer.from('{}');}}))};
 await assert.rejects(()=>boundary.publishControl('c','r',input),/CAPACITY_UNAVAILABLE/);await assert.rejects(()=>boundary.publishControl('other','r',{reservationId:'other-unverified',source:new ObservationSource(()=>{throw Error('must not open');})}),/CAPACITY_UNAVAILABLE/);assert.equal(pulls,0);assert.equal(payloads,0);
});
