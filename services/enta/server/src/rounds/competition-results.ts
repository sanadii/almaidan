import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { CompetitionGame, EngineBindingSnapshot, EngineResult, EngineResultPayload } from './competition-types';
export const RESULT_DOMAIN = 'maydan.enta.result.v1';
export const engineResultHash = (payload: EngineResultPayload): string => admissionHash({ domain: RESULT_DOMAIN, payload });
export function assertBindingSnapshot(binding: EngineBindingSnapshot, game: Pick<CompetitionGame, 'admissionId' | 'id' | 'teams'>): void {
  const { hash, ...payload } = binding;
  if (![binding.id, binding.attemptId, binding.admissionId, binding.logicalMatchId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)) || binding.engine !== 'ENTA' || binding.admissionId !== game.admissionId || binding.logicalMatchId !== game.id || binding.participants.length !== 2 || game.teams.length !== 2 || new Set(binding.participants).size !== 2 || binding.participants.some((p, i) => p !== game.teams[i].id) || binding.mapping.length !== 2 || binding.mapping.some((m, i) => m.participantId !== binding.participants[i] || !/^[A-Za-z0-9_-]{1,128}$/.test(m.tournamentTeamId)) || new Set(binding.mapping.map(m => m.tournamentTeamId)).size !== 2 || hash !== admissionHash({ domain: 'maydan.enta.binding.v1', payload })) return fail(503, 'RESULT_BINDING_UNAVAILABLE');
}
/** Bound creation has no present issuer/allocator. Pure tuple consistency is
 * not authority; ordinary starts are null and cannot later attach a binding. */
export const requireBoundAllocator = (): never => fail(503, 'TOURNAMENT_ALLOCATOR_UNAVAILABLE');
export function deriveFirstEngineResult(game: CompetitionGame, terminalEventId: string): EngineResult {
  if (!game.finished || game.activeRoundId || game.correctionReview || game.openItemReview || !game.resultReason || game.attempts.some(a => !game.classifications.some(c => c.attemptId === a.id))) return fail(409, 'RESULT_NOT_TERMINAL');
  const terminal = game.events.find(e => e.id === terminalEventId && e.type === 'FINISH') ?? fail(503, 'RESULT_AUTHORITY_UNAVAILABLE');
  if (terminal.authority.kind !== 'HOST' || terminal.authority.identityId !== game.identityId) return fail(503, 'RESULT_AUTHORITY_UNAVAILABLE');
  if (game.tournamentBinding !== null) { assertBindingSnapshot(game.tournamentBinding, game); requireBoundAllocator(); }
  // Actual immutable postings are the score authority; Team.score is only its
  // checked projection. Never derive a competing export from mutable winners.
  const scores = game.teams.map(team => { const score = game.postings.filter(p => p.teamId === team.id).reduce((sum, p) => sum + p.delta, 0); if (!Number.isSafeInteger(score) || score !== team.score) return fail(503, 'RESULT_INTEGRITY_FAILURE'); return { participantId: team.id, score }; });
  const max = Math.max(...scores.map(t => t.score)), leaders = scores.filter(t => t.score === max), unplayed = game.rounds.filter(r => r.phase !== 'RESOLVED').length;
  const outcome = game.resultReason === 'HOST_ENDED' ? 'HOST_ENDED' : leaders.length > 1 ? 'UNRESOLVED_TIE' : 'DECISIVE';
  const payload: EngineResultPayload = { schemaVersion: 1, rulesVersion: 'enta-competitive-1', requestVersion: 5, executionFormat: game.request.executionFormat, projectId: game.projectId, engine: 'ENTA', gameId: game.id, admissionId: game.admissionId, logicalMatchId: game.request.logicalMatchId, resultVersion: 1, predecessor: null, terminal: { eventId: terminal.id, revision: terminal.sequence }, authority: { eventId: terminal.id, kind: 'HOST', correctionReason: null }, participants: game.teams.map(t => t.id), reason: game.resultReason, prescribedCount: game.rounds.length, completedCount: game.rounds.length - unplayed, unplayedCount: unplayed, outcome, scores, winnerParticipantIds: outcome === 'DECISIVE' ? leaders.map(t => t.participantId) : [], tournamentBinding: null };
  return { payload, hash: engineResultHash(payload) };
}
export function appendEngineResult(game: CompetitionGame, result: EngineResult, expectedHead: { version: number; hash: string } | null): EngineResult {
  const existing = game.results.find(r => r.payload.resultVersion === result.payload.resultVersion);
  if (result.hash !== engineResultHash(result.payload) || result.payload.gameId !== game.id || result.payload.admissionId !== game.admissionId || result.payload.projectId !== game.projectId) return fail(503, 'RESULT_INTEGRITY_FAILURE');
  if (existing) { if (existing.hash !== result.hash || admissionHash(existing.payload) !== admissionHash(result.payload)) return fail(503, 'RESULT_INTEGRITY_FAILURE'); return existing; }
  const head = game.results.at(-1), actual = head ? { version: head.payload.resultVersion, hash: head.hash } : null;
  if (admissionHash(actual) !== admissionHash(expectedHead) || admissionHash(result.payload.predecessor) !== admissionHash(actual) || result.payload.resultVersion !== (head?.payload.resultVersion ?? 0) + 1) return fail(409, 'STALE_RESULT_HEAD');
  // Only the original terminal version is currently supported. Post-final
  // correction/tie successor authority remains report-only/default denial.
  if (result.payload.resultVersion !== 1 || result.payload.tournamentBinding !== null || game.tournamentBinding !== null) return fail(403, 'RESULT_SUCCESSOR_AUTHORITY_UNAVAILABLE');
  game.results.push(result); return result;
}
export function currentEngineResult(game: CompetitionGame): EngineResult | null {
  const result = game.results.at(-1) ?? null;
  if (!game.finished) { if (result) return fail(503, 'RESULT_INTEGRITY_FAILURE'); return null; }
  if (game.factContext) { if (!game.factContext.terminalValidated || !result || result.hash !== engineResultHash(result.payload) || result.payload.gameId !== game.id || result.payload.admissionId !== game.admissionId || result.payload.projectId !== game.projectId || result.payload.resultVersion !== 1 || result.payload.tournamentBinding !== null || result.payload.terminal.revision > game.version) return fail(503, 'RESULT_INTEGRITY_FAILURE'); return result; }
  if (!result || result.payload.resultVersion !== 1 || result.hash !== engineResultHash(result.payload) || result.hash !== deriveFirstEngineResult(game, result.payload.terminal.eventId).hash) return fail(503, 'RESULT_INTEGRITY_FAILURE');
  return result;
}
