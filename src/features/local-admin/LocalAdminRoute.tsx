import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {InternalHeader} from '../../design-system/InternalHeader';
import {getApps,initializeApp} from 'firebase/app';
import {connectAuthEmulator,getAuth,browserSessionPersistence,setPersistence,onAuthStateChanged,signInWithEmailAndPassword,signOut,type User} from 'firebase/auth';
import './local-admin.css';
import {initialPayload,refreshedContent,parseChallengeObject,hasQuestionMedia,hasMediaDescriptor} from './editor-model';
type Row=Record<string,any>;
const mediaKey=(media:Row)=>`${media.type}:${media.mediaId}:${media.assetSha256}`;
const formatLabels:Row={KIDS:'للأطفال · 7–10 سنوات',LIST_ITEMS:'القوائم',ACTING_ITEMS:'التمثيل',DRAWING_TARGET:'الرسم'};
function AuthoredPreview({row}:{row:Row}){return <div className="local-admin-preview">
 <p>محتوى محلي مؤلف ومراجَع، محفوظ بإصدار مستقل؛ تظهر التعديلات في سجل المراجعات.</p>
 <dl><div><dt>النوع</dt><dd>{formatLabels[row.format]??row.format}</dd></div><div><dt>الإصدار</dt><dd dir="ltr">{row.releaseId}</dd></div><div><dt>مراجعة العنصر</dt><dd dir="ltr">{row.revisionId}</dd></div><div><dt>بصمة المصدر</dt><dd dir="ltr">{row.releaseRootHash}</dd></div>{row.contentHash&&<div><dt>بصمة المحتوى</dt><dd dir="ltr">{row.contentHash}</dd></div>}{row.questionCount!==undefined&&<div><dt>عدد العناصر</dt><dd>{row.questionCount}</dd></div>}{row.points!==undefined&&row.points!==null&&<div><dt>النقاط</dt><dd>{row.points}</dd></div>}</dl>
 {row.promptAr&&<><h3>التعليمات أو السؤال</h3><p>{row.promptAr}</p></>}
 {row.canonicalAnswer&&<><h3>الإجابة</h3><p>{row.canonicalAnswer}</p><p>الإجابات المقبولة: {row.acceptedAnswers?.join('، ')}</p></>}
 {row.target&&<><h3>الكلمة الخاصة بالرسّام</h3><p>{row.target}</p></>}
 {!!row.items?.length&&<><h3>{row.format==='ACTING_ITEMS'?'الموقف الخاص بالممثل':'الإجابات المقبولة ونقاطها'}</h3><ul>{row.items.map((item:Row)=><li key={item.id}>{item.text} · {item.value} نقطة{item.trap?' · فخ':''}</li>)}</ul></>}
 {row.format==='LIST_ITEMS'&&<p>يراجع المضيف العناصر ويحتسب الإجابات المقبولة؛ إرسال اللاعب وحده لا يمنحه نقاطاً.</p>}
 </div>;}

function DraftFields({row,entity,payload,setPayload,mediaOptions}:{row:Row;entity:'question'|'category';payload:Row;setPayload:(value:Row)=>void;mediaOptions:Row[]}) {
 const update=(key:string,value:unknown)=>setPayload({...payload,[key]:value});
 if(entity==='category')return <label>اسم الفئة<input required maxLength={100} value={payload.labelAr??''} onChange={e=>update('labelAr',e.target.value)}/></label>;
 if(row.challenge)return <><label>نص السؤال على اللوحة<textarea required maxLength={2000} value={payload.promptAr??''} onChange={e=>update('promptAr',e.target.value)}/></label><p>نص اللوحة مستقل عن تعليمات التحدي. لتعديل النص داخل التحدي، عدّل promptAr أو clueAr في البيانات العامة بحسب الآلية. عدّل بيانات التحدي بصيغة JSON. يتحقق الخادم من قواعد الآلية والروابط قبل الحفظ؛ بيانات التقييم خاصة بالإدارة.</p><label>بيانات التحدي العامة<textarea dir="ltr" required value={payload.publicDataText??''} onChange={e=>update('publicDataText',e.target.value)}/></label><label>بيانات التقييم الخاصة<textarea dir="ltr" required value={payload.privateGradingText??''} onChange={e=>update('privateGradingText',e.target.value)}/></label></>;
 const hasMedia=hasQuestionMedia(row);
 const list=row.format==='LIST_ITEMS'||row.format==='ACTING_ITEMS';
 return <><label>السؤال أو التعليمات<textarea required maxLength={2000} value={payload.promptAr??''} onChange={e=>update('promptAr',e.target.value)}/></label>
 {list?<label>{row.format==='LIST_ITEMS'?'الإجابات المقبولة (إجابة في كل سطر)':'عناصر التمثيل (عنصر في كل سطر)'}<span>حافظ على عدد العناصر وترتيبها؛ تبقى النقاط وخصائص كل عنصر مرتبطة بموضعه.</span><textarea required value={(payload.items??[]).join('\n')} onChange={e=>update('items',e.target.value.split('\n'))}/></label>:row.format==='DRAWING_TARGET'?<label>الكلمة الخاصة بالرسّام<input required maxLength={500} value={payload.target??''} onChange={e=>update('target',e.target.value)}/></label>:<><label>الإجابة الأساسية<input required maxLength={500} value={payload.canonicalAnswer??''} onChange={e=>update('canonicalAnswer',e.target.value)}/></label><label>الإجابات المقبولة (إجابة في كل سطر)<textarea required value={(payload.acceptedAnswers??[]).join('\n')} onChange={e=>update('acceptedAnswers',e.target.value.split('\n'))}/></label></>}
 {hasMedia&&<><p>اختر من ملفات المصدر المحلية المتحقق منها؛ لا يمكن إدخال رابط خارجي. يجب أن تختلف وسائط السؤال والإجابة.</p>{(['media','answerMedia'] as const).map(key=><label key={key}>{key==='media'?'وسائط السؤال':'وسائط الإجابة'}<select value={payload[key]?mediaKey(payload[key]):''} required={key==='media'&&hasMediaDescriptor(row.media)} onChange={e=>update(key,e.target.value?mediaOptions.find(option=>mediaKey(option)===e.target.value):null)}><option value="">بدون وسائط</option>{mediaOptions.filter(option=>key==='answerMedia'||option.type===row.media?.type).map(option=><option key={mediaKey(option)} value={mediaKey(option)}>{option.altAr||option.mediaId} · {option.type} · {option.assetSha256?.slice(0,12)}</option>)}</select></label>)}</>}
 {!list&&!hasMedia&&<label>النقاط {row.sourceKind==='local-authored'&&<span>درجة العنصر ثابتة في المصدر.</span>}<select disabled={row.sourceKind==='local-authored'} value={payload.points??200} onChange={e=>update('points',Number(e.target.value))}>{[200,400,600].map(n=><option key={n}>{n}</option>)}</select></label>}</>;
}
function RevisionValue({value}:{value:unknown}){return <pre>{typeof value==='object'&&value!==null?JSON.stringify(value,null,2):String(value??'')}</pre>;}

const errors:Record<string,string>={LOCAL_ADMIN_REQUIRED:'هذا الحساب لا يملك صلاحية الإدارة المحلية.',INVALID_CATEGORY_LABEL:'اكتب اسماً للفئة بين حرف و100 حرف، دون أسطر جديدة أو رموز تنسيق.',INVALID_QUESTION_CONTENT:'تحقق من السؤال (حتى 2000 حرف)، وكل إجابة أو عنصر (حتى 500 حرف)، وعدد العناصر الأصلي ودرجة المصدر.' ,ITEM_COUNT:'حافظ على عدد العناصر الأصلي، واكتب عنصراً غير فارغ في كل سطر.',CANONICAL_ANSWER_REQUIRED:'أضف الإجابة الأساسية إلى قائمة الإجابات المقبولة.',ACTIVE_REVISION_CONFLICT:'تغيّرت النسخة الفعّالة. أعد اختيار العنصر لتحديث سجل المراجعات.',REVIEW_REQUIRED:'اعتمد مراجعة المسودة قبل تفعيلها.',LOCAL_ADMIN_UNAVAILABLE:'تعذرت خدمة الإدارة المحلية. حاول مرة أخرى.',LOCAL_TEXT_EDIT_ONLY:'هذا السؤال يحتاج محرر الوسائط أو آلية التحدي.',INVALID_CHALLENGE_JSON:'تحقق من بيانات التحدي: يجب أن يكون كل حقل كائن JSON صالحاً.',INVALID_ID_TOKEN:'انتهت الجلسة. ادخل بحساب الإدارة مجدداً.'};
const allowed=()=>import.meta.env.VITE_ALMAIDAN_LOCAL_ONLY==='true'&&import.meta.env.VITE_FIREBASE_PROJECT_ID==='demo-almaidan-local'&&['127.0.0.1','localhost'].includes(location.hostname);
let adminAuthPromise:Promise<ReturnType<typeof getAuth>>|null=null;
function adminAuth(){
 if(!allowed())return Promise.reject(Error('LOCAL_ONLY'));
 if(!adminAuthPromise){
  adminAuthPromise=(async()=>{
   const name='almaidan-isolated-content-admin';
   const app=getApps().find(a=>a.name===name)??initializeApp({apiKey:'local-emulator-only',projectId:'demo-almaidan-local',authDomain:'demo-almaidan-local.firebaseapp.com'},name);
   const auth=getAuth(app);
   if(!auth.emulatorConfig)connectAuthEmulator(auth,'http://127.0.0.1:19099',{disableWarnings:true});
   else if(auth.emulatorConfig.host!=='127.0.0.1'||auth.emulatorConfig.port!==19099)throw Error('LOCAL_ONLY');
   await setPersistence(auth,browserSessionPersistence);
   await auth.authStateReady();
   return auth;
  })().catch(error=>{adminAuthPromise=null;throw error;});
 }
 return adminAuthPromise;
}
export function LocalAdminRoute(){
 const [user,setUser]=useState<User|null>(null),[session,setSession]=useState<Row|null>(null),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [categories,setCategories]=useState<Row[]>([]),[category,setCategory]=useState(''),[query,setQuery]=useState(''),[rows,setRows]=useState<Row[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[selected,setSelected]=useState<Row|null>(null),[entity,setEntity]=useState<'question'|'category'>('question'),[payload,setPayload]=useState<Row>({}),[revisions,setRevisions]=useState<Row[]>([]);
 const [mediaOptions,setMediaOptions]=useState<Row[]>([]);
 const [restoring,setRestoring]=useState(true),[checking,setChecking]=useState(false),[logoutFailed,setLogoutFailed]=useState(false);
 const epoch=useRef(0),authEpoch=useRef(0),currentAdminUser=useRef<User|null>(null),mounted=useRef(false),errorRef=useRef<HTMLParagraphElement>(null);
 function clearPrivate(){
  setSession(null);setCategories([]);setCategory('');setQuery('');setRows([]);setOffset(0);setTotal(0);
  setSelected(null);setEntity('question');setPayload({});setRevisions([]);setMediaOptions([]);setNotice('');
 }
 useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
 useEffect(()=>{const previous=document.title;document.title='إدارة المحتوى المحلي | الميدان';return()=>{document.title=previous;};},[]);
 useEffect(()=>{
  mounted.current=true;let active=true;let unsubscribe:(()=>void)|undefined;
  if(!allowed()){setRestoring(false);return()=>{mounted.current=false;};}
  void adminAuth().then(auth=>{
   if(!active)return;
   unsubscribe=onAuthStateChanged(auth,next=>{
    if(!active)return;
    authEpoch.current++;epoch.current++;currentAdminUser.current=next;clearPrivate();setBusy(false);setLogoutFailed(false);setChecking(Boolean(next));setUser(next);setRestoring(false);
   });
  }).catch(()=>{if(active){setRestoring(false);setError('تعذر تهيئة جلسة الإدارة المحلية.');}});
  return()=>{active=false;mounted.current=false;currentAdminUser.current=null;authEpoch.current++;epoch.current++;unsubscribe?.();};
 },[]);
 const renderAuthority=authEpoch.current;
 async function api(path:string,body?:unknown){
  if(!allowed()||!user||currentAdminUser.current!==user||authEpoch.current!==renderAuthority)throw Error('ADMIN_SIGN_IN_REQUIRED');
  const generation=renderAuthority;
  const valid=()=>mounted.current&&generation===authEpoch.current&&currentAdminUser.current===user;
  let token:string;
  try{token=await user.getIdToken();}
  catch(error){
   if(valid()&&['auth/user-token-expired','auth/id-token-expired','auth/invalid-user-token','auth/user-disabled'].includes((error as {code?:string})?.code??'')){
    authEpoch.current++;epoch.current++;currentAdminUser.current=null;clearPrivate();setUser(null);setChecking(false);setBusy(false);setError(errors.INVALID_ID_TOKEN);
    const rejectedGeneration=authEpoch.current;
    void adminAuth().then(auth=>{if(mounted.current&&authEpoch.current===rejectedGeneration&&auth.currentUser?.uid===user.uid)return signOut(auth);}).catch(()=>{});
   }
   throw error;
  }
  if(!valid())throw Error('STALE_ADMIN_SESSION');
  const response=await fetch(`/api/v1/local-admin${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const data=await response.json();if(!valid())throw Error('STALE_ADMIN_SESSION');
  if(!response.ok){
   if(response.status===401||response.status===403){
    authEpoch.current++;epoch.current++;currentAdminUser.current=null;clearPrivate();setUser(null);setChecking(false);setBusy(false);
    setError(errors[data.error]??errors.LOCAL_ADMIN_REQUIRED);
    const rejectedGeneration=authEpoch.current;
    void adminAuth().then(auth=>{if(mounted.current&&authEpoch.current===rejectedGeneration&&auth.currentUser?.uid===user.uid)return signOut(auth);}).catch(()=>{});
   }
   throw Error(data.error??'REQUEST_FAILED');
  }
  return data;
 }
 async function run(work:()=>Promise<void>){
  const generation=authEpoch.current;setBusy(true);setError('');setNotice('');
  try{await work();}catch(e){if(mounted.current&&generation===authEpoch.current){const code=e instanceof Error?e.message:'';setError(errors[code]??'تعذر تنفيذ الطلب. تحقق من بيانات الدخول والاتصال بالخدمات المحلية.');}}
  finally{if(mounted.current&&generation===authEpoch.current)setBusy(false);}
 }
 useEffect(()=>{
  if(!user)return;
  const generation=authEpoch.current;
  void (async()=>{try{const data=await api('/session');if(!mounted.current||generation!==authEpoch.current)return;setSession(data);const list=await api('/categories');if(mounted.current&&generation===authEpoch.current)setCategories(list.categories);}
   catch(e){if(mounted.current&&generation===authEpoch.current){clearPrivate();const code=e instanceof Error?e.message:'';setError(errors[code]??'تعذرت خدمة الإدارة المحلية. حاول مرة أخرى.');}}
   finally{if(mounted.current&&generation===authEpoch.current)setChecking(false);}
  })();
 },[user]);
 async function logout(){
  const generation=++authEpoch.current;epoch.current++;currentAdminUser.current=null;clearPrivate();setUser(null);setBusy(true);setError('');
  try{await signOut(await adminAuth());}
  catch{if(mounted.current&&generation===authEpoch.current){setLogoutFailed(true);setError('تعذر تسجيل الخروج. حاول مجدداً قبل مغادرة هذه الجلسة.');}}
  finally{if(mounted.current&&generation===authEpoch.current)setBusy(false);}
 }
 async function search(page=0){const generation=++epoch.current;const data=await api(`/questions?category=${encodeURIComponent(category)}&q=${encodeURIComponent(query)}&offset=${page}`);if(generation!==epoch.current)return;setRows(data.questions);setTotal(data.total);setOffset(page);}
 async function select(row:Row,kind:'question'|'category') {
  const generation=renderAuthority;
  const valid=()=>mounted.current&&generation===authEpoch.current&&currentAdminUser.current===user;
  if(!valid())return;
  setRevisions([]);setSelected(null);setEntity(kind);let current=row;
  if(kind==='question'&&row.challenge){
   const challengeDefinition=await api(`/challenge-definition?questionId=${encodeURIComponent(row.id)}`);if(!valid())return;
   current={...row,challengeDefinition};
  }
  if(kind==='question'&&hasQuestionMedia(row)){
   const [images,videos]=await Promise.all([api('/media-options?type=image'),api('/media-options?type=video')]);if(!valid())return;
   setMediaOptions([...images.options,...videos.options]);
  }
  if(!valid())return;
  setSelected(current);setPayload(initialPayload(current,kind));
  const data=await api(`/revisions?entity=${kind}&entityId=${encodeURIComponent(row.id)}`);if(valid())setRevisions(data.revisions);
 }
 async function reload(refreshContent=false){
  const generation=renderAuthority;
  const valid=()=>mounted.current&&generation===authEpoch.current&&currentAdminUser.current===user;
  if(!selected||!valid())return;
  const data=await api(`/revisions?entity=${entity}&entityId=${encodeURIComponent(selected.id)}`);if(!valid())return;
  setRevisions(data.revisions);
  if(refreshContent){
   const refreshed=await refreshedContent(api,selected,entity);if(!valid())return;
   setCategories(refreshed.categories);if(refreshed.row){setSelected(refreshed.row);setPayload(refreshed.payload!);}
   await search(offset);
  }
 }
 if(!allowed())return <main className="maydan-app local-content-admin" dir="rtl"><h1>الإدارة المحلية غير متاحة</h1></main>;
 return <div className="maydan-app"><InternalHeader/><main id="main-content" className="local-content-admin" dir="rtl">
  <header><div><p>الميدان · المحتوى المحلي</p><h1>إدارة الفئات والأسئلة</h1><p>تعديلات مستقلة للمباريات الجديدة. المصدر الأصلي والمباريات السابقة محفوظة.</p></div><Link className="button button--secondary" to="/">العودة للميدان</Link></header>
  {error&&<p ref={errorRef} tabIndex={-1} role="alert" className="local-admin-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {logoutFailed&&<button className="button button--secondary" disabled={busy} onClick={()=>void logout()}>إعادة محاولة خروج الإدارة</button>}
  {restoring||checking?<section className="local-admin-panel local-admin-auth" role="status">جارٍ التحقق من جلسة الإدارة…</section>:!session?<section className="local-admin-panel local-admin-auth"><h2>الدخول بحساب الإدارة المحلي</h2><p>حساب الإدارة مستقل عن حساب اللعب. تستمر جلسته في علامة التبويب هذه عند التنقل والتحديث، حتى تسجيل الخروج أو إغلاقها.</p><form onSubmit={e=>{e.preventDefault();void run(async()=>{const auth=await adminAuth();await signInWithEmailAndPassword(auth,email,password);setPassword('');});}}><label>البريد الإلكتروني<input dir="ltr" type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>كلمة المرور<input dir="ltr" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button button--primary" disabled={busy}>الدخول</button></form></section>:<>
  <div className="local-admin-session"><span>{session.email}</span><button className="button button--secondary" disabled={busy} onClick={()=>void logout()}>خروج الإدارة</button></div>
  <section className="local-admin-panel"><h2>تصفح المحتوى</h2><form className="local-admin-search" onSubmit={e=>{e.preventDefault();void run(()=>search());}}><label>الفئة<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">كل الفئات ({categories.length})</option>{categories.map(c=><option key={c.id} value={c.id}>{c.labelAr} · {c.questionCount} · {formatLabels[c.format]??c.id}</option>)}</select></label><label>بحث في السؤال أو المعرّف<input value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/></label><button className="button button--primary" disabled={busy}>بحث</button>{category&&<button type="button" className="button button--secondary" disabled={busy} onClick={()=>void run(()=>select(categories.find(c=>c.id===category)!,'category'))}>معاينة الفئة</button>}</form></section>
  <div className="local-admin-grid"><section className="local-admin-panel"><h2>الأسئلة <small>({total})</small></h2>{rows.map(q=><button key={q.id} className="local-admin-question" disabled={busy} onClick={()=>void run(()=>select(q,'question'))}><strong>{q.promptAr}</strong><small>{q.id} · {q.format?formatLabels[q.format]??q.format:'محتوى أصلي'}</small></button>)}{!rows.length&&<p>اختر فئة أو اكتب عبارة ثم ابحث.</p>}<nav aria-label="صفحات الأسئلة"><button className="button button--secondary" disabled={busy||offset===0} onClick={()=>void run(()=>search(Math.max(0,offset-30)))}>السابق</button><span>{total?offset+1:0}–{Math.min(offset+30,total)}</span><button className="button button--secondary" disabled={busy||offset+30>=total} onClick={()=>void run(()=>search(offset+30))}>التالي</button></nav></section>
  <section className="local-admin-panel"><h2>{selected?(entity==='category'?'تحرير الفئة':'معاينة وتحرير السؤال'):'اختر عنصراً'}</h2>{selected&&<><p className="local-admin-id">{selected.id}</p>{selected.sourceKind==='local-authored'&&<AuthoredPreview row={selected}/>}<details className="local-admin-provenance"><summary>المصدر والمعاينة</summary><dl><div><dt>المصدر</dt><dd>{selected.sourceKind==='local-authored'?'محتوى محلي مؤلف':'الإصدار الأصلي المحفوظ'}</dd></div><div><dt>الإصدار</dt><dd dir="ltr">{selected.releaseId}</dd></div><div><dt>بصمة المصدر</dt><dd dir="ltr">{selected.releaseRootHash}</dd></div></dl>{selected.media&&<><h3>وسائط السؤال</h3><RevisionValue value={selected.media}/></>}{selected.answerMedia&&<><h3>وسائط الإجابة</h3><RevisionValue value={selected.answerMedia}/></>}{selected.challenge&&<><h3>التحدي</h3><RevisionValue value={selected.challenge}/></>}</details><form onSubmit={e=>{e.preventDefault();void run(async()=>{if(entity==='question'&&(selected.format==='LIST_ITEMS'||selected.format==='ACTING_ITEMS')&&((payload.items??[]).length!==(selected.items??[]).length||(payload.items??[]).some((item:string)=>!item.trim())))throw Error('ITEM_COUNT');const draftPayload=selected.challenge?{promptAr:payload.promptAr,publicData:parseChallengeObject(payload.publicDataText),privateGrading:parseChallengeObject(payload.privateGradingText)}:payload;await api('/drafts',{entity,entityId:selected.id,payload:draftPayload});await reload();setNotice('حُفظت مسودة مستقلة. راجعها قبل التفعيل.');});}}><DraftFields row={selected} entity={entity} payload={payload} setPayload={setPayload} mediaOptions={mediaOptions}/><p>الحفظ ينشئ مسودة جديدة ولا يغيّر النسخ السابقة أو المحتوى الفعّال.</p><button className="button button--primary" disabled={busy}>حفظ مسودة جديدة</button></form>
  <h3>سجل المراجعات</h3>{revisions.some(r=>r.active)&&<button className="button button--secondary" disabled={busy} onClick={()=>void run(async()=>{await api('/restore-original',{entity,entityId:selected.id,expectedRevisionId:revisions.find(r=>r.active)!.id});await reload(true);setNotice('عاد المصدر الأصلي للمباريات الجديدة؛ بقي سجل المراجعات محفوظاً.');})}>استعادة المصدر الأصلي</button>}{revisions.map(r=><article key={r.id} className="local-admin-revision"><p>{r.active?'فعّالة':r.reviewerUid?'مراجَعة':'مسودة'} · {new Date(r.createdAt).toLocaleString('ar')}</p><dl>{Object.entries(r.payload).map(([k,v])=><div key={k}><dt>{({labelAr:'اسم الفئة',promptAr:'السؤال',canonicalAnswer:'الإجابة',acceptedAnswers:'الإجابات المقبولة',points:'النقاط',items:'العناصر',target:'الكلمة الخاصة بالرسّام',media:'وسائط السؤال',answerMedia:'وسائط الإجابة',challenge:'التحدي'} as Row)[k]??k}</dt><dd><RevisionValue value={v}/></dd></div>)}</dl>{!r.reviewerUid?<button className="button button--secondary" disabled={busy} onClick={()=>void run(async()=>{await api(`/revisions/${r.id}/review`,{});await reload();setNotice('اكتملت المراجعة. لم تُفعّل بعد.');})}>اعتماد المراجعة</button>:!r.active?<button className="button button--primary" disabled={busy} onClick={()=>void run(async()=>{await api(`/revisions/${r.id}/activate`,{expectedRevisionId:revisions.find(x=>x.active)?.id??null});await reload(true);setNotice('فُعّلت للمباريات الجديدة، وحُدثت المعاينة.');})}>تفعيل للمباريات الجديدة</button>:null}</article>)}</>}</section></div>
  </>}
 </main></div>;
}
