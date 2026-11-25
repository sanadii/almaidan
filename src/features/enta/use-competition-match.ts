import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { EntaClientError, pendingStartStorageKey } from './client';
import { pollVisibleMatch } from './match-polling';
import { parseGrantMetadata } from './round-client';
import { CompetitionClientError, competitionEnvelope, competitionRequest, parseCompetitionMatch, type CompetitionCommand, type CompetitionMatch } from './competition-client';
import type { Issuance } from './use-round-match';
import { clearCompetitionCommand, readCompetitionCommand, saveCompetitionCommand, verifyCompetitionCommandReceipt, verifyCompetitionCommandRejection } from './competition-intent';
type Input<T> = T extends unknown ? Omit<T, 'commandId' | 'expectedVersion'> : never;
/** The engine answers a replayed command ID from its receipt before any phase
 * or rule check, so a plain 4xx domain rejection without proof material means
 * this exact command was not applied. Auth refresh, timeout and throttling
 * stay retryable; mismatched proof material is handled by the caller. */
export function definiteCompetitionRejection(error: unknown): boolean { return error instanceof CompetitionClientError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status) && error.commandReceipt === undefined && error.commandRejection === undefined; }
function parseIssuance(input: unknown): Issuance | null { if (input === undefined) return null; if (!input || typeof input !== 'object') throw new EntaClientError('MALFORMED_RESPONSE'); const r = input as Record<string, unknown>, { token, tokenUnavailable, ...meta } = r; parseGrantMetadata(meta); if (typeof tokenUnavailable !== 'boolean' || (tokenUnavailable ? token !== undefined : typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))) throw new EntaClientError('MALFORMED_RESPONSE'); return r as unknown as Issuance; }
export function useCompetitionMatch(user: User | null, id: string | undefined) {
  const key = `${pendingStartStorageKey(user?.uid ?? '')}:${id ?? ''}`, [state, setState] = useState<{ key: string; match: CompetitionMatch | null; loading: boolean; busy: boolean; uncertain: boolean; error: unknown; issuance: Issuance | null; privateEpoch: number }>({ key, match: null, loading: true, busy: false, uncertain: false, error: null, issuance: null, privateEpoch: 0 });
  const match = useRef<CompetitionMatch | null>(null), intent = useRef<CompetitionCommand | null>(null), unknown = useRef(false), epoch = useRef(0), poll = useRef<AbortController | null>(null), write = useRef<AbortController | null>(null), writing = useRef(false), rejected = useRef(false);
  const refresh = useCallback(async (controller = new AbortController()) => {
    if (!user || !id || intent.current || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return; const generation = epoch.current; poll.current?.abort(); poll.current = controller;
    try { const next = parseCompetitionMatch(await competitionRequest(`/matches/${id}`, { user }, controller.signal), id); if (generation !== epoch.current || controller.signal.aborted || intent.current || next.version < (match.current?.version ?? 0)) return; match.current = next; setState(s => ({ ...s, key, match: next, loading: false, error: rejected.current ? s.error : null })); }
    catch (error) { if (generation === epoch.current && !controller.signal.aborted && !intent.current) { const loss = error instanceof EntaClientError && [401, 403, 404].includes(error.status); if (loss) match.current = null; setState(s => ({ ...s, key, error, loading: false, ...(loss ? { match: null, issuance: null, privateEpoch: s.privateEpoch + 1 } : {}) })); } }
  }, [id, key, user]);
  useEffect(() => {
    epoch.current++; intent.current = null; unknown.current = false; rejected.current = false; match.current = null; writing.current = false;
    setState(s => ({ key, match: null, loading: true, busy: false, uncertain: false, error: null, issuance: null, privateEpoch: s.privateEpoch + 1 }));
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      setState(s => ({ ...s, loading: false, error: new EntaClientError('MATCH_NOT_FOUND', 404) }));
    } else {
      try {
        intent.current = user ? readCompetitionCommand(user.uid, id) : null;
        if (intent.current) { unknown.current = true; setState(s => ({ ...s, loading: false, uncertain: true })); }
      } catch (error) { unknown.current = true; setState(s => ({ ...s, loading: false, uncertain: true, error })); }
    }
    return () => { epoch.current++; poll.current?.abort(); write.current?.abort(); };
  }, [id, key, user]);
  const terminal = state.key === key && (state.match?.finished || (state.error instanceof EntaClientError && state.error.status === 404));
  useEffect(() => {
    if (user && id && !terminal) return pollVisibleMatch(refresh, 1500);
  }, [user, id, terminal, refresh]);
  const clearIssuance = useCallback(() => setState(s => s.issuance === null ? s : { ...s, issuance: null, privateEpoch: s.privateEpoch + 1 }), []);
  useEffect(() => { const issuance = state.issuance, current = state.match?.currentRound, grant = state.match?.grants.find(g => g.id === issuance?.id); if (!issuance) return; if (!state.match || !grant || grant.revoked || current?.id !== issuance.roundId || current.pause || current.resourceStop || current.publicRevealed || state.match.review || state.match.boardCorrectionRoundId || grant.generation !== issuance.generation) { clearIssuance(); return; } const remaining = issuance.expiresAt - state.match.serverNow; if (remaining <= 0) { clearIssuance(); return; } const timer = window.setTimeout(clearIssuance, remaining); return () => window.clearTimeout(timer); }, [state.issuance, state.match, clearIssuance]);
  const command = async (input?: Input<CompetitionCommand>) => {
    if (!user || !id || writing.current || !match.current && !intent.current) return;
    if (!intent.current) { if (!input || !match.current) return; const candidate = { ...input, commandId: crypto.randomUUID(), expectedVersion: match.current.version } as CompetitionCommand; try { saveCompetitionCommand(user.uid, id, candidate); intent.current = readCompetitionCommand(user.uid, id); } catch (error) { setState(s => ({ ...s, error, uncertain: true })); return; } }
    const submitted = intent.current!; const generation = epoch.current, controller = new AbortController(); writing.current = true; rejected.current = false; write.current = controller; poll.current?.abort(); setState(s => ({ ...s, busy: true, error: null, issuance: null }));
    try { const result = await competitionRequest(`/matches/${id}/commands`, { user }, controller.signal, submitted), next = competitionEnvelope(result, id), issuance = parseIssuance((result as { issuance?: unknown }).issuance); await verifyCompetitionCommandReceipt((result as { commandReceipt?: unknown }).commandReceipt, id, submitted, 'ACCEPTED'); if (generation !== epoch.current || controller.signal.aborted || intent.current !== submitted) return; clearCompetitionCommand(user.uid, id, intent.current); intent.current = null; unknown.current = false; writing.current = false; if (next.version >= (match.current?.version ?? 0)) match.current = next; setState(s => ({ key, match: match.current, loading: false, busy: false, uncertain: false, error: null, issuance, privateEpoch: s.privateEpoch + 1 })); }
    catch (error) { if (generation !== epoch.current || controller.signal.aborted) return; let provenAbsent = false, provenRejected = false; if (intent.current && error instanceof CompetitionClientError && error.commandReceipt !== undefined) { try { await verifyCompetitionCommandReceipt(error.commandReceipt, id, submitted, 'ABSENT'); provenAbsent = true; } catch { /* A malformed or mismatched proof cannot clear an unknown command. */ } } if (error instanceof CompetitionClientError && error.commandRejection !== undefined) { try { await verifyCompetitionCommandRejection(error.commandRejection, user.uid, id, submitted, error.code); provenRejected = true; } catch { /* Unsupported, changed or foreign rejection material stays unknown. */ } } if (generation !== epoch.current || controller.signal.aborted || intent.current !== submitted) return; writing.current = false; const definite = provenRejected || provenAbsent || definiteCompetitionRejection(error); rejected.current = definite; const loss = error instanceof EntaClientError && [401, 403, 404].includes(error.status); unknown.current = !definite; if (definite && intent.current) { clearCompetitionCommand(user.uid, id, intent.current); intent.current = null; } if (loss) match.current = null; setState(s => ({ ...s, busy: false, uncertain: !definite, error, issuance: null, privateEpoch: s.privateEpoch + 1, ...(loss ? { match: null } : {}) })); if (definite) void refresh(); }
  };
  return { ...(state.key === key ? state : { key, match: null, loading: true, busy: false, uncertain: false, error: null, issuance: null, privateEpoch: state.privateEpoch + 1 }), command, retry: () => { if (intent.current) { void command(); return; } rejected.current = false; void refresh(); }, clearIssuance };
}
