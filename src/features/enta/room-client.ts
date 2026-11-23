import type { User } from 'firebase/auth';
export type RoomEngine = 'classic' | 'kids' | 'round' | 'competitive';
export interface RoomView {
 actionsVersion?:2;
 submissions?:{commandId:string;memberId:string;roundId:string;itemId:string|null;text:string;receivedAt:number}[];
 code: string; version: number; phase: 'LOBBY'|'PLAYING'|'FINISHED'; engine: RoomEngine; matchId: string; locked: boolean;
 teams: {id:string;name:string;players:unknown[]}[];
 members: {id:string;name:string;status:'ADMITTED'|'PENDING';teamIndex:number|null;playerIndex:number|null;captain:boolean}[];
 self: null | {id:string;role:'MEMBER'|'DISPLAY'}; match: Record<string,unknown>|null;
}
export function roomMatchPath(engine:RoomEngine,id:string) { return engine==='competitive'?`/enta/competitive/matches/${id}`:engine==='round'?`/enta/round-matches/${id}`:`/enta/matches/${id}`; }
export async function roomRequest(path:string, options:{user?:Pick<User,'getIdToken'>|null;token?:string;body?:unknown;signal?:AbortSignal}={}) {
 const headers:Record<string,string>={'content-type':'application/json'};
 if(options.user)headers.authorization=`Bearer ${await options.user.getIdToken()}`;
 if(options.token)headers['x-enta-room-token']=options.token;
 const response=await fetch(`/api/v1/enta/rooms${path}`,{method:options.body===undefined?'GET':'POST',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal});
 const data=await response.json();if(!response.ok)throw new Error(data.error??'ROOM_UNAVAILABLE');return data;
}
export function roomError(error:unknown) {
 const code=error instanceof Error?error.message:'';
 if(code==='ROOM_ACTIONS_UPGRADE_REQUIRED')return 'حدّث الخدمات المحلية لتفعيل إرسال الإجابات.';
 if(/NOT_FOUND/.test(code))return 'لم نجد هذه الغرفة. تحقق من الرمز أو اطلب رابطاً جديداً.';
 if(/LOCK|CLOSED|FINISHED/.test(code))return 'الانضمام إلى هذه الغرفة مغلق حالياً.';
 if(code==='ROOM_SUBMISSION_LIMIT')return 'بلغت الغرفة الحد المسموح للإجابات المكتوبة. أكملوا الجولة شفهياً مع المضيف، أو ابدأوا غرفة جديدة.';
 if(code==='DUPLICATE_SUBMITTED_ANSWER')return 'أرسلت هذه الإجابة في الجولة نفسها. اكتب إجابة مختلفة.';
 if(/INVALID_SUBMITTED_ANSWER/.test(code))return 'اكتب إجابة واضحة لا تتجاوز ٥٠٠ حرف.';
 if(/NAME|DUPLICATE/.test(code))return 'اختر اسماً واضحاً ومختلفاً عن أسماء اللاعبين الموجودين.';
 if(/FULL/.test(code))return 'الغرفة مكتملة العدد.';
 if(/STALE|VERSION/.test(code))return 'تغيرت حالة الغرفة. تم طلب أحدث حالة؛ حاول مجدداً.';
 if(/ATTEMPT_BUDGET/.test(code))return 'سُجّلت محاولة فريقك. انتظر حكم المضيف قبل المحاولة التالية.';
 if(/NO_ELIGIBLE_PLAYER|ATTEMPT_UNAVAILABLE|ROUND_TIME_EXPIRED/.test(code))return 'المحاولة غير متاحة لك الآن. انتظر دورك أو الجولة التالية.';
 if(/TOKEN|DENIED|REMOVED|AUTH/.test(code))return 'انتهت صلاحية الدخول أو لا تملك إذن هذا الإجراء.';
 return 'تعذر الاتصال بالغرفة. تحقق من تشغيل الخدمات المحلية ثم أعد المحاولة.';
}
export const roomTokenKey=(code:string)=>`almaidan:room:${code}:token`;
