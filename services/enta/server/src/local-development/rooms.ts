import {admissionHash} from '../admission/huroof-protocol.cjs';
import {normalizedRoomAnswer,publicRoomSubmissions,type RoomSubmission} from './room-submissions';
import {sealRoomGrant,openRoomGrant} from './rooms-vault';
import {PrismaClient,Prisma} from '@prisma/client';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Principal} from '../identity';
import {EntaError,fail} from '../gameplay/types';
import {assertLocalDevelopment,LOCAL_PROJECT} from './guard';
import {normalizePlayerDisplayName} from '../../../../../src/features/game/runtime/display-name';
export type RoomEngine='classic'|'kids'|'round'|'competitive';
type Json=Record<string,any>;
export interface RoomAdapter {get(p:Principal,id:string):Promise<Json>;command(p:Principal,id:string,command:unknown):Promise<Json>;issueGrant?(p:Principal,id:string,command:unknown):Promise<Json>;publicCanvas?(p:Principal,id:string,roundId:string,query:unknown):Promise<Json>;capability?(token:string):Promise<Json>;canvas?(token:string,roundId:string,query:unknown,input?:unknown):Promise<Json>;attemptIdForEvent?(p:Principal,id:string,eventId:string):Promise<string|undefined>;attemptIdsForCommands?(p:Principal,id:string,commandIds:string[]):Promise<Map<string,string>>}
interface Member {id:string;name:string;status:'ADMITTED'|'PENDING'|'REMOVED';teamIndex:number|null;playerIndex:number|null;captain:boolean;tokenHash:string;joinKey:string;joinTeamIndex?:number;privateGrant?:string;carried?:true}
interface Room {submissions?:RoomSubmission[];feedback?:{roundId:string;at:number;awards:{teamId:string;points:number}[]};code:string;host:Principal;engine:RoomEngine;matchId:string;requestKey:string;version:number;phase:'LOBBY'|'PLAYING'|'FINISHED';locked:boolean;createdAt:number;members:Member[];displayHashes:string[];receipts:Record<string,{hash:string}>;successorCode?:string;rematchRequestHash?:string}
type State={rooms:Room[]};
const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const answerCommandId=(memberId:string,commandId:string,digest:string)=>`room-answer-${hash([memberId,commandId,digest])}`;
const engines=['classic','kids','round','competitive'];const codePattern=/^E1-[A-Z2-9]{8}$/;const keyPattern=/^[A-Za-z0-9._:-]{8,128}$/;
function verified(p:Principal){if(p.projectId!==LOCAL_PROJECT||!p.verifiedAccount||p.anonymous||!p.email||!p.uid)fail(403,'VERIFIED_ACCOUNT_REQUIRED');}
function tokenHash(token:string){if(typeof token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(token))return fail(403,'ROOM_CAPABILITY_DENIED');return hash(token);}
function exact(input:unknown,required:string[],optional:string[]=[]):Json{if(!input||typeof input!=='object'||Array.isArray(input)||required.some(k=>!Object.hasOwn(input,k))||Object.keys(input).some(k=>![...required,...optional].includes(k)))fail(400,'INVALID_ROOM_REQUEST');return input as Json;}
function key(value:unknown):string{if(typeof value!=='string'||!keyPattern.test(value))fail(400,'INVALID_ROOM_REQUEST');return value as string;}
function name(value:unknown){const normalized=normalizePlayerDisplayName(value);if(!normalized||/[<>]/.test(normalized))return fail(400,'INVALID_ROOM_NAME');return normalized;}
const DYNAMIC_TEAM_SEATS=16;
const PRESENCE_WINDOW_MS=15_000;
const HIDDEN_PRESENCE_WINDOW_MS=5*60_000;
const isClassicRoom=(room:Room)=>room.engine==='classic'||room.engine==='kids';
function activeMembers(room:Room){return room.members.filter(member=>member.status!=='REMOVED');}
function seatLimit(room:Room,team:Json){return isClassicRoom(room)?DYNAMIC_TEAM_SEATS:team.players.length;}
function freeSeat(room:Room,team:Json,teamIndex:number,memberId?:string){
 for(let index=0;index<seatLimit(room,team);index++)if(!activeMembers(room).some(member=>member.id!==memberId&&member.teamIndex===teamIndex&&member.playerIndex===index))return index;
 return -1;
}
function matchOf(value:Json):Json{return value.match??value;}
const fields=(input:Json,keys:string[])=>Object.fromEntries(keys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,structuredClone(input[k])]));
function safeMatch(match:Json){const copy=fields(match,['id','version','phase','finished','serverNow','executionFormat','rules','turnTeamId','categories','tiles','rounds','result']);copy.allowances=(match.allowances??[]).map((a:Json)=>fields(a,['id','teamId','aid','roundId','consumed']));copy.teams=(match.teams??[]).map((t:Json)=>fields(t,['id','name','score','colorKey']));const question=match.currentQuestion;copy.currentQuestion=question?{...fields(question,['id','prompt','points','answeringTeamId','deadlineAt']),...(match.phase==='REVEALED'?fields(question,['answers']):{})}:null;const round=match.currentRound;copy.currentRound=round?{...fields(round,['id','version','phase','state','format','prompt','points','originalTeamId','currentTeamId','scoringTeamId','deadline','overallDeadline','turnDeadline','remainingTurn','remainingOverall','pause','pickedPlayerId','revealed','publicRevealed','canvas','eligibleAids']),hints:(round.hints??[]).map((h:Json)=>fields(h,['id','text'])),graphemeHints:(round.graphemeHints??[]).map((h:Json)=>fields(h,['itemId','grapheme'])),assignment:round.assignment?fields(round.assignment,['teamId','playerId','playerIndex','itemId','generation']):null,items:(round.items??[]).map((item:Json)=>({...fields(item,['id','ordinal','consumed','revealed']),...(item.consumed||item.revealed?fields(item,['text','value','trap']):{})})),...(round.revealed===true||round.publicRevealed===true?fields(round,['target']):{})}:null;return copy;}
function canvasQuery(engine:RoomEngine,input:unknown){const q=exact(input,[],engine==='competitive'?['snapshot','revision','cursor']:['revision','offset']);const number=(v:unknown,fallback:number|null)=>v===undefined||v===null?fallback:typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:typeof v==='string'&&/^(0|[1-9][0-9]{0,8})$/.test(v)?Number(v):fail(400,'INVALID_CANVAS_CURSOR');return engine==='competitive'?{snapshot:number(q.snapshot,null),revision:number(q.revision,null),cursor:q.cursor??null}:{revision:number(q.revision,null),offset:number(q.offset,0)};}
function roomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return 'E1-'+Array.from(randomBytes(8),n=>chars[n%chars.length]).join('');}
function newRoom(state:State,host:Principal,engine:RoomEngine,matchId:string,requestKey:string):Room {
 let code=roomCode();
 while(state.rooms.some(room=>room.code===code))code=roomCode();
 const room:Room={code,host:{...host},engine,matchId,requestKey,version:1,phase:'LOBBY',locked:false,createdAt:Date.now(),members:[],displayHashes:[],receipts:{}};
 state.rooms.push(room);
 return room;
}
export class LocalRoomStore {
 private readonly prisma=new PrismaClient({datasourceUrl:assertLocalDevelopment()});
 async initialize(){await this.prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS local_development');await this.prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.room_state (id integer PRIMARY KEY CHECK(id=1),data jsonb NOT NULL)');await this.prisma.$executeRaw(Prisma.sql`INSERT INTO local_development.room_state(id,data) VALUES(1,${JSON.stringify({rooms:[]})}::jsonb) ON CONFLICT DO NOTHING`);}
 close(){return this.prisma.$disconnect();}
 async transaction<T>(work:(state:State)=>Promise<T>):Promise<T>{assertLocalDevelopment();return this.prisma.$transaction(async db=>{const rows=await db.$queryRaw<{data:State}[]>(Prisma.sql`SELECT data FROM local_development.room_state WHERE id=1 FOR UPDATE`);const state=rows[0]?.data??fail(503,'LOCAL_ROOMS_UNAVAILABLE');const before=JSON.stringify(state);const result=await work(state);const after=JSON.stringify(state);if(after!==before)await db.$executeRaw(Prisma.sql`UPDATE local_development.room_state SET data=${after}::jsonb WHERE id=1`);return result;},{maxWait:15000,timeout:120000});}
}
export function createLocalRooms(store:Pick<LocalRoomStore,'transaction'>,adapters:Record<RoomEngine,RoomAdapter>,now=Date.now){
 // Presence is a short process-local lease, separate from durable seat ownership.
 // Refreshing a snapshot does not write the entire room store on each poll.
 const presence=new Map<string,number>();
 const markPresent=(member:Member,hidden=false)=>{
  const timestamp=now();
  for(const [id,expires] of presence)if(timestamp>=expires)presence.delete(id);
  presence.set(member.id,timestamp+(hidden?HIDDEN_PRESENCE_WINDOW_MS:PRESENCE_WINDOW_MS));
 };
 const lookup=(state:State,code:string)=>{if(!codePattern.test(code))return fail(404,'ROOM_NOT_FOUND');return state.rooms.find(r=>r.code===code)??fail(404,'ROOM_NOT_FOUND');};
 const owner=(room:Room,p:Principal)=>{verified(p);if(room.host.uid!==p.uid||room.host.projectId!==p.projectId)fail(404,'ROOM_NOT_FOUND');};
 const read=async(room:Room)=>{const match=matchOf(await adapters[room.engine].get(room.host,room.matchId));if(match.finished===true||match.phase==='FINISHED')room.phase='FINISHED';return match;};
 const authority=(room:Room,token:string)=>{const h=tokenHash(token),member=room.members.find(m=>m.tokenHash===h&&m.status!=='REMOVED');if(member)return {member,role:'MEMBER' as const};if(room.displayHashes.includes(h))return {member:null,role:'DISPLAY' as const};return fail(403,'ROOM_CAPABILITY_DENIED');};
 const project=async(room:Room,access:'HOST'|ReturnType<typeof authority>,matchOverride?:Json)=>{
  const match=matchOverride??await read(room),host=access==='HOST',self=host?null:access;
  const canView=host||self?.role==='DISPLAY'||self?.member?.status==='ADMITTED';
  const members=activeMembers(room);
  const lookupAttempts=adapters[room.engine].attemptIdsForCommands;
  if(host&&match.currentRound&&lookupAttempts){
   const unresolved=(room.submissions??[]).filter(row=>!row.attemptId&&row.roundId===match.currentRound.id);
   if(unresolved.length){
    const commandIds=unresolved.map(row=>answerCommandId(row.memberId,row.commandId,row.hash));
    const matches=await lookupAttempts(room.host,room.matchId,commandIds);
    unresolved.forEach((row,index)=>{const id=matches.get(commandIds[index]);if(id)row.attemptId=id;});
   }
  }
  return {actionsVersion:2 as const,code:room.code,version:room.version,phase:room.phase,engine:room.engine,matchId:room.matchId,locked:room.locked,
   ...(room.successorCode ? {successorCode:room.successorCode} : {}),
   teams:(match.teams??[]).map((team:Json,index:number)=>({id:team.id,name:team.name,seatLimit:seatLimit(room,team),
    players:isClassicRoom(room)?Array.from({length:Math.max(team.players.length,...members.filter(member=>member.teamIndex===index).map(member=>(member.playerIndex??-1)+1))},(_,seat)=>members.find(member=>member.teamIndex===index&&member.playerIndex===seat)?.name??team.players[seat]??null):team.players})),
   members:members.filter(member=>host&&!member.carried||member.status==='ADMITTED'||member.id===self?.member?.id).map(({id,name,status,teamIndex,playerIndex,captain})=>({id,name,status,teamIndex,playerIndex,captain})),
   submissions:publicRoomSubmissions(room.submissions??[],self?.member?.id??null,host),self:host?null:{id:self!.member?.id??null,role:self!.role,hasPrivateGrant:Boolean(self!.member?.privateGrant)},
   feedback:canView&&room.feedback&&now()-room.feedback.at<3000?room.feedback:null,match:canView&&room.phase!=='LOBBY'?safeMatch(match):null};
 };
 const grantAccess=async(room:Room,member:Member,token:string)=>{if(member.status!=='ADMITTED'||member.teamIndex===null||member.playerIndex===null||room.phase!=='PLAYING')return fail(403,'ROOM_ACTION_DENIED');const adapter=adapters[room.engine];if(!adapter.capability)return fail(403,'ROOM_ACTION_DENIED');const capability=await adapter.capability(token),match=await read(room),round=match.currentRound,team=match.teams[member.teamIndex];if(!round||capability.roundId!==round.id||capability.gameId&&capability.gameId!==room.matchId)return fail(403,'ROOM_ACTION_DENIED');if(capability.role==='ACTOR'){const assignment=round.assignment;if(!assignment||assignment.teamId!==team?.id||(room.engine==='competitive'?assignment.playerId!==team.players[member.playerIndex]?.id:assignment.playerIndex!==member.playerIndex))return fail(403,'ROOM_ACTION_DENIED');}else if(capability.role!=='JUDGE'||!member.captain)return fail(403,'ROOM_ACTION_DENIED');return capability;};
 async function runEngineCommand(room:Room,p:Principal,input:unknown){
  const command=input as Json|null,type=command?.type;
  const judged=['ADJUDICATE','ADJUDICATE_ROUND','JUDGE_ITEM','FINAL_RULING'].includes(type);
  const before=judged?await read(room):null;
  const response=await adapters[room.engine].command(p,room.matchId,input);
  if(!before||response.idempotent||response.rejection)return response;
  const after=matchOf(response),roundId=command?.questionId??command?.roundId;
  if(!roundId||!Array.isArray(after.teams))return response;
  const awards=after.teams.flatMap((team:Json)=>{
   const previous=before.teams.find((row:Json)=>row.id===team.id)?.score;
   return typeof previous==='number'&&team.score!==previous?[{teamId:team.id,points:team.score-previous}]:[];
  });
  room.feedback={roundId,at:now(),awards};
  return response;
 }
 return {
 async attach(p:Principal,input:unknown){verified(p);const q=exact(input,['engine','matchId','requestKey']);if(!engines.includes(q.engine)||typeof q.matchId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(q.matchId))fail(400,'INVALID_ROOM_REQUEST');key(q.requestKey);await adapters[q.engine as RoomEngine].get(p,q.matchId);return store.transaction(async state=>{const duplicate=state.rooms.find(r=>r.host.uid===p.uid&&r.requestKey===q.requestKey);if(duplicate){if(duplicate.engine!==q.engine||duplicate.matchId!==q.matchId)fail(409,'ROOM_KEY_CONFLICT');return {room:await project(duplicate,'HOST'),idempotent:true};}const linked=state.rooms.find(r=>r.engine===q.engine&&r.matchId===q.matchId);if(linked){owner(linked,p);return {room:await project(linked,'HOST'),idempotent:true};}const original=matchOf(await adapters[q.engine as RoomEngine].get(p,q.matchId));if(original.version!==1||original.phase==='FINISHED'||original.finished===true)fail(409,'ROOM_REQUIRES_NEW_MATCH');if((q.engine==='classic'||q.engine==='kids')&&original.mode!==q.engine.toUpperCase())fail(400,'ROOM_ENGINE_MISMATCH');return {room:await project(newRoom(state,p,q.engine,q.matchId,q.requestKey),'HOST'),idempotent:false};});},
 async rematch<T extends {match:{id:string}}>(p:Principal,engine:RoomEngine,matchId:string,input:unknown,start:()=>Promise<T>):Promise<T>{
  verified(p);
  const command=input as {requestKey?:unknown;setup?:{teams?:unknown[]}}|null;
  const requestKey=key(command?.requestKey);
  const digest=admissionHash(input);
  const predecessorCode=await store.transaction(async state=>{
   const room=state.rooms.find(room=>room.matchId===matchId&&(room.engine===engine||engine==='classic'&&room.engine==='kids'));
   if(!room)return undefined;
   owner(room,p);
   await read(room);
   if(room.phase!=='FINISHED')return fail(409,'PREDECESSOR_NOT_FINISHED');
   if(room.rematchRequestHash&&room.rematchRequestHash!==digest)
    return fail(409,room.successorCode?'ROOM_REMATCH_ALREADY_STARTED':'ROOM_REMATCH_IN_PROGRESS');
   if(Array.isArray(command?.setup?.teams)&&activeMembers(room).some(member=>member.teamIndex!==null&&member.teamIndex>=command.setup!.teams!.length))
    return fail(409,'ROOM_ASSIGNMENT_REQUIRED');
   if(!room.rematchRequestHash&&state.rooms.some(candidate=>candidate.host.uid===p.uid&&candidate.requestKey===requestKey))
    return fail(409,'ROOM_KEY_CONFLICT');
   // Persist the request before entering the separate match store. A lost
   // reply must retry the same engine receipt before exposing a successor.
   room.rematchRequestHash=digest;
   return room.code;
  });
  if(!predecessorCode)return start();
  const result=await store.transaction(async state=>{
   const predecessor=lookup(state,predecessorCode);
   if(predecessor.rematchRequestHash!==digest)
    return fail(409,predecessor.successorCode?'ROOM_REMATCH_ALREADY_STARTED':'ROOM_REMATCH_IN_PROGRESS');
   let started:T;
   try {started=await start();}
   catch(error){
    if(!predecessor.successorCode&&error instanceof EntaError&&error.status>=400&&error.status<500){
     delete predecessor.rematchRequestHash;
     return {error};
    }
    throw error;
   }
   if(predecessor.successorCode){
    const successor=lookup(state,predecessor.successorCode);
    if(successor.matchId!==started.match.id)return fail(503,'LOCAL_REMATCH_UNAVAILABLE');
    return {started};
   }
   const target=matchOf(await adapters[predecessor.engine].get(predecessor.host,started.match.id));
   if(target.id!==started.match.id||target.version!==1||target.phase==='FINISHED'||target.finished||
      state.rooms.some(room=>room.engine===predecessor.engine&&room.matchId===target.id))
    return fail(503,'LOCAL_REMATCH_UNAVAILABLE');
   const successor=newRoom(state,predecessor.host,predecessor.engine,started.match.id,requestKey);
   successor.members=activeMembers(predecessor).map(({id:_,privateGrant:__,...member})=>({
    ...member,id:randomUUID(),joinKey:randomUUID(),carried:true,
    status:member.teamIndex===null||member.playerIndex===null?'PENDING':member.status,
   }));
   successor.displayHashes=[...predecessor.displayHashes];
   predecessor.successorCode=successor.code;
   predecessor.version++;
   return {started};
  });
  if(result.error)throw result.error;
  return result.started;
 },
 async hostView(p:Principal,code:string){return store.transaction(async state=>{const room=lookup(state,code);owner(room,p);return {room:await project(room,'HOST')};});},
 async hostViewForMatch(p:Principal,engine:string,id:string){
  verified(p);
  return store.transaction(async state=>{
   const room=state.rooms.find(room=>room.host.uid===p.uid&&room.host.projectId===p.projectId&&room.matchId===id&&(room.engine===engine||engine==='classic'&&room.engine==='kids'));
   return {room:room?await project(room,'HOST'):null};
  });
 },
 async joinOptions(code:string){
  return store.transaction(async state=>{
   const room=lookup(state,code);
   const match=room.phase==='FINISHED'?null:await read(room);
   if(room.phase==='FINISHED'){
    const successorCode=room.successorCode;
    return {finished:true as const,...(successorCode&&successorCode!==code&&codePattern.test(successorCode)?{successorCode}:{})};
   }
   return {teams:(match?.teams??[]).map((team:Json)=>({id:team.id,name:team.name}))};
  });
 },
 // A repeated join key proves the same tab whose earlier reply was lost: the
 // random key is never projected. Re-issue that member's capability (the old,
 // never-received token stops working) instead of minting a second member.
 async join(code:string,input:unknown){
  const q=exact(input,['name','requestKey'],['teamIndex']),displayName=name(q.name);key(q.requestKey);
  return store.transaction(async state=>{
   const room=lookup(state,code),match=await read(room);
   const duplicate=room.members.find(member=>member.joinKey===q.requestKey);
   if(duplicate&&(duplicate.name!==displayName||duplicate.status==='REMOVED'||duplicate.joinTeamIndex!==q.teamIndex))return fail(409,'ROOM_KEY_CONFLICT');
   if(!duplicate&&room.phase==='FINISHED')return fail(409,'ROOM_FINISHED');
   const sameName=activeMembers(room).find(member=>member.name.toLowerCase()===displayName.toLowerCase());
   if(!duplicate&&sameName&&(sameName.carried||now()<(presence.get(sameName.id)??-Infinity)))return fail(409,'ROOM_NAME_TAKEN');
   if(!duplicate&&!sameName&&room.locked)return fail(409,'ROOM_LOCKED');
   const token=randomBytes(32).toString('base64url');
   let member=duplicate??sameName;
   if(!member){
    if(activeMembers(room).length>=32)return fail(409,'ROOM_FULL');
    const teamIndex=q.teamIndex??null;
    if(teamIndex!==null&&(!Number.isInteger(teamIndex)||!match.teams[teamIndex]))return fail(400,'INVALID_ROOM_ASSIGNMENT');
    const playerIndex=teamIndex===null?null:freeSeat(room,match.teams[teamIndex],teamIndex);
    if(playerIndex===-1)return fail(409,'ROOM_TEAM_FULL');
    member={id:randomUUID(),name:displayName,status:room.phase==='LOBBY'?'ADMITTED':'PENDING',teamIndex,playerIndex,captain:false,tokenHash:hash(token),joinKey:q.requestKey,joinTeamIndex:q.teamIndex};
    room.members.push(member);
   }else{
    member.tokenHash=hash(token);
    if(!duplicate){member.joinKey=q.requestKey;member.joinTeamIndex=q.teamIndex;}
   }
   if(!duplicate)room.version++;
   markPresent(member);
   return {room:await project(room,{member,role:'MEMBER'},match),memberId:member.id,token,tokenUnavailable:false,idempotent:!!duplicate};
  });
 },
 async view(code:string,token:string){return store.transaction(async state=>{const room=lookup(state,code),access=authority(room,token);if(access.member){markPresent(access.member);delete access.member.carried;}return {room:await project(room,access)};});},
 async leave(code:string,token:string){return store.transaction(async state=>{const {member}=authority(lookup(state,code),token);if(member)presence.delete(member.id);return null;});},
 async idle(code:string,token:string){return store.transaction(async state=>{const {member}=authority(lookup(state,code),token);if(member)markPresent(member,true);return null;});},
 async hostCommand(p:Principal,code:string,input:unknown){const q=exact(input,['commandId','expectedVersion','type'],['memberId','teamIndex','playerIndex','captain','locked']);key(q.commandId);if(!Number.isSafeInteger(q.expectedVersion)||!['LOCK','ASSIGN','AUTO_ASSIGN','ADMIT','REMOVE','START','DISPLAY','REVOKE_DISPLAY'].includes(q.type))fail(400,'INVALID_ROOM_REQUEST');return store.transaction(async state=>{const room=lookup(state,code);owner(room,p);const digest=hash(q),old=Object.hasOwn(room.receipts,q.commandId)?room.receipts[q.commandId]:undefined;if(old){if(old.hash!==digest)fail(409,'ROOM_COMMAND_CONFLICT');return {room:await project(room,'HOST'),idempotent:true,tokenUnavailable:true,token:undefined};}if(room.version!==q.expectedVersion&&q.type!=='DISPLAY')fail(409,'STALE_ROOM_VERSION');const match=await read(room),member=room.members.find(m=>m.id===q.memberId&&m.status!=='REMOVED');let token:string|undefined;
 if(['ASSIGN','ADMIT','REMOVE'].includes(q.type)&&!member)fail(404,'ROOM_MEMBER_NOT_FOUND');
 if(q.type==='LOCK'){if(typeof q.locked!=='boolean')fail(400,'INVALID_ROOM_REQUEST');room.locked=q.locked;}
 if(q.type==='ASSIGN'){if(!Number.isInteger(q.teamIndex)||q.teamIndex<0||q.teamIndex>=match.teams.length||!Number.isInteger(q.playerIndex)||q.playerIndex<0||q.playerIndex>=seatLimit(room,match.teams[q.teamIndex])||typeof q.captain!=='boolean')fail(400,'INVALID_ROOM_ASSIGNMENT');if(activeMembers(room).some(m=>m.id!==member!.id&&m.teamIndex===q.teamIndex&&m.playerIndex===q.playerIndex))fail(409,'ROOM_PLAYER_TAKEN');member!.teamIndex=q.teamIndex;member!.playerIndex=q.playerIndex;member!.captain=q.captain;delete member!.privateGrant;if(q.captain)for(const m of room.members)if(m.id!==member!.id&&m.teamIndex===q.teamIndex)m.captain=false;}
 if(q.type==='AUTO_ASSIGN'){
  if(room.phase!=='LOBBY')return fail(409,'ROOM_ALREADY_STARTED');
  const members=activeMembers(room);
  for(const candidate of members.filter(member=>member.teamIndex===null||member.playerIndex===null)){
   const available=match.teams.map((team:Json,teamIndex:number)=>({teamIndex,playerIndex:freeSeat(room,team,teamIndex),count:members.filter(member=>member.teamIndex===teamIndex).length}))
    .filter((seat:{playerIndex:number})=>seat.playerIndex>=0).sort((left:{count:number},right:{count:number})=>left.count-right.count)[0];
   if(!available)return fail(409,'ROOM_TEAM_FULL');
   candidate.teamIndex=available.teamIndex;candidate.playerIndex=available.playerIndex;
  }
 }
 if(q.type==='ADMIT')member!.status='ADMITTED';if(q.type==='REMOVE'){member!.status='REMOVED';member!.captain=false;delete member!.privateGrant;presence.delete(member!.id);}
 if(q.type==='START'){if(room.phase!=='LOBBY')fail(409,'ROOM_ALREADY_STARTED');if(activeMembers(room).some(m=>m.status==='ADMITTED'&&(m.teamIndex===null||m.playerIndex===null)))fail(409,'ROOM_ASSIGNMENT_REQUIRED');room.phase='PLAYING';}
 if(q.type==='DISPLAY'){if(room.displayHashes.length>=8)fail(409,'DISPLAY_LIMIT');token=randomBytes(32).toString('base64url');room.displayHashes.push(hash(token));}
 if(q.type==='REVOKE_DISPLAY')room.displayHashes=[];
 room.version++;Object.defineProperty(room.receipts,q.commandId,{value:{hash:digest},enumerable:true,writable:true,configurable:true});return {room:await project(room,'HOST'),idempotent:false,token};});},
 async engineCommand(p:Principal,code:string,input:unknown){const q=exact(input,['command']);return store.transaction(async state=>{const room=lookup(state,code);owner(room,p);if(room.phase==='LOBBY')fail(409,'ROOM_NOT_STARTED');return runEngineCommand(room,p,q.command);});},
 async participantCommand(code:string,token:string,input:unknown){
 const q=exact(input,['commandId','expectedVersion','type'],['itemId','aid','roundId','submittedText']);key(q.commandId);if(q.roundId!==undefined)key(q.roundId);
 const normalized=q.submittedText===undefined?null:normalizedRoomAnswer(q.submittedText);if(normalized!==null&&(!['RECORD_ATTEMPT','SUBMIT_ANSWER'].includes(q.type)||q.roundId===undefined))fail(400,'INVALID_SUBMITTED_ANSWER');
 return store.transaction(async state=>{const room=lookup(state,code),access=authority(room,token),member=access.member;
 if(!member||member.status!=='ADMITTED'||member.teamIndex===null||member.playerIndex===null)fail(403,'ROOM_ACTION_DENIED');
 const submissions=room.submissions??=[],digest=hash(q),prior=submissions.find(r=>r.commandId===q.commandId);
 if(prior){if(prior.memberId!==member!.id||prior.hash!==digest)fail(409,'ROOM_COMMAND_CONFLICT');return {room:await project(room,access),idempotent:true};}
 if(room.phase!=='PLAYING'||!['round','competitive'].includes(room.engine))fail(403,'ROOM_ACTION_DENIED');
 if(normalized!==null){if(submissions.length>=512||Buffer.byteLength(JSON.stringify(submissions))+Buffer.byteLength(JSON.stringify({commandId:q.commandId,hash:digest,memberId:member!.id,roundId:q.roundId,itemId:q.itemId??null,text:q.submittedText.trim(),normalizedText:normalized,receivedAt:Date.now()}))+2>120000)fail(409,'ROOM_SUBMISSION_LIMIT');if(submissions.some(r=>r.memberId===member!.id&&r.roundId===q.roundId&&r.normalizedText===normalized))fail(409,'DUPLICATE_SUBMITTED_ANSWER');}
 const match=await read(room),team=match.teams[member!.teamIndex!],player=team?.players[member!.playerIndex!],round=match.currentRound;
 if(!team||!player||!round&&q.roundId===undefined)fail(409,'INVALID_PHASE');
 let attemptId:string|undefined;
 if(room.engine==='competitive'){
 if(!['RECORD_ATTEMPT','USE_AID'].includes(q.type)||q.type==='USE_AID'&&!member!.captain)fail(403,'ROOM_ACTION_DENIED');
 const command={commandId:normalized===null?q.commandId:answerCommandId(member!.id,q.commandId,digest),expectedVersion:q.expectedVersion,type:q.type,roundId:q.roundId??round.id,teamId:team.id,...(q.type==='RECORD_ATTEMPT'?{playerId:player.id,itemId:q.itemId??null}:{aid:q.aid})};
 const accepted=await adapters[room.engine].command(room.host,room.matchId,command);
 if(accepted.rejection)fail(409,accepted.rejection);
 if(normalized!==null){const receipt=accepted.commandReceipt;if(!receipt||receipt.state!=='ACCEPTED'||receipt.gameId!==room.matchId||receipt.commandId!==command.commandId||receipt.expectedVersion!==command.expectedVersion||receipt.hash!==admissionHash(command)||typeof receipt.eventId!=='string')fail(503,'ROOM_ATTEMPT_RECEIPT_UNAVAILABLE');attemptId=await adapters[room.engine].attemptIdForEvent?.(room.host,room.matchId,receipt.eventId);}
 }else{
 if(q.type!=='SUBMIT_ANSWER'||normalized===null||!round||round.id!==q.roundId||match.version!==q.expectedVersion||round.state!=='RUNNING'||round.revealed||round.scoringTeamId!==team.id)fail(409,'ATTEMPT_UNAVAILABLE');
 const deadline=Math.min(round.turnDeadline??Infinity,round.overallDeadline??Infinity);if(!Number.isFinite(deadline)||match.serverNow>=deadline)fail(409,'ROUND_TIME_EXPIRED');
 if(round.assignment?.teamId===team.id&&round.assignment.playerIndex===member!.playerIndex)fail(403,'ROOM_ACTION_DENIED');
 if(round.items?.length?!round.items.some((i:Json)=>i.id===q.itemId&&!i.consumed):q.itemId!==null&&q.itemId!==undefined)fail(409,'ATTEMPT_UNAVAILABLE');
 }
 if(normalized!==null){submissions.push({commandId:q.commandId,hash:digest,memberId:member!.id,roundId:q.roundId,itemId:q.itemId??null,text:q.submittedText.trim(),normalizedText:normalized,receivedAt:match.serverNow,...(attemptId?{attemptId}:{})});room.submissions=submissions;room.version++;}
 return {room:await project(room,access),idempotent:false};});},
 async bindGrant(p:Principal,code:string,input:unknown){const q=exact(input,['memberId'],['token','role']);if((q.token===undefined)===(q.role===undefined))fail(400,'INVALID_ROOM_REQUEST');return store.transaction(async state=>{const room=lookup(state,code);owner(room,p);const member=room.members.find(m=>m.id===q.memberId&&m.status==='ADMITTED')??fail(404,'ROOM_MEMBER_NOT_FOUND');let token=q.token;if(token===undefined){if(!['ACTOR','JUDGE'].includes(q.role))fail(400,'INVALID_ROOM_REQUEST');const adapter=adapters[room.engine],match=await read(room),round=match.currentRound;if(!adapter.issueGrant||!round||room.phase!=='PLAYING')fail(409,'INVALID_PHASE');if(member.teamIndex===null||member.playerIndex===null)fail(403,'ROOM_ACTION_DENIED');const team=match.teams[member.teamIndex!],assignment=round.assignment;if(q.role==='JUDGE'?!member.captain:!assignment||assignment.teamId!==team?.id||(room.engine==='competitive'?assignment.playerId!==team.players[member.playerIndex!]?.id:assignment.playerIndex!==member.playerIndex))fail(403,'ROOM_ACTION_DENIED');const existing=match.grants?.find((g:Json)=>g.roundId===round.id&&g.role===q.role&&!g.revoked);const command={commandId:randomUUID(),expectedVersion:match.version,roundId:round.id,durationSeconds:120,...(existing?{type:'ROTATE_GRANT',scopeId:existing.scopeId,expectedGeneration:existing.generation}:{type:'CREATE_GRANT',role:q.role})};const issued=await adapter.issueGrant!(p,room.matchId,command);token=issued.issuance?.token;if(!token)fail(503,'GRANT_DATA_UNAVAILABLE');}tokenHash(token);await grantAccess(room,member,token);member.privateGrant=sealRoomGrant(token,`${room.code}:${member.id}`);room.version++;return {room:await project(room,'HOST')};});},
 async privateView(code:string,token:string){
  return store.transaction(async state=>{
   const room=lookup(state,code),member=authority(room,token).member;
   if(!member?.privateGrant||isClassicRoom(room)||room.phase!=='PLAYING')return {capability:null};
   const grant=openRoomGrant(member.privateGrant,`${room.code}:${member.id}`);
   try{return {capability:await grantAccess(room,member,grant)};}
   catch(error){if(error instanceof EntaError&&[403,404,409].includes(error.status))return {capability:null};throw error;}
  });
 },
 async privateCanvas(code:string,token:string,query:unknown,input?:unknown){return store.transaction(async state=>{const room=lookup(state,code),member=authority(room,token).member;if(!member?.privateGrant)return fail(403,'ROOM_ACTION_DENIED');const grant=openRoomGrant(member.privateGrant,`${room.code}:${member.id}`),capability=await grantAccess(room,member,grant),adapter=adapters[room.engine];if(capability.role!=='ACTOR'||!adapter.canvas)return fail(403,'ROOM_ACTION_DENIED');return adapter.canvas(grant,capability.roundId,input===undefined?canvasQuery(room.engine,query):{},input);});},
 async publicCanvas(code:string,token:string,query:unknown){return store.transaction(async state=>{const room=lookup(state,code),access=authority(room,token);if(room.phase!=='PLAYING'||access.member&&access.member.status!=='ADMITTED')fail(403,'ROOM_ACTION_DENIED');const match=await read(room),round=match.currentRound,adapter=adapters[room.engine];if(!round||round.format!=='DRAWING_TARGET'||!adapter.publicCanvas)fail(403,'ROOM_ACTION_DENIED');return adapter.publicCanvas!(room.host,room.matchId,round.id,canvasQuery(room.engine,query));});},
 async directEngineMutation(p:Principal,engine:RoomEngine,id:string,input:unknown,grant=false){verified(p);return store.transaction(async state=>{const room=state.rooms.find(r=>(r.engine===engine||engine==='classic'&&r.engine==='kids')&&r.matchId===id);if(room){owner(room,p);if(room.phase==='LOBBY')fail(409,'ROOM_NOT_STARTED');}const adapter=adapters[engine];if(grant){if(!adapter.issueGrant)fail(403,'ROOM_ACTION_DENIED');return adapter.issueGrant!(p,id,input);}return room?runEngineCommand(room,p,input):adapter.command(p,id,input);});},
 async assertEngineMutation(p:Principal,engine:RoomEngine,id:string){verified(p);return store.transaction(async state=>{const room=state.rooms.find(r=>r.engine===engine&&r.matchId===id);if(room){owner(room,p);if(room.phase==='LOBBY')fail(409,'ROOM_NOT_STARTED');}});},
 };
}
export type LocalRooms=ReturnType<typeof createLocalRooms>;











