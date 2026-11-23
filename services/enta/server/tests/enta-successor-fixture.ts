// Explicit synthetic test state/content. Never imported by ordinary composition.
import { admissionHash } from "../src/admission/huroof-protocol.cjs";
import { KIDS_SELECTOR, KIDS_SUITABILITY_POLICY, proveKidsTier, type KidsSource, type KidsTierProof } from "../src/catalog/kids-selector";
import { CLASSIC_MODE_POLICY } from "../src/wallet/enta-mode-policy";
import type { EntaTransaction } from "../src/gameplay/repository";
import { fail, type PreparedSuccessor, type SuccessorCatalog, type SuccessorStart } from "../src/gameplay/types";
import { FixtureEntaRepository, fixturePrincipal, fixtureProject, fixtureStart } from "./enta-gameplay-fixture";
export { fixturePrincipal, fixtureProject };
export const fixtureKidsStart = (): SuccessorStart => ({ requestKey: "kids-request-0001", logicalMatchId: "kids-logical-0001", setup: { ...fixtureStart().setup, version: 3, categoryKeys: ["fixture_kids_0"] } });
export function kidsCatalog(): SuccessorCatalog {
  const kidsSources: KidsSource[] = [], kidsProofs: KidsTierProof[] = [], categories: SuccessorCatalog["categories"] = [];
  for (let category = 0; category < 3; category++) {
    const key = `fixture_kids_${category}`; const selected: string[] = [];
    for (const points of [200, 400, 600] as const) {
      const pool: KidsSource[] = Array.from({ length: 4 }, (_, index) => ({ revisionId: `kids_revision_${category}_${points}_${index}`, contentHash: "c".repeat(64), sourceQuestionId: `kids_source_${category}_${points}_${index}`, categoryKey: key, points, engine: "ENTA", mode: "KIDS", modality: "classic", sourceNamespace: "enta.question", editorialDecision: "APPROVED", rightsDecision: "CLEARED", suitability: { policyVersion: KIDS_SUITABILITY_POLICY, targetCohort: "controlled_fixture_cohort", reviewerIdentityId: "fixture-reviewer", evidenceHash: "d".repeat(64), decision: "APPROVED" } }));
      kidsSources.push(...pool); let proof!: KidsTierProof;
      for (let seed = 0; seed < 5000; seed++) { try { proof = proveKidsTier(pool, key, points, "controlled_fixture_cohort", 42, seed); break; } catch { /* Bounded fixture generation only; production replay never searches. */ } }
      if (!proof) throw Error("fixture proof generation failed"); kidsProofs.push(proof); selected.push(...proof.fresh.ids);
    }
    categories.push({ key, label: ["ألوان وأشكال", "حيوانات وطبيعة", "معرفة صغيرة"][category], revisionId: `kids_category_revision_${category}`, questions: selected.map(id => { const source = kidsSources.find(source => source.revisionId === id)!; return { revisionId: id, contentHash: source.contentHash, sourceQuestionId: source.sourceQuestionId, categoryKey: key, points: source.points, prompt: "سؤال أطفال تجريبي: ما لون السماء الصافية؟", answers: [{ text: "أزرق — إجابة اختبار أطفال", isCorrect: true, isTrap: false }] }; }) });
  }
  return { receipt: { version: 1, projectId: fixtureProject, identityId: "fixture-host-identity", mode: "KIDS", operation: "PAID_ENTA_KIDS", releaseId: "fixture-kids-release", rootHash: "e".repeat(64), receiptId: "fixture-kids-receipt", selectorVersion: KIDS_SELECTOR, policyVersion: KIDS_SUITABILITY_POLICY, targetCohort: "controlled_fixture_cohort", reviewerIdentityId: "fixture-reviewer", suitabilityManifestHash: admissionHash(kidsSources) }, categories, kidsSources, kidsProofs, classic: null };
}
export class SuccessorFixtureRepository extends FixtureEntaRepository {
  kids = kidsCatalog(); links = new Map<string, { predecessorGameId: string; version: number; uid: string }>();
  walletMissing = false; failAfterLink = false; successorReads = 0;
  override async transaction<T>(work: (transaction: EntaTransaction) => Promise<T>): Promise<T> {
    return super.transaction(async tx => {
      const beforeLinks = structuredClone(this.links);
      const classicCreate: EntaTransaction["createClassic"] = async (principal, prepared, catalog) => { const game = await tx.createClassic(principal, prepared, catalog); game.mode = "CLASSIC"; game.createdAt = new Date(this.nowValue + this.debitCount).toISOString(); this.games.set(game.id, structuredClone(game)); return game; };
      try { return await work({ ...tx, createClassic: classicCreate,
        lockWallet: principal => this.walletMissing ? Promise.reject(new Error("ACCOUNT_NOT_READY")) : tx.lockWallet(principal),
        successorCatalog: async (principal, identityId, mode) => {
          this.successorReads++;
          if (mode === "KIDS") return { ...structuredClone(this.kids), receipt: { ...this.kids.receipt, projectId: principal.projectId, identityId } };
          const classic = await tx.activeCatalog(principal, identityId);
          return { receipt: { version: 1, projectId: principal.projectId, identityId, mode: "CLASSIC", operation: "PAID_ENTA_CLASSIC", releaseId: classic.receipt.releaseId, rootHash: classic.receipt.rootHash, receiptId: classic.receipt.receiptId, selectorVersion: classic.receipt.selectorVersion, policyVersion: CLASSIC_MODE_POLICY, targetCohort: null, reviewerIdentityId: "fixture-reviewer", suitabilityManifestHash: null }, categories: classic.categories, classic, kidsSources: [], kidsProofs: [] };
        },
        createSuccessor: async (principal, prepared: PreparedSuccessor, catalog) => {
          // Test-only reuse of record construction. SQL successors remain independently unexecuted.
          const game = await classicCreate(principal, { requestKey: prepared.requestKey, logicalMatchId: prepared.logicalMatchId, setup: { ...prepared.setup, version: 2 }, setupHash: prepared.setupHash, intentHash: prepared.intentHash, requestHash: prepared.requestHash, requestVersion: 2 }, { categories: catalog.categories, receipt: this.catalog.receipt, selectorSources: [], availability: [] });
          game.mode = prepared.mode; game.setup = structuredClone(prepared.setup); this.games.set(game.id, structuredClone(game));
          if (prepared.predecessor) this.links.set(game.id, { predecessorGameId: prepared.predecessor.gameId, version: prepared.predecessor.version, uid: principal.uid });
          if (this.failAfterLink) throw Error("CONTROLLED_LINK_ROLLBACK"); return game;
        },
        applyCommand: async (principal, gameId, command, hash, next) => { const receipt = await tx.applyCommand(principal, gameId, command, hash, next); if (command.type === "FINISH") this.games.get(gameId)!.finishedAt = new Date(this.nowValue).toISOString(); return receipt; },
        history: async (principal, query) => {
          const owned = [...this.games.values()].filter(game => game.projectId === principal.projectId && game.hostUid === principal.uid && (!query.mode || game.mode === query.mode) && (!query.status || (game.phase === "FINISHED" ? "FINISHED" : "ACTIVE") === query.status));
          if (query.cursor && !owned.some(game => game.id === query.cursor!.id && game.createdAt === query.cursor!.createdAt)) return fail(400, "INVALID_HISTORY_CURSOR");
          return owned.filter(game => !query.cursor || game.createdAt! < query.cursor.createdAt || (game.createdAt === query.cursor.createdAt && game.id < query.cursor.id)).sort((a, b) => a.createdAt === b.createdAt ? a.id > b.id ? -1 : 1 : a.createdAt! > b.createdAt! ? -1 : 1).slice(0, query.limit + 1).map(game => ({ id: game.id, mode: game.mode!, status: game.phase === "FINISHED" ? "FINISHED" as const : "ACTIVE" as const, createdAt: game.createdAt!, finishedAt: game.finishedAt ?? null, teams: game.teams.map(team => ({ name: team.name, score: team.score })), resultReason: game.resultReason, unplayedCount: game.unplayedCount }));
        },
      }); } catch (error) { this.links = beforeLinks; throw error; }
    });
  }
}
