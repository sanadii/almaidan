import { createHash } from "node:crypto";

export const ENTA_CLASSIC_SELECTOR_VERSION = "enta-curated-classic-tier-v2";
/** Bumped whenever selector implementation or persisted selection encoding changes. */
export const ENTA_CLASSIC_SELECTOR_BUILD_ID = "enta-curated-classic-tier-v2+stored-seed-replay-v1";
const CLASSIC_TIERS = new Set(["200", "400", "600"]);
const SAFE_REVISION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface EntaClassicCandidate {
  id: string;
  categoryKey: string;
  sourceQuestionId: string;
  engine: "ENTA";
  mode: "CLASSIC";
  tier: string;
  modality: "classic";
}

/**
 * Minimal sealed catalog facts needed to prove the Enta-to-catalog classic transform.
 * No prompt, answer, hint, or media URL is carried into the selector.
 */
export interface EntaClassicSourceQuestion {
  questionRevisionId: string;
  sourceQuestionId: string;
  categoryKey: string;
  sourceNamespace: string;
  sourceCategoryId: string;
  sourceQuestionCategoryId: string;
  categoryEditorialDecision: string;
  questionEditorialDecision: string;
  questionRightsDecision: string;
  sourcePoints: number;
  engine: string;
  mode: string;
  tier: string;
  modality: string;
  sourceHasQuestionMedia: boolean;
  sourceCategoryHasCoverMedia: boolean;
}

export interface EntaClassicSelection {
  selectorVersion: typeof ENTA_CLASSIC_SELECTOR_VERSION;
  seed: number;
  tier: "200" | "400" | "600";
  selectedQuestionRevisionIds: string[];
  selectionHash: string;
}

export interface EntaClassicRepeatEvidence {
  selectorVersion: typeof ENTA_CLASSIC_SELECTOR_VERSION;
  categoryKey: string;
  tier: "200" | "400" | "600";
  modality: "classic";
  fresh: EntaClassicSelection;
  repeat: EntaClassicSelection;
  selectionManifestHash: string;
}

/** Rebuild the exact persisted two-run digest without searching for a seed. */
export function hashEntaClassicSelectionPair(input: {
  categoryKey: string;
  tier: string;
  fresh: EntaClassicSelection;
  repeat: EntaClassicSelection;
}): string {
  const { fresh, repeat } = input;
  return sha256([
    ENTA_CLASSIC_SELECTOR_VERSION,
    input.categoryKey,
    input.tier,
    "classic",
    String(fresh.seed),
    fresh.selectedQuestionRevisionIds.join(","),
    fresh.selectionHash,
    String(repeat.seed),
    repeat.selectedQuestionRevisionIds.join(","),
    repeat.selectionHash,
  ].join("\n"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function seededOrder<T extends { id: string }>(values: readonly T[], seed: number): T[] {
  const result = [...values].sort((a, b) => a.id.localeCompare(b.id));
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Map only a sealed, explicitly editorially approved text Enta CLASSIC
 * revision with an exact source crosswalk and a supported actual point tier.
 * Legacy mutable source category type/activity flags are deliberately absent.
 */
export function toEntaClassicCandidate(row: EntaClassicSourceQuestion): EntaClassicCandidate | undefined {
  const tier = String(row.sourcePoints);
  if (row.sourceNamespace !== "enta.question" || row.sourceCategoryId !== row.sourceQuestionCategoryId ||
      row.categoryEditorialDecision !== "APPROVED" || row.questionEditorialDecision !== "APPROVED" ||
      row.questionRightsDecision !== "CLEARED" || row.engine !== "ENTA" || row.mode !== "CLASSIC" ||
      row.tier !== tier || row.modality !== "classic" ||
      row.sourceHasQuestionMedia !== false || row.sourceCategoryHasCoverMedia !== false ||
      !CLASSIC_TIERS.has(tier) || !SAFE_REVISION_ID.test(row.questionRevisionId) ||
      !SAFE_REVISION_ID.test(row.sourceQuestionId) || !SAFE_REVISION_ID.test(row.categoryKey)) {
    return undefined;
  }
  return {
    id: row.questionRevisionId,
    categoryKey: row.categoryKey,
    sourceQuestionId: row.sourceQuestionId,
    engine: "ENTA",
    mode: "CLASSIC",
    tier,
    modality: "classic",
  };
}

/** The exact pure Enta classic selector used by future catalog-backed host creation. */
export function selectEntaClassicTier(
  candidates: readonly EntaClassicCandidate[],
  input: { categoryKey: string; tier: string; seed: number; excludeIds?: readonly string[] },
): EntaClassicSelection {
  if (!CLASSIC_TIERS.has(input.tier) || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xffffffff) {
    throw new Error("ENTA_CLASSIC_SELECTOR_INPUT_INVALID");
  }
  const excluded = new Set(input.excludeIds ?? []);
  const scoped = candidates.filter((candidate) =>
    candidate.engine === "ENTA" && candidate.mode === "CLASSIC" && candidate.modality === "classic" &&
    candidate.categoryKey === input.categoryKey && candidate.tier === input.tier && SAFE_REVISION_ID.test(candidate.id) &&
    SAFE_REVISION_ID.test(candidate.sourceQuestionId) && !excluded.has(candidate.id),
  );
  if (new Set(scoped.map((candidate) => candidate.id)).size !== scoped.length ||
      new Set(scoped.map((candidate) => candidate.sourceQuestionId)).size !== scoped.length) {
    throw new Error("ENTA_CLASSIC_SELECTOR_DUPLICATE_SOURCE");
  }
  const chosen = seededOrder(scoped, input.seed).slice(0, 2);
  if (chosen.length !== 2) throw new Error("ENTA_CLASSIC_SELECTOR_INSUFFICIENT_TIER_SUPPLY");
  const selectedQuestionRevisionIds = chosen.map(({ id }) => id);
  return {
    selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
    seed: input.seed,
    tier: input.tier as EntaClassicSelection["tier"],
    selectedQuestionRevisionIds,
    selectionHash: sha256(selectedQuestionRevisionIds.join(",")),
  };
}

/** Produces evidence only when the same adapter proves two disjoint board runs. */
export function proveEntaClassicRepeatSupply(
  candidates: readonly EntaClassicCandidate[],
  input: { categoryKey: string; tier: string; freshSeed: number },
): EntaClassicRepeatEvidence {
  const fresh = selectEntaClassicTier(candidates, { ...input, seed: input.freshSeed });
  let repeat: EntaClassicSelection | undefined;
  for (let offset = 1; offset <= 256; offset += 1) {
    const seed = (input.freshSeed + offset) >>> 0;
    try {
      repeat = selectEntaClassicTier(candidates, {
        categoryKey: input.categoryKey,
        tier: input.tier,
        seed,
        excludeIds: fresh.selectedQuestionRevisionIds,
      });
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "ENTA_CLASSIC_SELECTOR_INSUFFICIENT_TIER_SUPPLY") throw error;
    }
  }
  if (!repeat) throw new Error("ENTA_CLASSIC_SELECTOR_NO_DISJOINT_REPEAT_RUN");
  return {
    selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
    categoryKey: input.categoryKey,
    tier: input.tier as EntaClassicRepeatEvidence["tier"],
    modality: "classic",
    fresh,
    repeat,
    selectionManifestHash: hashEntaClassicSelectionPair({ categoryKey: input.categoryKey, tier: input.tier, fresh, repeat }),
  };
}

/** Shared adapter for validation and future catalog-backed host creation. */
export const entaClassicTierAdapter = Object.freeze({
  version: ENTA_CLASSIC_SELECTOR_VERSION,
  select: selectEntaClassicTier,
  proveRepeatSupply: proveEntaClassicRepeatSupply,
});
