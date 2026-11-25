import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { InternalHeader } from '../../design-system/InternalHeader';
import { StatusArt, StatusHomeLink, StatusPage } from '../../design-system/StatusPanel';
import { useFirebaseAuth } from '../auth/auth-context';
import { ownerGeneration, subscribeOwnerGeneration } from '../enta/auth-epoch';
import { studyPost } from './client';

type View = { sessionId: string; progress: { answered: number; total: number }; question: null | { id: string; prompt: string; choices: { id: string; text: string }[] }; correct?: boolean };
function parseView(value: unknown): View {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\p{Cc}\p{Cf}]/u.test(v);
  const bad = (): never => { throw new Error('MALFORMED_STUDY'); };
  if (!object(value) || !keys(value, ['sessionId', 'progress', 'question'], ['correct']) || !text(value.sessionId, 100) || ('correct' in value && typeof value.correct !== 'boolean') || !object(value.progress) || !keys(value.progress, ['answered', 'total'])) return bad();
  const { answered, total } = value.progress;
  if (!Number.isInteger(answered) || !Number.isInteger(total) || (total as number) < 1 || (total as number) > 50 || (answered as number) < 0 || (answered as number) > (total as number)) return bad();
  if ((value.question === null) !== (answered === total)) return bad();
  if (value.question !== null) {
    const q = value.question;
    if (!object(q) || !keys(q, ['id', 'prompt', 'choices']) || !text(q.id, 100) || !text(q.prompt, 4000) || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6) return bad();
    const ids = new Set<string>();
    for (const choice of q.choices) {
      if (!object(choice) || !keys(choice, ['id', 'text']) || !text(choice.id, 100) || !text(choice.text, 1000) || ids.has(choice.id)) return bad();
      ids.add(choice.id);
    }
  }
  return value as View;
}
export function StudyRoute({ available = false }: { available?: boolean } = {}) {
  const { user, status } = useFirebaseAuth(); const epoch = useSyncExternalStore(subscribeOwnerGeneration, ownerGeneration, ownerGeneration); const viewKey = `${user?.uid ?? ''}:${epoch}`; const [view, setView] = useState<View | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [pending, setPending] = useState<{ path: string; body: object } | null>(null); const generation = useRef(0); const inFlight = useRef(false); const renderedKey = useRef(viewKey); const stateKey = useRef(viewKey); if (renderedKey.current !== viewKey) { renderedKey.current = viewKey; generation.current++; inFlight.current = false; }
  useEffect(() => { document.title = 'التدريب | الميدان'; }, []);
  useEffect(() => { generation.current++; setView(null); setMessage(''); setBusy(false); setPending(null); inFlight.current = false; stateKey.current = viewKey; return () => { generation.current++; }; }, [viewKey]);
  async function act(path: string, body: object) {
    if (!user || inFlight.current) return; const current = generation.current; inFlight.current = true; setBusy(true); setMessage(''); setPending({ path, body });
    try { const result = parseView(await studyPost(path, user, body, new AbortController().signal)); if (current === generation.current) { setView(result); setPending(null); } }
    catch { if (current === generation.current) setMessage('تعذر تأكيد الطلب. أعد المحاولة للتحقق من النتيجة.'); }
    finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const safeView = stateKey.current === viewKey ? view : null; const safePending = stateKey.current === viewKey ? pending : null; const safeMessage = stateKey.current === viewKey ? message : ''; const safeBusy = stateKey.current === viewKey && busy;
  if (!available) return <StatusPage title="التدريب" illustration={<StatusArt art="buzzer" />} action={<StatusHomeLink />}>
    <p role="status">التدريب غير متاح حالياً.</p>
  </StatusPage>;
  return <main data-page-layout="wide" className="maydan-app maydan-public-page" id="main-content" tabIndex={-1}><InternalHeader /><section className="maydan-credits" aria-labelledby="study-title"><div><p className="eyebrow">الميدان</p><h1 id="study-title">التدريب</h1>
    {!user ? <p>{status === 'loading' ? 'جارٍ التحقق من الحساب…' : <>سجّل الدخول لبدء التدريب. <Link to="/login">تسجيل الدخول</Link></>}</p> : !safeView ? <><p>أجب عن الأسئلة واحداً تلو الآخر.</p><button type="button" className="button button--primary" disabled={safeBusy || !!safePending} onClick={() => void act('/sessions', { requestId: crypto.randomUUID() })}>ابدأ التدريب</button></> : <><p>أجبت عن {safeView.progress.answered} من {safeView.progress.total}</p>{safeView.correct !== undefined ? <p role="status">{safeView.correct ? 'إجابة صحيحة' : 'إجابة غير صحيحة'}</p> : null}{safeView.question ? <><h2>{safeView.question.prompt}</h2><div>{safeView.question.choices.map(choice => <button type="button" className="button" key={choice.id} disabled={safeBusy || !!safePending} onClick={() => void act(`/sessions/${encodeURIComponent(safeView.sessionId)}/answers`, { questionId: safeView.question!.id, choiceId: choice.id })}>{choice.text}</button>)}</div></> : <p>اكتملت جلسة التدريب.</p>}</>}
    {safeMessage ? <p role="alert">{safeMessage}</p> : null}{safePending && !safeBusy ? <button type="button" className="button" onClick={() => void act(safePending.path, safePending.body)}>إعادة المحاولة</button> : null}<StatusHomeLink /></div></section></main>;
}
