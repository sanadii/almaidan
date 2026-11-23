export interface StoredArtifact {
  id: string; hash: string; byteLength: number; mediaType: string; serialization: string;
  provenanceHash: string; raw: Uint8Array; provenance: Uint8Array;
}
export interface StoredSnapshot {
  namespace: string; projectId: string; profileScope: string; pointerVersion: string;
  profileSourceId: string; profileRevision: string; profile: StoredArtifact;
  releaseId: string; releaseRoot: string; receiptId: string; catalogId: string;
  catalogRoot: string; sealHash: string; snapshot: StoredArtifact;
}
export type SnapshotDocument = { path: string; data: Record<string, unknown> };
export interface ParsedSnapshot { binding: StoredSnapshot; categories: Map<string, Record<string, unknown>>; questions: Map<string, Record<string, unknown>>; inventory: Map<string, number> }

/** Validated external observation; it is not a new issuer or SQL signature proof. */
export interface EvidenceSummary {evidenceVersion:string;evidenceId:string;evidenceHash:string;issuerId:string;keyId:string;trustRootId:string;policyId:string;policyRevision:string;policyHash:string;validatedAt:number;validUntil:number;subjectHash:string}
