import { FormEvent, lazy, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FinishedRoomJoinCard, NameJoinCard } from '../design-system/NameJoinCard';
import { gameRuntime } from '../features/game/runtime';
import { CLIENT_CHALLENGE_CAPABILITY } from '../features/game/runtime/contracts';
import { PgRuntimeContext } from '../features/game/runtime/room-context';
import { parseRoomLocator } from '../features/game/runtime/room-locator';
import { JOIN_NAME_MESSAGE, normalizePlayerDisplayName as validateJoinDisplayName } from '../features/game/runtime/display-name';
import { canCheckRoomCode, checkRoomCode, normalizeRoomCode, roomIsMissing, unknownRoomMessage, type RoomCodeCheck } from '../features/game/runtime/room-code-check';
import { capabilityFor, savedRoomId, saveCapability, saveRoomCode } from '../features/game/runtime/huroof-session';
import { roomErrorCode } from '../features/game/runtime/room-request-error';
import { createGameIntentId } from '../features/game/runtime/game-intent-id';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

const ImposterJoinRoute = lazy(() => import('../features/imposter/ImposterRoutes').then(({ ImposterJoinRoute }) => ({ default: ImposterJoinRoute })));

export function NameJoinRoute() {
  const { roomCode = '' } = useParams();
  const normalized = normalizeRoomCode(roomCode);
  if (normalized.startsWith('E1-')) return <Navigate replace to={`/enta/rooms/${normalized}/join`} />;
  return <CheckedNameJoinRoute key={normalized} code={normalized} />;
}

function CheckedNameJoinRoute({ code }: { code: string }) {
  const { state } = useLocation();
  const [lookup, setLookup] = useState<RoomCodeCheck>();
  const [attempt, setAttempt] = useState(0);
  const imposter = code.startsWith('D1-');
  const existingId = imposter ? undefined : savedRoomId(code);
  const needsCheck = !isStaticPreviewBuild() && state?.checkedRoomCode !== code &&
    !(existingId && capabilityFor(existingId)) && canCheckRoomCode(code);
  useEffect(() => {
    if (!needsCheck) return;
    document.title = 'دخول الغرفة | الميدان';
    const controller = new AbortController();
    void checkRoomCode(code, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])).then(result => {
      if (!controller.signal.aborted) setLookup(result);
    });
    return () => controller.abort();
  }, [attempt, code, needsCheck]);
  if (!needsCheck || lookup?.status === 'active') return imposter ? <ImposterJoinRoute /> : <LegacyNameJoinRoute />;
  if (lookup?.status === 'finished') return <FinishedRoomJoinCard successorJoinPath={lookup.successorCode && `/room/${lookup.successorCode}/join`} />;
  const notice = lookup?.message;
  return (
    <NameJoinCard backTo="/#room-code">
      <h1 id="name-join-title">دخول الغرفة</h1>
      {notice ? <>
        <p className="form-message" role="alert">{notice}</p>
        {notice !== unknownRoomMessage ? <button className="button button--primary" type="button" onClick={() => { setLookup(undefined); setAttempt(value => value + 1); }}>إعادة المحاولة</button> : null}
      </> : <p role="status">جارٍ التحقق من الرمز…</p>}
    </NameJoinCard>
  );
}

type PendingJoin = { name: string; requestKey: string };
const joinKey = (code: string) => `almaidan:huroof-join:${code}`;
function readPendingJoin(code: string): PendingJoin | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(joinKey(code)) ?? 'null');
    if (value?.name && typeof value.requestKey === 'string' && validateJoinDisplayName(value.name) === value.name) return value;
  } catch { /* A fresh attempt can still join. */ }
  return undefined;
}

function LegacyNameJoinRoute() {
  const { roomCode: routeRoomCode } = useParams();
  const roomCode = normalizeRoomCode(routeRoomCode ?? '');
  const navigate = useNavigate();
  const pg = useContext(PgRuntimeContext);
  const routeEpoch = useRef(0);
  let backend: 'pg' | 'legacy' | 'enta' | undefined;
  try { backend = parseRoomLocator(roomCode).backend; } catch { backend = undefined; }
  useLayoutEffect(() => {
    const epoch = ++routeEpoch.current;
    const unbind = backend === 'pg' && pg ? pg.bindRoute(roomCode) : undefined;
    return () => { if (routeEpoch.current === epoch) routeEpoch.current++; unbind?.(); };
  }, [backend, pg, roomCode]);
  const [pending] = useState(() => readPendingJoin(roomCode));
  const request = useRef(pending);
  const inFlight = useRef(false);
  const [name, setName] = useState(pending?.name ?? '');
  const [nameError, setNameError] = useState('');
  const [message, setMessage] = useState('');
  const [messageState, setMessageState] = useState<'notice' | 'error'>('notice');
  const [busy, setBusy] = useState(false);
  const nameControl = useRef<HTMLInputElement>(null);
  const staticPreview = isStaticPreviewBuild();

  useEffect(() => { document.title = 'اسم اللاعب | الميدان'; }, []);

  const existingId = backend === 'legacy' && !staticPreview ? savedRoomId(roomCode) : undefined;
  if (existingId && capabilityFor(existingId)) return <Navigate replace to={`/room/${roomCode}/lobby`} />;

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (staticPreview) {
      setMessageState('notice');
      setMessage(staticPreviewNotice);
      return;
    }
    const displayName = validateJoinDisplayName(name);
    if (!backend) {
      setMessageState('error');
      setMessage('رمز الغرفة غير صالح. غيّره ثم حاول مرة أخرى.');
      return;
    }
    if (!displayName) {
      setNameError(JOIN_NAME_MESSAGE);
      nameControl.current?.focus();
      return;
    }
    setNameError('');
    if (typeof fetch !== 'function') {
      setMessageState('notice');
      setMessage(`سيُتابع الانضمام إلى الغرفة ${roomCode}.`);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    const attempt = routeEpoch.current;
    try {
      if (backend === 'pg') {
        if (!pg) throw new Error('PG_UNAVAILABLE');
        const joined = await pg.joinRoom({ roomCode, displayName });
        if (attempt !== routeEpoch.current || !pg.isJoinCurrent(roomCode, joined.ticket)) return;
        navigate(`/room/${roomCode}/lobby`);
        return;
      }
      const join = request.current?.name === displayName
        ? request.current
        : { name: displayName, requestKey: createGameIntentId() };
      request.current = join;
      sessionStorage.setItem(joinKey(roomCode), JSON.stringify(join));
      const value = gameRuntime.kind === 'fixture'
        ? await fetch(`/api/rooms/${roomCode}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName, requestKey: join.requestKey, challenge: CLIENT_CHALLENGE_CAPABILITY }),
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<{ roomId: string; token: string }>;
        })
        : await gameRuntime.joinRoom({ roomCode, displayName, requestKey: join.requestKey, challenge: CLIENT_CHALLENGE_CAPABILITY });
      if (attempt !== routeEpoch.current) return;
      saveCapability(value.roomId, { token: value.token ?? '', role: 'player' });
      saveRoomCode(roomCode, value.roomId);
      sessionStorage.removeItem(joinKey(roomCode));
      navigate(`/room/${roomCode}/lobby`);
    } catch (error) {
      if (attempt !== routeEpoch.current) return;
      setMessageState('error');
      const detail = roomErrorCode(error);
      if (/^(SEAT_REMOVED|JOIN_REQUEST_KEY_CONFLICT|MATCH_COMPLETE|match-complete)$/.test(detail)) {
        sessionStorage.removeItem(joinKey(roomCode));
        request.current = undefined;
      }
      setMessage(/invalid-display-name|INVALID_DISPLAY_NAME/i.test(detail)
        ? JOIN_NAME_MESSAGE
        : /MATCH_COMPLETE|match-complete/.test(detail)
          ? 'انتهت هذه المباراة'
        : /DUPLICATE_DISPLAY_NAME|duplicate-display-name/.test(detail)
          ? 'في لاعب بهذا الاسم. اختاروا اسماً آخر.'
        : /CHALLENGE_PROTOCOL_REQUIRED/.test(detail)
          ? 'تحتاج هذه الغرفة إلى أحدث نسخة من تحديات الميدان. أعد تحميل الصفحة ثم حاول الدخول.'
          : roomIsMissing(error)
            ? unknownRoomMessage
            : /JOIN_NOT_ALLOWED/.test(detail)
              ? 'بدأ التحدي بالفعل. انتظر عودة المضيف إلى اللوحة ثم حاول الدخول.'
              : /PLAYER_CAPACITY_REACHED/.test(detail)
                ? 'الغرفة ممتلئة. اطلب من المضيف توفير مكان ثم حاول مجدداً.'
                : 'تعذر الانضمام الآن. تحقق من اتصال الخدمة ثم حاول مرة أخرى.');
    } finally {
      if (attempt === routeEpoch.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <NameJoinCard>
        <p className="eyebrow">انضم إلى أصحابك</p>
        <p className="maydan-join-card__code">رمز الغرفة <bdi dir="ltr">{roomCode || '—'}</bdi></p>
        <h1 id="name-join-title">ما اسمك؟</h1>
        <p>سيظهر اسمك للمضيف. اختر الاسم الذي يعرفك به أصحابك.</p>
        <form aria-busy={busy || undefined} noValidate onSubmit={joinRoom}>
          <label htmlFor="player-name">اسم اللاعب
            <input
              aria-label="اسم اللاعب"
              aria-describedby={nameError ? 'player-name-error' : 'player-name-help'}
              aria-invalid={Boolean(nameError)}
              autoComplete="name"
              id="player-name"
              disabled={staticPreview}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="اسمك على لوحة الفريق"
              ref={nameControl}
              value={name}
            />
            <small id="player-name-help">{JOIN_NAME_MESSAGE}</small>
          </label>
          <button className="button button--primary" disabled={busy || staticPreview} type="submit">
            {busy ? 'جارٍ الدخول…' : 'دخول الغرفة'}
          </button>
        </form>
        {staticPreview ? <p aria-live="polite" className="form-message" role="status">{staticPreviewNotice}</p> : null}
        {nameError ? <p className="form-message" id="player-name-error" role="alert">{nameError}</p> : null}
        {message ? <p role={messageState === 'error' ? 'alert' : 'status'} aria-live={messageState === 'error' ? 'assertive' : 'polite'} className="form-message" data-state={messageState}>{message}</p> : null}
    </NameJoinCard>
  );
}
