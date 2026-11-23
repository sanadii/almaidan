import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import { event, itemFormat } from './engine';
import type { Grant, GrantCommand, RoundGame, RoundRecord } from './types';
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
export function parseToken(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return fail(403, 'GRANT_DENIED'); return value; }
export function metadata(grant: Grant) { return { id: grant.id, scopeId: grant.scopeId, roundId: grant.roundId, role: grant.role, generation: grant.generation, expiresAt: grant.expiresAt, revoked: grant.revoked }; }
export function authorizeGrant(game: RoundGame | null, hash: string, now: number): { game: RoundGame; grant: Grant; round: RoundRecord } {
  if (!game || game.finished) return fail(403, 'GRANT_DENIED');
  const grant = game.grants.find(grant => timingSafeEqual(Buffer.from(grant.tokenHash, 'hex'), Buffer.from(hash, 'hex')));
  const round = grant && game.rounds.find(round => round.id === grant.roundId), scope = grant && game.grantScopes.find(scope => scope.id === grant.scopeId);
  if (!grant || !round || !scope || grant.revoked || grant.expiresAt <= now || scope.activeGrantId !== grant.id || scope.generation !== grant.generation || scope.roundId !== round.id || game.activeRoundId !== round.id || round.state !== 'RUNNING' || round.revealed || grant.assignmentId !== scope.assignmentId) return fail(403, 'GRANT_DENIED');
  if (grant.role === 'JUDGE' ? !itemFormat(round) || grant.assignmentId !== null : !round.assignment || round.assignment.id !== grant.assignmentId || !['ACTING_ITEMS', 'DRAWING_TARGET'].includes(round.pin.format) || round.assignment.itemId !== null && round.consumed.some(row => row.itemId === round.assignment!.itemId)) return fail(403, 'GRANT_DENIED');
  return { game, grant, round };
}
export function issueGrant(game: RoundGame, command: GrantCommand, now: number): { next: RoundGame; data: ReturnType<typeof metadata> & { token?: string; tokenUnavailable: boolean }; idempotent: boolean } {
  const round = game.rounds.find(round => round.id === command.roundId) ?? fail(404, 'MATCH_NOT_FOUND');
  if (command.type !== 'CREATE_GRANT' && !game.grantScopes.some(scope => scope.id === command.scopeId && scope.roundId === round.id)) return fail(404, 'MATCH_NOT_FOUND');
  const hash = admissionHash(command), duplicate = game.events.find(event => event.commandId === command.commandId);
  if (duplicate) {
    if (duplicate.hash !== hash) return fail(409, 'COMMAND_KEY_CONFLICT');
    const grant = game.grants.find(grant => grant.id === duplicate.id) ?? fail(503, 'GRANT_DATA_UNAVAILABLE');
    return { next: game, data: { ...metadata(grant), tokenUnavailable: true }, idempotent: true };
  }
  if (game.version !== command.expectedVersion) return fail(409, 'STALE_VERSION');
  if (game.finished || game.activeRoundId !== round.id || round.state !== 'RUNNING' || round.revealed) return fail(409, 'INVALID_PHASE');
  const next = structuredClone(game), current = next.rounds.find(row => row.id === round.id)!;
  let scope = command.type === 'CREATE_GRANT' ? next.grantScopes.find(scope => scope.roundId === round.id && scope.role === command.role && scope.assignmentId === (command.role === 'ACTOR' ? current.assignment?.id ?? null : null)) : next.grantScopes.find(scope => scope.id === command.scopeId)!;
  if (command.type === 'CREATE_GRANT') {
    if (command.role === 'JUDGE' ? !itemFormat(current) : !current.assignment || !['ACTING_ITEMS', 'DRAWING_TARGET'].includes(current.pin.format)) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
    if (scope?.activeGrantId) return fail(409, 'GRANT_ALREADY_ACTIVE');
    if (!scope) { scope = { id: randomUUID(), roundId: round.id, role: command.role, assignmentId: command.role === 'ACTOR' ? current.assignment!.id : null, generation: 0, activeGrantId: null }; next.grantScopes.push(scope); }
  }
  if (command.type === 'ROTATE_GRANT' && scope!.generation !== command.expectedGeneration) return fail(409, 'STALE_GRANT_GENERATION');
  if (scope!.role === 'ACTOR' && scope!.assignmentId !== current.assignment?.id) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
  const previous = next.grants.find(grant => grant.id === scope!.activeGrantId); if (previous) previous.revoked = true; scope!.activeGrantId = null;
  const receipt = event(next, command.commandId, hash, command.type, round.id, { kind: 'HOST', identityId: game.identityId }, now);
  if (command.type === 'REVOKE_GRANT') {
    // A tombstone issuance row preserves sanitized duplicate metadata only.
    const tombstone: Grant = { id: receipt.id, scopeId: scope!.id, roundId: round.id, role: scope!.role, assignmentId: scope!.assignmentId, generation: ++scope!.generation, tokenHash: tokenHash(randomBytes(32).toString('base64url')), expiresAt: now, revoked: true }; next.grants.push(tombstone); return { next, data: { ...metadata(tombstone), tokenUnavailable: true }, idempotent: false };
  }
  const token = randomBytes(32).toString('base64url'), grant: Grant = { id: receipt.id, scopeId: scope!.id, roundId: round.id, role: scope!.role, assignmentId: scope!.assignmentId, generation: ++scope!.generation, tokenHash: tokenHash(token), expiresAt: now + command.durationSeconds * 1000, revoked: false };
  scope!.activeGrantId = grant.id; next.grants.push(grant); return { next, data: { ...metadata(grant), token, tokenUnavailable: false }, idempotent: false };
}
