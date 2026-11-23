import { parseCreateLobbyDto } from './types';
import type { CanonicalRoom } from '../../../../../functions/src/game.js';

export interface SuccessorSetupRequest { version:1; setupKey:string; parentMatchId:string; expectedResultVersion:number; expectedResultHash:string; config:CanonicalRoom['config']; displayName:string }
export interface SuccessorStartRequest { version:1; requestKey:string; logicalMatchId:string; setupKey:string; expectedRevision:number; profileScope:string }
function exact(input:unknown,keys:readonly string[]):Record<string,unknown> {
 if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('INVALID_REQUEST');
 const row=input as Record<string,unknown>; if(Object.keys(row).length!==keys.length || keys.some(k=>!Object.hasOwn(row,k))) throw new Error('INVALID_REQUEST'); return row;
}
const key=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export function parseSuccessorSetup(input:unknown):SuccessorSetupRequest {
 const r=exact(input,['version','setupKey','parentMatchId','expectedResultVersion','expectedResultHash','config','displayName']);
 if(r.version!==1 || !key(r.setupKey) || !id(r.parentMatchId) || !Number.isSafeInteger(r.expectedResultVersion) || (r.expectedResultVersion as number)<1 || typeof r.expectedResultHash!=='string' || !/^[a-f0-9]{64}$/.test(r.expectedResultHash)) throw new Error('INVALID_REQUEST');
 const create=parseCreateLobbyDto({intentId:r.setupKey,displayName:r.displayName,config:r.config});
 return {version:1,setupKey:r.setupKey,parentMatchId:r.parentMatchId,expectedResultVersion:r.expectedResultVersion as number,expectedResultHash:r.expectedResultHash,config:create.config,displayName:create.displayName};
}
export function parseSuccessorStart(input:unknown):SuccessorStartRequest {
 const r=exact(input,['version','requestKey','logicalMatchId','setupKey','expectedRevision','profileScope']);
 if(r.version!==1 || !key(r.requestKey) || !id(r.logicalMatchId) || !key(r.setupKey) || !Number.isSafeInteger(r.expectedRevision) || (r.expectedRevision as number)<0 || !key(r.profileScope)) throw new Error('INVALID_REQUEST');
 return {version:1,requestKey:r.requestKey,logicalMatchId:r.logicalMatchId,setupKey:r.setupKey,expectedRevision:r.expectedRevision as number,profileScope:r.profileScope};
}

import { createHash } from 'node:crypto';
import { initialGameState } from '../../../../../src/features/game/domain/lifecycle.js';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { authenticate, requireHosting, type IdentityDependencies, type AuthenticatedContext } from './identity-policy';
import { readPinnedQuestions, requireCustody, parseCustodyPolicy, type CustodyEvidenceVerifier } from './content-reader';
import { reduceCommand } from './reducer';
import { resolvePgLocator,parseLocator } from './locator';
import { projectForMember } from './projection';
import type { LobbyState, PaidRepository } from './repository';
import { createHuroofSuccessorPrivateAdapters, isHuroofLegacyRepository, isHuroofPrivateBoundary, type HuroofSuccessorRepository, type HuroofPrivateBoundary } from './successor-postgres';
export interface HuroofSuccessorDependencies { identity:IdentityDependencies; repository:HuroofSuccessorRepository; native:Pick<PaidRepository,'deriveCreateIdentity'|'derivePaidIdentity'|'resolveLocator'|'loadLobby'|'readLobbyContent'|'readCustodyPolicy'>; clock:()=>number; custodyVerifier?:CustodyEvidenceVerifier; capacity?:HuroofPrivateBoundary }
function frozenCopy<T>(value:T):T { const copy=JSON.parse(JSON.stringify(value)) as T; const freeze=(v:unknown):void=>{if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}};freeze(copy);return copy; }
function createKey(c:AuthenticatedContext,setupKey:string):string {return 's_'+createHash('sha256').update(JSON.stringify(['eng03-06-successor-create-v1',c.policy.namespace,c.principal.projectId,c.identityId,setupKey]),'utf8').digest('hex');}
/** Server-owned preparation uses genuine03 readers/reducer; final wrapper revalidates every value. */
function createHuroofSuccessorCore(deps:HuroofSuccessorDependencies) {
 return {
  async setup(context:AuthenticatedContext,input:unknown) {
   if(!isHuroofLegacyRepository(deps.repository) && !isHuroofPrivateBoundary(deps.capacity,deps.repository,deps.native)) throw new Error('SUCCESSOR_CAPACITY_UNAVAILABLE');
   const r=frozenCopy(parseSuccessorSetup(input));
   const prior=await deps.repository.setup(context,r,null); if(prior)return prior;
   requireHosting(context);
   if(!isHuroofPrivateBoundary(deps.capacity,deps.repository,deps.native)) throw new Error('SUCCESSOR_CAPACITY_UNAVAILABLE');
   await deps.capacity.assertCurrent(context);
   const derived=await deps.native.deriveCreateIdentity(context,createKey(context,r.setupKey));
   const host={uid:context.principal.uid,role:'host' as const,displayName:r.displayName,ready:true,active:true};
   const state:LobbyState={schemaVersion:'huroof-lobby-v1',room:{schemaVersion:2,roomCode:derived.code,revision:0,game:initialGameState(),config:r.config,manualParticipants:[],questionCursor:0},members:[host],memberBindings:[{identityId:context.identityId,uid:context.principal.uid,generation:'1',version:'0'}]};
   const result=await deps.repository.setup(context,r,state);
   if(result.roomId!==derived.roomId || result.locator!=='M2-'+derived.code)throw new Error('DATABASE_RESPONSE_INVALID');return result;
  },
  async retry(context:AuthenticatedContext,input:unknown) {if(!isHuroofLegacyRepository(deps.repository) && !isHuroofPrivateBoundary(deps.capacity,deps.repository,deps.native)) throw new Error('SUCCESSOR_CAPACITY_UNAVAILABLE');const r=frozenCopy(parseSuccessorStart(input));return deps.repository.retry(context,r);},
  async start(context:AuthenticatedContext,input:unknown) {
   if(!isHuroofLegacyRepository(deps.repository) && !isHuroofPrivateBoundary(deps.capacity,deps.repository,deps.native)) throw new Error('SUCCESSOR_CAPACITY_UNAVAILABLE');
   const r=frozenCopy(parseSuccessorStart(input));
   const prior=await deps.repository.retry(context,r);if(prior)return prior;
   requireHosting(context);
   if(!isHuroofPrivateBoundary(deps.capacity,deps.repository,deps.native)) throw new Error('SUCCESSOR_CAPACITY_UNAVAILABLE');
   await deps.capacity.assertCurrent(context);
   const derived=await deps.native.deriveCreateIdentity(context,createKey(context,r.setupKey));
   const ids=await deps.native.derivePaidIdentity(context,derived.roomId,r.requestKey);
   const locator=await resolvePgLocator(context.policy.namespace,parseLocator('M2-'+derived.code),(namespace,code)=>deps.native.resolveLocator(namespace,code));
   if(locator.roomId!==derived.roomId)throw new Error('LOBBY_UNAVAILABLE');
   const lobby=await deps.native.loadLobby(context,locator.roomId,locator.roomGeneration);
   if(lobby.actor.uid!==context.principal.uid || lobby.actor.role!=='host' || !lobby.actor.active || lobby.state.room.roomCode!==derived.code || lobby.state.room.revision!==r.expectedRevision || lobby.state.room.game.lifecycle!=='LOBBY')throw new Error('LOBBY_UNAVAILABLE');
   const pin=await deps.native.readLobbyContent(context,lobby,r.profileScope);
   if(pin.namespace!==context.policy.namespace || pin.projectId!==context.principal.projectId || pin.profileScope!==r.profileScope || pin.configReleaseId!==lobby.state.room.config.releaseId || pin.configHuroofRoot!==lobby.state.room.config.releaseRootSha256)throw new Error('PINNED_CONTENT_UNAVAILABLE');
   const questions=readPinnedQuestions(pin,lobby.state.room.config.categories??[]),verifier=deps.custodyVerifier;if(!verifier)throw new Error('CUSTODY_AUTHORITY_UNAVAILABLE');
   const policyRow=await deps.native.readCustodyPolicy(context.policy.namespace);if(!policyRow)throw new Error('CUSTODY_AUTHORITY_UNAVAILABLE');
   const trust=parseCustodyPolicy(policyRow,context.policy.namespace,context.principal.projectId,verifier.supportedEvidenceVersions);
   const custody=await requireCustody(pin,context.policy.revision,context.policy.hash,deps.clock(),trust,verifier);
   const now=deps.clock(),gameIntent={type:'START_MATCH' as const,intentId:r.requestKey,expectedRevision:r.expectedRevision,payload:{}};
   const transition=await reduceCommand(lobby.state.room,lobby.actor,gameIntent,now,lobby.state.members,async()=>questions);
   const projections=lobby.state.members.filter(member=>member.active).map(member=>({uid:member.uid,payload:projectForMember(lobby.roomId,transition.room,lobby.state.members,member.uid,now)}));
   const clientIntent={locator:'M2-'+derived.code,intentId:r.requestKey,profileScope:r.profileScope,expectedRevision:r.expectedRevision};
   const intent={namespace:context.policy.namespace,roomId:lobby.roomId,requestKey:r.requestKey,logicalMatchId:ids.logicalMatchId,profileScope:r.profileScope,policyRevision:context.policy.revision,policyHash:context.policy.hash,selectorVersion:pin.selectorVersion,readinessPolicyVersion:pin.readinessPolicyVersion,admissionId:ids.admissionId,matchId:ids.matchId,roomGeneration:String(lobby.generation),lobbyRevision:String(lobby.state.room.revision),lobbyStateHash:lobby.stateHash,preparedRoom:transition.room,preparedMembers:lobby.state.members,custody,clientIntent};
   let result;
   try { result=await deps.repository.start(context,r,intent,{config:lobby.state.room.config,configHash:admissionHash(lobby.state.room.config)},projections); }
   catch(error) { const code=error && typeof error==='object' && 'code' in error ? (error as {code?:unknown}).code : undefined; if(code==='08006'||code==='08007') { try { const resolved=await deps.repository.retry(context,r); if(resolved)return resolved; } catch { /* original commit remains uncertain */ } throw new Error('COMMIT_UNKNOWN'); } throw error; }
   if(result.roomId!==derived.roomId||result.admissionId!==ids.admissionId||result.matchId!==ids.matchId||result.revision!==transition.room.revision||result.sequence!==1)throw new Error('DATABASE_RESPONSE_INVALID');return result;
  }
 };
}

/** Public legacy entry retains exact committed retries; fresh preparation needs the paired private boundary. */
export function createHuroofSuccessorService(deps:HuroofSuccessorDependencies) {
 const core=createHuroofSuccessorCore(deps);
 return {
  async setup(token:string,input:unknown){return core.setup(frozenCopy(await authenticate(deps.identity,token)),input);},
  async retry(token:string,input:unknown){return core.retry(frozenCopy(await authenticate(deps.identity,token)),input);},
  async start(token:string,input:unknown){return core.start(frozenCopy(await authenticate(deps.identity,token)),input);},
 };
}


import { privateFixedCall, type PrivateQueryEffect } from '../history-rematch/capacity-producer';
import { admission as captureAdmission, spoolRef, unavailable, type Admission, type SpoolRef } from '../history-rematch/capacity-contract';
import type { IdTokenVerifier } from '../identity';
/** Dedicated private capsule; the supervisor owns its admission and entire lifetime. */
export class HuroofSuccessorCapsule {
 private consumed=false;
 constructor(private readonly effect:PrivateQueryEffect,private readonly verifyToken:IdTokenVerifier,private readonly token:string,private readonly clock:()=>number,private readonly custodyVerifier?:CustodyEvidenceVerifier) {}
 async executeOne(rawAdmission:Admission,rawSpool:SpoolRef) {
  if(this.consumed)return unavailable();this.consumed=true;
  const admission=captureAdmission(rawAdmission),spool=spoolRef(rawSpool);
  if(admission.subject.operation!=='PG_SETUP' && admission.subject.operation!=='PG_START')return unavailable();
  const args=[admission.id,admission.fence.toString()] as const;
  if(await privateFixedCall(this.effect,'begin',args)!==null)return unavailable();
  const protectedContext=await privateFixedCall(this.effect,'readContext',args);
  if(!protectedContext || typeof protectedContext!=='object' || Array.isArray(protectedContext))return unavailable();
  const pc=protectedContext as Record<string,unknown>;
  if(pc.namespace!==admission.subject.namespace || pc.projectId!==admission.subject.project || pc.identityId!==admission.subject.owner)return unavailable();
  const adapters=createHuroofSuccessorPrivateAdapters(this.effect,admission);
  const identity:IdentityDependencies={namespace:admission.subject.namespace,clientProjectId:admission.subject.project,verifyToken:this.verifyToken,readActivePolicy:adapters.bootstrap.readActivePolicy,resolveIdentity:adapters.bootstrap.resolveIdentity};
  const context=frozenCopy(await authenticate(identity,this.token));
  await adapters.boundary.assertCurrent(context);
  const body=await privateFixedCall(this.effect,'readSpool',[...args,spool.id]);if(!(body instanceof Uint8Array))return unavailable();
  let raw:unknown;try {raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return unavailable();}
  const parsed=admission.subject.operation==='PG_SETUP'?parseSuccessorSetup(raw):parseSuccessorStart(raw);
  if(await privateFixedCall(this.effect,'assertSpoolRequest',[...args,JSON.stringify(parsed)])!==null)return unavailable();
  const deps:HuroofSuccessorDependencies={identity,repository:adapters.repository,native:adapters.native,capacity:adapters.boundary,clock:this.clock,custodyVerifier:this.custodyVerifier};
  const core=createHuroofSuccessorCore(deps);
  return admission.subject.operation==='PG_SETUP'?core.setup(context,parsed):core.start(context,parsed);
 }
}
