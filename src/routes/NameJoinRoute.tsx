import { FormEvent, lazy, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { InternalHeader } from '../design-system/InternalHeader';
import { gameRuntime } from '../features/game/runtime';
import { CLIENT_CHALLENGE_CAPABILITY } from '../features/game/runtime/contracts';
import { PgRuntimeContext } from '../features/game/runtime/room-context';
import { parseRoomLocator } from '../features/game/runtime/room-locator';
import { normalizeRoomCode, validateJoinDisplayName } from './EntryRoute';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

const ImposterJoinRoute = lazy(() => import('../features/imposter/ImposterRoutes').then(({ ImposterJoinRoute }) => ({ default: ImposterJoinRoute })));

export function NameJoinRoute() {
  const {roomCode} = useParams();
  if (roomCode?.toUpperCase().startsWith('D1-')) return <ImposterJoinRoute />;
  return roomCode?.toUpperCase().startsWith('E1-') ? <Navigate replace to={`/enta/rooms/${normalizeRoomCode(roomCode)}/join`} /> : <LegacyNameJoinRoute />;
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
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [message, setMessage] = useState('');
  const [messageState, setMessageState] = useState<'notice' | 'error'>('notice');
  const [busy, setBusy] = useState(false);
  const nameControl = useRef<HTMLInputElement>(null);
  const staticPreview = isStaticPreviewBuild();

  useEffect(() => { document.title = 'اسم اللاعب | الميدان'; }, []);

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setNameError('أدخل اسماً من حرف إلى 48 حرفاً دون رموز تحكم.');
      nameControl.current?.focus();
      return;
    }
    setNameError('');
    if (typeof fetch !== 'function') {
      setMessageState('notice');
      setMessage(`سيُتابع الانضمام إلى الغرفة ${roomCode}.`);
      return;
    }
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
      const value = gameRuntime.kind === 'fixture'
        ? await fetch(`/api/rooms/${roomCode}/join`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName, challenge: CLIENT_CHALLENGE_CAPABILITY }),
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json() as Promise<{ roomId: string; token: string }>;
        })
        : await gameRuntime.joinRoom({ roomCode, displayName, challenge: CLIENT_CHALLENGE_CAPABILITY });
      if (attempt !== routeEpoch.current) return;
      sessionStorage.setItem(`huroof:${value.roomId}`, JSON.stringify({ token: value.token ?? '', role: 'player' }));
      sessionStorage.setItem(`huroof:code:${roomCode}`, value.roomId);
      navigate(`/room/${roomCode}/lobby`);
    } catch (error) {
      if (attempt !== routeEpoch.current) return;
      setMessageState('error');
      const detail = error instanceof Error ? error.message : '';
      setMessage(/invalid-display-name|INVALID_DISPLAY_NAME/i.test(detail)
        ? 'أدخل اسماً صالحاً للانضمام.'
        : /CHALLENGE_PROTOCOL_REQUIRED/.test(detail)
          ? 'تحتاج هذه الغرفة إلى أحدث نسخة من تحديات الميدان. أعد تحميل الصفحة ثم حاول الدخول.'
          : /ROOM_NOT_FOUND/.test(detail)
            ? 'لم نعثر على هذه الغرفة. تحقق من الرمز مع المضيف.'
            : /JOIN_NOT_ALLOWED/.test(detail)
              ? 'بدأ التحدي بالفعل. انتظر عودة المضيف إلى اللوحة ثم حاول الدخول.'
              : /PLAYER_CAPACITY_REACHED/.test(detail)
                ? 'الغرفة ممتلئة. اطلب من المضيف توفير مكان ثم حاول مجدداً.'
                : 'تعذر الانضمام الآن. تحقق من اتصال الخدمة ثم حاول مرة أخرى.');
    } finally {
      if (attempt === routeEpoch.current) setBusy(false);
    }
  }

  return (
    <main data-page-layout="wide" data-page-kind="join" className="maydan-join-page maydan-app" id="main-content">
      <InternalHeader />
      <section className="maydan-join-card page-rail" aria-labelledby="name-join-title">
        <div className="page-readable">
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
              maxLength={48}
              disabled={staticPreview}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="اسمك على لوحة الفريق"
              ref={nameControl}
              value={name}
            />
            <small id="player-name-help">حتى 48 حرفاً</small>
          </label>
          <button className="button button--primary" disabled={busy || staticPreview} type="submit">
            {busy ? 'جارٍ الدخول…' : 'دخول الغرفة'}
          </button>
        </form>
        {staticPreview ? <p aria-live="polite" className="form-message" role="status">{staticPreviewNotice}</p> : null}
        {nameError ? <p className="form-message" id="player-name-error" role="alert">{nameError}</p> : null}
        {message ? <p role={messageState === 'error' ? 'alert' : 'status'} aria-live={messageState === 'error' ? 'assertive' : 'polite'} className="form-message" data-state={messageState}>{message}</p> : null}
        <Link className="maydan-join-card__back" to="/">تغيير رمز الغرفة</Link>
        </div>
      </section>
    </main>
  );
}
