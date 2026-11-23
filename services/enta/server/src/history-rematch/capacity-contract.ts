import { createHash, createPublicKey, verify } from 'node:crypto';
import { types } from 'node:util';
import { isIP } from 'node:net';
import { strictJSON } from './strict-json';

const descriptorKeys = ['allocationCoreHash','allocationId','baselinePartitionId','controlId','credentialEpoch','deployment','environment','expiresAt','launchEpoch','namespace','physicalIdentity','physicalProofIdentity','principalName','principalOid','project','schemaVersion','sourceIdentity'] as const;

/** Data-only ABI validation. This does not authenticate or publish a descriptor. */
export function descriptorCoreHash(value: unknown): string {
  const input = record(value, descriptorKeys);
  const core: Record<string, string> = Object.create(null);
  for (const key of descriptorKeys) {
    const v = input[key];
    if (typeof v !== 'string' || !v.length || /[\u0000\uD800-\uDFFF]/u.test(v.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) return unavailable();
    core[key] = v;
  }
  if (core.schemaVersion !== 'pro273-qualifier-descriptor-core-v1' || !digest(core.allocationCoreHash) ||
      !/^[1-9][0-9]{0,9}$/.test(core.principalOid as string) || BigInt(core.principalOid as string) > 4294967295n ||
      Buffer.byteLength(core.principalName as string, 'utf8') > 63 ||
      ['namespace','project','deployment','environment'].some(k => core[k] === '*')) return unavailable();
  startupTime(core.expiresAt);
  return createHash('sha256').update('["pro273.qualifier.descriptor.core.v1",' + startupCanonical(core) + ']', 'utf8').digest('hex');
}

// Data decoding only: no result from this function is an installed authority,
// a prepaid reservation, or permission to inspect or launch anything.
const startupVectorKeys = ['reservedBackendBytes','reservedSharedBytes','reservedTemporaryBytes','maxInputBytes','maxOutputBytes','maxAllocationBytes','stackBytes','parentBytes','maxProcessCount','maxBackendCount','maxLaunchAttempts','maxEvents','backendProcessBytes','qualifierRuntimeBytes','launcherSupervisorBytes','retainedParentBytes','driverSocketIpcBytes','inputEvidenceSerializationBytes','primitiveParserCacheBytes','rollbackCleanupBytes','sharedRuntimeBytes'] as const;
const startupLimitKeys = ['maxRegistryValueBytes','maxSecurityDescriptorBytes','maxManifestBytes','maxManifestEntries','maxDependencies','maxHandles','maxTokenGroups','maxTokenPrivileges','maxPermitBytes','maxChannelFrameBytes','maxChannelFrames','maxDiagnosticBytes','maxWorkspaceBytes','maxElapsedMillis'] as const;
const startupAttemptKeys = ['id','parentId','ordinal','holderReservationId','prepaymentReceiptHash','eventId','chargeKind','chargeEventKey','chargeBindingHash','fenceId'] as const;

// These are structural rejection limits, not resource grants or authority.
// The returned immutable strings are evidence about the copied bytes only: no
// issuer, signature, consumption or installed receiver is authenticated here.
// Generic framing does not enforce closed-payload scalar rules for NUL or lone surrogates.
export function fixedCapacityByteView(raw: Uint8Array, min: number, max: number): Uint8Array {
    if (types.isProxy(raw) || !types.isUint8Array(raw)) return unavailable();
    const typed = Object.getPrototypeOf(Uint8Array.prototype);
    const inputLength = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!.call(raw) as number;
    const offset = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!.call(raw) as number;
    const backing = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!.call(raw) as ArrayBuffer;
    if (types.isSharedArrayBuffer(backing) || Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get?.call(backing)) return unavailable();
    const extent = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!.call(backing) as number;
    if (inputLength < min || inputLength > max || offset > extent || inputLength > extent - offset) return unavailable();
    return new Uint8Array(backing, offset, inputLength);
}

type StartupFrame = Readonly<{frameHash:string; preimageHex:string; signatureHex:string; payload:unknown}>;

/** Structural local projection framing only; the payload has not been validated
 * as any of the six records and this result grants no operational authority. */
export function inspectStartupLocalFrameV2(raw: Uint8Array, kind: 'projection'|'starter'): Readonly<{frameHash:string; payload:unknown}> {
  try {
    if (kind !== 'projection' && kind !== 'starter') return unavailable();
    const cap = kind === 'starter' ? 65536 : 4096;
    const frame = Buffer.from(fixedCapacityByteView(raw, 13, cap + 12));
    if (!frame.subarray(0, 8).equals(Buffer.from('P273F002', 'ascii'))) return unavailable();
    const length = frame.readUInt32LE(8);
    if (!length || length > cap || frame.length !== length + 12) return unavailable();
    const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(frame.subarray(12));
    const value = strictJSON(text, cap);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
    // Local schemas consist solely of scalar strings; reject other shapes before
    // canonicalization, including duplicate keys, whitespace and numeric values.
    const row = value as Record<string, unknown>;
    if (Object.values(row).some(v => typeof v !== 'string') || startupCanonical(row) !== text) return unavailable();
    return Object.freeze({frameHash:createHash('sha256').update(frame).digest('hex'), payload:cloneJson(value, new Set())});
  } catch { return unavailable(); }
}

export function inspectStartupSignedFrame(raw: Uint8Array, kind: 'bundle'|'consumption'): StartupFrame {
  try {
    if (kind !== 'bundle' && kind !== 'consumption') return unavailable();
    return inspectCapturedStartupFrame(Buffer.from(fixedCapacityByteView(raw, 76, (kind === 'bundle' ? 16384 : 4096) + 76)), kind);
  } catch { return unavailable(); }
}

function inspectCapturedStartupFrame(frame: Buffer, kind: 'bundle'|'consumption'): StartupFrame {
    const cap = kind === 'bundle' ? 16384 : 4096;
    const magic = kind === 'bundle' ? 'P273B002' : 'P273C002';
    if (frame.subarray(0, 8).toString('ascii') !== magic || !frame.subarray(0, 8).equals(Buffer.from(magic, 'ascii'))) return unavailable();
    const length = frame.readUInt32LE(8);
    if (!length || length > cap || frame.length !== 12 + length + 64) return unavailable();
    const payloadBytes = frame.subarray(12, 12 + length);
    const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(payloadBytes);
    let depth = 0, tokens = 0, inString = false, escaped = false;
    for (const c of text) {
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') { inString = true; if (++tokens > 4096) return unavailable(); }
      else if (c === '{' || c === '[') { if (++depth > 8 || ++tokens > 4096) return unavailable(); }
      else if (c === '}' || c === ']') { if (--depth < 0) return unavailable(); }
      else if (c !== ':' && c !== ',') return unavailable();
    }
    if (inString || depth !== 0) return unavailable();
    const value = strictJSON(text, cap);
    const canonical = (v: unknown): string => {
      if (typeof v === 'string') return JSON.stringify(v);
      if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
      if (!v || typeof v !== 'object') return unavailable();
      const row = v as Record<string,unknown>;
      return `{${Object.keys(row).sort().map(k => `${JSON.stringify(k)}:${canonical(row[k])}`).join(',')}}`;
    };
    if (!value || typeof value !== 'object' || Array.isArray(value) || canonical(value) !== text) return unavailable();
    const prefix = Buffer.from(`pro273.startup.${kind}.v2\n`, 'utf8');
    return Object.freeze({frameHash:createHash('sha256').update(frame).digest('hex'),
      preimageHex:Buffer.concat([prefix, frame.subarray(0, 12 + length)]).toString('hex'),
      signatureHex:frame.subarray(12 + length).toString('hex'), payload:cloneJson(value, new Set())});
}

/** Data-only event chain validation; global uniqueness and spending are external. */
export function inspectStartupEvents(value: unknown, holder: unknown): void {
  try {
    if (!startupId(holder) || !Array.isArray(value) || types.isProxy(value) || value.length !== 4 ||
        Reflect.ownKeys(value).length !== 5) return unavailable();
    const kinds = ['SERVICE_START','NODE_LAUNCH','PSQL_LAUNCH','CONSTRUCTOR_DISPATCH'];
    const keys = ['kind','attemptId','parentAttemptId','eventId','externalChargeId','externalChargeBindingHash','fenceId'];
    const identities = new Set<unknown>([holder]);
    let parent: unknown = holder;
    for (let i = 0; i < 4; i++) {
      const item = Object.getOwnPropertyDescriptor(value, String(i));
      if (!item || !('value' in item)) return unavailable();
      const e = v2Record(item.value, keys);
      if (e.kind !== kinds[i] || e.parentAttemptId !== parent || !digest(e.externalChargeBindingHash)) return unavailable();
      for (const key of ['attemptId','parentAttemptId','eventId','externalChargeId','fenceId']) if (!startupId(e[key])) return unavailable();
      for (const key of ['attemptId','eventId','externalChargeId','fenceId']) {
        if (identities.has(e[key])) return unavailable();
        identities.add(e[key]);
      }
      parent = e.attemptId;
    }
  } catch { return unavailable(); }
}

const bundleV2Keys = ['schemaVersion','issuerId','issuerGeneration','accountingDomain','bundleId','qualificationHash','holderReservationId','holderReservationRecordHash','holderPrepaymentReceiptHash','physicalIdentity','physicalProofIdentity','partitionId','authorityEpoch','installationGeneration','hostIdentity','bootIdentity','validFrom','validUntil','sourceClosureHash','starterClosureHash','serviceReceiverClosureHash','manifestHash','events','sqlTarget','coverage'] as const;
const startupV2LimitKeys = ['bundleBytes','consumptionBytes','localRecordBytes','totalReadBytes','totalWriteBytes','readCalls','writeCalls','flushCalls','hashCalls','signatureChecks','fileCreates','fileOpens','registryReads','securityQueries','processQueries','scmQueries','eventCreates','eventSignals','eventWaits','startServiceCalls','processLaunches','dispatchWrites','handles','threads','backendPeakBytes','parentPeakBytes','sharedPeakBytes','temporaryPeakBytes','durableBytes','elapsedMillis'] as const;
const startupV2CoverageHashes = ['holderRecordHash','resourceScheduleHash','manifestHash','memoryEvidenceHash','workEvidenceHash','durabilityEvidenceHash','cleanupEvidenceHash'] as const;
const startupV2TargetKeys = ['expectationId','dispatchAttemptId','receiverClosureHash','constructorKind','targetId','expectedCoreHash','expectedEvidenceHash'] as const;
const consumptionV2Keys = ['schemaVersion','issuerId','issuerGeneration','bundleId','bundleHash','holderReservationId','consumptionId','consumedAt','issuerCommitIdentity','eventsHash','coverageHash'] as const;

const localEventKeys = ['kind','attemptId','parentAttemptId','eventId','externalChargeId','externalChargeBindingHash','fenceId'] as const;
const localCommonKeys = ['bundleId','bundleHash','consumptionId','consumptionHash','qualificationHash','starterNonce'] as const;
const localProjectionKeys = ['schemaVersion',...localCommonKeys,...localEventKeys] as const;
const localStarterKeys = ['schemaVersion','bundleFrameBase64','consumptionFrameBase64','starterNonce','starterPid','starterCreationTime','starterImageHash','serviceConsumeHash','nodeConsumeHash','psqlConsumeHash','dispatchConsumeHash'] as const;
const localServiceKeys = ['schemaVersion',...localCommonKeys,'starterReceiptHash','serviceName','serviceSid','servicePid','serviceCreationTime','serviceImageHash','hostIdentity','bootIdentity','authorityEpoch','installationGeneration'] as const;

function validStartupServiceIdentity(name: unknown, sid: unknown): boolean {
  return name === 'HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028' && typeof sid === 'string' &&
    /^S-1-5-80-(?:0|[1-9][0-9]{0,9})(?:-(?:0|[1-9][0-9]{0,9})){4}$/.test(sid) &&
    !sid.split('-').slice(4).some(x => BigInt(x) > 4294967295n);
}

function localBase64(value: unknown, max: number): Buffer {
  if (typeof value !== 'string' || !value.length || value.length > 4 * Math.ceil(max / 3) || value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return unavailable();
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (value.length / 4 * 3 - padding > max) return unavailable();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if ((padding === 2 && (alphabet.indexOf(value[value.length - 3]) & 15) !== 0) ||
      (padding === 1 && (alphabet.indexOf(value[value.length - 2]) & 3) !== 0)) return unavailable();
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) return unavailable();
  return decoded;
}

/** Correlates captured local records as data only; no authority or admission is conferred. */
export function inspectStartupLocalRecordsV2(bundleBytes: Uint8Array, consumptionBytes: Uint8Array, projections: readonly Uint8Array[], starterBytes: Uint8Array, serviceBytes: Uint8Array): Readonly<{bundleHash:string; consumptionHash:string; projectionHashes:readonly string[]; starterReceiptHash:string; serviceBindingHash:string}> {
  try {
    if (!Array.isArray(projections) || types.isProxy(projections) || projections.length !== 4 || Reflect.ownKeys(projections).length !== 5) return unavailable();
    const inputs: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) {
      const d = Object.getOwnPropertyDescriptor(projections, String(i));
      if (!d || !('value' in d)) return unavailable();
      inputs.push(d.value);
    }
    // Check all intrinsic storage before copying, and thereafter use only snapshots.
    const views = [fixedCapacityByteView(bundleBytes,76,16460), fixedCapacityByteView(consumptionBytes,76,4172),
      ...inputs.map(x => fixedCapacityByteView(x,13,4108)), fixedCapacityByteView(starterBytes,13,65548), fixedCapacityByteView(serviceBytes,13,4108)];
    const captured = views.map(x => Buffer.from(x));
    const bundle = inspectCapturedStartupFrame(captured[0], 'bundle'), consumption = inspectCapturedStartupFrame(captured[1], 'consumption');
    const hashes = inspectStartupBundleFramesV2(bundle, consumption);
    const b = v2Record(bundle.payload, bundleV2Keys), c = v2Record(consumption.payload, consumptionV2Keys);
    const events = b.events as Record<string, unknown>[];
    const local = captured.slice(2,6).map(x => inspectStartupLocalFrameV2(x, 'projection'));
    const starter = inspectStartupLocalFrameV2(captured[6], 'starter');
    const service = inspectStartupLocalFrameV2(captured[7], 'projection');
    const s = v2Record(starter.payload, localStarterKeys), binding = v2Record(service.payload, localServiceKeys);
    if (s.schemaVersion !== 'pro273-consumed-starter-v2' || !digest(s.starterNonce) || !digest(s.starterImageHash)) return unavailable();
    if (startupUint(s.starterPid) > 4294967295n) return unavailable();
    startupUint(s.starterCreationTime);
    if (!localBase64(s.bundleFrameBase64,16460).equals(captured[0]) || !localBase64(s.consumptionFrameBase64,4172).equals(captured[1])) return unavailable();
    const common: Record<string,unknown> = {bundleId:b.bundleId,bundleHash:hashes.bundleHash,consumptionId:c.consumptionId,consumptionHash:hashes.consumptionHash,qualificationHash:b.qualificationHash,starterNonce:s.starterNonce};
    const receiptHashKeys = ['serviceConsumeHash','nodeConsumeHash','psqlConsumeHash','dispatchConsumeHash'];
    for (let i = 0; i < 4; i++) {
      const p = v2Record(local[i].payload, localProjectionKeys);
      if (p.schemaVersion !== 'pro273-startup-event-projection-v2' || localCommonKeys.some(k => p[k] !== common[k]) ||
          localEventKeys.some(k => p[k] !== events[i][k]) || s[receiptHashKeys[i]] !== local[i].frameHash) return unavailable();
    }
    if (binding.schemaVersion !== 'pro273-starter-service-binding-v2' || localCommonKeys.some(k => binding[k] !== common[k]) ||
        binding.starterReceiptHash !== starter.frameHash || !validStartupServiceIdentity(binding.serviceName, binding.serviceSid) ||
        startupUint(binding.servicePid) > 4294967295n ||
        !digest(binding.serviceImageHash)) return unavailable();
    startupUint(binding.serviceCreationTime);
    for (const k of ['hostIdentity','bootIdentity','authorityEpoch','installationGeneration']) if (binding[k] !== b[k]) return unavailable();
    return Object.freeze({bundleHash:hashes.bundleHash,consumptionHash:hashes.consumptionHash,projectionHashes:Object.freeze(local.map(x => x.frameHash)),starterReceiptHash:starter.frameHash,serviceBindingHash:service.frameHash});
  } catch { return unavailable(); }
}

const startupReceiverBindingV2Keys = ['schemaVersion','serviceReceiverClosureHash','sqlReceiverClosureHash','sourceClosureHash','installationClosureHash','authorityEpoch','installationGeneration'] as const;

/** Partial, inert manifest prototype. Declared membership cannot establish
 * complete loader closure or operational authority; installation and use remain denied.
 * The path encoding is a structural choice pending installed
 * loader/schema qualification. Paths use
 * slash-separated ASCII components below one protected root. volumeId is a
 * 16-hex-digit unsigned serial in most-significant-digit-first order; fileId is
 * the 16 FILE_ID_INFO Identifier bytes in their returned array order, hex encoded.
 * Neither value establishes a Windows object identity. Limits reject data and
 * do not fund work. The comparison hash is untrusted and grants no authority. */
export function inspectStartupManifestV2(raw: Uint8Array, comparisonHash: unknown): Readonly<{frameHash:string; payload:unknown}> {
  try {
    const cap = 65536, maxEntries = 128;
    const frame = Buffer.from(fixedCapacityByteView(raw, 13, cap + 12));
    if (!frame.subarray(0,8).equals(Buffer.from('P273M002')) || !digest(comparisonHash)) return unavailable();
    const length = frame.readUInt32LE(8);
    if (!length || length > cap || frame.length !== length + 12) return unavailable();
    const frameHash = createHash('sha256').update(frame).digest('hex');
    if (frameHash !== comparisonHash) return unavailable();
    const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(frame.subarray(12));
    let depth = 0, tokens = 0, inString = false, escaped = false;
    const containers: {array:boolean; commas:number}[] = [];
    for (const c of text) {
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') { inString = true; if (++tokens > 4096) return unavailable(); }
      else if (c === '{' || c === '[') { if (++depth > 8 || ++tokens > 4096) return unavailable(); containers.push({array:c === '[',commas:0}); }
      else if (c === '}' || c === ']') { if (--depth < 0 || containers.pop()?.array !== (c === ']')) return unavailable(); }
      else if (c === ',') { const parent = containers[containers.length-1]; if (parent?.array && ++parent.commas >= maxEntries) return unavailable(); }
      else if (c !== ':') return unavailable();
    }
    if (inString || depth !== 0) return unavailable();
    const m = v2Record(strictJSON(text, cap), ['schemaVersion','authorityEpoch','installationGeneration','hostIdentity','bootIdentity','sourceClosureHash','installationClosureHash','artifacts','serviceClosure','sqlReceiverClosure','receiverBinding','endpoint','credentialProfile','resourceQualificationHash']);
    if (m.schemaVersion !== 'pro273-installer-manifest-v2') return unavailable();
    startupUint(m.authorityEpoch); startupUint(m.installationGeneration);
    for (const k of ['hostIdentity','bootIdentity']) if (typeof m[k] !== 'string' || !/^[a-f0-9]{32}$/.test(m[k] as string)) return unavailable();
    for (const k of ['sourceClosureHash','installationClosureHash','resourceQualificationHash']) if (!digest(m[k])) return unavailable();
    if (!Array.isArray(m.artifacts) || !m.artifacts.length || m.artifacts.length > maxEntries) return unavailable();
    const ids = new Map<string,Record<string,unknown>>(), paths = new Set<string>(), identities = new Set<string>(), pathSpellings = new Map<string,string>();
    const id = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
    const roles = ['SERVICE_EXE','NODE_EXE','RECEIVER_ENTRY','PSQL_EXE','LIBPQ','TLS_LIBRARY','RUNTIME_LIBRARY','NATIVE_LIBRARY','LOADER_CONFIG','OS_LIBRARY','TLS_ROOT','CREDENTIAL_FILE'];
    const requiredRoles = ['SERVICE_EXE','NODE_EXE','RECEIVER_ENTRY','PSQL_EXE','TLS_ROOT','CREDENTIAL_FILE'];
    const singletonRoles = new Set<string>();
    for (const value of m.artifacts) {
      const a = v2Record(value,['artifactId','role','relativePath','byteLength','sha256','volumeId','fileId']);
      if (!id(a.artifactId) || ids.has(a.artifactId) || !roles.includes(a.role as string) || a.role === 'OS_LIBRARY' || !digest(a.sha256) ||
          typeof a.volumeId !== 'string' || !/^[a-f0-9]{16}$/.test(a.volumeId) || typeof a.fileId !== 'string' || !/^[a-f0-9]{32}$/.test(a.fileId)) return unavailable();
      if (requiredRoles.includes(a.role as string)) {
        if (singletonRoles.has(a.role as string)) return unavailable();
        singletonRoles.add(a.role as string);
      }
      startupUint(a.byteLength, false);
      if (typeof a.relativePath !== 'string' || a.relativePath.length > 240) return unavailable();
      const parts = a.relativePath.split('/');
      if (parts.length > 16 || parts.some(p => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) return unavailable();
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.slice(0,i + 1).join('/'), folded = prefix.toLowerCase(), prior = pathSpellings.get(folded);
        if ((prior && prior !== prefix) || (i < parts.length - 1 && paths.has(folded))) return unavailable();
        pathSpellings.set(folded,prefix);
      }
      const path = a.relativePath.toLowerCase(), identity = `${a.volumeId}:${a.fileId}`;
      if (paths.has(path) || [...pathSpellings.keys()].some(p => p.startsWith(`${path}/`)) || identities.has(identity)) return unavailable();
      paths.add(path); identities.add(identity); ids.set(a.artifactId,a);
    }
    if (requiredRoles.some(role => !singletonRoles.has(role))) return unavailable();
    const closure = (value: unknown, domain: string, entryRole: string, requiredMembers: string[]): string => {
      const c = v2Record(value,['schemaVersion','entryArtifactId','artifactIds','loaderQualificationHash']);
      if (c.schemaVersion !== 'pro273-artifact-closure-v2' || !id(c.entryArtifactId) || !digest(c.loaderQualificationHash) ||
          !Array.isArray(c.artifactIds) || !c.artifactIds.length || c.artifactIds.length > maxEntries) return unavailable();
      const selected: Record<string,unknown>[] = []; let previous = '';
      for (const item of c.artifactIds) {
        if (!id(item) || item <= previous || !ids.has(item)) return unavailable();
        previous = item; selected.push(ids.get(item)!);
      }
      if (!c.artifactIds.includes(c.entryArtifactId) || ids.get(c.entryArtifactId)?.role !== entryRole ||
          requiredMembers.some(role => !selected.some(a => a.role === role))) return unavailable();
      return createHash('sha256').update(startupV2Canonical([domain,c,selected]),'utf8').digest('hex');
    };
    const serviceHash = closure(m.serviceClosure,'pro273.installer.service-closure.v2','SERVICE_EXE',[]);
    const sqlHash = closure(m.sqlReceiverClosure,'pro273.installer.sql-receiver-closure.v2','RECEIVER_ENTRY',['NODE_EXE','PSQL_EXE']);
    const b = v2Record(m.receiverBinding,startupReceiverBindingV2Keys);
    if (b.schemaVersion !== 'pro273-startup-receiver-binding-v2' || b.serviceReceiverClosureHash !== serviceHash || b.sqlReceiverClosureHash !== sqlHash ||
        b.sourceClosureHash !== m.sourceClosureHash || b.installationClosureHash !== m.installationClosureHash || b.authorityEpoch !== m.authorityEpoch || b.installationGeneration !== m.installationGeneration) return unavailable();
    const e = v2Record(m.endpoint,['schemaVersion','endpointId','host','hostAddress','port','database','user','sslMode','tlsRootArtifactId','gssEncMode','channelBinding','connectTimeoutSeconds','serverIdentityQualificationHash']);
    const dns = typeof e.host === 'string' && e.host.length <= 253 && e.host === e.host.toLowerCase() && e.host.includes('.') && e.host.split('.').every(x => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(x)) && /[a-z]/.test(e.host.split('.').slice(-1)[0]) && isIP(e.host) === 0;
    if (e.schemaVersion !== 'pro273-installer-endpoint-v1' || !id(e.endpointId) || !dns || typeof e.hostAddress !== 'string' || isIP(e.hostAddress) !== 4 ||
        typeof e.port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(e.port) || BigInt(e.port) > 65535n ||
        typeof e.database !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(e.database) || typeof e.user !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(e.user) ||
        e.sslMode !== 'verify-full' || e.gssEncMode !== 'disable' || e.channelBinding !== 'require' || !id(e.tlsRootArtifactId) || ids.get(e.tlsRootArtifactId)?.role !== 'TLS_ROOT' ||
        typeof e.connectTimeoutSeconds !== 'string' || !/^[1-9][0-9]{0,2}$/.test(e.connectTimeoutSeconds) || !digest(e.serverIdentityQualificationHash)) return unavailable();
    const p = v2Record(m.credentialProfile,['schemaVersion','credentialConfigId','endpointId','method','credentialArtifactId','credentialCustodyQualificationHash']);
    if (p.schemaVersion !== 'pro273-installer-auth-v1' || !id(p.credentialConfigId) || p.endpointId !== e.endpointId || p.method !== 'SCRAM-SHA-256' ||
        !id(p.credentialArtifactId) || ids.get(p.credentialArtifactId)?.role !== 'CREDENTIAL_FILE' || !digest(p.credentialCustodyQualificationHash)) return unavailable();
    if (startupV2Canonical(m) !== text) return unavailable();
    return Object.freeze({frameHash,payload:cloneJson(m, new Set())});
  } catch { return unavailable(); }
}

/** Correlation of captured decoded data only. Neither the association nor the
 * separately supplied installation value is authenticated here. Manifest
 * framing and exact-byte anchoring, issuer, loader and receiver authority are
 * absent; a matching result grants no admission or operational authority. */
export function inspectStartupReceiverBindingV2(binding: unknown, bundle: unknown, installationClosureHash: unknown): Readonly<Record<string, unknown>> {
  try {
    const association = v2Record(binding, startupReceiverBindingV2Keys);
    const b = v2Record(bundle, bundleV2Keys);
    const target = v2Record(b.sqlTarget, startupV2TargetKeys);
    if (association.schemaVersion !== 'pro273-startup-receiver-binding-v2') return unavailable();
    for (const key of ['serviceReceiverClosureHash','sqlReceiverClosureHash','sourceClosureHash','installationClosureHash'])
      if (!digest(association[key])) return unavailable();
    startupUint(association.authorityEpoch);
    startupUint(association.installationGeneration);
    if (!digest(installationClosureHash) || association.serviceReceiverClosureHash !== b.serviceReceiverClosureHash ||
        association.sqlReceiverClosureHash !== target.receiverClosureHash || association.sourceClosureHash !== b.sourceClosureHash ||
        association.installationClosureHash !== installationClosureHash || association.authorityEpoch !== b.authorityEpoch ||
        association.installationGeneration !== b.installationGeneration) return unavailable();
    return Object.freeze(association);
  } catch { return unavailable(); }
}

function startupV2Canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(startupV2Canonical).join(',')}]`;
  return typeof value === 'string' ? JSON.stringify(value) : `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${startupV2Canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
}
function startupV2Hash(domain: string, value: unknown): string {
  return createHash('sha256').update(startupV2Canonical([domain,value]), 'utf8').digest('hex');
}

/** Correlates captured canonical bytes only. No signature, issuer, consumption,
 * resource qualification or authorization is established by this data result.
 * Scalar bounds are structural rejection boundaries only. Coverage units, maxima
 * and resource profile remain independently unqualified. Authenticated manifest
 * association and SQL expectation/attempt/session/delivery/charge joins remain absent. */
export function inspectStartupBundleV2(bundleBytes: Uint8Array, consumptionBytes: Uint8Array): Readonly<{bundleHash:string; consumptionHash:string; eventsHash:string; coverageHash:string}> {
  try {
    const bundleFrame = inspectStartupSignedFrame(bundleBytes, 'bundle');
    const consumptionFrame = inspectStartupSignedFrame(consumptionBytes, 'consumption');
    return inspectStartupBundleFramesV2(bundleFrame, consumptionFrame);
  } catch { return unavailable(); }
}

/** Signature checks against one caller-supplied, unauthenticated raw key. This
 * data result grants no issuer authority, admission, funding or consumption. */
export function verifyStartupBundleV2(bundleBytes: Uint8Array, consumptionBytes: Uint8Array, rawPublicKey: Uint8Array): Readonly<{bundleHash:string; consumptionHash:string; eventsHash:string; coverageHash:string}> {
  try {
    // Validate all intrinsic storage before any copy; shared/resizable backing is rejected.
    const bundleView = fixedCapacityByteView(bundleBytes, 76, 16384 + 76);
    const consumptionView = fixedCapacityByteView(consumptionBytes, 76, 4096 + 76);
    const keyView = fixedCapacityByteView(rawPublicKey, 32, 32);
    const bundle = Buffer.from(bundleView), consumption = Buffer.from(consumptionView), key = Buffer.from(keyView);
    const bundleFrame = inspectCapturedStartupFrame(bundle, 'bundle');
    const consumptionFrame = inspectCapturedStartupFrame(consumption, 'consumption');
    verifyStartupFrameSignatures(bundleFrame, consumptionFrame, key);
    return inspectStartupBundleFramesV2(bundleFrame, consumptionFrame);
  } catch { return unavailable(); }
}

function verifyStartupFrameSignatures(bundle: StartupFrame, consumption: StartupFrame, key: Buffer): void {
  const publicKey = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format:'der', type:'spki'});
  for (const frame of [bundle, consumption]) {
    if (!verify(null, Buffer.from(frame.preimageHex, 'hex'), publicKey, Buffer.from(frame.signatureHex, 'hex'))) return unavailable();
  }
}

function inspectStartupBundleFramesV2(bundleFrame: StartupFrame, consumptionFrame: StartupFrame): Readonly<{bundleHash:string; consumptionHash:string; eventsHash:string; coverageHash:string}> {
    const b = v2Record(bundleFrame.payload, bundleV2Keys);
    if (b.schemaVersion !== 'pro273-startup-bundle-v2' || b.accountingDomain !== 'EXTERNAL_STARTUP') return unavailable();
    for (const k of ['issuerId','bundleId','holderReservationId','physicalIdentity','physicalProofIdentity','partitionId']) if (!startupId(b[k])) return unavailable();
    for (const k of ['issuerGeneration','authorityEpoch','installationGeneration']) startupUint(b[k]);
    for (const k of ['hostIdentity','bootIdentity']) if (typeof b[k] !== 'string' || !/^[a-f0-9]{32}$/.test(b[k] as string)) return unavailable();
    for (const k of ['qualificationHash','holderReservationRecordHash','holderPrepaymentReceiptHash','sourceClosureHash','starterClosureHash','serviceReceiverClosureHash','manifestHash']) if (!digest(b[k])) return unavailable();
    if (startupTime(b.validFrom) >= startupTime(b.validUntil)) return unavailable();
    inspectStartupEvents(b.events, b.holderReservationId);
    const target = v2Record(b.sqlTarget, startupV2TargetKeys);
    for (const k of ['expectationId','dispatchAttemptId','targetId']) if (!startupId(target[k])) return unavailable();
    for (const k of ['receiverClosureHash','expectedCoreHash','expectedEvidenceHash']) if (!digest(target[k])) return unavailable();
    if (target.constructorKind !== 'CONTROL_PLANE_BASELINE' && target.constructorKind !== 'INVOCATION_SCHEDULE_GRANT_PAIR') return unavailable();
    const coverage = v2Record(b.coverage, ['schemaVersion',...startupV2CoverageHashes,'limits']);
    if (coverage.schemaVersion !== 'pro273-startup-coverage-v2') return unavailable();
    for (const k of startupV2CoverageHashes) if (!digest(coverage[k])) return unavailable();
    const limits = v2Record(coverage.limits, startupV2LimitKeys);
    for (const k of startupV2LimitKeys) startupUint(limits[k], false);
    if (coverage.holderRecordHash !== b.holderReservationRecordHash || coverage.manifestHash !== b.manifestHash) return unavailable();
    const eventsHash = startupV2Hash('pro273.startup.events.v2', b.events);
    const coverageHash = startupV2Hash('pro273.startup.coverage.v2', b.coverage);
    const c = v2Record(consumptionFrame.payload, consumptionV2Keys);
    if (c.schemaVersion !== 'pro273-startup-bundle-consumption-v2' || c.issuerId !== b.issuerId || c.issuerGeneration !== b.issuerGeneration ||
        c.bundleId !== b.bundleId || c.bundleHash !== bundleFrame.frameHash || c.holderReservationId !== b.holderReservationId ||
        c.eventsHash !== eventsHash || c.coverageHash !== coverageHash || !startupId(c.consumptionId) || !startupId(c.issuerCommitIdentity)) return unavailable();
    const consumedAt = startupTime(c.consumedAt);
    if (consumedAt < (b.validFrom as string) || consumedAt >= (b.validUntil as string)) return unavailable();
    return Object.freeze({bundleHash:bundleFrame.frameHash, consumptionHash:consumptionFrame.frameHash, eventsHash, coverageHash});
}
const startupId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const startupUint = (v: unknown, nonzero = true): bigint => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(v)) return unavailable();
  const n = BigInt(v); if (n > 18446744073709551615n || (nonzero && n === 0n)) return unavailable(); return n;
};
const startupTime = (v: unknown): string => {
  if (typeof v !== 'string' || !/^(?!0000)\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)) return unavailable();
  const n = Date.parse(v); if (!Number.isFinite(n) || new Date(n).toISOString() !== v) return unavailable(); return v;
};
function startupCanonical(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map(k => `${JSON.stringify(k)}:${startupCanonical(row[k])}`).join(',')}}`;
}
/** Checks actual bytes and closed shape, but does not authenticate any field. */
export function decodeStartupQualification(raw: Uint8Array): Readonly<Record<string, unknown>> {
  try {
    if (!(raw instanceof Uint8Array) || !raw.byteLength || raw.byteLength > 65536) return unavailable();
    const bytes = Buffer.from(raw);
    const text = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);
    // Reject before JSON.parse if the fixed depth/token rejection ceilings are exceeded.
    let depth = 0, tokens = 0, inString = false, escaped = false;
    for (const c of text) {
      if (inString) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') inString = false; continue; }
      if (c === '"') { inString = true; if (++tokens > 4096) return unavailable(); }
      else if (c === '{' || c === '[') { if (++depth > 6 || ++tokens > 4096) return unavailable(); }
      else if (c === '}' || c === ']') { if (--depth < 0) return unavailable(); }
      else if (c === ':' || c === ',' || /\s/.test(c)) { /* grammar checked below */ }
      else return unavailable(); // all permitted leaf values are strings
    }
    if (inString || depth !== 0) return unavailable();
    const decoded = strictJSON(text, 65536);
    if (startupCanonical(decoded) !== text) return unavailable();
    const q = record(decoded, ['schemaVersion','qualificationId','authorityEpoch','installationGeneration','hostIdentity','bootIdentity','serviceIdentity','validFrom','validUntil','sourceClosureHash','installationClosureHash','receiverClosureHash','launcherManifestHash','nodeManifestHash','psqlManifestHash','loaderQualificationHash','fenceQualificationHash','holder','serviceStart','nodeLaunch','psqlAttempt','limits']);
    if (q.schemaVersion !== 'pro273-installer-startup-qualification-v1' || !startupId(q.qualificationId)) return unavailable();
    startupUint(q.authorityEpoch); startupUint(q.installationGeneration);
    for (const k of ['hostIdentity','bootIdentity']) if (typeof q[k] !== 'string' || !/^[a-f0-9]{32}$/.test(q[k] as string)) return unavailable();
    for (const k of ['sourceClosureHash','installationClosureHash','receiverClosureHash','launcherManifestHash','nodeManifestHash','psqlManifestHash','loaderQualificationHash','fenceQualificationHash']) if (!digest(q[k])) return unavailable();
    const service = record(q.serviceIdentity, ['serviceName','serviceSid']);
    if (service.serviceName !== 'HuroofWaOloofInstallerRoot-PRO311-LOCAL-20261028' || typeof service.serviceSid !== 'string' || !/^S-1-5-80(?:-(?:0|[1-9][0-9]{0,9})){5}$/.test(service.serviceSid) || service.serviceSid.split('-').slice(4).some(x => BigInt(x) > 4294967295n)) return unavailable();
    const from = startupTime(q.validFrom), until = startupTime(q.validUntil); if (from >= until) return unavailable();
    const h = record(q.holder, ['reservationId','reservationRecordHash','prepaymentReceiptHash','physicalIdentity','physicalProofIdentity','partitionId','partitionKind','sourceClosureHash','installationClosureHash','validFrom','validUntil','vector']);
    for (const k of ['reservationId','physicalIdentity','physicalProofIdentity','partitionId']) if (!startupId(h[k])) return unavailable();
    for (const k of ['reservationRecordHash','prepaymentReceiptHash','sourceClosureHash','installationClosureHash']) if (!digest(h[k])) return unavailable();
    if (h.partitionKind !== 'NON_QUALIFIER_BASELINE' || h.sourceClosureHash !== q.sourceClosureHash || h.installationClosureHash !== q.installationClosureHash || startupTime(h.validFrom) > from || startupTime(h.validUntil) < until) return unavailable();
    const v = record(h.vector, startupVectorKeys), numbers: Record<string,bigint> = {};
    startupVectorKeys.forEach((k,i) => { numbers[k] = startupUint(v[k], i < 12); });
    // Structural minima only; these do not establish funding or complete SQL event capacity.
    if (numbers.maxLaunchAttempts < 3n || numbers.maxEvents < 3n || numbers.maxProcessCount < 3n) return unavailable();
    const sum = ['backendProcessBytes','qualifierRuntimeBytes','launcherSupervisorBytes','retainedParentBytes','driverSocketIpcBytes','inputEvidenceSerializationBytes','primitiveParserCacheBytes','rollbackCleanupBytes'].reduce((a,k) => a + numbers[k], 0n);
    if (numbers.reservedBackendBytes < sum || numbers.reservedSharedBytes < numbers.sharedRuntimeBytes + numbers.reservedTemporaryBytes || numbers.parentBytes > numbers.retainedParentBytes || numbers.maxAllocationBytes > numbers.reservedBackendBytes || numbers.stackBytes > numbers.reservedBackendBytes) return unavailable();
    const limits = record(q.limits, startupLimitKeys); startupLimitKeys.forEach(k => { startupUint(limits[k]); });
    if (startupUint(limits.maxChannelFrames) < 6n) return unavailable();
    const attempts = [q.serviceStart,q.nodeLaunch,q.psqlAttempt].map(x => record(x, startupAttemptKeys));
    let parent: unknown = h.reservationId;
    for (const a of attempts) {
      for (const k of ['id','parentId','holderReservationId','eventId','chargeKind','chargeEventKey','fenceId']) if (!startupId(a[k])) return unavailable();
      if (a.ordinal !== '1' || a.parentId !== parent || a.holderReservationId !== h.reservationId || a.prepaymentReceiptHash !== h.prepaymentReceiptHash || !digest(a.chargeBindingHash)) return unavailable(); parent = a.id;
    }
    const identities = attempts.flatMap(a => [a.id, a.eventId, a.fenceId]);
    if (new Set(identities).size !== identities.length || identities.includes(h.reservationId)) return unavailable();
    if (new Set(attempts.map(a => `${a.chargeKind}:${a.chargeEventKey}`)).size !== 3) return unavailable();
    return cloneJson(q, new Set()) as Readonly<Record<string, unknown>>;
  } catch { return unavailable(); }
}
/** PRO262-CAP Source contract. External authority and physical qualification are not installed here. */
export class CapacityUnavailable extends Error {
  constructor() { super('CAPACITY_UNAVAILABLE'); this.name = 'CapacityUnavailable'; }
}
export function unavailable(): never { throw new CapacityUnavailable(); }

export type OperationKind = 'ENTA_SUCCESSOR' | 'PG_SETUP' | 'PG_START';
export type ReuseMode = 'ONE_USE' | 'REUSABLE';
export type ResourceState = 'RESERVED' | 'RUNNING' | 'DRAINING' | 'QUARANTINED' | 'RELEASED';
export interface ControlRequest { readonly namespace: string; readonly project: string; readonly owner: string; readonly route: string; readonly operation: OperationKind; readonly requestIdentity: string }
export interface Subject { readonly namespace: string; readonly project: string; readonly owner: string; readonly route: string; readonly operation: OperationKind; readonly requestDigest: string }
export interface Incarnation { readonly host: string; readonly boot: string; readonly processTree: string; readonly backendPrincipal: string; readonly backendPid: number; readonly backendStart: string }
export interface Qualification { readonly id: string; readonly generation: bigint; readonly evidenceHash: string; readonly validUntil: number; readonly reuse: ReuseMode; readonly domain: string; readonly sourceClosure: string }
export interface Admission { readonly id: string; readonly fence: bigint; readonly subject: Subject; readonly incarnation: Incarnation; readonly qualification: Qualification; readonly expiresAt: number; readonly state: ResourceState }
export interface SpoolRef { readonly id: string; readonly digest: string; readonly envelope: string }
export interface ControlLease { readonly id: string; readonly envelope: string }
export interface ReplayLease { readonly id: string; readonly control: string; readonly envelope: string }
export interface MissReceipt { readonly id: string; readonly replay: string; readonly requestIdentity: string; readonly spool: SpoolRef; readonly subject: Subject; readonly incarnation: Incarnation }
export interface CleanupEvidence { readonly admissionId: string; readonly fence: bigint; readonly incarnation: Incarnation; readonly outcome: 'COMMITTED' | 'ROLLED_BACK'; readonly protocolDrained: true; readonly ipcDrained: true; readonly parentDrained: true; readonly processTreeTerminated: true; readonly backendAbsent: true; readonly observerGeneration: bigint }

const identifier = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && !/[\u0000-\u001f]/.test(x);
const digest = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const positive = (x: unknown): x is bigint => typeof x === 'bigint' && x > 0n;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable();
  const row = value as Record<string, unknown>;
  const found = Object.keys(row);
  if (found.length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) return unavailable();
  return row;
}
/** Captures every field once; returned values never alias input records. */
export function subject(value: unknown): Subject {
  const r = record(value, ['namespace','project','owner','route','operation','requestDigest']);
  const { namespace, project, owner, route, operation, requestDigest } = r;
  if (!identifier(namespace) || !identifier(project) || !identifier(owner) || !identifier(route) ||
      (operation !== 'ENTA_SUCCESSOR' && operation !== 'PG_SETUP' && operation !== 'PG_START') || !digest(requestDigest)) return unavailable();
  return Object.freeze({ namespace, project, owner, route, operation, requestDigest });
}
export function incarnation(value: unknown): Incarnation {
  const r = record(value, ['host','boot','processTree','backendPrincipal','backendPid','backendStart']);
  const { host, boot, processTree, backendPrincipal, backendPid, backendStart } = r;
  if (!identifier(host) || !identifier(boot) || !identifier(processTree) || !identifier(backendPrincipal) || !finite(backendPid) || !identifier(backendStart)) return unavailable();
  return Object.freeze({ host, boot, processTree, backendPrincipal, backendPid, backendStart });
}
export function qualification(value: unknown): Qualification {
  const r = record(value, ['id','generation','evidenceHash','validUntil','reuse','domain','sourceClosure']);
  const { id, generation, evidenceHash, validUntil, reuse, domain, sourceClosure } = r;
  if (!identifier(id) || !positive(generation) || !digest(evidenceHash) || !finite(validUntil) ||
      (reuse !== 'ONE_USE' && reuse !== 'REUSABLE') || !identifier(domain) || !digest(sourceClosure)) return unavailable();
  return Object.freeze({ id, generation, evidenceHash, validUntil, reuse, domain, sourceClosure });
}
export function sameSubject(a: Subject, b: Subject): boolean {
  return a.namespace === b.namespace && a.project === b.project && a.owner === b.owner && a.route === b.route && a.operation === b.operation && a.requestDigest === b.requestDigest;
}
export function sameIncarnation(a: Incarnation, b: Incarnation): boolean {
  return a.host === b.host && a.boot === b.boot && a.processTree === b.processTree && a.backendPrincipal === b.backendPrincipal && a.backendPid === b.backendPid && a.backendStart === b.backendStart;
}
/** Amounts are externally qualified, never inferred from DTO size or defaulted. */
export function fitsPhysicalDomain(capacity: bigint, committed: bigint, occupied: readonly bigint[], debit: bigint): boolean {
  if (capacity < 0n || committed < 0n || debit < 0n || occupied.some(v => typeof v !== 'bigint' || v < 0n)) return unavailable();
  return committed + occupied.reduce((sum, v) => sum + v, 0n) + debit <= capacity;
}export function admission(value: unknown): Admission {
  const r = record(value, ['id','fence','subject','incarnation','qualification','expiresAt','state']);
  const { id, fence, subject: rawSubject, incarnation: rawIncarnation, qualification: rawQualification, expiresAt, state } = r;
  if (!identifier(id) || !positive(fence) || !finite(expiresAt) ||
      (state !== 'RESERVED' && state !== 'RUNNING' && state !== 'DRAINING' && state !== 'QUARANTINED' && state !== 'RELEASED')) return unavailable();
  return Object.freeze({ id, fence, subject: subject(rawSubject), incarnation: incarnation(rawIncarnation), qualification: qualification(rawQualification), expiresAt, state });
}
export function spoolRef(value: unknown): SpoolRef {
  const r = record(value, ['id','digest','envelope']); const { id, digest: hash, envelope } = r;
  if (!identifier(id) || !digest(hash) || !identifier(envelope)) return unavailable();
  return Object.freeze({id, digest:hash, envelope});
}

export function controlRequest(value: unknown): ControlRequest {
  const r = record(value, ['namespace','project','owner','route','operation','requestIdentity']);
  const {namespace,project,owner,route,operation,requestIdentity} = r;
  if (!identifier(namespace) || !identifier(project) || !identifier(owner) || !identifier(route) || !identifier(requestIdentity) ||
      (operation !== 'ENTA_SUCCESSOR' && operation !== 'PG_SETUP' && operation !== 'PG_START')) return unavailable();
  return Object.freeze({namespace,project,owner,route,operation,requestIdentity});
}
export function missReceipt(value: unknown): MissReceipt {
  const r=record(value,['id','replay','requestIdentity','spool','subject','incarnation']);
  const {id,replay,requestIdentity,spool,subject:rawSubject,incarnation:rawIncarnation}=r;
  if (!identifier(id) || !identifier(replay) || !identifier(requestIdentity)) return unavailable();
  return Object.freeze({id,replay,requestIdentity,spool:spoolRef(spool),subject:subject(rawSubject),incarnation:incarnation(rawIncarnation)});
}
function wireBigInt(value:unknown):bigint {
  if(typeof value!=='string' || !/^[1-9][0-9]*$/.test(value))return unavailable();
  const result=BigInt(value);if(result>9223372036854775807n)return unavailable();return result;
}
function wireTime(value:unknown):number {
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return unavailable();
  const result=Date.parse(value);if(!Number.isSafeInteger(result) || result<=0 || new Date(result).toISOString()!==value)return unavailable();return result;
}
/** Parse SQL JSON wires without lossy BIGINT conversion or retained input aliases. */
export function admissionWire(value:unknown):Admission {
  const r=record(value,['id','fence','subject','incarnation','qualification','expiresAt','state']);
  const {id,fence,subject:rawSubject,incarnation:rawIncarnation,qualification:rawQualification,expiresAt,state}=r;
  const q=record(rawQualification,['id','generation','evidenceHash','validUntil','reuse','domain','sourceClosure']);
  const {id:qid,generation,evidenceHash,validUntil,reuse,domain,sourceClosure}=q;
  return admission({id,fence:wireBigInt(fence),subject:rawSubject,incarnation:rawIncarnation,qualification:{id:qid,generation:wireBigInt(generation),evidenceHash,validUntil:wireTime(validUntil),reuse,domain,sourceClosure},expiresAt:wireTime(expiresAt),state});
}
export function cleanupWire(value:unknown):CleanupEvidence {
  const r=record(value,['admissionId','fence','incarnation','outcome','protocolDrained','ipcDrained','parentDrained','processTreeTerminated','backendAbsent','observerGeneration']);
  const {admissionId,fence,incarnation:rawIncarnation,outcome,protocolDrained,ipcDrained,parentDrained,processTreeTerminated,backendAbsent,observerGeneration}=r;
  if(!identifier(admissionId) || (outcome!=='COMMITTED' && outcome!=='ROLLED_BACK') || protocolDrained!==true || ipcDrained!==true || parentDrained!==true || processTreeTerminated!==true || backendAbsent!==true)return unavailable();
  return Object.freeze({admissionId,fence:wireBigInt(fence),incarnation:incarnation(rawIncarnation),outcome,protocolDrained,ipcDrained,parentDrained,processTreeTerminated,backendAbsent,observerGeneration:wireBigInt(observerGeneration)});
}
export function qualificationWire(value:unknown):Qualification {
 const q=record(value,['id','generation','evidenceHash','validUntil','reuse','domain','sourceClosure']);
 const {id,generation,evidenceHash,validUntil,reuse,domain,sourceClosure}=q;
 return qualification({id,generation:wireBigInt(generation),evidenceHash,validUntil:wireTime(validUntil),reuse,domain,sourceClosure});
}
/** Shape only: protected owning SQL supplies and authenticates these fields. */
const entaSubjectKeys=['engine','operation','protocol','mode','format','rules','predecessorId','predecessorVersion','baseReleaseId','receiptId','baseRoot','sealHash','policyVersion','formatPolicyVersion','formatReleaseId','formatRoot','mediaRoot','competitiveReleaseId','competitiveProofRoot','competitivePaletteRoot','profile','custody'] as const;
const pgSetupSubjectKeys=['engine','operation','protocol','namespace','owner','policyRevision','policyHash','parentMatchId','resultVersion','resultHash','requestedConfig','activeCatalog','profile','custody','matchPin'] as const;
const pgStartSubjectKeys=['engine','operation','protocol','namespace','owner','policyRevision','policyHash','roomId','roomGeneration','roomRevision','activeCatalog','profile','custody','matchPin'] as const;
const activeCatalogKeys=['catalogReleaseId','releaseRootHash','validationReceiptId','sealHash','huroofReleaseId','huroofRootSha256'] as const;
const pgProfileKeys=['scope','family','sourceId','revision','rawArtifactId','rawArtifactHash','pointerVersion'] as const;
const custodyKeys=['sourceId','revision','rawArtifactHash','pointerVersion'] as const;
const matchPinKeys=['matchId','profileFamily','profileSourceId','profileRevision','profileRawArtifactId','profileRawArtifactHash','catalogReleaseId','releaseRootHash','catalogSealHash'] as const;
export type NativeApplicability=Readonly<Record<string,unknown>>;
function closedStrings(input:unknown,keys:readonly string[],nullableKey?:string):Readonly<Record<string,string|null>> {
 const source=record(input,keys),out:Record<string,string|null>={};for(const key of keys){const v=source[key];if(key===nullableKey&&v===null){out[key]=null;continue;}if(!identifier(v)||v==='*')return unavailable();out[key]=v;}return Object.freeze(out);
}
function cloneJson(value:unknown,seen:Set<object>):unknown {
 if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return value;
 if(!value||typeof value!=='object'||seen.has(value))return unavailable();seen.add(value);
 try{if(Array.isArray(value))return Object.freeze(value.map(x=>cloneJson(x,seen)));const out:Record<string,unknown>={};for(const key of Object.keys(value)){if(key==='__proto__')return unavailable();out[key]=cloneJson((value as Record<string,unknown>)[key],seen);}return Object.freeze(out);}finally{seen.delete(value);}
}
export function nativeApplicability(value:unknown):NativeApplicability {
 if(!value||typeof value!=='object'||Array.isArray(value))return unavailable();const probe=value as Record<string,unknown>,engine=probe.engine,operation=probe.operation;
 if(engine==='ENTA'&&operation==='ENTA_SUCCESSOR'){
  const row=record(value,entaSubjectKeys),out:Record<string,unknown>={};for(const key of entaSubjectKeys)out[key]=key==='engine'?engine:key==='operation'?operation:row[key];const protocol=out.protocol;
  if(protocol!==2&&protocol!==3&&protocol!==4&&protocol!==5)return unavailable();
  for(const key of ['mode','format','rules','predecessorId','baseReleaseId','receiptId','baseRoot','sealHash','policyVersion'])if(!identifier(out[key])||out[key]==='*')return unavailable();
  if(out.profile!==null||out.custody!==null||(out.predecessorVersion!==null&&(!Number.isSafeInteger(out.predecessorVersion)||(out.predecessorVersion as number)<0)))return unavailable();
  for(const key of ['formatPolicyVersion','formatReleaseId','formatRoot','mediaRoot'])if(protocol<=3?out[key]!==null:!identifier(out[key])||out[key]==='*')return unavailable();
  for(const key of ['competitiveReleaseId','competitiveProofRoot','competitivePaletteRoot'])if(protocol!==5?out[key]!==null:!identifier(out[key])||out[key]==='*')return unavailable();return Object.freeze(out);
 }
 if(engine==='PG'&&(operation==='PG_SETUP'||operation==='PG_START')){
  const keys=operation==='PG_SETUP'?pgSetupSubjectKeys:pgStartSubjectKeys,row=record(value,keys),out:Record<string,unknown>={};for(const key of keys)out[key]=key==='engine'?engine:key==='operation'?operation:row[key];
  if(out.protocol!==null)return unavailable();for(const key of ['namespace','owner','policyRevision','policyHash',...(operation==='PG_SETUP'?['parentMatchId','resultVersion','resultHash']:['roomId','roomGeneration','roomRevision'])])if(!identifier(out[key])||out[key]==='*')return unavailable();
  if(operation==='PG_SETUP'){if(out.activeCatalog!==null||out.profile!==null||out.custody!==null||out.matchPin!==null||!out.requestedConfig||typeof out.requestedConfig!=='object'||Array.isArray(out.requestedConfig))return unavailable();out.requestedConfig=cloneJson(out.requestedConfig,new Set());}
  else {const pinned=out.matchPin!==null;if(pinned){if(out.activeCatalog!==null)return unavailable();out.matchPin=closedStrings(out.matchPin,matchPinKeys);out.profile=closedStrings(out.profile,pgProfileKeys,'pointerVersion');if((out.profile as Record<string,unknown>).pointerVersion!==null)return unavailable();}else{out.activeCatalog=closedStrings(out.activeCatalog,activeCatalogKeys);out.profile=closedStrings(out.profile,pgProfileKeys);}out.custody=closedStrings(out.custody,custodyKeys);}
  return Object.freeze(out);
 }
 return unavailable();
}
function sameJson(a:unknown,b:unknown):boolean {
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>sameJson(v,b[i]));
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(k=>Object.hasOwn(right,k)&&sameJson(left[k],right[k]));
}
export function assertSameNativeApplicability(expected:unknown,actual:unknown):NativeApplicability {
 const a=nativeApplicability(expected),b=nativeApplicability(actual);if(!sameJson(a,b))return unavailable();return b;
}

/** Cryptographic data check only. A successful result does not authenticate
 * an OS installation, select a key, fund an input, or authorize a receiver.
 * The trusted loader must independently obtain the key and limit first. */
export function verifyInstallerPermitBytes(raw: Uint8Array, rawPublicKey: Uint8Array, rawSignature: Uint8Array, qualifiedMaximum: bigint): Buffer {
  try {
    if (!(raw instanceof Uint8Array) || !(rawPublicKey instanceof Uint8Array) || !(rawSignature instanceof Uint8Array) ||
        rawPublicKey.byteLength !== 32 || rawSignature.byteLength !== 64 ||
        typeof qualifiedMaximum !== 'bigint' || qualifiedMaximum <= 0n ||
        qualifiedMaximum > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(raw.byteLength) > qualifiedMaximum) return unavailable();
    // Copies prevent a changing/shared caller buffer from replacing bytes between
    // verification and the fixed receiver's subsequent closed decoding.
    const captured = Buffer.from(raw);
    const key = Buffer.from(rawPublicKey);
    const signature = Buffer.from(rawSignature);
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]);
    const publicKey = createPublicKey({key: spki, format:'der', type:'spki'});
    if (!verify(null, captured, publicKey, signature)) return unavailable();
    const prefix = Buffer.from('pro273.installer.launch-permit.v1\n', 'utf8');
    if (captured.byteLength <= prefix.byteLength || !captured.subarray(0, prefix.byteLength).equals(prefix)) return unavailable();
    return captured;
  } catch { return unavailable(); }
}

// Correlation and syntax only: a frame does not authenticate a process, a
// holder, a fence, a receipt or a SQL commit. The real inherited transport and
// independent process/handle checks are not implemented.
export function checkInstallerChannelFrame(raw: Uint8Array, expected: Readonly<{
  stage: 'HELLO'|'PERMIT_VERIFIED'|'PSQL_LAUNCH_READY'|'PSQL_STARTED'|'DISPATCH_CHECK'|'DISPATCH_CURRENT';
  nonce: string; serviceStartId: string; nodeLaunchId: string; psqlAttemptId: string;
  servicePid: string; serviceCreationTime: string; nodePid: string; nodeCreationTime: string;
  bootIdentity: string; qualificationHash: string;
}>, expectedPayload: Readonly<Record<string,string>>, qualifiedMaximum: bigint): void {
  try {
    const stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','DISPATCH_CHECK','DISPATCH_CURRENT'] as const;
    const index = stages.indexOf(expected.stage);
    if (index < 0 || !(raw instanceof Uint8Array) || typeof qualifiedMaximum !== 'bigint' || qualifiedMaximum <= 0n) return unavailable();
    // The intrinsic getter rejects proxies and ignores subclass accessors.
    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(raw) as number;
    if (length > 4100 || length < 5 || BigInt(length - 4) > qualifiedMaximum) return unavailable();
    const bytes = Buffer.alloc(length);
    for (let i = 0; i < length; i++) bytes[i] = raw[i];
    if (bytes.readUInt32LE(0) !== bytes.length - 4 || bytes.length - 4 > 4096) return unavailable();
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes.subarray(4));
    const value = strictJSON(text, 4096);
    const canonical = (v: unknown): string => {
      if (v === null || typeof v !== 'object') return JSON.stringify(v);
      if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
      const row = v as Record<string,unknown>;
      return `{${Object.keys(row).sort().map(k => `${JSON.stringify(k)}:${canonical(row[k])}`).join(',')}}`;
    };
    if (!Buffer.from(canonical(value), 'utf8').equals(bytes.subarray(4))) return unavailable();
    const keys = ['schemaVersion','stage','sequence','nonce','serviceStartId','nodeLaunchId','psqlAttemptId','servicePid','serviceCreationTime','nodePid','nodeCreationTime','bootIdentity','qualificationHash','payload'];
    const frame = record(value, keys);
    if (frame.schemaVersion !== 'pro273-installer-channel-v1' || frame.stage !== expected.stage || frame.sequence !== String(index + 1)) return unavailable();
    const ids = ['serviceStartId','nodeLaunchId','psqlAttemptId'] as const;
    for (const key of ids) if (!/^[A-Za-z0-9_-]{1,120}$/.test(expected[key]) || frame[key] !== expected[key]) return unavailable();
    if (new Set(ids.map(k => expected[k])).size !== 3 || !/^[a-f0-9]{64}$/.test(expected.nonce) ||
        !/^[a-f0-9]{32}$/.test(expected.bootIdentity) || !digest(expected.qualificationHash)) return unavailable();
    for (const key of ['nonce','bootIdentity','qualificationHash'] as const) if (frame[key] !== expected[key]) return unavailable();
    for (const key of ['servicePid','nodePid','serviceCreationTime','nodeCreationTime'] as const) {
      const n = expected[key];
      if (!/^[1-9][0-9]{0,19}$/.test(n) || BigInt(n) > (key.endsWith('Pid') ? 4294967295n : 18446744073709551615n) || frame[key] !== n) return unavailable();
    }
    const payloadKeys: readonly string[][] = [[],['permitHash'],['permitHash','psqlFenceId'],['psqlPid','psqlCreationTime'],['deliveryReceiptHash','inputHash','inputLength'],['deliveryReceiptHash','inputHash','inputLength']];
    const payload = record(frame.payload, payloadKeys[index]);
    if (Object.keys(expectedPayload).length !== payloadKeys[index].length) return unavailable();
    for (const key of payloadKeys[index]) {
      const v = expectedPayload[key];
      if (typeof v !== 'string' || payload[key] !== v ||
          (key.endsWith('Hash') ? !digest(v) : key === 'psqlFenceId' ? !/^[A-Za-z0-9_-]{1,120}$/.test(v) :
            !/^[1-9][0-9]{0,19}$/.test(v) || BigInt(v) > (key === 'psqlPid' ? 4294967295n : 18446744073709551615n))) return unavailable();
    }
  } catch { return unavailable(); }
}

/** Correlation state only. The caller must still authenticate retained process
 * handles and the private inherited pipes. Any malformed or unexpected frame
 * permanently consumes this local conversation; it cannot be retried. */
export function installerChannelConversation(binding: Readonly<{
  nonce: string; serviceStartId: string; nodeLaunchId: string; psqlAttemptId: string;
  servicePid: string; serviceCreationTime: string; nodePid: string; nodeCreationTime: string;
  bootIdentity: string; qualificationHash: string;
}>, qualifiedMaximum: bigint) {
  const captured = Object.freeze({...binding});
  const stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','DISPATCH_CHECK','DISPATCH_CURRENT'] as const;
  const payloadKeys: readonly (readonly string[])[] = [[],['permitHash'],['permitHash','psqlFenceId'],['psqlPid','psqlCreationTime'],['deliveryReceiptHash','inputHash','inputLength'],['deliveryReceiptHash','inputHash','inputLength']];
  let next = 0, spent = false, active = false;
  let permitHash: string | undefined, dispatch: Readonly<Record<string,string>> | undefined;
  return Object.freeze({
    accept(raw: Uint8Array, stage: typeof stages[number], payload: Readonly<Record<string,string>>): void {
      if (spent || active) { spent = true; return unavailable(); }
      active = true;
      try {
        if (next >= stages.length || stage !== stages[next]) return unavailable();
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unavailable();
        const keys = payloadKeys[next], found = Reflect.ownKeys(payload);
        if (found.length !== keys.length || found.some(key => typeof key !== 'string' || !keys.includes(key))) return unavailable();
        const copy: Record<string,string> = {};
        for (const key of keys) { const value = payload[key]; if (typeof value !== 'string') return unavailable(); copy[key] = value; }
        const snapshot = Object.freeze(copy);
        checkInstallerChannelFrame(raw, {...captured, stage}, snapshot, qualifiedMaximum);
        if (stage === 'PERMIT_VERIFIED') permitHash = snapshot.permitHash;
        if (stage === 'PSQL_LAUNCH_READY' && snapshot.permitHash !== permitHash) return unavailable();
        if (stage === 'DISPATCH_CHECK') dispatch = snapshot;
        if (stage === 'DISPATCH_CURRENT' && (!dispatch || !sameJson(dispatch, snapshot))) return unavailable();
        if (spent) return unavailable();
        next++;
        if (next === stages.length) spent = true;
      } catch { spent = true; return unavailable(); } finally { active = false; }
    },
  });
}

type InstallerChannelBinding = Readonly<{
  nonce: string; serviceStartId: string; nodeLaunchId: string; psqlAttemptId: string;
  servicePid: string; serviceCreationTime: string; nodePid: string; nodeCreationTime: string;
  bootIdentity: string; qualificationHash: string;
}>;
type InstallerChannelStage = 'HELLO'|'PERMIT_VERIFIED'|'PSQL_LAUNCH_READY'|'PSQL_STARTED'|'DISPATCH_CHECK'|'DISPATCH_CURRENT';

// V2 is a disconnected model, not an authenticated transport or SQL receipt ABI.
// Its qualification is an input ceiling, never proof of funding or authority.
const v2Stages = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','PSQL_AUTHENTICATED','DISPATCH_CHECK','DISPATCH_CURRENT','OUTCOME'] as const;
type V2Stage = typeof v2Stages[number];
type V2Limits = Readonly<{maxFrames: bigint; maxEnvelopeBytes: bigint; maxReceiptBytes: bigint}>;
export type InstallerChannelV2Snapshot = Readonly<{psqlPid:string; psqlCreationTime:string; psqlImageHash:string; nodePid:string; nodeCreationTime:string; bootIdentity:string; qualificationHash:string; nonce:string}>;
export type InstallerChannelV2Frame = InstallerChannelBinding & Readonly<{schemaVersion:'pro273-installer-channel-v2'}> & (
  | {stage:'HELLO'; sequence:'1'; payload:Readonly<Record<string,never>>}
  | {stage:'PERMIT_VERIFIED'; sequence:'2'; payload:Readonly<{permitHash:string}>}
  | {stage:'PSQL_LAUNCH_READY'; sequence:'3'; payload:Readonly<{permitHash:string; psqlFenceId:string}>}
  | {stage:'PSQL_STARTED'; sequence:'4'; payload:Readonly<{psqlPid:string}>}
  | {stage:'PSQL_AUTHENTICATED'; sequence:'5'; payload:Readonly<{snapshot:InstallerChannelV2Snapshot; snapshotHash:string}>}
  | {stage:'DISPATCH_CHECK'; sequence:'6'; payload:Readonly<{deliveryReceiptBase64:string; deliveryReceiptHash:string; inputHash:string; inputLength:string}>}
  | {stage:'DISPATCH_CURRENT'; sequence:'7'; payload:Readonly<{snapshotHash:string; deliveryReceiptHash:string; inputHash:string; inputLength:string}>}
  | {stage:'OUTCOME'; sequence:'8'; payload:Readonly<{status:'UNKNOWN'; receiptFrameBase64:null; receiptFrameHash:null} | {status:'COMMITTED'; receiptFrameBase64:string; receiptFrameHash:string}>}
);
const v2BindingKeys = ['nonce','serviceStartId','nodeLaunchId','psqlAttemptId','servicePid','serviceCreationTime','nodePid','nodeCreationTime','bootIdentity','qualificationHash'] as const;
const v2SnapshotKeys = ['psqlPid','psqlCreationTime','psqlImageHash','nodePid','nodeCreationTime','bootIdentity','qualificationHash','nonce'] as const;
const v2PayloadKeys: readonly (readonly string[])[] = [[],['permitHash'],['permitHash','psqlFenceId'],['psqlPid'],['snapshot','snapshotHash'],['deliveryReceiptBase64','deliveryReceiptHash','inputHash','inputLength'],['snapshotHash','deliveryReceiptHash','inputHash','inputLength'],['status','receiptFrameBase64','receiptFrameHash']];
const v2Keys = ['schemaVersion','stage','sequence',...v2BindingKeys,'payload'] as const;

function v2Limits(value: V2Limits): V2Limits {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return unavailable();
  const keys = ['maxFrames','maxEnvelopeBytes','maxReceiptBytes'] as const;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k as typeof keys[number]))) return unavailable();
  const descriptors = keys.map(k => Object.getOwnPropertyDescriptor(value, k));
  if (descriptors.some(d => !d || !('value' in d) || !d.enumerable)) return unavailable();
  const [maxFrames,maxEnvelopeBytes,maxReceiptBytes] = descriptors.map(d => d!.value);
  if (typeof maxFrames !== 'bigint' || maxFrames < 8n ||
      typeof maxEnvelopeBytes !== 'bigint' || maxEnvelopeBytes < 5n ||
      typeof maxReceiptBytes !== 'bigint' || maxReceiptBytes < 1n || maxReceiptBytes > 3072n) return unavailable();
  return Object.freeze({maxFrames,maxEnvelopeBytes: maxEnvelopeBytes > 4096n ? 4096n : maxEnvelopeBytes,maxReceiptBytes});
}
function v2Record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return unavailable();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(k => typeof k !== 'string' || !keys.includes(k))) return unavailable();
  const result: Record<string,unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d) || !d.enumerable) return unavailable();
    result[key] = d.value;
  }
  return result;
}
function v2Canonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  const r = value as Record<string,unknown>;
  return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${v2Canonical(r[k])}`).join(',')}}`;
}
// Count canonical UTF-8 bytes without constructing canonical strings or buffers.
function v2CanonicalSize(value: unknown, ceiling: number): number {
  const add = (a: number, b: number): number => {
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || b > ceiling - a) return unavailable();
    return a + b;
  };
  if (value === null) return 4;
  if (typeof value === 'string') {
    let size = 2;
    for (const c of value) {
      const n = c.codePointAt(0)!;
      size = add(size, n === 34 || n === 92 || n === 8 || n === 9 || n === 10 || n === 12 || n === 13 ? 2 : n < 32 || (n >= 0xd800 && n <= 0xdfff) ? 6 : n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4);
    }
    return size;
  }
  const row = value as Record<string,unknown>, keys = Object.keys(row);
  let size = 2;
  for (const key of keys) {
    size = add(size, v2CanonicalSize(key, ceiling));
    size = add(size, 1);
    size = add(size, v2CanonicalSize(row[key], ceiling));
  }
  return add(size, Math.max(0, keys.length - 1));
}
function v2Uint(value: unknown, pid = false): void {
  const n = startupUint(value);
  if (pid && n > 4294967295n) return unavailable();
}
function v2Receipt(encoded: unknown, hash: unknown, limits: V2Limits, verifyBytes: boolean): void {
  if (typeof encoded !== 'string' || !digest(hash) || encoded.length === 0 ||
      encoded.length > 4 * Math.ceil(Number(limits.maxReceiptBytes) / 3) || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return unavailable();
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const decodedLength = encoded.length / 4 * 3 - padding;
  if (decodedLength < 1 || decodedLength > Number(limits.maxReceiptBytes)) return unavailable();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if ((padding === 2 && (alphabet.indexOf(encoded[encoded.length - 3]) & 15) !== 0) ||
      (padding === 1 && (alphabet.indexOf(encoded[encoded.length - 2]) & 3) !== 0)) return unavailable();
  if (!verifyBytes) return;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== decodedLength || bytes.toString('base64') !== encoded || createHash('sha256').update(bytes).digest('hex') !== hash) return unavailable();
}
function v2Frame(value: unknown, limits: V2Limits, verifyBytes = true): Record<string,unknown> {
  const f = v2Record(value, v2Keys), index = v2Stages.indexOf(f.stage as V2Stage);
  if (f.schemaVersion !== 'pro273-installer-channel-v2' || index < 0 || f.sequence !== String(index + 1)) return unavailable();
  for (const k of ['serviceStartId','nodeLaunchId','psqlAttemptId']) if (!startupId(f[k])) return unavailable();
  if (new Set([f.serviceStartId,f.nodeLaunchId,f.psqlAttemptId]).size !== 3 || !digest(f.nonce) || !digest(f.qualificationHash) || typeof f.bootIdentity !== 'string' || !/^[a-f0-9]{32}$/.test(f.bootIdentity)) return unavailable();
  for (const k of ['servicePid','nodePid','serviceCreationTime','nodeCreationTime']) v2Uint(f[k], k.endsWith('Pid'));
  const p = v2Record(f.payload, v2PayloadKeys[index]);
  for (const k of ['permitHash','snapshotHash','deliveryReceiptHash','inputHash']) if (k in p && !digest(p[k])) return unavailable();
  if ('psqlFenceId' in p && !startupId(p.psqlFenceId)) return unavailable();
  if ('psqlPid' in p) v2Uint(p.psqlPid, true);
  if ('inputLength' in p) v2Uint(p.inputLength);
  if ('snapshot' in p) {
    const s = v2Record(p.snapshot, v2SnapshotKeys);
    v2Uint(s.psqlPid, true); v2Uint(s.psqlCreationTime); v2Uint(s.nodePid, true); v2Uint(s.nodeCreationTime);
    if (!digest(s.psqlImageHash) || s.nodePid !== f.nodePid || s.nodeCreationTime !== f.nodeCreationTime || s.bootIdentity !== f.bootIdentity || s.qualificationHash !== f.qualificationHash || s.nonce !== f.nonce) return unavailable();
    p.snapshot = Object.freeze(s);
  }
  if ('deliveryReceiptBase64' in p) v2Receipt(p.deliveryReceiptBase64, p.deliveryReceiptHash, limits, false);
  if (index === 7) {
    if (p.status === 'UNKNOWN') { if (p.receiptFrameBase64 !== null || p.receiptFrameHash !== null) return unavailable(); }
    else if (p.status === 'COMMITTED') v2Receipt(p.receiptFrameBase64, p.receiptFrameHash, limits, false);
    else return unavailable();
  }
  f.payload = Object.freeze(p);
  if (v2CanonicalSize(f, Number(limits.maxEnvelopeBytes) - 4) > Number(limits.maxEnvelopeBytes) - 4) return unavailable();
  if (verifyBytes && 'snapshot' in p) {
    const hash = createHash('sha256').update('["pro273.installer.psql-snapshot.v2",' + v2Canonical(p.snapshot) + ']').digest('hex');
    if (p.snapshotHash !== hash) return unavailable();
  }
  if (verifyBytes && 'deliveryReceiptBase64' in p) v2Receipt(p.deliveryReceiptBase64, p.deliveryReceiptHash, limits, true);
  if (verifyBytes && index === 7 && p.status === 'COMMITTED') v2Receipt(p.receiptFrameBase64, p.receiptFrameHash, limits, true);
  return Object.freeze(f);
}

/** Exact v2 data codec. Receipt hashes correlate bytes; they do not authenticate SQL. */
export function encodeInstallerChannelV2(value: unknown, limits: V2Limits): Buffer {
  try {
    const captured = v2Limits(limits), max = Number(captured.maxEnvelopeBytes), frame = v2Frame(value, captured, false);
    // Every accepted leaf is ASCII and bounded before serialization or Buffer allocation.
    const body = v2Canonical(frame);
    if (body.length + 4 > max) return unavailable();
    v2Frame(frame, captured);
    const wire = Buffer.alloc(body.length + 4); wire.writeUInt32LE(body.length); wire.write(body, 4, 'utf8'); return wire;
  } catch { return unavailable(); }
}
export function decodeInstallerChannelV2(raw: Uint8Array, limits: V2Limits): Readonly<Record<string,unknown>> {
  try {
    const captured = v2Limits(limits), max = Number(captured.maxEnvelopeBytes);
    const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(raw) as number;
    if (length < 5 || length > max) return unavailable();
    const bodyLength = raw[0] + raw[1] * 256 + raw[2] * 65536 + raw[3] * 16777216;
    if (bodyLength !== length - 4) return unavailable();
    const bytes = Buffer.alloc(length - 4); for (let i = 4; i < length; i++) bytes[i - 4] = raw[i];
    const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes), frame = v2Frame(strictJSON(text, max - 4), captured);
    if (v2Canonical(frame) !== text) return unavailable();
    return frame;
  } catch { return unavailable(); }
}

/** One-use correlation model. Neither modeled SQL nor COMMITTED is runtime authority. */
export function installerChannelV2Conversation(binding: InstallerChannelBinding, limits: V2Limits) {
  const capturedLimits = v2Limits(limits);
  const b = v2Record(binding, v2BindingKeys);
  // Validate and capture binding through an inert HELLO before accepting any input.
  const hello = v2Frame({schemaVersion:'pro273-installer-channel-v2',stage:'HELLO',sequence:'1',...b,payload:{}}, capturedLimits);
  let next = 0, active = false, terminal = false, sql = false, halfClosed = false;
  let permit: unknown, pid: unknown, snapshotHash: unknown, dispatch: Record<string,unknown> | undefined, outcome: unknown;
  const run = <T>(fn: () => T): T => {
    if (terminal || active) { terminal = true; return unavailable(); }
    active = true;
    try { const result = fn(); if (terminal) return unavailable(); return result; }
    catch { terminal = true; return unavailable(); } finally { active = false; }
  };
  return Object.freeze({
    accept(raw: Uint8Array, sender: 'SERVICE'|'NODE'): void { run(() => {
      if (next >= 8 || sender !== (next % 2 === 0 ? 'SERVICE' : 'NODE') || (next === 5 && !sql) || (next === 7 && !halfClosed)) return unavailable();
      const f = decodeInstallerChannelV2(raw, capturedLimits), p = f.payload as Record<string,unknown>;
      if (f.stage !== v2Stages[next] || v2BindingKeys.some(k => f[k] !== hello[k])) return unavailable();
      if (next === 1) permit = p.permitHash;
      if (next === 2 && p.permitHash !== permit) return unavailable();
      if (next === 3) pid = p.psqlPid;
      if (next === 4) { if ((p.snapshot as Record<string,unknown>).psqlPid !== pid) return unavailable(); snapshotHash = p.snapshotHash; }
      if (next === 5) dispatch = {deliveryReceiptHash:p.deliveryReceiptHash,inputHash:p.inputHash,inputLength:p.inputLength};
      if (next === 6 && (!dispatch || p.snapshotHash !== snapshotHash || Object.keys(dispatch).some(k => p[k] !== dispatch![k]))) return unavailable();
      if (next === 7) outcome = p.status;
      next++;
    }); },
    modeledSqlWork(): void { run(() => { if (next !== 5 || sql) return unavailable(); sql = true; }); },
    serviceHalfClose(): 'AWAITING_OUTCOME'|'UNKNOWN' {
      const result = run(() => { if (next !== 7 || halfClosed) return 'UNKNOWN' as const; halfClosed = true; return 'AWAITING_OUTCOME' as const; });
      if (result === 'UNKNOWN') terminal = true;
      return result;
    },
    // Even a syntactically COMMITTED frame is only a claim until an independently
    // authenticated publication receipt and its exact byte ABI exist.
    nodeEof(): 'UNVERIFIED_COMMITTED'|'UNKNOWN' { const result = run(() => next === 8 && halfClosed && outcome === 'COMMITTED' ? 'UNVERIFIED_COMMITTED' as const : 'UNKNOWN' as const); terminal = true; return result; },
    abort(): 'UNKNOWN' { if (terminal || active) { terminal = true; return unavailable(); } terminal = true; return 'UNKNOWN'; },
  });
}

const v2AdapterAlloc = Buffer.alloc.bind(Buffer);
// Inert byte pump: each accepted frame must be offered and acknowledged before
// another frame may be consumed. All limits are ceilings, not reservations.
export function installerChannelV2ByteAdapter(binding: InstallerChannelBinding, limits: V2Limits,
  maxOperations: number, maxZeroProgress: number) {
  const captured = v2Limits(limits), conversation = installerChannelV2Conversation(binding, captured);
  if (!Number.isSafeInteger(maxOperations) || maxOperations < 1 || !Number.isSafeInteger(maxZeroProgress) || maxZeroProgress < 0) return unavailable();
  const max = Number(captured.maxEnvelopeBytes), owned = v2AdapterAlloc(max);
  const typed = Object.getPrototypeOf(Uint8Array.prototype);
  const lengthGet = Object.getOwnPropertyDescriptor(typed, 'byteLength')!.get!;
  const offsetGet = Object.getOwnPropertyDescriptor(typed, 'byteOffset')!.get!;
  const bufferGet = Object.getOwnPropertyDescriptor(typed, 'buffer')!.get!;
  const bufferLengthGet = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
  const resizableGet = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'resizable')?.get;
  let used = 0, target = 0, next = 0, written = 0, offered = 0, ticket = 0, zero = 0, operations = 0;
  let phase: 'input'|'write'|'sql'|'service-eof'|'node-eof'|'complete'|'failed' = 'input', active = false;
  const run = <T>(fn: () => T): T => {
    if (active || phase === 'failed' || phase === 'complete' || operations >= maxOperations) { phase = 'failed'; return unavailable(); }
    operations++; active = true;
    try { const result = fn(); if ((phase as string) === 'failed') return unavailable(); return result; }
    catch { phase = 'failed'; return unavailable(); } finally { active = false; }
  };
  const sender = () => next % 2 === 0 ? 'SERVICE' : 'NODE';
  return Object.freeze({
    feed(input: Uint8Array, direction: 'SERVICE'|'NODE'): number { return run(() => {
      if (phase !== 'input' || direction !== sender() || types.isProxy(input) || !types.isUint8Array(input)) return unavailable();
      const length = lengthGet.call(input) as number, offset = offsetGet.call(input) as number, buffer = bufferGet.call(input) as ArrayBuffer;
      if (types.isSharedArrayBuffer(buffer) || (resizableGet && resizableGet.call(buffer))) return unavailable();
      const extent = bufferLengthGet.call(buffer) as number;
      if (offset > extent || length > extent - offset) return unavailable();
      let consumed = 0;
      while (consumed < length && (!target || used < target)) {
        owned[used++] = input[consumed++];
        if (used === 4) {
          const body = owned[0] + owned[1] * 256 + owned[2] * 65536 + owned[3] * 16777216;
          if (body < 1 || body > max - 4) return unavailable();
          target = body + 4;
        }
      }
      if (target && used === target) {
        if (next >= 6 && consumed < length) return unavailable();
        const frame = v2AdapterAlloc(target);
        for (let i = 0; i < target; i++) frame[i] = owned[i];
        conversation.accept(frame, direction);
        if ((phase as string) === 'failed') return unavailable();
        phase = 'write'; written = 0; offered = 0;
      }
      return consumed;
    }); },
    offer(direction: 'SERVICE'|'NODE', maximum: number): Readonly<{ticket:number; bytes:Buffer}> { return run(() => {
      if (phase !== 'write' || direction !== sender() || offered || !Number.isSafeInteger(maximum) || maximum < 1) return unavailable();
      offered = Math.min(maximum, target - written);
      const copy = v2AdapterAlloc(offered);
      for (let i = 0; i < offered; i++) copy[i] = owned[written + i];
      return Object.freeze({ticket:++ticket,bytes:copy});
    }); },
    ack(direction: 'SERVICE'|'NODE', acknowledgedTicket: number, count: number): void { run(() => {
      if (phase !== 'write' || direction !== sender() || !offered || acknowledgedTicket !== ticket || !Number.isSafeInteger(count) || count < 0 || count > offered) return unavailable();
      offered = 0;
      if (!count && ++zero > maxZeroProgress) return unavailable();
      written += count;
      if (written === target) {
        next++; used = target = written = 0;
        phase = next === 5 ? 'sql' : next === 7 ? 'service-eof' : next === 8 ? 'node-eof' : 'input';
      }
    }); },
    modeledSqlWork(): void { run(() => { if (phase !== 'sql') return unavailable(); conversation.modeledSqlWork(); if ((phase as string) === 'failed') return unavailable(); phase = 'input'; }); },
    eof(direction: 'SERVICE'|'NODE', clean: boolean): 'AWAITING_OUTCOME'|'UNVERIFIED_COMMITTED'|'UNKNOWN' { return run(() => {
      if (clean !== true || used || offered) return unavailable();
      if (phase === 'service-eof' && direction === 'SERVICE') { const value = conversation.serviceHalfClose(); if ((phase as string) === 'failed' || value !== 'AWAITING_OUTCOME') return unavailable(); phase = 'input'; return value; }
      if (phase === 'node-eof' && direction === 'NODE') { const value = conversation.nodeEof(); if ((phase as string) === 'failed') return unavailable(); phase = 'complete'; return value; }
      return unavailable();
    }); },
  });
}

/** Canonical framing only; no process, transport or funding authentication. */
export function encodeInstallerChannelFrame(binding: InstallerChannelBinding, stage: InstallerChannelStage,
  payload: Readonly<Record<string,string>>, qualifiedMaximum: bigint): Buffer {
  try {
    const stages: readonly InstallerChannelStage[] = ['HELLO','PERMIT_VERIFIED','PSQL_LAUNCH_READY','PSQL_STARTED','DISPATCH_CHECK','DISPATCH_CURRENT'];
    const index = stages.indexOf(stage);
    if (index < 0 || typeof qualifiedMaximum !== 'bigint' || qualifiedMaximum <= 0n) return unavailable();
    const bindingKeys = ['nonce','serviceStartId','nodeLaunchId','psqlAttemptId','servicePid','serviceCreationTime','nodePid','nodeCreationTime','bootIdentity','qualificationHash'];
    const payloadKeys: readonly string[][] = [[],['permitHash'],['permitHash','psqlFenceId'],['psqlPid','psqlCreationTime'],['deliveryReceiptHash','inputHash','inputLength'],['deliveryReceiptHash','inputHash','inputLength']];
    const b = record(binding, bindingKeys), p = record(payload, payloadKeys[index]);
    const copiedBinding: Record<string,string> = {}, copiedPayload: Record<string,string> = {};
    for (const [row, keys, copy] of [[b,bindingKeys,copiedBinding],[p,payloadKeys[index],copiedPayload]] as const)
      for (const key of keys) { const value = row[key]; if (typeof value !== 'string' || value.length > 120) return unavailable(); copy[key] = value; }
    const ids = ['serviceStartId','nodeLaunchId','psqlAttemptId'];
    if (ids.some(k => !startupId(copiedBinding[k])) || new Set(ids.map(k => copiedBinding[k])).size !== 3 ||
        !digest(copiedBinding.nonce) || !/^[a-f0-9]{32}$/.test(copiedBinding.bootIdentity) || !digest(copiedBinding.qualificationHash)) return unavailable();
    const validNumber = (v: string, pid: boolean): boolean => /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= (pid ? 4294967295n : 18446744073709551615n);
    for (const key of ['servicePid','nodePid','serviceCreationTime','nodeCreationTime'])
      if (!validNumber(copiedBinding[key], key.endsWith('Pid'))) return unavailable();
    for (const key of payloadKeys[index]) {
      const value = copiedPayload[key];
      if (key.endsWith('Hash') ? !digest(value) : key === 'psqlFenceId' ? !startupId(value) : !validNumber(value, key === 'psqlPid')) return unavailable();
    }
    const frame = {schemaVersion:'pro273-installer-channel-v1', ...copiedBinding, stage, sequence:String(index + 1), payload:copiedPayload};
    // Count escaped UTF-8 bytes before constructing the canonical string or Buffer.
    // The four-byte prefix is separate from the qualified body limit.
    const maximum = Number(qualifiedMaximum < 4096n ? qualifiedMaximum : 4096n);
    let size = 0;
    const add = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || size > maximum - n) return unavailable(); size += n; };
    const stringSize = (value: string) => {
      add(2);
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) add(2);
        else if (c < 32 || (c >= 0xd800 && c <= 0xdfff && !(c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff))) add(6);
        else if (c >= 0xd800 && c <= 0xdbff) { add(4); i++; }
        else add(c < 0x80 ? 1 : c < 0x800 ? 2 : 3);
      }
    };
    const objectSize = (row: Record<string, unknown>) => {
      add(2);
      const keys = Object.keys(row);
      keys.forEach((key, i) => { if (i) add(1); stringSize(key); add(1); const value = row[key]; if (typeof value === 'string') stringSize(value); else objectSize(value as Record<string, unknown>); });
    };
    objectSize(frame);
    const body = Buffer.from(startupCanonical(frame), 'utf8');
    if (body.length !== size) return unavailable();
    const wire = Buffer.alloc(4 + body.length);
    wire.writeUInt32LE(body.length); body.copy(wire, 4);
    checkInstallerChannelFrame(wire, {...copiedBinding, stage} as InstallerChannelBinding & {stage:InstallerChannelStage}, copiedPayload, qualifiedMaximum);
    return wire;
  } catch { return unavailable(); }
}

/** Disconnected correlation state. Inputs must eventually come from authenticated
 * retained handles, signed permit and the same connected SQL session; this
 * helper does not establish any of those facts or authorize effects. Failure,
 * re-entry and completion permanently spend the local state. */
export function installerChannelSnapshots(rawQualification: Uint8Array, binding: InstallerChannelBinding,
  startupFunding: unknown, prelaunchReceipt: unknown, dispatchAttemptId: string, qualifiedMaximum: bigint) {
  if (!(rawQualification instanceof Uint8Array)) return unavailable();
  const size = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(rawQualification) as number;
  if (size < 1 || size > 65536) return unavailable();
  const raw = Buffer.alloc(size);
  for (let i = 0; i < size; i++) raw[i] = rawQualification[i];
  const q = decodeStartupQualification(raw);
  const limits = record(q.limits, startupLimitKeys);
  if (typeof qualifiedMaximum !== 'bigint' || qualifiedMaximum <= 0n || qualifiedMaximum > startupUint(limits.maxChannelFrameBytes)) return unavailable();
  const holder = record(q.holder, ['reservationId','reservationRecordHash','prepaymentReceiptHash','physicalIdentity','physicalProofIdentity','partitionId','partitionKind','sourceClosureHash','installationClosureHash','validFrom','validUntil','vector']);
  const attempt = record(q.psqlAttempt, startupAttemptKeys);
  const service = record(q.serviceStart, startupAttemptKeys), node = record(q.nodeLaunch, startupAttemptKeys);
  const funding = record(startupFunding, ['qualificationId','qualificationHash','reservationId','reservationRecordHash','prepaymentReceiptHash','serviceStartId','nodeLaunchId','psqlAttemptId']);
  const receipt = record(prelaunchReceipt, ['attemptId','eventId','chargeKind','chargeEventKey','chargeBindingHash','prepaymentReceiptHash','fenceId']);
  const hash = createHash('sha256').update(raw).digest('hex');
  const expectedFunding = {qualificationId:q.qualificationId, qualificationHash:hash, reservationId:holder.reservationId,
    reservationRecordHash:holder.reservationRecordHash, prepaymentReceiptHash:holder.prepaymentReceiptHash,
    serviceStartId:service.id, nodeLaunchId:node.id, psqlAttemptId:attempt.id};
  const expectedReceipt = {attemptId:attempt.id, eventId:attempt.eventId, chargeKind:attempt.chargeKind,
    chargeEventKey:attempt.chargeEventKey, chargeBindingHash:attempt.chargeBindingHash,
    prepaymentReceiptHash:attempt.prepaymentReceiptHash, fenceId:attempt.fenceId};
  const bindingKeys = ['nonce','serviceStartId','nodeLaunchId','psqlAttemptId','servicePid','serviceCreationTime','nodePid','nodeCreationTime','bootIdentity','qualificationHash'] as const;
  const bindingRecord = record(binding, bindingKeys), copy: Record<string,string> = {};
  for (const key of bindingKeys) { const value = bindingRecord[key]; if (typeof value !== 'string' || value.length > 120) return unavailable(); copy[key] = value; }
  const captured = Object.freeze(copy) as InstallerChannelBinding;
  if (!sameJson(funding, expectedFunding) || !sameJson(receipt, expectedReceipt) || dispatchAttemptId !== attempt.id || captured.qualificationHash !== hash ||
      captured.bootIdentity !== q.bootIdentity || captured.serviceStartId !== service.id || captured.nodeLaunchId !== node.id || captured.psqlAttemptId !== attempt.id) return unavailable();
  const fence = attempt.fenceId as string;
  // Validate the binding before admitting any stage.
  encodeInstallerChannelFrame(captured, 'HELLO', {}, qualifiedMaximum);
  let next = 0, spent = false, active = false;
  let permitHash = '', dispatch: Readonly<Record<string,string>> | undefined;
  function step<T>(index: number, run: () => T): T {
    if (spent || active || next !== index) { spent = true; return unavailable(); }
    active = true;
    try {
      const result = run();
      if (spent) return unavailable();
      next++; if (next === 6) spent = true;
      return result;
    } catch { spent = true; return unavailable(); } finally { active = false; }
  }
  return Object.freeze({
    hello(rawFrame: Uint8Array): void { step(0, () => checkInstallerChannelFrame(rawFrame, {...captured, stage:'HELLO'}, {}, qualifiedMaximum)); },
    permitVerified(hashValue: string): Buffer { return step(1, () => {
      const wire = encodeInstallerChannelFrame(captured, 'PERMIT_VERIFIED', {permitHash:hashValue}, qualifiedMaximum);
      permitHash = hashValue; return wire;
    }); },
    launchReady(rawFrame: Uint8Array): void { step(2, () => checkInstallerChannelFrame(rawFrame, {...captured, stage:'PSQL_LAUNCH_READY'}, {permitHash, psqlFenceId:fence}, qualifiedMaximum)); },
    psqlStarted(pid: string, creationTime: string): Buffer { return step(3, () =>
      encodeInstallerChannelFrame(captured, 'PSQL_STARTED', {psqlPid:pid, psqlCreationTime:creationTime}, qualifiedMaximum)); },
    dispatchCheck(deliveryReceiptHash: string, inputHash: string, inputLength: string): Buffer { return step(4, () => {
      const payload = Object.freeze({deliveryReceiptHash, inputHash, inputLength});
      const wire = encodeInstallerChannelFrame(captured, 'DISPATCH_CHECK', payload, qualifiedMaximum);
      dispatch = payload; return wire;
    }); },
    dispatchCurrent(rawFrame: Uint8Array): void { step(5, () => {
      if (!dispatch) return unavailable();
      checkInstallerChannelFrame(rawFrame, {...captured, stage:'DISPATCH_CURRENT'}, dispatch, qualifiedMaximum);
    }); },
  });
}

/** Collect exactly one length-prefixed frame from fragmented pipe reads. This
 * is byte framing only: it neither opens nor authenticates an inherited pipe.
 * Incomplete EOF, extra bytes, or any error permanently spends this collector. */
export function installerChannelFrameCollector(qualifiedMaximum: bigint) {
  if (typeof qualifiedMaximum !== 'bigint' || qualifiedMaximum <= 0n) return unavailable();
  const maximum = Number(qualifiedMaximum < 4096n ? qualifiedMaximum : 4096n);
  const bytes = Buffer.alloc(4 + maximum);
  let used = 0, total = 0, spent = false, active = false;
  return Object.freeze({
    push(chunk: Uint8Array): Buffer | undefined {
      if (spent || active) { spent = true; return unavailable(); }
      active = true;
      try {
        if (!(chunk instanceof Uint8Array)) return unavailable();
        const length = chunk.byteLength;
        const actualLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(chunk);
        if (spent || length !== actualLength || !Number.isSafeInteger(length) || length <= 0 || length > 4 + maximum) return unavailable();
        let offset = 0;
        if (used < 4) {
          const n = Math.min(4 - used, length);
          for (let i = 0; i < n; i++) bytes[used + i] = chunk[i];
          used += n; offset += n;
          if (used === 4) {
            const length = bytes.readUInt32LE(0);
            if (!length || length > maximum) return unavailable();
            total = 4 + length;
          }
        }
        if (offset < length) {
          if (!total || length - offset > total - used) return unavailable();
          for (let i = offset; i < length; i++) bytes[used + i - offset] = chunk[i];
          used += length - offset;
        }
        if (spent) return unavailable();
        if (total && used === total) { spent = true; return Buffer.from(bytes.subarray(0, total)); }
        return undefined;
      } catch { spent = true; return unavailable(); } finally { active = false; }
    },
    end(): never { spent = true; return unavailable(); },
  });
}

/** Pure source-pinned SQL framing. This does not open a transport, authenticate
 * a permit, qualify a resource limit, or authorize an installer operation. */
export type InstallerFrameStage = 'PREPARE_DELIVERY' | 'DELIVERY_RECEIPT' | 'BASELINE_CONSTRUCTOR' | 'PAIR_CONSTRUCTOR' | 'DESCRIPTOR_CONSTRUCTOR' | 'CONSTRUCTOR_RECEIPT';

/** Correlation of an already bounded response only. This does not authenticate
 * a receiver, prove a commit, or supply an unused capture/dispatch fence. */
export function checkInitialReceipt(value: unknown, expected: Readonly<{
  phase: 'INITIAL_ADMISSION_COMMITTED' | 'INITIAL_PUBLICATION_COMMITTED';
  nonce: string; receiptId: string; inputClaimId: string;
  sessionClaimId?: string; attemptId?: string; receiverIdentity?: string;
  targetId?: string; coreHash?: string; capturedHash?: string; evidenceHash?: string;
}>, maxResponseBytes: bigint): void {
  if (typeof maxResponseBytes !== 'bigint' || maxResponseBytes <= 0n ||
      (expected.phase !== 'INITIAL_ADMISSION_COMMITTED' && expected.phase !== 'INITIAL_PUBLICATION_COMMITTED')) return unavailable();
  const admission = expected.phase === 'INITIAL_ADMISSION_COMMITTED';
  const keys = admission
    ? ['schemaVersion','phase','nonce','receiptId','inputClaimId','sessionClaimId','attemptId','receiverIdentity','creationTransactionId']
    : ['schemaVersion','phase','nonce','receiptId','inputClaimId','targetId','coreHash','capturedHash','evidenceHash','constructionTransactionId'];
  const r = record(value, keys);
  const xidKey = admission ? 'creationTransactionId' : 'constructionTransactionId';
  const identityKeys = admission ? ['nonce','receiptId','inputClaimId','sessionClaimId','attemptId','receiverIdentity'] as const
    : ['nonce','receiptId','inputClaimId','targetId'] as const;
  if (r.schemaVersion !== 'pro273-initial-receipt-v1' || r.phase !== expected.phase) return unavailable();
  let bound = 2n;
  for (const key of keys) {
    const field = r[key];
    if (typeof field !== 'string') return unavailable();
    // Six bytes per UTF-16 unit bounds JSON escaping, including surrogate pairs.
    bound += BigInt(key.length) + 5n + 6n * BigInt(field.length);
    if (bound > maxResponseBytes) return unavailable();
  }
  for (const key of identityKeys) if (!identifier(expected[key]) || r[key] !== expected[key]) return unavailable();
  const xid = r[xidKey] as string;
  if (!/^[1-9][0-9]{0,19}$/.test(xid) || BigInt(xid) > 18446744073709551615n) return unavailable();
  if (!admission) for (const key of ['coreHash','capturedHash','evidenceHash'] as const)
    if (!digest(expected[key]) || r[key] !== expected[key]) return unavailable();
}

/** Correlation only: neither this decoder nor a matching frame proves a commit,
 * session identity, installed authority, or permission to dispatch. */
export function checkInstallerReceiptFrame(value: unknown, expected: Readonly<{
  phase: 'DELIVERY_RECEIPT' | 'CONSTRUCTOR_RECEIPT'; nonce: string;
  expectationId: string; attemptId: string; sessionClaimId: string; inputClaimId: string; eventId: string;
  constructorKind?: 'CONTROL_PLANE_BASELINE' | 'INVOCATION_SCHEDULE_GRANT_PAIR';
  resultId?: string; coreHash?: string; captureHash?: string; evidenceHash?: string;
}>): void {
  const frame = record(value, ['schemaVersion','phase','nonce','receipt']);
  if ((expected.phase !== 'DELIVERY_RECEIPT' && expected.phase !== 'CONSTRUCTOR_RECEIPT') ||
      frame.schemaVersion !== 'pro273-installer-frame-v1' || frame.phase !== expected.phase ||
      !identifier(expected.nonce) || frame.nonce !== expected.nonce) return unavailable();
  const common = ['schemaVersion','phase','expectationId','attemptId','sessionClaimId','inputClaimId','eventId','creationTransactionId'];
  const construction = expected.phase === 'CONSTRUCTOR_RECEIPT';
  const receipt = record(frame.receipt, construction ? [...common,'constructorKind','resultId','coreHash','captureHash','evidenceHash'] : common);
  if (receipt.schemaVersion !== 'pro273-installer-receipt-v1' || receipt.phase !== (construction ? 'CONSTRUCTOR_COMMITTED' : 'DELIVERY_COMMITTED') ||
      !identifier(expected.expectationId) || !identifier(expected.attemptId) || !identifier(expected.sessionClaimId) ||
      !identifier(expected.inputClaimId) || !identifier(expected.eventId) ||
      receipt.expectationId !== expected.expectationId || receipt.attemptId !== expected.attemptId ||
      receipt.sessionClaimId !== expected.sessionClaimId || receipt.inputClaimId !== expected.inputClaimId || receipt.eventId !== expected.eventId ||
      typeof receipt.creationTransactionId !== 'string' || !/^[1-9][0-9]{0,19}$/.test(receipt.creationTransactionId) ||
      BigInt(receipt.creationTransactionId) > 18446744073709551615n) return unavailable();
  if (construction && ((expected.constructorKind !== 'CONTROL_PLANE_BASELINE' && expected.constructorKind !== 'INVOCATION_SCHEDULE_GRANT_PAIR') ||
      !identifier(expected.resultId) || !digest(expected.coreHash) || !digest(expected.captureHash) || !digest(expected.evidenceHash) ||
      receipt.constructorKind !== expected.constructorKind || receipt.resultId !== expected.resultId || receipt.coreHash !== expected.coreHash ||
      receipt.captureHash !== expected.captureHash || receipt.evidenceHash !== expected.evidenceHash)) return unavailable();
}
const installerIdExpr = "pg_catalog.convert_from(pg_catalog.decode('@ID@','hex'),'UTF8')";
const installerNonceExpr = "pg_catalog.convert_from(pg_catalog.decode('@NONCE@','hex'),'UTF8')";
const installerFrameTemplates: Readonly<Record<InstallerFrameStage,string>> = Object.freeze({
  PREPARE_DELIVERY: `BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_catalog.jsonb_build_object('schemaVersion','pro273-installer-frame-v1','phase','DELIVERY_PENDING','nonce',${installerNonceExpr},'result',public.pro273_installer_commit_delivery(${installerIdExpr}))::TEXT;COMMIT;\n`,
  DELIVERY_RECEIPT: `BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_catalog.jsonb_build_object('schemaVersion','pro273-installer-frame-v1','phase','DELIVERY_RECEIPT','nonce',${installerNonceExpr},'receipt',public.pro273_installer_delivery_receipt(${installerIdExpr}))::TEXT;COMMIT;\n`,
  BASELINE_CONSTRUCTOR: `BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_catalog.jsonb_build_object('schemaVersion','pro273-installer-frame-v1','phase','CONSTRUCTOR_PENDING','nonce',${installerNonceExpr},'result',public.pro273_control_plane_bootstrap(${installerIdExpr},pg_catalog.decode('@BODY@','hex')))::TEXT;COMMIT;\n`,
  // These constructors are not wired to a compatible fixed helper/receipt yet.
  PAIR_CONSTRUCTOR: '',
  DESCRIPTOR_CONSTRUCTOR: '',
  CONSTRUCTOR_RECEIPT: `BEGIN ISOLATION LEVEL READ COMMITTED;SELECT pg_catalog.jsonb_build_object('schemaVersion','pro273-installer-frame-v1','phase','CONSTRUCTOR_RECEIPT','nonce',${installerNonceExpr},'receipt',public.pro273_installer_constructor_receipt(${installerIdExpr}))::TEXT;COMMIT;\n`,
});
export function installerFixedSqlFrame(stage: InstallerFrameStage, expectationId: string, nonce: string, body: Uint8Array | undefined, maxStatementBytes: bigint, maxWorkingBytes: bigint): string {
  try {
    if (typeof stage !== 'string' || !Object.hasOwn(installerFrameTemplates, stage) || typeof expectationId !== 'string' || !expectationId || expectationId.includes('\0') ||
        typeof nonce !== 'string' || !nonce || nonce.includes('\0') || typeof maxStatementBytes !== 'bigint' || maxStatementBytes <= 0n ||
        typeof maxWorkingBytes !== 'bigint' || maxWorkingBytes <= 0n) return unavailable();
    if (stage === 'PAIR_CONSTRUCTOR' || stage === 'DESCRIPTOR_CONSTRUCTOR') return unavailable();
    const constructor = stage === 'BASELINE_CONSTRUCTOR';
    if (constructor ? !(body instanceof Uint8Array) || body.byteLength === 0 : body !== undefined) return unavailable();
    const template = installerFrameTemplates[stage];
    const idBytes = BigInt(Buffer.byteLength(expectationId, 'utf8'));
    const nonceBytes = BigInt(Buffer.byteLength(nonce, 'utf8'));
    const bodyBytes = body === undefined ? 0n : BigInt(body.byteLength);
    const occurrences = (needle: string) => BigInt(template.split(needle).length - 1);
    const idSlots = occurrences('@ID@'), nonceSlots = occurrences('@NONCE@'), bodySlots = occurrences('@BODY@');
    const wire = BigInt(Buffer.byteLength(template, 'ascii')) - 4n*idSlots - 7n*nonceSlots - 6n*bodySlots + 2n*idBytes*idSlots + 2n*nonceBytes*nonceSlots + 2n*bodyBytes*bodySlots;
    // Bound structural input/hex/statement copies before allocating them. Actual
    // V8, pipe, psql and OS overlap still needs independent qualification.
    const working = 2n*(idBytes+nonceBytes+bodyBytes) + 8n*wire;
    if (wire > maxStatementBytes || working > maxWorkingBytes || wire > BigInt(Number.MAX_SAFE_INTEGER)) return unavailable();
    const id = Buffer.from(expectationId, 'utf8'), nonceBuffer = Buffer.from(nonce, 'utf8');
    if (id.toString('utf8') !== expectationId || nonceBuffer.toString('utf8') !== nonce) return unavailable();
    const hexBody = body === undefined ? '' : Buffer.from(body).toString('hex');
    const result = template.split('@ID@').join(id.toString('hex')).split('@NONCE@').join(nonceBuffer.toString('hex')).split('@BODY@').join(hexBody);
    if (BigInt(Buffer.byteLength(result, 'ascii')) !== wire || result.includes('\\')) return unavailable();
    return result;
  } catch { return unavailable(); }
}

// Pure local transcript: all observations and acknowledgements are reports, not
// evidence of operating-system effects, issuer authority, or durable storage.
const projectionSlots = ['SERVICE_CONSUME','NODE_CONSUME','PSQL_CONSUME','DISPATCH_CONSUME','STARTER_RECEIPT','SERVICE_BINDING'] as const;
const projectionFiles = ['CREATE_NEW','WRITE','FLUSH','READBACK','DURABILITY_REPORT'] as const;
const projectionMax = 18446744073709551615n;
type ProjectionTicket = Readonly<Record<string, string | null>>;

/** The installed authority supplies the pins and the bounds of its current
 * UTC reading. The manifest may be read from untrusted storage. */
export type StartupReceiptPins = Readonly<{
  rawPublicKey: Uint8Array;
  publicKeySha256: string;
  bundleSha256: string;
  consumptionSha256: string;
  manifestFrame: Uint8Array;
  manifestSha256: string;
  installationClosureSha256: string;
  earliestNow: string;
  latestNow: string;
}>;

export function startupProjectionTranscriptV2(bundleInput: Uint8Array, consumptionInput: Uint8Array, projectionInputs: readonly Uint8Array[], starterInput: Uint8Array, authority: StartupReceiptPins) {
  const pins = v2Record(authority, ['rawPublicKey','publicKeySha256','bundleSha256','consumptionSha256','manifestFrame',
    'manifestSha256','installationClosureSha256','earliestNow','latestNow']);
  if (!digest(pins.publicKeySha256) || !digest(pins.bundleSha256) || !digest(pins.consumptionSha256) ||
      !digest(pins.manifestSha256) || !digest(pins.installationClosureSha256)) return unavailable();
  const earliestNow = startupTime(pins.earliestNow), latestNow = startupTime(pins.latestNow);
  if (latestNow < earliestNow) return unavailable();
  // Snapshot the only external byte sources before decoding or retaining them.
  if (!Array.isArray(projectionInputs) || types.isProxy(projectionInputs) || projectionInputs.length !== 4 || Reflect.ownKeys(projectionInputs).length !== 5) return unavailable();
  const input: Uint8Array[] = [];
  for (let i = 0; i < 4; i++) {
    const d = Object.getOwnPropertyDescriptor(projectionInputs, String(i));
    if (!d || !('value' in d)) return unavailable();
    input.push(d.value);
  }
  const keyView = fixedCapacityByteView(pins.rawPublicKey as Uint8Array,32,32);
  const views = [fixedCapacityByteView(bundleInput,76,16460), fixedCapacityByteView(consumptionInput,76,4172), ...input.map(v => fixedCapacityByteView(v,13,4108)), fixedCapacityByteView(starterInput,13,65548)];
  const key = Buffer.from(keyView);
  const captured = views.map(v => Buffer.from(v));
  const bundle = inspectCapturedStartupFrame(captured[0], 'bundle'), consumption = inspectCapturedStartupFrame(captured[1], 'consumption');
  if (createHash('sha256').update(key).digest('hex') !== pins.publicKeySha256 || bundle.frameHash !== pins.bundleSha256 || consumption.frameHash !== pins.consumptionSha256) return unavailable();
  verifyStartupFrameSignatures(bundle, consumption, key);
  const hashes = inspectStartupBundleFramesV2(bundle, consumption);
  const b = v2Record(bundle.payload, bundleV2Keys), c = v2Record(consumption.payload, consumptionV2Keys);
  if (earliestNow < (c.consumedAt as string) || latestNow >= (b.validUntil as string) || b.manifestHash !== pins.manifestSha256) return unavailable();
  const manifest = inspectStartupManifestV2(pins.manifestFrame as Uint8Array, pins.manifestSha256).payload as Record<string,unknown>;
  if (manifest.hostIdentity !== b.hostIdentity || manifest.bootIdentity !== b.bootIdentity) return unavailable();
  inspectStartupReceiverBindingV2(manifest.receiverBinding, b, pins.installationClosureSha256);
  const locals = captured.slice(2,6).map(v => inspectStartupLocalFrameV2(v,'projection'));
  const starter = inspectStartupLocalFrameV2(captured[6], 'starter'), s = v2Record(starter.payload, localStarterKeys);
  if (s.schemaVersion !== 'pro273-consumed-starter-v2' || !digest(s.starterNonce) || !digest(s.starterImageHash) ||
      startupUint(s.starterPid) > 4294967295n) return unavailable();
  startupUint(s.starterCreationTime);
  if (!localBase64(s.bundleFrameBase64,16460).equals(captured[0]) || !localBase64(s.consumptionFrameBase64,4172).equals(captured[1])) return unavailable();
  const common: Record<string,unknown> = {bundleId:b.bundleId,bundleHash:hashes.bundleHash,consumptionId:c.consumptionId,consumptionHash:hashes.consumptionHash,qualificationHash:b.qualificationHash,starterNonce:s.starterNonce};
  const events = b.events as Record<string,unknown>[], receiptKeys = ['serviceConsumeHash','nodeConsumeHash','psqlConsumeHash','dispatchConsumeHash'];
  for (let i = 0; i < 4; i++) {
    const p = v2Record(locals[i].payload, localProjectionKeys);
    if (p.schemaVersion !== 'pro273-startup-event-projection-v2' || localCommonKeys.some(k => p[k] !== common[k]) ||
        localEventKeys.some(k => p[k] !== events[i][k]) || s[receiptKeys[i]] !== locals[i].frameHash) return unavailable();
  }
  const frames = captured.slice(2); // exactly five; the sixth is created only after BIND_SERVICE.
  const frameHashes = [...locals.map(v => v.frameHash),starter.frameHash];
  const objectIds: (string | null)[] = Array(6).fill(null);
  let phase = 'PREFLIGHT', state: 'UNVERIFIED'|'UNKNOWN' = 'UNVERIFIED', busy = false, sequence = 0n;
  let slot = 0, fileStep = 0, ticket: ProjectionTicket | null = null, eventId: string | null = null;
  let started: Record<string,unknown> | null = null;
  let observedBindingHash: string | null = null, observedBindingId: string | null = null;
  const snapshot = () => Object.freeze({state, phase, ticket, operations:sequence.toString()});
  const run = (f: () => void) => {
    if (busy) { state = 'UNKNOWN'; return snapshot(); }
    if (state === 'UNKNOWN') return snapshot();
    busy = true;
    try { f(); } catch { state = 'UNKNOWN'; }
    finally { busy = false; }
    return snapshot();
  };
  const makeTicket = (operation: string): ProjectionTicket => {
    if (ticket || sequence >= 34n || sequence >= projectionMax) return unavailable();
    sequence++;
    if ((projectionFiles as readonly string[]).includes(operation)) {
      const frame = frames[slot];
      if (!frame || frame.length < 1 || BigInt(frame.length) > projectionMax) return unavailable();
      const count = operation === 'WRITE' || operation === 'READBACK' ? String(frame.length) : '0';
      return Object.freeze({kind:'FILE_OP',sequence:String(sequence),operation,slot:projectionSlots[slot],frameHash:frameHashes[slot],length:String(frame.length),objectId:objectIds[slot],offset:'0',count});
    }
    return Object.freeze({kind:'CONTROL_OP',sequence:String(sequence),operation,bundleHash:hashes.bundleHash,consumptionHash:hashes.consumptionHash,nonce:s.starterNonce as string});
  };
  const reportTicket = (value: unknown) => {
    if (!ticket) return unavailable();
    const r = v2Record(value,Object.keys(ticket));
    if (Object.keys(ticket).some(k => r[k] !== ticket![k])) return unavailable();
  };
  return Object.freeze({
    snapshot,
    preflight(value: unknown) { return run(() => {
      if (phase !== 'PREFLIGHT' || !Array.isArray(value) || types.isProxy(value) || value.length !== 6 || Reflect.ownKeys(value).length !== 7) return unavailable();
      const rows = projectionSlots.map((name,i) => {
        const d = Object.getOwnPropertyDescriptor(value,String(i)); if (!d || !('value' in d)) return unavailable();
        const row = v2Record(d.value,['slot','state','objectId','frameHash']);
        if (row.slot !== name) return unavailable();
        return row;
      });
      if (rows.every(r => r.state === 'MISSING' && r.objectId === null && r.frameHash === null)) { phase = 'AWAIT_CONSUMPTION'; return; }
      // Existing sets are never reused for writes; all six identities and exact
      // frame hashes must be separately available for any read-only correlation.
      if (rows.every((r,i) => r.state === 'EXISTING' && startupId(r.objectId) && digest(r.frameHash) && (i === 5 || r.frameHash === frameHashes[i])) && new Set(rows.map(r => r.objectId)).size === 6) { observedBindingHash = rows[5].frameHash as string; observedBindingId = rows[5].objectId as string; phase = 'READ_ONLY'; }
      else state = 'UNKNOWN';
    }); },
    correlateExisting(value: unknown) { return run(() => {
      if (phase !== 'READ_ONLY') return unavailable();
      const report = v2Record(value,['objectId','bytes']);
      if (report.objectId !== observedBindingId) return unavailable();
      const frame = Buffer.from(fixedCapacityByteView(report.bytes as Uint8Array,13,4108));
      const checked = inspectStartupLocalRecordsV2(captured[0],captured[1],captured.slice(2,6),captured[6],frame);
      if (checked.serviceBindingHash !== observedBindingHash) return unavailable();
      phase = 'CORRELATED_READ_ONLY';
    }); },
    consumption(value: unknown) { return run(() => {
      if (phase !== 'AWAIT_CONSUMPTION') return unavailable();
      const r = v2Record(value,['state','bundleHash','consumptionHash','nonce']);
      if (r.state !== 'CONSUMED' || r.bundleHash !== hashes.bundleHash || r.consumptionHash !== hashes.consumptionHash || r.nonce !== s.starterNonce) return unavailable();
      phase = 'FILES';
    }); },
    next() { return run(() => {
      if (ticket) return unavailable();
      if (phase === 'FILES') ticket = makeTicket(projectionFiles[fileStep]);
      else if (phase === 'EVENT') ticket = makeTicket('CREATE_EVENT');
      else if (phase === 'START') ticket = makeTicket('START_SERVICE');
      else if (phase === 'BIND') ticket = makeTicket('BIND_SERVICE');
      else if (phase === 'SIGNAL') ticket = makeTicket('SIGNAL_EVENT');
      else return unavailable();
    }); },
    ack(value: unknown) { return run(() => {
      if (!ticket) return unavailable();
      const a = v2Record(value,['ticket','result']); reportTicket(a.ticket);
      const op = ticket.operation;
      if (op === 'CREATE_NEW') {
        const r = v2Record(a.result,['state','objectId']);
        if (r.state !== 'CREATED' || !startupId(r.objectId) || objectIds.includes(r.objectId as string) || r.objectId === eventId) return unavailable();
        objectIds[slot] = r.objectId as string;
      } else if (op === 'WRITE') {
        const r = v2Record(a.result,['state','objectId','count']);
        if (r.state !== 'WRITTEN' || r.objectId !== objectIds[slot] || r.count !== ticket.count || r.count === '0') return unavailable();
      } else if (op === 'FLUSH') {
        const r = v2Record(a.result,['state','objectId']); if (r.state !== 'FLUSHED' || r.objectId !== objectIds[slot]) return unavailable();
      } else if (op === 'READBACK') {
        const r = v2Record(a.result,['state','objectId','count','frameHash']);
        if (r.state !== 'HASH_REPORTED' || r.objectId !== objectIds[slot] || r.count !== ticket.count || r.frameHash !== frameHashes[slot]) return unavailable();
      } else if (op === 'DURABILITY_REPORT') {
        const r = v2Record(a.result,['state','objectId']); if (r.state !== 'UNVERIFIED' || r.objectId !== objectIds[slot]) return unavailable();
      } else if (op === 'CREATE_EVENT') {
        // These are unverified claims about a modeled identity, not a real name,
        // handle, ACL, or proof that an event exists.
        const r = v2Record(a.result,['state','eventId','manualReset','initiallySignaled','protected']);
        if (r.state !== 'CREATED' || !startupId(r.eventId) || objectIds.includes(r.eventId as string) ||
            r.manualReset !== true || r.initiallySignaled !== false || r.protected !== true) return unavailable(); eventId = r.eventId as string;
      } else if (op === 'START_SERVICE') {
        const r = v2Record(a.result,['state','eventId','serviceName','serviceSid','servicePid','serviceCreationTime','serviceImageHash']);
        if (r.state !== 'START_REPORTED' || r.eventId !== eventId || !validStartupServiceIdentity(r.serviceName,r.serviceSid) || !digest(r.serviceImageHash) || startupUint(r.servicePid) > 4294967295n) return unavailable();
        startupUint(r.serviceCreationTime); started = r;
      } else if (op === 'BIND_SERVICE') {
        const r = v2Record(a.result,['state','eventId','serviceName','serviceSid','servicePid','serviceCreationTime','serviceImageHash']);
        if (r.state !== 'BOUND' || r.eventId !== eventId || !started || ['serviceName','serviceSid','servicePid','serviceCreationTime','serviceImageHash'].some(k => r[k] !== started![k])) return unavailable();
        const binding = {schemaVersion:'pro273-starter-service-binding-v2',...common,starterReceiptHash:starter.frameHash,serviceName:r.serviceName,serviceSid:r.serviceSid,servicePid:r.servicePid,serviceCreationTime:r.serviceCreationTime,serviceImageHash:r.serviceImageHash,hostIdentity:b.hostIdentity,bootIdentity:b.bootIdentity,authorityEpoch:b.authorityEpoch,installationGeneration:b.installationGeneration};
        const body = Buffer.from(startupCanonical(binding),'utf8'); if (body.length > 4096) return unavailable();
        const header = Buffer.alloc(12); header.write('P273F002'); header.writeUInt32LE(body.length,8);
        const frame = Buffer.concat([header,body]);
        // Reuse the reviewed complete six-record validator on the exact snapshot.
        const checked = inspectStartupLocalRecordsV2(captured[0],captured[1],captured.slice(2,6),captured[6],frame);
        frames.push(frame); frameHashes.push(checked.serviceBindingHash);
      } else if (op === 'SIGNAL_EVENT') {
        const r = v2Record(a.result,['state','eventId']); if (r.state !== 'SIGNALED' || r.eventId !== eventId) return unavailable();
      } else return unavailable();
      if (state === 'UNKNOWN') return;
      ticket = null;
      if ((projectionFiles as readonly string[]).includes(op as string)) {
        if (++fileStep === 5) { fileStep = 0; slot++; phase = slot === 5 ? 'EVENT' : slot === 6 ? 'SIGNAL' : 'FILES'; }
      } else if (op === 'CREATE_EVENT') phase = 'START';
      else if (op === 'START_SERVICE') phase = 'BIND';
      else if (op === 'BIND_SERVICE') phase = 'FILES';
      else phase = 'COMPLETE';
    }); }
  });
}
