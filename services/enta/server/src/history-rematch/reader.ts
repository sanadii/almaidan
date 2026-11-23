/** INERT UTC04 typed reader candidate; not mounted or connected to a database. */
import { deny, integer } from './core';
import { compareAnchor, type Anchor, type CursorContext, type Filters } from './cursor';
import { projectPageRows, type HistoryRow } from './dto';

/** Produced only after trusted auth context, parseQuery and cursor MAC checks. */
export interface AuthenticatedHistoryWindow {
  readonly context: CursorContext;
  readonly filters: Filters;
  readonly limit: number;
  /** Signed upper tuple for continuation, null only on first page. */
  readonly upper: Anchor | null;
  /** Signed before tuple for continuation, null only on first page. */
  readonly before: Anchor | null;
}

/** One DB statement returns either this exact envelope or a fixed fault. */
export type OneStatementEnvelope =
  | { readonly outcome: 'OK'; readonly upper: Anchor | null; readonly resolvedUpper: Anchor | null; readonly resolvedBefore: Anchor | null; readonly rows: readonly unknown[]; readonly anchorRows: readonly { readonly kind: 'upper' | 'before'; readonly row: unknown }[] }
  | { readonly outcome: 'INVALID_ANCHOR' }
  | { readonly outcome: 'DATA_UNAVAILABLE' };

/** The entire persistence capability: there is no Wallet/catalog/Exposure API. */
export interface OneStatementOwnedHistorySource {
  readOneSnapshot(window: AuthenticatedHistoryWindow): Promise<OneStatementEnvelope>;
}

export interface OwnedHistoryPage {
  readonly matches: readonly HistoryRow[];
  readonly upper: Anchor | null;
  readonly hasMore: boolean;
  /** Cursor issuer consumes this last-emitted tuple iff hasMore. */
  readonly nextBefore: Anchor | null;
}

/**
 * Maps one private SQL envelope to exactly the safe metadata DTO consumed by
 * projectPageRows. The SQL envelope must contain no source/internal columns.
 */
export async function readOwnedHistoryPage(
  source: OneStatementOwnedHistorySource,
  window: AuthenticatedHistoryWindow,
): Promise<OwnedHistoryPage> {
  integer(window.limit, 1, 50);
  if ((window.upper === null) !== (window.before === null)) deny('INVALID_CURSOR');
  const envelope = await source.readOneSnapshot(window);
  if (envelope.outcome === 'INVALID_ANCHOR') return deny('INVALID_CURSOR');
  if (envelope.outcome !== 'OK') return deny('HISTORY_DATA_UNAVAILABLE', 503);
  if ((window.upper === null) !== (envelope.resolvedUpper === null)
      || (window.before === null) !== (envelope.resolvedBefore === null)
      || (window.upper && (!envelope.resolvedUpper || compareAnchor(envelope.resolvedUpper, window.upper) !== 0))
      || (window.before && (!envelope.resolvedBefore || compareAnchor(envelope.resolvedBefore, window.before) !== 0))) {
    return deny('INVALID_CURSOR');
  }
  if (window.upper && (!envelope.upper || compareAnchor(envelope.upper, window.upper) !== 0)) return deny('HISTORY_DATA_UNAVAILABLE', 503);
  if (!Array.isArray(envelope.rows) || !Array.isArray(envelope.anchorRows) || envelope.anchorRows.length > 2
      || envelope.rows.length > window.limit + 1
      || envelope.rows.length + envelope.anchorRows.length > window.limit + 3) {
    return deny('HISTORY_DATA_UNAVAILABLE', 503);
  }
  // The private SQL envelope returns safe metadata for bounded anchors too.
  // Validate via the exact DTO mapper with only the mutable status row filter
  // removed; anchor identity must remain status-neutral.
  const expectedAnchors: readonly ('upper' | 'before')[] = [
    ...(envelope.upper ? ['upper' as const] : []),
    ...(window.before ? ['before' as const] : []),
  ];
  if (envelope.anchorRows.length !== expectedAnchors.length) return deny('HISTORY_DATA_UNAVAILABLE', 503);
  for (let i = 0; i < expectedAnchors.length; i += 1) {
    const item = envelope.anchorRows[i];
    if (!item || item.kind !== expectedAnchors[i]) return deny('HISTORY_DATA_UNAVAILABLE', 503);
    const expected = item.kind === 'upper' ? envelope.upper : window.before;
    if (!expected) return deny('HISTORY_DATA_UNAVAILABLE', 503);
    const validated = projectPageRows([item.row], { ...window.filters, status: null }, 1, expected, null).matches[0];
    if (!validated || compareAnchor({ createdAt: validated.createdAt, id: validated.id }, expected) !== 0) {
      return deny('HISTORY_DATA_UNAVAILABLE', 503);
    }
  }
  const page = projectPageRows([...envelope.rows], window.filters, window.limit, envelope.upper, window.before);
  return { matches: page.matches, upper: envelope.upper, hasMore: page.hasMore, nextBefore: page.hasMore ? page.before : null };
}
