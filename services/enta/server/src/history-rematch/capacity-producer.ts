import { unavailable, missReceipt, type MissReceipt } from './capacity-contract';

/** Exact SQL statements allowed inside a separately qualified private capsule.
 * This module does not open a client or grant capability by itself. */
const statements = Object.freeze({
  prepareControl: ['SELECT public.pro262_capacity_control_prepare($1,$2,$3::jsonb) AS value',3],
  registerControl: ['SELECT public.pro262_capacity_register_control($1,$2::jsonb) AS value',2],
  prepareConnection: ['SELECT public.pro262_capacity_prepare_connection($1,$2) AS value',2],
  reserveLaunch: ['SELECT public.pro262_capacity_reserve_launch($1,$2) AS value',2],
  observeConnection: ['SELECT public.pro262_capacity_observe_connection($1,$2,$3,$4::jsonb,$5::bytea) AS value',5],
  acceptClosedScope: ['SELECT public.pro262_capacity_accept_closed_scope($1,$2,$3::jsonb,$4::bytea) AS value',4],
  readClosedScopeLimit: ['SELECT public.pro262_capacity_read_closed_scope_limit($1) AS value',1],
  readObserverInputLimit: ['SELECT public.pro262_capacity_read_observer_input_limit() AS value',0],
  readCleanupLimit: ['SELECT public.pro262_capacity_read_cleanup_limit($1,$2,$3::bigint) AS value',3],
  registerReplay: ['SELECT public.pro262_capacity_register_replay($1,$2,$3::jsonb) AS value',3],
  registerIssuance: ['SELECT public.pro262_capacity_register_issuance($1,$2::jsonb) AS value',2],
  issue: ['SELECT public.pro262_capacity_issue($1) AS value',1],
  importApproval: ['SELECT public.pro262_capacity_import($1) AS value',1],
  findQualification: ['SELECT public.pro262_capacity_find_qualification($1) AS value',1],
  spoolCommit: ['SELECT public.pro262_capacity_spool_commit($1,$2::bytea) AS value',2],
  replayProbe: ['SELECT public.pro262_capacity_replay_probe($1,$2) AS value',2],
  readMiss: ['SELECT public.pro262_capacity_read_miss($1) AS value',1],
  readAdmission: ['SELECT public.pro262_capacity_read_admission($1,$2::bigint) AS value',2],
  readOutcome: ['SELECT public.pro262_capacity_read_outcome($1,$2::bigint) AS value',2],
  readIssued: ['SELECT public.pro262_capacity_read_issued($1) AS value',1],
  readReplayProfile: ['SELECT public.pro262_capacity_read_replay_profile($1) AS value',1],
  quarantineControl: ['SELECT public.pro262_capacity_quarantine_control($1) AS value',1],
  readCleanup: ['SELECT public.pro262_capacity_read_cleanup($1,$2::bigint,$3) AS value',3],
  quarantine: ['SELECT public.pro262_capacity_quarantine($1,$2::bigint) AS value',2],
  release: ['SELECT public.pro262_capacity_release($1,$2::bigint,$3) AS value',3],
  releaseControl: ['SELECT public.pro262_capacity_release_control($1,$2,$3) AS value',3],
  publishCleanup: ['SELECT public.pro262_capacity_accept_cleanup($1,$2::bigint,$3,$4,$5::jsonb,$6::bytea) AS value',6],
  publishReplayCleanup: ['SELECT public.pro262_capacity_accept_replay_cleanup($1,$2,$3,$4::jsonb,$5::bytea) AS value',5],
  publishControlCleanup: ['SELECT public.pro262_capacity_accept_control_cleanup($1,$2,$3,$4::jsonb,$5::bytea) AS value',5],
  readSpool: ['SELECT public.pro262_capacity_read_spool($1,$2::bigint,$3) AS value',3],
  begin: ['SELECT public.pro262_capacity_begin($1,$2::bigint) AS value',2],
  readContext: ['SELECT public.pro262_capacity_read_context($1,$2::bigint) AS value',2],
  assertSpoolRequest: ['SELECT public.pro262_capacity_assert_spool_request($1,$2::bigint,$3::jsonb) AS value',3],
  entaRetry: ['SELECT public.e3_comp_retry($1,$2,$3,$4::jsonb) AS value',4],
  entaRetainedCommit: ['SELECT public.e3_comp_retained_commit($1,$2,$3,$4::jsonb,$5) AS value',5],
  entaWallet: ['SELECT public.int6_enta_lock_wallet($1,$2,$3) AS value',3],
  entaParent: ['SELECT public.pro262_capacity_enta_parent($1,$2::bigint,$3,$4,$5,$6::jsonb) AS value',6],
  entaCatalog: ['SELECT public.pro262_capacity_enta_catalog($1,$2::bigint,$3,$4,$5,$6) AS value',6],
  entaExposure: ['SELECT public.pro262_capacity_enta_exposure($1,$2::bigint,$3,$4,$5,$6,$7,$8,$9) AS value',9],
  entaNative4Commit: ['SELECT public.e3_comp_native4_commit($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8) AS value',8],
  pgPolicy: ['SELECT public.pro262_capacity_pg_policy($1,$2::bigint,$3) AS value',3],
  pgIdentity: ['SELECT public.eng03_03_identity_find($1,$2) AS value',2],
  pgLocator: ['SELECT public.eng03_03_locator_find($1,$2) AS value',2],
  pgCreateIdentity: ['SELECT public.eng03_03_create_identity($1,$2,$3,$4) AS value',4],
  pgPaidIdentity: ['SELECT public.eng03_03_paid_identity($1,$2,$3,$4,$5) AS value',5],
  pgLobby: ['SELECT public.pro262_capacity_pg_lobby($1,$2::bigint,$3,$4,$5,$6) AS value',6],
  pgContent: ['SELECT public.pro262_capacity_pg_content($1,$2::bigint,$3,$4,$5,$6,$7,$8) AS value',8],
  pgCustody: ['SELECT public.pro262_capacity_pg_custody($1,$2::bigint,$3) AS value',3],
  pgSetup: ['SELECT public.eng03_06_successor_setup($1::jsonb,$2::jsonb,$3::jsonb) AS value',3],
  pgRetry: ['SELECT public.eng03_06_successor_retry($1::jsonb,$2::jsonb) AS value',2],
  pgStart: ['SELECT public.eng03_06_successor_start($1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb) AS value',5],
  claimObserverInput: ['SELECT public.pro262_capacity_claim_observer_input($1,$2,$3) AS value',3],
  acceptInstallObservation: ['SELECT public.pro262_capacity_accept_install_observation($1,$2,$3,$4::jsonb,$5::bytea) AS value',5],
} as const);
export type FixedOperation = keyof typeof statements;
export class PrivateCommitUncertain extends Error {
  constructor(readonly code:'08006'|'08007') { super('COMMIT_UNKNOWN'); this.name='PrivateCommitUncertain'; }
}
export interface PrivateQueryEffect { query(statement: string, parameters: readonly unknown[]): Promise<readonly { value: unknown }[]> }
/** Internal to the admitted process; caller can select only a source-pinned statement. */
export async function privateFixedCall(effect: PrivateQueryEffect, operation: FixedOperation, parameters: readonly unknown[]): Promise<unknown> {
  if (!Object.hasOwn(statements, operation)) return unavailable();
  const [sql, arity] = statements[operation];
  if (!Array.isArray(parameters) || parameters.length !== arity) return unavailable();
  try {
    const rows = await effect.query(sql, parameters);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || !Object.hasOwn(rows[0], 'value')) return unavailable();
    return rows[0].value;
  } catch (error) {
    // Retain only the two fixed connection states needed for commit reconciliation.
    const code=error && typeof error==='object' && 'code' in error ? (error as {code?:unknown}).code : undefined;
    if (code==='08006' || code==='08007') throw new PrivateCommitUncertain(code);
    // Driver messages can include query input. Never return/log them across the boundary.
    return unavailable();
  }
}
/** The underlying SQL function executes the original retry and creates a protected miss.
 * An effect is the private SQL transport only; it cannot select a statement. */
export async function protectedReplayProbe(effect: PrivateQueryEffect, replayId: string, spoolId: string): Promise<{ kind: 'OUTCOME'; outcome: unknown } | { kind: 'MISS'; receiptId: string }> {
  if (!replayId || !spoolId) return unavailable();
  const value=await privateFixedCall(effect,'replayProbe',[replayId,spoolId]);
  if (!value || typeof value!=='object' || Array.isArray(value)) return unavailable();
  const row=value as Record<string,unknown>, keys=Object.keys(row);
  const kind=row.kind;
  if (kind==='MISS' && keys.length===2 && Object.hasOwn(row,'receiptId')) {
    const receiptId=row.receiptId;
    if (typeof receiptId!=='string' || receiptId!==replayId) return unavailable();
    return Object.freeze({kind,receiptId});
  }
  if (kind==='OUTCOME' && keys.length===2 && Object.hasOwn(row,'outcome')) return Object.freeze({kind,outcome:row.outcome});
  return unavailable();
}
export async function protectedSpoolCommit(effect: PrivateQueryEffect, replayId: string, body: Uint8Array): Promise<string> {
  if (!replayId || !(body instanceof Uint8Array)) return unavailable();
  const value=await privateFixedCall(effect,'spoolCommit',[replayId,Buffer.from(body)]);
  if (typeof value!=='string' || !/^[a-f0-9]{64}$/.test(value)) return unavailable();
  return value;
}

export async function protectedReadMiss(effect: PrivateQueryEffect, replayId: string): Promise<MissReceipt> {
  if (!replayId) return unavailable();
  const result=missReceipt(await privateFixedCall(effect,'readMiss',[replayId]));
  if (result.id!==replayId || result.replay!==replayId) return unavailable();
  return result;
}

import { randomBytes } from 'node:crypto';
import { parseRoundStart } from '../rounds/validation';
import { productionFormatPolicy, selectRoundPins, validateFormatCatalog } from '../rounds/selection';
import type { Exposure, FormatCatalog, ExecutionFormat } from '../rounds/types';
import { EntaError, fail } from '../gameplay/types';
import { parseExternalSuccessor, type ExternalSuccessorRequest, type SuccessorOutcome } from './successor';
import { validateSuccessorOutcome } from './successor-postgres';
import { admission as captureAdmission, spoolRef, type Admission, type SpoolRef } from './capacity-contract';

/** Real retained/native4 successor algorithm running only on the private fixed-query effect.
 * Transaction/session/process supervision is supplied by the separately qualified capsule. */
export class EntaSuccessorCapsule {
  private consumed=false;
  constructor(private readonly effect: PrivateQueryEffect) {}
  async executeOne(rawAdmission: Admission, rawSpool: SpoolRef): Promise<SuccessorOutcome> {
    return this.execute(rawAdmission,rawSpool,true);
  }
  async executeAfterCommittedBegin(rawAdmission: Admission, rawSpool: SpoolRef): Promise<SuccessorOutcome> {
    return this.execute(rawAdmission,rawSpool,false);
  }
  private async execute(rawAdmission: Admission, rawSpool: SpoolRef, start: boolean): Promise<SuccessorOutcome> {
    if (this.consumed) return unavailable();
    this.consumed=true;
    const a=captureAdmission(rawAdmission), spool=spoolRef(rawSpool);
    if (a.subject.operation!=='ENTA_SUCCESSOR') return unavailable();
    const args=[a.id,a.fence.toString()] as const;
    if(start && await privateFixedCall(this.effect,'begin',args)!==null)return unavailable();
    const bytes=await privateFixedCall(this.effect,'readSpool',[...args,spool.id]);
    if (!(bytes instanceof Uint8Array)) return unavailable();
    let parsed: ExternalSuccessorRequest;
    try { parsed=parseExternalSuccessor(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))); }
    catch { return unavailable(); }
    const asserted=await privateFixedCall(this.effect,'assertSpoolRequest',[...args,JSON.stringify(parsed)]);
    if (asserted!==null) return unavailable();
    const rawContext=await privateFixedCall(this.effect,'readContext',args);
    if (!rawContext || typeof rawContext!=='object' || Array.isArray(rawContext)) return unavailable();
    const context=rawContext as Record<string,unknown>;
    const keys=['namespace','projectId','uid','identityId','policyRevision','policyHash'];
    if (Object.keys(context).length!==keys.length || keys.some(k=>!Object.hasOwn(context,k) || typeof context[k]!=='string' || !context[k]) ||
        context.namespace!==a.subject.namespace || context.projectId!==a.subject.project || context.identityId!==a.subject.owner) return unavailable();
    const ns=context.namespace as string, project=context.projectId as string, uid=context.uid as string, external=JSON.stringify(parsed);
    const prior=await privateFixedCall(this.effect,'entaRetry',[ns,project,uid,external]);
    if (prior!==null) return validateSuccessorOutcome(prior,parsed,true);
    if (parsed.profile.physicalProtocol!==4) {
      const seed=randomBytes(32).toString('hex');
      return validateSuccessorOutcome(await privateFixedCall(this.effect,'entaRetainedCommit',[ns,project,uid,external,seed]),parsed,false);
    }
    const format=parsed.profile.format as ExecutionFormat;
    const native=parseRoundStart({requestKey:parsed.requestKey,logicalMatchId:parsed.logicalMatchId,setup:parsed.setup},format);
    const wallet=await privateFixedCall(this.effect,'entaWallet',[ns,project,uid]);
    if (!wallet || typeof wallet!=='object' || Array.isArray(wallet)) return unavailable();
    const w=wallet as Record<string,unknown>;
    if (typeof w.debt!=='string' || typeof w.available!=='string' || !/^\d+$/.test(w.debt) || !/^\d+$/.test(w.available)) return unavailable();
    if (BigInt(w.debt)>0n) return fail(409,'WALLET_DEBT_BLOCKS_START');
    if (BigInt(w.available)<1n) return fail(402,'INSUFFICIENT_CREDIT');
    await privateFixedCall(this.effect,'entaParent',[...args,ns,project,uid,external]);
    const catalog=await privateFixedCall(this.effect,'entaCatalog',[...args,ns,project,uid,format]) as FormatCatalog;
    validateFormatCatalog(catalog); productionFormatPolicy(catalog);
    const exposure=format==='MIXED_BOARD'?[]:await privateFixedCall(this.effect,'entaExposure',[...args,ns,project,uid,format,native.setup.categories[0].key,catalog.formatReleaseId,catalog.formatRoot]) as Exposure[];
    const selected=selectRoundPins(native,catalog,exposure);
    const saved=await privateFixedCall(this.effect,'entaNative4Commit',[ns,project,uid,external,JSON.stringify(native),JSON.stringify(selected.intent),JSON.stringify(selected.pins),catalog.receiptId]);
    return validateSuccessorOutcome(saved,parsed,false);
  }
}

import { Prisma } from '@prisma/client';
import type { EntaSuccessorDatabase } from './successor-postgres';
/** The begin transition commits separately, then the genuine Enta selection/commit runs
 * inside one dedicated database transaction. No caller-supplied transaction callback. */
export class EntaDedicatedCapsule {
 private consumed=false;
 constructor(private readonly db:EntaSuccessorDatabase) {}
 async executeOne(admission:Admission,spool:SpoolRef):Promise<SuccessorOutcome> {
  if(this.consumed)return unavailable();this.consumed=true;
  const a=captureAdmission(admission),s=spoolRef(spool);
  const beginEffect:PrivateQueryEffect={query:async(sql,values)=>{
   if(sql!=='SELECT public.pro262_capacity_begin($1,$2::bigint) AS value'||values.length!==2)return unavailable();
   return this.db.$transaction(async tx=>await tx.$queryRaw<Array<{value:unknown}>>(Prisma.sql`SELECT public.pro262_capacity_begin(${values[0]},${values[1]}::bigint) AS value`));
  }};
  if(await privateFixedCall(beginEffect,'begin',[a.id,a.fence.toString()])!==null)return unavailable();
  try { return await this.db.$transaction(async tx=>{
   const effect:PrivateQueryEffect={query:async(sql,values)=>{
    let q:Prisma.Sql;
    if(sql==='SELECT public.pro262_capacity_read_spool($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_read_spool(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;
    else if(sql==='SELECT public.pro262_capacity_assert_spool_request($1,$2::bigint,$3::jsonb) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_assert_spool_request(${values[0]},${values[1]}::bigint,${values[2]}::jsonb) AS value`;
    else if(sql==='SELECT public.pro262_capacity_read_context($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_read_context(${values[0]},${values[1]}::bigint) AS value`;
    else if(sql==='SELECT public.e3_comp_retry($1,$2,$3,$4::jsonb) AS value'&&values.length===4)q=Prisma.sql`SELECT public.e3_comp_retry(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb) AS value`;
    else if(sql==='SELECT public.e3_comp_retained_commit($1,$2,$3,$4::jsonb,$5) AS value'&&values.length===5)q=Prisma.sql`SELECT public.e3_comp_retained_commit(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}) AS value`;
    else if(sql==='SELECT public.pro262_capacity_enta_parent($1,$2::bigint,$3,$4,$5,$6::jsonb) AS value'&&values.length===6)q=Prisma.sql`SELECT public.pro262_capacity_enta_parent(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]},${values[5]}::jsonb) AS value`;
    else if(sql==='SELECT public.pro262_capacity_enta_catalog($1,$2::bigint,$3,$4,$5,$6) AS value'&&values.length===6)q=Prisma.sql`SELECT public.pro262_capacity_enta_catalog(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]},${values[5]}) AS value`;
    else if(sql==='SELECT public.pro262_capacity_enta_exposure($1,$2::bigint,$3,$4,$5,$6,$7,$8,$9) AS value'&&values.length===9)q=Prisma.sql`SELECT public.pro262_capacity_enta_exposure(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]},${values[5]},${values[6]},${values[7]},${values[8]}) AS value`;

    else if(sql==='SELECT public.int6_enta_lock_wallet($1,$2,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.int6_enta_lock_wallet(${values[0]},${values[1]},${values[2]}) AS value`;



    else if(sql==='SELECT public.e3_comp_native4_commit($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8) AS value'&&values.length===8)q=Prisma.sql`SELECT public.e3_comp_native4_commit(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}::jsonb,${values[5]}::jsonb,${values[6]}::jsonb,${values[7]}) AS value`;
    else return unavailable();
    return tx.$queryRaw<Array<{value:unknown}>>(q);
   }};
   return new EntaSuccessorCapsule(effect).executeAfterCommittedBegin(a,s);
  },{maxWait:5000,timeout:20000}); } catch(error) {
   if(error instanceof PrivateCommitUncertain || error instanceof EntaError)throw error;
   const code=error && typeof error==='object' && 'code' in error ? (error as {code?:unknown}).code : undefined;
   if(code==='08006'||code==='08007')throw new PrivateCommitUncertain(code);
   return unavailable();
  }
 }
}
/** Fixed private transport. Each call commits independently; caller must supply the
 * separately qualified dedicated client for the relevant capability role. */
const capacityRoleEffects=new WeakSet<PrivateQueryEffect>();
export function isCapacityRoleEffect(value:unknown):value is PrivateQueryEffect {return !!value && typeof value==='object' && capacityRoleEffects.has(value as PrivateQueryEffect);}
export function createCapacityRoleEffect(db:EntaSuccessorDatabase):PrivateQueryEffect {
 const effect:PrivateQueryEffect = {async query(sql,values){
  let q:Prisma.Sql;
  if(sql==='SELECT public.pro262_capacity_control_prepare($1,$2,$3::jsonb) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_control_prepare(${values[0]},${values[1]},${values[2]}::jsonb) AS value`;
  else if(sql==='SELECT public.pro262_capacity_register_control($1,$2::jsonb) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_register_control(${values[0]},${values[1]}::jsonb) AS value`;
  else if(sql==='SELECT public.pro262_capacity_prepare_connection($1,$2) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_prepare_connection(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_reserve_launch($1,$2) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_reserve_launch(${values[0]},${values[1]}) AS value`;


  else if(sql==='SELECT public.pro262_capacity_read_closed_scope_limit($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_read_closed_scope_limit(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_observer_input_limit() AS value'&&values.length===0)q=Prisma.sql`SELECT public.pro262_capacity_read_observer_input_limit() AS value`;
  else if(sql==='SELECT public.pro262_capacity_claim_observer_input($1,$2,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_claim_observer_input(${values[0]},${values[1]},${values[2]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_accept_install_observation($1,$2,$3,$4::jsonb,$5::bytea) AS value'&&values.length===5)q=Prisma.sql`SELECT public.pro262_capacity_accept_install_observation(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_observe_connection($1,$2,$3,$4::jsonb,$5::bytea) AS value'&&values.length===5)q=Prisma.sql`SELECT public.pro262_capacity_observe_connection(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_accept_closed_scope($1,$2,$3::jsonb,$4::bytea) AS value'&&values.length===4)q=Prisma.sql`SELECT public.pro262_capacity_accept_closed_scope(${values[0]},${values[1]},${values[2]}::jsonb,${values[3]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_accept_cleanup($1,$2::bigint,$3,$4,$5::jsonb,$6::bytea) AS value'&&values.length===6)q=Prisma.sql`SELECT public.pro262_capacity_accept_cleanup(${values[0]},${values[1]}::bigint,${values[2]},${values[3]},${values[4]}::jsonb,${values[5]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_accept_replay_cleanup($1,$2,$3,$4::jsonb,$5::bytea) AS value'&&values.length===5)q=Prisma.sql`SELECT public.pro262_capacity_accept_replay_cleanup(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_accept_control_cleanup($1,$2,$3,$4::jsonb,$5::bytea) AS value'&&values.length===5)q=Prisma.sql`SELECT public.pro262_capacity_accept_control_cleanup(${values[0]},${values[1]},${values[2]},${values[3]}::jsonb,${values[4]}::bytea) AS value`;

  else if(sql==='SELECT public.pro262_capacity_read_cleanup_limit($1,$2,$3::bigint) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_read_cleanup_limit(${values[0]},${values[1]},${values[2]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_register_replay($1,$2,$3::jsonb) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_register_replay(${values[0]},${values[1]},${values[2]}::jsonb) AS value`;
  else if(sql==='SELECT public.pro262_capacity_spool_commit($1,$2::bytea) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_spool_commit(${values[0]},${values[1]}::bytea) AS value`;
  else if(sql==='SELECT public.pro262_capacity_replay_probe($1,$2) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_replay_probe(${values[0]},${values[1]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_miss($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_read_miss(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_replay_profile($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_read_replay_profile(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_register_issuance($1,$2::jsonb) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_register_issuance(${values[0]},${values[1]}::jsonb) AS value`;
  else if(sql==='SELECT public.pro262_capacity_issue($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_issue(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_import($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_import(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_find_qualification($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_find_qualification(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_issued($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_read_issued(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_admission($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_read_admission(${values[0]},${values[1]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_outcome($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_read_outcome(${values[0]},${values[1]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_read_cleanup($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_read_cleanup(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_quarantine($1,$2::bigint) AS value'&&values.length===2)q=Prisma.sql`SELECT public.pro262_capacity_quarantine(${values[0]},${values[1]}::bigint) AS value`;
  else if(sql==='SELECT public.pro262_capacity_quarantine_control($1) AS value'&&values.length===1)q=Prisma.sql`SELECT public.pro262_capacity_quarantine_control(${values[0]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_release($1,$2::bigint,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_release(${values[0]},${values[1]}::bigint,${values[2]}) AS value`;
  else if(sql==='SELECT public.pro262_capacity_release_control($1,$2,$3) AS value'&&values.length===3)q=Prisma.sql`SELECT public.pro262_capacity_release_control(${values[0]},${values[1]},${values[2]}) AS value`;



  else return unavailable();
  return db.$transaction(async tx=>await tx.$queryRaw<Array<{value:unknown}>>(q));
 }};
 capacityRoleEffects.add(effect);return Object.freeze(effect);
}
