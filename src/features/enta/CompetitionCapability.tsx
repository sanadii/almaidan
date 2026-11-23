import { useEffect, useRef, useState } from 'react';
import { EntaShell } from '../../routes/EntaRoutes';
import { isStaticPreviewBuild } from '../game/runtime/static-preview';
import { EntaClientError } from './client';
import { competitionRequest, parseCompetitionCapability, type CompetitionCapability } from './competition-client';
import { CanvasBoard } from './CanvasBoard';
import { CompetitionMedia } from './CompetitionRoutes';
import { CompetitionGradingMedia } from './CompetitionGradingMedia';
import { CompetitionPageControls } from './CompetitionPageControls';
import { useCompetitionPage } from './use-competition-page';
import { parseGradingRow, parseMediaRow } from './competition-page-client';
import '../../styles/enta-competition.css';
import '../../styles/enta-rounds.css';
export function EntaCompetitionCapabilityRoute() { return <EntaShell title="جهاز الجولة"><CompetitionCapabilityPage /></EntaShell>; }
export function CompetitionCapabilityPage() {
  const token = useRef<string | null>(null), consumed = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), [view, setView] = useState<CompetitionCapability | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const rescan = () => { const match = /^#grant=([A-Za-z0-9_-]{43})$/.exec(window.location.hash); window.history.replaceState(window.history.state, '', window.location.pathname); epoch.current++; abort.current?.abort(); token.current = match?.[1] ?? null; consumed.current = true; setView(null); setError(null); setLoading(!!token.current); setAttempt(value => value + 1); };
    window.addEventListener('hashchange', rescan); return () => window.removeEventListener('hashchange', rescan);
  }, []);
  useEffect(() => {
    if (!consumed.current) { consumed.current = true; const fragment = window.location.hash, match = /^#grant=([A-Za-z0-9_-]{43})$/.exec(fragment); token.current = match?.[1] ?? null; window.history.replaceState(window.history.state, '', window.location.pathname); }
    // No Firebase initialization, login, category or general host fallback.
    if (!token.current || isStaticPreviewBuild()) { setLoading(false); setView(null); return; }
    const generation = ++epoch.current; let timer: number | null = null, closed = false;
    const fetchView = async () => {
      if (closed || !token.current) return; const controller = new AbortController(); abort.current?.abort(); abort.current = controller;
      try { const next = parseCompetitionCapability(await competitionRequest('/capability/view', { token: token.current }, controller.signal)); if (generation !== epoch.current || controller.signal.aborted || closed) return; setView(previous => previous && previous.roundId === next.roundId && previous.grant.id === next.grant.id && previous.gameVersion > next.gameVersion ? previous : next); setLoading(false); setError(null); }
      catch (error) { if (generation !== epoch.current || controller.signal.aborted || closed) return; setLoading(false); setView(null); setError(error); if (error instanceof EntaClientError && [403, 409].includes(error.status)) { token.current = null; closed = true; epoch.current++; } }
    };
    void fetchView(); timer = window.setInterval(() => void fetchView(), 1500);
    return () => { closed = true; epoch.current++; abort.current?.abort(); if (timer !== null) window.clearInterval(timer); setView(null); };
  }, [attempt]);
  useEffect(() => { if (!view) return; const lifetime = Math.min(view.grant.expiresAt, view.deadline ?? Infinity) - view.serverNow; if (lifetime <= 0) { token.current = null; setView(null); return; } const timer = window.setTimeout(() => { epoch.current++; abort.current?.abort(); token.current = null; setView(null); setError(new EntaClientError('GRANT_DENIED', 403)); }, lifetime); return () => window.clearTimeout(timer); }, [view?.grant.expiresAt, view?.serverNow, view?.deadline]);
  if (loading) return <div className="enta-state" aria-busy="true"><p role="status">جارٍ التحقق من رمز الجولة…</p></div>;
  if (!view || !token.current) return <div className="enta-state"><h2>{isStaticPreviewBuild() ? 'جهاز الجولة غير متاح في المعاينة' : 'امسح رمز الجولة من جديد'}</h2><p role={error ? 'alert' : 'status'}>{error ? 'الرمز غير متاح أو انتهى أو ألغاه المضيف. لا يمكن عرض الإجابات الآن.' : 'رمز الجهاز يعمل للجولة والتعيين الحاليين فقط. بعد إعادة التحميل اطلب رمزاً من المضيف.'}</p>{token.current ? <button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>إعادة المحاولة</button> : null}</div>;
  const invalidate = (error: unknown) => { epoch.current++; abort.current?.abort(); token.current = null; setView(null); setLoading(false); setError(error); };
  return <CapabilityTask key={`${view.grant.id}:${view.grant.generation}:${view.roundId}:${view.roundVersion}`} view={view} token={token.current} onUnavailable={invalidate} />;
}
function CapabilityTask({ view, token, onUnavailable }: { view: CompetitionCapability; token: string; onUnavailable: (error: unknown) => void }) {
  const scopeEpoch = `${view.grant.id}:${view.grant.generation}:${view.roundId}:${view.roundVersion}`, authority = { token, competition: true };
  const input = { user: null, token, authorityKey: scopeEpoch, purpose: view.role, gameId: view.gameId, version: view.gameVersion, roundId: view.roundId, effectId: null };
  const media = useCompetitionPage({ ...input, collection: 'media', enabled: view.mediaTotal > 0, parseRow: parseMediaRow });
  const grading = useCompetitionPage({ ...input, collection: 'grading', enabled: view.role === 'JUDGE', parseRow: parseGradingRow });
  const [selected, setSelected] = useState<string | null>(null), unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  useEffect(() => { if (selected && !grading.page?.rows.some(row => row.id === selected)) setSelected(null); }, [grading.page, selected]);
  useEffect(() => { const error = media.error ?? grading.error; if (error) unavailable.current(error); }, [media.error, grading.error]);
  return <section className="enta-question enta-capability"><p className="eyebrow">{view.role === 'JUDGE' ? 'الحكم — قراءة فقط' : 'اللاعب المكلّف'}</p>{view.role === 'JUDGE' ? <><h2>دليل الجولة الحالية</h2><CompetitionPageControls state={grading} pageSize={16} label="إجابات دليل الحكم" /><ul className="enta-grading-items">{grading.page?.rows.map(item => <li key={item.id}><span>{item.text}</span><strong>{item.trap ? `فخ −${item.value}` : `+${item.value}`}</strong><small>{item.consumed ? 'احتُسبت' : 'لم تُحتسب'}</small>{item.mediaIds?.length ? <button type="button" className="button" onClick={() => setSelected(item.id)}>وسائط الإجابة</button> : null}</li>)}</ul>{selected ? <CompetitionGradingMedia key={selected} ids={grading.page?.rows.find(row => row.id === selected)?.mediaIds ?? []} token={token} gameId={view.gameId} roundId={view.roundId} epoch={scopeEpoch} onUnavailable={onUnavailable} /> : null}</> : 'target' in view ? <><h2>كلمتك في هذه الجولة</h2><p className="enta-actor-target">{view.target}</p><p>اعرضها بالتمثيل أو الرسم لفريقك. احتساب النقاط عند المضيف.</p></> : null}<CompetitionPageControls state={media} label="وسائط الجولة" /><CompetitionMedia media={media.page?.rows ?? []} authority={authority} epoch={scopeEpoch} onUnavailable={onUnavailable} />{'canvas' in view && view.canvas ? <CanvasBoard authority={authority} roundId={view.roundId} revision={view.canvas.revision} epoch={`${view.grant.id}:${view.grant.generation}:${view.roundId}`} writable /> : null}</section>;
}
