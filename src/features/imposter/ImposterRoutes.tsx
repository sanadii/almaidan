import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../design-system/ConfirmDialog';
import { RoomCode } from '../../design-system/RoomCode';
import { useCopyStatus } from '../../design-system/StatusToast';
import { formatNumber, formatSeconds } from '../../lib/format-number';
import { Icon } from '../../design-system/Icon';
import { useCountdownSound, useGameSoundTransition } from '../ui/game-sound';
import type { SoundCue, SoundRole } from '../../lib/sound';
import { useFirebaseAuth } from '../auth/auth-context';
import { JOIN_NAME_MESSAGE, normalizePlayerDisplayName as validateJoinDisplayName } from '../game/runtime/display-name';
import { normalizeRoomCode, roomIsMissing, unknownRoomMessage } from '../game/runtime/room-code-check';
import { InternalHeader } from '../../design-system/InternalHeader';
import { GameArtwork } from '../../design-system/GameArtwork';
import { StatusPage } from '../../design-system/StatusPanel';
import { isStaticPreviewBuild } from '../game/runtime/static-preview';
import type { Projection, Settings } from './contracts';
import { IMPOSTER_CATEGORIES as categories } from './catalog';
import { PrivateReveal } from './PrivateReveal';
import { ImposterMark } from './ImposterMark';
import { VerifyEmailNotice } from '../auth/VerifyEmailNotice';
import { useSetupSignIn } from '../auth/setup-sign-in';
import { useSetupDraft } from '../enta/use-setup-draft';
import { validName } from './engine';
import { clearSession, createImposterRoom, joinImposterRoom, imposterError, imposterRuntimeKind, loadSession, resumeImposterRoom, submitImposterIntent, subscribeImposterRoom, syncImposterRoom, terminalImposterError, type Command, type Session, type Snapshot } from './runtime';
import './imposter.css';

const phaseTitles: Record<Projection['phase'], string> = { lobby: 'غرفة الانتظار', reveal: 'كل واحد وسرّه', clues: 'كلمة واحدة تكفي', discussion: 'مين تشكون فيه؟', vote: 'صوّت بسرية', runoff: 'تعادل! احسموها', guess: 'فرصة الدخيل الأخيرة', results: 'انكشف السر!', cancelled: 'أُلغيت الجولة', closed: 'أُغلقت الغرفة' };
const paceLabels: Record<Settings['pace'], string> = { fast: 'سريع — 20 ثانية للكلمة', default: 'جلسة — 30 ثانية للكلمة', relaxed: 'على راحتكم — 45 ثانية للكلمة' };
const paceDetails: Record<Settings['pace'], string> = { fast: 'نقاش 60 ثانية · تصويت وحسم 20 ثانية · تخمين 15 ثانية', default: 'نقاش 90 ثانية · تصويت وحسم 30 ثانية · تخمين 20 ثانية', relaxed: 'نقاش 120 ثانية · تصويت وحسم 45 ثانية · تخمين 30 ثانية' };
const activePhases = new Set(['reveal', 'clues', 'discussion', 'vote', 'runoff', 'guess']);

function Page({ children, gameContext = false, pageKind = 'setup', soundRole }: { children: ReactNode; gameContext?: boolean; pageKind?: 'setup' | 'reading'; soundRole?: SoundRole }) { return <main data-page-layout="wide" className="imposter-page maydan-app" data-page-kind={gameContext ? "game" : pageKind} id="main-content" dir="rtl"><InternalHeader gameContext={gameContext} soundRole={soundRole} /><div className="imposter-shell page-rail">{children}</div></main>; }
function Heading({ subtitle, children, setup = false }: { subtitle: string; children?: ReactNode; setup?: boolean }) {
  return <header className={setup ? 'imposter-top game-artwork-heading' : 'imposter-top'}>
    <div className="imposter-heading">
      {!setup && <ImposterMark className="imposter-mark" />}
      <div><p className="imposter-eyebrow">الميدان · الدخيل</p><h1>{subtitle}</h1></div>
    </div>
    {setup && <GameArtwork game="imposter" />}
    {children}
  </header>;
}

export function ImposterNewRoute() {
  const navigate = useNavigate();
  const { user, status } = useFirebaseAuth();
  const verified = Boolean(user && !user.isAnonymous && user.emailVerified);
  const unverified = Boolean(user && !user.isAnonymous && !user.emailVerified);
  const { fields, signIn } = useSetupSignIn(verified);
  const scope = `imposter:${verified && user ? user.uid : 'guest'}`;
  const [name, setName] = useSetupDraft(`${scope}:name`, '', undefined, fields?.name);
  const [selected, setSelected] = useSetupDraft<string[]>(`${scope}:categories`, [...categories], value => Array.isArray(value) && value.length <= categories.length && value.every(item => categories.includes(item)), fields?.categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null), categoryInput = useRef<HTMLInputElement>(null);
  const unavailable = isStaticPreviewBuild() || imposterRuntimeKind() === 'fixture';
  useEffect(() => { document.title = 'إنشاء غرفة الدخيل | الميدان'; }, []);
  async function create(event: FormEvent) {
    event.preventDefault(); if (busy || unavailable || unverified || status === 'loading') return;
    if (!validName(name.trim())) { setError('اكتب اسمك من 1 إلى 48 حرفاً بدون رموز خاصة.'); nameInput.current?.focus(); return; }
    if (!selected.length) { setError('اختاروا فئة واحدة على الأقل.'); categoryInput.current?.focus(); return; }
    if (!verified) { signIn({ name, categories: selected }); return; }
    setBusy(true); setError('');
    try { const room = await createImposterRoom(name.trim(), selected); navigate(`/room/${room.roomCode}/imposter`); } catch (failure) { setError(imposterError(failure)); } finally { setBusy(false); }
  }
  const submitLabel = !verified && !unverified && !unavailable ? 'سجّل الدخول لإنشاء الغرفة' : 'أنشئ الغرفة';
  return <Page><Heading subtitle="واحد منكم ما يدري!" setup /><div className="imposter-grid"><section className="imposter-panel">
    <h2>أنشئ غرفة الدخيل</h2><p className="imposter-muted">3–8 لاعبين · جلسة مستقلة لكل لاعب · جولتان من التلميحات</p><p>الكل يعرف الكلمة… إلا واحد. لمّح، راقب، واكشف الدخيل!</p>
    <form className="imposter-stack" noValidate onChange={() => setError('')} onSubmit={create}>
      <label>اسمك في الغرفة<input ref={nameInput} name="displayName" autoComplete="name" maxLength={48} value={name} onChange={event => setName(event.target.value)} required disabled={busy || unavailable} /></label>
      <fieldset disabled={busy || unavailable}><legend>اختاروا الفئات</legend><div className="imposter-category-grid">{categories.map((category, index) => <label key={category}><input ref={index === 0 ? categoryInput : undefined} type="checkbox" checked={selected.includes(category)} onChange={event => { const checked = event.target.checked; setSelected(current => checked ? [...current, category] : current.filter(value => value !== category)); }} />{category}</label>)}</div></fieldset>
      {error && <p className="imposter-error" role="alert">{error}</p>}
      {unavailable && <p className="imposter-notice" role="status">الدخيل متاح في نسخة الميدان المحلية. اللعب المستضاف غير مفعّل حالياً.</p>}
      {!unavailable && unverified && user ? <VerifyEmailNotice user={user} /> : null}
      {!unavailable && status === 'loading' ? <p className="imposter-notice" role="status">جارٍ استعادة حساب المضيف…</p> : null}
      <button className="button button--primary" type="submit" disabled={busy || unavailable || unverified || status === 'loading'}>{busy ? 'جارٍ إنشاء الغرفة…' : submitLabel}</button>
    </form>
  </section><aside className="imposter-panel"><h2>كيف تفوز؟</h2><p>إذا تعرف الكلمة: أعط تلميحاً يثبت معرفتك بدون ما تفضحها.</p><p>إذا أنت الدخيل: اسمع، خمّن الموضوع، واندمج معهم!</p><div className="imposter-actions"><Link to="/how-to-play/imposter">تعلّم اللعبة</Link><Link to="/#room-code">عندي رمز غرفة</Link></div></aside></div></Page>;
}

/** D1 locators never enter Almaidan's existing E1/PG/board join adapters. */
export function ImposterJoinRoute() {
  const { roomCode: value = '' } = useParams();
  const roomCode = normalizeRoomCode(value);
  const navigate = useNavigate();
  const epoch = useRef(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unavailable = isStaticPreviewBuild() || imposterRuntimeKind() !== 'local';
  useLayoutEffect(() => { const generation = ++epoch.current; return () => { if (epoch.current === generation) epoch.current++; }; }, [roomCode]);
  useEffect(() => { document.title = 'انضم إلى الدخيل | الميدان'; }, []);
  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy || unavailable) return;
    const displayName = validateJoinDisplayName(name);
    if (!/^D1-[A-Z0-9]{8}$/.test(roomCode)) { setError('رمز الدخيل غير صالح. تحقق من الرمز مع المضيف.'); return; }
    if (!displayName) { setError(JOIN_NAME_MESSAGE); return; }
    const generation = epoch.current;
    setBusy(true); setError('');
    try {
      await joinImposterRoom(roomCode, displayName);
      if (epoch.current === generation) navigate(`/room/${roomCode}/imposter`);
    } catch (failure) { if (epoch.current === generation) setError(roomIsMissing(failure) ? unknownRoomMessage : imposterError(failure)); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  return <Page><Heading subtitle="انضم إلى الدخيل" /><section className="imposter-panel imposter-join"><p>رمز الغرفة <bdi dir="ltr">{roomCode}</bdi></p><p>ادخل باسمك بدون حساب؛ لا تشارك جهازك أثناء كشف السر.</p>{unavailable && <p className="imposter-notice" role="status">الانضمام للدخيل متاح في نسخة الميدان المحلية فقط.</p>}<form className="imposter-stack" noValidate onSubmit={join}><label>اسم اللاعب<input autoComplete="name" value={name} onChange={event => setName(event.target.value)} disabled={unavailable || busy} required /></label>{error && <p className="imposter-error" role="alert">{error}</p>}<button className="button button--primary" type="submit" disabled={busy || unavailable}>{busy ? 'جارٍ الدخول…' : 'دخول الغرفة'}</button></form><div className="imposter-actions"><Link to="/">غيّر الرمز</Link></div></section></Page>;
}

function Invite({ code }: { code: string }) {
  const { copyText, localStatus } = useCopyStatus();
  const link = `${location.origin}/room/${encodeURIComponent(code)}/join`;
  return <div className="imposter-invite">
    <RoomCode code={code} joinUrl={link} />
    <button className="button button--secondary" onClick={() => void copyText(link, 'تم نسخ الرابط', 'شاركوا رمز الغرفة الظاهر مع أصحابكم.')} type="button">نسخ رابط الدعوة</button>
    {localStatus ? <p role="status">{localStatus}</p> : null}
  </div>;
}

function LobbySettings({ projection: p, send, busy }: { projection: Projection; send: (command: Command) => Promise<void>; busy: boolean }) {
  const organizer = p.organizer === p.me;
  const update = (settings: Settings) => { void send({ type: 'settings', settings }); };
  return <div className="imposter-stack"><label>طريقة التلميح<select disabled={!organizer || busy} value={p.settings.mode} onChange={event => update({ ...p.settings, mode: event.target.value as Settings['mode'] })}><option value="spoken">كلام — مع بعض في نفس المكان</option><option value="typed">كتابة — مع مكالمة خارجية</option></select></label><label>إيقاع الجولة<select disabled={!organizer || busy} value={p.settings.pace} onChange={event => update({ ...p.settings, pace: event.target.value as Settings['pace'] })}>{Object.entries(paceLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><p className="imposter-muted">{paceDetails[p.settings.pace]}</p><fieldset disabled={!organizer || busy}><legend>الفئات — اختر واحدة أو أكثر</legend><div className="imposter-category-grid">{categories.map(category => <label key={category}><input type="checkbox" checked={p.settings.categories.includes(category)} onChange={event => update({ ...p.settings, categories: event.target.checked ? [...p.settings.categories, category] : p.settings.categories.filter(value => value !== category) })} />{category}</label>)}</div></fieldset>{p.settings.mode === 'typed' && <p className="imposter-muted">افتحوا مكالمتكم في تطبيق آخر؛ التلميحات هنا نصية، والنقاش في المكالمة.</p>}<p className="imposter-muted">تغيير الإعدادات يلغي استعداد الجميع. جولتان من الكلمات في كل إيقاع.</p></div>;
}

function Ballot({ p, send, disabled }: { p: Projection; send: (command: Command) => Promise<void>; disabled: boolean }) {
  const [selected, setSelected] = useState<string | null>();
  const targets = p.players.filter(player => player.uid !== p.me && p.candidates.includes(player.uid));
  return p.hasActed ? <div className="imposter-notice" role="status">تم تثبيت صوتك بسرية. ننتظر باقي الأصوات.</div> : <><p>{p.phase === 'runoff' ? 'اختر من المتعادلين. إذا تكرر التعادل يفوز الدخيل.' : 'اختر من تشك فيه. لا أحد يرى صوتك.'}</p><div className="imposter-votes">{targets.map(player => <button type="button" key={player.uid} aria-pressed={selected === player.uid} disabled={disabled} onClick={() => setSelected(player.uid)}><span className="imposter-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span>{player.name}</button>)}<button type="button" aria-pressed={selected === null} disabled={disabled} onClick={() => setSelected(null)}>أمتنع عن التصويت</button></div><button className="button button--primary" type="button" disabled={disabled || selected === undefined} onClick={() => { if (selected !== undefined) void send({ type: 'vote', target: selected }); }}>تأكيد التصويت</button><p className="imposter-muted">بعد التأكيد لا يمكن تغيير صوتك. تظهر النتيجة بعد تأكيد الجميع أو انتهاء الوقت.</p></>;
}

function ClueForm({ p, send, disabled }: { p: Projection; send: (command: Command) => Promise<void>; disabled: boolean }) {
  const [text, setText] = useState('');
  const isTurn = p.order[p.turn % p.order.length] === p.me;
  const speaker = p.players.find(player => player.uid === p.order[p.turn % p.order.length]);
  function submit(event: FormEvent) { event.preventDefault(); if (isTurn && !disabled) void send(p.settings.mode === 'typed' ? { type: 'clue', text } : { type: 'clue' }); }
  return <><p className="imposter-eyebrow">الدورة {Math.floor(p.turn / p.order.length) + 1} من 2</p><h2>{isTurn ? 'دورك الآن!' : `الدور على ${speaker?.name ?? 'اللاعب التالي'}`}</h2><p>كلمة واحدة مرتبطة بالسر. لا تفضح الكلمة، ولا تعطِ جملة!</p>{isTurn && <form className="imposter-stack" onSubmit={submit}>{p.settings.mode === 'typed' && <label>تلميحك — كلمة واحدة<input autoComplete="off" spellCheck={false} maxLength={80} value={text} onChange={event => setText(event.target.value)} disabled={disabled} required pattern="[\p{L}\p{M}]+" /></label>}<button className="button button--primary" type="submit" disabled={disabled || (p.settings.mode === 'typed' && (!/^[\p{L}\p{M}]{1,40}$/u.test(text) || !/\p{L}/u.test(text)))}>{p.settings.mode === 'typed' ? 'أرسل الكلمة' : 'تم — قلت كلمتي'}</button></form>}{!isTurn && <p className="imposter-notice">اسمع التلميح وانتظر دورك.</p>}</>;
}

function GuessForm({ p, send, disabled }: { p: Projection; send: (command: Command) => Promise<void>; disabled: boolean }) {
  const [guess, setGuess] = useState('');
  return p.role === 'imposter' ? <><h2>انكشفت… لكن باقي لك فرصة!</h2><p>ما الكلمة السرية؟ تخمين واحد صحيح يقلب النتيجة لصالحك.</p><form className="imposter-stack" onSubmit={event => { event.preventDefault(); if (guess.trim() && !disabled) void send({ type: 'guess', text: guess }); }}><label>تخمينك النهائي<input value={guess} onChange={event => setGuess(event.target.value)} autoComplete="off" spellCheck={false} maxLength={100} disabled={disabled} required /></label><button className="button button--primary" disabled={disabled || !guess.trim()} type="submit">ثبّت التخمين</button></form></> : <><h2>مسكتوا الدخيل!</h2><p>لا تقولون الكلمة! عند الدخيل فرصة أخيرة يخمّنها.</p><p className="imposter-notice">ننتظر التخمين أو انتهاء الوقت.</p></>;
}

function ResultView({ p }: { p: Projection }) {
  const result = p.result;
  if (!result) return null;
  const name = (uid: string) => p.players.find(player => player.uid === uid)?.name ?? 'لاعب';
  return <><div className="imposter-result-banner"><h2>{result.winner === 'imposter' ? 'فاز الدخيل!' : 'فاز أهل الكلمة!'}</h2><p>الدخيل: <strong>{name(result.imposter)}</strong></p><p className="imposter-result-word">{result.word}</p></div>{result.guess !== null && <p>التخمين الأخير: <strong>{result.guess}</strong></p>}<h3>نتيجة التصويت</h3><ul className="imposter-clues">{Object.entries(result.totals).map(([uid, count]) => <li key={uid}><span>{name(uid)}</span><strong>{formatNumber(count)}</strong></li>)}<li><span>امتناع / لم يصوّت</span><strong>{formatNumber(result.abstentions)}</strong></li></ul>{result.runoffTotals && <><h3>نتيجة الحسم</h3><ul className="imposter-clues">{Object.entries(result.runoffTotals).map(([uid, count]) => <li key={uid}><span>{name(uid)}</span><strong>{formatNumber(count)}</strong></li>)}<li><span>امتناع / لم يصوّت</span><strong>{formatNumber(result.runoffAbstentions ?? 0)}</strong></li></ul></>}</>;
}

export function ImposterRoomRoute() {
  const { roomCode = '' } = useParams();
  const normalized = normalizeRoomCode(roomCode);
  return <ImposterRoomSession key={normalized} roomCode={normalized} />;
}

export function imposterSoundCues(before: Projection, after: Projection): SoundCue[] {
  if (before.code !== after.code || before.round !== after.round || before.revision >= after.revision ||
      before.result || after.phase !== 'results' || !after.result) return [];
  if (after.result.guess !== null) return [after.result.winner === 'imposter' ? 'correct' : 'wrong', 'win'];
  return ['win'];
}

function ImposterRoomSession({ roomCode }: { roomCode: string }) {
  const navigate = useNavigate();
  const [session] = useState<Session | undefined>(() => loadSession(roomCode));
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(0);
  const [confirmation, setConfirmation] = useState<'cancel' | 'leave' | 'close'>();
  const [ended, setEnded] = useState('');
  const clockSample = useRef({ server: 0, local: 0 });
  const current = useRef<Snapshot | undefined>(undefined);
  const unavailable = isStaticPreviewBuild() || imposterRuntimeKind() === 'fixture';
  const apply = useCallback((value: Snapshot) => {
    if (current.current && (value.projection.revision < current.current.projection.revision || value.serverTime < current.current.serverTime)) return;
    current.current = value;
    clockSample.current = { server: value.serverTime, local: performance.now() };
    setClock(value.serverTime); setSnapshot(value); setConnected(true);
  }, []);
  useEffect(() => { document.title = 'الدخيل | الميدان'; }, []);
  useEffect(() => {
    if (!session || unavailable) return;
    let active = true;
    const receive = (value: Snapshot) => { if (active) apply(value); };
    const failure = (reason: Error) => {
      if (!active) return;
      // A removed seat or a vanished room cannot recover by reconnecting; say so and offer a rejoin.
      if (terminalImposterError(reason)) { clearSession(roomCode); setEnded(imposterError(reason)); return; }
      setError(imposterError(reason)); setConnected(false);
    };
    void resumeImposterRoom(session).then(receive).catch(failure);
    const unsubscribe = subscribeImposterRoom(session, receive, value => { if (active) setConnected(value); }, failure);
    const heartbeat = () => {
      const value = current.current;
      if (!active || !value || value.projection.phase === 'closed' || document.visibilityState === 'hidden') return;
      void submitImposterIntent(session, value.projection, { type: 'heartbeat' }).then(receive).catch((reason: unknown) => { if (active && !(reason instanceof Error && reason.message.includes('ROOM_CLOSED'))) setConnected(false); });
    };
    const resume = () => { if (document.visibilityState !== 'hidden') { setConnected(false); void resumeImposterRoom(session).then(receive).catch(failure); } };
    const heartbeatTimer = setInterval(heartbeat, 15_000);
    const clockTimer = setInterval(() => { if (active) setClock(clockSample.current.server + performance.now() - clockSample.current.local); }, 250);
    window.addEventListener('online', resume); window.addEventListener('offline', resume); window.addEventListener('focus', resume); document.addEventListener('visibilitychange', resume);
    return () => { active = false; unsubscribe(); clearInterval(heartbeatTimer); clearInterval(clockTimer); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); current.current = undefined; };
  }, [session, unavailable, apply, roomCode]);
  const p = snapshot?.projection;
  const soundRole = p && p.organizer === p.me ? 'host' : 'player';
  const remaining = p?.deadline ? Math.max(0, Math.ceil((p.deadline - clock) / 1_000)) : null;
  useCountdownSound(soundRole, connected && p?.deadline ? `${p.phaseId}:${p.deadline}` : null, remaining,
    p?.deadline ?? undefined, connected ? snapshot?.serverTime : undefined);
  useGameSoundTransition(soundRole, connected ? p : null, imposterSoundCues);
  useEffect(() => {
    if (!session || !p?.deadline || !connected) return;
    let active = true; let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = async (attempt: number) => {
      try { const value = await syncImposterRoom(session); if (active) { apply(value); if (value.projection.phaseId === p.phaseId && value.projection.deadline === p.deadline && attempt < 3) retryTimer = setTimeout(() => void sync(attempt + 1), 750 * (attempt + 1)); } }
      catch (failure) { if (active && attempt < 3) retryTimer = setTimeout(() => void sync(attempt + 1), 1_000 * (attempt + 1)); else if (active) { setError(imposterError(failure)); setConnected(false); } }
    };
    const timer = setTimeout(() => void sync(0), Math.max(0, p.deadline - (clockSample.current.server + performance.now() - clockSample.current.local)) + 100);
    return () => { active = false; clearTimeout(timer); clearTimeout(retryTimer); };
  }, [session, p?.phaseId, p?.deadline, connected, apply]);
  async function send(command: Command) {
    if (!session || !p || busy) return;
    setBusy(true); setError('');
    try { const result = await submitImposterIntent(session, p, command); if (command.type === 'leave') { clearSession(roomCode); navigate('/'); } else apply(result); }
    catch (failure) { setError(imposterError(failure)); }
    finally { setBusy(false); setConfirmation(undefined); }
  }
  if (!session || unavailable) return <Page gameContext soundRole={soundRole}><Heading subtitle="انضم إلى الشلة" /><section className="imposter-panel"><p>{unavailable ? 'اللعب غير متاح في المعاينة.' : 'انضم إلى الغرفة باسمك أولاً. إذا أُغلقت صفحتك، ادخل بنفس اسمك لتستعيد مكانك.'}</p><div className="imposter-actions"><Link className="button button--primary" to={`/room/${roomCode}/join`}>الانضمام إلى الغرفة</Link><Link to="/">الرئيسية</Link></div></section></Page>;
  if (ended) return <Page gameContext soundRole={soundRole}><Heading subtitle="خرجت من الغرفة" /><section className="imposter-panel"><p role="alert">{ended}</p><div className="imposter-actions"><Link className="button button--primary" to={`/room/${roomCode}/join`}>الانضمام من جديد</Link><Link to="/">الرئيسية</Link></div></section></Page>;
  if (!p) return <Page gameContext soundRole={soundRole}><Heading subtitle="جارٍ فتح الغرفة…" />{error && <p className="imposter-error" role="alert">{error}</p>}<button type="button" className="button button--quiet" onClick={() => window.location.reload()}>أعد الاتصال</button></Page>;
  const disabled = busy || !connected || remaining === 0;
  const organizer = p.organizer === p.me;
  const lobby = p.phase === 'lobby';
  const canReplay = p.phase === 'results' || p.phase === 'cancelled';
  const me = p.players.find(player => player.uid === p.me);
  const canStart = p.players.length >= 3 && p.players.every(player => player.ready && player.connected) && p.settings.categories.length > 0 && !p.contentExhausted;
  const speakerUid = p.phase === 'clues' ? p.order[p.turn % p.order.length] : undefined;
  return <Page gameContext soundRole={soundRole}><Heading subtitle={phaseTitles[p.phase]}><div className="imposter-clock">{remaining !== null && <><span>الوقت المتبقي</span><strong role="timer">{formatSeconds(remaining)}</strong><span className="sr-only" role="status">{remaining === 0 ? 'انتهى الوقت، جارٍ تحديث المرحلة' : remaining <= 5 ? 'بقي أقل من خمس ثوانٍ' : ''}</span></>}</div></Heading>
    {!connected && <div className="imposter-notice" role="status">نعيد الاتصال… يظل سرّك مخفي لين ترجع اللعبة.</div>}{error && <p className="imposter-error" role="alert">{error}</p>}
    <div className="imposter-grid"><div><section className="imposter-panel" aria-label="مرحلة اللعب">
      {p.phase === 'results' && <ResultView p={p} />}
      {p.phase === 'closed' && <><h2>انتهت الجلسة</h2><p>أغلق المضيف الغرفة. تقدرون تبدؤون جلسة جديدة.</p><Link className="button button--primary" to="/host/new?kind=imposter">أنشئ غرفة جديدة</Link></>}
      {canReplay && <div className="imposter-actions">{organizer ? <button className="button button--primary" disabled={busy || !connected} type="button" onClick={() => void send({ type: 'replay' })}>جولة جديدة</button> : <p className="imposter-notice">ننتظر المضيف ليبدأ جولة جديدة.</p>}</div>}
      {p.phase === 'cancelled' && <><h2>أُلغيت الجولة بدون فائز</h2><p>لم يُكشف السر. استعدوا لجولة جديدة أو عدّلوا الإعدادات.</p></>}
      {lobby && <><Invite code={roomCode} /><p className="imposter-muted">كل لاعب يحتاج جهازه. المضيف يلعب معكم، وسرّه مثل سرّ أي لاعب.</p><div className="imposter-actions"><button className="button button--primary" disabled={busy || !connected} onClick={() => void send({ type: 'ready', ready: !me?.ready })} type="button">{me?.ready ? 'أنا غير مستعد' : 'أنا مستعد'}</button>{organizer && <button className="button button--quiet" disabled={busy || !connected || !canStart} type="button" onClick={() => void send({ type: 'start' })}>ابدأ الجولة</button>}</div>{p.contentExhausted && <p className="imposter-notice">انتهت كلمات الفئات المختارة. غيّر الفئات أو أنشئ غرفة جديدة.</p>}{!canStart && <p className="imposter-muted">نحتاج 3–8 لاعبين متصلين، وكلهم مستعدون، وفئة واحدة على الأقل.</p>}</>}
      {p.phase === 'reveal' && <><p>اعرض سرك بعيداً عن العيون، ثم أكّد استعدادك قبل انتهاء الوقت. تبدأ التلميحات عندما يستعد الجميع.</p>{!p.hasActed ? <button className="button button--primary" type="button" disabled={disabled} onClick={() => void send({ type: 'ack' })}>عرفت دوري — جاهز</button> : <p role="status" className="imposter-notice">تم التأكيد. ننتظر الباقين.</p>}</>}
      {p.phase === 'clues' && <ClueForm key={p.phaseId + p.turn} p={p} send={send} disabled={disabled} />}
      {p.phase === 'discussion' && <><h2>ناقشوا التلميحات</h2><p>مين أعطى كلمة عامة؟ ومين تلميحه بعيد عن الموضوع؟ اسمعوا بعض بدون ما تقولون السر.</p><p className="imposter-notice">يبدأ التصويت تلقائياً عند انتهاء الوقت.</p>{organizer && <button className="button button--primary" type="button" disabled={disabled} onClick={() => void send({ type: 'startVote' })}>ابدأوا التصويت الآن</button>}</>}
      {(p.phase === 'vote' || p.phase === 'runoff') && <Ballot key={p.phaseId} p={p} send={send} disabled={disabled} />}
      {p.phase === 'guess' && <GuessForm key={p.phaseId} p={p} send={send} disabled={disabled} />}
    </section>
    {activePhases.has(p.phase) && p.phase !== 'guess' && <section className="imposter-panel" aria-label="سرك الخاص"><PrivateReveal identity={`${p.round}:${p.phaseId}:${p.me}`} disabled={!connected || remaining === 0}>{p.role === 'imposter' ? <><strong>أنت الدخيل!</strong><p>الفئة: {p.category}</p><p>اسمع التلميحات وحاول تندمج.</p></> : <><p>أنت تعرف الكلمة · {p.category}</p><strong>{p.word}</strong><p>لمّح بدون ما تفضح السر.</p></>}</PrivateReveal></section>}
    {p.clues.length > 0 && <section className="imposter-panel"><h2>التلميحات</h2><ol className="imposter-clues">{p.clues.map((clue, index) => <li key={`${index}:${clue.uid}`}><span>{p.players.find(player => player.uid === clue.uid)?.name}</span><strong>{clue.text ?? (p.settings.mode === 'spoken' ? 'دور شفهي / انقضى الوقت' : 'انقضى الوقت')}</strong></li>)}</ol></section>}
    </div><aside><section className="imposter-panel"><h2>الشلة · {formatNumber(p.players.length)} / 8</h2><ul className="imposter-players">{(p.order.length && !lobby ? p.order.map(uid => p.players.find(player => player.uid === uid)).filter((player): player is Projection['players'][number] => Boolean(player)) : p.players).map(player => <li key={player.uid} className={speakerUid === player.uid ? 'imposter-current' : ''}><span className="imposter-avatar" aria-hidden="true">{player.name.slice(0, 1)}</span><span className="imposter-player-name"><bdi>{player.name}</bdi>{player.uid === p.me ? ' (أنت)' : ''}<small>{player.uid === p.organizer ? 'المضيف · ' : ''}{player.connected ? 'متصل' : 'غير متصل'}{lobby ? ` · ${player.ready ? 'مستعد' : 'ينتظر'}` : ''}</small></span>{organizer && lobby && player.uid !== p.me && <button className="button button--quiet" aria-label={`إزالة ${player.name}`} disabled={busy || !connected} type="button" onClick={() => void send({ type: 'remove', uid: player.uid })}>إزالة</button>}</li>)}</ul></section>
    {lobby && <section className="imposter-panel"><h2>إعدادات الجولة</h2><LobbySettings projection={p} send={send} busy={busy || !connected} /></section>}
    {confirmation ? <ConfirmDialog open
      title={{ close: 'إغلاق الغرفة', cancel: 'إلغاء الجولة', leave: 'مغادرة الغرفة' }[confirmation]}
      description={{ close: 'بتتقفل الغرفة على كل اللاعبين.', cancel: 'بتنتهي الجولة بلا فائز وتبقى الكلمة مخفية.', leave: 'بتطلع من الغرفة. إذا الجولة جارية، اللعب بيكمل مع الباقين.' }[confirmation]}
      confirmLabel={{ close: 'أغلق الغرفة', cancel: 'ألغِ الجولة', leave: 'غادر الغرفة' }[confirmation]}
      busy={busy} onCancel={() => setConfirmation(undefined)} onConfirm={() => void send({ type: confirmation })} /> : null}
    <section className="imposter-panel"><Link to="/how-to-play/imposter" target="_blank" rel="noreferrer">قواعد الدخيل <Icon kind="arrow-up-right" /></Link><div className="imposter-actions">{organizer && activePhases.has(p.phase) && <button className="button button--quiet" type="button" disabled={busy || !connected} onClick={() => setConfirmation('cancel')}>إلغاء الجولة</button>}{organizer && (lobby || canReplay) && <button className="button button--quiet" type="button" disabled={busy || !connected} onClick={() => setConfirmation('close')}>إغلاق الغرفة</button>}{p.phase !== 'closed' && <button className="button button--quiet" disabled={busy || !connected} type="button" onClick={() => setConfirmation('leave')}>مغادرة الغرفة</button>}</div></section>
    </aside></div></Page>;
}

export function ImposterTutorialRoute() {
  useEffect(() => { document.title = 'كيف تلعب الدخيل؟ | الميدان'; }, []);
  return <StatusPage title="كيف تلعب الدخيل؟" illustration={<GameArtwork game="imposter" sizes="(max-width: 36rem) 6rem, 13rem" />}
    action={<Link className="button button--primary" to="/host/new?kind=imposter">أنشئ غرفة الدخيل</Link>}>
    <p>الكل يعرف… إلا واحد! العبوا من 3 إلى 8 لاعبين، وكل واحد على جهازه. المضيف يلعب معكم.</p>
    <ol>
      <li><strong>شوف سرك لحالك. </strong>الجميع يعرف الكلمة والفئة، إلا الدخيل يعرف الفئة فقط. اضغط مطولاً لكشف السر وارفع إصبعك لإخفائه.</li>
      <li><strong>لمّح بكلمة. </strong>كل لاعب يعطي كلمة واحدة في دوره. نكمل دورتين بنفس الترتيب، وإذا انتهى الوقت ينتقل الدور.</li>
      <li><strong>وازن تلميحك. </strong>لو الكلمة «برجر»، تلميح «خبز» واضح جداً. «مشوار» أخف، ويخلي أهل الكلمة يفهمون بدون ما تساعد الدخيل كثيراً.</li>
      <li><strong>إذا أنت الدخيل. </strong>اسمع الكلمات وحاول تفهم الموضوع، ثم قل كلمة تناسب الجو.</li>
      <li><strong>ناقشوا ثم صوّتوا بسرية. </strong>المضيف يقدر يبدأ التصويت فوراً. تظهر النتيجة لما يؤكّد كل المتصلين أصواتهم أو ينتهي الوقت. الصوت المؤكّد ما يتغيّر. إذا تعادلوا تصوّتون بين المتعادلين. إذا تعادلوا مرة ثانية أو ما أحد صوّت، يهرب الدخيل.</li>
      <li><strong>لا تفضحون الكلمة في النهاية! </strong>إذا مسكتوا الدخيل، عنده تخمين أخير. إذا صح يفوز، وإذا غلط أو انتهى الوقت تفوزون أنتم.</li>
    </ol>
    <p>قولوا كلمة واحدة لكل تلميح. إذا تكتبون التلميح، اكتبوها بدون مسافات. تقدرون تمتنعون عن التصويت.</p>
  </StatusPage>;
}
