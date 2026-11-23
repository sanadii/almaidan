import type { AuthenticatedContext } from './identity-policy';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { LobbyState, LobbyCreateOutcome, PaidOutcome } from './repository';
export type SuccessorTransactionBoundary = Pick<PrismaClient, '$transaction'>;
import type { SuccessorSetupRequest, SuccessorStartRequest } from './successor';
export interface HuroofSuccessorRepository {
 setup(c:AuthenticatedContext,r:SuccessorSetupRequest,state:null):Promise<LobbyCreateOutcome|null>;
 setup(c:AuthenticatedContext,r:SuccessorSetupRequest,state:LobbyState):Promise<LobbyCreateOutcome>;
 retry(c:AuthenticatedContext,r:SuccessorStartRequest):Promise<PaidOutcome|null>;
 start(c:AuthenticatedContext,r:SuccessorStartRequest,intent:Record<string,unknown>,initial:Record<string,unknown>,projections:unknown[]):Promise<PaidOutcome>;
}
function context(c:AuthenticatedContext) { return {namespace:c.policy.namespace,projectId:c.principal.projectId,uid:c.principal.uid,identityId:c.identityId,policyRevision:c.policy.revision,policyHash:c.policy.hash}; }
function one(rows:readonly {value:unknown}[]):unknown { if(rows.length!==1 || !rows[0] || !Object.hasOwn(rows[0],'value')) throw new Error('DATABASE_RESPONSE_INVALID');return rows[0].value; }
function obj(v:unknown, keys:string[]):Record<string,unknown> { if(!v || typeof v!=='object' || Array.isArray(v)) throw new Error('DATABASE_RESPONSE_INVALID');const row=v as Record<string,unknown>;if(Object.keys(row).length!==keys.length || keys.some(k=>!Object.hasOwn(row,k))) throw new Error('DATABASE_RESPONSE_INVALID');return row; }
function setupOutcome(v:unknown):LobbyCreateOutcome {const x=obj(v,['roomId','locator','revision','replayed']);if(typeof x.roomId!=='string'||!/^l_[a-f0-9]{64}$/.test(x.roomId)||typeof x.locator!=='string'||!/^M2-[A-Za-z0-9]{8}$/.test(x.locator)||x.revision!==0||typeof x.replayed!=='boolean') throw new Error('DATABASE_RESPONSE_INVALID');return x as unknown as LobbyCreateOutcome;}
function paidOutcome(v:unknown):PaidOutcome {const x=obj(v,['admissionId','matchId','roomId','status','state','revision','sequence','replayed']);if(typeof x.admissionId!=='string'||!/^ha_[a-f0-9]{64}$/.test(x.admissionId)||typeof x.matchId!=='string'||!/^hm_[a-f0-9]{64}$/.test(x.matchId)||typeof x.roomId!=='string'||!/^l_[a-f0-9]{64}$/.test(x.roomId)||x.status!=='STARTED'||x.state!=='COMMITTED'||!Number.isSafeInteger(x.revision)||(x.revision as number)<1||x.sequence!==1||typeof x.replayed!=='boolean') throw new Error('DATABASE_RESPONSE_INVALID');return x as unknown as PaidOutcome;}
const legacySuccessorRepositories=new WeakSet<HuroofSuccessorRepository>();
export function isHuroofLegacyRepository(value:HuroofSuccessorRepository):boolean { return legacySuccessorRepositories.has(value); }
export function registerLegacySuccessorRepositoryForTest(value:HuroofSuccessorRepository):void { legacySuccessorRepositories.add(value); }
export function createHuroofSuccessorRepository(db:SuccessorTransactionBoundary):HuroofSuccessorRepository {
 const repository = {
  async setup(c:AuthenticatedContext,r:SuccessorSetupRequest,state:LobbyState|null):Promise<LobbyCreateOutcome|null> {const value=await db.$transaction(async tx=>one(await tx.$queryRaw<Array<{value:unknown}>>(Prisma.sql`SELECT public.eng03_06_successor_setup(${JSON.stringify(context(c))}::jsonb,${JSON.stringify(r)}::jsonb,${state===null?null:JSON.stringify(state)}::jsonb) AS value`)));if(value===null) {if(state===null)return null;throw new Error('DATABASE_RESPONSE_INVALID');}const result=setupOutcome(value);if(state===null && !result.replayed)throw new Error('DATABASE_RESPONSE_INVALID');return result;},
  async retry(c,r) {const value=await db.$transaction(async tx=>one(await tx.$queryRaw<Array<{value:unknown}>>(Prisma.sql`SELECT public.eng03_06_successor_retry(${JSON.stringify(context(c))}::jsonb,${JSON.stringify(r)}::jsonb) AS value`)));if(value===null)return null;const result=paidOutcome(value);if(!result.replayed)throw new Error('DATABASE_RESPONSE_INVALID');return result;},
  async start(c,r,intent,initial,projections) {return paidOutcome(await db.$transaction(async tx=>one(await tx.$queryRaw<Array<{value:unknown}>>(Prisma.sql`SELECT public.eng03_06_successor_start(${JSON.stringify(context(c))}::jsonb,${JSON.stringify(r)}::jsonb,${JSON.stringify(intent)}::jsonb,${JSON.stringify(initial)}::jsonb,${JSON.stringify(projections)}::jsonb) AS value`))));}
 } as HuroofSuccessorRepository;
 legacySuccessorRepositories.add(repository);return Object.freeze(repository);
}
import { postgresBootstrap, postgresPaidRepository } from './postgres';
import type { QueryBoundary } from './repository';
/** Call with the configured root PrismaClient, never a transaction client. The returned
 * preparation facade offers only fixed reads; each promise resolves after commit. */
export function createHuroofSuccessorAdapters(prisma:PrismaClient) {
 const preparation:QueryBoundary={async query<T>(sql:string,values:readonly unknown[]):Promise<{rows:T[]}> {
  let q:Prisma.Sql;
  if(sql==='SELECT public.eng03_03_policy_read($1) AS value' && values.length===1) q=Prisma.sql`SELECT public.eng03_03_policy_read(${values[0]}) AS value`;
  else if(sql==='SELECT public.eng03_03_identity_find($1,$2) AS value' && values.length===2) q=Prisma.sql`SELECT public.eng03_03_identity_find(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.eng03_03_locator_find($1,$2) AS value' && values.length===2) q=Prisma.sql`SELECT public.eng03_03_locator_find(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.eng03_03_create_identity($1,$2,$3,$4) AS value' && values.length===4) q=Prisma.sql`SELECT public.eng03_03_create_identity(${values[0]},${values[1]},${values[2]},${values[3]}) AS value`;
  else if(sql==='SELECT public.eng03_03_paid_identity($1,$2,$3,$4,$5) AS value' && values.length===5) q=Prisma.sql`SELECT public.eng03_03_paid_identity(${values[0]},${values[1]},${values[2]},${values[3]},${values[4]}) AS value`;
  else if(sql==='SELECT public.eng03_03_lobby_load($1,$2,$3,$4) AS value' && values.length===4) q=Prisma.sql`SELECT public.eng03_03_lobby_load(${values[0]},${values[1]},${values[2]},${values[3]}) AS value`;
  else if(sql==='SELECT public.eng03_03_content_load($1,$2,$3,$4,$5,$6) AS value' && values.length===6) q=Prisma.sql`SELECT public.eng03_03_content_load(${values[0]},${values[1]},${values[2]},${values[3]},${values[4]},${values[5]}) AS value`;
  else if(sql==='SELECT public.eng03_03_custody_policy($1) AS value' && values.length===1) q=Prisma.sql`SELECT public.eng03_03_custody_policy(${values[0]}) AS value`;
  else throw new Error('SUCCESSOR_PREPARATION_QUERY_DENIED');
  const rows=await prisma.$transaction(async tx=>await tx.$queryRaw<T[]>(q));return {rows};
 }};
 const bootstrap=postgresBootstrap(preparation),native=postgresPaidRepository(preparation);
 return {repository:createHuroofSuccessorRepository(prisma),bootstrap:{readActivePolicy:bootstrap.readActivePolicy,resolveIdentity:bootstrap.resolveIdentity},native:{deriveCreateIdentity:native.deriveCreateIdentity,derivePaidIdentity:native.derivePaidIdentity,resolveLocator:native.resolveLocator,loadLobby:native.loadLobby,readLobbyContent:native.readLobbyContent,readCustodyPolicy:native.readCustodyPolicy}};
}

import { privateFixedCall, type FixedOperation, type PrivateQueryEffect } from '../history-rematch/capacity-producer';
import { unavailable, type Admission } from '../history-rematch/capacity-contract';
const privateBoundaries=new WeakMap<object,{repository:HuroofSuccessorRepository;native:unknown}>();
export interface HuroofPrivateBoundary { assertCurrent(context:AuthenticatedContext):Promise<void> }
export function isHuroofPrivateBoundary(value:unknown,repository:HuroofSuccessorRepository,native:unknown): value is HuroofPrivateBoundary {
 const paired=value && typeof value==='object' ? privateBoundaries.get(value) : undefined;
 return !!paired && paired.repository===repository && paired.native===native;
}
export function registerPrivateBoundaryForTest(capacity:object,repository:unknown,native:unknown):void { privateBoundaries.set(capacity,{repository,native}); }
/** A private effect is the qualified dedicated backend transport; this factory never opens
 * a shared Prisma client and exposes only the inspected preparation/commit statements. */
export function createHuroofSuccessorPrivateAdapters(effect:PrivateQueryEffect,admission:Admission) {
 const args=[admission.id,admission.fence.toString()] as const;
 const boundary: HuroofPrivateBoundary=Object.freeze({async assertCurrent(c:AuthenticatedContext) {
  const raw=await privateFixedCall(effect,'readContext',args);
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return unavailable();
  const got=raw as Record<string,unknown>, expected=context(c), keys=Object.keys(expected);
  if(Object.keys(got).length!==keys.length || keys.some(k=>!Object.hasOwn(got,k) || got[k]!==expected[k as keyof typeof expected])) return unavailable();
 }});
 const names:Record<string,FixedOperation>={
  'SELECT public.eng03_03_policy_read($1) AS value':'pgPolicy',
  'SELECT public.eng03_03_identity_find($1,$2) AS value':'pgIdentity',
  'SELECT public.eng03_03_locator_find($1,$2) AS value':'pgLocator',
  'SELECT public.eng03_03_create_identity($1,$2,$3,$4) AS value':'pgCreateIdentity',
  'SELECT public.eng03_03_paid_identity($1,$2,$3,$4,$5) AS value':'pgPaidIdentity',
  'SELECT public.eng03_03_lobby_load($1,$2,$3,$4) AS value':'pgLobby',
  'SELECT public.eng03_03_content_load($1,$2,$3,$4,$5,$6) AS value':'pgContent',
  'SELECT public.eng03_03_custody_policy($1) AS value':'pgCustody',
 };
 const preparation:QueryBoundary={async query<T>(sql:string,values:readonly unknown[]):Promise<{rows:T[]}> {
  const operation=Object.hasOwn(names,sql)?names[sql]:undefined;if(!operation)return unavailable();
  const guarded=operation==='pgPolicy'||operation==='pgLobby'||operation==='pgContent'||operation==='pgCustody';const value=await privateFixedCall(effect,operation,guarded?[...args,...values]:values);return {rows:[{value} as T]};
 }};
 const bootstrap=postgresBootstrap(preparation),native=postgresPaidRepository(preparation);
 const repository: HuroofSuccessorRepository={
  async setup(c:AuthenticatedContext,r:SuccessorSetupRequest,state:LobbyState|null):Promise<LobbyCreateOutcome|null> {
   const value=await privateFixedCall(effect,'pgSetup',[JSON.stringify(context(c)),JSON.stringify(r),state===null?null:JSON.stringify(state)]);
   if(value===null){if(state===null)return null;return unavailable();}const result=setupOutcome(value);if(state===null&&!result.replayed)return unavailable();return result;
  },
  async retry(c,r) {const value=await privateFixedCall(effect,'pgRetry',[JSON.stringify(context(c)),JSON.stringify(r)]);if(value===null)return null;const result=paidOutcome(value);if(!result.replayed)return unavailable();return result;},
  async start(c,r,intent,initial,projections) {return paidOutcome(await privateFixedCall(effect,'pgStart',[JSON.stringify(context(c)),JSON.stringify(r),JSON.stringify(intent),JSON.stringify(initial),JSON.stringify(projections)]));}
 } as HuroofSuccessorRepository;
 const nativeFacade=Object.freeze({deriveCreateIdentity:native.deriveCreateIdentity,derivePaidIdentity:native.derivePaidIdentity,resolveLocator:native.resolveLocator,loadLobby:native.loadLobby,readLobbyContent:native.readLobbyContent,readCustodyPolicy:native.readCustodyPolicy});
 Object.freeze(repository);privateBoundaries.set(boundary,{repository,native:nativeFacade});
 return {boundary,repository,bootstrap:{readActivePolicy:bootstrap.readActivePolicy,resolveIdentity:bootstrap.resolveIdentity},native:nativeFacade};
}
/** Dedicated-client transport for the PG successor capsule. Every fixed call completes
 * its own transaction before returning, preserving the original preparation ordering. */
export function createHuroofPrivateQueryEffect(db:SuccessorTransactionBoundary):PrivateQueryEffect {
 return {async query(sql,values) {
  let q:Prisma.Sql;
  if(sql==='SELECT public.pro262_capacity_begin($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_begin(${values[0]},${values[1]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_context($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_read_context(${values[0]},${values[1]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_spool($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_read_spool(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_assert_spool_request($1,$2::bigint,$3::jsonb) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_assert_spool_request(${values[0]},${values[1]}::bigint,${values[2]}::jsonb) AS value`;
  else if(sql==='SELECT public.pro262_capacity_pg_policy($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_pg_policy(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;
  else if(sql==='SELECT public.eng03_03_identity_find($1,$2) AS value'&&values.length===2)q=Prisma.sql`SELECT public.eng03_03_identity_find(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.eng03_03_locator_find($1,$2) AS value'&&values.length===2)q=Prisma.sql`SELECT public.eng03_03_locator_find(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.eng03_03_create_identity($1,$2,$3,$4) AS value'&&values.length===4)q=Prisma.sql`SELECT public.eng03_03_create_identity(${values[0]},${values[1]},${values[2]},${values[3]}) AS value`;
  else if(sql==='SELECT public.eng03_03_paid_identity($1,$2,$3,$4,$5) AS value'&&values.length===5)q=Prisma.sql`SELECT public.eng03_03_paid_identity(${values[0]},${values[1]},${values[2]},${values[3]},${values[4]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_pg_lobby($1,$2::bigint,$3,$4,$5,$6) AS value'&&values.length===6)q=Prisma.sql`SELECT public.pro262_capacity_pg_lobby(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]},${values[5]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_pg_content($1,$2::bigint,$3,$4,$5,$6,$7,$8) AS value'&&values.length===8)q=Prisma.sql`SELECT public.pro262_capacity_pg_content(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]},${values[5]},${values[6]},${values[7]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_pg_custody($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_pg_custody(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;




  else if(sql==='SELECT public.eng03_06_successor_setup($1::jsonb,$2::jsonb,$3::jsonb) AS value'&&values.length===3)q=Prisma.sql`SELECT public.eng03_06_successor_setup(${values[0]}::jsonb,${values[1]}::jsonb,${values[2]}::jsonb) AS value`;
  else if(sql==='SELECT public.eng03_06_successor_retry($1::jsonb,$2::jsonb) AS value'&&values.length===2)q=Prisma.sql`SELECT public.eng03_06_successor_retry(${values[0]}::jsonb,${values[1]}::jsonb) AS value`;
  else if(sql==='SELECT public.eng03_06_successor_start($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS value'&&values.length===5)q=Prisma.sql`SELECT public.eng03_06_successor_start(${values[0]}::jsonb,${values[1]}::jsonb,${values[2]}::jsonb,${values[3]}::jsonb,${values[4]}::jsonb) AS value`;
  else return unavailable();
  return db.$transaction(async tx=>await tx.$queryRaw<Array<{value:unknown}>>(q));
 }};
}
