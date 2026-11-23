export const isRoomUuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const token=(v:unknown):v is string=>typeof v==='string'&&v.length>=20&&v.length<=16384&&!/\s/.test(v);
const code=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z0-9]{6}$/.test(v);
export function parseHuroofRematchPending(raw:string,uid:string,id:string){
 if(raw.length>1024)throw Error('PENDING_UNREADABLE');let value;try{value=JSON.parse(raw);}catch{throw Error('PENDING_UNREADABLE');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='id,requestKey,uid'||value.uid!==uid||value.id!==id||!isRoomUuid(id)||!isRoomUuid(value.requestKey))throw Error('PENDING_UNREADABLE');
 return value as {uid:string;id:string;requestKey:string};
}
export function parseRematchOwnerAccess(value:unknown,id:string){const v=value as Record<string,unknown>|null;if(!v||typeof v!=='object'||Array.isArray(v)||v.roomId!==id||!code(v.roomCode)||!Number.isSafeInteger(v.revision)||(v.revision as number)<1||!token(v.token)||!token(v.audienceToken))throw Error('INVALID_RESPONSE');return {role:'host' as const,token:v.token};}
export function parseHuroofRematchResult(value:unknown,id:string){const v=value as Record<string,unknown>|null,s=v?.source as Record<string,unknown>|undefined;if(!v||typeof v!=='object'||Array.isArray(v)||v.predecessorRoomId!==id||!isRoomUuid(v.roomId)||v.roomId===id||!code(v.roomCode)||!token(v.token)||!Number.isSafeInteger(v.revision)||(v.revision as number)<1||!s||s.selection!=='UNSEEN_PREDECESSOR'||typeof s.snapshotId!=='string'||!/^[a-f0-9]{64}$/.test(s.snapshotId))throw Error('INVALID_RESPONSE');return {roomId:v.roomId,roomCode:v.roomCode,token:v.token};}
