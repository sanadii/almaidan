import { formatNumber, formatSeconds } from '../lib/format-number';
import { EntaFinish } from '../features/enta/EntaFinish';
import { CategoryPicker } from '../features/enta/CategoryPicker';
import { CategoryArt } from '../features/enta/CategoryArt';
import { VerifyEmailNotice } from '../features/auth/VerifyEmailNotice';
import {FavoritesPanel} from '../features/favorites/FavoritesPanel';
import { CategoryCompatibility } from '../features/enta/CategoryCompatibility';
import { useSetupDraft } from '../features/enta/use-setup-draft';
import { isAlmaidanLocalDevelopment, isAlmaidanRealContent } from '../lib/local-development';
import { completePendingStart, pendingStartRetired } from '../features/enta/pending-start';
import { useOwnerGeneration } from '../features/enta/use-owner-generation';
import { ownerEpoch, isOwnerEpoch, type OwnerEpoch } from '../features/enta/auth-epoch';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { InternalHeader } from '../design-system/InternalHeader';
import { GameArtwork } from '../design-system/GameArtwork';
import { useCountdownSound, useGameSoundTransition } from '../features/ui/game-sound';
import { classicSoundCues } from '../features/enta/enta-sound';
import { useFirebaseAuth } from '../features/auth/auth-context';
import { isStaticPreviewBuild } from '../features/game/runtime/static-preview';
import { EntaClientError, entaErrorText, normalizeEntaName, parseCatalog, pendingStartStorageKey, requestEnta, type CatalogProjection, type ClassicSetup, type MatchProjection, type StartCommand } from '../features/enta/client';
import { EntaModeChoices } from '../features/enta/EntaModeChoices';
import { publicSetupCategories, setupPlayers, setupPlayersLabel, SetupStep, useEntaSetupAccount, useSetupIssue, validateEntaSetup } from '../features/enta/SetupControls';
import { useEntaMatch } from '../features/enta/use-match';
import { OwnerRoomControls, useOwnerRoom } from '../features/enta/OwnerRoomControls';
import { parsePendingIntent, pendingIntentRoute, persistPendingIntent, readPendingIntent, loadPendingForSetup, pendingStorageReadable, type PendingIntent } from '../features/enta/pending-intent';
import type { EntaMode, SuccessorSetup } from '../features/enta/client';
import '../styles/enta.css';

export function EntaShell({ title, eyebrow = 'إنت صح', children }: { title: string; eyebrow?: string; children: React.ReactNode }) {
  const {id}=useParams(),{user}=useFirebaseAuth(),location=useLocation();let linkedRoom:string|null=null;
  const pageKind=/^\/enta\/(?:competitive\/)?new(?:\/|$)/.test(location.pathname)?'setup':/\/(?:capability|rooms)(?:\/|$)/.test(location.pathname)||(/\/(?:matches|round-matches)\//.test(location.pathname)&&!/\/(?:result|rematch)$/.test(location.pathname))?'game':'workspace';try{linkedRoom=id&&user?sessionStorage.getItem(`almaidan:match-room:${user.uid}:${id}`):null;}catch{/* Storage may be unavailable; the match then opens without its room link. */}
  useEffect(() => { document.title = `${title} | الميدان`; }, [title]);
  const heading = <><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></>;
  const isOwnerMatch = pageKind === 'game' && Boolean(id);
  return <main className="maydan-app maydan-public-page enta-page" data-page-layout="wide" data-page-kind={pageKind} id="main-content" tabIndex={-1}><InternalHeader gameContext={pageKind === 'game'} soundRole={isOwnerMatch ? 'host' : undefined} /><div className="page-rail enta-rail">
    <header className={pageKind === 'setup' ? 'enta-heading game-artwork-heading' : 'enta-heading'}>
      {pageKind === 'setup' ? <><div>{heading}</div><GameArtwork game="enta" /></> : heading}
    </header>
    {linkedRoom?<Link className="button" to={`/enta/rooms/${linkedRoom}/host`}>الغرفة واللاعبون · {linkedRoom}</Link>:null}{children}</div></main>;
}
export function EntaAccess({ children, setup = false }: { children: React.ReactNode; setup?: boolean }) {
  const auth = useFirebaseAuth();
  const location = useLocation();
  if (isStaticPreviewBuild()) return <div className="enta-state"><h2>إنت صح غير متاحة في المعاينة</h2><p role="status">هذه معاينة للواجهة فقط. بدء المباريات واللعب غير متصلين هنا.</p><Link className="button" to="/">الرئيسية</Link></div>;
  if (setup && isAlmaidanLocalDevelopment) return <>{children}</>;
  if (auth.status === 'loading') return <div className="enta-state" aria-busy="true"><p role="status">جارٍ التحقق من الحساب…</p></div>;
  if (!auth.isAvailable || auth.status === 'unavailable' || auth.status === 'error') return <div className="enta-state"><h2>تسجيل الدخول غير متاح الآن</h2><p role="status">تعذر الاتصال بخدمة الحساب. أعد تحميل الصفحة بعد قليل.</p><Link className="button" to="/">الرئيسية</Link></div>;
  if (auth.user && !auth.user.isAnonymous && !auth.user.emailVerified) return <div className="enta-state"><h2>أكّد بريدك للاستضافة</h2><VerifyEmailNotice user={auth.user} /></div>;
  if (!auth.user || auth.user.isAnonymous || !auth.user.emailVerified) return <div className="enta-state"><h2>ابدأ بحساب موثّق</h2><p>المضيف يدير الأسئلة والنقاط من حسابه. سجّل الدخول بحساب موثّق للاستضافة.</p><Link className="button button--primary" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>تسجيل الدخول</Link></div>;
  return <>{children}</>;
}

export function EntaNewRoute() { const { user } = useFirebaseAuth(); return <EntaShell title="جهّزوا إنت صح"><EntaAccess setup><EntaModeChoices />{isAlmaidanRealContent?<p className="enta-aside-note">تبون أسئلة بالصور والفيديو وتحديات الذاكرة؟ جرّبوها في <Link to="/?real-catalogue=1#category-chooser-title">مباراة الفئات</Link>.</p>:null}<EntaSetup key={pendingStartStorageKey(user?.uid ?? 'signed-out')} /></EntaAccess></EntaShell>; }
export function RealFormatUnavailable() { return <div className="enta-state"><p role="status">لا تحتوي النسخة الأصلية المحفوظة على محتوى مخصص لهذا النمط. لم نستبدله بأسئلة تدريبية.</p><Link className="button" to="/enta/new">العب بالأسئلة الأصلية</Link></div>; }
export function EntaKidsRoute() { const { user } = useFirebaseAuth(); return <EntaShell title="جهّزوا إنت صح للأطفال"><EntaAccess setup><EntaSetup mode="KIDS" key={pendingStartStorageKey(user?.uid ?? 'signed-out')} /></EntaAccess></EntaShell>; }
export function EntaSetup({ mode = 'CLASSIC', predecessor, initialSetup }: { mode?: EntaMode; predecessor?: { gameId: string; version: number }; initialSetup?: SuccessorSetup }) {
  const authGeneration = useOwnerGeneration();
  const { user, unverified, fields, signIn } = useEntaSetupAccount(), navigate = useNavigate();
  const [catalog, setCatalog] = useState<CatalogProjection | null>(null), [error, setError] = useState<unknown>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [attempt, setAttempt] = useState(0);
  const scope = `${user?.uid ?? 'guest'}:${mode}:${predecessor?.gameId ?? 'new'}`;
  const [teams, setTeams] = useSetupDraft(`${scope}:teams`, initialSetup ? initialSetup.teams.map(team => ({ name: team.name, players: team.players.join('\n') })) : [{ name: 'الفريق الأول', players: '' }, { name: 'الفريق الثاني', players: '' }], undefined, fields?.teams);
  const [categories, setCategories] = useSetupDraft<string[]>(`${scope}:categories`, initialSetup?.categoryKeys ?? [], undefined, fields?.categories);
  const [seconds, setSeconds] = useSetupDraft(`${scope}:seconds`, initialSetup?.rules.questionSeconds ?? 30, undefined, fields?.seconds);
  const [search, setSearch] = useState(''), [verifyRequested, setVerifyRequested] = useState(false);
  const pending = useRef<PendingIntent | null>(null), epoch = useRef(0), startAbort = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null);
  const validation = useSetupIssue(form);
  useEffect(() => {
    setBusy(false);
    const generation = ++epoch.current, controller = new AbortController();
    pending.current = user ? loadPendingForSetup(user.uid, error => { setError(error); setUncertain(true); }) : null;
    if (pending.current && (pending.current.version === 2 || pending.current.version === 3)) { const setup = pending.current.command.setup; setTeams(setup.teams.map(team => ({ name: team.name, players: team.players.join('\n') }))); setCategories(setup.categoryKeys); setSeconds(setup.rules.questionSeconds); setUncertain(true); }
    else if (pending.current) { setUncertain(true); }
    else { setUncertain(false); }
    setCatalog(null); setLoading(true); if (!user || pendingStorageReadable(user.uid)) setError(null);
    const catalogue = user ? requestEnta(mode === 'KIDS' ? '/catalog/kids' : '/catalog', user, controller.signal).then(value => parseCatalog(value, mode))
      : publicSetupCategories(mode === 'KIDS' ? 'kids' : 'classic', controller.signal).then(categories => ({ mode, categories, categoryCount: mode === 'KIDS' ? 1 : 6, availableCredit: '0' } satisfies CatalogProjection));
    void catalogue.then(value => { if (generation === epoch.current && !controller.signal.aborted) { setCatalog(value); setLoading(false); } }).catch(error => { if (generation === epoch.current && !controller.signal.aborted) { setError(error); setLoading(false); } });
    return () => { epoch.current++; controller.abort(); startAbort.current?.abort(); };
  }, [attempt, mode, user, authGeneration]);
  const count = pending.current?.version === 3 && pending.current.mode === 'KIDS' || (!pending.current && mode === 'KIDS') ? 1 : 6;
  const submit = async () => {
    if (busy) return;
    if (!pending.current) {
      const issue = validateEntaSetup({ selected: categories, count, teams, seconds, available: catalog?.categories });
      if (issue) { validation.show(issue); return; }
      if (unverified) { setVerifyRequested(true); return; }
      if (!user) { signIn({ teams, categories, seconds }); return; }
    }
    if (!user) return;
    let identity: OwnerEpoch; try { identity = ownerEpoch(user.uid); readPendingIntent(user.uid); } catch (error) { setError(error); setUncertain(true); return; }
    const generation = epoch.current, priorUncertain = uncertain;
    let intent = pending.current;
    if (intent && (intent.version === 4 || intent.version === 5)) return;
    if (!intent) {
      const setup: ClassicSetup | SuccessorSetup = { version: mode === 'KIDS' || predecessor ? 3 : 2, categoryKeys: categories, teams: teams.map(team => ({ name: normalizeEntaName(team.name), players: setupPlayers(team.players), lifelines: [] })), rules: { questionSeconds: seconds } };
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
  const busyOrUncertain = busy || uncertain;
  const quickSeconds = [20, 30, 45, 60];
  return <form id="enta-classic-setup" className="enta-setup" ref={form} noValidate onChange={validation.clear} onSubmit={event => { event.preventDefault(); void submit(); }}><div className="enta-setup-fields">
    <p className="enta-lead">{mode === 'KIDS' ? 'فئة وحدة وستة أسئلة للصغار. اختاروا الفئة، وسمّوا الفرق، ويالله نبدأ.' : 'ست فئات، ستة وثلاثين سؤال بثلاثة مستويات. اختاروا فئاتكم، سمّوا فرقكم، وخلّوا الحماس يبدأ.'}</p>{predecessor && !isAlmaidanLocalDevelopment ? <p>مباراة جديدة تُخصم لها لعبة واحدة. إعداد المباراة السابقة قابل للتعديل؛ الأسئلة من المحتوى المتاح الآن.</p> : null}
    <section className="enta-categories" aria-labelledby="enta-categories-title" aria-busy={loading}><div className="enta-section-heading"><h2 id="enta-categories-title"><SetupStep number={1} />{count === 1 ? 'اختاروا فئة واحدة' : 'اختاروا ست فئات'}</h2><p className="enta-count" aria-live="polite"><strong>{formatNumber(categories.length)}</strong> / {formatNumber(count)}</p></div>
      {loading ? <div className="enta-category-grid enta-category-grid--loading" role="status" aria-label="جارٍ تحميل الفئات…">{Array.from({ length: 12 }, (_, index) => <span className="enta-category-skeleton" key={index} />)}</div> : catalog ? <CategoryPicker categories={catalog.categories} selected={categories} count={count} disabled={busyOrUncertain} search={search} onSearch={setSearch} onChange={next => { setCategories(next); validation.clear(); }} /> : <div className="enta-state"><p role="alert">{entaErrorText(error)}</p><button className="button" type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>إعادة تحميل الفئات</button></div>}
    </section>
    {catalog?.categories.some(category=>category.favoriteKey)?<FavoritesPanel choices={catalog.categories.filter(category=>category.favoriteKey&&category.label.includes(search.trim())).map(category=>({key:category.favoriteKey!,label:category.label}))}/>:null}
    <fieldset disabled={busyOrUncertain} className="enta-fields"><legend tabIndex={-1} data-setup-field="teams"><SetupStep number={2} />سمّوا فرقكم</legend>
      <div className="enta-team-fields">{teams.map((team, index) => <section className="enta-team-field" key={index}><label>اسم الفريق {index + 1}<input data-setup-field={"team-" + index} required minLength={2} maxLength={22} value={team.name} onChange={event => setTeams(previous => previous.map((team, position) => position === index ? { ...team, name: event.target.value } : team))} /></label><label>{setupPlayersLabel}<textarea data-setup-field={"players-" + index} required={!isAlmaidanLocalDevelopment} rows={3} value={team.players} onChange={event => setTeams(previous => previous.map((team, position) => position === index ? { ...team, players: event.target.value } : team))} /></label>{teams.length > 2 ? <button type="button" className="button button--quiet" onClick={() => setTeams(previous => previous.filter((_, position) => position !== index))}>إزالة الفريق {index + 1}</button> : null}</section>)}</div>
      {teams.length < 4 ? <button type="button" className="button" onClick={() => setTeams(previous => [...previous, { name: `الفريق ${previous.length + 1}`, players: '' }])}>إضافة فريق</button> : null}
    </fieldset>
    <fieldset disabled={busyOrUncertain} className="enta-fields"><legend><SetupStep number={3} />وقت السؤال</legend>
      <div className="enta-quick-times" role="group" aria-label="اختيار سريع للوقت">{quickSeconds.map(value => <button type="button" key={value} aria-pressed={seconds === value} onClick={() => { setSeconds(value); validation.clear(); }}>{formatSeconds(value)}</button>)}</div>
      <label className="page-readable">الوقت بالثواني<input data-setup-field="seconds" type="number" min={5} max={120} required value={seconds} onChange={event => setSeconds(Number(event.target.value))} /></label>
    </fieldset>
    {isAlmaidanRealContent ? <details className="enta-details"><summary>تفاصيل المحتوى المتاح</summary><CategoryCompatibility mode={mode === 'KIDS' ? 'kids' : 'classic'} /></details> : null}
    </div><aside className="enta-setup-summary" aria-labelledby="enta-summary-title"><h2 className="enta-summary-detail" id="enta-summary-title">مباراة جاهزة على ذوقكم</h2>
      <ul className="enta-summary-facts"><li><strong>{formatNumber(categories.length)}</strong> / {formatNumber(count)} فئات</li><li><strong>{teams.length}</strong> فرق</li><li><strong>{seconds}</strong> ثانية</li></ul>
      {catalog && categories.length ? <ul className="enta-summary-picks enta-summary-detail" aria-label="فئاتكم">{categories.map(key => { const category = catalog.categories.find(row => row.key === key); return category ? <li key={key}><CategoryArt categoryKey={key} label={category.label} /><span>{category.label}</span></li> : null; })}</ul> : <p className="enta-summary-hint enta-summary-detail">{count === 1 ? 'اختاروا فئة من الصور.' : 'اختاروا ست فئات من الصور، أو خلّوا النرد يختار لكم.'}</p>}
      {!isAlmaidanLocalDevelopment ? <p className="enta-summary-note">بدء المباراة يستهلك لعبة واحدة. الجولات داخلها لا تخصم ألعاباً إضافية.</p> : null}{catalog && !isAlmaidanLocalDevelopment && user ? <p className="enta-summary-detail">الألعاب المتبقية في الحساب: <bdi>{catalog.availableCredit}</bdi></p> : null}
      {uncertain ? <p role="alert">قد تكون المباراة بدأت. أعد تأكيد المحاولة نفسها قبل تغيير الإعداد.</p> : null}
      {validation.issue ? <p role="alert">{validation.issue.text}</p> : null}
      {verifyRequested && unverified ? <VerifyEmailNotice user={unverified} /> : null}
      {error && catalog ? <p role="alert">{entaErrorText(error)}</p> : null}
      {pending.current && pending.current.version >= 4 ? <Link className="button button--primary" to={pendingIntentRoute(pending.current)}>تأكيد محاولة الجولات السابقة</Link> : <button className="button button--primary enta-start" type="submit" disabled={busy || (!uncertain && (!catalog || Boolean(user && catalog.availableCredit === '0')))}>{busy ? 'جارٍ تأكيد المباراة…' : uncertain ? 'تأكيد بدء المباراة' : user ? 'ابدأوا إنت صح' : unverified ? 'أكّدوا البريد للمتابعة' : 'سجّلوا الدخول للبدء'}</button>}
    </aside>
  </form>;
}



function Scores({ match }: { match: MatchProjection }) { return <ol className="enta-scores" aria-label="نقاط الفرق">{match.teams.map(team => <li key={team.id} data-turn={team.id === match.turnTeamId && match.phase !== 'FINISHED'}><span>{team.name}{team.id === match.turnTeamId && match.phase !== 'FINISHED' ? <em className="enta-turn-badge">دورهم</em> : null}</span><strong>{formatNumber(team.score)}</strong></li>)}</ol>; }
export function EntaMatchRoute() { return <EntaShell title="لوحة إنت صح"><EntaAccess><EntaMatch /></EntaAccess></EntaShell>; }
function EntaMatch() {
  const { id } = useParams(), { user } = useFirebaseAuth(), state = useEntaMatch(user, id), [awardTeam, setAwardTeam] = useState(''), [clock, setClock] = useState(Date.now());
  const ownerRoom = useOwnerRoom(user, 'classic', id, Boolean(state.match && state.match.phase !== 'FINISHED'));
  const receivedAt = useRef(Date.now()), questionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { receivedAt.current = Date.now(); }, [state.match?.serverNow]);
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (state.match?.currentQuestion) { setAwardTeam(state.match.currentQuestion.answeringTeamId); questionHeading.current?.focus(); } }, [state.match?.currentQuestion?.id]);
  const soundMatch = state.error || state.uncertain ? null : state.match;
  const deadline = soundMatch?.phase === 'QUESTION_OPEN' ? soundMatch.currentQuestion?.deadlineAt : undefined;
  useCountdownSound('host', deadline === undefined ? null : `${soundMatch?.id}:${deadline}`,
    deadline === undefined ? null : Math.max(0, Math.ceil((deadline - (soundMatch!.serverNow + clock - receivedAt.current)) / 1000)),
    deadline, soundMatch?.serverNow);
  useGameSoundTransition('host', soundMatch, classicSoundCues);
  if (!state.match) return <div className="enta-state" aria-busy={state.loading}>{state.loading ? <p role="status">جارٍ تحميل المباراة…</p> : <><p role="alert">{entaErrorText(state.error)}</p><button className="button" onClick={state.retry} type="button">إعادة المحاولة</button></>}</div>;
  const match = state.match, question = match.currentQuestion, disabled = state.busy || state.uncertain;
  if (match.phase === 'FINISHED') return <Navigate replace to={`/enta/matches/${match.id}/result`} />;
  const remaining = question ? Math.max(0, Math.ceil((question.deadlineAt - (match.serverNow + clock - receivedAt.current)) / 1000)) : 0;
  return <div className="enta-play"><Scores match={match} />{state.error ? <div className="enta-state"><p role="alert">{entaErrorText(state.error)}</p><button className="button" type="button" onClick={state.retry}>إعادة المحاولة</button></div> : null}
    <OwnerRoomControls {...ownerRoom} user={user} />
    {question ? <section className="enta-question" aria-labelledby="enta-question-title"><div className="enta-section-heading"><p>{match.categories.find(category => category.key === match.tiles.find(tile => tile.id === question.id)?.categoryKey)?.label}</p><p>{formatNumber(question.points)} نقطة</p></div><h2 id="enta-question-title" ref={questionHeading} tabIndex={-1}>{question.prompt}</h2><p className="enta-timer" role="timer" aria-label="الوقت المتبقي">{formatSeconds(remaining)}</p>
      {match.phase === 'QUESTION_OPEN' ? <button className="button button--primary" disabled={disabled} type="button" onClick={() => void state.command({ type: 'REVEAL_ANSWER', questionId: question.id })}>إظهار الإجابة</button> : <><div className="enta-answer" role="status"><h3>الإجابة</h3>{question.answers?.map((answer, index) => <p key={index}>{answer}</p>)}</div><fieldset disabled={disabled}><legend>الفريق الذي أجاب صح</legend><div className="enta-award-teams">{match.teams.map(team => <label key={team.id}><input type="radio" name="enta-award-team" checked={awardTeam === team.id} onChange={() => setAwardTeam(team.id)} />{team.name}</label>)}</div></fieldset><div className="enta-actions"><button className="button button--primary" type="button" disabled={disabled || !awardTeam} onClick={() => void state.command({ type: 'ADJUDICATE', questionId: question.id, ruling: 'CORRECT', teamId: awardTeam })}>جاوب صح — احتساب النقاط</button><button className="button" type="button" disabled={disabled} onClick={() => void state.command({ type: 'ADJUDICATE', questionId: question.id, ruling: 'NO_SCORE', teamId: null })}>لا إجابة صحيحة</button></div></>}
    </section> : <><section className="enta-stage" aria-label="لوحة الأسئلة"><p className="enta-turn" role="status"><span>الدور على</span> <strong>{match.teams.find(team => team.id === match.turnTeamId)?.name}</strong><span className="enta-turn__hint">اختاروا سؤالاً من اللوحة</span></p><div className={match.mode === 'KIDS' ? 'enta-board enta-board--kids' : 'enta-board'}>{match.categories.map(category => <section key={category.key} aria-labelledby={`enta-category-${category.key}`} className="enta-board-column"><h2 id={`enta-category-${category.key}`}>{category.label}</h2><div>{match.tiles.filter(tile => tile.categoryKey === category.key).map((tile, index) => <button className="enta-tile" type="button" key={tile.id} disabled={disabled || tile.used} aria-label={`${category.label}، ${tile.points} نقطة، السؤال ${index + 1}${tile.used ? '، تم اللعب' : ''}`} data-used={tile.used} data-result={tile.used ? (tile.isCorrect ? 'scored' : 'missed') : undefined} onClick={() => void state.command({ type: 'OPEN_QUESTION', questionId: tile.id })}><span>{formatNumber(tile.points)}</span>{tile.used ? <small>{tile.isCorrect ? match.teams.find(team => team.id === tile.answeredByTeamId)?.name ?? 'احتُسبت' : 'بلا نقاط'}</small> : null}</button>)}</div></section>)}</div></section><EntaFinish hasUnplayed={match.tiles.some(tile => !tile.used)} disabled={disabled} onFinish={confirmEarly => void state.command({ type: 'FINISH', confirmEarly })} /></>}
  </div>;
}
export function EntaResultRoute() { return <EntaShell title="نتيجة إنت صح"><EntaAccess><EntaResult /></EntaAccess></EntaShell>; }
function EntaResult() {
  const { id } = useParams(), { user } = useFirebaseAuth(), state = useEntaMatch(user, id);
  if (!state.match) return <div className="enta-state">{state.loading ? <p role="status">جارٍ تحميل النتيجة…</p> : <><p role="alert">{entaErrorText(state.error)}</p><button className="button" type="button" onClick={state.retry}>إعادة المحاولة</button></>}</div>;
  const match = state.match;
  if (!match.result) return <div className="enta-state"><h2>المباراة ما زالت جارية</h2><Link className="button button--primary" to={`/enta/matches/${match.id}`}>العودة إلى المباراة</Link></div>;
  return <section className="enta-result"><p className="eyebrow">{match.result.isTie ? 'تعادل بين الفرق' : 'الفريق الفائز'}</p><h2>{match.teams.filter(team => match.result!.winnerTeamIds.includes(team.id)).map(team => team.name).join(' و ')}</h2><Scores match={match} />{match.result.reason === 'HOST_ENDED' ? <p role="status">أنهى المضيف المباراة. بقي {match.result.unplayedCount} سؤالاً دون لعب.</p> : <p role="status">اكتملت جميع أسئلة المباراة.</p>}<div className="enta-actions"><Link className="button button--primary" to={`/enta/matches/${match.id}/rematch`}>العبوا من جديد</Link><Link className="button" to="/enta/history">مبارياتي</Link><Link className="button" to="/">الرئيسية</Link></div></section>;
}
