import type { ClientRole, CreateRoomRequest, GameIntent, GameRuntimeAdapter, JoinRoomRequest, ProjectionEnvelope } from './contracts.js';
import { CLIENT_CHALLENGE_CAPABILITY } from './contracts.js';
import { RoomContextEpoch, pgContextKey, type PgRoomContext, type ContextTicket } from './room-context.js';
import { parseRoomLocator } from './room-locator.js';
import { exactEnum, parsePgFrame, PgRecovery } from './pg-recovery.js';

export interface PgAuth {
 current(): Promise<{ principal: string; token: string }>;
 /** Must fire on every auth transition, including A→B→A. */
 subscribe(listener: (principal: string | null) => void): () => void;
}
export interface PgAdapterOptions { namespace: string; projectId: string; auth: PgAuth; fetch: typeof fetch; profileScope?: string }
/** Explicitly constructed only by an admitted caller; no environment selector enables PG. */
export class PgGameAdapter implements GameRuntimeAdapter {
 readonly kind = 'pg' as const;
 private readonly epochs = new RoomContextEpoch();
 private readonly recovery = new PgRecovery();
 private context?: PgRoomContext;
 private stage?: 'SETUP' | 'PAID';
 private policy?: string;
 private route: string | null = null;
 private routeBinding = 0;
 private readTicket?: ContextTicket;
 private dataEpoch = 0;
 private writeTicket?: ContextTicket;
 private readonly aborts = new Set<AbortController>();
 private pendingStart?: { namespace:string;principal:string;roomId:string;roomGeneration:string;body:{locator:string;intentId:string;profileScope:string;expectedRevision:number;offer:typeof CLIENT_CHALLENGE_CAPABILITY} };
 private pendingIntent?: {locator:string;roomId:string;roomGeneration:string;principal:string;ticket:ContextTicket;intent:{type:'JOIN_ROOM';intentId:string;expectedRevision:number;payload:{role:'player';displayName:string;offer:typeof CLIENT_CHALLENGE_CAPABILITY}}};
 private pendingJoin?: { locator:string; roomId:string; roomGeneration:string; principal:string; authEpoch:number };
 private readonly listeners = new Set<() => void>();
 private unsubscribeAuth: () => void;
 constructor(private readonly options: PgAdapterOptions) {
  if (!options.namespace || !options.projectId || (options.profileScope!==undefined && !/^[A-Za-z0-9_-]{1,120}$/.test(options.profileScope))) throw new Error('PG_CONFIGURATION_REQUIRED');
  this.options=Object.freeze({...options});
  this.unsubscribeAuth=this.options.auth.subscribe(principal=>{ this.epochs.changePrincipal(principal); this.pendingJoin=undefined; this.pendingIntent=undefined; this.clear(true); });
 }
 dispose(): void { this.unsubscribeAuth(); this.epochs.changeRoute(null); this.clear(); }
 private clear(notify=false): void { this.dataEpoch++; for(const abort of this.aborts) abort.abort(); this.aborts.clear(); this.context=undefined; this.stage=undefined; this.policy=undefined; this.recovery.clear(); if(notify) for (const listener of this.listeners) listener(); }
 bindRoute(locator:string,view:'member'|'audience'='member'):()=>void {
  if(parseRoomLocator(locator).backend!=='pg') throw new Error('PG_LOCATOR_REQUIRED');
  const binding=++this.routeBinding; this.route=locator; this.pendingIntent=undefined; if(this.pendingJoin?.locator!==locator) this.pendingJoin=undefined; this.epochs.changeView(view); this.epochs.changeRoute(locator); this.clear();
  return ()=>{ if(this.routeBinding===binding) { this.routeBinding++; this.route=null; this.epochs.changeRoute(null); this.clear(); } };
 }
 private async exclusiveWrite<T>(operation:()=>Promise<T>):Promise<T> {
  if(this.writeTicket && this.epochs.current(this.writeTicket)) throw new Error('WRITE_IN_FLIGHT');
  const ticket=this.epochs.ticket(); this.writeTicket=ticket;
  try { return await operation(); } finally { if(this.writeTicket===ticket) this.writeTicket=undefined; }
 }
 private async credentials() {
  const ticket=this.epochs.ticket(); const credentials=await this.options.auth.current(); this.epochs.assertCurrent(ticket);
  if(!ticket.principal || ticket.principal!==credentials.principal || !credentials.token) throw new Error('AUTH_UNAVAILABLE');
  return {ticket,credentials};
 }
 private async request(path:string, body:unknown, ticket:ReturnType<RoomContextEpoch['ticket']>, token:string):Promise<string> {
  this.epochs.assertCurrent(ticket);
  const abort=new AbortController(); this.aborts.add(abort);
  const deadline=setTimeout(()=>abort.abort(),15000);
  try {
   const response=await this.options.fetch(path,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body),cache:'no-store',credentials:'same-origin',signal:abort.signal});
   this.epochs.assertCurrent(ticket); if(!response.ok) throw new Error('PG_UNAVAILABLE');
   const cap=path==='/realtime/join-prepare' ? 4096 : 524288;
   const length=response.headers.get('content-length'); if(length && (!/^\d+$/.test(length) || Number(length)>cap)) throw new Error('FRAME_TOO_LARGE');
   if(!response.body) throw new Error('PG_UNAVAILABLE');
   const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
   try { while(true) { const part=await reader.read(); this.epochs.assertCurrent(ticket); if(part.done) break; size+=part.value.byteLength; if(size>cap) { void reader.cancel().catch(()=>{}); throw new Error('FRAME_TOO_LARGE'); } chunks.push(part.value); } }
   finally { reader.releaseLock(); }
   const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) {bytes.set(chunk,offset); offset+=chunk.byteLength;}
   return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } finally { clearTimeout(deadline); this.aborts.delete(abort); }
 }

 async join(locator:string,displayName:string):Promise<{roomId:string;revision:number;ticket:ContextTicket}> {
  return this.exclusiveWrite(async()=>{
  if(this.epochs.ticket().view!=='member') throw new Error('AUDIENCE_READ_ONLY');
  if(locator!==this.route) throw new Error('STALE_CONTEXT');
  const {ticket,credentials}=await this.credentials();
  let pending=this.pendingIntent;
  if(pending && (!this.epochs.current(pending.ticket) || pending.locator!==locator || pending.principal!==credentials.principal || pending.intent.payload.displayName!==displayName)) throw new Error('PENDING_JOIN_REQUIRES_SAME_CONTEXT');
  if(!pending) {
   const prepared=JSON.parse(await this.request('/realtime/join-prepare',{locator},ticket,credentials.token)) as {schemaVersion?:unknown;locator?:unknown;roomId?:unknown;roomGeneration?:unknown;revision?:unknown};
   if(Object.keys(prepared).sort().join('|')!=='locator|revision|roomGeneration|roomId|schemaVersion' || prepared.schemaVersion!=='huroof-pg-join-prepare-v1' || prepared.locator!==locator || typeof prepared.roomId!=='string' || typeof prepared.roomGeneration!=='string' || !/^[1-9][0-9]{0,15}$/.test(prepared.roomGeneration) || typeof prepared.revision!=='string' || !/^(0|[1-9][0-9]{0,15})$/.test(prepared.revision) || !Number.isSafeInteger(Number(prepared.revision)) || !Number.isSafeInteger(Number(prepared.roomGeneration))) throw new Error('PG_UNAVAILABLE');
   const intent={type:'JOIN_ROOM' as const,intentId:crypto.randomUUID(),expectedRevision:Number(prepared.revision),payload:{role:'player' as const,displayName,offer:structuredClone(CLIENT_CHALLENGE_CAPABILITY)}};
   this.epochs.assertCurrent(ticket);
   pending={locator,roomId:prepared.roomId,roomGeneration:prepared.roomGeneration,principal:credentials.principal,ticket,intent}; this.pendingIntent=pending;
  }
  const joined=JSON.parse(await this.request('/lobby-command',{locator,intent:pending.intent},ticket,credentials.token)) as Record<string,unknown>;
  if(Object.keys(joined).sort().join('|')!=='replayed|revision|roomId' || joined.roomId!==pending.roomId || !Number.isSafeInteger(joined.revision) || Number(joined.revision)<0 || typeof joined.replayed!=='boolean') throw new Error('JOIN_UNAVAILABLE');
  this.epochs.assertCurrent(ticket);
  this.pendingJoin={locator,roomId:pending.roomId,roomGeneration:pending.roomGeneration,principal:credentials.principal,authEpoch:ticket.authEpoch}; this.pendingIntent=undefined;
  return {roomId:pending.roomId,revision:Number(joined.revision),ticket};
  });
 }
 isJoinCurrent(locator:string,ticket:ContextTicket):boolean { return this.route===locator && this.epochs.current(ticket); }
 async createRoom(_request:CreateRoomRequest):Promise<{roomId:string;roomCode:string;revision:number}> { throw new Error('CREATE_UNAVAILABLE'); }
 async joinRoom(request:JoinRoomRequest):Promise<{roomId:string;revision:number;ticket:ContextTicket}> { return this.join(request.roomCode,request.displayName); }
 async resumeRoom(locator:string):Promise<{revision:number;serverTime?:string}> { const value=await this.open(locator); return {revision:value.revision,serverTime:value.serverTime}; }
 currentRole():ClientRole | undefined { return this.context?.role; }
 async open(locator:string):Promise<ProjectionEnvelope> {
  if(locator!==this.route) throw new Error('STALE_CONTEXT');
  if(this.readTicket && this.epochs.current(this.readTicket)) throw new Error('READ_IN_FLIGHT');
  const readTicket=this.epochs.ticket(); const dataEpoch=this.dataEpoch; this.readTicket=readTicket;
  try {
  const {ticket,credentials}=await this.credentials();
  const cursor=this.recovery.cursor();
  const old=this.context;
  const raw=await this.request('/realtime/read',{locator,memberGeneration:old?.memberGeneration??null,afterSequence:cursor?.afterSequence??null,afterRevision:cursor?.afterRevision??null,offer:CLIENT_CHALLENGE_CAPABILITY,...(ticket.view==='audience'?{view:'audience'}:{})},ticket,credentials.token);
  let parsed:unknown; try { parsed=JSON.parse(raw); } catch { throw new Error('INVALID_FRAME'); }
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('INVALID_FRAME');
  const p=parsed as Record<string,unknown>;
  if(typeof p.roomId!=='string' || typeof p.roomGeneration!=='string' || typeof p.memberGeneration!=='string' || !exactEnum(p.role,['host','player','audience'])) throw new Error('INVALID_FRAME');
  if(ticket.view==='audience' && p.role!=='audience') throw new Error('INVALID_FRAME');
  const context:PgRoomContext={backend:'pg',namespace:this.options.namespace,engine:'huroof',profile:this.options.profileScope ?? 'unavailable',locator,roomId:p.roomId,roomGeneration:p.roomGeneration,principal:credentials.principal,memberGeneration:p.memberGeneration,role:p.role as ClientRole,view:ticket.view,authEpoch:ticket.authEpoch,routeEpoch:ticket.routeEpoch,viewEpoch:ticket.viewEpoch};
  if(dataEpoch!==this.dataEpoch) throw new Error('STALE_CONTEXT');
  const frame=parsePgFrame(raw,context,this.options.projectId);
  const pending=this.pendingJoin; if(pending && (pending.locator!==locator || pending.roomId!==context.roomId || pending.roomGeneration!==context.roomGeneration || pending.principal!==credentials.principal || pending.authEpoch!==ticket.authEpoch)) { this.pendingJoin=undefined; this.clear(); throw new Error('CONTEXT_CHANGED'); }
  this.pendingJoin=undefined;
  if(old && (pgContextKey(old)!==pgContextKey(context) || this.policy!==frame.policyRevision+':'+frame.policyHash)) { this.clear(); throw new Error('CONTEXT_CHANGED'); }
  this.epochs.assertCurrent(ticket); this.context=context; this.stage=frame.stage; this.policy=frame.policyRevision+':'+frame.policyHash; return this.recovery.install(frame);
  } catch(error) { if(this.epochs.current(readTicket) && this.dataEpoch===dataEpoch) this.clear(); throw error; } finally { if(this.readTicket===readTicket) this.readTicket=undefined; }
 }
 subscribeProjection(locator:string,role:ClientRole,_uid:string,onProjection:(value:ProjectionEnvelope)=>void,onError:(error:Error)=>void = ()=>{}):()=>void {
  let alive=true; let timer:ReturnType<typeof setTimeout>|undefined; let retry=1000; const ticket=this.epochs.ticket();
  const invalidate=()=>{ if(alive) onError(new Error('AUTH_CHANGED')); }; this.listeners.add(invalidate);
  const poll=async()=>{ try { const value=await this.open(locator); if(!alive || !this.epochs.current(ticket)) return; if(value.role!==role) throw new Error('ROLE_CHANGED'); retry=1000; onProjection(value); timer=setTimeout(()=>void poll(),role==='host'?10000:15000); } catch(e) { if(!alive || !this.epochs.current(ticket)) return; this.clear(); onError(e instanceof Error?e:new Error('PG_UNAVAILABLE')); timer=setTimeout(()=>void poll(),retry); retry=Math.min(15000,retry*2); } };
  void poll(); return ()=>{ alive=false; if(timer) clearTimeout(timer); this.listeners.delete(invalidate); };
 }
 async submitGameIntent(roomId:string,intent:GameIntent):Promise<{revision:number;replayed:boolean}> {
  return this.exclusiveWrite(async()=>{
  if(this.epochs.ticket().view!=='member') throw new Error('AUDIENCE_READ_ONLY');
  const context=this.context; if(!context || context.roomId!==roomId || context.locator!==this.route) throw new Error('CONTEXT_UNAVAILABLE');
  const key=pgContextKey(context); const cursor=this.recovery.cursor();
  if(!cursor || (!this.pendingStart && Number(cursor.afterRevision)!==intent.expectedRevision)) throw new Error('STALE_CONTEXT');
  const {ticket,credentials}=await this.credentials();
  const currentCursor=this.recovery.cursor();
  if(!this.context || pgContextKey(this.context)!==key || credentials.principal!==context.principal || !currentCursor || currentCursor.afterRevision!==cursor.afterRevision || currentCursor.afterSequence!==cursor.afterSequence) throw new Error('STALE_CONTEXT');
  if(this.pendingStart && intent.type!=='START_MATCH') throw new Error('PENDING_START_UNRESOLVED');
  if((this.stage==='SETUP' || this.pendingStart) && intent.type==='START_MATCH') {
   if(context.role!=='host' || !this.options.profileScope || Object.keys(intent.payload).length!==0) throw new Error('START_UNAVAILABLE');
   let pending=this.pendingStart;
   if(pending && (pending.namespace!==context.namespace || pending.principal!==context.principal || pending.roomId!==context.roomId || pending.roomGeneration!==context.roomGeneration || pending.body.locator!==context.locator || pending.body.profileScope!==this.options.profileScope || pending.body.intentId!==intent.intentId || pending.body.expectedRevision!==intent.expectedRevision)) throw new Error('PENDING_START_UNRESOLVED');
   if(!pending) { pending={namespace:context.namespace,principal:context.principal,roomId:context.roomId,roomGeneration:context.roomGeneration,body:{locator:context.locator,intentId:intent.intentId,profileScope:this.options.profileScope,expectedRevision:intent.expectedRevision,offer:structuredClone(CLIENT_CHALLENGE_CAPABILITY)}}; this.pendingStart=pending; }
   const result=JSON.parse(await this.request('/start',pending.body,ticket,credentials.token)) as Record<string,unknown>;
   if(Object.keys(result).sort().join('|')!=='admissionId|matchId|replayed|revision|roomId|sequence|state|status' || result.roomId!==roomId || result.status!=='STARTED' || result.state!=='COMMITTED' || !Number.isSafeInteger(result.revision) || Number(result.revision)<0 || !Number.isSafeInteger(result.sequence) || Number(result.sequence)<1 || typeof result.admissionId!=='string' || typeof result.matchId!=='string' || typeof result.replayed!=='boolean') throw new Error('START_UNAVAILABLE');
   this.pendingStart=undefined; this.dataEpoch++; this.recovery.clear();
   return {revision:Number(result.revision),replayed:result.replayed};
  }
  if(this.stage==='SETUP' && !['LOBBY_SET_READY','LOBBY_ASSIGN_TEAM','LOBBY_ADD_MANUAL_PLAYER'].includes(intent.type)) throw new Error('COMMAND_UNAVAILABLE');
  const lobby=this.stage==='SETUP'; const endpoint=lobby ? '/lobby-command' : '/command';
  this.epochs.assertCurrent(ticket); const value=JSON.parse(await this.request(endpoint,{locator:context.locator,intent},ticket,credentials.token)) as Record<string,unknown>;
  if(lobby && (Object.keys(value).sort().join('|')!=='replayed|revision|roomId' || value.roomId!==roomId)) throw new Error('COMMAND_UNAVAILABLE');
  if(!lobby && Object.keys(value).some(k=>!['revision','sequence','replayed','stale'].includes(k))) throw new Error('COMMAND_UNAVAILABLE');
  if(!Number.isSafeInteger(value.revision) || Number(value.revision)<0 || typeof value.replayed!=='boolean') throw new Error('COMMAND_UNAVAILABLE');
  if(value.stale===true) {
   if(!Number.isSafeInteger(value.sequence) || Number(value.sequence)<0) throw new Error('COMMAND_UNAVAILABLE');
   // The server proved a newer authoritative state; read it without replaying the action or changing its identity.
   this.dataEpoch++; this.recovery.clear(); await this.open(context.locator); throw new Error('COMMAND_UNAVAILABLE');
  }
  this.dataEpoch++; this.recovery.clear();
  return {revision:Number(value.revision),replayed:value.replayed};
  });
 }
}



