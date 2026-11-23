import {isRoomUuid,parseHuroofRematchPending,parseRematchOwnerAccess,parseHuroofRematchResult} from './huroof-rematch-client';
import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {useFirebaseAuth} from '../auth/auth-context';
import {InternalHeader} from '../../design-system/InternalHeader';
import {ownerEpoch,assertOwnerEpoch} from '../enta/auth-epoch';
import {useOwnerGeneration} from '../enta/use-owner-generation';
import {gameRuntime} from './runtime';
import {LocalRoomCreationFailure} from './runtime/local-realtime-game-adapter';
export function HuroofRematch(){const {id=''}=useParams(),{user}=useFirebaseAuth(),generation=useOwnerGeneration();return <Session key={`${id}:${user?.uid}:${generation}`} id={id}/>;}
function Session({id}:{id:string}){
 const {user}=useFirebaseAuth(),navigate=useNavigate(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lifecycle=useRef(new AbortController());useEffect(()=>{const c=new AbortController();lifecycle.current=c;return()=>c.abort();},[]);
 async function start(){if(!user||busy)return;setBusy(true);setError('');const signal=lifecycle.current.signal,key=`almaidan:huroof-rematch:${user.uid}:${id}`;
 try{const epoch=ownerEpoch(user.uid);if(!isRoomUuid(id)||!gameRuntime.rematchRoom)throw Error('UNAVAILABLE');const stored=sessionStorage.getItem(key);let requestKey:string;if(stored){requestKey=parseHuroofRematchPending(stored,user.uid,id).requestKey;}else{requestKey=crypto.randomUUID();sessionStorage.setItem(key,JSON.stringify({uid:user.uid,id,requestKey}));}
 const original=sessionStorage.getItem(key);if(!original||parseHuroofRematchPending(original,user.uid,id).requestKey!==requestKey)throw Error('PENDING_CHANGED');const current=()=>{assertOwnerEpoch(epoch,signal);if(sessionStorage.getItem(key)!==original)throw Error('PENDING_CHANGED');};
 const idToken=await user.getIdToken();current();let cap=JSON.parse(sessionStorage.getItem(`huroof:${id}`)??'null');
 if(!cap||cap.role!=='host'||typeof cap.token!=='string'||cap.token.length<20||cap.token.length>16384){const response=await fetch(`/api/rooms/${id}/owner-access`,{method:'POST',headers:{authorization:`Bearer ${idToken}`,'content-type':'application/json'},body:'{}',signal,credentials:'omit',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('OWNER_REQUIRED');const data=await response.json();current();cap=parseRematchOwnerAccess(data,id);sessionStorage.setItem(`huroof:${id}`,JSON.stringify(cap));}
 current();
 const received=await gameRuntime.rematchRoom(id,requestKey,{idToken,hostCapability:cap.token,assertCurrent:current});current();const result=parseHuroofRematchResult(received,id);sessionStorage.setItem(`huroof:${result.roomId}`,JSON.stringify({role:'host',token:result.token}));sessionStorage.setItem(`huroof:code:${result.roomCode}`,result.roomId);sessionStorage.removeItem(key);navigate(`/room/${result.roomCode}/lobby`);
 }catch(e){if(!signal.aborted)setError(e instanceof LocalRoomCreationFailure&&e.status===422?'لا تكفي الأسئلة غير المستخدمة في نسخة المباراة السابقة. تبقى نتيجتها محفوظة؛ اختر إعداداً جديداً من الصفحة الرئيسية.':e instanceof Error&&/PENDING/.test(e.message)?'تعذر التحقق من طلب الإعادة المحفوظ. لا تنشئ طلباً آخر قبل استعادته.':'تعذر تأكيد الإعادة. المحاولة محفوظة؛ أعد المحاولة لاستعادة المباراة نفسها.');}finally{if(!signal.aborted)setBusy(false);}}
 return <main id="main-content" className="maydan-app maydan-public-page enta-page" data-page-layout="wide"><InternalHeader/><section className="page-rail enta-rail"><h1>إعادة مباراة الخلية</h1><div className="enta-state"><h2>نفس الإعدادات، وأسئلة لم تلعبوها</h2><p>تحتفظ الإعادة بالفرق والفئات والتوقيت ونسخة المحتوى الخاصة بالمباراة السابقة، وتُنشئ غرفة جديدة. تبقى النتيجة السابقة محفوظة.</p>{user&&!user.isAnonymous?<button className="button button--primary" disabled={busy} onClick={()=>void start()}>{busy?'جارٍ تأكيد الإعادة…':'إنشاء غرفة الإعادة'}</button>:<Link className="button" to={`/login?returnTo=${encodeURIComponent(`/huroof/rematch/${id}`)}`}>الدخول بحساب المضيف</Link>}{error?<p role="alert">{error}</p>:null}<Link to="/history">مبارياتي</Link><Link to="/host/new">إعداد مباراة مختلفة</Link></div></section></main>;
}
