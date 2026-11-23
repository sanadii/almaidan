/** Source-side reservation accounting; authoritative admission is enforced in the database. */
export const RESOURCE_HOLDERS = ['compressedInput','rawAndDetoast','hash','convertedTextAndCString','lexerAndUnescape','numeric','jsonArraysAndRepalloc','sort','parseTree','finalJsonb','nativeStack','subtreeAndScalar','bindingAndPublication','executorAndMetadata','retainedHighWater','sharedReserve'] as const;
export type ResourceHolder = typeof RESOURCE_HOLDERS[number];
export type ResourceEnvelope = Record<ResourceHolder, bigint>;
const MAX = 9223372036854775807n;
export function checkedResourceTotal(envelope: ResourceEnvelope): bigint {
  if (!envelope || typeof envelope !== 'object' || Object.keys(envelope).length !== RESOURCE_HOLDERS.length || !RESOURCE_HOLDERS.every(k=>Object.hasOwn(envelope,k))) throw new Error('RESOURCE_UNQUALIFIED');
  let total = 0n;
  for (const key of RESOURCE_HOLDERS) {
    const value = envelope[key];
    if (typeof value !== 'bigint' || value < 0n || value > MAX || total > MAX - value) throw new Error('RESOURCE_UNQUALIFIED');
    total += value;
  }
  return total;
}
export interface AdmissionIdentity { job: string; profile: string; producer: string; epoch: string; session: string; fence: string; }
export interface ResourceReservation { identity: AdmissionIdentity; bytes: bigint; state: 'RUNNING' | 'QUARANTINED' | 'RELEASED'; }
/** No expiry, timeout, cancellation request or rejected promise releases capacity. */
export class ReservationLedger {
  private readonly entries = new Map<string, ResourceReservation>();
  constructor(private readonly capacity: bigint) { if (typeof capacity !== 'bigint' || capacity < 0n || capacity > MAX) throw new Error('RESOURCE_UNQUALIFIED'); }
  reserve(identity: AdmissionIdentity, envelope: ResourceEnvelope): ResourceReservation {
    const keys: Array<keyof AdmissionIdentity> = ['job','profile','producer','epoch','session','fence'];
    if (!identity || typeof identity !== 'object' || Object.keys(identity).length !== keys.length || !keys.every(k=>Object.hasOwn(identity,k))) throw new Error('RESOURCE_UNQUALIFIED');
    const {job,profile,producer,epoch,session,fence}=identity;
    if ([job,profile,producer,epoch,session,fence].some(v=>typeof v !== 'string' || v.length === 0)) throw new Error('RESOURCE_UNQUALIFIED');
    const captured={job,profile,producer,epoch,session,fence};
    if ([...this.entries.values()].some(e=>e.state !== 'RELEASED' && (e.identity.job === job || e.identity.session === session))) throw new Error('RESOURCE_BUSY');
    const bytes=checkedResourceTotal(envelope); let used=0n;
    for(const entry of this.entries.values()) if(entry.state !== 'RELEASED') { if(used > MAX-entry.bytes) throw new Error('RESOURCE_UNQUALIFIED'); used+=entry.bytes; }
    if(bytes > this.capacity-used) throw new Error('DEFERRED_RESOURCE');
    const reservation: ResourceReservation={identity:captured,bytes,state:'RUNNING'}; this.entries.set(job,reservation); return { ...reservation, identity:{...reservation.identity} };
  }
  quarantine(job: string): void { const r=this.entries.get(job); if(!r || r.state==='RELEASED') throw new Error('RESOURCE_UNAVAILABLE'); r.state='QUARANTINED'; }
  /** Must be called only after the trusted supervisor establishes query, transaction, protocol and session cleanup. */
  confirmCleanup(identity: AdmissionIdentity): void {
    const r=this.entries.get(identity.job);
    if (!r || r.state==='RELEASED' || (Object.keys(r.identity) as Array<keyof AdmissionIdentity>).some(k=>r.identity[k]!==identity[k])) throw new Error('RESOURCE_UNAVAILABLE');
    r.state='RELEASED';
  }
  state(job: string): ResourceReservation['state'] | undefined { return this.entries.get(job)?.state; }
}
