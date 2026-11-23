import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { admissionHash, type HuroofBinding, type HuroofProof } from "../src/admission/huroof-protocol.cjs";
import { coexistencePaths as paths, firstProvisionReadRequirements, isFirestoreTimestamp, planPaidProvision, resolutionReadRequirements, resolveCoexistingRoom, type CoexistenceSnapshot, type DocumentFact, type ProvisionInput, type ResolveInput } from "../src/admission/huroof-coexistence";

const project = "huroof-a3ee7", uid = "host-1", roomId = "11111111-1111-4111-8111-111111111111", admissionId = "22222222-2222-4222-8222-222222222222", roomCode = "ABCDEFGH";
const timestamp = { seconds: 1_000, nanoseconds: 123 };
const config = { policyVersion: 1, demo: false, releaseDemoFixture: false, releaseId: "release-1", releaseRootSha256: "a".repeat(64), gameKind: "huroof", modality: "classic", categories: ["category-1"], mapPresentation: "ordinary", questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: "الأول", vertical: "الثاني" }, mode: "classic", difficulty: "mixed", labelledColours: false };
const binding: HuroofBinding = {
  version: 1, admissionId, roomId, identityId: "identity-1", projectId: project, uid, engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: "logical-1", requestKey: "request-0001", requestHash: "d".repeat(64), catalogReleaseId: "catalog-1", catalogRootHash: "b".repeat(64), validationReceiptId: "receipt-1", releaseId: config.releaseId, releaseRootHash: config.releaseRootSha256, selectorVersion: "selector-v1", readinessPolicyVersion: "policy-v1", capabilityHash: "c".repeat(64), configHash: admissionHash(config), predecessorId: null,
};
const exists = (path: string, value: unknown): DocumentFact => ({ path, state: "exists", value });
const absent = (path: string): DocumentFact => ({ path, state: "absent" });
const clone = <T>(value: T): T => structuredClone(value);
const host = () => ({ id: uid, value: { uid, role: "host", active: true, ready: true, displayName: "المضيف" } });
function proofFor(state: HuroofProof["state"] = "RESERVED", provisioned = true): HuroofProof {
  return { version: 1, binding: clone(binding), state,
    provision: provisioned ? { version: 1, kind: "PROVISION", roomCode, configHash: binding.configHash } : null,
    terminal: state === "RESERVED" ? null : { version: 1, kind: state === "STARTED" ? "START" : "CANCEL", actorUid: state === "STARTED" ? uid : "internal-canceller", intentId: "intent-1", requestHash: "e".repeat(64), fromRevision: provisioned ? 1 : 0, toRevision: provisioned ? 2 : 1 } };
}
const index = () => ({ engineVersion: "maydan-paid-v1", roomId, admissionId, bindingHash: admissionHash(binding), createdAt: clone(timestamp) });
function paidInput(state: HuroofProof["state"] = "RESERVED"): ResolveInput {
  const proof = proofFor(state);
  const room = { schemaVersion: 2, roomCode, revision: state === "RESERVED" ? 1 : 2, game: { lifecycle: state === "STARTED" ? "ROUND_SETUP" : "LOBBY" }, config: { ...clone(config), paidAdmission: clone(binding), showQuestionOnAudience: true }, ...(state === "CANCELLED" ? { closedAt: clone(timestamp) } : {}) };
  const snapshot: CoexistenceSnapshot = { projectId: project, documents: [exists(`roomCodes/${roomCode}`, index()), exists(`maydanRoomsV1/${roomId}`, room), absent(`rooms/${roomId}`), exists(`maydanPaidAdmissionsV1/${admissionId}`, proof)], memberships: [{ path: `maydanRoomsV1/${roomId}/members`, state: "complete", documents: [host()] }] };
  if (state === "STARTED") snapshot.documents = [...snapshot.documents,
    exists(`maydanRoomsV1/${roomId}/intentReceipts/${createHash("sha256").update(uid).update("\0").update("intent-1").digest("hex")}`, { revision: 2, requestHash: "e".repeat(64) }),
    exists(`maydanRoomsV1/${roomId}/events/000000000002`, { type: "START_MATCH", actorUid: uid, revision: 2 })];
  return { expectedProjectId: project, roomCode, snapshot };
}
function legacyInput(legacyRoomId = roomId): ResolveInput {
  return { expectedProjectId: project, roomCode, snapshot: { projectId: project, documents: [
    exists(`roomCodes/${roomCode}`, { roomId: legacyRoomId, createdAt: clone(timestamp) }),
    exists(`rooms/${legacyRoomId}`, { schemaVersion: 2, roomCode, revision: 1, game: { lifecycle: "LOBBY" }, config: { ...clone(config), demo: true, releaseDemoFixture: true } }), absent(`maydanRoomsV1/${legacyRoomId}`)],
    memberships: [{ path: `rooms/${legacyRoomId}/members`, state: "complete", documents: [host(), { id: "guest-1", value: { uid: "guest-1", role: "player", active: true } }] }] } };
}
function valueAt(snapshot: CoexistenceSnapshot, path: string): Record<string, any> {
  const fact = snapshot.documents.find(fact => fact.path === path);
  assert.ok(fact?.state === "exists"); return fact.value as Record<string, any>;
}
function replace(snapshot: CoexistenceSnapshot, path: string, fact: DocumentFact): void { snapshot.documents = snapshot.documents.map(item => item.path === path ? fact : item); }
const candidates = ["OCCUPIED", "FREE0001"];
function initialInput(): ProvisionInput {
  const snapshot: CoexistenceSnapshot = { projectId: project, documents: [
    absent(`maydanPaidAdmissionsV1/${admissionId}`), absent(`maydanRoomsV1/${roomId}`), absent(`rooms/${roomId}`), absent(`maydanRoomsV1/${roomId}/members/${uid}`),
    absent(`maydanRoomsV1/${roomId}/projections/host`), absent(`maydanRoomsV1/${roomId}/projections/audience`), absent(`maydanAdminRoomSummariesV1/${roomId}`),
    exists("maydanRuntimeV1/catalogSelectorAttestation", { issuer: "huroof-functions", projectId: project, releaseId: binding.releaseId, rootSha256: binding.releaseRootHash, selectorVersion: binding.selectorVersion, policyVersion: binding.readinessPolicyVersion, capabilityStateHash: binding.capabilityHash }),
    exists(`releases/${binding.releaseId}`, { immutable: true, demoFixture: false, documentRootSha256: binding.releaseRootHash }),
    exists("roomCodes/OCCUPIED", { malformed: "reserved anyway" }), absent("roomCodes/FREE0001")],
    memberships: [{ path: `maydanRoomsV1/${roomId}/members`, state: "complete", documents: [] }] };
  return { expectedProjectId: project, expectedHostUid: uid, binding: clone(binding), config: clone(config), hostDisplayName: "المضيف", candidates: [...candidates], snapshot };
}
function replayInput(state: HuroofProof["state"] = "RESERVED"): ProvisionInput {
  const resolution = paidInput(state);
  return { ...initialInput(), candidates: [], snapshot: resolution.snapshot };
}

test("fixed paid paths retain immutable UUID and exclude request-selected namespaces", () => {
  assert.equal(paths.paidRoom(roomId), `maydanRoomsV1/${roomId}`);
  assert.equal(paths.proof(admissionId), `maydanPaidAdmissionsV1/${admissionId}`);
  assert.equal(paths.summary(roomId), `maydanAdminRoomSummariesV1/${roomId}`);
  assert.equal(paths.attestation, "maydanRuntimeV1/catalogSelectorAttestation");
  for (const collection of ["members", "projections", "presence", "intentReceipts", "events"] as const) assert.equal(paths.paidCollection(roomId, collection), `maydanRoomsV1/${roomId}/${collection}`);
  for (const invalid of [`maydan_v1_${roomId}`, "room/path", "..", "ABCDEFAB-1111-4111-8111-111111111111", "11111111-1111-1111-8111-111111111111"]) assert.throws(() => paths.paidRoom(invalid));
  for (const invalid of ["qaClosureReceipts", "unknown", "../members"]) assert.throws(() => paths.paidCollection(roomId, invalid as any));
  for (const invalid of ["..", ".", "host/another", "", "x".repeat(201)]) assert.throws(() => paths.paidDocument(roomId, "members", invalid));
  for (const invalid of ["abcd1234", "ABCDEFG", "ABCDEFGH/room", true]) assert.throws(() => paths.index(invalid as string));
});

test("Firestore timestamps reject labels/coercion and enforce exact seconds/nanoseconds range", () => {
  assert.equal(isFirestoreTimestamp({ seconds: -62_135_596_800, nanoseconds: 0 }), true);
  assert.equal(isFirestoreTimestamp({ seconds: 253_402_300_799, nanoseconds: 999_999_999 }), true);
  for (const invalid of [null, true, 1000, new Date(), "2026-10-07", { approved: true }, { seconds: "1000", nanoseconds: 0 }, { seconds: 1.1, nanoseconds: 0 }, { seconds: Infinity, nanoseconds: 0 }, { seconds: 0, nanoseconds: -1 }, { seconds: 0, nanoseconds: 1e9 }, { seconds: 0, nanoseconds: 0.1 }, { seconds: -62_135_596_801, nanoseconds: 0 }, { seconds: 253_402_300_800, nanoseconds: 0 }, { instruction: "SERVER_TIMESTAMP" }]) assert.equal(isFirestoreTimestamp(invalid), false);
});

test("positive legacy guest resolution needs full membership but no supplied host hint or paid bypass", () => {
  const input = legacyInput();
  assert.deepEqual(resolveCoexistingRoom(input), { kind: "route", route: { engineVersion: "huroof-legacy-v1", roomId, roomCode } });
  assert.equal(JSON.stringify(resolveCoexistingRoom(input)).includes(uid), false, "public route exposes no host UID");
  assert.equal(resolveCoexistingRoom({ ...input, expectedHostUid: "intruder" }).kind, "conflict");
  valueAt(input.snapshot, `rooms/${roomId}`).config.paidAdmission = undefined;
  assert.equal(resolveCoexistingRoom(input).kind, "conflict", "paid discriminator presence cannot select legacy");
});

test("genuine legacy Firestore auto ID routes without UUID conversion while paid creation stays UUID-only", () => {
  const legacyRoomId = "N7x1Aa0Bb2Cc3Dd4Ee5F";
  assert.equal(legacyRoomId.length, 20);
  const input = legacyInput(legacyRoomId);
  assert.deepEqual(resolveCoexistingRoom(input), { kind: "route", route: { engineVersion: "huroof-legacy-v1", roomId: legacyRoomId, roomCode } });
  assert.equal(paths.legacyRoom(legacyRoomId), `rooms/${legacyRoomId}`);
  assert.equal(paths.legacyMembers(legacyRoomId), `rooms/${legacyRoomId}/members`);
  assert.equal(paths.paidAbsenceProbeForLegacy(legacyRoomId), `maydanRoomsV1/${legacyRoomId}`);
  assert.ok(resolutionReadRequirements(roomCode, { roomId: legacyRoomId, createdAt: timestamp }).some(read => read.path === `maydanRoomsV1/${legacyRoomId}`));
  assert.throws(() => paths.paidRoom(legacyRoomId));
  assert.throws(() => paths.paidCollection(legacyRoomId, "members"));
  const paid = paidInput(); valueAt(paid.snapshot, `roomCodes/${roomCode}`).roomId = legacyRoomId;
  assert.equal(resolveCoexistingRoom(paid).kind, "conflict", "typed paid index never falls back to legacy");
  const creation = initialInput(); creation.binding.roomId = legacyRoomId;
  assert.equal(planPaidProvision(creation).kind, "conflict");
  const collision = clone(input); replace(collision.snapshot, `maydanRoomsV1/${legacyRoomId}`, exists(`maydanRoomsV1/${legacyRoomId}`, {}));
  assert.equal(resolveCoexistingRoom(collision).kind, "conflict");
  for (const valid of ["A", "x".repeat(128), "legacy_id-1"]) assert.equal(resolveCoexistingRoom(legacyInput(valid)).kind, "route");
  for (const invalid of [".", "..", "legacy.id", "legacy:id", "legacy/other", "legacy\\other", "", "x".repeat(129)]) {
    assert.throws(() => paths.legacyRoom(invalid));
    assert.throws(() => paths.legacyMembers(invalid));
    assert.throws(() => paths.paidAbsenceProbeForLegacy(invalid));
    assert.equal(resolveCoexistingRoom(legacyInput(invalid)).kind, "conflict");
  }
  assert.equal(resolveCoexistingRoom(legacyInput(roomId)).kind, "route", "safe UUID-shaped legacy segment remains supported");
});

test("all supported legacy lifecycles route positively; closed and complete remain terminal", () => {
  for (const lifecycle of ["LOBBY", "ROUND_SETUP", "CELL_SELECTION", "LETTER_REVEAL", "QUESTION_READING", "FIRST_ANSWER", "OPPONENT_CHANCE", "QUESTION_FAILED", "CELL_AWARDED", "PATH_CHECK", "ROUND_COMPLETE", "PAUSED", "CORRECTION"]) {
    const input = legacyInput(); valueAt(input.snapshot, `rooms/${roomId}`).game.lifecycle = lifecycle;
    assert.equal(resolveCoexistingRoom(input).kind, "route", lifecycle);
  }
  const completed = legacyInput(); valueAt(completed.snapshot, `rooms/${roomId}`).game.lifecycle = "MATCH_COMPLETE";
  assert.deepEqual(resolveCoexistingRoom(completed), { kind: "terminal", reason: "completed" });
  const closed = legacyInput(); valueAt(closed.snapshot, `rooms/${roomId}`).closedAt = timestamp;
  assert.deepEqual(resolveCoexistingRoom(closed), { kind: "terminal", reason: "closed" });
});

test("legacy classification fails closed on unknown schema/lifecycle/config/index and opposite collision", () => {
  const edits = [
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).schemaVersion = 3; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).game.lifecycle = "CLOSED"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).roomCode = "ZZZZZZZZ"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).revision = "1"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).config.demo = "true"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).config.releaseRootSha256 = "bad"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).config.teams.horizontal = " "; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).config.policyVersion = 2; },
    (input: ResolveInput) => { valueAt(input.snapshot, `rooms/${roomId}`).closedAt = true; },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).engineVersion = "huroof-legacy-v1"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).createdAt = "old means approved"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).uid = uid; },
    (input: ResolveInput) => replace(input.snapshot, `maydanRoomsV1/${roomId}`, exists(`maydanRoomsV1/${roomId}`, {})),
  ];
  for (const edit of edits) { const input = legacyInput(); edit(input); assert.equal(resolveCoexistingRoom(input).kind, "conflict"); }
});

test("missing, unavailable, incomplete and duplicate read facts never become absence", () => {
  const input = legacyInput();
  assert.deepEqual(resolveCoexistingRoom({ ...input, snapshot: { ...input.snapshot, documents: [absent(`roomCodes/${roomCode}`)] } }), { kind: "not-found" });
  for (const path of input.snapshot.documents.map(fact => fact.path)) for (const state of ["missing", "unavailable", "incomplete"] as const) {
    const changed = clone(input);
    if (state === "missing") changed.snapshot.documents = changed.snapshot.documents.filter(fact => fact.path !== path);
    else replace(changed.snapshot, path, { path, state });
    assert.equal(resolveCoexistingRoom(changed).kind, "unavailable", `${path}/${state}`);
  }
  const duplicate = clone(input); duplicate.snapshot.documents = [...duplicate.snapshot.documents, duplicate.snapshot.documents[0]];
  assert.equal(resolveCoexistingRoom(duplicate).kind, "conflict");
  assert.equal(resolveCoexistingRoom({ ...input, expectedProjectId: "wrong-project" }).kind, "conflict");
});

test("complete host query rejects missing/partial/duplicate/malformed/zero/multiple host sets", () => {
  for (const input of [legacyInput(), paidInput()]) {
    for (const state of ["incomplete", "unavailable"] as const) {
      const changed = clone(input); changed.snapshot.memberships = [{ path: input.snapshot.memberships[0].path, state }];
      assert.equal(resolveCoexistingRoom(changed).kind, "unavailable");
    }
    assert.equal(resolveCoexistingRoom({ ...input, snapshot: { ...input.snapshot, memberships: [] } }).kind, "unavailable");
    for (const documents of [[], [host(), host()], [{ id: "other-id", value: host().value }], [{ id: uid, value: { ...host().value, active: "true" } }], [{ id: uid, value: { ...host().value, role: "ADMIN" } }], [{ id: uid, value: { ...host().value, active: false } }], [host(), { id: "host-2", value: { uid: "host-2", role: "host", active: true } }]]) {
      const changed = clone(input); changed.snapshot.memberships = [{ path: input.snapshot.memberships[0].path, state: "complete", documents }];
      assert.equal(resolveCoexistingRoom(changed).kind, "conflict");
    }
  }
});

test("positive paid reserved/started route preserves original UUID/hash and hides host identity", () => {
  for (const state of ["RESERVED", "STARTED"] as const) {
    const input = paidInput(state);
    assert.deepEqual(resolveCoexistingRoom(input), { kind: "route", route: { engineVersion: "maydan-paid-v1", roomId, roomCode } });
    assert.equal(JSON.stringify(resolveCoexistingRoom(input)).includes(uid), false);
    assert.equal(resolveCoexistingRoom({ ...input, expectedHostUid: "intruder" }).kind, "conflict");
  }
  assert.deepEqual(resolveCoexistingRoom(paidInput("CANCELLED")), { kind: "terminal", reason: "cancelled" });
  const completed = paidInput("STARTED"); valueAt(completed.snapshot, `maydanRoomsV1/${roomId}`).game.lifecycle = "MATCH_COMPLETE";
  assert.deepEqual(resolveCoexistingRoom(completed), { kind: "terminal", reason: "completed" });
});

test("paid ID/hash/project/host/code substitutions never fall back to matching legacy data", () => {
  const edits = [
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).engineVersion = "maydan-paid-v2"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).bindingHash = "f".repeat(64); },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).admissionId = roomId; },
    (input: ResolveInput) => { valueAt(input.snapshot, `roomCodes/${roomCode}`).roomId = admissionId; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).binding.projectId = "other-project"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).binding.uid = "other-host"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).binding.admissionId = roomId; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).binding.roomId = admissionId; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).provision.roomCode = "ZZZZZZZZ"; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanRoomsV1/${roomId}`).config.paidAdmission.requestHash = "f".repeat(64); },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanRoomsV1/${roomId}`).config.questionSeconds = 30; },
    (input: ResolveInput) => { valueAt(input.snapshot, `maydanRoomsV1/${roomId}`).game.lifecycle = "ROUND_SETUP"; },
    (input: ResolveInput) => replace(input.snapshot, `rooms/${roomId}`, exists(`rooms/${roomId}`, valueAt(legacyInput().snapshot, `rooms/${roomId}`))),
  ];
  for (const edit of edits) { const input = paidInput(); edit(input); assert.notEqual(resolveCoexistingRoom(input).kind, "route"); }
});

test("started paid read set requires exact original START receipt/event linkage", () => {
  const input = paidInput("STARTED");
  for (const path of input.snapshot.documents.map(fact => fact.path)) {
    const changed = clone(input); changed.snapshot.documents = changed.snapshot.documents.filter(fact => fact.path !== path);
    assert.equal(resolveCoexistingRoom(changed).kind, "unavailable", path);
  }
  for (const field of ["revision", "requestHash"]) {
    const changed = clone(input), receipt = changed.snapshot.documents.find(fact => fact.path.includes("/intentReceipts/"))!;
    valueAt(changed.snapshot, receipt.path)[field] = field === "revision" ? 3 : "f".repeat(64);
    assert.equal(resolveCoexistingRoom(changed).kind, "conflict");
  }
  for (const field of ["revision", "actorUid", "type"]) {
    const changed = clone(input); valueAt(changed.snapshot, `maydanRoomsV1/${roomId}/events/000000000002`)[field] = "wrong";
    assert.equal(resolveCoexistingRoom(changed).kind, "conflict");
  }
});

test("read requirements enumerate exact fixed paths and explicit full membership queries", () => {
  assert.deepEqual(resolutionReadRequirements(roomCode), [{ kind: "document", path: `roomCodes/${roomCode}` }]);
  const paid = resolutionReadRequirements(roomCode, index(), proofFor("STARTED"));
  assert.equal(paid.length, 7);
  assert.ok(paid.some(read => read.kind === "all-members" && read.path === `maydanRoomsV1/${roomId}/members`));
  assert.ok(paid.some(read => read.path.endsWith("/events/000000000002")));
  assert.ok(paid.some(read => read.path === `maydanPaidAdmissionsV1/${admissionId}`));
  const first = firstProvisionReadRequirements(binding, candidates);
  assert.equal(first.length, 12);
  assert.deepEqual(first.filter(read => read.path.startsWith("roomCodes/")), candidates.map(candidate => ({ kind: "document", path: `roomCodes/${candidate}` })));
  assert.ok(first.some(read => read.path === `maydanAdminRoomSummariesV1/${roomId}`));
  assert.ok(first.some(read => read.path === `rooms/${roomId}`));
});

test("first plan skips malformed occupied index and emits seven fixed create-only instructions", () => {
  const input = initialInput(), originalHash = admissionHash(input.binding), original = clone(input);
  const result = planPaidProvision(input);
  assert.equal(result.kind, "create-plan"); assert.ok(result.kind === "create-plan");
  assert.equal(result.writes.length, 7);
  assert.equal(new Set(result.writes.map(write => write.path)).size, 7);
  assert.ok(result.writes.every(write => write.operation === "create"));
  assert.ok(result.writes.some(write => write.path === "roomCodes/FREE0001"));
  assert.ok(!result.writes.some(write => write.path.startsWith("rooms/") || write.path.includes("qaClosureReceipts")));
  const indexWrite = result.writes.find(write => write.path === "roomCodes/FREE0001")!;
  assert.ok(indexWrite.content.kind === "document");
  assert.equal(indexWrite.content.data.roomId, roomId);
  assert.equal(indexWrite.content.data.bindingHash, originalHash);
  assert.equal(isFirestoreTimestamp(indexWrite.content.data.createdAt), false, "write instruction is not a read timestamp or approval");
  assert.deepEqual(input, original);
  input.binding.uid = "later-mutated"; (input.config.teams as Record<string, unknown>).horizontal = "later-mutated";
  const proofWrite = result.writes.find(write => write.path.startsWith("maydanPaidAdmissionsV1/"))!;
  assert.ok(proofWrite.content.kind === "document");
  assert.equal((proofWrite.content.data.binding as HuroofBinding).uid, uid);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.writes) && Object.isFrozen(proofWrite.content.data));
});

test("first plan requires every absence/readiness/candidate fact before any create", () => {
  const original = initialInput();
  for (const fact of original.snapshot.documents) for (const state of ["missing", "unavailable", "incomplete"] as const) {
    const input = clone(original);
    if (state === "missing") input.snapshot.documents = input.snapshot.documents.filter(item => item.path !== fact.path);
    else replace(input.snapshot, fact.path, { path: fact.path, state });
    assert.equal(planPaidProvision(input).kind, "unavailable", `${fact.path}/${state}`);
  }
  for (const fact of original.snapshot.documents.filter(fact => fact.state === "absent" && !fact.path.startsWith("roomCodes/"))) {
    const input = clone(original); replace(input.snapshot, fact.path, exists(fact.path, {}));
    assert.equal(planPaidProvision(input).kind, "conflict", fact.path);
  }
  const orphan = clone(original); orphan.snapshot.memberships = [{ path: `maydanRoomsV1/${roomId}/members`, state: "complete", documents: [host()] }];
  assert.equal(planPaidProvision(orphan).kind, "conflict");
  const incomplete = clone(original); incomplete.snapshot.memberships = [{ path: `maydanRoomsV1/${roomId}/members`, state: "incomplete" }];
  assert.equal(planPaidProvision(incomplete).kind, "unavailable");
});

test("readiness/config/owner mismatches deny plans; boolean labels are not alternate approvals", () => {
  for (const field of ["issuer", "projectId", "releaseId", "rootSha256", "selectorVersion", "policyVersion", "capabilityStateHash"]) {
    const input = initialInput(); valueAt(input.snapshot, paths.attestation)[field] = "wrong"; assert.equal(planPaidProvision(input).kind, "conflict", field);
  }
  for (const patch of [{ immutable: "true" }, { demoFixture: true }, { documentRootSha256: "f".repeat(64) }, { approved: true }]) {
    const input = initialInput(); replace(input.snapshot, `releases/${binding.releaseId}`, exists(`releases/${binding.releaseId}`, patch)); assert.equal(planPaidProvision(input).kind, "conflict");
  }
  for (const change of [
    (input: ProvisionInput) => { input.expectedHostUid = "intruder"; },
    (input: ProvisionInput) => { input.expectedHostUid = undefined as unknown as string; },
    (input: ProvisionInput) => { input.expectedProjectId = "other-project"; },
    (input: ProvisionInput) => { input.config.questionSeconds = 30; },
    (input: ProvisionInput) => { input.config.paidAdmission = binding; },
    (input: ProvisionInput) => { input.hostDisplayName = " "; },
  ]) { const input = initialInput(); change(input); assert.equal(planPaidProvision(input).kind, "conflict"); }
});

test("finite candidate exhaustion reserves every occupied shape; fresh retry rereads occupancy", () => {
  for (const occupied of [null, {}, true, { roomId: "bad" }, { engineVersion: "future" }, { roomId, createdAt: timestamp }]) {
    const input = initialInput(); replace(input.snapshot, "roomCodes/FREE0001", exists("roomCodes/FREE0001", occupied));
    assert.deepEqual(planPaidProvision(input), { kind: "exhausted", writes: [] });
  }
  const before = initialInput(); assert.equal(planPaidProvision(before).kind, "create-plan");
  const fresh = clone(before); replace(fresh.snapshot, "roomCodes/FREE0001", exists("roomCodes/FREE0001", {}));
  assert.equal(planPaidProvision(fresh).kind, "exhausted", "no cached allocation/claim of contention proof");
  for (const list of [[], ["FREE0001", "FREE0001"], ["bad"], Array.from({ length: 13 }, (_, index) => String(index).padStart(8, "0"))]) assert.equal(planPaidProvision({ ...initialInput(), candidates: list }).kind, "conflict");
});

test("retained reserved/started replay validates original index and emits zero writes", () => {
  for (const state of ["RESERVED", "STARTED"] as const) {
    const input = replayInput(state);
    assert.deepEqual(planPaidProvision(input), { kind: "replay", writes: [] });
    for (const field of ["bindingHash", "engineVersion", "roomId", "admissionId", "createdAt"]) {
      const changed = clone(input); valueAt(changed.snapshot, `roomCodes/${roomCode}`)[field] = "wrong";
      assert.equal(planPaidProvision(changed).kind, "conflict", `${state}/${field}`);
    }
    const absentIndex = clone(input); replace(absentIndex.snapshot, `roomCodes/${roomCode}`, absent(`roomCodes/${roomCode}`));
    assert.equal(planPaidProvision(absentIndex).kind, "conflict", "no repair or new code");
    const missingIndex = clone(input); missingIndex.snapshot.documents = missingIndex.snapshot.documents.filter(fact => fact.path !== `roomCodes/${roomCode}`);
    assert.equal(planPaidProvision(missingIndex).kind, "unavailable");
  }
});

test("null-provision cancellation is terminal with no candidate/readiness allocation", () => {
  const input = initialInput(); replace(input.snapshot, `maydanPaidAdmissionsV1/${admissionId}`, exists(`maydanPaidAdmissionsV1/${admissionId}`, proofFor("CANCELLED", false)));
  input.candidates = [];
  input.snapshot.documents = input.snapshot.documents.filter(fact => !fact.path.startsWith("roomCodes/") && fact.path !== paths.attestation && !fact.path.startsWith("releases/"));
  assert.deepEqual(planPaidProvision(input), { kind: "terminal", reason: "cancelled", writes: [] });
  const badRevision = clone(input); valueAt(badRevision.snapshot, `maydanPaidAdmissionsV1/${admissionId}`).terminal = { ...proofFor("CANCELLED", false).terminal, fromRevision: 1, toRevision: 2 };
  assert.equal(planPaidProvision(badRevision).kind, "conflict");
  const orphan = clone(input); replace(orphan.snapshot, `maydanRoomsV1/${roomId}`, exists(`maydanRoomsV1/${roomId}`, {}));
  assert.equal(planPaidProvision(orphan).kind, "conflict");
});

test("provisioned cancellation retains original index and requires closed linked lobby", () => {
  const input = replayInput("CANCELLED");
  assert.deepEqual(planPaidProvision(input), { kind: "terminal", reason: "cancelled", writes: [] });
  const before = clone(input.snapshot); planPaidProvision(input); assert.deepEqual(input.snapshot, before);
  for (const patch of [{ revision: 1 }, { game: { lifecycle: "ROUND_SETUP" } }, { closedAt: null }]) {
    const changed = clone(input); Object.assign(valueAt(changed.snapshot, `maydanRoomsV1/${roomId}`), patch); assert.equal(planPaidProvision(changed).kind, "conflict");
  }
  const absentIndex = clone(input); replace(absentIndex.snapshot, `roomCodes/${roomCode}`, absent(`roomCodes/${roomCode}`));
  assert.equal(planPaidProvision(absentIndex).kind, "conflict");
});

test("sandbox import of exact helper/protocol has no application I/O or top-level hash work", async (t) => {
  if (typeof vm.SyntheticModule !== "function") { t.skip("vm.SyntheticModule requires --experimental-vm-modules"); return; }
  const context = vm.createContext({});
  let hashCalls = 0;
  const cryptoModule = new vm.SyntheticModule(["createHash"], function () { this.setExport("createHash", (...args: Parameters<typeof createHash>) => { hashCalls++; return createHash(...args); }); }, { context });
  const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const protocol = new vm.SourceTextModule(compile("services/enta/server/src/admission/huroof-protocol.cts"), { context });
  const module = new vm.SourceTextModule(compile("services/enta/server/src/admission/huroof-coexistence.ts"), { context });
  await protocol.link(specifier => { assert.equal(specifier, "node:crypto"); return cryptoModule; });
  await module.link(specifier => {
    if (specifier === "node:crypto") return cryptoModule;
    assert.equal(specifier, "./huroof-protocol.cjs", `forbidden application dependency: ${specifier}`); return protocol;
  });
  await module.evaluate();
  assert.equal(hashCalls, 0);
  const exports = module.namespace as Record<string, unknown>;
  assert.equal(typeof exports.resolveCoexistingRoom, "function");
  assert.equal(typeof exports.planPaidProvision, "function");
  // No process, fs, network, SDK, timer or native loader is available in this
  // import sandbox. Loader source reads above are explicit test-only I/O.
});
