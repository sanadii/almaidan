import {randomBytes,randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';import {initializeApp,deleteApp} from 'firebase-admin/app';import {getAuth} from 'firebase-admin/auth';import {assertLocalDevelopment,LOCAL_PROJECT} from './guard';
const base='http://127.0.0.1:14001/api/v1/enta',key=()=>randomUUID();
const complete=process.env.ALMAIDAN_ROOM_MATRIX_COMPLETE==='true';
/** Real HTTP lifecycle proof. Outcomes are scripted host adjudications, not a factual-answer or human-play review. */
async function completeJourney(context:any){
 const {request,roomPath,isLegacy,isCompetitive,standalone,guestA,guestB,display,command,getMatch,setMatch}=context;
 let completed=0,itemsJudged=0,canvasRounds=0,privacyChecks=0,duplicateScoringChecked=false;
 const formats=new Set<string>();
 const publicPrivacy=async()=>{
  for(const credential of [guestA.token,guestB.token,display.token]){
   const view=(await request(`${roomPath}/view`,undefined,credential)).room.match;
   if(view.currentQuestion?.answers||view.currentRound?.target||view.currentRound?.items?.some((item:any)=>!item.consumed&&!item.revealed&&('text' in item||'trap' in item||'value' in item)))throw Error('PRIVATE_CONTENT_LEAK');
   privacyChecks++;
  }
 };
 const score=async(type:string,extra:any)=>{
  const body={command:{commandId:key(),expectedVersion:getMatch().version,type,...extra}};
  const first=await request(`${roomPath}/engine`,body);setMatch(first.match);
  if(!duplicateScoringChecked){const replay=await request(`${roomPath}/engine`,body);if(!replay.idempotent||replay.match.version!==first.match.version||JSON.stringify(replay.match.teams)!==JSON.stringify(first.match.teams))throw Error('SCORING_REPLAY_FAILED');duplicateScoringChecked=true;}
 };
 const prescribed=isLegacy?getMatch().tiles.length:getMatch().rounds.length;
 for(let ordinal=0;ordinal<prescribed;ordinal++){
  if(isLegacy){
   const questionId=getMatch().tiles.find((tile:any)=>!tile.used)?.id;if(!questionId)throw Error('UNPLAYED_QUESTION_MISSING');
   await command('OPEN_QUESTION',{questionId});await publicPrivacy();await command('REVEAL_ANSWER',{questionId});
   await score('ADJUDICATE',{questionId,ruling:'CORRECT',teamId:getMatch().currentQuestion.answeringTeamId});formats.add('ORDINARY_TIER');completed++;continue;
  }
  const ready=getMatch().rounds.find((round:any)=>(round.state??round.phase)==='READY');if(!ready)throw Error('UNPLAYED_ROUND_MISSING');
  await command(standalone?'NEXT_ROUND':'OPEN_ROUND',standalone?{}:{roundId:ready.id});
  const roundId=getMatch().currentRound.id,format=getMatch().currentRound.format;formats.add(format);
  const itemIds=getMatch().currentRound.items.length?getMatch().currentRound.items.map((item:any)=>item.id):[null];
  for(const itemId of itemIds){
   const active=getMatch().currentRound,teamId=active.currentTeamId??active.scoringTeamId,teamIndex=getMatch().teams.findIndex((team:any)=>team.id===teamId);
   let room=(await request(roomPath)).room;
   for(const [index,guest] of [guestA,guestB].entries())room=(await request(`${roomPath}/host`,{commandId:key(),expectedVersion:room.version,type:'ASSIGN',memberId:guest.memberId,teamIndex,playerIndex:index,captain:index===1})).room;
   await publicPrivacy();
   if(format==='DRAWING_TARGET'||format==='ACTING_ITEMS'){
    await command('ASSIGN_ACTOR',{roundId,teamId,...(isCompetitive?{playerId:getMatch().teams[teamIndex].players[0].id}:{playerIndex:0}),itemId});
    await request(`${roomPath}/member-grant`,{memberId:guestA.memberId,role:'ACTOR'});
    const privateView=await request(`${roomPath}/private`,undefined,guestA.token);if(!privateView.capability.target)throw Error('ACTOR_TARGET_MISSING');
    await request(`${roomPath}/private`,undefined,guestB.token,204);await request(`${roomPath}/private`,undefined,display.token,204);privacyChecks+=2;
    setMatch((await request(roomPath)).room.match);await publicPrivacy();
    if(format==='DRAWING_TARGET'){
     await request(`${roomPath}/canvas`,{commandId:key(),expectedRevision:0,type:'APPEND',stroke:{id:key(),color:'#191615',width:2,erase:false,points:[[100,100],[500,500]]}},guestA.token);
     const canvas=await request(`${roomPath}/public-canvas`,undefined,display.token);if(canvas.page.strokes.length!==1)throw Error('DISPLAY_CANVAS_MISSING');canvasRounds++;
     setMatch((await request(roomPath)).room.match);
    }
   }
   if(isCompetitive){
    const accepted=await request(`${roomPath}/actions`,{commandId:key(),expectedVersion:getMatch().version,type:'RECORD_ATTEMPT',roundId,itemId},guestB.token);setMatch(accepted.room.match);
    const pending=await request(`/competition/matches/${getMatch().id}/pages`,{collection:'pending',roundId,effectId:null,snapshot:getMatch().version,cursor:null});
    if(pending.rows.length!==1)throw Error('ATTEMPT_MISSING');
    await command('PUBLIC_REVEAL',{roundId,itemId});await score('FINAL_RULING',{roundId,itemId,classifications:[[pending.rows[0].id,true]]});
   }else{
    // Text is explicitly synthetic; only the authorized host decides whether it scores.
    const submission={commandId:key(),expectedVersion:getMatch().version,type:'SUBMIT_ANSWER',roundId,itemId,submittedText:`إجابة اختبار الجولة ${ordinal+1} العنصر ${itemsJudged+1}`};
    await request(`${roomPath}/actions`,submission,guestB.token);
    const replay=await request(`${roomPath}/actions`,submission,guestB.token);if(!replay.idempotent)throw Error('SUBMISSION_REPLAY_FAILED');
    const screen=(await request(`${roomPath}/view`,undefined,display.token)).room;
    if(JSON.stringify(screen).includes(submission.submittedText))throw Error('PRIVATE_SUBMISSION_LEAK');
    if(itemId!==null)await score('JUDGE_ITEM',{roundId,itemId});else{await command('REVEAL_TARGET',{roundId});await score('ADJUDICATE_ROUND',{roundId,teamId,correct:true});}
   }
   itemsJudged++;
  }
  if(getMatch().currentRound)throw Error('ROUND_NOT_NATURALLY_RESOLVED');completed++;
 }
 await command('FINISH',{confirmEarly:false});
 const result=getMatch().result?.payload??getMatch().result;
 if(result?.unplayedCount!==0||result.reason!==(isLegacy?'ALL_QUESTIONS_PLAYED':'ALL_ROUNDS')||completed!==prescribed)throw Error('NATURAL_FINISH_FAILED');
 return {completedNaturally:true,prescribedCount:prescribed,completedCount:completed,itemsJudged,canvasRounds,privacyChecks,duplicateScoringChecked,formats:[...formats],adjudication:'Scripted authorized host outcomes; synthetic submissions; real saved/reviewed content and HTTP routes'};
}
async function main(){assertLocalDevelopment();const admin=initializeApp({projectId:LOCAL_PROJECT},`rooms-http-${key()}`),email=`rooms-http-${key()}@example.test`,password=randomBytes(24).toString('base64url');await getAuth(admin).createUser({email,password,emailVerified:true});const login=await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});const identity=await login.json() as any;if(!identity.idToken)throw Error('LOCAL_AUTH_FAILED');const token=identity.idToken;
 const request=async(path:string,body?:unknown,guest?:string,expected?:number)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(guest?{'x-enta-room-token':guest}:{authorization:`Bearer ${token}`})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=response.status===204?{}:await response.json() as any;if(expected!==undefined){if(response.status!==expected)throw Error(`EXPECTED_${expected}:${response.status}:${path}:${JSON.stringify(data)}`);}else if(!response.ok)throw Error(`HTTP_${response.status}:${path}:${JSON.stringify(data)}`);return data;};
 const cases=[['classic','classic'],['kids','kids'],['round','list'],['round','acting'],['round','mixed'],['competitive','classic'],['competitive','list'],['competitive','acting'],['competitive','mixed']] as const;const results:any[]=[];
 for(const [engine,mode] of cases){if(process.env.ALMAIDAN_ROOM_MATRIX_MODES&&!process.env.ALMAIDAN_ROOM_MATRIX_MODES.split(',').includes(engine+':'+mode))continue;const isCompetitive=engine==='competitive',isLegacy=engine==='classic'||engine==='kids',standalone=['list','acting'].includes(mode),prefix=isCompetitive?'/competition':'',catalogPath=isLegacy?(engine==='kids'?'/catalog/kids':'/catalog'):`${prefix}/catalog/${mode}`;const catalog=await request(catalogPath),categories=[...catalog.categories];let page=catalog.catalogPage;while(isCompetitive&&mode==='mixed'&&(complete?!['ORDINARY_TIER','LIST_ITEMS','ACTING_ITEMS'].every(format=>categories.some(c=>c.format===format))||categories.filter(c=>c.format==='DRAWING_TARGET').length<3:categories.filter(c=>c.format==='DRAWING_TARGET').length<6)&&page?.nextCursor){page=await request(`${catalogPath}/pages`,{categoryKey:null,snapshot:page.revision,cursor:page.nextCursor});categories.push(...page.rows);}
 const chosen=engine==='kids'?categories.slice(0,1):mode==='mixed'?(complete?[...['ORDINARY_TIER','LIST_ITEMS','ACTING_ITEMS'].map(format=>categories.find(c=>c.format===format)),...categories.filter(c=>c.format==='DRAWING_TARGET').slice(0,3)]:categories.filter(c=>c.format==='DRAWING_TARGET').slice(0,6)):standalone?categories.slice(0,1):categories.slice(0,6);if(chosen.some(c=>!c)||chosen.length!==(engine==='kids'||standalone?1:6))throw Error(`CATALOGUE_INCOMPLETE:${engine}:${mode}`);
 const names=[{name:'الفريق الأول',players:['نور','سارة']},{name:'الفريق الثاني',players:['علي','ريم']}];let setup:any;if(isLegacy)setup={version:engine==='kids'?3:2,categoryKeys:chosen.map(c=>c.key),teams:names.map(t=>({...t,lifelines:[]})),rules:{questionSeconds:120}};else if(!isCompetitive)setup={version:4,categories:chosen.map(c=>({key:c.key,promptRefs:complete&&mode==='mixed'&&['LIST_ITEMS','ACTING_ITEMS'].includes(c.format)?c.prompts.slice(0,1).map((p:any)=>p.ref):[]})),teams:names,rules:{turnSeconds:45,overallSeconds:standalone?300:null,questionSeconds:120}};else setup={version:5,categories:chosen.map(c=>({key:c.key,promptRefs:complete&&mode==='mixed'&&['LIST_ITEMS','ACTING_ITEMS'].includes(c.format)?c.prompts.slice(0,1).map((p:any)=>p.ref):[]})),teams:names.map((t,i)=>({...t,colorKey:i?'SKY':'CORAL',aids:standalone?['HINT','DOUBLE','PHONE']:['PHONE_A_FRIEND','DOUBLE_ANSWER','DOUBLE_POINTS']})),rules:{version:'enta-competitive-1',paletteVersion:'enta-team-palette-1',questionSeconds:120,turnSeconds:45,overallSeconds:standalone?300:null,stealSeconds:10,phoneSeconds:60,embeddedStealCap:200}};
 const startBody={requestKey:key(),logicalMatchId:key(),setup},start=await request(`${prefix}/matches/${mode}`,startBody);let match=start.match;const retry=await request(`${prefix}/matches/${mode}`,startBody);if(retry.match.id!==match.id||!retry.idempotent)throw Error('START_RETRY_FAILED');const attached=await request('/rooms',{engine,matchId:match.id,requestKey:key()}),code=attached.room.code,roomPath=`/rooms/${code}`;let room=attached.room;
 const guestA=await request(`${roomPath}/join`,{name:'نور',requestKey:key()},'no-auth'),guestB=await request(`${roomPath}/join`,{name:'سارة',requestKey:key()},'no-auth');room=guestB.room;
 for(const [index,guest] of [guestA,guestB].entries())room=(await request(`${roomPath}/host`,{commandId:key(),expectedVersion:room.version,type:'ASSIGN',memberId:guest.memberId,teamIndex:0,playerIndex:index,captain:index===1})).room;
 const display=await request(`${roomPath}/host`,{commandId:key(),expectedVersion:room.version,type:'DISPLAY'});room=display.room;const commandPath=isLegacy?`/matches/${match.id}/commands`:isCompetitive?`/competition/matches/${match.id}/commands`:`/round-matches/${match.id}/commands`;await request(commandPath,{commandId:key(),expectedVersion:match.version,type:'FINISH',confirmEarly:true},undefined,409);room=(await request(`${roomPath}/host`,{commandId:key(),expectedVersion:room.version,type:'START'})).room;
 const command=async(type:string,extra:any={})=>{const result=await request(`${roomPath}/engine`,{command:{commandId:key(),expectedVersion:match.version,type,...extra}});match=result.match;return result;};
 let canvasChecked=false,natural:any=null;
 if(complete){natural=await completeJourney({request,roomPath,isLegacy,isCompetitive,standalone,guestA,guestB,display,command,getMatch:()=>match,setMatch:(value:any)=>{match=value;}});canvasChecked=natural.canvasRounds>0;}
 else if(isLegacy){const questionId=match.tiles[0].id;await command('OPEN_QUESTION',{questionId});const hidden=(await request(`${roomPath}/view`,undefined,guestA.token)).room.match;if(hidden.currentQuestion.answers)throw Error('ANSWER_LEAK');await command('REVEAL_ANSWER',{questionId});await command('ADJUDICATE',{questionId,ruling:'CORRECT',teamId:match.teams[0].id});}
 else {await command(standalone?'NEXT_ROUND':'OPEN_ROUND',standalone?{}:{roundId:match.rounds[0].id});const roundId=match.currentRound.id,format=match.currentRound.format,itemId=match.currentRound.items?.[0]?.id??null;
 if(format==='DRAWING_TARGET'||format==='ACTING_ITEMS'){await command('ASSIGN_ACTOR',{roundId,teamId:match.teams[0].id,...(isCompetitive?{playerId:match.teams[0].players[0].id}:{playerIndex:0}),itemId:format==='DRAWING_TARGET'?null:itemId});await request(`${roomPath}/member-grant`,{memberId:guestA.memberId,role:'ACTOR'});const privateView=await request(`${roomPath}/private`,undefined,guestA.token);if(!privateView.capability.target)throw Error('ACTOR_TARGET_MISSING');await request(`${roomPath}/private`,undefined,guestB.token,204);match=(await request(`${roomPath}`)).room.match;if(format==='DRAWING_TARGET'){await request(`${roomPath}/canvas`,{commandId:key(),expectedRevision:0,type:'APPEND',stroke:{id:key(),color:'#191615',width:2,erase:false,points:[[100,100],[500,500]]}},guestA.token);const publicCanvas=await request(`${roomPath}/public-canvas`,undefined,display.token);if(publicCanvas.page.strokes.length!==1)throw Error('DISPLAY_CANVAS_MISSING');canvasChecked=true;match=(await request(`${roomPath}`)).room.match;}}
 if(isCompetitive){const memberAction=await request(`${roomPath}/actions`,{commandId:key(),expectedVersion:match.version,type:'RECORD_ATTEMPT',itemId},guestB.token);match=memberAction.room.match;const pending=await request(`/competition/matches/${match.id}/pages`,{collection:'pending',roundId,effectId:null,snapshot:match.version,cursor:null});const attempt=pending.rows[0];if(!attempt)throw Error('ATTEMPT_MISSING');await command('PUBLIC_REVEAL',{roundId,itemId});await command('FINAL_RULING',{roundId,itemId,classifications:[[attempt.id,true]]});if(match.currentRound){if(!match.currentRound.publicRevealed)await command('PUBLIC_REVEAL',{roundId,itemId:null});await command('CLOSE_ROUND',{roundId});}}
 else if(standalone){await command('JUDGE_ITEM',{roundId,itemId});if(match.currentRound)await command('CLOSE_ROUND',{roundId});}else{await command('REVEAL_TARGET',{roundId});await command('ADJUDICATE_ROUND',{roundId,teamId:match.teams[0].id,correct:true});}
 }
 if(!match.teams.some((t:any)=>t.score>0))throw Error(`NO_SCORE:${engine}:${mode}`);if(!complete)await command('FINISH',{confirmEarly:true});const participant=(await request(`${roomPath}/view`,undefined,guestB.token)).room,screen=(await request(`${roomPath}/view`,undefined,display.token)).room;if(participant.phase!=='FINISHED'||screen.phase!=='FINISHED')throw Error('FINISHED_ROOM_MISSING');const history=await request('/matches/history');if(!history.matches.some((m:any)=>m.id===match.id))throw Error('HISTORY_MISSING');const original=await request(`/matches/${match.id}/original-result`);let rematch:any=null;if(complete){const setupResult=await request(isLegacy?`/matches/${match.id}/rematch-setup`:`/local-rematches/${engine}/${match.id}/setup`),rematchPath=isLegacy?`/matches/${match.id}/rematch`:`/local-rematches/${engine}/${match.id}`,body={requestKey:key(),logicalMatchId:key(),predecessorVersion:isLegacy?setupResult.predecessorVersion:setupResult.predecessor.version,...(isLegacy?{setup:setupResult.setup}:{})};const successor=await request(rematchPath,body),replayed=await request(rematchPath,body);if(successor.match.id===match.id||replayed.match.id!==successor.match.id||!replayed.idempotent)throw Error('REMATCH_REPLAY_FAILED');const successorRoom=await request('/rooms',{engine,matchId:successor.match.id,requestKey:key()});if(successorRoom.room.phase!=='LOBBY')throw Error('REMATCH_LOBBY_MISSING');if(JSON.stringify(original)!==JSON.stringify(await request(`/matches/${match.id}/original-result`)))throw Error('PREDECESSOR_RESULT_CHANGED');rematch={matchId:successor.match.id,code:successorRoom.room.code,phase:successorRoom.room.phase,idempotent:true,predecessorUnchanged:true};}results.push({engine,mode,code,matchId:match.id,scored:true,guestSessions:2,display:true,canvasChecked,finishReason:(match.result?.payload??match.result)?.reason??'HOST_ENDED',completedNaturally:false,history:true,...natural,rematch});console.log(JSON.stringify({passed:`${engine}:${mode}`,canvasChecked,finishReason:results.at(-1).finishReason}));
 }
 const path=`D:/projects/huroof_wa_oloof/local/almaidan/rooms-http-acceptance-${Date.now()}.json`;await writeFile(path,JSON.stringify({at:new Date().toISOString(),localOnly:true,completionMode:complete?'natural':'early-finish',transport:'Actual loopback HTTP; new isolated local test identity and games only',results},null,2),{flag:'wx'});console.log(`REPORT ${path}`);await deleteApp(admin);}
void main().catch(error=>{console.error(error instanceof Error?error.message:'MATRIX_FAILED');process.exitCode=1;});

