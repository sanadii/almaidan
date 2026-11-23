import { CapacityUnavailable, unavailable, admission as captureAdmission, fixedCapacityByteView, type Admission, type CleanupEvidence, type Incarnation, type Subject, sameIncarnation, sameSubject } from './capacity-contract';
import { strictJSON } from './strict-json';

/** The port is an externally qualified protected boundary, not an ordinary application callback.
 * It must authenticate and persist its own observations. The default has no implementation. */
export interface SupervisorAuthority {
  current(admissionId: string, fence: bigint): Promise<Admission | null>;
  quarantine(admissionId: string, fence: bigint): Promise<void>;
  release(admissionId: string, fence: bigint, receiptId: string): Promise<void>;
  readCleanup(admissionId: string, fence: bigint, receiptId: string): Promise<CleanupEvidence | null>;
}
export class OperationLifetime {
  private consumed = false;
  private terminal = false;
  private quarantineDone: Promise<void> | undefined;
  constructor(private readonly authority: SupervisorAuthority | undefined, readonly admission: Admission, private readonly now: () => number) {}
  async begin(subject: Subject, process: Incarnation): Promise<void> {
    if (this.consumed || this.terminal || !this.authority) return unavailable();
    // Mark before awaiting so concurrent invocations cannot both enter.
    this.consumed = true;
    const rawCurrent = await this.authority.current(this.admission.id, this.admission.fence);
    const current = rawCurrent === null ? null : captureAdmission(rawCurrent);
    const now = this.now();
    if (this.terminal || !current || current.id !== this.admission.id || current.fence !== this.admission.fence ||
        current.state !== 'RESERVED' || current.qualification.id !== this.admission.qualification.id ||
        current.qualification.generation !== this.admission.qualification.generation ||
        current.qualification.evidenceHash !== this.admission.qualification.evidenceHash ||
        current.qualification.sourceClosure !== this.admission.qualification.sourceClosure ||
        current.qualification.domain !== this.admission.qualification.domain ||
        current.qualification.reuse !== this.admission.qualification.reuse ||
        current.qualification.validUntil !== this.admission.qualification.validUntil ||
        current.expiresAt !== this.admission.expiresAt || !Number.isSafeInteger(now) || current.expiresAt <= now ||
        current.qualification.validUntil <= now || !sameSubject(current.subject, subject) ||
        !sameIncarnation(current.incarnation, process)) return unavailable();
  }
  /** Every completion/error/cancellation first quarantines; acknowledgement alone never releases. */
  async finish(): Promise<void> {
    if (this.quarantineDone) return this.quarantineDone;
    this.terminal = true;
    if (!this.authority) return unavailable();
    this.quarantineDone = this.authority.quarantine(this.admission.id, this.admission.fence);
    await this.quarantineDone;
  }
  async release(receiptId: string): Promise<void> {
    if (!this.terminal || !this.authority || !receiptId || !this.quarantineDone) return unavailable();
    await this.quarantineDone;
    const evidence = await this.authority.readCleanup(this.admission.id, this.admission.fence, receiptId);
    if (!evidence || evidence.admissionId !== this.admission.id || evidence.fence !== this.admission.fence ||
        !sameIncarnation(evidence.incarnation, this.admission.incarnation) || evidence.observerGeneration <= 0n ||
        (evidence.outcome !== 'COMMITTED' && evidence.outcome !== 'ROLLED_BACK') ||
        evidence.protocolDrained !== true || evidence.ipcDrained !== true || evidence.parentDrained !== true ||
        evidence.processTreeTerminated !== true || evidence.backendAbsent !== true) return unavailable();
    // The protected release boundary independently rechecks actual backend absence.
    await this.authority.release(this.admission.id, this.admission.fence, receiptId);
  }
}
import { admissionWire, cleanupWire } from './capacity-contract';
import { privateFixedCall, isCapacityRoleEffect, type PrivateQueryEffect } from './capacity-producer';
/** Distinct role transports are injected only by the qualified supervisor process. */
const sqlAuthorities=new WeakSet<SupervisorAuthority>();
export function isSqlSupervisorAuthority(value:unknown):value is SupervisorAuthority {return !!value && typeof value==='object' && sqlAuthorities.has(value as SupervisorAuthority);}
export function createSqlSupervisorAuthority(supervisor:PrivateQueryEffect,releaseAuthority:PrivateQueryEffect):SupervisorAuthority {
 if(!isCapacityRoleEffect(supervisor) || !isCapacityRoleEffect(releaseAuthority) || supervisor===releaseAuthority)return unavailable();
 const authority:SupervisorAuthority = {
  async current(admissionId,fence){const value=await privateFixedCall(supervisor,'readAdmission',[admissionId,fence.toString()]);return value===null?null:admissionWire(value);},
  async quarantine(admissionId,fence){if(await privateFixedCall(supervisor,'quarantine',[admissionId,fence.toString()])!==null)return unavailable();},
  async readCleanup(admissionId,fence,receiptId){const value=await privateFixedCall(supervisor,'readCleanup',[admissionId,fence.toString(),receiptId]);return value===null?null:cleanupWire(value);},
  async release(admissionId,fence,receiptId){if(await privateFixedCall(releaseAuthority,'release',[admissionId,fence.toString(),receiptId])!==null)return unavailable();},
 };
 sqlAuthorities.add(authority);return Object.freeze(authority);
}

function observationRecord(value:unknown,kind:'OPERATION'|'REPLAY'|'CONTROL'):Record<string,unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value))return unavailable();
 const row=value as Record<string,unknown>;
 const keys=kind==='OPERATION'?['host','boot','processTree','backendPrincipal','backendPid','backendStart','outcome','protocolDrain','IPCDrain','parentDrain','termination','observerGeneration','evidence','trustId']:
  kind==='REPLAY'?['host','boot','processTree','backendPrincipal','backendPid','backendStart','protocolDrain','ipcDrain','parentDrain','termination','observerGeneration','evidence','trustId']:
  ['host','boot','parentProcessTree','parentEnvelope','ipcDrained','parentDrained','descendantsTerminated','observerGeneration','evidence','trustId'];
 if(Object.keys(row).length!==keys.length || keys.some(k=>!Object.hasOwn(row,k)))return unavailable();
 const out:Record<string,unknown>={};for(const k of keys)out[k]=row[k];
 const bools=kind==='OPERATION'?['protocolDrain','IPCDrain','parentDrain','termination']:kind==='REPLAY'?['protocolDrain','ipcDrain','parentDrain','termination']:['ipcDrained','parentDrained','descendantsTerminated'];
 if(bools.some(k=>out[k]!==true) || typeof out.observerGeneration!=='string' || !/^[1-9][0-9]*$/.test(out.observerGeneration) || typeof out.evidence!=='string' || !out.evidence || typeof out.trustId!=='string' || !out.trustId || typeof out.host!=='string' || !out.host || typeof out.boot!=='string' || !out.boot)return unavailable();
 if(kind==='CONTROL') {if(typeof out.parentProcessTree!=='string'||!out.parentProcessTree||typeof out.parentEnvelope!=='string'||!out.parentEnvelope)return unavailable();}
 else if(typeof out.processTree!=='string'||!out.processTree||typeof out.backendPrincipal!=='string'||!out.backendPrincipal||!Number.isSafeInteger(out.backendPid)||(out.backendPid as number)<=0||typeof out.backendStart!=='string'||!out.backendStart||(kind==='OPERATION'&&out.outcome!=='COMMITTED'&&out.outcome!=='ROLLED_BACK'))return unavailable();
 return Object.freeze(out);
}
/** Deferred bytes are pulled only after the protected allocator commits a one-use slot.
 * This object is a data source, not an observer identity or approval authority. */
const captureOnce = Symbol('protected observer capture');
const capturePermit=Object.freeze({});
export class ObservationSource {
 private consumed=false;private retained:Buffer | undefined;private retainedClaim:string | undefined;
 constructor(private readonly open:(lease:Readonly<{inputClaimId:string;maxInputBytes:bigint}>)=>AsyncIterable<Uint8Array>) {}
 async [captureOnce](lease:Readonly<{inputClaimId:string;maxInputBytes:bigint}>,status:'CREATED'|'EXISTING',permit:object):Promise<{value:unknown;captured:Buffer}> {
  if(permit!==capturePermit)return unavailable();
  const maximum=lease.maxInputBytes;
  if(maximum<=0n||maximum>BigInt(Number.MAX_SAFE_INTEGER)||typeof this.open!=='function')return unavailable();
  const decode = (bytes: Buffer) => strictJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes), Number(maximum));
  if(status==='EXISTING'){
   if(!this.retained||this.retainedClaim!==lease.inputClaimId||BigInt(this.retained.byteLength)>maximum)return unavailable();
   const captured=Buffer.from(this.retained);
   try{return {value:decode(captured),captured};}catch{return unavailable();}
  }
  if(this.consumed)return unavailable();this.consumed=true;
  try {
   const input=this.open(lease);if(!input||typeof input[Symbol.asyncIterator]!=='function')return unavailable();const chunks:Buffer[]=[];let total=0n;
   for await(const chunk of input){
    const view=fixedCapacityByteView(chunk,1,Number(maximum-total));
    total+=BigInt(view.byteLength);
    chunks.push(Buffer.from(view));
   }
   if(total===0n)return unavailable();
   const captured=Buffer.concat(chunks,Number(total));
   const value=decode(captured);
   this.retained=Buffer.from(captured);this.retainedClaim=lease.inputClaimId;return {value,captured};
  }catch{return unavailable();}
 }
}
export type ObserverCapture={readonly reservationId:string;readonly source:ObservationSource};
async function captureProtectedObservation(publisher:PrivateQueryEffect,allocator:PrivateQueryEffect|undefined,request:ObserverCapture,eventParts:readonly string[],phase:string,perKind:{kind:string;key:string;fence:bigint|null}|undefined,control:DeliveryControl):Promise<{claimId:string;value:unknown;captured:Buffer;maximum:bigint}> {
 if(!isCapacityRoleEffect(publisher)||!isCapacityRoleEffect(allocator)||publisher===allocator||!request||!(request.source instanceof ObservationSource)||typeof request.reservationId!=='string'||!request.reservationId||!Array.isArray(eventParts)||eventParts.length===0||eventParts.some(x=>typeof x!=='string'||!x)||typeof phase!=='string'||!phase)return unavailable();
 const upper=await privateFixedCall(publisher,'readObserverInputLimit',[]);if(typeof upper!=='string'||!/^[1-9][0-9]{0,18}$/.test(upper)||BigInt(upper)>9223372036854775807n)return unavailable();
 let idBytes=0n;for(const id of [request.reservationId,...eventParts,phase,...(perKind?[perKind.kind,perKind.key]:[])]){if(typeof id!=='string'||!id)return unavailable();idBytes+=BigInt(id.length)*6n+2n;}if(perKind?.fence!==null&&perKind?.fence!==undefined){if(typeof perKind.fence!=='bigint'||perKind.fence<=0n||perKind.fence>9223372036854775807n)return unavailable();idBytes+=BigInt(perKind.fence.toString().length);}if(idBytes>BigInt(upper))return unavailable();
 let maximum=BigInt(upper);
 if(perKind){const bounded=await privateFixedCall(publisher,'readCleanupLimit',[perKind.kind,perKind.key,perKind.fence===null?null:perKind.fence.toString()]);if(typeof bounded!=='string'||bounded.length>upper.length||!/^[1-9][0-9]*$/.test(bounded))return unavailable();if(BigInt(bounded)<maximum)maximum=BigInt(bounded);}
 const eventKey=eventParts.map(part=>`${Buffer.byteLength(part,'utf8')}:${part}`).join('');control.claimStarting();const claim=await privateFixedCall(allocator,'claimObserverInput',[request.reservationId,eventKey,phase]);if(!claim||typeof claim!=='object'||Array.isArray(claim))return unavailable();const row=claim as Record<string,unknown>,keys=['status','inputClaimId','maxInputBytes'];if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k)))return unavailable();const {status,inputClaimId,maxInputBytes}=row;
 // An uncertain/previous claim can only be reconciled by its original persisted receipt;
 // it must never cause the source to capture a second time.
 if((status!=='CREATED'&&status!=='EXISTING')||typeof inputClaimId!=='string'||!/^[a-f0-9]{64}$/.test(inputClaimId)||typeof maxInputBytes!=='string'||!/^[1-9][0-9]{0,18}$/.test(maxInputBytes))return unavailable();if(BigInt(maxInputBytes)<maximum)maximum=BigInt(maxInputBytes);control.claimAccepted();
 const captured=await request.source[captureOnce](Object.freeze({inputClaimId,maxInputBytes:maximum}),status,capturePermit);return {claimId:inputClaimId,...captured,maximum};
}

// A permanent per-source/per-reservation fence covers the entire delivery, not
// only the first pull. Unknown or failed completion retains the rejected promise.
type DeliveryFence={source:ObservationSource;publisher:PrivateQueryEffect;allocator:PrivateQueryEffect;reservationId:string;phase:string;parts:readonly string[];promise:Promise<void>};
const sourceDeliveries=new WeakMap<ObservationSource,DeliveryFence>();
const reservationDeliveries=new Map<string,DeliveryFence>();
let pendingDelivery:DeliveryFence|undefined;
type DeliveryControl={claimStarting():void;claimAccepted():void};
function deliverObservation(publisher:PrivateQueryEffect,allocator:PrivateQueryEffect|undefined,input:ObserverCapture,phase:string,parts:readonly string[],work:(owned:ObserverCapture,publisher:PrivateQueryEffect,allocator:PrivateQueryEffect,control:DeliveryControl)=>Promise<void>):Promise<void> {
 if(!isCapacityRoleEffect(publisher)||!isCapacityRoleEffect(allocator)||publisher===allocator||!input||parts.some(x=>typeof x!=='string'||!x))return Promise.reject(new CapacityUnavailable());
 const source=input.source,reservationId=input.reservationId;if(!(source instanceof ObservationSource)||typeof reservationId!=='string'||!reservationId)return Promise.reject(new CapacityUnavailable());
 const existing=sourceDeliveries.get(source)||reservationDeliveries.get(reservationId);
 if(existing){if(existing.source!==source||existing.publisher!==publisher||existing.allocator!==allocator||existing.reservationId!==reservationId||existing.phase!==phase||existing.parts.length!==parts.length||existing.parts.some((x,i)=>x!==parts[i]))return Promise.reject(new CapacityUnavailable());return existing.promise;}
 // At most one unverified ID can occupy local metadata. Only a protected claim
 // promotes it to the permanent, independently preallocated slot inventory.
 if(pendingDelivery)return Promise.reject(new CapacityUnavailable());
 let started=false;let fence:DeliveryFence;
 const control:DeliveryControl={claimStarting(){started=true;},claimAccepted(){if(pendingDelivery!==fence)return unavailable();reservationDeliveries.set(reservationId,fence);pendingDelivery=undefined;}};
 const promise=Promise.resolve().then(()=>work(Object.freeze({source,reservationId}),publisher,allocator,control)).catch(error=>{if(!started&&pendingDelivery===fence)pendingDelivery=undefined;throw error;});
 fence={source,publisher,allocator,reservationId,phase,parts:Object.freeze([...parts]),promise};pendingDelivery=fence;sourceDeliveries.set(source,fence);return promise;
}
export interface InstallObservationCapture { readonly publisher:PrivateQueryEffect; readonly allocator:PrivateQueryEffect; readonly input:ObserverCapture }
export function publishInstallObservation(config:InstallObservationCapture,controlKey:string,kind:'REPLAY'|'PRODUCER'):Promise<void> {
 return deliverObservation(config?.publisher,config?.allocator,config?.input,'INSTALL_PROCESS',[controlKey,kind],async(owned,publisher,allocator,control)=>{
 const cap=await captureProtectedObservation(publisher,allocator,owned,[controlKey,kind],'INSTALL_PROCESS',undefined,control);
 if(!cap.value||typeof cap.value!=='object'||Array.isArray(cap.value))return unavailable();
 const row=cap.value as Record<string,unknown>,keys=['observationVersion','observationId','trustId','trustGeneration','controlKey','kind','credentialEpoch','launchEpoch','principalName','principalOid','pid','backendStart','host','boot','processTree','installationGeneration','installationEvidenceHash','installation','observedAt','validUntil','evidence','evidenceHash','inputClaimId'];
 if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.hasOwn(row,k))||row.controlKey!==controlKey||row.kind!==kind||row.inputClaimId!==cap.claimId)return unavailable();
 const installedKeys=['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'];
 const rawInstall=row.installation;if(!rawInstall||typeof rawInstall!=='object'||Array.isArray(rawInstall))return unavailable();const install=rawInstall as Record<string,unknown>;
 if(Object.keys(install).length!==installedKeys.length||installedKeys.some(k=>!Object.hasOwn(install,k)||typeof install[k]!=='string'||!install[k]||install[k]==='*'))return unavailable();
 let size=2n;for(const key of keys){size+=BigInt(key.length)*6n+4n;const value=row[key];if(key==='installation'){size+=2n;for(const k of installedKeys)size+=BigInt(k.length)*6n+4n+BigInt((install[k] as string).length)*6n+2n;}else{if(typeof value!=='string'||!value)return unavailable();size+=BigInt(value.length)*6n+2n;}if(size>cap.maximum)return unavailable();}
 if(row.observationVersion!=='1'||!/^[1-9][0-9]*$/.test(row.trustGeneration as string)||!/^[1-9][0-9]*$/.test(row.installationGeneration as string)||!/^[1-9][0-9]*$/.test(row.principalOid as string)||!/^[1-9][0-9]*$/.test(row.pid as string)||!/^[a-f0-9]{64}$/.test(row.installationEvidenceHash as string)||!/^[a-f0-9]{64}$/.test(row.evidenceHash as string))return unavailable();
 const evidence=Buffer.from(row.evidence as string,'base64');if(!evidence.length||evidence.toString('base64')!==row.evidence)return unavailable();
 if(await privateFixedCall(publisher,'acceptInstallObservation',[controlKey,kind,cap.claimId,JSON.stringify(row),cap.captured])!==row.observationId)return unavailable();

 });
}
/** Receipts and release are separate capabilities. Receipt claims are independently
 * checked against the protected observer mapping and actual backend by SQL. */
export class SqlCleanupBoundary {
 constructor(private readonly publisher:PrivateQueryEffect,private readonly releaser:PrivateQueryEffect,private readonly allocator?:PrivateQueryEffect) {
  if(!isCapacityRoleEffect(publisher)||!isCapacityRoleEffect(releaser)||publisher===releaser)return unavailable();
  Object.freeze(this);
 }
 private async boundedInput(kind:'OPERATION'|'REPLAY'|'CONTROL'|'CONNECTION'|'CLOSED_SCOPE',key:string,fence:bigint|null,ids:readonly string[],row:Record<string,unknown>):Promise<void> {
  if(typeof key!=='string'||!key||ids.some(x=>typeof x!=='string'||!x)|| (fence!==null&&(typeof fence!=='bigint'||fence<=0n||fence>9223372036854775807n)))return unavailable();
  const inputLimit=await privateFixedCall(this.publisher,'readObserverInputLimit',[]);
  if(typeof inputLimit!=='string'||!/^[1-9][0-9]{0,18}$/.test(inputLimit)||BigInt(inputLimit)>9223372036854775807n)return unavailable();
  let size=2n;for(const id of [kind,key,...ids])size+=BigInt(id.length)*6n+2n;
  if(fence!==null)size+=BigInt(fence.toString().length);
  for(const [name,v] of Object.entries(row)){if(typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean'&&v!==null)return unavailable();size+=BigInt(name.length)*6n+4n;size+=typeof v==='string'?BigInt(v.length)*6n+2n:typeof v==='number'?24n:5n;}
  if(size>BigInt(inputLimit))return unavailable();
  const bound=await privateFixedCall(this.publisher,'readCleanupLimit',[kind,key,fence===null?null:fence.toString()]);
  if(typeof bound!=='string'||bound.length>inputLimit.length||!/^[1-9][0-9]*$/.test(bound)||size>BigInt(bound))return unavailable();
  const evidence=row.evidence;if(typeof evidence!=='string')return unavailable();const bytes=Buffer.from(evidence,'base64');if(!bytes.length||bytes.toString('base64')!==evidence)return unavailable();
 }
 publishOperation(admissionId:string,fence:bigint,receiptId:string,input:ObserverCapture):Promise<void> {
 if(typeof fence!=='bigint'||fence<=0n||fence>9223372036854775807n)return Promise.reject(new CapacityUnavailable());
 return deliverObservation(this.publisher,this.allocator,input,'OPERATION_CLEANUP',[admissionId,fence.toString(),receiptId],async(owned,_publisher,_allocator,control)=>{
  const cap=await captureProtectedObservation(this.publisher,this.allocator,owned,[admissionId,fence.toString(),receiptId],'OPERATION_CLEANUP',{kind:'OPERATION',key:admissionId,fence},control);const row=observationRecord(cap.value,'OPERATION');await this.boundedInput('OPERATION',admissionId,fence,[receiptId],row);if(await privateFixedCall(this.publisher,'publishCleanup',[admissionId,fence.toString(),receiptId,cap.claimId,JSON.stringify(row),cap.captured])!==receiptId)return unavailable();
 
 });
}
 publishReplay(replayId:string,receiptId:string,input:ObserverCapture):Promise<void> {
 return deliverObservation(this.publisher,this.allocator,input,'REPLAY_CLEANUP',[replayId,receiptId],async(owned,_publisher,_allocator,control)=>{
  const cap=await captureProtectedObservation(this.publisher,this.allocator,owned,[replayId,receiptId],'REPLAY_CLEANUP',{kind:'REPLAY',key:replayId,fence:null},control);const row=observationRecord(cap.value,'REPLAY');await this.boundedInput('REPLAY',replayId,null,[receiptId],row);if(await privateFixedCall(this.publisher,'publishReplayCleanup',[replayId,receiptId,cap.claimId,JSON.stringify(row),cap.captured])!==receiptId)return unavailable();
 
 });
}
 publishControl(controlKey:string,receiptId:string,input:ObserverCapture):Promise<void> {
 return deliverObservation(this.publisher,this.allocator,input,'CONTROL_CLEANUP',[controlKey,receiptId],async(owned,_publisher,_allocator,control)=>{
  const cap=await captureProtectedObservation(this.publisher,this.allocator,owned,[controlKey,receiptId],'CONTROL_CLEANUP',{kind:'CONTROL',key:controlKey,fence:null},control);const row=observationRecord(cap.value,'CONTROL');await this.boundedInput('CONTROL',controlKey,null,[receiptId],row);if(await privateFixedCall(this.publisher,'publishControlCleanup',[controlKey,receiptId,cap.claimId,JSON.stringify(row),cap.captured])!==receiptId)return unavailable();
 
 });
}
 observeConnection(controlKey:string,kind:'REPLAY'|'PRODUCER',input:ObserverCapture):Promise<void> {
 return deliverObservation(this.publisher,this.allocator,input,'CONNECTION_OBSERVATION',[controlKey,kind],async(owned,_publisher,_allocator,control)=>{
  const cap=await captureProtectedObservation(this.publisher,this.allocator,owned,[controlKey,kind],'CONNECTION_OBSERVATION',{kind:'CONNECTION',key:controlKey,fence:null},control);const value=cap.value;
  if(!value || typeof value!=='object' || Array.isArray(value))return unavailable();
  const row=value as Record<string,unknown>,keys=['controlKey','kind','outcome','expectedPrincipal','host','boot','processTree','pid','backendStart','observerGeneration','trustId','traceId','evidence'];
  if(Object.keys(row).length!==keys.length || keys.some(k=>!Object.hasOwn(row,k)))return unavailable();
  const o:Record<string,unknown>={};for(const key of keys)o[key]=row[key];
  if(o.controlKey!==controlKey || o.kind!==kind || (o.outcome!=='NEVER_OPENED'&&o.outcome!=='BOUND') || typeof o.expectedPrincipal!=='string'||!o.expectedPrincipal||typeof o.host!=='string'||!o.host||typeof o.boot!=='string'||!o.boot||typeof o.processTree!=='string'||!o.processTree||typeof o.observerGeneration!=='string'||!/^[1-9][0-9]*$/.test(o.observerGeneration)||typeof o.trustId!=='string'||!o.trustId||typeof o.traceId!=='string'||!o.traceId||typeof o.evidence!=='string'||!o.evidence)return unavailable();
  if(o.outcome==='NEVER_OPENED' ? o.pid!==null||o.backendStart!==null : !Number.isSafeInteger(o.pid)||(o.pid as number)<=0||typeof o.backendStart!=='string'||!o.backendStart)return unavailable();
  await this.boundedInput('CONNECTION',controlKey,null,[kind],o);
  if(await privateFixedCall(this.publisher,'observeConnection',[controlKey,kind,cap.claimId,JSON.stringify(o),cap.captured])!==null)return unavailable();
 
 });
}
 publishClosedScope(controlKey:string,input:ObserverCapture):Promise<void> {
 return deliverObservation(this.publisher,this.allocator,input,'CLOSED_SCOPE',[controlKey],async(owned,_publisher,_allocator,control)=>{
  const cap=await captureProtectedObservation(this.publisher,this.allocator,owned,[controlKey],'CLOSED_SCOPE',{kind:'CLOSED_SCOPE',key:controlKey,fence:null},control);const value=cap.value;
  if(!value || typeof value!=='object' || Array.isArray(value))return unavailable();
  const row=value as Record<string,unknown>,keys=['controlKey','replayOid','producerOid','credentialEpoch','launchEpoch','sourceIdentity','supervisorIdentity','host','boot','parentProcessTree','priorAttemptsQuiesced','credentialsClosed','socketsDrained','ipcDrained','parentDrained','descendantsTerminated','observerGeneration','trustId','evidence'];
  if(Object.keys(row).length!==keys.length || keys.some(k=>!Object.hasOwn(row,k)))return unavailable();
  const o:Record<string,unknown>={};for(const key of keys)o[key]=row[key];
  if(o.controlKey!==controlKey || ['replayOid','producerOid','observerGeneration'].some(k=>typeof o[k]!=='string'||!/^[1-9][0-9]*$/.test(o[k] as string)) || o.replayOid===o.producerOid || ['credentialEpoch','launchEpoch','sourceIdentity','supervisorIdentity','host','boot','parentProcessTree','trustId','evidence'].some(k=>typeof o[k]!=='string'||!(o[k] as string)) || ['priorAttemptsQuiesced','credentialsClosed','socketsDrained','ipcDrained','parentDrained','descendantsTerminated'].some(k=>o[k]!==true))return unavailable();
  await this.boundedInput('CLOSED_SCOPE',controlKey,null,[],o);
  if(await privateFixedCall(this.publisher,'acceptClosedScope',[controlKey,cap.claimId,JSON.stringify(o),cap.captured])!==null)return unavailable();
 
 });
}
 async releaseControl(controlKey:string,controlReceiptId:string,replayReceiptId:string|null):Promise<void> {
  if(await privateFixedCall(this.releaser,'releaseControl',[controlKey,controlReceiptId,replayReceiptId])!==null)return unavailable();
 }
}
