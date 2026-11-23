import { FieldValue, getFirestore, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { App } from "firebase-admin/app";
import { HttpsError } from "firebase-functions/https";
import { randomBytes } from "node:crypto";
import { admissionHash, assertBinding, assertHostedConfig, assertProof, assertRoomBinding, materialRoomConfig, type HuroofBinding, type HuroofProof } from "../../services/enta/server/src/admission/huroof-protocol.cjs";
import { initialGameState } from "../../src/features/game/domain/lifecycle.js";
import { intentReceiptId, isRoomClosed, projectRoom, type CanonicalMember, type CanonicalRoom } from "./game.js";
import type { HuroofFirestorePort } from "../../services/enta/server/src/admission/huroof-worker.js";

export type { HuroofBinding, HuroofProof };
const pinnedContext = Symbol("project-pinned-huroof-firestore");
export interface PinnedHuroofFirestore { readonly db: Firestore; readonly projectId: string; readonly [pinnedContext]: true }
export function pinnedHuroofFirestore(app: App): PinnedHuroofFirestore {
  const projectId = admissionProject();
  if (app.options.projectId !== projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  return { db: getFirestore(app), projectId, [pinnedContext]: true };
}
export function admissionProject(): string {
  const configured = process.env.HUROOF_ADMISSION_PROJECT_ID;
  const actual = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!configured || actual !== configured || configured === "huroof-a3ee7") throw new HttpsError("failed-precondition", "ADMISSION_PROJECT_UNAVAILABLE");
  return configured;
}

export function isolatedDemoRoom(room: CanonicalRoom): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" && (process.env.GCLOUD_PROJECT ?? "").startsWith("demo-") &&
    room.config.demo === true && room.config.releaseDemoFixture === true;
}

export async function readRoomAdmission(db: Firestore, tx: Transaction, roomId: string, room: CanonicalRoom, members: readonly CanonicalMember[]): Promise<HuroofProof | null> {
  if (isolatedDemoRoom(room)) return null;
  const binding = room.config.paidAdmission;
  if (!binding) throw new HttpsError("failed-precondition", "PAID_ADMISSION_REQUIRED");
  const raw = await tx.get(db.doc(`paidAdmissions/${binding.admissionId}`));
  const host = members.find((member) => member.uid === binding.uid);
  try {
    if (binding.projectId !== admissionProject() || !raw.exists || !host) throw new Error("ADMISSION_PROJECT_OR_OWNER_MISMATCH");
    const proof = raw.data() as HuroofProof;
    assertProof(binding, proof);
    assertRoomBinding(binding, roomId, room.config, host);
    if (proof.state === "CANCELLED" || isRoomClosed(room)) throw new Error("ADMISSION_CANCELLED");
    if (proof.state === "RESERVED" && room.game.lifecycle !== "LOBBY") throw new Error("UNSTARTED_ROOM_PLAYABLE");
    return proof;
  } catch (reason) { throw new HttpsError("failed-precondition", reason instanceof Error ? reason.message : "ADMISSION_INVALID"); }
}

export function startedProof(proof: HuroofProof, actorUid: string, intentId: string, requestHash: string, fromRevision: number, toRevision: number): HuroofProof {
  if (proof.state !== "RESERVED" || actorUid !== proof.binding.uid) throw new HttpsError("failed-precondition", "ADMISSION_START_DENIED");
  const next: HuroofProof = { ...proof, state: "STARTED", terminal: { version: 1, kind: "START", actorUid, intentId, requestHash, fromRevision, toRevision } };
  assertProof(proof.binding, next);
  return next;
}

/** Internal SDK function only. No callable/HTTP export or PostgreSQL operation. */
export async function provisionHuroofLobby(context: PinnedHuroofFirestore, binding: HuroofBinding, config: CanonicalRoom["config"], displayName: string): Promise<HuroofProof> {
  const { db, projectId } = context;
  assertBinding(binding); assertHostedConfig(config);
  if (context[pinnedContext] !== true || projectId !== binding.projectId || binding.projectId !== admissionProject() || admissionHash(materialRoomConfig(config)) !== binding.configHash ||
      !displayName.trim() || displayName.length > 24) throw new Error("PROVISION_BINDING_MISMATCH");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const candidates = Array.from({ length: 12 }, () => Array.from(randomBytes(8), (byte) => alphabet[byte % alphabet.length]).join(""));
  return db.runTransaction(async (tx) => {
    const proofRef = db.doc(`paidAdmissions/${binding.admissionId}`), roomRef = db.doc(`rooms/${binding.roomId}`);
    const [existing, roomRaw, readiness, root] = await Promise.all([
      tx.get(proofRef), tx.get(roomRef), tx.get(db.doc("runtime/catalogSelectorAttestation")), tx.get(db.doc(`releases/${binding.releaseId}`)),
    ]);
    if (existing.exists) {
      const proof = existing.data() as HuroofProof; assertProof(binding, proof);
      // A permanent full-binding tombstone wins even when this task was delayed.
      if (proof.state === "CANCELLED") return proof;
      const host = await tx.get(roomRef.collection("members").doc(binding.uid));
      if (!roomRaw.exists || !host.exists) throw new Error("PROVISION_INTEGRITY_INCIDENT");
      assertRoomBinding(binding, binding.roomId, (roomRaw.data() as CanonicalRoom).config, host.data() as CanonicalMember);
      return proof;
    }
    if (roomRaw.exists) throw new Error("ROOM_WITHOUT_ADMISSION_INCIDENT");
    assertReadiness(binding, readiness.data(), root.data());
    let roomCode: string | undefined;
    for (const candidate of candidates) {
      if (!(await tx.get(db.doc(`roomCodes/${candidate}`))).exists) { roomCode = candidate; break; }
    }
    if (!roomCode) throw new Error("ROOM_CODE_EXHAUSTED");
    const proof: HuroofProof = { version: 1, binding, state: "RESERVED", provision: { version: 1, kind: "PROVISION", roomCode, configHash: binding.configHash }, terminal: null };
    const room: CanonicalRoom = { schemaVersion: 2, roomCode, revision: 1, game: initialGameState(), config: { ...config, paidAdmission: binding, showQuestionOnAudience: true }, manualParticipants: [], questionCursor: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    const host: CanonicalMember = { uid: binding.uid, role: "host", displayName, ready: true, active: true, joinedAt: FieldValue.serverTimestamp() };
    tx.create(proofRef, proof); tx.create(roomRef, room); tx.create(roomRef.collection("members").doc(binding.uid), host);
    tx.create(db.doc(`roomCodes/${roomCode}`), { roomId: binding.roomId, createdAt: FieldValue.serverTimestamp() });
    tx.set(roomRef.collection("projections").doc("host"), projectRoom(binding.roomId, room, [host], "host", host.uid, Date.now()));
    tx.set(roomRef.collection("projections").doc("audience"), projectRoom(binding.roomId, room, [host], "audience", undefined, Date.now()));
    return proof;
  });
}

export function assertReadiness(binding: HuroofBinding, readiness: Record<string, unknown> | undefined, root: Record<string, unknown> | undefined): void {
  if (!readiness || readiness.issuer !== "huroof-functions" || readiness.projectId !== binding.projectId || readiness.releaseId !== binding.releaseId ||
      readiness.rootSha256 !== binding.releaseRootHash || readiness.selectorVersion !== binding.selectorVersion ||
      readiness.policyVersion !== binding.readinessPolicyVersion || readiness.capabilityStateHash !== binding.capabilityHash ||
      !root || root.immutable !== true || root.demoFixture !== false || root.documentRootSha256 !== binding.releaseRootHash)
    throw new Error("ADMISSION_READINESS_MISMATCH");
}

/** Trusted cancellation only; absent proof creates an irreversible full-binding tombstone. */
export async function cancelHuroofAdmission(context: PinnedHuroofFirestore, binding: HuroofBinding, cancellationId: string): Promise<HuroofProof> {
  const { db, projectId } = context;
  assertBinding(binding);
  if (context[pinnedContext] !== true || projectId !== binding.projectId || binding.projectId !== admissionProject() || !/^[A-Za-z0-9._:-]{1,120}$/u.test(cancellationId)) throw new Error("CANCEL_BINDING_MISMATCH");
  return db.runTransaction(async (tx) => {
    const proofRef = db.doc(`paidAdmissions/${binding.admissionId}`), roomRef = db.doc(`rooms/${binding.roomId}`);
    const [raw, roomRaw, memberRaw] = await Promise.all([tx.get(proofRef), tx.get(roomRef), tx.get(roomRef.collection("members").doc(binding.uid))]);
    let proof: HuroofProof | undefined;
    if (raw.exists) { proof = raw.data() as HuroofProof; assertProof(binding, proof); }
    if (proof?.state === "STARTED") return proof;
    if (proof?.state === "CANCELLED") return proof;
    if (!proof && roomRaw.exists) throw new Error("ROOM_WITHOUT_ADMISSION_INCIDENT");
    if (proof && (!roomRaw.exists || !memberRaw.exists)) throw new Error("CANCEL_INTEGRITY_INCIDENT");
    const room = roomRaw.data() as CanonicalRoom | undefined;
    if (room) {
      assertRoomBinding(binding, binding.roomId, room.config, memberRaw.data() as CanonicalMember);
      if (room.game.lifecycle !== "LOBBY" || isRoomClosed(room)) throw new Error("CANCEL_NON_LOBBY_INCIDENT");
    }
    const fromRevision = room?.revision ?? 0;
    const cancelled: HuroofProof = { version: 1, binding, state: "CANCELLED", provision: proof?.provision ?? null, terminal: { version: 1, kind: "CANCEL", actorUid: "internal-canceller", intentId: cancellationId, requestHash: admissionHash({ binding, cancellationId }), fromRevision, toRevision: fromRevision + 1 } };
    assertProof(binding, cancelled);
    tx.set(proofRef, cancelled);
    if (room) tx.set(roomRef, { ...room, revision: fromRevision + 1, closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    // All readers lose access to live projections in this same transaction.
    const closed = { roomId: binding.roomId, revision: fromRevision + 1, closed: true, status: "closed" };
    tx.set(roomRef.collection("projections").doc("host"), closed);
    tx.set(roomRef.collection("projections").doc("audience"), closed);
    return cancelled;
  });
}

/** Direct Admin read; state strings alone are never financial evidence. */
export function createHuroofFirestorePort(app: App, displayName: string): HuroofFirestorePort {
  const context = pinnedHuroofFirestore(app), db = context.db;
  return {
    projectId: context.projectId,
    provision: (binding, config) => provisionHuroofLobby(context, binding, config as CanonicalRoom["config"], displayName),
    cancel: (binding, cancellationId) => cancelHuroofAdmission(context, binding, cancellationId),
    async read(binding) {
      assertBinding(binding);
      if (binding.projectId !== context.projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
      return db.runTransaction(async (tx) => {
        const roomRef = db.doc(`rooms/${binding.roomId}`);
        const [raw, roomRaw, hostRaw] = await Promise.all([tx.get(db.doc(`paidAdmissions/${binding.admissionId}`)), tx.get(roomRef), tx.get(roomRef.collection("members").doc(binding.uid))]);
        if (!raw.exists) {
          if (roomRaw.exists) throw new Error("ROOM_WITHOUT_ADMISSION_INCIDENT");
          return null;
        }
        const proof = raw.data() as HuroofProof; assertProof(binding, proof);
        if (proof.state === "CANCELLED" && proof.provision === null) {
          if (roomRaw.exists || proof.terminal?.fromRevision !== 0) throw new Error("TOMBSTONE_INTEGRITY_INCIDENT");
          return proof;
        }
        if (!roomRaw.exists || !hostRaw.exists) throw new Error("TERMINAL_ROOM_PROOF_MISSING");
        const room = roomRaw.data() as CanonicalRoom;
        assertRoomBinding(binding, binding.roomId, room.config, hostRaw.data() as CanonicalMember);
        if (proof.provision?.roomCode !== room.roomCode) throw new Error("ROOM_CODE_PROOF_MISMATCH");
        if (proof.state === "RESERVED" && (room.game.lifecycle !== "LOBBY" || isRoomClosed(room))) throw new Error("RESERVED_ROOM_PROOF_INVALID");
        if (proof.state === "CANCELLED" && (!isRoomClosed(room) || room.game.lifecycle !== "LOBBY" || room.revision !== proof.terminal?.toRevision)) throw new Error("CANCEL_ROOM_PROOF_INVALID");
        if (proof.state === "STARTED") {
          const terminal = proof.terminal!;
          const [receiptRaw, eventRaw] = await Promise.all([tx.get(roomRef.collection("intentReceipts").doc(intentReceiptId(binding.uid, terminal.intentId))), tx.get(roomRef.collection("events").doc(String(terminal.toRevision).padStart(12, "0")))]);
          if (room.game.lifecycle === "LOBBY" || room.revision < terminal.toRevision || receiptRaw.data()?.revision !== terminal.toRevision || receiptRaw.data()?.requestHash !== terminal.requestHash ||
              eventRaw.data()?.type !== "START_MATCH" || eventRaw.data()?.actorUid !== binding.uid || eventRaw.data()?.revision !== terminal.toRevision) throw new Error("START_EVIDENCE_MISSING");
        }
        return proof;
      });
    },
  };
}
