/**
 * Inert proposal for structural receipt/proof correspondence only.
 * Input premise: callers must supply inert own-data projections created by a
 * trusted adapter. This helper does not validate that premise; arbitrary
 * JavaScript objects, accessors, proxies, and hostile property behavior are
 * outside its contract. It is not total over arbitrary JavaScript values.
 * A structural match is not authenticity, approval, eligibility, or gameplay authority.
 * No caller is wired to this helper; no runtime source file is created by this packet.
 */

export interface ReceiptLinkProjection {
  readonly proofId?: unknown;
  readonly catalogReleaseId?: unknown;
  readonly releaseRootHash?: unknown;
  readonly sealHash?: unknown;
  readonly policyVersion?: unknown;
  readonly sourceEvidenceManifestHash?: unknown;
  readonly selectorVersion?: unknown;
}

export interface ProofLinkProjection {
  readonly id?: unknown;
  readonly catalogReleaseId?: unknown;
  readonly releaseRootHash?: unknown;
  readonly sealHash?: unknown;
  readonly policyVersion?: unknown;
  readonly sourceSummarySha256?: unknown;
  readonly selectorVersion?: unknown;
}

export type ReceiptProofReason =
  | "RECEIPT_ROW_MISSING"
  | "PROOF_ROW_MISSING"
  | "PROOF_LINK_UNAVAILABLE"
  | "PROOF_LINK_MALFORMED"
  | "PROOF_LINK_MISMATCH"
  | "CATALOG_RELEASE_UNAVAILABLE"
  | "CATALOG_RELEASE_MALFORMED"
  | "CATALOG_RELEASE_MISMATCH"
  | "RELEASE_ROOT_UNAVAILABLE"
  | "RELEASE_ROOT_MALFORMED"
  | "RELEASE_ROOT_MISMATCH"
  | "SEAL_HASH_UNAVAILABLE"
  | "SEAL_HASH_MALFORMED"
  | "SEAL_HASH_MISMATCH"
  | "POLICY_VERSION_UNAVAILABLE"
  | "POLICY_VERSION_MALFORMED"
  | "POLICY_VERSION_MISMATCH"
  | "SOURCE_SUMMARY_UNAVAILABLE"
  | "SOURCE_SUMMARY_MALFORMED"
  | "SOURCE_SUMMARY_MISMATCH"
  | "SELECTOR_VERSION_UNAVAILABLE"
  | "SELECTOR_VERSION_MALFORMED"
  | "SELECTOR_VERSION_MISMATCH"
  | "INCLUDED_EDGES_EQUAL";

export type ReceiptProofCorrespondence =
  | { readonly status: "STRUCTURAL_MATCH"; readonly reason: "INCLUDED_EDGES_EQUAL" }
  | { readonly status: "UNAVAILABLE"; readonly reason: UnavailableRowReason | UnavailableEdgeReason }
  | { readonly status: "MISMATCH"; readonly reason: MalformedEdgeReason | MismatchEdgeReason };

type UnavailableEdgeReason =
  | "PROOF_LINK_UNAVAILABLE"
  | "CATALOG_RELEASE_UNAVAILABLE"
  | "RELEASE_ROOT_UNAVAILABLE"
  | "SEAL_HASH_UNAVAILABLE"
  | "POLICY_VERSION_UNAVAILABLE"
  | "SOURCE_SUMMARY_UNAVAILABLE"
  | "SELECTOR_VERSION_UNAVAILABLE";

type MalformedEdgeReason =
  | "PROOF_LINK_MALFORMED"
  | "CATALOG_RELEASE_MALFORMED"
  | "RELEASE_ROOT_MALFORMED"
  | "SEAL_HASH_MALFORMED"
  | "POLICY_VERSION_MALFORMED"
  | "SOURCE_SUMMARY_MALFORMED"
  | "SELECTOR_VERSION_MALFORMED";

type MismatchEdgeReason =
  | "PROOF_LINK_MISMATCH"
  | "CATALOG_RELEASE_MISMATCH"
  | "RELEASE_ROOT_MISMATCH"
  | "SEAL_HASH_MISMATCH"
  | "POLICY_VERSION_MISMATCH"
  | "SOURCE_SUMMARY_MISMATCH"
  | "SELECTOR_VERSION_MISMATCH";

type UnavailableRowReason = "RECEIPT_ROW_MISSING" | "PROOF_ROW_MISSING";
type EdgeReasons = {
  readonly unavailable: UnavailableEdgeReason;
  readonly malformed: MalformedEdgeReason;
  readonly mismatch: MismatchEdgeReason;
};

type ValueKind = "nonempty-text" | "lowercase-sha256";

const lowercaseSha256 = /^[0-9a-f]{64}$/;

function isMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

function isMalformed(value: unknown, kind: ValueKind): boolean {
  if (typeof value !== "string" || value.length === 0) return true;
  if (kind === "lowercase-sha256") return !lowercaseSha256.test(value);
  return false;
}

function compareEdge(
  left: unknown,
  right: unknown,
  kind: ValueKind,
  reasons: EdgeReasons,
): ReceiptProofCorrespondence | undefined {
  if (isMissing(left) || isMissing(right)) {
    return { status: "UNAVAILABLE", reason: reasons.unavailable };
  }
  if (isMalformed(left, kind) || isMalformed(right, kind)) {
    return { status: "MISMATCH", reason: reasons.malformed };
  }
  if (left !== right) {
    return { status: "MISMATCH", reason: reasons.mismatch };
  }
  return undefined;
}

/**
 * Compare only E1-E4. Fields omitted from these transport projections remain deferred.
 * Under the inert own-data input premise above, this performs no caller code
 * and has deterministic short-circuit outcomes. It does not defend against
 * getters or proxies and must not be used as an arbitrary-object sanitizer.
 * Required null/undefined values are unavailable; malformed present values and unequal
 * edges mismatch. Checks short-circuit in the documented E1, E2 tuple, E3, E4 order.
 */
export function compareReceiptProofLink(
  receipt: Readonly<ReceiptLinkProjection> | null | undefined,
  proof: Readonly<ProofLinkProjection> | null | undefined,
): ReceiptProofCorrespondence {
  if (receipt === null || receipt === undefined) return { status: "UNAVAILABLE", reason: "RECEIPT_ROW_MISSING" };
  if (proof === null || proof === undefined) return { status: "UNAVAILABLE", reason: "PROOF_ROW_MISSING" };

  let result = compareEdge(receipt.proofId, proof.id, "nonempty-text", {
    unavailable: "PROOF_LINK_UNAVAILABLE", malformed: "PROOF_LINK_MALFORMED", mismatch: "PROOF_LINK_MISMATCH",
  });
  if (result) return result;

  result = compareEdge(receipt.catalogReleaseId, proof.catalogReleaseId, "nonempty-text", {
    unavailable: "CATALOG_RELEASE_UNAVAILABLE", malformed: "CATALOG_RELEASE_MALFORMED", mismatch: "CATALOG_RELEASE_MISMATCH",
  });
  if (result) return result;
  result = compareEdge(receipt.releaseRootHash, proof.releaseRootHash, "lowercase-sha256", {
    unavailable: "RELEASE_ROOT_UNAVAILABLE", malformed: "RELEASE_ROOT_MALFORMED", mismatch: "RELEASE_ROOT_MISMATCH",
  });
  if (result) return result;
  result = compareEdge(receipt.sealHash, proof.sealHash, "lowercase-sha256", {
    unavailable: "SEAL_HASH_UNAVAILABLE", malformed: "SEAL_HASH_MALFORMED", mismatch: "SEAL_HASH_MISMATCH",
  });
  if (result) return result;
  result = compareEdge(receipt.policyVersion, proof.policyVersion, "nonempty-text", {
    unavailable: "POLICY_VERSION_UNAVAILABLE", malformed: "POLICY_VERSION_MALFORMED", mismatch: "POLICY_VERSION_MISMATCH",
  });
  if (result) return result;

  result = compareEdge(receipt.sourceEvidenceManifestHash, proof.sourceSummarySha256, "lowercase-sha256", {
    unavailable: "SOURCE_SUMMARY_UNAVAILABLE", malformed: "SOURCE_SUMMARY_MALFORMED", mismatch: "SOURCE_SUMMARY_MISMATCH",
  });
  if (result) return result;
  result = compareEdge(receipt.selectorVersion, proof.selectorVersion, "nonempty-text", {
    unavailable: "SELECTOR_VERSION_UNAVAILABLE", malformed: "SELECTOR_VERSION_MALFORMED", mismatch: "SELECTOR_VERSION_MISMATCH",
  });
  if (result) return result;

  return { status: "STRUCTURAL_MATCH", reason: "INCLUDED_EDGES_EQUAL" };
}

