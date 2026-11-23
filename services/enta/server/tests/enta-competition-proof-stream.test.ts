import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { CorrectionProofStream, effectProofPages } from '../src/rounds/competition-proof-stream';
import { comparePool, sourcePoolRoot } from '../src/rounds/competition-material';
import type { Effect } from '../src/rounds/competition-types';
const effect = (sequence: number, blocked = false): Effect => { const payload = { id: randomUUID(), eventId: randomUUID(), sequence, roundId: randomUUID(), kind: 'TIMING' as const, aid: null, amountKind: blocked ? 'DERIVED' as const : 'NONE' as const, reversible: false, barrier: true, reads: blocked ? [{ teamId: 'team-a', scoreVersion: 1, value: 0, sourceEffectId: null, kind: 'RANK' as const }] : [], dependencies: [], postingIds: [], beforeClock: null, afterClock: null, originalAttemptIds: [], correctAttemptIds: [], bonusSnapshot: [], predecessorId: null, predecessorHash: null, reason: null }; return { ...payload, hash: admissionHash({ domain: 'maydan.enta.effect.v1', payload }) }; };
test('complete dependency proof finds ranking blocker after4096 and page1 without retaining full history IDs', () => {
  const original = effect(1), anchor = { gameId: 'game', version: 6000, start: 2, end: 5002, count: 5001 }, last = effect(5002, true), proof = new CorrectionProofStream(anchor, original, new Set(), ['team-a'], new Set(['team-a', 'team-b']));
  function* rows() { for (let n = 2; n < 5002; n++) yield { effect: effect(n), postings: [] }; yield { effect: last, postings: [] }; }
  let pages = 0; for (const page of effectProofPages(anchor, rows())) { assert.ok(page.returned <= 256); assert.ok(Buffer.byteLength(JSON.stringify(page.rows)) <= 524288); proof.page(page); pages++; } assert.ok(pages > 1); assert.deepEqual(proof.finish(), { ids: [last.id], total: 1 });
});
test('missing, duplicate, corrupt, out-of-order or mixed snapshot dependency pages deny; bounded blocker count is honest', () => {
  const original = effect(1), anchor = { gameId: 'game', version: 40, start: 2, end: 34, count: 33 }, rows = Array.from({ length: 33 }, (_, n) => ({ effect: effect(n + 2, true), postings: [] })), page = [...effectProofPages(anchor, rows)][0];
  const build = () => new CorrectionProofStream(anchor, original, new Set(), ['team-a'], new Set(['team-a'])); const proof = build(); proof.page(page); const result = proof.finish(); assert.equal(result.ids.length, 32); assert.equal(result.total, 33);
  assert.throws(() => build().finish());
  for (const corrupt of [{ ...page, complete: false }, { ...page, offset: 1 }, { ...page, anchor: { ...anchor, version: 41 } }, { ...page, rows: [...rows].reverse() }, { ...page, rows: [rows[0], rows[0], ...rows.slice(2)] }, { ...page, rows: [{ ...rows[0], effect: { ...rows[0].effect, hash: '0'.repeat(64) } }, ...rows.slice(1)] }]) { const p = build(); assert.throws(() => { p.page(corrupt); p.finish(); }); }
});
test('fresh5 source-pool root covers complete structured UTF8 order/count, rejects duplicated/mixed record identity', () => {
  const make = (sourceId: string) => ({ sourceNamespace: 'a:b', sourceId, categoryKey: 'category', format: 'LIST_ITEMS' as const, revisionId: 'revision', hash: '1'.repeat(64), formatId: 'format', formatHash: '2'.repeat(64), proofHash: '3'.repeat(64), hintRoot: '4'.repeat(64), ref: 'ref' });
  const records = [make('z'), make('أ'), make('😀')].sort(comparePool), root = sourcePoolRoot(records); assert.notEqual(root, sourcePoolRoot(records.slice(0, 1))); assert.notEqual(root, sourcePoolRoot([])); assert.throws(() => sourcePoolRoot([...records, records[0]])); assert.throws(() => sourcePoolRoot([{ ...records[0], extra: true } as typeof records[number]])); assert.equal(root, sourcePoolRoot(records));
});
