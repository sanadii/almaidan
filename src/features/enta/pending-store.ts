/** Pure storage state machine. No ambient storage and no cancellation API. */
export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type Occupancy<T> = { state: 'EMPTY' } | { state: 'VALID'; raw: string; intent: T } | { state: 'INVALID_OCCUPIED'; reason: 'OVERSIZE' | 'UNREADABLE' } | { state: 'STORAGE_UNAVAILABLE' };
export class PendingError extends Error { constructor(readonly code: string) { super(code); } }
export function inspectPending<T>(storage: StoragePort, key: string, parse: (value: unknown) => T, max = 16000): Occupancy<T> {
  let raw: string | null; try { raw = storage.getItem(key); } catch { return { state: 'STORAGE_UNAVAILABLE' }; }
  if (raw === null) return { state: 'EMPTY' };
  if (raw.length > max) return { state: 'INVALID_OCCUPIED', reason: 'OVERSIZE' };
  try { return { state: 'VALID', raw, intent: parse(JSON.parse(raw)) }; } catch { return { state: 'INVALID_OCCUPIED', reason: 'UNREADABLE' }; }
}
export function requireReadable<T>(state: Occupancy<T>): T | null {
  if (state.state === 'INVALID_OCCUPIED') throw new PendingError('PENDING_INTENT_UNREADABLE_OCCUPIED');
  if (state.state === 'STORAGE_UNAVAILABLE') throw new PendingError('PENDING_INTENT_STORAGE_UNAVAILABLE');
  return state.state === 'VALID' ? state.intent : null;
}
export function savePending<T>(storage: StoragePort, key: string, intent: T, parse: (v: unknown) => T, serialize: (v: T) => string, max = 16000): void {
  const next = serialize(intent); if (next.length > max) throw new PendingError('PENDING_INTENT_TOO_LARGE');
  const validated = parse(JSON.parse(next)); if (serialize(validated) !== next) throw new PendingError('PENDING_INTENT_INVALID');
  const state = inspectPending(storage, key, parse, max), existing = requireReadable(state);
  if (existing !== null) { if (serialize(existing) !== next) throw new PendingError('PENDING_START_OCCUPIED'); return; }
  try { storage.setItem(key, next); } catch { throw new PendingError('PENDING_INTENT_STORAGE_UNAVAILABLE'); }
  // A failed readback leaves uncertain occupied bytes; never delete/replace.
  try { if (storage.getItem(key) !== next) throw new Error(); } catch { throw new PendingError('PENDING_INTENT_STORAGE_UNAVAILABLE'); }
}
export function clearKnownCommit<T>(storage: StoragePort, key: string, intent: T, parse: (v: unknown) => T, serialize: (v: T) => string, logicalId: (v: T) => string, committedGameId: string, currentOwner: () => boolean, max = 16000): void {
  if (!currentOwner() || committedGameId !== logicalId(intent)) throw new PendingError('PENDING_COMMIT_MISMATCH');
  const state = inspectPending(storage, key, parse, max), current = requireReadable(state);
  if (state.state !== 'VALID' || current === null || serialize(current) !== serialize(intent)) throw new PendingError('PENDING_COMMIT_MISMATCH');
  try {
    // Synchronous compare-and-clear in this session; no await permits an auth
    // transition between epoch validation, byte comparison and removal.
    if (!currentOwner() || storage.getItem(key) !== state.raw) throw new PendingError('PENDING_COMMIT_MISMATCH');
    storage.removeItem(key);
  } catch (error) { if (error instanceof PendingError) throw error; throw new PendingError('PENDING_INTENT_STORAGE_UNAVAILABLE'); }
}
