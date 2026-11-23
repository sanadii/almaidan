import { unavailable, admission as captureAdmission, missReceipt, spoolRef, subject as captureSubject, controlRequest as captureControl, incarnation as captureIncarnation, sameSubject, sameIncarnation, type Admission, type ControlLease, type ControlRequest, type Incarnation, type MissReceipt, type ReplayLease, type SpoolRef, type Subject } from './capacity-contract';
import { OperationLifetime, isSqlSupervisorAuthority, publishInstallObservation, type InstallObservationCapture, type SupervisorAuthority } from './capacity-supervisor';

/** The implementation of these ports is an independently authenticated supervisor boundary.
 * A caller-provided literal MISS, callback boolean or TypeScript type is not authority. */
export interface ProtectedIngress {
  reserveControl(request: ControlRequest): Promise<ControlLease>;
  reserveReplay(control: ControlLease, request: ControlRequest): Promise<ReplayLease>;
  quarantineControl(control: ControlLease): Promise<void>;
  pullOnce(replay: ReplayLease): Promise<SpoolRef>;
  executeReplay(replay: ReplayLease, spool: SpoolRef, request: ControlRequest): Promise<{ kind: 'OUTCOME'; outcome: unknown } | { kind: 'MISS'; receiptId: string }>;
  readProtectedMiss(receiptId: string): Promise<MissReceipt | null>;
  reserveOperation(control: ControlLease, missId: string, spool: SpoolRef): Promise<Admission>;
}
export interface OperationCapsule {
  executeOne(admission: Admission, spool: SpoolRef): Promise<unknown>;
}
function boundedOutcome(operation:ControlRequest['operation'], value:unknown, replay:boolean):Record<string,unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value))return unavailable();
 const row=value as Record<string,unknown>;const exact=(keys:readonly string[])=>Object.keys(row).length===keys.length&&keys.every(k=>Object.hasOwn(row,k));
 if(operation==='ENTA_SUCCESSOR') {
  if(!exact(['gameId','admissionId','physicalProtocol','envelopeVersion','e3Protocol','idempotent']))return unavailable();
  const {gameId,admissionId,physicalProtocol,envelopeVersion,e3Protocol,idempotent}=row;
  if(typeof gameId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(gameId)||typeof admissionId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(admissionId)||![2,3,4,5].includes(physicalProtocol as number)||envelopeVersion!==6||e3Protocol!==1||typeof idempotent!=='boolean'||(replay&&!idempotent))return unavailable();
  return Object.freeze({gameId,admissionId,physicalProtocol,envelopeVersion,e3Protocol,idempotent});
 }
 if(operation==='PG_SETUP') {
  if(!exact(['roomId','locator','revision','replayed']))return unavailable();const {roomId,locator,revision,replayed}=row;
  if(typeof roomId!=='string'||!/^l_[a-f0-9]{64}$/.test(roomId)||typeof locator!=='string'||!/^M2-[A-Za-z0-9]{8}$/.test(locator)||revision!==0||typeof replayed!=='boolean'||(replay&&!replayed))return unavailable();
  return Object.freeze({roomId,locator,revision,replayed});
 }
 if(!exact(['admissionId','matchId','roomId','status','state','revision','sequence','replayed']))return unavailable();
 const {admissionId,matchId,roomId,status,state,revision,sequence,replayed}=row;
 if(typeof admissionId!=='string'||!/^ha_[a-f0-9]{64}$/.test(admissionId)||typeof matchId!=='string'||!/^hm_[a-f0-9]{64}$/.test(matchId)||typeof roomId!=='string'||!/^l_[a-f0-9]{64}$/.test(roomId)||status!=='STARTED'||state!=='COMMITTED'||!Number.isSafeInteger(revision)||(revision as number)<1||sequence!==1||typeof replayed!=='boolean'||(replay&&!replayed))return unavailable();
 return Object.freeze({admissionId,matchId,roomId,status,state,revision,sequence,replayed});
}
/** No input callback is invoked until both protected control and replay leases exist. */
export async function runSuccessor(options: {
  ingress?: SqlProtectedIngress; supervisor?: SupervisorAuthority;
  request: ControlRequest; now: () => number;
}): Promise<Record<string,unknown>> {
  const { ingress, supervisor, now } = options;
  const request = captureControl(options.request);
  if (!(ingress instanceof SqlProtectedIngress) || !isSqlSupervisorAuthority(supervisor)) return unavailable();
  const control = await ingress.reserveControl(request);
  if (!control || !control.id || !control.envelope) return unavailable();
  try {
  const replay = await ingress.reserveReplay(control, request);
  if (!replay || !replay.id || replay.control !== control.id || !replay.envelope) return unavailable();
  const spool = spoolRef(await ingress.pullOnce(replay));
  const outcome = await ingress.executeReplay(replay, spool, request);
  if (outcome.kind === 'OUTCOME') return boundedOutcome(request.operation,outcome.outcome,true);
  if (outcome.kind !== 'MISS' || !outcome.receiptId) return unavailable();
  const rawMiss = await ingress.readProtectedMiss(outcome.receiptId);
  const miss = rawMiss === null ? null : missReceipt(rawMiss);
  if (!miss || miss.id !== outcome.receiptId || miss.replay !== replay.id || miss.requestIdentity !== request.requestIdentity || miss.spool.id !== spool.id ||
      miss.spool.digest !== spool.digest || miss.spool.envelope !== spool.envelope) return unavailable();
  const subject = captureSubject(miss.subject);
  if (subject.namespace !== request.namespace || subject.project !== request.project || subject.owner !== request.owner ||
      subject.route !== request.route || subject.operation !== request.operation) return unavailable();
  const admission = captureAdmission(await ingress.reserveOperation(control, miss.id, spool));
  const lifetime = new OperationLifetime(supervisor, admission, now);
  try {
    await lifetime.begin(subject, admission.incarnation);
    const capsule=await ingress.createCapsule(admission);
    try { await capsule.executeOne(admission, spool); }
    catch(error) { if(!(error instanceof PrivateCommitUncertain))throw error; }
    return boundedOutcome(request.operation,await ingress.readOutcome(admission),false);
  } finally { await lifetime.finish(); }
  } finally { await ingress.quarantineControl(control); }
}
import { createHash } from 'node:crypto';
import { admissionWire, missReceipt as decodeMiss } from './capacity-contract';
import { privateFixedCall, protectedReplayProbe, protectedReadMiss, protectedSpoolCommit, PrivateCommitUncertain, isCapacityRoleEffect, type PrivateQueryEffect } from './capacity-producer';
export interface QualifiedReplayPlan { readonly replayId:string; readonly record:Record<string,unknown>; readonly executor:PrivateQueryEffect; readonly install:InstallObservationCapture }
export interface QualifiedOperationPlan { readonly issuanceKey:string; readonly record:Record<string,unknown>; readonly install:InstallObservationCapture }
/** Implemented only by the separately qualified supervisor/OS boundary. These return
 * actual observed incarnations, never a boolean assertion of authority. */
export interface QualifiedLifecyclePlans {
  replay(control:ControlLease,request:ControlRequest):Promise<QualifiedReplayPlan>;
  operation(control:ControlLease,miss:MissReceipt,spool:SpoolRef):Promise<QualifiedOperationPlan>;
  capsule(admission:Admission):Promise<OperationCapsule>;
  quarantineUncertain(stage:'CONTROL'|'REPLAY'|'OPERATION',identity:string):Promise<void>;
}
export interface SqlIngressConfig {
  readonly controlKey:string; readonly uid:string; readonly holderEnvelope:string; readonly parentEnvelope:string;
  readonly launchEnvelope:string; readonly replayEnvelope:string; readonly storageProof:string; readonly expiry:string;
  readonly parentHost:string; readonly parentBoot:string; readonly parentProcessTree:string;
  readonly expectedReplayPrincipal:string; readonly expectedProducerPrincipal:string;
  readonly allocator:PrivateQueryEffect; readonly supervisor:PrivateQueryEffect; readonly issuer:PrivateQueryEffect;
  readonly input:AsyncIterable<Uint8Array>; readonly lifecycle:QualifiedLifecyclePlans;
}
/** Concrete fixed-SQL ingress. Genuine channels, OS supervision and physical proof remain
 * separately provisioned; constructing this class does not authenticate any of them. */
export class SqlProtectedIngress implements ProtectedIngress {
 private control:ControlLease | undefined;private replayId:string | undefined;private replayExecutor:PrivateQueryEffect | undefined;private pulled=false;private started=false;
 constructor(private readonly config:SqlIngressConfig) {
  const roles=[config.allocator,config.supervisor,config.issuer];
  if(roles.some(x=>!isCapacityRoleEffect(x)) || new Set(roles).size!==roles.length)return unavailable();
 }
 async reserveControl(input:ControlRequest):Promise<ControlLease> {
  if(this.control)return unavailable();const request=captureControl(input),c=this.config;
  if(!c.controlKey || !c.uid || !c.holderEnvelope || !c.parentEnvelope || !c.launchEnvelope || !c.replayEnvelope || !c.storageProof || !c.expiry || !c.parentHost || !c.parentBoot || !c.parentProcessTree || !c.expectedReplayPrincipal || !c.expectedProducerPrincipal || c.expectedReplayPrincipal===c.expectedProducerPrincipal)return unavailable();
  const record={route:request.route,subject:{namespace:request.namespace,project:request.project,owner:request.owner,uid:c.uid,operation:request.operation},requestIdentity:request.requestIdentity,holderEnvelope:c.holderEnvelope,parentEnvelope:c.parentEnvelope,launchEnvelope:c.launchEnvelope,replayEnvelope:c.replayEnvelope,storageProof:c.storageProof,expiry:c.expiry,parentHost:c.parentHost,parentBoot:c.parentBoot,parentProcessTree:c.parentProcessTree,expectedReplayPrincipal:c.expectedReplayPrincipal,expectedProducerPrincipal:c.expectedProducerPrincipal};
  const handle=this.control=Object.freeze({id:c.controlKey,envelope:c.holderEnvelope});
  try {
   if(await privateFixedCall(c.allocator,'prepareControl',['CONTROL_RESERVATION',c.controlKey,JSON.stringify(record)])!==null)return unavailable();
   const id=await privateFixedCall(c.supervisor,'registerControl',[c.controlKey,JSON.stringify(record)]);if(id!==c.controlKey)return unavailable();return handle;
  }
  catch {try {await privateFixedCall(c.supervisor,'quarantineControl',[c.controlKey]);} catch { /* unknown DB state remains occupied */ } await c.lifecycle.quarantineUncertain('CONTROL',c.controlKey);return unavailable();}
 }
 async reserveReplay(control:ControlLease,request:ControlRequest):Promise<ReplayLease> {
  if(!this.control || control.id!==this.control.id || this.replayId)return unavailable();
  let plan:QualifiedReplayPlan | undefined;
  try {
   if(await privateFixedCall(this.config.supervisor,'prepareConnection',[control.id,'REPLAY'])!=='CREATED')return unavailable();
   if(await privateFixedCall(this.config.supervisor,'reserveLaunch',[control.id,'REPLAY'])!=='CREATED')return unavailable();
   plan=await this.config.lifecycle.replay(control,captureControl(request));
   if(!plan || typeof plan.replayId!=='string' || !plan.replayId || !plan.record || typeof plan.record!=='object' || Array.isArray(plan.record) || !isCapacityRoleEffect(plan.executor) || [this.config.allocator,this.config.supervisor,this.config.issuer].includes(plan.executor))return unavailable();
   if(!plan.install || [this.config.supervisor,this.config.issuer,plan.executor].includes(plan.install.publisher))return unavailable();
   await publishInstallObservation(plan.install,control.id,'REPLAY');
   const record=JSON.parse(JSON.stringify(plan.record)) as Record<string,unknown>;
   if(record.replayProofIdentity!==this.config.replayEnvelope)return unavailable();
   const charge={controlKey:control.id,replay:record};
   if(await privateFixedCall(this.config.allocator,'prepareControl',['REPLAY_REGISTRATION',plan.replayId,JSON.stringify(charge)])!==null)return unavailable();
   if(await privateFixedCall(this.config.supervisor,'registerReplay',[plan.replayId,control.id,JSON.stringify(record)])!==plan.replayId)return unavailable();
   this.replayId=plan.replayId;this.replayExecutor=plan.executor;return Object.freeze({id:plan.replayId,control:control.id,envelope:this.config.replayEnvelope});
  } catch {await this.config.lifecycle.quarantineUncertain('REPLAY',plan?.replayId||control.id);return unavailable();}
 }
 async pullOnce(replay:ReplayLease):Promise<SpoolRef> {
  if(this.pulled || !this.replayId || replay.id!==this.replayId)return unavailable();this.pulled=true;
  const raw=await privateFixedCall(this.config.supervisor,'readReplayProfile',[replay.id]);
  if(!raw || typeof raw!=='object' || Array.isArray(raw))return unavailable();
  const p=raw as Record<string,unknown>,keys=['id','proofHash','maxBodyBytes','parentEnvelope'];
  if(Object.keys(p).length!==keys.length || keys.some(k=>!Object.hasOwn(p,k)) || p.id!==this.config.replayEnvelope || p.parentEnvelope!==this.config.parentEnvelope || typeof p.proofHash!=='string' || !/^[a-f0-9]{64}$/.test(p.proofHash) || typeof p.maxBodyBytes!=='string' || !/^[1-9][0-9]*$/.test(p.maxBodyBytes))return unavailable();
  const maximum=BigInt(p.maxBodyBytes);if(maximum>BigInt(Number.MAX_SAFE_INTEGER))return unavailable();
  let size=0n;const chunks:Buffer[]=[];
  for await(const chunk of this.config.input){if(!(chunk instanceof Uint8Array))return unavailable();size+=BigInt(chunk.byteLength);if(size>maximum)return unavailable();chunks.push(Buffer.from(chunk));}
  if(size===0n)return unavailable();const body=Buffer.concat(chunks,Number(size)),digest=createHash('sha256').update(body).digest('hex');
  const id=await protectedSpoolCommit(this.config.supervisor,replay.id,body);
  return Object.freeze({id,digest,envelope:this.config.parentEnvelope});
 }
 async executeReplay(replay:ReplayLease,spool:SpoolRef,_subject:ControlRequest) {if(!this.replayExecutor)return unavailable();return protectedReplayProbe(this.replayExecutor,replay.id,spool.id);}
 async readProtectedMiss(receiptId:string) {return protectedReadMiss(this.config.supervisor,receiptId);}
 async reserveOperation(control:ControlLease,missId:string,rawSpool:SpoolRef):Promise<Admission> {
  if(this.started || !this.control || control.id!==this.control.id)return unavailable();this.started=true;
  const spool=spoolRef(rawSpool),miss=decodeMiss(await this.readProtectedMiss(missId));
  if(miss.replay!==this.replayId || miss.spool.id!==spool.id || miss.spool.digest!==spool.digest || miss.spool.envelope!==spool.envelope)return unavailable();
  let plan:QualifiedOperationPlan | undefined;
  try {
   if(await privateFixedCall(this.config.supervisor,'prepareConnection',[control.id,'PRODUCER'])!=='CREATED')return unavailable();
   if(await privateFixedCall(this.config.supervisor,'reserveLaunch',[control.id,'PRODUCER'])!=='CREATED')return unavailable();
   plan=await this.config.lifecycle.operation(control,miss,spool);
   if(!plan || typeof plan.issuanceKey!=='string' || !plan.issuanceKey || !plan.record || typeof plan.record!=='object' || Array.isArray(plan.record))return unavailable();
   if(!plan.install || [this.config.supervisor,this.config.issuer].includes(plan.install.publisher))return unavailable();
   await publishInstallObservation(plan.install,control.id,'PRODUCER');
   const record=JSON.parse(JSON.stringify(plan.record)) as Record<string,unknown>;
   if(record.replayId!==miss.id || record.spoolDigest!==spool.digest || !sameSubject(captureSubject(record.subject),miss.subject))return unavailable();
   if(await privateFixedCall(this.config.allocator,'prepareControl',['ISSUANCE_REQUEST',plan.issuanceKey,JSON.stringify(record)])!==null)return unavailable();
   if(await privateFixedCall(this.config.supervisor,'registerIssuance',[plan.issuanceKey,JSON.stringify(record)])!==plan.issuanceKey)return unavailable();
   let issued:unknown;
   try {issued=await privateFixedCall(this.config.issuer,'issue',[plan.issuanceKey]);}
   catch(error){if(!(error instanceof PrivateCommitUncertain))throw error;}
   const raw=await privateFixedCall(this.config.supervisor,'readIssued',[plan.issuanceKey]);if(raw===null)return unavailable();
   const result=admissionWire(raw);
   if((issued!==undefined && issued!==result.id) || !sameSubject(result.subject,miss.subject))return unavailable();
   return result;
  } catch {await this.config.lifecycle.quarantineUncertain('OPERATION',plan?.issuanceKey||control.id);return unavailable();}
 }
 async createCapsule(admission:Admission):Promise<OperationCapsule> {return this.config.lifecycle.capsule(captureAdmission(admission));}
 async readOutcome(admission:Admission):Promise<unknown> {const a=captureAdmission(admission);return privateFixedCall(this.config.supervisor,'readOutcome',[a.id,a.fence.toString()]);}
 async quarantineControl(control:ControlLease):Promise<void> {
  if(!this.control || control.id!==this.control.id)return unavailable();
  if(await privateFixedCall(this.config.supervisor,'quarantineControl',[control.id])!==null)return unavailable();
 }
}

import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { principalFromClaims, type IdTokenVerifier, type Principal } from '../identity';
import { createSqlSupervisorAuthority } from './capacity-supervisor';
export interface PreparedHttpOperation {
 readonly request:ControlRequest;
 readonly config:Omit<SqlIngressConfig,'input'>;
 readonly releaseAuthority:PrivateQueryEffect;
}
/** External implementation is the independently qualified authenticated supervisor,
 * whose pre-input control baseline includes token/header and identity bootstrap. Its
 * prepare call selects identities and transports only: no body pull or process launch. */
export interface QualifiedHttpSupervisor {
 prepare(principal:Principal,token:string,metadata:{namespace:string;project:string;route:string;operation:ControlRequest['operation'];requestIdentity:string}):Promise<PreparedHttpOperation>;
}
const httpIngresses=new WeakSet<RequestHandler>();
export function isCapacityHttpIngress(value:unknown):value is RequestHandler {return typeof value==='function'&&httpIngresses.has(value as RequestHandler);}
/** Explicit opt-in route; no request body is pulled before the protected replay lease. */
export function createCapacityHttpIngress(options:{namespace:string;project:string;route:string;operation:ControlRequest['operation'];verifyToken:IdTokenVerifier;supervisor?:QualifiedHttpSupervisor;now:()=>number}):RequestHandler {
 const handler:RequestHandler=async(req,res,next)=>{
  if(req.method!=='POST'||req.path!==options.route){next();return;}
  const header=req.get('authorization');if(!header?.startsWith('Bearer ')){res.status(401).json({error:'AUTHENTICATION_REQUIRED'});return;}
  const token=header.slice(7);let principal:Principal;
  try {
   const claims=await options.verifyToken(token);
   if((options.operation==='PG_SETUP'||options.operation==='PG_START')&&(!claims.currentUser||claims.currentUser.disabled!==false)){res.status(401).json({error:'USER_UNAVAILABLE'});return;}
   principal=principalFromClaims(claims,options.project);
  } catch {res.status(401).json({error:'INVALID_ID_TOKEN'});return;}
  if(options.operation==='ENTA_SUCCESSOR' && (!principal.verifiedAccount||principal.anonymous||!principal.uid||!principal.email)){res.status(403).json({error:'VERIFIED_ACCOUNT_REQUIRED'});return;}
  if(!options.supervisor){res.status(503).json({error:'CAPACITY_UNAVAILABLE'});return;}
  try {
   const requestIdentity=randomUUID(), metadata={namespace:options.namespace,project:options.project,route:options.route,operation:options.operation,requestIdentity};
   const prepared=await options.supervisor.prepare(principal,token,metadata), request=captureControl(prepared.request);
   if(request.namespace!==options.namespace||request.project!==options.project||request.route!==options.route||request.operation!==options.operation||request.requestIdentity!==requestIdentity||prepared.config.uid!==principal.uid) return unavailable();
   const ingress=new SqlProtectedIngress({...prepared.config,input:req});
   const supervisor=createSqlSupervisorAuthority(prepared.config.supervisor,prepared.releaseAuthority);
   const result=await runSuccessor({ingress,supervisor,request,now:options.now});
   res.status(result.idempotent===true||result.replayed===true?200:201).json(result);
  } catch {res.status(503).json({error:'CAPACITY_UNAVAILABLE'});}
 };
 httpIngresses.add(handler);return handler;
}
