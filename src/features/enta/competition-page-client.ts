import { EntaClientError, pendingName } from './client';
import { exactRound, parsePublicMedia } from './round-client';
import type { PublicMedia } from './protected-media';
import type { CompetitionMatch } from './competition-client';
export type PageCollection = 'pending' | 'correction' | 'rulings' | 'feedback' | 'media' | 'grading';
export type AttemptRow = CompetitionMatch['attempts'][number];
export type CorrectionRow = AttemptRow & { effectId: string; effectHash: string; rulingVersion: number; reversed: boolean; effectKind: 'RULING' | 'NO_SCORE' | 'REVERSAL' | 'CORRECTION' };
export type RulingRow = Omit<CompetitionMatch['rulings'][number], 'correctAttemptIds'> & { correctAttemptCount: number };
export interface FeedbackRow { id: string; ordinal: number; consumed: boolean; revealed: boolean; text?: string; value?: number; trap?: boolean; mediaIds?: string[]; grapheme?: string }
export interface ClientPageRequest { collection: PageCollection; roundId: string | null; effectId: string | null; snapshot: number; cursor: string | null }
export interface ClientPage<T> { rows: T[]; total: number; returned: number; offset: number; nextCursor: string | null; complete: boolean; revision: number; snapshot: string }
const sizes = { pending: 64, correction: 64, rulings: 32, feedback: 16, media: 64, grading: 16 };
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const integer = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const bad = (): never => { throw new EntaClientError('MALFORMED_RESPONSE'); };
export function parseMediaRow(input: unknown): PublicMedia { parsePublicMedia(input); return input as PublicMedia; }
export function parseFeedbackRow(input: unknown): FeedbackRow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(); const row = input as Record<string, unknown>;
  exactRound(row, ['id', 'ordinal', 'consumed', 'revealed', ...(Object.hasOwn(row, 'text') ? ['text', 'value', 'trap', 'mediaIds'] : []), ...(Object.hasOwn(row, 'grapheme') ? ['grapheme'] : [])]);
  if (!id(row.id) || !integer(row.ordinal, 127) || typeof row.consumed !== 'boolean' || typeof row.revealed !== 'boolean' || Object.hasOwn(row, 'text') && (!row.revealed || !pendingName(row.text, 1, 512) || !integer(row.value, 10000) || row.value === 0 || typeof row.trap !== 'boolean' || !Array.isArray(row.mediaIds) || row.mediaIds.length > 260 || !row.mediaIds.every(id) || new Set(row.mediaIds).size !== row.mediaIds.length) || Object.hasOwn(row, 'grapheme') && (row.revealed || !pendingName(row.grapheme, 1, 64))) return bad(); return row as unknown as FeedbackRow;
}
export function parseGradingRow(input: unknown): FeedbackRow { const row = parseFeedbackRow(input); if (!row.revealed || row.text === undefined || row.grapheme !== undefined) return bad(); return row; }
export function parseAttemptRow(input: unknown): AttemptRow {
  const a = exactRound(input, ['id', 'roundId', 'itemId', 'phase', 'phaseOrdinal', 'teamId', 'playerId', 'acceptedAt', 'classification']);
  if (typeof a.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(a.id) || ![a.roundId, a.teamId, a.playerId].every(id) || a.itemId !== null && !id(a.itemId) || !integer(a.phaseOrdinal, 2_000_000_000) || a.phaseOrdinal === 0 || !['MAIN', 'TRAP', 'STEAL', 'SHARED', 'TURN'].includes(a.phase as string) || typeof a.acceptedAt !== 'number' || !Number.isFinite(a.acceptedAt) || a.classification !== null && typeof a.classification !== 'boolean') return bad();
  return a as unknown as AttemptRow;
}
export function parseCorrectionRow(input: unknown): CorrectionRow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad(); const { effectId, effectHash, rulingVersion, reversed, effectKind, ...attempt } = input as Record<string, unknown>; const row = parseAttemptRow(attempt);
  if (!id(effectId) || typeof effectHash !== 'string' || !/^[a-f0-9]{64}$/.test(effectHash) || !integer(rulingVersion, 257) || rulingVersion === 0 || typeof reversed !== 'boolean' || !['RULING', 'NO_SCORE', 'REVERSAL', 'CORRECTION'].includes(effectKind as string) || typeof row.classification !== 'boolean') return bad(); return { ...row, effectId, effectHash, rulingVersion, reversed, effectKind } as CorrectionRow;
}
export function parseRulingRow(input: unknown): RulingRow {
  const h = exactRound(input, ['roundId', 'itemId', 'originalEffectId', 'effectId', 'version', 'hash', 'reversed', 'correctAttemptCount']);
  if (![h.roundId, h.originalEffectId, h.effectId].every(id) || h.itemId !== null && !id(h.itemId) || !integer(h.version, 257) || h.version === 0 || typeof h.hash !== 'string' || !/^[a-f0-9]{64}$/.test(h.hash) || typeof h.reversed !== 'boolean' || !integer(h.correctAttemptCount, 512)) return bad();
  return h as unknown as RulingRow;
}
export function parseCompetitionPage<T>(input: unknown, gameId: string, request: ClientPageRequest, parseRow: (input: unknown) => T, purpose: 'OWNER' | 'JUDGE' | 'ACTOR' = 'OWNER'): ClientPage<T> {
  const p = exactRound(input, ['scope', 'revision', 'snapshot', 'total', 'returned', 'offset', 'nextCursor', 'complete', 'rows']), scope = exactRound(p.scope, ['gameId', 'collection', 'roundId', 'effectId', 'purpose']);
  if (scope.gameId !== gameId || scope.collection !== request.collection || scope.roundId !== request.roundId || scope.effectId !== request.effectId || scope.purpose !== purpose || p.revision !== request.snapshot || typeof p.snapshot !== 'string' || !/^[a-f0-9]{64}$/.test(p.snapshot) || !integer(p.total, request.collection === 'rulings' ? 4644 : request.collection === 'media' ? 260 : request.collection === 'feedback' || request.collection === 'grading' ? 128 : 512) || !integer(p.offset, p.total) || !integer(p.returned, sizes[request.collection]) || !Array.isArray(p.rows) || p.rows.length !== p.returned || p.returned !== Math.min(sizes[request.collection], p.total - p.offset) || typeof p.complete !== 'boolean' || p.complete !== (p.offset + p.returned === p.total) || p.nextCursor !== null && (typeof p.nextCursor !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(p.nextCursor) || p.nextCursor.length > 4096) || (p.nextCursor === null) !== p.complete || new TextEncoder().encode(JSON.stringify(p.rows)).byteLength > 65536) return bad();
  const rows = p.rows.map(parseRow);
  if (request.collection === 'pending' && rows.some(row => (row as AttemptRow).roundId !== request.roundId || (row as AttemptRow).classification !== null)) return bad();
  if (request.collection === 'correction' && rows.some(row => (row as CorrectionRow).effectId !== request.effectId || (row as CorrectionRow).effectHash !== (rows[0] as CorrectionRow).effectHash || (row as CorrectionRow).rulingVersion !== (rows[0] as CorrectionRow).rulingVersion || (row as CorrectionRow).reversed !== (rows[0] as CorrectionRow).reversed || (row as CorrectionRow).effectKind !== (rows[0] as CorrectionRow).effectKind)) return bad();
  return { rows, total: p.total, returned: p.returned, offset: p.offset, nextCursor: p.nextCursor as string | null, complete: p.complete, revision: p.revision as number, snapshot: p.snapshot };
}
