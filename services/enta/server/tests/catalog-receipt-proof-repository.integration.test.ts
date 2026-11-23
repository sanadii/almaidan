import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrismaCatalogStore } from "../src/catalog/repository";
import { CatalogUnavailableError, readPublicCatalog } from "../src/catalog/service";
import { huroofCapabilityHash, huroofInventoryHash, huroofSelectorAttestationHash } from "../src/catalog/attestation";

const hash = (c: string) => c.repeat(64);
const expectedQuery = {
  where: { id: "singleton" },
  select: {
    catalogReleaseId: true,
    releaseRootHash: true,
    validationReceiptId: true,
    validationReceipt: { select: {
      id: true, catalogReleaseId: true, releaseRootHash: true, validatorRef: true, policyVersion: true,
      sourceEvidenceManifestHash: true, selectorVersion: true, huroofProjectId: true, huroofReleaseId: true,
      huroofRootSha256: true, huroofCapabilityStateHash: true, huroofSelectorAttestation: true,
      releaseSeal: { select: { sealHash: true } },
    } },
    catalogRelease: { select: {
      id: true, releaseRootHash: true, sealedAt: true,
      sourceSnapshots: { select: { sourceNamespace: true, sourceReleaseId: true, sourceRootSha256: true, snapshotHash: true } },
      categories: { select: {
        categoryKey: true,
        categoryRevision: { select: { labelAr: true, description: true, editorialDecision: true } },
        availability: { select: {
          engine: true, mode: true, tier: true, modality: true, selectorVersion: true, selectionManifestHash: true,
          freshSelectionHash: true, repeatSelectionHash: true, freshSelectionIds: true, repeatSelectionIds: true,
          freshSelectionSeed: true, repeatSelectionSeed: true, validatedAt: true,
        } },
      } },
    } },
  },
} as const;

function backingRow(policyVersion = "legacy-policy", withHuroof = false) {
  return {
    catalogReleaseId: "release-1", releaseRootHash: hash("a"), validationReceiptId: "receipt-1",
    validationReceipt: {
      id: "receipt-1", catalogReleaseId: "release-1", releaseRootHash: hash("a"), validatorRef: "private-validator",
      policyVersion, sourceEvidenceManifestHash: hash("c"), selectorVersion: "selector-1",
      huroofProjectId: withHuroof ? "project" : null, huroofReleaseId: withHuroof ? "h-release" : null,
      huroofRootSha256: withHuroof ? hash("d") : null, huroofCapabilityStateHash: withHuroof ? hash("e") : null,
      huroofSelectorAttestation: withHuroof ? hash("f") : null, releaseSeal: { sealHash: hash("b") },
      proofId: "unselected-proof-sentinel", rawReceiptSealHash: hash("9"), proof: { id: "unselected-proof-sentinel" },
    },
    catalogRelease: {
      id: "release-1", releaseRootHash: hash("a"), sealedAt: new Date(0),
      sourceSnapshots: withHuroof ? [{ sourceNamespace: "huroof.firestore", sourceReleaseId: "h-release", sourceRootSha256: hash("d"), snapshotHash: hash("e") }] : [],
      categories: [],
    },
  };
}

function eligibleHuroofReader() {
  const categoryInventory = [{ categoryKey: "cat", approvedCount: 1, uniqueAnswerConceptCount: 0, playable: { huroof: true, categories: false, charades: false } }];
  const capabilityFlags = { catalog: true };
  const inventoryHash = huroofInventoryHash(categoryInventory);
  const capabilityStateHash = huroofCapabilityHash(capabilityFlags);
  const selectorAttestation = {
    issuer: "huroof-functions" as const, projectId: "project", deploymentId: "deployment", releaseId: "h-release", rootSha256: hash("d"),
    approvedCount: 1, categoryInventory, inventoryHash, capabilityStateHash, selectorVersion: "selector-1", policyVersion: "h-policy", attestedAt: new Date(0),
  };
  const selectorAttestationHash = huroofSelectorAttestationHash(selectorAttestation);
  const reader = {
    projectId: "project", purpose: "paid-readiness" as const, expectedSelectorVersion: "selector-1", expectedPolicyVersion: "h-policy",
    async readActiveRelease() { reads++; return { projectId: "project", releaseId: "h-release", rootSha256: hash("d"), approvedCount: 1, categoryInventory, inventoryHash, capabilityStateHash, capabilityFlags, selectorAttestation }; },
  };
  let reads = 0;
  return { reader, selectorAttestationHash, capabilityStateHash, reads: () => reads };
}

function selectProjection(value: unknown, select: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map(item => selectProjection(item, select));
  assert.ok(value !== null && typeof value === "object");
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, projection] of Object.entries(select)) {
    if (projection === true) output[key] = source[key];
    else if (projection !== null && typeof projection === "object" && "select" in projection) {
      const nested = (projection as { select: Record<string, unknown> }).select;
      output[key] = source[key] === null ? null : selectProjection(source[key], nested);
    }
  }
  return output;
}

function recordedStore(backing: ReturnType<typeof backingRow> | null) {
  let calls = 0;
  let query: unknown;
  const fake = { activeCatalogPointer: { async findUnique(input: unknown) {
    calls++;
    query = input;
    assert.deepEqual(input, expectedQuery);
    return backing === null ? null : selectProjection(backing, expectedQuery.select as unknown as Record<string, unknown>);
  } } };
  return { store: createPrismaCatalogStore(fake as never), calls: () => calls, query: () => query };
}

async function assertUnavailable(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof CatalogUnavailableError);
    assert.equal(error.message, "CATALOG_UNAVAILABLE");
    assert.equal(JSON.stringify(error), "{}");
    return true;
  });
}

test("full exact default query is one selection-faithful lookup with no private-field projection", async () => {
  const backing = backingRow();
  const before = structuredClone(backing);
  const recorder = recordedStore(backing);
  const active = await recorder.store.readActiveCatalog();
  assert.equal(recorder.calls(), 1);
  assert.deepEqual(recorder.query(), expectedQuery);
  assert.deepEqual(backing, before, "repository read must not mutate the backing input row");
  assert.ok(active);
  assert.equal("proofId" in active.validation, false);
  assert.equal("proof" in active.validation, false);
  assert.equal("rawReceiptSealHash" in active.validation, false);
  assert.equal(JSON.stringify(active).includes("unselected-proof-sentinel"), false);
});

test("null pointer maps to null in one lookup", async () => {
  const recorder = recordedStore(null);
  assert.equal(await recorder.store.readActiveCatalog(), null);
  assert.equal(recorder.calls(), 1);
  assert.deepEqual(recorder.query(), expectedQuery);
});

test("actual repository-to-service default legacy path succeeds without second lookup", async () => {
  const recorder = recordedStore(backingRow("legacy-policy"));
  const result = await readPublicCatalog({
    store: recorder.store, expectedFirebaseProjectId: "project",
    huroofReader: { projectId: "project", purpose: "paid-readiness" as const, expectedSelectorVersion: "selector-1", expectedPolicyVersion: "h-policy", async readActiveRelease() { throw new Error("no Huroof source expected"); } },
  });
  assert.deepEqual(result.release, { id: "release-1", rootHash: hash("a") });
  assert.deepEqual(result.sources, { enta: { available: false }, huroof: { available: false } });
  assert.equal(recorder.calls(), 1);
  assert.equal(JSON.stringify(result).includes("unselected-proof-sentinel"), false);
});

test("default exact-R3E repository denies before an eligible matching Huroof reader can run", async () => {
  const backing = backingRow("enta-r3e-private-issuer-v1", true);
  const eligible = eligibleHuroofReader();
  const receipt = backing.validationReceipt as unknown as Record<string, unknown>;
  receipt.huroofCapabilityStateHash = eligible.capabilityStateHash;
  receipt.huroofSelectorAttestation = eligible.selectorAttestationHash;
  const recorder = recordedStore(backing);
  await assertUnavailable(readPublicCatalog({ store: recorder.store, huroofReader: eligible.reader, expectedFirebaseProjectId: "project" }));
  assert.equal(eligible.reads(), 0);
  assert.equal(recorder.calls(), 1);
  assert.equal(JSON.stringify(recorder.query()).includes("proof"), false);
});
