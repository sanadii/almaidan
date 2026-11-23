import assert from 'node:assert/strict';
import { test } from 'node:test';
import { competitionPageRows, createCompetitionPager } from '../src/rounds/competition-pages';
import { fixtureCompetitionGame } from './enta-competition-fixture';
import { parseCompetitionCommand } from '../src/rounds/competition-rules';
import { reduceCompetitionCommand } from '../src/rounds/competition-engine';
import { randomUUID } from 'node:crypto';
const scope = { principal: 'owner', project: 'project', gameId: 'game', collection: 'pending' as const, roundId: 'round', effectId: null, purpose: 'OWNER' as const, visibility: 'a'.repeat(64), snapshot: 513 };
test('512 pending rows require eight complete bound windows; selectors reject identity/revision/purpose changes', () => {
  const pager = createCompetitionPager(Buffer.alloc(32, 7)); let cursor: string | null = null; let delivered = 0;
  for (let n = 0; n < 8; n++) { const page = pager.window(scope, cursor, 512, Array.from({ length: 64 }, (_, k) => ({ id: `attempt-${n * 64 + k}` }))); assert.equal(page.offset, n * 64); assert.equal(page.total, 512); assert.equal(page.returned, 64); assert.equal(page.complete, n === 7); delivered += page.returned; cursor = page.nextCursor; }
  assert.equal(delivered, 512); assert.equal(cursor, null);
  const first = pager.window(scope, null, 512, Array.from({ length: 64 }, (_, k) => ({ id: `attempt-${k}` })));
  for (const change of [{ principal: 'another' }, { project: 'another' }, { snapshot: 514 }, { visibility: 'b'.repeat(64) }, { purpose: 'JUDGE' as const }, { roundId: 'another' }, { collection: 'correction' as const }]) assert.throws(() => pager.offset({ ...scope, ...change }, first.nextCursor), /PAGE_SNAPSHOT_RESTART/);
  assert.throws(() => createCompetitionPager(Buffer.alloc(32, 8)).offset(scope, first.nextCursor), /PAGE_SNAPSHOT_RESTART/);
});
test('bounded windows reject incomplete row proof, oversize payloads, terminal gaps and invalid count', () => {
  const pager = createCompetitionPager(); assert.throws(() => pager.window(scope, null, 512, []), /PAGE_PROOF_UNAVAILABLE/); assert.throws(() => pager.window(scope, null, 1, [{ text: 'x'.repeat(65536) }]), /PAGE_BOUND_EXCEEDED/); assert.throws(() => pager.window(scope, null, 64946, []), /PAGE_PROOF_UNAVAILABLE/); assert.throws(() => pager.window(scope, null, -1, []), /PAGE_PROOF_UNAVAILABLE/);
  const token = pager.encode(scope, 512); assert.throws(() => pager.window(scope, token, 511, []), /PAGE_PROOF_UNAVAILABLE/); assert.equal(pager.window(scope, null, 0, []).complete, true);
});
test('feedback reveals only a consumed approved HINT glyph before answer disclosure, and refuses unconsumed/foreign proofs', () => {
  const now = Date.parse('2026-10-08T20:00:00Z'); let game = fixtureCompetitionGame('STANDALONE_LIST', ['HINT', 'PASS', 'PHONE']);
  const run = (input: Record<string, unknown>) => { game = reduceCompetitionCommand(game, parseCompetitionCommand({ commandId: randomUUID(), expectedVersion: game.version, ...input }), now).next; };
  const rid = game.rounds[0].id; run({ type: 'OPEN_ROUND', roundId: rid });
  const query = () => ({ collection: 'feedback' as const, roundId: rid, effectId: null, snapshot: game.version, cursor: null });
  assert.deepEqual(competitionPageRows(game, query()), []);
  run({ type: 'USE_AID', roundId: rid, teamId: game.teams[0].id, aid: 'HINT' });
  const rows = competitionPageRows(game, query()); assert.equal(rows.length, 1); assert.equal('grapheme' in rows[0], true); assert.equal('text' in rows[0], false); assert.equal('mediaIds' in rows[0], false);
  const invalid = structuredClone(game); invalid.consumptions = []; assert.throws(() => competitionPageRows(invalid, query()), /GRAPHEME_PROOF_UNAVAILABLE/);
  const foreign = structuredClone(game); foreign.rounds[0].graphemeHints[0].proofId = randomUUID(); assert.throws(() => competitionPageRows(foreign, query()), /GRAPHEME_PROOF_UNAVAILABLE/);
  run({ type: 'PUBLIC_REVEAL', roundId: rid, itemId: null }); const disclosed = competitionPageRows(game, query()); assert.equal('text' in disclosed[0], true); assert.equal('grapheme' in disclosed[0], false);
});
