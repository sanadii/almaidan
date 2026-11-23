import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { addEffect, clockSnapshot, closeCompetitionRound, competitiveEvent, eligiblePlayers, hasCompetitiveReview, invalidateCompetitionGrants, pendingAttempts, post, sealEffect } from './competition-effects';
import { itemCompetitionRound } from './competition-clock';
import { transferStandalone } from './competition-aids';
import { standaloneCompetition } from './competition-rules';
import type { CompetitionCommand, CompetitionGame, CompetitionRound } from './competition-types';
function activeRecording(game: CompetitionGame, round: CompetitionRound, now: number): void { if (game.activeRoundId !== round.id || hasCompetitiveReview(game) || round.pause || round.publicRevealed || round.deadline === null || now >= round.deadline || !['MAIN', 'TRAP', 'STEAL', 'SHARED', 'TURN'].includes(round.phase)) return fail(409, 'ATTEMPT_UNAVAILABLE'); }
export function recordCompetitiveAttempt(game: CompetitionGame, round: CompetitionRound, command: Extract<CompetitionCommand, { type: 'RECORD_ATTEMPT' }>, now: number): void {
  activeRecording(game, round, now);
  const eligibleTeam = round.phase === 'STEAL' ? command.teamId !== round.originalTeamId : round.phase === 'SHARED' ? game.teams.some(t => t.id === command.teamId) : command.teamId === round.currentTeamId;
  if (!eligibleTeam || (itemCompetitionRound(round) ? command.itemId === null || !round.pin.items.some(i => i.id === command.itemId) || round.consumed.some(c => c.itemId === command.itemId) || round.itemReveals.includes(command.itemId!) : command.itemId !== null)) return fail(409, 'ATTEMPT_UNAVAILABLE');
  const players = eligiblePlayers(game, round, command.teamId), picked = round.pickedPlayerId && game.teams.find(t => t.id === command.teamId)?.players.some(p => p.id === round.pickedPlayerId);
  if (!players.some(p => p.id === command.playerId) || picked && command.playerId !== round.pickedPlayerId) return fail(409, 'NO_ELIGIBLE_PLAYER');
  const previous = game.attempts.filter(a => a.roundId === round.id && a.teamId === command.teamId && a.phaseOrdinal === round.phaseOrdinal && a.generation === round.generation && (round.phase === 'SHARED' ? a.itemId === command.itemId : true));
  const budget = ['MAIN', 'TURN'].includes(round.phase) && round.doubleAttemptTeamId === command.teamId ? 2 : 1;
  if (previous.length >= budget || previous.some(a => !game.classifications.some(c => c.attemptId === a.id)) || previous.some(a => game.classifications.some(c => c.attemptId === a.id && c.correct))) return fail(409, 'ATTEMPT_BUDGET_EXCEEDED');
  const e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), allowance = round.doubleAttemptTeamId === command.teamId ? game.allowances.find(a => a.teamId === command.teamId && ['DOUBLE', 'DOUBLE_ANSWER'].includes(a.aid) && a.scopeId === (standaloneCompetition(game.request.executionFormat) ? round.id : game.id)) : null;
  const disclosureHead = game.disclosures.filter(d => d.roundId === round.id).at(-1)?.id ?? null, snapshot = { roundId: round.id, phase: round.phase, phaseOrdinal: round.phaseOrdinal, generation: round.generation, teamId: command.teamId, playerId: command.playerId, eligiblePlayerIds: players.map(p => p.id), pickedEventId: picked ? round.pickedEventId : null, disclosureHead, deadline: round.deadline };
  game.attempts.push({ id: randomUUID(), roundId: round.id, itemId: command.itemId, phase: round.phase as 'MAIN' | 'TRAP' | 'STEAL' | 'SHARED' | 'TURN', phaseOrdinal: round.phaseOrdinal, generation: round.generation, teamId: command.teamId, playerId: command.playerId, ordinal: previous.length + 1, acceptedAt: now, deadline: round.deadline!, eventId: e.id, pickedEventId: snapshot.pickedEventId, allowanceId: allowance?.id ?? null, bonusEventId: round.bonus?.teamId === command.teamId && round.phase === 'MAIN' ? round.bonus.eventId : null, bonusMultiplier: round.bonus?.teamId === command.teamId && round.phase === 'MAIN' ? 2 : 1, disclosureHead, eligiblePlayerIds: snapshot.eligiblePlayerIds, eligibilityHash: admissionHash(snapshot) });
  const effect = addEffect(game, e, round, 'TIMING'); sealEffect(effect); round.version++;
}
export function interimCompetitiveWrong(game: CompetitionGame, round: CompetitionRound, command: Extract<CompetitionCommand, { type: 'INTERIM_WRONG' }>, now: number): void {
  if (hasCompetitiveReview(game) || round.pause || round.publicRevealed) return fail(409, 'INVALID_PHASE');
  const attempt = game.attempts.find(a => a.id === command.attemptId && a.roundId === round.id) ?? fail(404, 'MATCH_NOT_FOUND'); if (game.classifications.some(c => c.attemptId === attempt.id)) return fail(409, 'ATTEMPT_ALREADY_CLASSIFIED');
  const beforeClock = clockSnapshot(round), e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now); game.classifications.push({ id: randomUUID(), attemptId: attempt.id, eventId: e.id, correct: false, interim: true });
  if (standaloneCompetition(game.request.executionFormat) && attempt.generation === round.generation && attempt.teamId === round.currentTeamId && round.phase === 'TURN' && round.deadline !== null && now < round.deadline) {
    const max = round.doubleAttemptTeamId === attempt.teamId ? 2 : 1, used = game.attempts.filter(a => a.roundId === round.id && a.teamId === attempt.teamId && a.generation === attempt.generation).length;
    if (used >= max) transferStandalone(game, round, now);
  }
  const effect = addEffect(game, e, round, 'INTERIM', { beforeClock, originalAttemptIds: [attempt.id] }); sealEffect(effect); round.version++;
}
export function publicCompetitiveReveal(game: CompetitionGame, round: CompetitionRound, command: Extract<CompetitionCommand, { type: 'PUBLIC_REVEAL' }>, now: number): void {
  if (hasCompetitiveReview(game) || round.pause || round.phase === 'READY' || round.phase === 'RESOLVED' || !itemCompetitionRound(round) && command.itemId !== null) return fail(409, 'INVALID_PHASE');
  if (command.itemId !== null && (!round.pin.items.some(i => i.id === command.itemId) || round.itemReveals.includes(command.itemId))) return fail(409, 'ITEM_RESOLVED');
  const beforeClock = clockSnapshot(round), e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now);
  if (command.itemId === null) { if (round.publicRevealed) return fail(409, 'INVALID_PHASE'); round.publicRevealed = true; round.phase = 'AWAITING_RULING'; round.deadline = null; round.overallDeadline = null; invalidateCompetitionGrants(game, round); }
  else { round.itemReveals.push(command.itemId); if (round.assignment?.itemId === command.itemId) invalidateCompetitionGrants(game, round); }
  const effect = addEffect(game, e, round, 'DISCLOSURE', { beforeClock }); sealEffect(effect); round.version++;
}
export function finalCompetitiveRuling(game: CompetitionGame, round: CompetitionRound, command: Extract<CompetitionCommand, { type: 'FINAL_RULING' }>, now: number): void {
  if (round.phase === 'READY' || round.phase === 'RESOLVED') return fail(409, 'INVALID_PHASE');
  if (hasCompetitiveReview(game) || round.pause || (command.itemId === null ? !round.publicRevealed : !round.itemReveals.includes(command.itemId))) return fail(409, 'PUBLIC_REVEAL_REQUIRED');
  const item = command.itemId === null ? null : round.pin.items.find(i => i.id === command.itemId) ?? fail(404, 'MATCH_NOT_FOUND');
  if (itemCompetitionRound(round) && item === null && !round.publicRevealed || !itemCompetitionRound(round) && item !== null || item && round.consumed.some(c => c.itemId === item.id)) return fail(409, 'ITEM_RESOLVED');
  const pending = pendingAttempts(game, round.id, command.itemId === null && itemCompetitionRound(round) ? undefined : command.itemId), requested = command.classifications;
  if (pending.length !== requested.length || requested.some(c => !pending.some(a => a.id === c[0]))) return fail(409, 'COMPLETE_RULING_REQUIRED');
  const correct = pending.filter(a => requested.find(c => c[0] === a.id)![1]), teams = [...new Set(correct.map(a => a.teamId))]; if (item && teams.length > 1) return fail(409, 'ITEM_RULING_REQUIRED');
  if (itemCompetitionRound(round) && item === null) {
    // Whole-question reveal requires one atomic classification of ALL pending
    // item evidence. Each item retains a separate immutable effect/head and
    // exactly one consumption; no shared double-award of the same item.
    const keys = [...new Set(pending.map(a => a.itemId))]; if (keys.includes(null)) return fail(503, 'ATTEMPT_PROOF_UNAVAILABLE');
    const e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), effects = [];
    for (const a of pending) game.classifications.push({ id: randomUUID(), attemptId: a.id, eventId: e.id, correct: requested.find(c => c[0] === a.id)![1], interim: false });
    for (const key of keys) {
      const pin = round.pin.items.find(i => i.id === key) ?? fail(503, 'ATTEMPT_PROOF_UNAVAILABLE'), group = pending.filter(a => a.itemId === key), winners = group.filter(a => requested.find(c => c[0] === a.id)![1]), original = game.attempts.filter(a => a.roundId === round.id && a.itemId === key);
      if (new Set(winners.map(a => a.teamId)).size > 1 || round.consumed.some(c => c.itemId === key)) return fail(409, 'ITEM_RESOLVED');
      const effect = addEffect(game, e, round, winners.length ? 'RULING' : 'NO_SCORE', { reversible: true, amountKind: pin.trap && !standaloneCompetition(game.request.executionFormat) ? 'DERIVED' : 'FIXED', originalAttemptIds: original.map(a => a.id), correctAttemptIds: winners.map(a => a.id), bonusSnapshot: original.map(a => ({ attemptId: a.id, teamId: a.teamId, multiplier: a.bonusMultiplier, sourceEventId: a.bonusEventId })) });
      if (winners.length) post(game, effect, winners[0].teamId, pin.trap ? -pin.value : pin.value, !standaloneCompetition(game.request.executionFormat));
      round.consumed.push({ itemId: pin.id, effectId: effect.id, teamId: winners[0]?.teamId ?? null }); effects.push({ effect, key: pin.id });
    }
    closeCompetitionRound(game, round, 'ADJUDICATED');
    if (!effects.length) { const effect = addEffect(game, e, round, 'NO_SCORE', { reversible: false, amountKind: 'NONE', originalAttemptIds: game.attempts.filter(a => a.roundId === round.id).map(a => a.id), bonusSnapshot: game.attempts.filter(a => a.roundId === round.id).map(a => ({ attemptId: a.id, teamId: a.teamId, multiplier: a.bonusMultiplier, sourceEventId: a.bonusEventId })) }); effects.push({ effect, key: null }); }
    for (const { effect, key } of effects) { effect.afterClock = clockSnapshot(round); sealEffect(effect); const scopeId = JSON.stringify([round.id, key]); if (game.rulings.some(h => h.scopeId === scopeId)) return fail(409, 'RULING_ALREADY_FINAL'); game.rulings.push({ roundId: round.id, itemId: key, scopeId, originalEffectId: effect.id, effectId: effect.id, version: 1, hash: effect.hash, reversed: false }); }
    return;
  }
  const beforeClock = clockSnapshot(round), e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), originals = game.attempts.filter(a => a.roundId === round.id && (item ? a.itemId === item.id : true));
  const effect = addEffect(game, e, round, correct.length ? 'RULING' : 'NO_SCORE', { reversible: true, amountKind: item?.trap && !standaloneCompetition(game.request.executionFormat) ? 'DERIVED' : 'FIXED', beforeClock, originalAttemptIds: originals.map(a => a.id), correctAttemptIds: correct.map(a => a.id), bonusSnapshot: originals.map(a => ({ attemptId: a.id, teamId: a.teamId, multiplier: a.bonusMultiplier, sourceEventId: a.bonusEventId })) });
  for (const a of pending) game.classifications.push({ id: randomUUID(), attemptId: a.id, eventId: e.id, correct: requested.find(c => c[0] === a.id)![1], interim: false });
  if (item) {
    const winner = correct[0]; if (winner) post(game, effect, winner.teamId, item.trap ? -item.value : item.value, !standaloneCompetition(game.request.executionFormat));
    round.consumed.push({ itemId: item.id, effectId: effect.id, teamId: winner?.teamId ?? null }); if (round.assignment?.itemId === item.id) invalidateCompetitionGrants(game, round);
    // Late ruling never rewinds an already-transferred turn/cap. Only the same
    // currently running generation receives its normal immediate reset/transfer.
    if (!round.resourceStop && standaloneCompetition(game.request.executionFormat) && winner && winner.generation === round.generation && winner.teamId === round.currentTeamId && round.phase === 'TURN' && round.deadline !== null && now < round.deadline) { if (item.trap) transferStandalone(game, round, now); else { round.deadline = now + game.request.setup.rules.turnSeconds * 1000; round.phaseOrdinal++; round.generation++; round.doubleAttemptTeamId = null; round.version++; invalidateCompetitionGrants(game, round); } }
    if (round.consumed.length === round.pin.items.length && !pendingAttempts(game, round.id).length) closeCompetitionRound(game, round, 'ALL_ITEMS');
    else if (round.deadline === null && !pendingAttempts(game, round.id).length) closeCompetitionRound(game, round, 'TIME_EXPIRED');
  } else {
    if (!itemCompetitionRound(round)) for (const teamId of teams) { const multiplier = Math.max(...correct.filter(a => a.teamId === teamId).map(a => a.bonusMultiplier)); post(game, effect, teamId, round.pin.points! * multiplier); }
    closeCompetitionRound(game, round, 'ADJUDICATED');
  }
  effect.afterClock = clockSnapshot(round); sealEffect(effect); const scopeId = JSON.stringify([round.id, command.itemId]); if (game.rulings.some(h => h.scopeId === scopeId)) return fail(409, 'RULING_ALREADY_FINAL'); game.rulings.push({ roundId: round.id, itemId: command.itemId, scopeId, originalEffectId: effect.id, effectId: effect.id, version: 1, hash: effect.hash, reversed: false }); round.version++;
}
