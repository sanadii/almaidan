import type {CreateRoomRequest} from './contracts';
export interface LocalCreationPending {uid:string;request:CreateRoomRequest}
export const localCreationKey=(uid:string)=>`almaidan:huroof-create:${uid}`;
/** Pending bytes are an authority boundary: never discard an unreadable uncertain request. */
export function parseLocalCreationPending(raw:string,uid:string):LocalCreationPending {
 if(raw.length>32768)throw Error('LOCAL_PENDING_UNREADABLE');
 const p=JSON.parse(raw),r=p?.request;
 const allowed=['requestKey','displayName','demo','questionSeconds','opponentSeconds','teams','categories','modality','gameKind','mode','labelledColours','mapPresentation','challenge'];
 if(!p||Object.keys(p).sort().join(',')!=='request,uid'||p.uid!==uid||!r||Array.isArray(r)||Object.keys(r).some(k=>!allowed.includes(k))||typeof r.requestKey!=='string'||!/^[A-Za-z0-9._:-]{8,128}$/.test(r.requestKey)||r.demo!==true||!['huroof','categories'].includes(r.gameKind)||r.modality!=='classic'||!['classic','fast','custom'].includes(r.mode)||!Array.isArray(r.categories)||!r.categories.length||r.categories.length>10||r.categories.some((x:unknown)=>typeof x!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(x))||!r.teams||typeof r.teams.horizontal!=='string'||typeof r.teams.vertical!=='string'||![r.questionSeconds,r.opponentSeconds].every(x=>Number.isInteger(x)&&x>0&&x<=300))throw Error('LOCAL_PENDING_UNREADABLE');
 return p;
}
