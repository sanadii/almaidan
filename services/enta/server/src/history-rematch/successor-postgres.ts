import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Principal } from '../identity';
import { fail } from '../gameplay/types';
import { parseRoundStart } from '../rounds/validation';
import { productionFormatPolicy, selectRoundPins, validateFormatCatalog } from '../rounds/selection';
import type { Exposure, FormatCatalog, ExecutionFormat } from '../rounds/types';
import type { EntaSuccessorRepository, ExternalSuccessorRequest, SuccessorOutcome } from './successor';

const retryOnlyRepositories = new WeakSet<EntaSuccessorRepository>();
/** Only the closed repository below may back the parsed-input legacy entry. */
export function isRetryOnlySuccessorRepository(value: EntaSuccessorRepository): boolean { return retryOnlyRepositories.has(value); }
export type EntaSuccessorDatabase = Pick<PrismaClient, '$transaction'>;
export interface SuccessorConfig { namespaceId: string; firebaseProjectId: string }
export function validateSuccessorOutcome(value: unknown, request: ExternalSuccessorRequest, retry: boolean): SuccessorOutcome {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(503,'ENTA_UNAVAILABLE');
 const r=value as Record<string,unknown>, keys=['gameId','admissionId','physicalProtocol','envelopeVersion','e3Protocol','idempotent'];
 if (Object.keys(r).length!==keys.length || keys.some(k=>!Object.hasOwn(r,k)) || typeof r.gameId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.gameId) || typeof r.admissionId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.admissionId) || r.physicalProtocol!==request.profile.physicalProtocol || r.envelopeVersion!==6 || r.e3Protocol!==1 || typeof r.idempotent!=='boolean' || (retry && r.idempotent!==true) || (request.profile.physicalProtocol>=4 && r.gameId!==request.logicalMatchId)) return fail(503,'ENTA_UNAVAILABLE');
 return r as unknown as SuccessorOutcome;
}
export function createEntaSuccessorRepository(db: EntaSuccessorDatabase, config: SuccessorConfig): EntaSuccessorRepository {
 const ns=config.namespaceId, project=config.firebaseProjectId;
 if (!ns || !project) throw new Error('PROJECT_BINDING_MISMATCH');
 const repository: EntaSuccessorRepository = { async compose(principal: Principal, request: ExternalSuccessorRequest): Promise<SuccessorOutcome> {
  if (principal.projectId!==project || !principal.verifiedAccount || principal.anonymous || !principal.uid || !principal.email) return fail(403,'VERIFIED_ACCOUNT_REQUIRED');
  const uid=principal.uid, externalJson=JSON.stringify(request);
  return db.$transaction(async tx=>{
   const one=async<T>(q:Prisma.Sql):Promise<T>=>{const rows=await tx.$queryRaw<Array<{value:T}>>(q);if(rows.length!==1 || !rows[0] || !Object.hasOwn(rows[0],'value')) return fail(503,'ENTA_UNAVAILABLE');return rows[0].value;};
   const prior=await one<unknown>(Prisma.sql`SELECT public.e3_comp_retry(${ns},${project},${uid},${externalJson}::jsonb) AS value`);
   if (prior!==null) return validateSuccessorOutcome(prior,request,true);
   // Whole-wrapper capacity authority is not yet represented; preserve sealed retries.
   return fail(503,'E3_CAPACITY_UNAVAILABLE');
   if (request.profile.physicalProtocol !== 4) {
    const seed=randomBytes(32).toString('hex');
    const saved=await one<unknown>(Prisma.sql`SELECT public.e3_comp_retained_commit(${ns},${project},${uid},${externalJson}::jsonb,${seed}) AS value`);
    return validateSuccessorOutcome(saved,request,false);
   }
   const format=request.profile.format as ExecutionFormat;
   const native=parseRoundStart({requestKey:request.requestKey,logicalMatchId:request.logicalMatchId,setup:request.setup},format);
   const wallet=await one<{identityId:string;available:string;debt:string}>(Prisma.sql`SELECT public.int6_enta_lock_wallet(${ns},${project},${uid}) AS value`);
   if (BigInt(wallet.debt)>0n) return fail(409,'WALLET_DEBT_BLOCKS_START'); if (BigInt(wallet.available)<1n) return fail(402,'INSUFFICIENT_CREDIT');
   await one<unknown>(Prisma.sql`SELECT public.e3_comp_parent(${ns},${project},${uid},${externalJson}::jsonb) AS value`);
   const catalog=await one<FormatCatalog>(Prisma.sql`SELECT public.int8_catalog(${ns},${project},${uid},${format}) AS value`);
   validateFormatCatalog(catalog); productionFormatPolicy(catalog);
   const exposure=format==='MIXED_BOARD'?[]:await one<Exposure[]>(Prisma.sql`SELECT public.e3_comp_exposure_frontier(${ns},${project},${uid},${format},${native.setup.categories[0].key},${catalog.formatReleaseId},${catalog.formatRoot}) AS value`);
   const selected=selectRoundPins(native,catalog,exposure), requestJson=JSON.stringify(native), intentJson=JSON.stringify(selected.intent), pinsJson=JSON.stringify(selected.pins);
   const saved=await one<unknown>(Prisma.sql`SELECT public.e3_comp_native4_commit(${ns},${project},${uid},${externalJson}::jsonb,${requestJson}::jsonb,${intentJson}::jsonb,${pinsJson}::jsonb,${catalog.receiptId}) AS value`);
   return validateSuccessorOutcome(saved,request,false);
  },{maxWait:5000,timeout:20000});
 }};
 retryOnlyRepositories.add(repository);
 return Object.freeze(repository);
}
