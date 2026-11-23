import { randomBytes, randomUUID } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import { fail } from '../gameplay/types';
import type { Principal } from '../identity';
import { selectRoundPins } from './selection';
import type { Exposure, RequestBinding } from './types';
import { initializeCapacity } from './competition-capacity';
import { catalogPoolRoot, PIN_MATERIAL, pinReference, pinReferencesHash, START_MATERIAL, startIntentHash } from './competition-material';
import { allowedAids, standaloneCompetition, validateCompetitionCatalog } from './competition-rules';
import type { CompetitionCatalog, CompetitionGame, CompetitionIntent, CompetitionPrompt, CompetitionRequest } from './competition-types';
export function selectCompetition(request: CompetitionRequest, catalog: CompetitionCatalog, exposures: Exposure[], seed = randomBytes(32).toString('hex')): { pins: CompetitionPrompt[]; intent: CompetitionIntent } {
  validateCompetitionCatalog(catalog);
  if (request.executionFormat === 'TIER_BOARD' && request.setup.categories.some(c => catalog.base.categories.find(p => p.key === c.key)?.format !== 'ORDINARY_TIER')) return fail(409, 'FORMAT_UNAVAILABLE');
  // Pure existing source selector only. No old admission/receipt policy cast or
  // start call. This temporary selection shape is never a wire/financial intent.
  const selectorInput: RequestBinding = { version: 4, executionFormat: request.executionFormat === 'TIER_BOARD' ? 'MIXED_BOARD' : request.executionFormat, operation: request.operation, predecessor: null, requestKey: request.requestKey, logicalMatchId: request.logicalMatchId, setup: { version: 4, categories: request.setup.categories, teams: request.setup.teams.map(t => ({ name: t.name, players: t.players })), rules: { turnSeconds: request.setup.rules.turnSeconds, overallSeconds: request.setup.rules.overallSeconds, questionSeconds: request.setup.rules.questionSeconds } } };
  const selected = selectRoundPins(selectorInput, catalog.base, exposures, seed), pins = selected.pins.map(base => catalog.prompts.find(pin => pin.formatId === base.formatId) ?? fail(503, 'COMPETITIVE_PROOF_UNAVAILABLE'));
  if (request.setup.teams.some(team => team.aids.some(aid => !pins.some(pin => allowedAids(request.executionFormat, pin.format).includes(aid))))) return fail(409, 'AID_UNAVAILABLE');
  const old = selected.intent;
  const selection = pins.map((pin, n) => pinReference(pin, old.selection[n]));
  return { pins, intent: { version: 5, domain: START_MATERIAL, pinMaterial: PIN_MATERIAL, request, baseReleaseId: old.baseReleaseId, baseRoot: old.baseRoot, receiptId: old.receiptId, formatReleaseId: old.formatReleaseId, formatRoot: old.formatRoot, mediaRoot: old.mediaRoot, competitiveReleaseId: catalog.competitiveReleaseId, proofRoot: catalog.proofRoot, paletteRoot: catalog.paletteRoot, policyVersion: 'enta-competitive-1', poolHash: catalogPoolRoot(request, catalog), seed, selection, roundCount: pins.length, pinsHash: pinReferencesHash(selection), tournamentBinding: null } };
}
/** Explicit controlled repository builder and reference algorithm for SQL. Not
 * a production persistence adapter or a permission/evidence issuer. */
export function newCompetitionGame(principal: Principal, identityId: string, request: CompetitionRequest, intent: CompetitionIntent, pins: CompetitionPrompt[], catalog: CompetitionCatalog): CompetitionGame {
  const teams = request.setup.teams.map(team => { const id = randomUUID(); return { id, name: team.name, colorKey: team.colorKey, players: team.players.map((name, index) => ({ id: `${id}-p${String(index + 1).padStart(2, '0')}`, name })), aids: team.aids, score: 0, scoreVersion: 0, scoreHead: null }; });
  const game: CompetitionGame = { id: request.logicalMatchId, identityId, projectId: principal.projectId, hostUid: principal.uid, admissionId: randomUUID(), request, requestHash: admissionHash(request), intent, intentHash: startIntentHash(intent), version: 1, finished: false, activeRoundId: null, turnIndex: 0, resultReason: null, teams, categories: request.setup.categories.map(row => { const c = catalog.base.categories.find(c => c.key === row.key)!; return { key: c.key, label: c.label, format: c.format, cover: c.cover }; }), rounds: pins.map((pin, ordinal) => ({ id: randomUUID(), questionId: randomUUID(), ordinal, pin, phase: 'READY', phaseOrdinal: 0, generation: 0, version: 0, originalTeamId: null, currentTeamId: null, originalDeadline: null, deadline: null, overallDeadline: null, pause: null, publicRevealed: false, itemReveals: [], assignment: null, pickedPlayerId: null, pickedEventId: null, usedAidIds: [], doubleAttemptTeamId: null, bonus: null, revealedHintIds: [], graphemeHints: [], consumed: [], reason: null, turnAdvanced: false, resourceStop: null })), allowances: [], consumptions: [], attempts: [], classifications: [], disclosures: [], effects: [], postings: [], rulings: [], events: [], grants: [], grantScopes: [], canvases: [], reports: [], latestEffectId: null, correctionReview: null, openItemReview: null, itemReviews: [], itemResolutions: [], tournamentBinding: null, results: [], resultSignals: [], capacityReservations: [], capacityDispositions: [] };
  for (const team of game.teams) for (const aid of team.aids) for (const round of standaloneCompetition(request.executionFormat) ? game.rounds : [null]) game.allowances.push({ id: randomUUID(), teamId: team.id, aid, scope: round ? 'PINNED_QUESTION' : 'MATCH', scopeId: round?.id ?? game.id, roundId: round?.id ?? null });
  initializeCapacity(game); return game;
}

