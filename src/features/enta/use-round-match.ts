import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { EntaClientError } from './client';
import { parseGrantMetadata, parseRoundMatch, roundEnvelope, roundRequest, type GrantCommand, type HostCommand, type RoundMatch } from './round-client';
type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'commandId' | 'expectedVersion'> : never;
type CommandInput = WithoutEnvelope<HostCommand> | WithoutEnvelope<GrantCommand>;
export type Issuance = { id: string; scopeId: string; roundId: string; role: 'JUDGE' | 'ACTOR'; generation: number; expiresAt: number; revoked: boolean; tokenUnavailable: boolean; token?: string };
function issuance(input: unknown): Issuance | null {
  if (input === undefined) return null; if (!input || typeof input !== 'object') throw new EntaClientError('MALFORMED_RESPONSE');
  const row = input as Record<string, unknown>, { token, tokenUnavailable, ...meta } = row; parseGrantMetadata(meta);
  if (typeof tokenUnavailable !== 'boolean' || (tokenUnavailable ? token !== undefined : typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token))) throw new EntaClientError('MALFORMED_RESPONSE');
  return row as unknown as Issuance;
}
export function useRoundMatch(user: User | null, id: string | undefined) {
  const key = `${user?.uid ?? ''}:${id ?? ''}`, [state, setState] = useState<{ key: string; match: RoundMatch | null; error: unknown; loading: boolean; busy: boolean; uncertain: boolean; issuance: Issuance | null }>({ key, match: null, error: null, loading: true, busy: false, uncertain: false, issuance: null });
  const match = useRef<RoundMatch | null>(null), pending = useRef<{ endpoint: string; body: HostCommand | GrantCommand } | null>(null), epoch = useRef(0), request = useRef<AbortController | null>(null), poll = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!user || !id || pending.current) return;
    const generation = epoch.current, controller = new AbortController(); poll.current?.abort(); poll.current = controller;
    try { const next = parseRoundMatch(await roundRequest(`/round-matches/${id}`, user, controller.signal), id); if (generation !== epoch.current || controller.signal.aborted || pending.current || next.version < (match.current?.version ?? 0)) return; match.current = next; setState(previous => ({ ...previous, key, match: next, loading: false, error: null })); }
    catch (error) { if (generation === epoch.current && !controller.signal.aborted && !pending.current) setState(previous => ({ ...previous, key, error, loading: false })); }
  }, [id, key, user]);
  useEffect(() => { epoch.current++; pending.current = null; match.current = null; setState({ key, match: null, error: null, loading: true, busy: false, uncertain: false, issuance: null }); void refresh(); const timer = window.setInterval(() => void refresh(), 2000); return () => { epoch.current++; window.clearInterval(timer); request.current?.abort(); poll.current?.abort(); }; }, [key, refresh]);
  const mutate = async (input?: CommandInput) => {
    if (!user || !id || !match.current || (state.key === key && state.busy)) return;
    if (!pending.current) {
      if (!input) return; const body = { ...input, commandId: crypto.randomUUID(), expectedVersion: match.current.version } as HostCommand | GrantCommand;
      pending.current = { endpoint: `/round-matches/${id}/${['CREATE_GRANT', 'ROTATE_GRANT', 'REVOKE_GRANT'].includes(input.type) ? 'grants' : 'commands'}`, body };
    }
    const generation = epoch.current, controller = new AbortController(), priorUncertain = state.uncertain; request.current = controller; poll.current?.abort(); setState(previous => ({ ...previous, busy: true, error: null, issuance: null }));
    try { const data = await roundRequest(pending.current.endpoint, user, controller.signal, pending.current.body); const next = roundEnvelope(data), issued = issuance((data as { issuance?: unknown }).issuance); if (next.id !== id) throw new EntaClientError('MALFORMED_RESPONSE'); if (generation !== epoch.current || controller.signal.aborted) return; pending.current = null; if (next.version >= (match.current?.version ?? 0)) match.current = next; setState({ key, match: match.current, loading: false, busy: false, uncertain: false, error: null, issuance: issued }); }
    catch (error) { if (generation !== epoch.current || controller.signal.aborted) return; const definite = !priorUncertain && error instanceof EntaClientError && error.status >= 400 && error.status < 500 && error.code !== 'COMMAND_KEY_CONFLICT'; if (definite) pending.current = null; setState(previous => ({ ...previous, busy: false, uncertain: !definite, error })); if (definite) void refresh(); }
  };
  return { ...(state.key === key ? state : { key, match: null, loading: true, busy: false, uncertain: false, error: null, issuance: null }), command: mutate, retry: () => pending.current ? void mutate() : void refresh(), clearIssuance: () => setState(previous => ({ ...previous, issuance: null })) };
}
