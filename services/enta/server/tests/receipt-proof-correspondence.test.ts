import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareReceiptProofLink,
  type ProofLinkProjection,
  type ReceiptLinkProjection,
} from "../src/catalog/receipt-proof-correspondence";

const digest = (char: string): string => char.repeat(64);
const receipt = (): ReceiptLinkProjection => ({
  proofId: "proof-1",
  catalogReleaseId: "release-1",
  releaseRootHash: digest("a"),
  sealHash: digest("b"),
  policyVersion: "policy-1",
  sourceEvidenceManifestHash: digest("c"),
  selectorVersion: "selector-1",
});
const proof = (): ProofLinkProjection => ({
  id: "proof-1",
  catalogReleaseId: "release-1",
  releaseRootHash: digest("a"),
  sealHash: digest("b"),
  policyVersion: "policy-1",
  sourceSummarySha256: digest("c"),
  selectorVersion: "selector-1",
});

type Edge = readonly [keyof ReceiptLinkProjection, keyof ProofLinkProjection, string, string, boolean];
const edges: readonly Edge[] = [
  ["proofId", "id", "PROOF_LINK", "proof-link", false],
  ["catalogReleaseId", "catalogReleaseId", "CATALOG_RELEASE", "catalog-release", false],
  ["releaseRootHash", "releaseRootHash", "RELEASE_ROOT", "release-root", true],
  ["sealHash", "sealHash", "SEAL_HASH", "seal-hash", true],
  ["policyVersion", "policyVersion", "POLICY_VERSION", "policy-version", false],
  ["sourceEvidenceManifestHash", "sourceSummarySha256", "SOURCE_SUMMARY", "source-summary", true],
  ["selectorVersion", "selectorVersion", "SELECTOR_VERSION", "selector-version", false],
];

test("all seven receipt/proof edges match structurally without equating receipt id", () => {
  assert.deepEqual(compareReceiptProofLink(receipt(), proof()), {
    status: "STRUCTURAL_MATCH",
    reason: "INCLUDED_EDGES_EQUAL",
  });
});

test("each of seven edge inequalities returns its exact first-failure reason", () => {
  for (const [receiptField, proofField, reason, , isHash] of edges) {
    const r = receipt();
    const p = proof();
    const different = isHash ? digest("d") : "different-value";
    Object.assign(r, { [receiptField]: different });
    Object.assign(p, { [proofField]: different });
    Object.assign(p, { [proofField]: isHash ? digest("e") : "other-value" });
    assert.deepEqual(compareReceiptProofLink(r, p), {
      status: "MISMATCH",
      reason: `${reason.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}_MISMATCH`,
    });
  }
});

test("missing and null rows have exact deterministic reasons", () => {
  assert.deepEqual(compareReceiptProofLink(undefined, proof()), { status: "UNAVAILABLE", reason: "RECEIPT_ROW_MISSING" });
  assert.deepEqual(compareReceiptProofLink(null, proof()), { status: "UNAVAILABLE", reason: "RECEIPT_ROW_MISSING" });
  assert.deepEqual(compareReceiptProofLink(receipt(), undefined), { status: "UNAVAILABLE", reason: "PROOF_ROW_MISSING" });
  assert.deepEqual(compareReceiptProofLink(receipt(), null), { status: "UNAVAILABLE", reason: "PROOF_ROW_MISSING" });
});

test("all fourteen included values classify missing and null as unavailable", () => {
  for (const [receiptField, proofField, reason, ,] of edges) {
    const rMissing = receipt();
    delete rMissing[receiptField];
    assert.deepEqual(compareReceiptProofLink(rMissing, proof()), { status: "UNAVAILABLE", reason: `${reason}_UNAVAILABLE` });
    const pMissing = proof();
    delete pMissing[proofField];
    assert.deepEqual(compareReceiptProofLink(receipt(), pMissing), { status: "UNAVAILABLE", reason: `${reason}_UNAVAILABLE` });
    assert.deepEqual(compareReceiptProofLink({ ...receipt(), [receiptField]: null }, proof()), { status: "UNAVAILABLE", reason: `${reason}_UNAVAILABLE` });
    assert.deepEqual(compareReceiptProofLink(receipt(), { ...proof(), [proofField]: null }), { status: "UNAVAILABLE", reason: `${reason}_UNAVAILABLE` });
  }
});

test("all fourteen included values classify malformed primitives and hash syntax", () => {
  for (const [receiptField, proofField, reason, , isHash] of edges) {
    const bad = isHash ? digest("A") : "";
    assert.deepEqual(compareReceiptProofLink({ ...receipt(), [receiptField]: bad }, proof()), { status: "MISMATCH", reason: `${reason}_MALFORMED` });
    assert.deepEqual(compareReceiptProofLink(receipt(), { ...proof(), [proofField]: bad }), { status: "MISMATCH", reason: `${reason}_MALFORMED` });
    assert.deepEqual(compareReceiptProofLink({ ...receipt(), [receiptField]: 17 }, proof()), { status: "MISMATCH", reason: `${reason}_MALFORMED` });
    assert.deepEqual(compareReceiptProofLink(receipt(), { ...proof(), [proofField]: 17 }), { status: "MISMATCH", reason: `${reason}_MALFORMED` });
  }
});

test("E1 precedes E2; missing takes precedence within first edge", () => {
  assert.deepEqual(compareReceiptProofLink({ ...receipt(), proofId: null, catalogReleaseId: "other" }, proof()), {
    status: "UNAVAILABLE", reason: "PROOF_LINK_UNAVAILABLE",
  });
  assert.deepEqual(compareReceiptProofLink({ ...receipt(), proofId: "other", catalogReleaseId: "other" }, proof()), {
    status: "MISMATCH", reason: "PROOF_LINK_MISMATCH",
  });
  assert.deepEqual(compareReceiptProofLink({ ...receipt(), proofId: null }, { ...proof(), id: 7 }), {
    status: "UNAVAILABLE", reason: "PROOF_LINK_UNAVAILABLE",
  });
});

test("equal summary digest is distinct from full signed-manifest digest; swapped values fail E3", () => {
  const p = { ...proof(), sourceSummarySha256: digest("c") };
  const r = { ...receipt(), sourceEvidenceManifestHash: digest("c") };
  assert.deepEqual(compareReceiptProofLink(r, { ...p, sourceEvidenceManifestSha256: digest("f") } as ProofLinkProjection), {
    status: "STRUCTURAL_MATCH", reason: "INCLUDED_EDGES_EQUAL",
  });
  assert.deepEqual(compareReceiptProofLink({ ...r, sourceEvidenceManifestHash: digest("f") }, p), {
    status: "MISMATCH", reason: "SOURCE_SUMMARY_MISMATCH",
  });
});

test("projection inputs are not mutated and no input/private fields are echoed", () => {
  const r = Object.freeze({ ...receipt(), id: "receipt-private", validatorRef: "private-validator" });
  const p = Object.freeze({ ...proof(), reportSha256: digest("f"), sourceEvidenceManifestSha256: digest("e") });
  const before = { r: { ...r }, p: { ...p } };
  const result = compareReceiptProofLink(r, p);
  assert.deepEqual({ r: { ...r }, p: { ...p } }, before);
  assert.deepEqual(result, { status: "STRUCTURAL_MATCH", reason: "INCLUDED_EDGES_EQUAL" });
  assert.deepEqual(Object.keys(result).sort(), ["reason", "status"]);
});
