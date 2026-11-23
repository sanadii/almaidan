/** Wake throttled room polling; caller restarts its abortable effect. */
export function subscribeRoomWake(wake:()=>void,win:Pick<Window,'addEventListener'|'removeEventListener'>=window,doc:Pick<Document,'addEventListener'|'removeEventListener'|'visibilityState'>=document){
 const visible=()=>{if(doc.visibilityState==='visible')wake();};
 win.addEventListener('focus',visible);win.addEventListener('online',visible);doc.addEventListener('visibilitychange',visible);
 return()=>{win.removeEventListener('focus',visible);win.removeEventListener('online',visible);doc.removeEventListener('visibilitychange',visible);};
}
