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

import { MatchHistoryList, type MatchHistoryEntry, type MatchHistorySource } from '../game/MatchHistoryList';
import { formatNumber } from '../../lib/format-number';
import { Icon } from '../../design-system/Icon';

export function EntaHistoryRoute() {
  const {status} = useFirebaseAuth();
  const HistorySource = isAlmaidanLocalDevelopment ? HuroofHistory : PublicHuroofHistory;
  return <EntaShell title="مبارياتي" eyebrow="الميدان">{status==='signedOut'||status==='anonymous'
    ? <section className="enta-state"><h2>سجّل دخولك لتشوف مبارياتك</h2><Link className="button button--primary" to="/login?returnTo=%2Fhistory">تسجيل الدخول</Link></section>
    : <EntaAccess><HistorySource>{source=><HistoryView huroof={source}/>}</HistorySource></EntaAccess>}</EntaShell>;
}
export function HistoryView({huroof}: {huroof?:MatchHistorySource} = {}) {
  const [game,setGame]=useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const entaEntries:MatchHistoryEntry[]=(current.value?.matches??[]).map(match=>({
    key:`enta:${match.id}`,game:'enta',date:match.createdAt,complete:match.status==='FINISHED',
    title:match.mode==='KIDS'?'إنت صح للأطفال':match.mode==='LIST'?'إنت صح · القائمة':match.mode==='ACTING'?'إنت صح · التمثيل':'إنت صح',
    details:<><p>{match.status==='FINISHED'?'منتهية':'جارية'}</p>
      <ul aria-label="الفرق والنقاط">{match.teams.map((team,index)=><li key={index}>{team.name} · {formatNumber(team.score)} نقطة</li>)}</ul>
      {match.summary?.reason==='HOST_ENDED'&&<p>أنهى المضيف المباراة، وبقي {formatNumber(match.summary.unplayedCount)} دون لعب.</p>}
      <Link className="button" to={match.status==='FINISHED'?`/enta/history/${match.id}/original-result`:match.route==='LEGACY'?`/enta/matches/${match.id}`:match.route==='ROUND'?`/enta/round-matches/${match.id}`:`/enta/competitive/matches/${match.id}`}>{match.status==='FINISHED'?'عرض النتيجة':'العودة للمباراة'}</Link></>,
  }));
  const showHuroof=game!=='enta',showEnta=game!=='huroof';
  const entries=[...(huroof?.entries??[]),...entaEntries].filter(entry=>!game||entry.game===game);
  const ready=(!showHuroof||!huroof||huroof.ready)&&(!showEnta||(!current.loading&&!current.error));
  const filterCount = [game, ...(showEnta ? [mode, format, rules, status] : [])].filter(Boolean).length;
  return <section className="enta-history">
    <div className="enta-actions"><Link className="button button--primary" to="/enta/new">جهّزوا مباراة جديدة</Link><Link className="button" to="/enta/new/kids">إنت صح للأطفال</Link></div>
    <button aria-controls="history-filters" aria-expanded={filtersOpen} className="button button--secondary enta-history-filter-toggle"
      type="button" onClick={() => setFiltersOpen(open => !open)}>
      تصفية{filterCount > 0 && ` (${formatNumber(filterCount)})`} <Icon kind="chevron-down" />
    </button>
    <div id="history-filters" className="enta-history-filters enta-history-filters--responsive" data-open={filtersOpen}>
      <label>اللعبة<select value={game} onChange={event=>setGame(event.target.value)}><option value="">كل الألعاب</option><option value="huroof">الخلية</option><option value="enta">إنت صح</option></select></label>
      {showEnta&&<>
        <label>نوع المباراة<select value={mode} onChange={event => { setCursor(null); setMode(event.target.value); }}><option value="">الكل</option><option value="CLASSIC">إنت صح</option><option value="KIDS">إنت صح للأطفال</option><option value="LIST">القائمة</option><option value="ACTING">التمثيل</option></select></label>
        <label>شكل المباراة<select value={format} onChange={event => { setCursor(null); setFormat(event.target.value); }}><option value="">الكل</option><option value="TIER_BOARD">لوحة المستويات</option><option value="MIXED_BOARD">لوحة متنوعة</option><option value="STANDALONE_LIST">القائمة</option><option value="STANDALONE_ACTING">التمثيل</option></select></label>
        <label>قواعد المباراة<select value={rules} onChange={event => { setCursor(null); setRules(event.target.value); }}><option value="">الكل</option><option value="enta-classic-2">إنت صح 2</option><option value="enta-classic-3">إنت صح 3</option><option value="enta-kids-3">الأطفال</option><option value="enta-format-1">الأشكال المتنوعة</option><option value="enta-competitive-1">التنافسية</option></select></label>
        <label>حالة المباراة<select value={status} onChange={event => { setCursor(null); setStatus(event.target.value); }}><option value="">الكل</option><option value="ACTIVE">جارية</option><option value="FINISHED">منتهية</option></select></label>
      </>}
    </div>
    {showHuroof&&huroof?.feedback}{showEnta&&current.loading ? <p role="status">جارٍ تحميل المباريات…</p> : null}{showEnta&&current.error ? <div className="enta-state"><p role="alert">{entaErrorText(current.error)}</p><button className="button" type="button" onClick={() => { setCursor(null); setAttempt(value => value + 1); }}>إعادة المحاولة</button></div> : null}
    {entries.length ? <MatchHistoryList entries={entries}/> : ready ? <div className="enta-state"><h2>لا توجد مباريات هنا بعد</h2><p>ابدأوا مباراة، أو غيّروا خيارات البحث لعرض مبارياتكم.</p></div> : null}
    {showHuroof&&huroof?.paging}
    {showEnta&&current.value?.nextCursor ? <button type="button" className="button" disabled={current.loading} onClick={() => setCursor(current.value!.nextCursor)}>عرض المزيد</button> : null}
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




