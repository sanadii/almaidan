import { createHash } from "node:crypto";
import { admissionHash, assertBinding, assertHostedConfig, assertProof, assertRoomBinding, canonicalJson, materialRoomConfig, type HuroofBinding, type HuroofProof } from "./huroof-protocol.cjs";

/** Inactive R3.S component. These functions check supplied snapshot consistency.
 * They do NOT authenticate callers, establish read provenance/completeness,
 * certify publication/readiness, allocate IDs, perform I/O, or run transactions.
 * A future trusted adapter must obtain all facts in the correct project and
 * transaction. Returned routes confer no permission; plans are not SDK batches.
 */
export type EngineVersion = "huroof-legacy-v1" | "maydan-paid-v1";
export type DocumentFact =
  | { path: string; state: "exists"; value: unknown }
  | { path: string; state: "absent" | "unavailable" | "incomplete" };
export type MembershipFact =
  | { path: string; state: "complete"; documents: readonly { id: string; value: unknown }[] }
  | { path: string; state: "unavailable" | "incomplete" };
export interface CoexistenceSnapshot {
  projectId: string;
  documents: readonly DocumentFact[];
  /** Complete all-members query, not a single host document or partial page. */
  memberships: readonly MembershipFact[];
}
export type ReadRequirement = { kind: "document" | "all-members"; path: string };
type Failure = { kind: "conflict" | "unavailable"; reason: string };
export type ResolutionDecision = Failure | { kind: "not-found" }
  | { kind: "terminal"; reason: "closed" | "completed" | "cancelled" }
  | { kind: "route"; route: { engineVersion: EngineVersion; roomId: string; roomCode: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEGMENT = /^[A-Za-z0-9._:-]{1,200}$/;
const CODE = /^[A-Z0-9]{8}$/;
const HASH = /^[a-f0-9]{64}$/;
const LIFECYCLES = new Set(["LOBBY", "ROUND_SETUP", "CELL_SELECTION", "LETTER_REVEAL", "QUESTION_READING", "FIRST_ANSWER", "OPPONENT_CHANCE", "QUESTION_FAILED", "CELL_AWARDED", "PATH_CHECK", "ROUND_COMPLETE", "MATCH_COMPLETE", "PAUSED", "CORRECTION"]);
const SUBCOLLECTIONS = ["members", "projections", "presence", "intentReceipts", "events"] as const;
export type PaidSubcollection = typeof SUBCOLLECTIONS[number];

class DecisionFailure extends Error {
  constructor(readonly kind: "conflict" | "unavailable", readonly reason: string) { super(reason); }
}
function conflict(reason = "INTEGRITY_FAILURE"): never { throw new DecisionFailure("conflict", reason); }
function ensure(condition: unknown, reason = "INTEGRITY_FAILURE"): asserts condition { if (!condition) conflict(reason); }
function segment(value: unknown): asserts value is string { ensure(typeof value === "string" && SEGMENT.test(value) && value !== "." && value !== "..", "INVALID_SEGMENT"); }
function legacyId(value: unknown): asserts value is string { ensure(typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value), "INVALID_LEGACY_ID"); }
function uuid(value: unknown): asserts value is string { ensure(typeof value === "string" && UUID.test(value), "INVALID_UUID"); }
function code(value: unknown): asserts value is string { ensure(typeof value === "string" && CODE.test(value), "INVALID_ROOM_CODE"); }
function record(value: unknown): Record<string, unknown> { ensure(value !== null && typeof value === "object" && !Array.isArray(value)); return value as Record<string, unknown>; }
function exact(value: Record<string, unknown>, keys: readonly string[]): void { ensure(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); }

/** No normalization of UUID, code or hashes. Invalid inputs are rejected. */
export const coexistencePaths = Object.freeze({
  index(roomCode: string) { code(roomCode); return `roomCodes/${roomCode}`; },
  legacyRoom(roomId: string) { legacyId(roomId); return `rooms/${roomId}`; },
  /** Read-only opposite-namespace probe for existing legacy auto IDs.
   * Paid allocation constructors below still require immutable v4 UUIDs. */
  paidAbsenceProbeForLegacy(roomId: string) { legacyId(roomId); return `maydanRoomsV1/${roomId}`; },
  paidRoom(roomId: string) { uuid(roomId); return `maydanRoomsV1/${roomId}`; },
  proof(admissionId: string) { uuid(admissionId); return `maydanPaidAdmissionsV1/${admissionId}`; },
  paidCollection(roomId: string, collection: PaidSubcollection) {
    uuid(roomId); ensure(SUBCOLLECTIONS.includes(collection), "INVALID_COLLECTION");
    return `maydanRoomsV1/${roomId}/${collection}`;
  },
  paidDocument(roomId: string, collection: PaidSubcollection, documentId: string) {
    segment(documentId); return `${this.paidCollection(roomId, collection)}/${documentId}`;
  },
  legacyMembers(roomId: string) { return `${this.legacyRoom(roomId)}/members`; },
  summary(roomId: string) { uuid(roomId); return `maydanAdminRoomSummariesV1/${roomId}`; },
  release(releaseId: string) { segment(releaseId); return `releases/${releaseId}`; },
  attestation: "maydanRuntimeV1/catalogSelectorAttestation",
});

export function isFirestoreTimestamp(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const timestamp = value as { seconds?: unknown; nanoseconds?: unknown };
  return typeof timestamp.seconds === "number" && Number.isSafeInteger(timestamp.seconds)
    && timestamp.seconds >= -62_135_596_800 && timestamp.seconds <= 253_402_300_799
    && typeof timestamp.nanoseconds === "number" && Number.isInteger(timestamp.nanoseconds)
    && timestamp.nanoseconds >= 0 && timestamp.nanoseconds <= 999_999_999;
}

class Reads {
  constructor(private readonly snapshot: CoexistenceSnapshot, expectedProjectId: string) {
    segment(expectedProjectId);
    ensure(snapshot && snapshot.projectId === expectedProjectId, "PROJECT_MISMATCH");
    ensure(Array.isArray(snapshot.documents) && Array.isArray(snapshot.memberships)
      && snapshot.documents.length <= 256 && snapshot.memberships.length <= 16, "INVALID_READ_SET");
    for (const facts of [snapshot.documents, snapshot.memberships]) {
      const paths = facts.map(fact => fact.path);
      ensure(paths.every(path => typeof path === "string") && new Set(paths).size === paths.length, "DUPLICATE_READ");
    }
  }
  document(path: string): DocumentFact {
    const fact = this.snapshot.documents.find(value => value.path === path);
    if (!fact) throw new DecisionFailure("unavailable", "MISSING_READ");
    if (fact.state === "unavailable" || fact.state === "incomplete") throw new DecisionFailure("unavailable", fact.state === "incomplete" ? "INCOMPLETE_READ" : "UNAVAILABLE_READ");
    ensure(fact.state === "exists" || fact.state === "absent", "INVALID_READ_STATE");
    return fact;
  }
  exists(path: string): unknown { const fact = this.document(path); ensure(fact.state === "exists"); return fact.value; }
  absent(path: string): void { ensure(this.document(path).state === "absent", "NAMESPACE_OR_RECORD_COLLISION"); }
  members(path: string): readonly { id: string; value: unknown }[] {
    const fact = this.snapshot.memberships.find(value => value.path === path);
    if (!fact) throw new DecisionFailure("unavailable", "MISSING_MEMBERSHIP_QUERY");
    if (fact.state === "unavailable" || fact.state === "incomplete") throw new DecisionFailure("unavailable", "INCOMPLETE_MEMBERSHIP_QUERY");
    ensure(fact.state === "complete" && Array.isArray(fact.documents) && fact.documents.length <= 1_000, "INVALID_MEMBERSHIP_QUERY");
    const ids = new Set<string>();
    for (const entry of fact.documents) {
      segment(entry.id);
      const member = record(entry.value);
      ensure(!ids.has(entry.id) && member.uid === entry.id && ["host", "player", "audience"].includes(member.role as string) && typeof member.active === "boolean", "INVALID_MEMBERSHIP_QUERY");
      ids.add(entry.id);
    }
    return fact.documents;
  }
}

function hostFrom(reads: Reads, path: string, expectedHostUid?: string): Record<string, unknown> {
  const hosts = reads.members(path).map(entry => record(entry.value)).filter(member => member.role === "host" && member.active === true);
  ensure(hosts.length === 1, "ACTIVE_HOST_CONFLICT");
  if (expectedHostUid !== undefined) { segment(expectedHostUid); ensure(hosts[0].uid === expectedHostUid, "HOST_MISMATCH"); }
  return hosts[0];
}
function indexEntry(value: unknown): { engineVersion: EngineVersion; roomId: string; admissionId?: string; bindingHash?: string } {
  const index = record(value);
  ensure(isFirestoreTimestamp(index.createdAt), "INVALID_TIMESTAMP");
  if (!Object.hasOwn(index, "engineVersion")) {
    exact(index, ["roomId", "createdAt"]);
    legacyId(index.roomId);
    return { engineVersion: "huroof-legacy-v1", roomId: index.roomId };
  }
  exact(index, ["engineVersion", "roomId", "admissionId", "bindingHash", "createdAt"]);
  ensure(index.engineVersion === "maydan-paid-v1", "UNSUPPORTED_ENGINE");
  uuid(index.roomId);
  uuid(index.admissionId); ensure(typeof index.bindingHash === "string" && HASH.test(index.bindingHash));
  return { engineVersion: "maydan-paid-v1", roomId: index.roomId, admissionId: index.admissionId, bindingHash: index.bindingHash };
}

function roomSnapshot(value: unknown, roomCode: string, legacy: boolean): { room: Record<string, unknown>; config: Record<string, unknown>; lifecycle: string; closed: boolean } {
  const room = record(value), config = record(room.config), game = record(room.game), teams = record(config.teams);
  ensure(room.schemaVersion === 2 && room.roomCode === roomCode && Number.isSafeInteger(room.revision) && (room.revision as number) > 0
    && typeof game.lifecycle === "string" && LIFECYCLES.has(game.lifecycle), "UNSUPPORTED_ROOM");
  segment(config.releaseId); ensure(typeof config.releaseRootSha256 === "string" && HASH.test(config.releaseRootSha256)
    && typeof config.demo === "boolean" && typeof config.releaseDemoFixture === "boolean"
    && [teams.horizontal, teams.vertical].every(name => typeof name === "string" && !!name.trim() && name.length <= 40), "INVALID_CONFIG");
  ensure(config.policyVersion === undefined || config.policyVersion === 1, "UNSUPPORTED_ROOM_POLICY");
  if (legacy) {
    ensure(!Object.hasOwn(config, "paidAdmission"), "LEGACY_PAID_DISCRIMINATOR");
    ensure(config.policyVersion === undefined ? config.gameKind === undefined || config.gameKind === "huroof" : ["huroof", "categories"].includes(config.gameKind as string), "UNSUPPORTED_ROOM_POLICY");
  }
  for (const field of ["createdAt", "updatedAt", "closedAt"]) if (Object.hasOwn(room, field)) ensure(isFirestoreTimestamp(room[field]), "INVALID_TIMESTAMP");
  return { room, config, lifecycle: game.lifecycle, closed: Object.hasOwn(room, "closedAt") };
}
function expectedBinding(value: HuroofBinding, expectedProjectId: string, expectedHostUid?: string): HuroofBinding {
  assertBinding(value); uuid(value.roomId); uuid(value.admissionId);
  ensure(value.projectId === expectedProjectId, "PROJECT_MISMATCH");
  if (expectedHostUid !== undefined) { segment(expectedHostUid); ensure(value.uid === expectedHostUid, "HOST_MISMATCH"); }
  return value;
}

function startReceiptId(uid: string, intentId: string): string {
  // Exact existing intentReceiptId semantics; no new receipt is fabricated.
  return createHash("sha256").update(uid).update("\0").update(intentId).digest("hex");
}
function assertPaidLinkage(reads: Reads, roomCode: string, index: ReturnType<typeof indexEntry>, expectedProjectId: string, expectedHostUid?: string, expected?: HuroofBinding) {
  ensure(index.engineVersion === "maydan-paid-v1" && index.admissionId && index.bindingHash);
  const proof = reads.exists(coexistencePaths.proof(index.admissionId)) as HuroofProof;
  const binding = expectedBinding(record(proof).binding as HuroofBinding, expectedProjectId, expectedHostUid);
  assertProof(expected ?? binding, proof);
  ensure(binding.admissionId === index.admissionId && binding.roomId === index.roomId && admissionHash(binding) === index.bindingHash && proof.provision?.roomCode === roomCode);
  const room = roomSnapshot(reads.exists(coexistencePaths.paidRoom(index.roomId)), roomCode, false);
  reads.absent(coexistencePaths.legacyRoom(index.roomId));
  const host = hostFrom(reads, coexistencePaths.paidCollection(index.roomId, "members"), binding.uid);
  assertHostedConfig(materialRoomConfig(room.config));
  assertRoomBinding(binding, index.roomId, room.config, host);
  if (proof.state === "RESERVED") ensure(!room.closed && room.lifecycle === "LOBBY", "RESERVED_ROOM_INVALID");
  if (proof.state === "CANCELLED") ensure(room.closed && room.lifecycle === "LOBBY" && room.room.revision === proof.terminal?.toRevision, "CANCELLED_ROOM_INVALID");
  if (proof.state === "STARTED") {
    const terminal = proof.terminal!;
    ensure(room.lifecycle !== "LOBBY" && (room.room.revision as number) >= terminal.toRevision, "STARTED_ROOM_INVALID");
    const receipt = record(reads.exists(coexistencePaths.paidDocument(index.roomId, "intentReceipts", startReceiptId(binding.uid, terminal.intentId))));
    const event = record(reads.exists(coexistencePaths.paidDocument(index.roomId, "events", String(terminal.toRevision).padStart(12, "0"))));
    ensure(receipt.revision === terminal.toRevision && receipt.requestHash === terminal.requestHash
      && event.type === "START_MATCH" && event.actorUid === binding.uid && event.revision === terminal.toRevision, "START_EVIDENCE_MISMATCH");
  }
  return { proof, room };
}
function failure(error: unknown): Failure { return error instanceof DecisionFailure ? { kind: error.kind, reason: error.reason } : { kind: "conflict", reason: "INTEGRITY_FAILURE" }; }

export interface ResolveInput { roomCode: string; expectedProjectId: string; expectedHostUid?: string; snapshot: CoexistenceSnapshot }
export function resolveCoexistingRoom(input: ResolveInput): ResolutionDecision {
  try {
    code(input.roomCode);
    const reads = new Reads(input.snapshot, input.expectedProjectId), fact = reads.document(coexistencePaths.index(input.roomCode));
    if (fact.state === "absent") return { kind: "not-found" };
    ensure(fact.state === "exists");
    const index = indexEntry(fact.value);
    if (index.engineVersion === "huroof-legacy-v1") {
      const room = roomSnapshot(reads.exists(coexistencePaths.legacyRoom(index.roomId)), input.roomCode, true);
      reads.absent(coexistencePaths.paidAbsenceProbeForLegacy(index.roomId));
      hostFrom(reads, coexistencePaths.legacyMembers(index.roomId), input.expectedHostUid);
      if (room.closed || room.lifecycle === "MATCH_COMPLETE") return { kind: "terminal", reason: room.closed ? "closed" : "completed" };
    } else {
      const { proof, room } = assertPaidLinkage(reads, input.roomCode, index, input.expectedProjectId, input.expectedHostUid);
      if (proof.state === "CANCELLED" || room.closed || room.lifecycle === "MATCH_COMPLETE") return { kind: "terminal", reason: proof.state === "CANCELLED" ? "cancelled" : room.closed ? "closed" : "completed" };
    }
    return { kind: "route", route: { engineVersion: index.engineVersion, roomId: index.roomId, roomCode: input.roomCode } };
  } catch (error) { return failure(error); }
}

/** Read-set enumeration is descriptive, never an admission/provenance receipt. */
export function resolutionReadRequirements(roomCode: string, indexValue?: unknown, proofValue?: unknown): ReadRequirement[] {
  const requirements: ReadRequirement[] = [{ kind: "document", path: coexistencePaths.index(roomCode) }];
  if (indexValue === undefined) return requirements;
  const index = indexEntry(indexValue), paid = index.engineVersion === "maydan-paid-v1";
  requirements.push({ kind: "document", path: coexistencePaths.legacyRoom(index.roomId) }, { kind: "document", path: paid ? coexistencePaths.paidRoom(index.roomId) : coexistencePaths.paidAbsenceProbeForLegacy(index.roomId) }, { kind: "all-members", path: paid ? coexistencePaths.paidCollection(index.roomId, "members") : coexistencePaths.legacyMembers(index.roomId) });
  if (paid) requirements.push({ kind: "document", path: coexistencePaths.proof(index.admissionId!) });
  if (paid && proofValue !== undefined) {
    const proof = proofValue as HuroofProof;
    assertProof(expectedBinding(proof.binding, proof.binding.projectId), proof);
    if (proof.state === "STARTED") {
      requirements.push({ kind: "document", path: coexistencePaths.paidDocument(index.roomId, "intentReceipts", startReceiptId(proof.binding.uid, proof.terminal!.intentId)) }, { kind: "document", path: coexistencePaths.paidDocument(index.roomId, "events", String(proof.terminal!.toRevision).padStart(12, "0")) });
    }
  }
  return requirements;
}

export type CreateDecision = {
  operation: "create"; path: string;
  content: { kind: "document"; data: Record<string, unknown> }
    | { kind: "derive-initial-projection"; roomId: string; role: "host" | "audience" }
    | { kind: "derive-admin-summary"; roomId: string };
};
export type ProvisionDecision = Failure | { kind: "exhausted"; writes: readonly [] }
  | { kind: "terminal"; reason: "cancelled"; writes: readonly [] }
  | { kind: "replay"; writes: readonly [] }
  | { kind: "create-plan"; writes: readonly CreateDecision[] };
export interface ProvisionInput {
  expectedProjectId: string; expectedHostUid: string; binding: HuroofBinding;
  config: Record<string, unknown>; hostDisplayName: string;
  candidates: readonly string[]; snapshot: CoexistenceSnapshot;
}

function initialPaths(binding: HuroofBinding): string[] {
  return [coexistencePaths.proof(binding.admissionId), coexistencePaths.paidRoom(binding.roomId), coexistencePaths.legacyRoom(binding.roomId),
    coexistencePaths.paidDocument(binding.roomId, "members", binding.uid), coexistencePaths.paidDocument(binding.roomId, "projections", "host"), coexistencePaths.paidDocument(binding.roomId, "projections", "audience"), coexistencePaths.summary(binding.roomId)];
}
export function firstProvisionReadRequirements(binding: HuroofBinding, candidates: readonly string[]): ReadRequirement[] {
  expectedBinding(binding, binding.projectId, binding.uid); validCandidates(candidates);
  return [...initialPaths(binding).map(path => ({ kind: "document" as const, path })),
    { kind: "all-members", path: coexistencePaths.paidCollection(binding.roomId, "members") },
    { kind: "document", path: coexistencePaths.attestation }, { kind: "document", path: coexistencePaths.release(binding.releaseId) },
    ...candidates.map(candidate => ({ kind: "document" as const, path: coexistencePaths.index(candidate) }))];
}
function validCandidates(candidates: readonly string[]): void {
  ensure(Array.isArray(candidates) && candidates.length > 0 && candidates.length <= 12 && new Set(candidates).size === candidates.length, "INVALID_CANDIDATES");
  candidates.forEach(code);
}
function readinessMatches(reads: Reads, binding: HuroofBinding): void {
  const attestation = record(reads.exists(coexistencePaths.attestation)), root = record(reads.exists(coexistencePaths.release(binding.releaseId)));
  // Existing assertReadiness consistency semantics only; supplied fields do not
  // establish issuer authenticity, rights, editorial approval, or live supply.
  ensure(attestation.issuer === "huroof-functions" && attestation.projectId === binding.projectId && attestation.releaseId === binding.releaseId
    && attestation.rootSha256 === binding.releaseRootHash && attestation.selectorVersion === binding.selectorVersion
    && attestation.policyVersion === binding.readinessPolicyVersion && attestation.capabilityStateHash === binding.capabilityHash
    && root.immutable === true && root.demoFixture === false && root.documentRootSha256 === binding.releaseRootHash, "READINESS_MISMATCH");
}
function detached<T>(value: T): T { return JSON.parse(canonicalJson(value)) as T; }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function planPaidProvision(input: ProvisionInput): ProvisionDecision {
  try {
    segment(input.expectedHostUid);
    const binding = expectedBinding(input.binding, input.expectedProjectId, input.expectedHostUid);
    assertHostedConfig(input.config);
    ensure(admissionHash(materialRoomConfig(input.config)) === binding.configHash && typeof input.hostDisplayName === "string" && !!input.hostDisplayName.trim() && input.hostDisplayName.length <= 24, "PROVISION_INPUT_MISMATCH");
    const reads = new Reads(input.snapshot, input.expectedProjectId), proofFact = reads.document(coexistencePaths.proof(binding.admissionId));
    if (proofFact.state === "exists") {
      const proof = proofFact.value as HuroofProof; assertProof(binding, proof);
      if (proof.state === "CANCELLED" && proof.provision === null) {
        ensure(proof.terminal?.fromRevision === 0, "TOMBSTONE_INTEGRITY_FAILURE");
        initialPaths(binding).slice(1).forEach(path => reads.absent(path));
        ensure(reads.members(coexistencePaths.paidCollection(binding.roomId, "members")).length === 0, "TOMBSTONE_INTEGRITY_FAILURE");
        return { kind: "terminal", reason: "cancelled", writes: [] };
      }
      ensure(proof.provision);
      const roomCode = proof.provision.roomCode, index = indexEntry(reads.exists(coexistencePaths.index(roomCode)));
      assertPaidLinkage(reads, roomCode, index, input.expectedProjectId, input.expectedHostUid, binding);
      return proof.state === "CANCELLED" ? { kind: "terminal", reason: "cancelled", writes: [] } : { kind: "replay", writes: [] };
    }
    ensure(proofFact.state === "absent"); validCandidates(input.candidates);
    initialPaths(binding).slice(1).forEach(path => reads.absent(path));
    ensure(reads.members(coexistencePaths.paidCollection(binding.roomId, "members")).length === 0, "ORPHAN_MEMBERSHIP");
    readinessMatches(reads, binding);
    // Read every finite candidate before returning ANY create plan. Even a
    // malformed occupied document is reserved; retry needs a fresh snapshot.
    const occupancy = input.candidates.map(candidate => reads.document(coexistencePaths.index(candidate)));
    const selected = occupancy.findIndex(fact => fact.state === "absent");
    if (selected < 0) return { kind: "exhausted", writes: [] };
    const roomCode = input.candidates[selected], timestamp = { instruction: "SERVER_TIMESTAMP" };
    const proof: HuroofProof = { version: 1, binding: detached(binding), state: "RESERVED", provision: { version: 1, kind: "PROVISION", roomCode, configHash: binding.configHash }, terminal: null };
    assertProof(binding, proof);
    const room = { schemaVersion: 2, roomCode, revision: 1,
      game: { lifecycle: "LOBBY", ruleSet: "v2", entitledTeam: "horizontal", attempt: "initial", questionScores: { horizontal: 0, vertical: 0 }, currentRound: 0, roundOutcomeHistory: [] },
      config: { ...detached(input.config), paidAdmission: detached(binding), showQuestionOnAudience: true }, manualParticipants: [], questionCursor: 0, createdAt: timestamp, updatedAt: timestamp };
    const host = { uid: binding.uid, role: "host", displayName: input.hostDisplayName.trim(), ready: true, active: true, joinedAt: timestamp };
    assertRoomBinding(binding, binding.roomId, room.config, host);
    const document = (path: string, data: Record<string, unknown>): CreateDecision => ({ operation: "create", path, content: { kind: "document", data } });
    // Projection/summary derivations are explicit unresolved adapter work, not
    // fabricated projection payloads or executable authorizing documents.
    return freeze({ kind: "create-plan", writes: [
      document(coexistencePaths.proof(binding.admissionId), proof as unknown as Record<string, unknown>),
      document(coexistencePaths.paidRoom(binding.roomId), room), document(coexistencePaths.paidDocument(binding.roomId, "members", binding.uid), host),
      document(coexistencePaths.index(roomCode), { engineVersion: "maydan-paid-v1", roomId: binding.roomId, admissionId: binding.admissionId, bindingHash: admissionHash(binding), createdAt: timestamp }),
      { operation: "create", path: coexistencePaths.paidDocument(binding.roomId, "projections", "host"), content: { kind: "derive-initial-projection", roomId: binding.roomId, role: "host" } },
      { operation: "create", path: coexistencePaths.paidDocument(binding.roomId, "projections", "audience"), content: { kind: "derive-initial-projection", roomId: binding.roomId, role: "audience" } },
      { operation: "create", path: coexistencePaths.summary(binding.roomId), content: { kind: "derive-admin-summary", roomId: binding.roomId } },
    ] } as const);
  } catch (error) { return failure(error); }
}
