/** Local HTTP acceptance. Creates new test identities/rooms; never resets existing state. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {assertLocalDevelopment,LOCAL_PROJECT} from './guard';
const base='http://127.0.0.1:14001/api/v1/enta',key=()=>randomUUID();
async function signIn(email:string,password:string){const r=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const data=await r.json() as any;if(!r.ok||!data.idToken)throw Error('LOCAL_SIGN_IN_FAILED');return data.idToken as string;}
async function main(){
 assertLocalDevelopment();const report:any={at:new Date().toISOString(),localOnly:true,checks:[]},path=`D:/projects/huroof_wa_oloof/local/almaidan/rooms-live-recovery-${Date.now()}.json`;
 const save=()=>writeFile(path,JSON.stringify(report,null,2));
 const admin=initializeApp({projectId:LOCAL_PROJECT},`live-recovery-${key()}`),email=`live-recovery-${key()}@example.test`,password=randomBytes(24).toString('base64url');
 await getAuth(admin).createUser({email,password,emailVerified:true});const ownerToken=await signIn(email,password);
 async function request(route:string,body?:unknown,guest?:string,expected?:number,bearer=ownerToken){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(guest?{'x-enta-room-token':guest}:{authorization:`Bearer ${bearer}`})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});const data=await response.json() as any;if(expected===undefined)assert.ok(response.ok,`${route}: ${response.status} ${data.error??''}`);else assert.equal(response.status,expected,`${route}: ${response.status} ${data.error??''}`);return data;}
 try{
  for(const competitive of [false,true]){
   const engine=competitive?'competitive':'round',prefix=competitive?'/competition':'',catalog=await request(`${prefix}/catalog/list`),category=catalog.categories[0];
   const names=[{name:'الفريق الأول',players:['نور','سارة']},{name:'الفريق الثاني',players:['عمر','علي']}];
   const setup=competitive?{version:5,categories:[{key:category.key,promptRefs:[]}],teams:names.map((t,i)=>({...t,colorKey:i?'SKY':'CORAL',aids:['HINT','DOUBLE','PHONE']})),rules:{version:'enta-competitive-1',paletteVersion:'enta-team-palette-1',questionSeconds:120,turnSeconds:15,overallSeconds:300,stealSeconds:10,phoneSeconds:60,embeddedStealCap:200}}:{version:4,categories:[{key:category.key,promptRefs:[]}],teams:names,rules:{turnSeconds:15,overallSeconds:300,questionSeconds:120}};
   let match=(await request(`${prefix}/matches/list`,{requestKey:key(),logicalMatchId:key(),setup})).match;
   let room=(await request('/rooms',{engine,matchId:match.id,requestKey:key()})).room;assert.equal(room.actionsVersion,2);const rp=`/rooms/${room.code}`;
   const a=await request(`${rp}/join`,{name:'نور',requestKey:key()},'unauthenticated'),b=await request(`${rp}/join`,{name:'عمر',requestKey:key()},'unauthenticated');room=b.room;
   for(const [index,member]of[a,b].entries())room=(await request(`${rp}/host`,{commandId:key(),expectedVersion:room.version,type:'ASSIGN',memberId:member.memberId,teamIndex:index,playerIndex:0,captain:false})).room;
   const display=await request(`${rp}/host`,{commandId:key(),expectedVersion:room.version,type:'DISPLAY'});room=display.room;
   room=(await request(`${rp}/host`,{commandId:key(),expectedVersion:room.version,type:'START'})).room;
   const command=async(type:string,extra:any={})=>{const response=await request(`${rp}/engine`,{command:{commandId:key(),expectedVersion:match.version,type,...extra}});match=response.match;return response;};
   await command('NEXT_ROUND');const roundId=match.currentRound.id,itemId=match.currentRound.items[0].id;
   const submission={commandId:key(),expectedVersion:match.version,roundId,itemId,type:competitive?'RECORD_ATTEMPT':'SUBMIT_ANSWER',submittedText:'تُفاحة'};
   await request(`${rp}/actions`,submission,display.token,403);
   await request(`${rp}/actions`,submission,b.token,409);
   const sent=await request(`${rp}/actions`,submission,a.token);assert.equal(sent.room.submissions.length,1);assert.equal(sent.room.submissions[0].text,'تُفاحة');
   assert.equal((await request(`${rp}/actions`,submission,a.token)).idempotent,true);
   await request(`${rp}/actions`,{...submission,commandId:key(),submittedText:'تفاحة'},a.token,409);
   await request(`${rp}/actions`,{...submission,commandId:key(),submittedText:'  َُِ  '},a.token,400);
   const other=(await request(`${rp}/view`,undefined,b.token)).room,screen=(await request(`${rp}/view`,undefined,display.token)).room,host=(await request(rp)).room;
   assert.equal(other.submissions.length,0);assert.equal(screen.submissions.length,0);assert.equal(host.submissions.length,1);
   assert.equal(JSON.stringify(other).includes('تُفاحة'),false);assert.equal(JSON.stringify(screen).includes('تُفاحة'),false);
   assert.ok(host.match.teams.every((t:any)=>t.score===0));match=host.match;
   // A real server deadline is exercised with normal elapsed time, not a mocked clock.
   const deadline=match.currentRound.deadline??match.currentRound.turnDeadline;
   assert.equal(typeof deadline,'number');await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-match.serverNow)+250));
   const expired=await fetch(base+`${rp}/actions`,{method:'POST',headers:{'content-type':'application/json','x-enta-room-token':a.token},body:JSON.stringify({...submission,commandId:key(),submittedText:'موز'})});assert.ok([403,409].includes(expired.status));
   match=(await request(rp)).room.match;
   if(competitive&&match.currentRound){const pending=await request(`/competition/matches/${match.id}/pages`,{collection:'pending',roundId,effectId:null,snapshot:match.version,cursor:null});await command('PUBLIC_REVEAL',{roundId,itemId});if(pending.rows.length)await command('FINAL_RULING',{roundId,itemId,classifications:pending.rows.map((a:any)=>[a.id,false])});if(match.currentRound&&!match.currentRound.publicRevealed)await command('PUBLIC_REVEAL',{roundId,itemId:null});}
   if(match.currentRound)await command('CLOSE_ROUND',{roundId});
   assert.equal((await request(`${rp}/actions`,submission,a.token)).idempotent,true);
   await command('FINISH',{confirmEarly:true});const finishedId=match.id,finishedVersion=match.version;
   const before=JSON.stringify(await request(`/matches/${finishedId}/original-result`));
   const review=await request(`/local-rematches/${engine}/${finishedId}/setup`);assert.equal(review.predecessor.id,finishedId);
   const retryBody={requestKey:key(),logicalMatchId:key(),predecessorVersion:finishedVersion};
   const successor=await request(`/local-rematches/${engine}/${finishedId}`,retryBody),recovered=await request(`/local-rematches/${engine}/${finishedId}`,retryBody);
   assert.equal(successor.match.id,recovered.match.id);assert.equal(recovered.idempotent,true);assert.notEqual(successor.match.id,finishedId);assert.deepEqual(successor.source,review.source);
   assert.equal(JSON.stringify(await request(`/matches/${finishedId}/original-result`)),before);
   const linked=await request('/rooms',{engine,matchId:successor.match.id,requestKey:key()});assert.equal(linked.room.phase,'LOBBY');
   const history=await request('/matches/history');assert.ok(history.matches.some((m:any)=>m.id===finishedId));assert.ok(history.matches.some((m:any)=>m.id===successor.match.id));
   await request(`${rp}/private`,undefined,a.token,403);
   report.checks.push({engine,mode:'list',code:room.code,matchId:finishedId,successorId:successor.match.id,typedSubmission:true,duplicateAndEmptyRejected:true,otherGuestAndDisplayPrivacy:true,realDeadlineRejected:true,retryAfterClose:true,hostAdjudicationOnly:true,rematchIdempotent:true,parentResultUnchanged:true,history:true});await save();console.log(`PASSED ${engine}: typed/deadline/privacy/rematch`);
  }
  // Read existing accepted game after the naturally stopped services were started anew.
  const runbook=await readFile('LOCAL-ALMAIDAN.md','utf8'),credentials=runbook.match(/Existing local player login: `([^`]+)` \/ `([^`]+)`/);assert.ok(credentials);
  const oldOwner=await signIn(credentials[1],credentials[2]),oldRoom=(await request('/rooms/E1-HZ7QY2PJ',undefined,undefined,200,oldOwner)).room;
  assert.equal(oldRoom.phase,'FINISHED');assert.equal(oldRoom.matchId,'3483f65b-909a-4f93-a1cd-2ee04e1a29a7');assert.deepEqual(oldRoom.match.teams.map((t:any)=>t.score),[1200,1200]);
  report.restartReadback={roomCode:oldRoom.code,matchId:oldRoom.matchId,phase:oldRoom.phase,scores:[1200,1200],existingDataReadOnly:true};await save();console.log(`REPORT ${path}`);
 }catch(error){report.failure=error instanceof Error?error.message:String(error);await save();throw error;}finally{await deleteApp(admin);}
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'LIVE_RECOVERY_FAILED');process.exitCode=1;});
