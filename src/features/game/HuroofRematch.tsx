import { useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { InternalHeader } from '../../design-system/InternalHeader';
import { useFirebaseAuth } from '../auth/auth-context';
import { useCarryHuroofRematch, useHuroofRematch } from './use-huroof-rematch';
import type { SafeRoomSummary } from './runtime/contracts';
import '../../styles/huroof-lobby.css';

export function HuroofRematch() {
  const { id } = useParams();
  const { state } = useLocation();
  const { user } = useFirebaseAuth();
  const { busy, failure, start } = useHuroofRematch(id);
  const problem = failure ?? state?.rematchFailure;
  const returnTo = `/huroof/rematch/${id}`;

  useEffect(() => { document.title = 'إعادة مباراة الخلية | الميدان'; }, []);

  return (
    <main id="main-content" className="maydan-app maydan-public-page enta-page" data-page-layout="wide">
      <InternalHeader />
      <section className="page-rail enta-rail">
        <h1>إعادة مباراة الخلية</h1>
        <div className="enta-state">
          <p>تفتح الإعادة غرفة جديدة بنفس الفرق والفئات والتوقيت، ويقدر اللاعبون يدخلون من غرفتهم الحالية.</p>
          {problem && <p role="alert">{problem.message}</p>}
          <div className="huroof-result-actions">
            {problem?.retry !== false && (user && !user.isAnonymous
              ? <button className="button button--primary" disabled={busy} onClick={() => void start()} type="button">
                  {busy ? 'جارٍ تأكيد الإعادة…' : problem ? 'حاولوا مرة ثانية' : 'إنشاء غرفة الإعادة'}
                </button>
              : <Link className="button button--primary" to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>الدخول بحساب المضيف</Link>)}
            <Link className="button" to="/#game-choice-title">غيّروا اللعبة</Link>
            <Link className="button" to="/">الرئيسية</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

export function HuroofRematchJoin({ roomId, successor }: { roomId: string; successor: NonNullable<SafeRoomSummary['successor']> }) {
  const { busy, failed, join } = useCarryHuroofRematch(roomId, successor);
  return (
    <div className="huroof-rematch-join">
      <button className="button button--primary" type="button" disabled={busy} onClick={() => void join()}>
        المضيف بدأ مباراة جديدة — ادخلوا
      </button>
      {failed && <p role="alert">تعذّر الدخول للمباراة الجديدة. حاولوا مرة ثانية.</p>}
    </div>
  );
}
