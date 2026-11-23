import type { AuthenticatedContext } from '../huroof-pg/identity-policy';
import type { AudienceRealtimeRead, RealtimeEnvelope, RealtimeRequest } from './contracts';
export interface RealtimeRepository { read(context: AuthenticatedContext, request: RealtimeRequest): Promise<RealtimeEnvelope>; readAudience(context:AuthenticatedContext,request:RealtimeRequest):Promise<AudienceRealtimeRead> }
