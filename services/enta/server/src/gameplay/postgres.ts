import { Prisma, type PrismaClient } from "@prisma/client";
import type { RuntimeConfig } from "../runtime-config";
import type { EntaRepository, EntaTransaction } from "./repository";
import { EntaError, fail, type MatchRecord } from "./types";

const EXPECTED_ERRORS: Record<string, number> = { MATCH_NOT_FOUND: 404, INSUFFICIENT_CREDIT: 402, STALE_VERSION: 409, COMMAND_KEY_CONFLICT: 409, IDEMPOTENCY_KEY_CONFLICT: 409, LOGICAL_MATCH_ALREADY_CHARGED: 409, INVALID_PHASE: 409, QUESTION_UNAVAILABLE: 409, UNRESOLVED_QUESTION: 409, EARLY_FINISH_CONFIRMATION_REQUIRED: 409, MATCH_FINISHED: 409, WALLET_DEBT_BLOCKS_START: 409, CATEGORY_UNAVAILABLE: 409, INVALID_REQUEST: 400, CATALOG_RECEIPT_POLICY_UNAVAILABLE: 503, CATALOG_UNAVAILABLE: 503, ACCOUNT_NOT_READY: 503, INVALID_HISTORY_QUERY: 400, INVALID_HISTORY_CURSOR: 400, PREDECESSOR_NOT_FINISHED: 409, PREDECESSOR_VERSION_CONFLICT: 409 };
function databaseFailure(error: unknown): never {
  if (error instanceof EntaError) throw error;
  const meta = error && typeof error === "object" ? (error as { meta?: { message?: unknown } }).meta : undefined;
  const message = typeof meta?.message === "string" ? meta.message : "";
  for (const [code, status] of Object.entries(EXPECTED_ERRORS)) if (new RegExp(`\\b${code}\\b`).test(message)) return fail(status, code);
  return fail(503, "ENTA_UNAVAILABLE");
}
function validateStoredGame(game: MatchRecord | null): MatchRecord | null {
  if (game === null) return null;
  if (!game || !["CLASSIC", "KIDS"].includes(game.mode ?? "") || !Number.isSafeInteger(game.version) || !["BOARD", "QUESTION_OPEN", "REVEALED", "FINISHED"].includes(game.phase)
    || !Array.isArray(game.teams) || !Array.isArray(game.questions) || !Array.isArray(game.categories)) return fail(503, "MATCH_DATA_UNAVAILABLE");
  return game;
}

/** Real PostgreSQL default. Calls fixed restricted operations; no runtime DML,
 * test receipt policy, environment-selected mock, legacy question query or SDK
 * recovery machinery. Missing schema/grants/receipt/backend fail unavailable. */
export function postgresEntaRepository(prisma: PrismaClient, config: Pick<RuntimeConfig, "firebaseProjectId" | "namespaceId">): EntaRepository {
  return Object.freeze({
    source: "postgres" as const, projectId: config.firebaseProjectId,
    async transaction<T>(work: (transaction: EntaTransaction) => Promise<T>): Promise<T> {
      try {
        return await prisma.$transaction(async sql => {
          async function one<V>(query: Prisma.Sql): Promise<V> {
            const rows = await sql.$queryRaw<Array<{ value: V }>>(query);
            if (rows.length !== 1 || !Object.hasOwn(rows[0], "value")) return fail(503, "ENTA_UNAVAILABLE");
            return rows[0].value;
          }
          return work({
            resolveIdentity: principal => one(Prisma.sql`SELECT public.int6_enta_identity(${config.namespaceId},${principal.projectId},${principal.uid}) AS value`),
            async lockWallet(principal) {
              const row = await one<{ identityId: string; available: string; held: string; debt: string }>(Prisma.sql`SELECT public.int6_enta_lock_wallet(${config.namespaceId},${principal.projectId},${principal.uid}) AS value`);
              return { identityId: row.identityId, available: BigInt(row.available), held: BigInt(row.held), debt: BigInt(row.debt) };
            },
            findStart: (principal, requestKey, logicalId) => one(Prisma.sql`SELECT public.int7_enta_find_start(${config.namespaceId},${principal.projectId},${principal.uid},${requestKey},${logicalId}) AS value`),
            activeCatalog: principal => one(Prisma.sql`SELECT public.int6_enta_catalog(${config.namespaceId},${principal.projectId},${principal.uid}) AS value`),
            successorCatalog: (principal, _identityId, mode) => one(Prisma.sql`SELECT public.int7_enta_catalog(${config.namespaceId},${principal.projectId},${principal.uid},${mode}) AS value`),
            async createSuccessor(principal, prepared, catalog) {
              const row = await one<{ gameId: string }>(Prisma.sql`SELECT public.int7_enta_start(${config.namespaceId},${principal.projectId},${principal.uid},${JSON.stringify(prepared)}::jsonb,${catalog.receipt.receiptId},${prepared.predecessor?.gameId ?? null}) AS value`);
              return validateStoredGame(await one(Prisma.sql`SELECT public.int7_enta_load(${config.namespaceId},${principal.projectId},${principal.uid},${row.gameId},false) AS value`)) ?? fail(503, "MATCH_DATA_UNAVAILABLE");
            },
            history: (principal, query) => one(Prisma.sql`SELECT public.int7_enta_history(${config.namespaceId},${principal.projectId},${principal.uid},${JSON.stringify(query)}::jsonb) AS value`),
            async createClassic(principal, prepared, catalog) {
              const row = await one<{ gameId: string }>(Prisma.sql`SELECT public.int6_enta_start(${config.namespaceId},${principal.projectId},${principal.uid},${JSON.stringify(prepared)}::jsonb,${catalog.receipt.receiptId}) AS value`);
              const game = await one<MatchRecord | null>(Prisma.sql`SELECT public.int7_enta_load(${config.namespaceId},${principal.projectId},${principal.uid},${row.gameId},false) AS value`);
              return validateStoredGame(game) ?? fail(503, "MATCH_DATA_UNAVAILABLE");
            },
            async loadMatch(principal, gameId, lock) { return validateStoredGame(await one(Prisma.sql`SELECT public.int7_enta_load(${config.namespaceId},${principal.projectId},${principal.uid},${gameId},${lock}) AS value`)); },
            findCommand: (principal, gameId, commandId) => one(Prisma.sql`SELECT public.int6_enta_receipt(${config.namespaceId},${principal.projectId},${principal.uid},${gameId},${commandId}) AS value`),
            applyCommand: (principal, gameId, command, intentHash) => one(Prisma.sql`SELECT public.int7_enta_command(${config.namespaceId},${principal.projectId},${principal.uid},${gameId},${JSON.stringify(command)}::jsonb,${intentHash}) AS value`),
            now: () => one(Prisma.sql`SELECT (extract(epoch FROM clock_timestamp())*1000)::float8 AS value`),
          });
        }, { maxWait: 5000, timeout: 20000 });
      } catch (error) { return databaseFailure(error); }
    },
  });
}
