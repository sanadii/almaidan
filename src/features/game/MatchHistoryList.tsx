import type { ReactNode } from 'react';

export type MatchHistoryEntry = {
  key: string;
  game: 'huroof' | 'enta';
  date: string | null;
  complete: boolean;
  title: ReactNode;
  details: ReactNode;
};
export type MatchHistorySource = {
  entries: MatchHistoryEntry[];
  feedback: ReactNode;
  paging: ReactNode;
  ready: boolean;
};
export type HistoryChildren = { children?: (source: MatchHistorySource) => ReactNode };
const dateFormatter = new Intl.DateTimeFormat('ar-KW', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn',
});

function HistoryList({ entries }: { entries: MatchHistoryEntry[] }) {
  return <ol className="enta-history-list" aria-label="المباريات">{entries.map(entry => <li key={entry.key}>
    <article>
      <h2>{entry.title}</h2>
      {entry.date ? <time dateTime={entry.date}>{dateFormatter.format(new Date(entry.date))}</time> : <p>تاريخ الغرفة غير متوفر</p>}
      {entry.details}
    </article>
  </li>)}</ol>;
}

export function MatchHistoryList({ entries }: { entries: MatchHistoryEntry[] }) {
  const sorted = [...entries].sort((a,b) => (b.date ? Date.parse(b.date) : -Infinity) - (a.date ? Date.parse(a.date) : -Infinity) || a.key.localeCompare(b.key));
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const unfinished = (entry: MatchHistoryEntry) => !entry.complete && entry.date !== null && Date.parse(entry.date) < cutoff;
  const current = sorted.filter(entry => !unfinished(entry)), older = sorted.filter(unfinished);
  return <>
    {current.length > 0 && <HistoryList entries={current} />}
    {older.length > 0 && <details className="enta-history-older"><summary>غرف لم تكتمل</summary><HistoryList entries={older} /></details>}
  </>;
}
