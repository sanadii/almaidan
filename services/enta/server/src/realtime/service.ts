import { authenticate, requireHosting, type IdentityDependencies } from '../huroof-pg/identity-policy';
import { parseLocator, resolvePgLocator } from '../huroof-pg/locator';
import type { BootstrapRepository } from '../huroof-pg/repository';
import { decimal, REALTIME_LIMITS } from './contracts';
import type { RealtimeRepository } from './repository';
import type { AuthenticatedContext } from '../huroof-pg/identity-policy';
import { assertCapabilityOffer } from '../huroof-pg/profile';
const isRecord=(v:unknown):v is Record<string,unknown> => !!v && typeof v==='object' && !Array.isArray(v);
/** Poll-only delivery: no retained frame queue, transport or background worker. */
export function createRealtimeService(identity: IdentityDependencies, bootstrap: BootstrapRepository, repository: RealtimeRepository, reconcile?:(context:AuthenticatedContext,roomId:string,generation:number)=>Promise<void>) {
 const active=new Set<string>(); let preauth=0; let initialReads=0;
 return async (token:string, body:unknown, signal?:AbortSignal) => {
  if (!isRecord(body) || !['afterRevision|afterSequence|locator|memberGeneration','afterRevision|afterSequence|locator|memberGeneration|view','afterRevision|afterSequence|locator|memberGeneration|offer','afterRevision|afterSequence|locator|memberGeneration|offer|view'].includes(Object.keys(body).sort().join('|')) || (body.view!==undefined && body.view!=='audience') || new TextEncoder().encode(JSON.stringify(body)).length>1024 || typeof body.locator!=='string' || (body.afterSequence===null)!==(body.afterRevision===null) || (body.afterSequence!==null && (!decimal(body.afterSequence) || !decimal(body.afterRevision))) || (body.memberGeneration!==null && (!decimal(body.memberGeneration) || body.memberGeneration==='0'))) throw new Error('INVALID_REQUEST');
  if(Object.hasOwn(body,'offer')) try {assertCapabilityOffer(null,body.offer);} catch {throw new Error('INVALID_REQUEST');}
  const locator=parseLocator(body.locator); if(locator.backend!=='pg') throw new Error('PG_LOCATOR_REQUIRED');
  const initial=body.memberGeneration===null;
  if(preauth>=REALTIME_LIMITS.connections || (initial && initialReads>=REALTIME_LIMITS.connections-8)) throw new Error('CAPACITY_UNAVAILABLE'); preauth++; if(initial) initialReads++;
  let key:string|undefined; let released=false;
  const release=()=>{ if(released) return; released=true; if(key) active.delete(key); preauth--; if(initial) initialReads--; };
  const live=()=>{ if(signal?.aborted) throw new Error('DELIVERY_CANCELLED'); };
  try {
   live(); const context=await authenticate(identity,token); live();
   const resolved=await resolvePgLocator(context.policy.namespace,locator,bootstrap.resolveLocator); live();
   key=JSON.stringify([context.policy.namespace,resolved.roomId,context.principal.uid]);
   if(active.has(key)) { key=undefined; throw new Error('CAPACITY_UNAVAILABLE'); } active.add(key);
   const fresh=await authenticate(identity,token); live();
   if(fresh.identityId!==context.identityId || fresh.principal.uid!==context.principal.uid || fresh.policy.revision!==context.policy.revision || fresh.policy.hash!==context.policy.hash) throw new Error('AUTH_CHANGED');
   const query={roomId:resolved.roomId,roomGeneration:String(resolved.roomGeneration),memberGeneration:body.memberGeneration as string|null,afterSequence:body.afterSequence as string|null,afterRevision:body.afterRevision as string|null,...(Object.hasOwn(body,'offer')?{offer:body.offer}:{})};
   const read=async(ctx:AuthenticatedContext,q:typeof query)=>body.view==='audience'?repository.readAudience(ctx,q):{frame:await repository.read(ctx,q),actualMemberRole:undefined};
   let first;try {first=await read(fresh,query);} catch(error) {if(!reconcile) throw error;await reconcile(fresh,resolved.roomId,resolved.roomGeneration);live();first=await read(fresh,query);} live();
   if((first.actualMemberRole??first.frame.role)==='host') requireHosting(fresh);
   if(first.frame.stage==='PAID' && reconcile) {await reconcile(fresh,resolved.roomId,resolved.roomGeneration);live();first=await read(fresh,query);live();if((first.actualMemberRole??first.frame.role)==='host') requireHosting(fresh);}
   const delivery=await authenticate(identity,token); live();
   if(delivery.identityId!==fresh.identityId || delivery.principal.uid!==fresh.principal.uid || delivery.policy.revision!==fresh.policy.revision || delivery.policy.hash!==fresh.policy.hash) throw new Error('AUTH_CHANGED');
   if((first.actualMemberRole??first.frame.role)==='host') requireHosting(delivery);
   if(first.frame.stage==='PAID' && reconcile) {await reconcile(delivery,resolved.roomId,resolved.roomGeneration);live();}
   const last=await read(delivery,{...query,memberGeneration:first.frame.memberGeneration}); live();const frame=last.frame;
   if((last.actualMemberRole??frame.role)==='host') requireHosting(delivery);
   if(last.actualMemberRole!==first.actualMemberRole || frame.role!==first.frame.role || frame.memberGeneration!==first.frame.memberGeneration || frame.roomGeneration!==first.frame.roomGeneration || frame.snapshot.projection.room.roomCode!==resolved.code || (body.view==='audience' && (frame.revision!==first.frame.revision || frame.throughSequence!==first.frame.throughSequence))) throw new Error('AUTH_CHANGED');
   return {frame,release};
  } catch(error) { release(); throw error; }
 };
}
/** Join discovery grants no membership and reveals only advisory metadata. */
export function createJoinPreparation(identity: IdentityDependencies, lobby: Pick<import('../huroof-pg/repository').LobbyRepository,'loadJoinLobby' | 'resolveLocator'>, clock:()=>number) {
 let preauth=0; const inflight=new Set<string>();
 const buckets=new Map<string,{tokens:number; updated:number}>();
 return async (token:string,body:unknown,signal?:AbortSignal) => {
  if(!isRecord(body) || Object.keys(body).join('|')!=='locator' || typeof body.locator!=='string' || new TextEncoder().encode(JSON.stringify(body)).length>1024) throw new Error('INVALID_REQUEST');
  const parsed=parseLocator(body.locator); if(parsed.backend!=='pg') throw new Error('PG_LOCATOR_REQUIRED');
  if(preauth>=64) throw new Error('CAPACITY_UNAVAILABLE'); preauth++;
  let key:string|undefined; let reserved=false; let released=false;
  const release=()=>{ if(released) return; released=true; if(key && reserved) inflight.delete(key); preauth--; };
  const live=()=>{ if(signal?.aborted) throw new Error('DELIVERY_CANCELLED'); };
  try {
   live(); const context=await authenticate(identity,token); live();
   key=JSON.stringify([context.policy.namespace,context.principal.projectId,context.principal.uid]);
   const now=clock(); if(!Number.isSafeInteger(now) || now<0) throw new Error('CLOCK_UNAVAILABLE');
   for(const [k,b] of buckets) if(now>=b.updated && now-b.updated>=300000) buckets.delete(k);
   if(inflight.has(key)) throw new Error('CAPACITY_UNAVAILABLE');
   let bucket=buckets.get(key);
   if(!bucket) { if(buckets.size>=1024) throw new Error('CAPACITY_UNAVAILABLE'); bucket={tokens:2,updated:now}; buckets.set(key,bucket); }
   if(now<bucket.updated) throw new Error('CLOCK_UNAVAILABLE');
   bucket.tokens=Math.min(2,bucket.tokens+(now-bucket.updated)/6000); bucket.updated=now;
   if(bucket.tokens<1) throw new Error('CAPACITY_UNAVAILABLE'); bucket.tokens--; inflight.add(key); reserved=true;
   const locator=await resolvePgLocator(context.policy.namespace,parsed,lobby.resolveLocator); live();
   const snapshot=await lobby.loadJoinLobby(context,locator.roomId,locator.roomGeneration); live();
   if(snapshot.roomId!==locator.roomId || snapshot.generation!==locator.roomGeneration || snapshot.state.schemaVersion!=='huroof-lobby-v1' || snapshot.state.room.roomCode!==locator.code || snapshot.state.room.game.lifecycle!=='LOBBY' || !Number.isSafeInteger(snapshot.state.room.revision) || snapshot.state.room.revision<0) throw new Error('JOIN_UNAVAILABLE');
   const fresh=await authenticate(identity,token); live();
   if(fresh.identityId!==context.identityId || fresh.principal.uid!==context.principal.uid || fresh.principal.projectId!==context.principal.projectId || fresh.policy.namespace!==context.policy.namespace || fresh.policy.revision!==context.policy.revision || fresh.policy.hash!==context.policy.hash) throw new Error('AUTH_CHANGED');
   const result={schemaVersion:'huroof-pg-join-prepare-v1' as const,locator:body.locator,roomId:locator.roomId,roomGeneration:String(locator.roomGeneration),revision:String(snapshot.state.room.revision)};
   if(new TextEncoder().encode(JSON.stringify(result)).length>4096) throw new Error('JOIN_UNAVAILABLE');
   return {body:result,release};
  } catch(error) { release(); throw error; }
 };
}
