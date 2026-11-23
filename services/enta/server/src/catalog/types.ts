export const HUROOF_SOURCE_NAMESPACE = "huroof.firestore";

export interface ActiveCatalogSourceSnapshot {
  sourceNamespace: string;
  sourceReleaseId: string;
  sourceRootSha256: string;
  snapshotHash: string;
}

export interface CatalogAvailabilityRecord {
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
  validatedAt: Date;
}

export interface CatalogValidationLineage {
  id: string;
  catalogReleaseId: string;
  releaseRootHash: string;
  sealHash: string;
  validatorRef: string;
  policyVersion: string;
  sourceEvidenceManifestHash: string;
  selectorVersion: string;
  huroofProjectId: string | null;
  huroofReleaseId: string | null;
  huroofRootSha256: string | null;
  huroofCapabilityStateHash: string | null;
  huroofSelectorAttestation: string | null;
  /** Optional private transport fields; the default repository deliberately omits them. */
  proofId?: string | null;
  rawReceiptSealHash?: string | null;
  proof?: CatalogValidationProofProjection | null;
}

/** Exact seven-field projection consumed only by the private R3-E correspondence gate. */
export interface CatalogValidationProofProjection {
  id: string;
  catalogReleaseId: string;
  releaseRootHash: string;
  sealHash: string;
  policyVersion: string;
  sourceSummarySha256: string;
  selectorVersion: string;
}

export interface CatalogCategoryRecord {
  categoryKey: string;
  labelAr: string;
  description: string | null;
  editorialDecision: string;
  availability: CatalogAvailabilityRecord[];
}

export interface ActiveCatalogRecord {
  pointerReleaseId: string;
  pointerRootHash: string;
  pointerReceiptId: string;
  releaseSealedAt: Date | null;
  releaseId: string;
  releaseRootHash: string;
  validation: CatalogValidationLineage;
  sourceSnapshots: ActiveCatalogSourceSnapshot[];
  categories: CatalogCategoryRecord[];
}

export interface CatalogStore {
  readActiveCatalog(): Promise<ActiveCatalogRecord | null>;
}

export interface HuroofCategoryReadiness {
  categoryKey: string;
  approvedCount: number;
  uniqueAnswerConceptCount: number;
  playable: { huroof: boolean; categories: boolean; charades: boolean };
}

export interface HuroofSelectorAttestation {
  issuer: "huroof-functions";
  projectId: string;
  deploymentId: string;
  releaseId: string;
  rootSha256: string;
  approvedCount: number;
  categoryInventory: HuroofCategoryReadiness[];
  inventoryHash: string;
  capabilityStateHash: string;
  selectorVersion: string;
  policyVersion: string;
  attestedAt: Date;
}

export interface HuroofReleaseSnapshot {
  projectId: string;
  releaseId: string;
  rootSha256: string;
  approvedCount: number;
  categoryInventory: HuroofCategoryReadiness[];
  inventoryHash: string;
  capabilityStateHash: string;
  capabilityFlags: Record<string, boolean>;
  selectorAttestation?: HuroofSelectorAttestation;
}

export interface HuroofReleaseReader {
  readonly purpose: "legacy-observation" | "paid-readiness";
  readonly projectId: string;
  readonly expectedSelectorVersion: string;
  readonly expectedPolicyVersion: string;
  readActiveRelease(): Promise<HuroofReleaseSnapshot>;
}

export interface PublicCatalogAvailability {
  engine: string;
  mode: string;
  tier: string;
  modality: string;
}

export interface PublicCatalogCategory {
  key: string;
  labelAr: string;
  description?: string;
  availability: PublicCatalogAvailability[];
}

export interface PublicCatalogDto {
  release: { id: string; rootHash: string };
  sources: {
    enta: { available: boolean };
    huroof: { available: boolean; releaseId?: string; rootHash?: string };
  };
  categories: PublicCatalogCategory[];
}
