import type { PrismaClient } from "@prisma/client";
import type { ActiveCatalogRecord, CatalogStore } from "./types";

export function createPrismaCatalogStore(prisma: PrismaClient): CatalogStore {
  return {
    async readActiveCatalog(): Promise<ActiveCatalogRecord | null> {
      const pointer = await prisma.activeCatalogPointer.findUnique({
        where: { id: "singleton" },
        select: {
          catalogReleaseId: true,
          releaseRootHash: true,
          validationReceiptId: true,
          validationReceipt: {
            select: {
              id: true,
              catalogReleaseId: true,
              releaseRootHash: true,
              validatorRef: true,
              policyVersion: true,
              sourceEvidenceManifestHash: true,
              selectorVersion: true,
              huroofProjectId: true,
              huroofReleaseId: true,
              huroofRootSha256: true,
              huroofCapabilityStateHash: true,
              huroofSelectorAttestation: true,
              releaseSeal: { select: { sealHash: true } },
            },
          },
          catalogRelease: {
            select: {
              id: true,
              releaseRootHash: true,
              sealedAt: true,
              sourceSnapshots: {
                select: {
                  sourceNamespace: true,
                  sourceReleaseId: true,
                  sourceRootSha256: true,
                  snapshotHash: true,
                },
              },
              categories: {
                select: {
                  categoryKey: true,
                  categoryRevision: { select: { labelAr: true, description: true, editorialDecision: true } },
                  availability: {
                    select: {
                      engine: true,
                      mode: true,
                      tier: true,
                      modality: true,
                      selectorVersion: true,
                      selectionManifestHash: true,
                      freshSelectionHash: true,
                      repeatSelectionHash: true,
                      freshSelectionIds: true,
                      repeatSelectionIds: true,
                      freshSelectionSeed: true,
                      repeatSelectionSeed: true,
                      validatedAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!pointer) return null;
      return {
        pointerReleaseId: pointer.catalogReleaseId,
        pointerRootHash: pointer.releaseRootHash,
        pointerReceiptId: pointer.validationReceiptId,
        releaseSealedAt: pointer.catalogRelease.sealedAt,
        releaseId: pointer.catalogRelease.id,
        releaseRootHash: pointer.catalogRelease.releaseRootHash,
        validation: {
          id: pointer.validationReceipt.id,
          catalogReleaseId: pointer.validationReceipt.catalogReleaseId,
          releaseRootHash: pointer.validationReceipt.releaseRootHash,
          sealHash: pointer.validationReceipt.releaseSeal.sealHash,
          validatorRef: pointer.validationReceipt.validatorRef,
          policyVersion: pointer.validationReceipt.policyVersion,
          sourceEvidenceManifestHash: pointer.validationReceipt.sourceEvidenceManifestHash,
          selectorVersion: pointer.validationReceipt.selectorVersion,
          huroofProjectId: pointer.validationReceipt.huroofProjectId,
          huroofReleaseId: pointer.validationReceipt.huroofReleaseId,
          huroofRootSha256: pointer.validationReceipt.huroofRootSha256,
          huroofCapabilityStateHash: pointer.validationReceipt.huroofCapabilityStateHash,
          huroofSelectorAttestation: pointer.validationReceipt.huroofSelectorAttestation,
        },
        sourceSnapshots: pointer.catalogRelease.sourceSnapshots,
        categories: pointer.catalogRelease.categories.map((category) => ({
          categoryKey: category.categoryKey,
          labelAr: category.categoryRevision.labelAr,
          description: category.categoryRevision.description,
          editorialDecision: category.categoryRevision.editorialDecision,
          availability: category.availability,
        })),
      };
    },
  };
}
