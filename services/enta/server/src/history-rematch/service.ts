import { contextValue, deny, E3Error } from './core';
import { advance, authenticate, issue, requireActiveKey, type CursorContext, type Keyring } from './cursor';
import { parsePage, parseQuery, type HistoryRow } from './dto';
import { readOwnedHistoryPage, type OneStatementOwnedHistorySource } from './reader';

/** Auth middleware supplies these independently of the untrusted query. */
export interface TrustedHistoryOwnerContext {
  readonly cursor: CursorContext;
  readonly authenticatedOwner: { readonly uid: string; readonly namespaceId: string; readonly projectId: string };
  readonly session: { readonly uid: string; readonly namespaceId: string; readonly projectId: string; readonly ownerUid: string };
}
export interface HistoryRematchDependencies {
  readonly owner: TrustedHistoryOwnerContext | null;
  readonly source: OneStatementOwnedHistorySource | null;
  readonly keyring: Keyring | null;
  readonly now: () => number;
}
export interface HistoryRematchPage {
  readonly registryVersion: 1;
  readonly queryVersion: 2;
  readonly matches: readonly HistoryRow[];
  readonly nextCursor: string | null;
}
function requireOwner(value: TrustedHistoryOwnerContext | null): CursorContext {
  if (!value) return deny('HISTORY_UNAVAILABLE', 503);
  const c = value.cursor, a = value.authenticatedOwner, s = value.session;
  if (!c || !a || !s) return deny('HISTORY_UNAVAILABLE', 503);
  try {
    // Validate every trusted copy before query parsing or a possible source call.
    contextValue(c.namespaceId); contextValue(c.projectId); contextValue(c.uid);
    contextValue(a.uid); contextValue(a.namespaceId); contextValue(a.projectId);
    contextValue(s.uid); contextValue(s.ownerUid); contextValue(s.namespaceId); contextValue(s.projectId);
  } catch { return deny('HISTORY_UNAVAILABLE', 503); }
  if (
      a.uid !== c.uid || a.namespaceId !== c.namespaceId || a.projectId !== c.projectId ||
      s.uid !== c.uid || s.ownerUid !== c.uid || s.namespaceId !== c.namespaceId || s.projectId !== c.projectId) {
    return deny('HISTORY_UNAVAILABLE', 503);
  }
  return c;
}
function boundedNow(now: () => number): number {
  try { const value = now(); if (!Number.isSafeInteger(value) || value < 0) return deny('HISTORY_UNAVAILABLE',503); return value; }
  catch { return deny('HISTORY_UNAVAILABLE',503); }
}
/** Conditional private source chain. Not mounted and not a database adapter. */
export async function readHistoryRematchPage(queryInput: Record<string, unknown>, deps: HistoryRematchDependencies): Promise<HistoryRematchPage> {
  const context = requireOwner(deps.owner);
  if (!deps.source) return deny('HISTORY_UNAVAILABLE',503);
  const query = parseQuery(queryInput);
  const now = boundedNow(deps.now);
  let cursor = null as ReturnType<typeof authenticate> | null;
  if (query.cursor !== null) cursor = authenticate(query.cursor, context, deps.keyring, now, query.filters, query.limit);
  else requireActiveKey(deps.keyring, now);
  const window = { context, filters: query.filters, limit: query.limit, upper: cursor?.upper ?? null, before: cursor?.before ?? null };
  let page;
  try { page = await readOwnedHistoryPage(deps.source, window); }
  catch (error) { if (error instanceof E3Error && error.code === 'INVALID_CURSOR') return deny('INVALID_CURSOR'); return deny('HISTORY_DATA_UNAVAILABLE',503); }
  // Re-read time after awaited source work; never issue or advance a stale cursor.
  const finishedAt = boundedNow(deps.now);
  // A continuation can expire or its verification key can retire while the
  // database call is in flight, including when it returns the final page.
  if (cursor && query.cursor !== null) authenticate(query.cursor, context, deps.keyring, finishedAt, query.filters, query.limit);
  let nextCursor: string | null = null;
  if (page.hasMore) {
    if (!page.nextBefore || !page.upper) return deny('HISTORY_DATA_UNAVAILABLE',503);
    if (cursor) {
      nextCursor = advance(cursor, page.nextBefore, context, deps.keyring!, finishedAt);
    } else {
      nextCursor = issue(context, deps.keyring, finishedAt, query.filters, query.limit, page.upper, page.nextBefore);
    }
  }
  const result = { registryVersion: 1 as const, queryVersion: 2 as const, matches: [...page.matches], nextCursor };
  return parsePage(result, query.limit, query.filters);
}
