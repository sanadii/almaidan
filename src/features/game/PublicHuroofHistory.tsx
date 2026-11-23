import {useEffect,useRef,useState} from 'react';
import {useFirebaseAuth} from '../auth/auth-context';
import {useOwnerGeneration} from '../enta/use-owner-generation';
import {ownerEpoch,assertOwnerEpoch} from '../enta/auth-epoch';
import {parsePublicHuroofHistory,type PublicHuroofHistoryRow} from './public-huroof-history';

/** Public history is independent of the local room-capability history. */
export function PublicHuroofHistory(){const {user}=useFirebaseAuth(),generation=useOwnerGeneration();return <PublicHistorySession key={`${user?.uid}:${generation}`}/>;}
function PublicHistorySession(){
 const {user}=useFirebaseAuth(),generation=useOwnerGeneration();const key=`${user?.uid}:${generation}`;
 const [cursor,setCursor]=useState<string|null>(null),[retry,setRetry]=useState(0);
 const [state,setState]=useState<{key:string;rows:PublicHuroofHistoryRow[];next:string|null;loading:boolean;error:boolean}>({key,rows:[],next:null,loading:true,error:false});
 const serial=useRef(0);
 useEffect(()=>{if(!user)return;const controller=new AbortController(),current=++serial.current;let epoch;try{epoch=ownerEpoch(user.uid);}catch{setState({key,rows:[],next:null,loading:false,error:true});return;}
  setState(previous=>({key,rows:cursor&&previous.key===key?previous.rows:[],next:null,loading:true,error:false}));
  void(async()=>{const token=await user.getIdToken();assertOwnerEpoch(epoch,controller.signal);const query=new URLSearchParams({limit:'25'});if(cursor)query.set('cursor',cursor);const response=await fetch(`/api/v1/huroof/history?${query}`,{headers:{authorization:`Bearer ${token}`},signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('HISTORY_UNAVAILABLE');const page=parsePublicHuroofHistory(await response.json());assertOwnerEpoch(epoch,controller.signal);if(current!==serial.current)return;setState(previous=>{const rows=cursor&&previous.key===key?previous.rows:[];const ids=new Set(rows.map(row=>row.sequence)),matches=new Set(rows.map(row=>`${row.matchId}:${row.resultVersion}`));if((cursor!==null&&page.nextCursor===cursor)||page.rows.some(row=>ids.has(row.sequence)||matches.has(`${row.matchId}:${row.resultVersion}`))||(rows.length&&page.rows.length&&BigInt(page.rows[0].sequence)>=BigInt(rows[rows.length-1].sequence)))return {key,rows:[],next:null,loading:false,error:true};return {key,rows:[...rows,...page.rows],next:page.nextCursor,loading:false,error:false};});})().catch(()=>{if(!controller.signal.aborted&&current===serial.current)setState({key,rows:[],next:null,loading:false,error:true});});
  return()=>{serial.current++;controller.abort();};
 },[user,key,cursor,retry]);
 const current=state.key===key?state:null;
 return <section className="enta-history" aria-busy={current?.loading??true}><h2>مباريات الخلية والمجموعات</h2>{!current||current.loading?<p role="status">جارٍ تحميل سجل الخلية…</p>:null}{current?.error?<div><p role="alert">تعذر تحميل سجل الخلية حالياً.</p><button type="button" className="button" onClick={()=>{setCursor(null);setRetry(value=>value+1);}}>إعادة المحاولة</button></div>:null}{current?.rows.length?<ol className="enta-history-list" aria-label="مباريات الخلية">{current.rows.map(row=><li key={`huroof:${row.matchId}:${row.resultVersion}`}><article><h3>مباراة الخلية</h3><time dateTime={row.occurredAt}>{new Intl.DateTimeFormat('ar-KW',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuwait'}).format(new Date(row.occurredAt))}</time><p>تفاصيل النتيجة غير متاحة حالياً.</p></article></li>)}</ol>:current&&!current.loading&&!current.error?<p>لا توجد مباريات خلية في هذا السجل بعد.</p>:null}{current?.next?<button type="button" className="button" disabled={current.loading} onClick={()=>setCursor(current.next)}>عرض المزيد من مباريات الخلية</button>:null}</section>;
}
