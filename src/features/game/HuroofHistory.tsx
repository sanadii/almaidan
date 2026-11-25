import {useEffect,useState,useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {useFirebaseAuth} from '../auth/auth-context';
import {useOwnerGeneration} from '../enta/use-owner-generation';
import {ownerEpoch,assertOwnerEpoch} from '../enta/auth-epoch';
import {parseHuroofHistory,parseHuroofOwnerAccess,type HuroofHistoryRow as Row} from './huroof-history-client';
import { MatchHistoryList, type MatchHistorySource, type HistoryChildren } from './MatchHistoryList';
import { formatNumber } from '../../lib/format-number';
import { categoryCatalog } from '../../data/category-catalog';

const catalogNames = new Map(categoryCatalog.map(category=>[category.id,category.displayNameAr]));
function storedCategoryNames(row:Row) {
  return row.categories?.map(category=>category.labelAr!==category.id ? category.labelAr : catalogNames.get(category.id))
    .filter(Boolean).join('، ');
}
export function HuroofHistory({children}:HistoryChildren){const {user}=useFirebaseAuth(),generation=useOwnerGeneration();return <HistorySession key={`${user?.uid}:${generation}`}>{children}</HistorySession>;}
function HistorySession({children}:HistoryChildren){
 const {user}=useFirebaseAuth(),generation=useOwnerGeneration(),navigate=useNavigate();
 const lifecycle=useRef(new AbortController());useEffect(()=>{const c=new AbortController();lifecycle.current=c;return()=>c.abort();},[]);
 const key=`${user?.uid}:${generation}`,[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null);
 const [state,setState]=useState<{key:string;rows:Row[];next:number|null;error:boolean;loading:boolean}>({key,rows:[],next:null,error:false,loading:true});
 useEffect(()=>{setOffset(0);},[key]);
 useEffect(()=>{if(!user)return;const controller=new AbortController();let epoch;try{epoch=ownerEpoch(user.uid);}catch{setState({key,rows:[],next:null,error:true,loading:false});return;}setState(previous=>({...previous,loading:true,error:false}));void(async()=>{const token=await user.getIdToken();assertOwnerEpoch(epoch,controller.signal);const response=await fetch(`/api/rooms/history?offset=${offset}`,{headers:{authorization:`Bearer ${token}`},signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('HISTORY_UNAVAILABLE');const data=await response.json();assertOwnerEpoch(epoch,controller.signal);const parsed=parseHuroofHistory(data,offset);setState(previous=>{
   const rows=offset&&previous.key===key?previous.rows:[];
   const seen=new Set(rows.map(row=>row.id));
   return {key,rows:[...rows,...parsed.items.filter(row=>!seen.has(row.id))],next:parsed.nextOffset,error:false,loading:false};
 });})().catch(()=>{if(!controller.signal.aborted)setState({key,rows:[],next:null,error:true,loading:false});});return()=>controller.abort();},[user,key,offset,retry]);
 async function open(row:Row){if(!user||busy)return;setActionError(null);setBusy(true);const signal=lifecycle.current.signal;let epoch;try{epoch=ownerEpoch(user.uid);}catch{setActionError('تعذر تأكيد جلسة الحساب. أعد تحميل الصفحة ثم حاول فتح الغرفة من السجل.');setBusy(false);return;}try{const token=await user.getIdToken();assertOwnerEpoch(epoch,signal);const response=await fetch(`/api/rooms/${encodeURIComponent(row.id)}/owner-access`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{}',signal,credentials:'omit',redirect:'error',cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();assertOwnerEpoch(epoch,signal);const access=parseHuroofOwnerAccess(data,row);sessionStorage.setItem(`huroof:${row.id}`,JSON.stringify({token:access.token,role:'host'}));sessionStorage.setItem(`huroof:code:${row.code}`,row.id);navigate(`/room/${row.code}/${row.complete?'results':row.phase==='LOBBY'?'lobby':'host'}`);}catch{if(!signal.aborted){try{assertOwnerEpoch(epoch,signal);setActionError('تعذر فتح الغرفة. تحقق من اتصال الخدمة المحلية ثم حاول مرة أخرى.');}catch{/* the error message is already shown */}}}finally{if(!signal.aborted)setBusy(false);}}
 const current=state.key===key?state:null;
 const source:MatchHistorySource={
   entries:(current?.rows??[]).map(row=>({
     key:`huroof:${row.id}`,game:'huroof',date:row.createdAt,complete:row.complete,
     title:<>الخلية · {row.settings.gameKind==='categories'?'لوحة الفئات':'لوحة الحروف'} · <bdi>{row.code}</bdi></>,
     details:<><p>{row.complete?'منتهية':row.phase==='LOBBY'?'بانتظار اللاعبين':'جارية'}</p>
       {row.categories?.length ? <p>{storedCategoryNames(row)||'أسماء الفئات غير متوفرة'}</p> : null}
       <p>{row.teams.horizontal}: {formatNumber(row.scores.horizontal)} · {row.teams.vertical}: {formatNumber(row.scores.vertical)}</p>
       <button className="button" disabled={busy} onClick={()=>void open(row)}>{row.complete?'عرض نتيجة الخلية':'العودة إلى غرفة الخلية'}</button></>,
   })),
   ready:!!current&&!current.loading&&!current.error,
   feedback:<>{(!current||current.loading)&&<p role="status">جارٍ تحميل سجل الخلية…</p>}
     {current?.error&&<div><p role="alert">تعذر تحميل سجل الخلية حالياً.</p><button className="button" onClick={()=>{setOffset(0);setRetry(v=>v+1);}}>إعادة تحميل سجل الخلية</button></div>}
     {actionError&&<p role="alert">{actionError}</p>}{busy&&<p role="status">جارٍ فتح الغرفة…</p>}</>,
   paging:current?.next!=null&&<button className="button" disabled={busy||current.loading} onClick={()=>setOffset(current.next!)}>عرض المزيد من مباريات الخلية</button>,
 };
 return children ? children(source) : <>{source.feedback}<MatchHistoryList entries={source.entries}/>{source.paging}</>;
}
