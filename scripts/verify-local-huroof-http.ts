import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const root='D:/projects/huroof_wa_oloof/local/almaidan',base='http://127.0.0.1:18787',origin='http://127.0.0.1:5174';
const report:any={startedAt:new Date().toISOString(),scope:'actual local HTTP; new test rooms only',checks:[],rooms:[]};
async function req(path:string,body?:unknown,bearer?:string,extra:Record<string,string>={}){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{ }),...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
const check=(name:string)=>report.checks.push(name);
async function main(){
 const manual=await readFile('LOCAL-ALMAIDAN.md','utf8'),credentials=manual.match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/)!;
 const login=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:credentials[1],password:credentials[2],returnSecureToken:true})});const identity=await login.json();assert.equal(login.status,200,'local existing host authentication');const auth=identity.idToken;
 const inventory=(await req('/api/question-inventory')).data;assert.equal(inventory.categories.length,530);check('all530 original categories exposed');
 const payload={requestKey:randomUUID(),demo:true,displayName:'مراجعة محلية',categories:inventory.recommendedHuroofCategoryIds,questionSeconds:120,teams:{horizontal:'فريق الشمس',vertical:'فريق القمر'}};
 assert.equal((await req('/api/rooms',payload)).status,401);check('unauthenticated creation denied');
 const creations=await Promise.all([req('/api/rooms',payload,auth),req('/api/rooms',payload,auth)]);assert.ok(creations.every(r=>[200,201].includes(r.status)),JSON.stringify(creations.map(r=>({status:r.status,error:r.data.error}))));const room=creations[0].data;assert.equal(creations[1].data.roomId,room.roomId);assert.equal(creations[1].data.token,room.token);check('concurrent creation one room and stable capability');
 assert.equal((await req('/api/rooms',{...payload,displayName:'تغيير'},auth)).status,409);check('creation key cannot change payload');
 report.rooms.push({id:room.roomId,code:room.roomCode,purpose:'owned letters create and rematch'});
 const guest1=(await req(`/api/rooms/${room.roomCode}/join`,{displayName:'سارة مراجعة'})).data,guest2=(await req(`/api/rooms/${room.roomCode}/join`,{displayName:'عمر مراجعة'})).data;
 assert.ok(guest1.token&&guest2.token&&guest1.token!==guest2.token);
 const read=async(token:string)=>(await req(`/api/rooms/${room.roomId}`,undefined,token)).data;
 let metadata=await read(room.token);let revision=metadata.revision;
 const intent=async(type:string,payload:unknown={},token=room.token)=>{const r=await req(`/api/rooms/${room.roomId}/intents`,{type,payload,intentId:randomUUID(),expectedRevision:revision},token);assert.equal(r.status,200,JSON.stringify({type,status:r.status,error:r.data.error}));revision=r.data.revision;return r.data;};
 const m1=(await read(guest1.token)).projection.self,m2=(await read(guest2.token)).projection.self;
 assert.ok(m1.uid!==m2.uid);await intent('LOBBY_ASSIGN_TEAM',{memberUid:m1.uid,team:'horizontal'});await intent('LOBBY_ASSIGN_TEAM',{memberUid:m2.uid,team:'vertical'});await intent('LOBBY_SET_READY',{ready:true},guest1.token);await intent('LOBBY_SET_READY',{ready:true},guest2.token);
 const deny=await req(`/api/rooms/${room.roomId}/intents`,{type:'START_MATCH',payload:{},intentId:randomUUID(),expectedRevision:revision},guest1.token);assert.ok(deny.status>=400);check('guest cannot start or act as host');
 const display=room.audienceToken;assert.ok(display);const publicView=await read(display);assert.equal(publicView.projection.room.members.some((m:any)=>m.uid),false);check('display and guest role projections exclude roster authority IDs');
 await intent('START_MATCH');await intent('ROUND_READY');metadata=await read(room.token);const cell=metadata.projection.board.find((c:any)=>c.kind==='letter');assert.ok(cell);await intent('SELECT_CELL',{cellId:cell.id});
 const hostQuestion=(await read(room.token)).projection.question,guestQuestion=(await read(guest1.token)).projection.question;assert.ok(hostQuestion);assert.ok(!guestQuestion?.answer&&!guestQuestion?.answers);check('real question opens and guest has no answer');
 const notFinished=await req(`/api/rooms/${room.roomId}/rematch`,{requestKey:randomUUID()},auth,{'x-almaidan-host-capability':room.token});assert.equal(notFinished.status,409);check('unfinished predecessor cannot rematch');
 await intent('PAUSE');await intent('END_WITHOUT_WINNER');assert.equal((await read(display)).projection.room.state,'MATCH_COMPLETE');check('host early finish visible to display');
 const bad=await req(`/api/rooms/${room.roomId}/rematch`,{requestKey:randomUUID()},auth,{'x-almaidan-host-capability':display});assert.ok(bad.status>=400);check('display capability cannot rematch');
 const rematchKey=randomUUID(),first=await req(`/api/rooms/${room.roomId}/rematch`,{requestKey:rematchKey},auth,{'x-almaidan-host-capability':room.token}),second=await req(`/api/rooms/${room.roomId}/rematch`,{requestKey:rematchKey},auth,{'x-almaidan-host-capability':room.token});assert.equal(first.status,201,JSON.stringify({error:first.data.error}));assert.equal(second.status,200);assert.equal(first.data.roomId,second.data.roomId);assert.equal(first.data.token,second.data.token);assert.equal(first.data.predecessorRoomId,room.roomId);assert.equal(first.data.source.selection,'UNSEEN_PREDECESSOR');check('finished source-bound rematch exact replay');report.rooms.push({id:first.data.roomId,code:first.data.roomCode,purpose:'source-preserving successor'});
 const history=await req('/api/rooms/history',undefined,auth);assert.equal(history.status,200);assert.ok(!JSON.stringify(history.data).includes(room.token));assert.ok(JSON.stringify(history.data).includes(room.roomId));check('owner history lists persisted result without capabilities');
 const access=await req(`/api/rooms/${room.roomId}/owner-access`,{},auth);assert.equal(access.status,200);assert.equal(access.data.token,room.token);check('authenticated owner can recover same host access');
 assert.ok((await req('/api/rooms/history')).status>=400);assert.ok((await req(`/api/rooms/${room.roomId}/owner-access`,{},guest1.token)).status>=400);check('guests denied host history and owner recovery');
 const resumed=await req(`/api/rooms/${room.roomId}/resume`,{},guest1.token);assert.equal(resumed.status,200);check('same guest credential reconnects to completed room');
 report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=String(e);process.exitCode=1;}).finally(async()=>{report.finishedAt=new Date().toISOString();const path=`${root}/huroof-http-acceptance-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({path,...report}));});
