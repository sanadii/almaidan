import { huroofCapabilityHash as capabilityHash, huroofInventoryHash, huroofSelectorAttestationHash as attestationHash, sha256Text } from "./attestation";
import { ENTA_CLASSIC_SELECTOR_VERSION } from "./selectors";
import { HUROOF_SOURCE_NAMESPACE, type CatalogAvailabilityRecord, type CatalogStore, type HuroofReleaseReader, type HuroofSelectorAttestation, type PublicCatalogAvailability, type PublicCatalogDto } from "./types";
import { compareReceiptProofLink } from "./receipt-proof-correspondence";

// Kept available to private validation tooling; it is not called by or mounted
// through the public catalog route.

const SHA256 = /^[a-f0-9]{64}$/;
const CATEGORY_KEY = /^[A-Za-z0-9:_-]{1,128}$/;
const PUBLIC_ENGINES = new Set(["HUROOF", "ENTA"]);
const ENTA_TIERS = new Set(["200", "400", "600"]);

export class CatalogUnavailableError extends Error {
  constructor() {
    super("CATALOG_UNAVAILABLE");
  }
}

function sha256(value: string): string {
  return sha256Text(value);
}

function validHash(value: string | null | undefined): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function hashSelectionIds(ids: readonly string[]): string {
  return sha256(ids.join(","));
}

function manifestHash(entry: CatalogAvailabilityRecord, categoryKey: string): string {
  return sha256([
    entry.selectorVersion,
    categoryKey,
    entry.tier,
    entry.modality,
    String(entry.freshSelectionSeed),
    entry.freshSelectionIds.join(","),
    entry.freshSelectionHash,
    String(entry.repeatSelectionSeed),
    entry.repeatSelectionIds.join(","),
    entry.repeatSelectionHash,
  ].join("\n"));
}

function verifiedHuroofAttestation(input: {
  current: Awaited<ReturnType<HuroofReleaseReader["readActiveRelease"]>>;
  expectedProjectId: string;
  expectedSelectorVersion: string;
  expectedPolicyVersion: string;
  validation: {
    projectId: string | null;
    releaseId: string | null;
    rootSha256: string | null;
    capabilityStateHash: string | null;
    attestationHash: string | null;
  };
  saved: { sourceReleaseId: string; sourceRootSha256: string };
}): HuroofSelectorAttestation | undefined {
  const { current, expectedProjectId, expectedSelectorVersion, expectedPolicyVersion, validation, saved } = input;
  const attestation = current.selectorAttestation;
  if (!attestation || attestation.issuer !== "huroof-functions" || !attestation.deploymentId.trim() ||
      current.projectId !== expectedProjectId || attestation.projectId !== expectedProjectId ||
      current.releaseId !== saved.sourceReleaseId || current.rootSha256 !== saved.sourceRootSha256 ||
      attestation.releaseId !== current.releaseId || attestation.rootSha256 !== current.rootSha256 ||
      !validHash(current.rootSha256) || !validHash(current.inventoryHash) || !validHash(current.capabilityStateHash) ||
      !validHash(attestation.inventoryHash) || !validHash(attestation.capabilityStateHash) ||
      current.inventoryHash !== huroofInventoryHash(current.categoryInventory) ||
      attestation.inventoryHash !== current.inventoryHash ||
      current.capabilityStateHash !== capabilityHash(current.capabilityFlags) ||
      attestation.capabilityStateHash !== current.capabilityStateHash ||
      attestation.approvedCount !== current.approvedCount || !Number.isSafeInteger(current.approvedCount) || current.approvedCount <= 0 ||
      current.categoryInventory.reduce((sum, category) => sum + category.approvedCount, 0) !== current.approvedCount ||
      current.categoryInventory.some((category) => !Number.isSafeInteger(category.approvedCount) || category.approvedCount <= 0 ||
        !Number.isSafeInteger(category.uniqueAnswerConceptCount) || category.uniqueAnswerConceptCount < 0 ||
        !CATEGORY_KEY.test(category.categoryKey) || ![category.playable.huroof, category.playable.categories, category.playable.charades].every((value) => typeof value === "boolean")) ||
      !Number.isFinite(attestation.attestedAt.getTime()) ||
      attestation.selectorVersion !== expectedSelectorVersion || attestation.policyVersion !== expectedPolicyVersion ||
      validation.projectId !== expectedProjectId || validation.releaseId !== current.releaseId || validation.rootSha256 !== current.rootSha256 ||
      validation.capabilityStateHash !== current.capabilityStateHash || validation.attestationHash !== attestationHash(attestation)) {
    return undefined;
  }
  return attestation;
}

function validEntaAvailability(entry: CatalogAvailabilityRecord, categoryKey: string): boolean {
  const ids = [...entry.freshSelectionIds, ...entry.repeatSelectionIds];
  return entry.engine === "ENTA" && entry.mode === "CLASSIC" && entry.modality === "classic" &&
    ENTA_TIERS.has(entry.tier) && entry.selectorVersion === ENTA_CLASSIC_SELECTOR_VERSION &&
    entry.freshSelectionIds.length === 2 && entry.repeatSelectionIds.length === 2 &&
    new Set(ids).size === 4 && ids.every((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id)) &&
    entry.freshSelectionHash === hashSelectionIds(entry.freshSelectionIds) &&
    entry.repeatSelectionHash === hashSelectionIds(entry.repeatSelectionIds) &&
    entry.selectionManifestHash === manifestHash(entry, categoryKey) &&
    validHash(entry.selectionManifestHash) && validHash(entry.freshSelectionHash) && validHash(entry.repeatSelectionHash) &&
    Number.isSafeInteger(entry.freshSelectionSeed) && Number.isSafeInteger(entry.repeatSelectionSeed) &&
    entry.validatedAt instanceof Date && !Number.isNaN(entry.validatedAt.getTime());
}

export async function readPublicCatalog(input: {
  store: CatalogStore;
  huroofReader: HuroofReleaseReader;
  expectedFirebaseProjectId: string;
}): Promise<PublicCatalogDto> {
  const active = await input.store.readActiveCatalog();
  if (!active || active.pointerReleaseId !== active.releaseId || active.pointerRootHash !== active.releaseRootHash ||
      active.pointerReceiptId !== active.validation.id || active.validation.catalogReleaseId !== active.releaseId ||
      active.validation.releaseRootHash !== active.releaseRootHash || active.releaseSealedAt === null ||
      !SHA256.test(active.releaseRootHash) || !validHash(active.validation.sealHash) ||
      !validHash(active.validation.sourceEvidenceManifestHash) || !active.validation.validatorRef.trim() ||
      !active.validation.policyVersion.trim() || !active.validation.selectorVersion.trim()) {
    throw new CatalogUnavailableError();
  }

  if (active.validation.policyVersion === "enta-r3e-private-issuer-v1") {
    const validation = active.validation;
    if (validation.rawReceiptSealHash === null || validation.rawReceiptSealHash === undefined ||
        validation.rawReceiptSealHash !== validation.sealHash) {
      throw new CatalogUnavailableError();
    }
    const receiptProjection = {
      proofId: validation.proofId,
      catalogReleaseId: validation.catalogReleaseId,
      releaseRootHash: validation.releaseRootHash,
      sealHash: validation.rawReceiptSealHash,
      policyVersion: validation.policyVersion,
      sourceEvidenceManifestHash: validation.sourceEvidenceManifestHash,
      selectorVersion: validation.selectorVersion,
    };
    const proof = validation.proof;
    const proofProjection = proof === null || proof === undefined ? proof : {
      id: proof.id,
      catalogReleaseId: proof.catalogReleaseId,
      releaseRootHash: proof.releaseRootHash,
      sealHash: proof.sealHash,
      policyVersion: proof.policyVersion,
      sourceSummarySha256: proof.sourceSummarySha256,
      selectorVersion: proof.selectorVersion,
    };
    if (compareReceiptProofLink(receiptProjection, proofProjection).status !== "STRUCTURAL_MATCH") {
      throw new CatalogUnavailableError();
    }
  }

  const huroofSnapshots = active.sourceSnapshots.filter((snapshot) => snapshot.sourceNamespace === HUROOF_SOURCE_NAMESPACE);
  let verifiedHuroof: HuroofSelectorAttestation | undefined;
  if (huroofSnapshots.length === 1 && input.huroofReader.purpose === "paid-readiness" &&
      input.huroofReader.projectId === input.expectedFirebaseProjectId) {
    try {
      const current = await input.huroofReader.readActiveRelease();
      verifiedHuroof = verifiedHuroofAttestation({
        current,
        expectedProjectId: input.expectedFirebaseProjectId,
        expectedSelectorVersion: input.huroofReader.expectedSelectorVersion,
        expectedPolicyVersion: input.huroofReader.expectedPolicyVersion,
        validation: {
          projectId: active.validation.huroofProjectId,
          releaseId: active.validation.huroofReleaseId,
          rootSha256: active.validation.huroofRootSha256,
          capabilityStateHash: active.validation.huroofCapabilityStateHash,
          attestationHash: active.validation.huroofSelectorAttestation,
        },
        saved: huroofSnapshots[0],
      });
    } catch {
      // Huroof availability stays closed until its current trusted attestation is independently read.
    }
  }

  const categories: PublicCatalogDto["categories"] = [];
  let entaAvailable = false;
  let huroofAvailable = false;
  for (const row of active.categories) {
    if (!CATEGORY_KEY.test(row.categoryKey) || !row.labelAr.trim() || row.editorialDecision !== "APPROVED") continue;
    const availabilityByKey = new Map<string, PublicCatalogAvailability>();
    for (const entry of row.availability) {
      if (!PUBLIC_ENGINES.has(entry.engine)) continue;
      if (entry.engine === "ENTA") {
        if (!validEntaAvailability(entry, row.categoryKey)) continue;
        entaAvailable = true;
      } else {
        if (!verifiedHuroof || entry.selectorVersion !== verifiedHuroof.selectorVersion ||
            !verifiedHuroof.categoryInventory.some((category) => category.categoryKey === row.categoryKey && category.playable[entry.mode as keyof typeof category.playable] === true)) continue;
        huroofAvailable = true;
      }
      const key = `${entry.engine}\u0000${entry.mode}\u0000${entry.tier}\u0000${entry.modality}`;
      availabilityByKey.set(key, { engine: entry.engine, mode: entry.mode, tier: entry.tier, modality: entry.modality });
    }
    categories.push({
      key: row.categoryKey,
      labelAr: row.labelAr,
      ...(row.description ? { description: row.description } : {}),
      availability: [...availabilityByKey.values()].sort((a, b) =>
        `${a.engine}:${a.mode}:${a.tier}:${a.modality}`.localeCompare(`${b.engine}:${b.mode}:${b.tier}:${b.modality}`)),
    });
  }

  return {
    release: { id: active.releaseId, rootHash: active.releaseRootHash },
    sources: {
      enta: { available: entaAvailable },
      huroof: verifiedHuroof && huroofAvailable
        ? { available: true, releaseId: verifiedHuroof.releaseId, rootHash: verifiedHuroof.rootSha256 }
        : { available: false },
    },
    categories: categories.sort((a, b) => a.key.localeCompare(b.key)),
  };
}
