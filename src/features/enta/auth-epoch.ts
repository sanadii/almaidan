/** A lifecycle lease can only mutate the authority it currently owns.
 * Replacement providers permanently fence all old callbacks/actions. */
export interface ProviderLease { readonly token: symbol }
let active: ProviderLease | null = null;
let generation = 0;
let activeUid: string | null = null;
let ready = false;
const listeners = new Set<() => void>();
function publish(): void { generation++; for (const listener of [...listeners]) listener(); }
export function beginOwnerProvider(): ProviderLease {
  const lease = Object.freeze({ token: Symbol('owner-provider') });
  active = lease; activeUid = null; ready = false; publish(); return lease;
}
export function currentOwnerProvider(lease: ProviderLease): boolean { return active === lease; }
export function observeProviderOwner(lease: ProviderLease, uid: string | null): boolean {
  if (!currentOwnerProvider(lease)) return false;
  const changed = !ready || uid !== activeUid; activeUid = uid; ready = true;
  if (changed) publish(); return true;
}
export function invalidateProviderOwner(lease: ProviderLease): void {
  if (!currentOwnerProvider(lease)) return;
  activeUid = null; ready = false; publish();
}
export function endOwnerProvider(lease: ProviderLease): void {
  if (!currentOwnerProvider(lease)) return;
  active = null; activeUid = null; ready = false; publish();
}
/** Explicit test/reset boundary; provider code always uses its scoped lease. */
export function invalidateOwner(): void { active = null; activeUid = null; ready = false; publish(); }
export const ownerGeneration = (): number => generation;
export function subscribeOwnerGeneration(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export interface OwnerEpoch { uid: string; generation: number }
export function ownerEpoch(uid: unknown): OwnerEpoch {
  if (!active || !ready || typeof uid !== 'string' || !uid || uid !== activeUid) throw new DOMException('Identity changed', 'AbortError');
  return { uid, generation };
}
export function isOwnerEpoch(epoch: OwnerEpoch): boolean { return active !== null && ready && epoch.uid === activeUid && epoch.generation === generation; }
export function assertOwnerEpoch(epoch: OwnerEpoch, signal?: AbortSignal): void { if (signal?.aborted || !isOwnerEpoch(epoch)) throw new DOMException('Identity changed', 'AbortError'); }
