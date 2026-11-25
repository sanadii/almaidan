import { GameplayPreferences } from '../../design-system/SoundToggle';
import type { SoundRole } from '../../lib/sound';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { InternalHeader } from '../../design-system/InternalHeader';
import { FinishedRoomJoinCard, NameJoinCard } from '../../design-system/NameJoinCard';
import { RoomCode } from '../../design-system/RoomCode';
import { useCopyStatus } from '../../design-system/StatusToast';
import { useFirebaseAuth } from '../auth/auth-context';
import { JOIN_NAME_MESSAGE, normalizePlayerDisplayName } from '../game/runtime/display-name';
import { roomIsMissing, unknownRoomMessage } from '../game/runtime/room-code-check';
import { RoomGuestStage } from './RoomGuestStage';
import { isDefinitiveRoomRejection, isTerminalRoomRead, requestRoomJoinOptions, roomError, roomMatchPath, roomRequest, roomTokenKey, type RoomJoinOptions, type RoomView } from './room-client';
import { useRoomPolling } from './use-room-polling';
import '../../styles/enta.css';
import '../../styles/rooms.css';

const displayLinkHelp = 'افتحوا شاشة العرض من غرفة المضيف، أو انسخوا رابطها من هناك.';

function Shell({ children, heading, soundRole = 'player' }: { children: ReactNode; heading: string; soundRole?: SoundRole }) {
  return <main id="main-content" className="maydan-app maydan-public-page enta-page" data-page-layout="wide" data-page-kind="game" dir="rtl">
    <InternalHeader gameContext soundRole={soundRole} />
    <div className="page-rail enta-rail enta-room-rail"><header>{heading !== 'إنت صح' ? <p className="eyebrow">إنت صح</p> : null}<h1>{heading}</h1></header>{children}</div>
  </main>;
}

function seatAvailable(room: RoomView, memberId: string, teamIndex: number, playerIndex: number) {
  const team = room.teams[teamIndex];
  return team && playerIndex >= 0 && playerIndex < (team.seatLimit ?? team.players.length)
    && !room.members.some(member => member.id !== memberId && member.teamIndex === teamIndex && member.playerIndex === playerIndex);
}

function firstFreeSeat(room: RoomView, memberId: string, teamIndex: number) {
  const team = room.teams[teamIndex];
  for (let seat = 0; seat < (team?.seatLimit ?? team?.players.length ?? 0); seat++) {
    if (seatAvailable(room, memberId, teamIndex, seat)) return seat;
  }
  return -1;
}

function tokenFor(code: string) {
  try { return sessionStorage.getItem(roomTokenKey(code)) ?? undefined; } catch { return undefined; }
}

type PendingJoin = { requestKey: string; name: string; teamIndex?: number };
const joinKey = (code: string) => `${roomTokenKey(code)}:pending-join`;

function readPendingJoin(code: string): PendingJoin | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(joinKey(code)) ?? 'null');
    if (!value || typeof value.requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.requestKey) || !normalizePlayerDisplayName(value.name)) return null;
    return { requestKey: value.requestKey, name: value.name, teamIndex: Number.isInteger(value.teamIndex) && value.teamIndex >= 0 ? value.teamIndex : undefined };
  } catch { return null; }
}

function writePendingJoin(code: string, value: PendingJoin | null) {
  try {
    if (value) sessionStorage.setItem(joinKey(code), JSON.stringify(value));
    else sessionStorage.removeItem(joinKey(code));
  } catch { /* Storage-less tabs keep the request key in memory for retries. */ }
}

export function EntaRoomJoinRoute() {
  const { code = '' } = useParams();
  return <RoomJoinForm key={code} code={code} />;
}

function RoomJoinForm({ code }: { code: string }) {
  const navigate = useNavigate();
  const [restored] = useState(() => readPendingJoin(code));
  const [name, setName] = useState(restored?.name ?? '');
  const [teamIndex, setTeamIndex] = useState(restored?.teamIndex);
  const [options, setOptions] = useState<RoomJoinOptions>();
  const teams = options?.finished ? undefined : options?.teams;
  const [error, setError] = useState<unknown>(null);
  const [optionsError, setOptionsError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(restored);
  const inFlight = useRef(false);
  const nameField = useRef<HTMLInputElement>(null);
  const teamField = useRef<HTMLButtonElement>(null);
  const requests = useRef(new AbortController());

  useEffect(() => {
    document.title = 'ادخل غرفة إنت صح | الميدان';
    const controller = new AbortController();
    requests.current = controller;
    if (tokenFor(code)) navigate(`/enta/rooms/${code}/play`, { replace: true });
    return () => controller.abort();
  }, [code, navigate]);

  useEffect(() => {
    if (tokenFor(code)) return;
    const controller = new AbortController();
    void requestRoomJoinOptions(code, controller.signal).then(data => {
      if (!controller.signal.aborted) setOptions(data);
    }).catch(failure => {
      if (!controller.signal.aborted) setOptionsError(failure);
    });
    return () => controller.abort();
  }, [code, retry]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const display = normalizePlayerDisplayName(name);
    if (!display || /[<>]/.test(display)) {
      setError(JOIN_NAME_MESSAGE);
      nameField.current?.focus();
      return;
    }
    if (teamIndex === undefined || !teams?.[teamIndex]) {
      setError('اختاروا فريقاً أولاً.');
      teamField.current?.focus();
      return;
    }
    if (pending.current?.name !== display || pending.current?.teamIndex !== teamIndex) {
      pending.current = { requestKey: crypto.randomUUID(), name: display, teamIndex };
    }
    writePendingJoin(code, pending.current);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const signal = requests.current.signal;
    try {
      const data = await roomRequest(`/${code}/join`, { body: pending.current, signal });
      if (signal.aborted) return;
      if (!data.token) throw new Error('TOKEN_UNAVAILABLE');
      sessionStorage.setItem(roomTokenKey(code), data.token);
      writePendingJoin(code, null);
      navigate(`/enta/rooms/${code}/play`);
    } catch (failure) {
      if (signal.aborted) return;
      if (isDefinitiveRoomRejection(failure)) {
        writePendingJoin(code, null);
        pending.current = null;
      }
      setError(failure);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  if (options?.finished) return <FinishedRoomJoinCard successorJoinPath={options.successorCode && `/enta/rooms/${options.successorCode}/join`} />;

  if (roomIsMissing(optionsError) || roomIsMissing(error)) return <NameJoinCard backTo="/#room-code">
    <h1 id="name-join-title">الدخول إلى الغرفة</h1>
    <p className="form-message" role="alert">{unknownRoomMessage}</p>
  </NameJoinCard>;

  return <NameJoinCard className="enta-join-card">
    <h1 id="name-join-title">الدخول إلى الغرفة <bdi className="enta-join-code" dir="ltr">{code}</bdi></h1>
    <form aria-busy={busy || undefined} noValidate onSubmit={join}>
      <label>اسم اللاعب<input ref={nameField} required autoComplete="nickname" aria-describedby="enta-join-name-help" value={name} onChange={event => { setName(event.target.value); setError(null); }} disabled={busy || !teams} /></label>
      <small id="enta-join-name-help">{JOIN_NAME_MESSAGE}</small>
      {teams?.length ? <fieldset className="enta-join-teams"><legend>اختر فريقك</legend><div>{teams.map((team, index) =>
        <button key={team.id} type="button" className="button" ref={index === 0 ? teamField : undefined} aria-pressed={teamIndex === index} disabled={busy} onClick={() => { setTeamIndex(index); setError(null); }}><bdi>{team.name}</bdi></button>
      )}</div></fieldset> : !optionsError ? <p role="status">جارٍ تحميل الفرق…</p> : null}
      {optionsError ? <><p role="alert">{roomError(optionsError)}</p><button type="button" className="button" onClick={() => { setOptionsError(null); setRetry(value => value + 1); }}>إعادة المحاولة</button></> : null}
      {error ? <p className="form-message" role="alert">{typeof error === 'string' ? error : roomError(error)}</p> : null}
      <button type="submit" className="button button--primary" disabled={busy || !teams?.length}>{busy ? 'جارٍ الدخول…' : 'الدخول'}</button>
    </form>
  </NameJoinCard>;
}

export function EntaRoomRoute({ host = false, display = false }: { host?: boolean; display?: boolean }) {
  const { code = '' } = useParams(), { user } = useFirebaseAuth();
  return <RoomSession key={`${code}:${host}:${display}:${host ? user?.uid ?? 'signed-out' : 'guest'}`} host={host} display={display} code={code} />;
}

function readDisplayToken(code: string) {
  const supplied = new URLSearchParams(location.hash.slice(1)).get('token');
  if (supplied) {
    try { sessionStorage.setItem(roomTokenKey(code) + ':display', supplied); } catch { /* The in-memory token can still be used. */ }
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    return supplied;
  }
  try { return sessionStorage.getItem(roomTokenKey(code) + ':display') ?? undefined; } catch { return undefined; }
}

function RoomSession({ code, host, display }: { code: string; host: boolean; display: boolean }) {
  const { user: account, status } = useFirebaseAuth(), navigate = useNavigate();
  const user = account?.isAnonymous ? null : account;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [displayUrl, setDisplayUrl] = useState('');
  const { copyText, localStatus } = useCopyStatus();
  const [token] = useState(() => display ? readDisplayToken(code) : tokenFor(code));
  const displayAction = useRef<'open' | 'copy'>('open');
  const pending = useRef<Record<string, unknown> | null>(null);
  const commandFailed = useRef(false);
  const inFlight = useRef(false);
  const requests = useRef(new AbortController());
  const refresh = useCallback(() => setRetry(value => value + 1), []);
  const read = useCallback((signal: AbortSignal) => roomRequest(`/${code}${host ? '' : '/view'}`, { user: host ? user : null, token, signal }), [code, host, token, user]);
  const receive = useCallback((data: { room?: RoomView } & RoomView) => {
    const next = data.room ?? data;
    setRoom(current => current && current.version > next.version ? current : next);
    if (!pending.current && !commandFailed.current) setError(null);
    return Boolean(next.successorCode) || host && next.phase === 'FINISHED';
  }, [host]);
  const reject = useCallback((failure: unknown, terminal: boolean) => {
    setError(failure);
    if (terminal) setRoom(null);
  }, []);
  const sendPresence = useCallback((action: 'idle' | 'leave') => {
    if (!host && !display && token) void roomRequest(`/${code}/${action}`, { token, body: {}, keepalive: true }).catch(() => {});
  }, [code, display, host, token]);
  const onHidden = useCallback(() => sendPresence('idle'), [sendPresence]);
  useRoomPolling({ enabled: host ? Boolean(user) : Boolean(token), read, receive, reject, retry, onHidden, interval: room?.phase === 'FINISHED' ? 3000 : 1000 });
  const successor = room?.successorCode;
  const followRematch = useCallback(() => {
    if (!successor || successor === code || !/^E1-[A-Z2-9]{8}$/.test(successor)) return;
    if (host) {
      navigate(`/enta/rooms/${successor}/host`, { replace: true });
      return;
    }
    if (!token) return;
    const destination = `/enta/rooms/${successor}/${display ? 'display' : 'play'}`;
    try {
      sessionStorage.setItem(roomTokenKey(successor) + (display ? ':display' : ''), token);
      navigate(destination, { replace: true });
    } catch (failure) {
      if (display) navigate(`${destination}#token=${encodeURIComponent(token)}`, { replace: true });
      else setError(failure);
    }
  }, [code, display, host, navigate, successor, token]);
  useEffect(() => {
    if (display || host) followRematch();
  }, [display, followRematch, host]);

  useEffect(() => {
    document.title = display ? 'شاشة عرض إنت صح | الميدان' : 'غرفة إنت صح | الميدان';
    const controller = new AbortController();
    requests.current = controller;
    return () => controller.abort();
  }, [display]);

  useEffect(() => {
    if (room?.phase === 'FINISHED') return;
    const leaving = () => sendPresence('leave');
    window.addEventListener('pagehide', leaving);
    return () => window.removeEventListener('pagehide', leaving);
  }, [room?.phase, sendPresence]);

  async function command(type: string, extra: Record<string, unknown> = {}) {
    if (!room || !user || inFlight.current || (pending.current && pending.current.type !== type)) return null;
    inFlight.current = true;
    setBusy(true);
    commandFailed.current = false;
    setError(null);
    pending.current ??= { commandId: crypto.randomUUID(), expectedVersion: room.version, type, ...extra };
    const signal = requests.current.signal;
    try {
      const data = await roomRequest(`/${code}/host`, { user, body: pending.current, signal });
      if (signal.aborted) return null;
      pending.current = null;
      const next = data.room as RoomView | undefined;
      if (next) setRoom(next);
      const displayToken = data.token ?? data.displayToken;
      const url = displayToken ? `${location.origin}/enta/rooms/${code}/display#token=${encodeURIComponent(displayToken)}` : null;
      if (url) setDisplayUrl(url);
      if (type === 'REVOKE_DISPLAY') setDisplayUrl('');
      if (type === 'START' && next) navigate(roomMatchPath(next.engine, next.matchId), { replace: true });
      else refresh();
      return url;
    } catch (failure) {
      if (signal.aborted) return null;
      commandFailed.current = true;
      setError(failure);
      if (isDefinitiveRoomRejection(failure)) pending.current = null;
      refresh();
      return null;
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  function openDisplay() {
    displayAction.current = 'open';
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    if (displayUrl) {
      if (popup) popup.location.replace(displayUrl);
      else navigate(displayUrl.slice(location.origin.length));
      return;
    }
    void command('DISPLAY').then(url => {
      if (popup && url) popup.location.replace(url);
      else if (popup) popup.close();
      else if (url && !requests.current.signal.aborted) navigate(url.slice(location.origin.length));
    });
  }

  function copyDisplay() {
    displayAction.current = 'copy';
    void copyText(displayUrl || command('DISPLAY'), 'تم نسخ الرابط', 'ما قدرنا ننسخ الرابط.');
  }

  async function sendGrant(memberId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const signal = requests.current.signal;
    try {
      await roomRequest(`/${code}/member-grant`, { user, body: { memberId, role: 'ACTOR' }, signal });
      if (!signal.aborted) refresh();
    } catch (failure) { if (!signal.aborted) setError(failure); }
    finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  function retryCommand() {
    if (pending.current) {
      if (pending.current.type === 'DISPLAY') {
        if (displayAction.current === 'copy') copyDisplay();
        else openDisplay();
      }
      else void command(String(pending.current.type));
      return;
    }
    commandFailed.current = false;
    setError(null);
    refresh();
  }

  const joinPath = `/enta/rooms/${code}/join`;
  const joinUrl = `${location.origin}${joinPath}`;
  if (host && !user) return <Shell heading="غرفة الانتظار">
    <p role="status">{status === 'loading' ? 'جارٍ التحقق من الحساب…' : 'سجّل الدخول بحساب المضيف لإدارة الغرفة.'}</p>
    <Link className="button" to={`/login?returnTo=${encodeURIComponent(`/enta/rooms/${code}/host`)}`}>تسجيل الدخول</Link>
  </Shell>;

  const errorPanel = error ? <div className="enta-state">
    <p role="alert">{roomError(error)}</p>
    {!host && !display ? <button className="button" type="button" onClick={() => {
      try { sessionStorage.removeItem(roomTokenKey(code)); } catch { /* The join form handles disabled storage. */ }
      navigate(joinPath);
    }}>الدخول من جديد</button> : null}
    <button type="button" className="button" onClick={retryCommand} disabled={busy}>إعادة المحاولة</button>
  </div> : null;
  const connecting = !room && !error ? <p role="status">جارٍ الاتصال بالغرفة…</p> : null;
  if (display) return <main id="main-content" className="maydan-app enta-page enta-room-display" data-page-kind="game" dir="rtl">
    <header><GameplayPreferences role="display" /></header>
    {!token || isTerminalRoomRead(error) ? <p role="status">{displayLinkHelp}</p> : <>{errorPanel}{connecting}</>}
    {room ? <RoomGuestStage room={room} token={token!} display connected={!error} refresh={refresh} joinUrl={joinUrl} /> : null}
  </main>;
  if (!host) return <Shell heading={room?.phase === 'LOBBY' ? 'غرفة الانتظار' : 'إنت صح'} soundRole="player">
    {token ? <>{errorPanel}{connecting}
      {successor ? <button className="button button--primary enta-room-rematch" type="button" onClick={followRematch}>المضيف بدأ مباراة جديدة — ادخلوا</button> : null}
      {room ? <RoomGuestStage room={room} token={token} connected={!error} refresh={refresh} joinUrl={joinUrl} /> : null}
    </> : <Link className="button button--primary" to={joinPath}>ادخل الغرفة باسمك</Link>}
  </Shell>;

  const unassigned = room?.members.some(member => member.teamIndex === null || member.playerIndex === null);
  return <Shell heading={room?.phase === 'PLAYING' ? 'المباراة جارية' : room?.phase === 'FINISHED' ? 'انتهت المباراة' : 'غرفة الانتظار'} soundRole="host">
    {errorPanel}{connecting}
    {room ? <>
      <section className="enta-state enta-room-lobby">
        <RoomCode code={code} joinUrl={joinUrl} />
        <div className="enta-actions">
          <button className="button button--primary" type="button" disabled={busy || Boolean(pending.current)} onClick={openDisplay}>افتح شاشة العرض</button>
          <button className="button button--secondary" type="button" disabled={busy || Boolean(pending.current)} onClick={copyDisplay}>انسخ رابط شاشة العرض</button>
          <button className="button button--secondary" type="button" onClick={() => void copyText(joinUrl, 'تم نسخ الرابط', 'ما قدرنا ننسخ الرابط.')}>نسخ رابط الدعوة</button>
          <button className="button" type="button" disabled={busy} onClick={() => void command('LOCK', { locked: !room.locked })}>{room.locked ? 'فتح الانضمام' : 'قفل الانضمام'}</button>
        </div>
        <details className="enta-room-options">
          <summary>خيارات</summary>
          <button className="button button--quiet" type="button" disabled={busy} onClick={() => void command('REVOKE_DISPLAY')}>أوقف روابط العرض السابقة</button>
        </details>
        {localStatus ? <span role="status">{localStatus}</span> : null}
      </section>
      <section className="enta-state">
        <h2>اللاعبون والفرق</h2>
        {room.members.length ? <ul className="room-members">{room.members.map(member => {
          const teamIndex = member.teamIndex;
          const team = teamIndex === null ? null : room.teams[teamIndex];
          return <li key={member.id}>
            <strong><bdi>{member.name}</bdi></strong>
            <span>{member.status === 'PENDING' ? 'بانتظار قبول المضيف' : team?.name ?? 'بانتظار اختيار الفريق'}{member.captain ? ' · قائد الفريق' : ''}</span>
            <div className="enta-actions">
              <label>الفريق<select value={teamIndex ?? ''} disabled={busy} onChange={event => {
                const nextTeam = Number(event.target.value), playerIndex = firstFreeSeat(room, member.id, nextTeam);
                if (playerIndex >= 0) void command('ASSIGN', { memberId: member.id, teamIndex: nextTeam, playerIndex, captain: member.captain });
              }}><option value="" disabled>اختر الفريق</option>{room.teams.map((option, index) => {
                const full = firstFreeSeat(room, member.id, index) < 0;
                return <option value={index} key={option.id} disabled={full}>{option.name}{full ? ' — مكتمل' : ''}</option>;
              })}</select></label>
              {team && teamIndex !== null && !['classic', 'kids'].includes(room.engine) ? <>
                <label>مقعد اللاعب<select value={member.playerIndex ?? 0} disabled={busy} onChange={event => {
                  const playerIndex = Number(event.target.value);
                  if (seatAvailable(room, member.id, teamIndex, playerIndex)) void command('ASSIGN', { memberId: member.id, teamIndex, playerIndex, captain: member.captain });
                }}>{team.players.map((player, index) => <option key={index} value={index} disabled={!seatAvailable(room, member.id, teamIndex, index)}>{typeof player === 'string' ? player : (player as { name?: string } | null)?.name ?? `لاعب ${index + 1}`}</option>)}</select></label>
                <button className="button" type="button" disabled={busy} onClick={() => void command('ASSIGN', { memberId: member.id, teamIndex, playerIndex: member.playerIndex ?? 0, captain: !member.captain })}>{member.captain ? 'إلغاء القيادة' : 'تعيين قائداً'}</button>
              </> : null}
              {member.status === 'PENDING' ? <button className="button" type="button" disabled={busy} onClick={() => void command('ADMIT', { memberId: member.id })}>قبول اللاعب</button> : null}
              {room.phase === 'PLAYING' && ['round', 'competitive'].includes(room.engine) ? <button className="button" type="button" disabled={busy} onClick={() => void sendGrant(member.id)}>إرسال المهمة الخاصة</button> : null}
              <button className="button" type="button" disabled={busy} onClick={() => void command('REMOVE', { memberId: member.id })}>إزالة</button>
            </div>
          </li>;
        })}</ul> : <p>لم ينضم أحد بعد.</p>}
        {room.phase === 'LOBBY' && room.members.length > 0 ? <button className="button" type="button" disabled={busy || !unassigned} onClick={() => void command('AUTO_ASSIGN')}>وزّعهم تلقائياً</button> : null}
      </section>
      <div className="enta-actions">{room.phase === 'LOBBY' ? <>
        <button type="button" className="button button--primary" disabled={busy || Boolean(pending.current) || unassigned} aria-describedby={unassigned ? 'enta-assignment-required' : undefined} onClick={() => void command('START')}>بدء المباراة</button>
        {unassigned ? <p id="enta-assignment-required">وزّعوا اللاعبين على الفرق أولاً</p> : null}
      </> : <Link className="button button--primary" to={roomMatchPath(room.engine, room.matchId) + (room.phase === 'FINISHED' ? '/result' : '')}>{room.phase === 'FINISHED' ? 'فتح النتيجة' : 'فتح لوحة المضيف'}</Link>}
        <Link className="button" to="/enta/history">مبارياتي</Link><Link className="button" to="/">الرئيسية</Link>
      </div>
    </> : null}
  </Shell>;
}
