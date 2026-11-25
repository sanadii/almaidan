import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { isAlmaidanLocalDevelopment } from '../../lib/local-development';
import { isDefinitiveRoomRejection, roomError, roomRequest, type RoomEngine, type RoomView } from './room-client';
import { useRoomPolling } from './use-room-polling';

export function useOwnerRoom(user: User | null, engine: RoomEngine, matchId: string | undefined, enabled: boolean) {
  const key = `${user?.uid}:${engine}:${matchId}`;
  const [state, setState] = useState<{ key: string; room: RoomView | null }>();
  const [retry, setRetry] = useState(0);
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  const read = useCallback((signal: AbortSignal) => roomRequest(`/by-match/${engine}/${encodeURIComponent(matchId ?? '')}`, { user, signal }), [engine, matchId, user]);
  const receive = useCallback(({ room }: { room: RoomView | null }) => {
    setState({ key, room });
    return !room || room.phase === 'FINISHED';
  }, [key]);
  const reject = useCallback((_error: unknown, terminal: boolean) => {
    if (terminal) setState({ key, room: null });
  }, [key]);
  useRoomPolling({ enabled: isAlmaidanLocalDevelopment && Boolean(user && matchId && enabled), read, receive, reject, retry });
  return { room: state?.key === key ? state.room : null, refresh };
}

export function OwnerRoomControls({ room, user, refresh }: { room: RoomView | null; user: User | null; refresh: () => void }) {
  return room && user ? <WaitingPlayers key={`${user.uid}:${room.code}`} room={room} user={user} refresh={refresh} /> : null;
}

function WaitingPlayers({ room, user, refresh }: { room: RoomView; user: User; refresh: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const pending = useRef<{ commandId: string; expectedVersion: number; type: 'ADMIT'; memberId: string } | null>(null);
  const inFlight = useRef(false);
  const waiting = room.members.filter(member => member.status === 'PENDING');
  if (!waiting.length || room.phase !== 'PLAYING') return null;

  async function admit(memberId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    pending.current ??= { commandId: crypto.randomUUID(), expectedVersion: room.version, type: 'ADMIT', memberId };
    try {
      await roomRequest(`/${room.code}/host`, { user, body: pending.current });
      pending.current = null;
    } catch (failure) {
      if (isDefinitiveRoomRejection(failure)) pending.current = null;
      setError(failure);
    } finally {
      inFlight.current = false;
      setBusy(false);
      refresh();
    }
  }

  return <section className="enta-state enta-room-waiting">
    <p className="enta-turn-badge" role="status">{waiting.length === 1 ? 'لاعب ينتظر القبول' : `${waiting.length} لاعبين ينتظرون القبول`}</p>
    <ul className="enta-room-names">{waiting.map(member => <li key={member.id}><bdi>{member.name}</bdi>
      <button type="button" className="button" disabled={busy || Boolean(pending.current && pending.current.memberId !== member.id)} onClick={() => void admit(member.id)}>قبول اللاعب</button>
    </li>)}</ul>
    {error ? <p role="alert">{roomError(error)}</p> : null}
    <Link className="button" to={`/enta/rooms/${room.code}/host`}>إدارة الغرفة</Link>
  </section>;
}

export function roomPlayerName(room: RoomView | null, teamId: string, playerIndex: number, fallback: string) {
  const teamIndex = room?.teams.findIndex(team => team.id === teamId);
  return room?.members.find(member => member.status === 'ADMITTED' && member.teamIndex === teamIndex && member.playerIndex === playerIndex)?.name ?? fallback;
}

export function RoomSubmissionList({ room, roundId, legacyOnly = false }: { room: RoomView | null; roundId: string; legacyOnly?: boolean }) {
  const submissions = room?.submissions?.filter(row => row.roundId === roundId && (!legacyOnly || !row.attemptId)) ?? [];
  if (!submissions.length) return null;
  return <section className="enta-room-submission">
    <h3>{legacyOnly ? 'إجابات مرسلة بدون رقم محاولة' : 'إجابات اللاعبين في الجولة الحالية'}</h3>
    <ul>{submissions.map(row => <li key={row.commandId}>
      <strong><bdi>{room?.members.find(member => member.id === row.memberId)?.name ?? 'لاعب'}</bdi></strong>{' '}<bdi>{row.text}</bdi>
    </li>)}</ul>
  </section>;
}
