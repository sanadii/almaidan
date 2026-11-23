import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { firebaseAdminAppForProject } from "../firebase-verifier";
import { huroofCapabilityHash, huroofInventoryHash } from "./attestation";
import type { HuroofCategoryReadiness, HuroofReleaseReader, HuroofReleaseSnapshot, HuroofSelectorAttestation } from "./types";

export interface ReleaseDocumentStore {
  readActiveAndRoot(): Promise<{
    pointer: { exists: boolean; data?: Record<string, unknown> };
    rootForRelease: (releaseId: string) => { exists: boolean; data?: Record<string, unknown> } | undefined;
    selectorAttestation?: Record<string, unknown>;
    capabilityFlags: Record<string, boolean>;
  }>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const RELEASE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CATEGORY_KEY = /^[A-Za-z0-9:_-]{1,128}$/;

function isCategoryReadiness(value: unknown): value is HuroofCategoryReadiness {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const playable = row.playable;
  if (!playable || typeof playable !== "object" || Array.isArray(playable)) return false;
  const flags = playable as Record<string, unknown>;
  return typeof row.categoryKey === "string" && CATEGORY_KEY.test(row.categoryKey) &&
    Number.isSafeInteger(row.approvedCount) && (row.approvedCount as number) > 0 &&
    Number.isSafeInteger(row.uniqueAnswerConceptCount) && (row.uniqueAnswerConceptCount as number) >= 0 &&
    typeof flags.huroof === "boolean" && typeof flags.categories === "boolean" && typeof flags.charades === "boolean";
}

function isSelectorAttestation(value: Record<string, unknown> | undefined): value is Record<string, unknown> & HuroofSelectorAttestation {
  if (!value) return false;
  return value.issuer === "huroof-functions" && typeof value.projectId === "string" &&
    typeof value.deploymentId === "string" && typeof value.releaseId === "string" &&
    typeof value.rootSha256 === "string" && SHA256.test(value.rootSha256) &&
    Number.isSafeInteger(value.approvedCount) && Array.isArray(value.categoryInventory) &&
    value.categoryInventory.every(isCategoryReadiness) && typeof value.inventoryHash === "string" && SHA256.test(value.inventoryHash) &&
    typeof value.capabilityStateHash === "string" && SHA256.test(value.capabilityStateHash) &&
    typeof value.selectorVersion === "string" && typeof value.policyVersion === "string" &&
    value.attestedAt instanceof Date && Number.isFinite(value.attestedAt.getTime());
}

export function createHuroofReleaseReader(
  projectId: string,
  expectedSelectorVersion: string,
  expectedPolicyVersion: string,
  store: ReleaseDocumentStore,
  purpose: "legacy-observation" | "paid-readiness",
): HuroofReleaseReader {
  if ((purpose !== "legacy-observation" && purpose !== "paid-readiness") || !projectId.trim() || !expectedSelectorVersion.trim() || !expectedPolicyVersion.trim()) {
    throw new Error("Explicit project and deployed selector/policy versions are required for source verification");
  }

  return {
    projectId,
    purpose,
    expectedSelectorVersion,
    expectedPolicyVersion,
    async readActiveRelease(): Promise<HuroofReleaseSnapshot> {
      const { pointer, rootForRelease, selectorAttestation: rawAttestation, capabilityFlags } = await store.readActiveAndRoot();
      const releaseId = pointer.data?.releaseId;
      if (!pointer.exists || typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
        throw new Error("ACTIVE_HUROOF_RELEASE_UNAVAILABLE");
      }
      const root = rootForRelease(releaseId);
      const data = root?.data;
      const rootSha256 = data?.documentRootSha256;
      if (!root?.exists || data?.immutable !== true || data?.demoFixture !== false ||
          typeof rootSha256 !== "string" || !SHA256.test(rootSha256)) {
        throw new Error("ACTIVE_HUROOF_RELEASE_INVALID");
      }
      const attestation = isSelectorAttestation(rawAttestation) ? rawAttestation : undefined;
      const inventory = attestation?.categoryInventory ?? [];
      const approvedCount = Number.isSafeInteger(data.approvedCount) ? data.approvedCount as number : 0;
      const inventoryHash = huroofInventoryHash(inventory);
      const capabilityStateHash = huroofCapabilityHash(capabilityFlags);
      return {
        projectId,
        releaseId,
        rootSha256,
        approvedCount,
        categoryInventory: inventory,
        inventoryHash,
        capabilityStateHash,
        capabilityFlags,
        ...(attestation ? { selectorAttestation: attestation } : {}),
      };
    },
  };
}

// Only SDK Timestamp instances at the Firestore boundary may be normalized.
// The canonical hash uses ISO milliseconds; reject sub-millisecond precision.
function normalizeTrustedTimestamp(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const value = data.attestedAt;
  if (!(value instanceof Timestamp) || value.nanoseconds % 1_000_000 !== 0) return data;
  const date = new Date(value.toMillis());
  if (!Number.isFinite(date.getTime())) return data;
  return { ...data, attestedAt: date };
}

export function firebaseAdminHuroofReleaseReader(projectId: string, selectorVersion: string, policyVersion: string, purpose: "legacy-observation" | "paid-readiness"): HuroofReleaseReader {
  if (purpose !== "legacy-observation" && purpose !== "paid-readiness") throw new Error("CATALOG_READER_PURPOSE_REQUIRED");
  const app = firebaseAdminAppForProject(projectId);
  if (app.options.projectId !== projectId) throw new Error("FIREBASE_ADMIN_PROJECT_MISMATCH");
  const db = getFirestore(app);
  return createHuroofReleaseReader(projectId, selectorVersion, policyVersion, {
    async readActiveAndRoot() {
      return db.runTransaction(async (transaction) => {
        const [pointerDocument, attestationDocument, capabilityDocument] = await Promise.all([
          transaction.get(db.doc("runtime/activeRelease")),
          transaction.get(db.doc(purpose === "paid-readiness" ? "maydanRuntimeV1/catalogSelectorAttestation" : "runtime/catalogSelectorAttestation")),
          transaction.get(db.doc("runtime/challengeMechanics")),
        ]);
        const pointer = { exists: pointerDocument.exists, data: pointerDocument.data() };
        const releaseId = pointer.data?.releaseId;
        const capabilityRaw = capabilityDocument.data() ?? {};
        const capabilityFlags = Object.fromEntries(Object.entries(capabilityRaw).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>;
        if (!pointer.exists || typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
          return { pointer, rootForRelease: () => undefined, selectorAttestation: normalizeTrustedTimestamp(attestationDocument.data()), capabilityFlags };
        }
        const rootDocument = await transaction.get(db.doc(`releases/${releaseId}`));
        const root = { exists: rootDocument.exists, data: rootDocument.data() };
        return {
          pointer,
          rootForRelease: (requestedReleaseId: string) => requestedReleaseId === releaseId ? root : undefined,
          selectorAttestation: normalizeTrustedTimestamp(attestationDocument.data()),
          capabilityFlags,
        };
      });
    },
  }, purpose);
}
