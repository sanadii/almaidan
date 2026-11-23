import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CatalogUnavailableError, readPublicCatalog } from "../src/catalog/service";
import { huroofCapabilityHash, huroofInventoryHash, huroofSelectorAttestationHash } from "../src/catalog/attestation";
import { ENTA_CLASSIC_SELECTOR_VERSION } from "../src/catalog/selectors";
import { HUROOF_SOURCE_NAMESPACE, type ActiveCatalogRecord, type CatalogValidationProofProjection, type HuroofReleaseReader } from "../src/catalog/types";

const hash = (c: string) => c.repeat(64);
const validProof = (): CatalogValidationProofProjection => ({
  id: "proof-distinct-from-receipt", catalogReleaseId: "release-1", releaseRootHash: hash("a"),
  sealHash: hash("b"), policyVersion: "enta-r3e-private-issuer-v1", sourceSummarySha256: hash("c"), selectorVersion: "selector-1",
});
const active = (policyVersion = "enta-r3e-private-issuer-v1"): ActiveCatalogRecord => ({
  pointerReleaseId: "release-1", pointerRootHash: hash("a"), pointerReceiptId: "receipt-1", releaseSealedAt: new Date(0),
  releaseId: "release-1", releaseRootHash: hash("a"), sourceSnapshots: [], categories: [],
  validation: {
    id: "receipt-1", catalogReleaseId: "release-1", releaseRootHash: hash("a"), sealHash: hash("b"), rawReceiptSealHash: hash("b"),
    proofId: "proof-distinct-from-receipt", proof: validProof(), validatorRef: "private-validator-sentinel", policyVersion,
    sourceEvidenceManifestHash: hash("c"), selectorVersion: "selector-1", huroofProjectId: null, huroofReleaseId: null,
    huroofRootSha256: null, huroofCapabilityStateHash: null, huroofSelectorAttestation: null,
  },
});

function eligibleHuroof(policyVersion = "enta-r3e-private-issuer-v1") {
  const row = active(policyVersion);
  const categoryInventory = [{ categoryKey: "cat", approvedCount: 1, uniqueAnswerConceptCount: 0, playable: { huroof: true, categories: false, charades: false } }];
  const capabilityFlags = { catalog: true };
  const inventoryHash = huroofInventoryHash(categoryInventory);
  const capabilityStateHash = huroofCapabilityHash(capabilityFlags);
  const selectorAttestation = {
    issuer: "huroof-functions" as const, projectId: "project", deploymentId: "deployment", releaseId: "h-release", rootSha256: hash("d"),
    approvedCount: 1, categoryInventory, inventoryHash, capabilityStateHash, selectorVersion: "selector-1", policyVersion: "h-policy", attestedAt: new Date(0),
  };
  const selectorAttestationHash = huroofSelectorAttestationHash(selectorAttestation);
  row.sourceSnapshots = [{ sourceNamespace: HUROOF_SOURCE_NAMESPACE, sourceReleaseId: "h-release", sourceRootSha256: hash("d"), snapshotHash: hash("e") }];
  row.validation.huroofProjectId = "project";
  row.validation.huroofReleaseId = "h-release";
  row.validation.huroofRootSha256 = hash("d");
  row.validation.huroofCapabilityStateHash = capabilityStateHash;
  row.validation.huroofSelectorAttestation = selectorAttestationHash;
  row.categories = [{
    categoryKey: "cat", labelAr: "فئة", description: null, editorialDecision: "APPROVED",
    availability: [{ engine: "HUROOF", mode: "huroof", tier: "200", modality: "classic", selectorVersion: "selector-1", selectionManifestHash: hash("1"), freshSelectionHash: hash("2"), repeatSelectionHash: hash("3"), freshSelectionIds: ["q1", "q2"], repeatSelectionIds: ["q3", "q4"], freshSelectionSeed: 1, repeatSelectionSeed: 2, validatedAt: new Date(0) }],
  }];
  let reads = 0;
  const reader: HuroofReleaseReader = {
    projectId: "project", purpose: "paid-readiness" as const, expectedSelectorVersion: "selector-1", expectedPolicyVersion: "h-policy",
    async readActiveRelease() { reads++; return { projectId: "project", releaseId: "h-release", rootSha256: hash("d"), approvedCount: 1, categoryInventory, inventoryHash, capabilityStateHash, capabilityFlags, selectorAttestation }; },
  };
  return { row, reader, reads: () => reads };
}

async function run(row: ActiveCatalogRecord, reader?: HuroofReleaseReader, expectedFirebaseProjectId = "project") {
  let reads = 0;
  const effectiveReader = reader ?? {
    projectId: "project", purpose: "paid-readiness" as const, expectedSelectorVersion: "selector-1", expectedPolicyVersion: "h-policy",
    async readActiveRelease() { reads++; throw new Error("unexpected reader access"); },
  };
  const result = await readPublicCatalog({ store: { async readActiveCatalog() { return row; } }, huroofReader: effectiveReader, expectedFirebaseProjectId });
  return { result, reads: reader ? undefined : reads };
}

async function assertUnavailable(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailableError);
    assert.equal(error.message, "CATALOG_UNAVAILABLE");
    assert.equal(JSON.stringify(error), "{}");
    return true;
  });
}

function validEntaAvailability(categoryKey: string) {
  const selectorVersion = ENTA_CLASSIC_SELECTOR_VERSION;
  const tier = "400", modality = "classic", freshSelectionIds = ["fresh-1", "fresh-2"], repeatSelectionIds = ["repeat-1", "repeat-2"];
  const freshSelectionSeed = 13, repeatSelectionSeed = 29;
  const freshSelectionHash = sha(freshSelectionIds.join(","));
  const repeatSelectionHash = sha(repeatSelectionIds.join(","));
  const selectionManifestHash = sha([selectorVersion, categoryKey, tier, modality, String(freshSelectionSeed), freshSelectionIds.join(","), freshSelectionHash, String(repeatSelectionSeed), repeatSelectionIds.join(","), repeatSelectionHash].join("\n"));
  return { engine: "ENTA", mode: "CLASSIC", tier, modality, selectorVersion, selectionManifestHash, freshSelectionHash, repeatSelectionHash, freshSelectionIds, repeatSelectionIds, freshSelectionSeed, repeatSelectionSeed, validatedAt: new Date(0) };
}
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

test("supplied exact R3-E links reach eligible Huroof and public JSON excludes private proof values", async () => {
  const fixture = eligibleHuroof();
  (fixture.row.validation.proof as unknown as Record<string, unknown>).sourceEvidenceManifestSha256 = hash("f");
  const { result } = await run(fixture.row, fixture.reader);
  assert.equal(fixture.reads(), 1);
  assert.deepEqual(result.sources.huroof, { available: true, releaseId: "h-release", rootHash: hash("d") });
  assert.equal(result.categories[0].availability[0].engine, "HUROOF");
  assert.deepEqual(result.release, { id: "release-1", rootHash: hash("a") });
  const json = JSON.stringify(result);
  for (const privateValue of ["proof-distinct-from-receipt", "private-validator-sentinel", hash("f"), "proofId", "rawReceiptSealHash", "INCLUDED_EDGES_EQUAL", "STRUCTURAL_MATCH"]) assert.equal(json.includes(privateValue), false, privateValue);
});

test("each included edge mismatch rejects before an otherwise eligible Huroof read", async () => {
  const cases: Array<(row: ActiveCatalogRecord) => void> = [
    row => { row.validation.proofId = "different"; },
    row => { row.validation.proof!.catalogReleaseId = "different"; },
    row => { row.validation.proof!.releaseRootHash = hash("d"); },
    row => { row.validation.proof!.sealHash = hash("d"); },
    row => { row.validation.proof!.policyVersion = "different"; },
    row => { row.validation.proof!.sourceSummarySha256 = hash("d"); },
    row => { row.validation.proof!.selectorVersion = "different"; },
    row => { row.validation.rawReceiptSealHash = hash("d"); },
  ];
  for (const mutate of cases) {
    const fixture = eligibleHuroof(); mutate(fixture.row);
    await assertUnavailable(readPublicCatalog({ store: { async readActiveCatalog() { return fixture.row; } }, huroofReader: fixture.reader, expectedFirebaseProjectId: "project" }));
    assert.equal(fixture.reads(), 0);
  }
});

test("missing, null, malformed proof edges and raw-seal mismatch fail with fixed value-free error", async () => {
  const fields: Array<keyof CatalogValidationProofProjection> = ["id", "catalogReleaseId", "releaseRootHash", "sealHash", "policyVersion", "sourceSummarySha256", "selectorVersion"];
  for (const field of fields) {
    for (const bad of [null, ""]) {
      const row = active();
      (row.validation.proof as unknown as Record<string, unknown>)[field] = bad;
      await assertUnavailable(run(row));
    }
  }
  const proofIdMissing = active(); proofIdMissing.validation.proofId = undefined;
  const proofIdEmpty = active(); proofIdEmpty.validation.proofId = "";
  const rawSealMissing = active(); rawSealMissing.validation.rawReceiptSealHash = undefined;
  const proofNull = active(); proofNull.validation.proof = null;
  const proofUndefined = active(); proofUndefined.validation.proof = undefined;
  const proofAbsent = active(); delete proofAbsent.validation.proof;
  const rawSealNull = active(); rawSealNull.validation.rawReceiptSealHash = null;
  const rawSealMismatch = active(); rawSealMismatch.validation.rawReceiptSealHash = hash("d");
  const rawSealMalformed = active(); rawSealMalformed.validation.rawReceiptSealHash = "A".repeat(64);
  const rawSealEmpty = active(); rawSealEmpty.validation.rawReceiptSealHash = "";
  const malformedHash = active(); malformedHash.validation.proof!.releaseRootHash = "A".repeat(64);
  for (const row of [proofIdMissing, proofIdEmpty, rawSealMissing, proofNull, proofUndefined, proofAbsent, rawSealNull, rawSealMismatch, rawSealMalformed, rawSealEmpty, malformedHash]) await assertUnavailable(run(row));
});

test("full signed-manifest digest is ignored for E3 and cannot replace source summary", async () => {
  const positive = active();
  (positive.validation.proof as unknown as Record<string, unknown>).sourceEvidenceManifestSha256 = hash("f");
  const { result } = await run(positive);
  assert.deepEqual(result.release, { id: "release-1", rootHash: hash("a") });
  assert.equal(JSON.stringify(result).includes(hash("f")), false);
  const swapped = active(); swapped.validation.proof!.sourceSummarySha256 = hash("f");
  await assertUnavailable(run(swapped));
});

test("exact R3-E correspondence precedes baseline pointer, release and receipt join failures", async () => {
  const mutations: Array<(row: ActiveCatalogRecord) => void> = [
    row => { row.pointerReleaseId = "other-release"; },
    row => { row.pointerRootHash = hash("d"); },
    row => { row.pointerReceiptId = "other-receipt"; },
    row => { row.validation.catalogReleaseId = "other-release"; },
  ];
  for (const mutate of mutations) {
    const fixture = eligibleHuroof(); mutate(fixture.row);
    await assertUnavailable(readPublicCatalog({ store: { async readActiveCatalog() { return fixture.row; } }, huroofReader: fixture.reader, expectedFirebaseProjectId: "project" }));
    assert.equal(fixture.reads(), 0);
  }
});

test("legacy and near-match policies preserve Huroof DTO/read behavior with absent, null and mismatched optional fields", async () => {
  let baselineDto: unknown;
  for (const variant of ["absent", "null", "mismatch"] as const) {
    const fixture = eligibleHuroof("legacy-policy");
    if (variant === "absent") {
      delete fixture.row.validation.proofId; delete fixture.row.validation.proof; delete fixture.row.validation.rawReceiptSealHash;
    } else if (variant === "null") {
      fixture.row.validation.proofId = null; fixture.row.validation.proof = null; fixture.row.validation.rawReceiptSealHash = null;
    } else {
      fixture.row.validation.proofId = "wrong"; fixture.row.validation.proof = { ...validProof(), catalogReleaseId: "wrong" }; fixture.row.validation.rawReceiptSealHash = hash("d");
    }
    const { result } = await run(fixture.row, fixture.reader);
    assert.equal(fixture.reads(), 1, variant);
    assert.deepEqual(result.sources.huroof, { available: true, releaseId: "h-release", rootHash: hash("d") });
    assert.equal(JSON.stringify(result).includes("proof-distinct-from-receipt"), false);
    if (baselineDto === undefined) baselineDto = result; else assert.deepEqual(result, baselineDto, variant);
  }
  const nearMatch = eligibleHuroof("enta-r3e-private-issuer-v1 "); nearMatch.row.validation.proof = null;
  const { result } = await run(nearMatch.row, nearMatch.reader);
  assert.equal(nearMatch.reads(), 1);
  assert.equal(result.sources.huroof.available, true);
  assert.deepEqual(result, baselineDto);
});

test("prohibited Huroof project guard stays in force after a valid exact R3-E link", async () => {
  const fixture = eligibleHuroof();
  const { result } = await run(fixture.row, fixture.reader, "huroof-a3ee7");
  assert.equal(fixture.reads(), 0);
  assert.deepEqual(result.sources.huroof, { available: false });
});

test("ENTA CLASSIC valid availability is retained and invalid availability is filtered", async () => {
  const valid = active("legacy-policy");
  const entry = validEntaAvailability("cat");
  valid.categories = [{ categoryKey: "cat", labelAr: "فئة", description: null, editorialDecision: "APPROVED", availability: [entry, { ...entry, tier: "999" }] }];
  const { result } = await run(valid);
  assert.equal(result.sources.enta.available, true);
  assert.deepEqual(result.categories[0].availability, [{ engine: "ENTA", mode: "CLASSIC", tier: "400", modality: "classic" }]);
  const invalid = active("legacy-policy");
  invalid.categories = [{ categoryKey: "cat", labelAr: "فئة", description: null, editorialDecision: "APPROVED", availability: [{ ...entry, tier: "999" }] }];
  const filtered = await run(invalid);
  assert.equal(filtered.result.sources.enta.available, false);
  assert.deepEqual(filtered.result.categories[0].availability, []);
});
