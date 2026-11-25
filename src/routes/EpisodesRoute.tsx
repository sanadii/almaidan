import { useEffect, useRef, useState } from 'react';
import { InternalHeader } from '../design-system/InternalHeader';
import { StatusArt, StatusHomeLink, StatusPage } from '../design-system/StatusPanel';
import { EpisodeCatalogError, formatEpisodeDate, loadEpisodeCatalog, type PublicEpisode } from '../features/episodes/client';
import { isStaticPreviewBuild } from '../features/game/runtime/static-preview';
import { formatNumber } from '../lib/format-number';
import '../styles/episodes.css';

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; episodes: PublicEpisode[] }
  | { kind: 'unavailable' | 'malformed' | 'preview' };

function EpisodeVideo({ title, youtubeId }: { title: string; youtubeId: string }) {
  const [loaded, setLoaded] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (loaded) player.current?.focus();
  }, [loaded]);

  const label = `شاهدوا ${title}`;
  return loaded ? (
    <iframe className="episode-summary__video" title={label} ref={player}
      src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`}
      referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
  ) : (
    <button className="episode-summary__video episode-summary__poster" type="button" aria-label={label} onClick={() => setLoaded(true)}>
      <picture>
        <source type="image/avif" srcSet="/assets/backgrounds/home-games-fantasy-v2-800.avif" />
        <img src="/assets/backgrounds/home-games-fantasy-v2-800.webp" alt="" width={800} height={450} loading="lazy" decoding="async" />
      </picture>
      <span className="episode-summary__play">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 4v16l12-8z" /></svg>
        شاهدوا الحلقة
      </span>
    </button>
  );
}

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
  if (state.kind !== 'ready' || empty) {
    const title = state.kind === 'loading' ? 'جارٍ تحميل الحلقات…'
      : empty ? 'لا توجد حلقات منشورة بعد'
      : state.kind === 'preview' ? 'الحلقات غير متاحة في المعاينة'
      : state.kind === 'malformed' ? 'تعذر عرض بيانات الحلقات' : 'تعذر تحميل الحلقات';
    const message = state.kind === 'loading' ? 'لحظات ونجهّز لكم قائمة الحلقات.'
      : empty ? 'ستظهر الحلقات هنا عند نشرها.'
      : state.kind === 'preview' ? 'تقدرون تشوفون الحلقات خارج المعاينة.'
      : state.kind === 'malformed' ? 'وصلت بيانات غير مكتملة. أعد المحاولة بعد قليل.' : 'تحقق من الاتصال ثم أعد المحاولة.';
    const action = failed
      ? <button className="button button--primary" onClick={() => setAttempt(value => value + 1)} type="button">إعادة المحاولة</button>
      : <StatusHomeLink />;
    return (
      <StatusPage title={title} action={action} illustration={<StatusArt art="trophy" />}
        busy={state.kind === 'loading'} state={empty ? 'empty' : state.kind}>
        <p role={failed ? 'alert' : 'status'}>{message}</p>
      </StatusPage>
    );
  }
  return (
    <main className="maydan-app maydan-public-page maydan-episodes-page" data-page-layout="wide" id="main-content" tabIndex={-1}>
      <InternalHeader />
      <section className="page-rail episodes-catalog" aria-labelledby="episodes-title">
        <header className="episodes-catalog__heading">
          <p className="eyebrow">من الميدان</p>
          <h1 id="episodes-title">الحلقات</h1>
          <p>تعرّفوا على الحلقات وشاهدوا المقاطع المتوفرة.</p>
        </header>
        <ol className="episodes-catalog__list" aria-label="قائمة الحلقات">
            {state.episodes.map(episode => (
              <li key={episode.id}>
                <article className="episode-summary" aria-labelledby={`episode-${episode.id}`}>
                  <p className="episode-summary__number">الحلقة {formatNumber(episode.number)}</p>
                  <h2 id={`episode-${episode.id}`}>{episode.title}</h2>
                  {episode.youtubeId && <EpisodeVideo title={episode.title} youtubeId={episode.youtubeId} />}
                  {episode.description !== null ? <p className="episode-summary__description">{episode.description}</p> : <p>لا يوجد وصف لهذه الحلقة بعد.</p>}
                  {episode.airDate !== null ? <p className="episode-summary__date">تاريخ العرض: <time dateTime={episode.airDate}>{formatEpisodeDate(episode.airDate)}</time></p> : <p className="episode-summary__date">لم يُحدد تاريخ العرض بعد.</p>}
                </article>
              </li>
            ))}
        </ol>
        <nav className="episodes-catalog__footer" aria-label="روابط الحلقات"><StatusHomeLink /></nav>
      </section>
    </main>
  );
}
