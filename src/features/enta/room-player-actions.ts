import type {RoomView} from './room-client';
/** Public affordances only. The engine rechecks phase, disclosure and attempt budget. */
export function roomAttemptOptions(room:RoomView,display=false):{itemId:string|null;label:string}[]{
 const match=room.match as any,current=match?.currentRound,member=room.members.find(m=>m.id===room.self?.id);
 if(room.actionsVersion!==2||display||!['competitive','round'].includes(room.engine)||room.phase!=='PLAYING'||!current||!member||member.status!=='ADMITTED'||member.teamIndex===null||member.playerIndex===null||current.publicRevealed||current.revealed||current.pause||(room.engine==='round'?current.state!=='RUNNING':!['MAIN','TRAP','STEAL','SHARED','TURN'].includes(current.phase)))return [];
 const team=room.teams[member.teamIndex],player=team?.players[member.playerIndex] as {id?:string}|undefined;
 if(!team||room.engine==='competitive'&&!player?.id)return [];
 if(room.engine==='round'){if(current.scoringTeamId!==team.id||current.assignment?.teamId===team.id&&current.assignment.playerIndex===member.playerIndex)return [];return current.items?.length?current.items.filter((i:any)=>!i.consumed).map((i:any)=>({itemId:i.id,label:`إرسال إجابة العنصر ${i.ordinal+1}`})):[{itemId:null,label:'إرسال التخمين'}];}
 const eligibleTeam=current.phase==='SHARED'||(current.phase==='STEAL'?team.id!==current.originalTeamId:team.id===current.currentTeamId);
 if(!eligibleTeam||current.assignment?.playerId===player!.id||current.pickedPlayerId&&team.players.some((p:any)=>p.id===current.pickedPlayerId)&&current.pickedPlayerId!==player!.id)return [];
 if(['LIST_ITEMS','ACTING_ITEMS'].includes(current.format))return (current.items??[]).filter((i:any)=>!i.consumed&&!i.revealed&&(current.format!=='ACTING_ITEMS'||current.assignment?.itemId===i.id)).map((i:any)=>({itemId:i.id,label:current.format==='ACTING_ITEMS'?'تسجيل تخمين التمثيل':`تسجيل إجابة العنصر ${i.ordinal+1}`}));
 return [{itemId:null,label:current.format==='DRAWING_TARGET'?'تسجيل تخمين الرسم':'تسجيل محاولة الإجابة'}];
}


const definitiveActionErrors=new Set(['STALE_VERSION','INVALID_PHASE','ROOM_ACTION_DENIED','ROOM_CAPABILITY_DENIED','INVALID_ROOM_REQUEST','INVALID_SUBMITTED_ANSWER','ROOM_COMMAND_CONFLICT','NO_ELIGIBLE_PLAYER','ATTEMPT_UNAVAILABLE','ATTEMPT_BUDGET_EXCEEDED','ROUND_TIME_EXPIRED','DUPLICATE_SUBMITTED_ANSWER','ROOM_SUBMISSION_LIMIT']);
export const isDefinitiveRoomActionError=(error:unknown)=>error instanceof Error&&definitiveActionErrors.has(error.message);
