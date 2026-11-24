import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EntaAccess, EntaSetup, EntaShell } from '../../routes/EntaRoutes';
import { useFirebaseAuth } from '../auth/auth-context';
import { EntaClientError, entaErrorText, pendingStartStorageKey, requestEnta, type HistoryProjection } from './client';
import { parseHistory, parseRematchSetup } from './history';
import { useOwnerGeneration } from './use-owner-generation';
import {HuroofHistory} from '../game/HuroofHistory';
import {PublicHuroofHistory} from '../game/PublicHuroofHistory';
import {isAlmaidanLocalDevelopment} from '../../lib/local-development';

export function EntaHistoryRoute() { return <EntaShell title={'مبارياتي في الميدان'}><EntaAccess>{isAlmaidanLocalDevelopment?<HuroofHistory/>:<PublicHuroofHistory/>}<HistoryView /></EntaAccess></EntaShell>; }
export function HistoryView() {
  const { user } = useFirebaseAuth(); const [mode, setMode] = useState(''), [format, setFormat] = useState(''), [rules, setRules] = useState(''), [status, setStatus] = useState(''), [cursorState, setCursorState] = useState<{generation:number;value:string|null}>({generation:-1,value:null}), [attempt, setAttempt] = useState(0);
  const ownerGeneration=useOwnerGeneration(); const baseKey = JSON.stringify([user?.uid ?? '',ownerGeneration,mode,format,rules,status]); const cursorOwner=useRef({key:baseKey,generation:0}); if(cursorOwner.current.key!==baseKey)cursorOwner.current={key:baseKey,generation:cursorOwner.current.generation+1}; const key=JSON.stringify([baseKey,cursorOwner.current.generation]); const cursor=cursorState.generation===cursorOwner.current.generation?cursorState.value:null; const setCursor=(value:string|null)=>setCursorState({generation:cursorOwner.current.generation,value}); const epoch = useRef(0);
  const [state, setState] = useState<{ key: string; value: HistoryProjection | null; loading: boolean; error: unknown }>({ key, value: null, loading: true, error: null });
  useEffect(() => {
    const generation = ++epoch.current, controller = new AbortController(); setState(previous => ({ key, value: cursor && previous.key === key ? previous.value : null, loading: true, error: null }));
    const params = new URLSearchParams(); if (mode) params.set('mode', mode); if (format) params.set('format', format); if (rules) params.set('rules', rules); if (status) params.set('status', status); if (cursor) params.set('cursor', cursor);
    if (user) void requestEnta(`/matches/history?${params}`, user, controller.signal).then(value => parseHistory(value, {mode,format,rules,status})).then(value => { if (generation !== epoch.current || controller.signal.aborted) return; setState(previous => {
      if (!cursor || previous.key !== key || !previous.value) return {key,value,loading:false,error:null};
      const prior=previous.value.matches.at(-1), first=value.matches[0], existing=new Set(previous.value.matches.map(row=>row.id));
      if ((prior && first && (first.createdAt>prior.createdAt || (first.createdAt===prior.createdAt && first.id>=prior.id))) || value.matches.some(row=>existing.has(row.id))) return {key,value:null,loading:false,error:new EntaClientError('MALFORMED_RESPONSE')};
      return {key,value:{...value,matches:[...previous.value.matches,...value.matches]},loading:false,error:null};
    }); }).catch(error => { if (generation === epoch.current && !controller.signal.aborted) setState({ key, value: null, error, loading: false }); });
    return () => { epoch.current++; controller.abort(); };
  }, [attempt, cursor, key, mode, format, rules, status, user]);
  const current = state.key === key ? state : { key, value: null, loading: true, error: null };
  return <section className="enta-history" aria-busy={current.loading}><div className="enta-actions"><Link className="button button--primary" to="/enta/new">جهّزوا مباراة جديدة</Link><Link className="button" to="/enta/new/kids">إنت صح للأطفال</Link></div><div className="enta-history-filters"><label>نوع المباراة<select value={mode} onChange={event => { setCursor(null); setMode(event.target.value); }}><option value="">الكل</option><option value="CLASSIC">إنت صح</option><option value="KIDS">إنت صح للأطفال</option><option value="LIST">القائمة</option><option value="ACTING">التمثيل</option></select></label><label>شكل المباراة<select value={format} onChange={event => { setCursor(null); setFormat(event.target.value); }}><option value="">الكل</option><option value="TIER_BOARD">لوحة المستويات</option><option value="MIXED_BOARD">لوحة متنوعة</option><option value="STANDALONE_LIST">القائمة</option><option value="STANDALONE_ACTING">التمثيل</option></select></label><label>قواعد المباراة<select value={rules} onChange={event => { setCursor(null); setRules(event.target.value); }}><option value="">الكل</option><option value="enta-classic-2">إنت صح 2</option><option value="enta-classic-3">إنت صح 3</option><option value="enta-kids-3">الأطفال</option><option value="enta-format-1">الأشكال المتنوعة</option><option value="enta-competitive-1">التنافسية</option></select></label><label>حالة المباراة<select value={status} onChange={event => { setCursor(null); setStatus(event.target.value); }}><option value="">الكل</option><option value="ACTIVE">جارية</option><option value="FINISHED">منتهية</option></select></label></div>
    {current.loading ? <p role="status">جارٍ تحميل المباريات…</p> : null}{current.error ? <div className="enta-state"><p role="alert">{entaErrorText(current.error)}</p><button className="button" type="button" onClick={() => { setCursor(null); setAttempt(value => value + 1); }}>إعادة المحاولة</button></div> : null}
    {current.value?.matches.length ? <ol className="enta-history-list" aria-label="مباريات إنت صح">{current.value.matches.map(match => <li key={match.id}><article><div className="enta-section-heading"><h2>{match.mode === 'KIDS' ? 'إنت صح للأطفال' : match.mode === 'LIST' ? 'القائمة' : match.mode === 'ACTING' ? 'التمثيل' : 'إنت صح'}</h2><p>{match.status === 'FINISHED' ? 'منتهية' : 'جارية'}</p></div><time dateTime={match.createdAt}>{new Intl.DateTimeFormat('ar-KW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuwait' }).format(new Date(match.createdAt))}</time><ul aria-label="الفرق والنقاط">{match.teams.map((team, index) => <li key={index}>{team.name} · {team.score.toLocaleString('ar-KW')} نقطة</li>)}</ul>{match.summary?.reason === 'HOST_ENDED' ? <p>أنهى المضيف المباراة؛ بقي {match.summary?.unplayedCount} دون لعب.</p> : null}<Link className="button" to={match.status === 'FINISHED' ? `/enta/history/${match.id}/original-result` : match.route === 'LEGACY' ? `/enta/matches/${match.id}` : match.route === 'ROUND' ? `/enta/round-matches/${match.id}` : `/enta/competitive/matches/${match.id}`}>{match.status === 'FINISHED' ? 'عرض النتيجة' : 'العودة للمباراة'}</Link></article></li>)}</ol> : !current.loading && !current.error ? <div className="enta-state"><h2>لا توجد مباريات هنا بعد</h2><p>ابدأوا مباراة، أو غيّروا خيارات البحث لعرض مبارياتكم.</p></div> : null}
    {current.value?.nextCursor ? <button type="button" className="button" disabled={current.loading} onClick={() => setCursor(current.value!.nextCursor)}>عرض المزيد</button> : null}
  </section>;
}
export function EntaRematchRoute() { return <EntaShell title="العبوا إنت صح من جديد"><EntaAccess><Rematch /></EntaAccess></EntaShell>; }
function Rematch() {
  const { user } = useFirebaseAuth(), { id } = useParams(); const key = `${pendingStartStorageKey(user?.uid ?? '')}:${id ?? ''}`, epoch = useRef(0), [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; value: ReturnType<typeof parseRematchSetup> | null; loading: boolean; error: unknown }>({ key, value: null, loading: true, error: null });
  useEffect(() => { const generation = ++epoch.current, controller = new AbortController(); setState({ key, value: null, loading: true, error: null }); if (user && id) void requestEnta(`/matches/${encodeURIComponent(id)}/rematch-setup`, user, controller.signal).then(parseRematchSetup).then(value => { if (generation === epoch.current && !controller.signal.aborted) setState({ key, value, loading: false, error: null }); }).catch(error => { if (generation === epoch.current && !controller.signal.aborted) setState({ key, value: null, loading: false, error }); }); return () => { epoch.current++; controller.abort(); }; }, [attempt, id, key, user]);
  const current = state.key === key ? state : { key, value: null, loading: true, error: null };
  if (!current.value) return <div className="enta-state">{current.loading ? <p role="status">جارٍ تحميل إعداد المباراة السابقة…</p> : <><p role="alert">{entaErrorText(current.error)}</p><button className="button" type="button" onClick={() => setAttempt(value => value + 1)}>إعادة المحاولة</button><Link className="button" to="/enta/history">مبارياتي</Link></>}</div>;
  return <EntaSetup key={key} mode={current.value.mode} predecessor={{ gameId: id!, version: current.value.predecessorVersion }} initialSetup={current.value.setup} />;
}




