import assert from "node:assert/strict";
import test from "node:test";
import { ENTA_CLASSIC_SELECTOR_VERSION, entaClassicTierAdapter, proveEntaClassicRepeatSupply, selectEntaClassicTier, toEntaClassicCandidate, type EntaClassicCandidate, type EntaClassicSourceQuestion } from "../src/catalog/selectors";
import { validateEntaClassicEvidence, type EntaClassicEvidenceVerifier, type EntaClassicValidationTarget, type EvidenceCheck } from "../src/catalog/evidence-validator";

function candidates(count = 8): EntaClassicCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `revision-${index + 1}`,
    categoryKey: "history",
    sourceQuestionId: `question-${index + 1}`,
    engine: "ENTA",
    mode: "CLASSIC",
    tier: "200",
    modality: "classic",
  }));
}

test("Enta classic selector is deterministic, mode/tier scoped and versioned", () => {
  const rows = candidates();
  const a = selectEntaClassicTier(rows, { categoryKey: "history", tier: "200", seed: 17 });
  const b = selectEntaClassicTier(rows, { categoryKey: "history", tier: "200", seed: 17 });
  assert.equal(a.selectorVersion, ENTA_CLASSIC_SELECTOR_VERSION);
  assert.deepEqual(a, b);
  assert.equal(a.selectedQuestionRevisionIds.length, 2);
  assert.throws(() => selectEntaClassicTier(rows, { categoryKey: "history", tier: "500", seed: 17 }), /INPUT_INVALID/);
  assert.throws(() => selectEntaClassicTier(rows.map((row) => ({ ...row, mode: "KIDS" as "CLASSIC" })), { categoryKey: "history", tier: "200", seed: 17 }), /INSUFFICIENT_TIER_SUPPLY/);
});

test("repeat evidence comes from the same selector and proves four distinct members", () => {
  const evidence = proveEntaClassicRepeatSupply(candidates(4), { categoryKey: "history", tier: "200", freshSeed: 1 });
  assert.equal(evidence.fresh.selectedQuestionRevisionIds.length, 2);
  assert.equal(evidence.repeat.selectedQuestionRevisionIds.length, 2);
  assert.equal(new Set([...evidence.fresh.selectedQuestionRevisionIds, ...evidence.repeat.selectedQuestionRevisionIds]).size, 4);
  assert.equal(evidence.selectionManifestHash.length, 64);
  assert.throws(() => proveEntaClassicRepeatSupply(candidates(3), { categoryKey: "history", tier: "200", freshSeed: 1 }), /NO_DISJOINT_REPEAT_RUN/);
});

test("repeat selector refuses cross-category, wrong-mode and unsafe member IDs", () => {
  const rows = [...candidates(4),
    { ...candidates(1)[0], id: "invalid/id", sourceQuestionId: "unsafe" },
    { ...candidates(1)[0], id: "other-category", categoryKey: "science" },
    { ...candidates(1)[0], id: "wrong-tier", tier: "400" },
  ];
  const evidence = proveEntaClassicRepeatSupply(rows, { categoryKey: "history", tier: "200", freshSeed: 4 });
  assert.ok([...evidence.fresh.selectedQuestionRevisionIds, ...evidence.repeat.selectedQuestionRevisionIds].every((id) => /^revision-/.test(id)));
});

function sourceRows(count = 4): EntaClassicSourceQuestion[] {
  return [200, 400, 600].flatMap((points) => Array.from({ length: count }, (_, index) => ({
    questionRevisionId: `revision-${points}-${index + 1}`,
    sourceQuestionId: `question-${points}-${index + 1}`,
    categoryKey: "history",
    sourceNamespace: "enta.question",
    sourceCategoryId: "source-category-1",
    sourceQuestionCategoryId: "source-category-1",
    categoryEditorialDecision: "APPROVED",
    questionEditorialDecision: "APPROVED",
    questionRightsDecision: "CLEARED",
    sourcePoints: points,
    engine: "ENTA",
    mode: "CLASSIC",
    tier: String(points),
    modality: "classic",
    sourceHasQuestionMedia: false,
    sourceCategoryHasCoverMedia: false,
  })));
}

const verified: EvidenceCheck = { status: "verified", evidenceRef: "synthetic-private-fixture" };
function verifier(overrides: Partial<EntaClassicEvidenceVerifier> = {}): EntaClassicEvidenceVerifier {
  return {
    async verifySourceMembership() { return verified; },
    async verifyStoredRevisionHashes(_rows, format) { assert.equal(format, "int4-pg-jsonb-v1"); return verified; },
    async verifyEditorialAndRights() { return verified; },
    ...overrides,
  };
}

const supply = ["200", "400", "600"].map((tier) => ({ categoryKey: "history", tier, freshSeed: 17 }));
function target(requiredSupply = supply): EntaClassicValidationTarget {
  return {
    catalogReleaseId: "synthetic-release",
    releaseRootHash: "a".repeat(64),
    sourceSnapshotHash: "b".repeat(64),
    selectorBuildId: "synthetic-selector-build",
    declaredAvailability: requiredSupply.map(({ categoryKey, tier }) => ({
      engine: "ENTA", mode: "CLASSIC", categoryKey, tier, modality: "classic", selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
    })),
    requiredSupply,
  };
}

test("Enta source transform requires sealed classic classification, approval, rights, and exact crosswalk", () => {
  const row = sourceRows(1)[0];
  assert.deepEqual(toEntaClassicCandidate(row), {
    id: row.questionRevisionId,
    categoryKey: row.categoryKey,
    sourceQuestionId: row.sourceQuestionId,
    engine: "ENTA",
    mode: "CLASSIC",
    tier: "200",
    modality: "classic",
  });
  for (const update of [
    { sourceQuestionCategoryId: "wrong-parent" },
    { mode: "KIDS" },
    { sourcePoints: 400 },
    { tier: "400" },
    { sourceNamespace: "huroof.question" },
    { categoryEditorialDecision: undefined as unknown as string },
    { categoryEditorialDecision: "PENDING" },
    { questionEditorialDecision: "PENDING" },
    { questionEditorialDecision: undefined as unknown as string },
    { questionRightsDecision: "HELD" },
    { modality: "DRAWING" },
    { sourceHasQuestionMedia: undefined as unknown as boolean },
    { sourceCategoryHasCoverMedia: undefined as unknown as boolean },
    { sourcePoints: 500 },
  ]) {
    assert.equal(toEntaClassicCandidate({ ...row, ...update }), undefined);
  }
});

test("private evidence validator accepts verified proofs from the shared host selector", async () => {
  const rows = sourceRows();
  const result = await validateEntaClassicEvidence({ target: target(), sourceRows: rows, verifier: verifier() });
  assert.equal(result.interfaceChecksPassed, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.supplyProofs, supply.map((scope) => {
    const selected = entaClassicTierAdapter.proveRepeatSupply(rows.map((row) => toEntaClassicCandidate(row)!), scope);
    return {
      catalogReleaseId: "synthetic-release", releaseRootHash: "a".repeat(64), sourceSnapshotHash: "b".repeat(64),
      selectorBuildId: "synthetic-selector-build", categoryKey: "history", tier: scope.tier as "200" | "400" | "600", modality: "classic", selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
      selectionManifestHash: selected.selectionManifestHash,
    };
  }));
  const serialized = JSON.stringify(result);
  for (const forbidden of ["prompt", "answer", "hint", "imageUrl", "videoUrl", "question-1"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("evidence validator fails closed for absent providers, wrong snapshot, false hashes, missing rights and changed media", async () => {
  const rows = sourceRows();
  const cases: Array<[string, Partial<EntaClassicEvidenceVerifier> | undefined, string]> = [
    ["missing provider", undefined, "SOURCE_MEMBERSHIP_UNAVAILABLE"],
    ["wrong source snapshot", verifier({ async verifySourceMembership() { return { status: "rejected", reasonCode: "SOURCE_SNAPSHOT_MISMATCH" }; } }), "SOURCE_SNAPSHOT_MISMATCH"],
    ["extra database membership", verifier({ async verifySourceMembership() { return { status: "rejected", reasonCode: "SOURCE_MEMBERSHIP_EXTRA_DB_MEMBER" }; } }), "SOURCE_MEMBERSHIP_EXTRA_DB_MEMBER"],
    ["false stored revision hash", verifier({ async verifyStoredRevisionHashes() { return { status: "rejected", reasonCode: "REVISION_HASH_MISMATCH" }; } }), "REVISION_HASH_MISMATCH"],
    ["missing editorial and rights receipt", verifier({ async verifyEditorialAndRights() { return { status: "unavailable", reasonCode: "EDITORIAL_RIGHTS_MISSING" }; } }), "EDITORIAL_RIGHTS_MISSING"],
    ["held rights receipt", verifier({ async verifyEditorialAndRights() { return { status: "rejected", reasonCode: "RIGHTS_RECEIPT_HELD" }; } }), "RIGHTS_RECEIPT_HELD"],
    ["stale rights receipt", verifier({ async verifyEditorialAndRights() { return { status: "rejected", reasonCode: "RIGHTS_SUBJECT_HASH_STALE" }; } }), "RIGHTS_SUBJECT_HASH_STALE"],
  ];
  for (const [label, evidenceVerifier, expectedReason] of cases) {
    const result = await validateEntaClassicEvidence({ target: target(), sourceRows: rows, verifier: evidenceVerifier });
    assert.equal(result.interfaceChecksPassed, false, label);
    assert.ok(result.reasons.includes(expectedReason), `${label}: ${result.reasons.join(",")}`);
  }

  let verifierCalls = 0;
  const mediaRows = rows.map((row) => ({ ...row, sourceHasQuestionMedia: true }));
  const mediaVerifier = verifier({
    async verifySourceMembership() { verifierCalls += 1; return verified; },
    async verifyStoredRevisionHashes() { verifierCalls += 1; return verified; },
    async verifyEditorialAndRights() { verifierCalls += 1; return verified; },
  });
  const mediaResult = await validateEntaClassicEvidence({ target: target(), sourceRows: mediaRows, verifier: mediaVerifier });
  assert.equal(mediaResult.interfaceChecksPassed, false);
  assert.ok(mediaResult.reasons.includes("MEDIA_NOT_SUPPORTED"));
  assert.equal(verifierCalls, 0, "text-only validation must reject media before invoking evidence adapters");
});

test("unsupported source mode and insufficient fresh/repeat supply stay unavailable", async () => {
  const validVerifier = verifier();
  const unsupported = sourceRows().map((row) => ({ ...row, mode: "STUDENT" }));
  const unsupportedResult = await validateEntaClassicEvidence({ target: target(), sourceRows: unsupported, verifier: validVerifier });
  assert.equal(unsupportedResult.interfaceChecksPassed, false);
  assert.ok(unsupportedResult.reasons.includes("SOURCE_TRANSFORM_REJECTED"));
  assert.deepEqual(unsupportedResult.supplyProofs, []);

  const shortResult = await validateEntaClassicEvidence({ target: target(), sourceRows: sourceRows(3), verifier: validVerifier });
  assert.equal(shortResult.interfaceChecksPassed, false);
  assert.ok(shortResult.reasons.includes("SELECTOR_FRESH_REPEAT_SUPPLY_INSUFFICIENT"));
});

test("evidence proofs require exact declared availability and bind release snapshot/build", async () => {
  const wrong = target();
  wrong.declaredAvailability = [...wrong.declaredAvailability, {
    engine: "ENTA", mode: "CLASSIC", categoryKey: "history", tier: "400", modality: "classic", selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
  }];
  const mismatch = await validateEntaClassicEvidence({ target: wrong, sourceRows: sourceRows(), verifier: verifier() });
  assert.equal(mismatch.interfaceChecksPassed, false);
  assert.ok(mismatch.reasons.includes("DECLARED_AVAILABILITY_MISMATCH"));
  assert.deepEqual(mismatch.supplyProofs, []);

  const duplicate = target();
  duplicate.requiredSupply = [...duplicate.requiredSupply, { ...duplicate.requiredSupply[0] }];
  duplicate.declaredAvailability = [...duplicate.declaredAvailability, { ...duplicate.declaredAvailability[0] }];
  const duplicateResult = await validateEntaClassicEvidence({ target: duplicate, sourceRows: sourceRows(), verifier: verifier() });
  assert.equal(duplicateResult.interfaceChecksPassed, false);
  assert.ok(duplicateResult.reasons.includes("DECLARED_AVAILABILITY_MISMATCH"));

  const unsupportedSelector = target();
  unsupportedSelector.declaredAvailability[0].selectorVersion = "invented-selector-v99";
  const selectorResult = await validateEntaClassicEvidence({ target: unsupportedSelector, sourceRows: sourceRows(), verifier: verifier() });
  assert.equal(selectorResult.interfaceChecksPassed, false);
  assert.ok(selectorResult.reasons.includes("DECLARED_AVAILABILITY_MISMATCH"));
});

test("declared Enta classic availability requires all three tiers for each advertised category before verifier I/O", async () => {
  for (const missing of ["600", "400"]) {
    const requiredSupply = supply.filter((entry) => entry.tier !== missing);
    let calls = 0;
    const result = await validateEntaClassicEvidence({
      target: target(requiredSupply),
      sourceRows: sourceRows(),
      verifier: verifier({ async verifySourceMembership() { calls += 1; return verified; } }),
    });
    assert.equal(result.interfaceChecksPassed, false);
    assert.ok(result.reasons.includes("DECLARED_AVAILABILITY_MISMATCH"));
    assert.equal(calls, 0);
  }

  const partialCategories = target(supply);
  partialCategories.declaredAvailability = [
    ...partialCategories.declaredAvailability,
    { ...partialCategories.declaredAvailability[0], categoryKey: "science" },
  ];
  const categoryResult = await validateEntaClassicEvidence({ target: partialCategories, sourceRows: sourceRows(), verifier: verifier() });
  assert.ok(categoryResult.reasons.includes("DECLARED_AVAILABILITY_MISMATCH"));
});
