import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkInitialReceipt, checkInstallerChannelFrame, checkInstallerReceiptFrame, decodeStartupQualification, descriptorCoreHash, encodeInstallerChannelFrame, installerChannelSnapshots, installerChannelConversation, installerChannelFrameCollector, installerFixedSqlFrame, verifyInstallerPermitBytes, encodeInstallerChannelV2, decodeInstallerChannelV2, installerChannelV2Conversation, installerChannelV2ByteAdapter, inspectStartupSignedFrame, inspectStartupLocalFrameV2, inspectStartupLocalRecordsV2, inspectStartupEvents, inspectStartupBundleV2, inspectStartupReceiverBindingV2, inspectStartupManifestV2, verifyStartupBundleV2, startupProjectionTranscriptV2 } from '../src/history-rematch/capacity-contract';

function startupManifestFixture() {
  const canonical = (v:any):string => typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const hash = (v:Buffer|string) => createHash('sha256').update(v).digest('hex');
  const h = 'a'.repeat(64);
  const artifact = (artifactId:string, role:string, n:number) => ({artifactId,role,relativePath:`bin/${artifactId}`,byteLength:'1',sha256:h,volumeId:'0'.repeat(16),fileId:n.toString(16).padStart(32,'0')});
  const artifacts = [artifact('service','SERVICE_EXE',1),artifact('sql','RECEIVER_ENTRY',2),artifact('tls','TLS_ROOT',3),artifact('credential','CREDENTIAL_FILE',4),artifact('node','NODE_EXE',5),artifact('psql','PSQL_EXE',6)];
  const serviceClosure = {schemaVersion:'pro273-artifact-closure-v2',entryArtifactId:'service',artifactIds:['service'],loaderQualificationHash:h};
  const sqlReceiverClosure = {schemaVersion:'pro273-artifact-closure-v2',entryArtifactId:'sql',artifactIds:['node','psql','sql'],loaderQualificationHash:h};
  const closureHash = (domain:string,c:any,records=artifacts) => hash(canonical([domain,c,c.artifactIds.map((id:string) => records.find(a => a.artifactId === id))]));
  const receiverBinding = {schemaVersion:'pro273-startup-receiver-binding-v2',serviceReceiverClosureHash:closureHash('pro273.installer.service-closure.v2',serviceClosure),sqlReceiverClosureHash:closureHash('pro273.installer.sql-receiver-closure.v2',sqlReceiverClosure),sourceClosureHash:h,installationClosureHash:h,authorityEpoch:'1',installationGeneration:'1'};
  const endpoint = {schemaVersion:'pro273-installer-endpoint-v1',endpointId:'endpoint',host:'db.example.com',hostAddress:'127.0.0.1',port:'5432',database:'db',user:'user',sslMode:'verify-full',tlsRootArtifactId:'tls',gssEncMode:'disable',channelBinding:'require',connectTimeoutSeconds:'10',serverIdentityQualificationHash:h};
  const credentialProfile = {schemaVersion:'pro273-installer-auth-v1',credentialConfigId:'config',endpointId:'endpoint',method:'SCRAM-SHA-256',credentialArtifactId:'credential',credentialCustodyQualificationHash:h};
  const manifest:any = {schemaVersion:'pro273-installer-manifest-v2',authorityEpoch:'1',installationGeneration:'1',hostIdentity:'b'.repeat(32),bootIdentity:'c'.repeat(32),sourceClosureHash:h,installationClosureHash:h,artifacts,serviceClosure,sqlReceiverClosure,receiverBinding,endpoint,credentialProfile,resourceQualificationHash:h};
  const wire = (body:string) => { const payload = Buffer.from(body), header = Buffer.alloc(12); header.write('P273M002'); header.writeUInt32LE(payload.length,8); return Buffer.concat([header,payload]); };
  return {canonical,hash,h,artifact,artifacts,serviceClosure,sqlReceiverClosure,closureHash,receiverBinding,endpoint,credentialProfile,manifest,wire};
}

test('startup v2 inert manifest closed data framing and denials', () => {
  const {canonical,hash,h,artifact,artifacts,serviceClosure,sqlReceiverClosure,closureHash,receiverBinding,endpoint,credentialProfile,manifest,wire} = startupManifestFixture();
  const check = (m:any) => {const f = wire(canonical(m)); return inspectStartupManifestV2(f,hash(f));};
  const rebind = (m:any) => ({...m,receiverBinding:{...m.receiverBinding,serviceReceiverClosureHash:closureHash('pro273.installer.service-closure.v2',m.serviceClosure,m.artifacts),sqlReceiverClosureHash:closureHash('pro273.installer.sql-receiver-closure.v2',m.sqlReceiverClosure,m.artifacts)}});
  const frame = wire(canonical(manifest));
  const decodedManifest = inspectStartupManifestV2(frame,hash(frame));
  assert.equal(decodedManifest.frameHash,hash(frame));
  assert.deepEqual(JSON.parse(JSON.stringify(decodedManifest.payload)),manifest);
  assert.ok(Object.isFrozen(decodedManifest.payload));
  const dependencyRoles = ['LIBPQ','TLS_LIBRARY','RUNTIME_LIBRARY','NATIVE_LIBRARY','LOADER_CONFIG'];
  for (const [i,role] of dependencyRoles.entries()) {
    const added = artifact(`dep${i}`,role,10+i);
    const extended = {...manifest,artifacts:[...artifacts,added],sqlReceiverClosure:{...sqlReceiverClosure,artifactIds:[added.artifactId,...sqlReceiverClosure.artifactIds]}};
    assert.doesNotThrow(() => check(rebind(extended)),role);
    assert.throws(() => check(extended),/CAPACITY_UNAVAILABLE/,`full-record hash ${role}`);
  }
  for (const role of ['SERVICE_EXE','NODE_EXE','RECEIVER_ENTRY','PSQL_EXE','TLS_ROOT','CREDENTIAL_FILE']) {
    assert.throws(() => check({...manifest,artifacts:[...artifacts,artifact('duplicate',role,20)]}),/CAPACITY_UNAVAILABLE/,`duplicate ${role}`);
    const missing = {...manifest,artifacts:artifacts.filter(a => a.role !== role)};
    assert.throws(() => check(missing),/CAPACITY_UNAVAILABLE/,`missing ${role}`);
  }
  for (const role of ['SERVICE_EXECUTABLE','SQL_RECEIVER_EXECUTABLE','LIBRARY','OS_LIBRARY','UNKNOWN'])
    assert.throws(() => check({...manifest,artifacts:[...artifacts,artifact('invalid',role,20)]}),/CAPACITY_UNAVAILABLE/,role);
  for (const id of ['node','psql']) {
    const missing = {...manifest,sqlReceiverClosure:{...sqlReceiverClosure,artifactIds:sqlReceiverClosure.artifactIds.filter(item => item !== id)}};
    assert.throws(() => check(rebind(missing)),/CAPACITY_UNAVAILABLE/,`SQL closure missing ${id}`);
  }
  for (const role of ['NODE_EXE','PSQL_EXE','SERVICE_EXE','TLS_ROOT','CREDENTIAL_FILE']) {
    const substituted = {...manifest,artifacts:artifacts.map(a => a.artifactId === 'sql' ? {...a,role} : a.role === role ? {...a,role:'RECEIVER_ENTRY'} : a)};
    assert.throws(() => check(rebind(substituted)),/CAPACITY_UNAVAILABLE/,`entry substitution ${role}`);
  }
  const swappedService = {...manifest,artifacts:artifacts.map(a => a.artifactId === 'service' ? {...a,role:'NODE_EXE'} : a.artifactId === 'node' ? {...a,role:'SERVICE_EXE'} : a)};
  assert.throws(() => check(rebind(swappedService)),/CAPACITY_UNAVAILABLE/);
  const unsorted = {...manifest,sqlReceiverClosure:{...sqlReceiverClosure,artifactIds:['sql','psql','node']}};
  assert.throws(() => check(rebind(unsorted)),/CAPACITY_UNAVAILABLE/);
  const duplicateMember = {...manifest,sqlReceiverClosure:{...sqlReceiverClosure,artifactIds:['node','node','psql','sql']}};
  assert.throws(() => check(rebind(duplicateMember)),/CAPACITY_UNAVAILABLE/);
  const changedRecord = {...manifest,artifacts:artifacts.map(a => a.artifactId === 'node' ? {...a,sha256:'b'.repeat(64)} : a)};
  assert.throws(() => check(changedRecord),/CAPACITY_UNAVAILABLE/);
  assert.doesNotThrow(() => check(rebind(changedRecord)));
  assert.throws(() => inspectStartupManifestV2(frame,h),/CAPACITY_UNAVAILABLE/);
  const invalidUtf8 = wire('"x"'); invalidUtf8[13] = 0xff;
  const wrongMagic = Buffer.from(frame); wrongMagic[0] = 0;
  const wrongLength = Buffer.from(frame); wrongLength.writeUInt32LE(0xffffffff,8);
  for (const bytes of [Buffer.concat([frame,Buffer.from([0])]), frame.subarray(0,-1), wrongMagic, wrongLength, invalidUtf8, wire('{"x":"1","x":"2"}'), wire('{"x":1}'), wire(' '), wire('x'.repeat(65537)),new Uint8Array(new SharedArrayBuffer(20))]) assert.throws(() => inspectStartupManifestV2(bytes,hash(Buffer.from(bytes))),/CAPACITY_UNAVAILABLE/);
  for (const path of ['../file','/absolute','a//b','a/CON.txt','a/file.','a/file ','a/file:stream','a\\\\b','a/..']) assert.throws(() => check({...manifest,artifacts:artifacts.map((a,i) => i ? a : {...a,relativePath:path})}),/CAPACITY_UNAVAILABLE/,path);
  for (const altered of [
    {...manifest,artifacts:[...artifacts,artifacts[0]]}, {...manifest,artifacts:artifacts.slice(1)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,relativePath:'BIN/SERVICE'} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,relativePath:'BIN/other'} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,relativePath:'bin/service/child'} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,fileId:artifacts[0].fileId} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,role:'OS_LIBRARY'} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,artifactId:'SQL'} : a)},
    {...manifest,artifacts:artifacts.map((a,i) => i === 1 ? {...a,byteLength:'18446744073709551616'} : a)},
    {...manifest,artifacts:Array(129).fill(artifacts[0])},
    {...manifest,serviceClosure:{...serviceClosure,artifactIds:['service','service']}},
    {...manifest,serviceClosure:{...serviceClosure,entryArtifactId:'sql'}},
    {...manifest,receiverBinding:{...receiverBinding,serviceReceiverClosureHash:receiverBinding.sqlReceiverClosureHash,sqlReceiverClosureHash:receiverBinding.serviceReceiverClosureHash}},
    {...manifest,receiverBinding:{...receiverBinding,serviceReceiverClosureHash:closureHash('pro273.installer.sql-receiver-closure.v2',serviceClosure)}},
    ...['db.example.com,evil.example.com','postgres://db.example.com','db.example.com?options=x','127.0.0.1'].map(host => ({...manifest,endpoint:{...endpoint,host}})),
    {...manifest,endpoint:{...endpoint,hostAddress:'127.0.0.1,127.0.0.2'}}, {...manifest,endpoint:{...endpoint,hostAddress:'fe80::1%1'}},
    ...['::1','0:0:0:0:0:0:0:1','::ffff:127.0.0.1'].map(hostAddress => ({...manifest,endpoint:{...endpoint,hostAddress}})),
    {...manifest,endpoint:{...endpoint,port:['5432']}}, {...manifest,endpoint:{...endpoint,port:[]}},
    {...manifest,endpoint:{...endpoint,tlsRootArtifactId:'credential'}},
    {...manifest,credentialProfile:{...credentialProfile,endpointId:'other'}},
    {...manifest,credentialProfile:{...credentialProfile,credentialArtifactId:'tls'}},
    {...manifest,endpoint:{...endpoint,channelBinding:'prefer'}}, {...manifest,extra:'x'}
  ]) assert.throws(() => check(altered),/CAPACITY_UNAVAILABLE/);
});

test('startup v2 inert local framing captures canonical bounded bytes only', () => {
  const wire = (body: Buffer, magic = 'P273F002') => {
    const header = Buffer.alloc(12); header.write(magic); header.writeUInt32LE(body.length, 8);
    return Buffer.concat([header, body]);
  };
  const frame = wire(Buffer.from('{"x":"value"}'));
  const captured = inspectStartupLocalFrameV2(frame, 'projection');
  assert.equal(captured.frameHash, createHash('sha256').update(frame).digest('hex'));
  assert.ok(Object.isFrozen(captured));
  frame.fill(0);
  assert.deepEqual({...captured.payload as object}, {x:'value'});
  for (const body of ['{"x":"a","x":"a"}', '{"z":"1","a":"2"}', '{"x":1}', '{"x":"1"} ', '[]', '{}\n'])
    assert.throws(() => inspectStartupLocalFrameV2(wire(Buffer.from(body)), 'projection'), /CAPACITY_UNAVAILABLE/);
  const good = wire(Buffer.from('{"x":"1"}'));
  for (const bad of [wire(Buffer.from([0xc3,0x28])), wire(Buffer.from('{"x":"1"}'),'P273B002'), good.subarray(0,-1), Buffer.concat([good,Buffer.from([0])]), wire(Buffer.alloc(4097,32)), new Uint8Array(new SharedArrayBuffer(good.length)), new Proxy(good,{})])
    assert.throws(() => inspectStartupLocalFrameV2(bad, 'projection'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => inspectStartupLocalFrameV2(good, 'unknown' as any), /CAPACITY_UNAVAILABLE/);
  const oversized = wire(Buffer.alloc(65537,32));
  assert.throws(() => inspectStartupLocalFrameV2(oversized, 'starter'), /CAPACITY_UNAVAILABLE/);
  for (const stage of ['PAIR_CONSTRUCTOR','DESCRIPTOR_CONSTRUCTOR'] as const)
    assert.throws(() => installerFixedSqlFrame(stage,'expectation','nonce',Buffer.from('x'),10000n,10000n), /CAPACITY_UNAVAILABLE/);
});

test('startup v2 inert closed data correlates frames and rejects malformed substitutions', () => {
  const hash = (s:string) => createHash('sha256').update(s).digest('hex');
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const canonical = (v:any):string => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const frame = (kind:string, payload:any, signature?:Buffer) => {
    const body = Buffer.from(canonical(payload)), header = Buffer.alloc(12);
    header.write(kind === 'bundle' ? 'P273B002' : 'P273C002'); header.writeUInt32LE(body.length,8);
    const prefix = Buffer.concat([header,body]);
    const detached = signature ?? sign(null,Buffer.concat([Buffer.from(`pro273.startup.${kind}.v2\n`),prefix]),pair.privateKey);
    return Buffer.concat([prefix,detached]);
  };
  const h = 'a'.repeat(64), kinds = ['SERVICE_START','NODE_LAUNCH','PSQL_LAUNCH','CONSTRUCTOR_DISPATCH'];
  const manifestFixture = startupManifestFixture();
  const manifest = manifestFixture.manifest;
  const manifestFrame = manifestFixture.wire(manifestFixture.canonical(manifest));
  const manifestSha256 = manifestFixture.hash(manifestFrame);
  const events = kinds.map((kind,i) => ({kind,attemptId:`a${i}`,parentAttemptId:i ? `a${i-1}` : 'holder',eventId:`e${i}`,externalChargeId:`c${i}`,externalChargeBindingHash:h,fenceId:`f${i}`}));
  const limitKeys = 'bundleBytes consumptionBytes localRecordBytes totalReadBytes totalWriteBytes readCalls writeCalls flushCalls hashCalls signatureChecks fileCreates fileOpens registryReads securityQueries processQueries scmQueries eventCreates eventSignals eventWaits startServiceCalls processLaunches dispatchWrites handles threads backendPeakBytes parentPeakBytes sharedPeakBytes temporaryPeakBytes durableBytes elapsedMillis'.split(' ');
  const coverage:any = {schemaVersion:'pro273-startup-coverage-v2',holderRecordHash:h,resourceScheduleHash:h,manifestHash:h,memoryEvidenceHash:h,workEvidenceHash:h,durabilityEvidenceHash:h,cleanupEvidenceHash:h,limits:Object.fromEntries(limitKeys.map(k => [k,'0']))};
  const b:any = {schemaVersion:'pro273-startup-bundle-v2',issuerId:'issuer',issuerGeneration:'1',accountingDomain:'EXTERNAL_STARTUP',bundleId:'bundle',qualificationHash:h,holderReservationId:'holder',holderReservationRecordHash:h,holderPrepaymentReceiptHash:h,physicalIdentity:'physical',physicalProofIdentity:'proof',partitionId:'partition',authorityEpoch:'1',installationGeneration:'1',hostIdentity:'a'.repeat(32),bootIdentity:'b'.repeat(32),validFrom:'2026-01-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',sourceClosureHash:h,starterClosureHash:h,serviceReceiverClosureHash:h,manifestHash:h,events,sqlTarget:{expectationId:'expectation',dispatchAttemptId:'a3',receiverClosureHash:h,constructorKind:'CONTROL_PLANE_BASELINE',targetId:'target',expectedCoreHash:h,expectedEvidenceHash:h},coverage};
  Object.assign(b,{hostIdentity:manifest.hostIdentity,bootIdentity:manifest.bootIdentity,manifestHash:manifestSha256,
    serviceReceiverClosureHash:manifest.receiverBinding.serviceReceiverClosureHash});
  b.sqlTarget.receiverClosureHash = manifest.receiverBinding.sqlReceiverClosureHash;
  coverage.manifestHash = manifestSha256;
  const receipt = (bundle:any, raw = frame('bundle',bundle)):any => ({schemaVersion:'pro273-startup-bundle-consumption-v2',issuerId:bundle.issuerId,issuerGeneration:bundle.issuerGeneration,bundleId:bundle.bundleId,bundleHash:createHash('sha256').update(raw).digest('hex'),holderReservationId:bundle.holderReservationId,consumptionId:'consumption',consumedAt:'2026-06-01T00:00:00.000Z',issuerCommitIdentity:'commit',eventsHash:hash(canonical(['pro273.startup.events.v2',bundle.events])),coverageHash:hash(canonical(['pro273.startup.coverage.v2',bundle.coverage]))});
  const wire = frame('bundle',b);
  const c = receipt(b,wire); c.bundleHash = createHash('sha256').update(wire).digest('hex');
  const check = (bundle:any, consumption:any = c) => inspectStartupBundleV2(frame('bundle',bundle),frame('consumption',consumption));
  const result = check(b);
  // The real data composition uses the same captured signed frames throughout.
  const cw = frame('consumption',c), nonce = 'd'.repeat(64);
  const localFrame = (payload:any) => { const body = Buffer.from(canonical(payload)), header = Buffer.alloc(12); header.write('P273F002'); header.writeUInt32LE(body.length,8); return Buffer.concat([header,body]); };
  const frameHash = (v:Buffer) => createHash('sha256').update(v).digest('hex');
  const common = {bundleId:b.bundleId,bundleHash:frameHash(wire),consumptionId:c.consumptionId,consumptionHash:frameHash(cw),qualificationHash:b.qualificationHash,starterNonce:nonce};
  const ps = events.map(e => ({schemaVersion:'pro273-startup-event-projection-v2',...common,...e}));
  const pframes = ps.map(localFrame);
  const starter:any = {schemaVersion:'pro273-consumed-starter-v2',bundleFrameBase64:wire.toString('base64'),consumptionFrameBase64:cw.toString('base64'),starterNonce:nonce,starterPid:'1',starterCreationTime:'18446744073709551615',starterImageHash:h,serviceConsumeHash:frameHash(pframes[0]),nodeConsumeHash:frameHash(pframes[1]),psqlConsumeHash:frameHash(pframes[2]),dispatchConsumeHash:frameHash(pframes[3])};
  const sf = localFrame(starter);
  const authority = {rawPublicKey:key,publicKeySha256:frameHash(key),bundleSha256:frameHash(wire),consumptionSha256:frameHash(cw),
    manifestFrame,manifestSha256,installationClosureSha256:manifest.installationClosureHash,earliestNow:c.consumedAt,latestNow:'2026-06-01T00:00:00.001Z'};
  const service:any = {schemaVersion:'pro273-starter-service-binding-v2',...common,starterReceiptHash:frameHash(sf),serviceName:'HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028',serviceSid:'S-1-5-80-0-1-2-3-4294967295',servicePid:'4294967295',serviceCreationTime:'1',serviceImageHash:h,hostIdentity:b.hostIdentity,bootIdentity:b.bootIdentity,authorityEpoch:b.authorityEpoch,installationGeneration:b.installationGeneration};
  {
  // Pure reported transcript: no operation below performs external effects.
  const slots = ['SERVICE_CONSUME','NODE_CONSUME','PSQL_CONSUME','DISPATCH_CONSUME','STARTER_RECEIPT','SERVICE_BINDING'];
  const missing = () => slots.map(slot => ({slot,state:'MISSING',objectId:null,frameHash:null}));
  const make = () => startupProjectionTranscriptV2(wire,cw,pframes,sf,authority);
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const wrongPins = [undefined, new Proxy(authority,{}), {...authority,get earliestNow():string { assert.fail('unexpected getter'); }},
    {...authority,rawPublicKey:otherKey,publicKeySha256:frameHash(otherKey)}, {...authority,publicKeySha256:h},
    {...authority,bundleSha256:h}, {...authority,consumptionSha256:h},
    {...authority,manifestSha256:h}, {...authority,manifestFrame:manifestFrame.subarray(0,-1)},
    {...authority,installationClosureSha256:'d'.repeat(64)},
    {...authority,earliestNow:'2026-05-31T23:59:59.999Z'}, {...authority,latestNow:b.validUntil},
    {...authority,earliestNow:'2026-06-01'}, {...authority,latestNow:'2026-05-31T23:59:59.999Z'}];
  for (const pins of wrongPins) {
    assert.throws(() => startupProjectionTranscriptV2(wire,cw,pframes,sf,pins!),/CAPACITY_UNAVAILABLE/);
  }
  const rejectCorrelatedFrames = (changedBundle:Buffer, changedConsumption:Buffer, bundle = b) => {
    const alteredPins = {...authority,bundleSha256:frameHash(changedBundle),consumptionSha256:frameHash(changedConsumption)};
    const alteredProjections = ps.map(p => localFrame({...p,bundleHash:alteredPins.bundleSha256,consumptionHash:alteredPins.consumptionSha256}));
    const alteredStarter = localFrame({...starter,bundleFrameBase64:changedBundle.toString('base64'),consumptionFrameBase64:changedConsumption.toString('base64'),
      serviceConsumeHash:frameHash(alteredProjections[0]),nodeConsumeHash:frameHash(alteredProjections[1]),
      psqlConsumeHash:frameHash(alteredProjections[2]),dispatchConsumeHash:frameHash(alteredProjections[3])});
    const alteredService = localFrame({...service,bundleHash:alteredPins.bundleSha256,consumptionHash:alteredPins.consumptionSha256,
      starterReceiptHash:frameHash(alteredStarter),hostIdentity:bundle.hostIdentity,bootIdentity:bundle.bootIdentity,
      authorityEpoch:bundle.authorityEpoch,installationGeneration:bundle.installationGeneration});
    assert.doesNotThrow(() => inspectStartupLocalRecordsV2(changedBundle,changedConsumption,alteredProjections,alteredStarter,alteredService));
    assert.throws(() => startupProjectionTranscriptV2(changedBundle,changedConsumption,alteredProjections,alteredStarter,alteredPins),/CAPACITY_UNAVAILABLE/);
  };
  for (const kind of ['bundle','consumption'] as const) {
    const changedBundle = Buffer.from(wire);
    if (kind === 'bundle') changedBundle[changedBundle.length-1] ^= 1;
    const changedConsumption = frame('consumption',receipt(b,changedBundle));
    if (kind === 'consumption') changedConsumption[changedConsumption.length-1] ^= 1;
    rejectCorrelatedFrames(changedBundle,changedConsumption);
  }
  for (const change of [{hostIdentity:'d'.repeat(32)}, {bootIdentity:'d'.repeat(32)}, {authorityEpoch:'2'},
    {installationGeneration:'2'}, {sourceClosureHash:'d'.repeat(64)}, {serviceReceiverClosureHash:'d'.repeat(64)},
    {sqlTarget:{...b.sqlTarget,receiverClosureHash:'d'.repeat(64)}}]) {
    const changed = {...b,...change};
    const changedBundle = frame('bundle',changed);
    const changedConsumption = frame('consumption',receipt(changed,changedBundle));
    assert.doesNotThrow(() => verifyStartupBundleV2(changedBundle,changedConsumption,key));
    rejectCorrelatedFrames(changedBundle,changedConsumption,changed);
  }
  const start = () => { const m = make(); assert.equal(m.preflight(missing()).phase,'AWAIT_CONSUMPTION'); assert.equal(m.consumption({state:'CONSUMED',bundleHash:common.bundleHash,consumptionHash:common.consumptionHash,nonce}).phase,'FILES'); return m; };
  const tuple = {serviceName:service.serviceName,serviceSid:service.serviceSid,servicePid:service.servicePid,serviceCreationTime:service.serviceCreationTime,serviceImageHash:service.serviceImageHash};
  const resultFor = (t:any) => {
    const objectId = 'object' + slots.indexOf(t.slot);
    switch (t.operation) {
      case 'CREATE_NEW': return {state:'CREATED',objectId};
      case 'WRITE': return {state:'WRITTEN',objectId,count:t.count};
      case 'FLUSH': return {state:'FLUSHED',objectId};
      case 'READBACK': return {state:'HASH_REPORTED',objectId,count:t.count,frameHash:t.frameHash};
      case 'DURABILITY_REPORT': return {state:'UNVERIFIED',objectId};
      case 'CREATE_EVENT': return {state:'CREATED',eventId:'event',manualReset:true,initiallySignaled:false,protected:true};
      case 'START_SERVICE': return {state:'START_REPORTED',eventId:'event',...tuple};
      case 'BIND_SERVICE': return {state:'BOUND',eventId:'event',...tuple};
      case 'SIGNAL_EVENT': return {state:'SIGNALED',eventId:'event'};
      default: throw Error('unexpected operation');
    }
  };
  const advance = (m:any, count:number) => { for (let i=0;i<count;i++) {const n=m.next(); assert.equal(n.state,'UNVERIFIED'); const t=n.ticket; assert.equal(m.ack({ticket:t,result:resultFor(t)}).state,'UNVERIFIED');} };
  const happy = start(); advance(happy,34); assert.deepEqual({phase:happy.snapshot().phase,state:happy.snapshot().state,operations:happy.snapshot().operations},{phase:'COMPLETE',state:'UNVERIFIED',operations:'34'});
  assert.equal(happy.ack({ticket:null,result:null}).state,'UNKNOWN');
  const mixed = make(); const mixedRows = missing(); mixedRows[0]={slot:slots[0],state:'EXISTING',objectId:'old',frameHash:frameHash(pframes[0])} as any; assert.equal(mixed.preflight(mixedRows).state,'UNKNOWN');
  for (const state of ['PARTIAL','REPLACED','UNKNOWN','COMPLETE_SAME_OBJECT']) { const m=make(), rows=missing(); rows[2].state=state; assert.equal(m.preflight(rows).state,'UNKNOWN'); }
  const lost = make(); lost.preflight(missing()); assert.equal(lost.next().state,'UNKNOWN'); assert.equal(lost.consumption({state:'CONSUMED',bundleHash:common.bundleHash,consumptionHash:common.consumptionHash,nonce}).state,'UNKNOWN');
  const uncertain=start(); const ut:any=uncertain.next().ticket;
  assert.equal(uncertain.ack({ticket:ut,result:{state:'UNCERTAIN'}}).state,'UNKNOWN');
  assert.equal(uncertain.ack({ticket:ut,result:resultFor(ut)}).state,'UNKNOWN');
  assert.equal(uncertain.next().state,'UNKNOWN'); assert.equal(uncertain.snapshot().ticket,ut); assert.equal(uncertain.snapshot().operations,'1');
  for (const bad of ['wrong','stale','overflow','extra']) { const m=start(), t:any=m.next().ticket; const altered:any={...t}; if(bad==='wrong') altered.slot=slots[1]; if(bad==='stale') altered.sequence='0'; if(bad==='overflow') altered.sequence='18446744073709551616'; if(bad==='extra') altered.extra='x'; assert.equal(m.ack({ticket:altered,result:resultFor(t)}).state,'UNKNOWN'); assert.equal(m.snapshot().ticket,t); }
  const duplicate=start(); let dt:any=duplicate.next().ticket; duplicate.ack({ticket:dt,result:resultFor(dt)}); assert.equal(duplicate.ack({ticket:dt,result:resultFor(dt)}).state,'UNKNOWN');
  for (const count of ['0','1','18446744073709551616']) { const m=start(); advance(m,1); const t:any=m.next().ticket; assert.equal(m.ack({ticket:t,result:{...resultFor(t),count}}).state,'UNKNOWN'); }
  const alias=start(); advance(alias,5); const at:any=alias.next().ticket; assert.equal(alias.ack({ticket:at,result:{state:'CREATED',objectId:'object0'}}).state,'UNKNOWN');
  const flush=start(); advance(flush,2); const ft:any=flush.next().ticket; assert.equal(flush.ack({ticket:ft,result:{state:'DURABLE',objectId:'object0'}}).state,'UNKNOWN');
  const replacement=start(); advance(replacement,3); const rt:any=replacement.next().ticket; assert.equal(replacement.ack({ticket:rt,result:{...resultFor(rt),objectId:'replacement'}}).state,'UNKNOWN');
  const premature=start(); const pt:any=premature.next().ticket; assert.equal(premature.ack({ticket:{...pt,operation:'START_SERVICE'},result:{state:'START_REPORTED',eventId:'event',...tuple}}).state,'UNKNOWN');
  for (const [key,value] of [ ['serviceName','other'], ['serviceSid','S-1-5-80-0-1-2-3'], ['serviceSid','S-1-5-80-0-1-2-3-4294967296'], ['serviceSid','S-1-5-80-00-1-2-3-4'], ['serviceSid','S-1-5-80-0-1-2-3-4-5'] ]) {
    const m=start(); advance(m,26); const t:any=m.next().ticket; assert.equal(t.operation,'START_SERVICE');
    assert.equal(m.ack({ticket:t,result:{...resultFor(t),[key]:value}}).state,'UNKNOWN');
    assert.equal(m.next().state,'UNKNOWN'); assert.equal(m.snapshot().ticket,t); assert.equal(m.snapshot().operations,'27');
  }
  for (const [key,value] of [['state','UNVERIFIED'],['manualReset',false],['manualReset','true'],['initiallySignaled',true],['initiallySignaled','false'],['protected',false],['protected','true'],['eventId','object0'],['eventId',''],['extra',true],['eventName','event'],['handle','event']]) {
    const m=start(); advance(m,25); const t:any=m.next().ticket; assert.equal(t.operation,'CREATE_EVENT');
    assert.equal(m.ack({ticket:t,result:{...resultFor(t),[key]:value}}).state,'UNKNOWN'); assert.equal(m.snapshot().ticket,t);
  }
  for (const key of ['state','eventId','manualReset','initiallySignaled','protected']) {
    const m=start(); advance(m,25); const t:any=m.next().ticket, result:any=resultFor(t); delete result[key];
    assert.equal(m.ack({ticket:t,result}).state,'UNKNOWN'); assert.equal(m.snapshot().ticket,t);
  }
  for (const key of ['servicePid','serviceSid']) { const m=start(); advance(m,27); const t:any=m.next().ticket; assert.equal(t.operation,'BIND_SERVICE'); assert.equal(m.ack({ticket:t,result:{...resultFor(t),[key]:key==='servicePid'?'1':'S-1-5-80-0-1-2-3-4'}}).state,'UNKNOWN'); }
  const mut=start(); const mt:any=mut.next().ticket; assert.ok(Object.isFrozen(mt)); let getterInvoked=false; const accessor:any={ticket:mt}; Object.defineProperty(accessor,'result',{enumerable:true,get(){ getterInvoked=true; return null; }}); assert.equal(mut.ack(accessor).state,'UNKNOWN'); assert.equal(getterInvoked,false);
  const reentry=start(); const xt:any=reentry.next().ticket; let trapInvoked=false; const proxy=new Proxy({ticket:xt,result:resultFor(xt)},{ownKeys(){trapInvoked=true; reentry.next();return [];}}); assert.equal(reentry.ack(proxy).state,'UNKNOWN'); assert.equal(trapInvoked,false);
  const caught=start(); const ct:any=caught.next().ticket, ownKeys=Reflect.ownKeys; let inner:any, intercepted=false, outer:any;
  try {
    Reflect.ownKeys = ((value:object) => { if (!intercepted) { intercepted=true; try { inner=caught.next(); } catch {} } return ownKeys(value); }) as typeof Reflect.ownKeys;
    outer=caught.ack({ticket:ct,result:resultFor(ct)});
  } finally { Reflect.ownKeys=ownKeys; }
  assert.equal(intercepted,true); assert.equal(inner.state,'UNKNOWN'); assert.equal(outer.state,'UNKNOWN');
  assert.equal(caught.next().state,'UNKNOWN'); assert.equal(caught.snapshot().ticket,ct); assert.equal(caught.snapshot().operations,'1');
  const late=start(); const old:any=late.next().ticket; late.ack({ticket:old,result:resultFor(old)}); const current:any=late.next().ticket; assert.equal(late.ack({ticket:old,result:resultFor(old)}).state,'UNKNOWN'); assert.equal(late.snapshot().ticket,current);
  const overrun=start(); advance(overrun,1); const ot:any=overrun.next().ticket; assert.equal(overrun.ack({ticket:ot,result:{...resultFor(ot),count:String(Number(ot.count)+1)}}).state,'UNKNOWN');
  const mismatch=start(); advance(mismatch,3); const ht:any=mismatch.next().ticket; assert.equal(mismatch.ack({ticket:ht,result:{...resultFor(ht),frameHash:'f'.repeat(64)}}).state,'UNKNOWN');
  const signal=start(); const st:any=signal.next().ticket; assert.equal(signal.ack({ticket:{...st,operation:'SIGNAL_EVENT'},result:{state:'SIGNALED',eventId:'event'}}).state,'UNKNOWN');
  const wrongSignal=start(); advance(wrongSignal,33); const wt:any=wrongSignal.next().ticket; assert.equal(wt.operation,'SIGNAL_EVENT'); assert.equal(wrongSignal.ack({ticket:wt,result:{state:'SIGNALED',eventId:'other'}}).state,'UNKNOWN'); assert.equal(wrongSignal.snapshot().ticket,wt);
  const copiedFrames=pframes.map(x => Buffer.from(x)), copiedStarter=Buffer.from(sf); const copied=startupProjectionTranscriptV2(wire,cw,copiedFrames,copiedStarter,authority); copiedFrames[0].fill(0); copiedStarter.fill(0); copied.preflight(missing()); copied.consumption({state:'CONSUMED',bundleHash:common.bundleHash,consumptionHash:common.consumptionHash,nonce}); assert.equal((copied.next().ticket as any).frameHash,frameHash(pframes[0]));
  const allExisting = slots.map((slot,i) => ({slot,state:'EXISTING',objectId:'old'+i,frameHash:i<4?frameHash(pframes[i]):i===4?frameHash(sf):frameHash(localFrame(service))}));
  const existing=make(); assert.equal(existing.preflight(allExisting).phase,'READ_ONLY'); assert.equal(existing.correlateExisting({objectId:'old5',bytes:localFrame(service)}).phase,'CORRELATED_READ_ONLY'); assert.equal(existing.next().state,'UNKNOWN');
  const replaced=make(); replaced.preflight(allExisting); assert.equal(replaced.correlateExisting({objectId:'replacement',bytes:localFrame(service)}).state,'UNKNOWN'); assert.equal(replaced.next().state,'UNKNOWN');
  }
  const compose = (p:any[] = pframes, s:any = starter, binding:any = service) => inspectStartupLocalRecordsV2(wire,cw,p,localFrame(s),localFrame(binding));
  const localResult = compose();
  assert.deepEqual(localResult.projectionHashes,pframes.map(frameHash));
  assert.equal(localResult.starterReceiptHash,frameHash(sf));
  assert.equal(localResult.serviceBindingHash,frameHash(localFrame(service)));
  assert.ok(Object.isFrozen(localResult) && Object.isFrozen(localResult.projectionHashes));
  for (const key of Object.keys(ps[0])) {
    for (const value of [null,1]) assert.throws(() => compose([localFrame({...ps[0],[key]:value}),...pframes.slice(1)]),/CAPACITY_UNAVAILABLE/,key);
    const missing:any = {...ps[0]}; delete missing[key];
    assert.throws(() => compose([localFrame(missing),...pframes.slice(1)]),/CAPACITY_UNAVAILABLE/,key);
  }
  assert.throws(() => compose([pframes[1],pframes[0],...pframes.slice(2)]),/CAPACITY_UNAVAILABLE/);
  const swapped = [pframes[1],pframes[0],...pframes.slice(2)];
  const reboundSwap = {...starter,serviceConsumeHash:frameHash(swapped[0]),nodeConsumeHash:frameHash(swapped[1])};
  assert.throws(() => compose(swapped,reboundSwap,{...service,starterReceiptHash:frameHash(localFrame(reboundSwap))}),/CAPACITY_UNAVAILABLE/);
  for (const changed of [{...ps[0],extra:'x'}, {...ps[0],starterNonce:'e'.repeat(64)}, {...ps[0],eventId:'other'}]) assert.throws(() => compose([localFrame(changed),...pframes.slice(1)]),/CAPACITY_UNAVAILABLE/);
  for (const key of Object.keys(starter)) {
    const missing = {...starter}; delete missing[key];
    assert.throws(() => compose(pframes,missing),/CAPACITY_UNAVAILABLE/,key);
    assert.throws(() => compose(pframes,{...starter,[key]:null}),/CAPACITY_UNAVAILABLE/,key);
  }
  for (const key of Object.keys(service)) {
    const missing = {...service}; delete missing[key];
    assert.throws(() => compose(pframes,starter,missing),/CAPACITY_UNAVAILABLE/,key);
    assert.throws(() => compose(pframes,starter,{...service,[key]:null}),/CAPACITY_UNAVAILABLE/,key);
  }
  for (const changed of [{extra:'x'},{starterNonce:'A'.repeat(64)},{starterPid:'0'},{starterPid:'4294967296'},{starterCreationTime:'18446744073709551616'},{starterCreationTime:'01'},{bundleFrameBase64:'AA=A'},{bundleFrameBase64:'AB=='},{bundleFrameBase64:'A'.repeat(22000)}]) assert.throws(() => compose(pframes,{...starter,...changed}),/CAPACITY_UNAVAILABLE/);
  for (const changed of [{starterNonce:'e'.repeat(64)},{serviceConsumeHash:'f'.repeat(64)},{bundleFrameBase64:Buffer.from(wire.map((v,i) => i === wire.length - 1 ? v ^ 1 : v)).toString('base64')},{consumptionFrameBase64:wire.toString('base64')}]) {
    const altered = {...starter,...changed};
    assert.throws(() => compose(pframes,altered,{...service,starterReceiptHash:frameHash(localFrame(altered))}),/CAPACITY_UNAVAILABLE/);
  }
  const base64OriginalFrom = Buffer.from; let oversizedDecoded = false;
  try {
    (Buffer as any).from = (...args:any[]) => { if (typeof args[0] === 'string' && args[1] === 'base64' && args[0].length > 21948) oversizedDecoded = true; return (base64OriginalFrom as any)(...args); };
    assert.throws(() => compose(pframes,{...starter,bundleFrameBase64:'A'.repeat(22000)}),/CAPACITY_UNAVAILABLE/);
  } finally { Buffer.from = base64OriginalFrom; }
  assert.equal(oversizedDecoded,false);
  for (const [encoded, expectedCopies] of [['AB==',0],['AAB=',0],['AA==',1],['AAA=',1]] as const) {
    let decodeCopies = 0;
    try {
      (Buffer as any).from = (...args:any[]) => { if (args[0] === encoded && args[1] === 'base64') decodeCopies++; return (base64OriginalFrom as any)(...args); };
      // Canonical short values reach decoding but do not match the captured bundle.
      assert.throws(() => compose(pframes,{...starter,bundleFrameBase64:encoded}),/CAPACITY_UNAVAILABLE/);
    } finally { Buffer.from = base64OriginalFrom; }
    assert.equal(decodeCopies,expectedCopies,encoded);
  }
  assert.doesNotThrow(() => compose());
  for (const changed of [{extra:'x'},{serviceSid:'S-1-5-80-01-2-3-4-5'},{serviceSid:'S-1-5-80-4294967296-2-3-4-5'},{servicePid:'0'},{servicePid:'4294967296'},{serviceCreationTime:'0'},{serviceCreationTime:'18446744073709551616'},{serviceName:'other'},{hostIdentity:'c'.repeat(32)},{starterReceiptHash:'f'.repeat(64)}]) assert.throws(() => compose(pframes,starter,{...service,...changed}),/CAPACITY_UNAVAILABLE/);
  const swappedFrames = [...pframes]; Object.defineProperty(swappedFrames,'0',{get() { throw new Error('accessor invoked'); }});
  assert.throws(() => compose(swappedFrames),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => compose(new Proxy(pframes,{})),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => inspectStartupLocalRecordsV2(wire,cw,pframes,Buffer.alloc(65549),localFrame(service)),/CAPACITY_UNAVAILABLE/);
  assert.equal(localResult.starterReceiptHash,frameHash(sf));
  const mutable = pframes.map(x => Buffer.from(x));
  const snapshot = compose(mutable); mutable[0].fill(0);
  assert.equal(snapshot.projectionHashes[0],frameHash(pframes[0]));
  assert.equal(result.eventsHash,hash(canonical(['pro273.startup.events.v2',events])));
  assert.equal(result.coverageHash,hash(canonical(['pro273.startup.coverage.v2',coverage])));
  assert.deepEqual(Object.keys(result).sort(),['bundleHash','consumptionHash','coverageHash','eventsHash']);
  const checkRebound = (bundle:any) => inspectStartupBundleV2(frame('bundle',bundle),frame('consumption',receipt(bundle)));
  // External and SQL attempts are separate namespaces; matching text grants no authority.
  assert.doesNotThrow(() => checkRebound({...b,sqlTarget:{...b.sqlTarget,dispatchAttemptId:'sql-attempt'}}));
  assert.doesNotThrow(() => checkRebound({...b,sqlTarget:{...b.sqlTarget,dispatchAttemptId:events[3].attemptId}}));
  // Distinct closure hashes are valid data, with no authenticated association or qualification.
  assert.deepEqual(Object.keys(checkRebound({...b,sqlTarget:{...b.sqlTarget,receiverClosureHash:'b'.repeat(64)}})).sort(),['bundleHash','consumptionHash','coverageHash','eventsHash']);
  for (const [key,value] of [['issuerId','bad\0id'],['physicalIdentity','\ud800'],['issuerGeneration','18446744073709551616'],['authorityEpoch','01'],['validUntil','2026-02-30T00:00:00.000Z'],['manifestHash','A'.repeat(64)],['accountingDomain','OTHER'],['unknown','x']] as const)
    assert.throws(() => checkRebound({...b,[key]:value}),/CAPACITY_UNAVAILABLE/,key);
  for (const value of ['-1','01','18446744073709551616','1.0','+1','',1,null,true]) {
    const altered = {...b,coverage:{...coverage,limits:{...coverage.limits,readCalls:value}}};
    assert.throws(() => checkRebound(altered),/CAPACITY_UNAVAILABLE/);
  }
  for (const key of limitKeys) {
    const missing = {...coverage.limits}; delete missing[key];
    assert.throws(() => checkRebound({...b,coverage:{...coverage,limits:missing}}),/CAPACITY_UNAVAILABLE/,key);
  }
  const {limits: flatLimits,...coverageFields} = coverage;
  const withoutVersion = {...coverage}; delete withoutVersion.schemaVersion;
  for (const altered of [{...coverage,extra:'x'}, withoutVersion, {...coverage,limits:{...coverage.limits,extra:'1'}}, {...coverage,limits:null}, {...coverageFields,...flatLimits}, {...coverage,manifestHash:'b'.repeat(64)}, {...coverage,workEvidenceHash:1}, {...coverage,schemaVersion:'unqualified'}, {...coverage,schemaVersion:'pro273-startup-coverage-v1'}, {...coverage,schemaVersion:''}, {...coverage,schemaVersion:1}])
    assert.throws(() => checkRebound({...b,coverage:altered}),/CAPACITY_UNAVAILABLE/);
  for (const target of [{...b.sqlTarget,extra:'x'},{...b.sqlTarget,dispatchAttemptId:''},{...b.sqlTarget,expectedCoreHash:null}])
    assert.throws(() => checkRebound({...b,sqlTarget:target}),/CAPACITY_UNAVAILABLE/);
  for (const key of ['issuerId','issuerGeneration','bundleId','bundleHash','holderReservationId','eventsHash','coverageHash','consumedAt'])
    assert.throws(() => check(b,{...c,[key]:'wrong'}),/CAPACITY_UNAVAILABLE/,key);
  assert.throws(() => check(b,{...c,coverageHash:hash(canonical(['pro273.startup.events.v2',coverage]))}),/CAPACITY_UNAVAILABLE/);
  for (const key of ['consumptionId','issuerCommitIdentity']) assert.throws(() => check(b,{...c,[key]:''}),/CAPACITY_UNAVAILABLE/,key);
  assert.throws(() => inspectStartupBundleV2(frame('bundle',b,Buffer.alloc(64,1)),frame('consumption',c)),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => check({...b,events:events.map((e,i) => i === 2 ? {...e,parentAttemptId:'holder'} : e)}),/CAPACITY_UNAVAILABLE/);
  for (const altered of [{...b,events:events.map((e,i) => i === 2 ? {...e,externalChargeBindingHash:'b'.repeat(64)} : e)}, {...b,coverage:{...coverage,limits:{...coverage.limits,readCalls:'18446744073709551615'}}}]) {
    const alteredWire = frame('bundle',altered), rebound = receipt(altered,alteredWire);
    assert.doesNotThrow(() => inspectStartupBundleV2(alteredWire,frame('consumption',rebound)));
    assert.throws(() => inspectStartupBundleV2(alteredWire,frame('consumption',{...rebound,eventsHash:c.eventsHash,coverageHash:c.coverageHash})),/CAPACITY_UNAVAILABLE/);
  }
  // Structural inspection continues to accept correlated unsigned records as data.
  assert.equal(result.bundleHash,c.bundleHash);
  const unsignedBundle = frame('bundle',b,Buffer.alloc(64));
  assert.doesNotThrow(() => inspectStartupBundleV2(unsignedBundle,frame('consumption',receipt(b,unsignedBundle),Buffer.alloc(64))));

  // Throwaway in-memory key: these signatures establish only a byte/key match.
  const signed = (kind:'bundle'|'consumption', payload:any, domain = kind) => {
    const unsigned = frame(kind,payload);
    const preimage = Buffer.concat([Buffer.from(`pro273.startup.${domain}.v2\n`),unsigned.subarray(0,-64)]);
    return frame(kind,payload,sign(null,preimage,pair.privateKey));
  };
  const signedBundle = signed('bundle',b);
  const signedConsumption = signed('consumption',receipt(b,signedBundle));
  const verified = verifyStartupBundleV2(signedBundle,signedConsumption,key);
  assert.deepEqual(Object.keys(verified).sort(),['bundleHash','consumptionHash','coverageHash','eventsHash']);
  assert.ok(Object.isFrozen(verified));
  assert.equal(verified.bundleHash,createHash('sha256').update(signedBundle).digest('hex'));
  assert.equal(verified.consumptionHash,createHash('sha256').update(signedConsumption).digest('hex'));
  const reject = (bundle:Uint8Array = signedBundle, consumption:Uint8Array = signedConsumption, publicKey:Uint8Array = key) =>
    assert.throws(() => verifyStartupBundleV2(bundle,consumption,publicKey),/CAPACITY_UNAVAILABLE/);
  for (const which of ['bundle','consumption'] as const) {
    const original = which === 'bundle' ? signedBundle : signedConsumption;
    for (const offset of [0,8,12,original.length - 1]) {
      const altered = Buffer.from(original); altered[offset] ^= 1;
      if (which === 'bundle') reject(altered); else reject(signedBundle,altered);
    }
    const wrongDomain = signed(which,which === 'bundle' ? b : receipt(b,signedBundle),which === 'bundle' ? 'consumption' : 'bundle');
    if (which === 'bundle') reject(wrongDomain); else reject(signedBundle,wrongDomain);
    const short = original.subarray(0,-1), extra = Buffer.concat([original,Buffer.from([0])]);
    if (which === 'bundle') { reject(short); reject(extra); } else { reject(signedBundle,short); reject(signedBundle,extra); }
  }
  const otherPair = generateKeyPairSync('ed25519');
  const otherKey = otherPair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  reject(signedBundle,signedConsumption,otherKey);
  const otherConsumption = Buffer.from(signedConsumption);
  const otherPreimage = Buffer.concat([Buffer.from('pro273.startup.consumption.v2\n'),otherConsumption.subarray(0,-64)]);
  sign(null,otherPreimage,otherPair.privateKey).copy(otherConsumption,otherConsumption.length - 64);
  reject(signedBundle,otherConsumption);
  reject(signedBundle,signed('consumption',{...receipt(b,signedBundle),bundleHash:'f'.repeat(64)}));
  for (const [original,needle,which] of [[signedBundle,'"issuerId":"issuer"','bundle'],[signedConsumption,'"consumptionId":"consumption"','consumption']] as const) {
    const altered = Buffer.from(original), offset = altered.indexOf(needle);
    assert.ok(offset >= 0);
    altered[offset + needle.length - 2] ^= 1; // Still canonical JSON and a valid identifier.
    if (which === 'bundle') reject(altered); else reject(signedBundle,altered);
  }
  reject(signedBundle,signedConsumption,key.subarray(1));
  reject(signedBundle,signedConsumption,Buffer.concat([key,Buffer.from([0])]));
  const spoofedKey = new Uint8Array(31); Object.defineProperty(spoofedKey,'byteLength',{value:32});
  reject(signedBundle,signedConsumption,spoofedKey);
  const resizableKey = new ArrayBuffer(32,{maxByteLength:64});
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get?.call(resizableKey)) reject(signedBundle,signedConsumption,new Uint8Array(resizableKey));
  const sharedKey = new Uint8Array(new SharedArrayBuffer(32)); sharedKey.set(key);
  Object.defineProperty(sharedKey,'buffer',{value:new ArrayBuffer(32)});
  reject(signedBundle,signedConsumption,sharedKey);
  for (const which of ['bundle','consumption'] as const) {
    const original = which === 'bundle' ? signedBundle : signedConsumption;
    const shared = new Uint8Array(new SharedArrayBuffer(original.length)); shared.set(original);
    Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(original.length)});
    if (which === 'bundle') reject(shared); else reject(signedBundle,shared);
  }
  reject(new Proxy(signedBundle,{}));
  let touched = false;
  class HostileBytes extends Uint8Array {
    override get byteLength() { touched = true; throw new Error('getter'); }
    override get byteOffset() { touched = true; throw new Error('getter'); }
    override get buffer(): ArrayBuffer { touched = true; throw new Error('getter'); }
    override [Symbol.iterator](): Uint8Array<ArrayBufferLike>[typeof Symbol.iterator] { touched = true; throw new Error('iterator'); }
  }
  const hostile = new HostileBytes(new ArrayBuffer(key.length)); Uint8Array.prototype.set.call(hostile,key);
  assert.deepEqual(verifyStartupBundleV2(signedBundle,signedConsumption,hostile),verified);
  assert.equal(touched,false);
  const originalFrom = Buffer.from; let copies = 0;
  try {
    (Buffer as any).from = (...args:any[]) => { copies++; return (originalFrom as any)(...args); };
    reject(signedBundle,signedConsumption,sharedKey);
  } finally { Buffer.from = originalFrom; }
  assert.equal(copies,0,'all input storage is validated before copying');
  const oldHash = verified.bundleHash;
  signedBundle.fill(0); signedConsumption.fill(0); key.fill(0);
  assert.equal(verified.bundleHash,oldHash);
  for (const stage of ['PAIR_CONSTRUCTOR','DESCRIPTOR_CONSTRUCTOR'] as const)
    assert.throws(() => installerFixedSqlFrame(stage,'expectation','nonce',Buffer.from('x'),10000n,10000n),/CAPACITY_UNAVAILABLE/);

  const distinctBundle = {...b,serviceReceiverClosureHash:'b'.repeat(64),sourceClosureHash:'d'.repeat(64),authorityEpoch:'18446744073709551615',installationGeneration:'2',sqlTarget:{...b.sqlTarget,receiverClosureHash:'c'.repeat(64)}};
  const decoded = inspectStartupSignedFrame(frame('bundle',distinctBundle),'bundle').payload;
  const binding:any = {schemaVersion:'pro273-startup-receiver-binding-v2',serviceReceiverClosureHash:'b'.repeat(64),sqlReceiverClosureHash:'c'.repeat(64),sourceClosureHash:'d'.repeat(64),installationClosureHash:'e'.repeat(64),authorityEpoch:'18446744073709551615',installationGeneration:'2'};
  const correlate = (value:any = binding, bundle:any = decoded, installation:any = 'e'.repeat(64)) => inspectStartupReceiverBindingV2(value,bundle,installation);
  const captured = correlate();
  assert.deepEqual({...captured},binding);
  assert.ok(Object.isFrozen(captured));
  assert.deepEqual(Object.keys(captured).sort(),Object.keys(binding).sort()); // No authority result.
  for (const stage of ['PAIR_CONSTRUCTOR','DESCRIPTOR_CONSTRUCTOR'] as const)
    assert.throws(() => installerFixedSqlFrame(stage,'expectation','nonce',Buffer.from('x'),10000n,10000n),/CAPACITY_UNAVAILABLE/);
  for (const altered of [
    {...binding,serviceReceiverClosureHash:binding.sqlReceiverClosureHash,sqlReceiverClosureHash:binding.serviceReceiverClosureHash},
    ...['serviceReceiverClosureHash','sqlReceiverClosureHash','sourceClosureHash','installationClosureHash'].map(key => ({...binding,[key]:'f'.repeat(64)})),
    {...binding,authorityEpoch:'1'}, {...binding,installationGeneration:'3'}, {...binding,extra:'x'}, {...binding,sourceClosureHash:null},
    {...binding,schemaVersion:'pro273-startup-receiver-binding-v1'}, {...binding,sourceClosureHash:'\ud800'}, {...binding,sourceClosureHash:'A'.repeat(64)}
  ]) assert.throws(() => correlate(altered),/CAPACITY_UNAVAILABLE/);
  for (const key of Object.keys(binding)) {
    const missing = {...binding}; delete missing[key];
    assert.throws(() => correlate(missing),/CAPACITY_UNAVAILABLE/,key);
  }
  for (const value of ['0','01','-1','+1','1.0','18446744073709551616','',1,null,true,'\ud800'])
    for (const key of ['authorityEpoch','installationGeneration']) assert.throws(() => correlate({...binding,[key]:value}),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => correlate(binding,decoded,'f'.repeat(64)),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => correlate(binding,decoded,null),/CAPACITY_UNAVAILABLE/);
  for (const altered of [{...distinctBundle,sourceClosureHash:'f'.repeat(64)}, {...distinctBundle,authorityEpoch:'1'}, {...distinctBundle,installationGeneration:'3'}, {...distinctBundle,serviceReceiverClosureHash:'c'.repeat(64)}, {...distinctBundle,sqlTarget:{...distinctBundle.sqlTarget,receiverClosureHash:'b'.repeat(64)}}])
    assert.throws(() => correlate(binding,altered),/CAPACITY_UNAVAILABLE/);
  let invoked = false;
  const accessor = {...binding}; Object.defineProperty(accessor,'sourceClosureHash',{enumerable:true,get() { invoked = true; return binding.sourceClosureHash; }});
  assert.throws(() => correlate(accessor),/CAPACITY_UNAVAILABLE/);
  const targetAccessor = {...distinctBundle.sqlTarget}; Object.defineProperty(targetAccessor,'receiverClosureHash',{enumerable:true,get() { invoked = true; return binding.sqlReceiverClosureHash; }});
  assert.throws(() => correlate(binding,{...distinctBundle,sqlTarget:targetAccessor}),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => correlate(new Proxy(binding,{})),/CAPACITY_UNAVAILABLE/);
  assert.equal(invoked,false);
  binding.sourceClosureHash = 'f'.repeat(64);
  distinctBundle.sqlTarget.receiverClosureHash = 'f'.repeat(64);
  assert.equal(captured.sourceClosureHash,'d'.repeat(64));
  assert.equal(captured.sqlReceiverClosureHash,'c'.repeat(64));
});

test('startup v2 inert framing rejects malformed bytes and binds domains and full frames', () => {
  const make = (magic:string, json:string, suffix = Buffer.alloc(64)) => {
    const body = Buffer.from(json); const header = Buffer.alloc(12);
    header.write(magic, 0, 'ascii'); header.writeUInt32LE(body.length, 8);
    return Buffer.concat([header, body, suffix]);
  };
  const frame = make('P273B002', '{"events":[{"id":"a"}],"version":"2"}');
  const inspected = inspectStartupSignedFrame(frame, 'bundle');
  assert.equal(inspected.frameHash, createHash('sha256').update(frame).digest('hex'));
  assert.equal(inspected.preimageHex, Buffer.concat([Buffer.from('pro273.startup.bundle.v2\n'), frame.subarray(0,-64)]).toString('hex'));
  assert.equal(inspected.signatureHex, '00'.repeat(64));
  frame[frame.length - 1] = 1;
  assert.notEqual(inspectStartupSignedFrame(frame, 'bundle').frameHash, inspected.frameHash);
  const receipt = make('P273C002', '{"id":"a"}');
  assert.equal(inspectStartupSignedFrame(receipt, 'consumption').preimageHex, Buffer.concat([Buffer.from('pro273.startup.consumption.v2\n'), receipt.subarray(0,-64)]).toString('hex'));
  for (const bad of [make('P273B002','{"x":"1","x":"2"}'), make('P273B002','{"x":"1","\\u0078":"2"}'), make('P273B002','{"x":1}'), make('P273B002','{"z":"1","a":"2"}'), make('P273B002','{"x":"1"} '), make('P273B002','{"x":"1"}',Buffer.alloc(63)), Buffer.concat([receipt,Buffer.from([0])]), make('P273B002',`{"x":"${'a'.repeat(16385)}"}`), Buffer.from([0])]) assert.throws(() => inspectStartupSignedFrame(bad,'bundle'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => inspectStartupSignedFrame(receipt,'bundle'), /CAPACITY_UNAVAILABLE/);
  const invalidUtf8 = make('P273B002','{"x":"a"}'); invalidUtf8[18] = 0xff;
  assert.throws(() => inspectStartupSignedFrame(invalidUtf8,'bundle'), /CAPACITY_UNAVAILABLE/);
  const overlength = Buffer.from(receipt); overlength.writeUInt32LE(0xffffffff,8);
  assert.throws(() => inspectStartupSignedFrame(overlength,'consumption'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => inspectStartupSignedFrame(new Uint8Array(new SharedArrayBuffer(76)),'bundle'), /CAPACITY_UNAVAILABLE/);
  // Generic framing deliberately does not impose a closed payload's scalar rules.
  for (const json of ['{"x":"\\u0000"}', '{"x":"\\ud800"}']) assert.doesNotThrow(() => inspectStartupSignedFrame(make('P273B002',json),'bundle'));
});

test('startup v2 inert framing validates intrinsic storage before copying', () => {
  const header = Buffer.alloc(12); header.write('P273B002'); header.writeUInt32LE(2,8);
  const frame = Buffer.concat([header,Buffer.from('{}'),Buffer.alloc(64)]);
  let accessed = false;
  class Hostile extends Uint8Array {
    override get byteLength() { accessed = true; throw new Error('byteLength getter'); }
    override get byteOffset() { accessed = true; throw new Error('byteOffset getter'); }
    override get buffer(): ArrayBuffer { accessed = true; throw new Error('buffer getter'); }
    override [Symbol.iterator](): Uint8Array<ArrayBufferLike>[typeof Symbol.iterator] { accessed = true; throw new Error('iterator'); }
  }
  const backing = new ArrayBuffer(frame.length + 4);
  const view = new Hostile(backing,2,frame.length); Uint8Array.prototype.set.call(view,frame);
  assert.equal(inspectStartupSignedFrame(view,'bundle').frameHash,createHash('sha256').update(frame).digest('hex'));
  assert.equal(accessed,false);
  const oversized = new Uint8Array(16384 + 77);
  Object.defineProperties(oversized,{byteLength:{value:76},buffer:{value:new ArrayBuffer(76)}});
  const shared = new Uint8Array(new SharedArrayBuffer(76));
  Object.defineProperty(shared,'buffer',{value:new ArrayBuffer(76)});
  const small = new Uint8Array(1);
  Object.defineProperty(small,'byteLength',{value:76});
  const invalid = [oversized,shared,small];
  const resizable = new ArrayBuffer(76,{maxByteLength:100});
  if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,'resizable')?.get?.call(resizable)) invalid.push(new Uint8Array(resizable));
  const originalFrom = Buffer.from;
  let copies = 0;
  try {
    (Buffer as any).from = (...args: any[]) => { copies++; return (originalFrom as any)(...args); };
    for (const bytes of invalid) assert.throws(() => inspectStartupSignedFrame(bytes,'bundle'), /CAPACITY_UNAVAILABLE/);
  } finally { Buffer.from = originalFrom; }
  assert.equal(copies,0,'invalid storage rejected before Buffer.from');
});

test('startup v2 inert event chain rejects reuse and broken parent joins', () => {
  const kinds = ['SERVICE_START','NODE_LAUNCH','PSQL_LAUNCH','CONSTRUCTOR_DISPATCH'];
  const events = kinds.map((kind,i) => ({kind,attemptId:`a${i}`,parentAttemptId:i ? `a${i-1}` : 'holder',eventId:`e${i}`,externalChargeId:`c${i}`,externalChargeBindingHash:'a'.repeat(64),fenceId:`f${i}`}));
  assert.doesNotThrow(() => inspectStartupEvents(events,'holder'));
  for (const key of ['attemptId','eventId','externalChargeId','fenceId'] as const) {
    const bad = events.map(e => ({...e})); bad[3][key] = bad[2][key];
    assert.throws(() => inspectStartupEvents(bad,'holder'), /CAPACITY_UNAVAILABLE/, key);
  }
  for (const key of ['attemptId','eventId','externalChargeId','fenceId'] as const) {
    for (const other of ['attemptId','eventId','externalChargeId','fenceId'] as const) {
      if (key === other) continue;
      for (const index of [0,3]) {
        const bad = events.map(e => ({...e})); bad[index][key] = bad[0][other];
        assert.throws(() => inspectStartupEvents(bad,'holder'), /CAPACITY_UNAVAILABLE/, `${key}/${other}/${index}`);
      }
    }
    const bad = events.map(e => ({...e})); bad[3][key] = 'holder';
    assert.throws(() => inspectStartupEvents(bad,'holder'), /CAPACITY_UNAVAILABLE/, `${key}/holder`);
  }
  for (const bad of [events.slice(1), events.map((e,i) => i === 2 ? {...e,parentAttemptId:'holder'} : e), events.map((e,i) => i === 0 ? {...e,kind:'NODE_LAUNCH'} : e), events.map((e,i) => i === 1 ? {...e,extra:'x'} : e), events.map((e,i) => i === 1 ? {...e,externalChargeBindingHash:'X'} : e)]) assert.throws(() => inspectStartupEvents(bad,'holder'), /CAPACITY_UNAVAILABLE/);
  const extra = [...events] as typeof events & {extra?: string}; extra.extra = 'x';
  assert.throws(() => inspectStartupEvents(extra,'holder'), /CAPACITY_UNAVAILABLE/);
  const getter = [...events]; Object.defineProperty(getter,'0',{get() { throw new Error('getter called'); }});
  assert.throws(() => inspectStartupEvents(getter,'holder'), /CAPACITY_UNAVAILABLE/);
});

test('v2 byte adapter owns fragments and enforces write and EOF barriers', () => {
  const h = (s:string) => createHash('sha256').update(s).digest('hex');
  const canonical = (v:any):string => typeof v === 'string' ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const binding = {nonce:'a'.repeat(64),serviceStartId:'service',nodeLaunchId:'node',psqlAttemptId:'psql',servicePid:'1',serviceCreationTime:'2',nodePid:'3',nodeCreationTime:'4',bootIdentity:'b'.repeat(32),qualificationHash:'c'.repeat(64)};
  const limits = {maxFrames:8n,maxEnvelopeBytes:5000n,maxReceiptBytes:1024n};
  const snapshot = {psqlPid:'5',psqlCreationTime:'6',psqlImageHash:'d'.repeat(64),nodePid:'3',nodeCreationTime:'4',bootIdentity:binding.bootIdentity,qualificationHash:binding.qualificationHash,nonce:binding.nonce};
  const snapshotHash = h('["pro273.installer.psql-snapshot.v2",'+canonical(snapshot)+']');
  const delivery = {deliveryReceiptHash:h('x'),inputHash:'f'.repeat(64),inputLength:'1'};
  const stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','PSQL_AUTHENTICATED','DISPATCH_CHECK','DISPATCH_CURRENT','OUTCOME'];
  const payloads = [{},{permitHash:'e'.repeat(64)},{permitHash:'e'.repeat(64),psqlFenceId:'fence'},{psqlPid:'5'},{snapshot,snapshotHash},{...delivery,deliveryReceiptBase64:'eA=='},{...delivery,snapshotHash},{status:'UNKNOWN',receiptFrameBase64:null,receiptFrameHash:null}];
  const wires = stages.map((stage,i) => encodeInstallerChannelV2({schemaVersion:'pro273-installer-channel-v2',...binding,stage,sequence:String(i+1),payload:payloads[i]},limits));
  const make = (ops=5000,zero=2) => installerChannelV2ByteAdapter(binding,limits,ops,zero);
  for (let split=0; split<=wires[0].length; split++) {
    const s=make(); assert.equal(s.feed(wires[0].subarray(0,split),'SERVICE'),split);
    if (split<wires[0].length) assert.equal(s.feed(wires[0].subarray(split),'SERVICE'),wires[0].length-split);
    assert.deepEqual(s.offer('SERVICE',wires[0].length).bytes,wires[0]);
  }
  const state = make();
  for (let i=0;i<8;i++) {
    const direction = i%2 ? 'NODE' : 'SERVICE';
    const withSuffix = i < 6 ? Buffer.concat([wires[i],Buffer.from([99,98])]) : Buffer.from(wires[i]);
    for (let j=0;j<4;j++) assert.equal(state.feed(withSuffix.subarray(j,j+1),direction),1);
    assert.equal(state.feed(withSuffix.subarray(4),direction),wires[i].length-4);
    withSuffix.fill(0);
    let written=0;
    while (written<wires[i].length) {
      const offer = state.offer(direction,17), part = offer.bytes, expected = wires[i].subarray(written,written+part.length);
      assert.deepEqual(part,expected); const n = Math.min(7,part.length); part.fill(0); state.ack(direction,offer.ticket,n); written+=n;
    }
    if (i===4) state.modeledSqlWork();
    if (i===6) assert.equal(state.eof('SERVICE',true),'AWAITING_OUTCOME');
  }
  assert.equal(state.eof('NODE',true),'UNKNOWN');
  assert.throws(() => state.eof('NODE',true),/CAPACITY_UNAVAILABLE/);
  const advanceTo = (end:number, stopAtServiceEof=false) => {
    const s=make();
    for (let i=0;i<end;i++) {
      const d=i%2?'NODE':'SERVICE';
      assert.equal(s.feed(wires[i],d),wires[i].length);
      const o=s.offer(d,4096); s.ack(d,o.ticket,o.bytes.length);
      if (i===4) s.modeledSqlWork();
      if (i===6 && !stopAtServiceEof) assert.equal(s.eof('SERVICE',true),'AWAITING_OUTCOME');
    }
    return s;
  };
  for (const i of [6,7]) {
    const d=i%2?'NODE':'SERVICE';
    for (const suffix of [Buffer.from([0]), wires[0]]) {
      const s=advanceTo(i), split=wires[i].length-1;
      assert.equal(s.feed(wires[i].subarray(0,split),d),split);
      assert.throws(() => s.feed(Buffer.concat([wires[i].subarray(split),suffix]),d),/CAPACITY_UNAVAILABLE/);
      assert.throws(() => s.offer(d,4096),/CAPACITY_UNAVAILABLE/);
      assert.throws(() => s.eof(d,true),/CAPACITY_UNAVAILABLE/);
    }
    for (const invalid of [1, 'true', {}, false, null, undefined]) {
      const s=advanceTo(i+1,i===6);
      // Exercise the runtime boundary with values TypeScript callers cannot pass normally.
      assert.throws(() => s.eof(d,invalid as boolean),/CAPACITY_UNAVAILABLE/);
      assert.throws(() => s.eof(d,true),/CAPACITY_UNAVAILABLE/);
    }
  }
  const badPrefix = make(); assert.throws(() => badPrefix.feed(Buffer.from([0xff,0xff,0xff,0xff]),'SERVICE'),/CAPACITY_UNAVAILABLE/);
  const emptyPrefix = make(); assert.throws(() => emptyPrefix.feed(Buffer.alloc(4),'SERVICE'),/CAPACITY_UNAVAILABLE/);
  assert.throws(() => badPrefix.feed(wires[0],'SERVICE'),/CAPACITY_UNAVAILABLE/);
  const short = make(); short.feed(wires[0].subarray(0,3),'SERVICE'); assert.throws(() => short.eof('SERVICE',true),/CAPACITY_UNAVAILABLE/);
  const barrier = make(); assert.equal(barrier.feed(Buffer.concat([wires[0],wires[1]]),'SERVICE'),wires[0].length);
  assert.throws(() => barrier.feed(wires[1],'NODE'),/CAPACITY_UNAVAILABLE/);
  const retained=make(), coalesced=Buffer.concat([wires[0],wires[1]]);
  const consumed=retained.feed(coalesced,'SERVICE'); assert.equal(consumed,wires[0].length);
  const first=retained.offer('SERVICE',4096); retained.ack('SERVICE',first.ticket,first.bytes.length);
  assert.equal(retained.feed(coalesced.subarray(consumed),'NODE'),wires[1].length);
  assert.deepEqual(retained.offer('NODE',4096).bytes,wires[1]);
  const beforeSql=make();
  for (let i=0;i<5;i++) { const d=i%2?'NODE':'SERVICE'; beforeSql.feed(wires[i],d); if (i<4) { const o=beforeSql.offer(d,4096); beforeSql.ack(d,o.ticket,o.bytes.length); } }
  assert.throws(() => beforeSql.modeledSqlWork(),/CAPACITY_UNAVAILABLE/);
  const earlyEof=make(); assert.throws(() => earlyEof.eof('SERVICE',false),/CAPACITY_UNAVAILABLE/);
  for (const action of [(s:ReturnType<typeof make>) => s.ack('SERVICE',1,1), (s:ReturnType<typeof make>) => { const o=s.offer('SERVICE',5); s.ack('SERVICE',o.ticket,6); }, (s:ReturnType<typeof make>) => { const o=s.offer('SERVICE',5); s.ack('NODE',o.ticket,1); }, (s:ReturnType<typeof make>) => { const o=s.offer('SERVICE',5); s.ack('SERVICE',o.ticket,1); s.offer('SERVICE',5); s.ack('SERVICE',o.ticket,1); }]) {
    const s=make(); s.feed(wires[0],'SERVICE'); assert.throws(() => action(s),/CAPACITY_UNAVAILABLE/); assert.throws(() => s.offer('SERVICE',1),/CAPACITY_UNAVAILABLE/);
  }
  const zeros=make(100,1); zeros.feed(wires[0],'SERVICE'); const z1=zeros.offer('SERVICE',1); zeros.ack('SERVICE',z1.ticket,0); const z2=zeros.offer('SERVICE',1); assert.throws(() => zeros.ack('SERVICE',z2.ticket,0),/CAPACITY_UNAVAILABLE/);
  const exhausted=make(1); exhausted.feed(wires[0],'SERVICE'); assert.throws(() => exhausted.offer('SERVICE',1),/CAPACITY_UNAVAILABLE/);
  const proxied=make(); assert.throws(() => proxied.feed(new Proxy(wires[0],{}),'SERVICE'),/CAPACITY_UNAVAILABLE/);
  const shared=make(); assert.throws(() => shared.feed(new Uint8Array(new SharedArrayBuffer(4)),'SERVICE'),/CAPACITY_UNAVAILABLE/);
  const reentry=make(); const alloc=Buffer.alloc;
  try { Buffer.alloc = ((...args:unknown[]) => { try { reentry.feed(wires[0],'SERVICE'); } catch {} return (alloc as Function)(...args); }) as typeof Buffer.alloc; assert.throws(() => reentry.feed(wires[0],'SERVICE'),/CAPACITY_UNAVAILABLE/); } finally { Buffer.alloc=alloc; }
  assert.throws(() => reentry.offer('SERVICE',1),/CAPACITY_UNAVAILABLE/);
});

test('v2 native adapter remains disconnected and delegates complete frames to the validator', () => {
  const source=readFileSync(join(process.cwd(),'services/enta/server/native/pro273-primitives/pro273_primitives.cpp'),'utf8');
  const adapter=source.split('class ChannelV2ByteAdapter {')[1].split('// No independent limit-to-holder mapping')[0];
  assert.ok(adapter.includes('exchange_.accept(frame_,target_,direction,q,e)'));
  assert.ok(adapter.includes('exchange_.ack(next_+1)'));
  assert.ok(adapter.includes('ticket!=ticket_'));
  assert.ok(adapter.includes('next_==5 ? State::sql : next_==7 ? State::service_eof : next_==8 ? State::node_eof'));
  assert.ok(adapter.includes('exchange_.eof(direction,true,0)'));
  assert.match(adapter,/if \(target_ && used_==target_\) \{\s*if \(next_>=6 && \*consumed<size\) return fail\(\);\s*if \(!exchange_\.accept/);
  assert.doesNotMatch(adapter,/ReadFile|WriteFile|CreateFile|HANDLE|SQLExec/);
  assert.match(source,/status\.dwServiceSpecificExitCode = ERROR_ACCESS_DENIED/);
});

test('v2 limits are own data snapshots and preflight precedes canonical work and receipt allocation', () => {
  const binding = {nonce:'a'.repeat(64),serviceStartId:'service',nodeLaunchId:'node',psqlAttemptId:'psql',servicePid:'1',serviceCreationTime:'2',nodePid:'3',nodeCreationTime:'4',bootIdentity:'b'.repeat(32),qualificationHash:'c'.repeat(64)};
  const limits = {maxFrames:8n,maxEnvelopeBytes:4096n,maxReceiptBytes:1024n};
  const hello = {schemaVersion:'pro273-installer-channel-v2',...binding,stage:'HELLO',sequence:'1',payload:{}};
  const wire = encodeInstallerChannelV2(hello, limits);
  const retained = {...limits}, conversation = installerChannelV2Conversation(binding,retained);
  retained.maxEnvelopeBytes = 5n;
  conversation.accept(wire,'SERVICE');
  let reads = 0;
  const getter = {...limits, get maxEnvelopeBytes() { reads++; return reads === 1 ? 4096n : 5n; }};
  for (const invoke of [() => encodeInstallerChannelV2(hello,getter), () => decodeInstallerChannelV2(wire,getter), () => installerChannelV2Conversation(binding,getter)]) assert.throws(invoke, /CAPACITY_UNAVAILABLE/);
  assert.equal(reads, 0);
  for (const bad of [new Proxy(limits, {}), {...limits, extra:1n}, Object.defineProperty({...limits}, Symbol('extra'), {value:1})]) {
    assert.throws(() => encodeInstallerChannelV2(hello,bad), /CAPACITY_UNAVAILABLE/);
  }
  const snapshot = {psqlPid:'5',psqlCreationTime:'6',psqlImageHash:'d'.repeat(64),nodePid:'3',nodeCreationTime:'4',bootIdentity:binding.bootIdentity,qualificationHash:binding.qualificationHash,nonce:binding.nonce};
  const frame = {...hello,stage:'PSQL_AUTHENTICATED',sequence:'5',payload:{snapshot,snapshotHash:'e'.repeat(64)}};
  const receipt = {...hello,stage:'DISPATCH_CHECK',sequence:'6',payload:{deliveryReceiptBase64:'YR==',deliveryReceiptHash:'d'.repeat(64),inputHash:'e'.repeat(64),inputLength:'1'}};
  const canonicalize = (v: any): string => v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
  const text = canonicalize(receipt), malformed = Buffer.alloc(4 + Buffer.byteLength(text));
  malformed.writeUInt32LE(malformed.length - 4); malformed.write(text,4);
  const originalStringify = JSON.stringify, originalFrom = Buffer.from, originalAlloc = Buffer.alloc;
  let canonical = 0, allocations = 0, decodedAllocations = 0;
  try {
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => { canonical++; return originalStringify(...args); }) as typeof JSON.stringify;
    Buffer.from = ((...args:unknown[]) => { allocations++; if (args[1] === 'base64') decodedAllocations++; return (originalFrom as Function)(...args); }) as typeof Buffer.from;
    Buffer.alloc = ((...args:unknown[]) => { allocations++; return (originalAlloc as Function)(...args); }) as typeof Buffer.alloc;
    assert.throws(() => encodeInstallerChannelV2(frame,{...limits,maxEnvelopeBytes:100n}), /CAPACITY_UNAVAILABLE/);
    assert.equal(canonical, 0); assert.equal(allocations, 0);
    assert.throws(() => encodeInstallerChannelV2(receipt,limits), /CAPACITY_UNAVAILABLE/);
    assert.equal(allocations, 0);
    assert.throws(() => decodeInstallerChannelV2(malformed,limits), /CAPACITY_UNAVAILABLE/);
    assert.equal(decodedAllocations, 0);
  } finally { JSON.stringify = originalStringify; Buffer.from = originalFrom; Buffer.alloc = originalAlloc; }
  const exact = BigInt(wire.length);
  assert.deepEqual(encodeInstallerChannelV2(hello,{...limits,maxEnvelopeBytes:exact}),wire);
  assert.throws(() => encodeInstallerChannelV2(hello,{...limits,maxEnvelopeBytes:exact-1n}), /CAPACITY_UNAVAILABLE/);
});

test('v2 disconnected conversation enforces authentication barrier, correlation and EOF', () => {
  const h = (s: string) => createHash('sha256').update(s).digest('hex');
  const canonical = (v: any): string => v === null ? 'null' : typeof v === 'string' ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const binding = {nonce:'a'.repeat(64),serviceStartId:'service',nodeLaunchId:'node',psqlAttemptId:'psql',servicePid:'1',serviceCreationTime:'2',nodePid:'3',nodeCreationTime:'4',bootIdentity:'b'.repeat(32),qualificationHash:'c'.repeat(64)};
  const limits = {maxFrames:8n,maxEnvelopeBytes:4096n,maxReceiptBytes:1024n};
  const snapshot = {psqlPid:'5',psqlCreationTime:'6',psqlImageHash:'d'.repeat(64),nodePid:'3',nodeCreationTime:'4',bootIdentity:binding.bootIdentity,qualificationHash:binding.qualificationHash,nonce:binding.nonce};
  const snapshotHash = h('["pro273.installer.psql-snapshot.v2",' + canonical(snapshot) + ']');
  const receipt = Buffer.from('retained bytes\n'), receiptHash = h(receipt.toString());
  const stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','PSQL_AUTHENTICATED','DISPATCH_CHECK','DISPATCH_CURRENT','OUTCOME'];
  const delivery = {deliveryReceiptHash:receiptHash,inputHash:'f'.repeat(64),inputLength:'7'};
  const payloads = [{},{permitHash:'e'.repeat(64)},{permitHash:'e'.repeat(64),psqlFenceId:'fence'},{psqlPid:'5'},{snapshot,snapshotHash},{...delivery,deliveryReceiptBase64:receipt.toString('base64')},{...delivery,snapshotHash},{status:'UNKNOWN',receiptFrameBase64:null,receiptFrameHash:null}];
  const wire = (i:number, payload:unknown = payloads[i]) => encodeInstallerChannelV2({schemaVersion:'pro273-installer-channel-v2',...binding,stage:stages[i],sequence:String(i+1),payload},limits);
  const feed = (state:ReturnType<typeof installerChannelV2Conversation>, end:number) => { for (let i=0;i<end;i++) state.accept(wire(i), i%2 ? 'NODE':'SERVICE'); };
  const early = installerChannelV2Conversation(binding,limits); feed(early,4);
  assert.throws(() => early.modeledSqlWork(), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => early.accept(wire(4),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  const earlyEof = installerChannelV2Conversation(binding,limits); feed(earlyEof,4);
  assert.equal(earlyEof.serviceHalfClose(),'UNKNOWN'); assert.throws(() => earlyEof.accept(wire(4),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  const state = installerChannelV2Conversation(binding,limits); feed(state,5); state.modeledSqlWork();
  state.accept(wire(5),'NODE'); state.accept(wire(6),'SERVICE'); assert.equal(state.serviceHalfClose(),'AWAITING_OUTCOME'); state.accept(wire(7),'NODE');
  assert.equal(state.nodeEof(),'UNKNOWN'); assert.throws(() => state.nodeEof(), /CAPACITY_UNAVAILABLE/);
  const noEof = installerChannelV2Conversation(binding,limits); feed(noEof,5); noEof.modeledSqlWork(); noEof.accept(wire(5),'NODE'); noEof.accept(wire(6),'SERVICE');
  assert.equal(noEof.abort(),'UNKNOWN'); assert.throws(() => noEof.serviceHalfClose(), /CAPACITY_UNAVAILABLE/);
  const noHalf = installerChannelV2Conversation(binding,limits); feed(noHalf,5); noHalf.modeledSqlWork(); noHalf.accept(wire(5),'NODE'); noHalf.accept(wire(6),'SERVICE');
  assert.throws(() => noHalf.accept(wire(7),'NODE'), /CAPACITY_UNAVAILABLE/);
  const bad = installerChannelV2Conversation(binding,limits); feed(bad,5); bad.modeledSqlWork(); bad.accept(wire(5),'NODE');
  assert.throws(() => bad.accept(wire(6,{...delivery,snapshotHash:'0'.repeat(64)}),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => bad.accept(wire(6),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  assert.equal(decodeInstallerChannelV2(wire(4),limits).stage,'PSQL_AUTHENTICATED');
  assert.throws(() => encodeInstallerChannelV2({schemaVersion:'pro273-installer-channel-v2',...binding,stage:'OUTCOME',sequence:'8',payload:{status:'UNKNOWN',receiptFrameBase64:'',receiptFrameHash:null}},limits), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => encodeInstallerChannelV2({schemaVersion:'pro273-installer-channel-v2',...binding,stage:'DISPATCH_CHECK',sequence:'6',payload:{...delivery,deliveryReceiptBase64:'YR=='}},limits), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => decodeInstallerChannelV2(wire(0),{...limits,maxFrames:7n}), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => decodeInstallerChannelV2(wire(0),{...limits,maxEnvelopeBytes:BigInt(wire(0).length-1)}), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => decodeInstallerChannelV2(encodeInstallerChannelFrame(binding,'HELLO',{},4096n),limits), /CAPACITY_UNAVAILABLE/);
  const committed = installerChannelV2Conversation(binding,limits); feed(committed,5); committed.modeledSqlWork(); committed.accept(wire(5),'NODE'); committed.accept(wire(6),'SERVICE'); committed.serviceHalfClose();
  committed.accept(wire(7,{status:'COMMITTED',receiptFrameBase64:receipt.toString('base64'),receiptFrameHash:receiptHash}),'NODE');
  assert.equal(committed.nodeEof(),'UNVERIFIED_COMMITTED');
  const wrongSender = installerChannelV2Conversation(binding,limits);
  assert.throws(() => wrongSender.accept(wire(0),'NODE'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => wrongSender.accept(wire(0),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  const altered = installerChannelV2Conversation(binding,limits); feed(altered,4);
  assert.throws(() => altered.accept(wire(4,{snapshot:{...snapshot,psqlPid:'9'},snapshotHash:h('["pro273.installer.psql-snapshot.v2",' + canonical({...snapshot,psqlPid:'9'}) + ']')}),'SERVICE'), /CAPACITY_UNAVAILABLE/);
  const mutable = installerChannelV2Conversation(binding,limits); feed(mutable,5); snapshot.psqlPid = '9'; mutable.modeledSqlWork(); mutable.accept(wire(5),'NODE'); mutable.accept(wire(6),'SERVICE');
  assert.equal(mutable.abort(),'UNKNOWN'); snapshot.psqlPid = '5';
  const raw = wire(0), extra = Buffer.concat([raw,Buffer.from([0])]);
  assert.throws(() => decodeInstallerChannelV2(extra,limits), /CAPACITY_UNAVAILABLE/);
  const duplicateText = '{"schemaVersion":"pro273-installer-channel-v2","schemaVersion":"pro273-installer-channel-v2"}';
  const duplicate = Buffer.alloc(4 + Buffer.byteLength(duplicateText)); duplicate.writeUInt32LE(duplicate.length-4); duplicate.write(duplicateText,4);
  assert.throws(() => decodeInstallerChannelV2(duplicate,limits), /CAPACITY_UNAVAILABLE/);
  const originalFrom = Buffer.from, originalAlloc = Buffer.alloc; let allocations = 0;
  try {
    Buffer.from = ((...args:unknown[]) => { allocations++; return (originalFrom as Function)(...args); }) as typeof Buffer.from;
    Buffer.alloc = ((...args:unknown[]) => { allocations++; return (originalAlloc as Function)(...args); }) as typeof Buffer.alloc;
    assert.throws(() => encodeInstallerChannelV2({schemaVersion:'pro273-installer-channel-v2',...binding,stage:'DISPATCH_CHECK',sequence:'6',payload:{...delivery,deliveryReceiptBase64:receipt.toString('base64')}},{...limits,maxEnvelopeBytes:100n}), /CAPACITY_UNAVAILABLE/);
    assert.equal(allocations,0);
  } finally { Buffer.from = originalFrom; Buffer.alloc = originalAlloc; }
});

test('decoder preflight is disconnected arithmetic with terminal denial', () => {
  // Inert source inspection and an independent integer model; no SQL is executed.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_decoder_resource_preflight(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC)';
  const body = sql.split('CREATE FUNCTION public.pro273_decoder_resource_preflight(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  for (const expression of ['p_end-p_start-2::NUMERIC', 'p_b+4::NUMERIC', '4::NUMERIC*v_u+4::NUMERIC', '2::NUMERIC*v_u+4::NUMERIC', 'LEAST(1073741823::NUMERIC,p_allocation,p_largest)', '(8::NUMERIC*p_b+32::NUMERIC)*v_r', 'v_writes:=2::NUMERIC*v_u', 'v_copies:=v_writes*v_d', '2::NUMERIC*v_r+v_raw+v_copies+2::NUMERIC*v_h+4::NUMERIC*v_d', 'v_work:=v_raw+v_copies+2::NUMERIC*v_h+4::NUMERIC*v_d', 'v_struct+p_overhead>p_peak', 'v_work>p_work']) assert.ok(body.includes(expression), expression);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; -- no authenticated qualification or owning-call budget\s+EXCEPTION/);
  assert.equal((sql.match(/pro273_decoder_resource_preflight\(/g) ?? []).length, 2);
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
  const decoder = sql.split('CREATE FUNCTION public.pro273_initial_string_units(')[1].split('BEGIN')[1];
  assert.match(decoder, /^\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; -- no authenticated decoder qualification or owning-call budget/);
  const model = (b: bigint, u: bigint) => {
    const r = b + 4n, h = 4n * u + 4n, d = 2n * u + 4n;
    const raw = (8n * b + 32n) * r, copies = 2n * u * d;
    return { r, h, d, raw, copies, peak: 2n * r + raw + copies + 2n * h + 4n * d, work: raw + copies + 2n * h + 4n * d };
  };
  const m = model(10n, 8n);
  assert.deepEqual(m, { r: 14n, h: 36n, d: 20n, raw: 1568n, copies: 320n, peak: 2068n, work: 2040n });
  assert.ok(m.peak + 1n <= 2069n && !(m.peak + 1n <= 2068n));
  assert.ok(m.work <= 2040n && !(m.work <= 2039n));
  assert.ok(m.h <= 36n && !(m.h <= 35n));
  assert.ok(model(2147483640n, 2147483638n).peak > 9223372036854775807n);
  assert.ok(model(1000n, 1n).raw > model(10n, 1n).raw); // logical body, not compressed storage size
});

test('installer metadata decoder retains its ordered delivery and bounded decoding controls', () => {
  // Inert source inspection only; this does not execute or qualify SQL.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_installer_metadata_string_units(TEXT,BYTEA,INTEGER,INTEGER)';
  const body = sql.split('CREATE FUNCTION public.pro273_installer_metadata_string_units(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  assert.match(body, /BEGIN\s+IF p_expectation_id IS NULL OR p_body IS NULL OR p_start IS NULL OR p_end IS NULL THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;/);
  const ordered = [
    'pro273_installer_assert_committed_delivery(p_expectation_id)',
    "pro273_installer_metadata_context(p_expectation_id);v_limits:=v_context->'limits'",
    "(SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_limits))<>7",
    "ARRAY['maxInputBytes','maxDepthCapacity','maxTokenCapacity','maxDecodedUnits','maxParserWorkspaceBytes','maxDecodedEvidenceBytes','maxOutputBytes']",
    'FOREACH v_key IN ARRAY',
    "pg_catalog.jsonb_typeof(v_limits->v_key) IS DISTINCT FROM 'string'",
    "(v_limits->>v_key)::NUMERIC>9223372036854775807",
    'v_len:=pg_catalog.octet_length(p_body)',
    'v_len=0 OR v_len::NUMERIC>(v_limits->>\'maxInputBytes\')::NUMERIC OR v_len::NUMERIC>v_unit_limit OR p_start<0 OR p_end<=p_start OR p_end>v_len OR p_end-p_start<2',
    'public.pro273_installer_utf8_valid(p_body',
    'public.pro273_sel_scan_string_end(p_body,p_start,v_len) IS DISTINCT FROM p_end',
    'FOR v_pass IN 1..2 LOOP',
    'v_units::NUMERIC+v_count>v_unit_limit',
    '2::NUMERIC*(v_units::NUMERIC+v_count)>v_output_limit',
    '4::NUMERIC*(v_units::NUMERIC+v_count)>2147483647',
    'v_required>v_workspace',
    'v_units:=v_units+v_count',
    'v_written::NUMERIC+v_count>v_units OR v_written::NUMERIC+v_count>v_unit_limit OR v_required>v_workspace',
    'v_result:=pg_catalog.set_byte',
    'IF v_pass=1 THEN\n   v_required:=2::NUMERIC*pg_catalog.pg_column_size(p_body)+12::NUMERIC*v_units',
    'IF v_required>v_workspace THEN RAISE EXCEPTION',
    "v_result:=pg_catalog.decode(pg_catalog.repeat('00',v_units*2),'hex')",
    'ELSIF v_written<>v_units',
    "EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END $$;",
  ];
  let previous = -1;
  for (const control of ordered) {
    const index = body.indexOf(control, previous + 1);
    assert.ok(index > previous, control);
    previous = index;
  }
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`));
});

test('INITIAL data-only name and UTC helpers remain private and disconnected', () => {
  // Inert source checks only: this does not execute SQL or qualify resources.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  for (const [name, sig] of [['name_units_valid','BYTEA,INTEGER'], ['utc_units_valid','BYTEA'], ['utc_order_valid','BYTEA,BYTEA']] as const) {
    const qualified = `public.pro273_initial_${name}(${sig})`;
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${qualified} FROM PUBLIC;`));
    assert.ok(roles.includes(`ALTER FUNCTION ${qualified} OWNER TO pro262_capacity_owner;`));
    assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${qualified} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
    assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${qualified}`));
  }
  const name = sql.split('CREATE FUNCTION public.pro273_initial_name_units_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_initial_name_units_valid')[0];
  for (const guard of ['v_n=0', 'v_n%2<>0', 'v_u=0', 'v_u BETWEEN 56320 AND 57343', 'v_low NOT BETWEEN 56320 AND 57343', 'v_bytes:=v_bytes+4', 'v_bytes>p_max_bytes']) assert.ok(name.includes(guard), guard);
  const utc = sql.split('CREATE FUNCTION public.pro273_initial_utc_units_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_initial_utc_units_valid')[0];
  for (const guard of ['octet_length(p_units)<>48', 'v_year=0', 'v_month NOT BETWEEN 1 AND 12', 'v_hour>23', 'v_minute>59', 'v_second>59', 'v_year%400=0', 'v_year%100<>0', 'v_day BETWEEN 1 AND v_days']) assert.ok(utc.includes(guard), guard);
  const order = sql.split('CREATE FUNCTION public.pro273_initial_utc_order_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_initial_utc_order_valid')[0];
  assert.ok(order.includes('p_from<p_until'));
  assert.doesNotMatch(name + utc + order, /::JSONB|convert_from|SECURITY DEFINER|metadata_context/);
});

test('INITIAL string decoder is bounded, private and disconnected', () => {
  // Inert source evidence only; SQL execution and allocation qualification are not established.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_initial_string_units(public.pro273_initial_parser_limits,BYTEA,INTEGER,INTEGER)';
  const body = sql.split('CREATE FUNCTION public.pro273_initial_string_units(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  for (const guard of ['pro273_initial_string_scalars(p_body,p_start,p_end)', 'v_len>2147483640', 'v_bound<>pg_catalog.trunc(v_bound)', "v_bound::TEXT IN ('NaN','Infinity','-Infinity')", 'v_units::NUMERIC+v_count>v_unit_limit', '2::NUMERIC*(v_units::NUMERIC+v_count)>v_output_limit', '4::NUMERIC*(v_units::NUMERIC+v_count)>2147483647', 'v_required>v_workspace', 'p_limits."maxAllocationBytes"', 'v_written::NUMERIC+v_count>v_units', 'v_written<>v_units']) assert.ok(body.includes(guard), guard);
  assert.ok(body.indexOf('v_required>v_workspace') < body.indexOf('pg_catalog.repeat('));
  assert.match(body, /WHEN 34 THEN 34 WHEN 47 THEN 47 WHEN 92 THEN 92 WHEN 98 THEN 8 WHEN 102 THEN 12 WHEN 110 THEN 10 WHEN 114 THEN 13 WHEN 116 THEN 9/);
  for (const guard of ['v_code>1114111', 'v_code BETWEEN 55296 AND 57343', '55296+v_code/1024', '56320+v_code%1024', 'v_high/256', 'v_high%256']) assert.ok(body.includes(guard), guard);
  assert.doesNotMatch(body, /metadata_context|SECURITY DEFINER|::JSONB|convert_from|assert_committed_delivery/);
  assert.equal((sql.match(/pro273_initial_string_units\(/g) ?? []).length, 2);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
  for (const name of ['name_units_valid','utc_units_valid','utc_order_valid']) {
    const declaration = sql.split(`CREATE FUNCTION public.pro273_initial_${name}(`)[1].split('BEGIN')[0];
    assert.match(declaration, /IMMUTABLE STRICT/);
  }
});

test('INITIAL fixed key trie matches semantic core names and is private', () => {
  // Inspect and traverse source constants only; this does not execute SQL.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_initial_key_ordinal(BYTEA,INTEGER,INTEGER,INTEGER)';
  const body = sql.split('CREATE FUNCTION public.pro273_initial_key_ordinal(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  assert.match(body, /^p_body BYTEA,p_start INTEGER,p_end INTEGER,p_schema INTEGER\) RETURNS INTEGER\r?\nLANGUAGE plpgsql SET search_path=pg_catalog AS \$initial_key\$\r?\n/);
  assert.match(body, /EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END \$initial_key\$;\r?\n$/);
  assert.equal((body.match(/\$initial_key\$/g) ?? []).length, 2);
  const semantic = sql.split('CREATE FUNCTION public.pro273_qualifier_core_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_core_valid')[0];
  const schemas = [['core', 'evidenceBase64'], ...[...semantic.matchAll(/v_keys:=ARRAY\[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))];
  assert.deepEqual(schemas.map(x => x.length), [2, 15, 55]);
  const transitions = new Map<number, Map<number, number>>();
  for (const m of body.matchAll(/WHEN (\d+) THEN CASE v_code (.*?) ELSE -1 END/g)) {
    const edges = [...m[2].matchAll(/WHEN (\d+) THEN (\d+)/g)].map(x => [+x[1], +x[2]] as const);
    assert.ok(!transitions.has(+m[1]), `duplicate state ${m[1]}`);
    assert.equal(new Map(edges).size, edges.length, `duplicate edge at ${m[1]}`);
    transitions.set(+m[1], new Map(edges));
  }
  const terminalEntries = [...body.split('v_ordinal:=CASE v_state')[1].split('ELSE -1 END')[0].matchAll(/WHEN (\d+) THEN (\d+)/g)].map(m => [+m[1], +m[2]] as const);
  const terminals = new Map(terminalEntries);
  assert.equal(terminals.size, terminalEntries.length);
  const walk = (schema: number, key: string) => { let state = schema; for (const c of key) { state = transitions.get(state)?.get(c.charCodeAt(0)) ?? -1; if (state < 0) return -1; } return terminals.get(state) ?? -1; };
  for (const [schema, names] of schemas.entries()) {
    names.forEach((name, ordinal) => {
      assert.equal(walk(schema, name), ordinal, name);
      assert.equal(walk(schema, JSON.parse(`"${[...name].map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`)), ordinal, name);
      assert.equal(walk(schema, name + '!'), -1, name);
    });
    const reachable: Array<[string, number]> = [];
    const visit = (state: number, key: string, ancestors: Set<number>) => {
      assert.ok(!ancestors.has(state), `cycle at ${state}`);
      if (terminals.has(state)) reachable.push([key, terminals.get(state)!]);
      const nextAncestors = new Set(ancestors).add(state);
      for (const [code, next] of transitions.get(state) ?? []) visit(next, key + String.fromCharCode(code), nextAncestors);
    };
    visit(schema, '', new Set());
    assert.deepEqual(reachable.sort(([a], [b]) => a.localeCompare(b)), names.map((name, ordinal): [string, number] => [name, ordinal]).sort(([a], [b]) => a.localeCompare(b)));
  }
  assert.equal(terminals.size, 72);
  for (const guard of ['p_end::NUMERIC-p_start>188', 'pro273_initial_string_scalars(p_body,p_start,p_end)', 'v_escape=117', 'v_code<1 OR v_code>127', 'IF v_state<0', 'v_ordinal>=(CASE p_schema']) assert.ok(body.includes(guard), guard);
  assert.doesNotMatch(body, /::JSONB|convert_from|metadata_context|array_append/);
  assert.equal((sql.match(/pro273_initial_key_ordinal\(/g) ?? []).length, 4);
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
});

test('INITIAL specialized source stays denied and contains bounded closed-shape stages', () => {
  // Inert source assertions: no SQL execution, installed behavior, or resource proof.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_initial_schema_grammar(public.pro273_initial_parser_limits,BYTEA,INTEGER)';
  const body = sql.split('CREATE FUNCTION public.pro273_initial_schema_grammar(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; -- unconditional missing independent resource proof/);
  for (const guard of ['p_schema NOT IN (1,2)', 'v_len>2147483640', 'WHEN 1 THEN 15 ELSE 55', 'v_ord>=2', 'v_ord>=v_k', '(v_root & v_key)<>0', '(v_core & v_bit)<>0', 'v_core<>v_full', 'v_root<>3', 'v_pos<>v_len', 'v_tokens<>2*v_k+5', 'pro273_installer_utf8_valid', 'pro273_initial_string_scalars', 'ROW(v_core_start,v_core_end,v_evidence_start,v_evidence_end)']) assert.ok(body.includes(guard), guard);
  assert.doesNotMatch(body, /::JSONB|convert_from|pro273_initial_data_grammar|metadata_context/);
  assert.equal((sql.match(/pro273_initial_schema_grammar\(/g) ?? []).length, 2);
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
});

test('INITIAL semantic field prototype stays disconnected, private and denied', () => {
  // Source-only evidence; neither SQL behavior nor resource qualification is established.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_initial_semantic_field(INTEGER,INTEGER,BYTEA)';
  const body = sql.split('CREATE FUNCTION public.pro273_initial_semantic_field(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; -- unconditional missing independent resource proof/);
  const semantic = sql.split('CREATE FUNCTION public.pro273_qualifier_core_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_core_valid')[0];
  const schemas = [...semantic.matchAll(/v_keys:=ARRAY\[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  assert.deepEqual([3,10,11,12].map(i => schemas[0][i]), ['physicalEvidenceHash','sourceClosureHash','buildClosureHash','installationClosureHash']);
  assert.deepEqual([5,16,17,18,19,20,21,22].map(i => schemas[1][i]), ['layoutCoreHash','sourceClosureHash','supervisorClosureHash','driverClosureHash','nativeClosureHash','runtimeClosureHash','executableHash','installationClosureHash']);
  assert.deepEqual(schemas[0].slice(4,10), ['observerOtherBackendBytes','observerOtherSharedBytes','nonQualifierOtherBackendBytes','nonQualifierOtherSharedBytes','qualifierBudgetBackendBytes','qualifierBudgetSharedBytes']);
  const numeric = sql.split('CREATE FUNCTION public.pro273_qualifier_numeric_vector_valid(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_numeric_vector_valid')[0];
  const lists = [...numeric.matchAll(/v_(?:required|nonnegative):=ARRAY\[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  assert.deepEqual(schemas[1].slice(26,44), lists[1]);
  assert.deepEqual(schemas[1].slice(44,53), lists[2]);
  assert.equal(schemas[1][7], 'principalOid');
  for (const guard of ['p_schema NOT IN (1,2)', 'p_ordinal=0', 'pro273_installer_ascii_units', 'pro273_installer_hash_units_valid', 'pro273_qualifier_numeric_units_valid(p_units,TRUE)', 'pro273_qualifier_numeric_units_valid(p_units,FALSE)', 'pro273_installer_oid_units_valid', 'RETURN FALSE;']) assert.ok(body.includes(guard), guard);
  assert.doesNotMatch(body, /::JSONB|convert_from|metadata_context|SECURITY DEFINER/);
  assert.equal((sql.match(/pro273_initial_semantic_field\(/g) ?? []).length, 2);
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
});

test('INITIAL data grammar is private, bounded and remains an incomplete stage', () => {
  // Inert source checks only; SQL behavior and allocation qualification are not proved.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'public.pro273_initial_data_grammar(public.pro273_initial_parser_limits,BYTEA)';
  const body = sql.split('CREATE FUNCTION public.pro273_initial_data_grammar(')[1].split(`REVOKE ALL ON FUNCTION ${signature}`)[0];
  for (const field of ['maxInputBytes','maxDepthCapacity','maxTokenCapacity','maxDecodedUnits','maxParserWorkspaceBytes','maxSerializationBytes','maxAllocationBytes','maxDecodedEvidenceBytes','maxOutputBytes','stackBytes']) assert.ok(body.includes(`p_limits."${field}"`), field);
  for (const guard of ['v_bound IS NULL','v_bound<>pg_catalog.trunc(v_bound)','v_needed>v_workspace','v_needed>p_limits."maxAllocationBytes"','pro273_installer_utf8_valid','v_pos<>v_len','v_token_count+1','v_depth+1']) assert.ok(body.includes(guard), guard);
  assert.doesNotMatch(body, /metadata_context|assert_committed_delivery|::JSONB|v_ch=(116|102|110)|v_pos:=3/);
  assert.ok(body.includes("ELSE RAISE EXCEPTION 'SELECTION_UNAVAILABLE'"));
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${signature}`));
  assert.ok(sql.includes('Decoded-key, closed-shape, canonical and independently qualified peak checks'));
});

test('INITIAL scalar stage is private and precedes conversion for keys and values', () => {
  // Source assertions only; no SQL parser or runtime behavior is exercised.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const sig = 'public.pro273_initial_string_scalars(BYTEA,INTEGER,INTEGER)';
  const scalar = sql.split('CREATE FUNCTION public.pro273_initial_string_scalars(')[1].split(`REVOKE ALL ON FUNCTION ${sig}`)[0];
  const grammar = sql.split('CREATE FUNCTION public.pro273_initial_data_grammar(')[1].split('REVOKE ALL ON FUNCTION public.pro273_initial_data_grammar')[0];
  for (const guard of ['v_len>2147483640', 'p_start<0', 'p_end>v_len', 'p_end::NUMERIC-p_start<2', 'pro273_sel_scan_string_end(p_body,p_start,v_len) IS DISTINCT FROM p_end', 'v_code=0', 'v_code BETWEEN 55296 AND 56319', 'v_code NOT BETWEEN 56320 AND 57343', 'v_code BETWEEN 56320 AND 57343', 'IF v_high THEN']) assert.ok(scalar.includes(guard), guard);
  assert.doesNotMatch(scalar, /pro273_installer_utf8_valid/);
  assert.equal((grammar.match(/pro273_installer_utf8_valid/g) ?? []).length, 1);
  assert.equal((grammar.match(/public\.pro273_installer_utf8_valid\(p_captured,p_limits\."maxInputBytes"\)/g) ?? []).length, 1);
  assert.equal((grammar.match(/PERFORM public\.pro273_initial_string_scalars\(p_captured,v_pos,v_end\)/g) ?? []).length, 2);
  assert.doesNotMatch(scalar, /::JSONB|convert_from|metadata_context|array_append/);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION ${sig} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${sig}`));
});

test('descriptor core is closed, representable and hashed as the pinned ABI', () => {
  const core = {allocationCoreHash:'a'.repeat(64), allocationId:'allocation', baselinePartitionId:'partition', controlId:'control', credentialEpoch:'credential', deployment:'deployment', environment:'environment', expiresAt:'2030-02-28T12:34:56.789Z', launchEpoch:'launch', namespace:'namespace', physicalIdentity:'physical', physicalProofIdentity:'proof', principalName:'worker', principalOid:'42', project:'project', schemaVersion:'pro273-qualifier-descriptor-core-v1', sourceIdentity:'source'};
  const expected = createHash('sha256').update('["pro273.qualifier.descriptor.core.v1",' + JSON.stringify(core) + ']').digest('hex');
  assert.equal(descriptorCoreHash(core), expected);
  for (const key of Object.keys(core) as (keyof typeof core)[]) {
    assert.throws(() => descriptorCoreHash({...core, [key]: ''}), key);
    if (key === 'schemaVersion') assert.throws(() => descriptorCoreHash({...core, [key]: 'other'}));
    else assert.notEqual(descriptorCoreHash({...core, [key]: key === 'allocationCoreHash' ? 'b'.repeat(64) : key === 'principalOid' ? '43' : key === 'expiresAt' ? '2030-02-27T12:34:56.789Z' : core[key] + 'x'}), expected, key);
  }
  for (const patch of [{extra:'x'}, {principalOid:'0'}, {principalOid:'4294967296'}, {principalOid:'01'}, {expiresAt:'2030-02-30T12:34:56.789Z'}, {namespace:'*'}, {principalName:'x'.repeat(64)}, {controlId:'\ud800'}, {controlId:'\u0000'}]) assert.throws(() => descriptorCoreHash({...core, ...patch}));
  assert.doesNotThrow(() => descriptorCoreHash({...core, controlId:'😀'}));
});

// Inert source assertions only; this does not prove installed privileges or rollback.
function checkDescriptorProvenanceSource(sql: string, roles: string) {
  const declaration = 'CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)';
  const revoke = 'REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)';
  assert.equal(sql.split(declaration).length, 2);
  assert.equal(sql.split(revoke).length, 2);
  const start = sql.indexOf(declaration), end = sql.indexOf(revoke);
  assert.ok(end > start);
  const deny = sql.slice(start, end);
  const remainder = sql.slice(0, start) + sql.slice(end);
  assert.doesNotMatch(remainder, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:public|"public")\s*\.\s*)?(?:pro273_qualifier_reserve_control|"pro273_qualifier_reserve_control")\s*\([^)]*\bTEXT\s*,[^)]*\bBYTEA\s*\)/i, 'alternate constructor declaration');
  assert.equal((deny.match(/\bEND\s+\$\$\s*;/gi) ?? []).length, 1, 'single constructor terminator');
  assert.doesNotMatch(deny.slice(declaration.length), /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i, 'second declaration in constructor span');
  for (const name of ['Pro273QualifierDescriptorProvenance','Pro273QualifierDescriptorLinkage','Pro273QualifierDescriptorProof']) {
    assert.ok(sql.includes(`BEFORE UPDATE OR DELETE ON public."${name}"`));
    assert.ok(roles.includes(`ALTER TABLE public."${name}" OWNER TO pro262_capacity_owner`));
    assert.doesNotMatch(remainder, new RegExp(`\\bINSERT\\s+INTO\\s+(?:(?:public|"public")\\s*\\.\\s*)?"${name}"(?![\\w$])`, 'i'), `outside insert ${name}`);
  }
  const code = deny.replace(/--[^\r\n]*/g, '');
  assert.equal((code.match(/(?<![\w$"])(?:(?:public|"public")\s*\.\s*)?(?:pro273_qualifier_discover|"pro273_qualifier_discover")\s*\(/gi) ?? []).length, 1, 'single constructor discovery call');
  assert.match(code, /IF p_expectation_id IS NULL OR p_captured IS NULL OR NOT pg_catalog\.pg_has_role\(SESSION_USER,'pro273_install_bootstrap','MEMBER'\) OR pg_catalog\.current_setting\('transaction_isolation'\) IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;\s+v_discovery:=public\.pro273_qualifier_discover\(p_expectation_id\);\s+SELECT g\."physicalIdentity",g\."proofIdentity" INTO STRICT v_global/, 'discovery after guards and before global lock');
  assert.match(code, /\bBEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s+IF p_expectation_id IS NULL/);
  assert.match(code, /SELECT g\."physicalIdentity",g\."proofIdentity" INTO STRICT v_global FROM public\."Pro311ControlDomain" g WHERE g\."id"='global-v1' FOR UPDATE NOWAIT;/);
  assert.match(code, /SELECT d\.\* INTO STRICT v_domain FROM public\."Pro262CapacityPhysicalDomain" d WHERE d\."physicalIdentity"=v_global\."physicalIdentity" FOR UPDATE NOWAIT;/);
  assert.equal((deny.match(/\bFOR UPDATE NOWAIT\b/g) ?? []).length, 2);
  assert.doesNotMatch(code.replace(/\bFOR\s+UPDATE\b/gi, ''), /\b(?:UPDATE|DELETE|EXECUTE|COMMIT|RETURN)\b/i);
  assert.equal((code.match(/\bEXCEPTION\s+WHEN\b/gi) ?? []).length, 1);
  assert.match(code, /END IF;\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END \$\$;\s*$/);
  const absent = 'IF NOT EXISTS (SELECT 1 FROM public."Pro273QualificationInputDescriptor" d WHERE d."controlId"=v_expected."expectedTargetId") THEN';
  assert.equal(code.split(absent).length, 2);
  const [before, after] = code.split(absent);
  const branchEnd = after.indexOf('END IF;');
  assert.ok(branchEnd >= 0);
  const branch = after.slice(0, branchEnd);
  assert.doesNotMatch(before + after.slice(branchEnd), /\bINSERT\b/i);
  assert.match(before, /IF EXISTS \(SELECT 1 FROM public\."Pro273QualificationInputDescriptor"[\s\S]*?AND NOT EXISTS \([\s\S]*?\) THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;/);
  for (const name of ['Pro273QualifierDescriptorProvenance','Pro273QualifierDescriptorLinkage','Pro273QualifierDescriptorProof','Pro273QualificationInputState','Pro273QualificationTransitionReceipt']) assert.ok(before.includes(`JOIN public."${name}"`), name);
  const projections = [
    ['Pro273QualificationInputDescriptor','controlId,descriptorCoreHash,allocationId,allocationCoreHash,sourceIdentity,namespace,project,deployment,environment,principalOid,principalName,credentialEpoch,launchEpoch,observerGroupProof,physicalIdentity,physicalProofIdentity,baselinePartitionId,controlChargeKind,controlChargeEventKey,bootstrapRecordHash,expiresAt'],
    ['Pro273QualifierDescriptorProvenance','controlId,coreHash,bootstrapKind,bootstrapRecordHash,bootstrapEvidenceHash,trustId,trustGeneration,trustRecordHash,publisherPrincipalOid,publisherPrincipalName,inputClaimId,sessionClaimId,eventId,capturedBytes,capturedLength,capturedHash,evidenceBytes,evidenceLength,evidenceHash,chargeKind,chargeEventKey,chargeBindingHash'],
    ['Pro273QualifierDescriptorLinkage','controlId,coreHash,expectationId,dispatchAttemptId,sessionClaimId,inputClaimId,eventId'],
    ['Pro273QualifierDescriptorProof','controlId,coreHash,observerGroupProof'],
    ['Pro273QualificationInputState','controlId,state,connectionState,transitionOrdinal'],
    ['Pro273QualificationTransitionReceipt','controlId,transitionOrdinal,fromState,toState,fromConnectionState,toConnectionState,receiptId,bindingHash,occurredAt'],
  ];
  const inserts = [...branch.matchAll(/\bINSERT\s+INTO\s+public\."([^"]+)"\s*\(([^)]*)\)\s*VALUES\s*\(/gi)];
  assert.equal((code.match(/\bINSERT\b/gi) ?? []).length, 6);
  assert.deepEqual(inserts.map(m => [m[1], m[2].replace(/"/g, '').replace(/\s/g, '')]), projections);
  // Prior fixed pin 53d4766501169f9356417162011e123ab34b0791bd7d1281d1c4c18f77bbd2ee predates the private structural receipt helper.
  assert.equal(createHash('sha256').update(remainder).digest('hex'), '150e3afd681d3ce3a01af0a95542f1ea095f6cfeec9c24d25f78bef05dfffb73', 'migration remainder identity');
}

test('descriptor provenance remains private and captured publication denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  checkDescriptorProvenanceSource(sql, roles);
});

test('descriptor provenance source rejects replacement, alternate writers and removed denial mutations', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const declaration = 'CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)';
  assert.doesNotThrow(() => checkDescriptorProvenanceSource(sql, roles));
  const replacement = '\nCREATE OR REPLACE FUNCTION "public"."pro273_qualifier_reserve_control"(p_expectation_id TEXT,p_captured BYTEA) RETURNS void AS $$ BEGIN RETURN; END $$ LANGUAGE plpgsql;\n';
  assert.throws(() => checkDescriptorProvenanceSource(sql + replacement, roles), /alternate constructor declaration/);
  assert.throws(() => checkDescriptorProvenanceSource(sql.replace(declaration, declaration + '\nCREATE FUNCTION public.other()'), roles), /second declaration in constructor span/);
  assert.throws(() => checkDescriptorProvenanceSource(sql.replace(declaration, () => declaration + '\nEND $$;'), roles), /single constructor terminator/);
  for (const table of ['Pro273QualifierDescriptorProvenance','Pro273QualifierDescriptorLinkage','Pro273QualifierDescriptorProof']) {
    for (const prefix of ['public.', '"public".', '']) {
      const writer = `\nINSERT INTO ${prefix}"${table}" DEFAULT VALUES;\n`;
      assert.throws(() => checkDescriptorProvenanceSource(sql + writer, roles), /outside insert/, writer);
    }
  }
  const start = sql.indexOf(declaration);
  const discovery = 'v_discovery:=public.pro273_qualifier_discover(p_expectation_id);';
  const discoveryIndex = sql.indexOf(discovery, start);
  assert.ok(discoveryIndex > start);
  const withoutDiscovery = sql.slice(0, discoveryIndex) + sql.slice(discoveryIndex).replace(discovery, '');
  assert.throws(() => checkDescriptorProvenanceSource(withoutDiscovery, roles), /single constructor discovery call/);
  assert.throws(() => checkDescriptorProvenanceSource(sql.slice(0, discoveryIndex) + discovery + '\n ' + sql.slice(discoveryIndex), roles), /single constructor discovery call/);
  assert.throws(() => checkDescriptorProvenanceSource(sql.slice(0, discoveryIndex) + 'PERFORM public.pro273_qualifier_discover(p_expectation_id);\n ' + sql.slice(discoveryIndex), roles), /single constructor discovery call/);
  const guard = 'IF p_expectation_id IS NULL OR p_captured IS NULL OR NOT pg_catalog.pg_has_role';
  const guardIndex = withoutDiscovery.indexOf(guard, start);
  assert.ok(guardIndex > start);
  const beforeGuard = withoutDiscovery.slice(0, guardIndex) + discovery + '\n ' + withoutDiscovery.slice(guardIndex);
  assert.throws(() => checkDescriptorProvenanceSource(beforeGuard, roles), /discovery after guards and before global lock/);
  const globalLock = `SELECT g."physicalIdentity",g."proofIdentity" INTO STRICT v_global FROM public."Pro311ControlDomain" g WHERE g."id"='global-v1' FOR UPDATE NOWAIT;`;
  const lockIndex = withoutDiscovery.indexOf(globalLock, start);
  assert.ok(lockIndex > start);
  const afterLock = lockIndex + globalLock.length;
  const movedAfterLock = withoutDiscovery.slice(0, afterLock) + '\n ' + discovery + withoutDiscovery.slice(afterLock);
  assert.throws(() => checkDescriptorProvenanceSource(movedAfterLock, roles), /discovery after guards and before global lock/);
  const physicalLock = 'SELECT d.* INTO STRICT v_domain FROM public."Pro262CapacityPhysicalDomain" d WHERE d."physicalIdentity"=v_global."physicalIdentity" FOR UPDATE NOWAIT;';
  const physicalLockIndex = sql.indexOf(physicalLock, start);
  assert.ok(physicalLockIndex > start);
  const afterPhysicalLock = physicalLockIndex + physicalLock.length;
  for (const name of ['"public"."pro273_qualifier_discover"', 'public."pro273_qualifier_discover"', '"public".pro273_qualifier_discover', 'pro273_qualifier_discover', '"pro273_qualifier_discover"']) {
    const duplicate = sql.slice(0, afterPhysicalLock) + `\n PERFORM ${name}(p_expectation_id);` + sql.slice(afterPhysicalLock);
    assert.throws(() => checkDescriptorProvenanceSource(duplicate, roles), /single constructor discovery call/, name);
  }
  const denial = "BEGIN\n -- Publication remains held pending independent funding and lock qualification.\n RAISE EXCEPTION 'SELECTION_UNAVAILABLE';";
  const entry = sql.indexOf(denial, start);
  assert.ok(entry > start);
  const removed = sql.slice(0, entry) + sql.slice(entry).replace(denial, 'BEGIN');
  assert.throws(() => checkDescriptorProvenanceSource(removed, roles), (error: unknown) => error instanceof assert.AssertionError && error.operator === 'match');
  const receiptStart = sql.indexOf('CREATE FUNCTION public.pro273_installer_constructor_receipt(p_expectation_id TEXT)');
  const hintAndDenial = `SELECT e."constructorKind"='QUALIFIER_DESCRIPTOR' INTO STRICT v_descriptor_hint
 FROM public."Pro273ControlPlaneInstallerExpectation" e WHERE e."expectationId"=p_expectation_id;
 IF v_descriptor_hint THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;`;
  const receiptDenial = "IF v_descriptor_hint THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;";
  const hintIndex = sql.indexOf(hintAndDenial, receiptStart);
  assert.ok(receiptStart >= 0 && hintIndex > receiptStart);
  const withoutEarlyDenial = sql.slice(0, hintIndex) + sql.slice(hintIndex).replace(receiptDenial, '');
  assert.throws(() => checkDescriptorProvenanceSource(withoutEarlyDenial, roles), /migration remainder identity/);
  const withoutHint = sql.slice(0, hintIndex) + sql.slice(hintIndex).replace(hintAndDenial, '');
  const helper = 'PERFORM public.pro273_installer_assert_committed_delivery(p_expectation_id);';
  const helperIndex = withoutHint.indexOf(helper, receiptStart);
  assert.ok(helperIndex > receiptStart);
  const afterHelper = helperIndex + helper.length;
  const movedHint = withoutHint.slice(0, afterHelper) + '\n ' + hintAndDenial + withoutHint.slice(afterHelper);
  assert.throws(() => checkDescriptorProvenanceSource(movedHint, roles), /migration remainder identity/);
  assert.throws(() => checkDescriptorProvenanceSource(sql + '\n-- changed remainder\n', roles), /migration remainder identity/);
});

test('publisher provenance remains private and qualified provisioning fails before effects', () => {
  // Source text only: no SQL parsing, execution, or installed-authority claim.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const provision = sql.split('CREATE OR REPLACE FUNCTION public.pro262_capacity_trust_provision(')[1].split('-- The lane')[0];
  const denial = "IF p_record->>'purpose'='QUALIFIER_BASELINE_PUBLISHER' AND (p_record->'scope') ? 'initialQualification' THEN\n  RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';";
  for (const later of ['record_hash:=', 'FOR SHARE NOWAIT', 'RETURN trust_id;', 'INSERT INTO public."Pro262CapacityTrust"'])
    assert.ok(provision.indexOf(denial) >= 0 && provision.indexOf(denial) < provision.indexOf(later), later);
  const table = sql.split('CREATE TABLE public."Pro273PublisherTrustProvenance" (')[1].split('\n);')[0];
  for (const required of ['PRIMARY KEY ("trustId","generation")', `"recordHash" ~ '^[a-f0-9]{64}$'`, `"chargeKind"='TRUST_PROVISION'`, `"chargeEventKey"="trustId"||':'||"generation"::TEXT`, 'Pro262CapacityTrust', 'Pro262CapacityBootstrapTrust', 'Pro262CapacityControlCharge']) assert.ok(table.includes(required), required);
  assert.equal((table.match(/ON UPDATE RESTRICT ON DELETE RESTRICT/g) ?? []).length, 3);
  assert.doesNotMatch(table, /JSONB|BYTEA/);
  assert.ok(sql.includes('BEFORE UPDATE OR DELETE ON public."Pro273PublisherTrustProvenance" FOR EACH ROW EXECUTE FUNCTION public.pro273_sel_immutable()'));
  for (const required of ['ALTER TABLE public."Pro273PublisherTrustProvenance" OWNER TO pro262_capacity_owner', 'REVOKE ALL ON TABLE public."Pro273PublisherTrustProvenance"', 'PRO273_SEL_AUDIT_PROVENANCE_PRIVATE_ACL', 'PRO273_SEL_AUDIT_PROVENANCE_FK_WRITER_UNPROVEN', 'PRO273_SEL_AUDIT_TRIGGER_REPLICATION_BYPASS_UNRESOLVED']) assert.ok(roles.includes(required), required);
  assert.ok(!sql.includes('INSERT INTO public."Pro273PublisherTrustProvenance"'));
});

test('INITIAL qualification is closed and denied before authority', () => {
  // Inert source assertions only; these do not execute or parse SQL.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const provision = sql.split('CREATE OR REPLACE FUNCTION public.pro262_capacity_trust_provision(')[1].split('-- The lane')[0];
  const qualification = provision.split("q:=p_record->'scope'->'initialQualification';")[1].split('\n END IF;')[0];
  assert.match(provision, /CASE WHEN \(p_record->'scope'\) \? 'initialQualification' THEN 10 ELSE 9 END/);
  assert.match(qualification, /jsonb_typeof\(q\) IS DISTINCT FROM 'object'/);
  assert.match(qualification, /jsonb_object_keys\(q\)\)<>21/);
  const fields = ['schemaVersion','baselineId','baselineCoreHash','parserAbiVersion','sourceClosureHash','installationClosureHash','receiverIdentity','receiverClosureHash','maxInputBytes','maxOutputBytes','parserPeakBytes','serializationPeakBytes','jsonbPeakBytes','largestAllocationBytes','stackPeakBytes','eventDurableBytes','closedScopeDurableBytes','memoryEvidenceHash','durabilityEvidenceHash','fenceEvidenceHash','fenceAbiVersion'];
  const keyList = qualification.match(/q \?& ARRAY\[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.map(x => x.slice(1, -1));
  assert.deepEqual(keyList, fields);
  assert.match(qualification, /jsonb_each\(q\).*jsonb_typeof\(e.value\) IS DISTINCT FROM 'string'/);
  for (const fixed of ['pro273-initial-qualification-v1','pro273-initial-metadata-v1','pro273-initial-one-shot-v1']) assert.ok(qualification.includes(fixed));
  assert.match(qualification, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(qualification, /\^\[1-9\]\[0-9\]\{0,18\}\$/);
  assert.match(qualification, /::NUMERIC>9223372036854775807/);
  assert.ok(provision.includes('existing."scope" IS DISTINCT FROM p_record->\'scope\''));
  for (const name of ['pro273_control_plane_lock_input_authority', 'pro273_control_plane_claim_input']) {
    const body = sql.split(`CREATE FUNCTION public.${name}(`)[1].split(`REVOKE ALL ON FUNCTION public.${name}`)[0];
    const denial = `IF v_binding."purpose"='QUALIFIER_BASELINE_INITIAL' THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;`;
    assert.ok(body.indexOf(denial) > 0 && body.indexOf(denial) < body.indexOf('LOCK TABLE public."Pro311ControlDomain"'), name);
  }
});

test('INITIAL v2 resource qualification is closed and remains denied', () => {
  // Structural assertions only: no SQL parsing, execution, or qualification proof.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const provision = sql.split('CREATE OR REPLACE FUNCTION public.pro262_capacity_trust_provision(')[1].split('-- The lane')[0];
  const evaluator = sql.split('CREATE FUNCTION public.pro273_control_plane_evaluate_initial(')[1].split('REVOKE ALL ON FUNCTION public.pro273_control_plane_evaluate_initial')[0];
  const fields = ['schemaVersion','baselineId','baselineCoreHash','parserAbiVersion','sourceClosureHash','installationClosureHash','receiverIdentity','receiverClosureHash','maxInputBytes','maxOutputBytes','parserPeakBytes','serializationPeakBytes','jsonbPeakBytes','largestAllocationBytes','stackPeakBytes','eventDurableBytes','closedScopeDurableBytes','memoryEvidenceHash','durabilityEvidenceHash','fenceEvidenceHash','fenceAbiVersion','decoderOverheadBytes','decoderWorkBytes'];
  for (const body of [provision, evaluator]) {
    const shape = body.split("IF q->>'schemaVersion'='pro273-initial-qualification-v2' AND ")[1].split(' THEN RAISE EXCEPTION')[0];
    assert.ok(shape.includes('jsonb_object_keys(q))<>23'));
    assert.deepEqual(shape.match(/q \?& ARRAY\[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.map(x => x.slice(1, -1)), fields);
    assert.ok(body.includes("q->>'schemaVersion'='pro273-initial-qualification-v2' AND q->>'parserAbiVersion' IS DISTINCT FROM 'pro273-initial-metadata-v2'"));
    const numbers = body.split("FOREACH field IN ARRAY ARRAY['decoderOverheadBytes','decoderWorkBytes'] LOOP")[1].split('END LOOP;')[0];
    assert.ok(numbers.includes("q->>field !~ '^[1-9][0-9]{0,18}$'"));
    assert.ok(numbers.includes('(q->>field)::NUMERIC>9223372036854775807'));
    assert.ok(body.includes("jsonb_typeof(e.value) IS DISTINCT FROM 'string'"));
  }
  assert.ok(provision.indexOf("RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';") < provision.indexOf('record_hash:='));
  assert.ok(provision.includes("digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256')"));
  assert.ok(provision.includes("existing.\"scope\" IS DISTINCT FROM p_record->'scope'"));
  assert.match(evaluator, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.ok(evaluator.includes('cannot be checked without the exact serialized provisioning record'));
});

test('INITIAL partial evaluator remains private and fail closed with protected bounds', () => {
  // Text checks only: neither SQL semantics nor independent proof is established.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const name = 'pro273_control_plane_evaluate_initial';
  const body = sql.split(`CREATE FUNCTION public.${name}(`)[1].split(`REVOKE ALL ON FUNCTION public.${name}`)[0];
  assert.equal(sql.split(`public.${name}(`).length - 1, 2);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.pro273_control_plane_evaluate_initial\(TEXT\) FROM PUBLIC/);
  for (const field of ['trustId','trustGeneration','recordHash','chargeKind','chargeEventKey','chargeBindingHash','coverageEvidenceHash','eventWorstCase','maxClosedScopeBytes','primitiveParserCacheBytes','inputEvidenceSerializationBytes','maxAllocationBytes','stackBytes']) assert.ok(body.includes(field), field);
  assert.match(body, /LEAST\(s\."maxInputBytes",base\."maxInputBytes",\(publisher\."scope"->>'inputBound'\)::NUMERIC\)/);
  assert.match(body, /jsonbPeakBytes'\)::NUMERIC>\(q->>'serializationPeakBytes/);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
});

test('INITIAL evaluator source rejects missing qualification and bound guards', () => {
  // Mutation checks over inert text; this is not a SQL or installed-ACL test.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_plane_evaluate_initial(')[1].split('REVOKE ALL ON FUNCTION public.pro273_control_plane_evaluate_initial')[0];
  const fields = ['schemaVersion','baselineId','baselineCoreHash','parserAbiVersion','sourceClosureHash','installationClosureHash','receiverIdentity','receiverClosureHash','maxInputBytes','maxOutputBytes','parserPeakBytes','serializationPeakBytes','jsonbPeakBytes','largestAllocationBytes','stackPeakBytes','eventDurableBytes','closedScopeDurableBytes','memoryEvidenceHash','durabilityEvidenceHash','fenceEvidenceHash','fenceAbiVersion'];
  const hashes = ['baselineCoreHash','sourceClosureHash','installationClosureHash','receiverClosureHash','memoryEvidenceHash','durabilityEvidenceHash','fenceEvidenceHash'];
  const numbers = ['maxInputBytes','maxOutputBytes','parserPeakBytes','serializationPeakBytes','jsonbPeakBytes','largestAllocationBytes','stackPeakBytes','eventDurableBytes','closedScopeDurableBytes'];
  const bounds = ['s."maxInputBytes"','base."maxInputBytes"','base."reservedBackendBytes"','base."reservedSharedBytes"','base."reservedTemporaryBytes"','base."maxOutputBytes"','base."primitiveParserCacheBytes"','base."inputEvidenceSerializationBytes"','base."maxAllocationBytes"','base."stackBytes"','charge."amount"','control."eventWorstCase"','control."maxClosedScopeBytes"'];
  const check = (source: string) => {
    const keys = source.match(/q \?& ARRAY\[([^\]]+)\]/)?.[1].match(/'[^']+'/g)?.map(x => x.slice(1, -1));
    assert.deepEqual(keys, fields);
    assert.match(source, /jsonb_object_keys\(q\)\)<>21/);
    assert.match(source, /jsonb_each\(q\).*jsonb_typeof\(e.value\) IS DISTINCT FROM 'string' OR e.value#>>'\{\}'=''/);
    for (const abi of ['pro273-initial-qualification-v1','pro273-initial-metadata-v1','pro273-initial-one-shot-v1']) assert.ok(source.includes(`IS DISTINCT FROM '${abi}'`), abi);
    const lists = [...source.matchAll(/FOREACH field IN ARRAY ARRAY\[([^\]]+)\]/g)].map(m => m[1].match(/'[^']+'/g)?.map(x => x.slice(1, -1)));
    assert.deepEqual(lists, [hashes, numbers, ['decoderOverheadBytes','decoderWorkBytes']]);
    for (const guard of ["q->>field !~ '^[a-f0-9]{64}$'", "q->>field !~ '^[1-9][0-9]{0,18}$'", '(q->>field)::NUMERIC>9223372036854775807', `jsonb_typeof(publisher."scope"->'inputBound') IS DISTINCT FROM 'string'`, `COALESCE(publisher."scope"->>'inputBound','') !~ '^[1-9][0-9]{0,18}$'`, `(publisher."scope"->>'inputBound')::NUMERIC>9223372036854775807`, "bound IS NULL OR bound<=0 OR bound::TEXT IN ('NaN','Infinity','-Infinity') OR bound<>pg_catalog.trunc(bound)"]) assert.ok(source.includes(guard), guard);
    const found = source.match(/FOREACH bound IN ARRAY ARRAY\[([^\]]+)\]/)?.[1].split(',');
    assert.deepEqual(found, bounds);
    const least = source.indexOf('input_bound:=LEAST(');
    for (const guard of ['jsonb_object_keys(q))<>21', '(q->>field)::NUMERIC>9223372036854775807', `(publisher."scope"->>'inputBound')::NUMERIC>9223372036854775807`, 'bound IS NULL OR bound<=0']) assert.ok(source.indexOf(guard) >= 0 && source.indexOf(guard) < least, guard);
    assert.ok(source.indexOf("q->>field !~ '^[1-9][0-9]{0,18}$'") < source.indexOf('(q->>field)::NUMERIC>9223372036854775807'));
    assert.ok(source.indexOf('(q->>field)::NUMERIC>9223372036854775807') < source.indexOf(`q->>'baselineId' IS DISTINCT FROM base."baselineId"`));
    assert.ok(source.indexOf(`COALESCE(publisher."scope"->>'inputBound','') !~`) < source.indexOf(`(publisher."scope"->>'inputBound')::NUMERIC`));
  };
  check(body);
  const keyList = `q ?& ARRAY[${fields.map(field => `'${field}'`).join(',')}]`;
  for (const field of fields) assert.throws(() => check(body.replace(keyList, keyList.replace(`'${field}'`, `'missing_${field}'`))), field);
  for (const bound of bounds) assert.throws(() => check(body.replace(`,${bound}`, ',NULL_REPLACEMENT').replace(`ARRAY[${bound},`, 'ARRAY[NULL_REPLACEMENT,')), bound);
  for (const guard of ['jsonb_object_keys(q))<>21', "bound IS NULL OR bound<=0", "q->>field !~ '^[1-9][0-9]{0,18}$'", '(q->>field)::NUMERIC>9223372036854775807', `(publisher."scope"->>'inputBound')::NUMERIC>9223372036854775807`]) assert.throws(() => check(body.replaceAll(guard, 'REMOVED_GUARD')));
  const signature = 'public.pro273_control_plane_evaluate_initial(TEXT)';
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,pro273_selection_owner;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${signature}`));
});

test('input authority routes before ordered locks and preserves preparation reentry', () => {
  // Inert source checks: they do not establish SQL validity or concurrency behavior.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const section = (name: string) => migration.split(`CREATE FUNCTION public.${name}(`)[1].split(`REVOKE ALL ON FUNCTION public.${name}`)[0];
  const helper = section('pro273_control_plane_lock_input_authority');
  const assertion = section('pro273_control_plane_assert_input');
  const claim = section('pro273_control_plane_claim_input');
  assert.ok(helper.indexOf('Pro311ControlDomain') < helper.indexOf('Pro262CapacityPhysicalDomain" d WHERE'));
  assert.ok(helper.indexOf('Pro262CapacityPhysicalDomain" d WHERE') < helper.indexOf('FOR v_pair IN'));
  assert.ok(helper.indexOf('FOR v_pair IN') < helper.indexOf('Pro262CapacityBootstrapBaseline" b WHERE'));
  assert.match(helper, /SELECT DISTINCT x\.id COLLATE "C" AS id,x\.generation/);
  assert.match(helper, /ORDER BY id,generation LOOP/);
  for (const name of ['v_provenance', 'v_observation', 'v_binding', 'v_slot', 'v_capture_slot']) assert.ok(helper.includes(`${name}."trust` ) || helper.includes(`${name}."observerTrust`), name);
  assert.ok(helper.includes('(v_capture_slot."observerTrustId",v_capture_slot."observerTrustGeneration") IS DISTINCT FROM (v_observation."trustId",v_observation."trustGeneration")'));
  assert.ok(helper.includes('(v_binding."baselineId",v_slot."observerTrustId",v_slot."observerTrustGeneration") IS DISTINCT FROM (v_session."baselineId",v_binding."trustId",v_binding."trustGeneration")'));
  assert.ok(helper.includes('o IS NOT DISTINCT FROM v_observation'));
  assert.ok(assertion.includes('p_purpose IS NULL'));
  assert.ok(assertion.includes("'QUALIFIER_BASELINE_INITIAL','SELECTION_PROFILE_REVOKE'"));
  assert.ok(assertion.indexOf('pro273_control_plane_lock_input_authority') < assertion.indexOf('FOR SHARE NOWAIT'));
  const hint = 'SELECT c.* INTO STRICT v_hint FROM public."Pro273ControlPlaneInputClaim"';
  const route = 'pro273_control_plane_lock_input_authority(v_hint."sessionClaimId",v_hint."reservationId")';
  const lockedClaim = 'SELECT c.* INTO STRICT v_claim FROM public."Pro273ControlPlaneInputClaim"';
  const equality = "IF v_claim IS DISTINCT FROM v_hint THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;";
  assert.ok(assertion.indexOf(hint) >= 0 && assertion.indexOf(hint) < assertion.indexOf(route));
  assert.ok(assertion.indexOf(route) < assertion.indexOf(lockedClaim) && assertion.indexOf(lockedClaim) < assertion.indexOf(equality));
  assert.ok(assertion.indexOf(equality) < assertion.indexOf('SELECT s.* INTO STRICT v_session'));
  const prefix = 'SELECTION_QUALIFIER_ALLOCATION:';
  assert.ok(helper.includes(`pg_catalog.starts_with(v_binding."target"->>'bootstrapKind','${prefix}')`));
  assert.ok(!helper.includes(`LIKE '${prefix}%`));
  assert.equal('SELECTION_QUALIFIER_ALLOCATION:example'.startsWith(prefix), true);
  assert.equal('SELECTIONXQUALIFIER_ALLOCATION:example'.startsWith(prefix), false);
  assert.ok(claim.indexOf('FOR UPDATE NOWAIT') < claim.indexOf('pro273_control_plane_lock_input_authority'));
  assert.ok(claim.indexOf('pro273_control_plane_lock_input_authority') < claim.indexOf('FOR SHARE NOWAIT'));
  assert.ok(!assertion.includes('creationTransactionId'));
  assert.ok(!claim.includes('creationTransactionId'));
  assert.ok(roles.includes('ALTER FUNCTION public.pro273_control_plane_lock_input_authority(TEXT,TEXT) OWNER TO pro262_capacity_owner'));
  assert.ok(roles.includes('REVOKE ALL ON FUNCTION public.pro273_control_plane_lock_input_authority(TEXT,TEXT) FROM PUBLIC'));
  for (const name of ['pro273_control_plane_assert_input', 'pro273_control_plane_claim_input']) {
    const signature = `public.${name}(TEXT,TEXT)`;
    assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
    assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
    assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${signature}`));
  }
});

test('descriptor linkage construction xid is stamped and historical restore remains unqualified', () => {
  // Inert source checks only; insert and restore behavior are not executed.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const linkage = migration.split('CREATE TABLE public."Pro273QualifierDescriptorLinkage" (')[1].split('\n);')[0];
  const stamp = migration.split('CREATE FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid()')[1].split('END $$;')[0];
  assert.ok(linkage.includes('"constructionTransactionId" xid8 NOT NULL DEFAULT pg_catalog.pg_current_xact_id()'));
  assert.doesNotMatch(linkage, /CHECK\s*\([^;]*pg_current_xact_id\s*\(/i);
  assert.ok(stamp.includes('NEW."constructionTransactionId":=pg_catalog.pg_current_xact_id()'));
  assert.ok(migration.includes('BEFORE INSERT ON public."Pro273QualifierDescriptorLinkage" FOR EACH ROW EXECUTE FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid()'));
  assert.ok(migration.includes('BEFORE UPDATE OR DELETE ON public."Pro273QualifierDescriptorLinkage" FOR EACH ROW EXECUTE FUNCTION public.pro273_sel_immutable()'));
  assert.ok(migration.includes('Restored linkage is therefore unqualified as historical proof; recovery remains held.'));
  assert.ok(roles.includes('ALTER FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid() OWNER TO pro262_capacity_owner;'));
  assert.ok(roles.includes('REVOKE ALL ON FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid() FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;'));
  assert.ok(!roles.includes('GRANT EXECUTE ON FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid()'));
});

test('control-plane creation xid and UTC wire prerequisites remain source-bound', () => {
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  for (const name of ['LaunchAttempt', 'SessionClaim', 'InputBinding', 'InputClaim']) {
    const table = `Pro273ControlPlane${name}`;
    const definition = migration.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
    assert.ok(definition.includes('"creationTransactionId" xid8 NOT NULL'));
    assert.ok(migration.includes(`BEFORE INSERT ON public."${table}" FOR EACH ROW EXECUTE FUNCTION public.pro273_control_plane_stamp_creation_xid()`));
    assert.ok(migration.includes(`BEFORE UPDATE OR DELETE ON public."${table}"`));
  }
  assert.ok(migration.includes('NEW."creationTransactionId":=pg_catalog.pg_current_xact_id()'));
  assert.ok(roles.includes('REVOKE ALL ON FUNCTION public.pro273_control_plane_stamp_creation_xid() FROM PUBLIC'));
  const body = migration.split('CREATE FUNCTION public.pro273_control_plane_assert_input(')[1].split('REVOKE ALL ON FUNCTION public.pro273_control_plane_assert_input')[0];
  const finite = `IF v_baseline."validUntil" IS NULL OR NOT pg_catalog.isfinite(v_baseline."validUntil") THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;`;
  const lower = `(v_baseline."validUntil" AT TIME ZONE 'UTC') < TIMESTAMP '0001-01-01 00:00:00'`;
  const upper = `(v_baseline."validUntil" AT TIME ZONE 'UTC') >= TIMESTAMP '10000-01-01 00:00:00'`;
  const aligned = `(v_baseline."validUntil" AT TIME ZONE 'UTC') IS DISTINCT FROM pg_catalog.date_trunc('milliseconds',v_baseline."validUntil" AT TIME ZONE 'UTC')`;
  const wire = `v_baseline."validUntil" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
  for (const term of [finite, lower, upper, aligned, wire, `v_observation."backendStart" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`]) assert.ok(body.includes(term), term);
  assert.ok(body.indexOf(finite) < body.indexOf(lower));
  assert.match(body, /TIMESTAMP '10000-01-01 00:00:00' OR\s+\(v_baseline\."validUntil" AT TIME ZONE 'UTC'\) IS DISTINCT FROM pg_catalog\.date_trunc\('milliseconds',v_baseline\."validUntil" AT TIME ZONE 'UTC'\) THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;/);
  assert.ok(body.indexOf(aligned) < body.indexOf(wire));
  assert.ok(!body.includes(`date_trunc('milliseconds',v_baseline."validUntil")`));
});

test('publication receipt structural assertion remains private and cannot enable insertion', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_initial_assert_publication_receipt(')[1].split('END $$;')[0];
  const trigger = sql.split('CREATE FUNCTION public.pro273_initial_linkage_block_insert()')[1].split('END $$;')[0];
  assert.match(helper, /IMMUTABLE SECURITY INVOKER/);
  for (const field of ['inputClaimId','receiptId','reservationId','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','receiverIdentity','target','creationTransactionId']) assert.ok(helper.includes(`p_receipt."${field}"`), field);
  for (const term of ['IS DISTINCT FROM','p_current_xid','expectedEvidenceHash','bootstrapKind','expectedCoreHash']) assert.ok(helper.includes(term),term);
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.pro273_initial_assert_publication_receipt('));
  assert.ok(roles.includes('ALTER FUNCTION public.pro273_initial_assert_publication_receipt('));
  assert.ok(roles.includes('REVOKE ALL ON FUNCTION public.pro273_initial_assert_publication_receipt('));
  assert.ok(trigger.indexOf('FOR SHARE NOWAIT') < trigger.indexOf('PERFORM public.pro273_initial_assert_publication_receipt'));
  assert.equal((trigger.match(/PERFORM public\.pro273_initial_assert_publication_receipt/g)??[]).length,2);
  assert.match(trigger, /pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(trigger, /END IF;\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
});

test('INITIAL preinput storage is immutable, private and optional during preparation', () => {
  // Inert text checks only: installed constraints, ACL and locking are unverified.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = migration.split('CREATE TABLE public."Pro273InitialPreinputReceipt" (')[1].split('\n);')[0];
  for (const field of ['inputClaimId', 'receiptId', 'reservationId', 'baselineId', 'baselineCoreHash', 'sessionClaimId', 'attemptId', 'eventId', 'receiverIdentity', 'target', 'principalOid', 'principalName', 'credentialEpoch', 'launchEpoch', 'backendPid', 'backendStart', 'sourceClosureHash', 'installationClosureHash', 'chargeKind', 'chargeEventKey', 'chargeBindingHash', 'creationTransactionId']) assert.ok(table.includes(`"${field}"`), field);
  assert.match(table, /"creationTransactionId" xid8 NOT NULL/);
  assert.match(table, /"reservationId" TEXT NOT NULL UNIQUE REFERENCES public\."Pro273ControlPlaneInputBinding"/);
  assert.ok(migration.includes('BEFORE INSERT ON public."Pro273InitialPreinputReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro273_control_plane_stamp_creation_xid()'));
  assert.ok(migration.includes('BEFORE UPDATE OR DELETE ON public."Pro273InitialPreinputReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro273_sel_immutable()'));
  assert.ok(migration.includes('FOREIGN KEY ("sessionClaimId") REFERENCES public."Pro273ControlPlaneProcessObservation"("sessionClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT'));
  const helper = migration.split('CREATE FUNCTION public.pro273_control_plane_lock_input_authority(')[1].split('REVOKE ALL ON FUNCTION public.pro273_control_plane_lock_input_authority')[0];
  const receipt = 'SELECT r.* INTO v_receipt FROM public."Pro273InitialPreinputReceipt" r WHERE r."reservationId"=p_reservation_id FOR SHARE NOWAIT;';
  assert.ok(helper.includes('v_receipt public."Pro273InitialPreinputReceipt"%ROWTYPE'));
  assert.ok(helper.includes(receipt));
  for (const pin of [
    'PERFORM 1 FROM public."Pro273ControlPlaneProcessObservation" o',
    'PERFORM 1 FROM public."Pro262CapacityObserverInputClaim" c WHERE c."inputClaimId"=v_capture."inputClaimId"',
    'PERFORM 1 FROM public."Pro262CapacityObserverInputReservation" r WHERE r."reservationId"=v_capture_slot."reservationId"',
    'SELECT c.* INTO v_charge FROM public."Pro262CapacityControlCharge" c',
  ]) {
    const start = helper.indexOf(pin);
    const checked = helper.indexOf("IF NOT FOUND THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;", start);
    assert.ok(start >= 0 && checked > start && checked < helper.indexOf(receipt), pin);
  }
  const present = helper.split(receipt)[1].split('\n END IF;')[0];
  assert.ok(present.startsWith('\n IF FOUND THEN'));
  for (const field of ['inputClaimId', 'reservationId', 'baselineId', 'baselineCoreHash', 'sessionClaimId', 'attemptId', 'eventId', 'receiverIdentity', 'target', 'principalOid', 'principalName', 'credentialEpoch', 'launchEpoch', 'backendPid', 'backendStart', 'sourceClosureHash', 'installationClosureHash', 'chargeKind', 'chargeEventKey', 'chargeBindingHash']) assert.ok(present.includes(`v_receipt."${field}"`), field);
  for (const authority of ['v_input', 'v_observer_input', 'v_slot', 'v_binding', 'v_baseline', 'v_session', 'v_attempt', 'v_observation', 'v_charge']) assert.ok(present.includes(`${authority}."`), authority);
  for (const [left, right] of [
    ['v_receipt."inputClaimId",v_receipt."reservationId"', 'v_input."inputClaimId",v_input."reservationId"'],
    ['v_input."inputClaimId",v_input."reservationId",v_input."eventId",v_input."purpose"', 'v_observer_input."inputClaimId",v_observer_input."reservationId",v_observer_input."eventKey",v_observer_input."phase"'],
    ['v_input."reservationId",v_input."baselineId",v_input."purpose"', 'v_binding."reservationId",v_binding."baselineId",v_binding."purpose"'],
    ['v_receipt."reservationId",v_receipt."baselineId",v_receipt."baselineCoreHash"', 'v_slot."reservationId",v_baseline."baselineId",v_baseline."coreHash"'],
    ['v_session."baselineId",v_session."attemptId",v_session."receiverIdentity"', 'v_attempt."baselineId",v_attempt."attemptId",v_attempt."receiverIdentity"'],
    ['v_receipt."principalOid",v_receipt."principalName",v_receipt."credentialEpoch",v_receipt."launchEpoch"', 'v_session."principalOid",v_session."principalName",v_session."credentialEpoch",v_session."launchEpoch"'],
    ['v_receipt."backendPid",v_receipt."backendStart",v_receipt."sourceClosureHash",v_receipt."installationClosureHash"', 'v_observation."backendPid",v_observation."backendStart",v_observation."sourceClosureHash",v_observation."installationClosureHash"'],
    ['v_receipt."sourceClosureHash",v_receipt."installationClosureHash"', 'v_baseline."sourceClosureHash",v_baseline."installationClosureHash"'],
    ['v_receipt."chargeKind",v_receipt."chargeEventKey",v_receipt."chargeBindingHash"', 'v_charge."kind",v_charge."eventKey",v_charge."bindingHash"'],
  ]) {
    const clause = present.split(' OR\n').find((part) => part.includes(left) && part.includes(right));
    assert.ok(clause?.includes('IS DISTINCT FROM'), `${left} against ${right}`);
  }
  assert.ok(present.includes('v_input."inputClaimId" IS NULL'));
  assert.match(present, /-- The admission primary-key reference needs a final-tuple assertion to associate\s*-- the original row; that assertion is not implemented\. Receipt implementation and qualification,\s*-- together with the remaining authority and resource proofs, are still absent\.\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.ok(!helper.includes('creationTransactionId'));
  assert.ok(roles.includes('ALTER TABLE public."Pro273InitialPreinputReceipt" OWNER TO pro262_capacity_owner;'));
  assert.ok(roles.includes('REVOKE ALL ON TABLE public."Pro273InitialPreinputReceipt" FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;'));
  assert.ok(!roles.includes('GRANT') || !roles.match(/GRANT[^;]*ON (?:TABLE )?public\."Pro273InitialPreinputReceipt"/));
});

test('qualifier raw numeric prerequisite is private and bounds digits before conversion', () => {
  // Source assertions only; this neither executes SQL nor proves parser funding.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'public.pro273_qualifier_numeric_units_valid(BYTEA,BOOLEAN)';
  const body = migration.split('CREATE FUNCTION public.pro273_qualifier_numeric_units_valid(')[1].split(`REVOKE ALL ON FUNCTION ${signature}`)[0];
  assert.ok(body.includes('v_n>262144'));
  assert.ok(body.indexOf('v_n>262144') < body.indexOf('FOR v_i IN'));
  assert.ok(body.includes('v_n%2<>0'));
  assert.ok(body.includes('v_n>2 OR p_positive'));
  assert.ok(body.includes('v_digit NOT BETWEEN 48 AND 57'));
  assert.ok(!body.includes('::NUMERIC'));
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${signature}`));
});

test('pair constructor Source remains private and denies before accounting locks', () => {
  // Inert source assertions; no SQL parsing, execution, or installed ACL claim.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const name = 'pro273_sel_construct_invocation_pair';
  const signature = `public.${name}(TEXT,BYTEA)`;
  assert.equal((migration.match(/CREATE FUNCTION public\.pro273_sel_construct_invocation_pair\(/g) ?? []).length, 1);
  assert.ok(!migration.includes('pro273_installer_construct_pair'));
  const body = migration.split(`CREATE FUNCTION public.${name}(`)[1].split(`REVOKE ALL ON FUNCTION ${signature}`)[0];
  const guard = "IF p_expectation_id IS NULL OR p_captured IS NULL OR NOT pg_catalog.pg_has_role(SESSION_USER,'pro273_install_bootstrap','MEMBER') OR pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;";
  assert.ok(body.includes(guard));
  assert.ok(body.indexOf(guard) < body.indexOf('FROM public."Pro311ControlDomain"'));
  for (const term of ['FOR UPDATE NOWAIT', 'pro273_installer_assert_committed_delivery', 'pro273_installer_metadata_context', 'pro273_installer_parse_pair_metadata', 'v_charge."bindingHash"', "RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\nEXCEPTION WHEN OTHERS"]) assert.ok(body.includes(term), term);
  for (const term of ['v_grant->>\'claimantScopeId\' IS DISTINCT FROM v_authority->\'claimantFundingRef\'->>\'allocationId\'', 'v_grant->>\'workerScopeCoreHash\' IS DISTINCT FROM v_authority->\'workerScope\'->>\'descriptorCoreHash\'', 'FROM public."Pro273ResourceSchedule" r', 'FROM public."Pro273QualifiedInputDomain" d', 'v_resource."claimantFunding" IS DISTINCT FROM v_authority->\'claimantFundingRef\'', 'v_resource."workerFunding"->>\'allocationCoreHash\'', 'v_now:=pg_catalog.clock_timestamp()']) assert.ok(body.includes(term), term);
  const scopeGuard = `v_resource."scopeKind" IS DISTINCT FROM 'QUALIFIER_ALLOCATION'`;
  assert.ok(body.includes(scopeGuard));
  for (const field of ['controlId', 'allocationId', 'allocationCoreHash']) {
    assert.ok(body.includes(`v_resource."${field}" IS DISTINCT FROM v_authority->'workerScope'->>'${field}'`), field);
  }
  for (const [funding, schedule] of [['principalOid', 'receiverPrincipalOid'], ['credentialEpoch', 'credentialEpoch'], ['launchEpoch', 'launchEpoch']]) {
    assert.ok(body.includes(`v_resource."workerFunding"->>'${funding}' IS DISTINCT FROM v_schedule->>'${schedule}'`), funding);
  }
  assert.ok(body.includes("v_authority->>'kind' IS DISTINCT FROM 'BOOTSTRAP_PROFILE_HASH'"));
  assert.ok(body.includes("v_grant->>'claimantPrincipalOid' IS NOT DISTINCT FROM v_schedule->>'receiverPrincipalOid'"));
  assert.ok(!body.includes("v_grant->>'claimantCredentialEpoch' IS NOT DISTINCT FROM v_schedule->>'credentialEpoch'"));
  assert.ok(!body.includes("v_grant->>'claimantLaunchEpoch' IS NOT DISTINCT FROM v_schedule->>'launchEpoch'"));
  assert.ok(body.includes('authenticate the complete worker principal/credential/launch'));
  assert.ok(body.includes('global lock order before the resource and input-domain pins'));
  assert.ok(body.indexOf(scopeGuard) < body.lastIndexOf("RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\nEXCEPTION"));
  assert.ok(!body.includes('FROM public."Pro273QualifierAllocation"'));
  assert.ok(!body.includes('FROM public."Pro273QualifierControl"'));
  assert.ok(migration.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION ${signature}`));
  assert.ok(migration.includes("RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'"));
  assert.ok(roles.includes("RAISE EXCEPTION 'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE'"));
  assert.ok(roles.includes("RAISE EXCEPTION 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE'"));
});

test('installer authority Source routes and rechecks every trust before acquisition', () => {
  // Inert text checks: no SQL parsing, execution, or installed-authority claim.
  const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = migration.split('CREATE FUNCTION public.pro273_installer_acquire_authority')[1].split('REVOKE ALL ON FUNCTION public.pro273_installer_acquire_authority')[0];
  const ordered = body.indexOf('FOR v_key IN SELECT DISTINCT');
  assert.ok(ordered >= 0);
  for (const name of ['v_hint', 'v_observation_hint', 'v_input_hint', 'v_obs_slot_hint'])
    assert.match(body.slice(ordered, body.indexOf('END LOOP;', ordered)), new RegExp(name + '\\."(?:observerTrustId|trustId)"'));
  for (const name of ['v_input', 'v_binding', 'v_claim', 'v_obs_claim', 'v_obs_slot', 'v_expected', 'v_observation'])
    assert.ok(body.includes(`${name} IS DISTINCT FROM ${name === 'v_expected' ? 'v_hint' : name + '_hint'}`), name);
  assert.match(body, /COLLATE "C"[\s\S]*ORDER BY trust_id,generation/);
  assert.match(body, /v_obs_slot\."observerTrustId"[\s\S]*IS DISTINCT FROM \(v_observation\."trustId"/);
  for (const term of ['CONTROL_ALLOCATOR', 'INSTALLER_CONSTRUCTOR_INPUT', 'supplierPrincipal', 'revoked', 'validFrom', 'validUntil', 'pro273_installer_slot_matches']) assert.ok(body.includes(term), term);
  assert.ok(body.indexOf('v_input IS DISTINCT FROM v_input_hint') < body.indexOf('INTO STRICT v_input_trust'));
});

test('immutable installer audit Source retains fail-closed gates and catalog checks', () => {
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const audit = roles.slice(roles.indexOf('-- Conservative audit candidate only.'), roles.indexOf("RAISE EXCEPTION 'PRO273_SEL_AUDIT_BODY_AND_KEY_REVIEW_REQUIRED'"));
  assert.ok(roles.indexOf("RAISE EXCEPTION 'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE'") < roles.indexOf('-- Conservative audit candidate only.'));
  assert.ok(roles.indexOf("RAISE EXCEPTION 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE'") < roles.indexOf('-- Conservative audit candidate only.'));
  for (const relation of ['Pro273ControlPlaneInstallerExpectation','Pro273InstallerProcessObservation','Pro273InstallerSlotBinding','Pro273InstallerSessionClaim','Pro273InstallerDispatchAttempt','Pro273InstallerDelivery','Pro262CapacityBootstrapBaseline','Pro262CapacityBootstrapTrust','Pro262CapacityObserverInputReservation','Pro262CapacityObserverInputClaim','Pro262CapacityControlCharge']) assert.ok(audit.includes(`'${relation}'`), relation);
  for (const term of ['c.relowner=v_owner','p.proowner=v_owner',"t.tgtype=27 AND t.tgenabled='O'",'col.attacl',"'TRUNCATE','TRIGGER'",'pg_default_acl','pg_auth_members','WITH RECURSIVE','pg_namespace',"a.privilege_type='CREATE'",'p.prosecdef',"a.privilege_type='EXECUTE'"]) assert.ok(audit.includes(term), term);
  assert.match(audit, /END LOOP;\s*-- Source creates ordinary triggers\.[^\n]*\n\s*-- sessions;[^\n]*\n\s*RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRIGGER_REPLICATION_BYPASS_UNRESOLVED';/);
  assert.match(roles, /RAISE EXCEPTION 'PRO273_SEL_AUDIT_BODY_AND_KEY_REVIEW_REQUIRED'/);
});

test('creation history remains unknown and defaults are limited to exact authorized creators', () => {
  // Source text only: no database access, SQL parsing, or installation claim.
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const audit = roles.slice(roles.indexOf('-- Conservative audit candidate only.'), roles.indexOf("RAISE EXCEPTION 'PRO273_SEL_AUDIT_BODY_AND_KEY_REVIEW_REQUIRED'"));
  for (const term of ['v_approved_installation_executor OID := NULL', 'v_authorized_creators OID[] := NULL',
    'v_creation_ownership_transitions_proven BOOLEAN := FALSE', 'PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN',
    'pg_catalog.cardinality(v_authorized_creators)=0', 'pg_catalog.array_position(v_authorized_creators,NULL) IS NOT NULL',
    'd.defaclrole=ANY(v_authorized_creators)', 'pg_catalog.unnest(v_authorized_creators) AS creator(oid)',
    "pg_catalog.acldefault('f',creator.oid)"]) assert.ok(audit.includes(term), term);
  assert.match(audit, /IF v_approved_installation_executor IS NULL OR v_authorized_creators IS NULL\s+OR pg_catalog\.cardinality\(v_authorized_creators\)=0\s+OR pg_catalog\.array_position\(v_authorized_creators,NULL\) IS NOT NULL\s+OR v_creation_ownership_transitions_proven IS DISTINCT FROM TRUE\s+THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN'; END IF;/);
  assert.ok(audit.indexOf('PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN') < audit.indexOf('d.defaclrole=ANY(v_authorized_creators)'));
  for (const term of ['CURRENT_USER', 'SESSION_USER', 'FROM pg_catalog.pg_roles creator']) assert.ok(!audit.includes(term), term);
  for (const term of ['c.relowner=v_owner', 'p.proowner=v_owner', 'PRO273_SEL_AUDIT_RELATION_ACL', 'PRO273_SEL_AUDIT_DEFINER_PATH']) assert.ok(audit.includes(term), term);
});

test('immutable audit candidates match migration triggers and fixed observer edge', () => {
  const read = (path: string) => readFileSync(join(__dirname, '../prisma', path), 'utf8');
  const roles = read('roles/pro273_selection_completion_roles.sql');
  for (const [source, fn, names] of [
    [read('migrations/20261028160000_pro273_selection_completion/migration.sql'), 'pro273_sel_immutable', ['Pro273ControlPlaneInstallerExpectation', 'Pro273InstallerProcessObservation', 'Pro273InstallerSlotBinding', 'Pro273InstallerSessionClaim', 'Pro273InstallerDispatchAttempt', 'Pro273InstallerDelivery']],
    [read('migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'pro262_capacity_immutable', ['Pro262CapacityBootstrapBaseline', 'Pro262CapacityBootstrapTrust', 'Pro262CapacityObserverInputReservation', 'Pro262CapacityObserverInputClaim', 'Pro262CapacityControlCharge']],
  ] as const) for (const name of names) {
    assert.ok(source.includes(`CREATE TRIGGER "${name}_immutable" BEFORE UPDATE OR DELETE ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.${fn}();`), name);
    assert.ok(roles.includes(`('${name}','${fn}')`), name);
  }
  for (const literal of [
    'v_approved_schema_owner OID := NULL', 'PRO273_SEL_AUDIT_SCHEMA_OWNER_APPROVAL_REQUIRED',
    'GRANT EXECUTE ON FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) TO pro262_install_observer;',
    'ALTER FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) OWNER TO pro262_capacity_owner;',
    "('public.pro273_installer_accept_process_observation(text,text,jsonb,bytea)','pro262_install_observer','text'",
    "a.grantee=pg_catalog.to_regrole('pro262_install_observer')", 'a.grantor=v_owner', 'NOT a.is_grantable',
  ]) assert.ok(roles.includes(literal), literal);
  assert.ok(!roles.includes('n.nspowner<>v_owner'));
});

test('reviewed writer and private helper identities bind final source and remain fail closed', () => {
  // Inert source bytes only; this does not parse or execute SQL.
  const root = join(__dirname, '../prisma');
  const audit = readFileSync(join(root, 'roles/pro273_selection_completion_roles.sql'), 'utf8');
  const supplier = readFileSync(join(root, 'migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8').replace(/\r\n/g, '\n');
  const selection = readFileSync(join(root, 'migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8').replace(/\r\n/g, '\n');
  const entries = [
    [supplier, 'pro262_capacity_control_prepare', 'text,text,jsonb', 'pro262_control_allocator', 'void'],
    [selection, 'pro262_capacity_provision_observer_input', 'jsonb', 'pro262_qualification_publisher', 'text'],
    [selection, 'pro262_capacity_claim_observer_input', 'text,text,text', 'pro262_control_allocator', 'jsonb'],
    [selection, 'pro273_installer_accept_process_observation', 'text,text,jsonb,bytea', 'pro262_install_observer', 'text'],
    [supplier, 'pro262_capacity_control_charge', 'text,text,text', null, 'void'],
    [selection, 'pro273_installer_slot_matches', 'text', null, 'boolean'],
    [selection, 'pro262_capacity_assert_observer_claim', 'text,text,text,numeric', null, 'void'],
  ] as const;
  for (const [source, name, args, grantee, result] of entries) {
    const start = source.indexOf('FUNCTION public.' + name + '(');
    assert.ok(start >= 0, name);
    const bodyStart = source.indexOf('AS $$', start) + 'AS $$'.length;
    const bodyEnd = source.indexOf('$$;', bodyStart);
    assert.ok(bodyStart >= 'AS $$'.length && bodyEnd > bodyStart, name);
    const hash = createHash('sha256').update(source.slice(bodyStart, bodyEnd), 'utf8').digest('hex');
    const expected = "('public." + name + '(' + args + ")','" + (grantee ? grantee + "','" : '') + result + "','" + hash + "')";
    assert.ok(audit.includes(expected), name);
  }
  for (const term of ['PRO273_SEL_AUDIT_WRITER_DEFINITION', 'PRO273_SEL_AUDIT_WRITER_EXECUTE',
    'PRO273_SEL_AUDIT_PRIVATE_HELPER', 'PRO273_SEL_AUDIT_TRANSITIVE_EFFECTS_UNPROVEN',
    "pg_catalog.has_function_privilege(r.oid,v_entry,'EXECUTE')", 'a.grantor=v_owner',
    'a.is_grantable', "p.proconfig=ARRAY['search_path=pg_catalog']", 'p.prorettype=pg_catalog.to_regtype(v_return_type)',
    'p.oid<>v_entry', 'updating ControlBaseline spent', 'atomically inserts reservation and',
    'Trigger/rule, other-owner', 'PRO273_SEL_AUDIT_TRIGGER_REPLICATION_BYPASS_UNRESOLVED',
    'PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN', 'PRO273_SEL_AUDIT_SCHEMA_OWNER_APPROVAL_REQUIRED']) assert.ok(audit.includes(term), term);
});

test('backend identity dependency chain pins source, ownership and bounded execute paths', () => {
  // Compare inert source bytes only; this does not validate installed SQL.
  const root = join(__dirname, '../prisma');
  const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
  const audit = read('roles/pro273_selection_completion_roles.sql');
  const supplier = read('migrations/20261028140000_pro262_capacity_supplier/migration.sql');
  const attestation = read('migrations/20261028120000_pro311_result_attestation/migration.sql');
  for (const [source, name, args, owner, grantee, result] of [
    [supplier, 'pro262_capacity_backend_start', '', 'huroof_pg_owner', 'pro262_capacity_owner', 'timestamptz'],
    [supplier, 'pro262_capacity_backend_live', 'name,integer,timestamptz', 'huroof_pg_owner', 'pro262_capacity_owner', 'boolean'],
    [attestation, 'pro311_own_backend_start', '', 'pro311_activity_reader', 'huroof_pg_owner', 'timestamptz'],
    [attestation, 'pro311_backend_is_live', 'name,integer,timestamptz', 'pro311_activity_reader', 'huroof_pg_owner', 'boolean'],
  ]) {
    const start = source.indexOf('FUNCTION public.' + name + '(');
    assert.ok(start >= 0, name);
    const bodyStart = source.indexOf('AS $$', start) + 'AS $$'.length;
    const bodyEnd = source.indexOf('$$;', bodyStart);
    assert.ok(bodyStart >= 'AS $$'.length && bodyEnd > bodyStart, name);
    const hash = createHash('sha256').update(source.slice(bodyStart, bodyEnd), 'utf8').digest('hex');
    assert.ok(audit.includes(`('public.${name}(${args})','${owner}','${grantee}','${result}','${hash}')`), name);
  }
  // Different grantors can produce both a safe and an unsafe matching row.
  assert.match(audit, /OR NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_auth_members m WHERE m\.member=v_reader AND m\.roleid=v_stats\s+AND m\.inherit_option AND NOT m\.set_option AND NOT m\.admin_option\)\s+OR EXISTS \(SELECT 1 FROM pg_catalog\.pg_auth_members m WHERE m\.member=v_reader AND m\.roleid=v_stats\s+AND \(m\.admin_option OR m\.set_option OR NOT m\.inherit_option\)\)/);
  const supplierRoles = read('roles/pro262_capacity_supplier_roles.sql');
  const attestationRoles = read('roles/pro311_result_attestation_roles.sql');
  for (const name of ['pro262_capacity_backend_start()', 'pro262_capacity_backend_live(NAME,INTEGER,TIMESTAMPTZ)'])
    assert.ok(supplierRoles.includes(`ALTER FUNCTION public.${name} OWNER TO huroof_pg_owner;`), name);
  for (const name of ['pro311_own_backend_start()', 'pro311_backend_is_live(NAME,INTEGER,TIMESTAMPTZ)'])
    assert.ok(attestationRoles.includes(`ALTER FUNCTION public.${name} OWNER TO pro311_activity_reader;`), name);
  for (const term of ['PRO273_SEL_AUDIT_BACKEND_DEPENDENCY_DEFINITION', 'PRO273_SEL_AUDIT_BACKEND_DEPENDENCY_EXECUTE',
    'PRO273_SEL_AUDIT_ACTIVITY_VISIBILITY', "l.lanname='sql'", "d.deptype='e'", 'a.grantor=v_dependency_owner',
    "pg_catalog.pg_has_role(r.oid,v_dependency_owner,'USAGE')", 'm.inherit_option AND NOT m.set_option AND NOT m.admin_option',
    'm.member=v_stats', 'roleid=v_reader AND member<>v_reader', 'PRO273_SEL_AUDIT_TRANSITIVE_EFFECTS_UNPROVEN',
    'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE', 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE']) assert.ok(audit.includes(term), term);
});

test('backend owner contract rejects unsafe attributes, assumption and unknown outgoing membership', () => {
  // Inert source checks only; approved membership and installed state remain unknown.
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const policy = readFileSync(join(__dirname, '../prisma/roles/eng03_05_content_admin_roles.sql'), 'utf8');
  assert.ok(policy.includes("rolname='huroof_pg_owner' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolinherit"));
  for (const term of ['v_huroof_owner_memberships JSONB := NULL',
    'r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls',
    'roleid=v_huroof_owner AND member<>v_huroof_owner',
    'm.member=v_huroof_owner) IS DISTINCT FROM v_huroof_owner_memberships',
    'PRO273_SEL_AUDIT_HUROOF_OWNER_UNSAFE', 'PRO273_SEL_AUDIT_HUROOF_OWNER_MEMBERSHIP_UNPROVEN',
    'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE', 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE',
    'PRO273_SEL_AUDIT_TRANSITIVE_EFFECTS_UNPROVEN']) assert.ok(roles.includes(term), term);
});

test('startup qualification decodes canonical bounded bytes as data, rejecting malformed and inconsistent records', () => {
  const hash = 'a'.repeat(64), time = '2026-01-01T00:00:00.000Z', until = '2027-01-01T00:00:00.000Z';
  const vector = Object.fromEntries(['reservedBackendBytes','reservedSharedBytes','reservedTemporaryBytes','maxInputBytes','maxOutputBytes','maxAllocationBytes','stackBytes','parentBytes','maxProcessCount','maxBackendCount','maxLaunchAttempts','maxEvents','backendProcessBytes','qualifierRuntimeBytes','launcherSupervisorBytes','retainedParentBytes','driverSocketIpcBytes','inputEvidenceSerializationBytes','primitiveParserCacheBytes','rollbackCleanupBytes','sharedRuntimeBytes'].map(k => [k,'1']));
  vector.reservedBackendBytes = '8'; vector.reservedSharedBytes = '2';
  vector.maxLaunchAttempts = '3'; vector.maxEvents = '3'; vector.maxProcessCount = '3';
  const limits = Object.fromEntries(['maxRegistryValueBytes','maxSecurityDescriptorBytes','maxManifestBytes','maxManifestEntries','maxDependencies','maxHandles','maxTokenGroups','maxTokenPrivileges','maxPermitBytes','maxChannelFrameBytes','maxChannelFrames','maxDiagnosticBytes','maxWorkspaceBytes','maxElapsedMillis'].map(k => [k,'1']));
  limits.maxChannelFrames = '6';
  const attempt = (id:string, parentId:string) => ({id,parentId,ordinal:'1',holderReservationId:'holder',prepaymentReceiptHash:hash,eventId:`event_${id}`,chargeKind:'kind',chargeEventKey:`charge_${id}`,chargeBindingHash:hash,fenceId:`fence_${id}`});
  const q = {schemaVersion:'pro273-installer-startup-qualification-v1',qualificationId:'q',authorityEpoch:'18446744073709551615',installationGeneration:'1',hostIdentity:'b'.repeat(32),bootIdentity:'c'.repeat(32),serviceIdentity:{serviceName:'HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028',serviceSid:'S-1-5-80-1-2-3-4-5'},validFrom:time,validUntil:until,sourceClosureHash:hash,installationClosureHash:hash,receiverClosureHash:hash,launcherManifestHash:hash,nodeManifestHash:hash,psqlManifestHash:hash,loaderQualificationHash:hash,fenceQualificationHash:hash,holder:{reservationId:'holder',reservationRecordHash:hash,prepaymentReceiptHash:hash,physicalIdentity:'physical',physicalProofIdentity:'proof',partitionId:'partition',partitionKind:'NON_QUALIFIER_BASELINE',sourceClosureHash:hash,installationClosureHash:hash,validFrom:time,validUntil:until,vector},serviceStart:attempt('service','holder'),nodeLaunch:attempt('node','service'),psqlAttempt:attempt('psql','node'),limits};
  const canonical = (v: any): string => typeof v === 'string' ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const wire = (v: unknown) => Buffer.from(canonical(v));
  assert.equal(decodeStartupQualification(wire(q)).authorityEpoch, '18446744073709551615');
  for (const key of ['maxLaunchAttempts','maxEvents','maxProcessCount']) {
    assert.throws(() => decodeStartupQualification(wire({...q,holder:{...q.holder,vector:{...vector,[key]:'2'}}})), /CAPACITY_UNAVAILABLE/, key);
  }
  assert.throws(() => decodeStartupQualification(wire({...q,limits:{...limits,maxChannelFrames:'5'}})), /CAPACITY_UNAVAILABLE/, 'maxChannelFrames');
  const invalid = [ {...q,authorityEpoch:'18446744073709551616'}, {...q,authorityEpoch:'01'}, {...q,extra:'x'}, {...q,nodeLaunch:{...q.nodeLaunch,parentId:'wrong'}}, {...q,psqlAttempt:{...q.psqlAttempt,fenceId:q.nodeLaunch.fenceId}}, {...q,psqlAttempt:{...q.psqlAttempt,chargeEventKey:q.nodeLaunch.chargeEventKey}}, {...q,holder:{...q.holder,vector:{...vector,reservedBackendBytes:'7'}}}, {...q,validFrom:'2026-02-30T00:00:00.000Z'} ];
  for (const value of invalid) assert.throws(() => decodeStartupQualification(wire(value)), /CAPACITY_UNAVAILABLE/);
  const good = canonical(q);
  for (const bytes of [Buffer.from(good.replace('"qualificationId":', '"qualificationId":"x","qualificationId":')), Buffer.from(good.replace('"qualificationId":', '"qualificatio\\u006eId":"x","qualificationId":')), Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),wire(q)]), Buffer.from(`${good}\n`), Buffer.alloc(65537, 32), Buffer.from([0xc3,0x28])]) assert.throws(() => decodeStartupQualification(bytes), /CAPACITY_UNAVAILABLE/);
});

test('fragment collector handles every split, owns output, and spends on excess or EOF', () => {
  const wire = Buffer.from([3, 0, 0, 0, 11, 22, 33]);
  for (let split = 1; split < wire.length; split++) {
    const collector = installerChannelFrameCollector(3n);
    const first = Uint8Array.from(wire.subarray(0, split));
    const second = Uint8Array.from(wire.subarray(split));
    assert.equal(collector.push(first), undefined);
    const result = collector.push(second)!;
    assert.deepEqual(result, wire);
    first.fill(0); second.fill(0);
    assert.deepEqual(result, wire);
    assert.throws(() => collector.push(wire), /CAPACITY_UNAVAILABLE/);
    assert.throws(() => collector.end(), /CAPACITY_UNAVAILABLE/);
  }
  for (let split = 1; split < wire.length; split++) {
    const incomplete = installerChannelFrameCollector(3n);
    incomplete.push(wire.subarray(0, split));
    assert.throws(() => incomplete.end(), /CAPACITY_UNAVAILABLE/);
    assert.throws(() => incomplete.push(wire.subarray(split)), /CAPACITY_UNAVAILABLE/);
  }
  const excess = installerChannelFrameCollector(3n);
  assert.throws(() => excess.push(Buffer.concat([wire, Buffer.from([0])])), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => excess.push(wire), /CAPACITY_UNAVAILABLE/);
});

test('fragment collector avoids caller slicing and rejects caught nested push or end', () => {
  const wire = Uint8Array.from([3, 0, 0, 0, 11, 22, 33]);
  for (const operation of ['push', 'end'] as const) {
    for (let split = 1; split < wire.length; split++) {
      const collector = installerChannelFrameCollector(3n);
      collector.push(wire.slice(0, split));
      let invoked = false;
      class Hostile extends Uint8Array {
        override get byteLength(): number {
          invoked = true;
          try { if (operation === 'push') collector.push(new Uint8Array()); else collector.end(); } catch {}
          return super.byteLength;
        }
        override subarray(): Uint8Array { throw new Error('caller slice invoked'); }
      }
      assert.throws(() => collector.push(new Hostile(wire.slice(split))), /CAPACITY_UNAVAILABLE/);
      assert.equal(invoked, true);
      assert.throws(() => collector.push(wire), /CAPACITY_UNAVAILABLE/);
    }
  }
  for (const operation of ['push', 'end'] as const) {
    for (let split = 1; split < wire.length; split++) {
      const collector = installerChannelFrameCollector(3n);
      collector.push(wire.slice(0, split));
      let sliced = false;
      class NoSlice extends Uint8Array {
        override subarray(begin?: number, end?: number): Uint8Array {
          sliced = true;
          try { if (operation === 'push') collector.push(new Uint8Array()); else collector.end(); } catch {}
          return super.subarray(begin, end);
        }
      }
      assert.deepEqual(collector.push(new NoSlice(wire.slice(split))), Buffer.from(wire));
      assert.equal(sliced, false);
    }
  }
});

test('inherited channel framing checks exact canonical bytes and identities without granting authority', () => {
  const expected = {stage:'PERMIT_VERIFIED' as const, nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const payload = {permitHash:'d'.repeat(64)};
  const frame = {schemaVersion:'pro273-installer-channel-v1', ...expected, sequence:'2', payload};
  const canonical = (value: unknown): string => value && typeof value === 'object' && !Array.isArray(value)
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}` : JSON.stringify(value);
  const wire = (text: string | Buffer) => { const body = Buffer.from(text); const prefix = Buffer.alloc(4); prefix.writeUInt32LE(body.length); return Buffer.concat([prefix, body]); };
  const good = wire(canonical(frame));
  assert.doesNotThrow(() => checkInstallerChannelFrame(good, expected, payload, 4096n));
  for (const bad of [wire(JSON.stringify(frame)), wire(canonical({...frame, sequence:'1'})), wire(canonical({...frame, extra:'x'})), wire(canonical({...frame, payload:{...payload, extra:'x'}})), Buffer.concat([good, Buffer.from('x')]), wire(canonical({...frame, servicePid:'4294967296'}))])
    assert.throws(() => checkInstallerChannelFrame(bad, expected, payload, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInstallerChannelFrame(good, expected, payload, 1n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInstallerChannelFrame(wire(canonical(frame).replace('"stage":', '"stage":"PERMIT_VERIFIED","stage":')), expected, payload, 4096n), /CAPACITY_UNAVAILABLE/);
  const canonicalBody = Buffer.from(canonical(frame));
  assert.throws(() => checkInstallerChannelFrame(wire(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalBody])), expected, payload, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInstallerChannelFrame(wire(Buffer.concat([canonicalBody.subarray(0, 1), Buffer.from([0xc3, 0x28]), canonicalBody.subarray(1)])), expected, payload, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInstallerChannelFrame(wire(canonical(frame).replace('"stage":', '"st\\u0061ge":"PERMIT_VERIFIED","stage":')), expected, payload, 4096n), /CAPACITY_UNAVAILABLE/);
});

test('channel bounds actual input before copying and spends caught reentry', () => {
  const binding = {nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const good = encodeInstallerChannelFrame(binding, 'HELLO', {}, 4096n);
  let converted = false;
  class Liar extends Uint8Array {
    get byteLength() { return good.length; }
    [Symbol.iterator](): Uint8Array<ArrayBufferLike>[typeof Symbol.iterator] { converted = true; throw new Error('conversion'); }
    slice(): this { converted = true; throw new Error('slice'); }
  }
  const oversized = new Liar(8192); oversized.set(good);
  assert.throws(() => checkInstallerChannelFrame(oversized, {...binding,stage:'HELLO'}, {}, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.equal(converted, false);
  const state = installerChannelConversation(binding, 4096n);
  const proxy = new Proxy(good, {getPrototypeOf(target) {
    try { state.accept(good, 'HELLO', {}); } catch { /* attempted reentry is terminal even if caught */ }
    return Reflect.getPrototypeOf(target);
  }});
  assert.throws(() => state.accept(proxy, 'HELLO', {}), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => state.accept(good, 'HELLO', {}), /CAPACITY_UNAVAILABLE/);
});

test('encoder rejects invalid escaped fields and tiny limits before Buffer allocation', () => {
  const binding = {nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const originalFrom = Buffer.from, originalAlloc = Buffer.alloc;
  let allocations = 0;
  try {
    Buffer.from = ((...args: unknown[]) => { allocations++; return (originalFrom as Function)(...args); }) as typeof Buffer.from;
    Buffer.alloc = ((...args: unknown[]) => { allocations++; return (originalAlloc as Function)(...args); }) as typeof Buffer.alloc;
    for (const bad of ['"'.repeat(120), '\\'.repeat(120), '\u0001'.repeat(120), '\ud800'.repeat(120)]) {
      assert.throws(() => encodeInstallerChannelFrame({...binding,serviceStartId:bad}, 'HELLO', {}, 8n), /CAPACITY_UNAVAILABLE/);
    }
    assert.throws(() => encodeInstallerChannelFrame(binding, 'HELLO', {}, 8n), /CAPACITY_UNAVAILABLE/);
    assert.equal(allocations, 0);
  } finally { Buffer.from = originalFrom; Buffer.alloc = originalAlloc; }
  const wire = encodeInstallerChannelFrame(binding, 'HELLO', {}, 4096n);
  assert.equal(encodeInstallerChannelFrame(binding, 'HELLO', {}, BigInt(wire.length - 4)).length, wire.length);
  assert.throws(() => encodeInstallerChannelFrame(binding, 'HELLO', {}, BigInt(wire.length - 5)), /CAPACITY_UNAVAILABLE/);
});

test('staged channel snapshots bind prepaid projections and capture later payloads once', () => {
  const hash = 'a'.repeat(64), time = '2026-01-01T00:00:00.000Z', until = '2027-01-01T00:00:00.000Z';
  const vector = Object.fromEntries(['reservedBackendBytes','reservedSharedBytes','reservedTemporaryBytes','maxInputBytes','maxOutputBytes','maxAllocationBytes','stackBytes','parentBytes','maxProcessCount','maxBackendCount','maxLaunchAttempts','maxEvents','backendProcessBytes','qualifierRuntimeBytes','launcherSupervisorBytes','retainedParentBytes','driverSocketIpcBytes','inputEvidenceSerializationBytes','primitiveParserCacheBytes','rollbackCleanupBytes','sharedRuntimeBytes'].map(k => [k,'1']));
  Object.assign(vector, {reservedBackendBytes:'8',reservedSharedBytes:'2',maxLaunchAttempts:'3',maxEvents:'3',maxProcessCount:'3'});
  const limits = Object.fromEntries(['maxRegistryValueBytes','maxSecurityDescriptorBytes','maxManifestBytes','maxManifestEntries','maxDependencies','maxHandles','maxTokenGroups','maxTokenPrivileges','maxPermitBytes','maxChannelFrameBytes','maxChannelFrames','maxDiagnosticBytes','maxWorkspaceBytes','maxElapsedMillis'].map(k => [k,'1']));
  Object.assign(limits,{maxChannelFrames:'6',maxChannelFrameBytes:'4096'});
  const attempt = (id:string, parentId:string) => ({id,parentId,ordinal:'1',holderReservationId:'holder',prepaymentReceiptHash:hash,eventId:`event_${id}`,chargeKind:'kind',chargeEventKey:`charge_${id}`,chargeBindingHash:hash,fenceId:`fence_${id}`});
  const q = {schemaVersion:'pro273-installer-startup-qualification-v1',qualificationId:'q',authorityEpoch:'1',installationGeneration:'1',hostIdentity:'b'.repeat(32),bootIdentity:'c'.repeat(32),serviceIdentity:{serviceName:'HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028',serviceSid:'S-1-5-80-1-2-3-4-5'},validFrom:time,validUntil:until,sourceClosureHash:hash,installationClosureHash:hash,receiverClosureHash:hash,launcherManifestHash:hash,nodeManifestHash:hash,psqlManifestHash:hash,loaderQualificationHash:hash,fenceQualificationHash:hash,holder:{reservationId:'holder',reservationRecordHash:hash,prepaymentReceiptHash:hash,physicalIdentity:'physical',physicalProofIdentity:'proof',partitionId:'partition',partitionKind:'NON_QUALIFIER_BASELINE',sourceClosureHash:hash,installationClosureHash:hash,validFrom:time,validUntil:until,vector},serviceStart:attempt('service','holder'),nodeLaunch:attempt('node','service'),psqlAttempt:attempt('psql','node'),limits};
  const canonical = (v: any): string => typeof v === 'string' ? JSON.stringify(v) : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  const raw = Buffer.from(canonical(q)), qualificationHash = createHash('sha256').update(raw).digest('hex');
  const binding = {nonce:'d'.repeat(64),serviceStartId:'service',nodeLaunchId:'node',psqlAttemptId:'psql',servicePid:'1',serviceCreationTime:'2',nodePid:'3',nodeCreationTime:'4',bootIdentity:q.bootIdentity,qualificationHash};
  const funding = {qualificationId:'q',qualificationHash,reservationId:'holder',reservationRecordHash:hash,prepaymentReceiptHash:hash,serviceStartId:'service',nodeLaunchId:'node',psqlAttemptId:'psql'};
  const receipt = {attemptId:'psql',eventId:'event_psql',chargeKind:'kind',chargeEventKey:'charge_psql',chargeBindingHash:hash,prepaymentReceiptHash:hash,fenceId:'fence_psql'};
  const make = () => installerChannelSnapshots(raw,binding,funding,receipt,'psql',4096n);
  const frame = (stage: Parameters<typeof encodeInstallerChannelFrame>[1], payload: Record<string,string>) => encodeInstallerChannelFrame(binding,stage,payload,4096n);
  const state = make();
  state.hello(frame('HELLO',{}));
  checkInstallerChannelFrame(state.permitVerified(hash), {...binding,stage:'PERMIT_VERIFIED'}, {permitHash:hash},4096n);
  state.launchReady(frame('PSQL_LAUNCH_READY',{permitHash:hash,psqlFenceId:'fence_psql'}));
  checkInstallerChannelFrame(state.psqlStarted('5','6'), {...binding,stage:'PSQL_STARTED'}, {psqlPid:'5',psqlCreationTime:'6'},4096n);
  const delivery = {deliveryReceiptHash:'e'.repeat(64),inputHash:'f'.repeat(64),inputLength:'7'};
  checkInstallerChannelFrame(state.dispatchCheck(delivery.deliveryReceiptHash,delivery.inputHash,delivery.inputLength), {...binding,stage:'DISPATCH_CHECK'},delivery,4096n);
  state.dispatchCurrent(frame('DISPATCH_CURRENT',delivery));
  assert.throws(() => state.dispatchCurrent(frame('DISPATCH_CURRENT',delivery)), /CAPACITY_UNAVAILABLE/);
  for (const bad of [{...receipt,fenceId:'other'}, {...receipt,prepaymentReceiptHash:'0'.repeat(64)}, {...receipt,eventId:'other'}]) assert.throws(() => installerChannelSnapshots(raw,binding,funding,bad,'psql',4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerChannelSnapshots(raw,binding,{...funding,reservationId:'other'},receipt,'psql',4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerChannelSnapshots(raw,binding,funding,receipt,'other',4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerChannelSnapshots(raw,binding,funding,receipt,'psql',4097n), /CAPACITY_UNAVAILABLE/);
  const failed = make(); failed.hello(frame('HELLO',{})); failed.permitVerified(hash);
  assert.throws(() => failed.launchReady(frame('PSQL_LAUNCH_READY',{permitHash:hash,psqlFenceId:'other'})), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => failed.launchReady(frame('PSQL_LAUNCH_READY',{permitHash:hash,psqlFenceId:'fence_psql'})), /CAPACITY_UNAVAILABLE/);
  const early = make(); assert.throws(() => early.psqlStarted('5','6'), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => early.hello(frame('HELLO',{})), /CAPACITY_UNAVAILABLE/);
  const changed = make(); changed.hello(frame('HELLO',{})); changed.permitVerified(hash);
  changed.launchReady(frame('PSQL_LAUNCH_READY',{permitHash:hash,psqlFenceId:'fence_psql'})); changed.psqlStarted('5','6');
  changed.dispatchCheck(delivery.deliveryReceiptHash,delivery.inputHash,delivery.inputLength);
  assert.throws(() => changed.dispatchCurrent(frame('DISPATCH_CURRENT',{...delivery,inputHash:'0'.repeat(64)})), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => changed.dispatchCurrent(frame('DISPATCH_CURRENT',delivery)), /CAPACITY_UNAVAILABLE/);
  const mutable = {...binding}, owned = installerChannelSnapshots(raw,mutable,funding,receipt,'psql',4096n);
  mutable.nonce = '0'.repeat(64);
  owned.hello(frame('HELLO',{}));
});

test('channel conversation captures permit and dispatch getters once and owns accepted values', () => {
  const binding = {nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const permit = 'd'.repeat(64), other = '0'.repeat(64);
  const delivery = {deliveryReceiptHash:'e'.repeat(64),inputHash:'f'.repeat(64),inputLength:'7'};
  const frame = (stage: Parameters<typeof encodeInstallerChannelFrame>[1], payload: Record<string,string>) => encodeInstallerChannelFrame(binding, stage, payload, 4096n);
  const state = installerChannelConversation(binding, 4096n);
  state.accept(frame('HELLO', {}), 'HELLO', {});
  let permitReads = 0;
  const permitPayload = {get permitHash() { return ++permitReads === 1 ? permit : other; }};
  state.accept(frame('PERMIT_VERIFIED', {permitHash:permit}), 'PERMIT_VERIFIED', permitPayload);
  assert.equal(permitReads, 1);
  state.accept(frame('PSQL_LAUNCH_READY', {permitHash:permit,psqlFenceId:'fence'}), 'PSQL_LAUNCH_READY', {permitHash:permit,psqlFenceId:'fence'});
  state.accept(frame('PSQL_STARTED', {psqlPid:'5',psqlCreationTime:'6'}), 'PSQL_STARTED', {psqlPid:'5',psqlCreationTime:'6'});
  let dispatchReads = 0;
  const dispatchPayload = {...delivery, get inputHash() { return ++dispatchReads === 1 ? delivery.inputHash : other; }};
  state.accept(frame('DISPATCH_CHECK', delivery), 'DISPATCH_CHECK', dispatchPayload);
  assert.equal(dispatchReads, 1);
  delivery.inputHash = other;
  const accepted = {...delivery,inputHash:'f'.repeat(64)};
  state.accept(frame('DISPATCH_CURRENT', accepted), 'DISPATCH_CURRENT', accepted);
});

test('channel conversation spends caught payload accessor reentry and rejects extra own keys', () => {
  const binding = {nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const frame = (stage: Parameters<typeof encodeInstallerChannelFrame>[1], payload: Record<string,string>) => encodeInstallerChannelFrame(binding, stage, payload, 4096n);
  const state = installerChannelConversation(binding, 4096n), hello = frame('HELLO', {}), hash = 'd'.repeat(64);
  state.accept(hello, 'HELLO', {});
  const payload = {get permitHash() { try { state.accept(hello, 'HELLO', {}); } catch {} return hash; }};
  assert.throws(() => state.accept(frame('PERMIT_VERIFIED', {permitHash:hash}), 'PERMIT_VERIFIED', payload), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => state.accept(frame('PERMIT_VERIFIED', {permitHash:hash}), 'PERMIT_VERIFIED', {permitHash:hash}), /CAPACITY_UNAVAILABLE/);
  const extra = installerChannelConversation(binding, 4096n);
  assert.throws(() => extra.accept(hello, 'HELLO', Object.defineProperty({}, 'hidden', {value:'x'})), /CAPACITY_UNAVAILABLE/);
});

test('channel conversation rejects replay, cross-stage changes and retries after failure', () => {
  const binding = {nonce:'a'.repeat(64), serviceStartId:'service', nodeLaunchId:'node', psqlAttemptId:'psql', servicePid:'1', serviceCreationTime:'2', nodePid:'3', nodeCreationTime:'4', bootIdentity:'b'.repeat(32), qualificationHash:'c'.repeat(64)};
  const stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','DISPATCH_CHECK','DISPATCH_CURRENT'] as const;
  const payloads: Readonly<Record<string,string>>[] = [{}, {permitHash:'d'.repeat(64)}, {permitHash:'d'.repeat(64),psqlFenceId:'fence'}, {psqlPid:'5',psqlCreationTime:'6'}, {deliveryReceiptHash:'e'.repeat(64),inputHash:'f'.repeat(64),inputLength:'7'}, {deliveryReceiptHash:'e'.repeat(64),inputHash:'f'.repeat(64),inputLength:'7'}];
  const canonical = (value: unknown): string => value && typeof value === 'object' && !Array.isArray(value)
    ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}` : JSON.stringify(value);
  const wire = (index: number, payload: Readonly<Record<string,string>> = payloads[index]) => {
    const body = Buffer.from(canonical({schemaVersion:'pro273-installer-channel-v1',...binding,stage:stages[index],sequence:String(index + 1),payload}));
    const prefix = Buffer.alloc(4); prefix.writeUInt32LE(body.length); return Buffer.concat([prefix, body]);
  };
  const good = installerChannelConversation(binding, 4096n);
  stages.forEach((stage, i) => good.accept(wire(i), stage, payloads[i]));
  assert.throws(() => good.accept(wire(5), stages[5], payloads[5]), /CAPACITY_UNAVAILABLE/);
  const replay = installerChannelConversation(binding, 4096n);
  replay.accept(wire(0), stages[0], payloads[0]);
  assert.throws(() => replay.accept(wire(0), stages[0], payloads[0]), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => replay.accept(wire(1), stages[1], payloads[1]), /CAPACITY_UNAVAILABLE/);
  const mismatch = installerChannelConversation(binding, 4096n);
  mismatch.accept(wire(0), stages[0], payloads[0]); mismatch.accept(wire(1), stages[1], payloads[1]);
  const changed = {permitHash:'0'.repeat(64),psqlFenceId:'fence'};
  assert.throws(() => mismatch.accept(wire(2, changed), stages[2], changed), /CAPACITY_UNAVAILABLE/);
  const dispatch = installerChannelConversation(binding, 4096n);
  stages.slice(0,5).forEach((stage, i) => dispatch.accept(wire(i), stage, payloads[i]));
  const changedDispatch = {...payloads[5],inputHash:'0'.repeat(64)};
  assert.throws(() => dispatch.accept(wire(5, changedDispatch), stages[5], changedDispatch), /CAPACITY_UNAVAILABLE/);
});

const prefix = 'pro273.installer.launch-permit.v1\n';

test('INITIAL receipts correlate closed projections without granting capture authority', () => {
  const expected = {phase:'INITIAL_ADMISSION_COMMITTED' as const, nonce:'n', receiptId:'r', inputClaimId:'i', sessionClaimId:'s', attemptId:'a', receiverIdentity:'receiver'};
  const receipt = {schemaVersion:'pro273-initial-receipt-v1', ...expected, creationTransactionId:'42'};
  assert.doesNotThrow(() => checkInitialReceipt(receipt, expected, 4096n));
  for (const bad of [{...receipt, receiverIdentity:'other'}, {...receipt, extra:'x'}, {...receipt, creationTransactionId:'0'}, {...receipt, creationTransactionId:'18446744073709551616'}, {...receipt, creationTransactionId:42}])
    assert.throws(() => checkInitialReceipt(bad, expected, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInitialReceipt(receipt, expected, 10n), /CAPACITY_UNAVAILABLE/);
  const publication = {phase:'INITIAL_PUBLICATION_COMMITTED' as const, nonce:'n', receiptId:'p', inputClaimId:'i', targetId:'t', coreHash:'a'.repeat(64), capturedHash:'b'.repeat(64), evidenceHash:'c'.repeat(64)};
  const published = {schemaVersion:'pro273-initial-receipt-v1', ...publication, constructionTransactionId:'18446744073709551615'};
  assert.doesNotThrow(() => checkInitialReceipt(published, publication, 4096n));
  assert.throws(() => checkInitialReceipt({...published, capturedHash:'d'.repeat(64)}, publication, 4096n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => checkInitialReceipt({...published, creationTransactionId:'1'}, publication, 4096n), /CAPACITY_UNAVAILABLE/);
});

test('receipt correlation requires the exact phase, nonce, committed identity and closed receipt', () => {
  const expected = {phase:'DELIVERY_RECEIPT' as const, nonce:'n', expectationId:'e', attemptId:'a', sessionClaimId:'s', inputClaimId:'i', eventId:'v'};
  const receipt = {schemaVersion:'pro273-installer-receipt-v1', phase:'DELIVERY_COMMITTED', expectationId:'e', attemptId:'a', sessionClaimId:'s', inputClaimId:'i', eventId:'v', creationTransactionId:'42'};
  const value = {schemaVersion:'pro273-installer-frame-v1', phase:expected.phase, nonce:'n', receipt};
  assert.doesNotThrow(() => checkInstallerReceiptFrame(value, expected));
  for (const bad of [{...value, nonce:'other'}, {...value, extra:true}, {...value, receipt:{...receipt, attemptId:'other'}},
    {...value, receipt:{...receipt, creationTransactionId:'0'}}, {...value, receipt:{...receipt, creationTransactionId:'18446744073709551616'}},
    {...value, receipt:{...receipt, extra:true}}]) assert.throws(() => checkInstallerReceiptFrame(bad, expected), /CAPACITY_UNAVAILABLE/);
  const hashes = {coreHash:'a'.repeat(64), captureHash:'b'.repeat(64), evidenceHash:'c'.repeat(64)};
  const constructor = {...expected, phase:'CONSTRUCTOR_RECEIPT' as const, constructorKind:'CONTROL_PLANE_BASELINE' as const, resultId:'r', ...hashes};
  const result = {...value, phase:constructor.phase, receipt:{...receipt, phase:'CONSTRUCTOR_COMMITTED', constructorKind:constructor.constructorKind, resultId:'r', ...hashes}};
  assert.doesNotThrow(() => checkInstallerReceiptFrame(result, constructor));
  assert.throws(() => checkInstallerReceiptFrame({...result, receipt:{...result.receipt, captureHash:'d'.repeat(64)}}, constructor), /CAPACITY_UNAVAILABLE/);
});
function fixture(wire = prefix + '{"schemaVersion":"fixture"}') {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({format:'der',type:'spki'});
  const key = Buffer.from(der.subarray(der.length - 32));
  const body = Buffer.from(wire, 'utf8');
  return { body, key, signature:sign(null, body, pair.privateKey) };
}

test('permit verification accepts exact signed bytes and returns a detached copy', () => {
  const f = fixture();
  const verified = verifyInstallerPermitBytes(f.body, f.key, f.signature, BigInt(f.body.length));
  assert.deepEqual(verified, f.body);
  f.body[f.body.length - 1] ^= 1;
  assert.notDeepEqual(verified, f.body);
});

test('permit verification denies changed bytes, wrong prefix, sizes and qualified bound', () => {
  const f = fixture();
  const changed = Buffer.from(f.body); changed[changed.length - 1] ^= 1;
  assert.throws(() => verifyInstallerPermitBytes(changed, f.key, f.signature, BigInt(changed.length)), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => verifyInstallerPermitBytes(f.body, f.key.subarray(1), f.signature, BigInt(f.body.length)), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => verifyInstallerPermitBytes(f.body, f.key, f.signature.subarray(1), BigInt(f.body.length)), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => verifyInstallerPermitBytes(f.body, f.key, f.signature, BigInt(f.body.length - 1)), /CAPACITY_UNAVAILABLE/);
  const other = fixture('wrong-domain\n{}');
  assert.throws(() => verifyInstallerPermitBytes(other.body, other.key, other.signature, BigInt(other.body.length)), /CAPACITY_UNAVAILABLE/);
});

const frame = (stage: Parameters<typeof installerFixedSqlFrame>[0], body?: Uint8Array) =>
  installerFixedSqlFrame(stage, "id';DROP TABLE x;--", 'nonce\\with\\slashes', body, 100000n, 1000000n);

test('fixed installer frames hex-encode data and separate preparation from receipts', () => {
  const body = Buffer.from("x';DROP TABLE x;--\\connect other", 'utf8');
  const preparation = frame('PREPARE_DELIVERY');
  const receipt = frame('DELIVERY_RECEIPT');
  const constructor = frame('BASELINE_CONSTRUCTOR', body);
  const confirm = frame('CONSTRUCTOR_RECEIPT');
  assert.match(preparation, /'DELIVERY_PENDING'/);
  assert.match(preparation, /public\.pro273_installer_commit_delivery\(/);
  assert.match(preparation, /;COMMIT;\n$/);
  assert.match(receipt, /public\.pro273_installer_delivery_receipt/);
  assert.doesNotMatch(receipt, /commit_delivery/);
  assert.match(constructor, /public\.pro273_control_plane_bootstrap/);
  assert.match(constructor, /;COMMIT;\n$/);
  assert.ok(constructor.includes(body.toString('hex')));
  assert.match(confirm, /public\.pro273_installer_constructor_receipt/);
  for (const sql of [preparation, receipt, constructor, confirm]) {
    assert.match(sql, /^BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_catalog\.jsonb_build_object\(/);
    assert.match(sql, /;COMMIT;\n$/);
    assert.equal((sql.match(/\bSELECT\b/g) ?? []).length, 1);
    assert.equal((sql.match(/\bBEGIN\b/g) ?? []).length, 1);
    assert.equal((sql.match(/\bCOMMIT\b/g) ?? []).length, 1);
    assert.doesNotMatch(sql, /DROP TABLE|\\|@ID@|@NONCE@|@BODY@/);
    assert.ok(sql.includes(Buffer.from("id';DROP TABLE x;--").toString('hex')));
  }
  assert.throws(() => frame('PAIR_CONSTRUCTOR', body), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => frame('DESCRIPTOR_CONSTRUCTOR', body), /CAPACITY_UNAVAILABLE/);
});

test('fixed installer frame validates operation and allocation bounds before encoding', () => {
  const body = Buffer.from('body');
  const valid = frame('BASELINE_CONSTRUCTOR', body);
  assert.throws(() => installerFixedSqlFrame('BASELINE_CONSTRUCTOR', 'id', 'n', body, 1n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('BASELINE_CONSTRUCTOR', 'id', 'n', body, BigInt(valid.length + 100), 1n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('DELIVERY_RECEIPT', 'id', 'n', body, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('BASELINE_CONSTRUCTOR', 'id', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('DESCRIPTOR_CONSTRUCTOR', 'id', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('INJECT' as never, 'id', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  let touched = false; const hostile = { toString() { touched = true; return 'PREPARE_DELIVERY'; } };
  assert.throws(() => installerFixedSqlFrame(hostile as never, 'id', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.equal(touched, false);
  assert.throws(() => installerFixedSqlFrame('PREPARE_DELIVERY', 'bad\0id', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
  assert.throws(() => installerFixedSqlFrame('PREPARE_DELIVERY', '\ud800', 'n', undefined, 10000n, 100000n), /CAPACITY_UNAVAILABLE/);
});

test('descriptor constructor input scope follows protected expectation through existing paths', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = (start: string, end: string) => {
    const i = sql.indexOf(start), j = sql.indexOf(end, i + start.length);
    assert.ok(i >= 0 && j > i, start);
    return sql.slice(i, j);
  };
  const validate = body('CREATE OR REPLACE FUNCTION public.pro262_capacity_trust_provision', 'CREATE TABLE public.');
  for (const term of ["ARRAY['kind','inputEnvelope','inputBound']", "jsonb_typeof(p_record->'scope'->'inputEnvelope')='string'", "jsonb_typeof(p_record->'scope'->'inputBound')='string'", "^[1-9][0-9]{0,18}$", '9223372036854775807']) assert.ok(validate.includes(term), term);
  const matcher = body('CREATE FUNCTION public.pro273_installer_slot_matches', 'REVOKE ALL ON FUNCTION public.pro273_installer_slot_matches');
  const provision = body('CREATE OR REPLACE FUNCTION public.pro262_capacity_provision_observer_input', 'CREATE OR REPLACE FUNCTION public.pro262_capacity_claim_observer_input');
  for (const [source, kind, envelope, maximum] of [[matcher, 'v_expected."constructorKind"', 'v_slot."baselineAllocationProof"', 'v_slot."maxInputBytes"'], [provision, 'e."constructorKind"', "p_record->>'baselineAllocationProof'", 'v_max']]) {
    for (const term of [kind + "='QUALIFIER_DESCRIPTOR'", "ARRAY['kind','inputEnvelope','inputBound']", envelope, maximum, '9223372036854775807', "jsonb_build_object('kind','INSTALLER_CONSTRUCTOR_INPUT')"]) assert.ok(source.includes(term), term);
  }
  for (const [start, end] of [['CREATE OR REPLACE FUNCTION public.pro262_capacity_claim_observer_input', 'CREATE OR REPLACE FUNCTION public.pro262_capacity_assert_observer_claim'], ['CREATE OR REPLACE FUNCTION public.pro262_capacity_assert_observer_claim', 'CREATE OR REPLACE FUNCTION public.pro262_capacity_read_observer_input_limit'], ['CREATE OR REPLACE FUNCTION public.pro262_capacity_read_observer_input_limit', 'END $$;']]) assert.ok(body(start, end).includes('pro273_installer_slot_matches'), start);
  const constructor = body('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)', 'REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)');
  for (const term of ['c."inputClaimId"=v_delivery."inputClaimId"', 'c."reservationId"=v_expected."constructorInputReservationId"', `r."baselineAllocationProof"=v_payload->>'observerGroupProof'`, `t."scope"->>'inputEnvelope'=v_payload->>'observerGroupProof'`, 'pro273_installer_slot_matches(r."reservationId") IS TRUE', "RAISE EXCEPTION 'SELECTION_UNAVAILABLE'"]) assert.ok(constructor.includes(term), term);
});

test('descriptor receipt candidate stays denied and binds the immutable initial transition', () => {
  // Inert source assertions only; this does not parse or execute SQL.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const receipt = sql.split('CREATE FUNCTION public.pro273_installer_constructor_receipt(')[1].split('END $$;')[0];
  const branch = receipt.split("ELSIF v_context->>'constructorKind'='QUALIFIER_DESCRIPTOR' THEN")[1].split("ELSIF v_context->>'constructorKind'='INVOCATION_SCHEDULE_GRANT_PAIR' THEN")[0];
  assert.ok(branch.indexOf("RAISE EXCEPTION 'SELECTION_UNAVAILABLE'") < branch.indexOf('SELECT d."controlId"'));
  for (const term of ['Pro273ControlPlaneInstallerExpectation','Pro273InstallerDelivery','Pro273QualifierDescriptorProvenance','Pro273QualifierDescriptorLinkage','Pro273QualifierDescriptorProof','Pro273QualificationInputState','Pro273QualificationTransitionReceipt','Pro262CapacityObserverInputClaim','Pro262CapacityObserverInputReservation','Pro262CapacityTrust','pro273_installer_parse_descriptor_metadata', 'pro273_installer_slot_matches(r."reservationId") IS TRUE', 'l."constructionTransactionId" IS DISTINCT FROM pg_catalog.pg_current_xact_id()', "'pro273.qualifier.transition.v1'", "'1'::TEXT", "'NONE','RESERVED','NONE','OPENING'", 't."occurredAt" IS NOT NULL']) assert.ok(branch.includes(term), term);
  const writer = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('END $$;')[0];
  assert.ok(writer.includes('JOIN public."Pro273QualificationTransitionReceipt" t'));
  assert.ok(writer.includes("'NONE','RESERVED','NONE','OPENING'"));
  assert.ok(writer.trimEnd().endsWith("EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE';"));
});

test('descriptor receipt and retry bind the complete stored projection to authenticated inputs', () => {
  // Inert source assertions only; this does not parse or execute SQL.
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const receipt = sql.split('CREATE FUNCTION public.pro273_installer_constructor_receipt(')[1].split('END $$;')[0]
    .split("ELSIF v_context->>'constructorKind'='QUALIFIER_DESCRIPTOR' THEN")[1].split("ELSIF v_context->>'constructorKind'='INVOCATION_SCHEDULE_GRANT_PAIR' THEN")[0];
  const retry = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('END $$;')[0]
    .split('IF EXISTS (SELECT 1 FROM public."Pro273QualificationInputDescriptor" d WHERE')[1].split(") THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;")[0];
  const columns = ['controlId','descriptorCoreHash','allocationId','allocationCoreHash','sourceIdentity','namespace','project','deployment','environment','principalOid','principalName','credentialEpoch','launchEpoch','observerGroupProof','physicalIdentity','physicalProofIdentity','baselinePartitionId','controlChargeKind','controlChargeEventKey','bootstrapRecordHash','expiresAt'];
  const projection = '(' + columns.map(c => `d."${c}"${c === 'principalOid' || c === 'principalName' ? '::TEXT' : ''}`).join(',') + ') IS NOT DISTINCT FROM (';
  for (const [source, core, payload, expected, bootstrap] of [[receipt, "original.payload->'core'", 'original.payload', 'e', 'e."expectedCoreHash"'], [retry, 'v_core', 'v_payload', 'v_expected', 'v_boot."recordHash"']]) {
    const values = ["controlId", null, "allocationId", "allocationCoreHash", "sourceIdentity", "namespace", "project", "deployment", "environment", "principalOid", "principalName", "credentialEpoch", "launchEpoch", null, "physicalIdentity", "physicalProofIdentity", "baselinePartitionId"].map((key, i) => key ? `${core}->>'${key}'` : `${payload}->>'${i === 1 ? 'descriptorCoreHash' : 'observerGroupProof'}'`);
    values.push(`${expected}."chargeKind"`, `${expected}."chargeEventKey"`, bootstrap, `(${core}->>'expiresAt')::TIMESTAMPTZ`);
    assert.ok(source.includes(projection + values.join(',') + ')'), 'complete NULL-safe descriptor projection');
    assert.ok(source.includes('l."constructionTransactionId" IS DISTINCT FROM pg_catalog.pg_current_xact_id()'), 'prior linkage xid');
  }
  assert.ok(receipt.includes('JOIN public."Pro273QualifierAllocation" a ON (a."allocationId",a."coreHash") IS NOT DISTINCT FROM (d."allocationId",d."allocationCoreHash")'));
  assert.ok(receipt.includes('(a."controlId",a."partitionId",a."physicalIdentity",a."physicalProofIdentity",a."principalOid",a."principalName",a."credentialEpoch",a."launchEpoch",a."sourceIdentity",a."namespace",a."project",a."deployment",a."environment") IS NOT DISTINCT FROM (d."controlId",d."baselinePartitionId",d."physicalIdentity",d."physicalProofIdentity",d."principalOid",d."principalName",d."credentialEpoch",d."launchEpoch",d."sourceIdentity",d."namespace",d."project",d."deployment",d."environment")'));
  assert.ok(receipt.includes('(charge."kind",charge."eventKey",charge."bindingHash") IS NOT DISTINCT FROM (e."chargeKind",e."chargeEventKey",e."chargeBindingHash")'));
  assert.ok(receipt.includes('e."installerOid",e."installerName"'));
  assert.ok(retry.includes('v_expected."installerOid",v_expected."installerName"'));
  assert.ok(sql.includes(`pg_catalog.to_char(v_expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') IS DISTINCT FROM v_record->>'expiresAt'`));
});
