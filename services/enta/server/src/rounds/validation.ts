import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { CanvasCommand, ExecutionFormat, GrantCommand, HostCommand, RequestBinding, RoundStart } from './types';
export const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export const HASH = /^[a-f0-9]{64}$/;
const NON_ASCII_SPACE = new Set([0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]);
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return fail(400, 'INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string' || /[<>]/.test(value)) return fail(400, 'INVALID_REQUEST');
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || (c >= 127 && c <= 159) || NON_ASCII_SPACE.has(c) || (c >= 0xdc00 && c <= 0xdfff)) return fail(400, 'INVALID_REQUEST');
    if (c >= 0xd800 && c <= 0xdbff) { const low = value.charCodeAt(++i); if (!(low >= 0xdc00 && low <= 0xdfff)) return fail(400, 'INVALID_REQUEST'); }
  }
  const result = value.replace(/^ +| +$/g, '').normalize('NFC');
  if (result.length < min || result.length > max) return fail(400, 'INVALID_REQUEST');
  return result;
}
export function id(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) return fail(400, 'INVALID_ID'); return value; }
export function integer(value: unknown, min = 1, max = 2_000_000_000): number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) return fail(400, 'INVALID_REQUEST'); return value as number; }
function key(value: unknown): string { if (typeof value !== 'string' || !KEY.test(value)) return fail(400, 'INVALID_COMMAND'); return value; }
export function parseRoundStart(input: unknown, format: ExecutionFormat): RequestBinding {
  const row = exact(input, ['requestKey', 'logicalMatchId', 'setup']), setup = exact(row.setup, ['version', 'categories', 'teams', 'rules']), rules = exact(setup.rules, ['turnSeconds', 'overallSeconds', 'questionSeconds']);
  if (setup.version !== 4 || !Array.isArray(setup.categories) || setup.categories.length !== (format === 'MIXED_BOARD' ? 6 : 1) || !Array.isArray(setup.teams) || setup.teams.length < 2 || setup.teams.length > (format === 'MIXED_BOARD' ? 4 : 2) || ![15, 30, 45].includes(rules.turnSeconds as number) || ![null, 300, 600].includes(rules.overallSeconds as null | number)) return fail(400, 'INVALID_SETUP');
  const categories = setup.categories.map(value => { const category = exact(value, ['key', 'promptRefs']); if (!Array.isArray(category.promptRefs) || category.promptRefs.length > 6) return fail(400, 'INVALID_SETUP'); const refs = category.promptRefs.map(id); if (new Set(refs).size !== refs.length || (format !== 'MIXED_BOARD' && refs.length)) return fail(400, 'INVALID_SETUP'); return { key: id(category.key), promptRefs: refs }; });
  if (new Set(categories.map(category => category.key)).size !== categories.length) return fail(400, 'INVALID_SETUP');
  const teams = setup.teams.map(value => { const team = exact(value, ['name', 'players']); if (!Array.isArray(team.players) || team.players.length < 1 || team.players.length > 8) return fail(400, 'INVALID_SETUP'); const players = team.players.map(player => text(player, 1, 30)); if (new Set(players).size !== players.length) return fail(400, 'INVALID_SETUP'); return { name: text(team.name, 2, 22), players }; });
  if (new Set(teams.map(team => team.name.replace(/[A-Z]/g, letter => letter.toLowerCase()))).size !== teams.length) return fail(400, 'DUPLICATE_TEAM_NAME');
  return { version: 4, operation: format === 'MIXED_BOARD' ? 'PAID_ENTA_CLASSIC' : format === 'STANDALONE_LIST' ? 'PAID_ENTA_LIST' : 'PAID_ENTA_ACTING', executionFormat: format, predecessor: null, requestKey: key(row.requestKey), logicalMatchId: id(row.logicalMatchId), setup: { version: 4, categories, teams, rules: { turnSeconds: rules.turnSeconds as 15 | 30 | 45, overallSeconds: rules.overallSeconds as null | 300 | 600, questionSeconds: integer(rules.questionSeconds, 5, 120) } } };
}
export const requestHash = (request: RequestBinding): string => admissionHash(request);
export function parseHostCommand(input: unknown): HostCommand {
  const type = input && typeof input === 'object' ? (input as Record<string, unknown>).type : null;
  const fields: Record<string, string[]> = { OPEN_ROUND: ['roundId'], NEXT_ROUND: [], PAUSE_ROUND: ['roundId', 'reason'], RESUME_ROUND: ['roundId'], CLOSE_ROUND: ['roundId'], REVEAL_TARGET: ['roundId'], SELECT_SCORING_TEAM: ['roundId', 'teamId'], ASSIGN_ACTOR: ['roundId', 'teamId', 'playerIndex', 'itemId'], JUDGE_ITEM: ['roundId', 'itemId'], ADJUDICATE_ROUND: ['roundId', 'teamId', 'correct'], FINISH: ['confirmEarly'] };
  if (typeof type !== 'string' || !Object.hasOwn(fields, type)) return fail(400, 'INVALID_COMMAND');
  const row = exact(input, ['commandId', 'expectedVersion', 'type', ...fields[type]]);
  key(row.commandId); integer(row.expectedVersion);
  if (Object.hasOwn(row, 'roundId')) id(row.roundId);
  if (Object.hasOwn(row, 'teamId') && row.teamId !== null) id(row.teamId);
  if (Object.hasOwn(row, 'itemId') && row.itemId !== null) id(row.itemId);
  if (type === 'JUDGE_ITEM' && row.itemId === null || type === 'SELECT_SCORING_TEAM' && row.teamId === null || type === 'ASSIGN_ACTOR' && row.teamId === null) return fail(400, 'INVALID_COMMAND');
  if (type === 'ASSIGN_ACTOR') integer(row.playerIndex, 0, 7);
  if (type === 'PAUSE_ROUND') row.reason = text(row.reason, 3, 160);
  if (type === 'FINISH' && typeof row.confirmEarly !== 'boolean' || type === 'ADJUDICATE_ROUND' && (typeof row.correct !== 'boolean' || (row.correct ? row.teamId === null : row.teamId !== null))) return fail(400, 'INVALID_COMMAND');
  return row as unknown as HostCommand;
}
export function parseGrantCommand(input: unknown): GrantCommand {
  const type = input && typeof input === 'object' ? (input as Record<string, unknown>).type : null;
  const fields = type === 'CREATE_GRANT' ? ['role', 'durationSeconds'] : type === 'ROTATE_GRANT' ? ['scopeId', 'expectedGeneration', 'durationSeconds'] : type === 'REVOKE_GRANT' ? ['scopeId'] : null;
  if (!fields) return fail(400, 'INVALID_COMMAND'); const row = exact(input, ['commandId', 'expectedVersion', 'roundId', 'type', ...fields]); key(row.commandId); integer(row.expectedVersion); id(row.roundId);
  if (type === 'CREATE_GRANT' && !['JUDGE', 'ACTOR'].includes(row.role as string)) return fail(400, 'INVALID_COMMAND');
  if (type !== 'CREATE_GRANT') id(row.scopeId);
  if (type === 'ROTATE_GRANT') integer(row.expectedGeneration);
  if (type !== 'REVOKE_GRANT') integer(row.durationSeconds, 1, 600);
  return row as unknown as GrantCommand;
}
export function parseCanvasCommand(input: unknown): CanvasCommand {
  const type = input && typeof input === 'object' ? (input as Record<string, unknown>).type : null;
  if (!['APPEND', 'UNDO', 'REDO', 'CLEAR'].includes(type as string)) return fail(400, 'INVALID_CANVAS_COMMAND');
  const row = exact(input, ['commandId', 'expectedRevision', 'type', ...(type === 'APPEND' ? ['stroke'] : [])]); key(row.commandId); integer(row.expectedRevision, 0);
  if (type === 'APPEND') { const stroke = exact(row.stroke, ['id', 'color', 'width', 'erase', 'points']); id(stroke.id); if (!['#191615', '#ffffff', '#ff2e95', '#3478bd', '#267448'].includes(stroke.color as string) || ![2, 5, 10].includes(stroke.width as number) || typeof stroke.erase !== 'boolean' || !Array.isArray(stroke.points) || stroke.points.length < 1 || stroke.points.length > 256) return fail(400, 'INVALID_STROKE'); for (const point of stroke.points) { if (!Array.isArray(point) || point.length !== 2) return fail(400, 'INVALID_STROKE'); integer(point[0], 0, 10000); integer(point[1], 0, 10000); } }
  return row as unknown as CanvasCommand;
}
export function startWire(request: RequestBinding): RoundStart { return { requestKey: request.requestKey, logicalMatchId: request.logicalMatchId, setup: request.setup }; }
