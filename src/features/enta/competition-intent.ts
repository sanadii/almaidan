import type { CompetitionCommand } from './competition-client';
import { EntaClientError, pendingStartStorageKey } from './client';
import { exactRound } from './round-client';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const id = (x: unknown) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x);
const integer = (x: unknown, min = 1, max = 2_000_000_000) => Number.isSafeInteger(x) && (x as number) >= min && (x as number) <= max;
const fields: Record<string, string[]> = { OPEN_ROUND: ['roundId'], NEXT_ROUND: [], USE_AID: ['roundId', 'teamId', 'aid'], RECORD_ATTEMPT: ['roundId', 'teamId', 'playerId', 'itemId'], INTERIM_WRONG: ['roundId', 'attemptId'], PUBLIC_REVEAL: ['roundId', 'itemId'], FINAL_RULING: ['roundId', 'itemId', 'classifications'], REVEAL_HINT: ['roundId'], END_ASSISTANCE: ['roundId'], RESUME_ROUND: ['roundId'], CLOSE_ROUND: ['roundId'], PAUSE_ROUND: ['roundId', 'reason'], SELECT_SCORING_TEAM: ['roundId', 'teamId'], ASSIGN_ACTOR: ['roundId', 'teamId', 'playerId', 'itemId'], CREATE_GRANT: ['roundId', 'role', 'durationSeconds'], ROTATE_GRANT: ['roundId', 'scopeId', 'expectedGeneration', 'durationSeconds'], REVOKE_GRANT: ['roundId', 'scopeId'], UNDO_EFFECT: ['effectId', 'effectHash'], CORRECT_RULING: ['effectId', 'rulingVersion', 'correctAttemptIds', 'reason'], RESOLVE_ITEM_REVIEW: ['reviewId', 'reviewHash', 'rulingVersion', 'mode', 'correctAttemptIds', 'reason'], REPORT_VAR: ['roundId', 'effectId', 'blockingIds', 'reason'], FINISH: ['confirmEarly'], RESOLVE_TIE: ['resultHash'] };
const bad = (): never => { throw new EntaClientError('PENDING_COMMAND_INVALID'); };
export function parseDurableCompetitionCommand(input: unknown): CompetitionCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(); const type = (input as Record<string, unknown>).type;
  if (typeof type !== 'string' || !Object.hasOwn(fields, type)) return bad(); const r = exactRound(input, ['commandId', 'expectedVersion', 'type', ...fields[type]]);
  if (typeof r.commandId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(r.commandId) || !integer(r.expectedVersion)) return bad();
  for (const key of ['roundId', 'teamId', 'playerId', 'attemptId', 'scopeId', 'reviewId']) if (Object.hasOwn(r, key) && !id(r[key])) return bad();
  for (const key of ['effectId', 'itemId']) if (Object.hasOwn(r, key) && r[key] !== null && !id(r[key])) return bad();
  for (const key of ['effectHash', 'reviewHash', 'resultHash']) if (Object.hasOwn(r, key) && (typeof r[key] !== 'string' || !/^[a-f0-9]{64}$/.test(r[key] as string))) return bad();
  for (const key of ['correctAttemptIds', 'blockingIds']) if (Object.hasOwn(r, key)) { const rows = r[key]; if (!Array.isArray(rows) || rows.length > (key === 'blockingIds' ? 32 : 512) || rows.some(x => key === 'blockingIds' ? !id(x) : typeof x !== 'string' || !uuid.test(x)) || new Set(rows).size !== rows.length) return bad(); }
  if (type === 'FINAL_RULING') { const rows = r.classifications; if (!Array.isArray(rows) || rows.length > 512 || rows.some(x => !Array.isArray(x) || x.length !== 2 || typeof x[0] !== 'string' || !uuid.test(x[0]) || typeof x[1] !== 'boolean') || new Set(rows.map(x => x[0])).size !== rows.length) return bad(); }
  if (type === 'USE_AID' && !['PHONE_A_FRIEND', 'DOUBLE_ANSWER', 'MORE_HINT', 'TRAP', 'PICK_ANSWERER', 'STEAL_POINTS', 'DOUBLE_POINTS', 'HINT', 'PASS', 'FREEZE', 'DOUBLE', 'PHONE'].includes(r.aid as string) || type === 'CREATE_GRANT' && !['ACTOR', 'JUDGE'].includes(r.role as string) || type === 'FINISH' && typeof r.confirmEarly !== 'boolean' || type === 'RESOLVE_ITEM_REVIEW' && (!['RESTORE_ORIGINAL', 'REPLACE'].includes(r.mode as string) || r.mode === 'RESTORE_ORIGINAL' && (r.correctAttemptIds as unknown[]).length !== 0)) return bad();
  if (Object.hasOwn(r, 'durationSeconds') && !integer(r.durationSeconds, 1, 600) || Object.hasOwn(r, 'rulingVersion') && !integer(r.rulingVersion) || Object.hasOwn(r, 'expectedGeneration') && !integer(r.expectedGeneration) || ['UNDO_EFFECT', 'CORRECT_RULING'].includes(type) && r.effectId === null) return bad();
  if (Object.hasOwn(r, 'reason') && (typeof r.reason !== 'string' || r.reason.length < 3 || r.reason.length > 240 || /[<>\x00-\x1f\x7f-\x9f]/.test(r.reason))) return bad();
  if (new TextEncoder().encode(JSON.stringify(r)).byteLength > 32768) return bad(); return r as unknown as CompetitionCommand;
}
export const competitionCommandStorageKey = (uid: string, gameId: string) => `${pendingStartStorageKey(uid)}:command:${gameId}`;
const project = () => import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'unconfigured';
export function readCompetitionCommand(uid: string, gameId: string): CompetitionCommand | null {
  const raw = sessionStorage.getItem(competitionCommandStorageKey(uid, gameId)); if (raw === null) return null;
  if (new TextEncoder().encode(raw).byteLength > 33792) return bad(); let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return bad(); }
  const r = exactRound(parsed, ['version', 'principal', 'project', 'gameId', 'command']); if (r.version !== 1 || r.principal !== uid || r.project !== project() || r.gameId !== gameId) return bad(); return parseDurableCompetitionCommand(r.command);
}
export function saveCompetitionCommand(uid: string, gameId: string, command: CompetitionCommand): void {
  const current = readCompetitionCommand(uid, gameId), parsed = parseDurableCompetitionCommand(command);
  if (current && JSON.stringify(current) !== JSON.stringify(parsed)) throw new EntaClientError('PENDING_COMMAND_OCCUPIED');
  sessionStorage.setItem(competitionCommandStorageKey(uid, gameId), JSON.stringify({ version: 1, principal: uid, project: project(), gameId, command: parsed }));
}
export function clearCompetitionCommand(uid: string, gameId: string, command: CompetitionCommand): void {
  const current = readCompetitionCommand(uid, gameId); if (!current || JSON.stringify(current) !== JSON.stringify(command)) throw new EntaClientError('PENDING_COMMAND_CONFLICT'); sessionStorage.removeItem(competitionCommandStorageKey(uid, gameId));
}

export function commandCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(commandCanonical).join(',')}]`;
  const row = value as Record<string, unknown>; return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${commandCanonical(row[key])}`).join(',')}}`;
}
/** Only the exact closed owner command is hashed. No private view, grading,
 * token, target, page or media data belongs to durable retry material. */
export async function verifyCompetitionCommandReceipt(input: unknown, gameId: string, command: CompetitionCommand, state: 'ACCEPTED' | 'ABSENT'): Promise<void> {
  const r = exactRound(input, ['state', 'gameId', 'commandId', 'expectedVersion', 'hash', 'eventId', 'revision']);
  if (r.state !== state || r.gameId !== gameId || r.commandId !== command.commandId || r.expectedVersion !== command.expectedVersion || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash) || !integer(r.revision, 1, 64946) || (state === 'ABSENT' ? r.eventId !== null || (r.revision as number) <= command.expectedVersion : !id(r.eventId) || (r.revision as number) < command.expectedVersion)) return bad();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commandCanonical(parseDurableCompetitionCommand(command))));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''); if (hash !== r.hash) return bad();
}

export async function verifyCompetitionCommandRejection(input: unknown, uid: string, gameId: string, command: CompetitionCommand, reason: string): Promise<void> {
  const r = exactRound(input, ['version', 'state', 'projectId', 'principalUid', 'gameId', 'commandId', 'hash', 'expectedVersion', 'currentRevision', 'reason']);
  if (r.version !== 1 || r.state !== 'REJECTED' || r.projectId !== project() || r.principalUid !== uid || r.gameId !== gameId || r.commandId !== command.commandId || r.expectedVersion !== command.expectedVersion || r.currentRevision !== command.expectedVersion || r.reason !== reason || !['OPTIONAL_CAPACITY_EXHAUSTED', 'ATTEMPT_BUDGET_EXCEEDED'].includes(reason) || typeof r.hash !== 'string' || !/^[a-f0-9]{64}$/.test(r.hash)) return bad();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commandCanonical(parseDurableCompetitionCommand(command))));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''); if (hash !== r.hash) return bad();
}
