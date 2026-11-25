import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HomeSurface } from './HomeSurface';
import { parseRoomLocator } from '../features/game/runtime/room-locator';
import { checkRoomCode, normalizeRoomCode } from '../features/game/runtime/room-code-check';
import { DeferredFirebaseAuthProvider } from '../features/auth/auth-context';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

export { normalizeRoomCode } from '../features/game/runtime/room-code-check';
export { normalizePlayerDisplayName as validateJoinDisplayName } from '../features/game/runtime/display-name';

function EntryContent({ staticPreview }: { staticPreview: boolean }) {
  useEffect(() => { document.title = 'الميدان | الخلية وإنت صح والدخيل'; }, []);
  const [search] = useSearchParams();
  const queryRoomCode = normalizeRoomCode(search.get('room') ?? '');
  const validCode = (value: string) => { try { parseRoomLocator(value); return true; } catch { return false; } };
  const [roomCode, setRoomCode] = useState(queryRoomCode);
  const [roomCodeError, setRoomCodeError] = useState('');
  const [checking, setChecking] = useState(false);
  const check = useRef<AbortController | null>(null);
  const roomCodeControl = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (validCode(queryRoomCode) && !staticPreview)
      navigate(`/room/${queryRoomCode}/join`, { replace: true });
  }, [navigate, queryRoomCode, staticPreview]);
  useEffect(() => () => check.current?.abort(), []);

  async function continueToName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (check.current) return;
    if (staticPreview) {
      setRoomCodeError(staticPreviewNotice);
      return;
    }
    if (!validCode(roomCode)) {
      setRoomCodeError('أدخل رمز الغرفة أولاً.');
      roomCodeControl.current?.focus();
      return;
    }
    setRoomCodeError('');
    const controller = new AbortController();
    check.current = controller;
    setChecking(true);
    const result = await checkRoomCode(roomCode, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
    if (controller.signal.aborted) return;
    check.current = null;
    setChecking(false);
    if (result.status === 'error') {
      setRoomCodeError(result.message);
      roomCodeControl.current?.focus();
      return;
    }
    navigate(`/room/${roomCode}/join`, { state: result.status === 'active' ? { checkedRoomCode: roomCode } : undefined });
  }

  return (
    <HomeSurface
      staticPreview={staticPreview}
      joinForm={
        <form aria-busy={checking || undefined} className="join-form join-form--code" noValidate onSubmit={continueToName}>
          <label className="join-form__field" htmlFor="room-code"><span id="room-code-label">رمز الغرفة</span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              dir="ltr"
              id="room-code"
              inputMode="text"
              maxLength={11}
              aria-labelledby="room-code-label"
              aria-describedby={roomCodeError ? 'room-code-error' : undefined}
              aria-invalid={Boolean(roomCodeError)}
              onChange={(event) => {
                check.current?.abort();
                check.current = null;
                setChecking(false);
                setRoomCode(normalizeRoomCode(event.target.value));
                if (roomCodeError) setRoomCodeError('');
              }}
              pattern="([A-Z0-9]{1,8}|(M2|E1|D1)-[A-Z0-9]{8})"
              placeholder="AB12CD"
              ref={roomCodeControl}
              spellCheck="false"
              value={roomCode}
            />
            {!staticPreview && roomCodeError ? <span className="form-message" id="room-code-error" role="alert">{roomCodeError}</span> : null}
          </label>
          <button className="button button--primary" disabled={staticPreview || checking} type="submit">{checking ? 'جارٍ التحقق…' : 'الدخول'}</button>
        </form>
      }
      joinMessage={staticPreview ? <p className="form-message" id="static-preview-notice" role="status">{staticPreviewNotice}</p> : null}
    />
  );
}

export function EntryRoute({ staticPreview: previewOverride }: { staticPreview?: boolean } = {}) {
  const staticPreview = previewOverride ?? isStaticPreviewBuild();
  return <DeferredFirebaseAuthProvider enabled={!staticPreview}><EntryContent staticPreview={staticPreview} /></DeferredFirebaseAuthProvider>;
}
