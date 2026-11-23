import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { parseJsonRejectingDuplicateKeys } from "./source-artifact";
import { verifyR3eNativeCustody, type R3eCustodySnapshot } from "./r3e-native-custody";
import type { EntaReceiptClaim } from "./postgres-evidence-reader";

const MANIFEST_DOMAIN = Buffer.from("INT4-R3C-MANIFEST-V1\0", "utf8");
const SHA256 = /^[a-f0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9:_-]{1,96}$/;
const NAMESPACE = /^[A-Za-z0-9._:-]{1,96}$/;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 24 * 1024 * 1024;
const MAX_DECISIONS = 4096;
const MAX_REVOKED_ITEMS = 10000;

export interface EntaEvidenceReleaseBinding {
  catalogReleaseId: string;
  releaseRootHash: string;
  sourceNamespace: "enta.question";
  sourceReleaseId: string;
  sourceRootSha256: string;
  snapshotHash: string;
  selectorVersion: string;
  selectorBuildId: string;
}

export type IndependentEvidenceResult =
  | { status: "verified"; manifestSha256: string; trustGenerationSha256: string; expiresAt: string }
  | { status: "unavailable"; reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_MISSING" | "INDEPENDENT_EVIDENCE_CONFIG_INVALID" | "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" | "INDEPENDENT_EVIDENCE_EXPIRED" }
  | { status: "rejected"; reasonCode: "INDEPENDENT_EVIDENCE_SIGNATURE_INVALID" | "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" | "INDEPENDENT_EVIDENCE_RECEIPT_SET_MISMATCH" | "INDEPENDENT_EVIDENCE_REVOKED" | "INDEPENDENT_EVIDENCE_POLICY_INVALID" };

interface Decision {
  receiptId: string;
  evidenceType: "EDITORIAL" | "RIGHTS";
  sourceNamespace: string;
  sourceKey: string;
  sourceRevision: number;
  subjectHash: string;
  decision: string;
  evidenceDigest: string;
  releaseRootHash: string;
  revoked: boolean;
  classification?: "CATEGORY_METADATA" | "CLASSIC";
  rightsScope?: "QUESTION_CONTENT";
  rightsHolderRef?: string;
  licenseRef?: string;
  allowedReuse?: { releaseRootHashes: string[]; subjectHash: string; expiresAt: string };
}

interface Manifest {
  version: "enta-r3c-decision-manifest-v1";
  issuedAt: string;
  expiresAt: string;
  policyVersion: string;
  catalogReleaseId: string;
  releaseRootHash: string;
  sourceNamespace: "enta.question";
  sourceReleaseId: string;
  sourceRootSha256: string;
  snapshotHash: string;
  selectorVersion: string;
  selectorBuildId: string;
  decisions: Decision[];
}

interface TrustAnchor {
  version: "enta-r3c-trust-anchor-v1";
  environment: "production" | "synthetic";
  keys: Array<{
    keyId: string;
    role: "EDITORIAL" | "RIGHTS";
    publicKeyPem: string;
    sourceNamespaces: string[];
    policyVersions: string[];
    notBefore: string;
    notAfter: string;
    revokedAt: string | null;
  }>;
}

interface SignatureEnvelope {
  version: "enta-r3c-signature-envelope-v1";
  manifestSha256: string;
  signatures: Array<{ keyId: string; signatureBase64: string }>;
}

interface RevocationList {
  version: "enta-r3c-revocations-v1";
  issuedAt: string;
  expiresAt: string;
  revokedReceiptIds: string[];
  revokedEvidenceDigests: string[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readTrustedFile(filePath: string, maxBytes: number, descriptorSha256?: string): Promise<Buffer | undefined> {
  if (!path.isAbsolute(filePath)) return undefined;
  const absolute = path.resolve(filePath);
  let canonical: string;
  let statBefore: Awaited<ReturnType<typeof lstat>>;
  try {
    canonical = await realpath(absolute);
    statBefore = await lstat(absolute);
  } catch {
    return undefined;
  }
  if (!samePath(absolute, canonical) || statBefore.isSymbolicLink() || !statBefore.isFile() || statBefore.size < 1 || statBefore.size > maxBytes) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    handle = await open(absolute, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > maxBytes || opened.size !== statBefore.size) return undefined;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.length !== opened.size ||
        (descriptorSha256 !== undefined && sha256(bytes) !== descriptorSha256)) return undefined;
    return bytes;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function verifiedRegistryRoot(value: string): Promise<string | undefined> {
  if (!path.isAbsolute(value)) return undefined;
  const absolute = path.resolve(value);
  try {
    const stat = await lstat(absolute);
    const canonical = await realpath(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(absolute, canonical)) return undefined;
    return canonical;
  } catch {
    return undefined;
  }
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = parseJsonRejectingDuplicateKeys(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseAnchor(value: Record<string, unknown>): TrustAnchor | undefined {
  if (!exactKeys(value, ["version", "environment", "keys"]) || value.version !== "enta-r3c-trust-anchor-v1" ||
      (value.environment !== "production" && value.environment !== "synthetic") || !Array.isArray(value.keys) || value.keys.length < 2 || value.keys.length > 16) return undefined;
  const keys: TrustAnchor["keys"] = [];
  const fingerprints = new Set<string>();
  for (const raw of value.keys) {
    if (!isRecord(raw) || !exactKeys(raw, ["keyId", "role", "publicKeyPem", "sourceNamespaces", "policyVersions", "notBefore", "notAfter", "revokedAt"]) ||
        typeof raw.keyId !== "string" || !KEY_ID.test(raw.keyId) || (raw.role !== "EDITORIAL" && raw.role !== "RIGHTS") ||
        typeof raw.publicKeyPem !== "string" || raw.publicKeyPem.length > 8192 ||
        !Array.isArray(raw.sourceNamespaces) || raw.sourceNamespaces.length === 0 || raw.sourceNamespaces.length > 8 || !raw.sourceNamespaces.every((item) => typeof item === "string") ||
        !Array.isArray(raw.policyVersions) || raw.policyVersions.length === 0 || raw.policyVersions.length > 16 || !raw.policyVersions.every((item) => typeof item === "string") ||
        !validIso(raw.notBefore) || !validIso(raw.notAfter) || (raw.revokedAt !== null && !validIso(raw.revokedAt))) return undefined;
    try {
      const key = createPublicKey(raw.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") return undefined;
      const fingerprint = sha256(key.export({ type: "spki", format: "der" }));
      if (fingerprints.has(fingerprint)) return undefined;
      fingerprints.add(fingerprint);
    } catch { return undefined; }
    keys.push(raw as TrustAnchor["keys"][number]);
  }
  if (new Set(keys.map((key) => key.keyId)).size !== keys.length ||
      new Set(keys.map((key) => key.role)).size !== 2) return undefined;
  return value as unknown as TrustAnchor;
}

function parseManifest(value: Record<string, unknown>): Manifest | undefined {
  if (!exactKeys(value, ["version", "issuedAt", "expiresAt", "policyVersion", "catalogReleaseId", "releaseRootHash", "sourceNamespace", "sourceReleaseId", "sourceRootSha256", "snapshotHash", "selectorVersion", "selectorBuildId", "decisions"]) ||
      value.version !== "enta-r3c-decision-manifest-v1" || !validIso(value.issuedAt) || !validIso(value.expiresAt) ||
      typeof value.policyVersion !== "string" || !KEY_ID.test(value.policyVersion) || typeof value.catalogReleaseId !== "string" || value.catalogReleaseId.length < 1 || value.catalogReleaseId.length > 160 ||
      !SHA256.test(String(value.releaseRootHash)) || value.sourceNamespace !== "enta.question" ||
      typeof value.sourceReleaseId !== "string" || value.sourceReleaseId.length < 1 || value.sourceReleaseId.length > 160 ||
      !SHA256.test(String(value.sourceRootSha256)) || !SHA256.test(String(value.snapshotHash)) ||
      value.selectorVersion !== "enta-curated-classic-tier-v2" || value.selectorBuildId !== "enta-curated-classic-tier-v2+stored-seed-replay-v1" ||
      !Array.isArray(value.decisions) || value.decisions.length === 0 || value.decisions.length > MAX_DECISIONS) return undefined;
  const decisions: Decision[] = [];
  for (const raw of value.decisions) {
    if (!isRecord(raw)) return undefined;
    const base = ["receiptId", "evidenceType", "sourceNamespace", "sourceKey", "sourceRevision", "subjectHash", "decision", "evidenceDigest", "releaseRootHash", "revoked"];
    const allowed = [...base, "classification", "rightsScope", "rightsHolderRef", "licenseRef", "allowedReuse"];
    if (!Object.keys(raw).every((key) => allowed.includes(key)) || !base.every((key) => Object.hasOwn(raw, key)) ||
        typeof raw.receiptId !== "string" || raw.receiptId.length < 1 || raw.receiptId.length > 160 ||
        (raw.evidenceType !== "EDITORIAL" && raw.evidenceType !== "RIGHTS") || typeof raw.sourceNamespace !== "string" || !NAMESPACE.test(raw.sourceNamespace) ||
        typeof raw.sourceKey !== "string" || raw.sourceKey.length < 1 || raw.sourceKey.length > 200 ||
        !Number.isSafeInteger(raw.sourceRevision) || (raw.sourceRevision as number) < 1 || !SHA256.test(String(raw.subjectHash)) ||
        typeof raw.decision !== "string" || !["APPROVED", "CLEARED"].includes(raw.decision) || !SHA256.test(String(raw.evidenceDigest)) ||
        !SHA256.test(String(raw.releaseRootHash)) || raw.revoked !== false) return undefined;
    if (raw.evidenceType === "EDITORIAL") {
      if (raw.decision !== "APPROVED" || !["CATEGORY_METADATA", "CLASSIC"].includes(String(raw.classification)) ||
          Object.hasOwn(raw, "rightsScope") || Object.hasOwn(raw, "rightsHolderRef") || Object.hasOwn(raw, "licenseRef")) return undefined;
    } else if (raw.decision !== "CLEARED" || raw.rightsScope !== "QUESTION_CONTENT" ||
        typeof raw.rightsHolderRef !== "string" || !raw.rightsHolderRef.trim() || raw.rightsHolderRef.length > 256 ||
        typeof raw.licenseRef !== "string" || !raw.licenseRef.trim() || raw.licenseRef.length > 256 || Object.hasOwn(raw, "classification")) return undefined;
    if (Object.hasOwn(raw, "allowedReuse")) {
      const reuse = raw.allowedReuse;
      if (!isRecord(reuse) || !exactKeys(reuse, ["releaseRootHashes", "subjectHash", "expiresAt"]) || !Array.isArray(reuse.releaseRootHashes) ||
          reuse.releaseRootHashes.length === 0 || reuse.releaseRootHashes.length > 16 || !reuse.releaseRootHashes.every((hash) => typeof hash === "string" && SHA256.test(hash)) ||
          reuse.subjectHash !== raw.subjectHash || !validIso(reuse.expiresAt)) return undefined;
    }
    decisions.push(raw as unknown as Decision);
  }
  const keyFor = (decision: Decision) => `${decision.evidenceType}\0${decision.receiptId}`;
  if (decisions.some((decision, index) => index > 0 && keyFor(decisions[index - 1]) >= keyFor(decision)) ||
      new Set(decisions.map(keyFor)).size !== decisions.length) return undefined;
  return value as unknown as Manifest;
}

function parseEnvelope(value: Record<string, unknown>, manifestDigest: string): SignatureEnvelope | undefined {
  if (!exactKeys(value, ["version", "manifestSha256", "signatures"]) || value.version !== "enta-r3c-signature-envelope-v1" ||
      value.manifestSha256 !== manifestDigest || !Array.isArray(value.signatures) || value.signatures.length < 2 || value.signatures.length > 8) return undefined;
  const signatures: SignatureEnvelope["signatures"] = [];
  for (const raw of value.signatures) {
    if (!isRecord(raw) || !exactKeys(raw, ["keyId", "signatureBase64"])) return undefined;
    if (typeof raw.keyId !== "string" || !KEY_ID.test(raw.keyId) || typeof raw.signatureBase64 !== "string" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.signatureBase64)) return undefined;
    const signature = Buffer.from(raw.signatureBase64, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== raw.signatureBase64) return undefined;
    signatures.push(raw as SignatureEnvelope["signatures"][number]);
  }
  if (new Set(signatures.map((signature) => signature.keyId)).size !== signatures.length) return undefined;
  return value as unknown as SignatureEnvelope;
}

function parseRevocations(value: Record<string, unknown>, now: number): RevocationList | undefined {
  if (!exactKeys(value, ["version", "issuedAt", "expiresAt", "revokedReceiptIds", "revokedEvidenceDigests"]) || value.version !== "enta-r3c-revocations-v1" ||
      !validIso(value.issuedAt) || !validIso(value.expiresAt) || !Array.isArray(value.revokedReceiptIds) || !Array.isArray(value.revokedEvidenceDigests) ||
      value.revokedReceiptIds.length > MAX_REVOKED_ITEMS || value.revokedEvidenceDigests.length > MAX_REVOKED_ITEMS ||
      !value.revokedReceiptIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 160) ||
      !value.revokedEvidenceDigests.every((digest) => typeof digest === "string" && SHA256.test(digest))) return undefined;
  if (Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now || Date.parse(value.issuedAt) >= Date.parse(value.expiresAt)) return undefined;
  return value as unknown as RevocationList;
}

function matchesClaim(decision: Decision, claim: EntaReceiptClaim): boolean {
  return decision.receiptId === claim.receiptId && decision.evidenceType === claim.evidenceType &&
    decision.sourceNamespace === claim.sourceNamespace && decision.sourceKey === claim.sourceKey &&
    decision.sourceRevision === claim.sourceRevision && decision.subjectHash === claim.subjectHash &&
    decision.decision === claim.decision && decision.evidenceDigest === claim.evidenceHash &&
    (claim.evidenceType === "EDITORIAL"
      ? decision.classification === (claim.sourceNamespace === "canonical.category" ? "CATEGORY_METADATA" : "CLASSIC")
      : decision.rightsScope === "QUESTION_CONTENT" && decision.rightsHolderRef === claim.rightsHolderRef && decision.licenseRef === claim.licenseRef);
}

function claimIdentity(claim: Pick<EntaReceiptClaim, "evidenceType" | "receiptId">): string {
  return JSON.stringify([claim.evidenceType, claim.receiptId]);
}

/**
 * Resolves trust only from server-managed environment paths. Callers cannot
 * inject a verifier, public key, path, or manifest override.
 */
export async function verifyIndependentEntaEvidence(input: {
  binding: EntaEvidenceReleaseBinding;
  receiptClaims: readonly EntaReceiptClaim[];
}): Promise<IndependentEvidenceResult> {
  return verifyIndependentEntaEvidenceInternal(input, false);
}

/** Issuer-only variant: every trusted/evidence byte is bound to native openat2 descriptor hashes. */
export async function verifyIndependentEntaEvidenceForIssuer(input: {
  binding: EntaEvidenceReleaseBinding;
  receiptClaims: readonly EntaReceiptClaim[];
}): Promise<IndependentEvidenceResult> {
  return verifyIndependentEntaEvidenceInternal(input, true);
}

function descriptorDigest(snapshot: R3eCustodySnapshot | undefined, filePath: string): string | undefined {
  return snapshot?.fileSha256.get(path.resolve(filePath));
}

function priorDescriptorsMatch(current: R3eCustodySnapshot, earlier: R3eCustodySnapshot, paths: readonly string[]): boolean {
  return paths.every((filePath) => descriptorDigest(current, filePath) === descriptorDigest(earlier, filePath));
}

function sameDescriptorGeneration(left: R3eCustodySnapshot, right: R3eCustodySnapshot, paths: readonly string[]): boolean {
  return left.metadataSha256 === right.metadataSha256 && priorDescriptorsMatch(right, left, paths);
}

async function verifyIndependentEntaEvidenceInternal(input: {
  binding: EntaEvidenceReleaseBinding;
  receiptClaims: readonly EntaReceiptClaim[];
}, requireNativeCustody: boolean): Promise<IndependentEvidenceResult> {
  const manifestDigest = process.env.ENTA_R3C_MANIFEST_SHA256;
  const anchorPath = process.env.ENTA_R3C_TRUST_ANCHOR_PATH;
  const revocationsPath = process.env.ENTA_R3C_REVOCATIONS_PATH;
  const registrySetting = process.env.ENTA_R3C_REGISTRY_DIR;
  if (!manifestDigest || !anchorPath || !revocationsPath || !registrySetting) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_MISSING" };
  if (!SHA256.test(manifestDigest)) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_INVALID" };
  const now = Date.now();
  const registryRoot = await verifiedRegistryRoot(registrySetting);
  if (requireNativeCustody && !registryRoot) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
  let initialCustody: R3eCustodySnapshot | undefined;
  if (requireNativeCustody) {
    const checked = await verifyR3eNativeCustody([anchorPath, revocationsPath]);
    if (checked.status !== "verified") return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
    initialCustody = checked.snapshot;
  }
  const anchorDescriptorDigest = descriptorDigest(initialCustody, anchorPath);
  const revocationDescriptorDigest = descriptorDigest(initialCustody, revocationsPath);
  if (requireNativeCustody && (!anchorDescriptorDigest || !revocationDescriptorDigest)) {
    return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
  }
  const [anchorBytes, revocationsBytes] = await Promise.all([
    readTrustedFile(anchorPath, MAX_CONFIG_BYTES, anchorDescriptorDigest),
    readTrustedFile(revocationsPath, MAX_CONFIG_BYTES, revocationDescriptorDigest),
  ]);
  if (!registryRoot || !anchorBytes || !revocationsBytes) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
  const anchor = parseAnchor(parseObject(anchorBytes) ?? {});
  const revocations = parseRevocations(parseObject(revocationsBytes) ?? {}, now);
  if (!anchor || !revocations || (process.env.NODE_ENV === "production" && anchor.environment !== "production")) {
    return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_INVALID" };
  }
  const manifestPath = path.join(registryRoot, `${manifestDigest}.manifest`);
  const signaturePath = path.join(registryRoot, `${manifestDigest}.sig`);
  const trustPaths = [anchorPath, revocationsPath, manifestPath, signaturePath];
  let trustCustody: R3eCustodySnapshot | undefined;
  if (requireNativeCustody) {
    const checked = await verifyR3eNativeCustody(trustPaths);
    if (checked.status !== "verified" || !initialCustody || !priorDescriptorsMatch(checked.snapshot, initialCustody, [anchorPath, revocationsPath])) {
      return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
    }
    trustCustody = checked.snapshot;
  }
  const manifestDescriptorDigest = descriptorDigest(trustCustody, manifestPath);
  const signatureDescriptorDigest = descriptorDigest(trustCustody, signaturePath);
  if (requireNativeCustody && (!manifestDescriptorDigest || !signatureDescriptorDigest)) {
    return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
  }
  const manifestBytes = await readTrustedFile(manifestPath, MAX_MANIFEST_BYTES, manifestDescriptorDigest);
  const signatureBytes = await readTrustedFile(signaturePath, MAX_CONFIG_BYTES, signatureDescriptorDigest);
  if (!manifestBytes || !signatureBytes) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
  if (sha256(manifestBytes) !== manifestDigest) return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" };
  const manifest = parseManifest(parseObject(manifestBytes) ?? {});
  const envelope = parseEnvelope(parseObject(signatureBytes) ?? {}, manifestDigest);
  if (!manifest || !envelope) return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_POLICY_INVALID" };
  if (Date.parse(manifest.issuedAt) > now || Date.parse(manifest.expiresAt) <= now || Date.parse(manifest.issuedAt) >= Date.parse(manifest.expiresAt)) {
    return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_EXPIRED" };
  }
  const binding = input.binding;
  if (manifest.catalogReleaseId !== binding.catalogReleaseId || manifest.releaseRootHash !== binding.releaseRootHash ||
      manifest.sourceNamespace !== binding.sourceNamespace || manifest.sourceReleaseId !== binding.sourceReleaseId ||
      manifest.sourceRootSha256 !== binding.sourceRootSha256 || manifest.snapshotHash !== binding.snapshotHash ||
      manifest.selectorVersion !== binding.selectorVersion || manifest.selectorBuildId !== binding.selectorBuildId) {
    return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" };
  }
  const claimsByIdentity = new Map(input.receiptClaims.map((claim) => [claimIdentity(claim), claim]));
  const decisionsByIdentity = new Map(manifest.decisions.map((decision) => [claimIdentity(decision), decision]));
  if (claimsByIdentity.size !== input.receiptClaims.length ||
      decisionsByIdentity.size !== manifest.decisions.length ||
      claimsByIdentity.size !== decisionsByIdentity.size ||
      [...claimsByIdentity].some(([identity, claim]) => {
        const decision = decisionsByIdentity.get(identity);
        return !decision || !matchesClaim(decision, claim);
      })) {
    return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_RECEIPT_SET_MISMATCH" };
  }
  const receiptRevoked = new Set(revocations.revokedReceiptIds);
  const evidenceRevoked = new Set(revocations.revokedEvidenceDigests);
  if (manifest.decisions.some((decision) => decision.revoked || receiptRevoked.has(decision.receiptId) || evidenceRevoked.has(decision.evidenceDigest))) {
    return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_REVOKED" };
  }
  const signaturesByRole = new Set<string>();
  const validityCutoffs = [Date.parse(manifest.expiresAt), Date.parse(revocations.expiresAt)];
  const signedBytes = Buffer.concat([MANIFEST_DOMAIN, manifestBytes]);
  for (const signature of envelope.signatures) {
    const anchorKey = anchor.keys.find((key) => key.keyId === signature.keyId);
    if (!anchorKey || anchorKey.revokedAt !== null || Date.parse(anchorKey.notBefore) > now || Date.parse(anchorKey.notAfter) <= now ||
        !anchorKey.sourceNamespaces.includes("enta.question") || !anchorKey.policyVersions.includes(manifest.policyVersion)) {
      return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_EXPIRED" };
    }
    let signatureOk = false;
    try {
      signatureOk = verifySignature(null, signedBytes, createPublicKey(anchorKey.publicKeyPem), Buffer.from(signature.signatureBase64, "base64"));
    } catch { signatureOk = false; }
    if (!signatureOk) return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_SIGNATURE_INVALID" };
    const roleEvidenceType = anchorKey.role;
    const roleClaims = manifest.decisions.filter((decision) => decision.evidenceType === roleEvidenceType);
    if (roleClaims.length === 0 || roleClaims.some((decision) => !anchorKey.sourceNamespaces.includes(decision.sourceNamespace))) {
      return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_POLICY_INVALID" };
    }
    signaturesByRole.add(anchorKey.role);
    validityCutoffs.push(Date.parse(anchorKey.notAfter));
  }
  if (!signaturesByRole.has("EDITORIAL") || !signaturesByRole.has("RIGHTS")) return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_SIGNATURE_INVALID" };
  let totalEvidenceBytes = 0;
  const verifiedEvidenceDigests = new Set<string>();
  const evidencePaths = manifest.decisions.map((decision) => path.join(registryRoot, decision.evidenceDigest));
  const allTrustPaths = [...trustPaths, ...evidencePaths];
  let fullCustodyBefore: R3eCustodySnapshot | undefined;
  if (requireNativeCustody) {
    const checked = await verifyR3eNativeCustody(allTrustPaths);
    if (checked.status !== "verified" || !trustCustody || !priorDescriptorsMatch(checked.snapshot, trustCustody, trustPaths)) {
      return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
    }
    fullCustodyBefore = checked.snapshot;
  }
  for (const decision of manifest.decisions) {
    const expectedRoot = decision.releaseRootHash === binding.releaseRootHash ||
      (decision.allowedReuse?.subjectHash === decision.subjectHash && decision.allowedReuse.releaseRootHashes.includes(binding.releaseRootHash) &&
        Date.parse(decision.allowedReuse.expiresAt) > now);
    if (!expectedRoot) return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" };
    if (decision.releaseRootHash !== binding.releaseRootHash && decision.allowedReuse) {
      validityCutoffs.push(Date.parse(decision.allowedReuse.expiresAt));
    }
    totalEvidenceBytes += 1;
    if (totalEvidenceBytes > MAX_TOTAL_EVIDENCE_BYTES) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_CONFIG_INVALID" };
    const evidencePath = path.join(registryRoot, decision.evidenceDigest);
    const evidenceDescriptorDigest = descriptorDigest(fullCustodyBefore, evidencePath);
    if (requireNativeCustody && !evidenceDescriptorDigest) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
    const evidenceBytes = await readTrustedFile(evidencePath, MAX_EVIDENCE_BYTES, evidenceDescriptorDigest);
    if (!evidenceBytes) return { status: "unavailable", reasonCode: "INDEPENDENT_EVIDENCE_BYTES_UNAVAILABLE" };
    totalEvidenceBytes += evidenceBytes.byteLength;
    if (totalEvidenceBytes > MAX_TOTAL_EVIDENCE_BYTES || sha256(evidenceBytes) !== decision.evidenceDigest) {
      return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" };
    }
    verifiedEvidenceDigests.add(decision.evidenceDigest);
  }
  let finalCustody: R3eCustodySnapshot | undefined;
  if (requireNativeCustody) {
    const checked = await verifyR3eNativeCustody(allTrustPaths);
    if (checked.status !== "verified" || !fullCustodyBefore || !sameDescriptorGeneration(fullCustodyBefore, checked.snapshot, allTrustPaths)) {
      return { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_BINDING_MISMATCH" };
    }
    finalCustody = checked.snapshot;
  }
  const trustGenerationSha256 = sha256(Buffer.from(JSON.stringify({
    version: "enta-r3c-verified-generation-v1",
    custodyMetadataSha256: finalCustody?.metadataSha256,
    manifestSha256: manifestDigest,
    signatureEnvelopeSha256: sha256(signatureBytes),
    anchorSha256: sha256(anchorBytes),
    revocationsSha256: sha256(revocationsBytes),
    evidenceSha256: [...verifiedEvidenceDigests].sort(),
  }), "utf8"));
  const expiresAt = new Date(Math.min(...validityCutoffs)).toISOString();
  return { status: "verified", manifestSha256: manifestDigest, trustGenerationSha256, expiresAt };
}
