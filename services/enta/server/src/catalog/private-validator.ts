import { Prisma } from "@prisma/client";
import {
  readEntaPostgresReleaseEvidence,
  readEntaPostgresReleaseEvidenceForIssuer,
  type EntaPostgresEvidenceRequest,
  type EntaPostgresEvidenceResult,
} from "./postgres-evidence-reader";
import { verifyIndependentEntaEvidence, verifyIndependentEntaEvidenceForIssuer } from "./independent-evidence";

type CatalogReadTransaction = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface PrivateEntaValidationReport {
  status: "verified" | "partial" | "rejected" | "unavailable";
  structuralStatus: "verified" | "rejected" | "unavailable";
  selectorStatus: "verified" | "incomplete" | "rejected" | "unavailable";
  provenanceStatus: "verified" | "rejected" | "unavailable";
  reasonCodes: string[];
  release?: { id: string; rootSha256: string };
  source?: { releaseId: string; rootSha256: string; snapshotHash: string };
  selector?: {
    version: string;
    buildId: string;
    replayed: Array<{ categoryKey: string; tier: string; freshSeed: number; repeatSeed: number; freshHash: string; repeatHash: string; manifestHash: string }>;
  };
  trustManifestSha256?: string;
  trustGenerationSha256?: string;
  sourceEvidenceExpiresAt?: string;
  sourceSummarySha256?: string;
}

function baseFailure(result: Extract<EntaPostgresEvidenceResult, { status: "rejected" | "unavailable" }>): PrivateEntaValidationReport {
  return {
    status: result.status,
    structuralStatus: result.status,
    selectorStatus: "unavailable",
    provenanceStatus: "unavailable",
    reasonCodes: [result.reasonCode],
  };
}

/**
 * Runs the private proof while the caller's transaction remains open. The
 * reader rejects unless this is an explicit REPEATABLE READ, READ ONLY
 * transaction using the distinct catalog_validator database identity.
 */
export async function validateEntaReleaseEvidenceInTransaction(
  tx: CatalogReadTransaction,
  request: EntaPostgresEvidenceRequest,
): Promise<PrivateEntaValidationReport> {
  return validateEvidence(tx, request, false);
}

/** R3-E only: uses the separate issuer login in a read-write repeatable-read transaction. */
export async function validateEntaReleaseEvidenceForIssuerInTransaction(
  tx: CatalogReadTransaction,
  request: EntaPostgresEvidenceRequest,
): Promise<PrivateEntaValidationReport> {
  return validateEvidence(tx, request, true);
}

async function validateEvidence(
  tx: CatalogReadTransaction,
  request: EntaPostgresEvidenceRequest,
  issuer: boolean,
): Promise<PrivateEntaValidationReport> {
  const structural = issuer
    ? await readEntaPostgresReleaseEvidenceForIssuer(tx, request)
    : await readEntaPostgresReleaseEvidence(tx, request);
  if (structural.status !== "partial") return baseFailure(structural);

  const verifyIndependent = issuer ? verifyIndependentEntaEvidenceForIssuer : verifyIndependentEntaEvidence;
  const independent = await verifyIndependent({
    binding: {
      catalogReleaseId: structural.catalogReleaseId,
      releaseRootHash: structural.releaseRootHash,
      sourceNamespace: "enta.question",
      sourceReleaseId: structural.sourceReleaseId,
      sourceRootSha256: structural.sourceRootSha256,
      snapshotHash: structural.sourceSnapshotHash,
      selectorVersion: structural.selectorVersion,
      selectorBuildId: structural.selectorBuildId,
    },
    receiptClaims: structural.receiptClaims,
  });
  const reasonCodes = new Set(structural.reasonCodes.filter((code) => code !== "INDEPENDENT_EDITORIAL_PROVENANCE_PENDING" &&
    (issuer || code !== "ISSUER_POLICY_PENDING")));
  if (independent.status === "verified") reasonCodes.delete("INDEPENDENT_EDITORIAL_PROVENANCE_PENDING");
  else {
    reasonCodes.add("INDEPENDENT_EDITORIAL_PROVENANCE_PENDING");
    reasonCodes.add(independent.reasonCode);
  }
  // Keep the diagnostic reader partial forever; only the R3-E private runner
  // may turn a complete proof into verified after its exact signed policy/build
  // manifest and the DB insertion policy are checked.
  if (!issuer) reasonCodes.add("ISSUER_POLICY_PENDING");
  if (structural.selectorStatus !== "verified") reasonCodes.add("SELECTOR_REPLAY_PENDING");
  const byAvailability = new Map(structural.declaredAvailability.map((row) => [
    `${row.categoryKey}\0${row.tier}`,
    row,
  ]));
  const selectorProofs = structural.selectorProofs.map((proof) => {
    const row = byAvailability.get(`${proof.categoryKey}\0${proof.tier}`);
    return {
      categoryKey: proof.categoryKey,
      tier: proof.tier,
      freshSeed: row?.freshSelectionSeed ?? 0,
      repeatSeed: row?.repeatSelectionSeed ?? 0,
      freshHash: proof.freshSelectionHash,
      repeatHash: proof.repeatSelectionHash,
      manifestHash: proof.selectionManifestHash,
    };
  });
  return {
    status: independent.status === "rejected" || structural.selectorStatus === "rejected"
      ? "rejected"
      : issuer && independent.status === "verified" && structural.selectorStatus === "verified" && reasonCodes.size === 0
        ? "verified"
        : "partial",
    structuralStatus: structural.structuralStatus,
    selectorStatus: structural.selectorStatus,
    provenanceStatus: independent.status,
    reasonCodes: [...reasonCodes].sort(),
    release: { id: structural.catalogReleaseId, rootSha256: structural.releaseRootHash },
    source: { releaseId: structural.sourceReleaseId, rootSha256: structural.sourceRootSha256, snapshotHash: structural.sourceSnapshotHash },
    selector: { version: structural.selectorVersion, buildId: structural.selectorBuildId, replayed: selectorProofs },
    ...(independent.status === "verified" ? {
      trustManifestSha256: independent.manifestSha256,
      trustGenerationSha256: independent.trustGenerationSha256,
      sourceEvidenceExpiresAt: independent.expiresAt,
    } : {}),
    sourceSummarySha256: structural.sourceEvidenceManifestHash,
  };
}
