import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InternalHeader } from '../design-system/InternalHeader';
import { EpisodeCatalogError, formatEpisodeDate, loadEpisodeCatalog, type PublicEpisode } from '../features/episodes/client';
import { isStaticPreviewBuild } from '../features/game/runtime/static-preview';
import '../styles/episodes.css';

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; episodes: PublicEpisode[] }
  | { kind: 'unavailable' | 'malformed' | 'preview' };

export function EpisodesRoute() {
  const preview = isStaticPreviewBuild();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CatalogState>({ kind: preview ? 'preview' : 'loading' });
  useEffect(() => { document.title = 'الحلقات | الميدان'; }, []);
  useEffect(() => {
    if (preview) { setState({ kind: 'preview' }); return; }
    const controller = new AbortController();
    let current = true;
    setState({ kind: 'loading' });
    loadEpisodeCatalog(controller.signal).then(episodes => {
      if (current) setState({ kind: 'ready', episodes });
    }).catch((error: unknown) => {
      if (current) setState({ kind: error instanceof EpisodeCatalogError ? error.kind : 'unavailable' });
    });
    return () => { current = false; controller.abort(); };
  }, [attempt, preview]);

  const empty = state.kind === 'ready' && state.episodes.length === 0;
  const failed = state.kind === 'unavailable' || state.kind === 'malformed';
  return (
    <main className="maydan-app maydan-public-page maydan-episodes-page" data-page-layout="wide" id="main-content" tabIndex={-1}>
      <InternalHeader />
      <section className="page-rail episodes-catalog" aria-labelledby="episodes-title" aria-busy={state.kind === 'loading'}>
        <header className="episodes-catalog__heading">
          <p className="eyebrow">من الميدان</p>
          <h1 id="episodes-title">الحلقات</h1>
          <p>تعرّفوا على الحلقات واقرؤوا وصف كل حلقة.</p>
        </header>
        {state.kind === 'ready' && !empty ? (
          <ol className="episodes-catalog__list" aria-label="قائمة الحلقات">
            {state.episodes.map(episode => (
              <li key={episode.id}>
                <article className="episode-summary" aria-labelledby={`episode-${episode.id}`}>
                  <p className="episode-summary__number">الحلقة {episode.number.toLocaleString('ar-KW')}</p>
                  <h2 id={`episode-${episode.id}`}>{episode.title}</h2>
                  {episode.description !== null ? <p className="episode-summary__description">{episode.description}</p> : <p>لا يوجد وصف لهذه الحلقة بعد.</p>}
                  {episode.airDate !== null ? <p className="episode-summary__date">تاريخ العرض: <time dateTime={episode.airDate}>{formatEpisodeDate(episode.airDate)}</time></p> : <p className="episode-summary__date">لم يُحدد تاريخ العرض بعد.</p>}
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <div className="episodes-catalog__state" data-state={empty ? 'empty' : state.kind}>
            <h2>{state.kind === 'loading' ? 'جارٍ تحميل الحلقات…' : empty ? 'لا توجد حلقات منشورة بعد' : state.kind === 'preview' ? 'الحلقات غير متاحة في المعاينة' : state.kind === 'malformed' ? 'تعذر عرض بيانات الحلقات' : 'تعذر تحميل الحلقات'}</h2>
            <p role={failed ? 'alert' : 'status'}>{state.kind === 'loading' ? 'لحظات ونجهّز لكم قائمة الحلقات.' : empty ? 'ستظهر الحلقات هنا عند نشرها.' : state.kind === 'preview' ? 'هذه معاينة للواجهة فقط. فهرس الحلقات غير متصل هنا.' : state.kind === 'malformed' ? 'وصلت بيانات غير مكتملة. أعد المحاولة بعد قليل.' : 'تحقق من الاتصال ثم أعد المحاولة.'}</p>
            {failed ? <button className="button button--primary" onClick={() => setAttempt(value => value + 1)} type="button">إعادة المحاولة</button> : null}
          </div>
        )}
        <nav className="episodes-catalog__footer" aria-label="روابط الحلقات"><Link className="button button--secondary" to="/">العودة للرئيسية</Link></nav>
      </section>
    </main>
  );
}
