import { admissionHash } from "../admission/huroof-protocol.cjs";
import { productionReceiptPolicy, type ReceiptPolicyVerifier } from "../wallet/financial-policy";
import type { Principal } from "../identity";
import { ENTA_CLASSIC_SELECTOR_VERSION } from "../catalog/selectors";
import { replayStoredEntaAvailability } from "../catalog/selector-replay";
import { productionModeReceiptPolicy, type ModeReceiptVerifier } from "../wallet/enta-mode-policy";
import { successorOperations } from "./successor";
import type { EntaRepository } from "./repository";
import { projectMatch } from "./projection";
import { fail, type MatchCommand, type MatchRecord, type PreparedCatalog, type PreparedStart, type StartCommand } from "./types";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const HOSTED = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "FUNCTIONS_WORKER_RUNTIME", "WEBSITE_SITE_NAME", "FLY_APP_NAME", "RENDER", "RAILWAY_ENVIRONMENT", "DYNO"];
export const normalizeSetupName = (value: string): string => value.replace(/^ +| +$/g, "").normalize("NFC");
export const foldSetupName = (value: string): string => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const NON_ASCII_SPACE = new Set([0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]);
export const hostedGameplayRuntime = () => process.env.NODE_ENV === "production" || HOSTED.some(key => Boolean(process.env[key]));
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "INVALID_REQUEST");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) return fail(400, "INVALID_REQUEST");
  return row;
}
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== "string" || /[<>]/.test(value)) return fail(400, "INVALID_REQUEST");
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit < 32 || (unit >= 127 && unit <= 159) || NON_ASCII_SPACE.has(unit) || (unit >= 0xdc00 && unit <= 0xdfff)) return fail(400, "INVALID_REQUEST");
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++index);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return fail(400, "INVALID_REQUEST");
    }
  }
  const normalized = normalizeSetupName(value);
  if (normalized.length < min || normalized.length > max) return fail(400, "INVALID_REQUEST");
  return normalized;
}
export { text as parseSetupName };
export function parseStartCommand(value: unknown, minimumPlayers = 1): StartCommand {
  const row = object(value, ["requestKey", "logicalMatchId", "setup"]);
  if (typeof row.requestKey !== "string" || !KEY.test(row.requestKey) || typeof row.logicalMatchId !== "string" || !ID.test(row.logicalMatchId)) return fail(400, "INVALID_START");
  const setup = object(row.setup, ["version", "categoryKeys", "teams", "rules"]), rules = object(setup.rules, ["questionSeconds"]);
  if (setup.version !== 2 || !Array.isArray(setup.categoryKeys) || setup.categoryKeys.length !== 6 || !setup.categoryKeys.every(key => typeof key === "string" && ID.test(key)) || new Set(setup.categoryKeys).size !== 6
    || !Array.isArray(setup.teams) || setup.teams.length < 2 || setup.teams.length > 4 || !Number.isSafeInteger(rules.questionSeconds) || (rules.questionSeconds as number) < 5 || (rules.questionSeconds as number) > 120) return fail(400, "INVALID_SETUP");
  const teams = setup.teams.map(input => {
    const team = object(input, ["name", "players", "lifelines"]);
    if (!Array.isArray(team.players) || team.players.length < minimumPlayers || team.players.length > 8 || !Array.isArray(team.lifelines) || team.lifelines.length !== 0) return fail(400, "INVALID_SETUP");
    return { name: text(team.name, 2, 22), players: team.players.map(player => text(player, 1, 30)), lifelines: [] as [] };
  });
  if (new Set(teams.map(team => foldSetupName(team.name))).size !== teams.length) return fail(400, "DUPLICATE_TEAM_NAME");
  return { requestKey: row.requestKey, logicalMatchId: row.logicalMatchId, setup: { version: 2, categoryKeys: [...setup.categoryKeys], teams, rules: { questionSeconds: rules.questionSeconds as number } } };
}
export function prepareStart(command: StartCommand): PreparedStart {
  const setupHash = admissionHash(command.setup);
  const intentHash = admissionHash({ version: 2, engine: "ENTA", operation: "PAID_ENTA_CLASSIC", mode: "CLASSIC", logicalMatchId: command.logicalMatchId, setup: command.setup });
  return { ...command, setupHash, intentHash, requestHash: admissionHash({ version: 2, requestKey: command.requestKey, intentHash }), requestVersion: 2 };
}
export function parseMatchCommand(value: unknown): MatchCommand {
  if (!value || typeof value !== "object") return fail(400, "INVALID_COMMAND");
  const type = (value as Record<string, unknown>).type;
  const extras = type === "OPEN_QUESTION" || type === "REVEAL_ANSWER" ? ["questionId"] : type === "ADJUDICATE" ? ["questionId", "ruling", "teamId"] : type === "FINISH" ? ["confirmEarly"] : null;
  if (!extras) return fail(400, "INVALID_COMMAND");
  const row = object(value, ["commandId", "expectedVersion", "type", ...extras]);
  if (typeof row.commandId !== "string" || !KEY.test(row.commandId) || !Number.isSafeInteger(row.expectedVersion) || (row.expectedVersion as number) < 1 || (row.expectedVersion as number) > 2_000_000_000) return fail(400, "INVALID_COMMAND");
  if (type !== "FINISH" && (typeof row.questionId !== "string" || !ID.test(row.questionId))) return fail(400, "INVALID_COMMAND");
  if (type === "ADJUDICATE" && (!['CORRECT', 'NO_SCORE'].includes(row.ruling as string) || (row.ruling === "CORRECT" ? typeof row.teamId !== "string" || !ID.test(row.teamId) : row.teamId !== null))) return fail(400, "INVALID_COMMAND");
  if (type === "FINISH" && typeof row.confirmEarly !== "boolean") return fail(400, "INVALID_COMMAND");
  return row as unknown as MatchCommand;
}
function verified(principal: Principal, project: string): void {
  if (principal.projectId !== project || !principal.uid || !principal.verifiedAccount || principal.anonymous || !principal.email) return fail(403, "VERIFIED_ACCOUNT_REQUIRED");
}
export function authorizeMatch(game: MatchRecord | null, principal: Principal): asserts game is MatchRecord {
  if (!game || game.projectId !== principal.projectId || game.hostUid !== principal.uid) return fail(404, "MATCH_NOT_FOUND");
}
export function authorizeCommandChildren(game: MatchRecord, command: MatchCommand): void {
  if (command.type !== "FINISH" && !game.questions.some(question => question.id === command.questionId)) return fail(404, "MATCH_NOT_FOUND");
  if (command.type === "ADJUDICATE" && command.teamId !== null && !game.teams.some(team => team.id === command.teamId)) return fail(404, "MATCH_NOT_FOUND");
}
export function reduceMatchCommand(game: MatchRecord, command: MatchCommand, now: number): MatchRecord {
  authorizeCommandChildren(game, command);
  if (game.version !== command.expectedVersion) return fail(409, "STALE_VERSION");
  if (game.phase === "FINISHED") return fail(409, "MATCH_FINISHED");
  const next = structuredClone(game);
  if (command.type === "OPEN_QUESTION") {
    const question = next.questions.find(question => question.id === command.questionId)!;
    if (next.phase !== "BOARD" || question.isOpened || question.isCorrect !== null) return fail(409, "QUESTION_UNAVAILABLE");
    question.isOpened = true; next.phase = "QUESTION_OPEN"; next.activeQuestionId = question.id; next.activeTeamId = next.teams[next.turnIndex % next.teams.length].id; next.deadlineAt = now + next.setup.rules.questionSeconds * 1000;
  } else if (command.type === "REVEAL_ANSWER") {
    if (next.phase !== "QUESTION_OPEN" || next.activeQuestionId !== command.questionId) return fail(409, "INVALID_PHASE");
    next.phase = "REVEALED";
  } else if (command.type === "ADJUDICATE") {
    if (next.phase !== "REVEALED" || next.activeQuestionId !== command.questionId) return fail(409, "INVALID_PHASE");
    const question = next.questions.find(question => question.id === command.questionId)!;
    if (question.isCorrect !== null) return fail(409, "QUESTION_RESOLVED");
    question.isCorrect = command.ruling === "CORRECT"; question.answeredByTeamId = command.teamId;
    if (command.ruling === "CORRECT") next.teams.find(team => team.id === command.teamId)!.score += question.points;
    next.phase = "BOARD"; next.activeQuestionId = null; next.activeTeamId = null; next.deadlineAt = null; next.turnIndex++;
  } else {
    if (next.phase !== "BOARD" || next.activeQuestionId !== null) return fail(409, "UNRESOLVED_QUESTION");
    const unplayed = next.questions.filter(question => question.isCorrect === null).length;
    if (unplayed > 0 && !command.confirmEarly) return fail(409, "EARLY_FINISH_CONFIRMATION_REQUIRED");
    next.phase = "FINISHED"; next.unplayedCount = unplayed; next.resultReason = unplayed ? "HOST_ENDED" : "ALL_QUESTIONS_PLAYED";
  }
  next.version++;
  return next;
}
export function validateClassicCatalog(catalog: PreparedCatalog, principal: Principal, identityId: string): void {
  const receipt = catalog.receipt;
  if (receipt.projectId !== principal.projectId || receipt.identityId !== identityId || receipt.mode !== "CLASSIC" || receipt.selectorVersion !== ENTA_CLASSIC_SELECTOR_VERSION) return fail(503, "CATALOG_UNAVAILABLE");
  if (catalog.categories.length < 6 || catalog.categories.length > 1000 || new Set(catalog.categories.map(category => category.key)).size !== catalog.categories.length) return fail(503, "CATALOG_UNAVAILABLE");
  const replay = replayStoredEntaAvailability(catalog.availability, catalog.selectorSources, catalog.categories.map(category => category.key));
  if (replay.status !== "verified") return fail(503, "CATALOG_UNAVAILABLE");
  for (const category of catalog.categories) {
    if (!ID.test(category.key) || !category.label.trim() || category.questions.length !== 6 || new Set(category.questions.map(question => question.sourceQuestionId)).size !== 6) return fail(503, "CATALOG_UNAVAILABLE");
    for (const points of [200, 400, 600]) if (category.questions.filter(question => question.points === points).length !== 2) return fail(503, "CATALOG_UNAVAILABLE");
    if (category.questions.some(question => question.categoryKey !== category.key || !question.prompt.trim() || question.answers.filter(answer => answer.isCorrect && !answer.isTrap).length < 1)) return fail(503, "CATALOG_UNAVAILABLE");
    for (const points of [200, 400, 600]) {
      const proof = replay.proofs.find(proof => proof.categoryKey === category.key && proof.tier === String(points));
      const actual = category.questions.filter(question => question.points === points).map(question => question.revisionId);
      if (!proof || actual.length !== 2 || actual.some((id, index) => id !== proof.freshSelectionIds[index])) return fail(503, "CATALOG_UNAVAILABLE");
    }
  }
}

function service(repository: EntaRepository, policy: ReceiptPolicyVerifier, source: "production" | "test-only", modePolicy: ModeReceiptVerifier = productionModeReceiptPolicy) {
  return Object.freeze({
    source,
    ...successorOperations(repository, modePolicy, { name: text, fold: foldSetupName, verified: principal => verified(principal, repository.projectId), owner: authorizeMatch, classic: validateClassicCatalog }),
    async catalog(principal: Principal) {
      verified(principal, repository.projectId);
      return repository.transaction(async tx => {
        const identity = await tx.resolveIdentity(principal), wallet = await tx.lockWallet(principal);
        const catalog = await tx.activeCatalog(principal, identity.id); validateClassicCatalog(catalog, principal, identity.id);
        await policy.assertEligible(catalog.receipt);
        return { mode: "CLASSIC" as const, categoryCount: 6 as const, categories: catalog.categories.map(category => ({ key: category.key, label: category.label })), availableCredit: wallet.available.toString() };
      });
    },
    async start(principal: Principal, input: unknown) {
      verified(principal, repository.projectId);
      const prepared = prepareStart(parseStartCommand(input));
      return repository.transaction(async tx => {
        const identity = await tx.resolveIdentity(principal), wallet = await tx.lockWallet(principal);
        const retry = await tx.findStart(principal, prepared.requestKey, null);
        if (retry) {
          if (retry.requestHash !== prepared.requestHash || retry.intentHash !== prepared.intentHash) return fail(409, "IDEMPOTENCY_KEY_CONFLICT");
          const game = await tx.loadMatch(principal, retry.gameId, false); authorizeMatch(game, principal);
          return { idempotent: true, match: projectMatch(game, await tx.now()) };
        }
        if (await tx.findStart(principal, null, prepared.logicalMatchId)) return fail(409, "LOGICAL_MATCH_ALREADY_CHARGED");
        if (wallet.debt > 0n) return fail(409, "WALLET_DEBT_BLOCKS_START");
        if (wallet.available < 1n) return fail(402, "INSUFFICIENT_CREDIT");
        const catalog = await tx.activeCatalog(principal, identity.id); validateClassicCatalog(catalog, principal, identity.id);
        await policy.assertEligible(catalog.receipt);
        if (prepared.setup.categoryKeys.some(key => !catalog.categories.some(category => category.key === key))) return fail(409, "CATEGORY_UNAVAILABLE");
        const game = await tx.createClassic(principal, prepared, catalog); authorizeMatch(game, principal);
        return { idempotent: false, match: projectMatch(game, await tx.now()) };
      });
    },
    async get(principal: Principal, gameId: string) {
      verified(principal, repository.projectId); if (!ID.test(gameId)) return fail(404, "MATCH_NOT_FOUND");
      return repository.transaction(async tx => { const game = await tx.loadMatch(principal, gameId, false); authorizeMatch(game, principal); return { match: projectMatch(game, await tx.now()) }; });
    },
    async command(principal: Principal, gameId: string, input: unknown) {
      verified(principal, repository.projectId); if (!ID.test(gameId)) return fail(404, "MATCH_NOT_FOUND");
      const command = parseMatchCommand(input), intentHash = admissionHash(command);
      return repository.transaction(async tx => {
        const game = await tx.loadMatch(principal, gameId, true); authorizeMatch(game, principal);
        authorizeCommandChildren(game, command); // Owner/children BEFORE receipt lookup.
        const old = await tx.findCommand(principal, gameId, command.commandId);
        if (old && old.intentHash !== intentHash) return fail(409, "COMMAND_KEY_CONFLICT");
        const now = await tx.now();
        const receipt = old ?? await tx.applyCommand(principal, gameId, command, intentHash, reduceMatchCommand(game, command, now));
        const current = await tx.loadMatch(principal, gameId, false); authorizeMatch(current, principal);
        return { idempotent: !!old, receipt: { commandId: receipt.commandId, type: receipt.type, sequence: receipt.sequence }, match: projectMatch(current, await tx.now()) };
      });
    },
  });
}
export type EntaService = ReturnType<typeof service>;
export function createEntaService(repository: EntaRepository): EntaService {
  if (repository.source !== "postgres") return fail(503, "PRODUCTION_REPOSITORY_REQUIRED");
  return service(repository, productionReceiptPolicy, "production");
}
/** Explicit controlled-test composition; never used by default/hosted app. */
export function createEntaServiceForTest(repository: EntaRepository, policy: ReceiptPolicyVerifier, modePolicy: ModeReceiptVerifier = productionModeReceiptPolicy): EntaService {
  if (hostedGameplayRuntime() || repository.source !== "test-only" || policy.source !== "test-only") return fail(503, "TEST_GAMEPLAY_FORBIDDEN");
  return service(repository, policy, "test-only", modePolicy);
}
