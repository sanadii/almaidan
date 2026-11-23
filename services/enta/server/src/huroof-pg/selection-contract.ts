import type { RequestHandler } from 'express';

/** Frozen wire reference only. It supplies neither a parser nor authority, storage or qualified resources. */
export const controlPlaneObservationReference = Object.freeze({
  schemaVersion: 'pro273-control-plane-process-v1',
  payloadFields: Object.freeze(['schemaVersion','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','targetOid','targetPrincipal','targetPid','targetBackendStart','credentialEpoch','launchEpoch','host','boot','processTree','parentProcessTree','sourceClosureHash','installationClosureHash','observedAt','validUntil','evidenceBase64','evidenceHash'] as const),
  lexerTokens: 45,
  receiptDomain: 'pro273.control-plane.observation.receipt.v1',
  receiptPreimageFields: Object.freeze(['reservationId','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','inputClaimId','capturedHash','evidenceHash','constructionTransactionId'] as const),
  receiptSchemaVersion: 'pro273-control-plane-observation-receipt-v1',
  receiptPhase: 'CONTROL_PLANE_OBSERVATION_COMMITTED',
  responseFields: Object.freeze(['schemaVersion','phase','nonce','receiptId','inputClaimId','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','capturedHash','evidenceHash','constructionTransactionId'] as const),
  hashFields: Object.freeze(['baselineCoreHash','sourceClosureHash','installationClosureHash','evidenceHash'] as const),
  xidMaximum: '18446744073709551615',
  // These describe the target; the reservation's observer identity is separate.
  targetFields: Object.freeze(['targetOid','targetPrincipal','targetPid','targetBackendStart','credentialEpoch','launchEpoch','host','boot','processTree','parentProcessTree','sourceClosureHash','installationClosureHash'] as const),
  representation: Object.freeze({
    payload: 'exactly 22 required string fields; decoded duplicate keys, missing and extra fields deny',
    text: 'fatal UTF-8 without BOM; nonempty Unicode scalars without NUL or normalization',
    targetRanges: 'canonical positive decimal OID <= 4294967295; PID <= 2147483647',
    timestamps: 'YYYY-MM-DDTHH:mm:ss.ffffffZ; Gregorian years 0001-9999; targetBackendStart <= observedAt <= fresh now < validUntil',
    evidence: 'standard padded base64, nonempty, zero unused pad bits; evidenceHash is SHA256 of decoded bytes',
    capturedHash: 'SHA256 of exact original bytes',
    receipt: 'SHA256 of canonical UTF-8 JSON string array in specified order; positive canonical uint64 actual construction xid; nonce excluded',
    escaping: 'JSON escaping for controls, quote and backslash; preserve astral, U+2028 and U+2029',
    identity: 'payload describes target; reservation observer identity is independent',
    qualification: 'name limit, freshness, age/skew, validity, preimage, response, nonce and all resource bounds require independent qualification',
  }),
  qualifiedResources: null,
} as const);

/** Disconnected specification data only: no publication or resource authority. */
export const initialPublicationReceiptReference = Object.freeze({
  domain: 'pro273.initial.publication.receipt.v1',
  fields: Object.freeze(['admissionReceiptId','attemptId','capturedHash','constructionTransactionId','coreHash','eventId','evidenceHash','inputClaimId','sessionClaimId','targetId','targetKind'] as const),
  hashFields: Object.freeze(['capturedHash','coreHash','evidenceHash'] as const),
  targetKinds: Object.freeze(['QUALIFIER_LAYOUT','QUALIFIER_ALLOCATION'] as const),
  xidMaximum: '18446744073709551615',
  // No qualified preimage/response bounds, issuer, xid, or publication path exist here.
  qualifiedResources: null,
} as const);

/** PRO273 wire validation. Validation never grants capacity or authority. */
export class SelectionUnavailable extends Error {
  constructor() { super('SELECTION_UNAVAILABLE'); this.name = 'SelectionUnavailable'; }
}
function deny(): never { throw new SelectionUnavailable(); }
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return deny();
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== names.length || names.some(name => !Object.hasOwn(source, name))) return deny();
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) result[name] = source[name];
  return result;
}
const str = (value: unknown): value is string => typeof value === 'string';
/** Representation only: actual transaction identity must be authenticated by SQL. */
export function isInitialPublicationXid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20 &&
    /^[1-9]/.test(value) && !/[^0-9]/.test(value) && (value.length < 20 || value <= '18446744073709551615');
}
const hash = (value: unknown): value is string => str(value) && value.length === 64 && !/[^a-f0-9]/.test(value);
const decimal = (value: unknown): value is string => str(value) && value.length > 0 && !/[^0-9]/.test(value) && (value === '0' || value[0] !== '0');
const positive = (value: unknown): value is string => decimal(value) && value !== '0' && (value.length < 19 || (value.length === 19 && value <= '9223372036854775807'));

/** Disconnected wire schema; none of these values is a qualified resource. */
export const observationResourceProfileReference = Object.freeze({
  schemaVersion: 'pro273-control-observation-resources-v1',
  hashDomain: 'pro273.control-observation.resources.core.v1',
  modelVersion: 'pro273-observation-affine-cost-v1',
  coreFields: Object.freeze(['schemaVersion','sourceClosureHash','postgresBuildHash','driverClosureHash','receiverClosureHash','parserAbiHash','memoryEvidenceHash','workEvidenceHash','durabilityEvidenceHash','reservationId','bindingQualificationHash','limits','representation','phases'] as const),
  hashFields: Object.freeze(['sourceClosureHash','postgresBuildHash','driverClosureHash','receiverClosureHash','parserAbiHash','memoryEvidenceHash','workEvidenceHash','durabilityEvidenceHash','bindingQualificationHash'] as const),
  limits: Object.freeze(['maxCapturedBytes','maxDecodedUnits','maxStringUnits','maxEvidenceBytes','maxCanonicalBytes','maxResponseBytes','maxNonceBytes','maxAllocationBytes','maxStackBytes','maxRawAccesses','maxUnitAccesses','maxArrayWrites','maxDecoderByteWrites','maxWorkUnits','maxCumulativeAllocationBytes','pgAllocationCeilingBytes'] as const),
  phases: Object.freeze(['capture','scanDecode','validate','serialize','persist','receipt'] as const),
  measures: Object.freeze(['backendPeakBytes','sharedPeakBytes','temporaryPeakBytes','parentPeakBytes','durableBytes','workUnits'] as const),
  classes: Object.freeze(['raw','bytea','text','intArray45','textArray45','byteaArray45','jsonb','call','constants','hash','base64'] as const),
  coefficients: Object.freeze(['allocationBaseBytes','allocationPerPayloadByte','allocationPerElementBytes','workBaseUnits','workPerPayloadByte','workPerElementUnits'] as const),
  decodedStrings: 44, arrayElements: 45, writeOnceCells: 315,
  qualifiedResources: null,
} as const);

const resourceMaximum = 9223372036854775807n;
const boundedResourceDecimal = (value: unknown): value is string =>
  decimal(value) && value.length <= 19 &&
  (value.length < 19 || value <= '9223372036854775807');

// PostgreSQL JSONB text cannot represent NUL or unpaired UTF-16 surrogates.
function initialIdentityText(value: unknown): value is string {
  if (!str(value) || !value.length) return false;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit === 0 || (unit >= 0xdc00 && unit <= 0xdfff)) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    }
  }
  return true;
}

/** Shape reference only; this does not authenticate a trust scope or qualify resources. */
export function parseInitialQualificationShape(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return deny();
  const count = Object.keys(value).length;
  if (count !== 21 && count !== 23) return deny();
  const names = ['schemaVersion','baselineId','baselineCoreHash','parserAbiVersion','sourceClosureHash',
    'installationClosureHash','receiverIdentity','receiverClosureHash','maxInputBytes','maxOutputBytes',
    'parserPeakBytes','serializationPeakBytes','jsonbPeakBytes','largestAllocationBytes','stackPeakBytes',
    'eventDurableBytes','closedScopeDurableBytes','memoryEvidenceHash','durabilityEvidenceHash',
    'fenceEvidenceHash','fenceAbiVersion', ...(count === 23 ? ['decoderOverheadBytes','decoderWorkBytes'] : [])];
  const result = fields(value, names);
  const schema = result.schemaVersion;
  if (schema !== (count === 21 ? 'pro273-initial-qualification-v1' : 'pro273-initial-qualification-v2') ||
      result.parserAbiVersion !== (schema === 'pro273-initial-qualification-v1' ? 'pro273-initial-metadata-v1' : 'pro273-initial-metadata-v2') ||
      result.fenceAbiVersion !== 'pro273-initial-one-shot-v1' ||
      !initialIdentityText(result.baselineId) || !initialIdentityText(result.receiverIdentity)) return deny();
  for (const key of ['baselineCoreHash','sourceClosureHash','installationClosureHash','receiverClosureHash',
    'memoryEvidenceHash','durabilityEvidenceHash','fenceEvidenceHash'] as const) if (!hash(result[key])) return deny();
  for (const key of ['maxInputBytes','maxOutputBytes','parserPeakBytes','serializationPeakBytes','jsonbPeakBytes',
    'largestAllocationBytes','stackPeakBytes','eventDurableBytes','closedScopeDurableBytes',
    ...(schema === 'pro273-initial-qualification-v2' ? ['decoderOverheadBytes','decoderWorkBytes'] : [])]) {
    if (!boundedResourceDecimal(result[key]) || result[key] === '0') return deny();
  }
  return Object.freeze(result);
}
// Structural identity only: nonempty Unicode scalar text, no NUL, at most 256 UTF-8 bytes.
function resourceReservationId(value: unknown): value is string {
  if (!str(value) || value.length === 0 || value.length > 256) return false;
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit === 0 || (unit >= 0xdc00 && unit <= 0xdfff)) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      bytes += 4;
    } else bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    if (bytes > 256) return false;
  }
  return true;
}

/** Shape validation only; zero is representable but has no proof of being unused. */
export function parseObservationResourceCore(value: unknown): Readonly<Record<string, unknown>> {
  const spec = observationResourceProfileReference;
  const core = fields(value, spec.coreFields);
  if (core.schemaVersion !== spec.schemaVersion || spec.hashFields.some(key => !hash(core[key])) ||
      !resourceReservationId(core.reservationId)) return deny();
  const limits = fields(core.limits, spec.limits);
  for (const key of spec.limits) if (!boundedResourceDecimal(limits[key]) || limits[key] === '0') return deny();
  const phases = fields(core.phases, spec.phases);
  for (const phase of spec.phases) {
    const measures = fields(phases[phase], spec.measures);
    for (const key of spec.measures) if (!boundedResourceDecimal(measures[key])) return deny();
    phases[phase] = Object.freeze(measures);
  }
  const representation = fields(core.representation, ['modelVersion', ...spec.classes]);
  if (representation.modelVersion !== spec.modelVersion) return deny();
  for (const name of spec.classes) {
    const coefficients = fields(representation[name], spec.coefficients);
    for (const key of spec.coefficients) if (!boundedResourceDecimal(coefficients[key])) return deny();
    representation[name] = Object.freeze(coefficients);
  }
  core.limits = Object.freeze(limits);
  core.phases = Object.freeze(phases);
  core.representation = Object.freeze(representation);
  return Object.freeze(core);
}

function resourceAdd(a: bigint, b: bigint): bigint {
  if (a < 0n || b < 0n || a > resourceMaximum - b) return deny();
  return a + b;
}
function resourceMultiply(a: bigint, b: bigint): bigint {
  if (a < 0n || b < 0n || (b !== 0n && a > resourceMaximum / b)) return deny();
  return a * b;
}

/** Synthetic fixed bytea full-copy arithmetic only, never an admission or complete cost model. */
export function syntheticObservationByteaCopies(coreValue: unknown, unitsValue: unknown): Readonly<{ allocationBytes: bigint; workUnits: bigint }> {
  const core = parseObservationResourceCore(coreValue);
  try {
    if (!Array.isArray(unitsValue) || Object.getOwnPropertyDescriptor(unitsValue, 'length')?.value !== 44) return deny();
  } catch { return deny(); }
  const limits = core.limits as Record<string, string>;
  const representation = core.representation as Record<string, Record<string, string>>;
  const c = representation.bytea;
  // No proof exists for any zero component in this synthetic exercise.
  if (observationResourceProfileReference.coefficients.some(key => c[key] === '0')) return deny();
  let allocationBytes = 0n, workUnits = 0n, totalUnits = 0n;
  for (let i = 0; i < 44; i++) {
    let descriptor: PropertyDescriptor | undefined;
    try { descriptor = Object.getOwnPropertyDescriptor(unitsValue, String(i)); } catch { return deny(); }
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return deny();
    const captured = descriptor.value;
    if (!boundedResourceDecimal(captured)) return deny();
    const units = BigInt(captured);
    if (units > BigInt(limits.maxStringUnits)) return deny();
    totalUnits = resourceAdd(totalUnits, units);
    if (totalUnits > BigInt(limits.maxDecodedUnits)) return deny();
    const bytes = resourceMultiply(2n, units);
    const allocation = resourceAdd(resourceAdd(BigInt(c.allocationBaseBytes), resourceMultiply(BigInt(c.allocationPerPayloadByte), bytes)), BigInt(c.allocationPerElementBytes));
    const work = resourceAdd(resourceAdd(BigInt(c.workBaseUnits), resourceMultiply(BigInt(c.workPerPayloadByte), bytes)), BigInt(c.workPerElementUnits));
    if (allocation > BigInt(limits.maxAllocationBytes) || allocation > BigInt(limits.pgAllocationCeilingBytes)) return deny();
    allocationBytes = resourceAdd(allocationBytes, resourceMultiply(bytes, allocation));
    workUnits = resourceAdd(workUnits, resourceMultiply(bytes, work));
    if (allocationBytes > BigInt(limits.maxCumulativeAllocationBytes) || workUnits > BigInt(limits.maxWorkUnits)) return deny();
  }
  return Object.freeze({allocationBytes, workUnits});
}

/** No bootstrap allowance, qualified build, issuer or provenance is supplied here. */
export function requireObservationResourceAuthority(): never { return deny(); }
const utc = (value: unknown): value is string => {
  if (!str(value) || !/^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};
export interface ExpectedActor {
  readonly uid: string; readonly identityId: string; readonly role: 'host' | 'player' | 'audience';
  readonly team: 'horizontal' | 'vertical' | null; readonly ready: boolean; readonly active: true;
  readonly memberGeneration: string; readonly memberVersion: string;
}
/** An actor value is only a comparison input; protected SQL derives authority. */
export function parseExpectedActor(value: unknown): ExpectedActor {
  const r = fields(value, ['uid','identityId','role','team','ready','active','memberGeneration','memberVersion']);
  const {uid,identityId,role,team,ready,active,memberGeneration,memberVersion} = r;
  if (!str(uid) || !str(identityId) || (role !== 'host' && role !== 'player' && role !== 'audience') ||
      (team !== null && team !== 'horizontal' && team !== 'vertical') || typeof ready !== 'boolean' || active !== true ||
      !positive(memberGeneration) || !decimal(memberVersion)) return deny();
  return Object.freeze({uid,identityId,role,team,ready,active,memberGeneration,memberVersion});
}
export const selectionOperations = ['PG_ORDINARY_SETUP','PG_ORDINARY_START','PG_ORDINARY_LOBBY','PG_ORDINARY_COMMAND','PG_ORDINARY_PROJECTION','PG_ORDINARY_REALTIME','PG_ORDINARY_JOIN'] as const;
export const selectionBranches = ['SETUP_CREATE','FIRST_PAID_START','LOBBY_TRANSITION','SELECT_OR_REPLACE','CONTINUE','DEADLINE','TERMINAL','OBSERVE','JOIN_PREPARE'] as const;
export type SelectionOperation = typeof selectionOperations[number];
export type SelectionBranch = typeof selectionBranches[number];
export interface VerificationMetadata {
  readonly schemaVersion: 'pro273-verification-v1'; readonly controlId: string; readonly admissionId: string; readonly fence: string;
  readonly operation: SelectionOperation; readonly phase: 'EXECUTING'; readonly branch: SelectionBranch;
  readonly primitiveProfileId: string | null; readonly primitiveGeneration: string | null; readonly primitiveRecordHash: string | null;
  readonly sourceClosureHash: string; readonly installedClosureHash: string; readonly contentBindingHash: string | null;
  readonly sampledDbTime: string; readonly sampledTimeIdentity: string; readonly invocationOrdinal: string;
}
/** Closed metadata parser; the caller must independently bind every field to SQL state. */
export function parseVerificationMetadata(value: unknown): VerificationMetadata {
  const r = fields(value, ['schemaVersion','controlId','admissionId','fence','operation','phase','branch','primitiveProfileId','primitiveGeneration','primitiveRecordHash','sourceClosureHash','installedClosureHash','contentBindingHash','sampledDbTime','sampledTimeIdentity','invocationOrdinal']);
  const {schemaVersion,controlId,admissionId,fence,operation,phase,branch,primitiveProfileId,primitiveGeneration,primitiveRecordHash,sourceClosureHash,installedClosureHash,contentBindingHash,sampledDbTime,sampledTimeIdentity,invocationOrdinal} = r;
  if (schemaVersion !== 'pro273-verification-v1' || !str(controlId) || !str(admissionId) || !positive(fence) ||
      !selectionOperations.some(v => v === operation) || phase !== 'EXECUTING' || !selectionBranches.some(v => v === branch) ||
      !((primitiveProfileId === null && primitiveGeneration === null && primitiveRecordHash === null) ||
        (str(primitiveProfileId) && positive(primitiveGeneration) && hash(primitiveRecordHash))) ||
      !hash(sourceClosureHash) || !hash(installedClosureHash) || !(contentBindingHash === null || hash(contentBindingHash)) ||
      !utc(sampledDbTime) || !str(sampledTimeIdentity) || !positive(invocationOrdinal)) return deny();
  return Object.freeze({schemaVersion,controlId,admissionId,fence,operation:operation as SelectionOperation,phase,branch:branch as SelectionBranch,primitiveProfileId,primitiveGeneration,primitiveRecordHash,sourceClosureHash,installedClosureHash,contentBindingHash,sampledDbTime,sampledTimeIdentity,invocationOrdinal});
}

const primitiveSignatures = [
  'pro273_prim_compare(bytea,bytea,oid)', 'pro273_prim_nfkc(bytea)', 'pro273_prim_nfc(bytea)',
  'pro273_prim_upper(bytea)', 'pro273_prim_number_parse(bytea)', 'pro273_prim_number_string(bytea)',
  'pro273_prim_f64(text,bytea,bytea)', 'pro273_prim_f64_unary(text,bytea)', 'pro273_prim_identity()'
] as const;
const profileKeys = [
  'schemaVersion','abiVersion','profileId','namespace','project','deployment','environment','databaseIdentity',
  'nodeVersion','v8Version','serverVersion','icuVersion','unicodeVersion','doubleConversionVersion','compilerIdentity',
  'targetAbi','serverEncoding','jsLocale','collationSchema','collationName','collationProvider','collationVersion',
  'collationActualVersion','generation','sourceClosureHash','callsiteClosureHash',
  'inputDomainHash','bridgeSourceHash','bridgeBinaryHash','buildManifestHash',
  'nodeExecutableHash','serverBinaryHash','icuLibraryHash','icuDataHash','doubleConversionSourceHash',
  'doubleConversionBinaryHash','collationOid','collationDeterministic','jsOptions','primitiveFunctionIdentities',
  'validFrom','validUntil'
] as const;
const profileStrings = [
  'profileId','namespace','project','deployment','environment','databaseIdentity','nodeVersion','v8Version','serverVersion',
  'icuVersion','unicodeVersion','doubleConversionVersion','compilerIdentity','targetAbi','serverEncoding','jsLocale',
  'collationSchema','collationName','collationProvider','collationVersion','collationActualVersion'
] as const;
const profileHashes = [
  'sourceClosureHash','callsiteClosureHash','inputDomainHash',
  'bridgeSourceHash','bridgeBinaryHash','buildManifestHash','nodeExecutableHash','serverBinaryHash','icuLibraryHash',
  'icuDataHash','doubleConversionSourceHash','doubleConversionBinaryHash'
] as const;
const oid = (value: unknown): value is string => positive(value) && (value.length < 10 || (value.length === 10 && value <= '4294967295'));
/** Parses a complete semantic profile into detached data. This does not qualify it. */
export function parsePrimitiveProfile(value: unknown): Readonly<Record<string, unknown>> {
  const r = fields(value, profileKeys);
  if (r.schemaVersion !== 'pro273-selection-primitives-v1' || r.abiVersion !== 'pro273-primitive-abi-v1' ||
      profileStrings.some(k => !str(r[k]) || (r[k] as string).length === 0) ||
      profileHashes.some(k => !hash(r[k])) || !positive(r.generation) ||
      !oid(r.collationOid) || typeof r.collationDeterministic !== 'boolean' ||
      !utc(r.validFrom) || !utc(r.validUntil) || Date.parse(r.validFrom) >= Date.parse(r.validUntil)) return deny();
  const options = fields(r.jsOptions, ['usage','sensitivity','ignorePunctuation','numeric','caseFirst','collation']);
  const {usage,sensitivity,ignorePunctuation,numeric,caseFirst,collation} = options;
  if ((usage !== 'sort' && usage !== 'search') ||
      (sensitivity !== 'base' && sensitivity !== 'accent' && sensitivity !== 'case' && sensitivity !== 'variant') ||
      typeof ignorePunctuation !== 'boolean' || typeof numeric !== 'boolean' ||
      (caseFirst !== 'upper' && caseFirst !== 'lower' && caseFirst !== 'false') || !str(collation) || !collation) return deny();
  const inputFunctions = r.primitiveFunctionIdentities;
  if (!Array.isArray(inputFunctions) || inputFunctions.length !== primitiveSignatures.length) return deny();
  const seen = new Set<string>(), seenOids = new Set<string>();
  const functions: Readonly<{signature: string; oid: string; probin: string; prosrc: string}>[] = [];
  for (let index = 0; index < primitiveSignatures.length; index++) {
    if (!Object.hasOwn(inputFunctions, index)) return deny();
    const f = fields(inputFunctions[index], ['signature','oid','probin','prosrc']);
    const {signature,oid: functionOid,probin,prosrc} = f;
    if (!str(signature) || !primitiveSignatures.some(s => s === signature) || seen.has(signature) ||
        !oid(functionOid) || seenOids.has(functionOid) || !str(probin) || !probin || !str(prosrc) || !prosrc) return deny();
    seen.add(signature); seenOids.add(functionOid);
    functions.push(Object.freeze({signature,oid:functionOid,probin,prosrc}));
  }
  return Object.freeze({...r,jsOptions:Object.freeze({usage,sensitivity,ignorePunctuation,numeric,caseFirst,collation}),primitiveFunctionIdentities:Object.freeze(functions)});
}

export interface SelectionSession {
  readonly principal: string; readonly principalOid: string; readonly backendPid: string; readonly backendStart: string;
  readonly host: string; readonly boot: string; readonly processTree: string; readonly installObservationId: string;
  readonly installObservationHash: string; readonly credentialEpoch: string; readonly launchEpoch: string;
}
/** Detached session coordinates; SQL still resolves and compares the live backend. */
export function parseSelectionSession(value: unknown): SelectionSession {
  const r = fields(value,['principal','principalOid','backendPid','backendStart','host','boot','processTree','installObservationId','installObservationHash','credentialEpoch','launchEpoch']);
  const {principal,principalOid,backendPid,backendStart,host,boot,processTree,installObservationId,installObservationHash,credentialEpoch,launchEpoch} = r;
  if (!str(principal) || !oid(principalOid) || !positive(backendPid) ||
      (backendPid.length > 10 || (backendPid.length === 10 && backendPid > '2147483647')) ||
      !str(backendStart) || !str(host) || !str(boot) || !str(processTree) || !str(installObservationId) ||
      !hash(installObservationHash) || !str(credentialEpoch) || !str(launchEpoch)) return deny();
  return Object.freeze({principal,principalOid,backendPid,backendStart,host,boot,processTree,installObservationId,installObservationHash,credentialEpoch,launchEpoch});
}

export interface SelectionActor {
  readonly kind: 'AUTHENTICATED'; readonly namespace: string; readonly project: string; readonly identityId: string;
  readonly uid: string; readonly policyRevision: string; readonly policyHash: string;
}
export function parseSelectionActor(value: unknown): SelectionActor {
  const r=fields(value,['kind','namespace','project','identityId','uid','policyRevision','policyHash']);
  const {kind,namespace,project,identityId,uid,policyRevision,policyHash}=r;
  if (kind!=='AUTHENTICATED' || !str(namespace) || !str(project) || !str(identityId) || !str(uid) || !str(policyRevision) || !hash(policyHash)) return deny();
  return Object.freeze({kind,namespace,project,identityId,uid,policyRevision,policyHash});
}
export type SelectionTarget = Readonly<{kind:'NONE'}> | Readonly<{kind:'LOBBY';roomId:string;generation:string;memberGeneration:string;revision:string;stateHash:string}> | Readonly<{kind:'MATCH';roomId:string;generation:string;memberGeneration:string;revision:string;sequence:string;matchId:string}>;
/** Tagged alternatives retain explicit inapplicability; no field proves authority. */
export function parseSelectionTarget(value: unknown): SelectionTarget {
  if (value===null || typeof value!=='object' || Array.isArray(value) || !Object.hasOwn(value,'kind')) return deny();
  // Capture the discriminator once, then validate all remaining captured fields.
  const source=value as Record<string,unknown>, kind=source.kind;
  const keys = kind==='NONE' ? ['kind'] : kind==='LOBBY' ? ['kind','roomId','generation','memberGeneration','revision','stateHash'] : kind==='MATCH' ? ['kind','roomId','generation','memberGeneration','revision','sequence','matchId'] : null;
  if (!keys || Object.keys(source).length!==keys.length || keys.some(k=>!Object.hasOwn(source,k))) return deny();
  if (kind==='NONE') return Object.freeze({kind});
  const roomId=source.roomId,generation=source.generation,memberGeneration=source.memberGeneration,revision=source.revision;
  if (!str(roomId) || !decimal(generation) || !decimal(memberGeneration) || !decimal(revision)) return deny();
  if (kind==='LOBBY') { const stateHash=source.stateHash; if (!hash(stateHash)) return deny(); return Object.freeze({kind,roomId,generation,memberGeneration,revision,stateHash}); }
  if (kind==='MATCH') { const sequence=source.sequence,matchId=source.matchId; if (!decimal(sequence) || !str(matchId)) return deny(); return Object.freeze({kind,roomId,generation,memberGeneration,revision,sequence,matchId}); }
  return deny();
}

const protectedPlayPaths = new Set(['/rooms','/start','/lobby-command','/command','/projection','/realtime/read','/realtime/join-prepare']);
/** Route selection only; this never grants an admission or consumes a body. */
export function isProtectedPlayRoute(method: string, path: string): boolean {
  return method === 'POST' && protectedPlayPaths.has(path);
}

/** Mounted only on the reserved prefix after deployment namespace validation. */
export const protectedPlayRouteGate: RequestHandler = (request, response, next) => {
  if (!isProtectedPlayRoute(request.method, request.path)) {
    response.status(503).json({error:'CAPACITY_UNAVAILABLE'});
    return;
  }
  next();
};
/** Fallback while no genuine ordinary-operation ingress has consumed the request. */
export const protectedPlayUnavailable: RequestHandler = (_request, response) => {
  response.status(503).json({error:'CAPACITY_UNAVAILABLE'});
};
