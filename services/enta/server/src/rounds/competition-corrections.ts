import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { EntaError, fail } from '../gameplay/types';
import { addEffect, clockSnapshot, competitiveEvent, hasCompetitiveReview, invalidateCompetitionGrants, post, sealEffect } from './competition-effects';
import { itemCompetitionRound } from './competition-clock';
import { standaloneCompetition } from './competition-rules';
import { CorrectionProofStream, effectProofPages } from './competition-proof-stream';
import type { CompetitionCommand, CompetitionGame, Effect, RulingHead } from './competition-types';

/** Explicit registry: resolved successors, aid consumption, disclosure and time
 * are never made reversible by a flag alone. Original uniqueness survives. */
export function isOriginalReversible(effect: Effect): boolean { return effect.reversible && (effect.kind === 'RULING' || effect.kind === 'NO_SCORE' || effect.kind === 'AID' && effect.aid === 'STEAL_POINTS') && effect.predecessorId === null; }
export class CompetitionReviewError extends EntaError { readonly blockingIds: string[]; readonly truncated: boolean; constructor(ids: string[], total = ids.length) { super(409, 'CORRECTION_DEPENDENCY_REVIEW_REQUIRED'); if (ids.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id)) || !Number.isSafeInteger(total) || total < ids.length) throw new EntaError(503, 'EFFECT_PROOF_UNAVAILABLE'); this.blockingIds = [...new Set(ids)].slice(0, 32); this.truncated = total > 32; } }
export function correctionBlockers(game: CompetitionGame, original: Effect, excluded: string[] = [], changedTeamIds = game.postings.filter(p => p.effectId === original.id).map(p => p.teamId)): { ids: string[]; total: number } {
  const end = game.effects.at(-1)?.sequence ?? original.sequence, anchor = { gameId: game.id, version: game.version, start: original.sequence + 1, end, count: end - original.sequence }, stream = new CorrectionProofStream(anchor, original, new Set(excluded), changedTeamIds, new Set(game.teams.map(t => t.id)));
  function* rows() { for (const effect of game.effects) if (effect.sequence > original.sequence) yield { effect, postings: game.postings.filter(p => p.effectId === effect.id) }; }
  for (const page of effectProofPages(anchor, rows())) stream.page(page);
  return stream.finish();
}
function requireIndependent(game: CompetitionGame, original: Effect, excluded: string[] = [], changedTeamIds?: string[]): void { const blockers = correctionBlockers(game, original, excluded, changedTeamIds); if (blockers.total) throw new CompetitionReviewError(blockers.ids, blockers.total); }
function actualDeltas(game: CompetitionGame, effect: Effect): Map<string, number> {
  const rows = game.postings.filter(p => p.effectId === effect.id);
  if (rows.length !== effect.postingIds.length || rows.some(p => !effect.postingIds.includes(p.id) || p.after - p.before !== p.delta) || new Set(rows.map(p => p.teamId)).size !== rows.length) return fail(503, 'EFFECT_PROOF_UNAVAILABLE');
  return new Map(rows.map(p => [p.teamId, p.delta]));
}
function applyDeltas(game: CompetitionGame, effect: Effect, deltas: Map<string, number>): void { for (const team of game.teams) { const delta = deltas.get(team.id); if (delta !== undefined) post(game, effect, team.id, delta); } }
function headFor(game: CompetitionGame, original: Effect): RulingHead { return game.rulings.find(h => h.originalEffectId === original.id) ?? fail(503, 'RULING_PROOF_UNAVAILABLE'); }
function replacementDeltas(game: CompetitionGame, original: Effect, correctIds: string[]): Map<string, number> {
  const round = game.rounds.find(r => r.id === original.roundId) ?? fail(503, 'RULING_PROOF_UNAVAILABLE'), head = headFor(game, original);
  const selected = correctIds.map(id => game.attempts.find(a => a.id === id && original.originalAttemptIds.includes(id) && a.roundId === round.id) ?? fail(409, 'ORIGINAL_ATTEMPT_REQUIRED'));
  if (selected.some(a => a.acceptedAt >= a.deadline || !a.eligiblePlayerIds.includes(a.playerId) || !a.eligibilityHash || (head.itemId !== null && a.itemId !== head.itemId))) return fail(503, 'ATTEMPT_PROOF_UNAVAILABLE');
  const result = new Map<string, number>();
  if (head.itemId !== null) {
    const item = round.pin.items.find(i => i.id === head.itemId) ?? fail(503, 'ITEM_PROOF_UNAVAILABLE');
    if (new Set(selected.map(a => a.teamId)).size > 1) return fail(409, 'ITEM_RULING_REQUIRED');
    if (!selected.length) return result;
    const teamId = selected[0].teamId;
    if (item.trap && !standaloneCompetition(game.request.executionFormat)) {
      // Reuse the original actual clamp only for its original recipient. A
      // different recipient has no pinned historical balance proof here.
      const posting = game.postings.find(p => p.effectId === original.id && p.teamId === teamId);
      if (!posting || !original.correctAttemptIds.some(id => selected.some(a => a.id === id))) throw new CompetitionReviewError([original.id]);
      result.set(teamId, posting.delta);
    } else result.set(teamId, item.trap ? -item.value : item.value);
  } else {
    if (itemCompetitionRound(round)) throw new CompetitionReviewError([original.id]);
    for (const teamId of new Set(selected.map(a => a.teamId))) {
      const attempts = selected.filter(a => a.teamId === teamId), snapshots = attempts.map(a => original.bonusSnapshot.find(b => b.attemptId === a.id && b.teamId === a.teamId) ?? fail(503, 'BONUS_PROOF_UNAVAILABLE'));
      result.set(teamId, round.pin.points! * Math.max(...snapshots.map(b => b.multiplier)));
    }
  }
  return result;
}
export function undoCompetitiveEffect(game: CompetitionGame, command: Extract<CompetitionCommand, { type: 'UNDO_EFFECT' }>, now: number): void {
  const original = game.effects.find(e => e.id === command.effectId) ?? fail(404, 'MATCH_NOT_FOUND'), round = game.rounds.find(r => r.id === original.roundId) ?? fail(404, 'MATCH_NOT_FOUND');
  if (game.finished || hasCompetitiveReview(game) || round.pause || game.latestEffectId !== original.id || original.hash !== command.effectHash || !isOriginalReversible(original) || game.effects.some(e => e.kind === 'REVERSAL' && e.predecessorId === original.id)) return fail(409, 'UNDO_UNAVAILABLE');
  requireIndependent(game, original);
  const head = original.kind === 'AID' ? null : headFor(game, original);
  if (head && head.itemId === null && itemCompetitionRound(round)) return fail(409, 'UNDO_UNAVAILABLE');
  if (head && (head.effectId !== original.id || head.hash !== original.hash || head.reversed)) return fail(409, 'STALE_RULING_HEAD');
  const consumption = head?.itemId === null || !head ? null : round.consumed.find(c => c.itemId === head.itemId && c.effectId === original.id) ?? fail(503, 'ITEM_PROOF_UNAVAILABLE');
  const e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), reversal = addEffect(game, e, round, 'REVERSAL', { amountKind: 'FIXED', predecessorId: original.id, predecessorHash: original.hash, beforeClock: clockSnapshot(round), originalAttemptIds: original.originalAttemptIds, correctAttemptIds: original.correctAttemptIds, bonusSnapshot: original.bonusSnapshot });
  applyDeltas(game, reversal, new Map([...actualDeltas(game, original)].map(([team, delta]) => [team, -delta])));
  // Access generations advance independently from attempt/clock generations.
  invalidateCompetitionGrants(game, round); for (const scope of game.grantScopes.filter(s => s.roundId === round.id)) scope.generation++;
  sealEffect(reversal);
  if (head) {
    const predecessorRulingVersion = head.version, predecessorRulingHash = head.hash;
    head.effectId = reversal.id; head.hash = reversal.hash; head.version++; head.reversed = true;
    if (consumption) {
      const payload = { id: randomUUID(), roundId: round.id, itemId: consumption.itemId, originalEffectId: original.id, originalEffectHash: original.hash, reversalEffectId: reversal.id, predecessorRulingVersion, predecessorRulingHash, originalAttemptIds: original.originalAttemptIds, consumptionEffectId: consumption.effectId, eventId: e.id };
      const review = { ...payload, hash: admissionHash({ domain: 'maydan.enta.item-review.v1', payload }) }; game.itemReviews.push(review); game.openItemReview = review.id;
    } else game.correctionReview = round.id;
  }
}
export function resolveCompetitiveItemReview(game: CompetitionGame, command: Extract<CompetitionCommand, { type: 'RESOLVE_ITEM_REVIEW' }>, now: number): void {
  const review = game.itemReviews.find(r => r.id === command.reviewId) ?? fail(404, 'MATCH_NOT_FOUND'), original = game.effects.find(e => e.id === review.originalEffectId) ?? fail(503, 'EFFECT_PROOF_UNAVAILABLE'), head = headFor(game, original), round = game.rounds.find(r => r.id === review.roundId) ?? fail(503, 'RULING_PROOF_UNAVAILABLE');
  if (game.finished || game.openItemReview !== review.id || review.hash !== command.reviewHash || head.version !== command.rulingVersion || !head.reversed || head.effectId !== review.reversalEffectId || game.itemResolutions.some(r => r.reviewId === review.id)) return fail(409, 'STALE_REVIEW_HEAD');
  requireIndependent(game, original, [review.reversalEffectId]);
  const deltas = command.mode === 'RESTORE_ORIGINAL' ? actualDeltas(game, original) : replacementDeltas(game, original, command.correctAttemptIds), e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), successor = addEffect(game, e, round, 'CORRECTION', { amountKind: 'FIXED', predecessorId: head.effectId, predecessorHash: head.hash, originalAttemptIds: original.originalAttemptIds, correctAttemptIds: command.mode === 'RESTORE_ORIGINAL' ? original.correctAttemptIds : command.correctAttemptIds, bonusSnapshot: original.bonusSnapshot, reason: command.reason });
  applyDeltas(game, successor, deltas); sealEffect(successor); head.version++; head.effectId = successor.id; head.hash = successor.hash; head.reversed = false;
  game.itemResolutions.push({ id: randomUUID(), reviewId: review.id, reviewHash: review.hash, effectId: successor.id, eventId: e.id, rulingVersion: head.version, rulingHash: head.hash, mode: command.mode, reason: command.reason }); game.openItemReview = null;
  // No phase, deadline, consumption, assignment, knowledge or aid restoration.
}
export function correctCompetitiveRuling(game: CompetitionGame, command: Extract<CompetitionCommand, { type: 'CORRECT_RULING' }>, now: number): void {
  const original = game.effects.find(e => e.id === command.effectId) ?? fail(404, 'MATCH_NOT_FOUND'), round = game.rounds.find(r => r.id === original.roundId) ?? fail(404, 'MATCH_NOT_FOUND'), head = headFor(game, original);
  if (game.finished || game.activeRoundId || game.openItemReview || round.phase !== 'RESOLVED' || head.version !== command.rulingVersion || head.itemId !== null || !['RULING', 'NO_SCORE'].includes(original.kind) || game.correctionReview && game.correctionReview !== round.id) return fail(409, 'CORRECTION_UNAVAILABLE');
  const chain: Effect[] = []; let cursor: Effect | undefined = game.effects.find(e => e.id === head.effectId);
  while (cursor) { if (chain.some(e => e.id === cursor!.id)) return fail(503, 'RULING_PROOF_UNAVAILABLE'); chain.push(cursor); if (cursor.id === original.id) break; cursor = game.effects.find(e => e.id === cursor!.predecessorId && e.hash === cursor!.predecessorHash); }
  if (chain.at(-1)?.id !== original.id) return fail(503, 'RULING_PROOF_UNAVAILABLE');
  const desired = replacementDeltas(game, original, command.correctAttemptIds), current = new Map<string, number>();
  for (const member of chain) for (const [team, delta] of actualDeltas(game, member)) current.set(team, (current.get(team) ?? 0) + delta);
  const changedTeams = game.teams.filter(t => (desired.get(t.id) ?? 0) !== (current.get(t.id) ?? 0)).map(t => t.id); requireIndependent(game, original, chain.map(e => e.id), changedTeams);
  const e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), effect = addEffect(game, e, round, 'CORRECTION', { amountKind: 'FIXED', predecessorId: head.effectId, predecessorHash: head.hash, originalAttemptIds: original.originalAttemptIds, correctAttemptIds: command.correctAttemptIds, bonusSnapshot: original.bonusSnapshot, reason: command.reason });
  const delta = new Map(game.teams.map(t => [t.id, (desired.get(t.id) ?? 0) - (current.get(t.id) ?? 0)])); applyDeltas(game, effect, delta); sealEffect(effect); head.effectId = effect.id; head.hash = effect.hash; head.version++; head.reversed = false; game.correctionReview = null;
}
