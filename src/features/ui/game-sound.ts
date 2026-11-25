import { useEffect, useRef, useState } from 'react';
import { playSounds, type SoundCue, type SoundRole } from '../../lib/sound';

function useSoundBaseline<T>() {
  const previous = useRef<T | null>(null);
  useEffect(() => {
    const reset = () => { previous.current = null; };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, []);
  return previous;
}

export function useCountdownSound(role: SoundRole, key: string | null | undefined, seconds: number | null,
  deadlineAt?: number, serverNow?: number) {
  const previous = useSoundBaseline<{ key: string; seconds: number; deadlineAt?: number }>();
  useEffect(() => {
    const before = previous.current;
    // A server transition may remove the timer before this tab observes zero.
    if (before && before.key !== key && before.seconds > 0 &&
        before.deadlineAt !== undefined && serverNow !== undefined && serverNow >= before.deadlineAt) {
      playSounds(role, 'time-up');
    }
    if (!key || seconds === null || !Number.isFinite(seconds)) {
      previous.current = null;
      return;
    }
    if (before?.key === key && before.seconds <= seconds) return;
    previous.current = { key, seconds, deadlineAt };
    if (seconds > 5 || (seconds === 0 && before?.key !== key)) return;
    playSounds(role, seconds === 0 ? 'time-up' : 'tick');
  }, [role, key, seconds, deadlineAt, serverNow]);
}

export function useDeadlineSound(role: SoundRole, deadline: string | undefined, serverTime: string | undefined) {
  const [clock, setClock] = useState(Date.now);
  const sample = useRef({ serverTime, clientTime: clock });
  useEffect(() => {
    sample.current = { serverTime, clientTime: Date.now() };
  }, [serverTime]);
  useEffect(() => {
    if (!deadline) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const seconds = deadline && serverTime
    ? Math.max(0, Math.ceil((Date.parse(deadline) - Date.parse(serverTime) - Math.max(0, clock - sample.current.clientTime)) / 1000))
    : null;
  useCountdownSound(role, deadline, seconds,
    deadline ? Date.parse(deadline) : undefined, serverTime ? Date.parse(serverTime) : undefined);
}

export function useGameSoundTransition<T>(
  role: SoundRole,
  state: T | undefined | null,
  transition: (previous: T, current: T) => SoundCue[],
) {
  const previous = useSoundBaseline<T | undefined>();
  useEffect(() => {
    const before = previous.current;
    previous.current = document.hidden ? null : state;
    if (before && state && before !== state) playSounds(role, ...transition(before, state));
  }, [role, state, transition]);
}
