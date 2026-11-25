import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InternalHeader } from './InternalHeader';

export function NameJoinCard({ children, className, backTo = '/' }: { children: ReactNode; className?: string; backTo?: string | null }) {
  return <main data-page-layout="wide" data-page-kind="join" className="maydan-join-page maydan-app" id="main-content" dir="rtl">
    <InternalHeader soundRole="player" />
    <section className={`maydan-join-card page-rail${className ? ` ${className}` : ''}`} aria-labelledby="name-join-title">
      <div className="page-readable">
        {children}
        {backTo ? <Link className="maydan-join-card__back" to={backTo}>غيّر الرمز</Link> : null}
      </div>
    </section>
  </main>;
}

export function FinishedRoomJoinCard({ successorJoinPath }: { successorJoinPath?: string }) {
  return <NameJoinCard backTo={null}>
    <h1 id="name-join-title">انتهت هذه المباراة</h1>
    {successorJoinPath
      ? <Link className="button button--primary" to={successorJoinPath}>المضيف بدأ مباراة جديدة — ادخلوا</Link>
      : <Link className="maydan-join-card__back" to="/">الرئيسية</Link>}
  </NameJoinCard>;
}
