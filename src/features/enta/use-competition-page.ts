import { useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { EntaClientError } from './client';
import { competitionRequest } from './competition-client';
import { parseCompetitionPage, type ClientPage, type ClientPageRequest, type PageCollection } from './competition-page-client';
export interface SnapshotVerdict { id: string; correct: boolean }
/** A complete compact verdict snapshot plus one visible row page. Pages and
 * private data are memory only and fenced by principal/project/revision. */
export function useCompetitionPage<T>(input: { user: User | null; token?: string; authorityKey?: string; purpose?: 'OWNER' | 'JUDGE' | 'ACTOR'; gameId: string | null; version: number; collection: PageCollection; roundId: string | null; effectId: string | null; enabled: boolean; parseRow: (input: unknown) => T; assemble?: (row: T) => SnapshotVerdict | null; assemblyKey?: string; privateEpoch?: number }) {
  const { user, token, authorityKey, purpose = 'OWNER', gameId, version, collection, roundId, effectId, enabled, parseRow, assemble, assemblyKey, privateEpoch } = input;
  const key = JSON.stringify([import.meta.env.VITE_FIREBASE_PROJECT_ID, user?.uid, authorityKey, purpose, gameId, version, collection, roundId, effectId, enabled, assemblyKey, privateEpoch]);
  const [state, setState] = useState<{ key: string; page: ClientPage<T> | null; verdicts: SnapshotVerdict[]; ready: boolean; loading: boolean; error: unknown }>({ key, page: null, verdicts: [], ready: false, loading: false, error: null });
  const fence = useRef(0), cursors = useRef<(string | null)[]>([null]), controller = useRef<AbortController | null>(null), parsers = useRef({ parseRow, assemble }); parsers.current = { parseRow, assemble };
  async function load(cursor: string | null, scan: boolean) {
    if (Boolean(user) === Boolean(token) || !gameId || !enabled) return; const generation = ++fence.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setState(s => ({ ...s, key, loading: true, error: null, ...(scan ? { page: null, verdicts: [], ready: false } : {}) }));
    try {
      let next = cursor, first: ClientPage<T> | null = null, offset = 0, snapshot: string | null = null, total: number | null = null, selectedProof: string | null = null; const verdicts: SnapshotVerdict[] = [], seen = new Set<string>(), selectors: (string | null)[] = [cursor];
      do {
        const request: ClientPageRequest = { collection, roundId, effectId, snapshot: version, cursor: next };
        const result = parseCompetitionPage(await competitionRequest(token ? '/capability/pages' : `/matches/${gameId}/pages`, token ? { token } : { user: user! }, abort.signal, request), gameId, request, parsers.current.parseRow, purpose);
        if (abort.signal.aborted || generation !== fence.current) return;
        if (snapshot !== null && (result.snapshot !== snapshot || result.total !== total) || scan && result.offset !== offset) throw new EntaClientError('PAGE_SNAPSHOT_RESTART', 409);
        snapshot = result.snapshot; total = result.total; first ??= result;
        if (scan && parsers.current.assemble) for (const row of result.rows) { const material = row as { id: string; effectId?: string; effectHash?: string; rulingVersion?: number; reversed?: boolean; effectKind?: string }; if (seen.has(material.id) || seen.size >= 512) throw new EntaClientError('MALFORMED_RESPONSE'); seen.add(material.id); if (collection === 'correction') { const proof = JSON.stringify([material.effectId, material.effectHash, material.rulingVersion, material.reversed, material.effectKind]); if (selectedProof !== null && proof !== selectedProof) throw new EntaClientError('PAGE_SNAPSHOT_RESTART', 409); selectedProof = proof; } const verdict = parsers.current.assemble(row); if (verdict) verdicts.push(verdict); }
        offset = result.offset + result.returned; next = result.nextCursor; if (next) selectors.push(next);
        if (!scan || !parsers.current.assemble) break;
      } while (next !== null);
      if (scan) cursors.current = parsers.current.assemble ? selectors : [cursor];
      setState(s => generation !== fence.current ? s : ({ key, page: first, verdicts: scan ? verdicts : s.verdicts, ready: true, loading: false, error: null }));
    } catch (error) { if (!abort.signal.aborted && generation === fence.current) setState({ key, page: null, verdicts: [], ready: false, loading: false, error }); }
  }
  useEffect(() => { fence.current++; controller.current?.abort(); cursors.current = [null]; setState({ key, page: null, verdicts: [], ready: false, loading: false, error: null }); if (enabled) void load(null, true); return () => { fence.current++; controller.current?.abort(); }; }, [key, token]); // key contains every authority and snapshot boundary; raw token is never stored
  const current = state.key === key ? state : { key, page: null, verdicts: [], ready: false, loading: false, error: null };
  return { ...current, pages: cursors.current.length, loadPage: (index: number) => { const cursor = cursors.current[index]; if (cursor !== undefined) void load(cursor, false); }, next: () => current.page?.nextCursor ? void load(current.page.nextCursor, false) : undefined, retry: () => void load(null, true) };
}
