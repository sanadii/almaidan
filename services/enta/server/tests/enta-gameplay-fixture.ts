// Controlled test repository only. Never imported by production composition.
import { randomUUID } from "node:crypto";
import type { Principal } from "../src/identity";
import { proveEntaClassicRepeatSupply, type EntaClassicSourceQuestion } from "../src/catalog/selectors";
import { reduceMatchCommand } from "../src/gameplay/service";
import type { EntaRepository, EntaTransaction, StoredStart } from "../src/gameplay/repository";
import { fail, type CommandReceipt, type MatchRecord, type PreparedCatalog, type StartCommand } from "../src/gameplay/types";

export const fixtureProject = "enta-controlled-project";
export const fixturePrincipal: Principal = { projectId: fixtureProject, uid: "fixture-host", verifiedAccount: true, anonymous: false, email: "fixture@example.invalid" };
export const fixtureStart = (): StartCommand => ({ requestKey: "fixture-request-0001", logicalMatchId: "fixture-logical-0001", setup: { version: 2, categoryKeys: Array.from({ length: 6 }, (_, index) => `fixture_category_${index}`), teams: [{ name: "الفريق الأول", players: ["سارة"], lifelines: [] }, { name: "الفريق الثاني", players: ["علي"], lifelines: [] }], rules: { questionSeconds: 30 } } });
export function fixtureCatalog(identityId = "fixture-host-identity"): PreparedCatalog {
  const selectorSources: EntaClassicSourceQuestion[] = [], availability: PreparedCatalog["availability"] = [], categories: PreparedCatalog["categories"] = [];
  const labels = ["عالم المعرفة", "حول العالم", "الحيوان والطبيعة", "تاريخ وحكايات", "رياضة وتحديات", "علوم واكتشافات"];
  for (let category = 0; category < 6; category++) {
    const key = `fixture_category_${category}`, selected: string[] = [];
    for (const points of [200, 400, 600]) {
      const sources: EntaClassicSourceQuestion[] = Array.from({ length: 4 }, (_, index) => ({ questionRevisionId: `fixture_q_${category}_${points}_${index}`, sourceQuestionId: `source_${category}_${points}_${index}`, categoryKey: key, sourceNamespace: "enta.question", sourceCategoryId: `source_category_${category}`, sourceQuestionCategoryId: `source_category_${category}`, categoryEditorialDecision: "APPROVED", questionEditorialDecision: "APPROVED", questionRightsDecision: "CLEARED", sourcePoints: points, engine: "ENTA", mode: "CLASSIC", tier: String(points), modality: "classic", sourceHasQuestionMedia: false, sourceCategoryHasCoverMedia: false }));
      selectorSources.push(...sources);
      const proof = proveEntaClassicRepeatSupply(sources.map(row => ({ id: row.questionRevisionId, categoryKey: key, sourceQuestionId: row.sourceQuestionId, engine: "ENTA" as const, mode: "CLASSIC" as const, tier: String(points), modality: "classic" as const })), { categoryKey: key, tier: String(points), freshSeed: 42 });
      availability.push({ categoryKey: key, engine: "ENTA", mode: "CLASSIC", modality: "classic", tier: String(points), selectorVersion: proof.selectorVersion, selectionManifestHash: proof.selectionManifestHash, freshSelectionHash: proof.fresh.selectionHash, repeatSelectionHash: proof.repeat.selectionHash, freshSelectionIds: proof.fresh.selectedQuestionRevisionIds, repeatSelectionIds: proof.repeat.selectedQuestionRevisionIds, freshSelectionSeed: proof.fresh.seed, repeatSelectionSeed: proof.repeat.seed });
      selected.push(...proof.fresh.selectedQuestionRevisionIds);
    }
    categories.push({ key, label: labels[category], revisionId: `fixture_category_revision_${category}`, questions: selected.map(revisionId => { const source = selectorSources.find(row => row.questionRevisionId === revisionId)!; return { revisionId, contentHash: "a".repeat(64), sourceQuestionId: source.sourceQuestionId, categoryKey: key, points: source.sourcePoints as 200 | 400 | 600, prompt: "ما اسم عاصمة دولة الكويت؟", answers: [{ text: "الكويت — إجابة اختبار مخفية", isCorrect: true, isTrap: false }] }; }) });
  }
  return { receipt: { projectId: fixtureProject, identityId, releaseId: "fixture-release-v1", rootHash: "b".repeat(64), receiptId: "fixture-receipt-v1", policyVersion: "explicit-test-only", selectorVersion: "enta-curated-classic-tier-v2", mode: "CLASSIC" }, categories, selectorSources, availability };
}
export class FixtureEntaRepository implements EntaRepository {
  readonly source = "test-only" as const;
  readonly projectId = fixtureProject;
  available = 1n; held = 0n; debitCount = 0; catalogReads = 0; nowValue = 1_800_000_000_000;
  catalog = fixtureCatalog();
  games = new Map<string, MatchRecord>(); starts = new Map<string, StoredStart & { logicalId: string }>(); receipts = new Map<string, CommandReceipt>();
  failAfterDebit = false; failAfterCommand = false;
  onTransactionLocked: (() => Promise<void>) | null = null;
  private tail = Promise.resolve();
  async transaction<T>(work: (transaction: EntaTransaction) => Promise<T>): Promise<T> {
    const before = this.tail; let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; }); await before;
    const checkpoint = structuredClone({ available: this.available, held: this.held, debitCount: this.debitCount, games: this.games, starts: this.starts, receipts: this.receipts });
    const owner = (principal: Principal, gameId: string) => { const game = this.games.get(gameId); return game?.projectId === principal.projectId && game.hostUid === principal.uid ? game : null; };
    try {
      if (this.onTransactionLocked) await this.onTransactionLocked();
      return await work({
        resolveIdentity: async principal => ({ id: `${principal.uid}-identity` }),
        lockWallet: async principal => ({ identityId: `${principal.uid}-identity`, available: this.available, held: this.held, debt: 0n }),
        findStart: async (principal, key, logical) => { const rows = [...this.starts.entries()].filter(([scope]) => scope.startsWith(`${principal.uid}:`)); return key ? this.starts.get(`${principal.uid}:${key}`) ?? null : rows.find(([, row]) => row.logicalId === logical)?.[1] ?? null; },
        activeCatalog: async principal => { this.catalogReads++; return { ...structuredClone(this.catalog), receipt: { ...this.catalog.receipt, identityId: `${principal.uid}-identity`, projectId: principal.projectId } }; },
        createClassic: async (principal, prepared, catalog) => {
          if (this.available < 1n) return fail(402, "INSUFFICIENT_CREDIT");
          this.available--; this.debitCount++;
          if (this.failAfterDebit) throw new Error("CONTROLLED_START_TRANSACTION_FAILURE");
          const id = randomUUID();
          const game: MatchRecord = { id, identityId: `${principal.uid}-identity`, projectId: principal.projectId, hostUid: principal.uid, admissionId: randomUUID(), releaseId: catalog.receipt.releaseId, releaseRootHash: catalog.receipt.rootHash, setup: structuredClone(prepared.setup), setupHash: prepared.setupHash, version: 1, phase: "BOARD", turnIndex: 0, activeQuestionId: null, activeTeamId: null, deadlineAt: null, resultReason: null, unplayedCount: 0,
            teams: prepared.setup.teams.map(team => ({ id: randomUUID(), name: team.name, players: [...team.players], score: 0 })), categories: prepared.setup.categoryKeys.map(key => { const category = catalog.categories.find(category => category.key === key)!; return { key, label: category.label, revisionId: category.revisionId }; }),
            questions: prepared.setup.categoryKeys.flatMap(key => catalog.categories.find(category => category.key === key)!.questions.map(question => ({ ...structuredClone(question), id: randomUUID(), isOpened: false, isCorrect: null, answeredByTeamId: null }))) };
          this.games.set(id, game); this.starts.set(`${principal.uid}:${prepared.requestKey}`, { gameId: id, requestHash: prepared.requestHash, intentHash: prepared.intentHash, logicalId: prepared.logicalMatchId });
          return structuredClone(game);
        },
        loadMatch: async (principal, gameId) => structuredClone(owner(principal, gameId)),
        findCommand: async (principal, gameId, commandId) => owner(principal, gameId) ? structuredClone(this.receipts.get(`${gameId}:${commandId}`) ?? null) : fail(404, "MATCH_NOT_FOUND"),
        applyCommand: async (principal, gameId, command, intentHash, next) => {
          const original = owner(principal, gameId); if (!original) return fail(404, "MATCH_NOT_FOUND");
          const recomputed = reduceMatchCommand(original, command, this.nowValue); // Test transaction uses same server reducer, not a real PG race.
          if (recomputed.version !== next.version) throw new Error("CONTROLLED_REDUCER_DIVERGENCE");
          this.games.set(gameId, structuredClone(recomputed));
          if (this.failAfterCommand) throw new Error("CONTROLLED_COMMAND_TRANSACTION_FAILURE");
          const receipt = { commandId: command.commandId, type: command.type, sequence: next.version, intentHash }; this.receipts.set(`${gameId}:${command.commandId}`, receipt); return receipt;
        },
        now: async () => this.nowValue,
      });
    } catch (error) { Object.assign(this, checkpoint); throw error; } finally { unlock(); }
  }
}
