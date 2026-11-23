import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test } from "node:test";

const databaseUrl = process.env.INT5A_TEST_DATABASE_URL;
let parsedUrl: URL | undefined;
try { parsedUrl = databaseUrl ? new URL(databaseUrl) : undefined; } catch { /* fail below */ }
const safeDatabase = Boolean(parsedUrl &&
  ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname) &&
  parsedUrl.pathname.toLowerCase().endsWith("_int5a_test"));
if (databaseUrl && !safeDatabase) {
  throw new Error("INT5A_TEST_DATABASE_URL must target a loopback database ending in _int5a_test");
}
const legacyDatabaseUrl = process.env.INT5A_LEGACY_TEST_DATABASE_URL;
const legacyFixture = {
  gameId: process.env.INT5A_LEGACY_GAME_ID ?? "int5a_legacy2_game",
  userId: process.env.INT5A_LEGACY_USER_ID ?? "int5a_legacy2_user",
  questionId: process.env.INT5A_LEGACY_QUESTION_ID ?? "int5a_legacy2_question",
  gameQuestionId: process.env.INT5A_LEGACY_GAME_QUESTION_ID ?? "int5a_legacy2_game_question",
};
let parsedLegacyUrl: URL | undefined;
try { parsedLegacyUrl = legacyDatabaseUrl ? new URL(legacyDatabaseUrl) : undefined; } catch { /* fail below */ }
const safeLegacyDatabase = Boolean(parsedLegacyUrl &&
  ["localhost", "127.0.0.1", "::1"].includes(parsedLegacyUrl.hostname) &&
  parsedLegacyUrl.pathname.toLowerCase().endsWith("_int5a_test"));
if (legacyDatabaseUrl && !safeLegacyDatabase) {
  throw new Error("INT5A_LEGACY_TEST_DATABASE_URL must target a loopback database ending in _int5a_test");
}
if (legacyDatabaseUrl && Object.values(legacyFixture).some((value) => !/^[A-Za-z0-9_-]+$/u.test(value))) {
  throw new Error("INT5A legacy fixture IDs must be simple exact database IDs");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const NOLOGIN_ROLES = ["enta_runtime", "enta_finance_executor", "enta_outbox_worker"] as const;

async function expectFailure(action: () => Promise<unknown>, pattern: RegExp): Promise<string> {
  let failure: unknown;
  try { await action(); } catch (error) { failure = error; }
  assert.ok(failure, "expected PostgreSQL operation to fail");
  const message = failure instanceof Error ? failure.message : String(failure);
  assert.match(message, pattern);
  return message;
}

test("INT-5A financial migration invariants on isolated disposable PostgreSQL", { skip: !safeDatabase }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl! });
  const nonce = randomUUID().replaceAll("-", "");
  const id = (kind: string) => `${kind}_${nonce}`;
  const hex = (value: string) => sha256(`${nonce}:${value}`);
  const now = new Date();

  try {
    const identityId = id("identity");
    const walletId = id("wallet");
    const identity2Id = id("identity_other");
    const wallet2Id = id("wallet_other");
    const identity3Id = id("identity_overflow");
    const wallet3Id = id("wallet_overflow");
    const releaseId = id("release");
    const rootHash = hex("root");
    const sealHash = hex("seal");
    const receiptId = id("receipt");
    const admissionId = id("admission_release");

    await t.test("target and role preflight; runtime and PUBLIC stay outside financial authority", async () => {
      const context = await db.$queryRaw<Array<{ db: string; user: string; version: string }>>`
        SELECT current_database() AS db, current_user AS user, current_setting('server_version') AS version`;
      assert.equal(context[0]?.db, parsedUrl!.pathname.slice(1));
      assert.equal(context[0]?.user, "postgres");
      assert.match(context[0]?.version ?? "", /^18\./);

      const roles = await db.$queryRaw<Array<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolcreaterole: boolean }>>`
        SELECT rolname, rolcanlogin, rolsuper, rolcreaterole FROM pg_roles
        WHERE rolname = ANY(${NOLOGIN_ROLES}::text[]) ORDER BY rolname`;
      assert.deepEqual(roles.map((role) => role.rolname), [...NOLOGIN_ROLES].sort());
      assert.ok(roles.every((role) => !role.rolcanlogin && !role.rolsuper && !role.rolcreaterole));

      const memberships = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM pg_auth_members m
        JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
        WHERE parent.rolname LIKE 'enta_%' AND member.rolname LIKE 'enta_%'`;
      assert.equal(memberships[0]?.count, 0n);

      const relations = ["Wallet", "WalletEntry", "Admission", "Reservation", "AdmissionEvent", "AdmissionOutbox", "GameCategoryPin"];
      for (const relation of relations) {
        const privileges = await db.$queryRaw<Array<{ select_ok: boolean; insert_ok: boolean; update_ok: boolean; delete_ok: boolean }>>`
          SELECT has_table_privilege('enta_runtime', format('public.%I', ${relation}), 'SELECT') AS select_ok,
                 has_table_privilege('enta_runtime', format('public.%I', ${relation}), 'INSERT') AS insert_ok,
                 has_table_privilege('enta_runtime', format('public.%I', ${relation}), 'UPDATE') AS update_ok,
                 has_table_privilege('enta_runtime', format('public.%I', ${relation}), 'DELETE') AS delete_ok`;
        assert.deepEqual(Object.values(privileges[0] ?? {}), [false, false, false, false], `${relation} grants`);
        const publicGrants = await db.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
          WHERE c.oid=format('public.%I', ${relation})::regclass AND a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')`;
        assert.equal(publicGrants[0]?.count, 0n, `${relation} PUBLIC grants`);
      }

      const functions = await db.$queryRaw<Array<{ proname: string; prosecdef: boolean; proconfig: string[] | null; owner: string }>>`
        SELECT p.proname, p.prosecdef, p.proconfig, r.rolname AS owner
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('int5a_validate_wallet_entry','int5a_wallet_reconcile_at_commit','int5a_admission_consistency_at_commit','int4_game_pin_guard')`;
      assert.equal(functions.length, 4);
      for (const fn of functions) {
        assert.equal(fn.prosecdef, true, `${fn.proname} must run through its reviewed definer boundary`);
        assert.equal(fn.owner, "postgres");
      assert.ok(fn.proconfig?.some((entry) => entry.startsWith("search_path=")), `${fn.proname} fixed search_path`);
        const executable = await db.$queryRaw<Array<{ runtime: boolean; executor: boolean; public_count: bigint }>>`
          SELECT has_function_privilege('enta_runtime',p.oid,'EXECUTE') AS runtime,
                 has_function_privilege('enta_finance_executor',p.oid,'EXECUTE') AS executor,
                 (SELECT count(*)::bigint FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_count
          FROM pg_proc p WHERE p.proname=${fn.proname} AND p.pronamespace='public'::regnamespace`;
        assert.deepEqual(executable[0], { runtime: false, executor: false, public_count: 0n }, `${fn.proname} has no unreviewed execution grant`);
      }
    });

    await t.test("synthetic immutable receipt lineage, free grant, reserve and terminal ledger transitions", async () => {
      await db.$executeRaw`INSERT INTO public."FirebaseIdentity" ("id","firebaseProjectId","firebaseUid","updatedAt") VALUES (${identityId},'int5a-synthetic-project',${nonce},${now}),(${identity2Id},'int5a-synthetic-project',${`${nonce}-other`},${now})`;
      await db.$executeRaw`INSERT INTO public."FirebaseIdentity" ("id","firebaseProjectId","firebaseUid","updatedAt") VALUES (${identity3Id},'int5a-synthetic-project',${`${nonce}-overflow`},${now})`;
      await db.$executeRaw`INSERT INTO public."Wallet" ("id","firebaseIdentityId","updatedAt") VALUES (${walletId},${identityId},${now}),(${wallet2Id},${identity2Id},${now}),(${wallet3Id},${identity3Id},${now})`;
      await db.$executeRaw`INSERT INTO public."CatalogRelease" ("id","releaseRootHash","manifestVersion") VALUES (${releaseId},${rootHash},1)`;
      await db.$executeRaw`INSERT INTO public."CatalogReleaseSeal" ("id","catalogReleaseId","releaseRootHash","sealHash","canonicalizationVersion") VALUES (${id("seal")},${releaseId},${rootHash},${sealHash},1)`;
      await db.$executeRaw`INSERT INTO public."CatalogValidationReceipt" ("id","catalogReleaseId","releaseRootHash","sealHash","validatorRef","policyVersion","sourceEvidenceManifestHash","selectorVersion") VALUES (${receiptId},${releaseId},${rootHash},${sealHash},'synthetic-db-test','int5a-synthetic-v1',${hex("source" )},'enta-test-selector')`;

      const grantEntryId = id("free_entry");
      await db.$transaction(async (tx) => {
        const wallet = await tx.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint }>>`SELECT "available","held","debt","version" FROM public."Wallet" WHERE "id"=${walletId} FOR UPDATE`;
        assert.equal(wallet[0]?.version, 0n);
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES (${grantEntryId},${walletId},1,'FREE_FIRST_GRANT',${identityId},'FREE_FIRST_GRANT',1,0,0,1,0,0,${identityId})`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=1,"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });

      const reservationId = id("reservation_release");
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM public."Wallet" WHERE "id"=${walletId} FOR UPDATE`;
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${admissionId},${identityId},${walletId},'ENTA','PAID_ENTA_CLASSIC','CLASSIC',${id("logical")},${id("request")},${hex("request")},${hex("intent")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${reservationId},${admissionId},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."AdmissionEvent" ("id","admissionId","sequence","eventType") VALUES (${id("held_event")},${admissionId},1,'HELD')`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("reserve_entry")},${walletId},2,'ADMISSION',${admissionId},'RESERVE',${reservationId},-1,1,0,0,1,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=0,"held"=1,"version"=2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("release_entry")},${walletId},3,'ADMISSION',${admissionId},'RELEASE',${reservationId},1,-1,0,1,0,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=1,"held"=0,"version"=3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRaw`UPDATE public."Reservation" SET "state"='RELEASED',"releasedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${reservationId}`;
        await tx.$executeRaw`UPDATE public."Admission" SET "state"='RELEASED',"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${admissionId}`;
        await tx.$executeRaw`INSERT INTO public."AdmissionEvent" ("id","admissionId","sequence","eventType") VALUES (${id("released_event")},${admissionId},2,'RELEASED')`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });

      const balances = await db.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint; state: string }>>`
        SELECT w."available",w."held",w."debt",w."version",a."state" FROM public."Wallet" w JOIN public."Admission" a ON a."walletId"=w."id" WHERE a."id"=${admissionId}`;
      assert.deepEqual(balances[0], { available: 1n, held: 0n, debt: 0n, version: 3n, state: "RELEASED" });

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES (${id("duplicate_grant")},${walletId},4,'FREE_FIRST_GRANT',${identityId},'FREE_FIRST_GRANT',1,0,0,2,0,0,${identityId})`;
      }), /23505|single_free_first_grant/i);

      const grantConcurrently = (targetWalletId: string, targetIdentityId: string, entryId: string) => db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint }>>`
          SELECT "available","held","debt","version" FROM public."Wallet" WHERE "id"=${targetWalletId} FOR UPDATE`;
        const wallet = rows[0];
        assert.ok(wallet);
        const prior = await tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*)::bigint AS count FROM public."WalletEntry" WHERE "walletId"=${targetWalletId} AND "effect"='FREE_FIRST_GRANT'`;
        if (prior[0]?.count) return false;
        const sequence = wallet.version + 1n;
        const available = wallet.available + 1n;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES (${entryId},${targetWalletId},${sequence},'FREE_FIRST_GRANT',${targetIdentityId},'FREE_FIRST_GRANT',1,0,0,${available},${wallet.held},${wallet.debt},${targetIdentityId})`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=${available},"version"=${sequence},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${targetWalletId}`;
        return true;
      });
      const grants = await Promise.all([
        grantConcurrently(wallet2Id, identity2Id, id("race_grant_a")),
        grantConcurrently(wallet2Id, identity2Id, id("race_grant_b")),
      ]);
      assert.equal(grants.filter(Boolean).length, 1, "exactly one concurrent initial grant should win");
      const grantCount = await db.$queryRaw<Array<{ count: bigint; available: bigint; version: bigint }>>`
        SELECT count(e.*)::bigint AS count, w."available", w."version" FROM public."WalletEntry" e
        JOIN public."Wallet" w ON w."id"=e."walletId" WHERE e."walletId"=${wallet2Id} AND e."effect"='FREE_FIRST_GRANT'
        GROUP BY w."available",w."version"`;
      assert.deepEqual(grantCount[0], { count: 1n, available: 1n, version: 1n });

      const reserveIfAvailable = (requestKey: string) => db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint }>>`
          SELECT "available","held","debt","version" FROM public."Wallet" WHERE "id"=${wallet2Id} FOR UPDATE`;
        const wallet = rows[0];
        assert.ok(wallet);
        if (wallet.available < 1n || wallet.debt > 0n) return undefined;
        const next = wallet.version + 1n;
        const newAdmissionId = id(`admission_${requestKey}`);
        const newReservationId = id(`reservation_${requestKey}`);
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${newAdmissionId},${identity2Id},${wallet2Id},'ENTA','PAID_ENTA_CLASSIC','CLASSIC',${id(`logical_${requestKey}`)},${requestKey},${hex(`request_${requestKey}`)},${hex(`intent_${requestKey}`)},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${newReservationId},${newAdmissionId},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."AdmissionEvent" ("id","admissionId","sequence","eventType") VALUES (${id(`held_${requestKey}`)},${newAdmissionId},1,'HELD')`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id(`reserve_${requestKey}`)},${wallet2Id},${next},'ADMISSION',${newAdmissionId},'RESERVE',${newReservationId},-1,1,0,${wallet.available - 1n},${wallet.held + 1n},${wallet.debt})`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=${wallet.available - 1n},"held"=${wallet.held + 1n},"version"=${next},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet2Id}`;
        return { admissionId: newAdmissionId, reservationId: newReservationId, sequence: next };
      });
      const reservations = await Promise.all([reserveIfAvailable(id("request_a")), reserveIfAvailable(id("request_b"))]);
      const winner = reservations.find((reservation) => reservation !== undefined);
      assert.ok(winner);
      assert.equal(reservations.filter(Boolean).length, 1, "only one admission may reserve the last credit");
      const afterReserve = await db.$queryRaw<Array<{ available: bigint; held: bigint; version: bigint }>>`
        SELECT "available","held","version" FROM public."Wallet" WHERE "id"=${wallet2Id}`;
      assert.deepEqual(afterReserve[0], { available: 0n, held: 1n, version: 2n });

      await db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("commit_entry")},${wallet2Id},3,'ADMISSION',${winner.admissionId},'COMMIT',${winner.reservationId},0,-1,0,0,0,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "held"=0,"version"=3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet2Id}`;
        await tx.$executeRaw`UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${winner.admissionId}`;
        await tx.$executeRaw`UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${winner.reservationId}`;
        await tx.$executeRaw`INSERT INTO public."AdmissionEvent" ("id","admissionId","sequence","eventType") VALUES (${id("committed_event")},${winner.admissionId},2,'COMMITTED')`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });
      const committed = await db.$queryRaw<Array<{ available: bigint; held: bigint; version: bigint; state: string }>>`
        SELECT w."available",w."held",w."version",a."state" FROM public."Wallet" w JOIN public."Admission" a ON a."walletId"=w."id" WHERE a."id"=${winner.admissionId}`;
      assert.deepEqual(committed[0], { available: 0n, held: 0n, version: 3n, state: "COMMITTED" });
    });

    await t.test("deferred consistency rejects one-sided reservation, admission, and ledger terminal events", async () => {
      const heldAdmission = id("held_guard_admission");
      const heldReservation = id("held_guard_reservation");
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES (${id("guard_grant")},${wallet3Id},1,'FREE_FIRST_GRANT',${identity3Id},'FREE_FIRST_GRANT',1,0,0,1,0,0,${identity3Id})`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=1,"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
      });
      await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT "id" FROM public."Wallet" WHERE "id"=${wallet3Id} FOR UPDATE`;
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${heldAdmission},${identity3Id},${wallet3Id},'ENTA','PAID_ENTA_CLASSIC',${id("guard_logical")},${id("guard_request")},${hex("guard_request_hash")},${hex("guard_intent_hash")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${heldReservation},${heldAdmission},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("guard_reserve")},${wallet3Id},2,'ADMISSION',${heldAdmission},'RESERVE',${heldReservation},-1,1,0,0,1,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=0,"held"=1,"version"=2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      });

      for (const terminalState of ["COMMITTED", "RELEASED"] as const) {
        await expectFailure(() => db.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE public."Reservation" SET "state"=${terminalState},"committedAt"=CASE WHEN ${terminalState}='COMMITTED' THEN CURRENT_TIMESTAMP ELSE NULL END,"releasedAt"=CASE WHEN ${terminalState}='RELEASED' THEN CURRENT_TIMESTAMP ELSE NULL END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${heldReservation}`;
          await tx.$executeRaw`SET CONSTRAINTS "Reservation_consistency_at_commit" IMMEDIATE`;
        }), /admission and reservation states must agree/i);

        await expectFailure(() => db.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE public."Admission" SET "state"=${terminalState},"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${heldAdmission}`;
          await tx.$executeRaw`SET CONSTRAINTS "Admission_consistency_at_commit" IMMEDIATE`;
        }), /admission and reservation states must agree/i);

        const effect = terminalState === "COMMITTED" ? "COMMIT" : "RELEASE";
        const nextAvailable = terminalState === "RELEASED" ? 1n : 0n;
        await expectFailure(() => db.$transaction(async (tx) => {
          await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id(`guard_${effect}`)},${wallet3Id},3,'ADMISSION',${heldAdmission},${effect},${heldReservation},${terminalState === "RELEASED" ? 1 : 0},-1,0,${nextAvailable},0,0)`;
          await tx.$executeRaw`UPDATE public."Wallet" SET "available"=${nextAvailable},"held"=0,"version"=3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
          await tx.$executeRaw`SET CONSTRAINTS "WalletEntry_admission_consistency_at_commit" IMMEDIATE`;
        }), /admission state must have exactly one matching wallet effect/i);
      }

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("guard_commit_effect")},${wallet3Id},3,'ADMISSION',${heldAdmission},'COMMIT',${heldReservation},0,-1,0,0,0,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "held"=0,"version"=3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("guard_release_effect")},${wallet3Id},4,'ADMISSION',${heldAdmission},'RELEASE',${heldReservation},1,-1,0,1,-1,0)`;
      }), /terminal effect requires one unsettled held reservation/i);
    });

    await t.test("debt, owner, state/effect and new-game policy fail closed", async () => {
      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${id("wrong_owner")},${identityId},${wallet2Id},'ENTA','PAID_ENTA_CLASSIC',${id("logical_wrong")},${id("request_wrong")},${hex("request-wrong")},${hex("intent-wrong")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
      }), /foreign key|walletid_firebaseidentityid/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE public."Wallet" SET "debt"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
      }), /restricted financial operation|ledger entry/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        const debtAdmission = id("debt_admission");
        const debtReservation = id("debt_reservation");
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`UPDATE public."Wallet" SET "debt"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${debtAdmission},${identityId},${walletId},'ENTA','PAID_ENTA_CLASSIC',${id("debt_logical")},${id("debt_request")},${hex("debt_request_hash")},${hex("debt_intent_hash")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${debtReservation},${debtAdmission},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("debt_reserve_entry")},${walletId},4,'ADMISSION',${debtAdmission},'RESERVE',${debtReservation},-1,1,0,0,1,1)`;
      }), /wallet debt blocks reservation/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        const inconsistentAdmission = id("inconsistent_admission");
        const inconsistentReservation = id("inconsistent_reservation");
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${inconsistentAdmission},${identityId},${walletId},'ENTA','PAID_ENTA_CLASSIC',${id("bad_ledger_logical")},${id("bad_ledger_request")},${hex("bad_ledger_request_hash")},${hex("bad_ledger_intent_hash")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${inconsistentReservation},${inconsistentAdmission},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("bad_ledger_reserve")},${walletId},4,'ADMISSION',${inconsistentAdmission},'RESERVE',${inconsistentReservation},-1,1,0,0,1,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=0,"held"=1,"version"=4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRaw`UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${inconsistentReservation}`;
        await tx.$executeRaw`UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${inconsistentAdmission}`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      }), /admission state must have exactly one matching wallet effect/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        const mismatchAdmission = id("mismatch_admission");
        const mismatchReservation = id("mismatch_reservation");
        await tx.$executeRaw`INSERT INTO public."Admission" ("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","updatedAt") VALUES (${mismatchAdmission},${identityId},${walletId},'ENTA','PAID_ENTA_CLASSIC',${id("mismatch_logical")},${id("mismatch_request")},${hex("mismatch_request_hash")},${hex("mismatch_intent_hash")},1,${releaseId},${rootHash},${receiptId},'enta-test-selector',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."Reservation" ("id","admissionId","quantity","state","updatedAt") VALUES (${mismatchReservation},${mismatchAdmission},1,'HELD',CURRENT_TIMESTAMP)`;
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("mismatch_reserve")},${walletId},4,'ADMISSION',${mismatchAdmission},'RESERVE',${mismatchReservation},-1,1,0,0,1,0)`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=0,"held"=1,"version"=4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
        await tx.$executeRaw`UPDATE public."Reservation" SET "state"='RELEASED',"releasedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${mismatchReservation}`;
        await tx.$executeRaw`SET CONSTRAINTS "Admission_consistency_at_commit" IMMEDIATE`;
      }), /admission and reservation states must agree/i);

      const beforeOverflow = await db.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint; entries: bigint }>>`
        SELECT w."available",w."held",w."debt",w."version",count(e.*)::bigint AS entries
        FROM public."Wallet" w LEFT JOIN public."WalletEntry" e ON e."walletId"=w."id"
        WHERE w."id"=${wallet3Id} GROUP BY w."id"`;
      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"=9223372036854775807,"version"=9223372036854775807,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
        await tx.$executeRaw`UPDATE public."Wallet" SET "available"="available" + 1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${wallet3Id}`;
      }), /bigint out of range/i);
      const overflowRollback = await db.$queryRaw<Array<{ available: bigint; held: bigint; debt: bigint; version: bigint; entries: bigint }>>`
        SELECT w."available",w."held",w."debt",w."version",count(e.*)::bigint AS entries
        FROM public."Wallet" w LEFT JOIN public."WalletEntry" e ON e."walletId"=w."id"
        WHERE w."id"=${wallet3Id} GROUP BY w."id"`;
      assert.deepEqual(overflowRollback[0], beforeOverflow[0], "failed BIGINT increment rolls back to the exact prior wallet and ledger state");

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."Game" ("id","mode","status","userId","gameFormat","firebaseIdentityId","admissionId","catalogReleaseId","catalogReleaseRootHash","validationReceiptId") VALUES (${id("blocked_pinned_game")},'CLASSIC','ACTIVE',NULL,'FIREBASE_PINNED',${identityId},${admissionId},${releaseId},${rootHash},${receiptId})`;
      }), /catalog receipt policy is not approved for paid start/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO public."Game" ("id","mode","status","userId","gameFormat") VALUES (${id("blocked_legacy_game")},'CLASSIC','ACTIVE',${id("no_user")},'LEGACY')`;
      }), /new games require firebase pinned format/i);
    });

    await t.test("runtime login cannot read or mutate money or exercise hidden functions", async () => {
      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION enta_runtime");
        await tx.$executeRaw`SELECT * FROM public."Wallet" LIMIT 1`;
      }), /permission denied for table wallet/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION enta_runtime");
        await tx.$executeRaw`INSERT INTO public."WalletEntry" ("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt") VALUES (${id("runtime_entry")},${walletId},99,'ADMISSION','none','RELEASE',1,-1,0,1,0,0)`;
      }), /permission denied for table walletentry/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION enta_runtime");
        await tx.$executeRaw`SELECT public.int5a_validate_wallet_entry()`;
      }), /permission denied for function int5a_validate_wallet_entry/i);

      await expectFailure(() => db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION enta_runtime");
        await tx.$executeRawUnsafe("SET ROLE enta_finance_executor");
      }), /permission denied to set role/i);
    });
  } finally {
    await db.$disconnect();
  }
});

test("INT-5A preserves a pre-migration R5 legacy game and blocks new unpinned child rows", { skip: !safeLegacyDatabase }, async () => {
  const db = new PrismaClient({ datasourceUrl: legacyDatabaseUrl! });
  const runId = randomUUID().replaceAll("-", "");
  try {
    const game = await db.$queryRaw<Array<{ gameFormat: string; userId: string; snapshotId: string | null }>>`
      SELECT g."gameFormat",g."userId",l."gameId" AS "snapshotId" FROM public."Game" g
      LEFT JOIN public."LegacyUnpinnedGame" l ON l."gameId"=g."id" WHERE g."id"=${legacyFixture.gameId}`;
    assert.deepEqual(game[0], { gameFormat: "LEGACY", userId: legacyFixture.userId, snapshotId: legacyFixture.gameId });
    const originalChild = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM public."GameQuestion" WHERE "id"=${legacyFixture.gameQuestionId} AND "gameId"=${legacyFixture.gameId} AND "catalogReleaseId" IS NULL AND "questionRevisionId" IS NULL`;
    assert.equal(originalChild[0]?.count, 1n, "historical child with an old questionId remains intact");

    let nullChildFailure: unknown;
    try {
      await db.$executeRaw`INSERT INTO public."GameQuestion" ("id","gameId","questionId","catalogReleaseId","questionRevisionId") VALUES (${`int5a_legacy_null_${runId}`},${legacyFixture.gameId},NULL,NULL,NULL)`;
    } catch (error) { nullChildFailure = error; }
    assert.ok(nullChildFailure, "new historical-mode child must have a legacy question ID");
    assert.match(nullChildFailure instanceof Error ? nullChildFailure.message : String(nullChildFailure), /legacy question ID required/i);

    await db.$executeRaw`INSERT INTO public."GameQuestion" ("id","gameId","questionId","catalogReleaseId","questionRevisionId") VALUES (${`int5a_legacy_valid_${runId}`},${legacyFixture.gameId},${legacyFixture.questionId},NULL,NULL)`;
    const childCount = await db.$queryRaw<Array<{ count: bigint; inserted: bigint }>>`
      SELECT count(*)::bigint AS count, count(*) FILTER (WHERE "id"=${`int5a_legacy_valid_${runId}`})::bigint AS inserted
      FROM public."GameQuestion" WHERE "gameId"=${legacyFixture.gameId} AND "catalogReleaseId" IS NULL AND "questionRevisionId" IS NULL`;
    assert.ok((childCount[0]?.count ?? 0n) >= 2n, "old row and valid post-cutover legacy row coexist");
    assert.equal(childCount[0]?.inserted, 1n);
  } finally {
    await db.$disconnect();
  }
});
