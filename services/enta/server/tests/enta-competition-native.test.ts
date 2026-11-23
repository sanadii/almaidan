import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectCompetition } from '../src/rounds/competition-projection';
import { readCompetitionNativeMatch } from '../src/rounds/competition-native';
import { fixtureCompetitionGame, fixtureCompetitionCatalog } from './enta-competition-fixture';
import { reduceCompetitionCommand } from '../src/rounds/competition-engine';
import { randomUUID } from 'node:crypto';
import { validateNew5Descriptor } from '../src/rounds/competition-content';
import { engineResultHash } from '../src/rounds/competition-results';
import { validateFormatCatalog } from '../src/rounds/selection';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';

test('new5 descriptor helper item revision alphabet matches SQL identifier predicate', () => {
  const pin = fixtureCompetitionGame().rounds.find(r => r.pin.items.length)!.pin;
  for (const revisionId of ['cuid1234567890abcdefghijkl', randomUUID(), 'x'.repeat(128), 'A_Z-09']) {
    const value = structuredClone(pin); value.items[0].revisionId = revisionId; assert.doesNotThrow(() => validateNew5Descriptor(value));
  }
  for (const revisionId of ['x'.repeat(129), '界', '\u0001'.repeat(128), 'escaped\\revision', '']) {
    const value = structuredClone(pin); value.items[0].revisionId = revisionId; assert.throws(() => validateNew5Descriptor(value));
  }
  for (const sourceNamespace of ['界'.repeat(128), '\u0001'.repeat(128)]) {
    const value = structuredClone(pin); value.sourceNamespace = sourceNamespace; assert.doesNotThrow(() => validateNew5Descriptor(value));
  }
});
test('published source provenance retains the full original format predicate intersection', () => {
  const base = fixtureCompetitionCatalog().base; assert.doesNotThrow(() => validateFormatCatalog(base));
  for (const [field, value] of [['sourceNamespace', '\u0001'], ['sourceNamespace', '界'], ['sourceNamespace', 'x'.repeat(129)], ['sourceId', '\u0001'], ['sourceId', '界'], ['sourceId', 'x'.repeat(201)]] as const) {
    const copy = structuredClone(base), pin = copy.categories[0].prompts[0]; pin[field] = value;
    const { formatHash: _prior, ...original } = pin; pin.formatHash = admissionHash({ version: 1, pin: original });
    assert.throws(() => validateFormatCatalog(copy), /FORMAT_CATALOG_UNAVAILABLE/);
  }
});

test('native compact DTO accepts oracle wire without reconstructing authority', () => {
  for (const format of ['MIXED_BOARD', 'TIER_BOARD', 'STANDALONE_LIST', 'STANDALONE_ACTING'] as const) {
    const game = fixtureCompetitionGame(format), dto = projectCompetition(game, 1000);
    assert.equal(readCompetitionNativeMatch(dto, game.id), dto);
    assert.throws(() => readCompetitionNativeMatch(game, game.id));
    assert.throws(() => readCompetitionNativeMatch(dto, 'foreign'));
    assert.throws(() => readCompetitionNativeMatch({ ...dto, request: game.request }, game.id));
  }
});
test('native terminal wire closes result payload and nested primitive values', () => {
  const game = fixtureCompetitionGame(), terminal = reduceCompetitionCommand(game, { type: 'FINISH', commandId: randomUUID(), expectedVersion: game.version, confirmEarly: true }, 1000).next, dto = projectCompetition(terminal, 1000);
  assert.ok(dto.result);
  assert.equal(readCompetitionNativeMatch(dto, game.id), dto);
  const malformed = [
    { ...dto, result: { ...dto.result, payload: { ...dto.result.payload, privateProof: 'hidden' } } },
    { ...dto, result: { ...dto.result, hash: 'b'.repeat(64) } },
    { ...dto, teams: dto.teams.map(t => ({ ...t, score: '0' })) },
    { ...dto, teams: dto.teams.map(t => ({ ...t, aids: ['UNKNOWN'] })) },
    { ...dto, teams: dto.teams.map(t => ({ ...t, color: '#000000' })) },
  ];
  for (const value of malformed) assert.throws(() => readCompetitionNativeMatch(value, game.id));
  assert.throws(() => readCompetitionNativeMatch({ ...dto, finished: false }, game.id));
  assert.throws(() => readCompetitionNativeMatch({ ...dto, version: dto.version + 1 }, game.id));
  assert.throws(() => readCompetitionNativeMatch({ ...dto, result: null }, game.id));
  const systemPayload = { ...dto.result.payload, authority: { ...dto.result.payload.authority, kind: 'SYSTEM' as const } };
  assert.throws(() => readCompetitionNativeMatch({ ...dto, result: { payload: systemPayload, hash: engineResultHash(systemPayload) } }, game.id));
});
test('native main DTO refuses private nested material and bulk page fallback', () => {
  const game = fixtureCompetitionGame(), dto = projectCompetition(game, 1000);
  assert.throws(() => readCompetitionNativeMatch({ ...dto, attempts: [game.attempts[0] ?? {}] }, game.id));
  assert.throws(() => readCompetitionNativeMatch({ ...dto, teams: [{ ...dto.teams[0], tokenHash: 'a'.repeat(64) }, ...dto.teams.slice(1)] }, game.id));
  assert.throws(() => readCompetitionNativeMatch({ ...dto, categories: dto.categories.map(c => ({ ...c, cover: { objectKey: 'enta-private/secret' } })) }, game.id));
});
test('native active and paused DTO closes clock fields and resource stop shape', () => {
  let game = fixtureCompetitionGame(); const roundId = game.rounds.find(r => r.pin.format === 'ORDINARY_TIER')!.id;
  game = reduceCompetitionCommand(game, { type: 'OPEN_ROUND', roundId, commandId: randomUUID(), expectedVersion: game.version }, 1000).next;
  let dto = projectCompetition(game, 1000); assert.ok(dto.currentRound); assert.equal(readCompetitionNativeMatch(dto, game.id), dto);
  for (const currentRound of [
    { ...dto.currentRound, phase: 'FOREIGN' }, { ...dto.currentRound, deadline: '31000' },
    { ...dto.currentRound, generation: 0.5 }, { ...dto.currentRound, target: 'private' }, { ...dto.currentRound, points: 300 },
    { ...dto.currentRound, resourceStop: { eventId: randomUUID(), at: 1000, reason: 'FOREIGN' } },
    { ...dto.currentRound, resourceStop: { eventId: randomUUID(), at: '1000', reason: 'SYSTEM_CAPACITY' } },
  ]) assert.throws(() => readCompetitionNativeMatch({ ...dto, currentRound }, game.id));
  game = reduceCompetitionCommand(game, { type: 'PAUSE_ROUND', roundId, reason: 'pause', commandId: randomUUID(), expectedVersion: game.version }, 1000).next;
  dto = projectCompetition(game, 1000); assert.ok(dto.currentRound?.pause); assert.equal(readCompetitionNativeMatch(dto, game.id), dto);
  for (const pause of [{ ...dto.currentRound.pause, cause: 'FOREIGN' }, { ...dto.currentRound.pause, phaseRemaining: '30000' }, { ...dto.currentRound.pause, token: 'private' }]) assert.throws(() => readCompetitionNativeMatch({ ...dto, currentRound: { ...dto.currentRound, pause } }, game.id));
});
