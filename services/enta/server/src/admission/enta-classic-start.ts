import { productionReceiptPolicy, type ReceiptPolicyInput, type ReceiptPolicyVerifier } from "../wallet/financial-policy";
import type { Principal } from "../identity";
import { createHash } from "node:crypto";

export interface EntaClassicStartCommand {
  requestKey: string;
  logicalMatchId: string;
  categoryKeys: readonly string[];
}

interface PreparedEntaClassicStart extends EntaClassicStartCommand {
  engine: "ENTA";
  operation: "PAID_ENTA_CLASSIC";
  mode: "CLASSIC";
  requestVersion: 1;
  requestHash: string;
  intentHash: string;
}

export interface StoredAdmission {
  requestKey: string;
  requestHash: string;
  intentHash: string;
  logicalMatchId: string;
  gameId: string;
}

export interface EntaClassicStartTransaction {
  resolveIdentity(projectId: string, firebaseUid: string): Promise<{ id: string }>;
  lockWallet(identityId: string): Promise<{ available: bigint; held: bigint; debt: bigint }>;
  findByRequestKey(identityId: string, requestKey: string): Promise<StoredAdmission | null>;
  findByLogicalMatch(identityId: string, logicalMatchId: string): Promise<StoredAdmission | null>;
  readActiveReceipt(): Promise<ReceiptPolicyInput>;
  reserve(identityId: string, command: PreparedEntaClassicStart, receipt: ReceiptPolicyInput): Promise<{ admissionId: string }>;
  createPinnedGame(admissionId: string, command: PreparedEntaClassicStart, receipt: ReceiptPolicyInput): Promise<{ gameId: string }>;
  commitReservation(admissionId: string, gameId: string): Promise<void>;
}

export interface EntaClassicStartStore {
  transaction<T>(work: (tx: EntaClassicStartTransaction) => Promise<T>): Promise<T>;
}

/**
 * Production composition is pinned to the reviewed fail-closed verifier. A
 * caller cannot provide a policy object that merely claims to be production.
 */
export async function startEntaClassicPaidMatch(
  store: EntaClassicStartStore,
  principal: Principal,
  command: EntaClassicStartCommand,
): Promise<{ gameId: string; idempotent: boolean }> {
  return startWithReceiptPolicy(store, productionReceiptPolicy, principal, command);
}

/** Explicit synthetic-test seam. It is not used by application composition. */
export async function startEntaClassicPaidMatchForTest(
  store: EntaClassicStartStore,
  policy: ReceiptPolicyVerifier,
  principal: Principal,
  command: EntaClassicStartCommand,
): Promise<{ gameId: string; idempotent: boolean }> {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    throw new Error("TEST_RECEIPT_POLICY_FORBIDDEN_IN_DEPLOYMENT");
  }
  if (policy.source !== "test-only") throw new Error("TEST_RECEIPT_POLICY_REQUIRED");
  return startWithReceiptPolicy(store, policy, principal, command);
}

async function startWithReceiptPolicy(
  store: EntaClassicStartStore,
  policy: ReceiptPolicyVerifier,
  principal: Principal,
  command: EntaClassicStartCommand,
): Promise<{ gameId: string; idempotent: boolean }> {
  if (!principal.projectId || !principal.uid || principal.anonymous || !principal.verifiedAccount || !principal.email) {
    throw new Error("VERIFIED_ACCOUNT_REQUIRED");
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(command.requestKey) || !/^[A-Za-z0-9._:-]{1,200}$/u.test(command.logicalMatchId) ||
      command.categoryKeys.length === 0 ||
      command.categoryKeys.length > 32 || command.categoryKeys.some((key) => !/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(key)) ||
      new Set(command.categoryKeys).size !== command.categoryKeys.length) {
    throw new Error("INVALID_START_INTENT");
  }
  const categories = [...command.categoryKeys];
  const intent = { engine: "ENTA", operation: "PAID_ENTA_CLASSIC", mode: "CLASSIC", logicalMatchId: command.logicalMatchId, categoryKeys: categories };
  const request = { version: 1, requestKey: command.requestKey, ...intent };
  const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
  const prepared: PreparedEntaClassicStart = {
    ...command,
    categoryKeys: categories,
    engine: "ENTA",
    operation: "PAID_ENTA_CLASSIC",
    mode: "CLASSIC",
    requestVersion: 1,
    requestHash: sha256(request),
    intentHash: sha256(intent),
  };
  return store.transaction(async (tx) => {
    // Wallet lock is first, including retries, and serializes unique-key races.
    const identity = await tx.resolveIdentity(principal.projectId, principal.uid);
    const wallet = await tx.lockWallet(identity.id);

    // Resolve an identical retry before reading a possibly rotated pointer.
    const existingRequest = await tx.findByRequestKey(identity.id, prepared.requestKey);
    if (existingRequest) {
      if (existingRequest.intentHash !== prepared.intentHash || existingRequest.requestHash !== prepared.requestHash) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      return { gameId: existingRequest.gameId, idempotent: true };
    }
    if (await tx.findByLogicalMatch(identity.id, command.logicalMatchId)) throw new Error("LOGICAL_MATCH_ALREADY_CHARGED");
    if (wallet.debt > 0n) throw new Error("WALLET_DEBT_BLOCKS_START");
    if (wallet.available < 1n) throw new Error("INSUFFICIENT_CREDIT");

    const receipt = await tx.readActiveReceipt();
    if (receipt.projectId !== principal.projectId || receipt.identityId !== identity.id || receipt.mode !== "CLASSIC") {
      throw new Error("CATALOG_RECEIPT_BINDING_MISMATCH");
    }
    await policy.assertEligible(receipt);

    // Fixed server operation: request fields never select STUDENT/free mode.
    const { admissionId } = await tx.reserve(identity.id, prepared, receipt);
    const { gameId } = await tx.createPinnedGame(admissionId, prepared, receipt);
    await tx.commitReservation(admissionId, gameId);
    return { gameId, idempotent: false };
  });
}
