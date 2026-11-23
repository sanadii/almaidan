import assert from "node:assert/strict";
import { test } from "node:test";
import { compareReceiptProofLink } from "../src/catalog/receipt-proof-correspondence";

const digest = (char: string): string => char.repeat(64);

const fullRows = () => ({
  receipt: {
    id: "r3e-receipt:distinct", catalogReleaseId: "release-1", releaseRootHash: digest("a"), sealHash: digest("b"),
    proofId: "proof-1" as string | null, validatorRef: "session-user-private", policyVersion: "policy-1",
    sourceEvidenceManifestHash: digest("c"), selectorVersion: "selector-1",
    huroofProjectId: null, huroofReleaseId: null, huroofRootSha256: null,
    huroofCapabilityStateHash: null, huroofSelectorAttestation: null, issuedAt: "2026-10-23T00:00:00.000Z",
  },
  proof: {
    id: "proof-1", catalogReleaseId: "release-1", releaseRootHash: digest("a"), sealHash: digest("b"), policyVersion: "policy-1",
    canonicalReportBytes: "private-report-bytes", reportSha256: digest("d"), sourceArtifactSha256: digest("e"),
    sourceSnapshotHash: digest("f"), sourceEvidenceManifestSha256: digest("9"), sourceEvidenceGenerationSha256: digest("8"),
    sourceSummarySha256: digest("c"), issuerTrustManifestSha256: digest("7"), selectorVersion: "selector-1",
    selectorBuildId: "private-selector-build", executableBuildSha256: digest("6"), databaseHelpersSha256: digest("5"),
    issuerTrustGenerationSha256: digest("4"), validatedAt: "2026-10-22T00:00:00.000Z", expiresAt: "2027-10-22T00:00:00.000Z",
    createdAt: "2026-10-22T00:00:00.000Z",
  },
});

type RawRows = ReturnType<typeof fullRows>;
const projectAndRoundTrip = (rows: RawRows) => JSON.parse(JSON.stringify({
  receipt: {
    proofId: rows.receipt.proofId, catalogReleaseId: rows.receipt.catalogReleaseId, releaseRootHash: rows.receipt.releaseRootHash,
    sealHash: rows.receipt.sealHash, policyVersion: rows.receipt.policyVersion,
    sourceEvidenceManifestHash: rows.receipt.sourceEvidenceManifestHash, selectorVersion: rows.receipt.selectorVersion,
  },
  proof: {
    id: rows.proof.id, catalogReleaseId: rows.proof.catalogReleaseId, releaseRootHash: rows.proof.releaseRootHash,
    sealHash: rows.proof.sealHash, policyVersion: rows.proof.policyVersion,
    sourceSummarySha256: rows.proof.sourceSummarySha256, selectorVersion: rows.proof.selectorVersion,
  },
}));

test("full raw rows project through JSON transport to structural-only result", () => {
  const rows = fullRows();
  const before = structuredClone(rows);
  const transport = projectAndRoundTrip(rows);
  const result = compareReceiptProofLink(transport.receipt, transport.proof);
  assert.deepEqual(result, { status: "STRUCTURAL_MATCH", reason: "INCLUDED_EDGES_EQUAL" });
  assert.deepEqual(Object.keys(result).sort(), ["reason", "status"]);
  assert.deepEqual(rows, before);
  assert.equal("validatorRef" in transport.receipt, false);
  assert.equal("sourceEvidenceManifestSha256" in transport.proof, false);
  assert.equal("canonicalReportBytes" in transport.proof, false);
});

test("mixed release tuple does not produce a structural match", () => {
  const rows = fullRows();
  rows.proof.catalogReleaseId = "other-release";
  const transport = projectAndRoundTrip(rows);
  assert.deepEqual(compareReceiptProofLink(transport.receipt, transport.proof), {
    status: "MISMATCH", reason: "CATALOG_RELEASE_MISMATCH",
  });
});

test("nullable legacy proofId remains unavailable without fallback", () => {
  const rows = fullRows();
  rows.receipt.proofId = null;
  const transport = projectAndRoundTrip(rows);
  assert.deepEqual(compareReceiptProofLink(transport.receipt, transport.proof), {
    status: "UNAVAILABLE", reason: "PROOF_LINK_UNAVAILABLE",
  });
});

test("serialized result contains no authorization-bearing or private fields", () => {
  const transport = projectAndRoundTrip(fullRows());
  const result = compareReceiptProofLink(transport.receipt, transport.proof);
  assert.equal(JSON.stringify(result), JSON.stringify({ status: "STRUCTURAL_MATCH", reason: "INCLUDED_EDGES_EQUAL" }));
  assert.doesNotMatch(JSON.stringify(result), /approved|verified|playable|admission|validator|trust|manifest/i);
});


