import type { Principal } from '../identity';
import { parseStartCommand, parseSetupName, foldSetupName } from '../gameplay/service';
import { parseSuccessor } from '../gameplay/successor';
import { parseRoundStart } from '../rounds/validation';
import { parseCompetitionStart } from '../rounds/competition-rules';
import { deny } from './core';
import { isRetryOnlySuccessorRepository } from './successor-postgres';
import { resolvePersistedProfile, type Profile } from './registry';

export interface ExternalSuccessorRequest { envelopeVersion: 6; e3Protocol: 1; requestKey: string; logicalMatchId: string; profile: Profile; predecessor: { gameId: string; originalTerminalHash: string }; setup: unknown }
export interface SuccessorOutcome { gameId: string; admissionId: string; physicalProtocol: 2 | 3 | 4 | 5; envelopeVersion: 6; e3Protocol: 1; idempotent: boolean }
export interface EntaSuccessorRepository { compose(principal: Principal, request: ExternalSuccessorRequest): Promise<SuccessorOutcome> }
export interface EntaSuccessorDependencies { projectId: string; repository: EntaSuccessorRepository }
export type EntaSuccessorHandler = (principal: Principal, input: unknown) => Promise<SuccessorOutcome>;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return deny('INVALID_REQUEST');
 const row = value as Record<string, unknown>;
 if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) return deny('INVALID_REQUEST');
 return row;
}
function canonical(v: unknown): string {
 if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
 if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
 const encoded = JSON.stringify(v); if (encoded === undefined) return deny('INVALID_REQUEST'); return encoded;
}
export function parseExternalSuccessor(input: unknown): ExternalSuccessorRequest {
 const r = exact(input, ['envelopeVersion','e3Protocol','requestKey','logicalMatchId','profile','predecessor','setup']);
 const p = resolvePersistedProfile(r.profile), prior = exact(r.predecessor, ['gameId','originalTerminalHash']);
 if (r.envelopeVersion !== 6 || r.e3Protocol !== 1 || typeof r.requestKey !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(r.requestKey) || typeof r.logicalMatchId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.logicalMatchId) || typeof prior.gameId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(prior.gameId) || typeof prior.originalTerminalHash !== 'string' || !/^[a-f0-9]{64}$/.test(prior.originalTerminalHash)) return deny('INVALID_REQUEST');
 const wire = { requestKey:r.requestKey, logicalMatchId:r.logicalMatchId, setup:r.setup };
 const parsed = p.physicalProtocol === 2 ? parseStartCommand(wire) : p.physicalProtocol === 3 ? parseSuccessor(wire,p.mode as 'CLASSIC'|'KIDS',parseSetupName,foldSetupName) : p.physicalProtocol === 4 ? parseRoundStart(wire,p.format as 'MIXED_BOARD'|'STANDALONE_LIST'|'STANDALONE_ACTING') : parseCompetitionStart(wire,p.format);
 if (canonical(parsed.setup) !== canonical(r.setup) || Buffer.byteLength(canonical(r),'utf8') > 65536) return deny('INVALID_REQUEST');
 return { envelopeVersion:6,e3Protocol:1,requestKey:r.requestKey,logicalMatchId:r.logicalMatchId,profile:p,predecessor:{gameId:prior.gameId,originalTerminalHash:prior.originalTerminalHash},setup:parsed.setup };
}
export function createEntaSuccessorService(deps: EntaSuccessorDependencies): EntaSuccessorHandler {
 return async (principal, input) => {
  if (!principal || principal.projectId !== deps.projectId || !principal.verifiedAccount || principal.anonymous || !principal.uid || !principal.email) return deny('VERIFIED_ACCOUNT_REQUIRED',403);
  if (!isRetryOnlySuccessorRepository(deps.repository)) return deny('E3_CAPACITY_UNAVAILABLE',503);
  const captured = { projectId: principal.projectId, uid: principal.uid, anonymous: principal.anonymous, verifiedAccount: principal.verifiedAccount, email: principal.email };
  const request = parseExternalSuccessor(input);
  return deps.repository.compose(captured,request);
 };
}
