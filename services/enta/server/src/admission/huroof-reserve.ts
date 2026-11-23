import { randomUUID } from "node:crypto";
import type { Principal } from "../identity.js";
import { admissionHash, assertBinding, assertHostedConfig, materialRoomConfig, type HuroofBinding } from "./huroof-protocol.cjs";

export interface HuroofReserveCommand {
  requestKey: string;
  logicalMatchId: string;
  config: Record<string, unknown>;
  predecessorId?: string;
}
export interface HuroofReadiness {
  catalogReleaseId: string; catalogRootHash: string; validationReceiptId: string;
  releaseId: string; releaseRootHash: string; selectorVersion: string;
  readinessPolicyVersion: string; capabilityHash: string;
}
export interface HuroofReserveTransaction {
  lockWallet(projectId: string, uid: string): Promise<{ identityId: string; available: bigint; debt: bigint }>;
  findRequest(identityId: string, requestKey: string): Promise<{ binding: HuroofBinding; intentHash: string } | null>;
  findLogicalMatch(identityId: string, logicalMatchId: string): Promise<boolean>;
  assertPredecessor(identityId: string, predecessorId: string): Promise<void>;
  readReadiness(config: Record<string, unknown>): Promise<HuroofReadiness>;
  reserve(binding: HuroofBinding, intentHash: string, config: Record<string, unknown>): Promise<void>;
}
export interface HuroofReserveStore {
  transaction<T>(work: (tx: HuroofReserveTransaction) => Promise<T>): Promise<T>;
}

/** Unmounted. Principal comes from the same-origin API's current Admin-backed verifier. */
export async function reserveHuroofMatch(store: HuroofReserveStore, principal: Principal, command: HuroofReserveCommand): Promise<{ binding: HuroofBinding; replayed: boolean }> {
  return reserveWithPolicy(store, principal, command, async () => { throw new Error("HUROOF_READINESS_POLICY_UNAPPROVED"); });
}

/** Explicit synthetic seam, forbidden in deployment; never mounted by app.ts. */
export async function reserveHuroofMatchForTest(store: HuroofReserveStore, principal: Principal, command: HuroofReserveCommand, assertReadiness: (pins: HuroofReadiness, config: Record<string, unknown>) => Promise<void>): Promise<{ binding: HuroofBinding; replayed: boolean }> {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("TEST_READINESS_FORBIDDEN_IN_DEPLOYMENT");
  return reserveWithPolicy(store, principal, command, assertReadiness);
}

async function reserveWithPolicy(store: HuroofReserveStore, principal: Principal, command: HuroofReserveCommand, assertReadiness: (pins: HuroofReadiness, config: Record<string, unknown>) => Promise<void>): Promise<{ binding: HuroofBinding; replayed: boolean }> {
  if (!principal.verifiedAccount || principal.anonymous || !principal.email || !principal.projectId || !principal.uid) throw new Error("VERIFIED_ACCOUNT_REQUIRED");
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(command.requestKey) || !/^[A-Za-z0-9._:-]{1,200}$/u.test(command.logicalMatchId) ||
      !command.config || command.config.demo !== false || command.config.releaseDemoFixture !== false || command.config.qaAdmission !== undefined ||
      command.config.paidAdmission !== undefined) throw new Error("INVALID_HOSTED_INTENT");
  const config = materialRoomConfig(command.config);
  assertHostedConfig(config);
  const intentHash = admissionHash({ engine: "HUROOF", operation: "HOSTED_HUROOF", logicalMatchId: command.logicalMatchId, config, predecessorId: command.predecessorId ?? null });
  const requestHash = admissionHash({ version: 1, requestKey: command.requestKey, intentHash });
  return store.transaction(async (tx) => {
    const wallet = await tx.lockWallet(principal.projectId, principal.uid);
    const retry = await tx.findRequest(wallet.identityId, command.requestKey);
    if (retry) {
      if (retry.intentHash !== intentHash || retry.binding.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      assertBinding(retry.binding);
      if (retry.binding.projectId !== principal.projectId || retry.binding.uid !== principal.uid || retry.binding.identityId !== wallet.identityId) throw new Error("ADMISSION_OWNER_MISMATCH");
      return { binding: retry.binding, replayed: true };
    }
    if (await tx.findLogicalMatch(wallet.identityId, command.logicalMatchId)) throw new Error("LOGICAL_MATCH_ALREADY_RESERVED");
    if (wallet.debt > 0n) throw new Error("WALLET_DEBT_BLOCKS_START");
    if (wallet.available < 1n) throw new Error("INSUFFICIENT_CREDIT");
    if (command.predecessorId) await tx.assertPredecessor(wallet.identityId, command.predecessorId);
    // The server selects and verifies immutable readiness. There is no client policy override.
    const pins = await tx.readReadiness(config);
    await assertReadiness(pins, config);
    if (config.releaseId !== pins.releaseId || config.releaseRootSha256 !== pins.releaseRootHash) throw new Error("READINESS_PIN_MISMATCH");
    const binding: HuroofBinding = {
      version: 1, admissionId: randomUUID(), roomId: randomUUID(), identityId: wallet.identityId,
      projectId: principal.projectId, uid: principal.uid, engine: "HUROOF", operation: "HOSTED_HUROOF",
      logicalMatchId: command.logicalMatchId, requestKey: command.requestKey, requestHash,
      ...pins, configHash: admissionHash(config), predecessorId: command.predecessorId ?? null,
    };
    assertBinding(binding);
    await tx.reserve(binding, intentHash, config);
    return { binding, replayed: false };
  });
}
