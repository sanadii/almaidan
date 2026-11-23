import { createHash } from "node:crypto";
import { open, lstat, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { validateEntaReleaseEvidenceForIssuerInTransaction, type PrivateEntaValidationReport } from "./private-validator";
import {
  readEntaIssuerSourceIdentity,
  readR3eDatabaseHelperDefinitions,
  type EntaPostgresEvidenceRequest,
} from "./postgres-evidence-reader";
import { hashR3eDatabaseHelperDefinitions, measureR3eRuntimeIdentity, type R3eRuntimeIdentity } from "./r3e-runtime-identity";
import { verifyR3eIssuerTrust, type R3eIssuerManifestBinding, type R3eIssuerTrustResult } from "./r3e-issuer-trust";
import { verifyR3eNativeCustody } from "./r3e-native-custody";
import { hasValidatedR3eIssuerLaunch } from "./r3e-launch-context";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const ISSUER_POLICY = "enta-r3e-private-issuer-v1";
const RETRYABLE_SQL_STATES = new Set(["40001", "40P01"]);

interface IssuerTx extends Pick<Prisma.TransactionClient, "$queryRaw"> {}

export interface EntaR3eReceiptResult {
  receiptId: string;
  proofId: string;
  reportSha256: string;
  policyVersion: typeof ISSUER_POLICY;
}

type IssuerFailure = { status: "rejected" | "unavailable"; reasonCode: string };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readSourceArtifact(sourceRootSha256: string): Promise<Buffer | undefined> {
  const registrySetting = process.env.ENTA_R3C_REGISTRY_DIR;
  if (!registrySetting || !SHA256.test(sourceRootSha256) || !path.isAbsolute(registrySetting)) return undefined;
  const root = path.resolve(registrySetting);
  try {
    const rootStat = await lstat(root);
    const rootReal = await realpath(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || !samePath(root, rootReal)) return undefined;
    const artifactPath = path.join(rootReal, sourceRootSha256 + ".artifact");
    const custodyBefore = await verifyR3eNativeCustody([artifactPath]);
    if (custodyBefore.status !== "verified") return undefined;
    const artifactReal = await realpath(artifactPath);
    const stat = await lstat(artifactPath);
    if (!samePath(artifactPath, artifactReal) || stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_SOURCE_BYTES) return undefined;
    const handle = await open(artifactPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== stat.size) return undefined;
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const custodyAfter = await verifyR3eNativeCustody([artifactPath]);
      const openedDigest = custodyBefore.snapshot.fileSha256.get(path.resolve(artifactPath));
      const finalDigest = custodyAfter.status === "verified" ? custodyAfter.snapshot.fileSha256.get(path.resolve(artifactPath)) : undefined;
      if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
          custodyAfter.status !== "verified" || custodyAfter.snapshot.metadataSha256 !== custodyBefore.snapshot.metadataSha256 ||
          !openedDigest || openedDigest !== finalDigest || sha256(bytes) !== openedDigest || openedDigest !== sourceRootSha256) return undefined;
      return bytes;
    } finally {
      await handle.close();
    }
  } catch { return undefined; }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function safeReport(report: PrivateEntaValidationReport, policyVersion: string, runtime: R3eRuntimeIdentity, trust: Extract<R3eIssuerTrustResult, { status: "verified" }>): string {
  if (report.status !== "verified" || !report.release || !report.source || !report.selector || report.reasonCodes.length !== 0 ||
      report.selector.replayed.length === 0 || !report.sourceSummarySha256 || !report.sourceEvidenceExpiresAt) throw new Error("R3E_PROOF_INCOMPLETE");
  const proofExpiresAt = new Date(Math.min(Date.parse(report.sourceEvidenceExpiresAt), Date.parse(trust.expiresAt)));
  if (!Number.isFinite(proofExpiresAt.getTime()) || proofExpiresAt.getTime() <= Date.now()) throw new Error("R3E_PROOF_EXPIRED");
  return canonicalJson({
    version: "enta-r3e-validation-report-v1",
    status: "verified",
    policyVersion,
    release: report.release,
    source: report.source,
    sourceSummarySha256: report.sourceSummarySha256,
    selector: {
      version: report.selector.version,
      buildId: report.selector.buildId,
      replayed: [...report.selector.replayed].sort((a, b) => `${a.categoryKey}\0${a.tier}`.localeCompare(`${b.categoryKey}\0${b.tier}`)),
    },
    trustManifestSha256: trust.manifestSha256,
    trustGenerationSha256: trust.generationSha256,
    sourceEvidenceExpiresAt: report.sourceEvidenceExpiresAt,
    sourceEvidenceManifestSha256: report.trustManifestSha256,
    sourceEvidenceGenerationSha256: trust.sourceEvidenceGenerationSha256,
    trustExpiresAt: trust.expiresAt,
    proofExpiresAt: proofExpiresAt.toISOString(),
    executableBuildSha256: runtime.buildSha256,
    databaseHelpersSha256: runtime.databaseHelpersSha256,
  });
}

function buildBinding(report: PrivateEntaValidationReport, sourceBytes: Uint8Array): R3eIssuerManifestBinding {
  if (!report.release || !report.source || !report.selector ||
      !SHA256.test(report.release.rootSha256) || !SHA256.test(report.source.rootSha256) || !SHA256.test(report.source.snapshotHash)) {
    throw new Error("R3E_PROOF_IDENTITY_MISSING");
  }
  return {
    catalogReleaseId: report.release.id,
    releaseRootHash: report.release.rootSha256,
    sourceNamespace: "enta.question",
    sourceReleaseId: report.source.releaseId,
    sourceRootSha256: report.source.rootSha256,
    sourceBytesSha256: sha256(sourceBytes),
    snapshotHash: report.source.snapshotHash,
    selectorVersion: report.selector.version,
    selectorBuildId: report.selector.buildId,
  };
}

async function readRuntimeIdentity(tx: IssuerTx): Promise<R3eRuntimeIdentity | undefined> {
  const helperRows = await readR3eDatabaseHelperDefinitions(tx);
  if (!helperRows) return undefined;
  try { return await measureR3eRuntimeIdentity(helperRows); }
  catch { return undefined; }
}

async function proveInTransaction(tx: IssuerTx, catalogReleaseId: string): Promise<EntaR3eReceiptResult | IssuerFailure> {
  const identity = await readEntaIssuerSourceIdentity(tx, catalogReleaseId);
  if (!identity) return { status: "unavailable", reasonCode: "R3E_ISSUER_DATABASE_IDENTITY_INVALID" };
  const sourceBytes = await readSourceArtifact(identity.sourceRootSha256);
  if (!sourceBytes) return { status: "unavailable", reasonCode: "R3E_SOURCE_ARTIFACT_UNAVAILABLE" };
  const request: EntaPostgresEvidenceRequest = {
    catalogReleaseId,
    expectedReleaseRootHash: identity.releaseRootHash,
    expectedSourceRootSha256: identity.sourceRootSha256,
    rawArtifactBytes: sourceBytes,
  };

  const report = await validateEntaReleaseEvidenceForIssuerInTransaction(tx, request);
  if (report.status !== "verified" || !report.trustManifestSha256 || !report.trustGenerationSha256) {
    return { status: report.status === "rejected" ? "rejected" : "unavailable", reasonCode: report.reasonCodes[0] ?? "R3E_RELEASE_PROOF_INCOMPLETE" };
  }
  const runtime = await readRuntimeIdentity(tx);
  if (!runtime) return { status: "unavailable", reasonCode: "R3E_RUNTIME_OR_HELPER_CLOSURE_UNAVAILABLE" };
  const binding = buildBinding(report, sourceBytes);
  const firstTrust = await verifyR3eIssuerTrust({
    binding,
    runtimeIdentity: runtime,
    sourceEvidenceManifestSha256: report.trustManifestSha256,
    sourceEvidenceGenerationSha256: report.trustGenerationSha256,
  });
  if (firstTrust.status !== "verified") return { status: firstTrust.status, reasonCode: firstTrust.reasonCode };

  // Pin every mutable local trust/source/build component again immediately
  // before insertion, while the same RR database transaction is still open.
  const sourceBytesAgain = await readSourceArtifact(identity.sourceRootSha256);
  const reportAgain = sourceBytesAgain
    ? await validateEntaReleaseEvidenceForIssuerInTransaction(tx, { ...request, rawArtifactBytes: sourceBytesAgain })
    : undefined;
  const runtimeAgain = await readRuntimeIdentity(tx);
  if (!sourceBytesAgain || !reportAgain || reportAgain.status !== "verified" || !reportAgain.trustManifestSha256 ||
      !reportAgain.trustGenerationSha256 || !runtimeAgain ||
      sha256(sourceBytesAgain) !== binding.sourceBytesSha256 || reportAgain.trustManifestSha256 !== report.trustManifestSha256 ||
      reportAgain.trustGenerationSha256 !== report.trustGenerationSha256 || runtimeAgain.buildSha256 !== runtime.buildSha256 ||
      runtimeAgain.databaseHelpersSha256 !== runtime.databaseHelpersSha256) {
    return { status: "rejected", reasonCode: "R3E_TRUST_GENERATION_CHANGED" };
  }
  const secondTrust = await verifyR3eIssuerTrust({
    binding,
    runtimeIdentity: runtimeAgain,
    sourceEvidenceManifestSha256: reportAgain.trustManifestSha256,
    sourceEvidenceGenerationSha256: reportAgain.trustGenerationSha256,
  });
  if (secondTrust.status !== "verified" || secondTrust.generationSha256 !== firstTrust.generationSha256) {
    return { status: secondTrust.status === "verified" ? "rejected" : secondTrust.status,
      reasonCode: secondTrust.status === "verified" ? "R3E_TRUST_GENERATION_CHANGED" : secondTrust.reasonCode };
  }

  const reportJson = safeReport(report, ISSUER_POLICY, runtime, firstTrust);
  if (safeReport(reportAgain, ISSUER_POLICY, runtimeAgain, secondTrust) !== reportJson) {
    return { status: "rejected", reasonCode: "R3E_TRUST_GENERATION_CHANGED" };
  }
  const issued = await tx.$queryRaw<Array<{ receiptId: string; proofId: string; reportSha256: string }>>(Prisma.sql`
    SELECT issued."receiptId", issued."proofId", issued."reportSha256"
    FROM public.issue_r3e_catalog_receipt(
      ${catalogReleaseId}, ${reportJson}, ${binding.sourceRootSha256}, ${binding.snapshotHash},
      ${report.sourceSummarySha256}, ${report.trustManifestSha256}, ${report.trustGenerationSha256},
      ${binding.selectorVersion}, ${binding.selectorBuildId}, ${runtime.buildSha256}, ${runtime.databaseHelpersSha256},
      ${firstTrust.manifestSha256}, ${firstTrust.generationSha256}
    ) AS issued
  `);
  if (issued.length !== 1 || !issued[0].receiptId || !issued[0].proofId || !SHA256.test(issued[0].reportSha256)) {
    throw new Error("R3E_ISSUER_RETURN_INVALID");
  }
  return { ...issued[0], policyVersion: ISSUER_POLICY };
}

function retryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const object = error as Record<string, unknown>;
  if (object.code === "P2034") return true;
  const meta = object.meta && typeof object.meta === "object" ? object.meta as Record<string, unknown> : undefined;
  const sqlState = typeof meta?.code === "string" ? meta.code : typeof object.code === "string" ? object.code : undefined;
  return sqlState !== undefined && RETRYABLE_SQL_STATES.has(sqlState);
}

/** Operator-only, no HTTP entrypoint. Accepts only an identity and returns only persisted IDs/hashes. */
export async function issueEntaR3eCatalogReceipt(client: PrismaClient, catalogReleaseId: string): Promise<EntaR3eReceiptResult | IssuerFailure> {
  if (process.env.NODE_ENV !== "production") return { status: "unavailable", reasonCode: "R3E_PRODUCTION_ISSUER_REQUIRED" };
  if (!hasValidatedR3eIssuerLaunch()) return { status: "unavailable", reasonCode: "R3E_LAUNCH_CONTEXT_REQUIRED" };
  if (typeof catalogReleaseId !== "string" || catalogReleaseId.trim().length === 0 || catalogReleaseId.length > 160) {
    return { status: "rejected", reasonCode: "R3E_RELEASE_ID_INVALID" };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(
        (tx) => proveInTransaction(tx, catalogReleaseId),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000, timeout: 120_000 },
      );
    } catch (error) {
      if (attempt < 2 && retryableTransactionError(error)) continue;
      throw error;
    }
  }
  return { status: "unavailable", reasonCode: "R3E_TRANSACTION_RETRY_EXHAUSTED" };
}
