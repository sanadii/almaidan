import { admissionHash } from '../admission/huroof-protocol.cjs';
import { addEffect, clockSnapshot, closeCompetitionRound, competitiveEvent, invalidateCompetitionGrants, pendingAttempts, sealEffect } from './competition-effects';
import { standaloneCompetition } from './competition-rules';
import { deriveRoundCapacity, reconcileCapacity } from './competition-capacity';
import type { CompetitionGame, CompetitionRound } from './competition-types';
export const itemCompetitionRound = (round: CompetitionRound): boolean => ['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format);
export function resumeCompetitivePause(round: CompetitionRound, moment: number): void {
  const pause = round.pause!; round.deadline = pause.phaseRemaining === null ? null : moment + pause.phaseRemaining; round.overallDeadline = pause.overallRemaining === null ? null : moment + pause.overallRemaining; round.pause = null; round.version++;
}
function systemEvent(game: CompetitionGame, round: CompetitionRound, type: string, moment: number, anchor: number) {
  return competitiveEvent(game, `clock-${round.id}-${round.generation}-${game.version}`, admissionHash({ type, roundId: round.id, generation: round.generation, anchor, moment }), type, round.id, moment, { kind: 'SYSTEM', operation: 'CLOCK_SETTLEMENT' });
}
function recordingClosed(game: CompetitionGame, round: CompetitionRound, moment: number, anchor: number): void {
  const beforeClock = clockSnapshot(round);
  invalidateCompetitionGrants(game, round); round.deadline = null; round.overallDeadline = null; round.version++;
  const pending = pendingAttempts(game, round.id), e = systemEvent(game, round, 'RECORDING_CLOSED', moment, anchor);
  if (game.itemReviews.some(review => review.id === game.openItemReview && review.roundId === round.id)) {
    // Independent unresolved review: never emit a fabricated second NO_SCORE
    // or consumption. Clock closure may clear the ordinary active pointer;
    // both review and timely pending evidence remain resolvable under Game.
    round.phase = pending.length ? 'AWAITING_RULING' : 'RESOLVED'; round.reason = 'TIME_EXPIRED'; game.activeRoundId = null; if (!round.turnAdvanced) { game.turnIndex++; round.turnAdvanced = true; }
    const effect = addEffect(game, e, round, 'TIMING', { beforeClock }); sealEffect(effect); return;
  }
  if (pending.length) { round.phase = 'AWAITING_RULING'; const effect = addEffect(game, e, round, 'TIMING', { beforeClock }); sealEffect(effect); return; }
  const original = game.attempts.filter(a => a.roundId === round.id);
  const effect = addEffect(game, e, round, 'NO_SCORE', { reversible: !itemCompetitionRound(round), amountKind: 'NONE', beforeClock, originalAttemptIds: original.map(a => a.id), correctAttemptIds: [], bonusSnapshot: original.map(a => ({ attemptId: a.id, teamId: a.teamId, multiplier: a.bonusMultiplier, sourceEventId: a.bonusEventId })) });
  // Round-level no-score exists even with zero postings/zero accepted attempts.
  // It cannot invent replacement eligibility for an empty attempt set.
  closeCompetitionRound(game, round, 'TIME_EXPIRED'); effect.afterClock = clockSnapshot(round); sealEffect(effect); game.rulings.push({ roundId: round.id, itemId: null, scopeId: JSON.stringify([round.id, null]), originalEffectId: effect.id, effectId: effect.id, version: 1, hash: effect.hash, reversed: false });
}
/** Only called after current verified owner/live grant and parent locks. Timely
 * evidence is immutable across elapsed phases; anchors never use late request
 * time to restart a competitive interval. SQL independently derives this state. */
function settleClock(game: CompetitionGame, moment: number): boolean {
  const round = game.rounds.find(r => r.id === game.activeRoundId); if (!round || game.finished) return false;
  if (round.resourceStop) return false;
  const capacity = deriveRoundCapacity(game, round), phone = round.pause?.cause === 'PHONE' && round.pause.resumeAt !== null && moment >= round.pause.resumeAt;
  const prospectiveDeadline = phone ? round.pause!.phaseRemaining === null ? null : round.pause!.resumeAt! + round.pause!.phaseRemaining : round.deadline;
  const required = (phone ? 1 : 0) + (prospectiveDeadline !== null && moment >= prospectiveDeadline ? ['MAIN', 'TRAP'].includes(round.phase) && moment >= prospectiveDeadline + 10000 ? 2 : 1 : 0);
  const elapsed = round.phase === 'TURN' && prospectiveDeadline !== null && moment >= prospectiveDeadline ? Math.floor((moment - prospectiveDeadline) / (game.request.setup.rules.turnSeconds * 1000)) + 1 : 0;
  if (capacity.used.SYSTEM.events + required > capacity.limits.SYSTEM || !Number.isSafeInteger(moment) || !Number.isSafeInteger(elapsed) || round.generation >= 2_000_000_000 || round.phaseOrdinal >= 2_000_000_000 || round.generation + elapsed > 2_000_000_000 || round.phaseOrdinal + elapsed > 2_000_000_000) {
    const reason = capacity.used.SYSTEM.events + required > capacity.limits.SYSTEM ? 'SYSTEM_CAPACITY' as const : 'GENERATION_BOUND' as const;
    const e = competitiveEvent(game, `resource-${round.id}`, admissionHash({ roundId: round.id, reason, generation: round.generation }), 'RESOURCE_LIMIT_REACHED', round.id, moment, { kind: 'SYSTEM', operation: 'CLOCK_SETTLEMENT' });
    const assignment = round.assignment; round.resourceStop = { eventId: e.id, at: moment, reason }; round.version++; invalidateCompetitionGrants(game, round); round.assignment = assignment; const effect = addEffect(game, e, round, 'TIMING'); sealEffect(effect); return true;
  }
  let changed = false;
  if (round.pause) {
    if (round.pause.cause !== 'PHONE' || round.pause.resumeAt === null || moment < round.pause.resumeAt) return false;
    const beforeClock = clockSnapshot(round), anchor = round.pause.resumeAt; resumeCompetitivePause(round, anchor); const e = systemEvent(game, round, 'PHONE_ENDED', moment, anchor), effect = addEffect(game, e, round, 'TIMING', { beforeClock }); sealEffect(effect); changed = true;
  }
  if (round.deadline === null || ['AWAITING_RULING', 'RESOLVED'].includes(round.phase)) return changed;
  if (round.overallDeadline !== null && moment >= round.overallDeadline) { recordingClosed(game, round, moment, round.overallDeadline); return true; }
  if (moment < round.deadline) return changed;
  const anchor = round.deadline;
  if (round.phase === 'MAIN' || round.phase === 'TRAP') {
    const beforeClock = clockSnapshot(round);
    round.phase = 'STEAL'; round.phaseOrdinal++; round.generation++; round.deadline = anchor + 10000; round.currentTeamId = null; round.pickedPlayerId = null; round.pickedEventId = null; round.doubleAttemptTeamId = null; round.version++; invalidateCompetitionGrants(game, round);
    const e = systemEvent(game, round, 'STEAL_OPENED', moment, anchor), effect = addEffect(game, e, round, 'TIMING', { beforeClock }); sealEffect(effect); changed = true;
    if (moment >= round.deadline) recordingClosed(game, round, moment, round.deadline);
  } else if (round.phase === 'STEAL' || round.phase === 'SHARED') { recordingClosed(game, round, moment, anchor); changed = true; }
  else if (round.phase === 'TURN' && standaloneCompetition(game.request.executionFormat)) {
    const beforeClock = clockSnapshot(round);
    const interval = game.request.setup.rules.turnSeconds * 1000, elapsed = Math.floor((moment - anchor) / interval) + 1, index = game.teams.findIndex(t => t.id === round.currentTeamId);
    round.currentTeamId = game.teams[(index + elapsed) % game.teams.length].id; round.deadline = anchor + elapsed * interval; round.phaseOrdinal += elapsed; round.generation += elapsed; round.doubleAttemptTeamId = null; round.version++; invalidateCompetitionGrants(game, round);
    const e = systemEvent(game, round, 'TURN_TRANSFERRED', moment, anchor), effect = addEffect(game, e, round, 'TIMING', { beforeClock }); sealEffect(effect); changed = true;
  }
  return changed;
}
export function settleCompetitiveClock(game: CompetitionGame, moment: number): boolean {
  // This is the pure test oracle. Production uses a bounded locked fact context.
  const before = structuredClone(game), changed = settleClock(game, moment);
  if (changed) reconcileCapacity(before, game, null);
  return changed;
}
