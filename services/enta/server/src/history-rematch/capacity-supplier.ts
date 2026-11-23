import { unavailable, type Qualification, qualification, qualificationWire } from './capacity-contract';

/** A configured implementation is external, independently authenticated and qualified.
 * This module never creates trust roots, credentials, approval semantics or limits. */
export interface ProtectedSupplierPort {
  importVerifiedReceipt(receiptId: string): Promise<unknown>;
  readCurrentQualification(approvalId: string): Promise<unknown>;
}
import { privateFixedCall, isCapacityRoleEffect, type PrivateQueryEffect } from './capacity-producer';
const sqlPorts=new WeakSet<ProtectedSupplierPort>();
export function createSqlSupplierPort(importer:PrivateQueryEffect):ProtectedSupplierPort {
 if(!isCapacityRoleEffect(importer))return unavailable();
 const port:ProtectedSupplierPort=Object.freeze({
  async importVerifiedReceipt(receiptId:string){return privateFixedCall(importer,'importApproval',[receiptId]);},
  async readCurrentQualification(approvalId:string){return qualificationWire(await privateFixedCall(importer,'findQualification',[approvalId]));},
 });
 sqlPorts.add(port);return port;
}
export class CapacitySupplier {
  constructor(private readonly port?: ProtectedSupplierPort) {}
  async qualificationFor(receiptId: string, now: number): Promise<Qualification> {
    if (!this.port || !sqlPorts.has(this.port) || typeof receiptId !== 'string' || !receiptId || !Number.isSafeInteger(now) || now <= 0) return unavailable();
    const approval = await this.port.importVerifiedReceipt(receiptId);
    if (typeof approval !== 'string' || !approval) return unavailable();
    const result = qualification(await this.port.readCurrentQualification(approval));
    if (result.validUntil <= now) return unavailable();
    return result;
  }
}