import { fail } from '../gameplay/types';
import type { CompetitionCommand, CompetitionGame, CompetitionRound } from './competition-types';

export const MAX_GAME_FACTS = 64945;
export const MAX_GAME_VERSION = MAX_GAME_FACTS + 1;
export type CapacityLane = 'ATTEMPT' | 'INTERIM' | 'CANVAS' | 'PUBLIC' | 'INITIAL' | 'OPEN_CLOSE' | 'SYSTEM' | 'OPTIONAL' | 'PROTECTED';
export type CapacityCost = { events: number; effects: number; classifications: number; heads: number; consumptions: number; postings: number };
export interface CapacityReservation { id: string; roundId: string | null; sourceKind: 'ATTEMPT' | 'ITEM' | 'ROUND' | 'REVIEW' | 'BOARD_REVIEW' | 'PAUSE' | 'GRANT' | 'FINISH'; sourceId: string; lane: CapacityLane; cost: CapacityCost }
export interface CapacityDisposition { reservationId: string; eventId: string; kind: 'CONSUME' | 'RELEASE' }
const cost = (events = 0, effects = 0, classifications = 0, heads = 0, consumptions = 0, postings = 0): CapacityCost => ({ events, effects, classifications, heads, consumptions, postings });
export const CAPACITY_COSTS = Object.freeze({
  RECORD_ATTEMPT: cost(1, 1), INTERIM_WRONG: cost(1, 1, 1), PUBLIC_REVEAL: cost(1, 1),
  FINAL_RULING_ITEM: cost(1, 1, 4, 1, 1, 4), FINAL_RULING_WHOLE_ITEMS: cost(1, 128, 512, 128, 128, 512), FINAL_RULING_EMPTY: cost(1, 1, 0, 1),
  CANVAS: cost(1, 1), OPEN_ROUND: cost(1, 1), CLOSE_ROUND: cost(1, 1),
  OPTIONAL: cost(1, 1, 0, 1, 0, 4), UNDO_ENTRY_AND_RESERVED_EXIT: cost(2, 2, 0, 2, 0, 8), PAUSE_ENTRY_AND_RESERVED_EXIT: cost(2, 2), GRANT_ENTRY_AND_RESERVED_REVOKE: cost(2, 1),
  REVOKE_GRANT: cost(1), CLOCK: cost(1, 1, 0, 1, 0, 4), RESOURCE_LIMIT_REACHED: cost(1, 1), FINISH: cost(1, 1),
});
export function roundLaneLimits(round: CompetitionRound): Record<CapacityLane, number> {
  const item = ['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format);
  return { ATTEMPT: item ? 512 : 8, INTERIM: item ? 512 : 8, CANVAS: round.pin.format === 'DRAWING_TARGET' ? 512 : 0, PUBLIC: item ? 129 : 1, INITIAL: item ? 129 : 1, OPEN_CLOSE: 2, SYSTEM: 256, OPTIONAL: 256, PROTECTED: 8 };
}
export function eventLane(type: string, system: boolean): CapacityLane {
  if (type === 'RESOURCE_LIMIT_REACHED' || type === 'FINISH') return 'PROTECTED';
  if (type === 'RECORD_ATTEMPT') return 'ATTEMPT';
  if (type === 'INTERIM_WRONG') return 'INTERIM';
  if (type.startsWith('CANVAS_')) return 'CANVAS';
  if (type === 'PUBLIC_REVEAL') return 'PUBLIC';
  if (type === 'FINAL_RULING') return 'INITIAL';
  if (type === 'OPEN_ROUND' || type === 'NEXT_ROUND' || type === 'CLOSE_ROUND') return 'OPEN_CLOSE';
  return system ? 'SYSTEM' : 'OPTIONAL';
}
/** Immutable source facts are authority. Reservations add only not-yet-spent
 * completion costs; a consumed source cannot be reserved or released again. */
export function deriveRoundCapacity(game: CompetitionGame, round: CompetitionRound) {
  const limits = roundLaneLimits(round), used = Object.fromEntries(Object.keys(limits).map(lane => [lane, cost()])) as Record<CapacityLane, CapacityCost>;
  const reserved = structuredClone(used);
  for (const event of game.events.filter(e => e.roundId === round.id)) {
    const lane = eventLane(event.type, event.authority.kind === 'SYSTEM'), row = used[lane]; row.events++;
    const effects = game.effects.filter(e => e.eventId === event.id); row.effects += effects.length;
    row.classifications += game.classifications.filter(c => c.eventId === event.id).length;
    row.heads += effects.filter(e => ['RULING', 'NO_SCORE', 'REVERSAL', 'CORRECTION'].includes(e.kind)).length;
    row.consumptions += round.consumed.filter(c => effects.some(e => e.id === c.effectId)).length;
    row.postings += game.postings.filter(p => effects.some(e => e.id === p.effectId)).length;
  }
  for (const claim of game.capacityReservations.filter(c => c.roundId === round.id)) {
    if (game.capacityDispositions.some(d => d.reservationId === claim.id)) continue;
    const row = reserved[claim.lane]; for (const key of Object.keys(row) as (keyof CapacityCost)[]) row[key] += claim.cost[key];
  }
  return { limits, used, reserved, stopped: round.resourceStop !== null };
}
function claimId(kind: CapacityReservation['sourceKind'], roundId: string | null, sourceId: string) { return JSON.stringify([kind, roundId, sourceId]); }
function reserve(game: CompetitionGame, roundId: string | null, sourceKind: CapacityReservation['sourceKind'], sourceId: string, lane: CapacityLane, value: CapacityCost): void {
  const id = claimId(sourceKind, roundId, sourceId); if (game.capacityReservations.some(c => c.id === id)) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  game.capacityReservations.push({ id, roundId, sourceKind, sourceId, lane, cost: value });
}
function dispose(game: CompetitionGame, claim: CapacityReservation, eventId: string, kind: CapacityDisposition['kind']): void {
  if (game.capacityDispositions.some(d => d.reservationId === claim.id)) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  game.capacityDispositions.push({ reservationId: claim.id, eventId, kind });
}
export function initializeCapacity(game: CompetitionGame): void {
  for (const round of game.rounds) {
    for (const item of round.pin.items) reserve(game, round.id, 'ITEM', item.id, 'INITIAL', cost(0, 1, 0, 1, 1, 4));
    reserve(game, round.id, 'ROUND', round.id, 'INITIAL', cost(1, 1, 0, 1, 0, 4));
  }
  reserve(game, null, 'FINISH', game.id, 'PROTECTED', cost(1, 1));
}
/** Called on the staged oracle result before it can become authoritative. SQL
 * must reserve/reconcile the same source vector under Game before fact INSERT. */
export function reconcileCapacity(before: CompetitionGame, next: CompetitionGame, command: CompetitionCommand | null): void {
  const newEvents = next.events.filter(e => !before.events.some(b => b.id === e.id));
  for (const attempt of next.attempts.filter(a => !before.attempts.some(b => b.id === a.id))) reserve(next, attempt.roundId, 'ATTEMPT', attempt.id, 'INTERIM', cost(0, 0, 1));
  for (const disposition of next.classifications.filter(c => !before.classifications.some(b => b.id === c.id))) {
    const claim = next.capacityReservations.find(c => c.sourceKind === 'ATTEMPT' && c.sourceId === disposition.attemptId) ?? fail(503, 'CAPACITY_PROOF_UNAVAILABLE'); dispose(next, claim, disposition.eventId, 'CONSUME');
  }
  for (const review of next.itemReviews.filter(r => !before.itemReviews.some(b => b.id === r.id))) reserve(next, review.roundId, 'REVIEW', review.id, 'OPTIONAL', cost(1, 1, 0, 1, 0, 4));
  if (next.correctionReview !== null && before.correctionReview === null) {
    const reversal = next.effects.find(e => e.kind === 'REVERSAL' && e.roundId === next.correctionReview && !before.effects.some(b => b.id === e.id)) ?? fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
    reserve(next, next.correctionReview, 'BOARD_REVIEW', reversal.id, 'OPTIONAL', cost(1, 1, 0, 1, 0, 4));
  }
  const newEventIds = new Set(newEvents.map(event => event.id));
  // Consumption is derived across the complete batch before any closing event
  // can release unused claims. Earlier phase transfers cannot close a claim.
  for (const claim of next.capacityReservations.filter(c => ['ITEM', 'ROUND'].includes(c.sourceKind) && !next.capacityDispositions.some(d => d.reservationId === c.id))) {
    const source = claim.sourceKind === 'ITEM'
      ? next.rounds.find(r => r.id === claim.roundId)?.consumed.find(c => c.itemId === claim.sourceId)?.effectId
      : next.rulings.find(h => h.roundId === claim.roundId && h.itemId === null)?.originalEffectId;
    const effect = next.effects.find(e => e.id === source && newEventIds.has(e.eventId) && ['RULING', 'NO_SCORE'].includes(e.kind) && e.predecessorId === null);
    if (effect) dispose(next, claim, effect.eventId, 'CONSUME');
  }
  for (const event of newEvents) {
    for (const round of next.rounds) {
      const old = before.rounds.find(r => r.id === round.id)!;
      if (round.pause && round.pause.eventId === event.id && old.pause?.eventId !== event.id) reserve(next, round.id, 'PAUSE', event.id, 'OPTIONAL', cost(1, 1));
      for (const claim of next.capacityReservations.filter(c => c.roundId === round.id && !next.capacityDispositions.some(d => d.reservationId === c.id))) {
        if (['ITEM', 'ROUND'].includes(claim.sourceKind) && event.roundId === round.id && round.phase === 'RESOLVED' && old.phase !== 'RESOLVED' && ['FINAL_RULING', 'CLOSE_ROUND', 'RECORDING_CLOSED'].includes(event.type) && next.effects.some(e => e.eventId === event.id && e.roundId === round.id && e.afterClock?.phase === 'RESOLVED' && ['RULING', 'NO_SCORE', 'TIMING'].includes(e.kind))) dispose(next, claim, event.id, 'RELEASE');
        else if (claim.sourceKind === 'PAUSE' && old.pause?.eventId === claim.sourceId && round.pause === null && event.roundId === round.id && ['PHONE_ENDED', 'RESUME_ROUND', 'END_ASSISTANCE'].includes(event.type)) dispose(next, claim, event.id, 'CONSUME');
        else if (claim.sourceKind === 'BOARD_REVIEW' && before.correctionReview === round.id && next.correctionReview === null && event.type === 'CORRECT_RULING' && event.roundId === round.id) dispose(next, claim, event.id, 'CONSUME');
        else if (claim.sourceKind === 'REVIEW' && next.itemResolutions.some(r => r.reviewId === claim.sourceId && r.eventId === event.id)) dispose(next, claim, event.id, 'CONSUME');
      }
    }
    for (const grant of next.grants.filter(g => g.id === event.id && !g.revoked)) reserve(next, grant.roundId, 'GRANT', grant.id, 'OPTIONAL', cost(1));
    for (const claim of next.capacityReservations.filter(c => c.sourceKind === 'GRANT' && !next.capacityDispositions.some(d => d.reservationId === c.id))) if (next.grants.some(g => g.id === claim.sourceId && g.revoked) && event.roundId === claim.roundId) dispose(next, claim, event.id, event.type === 'REVOKE_GRANT' ? 'CONSUME' : 'RELEASE');
    if (event.type === 'FINISH') { const claim = next.capacityReservations.find(c => c.sourceKind === 'FINISH') ?? fail(503, 'CAPACITY_PROOF_UNAVAILABLE'); dispose(next, claim, event.id, 'CONSUME'); }
  }
  validateCapacity(next); void command;
}
export function validateCapacity(game: CompetitionGame): void {
  if (new Set(game.capacityReservations.map(c => c.id)).size !== game.capacityReservations.length || new Set(game.capacityDispositions.map(c => c.reservationId)).size !== game.capacityDispositions.length || game.capacityDispositions.some(d => !game.capacityReservations.some(c => c.id === d.reservationId) || !game.events.some(e => e.id === d.eventId))) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  for (const disposition of game.capacityDispositions) {
    const claim = game.capacityReservations.find(c => c.id === disposition.reservationId)!;
    if (!['ITEM', 'ROUND'].includes(claim.sourceKind)) continue;
    const round = game.rounds.find(r => r.id === claim.roundId) ?? fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
    const source = claim.sourceKind === 'ITEM' ? round.consumed.find(c => c.itemId === claim.sourceId)?.effectId : game.rulings.find(h => h.roundId === round.id && h.itemId === null)?.originalEffectId;
    const original = game.effects.find(e => e.id === source), event = game.events.find(e => e.id === disposition.eventId)!;
    if (disposition.kind === 'CONSUME' ? !original || original.eventId !== disposition.eventId || original.predecessorId !== null || !['RULING', 'NO_SCORE'].includes(original.kind) : source !== undefined || event.roundId !== round.id || !['FINAL_RULING', 'CLOSE_ROUND', 'RECORDING_CLOSED'].includes(event.type) || !game.effects.some(e => e.eventId === event.id && e.roundId === round.id && e.afterClock?.phase === 'RESOLVED' && ['RULING', 'NO_SCORE', 'TIMING'].includes(e.kind))) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  }
  for (const round of game.rounds) {
    const state = deriveRoundCapacity(game, round);
    for (const lane of Object.keys(state.limits) as CapacityLane[]) {
      const used = state.used[lane], reserved = state.reserved[lane], cap = state.limits[lane];
      if (used.events + reserved.events > cap || used.effects + reserved.effects > cap || Object.values(used).some(x => !Number.isSafeInteger(x) || x < 0) || Object.values(reserved).some(x => !Number.isSafeInteger(x) || x < 0)) return fail(409, lane === 'ATTEMPT' ? 'ATTEMPT_BUDGET_EXCEEDED' : lane === 'CANVAS' ? 'CANVAS_BUDGET_EXCEEDED' : 'OPTIONAL_CAPACITY_EXHAUSTED');
    }
    if (game.attempts.filter(a => a.roundId === round.id).length > state.limits.ATTEMPT || game.classifications.filter(c => game.attempts.some(a => a.roundId === round.id && a.id === c.attemptId)).length > state.limits.ATTEMPT || game.grantScopes.filter(s => s.roundId === round.id && s.activeGrantId !== null).length > 2) return fail(409, 'OPTIONAL_CAPACITY_EXHAUSTED');
  }
  if (game.events.length > MAX_GAME_FACTS || game.effects.length > MAX_GAME_FACTS || game.version > MAX_GAME_VERSION || game.reports.length > 128) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
}
export function resourceAllows(command: CompetitionCommand): boolean { return ['PUBLIC_REVEAL', 'FINAL_RULING', 'CLOSE_ROUND', 'END_ASSISTANCE', 'RESUME_ROUND', 'REVOKE_GRANT', 'RESOLVE_ITEM_REVIEW', 'CORRECT_RULING', 'FINISH', 'REPORT_VAR'].includes(command.type); }
