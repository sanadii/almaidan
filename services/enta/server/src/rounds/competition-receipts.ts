import { EntaError } from '../gameplay/types';
export interface CompetitionCommandReceipt { state: 'ACCEPTED' | 'ABSENT'; gameId: string; commandId: string; expectedVersion: number; hash: string; eventId: string | null; revision: number }
export interface CompetitionCommandRejectionProof { version: 1; state: 'REJECTED'; projectId: string; principalUid: string; gameId: string; commandId: string; hash: string; expectedVersion: number; currentRevision: number; reason: 'OPTIONAL_CAPACITY_EXHAUSTED' | 'ATTEMPT_BUDGET_EXCEEDED' }
export class CompetitionCommandRejection extends EntaError { constructor(code: string, readonly commandReceipt: CompetitionCommandReceipt | null, readonly commandRejection?: CompetitionCommandRejectionProof) { super(409, code); } }
