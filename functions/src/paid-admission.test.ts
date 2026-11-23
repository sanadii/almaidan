import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { admissionHash, type HuroofBinding } from "../../services/enta/server/src/admission/huroof-protocol.cjs";

const gated = process.env.INT5B_FIREBASE_EMULATOR_TEST === "1";
if (gated && (!/^127\.0\.0\.1:\d+$/u.test(process.env.FIRESTORE_EMULATOR_HOST ?? "") || !/^127\.0\.0\.1:\d+$/u.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? ""))) throw new Error("INT-5B requires explicit loopback Firestore and Auth emulators");

test("INT-5B actual Firestore transactions and existing callable guards", { skip: !gated }, async (t) => {
  const projectId = "demo-int5b-admission";
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId });
  process.env.FUNCTIONS_EMULATOR = "true";
  process.env.HUROOF_ADMISSION_PROJECT_ID = projectId;
  const { getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const callables = await import("./index.js");
  const { pinnedHuroofFirestore, provisionHuroofLobby, cancelHuroofAdmission, createHuroofFirestorePort } = await import("./paid-admission.js");
  const app = getApps()[0], db = getFirestore(app), context = pinnedHuroofFirestore(app);
  assert.equal(app.options.projectId, projectId, "initializeApp must retain the configured project for pinned Auth and Firestore");
  const uid = `host-${randomUUID()}`;
  await getAuth(app).createUser({ uid, email: `${uid}@example.invalid`, password: "synthetic-password-123", emailVerified: true });
  const releaseId = `release-${randomUUID()}`, releaseRootHash = "a".repeat(64), category = "fixture-category";
  const config = { policyVersion: 1 as const, demo: false, releaseDemoFixture: false, releaseId, releaseRootSha256: releaseRootHash, gameKind: "huroof" as const, modality: "classic" as const, categories: [category], mapPresentation: "ordinary" as const, questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: "أ", vertical: "ب" }, mode: "classic" as const, difficulty: "mixed", labelledColours: false };
  const makeBinding = (): HuroofBinding => ({ version: 1, admissionId: randomUUID(), identityId: "synthetic-identity", projectId, uid, engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: randomUUID(), roomId: randomUUID(), requestKey: randomUUID(), requestHash: "b".repeat(64), catalogReleaseId: "synthetic-catalog", catalogRootHash: "c".repeat(64), validationReceiptId: "synthetic-receipt", releaseId, releaseRootHash, selectorVersion: "synthetic-selector-v1", readinessPolicyVersion: "synthetic-policy-v1", capabilityHash: "d".repeat(64), configHash: admissionHash(config), predecessorId: null });
  const letters = [..."ابتثجحخدذرزسشصضطظعغفقكلمنهوي"];
  const batch = db.batch();
  batch.set(db.doc(`releases/${releaseId}`), { immutable: true, demoFixture: false, documentRootSha256: releaseRootHash, approvedCount: letters.length * 4 });
  batch.set(db.doc(`releases/${releaseId}/inventory/${category}`), { immutable: true, categoryId: category, approvedCount: letters.length * 4 });
  for (const [index, letter] of letters.entries()) for (let alternative = 0; alternative < 4; alternative++) {
    const id = `q-${index}-${alternative}`;
    batch.set(db.doc(`releases/${releaseId}/questions/${id}`), { id, categoryId: category, modality: "classic", targetLetter: letter, answerConceptId: `concept-${id}`, headerAr: "اختبار", promptAr: `سؤال ${index} ${alternative}`, canonicalAnswer: `${letter} جواب ${index} ${alternative}`, acceptedAnswers: [], review: { approved: true }, moderation: { status: "approved" } });
  }
  const sample = makeBinding();
  batch.set(db.doc("runtime/catalogSelectorAttestation"), { issuer: "huroof-functions", projectId, releaseId, rootSha256: releaseRootHash, selectorVersion: sample.selectorVersion, policyVersion: sample.readinessPolicyVersion, capabilityStateHash: sample.capabilityHash });
  await batch.commit();
  const signedIn = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `${uid}@example.invalid`, password: "synthetic-password-123", returnSecureToken: true }) });
  assert.equal(signedIn.status, 200);
  const { idToken } = await signedIn.json() as { idToken: string }; assert.ok(idToken);
  const actor = { uid, token: { aud: projectId, firebase: { sign_in_provider: "password" } } };
  const rawRequest = { headers: { authorization: `Bearer ${idToken}` } };
  const start = async (binding: HuroofBinding, revision = 1, intentId = `start-${binding.admissionId}`) => callables.submitGameIntent.run({ auth: actor, rawRequest, data: { roomId: binding.roomId, intent: { type: "START_MATCH", intentId, expectedRevision: revision, payload: {} } } } as never);
  const provision = (binding: HuroofBinding) => provisionHuroofLobby(context, binding, config, "مضيف");
  const port = createHuroofFirestorePort(app, "مضيف");

  await t.test("start wins: commit proof, lost-response replay after progression and cancellation no-op", async () => {
    const binding = makeBinding(); await provision(binding);
    await start(binding); assert.equal((await port.read(binding))?.state, "STARTED");
    await callables.submitGameIntent.run({ auth: actor, data: { roomId: binding.roomId, intent: { type: "ROUND_READY", intentId: "ready-1", expectedRevision: 2, payload: {} } } } as never);
    const retry = await start(binding); assert.ok(retry); assert.equal(retry.replayed, true); assert.equal(retry.revision, 2);
    assert.equal((await cancelHuroofAdmission(context, binding, "cancel-1")).state, "STARTED");
    assert.equal((await provision(binding)).state, "STARTED");
    const resolved = await callables.createRoom.run({ auth: actor, rawRequest, data: { admissionId: binding.admissionId } } as never);
    assert.ok(resolved); assert.equal(resolved.roomId, binding.roomId);
  });
  await t.test("revoked and unsupported validated sessions cannot change exact paid callable documents", async () => {
    const binding = makeBinding(); await provision(binding);
    const roomRef = db.doc(`rooms/${binding.roomId}`), proofRef = db.doc(`paidAdmissions/${binding.admissionId}`);
    const before = { room: (await roomRef.get()).data(), proof: (await proofRef.get()).data(), events: (await roomRef.collection("events").get()).size, receipts: (await roomRef.collection("intentReceipts").get()).size };
    const auth = getAuth(app), original = auth.verifyIdToken;
    try {
      for (const provider of ["revoked", "anonymous", "custom"] as const) {
        auth.verifyIdToken = async (raw, checkRevoked) => {
          assert.equal(raw, idToken); assert.equal(checkRevoked, true);
          if (provider === "revoked") throw new Error("auth/id-token-revoked");
          const validated = await original.call(auth, raw, true);
          return { ...validated, firebase: { ...validated.firebase, sign_in_provider: provider } };
        };
        await assert.rejects(start(binding), /SESSION_INVALID/);
        await assert.rejects(callables.createRoom.run({ auth: actor, rawRequest, data: { admissionId: binding.admissionId } } as never), /SESSION_INVALID/);
      }
    } finally { auth.verifyIdToken = original; }
    assert.deepEqual({ room: (await roomRef.get()).data(), proof: (await proofRef.get()).data(), events: (await roomRef.collection("events").get()).size, receipts: (await roomRef.collection("intentReceipts").get()).size }, before);
  });
  await t.test("provision/cancel lost response replay and outage never manufacture terminal evidence", async () => {
    const binding = makeBinding();
    await provision(binding); // Simulate a committed response lost before the caller received it.
    const first = await port.read(binding); assert.deepEqual(await provision(binding), first);
    await cancelHuroofAdmission(context, binding, "cancel-response-lost");
    assert.deepEqual(await cancelHuroofAdmission(context, binding, "cancel-response-lost"), await port.read(binding));
    const missing = makeBinding();
    assert.equal(await port.read(missing), null);
    const before = (await db.doc(`paidAdmissions/${missing.admissionId}`).get()).exists;
    const transaction = db.runTransaction;
    try {
      db.runTransaction = async () => { throw new Error("FIRESTORE_OUTAGE"); };
      await assert.rejects(port.read(missing), /FIRESTORE_OUTAGE/);
    } finally { db.runTransaction = transaction; }
    assert.equal((await db.doc(`paidAdmissions/${missing.admissionId}`).get()).exists, before);
  });
  await t.test("cancel wins: start/join/deadline denied and projections contain no live question", async () => {
    const binding = makeBinding(), proof = await provision(binding);
    await cancelHuroofAdmission(context, binding, "cancel-2");
    assert.equal((await port.read(binding))?.state, "CANCELLED");
    await assert.rejects(start(binding), /CANCELLED|closed/);
    await assert.rejects(callables.joinRoom.run({ auth: actor, data: { roomCode: proof.provision!.roomCode } } as never), /CANCELLED|closed/);
    await assert.rejects(callables.syncRoomDeadline.run({ auth: actor, data: { roomId: binding.roomId } } as never), /CANCELLED|closed/);
    const projection = (await db.doc(`rooms/${binding.roomId}/projections/host`).get()).data();
    assert.deepEqual(Object.keys(projection!).sort(), ["closed", "revision", "roomId", "status"]);
  });
  await t.test("cancellation tombstone beats delayed provision and stable retries", async () => {
    const binding = makeBinding();
    await cancelHuroofAdmission(context, binding, "cancel-before-provision");
    assert.equal((await provision(binding)).state, "CANCELLED");
    assert.equal((await port.read(binding))?.state, "CANCELLED");
    assert.equal((await db.doc(`rooms/${binding.roomId}`).get()).exists, false);
  });
  await t.test("stale revision, changed readiness and direct/QA calls cannot start or provision", async () => {
    const binding = makeBinding(); await provision(binding);
    await assert.rejects(start(binding, 2), /START_DENIED/);
    await assert.rejects(callables.createRoom.run({ auth: actor, data: {} } as never));
    await assert.rejects(callables.createRoom.run({ auth: actor, data: { admissionId: binding.admissionId, qaChallengePermitId: "qa-forged" } } as never), /ADMISSION_REQUIRED/);
    await db.doc("runtime/catalogSelectorAttestation").update({ capabilityStateHash: "e".repeat(64) });
    await assert.rejects(start(binding), /READINESS/);
    assert.equal((await db.doc(`paidAdmissions/${binding.admissionId}`).get()).data()?.state, "RESERVED");
    await db.doc("runtime/catalogSelectorAttestation").update({ capabilityStateHash: binding.capabilityHash });
    await getAuth(app).updateUser(uid, { emailVerified: false });
    await assert.rejects(start(binding), /VERIFIED_ACCOUNT/);
    await getAuth(app).updateUser(uid, { emailVerified: true });
  });
  await t.test("real concurrent start/cancel has exactly one irreversible Firestore winner", async () => {
    const binding = makeBinding(); await provision(binding);
    const outcomes = await Promise.allSettled([start(binding), cancelHuroofAdmission(context, binding, "cancel-race")]);
    const proof = await port.read(binding);
    assert.ok(proof?.state === "STARTED" || proof?.state === "CANCELLED");
    assert.equal(outcomes[1].status, "fulfilled");
    const room = (await db.doc(`rooms/${binding.roomId}`).get()).data()!;
    assert.equal(Boolean(room.closedAt), proof.state === "CANCELLED");
  });
  await t.test("missing/mismatched proof and forged state-only terminal evidence are denied", async () => {
    const binding = makeBinding(); await provision(binding);
    await db.doc(`paidAdmissions/${binding.admissionId}`).update({ binding: { ...binding, uid: "intruder" } });
    await assert.rejects(start(binding), /MISMATCH/);
    await assert.rejects(port.read(binding), /MISMATCH/);
    await db.doc(`paidAdmissions/${binding.admissionId}`).set({ version: 1, binding, state: "STARTED", provision: { version: 1, kind: "PROVISION", roomCode: "ABCDEFGH", configHash: binding.configHash }, terminal: { version: 1, kind: "START", actorUid: uid, intentId: "forged", requestHash: "f".repeat(64), fromRevision: 1, toRevision: 2 } });
    await assert.rejects(port.read(binding), /ROOM_CODE|START_EVIDENCE/);
    await db.doc(`paidAdmissions/${binding.admissionId}`).delete();
    await assert.rejects(callables.resumeRoom.run({ auth: actor, data: { roomId: binding.roomId } } as never), /ADMISSION_PROOF|ADMISSION_INVALID|MISMATCH/);
    await assert.rejects(cancelHuroofAdmission(context, binding, "missing-proof"), /WITHOUT_ADMISSION/);
  });
});
