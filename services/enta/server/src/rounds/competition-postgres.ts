import { Prisma, type PrismaClient } from '@prisma/client';
import { EntaError, fail } from '../gameplay/types';
import type { RuntimeConfig } from '../runtime-config';
import type { CompetitionRepository, CompetitionTransaction } from './competition-types';
const status: Record<string, number> = { MATCH_NOT_FOUND: 404, GRANT_DENIED: 403, MEDIA_DENIED: 403, VERIFIED_ACCOUNT_REQUIRED: 403, INSUFFICIENT_CREDIT: 402, ACCOUNT_NOT_READY: 503, COMPETITIVE_RECEIPT_POLICY_UNAVAILABLE: 503, COMPETITIVE_PROOF_UNAVAILABLE: 503, IDEMPOTENCY_KEY_CONFLICT: 409, COMMAND_KEY_CONFLICT: 409, STALE_VERSION: 409, ROUND_TIME_EXPIRED: 409, INVALID_PHASE: 409, RULING_REVIEW_OPEN: 409, UNDO_UNAVAILABLE: 409, CORRECTION_DEPENDENCY_REVIEW_REQUIRED: 409, STALE_REVIEW_HEAD: 409, PENDING_RULING_REQUIRED: 409, AID_UNAVAILABLE: 409, NO_ELIGIBLE_PLAYER: 409, STALE_CANVAS_REVISION: 409, CANVAS_BUDGET_EXCEEDED: 409 };
Object.assign(status, { INVALID_REQUEST: 400, INVALID_COMMAND: 400, INVALID_SETUP: 400, CANVAS_DENIED: 403, MATCH_FINISHED: 403, TIE_AUTHORITY_UNAVAILABLE: 403, RESULT_SUCCESSOR_AUTHORITY_UNAVAILABLE: 403,
  INVALID_PAGE_REQUEST: 400, PAGE_SNAPSHOT_RESTART: 409, GRADING_DENIED: 403, CATEGORY_UNAVAILABLE: 404, RESOURCE_LIMIT_REACHED: 409, OPTIONAL_CAPACITY_EXHAUSTED: 409, AUDIT_BUDGET_EXCEEDED: 409, CONTEXT_BOUND_EXCEEDED: 503, CATALOG_BOUND_EXCEEDED: 503, PAGE_PROOF_UNAVAILABLE: 503, CAPACITY_PROOF_UNAVAILABLE: 503, MEDIA_PROOF_UNAVAILABLE: 503, DRAFT5_COMPATIBILITY_REVIEW_REQUIRED: 503,
  AID_PAIRING_DENIED: 409, HINT_UNAVAILABLE: 409, ATTEMPT_ALREADY_CLASSIFIED: 409, ATTEMPT_BUDGET_EXCEEDED: 409, ATTEMPT_UNAVAILABLE: 409, COMPLETE_RULING_REQUIRED: 409, ITEM_RESOLVED: 409, ITEM_RULING_REQUIRED: 409, PUBLIC_REVEAL_REQUIRED: 409, RULING_ALREADY_FINAL: 409, CORRECTION_UNAVAILABLE: 409, ORIGINAL_ATTEMPT_REQUIRED: 409, STALE_RULING_HEAD: 409, EFFECT_BUDGET_EXCEEDED: 409, SCORE_BOUND_EXCEEDED: 409, ASSIGNMENT_UNAVAILABLE: 409, EARLY_FINISH_CONFIRMATION_REQUIRED: 409, NO_MORE_ROUNDS: 409, ROUND_PAUSED: 409, GRANT_ALREADY_ACTIVE: 409, STALE_GRANT_GENERATION: 409, RESULT_NOT_TERMINAL: 409, STALE_RESULT_HEAD: 409, WALLET_DEBT_BLOCKS_START: 409, CANVAS_EMPTY: 409, NO_REDO: 409,
  ATTEMPT_PROOF_UNAVAILABLE: 503, BONUS_PROOF_UNAVAILABLE: 503, EFFECT_PROOF_UNAVAILABLE: 503, ITEM_PROOF_UNAVAILABLE: 503, RULING_PROOF_UNAVAILABLE: 503, GRANT_DATA_UNAVAILABLE: 503, RESULT_AUTHORITY_UNAVAILABLE: 503, RESULT_BINDING_UNAVAILABLE: 503, RESULT_INTEGRITY_FAILURE: 503, TOURNAMENT_ALLOCATOR_UNAVAILABLE: 503, GRAPHEME_PROOF_UNAVAILABLE: 503, HINT_PROOF_UNAVAILABLE: 503, CANVAS_UNAVAILABLE: 503, MATCH_DATA_UNAVAILABLE: 503 });
/** Fixed restricted successor operations. No caller-selected SQL, approval
 * setting, financial DML, cloud IO or fixture fallback. Constructor is inert. */
export function postgresCompetitionRepository(prisma: PrismaClient, config: Pick<RuntimeConfig, 'firebaseProjectId' | 'namespaceId'>): CompetitionRepository {
  return { source: 'postgres', projectId: config.firebaseProjectId, async transaction<T>(work: (tx: CompetitionTransaction) => Promise<T>): Promise<T> {
    try { return await prisma.$transaction(async sql => {
      async function one<V>(query: Prisma.Sql): Promise<V> { const rows = await sql.$queryRaw<{ value: V }[]>(query); if (rows.length !== 1 || !Object.hasOwn(rows[0], 'value')) return fail(503, 'ENTA_UNAVAILABLE'); return rows[0].value; }
      return work({
        nativeScope: (p, hash, gameId) => p ? one(Prisma.sql`SELECT public.int9_owner_load(${config.namespaceId},${p.projectId},${p.uid},${gameId},TRUE) AS value`) : one(Prisma.sql`SELECT public.int9_grant_load(${config.namespaceId},${config.firebaseProjectId},${gameId},${hash}) AS value`),
        nativeDisclose: (hash, gameId) => one(Prisma.sql`SELECT public.int9_disclose(${config.namespaceId},${config.firebaseProjectId},${gameId},${hash}) AS value`),
        nativeCanvasMutation: (hash, gameId, snapshot, command) => one(Prisma.sql`SELECT public.int9_apply(${config.namespaceId},${config.firebaseProjectId},NULL,${hash},${gameId},${snapshot},${JSON.stringify(command)}::jsonb,'{"grants":[]}'::jsonb) AS value`),
        nativeCanvasPage: (p, hash, gameId, roundId, snapshot, revision, offset) => one(Prisma.sql`SELECT public.int9_page_rows(${config.namespaceId},${config.firebaseProjectId},${p?.uid ?? null},${hash},${gameId},${JSON.stringify({ collection: 'canvas', roundId, effectId: null, snapshot, canvasRevision: revision, offset })}::jsonb) AS value`),
        nativeGet: (p, gameId) => one(Prisma.sql`SELECT public.int9_apply(${config.namespaceId},${p.projectId},${p.uid},NULL,${gameId},NULL,NULL::jsonb,'{"grants":[]}'::jsonb) AS value`),
        nativeCatalog: (p, format, categoryKey, snapshot, offset) => one(Prisma.sql`SELECT public.int9_catalog_page(${config.namespaceId},${p.projectId},${p.uid},${format},${categoryKey},${snapshot},${offset}::bigint) AS value`),
        nativeMediaManifest: (p, hash, gameId, mediaId, gradingRoundId, snapshot) => one(Prisma.sql`SELECT public.int9_media_manifest(${config.namespaceId},${config.firebaseProjectId},${p?.uid ?? null},${hash},${gameId},${mediaId},${gradingRoundId},${snapshot}) AS value`),
        nativePage: (p, hash, gameId, request, offset) => one(Prisma.sql`SELECT public.int9_page_rows(${config.namespaceId},${config.firebaseProjectId},${p?.uid ?? null},${hash},${gameId},${JSON.stringify({ collection: request.collection, roundId: request.roundId, effectId: request.effectId, snapshot: request.snapshot, offset })}::jsonb) AS value`),
        nativeStart: (p, request, seed) => one(Prisma.sql`SELECT public.int9_start_request(${config.namespaceId},${p.projectId},${p.uid},${JSON.stringify(request)}::jsonb,${seed}) AS value`),
        nativeCommand: (p, gameId, command, entropy) => one(Prisma.sql`SELECT public.int9_apply(${config.namespaceId},${p.projectId},${p.uid},NULL,${gameId},${command.expectedVersion},${JSON.stringify(command)}::jsonb,${JSON.stringify(entropy ? { grants: [entropy] } : { grants: [] })}::jsonb) AS value`),
        async lockWallet(p) { const wallet = await one<{ identityId: string; available: string; debt: string }>(Prisma.sql`SELECT public.int6_enta_lock_wallet(${config.namespaceId},${p.projectId},${p.uid}) AS value`); return { identityId: wallet.identityId, available: BigInt(wallet.available), debt: BigInt(wallet.debt) }; },
        findStart: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        catalog: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        exposures: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        create: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        async loadOwner() { return fail(503, 'DRAFT5_OPERATION_RETIRED'); },
        locateGrant: hash => one(Prisma.sql`SELECT public.int9_locate_grant(${config.namespaceId},${config.firebaseProjectId},${hash}) AS value`),
        async loadGrant() { return fail(503, 'DRAFT5_OPERATION_RETIRED'); },
        save: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        disclose: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        audit: async () => fail(503, 'DRAFT5_OPERATION_RETIRED'),
        hasAuditCommand: (p, gameId, commandId) => one(Prisma.sql`SELECT public.int9_has_report(${config.namespaceId},${p.projectId},${p.uid},${gameId},${commandId}) AS value`),
        now: () => one(Prisma.sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::float8 AS value`),
      });
    }, { maxWait: 5000, timeout: 20000 }); } catch (error) { if (error instanceof EntaError) throw error; const message = (error as { meta?: { message?: unknown } })?.meta?.message; if (typeof message === 'string') for (const [code, value] of Object.entries(status)) if (new RegExp(`\\b${code}\\b`).test(message)) return fail(value, code); return fail(503, 'ENTA_UNAVAILABLE'); }
  } };
}
