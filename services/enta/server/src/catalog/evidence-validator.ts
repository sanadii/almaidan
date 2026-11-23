import { ENTA_CLASSIC_SELECTOR_VERSION, entaClassicTierAdapter, toEntaClassicCandidate, type EntaClassicSourceQuestion } from "./selectors";
export { deriveEntaSourceId, parseJsonRejectingDuplicateKeys, verifyEntaSourceArtifactSnapshot } from "./source-artifact";

export type EvidenceCheck =
  | { status: "verified"; evidenceRef: string }
  | { status: "rejected"; reasonCode: string }
  | { status: "unavailable"; reasonCode: string };

export interface EntaClassicEvidenceVerifier {
  /** Independently verifies archived artifact bytes/root, snapshot and exact membership. */
  verifySourceMembership(rows: readonly EntaClassicSourceQuestion[]): Promise<EvidenceCheck>;
  /** Hashes exact SQL payload TEXT bytes using PostgreSQL jsonb::text format. */
  verifyStoredRevisionHashes(rows: readonly EntaClassicSourceQuestion[], format: "int4-pg-jsonb-v1"): Promise<EvidenceCheck>;
  /** Verifies exact category metadata and question editorial/rights receipts. */
  verifyEditorialAndRights(rows: readonly EntaClassicSourceQuestion[]): Promise<EvidenceCheck>;
}

export interface EntaClassicRequiredSupply {
  categoryKey: string;
  tier: string;
  freshSeed: number;
}

export interface EntaClassicDeclaredAvailability {
  engine: string;
  mode: string;
  categoryKey: string;
  tier: string;
  modality: string;
  selectorVersion: string;
}

export interface EntaClassicValidationTarget {
  catalogReleaseId: string;
  releaseRootHash: string;
  sourceSnapshotHash: string;
  selectorBuildId: string;
  declaredAvailability: readonly EntaClassicDeclaredAvailability[];
  requiredSupply: readonly EntaClassicRequiredSupply[];
}

export interface EntaClassicEvidenceValidation {
  /**
   * True means only that every injected verifier hook and selector check passed.
   * It is not a receipt, publication decision, or independent evidence claim.
   */
  interfaceChecksPassed: boolean;
  reasons: string[];
  /** Private proof metadata, bound to one exact release/snapshot/build. */
  supplyProofs: Array<{
    catalogReleaseId: string;
    releaseRootHash: string;
    sourceSnapshotHash: string;
    selectorBuildId: string;
    categoryKey: string;
    tier: "200" | "400" | "600";
    modality: "classic";
    selectorVersion: string;
    selectionManifestHash: string;
  }>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9:_-]{1,128}$/;
const TIERS = new Set(["200", "400", "600"]);

function checkResult(value: unknown, missingCode: string): EvidenceCheck {
  if (value === null || typeof value !== "object") return { status: "unavailable", reasonCode: missingCode };
  const check = value as Partial<EvidenceCheck>;
  if (check.status === "verified" && typeof check.evidenceRef === "string" && check.evidenceRef.trim()) return check as EvidenceCheck;
  if ((check.status === "rejected" || check.status === "unavailable") &&
      typeof check.reasonCode === "string" && /^[A-Z0-9_]{1,80}$/.test(check.reasonCode)) return check as EvidenceCheck;
  return { status: "unavailable", reasonCode: missingCode };
}

function scopeKey(value: { categoryKey: string; tier: string }): string {
  return `${value.categoryKey}\u0000${value.tier}\u0000classic`;
}

function exactAvailabilityMatches(target: EntaClassicValidationTarget): boolean {
  const requiredByCategory = new Map<string, Set<string>>();
  for (const entry of target.requiredSupply) {
    const tiers = requiredByCategory.get(entry.categoryKey) ?? new Set<string>();
    tiers.add(entry.tier);
    requiredByCategory.set(entry.categoryKey, tiers);
  }
  const expected = target.requiredSupply.map(scopeKey);
  const declared = target.declaredAvailability.map((entry) => {
    if (entry.engine !== "ENTA" || entry.mode !== "CLASSIC" || entry.modality !== "classic" ||
        entry.selectorVersion !== ENTA_CLASSIC_SELECTOR_VERSION) return "unsupported";
    return scopeKey(entry);
  });
  const completeTierSets = requiredByCategory.size > 0 && [...requiredByCategory.values()].every((tiers) =>
    tiers.size === 3 && [...TIERS].every((tier) => tiers.has(tier)));
  const declaredCategories = new Set(target.declaredAvailability.map((entry) => entry.categoryKey));
  return completeTierSets && declaredCategories.size === requiredByCategory.size &&
    [...declaredCategories].every((category) => requiredByCategory.has(category)) &&
    expected.length > 0 && declared.length === expected.length &&
    new Set(expected).size === expected.length && new Set(declared).size === declared.length &&
    expected.every((key) => declared.includes(key)) &&
    target.requiredSupply.every((entry) => KEY.test(entry.categoryKey) && TIERS.has(entry.tier));
}

/**
 * Private fail-closed validation coordinator. It does not calculate SQL
 * JSONB hashes, read/parse the archived artifact, issue receipts, or publish.
 * Those actions must be implemented by reviewed trusted adapters. A passing
 * result from a test double is interface evidence only.
 */
export async function validateEntaClassicEvidence(input: {
  target: EntaClassicValidationTarget;
  sourceRows: readonly EntaClassicSourceQuestion[];
  verifier?: Partial<EntaClassicEvidenceVerifier>;
}): Promise<EntaClassicEvidenceValidation> {
  const reasons: string[] = [];
  const supplyProofs: EntaClassicEvidenceValidation["supplyProofs"] = [];
  const candidates = input.sourceRows.flatMap((row) => {
    const candidate = toEntaClassicCandidate(row);
    return candidate ? [candidate] : [];
  });

  if (!input.target.catalogReleaseId.trim() || !SHA256.test(input.target.releaseRootHash) ||
      !SHA256.test(input.target.sourceSnapshotHash) || !input.target.selectorBuildId.trim()) {
    reasons.push("VALIDATION_TARGET_INCOMPLETE");
  }
  if (!exactAvailabilityMatches(input.target)) reasons.push("DECLARED_AVAILABILITY_MISMATCH");
  if (input.sourceRows.length === 0 || candidates.length !== input.sourceRows.length) reasons.push("SOURCE_TRANSFORM_REJECTED");
  if (input.sourceRows.some((row) => row.sourceHasQuestionMedia || row.sourceCategoryHasCoverMedia)) {
    reasons.push("MEDIA_NOT_SUPPORTED");
  }
  if (new Set(candidates.map((row) => row.id)).size !== candidates.length ||
      new Set(candidates.map((row) => row.sourceQuestionId)).size !== candidates.length) {
    reasons.push("SOURCE_MEMBERSHIP_DUPLICATE");
  }

  // Fail before verifier I/O for unsupported transforms/media or ambiguous
  // availability. In this first version media flags always close validation.
  if (reasons.length === 0) {
    const checks: Array<[string, (() => Promise<EvidenceCheck>) | undefined]> = [
      ["SOURCE_MEMBERSHIP_UNAVAILABLE", input.verifier?.verifySourceMembership
        ? () => input.verifier!.verifySourceMembership!(input.sourceRows) : undefined],
      ["REVISION_HASH_UNAVAILABLE", input.verifier?.verifyStoredRevisionHashes
        ? () => input.verifier!.verifyStoredRevisionHashes!(input.sourceRows, "int4-pg-jsonb-v1") : undefined],
      ["EDITORIAL_RIGHTS_UNAVAILABLE", input.verifier?.verifyEditorialAndRights
        ? () => input.verifier!.verifyEditorialAndRights!(input.sourceRows) : undefined],
    ];
    for (const [missingCode, run] of checks) {
      if (!run) { reasons.push(missingCode); continue; }
      try {
        const result = await run();
        const checked = checkResult(result, missingCode);
        if (checked.status !== "verified") reasons.push(checked.reasonCode);
      } catch {
        reasons.push(missingCode);
      }
    }
  }

  if (reasons.length === 0) {
    for (const required of input.target.requiredSupply) {
      try {
        const evidence = entaClassicTierAdapter.proveRepeatSupply(candidates, required);
        supplyProofs.push({
          catalogReleaseId: input.target.catalogReleaseId,
          releaseRootHash: input.target.releaseRootHash,
          sourceSnapshotHash: input.target.sourceSnapshotHash,
          selectorBuildId: input.target.selectorBuildId,
          categoryKey: evidence.categoryKey,
          tier: evidence.tier,
          modality: evidence.modality,
          selectorVersion: evidence.selectorVersion,
          selectionManifestHash: evidence.selectionManifestHash,
        });
      } catch (error) {
        reasons.push(error instanceof Error && error.message === "ENTA_CLASSIC_SELECTOR_NO_DISJOINT_REPEAT_RUN"
          ? "SELECTOR_FRESH_REPEAT_SUPPLY_INSUFFICIENT"
          : "SELECTOR_SUPPLY_REJECTED");
      }
    }
  }

  return { interfaceChecksPassed: reasons.length === 0, reasons: [...new Set(reasons)].sort(), supplyProofs };
}
