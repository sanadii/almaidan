import type { User } from 'firebase/auth';
export type RoomEngine = 'classic' | 'kids' | 'round' | 'competitive';
export interface RoomSubmission {commandId:string;memberId:string;roundId:string;itemId:string|null;text:string;receivedAt:number;attemptId?:string}
export interface RoomFeedback {roundId:string;at:number;awards:{teamId:string;points:number}[]}
export interface RoomView {
 actionsVersion?:2;
 submissions?:RoomSubmission[];
 feedback?:RoomFeedback|null;
 successorCode?:string;
 code: string; version: number; phase: 'LOBBY'|'PLAYING'|'FINISHED'; engine: RoomEngine; matchId: string; locked: boolean;
 teams: {id:string;name:string;players:unknown[];seatLimit?:number}[];
 members: {id:string;name:string;status:'ADMITTED'|'PENDING';teamIndex:number|null;playerIndex:number|null;captain:boolean}[];
 self: null | {id:string|null;role:'MEMBER'|'DISPLAY';hasPrivateGrant?:boolean}; match: Record<string,unknown>|null;
}
export function roomMatchPath(engine:RoomEngine,id:string) { return engine==='competitive'?`/enta/competitive/matches/${id}`:engine==='round'?`/enta/round-matches/${id}`:`/enta/matches/${id}`; }
export async function roomRequest(path:string, options:{user?:Pick<User,'getIdToken'>|null;token?:string;body?:unknown;signal?:AbortSignal;keepalive?:boolean}={}) {
 const headers:Record<string,string>={'content-type':'application/json'};
 if(options.user)headers.authorization=`Bearer ${await options.user.getIdToken()}`;
 options.signal?.throwIfAborted();
 if(options.token)headers['x-enta-room-token']=options.token;
 const response=await fetch(`/api/v1/enta/rooms${path}`,{method:options.body===undefined?'GET':'POST',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal,keepalive:options.keepalive});
 if(response.status===204)return {};
 if(!response.ok){const data=await response.json().catch(()=>null);throw new RoomRequestError(data?.error??'ROOM_UNAVAILABLE',response.status);}
 return response.json();
}
/** A server answer, unlike a transport failure, carries its HTTP status. */
export class RoomRequestError extends Error { constructor(code:string,readonly status:number){super(code);} }
export type RoomJoinOptions =
 | { teams: { id: string; name: string }[]; finished?: never }
 | { finished: true; successorCode?: string };

export async function requestRoomJoinOptions(code: string, signal: AbortSignal): Promise<RoomJoinOptions> {
 try {
  const data = await roomRequest(`/${encodeURIComponent(code)}/join`, { signal });
  if (data?.finished === true) {
   const successor = data.successorCode;
   return typeof successor === 'string' && successor !== code && /^E1-[A-Z2-9]{8}$/.test(successor)
    ? { finished: true, successorCode: successor } : { finished: true };
  }
  if (!Array.isArray(data?.teams) || !data.teams.length) throw new Error('ROOM_UNAVAILABLE');
  return { teams: data.teams };
 } catch (error) {
  if (error instanceof RoomRequestError && error.message === 'ROOM_FINISHED') return { finished: true };
  throw error;
 }
}

export const isTerminalRoomRead=(error:unknown)=>error instanceof RoomRequestError&&[401,403,404].includes(error.status);
/** Room and engine commands check their idempotency receipt before any domain
 * rule, so a 4xx domain answer proves this exact command was not applied.
 * Authentication, timeout and throttling answers stay retryable. */
export const isDefinitiveRoomRejection=(error:unknown)=>error instanceof RoomRequestError&&error.status>=400&&error.status<500&&![401,408,429].includes(error.status)&&/^[A-Z][A-Z_]{1,79}$/.test(error.message);
export function roomError(error:unknown) {
 const code=error instanceof Error?error.message:'';
 if(code==='ROOM_ACTIONS_UPGRADE_REQUIRED')return 'حدّث الخدمات المحلية لتفعيل إرسال الإجابات.';
 if(code==='ROOM_ASSIGNMENT_REQUIRED')return 'وزّعوا اللاعبين على الفرق أولاً';
 if(code==='ROOM_TEAM_FULL'||code==='ROOM_PLAYER_TAKEN')return 'الفريق ممتلئ. اختاروا فريقاً آخر.';
 if(code==='ROOM_FINISHED')return 'انتهت هذه المباراة';
 if(code==='ROOM_REMATCH_ALREADY_STARTED')return 'بدأ المضيف مباراة جديدة من هذه الغرفة.';
 if(code==='DISPLAY_LIMIT')return 'وصلت الغرفة إلى الحد الأقصى لروابط شاشة العرض. ألغوا الروابط السابقة ثم أنشئوا رابطاً جديداً.';
 if(code==='ROOM_ALREADY_STARTED')return 'بدأت المباراة بالفعل. افتحوا لوحة المضيف لمتابعتها.';
 if(code==='ROOM_MEMBER_NOT_FOUND')return 'لم يعد هذا اللاعب في الغرفة. حدّثنا القائمة؛ راجعوها ثم أعيدوا المحاولة.';
 if(code==='INVALID_ROOM_ASSIGNMENT')return 'هذا المقعد غير متاح في الفريق المختار.';
 if(code==='ROOM_NAME_TAKEN')return 'في لاعب بهذا الاسم. اختاروا اسماً آخر.';
 if(code==='ROOM_KEY_CONFLICT')return 'تعذر إكمال طلب الدخول السابق بهذا الاسم. أدخل الاسم نفسه أو حدّث الصفحة ثم أعد الدخول.';
 if(code==='AID_UNAVAILABLE'||code==='AID_PAIRING_DENIED')return 'هذه المساعدة غير متاحة لفريقك الآن أو استُخدمت من قبل.';
 if(code==='HINT_UNAVAILABLE')return 'لا يوجد تلميح متاح لهذه الجولة.';
 if(code==='ROUND_PAUSED')return 'الجولة متوقفة مؤقتاً. انتظر استئناف المضيف.';
 if(/NOT_FOUND/.test(code))return 'لم نجد هذه الغرفة. تحقق من الرمز أو اطلب رابطاً جديداً.';
 if(/LOCK|CLOSED|FINISHED/.test(code))return 'الانضمام إلى هذه الغرفة مغلق حالياً.';
 if(code==='ROOM_SUBMISSION_LIMIT')return 'بلغت الغرفة الحد المسموح للإجابات المكتوبة. أكملوا الجولة شفهياً مع المضيف، أو ابدأوا غرفة جديدة.';
 if(code==='DUPLICATE_SUBMITTED_ANSWER')return 'أرسلت هذه الإجابة في الجولة نفسها. اكتب إجابة مختلفة.';
 if(/INVALID_SUBMITTED_ANSWER/.test(code))return 'اكتب إجابة واضحة لا تتجاوز 500 حرف.';
 if(/NAME|DUPLICATE/.test(code))return 'اختر اسماً واضحاً ومختلفاً عن أسماء اللاعبين الموجودين.';
 if(/FULL/.test(code))return 'الغرفة مكتملة العدد.';
 if(/STALE|VERSION/.test(code))return 'تغيرت حالة الغرفة. تم طلب أحدث حالة؛ حاول مجدداً.';
 if(/ATTEMPT_BUDGET/.test(code))return 'سُجّلت محاولة فريقك. انتظر حكم المضيف قبل المحاولة التالية.';
 if(/NO_ELIGIBLE_PLAYER|ATTEMPT_UNAVAILABLE|ROUND_TIME_EXPIRED/.test(code))return 'المحاولة غير متاحة لك الآن. انتظر دورك أو الجولة التالية.';
 if(/TOKEN|DENIED|REMOVED|AUTH/.test(code))return 'انتهت صلاحية الدخول أو اطلبوا رابطاً جديداً من المضيف.';
 return 'ما قدرنا نتصل بالغرفة. تأكدوا من الاتصال وحاولوا مرة ثانية.';
}
export const roomTokenKey=(code:string)=>`almaidan:room:${code}:token`;
