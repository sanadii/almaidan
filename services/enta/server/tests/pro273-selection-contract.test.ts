import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { initialPublicationReceiptReference as receiptSpec, isInitialPublicationXid, parseExpectedActor, parseVerificationMetadata, parsePrimitiveProfile, parseSelectionSession, parseSelectionActor, parseSelectionTarget, isProtectedPlayRoute, protectedPlayRouteGate, protectedPlayUnavailable } from '../src/huroof-pg/selection-contract';
import { controlPlaneObservationReference as observationSpec } from '../src/huroof-pg/selection-contract';
import { observationResourceProfileReference as resourceSpec, parseObservationResourceCore, syntheticObservationByteaCopies, requireObservationResourceAuthority } from '../src/huroof-pg/selection-contract';
import { parseInitialQualificationShape } from '../src/huroof-pg/selection-contract';

test('INITIAL qualification shape is closed and rejects invalid ABI, hashes and resource values', () => {
  const valid = {
    schemaVersion:'pro273-initial-qualification-v1', baselineId:'baseline', baselineCoreHash:'a'.repeat(64),
    parserAbiVersion:'pro273-initial-metadata-v1', sourceClosureHash:'b'.repeat(64),
    installationClosureHash:'c'.repeat(64), receiverIdentity:'receiver', receiverClosureHash:'d'.repeat(64),
    maxInputBytes:'1', maxOutputBytes:'2', parserPeakBytes:'3', serializationPeakBytes:'4', jsonbPeakBytes:'5',
    largestAllocationBytes:'6', stackPeakBytes:'7', eventDurableBytes:'8', closedScopeDurableBytes:'9',
    memoryEvidenceHash:'e'.repeat(64), durabilityEvidenceHash:'f'.repeat(64), fenceEvidenceHash:'0'.repeat(64),
    fenceAbiVersion:'pro273-initial-one-shot-v1',
  };
  const snapshot = parseInitialQualificationShape(valid);
  assert.equal(snapshot.baselineId, 'baseline');
  assert.ok(Object.isFrozen(snapshot));
  valid.baselineId = 'changed';
  assert.equal(snapshot.baselineId, 'baseline');
  for (const invalid of [
    {...valid, extra:true}, {...valid, parserAbiVersion:'other'}, {...valid, fenceAbiVersion:'other'},
    {...valid, baselineCoreHash:'A'.repeat(64)}, {...valid, baselineCoreHash:'a'.repeat(64)+'\n'}, {...valid, receiverIdentity:''},
    {...valid, receiverIdentity:'bad\u0000id'}, {...valid, baselineId:'\ud800'}, {...valid, baselineId:'\udc00'},
    {...valid, maxInputBytes:'0'}, {...valid, maxInputBytes:'01'}, {...valid, maxInputBytes:'1\n'}, {...valid, maxInputBytes:'9223372036854775808'},
  ]) assert.throws(() => parseInitialQualificationShape(invalid));
  const {fenceEvidenceHash: _missing, ...missing} = valid;
  assert.throws(() => parseInitialQualificationShape(missing));
  const v2 = {...valid, schemaVersion:'pro273-initial-qualification-v2', parserAbiVersion:'pro273-initial-metadata-v2', decoderOverheadBytes:'1', decoderWorkBytes:'2'};
  assert.equal(parseInitialQualificationShape(v2).decoderWorkBytes, '2');
  assert.equal(parseInitialQualificationShape({...v2, baselineId:'😀'}).baselineId, '😀');
  assert.throws(() => parseInitialQualificationShape({...v2, parserAbiVersion:'pro273-initial-metadata-v1'}));
  assert.throws(() => parseInitialQualificationShape({...v2, decoderWorkBytes:'0'}));
  assert.throws(() => parseInitialQualificationShape({...v2, schemaVersion:'pro273-initial-qualification-v1'}));
});

// Synthetic values exercise representation and arithmetic only, never qualification.
function observationResourceCore() {
  const map = (names: readonly string[], value: () => unknown) => Object.fromEntries(names.map(name => [name, value()]));
  return {
    ...map(resourceSpec.hashFields, () => 'a'.repeat(64)), schemaVersion: resourceSpec.schemaVersion, reservationId: 'reservation-1',
    limits: map(resourceSpec.limits, () => '1000000000'),
    phases: map(resourceSpec.phases, () => map(resourceSpec.measures, () => '1')),
    representation: {modelVersion: resourceSpec.modelVersion, ...map(resourceSpec.classes, () => map(resourceSpec.coefficients, () => '1'))} as {modelVersion: string; bytea: Record<string, unknown>} & Record<string, unknown>,
  };
}
test('observation resource core is closed, detached and frozen at every schema level', () => {
  const core = observationResourceCore();
  assert.equal(resourceSpec.coreFields.length, 14); assert.equal(resourceSpec.limits.length, 16);
  assert.equal(resourceSpec.phases.length, 6); assert.equal(resourceSpec.measures.length, 6);
  assert.equal(resourceSpec.classes.length, 11); assert.equal(resourceSpec.coefficients.length, 6);
  const parsed = parseObservationResourceCore(core);
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.limits));
  assert.ok(Object.isFrozen((parsed.phases as Record<string, unknown>).capture));
  assert.ok(Object.isFrozen((parsed.representation as Record<string, unknown>).bytea));
  core.limits.maxCapturedBytes = '2'; assert.equal((parsed.limits as Record<string, string>).maxCapturedBytes, '1000000000');
  for (const bad of [
    {...core, profileHash:'a'.repeat(64)}, {...core, receiverClosureHash:'A'.repeat(64)},
    {...core, limits:{...core.limits, maxCapturedBytes:'0'}}, {...core, limits:{...core.limits, maxCapturedBytes:'9'.repeat(1000)}},
    {...core, phases:{...core.phases, capture:{...core.phases.capture as object, extra:'1'}}},
    {...core, representation:{...core.representation, bytea:{...core.representation.bytea as object, workBaseUnits:null}}},
    {...core, representation:{...core.representation, modelVersion:'other'}},
  ]) assert.throws(() => parseObservationResourceCore(bad));
  const {durabilityEvidenceHash: _missing,...missing}=core as typeof core & Record<string, unknown>; assert.throws(() => parseObservationResourceCore(missing));
  const {bytea: _missingClass,...missingRepresentation}=core.representation;
  assert.throws(() => parseObservationResourceCore({...core,representation:missingRepresentation}));
  const {workBaseUnits: _missingCoefficient,...missingCoefficient}=core.representation.bytea as Record<string, unknown>;
  assert.throws(() => parseObservationResourceCore({...core,representation:{...core.representation,bytea:missingCoefficient}}));
});

test('resource profile hash boundary is representation only and cannot contain its own hash', () => {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
    return JSON.stringify(value);
  };
  const core = parseObservationResourceCore(observationResourceCore());
  const digest = createHash('sha256').update(canonical([resourceSpec.hashDomain,core]),'utf8').digest('hex');
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.throws(() => parseObservationResourceCore({...core,profileHash:digest}));
  const cyclic = observationResourceCore(); (cyclic as Record<string, unknown>).publisher = cyclic;
  assert.throws(() => parseObservationResourceCore(cyclic));
  assert.throws(() => requireObservationResourceAuthority()); // no self-funded bootstrap, provenance or build authority
});

test('synthetic copy arithmetic charges all 44 full-copy payloads without refund', () => {
  const core = observationResourceCore(), units = Array(44).fill('2');
  // Each of four writes allocates 1 + 4 + 1 bytes and incurs the same work.
  assert.deepEqual(syntheticObservationByteaCopies(core,units), {allocationBytes:1056n,workUnits:1056n});
  assert.throws(() => syntheticObservationByteaCopies({...core,limits:{...core.limits,maxCumulativeAllocationBytes:'1055'}},units));
  assert.throws(() => syntheticObservationByteaCopies(core,units.slice(1)));
  assert.throws(() => syntheticObservationByteaCopies(core,[...units,'2']));
  assert.throws(() => syntheticObservationByteaCopies({...core,representation:{...core.representation,bytea:{...core.representation.bytea as object,workBaseUnits:'0'}}},units));
  assert.throws(() => syntheticObservationByteaCopies({...core,limits:{...core.limits,maxAllocationBytes:'5'}},units));
  const huge = '9223372036854775807';
  assert.throws(() => syntheticObservationByteaCopies({...core,limits:Object.fromEntries(resourceSpec.limits.map(k => [k,huge]))},[huge,...Array(43).fill('0')]));
  assert.throws(() => syntheticObservationByteaCopies(core,['9'.repeat(1000),...Array(43).fill('0')]));
});

test('resource reservation identity accepts bounded scalar UTF-8 without normalization', () => {
  const core = observationResourceCore();
  for (const id of [' ', 'حروف 😀', 'é'.repeat(128), '😀'.repeat(64), 'e\u0301']) {
    assert.equal(parseObservationResourceCore({...core,reservationId:id}).reservationId,id);
  }
  for (const id of ['', '\u0000', 'a\ud800', '\udc00', 'é'.repeat(129), '😀'.repeat(65)]) {
    assert.throws(() => parseObservationResourceCore({...core,reservationId:id}));
  }
});

test('synthetic units reject accessors without invoking them and safely deny proxy failures', () => {
  const core = observationResourceCore();
  for (const second of ['3', '9'.repeat(1000)]) {
    let reads = 0;
    const units = Array(44).fill('2');
    Object.defineProperty(units, '0', {get() { return ++reads === 1 ? '2' : second; }});
    assert.throws(() => syntheticObservationByteaCopies(core, units), {name:'SelectionUnavailable'});
    assert.equal(reads, 0);
  }
  const units = Array(44).fill('2');
  const descriptorReads = new Map<string, number>();
  const proxy = new Proxy(units, {
    get() { throw Error('element read'); },
    getOwnPropertyDescriptor(target, key) {
      descriptorReads.set(String(key), (descriptorReads.get(String(key)) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.deepEqual(syntheticObservationByteaCopies(core, proxy), {allocationBytes:1056n,workUnits:1056n});
  for (let i = 0; i < 44; i++) assert.equal(descriptorReads.get(String(i)), 1);
  assert.throws(() => syntheticObservationByteaCopies(core, new Proxy(units, {getOwnPropertyDescriptor() { throw Error('trap'); }})), {name:'SelectionUnavailable'});
  const revoked = Proxy.revocable(units, {}); revoked.revoke();
  assert.throws(() => syntheticObservationByteaCopies(core, revoked.proxy), {name:'SelectionUnavailable'});
});

// Inert test oracles with synthetic limits. They do not implement or authenticate SQL.
function scalar(value: string, limit: number): void {
  if (value.length > limit) throw Error('bound'); // before scanning the string
  if (!value.length || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error('scalar');
}
function microUtc(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(value);
  if (!m) return false;
  const [,ys,ms,ds,hs,mins,ss] = m, y=+ys, month=+ms, day=+ds;
  const leap=y%4===0 && (y%100!==0 || y%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return y>0 && month>=1 && month<=12 && day>=1 && day<=days[month-1] && +hs<24 && +mins<60 && +ss<60;
}
function standardBase64(value: string, decode: (value:string)=>Buffer = value=>Buffer.from(value,'base64')): Buffer {
  // Synthetic test bound only; it does not qualify production resources.
  if (value.length>4*Math.ceil(4096/3)) throw Error('bound');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value.length) throw Error('base64');
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
  const decodedLength=3*(value.length/4)-padding;
  if (!Number.isSafeInteger(decodedLength) || decodedLength<=0 || decodedLength>4096) throw Error('bound');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (padding && (alphabet.indexOf(value[value.length-padding-1]) & (padding===2?15:3))) throw Error('base64');
  const decoded=decode(value);
  if (decoded.length!==decodedLength || decoded.toString('base64')!==value) throw Error('base64');
  return decoded;
}
function observationOracle(raw: Uint8Array, limit: number): Record<string,string> {
  if (raw.length>limit || !limit) throw Error('bound');
  if (raw.length>=3 && raw[0]===0xef && raw[1]===0xbb && raw[2]===0xbf) throw Error('BOM');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  let pos=0, tokens=1;
  const ws=()=>{ while (pos<text.length && /[\x20\t\r\n]/.test(text[pos])) pos++; };
  const take=(char:string)=>{ws(); if(text[pos++]!==char) throw Error('syntax');};
  const string=()=>{
    ws(); const start=pos; if(text[pos++]!=='"') throw Error('string');
    while(pos<text.length) { const c=text[pos++]; if(c==='"') { const result: unknown=JSON.parse(text.slice(start,pos)); if(typeof result!=='string') throw Error('string'); scalar(result,limit); return result; } if(c==='\\') { if(pos>=text.length) throw Error('syntax'); pos++; } }
    throw Error('syntax');
  };
  const out:Record<string,string>=Object.create(null); take('{');
  for(let i=0;i<observationSpec.payloadFields.length;i++) {
    if(i) take(','); const key=string(); tokens++; take(':'); const value=string(); tokens++;
    if (Object.hasOwn(out,key)) throw Error('duplicate key');
    if (!observationSpec.payloadFields.some(k=>k===key)) throw Error('key');
    out[key]=value;
  }
  take('}'); ws(); if(pos!==text.length || tokens!==observationSpec.lexerTokens) throw Error('syntax');
  if(out.schemaVersion!==observationSpec.schemaVersion || observationSpec.hashFields.some(k=>!/^[a-f0-9]{64}$/.test(out[k]))) throw Error('value');
  const positiveBound=(v:string,max:string)=>/^[1-9][0-9]*$/.test(v) && (v.length<max.length || v.length===max.length && v<=max);
  if(!positiveBound(out.targetOid,'4294967295') || !positiveBound(out.targetPid,'2147483647')) throw Error('range');
  if(![out.targetBackendStart,out.observedAt,out.validUntil].every(microUtc) || out.targetBackendStart>out.observedAt || out.observedAt>=out.validUntil) throw Error('time');
  const evidence=standardBase64(out.evidenceBase64);
  if (createHash('sha256').update(evidence).digest('hex')!==out.evidenceHash) throw Error('evidence hash');
  return out;
}
function observationPayload(): Record<string,string> {
  const result:Record<string,string>=Object.fromEntries(observationSpec.payloadFields.map(k=>[k,'v']));
  Object.assign(result,{schemaVersion:observationSpec.schemaVersion,baselineCoreHash:'a'.repeat(64),sourceClosureHash:'b'.repeat(64),installationClosureHash:'c'.repeat(64),evidenceHash:'252f10c83610ebca1a059c0bae8255eba2f95be4d1d7bcfa89d7248a82d9f111',targetOid:'4294967295',targetPid:'2147483647',targetBackendStart:'2000-02-29T00:00:00.123456Z',observedAt:'2000-02-29T00:00:00.123456Z',validUntil:'2000-03-01T00:00:00.000000Z',evidenceBase64:'Zg=='});
  return result;
}
function observationReceiptOracle(input:Record<string,string>, limit:number|null): {canonical:string;hash:string} {
  if (!Number.isSafeInteger(limit) || limit===null || limit<=0) throw Error('bound');
  if(Object.keys(input).length!==observationSpec.receiptPreimageFields.length || observationSpec.receiptPreimageFields.some(k=>!Object.hasOwn(input,k))) throw Error('fields');
  const parts:string[]=[observationSpec.receiptDomain]; let size=2;
  for(const key of observationSpec.receiptPreimageFields) {
    const value=input[key]; if(typeof value!=='string') throw Error('scalar'); scalar(value,limit);
    if (['baselineCoreHash','capturedHash','evidenceHash'].includes(key) && !/^[a-f0-9]{64}$/.test(value)) throw Error('hash');
    if(key==='constructionTransactionId' && !isInitialPublicationXid(value)) throw Error('xid');
    parts.push(value);
  }
  // Count escaped UTF-8 before materializing the complete preimage.
  for(const part of parts) {
    size+=2;
    for(const ch of part) { const cp=ch.codePointAt(0)!; size+=cp===34 || cp===92 || [8,9,10,12,13].includes(cp)?2:cp<32?6:Buffer.byteLength(ch); if(size>limit) throw Error('bound'); }
  }
  size+=parts.length-1; if(size>limit) throw Error('bound');
  const canonical=JSON.stringify(parts); assert.equal(Buffer.byteLength(canonical),size);
  return {canonical,hash:createHash('sha256').update(canonical,'utf8').digest('hex')};
}
function observationReceipt() { return {reservationId:'reservation-1',baselineId:'baseline-1',baselineCoreHash:'a'.repeat(64),sessionClaimId:'session-1',attemptId:'attempt-1',eventId:'event-1',inputClaimId:'input-1',capturedHash:'b'.repeat(64),evidenceHash:'c'.repeat(64),constructionTransactionId:'18446744073709551615'}; }

test('control observation frozen ABI identifies target, preimage and response without qualifying resources', () => {
  assert.equal(observationSpec.payloadFields.length,22); assert.equal(observationSpec.lexerTokens,45);
  assert.equal(observationSpec.receiptPreimageFields.length+1,11); assert.equal(observationSpec.responseFields.length,13);
  assert.equal(observationSpec.qualifiedResources,null); assert.ok(Object.isFrozen(observationSpec.payloadFields));
  assert.ok(observationSpec.targetFields.includes('sourceClosureHash')); assert.ok(!(observationSpec.payloadFields as readonly string[]).includes('observerSourceClosure'));
  assert.ok(!(observationSpec.receiptPreimageFields as readonly string[]).includes('nonce'));
});
test('control observation inert grammar rejects duplicate decoded keys, malformed bytes and invalid fields', () => {
  const payload=observationPayload(), raw=JSON.stringify(payload), read=(s:string)=>observationOracle(Buffer.from(s),8192);
  assert.equal(read(raw).targetOid,'4294967295');
  const duplicate=raw.replace('"eventId":"v"','"eventId":"v","event\\u0049d":"v"').replace(',"baselineId":"v"','');
  assert.throws(()=>read(duplicate),/duplicate key/);
  assert.throws(()=>read(JSON.stringify({...payload,evidenceHash:'d'.repeat(64)})),/evidence hash/);
  for(const value of [{...payload,targetOid:'01'},{...payload,targetOid:'4294967296'},{...payload,targetPid:'2147483648'},{...payload,eventId:'\ud800'},{...payload,eventId:'\u0000'},{...payload,evidenceHash:'A'.repeat(64)},{...payload,extra:'x'},{...payload,eventId:null}]) assert.throws(()=>read(JSON.stringify(value)));
  const {eventId:_removed,...missing}=payload; assert.throws(()=>read(JSON.stringify(missing)));
  for(const bytes of [Buffer.from([0xef,0xbb,0xbf,0x7b,0x7d]),Buffer.from([0xc0,0xaf]),Buffer.from([0xed,0xa0,0x80])]) assert.throws(()=>observationOracle(bytes,8192));
  assert.throws(()=>read(raw.replace('"eventId":"v"','"eventId":"\\ud800"')));
  const reordered=JSON.stringify(Object.fromEntries(Object.entries(payload).reverse()));
  assert.deepEqual({...read(raw)},{...read(reordered)});
  assert.notEqual(createHash('sha256').update(raw).digest('hex'),createHash('sha256').update(reordered).digest('hex'));
});
test('control observation base64 and calendar retain exact representation', () => {
  assert.deepEqual([...standardBase64('Zg==')],[102]);
  for(const bad of ['Zh==','Zm9=','Zg','Zg==\n','Zg__','====','']) assert.throws(()=>standardBase64(bad));
  let allocations=0;
  const decode=(value:string)=>{allocations++; return Buffer.from(value,'base64');};
  assert.throws(()=>standardBase64('Zh==',decode),/base64/); assert.equal(allocations,0);
  assert.throws(()=>standardBase64('A'.repeat(5468)+'!',decode),/bound/); assert.equal(allocations,0);
  assert.deepEqual([...standardBase64('Zg==',decode)],[102]); assert.equal(allocations,1);
  for(const good of ['0001-01-01T00:00:00.000000Z','2000-02-29T23:59:59.123456Z','9999-12-31T23:59:59.999999Z']) assert.equal(microUtc(good),true);
  for(const bad of ['0000-01-01T00:00:00.000000Z','1900-02-29T00:00:00.000000Z','2000-02-30T00:00:00.000000Z','2000-01-01T24:00:00.000000Z','2000-01-01T00:00:60.000000Z','2000-01-01T00:00:00.1234567Z','2000-01-01T00:00:00.123456+00:00']) assert.equal(microUtc(bad),false);
  const payload=observationPayload();
  for(const change of [{targetBackendStart:'2000-03-01T00:00:00.000000Z'},{validUntil:payload.observedAt},{observedAt:'1900-02-29T00:00:00.123456Z'}]) assert.throws(()=>observationOracle(Buffer.from(JSON.stringify({...payload,...change})),8192));
});
test('control observation receipt has independent ASCII and escaped astral vectors', () => {
  for(const [input,length,digest] of [
    [observationReceipt(),344,'59cddd080f7578cff2ccafb7e97abcda1873b7f6e8fede2145a8378c3bf6da8e'],
    [{...observationReceipt(),eventId:'astral-😀"\\\n\u0001\u2028\u2029'},366,'cd90bb3f07fe2244dd02c3410d51e96713bf29778f7a798ee47778584866fbd0'],
  ] as const) {
    const result=observationReceiptOracle(input,length); assert.equal(Buffer.byteLength(result.canonical),length); assert.equal(result.hash,digest);
    assert.throws(()=>observationReceiptOracle(input,length-1),/bound/);
  }
  assert.throws(()=>observationReceiptOracle(observationReceipt(),null));
  for(const change of <Record<string,string>[]>[{constructionTransactionId:'0'},{constructionTransactionId:'18446744073709551616'},{constructionTransactionId:'01'},{eventId:'\ud800'},{capturedHash:'A'.repeat(64)},{nonce:'x'}]) assert.throws(()=>observationReceiptOracle({...observationReceipt(),...change},10000));
  assert.throws(()=>observationReceiptOracle({...observationReceipt(),eventId:'a'.repeat(100000)+'\ud800'},1024),/bound/);
});

// Test-only oracle. Test limits are synthetic and confer no resource qualification.
function receiptOracle(input: Record<string, unknown>, maxBytes: number | null) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes === null || maxBytes <= 0) throw Error('missing bound');
  const keys = Object.keys(input);
  if (keys.length !== receiptSpec.fields.length || receiptSpec.fields.some(k => !Object.hasOwn(input,k))) throw Error('fields');
  let size = Buffer.byteLength(`[${JSON.stringify(receiptSpec.domain)},{}`) + 1;
  const detached: Record<string,string> = {};
  for (const [index,key] of receiptSpec.fields.entries()) {
    const value = input[key];
    if (typeof value !== 'string' || !value.length) throw Error('scalar');
    // Every valid UTF-16 code unit requires at least one UTF-8 JSON byte.
    if (value.length > maxBytes) throw Error('bound');
    if (/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error('scalar');
    // Count UTF-8 bytes of JSON stringification without materializing the escaped value.
    let valueBytes = 2;
    for (const ch of value) {
      const cp = ch.codePointAt(0)!;
      valueBytes += cp === 34 || cp === 92 || cp === 8 || cp === 9 || cp === 10 || cp === 12 || cp === 13 ? 2 : cp < 32 ? 6 : Buffer.byteLength(ch);
      if (valueBytes > maxBytes) throw Error('bound');
    }
    size += (index ? 1 : 0) + Buffer.byteLength(JSON.stringify(key)) + 1 + valueBytes;
    if (size > maxBytes) throw Error('bound');
    detached[key] = value;
  }
  if (receiptSpec.hashFields.some(k => !/^[a-f0-9]{64}$/.test(detached[k])) || !isInitialPublicationXid(detached.constructionTransactionId) || !receiptSpec.targetKinds.some(k => k === detached.targetKind)) throw Error('value');
  const canonical = JSON.stringify([receiptSpec.domain,detached]);
  assert.equal(Buffer.byteLength(canonical),size);
  return {canonical, hash:createHash('sha256').update(canonical,'utf8').digest('hex')};
}
const initialReceipt = () => ({admissionReceiptId:'admission-1',attemptId:'attempt-1',capturedHash:'a'.repeat(64),constructionTransactionId:'4294967296',coreHash:'b'.repeat(64),eventId:'event-1',evidenceHash:'c'.repeat(64),inputClaimId:'input-1',sessionClaimId:'session-1',targetId:'physical-1',targetKind:'QUALIFIER_LAYOUT'});

test('INITIAL receipt reference reproduces both reviewed ASCII vectors', () => {
  for (const [input,length,digest] of [
    [initialReceipt(),515,'a33d88e0f8217052738025bd6c8c83b0bd1ef595151629e05989f9270546509e'],
    [{...initialReceipt(),targetId:'allocation-1',targetKind:'QUALIFIER_ALLOCATION'},521,'b56374ed745b5a2fd1f8e9fb3aa6fbb4e212012651edf9504191219572664949'],
  ] as const) {
    const result = receiptOracle(input,length);
    assert.equal(Buffer.byteLength(result.canonical),length); assert.equal(result.hash,digest);
    assert.throws(() => receiptOracle(input,length-1));
  }
  assert.equal(receiptSpec.qualifiedResources,null);
  assert.throws(() => receiptOracle(initialReceipt(),null));
});

test('INITIAL reference rejects malformed fields, xid, hashes and invalid scalars', () => {
  const r=initialReceipt();
  for (const bad of [{...r,nonce:'n'}, {...r,targetId:''}, {...r,targetKind:'OTHER'}, {...r,coreHash:'A'.repeat(64)}, {...r,constructionTransactionId:'18446744073709551616'}, {...r,constructionTransactionId:'01'}, {...r,eventId:'a\u0000b'}, {...r,eventId:'\ud800'}, {...r,eventId:'\udc00'}]) assert.throws(() => receiptOracle(bad,10000));
  const {eventId: _omitted,...missing}=r; assert.throws(() => receiptOracle(missing,10000));
});

test('INITIAL reference rejects oversized strings before scalar scanning', () => {
  const large = 'a'.repeat(100_000);
  for (const value of [large, large + '\ud800', '😀'.repeat(50_001)]) {
    assert.throws(() => receiptOracle({...initialReceipt(),eventId:value},1024), /bound/);
  }
  assert.throws(() => receiptOracle({...initialReceipt(),eventId:large + '\ud800'},200_000), /scalar/);
  const result = receiptOracle({...initialReceipt(),eventId:large},200_000);
  assert.equal(Buffer.byteLength(result.canonical),100_508);
});

test('INITIAL reference preserves astral scalars and canonical JSON escaping', () => {
  const result=receiptOracle({...initialReceipt(),eventId:'😀"\\\n\u0001/\u2028'},10000);
  assert.ok(result.canonical.includes('😀\\"\\\\\\n\\u0001/\u2028'));
  assert.equal(result.hash,'8160cdd670551d39dfcdf5a44980f9e99b453363cc603d4909d125453d2211bc');
});

const actor = () => ({uid:'u',identityId:'i',role:'player',team:'horizontal',ready:true,active:true,memberGeneration:'1',memberVersion:'0'});
const metadata = () => ({schemaVersion:'pro273-verification-v1',controlId:'c',admissionId:'a',fence:'1',operation:'PG_ORDINARY_COMMAND',phase:'EXECUTING',branch:'SELECT_OR_REPLACE',primitiveProfileId:'p',primitiveGeneration:'1',primitiveRecordHash:'a'.repeat(64),sourceClosureHash:'b'.repeat(64),installedClosureHash:'c'.repeat(64),contentBindingHash:null,sampledDbTime:'2026-10-29T00:00:00.000Z',sampledTimeIdentity:'t',invocationOrdinal:'1'});
test('expected actor captures a changing getter once and returns detached primitives', () => {
  const input = actor(); let reads = 0;
  Object.defineProperty(input,'uid',{enumerable:true,get(){return ++reads === 1 ? 'u' : {alias:true};}});
  const result = parseExpectedActor(input);
  assert.equal(reads,1); assert.equal(result.uid,'u'); assert.equal(Object.isFrozen(result),true);
});
test('expected actor enforces closed fields, actual enums and positive generation', () => {
  assert.throws(() => parseExpectedActor({...actor(),extra:1}));
  assert.throws(() => parseExpectedActor({...actor(),active:false}));
  assert.throws(() => parseExpectedActor({...actor(),memberGeneration:'0'}));
  assert.throws(() => parseExpectedActor({...actor(),memberVersion:'1\n'}));
  assert.throws(() => parseExpectedActor({...actor(),team:'other'}));
});
test('metadata requires complete primitive identity, strict timestamp and bounded positive fence', () => {
  assert.equal(parseVerificationMetadata(metadata()).fence,'1');
  assert.throws(() => parseVerificationMetadata({...metadata(),sourceClosureHash:'b'.repeat(64)+'\n'}));
  assert.equal(parseVerificationMetadata({...metadata(),sampledDbTime:'+010000-01-01T00:00:00.000Z'}).sampledDbTime,'+010000-01-01T00:00:00.000Z');
  assert.throws(() => parseVerificationMetadata({...metadata(),primitiveGeneration:null}));
  assert.throws(() => parseVerificationMetadata({...metadata(),sampledDbTime:'2026-02-30T00:00:00.000Z'}));
  assert.throws(() => parseVerificationMetadata({...metadata(),fence:'9223372036854775808'}));
  assert.throws(() => parseVerificationMetadata({...metadata(),fence:'1\n'}));
  assert.throws(() => parseVerificationMetadata({...metadata(),branch:'NONE'}));
});
test('metadata accepts explicit inapplicable primitive and captures accessors once', () => {
  const input = {...metadata(),primitiveProfileId:null,primitiveGeneration:null,primitiveRecordHash:null}; let reads=0;
  Object.defineProperty(input,'fence',{enumerable:true,get(){return ++reads === 1 ? '7' : '0';}});
  assert.equal(parseVerificationMetadata(input).fence,'7'); assert.equal(reads,1);
});

function profile() {
  const values: Record<string, unknown> = {};
  for (const key of ['profileId','namespace','project','deployment','environment','databaseIdentity','nodeVersion','v8Version','serverVersion','icuVersion','unicodeVersion','doubleConversionVersion','compilerIdentity','targetAbi','serverEncoding','jsLocale','collationSchema','collationName','collationProvider','collationVersion','collationActualVersion']) values[key] = 'v';
  for (const key of ['sourceClosureHash','callsiteClosureHash','inputDomainHash','bridgeSourceHash','bridgeBinaryHash','buildManifestHash','nodeExecutableHash','serverBinaryHash','icuLibraryHash','icuDataHash','doubleConversionSourceHash','doubleConversionBinaryHash']) values[key] = 'a'.repeat(64);
  const signatures = ['pro273_prim_compare(bytea,bytea,oid)','pro273_prim_nfkc(bytea)','pro273_prim_nfc(bytea)','pro273_prim_upper(bytea)','pro273_prim_number_parse(bytea)','pro273_prim_number_string(bytea)','pro273_prim_f64(text,bytea,bytea)','pro273_prim_f64_unary(text,bytea)','pro273_prim_identity()'];
  return {...values,schemaVersion:'pro273-selection-primitives-v1',abiVersion:'pro273-primitive-abi-v1',generation:'1',collationOid:'1',collationDeterministic:true,jsOptions:{usage:'sort',sensitivity:'variant',ignorePunctuation:false,numeric:false,caseFirst:'false',collation:'default'},primitiveFunctionIdentities:signatures.map((signature,i)=>({signature,oid:String(i+1),probin:'b',prosrc:'s'})),validFrom:'2026-10-29T00:00:00.000Z',validUntil:'2026-10-30T00:00:00.000Z'};
}
test('semantic profile is closed and detaches nested identity fields', () => {
  const p=profile(); const result=parsePrimitiveProfile(p);
  p.primitiveFunctionIdentities[0].probin='changed';
  assert.equal((result.primitiveFunctionIdentities as {probin:string}[])[0].probin,'b');
  assert.throws(()=>parsePrimitiveProfile({...p,capturedBytes:'self-containing'}));
  for (const key of ['recordHash','trustId','trustGeneration','trustRecordHash','evidenceHash','evidenceLength']) assert.throws(()=>parsePrimitiveProfile({...p,[key]:'obsolete'}));
});
test('semantic profile rejects sparse, duplicate and malformed function identities', () => {
  const p=profile(); const sparse=p.primitiveFunctionIdentities.slice(); delete sparse[0];
  assert.throws(()=>parsePrimitiveProfile({...p,primitiveFunctionIdentities:sparse}));
  const duplicate=p.primitiveFunctionIdentities.map(x=>({...x})); duplicate[1].oid=duplicate[0].oid;
  assert.throws(()=>parsePrimitiveProfile({...p,primitiveFunctionIdentities:duplicate}));
  assert.throws(()=>parsePrimitiveProfile({...p,collationOid:'4294967296'}));
  assert.throws(()=>parsePrimitiveProfile({...p,validUntil:p.validFrom}));
});

test('session coordinates remain detached and reject invalid OID and backend PID', () => {
  const value={principal:'p',principalOid:'42',backendPid:'123',backendStart:'2026-10-29 00:00:00+00',host:'h',boot:'b',processTree:'t',installObservationId:'o',installObservationHash:'a'.repeat(64),credentialEpoch:'c',launchEpoch:'l'};
  let reads=0; Object.defineProperty(value,'host',{enumerable:true,get(){return ++reads===1 ? 'h' : {alias:true};}});
  assert.equal(parseSelectionSession(value).host,'h'); assert.equal(reads,1);
  assert.throws(()=>parseSelectionSession({...value,host:'h',principalOid:'4294967296'}));
  assert.throws(()=>parseSelectionSession({...value,host:'h',backendPid:'2147483648'}));
});

test('actor and target discriminate closed shapes and capture target tag once', () => {
  const actorValue={kind:'AUTHENTICATED',namespace:'n',project:'p',identityId:'i',uid:'u',policyRevision:'r',policyHash:'a'.repeat(64)};
  assert.equal(parseSelectionActor(actorValue).identityId,'i');
  assert.throws(()=>parseSelectionActor({...actorValue,policyHash:'bad'}));
  let reads=0; const target={kind:'LOBBY',roomId:'r',generation:'1',memberGeneration:'1',revision:'2',stateHash:'b'.repeat(64)};
  Object.defineProperty(target,'kind',{enumerable:true,get(){return ++reads===1?'LOBBY':'MATCH';}});
  assert.equal(parseSelectionTarget(target).kind,'LOBBY'); assert.equal(reads,1);
  assert.throws(()=>parseSelectionTarget({kind:'NONE',roomId:'r'}));
  assert.throws(()=>parseSelectionTarget({kind:'MATCH',roomId:'r',generation:'1',memberGeneration:'1',revision:'1',sequence:'01',matchId:'m'}));
});

test('protected play route table accepts only exact POST routes before parsing', () => {
  for (const route of ['/rooms','/start','/lobby-command','/command','/projection','/realtime/read','/realtime/join-prepare']) assert.equal(isProtectedPlayRoute('POST',route),true);
  for (const [method,route] of [['GET','/rooms'],['POST','/rooms/'],['POST','/unknown'],['DELETE','/realtime/read']]) assert.equal(isProtectedPlayRoute(method,route),false);
});

test('actual protected middleware denies unknown/default without touching the body', () => {
  let status=0, output: unknown, nextCalls=0, bodyReads=0;
  const request={method:'POST',path:'/unknown',get body(){bodyReads++;throw new Error('unexpected body read');}};
  const response={status(code:number){status=code;return this;},json(value:unknown){output=value;return this;}};
  protectedPlayRouteGate(request as never,response as never,(()=>{nextCalls++;}) as never);
  assert.equal(status,503);assert.deepEqual(output,{error:'CAPACITY_UNAVAILABLE'});assert.equal(nextCalls,0);assert.equal(bodyReads,0);
  const valid={method:'POST',path:'/rooms'};
  protectedPlayRouteGate(valid as never,response as never,(()=>{nextCalls++;}) as never);
  assert.equal(nextCalls,1);
  protectedPlayUnavailable(request as never,response as never,(()=>{nextCalls++;}) as never);
  assert.equal(status,503);assert.equal(nextCalls,1);assert.equal(bodyReads,0);
});

test('INITIAL publication xid accepts only canonical positive uint64 text', () => {
  for (const value of ['1','4294967296','18446744073709551615']) assert.equal(isInitialPublicationXid(value),true);
  for (const value of ['', '0', '01', '+1', '-1', '1.0', '1e0', ' 1', '1\n', '18446744073709551616', '9'.repeat(1000), 1, 1n, null]) {
    assert.equal(isInitialPublicationXid(value),false);
  }
});
