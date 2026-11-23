import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { admissionHash, canonicalJson } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { publicMedia } from './projection';
import { competitionMedia } from './competition-projection';
import { boundedValue, PROJECTION_BYTES } from './competition-content';
import { exact, id, integer } from './validation';
import type { CompetitionGame, CompetitionRound } from './competition-types';
import type { Grant } from './types';
export type CompetitionCollection = 'pending' | 'feedback' | 'rulings' | 'correction' | 'media' | 'grading';
export const COMPETITION_PAGE_SIZES = { pending: 64, feedback: 16, rulings: 32, correction: 64, media: 64, grading: 16, canvas: 16, 'catalog-categories': 32, 'catalog-prompts': 64 } as const;
export interface PageScope { principal: string; project: string; gameId: string; collection: CompetitionCollection | 'canvas' | 'catalog-categories' | 'catalog-prompts'; roundId: string | null; effectId: string | null; purpose: 'OWNER' | 'JUDGE' | 'ACTOR'; visibility: string; snapshot: number | string; canvasRevision?: number }
interface Cursor { version: 2; scopeHash: string; offset: number }
export interface PageRequest { collection: CompetitionCollection; roundId: string | null; effectId: string | null; snapshot: number; cursor: string | null }
export function parseCompetitionPageRequest(value: unknown): PageRequest { const q = exact(value, ['collection', 'roundId', 'effectId', 'snapshot', 'cursor']); if (typeof q.collection !== 'string' || !['pending', 'feedback', 'rulings', 'correction', 'media', 'grading'].includes(q.collection) || q.roundId !== null && typeof q.roundId !== 'string' || q.effectId !== null && typeof q.effectId !== 'string' || q.cursor !== null && (typeof q.cursor !== 'string' || q.cursor.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(q.cursor))) return fail(400, 'INVALID_PAGE_REQUEST'); if (q.roundId !== null) id(q.roundId); if (q.effectId !== null) id(q.effectId); integer(q.snapshot); return q as unknown as PageRequest; }
export function pageVisibility(game: CompetitionGame, grant?: Grant): string { return admissionHash({ gameId: game.id, version: game.version, activeRoundId: game.activeRoundId, review: game.openItemReview, correction: game.correctionReview, rounds: game.rounds.map(r => ({ id: r.id, version: r.version, pause: r.pause?.eventId ?? null, assignment: r.assignment?.generation ?? null, revealed: r.publicRevealed, stopped: r.resourceStop?.eventId ?? null })), grant: grant ? { id: grant.id, generation: grant.generation, expiresAt: grant.expiresAt } : null }); }
export function consumedGrapheme(game: CompetitionGame, round: CompetitionRound, itemId: string): string | null {
  const hint = round.graphemeHints.find(h => h.itemId === itemId); if (!hint) return null;
  const item = round.pin.items.find(i => i.id === itemId), proof = round.pin.graphemes.find(p => p.id === hint.proofId);
  if (!item || !proof || proof.answerRevisionId !== item.revisionId || proof.answerHash !== item.hash || !game.consumptions.some(c => c.roundId === round.id && c.aid === 'HINT' && c.eventId === hint.eventId)) return fail(503, 'GRAPHEME_PROOF_UNAVAILABLE'); return proof.grapheme;
}
/** Ephemeral signing key: process restart yields a typed restart, never grants
 * authority. Every request reauthorizes before decoding this selector. */
export function createCompetitionPager(secret = randomBytes(32)) {
  const signature = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');
  function scopeHash(scope: PageScope): string {
    const keys = ['principal', 'project', 'gameId', 'collection', 'roundId', 'effectId', 'purpose', 'visibility', 'snapshot', ...(scope?.collection === 'canvas' ? ['canvasRevision'] : [])];
    try {
      exact(scope, keys);
      if (Reflect.ownKeys(scope).length !== keys.length || !['principal', 'project', 'gameId', 'visibility', 'collection', 'purpose'].every(key => typeof scope[key as keyof PageScope] === 'string') || !Object.hasOwn(COMPETITION_PAGE_SIZES, scope.collection) || !['OWNER', 'JUDGE', 'ACTOR'].includes(scope.purpose) || ![scope.roundId, scope.effectId].every(value => value === null || typeof value === 'string') || !(typeof scope.snapshot === 'string' || Number.isSafeInteger(scope.snapshot) && (scope.snapshot as number) >= 0) || scope.collection === 'canvas' && (!Number.isSafeInteger(scope.canvasRevision) || scope.canvasRevision! < 0 || scope.canvasRevision! > 512)) throw Error('SCOPE_SHAPE');
      return admissionHash(scope);
    } catch { return fail(503, 'PAGE_PROOF_UNAVAILABLE'); }
  }
  function checkedOffset(scope: PageScope, value: unknown): number {
    const limit = scope.collection.startsWith('catalog-') ? Number.MAX_SAFE_INTEGER : 64945;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > limit || value % COMPETITION_PAGE_SIZES[scope.collection] !== 0) return fail(409, 'PAGE_SNAPSHOT_RESTART');
    return value;
  }
  const encode = (scope: PageScope, value: number) => {
    const cursor: Cursor = { version: 2, scopeHash: scopeHash(scope), offset: checkedOffset(scope, value) }, bytes = Buffer.from(canonicalJson(cursor), 'utf8');
    if (bytes.length > 118) return fail(503, 'PAGE_PROOF_UNAVAILABLE');
    const payload = bytes.toString('base64url'); return `${payload}.${signature(payload)}`;
  };
  function offset(scope: PageScope, token: string | null) {
    if (token === null) { scopeHash(scope); return 0; }
    if (typeof token !== 'string' || token.length > 202) return fail(409, 'PAGE_SNAPSHOT_RESTART');
    const parts = /^([A-Za-z0-9_-]{1,158})\.([A-Za-z0-9_-]{43})$/.exec(token); if (!parts) return fail(409, 'PAGE_SNAPSHOT_RESTART');
    const [, payload, supplied] = parts; if (!timingSafeEqual(Buffer.from(signature(payload)), Buffer.from(supplied))) return fail(409, 'PAGE_SNAPSHOT_RESTART');
    let cursor: Record<string, unknown>;
    try {
      const bytes = Buffer.from(payload, 'base64url'), decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      cursor = exact(JSON.parse(decoded), ['version', 'scopeHash', 'offset']);
      if (cursor.version !== 2 || typeof cursor.scopeHash !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.scopeHash) || typeof cursor.offset !== 'number' || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !bytes.equals(Buffer.from(canonicalJson(cursor), 'utf8')) || bytes.toString('base64url') !== payload) throw Error('CURSOR_SHAPE');
    } catch { return fail(409, 'PAGE_SNAPSHOT_RESTART'); }
    if (cursor.scopeHash !== scopeHash(scope)) return fail(409, 'PAGE_SNAPSHOT_RESTART');
    return checkedOffset(scope, cursor.offset);
  }
  function start(scope: PageScope, token: string | null, total: number): number {
    const value = offset(scope, token), limit = scope.collection.startsWith('catalog-') ? Number.MAX_SAFE_INTEGER : 64945;
    if (!Number.isSafeInteger(total) || total < 0 || total > limit || value > total) return fail(503, 'PAGE_PROOF_UNAVAILABLE');
    return value;
  }
  function page<T>(scope: PageScope, token: string | null, source: readonly T[]) {
    const start = offset(scope, token), size = COMPETITION_PAGE_SIZES[scope.collection]; if (start > source.length || start % size !== 0) return fail(409, 'PAGE_SNAPSHOT_RESTART'); const rows = source.slice(start, start + size), next = start + rows.length;
    if (!Number.isSafeInteger(next) || next > source.length) return fail(503, 'PAGE_PROOF_UNAVAILABLE');
    boundedValue(rows, PROJECTION_BYTES, 'PAGE_BOUND_EXCEEDED'); const metadata = { scope: { gameId: scope.gameId, collection: scope.collection, roundId: scope.roundId, effectId: scope.effectId, purpose: scope.purpose }, revision: scope.snapshot, snapshot: scope.visibility, total: source.length, returned: rows.length, offset: start, nextCursor: next < source.length ? encode(scope, next) : null, complete: next === source.length }; boundedValue(metadata, 8192, 'PAGE_BOUND_EXCEEDED'); return { ...metadata, rows };
  }
  function window<T>(scope: PageScope, token: string | null, total: number, rows: readonly T[]) {
    const selected = start(scope, token, total), size = COMPETITION_PAGE_SIZES[scope.collection];
    if (rows.length !== Math.min(size, total - selected)) return fail(503, 'PAGE_PROOF_UNAVAILABLE');
    boundedValue(rows, PROJECTION_BYTES, 'PAGE_BOUND_EXCEEDED'); const next = selected + rows.length; if (!Number.isSafeInteger(next) || next > total) return fail(503, 'PAGE_PROOF_UNAVAILABLE');
    const metadata = { scope: { gameId: scope.gameId, collection: scope.collection, roundId: scope.roundId, effectId: scope.effectId, purpose: scope.purpose }, revision: scope.snapshot, snapshot: scope.visibility, total, returned: rows.length, offset: selected, nextCursor: next < total ? encode(scope, next) : null, complete: next === total };
    boundedValue(metadata, 8192, 'PAGE_BOUND_EXCEEDED'); return { ...metadata, rows };
  }
  return { page, window, offset, encode, start };
}
export function competitionPageRows(game: CompetitionGame, request: PageRequest, grant?: Grant) {
  const round = request.roundId ? game.rounds.find(r => r.id === request.roundId) ?? fail(404, 'MATCH_NOT_FOUND') : null;
  const effect = request.effectId ? game.effects.find(e => e.id === request.effectId) ?? fail(404, 'MATCH_NOT_FOUND') : null;
  if (request.snapshot !== game.version) return fail(409, 'PAGE_SNAPSHOT_RESTART');
  if (grant && (round?.id !== grant.roundId || request.collection === 'grading' && grant.role !== 'JUDGE' || request.collection !== 'grading' && request.collection !== 'media')) return fail(403, 'GRANT_DENIED');
  const attempt = (a: CompetitionGame['attempts'][number]) => ({ id: a.id, roundId: a.roundId, itemId: a.itemId, phase: a.phase, phaseOrdinal: a.phaseOrdinal, teamId: a.teamId, playerId: a.playerId, acceptedAt: a.acceptedAt, classification: game.classifications.find(c => c.attemptId === a.id)?.correct ?? null });
  switch (request.collection) {
    case 'pending': if (!round || effect || grant) return fail(400, 'INVALID_PAGE_REQUEST'); return game.attempts.filter(a => a.roundId === round.id && !game.classifications.some(c => c.attemptId === a.id)).map(attempt);
    case 'correction': { if (!effect || round || grant) return fail(400, 'INVALID_PAGE_REQUEST'); const head = game.rulings.find(h => h.originalEffectId === effect.id || h.effectId === effect.id) ?? fail(400, 'INVALID_PAGE_REQUEST'); return effect.originalAttemptIds.map(id => game.attempts.find(a => a.id === id && a.roundId === effect.roundId) ?? fail(503, 'ATTEMPT_PROOF_UNAVAILABLE')).map(a => ({ ...attempt(a), classification: effect.correctAttemptIds.includes(a.id), effectId: effect.id, effectHash: effect.hash, rulingVersion: head.version, reversed: head.reversed, effectKind: effect.kind })); }
    case 'rulings': if (round || effect || grant) return fail(400, 'INVALID_PAGE_REQUEST'); return [...game.rulings].sort((a, b) => game.rounds.find(r => r.id === a.roundId)!.ordinal - game.rounds.find(r => r.id === b.roundId)!.ordinal || Buffer.compare(Buffer.from(a.itemId ?? '', 'utf8'), Buffer.from(b.itemId ?? '', 'utf8'))).map(h => ({ roundId: h.roundId, itemId: h.itemId, originalEffectId: h.originalEffectId, effectId: h.effectId, version: h.version, hash: h.hash, reversed: h.reversed, correctAttemptCount: game.effects.find(e => e.id === h.effectId)?.correctAttemptIds.length ?? 0 }));
    case 'feedback': if (!round || effect || grant) return fail(400, 'INVALID_PAGE_REQUEST'); return round.pin.items.flatMap(i => { const revealed = round.publicRevealed || round.itemReveals.includes(i.id) || round.consumed.some(c => c.itemId === i.id), grapheme = consumedGrapheme(game, round, i.id); return revealed || grapheme !== null ? [{ id: i.id, ordinal: i.ordinal, consumed: round.consumed.some(c => c.itemId === i.id), revealed, ...(revealed ? { text: i.text, value: i.value, trap: i.trap, mediaIds: [...i.mediaIds] } : {}), ...(!revealed && grapheme !== null ? { grapheme } : {}) }] : []; });
    case 'grading': if (!round || effect || game.finished || game.openItemReview || game.correctionReview || game.activeRoundId !== round.id || round.pause || round.resourceStop || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format) || round.phase === 'READY' || round.phase === 'RESOLVED') return fail(403, 'GRADING_DENIED'); return round.pin.items.map(i => ({ id: i.id, ordinal: i.ordinal, text: i.text, value: i.value, trap: i.trap, consumed: round.consumed.some(c => c.itemId === i.id), revealed: true, mediaIds: [...i.mediaIds] }));
    case 'media': if (!round || effect) return fail(400, 'INVALID_PAGE_REQUEST'); return competitionMedia(game, round, grant?.role ?? 'HOST', grant).map(publicMedia);
  }
}
