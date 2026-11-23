import { admissionHash } from "../admission/huroof-protocol.cjs";
import { KIDS_SELECTOR, KIDS_SUITABILITY_POLICY, replayKidsProofs } from "../catalog/kids-selector";
import { CLASSIC_MODE_POLICY, type ModeReceiptVerifier } from "../wallet/enta-mode-policy";
import type { Principal } from "../identity";
import type { EntaRepository, EntaTransaction } from "./repository";
import { projectMatch, storedMatchMode } from "./projection";
import { fail, type EntaMode, type HistoryQuery, type HistoryRow, type MatchRecord, type PreparedCatalog, type PreparedSuccessor, type SuccessorCatalog, type SuccessorStart } from "./types";

const ID = /^[A-Za-z0-9_-]{1,128}$/, KEY = /^[A-Za-z0-9._:-]{8,128}$/, HASH = /^[a-f0-9]{64}$/;
type Helpers = { name(value: unknown, min: number, max: number): string; fold(value: string): string; verified(principal: Principal): void; owner(game: MatchRecord | null, principal: Principal): asserts game is MatchRecord; classic(catalog: PreparedCatalog, principal: Principal, identityId: string): void };
function exact(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "INVALID_REQUEST"); const row = value as Record<string, unknown>; if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail(400, "INVALID_REQUEST"); return row; }
export function parseSuccessor(input: unknown, mode: EntaMode, name: Helpers["name"], fold: Helpers["fold"], rematch = false): SuccessorStart & { predecessorVersion?: number } {
  const row = exact(input, ["requestKey", "logicalMatchId", "setup", ...(rematch ? ["predecessorVersion"] : [])]), setup = exact(row.setup, ["version", "categoryKeys", "teams", "rules"]), rules = exact(setup.rules, ["questionSeconds"]);
  if (typeof row.requestKey !== "string" || !KEY.test(row.requestKey) || typeof row.logicalMatchId !== "string" || !ID.test(row.logicalMatchId) || setup.version !== 3 || !Array.isArray(setup.categoryKeys) || setup.categoryKeys.length !== (mode === "KIDS" ? 1 : 6) || !setup.categoryKeys.every(key => typeof key === "string" && ID.test(key)) || new Set(setup.categoryKeys).size !== setup.categoryKeys.length || !Array.isArray(setup.teams) || setup.teams.length < 2 || setup.teams.length > 4 || !Number.isInteger(rules.questionSeconds) || (rules.questionSeconds as number) < 5 || (rules.questionSeconds as number) > 120) return fail(400, "INVALID_SETUP");
  if (rematch && (!Number.isSafeInteger(row.predecessorVersion) || (row.predecessorVersion as number) < 2 || (row.predecessorVersion as number) > 2_000_000_000)) return fail(400, "INVALID_REQUEST");
  const teams = setup.teams.map(value => { const team = exact(value, ["name", "players", "lifelines"]); if (!Array.isArray(team.players) || team.players.length < 1 || team.players.length > 8 || !Array.isArray(team.lifelines) || team.lifelines.length) return fail(400, "INVALID_SETUP"); return { name: name(team.name, 2, 22), players: team.players.map(player => name(player, 1, 30)), lifelines: [] as [] }; });
  if (new Set(teams.map(team => fold(team.name))).size !== teams.length) return fail(400, "DUPLICATE_TEAM_NAME");
  return { requestKey: row.requestKey, logicalMatchId: row.logicalMatchId, setup: { version: 3, categoryKeys: [...setup.categoryKeys], teams, rules: { questionSeconds: rules.questionSeconds as number } }, ...(rematch ? { predecessorVersion: row.predecessorVersion as number } : {}) };
}
export function prepareSuccessor(input: SuccessorStart, mode: EntaMode, predecessor: PreparedSuccessor["predecessor"]): PreparedSuccessor {
  const operation = mode === "KIDS" ? "PAID_ENTA_KIDS" : "PAID_ENTA_CLASSIC", startKind = predecessor ? "REMATCH" : "START";
  const intentHash = admissionHash({ version: 3, engine: "ENTA", operation, mode, startKind, predecessor, logicalMatchId: input.logicalMatchId, setup: input.setup });
  return { requestKey: input.requestKey, logicalMatchId: input.logicalMatchId, setup: input.setup, requestVersion: 3, mode, operation, startKind, predecessor, setupHash: admissionHash(input.setup), intentHash, requestHash: admissionHash({ version: 3, requestKey: input.requestKey, intentHash }) };
}
export function parseHistoryQuery(input: Record<string, unknown>): HistoryQuery {
  if (Object.keys(input).some(key => !["limit", "mode", "status", "cursor"].includes(key))) return fail(400, "INVALID_HISTORY_QUERY");
  const limit = input.limit === undefined ? 25 : typeof input.limit === "string" && /^\d{1,2}$/.test(input.limit) ? Number(input.limit) : 0;
  const mode = input.mode === undefined ? null : input.mode, status = input.status === undefined ? null : input.status;
  if (limit < 1 || limit > 50 || ![null, "CLASSIC", "KIDS"].includes(mode as null) || ![null, "ACTIVE", "FINISHED"].includes(status as null)) return fail(400, "INVALID_HISTORY_QUERY");
  let cursor: HistoryQuery["cursor"] = null;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(input.cursor)) return fail(400, "INVALID_HISTORY_CURSOR");
    try { const row = exact(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")), ["version", "id", "createdAt", "mode", "status"]); if (row.version !== 1 || typeof row.id !== "string" || !ID.test(row.id) || typeof row.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt) || new Date(row.createdAt).toISOString() !== row.createdAt || row.mode !== mode || row.status !== status) return fail(400, "INVALID_HISTORY_CURSOR"); cursor = { id: row.id, createdAt: row.createdAt }; } catch { return fail(400, "INVALID_HISTORY_CURSOR"); }
  }
  return { limit, mode: mode as HistoryQuery["mode"], status: status as HistoryQuery["status"], cursor };
}
export function validateSuccessorCatalog(catalog: SuccessorCatalog, principal: Principal, identityId: string, mode: EntaMode, helpers: Pick<Helpers, "classic">): void {
  const receipt = catalog.receipt;
  if (receipt.version !== 1 || receipt.projectId !== principal.projectId || receipt.identityId !== identityId || receipt.mode !== mode || receipt.operation !== (mode === "KIDS" ? "PAID_ENTA_KIDS" : "PAID_ENTA_CLASSIC") || !ID.test(receipt.reviewerIdentityId) || !HASH.test(receipt.rootHash) || catalog.categories.length < (mode === "KIDS" ? 1 : 6) || catalog.categories.length > 1000 || new Set(catalog.categories.map(category => category.key)).size !== catalog.categories.length) return fail(503, "CATALOG_UNAVAILABLE");
  if (mode === "CLASSIC") { if (!catalog.classic || receipt.policyVersion !== CLASSIC_MODE_POLICY || catalog.kidsSources.length || catalog.kidsProofs.length || receipt.targetCohort !== null || receipt.suitabilityManifestHash !== null || receipt.selectorVersion !== catalog.classic.receipt.selectorVersion || receipt.releaseId !== catalog.classic.receipt.releaseId || receipt.rootHash !== catalog.classic.receipt.rootHash || receipt.receiptId !== catalog.classic.receipt.receiptId) return fail(503, "CATALOG_UNAVAILABLE"); helpers.classic(catalog.classic, principal, identityId); if (admissionHash(catalog.categories) !== admissionHash(catalog.classic.categories)) return fail(503, "CATALOG_UNAVAILABLE"); return; }
  if (catalog.classic !== null || receipt.selectorVersion !== KIDS_SELECTOR || receipt.policyVersion !== KIDS_SUITABILITY_POLICY || !receipt.targetCohort || !ID.test(receipt.targetCohort) || receipt.suitabilityManifestHash !== admissionHash(catalog.kidsSources)) return fail(503, "CATALOG_UNAVAILABLE");
  try { replayKidsProofs(catalog.kidsSources, catalog.kidsProofs, catalog.categories.map(category => category.key), receipt.targetCohort); } catch { return fail(503, "CATALOG_UNAVAILABLE"); }
  for (const category of catalog.categories) {
    if (!ID.test(category.key) || !category.label.trim() || category.questions.length !== 6 || new Set(category.questions.map(question => question.sourceQuestionId)).size !== 6) return fail(503, "CATALOG_UNAVAILABLE");
    for (const points of [200, 400, 600]) { const selected = category.questions.filter(question => question.points === points), proof = catalog.kidsProofs.find(proof => proof.categoryKey === category.key && proof.tier === points); if (!proof || selected.length !== 2 || selected.some((question, index) => question.revisionId !== proof.fresh.ids[index] || question.categoryKey !== category.key || !question.prompt.trim() || question.answers.filter(answer => answer.isCorrect && !answer.isTrap).length < 1 || !catalog.kidsSources.some(source => source.revisionId === question.revisionId && source.contentHash === question.contentHash && source.suitability.reviewerIdentityId === receipt.reviewerIdentityId))) return fail(503, "CATALOG_UNAVAILABLE"); }
  }
}
export function successorOperations(repository: EntaRepository, policy: ModeReceiptVerifier, helpers: Helpers) {
  const catalog = async (tx: EntaTransaction, principal: Principal, identity: string, mode: EntaMode) => { if (!tx.successorCatalog) return fail(503, "ENTA_UNAVAILABLE"); const value = await tx.successorCatalog(principal, identity, mode); validateSuccessorCatalog(value, principal, identity, mode, helpers); await policy.assertEligible(value.receipt); return value; };
  async function start(principal: Principal, input: unknown, predecessorId: string | null) {
    helpers.verified(principal);
    return repository.transaction(async tx => {
      const identity = await tx.resolveIdentity(principal), wallet = await tx.lockWallet(principal);
      let predecessor: MatchRecord | null = null; if (predecessorId) { if (!ID.test(predecessorId)) return fail(404, "MATCH_NOT_FOUND"); predecessor = await tx.loadMatch(principal, predecessorId, true); helpers.owner(predecessor, principal); if (predecessor.phase !== "FINISHED") return fail(409, "PREDECESSOR_NOT_FINISHED"); }
      const mode = predecessor ? storedMatchMode(predecessor) : "KIDS", parsed = parseSuccessor(input, mode, helpers.name, helpers.fold, !!predecessorId), prepared = prepareSuccessor(parsed, mode, predecessorId ? { gameId: predecessorId, version: parsed.predecessorVersion! } : null);
      const old = await tx.findStart(principal, prepared.requestKey, null);
      if (old) { if (old.requestHash !== prepared.requestHash || old.intentHash !== prepared.intentHash) return fail(409, "IDEMPOTENCY_KEY_CONFLICT"); const game = await tx.loadMatch(principal, old.gameId, false); helpers.owner(game, principal); return { idempotent: true, match: projectMatch(game, await tx.now()) }; }
      if (await tx.findStart(principal, null, prepared.logicalMatchId)) return fail(409, "LOGICAL_MATCH_ALREADY_CHARGED");
      if (predecessor && predecessor.version !== parsed.predecessorVersion) return fail(409, "PREDECESSOR_VERSION_CONFLICT"); if (wallet.debt > 0n) return fail(409, "WALLET_DEBT_BLOCKS_START"); if (wallet.available < 1n) return fail(402, "INSUFFICIENT_CREDIT");
      const release = await catalog(tx, principal, identity.id, mode); if (prepared.setup.categoryKeys.some(key => !release.categories.some(category => category.key === key))) return fail(409, "CATEGORY_UNAVAILABLE");
      if (!tx.createSuccessor) return fail(503, "ENTA_UNAVAILABLE"); const game = await tx.createSuccessor(principal, prepared, release); helpers.owner(game, principal); return { idempotent: false, match: projectMatch(game, await tx.now()) };
    });
  }
  return {
    startKids: (principal: Principal, input: unknown) => start(principal, input, null),
    rematch: (principal: Principal, predecessorId: string, input: unknown) => start(principal, input, predecessorId),
    async kidsCatalog(principal: Principal) { helpers.verified(principal); return repository.transaction(async tx => { const identity = await tx.resolveIdentity(principal), wallet = await tx.lockWallet(principal), release = await catalog(tx, principal, identity.id, "KIDS"); return { mode: "KIDS" as const, categoryCount: 1 as const, categories: release.categories.map(category => ({ key: category.key, label: category.label })), availableCredit: wallet.available.toString() }; }); },
    async rematchSetup(principal: Principal, gameId: string) { helpers.verified(principal); if (!ID.test(gameId)) return fail(404, "MATCH_NOT_FOUND"); return repository.transaction(async tx => { const game = await tx.loadMatch(principal, gameId, false); helpers.owner(game, principal); if (game.phase !== "FINISHED") return fail(409, "PREDECESSOR_NOT_FINISHED"); return { mode: storedMatchMode(game), predecessorVersion: game.version, setup: { ...game.setup, version: 3 as const } }; }); },
    async history(principal: Principal, input: Record<string, unknown>) { helpers.verified(principal); const query = parseHistoryQuery(input); return repository.transaction(async tx => { if (!tx.history) return fail(503, "ENTA_UNAVAILABLE"); const rows = await tx.history(principal, query); if (rows.length > query.limit + 1) return fail(503, "MATCH_DATA_UNAVAILABLE"); const page = rows.slice(0, query.limit).map((row): HistoryRow => ({ id: row.id, mode: row.mode, status: row.status, createdAt: row.createdAt, finishedAt: row.finishedAt, teams: row.teams.map(team => ({ name: team.name, score: team.score })), resultReason: row.resultReason, unplayedCount: row.unplayedCount })); const last = page.at(-1); return { matches: page, nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ version: 1, id: last.id, createdAt: last.createdAt, mode: query.mode, status: query.status })).toString("base64url") : null }; }); },
  };
}
