import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HomeSurface } from './HomeSurface';
import { parseRoomLocator } from '../features/game/runtime/room-locator';
import { DeferredFirebaseAuthProvider } from '../features/auth/auth-context';
import {
  isStaticPreviewBuild,
  staticPreviewNotice,
} from '../features/game/runtime/static-preview';

export function normalizeRoomCode(value: string) {
  const upper = value.toUpperCase();
  if (upper.startsWith('M2-') || upper.startsWith('E1-') || upper.startsWith('D1-')) {
    return upper.slice(0,3) + upper.slice(3).replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }
  return upper.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function validateJoinDisplayName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= 48 && !/\p{Cc}/u.test(name) ? name : undefined;
}

function EntryContent({ staticPreview }: { staticPreview: boolean }) {
  useEffect(() => { document.title = 'الميدان | الخلية وإنت صح والدخيل'; }, []);
  const [search] = useSearchParams();
  const queryRoomCode = normalizeRoomCode(search.get('room') ?? '');
  const validCode = (value: string) => { try { parseRoomLocator(value); return true; } catch { return false; } };
  const [roomCode, setRoomCode] = useState(queryRoomCode);
  const [roomCodeError, setRoomCodeError] = useState('');
  const roomCodeControl = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (validCode(queryRoomCode) && !staticPreview)
      navigate(`/room/${queryRoomCode}/join`, { replace: true });
  }, [navigate, queryRoomCode, staticPreview]);

  function continueToName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    navigate(`/room/${roomCode}/join`);
  }

  return (
    <HomeSurface
      staticPreview={staticPreview}
      joinForm={
        <form className="join-form join-form--code" noValidate onSubmit={continueToName}>
          <label className="join-form__field" htmlFor="room-code">رمز الغرفة
            <input
              autoCapitalize="characters"
              autoComplete="off"
              dir="ltr"
              id="room-code"
              inputMode="text"
              maxLength={11}
              aria-describedby={roomCodeError ? 'room-code-error' : undefined}
              aria-invalid={Boolean(roomCodeError)}
              onChange={(event) => {
                setRoomCode(normalizeRoomCode(event.target.value));
                if (roomCodeError) setRoomCodeError('');
              }}
              pattern="([A-Z0-9]{1,8}|(M2|E1|D1)-[A-Z0-9]{8})"
              placeholder="AB12CD34"
              ref={roomCodeControl}
              spellCheck="false"
              value={roomCode}
            />
          </label>
          <button className="button button--primary" disabled={staticPreview} type="submit">الدخول</button>
        </form>
      }
      joinMessage={staticPreview ? <p className="form-message" id="static-preview-notice" role="status">{staticPreviewNotice}</p> : roomCodeError ? <p className="form-message" id="room-code-error" role="alert">{roomCodeError}</p> : null}
    />
  );
}

export function EntryRoute({ staticPreview: previewOverride }: { staticPreview?: boolean } = {}) {
  const staticPreview = previewOverride ?? isStaticPreviewBuild();
  return <DeferredFirebaseAuthProvider enabled={!staticPreview}><EntryContent staticPreview={staticPreview} /></DeferredFirebaseAuthProvider>;
}
