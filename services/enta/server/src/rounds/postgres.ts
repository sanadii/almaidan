import { Prisma, type PrismaClient } from '@prisma/client';
import type { RuntimeConfig } from '../runtime-config';
import { EntaError, fail } from '../gameplay/types';
import type { RoundRepository, RoundTransaction } from './types';
const errors: Record<string, number> = { MATCH_NOT_FOUND: 404, GRANT_DENIED: 403, MEDIA_DENIED: 403, INSUFFICIENT_CREDIT: 402, ACCOUNT_NOT_READY: 503, FORMAT_RECEIPT_POLICY_UNAVAILABLE: 503, FORMAT_CATALOG_UNAVAILABLE: 503, IDEMPOTENCY_KEY_CONFLICT: 409, COMMAND_KEY_CONFLICT: 409, STALE_VERSION: 409, ROUND_TIME_EXPIRED: 409, INVALID_PHASE: 409, STALE_CANVAS_REVISION: 409, CANVAS_BUDGET_EXCEEDED: 409 };
/** Restricted real adapter. No broad Game/financial DML, environment-selected
 * fixture, client-supplied permission or native recovery entrypoint. */
export function postgresRoundRepository(prisma: PrismaClient, config: Pick<RuntimeConfig, 'firebaseProjectId' | 'namespaceId'>): RoundRepository {
  return { source: 'postgres', projectId: config.firebaseProjectId, async transaction<T>(work: (tx: RoundTransaction) => Promise<T>): Promise<T> {
    try { return await prisma.$transaction(async sql => {
      async function one<V>(query: Prisma.Sql): Promise<V> { const rows = await sql.$queryRaw<{ value: V }[]>(query); if (rows.length !== 1 || !Object.hasOwn(rows[0], 'value')) return fail(503, 'ENTA_UNAVAILABLE'); return rows[0].value; }
      let actingUid: string | null = null, actingHash: string | null = null;
      return work({
        async lockWallet(principal) { const wallet = await one<{ identityId: string; available: string; debt: string }>(Prisma.sql`SELECT public.int6_enta_lock_wallet(${config.namespaceId},${principal.projectId},${principal.uid}) AS value`); return { identityId: wallet.identityId, available: BigInt(wallet.available), debt: BigInt(wallet.debt) }; },
        findStart: (principal, requestKey, logicalId) => one(Prisma.sql`SELECT public.int8_find_start(${config.namespaceId},${principal.projectId},${principal.uid},${requestKey},${logicalId}) AS value`),
        catalog: (principal, format) => one(Prisma.sql`SELECT public.int8_catalog(${config.namespaceId},${principal.projectId},${principal.uid},${format}) AS value`),
        exposures: (principal, format, categoryKey) => one(Prisma.sql`SELECT public.int8_exposures(${config.namespaceId},${principal.projectId},${principal.uid},${format},${categoryKey}) AS value`),
        create: (principal, request, intent, pins, catalog) => one(Prisma.sql`SELECT public.int8_start(${config.namespaceId},${principal.projectId},${principal.uid},${JSON.stringify(request)}::jsonb,${JSON.stringify(intent)}::jsonb,${JSON.stringify(pins)}::jsonb,${catalog.receiptId}) AS value`),
        async loadOwner(principal, gameId, lock) { actingUid = principal.uid; actingHash = null; return one(Prisma.sql`SELECT public.int8_owner_load(${config.namespaceId},${principal.projectId},${principal.uid},${gameId},${lock}) AS value`); },
        locateGrant: hash => one(Prisma.sql`SELECT public.int8_locate_grant(${config.namespaceId},${config.firebaseProjectId},${hash}) AS value`),
        async loadGrant(gameId, hash) { actingUid = null; actingHash = hash; return one(Prisma.sql`SELECT public.int8_grant_load(${config.namespaceId},${config.firebaseProjectId},${gameId},${hash}) AS value`); },
        save: (before, next, command) => one(Prisma.sql`SELECT public.int8_apply(${config.namespaceId},${config.firebaseProjectId},${actingUid},${actingHash},${before.id},${before.version},${JSON.stringify(command)}::jsonb,${JSON.stringify(next)}::jsonb) AS value`),
        now: () => one(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS value`),
      });
    }, { maxWait: 5000, timeout: 20000 }); } catch (error) { if (error instanceof EntaError) throw error; const message = (error as { meta?: { message?: unknown } })?.meta?.message; if (typeof message === 'string') for (const [code, status] of Object.entries(errors)) if (new RegExp(`\\b${code}\\b`).test(message)) return fail(status, code); return fail(503, 'ENTA_UNAVAILABLE'); }
  } };
}
