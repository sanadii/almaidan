import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { admissionHash, assertBinding, assertProof, assertRoomBinding, type HuroofBinding, type HuroofProof } from "../src/admission/huroof-protocol.cjs";
import { reserveHuroofMatch as productionReserve, reserveHuroofMatchForTest, type HuroofReserveStore, type HuroofReserveTransaction, type HuroofReadiness, type HuroofReserveCommand } from "../src/admission/huroof-reserve";
import { runHuroofAdmissionJob, type HuroofLease, type HuroofFirestorePort } from "../src/admission/huroof-worker";

const principal = { projectId: "fresh-huroof", uid: "host-1", verifiedAccount: true, anonymous: false, email: "host@example.invalid" };
const reserveHuroofMatch = (store: HuroofReserveStore, account: typeof principal, command: HuroofReserveCommand) => reserveHuroofMatchForTest(store, account, command, async () => {});
const config = { policyVersion: 1, demo: false, releaseDemoFixture: false, releaseId: "release-1", releaseRootSha256: "a".repeat(64), gameKind: "huroof", modality: "classic", categories: ["category-1"], mapPresentation: "ordinary", questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: "الأول", vertical: "الثاني" }, mode: "classic", difficulty: "mixed", labelledColours: false };
const readiness: HuroofReadiness = { catalogReleaseId: "catalog-1", catalogRootHash: "b".repeat(64), validationReceiptId: "receipt-1", releaseId: config.releaseId, releaseRootHash: config.releaseRootSha256, selectorVersion: "selector-v1", readinessPolicyVersion: "policy-v1", capabilityHash: "c".repeat(64) };

class MemoryStore implements HuroofReserveStore {
  available = 1n; held = 0n; debt = 0n; reads = 0; writes = 0; fail = false;
  rows = new Map<string, { binding: HuroofBinding; intentHash: string }>();
  tail = Promise.resolve();
  async transaction<T>(work: (tx: HuroofReserveTransaction) => Promise<T>): Promise<T> {
    const before = this.tail; let release!: () => void;
    this.tail = new Promise<void>((done) => { release = done; }); await before;
    const checkpoint = { available: this.available, held: this.held, writes: this.writes, rows: new Map(this.rows) };
    try {
      return await work({
        lockWallet: async () => ({ identityId: "identity-1", available: this.available, debt: this.debt }),
        findRequest: async (_identity, key) => this.rows.get(key) ?? null,
        findLogicalMatch: async (_identity, logical) => [...this.rows.values()].some((row) => row.binding.logicalMatchId === logical),
        assertPredecessor: async () => {},
        readReadiness: async () => { this.reads++; return readiness; },
        reserve: async (binding, intentHash) => {
          this.available--; this.held++; this.writes++; this.rows.set(binding.requestKey, { binding, intentHash });
          if (this.fail) throw new Error("SYNTHETIC_COMMIT_FAILURE");
        },
      });
    } catch (reason) { Object.assign(this, checkpoint); throw reason; } finally { release(); }
  }
}
const command = (logical = "logical-1", key = "request-0001") => ({ logicalMatchId: logical, requestKey: key, config });
const proofFor = (binding: HuroofBinding, state: HuroofProof["state"]): HuroofProof => ({ version: 1, binding, state, provision: { version: 1, kind: "PROVISION", roomCode: "ABCDEFGH", configHash: binding.configHash }, terminal: state === "RESERVED" ? null : { version: 1, kind: state === "STARTED" ? "START" : "CANCEL", actorUid: state === "STARTED" ? binding.uid : "internal-canceller", intentId: "intent-1", requestHash: "d".repeat(64), fromRevision: 1, toRevision: 2 } });

test("production reserve fails closed until a real Huroof readiness policy is reviewed", async () => {
  const store = new MemoryStore();
  await assert.rejects(productionReserve(store, principal, command()), /HUROOF_READINESS_POLICY_UNAPPROVED/);
  assert.equal(store.available, 1n); assert.equal(store.rows.size, 0);
});

test("parallel last-credit reserve: one hold, stable same-key retry before readiness rotation", async () => {
  const store = new MemoryStore();
  const results = await Promise.allSettled([reserveHuroofMatch(store, principal, command()), reserveHuroofMatch(store, principal, command("logical-2", "request-0002"))]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(store.available, 0n); assert.equal(store.held, 1n); assert.equal(store.writes, 1);
  const first = results[0]; assert.equal(first.status, "fulfilled");
  const retry = await reserveHuroofMatch(store, principal, command());
  assert.equal(retry.replayed, true); assert.equal(store.reads, 1);
  if (first.status === "fulfilled") assert.deepEqual(retry.binding, first.value.binding);
});
test("changed-key logical match and changed-body same-key retries conflict without effects", async () => {
  const store = new MemoryStore(); await reserveHuroofMatch(store, principal, command());
  await assert.rejects(reserveHuroofMatch(store, principal, command("logical-1", "request-0003")), /LOGICAL_MATCH_ALREADY_RESERVED/);
  await assert.rejects(reserveHuroofMatch(store, principal, command("logical-2")), /IDEMPOTENCY_KEY_CONFLICT/);
  assert.equal(store.writes, 1);
});
test("verified host, debt, invalid config, QA and failed commit cannot allocate a hold", async () => {
  for (const untrusted of [{ ...principal, anonymous: true }, { ...principal, verifiedAccount: false }]) await assert.rejects(reserveHuroofMatch(new MemoryStore(), untrusted, command()), /VERIFIED_ACCOUNT_REQUIRED/);
  const store = new MemoryStore(); store.debt = 1n;
  await assert.rejects(reserveHuroofMatch(store, principal, command()), /WALLET_DEBT/);
  for (const invalid of [{ demo: true }, { mode: "STUDENT" }, { qaAdmission: { permitId: "qa-1" } }, { questionSeconds: 999 }, { extraClientFlag: true }]) await assert.rejects(reserveHuroofMatch(new MemoryStore(), principal, { ...command(), config: { ...config, ...invalid } }));
  store.debt = 0n; store.fail = true;
  await assert.rejects(reserveHuroofMatch(store, principal, command()), /SYNTHETIC_COMMIT_FAILURE/);
  assert.equal(store.available, 1n); assert.equal(store.held, 0n); assert.equal(store.rows.size, 0);
});
test("proof rejects wrong project/owner/room/pins and state-only financial claims", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  const proof = proofFor(binding, "STARTED"); assertProof(binding, proof);
  for (const field of ["projectId", "uid", "roomId", "releaseRootHash", "configHash", "identityId"] as const) assert.throws(() => assertProof(binding, { ...proof, binding: { ...binding, [field]: "wrong" } }), /MISMATCH/);
  assert.throws(() => assertProof(binding, { ...proof, terminal: null }), /TERMINAL/);
  assert.throws(() => assertProof(binding, { ...proof, terminal: { ...proof.terminal!, actorUid: "intruder" } }), /START_PROOF/);
  assert.throws(() => assertBinding({ ...binding, roomId: "room/path" }), /BINDING/);
  assertRoomBinding(binding, binding.roomId, { ...config, paidAdmission: binding }, { uid: principal.uid, role: "host", active: true });
  assert.throws(() => assertRoomBinding(binding, binding.roomId, { ...config, paidAdmission: binding, questionSeconds: 99 }, { uid: principal.uid, role: "host", active: true }), /ROOM_ADMISSION/);
});

test("worker keeps absent/RESERVED proof pending, settles authenticated terminal and discards stale fence", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  const lease: HuroofLease = { jobId: "job-1", leaseOwner: "worker-1", leaseVersion: 1, binding, config };
  let proof: HuroofProof | null = null; let settled: HuroofProof | null | undefined;
  const port: HuroofFirestorePort = { projectId: binding.projectId, read: async () => proof, provision: async () => (proof = proofFor(binding, "RESERVED")), cancel: async () => (proof = proofFor(binding, "CANCELLED")) };
  const claimer = { claim: async () => lease }, settler = { finish: async (_lease: HuroofLease, terminal: HuroofProof | null) => { settled = terminal; return true; } };
  assert.equal(await runHuroofAdmissionJob(claimer, settler, port, "worker-1"), "pending"); assert.equal(settled, null);
  proof = proofFor(binding, "STARTED");
  assert.equal(await runHuroofAdmissionJob(claimer, settler, port, "worker-1"), "settled"); assert.deepEqual(settled, proof);
  assert.equal(await runHuroofAdmissionJob(claimer, { finish: async () => false }, port, "worker-old"), "stale");
  await assert.rejects(runHuroofAdmissionJob(claimer, settler, { ...port, read: async () => { throw new Error("FIRESTORE_OUTAGE"); } }, "worker-1"), /FIRESTORE_OUTAGE/);
});
test("lost provisioning response/crash never calls terminal posting; tombstone retry settles cancellation", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  const lease = { jobId: "job", leaseOwner: "worker", leaseVersion: 1, binding, config };
  let proof: HuroofProof | null = null, finishes = 0;
  const port: HuroofFirestorePort = { projectId: binding.projectId, read: async () => proof, provision: async () => { proof = proofFor(binding, "RESERVED"); throw new Error("LOST_RESPONSE"); }, cancel: async () => (proof = proofFor(binding, "CANCELLED")) };
  const settler = { finish: async () => { finishes++; return true; } };
  await assert.rejects(runHuroofAdmissionJob({ claim: async () => lease }, settler, port, "worker"), /LOST_RESPONSE/); assert.equal(finishes, 0);
  assert.equal(await runHuroofAdmissionJob({ claim: async () => lease }, settler, port, "worker", { cancel: true }), "settled"); assert.equal(finishes, 1);
});
test("draft SQL preserves Enta branch, explicit-null checks, fixed privilege and wallet-first settlement", () => {
  const sql = readFileSync("services/enta/server/prisma/migrations/20261003100000_int5b_huroof_admission/migration.sql", "utf8");
  assert.match(sql, /"engine"='ENTA'.*"operation"='PAID_ENTA_CLASSIC'/);
  assert.match(sql, /"engine"='HUROOF'.*"operation"='HOSTED_HUROOF'/);
  assert.match(sql, /"huroofCatalogReleaseId" IS NOT NULL/); assert.match(sql, /Admission_room_project_owner_fkey/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/); assert.match(sql, /job\."leaseVersion" IS DISTINCT FROM p_fence/);
  assert.match(sql, /Wallet -> Admission -> Reservation -> outbox/); assert.match(sql, /HuroofAdmissionProof_settlement_invariant/);
  assert.doesNotMatch(sql, /GRANT (?:ALL|INSERT|UPDATE|DELETE).*TO enta_huroof_/);
  const app = readFileSync("services/enta/server/src/app.ts", "utf8"); assert.doesNotMatch(app, /reserveHuroofMatch|huroof-worker/);
  assert.equal(admissionHash({ b: 2, a: "أ" }), admissionHash({ a: "أ", b: 2 }));
});

test("typed proof requires explicit null or complete provision and safe numeric revisions", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  for (const state of ["STARTED", "CANCELLED"] as const) {
    const proof = proofFor(binding, state);
    for (const candidate of [
      { ...proof, version: "1" }, { ...proof, provision: undefined }, { ...proof, provision: false },
      { ...proof, provision: { ...proof.provision, version: "1" } }, { ...proof, provision: { ...proof.provision, roomCode: "" } },
      { ...proof, terminal: { ...proof.terminal, version: "1" } }, { ...proof, terminal: { ...proof.terminal, actorUid: "" } },
      { ...proof, terminal: { ...proof.terminal, intentId: "bad/path" } },
      { ...proof, terminal: { ...proof.terminal, fromRevision: "1" } }, { ...proof, terminal: { ...proof.terminal, toRevision: "2" } },
      { ...proof, terminal: { ...proof.terminal, fromRevision: Number.MAX_SAFE_INTEGER, toRevision: Number.MAX_SAFE_INTEGER + 1 } },
    ]) assert.throws(() => assertProof(binding, candidate as HuroofProof));
  }
});

test("numeric provision roomCode is rejected for STARTED and provisioned CANCELLED", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  for (const state of ["STARTED", "CANCELLED"] as const) {
    const proof = proofFor(binding, state);
    assert.throws(() => assertProof(binding, { ...proof, provision: { ...proof.provision!, roomCode: 12345678 } } as unknown as HuroofProof), /PROVISION_PROOF_INVALID/);
    assert.doesNotThrow(() => assertProof(binding, { ...proof, provision: { ...proof.provision!, roomCode: "12345678" } }));
  }
});

test("every worker I/O and posting response-loss boundary retains a retryable hold", async () => {
  const { binding } = await reserveHuroofMatch(new MemoryStore(), principal, command());
  const lease = { jobId: "job", leaseOwner: "worker", leaseVersion: 1, binding, config };
  for (const boundary of ["read", "provision", "cancel", "readback", "finish"] as const) {
    let proof: HuroofProof | null = null, reads = 0, finishes = 0;
    const port: HuroofFirestorePort = {
      projectId: binding.projectId,
      read: async () => { reads++; if (boundary === "read" || (boundary === "readback" && reads > 1)) throw new Error("LOST_RESPONSE"); return proof; },
      provision: async () => { proof = proofFor(binding, "RESERVED"); if (boundary === "provision") throw new Error("LOST_RESPONSE"); return proof; },
      cancel: async () => { proof = proofFor(binding, "CANCELLED"); if (boundary === "cancel") throw new Error("LOST_RESPONSE"); return proof; },
    };
    const settler = { finish: async () => { finishes++; if (boundary === "finish") throw new Error("LOST_RESPONSE"); return true; } };
    await assert.rejects(runHuroofAdmissionJob({ claim: async () => lease }, settler, port, "worker", { cancel: boundary !== "provision" }), /LOST_RESPONSE/);
    assert.equal(finishes, boundary === "finish" ? 1 : 0);
  }
});
