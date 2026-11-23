import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CLIENT_CHALLENGE_CAPABILITY as offer} from '../src/features/game/runtime/contracts.js';
const root='D:/projects/huroof_wa_oloof/local/almaidan',base='http://127.0.0.1:18787',origin='http://127.0.0.1:5174';
const report:any={startedAt:new Date().toISOString(),scope:'new UI review rooms; original content; challenges ready at briefing; media paused',media:[],challenges:[]};let auth='';
async function req(path:string,body?:unknown,bearer?:string){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
const db=new DatabaseSync(root+'/huroof.sqlite',{readOnly:true});
const stored=(id:string)=>JSON.parse((db.prepare('SELECT data FROM rooms WHERE id=?').get(id) as any).data);
async function create(category:string){
 const r=await req('/api/rooms',{requestKey:randomUUID(),demo:true,displayName:'فحص المحتوى المحلي',gameKind:'categories',categories:[category,'tahadani-051'],challenge:offer,questionSeconds:120},auth);assert.equal(r.status,201,JSON.stringify({status:r.status,error:r.data.error}));const room=r.data;
 const read=async(token=room.token)=>{const r=await req(`/api/rooms/${room.roomId}?challenge=${encodeURIComponent(JSON.stringify(offer))}`,undefined,token);assert.equal(r.status,200);return r.data;};
 let revision=(await read()).revision;
 const send=async(type:string,payload:unknown={},token=room.token)=>{const r=await req(`/api/rooms/${room.roomId}/intents`,{type,payload,intentId:randomUUID(),expectedRevision:revision},token);assert.equal(r.status,200,JSON.stringify({type,status:r.status,error:r.data.error}));revision=r.data.revision;return r.data;};
 const guest1=(await req(`/api/rooms/${room.roomCode}/join`,{displayName:'دليل محلي',challenge:offer})).data,guest2=(await req(`/api/rooms/${room.roomCode}/join`,{displayName:'لاعب محلي',challenge:offer})).data;revision=(await read()).revision;
 const uid1=(await read(guest1.token)).projection.self.uid,uid2=(await read(guest2.token)).projection.self.uid;
 await send('LOBBY_ASSIGN_TEAM',{memberUid:uid1,team:'horizontal'});await send('LOBBY_ASSIGN_TEAM',{memberUid:uid2,team:'vertical'});await send('LOBBY_SET_READY',{ready:true},guest1.token);await send('LOBBY_SET_READY',{ready:true},guest2.token);await send('LOBBY_ADD_MANUAL_PLAYER',{displayName:'متحرك محلي',team:'horizontal'});
 await send('LOBBY_ADD_MANUAL_PLAYER',{displayName:'دليل الشاشة',team:'horizontal'});await send('LOBBY_ADD_MANUAL_PLAYER',{displayName:'قائد الفريق الثاني',team:'vertical'});
 await send('START_MATCH');await send('ROUND_READY');const view=(await read()).projection;const cell=view.board.find((c:any)=>c.categoryId===category);assert.ok(cell,'category board cell');await send('SELECT_CELL',{cellId:cell.id});
 return {room,read,send,guest1,guest2,uid1,uid2,sync:async()=>{revision=(await read()).revision;},close:async()=>{await send('PAUSE');await send('END_WITHOUT_WINNER');}};
}
async function main(){
 const manual=await readFile('LOCAL-ALMAIDAN.md','utf8'),cred=manual.match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/)!;
 const login=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:cred[1],password:cred[2],returnSecureToken:true})});assert.equal(login.status,200);auth=(await login.json()).idToken;
 const kinds=[['memory','tahadani-games-132'],['missing_tile','tahadani-games-127'],['navigation','tahadani-games-120'],['word_search','tahadani-games-122'],['image','tahadani-014'],['video','goals-2026']];
 for(const [kind,category] of kinds.filter(([kind])=>!process.argv.includes('--remaining')||!['memory','missing_tile'].includes(kind))){
  const c=await create(category);let question=stored(c.room.roomId).activeQuestion;
  if(kind==='image'||kind==='video'){assert.equal(question.modality,kind);await c.send('PAUSE');report.media.push({kind,category,roomId:c.room.roomId,roomCode:c.room.roomCode,url:origin+`/room/${c.room.roomCode}/host`,state:'paused opened media question; resume in host UI'});}
  else{
   for(let skipped=0;!question.challenge&&skipped<10;skipped++){await c.send('HOST_SELECT_TEAM',{team:'horizontal'});await c.send('JUDGE_CORRECT');const next=(await c.read()).projection.board.find((x:any)=>x.categoryId===category&&!x.owner);assert.ok(next);await c.send('SELECT_CELL',{cellId:next.id});question=stored(c.room.roomId).activeQuestion;}assert.ok(question.challenge);
   const ch=async()=>(await c.read()).projection.challenge;
   const send=async(type:string,extra:unknown={},token=c.room.token)=>{await c.sync();const q=await ch();return c.send(type,{occurrence:q.occurrence,challengeRevision:q.revision,stage:q.stage,...extra as object},token);};
   const roster=stored(c.room.roomId).manualParticipants,horiz=roster.filter((p:any)=>p.team==='horizontal'),vert=roster.find((p:any)=>p.team==='vertical');const assigned:string[]=[];
   const assign=async(assignment:string,id:string)=>{const participantId='manual:'+id;await send('CHALLENGE_ASSIGN',{assignment,participantId});assigned.push(participantId);};
   if(kind==='navigation'){await send('CHALLENGE_ASSIGN',{assignment:'guide',participantId:'member:'+c.uid1});assigned.push('member:'+c.uid1);await assign('mover',horiz[0].id);}else{await assign('captain',horiz[0].id);if(kind==='missing_tile')await assign('stealCaptain',vert.id);}
   for(const participantId of assigned){const q=await ch();await send('CHALLENGE_READY',{participantId,readiness:{protocolHash:q.readiness.protocolHash,assignmentHash:q.readiness.assignmentHash,stimulusHash:q.readiness.stimulusHash}},participantId.startsWith('member:')?c.guest1.token:c.room.token);}
   const view=await ch();report.challenges.push({kind,category,roomId:c.room.roomId,roomCode:c.room.roomCode,url:origin+`/room/${c.room.roomCode}/host`,stage:view.stage,definitionId:question.challenge.definition.id,manualRoles:true,ready:true,countdownStarted:false});
  }
  console.log(JSON.stringify({prepared:(kind==='image'||kind==='video'?report.media:report.challenges).at(-1)}));
 }
 report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=String(e);process.exitCode=1;}).finally(async()=>{db.close();report.finishedAt=new Date().toISOString();const path=`${root}/huroof-browser-review-rooms-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,...report}));});
