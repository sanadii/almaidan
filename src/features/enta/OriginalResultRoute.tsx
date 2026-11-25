import { formatNumber } from '../../lib/format-number';
import {isAlmaidanLocalDevelopment} from '../../lib/local-development';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EntaAccess, EntaShell } from '../../routes/EntaRoutes';
import { useFirebaseAuth } from '../auth/auth-context';
import { entaErrorText, requestEnta } from './client';
import { parseOriginalResult, type OriginalResult } from './original-result';
import { useOwnerGeneration } from './use-owner-generation';

export function OriginalResultRoute() { return <EntaShell title="النتيجة الأصلية"><EntaAccess><OriginalResultView /></EntaAccess></EntaShell>; }
export function OriginalResultView() {
 const {user}=useFirebaseAuth(), {id}=useParams(), [attempt,setAttempt]=useState(0);
 const [state,setState]=useState<{key:string;value:OriginalResult|null;error:unknown;loading:boolean}>({key:'',value:null,error:null,loading:true});
 const ownerGeneration=useOwnerGeneration(); const key=JSON.stringify([user?.uid??'',ownerGeneration,id??'']);
 useEffect(()=>{const controller=new AbortController();setState({key,value:null,error:null,loading:true});if(user&&id) void requestEnta(`/matches/${id}/original-result`,user,controller.signal).then(value=>parseOriginalResult(value,id)).then(value=>{if(!controller.signal.aborted)setState({key,value,error:null,loading:false});}).catch(error=>{if(!controller.signal.aborted)setState({key,value:null,error,loading:false});});return()=>controller.abort();},[user,id,key,attempt]);
 const current=state.key===key?state:{key,value:null,error:null,loading:true};
 return <section className="enta-result" aria-busy={current.loading}>{current.loading?<p role="status">جارٍ تحميل النتيجة الأصلية…</p>:current.error?<div className="enta-state"><p role="alert">{entaErrorText(current.error)}</p><button className="button" onClick={()=>setAttempt(n=>n+1)}>إعادة المحاولة</button></div>:current.value?<><h2>{current.value.isTie?'تعادل':current.value.reason==='HOST_ENDED'?'أنهى المضيف المباراة':'النتيجة الأصلية'}</h2><ul>{current.value.teams.map((team,index)=><li key={index}>{team.name} · {formatNumber(team.score)}{team.winner?' · الفائز':''}</li>)}</ul><p>{current.value.unplayedCount?`بقي ${current.value.unplayedCount} دون لعب.`:'اكتملت المباراة.'}</p>{current.value.physicalProtocol<4||isAlmaidanLocalDevelopment?<Link className="button button--primary" to={current.value.physicalProtocol<4?`/enta/matches/${current.value.id}/rematch`:`/enta/local-rematch/${current.value.physicalProtocol===4?'round':'competitive'}/${current.value.id}`}>إعادة المباراة بنفس الإعدادات</Link>:null}</>:null}<Link className="button" to="/enta/history">مبارياتي</Link></section>;
}
