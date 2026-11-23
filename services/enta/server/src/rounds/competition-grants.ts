import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { metadata, tokenHash } from './grants';
import { addEffect, competitiveEvent, hasCompetitiveReview, sealEffect } from './competition-effects';
import { itemCompetitionRound } from './competition-clock';
import type { Grant } from './types';
import type { CompetitionCommand, CompetitionGame } from './competition-types';
type GrantCommand = Extract<CompetitionCommand, { type: 'CREATE_GRANT' | 'ROTATE_GRANT' | 'REVOKE_GRANT' }>;
export function authorizeCompetitiveGrant(game: CompetitionGame | null, hash: string, now: number) {
  if (!game || game.finished || hasCompetitiveReview(game) || !/^[a-f0-9]{64}$/.test(hash)) return fail(403, 'GRANT_DENIED');
  const grant = game.grants.find(g => /^[a-f0-9]{64}$/.test(g.tokenHash) && timingSafeEqual(Buffer.from(g.tokenHash, 'hex'), Buffer.from(hash, 'hex'))), round = game.rounds.find(r => r.id === grant?.roundId), scope = game.grantScopes.find(s => s.id === grant?.scopeId);
  if (!grant || !round || !scope || round.resourceStop || grant.revoked || grant.expiresAt <= now || scope.activeGrantId !== grant.id || scope.generation !== grant.generation || scope.assignmentId !== grant.assignmentId || game.activeRoundId !== round.id || round.pause || round.publicRevealed || !['MAIN', 'TRAP', 'STEAL', 'SHARED', 'TURN'].includes(round.phase) || round.deadline === null || now >= round.deadline || round.overallDeadline !== null && now >= round.overallDeadline) return fail(403, 'GRANT_DENIED');
  if (grant.role === 'JUDGE' ? !itemCompetitionRound(round) || grant.assignmentId !== null : !round.assignment || round.assignment.id !== grant.assignmentId || !['ACTING_ITEMS', 'DRAWING_TARGET'].includes(round.pin.format) || round.assignment.itemId !== null && (round.itemReveals.includes(round.assignment.itemId) || round.consumed.some(c => c.itemId === round.assignment!.itemId))) return fail(403, 'GRANT_DENIED');
  return { game, grant, round };
}
/** Dispatcher authorizes owner/children and handles exact duplicate before
 * this transition. Raw tokens exist only in this fresh response, never state. */
export function competitiveGrantCommand(game: CompetitionGame, command: GrantCommand, now: number): ReturnType<typeof metadata> & { token?: string; tokenUnavailable: boolean } {
  const round = game.rounds.find(r => r.id === command.roundId) ?? fail(404, 'MATCH_NOT_FOUND');
  let scope = command.type === 'CREATE_GRANT' ? game.grantScopes.find(s => s.roundId === round.id && s.role === command.role && s.assignmentId === (command.role === 'ACTOR' ? round.assignment?.id ?? null : null)) : game.grantScopes.find(s => s.id === command.scopeId && s.roundId === round.id) ?? fail(404, 'MATCH_NOT_FOUND');
  if (game.finished || command.type !== 'REVOKE_GRANT' && (hasCompetitiveReview(game) || game.activeRoundId !== round.id || round.pause || round.publicRevealed || round.deadline === null || now >= round.deadline || !['MAIN', 'TRAP', 'STEAL', 'SHARED', 'TURN'].includes(round.phase))) return fail(409, 'INVALID_PHASE');
  if (command.type === 'CREATE_GRANT') {
    if (command.role === 'JUDGE' ? !itemCompetitionRound(round) : !round.assignment || !['ACTING_ITEMS', 'DRAWING_TARGET'].includes(round.pin.format)) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
    if (scope?.activeGrantId) return fail(409, 'GRANT_ALREADY_ACTIVE');
    if (!scope) { scope = { id: randomUUID(), roundId: round.id, role: command.role, assignmentId: command.role === 'ACTOR' ? round.assignment!.id : null, generation: 0, activeGrantId: null }; game.grantScopes.push(scope); }
  }
  if (command.type === 'ROTATE_GRANT' && scope!.generation !== command.expectedGeneration) return fail(409, 'STALE_GRANT_GENERATION');
  if (command.type !== 'REVOKE_GRANT' && scope!.role === 'ACTOR' && scope!.assignmentId !== round.assignment?.id) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
  const old = game.grants.find(g => g.id === scope!.activeGrantId); if (old) old.revoked = true; scope!.activeGrantId = null;
  const e = competitiveEvent(game, command.commandId, admissionHash(command), command.type, round.id, now), token = randomBytes(32).toString('base64url');
  const grant: Grant = { id: e.id, scopeId: scope!.id, roundId: round.id, role: scope!.role, assignmentId: scope!.assignmentId, generation: ++scope!.generation, tokenHash: tokenHash(token), expiresAt: command.type === 'REVOKE_GRANT' ? now : now + command.durationSeconds * 1000, revoked: command.type === 'REVOKE_GRANT' }; game.grants.push(grant);
  if (!grant.revoked) scope!.activeGrantId = grant.id;
  if (command.type !== 'REVOKE_GRANT') sealEffect(addEffect(game, e, round, 'DISCLOSURE'));
  return { ...metadata(grant), ...(grant.revoked ? {} : { token }), tokenUnavailable: grant.revoked };
}
