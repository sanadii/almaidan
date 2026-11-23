import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {EntaAccess,EntaShell} from '../../routes/EntaRoutes';
import {isAlmaidanLocalDevelopment} from '../../lib/local-development';
import {useFirebaseAuth} from '../auth/auth-context';
import {useOwnerGeneration} from './use-owner-generation';
import {EntaClientError,entaErrorText,requestEnta} from './client';
import {ownerEpoch,isOwnerEpoch} from './auth-epoch';
import {parseLocalRematchPending,parseLocalRematchSetup,type LocalRematchSetup} from './local-rematch-client';
import {readPendingIntent,persistPendingIntent,pendingIntentRoute,type PendingIntent} from './pending-intent';
import {completePendingStart} from './pending-start';

export function LocalRematchRoute(){const {user}=useFirebaseAuth(),{engine,id}=useParams(),generation=useOwnerGeneration();return <EntaShell title="إعادة المباراة"><EntaAccess>{isAlmaidanLocalDevelopment?<Rematch key={`${user?.uid}:${generation}:${engine}:${id}`}/>:<p role="alert">إعادة هذا النوع متاحة في النسخة المحلية فقط.</p>}</EntaAccess></EntaShell>;}
function Rematch(){
 const {user}=useFirebaseAuth(),{engine='',id=''}=useParams(),navigate=useNavigate();
 const [setup,setSetup]=useState<LocalRematchSetup|null>(null),[error,setError]=useState<unknown>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0),[intent,setIntent]=useState<PendingIntent|null>(null),[storageBlocked,setStorageBlocked]=useState(false);
 const dispatch=useRef<AbortController|null>(null);useEffect(()=>()=>dispatch.current?.abort(),[]);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError(null);setSetup(null);try{setIntent(user?readPendingIntent(user.uid):null);setStorageBlocked(false);}catch(e){setError(e);setStorageBlocked(true);}
  if(!['round','competitive'].includes(engine)||!/^[A-Za-z0-9_-]{1,128}$/.test(id)){setError(new EntaClientError('MALFORMED_RESPONSE'));setLoading(false);return;}
  if(user)void requestEnta(`/local-rematches/${engine}/${id}/setup`,user,controller.signal).then(v=>parseLocalRematchSetup(v,engine,id)).then(v=>{if(!controller.signal.aborted){setSetup(v);setLoading(false);}}).catch(e=>{if(!controller.signal.aborted){setError(e);setLoading(false);}});return()=>controller.abort();
 },[user,engine,id,retry]);
 const otherIntent=intent&&(intent.version!==6||intent.engine!==engine||intent.predecessor.id!==id);
 async function start(){if(!user||busy||otherIntent||storageBlocked||(!setup&&!intent))return;const lease=ownerEpoch(user.uid),controller=new AbortController();dispatch.current?.abort();dispatch.current=controller;setBusy(true);setError(null);
  try{const pending=intent?.version===6?intent:parseLocalRematchPending({version:6,engine,executionFormat:setup!.executionFormat,startKind:'LOCAL_REMATCH',predecessor:setup!.predecessor,source:setup!.source,endpoint:`/local-rematches/${engine}/${id}`,command:{requestKey:crypto.randomUUID(),logicalMatchId:crypto.randomUUID(),predecessorVersion:setup!.predecessor.version}});persistPendingIntent(user.uid,pending);setIntent(pending);
   const match=await completePendingStart(user,pending,controller.signal,()=>isOwnerEpoch(lease)&&!controller.signal.aborted);if(!isOwnerEpoch(lease)||controller.signal.aborted)return;setIntent(null);navigate(match.roomCode?`/enta/rooms/${match.roomCode}/host`:`/enta/${engine==='round'?'round-matches':'competitive/matches'}/${match.id}`);
  }catch(e){if(isOwnerEpoch(lease)&&!controller.signal.aborted){setError(e);try{setIntent(readPendingIntent(user.uid));}catch(storageError){setError(storageError);setStorageBlocked(true);}}}finally{if(isOwnerEpoch(lease)&&!controller.signal.aborted)setBusy(false);}
 }
 return <section className="enta-state" aria-busy={loading||busy}><h2>العبوا مجدداً بنفس الإعدادات</h2><p>تحافظ الإعادة على الفرق والفئات وقواعد المباراة ومصدر محتواها. تبقى المباراة السابقة ونتيجتها محفوظتين.</p>{loading?<p role="status">جارٍ تحميل إعداد المباراة السابقة…</p>:null}
  {setup?<><h3>الفئات</h3><ul>{setup.categories.map(c=><li key={c.key}>{c.label}</li>)}</ul><h3>الفرق</h3><ul>{setup.setup.teams.map(t=><li key={t.name}><strong>{t.name}</strong> · {t.players.join('، ')}</li>)}</ul><p>وقت السؤال: {setup.setup.rules.questionSeconds} ثانية · وقت الدور: {setup.setup.rules.turnSeconds} ثانية{setup.setup.rules.overallSeconds?` · وقت الجولة: ${setup.setup.rules.overallSeconds} ثانية`:''}</p><details><summary>مصدر محتوى المباراة</summary><p>المباراة السابقة: <bdi>{setup.predecessor.id}</bdi></p><p>نسخة المحتوى: <bdi>{setup.source.baseReleaseId}</bdi></p><p>نسخة الأنماط: <bdi>{setup.source.formatReleaseId}</bdi></p></details></>:null}
  {error?<p role="alert">{entaErrorText(error)}</p>:null}{otherIntent?<><p role="alert">هناك بدء مباراة لم يُحسم بعد. أكملوه أولاً دون إنشاء طلب جديد.</p><Link className="button" to={pendingIntentRoute(intent!)}>العودة إلى الطلب المعلّق</Link></>:<button className="button button--primary" disabled={busy||storageBlocked||(!setup&&!intent)} onClick={()=>void start()}>{busy?'جارٍ تأكيد الإعادة…':intent?'تأكيد طلب الإعادة نفسه':'بدء الإعادة'}</button>}
  {error instanceof EntaClientError&&error.code==='REMATCH_CONTENT_EXHAUSTED'&&!intent&&!storageBlocked?<Link className="button" to={engine==='competitive'?`/enta/competitive/new/${setup?.executionFormat==='MIXED_BOARD'?'mixed':setup?.executionFormat==='STANDALONE_LIST'?'list':setup?.executionFormat==='STANDALONE_ACTING'?'acting':'classic'}`:`/enta/new/${setup?.executionFormat==='MIXED_BOARD'?'mixed':setup?.executionFormat==='STANDALONE_LIST'?'list':'acting'}`}>اختيار فئات أخرى لمباراة جديدة</Link>:null}
  {!setup&&!loading?<button className="button" disabled={busy} onClick={()=>setRetry(n=>n+1)}>إعادة تحميل الإعدادات</button>:null}<Link className="button" to="/enta/history">مبارياتي</Link>
 </section>;
}
