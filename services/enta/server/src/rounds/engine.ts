import { randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { Authority, HostCommand, RoundEvent, RoundGame, RoundRecord } from './types';
export const standalone = (game: RoundGame): boolean => game.request.executionFormat !== 'MIXED_BOARD';
export const itemFormat = (round: RoundRecord): boolean => ['LIST_ITEMS', 'ACTING_ITEMS'].includes(round.pin.format);
export function event(game: RoundGame, commandId: string, hash: string, type: string, roundId: string | null, authority: Authority, now: number, pauseReason: string | null = null): RoundEvent {
  const row = { id: randomUUID(), commandId, hash, sequence: ++game.version, type, roundId, authority, at: now, pauseReason };
  game.events.push(row); return row;
}
export function invalidateGrants(game: RoundGame, roundId: string): void {
  for (const scope of game.grantScopes.filter(scope => scope.roundId === roundId)) { if (scope.activeGrantId) { const grant = game.grants.find(grant => grant.id === scope.activeGrantId); if (grant) grant.revoked = true; scope.activeGrantId = null; } }
}
export function closeRound(game: RoundGame, round: RoundRecord, reason: RoundRecord['reason']): void {
  round.state = 'RESOLVED'; round.reason = reason; round.version++; round.turnDeadline = null; round.overallDeadline = null; round.remainingTurn = null; round.remainingOverall = null;
  game.activeRoundId = null; game.turnIndex++; invalidateGrants(game, round.id);
}
export function authorizeChildren(game: RoundGame, command: HostCommand): void {
  const round = 'roundId' in command ? game.rounds.find(row => row.id === command.roundId) : null;
  if ('roundId' in command && !round) return fail(404, 'MATCH_NOT_FOUND');
  if ('teamId' in command && command.teamId !== null && !game.teams.some(team => team.id === command.teamId)) return fail(404, 'MATCH_NOT_FOUND');
  if ('itemId' in command && command.itemId !== null && !round?.pin.items.some(item => item.id === command.itemId)) return fail(404, 'MATCH_NOT_FOUND');
  if (command.type === 'ASSIGN_ACTOR') { const team = game.teams.find(team => team.id === command.teamId)!; if (!team.players[command.playerIndex]) return fail(404, 'MATCH_NOT_FOUND'); }
}
function activate(game: RoundGame, round: RoundRecord, now: number): void {
  if (game.activeRoundId || round.state !== 'READY') return fail(409, 'ROUND_UNAVAILABLE');
  game.activeRoundId = round.id; round.state = 'RUNNING'; round.version++; round.scoringTeamId = game.teams[game.turnIndex % game.teams.length].id;
  round.turnDeadline = now + (itemFormat(round) ? standalone(game) ? game.request.setup.rules.turnSeconds : 40 : game.request.setup.rules.questionSeconds) * 1000;
  round.overallDeadline = itemFormat(round) && standalone(game) && game.request.setup.rules.overallSeconds !== null ? now + game.request.setup.rules.overallSeconds * 1000 : null;
}
/** Called only after current owner/live capability and parent locks are proven.
 * Returning true means caller commits this SYSTEM change, then rejects the
 * requested action outside the transaction. Unauthorized callers never reach it. */
export function settleClock(game: RoundGame, now: number): boolean {
  const round = game.rounds.find(round => round.id === game.activeRoundId);
  if (!round || round.state !== 'RUNNING' || !itemFormat(round)) return false;
  if (round.overallDeadline !== null && now >= round.overallDeadline || !standalone(game) && round.turnDeadline !== null && now >= round.turnDeadline) {
    closeRound(game, round, 'TIME_EXPIRED'); event(game, `clock-${round.id}-${round.version}`, admissionHash({ roundId: round.id, version: round.version, deadline: now }), 'TIME_EXPIRED', round.id, { kind: 'SYSTEM', operation: 'CLOCK_SETTLEMENT' }, now); return true;
  }
  if (round.turnDeadline !== null && now >= round.turnDeadline) {
    const duration = game.request.setup.rules.turnSeconds * 1000, elapsed = Math.floor((now - round.turnDeadline) / duration) + 1;
    const index = game.teams.findIndex(team => team.id === round.scoringTeamId);
    round.scoringTeamId = game.teams[(index + elapsed) % game.teams.length].id; round.turnDeadline += elapsed * duration; round.version++;
    invalidateGrants(game, round.id); round.assignment = null;
    event(game, `clock-${round.id}-${round.version}`, admissionHash({ roundId: round.id, version: round.version, elapsed }), 'TURN_EXPIRED', round.id, { kind: 'SYSTEM', operation: 'CLOCK_SETTLEMENT' }, now); return true;
  }
  return false;
}
function posting(game: RoundGame, round: RoundRecord, teamId: string, delta: number, itemId: string | null, eventId: string): void {
  const team = game.teams.find(team => team.id === teamId) ?? fail(404, 'MATCH_NOT_FOUND');
  const after = standalone(game) ? team.score + delta : Math.max(0, team.score + delta);
  if (!Number.isSafeInteger(after) || after < -2_147_483_648 || after > 2_147_483_647) return fail(409, 'SCORE_BOUND_EXCEEDED');
  game.postings.push({ id: randomUUID(), eventId, roundId: round.id, itemId, teamId, delta: after - team.score, before: team.score, after, rulesVersion: 'enta-format-1' }); team.score = after;
}
export function reduceHost(game: RoundGame, command: HostCommand, now: number): RoundGame {
  authorizeChildren(game, command);
  if (command.expectedVersion !== game.version) return fail(409, 'STALE_VERSION');
  if (game.finished) return fail(409, 'MATCH_FINISHED');
  const next = structuredClone(game), round = 'roundId' in command ? next.rounds.find(row => row.id === command.roundId)! : null;
  if (command.type === 'OPEN_ROUND') activate(next, round!, now);
  else if (command.type === 'NEXT_ROUND') { if (!standalone(next)) return fail(409, 'INVALID_PHASE'); const candidate = next.rounds.find(row => row.state === 'READY'); if (!candidate) return fail(409, 'NO_MORE_ROUNDS'); activate(next, candidate, now); }
  else if (command.type === 'FINISH') {
    if (next.activeRoundId) return fail(409, 'UNRESOLVED_ROUND');
    const unplayed = next.rounds.filter(row => row.state !== 'RESOLVED').length;
    if (unplayed && !command.confirmEarly) return fail(409, 'EARLY_FINISH_CONFIRMATION_REQUIRED');
    next.finished = true; next.resultReason = unplayed ? 'HOST_ENDED' : 'ALL_ROUNDS'; next.grants.forEach(grant => { grant.revoked = true; }); next.grantScopes.forEach(scope => { scope.activeGrantId = null; });
  } else {
    if (next.activeRoundId !== round!.id || round!.state === 'RESOLVED' || round!.state === 'READY') return fail(409, 'INVALID_PHASE');
    if (command.type === 'RESUME_ROUND') {
      if (round!.state !== 'PAUSED') return fail(409, 'INVALID_PHASE');
      round!.state = 'RUNNING'; round!.turnDeadline = round!.remainingTurn === null ? null : now + round!.remainingTurn; round!.overallDeadline = round!.remainingOverall === null ? null : now + round!.remainingOverall; round!.remainingTurn = null; round!.remainingOverall = null;
    } else {
      if (round!.state !== 'RUNNING') return fail(409, 'ROUND_PAUSED');
      if (command.type === 'PAUSE_ROUND') { round!.state = 'PAUSED'; round!.remainingTurn = round!.turnDeadline === null ? null : Math.max(0, round!.turnDeadline - now); round!.remainingOverall = round!.overallDeadline === null ? null : Math.max(0, round!.overallDeadline - now); round!.turnDeadline = null; round!.overallDeadline = null; }
      else if (command.type === 'CLOSE_ROUND') { if (!itemFormat(round!)) return fail(409, 'INVALID_PHASE'); closeRound(next, round!, 'HOST_CLOSED'); }
      else if (command.type === 'SELECT_SCORING_TEAM') { if (standalone(next) || !itemFormat(round!)) return fail(409, 'INVALID_PHASE'); round!.scoringTeamId = command.teamId; }
      else if (command.type === 'ASSIGN_ACTOR') {
        if (!['ACTING_ITEMS', 'DRAWING_TARGET'].includes(round!.pin.format) || (round!.pin.format === 'DRAWING_TARGET' ? command.itemId !== null : command.itemId === null || round!.consumed.some(row => row.itemId === command.itemId))) return fail(409, 'ASSIGNMENT_UNAVAILABLE');
        invalidateGrants(next, round!.id); round!.assignment = { id: randomUUID(), teamId: command.teamId, playerIndex: command.playerIndex, itemId: command.itemId, generation: round!.version + 1 };
      } else if (command.type === 'REVEAL_TARGET') { if (itemFormat(round!) || round!.revealed) return fail(409, 'INVALID_PHASE'); round!.revealed = true; invalidateGrants(next, round!.id); }
      else if (command.type === 'ADJUDICATE_ROUND') {
        if (itemFormat(round!) || !round!.revealed) return fail(409, 'INVALID_PHASE');
      } else if (command.type === 'JUDGE_ITEM') {
        if (!itemFormat(round!) || round!.consumed.some(row => row.itemId === command.itemId)) return fail(409, 'ITEM_RESOLVED');
      }
    }
    round!.version++;
  }
  const receipt = event(next, command.commandId, admissionHash(command), command.type, round?.id ?? null, { kind: 'HOST', identityId: next.identityId }, now, command.type === 'PAUSE_ROUND' ? command.reason : null);
  if (command.type === 'JUDGE_ITEM') {
    const item = round!.pin.items.find(item => item.id === command.itemId)!;
    posting(next, round!, round!.scoringTeamId!, item.trap ? -item.value : item.value, item.id, receipt.id);
    round!.consumed.push({ itemId: item.id, teamId: round!.scoringTeamId!, eventId: receipt.id });
    if (standalone(next)) { if (item.trap) round!.scoringTeamId = next.teams[(next.teams.findIndex(team => team.id === round!.scoringTeamId) + 1) % next.teams.length].id; round!.turnDeadline = now + next.request.setup.rules.turnSeconds * 1000; }
    if (round!.assignment?.itemId === item.id) { invalidateGrants(next, round!.id); round!.assignment = null; }
    if (round!.consumed.length === round!.pin.items.length) closeRound(next, round!, 'ALL_ITEMS');
  } else if (command.type === 'ADJUDICATE_ROUND') { if (command.correct) posting(next, round!, command.teamId!, round!.pin.points!, null, receipt.id); closeRound(next, round!, 'ADJUDICATED'); }
  return next;
}
