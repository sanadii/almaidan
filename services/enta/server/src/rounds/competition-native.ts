import { fail } from '../gameplay/types';
import { boundedValue, PROJECTION_BYTES } from './competition-content';
import type { projectCompetition, projectCompetitionCapability } from './competition-projection';
import { engineResultHash } from './competition-results';
import { TEAM_PALETTE } from './competition-rules';
import type { EngineResultPayload } from './competition-types';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import type { Canvas } from './types';

/** Physical SQL output only. This type contains the approved public projection,
 * never an authority context or a DTO-or-CompetitionGame fallback. The oracle
 * projection supplies the field types so both producers keep the same wire. */
export interface CompetitionNativeMatch extends ReturnType<typeof projectCompetition> {}
export interface CompetitionNativeScope {
  gameId: string; projectId: string; principal: string; purpose: 'OWNER' | 'JUDGE' | 'ACTOR'; visibility: string; snapshot: number;
  roundId: string | null; roundVersion: number | null; format: string | null; itemTotal: number; canvasRevision: number | null;
  assignmentGeneration: number | null; grant: CompetitionNativeMatch['grants'][number] | null;
}

const MAIN_KEYS = ['id', 'requestVersion', 'rulesVersion', 'version', 'executionFormat', 'serverNow', 'finished', 'turnTeamId', 'collections', 'teams', 'categories', 'rounds', 'currentRound', 'allowances', 'attempts', 'rulings', 'latestEffect', 'review', 'boardCorrectionRoundId', 'grants', 'result'];
const PRIVATE_KEYS = new Set(['token', 'tokenHash', 'objectKey', 'objectVersion', 'chunks', 'correctAttemptIds', 'originalAttemptIds', 'eligiblePlayerIds', 'eligibilityHash', 'disclosureHead', 'clientBinding', 'fullIntent', 'intent', 'request', 'pin', 'receipts', 'redoIds']);
const AIDS = ['PHONE_A_FRIEND', 'DOUBLE_ANSWER', 'MORE_HINT', 'TRAP', 'PICK_ANSWERER', 'STEAL_POINTS', 'DOUBLE_POINTS', 'HINT', 'PASS', 'FREEZE', 'DOUBLE', 'PHONE'];
const FORMATS = ['ORDINARY_TIER', 'DRAWING_TARGET', 'LIST_ITEMS', 'ACTING_ITEMS'];
const PHASES = ['READY', 'MAIN', 'TRAP', 'STEAL', 'SHARED', 'TURN', 'AWAITING_RULING', 'RESOLVED'];
const bad = () => fail(503, 'MATCH_DATA_UNAVAILABLE');
function identifier(value: unknown): void { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) bad(); }
function nullableId(value: unknown): void { if (value !== null) identifier(value); }
function numeric(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): void { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) bad(); }
function nullableNumber(value: unknown): void { if (value !== null) numeric(value); }
function bool(value: unknown): void { if (typeof value !== 'boolean') bad(); }
function points(value: unknown): void { if (value !== null && ![200, 400, 600].includes(value as number)) bad(); }
function enumValue(value: unknown, values: readonly string[]): void { if (typeof value !== 'string' || !values.includes(value)) bad(); }
function hash(value: unknown): void { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) bad(); }
function label(value: unknown, max: number): void { if (typeof value !== 'string' || value.length < 1 || value.length > max) bad(); }
function publicMedia(value: unknown): void { const m = object(value, ['id', 'mime', 'bytes', 'width', 'height', 'durationMs']); identifier(m.id); enumValue(m.mime, ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']); numeric(m.bytes, 1, 67108864); numeric(m.width, 1, 16000000); numeric(m.height, 1, 16000000); if ((m.width as number) * (m.height as number) > 16000000) bad(); if (m.durationMs !== null) numeric(m.durationMs, 1, 120000); }
function result(value: unknown, gameId: string): void {
  const r = object(value, ['payload', 'hash']), p = object(r.payload, ['schemaVersion', 'rulesVersion', 'requestVersion', 'executionFormat', 'projectId', 'engine', 'gameId', 'admissionId', 'logicalMatchId', 'resultVersion', 'predecessor', 'terminal', 'authority', 'participants', 'reason', 'prescribedCount', 'completedCount', 'unplayedCount', 'outcome', 'scores', 'winnerParticipantIds', 'tournamentBinding']);
  if (p.schemaVersion !== 1 || p.rulesVersion !== 'enta-competitive-1' || p.requestVersion !== 5 || p.engine !== 'ENTA' || p.gameId !== gameId || p.logicalMatchId !== gameId || typeof p.projectId !== 'string' || !p.projectId || p.tournamentBinding !== null || p.predecessor !== null || p.resultVersion !== 1) bad();
  identifier(p.admissionId); enumValue(p.executionFormat, ['MIXED_BOARD', 'TIER_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING']);
  const terminal = object(p.terminal, ['eventId', 'revision']), authority = object(p.authority, ['eventId', 'kind', 'correctionReason']); identifier(terminal.eventId); numeric(terminal.revision, 1, 64946); identifier(authority.eventId); enumValue(authority.kind, ['HOST']); if (authority.correctionReason !== null || authority.eventId !== terminal.eventId) bad();
  const participants = rows(p.participants, 4); if (participants.length < 2 || new Set(participants).size !== participants.length) bad(); participants.forEach(identifier);
  enumValue(p.reason, ['ALL_ROUNDS', 'HOST_ENDED']); enumValue(p.outcome, ['DECISIVE', 'UNRESOLVED_TIE', 'HOST_ENDED']); for (const field of ['prescribedCount', 'completedCount', 'unplayedCount']) numeric(p[field], 0, 36); if ((p.completedCount as number) + (p.unplayedCount as number) !== p.prescribedCount) bad();
  const scores = rows(p.scores, 4); if (scores.length !== participants.length) bad(); const ids: unknown[] = []; for (const row of scores) { const score = object(row, ['participantId', 'score']); if (!participants.includes(score.participantId)) bad(); ids.push(score.participantId); numeric(score.score, -2147483648, 2147483647); } if (new Set(ids).size !== ids.length) bad();
  const winners = rows(p.winnerParticipantIds, 4); if (new Set(winners).size !== winners.length || winners.some(id => !participants.includes(id))) bad(); hash(r.hash); if (r.hash !== engineResultHash(p as unknown as EngineResultPayload)) bad();
}
export function readCompetitionNativeScope(value: unknown, gameId: string, project: string): CompetitionNativeScope {
  boundedValue(value, 8192, 'PROJECTION_BOUND_EXCEEDED');
  const scope = object(value, ['gameId', 'projectId', 'principal', 'purpose', 'visibility', 'snapshot', 'roundId', 'roundVersion', 'format', 'itemTotal', 'canvasRevision', 'assignmentGeneration', 'grant']);
  if (scope.gameId !== gameId || scope.projectId !== project || typeof scope.principal !== 'string' || !scope.principal) bad();
  enumValue(scope.purpose, ['OWNER', 'JUDGE', 'ACTOR']); hash(scope.visibility); numeric(scope.snapshot, 1, 64946); nullableId(scope.roundId); if (scope.roundVersion !== null) numeric(scope.roundVersion, 0, 2000000000); if (scope.format !== null) enumValue(scope.format, FORMATS); numeric(scope.itemTotal, 0, 128); if (scope.canvasRevision !== null) numeric(scope.canvasRevision, 0, 512); if (scope.assignmentGeneration !== null) numeric(scope.assignmentGeneration, 1, 2000000000);
  if (scope.purpose === 'OWNER') { if (scope.grant !== null) bad(); }
  else { const grant = object(scope.grant, ['id', 'scopeId', 'roundId', 'role', 'generation', 'expiresAt', 'revoked']); for (const field of ['id', 'scopeId', 'roundId']) identifier(grant[field]); if (grant.id !== scope.principal || grant.roundId !== scope.roundId || grant.role !== scope.purpose || grant.revoked !== false) bad(); numeric(grant.generation, 1, 2000000000); numeric(grant.expiresAt); }
  return value as CompetitionNativeScope;
}
export function readCompetitionNativeCapability(value: unknown, scope: CompetitionNativeScope): ReturnType<typeof projectCompetitionCapability> {
  boundedValue(value, PROJECTION_BYTES, 'PROJECTION_BOUND_EXCEEDED');
  const data = object(value, ['gameId', 'gameVersion', 'serverNow', 'roundId', 'roundVersion', 'assignmentGeneration', 'role', 'format', 'grant', 'deadline', 'media', 'mediaTotal', ...(scope.purpose === 'JUDGE' ? ['grading'] : ['target', 'canvas'])]);
  if (scope.purpose === 'OWNER' || data.gameId !== scope.gameId || data.gameVersion !== scope.snapshot || data.roundId !== scope.roundId || data.roundVersion !== scope.roundVersion || data.assignmentGeneration !== scope.assignmentGeneration || data.role !== scope.purpose || data.format !== scope.format || admissionHash(data.grant) !== admissionHash(scope.grant)) bad();
  numeric(data.serverNow); nullableNumber(data.deadline); rows(data.media, 0); numeric(data.mediaTotal, 0, 260);
  if (scope.purpose === 'JUDGE') { const grading = object(data.grading, ['roundId', 'version', 'format', 'total', 'items']); if (grading.roundId !== scope.roundId || grading.version !== scope.roundVersion || grading.format !== scope.format || grading.total !== scope.itemTotal || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(scope.format ?? '')) bad(); rows(grading.items, 0); }
  else { label(data.target, 512); if (!['DRAWING_TARGET', 'ACTING_ITEMS'].includes(scope.format ?? '')) bad(); if (scope.format === 'DRAWING_TARGET') { if (object(data.canvas, ['revision']).revision !== scope.canvasRevision) bad(); } else if (data.canvas !== null) bad(); }
  clean(data); return value as ReturnType<typeof projectCompetitionCapability>;
}
export function readCompetitionNativeCanvasRows(value: unknown): Canvas['strokes'] {
  boundedValue(value, 131072, 'PAGE_BOUND_EXCEEDED');
  for (const row of rows(value, 16)) { const stroke = object(row, ['id', 'color', 'width', 'erase', 'points']); identifier(stroke.id); enumValue(stroke.color, ['#191615', '#ffffff', '#ff2e95', '#3478bd', '#267448']); if (![2, 5, 10].includes(stroke.width as number)) bad(); bool(stroke.erase); const points = rows(stroke.points, 256); if (!points.length) bad(); for (const point of points) { const coordinates = rows(point, 2); if (coordinates.length !== 2) bad(); coordinates.forEach(value => numeric(value, 0, 10000)); } }
  return value as Canvas['strokes'];
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  return value as Record<string, unknown>;
}
function rows(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  return value;
}
function clean(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(clean); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) { if (PRIVATE_KEYS.has(key)) return fail(503, 'MATCH_DATA_UNAVAILABLE'); clean(child); }
}

/** Validate the compact transport itself, without loading/projecting a game.
 * SQL is the authorization and immutable-proof authority. */
export function readCompetitionNativeMatch(value: unknown, gameId: string): CompetitionNativeMatch {
  boundedValue(value, PROJECTION_BYTES, 'PROJECTION_BOUND_EXCEEDED');
  const main = object(value, MAIN_KEYS);
  if (main.id !== gameId || main.requestVersion !== 5 || main.rulesVersion !== 'enta-competitive-1' || !Number.isSafeInteger(main.version) || (main.version as number) < 1 || (main.version as number) > 64946 || typeof main.finished !== 'boolean' || typeof main.serverNow !== 'number' || !Number.isFinite(main.serverNow) || !['MIXED_BOARD', 'TIER_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING'].includes(main.executionFormat as string)) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  const counts = object(main.collections, ['pending', 'rulings', 'feedback', 'media']);
  for (const count of Object.values(counts)) if (!Number.isSafeInteger(count) || (count as number) < 0) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  const teams = rows(main.teams, 4);
  if (teams.length < 2) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  for (const value of teams) { const team = object(value, ['id', 'name', 'colorKey', 'color', 'players', 'score', 'aids']); identifier(team.id); label(team.name, 22); enumValue(team.colorKey, Object.keys(TEAM_PALETTE)); if (team.color !== TEAM_PALETTE[team.colorKey as keyof typeof TEAM_PALETTE].color) bad(); numeric(team.score, -2147483648, 2147483647); const players = rows(team.players, 8); if (!players.length) bad(); for (const value of players) { const player = object(value, ['id', 'name']); identifier(player.id); label(player.name, 30); } const aids = rows(team.aids, 7); aids.forEach(aid => enumValue(aid, AIDS)); if (new Set(aids).size !== aids.length) bad(); }
  identifier(main.turnTeamId); if (!teams.some(t => (t as { id: string }).id === main.turnTeamId)) bad();
  for (const value of rows(main.categories, 6)) { const category = object(value, ['key', 'label', 'format', 'cover']); identifier(category.key); label(category.label, 64); enumValue(category.format, FORMATS); if (category.cover !== null) publicMedia(category.cover); }
  for (const value of rows(main.rounds, 36)) { const round = object(value, ['id', 'ordinal', 'categoryKey', 'format', 'points', 'phase']); identifier(round.id); identifier(round.categoryKey); numeric(round.ordinal, 0, 35); enumValue(round.format, FORMATS); enumValue(round.phase, PHASES); points(round.points); }
  for (const value of rows(main.allowances, 28)) { const allowance = object(value, ['id', 'teamId', 'aid', 'roundId', 'consumed']); identifier(allowance.id); identifier(allowance.teamId); nullableId(allowance.roundId); enumValue(allowance.aid, AIDS); bool(allowance.consumed); }
  if (rows(main.attempts, 0).length || rows(main.rulings, 0).length) return fail(503, 'MATCH_DATA_UNAVAILABLE');
  for (const value of rows(main.grants, 2)) { const grant = object(value, ['id', 'scopeId', 'roundId', 'role', 'generation', 'expiresAt', 'revoked']); for (const key of ['id', 'scopeId', 'roundId']) identifier(grant[key]); enumValue(grant.role, ['JUDGE', 'ACTOR']); numeric(grant.generation, 1, 2000000000); numeric(grant.expiresAt); bool(grant.revoked); }
  if (main.currentRound !== null) {
    const current = main.currentRound as Record<string, unknown>;
    object(current, ['id', 'version', 'phase', 'phaseOrdinal', 'generation', 'format', 'prompt', 'points', 'originalTeamId', 'currentTeamId', 'deadline', 'overallDeadline', 'pause', 'resourceStop', 'publicRevealed', 'items', 'hints', 'graphemeHints', 'assignment', 'pickedPlayerId', 'eligibleAids', 'media', 'canvas', ...(Object.hasOwn(current, 'target') ? ['target'] : [])]);
    identifier(current.id); numeric(current.version, 0, 2000000000); enumValue(current.phase, PHASES); enumValue(current.format, FORMATS); numeric(current.phaseOrdinal, 0, 2000000000); numeric(current.generation, 0, 2000000000); label(current.prompt, 2000); points(current.points); nullableId(current.originalTeamId); nullableId(current.currentTeamId); nullableId(current.pickedPlayerId); nullableNumber(current.deadline); nullableNumber(current.overallDeadline); bool(current.publicRevealed);
    if (Object.hasOwn(current, 'target') && current.publicRevealed !== true) return fail(503, 'MATCH_DATA_UNAVAILABLE');
    if (Object.hasOwn(current, 'target')) label(current.target, 512);
    for (const value of rows(current.items, 128)) { const item = object(value, ['id', 'ordinal', 'consumed', 'revealed']); identifier(item.id); numeric(item.ordinal, 0, 127); bool(item.consumed); bool(item.revealed); }
    for (const value of rows(current.hints, 4)) { const hint = object(value, ['id', 'text']); identifier(hint.id); label(hint.text, 512); }
    rows(current.graphemeHints, 0); rows(current.media, 0); rows(current.eligibleAids, 7).forEach(aid => enumValue(aid, AIDS));
    if (current.canvas !== null) numeric(object(current.canvas, ['revision']).revision, 0, 512);
    if (current.assignment !== null) { const assignment = object(current.assignment, ['teamId', 'playerId', 'itemId', 'generation']); identifier(assignment.teamId); identifier(assignment.playerId); nullableId(assignment.itemId); numeric(assignment.generation, 1, 2000000000); }
    if (current.pause !== null) { const pause = object(current.pause, ['cause', 'resumeAt', 'phaseRemaining', 'overallRemaining']); enumValue(pause.cause, ['PHONE', 'FREEZE', 'ADMIN']); for (const value of [pause.resumeAt, pause.phaseRemaining, pause.overallRemaining]) nullableNumber(value); }
    if (current.resourceStop !== null) { const stop = object(current.resourceStop, ['eventId', 'at', 'reason']); identifier(stop.eventId); numeric(stop.at); enumValue(stop.reason, ['SYSTEM_CAPACITY', 'GENERATION_BOUND']); }
  }
  if (main.latestEffect !== null) { const effect = object(main.latestEffect, ['id', 'hash', 'kind', 'reversible', 'postings']); identifier(effect.id); hash(effect.hash); enumValue(effect.kind, ['AID', 'RULING', 'NO_SCORE', 'INTERIM', 'TIMING', 'DISCLOSURE', 'REVERSAL', 'CORRECTION', 'FINISH']); bool(effect.reversible); for (const value of rows(effect.postings, 4)) { const posting = object(value, ['teamId', 'delta']); identifier(posting.teamId); numeric(posting.delta, -4294967295, 4294967295); } }
  if (main.review !== null) { const review = object(main.review, ['id', 'hash', 'roundId', 'itemId', 'originalEffectId', 'rulingVersion']); for (const key of ['id', 'roundId', 'originalEffectId']) identifier(review[key]); nullableId(review.itemId); hash(review.hash); numeric(review.rulingVersion, 1, 257); }
  nullableId(main.boardCorrectionRoundId); if (main.result !== null) { result(main.result, gameId); const published = main.result as { payload: { terminal: { revision: number } } }; if (main.finished !== true || published.payload.terminal.revision !== main.version) bad(); } else if (main.finished === true) bad();
  clean(value);
  return value as CompetitionNativeMatch;
}
