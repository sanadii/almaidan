import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntaSuccessorService } from '../src/history-rematch/successor';
import { createEntaSuccessorRepository, type EntaSuccessorDatabase } from '../src/history-rematch/successor-postgres';
const profiles = [
 [2,'TIER_BOARD','enta-classic-2','CLASSIC'],[3,'TIER_BOARD','enta-classic-3','CLASSIC'],[3,'TIER_BOARD','enta-kids-3','KIDS'],
 [4,'MIXED_BOARD','enta-format-1','CLASSIC'],[4,'STANDALONE_LIST','enta-format-1','LIST'],[4,'STANDALONE_ACTING','enta-format-1','ACTING'],
 [5,'TIER_BOARD','enta-competitive-1','CLASSIC'],[5,'MIXED_BOARD','enta-competitive-1','CLASSIC'],[5,'STANDALONE_LIST','enta-competitive-1','LIST'],[5,'STANDALONE_ACTING','enta-competitive-1','ACTING'],
] as const;
const principal={projectId:'project',uid:'owner',verifiedAccount:true,anonymous:false,email:'owner@example.test'};
function request(p:typeof profiles[number],recursive:boolean) {
 const [physicalProtocol,format,retainedRules,mode]=p,standalone=format.startsWith('STANDALONE'),count=mode==='KIDS'||standalone?1:6;
 const teams=[{name:'Alpha',players:['One']},{name:'Beta',players:['Two']}];
 const setup=physicalProtocol<=3?{version:physicalProtocol,categoryKeys:Array.from({length:count},(_,i)=>`category_${i}`),teams:teams.map(t=>({...t,lifelines:[]})),rules:{questionSeconds:20}}:{version:physicalProtocol,categories:Array.from({length:count},(_,i)=>({key:`category_${i}`,promptRefs:[]})),teams:physicalProtocol===4?teams:teams.map((t,i)=>({...t,colorKey:i?'SKY':'CORAL',aids:standalone?['HINT','PASS','DOUBLE']:['PHONE_A_FRIEND','DOUBLE_ANSWER','MORE_HINT']})),rules:{...(physicalProtocol===5?{version:'enta-competitive-1',paletteVersion:'enta-team-palette-1'}:{}),questionSeconds:20,turnSeconds:30,overallSeconds:null,...(physicalProtocol===5?{stealSeconds:10,phoneSeconds:60,embeddedStealCap:200}:{})}};
 return {envelopeVersion:6,e3Protocol:1,requestKey:'request_0001',logicalMatchId:'logical_0001',profile:{physicalProtocol,format,retainedRules,mode},predecessor:{gameId:recursive?'prior_successor':'prior_original',originalTerminalHash:'a'.repeat(64)},setup};
}
test('actual Enta parser/service/repository: twenty sealed retry input shapes, external SQL I/O inert',async()=>{
 for(const p of profiles) for(const recursive of [false,true]) {
  let calls=0;
  const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{strings:readonly string[]})=>{calls++;assert.match(q.strings.join(' '),/e3_comp_retry/);return [{value:{gameId:p[0]>=4?'logical_0001':'generated_game',admissionId:'generated_admission',physicalProtocol:p[0],envelopeVersion:6,e3Protocol:1,idempotent:true}}];}})} as unknown as EntaSuccessorDatabase;
  const service=createEntaSuccessorService({projectId:'project',repository:createEntaSuccessorRepository(db,{namespaceId:'ns',firebaseProjectId:'project'})});
  const result=await service(principal,request(p,recursive));assert.equal(result.idempotent,true);assert.equal(calls,1);
 }
});
test('unproved E3 capacity denies fresh work after authoritative retry miss',async()=>{
 let calls=0;const db={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{strings:readonly string[]})=>{calls++;assert.match(q.strings.join(' '),/e3_comp_retry/);return [{value:null}];}})} as unknown as EntaSuccessorDatabase;
 const service=createEntaSuccessorService({projectId:'project',repository:createEntaSuccessorRepository(db,{namespaceId:'ns',firebaseProjectId:'project'})});
 await assert.rejects(service(principal,request(profiles[0],false)),/E3_CAPACITY_UNAVAILABLE/);assert.equal(calls,1);
});

test('legacy parsed-input service rejects an injected fresh repository before input inspection',async()=>{
 let calls=0;
 const service=createEntaSuccessorService({projectId:'project',repository:{compose:async()=>{calls++;throw new Error('must not execute');}}});
 const input=new Proxy({}, {ownKeys(){throw new Error('must not inspect');}});
 await assert.rejects(()=>service(principal,input),/E3_CAPACITY_UNAVAILABLE/);
 assert.equal(calls,0);
});

test('private Enta capsule reads and validates the protected spool before exact replay, once',async()=>{
 const {EntaSuccessorCapsule}=await import('../src/history-rematch/capacity-producer');
 const s={namespace:'ns',project:'project',owner:'owner_id',route:'route',operation:'ENTA_SUCCESSOR' as const,requestDigest:'a'.repeat(64)};
 const i={host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'};
 const admission={id:'admission',fence:1n,subject:s,incarnation:i,qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const body=request(profiles[0],false), calls:string[]=[];
 const effect={query:async(sql:string)=>{calls.push(sql);
  if(sql.includes('capacity_begin'))return [{value:null}];
  if(sql.includes('read_spool'))return [{value:Buffer.from(JSON.stringify(body))}];
  if(sql.includes('assert_spool_request'))return [{value:null}];
  if(sql.includes('read_context'))return [{value:{namespace:'ns',projectId:'project',uid:'owner',identityId:'owner_id',policyRevision:'1',policyHash:'d'.repeat(64)}}];
  if(sql.includes('e3_comp_retry'))return [{value:{gameId:'generated_game',admissionId:'generated_admission',physicalProtocol:2,envelopeVersion:6,e3Protocol:1,idempotent:true}}];
  throw new Error('unexpected statement');
 }};
 const capsule=new EntaSuccessorCapsule(effect),spool={id:'spool',digest:'e'.repeat(64),envelope:'parent'};
 const result=await capsule.executeOne(admission,spool);assert.equal(result.idempotent,true);
 assert.equal(calls.length,5);assert.match(calls[0],/capacity_begin/);assert.match(calls[1],/read_spool/);assert.match(calls[2],/assert_spool_request/);assert.match(calls[4],/e3_comp_retry/);
 await assert.rejects(()=>capsule.executeOne(admission,spool),/CAPACITY_UNAVAILABLE/);assert.equal(calls.length,5);
});

test('private Enta capsule rejects spool/request mismatch before replay or fresh preparation',async()=>{
 const {EntaSuccessorCapsule}=await import('../src/history-rematch/capacity-producer');
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'owner_id',route:'route',operation:'ENTA_SUCCESSOR' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const calls:string[]=[];const effect={query:async(sql:string)=>{calls.push(sql);if(sql.includes('capacity_begin'))return [{value:null}];if(sql.includes('read_spool'))return [{value:Buffer.from(JSON.stringify(request(profiles[0],false)))}];throw new Error('raw request mismatch detail');}};
 await assert.rejects(()=>new EntaSuccessorCapsule(effect).executeOne(admission,{id:'spool',digest:'e'.repeat(64),envelope:'parent'}),/CAPACITY_UNAVAILABLE/);
 assert.equal(calls.length,3);assert.match(calls[2],/assert_spool_request/);
});

test('dedicated Enta capsule commits begin separately and keeps replay in one transaction',async()=>{
 const {EntaDedicatedCapsule}=await import('../src/history-rematch/capacity-producer');
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'owner_id',route:'route',operation:'ENTA_SUCCESSOR' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 let tx=0;const seen:Array<{tx:number;sql:string}>=[];
 const db={$transaction:async(fn:(v:unknown)=>Promise<unknown>)=>{const current=++tx;return fn({$queryRaw:async(q:{strings:readonly string[]})=>{const sql=q.strings.join(' ');seen.push({tx:current,sql});if(sql.includes('capacity_begin')||sql.includes('assert_spool_request'))return [{value:null}];if(sql.includes('read_spool'))return [{value:Buffer.from(JSON.stringify(request(profiles[0],false)))}];if(sql.includes('read_context'))return [{value:{namespace:'ns',projectId:'project',uid:'owner',identityId:'owner_id',policyRevision:'1',policyHash:'d'.repeat(64)}}];if(sql.includes('e3_comp_retry'))return [{value:{gameId:'generated_game',admissionId:'generated_admission',physicalProtocol:2,envelopeVersion:6,e3Protocol:1,idempotent:true}}];throw Error('unexpected');}});}} as unknown as EntaSuccessorDatabase;
 const result=await new EntaDedicatedCapsule(db).executeOne(admission,{id:'spool',digest:'e'.repeat(64),envelope:'parent'});assert.equal(result.idempotent,true);assert.equal(tx,2);assert.equal(seen[0].tx,1);assert.ok(seen.slice(1).every(x=>x.tx===2));
});

test('actual supervised Enta path admits after protected miss and returns protected committed outcome',async()=>{
 const {SqlProtectedIngress,runSuccessor}=await import('../src/history-rematch/capacity-ingress');const {createSqlSupervisorAuthority}=await import('../src/history-rematch/capacity-supervisor');const {createCapacityRoleEffect,EntaDedicatedCapsule}=await import('../src/history-rematch/capacity-producer');const {createHash}=await import('node:crypto');
 const role=(handler:(sql:string)=>Promise<Array<{value:unknown}>>)=>createCapacityRoleEffect({$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{text:string})=>handler(q.text)})} as unknown as EntaSuccessorDatabase);
 const body=Buffer.from(JSON.stringify(request(profiles[0],false))),digest=createHash('sha256').update(body).digest('hex'),spool='d'.repeat(64);
 const subject={namespace:'ns',project:'project',owner:'owner_id',route:'/successor',operation:'ENTA_SUCCESSOR' as const,requestDigest:'a'.repeat(64)},incarnation={host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'};
 const wire={id:'admission',fence:'1',subject,incarnation,qualification:{id:'q',generation:'1',evidenceHash:'b'.repeat(64),validUntil:'2030-01-01T00:00:00.000Z',reuse:'ONE_USE',domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:'2030-01-01T00:00:00.000Z',state:'RESERVED'};
 const miss={id:'replay',replay:'replay',requestIdentity:'request',spool:{id:spool,digest,envelope:'parent'},subject,incarnation},events:string[]=[];
 const allocator=role(async sql=>{events.push(sql);return [{value:null}];});
 const supervisor=role(async sql=>{events.push(sql);if(sql.includes('register_control'))return [{value:'control'}];if(sql.includes('prepare_connection')||sql.includes('reserve_launch'))return [{value:'CREATED'}];if(sql.includes('register_replay'))return [{value:'replay'}];if(sql.includes('read_replay_profile'))return [{value:{id:'replay-profile',proofHash:'f'.repeat(64),maxBodyBytes:'65536',parentEnvelope:'parent'}}];if(sql.includes('spool_commit'))return [{value:spool}];if(sql.includes('read_miss'))return [{value:miss}];if(sql.includes('register_issuance'))return [{value:'issuance'}];if(sql.includes('read_issued')||sql.includes('read_admission'))return [{value:wire}];if(sql.includes('read_outcome'))return [{value:{gameId:'protected_game',admissionId:'generated_admission',physicalProtocol:2,envelopeVersion:6,e3Protocol:1,idempotent:false}}];if(sql.includes('quarantine'))return [{value:null}];throw Error('unexpected supervisor query');});
 const replay=role(async()=>[{value:{kind:'MISS',receiptId:'replay'}}]),issuer=role(async()=>[{value:'admission'}]),release=role(async()=>[{value:null}]);
 const {ObservationSource}=await import('../src/history-rematch/capacity-supervisor');
 const install=(kind:'REPLAY'|'PRODUCER')=>{const publisher=role(async sql=>[{value:sql.includes('read_observer_input_limit')?'65536':'observation'}]);const claim=role(async()=>[{value:{status:'CREATED',inputClaimId:'a'.repeat(64),maxInputBytes:'65536'}}]);const fields=['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'];const source=new ObservationSource(lease=>({async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({observationVersion:'1',observationId:'observation',trustId:'trust',trustGeneration:'1',controlKey:'control',kind,credentialEpoch:'credential',launchEpoch:'launch',principalName:'login',principalOid:'100',pid:'42',backendStart:'2030-01-01T00:00:00Z',host:'host',boot:'boot',processTree:'tree',installationGeneration:'1',installationEvidenceHash:'a'.repeat(64),installation:Object.fromEntries(fields.map(k=>[k,k])),observedAt:'2030-01-01T00:00:00Z',validUntil:'2030-01-01T00:01:00Z',evidence:'YQ==',evidenceHash:'b'.repeat(64),inputClaimId:lease.inputClaimId}));}}));return {publisher,allocator:claim,input:{reservationId:'install-'+kind,source}};};

 const capsuleDb={$transaction:async(fn:(tx:unknown)=>Promise<unknown>)=>fn({$queryRaw:async(q:{text:string})=>{const sql=q.text;if(sql.includes('capacity_begin')||sql.includes('assert_spool_request'))return [{value:null}];if(sql.includes('read_spool'))return [{value:body}];if(sql.includes('read_context'))return [{value:{namespace:'ns',projectId:'project',uid:'owner',identityId:'owner_id',policyRevision:'1',policyHash:'f'.repeat(64)}}];if(sql.includes('e3_comp_retry'))return [{value:null}];if(sql.includes('retained_commit'))return [{value:{gameId:'capsule_claim',admissionId:'generated_admission',physicalProtocol:2,envelopeVersion:6,e3Protocol:1,idempotent:false}}];throw Error('unexpected capsule query');}})} as unknown as EntaSuccessorDatabase;
 const input={async *[Symbol.asyncIterator](){yield body;}};
 const ingress=new SqlProtectedIngress({controlKey:'control',uid:'owner',holderEnvelope:'holder',parentEnvelope:'parent',launchEnvelope:'launch',replayEnvelope:'replay-profile',storageProof:'proof',expiry:'2030-01-01T00:00:00Z',parentHost:'host',parentBoot:'boot',parentProcessTree:'parent-tree',expectedReplayPrincipal:'replay-login',expectedProducerPrincipal:'producer-login',allocator,supervisor,issuer,input,lifecycle:{replay:async()=>({replayId:'replay',record:{replayProofIdentity:'replay-profile'},install:install('REPLAY'),executor:replay}),operation:async()=>({issuanceKey:'issuance',record:{replayId:'replay',spoolDigest:digest,subject},install:install('PRODUCER')}),capsule:async()=>new EntaDedicatedCapsule(capsuleDb),quarantineUncertain:async()=>{}}});
 const output=await runSuccessor({ingress,supervisor:createSqlSupervisorAuthority(supervisor,release),request:{namespace:'ns',project:'project',owner:'owner_id',route:'/successor',operation:'ENTA_SUCCESSOR',requestIdentity:'request'},now:()=>1});
 assert.equal(output.gameId,'protected_game');assert.ok(events.findIndex(x=>x.includes('register_issuance'))>events.findIndex(x=>x.includes('spool_commit')));assert.equal(events.filter(x=>x.includes('quarantine(')).length,1);assert.ok(events.at(-1)!.includes('quarantine_control'));
});

test('Enta private capsule denies rotated parent release before catalog and native commit',async()=>{
 const {EntaSuccessorCapsule}=await import('../src/history-rematch/capacity-producer');const calls:string[]=[];
 const admission={id:'admission',fence:1n,subject:{namespace:'ns',project:'project',owner:'owner_id',route:'route',operation:'ENTA_SUCCESSOR' as const,requestDigest:'a'.repeat(64)},incarnation:{host:'host',boot:'boot',processTree:'tree',backendPrincipal:'producer',backendPid:1,backendStart:'start'},qualification:{id:'q',generation:1n,evidenceHash:'b'.repeat(64),validUntil:100,reuse:'ONE_USE' as const,domain:'d',sourceClosure:'c'.repeat(64)},expiresAt:100,state:'RESERVED' as const};
 const effect={query:async(sql:string)=>{calls.push(sql);if(sql.includes('capacity_begin')||sql.includes('assert_spool_request'))return [{value:null}];if(sql.includes('read_spool'))return [{value:Buffer.from(JSON.stringify(request(profiles[3],false)))}];if(sql.includes('read_context'))return [{value:{namespace:'ns',projectId:'project',uid:'owner',identityId:'owner_id',policyRevision:'1',policyHash:'d'.repeat(64)}}];if(sql.includes('e3_comp_retry'))return [{value:null}];if(sql.includes('int6_enta_lock_wallet'))return [{value:{debt:'0',available:'1'}}];if(sql.includes('pro262_capacity_enta_parent'))throw Error('release rotated');throw Error('unexpected downstream effect');}};
 await assert.rejects(()=>new EntaSuccessorCapsule(effect).executeOne(admission,{id:'spool',digest:'e'.repeat(64),envelope:'parent'}),/CAPACITY_UNAVAILABLE/);assert.ok(calls.some(sql=>sql.includes('pro262_capacity_enta_parent')));assert.ok(calls.every(sql=>!sql.includes('pro262_capacity_enta_catalog')&&!sql.includes('e3_comp_native4_commit')));
});
