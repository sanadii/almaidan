import type { ActiveCatalogRecord, CatalogValidationProofProjection } from './types';
export interface ProofSupplyReceipt {
 readonly pointerReleaseId:unknown; readonly pointerRootHash:unknown; readonly pointerReceiptId:unknown;
 readonly receiptId:unknown; readonly receiptReleaseId:unknown; readonly receiptRootHash:unknown;
 readonly receiptRawSealHash:unknown; readonly receiptProofId:unknown; readonly receiptPolicyVersion:unknown;
 readonly receiptSourceEvidenceManifestHash:unknown; readonly receiptSelectorVersion:unknown; readonly proof:unknown;
}
export interface PersistedProof { readonly id:unknown;readonly catalogReleaseId:unknown;readonly releaseRootHash:unknown;readonly sealHash:unknown;readonly policyVersion:unknown;readonly sourceSummarySha256:unknown;readonly selectorVersion:unknown; }
/** Nonpublic persisted lifecycle controls, joined to this exact immutable proof. */
export interface PersistedLifecycleBinding {
 readonly proofId:string; readonly policyVersion:string; readonly selectorVersion:string;
 readonly sourceGeneration:string; readonly trustGeneration:string; readonly revocationEpoch:string;
 readonly buildIdentity:string; readonly authorityContextHash:string; readonly validatedAt:number; readonly expiresAt:number;
}
/** Authenticated lifecycle evidence must be supplied by an admitted authority. */
export interface LifecycleEvidence extends PersistedLifecycleBinding {
 readonly authorityVersion:1; readonly decisionId:string; readonly observedAt:number;
 readonly validUntil:number; readonly maxTransactionAgeMs:number; readonly revoked:boolean;
}
export interface ProofSupplySnapshot { readonly receipts:readonly ProofSupplyReceipt[];readonly lifecycleBinding:PersistedLifecycleBinding|null;readonly lifecycle:LifecycleEvidence|null; }
/** Structured result from a separately admitted policy authority. There is no
 * default/structural policy allowlist here: the authority must authenticate
 * that this exact policy and lifecycle tuple are eligible for production. */
export interface ProductionPolicyAdmission {
 readonly classification:'PRODUCTION_POLICY'; readonly policyVersion:string;
 readonly selectorVersion:string; readonly proofId:string; readonly decisionId:string;
 readonly sourceGeneration:string; readonly trustGeneration:string; readonly revocationEpoch:string;
 readonly buildIdentity:string; readonly authorityContextHash:string; readonly validUntil:number;
}
export interface ProductionPolicyApplicabilityAuthority {
 /** Must authenticate support and applicability; unknown, synthetic or missing
  * production policy decisions return null. No caller/request data is accepted. */
 admit(input:Readonly<{proof:PersistedProof;binding:PersistedLifecycleBinding;lifecycle:LifecycleEvidence}>):Promise<ProductionPolicyAdmission|null>;
}
export interface ReadOnlyRepeatableReadTransaction { readActiveCatalog():Promise<ActiveCatalogRecord|null>;readProofSupply():Promise<ProofSupplySnapshot>; }
export interface SameConnectionSnapshotPort { withReadOnlyRepeatableRead<T>(work:(transaction:ReadOnlyRepeatableReadTransaction)=>Promise<T>):Promise<T>; }
export interface ProofSupplyOutput { readonly receipt:Readonly<{proofId:string;catalogReleaseId:string;releaseRootHash:string;sealHash:string;policyVersion:string;sourceEvidenceManifestHash:string;selectorVersion:string}>;readonly proof:Readonly<CatalogValidationProofProjection>; }
export type CoarseTelemetry=(event:Readonly<{operation:'catalog_proof_supply';outcome:'available'|'unavailable';durationBucket:'lt10ms'|'lt100ms'|'lt1s'|'gte1s'}>)=>void;
