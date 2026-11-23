import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { parseJsonRejectingDuplicateKeys } from "./source-artifact";
import type { EntaEvidenceReleaseBinding } from "./independent-evidence";
import { isSha256, type R3eRuntimeIdentity } from "./r3e-runtime-identity";
import { verifyR3eNativeCustody } from "./r3e-native-custody";

export const ENTA_R3E_ISSUER_POLICY = "enta-r3e-private-issuer-v1";
const DOMAIN = Buffer.from("INT4-R3E-ISSUER-MANIFEST-V1\0", "utf8");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const KEY_ID = /^[A-Za-z0-9:_-]{1,96}$/;

export type R3eIssuerTrustResult =
  | { status: "verified"; manifestSha256: string; generationSha256: string; sourceEvidenceGenerationSha256: string; expiresAt: string }
  | { status: "unavailable"; reasonCode: "R3E_TRUST_CONFIG_MISSING" | "R3E_TRUST_CONFIG_INVALID" | "R3E_TRUST_BYTES_UNAVAILABLE" | "R3E_TRUST_EXPIRED" | "R3E_TRUST_CUSTODY_UNAVAILABLE" }
  | { status: "rejected"; reasonCode: "R3E_TRUST_SIGNATURE_INVALID" | "R3E_TRUST_BINDING_MISMATCH" | "R3E_TRUST_REVOKED" | "R3E_TRUST_POLICY_INVALID" };

export interface R3eIssuerManifestBinding extends EntaEvidenceReleaseBinding {
  sourceBytesSha256: string;
}

export function r3eIssuerTrustPreflight(): Extract<R3eIssuerTrustResult, { status: "unavailable" }> {
  const manifestDigest = process.env.ENTA_R3E_MANIFEST_SHA256;
  const anchorPath = process.env.ENTA_R3E_TRUST_ANCHOR_PATH;
  const revocationsPath = process.env.ENTA_R3E_REVOCATIONS_PATH;
  const registrySetting = process.env.ENTA_R3E_REGISTRY_DIR;
  if (!manifestDigest || !anchorPath || !revocationsPath || !registrySetting) return { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_MISSING" };
  if (!isSha256(manifestDigest) || !path.isAbsolute(anchorPath) || !path.isAbsolute(revocationsPath) || !path.isAbsolute(registrySetting)) {
    return { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_INVALID" };
  }
  return { status: "unavailable", reasonCode: "R3E_TRUST_CUSTODY_UNAVAILABLE" };
}

interface IssuerManifest {
  version: "enta-r3e-issuer-manifest-v1";
  issuedAt: string;
  expiresAt: string;
  policyVersion: typeof ENTA_R3E_ISSUER_POLICY;
  catalogReleaseId: string;
  releaseRootHash: string;
  sourceNamespace: "enta.question";
  sourceReleaseId: string;
  sourceRootSha256: string;
  sourceBytesSha256: string;
  snapshotHash: string;
  selectorVersion: string;
  selectorBuildId: string;
  executableBuildSha256: string;
  databaseHelpersSha256: string;
  sourceEvidenceManifestSha256: string;
  sourceEvidenceGenerationSha256: string;
  issuerAnchorSha256: string;
  issuerRevocationsSha256: string;
}

interface IssuerAnchor {
  version: "enta-r3e-issuer-anchor-v1";
  environment: "production" | "synthetic";
  keys: Array<{
    keyId: string;
    role: "ISSUER";
    publicKeyPem: string;
    policyVersions: string[];
    notBefore: string;
    notAfter: string;
    revokedAt: string | null;
  }>;
}

interface IssuerEnvelope {
  version: "enta-r3e-issuer-envelope-v1";
  manifestSha256: string;
  signatures: Array<{ keyId: string; signatureBase64: string }>;
}

interface IssuerRevocations {
  version: "enta-r3e-issuer-revocations-v1";
  issuedAt: string;
  expiresAt: string;
  revokedManifestSha256: string[];
  revokedReleaseRoots: string[];
  revokedBuildSha256: string[];
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
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readTrustedFile(filePath: string, expectedDescriptorSha256: string): Promise<Buffer | undefined> {
  if (!path.isAbsolute(filePath)) return undefined;
  const absolute = path.resolve(filePath);
  let canonical: string;
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    canonical = await realpath(absolute);
    before = await lstat(absolute);
  } catch { return undefined; }
  if (!samePath(absolute, canonical) || before.isSymbolicLink() || !before.isFile() || before.size < 1 || before.size > MAX_FILE_BYTES) return undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size || opened.size > MAX_FILE_BYTES) return undefined;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        sha256(bytes) !== expectedDescriptorSha256) return undefined;
    return bytes;
  } catch { return undefined; }
  finally { await handle?.close().catch(() => undefined); }
}

async function verifiedDirectory(value: string): Promise<string | undefined> {
  if (!path.isAbsolute(value)) return undefined;
  const absolute = path.resolve(value);
  try {
    const info = await lstat(absolute);
    const canonical = await realpath(absolute);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(absolute, canonical)) return undefined;
    return canonical;
  } catch { return undefined; }
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = parseJsonRejectingDuplicateKeys(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch { return undefined; }
}

function parseAnchor(value: Record<string, unknown>): IssuerAnchor | undefined {
  if (!exactKeys(value, ["version", "environment", "keys"]) || value.version !== "enta-r3e-issuer-anchor-v1" ||
      (value.environment !== "production" && value.environment !== "synthetic") || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 8) return undefined;
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  for (const raw of value.keys) {
    if (!isRecord(raw) || !exactKeys(raw, ["keyId", "role", "publicKeyPem", "policyVersions", "notBefore", "notAfter", "revokedAt"]) ||
        typeof raw.keyId !== "string" || !KEY_ID.test(raw.keyId) || raw.role !== "ISSUER" ||
        typeof raw.publicKeyPem !== "string" || raw.publicKeyPem.length > 8192 || !Array.isArray(raw.policyVersions) ||
        !raw.policyVersions.includes(ENTA_R3E_ISSUER_POLICY) || raw.policyVersions.some((item) => typeof item !== "string" || !KEY_ID.test(item)) ||
        !validIso(raw.notBefore) || !validIso(raw.notAfter) || (raw.revokedAt !== null && !validIso(raw.revokedAt))) return undefined;
    try {
      const key = createPublicKey(raw.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") return undefined;
      const fingerprint = sha256(key.export({ type: "spki", format: "der" }));
      if (fingerprints.has(fingerprint)) return undefined;
      fingerprints.add(fingerprint);
    } catch { return undefined; }
    ids.add(raw.keyId);
  }
  if (ids.size !== value.keys.length) return undefined;
  return value as unknown as IssuerAnchor;
}

function parseManifest(value: Record<string, unknown>): IssuerManifest | undefined {
  const fields = ["version", "issuedAt", "expiresAt", "policyVersion", "catalogReleaseId", "releaseRootHash", "sourceNamespace",
    "sourceReleaseId", "sourceRootSha256", "sourceBytesSha256", "snapshotHash", "selectorVersion", "selectorBuildId",
    "executableBuildSha256", "databaseHelpersSha256", "sourceEvidenceManifestSha256", "sourceEvidenceGenerationSha256",
    "issuerAnchorSha256", "issuerRevocationsSha256"];
  if (!exactKeys(value, fields) || value.version !== "enta-r3e-issuer-manifest-v1" || !validIso(value.issuedAt) || !validIso(value.expiresAt) ||
      value.policyVersion !== ENTA_R3E_ISSUER_POLICY || typeof value.catalogReleaseId !== "string" || !value.catalogReleaseId.trim() || value.catalogReleaseId.length > 160 ||
      value.sourceNamespace !== "enta.question" || typeof value.sourceReleaseId !== "string" || !value.sourceReleaseId.trim() || value.sourceReleaseId.length > 160 ||
      typeof value.selectorVersion !== "string" || value.selectorVersion.length > 96 || typeof value.selectorBuildId !== "string" || value.selectorBuildId.length > 160 ||
      fields.filter((field) => field.endsWith("Hash") || field.endsWith("Sha256") || field.endsWith("Sha256")).some((field) => !isSha256(value[field]))) return undefined;
  return value as unknown as IssuerManifest;
}

function parseEnvelope(value: Record<string, unknown>, manifestDigest: string): IssuerEnvelope | undefined {
  if (!exactKeys(value, ["version", "manifestSha256", "signatures"]) || value.version !== "enta-r3e-issuer-envelope-v1" ||
      value.manifestSha256 !== manifestDigest || !Array.isArray(value.signatures) || value.signatures.length < 1 || value.signatures.length > 8) return undefined;
  const ids = new Set<string>();
  for (const raw of value.signatures) {
    if (!isRecord(raw) || !exactKeys(raw, ["keyId", "signatureBase64"]) || typeof raw.keyId !== "string" || !KEY_ID.test(raw.keyId) ||
        typeof raw.signatureBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.signatureBase64)) return undefined;
    const signature = Buffer.from(raw.signatureBase64, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== raw.signatureBase64 || ids.has(raw.keyId)) return undefined;
    ids.add(raw.keyId);
  }
  return value as unknown as IssuerEnvelope;
}

function parseRevocations(value: Record<string, unknown>, now: number): IssuerRevocations | undefined {
  const fields = ["revokedManifestSha256", "revokedBuildSha256", "revokedEvidenceDigests"];
  if (!exactKeys(value, ["version", "issuedAt", "expiresAt", ...fields, "revokedReleaseRoots"]) ||
      value.version !== "enta-r3e-issuer-revocations-v1" || !validIso(value.issuedAt) || !validIso(value.expiresAt) ||
      !fields.every((field) => Array.isArray(value[field]) && (value[field] as unknown[]).length <= 10000 && (value[field] as unknown[]).every(isSha256)) ||
      !Array.isArray(value.revokedReleaseRoots) || value.revokedReleaseRoots.length > 10000 || !value.revokedReleaseRoots.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160)) return undefined;
  if (Date.parse(value.issuedAt) > now || Date.parse(value.expiresAt) <= now || Date.parse(value.issuedAt) >= Date.parse(value.expiresAt)) return undefined;
  return value as unknown as IssuerRevocations;
}

/** Reads only operator-configured trust paths; all unavailable inputs fail closed. */
export async function verifyR3eIssuerTrust(input: {
  binding: R3eIssuerManifestBinding;
  runtimeIdentity: R3eRuntimeIdentity;
  sourceEvidenceManifestSha256: string;
  sourceEvidenceGenerationSha256: string;
}): Promise<R3eIssuerTrustResult> {
  return verifyR3eIssuerTrustWithReviewedCustody(input);
}

/** Kept private and unreachable until a reviewed native OS custody adapter exists. */
async function verifyR3eIssuerTrustWithReviewedCustody(input: {
  binding: R3eIssuerManifestBinding;
  runtimeIdentity: R3eRuntimeIdentity;
  sourceEvidenceManifestSha256: string;
  sourceEvidenceGenerationSha256: string;
}): Promise<R3eIssuerTrustResult> {
  const manifestDigest = process.env.ENTA_R3E_MANIFEST_SHA256;
  const anchorPath = process.env.ENTA_R3E_TRUST_ANCHOR_PATH;
  const revocationsPath = process.env.ENTA_R3E_REVOCATIONS_PATH;
  const registrySetting = process.env.ENTA_R3E_REGISTRY_DIR;
  if (!manifestDigest || !anchorPath || !revocationsPath || !registrySetting) return { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_MISSING" };
  if (!isSha256(manifestDigest)) return { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_INVALID" };
  if (process.platform !== "linux") return { status: "unavailable", reasonCode: "R3E_TRUST_CUSTODY_UNAVAILABLE" };
  const registry = await verifiedDirectory(registrySetting);
  if (!registry) return { status: "unavailable", reasonCode: "R3E_TRUST_BYTES_UNAVAILABLE" };
  const manifestPath = path.join(registry, manifestDigest + ".r3e.manifest");
  const signaturePath = path.join(registry, manifestDigest + ".r3e.sig");
  const custodyPaths = [anchorPath, revocationsPath, manifestPath, signaturePath];
  const custodyBefore = await verifyR3eNativeCustody(custodyPaths);
  if (custodyBefore.status !== "verified") return { status: "unavailable", reasonCode: "R3E_TRUST_CUSTODY_UNAVAILABLE" };
  const expectedDigest = (filePath: string) => custodyBefore.snapshot.fileSha256.get(path.resolve(filePath));
  const anchorDigest = expectedDigest(anchorPath);
  const revocationDigest = expectedDigest(revocationsPath);
  const manifestFileDigest = expectedDigest(manifestPath);
  const signatureFileDigest = expectedDigest(signaturePath);
  if (!anchorDigest || !revocationDigest || !manifestFileDigest || !signatureFileDigest) {
    return { status: "unavailable", reasonCode: "R3E_TRUST_CUSTODY_UNAVAILABLE" };
  }
  const [anchorBytes, revocationBytes] = await Promise.all([
    readTrustedFile(anchorPath, anchorDigest),
    readTrustedFile(revocationsPath, revocationDigest),
  ]);
  if (!anchorBytes || !revocationBytes) return { status: "unavailable", reasonCode: "R3E_TRUST_BYTES_UNAVAILABLE" };
  const anchor = parseAnchor(parseObject(anchorBytes) ?? {});
  const revocations = parseRevocations(parseObject(revocationBytes) ?? {}, Date.now());
  if (!anchor || !revocations || (process.env.NODE_ENV === "production" && anchor.environment !== "production")) {
    return { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_INVALID" };
  }
  const manifestBytes = await readTrustedFile(manifestPath, manifestFileDigest);
  const signatureBytes = await readTrustedFile(signaturePath, signatureFileDigest);
  if (!manifestBytes || !signatureBytes) return { status: "unavailable", reasonCode: "R3E_TRUST_BYTES_UNAVAILABLE" };
  if (sha256(manifestBytes) !== manifestDigest) return { status: "rejected", reasonCode: "R3E_TRUST_BINDING_MISMATCH" };
  const manifest = parseManifest(parseObject(manifestBytes) ?? {});
  const envelope = parseEnvelope(parseObject(signatureBytes) ?? {}, manifestDigest);
  if (!manifest || !envelope) return { status: "rejected", reasonCode: "R3E_TRUST_POLICY_INVALID" };
  const now = Date.now();
  if (Date.parse(manifest.issuedAt) > now || Date.parse(manifest.expiresAt) <= now || Date.parse(manifest.issuedAt) >= Date.parse(manifest.expiresAt)) {
    return { status: "unavailable", reasonCode: "R3E_TRUST_EXPIRED" };
  }
  const binding = input.binding;
  if (manifest.catalogReleaseId !== binding.catalogReleaseId || manifest.releaseRootHash !== binding.releaseRootHash ||
      manifest.sourceNamespace !== binding.sourceNamespace || manifest.sourceReleaseId !== binding.sourceReleaseId ||
      manifest.sourceRootSha256 !== binding.sourceRootSha256 || manifest.sourceBytesSha256 !== binding.sourceBytesSha256 ||
      manifest.snapshotHash !== binding.snapshotHash || manifest.selectorVersion !== binding.selectorVersion || manifest.selectorBuildId !== binding.selectorBuildId ||
      manifest.executableBuildSha256 !== input.runtimeIdentity.buildSha256 || manifest.databaseHelpersSha256 !== input.runtimeIdentity.databaseHelpersSha256 ||
      manifest.sourceEvidenceManifestSha256 !== input.sourceEvidenceManifestSha256 || manifest.sourceEvidenceGenerationSha256 !== input.sourceEvidenceGenerationSha256 ||
      manifest.issuerAnchorSha256 !== sha256(anchorBytes) || manifest.issuerRevocationsSha256 !== sha256(revocationBytes)) {
    return { status: "rejected", reasonCode: "R3E_TRUST_BINDING_MISMATCH" };
  }
  if (revocations.revokedManifestSha256.includes(manifestDigest) || revocations.revokedReleaseRoots.includes(binding.releaseRootHash) ||
      revocations.revokedBuildSha256.includes(input.runtimeIdentity.buildSha256) || revocations.revokedEvidenceDigests.includes(input.sourceEvidenceManifestSha256)) {
    return { status: "rejected", reasonCode: "R3E_TRUST_REVOKED" };
  }
  const signBytes = Buffer.concat([DOMAIN, manifestBytes]);
  const validityCutoffs = [Date.parse(manifest.expiresAt), Date.parse(revocations.expiresAt)];
  for (const signed of envelope.signatures) {
    const key = anchor.keys.find((candidate) => candidate.keyId === signed.keyId);
    if (!key || key.revokedAt !== null || Date.parse(key.notBefore) > now || Date.parse(key.notAfter) <= now ||
        !key.policyVersions.includes(ENTA_R3E_ISSUER_POLICY)) return { status: "unavailable", reasonCode: "R3E_TRUST_EXPIRED" };
    let valid = false;
    try { valid = verifySignature(null, signBytes, createPublicKey(key.publicKeyPem), Buffer.from(signed.signatureBase64, "base64")); }
    catch { valid = false; }
    if (!valid) return { status: "rejected", reasonCode: "R3E_TRUST_SIGNATURE_INVALID" };
    validityCutoffs.push(Date.parse(key.notAfter));
  }
  const custodyAfter = await verifyR3eNativeCustody(custodyPaths);
  if (custodyAfter.status !== "verified" || custodyAfter.snapshot.metadataSha256 !== custodyBefore.snapshot.metadataSha256 ||
      custodyPaths.some((filePath) => custodyAfter.snapshot.fileSha256.get(path.resolve(filePath)) !== custodyBefore.snapshot.fileSha256.get(path.resolve(filePath)))) {
    return { status: "rejected", reasonCode: "R3E_TRUST_BINDING_MISMATCH" };
  }
  const generationSha256 = sha256(Buffer.from(JSON.stringify({
    version: "enta-r3e-coherent-trust-generation-v1",
    custodyMetadataSha256: custodyAfter.snapshot.metadataSha256,
    manifestSha256: manifestDigest,
    signatureEnvelopeSha256: sha256(signatureBytes),
    anchorSha256: sha256(anchorBytes),
    revocationsSha256: sha256(revocationBytes),
    sourceEvidenceGenerationSha256: input.sourceEvidenceGenerationSha256,
    sourceBytesSha256: binding.sourceBytesSha256,
    executableBuildSha256: input.runtimeIdentity.buildSha256,
    databaseHelpersSha256: input.runtimeIdentity.databaseHelpersSha256,
  }), "utf8"));
  return {
    status: "verified",
    manifestSha256: manifestDigest,
    generationSha256,
    sourceEvidenceGenerationSha256: input.sourceEvidenceGenerationSha256,
    expiresAt: new Date(Math.min(...validityCutoffs)).toISOString(),
  };
}
