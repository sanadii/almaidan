import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { EntaClientError, matchEnvelope, requestEnta, type MatchCommand, type MatchProjection } from './client';

type Action = Omit<Extract<MatchCommand, { type: 'OPEN_QUESTION' }>, 'commandId' | 'expectedVersion'> | Omit<Extract<MatchCommand, { type: 'REVEAL_ANSWER' }>, 'commandId' | 'expectedVersion'> | Omit<Extract<MatchCommand, { type: 'ADJUDICATE' }>, 'commandId' | 'expectedVersion'> | Omit<Extract<MatchCommand, { type: 'FINISH' }>, 'commandId' | 'expectedVersion'>;
export function useEntaMatch(user: User | null, gameId: string | undefined) {
  const key = `${user?.uid ?? ''}:${gameId ?? ''}`;
  const epoch = useRef(0), pending = useRef<MatchCommand | null>(null), mutationAbort = useRef<AbortController | null>(null);
  const [data, setData] = useState<{ key: string; match: MatchProjection | null; error: unknown; loading: boolean; busy: boolean }>({ key, match: null, error: null, loading: true, busy: false });
  const apply = useCallback((match: MatchProjection, generation: number) => {
    if (epoch.current !== generation) return;
    setData(previous => ({ key, match: previous.key === key && previous.match && previous.match.version > match.version ? previous.match : match, error: null, loading: false, busy: false }));
  }, [key]);
  const load = useCallback(async (signal: AbortSignal, generation: number) => {
    if (!user || !gameId) return;
    try { const match = matchEnvelope(await requestEnta(`/matches/${encodeURIComponent(gameId)}`, user, signal), gameId); if (!pending.current && !signal.aborted) apply(match, generation); }
    catch (error) { if (epoch.current === generation && !signal.aborted && !pending.current) setData(previous => ({ ...previous, key, error, loading: false })); }
  }, [apply, gameId, key, user]);
  useEffect(() => {
    const generation = ++epoch.current;
    pending.current = null; mutationAbort.current?.abort(); setData({ key, match: null, error: null, loading: true, busy: false });
    let current: AbortController | null = null;
    const poll = () => { if (pending.current) return; current?.abort(); current = new AbortController(); void load(current.signal, generation); };
    if (user && gameId) poll();
    const interval = window.setInterval(poll, 2000);
    return () => { epoch.current++; current?.abort(); mutationAbort.current?.abort(); window.clearInterval(interval); };
  }, [gameId, key, load, user]);
  const current = data.key === key ? data : { key, match: null, error: null, loading: true, busy: false };
  const command = async (action?: Action) => {
    if (!user || !gameId || !current.match || current.busy) return;
    const generation = epoch.current;
    const intent = pending.current ?? ({ ...action, commandId: crypto.randomUUID(), expectedVersion: current.match.version } as MatchCommand);
    pending.current = intent; mutationAbort.current?.abort(); const controller = new AbortController(); mutationAbort.current = controller;
    setData(previous => ({ ...previous, busy: true, error: null }));
    try {
      const match = matchEnvelope(await requestEnta(`/matches/${encodeURIComponent(gameId)}/commands`, user, controller.signal, intent), gameId);
      if (epoch.current !== generation || controller.signal.aborted) return;
      pending.current = null; apply(match, generation);
    } catch (error) {
      if (epoch.current !== generation || controller.signal.aborted) return;
      const definite = error instanceof EntaClientError && error.status >= 400 && error.status < 500;
      if (definite) pending.current = null;
      setData(previous => ({ ...previous, error, busy: false }));
      if (definite) void load(new AbortController().signal, generation);
    }
  };
  const retry = () => pending.current ? void command() : void load(new AbortController().signal, epoch.current);
  return { ...current, command, retry, uncertain: data.key === key && pending.current !== null && !current.busy };
}
