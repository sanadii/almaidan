import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';

// INDEPENDENT REVIEW REQUIRED BEFORE EXECUTION. Six immutable question revisions,
// two new/finished kids matches and one finished rematch; original heads restored by CAS.
const root='D:/projects/huroof_wa_oloof/local/almaidan',base='http://127.0.0.1:14001/api/v1',origin='http://127.0.0.1:5174';
const report:any={startedAt:new Date().toISOString(),heads:[],checks:[],cleanupErrors:[]};
const hash=async(p:string)=>createHash('sha256').update(await readFile(p)).digest('hex');
async function main(){
 const source=JSON.parse(await readFile(`${root}/real-content.json`,'utf8'));const paths=[`${root}/real-content.json`,`${root}/real-challenge-definitions.json`,`${root}/media-index.json`,source.source.path],hashes=await Promise.all(paths.map(hash));assert.equal(hashes[3],source.source.sha256);
 const identity=JSON.parse(await readFile(`${root}/admin-identity.private.json`,'utf8')),connection=JSON.parse(await readFile(`${root}/connection.private.json`,'utf8')),url=new URL(connection.databaseUrl);assert.equal(identity.projectId,'demo-almaidan-local');assert.equal(url.protocol,'postgresql:');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'15439');assert.equal(url.pathname,'/almaidan');
 async function login(email:string,password:string){const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});assert.equal(r.status,200);return r.json();}
 const admin=await login(identity.email,identity.password),creds=(await readFile('LOCAL-ALMAIDAN.md','utf8')).match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/);assert.ok(creds);const host=await login(creds[1],creds[2]);
 async function ok(path:string,body?:unknown,token=admin.idToken){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${token}`},body:body===undefined?undefined:JSON.stringify(body)});const data:any=await r.json();assert.ok(r.status>=200&&r.status<300,`${path.split('?')[0]} status ${r.status} ${data.error??''}`);return data;}
 const require=createRequire(new URL('../services/enta/server/package.json',import.meta.url)),{PrismaClient}=require('@prisma/client'),db=new PrismaClient({datasourceUrl:connection.databaseUrl});
 async function stored(id:string){const rows=await db.$queryRawUnsafe("SELECT data->'matches'->$2 AS match FROM local_development.owner_state WHERE uid=$1",host.localId,id);assert.ok(rows[0]?.match);return rows[0].match;}
 async function active(id:string){return (await ok(`/local-admin/revisions?entity=question&entityId=${encodeURIComponent(id)}`)).revisions.find((r:any)=>r.active)?.id??null;}
 const cats=(await ok('/local-admin/categories')).categories,category=cats.find((c:any)=>c.format==='KIDS');assert.ok(category);const rows=(await ok(`/local-admin/questions?category=${encodeURIComponent(category.id)}&offset=0`)).questions.filter((q:any)=>q.points===200);assert.equal(rows.length,6);
 const heads:{id:string;prior:string|null;draft?:string}[]=[];
 const setup={version:3,categoryKeys:[category.id],teams:[{name:'فريق التجربة الأول',players:['نور'],lifelines:[]},{name:'فريق التجربة الثاني',players:['عمر'],lifelines:[]}],rules:{questionSeconds:120}};
 async function start(){return (await ok('/enta/matches/kids',{requestKey:randomUUID(),logicalMatchId:randomUUID(),setup},host.idToken)).match;}
 async function finish(m:any){return (await ok(`/enta/matches/${m.id}/commands`,{commandId:randomUUID(),expectedVersion:m.version,type:'FINISH',confirmEarly:true},host.idToken)).match;}
 let before:any,beforePin:any,after:any,afterPin:any;
 try{
  before=await finish(await start());beforePin=await stored(before.id);
  for(const row of rows){const head={id:row.id,prior:await active(row.id),draft:undefined as string|undefined};heads.push(head);const payload={promptAr:row.promptAr.slice(0,1800)+' مراجعة محلية',canonicalAnswer:row.canonicalAnswer,acceptedAnswers:row.acceptedAnswers,points:row.points};const draft=await ok('/local-admin/drafts',{entity:'question',entityId:row.id,payload});head.draft=draft.id;report.heads.push({id:row.id,draft:draft.id});await ok(`/local-admin/revisions/${draft.id}/review`,{});await ok(`/local-admin/revisions/${draft.id}/activate`,{expectedRevisionId:head.prior});}
  after=await finish(await start());afterPin=await stored(after.id);const ids=new Map(heads.map(h=>[h.id,h.draft]));const tier=afterPin.questions.filter((q:any)=>q.points===200);assert.equal(tier.length,2);for(const q of tier){assert.equal(q.revisionId,ids.get(q.sourceQuestionId));assert.ok(q.prompt.endsWith('مراجعة محلية'));}assert.notEqual(afterPin.releaseRootHash,beforePin.releaseRootHash);assert.deepEqual(await stored(before.id),beforePin);report.checks.push('both allocated tier questions use newly published kids revisions; predecessor unchanged');
 }finally{
  for(const head of [...heads].reverse())try{const current=await active(head.id);if(current===head.prior)continue;if(!head.draft||current!==head.draft)throw Error('external head change');if(head.prior)await ok(`/local-admin/revisions/${head.prior}/activate`,{expectedRevisionId:current});else await ok('/local-admin/restore-original',{entity:'question',entityId:head.id,expectedRevisionId:current});assert.equal(await active(head.id),head.prior);}catch{report.cleanupErrors.push(head.id);}
  try{assert.deepEqual(await Promise.all(paths.map(hash)),hashes);if(beforePin)assert.deepEqual(await stored(before.id),beforePin);if(afterPin)assert.deepEqual(await stored(after.id),afterPin);}catch{report.cleanupErrors.push('source or predecessor integrity');}
  if(afterPin&&report.cleanupErrors.length===0)try{const config=await ok(`/enta/matches/${after.id}/rematch-setup`,undefined,host.idToken),body={requestKey:randomUUID(),logicalMatchId:randomUUID(),...config};delete body.mode;const result=await ok(`/enta/matches/${after.id}/rematch`,body,host.idToken),pinned=await stored(result.match.id);assert.equal(pinned.releaseId,afterPin.releaseId);assert.equal(pinned.releaseRootHash,afterPin.releaseRootHash);const archivedTier=pinned.questions.filter((q:any)=>q.points===200),ids=new Map(heads.map(h=>[h.id,h.draft]));assert.equal(archivedTier.length,2);for(const q of archivedTier){assert.equal(q.revisionId,ids.get(q.sourceQuestionId));assert.ok(q.prompt.endsWith('مراجعة محلية'));}assert.deepEqual(await stored(after.id),afterPin);await finish(result.match);report.checks.push('post-restore kids rematch reconstructs archived published release');}catch{report.cleanupErrors.push('archived kids rematch verification');}
  await db.$disconnect();
 }
 assert.deepEqual(report.cleanupErrors,[]);report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=e instanceof Error?e.message:'unknown failure';process.exitCode=1;}).finally(async()=>{report.finishedAt=new Date().toISOString();const path=`${root}/kids-revision-http-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,...report}));});
