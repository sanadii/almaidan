import { checkedResourceTotal, ReservationLedger, type AdmissionIdentity, type ResourceEnvelope } from './history-archive-resource';
import { parseHistoryTerminalDto, type HistoryTerminalDto } from './history-terminal-dto';

/** Injected boundary is a dedicated, already-authorized session; no client is constructed here. */
export interface PrivateQuery { query<T>(sql: string, parameters: readonly unknown[]): Promise<{ rows: T[] }>; cancel?(identity: Readonly<AdmissionIdentity>): Promise<void> }
export type CleanupStage = 'QUERY_SETTLED' | 'ROLLBACK_DRAINED' | 'PROTOCOL_DRAINED' | 'SESSION_TERMINATED' | 'TERMINATION_VERIFIED';
export interface CleanupBoundary { perform(stage: CleanupStage, identity: Readonly<AdmissionIdentity>): Promise<unknown> }
export interface OwnerRequest { namespace: string; owner: string; policyRevision: string; policyHash: string; matchId: string; resultVersion: string }
export interface TrustedAdmission { identity: AdmissionIdentity; envelope: ResourceEnvelope; expiresAt: number; profile: string; epoch: string }
const strings = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const decimal = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n;
function ownerValues(x: OwnerRequest): readonly string[] {
  const {namespace, owner, policyRevision, policyHash, matchId, resultVersion}=x;
  if (!strings(namespace) || !strings(owner) || !decimal(policyRevision) || typeof policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(policyHash) || typeof matchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(matchId) || !decimal(resultVersion)) throw new Error('RESULT_UNAVAILABLE');
  return [namespace,owner,policyRevision,policyHash,matchId,resultVersion];
}
function row<T>(result: {rows:T[]}): T { if (!result) throw new Error('RESULT_UNAVAILABLE'); const rows=result.rows; if (!Array.isArray(rows) || rows.length !== 1) throw new Error('RESULT_UNAVAILABLE'); return rows[0]; }
function exact(value: unknown, keys: string[]): value is Record<string, unknown> { return !!value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)); }
export function createPrivateArchive(db: PrivateQuery, ledger: ReservationLedger, cleanupBoundary: CleanupBoundary, now:()=>number) {
  async function safeQuery<T>(sql: string, parameters: readonly unknown[]): Promise<{rows:T[]}> { try { return await db.query<T>(sql, parameters); } catch { throw new Error('RESULT_UNAVAILABLE'); } }
  async function cleanup(identity: AdmissionIdentity): Promise<boolean> {
    const stages: CleanupStage[] = ['QUERY_SETTLED','ROLLBACK_DRAINED','PROTOCOL_DRAINED','SESSION_TERMINATED','TERMINATION_VERIFIED'];
    try {
      for(const stage of stages) {
        const v=await cleanupBoundary.perform(stage,{...identity});
        if(!exact(v,['stage','session','fence','done'])) return false;
        const {stage: observedStage,session,fence,done}=v;
        if(observedStage!==stage || session!==identity.session || fence!==identity.fence || done!==true) return false;
      }
      return true;
    } catch { return false; }
  }
  const running = new Map<string, {identity: AdmissionIdentity; closing: boolean; cancellation?: Promise<void>}>();
  let sessionUsed=false;
  function reserve(identity: AdmissionIdentity, envelope: ResourceEnvelope): void {
    if(sessionUsed) throw new Error('RESOURCE_UNAVAILABLE');
    checkedResourceTotal(envelope); ledger.reserve(identity,envelope); sessionUsed=true; begin(identity);
  }
  function begin(identity: AdmissionIdentity): void { running.set(identity.job,{identity,closing:false}); }
  async function finish(identity: AdmissionIdentity): Promise<void> {
    const entry=running.get(identity.job);
    if(!entry) throw new Error('RESOURCE_UNAVAILABLE');
    entry.closing=true; ledger.quarantine(identity.job);
    if(entry.cancellation) { try { await entry.cancellation; } catch { /* cleanup must still establish termination */ } }
    if(await cleanup(identity)) ledger.confirmCleanup(identity);
    running.delete(identity.job);
  }
  async function inventoryCall(boundary: string, admission: TrustedAdmission, sql: string): Promise<unknown> {
    if(typeof boundary!=='string' || !/^[a-f0-9]{64}$/.test(boundary)) throw new Error('INVENTORY_UNAVAILABLE');
    const {identity:inputIdentity,envelope,expiresAt,profile,epoch}=admission;
    if(!inputIdentity) throw new Error('RESOURCE_UNQUALIFIED');
    const {job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}=inputIdentity;
    const identity: AdmissionIdentity={job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}; const time=now();
    if(!strings(job) || !strings(session) || !decimal(fence) || !strings(producer) || !strings(profile) || !strings(epoch) || identityProfile!==profile || identityEpoch!==epoch || !Number.isSafeInteger(time) || !Number.isSafeInteger(expiresAt) || expiresAt<=time) throw new Error('RESOURCE_UNQUALIFIED');
    reserve(identity,envelope);
    try { return row(await safeQuery<{value:unknown}>(sql,[boundary,job,fence])).value; }
    catch { throw new Error('RESULT_UNAVAILABLE'); }
    finally { await finish(identity); }
  }
  return {
    async requestCancel(job: string): Promise<void> {
      if(!strings(job)) throw new Error('RESOURCE_UNAVAILABLE');
      const entry=running.get(job);
      if(!entry || entry.closing) throw new Error('RESOURCE_UNAVAILABLE');
      ledger.quarantine(job);
      if(!entry.cancellation) {
        const cancel=db.cancel;
        entry.cancellation=cancel ? Promise.resolve().then(()=>cancel.call(db,{...entry.identity})) : Promise.reject(new Error('RESOURCE_UNAVAILABLE'));
      }
      try { await entry.cancellation; } catch { throw new Error('RESOURCE_UNAVAILABLE'); }
    },
    async preflight(request: OwnerRequest, admission: TrustedAdmission): Promise<{job:string; bytes:string; resultHash:string}> {
      const args=ownerValues(request); const {identity:inputIdentity,envelope,expiresAt,profile,epoch}=admission;
      if(!inputIdentity) throw new Error('RESOURCE_UNQUALIFIED');
      const {job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}=inputIdentity;
      const identity: AdmissionIdentity={job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}; const time=now();
      if(!strings(job) || !strings(session) || !decimal(fence) || !strings(producer) || !strings(profile) || !strings(epoch) || identityProfile!==profile || identityEpoch!==epoch || !Number.isSafeInteger(time) || !Number.isSafeInteger(expiresAt) || expiresAt<=time) throw new Error('RESOURCE_UNQUALIFIED');
      reserve(identity,envelope);
      try {
        const value=row(await safeQuery<{value:unknown}>('SELECT public.pro311_archive_preflight($1,$2,$3,$4,$5,$6::bigint,$7,$8) AS value',[...args,job,fence])).value;
        if (!exact(value,['job','bytes','resultHash'])) throw new Error('RESULT_UNAVAILABLE');
        const {job:returnedJob,bytes,resultHash}=value;
        if (typeof returnedJob!=='string' || !/^[a-f0-9]{64}$/.test(returnedJob) || typeof bytes!=='string' || !/^(0|[1-9][0-9]{0,18})$/.test(bytes) || BigInt(bytes)>9223372036854775807n || typeof resultHash!=='string' || !/^[a-f0-9]{64}$/.test(resultHash)) throw new Error('RESULT_UNAVAILABLE');
        return {job:returnedJob,bytes,resultHash};
      } catch { throw new Error('RESULT_UNAVAILABLE'); } finally {
        await finish(identity);
      }
    },
    async derive(request: OwnerRequest, admission: TrustedAdmission): Promise<{status:'COMPLETE'; identity:string}> {
      const args=ownerValues(request); const {identity: inputIdentity,envelope,expiresAt,profile,epoch}=admission;
      if (!inputIdentity) throw new Error('RESOURCE_UNQUALIFIED');
      const {job, profile: identityProfile, producer, epoch: identityEpoch, session, fence}=inputIdentity;
      const identity: AdmissionIdentity={job, profile:identityProfile, producer, epoch:identityEpoch, session, fence};
      const time=now(); if(!identity || !strings(identity.job) || !strings(identity.session) || !decimal(identity.fence) || !strings(identity.producer) || !strings(profile) || !strings(epoch) || identity.profile!==profile || identity.epoch!==epoch || !Number.isSafeInteger(time) || !Number.isSafeInteger(expiresAt) || expiresAt<=time) throw new Error('RESOURCE_UNQUALIFIED');
      reserve(identity,envelope);
      try {
        const value=row(await safeQuery<{value:unknown}>('SELECT public.pro311_archive_derive($1,$2,$3,$4,$5,$6::bigint,$7,$8) AS value',[...args,identity.job,identity.fence])).value;
        if (!exact(value,['status','identity'])) throw new Error('RESULT_UNAVAILABLE');
        const {status,identity:returnedIdentity}=value;
        if(status!=='COMPLETE' || typeof returnedIdentity!=='string' || !/^[a-f0-9]{64}$/.test(returnedIdentity)) throw new Error('RESULT_UNAVAILABLE');
        return {status:'COMPLETE',identity:returnedIdentity};
      } catch { throw new Error('RESULT_UNAVAILABLE'); } finally {
        await finish(identity);
      }
    },
    async read(request: OwnerRequest, admission: TrustedAdmission): Promise<HistoryTerminalDto> {
      const args=ownerValues(request); const {identity:inputIdentity,envelope,expiresAt,profile,epoch}=admission;
      if(!inputIdentity) throw new Error('RESOURCE_UNQUALIFIED');
      const {job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}=inputIdentity;
      const identity: AdmissionIdentity={job,profile:identityProfile,producer,epoch:identityEpoch,session,fence}; const time=now();
      if(!strings(job) || !strings(session) || !decimal(fence) || !strings(producer) || !strings(profile) || !strings(epoch) || identityProfile!==profile || identityEpoch!==epoch || !Number.isSafeInteger(time) || !Number.isSafeInteger(expiresAt) || expiresAt<=time) throw new Error('RESOURCE_UNQUALIFIED');
      reserve(identity,envelope);
      try {
        const value=row(await safeQuery<{value:unknown}>('SELECT public.pro311_archive_read($1,$2,$3,$4,$5,$6::bigint,$7,$8) AS value',[...args,job,fence])).value;
        if (!exact(value,['terminalType','projection'])) throw new Error('RESULT_UNAVAILABLE');
        const {terminalType,projection}=value;
        if(terminalType!=='FINISHED' && terminalType!=='ABANDONED') throw new Error('RESULT_UNAVAILABLE');
        return parseHistoryTerminalDto(terminalType,projection,args[4],args[5]);
      } catch { throw new Error('RESULT_UNAVAILABLE'); } finally { await finish(identity); }
    },
    async inventoryCreate(boundary: string, admission: TrustedAdmission): Promise<string> {
      const value=await inventoryCall(boundary,admission,'SELECT public.pro311_inventory_create($1,$2,$3) AS value');
      if(value!==boundary) throw new Error('INVENTORY_UNAVAILABLE'); return boundary;
    },
    async inventoryFinish(boundary: string, admission: TrustedAdmission): Promise<'COMPLETE'|'INCOMPLETE'> {
      const value=await inventoryCall(boundary,admission,'SELECT public.pro311_inventory_finish($1,$2,$3) AS value');
      if(value!=='COMPLETE' && value!=='INCOMPLETE') throw new Error('INVENTORY_UNAVAILABLE'); return value;
    },
    async status(job: string, admission: TrustedAdmission): Promise<'PENDING'|'DEFERRED_RESOURCE'|'FAULT'|'COMPLETE'> {
      if(typeof job!=='string' || !/^[a-f0-9]{64}$/.test(job)) throw new Error('RESULT_UNAVAILABLE');
      const value=await inventoryCall(job,admission,'SELECT public.pro311_archive_status($1,$2,$3) AS value');
      if(value!=='PENDING' && value!=='DEFERRED_RESOURCE' && value!=='FAULT' && value!=='COMPLETE') throw new Error('RESULT_UNAVAILABLE'); return value;
    },
  };
}
