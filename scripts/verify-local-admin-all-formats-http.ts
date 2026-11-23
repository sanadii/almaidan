import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

// REVIEW REQUIRED BEFORE EXECUTION: this creates rooms, matches, drafts and review/activation history.
// Never delete records. Restores only heads created by this run, using CAS.
const root='D:/projects/huroof_wa_oloof/local/almaidan';
const origin='http://127.0.0.1:5174',base='http://127.0.0.1:14001/api/v1',huroof='http://127.0.0.1:18787';
const hash=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
const report:{startedAt:string; checks:string[]; entities:{kind:string;entity:string;id:string;draft:string}[]; cleanupErrors:string[];passed?:boolean;error?:string;finishedAt?:string}={startedAt:new Date().toISOString(),checks:[],entities:[],cleanupErrors:[]};
async function main(){
 const source=JSON.parse(await readFile(`${root}/real-content.json`,'utf8'));
 const paths=[`${root}/real-content.json`,`${root}/real-challenge-definitions.json`,`${root}/media-index.json`,source.source.path];
 const beforeHashes=await Promise.all(paths.map(hash));assert.equal(beforeHashes[3],source.source.sha256,'capture hash');
 const identity=JSON.parse(await readFile(`${root}/admin-identity.private.json`,'utf8'));assert.equal(identity.projectId,'demo-almaidan-local');
 const connection=JSON.parse(await readFile(`${root}/connection.private.json`,'utf8')),dbUrl=new URL(connection.databaseUrl);
 assert.equal(dbUrl.protocol,'postgresql:');assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'15439');assert.equal(dbUrl.pathname,'/almaidan');
 async function login(email:string,password:string){const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});assert.equal(r.status,200,'local sign-in');return r.json();}
 const admin=await login(identity.email,identity.password);assert.equal(admin.localId,identity.uid);
 const creds=(await readFile('LOCAL-ALMAIDAN.md','utf8')).match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/);assert.ok(creds);const host=await login(creds[1],creds[2]);
 async function request(path:string,body?:unknown,token=admin.idToken,url=base){const r=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});let data:any;try{data=await r.json();}catch{data={};}return {status:r.status,data};}
 async function ok(path:string,body?:unknown,token=admin.idToken,url=base){const r=await request(path,body,token,url);assert.ok(r.status>=200&&r.status<300,`${path.split('?')[0]} returned ${r.status} ${String(r.data.error??'')}`);return r.data;}
 const require=createRequire(new URL('../services/enta/server/package.json',import.meta.url));const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasourceUrl:connection.databaseUrl});
 const startSession=await ok('/local-admin/session');const categories=(await ok('/local-admin/categories')).categories;
 const supplementalBefore=categories.filter((c:any)=>c.sourceKind==='local-authored').map((c:any)=>[c.id,c.releaseId,c.releaseRootHash]);
 const heads:{entity:'question'|'category';id:string;prior:string|null;draft?:string}[]=[];
 async function revisions(entity:string,id:string){return (await ok(`/local-admin/revisions?entity=${entity}&entityId=${encodeURIComponent(id)}`)).revisions;}
 async function active(entity:string,id:string){return (await revisions(entity,id)).find((r:any)=>r.active)?.id??null;}
 async function selected(id:string,categoryId:string){const page=await ok(`/local-admin/questions?category=${encodeURIComponent(categoryId)}&q=${encodeURIComponent(id)}&offset=0`);const row=page.questions.find((q:any)=>q.id===id);assert.ok(row,`selected question ${id}`);return row;}
 async function stored(id:string){const rows=await db.$queryRawUnsafe("SELECT data->'matches'->$2 AS match FROM local_development.owner_state WHERE uid=$1",host.localId,id);assert.ok(rows[0]?.match);return rows[0].match;}
 const cat=(await ok('/enta/catalog',undefined,host.idToken)).categories;const originalCat=categories.find((c:any)=>c.sourceKind==='saved-release'&&cat.some((x:any)=>x.key===c.id));assert.ok(originalCat);
 const setup={version:2,categoryKeys:[originalCat.id,...cat.filter((x:any)=>x.key!==originalCat.id).slice(0,5).map((x:any)=>x.key)],teams:[{name:'فريق الاختبار الأول',players:['نور'],lifelines:[]},{name:'فريق الاختبار الثاني',players:['عمر'],lifelines:[]}],rules:{questionSeconds:60}};
 async function startMatch(){return (await ok('/enta/matches/classic',{requestKey:randomUUID(),logicalMatchId:randomUUID(),setup},host.idToken)).match;}
 async function finish(match:any){return (await ok(`/enta/matches/${match.id}/commands`,{commandId:randomUUID(),expectedVersion:match.version,type:'FINISH',confirmEarly:true},host.idToken)).match;}
 let predecessor:any,predecessorState:any,overlayPredecessor:any,overlayState:any;
 try{
  // A real room guest capability is a distinct principal from the signed-in host.
  const inventory=await ok('/api/question-inventory',undefined,'',huroof);
  const room=await ok('/api/rooms',{requestKey:randomUUID(),demo:true,displayName:'اختبار الإدارة',categories:inventory.recommendedHuroofCategoryIds,questionSeconds:120,teams:{horizontal:'فريق الشمس',vertical:'فريق القمر'}},host.idToken,huroof);
  const guest=await ok(`/api/rooms/${room.roomCode}/join`,{displayName:'ضيف الاختبار'},'',huroof);assert.ok(guest.token);
  for(const token of [host.idToken,guest.token,'']){const denied=await request('/local-admin/session',undefined,token);assert.ok(denied.status===401||denied.status===403);}
  report.checks.push('ordinary host, actual room guest and unauthenticated request denied admin');
  predecessor=await finish(await startMatch());predecessorState=await stored(predecessor.id);
  const representatives:{kind:string;entity:'question'|'category';row:any;payload:any}[]=[{kind:'category',entity:'category',row:originalCat,payload:{labelAr:(originalCat.labelAr.slice(0,70)+' مراجعة محلية')}}];
  for(const format of ['KIDS','LIST_ITEMS','ACTING_ITEMS','DRAWING_TARGET']){
   const category=categories.find((c:any)=>c.format===format);assert.ok(category,format);const page=await ok(`/local-admin/questions?category=${encodeURIComponent(category.id)}&offset=0`);const row=page.questions[0];assert.ok(row,format);
   const promptAr=row.promptAr.slice(0,1900)+' مراجعة محلية';let payload:any;
   if(format==='KIDS')payload={promptAr,canonicalAnswer:row.canonicalAnswer,acceptedAnswers:row.acceptedAnswers,points:row.points};
   else if(format==='DRAWING_TARGET')payload={promptAr,target:row.target,points:row.points};
   else payload={promptAr,items:row.items.map((item:any)=>item.text)};
   representatives.push({kind:format,entity:'question',row,payload});
  }
  for(const type of ['image','video']){const sourceRow=source.questions.find((q:any)=>q.modality===type&&q.media&&!q.challenge);assert.ok(sourceRow,type);const row=await selected(sourceRow.id,sourceRow.categoryId);const options=(await ok(`/local-admin/media-options?type=${type}`)).options;assert.ok(options.some((x:any)=>x.mediaId===row.media.mediaId&&x.assetSha256===row.media.assetSha256));representatives.push({kind:type,entity:'question',row,payload:{promptAr:row.promptAr.slice(0,1900)+' مراجعة محلية',canonicalAnswer:row.canonicalAnswer,acceptedAnswers:row.acceptedAnswers,media:row.media,answerMedia:row.answerMedia??null}});}
  for(const kind of ['memory','missing_tile','navigation','word_search']){const sourceRow=source.questions.find((q:any)=>q.challenge?.kind===kind);assert.ok(sourceRow,kind);const row=await selected(sourceRow.id,sourceRow.categoryId);const definition=await ok(`/local-admin/challenge-definition?questionId=${encodeURIComponent(row.id)}`);if(kind==='memory'){assert.equal(typeof definition.privateGrading?.recallData?.promptAr,'string');definition.privateGrading.recallData.promptAr=definition.privateGrading.recallData.promptAr.slice(0,1900)+' مراجعة محلية';}representatives.push({kind,entity:'question',row,payload:{promptAr:row.promptAr.slice(0,1900)+' مراجعة محلية',publicData:definition.publicData,privateGrading:definition.privateGrading}});}
  assert.equal(new Set(representatives.map(x=>`${x.entity}:${x.row.id}`)).size,representatives.length);
  for(const rep of representatives)heads.push({entity:rep.entity,id:rep.row.id,prior:await active(rep.entity,rep.row.id)});
  for(let i=0;i<representatives.length;i++){
   const rep=representatives[i],head=heads[i];assert.equal(await active(head.entity,head.id),head.prior,'head changed before test');
   const draft=await ok('/local-admin/drafts',{entity:head.entity,entityId:head.id,payload:rep.payload});head.draft=draft.id;report.entities.push({kind:rep.kind,entity:head.entity,id:head.id,draft:draft.id});
   assert.equal((await request(`/local-admin/revisions/${draft.id}/activate`,{expectedRevisionId:head.prior})).status,409,'review gate');
   assert.equal((await request(`/local-admin/revisions/${draft.id}/review`,{},host.idToken)).status,403,'host review denied');
   assert.ok([401,403].includes((await request(`/local-admin/revisions/${draft.id}/review`,{},guest.token)).status),'guest review denied');
   await ok(`/local-admin/revisions/${draft.id}/review`,{});
   assert.equal((await request(`/local-admin/revisions/${draft.id}/activate`,{expectedRevisionId:'wrong-head'})).status,409,'CAS rejects stale head');
   await ok(`/local-admin/revisions/${draft.id}/activate`,{expectedRevisionId:head.prior});assert.equal(await active(head.entity,head.id),draft.id);
   const revised=(await revisions(head.entity,head.id)).find((r:any)=>r.id===draft.id);assert.deepEqual(revised.payload,draft.payload);assert.equal(revised.digest,draft.digest);
   if(rep.kind==='memory'){const changed=await selected(rep.row.id,rep.row.categoryId);assert.notEqual(changed.challenge.definition.definitionSha256,rep.row.challenge.definition.definitionSha256,'challenge definition hash changes');}
   if(i===0){assert.deepEqual(await stored(predecessor.id),predecessorState);overlayPredecessor=await finish(await startMatch());overlayState=await stored(overlayPredecessor.id);assert.notEqual(overlayState.releaseId,predecessorState.releaseId);assert.equal(overlayState.categories.find((c:any)=>c.key===originalCat.id).label,rep.payload.labelAr);}
  }
  report.checks.push('fresh drafts, review gating, authorization, CAS and immutable payloads across all eleven representatives');
  assert.deepEqual(await stored(predecessor.id),predecessorState);assert.deepEqual(await stored(overlayPredecessor.id),overlayState);
 }finally{
  // A response can fail after commit. Query the actual head and only restore our own revision.
  for(const head of [...heads].reverse())try{const current=await active(head.entity,head.id);if(current===head.prior)continue;if(!head.draft||current!==head.draft)throw Error('head changed externally; no overwrite');if(head.prior)await ok(`/local-admin/revisions/${head.prior}/activate`,{expectedRevisionId:current});else await ok('/local-admin/restore-original',{entity:head.entity,entityId:head.id,expectedRevisionId:current});assert.equal(await active(head.entity,head.id),head.prior);}catch{report.cleanupErrors.push(`${head.entity}:${head.id}`);}
  try{assert.equal((await ok('/local-admin/session')).activeReleaseId,startSession.activeReleaseId);const after=(await ok('/local-admin/categories')).categories.filter((c:any)=>c.sourceKind==='local-authored').map((c:any)=>[c.id,c.releaseId,c.releaseRootHash]);assert.deepEqual(after,supplementalBefore);assert.deepEqual(await Promise.all(paths.map(hash)),beforeHashes);if(predecessorState)assert.deepEqual(await stored(predecessor.id),predecessorState);if(overlayState)assert.deepEqual(await stored(overlayPredecessor.id),overlayState);report.checks.push('prior heads, active releases, source/index hashes and predecessor pins restored');}catch{report.cleanupErrors.push('release, source or predecessor verification');}
  if(overlayState&&report.entities.length===11&&report.cleanupErrors.length===0)try{const config=await ok(`/enta/matches/${overlayPredecessor.id}/rematch-setup`,undefined,host.idToken),body={requestKey:randomUUID(),logicalMatchId:randomUUID(),...config};delete body.mode;const rematch=await ok(`/enta/matches/${overlayPredecessor.id}/rematch`,body,host.idToken);const pin=await stored(rematch.match.id);assert.equal(pin.releaseId,overlayState.releaseId);assert.equal(pin.releaseRootHash,overlayState.releaseRootHash);assert.deepEqual(pin.categories,overlayState.categories);assert.deepEqual(await stored(overlayPredecessor.id),overlayState);await finish(rematch.match);report.checks.push('archived overlay predecessor rematch retains its pinned release after restoration');}catch{report.cleanupErrors.push('archived overlay rematch verification');}
  await db.$disconnect();
 }
 assert.deepEqual(report.cleanupErrors,[],'cleanup or rematch verification incomplete; inspect recorded entities and heads');
 report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=e instanceof Error?e.message:'unknown failure';process.exitCode=1;}).finally(async()=>{report.finishedAt=new Date().toISOString();const path=`${root}/admin-all-formats-http-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,...report}));});

