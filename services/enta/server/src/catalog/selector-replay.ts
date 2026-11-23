import { ENTA_CLASSIC_SELECTOR_BUILD_ID, ENTA_CLASSIC_SELECTOR_VERSION, hashEntaClassicSelectionPair, selectEntaClassicTier, toEntaClassicCandidate, type EntaClassicSelection, type EntaClassicSourceQuestion } from "./selectors";

export interface StoredEntaAvailability {
  categoryKey: string;
  engine: string;
  mode: string;
  tier: string;
  modality: string;
  selectorVersion: string;
  selectionManifestHash: string;
  freshSelectionHash: string;
  repeatSelectionHash: string;
  freshSelectionIds: string[];
  repeatSelectionIds: string[];
  freshSelectionSeed: number;
  repeatSelectionSeed: number;
}

export interface EntaSelectorReplayProof {
  categoryKey: string;
  tier: "200" | "400" | "600";
  selectorVersion: typeof ENTA_CLASSIC_SELECTOR_VERSION;
  selectorBuildId: typeof ENTA_CLASSIC_SELECTOR_BUILD_ID;
  freshSelectionHash: string;
  repeatSelectionHash: string;
  selectionManifestHash: string;
  freshSelectionIds: string[];
  repeatSelectionIds: string[];
}

export type EntaSelectorReplayResult =
  | { status: "verified"; proofs: EntaSelectorReplayProof[] }
  | { status: "incomplete" | "rejected"; reasonCode: string; proofs: [] };

const TIERS = ["200", "400", "600"] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9:_-]{1,128}$/;

function selectionEquals(selection: EntaClassicSelection, ids: readonly string[], hash: string, seed: number): boolean {
  return selection.seed === seed && selection.selectionHash === hash &&
    selection.selectedQuestionRevisionIds.length === 2 &&
    selection.selectedQuestionRevisionIds.every((id, index) => id === ids[index]);
}

/**
 * Replays every persisted availability row exactly. It intentionally never
 * searches for an alternate repeat seed or treats inventory counts as proof.
 */
export function replayStoredEntaAvailability(
  rows: readonly StoredEntaAvailability[],
  revisions: readonly EntaClassicSourceQuestion[],
  releaseCategoryKeys: readonly string[],
): EntaSelectorReplayResult {
  if (rows.length === 0 || releaseCategoryKeys.length === 0 || revisions.length === 0) {
    return { status: "incomplete", reasonCode: "DATABASE_AVAILABILITY_TIER_SET_INCOMPLETE", proofs: [] };
  }
  const categories = [...releaseCategoryKeys];
  if (categories.some((category) => !KEY.test(category)) || new Set(categories).size !== categories.length) {
    return { status: "rejected", reasonCode: "RELEASE_CATEGORY_SET_INVALID", proofs: [] };
  }
  const categorySet = new Set(categories);
  if (rows.length !== categories.length * 3 || rows.some((row) =>
    !categorySet.has(row.categoryKey) || row.engine !== "ENTA" || row.mode !== "CLASSIC" ||
    row.modality !== "classic" || row.selectorVersion !== ENTA_CLASSIC_SELECTOR_VERSION ||
    !TIERS.includes(row.tier as typeof TIERS[number]) || !SHA256.test(row.selectionManifestHash) ||
    !SHA256.test(row.freshSelectionHash) || !SHA256.test(row.repeatSelectionHash) ||
    !Number.isSafeInteger(row.freshSelectionSeed) || row.freshSelectionSeed < 0 || row.freshSelectionSeed > 0xffffffff ||
    !Number.isSafeInteger(row.repeatSelectionSeed) || row.repeatSelectionSeed < 0 || row.repeatSelectionSeed > 0xffffffff ||
    row.freshSelectionIds.length !== 2 || row.repeatSelectionIds.length !== 2)) {
    return { status: "incomplete", reasonCode: "DATABASE_AVAILABILITY_TIER_SET_INCOMPLETE", proofs: [] };
  }
  for (const categoryKey of categories) {
    const scopeRows = rows.filter((row) => row.categoryKey === categoryKey);
    if (scopeRows.length !== 3 || new Set(scopeRows.map((row) => row.tier)).size !== 3 ||
        !TIERS.every((tier) => scopeRows.some((row) => row.tier === tier))) {
      return { status: "incomplete", reasonCode: "DATABASE_AVAILABILITY_TIER_SET_INCOMPLETE", proofs: [] };
    }
  }
  const candidates = revisions.map(toEntaClassicCandidate);
  if (candidates.some((candidate) => candidate === undefined)) {
    return { status: "rejected", reasonCode: "SELECTOR_SOURCE_TRANSFORM_REJECTED", proofs: [] };
  }
  const pool = candidates as NonNullable<(typeof candidates)[number]>[];
  const proofs: EntaSelectorReplayProof[] = [];
  for (const categoryKey of categories) {
    const freshRevisions = new Set<string>();
    const repeatRevisions = new Set<string>();
    const freshSources = new Set<string>();
    const repeatSources = new Set<string>();
    for (const tier of TIERS) {
      const row = rows.find((candidate) => candidate.categoryKey === categoryKey && candidate.tier === tier);
      if (!row) return { status: "incomplete", reasonCode: "DATABASE_AVAILABILITY_TIER_SET_INCOMPLETE", proofs: [] };
      let fresh: EntaClassicSelection;
      let repeat: EntaClassicSelection;
      try {
        fresh = selectEntaClassicTier(pool, { categoryKey, tier, seed: row.freshSelectionSeed });
        repeat = selectEntaClassicTier(pool, {
          categoryKey,
          tier,
          seed: row.repeatSelectionSeed,
          excludeIds: fresh.selectedQuestionRevisionIds,
        });
      } catch {
        return { status: "rejected", reasonCode: "SELECTOR_STORED_SEED_REPLAY_FAILED", proofs: [] };
      }
      if (!selectionEquals(fresh, row.freshSelectionIds, row.freshSelectionHash, row.freshSelectionSeed) ||
          !selectionEquals(repeat, row.repeatSelectionIds, row.repeatSelectionHash, row.repeatSelectionSeed)) {
        return { status: "rejected", reasonCode: "SELECTOR_STORED_SELECTION_MISMATCH", proofs: [] };
      }
      const expectedManifestHash = hashEntaClassicSelectionPair({ categoryKey, tier, fresh, repeat });
      if (expectedManifestHash !== row.selectionManifestHash) {
        return { status: "rejected", reasonCode: "SELECTOR_SELECTION_MANIFEST_MISMATCH", proofs: [] };
      }
      for (const id of fresh.selectedQuestionRevisionIds) {
        const sourceId = pool.find((candidate) => candidate.id === id)?.sourceQuestionId;
        if (!sourceId || freshRevisions.has(id) || freshSources.has(sourceId) || repeatRevisions.has(id) || repeatSources.has(sourceId)) {
          return { status: "rejected", reasonCode: "SELECTOR_FRESH_REPEAT_IDENTITY_OVERLAP", proofs: [] };
        }
        freshRevisions.add(id);
        freshSources.add(sourceId);
      }
      for (const id of repeat.selectedQuestionRevisionIds) {
        const sourceId = pool.find((candidate) => candidate.id === id)?.sourceQuestionId;
        if (!sourceId || freshRevisions.has(id) || freshSources.has(sourceId) || repeatRevisions.has(id) || repeatSources.has(sourceId)) {
          return { status: "rejected", reasonCode: "SELECTOR_FRESH_REPEAT_IDENTITY_OVERLAP", proofs: [] };
        }
        repeatRevisions.add(id);
        repeatSources.add(sourceId);
      }
      proofs.push({
        categoryKey, tier, selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION, selectorBuildId: ENTA_CLASSIC_SELECTOR_BUILD_ID,
        freshSelectionHash: fresh.selectionHash, repeatSelectionHash: repeat.selectionHash,
        selectionManifestHash: expectedManifestHash, freshSelectionIds: [...fresh.selectedQuestionRevisionIds],
        repeatSelectionIds: [...repeat.selectedQuestionRevisionIds],
      });
    }
  }
  return { status: "verified", proofs };
}
