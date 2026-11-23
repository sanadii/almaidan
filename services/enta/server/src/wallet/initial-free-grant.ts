import type { Principal } from "../identity";

export interface InitialGrantTransaction {
  resolveIdentity(projectId: string, uid: string): Promise<{ id: string }>;
  lockWallet(identityId: string): Promise<void>;
  findFreeFirstGrant(identityId: string): Promise<{ walletId: string } | null>;
  postFixedFreeFirstGrant(identityId: string, originId: string): Promise<{ walletId: string }>;
}

export interface InitialGrantStore {
  transaction<T>(work: (tx: InitialGrantTransaction) => Promise<T>): Promise<T>;
}

/** Explicit invocation only; account registration never silently mints credit. */
export async function grantInitialFreeCredit(principal: Principal, store: InitialGrantStore): Promise<{ granted: boolean }> {
  if (!principal.projectId || !principal.uid || principal.anonymous || !principal.verifiedAccount || !principal.email) throw new Error("VERIFIED_ACCOUNT_REQUIRED");
  return store.transaction(async (tx) => {
    const identity = await tx.resolveIdentity(principal.projectId, principal.uid);
    await tx.lockWallet(identity.id);
    if (await tx.findFreeFirstGrant(identity.id)) return { granted: false };
    // The origin is derived by the server. Callers cannot mint a second origin.
    await tx.postFixedFreeFirstGrant(identity.id, identity.id);
    return { granted: true };
  });
}
