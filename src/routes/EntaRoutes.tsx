import { CategorySourceContext } from '../features/enta/CategorySourceContext';
import { VerifyEmailNotice } from '../features/auth/VerifyEmailNotice';
import {FavoritesPanel} from '../features/favorites/FavoritesPanel';
import { CategoryCompatibility } from '../features/enta/CategoryCompatibility';
import { useSetupDraft } from '../features/enta/use-setup-draft';
import { isAlmaidanLocalDevelopment, isAlmaidanRealContent, localContentNote } from '../lib/local-development';
import { completePendingStart, pendingStartRetired } from '../features/enta/pending-start';
import { useOwnerGeneration } from '../features/enta/use-owner-generation';
import { ownerEpoch, isOwnerEpoch, type OwnerEpoch } from '../features/enta/auth-epoch';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { InternalHeader } from '../design-system/InternalHeader';
import { useFirebaseAuth } from '../features/auth/auth-context';
import { isStaticPreviewBuild } from '../features/game/runtime/static-preview';
import { EntaClientError, entaErrorText, foldEntaName, normalizeEntaName, parseCatalog, pendingStartStorageKey, requestEnta, type CatalogProjection, type ClassicSetup, type MatchProjection, type StartCommand } from '../features/enta/client';
import { useEntaMatch } from '../features/enta/use-match';
import { parsePendingIntent, pendingIntentRoute, persistPendingIntent, readPendingIntent, loadPendingForSetup, pendingStorageReadable, type PendingIntent } from '../features/enta/pending-intent';
import type { EntaMode, SuccessorSetup } from '../features/enta/client';
import '../styles/enta.css';

export function EntaShell({ title, children }: { title: string; children: React.ReactNode }) {
  const {id}=useParams(),{user}=useFirebaseAuth(),location=useLocation();let linkedRoom:string|null=null;
  const pageKind=/^\/enta\/(?:competitive\/)?new(?:\/|$)/.test(location.pathname)?'setup':/\/(?:capability|rooms)(?:\/|$)/.test(location.pathname)||(/\/(?:matches|round-matches)\//.test(location.pathname)&&!/\/(?:result|rematch)$/.test(location.pathname))?'game':'workspace';try{linkedRoom=id&&user?sessionStorage.getItem(`almaidan:match-room:${user.uid}:${id}`):null;}catch{/* Storage may be unavailable; the match then opens without its room link. */}
  useEffect(() => { document.title = `${title} | الميدان`; }, [title]);
  return <main className="maydan-app maydan-public-page enta-page" data-page-layout="wide" data-page-kind={pageKind} id="main-content" tabIndex={-1}><InternalHeader gameContext={pageKind === 'game'} /><div className="page-rail enta-rail"><header className="enta-heading"><p className="eyebrow">إنت صح</p><h1>{title}</h1></header>{linkedRoom?<Link className="button" to={`/enta/rooms/${linkedRoom}/host`}>الغرفة واللاعبون · {linkedRoom}</Link>:null}{children}</div></main>;
}
export function EntaAccess({ children }: { children: React.ReactNode }) {
  const auth = useFirebaseAuth();
  const location = useLocation();
  if (isStaticPreviewBuild()) return <div className="enta-state"><h2>إنت صح غير متاحة في المعاينة</h2><p role="status">هذه معاينة للواجهة فقط. بدء المباريات واللعب غير متصلين هنا.</p><Link className="button" to="/">العودة للرئيسية</Link></div>;
  if (auth.status === 'loading') return <div className="enta-state" aria-busy="true"><p role="status">جارٍ التحقق من الحساب…</p></div>;
  if (!auth.isAvailable || auth.status === 'unavailable' || auth.status === 'error') return <div className="enta-state"><h2>تسجيل الدخول غير متاح الآن</h2><p role="status">تعذر الاتصال بخدمة الحساب. أعد تحميل الصفحة بعد قليل.</p><Link className="button" to="/">العودة للرئيسية</Link></div>;
  if (auth.user && !auth.user.isAnonymous && !auth.user.emailVerified) return <div className="enta-state"><h2>أكّد بريدك للاستضافة</h2><VerifyEmailNotice user={auth.user} /></div>;
  if (!auth.user || auth.user.isAnonymous || !auth.user.emailVerified) return <div className="enta-state"><h2>ابدأ بحساب موثّق</h2><p>المضيف يدير الأسئلة والنقاط من حسابه. سجّل الدخول بحساب موثّق للاستضافة.</p><Link className="button button--primary" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>تسجيل الدخول</Link></div>;
  return <>{children}</>;
}

const entaModes = [
  { to: '/enta/competitive/new/classic', label: 'التحدّي مع المساعدات', art: 'buzzer' },
  { to: '/enta/competitive/new/mixed', label: 'لوحة متنوعة مع المساعدات', art: 'hex' },
  { to: '/enta/competitive/new/list', label: 'القوائم مع المساعدات', art: 'questions' },
  { to: '/enta/competitive/new/acting', label: 'التمثيل مع المساعدات', art: 'cloud' },
  { to: '/enta/new/kids', label: 'إنت صح للأطفال', art: 'trophy' },
  { to: '/enta/new/list', label: 'جولات القوائم', art: 'questions' },
  { to: '/enta/new/acting', label: 'جولات التمثيل', art: 'cloud' },
  { to: '/enta/new/drawing', label: 'لوحة الرسم', art: 'hex' },
  { to: '/enta/new/mixed', label: 'لوحة متنوعة', art: 'buzzer' },
  { to: '/enta/history', label: 'مبارياتي', art: 'trophy' },
] as const;

function EntaModeCards() {
  return <nav className="enta-mode-cards" aria-label="أنماط إنت صح">{entaModes.map(({ to, label, art }, index) => <Link className={index === 0 ? 'enta-mode-card enta-mode-card--primary' : 'enta-mode-card'} to={to} key={to}>
    <img src={`/assets/maydan/maydan-e-${art}-320.webp`} alt="" width={320} height={320} decoding="async" />
    <span>{label}</span>
  </Link>)}</nav>;
}

export function EntaNewRoute() { const { user } = useFirebaseAuth(); return <EntaShell title="جهّزوا إنت صح"><EntaAccess><EntaModeCards />{isAlmaidanRealContent?<p>الفهرس الكامل والصور والفيديو وتحديات الذاكرة متاحة في <Link to="/?real-catalogue=1#category-chooser-title">مباراة الفئات</Link>. تعرض إنت صح هنا الأسئلة النصية المناسبة للوحة المستويات.</p>:null}<EntaSetup key={pendingStartStorageKey(user?.uid ?? 'signed-out')} /></EntaAccess></EntaShell>; }
export function RealFormatUnavailable() { return <div className="enta-state"><p role="status">لا تحتوي النسخة الأصلية المحفوظة على محتوى مخصص لهذا النمط. لم نستبدله بأسئلة تدريبية.</p><Link className="button" to="/enta/new">العب بالأسئلة الأصلية</Link></div>; }
export function EntaKidsRoute() { const { user } = useFirebaseAuth(); return <EntaShell title="جهّزوا إنت صح للأطفال"><EntaAccess><EntaSetup mode="KIDS" key={pendingStartStorageKey(user?.uid ?? 'signed-out')} /></EntaAccess></EntaShell>; }
export function EntaSetup({ mode = 'CLASSIC', predecessor, initialSetup }: { mode?: EntaMode; predecessor?: { gameId: string; version: number }; initialSetup?: SuccessorSetup }) {
  const authGeneration = useOwnerGeneration();
  const { user } = useFirebaseAuth(), navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogProjection | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [attempt, setAttempt] = useState(0);
  const [teams, setTeams] = useSetupDraft(`${user?.uid ?? "guest"}:${mode}:${predecessor?.gameId ?? "new"}:teams`, initialSetup ? initialSetup.teams.map(team => ({ name: team.name, players: team.players.join('\n') })) : [{ name: 'الفريق الأول', players: '' }, { name: 'الفريق الثاني', players: '' }]), [categories, setCategories] = useSetupDraft<string[]>(`${user?.uid ?? "guest"}:${mode}:${predecessor?.gameId ?? "new"}:categories`, initialSetup?.categoryKeys ?? []), [seconds, setSeconds] = useSetupDraft(`${user?.uid ?? "guest"}:${mode}:${predecessor?.gameId ?? "new"}:seconds`, initialSetup?.rules.questionSeconds ?? 30), [search, setSearch] = useState('');
  const pending = useRef<PendingIntent | null>(null), epoch = useRef(0), startAbort = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    setBusy(false);
    const generation = ++epoch.current, controller = new AbortController();
    pending.current = user ? loadPendingForSetup(user.uid, error => { setError(error); setUncertain(true); }) : null;
    if (pending.current && (pending.current.version === 2 || pending.current.version === 3)) { const setup = pending.current.command.setup; setTeams(setup.teams.map(team => ({ name: team.name, players: team.players.join('\n') }))); setCategories(setup.categoryKeys); setSeconds(setup.rules.questionSeconds); setUncertain(true); }
    else if (pending.current) { setUncertain(true); }
    else { setUncertain(false); }
    setCatalog(null); setLoading(true); if (!user || pendingStorageReadable(user.uid)) setError(null);
    if (user) void requestEnta(mode === 'KIDS' ? '/catalog/kids' : '/catalog', user, controller.signal).then(value => parseCatalog(value, mode)).then(value => { if (generation === epoch.current) { setCatalog(value); setLoading(false); } }).catch(error => { if (generation === epoch.current && !controller.signal.aborted) { setError(error); setLoading(false); } });
    return () => { epoch.current++; controller.abort(); startAbort.current?.abort(); };
  }, [attempt, mode, user, authGeneration]);
  const count = pending.current?.version === 3 && pending.current.mode === 'KIDS' || (!pending.current && mode === 'KIDS') ? 1 : 6;
  const setup: ClassicSetup | SuccessorSetup = { version: mode === 'KIDS' || predecessor ? 3 : 2, categoryKeys: categories, teams: teams.map(team => ({ name: normalizeEntaName(team.name), players: team.players.split('\n').map(normalizeEntaName).filter(Boolean), lifelines: [] })), rules: { questionSeconds: seconds } };
  const submit = async () => {
    if (!user || busy || (!pending.current && !form.current?.reportValidity())) return;
    if (!pending.current && (categories.length !== count || setup.teams.some(team => team.players.length < 1 || team.players.length > 8) || new Set(setup.teams.map(team => foldEntaName(team.name))).size !== teams.length)) { setError(new EntaClientError('INVALID_SETUP')); form.current?.querySelector<HTMLInputElement>('input')?.focus(); return; }
    let identity: OwnerEpoch; try { identity = ownerEpoch(user.uid); readPendingIntent(user.uid); } catch (error) { setError(error); setUncertain(true); return; }
    const generation = epoch.current, priorUncertain = uncertain;
    let intent = pending.current;
    if (intent && (intent.version === 4 || intent.version === 5)) return;
    if (!intent) {
      const command = { requestKey: crypto.randomUUID(), logicalMatchId: crypto.randomUUID(), setup, ...(predecessor ? { predecessorVersion: predecessor.version } : {}) };
      if (setup.version === 2) intent = { version: 2, mode: 'CLASSIC', operation: 'PAID_ENTA_CLASSIC', startKind: 'START', predecessor: null, endpoint: '/matches/classic', command: command as StartCommand };
      else { try { intent = parsePendingIntent({ version: 3, mode, operation: mode === 'KIDS' ? 'PAID_ENTA_KIDS' : 'PAID_ENTA_CLASSIC', startKind: predecessor ? 'REMATCH' : 'START', predecessor: predecessor ?? null, endpoint: predecessor ? `/matches/${predecessor.gameId}/rematch` : '/matches/kids', command }); } catch (error) { setError(error); return; } }
    }
    pending.current = intent;
    try { persistPendingIntent(user.uid, intent); } catch { if (!priorUncertain) pending.current = null; setError(new EntaClientError('PENDING_INTENT_STORAGE_UNAVAILABLE')); return; }
    const controller = new AbortController(); startAbort.current = controller; setBusy(true); setError(null);
    try {
      const match = await completePendingStart(user, intent, controller.signal, () => isOwnerEpoch(identity) && generation === epoch.current && !controller.signal.aborted);
      if (!isOwnerEpoch(identity) || generation !== epoch.current || controller.signal.aborted) return;
      pending.current = null; setUncertain(false); navigate(match.roomCode ? `/enta/rooms/${match.roomCode}/host` : `/enta/matches/${match.id}`);
    } catch (error) {
      if (!isOwnerEpoch(identity) || generation !== epoch.current || controller.signal.aborted) return;
      const retired = pendingStartRetired(error); if (retired) pending.current = null;
      setUncertain(!retired); setError(error); setBusy(false);
    }
  };
  return <form className="enta-setup" ref={form} onSubmit={event => { event.preventDefault(); void submit(); }}><div className="enta-setup-fields">
    <p className="enta-lead">{mode === 'KIDS' ? 'فئة واحدة وستة أسئلة للأطفال. جهّزوا الفرق، واختاروا الفئة.' : 'ست فئات، وأسئلة بثلاثة مستويات. جهّزوا الفرق، ثم ابدأوا التحدّي.'}</p>{predecessor && !isAlmaidanLocalDevelopment ? <p>مباراة جديدة تُخصم لها لعبة واحدة. إعداد المباراة السابقة قابل للتعديل؛ الأسئلة من المحتوى المتاح الآن.</p> : null}
    <fieldset disabled={busy || uncertain} className="enta-fields"><legend>الفرق واللاعبون</legend>
      <div className="enta-team-fields">{teams.map((team, index) => <section className="enta-team-field" key={index}><label>اسم الفريق {index + 1}<input required minLength={2} maxLength={22} value={team.name} onChange={event => setTeams(previous => previous.map((team, position) => position === index ? { ...team, name: event.target.value } : team))} /></label><label>اللاعبون — اسم في كل سطر<textarea required rows={3} maxLength={248} value={team.players} onChange={event => setTeams(previous => previous.map((team, position) => position === index ? { ...team, players: event.target.value } : team))} /></label>{teams.length > 2 ? <button type="button" className="button" onClick={() => setTeams(previous => previous.filter((_, position) => position !== index))}>إزالة الفريق {index + 1}</button> : null}</section>)}</div>
      {teams.length < 4 ? <button type="button" className="button" onClick={() => setTeams(previous => [...previous, { name: `الفريق ${previous.length + 1}`, players: '' }])}>إضافة فريق</button> : null}
    </fieldset>
    <fieldset disabled={busy || uncertain} className="enta-fields"><legend>وقت السؤال</legend><label className="page-readable">الوقت بالثواني<input type="number" min={5} max={120} required value={seconds} onChange={event => setSeconds(Number(event.target.value))} /></label></fieldset>
    <section className="enta-categories" aria-labelledby="enta-categories-title" aria-busy={loading}><div className="enta-section-heading"><h2 id="enta-categories-title">{count === 1 ? 'اختاروا فئة واحدة' : 'اختاروا ست فئات'}</h2><p aria-live="polite">{categories.length} / {count}</p></div>
      {loading ? <p role="status">جارٍ تحميل الفئات…</p> : catalog ? <><label className="page-readable">البحث في الفئات<input type="search" value={search} disabled={busy || uncertain} onChange={event => setSearch(event.target.value)} /></label><div className="enta-category-grid">{catalog.categories.filter(category => category.label.includes(search.trim())).map(category => <button className="enta-category" type="button" key={category.key} aria-pressed={categories.includes(category.key)} disabled={busy || uncertain || (!categories.includes(category.key) && categories.length === count)} onClick={() => setCategories(previous => previous.includes(category.key) ? previous.filter(key => key !== category.key) : [...previous, category.key])}>{category.label}<CategorySourceContext category={category} categories={catalog.categories}/></button>)}</div>{!catalog.categories.some(category => category.label.includes(search.trim())) ? <p role="status">لا توجد فئات تطابق البحث.</p> : null}</> : <div className="enta-state"><p role="alert">{entaErrorText(error)}</p><button className="button" type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>إعادة تحميل الفئات</button></div>}
    </section>
    {catalog?.categories.some(category=>category.favoriteKey)?<FavoritesPanel choices={catalog.categories.filter(category=>category.favoriteKey&&category.label.includes(search.trim())).map(category=>({key:category.favoriteKey!,label:category.label}))}/>:null}
    {isAlmaidanRealContent ? <CategoryCompatibility mode={mode === 'KIDS' ? 'kids' : 'classic'} /> : null}
    </div><aside className="enta-setup-summary" aria-labelledby="enta-summary-title"><h2 id="enta-summary-title">مباراة جاهزة على ذوقكم</h2><p>{teams.length} فرق · {categories.length} فئات · {seconds} ثانية للسؤال</p><p>{isAlmaidanLocalDevelopment ? localContentNote : "بدء المباراة يستهلك لعبة واحدة. الجولات داخلها لا تخصم ألعاباً إضافية."}</p>{catalog && !isAlmaidanLocalDevelopment ? <p>الألعاب المتبقية في الحساب: <bdi>{catalog.availableCredit}</bdi></p> : null}
      {uncertain ? <p role="alert">قد تكون المباراة بدأت. أعد تأكيد المحاولة نفسها قبل تغيير الإعداد.</p> : null}
      {error && catalog ? <p role="alert">{entaErrorText(error)}</p> : null}
      {pending.current && pending.current.version >= 4 ? <Link className="button button--primary" to={pendingIntentRoute(pending.current)}>تأكيد محاولة الجولات السابقة</Link> : <button className="button button--primary" type="submit" disabled={busy || (!uncertain && (!catalog || catalog.availableCredit === '0'))}>{busy ? 'جارٍ تأكيد المباراة…' : uncertain ? 'تأكيد بدء المباراة' : 'ابدأوا إنت صح'}</button>}
    </aside>
  </form>;
}

function Scores({ match }: { match: MatchProjection }) { return <ol className="enta-scores" aria-label="نقاط الفرق">{match.teams.map(team => <li key={team.id} data-turn={team.id === match.turnTeamId && match.phase !== 'FINISHED'}><span>{team.name}{team.id === match.turnTeamId && match.phase !== 'FINISHED' ? <em className="enta-turn-badge">دورهم</em> : null}</span><strong>{team.score.toLocaleString('ar-KW')}</strong></li>)}</ol>; }
export function EntaMatchRoute() { return <EntaShell title="لوحة إنت صح"><EntaAccess><EntaMatch /></EntaAccess></EntaShell>; }
function EntaMatch() {
  const { id } = useParams(), { user } = useFirebaseAuth(), state = useEntaMatch(user, id), [awardTeam, setAwardTeam] = useState(''), [confirmEarly, setConfirmEarly] = useState(false), [clock, setClock] = useState(Date.now());
  const receivedAt = useRef(Date.now()), questionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { receivedAt.current = Date.now(); }, [state.match?.serverNow]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (state.match?.currentQuestion) { setAwardTeam(state.match.currentQuestion.answeringTeamId); questionHeading.current?.focus(); } }, [state.match?.currentQuestion?.id]);
  if (!state.match) return <div className="enta-state" aria-busy={state.loading}>{state.loading ? <p role="status">جارٍ تحميل المباراة…</p> : <><p role="alert">{entaErrorText(state.error)}</p><button className="button" onClick={state.retry} type="button">إعادة المحاولة</button></>}</div>;
  const match = state.match, question = match.currentQuestion, disabled = state.busy || state.uncertain;
  if (match.phase === 'FINISHED') return <Navigate replace to={`/enta/matches/${match.id}/result`} />;
  const remaining = question ? Math.max(0, Math.ceil((question.deadlineAt - (match.serverNow + clock - receivedAt.current)) / 1000)) : 0;
  return <div className="enta-play"><Scores match={match} />{state.error ? <div className="enta-state"><p role="alert">{entaErrorText(state.error)}</p><button className="button" type="button" onClick={state.retry}>إعادة المحاولة</button></div> : null}
    {question ? <section className="enta-question" aria-labelledby="enta-question-title"><div className="enta-section-heading"><p>{match.categories.find(category => category.key === match.tiles.find(tile => tile.id === question.id)?.categoryKey)?.label}</p><p>{question.points.toLocaleString('ar-KW')} نقطة</p></div><h2 id="enta-question-title" ref={questionHeading} tabIndex={-1}>{question.prompt}</h2><p className="enta-timer" aria-label="الوقت المتبقي">{remaining.toLocaleString('ar-KW')} ثانية</p>
      {match.phase === 'QUESTION_OPEN' ? <button className="button button--primary" disabled={disabled} type="button" onClick={() => void state.command({ type: 'REVEAL_ANSWER', questionId: question.id })}>إظهار الإجابة</button> : <><div className="enta-answer" role="status"><h3>الإجابة</h3>{question.answers?.map((answer, index) => <p key={index}>{answer}</p>)}</div><fieldset disabled={disabled}><legend>الفريق الذي أجاب صح</legend><div className="enta-award-teams">{match.teams.map(team => <label key={team.id}><input type="radio" name="enta-award-team" checked={awardTeam === team.id} onChange={() => setAwardTeam(team.id)} />{team.name}</label>)}</div></fieldset><div className="enta-actions"><button className="button button--primary" type="button" disabled={disabled || !awardTeam} onClick={() => void state.command({ type: 'ADJUDICATE', questionId: question.id, ruling: 'CORRECT', teamId: awardTeam })}>جاوب صح — احتساب النقاط</button><button className="button" type="button" disabled={disabled} onClick={() => void state.command({ type: 'ADJUDICATE', questionId: question.id, ruling: 'NO_SCORE', teamId: null })}>لا إجابة صحيحة</button></div></>}
    </section> : <><section className="enta-stage" aria-label="لوحة الأسئلة"><p className="enta-turn" role="status"><span>الدور على</span> <strong>{match.teams.find(team => team.id === match.turnTeamId)?.name}</strong><span className="enta-turn__hint">اختاروا سؤالاً من اللوحة</span></p><div className={match.mode === 'KIDS' ? 'enta-board enta-board--kids' : 'enta-board'}>{match.categories.map(category => <section key={category.key} aria-labelledby={`enta-category-${category.key}`} className="enta-board-column"><h2 id={`enta-category-${category.key}`}>{category.label}</h2><div>{match.tiles.filter(tile => tile.categoryKey === category.key).map((tile, index) => <button className="enta-tile" type="button" key={tile.id} disabled={disabled || tile.used} aria-label={`${category.label}، ${tile.points} نقطة، السؤال ${index + 1}${tile.used ? '، تم اللعب' : ''}`} data-used={tile.used} data-result={tile.used ? (tile.isCorrect ? 'scored' : 'missed') : undefined} onClick={() => void state.command({ type: 'OPEN_QUESTION', questionId: tile.id })}><span>{tile.points.toLocaleString('ar-KW')}</span>{tile.used ? <small>{tile.isCorrect ? match.teams.find(team => team.id === tile.answeredByTeamId)?.name ?? 'احتُسبت' : 'بلا نقاط'}</small> : null}</button>)}</div></section>)}</div></section><section className="enta-finish"><h2>إنهاء المباراة</h2>{match.tiles.some(tile => !tile.used) ? <label><input type="checkbox" checked={confirmEarly} disabled={disabled} onChange={event => setConfirmEarly(event.target.checked)} />أؤكد الإنهاء مع وجود أسئلة لم تُلعب.</label> : <p>اكتملت جميع الأسئلة.</p>}<button className="button" type="button" disabled={disabled || (match.tiles.some(tile => !tile.used) && !confirmEarly)} onClick={() => void state.command({ type: 'FINISH', confirmEarly })}>إنهاء وعرض النتيجة</button></section></>}
  </div>;
}
export function EntaResultRoute() { return <EntaShell title="نتيجة إنت صح"><EntaAccess><EntaResult /></EntaAccess></EntaShell>; }
function EntaResult() {
  const { id } = useParams(), { user } = useFirebaseAuth(), state = useEntaMatch(user, id);
  if (!state.match) return <div className="enta-state">{state.loading ? <p role="status">جارٍ تحميل النتيجة…</p> : <><p role="alert">{entaErrorText(state.error)}</p><button className="button" type="button" onClick={state.retry}>إعادة المحاولة</button></>}</div>;
  const match = state.match;
  if (!match.result) return <div className="enta-state"><h2>المباراة ما زالت جارية</h2><Link className="button button--primary" to={`/enta/matches/${match.id}`}>العودة إلى المباراة</Link></div>;
  return <section className="enta-result"><p className="eyebrow">{match.result.isTie ? 'تعادل بين الفرق' : 'الفريق الفائز'}</p><h2>{match.teams.filter(team => match.result!.winnerTeamIds.includes(team.id)).map(team => team.name).join(' و ')}</h2><Scores match={match} />{match.result.reason === 'HOST_ENDED' ? <p role="status">أنهى المضيف المباراة. بقي {match.result.unplayedCount} سؤالاً دون لعب.</p> : <p role="status">اكتملت جميع أسئلة المباراة.</p>}<div className="enta-actions"><Link className="button button--primary" to={`/enta/matches/${match.id}/rematch`}>العبوا من جديد</Link><Link className="button" to="/enta/history">مبارياتي</Link><Link className="button" to="/">العودة للرئيسية</Link></div></section>;
}
