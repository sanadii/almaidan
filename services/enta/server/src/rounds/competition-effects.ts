import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { Authority, RoundEvent } from './types';
import type { Attempt, ClockSnapshot, CompetitionGame, CompetitionRound, CompetitionTeam, Effect, ScoreRead } from './competition-types';
import { standaloneCompetition } from './competition-rules';
import { MAX_GAME_FACTS, MAX_GAME_VERSION } from './competition-capacity';
export function competitiveEvent(game: CompetitionGame, commandId: string, hash: string, type: string, roundId: string | null, now: number, authority: Authority = { kind: 'HOST', identityId: game.identityId }, pauseReason: string | null = null): RoundEvent {
  if (game.version >= MAX_GAME_VERSION) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  const e = { id: randomUUID(), commandId, hash, sequence: ++game.version, type, roundId, authority, at: now, pauseReason }; game.events.push(e); return e;
}
export function scoreRead(team: CompetitionTeam, kind: ScoreRead['kind'] = 'BASE'): ScoreRead { return { teamId: team.id, scoreVersion: team.scoreVersion, value: team.score, sourceEffectId: team.scoreHead, kind }; }
export function clockSnapshot(round: CompetitionRound): ClockSnapshot { return structuredClone({ phase: round.phase, phaseOrdinal: round.phaseOrdinal, generation: round.generation, currentTeamId: round.currentTeamId, deadline: round.deadline, overallDeadline: round.overallDeadline, pause: round.pause }); }
export function addEffect(game: CompetitionGame, event: RoundEvent, round: CompetitionRound | null, kind: Effect['kind'], options: Partial<Omit<Effect, 'id' | 'eventId' | 'sequence' | 'roundId' | 'kind' | 'hash'>> = {}): Effect {
  if (game.effects.length >= MAX_GAME_FACTS) return fail(503, 'CAPACITY_PROOF_UNAVAILABLE');
  const effect: Effect = { id: randomUUID(), eventId: event.id, sequence: game.effects.length + 1, roundId: round?.id ?? null, kind, aid: null, amountKind: 'NONE', reversible: false, barrier: true, reads: [], dependencies: [], postingIds: [], originalAttemptIds: [], correctAttemptIds: [], bonusSnapshot: [], beforeClock: null, afterClock: round ? clockSnapshot(round) : null, predecessorId: null, predecessorHash: null, reason: null, hash: '', ...options };
  game.effects.push(effect); game.latestEffectId = effect.id; return effect;
}
export function sealEffect(effect: Effect): void { const { hash: previousHash, ...payload } = effect; void previousHash; effect.hash = admissionHash({ domain: 'maydan.enta.effect.v1', payload }); }
export function post(game: CompetitionGame, effect: Effect, teamId: string, requestedDelta: number, clamp = false): void {
  const team = game.teams.find(t => t.id === teamId) ?? fail(404, 'MATCH_NOT_FOUND'), before = team.score, after = clamp ? Math.max(0, before + requestedDelta) : before + requestedDelta;
  if (!Number.isSafeInteger(requestedDelta) || !Number.isSafeInteger(after) || after < -2147483648 || after > 2147483647 || !standaloneCompetition(game.request.executionFormat) && after < 0) return fail(409, 'SCORE_BOUND_EXCEEDED');
  const read = scoreRead(team, clamp ? 'CLAMP' : 'BASE'); effect.reads.push(read); if (read.sourceEffectId && !effect.dependencies.includes(read.sourceEffectId)) effect.dependencies.push(read.sourceEffectId);
  const posting = { id: randomUUID(), effectId: effect.id, teamId, delta: after - before, before, after, scoreVersion: team.scoreVersion + 1, previousHead: team.scoreHead }; game.postings.push(posting); effect.postingIds.push(posting.id); team.score = after; team.scoreVersion++; team.scoreHead = effect.id;
}
export function pendingAttempts(game: CompetitionGame, roundId: string, itemId?: string | null): Attempt[] { return game.attempts.filter(a => a.roundId === roundId && (itemId === undefined || a.itemId === itemId) && !game.classifications.some(c => c.attemptId === a.id)); }
export const hasCompetitiveReview = (game: CompetitionGame): boolean => game.openItemReview !== null || game.correctionReview !== null;
export function invalidateCompetitionGrants(game: CompetitionGame, round: CompetitionRound): void {
  for (const scope of game.grantScopes.filter(s => s.roundId === round.id)) { if (scope.activeGrantId) { const grant = game.grants.find(g => g.id === scope.activeGrantId); if (grant) grant.revoked = true; } scope.activeGrantId = null; }
  round.assignment = null;
}
export function closeCompetitionRound(game: CompetitionGame, round: CompetitionRound, reason: CompetitionRound['reason']): void {
  if (pendingAttempts(game, round.id).length) return fail(409, 'PENDING_RULING_REQUIRED');
  round.phase = 'RESOLVED'; round.reason = reason; round.pause = null; round.deadline = null; round.overallDeadline = null; round.version++; game.activeRoundId = null; if (!round.turnAdvanced) { game.turnIndex++; round.turnAdvanced = true; } invalidateCompetitionGrants(game, round);
}
export function eligiblePlayers(game: CompetitionGame, round: CompetitionRound, teamId: string): CompetitionTeam['players'] {
  const team = game.teams.find(t => t.id === teamId) ?? fail(404, 'MATCH_NOT_FOUND');
  if (round.pin.format !== 'DRAWING_TARGET') return team.players;
  // Durable target receipts survive grant revocation, assignment changes,
  // compensation and uncertain delivery. An active drawer is also ineligible.
  return team.players.filter(p => p.id !== round.assignment?.playerId && !game.disclosures.some(d => d.roundId === round.id && d.playerId === p.id));
}
