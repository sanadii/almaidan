import type { PrismaClient, Prisma } from "@prisma/client";
import { assertBinding, type HuroofBinding } from "./huroof-protocol.cjs";
import type { HuroofReserveStore, HuroofReadiness } from "./huroof-reserve.js";
import type { HuroofLease, HuroofLeaseClaimer, HuroofLeaseSettler } from "./huroof-worker.js";

type SQL = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
async function single<T>(sql: SQL, query: Prisma.Sql): Promise<T | null> {
  const rows = await sql.$queryRaw<Array<{ value: T | null }>>(query);
  if (rows.length !== 1) throw new Error("ADMISSION_OPERATION_RESULT_INVALID");
  return rows[0].value;
}
import { Prisma as PrismaSQL } from "@prisma/client";

/** Dedicated reserver credentials; no direct financial SELECT/DML. */
export function postgresHuroofReserveStore(prisma: PrismaClient): HuroofReserveStore {
  return { transaction: (work) => prisma.$transaction(async (sql) => work({
    async lockWallet(project, uid) {
      const row = await single<{ identityId: string; available: string; debt: string }>(sql, PrismaSQL.sql`SELECT public.int5b_lock_wallet(${project},${uid}) AS value`);
      if (!row) throw new Error("WALLET_NOT_PROVISIONED");
      return { identityId: row.identityId, available: BigInt(row.available), debt: BigInt(row.debt) };
    },
    async findRequest(identity, key) {
      const row = await single<{ binding: HuroofBinding | null; intentHash: string; engine: string }>(sql, PrismaSQL.sql`SELECT public.int5b_find_admission(${identity},${key},NULL) AS value`);
      if (!row) return null;
      if (row.engine !== "HUROOF" || !row.binding) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      assertBinding(row.binding); return { binding: row.binding, intentHash: row.intentHash };
    },
    async findLogicalMatch(identity, logical) { return Boolean(await single(sql, PrismaSQL.sql`SELECT public.int5b_find_admission(${identity},NULL,${logical}) AS value`)); },
    async assertPredecessor(identity, predecessorId) {
      // The SQL insertion guard verifies the restrictive immutable same-owner
      // predecessor; no broadly readable predecessor query is exposed.
      if (!identity || !predecessorId) throw new Error("PREDECESSOR_INVALID");
    },
    async readReadiness() {
      const row = await single<HuroofReadiness>(sql, PrismaSQL.sql`SELECT public.int5b_huroof_readiness() AS value`);
      if (!row) throw new Error("HUROOF_READINESS_UNAVAILABLE");
      return row;
    },
    async reserve(binding, intentHash, config) {
      await sql.$executeRaw`SELECT public.int5b_reserve_huroof(${JSON.stringify(binding)}::jsonb,${intentHash},${JSON.stringify(config)}::jsonb)`;
    },
  })), };
}

/** Provisioner and reconciler use distinct Prisma clients/role identities. */
export function postgresHuroofLeaseClaimer(prisma: PrismaClient): HuroofLeaseClaimer {
  return { claim: (owner) => prisma.$transaction((sql) => single<HuroofLease>(sql, PrismaSQL.sql`SELECT public.int5b_claim_huroof(${owner}) AS value`)) };
}
export function postgresHuroofLeaseSettler(prisma: PrismaClient): HuroofLeaseSettler {
  return { async finish(lease, proof) {
    return await prisma.$transaction((sql) => single<boolean>(sql, PrismaSQL.sql`SELECT public.int5b_finish_huroof(${lease.jobId},${lease.leaseOwner},${lease.leaseVersion},${proof ? JSON.stringify(proof) : null}::jsonb) AS value`)) === true;
  } };
}
