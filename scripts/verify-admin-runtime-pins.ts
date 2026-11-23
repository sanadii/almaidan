import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';

// REVIEW REQUIRED: creates fresh local admin revisions, activations and matches.
// Every touched head is restored to its exact initial value with compare-and-swap.
const root='D:/projects/huroof_wa_oloof/local/almaidan', base='http://127.0.0.1:14001/api/v1', huroof='http://127.0.0.1:18787', origin='http://127.0.0.1:5174';
const report:any={startedAt:new Date().toISOString(),checks:[],heads:[],cleanupErrors:[]};
const hash=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
async function main(){
 const source=JSON.parse(await readFile(`${root}/real-content.json`,'utf8'));
 const files=[`${root}/real-content.json`,`${root}/real-challenge-definitions.json`,`${root}/media-index.json`,source.source.path], hashes=await Promise.all(files.map(hash));assert.equal(hashes[3],source.source.sha256);
 const identity=JSON.parse(await readFile(`${root}/admin-identity.private.json`,'utf8')),connection=JSON.parse(await readFile(`${root}/connection.private.json`,'utf8')),url=new URL(connection.databaseUrl);
 assert.equal(identity.projectId,'demo-almaidan-local');assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15439');assert.equal(url.pathname,'/almaidan');
 async function login(email:string,password:string){const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});assert.equal(r.status,200);return r.json();}
 const admin=await login(identity.email,identity.password),creds=(await readFile('LOCAL-ALMAIDAN.md','utf8')).match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/);assert.ok(creds);const host=await login(creds[1],creds[2]);
 async function request(path:string,body?:unknown,token=admin.idToken,api=base){const r=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});let data:any;try{data=await r.json();}catch{data={};}return {status:r.status,data};}
 async function ok(path:string,body?:unknown,token=admin.idToken,api=base){const r=await request(path,body,token,api);assert.ok(r.status>=200&&r.status<300,`${path.split('?')[0]} status ${r.status} ${r.data.error??''}`);return r.data;}
 const require=createRequire(new URL('../services/enta/server/package.json',import.meta.url)),{PrismaClient}=require('@prisma/client'),db=new PrismaClient({datasourceUrl:connection.databaseUrl});
 async function active(entity:string,id:string){return (await ok(`/local-admin/revisions?entity=${entity}&entityId=${encodeURIComponent(id)}`)).revisions.find((r:any)=>r.active)?.id??null;}
 const heads:{entity:'category'|'question';id:string;prior:string|null;draft?:string}[]=[];
 async function publish(entity:'category'|'question',id:string,payload:any){const prior=await active(entity,id),head={entity,id,prior,draft:undefined as string|undefined};heads.push(head);const draft=await ok('/local-admin/drafts',{entity,entityId:id,payload});head.draft=draft.id;await ok(`/local-admin/revisions/${draft.id}/review`,{});await ok(`/local-admin/revisions/${draft.id}/activate`,{expectedRevisionId:prior});report.heads.push({entity,id,draft:draft.id});return draft.id;}
 async function classicStored(id:string){const rows=await db.$queryRawUnsafe("SELECT data->'matches'->$2 AS match FROM local_development.owner_state WHERE uid=$1",host.localId,id);assert.ok(rows[0]?.match);return rows[0].match;}
 async function roundStored(id:string){const rows=await db.$queryRawUnsafe("SELECT data->'games'->$1 AS game FROM local_development.round_state WHERE id=1",id);assert.ok(rows[0]?.game);return rows[0].game;}
 const teams=[{name:'فريق التجربة الأول',players:['نور']},{name:'فريق التجربة الثاني',players:['عمر']}];
 async function kids(categoryId:string){const setup={version:3,categoryKeys:[categoryId],teams:teams.map(t=>({...t,lifelines:[]})),rules:{questionSeconds:120}};return (await ok('/enta/matches/kids',{requestKey:randomUUID(),logicalMatchId:randomUUID(),setup},host.idToken)).match;}
 async function finishKids(m:any){return (await ok(`/enta/matches/${m.id}/commands`,{commandId:randomUUID(),expectedVersion:m.version,type:'FINISH',confirmEarly:true},host.idToken)).match;}
 async function mixed(categories:any[]){const setup={version:4,categories,teams,rules:{turnSeconds:45,overallSeconds:null,questionSeconds:120}};return (await ok('/enta/matches/mixed',{requestKey:randomUUID(),logicalMatchId:randomUUID(),setup},host.idToken)).match;}
 async function finishMixed(m:any){return (await ok(`/enta/round-matches/${m.id}/commands`,{commandId:randomUUID(),expectedVersion:m.version,type:'FINISH',confirmEarly:true},host.idToken)).match;}
 const categories=(await ok('/local-admin/categories')).categories;
 const k=categories.find((c:any)=>c.format==='KIDS'),l=categories.find((c:any)=>c.format==='LIST_ITEMS'),a=categories.find((c:any)=>c.format==='ACTING_ITEMS'),draw=categories.filter((c:any)=>c.format==='DRAWING_TARGET').slice(0,4);assert.ok(k&&l&&a&&draw.length===4);
 async function question(c:any){return (await ok(`/local-admin/questions?category=${encodeURIComponent(c.id)}&offset=0`)).questions[0];}
 const lq=await question(l),aq=await question(a);
 const setup=[{key:l.id,promptRefs:[lq.id]},{key:a.id,promptRefs:[aq.id]},...draw.map((c:any)=>({key:c.id,promptRefs:[]}))];
 let kidsBefore:any,kidsBeforePin:any,mixedBefore:any,mixedBeforePin:any,kidsAfter:any,mixedAfter:any;
 try{
  const inventory=await ok('/api/question-inventory',undefined,'',huroof),room=await ok('/api/rooms',{requestKey:randomUUID(),demo:true,displayName:'فحص الإدارة',categories:inventory.recommendedHuroofCategoryIds,questionSeconds:120,teams:{horizontal:'الشمس',vertical:'القمر'}},host.idToken,huroof),guest=await ok(`/api/rooms/${room.roomCode}/join`,{displayName:'ضيف المراجعة'},'',huroof);
  const cq=source.questions.find((q:any)=>q.challenge);for(const token of [host.idToken,guest.token,''])for(const path of [`/local-admin/challenge-definition?questionId=${encodeURIComponent(cq.id)}`,`/local-admin/revisions?entity=question&entityId=${encodeURIComponent(cq.id)}`])assert.ok([401,403].includes((await request(path,undefined,token)).status));report.checks.push('host, guest and anonymous denial for challenge definition and revisions');
  kidsBefore=await finishKids(await kids(k.id));kidsBeforePin=await classicStored(kidsBefore.id);
  mixedBefore=await finishMixed(await mixed(setup));mixedBeforePin=await roundStored(mixedBefore.id);
  const newLabel=(k.labelAr.slice(0,70)+' تجربة محلية');await publish('category',k.id,{labelAr:newLabel});
  const ids:any={};for(const [name,q] of [['list',lq],['acting',aq]] as const)ids[name]=await publish('question',q.id,{promptAr:q.promptAr.slice(0,1800)+' تجربة محلية',items:q.items.map((item:any)=>item.text)});
  const drawLabel=draw[0].labelAr.slice(0,70)+' تجربة محلية';ids.draw=await publish('category',draw[0].id,{labelAr:drawLabel});
  const state=(await db.$queryRawUnsafe("SELECT data FROM local_development.round_state WHERE id=1"))[0].data;
  const seen=new Set<string>((Object.values(state.games) as any[]).filter(g=>g.hostUid===host.localId).flatMap(g=>g.rounds.map((r:any)=>r.pin.sourceId)));
  const drawRows=(await ok(`/local-admin/questions?category=${encodeURIComponent(draw[0].id)}&offset=0`)).questions;
  const drawing=drawRows.filter((q:any)=>q.points===200).sort((x:any,y:any)=>Number(seen.has(x.id))-Number(seen.has(y.id))||x.id.localeCompare(y.id))[0];assert.ok(drawing);
  ids.drawing=await publish('question',drawing.id,{promptAr:drawing.promptAr,target:drawing.target+' جديد',points:drawing.points});ids.drawingId=drawing.id;

  kidsAfter=await finishKids(await kids(k.id));const kp=await classicStored(kidsAfter.id);assert.equal(kp.categories[0].label,newLabel);assert.notEqual(kp.releaseRootHash,kidsBeforePin.releaseRootHash);
  mixedAfter=await finishMixed(await mixed(setup));const mp=await roundStored(mixedAfter.id);assert.equal(mp.categories.find((c:any)=>c.key===draw[0].id).label,drawLabel);assert.equal(mp.rounds.find((r:any)=>r.pin.sourceId===ids.drawingId)?.pin.revisionId,ids.drawing);for(const [q,id] of [[lq,ids.list],[aq,ids.acting]] as const){const pin=mp.rounds.find((r:any)=>r.pin.sourceId===q.id)?.pin;assert.equal(pin?.revisionId,id);assert.ok(pin.prompt.endsWith('تجربة محلية'));}
  assert.deepEqual(await classicStored(kidsBefore.id),kidsBeforePin);assert.deepEqual(await roundStored(mixedBefore.id),mixedBeforePin);report.checks.push('new kids and mixed games consume published category and list/acting pins while old games remain unchanged');
 }finally{
  for(const head of [...heads].reverse())try{const current=await active(head.entity,head.id);if(current===head.prior)continue;if(!head.draft||current!==head.draft)throw Error('external head change');if(head.prior)await ok(`/local-admin/revisions/${head.prior}/activate`,{expectedRevisionId:current});else await ok('/local-admin/restore-original',{entity:head.entity,entityId:head.id,expectedRevisionId:current});assert.equal(await active(head.entity,head.id),head.prior);}catch{report.cleanupErrors.push(`${head.entity}:${head.id}`);}
  try{assert.deepEqual(await Promise.all(files.map(hash)),hashes);if(kidsBeforePin)assert.deepEqual(await classicStored(kidsBefore.id),kidsBeforePin);if(mixedBeforePin)assert.deepEqual(await roundStored(mixedBefore.id),mixedBeforePin);}catch{report.cleanupErrors.push('source or predecessor integrity');}
  await db.$disconnect();
 }
 assert.deepEqual(report.cleanupErrors,[]);report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=e instanceof Error?e.message:'unknown failure';process.exitCode=1;}).finally(async()=>{report.finishedAt=new Date().toISOString();const path=`${root}/admin-runtime-pins-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,...report}));});
