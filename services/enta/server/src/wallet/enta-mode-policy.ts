import type { EntaMode } from "../gameplay/types";
export const CLASSIC_MODE_POLICY = "enta-mode-classic-v1";
export interface ModeReceiptInput {
  version: 1; projectId: string; identityId: string; mode: EntaMode; operation: "PAID_ENTA_CLASSIC" | "PAID_ENTA_KIDS";
  releaseId: string; rootHash: string; receiptId: string; selectorVersion: string;
  policyVersion: string; targetCohort: string | null; reviewerIdentityId: string; suitabilityManifestHash: string | null;
}
export interface ModeReceiptVerifier { readonly source: "production" | "test-only"; assertEligible(input: ModeReceiptInput): Promise<void> }
/** Separate successor contract. Never widen/cast the frozen CLASSIC input. */
export const productionModeReceiptPolicy: ModeReceiptVerifier = Object.freeze({ source: "production" as const, async assertEligible() { throw new Error("CATALOG_RECEIPT_POLICY_UNAVAILABLE"); } });
