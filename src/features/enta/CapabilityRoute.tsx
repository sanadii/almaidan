import { useEffect, useRef, useState } from 'react';
import { EntaShell } from '../../routes/EntaRoutes';
import { isStaticPreviewBuild } from '../game/runtime/static-preview';
import { EntaClientError } from './client';
import { exactRound, grantRequest, parseGrading, parseGrantMetadata, parsePublicMedia, type CapabilityView } from './round-client';
import { CanvasBoard } from './CanvasBoard';
import { MediaGallery } from './RoundRoutes';
import '../../styles/enta-rounds.css';
function parseCapability(input: unknown): CapabilityView {
  if (!input || typeof input !== 'object') throw new EntaClientError('MALFORMED_RESPONSE'); const value = input as Record<string, unknown>;
  exactRound(value, ['grant', 'gameId', 'gameVersion', 'serverNow', 'roundId', 'version', 'format', 'role', 'deadlineAt', 'media', ...(value.role === 'JUDGE' ? ['grading'] : ['target', 'canvas'])]); const grant = parseGrantMetadata(value.grant);
  if (!['JUDGE', 'ACTOR'].includes(value.role as string) || grant.role !== value.role || grant.roundId !== value.roundId || grant.revoked || typeof value.gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.gameId) || typeof value.roundId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.roundId) || !Number.isSafeInteger(value.version) || (value.version as number) < 1 || !Number.isSafeInteger(value.gameVersion) || (value.gameVersion as number) < 1 || typeof value.serverNow !== 'number' || !Number.isFinite(value.serverNow) || (value.deadlineAt !== null && (typeof value.deadlineAt !== 'number' || !Number.isFinite(value.deadlineAt))) || !Array.isArray(value.media) || value.media.length > 260 || !(value.role === 'JUDGE' ? ['LIST_ITEMS', 'ACTING_ITEMS'] : ['DRAWING_TARGET', 'ACTING_ITEMS']).includes(value.format as string)) throw new EntaClientError('MALFORMED_RESPONSE');
  if (value.role === 'JUDGE') { const grading = parseGrading(value.grading); if (grading.roundId !== value.roundId || grading.version !== value.version || grading.format !== value.format) throw new EntaClientError('MALFORMED_RESPONSE'); }
  else if (typeof value.target !== 'string' || value.target.length > 512) throw new EntaClientError('MALFORMED_RESPONSE');
  value.media.forEach(parsePublicMedia);
  if (value.canvas !== undefined && value.canvas !== null) { const canvas = exactRound(value.canvas, ['revision']); if (!Number.isSafeInteger(canvas.revision) || (canvas.revision as number) < 0 || (canvas.revision as number) > 512) throw new EntaClientError('MALFORMED_RESPONSE'); }
  return value as unknown as CapabilityView;
}
export function EntaCapabilityRoute() { return <EntaShell title="جهاز الجولة"><CapabilityViewPage /></EntaShell>; }
export function CapabilityViewPage() {
  const token = useRef<string | null>(null), consumed = useRef(false), epoch = useRef(0), abort = useRef<AbortController | null>(null), [view, setView] = useState<CapabilityView | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<unknown>(null), [attempt, setAttempt] = useState(0);
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
      try { const next = parseCapability(await grantRequest('/view', token.current, controller.signal)); if (generation !== epoch.current || controller.signal.aborted || closed) return; setView(previous => previous && previous.roundId === next.roundId && previous.grant.id === next.grant.id && previous.gameVersion > next.gameVersion ? previous : next); setLoading(false); setError(null); }
      catch (error) { if (generation !== epoch.current || controller.signal.aborted || closed) return; setLoading(false); setView(null); setError(error); if (error instanceof EntaClientError && [403, 409].includes(error.status)) { token.current = null; closed = true; epoch.current++; } }
    };
    void fetchView(); timer = window.setInterval(() => void fetchView(), 1500);
    return () => { closed = true; epoch.current++; abort.current?.abort(); if (timer !== null) window.clearInterval(timer); setView(null); };
  }, [attempt]);
  useEffect(() => { if (!view) return; const lifetime = view.grant.expiresAt - view.serverNow; if (lifetime <= 0) { token.current = null; setView(null); return; } const timer = window.setTimeout(() => { epoch.current++; abort.current?.abort(); token.current = null; setView(null); setError(new EntaClientError('GRANT_DENIED', 403)); }, lifetime); return () => window.clearTimeout(timer); }, [view?.grant.expiresAt, view?.serverNow]);
  if (loading) return <div className="enta-state" aria-busy="true"><p role="status">جارٍ التحقق من رمز الجولة…</p></div>;
  if (!view || !token.current) return <div className="enta-state"><h2>{isStaticPreviewBuild() ? 'جهاز الجولة غير متاح في المعاينة' : 'امسح رمز الجولة من جديد'}</h2><p role={error ? 'alert' : 'status'}>{error ? 'الرمز غير متاح أو انتهى أو ألغاه المضيف. لا يمكن عرض الإجابات الآن.' : 'رمز الجهاز يعمل للجولة والتعيين الحاليين فقط. بعد إعادة التحميل اطلب رمزاً من المضيف.'}</p>{token.current ? <button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>إعادة المحاولة</button> : null}</div>;
  const authority = { token: token.current }, scopeEpoch = `${view.grant.id}:${view.grant.generation}:${view.roundId}:${view.version}`;
  return <section className="enta-question enta-capability"><p className="eyebrow">{view.role === 'JUDGE' ? 'الحكم — قراءة فقط' : 'اللاعب المكلّف'}</p>{view.role === 'JUDGE' && 'grading' in view ? <><h2>دليل الجولة الحالية</h2><ul className="enta-grading-items">{view.grading!.items.map(item => <li key={item.id}><span>{item.text}</span><strong>{item.trap ? `فخ −${item.value}` : `+${item.value}`}</strong><small>{item.consumed ? 'احتُسبت' : 'لم تُحتسب'}</small></li>)}</ul></> : 'target' in view ? <><h2>كلمتك في هذه الجولة</h2><p className="enta-actor-target">{view.target}</p><p>اعرضها بالتمثيل أو الرسم لفريقك. احتساب النقاط عند المضيف.</p></> : null}<MediaGallery media={view.media} authority={authority} epoch={scopeEpoch} />{'canvas' in view && view.canvas ? <CanvasBoard authority={authority} roundId={view.roundId} revision={view.canvas.revision} epoch={`${view.grant.id}:${view.grant.generation}:${view.roundId}`} writable /> : null}</section>;
}
