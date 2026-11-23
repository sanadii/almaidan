import { createHash } from "node:crypto";
import type { HuroofCategoryReadiness, HuroofSelectorAttestation } from "./types";

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readinessLine(category: HuroofCategoryReadiness): string {
  const { playable } = category;
  return [category.categoryKey, String(category.approvedCount), String(category.uniqueAnswerConceptCount),
    String(playable.huroof), String(playable.categories), String(playable.charades)].join("|");
}

export function huroofInventoryHash(categories: readonly HuroofCategoryReadiness[]): string {
  return sha256Text([...categories].sort((a, b) => a.categoryKey.localeCompare(b.categoryKey)).map(readinessLine).join("\n"));
}

export function huroofCapabilityHash(flags: Readonly<Record<string, boolean>>): string {
  return sha256Text(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n"));
}

export function huroofSelectorAttestationHash(attestation: HuroofSelectorAttestation): string {
  const inventory = [...attestation.categoryInventory].sort((a, b) => a.categoryKey.localeCompare(b.categoryKey));
  return sha256Text([
    attestation.issuer, attestation.projectId, attestation.deploymentId, attestation.releaseId, attestation.rootSha256,
    String(attestation.approvedCount), attestation.inventoryHash, attestation.capabilityStateHash,
    attestation.selectorVersion, attestation.policyVersion, attestation.attestedAt.toISOString(),
    ...inventory.map(readinessLine),
  ].join("\n"));
}
