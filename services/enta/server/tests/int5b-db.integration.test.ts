import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { test } from "node:test";
import { admissionHash, assertProof, type HuroofBinding, type HuroofProof } from "../src/admission/huroof-protocol.cjs";

const databaseUrl = process.env.INT5B_TEST_DATABASE_URL;
const migration = "services/enta/server/prisma/migrations/20261003100000_int5b_huroof_admission/migration.sql";
if (databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) || !parsed.pathname.endsWith("_int5b_test")) throw new Error("INT5B_TEST_DATABASE_URL must target a loopback disposable database ending _int5b_test");
  const actual = createHash("sha256").update(readFileSync(migration)).digest("hex");
  if (process.env.INT5B_APPROVED_SQL_SHA256?.toLowerCase() !== actual) throw new Error("INT-5B exact approved SQL hash is required before this post-review harness can run");
  if (!process.env.INT5B_SYNTHETIC_RECEIPT_ID) throw new Error("INT-5B needs a separately prepared synthetic active Huroof catalog receipt");
  for (const variable of ["INT5B_RESERVER_DATABASE_URL", "INT5B_PROVISIONER_DATABASE_URL", "INT5B_RECONCILER_DATABASE_URL"]) {
    const restricted = new URL(process.env[variable] ?? "");
    if (restricted.hostname !== parsed.hostname || restricted.port !== parsed.port || restricted.pathname !== parsed.pathname || restricted.username === parsed.username)
      throw new Error(`${variable} must be a distinct disposable restricted login on the exact same target`);
  }
  if (process.env.INT5B_REHEARSAL_APPROVED !== "1") throw new Error("Root exact rereview approval is required before the gated harness runs");
}

test("INT-5B restricted PostgreSQL operations after exact review and disposable migration", { skip: !databaseUrl }, async (t) => {
  const db = new PrismaClient({ datasourceUrl: databaseUrl! });
  const clients = {
    enta_huroof_reserver: new PrismaClient({ datasourceUrl: process.env.INT5B_RESERVER_DATABASE_URL! }),
    enta_huroof_provisioner: new PrismaClient({ datasourceUrl: process.env.INT5B_PROVISIONER_DATABASE_URL! }),
    enta_huroof_reconciler: new PrismaClient({ datasourceUrl: process.env.INT5B_RECONCILER_DATABASE_URL! }),
  };
  const nonce = randomUUID(), identityId = `int5b-identity-${nonce}`, uid = `int5b-uid-${nonce}`, walletId = `int5b-wallet-${nonce}`;
  const roleTransaction = <T>(role: "enta_huroof_reserver" | "enta_huroof_provisioner" | "enta_huroof_reconciler", work: (sql: Prisma.TransactionClient) => Promise<T>) => clients[role].$transaction(async (sql) => {
    // Role is chosen from a closed test-only union. No dynamic principal/SQL input.
    if (role === "enta_huroof_reserver") await sql.$executeRawUnsafe("SET LOCAL ROLE enta_huroof_reserver");
    if (role === "enta_huroof_provisioner") await sql.$executeRawUnsafe("SET LOCAL ROLE enta_huroof_provisioner");
    if (role === "enta_huroof_reconciler") await sql.$executeRawUnsafe("SET LOCAL ROLE enta_huroof_reconciler");
    return work(sql);
  }, { timeout: 60000, maxWait: 60000 });
  try {
    const legacyFingerprint = () => db.$queryRaw`SELECT (SELECT jsonb_agg(g ORDER BY g."id") FROM public."Game" g) AS games,(SELECT jsonb_agg(q ORDER BY q."id") FROM public."GameQuestion" q) AS questions,(SELECT jsonb_agg(t ORDER BY t."id") FROM public."Team" t) AS teams,(SELECT jsonb_agg(a ORDER BY a."id") FROM public."Admission" a WHERE a."engine"='ENTA') AS enta,(SELECT jsonb_agg(l ORDER BY l."gameId") FROM public."LegacyUnpinnedGame" l) AS legacy`;
    const legacyBefore=await legacyFingerprint();
    if (process.env.INT5B_EXPECT_LEGACY_ROWS === "1") assert.ok((legacyBefore as Array<{ games: unknown[] | null }>)[0].games?.length,"legacy target must actually contain historical Games");
    await t.test("exact PG18 clone, restricted login and six operation-group ACL preflight", async () => {
      const target = await db.$queryRaw<Array<{ name: string; version: number }>>`SELECT current_database() AS name,current_setting('server_version_num')::INTEGER AS version`;
      assert.ok(target[0].name.endsWith("_int5b_test") && target[0].version >= 180000 && target[0].version < 190000);
      for (const role of Object.keys(clients) as Array<keyof typeof clients>) {
        const rows = await roleTransaction(role, (sql) => sql.$queryRaw<Array<{ login: string; active: string; superuser: boolean; creator: boolean; bypass: boolean }>>`SELECT session_user AS login,current_user AS active,r.rolsuper AS superuser,r.rolcreaterole AS creator,r.rolbypassrls AS bypass FROM pg_roles r WHERE r.rolname=session_user`);
        assert.equal(rows[0].active, role); assert.equal(rows[0].superuser, false); assert.equal(rows[0].creator, false); assert.equal(rows[0].bypass, false);
      }
      const groups = ["enta_runtime","enta_finance_executor","enta_outbox_worker",...Object.keys(clients)];
      for (const group of groups) {
        const rows = await db.$queryRaw<Array<{ rolcanlogin: boolean; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean }>>`SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=${group}`;
        assert.equal(rows.length, 1); assert.deepEqual(Object.values(rows[0]), [false,false,false,false,false]);
      }
      const owners = await db.$queryRaw<Array<{ owner: string; path: string[] | null }>>`SELECT pg_get_userbyid(proowner) AS owner,proconfig AS path FROM pg_proc WHERE proname LIKE 'int5b_%'`;
      assert.ok(owners.length >= 12); assert.ok(owners.every((row) => row.owner === "enta_finance_executor" && row.path?.includes("search_path=pg_catalog")));
      assert.equal((await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM public."AdmissionOutbox" WHERE "jobKind"='HUROOF_PROVISION_RECONCILE' AND "state"<>'DONE'`)[0].count, 0n, "fresh target has no previous pending work");
    });
    await t.test("finance pointer lock has exactly one nonbinding column privilege", async () => {
      const columns = await db.$queryRaw<Array<{ name: string; update: boolean }>>`SELECT a.attname AS name,has_column_privilege('enta_finance_executor',a.attrelid,a.attnum,'UPDATE') AS update FROM pg_attribute a WHERE a.attrelid='public."ActiveCatalogPointer"'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`;
      assert.deepEqual(columns.filter((column)=>column.update).map((column)=>column.name),["updatedAt"]);
      const boundary=await db.$queryRaw<Array<{ tableUpdate:boolean;receiptUpdate:boolean }>>`SELECT has_table_privilege('enta_finance_executor','public."ActiveCatalogPointer"','UPDATE') AS "tableUpdate",has_any_column_privilege('enta_finance_executor','public."CatalogValidationReceipt"','UPDATE') AS "receiptUpdate"`;
      assert.deepEqual(boundary[0],{ tableUpdate:false,receiptUpdate:false });
      const grant=await db.$queryRaw<Array<{ name:string;privilege:string;grantable:boolean }>>`SELECT a.attname AS name,x.privilege_type AS privilege,x.is_grantable AS grantable FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid='public."ActiveCatalogPointer"'::regclass AND x.grantee='enta_finance_executor'::regrole`;
      assert.deepEqual(grant,[{ name:"updatedAt",privilege:"UPDATE",grantable:false }]);
    });
    const receipts = await db.$queryRaw<Array<{ huroofProjectId: string; huroofReleaseId: string; huroofRootSha256: string; catalogReleaseId: string; releaseRootHash: string; id: string; selectorVersion: string; policyVersion: string; huroofCapabilityStateHash: string }>>`SELECT r.* FROM public."CatalogValidationReceipt" r JOIN public."ActiveCatalogPointer" p ON p."validationReceiptId"=r."id" WHERE r."id"=${process.env.INT5B_SYNTHETIC_RECEIPT_ID} AND p."id"='singleton'`;
    assert.equal(receipts.length, 1, "separately prepared active synthetic receipt is required");
    const receipt = receipts[0]; assert.ok(receipt.huroofProjectId && receipt.huroofReleaseId && receipt.huroofRootSha256);
    const config = { policyVersion: 1, demo: false, releaseDemoFixture: false, releaseId: receipt.huroofReleaseId, releaseRootSha256: receipt.huroofRootSha256, gameKind: "huroof", modality: "classic", categories: ["synthetic-category"], mapPresentation: "ordinary", questionSeconds: 20, opponentSeconds: 10, teams: { horizontal: "\u0623", vertical: "\u0628" }, mode: "classic", difficulty: "mixed", labelledColours: false };
    const bindingFor = (logical: string = randomUUID(), requestKey: string = randomUUID()): { binding: HuroofBinding; intentHash: string } => {
      const intentHash = admissionHash({ engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: logical, config, predecessorId: null });
      const binding: HuroofBinding = { version: 1, admissionId: randomUUID(), identityId, projectId: receipt.huroofProjectId, uid, engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: logical, roomId: randomUUID(), requestKey, requestHash: admissionHash({ version: 1, requestKey, intentHash }), catalogReleaseId: receipt.catalogReleaseId, catalogRootHash: receipt.releaseRootHash, validationReceiptId: receipt.id, releaseId: receipt.huroofReleaseId, releaseRootHash: receipt.huroofRootSha256, selectorVersion: receipt.selectorVersion, readinessPolicyVersion: receipt.policyVersion, capabilityHash: receipt.huroofCapabilityStateHash, configHash: admissionHash(config), predecessorId: null };
      return { binding, intentHash };
    };
    await db.$transaction(async (sql) => {
      await sql.$executeRaw`INSERT INTO public."FirebaseIdentity"("id","firebaseProjectId","firebaseUid","updatedAt") VALUES(${identityId},${receipt.huroofProjectId},${uid},CURRENT_TIMESTAMP)`;
      await sql.$executeRaw`INSERT INTO public."Wallet"("id","firebaseIdentityId","updatedAt") VALUES(${walletId},${identityId},CURRENT_TIMESTAMP)`;
      await sql.$executeRaw`INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(${`grant-${nonce}`},${walletId},1,'FREE_FIRST_GRANT',${identityId},'FREE_FIRST_GRANT',1,0,0,1,0,0,${identityId})`;
      await sql.$executeRaw`UPDATE public."Wallet" SET "available"=1,"version"=1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${walletId}`;
    });
    const reserve = (input: ReturnType<typeof bindingFor>) => roleTransaction("enta_huroof_reserver", async (sql) => {
      await sql.$executeRaw`SELECT public.int5b_reserve_huroof(${JSON.stringify(input.binding)}::jsonb,${input.intentHash},${JSON.stringify(config)}::jsonb)`;
    });
    const claim = async (owner = "int5b-worker") => (await roleTransaction("enta_huroof_provisioner", (sql) => sql.$queryRaw<Array<{ value: { jobId: string; leaseVersion: number; leaseOwner: string; binding: HuroofBinding } | null }>>`SELECT public.int5b_claim_huroof(${owner}) AS value`))[0].value;
    const terminal = (binding: HuroofBinding, state: "STARTED" | "CANCELLED"): HuroofProof => ({ version: 1, binding, state, provision: state === "STARTED" ? { version: 1, kind: "PROVISION", roomCode: "ABCDEFGH", configHash: binding.configHash } : null,
      terminal: { version: 1, kind: state === "STARTED" ? "START" : "CANCEL", actorUid: state === "STARTED" ? binding.uid : "internal-canceller", intentId: "synthetic-terminal", requestHash: "d".repeat(64), fromRevision: state === "STARTED" ? 1 : 0, toRevision: state === "STARTED" ? 2 : 1 } });
    const finishLease = async (lease: NonNullable<Awaited<ReturnType<typeof claim>>>, proof: HuroofProof | null) => (await roleTransaction("enta_huroof_reconciler", (sql) => sql.$queryRaw<Array<{ value: boolean }>>`SELECT public.int5b_finish_huroof(${lease.jobId},${lease.leaseOwner},${lease.leaseVersion},${proof === null ? null : JSON.stringify(proof)}::jsonb) AS value`))[0].value;
    const state = () => db.$queryRaw`SELECT row_to_json(w) AS wallet,(SELECT jsonb_agg(e ORDER BY e."sequence") FROM public."WalletEntry" e WHERE e."walletId"=w."id") AS ledger,(SELECT jsonb_agg(a ORDER BY a."id") FROM public."Admission" a WHERE a."walletId"=w."id") AS admissions,(SELECT jsonb_agg(r ORDER BY r."id") FROM public."Reservation" r JOIN public."Admission" a ON a."id"=r."admissionId" WHERE a."walletId"=w."id") AS reservations,(SELECT jsonb_agg(p ORDER BY p."id") FROM public."HuroofAdmissionProof" p JOIN public."Admission" a ON a."id"=p."admissionId" WHERE a."walletId"=w."id") AS proofs FROM public."Wallet" w WHERE w."id"=${walletId}`;
    let winner!: ReturnType<typeof bindingFor>;
    await t.test("last credit has exactly one wallet-serialized winner and exact retry", async () => {
      const candidates = [bindingFor(), bindingFor()];
      const results = await Promise.allSettled(candidates.map(reserve));
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      winner = candidates[results.findIndex((result) => result.status === "fulfilled")];
      await reserve(winner);
      const rows = await db.$queryRaw<Array<{ available: bigint; held: bigint; version: bigint }>>`SELECT "available","held","version" FROM public."Wallet" WHERE "id"=${walletId}`;
      assert.deepEqual(rows[0], { available: 0n, held: 1n, version: 2n });
      const material=await db.$queryRaw<Array<{ config:typeof config;hash:string }>>`SELECT "huroofConfig" AS config,public.int5b_hash_json("huroofConfig") AS hash FROM public."Admission" WHERE "id"=${winner.binding.admissionId}`;
      assert.deepEqual(material[0].config,config,"Arabic configuration must roundtrip through PostgreSQL UTF8");
      assert.equal(material[0].hash,admissionHash(config),"SQL/Node configuration hash agreement");
      await assert.rejects(reserve({ ...winner, intentHash: "f".repeat(64) }), /conflict/);
    });
    await t.test("operation identities deny finance DML, owner role and cross-operation execute", async () => {
      for (const role of ["enta_huroof_reserver", "enta_huroof_provisioner", "enta_huroof_reconciler"] as const) {
        for (const table of ["Wallet","WalletEntry","Admission","Reservation","AdmissionEvent","AdmissionOutbox","HuroofAdmissionProof"]) {
          for (const command of [`SELECT * FROM public."${table}"`,`INSERT INTO public."${table}" DEFAULT VALUES`,`UPDATE public."${table}" SET "id"="id"`,`DELETE FROM public."${table}"`,`TRUNCATE public."${table}"`])
            await assert.rejects(roleTransaction(role, (sql) => sql.$executeRawUnsafe(command)), /permission denied/);
        }
        await assert.rejects(roleTransaction(role, (sql) => sql.$executeRaw`UPDATE public."Wallet" SET "available"=10 WHERE "id"=${walletId}`), /permission denied/);
        for (const target of ["enta_finance_executor","enta_outbox_worker",...Object.keys(clients).filter((target) => target!==role)])
          await assert.rejects(roleTransaction(role, (sql) => sql.$executeRawUnsafe(`SET LOCAL ROLE ${target}`)), /permission denied/);
        await assert.rejects(roleTransaction(role, (sql) => sql.$executeRawUnsafe('CREATE TABLE public.int5b_forbidden(id TEXT)')), /permission denied/);
        await assert.rejects(roleTransaction(role, (sql) => sql.$executeRawUnsafe('CREATE TABLE int4_crypto.int5b_forbidden(id TEXT)')), /permission denied/);
        await assert.rejects(roleTransaction(role, (sql) => sql.$executeRawUnsafe('CREATE FUNCTION public.int5b_forbidden() RETURNS INTEGER LANGUAGE sql AS $$ SELECT 1 $$')), /permission denied/);
        const forbidden = ["SELECT public.int5b_hash_json('{}'::jsonb)"];
        if (role !== "enta_huroof_reserver") forbidden.push("SELECT public.int5b_lock_wallet('none','none')","SELECT public.int5b_find_admission('none',NULL,NULL)","SELECT public.int5b_huroof_readiness()","SELECT public.int5b_reserve_huroof('{}'::jsonb,'none','{}'::jsonb)");
        if (role !== "enta_huroof_provisioner") forbidden.push("SELECT public.int5b_claim_huroof('owner')");
        if (role !== "enta_huroof_reconciler") forbidden.push("SELECT public.int5b_finish_huroof('none','owner',1,NULL)");
        for (const command of forbidden) await assert.rejects(roleTransaction(role,(sql)=>sql.$queryRawUnsafe(command)),/permission denied/);
        const rows = await roleTransaction(role, (sql) => sql.$queryRaw<Array<{ member: boolean }>>`SELECT pg_has_role(current_user,'enta_finance_executor','member') AS member`);
        assert.equal(rows[0].member, false);
      }
      await assert.rejects(roleTransaction("enta_huroof_provisioner", (sql) => sql.$queryRaw`SELECT public.int5b_finish_huroof('none','owner',1,NULL)`), /permission denied/);
      await assert.rejects(roleTransaction("enta_huroof_reserver", (sql) => sql.$queryRaw`SELECT public.int5b_claim_huroof('owner')`), /permission denied/);
    });
    await t.test("stale fence cannot settle; typed cancellation settles once with reconciled ledger", async () => {
      // This fixture selects its own reviewed test job; no global queue assumption.
      const jobs = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM public."AdmissionOutbox" WHERE "admissionId"=${winner.binding.admissionId}`;
      assert.equal(jobs.length, 1);
      // Claim order remains deterministic on a fresh disposable target. If a
      // previous test left work, fail rather than settling the wrong admission.
      const leases = await roleTransaction("enta_huroof_provisioner", (sql) => sql.$queryRaw<Array<{ value: { jobId: string; leaseVersion: number; leaseOwner: string; binding: HuroofBinding } }>>`SELECT public.int5b_claim_huroof('int5b-test-worker') AS value`);
      const lease = leases[0].value; assert.equal(lease.binding.admissionId, winner.binding.admissionId, "use a fresh disposable target");
      const proof: HuroofProof = { version: 1, binding: winner.binding, state: "CANCELLED", provision: null, terminal: { version: 1, kind: "CANCEL", actorUid: "internal-canceller", intentId: "synthetic-tombstone", requestHash: "d".repeat(64), fromRevision: 0, toRevision: 1 } };
      const finish = (fence: number | null, candidate: unknown, owner = lease.leaseOwner) => roleTransaction("enta_huroof_reconciler", (sql) => sql.$queryRaw<Array<{ value: boolean }>>`SELECT public.int5b_finish_huroof(${lease.jobId},${owner},${fence}::INTEGER,${candidate === null ? null : JSON.stringify(candidate)}::jsonb) AS value`);
      const snapshot = () => db.$queryRaw`SELECT row_to_json(w) AS wallet,(SELECT jsonb_agg(e) FROM public."WalletEntry" e WHERE e."walletId"=w."id") AS ledger,(SELECT jsonb_agg(j) FROM public."AdmissionOutbox" j WHERE j."id"=${lease.jobId}) AS job,(SELECT jsonb_agg(a) FROM public."Admission" a WHERE a."id"=${winner.binding.admissionId}) AS admission,(SELECT jsonb_agg(r) FROM public."Reservation" r WHERE r."admissionId"=${winner.binding.admissionId}) AS reservation,(SELECT jsonb_agg(p) FROM public."HuroofAdmissionProof" p WHERE p."admissionId"=${winner.binding.admissionId}) AS proof FROM public."Wallet" w WHERE w."id"=${walletId}`;
      const before = await snapshot();
      for (const fence of [null, 0, -1, lease.leaseVersion - 1, lease.leaseVersion + 1]) for (const candidate of [null, proof]) {
        assert.equal((await finish(fence, candidate))[0].value, false); assert.deepEqual(await snapshot(), before);
      }
      assert.equal((await finish(lease.leaseVersion, proof, "wrong-owner"))[0].value, false); assert.deepEqual(await snapshot(), before);
      assert.equal((await finish(lease.leaseVersion - 1, proof))[0].value, false);
      await assert.rejects(finish(lease.leaseVersion, { state: "CANCELLED" }), /typed terminal proof/);
      for (const candidate of [
        { ...proof, version: "1" }, { ...proof, provision: undefined }, { ...proof, provision: { version: 1, kind: "PROVISION", configHash: winner.binding.configHash } },
        { ...proof, terminal: { ...proof.terminal, version: "1" } }, { ...proof, terminal: { ...proof.terminal, fromRevision: "0", toRevision: "1" } },
        { ...proof, terminal: { ...proof.terminal, actorUid: "" } }, { ...proof, terminal: { ...proof.terminal, intentId: "bad/path" } },
        { ...proof, terminal: { ...proof.terminal, fromRevision: 9007199254740991, toRevision: 9007199254740992 } },
      ]) { assert.throws(() => assertProof(winner.binding, candidate as HuroofProof)); await assert.rejects(finish(lease.leaseVersion, candidate), /typed terminal proof/); assert.deepEqual(await snapshot(), before); }
      assert.equal((await finish(lease.leaseVersion, proof))[0].value, true);
      assert.equal((await finish(lease.leaseVersion, proof))[0].value, false);
      const rows = await db.$queryRaw<Array<{ available: bigint; held: bigint; version: bigint }>>`SELECT "available","held","version" FROM public."Wallet" WHERE "id"=${walletId}`;
      assert.deepEqual(rows[0], { available: 1n, held: 0n, version: 3n });
      const effects = await db.$queryRaw<Array<{ effect: string }>>`SELECT "effect" FROM public."WalletEntry" WHERE "walletId"=${walletId} ORDER BY "sequence"`;
      assert.deepEqual(effects.map((row) => row.effect), ["FREE_FIRST_GRANT", "RESERVE", "RELEASE"]);
      // A correct body, a valid request hash and a replenished wallet isolate
      // logical-match uniqueness from insufficient credit / malformed hashes.
      const changedKey = bindingFor(winner.binding.logicalMatchId);
      await assert.rejects(reserve(changedKey), /unique|logicalMatch/i);
      assert.deepEqual((await db.$queryRaw<Array<{ available: bigint; held: bigint }>>`SELECT "available","held" FROM public."Wallet" WHERE "id"=${walletId}`)[0], { available: 1n, held: 0n });
    });
    await t.test("funded same-key concurrency has one hold and stable exact retry", async () => {
      const candidate = bindingFor();
      await Promise.all([reserve(candidate), reserve(candidate)]);
      const entries = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM public."WalletEntry" WHERE "originId"=${candidate.binding.admissionId} AND "effect"='RESERVE'`;
      assert.equal(entries[0].count, 1n);
      const lease = await claim(); assert.ok(lease); assert.equal(lease.binding.admissionId, candidate.binding.admissionId);
      assert.equal(await finishLease(lease, terminal(candidate.binding, "CANCELLED")), true);
    });
    await t.test("SQL and Node typed-proof conformance uses the same complete and malformed values",async()=>{
      const binding=winner.binding,proof=terminal(binding,"STARTED"),cancel=terminal(binding,"CANCELLED");
      const values:unknown[]=[proof,cancel,{ ...proof,state:"RESERVED",terminal:null },{ ...cancel,provision:proof.provision }];
      for (const base of [proof,cancel]) values.push(
        { ...base,version:"1" },{ ...base,version:null },{ ...base,binding:null },{ ...base,provision:undefined },{ ...base,provision:false },
        { ...base,provision:{ ...proof.provision,version:"1" } },{ ...base,provision:{ ...proof.provision,roomCode:12345678 } },
        { ...base,provision:{ version:1,kind:"PROVISION",configHash:binding.configHash } },{ ...base,terminal:null },
        ...["actorUid","intentId","requestHash","fromRevision","toRevision","version"].map((field)=>({ ...base,terminal:{ ...base.terminal,[field]:null } })),
        { ...base,terminal:{ ...base.terminal,fromRevision:"1",toRevision:"2" } },{ ...base,terminal:{ ...base.terminal,actorUid:"bad/path" } },
        { ...base,terminal:{ ...base.terminal,fromRevision:9007199254740991,toRevision:9007199254740992 } });
      for (const value of values) {
        let accepted=true; try { assertProof(binding,value as HuroofProof); } catch { accepted=false; }
        const sql=(await db.$queryRaw<Array<{ accepted:boolean }>>`SELECT public.int5b_valid_proof(${JSON.stringify(binding)}::jsonb,${JSON.stringify(value)}::jsonb) AS accepted`)[0].accepted;
        assert.equal(sql,accepted,JSON.stringify(value));
      }
    });
    await t.test("typed binding, owner/project/release/config/policy NULL pins and predecessors deny without holds", async () => {
      const before = await state();
      for (const patch of [
        { version: "1" }, { version: null }, { projectId: "wrong-project" }, { uid: "wrong-owner" }, { identityId: "missing-owner" },
        { roomId: null }, { roomId: "bad/path" }, { roomId: winner.binding.roomId }, { releaseId: "wrong-release" }, { releaseRootHash: "f".repeat(64) }, { validationReceiptId:"wrong-receipt" }, { catalogReleaseId:"wrong-catalog" }, { catalogRootHash:"f".repeat(64) }, { configHash: "f".repeat(64) },
        { readinessPolicyVersion: "wrong-policy" }, { readinessPolicyVersion: null }, { capabilityHash: null }, { predecessorId: "missing-predecessor" },
        { predecessorId: winner.binding.admissionId },
      ]) {
        const candidate = bindingFor(), binding = { ...candidate.binding, ...patch };
        const intentHash = admissionHash({ engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: binding.logicalMatchId, config, predecessorId: binding.predecessorId });
        binding.requestHash = admissionHash({ version: 1, requestKey: binding.requestKey, intentHash });
        await assert.rejects(reserve({ binding: binding as HuroofBinding, intentHash })); assert.deepEqual(await state(), before);
      }
      for (const field of ["admissionId","identityId","projectId","uid","logicalMatchId","roomId","requestKey","catalogReleaseId","catalogRootHash","validationReceiptId","releaseId","releaseRootHash","selectorVersion","readinessPolicyVersion","capabilityHash","configHash","predecessorId"]) {
        const candidate = bindingFor(), binding = { ...candidate.binding }; delete (binding as unknown as Record<string, unknown>)[field];
        await assert.rejects(reserve({ ...candidate, binding })); assert.deepEqual(await state(), before);
      }
      for (const patch of [{ demo: "false" }, { policyVersion: "1" }, { questionSeconds: "20" }, { categories: [] }, { categories: ["synthetic-category","synthetic-category"] }, { challenge: null }, { teams: { horizontal: "", vertical: "\u0628" } }]) {
        const candidate = bindingFor(), invalidConfig = { ...config, ...patch }, binding = { ...candidate.binding, configHash: admissionHash(invalidConfig) };
        const intentHash = admissionHash({ engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: binding.logicalMatchId, config: invalidConfig, predecessorId: null });
        binding.requestHash = admissionHash({ version: 1, requestKey: binding.requestKey, intentHash });
        await assert.rejects(roleTransaction("enta_huroof_reserver", (sql) => sql.$executeRaw`SELECT public.int5b_reserve_huroof(${JSON.stringify(binding)}::jsonb,${intentHash},${JSON.stringify(invalidConfig)}::jsonb)`)); assert.deepEqual(await state(), before);
      }
      await assert.rejects(db.$executeRaw`UPDATE public."FirebaseIdentity" SET "firebaseUid"='retargeted' WHERE "id"=${identityId}`, /immutable/);
      await assert.rejects(db.$executeRaw`UPDATE public."Admission" SET "roomId"='retargeted',"version"="version"+1 WHERE "id"=${winner.binding.admissionId}`, /immutable|transition/);
      assert.deepEqual(await state(), before);
    });
    await t.test("COMMIT/RELEASE final-row denial from each admission reservation ledger and proof source", async () => {
      const candidate = bindingFor(); await reserve(candidate); const before = await state();
      for (const outcome of ["COMMITTED","RELEASED"] as const) for (const source of ["admission","reservation","ledger","proof"] as const) {
        await assert.rejects(db.$transaction(async (sql) => {
          await sql.$queryRaw`SELECT 1 FROM public."Wallet" WHERE "id"=${walletId} FOR UPDATE`;
          if (source === "admission") await sql.$executeRaw`UPDATE public."Admission" SET "state"=${outcome},"version"="version"+1 WHERE "id"=${candidate.binding.admissionId}`;
          if (source === "reservation") await sql.$executeRaw`UPDATE public."Reservation" SET "state"=${outcome},"committedAt"=${outcome === "COMMITTED" ? new Date() : null},"releasedAt"=${outcome === "RELEASED" ? new Date() : null} WHERE "admissionId"=${candidate.binding.admissionId}`;
          if (source === "proof") {
            const proof = terminal(candidate.binding, outcome === "COMMITTED" ? "STARTED" : "CANCELLED");
            await sql.$executeRaw`INSERT INTO public."HuroofAdmissionProof"("id","admissionId","proofVersion","terminalState","proof") VALUES(${randomUUID()},${candidate.binding.admissionId},1,${proof.state},${JSON.stringify(proof)}::jsonb)`;
          }
          if (source === "ledger") {
            const effect = outcome === "COMMITTED" ? "COMMIT" : "RELEASE", delta = outcome === "COMMITTED" ? 0 : 1;
            await sql.$executeRaw`INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") SELECT ${randomUUID()},w."id",w."version"+1,'ADMISSION',a."id",${effect},r."id",${delta},-1,0,w."available"+${delta},w."held"-1,w."debt",a."firebaseIdentityId" FROM public."Wallet" w JOIN public."Admission" a ON a."walletId"=w."id" JOIN public."Reservation" r ON r."admissionId"=a."id" WHERE a."id"=${candidate.binding.admissionId}`;
            await sql.$executeRaw`UPDATE public."Wallet" SET "available"="available"+${delta},"held"="held"-1,"version"="version"+1 WHERE "id"=${walletId}`;
          }
          await sql.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        }), /agree|matching|unsettled|proof|effect/);
        assert.deepEqual(await state(), before);
      }
      const lease = await claim(); assert.ok(lease); assert.equal(await finishLease(lease, terminal(candidate.binding,"CANCELLED")), true);
    });
    for (const reclaim of [false,true]) await t.test(`wallet wait crosses real lease expiry${reclaim ? ' and simultaneous reclaim fences the old finisher' : ' without a reclaim'}`, async () => {
      const candidate = bindingFor(); await reserve(candidate); const lease = await claim("original-worker"); assert.ok(lease);
      let locked!: () => void, unlock!: () => void;
      const lockedPromise = new Promise<void>((resolve) => { locked = resolve; }), release = new Promise<void>((resolve) => { unlock = resolve; });
      const blocker = db.$transaction(async (sql) => { await sql.$queryRaw`SELECT 1 FROM public."Wallet" WHERE "id"=${walletId} FOR UPDATE`; locked(); await release; }, { timeout: 60000 });
      await lockedPromise;
      let finishError: unknown;
      const finishing = finishLease(lease, terminal(candidate.binding,"CANCELLED")).catch((error:unknown)=>{ finishError=error; return undefined; });
      // Observe an actual PostgreSQL lock wait before crossing its real 30s deadline.
      let waiting = false;
      for (let i=0;i<100;i++) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%int5b_finish_huroof%' AND wait_event_type='Lock'`;
        if (rows[0].count>0n) { waiting=true; break; } await new Promise((resolve) => setTimeout(resolve,20));
      }
      if (!waiting) { unlock(); await blocker; await finishing; assert.fail(`settlement must be observed blocked on the held wallet: ${String(finishError)}`); }
      const deadline = (await db.$queryRaw<Array<{ expires: Date }>>`SELECT "leaseExpiresAt" AS expires FROM public."AdmissionOutbox" WHERE "id"=${lease.jobId}`)[0].expires;
      await new Promise((resolve) => setTimeout(resolve,Math.max(0,deadline.getTime()-Date.now()+150)));
      let replacement: Awaited<ReturnType<typeof claim>> = null;
      try { replacement = reclaim ? await claim("replacement-worker") : null; } finally { unlock(); await blocker; }
      if (reclaim) { assert.ok(replacement); assert.equal(replacement.jobId,lease.jobId); assert.equal(replacement.leaseVersion,lease.leaseVersion+1); }
      assert.equal(await finishing,false); assert.equal(finishError,undefined);
      const current = replacement ?? await claim("after-expiry"); assert.ok(current);
      assert.equal(await finishLease(current,terminal(candidate.binding,"CANCELLED")),true);
    });
    await t.test("real STARTED COMMIT and duplicate/lost response have one terminal debit", async () => {
      const candidate = bindingFor(); await reserve(candidate); const lease = await claim(); assert.ok(lease);
      const proof = terminal(candidate.binding,"STARTED");
      assert.equal(await finishLease(lease,proof),true); assert.equal(await finishLease(lease,proof),false);
      const rows = await db.$queryRaw<Array<{ available: bigint; held: bigint }>>`SELECT "available","held" FROM public."Wallet" WHERE "id"=${walletId}`;
      assert.deepEqual(rows[0],{ available:0n,held:0n });
      const entries = await db.$queryRaw<Array<{ effect: string }>>`SELECT "effect" FROM public."WalletEntry" WHERE "originId"=${candidate.binding.admissionId} ORDER BY "sequence"`;
      assert.deepEqual(entries.map((row)=>row.effect),["RESERVE","COMMIT"]);
      await assert.rejects(db.$executeRaw`UPDATE public."HuroofAdmissionProof" SET "terminalState"='CANCELLED' WHERE "admissionId"=${candidate.binding.admissionId}`,/append-only/);
      // INT5A intentionally supports only the one free credit at this stage.
      // Verify the valid rematch predecessor INSERT guard in a rolled-back
      // transaction; do not invent a top-up effect to fund a second match.
      const child=bindingFor(),binding={ ...child.binding,predecessorId:candidate.binding.admissionId };
      const intentHash=admissionHash({ engine:"HUROOF",operation:"HOSTED_HUROOF",logicalMatchId:binding.logicalMatchId,config,predecessorId:binding.predecessorId }); binding.requestHash=admissionHash({ version:1,requestKey:binding.requestKey,intentHash });
      await assert.rejects(db.$transaction(async(sql)=>{
        await sql.$executeRaw`INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","selectorVersion","roomProjectId","roomId","huroofBinding","huroofConfig","predecessorAdmissionId","huroofCatalogReleaseId","huroofCatalogRootHash","huroofValidationReceiptId","updatedAt") VALUES(${binding.admissionId},${identityId},${walletId},'HUROOF','HOSTED_HUROOF',${binding.logicalMatchId},${binding.requestKey},${binding.requestHash},${intentHash},1,${binding.selectorVersion},${binding.projectId},${binding.roomId},${JSON.stringify(binding)}::jsonb,${JSON.stringify(config)}::jsonb,${binding.predecessorId},${binding.catalogReleaseId},${binding.catalogRootHash},${binding.validationReceiptId},clock_timestamp())`;
        throw new Error("VALID_PREDECESSOR_GUARD_ACCEPTED_ROLLBACK");
      }),/VALID_PREDECESSOR_GUARD_ACCEPTED_ROLLBACK/);
    });
    await t.test("historical Enta and legacy game fingerprints remain byte-equivalent",async()=>{ assert.deepEqual(await legacyFingerprint(),legacyBefore); });
  } finally { await Promise.all([db.$disconnect(),...Object.values(clients).map((client)=>client.$disconnect())]); }
});
