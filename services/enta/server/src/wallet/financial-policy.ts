export interface ReceiptPolicyInput {
  projectId: string;
  identityId: string;
  releaseId: string;
  rootHash: string;
  receiptId: string;
  policyVersion: string;
  selectorVersion: string;
  mode: "CLASSIC";
}

export interface ReceiptPolicyVerifier {
  readonly source: "production-closed" | "test-only";
  assertEligible(input: ReceiptPolicyInput): Promise<void>;
}

/**
 * No R3-E policy version is approved. This is deliberately the only production
 * verifier currently exported: it rejects every start until a separately
 * reviewed R3-E implementation replaces it.
 */
export const productionReceiptPolicy: ReceiptPolicyVerifier = Object.freeze({
  source: "production-closed",
  async assertEligible() {
    throw new Error("CATALOG_RECEIPT_POLICY_UNAVAILABLE");
  },
});

