import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { descriptorWithoutChunks, encodedBytes, validateNew5Descriptor } from '../src/rounds/competition-content';
import { fixtureCompetitionGame, fixtureCompetitionStart } from './enta-competition-fixture';
import { parseCompetitionStart } from '../src/rounds/competition-rules';
import { pinReferencesHash, START_MATERIAL, PIN_MATERIAL } from '../src/rounds/competition-material';
import { competitionPageRows } from '../src/rounds/competition-pages';
import { text } from '../src/rounds/validation';
import { projectCompetition } from '../src/rounds/competition-projection';

test('content UTF16 predicate and provenance byte predicate retain distinct permitted alphabets', () => {
  assert.equal(text('界'.repeat(512), 1, 512).length, 512);
  assert.equal(text('😀'.repeat(256), 1, 512).length, 512);
  assert.throws(() => text('😀'.repeat(257), 1, 512));
  for (const code of [1, 8, 31, 127, 128, 159]) assert.throws(() => text(String.fromCharCode(code), 1, 512));
  const pin = fixtureCompetitionGame().rounds[0].pin;
  pin.sourceNamespace = '\u0001'.repeat(1024); pin.sourceId = '\u0008'.repeat(1024);
  validateNew5Descriptor(pin); assert.equal(encodedBytes(pin.sourceNamespace), 6146); assert.equal(encodedBytes(pin.sourceId), 2050);
  pin.sourceId += '\u0008'; assert.throws(() => validateNew5Descriptor(pin));
});

test('descriptor/page limits and synthetic windows preserve the withdrawn whole-context budget counterexample', t => {
  const game = fixtureCompetitionGame(), pin = structuredClone(game.rounds[0].pin), hash = 'a'.repeat(64), longId = (n: number) => `id_${n}_`.padEnd(128, 'x');
  pin.ref = longId(1000); pin.formatId = longId(1001); pin.revisionId = longId(1002); pin.categoryKey = longId(1003); pin.sourceNamespace = '\u0001'.repeat(1024); pin.sourceId = '\u0002'.repeat(1024);
  pin.prompt = '界'.repeat(2000); pin.items = Array.from({ length: 128 }, (_, ordinal) => ({ id: longId(ordinal), revisionId: longId(ordinal + 128), hash, ordinal, text: '界'.repeat(512), value: 10000, trap: false, mediaIds: ordinal === 0 ? Array.from({ length: 260 }, (_, n) => longId(n + 256)) : [] }));
  const chunks = Array.from({ length: 256 }, (_, ordinal) => ({ ordinal, byteLength: 262144, sha256: hash }));
  pin.media = Array.from({ length: 260 }, (_, n) => ({ id: longId(n + 256), objectKey: `enta-private/${'x'.repeat(180)}`, objectVersion: '9'.repeat(24), sha256: hash, mime: 'video/webm', bytes: 67108864, width: 16000000, height: 1, durationMs: 120000, codec: 'h264', chunks, role: 'ITEM', itemId: pin.items[0].id }));
  pin.hints = Array.from({ length: 4 }, (_, ordinal) => ({ ...pin.hints[0], id: longId(ordinal + 800), revisionId: pin.revisionId, ordinal, text: '界'.repeat(512), safeDrawing: false }));
  pin.graphemes = pin.items.map((item, n) => ({ id: longId(n + 900), answerRevisionId: item.revisionId, answerHash: hash, segmentationVersion: '界'.repeat(64), grapheme: '界'.repeat(64), proofHash: hash }));
  validateNew5Descriptor(pin); const descriptor = descriptorWithoutChunks(pin); assert.ok(encodedBytes(descriptor) < 655360); assert.ok(encodedBytes(chunks) < 512 * 1024);
  const separators = [...JSON.stringify(descriptor).matchAll(/"(?:\\.|[^"\\])*"|[:,]/g)].filter(m => m[0] === ',' || m[0] === ':').length;
  assert.ok(separators < 20000); assert.ok(encodedBytes(descriptor) + 20000 < 655360);
  const { items, media, hints, graphemes, ...descriptorScalars } = descriptor;
  const constructorParts = encodedBytes(items) + encodedBytes(media) + encodedBytes(hints) + encodedBytes(graphemes) + encodedBytes(descriptorScalars); assert.ok(constructorParts < 655360);
  const pageGame = structuredClone(game); pageGame.rounds[0].pin = pin; pageGame.activeRoundId = pageGame.rounds[0].id; pageGame.rounds[0].phase = 'SHARED'; pageGame.rounds[0].graphemeHints = pin.items.map((item, n) => ({ itemId: item.id, proofId: pin.graphemes[n].id, eventId: randomUUID() }));
  const grading = competitionPageRows(pageGame, { collection: 'grading', roundId: pageGame.rounds[0].id, effectId: null, snapshot: pageGame.version, cursor: null }).slice(0, 16); assert.ok(encodedBytes(grading) < 65536, `grading page bytes=${encodedBytes(grading)}`);
  const teams = Array.from({ length: 4 }, () => ({ ...game.teams[0], id: randomUUID(), players: Array.from({ length: 8 }, () => ({ id: randomUUID(), name: '界'.repeat(30) })) }));
  const ids = Array.from({ length: 512 }, randomUUID);
  const attempts = ids.map(id => ({ id, roundId: randomUUID(), itemId: longId(0), phase: 'SHARED', phaseOrdinal: 2000000000, generation: 2000000000, teamId: teams[0].id, playerId: teams[0].players[0].id, ordinal: 2, acceptedAt: 9007199254740000, deadline: 9007199254740991, eventId: randomUUID(), pickedEventId: randomUUID(), allowanceId: randomUUID(), bonusEventId: randomUUID(), bonusMultiplier: 2, disclosureHead: randomUUID(), eligiblePlayerIds: teams[0].players.map(p => p.id), eligibilityHash: hash }));
  assert.ok(attempts.every(a => encodedBytes(a) < 2048));
  const bonuses = ids.map(attemptId => ({ attemptId, teamId: teams[0].id, multiplier: 2, sourceEventId: randomUUID() }));
  const effects = Array.from({ length: 5 }, () => ({ id: randomUUID(), eventId: randomUUID(), sequence: 64945, roundId: randomUUID(), kind: 'NO_SCORE', aid: null, amountKind: 'NONE', reversible: false, barrier: true, reads: Array.from({ length: 8 }, () => ({ teamId: randomUUID(), scoreVersion: 56592, value: 2147483647, sourceEffectId: randomUUID(), kind: 'RANK' })), dependencies: Array.from({ length: 8 }, randomUUID), postingIds: Array.from({ length: 4 }, randomUUID), beforeClock: null, afterClock: null, originalAttemptIds: ids, correctAttemptIds: ids, bonusSnapshot: bonuses, predecessorId: randomUUID(), predecessorHash: hash, reason: '界'.repeat(240), hash }));
  const canvas = { roundId: randomUUID(), revision: 512, mutations: 512, cumulativePoints: 8192, strokes: Array.from({ length: 128 }, (_, n) => ({ id: longId(n), color: '#ff2e95', width: 10, erase: false, points: Array.from({ length: 64 }, () => [10000, 10000]) })), visibleIds: Array.from({ length: 128 }, (_, n) => longId(n)), redoIds: [], receipts: Array.from({ length: 512 }, (_, n) => ({ commandId: 'x'.repeat(120) + n.toString().padStart(8, '0'), hash, revision: n + 1 })) };
  const window = { ...game, rounds: Array.from({ length: 36 }, (_, n) => n === 0 ? { ...game.rounds[0], pin: descriptor } : { contextSummary: true, id: randomUUID(), questionId: randomUUID(), ordinal: n, phase: 'READY', version: 64945, phaseOrdinal: 2000000000, generation: 2000000000, deadline: 9007199254740991, overallDeadline: null, pause: null, assignment: null, publicRevealed: false, resourceStop: null, pin: { categoryKey: 'x'.repeat(128), format: 'LIST_ITEMS', points: null }, consumed: [] }), teams, attempts, effects, classifications: attempts.map(a => ({ id: randomUUID(), attemptId: a.id, eventId: randomUUID(), correct: false, interim: true })), rulings: Array.from({ length: 129 }, () => ({ roundId: randomUUID(), itemId: longId(0), scopeId: JSON.stringify([randomUUID(), longId(0)]), originalEffectId: randomUUID(), effectId: randomUUID(), version: 257, hash, reversed: false })), disclosures: Array.from({ length: 256 }, () => ({ id: randomUUID(), roundId: randomUUID(), targetRevisionId: 'x'.repeat(1024), targetHash: hash, playerId: randomUUID(), assignmentId: randomUUID(), assignmentGeneration: 2000000000, at: 9007199254740991, grantId: randomUUID(), grantGeneration: 2000000000 })), canvases: [canvas], factContext: { version: 1, selectedRoundId: game.rounds[0].id, effectSequence: 64945, pendingTotal: 512, rulingTotal: 4644, terminalValidated: false } };
  // This intentionally over-approximates legal coexistence: all five effects
  // carry 512 originals/bonuses and drawing shares the item attempt maximum.
  const bytes = encodedBytes(window); assert.ok(bytes < 4 * 1024 * 1024, `${bytes}`); t.diagnostic(JSON.stringify({ descriptorBytes: encodedBytes(descriptor), descriptorConstructorPartsBytes: constructorParts, selectedManifestBytes: encodedBytes(chunks), gradingPageBytes: encodedBytes(grading), conservativeLiveWindowBytes: bytes, maximalAttemptBytes: Math.max(...attempts.map(encodedBytes)) }));
  const itemWindow = { ...window, effects: effects.slice(0, 3), canvases: [], disclosures: window.disclosures.map(d => ({ ...d, targetRevisionId: longId(1800) })), rounds: window.rounds.map((round, n) => n ? round : { ...round, consumed: pin.items.map(i => ({ itemId: i.id, effectId: randomUUID(), teamId: randomUUID() })), itemReveals: pin.items.map(i => i.id), graphemeHints: pin.items.map((i, n) => ({ itemId: i.id, proofId: pin.graphemes[n].id, eventId: randomUUID() })) }) };
  t.diagnostic(JSON.stringify({ compatibleItemWindowBytes: encodedBytes(itemWindow), itemWindowArrayBytes: Object.fromEntries(['effects', 'canvases', 'disclosures', 'rounds', 'attempts', 'classifications', 'rulings'].map(key => [key, encodedBytes(itemWindow[key as keyof typeof itemWindow])])) }));
  const commandWindow = { ...itemWindow, rulings: itemWindow.rulings.slice(0, 1), rounds: itemWindow.rounds.map((round, n) => n ? round : { ...round, graphemeHints: (round as typeof itemWindow.rounds[0] & { graphemeHints: unknown[] }).graphemeHints.slice(0, 2), pin: { ...descriptor, items: descriptor.items.map(({ text, mediaIds, ...i }) => { void text; void mediaIds; return i; }), media: [], hints: [], graphemes: [] } }), attempts: itemWindow.attempts.map(a => ({ id: a.id, roundId: a.roundId, itemId: a.itemId, teamId: a.teamId, playerId: a.playerId.padEnd(40, 'x'), phase: a.phase, phaseOrdinal: a.phaseOrdinal, generation: a.generation, bonusMultiplier: a.bonusMultiplier, bonusEventId: a.bonusEventId })) };
  const commandBytes = encodedBytes(commandWindow), commandSeparators = [...JSON.stringify(commandWindow).matchAll(/"(?:\\.|[^"\\])*"|[:,]/g)].filter(m => m[0] === ',' || m[0] === ':').length;
  // Historical nominal arithmetic for this smaller synthetic window only.
  // These aggregate sums are not active source-fit bounds; CAP-3.H H1/H3/H5
  // and the separately accepted C4/R6 field/phase proof control source capacity.
  assert.ok(commandBytes + commandSeparators + 65536 < 1179648); const nominalCombinedCommandArithmetic = 3 * 1179648 + 3 * 147456 + 32768 + 65536; assert.ok(nominalCombinedCommandArithmetic < 4194304); t.diagnostic(JSON.stringify({ commandWindowBytes: commandBytes, commandJsonbSeparatorUpperBytes: commandSeparators, extraClosedHeaderAndStateAllowanceBytes: 65536, nominalCombinedCommandArithmeticBytes: nominalCombinedCommandArithmetic }));
  const clock = { phase: 'AWAITING_RULING', phaseOrdinal: 2000000000, generation: 2000000000, currentTeamId: randomUUID(), deadline: 9007199254740991, overallDeadline: 9007199254740991, pause: { cause: 'PHONE', eventId: randomUUID(), phaseRemaining: 9007199254740991, overallRemaining: 9007199254740991, resumeAt: 9007199254740991, reason: '界'.repeat(240) } };
  const localEffect = { ...effects[0], beforeClock: clock, afterClock: clock };
  const localText = JSON.stringify(localEffect), localSpaces = [...localText.matchAll(/"(?:\\.|[^"\\])*"|[:,]/g)].filter(m => m[0] === ',' || m[0] === ':').length;
  t.diagnostic(JSON.stringify({ maximalLocalEffectWithClocksBytes: encodedBytes(localEffect), jsonbSpaces: localSpaces })); assert.ok(encodedBytes(localEffect) + localSpaces < 147456);
  // A fresh whole-item ruling partitions the SAME 512 original attempts and
  // bonuses across 128 heads. It cannot coexist with three 512-original prior
  // heads: those classified originals already exhaust the round attempt lane.
  const batchEffects = pin.items.map((i, n) => ({ ...localEffect, id: randomUUID(), beforeClock: null, afterClock: { ...clock, phase: 'RESOLVED', pause: null, deadline: null, overallDeadline: null }, reads: localEffect.reads.slice(0, 4), dependencies: localEffect.dependencies.slice(0, 4), reason: null, originalAttemptIds: ids.slice(n * 4, n * 4 + 4), correctAttemptIds: ids.slice(n * 4, n * 4 + 4), bonusSnapshot: bonuses.slice(n * 4, n * 4 + 4) }));
  const batchPostings = Array.from({ length: 512 }, () => ({ id: randomUUID(), effectId: randomUUID(), teamId: randomUUID(), delta: -2147483648, before: -2147483648, after: 2147483647, scoreVersion: 56592, previousHead: randomUUID() }));
  const wholeBatch = { ...commandWindow, effects: batchEffects, rulings: itemWindow.rulings, postings: batchPostings };
  const batchText = JSON.stringify(wholeBatch), batchSpaces = [...batchText.matchAll(/"(?:\\.|[^"\\])*"|[:,]/g)].filter(m => m[0] === ',' || m[0] === ':').length;
  // INT-062-CAPACITY-CONTRACT.md CAP-3.H evidence withdraws the old1179648
  // full-context assumption using this unchanged wide fixture. Keep it as a
  // negative regression, not a legal simultaneous-holder or native-overflow claim.
  // Input cannot coexist with its new output batch; complete phase proofs remain separate.
  t.diagnostic(JSON.stringify({ whole128RulingCommandWindowBytes: encodedBytes(wholeBatch), jsonbSpaces: batchSpaces }));
  assert.ok(encodedBytes(wholeBatch) + batchSpaces + 65536 > 1179648, 'wide synthetic fixture must continue to disprove the withdrawn full-context1179648 hypothesis');
  // Main response retains compact item state and collection totals, independent
  // of lifetime attempts/rulings and revealed answer/media payloads.
  const summaryGame = structuredClone(pageGame); summaryGame.teams = teams; summaryGame.attempts = attempts as typeof summaryGame.attempts; summaryGame.classifications = [];
  summaryGame.rounds = Array.from({ length: 36 }, (_, n) => n === 0 ? summaryGame.rounds[0] : { ...summaryGame.rounds[0], id: randomUUID(), ordinal: n, pin: { ...pin, categoryKey: longId(n + 1600) }, phase: 'READY' });
  summaryGame.categories = Array.from({ length: 6 }, (_, n) => ({ ...summaryGame.categories[0], key: longId(n + 1600), label: '界'.repeat(64) }));
  summaryGame.rounds[0].publicRevealed = true; summaryGame.rounds[0].revealedHintIds = pin.hints.map(h => h.id);
  const main = projectCompetition(summaryGame, 9007199254740000); assert.ok(encodedBytes(main) < 65536); assert.equal(main.attempts.length, 0); assert.equal(main.rulings.length, 0); assert.equal(main.currentRound?.media.length, 0); t.diagnostic(JSON.stringify({ maximalMainSummaryBytes: encodedBytes(main) }));
});
test('36 compact references include worst JSON escaping in the derived 1MiB internal commitment budget', t => {
  const game = fixtureCompetitionGame(), reference = { ...game.intent.selection[0], sourceNamespace: '\u0001'.repeat(1024), sourceId: '\u0002'.repeat(1024), revisionId: '\u0003'.repeat(1024), formatId: '\u0004'.repeat(1024), categoryKey: 'c'.repeat(128) };
  const selection = Array.from({ length: 36 }, (_, ordinal) => ({ ...reference, ordinal, cycle: 2000000000 }));
  const input = fixtureCompetitionStart('MIXED_BOARD'); input.requestKey = 'r'.repeat(128); input.logicalMatchId = 'g'.repeat(128);
  input.setup.categories = Array.from({ length: 6 }, (_, n) => ({ key: `category_${n}_`.padEnd(128, 'x'), promptRefs: Array.from({ length: 6 }, (_, k) => `prompt_${n}_${k}_`.padEnd(128, 'x')) }));
  input.setup.teams = ['CORAL', 'SKY', 'VIOLET', 'MINT'].map((colorKey, n) => ({ name: '界'.repeat(21) + n, colorKey, players: Array.from({ length: 8 }, (_, k) => '界'.repeat(29) + k), aids: ['PHONE_A_FRIEND', 'DOUBLE_ANSWER', 'PICK_ANSWERER'] }));
  const request = parseCompetitionStart(input, 'MIXED_BOARD'); assert.ok(encodedBytes(request) < 32768);
  const material = { ...game.intent, domain: START_MATERIAL, pinMaterial: PIN_MATERIAL, baseReleaseId: '\u0005'.repeat(1024), receiptId: '\u0006'.repeat(1024), formatReleaseId: '\u0007'.repeat(1024), competitiveReleaseId: '\u0008'.repeat(1024), selection, roundCount: 36, pinsHash: pinReferencesHash(selection), request };
  assert.ok(encodedBytes(material) < 1048576); t.diagnostic(JSON.stringify({ escapedInternalStartCommitmentBytes: encodedBytes(material), closedStartRequestBytes: encodedBytes(request) }));
  // Nominal encoded value windows, not a claim about PG executor allocation.
  // Descriptor components + assembled descriptor each stay below640KiB.
  const stages = { validation: 3 * 1048576 + 2 * 65536 + 32768, pinning: 2 * 1048576 + 2 * 655360 + 262144, receiptClosure: 1048576 + 4 * 655360 + 2 * 131072 };
  Object.values(stages).forEach(bytes => assert.ok(bytes < 4194304)); t.diagnostic(JSON.stringify({ combinedEncodedStartWindowUpperBytes: stages }));
});
