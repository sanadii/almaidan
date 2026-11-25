import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { InternalHeader } from './InternalHeader';
import './public-shell.css';

type StatusPanelProps = {
  title: string;
  children: ReactNode;
  illustration: ReactNode;
  action: ReactNode;
  busy?: boolean;
  state?: string;
};

export function StatusPanel({ title, children, illustration, action, busy, state }: StatusPanelProps) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} aria-busy={busy} className="status-panel" data-state={state}>
      <div className="status-panel__illustration">{illustration}</div>
      <div className="status-panel__body">
        <h1 id={titleId}>{title}</h1>
        {children}
        <div className="status-panel__action">{action}</div>
      </div>
    </section>
  );
}

export function StatusPage(props: StatusPanelProps) {
  return (
    <main className="maydan-app maydan-public-page" data-page-layout="wide" id="main-content" tabIndex={-1}>
      <InternalHeader />
      <StatusPanel {...props} />
    </main>
  );
}

export function StatusArt({ art }: { art: 'buzzer' | 'cloud' | 'hex' | 'questions' | 'trophy' }) {
  return <img src={`/assets/maydan/maydan-e-${art}-320.webp`} alt="" width={320} height={320} decoding="async" />;
}

export function StatusHomeLink() {
  return <Link className="button button--secondary" to="/">الرئيسية</Link>;
}
