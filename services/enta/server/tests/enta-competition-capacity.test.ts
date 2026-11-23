import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { parseCompetitionCommand } from '../src/rounds/competition-rules';
import { reduceCompetitionCommand } from '../src/rounds/competition-engine';
import { fixtureCompetitionGame } from './enta-competition-fixture';
import type { CompetitionGame } from '../src/rounds/competition-types';
import { initializeCapacity } from '../src/rounds/competition-capacity';
import { deriveRoundCapacity } from '../src/rounds/competition-capacity';
import { settleCompetitiveClock } from '../src/rounds/competition-clock';
import { sealEffect } from '../src/rounds/competition-effects';

const now = Date.parse('2026-10-08T20:00:00Z');
function run(game: CompetitionGame, input: Record<string, unknown>) { return reduceCompetitionCommand(game, parseCompetitionCommand({ commandId: randomUUID(), expectedVersion: game.version, ...input }), now).next; }
test('generation boundary persists a resource overlay before fresh work and preserves accepted evidence for winning drain', () => {
  let game = fixtureCompetitionGame('STANDALONE_LIST'); game.request.setup.rules.overallSeconds = null;
  const rid = game.rounds[0].id, team = game.teams[0]; game = run(game, { type: 'OPEN_ROUND', roundId: rid });
  game = run(game, { type: 'RECORD_ATTEMPT', roundId: rid, itemId: game.rounds[0].pin.items[0].id, teamId: team.id, playerId: team.players[0].id });
  const accepted = structuredClone(game.attempts[0]), round = game.rounds[0]; round.generation = 2_000_000_000;
  const deadline = round.deadline, phase = round.phase, originalDeadline = round.originalDeadline;
  assert.equal(settleCompetitiveClock(game, now), true); assert.equal(round.resourceStop?.reason, 'GENERATION_BOUND');
  assert.deepEqual(game.attempts[0], accepted); assert.equal(round.deadline, deadline); assert.equal(round.originalDeadline, originalDeadline); assert.equal(round.phase, phase);
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: rid, itemId: null });
  game = run(game, { type: 'FINAL_RULING', roundId: rid, itemId: null, classifications: [[accepted.id, true]] });
  assert.equal(game.classifications[0].correct, true); assert.equal(game.rounds[0].generation, 2_000_000_000); assert.equal(game.rounds[0].reason, 'ADJUDICATED');
});
function maximalPending() {
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']);
  const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!;
  game.rounds = [round];
  for (let n = 2; n < 4; n++) { const id = randomUUID(); game.teams.push({ ...structuredClone(game.teams[0]), id, name: `فريق ${n}`, players: [{ id: `${id}-p01`, name: `لاعب ${n}` }] }); }
  round.pin.items = Array.from({ length: 128 }, (_, ordinal) => ({ ...round.pin.items[0], id: randomUUID(), revisionId: randomUUID(), ordinal, trap: false }));
  game.capacityReservations = []; game.capacityDispositions = []; initializeCapacity(game);
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id });
  for (const item of round.pin.items) for (const team of game.teams) game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: item.id, teamId: team.id, playerId: team.players[0].id });
  return run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null });
}
test('new5 strict ordered 512 UUIDv4 boolean tuples fit maximal request material; object/coercion/duplicate/513 reject', () => {
  const tuples = Array.from({ length: 512 }, () => [randomUUID(), false] as [string, boolean]);
  const input = { commandId: 'k'.repeat(128), expectedVersion: 2_000_000_000, type: 'FINAL_RULING', roundId: 'r'.repeat(128), itemId: 'i'.repeat(128), classifications: tuples };
  assert.equal(Buffer.byteLength(JSON.stringify(tuples)), 24065);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 25089);
  const command = parseCompetitionCommand(input); assert.deepEqual(command, input);
  assert.notEqual(admissionHash(command), admissionHash({ ...command, classifications: [...tuples].reverse() }));
  for (const classifications of [[{ attemptId: tuples[0][0], correct: false }], [[tuples[0][0], 0]], [[tuples[0][0], false, null]], [[tuples[0][0].toUpperCase(), false]], [['x'.repeat(36), false]], [tuples[0], tuples[0]], [...tuples, [randomUUID(), false]]]) assert.throws(() => parseCompetitionCommand({ ...input, classifications }));
  assert.throws(() => parseCompetitionCommand({ ...input, classifications: [], extra: null }));
  assert.equal((parseCompetitionCommand({ commandId: randomUUID(), expectedVersion: 1, type: 'CORRECT_RULING', effectId: randomUUID(), rulingVersion: 1, correctAttemptIds: tuples.map(t => t[0]), reason: 'تصحيح الحكم' }) as { correctAttemptIds: string[] }).correctAttemptIds.length, 512);
});
test('512 pending shared attempts classify atomically into 128 effects/heads/consumptions, exact retry adds no facts', () => {
  const game = maximalPending(), round = game.rounds[0]; assert.equal(game.attempts.length, 512);
  const command = parseCompetitionCommand({ commandId: randomUUID(), expectedVersion: game.version, type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: game.attempts.map(a => [a.id, false]) });
  const next = reduceCompetitionCommand(game, command, now).next;
  assert.equal(next.classifications.length, 512); assert.equal(next.rulings.length, 128); assert.equal(next.rounds[0].consumed.length, 128); assert.equal(next.postings.length, 0); assert.equal(next.activeRoundId, null);
  const retry = reduceCompetitionCommand(next, command, now + 1000); assert.equal(retry.idempotent, true); assert.deepEqual(retry.next, next);
  assert.throws(() => reduceCompetitionCommand(game, { ...command, classifications: command.type === 'FINAL_RULING' ? command.classifications.slice(0, 511) : [] } as typeof command, now));
  assert.equal(game.classifications.length, 0);
});
test('whole-item empty final preserves all interim-original bonus evidence without second classification/consumption', () => {
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!, team = game.teams[0];
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: round.pin.items[0].id, teamId: team.id, playerId: team.players[0].id });
  const attempt = game.attempts[0]; game = run(game, { type: 'INTERIM_WRONG', roundId: round.id, attemptId: attempt.id }); game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] });
  const effect = game.effects.at(-1)!; assert.equal(effect.kind, 'NO_SCORE'); assert.deepEqual(effect.originalAttemptIds, [attempt.id]); assert.deepEqual(effect.bonusSnapshot, [{ attemptId: attempt.id, teamId: attempt.teamId, multiplier: attempt.bonusMultiplier, sourceEventId: attempt.bonusEventId }]); assert.equal(game.classifications.length, 1); assert.equal(game.rounds.find(r => r.id === round.id)!.consumed.length, 0); assert.equal(game.postings.length, 0);
});
test('empty whole closure retains earlier true consumed-item originals without reclassification or another consumption', () => {
  let game = fixtureCompetitionGame(); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!, team = game.teams[0], itemId = round.pin.items[0].id;
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId, teamId: team.id, playerId: team.players[0].id }); const attempt = game.attempts[0];
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId, classifications: [[attempt.id, true]] }); const originalClassification = structuredClone(game.classifications), originalConsumption = structuredClone(game.rounds.find(r => r.id === round.id)!.consumed), score = game.teams[0].score;
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] });
  const closure = game.effects.at(-1)!; assert.equal(closure.kind, 'NO_SCORE'); assert.equal(closure.reversible, false); assert.deepEqual(closure.originalAttemptIds, [attempt.id]); assert.deepEqual(closure.correctAttemptIds, []); assert.deepEqual(closure.bonusSnapshot, [{ attemptId: attempt.id, teamId: attempt.teamId, multiplier: attempt.bonusMultiplier, sourceEventId: attempt.bonusEventId }]);
  assert.deepEqual(game.classifications, originalClassification); assert.deepEqual(game.rounds.find(r => r.id === round.id)!.consumed, originalConsumption); assert.equal(game.teams[0].score, score); assert.equal(game.rounds.find(r => r.id === round.id)!.phase, 'RESOLVED');
});
test('optional exhaustion refuses new optional work and preserves reserved pending final judgment', () => {
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!, team = game.teams[0]; game = run(game, { type: 'OPEN_ROUND', roundId: round.id });
  for (let n = 0; n < 256; n++) game = run(game, { type: 'SELECT_SCORING_TEAM', roundId: round.id, teamId: team.id });
  assert.equal(deriveRoundCapacity(game, game.rounds.find(r => r.id === round.id)!).used.OPTIONAL.events, 256);
  assert.throws(() => run(game, { type: 'SELECT_SCORING_TEAM', roundId: round.id, teamId: team.id }), /OPTIONAL_CAPACITY_EXHAUSTED/);
  game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: round.pin.items[0].id, teamId: team.id, playerId: team.players[0].id }); const attempt = game.attempts.at(-1)!;
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [[attempt.id, true]] }); assert.equal(game.classifications.length, 1); assert.equal(game.activeRoundId, null);
});
test('no overall cap resource stop retains pending/deadline/knowledge and drains without manufactured expiry or winner', () => {
  let game = fixtureCompetitionGame('STANDALONE_LIST'); game.request.setup.rules.overallSeconds = null; const round = game.rounds[0], team = game.teams[0]; game = run(game, { type: 'OPEN_ROUND', roundId: round.id });
  game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: round.pin.items[0].id, teamId: team.id, playerId: team.players[0].id }); const attempt = game.attempts.at(-1)!;
  for (let n = 1; n <= 256; n++) assert.equal(settleCompetitiveClock(game, now + n * 30000), true);
  const current = game.rounds[0], deadline = current.deadline; assert.equal(settleCompetitiveClock(game, now + 257 * 30000), true); assert.equal(current.resourceStop?.reason, 'SYSTEM_CAPACITY'); assert.equal(current.deadline, deadline); assert.equal(current.reason, null); assert.equal(game.classifications.length, 0); assert.equal(game.finished, false); assert.equal(game.results.length, 0); assert.equal(game.events.filter(e => e.type === 'RESOURCE_LIMIT_REACHED').length, 1); assert.equal(settleCompetitiveClock(game, now + 999999999), false);
  assert.throws(() => run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: round.pin.items[1].id, teamId: team.id, playerId: team.players[0].id }), /RESOURCE_LIMIT_REACHED/);
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [[attempt.id, false]] }); assert.equal(game.classifications.length, 1); assert.equal(game.rounds[0].reason, 'ADJUDICATED'); assert.equal(game.events.some(e => e.type === 'RECORDING_CLOSED'), false);
});
test('item-family round-level empty NO_SCORE denies fresh undo including older reversible flag without partial reversal/overlay/claim changes', () => {
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!;
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] });
  const original = game.effects.at(-1)!; assert.equal(original.reversible, false);
  for (const olderDraftFlag of [false, true]) { original.reversible = olderDraftFlag; sealEffect(original); game.rulings[0].hash = original.hash; const before = structuredClone(game); assert.throws(() => run(game, { type: 'UNDO_EFFECT', effectId: original.id, effectHash: original.hash }), /UNDO_UNAVAILABLE/); assert.deepEqual(game, before); assert.equal(game.openItemReview, null); assert.equal(game.correctionReview, null); assert.equal(game.effects.some(e => e.kind === 'REVERSAL'), false); }
});
test('item-specific consumed zero NO_SCORE keeps review/restore support and original false classification/consumption', () => {
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!, team = game.teams[0], item = round.pin.items[0];
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'RECORD_ATTEMPT', roundId: round.id, itemId: item.id, teamId: team.id, playerId: team.players[0].id }); const attempt = game.attempts[0]; game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: item.id }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: item.id, classifications: [[attempt.id, false]] });
  const original = game.effects.at(-1)!; assert.equal(original.reversible, true); game = run(game, { type: 'UNDO_EFFECT', effectId: original.id, effectHash: original.hash }); const review = game.itemReviews[0]; assert.equal(game.openItemReview, review.id); assert.equal(game.postings.length, 0); assert.equal(deriveRoundCapacity(game, game.rounds.find(r => r.id === round.id)!).reserved.OPTIONAL.effects, 1);
  game = run(game, { type: 'RESOLVE_ITEM_REVIEW', reviewId: review.id, reviewHash: review.hash, rulingVersion: game.rulings[0].version, mode: 'RESTORE_ORIGINAL', correctAttemptIds: [], reason: 'استعادة الحكم الأصلي' }); assert.equal(game.openItemReview, null); assert.equal(game.classifications.length, 1); assert.equal(game.classifications[0].correct, false); assert.equal(game.rounds.find(r => r.id === round.id)!.consumed.length, 1); assert.equal(game.postings.length, 0);
});
test('ordinary/drawing zero NO_SCORE still admit immediate undo, and exact saved retries precede new item-entry denial', () => {
  for (const family of ['ORDINARY_TIER', 'DRAWING_TARGET']) { let game = fixtureCompetitionGame(); const round = game.rounds.find(r => r.pin.format === family)!; game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] }); const original = game.effects.at(-1)!; assert.equal(original.reversible, true); game = run(game, { type: 'UNDO_EFFECT', effectId: original.id, effectHash: original.hash }); assert.equal(game.correctionReview, round.id); assert.equal(game.postings.length, 0); }
  let game = fixtureCompetitionGame('MIXED_BOARD', ['MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS']); const round = game.rounds.find(r => r.pin.format === 'LIST_ITEMS')!; game = run(game, { type: 'OPEN_ROUND', roundId: round.id }); game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] }); const original = game.effects.at(-1)!, command = parseCompetitionCommand({ commandId: randomUUID(), expectedVersion: game.version, type: 'UNDO_EFFECT', effectId: original.id, effectHash: original.hash });
  game.events.push({ id: randomUUID(), commandId: command.commandId, hash: admissionHash(command), sequence: ++game.version, type: 'UNDO_EFFECT', roundId: round.id, authority: { kind: 'HOST', identityId: game.identityId }, at: now, pauseReason: null }); const before = structuredClone(game), result = reduceCompetitionCommand(game, command, now); assert.equal(result.idempotent, true); assert.deepEqual(result.next, before);
});

test('board review reserves exact reversal exit at optional capacity and consumes it on correction', () => {
  let game = fixtureCompetitionGame(); const round = game.rounds.find(r => r.pin.format === 'DRAWING_TARGET')!, team = game.teams[0];
  game = run(game, { type: 'OPEN_ROUND', roundId: round.id });
  for (let n = 0; n < 254; n++) game = run(game, { type: 'ASSIGN_ACTOR', roundId: round.id, itemId: null, teamId: team.id, playerId: team.players[0].id });
  game = run(game, { type: 'PUBLIC_REVEAL', roundId: round.id, itemId: null }); game = run(game, { type: 'FINAL_RULING', roundId: round.id, itemId: null, classifications: [] });
  const original = game.effects.at(-1)!; game = run(game, { type: 'UNDO_EFFECT', effectId: original.id, effectHash: original.hash });
  const claim = game.capacityReservations.find(c => c.sourceKind === 'BOARD_REVIEW')!; assert.equal(claim.sourceId, game.effects.at(-1)!.id);
  const reserved = deriveRoundCapacity(game, game.rounds.find(r => r.id === round.id)!); assert.equal(reserved.used.OPTIONAL.events, 255); assert.equal(reserved.reserved.OPTIONAL.events, 1);
  game = run(game, { type: 'CORRECT_RULING', effectId: original.id, rulingVersion: game.rulings[0].version, correctAttemptIds: [], reason: 'تصحيح الحكم' });
  const closed = deriveRoundCapacity(game, game.rounds.find(r => r.id === round.id)!); assert.equal(closed.used.OPTIONAL.events, 256); assert.equal(closed.reserved.OPTIONAL.events, 0); assert.equal(game.correctionReview, null); assert.equal(game.capacityDispositions.find(d => d.reservationId === claim.id)?.kind, 'CONSUME');
});
