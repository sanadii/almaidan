import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { addEffect, clockSnapshot, competitiveEvent, eligiblePlayers, hasCompetitiveReview, invalidateCompetitionGrants, post, scoreRead, sealEffect } from './competition-effects';
import { allowedAids, standaloneCompetition } from './competition-rules';
import type { CompetitionCommand, CompetitionGame, CompetitionRound } from './competition-types';
export function transferStandalone(game: CompetitionGame, round: CompetitionRound, now: number): void {
  const index = game.teams.findIndex(t => t.id === round.currentTeamId); round.currentTeamId = game.teams[(index + 1) % game.teams.length].id; round.phaseOrdinal++; round.generation++; round.doubleAttemptTeamId = null; round.deadline = now + game.request.setup.rules.turnSeconds * 1000; round.version++; invalidateCompetitionGrants(game, round);
}
export function useCompetitiveAid(game: CompetitionGame, round: CompetitionRound, command: Extract<CompetitionCommand, { type: 'USE_AID' }>, now: number): void {
  const format = game.request.executionFormat, standalone = standaloneCompetition(format), team = game.teams.find(t => t.id === command.teamId) ?? fail(404, 'MATCH_NOT_FOUND');
  if (hasCompetitiveReview(game) || round.pause || round.publicRevealed || !['MAIN', 'SHARED', 'TURN'].includes(round.phase) || round.deadline === null || now >= round.deadline || command.teamId !== (standalone ? round.currentTeamId : round.originalTeamId) || !allowedAids(format, round.pin.format).includes(command.aid)) return fail(409, 'AID_UNAVAILABLE');
  const allowance = game.allowances.find(a => a.teamId === team.id && a.aid === command.aid && a.scopeId === (standalone ? round.id : game.id)); if (!allowance || game.consumptions.some(c => c.allowanceId === allowance.id) || round.usedAidIds.some(id => game.consumptions.find(c => c.id === id)?.aid === 'TRAP')) return fail(409, 'AID_UNAVAILABLE');
  const beforeClock = clockSnapshot(round), e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), effect = addEffect(game, e, round, 'AID', { aid: command.aid, beforeClock });
  if (command.aid === 'PHONE_A_FRIEND' || command.aid === 'PHONE' || command.aid === 'FREEZE') {
    round.pause = { cause: command.aid === 'FREEZE' ? 'FREEZE' : 'PHONE', eventId: e.id, resumeAt: command.aid === 'FREEZE' ? null : now + 60000, phaseRemaining: round.deadline - now, overallRemaining: round.overallDeadline === null ? null : Math.max(0, round.overallDeadline - now) }; round.deadline = null; round.overallDeadline = null;
  } else if (command.aid === 'DOUBLE_ANSWER' || command.aid === 'DOUBLE') {
    if (round.doubleAttemptTeamId) return fail(409, 'AID_UNAVAILABLE'); round.doubleAttemptTeamId = team.id;
  } else if (command.aid === 'DOUBLE_POINTS') {
    if (round.bonus || game.attempts.some(a => a.roundId === round.id && a.teamId === team.id)) return fail(409, 'AID_UNAVAILABLE'); round.bonus = { teamId: team.id, multiplier: 2, eventId: e.id };
  } else if (command.aid === 'MORE_HINT') {
    if (!round.pin.hints[0] || !['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format) && !round.revealedHintIds.includes(round.pin.hints[0].id)) return fail(409, 'HINT_UNAVAILABLE');
    const hint = round.pin.hints.find(h => !round.revealedHintIds.includes(h.id)); if (!hint || round.pin.format === 'DRAWING_TARGET' && !hint.safeDrawing) return fail(409, 'HINT_UNAVAILABLE'); round.revealedHintIds.push(hint.id);
  } else if (command.aid === 'HINT') {
    const item = round.pin.items.filter(i => !i.trap && !round.consumed.some(c => c.itemId === i.id) && !round.itemReveals.includes(i.id) && !round.graphemeHints.some(h => h.itemId === i.id)).sort((a, b) => b.value - a.value || a.ordinal - b.ordinal)[0];
    const proof = item && round.pin.graphemes.find(p => p.answerRevisionId === item.revisionId && p.answerHash === item.hash); if (!item || !proof) return fail(409, 'HINT_UNAVAILABLE'); round.graphemeHints.push({ proofId: proof.id, itemId: item.id, eventId: e.id });
  } else if (command.aid === 'PICK_ANSWERER') {
    const candidates = eligiblePlayers(game, round, team.id); if (!candidates.length) return fail(409, 'NO_ELIGIBLE_PLAYER');
    const ranked = candidates.map(player => ({ player, rank: admissionHash([game.intent.seed, round.id, round.generation, player.id]) })).sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.player.id < b.player.id ? -1 : 1); round.pickedPlayerId = ranked[0].player.id; round.pickedEventId = e.id;
  } else if (command.aid === 'TRAP') {
    if (round.usedAidIds.length || game.attempts.some(a => a.roundId === round.id)) return fail(409, 'AID_PAIRING_DENIED');
    round.phase = 'TRAP'; round.phaseOrdinal++; round.generation++; round.currentTeamId = game.teams[(game.teams.findIndex(t => t.id === round.originalTeamId) + 1) % game.teams.length].id; round.deadline = Math.min(round.deadline, now + 10000); round.doubleAttemptTeamId = null; invalidateCompetitionGrants(game, round);
  } else if (command.aid === 'PASS') {
    const used = game.attempts.filter(a => a.roundId === round.id && a.teamId === team.id && a.generation === round.generation);
    if (round.doubleAttemptTeamId === team.id && used.length < 2) return fail(409, 'AID_PAIRING_DENIED'); transferStandalone(game, round, now);
  } else if (command.aid === 'STEAL_POINTS') {
    // Record every candidate, including opponents receiving no posting. A
    // later correction can otherwise change the victim or capped amount.
    const opponents = game.teams.filter(t => t.id !== team.id); effect.reads = opponents.map(t => scoreRead(t, 'RANK')); effect.dependencies = [...new Set(effect.reads.flatMap(r => r.sourceEffectId ? [r.sourceEffectId] : []))];
    const target = opponents.reduce((best, t) => t.score > best.score ? t : best), amount = Math.min(round.pin.effectValue, Math.max(0, target.score)); if (amount === 0) return fail(409, 'AID_UNAVAILABLE');
    effect.amountKind = 'DERIVED'; effect.reversible = true; post(game, effect, target.id, -amount); post(game, effect, team.id, amount);
  } else return fail(409, 'AID_UNAVAILABLE');
  if (round.pause) invalidateCompetitionGrants(game, round);
  const consumption = { id: randomUUID(), allowanceId: allowance.id, roundId: round.id, eventId: e.id, effectId: effect.id, aid: command.aid, teamId: team.id }; game.consumptions.push(consumption); round.usedAidIds.push(consumption.id); round.version++; effect.afterClock = clockSnapshot(round); sealEffect(effect);
}
