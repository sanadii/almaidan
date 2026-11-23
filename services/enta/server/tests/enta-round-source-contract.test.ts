// Text checks only: this file does not parse or execute PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { sourceKey, sourceRank, compareSource, selectRoundPins } from '../src/rounds/selection';
import { parseCanvasCommand, parseGrantCommand, parseHostCommand, parseRoundStart } from '../src/rounds/validation';
import { admissionHash } from '../src/admission/huroof-protocol.cjs';
import { fixtureFormatCatalog, fixtureRoundStart } from './enta-round-fixture';
const sql = readFileSync('services/enta/server/prisma/migrations/20261007170000_int8_formats_rounds/migration.sql', 'utf8');
function checkDollarQuotes(text: string) {
  let i = 0, block = 0, quote = '', dollar = '';
  while (i < text.length) {
    if (dollar) { if (text.startsWith(dollar, i)) { i += dollar.length; dollar = ''; } else i++; continue; }
    if (block) { if (text.startsWith('/*', i)) { block++; i += 2; } else if (text.startsWith('*/', i)) { block--; i += 2; } else i++; continue; }
    if (quote) { if (text[i] === quote) { if (text[i + 1] === quote) i += 2; else { quote = ''; i++; } } else i++; continue; }
    if (text.startsWith('--', i)) { const next = text.indexOf('\n', i); i = next < 0 ? text.length : next; continue; }
    if (text.startsWith('/*', i)) { block++; i += 2; continue; }
    if (text[i] === "'" || text[i] === '"') { quote = text[i++]; continue; }
    const marker = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i)); if (marker) { dollar = marker[0]; i += dollar.length; } else i++;
  }
  assert.equal(dollar, '', 'unclosed SQL dollar quote'); assert.equal(quote, '', 'unclosed SQL string/identifier'); assert.equal(block, 0, 'unclosed SQL comment');
  assert.ok(!/END\s+\$;/.test(text), 'single-dollar END delimiter');
}
test('source lexical dollar delimiters and exact int8 owner/revoke signatures; not PostgreSQL parsing', () => {
  checkDollarQuotes(sql); assert.throws(() => checkDollarQuotes(sql.replace('END $$;', 'END $;')));
  const declarations = [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(int8_\w+)\(([^)]*)\)/g)]; assert.ok(declarations.length >= 30);
  for (const [, name, args] of declarations) {
    const types = args ? args.split(',').map(arg => arg.trim().replace(/^(?:"[^"]+"|\w+)\s+/, '').toUpperCase()).join(',') : '';
    assert.ok(sql.includes(`ALTER FUNCTION public.${name}(${types}) OWNER TO enta_finance_executor;`), `${name} owner signature`);
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${name}(${types}) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;`), `${name} revoke signature`);
  }
  assert.ok(!/\bDOUBLE(?=,|\))/.test(sql));
});
test('namespaced source tuple golden keys/rank/component pool order preserve delimiter and prefix provenance', () => {
  const tuples = [['a:b', 'c'], ['a', 'b:c'], ['a', 'z'], ['a.b', 'a'], ['other', 'c']].map(([sourceNamespace, sourceId]) => ({ sourceNamespace, sourceId }));
  assert.equal(new Set(tuples.map(sourceKey)).size, 5); assert.equal(sourceKey(tuples[0]), '["a:b","c"]');
  const seed = '1'.repeat(64); for (const tuple of tuples) assert.equal(sourceRank(seed, 1, tuple), createHash('sha256').update(JSON.stringify([seed, 1, tuple.sourceNamespace, tuple.sourceId])).digest('hex'));
  assert.notEqual(sourceRank(seed, 1, tuples[0]), sourceRank(seed, 1, tuples[1]));
  assert.deepEqual([...tuples].sort(compareSource).map(sourceKey), ['["a","b:c"]', '["a","z"]', '["a.b","a"]', '["a:b","c"]', '["other","c"]']);
  const catalog = fixtureFormatCatalog(); catalog.categories[0].prompts.forEach((pin, index) => { Object.assign(pin, tuples[index]); const { formatHash: previousHash, ...payload } = pin; void previousHash; pin.formatHash = admissionHash({ version: 1, pin: payload }); });
  const request = parseRoundStart(fixtureRoundStart(), 'STANDALONE_LIST'); const selected = selectRoundPins(request, catalog, [], seed); assert.equal(new Set(selected.pins.map(sourceKey)).size, 4);
  const history = selected.intent.selection.map(row => ({ ...row, categoryKey: request.setup.categories[0].key })); const repeated = selectRoundPins(request, catalog, history, seed); assert.equal(repeated.intent.selection[0].cycle, 1);
  assert.ok(sql.includes(`public.int6_enta_hash(jsonb_build_array(intent->>'seed',selected_cycle,x->>'sourceNamespace',x->>'sourceId')) COLLATE "C",(x->>'sourceNamespace') COLLATE "C",(x->>'sourceId') COLLATE "C",(x->>'ref') COLLATE "C"`));
  assert.ok(sql.includes('count(DISTINCT ("sourceNamespace","sourceId"))')); assert.ok(sql.includes("WHERE rolname IN ('enta_gameplay_runtime','enta_runtime')"));
  assert.ok(sql.includes('CHECK("playerIndex" BETWEEN 0 AND 7)')); assert.ok(sql.includes('CHECK("generation">0)')); assert.ok(sql.includes('i."ordinal"')); assert.ok(sql.includes("rr.\"pin\"->'items'"));
});
test('strict nullable scorer/actor/item/role/Boolean/numeric command vectors deny malformed actions', () => {
  const common = { commandId: 'valid-command-key', expectedVersion: 1, roundId: 'round' };
  for (const teamId of [null, true, 2, {}, []]) assert.throws(() => parseHostCommand({ ...common, type: 'SELECT_SCORING_TEAM', teamId }));
  for (const value of [null, '0', 8, -1, 0.5]) assert.throws(() => parseHostCommand({ ...common, type: 'ASSIGN_ACTOR', teamId: 'team', playerIndex: value, itemId: null }));
  assert.throws(() => parseHostCommand({ ...common, type: 'JUDGE_ITEM', itemId: null })); assert.throws(() => parseHostCommand({ ...common, type: 'ADJUDICATE_ROUND', correct: 'true', teamId: 'team' }));
  assert.equal(parseHostCommand({ ...common, type: 'ADJUDICATE_ROUND', correct: false, teamId: null }).type, 'ADJUDICATE_ROUND');
  for (const role of [null, 'HOST', true]) assert.throws(() => parseGrantCommand({ ...common, type: 'CREATE_GRANT', role, durationSeconds: 600 }));
  assert.throws(() => parseCanvasCommand({ commandId: 'valid-command-key', expectedRevision: null, type: 'CLEAR' }));
  assert.ok(sql.includes('public.int8_valid_command(c,token_hash IS NOT NULL) IS NOT TRUE')); assert.ok(sql.includes("x->>'state' IN ('RUNNING','PAUSED')"));
});
test('retained-history successor body changes only identical owner-linked tier v2/v3 cursor/page predicates and preserves ACL', () => {
  const original = readFileSync('services/enta/server/prisma/migrations/20261007150000_int7_kids_history_rematch/migration.sql', 'utf8');
  const begin = original.indexOf('CREATE FUNCTION public.int7_enta_history('), end = original.indexOf('END $$;', begin) + 7;
  const predicate = ` AND g."executionFormat"='TIER_BOARD' AND EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=g."admissionId" AND a."firebaseIdentityId"=g."firebaseIdentityId" AND a."requestVersion" IN (2,3))`;
  const expected = original.slice(begin, end).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replaceAll(`g."mode" IN ('CLASSIC','KIDS')`, `g."mode" IN ('CLASSIC','KIDS')${predicate}`);
  const current = sql.indexOf('CREATE OR REPLACE FUNCTION public.int7_enta_history('); assert.ok(current > 0); assert.equal(sql.slice(current, sql.indexOf('END $$;', current) + 7), expected); assert.equal(expected.split(predicate).length, 3);
  assert.ok(sql.includes('ALTER FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;')); assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime;')); assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) TO enta_gameplay_runtime;'));
  // Bounded source predicate vectors; does not execute PostgreSQL queries.
  const supported = (format: string, version: number, linkedOwner: boolean) => format === 'TIER_BOARD' && [2, 3].includes(version) && linkedOwner;
  assert.equal(supported('TIER_BOARD', 2, true), true); assert.equal(supported('TIER_BOARD', 3, true), true);
  for (const [format, version, owner] of [['MIXED_BOARD', 4, true], ['STANDALONE_LIST', 4, true], ['STANDALONE_ACTING', 4, true], ['TIER_BOARD', 4, true], ['TIER_BOARD', 3, false], ['LEGACY', 2, true]] as const) assert.equal(supported(format, version, owner), false);
});
