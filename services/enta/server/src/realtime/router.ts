import { json, type NextFunction, type Request, type Response, type Router } from 'express';
import type { RealtimeEnvelope } from './contracts';
const bodyLimit=json({limit:1024,strict:true,type:'application/json'});
function validRequest(request:Request):boolean {
 const length=request.get('content-length');
 if(length!==undefined && (!/^\d+$/.test(length) || Number(length)>1024)) return false;
 try { return new TextEncoder().encode(JSON.stringify(request.body)).length<=1024; } catch { return false; }
}
function bearer(request:Request):string {
 const header=request.get('authorization');
 if(typeof header!=='string' || header.length>16384 || !/^Bearer [^\s]+$/.test(header)) throw new Error('AUTH_REQUIRED');
 return header.slice(7);
}
function malformed(_error:unknown,_request:Request,response:Response,_next:NextFunction) { response.set('Cache-Control','no-store'); response.status(403).json({error:'REQUEST_UNAVAILABLE'}); }
export function mountRealtime(router:Router, read:(token:string,body:unknown,signal?:AbortSignal)=>Promise<{frame:RealtimeEnvelope;release:()=>void}>):Router {
 router.post('/realtime/read',bodyLimit,async (request:Request,response:Response)=>{
  response.set('Cache-Control','no-store');
  const controller=new AbortController(); let release:(()=>void)|undefined;
  const timer=setTimeout(()=>{controller.abort(); response.destroy();},15000);
  const close=()=>{clearTimeout(timer);controller.abort();release?.();};
  response.once('finish',close);response.once('close',close);
  try {
   if(!validRequest(request)) throw new Error('INVALID_REQUEST');
   const lease=await read(bearer(request),request.body,controller.signal); release=lease.release;
   if(controller.signal.aborted) { release(); return; }
   response.status(200).json(lease.frame);
  } catch { if(!controller.signal.aborted) response.status(403).json({error:'READ_UNAVAILABLE'}); }
 },malformed);
 return router;
}
export function mountJoinPreparation(router:Router, prepare:(token:string,body:unknown,signal?:AbortSignal)=>Promise<{body:{schemaVersion:'huroof-pg-join-prepare-v1';locator:string;roomId:string;roomGeneration:string;revision:string};release:()=>void}>):Router {
 router.post('/realtime/join-prepare',bodyLimit,async(request:Request,response:Response)=>{
  response.set('Cache-Control','no-store');
  const controller=new AbortController(); let release:(()=>void)|undefined;
  const timer=setTimeout(()=>{controller.abort(); response.destroy();},15000);
  const close=()=>{clearTimeout(timer);controller.abort();release?.();};
  response.once('finish',close);response.once('close',close);
  try { if(!validRequest(request)) throw new Error('INVALID_REQUEST'); const lease=await prepare(bearer(request),request.body,controller.signal); release=lease.release; if(controller.signal.aborted) {release(); return;} response.status(200).json(lease.body); }
  catch { if(!controller.signal.aborted) response.status(403).json({error:'JOIN_UNAVAILABLE'}); }
 },malformed);
 return router;
}
