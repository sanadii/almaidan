import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeHistoryResultDto, parseHistoryResultDto } from '../src/huroof-pg/history-result-dto';

const id = 'x'.repeat(128), version = '9223372036854775807';
const base = { schemaVersion: 1, matchId: id, resultVersion: version, occurredAt: '9999-12-31T23:59:59.999Z', questionScores: { horizontal: 2147483647, vertical: 2147483647 }, roundWins: { horizontal: 2147483647, vertical: 2147483647 }, matchWinner: 'horizontal', matchWinReason: 'two_consecutive_round_wins', endedWithoutWinner: false };
const parse = (v: unknown) => parseHistoryResultDto(v, id, version);

test('canonical encoding has a derived 463-byte maximum across enum and boolean choices', () => {
  let maximum = 0;
  for (const pair of [[null, null], ...['horizontal', 'vertical'].flatMap(w => ['two_consecutive_round_wins', 'three_total_round_wins'].map(r => [w, r]))]) {
    for (const endedWithoutWinner of [true, false]) {
      const dto = { ...base, matchWinner: pair[0], matchWinReason: pair[1], endedWithoutWinner };
      const encoded = encodeHistoryResultDto(dto, id, version);
      maximum = Math.max(maximum, Buffer.byteLength(encoded));
      const reversed = Object.fromEntries(Object.entries(dto).reverse());
      reversed.questionScores = { vertical: 2147483647, horizontal: 2147483647 };
      reversed.roundWins = { vertical: 2147483647, horizontal: 2147483647 };
      assert.equal(encodeHistoryResultDto(reversed, id, version), encoded);
    }
  }
  assert.equal(maximum, 463);
  assert.equal(JSON.parse(encodeHistoryResultDto(base, id, version)).resultVersion, version);
});

test('accepts legitimate independent values and returns detached nested objects', () => {
  const input = { ...base, matchId: 'm', resultVersion: '1', occurredAt: '2023-11-14T22:13:20.000Z', questionScores: {horizontal: 0, vertical: 3}, roundWins: {horizontal: 2, vertical: 1}, matchWinner: null, matchWinReason: null, endedWithoutWinner: false };
  const output = parseHistoryResultDto(input, 'm', '1');
  assert.deepEqual(output, input); assert.notEqual(output, input); assert.notEqual(output.questionScores, input.questionScores); assert.notEqual(output.roundWins, input.roundWins);
  input.questionScores.horizontal = 100; assert.equal(output.questionScores.horizontal, 0);
});

test('rejects malformed, missing, extra, coerced and mismatched data', () => {
  const malformed: unknown[] = [null, [], {...base, extra: 1}, {...base, schemaVersion: '1'}, {...base, matchId: 'other'}, {...base, resultVersion: '1'}, {...base, occurredAt: '2023-02-29T00:00:00.000Z'}, {...base, occurredAt: '2023-01-01T00:00:00Z'}, {...base, questionScores: {horizontal: 0}}, {...base, roundWins: {horizontal: 0, vertical: 0, extra: 1}}, {...base, matchWinner: ['horizontal']}, {...base, matchWinReason: ['two_consecutive_round_wins']}, {...base, matchWinner: null}, {...base, endedWithoutWinner: 0}];
  for (const n of [-1, 2147483648, 1.5, NaN, '1', [1], null]) malformed.push({...base, questionScores: {horizontal: n, vertical: 0}});
  for (const k of Object.keys(base)) { const v: Record<string, unknown> = {...base}; delete v[k]; malformed.push(v); }
  for (const v of malformed) { assert.throws(() => parse(v), {message: 'RESULT_UNAVAILABLE'}); assert.throws(() => encodeHistoryResultDto(v, id, version), {message: 'RESULT_UNAVAILABLE'}); }
  for (const v of ['', '0', '01', '9223372036854775808', '1.0', '1e0']) assert.throws(() => parseHistoryResultDto({...base, resultVersion:v}, id, v));
  for (const v of ['', 'a'.repeat(129), 'a b']) assert.throws(() => parseHistoryResultDto({...base, matchId:v}, v, version));
  assert.throws(() => parseHistoryResultDto(base, 'other', version));
  assert.throws(() => parseHistoryResultDto(base, id, '1'));
});

test('changing getters cannot replace validated values or leak input references', () => {
  for (const field of Object.keys(base) as Array<keyof typeof base>) {
    for (const encode of [false, true]) {
      let reads = 0;
      const source = { ...base };
      const original = base[field];
      Object.defineProperty(source, field, { enumerable: true, get() { reads++; return reads === 1 ? original : { injected: true }; } });
      const output = encode ? JSON.parse(encodeHistoryResultDto(source, id, version)) : parse(source);
      assert.equal(reads, 1, field); assert.deepEqual(output, base); assert.notEqual(output.questionScores, base.questionScores); assert.notEqual(output.roundWins, base.roundWins);
      assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 463);
    }
  }
  for (const outer of ['questionScores', 'roundWins'] as const) for (const field of ['horizontal', 'vertical'] as const) {
    for (const encode of [false, true]) {
      let reads = 0; const nested = { ...base[outer] };
      Object.defineProperty(nested, field, { enumerable: true, get() { reads++; return reads === 1 ? 7 : { injected: true }; } });
      const source = { ...base, [outer]: nested };
      const output = encode ? JSON.parse(encodeHistoryResultDto(source, id, version)) : parse(source);
      assert.equal(reads, 1); assert.equal(output[outer][field], 7); assert.notEqual(output[outer], nested);
    }
  }
  const invalid = { ...base, get occurredAt() { return { injected: true }; } };
  assert.throws(() => parse(invalid), { message: 'RESULT_UNAVAILABLE' });
});
