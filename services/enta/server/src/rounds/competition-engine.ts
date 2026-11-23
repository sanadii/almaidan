import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { metadata } from './grants';
import { addEffect, clockSnapshot, closeCompetitionRound, competitiveEvent, hasCompetitiveReview, invalidateCompetitionGrants, pendingAttempts, sealEffect } from './competition-effects';
import { itemCompetitionRound, resumeCompetitivePause, settleCompetitiveClock } from './competition-clock';
import { useCompetitiveAid } from './competition-aids';
import { finalCompetitiveRuling, interimCompetitiveWrong, publicCompetitiveReveal, recordCompetitiveAttempt } from './competition-attempts';
import { correctCompetitiveRuling, resolveCompetitiveItemReview, undoCompetitiveEffect } from './competition-corrections';
import { competitiveGrantCommand } from './competition-grants';
import { appendEngineResult, deriveFirstEngineResult } from './competition-results';
import { standaloneCompetition } from './competition-rules';
import { reconcileCapacity, resourceAllows } from './competition-capacity';
import type { CompetitionCommand, CompetitionGame, CompetitionRound } from './competition-types';

export function scopeCompetitionCommand(game: CompetitionGame, command: CompetitionCommand): void {
  const round = 'roundId' in command ? game.rounds.find(r => r.id === command.roundId) ?? fail(404, 'MATCH_NOT_FOUND') : null;
  if ('teamId' in command && !game.teams.some(t => t.id === command.teamId)) return fail(404, 'MATCH_NOT_FOUND');
  if ('playerId' in command && !game.teams.find(t => t.id === command.teamId)?.players.some(p => p.id === command.playerId)) return fail(404, 'MATCH_NOT_FOUND');
  if ('itemId' in command && command.itemId !== null && !round?.pin.items.some(i => i.id === command.itemId)) return fail(404, 'MATCH_NOT_FOUND');
  if ('attemptId' in command && !game.attempts.some(a => a.id === command.attemptId && a.roundId === round?.id)) return fail(404, 'MATCH_NOT_FOUND');
  if (command.type === 'FINAL_RULING' && command.classifications.some(c => !game.attempts.some(a => a.id === c[0] && a.roundId === round?.id && (command.itemId === null || a.itemId === command.itemId)))) return fail(404, 'MATCH_NOT_FOUND');
  if ('scopeId' in command && !game.grantScopes.some(s => s.id === command.scopeId && s.roundId === round?.id)) return fail(404, 'MATCH_NOT_FOUND');
  if ('effectId' in command && command.effectId !== null && !game.effects.some(e => e.id === command.effectId && (!round || e.roundId === round.id))) return fail(404, 'MATCH_NOT_FOUND');
  if (command.type === 'RESOLVE_ITEM_REVIEW' && !game.itemReviews.some(r => r.id === command.reviewId)) return fail(404, 'MATCH_NOT_FOUND');
  if ('correctAttemptIds' in command) { const originalId = command.type === 'RESOLVE_ITEM_REVIEW' ? game.itemReviews.find(r => r.id === command.reviewId)!.originalEffectId : command.effectId, original = game.effects.find(e => e.id === originalId) ?? fail(404, 'MATCH_NOT_FOUND'); if (command.correctAttemptIds.some(id => !original.originalAttemptIds.includes(id))) return fail(404, 'MATCH_NOT_FOUND'); }
}
function active(game: CompetitionGame, round: CompetitionRound): void { if (game.activeRoundId !== round.id || round.phase === 'READY' || round.phase === 'RESOLVED') return fail(409, 'INVALID_PHASE'); }
function mutable(game: CompetitionGame, round: CompetitionRound): void { active(game, round); if (round.pause) return fail(409, 'ROUND_PAUSED'); }
export interface CompetitionReduction { next: CompetitionGame; rejection: 'ROUND_TIME_EXPIRED' | 'RESOURCE_LIMIT_REACHED' | null; idempotent: boolean; grantData?: ReturnType<typeof metadata> & { token?: string; tokenUnavailable: boolean } }
/** Pure reference successor. Production SQL independently derives after its
 * final lock/clock and returns authoritative state, which service must use. */
export function reduceCompetitionCommand(game: CompetitionGame, command: CompetitionCommand, now: number): CompetitionReduction {
  scopeCompetitionCommand(game, command);
  const hash = admissionHash(command), duplicate = game.events.find(e => e.commandId === command.commandId);
  if (duplicate) {
    if (duplicate.hash !== hash) return fail(409, 'COMMAND_KEY_CONFLICT');
    const grant = ['CREATE_GRANT', 'ROTATE_GRANT', 'REVOKE_GRANT'].includes(command.type) ? game.grants.find(g => g.id === duplicate.id) ?? fail(503, 'GRANT_DATA_UNAVAILABLE') : null;
    return { next: game, rejection: null, idempotent: true, ...(grant ? { grantData: { ...metadata(grant), tokenUnavailable: true } } : {}) };
  }
  if (command.type === 'REPORT_VAR') return fail(503, 'AUDIT_TRANSACTION_REQUIRED');
  if (game.finished) return fail(403, 'MATCH_FINISHED');
  const next = structuredClone(game), changed = settleCompetitiveClock(next, now);
  if (changed) return { next, rejection: next.events.slice(game.events.length).some(e => e.type === 'RESOURCE_LIMIT_REACHED') ? 'RESOURCE_LIMIT_REACHED' : 'ROUND_TIME_EXPIRED', idempotent: false };
  if (next.version !== command.expectedVersion) return fail(409, 'STALE_VERSION');
  if (next.openItemReview && !['RESOLVE_ITEM_REVIEW', 'REVOKE_GRANT'].includes(command.type) || next.correctionReview && !['CORRECT_RULING', 'REVOKE_GRANT'].includes(command.type)) return fail(409, 'RULING_REVIEW_OPEN');
  const round = 'roundId' in command ? next.rounds.find(r => r.id === command.roundId)! : null;
  if (round?.resourceStop && !resourceAllows(command)) return fail(409, 'RESOURCE_LIMIT_REACHED');
  let grantData: CompetitionReduction['grantData'];
  switch (command.type) {
    case 'OPEN_ROUND': case 'NEXT_ROUND': {
      if (next.activeRoundId || hasCompetitiveReview(next) || pendingAttemptsEverywhere(next)) return fail(409, 'PENDING_RULING_REQUIRED');
      const target = command.type === 'OPEN_ROUND' ? round! : next.rounds.find(r => r.phase === 'READY') ?? fail(409, 'NO_MORE_ROUNDS');
      if (target.phase !== 'READY' || standaloneCompetition(next.request.executionFormat) && next.rounds.find(r => r.phase === 'READY')?.id !== target.id) return fail(409, 'INVALID_PHASE');
      const e = competitiveEvent(next, command.commandId, hash, command.type, target.id, now), standalone = standaloneCompetition(next.request.executionFormat), items = itemCompetitionRound(target);
      target.originalTeamId = next.teams[next.turnIndex % next.teams.length].id; target.currentTeamId = target.originalTeamId; target.phase = standalone ? 'TURN' : items ? 'SHARED' : 'MAIN'; target.phaseOrdinal = 1; target.generation = 1; target.deadline = now + (standalone ? next.request.setup.rules.turnSeconds * 1000 : items ? 40000 : next.request.setup.rules.questionSeconds * 1000); target.originalDeadline = target.deadline; target.overallDeadline = standalone && next.request.setup.rules.overallSeconds !== null ? now + next.request.setup.rules.overallSeconds * 1000 : null; target.version++; next.activeRoundId = target.id;
      if (target.pin.format === 'DRAWING_TARGET') next.canvases.push({ roundId: target.id, revision: 0, strokes: [], visibleIds: [], redoIds: [], cumulativePoints: 0, mutations: 0, receipts: [] });
      const effect = addEffect(next, e, target, 'TIMING'); sealEffect(effect); break;
    }
    case 'USE_AID': useCompetitiveAid(next, round!, command, now); break;
    case 'RECORD_ATTEMPT': recordCompetitiveAttempt(next, round!, command, now); break;
    case 'INTERIM_WRONG': interimCompetitiveWrong(next, round!, command, now); break;
    case 'PUBLIC_REVEAL': publicCompetitiveReveal(next, round!, command, now); break;
    case 'FINAL_RULING': finalCompetitiveRuling(next, round!, command, now); break;
    case 'UNDO_EFFECT': undoCompetitiveEffect(next, command, now); break;
    case 'CORRECT_RULING': correctCompetitiveRuling(next, command, now); break;
    case 'RESOLVE_ITEM_REVIEW': resolveCompetitiveItemReview(next, command, now); break;
    case 'CREATE_GRANT': case 'ROTATE_GRANT': case 'REVOKE_GRANT': grantData = competitiveGrantCommand(next, command, now); break;
    case 'REVEAL_HINT': {
      mutable(next, round!); if (round!.publicRevealed || round!.revealedHintIds.length || !['ORDINARY_TIER', 'DRAWING_TARGET'].includes(round!.pin.format)) return fail(409, 'HINT_UNAVAILABLE'); const hint = round!.pin.hints[0]; if (!hint || round!.pin.format === 'DRAWING_TARGET' && !hint.safeDrawing) return fail(409, 'HINT_UNAVAILABLE');
      const e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now); round!.revealedHintIds.push(hint.id); const effect = addEffect(next, e, round!, 'DISCLOSURE'); sealEffect(effect); break;
    }
    case 'SELECT_SCORING_TEAM': {
      mutable(next, round!); if (round!.phase !== 'SHARED' || !itemCompetitionRound(round!) || round!.publicRevealed) return fail(409, 'INVALID_PHASE'); const e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now); round!.currentTeamId = command.teamId; const effect = addEffect(next, e, round!, 'TIMING'); sealEffect(effect); break;
    }
    case 'ASSIGN_ACTOR': {
      mutable(next, round!); if (round!.publicRevealed || !['ACTING_ITEMS', 'DRAWING_TARGET'].includes(round!.pin.format) || round!.pin.format === 'DRAWING_TARGET' && command.itemId !== null || round!.pin.format === 'ACTING_ITEMS' && (command.itemId === null || round!.itemReveals.includes(command.itemId) || round!.consumed.some(c => c.itemId === command.itemId))) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
      invalidateCompetitionGrants(next, round!); const e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now); round!.assignment = { id: e.id, teamId: command.teamId, playerId: command.playerId, itemId: command.itemId, generation: ++round!.version }; const effect = addEffect(next, e, round!, 'DISCLOSURE'); sealEffect(effect); break;
    }
    case 'PAUSE_ROUND': {
      mutable(next, round!); if (round!.deadline === null || round!.publicRevealed) return fail(409, 'INVALID_PHASE'); const beforeClock = clockSnapshot(round!), e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now, { kind: 'HOST', identityId: next.identityId }, command.reason);
      round!.pause = { cause: 'ADMIN', eventId: e.id, resumeAt: null, phaseRemaining: round!.deadline - now, overallRemaining: round!.overallDeadline === null ? null : round!.overallDeadline - now }; round!.deadline = null; round!.overallDeadline = null; invalidateCompetitionGrants(next, round!); const effect = addEffect(next, e, round!, 'TIMING', { beforeClock }); sealEffect(effect); break;
    }
    case 'END_ASSISTANCE': case 'RESUME_ROUND': {
      active(next, round!); if (!round!.pause || (command.type === 'END_ASSISTANCE' ? round!.pause.cause !== 'PHONE' : round!.pause.cause === 'PHONE')) return fail(409, 'INVALID_PHASE'); const beforeClock = clockSnapshot(round!), e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now); resumeCompetitivePause(round!, now); const effect = addEffect(next, e, round!, 'TIMING', { beforeClock }); sealEffect(effect); break;
    }
    case 'CLOSE_ROUND': {
      mutable(next, round!); if (!round!.publicRevealed || pendingAttempts(next, round!.id).length) return fail(409, 'PENDING_RULING_REQUIRED'); const e = competitiveEvent(next, command.commandId, hash, command.type, round!.id, now); closeCompetitionRound(next, round!, 'HOST_CLOSED'); const effect = addEffect(next, e, round!, 'TIMING'); sealEffect(effect); break;
    }
    case 'FINISH': {
      if (next.activeRoundId || hasCompetitiveReview(next) || pendingAttemptsEverywhere(next)) return fail(409, 'PENDING_RULING_REQUIRED'); const unplayed = next.rounds.filter(r => r.phase !== 'RESOLVED').length; if (unplayed && !command.confirmEarly) return fail(409, 'EARLY_FINISH_CONFIRMATION_REQUIRED');
      const e = competitiveEvent(next, command.commandId, hash, command.type, null, now); next.finished = true; next.resultReason = unplayed ? 'HOST_ENDED' : 'ALL_ROUNDS'; const effect = addEffect(next, e, null, 'FINISH'); sealEffect(effect); appendEngineResult(next, deriveFirstEngineResult(next, e.id), null); break;
    }
    case 'RESOLVE_TIE': return fail(403, 'TIE_AUTHORITY_UNAVAILABLE');
  }
  reconcileCapacity(game, next, command);
  return { next, rejection: null, idempotent: false, ...(grantData ? { grantData } : {}) };
}
export function pendingAttemptsEverywhere(game: CompetitionGame): boolean { return game.attempts.some(a => !game.classifications.some(c => c.attemptId === a.id)); }
export function createCompetitiveAuditReport(game: CompetitionGame, command: Extract<CompetitionCommand, { type: 'REPORT_VAR' }>, eventId = randomUUID()) {
  scopeCompetitionCommand(game, command); return { id: randomUUID(), roundId: command.roundId, effectId: command.effectId, blockingIds: command.blockingIds, reason: command.reason, eventId };
}
