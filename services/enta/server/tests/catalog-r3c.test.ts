import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { ENTA_CLASSIC_SELECTOR_VERSION, ENTA_CLASSIC_SELECTOR_BUILD_ID, hashEntaClassicSelectionPair, selectEntaClassicTier, type EntaClassicSourceQuestion } from "../src/catalog/selectors";
import { replayStoredEntaAvailability, type StoredEntaAvailability } from "../src/catalog/selector-replay";
import { verifyIndependentEntaEvidence, type EntaEvidenceReleaseBinding } from "../src/catalog/independent-evidence";
import type { EntaReceiptClaim } from "../src/catalog/postgres-evidence-reader";

const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const manifestDomain = Buffer.from("INT4-R3C-MANIFEST-V1\0", "utf8");
const oldEnvironment = new Map<string, string | undefined>();
const ENV_NAMES = ["ENTA_R3C_MANIFEST_SHA256", "ENTA_R3C_TRUST_ANCHOR_PATH", "ENTA_R3C_REVOCATIONS_PATH", "ENTA_R3C_REGISTRY_DIR"];

function candidate(id: string, categoryKey: string, sourceQuestionId: string, points: number): EntaClassicSourceQuestion {
  return {
    questionRevisionId: id, sourceQuestionId, categoryKey, sourceNamespace: "enta.question",
    sourceCategoryId: "source-category", sourceQuestionCategoryId: "source-category",
    categoryEditorialDecision: "APPROVED", questionEditorialDecision: "APPROVED", questionRightsDecision: "CLEARED",
    sourcePoints: points, engine: "ENTA", mode: "CLASSIC", tier: String(points), modality: "classic",
    sourceHasQuestionMedia: false, sourceCategoryHasCoverMedia: false,
  };
}

function completeSupply(categoryKey: string): { rows: StoredEntaAvailability[]; revisions: EntaClassicSourceQuestion[] } {
  const revisions: EntaClassicSourceQuestion[] = [];
  const rows: StoredEntaAvailability[] = [];
  for (const tier of [200, 400, 600]) {
    const pool = Array.from({ length: 4 }, (_, index) => candidate(`revision_${tier}_${index}`, categoryKey, `source_${tier}_${index}`, tier));
    revisions.push(...pool);
    const ids = pool.map((row) => row.questionRevisionId);
    const fresh = selectEntaClassicTier(ids.map((id) => ({
      id,
      categoryKey,
      sourceQuestionId: pool.find((row) => row.questionRevisionId === id)!.sourceQuestionId,
      engine: "ENTA" as const,
      mode: "CLASSIC" as const,
      tier: String(tier),
      modality: "classic" as const,
    })), { categoryKey, tier: String(tier), seed: 13 });
    const repeat = selectEntaClassicTier(pool.map((row) => ({
      id: row.questionRevisionId, categoryKey, sourceQuestionId: row.sourceQuestionId,
      engine: "ENTA" as const, mode: "CLASSIC" as const, tier: String(tier), modality: "classic" as const,
    })), { categoryKey, tier: String(tier), seed: 29, excludeIds: fresh.selectedQuestionRevisionIds });
    rows.push({
      categoryKey, engine: "ENTA", mode: "CLASSIC", tier: String(tier), modality: "classic",
      selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
      selectionManifestHash: hashEntaClassicSelectionPair({ categoryKey, tier: String(tier), fresh, repeat }),
      freshSelectionHash: fresh.selectionHash, repeatSelectionHash: repeat.selectionHash,
      freshSelectionIds: fresh.selectedQuestionRevisionIds, repeatSelectionIds: repeat.selectedQuestionRevisionIds,
      freshSelectionSeed: fresh.seed, repeatSelectionSeed: repeat.seed,
    });
  }
  return { rows, revisions };
}

interface Fixture {
  root: string;
  env: Map<string, string | undefined>;
  binding: EntaEvidenceReleaseBinding;
  claims: EntaReceiptClaim[];
  manifest: Record<string, unknown>;
  manifestBytes: Buffer;
  manifestDigest: string;
  evidenceBytes: Buffer[];
  privateKeys: { editorial: ReturnType<typeof generateKeyPairSync>; rights: ReturnType<typeof generateKeyPairSync> };
  anchor: Record<string, unknown>;
  revocations: Record<string, unknown>;
  setManifest(bytes: Buffer, options?: { wrongRole?: boolean; useCrossProtocolSignature?: boolean }): Promise<void>;
}

async function setupEvidenceFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "int4-r3c-"));
  const registry = path.join(root, "registry");
  await mkdir(registry);
  const now = Date.now();
  const iso = (delta: number) => new Date(now + delta).toISOString();
  const privateKeys = {
    editorial: generateKeyPairSync("ed25519"),
    rights: generateKeyPairSync("ed25519"),
  };
  const binding: EntaEvidenceReleaseBinding = {
    catalogReleaseId: "synthetic_release_1", releaseRootHash: "a".repeat(64), sourceNamespace: "enta.question",
    sourceReleaseId: "synthetic_source_1", sourceRootSha256: "b".repeat(64), snapshotHash: "c".repeat(64),
    selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION, selectorBuildId: ENTA_CLASSIC_SELECTOR_BUILD_ID,
  };
  const evidenceBytes = [Buffer.from("synthetic category editorial evidence"), Buffer.from("synthetic question editorial evidence"), Buffer.from("synthetic rights evidence")];
  const claims: EntaReceiptClaim[] = [
    { receiptId: "receipt_category", evidenceType: "EDITORIAL", sourceNamespace: "canonical.category", sourceKey: "cat_demo", sourceRevision: 1, subjectHash: "d".repeat(64), evidenceHash: sha256(evidenceBytes[0]), decision: "APPROVED" },
    { receiptId: "receipt_question", evidenceType: "EDITORIAL", sourceNamespace: "enta.question", sourceKey: "question_demo", sourceRevision: 1, subjectHash: "e".repeat(64), evidenceHash: sha256(evidenceBytes[1]), decision: "APPROVED" },
    { receiptId: "receipt_question", evidenceType: "RIGHTS", sourceNamespace: "enta.question", sourceKey: "question_demo", sourceRevision: 1, subjectHash: "e".repeat(64), evidenceHash: sha256(evidenceBytes[2]), decision: "CLEARED", rightsHolderRef: "synthetic-holder", licenseRef: "synthetic-license" },
  ];
  for (let i = 0; i < claims.length; i += 1) await writeFile(path.join(registry, claims[i].evidenceHash), evidenceBytes[i], { mode: 0o444 });
  const manifest: Record<string, unknown> = {
    version: "enta-r3c-decision-manifest-v1", issuedAt: iso(-60_000), expiresAt: iso(3_600_000), policyVersion: "policy-v1",
    ...binding,
    decisions: [
      { receiptId: "receipt_category", evidenceType: "EDITORIAL", sourceNamespace: "canonical.category", sourceKey: "cat_demo", sourceRevision: 1, subjectHash: "d".repeat(64), decision: "APPROVED", evidenceDigest: sha256(evidenceBytes[0]), releaseRootHash: binding.releaseRootHash, revoked: false, classification: "CATEGORY_METADATA" },
      { receiptId: "receipt_question", evidenceType: "EDITORIAL", sourceNamespace: "enta.question", sourceKey: "question_demo", sourceRevision: 1, subjectHash: "e".repeat(64), decision: "APPROVED", evidenceDigest: sha256(evidenceBytes[1]), releaseRootHash: binding.releaseRootHash, revoked: false, classification: "CLASSIC" },
      { receiptId: "receipt_question", evidenceType: "RIGHTS", sourceNamespace: "enta.question", sourceKey: "question_demo", sourceRevision: 1, subjectHash: "e".repeat(64), decision: "CLEARED", evidenceDigest: sha256(evidenceBytes[2]), releaseRootHash: binding.releaseRootHash, revoked: false, rightsScope: "QUESTION_CONTENT", rightsHolderRef: "synthetic-holder", licenseRef: "synthetic-license" },
    ],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestDigest = sha256(manifestBytes);
  const anchor: Record<string, unknown> = {
    version: "enta-r3c-trust-anchor-v1", environment: "synthetic",
    keys: [
      { keyId: "editorial-key", role: "EDITORIAL", publicKeyPem: privateKeys.editorial.publicKey.export({ type: "spki", format: "pem" }), sourceNamespaces: ["canonical.category", "enta.question"], policyVersions: ["policy-v1"], notBefore: iso(-3_600_000), notAfter: iso(7_200_000), revokedAt: null },
      { keyId: "rights-key", role: "RIGHTS", publicKeyPem: privateKeys.rights.publicKey.export({ type: "spki", format: "pem" }), sourceNamespaces: ["enta.question"], policyVersions: ["policy-v1"], notBefore: iso(-3_600_000), notAfter: iso(7_200_000), revokedAt: null },
    ],
  };
  const revocations: Record<string, unknown> = { version: "enta-r3c-revocations-v1", issuedAt: iso(-60_000), expiresAt: iso(3_600_000), revokedReceiptIds: [], revokedEvidenceDigests: [] };
  const anchorPath = path.join(root, "anchor.json");
  const revocationsPath = path.join(root, "revocations.json");
  await writeFile(anchorPath, JSON.stringify(anchor), { mode: 0o444 });
  await writeFile(revocationsPath, JSON.stringify(revocations), { mode: 0o444 });
  const env = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  process.env.ENTA_R3C_TRUST_ANCHOR_PATH = anchorPath;
  process.env.ENTA_R3C_REVOCATIONS_PATH = revocationsPath;
  process.env.ENTA_R3C_REGISTRY_DIR = registry;
  process.env.ENTA_R3C_MANIFEST_SHA256 = manifestDigest;
  const setManifest = async (bytes: Buffer, options: { wrongRole?: boolean; useCrossProtocolSignature?: boolean } = {}) => {
    const digest = sha256(bytes);
    process.env.ENTA_R3C_MANIFEST_SHA256 = digest;
    const manifestPath = path.join(registry, `${digest}.manifest`);
    const signaturePath = path.join(registry, `${digest}.sig`);
    await chmod(manifestPath, 0o644).catch(() => undefined);
    await writeFile(manifestPath, bytes, { mode: 0o444 });
    const prefix = options.useCrossProtocolSignature ? Buffer.alloc(0) : manifestDomain;
    const editorial = options.wrongRole ? privateKeys.rights.privateKey : privateKeys.editorial.privateKey;
    const envelope = {
      version: "enta-r3c-signature-envelope-v1", manifestSha256: digest,
      signatures: [
        { keyId: options.wrongRole ? "rights-key" : "editorial-key", signatureBase64: sign(null, Buffer.concat([prefix, bytes]), editorial).toString("base64") },
        { keyId: "rights-key", signatureBase64: sign(null, Buffer.concat([prefix, bytes]), privateKeys.rights.privateKey).toString("base64") },
      ],
    };
    await chmod(signaturePath, 0o644).catch(() => undefined);
    await writeFile(signaturePath, JSON.stringify(envelope), { mode: 0o444 });
  };
  await setManifest(manifestBytes);
  return { root, env, binding, claims, manifest, manifestBytes, manifestDigest, evidenceBytes, privateKeys, anchor, revocations, setManifest };
}

async function cleanupEvidenceFixture(fixture: Fixture): Promise<void> {
  for (const [name, value] of fixture.env) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  await rm(fixture.root, { recursive: true, force: true });
}

test("stored Enta availability replays exact fresh/repeat seeds and full three-tier boards", () => {
  const { rows, revisions } = completeSupply("cat_demo");
  const result = replayStoredEntaAvailability(rows, revisions, ["cat_demo"]);
  assert.equal(result.status, "verified");
  if (result.status === "verified") assert.equal(result.proofs.length, 3);

  const omittedTier = replayStoredEntaAvailability(rows.slice(0, 2), revisions, ["cat_demo"]);
  assert.equal(omittedTier.status, "incomplete");
  const changedStoredIds = rows.map((row, index) => index === 0 ? { ...row, freshSelectionIds: ["forged", row.freshSelectionIds[1]] } : row);
  const mismatchedReplay = replayStoredEntaAvailability(changedStoredIds, revisions, ["cat_demo"]);
  assert.equal(mismatchedReplay.status, "rejected");
  if (mismatchedReplay.status === "rejected") assert.equal(mismatchedReplay.reasonCode, "SELECTOR_STORED_SELECTION_MISMATCH");

  const overlappingPool = [...revisions];
  overlappingPool[4] = { ...overlappingPool[4], sourceQuestionId: overlappingPool[0].sourceQuestionId };
  const overlapping = replayStoredEntaAvailability(rows, overlappingPool, ["cat_demo"]);
  assert.equal(overlapping.status, "rejected");
});

test("signed independent editorial/rights evidence verifies with external role-scoped anchors", async () => {
  const fixture = await setupEvidenceFixture();
  try {
    const verified = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.equal(verified.status, "verified");
    if (verified.status === "verified") {
      assert.equal(verified.manifestSha256, fixture.manifestDigest);
      assert.match(verified.trustGenerationSha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(fixture.claims[1].receiptId, fixture.claims[2].receiptId);
    assert.notEqual(fixture.claims[1].evidenceType, fixture.claims[2].evidenceType);
    const missingCrossTypeDecision = structuredClone(fixture.manifest) as { decisions: Array<Record<string, unknown>> };
    missingCrossTypeDecision.decisions = missingCrossTypeDecision.decisions.filter((decision) => decision.evidenceType !== "RIGHTS");
    await fixture.setManifest(Buffer.from(JSON.stringify(missingCrossTypeDecision)));
    assert.deepEqual(await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims }), {
      status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_RECEIPT_SET_MISMATCH",
    });
    assert.ok(!JSON.stringify(verified).includes(fixture.root), "private report does not return local paths");
  } finally {
    await cleanupEvidenceFixture(fixture);
  }
});

test("external evidence fails closed on missing config, changed bytes, stale binding, and revoked receipts", async () => {
  const fixture = await setupEvidenceFixture();
  try {
    delete process.env.ENTA_R3C_REVOCATIONS_PATH;
    assert.deepEqual(await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims }), {
      status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_MISSING",
    });
    process.env.ENTA_R3C_REVOCATIONS_PATH = path.join(fixture.root, "revocations.json");
    const mismatch = await verifyIndependentEntaEvidence({ binding: { ...fixture.binding, releaseRootHash: "f".repeat(64) }, receiptClaims: fixture.claims });
    assert.deepEqual(mismatch, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" });

    const revocations = { ...fixture.revocations, revokedReceiptIds: ["receipt_question"] };
    await chmod(path.join(fixture.root, "revocations.json"), 0o644);
    await writeFile(path.join(fixture.root, "revocations.json"), JSON.stringify(revocations));
    const revoked = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(revoked, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_REVOKED" });

    await writeFile(path.join(fixture.root, "revocations.json"), JSON.stringify(fixture.revocations));
    const evidenceDigest = fixture.claims[0].evidenceHash;
    await chmod(path.join(fixture.root, "registry", evidenceDigest), 0o644);
    await writeFile(path.join(fixture.root, "registry", evidenceDigest), Buffer.from("changed evidence bytes"));
    const changed = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(changed, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" });

    const pinnedManifestPath = path.join(fixture.root, "registry", `${fixture.manifestDigest}.manifest`);
    await chmod(pinnedManifestPath, 0o644);
    await writeFile(pinnedManifestPath, Buffer.concat([fixture.manifestBytes, Buffer.from(" ", "utf8")]));
    const wrongPinnedBytes = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(wrongPinnedBytes, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" });
  } finally {
    await cleanupEvidenceFixture(fixture);
  }
});

test("strict signed manifest denies expiry, role confusion, duplicate keys, unknown shapes and cross-protocol signatures", async () => {
  const fixture = await setupEvidenceFixture();
  try {
    const expired = { ...fixture.manifest, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const expiredBytes = Buffer.from(JSON.stringify(expired));
    await fixture.setManifest(expiredBytes);
    const expiredResult = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.equal(expiredResult.status, "unavailable");
    if (expiredResult.status === "unavailable") assert.equal(expiredResult.reasonCode, "INDEPENDENT_EVIDENCE_EXPIRED");
    await fixture.setManifest(fixture.manifestBytes);

    const wrongRoleAnchor = structuredClone(fixture.anchor) as { keys: Array<Record<string, unknown>> };
    wrongRoleAnchor.keys[0].sourceNamespaces = ["enta.question"];
    await chmod(path.join(fixture.root, "anchor.json"), 0o644);
    await writeFile(path.join(fixture.root, "anchor.json"), JSON.stringify(wrongRoleAnchor));
    const wrongRole = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(wrongRole, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_POLICY_INVALID" });
    await writeFile(path.join(fixture.root, "anchor.json"), JSON.stringify(fixture.anchor));

    const duplicateKeyMaterial = structuredClone(fixture.anchor) as { keys: Array<Record<string, unknown>> };
    duplicateKeyMaterial.keys[1].publicKeyPem = duplicateKeyMaterial.keys[0].publicKeyPem;
    await writeFile(path.join(fixture.root, "anchor.json"), JSON.stringify(duplicateKeyMaterial));
    const duplicateKey = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(duplicateKey, { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_INVALID" });
    await writeFile(path.join(fixture.root, "anchor.json"), JSON.stringify(fixture.anchor));

    const duplicateText = fixture.manifestBytes.toString("utf8").replace('"version":"enta-r3c-decision-manifest-v1"', '"version":"enta-r3c-decision-manifest-v1","version":"enta-r3c-decision-manifest-v1"');
    const duplicateBytes = Buffer.from(duplicateText);
    await fixture.setManifest(duplicateBytes);
    const duplicate = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(duplicate, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_POLICY_INVALID" });

    await fixture.setManifest(fixture.manifestBytes, { useCrossProtocolSignature: true });
    const crossProtocol = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(crossProtocol, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_SIGNATURE_INVALID" });

    const pathClaim = structuredClone(fixture.manifest) as { decisions: Array<Record<string, unknown>> };
    pathClaim.decisions[0].evidenceDigest = "../../outside";
    const invalidPath = Buffer.from(JSON.stringify(pathClaim));
    await fixture.setManifest(invalidPath);
    const zeroIo = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(zeroIo, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_POLICY_INVALID" });
  } finally {
    await cleanupEvidenceFixture(fixture);
  }
});

test("reparse-point evidence files fail closed when the host supports symlink fixtures", async (t) => {
  const fixture = await setupEvidenceFixture();
  try {
    const digest = fixture.claims[0].evidenceHash;
    const originalPath = path.join(fixture.root, "registry", digest);
    const movedPath = path.join(fixture.root, "registry", `${digest}.real`);
    await chmod(originalPath, 0o644);
    await (await import("node:fs/promises")).rename(originalPath, movedPath);
    try {
      await symlink(movedPath, originalPath, process.platform === "win32" ? "file" : undefined);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) {
        t.skip("host does not permit symlink fixture creation");
        return;
      }
      throw error;
    }
    const denied = await verifyIndependentEntaEvidence({ binding: fixture.binding, receiptClaims: fixture.claims });
    assert.deepEqual(denied, { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" });
  } finally {
    await cleanupEvidenceFixture(fixture);
  }
});
