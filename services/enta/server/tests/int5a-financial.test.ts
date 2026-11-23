import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startEntaClassicPaidMatch, startEntaClassicPaidMatchForTest, type EntaClassicStartStore, type EntaClassicStartTransaction, type StoredAdmission } from "../src/admission/enta-classic-start";
import { applyLedgerEffect, reconcileLedger, reconcileLedgerEntries, type WalletBalances, type WalletEffect } from "../src/wallet/ledger";
import type { ReceiptPolicyInput, ReceiptPolicyVerifier } from "../src/wallet/financial-policy";
import { grantInitialFreeCredit, type InitialGrantStore, type InitialGrantTransaction } from "../src/wallet/initial-free-grant";
import { principalFromClaims } from "../src/identity";

const projectId = "new-enta-test-project";
const identityId = "identity-1";
const verifiedPrincipal = { projectId, uid: "uid-1", anonymous: false, verifiedAccount: true, email: "verified@example.test" };
const receipt: ReceiptPolicyInput = {
  projectId, identityId, releaseId: "release-test", rootHash: "a".repeat(64), receiptId: "receipt-test",
  policyVersion: "synthetic-only", selectorVersion: "synthetic-selector", mode: "CLASSIC",
};
const opening: WalletBalances = { available: 1n, held: 0n, debt: 0n, version: 0n };
const syntheticPolicy = (verify: (input: ReceiptPolicyInput) => Promise<void> | void): ReceiptPolicyVerifier => ({
  source: "test-only",
  async assertEligible(input) { await verify(input); },
});

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(work: () => Promise<T>): Promise<T> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    try { return await work(); } finally { release(); }
  }
}

class MemoryStore implements EntaClassicStartStore {
  state = { available: 1n, held: 0n, debt: 0n, admissions: new Map<string, StoredAdmission>(), games: 0 };
  readonly mutex = new Mutex();
  failBeforeCommit = false;
  receiptIdentityId = identityId;

  async transaction<T>(work: (tx: EntaClassicStartTransaction) => Promise<T>): Promise<T> {
    return this.mutex.run(async () => {
      const before = { ...this.state, admissions: new Map(this.state.admissions) };
      try {
        return await work(this.tx());
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
  }

  private tx(): EntaClassicStartTransaction {
    const thisStore = this;
    return {
      async resolveIdentity(p, uid) {
        if (p !== projectId || uid !== "uid-1") throw new Error("IDENTITY_NOT_FOUND");
        return { id: identityId };
      },
      async lockWallet() { return { available: thisStore.state.available, held: thisStore.state.held, debt: thisStore.state.debt }; },
      async findByRequestKey(id, key) { return [...thisStore.state.admissions.values()].find((x) => x.requestKey === key) ?? null; },
      async findByLogicalMatch(_id, match) { return [...thisStore.state.admissions.values()].find((x) => x.logicalMatchId === match) ?? null; },
      async readActiveReceipt() { return { ...receipt, identityId: thisStore.receiptIdentityId }; },
      async reserve(id, command) {
        thisStore.state.available -= 1n;
        thisStore.state.held += 1n;
        const admissionId = `admission-${command.requestKey}`;
        thisStore.state.admissions.set(admissionId, { requestKey: command.requestKey, requestHash: command.requestHash, logicalMatchId: command.logicalMatchId, intentHash: command.intentHash, gameId: `pending-${admissionId}` });
        return { admissionId };
      },
      async createPinnedGame(admissionId) {
        thisStore.state.games += 1;
        const gameId = `game-${admissionId}`;
        const current = thisStore.state.admissions.get(admissionId)!;
        thisStore.state.admissions.set(admissionId, { ...current, gameId });
        return { gameId };
      },
      async commitReservation() {
        if (thisStore.failBeforeCommit) throw new Error("SYNTHETIC_CHILD_FAILURE");
        thisStore.state.held -= 1n;
      },
    };
  }
}

class MemoryGrantStore implements InitialGrantStore {
  readonly mutex = new Mutex();
  readonly grants = new Set<string>();
  balance = 0n;
  async transaction<T>(work: (tx: InitialGrantTransaction) => Promise<T>): Promise<T> {
    const thisStore = this;
    return this.mutex.run(() => work({
      async resolveIdentity(p, uid) { if (p !== projectId || uid !== "uid-1") throw new Error("IDENTITY_NOT_FOUND"); return { id: identityId }; },
      async lockWallet() {},
      async findFreeFirstGrant(id) { return thisStore.grants.has(id) ? { walletId: `wallet-${id}` } : null; },
      async postFixedFreeFirstGrant(id, origin) {
        if (origin !== id || thisStore.grants.has(id)) throw new Error("FREE_GRANT_CONFLICT");
        thisStore.grants.add(id);
        thisStore.balance += 1n;
        return { walletId: `wallet-${id}` };
      },
    }));
  }
}

function command(requestKey: string, logicalMatchId: string, categoryKey = "cat-a") {
  return { requestKey, logicalMatchId, categoryKeys: [categoryKey] };
}

test("ledger derives fixed effects, reconciles, and denies debt/insufficient credit", () => {
  const effects: WalletEffect[] = ["FREE_FIRST_GRANT", "RESERVE", "RELEASE"];
  const result = reconcileLedger({ available: 0n, held: 0n, debt: 0n, version: 0n }, effects);
  assert.deepEqual(result, { available: 1n, held: 0n, debt: 0n, version: 3n });
  const posted = [
    { sequence: 1n, originType: "grant", originId: "identity", effect: "FREE_FIRST_GRANT" as const, deltaAvailable: 1n, deltaHeld: 0n, deltaDebt: 0n, resultingAvailable: 1n, resultingHeld: 0n, resultingDebt: 0n },
    { sequence: 2n, originType: "admission", originId: "match", effect: "RESERVE" as const, deltaAvailable: -1n, deltaHeld: 1n, deltaDebt: 0n, resultingAvailable: 0n, resultingHeld: 1n, resultingDebt: 0n },
    { sequence: 3n, originType: "admission", originId: "match", effect: "COMMIT" as const, deltaAvailable: 0n, deltaHeld: -1n, deltaDebt: 0n, resultingAvailable: 0n, resultingHeld: 0n, resultingDebt: 0n },
  ];
  assert.deepEqual(reconcileLedgerEntries({ available: 0n, held: 0n, debt: 0n, version: 0n }, posted), { available: 0n, held: 0n, debt: 0n, version: 3n });
  assert.throws(() => reconcileLedgerEntries({ available: 0n, held: 0n, debt: 0n, version: 0n }, posted.map((entry, index) => index === 1 ? { ...entry, deltaAvailable: 0n } : entry)), /LEDGER_EFFECT_DELTA_MISMATCH/u);
  assert.deepEqual(reconcileLedger({ available: 0n, held: 0n, debt: 0n, version: 0n }, ["FREE_FIRST_GRANT", "RESERVE", "RELEASE"]), { available: 1n, held: 0n, debt: 0n, version: 3n });
  assert.throws(() => applyLedgerEffect({ ...opening, available: 0n }, "RESERVE"), /INSUFFICIENT_CREDIT/u);
  assert.throws(() => applyLedgerEffect({ ...opening, debt: 1n }, "RESERVE"), /WALLET_DEBT_BLOCKS_START/u);
});

test("concurrent initial grant attempts produce exactly one fixed grant", async () => {
  const store = new MemoryGrantStore();
  const principal = { projectId, uid: "uid-1", anonymous: false, verifiedAccount: true, email: "verified@example.test" };
  const results = await Promise.all([
    grantInitialFreeCredit(principal, store),
    grantInitialFreeCredit(principal, store),
  ]);
  assert.equal(results.filter((result) => result.granted).length, 1);
  assert.equal(store.balance, 1n);
  await assert.rejects(grantInitialFreeCredit({ ...principal, anonymous: true }, store), /VERIFIED_ACCOUNT_REQUIRED/u);
});

test("concurrent free/paid admission attempts cannot spend the same final credit twice", async () => {
  const store = new MemoryStore();
  const policy = syntheticPolicy(() => {});
  const outcomes = await Promise.allSettled([
    startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-a", "match-a", "1")),
    startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-b", "match-b", "2")),
  ]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(store.state.available, 0n);
  assert.equal(store.state.held, 0n);
  assert.equal(store.state.games, 1);
});

test("idempotent request returns stored game even under debt; changed intent and new key conflict", async () => {
  const store = new MemoryStore();
  const policy = syntheticPolicy(() => {});
  const first = await startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-a", "match-a", "1"));
  store.state.debt = 1n;
  assert.equal(first.idempotent, false);
  assert.deepEqual(await startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-a", "match-a", "1")), { gameId: first.gameId, idempotent: true });
  await assert.rejects(startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-a", "match-a", "cat-b")), /IDEMPOTENCY_KEY_CONFLICT/u);
  await assert.rejects(startEntaClassicPaidMatchForTest(store, policy, verifiedPrincipal, command("request-b", "match-a", "cat-c")), /LOGICAL_MATCH_ALREADY_CHARGED/u);
  assert.equal(store.state.games, 1);
});

test("wallet debt blocks a new reservation after request replay has been resolved", async () => {
  const store = new MemoryStore();
  store.state.debt = 1n;
  await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), verifiedPrincipal, command("request-debt", "match-debt")), /WALLET_DEBT_BLOCKS_START/u);
  assert.equal(store.state.available, 1n);
  assert.equal(store.state.games, 0);
});

test("new client STUDENT field cannot select a free operation and policy denial rolls back", async () => {
  const store = new MemoryStore();
  const forged = { ...command("request-a", "match-a", "1"), mode: "STUDENT", free: true } as unknown as ReturnType<typeof command>;
  const synthetic = syntheticPolicy(() => { throw new Error("UNQUALIFIED_SYNTHETIC_POLICY"); });
  await assert.rejects(startEntaClassicPaidMatchForTest(store, synthetic, verifiedPrincipal, forged), /UNQUALIFIED_SYNTHETIC_POLICY/u);
  assert.equal(store.state.available, 1n);
  assert.equal(store.state.held, 0n);
  assert.equal(store.state.games, 0);
  await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), { ...verifiedPrincipal, verifiedAccount: false }, command("request-u", "match-u", "cat-u")), /VERIFIED_ACCOUNT_REQUIRED/u);
  await assert.rejects(startEntaClassicPaidMatch(store, verifiedPrincipal, command("request-b", "match-b", "2")), /CATALOG_RECEIPT_POLICY_UNAVAILABLE/u);
  const callerShapedProduction = { source: "production-closed", async assertEligible() {} } as ReceiptPolicyVerifier;
  await assert.rejects(startEntaClassicPaidMatchForTest(store, callerShapedProduction, verifiedPrincipal, command("request-forged", "match-forged")), /TEST_RECEIPT_POLICY_REQUIRED/u);
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVercelEnv = process.env.VERCEL_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), verifiedPrincipal, command("request-c", "match-c")), /TEST_RECEIPT_POLICY_FORBIDDEN_IN_DEPLOYMENT/u);
    process.env.NODE_ENV = "development";
    process.env.VERCEL_ENV = "preview";
    await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), verifiedPrincipal, command("request-preview", "match-preview")), /TEST_RECEIPT_POLICY_FORBIDDEN_IN_DEPLOYMENT/u);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  }
});

test("game creation failure rolls the hold and admission back in the same transaction", async () => {
  const store = new MemoryStore();
  store.failBeforeCommit = true;
  await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), verifiedPrincipal, command("request-a", "match-a", "1")), /SYNTHETIC_CHILD_FAILURE/u);
  assert.deepEqual(store.state, { available: 1n, held: 0n, debt: 0n, admissions: new Map(), games: 0 });
});

test("receipt owner mismatch fails before reservation and game creation", async () => {
  const store = new MemoryStore();
  store.receiptIdentityId = "another-identity";
  await assert.rejects(startEntaClassicPaidMatchForTest(store, syntheticPolicy(() => {}), verifiedPrincipal, command("request-x", "match-x")), /CATALOG_RECEIPT_BINDING_MISMATCH/u);
  assert.equal(store.state.available, 1n);
  assert.equal(store.state.held, 0n);
  assert.equal(store.state.games, 0);
});

test("financial identity eligibility uses current server Admin state, not token email claims", () => {
  const base = { aud: projectId, iss: `https://securetoken.google.com/${projectId}`, sub: "uid-1", uid: "uid-1", email_verified: true, firebase: { sign_in_provider: "google.com" } };
  assert.equal(principalFromClaims({ ...base, currentUser: { disabled: false, emailVerified: true, email: "fresh@example.test" } }, projectId).verifiedAccount, true);
  for (const currentUser of [
    { disabled: true, emailVerified: true, email: "fresh@example.test" },
    { disabled: false, emailVerified: false, email: "fresh@example.test" },
    { disabled: false, emailVerified: true, email: "   " },
  ]) {
    assert.equal(principalFromClaims({ ...base, currentUser }, projectId).verifiedAccount, false);
  }
  assert.equal(principalFromClaims({ ...base, firebase: { sign_in_provider: "anonymous" }, currentUser: { disabled: false, emailVerified: true, email: "fresh@example.test" } }, projectId).verifiedAccount, false);
});

test("INT-5A migration is additive, transaction-wrapped, ungranted, and R3-E fail-closed", () => {
  const sql = readFileSync(resolve(process.cwd(), "services/enta/server/prisma/migrations/20261002150000_int5a_wallet_admission/migration.sql"), "utf8");
  const functionBody = (name: string) => {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
    assert.notEqual(start, -1, `migration must define ${name}`);
    const end = sql.indexOf("END $$;", start);
    assert.notEqual(end, -1, `${name} must have a complete function body`);
    return sql.slice(start, end);
  };
  const validateWalletEntry = functionBody("int5a_validate_wallet_entry");
  const admissionConsistency = functionBody("int5a_admission_consistency_at_commit");
  const gamePinGuard = functionBody("int4_game_pin_guard");
  const categoryPinGuard = functionBody("int5a_game_category_pin_guard");
  assert.match(sql, /^-- INT-5A additive draft[\s\S]*?\bBEGIN;/u);
  assert.match(sql, /\bCOMMIT;\s*$/u);
  assert.doesNotMatch(sql, /\b(?:DROP|RENAME)\s+(?:TABLE|COLUMN|CONSTRAINT|INDEX|TRIGGER|FUNCTION)\b/iu);
  assert.doesNotMatch(sql, /\bGRANT\s+(?:ALL|EXECUTE|SELECT|INSERT|UPDATE|DELETE)\b/iu);
  assert.match(sql, /LegacyUnpinnedGame/u);
  assert.match(sql, /catalog receipt policy is not approved for paid start/u);
  assert.match(sql, /REVOKE ALL ON public\."Wallet"/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.int4_game_pin_guard/u);
  assert.match(sql, /FOREIGN KEY\("admissionId","firebaseIdentityId"\)/u);
  assert.match(sql, /FOREIGN KEY\("gameId","catalogReleaseId"\)/u);
  assert.ok(sql.indexOf('CREATE UNIQUE INDEX "Game_id_catalogReleaseId_key"') < sql.indexOf('CREATE TABLE public."GameCategoryPin"'), "composite FK target must be unique before GameCategoryPin creation");
  assert.match(sql, /null pins allowed only for snapshotted historical game IDs/u);
  assert.match(sql, /NEW\."questionId" IS NULL OR NEW\."catalogReleaseId" IS NOT NULL/u);
  assert.match(sql, /GameQuestion_financial_update_guard" BEFORE INSERT OR UPDATE OR DELETE ON public\."GameQuestion"/u);
  assert.match(sql, /category pins may be added only while admission is held/u);
  assert.match(sql, /pinned game questions may be added only while admission is held/u);
  assert.match(sql, /CREATE UNIQUE INDEX "WalletEntry_free_first_grant_identity_key"[\s\S]*?WHERE "effect"='FREE_FIRST_GRANT'/u);
  assert.match(validateWalletEntry, /NEW\."originType"<>'ADMISSION'/u);
  assert.match(validateWalletEntry, /NEW\."originId"<>w\."firebaseIdentityId" OR NEW\."actorFirebaseIdentityId" IS DISTINCT FROM w\."firebaseIdentityId"/u);
  assert.match(validateWalletEntry, /NEW\."effect"='RESERVE' AND w\."debt">0/u);
  assert.match(admissionConsistency, /IF TG_TABLE_NAME='Admission' THEN[\s\S]*?admission_id := NEW\."id";/u);
  assert.match(admissionConsistency, /TG_TABLE_NAME='Reservation'[\s\S]*?admission_id := NEW\."admissionId";/u);
  assert.match(admissionConsistency, /TG_TABLE_NAME='WalletEntry'[\s\S]*?NEW\."reservationId" IS NULL THEN RETURN NULL/u);
  assert.match(admissionConsistency, /SELECT \* INTO a FROM public\."Admission" WHERE "id"=admission_id/u);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER "Reservation_consistency_at_commit" AFTER INSERT OR UPDATE ON public\."Reservation" DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(sql, /CREATE CONSTRAINT TRIGGER "WalletEntry_admission_consistency_at_commit" AFTER INSERT ON public\."WalletEntry" DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(admissionConsistency, /r\."state" IS DISTINCT FROM a\."state"/u);
  assert.match(gamePinGuard, /pinned game questions may be added only while admission is held/u);
  assert.match(categoryPinGuard, /category pins may be added only while admission is held/u);
  assert.match(sql, /answering team must belong to same game/u);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\."(?:Wallet|Admission|Reservation|ActiveCatalogPointer)"/iu);
});
