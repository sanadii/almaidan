import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalChallengeJson } from '../../../../src/features/game/challenges/integration';
import { canonicalJson } from '../../../../scripts/firestore-release-canonical';
import { preflightFamilyAllocation, reserveFamilyCandidate, initialFamilySelectionState } from '../../../../src/features/game/challenges/family-allocation';
import { createMatchQuestionSelection, createCategoryQuestionSelection, selectCategoryQuestion, promoteReservedQuestion } from '../../../../src/features/game/runtime/question-selector';
import { generateBoard, generateCategoryBoard } from '../../../../src/features/game/domain/board';

test('publication linkage pins the original admission tuple and still denies insertion', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_initial_linkage_block_insert()')[1].split('END $$;')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_initial_assert_publication_receipt(')[1].split('END $$;')[0];
  assert.match(body, /WHERE r\."inputClaimId"=NEW\."inputClaimId" FOR SHARE NOWAIT/);
  for (const field of ['inputClaimId','receiptId','reservationId','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','receiverIdentity','target','creationTransactionId']) {
    assert.ok(helper.includes(`p_receipt."${field}"`), field);
  }
  assert.match(helper, /IS DISTINCT FROM/);
  assert.match(helper, /p_receipt\."creationTransactionId" IS NOT DISTINCT FROM p_current_xid/);
  assert.match(helper, /p_receipt\."target"->>'expectedEvidenceHash' IS DISTINCT FROM p_evidence/);
  assert.match(helper, /p_receipt\."target"->>'bootstrapKind' IS DISTINCT FROM p_bootstrap_kind/);
  assert.match(helper, /p_receipt\."target"->>'expectedCoreHash' IS DISTINCT FROM p_core_hash/);
  const common='v_admission,NEW."inputClaimId",NEW."admissionReceiptId",NEW."admissionReservationId",NEW."baselineId",NEW."baselineCoreHash",NEW."admissionSessionClaimId",NEW."admissionAttemptId",NEW."eventId",NEW."admissionReceiverIdentity",NEW."admissionTarget",NEW."admissionCreationTransactionId",NEW."evidenceHash",';
  for (const [kind,id,core] of [['LAYOUT','physicalIdentity','layoutCoreHash'],['ALLOCATION','allocationId','allocationCoreHash']]) {
    assert.ok(body.includes(`public.pro273_initial_assert_publication_receipt(${common}'SELECTION_QUALIFIER_${kind}:'||NEW."${id}",NEW."${core}",pg_catalog.pg_current_xact_id())`),kind);
  }
  assert.match(body, /END IF;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  for (const table of ['Pro273InitialLayoutPublication', 'Pro273InitialAllocationPublication']) {
    const definition = sql.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
    for (const field of ['admissionReservationId','admissionSessionClaimId','admissionAttemptId','admissionReceiverIdentity','admissionTarget','admissionCreationTransactionId']) assert.ok(definition.includes(`"${field}"`), `${table}.${field}`);
  }
});

test('descriptor receipt hint denies before installer helpers without changing other receipt branches', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const receipt = sql.split('CREATE FUNCTION public.pro273_installer_constructor_receipt(p_expectation_id TEXT)')[1]
    .split('REVOKE ALL ON FUNCTION public.pro273_installer_constructor_receipt(TEXT)')[0];
  const checkEarlyHint = (source: string) => {
    const helpers = [
      'PERFORM public.pro273_installer_assert_committed_delivery(p_expectation_id)',
      'v_context:=public.pro273_installer_metadata_context(p_expectation_id)',
    ].map(helper => source.indexOf(helper));
    assert.ok(helpers.every(index => index >= 0));
    const prefix = source.slice(0, Math.min(...helpers));
    assert.match(prefix, /SELECT e\."constructorKind"='QUALIFIER_DESCRIPTOR' INTO STRICT v_descriptor_hint\s+FROM public\."Pro273ControlPlaneInstallerExpectation" e WHERE e\."expectationId"=p_expectation_id;\s+IF v_descriptor_hint THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;/);
  };
  checkEarlyHint(receipt);
  const earlyKey = 'e."expectationId"=p_expectation_id';
  assert.ok(receipt.includes(earlyKey));
  assert.throws(() => checkEarlyHint(receipt.replace(earlyKey, 'e."wrongKey"=p_expectation_id')));
  assert.match(receipt, /IF v_context->>'constructorKind'='CONTROL_PLANE_BASELINE' THEN/);
  assert.match(receipt, /ELSIF v_context->>'constructorKind'='INVOCATION_SCHEDULE_GRANT_PAIR' THEN/);
  assert.match(receipt, /ELSIF v_context->>'constructorKind'='QUALIFIER_DESCRIPTOR' THEN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(receipt, /EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
});

test('denied accounting snapshots retain schema fields before occurrence deduplication', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const snapshot = entry.split('-- Retain each protected charge occurrence')[1].split('-- Fixed presence snapshot')[0];
  for (const [table, alias, fields] of [
    ['Pro262CapacityControlCharge','c',['kind','eventKey','bindingHash','amount']],
    ['Pro262CapacityControlBaseline','cb',['kind','physicalIdentity','controlProofIdentity','coverageEvidenceHash','coverageContract','allocated','archiveBaselineUsed','eventWorstCase','maxClosedScopeBytes','spent','enabled']],
  ] as const) {
    const schema = supplier.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
    for (const field of fields) {
      assert.match(schema, new RegExp(`"${field}" (?:TEXT|NUMERIC|BOOLEAN) (?:PRIMARY KEY|NOT NULL)`), `${table}.${field}`);
      assert.ok(snapshot.includes(`${alias}."${field}" AS `), `${table}.${field}`);
    }
    assert.doesNotMatch(schema, /"validFrom"|"validUntil"/);
  }
  for (const term of ['v_charge_source_text TEXT[][]','v_charge_source_amount NUMERIC[]','v_control_baseline_source_text TEXT[][]','v_control_baseline_source_numbers NUMERIC[][]','v_control_baseline_source_enabled BOOLEAN[]']) assert.ok(entry.includes(term), term);
  for (const term of [
    'ARRAY[[v_snapshot_charge.kind,v_snapshot_charge.event_key,v_snapshot_charge.binding_hash]]', 'ARRAY[v_snapshot_charge.amount]',
    'ARRAY[[v_snapshot_baseline.kind,v_snapshot_baseline.physical_identity,v_snapshot_baseline.proof_identity,v_snapshot_baseline.evidence_hash,v_snapshot_baseline.coverage_contract]]',
    'ARRAY[[v_snapshot_baseline.allocated,v_snapshot_baseline.archive_used,v_snapshot_baseline.event_worst,v_snapshot_baseline.max_closed,v_snapshot_baseline.spent]]',
    'ARRAY[v_snapshot_baseline.enabled]', 'array_length(v_control_baseline_source_text,1) NOT BETWEEN 1 AND 28',
  ]) assert.ok(snapshot.includes(term), term);
  assert.ok(snapshot.indexOf('FOR v_candidate_index IN 1..28 LOOP') < snapshot.indexOf('-- Compare hashes across every route'));
  assert.ok(snapshot.indexOf('FOR v_snapshot_i IN 1..28 LOOP') < snapshot.indexOf('-- Compare hashes across every route'));
  for (const term of ['v_charge_source_amount[v_snapshot_i] IS DISTINCT FROM v_charge_source_amount[v_snapshot_j]', 'pg_catalog.scale(v_charge_source_amount[v_snapshot_i])', 'GROUP BY v_charge_candidates[i][1] COLLATE "C"', 'INTO STRICT v_snapshot_baseline']) assert.ok(snapshot.includes(term), term);
  assert.doesNotMatch(snapshot, /FOR\s+(?:UPDATE|SHARE)|\b(?:JSONB|BYTEA)\b|\b(?:INSERT|UPDATE|DELETE)\b/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.ok(sql.startsWith('-- INCOMPLETE SOURCE CHECKPOINT. Installation remains prohibited under R6 STOP.'));

  // Inert model only: role bounds and pre-dedup conflict handling.
  type Fact = { kind:string; key:string; hash:string; amount:string; role:'ordinary'|'publisher' };
  const facts:Fact[] = Array.from({length:28},(_,i)=>({kind:i===27?'TRUST_PROVISION':'kind',key:`event-${i}`,hash:'a'.repeat(64),amount:'1',role:i===27?'publisher':'ordinary'}));
  const collect = (rows:Fact[]) => {
    if (rows.length!==28) return false;
    const seen = new Map<string,string>();
    for (const row of rows) {
      if (Buffer.byteLength(row.kind)<1 || Buffer.byteLength(row.kind)>256 || Buffer.byteLength(row.key)<1 || Buffer.byteLength(row.key)>(row.role==='publisher'?276:256) || !/^[a-f0-9]{64}$/.test(row.hash) || !/^[1-9]\d*$/.test(row.amount)) return false;
      const key=JSON.stringify([row.kind,row.key]), value=JSON.stringify([row.hash,row.amount]);
      if (seen.has(key) && seen.get(key)!==value) return false;
      seen.set(key,value);
    }
    return true;
  };
  assert.equal(collect(facts),true);
  assert.equal(collect(facts.slice(1)),false);
  assert.equal(collect(facts.map((r,i)=>i===1?{...facts[0]}:r)),true);
  assert.equal(collect(facts.map((r,i)=>i===1?{...facts[0],amount:'2'}:r)),false);
  assert.equal(collect(facts.map((r,i)=>i===1?{...facts[0],hash:'b'.repeat(64)}:r)),false);
  assert.equal(collect(facts.map((r,i)=>i===0?{...r,key:'x'.repeat(257)}:r)),false);
  assert.equal(collect(facts.map((r,i)=>i===27?{...r,key:'x'.repeat(276)}:r)),true);
  assert.equal(collect(facts.map((r,i)=>i===27?{...r,key:'x'.repeat(277)}:r)),false);
});

test('denied descriptor discovery retains stored dispatch and delivery facts for both routes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const discovery = entry.split('-- Denied discovery prototype only:')[1].split('-- Follow the original publication claims separately;')[0];
  const rows = [
    { table: 'Pro273InstallerDispatchAttempt', alias: 'd', prefix: 'dispatch', text: ['attemptId','expectationId','sessionClaimId','inputClaimId','chargeKind','chargeEventKey','deliveryChargeKind','deliveryChargeEventKey'], hashes: ['receiverClosureHash','chargeBindingHash','deliveryChargeBindingHash'], xid: 'creationTransactionId', time: 'claimedAt' },
    { table: 'Pro273InstallerDelivery', alias: 'delivery', prefix: 'delivered', text: ['attemptId','expectationId','sessionClaimId','inputClaimId','eventId','chargeKind','chargeEventKey'], hashes: ['receiverClosureHash','chargeBindingHash'], xid: 'creationTransactionId', time: 'createdAt' },
  ];
  for (const row of rows) {
    const schema = sql.split(`CREATE TABLE public."${row.table}" (`)[1].split('\n);')[0];
    for (const field of [...row.text, ...row.hashes, row.xid, row.time]) {
      assert.match(schema, new RegExp(`"${field}"\\s+(?:TEXT|xid8|TIMESTAMPTZ) NOT NULL|"${field}"\\s+TEXT PRIMARY KEY`), `${row.table}.${field}`);
      const stored = `${row.prefix}_${field}`;
      assert.ok(discovery.includes(`${row.alias}."${field}" AS ${stored}`), stored);
      assert.ok(discovery.includes(`v_installer.${stored}`), stored);
    }
  }
  const retained = discovery.split('-- Both table schemas require every retained field;')[1].split('v_session_text:=')[0];
  const [textChecks, hashChecks, typedChecks] = retained.split('END LOOP;');
  for (const row of rows) {
    const dest = row.prefix === 'dispatch' ? 'dispatch' : 'delivery';
    for (const [suffix, fields] of [['text', row.text], ['hashes', row.hashes], ['transactions', [row.xid]], ['times', [row.time]]] as const) {
      const assignment = retained.split(`v_${dest}_${suffix}:=`)[1].split(';')[0];
      for (const field of fields) assert.ok(assignment.includes(`v_installer.${row.prefix}_${field}`), `${dest}.${field}`);
    }
    for (const field of row.text) assert.ok(textChecks.includes(`(v_installer.${row.prefix}_${field})`), `text check ${field}`);
    for (const field of row.hashes) assert.ok(hashChecks.includes(`(v_installer.${row.prefix}_${field})`), `hash check ${field}`);
    for (const field of [row.xid, row.time]) assert.ok(typedChecks.includes(`v_installer.${row.prefix}_${field} IS NULL`), `typed check ${field}`);
    for (const [suffix, width] of [['text', row.text.length], ['hashes', row.hashes.length]] as const) {
      assert.ok(entry.includes(`pg_catalog.array_length(v_${dest}_${suffix},1) IS DISTINCT FROM 2 OR pg_catalog.array_length(v_${dest}_${suffix},2) IS DISTINCT FROM ${width}`));
    }
    for (const suffix of ['transactions', 'times']) assert.ok(entry.includes(`pg_catalog.array_length(v_${dest}_${suffix},1) IS DISTINCT FROM 2`));
  }
  assert.match(entry, /v_dispatch_transactions xid8\[\]/);
  assert.match(entry, /v_delivery_transactions xid8\[\]/);
  assert.match(entry, /v_dispatch_times TIMESTAMPTZ\[\]/);
  assert.match(entry, /v_delivery_times TIMESTAMPTZ\[\]/);
  assert.match(retained, /octet_length\(v_fact.value\) NOT BETWEEN 1 AND 256/);
  assert.match(retained, /v_fact.value !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.doesNotMatch(retained, /SESSION_USER|v_route\.|v_key\.|JSONB|BYTEA/i);
  assert.match(discovery, /FOR v_key IN SELECT x.id FROM \(VALUES \(v_route.current_expectation\),\(v_route.historical_expectation\)\)/);
  assert.match(discovery, /delivery\."receiverClosureHash",delivery\."chargeKind",delivery\."chargeEventKey",delivery\."chargeBindingHash"\)=\(d\."attemptId",e\."expectationId",s\."sessionClaimId",c\."inputClaimId",e\."eventId",d\."receiverClosureHash",d\."deliveryChargeKind",d\."deliveryChargeEventKey",d\."deliveryChargeBindingHash"\)/);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(entry, /descriptor post-lock reread/);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\. Installation remains prohibited under R6 STOP\./);

  // Illustrative fixed-row checks, not SQL execution or authentication.
  const hash = 'a'.repeat(64);
  const dispatch = { attemptId: 'attempt', expectationId: 'historical', sessionClaimId: 'session', inputClaimId: 'input', receiverClosureHash: hash, deliveryChargeKind: 'kind', deliveryChargeEventKey: 'event', deliveryChargeBindingHash: hash };
  const delivery = { attemptId: 'attempt', expectationId: 'historical', sessionClaimId: 'session', inputClaimId: 'input', eventId: 'publication', receiverClosureHash: hash, chargeKind: 'kind', chargeEventKey: 'event', chargeBindingHash: hash };
  const match = (d: typeof dispatch, y: typeof delivery, event: string) => d.attemptId === y.attemptId && d.expectationId === y.expectationId && d.sessionClaimId === y.sessionClaimId && d.inputClaimId === y.inputClaimId && y.eventId === event && d.receiverClosureHash === y.receiverClosureHash && d.deliveryChargeKind === y.chargeKind && d.deliveryChargeEventKey === y.chargeEventKey && d.deliveryChargeBindingHash === y.chargeBindingHash;
  for (const expectationId of ['current', 'historical']) {
    const d = { ...dispatch, expectationId }; const y = { ...delivery, expectationId };
    assert.equal(match(d, y, 'publication'), true);
    for (const field of Object.keys(y) as (keyof typeof y)[]) assert.equal(match(d, { ...y, [field]: 'mismatch' }, 'publication'), false, `${expectationId}.${field}`);
    assert.equal(match(d, { ...y, expectationId: '' }, 'publication'), false);
  }
  const textValid = (v: string | null | undefined) => v != null && Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= 256;
  const hashValid = (v: string | null | undefined) => v != null && /^[a-f0-9]{64}$/.test(v);
  for (const value of [undefined, null, '', 'x'.repeat(257), 'é'.repeat(129)]) assert.equal(textValid(value), false);
  for (const value of ['x', 'x'.repeat(256), 'é'.repeat(128)]) assert.equal(textValid(value), true);
  for (const value of [undefined, null, '', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64)]) assert.equal(hashValid(value), false);
  assert.equal(hashValid(hash), true);
  const required = (values: readonly unknown[]) => values.every(value => value !== null && value !== undefined);
  for (const value of [null, undefined]) assert.equal(required(['xid', value]), false);
  assert.equal(required(['xid', 'timestamp']), true);
});

test('control observation byte spans remain private, preflight-denied and source-bound', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'pro273_control_observation_span_candidate(BYTEA,INTEGER[],INTEGER[],BYTEA[])';
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_span_candidate(')[1].split('END $$;')[0];
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  const preflight = body.indexOf('IF v_raw_limit IS NULL OR v_token_workspace_limit IS NULL OR v_decoded_limit IS NULL OR v_concurrent_peak_limit IS NULL');
  const admissionDenial = body.indexOf("RAISE EXCEPTION 'SELECTION_UNAVAILABLE';", body.indexOf('-- not implemented.'));
  const firstInputOperation = body.indexOf('IF p_raw IS NULL');
  assert.ok(preflight > 0 && admissionDenial > preflight && admissionDenial < firstInputOperation);
  for (const name of ['v_raw_limit', 'v_token_workspace_limit', 'v_decoded_limit', 'v_concurrent_peak_limit']) assert.match(body, new RegExp(`${name} BIGINT:=NULL`));
  for (const name of ['p_starts', 'p_ends', 'p_units']) {
    assert.ok(body.includes(`pg_catalog.array_ndims(${name}) IS DISTINCT FROM 1`));
    assert.ok(body.includes(`pg_catalog.array_lower(${name},1) IS DISTINCT FROM 1`));
    assert.ok(body.includes(`pg_catalog.cardinality(${name}) IS DISTINCT FROM 45`));
  }
  for (const guard of [
    'p_starts[1] IS DISTINCT FROM v_pos', 'p_starts[v_i] IS DISTINCT FROM v_pos',
    'v_end::BIGINT<v_pos::BIGINT+2 OR v_end>v_len',
    'v_unit_bytes%2<>0', 'v_byte NOT BETWEEN 32 AND 127 OR v_byte=34',
    'v_pos::BIGINT+4>v_end::BIGINT-1', 'v_unit:=v_unit*16+v_digit',
    'v_unit=0', 'v_unit NOT BETWEEN 56320 AND 57343', 'v_unit BETWEEN 55296 AND 56319',
    'v_unit BETWEEN 56320 AND 57343', '2*v_j::BIGINT+2>v_unit_bytes::BIGINT',
    'pg_catalog.get_byte(p_units[v_i],(2*v_j::BIGINT)::INTEGER)<>v_unit/256',
    'pg_catalog.get_byte(p_units[v_i],(2*v_j::BIGINT+1)::INTEGER)<>v_unit%256',
    'v_pending_high OR 2*v_j::BIGINT<>v_unit_bytes::BIGINT',
    'IF v_pending_high THEN RAISE EXCEPTION',
    'v_byte BETWEEN 194 AND 223 THEN v_count:=1; v_scalar:=v_byte-192; v_min:=128',
    'v_byte BETWEEN 224 AND 239 THEN v_count:=2; v_scalar:=v_byte-224; v_min:=2048',
    'v_byte BETWEEN 240 AND 244 THEN v_count:=3; v_scalar:=v_byte-240; v_min:=65536',
    'v_pos::BIGINT+v_count::BIGINT>v_end::BIGINT-1',
    'v_digit NOT BETWEEN 128 AND 191', 'v_scalar:=v_scalar*64+(v_digit-128)::BIGINT',
    'v_scalar<v_min OR v_scalar BETWEEN 55296 AND 57343 OR v_scalar>1114111',
    'v_unit:=(55296+v_scalar/1024)::INTEGER', 'v_unit:=(56320+v_scalar%1024)::INTEGER',
    'IF v_i%2=0 THEN v_byte:=58; ELSIF v_i<45 THEN v_byte:=44; ELSE v_byte:=125; END IF;',
    'p_ends[1] IS DISTINCT FROM v_pos', 'IF v_pos<>v_len',
  ]) assert.ok(body.includes(guard), guard);
  assert.match(body, /IF v_pos<>v_len[\s\S]*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  assert.doesNotMatch(body, /::JSONB|jsonb_|pro273_sel_|convert_to\s*\(/i);
  assert.doesNotMatch(body, /substring\s*\(|substr\s*\(|array_append\s*\(|\|\|/i);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION public.${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION public.${signature}`));
});

test('control observation spans have illustrative UTF-16BE vectors only', () => {
  // Independent JS reference for one bounded string span; this does not run or prove SQL.
  const bytes = (s: string) => new TextEncoder().encode(s);
  const units = (s: string) => Uint8Array.from(Array.from({ length: s.length }, (_, i) => [s.charCodeAt(i) >> 8, s.charCodeAt(i) & 255]).flat());
  const check = (raw: Uint8Array, start: number, end: number, expected: Uint8Array) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > raw.length || end - start < 2) return false;
    const span = raw.slice(start, end);
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(span));
      if (typeof value !== 'string' || span[0] !== 34 || span[span.length - 1] !== 34) return false;
      for (let i = 0; i < value.length; i++) {
        const n = value.charCodeAt(i);
        if (n === 0 || (n >= 0xdc00 && n <= 0xdfff)) return false;
        if (n >= 0xd800 && n <= 0xdbff) {
          const next = value.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
        }
      }
      return Buffer.from(units(value)).equals(Buffer.from(expected));
    } catch { return false; }
  };
  const vectors: [string, string][] = [
    ['"event\\u0049d"', 'eventId'], ['"ASCII 123"', 'ASCII 123'],
    ['"\\\\\\\"\\/\\b\\f\\n\\r\\t"', '\\"/\b\f\n\r\t'],
    ['"\\uD83d\\uDe00"', '😀'], ['"\\u0020\\u007f"', ' \x7f'], ['"\x7f"', '\x7f'], ['"\\u007f"', '\x7f'], ['""', ''],
    ['"é"', 'é'], ['"€"', '€'], ['"😀"', '😀'], ['"\u{10ffff}"', '\u{10ffff}'],
    ['"\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}"', '\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}'],
    ['"é\\u0041😀\\uD83D\\uDE00"', 'éA😀😀'],
  ];
  for (const [token, value] of vectors) {
    const raw = bytes(` {${token}:`); const start = 2; const end = raw.length - 1;
    assert.equal(check(raw, start, end, units(value)), true, token);
    assert.equal(check(raw, start, end, units(value + 'x')), false, `mismatched units: ${token}`);
    if (value.length) assert.equal(check(raw, start, end, units('x' + value.slice(1))), value[0] === 'x', `different unit: ${token}`);
    assert.equal(check(raw, start + 1, end, units(value)), false, `wrong start: ${token}`);
    assert.equal(check(raw, start, end - 1, units(value)), false, `wrong end: ${token}`);
  }
  for (const [token, decoded] of [
    ['"\\u0000"', '\0'], ['"\\ud800"', '\ud800'], ['"\\udc00"', '\udc00'],
    ['"\\ud800x"', '\ud800x'], ['"\\ud800\\ud800"', '\ud800\ud800'],
    ['"\\u12xz"', ''], ['"\\u123"', ''], ['"\\q"', ''], ['"\n"', '\n'],
    ['"\\ud800é"', '\ud800é'], ['"😀\\udc00"', '😀\udc00'],
  ]) {
    const raw = bytes(token);
    assert.equal(check(raw, 0, raw.length, units(decoded)), false, token);
  }
  for (const invalid of [
    [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xf0, 0x80, 0x80, 0x80],
    [0xc2, 0x20], [0xe2, 0x28, 0xa1], [0xf0, 0x90, 0x80, 0x41],
    [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
    [0x80], [0xc2], [0xe2, 0x82], [0xf0, 0x90, 0x80], [0x00],
  ]) {
    const raw = Uint8Array.from([34, ...invalid, 34]);
    assert.equal(check(raw, 0, raw.length, units('')), false, `invalid bytes: ${invalid.join(',')}`);
  }
});

test('control observation fixed shape is private and denied; raw ABI vectors remain inert', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'pro273_control_observation_shape_candidate(BYTEA,TEXT[],INTEGER[],TEXT[],INTEGER[],BYTEA[])';
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_shape_candidate(')[1].split('END $$;')[0];
  const keys = ['schemaVersion','baselineId','baselineCoreHash','sessionClaimId','attemptId','eventId','targetOid','targetPrincipal','targetPid','targetBackendStart','credentialEpoch','launchEpoch','host','boot','processTree','parentProcessTree','sourceClosureHash','installationClosureHash','observedAt','validUntil','evidenceBase64','evidenceHash'];
  assert.equal(keys.length, 22);
  // Independently encode the expected ASCII strings as UTF-16BE bytea literals.
  // These are source assertions only; they do not execute the SQL parser.
  const utf16beLiteral = (value: string) => {
    assert.match(value, /^[\x20-\x7e]+$/);
    return `'\\x${Array.from(value, ch => ch.charCodeAt(0).toString(16).padStart(4, '0')).join('')}'::BYTEA`;
  };
  assert.ok(body.includes(`v_names CONSTANT BYTEA[]:=ARRAY[${keys.map(utf16beLiteral).join(',')}]`));
  assert.ok(body.includes(`v_key_index=1 AND p_units[3+2*v_i] IS DISTINCT FROM ${utf16beLiteral('pro273-control-plane-process-v1')}`));
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /v_mask<>4194303[\s\S]*?RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  for (const array of ['p_kinds', 'p_parents', 'p_edges', 'p_ordinals', 'p_units']) {
    assert.ok(body.includes(`pg_catalog.array_ndims(${array}) IS DISTINCT FROM 1`));
    assert.ok(body.includes(`pg_catalog.array_lower(${array},1) IS DISTINCT FROM 1`));
    assert.ok(body.includes(`pg_catalog.cardinality(${array}) IS DISTINCT FROM 45`));
  }
  for (const guard of [
    'p_raw IS NULL', "p_kinds[1] IS DISTINCT FROM 'OBJECT'", 'p_parents[1] IS NOT NULL',
    "p_edges[1] IS DISTINCT FROM 'ROOT'", 'p_ordinals[1] IS DISTINCT FROM 0', 'p_units[1] IS NOT NULL',
    "p_kinds[2+2*v_i] IS DISTINCT FROM 'STRING'", "p_kinds[3+2*v_i] IS DISTINCT FROM 'STRING'",
    'p_parents[2+2*v_i] IS DISTINCT FROM 0', 'p_parents[3+2*v_i] IS DISTINCT FROM 0',
    "p_edges[2+2*v_i] IS DISTINCT FROM 'KEY'", "p_edges[3+2*v_i] IS DISTINCT FROM 'VALUE'",
    'p_ordinals[2+2*v_i] IS DISTINCT FROM v_i', 'p_ordinals[3+2*v_i] IS DISTINCT FROM v_i',
    'p_units[2+2*v_i] IS NULL', 'p_units[3+2*v_i] IS NULL',
    'FOR v_i IN 0..21 LOOP', 'FOR v_j IN 1..22 LOOP',
    'p_units[2+2*v_i]=v_names[v_j] THEN v_key_index:=v_j; EXIT',
    'v_key_index=0 OR (v_mask & (1 << (v_key_index-1)))<>0',
    'v_mask:=v_mask | (1 << (v_key_index-1))',
  ]) assert.ok(body.includes(guard), guard);
  assert.match(body, /v_mask & \(1 << \(v_key_index-1\)\)/);
  assert.doesNotMatch(body, /::JSONB|jsonb_|pro273_sel_|pro273_installer_metadata_tokenize|convert_to\s*\(/i);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION public.${signature} OWNER TO pro262_capacity_owner;`));
  assert.match(roles, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature.replace(/[()[\]]/g, '\\$&')} FROM PUBLIC,`));
  assert.ok(!roles.includes(`GRANT EXECUTE ON FUNCTION public.${signature}`));

  // Independent illustrative raw vectors, not an execution or proof of SQL.
  // This reference consumes only a flat object of JSON strings and retains
  // decoded keys until duplicates are checked; no JSON object is constructed.
  const check = (bytes: Uint8Array): boolean => {
    try {
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return false;
      const input = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let pos = 0;
      const ws = () => { while (/[\t\n\r ]/.test(input[pos] ?? '\0')) pos++; };
      const string = (): string => {
        if (input[pos] !== '"') throw Error('string');
        const start = pos++;
        while (pos < input.length) {
          const ch = input[pos++];
          if (ch === '\\') { if (pos >= input.length) throw Error('escape'); pos++; }
          else if (ch === '"') {
            const value: string = JSON.parse(input.slice(start, pos));
            for (let i = 0; i < value.length; i++) {
              const n = value.charCodeAt(i);
              if (n === 0 || (n >= 0xdc00 && n <= 0xdfff)) throw Error('scalar');
              if (n >= 0xd800 && n <= 0xdbff) {
                const next = value.charCodeAt(++i);
                if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error('scalar');
              }
            }
            return value;
          }
        }
        throw Error('unterminated');
      };
      ws(); if (input[pos++] !== '{') return false;
      const seen = new Set<string>(); let count = 0;
      ws();
      while (input[pos] !== '}') {
        const key = string(); ws(); if (input[pos++] !== ':') return false; ws();
        const value = string();
        if (!keys.includes(key) || seen.has(key) || (key === 'schemaVersion' && value !== 'pro273-control-plane-process-v1')) return false;
        seen.add(key); count++; ws();
        if (input[pos] !== ',') break;
        pos++; ws(); if (input[pos] === '}') return false;
      }
      if (input[pos++] !== '}') return false;
      ws(); return pos === input.length && count === 22 && keys.every(k => seen.has(k));
    } catch { return false; }
  };
  const enc = (s: string) => new TextEncoder().encode(s);
  const entries = keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(k === 'schemaVersion' ? 'pro273-control-plane-process-v1' : 'x')}`);
  const raw = (parts: string[]) => enc(`{${parts.join(',')}}`);
  assert.equal(check(raw(entries)), true);
  assert.equal(check(raw([...entries].reverse())), true);
  for (let i = 0; i < keys.length; i++) {
    assert.equal(check(raw(entries.filter((_, j) => i !== j))), false, `missing ${keys[i]}`);
    assert.equal(check(raw([...entries, entries[i]])), false, `duplicate ${keys[i]}`);
    const escapedKey = `\\u${keys[i].charCodeAt(0).toString(16).padStart(4, '0')}${keys[i].slice(1)}`;
    const aliasEntry = entries[i].replace(`"${keys[i]}"`, `"${escapedKey}"`);
    assert.equal(check(raw(entries.map((e, j) => i === j ? aliasEntry : e))), true, `alias ${keys[i]}`);
    assert.equal(check(raw([...entries, aliasEntry])), false, `alias duplicate ${keys[i]}`);
    for (const nonString of ['null', '0', 'false', '[]', '{}']) {
      assert.equal(check(raw(entries.map((e, j) => i === j ? `${JSON.stringify(keys[i])}:${nonString}` : e))), false, `${keys[i]}: ${nonString}`);
    }
  }
  const alias = entries.map(e => e.startsWith('"eventId"') ? e.replace('eventId', 'event\\u0049d') : e);
  assert.equal(check(raw(alias)), true);
  assert.equal(check(raw([...entries, '"event\\u0049d":"x"'])), false);
  assert.equal(check(raw(entries.map((e, i) => i === 1 ? '"baselineId":"\\ud83d\\ude00"' : e))), true);
  for (const malformed of [
    [...entries, '"extra":"x"'], entries.map((e, i) => i === 1 ? '"baselineId":null' : e),
    entries.map((e, i) => i === 1 ? '"baselineId":{}' : e),
    entries.map((e, i) => i === 1 ? '"baselineId":"\\u0000"' : e),
    entries.map((e, i) => i === 1 ? '"baselineId":"\\ud800"' : e),
    entries.map((e, i) => i === 1 ? '"baselineId":"\\udc00"' : e),
    entries.map((e, i) => i === 0 ? '"schemaVersion":"wrong"' : e),
  ]) assert.equal(check(raw(malformed)), false);
  assert.equal(check(enc(`{${entries.join(',')},}`)), false);
  assert.equal(check(Uint8Array.from([0xef, 0xbb, 0xbf, ...raw(entries)])), false);
  for (const invalid of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82]]) {
    assert.equal(check(Uint8Array.from([...enc('{"baselineId":"'), ...invalid, ...enc('"}')])), false);
  }
});

test('control observation admission is a private denied companion with real narrow keys', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = (source: string, name: string) => {
    const parts = source.split(`CREATE TABLE public."${name}" (`);
    assert.equal(parts.length, 2, name);
    return parts[1].split('\n);')[0];
  };
  const admission = table(sql, 'Pro273ControlPlaneObservationAdmission');
  for (const [source, name, key] of [
    [supplier, 'Pro262CapacityObserverInputClaim', '"inputClaimId" TEXT PRIMARY KEY'],
    [sql, 'Pro273ControlPlaneObservationBinding', '"reservationId" TEXT PRIMARY KEY'],
    [supplier, 'Pro262CapacityTrust', 'PRIMARY KEY ("trustId","generation")'],
    [supplier, 'Pro262CapacityControlCharge', 'PRIMARY KEY ("kind","eventKey")'],
  ]) assert.ok(table(source, name).includes(key), name);
  for (const edge of [
    '"inputClaimId" TEXT PRIMARY KEY REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId")',
    '"reservationId" TEXT NOT NULL UNIQUE REFERENCES public."Pro273ControlPlaneObservationBinding"("reservationId")',
    'FOREIGN KEY ("issuerTrustId","issuerTrustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation")',
    'FOREIGN KEY ("chargeKind","chargeEventKey") REFERENCES public."Pro262CapacityControlCharge"("kind","eventKey")',
  ]) assert.ok(admission.includes(`${edge} ON UPDATE RESTRICT ON DELETE RESTRICT`), edge);
  assert.equal((admission.match(/\bREFERENCES\b/g) || []).length, 4);
  assert.ok(admission.includes('UNIQUE ("chargeKind","chargeEventKey")'));
  for (const [field, type] of Object.entries({ issuerTrustId: 'TEXT', issuerTrustGeneration: 'BIGINT', issuerTrustRecordHash: 'TEXT', issuerPrincipalOid: 'OID', issuerPrincipalName: 'NAME', issuerBackendPid: 'INTEGER', issuerBackendStart: 'TIMESTAMPTZ', qualificationHash: 'TEXT', chargeKind: 'TEXT', chargeEventKey: 'TEXT', chargeBindingHash: 'TEXT', creationTransactionId: 'xid8' })) {
    assert.ok(admission.includes(`"${field}" ${type} NOT NULL`), field);
  }
  for (const field of ['inputClaimId', 'reservationId', 'issuerTrustId', 'chargeKind', 'chargeEventKey']) assert.ok(admission.includes(`octet_length("${field}") BETWEEN 1 AND 256`), field);
  assert.ok(admission.includes('octet_length("issuerPrincipalName"::TEXT) BETWEEN 1 AND 256'));
  for (const field of ['issuerTrustRecordHash', 'qualificationHash', 'chargeBindingHash']) assert.ok(admission.includes(`"${field}" ~ '^[a-f0-9]{64}$'`), field);
  for (const field of ['issuerTrustGeneration', 'issuerPrincipalOid', 'issuerBackendPid']) assert.ok(admission.includes(`"${field}">0`), field);
  const fn = 'pro273_control_observation_admission_deny_insert';
  const body = sql.split(`CREATE FUNCTION public.${fn}()`)[1].split('END $$;')[0];
  assert.match(body, /LANGUAGE plpgsql SET search_path=pg_catalog AS \$\$\s*BEGIN\s+NEW\."creationTransactionId":=pg_catalog\.pg_current_xact_id\(\);\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.ok(sql.includes(`BEFORE INSERT ON public."Pro273ControlPlaneObservationAdmission" FOR EACH ROW EXECUTE FUNCTION public.${fn}()`));
  assert.ok(sql.includes('BEFORE UPDATE OR DELETE ON public."Pro273ControlPlaneObservationAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro273_control_observation_deny_mutation()'));
  assert.match(sql.split('CREATE FUNCTION public.pro273_control_observation_deny_mutation()')[1].split('END $$;')[0], /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  for (const [kind, name] of [['TABLE', '"Pro273ControlPlaneObservationAdmission"'], ['FUNCTION', `${fn}()`]]) {
    assert.ok(roles.includes(`ALTER ${kind} public.${name} OWNER TO pro262_capacity_owner;`));
    assert.ok(sql.includes(`REVOKE ALL ON ${kind} public.${name} FROM PUBLIC;`));
    const revoke = roles.split(`REVOKE ALL ON ${kind} public.${name} FROM `)[1].split(';')[0].split(',');
    assert.deepEqual(revoke, ['PUBLIC', 'pro273_selection_owner', 'pro273_install_bootstrap', 'pro273_primitive_publisher', 'pro273_qualification_allocator', 'pro262_control_allocator', 'pro262_install_observer', 'pro262_qualification_publisher', 'huroof_pg_runtime', 'huroof_pg_service_executor', 'huroof_pg_executor', 'enta_runtime', 'enta_gameplay_runtime', 'enta_outbox_worker']);
    assert.doesNotMatch(sql + roles, new RegExp(`GRANT[^;]*${name.replace(/[()]/g, '\\$&')}`, 'i'));
  }
  assert.match(sql, /COALESCE\(p_record->>'targetKind',''\) NOT IN \('REPLAY','PRODUCER','QUALIFIER_CONTROL','INSTALLER_ROOT'\)/);
  assert.match(supplier, /COALESCE\(p_record->>'targetKind',''\) NOT IN \('REPLAY','PRODUCER'\)/);
  assert.doesNotMatch(sql + supplier, /p_record->>'targetKind'\s*=\s*'CONTROL_PLANE'/);
});

test('denied admission candidate joins one protected claim and binding tuple', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_admission_deny_insert()')[1].split('END $$;')[0];
  const [entry, candidate] = body.split('-- Unreachable tuple candidate only:');
  assert.match(entry, /NEW\."creationTransactionId":=pg_catalog\.pg_current_xact_id\(\);\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  for (const predicate of [
    'FROM public."Pro262CapacityObserverInputClaim" c',
    'slot."reservationId"=c."reservationId"', 'b."reservationId"=c."reservationId"',
    '(c."inputClaimId",c."reservationId")=(NEW."inputClaimId",NEW."reservationId")',
    '(base."baselineId",base."coreHash")=(b."baselineId",b."baselineCoreHash")',
    '(s."baselineId",s."sessionClaimId",s."attemptId")=(b."baselineId",b."sessionClaimId",b."attemptId")',
    '(a."baselineId",a."attemptId",a."receiverIdentity")=(s."baselineId",s."attemptId",s."receiverIdentity")',
    '(slot."observerTrustId",slot."observerTrustGeneration",slot."physicalIdentity",slot."physicalProofIdentity")=(b."trustId",b."trustGeneration",base."physicalIdentity",base."physicalProofIdentity")',
    '(s."principalOid",s."principalName",s."credentialEpoch",s."launchEpoch")=(base."principalOid",base."principalName",base."credentialEpoch",base."launchEpoch")',
    'slot."observerPrincipalOid" IS DISTINCT FROM s."principalOid"',
    '(c."phase",c."observerPrincipalOid",c."observerPrincipalName")=(slot."phase",slot."observerPrincipalOid",slot."observerPrincipalName")',
    `slot."phase"='INSTALL_PROCESS' AND slot."record"->>'targetKind'='CONTROL_PLANE'`,
    `(c."eventKey",slot."record"->>'expectedEventKey')=(b."expectedEventKey",b."expectedEventKey")`,
    `(slot."record"->>'targetControlKey',slot."record"->>'targetCredentialEpoch',slot."record"->>'targetLaunchEpoch')=(base."baselineId",s."credentialEpoch",s."launchEpoch")`,
    '(issuer."trustId",issuer."generation")=(NEW."issuerTrustId",NEW."issuerTrustGeneration")',
    '(issuer_boot."trustId",issuer_boot."generation",issuer_boot."recordHash")=(issuer."trustId",issuer."generation",NEW."issuerTrustRecordHash")',
    '(charge."kind",charge."eventKey",charge."bindingHash")=(NEW."chargeKind",NEW."chargeEventKey",NEW."chargeBindingHash")',
  ]) assert.ok(candidate.includes(predicate), predicate);
  for (const alias of ['b', 's', 'a']) assert.ok(candidate.includes(`${alias}."creationTransactionId" IS DISTINCT FROM NEW."creationTransactionId"`));
  for (const name of ['Pro273ControlPlaneObservationBinding', 'Pro273ControlPlaneSessionClaim', 'Pro273ControlPlaneLaunchAttempt']) {
    assert.match(sql.split(`CREATE TABLE public."${name}" (`)[1].split('\n);')[0], /"creationTransactionId" xid8 NOT NULL/);
  }
  const claim = supplier.split('CREATE TABLE public."Pro262CapacityObserverInputClaim" (')[1].split('\n);')[0];
  assert.doesNotMatch(claim, /TransactionId/);
  assert.match(supplier.split('CREATE TABLE public."Pro262CapacityBootstrapTrust" (')[1].split('\n);')[0], /"recordHash" TEXT NOT NULL/);
  // Inner joins and equality reject missing rows and NULL tuple members.
  assert.equal((candidate.match(/IF NOT EXISTS \(/g) || []).length, 1);
  assert.doesNotMatch(candidate, /\b(?:LEFT|RIGHT|FULL)\s+(?:OUTER\s+)?JOIN\b|\bCOALESCE\s*\(|\b(?:FOR\s+(?:UPDATE|SHARE)|LOCK\s+TABLE|RETURN|EXCEPTION WHEN)\b/i);
  assert.doesNotMatch(candidate, /(?:creationTransactionId|constructionTransactionId)"\s*[<>]|TG_TABLE_NAME|\bc\."\w*TransactionId"/);
  assert.match(candidate, /\) THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
});

test('denied admission candidate requires the closed issuer scope and matching protected values', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_admission_deny_insert()')[1].split('END $$;')[0];
  const candidate = body.split('-- Unreachable tuple candidate only:')[1];
  const fields = ['kind', 'reservationId', 'bindingCreationTransactionId', 'expectedInputClaimId', 'issuerPrincipalOid', 'issuerPrincipalName', 'issuerBackendPid', 'issuerBackendStart', 'issuerReceiverClosureHash', 'qualificationHash', 'chargeKind', 'chargeEventKey', 'chargeBindingHash'];
  assert.ok(candidate.includes(`jsonb_typeof(issuer."scope")='object'`));
  assert.ok(candidate.includes('jsonb_object_keys(issuer."scope"))=13'));
  assert.ok(candidate.includes(`issuer."scope" ?& ARRAY[${fields.map(field => `'${field}'`).join(',')}]`));
  assert.ok(candidate.includes(`jsonb_typeof(field.value) IS DISTINCT FROM 'string'`));
  assert.ok(candidate.includes('ELSE FALSE END'));
  const bindings: Record<string, string> = {
    kind: "'CONTROL_PLANE_OBSERVATION_ADMISSION'", reservationId: 'b."reservationId"',
    bindingCreationTransactionId: 'b."creationTransactionId"::TEXT', expectedInputClaimId: 'c."inputClaimId"',
    issuerPrincipalOid: 'NEW."issuerPrincipalOid"::TEXT', issuerPrincipalName: 'NEW."issuerPrincipalName"::TEXT',
    issuerBackendPid: 'NEW."issuerBackendPid"::TEXT',
    issuerBackendStart: `pg_catalog.to_char(NEW."issuerBackendStart" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    qualificationHash: 'NEW."qualificationHash"', chargeKind: 'NEW."chargeKind"',
    chargeEventKey: 'NEW."chargeEventKey"', chargeBindingHash: 'NEW."chargeBindingHash"',
  };
  // Each bound field has an exact comparison; NULL and non-string scope values
  // are excluded by the closed shape. The receiver hash is only shape checked.
  for (const [field, protectedValue] of Object.entries(bindings)) {
    assert.ok(candidate.includes(`issuer."scope"->>'${field}' IS NOT DISTINCT FROM ${protectedValue}`), field);
  }
  for (const field of ['bindingCreationTransactionId', 'issuerPrincipalOid', 'issuerBackendPid']) {
    assert.match(candidate, new RegExp(`issuer\\."scope"->>'${field}' ~ '\\^\\[1-9\\]\\[0-9\\]\\{0,\\d+\\}\\$'`));
  }
  assert.ok(candidate.includes(`issuer."scope"->>'issuerReceiverClosureHash' ~ '^[a-f0-9]{64}$'`));
  assert.ok(candidate.includes('NEW."issuerTrustGeneration">0 AND NEW."issuerPrincipalOid">0 AND NEW."issuerBackendPid">0'));
  for (const field of ['qualificationHash', 'chargeBindingHash']) assert.ok(candidate.includes(`NEW."${field}" ~ '^[a-f0-9]{64}$'`));
  assert.ok(candidate.includes('issuer_boot."principal" IS NOT DISTINCT FROM issuer."supplierPrincipal"'));
  assert.ok(candidate.includes('issuer_boot."channelId" IS NOT DISTINCT FROM issuer."channelId"'));
  assert.ok(candidate.includes('issuer."supplierPrincipal" IS NOT DISTINCT FROM NEW."issuerPrincipalName"'));
  assert.doesNotMatch(candidate, /issuer\."scope"->>[^\n]*::(?:NAME|OID|INTEGER|xid8|TIMESTAMPTZ)/i);
  assert.match(body, /pg_current_xact_id\(\);\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(candidate, /\) THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  assert.doesNotMatch(candidate, /\b(?:FOR\s+(?:UPDATE|SHARE)|LOCK\s+TABLE|RETURN|GRANT)\b/i);
});

test('issuer timestamp representation is guarded before exact UTC microsecond equality', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_admission_deny_insert()')[1].split('END $$;')[0];
  const guard = `AND CASE WHEN NEW."issuerBackendStart" IS NOT NULL AND pg_catalog.isfinite(NEW."issuerBackendStart")
      AND (NEW."issuerBackendStart" AT TIME ZONE 'UTC')>=TIMESTAMP '0001-01-01 00:00:00'
      AND (NEW."issuerBackendStart" AT TIME ZONE 'UTC')<TIMESTAMP '10000-01-01 00:00:00'
     THEN issuer."scope"->>'issuerBackendStart' IS NOT DISTINCT FROM pg_catalog.to_char(NEW."issuerBackendStart" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
     ELSE FALSE END`;
  assert.equal(body.split(guard).length, 2);
  assert.match(body, /pg_current_xact_id\(\);\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /\) THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);

  // Illustrative representation cases only; these do not execute PostgreSQL.
  const matches = (year: number | null, finite: boolean, formatted: string, scope: string) =>
    year !== null && finite && year >= 1 && year < 10000 && formatted === scope;
  for (const [year, finite, formatted, scope, expected] of [
    [-1, true, '0001-01-01T00:00:00.000000Z', '0001-01-01T00:00:00.000000Z', false], // BC
    [0, true, '0000-01-01T00:00:00.000000Z', '0000-01-01T00:00:00.000000Z', false],
    [10000, true, '10000-01-01T00:00:00.000000Z', '10000-01-01T00:00:00.000000Z', false],
    [null, false, 'infinity', 'infinity', false],
    [null, false, '-infinity', '-infinity', false],
    [2026, true, '2026-10-28T16:00:00.123456Z', '2026-10-28T16:00:00.123456Z', true],
    [2026, true, '2026-10-28T16:00:00.123456Z', '2026-10-28T16:00:00.123457Z', false],
    [2026, true, '2026-10-28T16:00:00.123456Z', '2026-10-28T16:00:00.123Z', false],
  ] as Array<[number | null, boolean, string, string, boolean]>) {
    assert.equal(matches(year, finite, formatted, scope), expected, scope);
  }
});

test('control observation association is private, bounded and deny-only source', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = (source: string, name: string) => {
    const parts = source.split(`CREATE TABLE public."${name}" (`);
    assert.equal(parts.length, 2, name);
    return parts[1].split('\n);')[0];
  };
  const binding = table(sql, 'Pro273ControlPlaneObservationBinding');
  const link = table(sql, 'Pro273ControlPlaneObservationLinkage');
  const targets: Array<[string, string, string]> = [
    [supplier, 'Pro262CapacityObserverInputReservation', '"reservationId" TEXT PRIMARY KEY'],
    [supplier, 'Pro262CapacityObserverInputClaim', '"inputClaimId" TEXT PRIMARY KEY'],
    [supplier, 'Pro262CapacityTrust', 'PRIMARY KEY ("trustId","generation")'],
    [supplier, 'Pro262CapacityControlCharge', 'PRIMARY KEY ("kind","eventKey")'],
    [sql, 'Pro273ControlPlaneBaseline', 'UNIQUE ("baselineId","coreHash")'],
    [sql, 'Pro273ControlPlaneLaunchAttempt', 'UNIQUE ("baselineId","attemptId")'],
    [sql, 'Pro273ControlPlaneSessionClaim', 'UNIQUE ("baselineId","sessionClaimId")'],
    [sql, 'Pro273ControlPlaneProcessObservation', '"sessionClaimId" TEXT PRIMARY KEY'],
  ];
  for (const [source, name, key] of targets) assert.ok(table(source, name).includes(key), `${name}: ${key}`);
  for (const edge of [
    'REFERENCES public."Pro262CapacityObserverInputReservation"("reservationId")',
    'FOREIGN KEY ("baselineId","baselineCoreHash") REFERENCES public."Pro273ControlPlaneBaseline"("baselineId","coreHash")',
    'FOREIGN KEY ("baselineId","sessionClaimId") REFERENCES public."Pro273ControlPlaneSessionClaim"("baselineId","sessionClaimId")',
    'FOREIGN KEY ("baselineId","attemptId") REFERENCES public."Pro273ControlPlaneLaunchAttempt"("baselineId","attemptId")',
    'FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation")',
    'FOREIGN KEY ("chargeKind","chargeEventKey") REFERENCES public."Pro262CapacityControlCharge"("kind","eventKey")',
  ]) assert.ok(binding.includes(`${edge} ON UPDATE RESTRICT ON DELETE RESTRICT`), edge);
  for (const edge of [
    'REFERENCES public."Pro273ControlPlaneProcessObservation"("sessionClaimId")',
    'REFERENCES public."Pro273ControlPlaneObservationBinding"("reservationId")',
    'REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId")',
    'FOREIGN KEY ("chargeKind","chargeEventKey") REFERENCES public."Pro262CapacityControlCharge"("kind","eventKey")',
  ]) assert.ok(link.includes(`${edge} ON UPDATE RESTRICT ON DELETE RESTRICT`), edge);
  for (const field of ['reservationId', 'baselineId', 'sessionClaimId', 'attemptId', 'expectedEventKey', 'trustId', 'chargeKind', 'chargeEventKey']) assert.ok(binding.includes(`octet_length("${field}") BETWEEN 1 AND 256`));
  for (const field of ['sessionClaimId', 'reservationId', 'inputClaimId', 'eventId', 'chargeKind', 'chargeEventKey']) assert.ok(link.includes(`octet_length("${field}") BETWEEN 1 AND 256`));
  assert.match(link, /octet_length\("evidenceBytes"\) BETWEEN 1 AND 1048576/);
  for (const body of [binding, link]) assert.match(body, /UNIQUE \("chargeKind","chargeEventKey"\)/);
  assert.match(binding, /"reservationId" TEXT PRIMARY KEY/);
  assert.match(link, /"sessionClaimId" TEXT PRIMARY KEY/);
  assert.match(link, /"observedAt" TIMESTAMPTZ NOT NULL/);
  assert.match(link, /"evidenceBytes" BYTEA NOT NULL/);
  assert.match(table(sql, 'Pro273ControlPlaneProcessObservation'), /"capturedBytes" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL/);
  for (const [name, fields] of [['Pro273ControlPlaneObservationBinding', ['sessionClaimId', 'expectedEventKey']], ['Pro273ControlPlaneObservationLinkage', ['reservationId', 'inputClaimId', 'eventId']]] as Array<[string, string[]]>) {
    const body = table(sql, name);
    for (const field of fields) assert.match(body, new RegExp(`"${field}" TEXT NOT NULL UNIQUE`));
    assert.ok(roles.includes(`ALTER TABLE public."${name}" OWNER TO pro262_capacity_owner;`));
    assert.ok(sql.includes(`BEFORE INSERT ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.pro273_control_observation_deny_insert()`));
    assert.ok(sql.includes(`BEFORE UPDATE OR DELETE ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.pro273_control_observation_deny_mutation()`));
  }
  const deny = sql.split('CREATE FUNCTION public.pro273_control_observation_deny_insert()')[1].split('END $$;')[0];
  assert.match(deny, /LANGUAGE plpgsql SET search_path=pg_catalog/);
  assert.match(deny, /NEW\."creationTransactionId":=pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(deny, /NEW\."constructionTransactionId":=pg_catalog\.pg_current_xact_id\(\)/);
  assert.match(deny, /END IF;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  assert.doesNotMatch(deny, /\bRETURN\b|EXCEPTION WHEN/i);
  const mutation = sql.split('CREATE FUNCTION public.pro273_control_observation_deny_mutation()')[1].split('END $$;')[0];
  assert.match(mutation, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  for (const fn of ['pro273_control_observation_deny_insert', 'pro273_control_observation_deny_mutation']) assert.ok(roles.includes(`ALTER FUNCTION public.${fn}() OWNER TO pro262_capacity_owner;`));
  for (const name of ['Pro273ControlPlaneObservationBinding', 'Pro273ControlPlaneObservationLinkage', 'pro273_control_observation_deny_insert', 'pro273_control_observation_deny_mutation']) {
    assert.match(roles, new RegExp(`REVOKE ALL ON (?:TABLE|FUNCTION) [^;]*${name}[^;]* FROM PUBLIC,[^;]*enta_outbox_worker;`));
    assert.doesNotMatch(sql + roles, new RegExp(`GRANT[^;]*${name}`, 'i'));
  }
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT[\s\S]*?RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'/);
  assert.match(roles, /^-- INCOMPLETE ROLE SOURCE[\s\S]*?RAISE EXCEPTION 'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE'/);
  assert.ok(sql.includes(`COALESCE(p_record->>'targetKind','') NOT IN ('REPLAY','PRODUCER','QUALIFIER_CONTROL','INSTALLER_ROOT')`));
  assert.doesNotMatch(sql, /p_record->>'targetKind'\s*=\s*'CONTROL_PLANE'/);
});

test('denied observation candidate compares the fixed protected tuples without locks', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_deny_insert()')[1].split('END $$;')[0];
  const entry = body.indexOf("RAISE EXCEPTION 'SELECTION_UNAVAILABLE';");
  const candidate = body.slice(entry + "RAISE EXCEPTION 'SELECTION_UNAVAILABLE';".length);
  assert.ok(entry > body.indexOf('pg_catalog.pg_current_xact_id()'));
  assert.equal((candidate.match(/IF NOT EXISTS \(/g) || []).length, 2);
  assert.doesNotMatch(candidate, /\b(?:FOR\s+(?:UPDATE|SHARE)|LOCK\s+TABLE|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(candidate, /(?:creationTransactionId|constructionTransactionId)"\s*[<>]/);
  for (const predicate of [
    '(s."baselineId",s."sessionClaimId",s."attemptId")=(NEW."baselineId",NEW."sessionClaimId",NEW."attemptId")',
    '(a."baselineId",a."attemptId",a."receiverIdentity")=(s."baselineId",s."attemptId",s."receiverIdentity")',
    '(s."principalOid",s."principalName",s."credentialEpoch",s."launchEpoch")=(base."principalOid",base."principalName",base."credentialEpoch",base."launchEpoch")',
    'exp."bootstrapKind"=prov."bootstrapKind"',
    "('CONTROL_PLANE_BASELINE',prov.\"baselineId\",prov.\"coreHash\",prov.\"evidenceHash\"",
    '(c."reservationId",c."inputClaimId",c."eventKey")=(b."reservationId",NEW."inputClaimId",b."expectedEventKey")',
    '(NEW."reservationId",NEW."sessionClaimId",NEW."eventId")=(b."reservationId",b."sessionClaimId",b."expectedEventKey")',
    '(o."sessionClaimId",o."inputClaimId")=(s."sessionClaimId",c."inputClaimId")',
    '(c."phase",c."observerPrincipalOid",c."observerPrincipalName")=(slot."phase",slot."observerPrincipalOid",slot."observerPrincipalName")',
    '(o."observerOid",o."observerPrincipal",o."trustId",o."trustGeneration")=(slot."observerPrincipalOid",slot."observerPrincipalName",b."trustId",b."trustGeneration")',
    '(charge."kind",charge."eventKey",charge."bindingHash")=(NEW."chargeKind",NEW."chargeEventKey",NEW."chargeBindingHash")',
    'b."creationTransactionId" IS DISTINCT FROM NEW."constructionTransactionId"',
    'FROM public."Pro273ControlPlaneObservationLinkage" l WHERE (l."chargeKind",l."chargeEventKey")=(NEW."chargeKind",NEW."chargeEventKey")',
    'FROM public."Pro273ControlPlaneObservationBinding" other WHERE (other."chargeKind",other."chargeEventKey")=(NEW."chargeKind",NEW."chargeEventKey")',
  ]) assert.ok(candidate.includes(predicate), predicate);
  for (const charge of [`'OBSERVER_INPUT_SLOT',slot."prepaidEventKey"`, 'a."chargeKind",a."chargeEventKey"', 'a."sessionChargeKind",a."sessionChargeEventKey"', 'prov."chargeKind",prov."chargeEventKey"']) {
    const exclusion = `(NEW."chargeKind",NEW."chargeEventKey") IS DISTINCT FROM (${charge})`;
    assert.equal(candidate.split(exclusion).length - 1, 2, exclusion);
  }
  // Inner joins and WHERE equality do not admit absent rows or NULL tuple members;
  // NOT EXISTS therefore denies them. Xids are NOT NULL and stamped by the trigger.
  assert.doesNotMatch(candidate, /\b(?:LEFT|RIGHT|FULL)\s+(?:OUTER\s+)?JOIN\b|\bCOALESCE\s*\(/i);
  for (const [name, xid] of [['Pro273ControlPlaneObservationBinding', 'creationTransactionId'], ['Pro273ControlPlaneObservationLinkage', 'constructionTransactionId']]) {
    const table = sql.split(`CREATE TABLE public."${name}" (`)[1].split('\n);')[0];
    assert.ok(table.includes(`"${xid}" xid8 NOT NULL`));
  }
  assert.match(candidate, /slot\."record"->>'expectedEventKey'\)=\(base\."baselineId",s\."credentialEpoch",s\."launchEpoch",NEW\."expectedEventKey"\)/);
  assert.match(candidate, /END IF;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
});

test('denied observation candidate binds the observer, target, event and known transaction identities', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_control_observation_deny_insert()')[1].split('END $$;')[0];
  const bindingGuard = `TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='Pro273ControlPlaneObservationBinding'`;
  const linkageGuard = `TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='Pro273ControlPlaneObservationLinkage'`;
  const [entry, candidate] = body.split('-- Unreachable candidate only.');
  for (const part of [entry, candidate]) {
    assert.match(part, new RegExp(`IF ${bindingGuard} THEN[\\s\\S]*ELSIF ${linkageGuard} THEN[\\s\\S]*ELSE\\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\\s+END IF;`));
  }
  assert.match(entry, /END IF;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  assert.match(candidate, /END IF;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  const binding = candidate.split(`IF ${bindingGuard} THEN`)[1].split(`ELSIF ${linkageGuard} THEN`)[0];
  const linkage = candidate.split(`ELSIF ${linkageGuard} THEN`)[1].split("\n ELSE\n  RAISE EXCEPTION")[0];
  for (const [branch, publicationXid] of [[binding, 'creationTransactionId'], [linkage, 'constructionTransactionId']]) {
    assert.ok(branch.includes('slot."observerPrincipalOid" IS DISTINCT FROM s."principalOid"'));
    assert.ok(branch.includes(`slot."record"->>'targetKind'='CONTROL_PLANE'`));
    assert.ok(branch.includes(`slot."phase"='INSTALL_PROCESS'`));
    for (const owner of ['s', 'a']) assert.ok(branch.includes(`${owner}."creationTransactionId" IS DISTINCT FROM NEW."${publicationXid}"`));
    assert.doesNotMatch(branch, /\bc\."\w*TransactionId"|\b(?:FOR\s+(?:UPDATE|SHARE)|LOCK\s+TABLE)\b/i);
  }
  assert.ok(linkage.includes(`(c."phase",c."eventKey")=(slot."phase",slot."record"->>'expectedEventKey')`));
  for (const name of ['Pro273ControlPlaneSessionClaim', 'Pro273ControlPlaneLaunchAttempt']) {
    assert.match(sql.split(`CREATE TABLE public."${name}" (`)[1].split('\n);')[0], /"creationTransactionId" xid8 NOT NULL/);
  }
  const claim = supplier.split('CREATE TABLE public."Pro262CapacityObserverInputClaim" (')[1].split('\n);')[0];
  for (const field of ['phase', 'eventKey']) assert.ok(claim.includes(`"${field}" TEXT NOT NULL`));
  assert.doesNotMatch(claim, /TransactionId/);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\. Installation remains prohibited under R6 STOP\./);
  assert.match(supplier, /COALESCE\(p_record->>'targetKind',''\) NOT IN \('REPLAY','PRODUCER'\)/);
  assert.doesNotMatch(sql + supplier, /p_record->>'targetKind'\s*=\s*'CONTROL_PLANE'/);
  // Source predicates and distinct xids prove neither prior claim/fence commitment,
  // charge concurrency safety, nor authorization; this test does not run SQL.
});

test('initial preinput target constraint requires a closed string identity and hashes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const receipt = sql.split('CREATE TABLE public."Pro273InitialPreinputReceipt" (')[1].split('\n);')[0];
  const constraint = receipt.split('CONSTRAINT "Pro273InitialPreinputReceipt_target_shape" CHECK (')[1].split('\n ),')[0];
  assert.ok(constraint.includes(`("target" - ARRAY['kind','bootstrapKind','expectedCoreHash','expectedEvidenceHash']::TEXT[]) = '{}'::JSONB`));
  for (const key of ['kind', 'bootstrapKind', 'expectedCoreHash', 'expectedEvidenceHash']) {
    assert.ok(constraint.includes(`pg_catalog.jsonb_typeof("target"->'${key}') IS NOT DISTINCT FROM 'string'`), key);
  }
  assert.ok(constraint.includes(`"target"->>'kind' IS NOT DISTINCT FROM 'INITIAL'`));
  assert.ok(constraint.includes(`COALESCE("target"->>'bootstrapKind','') <> ''`));
  for (const key of ['expectedCoreHash', 'expectedEvidenceHash']) {
    assert.ok(constraint.includes(`COALESCE("target"->>'${key}','') ~ '^[a-f0-9]{64}$'`), key);
  }
});

test('initial publication scaffold keeps original identities unique and every mutation denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const tableNames = ['Pro273InitialLayoutPublication', 'Pro273InitialBaselineLayoutBinding', 'Pro273InitialAllocationPublication'];
  const table = (name: string) => {
    const parts = sql.split(`CREATE TABLE public."${name}" (`);
    assert.equal(parts.length, 2, name);
    return parts[1].split('\n);')[0];
  };
  const layout = table(tableNames[0]), binding = table(tableNames[1]), allocation = table(tableNames[2]);
  assert.match(layout, /CONSTRAINT "Pro273InitialLayoutPublication_original_physical_key" UNIQUE \("physicalIdentity"\)/);
  assert.match(allocation, /CONSTRAINT "Pro273InitialAllocationPublication_original_allocation_key" UNIQUE \("allocationId"\)/);
  for (const [body, fields] of [[layout, ['inputClaimId', 'admissionReceiptId', 'eventId', 'baselineId', 'physicalIdentity', 'physicalProofIdentity']], [binding, ['baselineId', 'layoutInputClaimId']], [allocation, ['inputClaimId', 'admissionReceiptId', 'eventId', 'baselineId', 'layoutInputClaimId', 'allocationId']]] as const) {
    const bounds = [...body.matchAll(/octet_length\("([^"]+)"\) BETWEEN 1 AND 256/g)].map(m => m[1]);
    assert.deepEqual(bounds, fields);
  }
  assert.match(sql, /Every 256-byte bound in these three scaffold tables is provisional and\s+-- unqualified: it is not a published ABI or evidence of compatibility or\s+-- resource qualification\. A retry must read the original publication; no\s+-- writer is enabled/);
  for (const name of tableNames) {
    assert.ok(roles.includes(`ALTER TABLE public."${name}" OWNER TO pro262_capacity_owner;`), name);
    assert.ok(sql.includes(`CREATE TRIGGER "${name}_block_insert" BEFORE INSERT ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.pro273_initial_linkage_block_insert();`));
    assert.ok(sql.includes(`CREATE TRIGGER "${name}_immutable" BEFORE UPDATE OR DELETE ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.pro273_initial_linkage_immutable();`));
  }
  for (const fn of ['pro273_initial_linkage_block_insert', 'pro273_initial_linkage_immutable']) {
    const body = sql.split(`CREATE FUNCTION public.${fn}()`)[1].split('END $$;')[0];
    assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
    assert.doesNotMatch(body, /RETURN\s+NEW/i);
  }
  for (const gate of ['PRO273_SEL_ROLE_CLOSURE_INCOMPLETE', 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE']) {
    const index = roles.indexOf(`DO $$ BEGIN RAISE EXCEPTION '${gate}'; END $$;`);
    assert.ok(index >= 0 && index < roles.indexOf('ALTER FUNCTION public.pro273_initial_linkage_block_insert()'), gate);
  }
  const principals = 'PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker';
  assert.ok(roles.includes(`REVOKE ALL ON TABLE ${tableNames.map(name => `public."${name}"`).join(',')} FROM ${principals};`));
  for (const signature of ['pro273_initial_linkage_block_insert()', 'pro273_initial_linkage_immutable()', 'pro273_initial_verify_committed_layout(TEXT)', 'pro273_initial_verify_committed_allocation(TEXT)']) {
    assert.ok(roles.includes(`ALTER FUNCTION public.${signature} OWNER TO pro262_capacity_owner;`), signature);
    assert.doesNotMatch(roles, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[^;]*\\b${signature.replace(/[()]/g, '\\$&')}[^;]*;`, 'i'));
  }
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION public.pro273_initial_linkage_block_insert(),public.pro273_initial_linkage_immutable() FROM ${principals};`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION public.pro273_initial_verify_committed_layout(TEXT) FROM ${principals};`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION public.pro273_initial_verify_committed_allocation(TEXT) FROM ${principals};`));
});

test('descriptor denied discovery routes scalar keys through stored same-baseline history', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const discovery = entry.split('-- Denied discovery prototype only:')[1].split('v_projection:=ROW(')[0];
  assert.ok(discovery);
  for (const edge of [
    'a."controlId"=e."expectedTargetId"',
    '(ap."allocationId",ap."allocationCoreHash",ap."inputClaimId")=(a."allocationId",a."coreHash",a."inputClaimId")',
    'lp."inputClaimId"=l."inputClaimId"',
    '(l."physicalIdentity",l."physicalProofIdentity",l."coreHash")=(a."physicalIdentity",a."physicalProofIdentity",a."layoutCoreHash")',
    '(e."physicalIdentity",e."physicalProofIdentity",e."expectedFutureLayoutCoreHash")=(a."physicalIdentity",a."physicalProofIdentity",a."layoutCoreHash")',
    '(lb."baselineId",lb."baselineCoreHash",lb."layoutInputClaimId")=(ap."baselineId",ap."baselineCoreHash",ap."layoutInputClaimId")',
    'hist."bootstrapKind"=prov."bootstrapKind"',
    "('CONTROL_PLANE_BASELINE',prov.\"baselineId\",prov.\"coreHash\",prov.\"evidenceHash\",prov.\"sessionClaimId\"",
    "'INSTALLER_CONSTRUCTOR_INPUT'", "'INSTALLER_OBSERVATION'", `'OBSERVER_INPUT:'||cs."reservationId" AS constructor_bootstrap`, `'OBSERVER_INPUT:'||os."reservationId" AS observation_bootstrap`,
    'v_fact.low_hash IS DISTINCT FROM v_fact.high_hash',
    'v_fact.low_issuer IS DISTINCT FROM v_fact.high_issuer',
    'bt."principal"::TEXT=v_trust_candidates[v_candidate_index][4]',
    'o."observerOid" IS DISTINCT FROM e."installerOid"',
    'SELECT x.trust_id COLLATE "C" AS trust_id,x.generation FROM (VALUES',
    'SELECT x.kind COLLATE "C" AS kind,x.event_key COLLATE "C" AS event_key,pg_catalog.min(x.binding_hash COLLATE "C") AS low_hash,pg_catalog.max(x.binding_hash COLLATE "C") AS high_hash',
    'GROUP BY x.trust_id COLLATE "C",x.generation ORDER BY x.trust_id COLLATE "C",x.generation',
    'GROUP BY x.kind COLLATE "C",x.event_key COLLATE "C" ORDER BY x.kind COLLATE "C",x.event_key COLLATE "C"',
    'ORDER BY x.trust_id COLLATE "C",x.generation', 'ORDER BY x.kind COLLATE "C",x.event_key COLLATE "C"',
  ]) assert.ok(discovery.includes(edge), edge);
  for (const relation of ['Pro273InitialAllocationPublication','Pro273InitialLayoutPublication','Pro273ControlPlaneBaselineProvenance','Pro273InstallerDispatchAttempt','Pro273InstallerSessionClaim','Pro273InstallerDelivery','Pro273InstallerProcessObservation','Pro273InstallerSlotBinding','Pro262CapacityObserverInputClaim','Pro262CapacityObserverInputReservation','Pro262CapacityBootstrapTrust','Pro262CapacityControlCharge']) assert.ok(discovery.includes(`public."${relation}"`), relation);
  assert.doesNotMatch(discovery.replace('pg_catalog.octet_length(o."capturedBytes")', ''), /\bFOR\s+(?:UPDATE|SHARE)\b|\b(?:INSERT|UPDATE|DELETE)\b|\w+\.\*|\."(?:capturedBytes|evidenceBytes)"|\."(?:record|scope)"(?!->)|pro273_installer_\w+\s*\(/i);
  assert.match(discovery, /sorted deduplicated unions are unqualified inventory subsets/);
  assert.ok(discovery.indexOf('o."observerOid" IS DISTINCT FROM e."installerOid"') > discovery.indexOf('FOR v_key IN SELECT x.id'));
  assert.ok(discovery.indexOf('o."observerOid" IS DISTINCT FROM e."installerOid"') < discovery.indexOf('END LOOP;', discovery.indexOf('FOR v_key IN SELECT x.id')));
  assert.ok(entry.indexOf("RAISE EXCEPTION 'SELECTION_UNAVAILABLE';") < entry.indexOf('-- Denied discovery prototype only:'));
});

test('trust inventory leaves the original provisioner unresolved when subjects differ', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const provision = supplier.split('CREATE FUNCTION public.pro262_capacity_trust_provision(')[1].split('END $$;')[0];
  assert.ok(provision.includes('root."principal" IS DISTINCT FROM SESSION_USER::NAME'));
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const installer = entry.split('-- Preserve role occurrences before deduplication')[1].split(') AS x(trust_id,generation,expected_hash,issuer)')[0];
  const initial = entry.split('-- Six original INITIAL role occurrences')[1].split(') AS x(trust_id,generation,expected_hash,issuer)')[0];
  const installerRows = installer.split('FOR v_fact IN SELECT * FROM (VALUES')[1].trim().split('\n');
  const initialRows = initial.split('FOR v_fact IN SELECT * FROM (VALUES')[1].trim().split('\n');
  assert.equal(installerRows.length, 4);
  assert.equal(initialRows.length, 6);
  for (const row of [...installerRows, ...initialRows]) assert.match(row.trim(), /,NULL::TEXT\),?$/);
  assert.doesNotMatch(installer + initial, /SESSION_USER|installerName|publisher_name|baseline_publisher/);
  assert.ok(entry.includes('bt."recordHash"=v_trust_candidates[v_candidate_index][3]'));
  assert.ok(entry.includes('v_fact.low_hash IS DISTINCT FROM v_fact.high_hash'));
  assert.ok(entry.includes('it."supplierPrincipal"=r."principalName"'));
  assert.ok(entry.includes('ot."supplierPrincipal"=o."observerPrincipal"'));

  // Inert model: the provisioner, subject and observer are distinct; unknown
  // provenance does not impose equality, but sourced hashes still must match.
  const bootstrap = { principal: 'original-provisioner', recordHash: 'a'.repeat(64) };
  const subject = 'publisher-subject';
  const observer = 'observer-subject';
  assert.equal(new Set([bootstrap.principal, subject, observer]).size, 3);
  const matches = (expectedHash: string, provisioner: string | null) =>
    bootstrap.recordHash === expectedHash && (provisioner === null || bootstrap.principal === provisioner);
  assert.equal(matches('a'.repeat(64), null), true);
  assert.equal(matches('b'.repeat(64), null), false);
  assert.equal(matches('a'.repeat(64), subject), false);
});

test('descriptor INITIAL discovery follows distinct stored publication input chains', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const discovery = entry.split('-- Denied discovery prototype only:')[1].split('v_projection:=ROW(')[0];
  const history = discovery.split('-- Follow the original publication claims separately;')[1];
  for (const relation of ['Pro273InitialPreinputReceipt','Pro273ControlPlaneInputClaim','Pro273ControlPlaneInputBinding','Pro262CapacityObserverInputClaim','Pro262CapacityObserverInputReservation','Pro273ControlPlaneBaseline','Pro273ControlPlaneBaselineProvenance','Pro273ControlPlaneSessionClaim','Pro273ControlPlaneLaunchAttempt','Pro273ControlPlaneProcessObservation','Pro273ControlPlaneInputReceipt','Pro273PublisherTrustProvenance']) assert.ok(history.includes(`public."${relation}"`), relation);
  for (const edge of [
    'v_route.layout_claim=v_route.allocation_claim', "('LAYOUT',v_route.layout_claim", "('ALLOCATION',v_route.allocation_claim",
    'ap."eventId"=a."eventId"', 'lp."eventId"',
    '(r."inputClaimId",r."receiptId",r."eventId",r."baselineId",r."baselineCoreHash",r."sessionClaimId")=(v_key.claim_id,v_key.admission_id,v_key.event_id,v_route.baseline_id,v_route.baseline_hash,v_key.session_id)',
    '(slot."observerPrincipalOid",slot."observerPrincipalName")=(r."principalOid",r."principalName")',
    '(cc."observerPrincipalOid",cc."observerPrincipalName")=(o."observerOid",o."observerPrincipal")',
    'o."observerOid" IS DISTINCT FROM r."principalOid"',
    'slot."record"->>\'expectedEventKey\'=ic."eventKey"', 'cs."record"->>\'expectedEventKey\'=cc."eventKey"',
    'c."inputClaimId"=v_route.baseline_input_claim',
    '(tp."trustId",tp."generation",tp."recordHash")=(v_key.trust_id,v_key.generation,v_key.trust_hash)',
    '(cap."capturedHash",cap."operationReceipt")=(v_key.capture_hash,v_key.receipt_hash)',
    "('OBSERVER_INPUT_SLOT',v_history.input_prepaid,v_history.input_slot_hash)",
    "('OBSERVER_INPUT_SLOT',v_history.capture_prepaid,v_history.capture_slot_hash)",
    'v_fact.low_hash IS DISTINCT FROM v_fact.high_hash',
  ]) assert.ok(discovery.includes(edge), edge);
  assert.match(history, /INTO STRICT v_history/);
  assert.doesNotMatch(history.replace('pg_catalog.octet_length(o."capturedBytes")', ''), /SESSION_USER|\bFOR\s+(?:UPDATE|SHARE)\b|\w+\.\*|\."(?:capturedBytes|evidenceBytes)"|\."(?:record|scope)"(?!->)/i);
  // The reviewed routing inventory requires these four scalar fields for both
  // original receipt, claim and binding. Extraction may still detoast JSONB: this
  // source assertion does not qualify its resource cost or enable discovery.
  let projected = history.split('INTO STRICT v_history')[0];
  for (const alias of ['r', 'c', 'b']) for (const key of ['kind', 'bootstrapKind', 'expectedCoreHash', 'expectedEvidenceHash']) {
    const expression = `${alias}."target"->>'${key}'`;
    assert.equal(projected.split(expression).length, 2, expression);
    projected = projected.replace(expression, '');
  }
  assert.doesNotMatch(projected, /\."target"|\b(?:JSONB?|BYTEA)\b/i);
  for (const missing of ['retained/locked charge inventory','complete combined bootstrap/trust and','capacity ControlBaseline inventories','descriptor post-lock reread','qualified bounds, issuer/fence/currentness and ordered locking','full reservation-record validation']) assert.ok(history.includes(missing), missing);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\. Installation remains prohibited under R6 STOP\.[\s\S]*?DO \$\$ BEGIN RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'; END \$\$;/);
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA) FROM PUBLIC;'));
  assert.doesNotMatch(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*pro273_qualifier_reserve_control\s*\(TEXT\s*,\s*BYTEA\)/i);
});

test('descriptor prelock presence snapshot classifies only complete six-row sets', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const snapshot = entry.split('-- Fixed presence snapshot keyed only by the selected control ID.')[1].split('-- These sorted deduplicated unions')[0];
  const queries = [...snapshot.matchAll(/EXISTS \(SELECT 1 FROM public\."([^"]+)" (\w+) WHERE ([^)]+)\)/g)];
  assert.deepEqual(queries.map(q => [q[1], q[3]]), [
    ['Pro273QualificationInputDescriptor', 'd."controlId"=v_route.control_id'],
    ['Pro273QualifierDescriptorProvenance', 'p."controlId"=v_route.control_id'],
    ['Pro273QualifierDescriptorLinkage', 'l."controlId"=v_route.control_id'],
    ['Pro273QualifierDescriptorProof', 'q."controlId"=v_route.control_id'],
    ['Pro273QualificationInputState', 'st."controlId"=v_route.control_id'],
    ['Pro273QualificationTransitionReceipt', 't."controlId"=v_route.control_id AND t."transitionOrdinal"=1'],
  ]);
  assert.match(snapshot, /v_descriptor_presence=ARRAY\[FALSE,FALSE,FALSE,FALSE,FALSE,FALSE\] THEN\s*v_descriptor_present:=FALSE;\s*ELSIF v_descriptor_presence=ARRAY\[TRUE,TRUE,TRUE,TRUE,TRUE,TRUE\] THEN\s*v_descriptor_present:=TRUE;[\s\S]*?ELSE RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;/);
  assert.doesNotMatch(snapshot, /capturedBytes|evidenceBytes|\b(?:INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE)\b/i);
  assert.ok(entry.includes('-- Fixed presence snapshot'));
  assert.ok(constructor.indexOf('pro273_qualifier_discover(p_expectation_id)') < constructor.indexOf('SELECT g."physicalIdentity"'));
  assert.ok(constructor.indexOf('pro273_qualifier_discover(p_expectation_id)') < constructor.indexOf('PERFORM public.pro273_installer_assert_committed_delivery'));
  assert.match(snapshot, /re-read all six and validate exact identities using the existing checks/);
  assert.match(constructor, /JOIN public\."Pro273QualificationTransitionReceipt" t ON \(t\."controlId",t\."transitionOrdinal"\)=\(d\."controlId",1\)/);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\. Installation remains prohibited under R6 STOP\./);
  // Inert truth table: models the asserted SQL predicates, without executing SQL.
  const classify = (bits: boolean[]) => bits.every(Boolean) ? 'present' : bits.every(bit => !bit) ? 'absent' : 'denied';
  for (let mask = 0; mask < 64; mask++) {
    const bits = Array.from({ length: 6 }, (_, i) => Boolean(mask & (1 << i)));
    assert.equal(classify(bits), mask === 0 ? 'absent' : mask === 63 ? 'present' : 'denied', `mask ${mask}`);
  }
  const hasFirst = (ordinals: number[]) => ordinals.includes(1);
  assert.equal(hasFirst([2, 3]), false);
  assert.equal(hasFirst([1, 2, 3]), true);
});

test('descriptor historical slot and trust facts bind original identities only', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const history = entry.split('-- Follow the original publication claims separately;')[1].split('v_projection:=ROW(')[0];
  for (const fact of [
    `(sb."kind",sb."recordHash",sb."evidenceHash")=('OBSERVER_INPUT:'||slot."reservationId",slot."recordHash",slot."baselineAllocationProof")`,
    `(cb."kind",cb."recordHash",cb."evidenceHash")=('OBSERVER_INPUT:'||cs."reservationId",cs."recordHash",cs."baselineAllocationProof")`,
    `(ibt."trustId",ibt."generation",ibt."recordHash")=(it."trustId",it."generation",tp."recordHash")`,
    `(obt."trustId",obt."generation")=(ot."trustId",ot."generation")`,
    `cc."phase"='INSTALL_PROCESS'`, `it."purpose"='QUALIFIER_BASELINE_PUBLISHER'`, `ot."purpose"='INSTALL_OBSERVATION'`,
    `it."scope"->'target' IS NOT DISTINCT FROM c."target"`, `ot."scope"->>'observerHolderId'=cs."baselineAllocationProof"`,
    `slot."record"->>'targetControlKey'`, `cs."record"->>'targetControlKey'`,
    `slot."record"->>'observerBackendPid'`, `slot."record"->>'observerBackendStart'`,
    'not issuer or original provisioning authentication',
  ]) assert.ok(history.includes(fact), fact);
  for (const alias of ['ibt', 'obt']) assert.doesNotMatch(history, new RegExp(`${alias}\\."principal"`));
  for (const alias of ['sb', 'cb']) assert.doesNotMatch(history, new RegExp(`${alias}\\."publisherPrincipal"`));
  // Inert examples illustrate represented comparisons; they do not execute SQL.
  const original = { target: 'baseline-a', epoch: 'old', event: 'event-a', supplier: 'observer-a', observer: 'observer-a', provisioner: 'provisioner-b' };
  const matches = (x: typeof original) => x.target === original.target && x.epoch === original.epoch && x.event === original.event && x.supplier === x.observer && x.supplier === original.supplier;
  assert.equal(matches({ ...original }), true);
  assert.equal(matches({ ...original, provisioner: 'provisioner-c' }), true);
  for (const changed of [{ target: 'baseline-b' }, { epoch: 'current' }, { event: 'event-b' }, { supplier: 'observer-b' }, { observer: 'observer-b' }]) assert.equal(matches({ ...original, ...changed }), false);
});

test('descriptor INITIAL history binds complete protected targets to each original route', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const discovery = entry.split('-- Denied discovery prototype only:')[1].split('v_projection:=ROW(')[0];
  for (const term of [
    'l."coreHash" AS layout_hash,l."evidenceHash" AS layout_evidence,a."evidenceHash" AS allocation_evidence',
    `'SELECTION_QUALIFIER_LAYOUT:'||v_route.physical_id,v_route.layout_hash,v_route.layout_evidence`,
    `'SELECTION_QUALIFIER_ALLOCATION:'||v_route.allocation_id,v_route.allocation_hash,v_route.allocation_evidence`,
    'r."target" IS NOT DISTINCT FROM c."target" AND r."target" IS NOT DISTINCT FROM b."target"',
    `c."target"->>'kind'='INITIAL' AND c."target"->>'bootstrapKind'=v_key.target_bootstrap`,
    `c."target"->>'expectedCoreHash'=v_key.target_core AND c."target"->>'expectedEvidenceHash'=v_key.target_evidence`,
    'exact raw', 'canonical hash, prior-xid and authentication checks', 'funding and lock qualification',
  ]) assert.ok(discovery.includes(term), term);
  // Illustrative vectors only: SQL execution and qualification remain prohibited.
  const layout = { kind: 'INITIAL', bootstrapKind: 'SELECTION_QUALIFIER_LAYOUT:physical', expectedCoreHash: 'layout-core', expectedEvidenceHash: 'layout-evidence' };
  const allocation = { kind: 'INITIAL', bootstrapKind: 'SELECTION_QUALIFIER_ALLOCATION:allocation', expectedCoreHash: 'allocation-core', expectedEvidenceHash: 'allocation-evidence' };
  const equal = (a: object, b: object) => assert.deepEqual(a, b);
  equal(layout, { ...layout });
  for (const altered of [allocation, { ...layout, expectedCoreHash: allocation.expectedCoreHash }, { ...layout, expectedEvidenceHash: allocation.expectedEvidenceHash }, { ...layout, extra: 'unexpected' }]) {
    assert.throws(() => equal(layout, altered));
  }
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
});

test('descriptor bounded charge candidates cover every fixed route and reject omissions and conflicts', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const installer = entry.split('-- Seven facts per E/H route:')[1].split('-- Original provisioning requires')[0];
  const history = entry.split('-- The protected joins compare the publication')[1].split('FOR v_fact IN SELECT x.kind COLLATE')[0];
  const installerFacts = ['v_installer."chargeBindingHash"', 'v_installer.observation_charge_hash', 'v_installer.dispatch_charge_hash', 'v_installer.session_charge_hash', 'v_installer.delivery_charge_hash', 'v_installer.constructor_slot_hash', 'v_installer.observation_slot_hash'];
  const historyFacts = ['v_history."chargeBindingHash"', 'v_history.baseline_charge_hash', 'v_history.launch_charge_hash', 'v_history."sessionChargeBindingHash"', 'v_history.publisher_charge_hash', 'v_history.input_slot_hash', 'v_history.capture_slot_hash'];
  for (const [body, facts] of [[installer, installerFacts], [history, historyFacts]] as const) {
    const values = body.split('(VALUES')[1].split(') AS x(kind,event_key,binding_hash')[0];
    assert.equal((values.match(/^\s*\(/gm) || []).length, 7);
    for (const fact of facts) assert.ok(values.includes(fact), fact);
    assert.ok(body.indexOf("!~ '^[a-f0-9]{64}$'") < body.indexOf('array_cat(v_charge_candidates'));
  }
  for (const term of [
    '(c."chargeKind",c."chargeEventKey",c."chargeBindingHash")=(v_key.charge_kind,v_key.charge_event,v_key.charge_hash)',
    'r."chargeKind",r."chargeEventKey",r."chargeBindingHash"',
    'b."chargeKind",b."chargeEventKey",b."chargeBindingHash"',
    "v_history.publisher_charge_event IS DISTINCT FROM v_key.trust_id||':'||v_key.generation::TEXT",
    'array_length(v_charge_candidates,1) IS DISTINCT FROM 28',
    'v_fact.low_hash IS DISTINCT FROM v_fact.high_hash',
    'array_cat(v_charge_inventory,ARRAY[[v_fact.kind,v_fact.event_key,v_fact.low_hash]])',
    'retained/locked charge inventory',
  ]) assert.ok(entry.includes(term), term);
  assert.ok(entry.indexOf('v_fact.low_hash IS DISTINCT FROM v_fact.high_hash') < entry.indexOf('array_cat(v_charge_inventory'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.ok(sql.includes('Installation remains prohibited under R6 STOP'));

  // Inert vectors exercise the expected inventory rules; they do not execute SQL.
  type Fact = readonly [string, string, string];
  const raw: Fact[] = Array.from({ length: 28 }, (_, i) => ['kind', `event-${i}`, 'a'.repeat(64)] as const);
  const collect = (facts: readonly Fact[]) => {
    if (facts.length !== 28) throw new Error('omission');
    const out = new Map<string, string>();
    for (const [kind, event, hash] of facts) {
      if (!kind || !event || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('invalid');
      const key = JSON.stringify([kind, event]);
      if (out.has(key) && out.get(key) !== hash) throw new Error('conflict');
      out.set(key, hash);
    }
    return out;
  };
  assert.equal(collect(raw).size, 28);
  assert.throws(() => collect(raw.slice(1)), /omission/);
  const duplicate = raw.slice(); duplicate[27] = raw[0];
  assert.equal(collect(duplicate).size, 27);
  duplicate[27] = [raw[0][0], raw[0][1], 'b'.repeat(64)];
  assert.throws(() => collect(duplicate), /conflict/);
  duplicate[27] = [raw[0][0], raw[0][1], ''];
  assert.throws(() => collect(duplicate), /invalid/);
});

test('descriptor derives exact distinct accounting baseline kinds from validated charges and stays denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const kinds = entry.split('-- Derive only exact kind keys')[1].split('-- These sorted deduplicated unions')[0];
  for (const term of [
    'SELECT v_charge_candidates[i][1] COLLATE "C" AS kind',
    'FROM pg_catalog.generate_subscripts(v_charge_candidates,1) AS indexes(i)',
    'GROUP BY v_charge_candidates[i][1] COLLATE "C"',
    'ORDER BY v_charge_candidates[i][1] COLLATE "C"',
    'FROM public."Pro262CapacityControlBaseline" cb',
    'cb."kind" COLLATE "C"=v_fact.kind COLLATE "C"',
    "THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'",
    'array_cat(v_control_baseline_inventory,ARRAY[[v_fact.kind]])',
  ]) assert.ok(kinds.includes(term), term);
  assert.ok(entry.indexOf('array_length(v_charge_candidates,1) IS DISTINCT FROM 28') < entry.indexOf('-- Derive only exact kind keys'));
  assert.ok(entry.indexOf('v_fact.low_hash IS DISTINCT FROM v_fact.high_hash', entry.indexOf('-- Compare hashes across every route')) < entry.indexOf('-- Derive only exact kind keys'));
  assert.ok(kinds.indexOf('INTO STRICT v_snapshot_baseline') < kinds.indexOf('array_cat(v_control_baseline_inventory'));
  assert.doesNotMatch(kinds, /FOR\s+(?:UPDATE|SHARE)/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.ok(sql.includes('Installation remains prohibited under R6 STOP'));
  assert.ok(entry.includes('capacity ControlBaseline inventories and accounting locks'));
  assert.ok(entry.includes('accounting expiry checks and qualification remain missing'));

  // Illustrative byte-exact vectors, not SQL execution or qualification.
  type Fact = readonly [string, string, string];
  const facts: Fact[] = Array.from({ length: 28 }, (_, i) => [i % 2 ? 'kind' : 'Kind', `event-${i}`, 'a'.repeat(64)] as const);
  const collect = (input: readonly Fact[], baselines: readonly string[]) => {
    if (input.length !== 28) throw new Error('omission');
    const charges = new Map<string, string>();
    for (const [kind, event, hash] of input) {
      const key = JSON.stringify([kind, event]);
      if (charges.has(key) && charges.get(key) !== hash) throw new Error('conflict');
      charges.set(key, hash);
    }
    const kinds = [...new Set(input.map(([kind]) => kind))].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (kinds.some(kind => !baselines.includes(kind))) throw new Error('missing baseline');
    return kinds;
  };
  assert.deepEqual(collect(facts, ['kind', 'Kind']), ['Kind', 'kind']);
  assert.throws(() => collect(facts, ['kind']), /missing baseline/);
  assert.throws(() => collect(facts.slice(1), ['kind', 'Kind']), /omission/);
  const duplicate = facts.slice(); duplicate[27] = facts[0];
  assert.deepEqual(collect(duplicate, ['Kind', 'kind']), ['Kind', 'kind']);
  duplicate[27] = [facts[0][0], facts[0][1], 'b'.repeat(64)];
  assert.throws(() => collect(duplicate, ['Kind', 'kind']), /conflict/);
});

test('descriptor fixed trust and bootstrap candidates retain roles, aliases and conflicts before deduplication', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const installer = entry.split('-- Preserve role occurrences before deduplication')[1].split('-- Seven facts per E/H route')[0];
  const initial = entry.split('-- Six original INITIAL role occurrences')[1].split('-- The protected joins compare')[0];
  for (const term of ['v_installer."trustId"', 'v_installer.observation_trust', 'v_installer.constructor_trust', 'v_installer.slot_trust', 'v_installer."bootstrapKind"', 'v_installer.constructor_bootstrap', 'v_installer.observation_bootstrap', 'v_route.historical_trust_hash']) assert.ok(installer.includes(term), term);
  for (const term of ['v_key.trust_id', 'v_history.baseline_trust', 'v_history.binding_trust', 'v_history.input_slot_trust', 'v_history.observer_trust', 'v_history.capture_slot_trust', 'v_route.layout_bootstrap', 'v_route.allocation_bootstrap', 'v_history.input_bootstrap', 'v_history.capture_bootstrap']) assert.ok(initial.includes(term), term);
  for (const term of [
    '(prov."bootstrapRecordHash",prov."bootstrapEvidenceHash")=(hist."expectedCoreHash",hist."expectedEvidenceHash")',
    'prov."trustRecordHash" AS historical_trust_hash',
    'array_length(v_trust_candidates,1) IS DISTINCT FROM 20',
    'array_length(v_bootstrap_candidates,1) IS DISTINCT FROM 12',
    'octet_length(v_route.physical_id) NOT BETWEEN 1 AND 256',
    'octet_length(v_route.allocation_id) NOT BETWEEN 1 AND 256',
    'octet_length(v_route.baseline_id) NOT BETWEEN 1 AND 256',
    'octet_length(v_route.control_id) NOT BETWEEN 1 AND 256',
    'octet_length(v_history.capture_slot) NOT BETWEEN 1 AND 256',
    'octet_length(v_bootstrap_candidates[v_candidate_index][1]) NOT BETWEEN 1 AND 288',
    'v_fact.low_hash IS DISTINCT FROM v_fact.high_hash',
    'v_fact.low_record IS DISTINCT FROM v_fact.high_record',
    'v_fact.low_evidence IS DISTINCT FROM v_fact.high_evidence',
    'v_fact.low_publisher IS DISTINCT FROM v_fact.high_publisher',
    'v_bootstrap_trust_inventory:=pg_catalog.array_cat',
    'b."recordHash"=v_bootstrap_candidates[v_candidate_index][2]',
    'bt."recordHash"=v_trust_candidates[v_candidate_index][3]',
  ]) assert.ok(entry.includes(term), term);
  assert.ok(entry.indexOf('FOR v_candidate_index IN 1..20') < entry.indexOf('GROUP BY v_trust_candidates'));
  assert.ok(entry.indexOf('FOR v_candidate_index IN 1..12') < entry.indexOf('GROUP BY v_bootstrap_candidates'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.ok(sql.includes('Installation remains prohibited under R6 STOP'));

  // Inert vectors model candidate accounting; they do not execute or qualify SQL.
  type Fact = readonly [string, string, string | null];
  const collect = (facts: readonly Fact[], count: number) => {
    if (facts.length !== count) throw new Error('omission');
    const out = new Map<string, string | null>();
    for (const [key, value, hash] of facts) {
      if (!key || !value || (hash !== null && !/^[a-f0-9]{64}$/.test(hash))) throw new Error('invalid');
      const k = JSON.stringify([key, value]); const prior = out.get(k);
      if (prior && hash && prior !== hash) throw new Error('conflict');
      out.set(k, hash ?? prior ?? null);
    }
    return out;
  };
  const facts: Fact[] = Array.from({ length: 20 }, (_, i) => [`trust-${i}`, '1', 'a'.repeat(64)] as const);
  assert.equal(collect(facts, 20).size, 20);
  assert.throws(() => collect(facts.slice(1), 20), /omission/);
  const aliases = facts.slice(); aliases[19] = facts[0];
  assert.equal(collect(aliases, 20).size, 19);
  aliases[19] = [facts[0][0], '1', 'b'.repeat(64)];
  assert.throws(() => collect(aliases, 20), /conflict/);
  aliases[19] = ['', '1', null];
  assert.throws(() => collect(aliases, 20), /invalid/);
  type Baseline = readonly [string, string, string];
  const baseline = (rows: readonly Baseline[]) => {
    if (rows.length !== 12) throw new Error('omission');
    const out = new Map<string, string>();
    for (const [key, record, evidence] of rows) {
      if (!key || Buffer.byteLength(key) > 288 || !/^[a-f0-9]{64}$/.test(record) || !/^[a-f0-9]{64}$/.test(evidence)) throw new Error('invalid');
      const value = JSON.stringify([record, evidence]);
      if (out.has(key) && out.get(key) !== value) throw new Error('conflict');
      out.set(key, value);
    }
    return out;
  };
  const baselines: Baseline[] = Array.from({ length: 12 }, (_, i) => [`baseline-${i}`, 'a'.repeat(64), 'b'.repeat(64)] as const);
  assert.equal(baseline(baselines).size, 12);
  assert.throws(() => baseline(baselines.slice(1)), /omission/);
  const baselineAliases = baselines.slice(); baselineAliases[11] = baselines[0];
  assert.equal(baseline(baselineAliases).size, 11);
  baselineAliases[11] = [baselines[0][0], 'c'.repeat(64), baselines[0][2]];
  assert.throws(() => baseline(baselineAliases), /conflict/);
  baselineAliases[11] = [baselines[0][0], baselines[0][1], 'c'.repeat(64)];
  assert.throws(() => baseline(baselineAliases), /conflict/);
  baselineAliases[11] = ['x'.repeat(288), baselines[0][1], baselines[0][2]];
  assert.equal(baseline(baselineAliases).size, 12);
  baselineAliases[11] = ['x'.repeat(289), baselines[0][1], baselines[0][2]];
  assert.throws(() => baseline(baselineAliases), /invalid/);
});

test('trust prelock retains bounded typed source facts for each role before alias deduplication', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const snapshot = entry.split('FOR v_candidate_index IN 1..20 LOOP')[1].split('FOR v_fact IN SELECT v_trust_candidates[i][1]')[0];
  const tables = [
    ['Pro262CapacityTrust', 't', {trustId:'trust_id',generation:'generation',issuer:'issuer',supplierPrincipal:'supplier',channelId:'channel',verifierKeyId:'verifier_key',trustRootId:'trust_root',policyRevision:'policy_revision',policyHash:'policy_hash',purpose:'purpose',validFrom:'valid_from',validUntil:'valid_until',revoked:'revoked'}],
    ['Pro262CapacityBootstrapTrust', 'bt', {trustId:'bootstrap_trust_id',generation:'bootstrap_generation',principal:'provisioner',channelId:'bootstrap_channel',recordHash:'record_hash',evidenceHash:'evidence_hash',validUntil:'bootstrap_valid_until'}],
  ] as const;
  for (const [table, alias, fields] of tables) {
    const schema = supplier.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
    for (const [field, target] of Object.entries(fields)) {
      assert.match(schema, new RegExp(`"${field}"\\s+\\w+ NOT NULL`), `${table}.${field} source nullability`);
      assert.ok(snapshot.includes(`${alias}."${field}" AS ${target}`), `${table}.${field} projection`);
      assert.ok(snapshot.includes(`v_fact.${target}`), `${table}.${field} retention or equality`);
    }
  }
  for (const [group, fields] of [
    ['text',['trust_id','issuer','channel','verifier_key','trust_root','policy_revision','purpose','bootstrap_trust_id','bootstrap_channel']],
    ['hashes',['policy_hash','record_hash','evidence_hash']], ['names',['supplier','provisioner']],
    ['generations',['generation','bootstrap_generation']], ['times',['valid_from','valid_until','bootstrap_valid_until']],
  ] as const) {
    assert.ok(snapshot.includes(`v_trust_source_${group}:=pg_catalog.array_cat(v_trust_source_${group},ARRAY[[${fields.map(f => `v_fact.${f}`).join(',')}]]);`), group);
  }
  assert.ok(snapshot.includes('v_trust_source_revoked:=pg_catalog.array_cat(v_trust_source_revoked,ARRAY[v_fact.revoked]);'));
  for (const [name, type, width] of [['text','TEXT',9],['hashes','TEXT',3],['names','NAME',2],['generations','BIGINT',2],['times','TIMESTAMPTZ',3]] as const) {
    assert.ok(entry.includes(`v_trust_source_${name} ${type}[][]`));
    assert.ok(snapshot.includes(`array_length(v_trust_source_${name},1) IS DISTINCT FROM 20`));
    assert.ok(snapshot.includes(`array_length(v_trust_source_${name},2) IS DISTINCT FROM ${width}`));
    assert.ok(snapshot.includes(`v_trust_source_${name}[v_snapshot_i:v_snapshot_i]`));
  }
  for (const [name, type] of [['revoked','BOOLEAN']] as const) {
    assert.ok(entry.includes(`v_trust_source_${name} ${type}[]`));
    assert.ok(snapshot.includes(`array_length(v_trust_source_${name},1) IS DISTINCT FROM 20`));
    assert.ok(snapshot.includes(`v_trust_source_${name}[v_snapshot_i] IS DISTINCT FROM`));
  }
  assert.match(snapshot, /octet_length\(v_key.value\) NOT BETWEEN 1 AND 256/);
  assert.match(snapshot, /v_key.value !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(snapshot, /ARRAY\[\[v_fact.supplier,v_fact.provisioner\]\]/);
  assert.doesNotMatch(snapshot, /t\."scope"|SESSION_USER|publisher|observer|JSONB|BYTEA/);
  assert.ok(snapshot.indexOf('FOR v_snapshot_i IN 1..20') < snapshot.length);
  assert.match(entry, /descriptor post-lock reread/);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);

  // Inert vectors exercise alignment and duplicate-source consistency, not SQL execution.
  type Row = { key: string; generation: number; text: (string | null)[]; hashes: (string | null)[]; names: (string | null)[]; revoked: boolean | null; times: (string | null)[]; expected: string | null };
  const hash = 'a'.repeat(64);
  const rows: Row[] = Array.from({length:20}, (_, i) => ({key:`trust-${i}`, generation:1, text:[`trust-${i}`,'issuer','channel','key','root','revision','purpose',`trust-${i}`,'bootstrap-channel'], hashes:[hash,hash,hash], names:['supplier','provisioner'], revoked:false, times:['from','until','bootstrap-until'], expected:null}));
  const valid = (xs: Row[]) => {
    if (xs.length !== 20) return false;
    const seen = new Map<string, string>();
    for (const r of xs) {
      if (r.generation <= 0 || r.text.length !== 9 || r.hashes.length !== 3 || r.names.length !== 2 || r.times.length !== 3 || r.revoked === null || r.text.some(v => v === null || Buffer.byteLength(v) < 1 || Buffer.byteLength(v) > 256) || r.hashes.some(v => v === null || !/^[a-f0-9]{64}$/.test(v)) || r.names.some(v => v === null) || r.times.some(v => v === null)) return false;
      const key = JSON.stringify([r.key,r.generation]); const facts = JSON.stringify([r.text,r.hashes,r.names,r.revoked,r.times]);
      if (seen.has(key) && seen.get(key) !== facts) return false;
      seen.set(key,facts);
    }
    return true;
  };
  assert.equal(valid(rows), true);
  assert.equal(valid(rows.slice(1)), false);
  const alias = rows.map(r => ({...r, text:[...r.text], hashes:[...r.hashes], names:[...r.names], times:[...r.times]}));
  alias[19] = {...alias[0], expected:hash};
  assert.equal(valid(alias), true); // Role expectations can differ, including NULL.
  for (const group of ['text','hashes','names','times'] as const) for (let i=0;i<alias[0][group].length;i++) {
    const changed = alias.map(r => ({...r, text:[...r.text], hashes:[...r.hashes], names:[...r.names], times:[...r.times]}));
    changed[19][group][i] = null;
    assert.equal(valid(changed), false, `${group}[${i}] null`);
    changed[19][group][i] = group === 'hashes' ? 'b'.repeat(64) : 'different';
    assert.equal(valid(changed), false, `${group}[${i}] conflict`);
  }
  assert.equal(valid(alias.map((r,i) => i === 19 ? {...r, revoked:true} : r)), false);
  assert.equal(valid(rows.map((r,i) => i === 0 ? {...r, text:['é'.repeat(129),...r.text.slice(1)]} : r)), false);
  assert.equal(valid(rows.map((r,i) => i === 0 ? {...r, names:['supplier','different-provisioner']} : r)), true);
});

test('descriptor router and derived bootstrap role boundaries count UTF8 bytes without normalization', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  for (const id of ['baseline_id', 'control_id', 'physical_id', 'allocation_id']) {
    assert.ok(entry.includes(`v_route.${id} IS NULL OR pg_catalog.octet_length(v_route.${id}) NOT BETWEEN 1 AND 256`), id);
  }
  for (const expression of [
    `"bootstrapKind"='SELECTION_QUALIFIER_CONTROL:'||"expectedTargetId"`,
    `'SELECTION_QUALIFIER_LAYOUT:'||v_route.physical_id`,
    `'SELECTION_QUALIFIER_ALLOCATION:'||v_route.allocation_id`,
    `'OBSERVER_INPUT:'||cs."reservationId"`, `'OBSERVER_INPUT:'||os."reservationId"`,
    `'OBSERVER_INPUT:'||slot."reservationId"`,
    'octet_length(v_installer.constructor_slot) NOT BETWEEN 1 AND 256',
    'octet_length(v_installer.observation_slot) NOT BETWEEN 1 AND 256',
    'octet_length(v_history."reservationId") NOT BETWEEN 1 AND 256',
    'octet_length(v_history.capture_slot) NOT BETWEEN 1 AND 256',
  ]) assert.ok(sql.includes(expression), expression);
  const ordinary = (value: string) => Buffer.byteLength(value, 'utf8') >= 1 && Buffer.byteLength(value, 'utf8') <= 256;
  for (const id of ['baseline_id', 'control_id']) {
    assert.equal(ordinary(''), false, id);
    assert.equal(ordinary(' '), true, id);
    assert.equal(ordinary('é'.repeat(128)), true, id);
    assert.equal(ordinary('é'.repeat(128) + 'x'), false, id);
    assert.equal(ordinary('x'.repeat(256)), true, id);
    assert.equal(ordinary('x'.repeat(257)), false, id);
  }
  for (const [prefix, max] of [
    ['SELECTION_QUALIFIER_CONTROL:', 284], ['SELECTION_QUALIFIER_LAYOUT:', 283],
    ['SELECTION_QUALIFIER_ALLOCATION:', 287], ['OBSERVER_INPUT:', 271],
  ] as const) {
    const derived = (suffix: string) => ordinary(suffix) && Buffer.byteLength(prefix + suffix, 'utf8') <= 288;
    assert.equal(derived(''), false, prefix);
    assert.equal(derived('x'), true, prefix);
    assert.equal(Buffer.byteLength(prefix + 'x'.repeat(256)), max, prefix);
    assert.equal(derived('x'.repeat(256)), true, prefix);
    assert.equal(derived('x'.repeat(257)), false, prefix);
    assert.equal(derived('é'.repeat(128)), true, prefix);
    assert.equal(derived('é'.repeat(128) + 'x'), false, prefix);
  }
});

test('descriptor E/H installer slot prepayments require exact protected charge sources', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const route = entry.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation),(v_route.historical_expectation))')[1].split('-- Seven facts per E/H route:')[0];
  assert.ok(route.includes('INTO STRICT v_installer'));
  for (const slot of ['cs', 'os']) {
    assert.ok(route.includes(`AND EXISTS (SELECT 1 FROM public."Pro262CapacityControlCharge" charge WHERE (charge."kind",charge."eventKey",charge."bindingHash")=('OBSERVER_INPUT_SLOT',${slot}."prepaidEventKey",${slot}."recordHash"))`), slot);
  }
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\. Installation remains prohibited under R6 STOP\./);

  // Illustrative tuple vectors; these do not execute SQL or establish funding or locks.
  type Charge = readonly [string, string, string];
  const slots: Charge[] = ['E-constructor', 'E-observation', 'H-constructor', 'H-observation'].map(event => ['OBSERVER_INPUT_SLOT', event, 'a'.repeat(64)]);
  const covered = (charges: readonly Charge[]) => slots.every(slot => charges.some(charge => slot.every((value, index) => charge[index] === value)));
  assert.equal(covered(slots), true);
  for (let i = 0; i < slots.length; i++) {
    assert.equal(covered(slots.filter((_, index) => index !== i)), false);
    for (let field = 0; field < 3; field++) {
      const changed = slots.map(charge => [...charge] as [string, string, string]);
      changed[i][field] = field === 2 ? 'b'.repeat(64) : 'different';
      assert.equal(covered(changed), false);
    }
  }
});

test('descriptor cross-route charge conflicts are denied in the fixed discovery subset', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const discovery = entry.split('-- Denied discovery prototype only:')[1].split('v_projection:=ROW(')[0];
  const cross = discovery.split('-- Compare the other already-discovered installer route')[1].split('END IF;')[0];
  for (const term of [
    'THEN v_route.historical_expectation ELSE v_route.current_expectation END',
    'other_fact.kind COLLATE "C"=v_fact.kind COLLATE "C"',
    'other_fact.event_key COLLATE "C"=v_fact.event_key COLLATE "C"',
    'other_fact.binding_hash COLLATE "C" IS DISTINCT FROM v_fact.low_hash COLLATE "C"',
    'other."chargeBindingHash"', 'oo."chargeBindingHash"', 'os."chargeBindingHash"',
    'od."chargeBindingHash"', 'oy."chargeBindingHash"',
    "RAISE EXCEPTION 'SELECTION_UNAVAILABLE'",
  ]) assert.ok(cross.includes(term), term);
  assert.match(discovery, /ORDER BY x\.trust_id COLLATE "C",x\.generation/);
  assert.match(discovery, /ORDER BY x\.kind COLLATE "C",x\.event_key COLLATE "C"/);
  assert.doesNotMatch(discovery, /array_agg|array_append|jsonb_agg/i);

  // Illustrative independent vectors only; they do not execute SQL or establish
  // workspace admission, a global union, locks, or complete provenance.
  type Fact = readonly [string, string, string];
  const consistent = (a: readonly Fact[], b: readonly Fact[]) => a.every(x => b.every(y => x[0] !== y[0] || x[1] !== y[1] || x[2] === y[2]));
  const a: Fact[] = [['charge', 'same', 'hash-a'], ['charge', 'other', 'hash-b']];
  assert.equal(consistent(a, [['charge', 'same', 'hash-a']]), true);
  assert.equal(consistent(a, [['charge', 'same', 'hash-z']]), false);
  assert.equal(consistent(a, [['charge', 'different', 'hash-z']]), true);
  assert.deepEqual([10, 2, 1].sort((x, y) => x - y), [1, 2, 10]);
  assert.deepEqual(['z', 'A', 'a'].sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y))), ['A', 'a', 'z']);
});

test('descriptor source joins protected installer authority and remains denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const entry = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const delivery = entry.indexOf('pro273_installer_assert_committed_delivery');
  const parser = entry.indexOf('pro273_installer_parse_descriptor_metadata');
  assert.ok(delivery > entry.indexOf('FROM public."Pro262CapacityPhysicalDomain"') && parser > delivery);
  for (const term of ['v_expected."trustId",v_expected."trustGeneration"', 'v_trust_boot."recordHash" IS DISTINCT FROM v_expected."trustRecordHash"', 'v_trust."scope" IS DISTINCT FROM', 'v_allocation."layoutCoreHash"', 'v_delivery."inputClaimId"', 'pro273.control-plane.charge.v1', `(p."capturedBytes",p."evidenceBytes",p."evidenceHash",q."observerGroupProof") IS NOT DISTINCT FROM (p_captured,v_evidence,v_expected."expectedEvidenceHash",v_payload->>'observerGroupProof')`]) assert.ok(entry.includes(term), term);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(entry, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  const inserts = [...entry.matchAll(/INSERT INTO public\."([^"]+)"\(([^)]+)\)\s*VALUES\(([^;]+)\);/g)];
  assert.deepEqual(inserts.map(m => m[1]), ['Pro273QualificationInputDescriptor', 'Pro273QualifierDescriptorProvenance', 'Pro273QualifierDescriptorLinkage', 'Pro273QualifierDescriptorProof', 'Pro273QualificationInputState', 'Pro273QualificationTransitionReceipt']);
  const columns = [
    'controlId,descriptorCoreHash,allocationId,allocationCoreHash,sourceIdentity,namespace,project,deployment,environment,principalOid,principalName,credentialEpoch,launchEpoch,observerGroupProof,physicalIdentity,physicalProofIdentity,baselinePartitionId,controlChargeKind,controlChargeEventKey,bootstrapRecordHash,expiresAt',
    'controlId,coreHash,bootstrapKind,bootstrapRecordHash,bootstrapEvidenceHash,trustId,trustGeneration,trustRecordHash,publisherPrincipalOid,publisherPrincipalName,inputClaimId,sessionClaimId,eventId,capturedBytes,capturedLength,capturedHash,evidenceBytes,evidenceLength,evidenceHash,chargeKind,chargeEventKey,chargeBindingHash',
    'controlId,coreHash,expectationId,dispatchAttemptId,sessionClaimId,inputClaimId,eventId',
    'controlId,coreHash,observerGroupProof', 'controlId,state,connectionState,transitionOrdinal',
    'controlId,transitionOrdinal,fromState,toState,fromConnectionState,toConnectionState,receiptId,bindingHash,occurredAt',
  ];
  assert.deepEqual(inserts.map(m => m[2].replace(/"/g, '')), columns);
  const descriptorValues = `v_core->>'controlId',v_payload->>'descriptorCoreHash',v_allocation."allocationId",v_allocation."coreHash",v_core->>'sourceIdentity',v_core->>'namespace',v_core->>'project',v_core->>'deployment',v_core->>'environment',v_allocation."principalOid",v_allocation."principalName",v_core->>'credentialEpoch',v_core->>'launchEpoch',v_payload->>'observerGroupProof',v_core->>'physicalIdentity',v_core->>'physicalProofIdentity',v_core->>'baselinePartitionId',v_charge."kind",v_charge."eventKey",v_boot."recordHash",(v_core->>'expiresAt')::TIMESTAMPTZ`;
  const provenanceValues = `v_core->>'controlId',v_payload->>'descriptorCoreHash',v_boot."kind",v_boot."recordHash",v_boot."evidenceHash",v_trust."trustId",v_trust."generation",v_trust_boot."recordHash",v_expected."installerOid",v_expected."installerName",v_delivery."inputClaimId",v_delivery."sessionClaimId",v_delivery."eventId",p_captured,pg_catalog.octet_length(p_captured),pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),v_evidence,pg_catalog.octet_length(v_evidence),v_expected."expectedEvidenceHash",v_charge."kind",v_charge."eventKey",v_charge."bindingHash"`;
  assert.equal(inserts[0][3], descriptorValues);
  assert.equal(inserts[1][3], provenanceValues);
  assert.equal(inserts[2][3], `v_core->>'controlId',v_payload->>'descriptorCoreHash',v_expected."expectationId",v_delivery."attemptId",v_delivery."sessionClaimId",v_delivery."inputClaimId",v_delivery."eventId"`);
  assert.equal(inserts[3][3], `v_core->>'controlId',v_payload->>'descriptorCoreHash',v_payload->>'observerGroupProof'`);
  assert.equal(inserts[4][3], `v_core->>'controlId','RESERVED','OPENING',1`);
  const candidate = entry.slice(entry.indexOf('IF NOT EXISTS (SELECT 1 FROM public."Pro273QualificationInputDescriptor" d WHERE d."controlId"=v_expected."expectedTargetId") THEN'));
  assert.equal([...candidate.matchAll(/INSERT INTO public\./g)].length, 6);
  assert.match(candidate, /VALUES\(v_core->>'controlId','RESERVED','OPENING',1\)/);
  assert.match(candidate, /VALUES\(v_core->>'controlId',1,'NONE','RESERVED','NONE','OPENING',[\s\S]*?'pro273\.qualifier\.transition\.v1'[\s\S]*?digest\(p_captured,'sha256'\)[\s\S]*?v_now\);/);
  assert.match(inserts[0][0], /v_allocation\."allocationId",v_allocation\."coreHash"[\s\S]*v_allocation\."principalOid",v_allocation\."principalName"[\s\S]*v_charge\."kind",v_charge\."eventKey",v_boot\."recordHash"/);
  assert.match(inserts[1][0], /v_delivery\."inputClaimId",v_delivery\."sessionClaimId",v_delivery\."eventId",p_captured,pg_catalog\.octet_length\(p_captured\)[\s\S]*v_evidence,pg_catalog\.octet_length\(v_evidence\),v_expected\."expectedEvidenceHash"/);
  assert.match(inserts[2][0], /v_expected\."expectationId",v_delivery\."attemptId",v_delivery\."sessionClaimId",v_delivery\."inputClaimId",v_delivery\."eventId"/);
  assert.match(inserts[3][0], /v_payload->>'observerGroupProof'/);
  assert.doesNotMatch(candidate, /\b(?:UPDATE|DELETE|COMMIT|EXCEPTION\s+WHEN)\b(?=[\s\S]*END IF;)/i);
  assert.ok(entry.indexOf('AND NOT EXISTS (') < entry.indexOf('IF NOT EXISTS (SELECT 1 FROM public."Pro273QualificationInputDescriptor" d WHERE d."controlId"=v_expected."expectedTargetId") THEN'));
  assert.ok(sql.includes('CREATE TRIGGER "Pro273QualificationTransitionReceipt_immutable" BEFORE UPDATE OR DELETE'));
  const linkage = sql.split('CREATE TABLE public."Pro273QualifierDescriptorLinkage"')[1].split('CREATE TABLE public."Pro273QualifierDescriptorProof"')[0];
  assert.match(linkage, /"constructionTransactionId" xid8 NOT NULL DEFAULT pg_catalog\.pg_current_xact_id\(\)/);
  assert.doesNotMatch(linkage, /CHECK\s*\([^;]*pg_current_xact_id\s*\(/i);
  const stamp = sql.split('CREATE FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid()')[1].split('END $$;')[0];
  assert.ok(stamp.includes('NEW."constructionTransactionId":=pg_catalog.pg_current_xact_id()'));
  assert.ok(sql.includes('BEFORE INSERT ON public."Pro273QualifierDescriptorLinkage" FOR EACH ROW EXECUTE FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid()'));
});

test('actual challenge canonicalizer retains last duplicate and JS index enumeration', () => {
  const input = JSON.parse('{"10":"ten","2":"first","01":"prefix","b":"bee","a":"aye","2":"last"}');
  assert.equal(canonicalChallengeJson(input),'{"2":"last","10":"ten","01":"prefix","a":"aye","b":"bee"}');
});
test('actual canonicalizers preserve escaped NUL, lone surrogate and astral values', () => {
  const input = {value:'\u0000\ud800😀'};
  const expected = '{"value":"\\u0000\\ud800😀"}';
  assert.equal(canonicalChallengeJson(input),expected);
  assert.equal(canonicalJson(input),expected);
});
test('release validator rejects nonfinite number before canonical serialization', () => {
  const parsed = JSON.parse('{"amount":1e400}');
  assert.equal(parsed.amount,Infinity);
  assert.throws(() => canonicalJson(parsed),/non-finite/);
});

test('actual family preflight exposes JS inherited __proto__ assignment behavior', () => {
  const allocation=preflightFamilyAllocation([{id:'id',categoryId:'cat',answerConceptId:'concept',factFamilies:['fact']}],[{slotId:'__proto__',categoryId:'cat'}]);
  assert.equal(Object.hasOwn(allocation,'__proto__'),false);
});

test('actual reservation sees inherited ordinary-object properties', () => {
  const candidates=[{id:'id',categoryId:'cat',answerConceptId:'concept',factFamilies:['fact']}];
  assert.throws(()=>reserveFamilyCandidate(candidates,initialFamilySelectionState(),{slotId:'constructor',categoryId:'cat'},[]),/already has a reservation/);
});

test('actual family preflight chooses the first lexical winning candidate', () => {
  const candidates=[{id:'b',categoryId:'cat',answerConceptId:'cb',factFamilies:['fb']},{id:'a',categoryId:'cat',answerConceptId:'ca',factFamilies:['fa']}];
  assert.deepEqual(preflightFamilyAllocation(candidates,[{slotId:'slot',categoryId:'cat'}]),{slot:'a'});
});

test('actual letter queue observes inherited noniterable object properties', () => {
  const question={id:'q',categoryId:'cat',modality:'classic' as const,targetLetter:'constructor',answerConceptId:'c',headerAr:'h',promptAr:'p',canonicalAnswer:'a',acceptedAnswers:['a']};
  assert.throws(()=>createMatchQuestionSelection([question],{categories:['cat'],modality:'classic',seed:1}),TypeError);
});

test('actual letter reserve comparisons retain JavaScript NaN behavior', () => {
  const questions=Array.from({length:25},(_,i)=>({id:`q${i}`,categoryId:'cat',modality:'classic' as const,targetLetter:`L${i}`,answerConceptId:`c${i}`,headerAr:'h',promptAr:'p',canonicalAnswer:'a',acceptedAnswers:['a']}));
  assert.equal(Object.keys(createMatchQuestionSelection(questions,{categories:['cat'],modality:'classic',seed:1,reservePerLetter:NaN}).queues).length,25);
  assert.throws(()=>createMatchQuestionSelection(questions,{categories:['cat'],modality:'classic',seed:1,reservePerLetter:3}),/Insufficient concept reserve/);
});

test('actual category queue __proto__ changes prototype and does not serialize as an own key', () => {
  const questions=['__proto__','cat'].flatMap((categoryId)=>Array.from({length:14},(_,i)=>({id:`${categoryId}-${i}`,categoryId,modality:'classic' as const,answerConceptId:`${categoryId}-c${i}`,headerAr:'h',promptAr:'p',canonicalAnswer:'a',acceptedAnswers:['a']})));
  const selection=createCategoryQuestionSelection(questions,{categories:['__proto__','cat'],modality:'classic',seed:1});
  assert.equal(Object.hasOwn(selection.queues,'__proto__'),false);
  assert.equal(Array.isArray(Object.getPrototypeOf(selection.queues)),true);
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(selection)).queues,'__proto__'),false);
});

test('actual selection Map uses last duplicate while promotion find uses first', () => {
  const first={id:'dup',categoryId:'cat',modality:'classic' as const,answerConceptId:'first',headerAr:'h',promptAr:'p',canonicalAnswer:'one',acceptedAnswers:['one']};
  const second={...first,answerConceptId:'second',canonicalAnswer:'two',acceptedAnswers:['two']};
  const state={queues:{cat:['dup']},consumedQuestionIds:[],consumedAnswerConceptIds:['first'],seed:1,categories:['cat'],modality:'classic' as const,gameKind:'categories' as const};
  assert.equal(selectCategoryQuestion([first,second],state,'cat').question.canonicalAnswer,'two');
  const reserved={...state,reservedQuestionIds:['dup'],reservedAnswerConceptIds:['first'],reservedForCell:{cell:'dup'}};
  assert.equal(promoteReservedQuestion([first,second],reserved,'cell')?.question.canonicalAnswer,'one');
});

test('actual board generator has distinct trimmed letters and nine numbered surprises', () => {
  const letters=Array.from({length:16},(_,i)=>`L${i}`);
  const board=generateBoard(1,[...letters,' L0 ']);
  assert.equal(board.cells.length,25);
  const surprises=board.cells.filter(cell=>cell.kind==='surprise');
  assert.equal(surprises.length,9);
  assert.deepEqual(surprises.map(cell=>cell.visibleValue).sort(),['1','2','3','4','5','6','7','8','9']);
  assert.equal(new Set(board.cells.filter(cell=>cell.kind==='letter').map(cell=>cell.visibleValue)).size,16);
  assert.deepEqual(board.cells.map(cell=>cell.id),Array.from({length:25},(_,i)=>`cell-${i%5}-${Math.floor(i/5)}`));
});

test('actual category board uses last duplicate Map value and balanced occurrences', () => {
  const board=generateCategoryBoard(7,[{id:'a',labelAr:'First'},{id:'b',labelAr:'B'},{id:'a',labelAr:'Last'}]);
  assert.equal(board.cells.length,25);
  const a=board.cells.filter(cell=>cell.categoryId==='a'); const b=board.cells.filter(cell=>cell.categoryId==='b');
  assert.equal(a.every(cell=>cell.categoryLabelAr==='Last'),true);
  assert.equal(Math.abs(a.length-b.length),1);
  assert.deepEqual(a.map(cell=>cell.categoryOccurrence).sort((x,y)=>x!-y!),Array.from({length:a.length},(_,i)=>i+1));
});

test('actual retry lineage retains the original when there is no category change and updates only the reserve otherwise', async () => {
  const { updateChallengeRetryLineage } = await import('../../../../functions/src/content-preparation');
  const history = { boardSlotId:'board:1:cell-0-0', reserveSlotId:'old', originalCategoryId:'old-cat', replacementCategoryId:'new-cat', extra:'preserved' };
  const selection = { challengeReplacementHistory:{'cell-0-0':history}, challengeReserveSlots:[{slotId:'new',categoryId:'new-cat'}], marker:'preserved' } as never;
  const unchanged = updateChallengeRetryLineage(selection,'cell-0-0',{slotId:'board:1:cell-0-0',categoryId:'new-cat'},{slotId:'new',categoryId:'new-cat'});
  assert.equal(unchanged,selection);
  const updated = updateChallengeRetryLineage(selection,'cell-0-0',{slotId:'board:1:cell-0-0',categoryId:'old-cat'},{slotId:'new',categoryId:'new-cat'}) as unknown as {marker:string;challengeReplacementHistory:Record<string,typeof history>};
  assert.equal(updated.marker,'preserved');
  assert.deepEqual(updated.challengeReplacementHistory['cell-0-0'],{...history,reserveSlotId:'new'});
  assert.throws(()=>updateChallengeRetryLineage(selection,'cell-0-0',{slotId:'board:1:cell-0-0',categoryId:'old-cat'},{slotId:'missing',categoryId:'new-cat'}),/REPLACEMENT_LINEAGE_INVALID/);
});


test('historical layout candidate binds original identity without xid ordering', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_initial_verify_committed_layout(')[1].split('END $$;')[0];
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.doesNotMatch(body, /SESSION_USER|(?:creationTransactionId|constructionTransactionId)"\s*[<>]/);
  for (const [row, field] of [['a','creationTransactionId'], ['s','creationTransactionId'], ['b','creationTransactionId'], ['c','creationTransactionId'], ['r','creationTransactionId'], ['prov','constructionTransactionId'], ['p','constructionTransactionId'], ['lb','constructionTransactionId']]) {
    assert.ok(body.includes(`${row}."${field}"=pg_catalog.pg_current_xact_id()`));
    if (row !== 'p' && row !== 'lb') assert.ok(body.includes(`${row}."${field}"=p."constructionTransactionId"`));
  }
  assert.ok(body.includes(`(slot."observerPrincipalOid",slot."observerPrincipalName") IS DISTINCT FROM (r."principalOid",r."principalName")`));
  assert.ok(body.includes(`(cc."reservationId",cc."observerPrincipalOid",cc."observerPrincipalName") IS DISTINCT FROM (cs."reservationId",cs."observerPrincipalOid",cs."observerPrincipalName")`));
  for (const field of ['observerBackendPid','observerBackendStart','observerCredentialEpoch','observerLaunchEpoch','observerSourceClosure','observerHost','observerBoot','observerProcessTree']) assert.ok(body.includes(`slot."record"->>'${field}'`), field);
  assert.ok(body.includes(`(slot."record"->>'observerBackendStart')::TIMESTAMPTZ`));
  assert.ok(body.includes(`l."bootstrapKind" IS DISTINCT FROM 'SELECTION_QUALIFIER_LAYOUT:'||l."physicalIdentity"`));
  assert.ok(body.includes(`t."scope"->>'bootstrapKind' IS DISTINCT FROM l."bootstrapKind"`));
  assert.ok(body.includes(`boot."recordHash" IS DISTINCT FROM l."coreHash"`));
  assert.ok(body.includes(`boot."evidenceHash" IS DISTINCT FROM l."evidenceHash"`));
  assert.match(body, /EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
});

test('historical layout receipt equality remains a deny-only source candidate', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_initial_verify_committed_layout(')[1].split('END $$;')[0];
  const publication = sql.split('CREATE TABLE public."Pro273InitialLayoutPublication" (')[1].split('\n);')[0];
  assert.match(publication, /"receiptHash" TEXT NOT NULL CHECK \("receiptHash" ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(body, /cap\."operationReceipt" IS DISTINCT FROM p\."receiptHash"/);
  assert.match(body, /InputReceipt\.operationReceipt\s*\n\s*-- equals that publication ID, and p\.receiptHash stores the same hash/);
  assert.match(body, /Actual canonical publication receipt hash recomputation is still missing/);
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
});

test('historical allocation candidate follows fixed original layout and allocation chains while denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const parts = sql.split('CREATE FUNCTION public.pro273_initial_verify_committed_allocation(');
  assert.equal(parts.length, 2);
  const body = parts[1].split('END $$;')[0];
  assert.match(body, /LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog/);
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  for (const table of ['Pro273InitialAllocationPublication', 'Pro273InitialBaselineLayoutBinding', 'Pro273InitialLayoutPublication', 'Pro273QualifierBaselineLayout', 'Pro273QualifierAllocation', 'Pro273InitialPreinputReceipt', 'Pro273ControlPlaneInputClaim', 'Pro273ControlPlaneInputBinding', 'Pro262CapacityObserverInputClaim', 'Pro262CapacityObserverInputReservation', 'Pro273ControlPlaneBaseline', 'Pro273ControlPlaneBaselineProvenance', 'Pro273ControlPlaneSessionClaim', 'Pro273ControlPlaneLaunchAttempt', 'Pro273ControlPlaneProcessObservation', 'Pro273ControlPlaneInputReceipt', 'Pro262CapacityTrust', 'Pro262CapacityBootstrapTrust', 'Pro273PublisherTrustProvenance', 'Pro262CapacityBootstrapBaseline', 'Pro273ControlPlaneInstallerExpectation']) {
    assert.ok(body.includes(`FROM public."${table}"`), table);
  }
  for (const expression of [
    'public.pro273_initial_verify_committed_layout(lp."inputClaimId")',
    '(p."baselineId",p."baselineCoreHash",p."layoutInputClaimId")',
    '(p."allocationId",p."allocationCoreHash")',
    '(base."physicalIdentity",base."physicalProofIdentity",base."expectedFutureLayoutCoreHash")',
    `'SELECTION_QUALIFIER_ALLOCATION:'||q."allocationId"`,
    `'kind','INITIAL','bootstrapKind',q."bootstrapKind",'expectedCoreHash',q."coreHash",'expectedEvidenceHash',q."evidenceHash"`,
    'cap."operationReceipt" IS DISTINCT FROM p."receiptHash"',
    'q."capturedBytes",q."capturedLength",q."capturedHash"',
    'q."evidenceHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(q."evidenceBytes"',
  ]) assert.ok(body.includes(expression), expression);
  for (const slot of ['slot', 'cs', 'ps']) assert.ok(body.includes(`('OBSERVER_INPUT_SLOT',${slot}."prepaidEventKey",${slot}."recordHash")`), slot);
  for (const row of ['a', 's', 'b', 'c', 'r', 'prov', 'p', 'lb', 'lp']) {
    const field = ['prov', 'p', 'lb', 'lp'].includes(row) ? 'constructionTransactionId' : 'creationTransactionId';
    assert.ok(body.includes(`${row}."${field}" IS NOT DISTINCT FROM pg_catalog.pg_current_xact_id()`), row);
    if (row !== 'p') assert.ok(body.includes(`${row}."${field}" IS NOT DISTINCT FROM p."constructionTransactionId"`), row);
  }
  assert.doesNotMatch(body, /SESSION_USER|FOR\s+(?:SHARE|UPDATE)|\b(?:INSERT|UPDATE|DELETE)\b|(?:creationTransactionId|constructionTransactionId)"\s*[<>]/i);
  assert.match(body, /canonical publication receipt and allocation core hash recomputation are missing/);
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.pro273_initial_verify_committed_allocation(TEXT) FROM PUBLIC;'));
});

test('historical allocation separates qualifier target closures from publisher provenance', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_initial_verify_committed_allocation(')[1].split('END $$;')[0];
  const core = sql.split('CREATE FUNCTION public.pro273_qualifier_core_valid(')[1].split('END $$;')[0].split("ELSIF p_kind='ALLOCATION' THEN")[1].split('ELSE RETURN FALSE')[0];
  for (const field of ['sourceClosureHash', 'installationClosureHash']) {
    assert.ok(core.includes(`'${field}'`), field);
    const target = `q\\."${field}"`;
    const publisher = `(?:r|base|o)\\."${field}"`;
    const publisherScope = `t\\."scope"\\s*->>\\s*'${field}'`;
    const comparison = `\\s*(?:=|IS\\s+(?:NOT\\s+)?DISTINCT\\s+FROM)\\s*`;
    assert.doesNotMatch(body, new RegExp(`(?:${target}${comparison}${publisher}|${publisher}${comparison}${target})`, 'i'));
    assert.doesNotMatch(body, new RegExp(`(?:${publisherScope}${comparison}${target}|${target}${comparison}${publisherScope})`, 'i'));
    assert.ok(body.includes(`r."${field}"`) && body.includes(`base."${field}"`) && body.includes(`o."${field}"`), field);
  }
  assert.ok(body.includes(`t."scope"->>'sourceClosureHash' IS DISTINCT FROM base."sourceClosureHash"`));
  assert.ok(body.includes(`slot."record"->>'observerSourceClosure'`));
  assert.ok(body.includes(`t."supplierPrincipal" IS DISTINCT FROM q."publisherPrincipalName"`));
  assert.ok(body.includes(`t."scope"->'target' IS DISTINCT FROM c."target"`));
  assert.ok(body.includes(`(x."allocationId",x."coreHash")=(p."allocationId",p."allocationCoreHash")`));
  assert.match(body, /target qualification remains incomplete/);
  assert.match(body, /canonical publication receipt and allocation core hash recomputation are missing/);
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.ok(roles.includes('ALTER FUNCTION public.pro273_initial_verify_committed_allocation(TEXT) OWNER TO pro262_capacity_owner;'));
  assert.match(roles, /REVOKE ALL ON FUNCTION public\.pro273_initial_verify_committed_allocation\(TEXT\) FROM /);
  assert.doesNotMatch(roles, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*\bpro273_initial_verify_committed_allocation\(TEXT\)[^;]*;/i);
});

test('current layout scalar route subset is fixed, disconnected and denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const name = 'pro273_initial_discover_current_layout';
  const parts = sql.split(`CREATE FUNCTION public.${name}(`);
  assert.equal(parts.length, 2);
  const code = parts[1].split('END $$;')[0].replace(/--[^\n]*/g, '');
  assert.match(code, /^p_input_claim_id TEXT\) RETURNS VOID\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog/);
  assert.match(code, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(code, /p_input_claim_id IS NULL OR pg_catalog\.octet_length\(p_input_claim_id\) NOT BETWEEN 1 AND 256/);
  assert.match(code, /;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  const projection = code.match(/\bSELECT\s+([\s\S]*?)\s+INTO\s+STRICT\s+([\s\S]*?)\s+FROM public\."Pro273ControlPlaneInputClaim" c/);
  assert.ok(projection);
  const fields = [
    ['c."inputClaimId"', 'v_claim_id', 'TEXT'], ['c."reservationId"', 'v_reservation_id', 'TEXT'], ['base."baselineId"', 'v_baseline_id', 'TEXT'], ['base."coreHash"', 'v_baseline_core', 'TEXT'],
    ['base."physicalIdentity"', 'v_physical_id', 'TEXT'], ['base."physicalProofIdentity"', 'v_physical_proof', 'TEXT'], ['s."sessionClaimId"', 'v_session_id', 'TEXT'], ['a."attemptId"', 'v_attempt_id', 'TEXT'],
    ['c."eventId"', 'v_event_id', 'TEXT'], [`c."target"->>'kind'`, 'v_target_kind', 'TEXT'], [`c."target"->>'bootstrapKind'`, 'v_target_bootstrap', 'TEXT'], [`c."target"->>'expectedCoreHash'`, 'v_target_core', 'TEXT'], [`c."target"->>'expectedEvidenceHash'`, 'v_target_evidence', 'TEXT'],
    ['b."trustId"', 'v_publisher_trust', 'TEXT'], ['b."trustGeneration"', 'v_publisher_generation', 'BIGINT'], ['slot."prepaidEventKey"', 'v_slot_event', 'TEXT'], ['slot."recordHash"', 'v_slot_hash', 'TEXT'],
    ['c."chargeKind"', 'v_operation_kind', 'TEXT'], ['c."chargeEventKey"', 'v_operation_event', 'TEXT'], ['c."chargeBindingHash"', 'v_operation_hash', 'TEXT'],
    ['a."chargeKind"', 'v_attempt_kind', 'TEXT'], ['a."chargeEventKey"', 'v_attempt_event', 'TEXT'], ['a."chargeBindingHash"', 'v_attempt_hash', 'TEXT'],
    ['a."sessionChargeKind"', 'v_session_kind', 'TEXT'], ['a."sessionChargeEventKey"', 'v_session_event', 'TEXT'], ['a."sessionChargeBindingHash"', 'v_session_hash', 'TEXT'],
    ['o."trustId"', 'v_observation_trust', 'TEXT'], ['o."trustGeneration"', 'v_observation_generation', 'BIGINT'], ['capture."inputClaimId"', 'v_capture_claim', 'TEXT'], ['capture_slot."reservationId"', 'v_capture_reservation', 'TEXT'],
    ['capture_slot."observerTrustId"', 'v_capture_trust', 'TEXT'], ['capture_slot."observerTrustGeneration"', 'v_capture_generation', 'BIGINT'], ['capture_slot."prepaidEventKey"', 'v_capture_event', 'TEXT'], ['capture_slot."recordHash"', 'v_capture_hash', 'TEXT'],
    ['admission."receiptId"', 'v_admission_id', 'TEXT'], ['admission."receiverIdentity"', 'v_receiver', 'TEXT'], ['c."creationTransactionId"', 'v_claim_xid', 'xid8'], ['b."creationTransactionId"', 'v_binding_xid', 'xid8'],
    ['s."creationTransactionId"', 'v_session_xid', 'xid8'], ['a."creationTransactionId"', 'v_attempt_xid', 'xid8'], ['admission."creationTransactionId"', 'v_admission_xid', 'xid8'],
  ];
  assert.equal(fields.length, 41);
  assert.deepEqual(projection[1].split(',').map(value => value.trim()), fields.map(([source]) => source));
  assert.deepEqual(projection[2].split(',').map(value => value.trim()), fields.map(([, destination]) => destination));
  const declarations = code.split('DECLARE')[1].split('BEGIN')[0].split(';').map(value => value.trim()).filter(Boolean);
  assert.deepEqual(declarations, fields.map(([, destination, type]) => `${destination} ${type}`));
  assert.doesNotMatch(projection[1], /\b(?:BYTEA|JSONB?)\b|\.\*|\."(?:target|record|capturedBytes)"(?!\s*->>)/i);
  for (const edge of [
    '(oc."inputClaimId",oc."reservationId")=(c."inputClaimId",c."reservationId")',
    'slot."reservationId"=oc."reservationId"',
    '(s."baselineId",s."sessionClaimId")=(c."baselineId",c."sessionClaimId")',
    '(a."baselineId",a."attemptId",a."receiverIdentity")=(s."baselineId",s."attemptId",s."receiverIdentity")',
    'o."sessionClaimId"=s."sessionClaimId"',
    'capture."inputClaimId"=o."inputClaimId"',
    'capture_slot."reservationId"=capture."reservationId"',
    '(b."trustId",b."trustGeneration")=(slot."observerTrustId",slot."observerTrustGeneration")',
    '(oc."observerPrincipalOid",oc."observerPrincipalName")=(admission."principalOid",admission."principalName")',
    '(capture."phase",capture."observerPrincipalOid",capture."observerPrincipalName")=(capture_slot."phase",capture_slot."observerPrincipalOid",capture_slot."observerPrincipalName")',
    `capture."eventKey"=capture_slot."record"->>'expectedEventKey'`,
    '(capture."observerPrincipalOid",capture."observerPrincipalName")=(o."observerOid",o."observerPrincipal")',
    'o."observerOid" IS DISTINCT FROM admission."principalOid"',
    '(capture_slot."observerTrustId",capture_slot."observerTrustGeneration")=(o."trustId",o."trustGeneration")',
    'admission."inputClaimId",admission."reservationId",admission."baselineId",admission."baselineCoreHash",admission."sessionClaimId",admission."attemptId",admission."eventId",admission."receiverIdentity"',
    '(c."baselineId",c."purpose",c."eventId",c."chargeKind",c."chargeEventKey",c."chargeBindingHash")=(b."baselineId",b."purpose",b."eventId",b."chargeKind",b."chargeEventKey",b."chargeBindingHash")',
    `c."purpose"='QUALIFIER_BASELINE_INITIAL' AND base."purpose"=c."purpose"`,
    '(oc."eventKey",oc."phase",oc."observerPrincipalOid",oc."observerPrincipalName")=(c."eventId",c."purpose",slot."observerPrincipalOid",slot."observerPrincipalName")',
    'slot."phase"=oc."phase" AND (slot."physicalIdentity",slot."physicalProofIdentity")=(base."physicalIdentity",base."physicalProofIdentity")',
    '(capture_slot."physicalIdentity",capture_slot."physicalProofIdentity")=(base."physicalIdentity",base."physicalProofIdentity")',
    '(admission."principalOid",admission."principalName",admission."credentialEpoch",admission."launchEpoch")=(s."principalOid",s."principalName",s."credentialEpoch",s."launchEpoch")',
    '(admission."principalOid",admission."principalName",admission."credentialEpoch",admission."launchEpoch",admission."backendPid",admission."backendStart",admission."sourceClosureHash",admission."installationClosureHash")=(o."principalOid",o."principalName",o."credentialEpoch",o."launchEpoch",o."backendPid",o."backendStart",o."sourceClosureHash",o."installationClosureHash")',
    '(admission."principalOid",admission."principalName",admission."credentialEpoch",admission."launchEpoch",admission."sourceClosureHash",admission."installationClosureHash")=(base."principalOid",base."principalName",base."credentialEpoch",base."launchEpoch",base."sourceClosureHash",base."installationClosureHash")',
    '(admission."chargeKind",admission."chargeEventKey",admission."chargeBindingHash")=(c."chargeKind",c."chargeEventKey",c."chargeBindingHash")',
    `c."target"->>'kind'='INITIAL'`,
    `c."target"->>'bootstrapKind'='SELECTION_QUALIFIER_LAYOUT:'||base."physicalIdentity"`,
    'c."target" IS NOT DISTINCT FROM b."target"',
    'c."target" IS NOT DISTINCT FROM admission."target"',
    `c."target"->>'expectedCoreHash'=base."expectedFutureLayoutCoreHash"`,
  ]) assert.ok(code.includes(edge), edge);
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|MERGE|PERFORM|LOCK|RETURN)\b|FOR\s+(?:UPDATE|SHARE)|\w+\.\*|SESSION_USER|current_user|pg_backend|clock_timestamp|\bpro273_(?:installer|initial_discover_installer)\w*\s*\(/i);
  assert.equal([...code.matchAll(/\bSELECT\b/gi)].length, 1);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${name}(TEXT) FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION public.${name}(TEXT) OWNER TO pro262_capacity_owner;`));
  assert.match(roles, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(TEXT\\) FROM PUBLIC,pro273_selection_owner,[^;]+;`));
  assert.doesNotMatch(sql + roles, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[^;]*\\b${name}\\(TEXT\\)[^;]*;`, 'i'));
});

test('installer history existence candidate preserves historical edges and remains denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const name = 'pro273_initial_discover_installer_history';
  const parts = sql.split(`CREATE FUNCTION public.${name}(`);
  assert.equal(parts.length, 2);
  const body = parts[1].split('END $$;')[0];
  const code = body.replace(/--[^\n]*/g, '');
  assert.match(body, /p_baseline_id TEXT\) RETURNS VOID\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog/);
  assert.match(code, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(code, /p_baseline_id IS NULL OR pg_catalog\.octet_length\(p_baseline_id\) NOT BETWEEN 1 AND 256 THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.match(sql, /256-byte input cap is provisional and unqualified; it establishes neither\s+-- an identifier ABI nor resource qualification/);
  assert.match(code, /;\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  const projection = code.match(/\bSELECT\s+([\s\S]*?)\s+INTO\s+STRICT\s+([\s\S]*?)\s+FROM public\."Pro273ControlPlaneBaseline" base/);
  assert.ok(projection, 'one strict scalar projection from the baseline');
  const fields = [
    ['base."baselineId"', 'v_baseline_id'], ['base."coreHash"', 'v_core_hash'], ['prov."bootstrapKind"', 'v_bootstrap_kind'], ['exp."expectationId"', 'v_expectation_id'],
    ['exp."credentialEpoch"', 'v_credential_epoch'], ['exp."launchEpoch"', 'v_launch_epoch'], ['exp."eventId"', 'v_event_id'],
    ['constructor_claim."inputClaimId"', 'v_constructor_claim_id'], ['constructor_slot."reservationId"', 'v_constructor_reservation_id'], ['constructor_claim."eventKey"', 'v_constructor_event'], ['constructor_claim."phase"', 'v_constructor_phase'],
    ['constructor_slot."observerTrustId"', 'v_constructor_trust_id'], ['constructor_slot."observerTrustGeneration"', 'v_constructor_trust_generation'], ['constructor_slot."prepaidEventKey"', 'v_constructor_slot_event'], ['constructor_slot."recordHash"', 'v_constructor_slot_hash'],
    ['prov."trustId"', 'v_provenance_trust_id'], ['prov."trustGeneration"', 'v_provenance_trust_generation'], ['prov."evidenceHash"', 'v_evidence_hash'], ['exp."chargeKind"', 'v_expectation_charge_kind'], ['exp."chargeEventKey"', 'v_expectation_charge_event'], ['exp."chargeBindingHash"', 'v_expectation_charge_hash'],
    ['observation."observationId"', 'v_observation_id'], ['observation."receiptId"', 'v_observation_receipt_id'], ['observation_claim."inputClaimId"', 'v_observation_claim_id'], ['observation_slot."reservationId"', 'v_observation_reservation_id'],
    ['observation_claim."eventKey"', 'v_observation_event'], ['observation_claim."phase"', 'v_observation_phase'], ['observation."trustId"', 'v_observation_trust_id'], ['observation."trustGeneration"', 'v_observation_trust_generation'],
    ['observation_slot."observerTrustId"', 'v_observation_slot_trust_id'], ['observation_slot."observerTrustGeneration"', 'v_observation_slot_trust_generation'], ['observation_slot."prepaidEventKey"', 'v_observation_slot_event'], ['observation_slot."recordHash"', 'v_observation_slot_hash'],
    ['observation."chargeKind"', 'v_observation_charge_kind'], ['observation."chargeEventKey"', 'v_observation_charge_event'], ['observation."chargeBindingHash"', 'v_observation_charge_hash'],
    ['session_claim."sessionClaimId"', 'v_session_id'], ['session_claim."chargeKind"', 'v_session_charge_kind'], ['session_claim."chargeEventKey"', 'v_session_charge_event'], ['session_claim."chargeBindingHash"', 'v_session_charge_hash'],
    ['attempt."attemptId"', 'v_attempt_id'], ['attempt."chargeKind"', 'v_dispatch_charge_kind'], ['attempt."chargeEventKey"', 'v_dispatch_charge_event'], ['attempt."chargeBindingHash"', 'v_dispatch_charge_hash'],
    ['delivery."chargeKind"', 'v_delivery_charge_kind'], ['delivery."chargeEventKey"', 'v_delivery_charge_event'], ['delivery."chargeBindingHash"', 'v_delivery_charge_hash'], ['delivery."receiverClosureHash"', 'v_receiver_hash'],
  ];
  assert.equal(fields.length, 48);
  assert.deepEqual(projection[1].split(',').map(field => field.trim()), fields.map(([source]) => source));
  assert.deepEqual(projection[2].split(',').map(field => field.trim()), fields.map(([, target]) => target));
  const declarations = code.split('DECLARE')[1].split('BEGIN')[0].split(';').map(value => value.trim()).filter(Boolean);
  assert.deepEqual(declarations, fields.map(([, target]) => `${target} ${target.endsWith('_trust_generation') ? 'BIGINT' : 'TEXT'}`));
  assert.equal([...code.matchAll(/\bSELECT\b/gi)].length, 1);
  assert.equal([...code.matchAll(/\bINTO\b/gi)].length, 1);
  assert.deepEqual([...code.matchAll(/\b(?:public|pg_catalog)\.([a-z_]\w*)\s*\(/gi)].map(match => match[1]), ['octet_length']);
  assert.doesNotMatch(code, /\b\w*(?:bind|binder)\w*\s*\(/i);
  assert.doesNotMatch(code, /\b(?:LEFT|RIGHT|FULL|CROSS|NATURAL)\s+(?:OUTER\s+)?JOIN\b|\b(?:INSERT|UPDATE|DELETE|MERGE|RETURN|PERFORM)\b|FOR\s+(?:UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)|SESSION_USER|current_user|pg_backend|pg_stat_activity|clock_timestamp|\."(?:capturedBytes|evidenceBytes)"|\b(?:BYTEA|JSONB?)\b|\bpro273_installer_(?:assert|bind)\w*\s*\(/i);
  for (const edge of [
    'JOIN public."Pro273ControlPlaneBaselineProvenance" prov ON (prov."baselineId",prov."coreHash")=(base."baselineId",base."coreHash")',
    'JOIN public."Pro273ControlPlaneInstallerExpectation" exp ON exp."bootstrapKind"=prov."bootstrapKind"',
    'JOIN public."Pro262CapacityObserverInputClaim" constructor_claim ON constructor_claim."inputClaimId"=prov."inputClaimId"',
    'JOIN public."Pro262CapacityObserverInputReservation" constructor_slot ON constructor_slot."reservationId"=constructor_claim."reservationId"',
    'JOIN public."Pro273InstallerSlotBinding" constructor_binding ON constructor_binding."reservationId"=constructor_slot."reservationId"',
    'JOIN public."Pro273InstallerProcessObservation" observation ON (observation."expectationId",observation."credentialEpoch",observation."launchEpoch")=(exp."expectationId",exp."credentialEpoch",exp."launchEpoch")',
    'JOIN public."Pro262CapacityObserverInputClaim" observation_claim ON observation_claim."inputClaimId"=observation."inputClaimId"',
    'JOIN public."Pro262CapacityObserverInputReservation" observation_slot ON observation_slot."reservationId"=observation_claim."reservationId"',
    'JOIN public."Pro273InstallerSlotBinding" observation_binding ON observation_binding."reservationId"=observation_slot."reservationId"',
    'JOIN public."Pro273InstallerSessionClaim" session_claim ON (session_claim."expectationId",session_claim."sessionClaimId")=(exp."expectationId",exp."sessionClaimId")',
    'JOIN public."Pro273InstallerDispatchAttempt" attempt ON (attempt."attemptId",attempt."expectationId",attempt."sessionClaimId",attempt."inputClaimId")=(exp."dispatchAttemptId",exp."expectationId",session_claim."sessionClaimId",constructor_claim."inputClaimId")',
    'JOIN public."Pro273InstallerDelivery" delivery ON (delivery."attemptId",delivery."expectationId",delivery."sessionClaimId",delivery."inputClaimId",delivery."receiverClosureHash",delivery."chargeKind",delivery."chargeEventKey",delivery."chargeBindingHash")=(attempt."attemptId",attempt."expectationId",attempt."sessionClaimId",attempt."inputClaimId",attempt."receiverClosureHash",attempt."deliveryChargeKind",attempt."deliveryChargeEventKey",attempt."deliveryChargeBindingHash")',
    'WHERE base."baselineId"=p_baseline_id',
    '(base."physicalIdentity",base."physicalProofIdentity",base."expectedFutureLayoutCoreHash") IS NOT DISTINCT FROM (exp."physicalIdentity",exp."physicalProofIdentity",exp."expectedFutureLayoutCoreHash")',
    '(exp."constructorKind",exp."expectedTargetId",exp."expectedCoreHash",exp."expectedEvidenceHash",exp."sessionClaimId",exp."eventId",exp."installerOid",exp."installerName",exp."trustId",exp."trustGeneration",exp."chargeKind",exp."chargeEventKey",exp."chargeBindingHash")=(\'CONTROL_PLANE_BASELINE\',prov."baselineId",prov."coreHash",prov."evidenceHash",prov."sessionClaimId",prov."eventId",prov."publisherPrincipalOid",prov."publisherPrincipalName",prov."trustId",prov."trustGeneration",prov."chargeKind",prov."chargeEventKey",prov."chargeBindingHash")',
    '(constructor_claim."reservationId",constructor_claim."eventKey",constructor_claim."phase",constructor_claim."observerPrincipalOid",constructor_claim."observerPrincipalName")=(exp."constructorInputReservationId",exp."eventId",exp."constructorInputPhase",exp."installerOid",exp."installerName")',
    '(constructor_slot."phase",constructor_slot."observerPrincipalOid",constructor_slot."observerPrincipalName")=(constructor_claim."phase",constructor_claim."observerPrincipalOid",constructor_claim."observerPrincipalName")',
    '(constructor_slot."physicalIdentity",constructor_slot."physicalProofIdentity")=(exp."physicalIdentity",exp."physicalProofIdentity")',
    '(constructor_binding."expectationId",constructor_binding."credentialEpoch",constructor_binding."launchEpoch",constructor_binding."phase",constructor_binding."expectedEventKey",constructor_binding."bindingKind")=(exp."expectationId",exp."credentialEpoch",exp."launchEpoch",constructor_claim."phase",constructor_claim."eventKey",\'INSTALLER_CONSTRUCTOR_INPUT\')',
    '(observation_claim."phase",observation_claim."observerPrincipalOid",observation_claim."observerPrincipalName")=(\'INSTALL_PROCESS\',observation."observerOid",observation."observerPrincipal")',
    '(observation_slot."phase",observation_slot."observerPrincipalOid",observation_slot."observerPrincipalName")=(observation_claim."phase",observation_claim."observerPrincipalOid",observation_claim."observerPrincipalName")',
    '(observation_slot."observerTrustId",observation_slot."observerTrustGeneration") IS NOT DISTINCT FROM (observation."trustId",observation."trustGeneration")',
    'observation."observerOid" IS DISTINCT FROM exp."installerOid"',
    '(observation_slot."physicalIdentity",observation_slot."physicalProofIdentity")=(exp."physicalIdentity",exp."physicalProofIdentity")',
    '(observation_binding."expectationId",observation_binding."credentialEpoch",observation_binding."launchEpoch",observation_binding."phase",observation_binding."expectedEventKey",observation_binding."bindingKind")=(exp."expectationId",exp."credentialEpoch",exp."launchEpoch",observation_claim."phase",observation_claim."eventKey",\'INSTALLER_OBSERVATION\')',
    '(observation."targetOid",observation."targetPrincipal",observation."targetPid",observation."targetBackendStart")=(exp."installerOid",exp."installerName",exp."installerPid",exp."installerBackendStart")',
    '(session_claim."principalOid",session_claim."principalName",session_claim."credentialEpoch",session_claim."launchEpoch",session_claim."sourceClosureHash",session_claim."installationClosureHash",session_claim."receiverClosureHash")=(exp."installerOid",exp."installerName",exp."credentialEpoch",exp."launchEpoch",exp."sourceClosureHash",exp."installationClosureHash",exp."receiverClosureHash")',
    'attempt."receiverClosureHash"=exp."receiverClosureHash" AND delivery."eventId"=exp."eventId"',
  ]) assert.ok(code.includes(edge), edge);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION public.${name}(TEXT) FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION public.${name}(TEXT) OWNER TO pro262_capacity_owner;`));
  assert.match(roles, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(TEXT\\) FROM PUBLIC,pro273_selection_owner,[^;]+;`));
  assert.doesNotMatch(roles, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[^;]*\\b${name}\\(TEXT\\)[^;]*;`, 'i'));
  assert.doesNotMatch(sql, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION[^;]*\\b${name}\\(TEXT\\)[^;]*;`, 'i'));
});
test('denied descriptor discovery retains bounded route snapshots before alias deduplication', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const installer = entry.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation),(v_route.historical_expectation))')[1].split('-- Follow the original publication claims separately')[0];
  const initial = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  for (const [part, keys, facts, expected] of [
    [installer, 'v_installer_keys', 'v_installer_facts', ['v_key.id', 'v_installer.constructor_claim', 'v_installer.observation_slot', 'v_installer."expectedCoreHash"', 'v_installer.observation_slot_hash']],
    [initial, 'v_initial_keys', 'v_initial_facts', ['v_key.route_kind', 'v_key.claim_id', 'v_history.capture_slot', 'v_key.capture_hash', 'v_history.capture_slot_hash']],
  ] as const) {
    assert.ok(part.includes(`${keys}:=pg_catalog.array_cat(${keys},ARRAY[[`));
    assert.ok(part.includes(`${facts}:=pg_catalog.array_cat(${facts},ARRAY[[`));
    assert.ok(part.indexOf('octet_length(v_fact.value) NOT BETWEEN 1 AND 256') < part.indexOf(`${keys}:=`));
    assert.ok(part.indexOf("v_fact.value !~ '^[a-f0-9]{64}$'") < part.indexOf(`${facts}:=`));
    assert.ok(part.includes(`array_length(${keys},1),0)>=2`));
    for (const term of expected) assert.ok(part.includes(term), term);
  }
  for (const [name, width] of [['v_installer_keys', 9], ['v_installer_facts', 5], ['v_initial_keys', 10], ['v_initial_facts', 4]] as const) {
    assert.ok(entry.includes(`array_length(${name},1) IS DISTINCT FROM 2`));
    assert.ok(entry.includes(`array_length(${name},2) IS DISTINCT FROM ${width}`));
  }
  const aliases = entry.split('-- Require two aligned rows per route family')[1].split('-- Validate all fixed role occurrences')[0];
  assert.ok(aliases.includes('array_length(v_slot_occurrences,1) IS DISTINCT FROM 8'));
  assert.ok(aliases.includes('v_slot_occurrences[v_snapshot_i][1] COLLATE "C"=v_slot_occurrences[v_snapshot_j][1]'));
  assert.ok(aliases.includes('v_slot_occurrences[v_snapshot_i][2] COLLATE "C"=v_slot_occurrences[v_snapshot_j][2]'));
  assert.ok(aliases.includes('IS DISTINCT FROM'));
  assert.ok(entry.indexOf('-- Require two aligned rows per route family') < entry.indexOf('v_trust_inventory:=pg_catalog.array_cat'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  for (const missing of ['full relation lock schedule', 'receipt pre-helper dispatch', 'post-lock and post-reentry reread']) assert.ok(entry.includes(missing));

  // Inert vectors illustrate the fixed shape and conflict rule; they do not execute SQL.
  const snapshots = (rows: readonly { keys: string[]; facts: string[] }[], keyWidth: number, factWidth: number) => {
    if (rows.length !== 2 || rows.some(row => row.keys.length !== keyWidth || row.facts.length !== factWidth || row.keys.some(key => Buffer.byteLength(key) < 1 || Buffer.byteLength(key) > 256) || row.facts.some(fact => !/^[a-f0-9]{64}$/.test(fact)))) return null;
    return rows.map(row => ({ keys: [...row.keys], facts: [...row.facts] }));
  };
  for (const [keyWidth, factWidth, names] of [[9, 5, ['E', 'H']], [10, 4, ['L', 'A']]] as const) {
    const rows = names.map((name, i) => ({ keys: Array.from({ length: keyWidth }, (_, k) => `${name}-key${k}`), facts: Array.from({ length: factWidth }, () => (i ? 'b' : 'a').repeat(64)) }));
    const retained = snapshots(rows, keyWidth, factWidth);
    assert.deepEqual(retained, rows);
    assert.notDeepEqual(retained![0], retained![1]);
    assert.equal(snapshots(rows.slice(1), keyWidth, factWidth), null);
    assert.equal(snapshots([...rows, rows[0]], keyWidth, factWidth), null);
    assert.equal(snapshots([{ ...rows[0], keys: rows[0].keys.slice(1) }, rows[1]], keyWidth, factWidth), null);
    assert.equal(snapshots([{ ...rows[0], facts: ['bad', ...rows[0].facts.slice(1)] }, rows[1]], keyWidth, factWidth), null);
  }
  type Slot = readonly [string, string, string];
  const valid = (rows: readonly Slot[]) => rows.length === 8 && rows.every(a => a.every((v, i) => i === 2 ? /^[a-f0-9]{64}$/.test(v) : Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= 256)) && rows.every(a => rows.every(b => (a[0] !== b[0] || a[1] === b[1]) && (a[1] !== b[1] || a[2] === b[2])));
  const slots: Slot[] = Array.from({ length: 8 }, (_, i) => [`claim${i}`, `slot${i}`, 'a'.repeat(64)]);
  assert.equal(valid(slots), true);
  assert.equal(valid(slots.slice(1)), false);
  assert.equal(valid([...slots.slice(0, 7), ['claim0', 'different', 'a'.repeat(64)]]), false);
  assert.equal(valid([...slots.slice(0, 7), ['other', 'slot0', 'b'.repeat(64)]]), false);
  assert.equal(valid([...slots.slice(0, 7), ['claim0', 'slot0', 'a'.repeat(64)]]), true);
  assert.equal(valid([...slots.slice(0, 7), ['x'.repeat(257), 'slot7', 'a'.repeat(64)]]), false);
  assert.equal(valid([...slots.slice(0, 7), ['', 'slot7', 'a'.repeat(64)]]), false);
  assert.equal(valid([...slots.slice(0, 7), ['claim7', 'slot7', 'bad']]), false);
});

test('denied descriptor relation keys preserve each original route and composite primary key', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const installer = entry.split('-- Keys come from the same joined occurrences')[1].split('-- Preserve role occurrences')[0];
  const initial = entry.split('-- Publisher provenance uses the original publication pair')[1].split('-- Six original INITIAL role occurrences')[0];
  const shared = entry.split('-- Shared primary keys include')[1].split('-- Require two aligned rows')[0];
  const expected = [
    [installer, ["'Pro273ControlPlaneInstallerExpectation',v_key.id", "'Pro273InstallerDispatchAttempt',v_installer.\"attemptId\"", "'Pro273InstallerSessionClaim',v_installer.\"sessionClaimId\"", "'Pro262CapacityObserverInputClaim',v_installer.constructor_claim", "'Pro262CapacityObserverInputClaim',v_installer.observation_claim", "'Pro262CapacityObserverInputReservation',v_installer.constructor_slot", "'Pro262CapacityObserverInputReservation',v_installer.observation_slot", "'Pro273InstallerSlotBinding',v_installer.constructor_slot", "'Pro273InstallerSlotBinding',v_installer.observation_slot", "'Pro273InstallerProcessObservation',v_key.id,v_installer.observation_credential,v_installer.observation_launch", "'Pro273InstallerDelivery',v_installer.\"attemptId\""]],
    [initial, ["'Pro273ControlPlaneLaunchAttempt',v_history.\"attemptId\"", "'Pro273ControlPlaneSessionClaim',v_key.session_id", "'Pro273ControlPlaneInputBinding',v_history.\"reservationId\"", "'Pro273ControlPlaneInputClaim',v_key.claim_id", "'Pro262CapacityObserverInputClaim',v_key.claim_id", "'Pro262CapacityObserverInputClaim',v_history.capture_claim", "'Pro262CapacityObserverInputReservation',v_history.\"reservationId\"", "'Pro262CapacityObserverInputReservation',v_history.capture_slot", "'Pro273ControlPlaneProcessObservation',v_key.session_id", "'Pro273ControlPlaneInputReceipt',v_key.claim_id", "'Pro273InitialPreinputReceipt',v_key.claim_id", "'Pro273PublisherTrustProvenance',v_key.trust_id,v_key.generation::TEXT", "'Pro273InitialLayoutPublication' ELSE 'Pro273InitialAllocationPublication' END,v_key.claim_id"]],
    [shared, ["'Pro273QualifierBaselineLayout',v_route.physical_id", "'Pro273QualifierAllocation',v_route.allocation_id", "'Pro273ControlPlaneBaseline',v_route.baseline_id", "'Pro273ControlPlaneBaselineProvenance',v_route.baseline_id", "'Pro273InitialBaselineLayoutBinding',v_route.baseline_id,v_route.baseline_hash,v_route.layout_claim"]],
  ] as const;
  for (const [part, terms] of expected) {
    const containsEveryKey = (source: string) => terms.every(term => source.includes(term));
    assert.ok(containsEveryKey(part));
    for (const term of terms) {
      assert.ok(part.includes(term), term);
      assert.equal(containsEveryKey(part.replace(term, 'REMOVED_RELATION_KEY')), false, term);
    }
  }
  assert.match(shared, /array_length\(v_relation_keys,1\) IS DISTINCT FROM 53/);
  assert.match(shared, /array_length\(v_relation_keys,2\) IS DISTINCT FROM 5/);
  assert.match(shared, /octet_length\(v_relation_keys\[v_snapshot_i\]\[3\]\) NOT BETWEEN 1 AND 256/);
  assert.match(shared, /Reread all routed keys, facts and presence/);
  assert.ok(entry.includes('o."credentialEpoch" AS observation_credential,o."launchEpoch" AS observation_launch'));
  assert.match(entry, /v_slot_occurrences\[v_snapshot_i\]\[2\] COLLATE "C" IS DISTINCT FROM/);
  assert.match(entry, /v_fact.low_hash IS DISTINCT FROM v_fact.high_hash/);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  // The source blocks are each evaluated for both routes, plus five shared keys.
  const complete = [...expected[0][1], ...expected[0][1], ...expected[1][1], ...expected[1][1], ...expected[2][1]];
  assert.equal(complete.length, 53);
  for (let i = 0; i < complete.length; i++) assert.notEqual(complete.filter((_, j) => j !== i).length, 53);
});

test('denied descriptor retains both typed installer expectation fact snapshots', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const loop = entry.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation),(v_route.historical_expectation))')[1].split('-- Follow the original publication claims separately')[0];
  const projection = loop.split('INTO STRICT v_installer')[0];
  const textFields = ['expectationId','bootstrapKind','physicalIdentity','physicalProofIdentity','namespace','project','deployment','environment','kind','credentialEpoch','launchEpoch','host','boot','processTree','parentProcessTree','constructorKind','expectedTargetId','parserAbiVersion','dispatchAttemptId','constructorInputReservationId','constructorInputPhase','sessionClaimId','eventId','trustId','chargeKind','chargeEventKey'];
  const hashFields = ['physicalEvidenceHash','sourceClosureHash','installationClosureHash','expectedCoreHash','expectedEvidenceHash','parserSourceClosureHash','receiverClosureHash','expectedFutureLayoutCoreHash','chargeBindingHash'];
  const textCheck = loop.split('-- Bound each stored expectation text before retention')[1].split('  END LOOP;')[0];
  const hashCheck = loop.split('  END LOOP;')[1].split('  END LOOP;')[0];
  const retainedText = loop.split('v_expectation_text:=pg_catalog.array_cat(v_expectation_text,ARRAY[[')[1].split(']]);')[0];
  const retainedHashes = loop.split('v_expectation_hashes:=pg_catalog.array_cat(v_expectation_hashes,ARRAY[[')[1].split(']]);')[0];
  for (const [fields, check, retained] of [[textFields, textCheck, retainedText], [hashFields, hashCheck, retainedHashes]] as const) {
    for (const field of fields) {
      assert.ok(projection.includes(`e."${field}"`), field);
      if (field !== 'bootstrapKind') assert.ok(check.includes(`(v_installer."${field}")`), field);
      assert.ok(retained.includes(`v_installer."${field}"`), field);
      assert.equal(fields.every(f => retained.replace(`v_installer."${field}"`, '').includes(`v_installer."${f}"`)), false, field);
    }
  }
  assert.match(textCheck, /value IS NULL OR pg_catalog\.octet_length\(v_fact\.value\) NOT BETWEEN 1 AND 256/);
  assert.match(textCheck, /v_installer\."bootstrapKind" IS NULL OR pg_catalog\.octet_length\(v_installer\."bootstrapKind"\) NOT BETWEEN 1 AND 288/);
  assert.ok(!textCheck.split('FOR v_fact IN SELECT x.value FROM (VALUES')[1].includes('(v_installer."bootstrapKind")'));
  assert.match(hashCheck, /value IS NULL OR v_fact\.value !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.ok(retainedHashes.includes('v_installer."trustRecordHash"'));
  assert.match(loop, /"trustRecordHash" IS NOT NULL AND v_installer\."trustRecordHash" !~/);
  for (const [field, variable, type] of [['installerOid','oids','OID'],['installerName','names','NAME'],['installerPid','pids','INTEGER'],['trustGeneration','generations','BIGINT']] as const) {
    assert.ok(projection.includes(`e."${field}"`));
    assert.ok(entry.includes(`v_expectation_${variable} ${type}[]`));
    assert.ok(loop.includes(`array_cat(v_expectation_${variable},ARRAY[v_installer."${field}"])`));
    assert.ok(loop.includes(`v_installer."${field}" IS NULL`));
    assert.ok(entry.includes(`array_length(v_expectation_${variable},1) IS DISTINCT FROM 2`));
  }
  for (const field of ['installerBackendStart','validFrom','validUntil']) {
    assert.ok(projection.includes(`e."${field}"`));
    assert.ok(loop.includes(`v_installer."${field}" IS NULL`));
  }
  assert.ok(entry.includes('v_expectation_times TIMESTAMPTZ[][]'));
  assert.ok(loop.includes('ARRAY[[v_installer."installerBackendStart",v_installer."validFrom",v_installer."validUntil"]]'));
  assert.ok(loop.includes('octet_length(v_installer."installerName"::TEXT) NOT BETWEEN 1 AND 256'));
  assert.ok(entry.includes('v_route.current_expectation=v_route.historical_expectation'));
  for (const [variable, width] of [['text',26],['hashes',10],['times',3]] as const) {
    assert.ok(entry.includes(`array_length(v_expectation_${variable},1) IS DISTINCT FROM 2`));
    assert.ok(entry.includes(`array_length(v_expectation_${variable},2) IS DISTINCT FROM ${width}`));
  }
  assert.ok(loop.indexOf('NOT BETWEEN 1 AND 256') < loop.indexOf('v_expectation_text:='));
  assert.ok(loop.indexOf("!~ '^[a-f0-9]{64}$'") < loop.indexOf('v_expectation_hashes:='));
  assert.doesNotMatch(loop, /SESSION_USER|current_user|pg_backend|FOR\s+(?:UPDATE|SHARE)|e\."(?:record|capturedBytes|evidenceBytes)"/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);

  // Inert model of the bounded scalar retention; this does not execute SQL.
  const retain = (rows: { text: string[]; hashes: (string | null)[] }[]) => rows.length === 2 && rows.every(row => row.text.length === 26 && row.hashes.length === 10 && row.text.every((v, i) => typeof v === 'string' && Buffer.byteLength(v, 'utf8') >= 1 && Buffer.byteLength(v, 'utf8') <= (i === 1 ? 288 : 256)) && row.hashes.every((v, i) => (i === 9 && v === null) || (typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)))) ? rows.map(row => ({ text: [...row.text], hashes: [...row.hashes] })) : null;
  const rows = ['E','H'].map((name, i) => ({ text: textFields.map(f => `${name}-${f}`), hashes: [...hashFields.map(() => (i ? 'b' : 'a').repeat(64)), i ? null : 'c'.repeat(64)] }));
  assert.deepEqual(retain(rows), rows);
  const longKinds = rows.map(row => ({ ...row, text: [...row.text] }));
  longKinds[0].text[1] = 'SELECTION_QUALIFIER_CONTROL:' + 'x'.repeat(256);
  longKinds[1].text[1] = 'é'.repeat(144);
  assert.equal(Buffer.byteLength(longKinds[0].text[1], 'utf8'), 284);
  assert.equal(Buffer.byteLength(longKinds[1].text[1], 'utf8'), 288);
  assert.deepEqual(retain(longKinds), longKinds);
  const tooLongKind = longKinds.map(row => ({ ...row, text: [...row.text] }));
  tooLongKind[1].text[1] += 'x';
  assert.equal(Buffer.byteLength(tooLongKind[1].text[1], 'utf8'), 289);
  assert.equal(retain(tooLongKind), null);
  assert.notDeepEqual(retain(rows)![0], retain(rows)![1]);
  assert.equal(retain(rows.slice(1)), null);
  for (let i = 0; i < 26; i++) assert.equal(retain([{ ...rows[0], text: rows[0].text.filter((_, j) => i !== j) }, rows[1]]), null);
  for (let i = 0; i < 10; i++) assert.equal(retain([{ ...rows[0], hashes: rows[0].hashes.filter((_, j) => i !== j) }, rows[1]]), null);
  for (const bad of ['', 'x'.repeat(257)]) assert.equal(retain([{ ...rows[0], text: [bad, ...rows[0].text.slice(1)] }, rows[1]]), null);
  assert.equal(retain([{ ...rows[0], hashes: ['bad', ...rows[0].hashes.slice(1)] }, rows[1]]), null);
});


test('denied E/H snapshots retain separate bounded typed installer session and observation scalars', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const loop = entry.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation),(v_route.historical_expectation))')[1].split('-- Follow the original publication claims separately')[0];
  const projection = loop.split('INTO STRICT v_installer')[0];
  const validation = loop.split('-- Validate each stored scalar before retaining the aligned E/H route.')[1].split('v_session_text:=')[0];
  const groups: [string, string, string, string[]][] = [
    ['session_text','sess','TEXT',['sessionClaimId','expectationId','credentialEpoch','launchEpoch','chargeKind','chargeEventKey']],
    ['session_hashes','sess','TEXT',['sourceClosureHash','installationClosureHash','receiverClosureHash','chargeBindingHash']],
    ['session_oids','sess','OID',['principalOid']], ['session_names','sess','NAME',['principalName']],
    ['session_transactions','sess','xid8',['creationTransactionId']], ['session_times','sess','TIMESTAMPTZ',['claimedAt']],
    ['observation_text','obs','TEXT',['expectationId','credentialEpoch','launchEpoch','observationId','receiptId','trustId','inputClaimId','host','boot','processTree','installationGeneration','chargeKind','chargeEventKey']],
    ['observation_hashes','obs','TEXT',['installationEvidenceHash','capturedHash','evidenceHash','chargeBindingHash']],
    ['observation_oids','obs','OID',['targetOid','observerOid']], ['observation_names','obs','NAME',['targetPrincipal','observerPrincipal']],
    ['observation_pids','obs','INTEGER',['targetPid','observerPid']], ['observation_times','obs','TIMESTAMPTZ',['targetBackendStart','observerBackendStart','validUntil']],
    ['observation_generations','obs','BIGINT',['trustGeneration']], ['observation_lengths','obs','BIGINT',['capturedLength','evidenceLength']],
  ];
  for (const [group, alias, type, fields] of groups) {
    const dims = fields.length === 1 ? '[]' : '[][]';
    assert.ok(entry.includes(`v_${group} ${type}${dims}`), group);
    assert.ok(entry.includes(`array_length(v_${group},1) IS DISTINCT FROM 2`), group);
    if (fields.length > 1) assert.ok(entry.includes(`array_length(v_${group},2) IS DISTINCT FROM ${fields.length}`), group);
    const retained = loop.split(`v_${group}:=pg_catalog.array_cat(v_${group},ARRAY[`)[1].split(');')[0];
    for (const field of fields) {
      const ref = `v_installer.${alias}_${field}`;
      assert.ok(projection.includes(`${alias === 'sess' ? 's' : 'o'}."${field}" AS ${alias}_${field}`), ref);
      assert.ok(validation.includes(ref), ref);
      assert.ok(retained.includes(ref), ref);
    }
  }
  const textValidation = validation.split('END LOOP;')[0];
  const hashValidation = validation.split('END LOOP;')[1];
  for (const [group, alias, , fields] of groups) for (const field of fields) {
    const ref = `v_installer.${alias}_${field}`;
    if (group.endsWith('_text')) assert.ok(textValidation.includes(`(${ref})`), ref);
    else if (group.endsWith('_hashes')) assert.ok(hashValidation.includes(`(${ref})`), ref);
    else assert.ok(validation.includes(`${ref} IS NULL`), ref);
    const table = sql.split(`CREATE TABLE public."${alias === 'sess' ? 'Pro273InstallerSessionClaim' : 'Pro273InstallerProcessObservation'}" (`)[1].split('\n);')[0];
    assert.match(table, new RegExp(`"${field}" [A-Za-z0-9]+ (?:PRIMARY KEY|NOT NULL)`), ref);
  }
  assert.ok(entry.includes('v_route.current_expectation=v_route.historical_expectation'));
  assert.ok(loop.includes('WHERE e."expectationId"=v_key.id'));
  assert.ok(loop.includes('v_installer."trustRecordHash"'));
  assert.ok(loop.includes('v_route.historical_trust_hash'));
  assert.match(validation, /octet_length\(v_fact.value\) NOT BETWEEN 1 AND 256/);
  assert.match(validation, /v_fact.value !~ '\^\[a-f0-9\]\{64\}\$'/);
  for (const field of ['targetPid','observerPid','capturedLength','evidenceLength']) assert.ok(validation.includes(`v_installer.obs_${field}<=0`));
  for (const field of ['sess_principalName','obs_targetPrincipal','obs_observerPrincipal']) assert.ok(validation.includes(`octet_length(v_installer.${field}::TEXT) NOT BETWEEN 1 AND 256`));
  assert.doesNotMatch(projection, /[os]\."(?:lane|installation|capturedBytes|evidenceBytes)"/);
  assert.doesNotMatch(loop, /SESSION_USER|current_user|pg_backend|FOR\s+(?:UPDATE|SHARE)/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  // Illustrative boundary vectors only: these do not execute SQL or authenticate either route.
  const text = (v: unknown) => typeof v === 'string' && Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= 256;
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  for (const value of ['', 'x'.repeat(257), null, 1]) assert.equal(text(value), false);
  for (const value of ['x', 'é'.repeat(128)]) assert.equal(text(value), true);
  for (const value of [null, 1, 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) assert.equal(hash(value), false);
  assert.equal(hash('a'.repeat(64)), true);
  const routes = [{ expectation: 'E', session: 'current-session', observed: 'current-observation' }, { expectation: 'H', session: 'historic-session', observed: 'historic-observation' }];
  assert.notDeepEqual(routes[0], routes[1]);
  assert.notEqual(routes[1].session, routes[1].observed);
});

test('denied E/H installer slot occurrences retain their original typed claim and reservation facts', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const capacity = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const loop = entry.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation),(v_route.historical_expectation))')[1].split('-- Follow the original publication claims separately')[0];
  const projection = loop.split('INTO STRICT v_installer')[0];
  const snapshot = loop.split('-- Preserve both claim/reservation roles per route')[1].split('-- Both table schemas')[0];
  const claim = ['inputClaimId','reservationId','eventKey','phase','observerPrincipalOid','observerPrincipalName','claimedAt'];
  const slot = ['reservationId','physicalIdentity','physicalProofIdentity','baselineAllocationProof','observerPrincipalOid','observerPrincipalName','observerTrustId','observerTrustGeneration','phase','maxInputBytes','recordHash','prepaidEventKey','backendBytes','sharedBytes','otherBaselineBackend','otherBaselineShared','concurrencySlot'];
  for (const [role, ca, sa] of [['constructor','c','cs'],['observation','oc','os']]) {
    for (const [alias, label, fields, table] of [[ca,'claim',claim,'Pro262CapacityObserverInputClaim'],[sa,'slot',slot,'Pro262CapacityObserverInputReservation']] as const) {
      const schema = capacity.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
      for (const f of fields) {
        assert.ok(schema.includes(`"${f}"`), f);
        assert.ok(projection.includes(`${alias}."${f}" AS ${role}_${label}_${f}`), f);
        assert.ok(snapshot.includes(`v_installer.${role}_${label}_${f}`), f);
      }
      assert.doesNotMatch(schema, /"creationTransactionId"/);
    }
  }
  for (const [name, type, width] of [['text','TEXT',10],['hashes','TEXT',2],['oids','OID',2],['names','NAME',2],['generations','BIGINT',0],['limits','NUMERIC',0],['resources','NUMERIC',4],['concurrency','TEXT',0]] as const) {
    assert.ok(entry.includes(`v_installer_slot_${name} ${type}${width ? '[][]' : '[]'}`));
    assert.ok(entry.includes(`array_length(v_installer_slot_${name},1) IS DISTINCT FROM 4`));
    if (width) assert.ok(entry.includes(`array_length(v_installer_slot_${name},2) IS DISTINCT FROM ${width}`));
  }
  assert.ok(entry.includes('v_installer_claim_times TIMESTAMPTZ[]'));
  assert.ok(entry.includes('array_length(v_installer_claim_times,1) IS DISTINCT FROM 4'));
  for (const field of ['claim_id','claim_reservation','claim_event','claim_phase','slot_id','physical_id','physical_proof','trust_id','slot_phase','prepaid']) assert.ok(snapshot.includes(`(v_fact.${field})`), field);
  for (const term of ['allocation_proof','record_hash']) assert.ok(snapshot.includes(`v_fact.${term} !~ '^[a-f0-9]{64}$'`));
  for (const term of ['claim_oid','slot_oid','claim_name','slot_name','claim_time','generation','max_input']) assert.ok(snapshot.includes(`v_fact.${term} IS NULL`));
  assert.ok(snapshot.includes('v_fact.generation<=0'));
  assert.ok(snapshot.includes('v_fact.max_input>9223372036854775807'));
  assert.ok(snapshot.includes('v_fact.max_input<>pg_catalog.trunc(v_fact.max_input)'));
  const aliases = entry.split('-- Equal keys must retain equal stored facts')[1].split('-- Validate all fixed role occurrences')[0];
  for (const name of ['text','hashes','oids','names','generations','limits','resources','concurrency']) assert.ok(aliases.includes(`v_installer_slot_${name}`));
  assert.ok(aliases.includes('v_installer_claim_times'));
  assert.match(aliases, /FOR v_snapshot_i IN 1\.\.4 LOOP/);
  assert.doesNotMatch(projection, /(?:cs|os)\."record"(?!->>?'expectedEventKey')|(?:cs|os|c|oc)\."(?:capturedBytes|evidenceBytes)"/);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  for (const missing of ['full relation lock schedule','receipt pre-helper dispatch','post-lock and post-reentry reread']) assert.ok(entry.includes(missing));

  // Inert vectors model four role occurrences; they do not execute SQL.
  type Occurrence = { claim: string; reservation: string; event: string; phase: string; claimOid: number; claimName: string; time: string; physical: string; physicalProof: string; slotOid: number; slotName: string; slotPhase: string; trust: string; generation: number; proof: string; hash: string; prepaid: string; limit: bigint };
  const valid = (rows: Occurrence[]) => rows.length === 4 && rows.every(a =>
    [a.claim,a.reservation,a.event,a.phase,a.claimName,a.physical,a.physicalProof,a.slotName,a.slotPhase,a.trust,a.prepaid].every(v => Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= 256) &&
    [a.proof,a.hash].every(v => /^[a-f0-9]{64}$/.test(v)) && a.generation > 0 && a.limit > 0n && a.limit <= 9223372036854775807n &&
    rows.every(b => (a.claim !== b.claim || [a.reservation,a.event,a.phase,a.claimOid,a.claimName,a.time].every((v,i) => v === [b.reservation,b.event,b.phase,b.claimOid,b.claimName,b.time][i])) &&
      (a.reservation !== b.reservation || [a.physical,a.physicalProof,a.slotOid,a.slotName,a.slotPhase,a.trust,a.generation,a.proof,a.hash,a.prepaid,a.limit].every((v,i) => v === [b.physical,b.physicalProof,b.slotOid,b.slotName,b.slotPhase,b.trust,b.generation,b.proof,b.hash,b.prepaid,b.limit][i]))));
  const rows = ['E-constructor','E-observation','H-constructor','H-observation'].map((role, i) => ({ claim: role, reservation: role, event: role, phase: i % 2 ? 'INSTALL_PROCESS' : 'INSTALLER_CONSTRUCTOR_INPUT', claimOid: i + 1, claimName: role, time: 'time', physical: 'physical', physicalProof:'proof', slotOid:i+1, slotName:role, slotPhase:i % 2 ? 'INSTALL_PROCESS' : 'INSTALLER_CONSTRUCTOR_INPUT', trust: role, generation: i + 1, proof: 'a'.repeat(64), hash: 'b'.repeat(64), prepaid: role, limit: 1n }));
  assert.equal(valid(rows), true);
  for (let i=0;i<4;i++) {
    assert.equal(valid(rows.filter((_,j) => i!==j)), false);
    for (const change of [{event:''},{trust:'é'.repeat(129)},{proof:'x'},{generation:0},{limit:0n},{limit:9223372036854775808n}]) assert.equal(valid(rows.map((r,j) => i===j ? {...r,...change} : r)), false);
  }
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0]}]), true);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0],event:'conflict'}]), false);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[3],reservation:rows[0].reservation,hash:'c'.repeat(64)}]), false);
  for (const change of [{slotOid:99},{slotName:'different'},{slotPhase:'different'},{physicalProof:'different'},{generation:99},{limit:2n},{proof:'c'.repeat(64)},{prepaid:'different'}]) assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0],...change}]), false);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0],time:'different'}]), false);
});

test('denied L/A snapshots retain original typed control session and observation scalars', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const loop = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  const projection = loop.split('INTO STRICT v_history')[0];
  const validation = loop.split('-- Validate each L/A session and observation scalar before retention.')[1].split('v_initial_session_text:=')[0];
  const groups: [string, string, string, string[]][] = [
    ['initial_session_text','s','TEXT',['sessionClaimId','baselineId','attemptId','credentialEpoch','launchEpoch','receiverIdentity']],
    ['initial_session_oid','s','OID',['principalOid']], ['initial_session_name','s','NAME',['principalName']],
    ['initial_session_xid','s','xid8',['creationTransactionId']], ['initial_session_time','s','TIMESTAMPTZ',['claimedAt']],
    ['initial_observation_text','o','TEXT',['sessionClaimId','trustId','credentialEpoch','launchEpoch','host','boot','processTree','parentProcessTree','inputClaimId']],
    ['initial_observation_hashes','o','TEXT',['sourceClosureHash','installationClosureHash','capturedHash']],
    ['initial_observation_oids','o','OID',['observerOid','principalOid']], ['initial_observation_names','o','NAME',['observerPrincipal','principalName']],
    ['initial_observation_pid','o','INTEGER',['backendPid']], ['initial_observation_times','o','TIMESTAMPTZ',['backendStart','validUntil']],
    ['initial_observation_generation','o','BIGINT',['trustGeneration']], ['initial_observation_length','o','INTEGER',['capturedLength']],
  ];
  for (const [group, alias, type, fields] of groups) {
    const dims = fields.length === 1 ? '[]' : '[][]';
    assert.ok(entry.includes(`v_${group} ${type}${dims}`), group);
    assert.ok(entry.includes(`array_length(v_${group},1) IS DISTINCT FROM 2`), group);
    if (fields.length > 1) assert.ok(entry.includes(`array_length(v_${group},2) IS DISTINCT FROM ${fields.length}`), group);
    const retained = loop.split(`v_${group}:=pg_catalog.array_cat(v_${group},ARRAY[`)[1].split(');')[0];
    const table = sql.split(`CREATE TABLE public."${alias === 's' ? 'Pro273ControlPlaneSessionClaim' : 'Pro273ControlPlaneProcessObservation'}" (`)[1].split('\n);')[0];
    for (const field of fields) {
      const ref = `v_history.initial_${alias}_${field}`;
      const source = field === 'capturedLength' ? 'pg_catalog.octet_length(o."capturedBytes")' : `${alias}."${field}"`;
      assert.ok(projection.includes(`${source} AS initial_${alias}_${field}`), ref);
      assert.ok(validation.includes(ref), ref);
      assert.ok(retained.includes(ref), ref);
      if (field !== 'capturedLength') assert.match(table, new RegExp(`"${field}" [A-Za-z0-9]+ (?:PRIMARY KEY|NOT NULL)`), ref);
      if (group.endsWith('_text') || group.endsWith('_hashes')) assert.ok(validation.includes(`(${ref})`), ref);
      else assert.ok(validation.includes(`${ref} IS NULL`), ref);
    }
  }
  assert.match(validation, /octet_length\(v_fact.value\) NOT BETWEEN 1 AND 256/);
  assert.match(validation, /v_fact.value !~ '\^\[a-f0-9\]\{64\}\$'/);
  for (const f of ['s_principalName','o_observerPrincipal','o_principalName']) assert.ok(validation.includes(`octet_length(v_history.initial_${f}::TEXT) NOT BETWEEN 1 AND 256`));
  for (const f of ['o_backendPid<=0','o_trustGeneration<=0','o_capturedLength<0']) assert.ok(validation.includes(`v_history.initial_${f}`));
  assert.ok(loop.includes("('LAYOUT',v_route.layout_claim"));
  assert.ok(loop.includes("('ALLOCATION',v_route.allocation_claim"));
  assert.ok(loop.includes('JOIN public."Pro273ControlPlaneSessionClaim" s ON'));
  assert.ok(loop.includes('JOIN public."Pro273ControlPlaneProcessObservation" o ON'));
  assert.ok(loop.includes('v_key.route_kind,v_key.claim_id,v_key.admission_id'));
  assert.doesNotMatch(projection.replace('pg_catalog.octet_length(o."capturedBytes")', ''), /o\."capturedBytes"|SESSION_USER|current_user|pg_backend/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.ok(entry.includes('This is not a full fact snapshot'));
  // Boundary examples are inert; the SQL and historical authentication are not executed.
  const text = (v: unknown) => typeof v === 'string' && Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= 256;
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  for (const value of [null, '', 'x'.repeat(257), 1]) assert.equal(text(value), false);
  for (const value of [null, 'a'.repeat(63), 'A'.repeat(64)]) assert.equal(hash(value), false);
  assert.equal(text('é'.repeat(128)), true); assert.equal(hash('a'.repeat(64)), true);
});

test('denied L/A input and capture slots retain bounded stored scalar occurrences', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const loop = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  const projection = loop.split('INTO STRICT v_history')[0];
  const snapshot = loop.split('-- Preserve original L/A input and capture claim/reservation roles.')[1].split('-- Validate each L/A session')[0];
  const claim = ['inputClaimId','reservationId','eventKey','phase','observerPrincipalOid','observerPrincipalName','claimedAt'];
  const slot = ['reservationId','physicalIdentity','physicalProofIdentity','baselineAllocationProof','observerPrincipalOid','observerPrincipalName','observerTrustId','observerTrustGeneration','phase','maxInputBytes','recordHash','prepaidEventKey','backendBytes','sharedBytes','otherBaselineBackend','otherBaselineShared','concurrencySlot'];
  for (const [alias, role, fields, table] of [['ic','input_claim',claim,'Pro262CapacityObserverInputClaim'],['slot','input_slot',slot,'Pro262CapacityObserverInputReservation'],['cc','capture_claim',claim,'Pro262CapacityObserverInputClaim'],['cs','capture_slot',slot,'Pro262CapacityObserverInputReservation']] as const) {
    const schema = supplier.split(`CREATE TABLE public."${table}" (`)[1].split('\n);')[0];
    for (const field of fields) {
      assert.ok(projection.includes(`${alias}."${field}" AS initial_${role}_${field}`), `${role}.${field}`);
      assert.ok(snapshot.includes(`v_history.initial_${role}_${field}`), `${role}.${field}`);
      assert.match(schema, new RegExp(`"${field}" [A-Za-z0-9]+ (?:PRIMARY KEY|NOT NULL)`));
    }
    assert.doesNotMatch(schema, /"creationTransactionId"/);
  }
  for (const [name,width] of [['text',10],['hashes',2],['oids',2],['names',2],['generations',0],['limits',0],['resources',4],['concurrency',0]] as const) {
    assert.ok(entry.includes(`array_length(v_initial_slot_${name},1) IS DISTINCT FROM 4`));
    if (width) assert.ok(entry.includes(`array_length(v_initial_slot_${name},2) IS DISTINCT FROM ${width}`));
  }
  assert.ok(entry.includes('array_length(v_initial_claim_times,1) IS DISTINCT FROM 4'));
  assert.ok(snapshot.includes('octet_length(v_fact.allocation_proof) NOT BETWEEN 1 AND 256'));
  assert.ok(snapshot.includes('pg_catalog.scale(n.value)>19'));
  assert.doesNotMatch(projection, /(?:ic|cc|slot|cs)\."record"(?!->>?'(?:expectedEventKey|observerBackendPid)')|(?:ic|cc|slot|cs)\."capturedBytes"/);
  const aliases = entry.split('-- Compare historical role aliases before deduplication.')[1].split('-- Validate all fixed role occurrences')[0];
  for (const name of ['text','hashes','oids','names','generations','limits','resources','concurrency']) assert.ok(aliases.includes(`v_initial_slot_${name}`));
  assert.ok(aliases.includes('v_installer_slot_text'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  type Row = {claim:string; reservation:string; event:string; hash:string; resources:number[]; concurrency:string};
  const valid = (r:Row[]) => r.length===4 && r.every(a => [a.claim,a.reservation,a.event,a.concurrency].every(x=>typeof x==='string' && Buffer.byteLength(x)>0 && Buffer.byteLength(x)<=256) && /^[a-f0-9]{64}$/.test(a.hash) && a.resources.length===4 && a.resources.every((n,i)=>Number.isFinite(n) && n>=0 && (i>1 || n>0)) && r.every(b => (a.claim!==b.claim || a.reservation===b.reservation && a.event===b.event) && (a.reservation!==b.reservation || a.hash===b.hash && a.concurrency===b.concurrency && a.resources.every((n,i)=>n===b.resources[i]))));
  const rows = ['L-input','L-capture','A-input','A-capture'].map(x=>({claim:x,reservation:x,event:x,hash:'a'.repeat(64),resources:[1,1,0,0],concurrency:x}));
  assert.equal(valid(rows),true); assert.equal(valid(rows.slice(0,3)),false);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0]}]),true);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0],event:'conflict'}]),false);
  assert.equal(valid([rows[0],rows[1],rows[2],{...rows[0],resources:[1,2,0,0]}]),false);
  for (const bad of ['', 'é'.repeat(129), null]) assert.equal(valid(rows.map((r,i)=>i ? r : {...r,concurrency:bad as string})),false);
});


test('denied installer reservation resources retain typed bounds and compare every alias', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const snapshot = entry.split('-- Preserve both claim/reservation roles per route')[1].split('-- Both table schemas')[0];
  assert.ok(snapshot.includes('(v_fact.concurrency_slot)'));
  assert.ok(snapshot.includes('n.value IS NULL OR n.value<0 OR n.value>9223372036854775807 OR pg_catalog.scale(n.value)>19'));
  assert.ok(snapshot.includes('v_fact.backend=0 OR v_fact.shared=0'));
  assert.ok(snapshot.includes('Resource scale <=19 is provisional; historical compatibility and full accounting remain unqualified'));
  for (const [prefix, end, left, right] of [
    ['-- Equal keys must retain equal stored facts', '-- Compare historical role aliases', 'installer', 'installer'],
    ['-- Compare historical and installer aliases', '-- Validate all fixed role occurrences', 'initial', 'installer'],
  ]) {
    const comparison = entry.split(prefix)[1].split(end)[0];
    assert.ok(comparison.includes(`v_${left}_slot_resources[v_snapshot_i:v_snapshot_i][1:4] IS DISTINCT FROM v_${right}_slot_resources[v_snapshot_j:v_snapshot_j][1:4]`));
    assert.ok(comparison.includes(`v_${left}_slot_concurrency[v_snapshot_i] COLLATE "C" IS DISTINCT FROM v_${right}_slot_concurrency[v_snapshot_j] COLLATE "C"`));
  }
  // Inert decimal model: exact value and stored scale, without SQL execution.
  const numeric = (v: string, positive: boolean) => {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(v);
    if (!match || (match[2]?.length ?? 0) > 19) return false;
    const fraction = match[2] ?? ''; const unit = 10n ** BigInt(fraction.length);
    const value = BigInt(match[1]) * unit + BigInt(fraction || '0');
    return value <= 9223372036854775807n * unit && (!positive || value > 0n);
  };
  const sameNumeric = (a: string, b: string) => {
    const normalize = (v: string) => { const [whole, fraction = ''] = v.split('.'); return [BigInt(whole), fraction.replace(/0+$/, '')] as const; };
    const x = normalize(a), y = normalize(b); return x[0] === y[0] && x[1] === y[1];
  };
  type Row = { reservation: string; facts: string[]; resources: string[]; concurrency: string };
  const valid = (rows: Row[]) => rows.length === 8 && rows.every(a =>
    a.resources.length === 4 && a.resources.every((n, i) => numeric(n, i < 2)) &&
    Buffer.byteLength(a.concurrency) >= 1 && Buffer.byteLength(a.concurrency) <= 256 &&
    rows.every(b => a.reservation !== b.reservation ||
      a.facts.every((v, i) => v === b.facts[i]) && a.facts.length === b.facts.length &&
      a.resources.every((v, i) => sameNumeric(v, b.resources[i])) && a.concurrency === b.concurrency));
  const rows: Row[] = ['E-constructor','E-observation','H-constructor','H-observation','L-input','L-capture','A-input','A-capture']
    .map(reservation => ({reservation, facts: ['physical','proof','allocation','oid','name','trust','generation','phase','limit','hash','prepaid'], resources:['1','1','0','0'], concurrency:'slot'}));
  assert.equal(valid(rows), true);
  for (let i = 0; i < 4; i++) {
    for (const bad of ['', 'é'.repeat(129)]) assert.equal(valid(rows.map((r,j) => j === i ? {...r, concurrency:bad} : r)), false);
    for (let k = 0; k < 4; k++) {
      for (const bad of ['-1','9223372036854775808','0.00000000000000000001', ...(k < 2 ? ['0'] : [])]) {
        assert.equal(valid(rows.map((r,j) => j === i ? {...r,resources:r.resources.map((n,m) => m === k ? bad : n)} : r)), false);
      }
      for (const good of ['9223372036854775807','0.0000000000000000001', ...(k >= 2 ? ['0'] : [])]) {
        assert.equal(valid(rows.map((r,j) => j === i ? {...r,resources:r.resources.map((n,m) => m === k ? good : n)} : r)), true);
      }
    }
    for (let j = 0; j < 8; j++) if (i !== j) {
      const aliased = rows.map((r,n) => n === j ? {...rows[i], facts:[...rows[i].facts], resources:[...rows[i].resources]} : r);
      assert.equal(valid(aliased), true);
      assert.equal(valid(aliased.map((r,n) => n === j ? {...r,resources:['1.0','1.00','0.0','0.00']} : r)), true);
      for (let k = 0; k < 4; k++) assert.equal(valid(aliased.map((r,n) => n === j ? {...r,resources:r.resources.map((v,m) => m === k ? '2' : v)} : r)), false);
      assert.equal(valid(aliased.map((r,n) => n === j ? {...r,concurrency:'different'} : r)), false);
      for (let k = 0; k < rows[i].facts.length; k++) assert.equal(valid(aliased.map((r,n) => n === j ? {...r,facts:r.facts.map((v,m) => m === k ? 'different' : v)} : r)), false);
    }
  }
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
});

test('bootstrap prelock retains all protected scalar rows before alias deduplication', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const entry = helper;
  const snapshot = entry.split('FOR v_candidate_index IN 1..12 LOOP')[1].split('FOR v_fact IN SELECT v_bootstrap_candidates[i][1]')[0];
  const schema = supplier.split('CREATE TABLE public."Pro262CapacityBootstrapBaseline" (')[1].split('\n);')[0];
  for (const [field, target] of [['kind','kind'],['publisherPrincipal','publisher'],['recordHash','record_hash'],['evidenceHash','evidence_hash'],['validUntil','valid_until']]) {
    assert.ok(schema.includes(`"${field}"`), field);
    assert.ok(snapshot.includes(`b."${field}" AS ${target}`), field);
    assert.ok(snapshot.includes(`v_fact.${target}`), target);
  }
  for (const [name, type, length] of [['keys','TEXT',0],['hashes','TEXT',2],['publishers','NAME',0],['times','TIMESTAMPTZ',0]] as const) {
    assert.ok(entry.includes(`v_bootstrap_source_${name} ${type}${length ? '[][]' : '[]'}`));
    assert.ok(snapshot.includes(`array_length(v_bootstrap_source_${name},1) IS DISTINCT FROM 12`));
    if (length) assert.ok(snapshot.includes(`array_length(v_bootstrap_source_${name},2) IS DISTINCT FROM ${length}`));
    assert.ok(snapshot.includes(`v_bootstrap_source_${name}[v_snapshot_i`));
  }
  assert.ok(snapshot.includes('WHERE b."kind"=v_bootstrap_candidates[v_candidate_index][1]'));
  assert.ok(snapshot.includes('ARRAY[v_fact.kind]'));
  assert.ok(snapshot.includes('ARRAY[[v_fact.record_hash,v_fact.evidence_hash]]'));
  assert.ok(snapshot.includes('ARRAY[v_fact.publisher]'));
  assert.ok(snapshot.includes('ARRAY[v_fact.valid_until]'));
  assert.ok(snapshot.indexOf('FOR v_snapshot_i IN 1..12') < snapshot.length);
  assert.doesNotMatch(snapshot, /SESSION_USER|clock_timestamp|FOR\s+(?:SHARE|UPDATE)|JSONB|BYTEA/i);
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  assert.match(entry, /descriptor post-lock reread/);
  assert.ok(sql.includes('Installation remains prohibited under R6 STOP'));

  // Inert occurrence vectors: four original routes, each with one ordinary and two derived roles.
  type Row = { kind: string; hash: string; evidence: string; publisher: string; until: string; role: 'ordinary' | 'derived' };
  const rows: Row[] = Array.from({length:12}, (_, i) => ({kind:i % 3 ? `OBSERVER_INPUT:slot-${i}` : `ordinary-${i}`, hash:'a'.repeat(64), evidence:'b'.repeat(64), publisher:`publisher-${i}`, until:'2030-01-01', role:i % 3 ? 'derived' : 'ordinary'}));
  const retain = (input: Row[]) => {
    if (input.length !== 12) return false;
    const seen = new Map<string,string>();
    for (const r of input) {
      const bytes = Buffer.byteLength(r.kind, 'utf8');
      if (!bytes || bytes > 288 || (r.role === 'derived' && (!r.kind.startsWith('OBSERVER_INPUT:') || Buffer.byteLength(r.kind.slice('OBSERVER_INPUT:'.length), 'utf8') < 1 || Buffer.byteLength(r.kind.slice('OBSERVER_INPUT:'.length), 'utf8') > 256)) || !/^[a-f0-9]{64}$/.test(r.hash) || !/^[a-f0-9]{64}$/.test(r.evidence) || !r.publisher || !r.until) return false;
      const value = JSON.stringify([r.hash,r.evidence,r.publisher,r.until]);
      if (seen.has(r.kind) && seen.get(r.kind) !== value) return false;
      seen.set(r.kind,value);
    }
    return true;
  };
  assert.equal(retain(rows), true);
  for (let i=0;i<12;i++) assert.equal(retain(rows.filter((_,j) => i!==j)), false, `missing ${i}`);
  const alias = rows.map(r => ({...r})); alias[9] = {...alias[0]};
  assert.equal(retain(alias), true);
  for (const [field,value] of [['hash','c'.repeat(64)],['evidence','c'.repeat(64)],['publisher','other'],['until','2031-01-01']] as const) {
    assert.equal(retain(alias.map((r,i) => i===9 ? {...r,[field]:value} : r)), false, field);
  }
  assert.equal(retain(rows.map((r,i) => i===0 ? {...r,kind:'x'.repeat(288)} : r)), true);
  assert.equal(retain(rows.map((r,i) => i===0 ? {...r,kind:'x'.repeat(289)} : r)), false);
  assert.equal(retain(rows.map((r,i) => i===1 ? {...r,kind:'OBSERVER_INPUT:'+'é'.repeat(128)} : r)), true);
  assert.equal(retain(rows.map((r,i) => i===1 ? {...r,kind:'OBSERVER_INPUT:'+'é'.repeat(129)} : r)), false);
});


test('initial receipt scalar projection retains original typed facts and target aliases', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const producer = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  const names = 'inputClaimId receiptId reservationId baselineId baselineCoreHash sessionClaimId attemptId eventId receiverIdentity principalOid principalName credentialEpoch launchEpoch backendPid backendStart sourceClosureHash installationClosureHash chargeKind chargeEventKey chargeBindingHash creationTransactionId'.split(' ');
  for (const name of names) assert.ok(producer.includes(`r."${name}" AS initial_receipt_${name}`), name);
  for (const name of ['kind', 'bootstrapKind', 'expectedCoreHash', 'expectedEvidenceHash']) assert.ok(producer.includes(`r."target"->>'${name}' AS initial_receipt_target_${name}`), name);
  const groups: Record<string, string[]> = {
    text: 'inputClaimId receiptId reservationId baselineId sessionClaimId attemptId eventId receiverIdentity credentialEpoch launchEpoch chargeKind chargeEventKey target_kind target_bootstrapKind'.split(' '),
    hashes: 'baselineCoreHash sourceClosureHash installationClosureHash chargeBindingHash target_expectedCoreHash target_expectedEvidenceHash'.split(' '),
    oid: ['principalOid'], name: ['principalName'], pid: ['backendPid'], time: ['backendStart'], xid: ['creationTransactionId'],
  };
  for (const [group, members] of Object.entries(groups)) {
    const line = producer.split(`v_initial_receipt_${group}:=pg_catalog.array_cat(`)[1].split('\n')[0];
    assert.deepEqual([...line.matchAll(/v_history\.initial_receipt_(\w+)/g)].map(m => m[1]), members);
  }
  assert.match(producer, /FROM public\."Pro273InitialPreinputReceipt" r[\s\S]*?JOIN public\."Pro273ControlPlaneInputClaim" c[\s\S]*?JOIN public\."Pro273ControlPlaneInputBinding" b/);
  assert.match(producer, /r\."target" IS NOT DISTINCT FROM c\."target" AND r\."target" IS NOT DISTINCT FROM b\."target"/);
  for (const side of ['p_before', 'p_after']) {
    for (const other of ['v_initial_keys','v_initial_claim_text','v_initial_claim_hashes','v_initial_binding_text','v_initial_binding_hashes']) assert.ok(comparator.includes(`${side}.${other}[v_i]`), other);
    assert.ok(comparator.includes(`pg_catalog.substr(${side}.v_initial_receipt_text[v_i][14]`));
  }
  assert.ok(comparator.includes('THEN 287 WHEN v_j=14 THEN 283 ELSE 256 END'));
  assert.match(comparator, /v_initial_receipt_hashes\[v_i\]\[v_j\] !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(producer, /JSON\/detoast and runtime remain unqualified/);
  // Illustrative scalar model only; this does not parse or execute SQL.
  const original = Object.values(groups).flat().map((name, index) => `${name}:${index}`);
  const equal = (a: (string | null)[], b: (string | null)[]) => a.length === original.length && b.length === original.length && a.every((value, index) => value !== null && b[index] !== null && value === b[index]);
  assert.equal(equal(original, [...original]), true);
  original.forEach((_, index) => {
    const changed = [...original]; changed[index] += '!';
    assert.equal(equal(original, changed), false);
    const missing: (string | null)[] = [...original]; missing[index] = null;
    assert.equal(equal(missing, missing), false);
  });
});

test('descriptor typed discovery has an exact private partial projection and remains denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const shape = sql.split('CREATE TYPE public.pro273_qualifier_discovery_snapshot AS (\n')[1].split('\n);')[0].trim();
  const expected = "route_current_expectation TEXT,\n route_historical_expectation TEXT,\n route_control_id TEXT,\n route_physical_id TEXT,\n route_proof_id TEXT,\n route_allocation_id TEXT,\n route_allocation_hash TEXT,\n route_layout_hash TEXT,\n route_baseline_id TEXT,\n route_baseline_hash TEXT,\n v_history_text TEXT[],\n v_history_numbers NUMERIC[],\n v_history_oids OID[],\n v_history_names NAME[],\n v_history_bigints BIGINT[],\n v_history_times TIMESTAMPTZ[],\n v_history_transactions xid8[],\n v_baseline_provenance_text TEXT[],\n v_baseline_provenance_hashes TEXT[],\n v_baseline_provenance_oid OID[],\n v_baseline_provenance_name NAME[],\n v_baseline_provenance_bigints BIGINT[],\n v_baseline_provenance_xid xid8[],\n v_allocation_text TEXT[],\n v_allocation_hashes TEXT[],\n v_allocation_oids OID[],\n v_allocation_names NAME[],\n v_allocation_numbers BIGINT[],\n v_allocation_times TIMESTAMPTZ[],\n v_allocation_closures TEXT[],\n v_allocation_location TEXT[],\n v_allocation_resources NUMERIC[],\n v_physical_capacity NUMERIC[],\n v_physical_fence BIGINT[],\n v_physical_text TEXT[],\n v_physical_hashes TEXT[],\n v_physical_enabled BOOLEAN[],\n v_charge_inventory TEXT[][],\n v_control_baseline_inventory TEXT[][],\n v_charge_source_text TEXT[][],\n v_charge_source_amount NUMERIC[],\n v_control_baseline_source_text TEXT[][],\n v_control_baseline_source_numbers NUMERIC[][],\n v_control_baseline_source_enabled BOOLEAN[],\n v_trust_inventory TEXT[][],\n v_bootstrap_trust_inventory TEXT[][],\n v_trust_source_text TEXT[][],\n v_trust_source_hashes TEXT[][],\n v_trust_source_names NAME[][],\n v_trust_source_generations BIGINT[][],\n v_trust_source_revoked BOOLEAN[],\n v_trust_source_times TIMESTAMPTZ[][],\n v_bootstrap_inventory TEXT[][],\n v_bootstrap_source_keys TEXT[],\n v_bootstrap_source_hashes TEXT[][],\n v_bootstrap_source_publishers NAME[],\n v_bootstrap_source_times TIMESTAMPTZ[],\n v_installer_keys TEXT[][],\n v_installer_facts TEXT[][],\n v_expectation_text TEXT[][],\n v_expectation_hashes TEXT[][],\n v_expectation_oids OID[],\n v_expectation_names NAME[],\n v_expectation_pids INTEGER[],\n v_expectation_times TIMESTAMPTZ[][],\n v_expectation_generations BIGINT[],\n v_dispatch_text TEXT[][],\n v_dispatch_hashes TEXT[][],\n v_dispatch_transactions xid8[],\n v_dispatch_times TIMESTAMPTZ[],\n v_delivery_text TEXT[][],\n v_delivery_hashes TEXT[][],\n v_delivery_transactions xid8[],\n v_delivery_times TIMESTAMPTZ[],\n v_session_text TEXT[][],\n v_session_hashes TEXT[][],\n v_session_oids OID[],\n v_session_names NAME[],\n v_session_transactions xid8[],\n v_session_times TIMESTAMPTZ[],\n v_observation_text TEXT[][],\n v_observation_hashes TEXT[][],\n v_observation_oids OID[][],\n v_observation_names NAME[][],\n v_observation_pids INTEGER[][],\n v_observation_times TIMESTAMPTZ[][],\n v_observation_generations BIGINT[],\n v_observation_lengths BIGINT[][],\n v_installer_slot_text TEXT[][],\n v_installer_binding_text TEXT[][],\n v_installer_slot_hashes TEXT[][],\n v_installer_slot_oids OID[][],\n v_installer_slot_names NAME[][],\n v_installer_slot_generations BIGINT[],\n v_installer_slot_limits NUMERIC[],\n v_installer_slot_resources NUMERIC[][],\n v_installer_slot_concurrency TEXT[],\n v_installer_slot_event TEXT[],\n v_installer_claim_times TIMESTAMPTZ[],\n v_initial_slot_text TEXT[][],\n v_initial_slot_hashes TEXT[][],\n v_initial_slot_oids OID[][],\n v_initial_slot_names NAME[][],\n v_initial_slot_generations BIGINT[],\n v_initial_slot_limits NUMERIC[],\n v_initial_slot_resources NUMERIC[][],\n v_initial_slot_concurrency TEXT[],\n v_initial_slot_event TEXT[],\n v_initial_claim_times TIMESTAMPTZ[],\n v_initial_attempt_text TEXT[][],\n v_initial_attempt_hashes TEXT[][],\n v_initial_attempt_ordinal BIGINT[],\n v_initial_attempt_xid xid8[],\n v_initial_attempt_time TIMESTAMPTZ[],\n v_initial_session_text TEXT[][],\n v_initial_session_oid OID[],\n v_initial_session_name NAME[],\n v_initial_session_xid xid8[],\n v_initial_session_time TIMESTAMPTZ[],\n v_initial_observation_text TEXT[][],\n v_initial_observation_hashes TEXT[][],\n v_initial_observation_oids OID[][],\n v_initial_observation_names NAME[][],\n v_initial_observation_pid INTEGER[],\n v_initial_observation_times TIMESTAMPTZ[][],\n v_initial_observation_generation BIGINT[],\n v_initial_observation_length INTEGER[],\n v_initial_input_receipt_text TEXT[][],\n v_initial_input_receipt_length BIGINT[],\n v_initial_claim_text TEXT[][],\n v_initial_claim_hashes TEXT[][],\n v_initial_claim_xid xid8[],\n v_initial_binding_text TEXT[][],\n v_initial_binding_hashes TEXT[][],\n v_initial_binding_generation BIGINT[],\n v_initial_binding_xid xid8[],\n v_initial_receipt_text TEXT[][],\n v_initial_receipt_hashes TEXT[][],\n v_initial_receipt_oid OID[],\n v_initial_receipt_name NAME[],\n v_initial_receipt_pid INTEGER[],\n v_initial_input_slot_pid TEXT[],\n v_initial_receipt_time TIMESTAMPTZ[],\n v_initial_receipt_xid xid8[],\n v_initial_keys TEXT[][],\n v_initial_facts TEXT[][],\n v_relation_keys TEXT[][],\n v_descriptor_presence BOOLEAN[],\n v_descriptor_present BOOLEAN,\n v_descriptor_text TEXT[],\n v_descriptor_hashes TEXT[],\n v_descriptor_oids OID[],\n v_descriptor_names NAME[],\n v_descriptor_numbers BIGINT[],\n v_descriptor_times TIMESTAMPTZ[],\n v_descriptor_companion_text TEXT[],\n v_descriptor_companion_hashes TEXT[],\n v_descriptor_companion_numbers BIGINT[],\n v_descriptor_companion_transactions xid8[],\n v_descriptor_companion_times TIMESTAMPTZ[]";
  assert.equal(shape, expected);
  const names = expected.split(',\n').map(line => line.trim().split(/\s+/)[0]);
  assert.equal(new Set(names).size, names.length);
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  const mapped = helper.split('v_projection:=ROW(')[1].split(')::public.pro273_qualifier_discovery_snapshot')[0].split(',').map(x => x.trim());
  assert.deepEqual(mapped, names.map(name => name.startsWith('route_') ? 'v_route.' + name.slice(6) : name));
  assert.doesNotMatch(shape, /candidate|slot_occurrences|RECORD|BYTEA|JSON/i);
  assert.match(helper, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(helper, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection;[^\n]*\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.match(constructor, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';[\s\S]*?p_captured IS NULL[\s\S]*?pg_has_role\(SESSION_USER[\s\S]*?transaction_isolation[\s\S]*?v_discovery:=public\.pro273_qualifier_discover\(p_expectation_id\)/);
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);
  const code = helper.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|MERGE|LOCK|PERFORM)\b|FOR\s+(?:UPDATE|SHARE)|pg_has_role|pro273_installer_\w+\s*\(/i);
  assert.match(helper, /v_expectation_hashes:=pg_catalog\.array_cat\(v_expectation_hashes,ARRAY\[\[[^;]*v_installer\."trustRecordHash"\]\]\)/);
  assert.match(sql.split('CREATE TABLE public."Pro273ControlPlaneInstallerExpectation"')[1].split('\n);')[0], /"trustRecordHash" TEXT CHECK/);
  assert.match(helper, /pg_catalog\.scale\(v_charge_source_amount\[v_snapshot_i\]\) IS DISTINCT FROM pg_catalog\.scale\(v_charge_source_amount\[v_snapshot_j\]\)/);
  assert.match(helper, /array_length\(v_expectation_hashes,2\) IS DISTINCT FROM 10/);
  assert.match(helper, /array_length\(v_control_baseline_source_numbers,2\) IS DISTINCT FROM 5/);
  const principals = 'PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker';
  for (const [kind, object] of [['TYPE','pro273_qualifier_discovery_snapshot'],['FUNCTION','pro273_qualifier_discover(TEXT)']] as const) {
    assert.ok(sql.includes('REVOKE ALL ON ' + kind + ' public.' + object + ' FROM PUBLIC;'));
    assert.ok(roles.includes('ALTER ' + kind + ' public.' + object + ' OWNER TO pro262_capacity_owner;'));
    assert.ok(roles.includes('REVOKE ALL ON ' + kind + ' public.' + object + ' FROM ' + principals + ';'));
  }
  assert.doesNotMatch(sql + roles, /GRANT[^;]*pro273_qualifier_(?:discover\(|discovery_snapshot)/i);
});

test('descriptor and original provenance scalar projection is exact and nullable only when absent', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const branch = helper.split('v_descriptor_present:=TRUE;')[1].split('ELSE RAISE EXCEPTION')[0];
  const expected = [
    'd.controlId d.allocationId d.sourceIdentity d.namespace d.project d.deployment d.environment d.credentialEpoch d.launchEpoch d.observerGroupProof d.physicalIdentity d.physicalProofIdentity d.baselinePartitionId d.controlChargeKind d.controlChargeEventKey p.controlId p.bootstrapKind p.trustId p.inputClaimId p.sessionClaimId p.eventId p.chargeKind p.chargeEventKey',
    'd.descriptorCoreHash d.allocationCoreHash d.bootstrapRecordHash p.coreHash p.bootstrapRecordHash p.bootstrapEvidenceHash p.trustRecordHash p.capturedHash p.evidenceHash p.chargeBindingHash',
    'd.principalOid p.publisherPrincipalOid', 'd.principalName p.publisherPrincipalName',
    'p.trustGeneration p.capturedLength p.evidenceLength', 'd.expiresAt',
  ].map(x => x.split(' '));
  const selected = [...branch.split('-- Retain the four companion rows')[0].matchAll(/ARRAY\[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/([dp])\."([^"]+)"/g)].map(x => `${x[1]}.${x[2]}`)).filter(x => x.length);
  assert.deepEqual(selected, expected);
  assert.match(branch, /ON \(p\."controlId",p\."coreHash"\)=\(d\."controlId",d\."descriptorCoreHash"\)/);
  assert.match(branch, /WHERE d\."controlId"=v_route\.control_id/);
  assert.doesNotMatch(branch, /capturedBytes|evidenceBytes|\bJSONB?\b/i);
  for (const check of ['octet_length(x.value) NOT BETWEEN 1 AND CASE WHEN x.cell=17 THEN 288 ELSE 256 END', "x !~ '^[a-f0-9]{64}$'", 'x<=0', 'x=0']) assert.ok(branch.includes(check));
  assert.ok(branch.includes("NOT pg_catalog.starts_with(x.value,'SELECTION_QUALIFIER_CONTROL:')"));
  assert.ok(branch.includes('octet_length(pg_catalog.substring(x.value,29)) NOT BETWEEN 1 AND 256'));
  // Inert model of exact join, shape and per-scalar equality; no SQL is run.
  const project = (bits: boolean[], d: {controlId:string; core:string; values:string[]}, p: {controlId:string; core:string; values:string[]}) => {
    if (bits.every(x => !x)) return null;
    if (!bits.every(Boolean) || d.controlId !== 'selected' || p.controlId !== d.controlId || p.core !== d.core) return undefined;
    return [...d.values, ...p.values];
  };
  const d = {controlId:'selected', core:'core', values:['issuer','allocation','physical']};
  const p = {controlId:'selected', core:'core', values:['publisher','original-claim','original-event','charge','capture-hash','evidence-hash']};
  assert.equal(project(Array(6).fill(false), d, p), null);
  assert.equal(project([true,false,true,true,true,true], d, p), undefined);
  assert.equal(project(Array(6).fill(true), d, {...p, controlId:'wrong'}), undefined);
  assert.equal(project(Array(6).fill(true), d, {...p, core:'wrong'}), undefined);
  const actual = project(Array(6).fill(true), d, p)!;
  for (let i=0; i<actual.length; i++) {
    const changed = [...actual]; changed[i] += '-changed';
    assert.notDeepEqual(actual, changed);
  }
});

test('descriptor bootstrap text retention and comparison enforce byte boundaries', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('-- field: v_descriptor_hashes')[0].split('-- field: v_descriptor_text')[1];
  for (const side of ['p_before', 'p_after']) {
    assert.ok(body.includes(`octet_length(${side}.v_descriptor_text[v_i]) NOT BETWEEN 1 AND CASE WHEN v_i=17 THEN 288 ELSE 256 END`));
    assert.ok(body.includes(`NOT pg_catalog.starts_with(${side}.v_descriptor_text[v_i],'SELECTION_QUALIFIER_CONTROL:')`));
    assert.ok(body.includes(`octet_length(pg_catalog.substring(${side}.v_descriptor_text[v_i],29)) NOT BETWEEN 1 AND 256`));
  }
  // Illustrative retention and comparison model; SQL and runtime are not executed.
  const prefix = 'SELECTION_QUALIFIER_CONTROL:';
  const bytes = (v: string) => Buffer.byteLength(v, 'utf8');
  const retain = (cells: string[] | null) => cells === null ? null : cells.length === 23 && cells.every((v, i) => {
    const size = bytes(v);
    return size >= 1 && size <= (i === 16 ? 288 : 256) && (i !== 16 || (v.startsWith(prefix) && bytes(v.slice(prefix.length)) >= 1 && bytes(v.slice(prefix.length)) <= 256));
  }) ? [...cells] : undefined;
  const compare = (a: string[] | null, b: string[] | null) => {
    const left = retain(a), right = retain(b);
    return left !== undefined && right !== undefined && (left === null ? right === null : right !== null && left.every((v, i) => v === right[i]));
  };
  const cells = Array(23).fill('ordinary') as string[];
  cells[16] = prefix + 'é'.repeat(128);
  assert.equal(bytes(cells[16]), 284);
  assert.deepEqual(retain(cells), cells);
  assert.equal(compare(cells, [...cells]), true);
  assert.equal(compare(null, null), true);
  assert.equal(compare(cells, null), false);
  for (const invalid of [prefix + 'x'.repeat(257), prefix + 'x'.repeat(261), prefix, 'wrong:' + 'x'.repeat(256)]) {
    const changed = [...cells]; changed[16] = invalid;
    assert.equal(retain(changed), undefined);
    assert.equal(compare(changed, changed), false);
    assert.equal(compare(cells, changed), false);
    assert.equal(compare(changed, cells), false);
  }
  assert.equal(bytes(prefix + 'x'.repeat(261)), 289);
  const ordinary = [...cells]; ordinary[0] = 'x'.repeat(257);
  assert.equal(retain(ordinary), undefined);
  assert.equal(compare(ordinary, ordinary), false);
  const different = [...cells]; different[16] = prefix + 'x'.repeat(256);
  assert.equal(compare(cells, different), false);
});

test('private discovery comparator accounts for every typed field and stays denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'public.pro273_qualifier_snapshot_equal(public.pro273_qualifier_discovery_snapshot,public.pro273_qualifier_discovery_snapshot)';
  const fields = sql.split('CREATE TYPE public.pro273_qualifier_discovery_snapshot AS (\n')[1].split('\n);')[0].trim().split(',\n').map(x => x.trim().split(/\s+/));
  const body = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split(`REVOKE ALL ON FUNCTION ${signature}`)[0];
  const checkDelimiter = (source: string) => {
    assert.match(source, /^p_before public\.pro273_qualifier_discovery_snapshot,p_after public\.pro273_qualifier_discovery_snapshot\) RETURNS BOOLEAN\nLANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS \$pro273_snapshot_equal\$\n[\s\S]*\nEND \$pro273_snapshot_equal\$;\n$/);
  };
  checkDelimiter(body);
  assert.throws(() => checkDelimiter(body.replace('AS $pro273_snapshot_equal$', 'AS $')));
  assert.throws(() => checkDelimiter(body.replace('END $pro273_snapshot_equal$', 'END $')));
  assert.throws(() => checkDelimiter(body.replace('END $pro273_snapshot_equal$', 'END $other$')));
  const segments = [...body.matchAll(/ -- field: (\w+)\n([\s\S]*?)(?= -- field: |\n IF p_before\.v_descriptor_presence IS DISTINCT FROM ARRAY)/g)];
  const producer = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const fixed = new Map<string, number>();
  for (const m of producer.matchAll(/array_length\((v_\w+),(\d)\) IS DISTINCT FROM (\d+)/g)) fixed.set(m[1] + ':' + m[2], Number(m[3]));
  fixed.set('v_descriptor_presence:1', 6);
  const variable: Record<string, number[]> = {v_charge_inventory:[28,3],v_control_baseline_inventory:[28,1],v_trust_inventory:[20,2],v_bootstrap_trust_inventory:[20,2],v_bootstrap_inventory:[12,3],v_control_baseline_source_text:[28,5],v_control_baseline_source_numbers:[28,5],v_control_baseline_source_enabled:[28]};
  assert.equal(fields.length, 143 + 2 + 5 + 1 + 6 + 2 + 1);
  assert.deepEqual(segments.map(m => m[1]), fields.map(([name]) => name));
  for (const [i, [name, type]] of fields.entries()) {
    // The binding fields share shape and comparison loops; inspect the entire shared block for each.
    const part = name.startsWith('v_initial_binding_')
      ? body.split(' -- field: v_initial_binding_text')[1].split(' -- field: v_initial_keys')[0]
      : segments[i][2];
    if (name.startsWith('v_descriptor_') && !['v_descriptor_presence','v_descriptor_present'].includes(name)) {
      assert.ok(part.includes('NOT p_before.v_descriptor_present'), name);
      assert.ok(part.includes(`p_before.${name} IS NOT NULL OR p_after.${name} IS NOT NULL`), name);
      for (const side of ['p_before','p_after']) {
        assert.ok(part.includes(`array_ndims(${side}.${name}) IS DISTINCT FROM 1`), name);
        assert.ok(part.includes(`array_lower(${side}.${name},1) IS DISTINCT FROM 1`), name);
        assert.ok(part.includes(`array_length(${side}.${name},1) IS DISTINCT FROM ${fixed.get(name + ':1')}`), name);
      }
      const c = /^(TEXT|NAME)/.test(type) ? ' COLLATE "C"' : '';
      assert.ok(part.includes(`p_before.${name}[v_i]${c} IS DISTINCT FROM p_after.${name}[v_i]${c}`), name);
      continue;
    }
    if (!type.includes('[]')) {
      assert.ok(part.includes(`p_before.${name} IS NULL OR p_after.${name} IS NULL`), name);
      assert.ok(part.includes(`p_before.${name}${type === 'TEXT' ? ' COLLATE "C"' : ''} IS DISTINCT FROM p_after.${name}`), name);
      continue;
    }
    const dimensions = (type.match(/\[\]/g) ?? []).length;
    for (const side of ['p_before','p_after']) {
      assert.ok(part.includes(`${side}.${name} IS NULL`), name);
      assert.ok(part.includes(`array_ndims(${side}.${name}) IS DISTINCT FROM ${dimensions}`), name);
      for (let d=1; d<=dimensions; d++) {
        assert.ok(part.includes(`array_lower(${side}.${name},${d}) IS DISTINCT FROM 1`), name);
        assert.ok(part.includes(`array_length(${side}.${name},${d})`), name);
        const limit = variable[name]?.[d-1] ?? fixed.get(name + ':' + d);
        assert.ok(limit !== undefined, name + ':' + d);
        const bound = variable[name] && d === 1 ? `COALESCE(pg_catalog.array_length(${side}.${name},1),0) NOT BETWEEN 1 AND ${limit}` : `array_length(${side}.${name},${d}) IS DISTINCT FROM ${limit}`;
        assert.ok(part.includes(bound), name + ':' + d);
      }
    }
    const index = '[v_i]' + (dimensions === 2 ? '[v_j]' : '');
    const a = `p_before.${name}${index}`, b = `p_after.${name}${index}`;
    const collation = /^(TEXT|NAME)/.test(type) ? ' COLLATE "C"' : '';
    assert.ok(part.includes(`${a}${collation} IS DISTINCT FROM ${b}${collation}`), name);
    const provenanceValidation: Record<string, (value: string) => string> = {
      v_baseline_provenance_text: value => `pg_catalog.octet_length(pg_catalog.convert_to(${value},'UTF8')) NOT BETWEEN 1 AND CASE WHEN v_i=2 THEN 288 ELSE 256 END`,
      v_baseline_provenance_hashes: value => `${value} !~ '^[a-f0-9]{64}$'`,
      v_baseline_provenance_name: value => `pg_catalog.octet_length(${value}::TEXT) NOT BETWEEN 1 AND 256`,
      v_baseline_provenance_bigints: value => `${value}<=0`,
    };
    const validate = provenanceValidation[name];
    if (validate) {
      assert.ok(part.includes(`IF ${a} IS NULL OR ${validate(a)} OR ${b} IS NULL OR ${validate(b)} OR ${a}${collation} IS DISTINCT FROM ${b}${collation} THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;`), name);
    } else if (name !== 'v_expectation_hashes') assert.ok(part.includes(`${a} IS NULL OR ${b} IS NULL`), name);
    if (type.startsWith('NUMERIC')) assert.ok(part.includes(`scale(${a}) IS DISTINCT FROM pg_catalog.scale(${b})`), name);
  }
  for (const side of ['p_before', 'p_after']) {
    assert.ok(body.includes(`${side}.v_expectation_hashes[v_i][v_j] IS NULL AND (v_j<>10 OR ${side}.v_expectation_text[v_i][1] COLLATE "C" IS DISTINCT FROM ${side}.route_historical_expectation COLLATE "C")`));
    assert.ok(body.includes(`${side}.v_installer_keys[v_i][1] COLLATE "C" IS DISTINCT FROM ${side}.v_expectation_text[v_i][1] COLLATE "C"`));
    for (const role of ['current', 'historical']) assert.ok(body.includes(`${side}.v_expectation_text[v_i][1] COLLATE "C" IS DISTINCT FROM ${side}.route_${role}_expectation COLLATE "C"`));
    assert.ok(body.includes(`${side}.v_expectation_text[1][1] COLLATE "C" IS NOT DISTINCT FROM ${side}.v_expectation_text[2][1] COLLATE "C"`));
    assert.ok(body.includes(`${side}.route_current_expectation COLLATE "C" IS NOT DISTINCT FROM ${side}.route_historical_expectation COLLATE "C"`));
  }
  assert.doesNotMatch(segments.find(m => m[1] === 'v_installer_facts')![2], /v_j<>3/);
  assert.match(body, /array_length\(p_before\.v_control_baseline_source_numbers,1\) IS DISTINCT FROM pg_catalog\.array_length\(p_before\.v_control_baseline_inventory,1\)/);
  assert.match(body, /array_length\(p_after\.v_control_baseline_source_enabled,1\) IS DISTINCT FROM pg_catalog\.array_length\(p_after\.v_control_baseline_inventory,1\)/);
  assert.match(body, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN TRUE;[^\n]*\s*EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.doesNotMatch(body.replace(/--[^\n]*/g, ''), /\bEXECUTE\b|\b(?:JSON|JSONB|digest|hash|to_json|row_to_json)\s*\(/i);
  assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`));
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.match(roles, new RegExp(`REVOKE ALL ON FUNCTION ${signature.replace(/[().]/g, '\\$&')} FROM PUBLIC,pro273_selection_owner,[^;]*enta_outbox_worker;`));
  assert.doesNotMatch(sql + roles, /GRANT[^;]*pro273_qualifier_snapshot_equal/i);
});

test('inert comparator model binds nullable historical hashes to identity and preserves shape and scale', () => {
  // Illustrative model only; it does not parse or execute SQL.
  type Row = { key: string; id: string; effective: string | null; stored: string | null };
  type Snapshot = { current: string; historical: string; rows: Row[]; dimensions: number[]; lower: number[]; amount: string };
  const make = (order: string[]): Snapshot => ({ current: 'E', historical: 'H', rows: order.map(id => ({ key: id, id, effective: 'effective', stored: id === 'H' ? null : 'stored' })), dimensions: [2, 10], lower: [1, 1], amount: '1.00' });
  const valid = (s: Snapshot) => s.current !== s.historical && s.dimensions.join(',') === '2,10' && s.lower.join(',') === '1,1' && s.rows.length === 2 && new Set(s.rows.map(r => r.id)).size === 2 && s.rows.every(r => r.key === r.id && [s.current, s.historical].includes(r.id) && r.effective !== null && (r.stored !== null || r.id === s.historical));
  const compare = (a: Snapshot, b: Snapshot) => valid(a) && valid(b) && a.current === b.current && a.historical === b.historical && a.rows.every((r, i) => r.key === b.rows[i].key && r.id === b.rows[i].id && r.effective === b.rows[i].effective && r.stored === b.rows[i].stored) && a.amount === b.amount;
  const mutate = (s: Snapshot, id: string, update: Partial<Row>): Snapshot => ({...s, rows: s.rows.map(r => r.id === id ? {...r, ...update} : {...r})});
  for (const order of [['E', 'H'], ['H', 'E']]) {
    const a = make(order), b = make(order);
    assert.equal(compare(a, b), true);
    for (const role of ['E', 'H']) {
      assert.equal(compare(mutate(a, role, {effective:null}), mutate(b, role, {effective:null})), false);
      assert.equal(compare(a, mutate(b, role, {effective:null})), false);
    }
    assert.equal(compare(mutate(a, 'E', {stored:null}), mutate(b, 'E', {stored:null})), false);
    assert.equal(compare(a, mutate(b, 'H', {stored:'stored'})), false);
    assert.equal(compare(mutate(a, 'H', {stored:'one'}), mutate(b, 'H', {stored:'one'})), true);
    assert.equal(compare(mutate(a, 'H', {stored:'one'}), mutate(b, 'H', {stored:'two'})), false);
    for (const invalid of [mutate(a, 'E', {id:'unknown', key:'unknown'}), mutate(a, 'E', {id:'H', key:'H'}), mutate(a, 'E', {key:'H'}), {...a, historical:'E'}, {...a, dimensions:[1, 20]}, {...a, lower:[0, 1]}]) {
      assert.equal(compare(invalid, invalid), false);
      assert.equal(compare(a, invalid), false);
    }
    assert.equal(compare(a, {...b, amount:'1.0'}), false);
  }
});

test('denied allocation and physical-domain snapshots map stored typed facts', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const snapshot = helper.split('-- Selected allocation and physical-domain scalars only;')[1].split('-- Each ID is unique;')[0];
  const groups = [
    ['a','v_allocation_text','TEXT','allocationId partitionId controlId physicalIdentity physicalProofIdentity credentialEpoch launchEpoch namespace project deployment environment sourceIdentity inputClaimId sessionClaimId eventId bootstrapKind trustId controlChargeKind controlChargeEventKey'],
    ['a','v_allocation_hashes','TEXT','layoutCoreHash coreHash bootstrapRecordHash bootstrapEvidenceHash trustRecordHash chargeBindingHash capturedHash evidenceHash'],
    ['a','v_allocation_oids','OID','principalOid publisherPrincipalOid'], ['a','v_allocation_names','NAME','principalName publisherPrincipalName'],
    ['a','v_allocation_numbers','BIGINT','trustGeneration capturedLength evidenceLength'], ['a','v_allocation_times','TIMESTAMPTZ','validFrom validUntil'],
    ['a','v_allocation_closures','TEXT','sourceClosureHash supervisorClosureHash driverClosureHash nativeClosureHash runtimeClosureHash executableHash installationClosureHash'],
    ['a','v_allocation_location','TEXT','host boot parentProcessTree'],
    ['a','v_allocation_resources','NUMERIC','reservedBackendBytes reservedSharedBytes reservedTemporaryBytes maxAllocationBytes stackBytes parentBytes maxInputBytes maxOutputBytes concurrency maxProcessCount maxBackendCount maxLaunchAttempts maxPublicationEvents maxArenaBodies maxArenaTokens maxTempCatalogEvents maxDurableBytes timeoutMillis backendProcessBytes qualifierRuntimeBytes launcherSupervisorBytes retainedParentBytes driverSocketIpcBytes inputEvidenceSerializationBytes primitiveParserCacheBytes rollbackCleanupBytes sharedRuntimeBytes'],
    ['d','v_physical_capacity','NUMERIC','backendCapacity sharedCapacity baselineBackend baselineShared'], ['d','v_physical_fence','BIGINT','nextFence'],
    ['d','v_physical_text','TEXT','physicalIdentity proofIdentity'], ['d','v_physical_hashes','TEXT','evidenceHash'], ['d','v_physical_enabled','BOOLEAN','enabled'],
  ] as const;
  for (const [alias, name, type, list] of groups) {
    const fields = list.split(' ');
    const schema = (alias === 'a' ? sql : supplier).split(`CREATE TABLE public."${alias === 'a' ? 'Pro273QualifierAllocation' : 'Pro262CapacityPhysicalDomain'}" (`)[1].split('\n);')[0];
    for (const field of fields) {
      assert.match(schema, new RegExp(`"${field}" ${type} (?:NOT NULL|PRIMARY KEY)`), field);
      assert.ok(snapshot.includes(`${alias}."${field}" AS ${alias}_${field}`), field);
    }
    assert.ok(snapshot.includes(`${name}:=ARRAY[${fields.map(field => `v_source.${alias}_${field}`).join(',')}];`));
    assert.ok(snapshot.includes(`array_length(${name},1) IS DISTINCT FROM ${fields.length}`));
    assert.ok(snapshot.includes(`${name}[v_snapshot_i] IS NULL`));
  }
  assert.match(snapshot, /octet_length\(v_allocation_text\[v_snapshot_i\]\) NOT BETWEEN 1 AND CASE WHEN v_snapshot_i IN \(16,19\) THEN 512 ELSE 256 END/);
  for (const name of ['v_allocation_hashes','v_physical_hashes']) assert.ok(snapshot.includes(`${name}[v_snapshot_i] !~ '^[a-f0-9]{64}$'`));
  assert.doesNotMatch(snapshot, /\b(?:JSONB|BYTEA|FOR UPDATE|FOR SHARE)\b/i);
  assert.match(helper, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(helper, /full relation lock schedule/);
  assert.match(helper, /post-lock and post-reentry reread/);
  // Illustrative per-fact mutation and bounds model; no SQL execution.
  const values: (string | number | boolean | null)[] = groups.flatMap(([, , type, list]) => list.split(' ').map(() => type === 'BOOLEAN' ? false : type === 'OID' || type === 'BIGINT' ? 1 : 'x'));
  const equal = (a: typeof values, b: typeof values) => a.length === b.length && a.every((value,i) => value !== null && b[i] !== null && value === b[i]);
  assert.equal(equal(values, [...values]), true);
  values.forEach((value,i) => { const changed = [...values]; changed[i] = typeof value === 'boolean' ? !value : typeof value === 'number' ? value + 1 : 'y'; assert.equal(equal(values, changed), false); changed[i] = null; assert.equal(equal(changed, changed), false); });
  const validText = (v: string, max: number) => Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= max;
  for (const max of [256,512]) { assert.equal(validText('x'.repeat(max), max), true); assert.equal(validText('x'.repeat(max+1), max), false); assert.equal(validText('', max), false); }
});

test('allocation resource and physical capacity retention rejects invalid values and preserves scale', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  for (const [name, count, positive] of [['v_allocation_resources',27,18],['v_physical_capacity',4,2]] as const) {
    for (const [source, index] of [[helper,'v_snapshot_i'],[comparator,'v_i']] as const) {
      for (const prefix of source === helper ? [''] : ['p_before.','p_after.']) {
        const cell = prefix + name + '[' + index + ']';
        for (const term of [cell + ' IS NULL',cell + "::TEXT IN ('NaN','Infinity','-Infinity')",cell + '<>pg_catalog.trunc(' + cell + ')',cell + '<0',index + '<=' + positive + ' AND ' + cell + '=0']) assert.ok(source.includes(term), term);
      }
    }
    assert.ok(comparator.includes('pg_catalog.scale(p_before.' + name + '[v_i]) IS DISTINCT FROM pg_catalog.scale(p_after.' + name + '[v_i])'));
    assert.ok(helper.includes('array_length(' + name + ',1) IS DISTINCT FROM ' + count));
  }
  for (const side of ['p_before.','p_after.']) {
    assert.ok(comparator.includes(side + 'v_physical_fence[v_i]<0'));
    assert.ok(comparator.includes('octet_length(' + side + 'v_allocation_location[v_i]) NOT BETWEEN 1 AND 256'));
    assert.ok(comparator.includes(side + "v_allocation_closures[v_i] !~ '^[a-f0-9]{64}$'"));
  }
  const valid = (value: string | null, positive: boolean) => value !== null && /^(?:0|[1-9]\d*)(?:\.0+)?$/.test(value) && (!positive || !/^0(?:\.0+)?$/.test(value));
  for (const value of [null,'NaN','Infinity','-Infinity','-1','1.1']) assert.equal(valid(value, false), false);
  assert.equal(valid('0',false),true); assert.equal(valid('0',true),false); assert.equal(valid('1.0',true),true);
  const exact = (a: string | null,b: string | null) => valid(a,false) && valid(b,false) && a === b;
  assert.equal(exact('1','1.0'),false); assert.equal(exact(null,null),false); assert.equal(exact('1.0','1.0'),true);
});

test('descriptor companion projection retains exact typed fields and denies changed or null cells', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const branch = helper.split('-- Retain the four companion rows')[1].split("ELSE RAISE EXCEPTION 'SELECTION_UNAVAILABLE'; END IF;")[0];
  const expected = [
    'l.controlId l.expectationId l.dispatchAttemptId l.sessionClaimId l.inputClaimId l.eventId q.controlId q.observerGroupProof st.controlId st.state st.connectionState t.controlId t.fromState t.toState t.fromConnectionState t.toConnectionState t.receiptId',
    'l.coreHash q.coreHash t.bindingHash', 'st.transitionOrdinal t.transitionOrdinal', 'l.constructionTransactionId', 't.occurredAt',
  ].map(x => x.split(' '));
  const actual = [...branch.matchAll(/ARRAY\[([^\]]+)\]/g)].map(m => [...m[1].matchAll(/(l|q|st|t)\."([^"]+)"/g)].map(x => x[1]+'.'+x[2]));
  assert.deepEqual(actual, expected);
  for (const term of [
    '(p."controlId",p."coreHash")=(d."controlId",d."descriptorCoreHash")',
    '(l."controlId",l."coreHash",l."sessionClaimId",l."inputClaimId",l."eventId")=(p."controlId",p."coreHash",p."sessionClaimId",p."inputClaimId",p."eventId")',
    '(q."controlId",q."coreHash")=(l."controlId",l."coreHash")',
    'st."controlId"=d."controlId"', '(t."controlId",t."transitionOrdinal")=(d."controlId",1)', 'd."controlId"=v_route.control_id',
  ]) assert.ok(branch.includes(term), term);
  assert.doesNotMatch(branch, /capturedBytes|evidenceBytes|JSON|pg_current_xact_id|FOR\s+(?:UPDATE|SHARE)/i);
  for (const name of ['text','hashes','numbers']) assert.match(branch, new RegExp('unnest\\(v_descriptor_companion_'+name+'\\).*?x IS NULL'));
  for (const name of ['transactions','times']) assert.ok(branch.includes('v_descriptor_companion_'+name+'[1] IS NULL'));
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  for (const [name, type, size] of [['text','TEXT',17],['hashes','TEXT',3],['numbers','BIGINT',2],['transactions','xid8',1],['times','TIMESTAMPTZ',1]] as const) {
    const field = 'v_descriptor_companion_'+name;
    const part = comparator.split('-- field: '+field)[1].split(/ -- field: |\n IF p_before\.v_descriptor_presence IS DISTINCT FROM ARRAY/)[0];
    for (const side of ['p_before','p_after']) {
      assert.ok(part.includes(side+'.'+field+' IS NULL'));
      assert.ok(part.includes(side+'.'+field+'[v_i] IS NULL'));
      assert.ok(part.includes('array_length('+side+'.'+field+',1) IS DISTINCT FROM '+size));
    }
    const collate = type === 'TEXT' ? ' COLLATE "C"' : '';
    assert.ok(part.includes('p_before.'+field+'[v_i]'+collate+' IS DISTINCT FROM p_after.'+field+'[v_i]'+collate));
  }
  // Inert model of SQL null/shape/equality semantics; it does not execute SQL.
  const compare = (present: boolean, a: (string | number | null)[][] | null, b: (string | number | null)[][] | null) => {
    if (!present) return a === null && b === null;
    if (a === null || b === null || a.length !== 5 || b.length !== 5) return false;
    return [17,3,2,1,1].every((length,i) => a[i]?.length === length && b[i]?.length === length && a[i].every((v,j) => v !== null && b[i][j] !== null && v === b[i][j]));
  };
  const sample: (string | number | null)[][] = [Array(17).fill('fact'), Array(3).fill('a'.repeat(64)), [4,1], ['xid'], ['time']];
  assert.equal(compare(false,null,null),true);
  assert.equal(compare(false,sample,null),false);
  assert.equal(compare(true,null,null),false);
  assert.equal(compare(true,sample,sample),true);
  for (let i=0;i<sample.length;i++) for (let j=0;j<sample[i].length;j++) {
    const changed=sample.map(row => [...row]); changed[i][j]='changed'; assert.equal(compare(true,sample,changed),false);
    changed[i][j]=null; assert.equal(compare(true,sample,changed),false); assert.equal(compare(true,changed,changed),false);
  }
  const initial=sample.map(row => [...row]); initial[2]=[1,1];
  assert.equal(compare(true,initial,initial),true);
  assert.equal(compare(true,sample,initial),false);
});

test('companion text router bounds apply to every cell in discovery and both comparator inputs', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const discovery = sql.split('-- Retain the four companion rows')[1].split('ELSE RAISE EXCEPTION')[0];
  const comparison = sql.split('-- field: v_descriptor_companion_text')[1].split('-- field: v_descriptor_companion_hashes')[0];
  assert.match(discovery, /unnest\(v_descriptor_companion_text\) x WHERE x IS NULL OR pg_catalog\.octet_length\(x\) NOT BETWEEN 1 AND 256/);
  for (const side of ['p_before', 'p_after']) {
    assert.ok(comparison.includes(`${side}.v_descriptor_companion_text[v_i] IS NULL`));
    assert.ok(comparison.includes(`pg_catalog.octet_length(${side}.v_descriptor_companion_text[v_i]) NOT BETWEEN 1 AND 256`));
  }
  assert.match(discovery, /provisional compatibility restriction,[\s\S]*not qualified detoast or resource safety/);
  // Model only the router bounds and presence/equality, independently of schema constraints.
  type Cell = string | null;
  const retain = (presence: boolean[], cells: Cell[] | null): Cell[] | null | undefined => {
    if (presence.length !== 6) return undefined;
    if (presence.every(x => !x)) return cells === null ? null : undefined;
    if (!presence.every(Boolean) || cells === null || cells.length !== 17 ||
        !cells.every(v => v !== null && Buffer.byteLength(v, 'utf8') >= 1 && Buffer.byteLength(v, 'utf8') <= 256)) return undefined;
    return cells;
  };
  const compare = (a: Cell[] | null, b: Cell[] | null, present: boolean) => {
    const bits = Array(6).fill(present) as boolean[];
    const left = retain(bits, a), right = retain(bits, b);
    return left !== undefined && right !== undefined && (left === null ? right === null : right !== null && left.every((v, i) => v === right[i]));
  };
  const bits = Array(6).fill(true) as boolean[];
  const cells: Cell[] = ['control','expectation','dispatch','session','input','event','control','proof','control','SEALED','BOUND','control','RESERVED','OCCUPIED','OPENING','BOUND','receipt'];
  assert.deepEqual(retain(bits, cells), cells);
  assert.equal(compare(cells, [...cells], true), true);
  assert.equal(retain(Array(6).fill(false), null), null);
  assert.equal(retain([true,false,true,true,true,true], cells), undefined);
  assert.equal(compare(null, null, false), true);
  assert.equal(compare(cells, null, false), false);
  assert.equal(compare(null, null, true), false);
  for (let i = 0; i < cells.length; i++) {
    const boundary = [...cells]; boundary[i] = 'é'.repeat(128);
    assert.equal(Buffer.byteLength(boundary[i]!, 'utf8'), 256);
    assert.deepEqual(retain(bits, boundary), boundary, `cell ${i + 1}: 256`);
    assert.equal(compare(boundary, [...boundary], true), true, `cell ${i + 1}: equal 256`);
    for (const invalid of ['é'.repeat(128) + 'x', '', null]) {
      const changed = [...cells]; changed[i] = invalid;
      assert.equal(retain(bits, changed), undefined, `cell ${i + 1}: discovery`);
      assert.equal(compare(changed, changed, true), false, `cell ${i + 1}: both`);
      assert.equal(compare(changed, cells, true), false, `cell ${i + 1}: before`);
      assert.equal(compare(cells, changed, true), false, `cell ${i + 1}: after`);
    }
  }
});

test('historical baseline and original L/A publications retain schema-typed fixed-route facts', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const route = helper.split('SELECT e."expectationId" AS current_expectation')[1].split('-- Selected allocation and physical-domain scalars only')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  const groups = [
    ['text','TEXT', {base:'baselineId purpose physicalIdentity physicalProofIdentity sourceClosureHash installationClosureHash expectedFutureLayoutCoreHash credentialEpoch launchEpoch host boot processTree parentProcessTree coreHash',prov:'baselineId coreHash bootstrapKind bootstrapRecordHash bootstrapEvidenceHash trustId trustRecordHash inputClaimId sessionClaimId eventId capturedHash evidenceHash chargeKind chargeEventKey chargeBindingHash',lp:'inputClaimId admissionReceiptId eventId baselineId baselineCoreHash physicalIdentity physicalProofIdentity layoutCoreHash receiptHash',ap:'inputClaimId admissionReceiptId eventId baselineId baselineCoreHash layoutInputClaimId allocationId allocationCoreHash receiptHash',lb:'baselineId baselineCoreHash layoutInputClaimId'}],
    ['numbers','NUMERIC',{base:'reservedBackendBytes reservedSharedBytes reservedTemporaryBytes maxInputBytes maxOutputBytes maxAllocationBytes stackBytes parentBytes maxProcessCount maxBackendCount maxLaunchAttempts maxEvents backendProcessBytes qualifierRuntimeBytes launcherSupervisorBytes retainedParentBytes driverSocketIpcBytes inputEvidenceSerializationBytes primitiveParserCacheBytes rollbackCleanupBytes sharedRuntimeBytes'}],
    ['oids','OID',{base:'principalOid',prov:'publisherPrincipalOid'}], ['names','NAME',{base:'principalName',prov:'publisherPrincipalName'}], ['bigints','BIGINT',{prov:'trustGeneration capturedLength evidenceLength'}], ['times','TIMESTAMPTZ',{base:'validFrom validUntil'}], ['transactions','xid8',{prov:'constructionTransactionId',lp:'constructionTransactionId',ap:'constructionTransactionId',lb:'constructionTransactionId'}],
  ] as const;
  const tables: Record<string,string> = {base:'Pro273ControlPlaneBaseline',prov:'Pro273ControlPlaneBaselineProvenance',lp:'Pro273InitialLayoutPublication',ap:'Pro273InitialAllocationPublication',lb:'Pro273InitialBaselineLayoutBinding'};
  for (const [group,type, sources] of groups) {
    const fields = Object.entries(sources).flatMap(([alias,list]) => list.split(' ').map(field => [alias,field]));
    for (const [alias,field] of fields) {
      const schema = sql.split(`CREATE TABLE public."${tables[alias]}" (`)[1].split('\n);')[0];
      assert.match(schema, new RegExp(`"${field}" ${type} (?:NOT NULL|PRIMARY KEY)`), `${alias}.${field}`);
      assert.ok(route.includes(`${alias}."${field}" AS history_${alias}_${field}`), `${alias}.${field}`);
    }
    const name = `v_history_${group}`;
    assert.ok(route.includes(`${name}:=ARRAY[${fields.map(([a,f]) => `v_route.history_${a}_${f}`).join(',')}];`));
    const part = comparator.split(`-- field: ${name}`)[1].split(' -- field:')[0];
    for (const side of ['p_before','p_after']) {
      assert.ok(part.includes(`array_length(${side}.${name},1) IS DISTINCT FROM ${fields.length}`));
      assert.ok(part.includes(`${side}.${name}[v_i] IS NULL`));
    }
    const c = type === 'TEXT' || type === 'NAME' ? ' COLLATE "C"' : '';
    assert.ok(part.includes(`p_before.${name}[v_i]${c} IS DISTINCT FROM p_after.${name}[v_i]${c}`));
    if (type === 'NUMERIC') assert.ok(part.includes(`scale(p_before.${name}[v_i]) IS DISTINCT FROM pg_catalog.scale(p_after.${name}[v_i])`));
  }
  for (const term of [
    '(ap."allocationId",ap."allocationCoreHash",ap."inputClaimId")=(a."allocationId",a."coreHash",a."inputClaimId")',
    '(lb."baselineId",lb."baselineCoreHash",lb."layoutInputClaimId")=(ap."baselineId",ap."baselineCoreHash",ap."layoutInputClaimId")',
    '(lp."baselineId",lp."baselineCoreHash",lp."inputClaimId",lp."physicalIdentity",lp."physicalProofIdentity",lp."layoutCoreHash",lp."eventId")=(lb."baselineId",lb."baselineCoreHash",lb."layoutInputClaimId",l."physicalIdentity",l."physicalProofIdentity",l."coreHash",l."eventId")',
    '(prov."baselineId",prov."coreHash")=(base."baselineId",base."coreHash")', 'hist."expectationId" AS historical_expectation',
  ]) assert.ok(route.includes(term), term);
  assert.ok(helper.includes('e."expectationId" AS current_expectation'));
  assert.doesNotMatch(route, /(?:base|prov|lp|ap|lb)\."(?:capturedBytes|evidenceBytes|target|record)"|FOR\s+(?:UPDATE|SHARE)|pg_current_xact_id/i);
  assert.match(helper, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(helper, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection/);
  assert.match(comparator, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(comparator, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN TRUE/);
  // Inert shape and mutation model, including same-row aliases and numeric scale.
  type Fact = string | null;
  const equal = (a: Fact[], b: Fact[]) => a.length === b.length && a.every((x,i) => x !== null && b[i] !== null && x === b[i]);
  for (const order of [['E','H'],['H','E']]) for (const publication of ['L','A']) {
    const original: Fact[] = [order[0],order[1],publication,'baseline','same-baseline','producer','xid','1.00'];
    assert.equal(equal(original,[...original]),true);
    for (let i=0;i<original.length;i++) {
      const changed=[...original]; changed[i] = i===7 ? '1.0' : `${changed[i]}-changed`;
      assert.equal(equal(original,changed),false); changed[i]=null;
      assert.equal(equal(original,changed),false); assert.equal(equal(changed,changed),false);
    }
  }
});

test('history baseline numeric cells follow finite integral schema and preserve scale', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneBaseline" (')[1].split('\n);')[0];
  const discovery = sql.split('v_history_numbers:=ARRAY[')[1].split('v_history_oids:=')[0];
  const comparison = sql.split('-- field: v_history_numbers')[1].split('-- field: v_history_oids')[0];
  const fields = discovery.split('];')[0].split(',').map(s => s.trim().replace('v_route.history_base_', ''));
  assert.equal(fields.length, 21);
  fields.forEach((field, i) => assert.ok(schema.includes(`"${field}" ${i < 12 ? 'NUMERIC NOT NULL CHECK ("' + field + '" > 0' : 'NUMERIC NOT NULL CHECK ("' + field + '" >= 0'}`), field));
  for (const [part, index, sides] of [[discovery,'v_snapshot_i',['v_history_numbers']], [comparison,'v_i',['p_before.v_history_numbers','p_after.v_history_numbers']]] as const) {
    assert.doesNotMatch(part, /9223372036854775807|scale\([^)]*\)>19/);
    for (const side of sides) for (const fragment of [`${side}[${index}] IS NULL`, `${side}[${index}]::TEXT IN ('NaN','Infinity','-Infinity')`, `${side}[${index}]<>pg_catalog.trunc(${side}[${index}])`, `${side}[${index}]<0`, `(${index}<=12 AND ${side}[${index}]=0)`]) assert.ok(part.includes(fragment), fragment);
  }
  assert.ok(comparison.includes('p_before.v_history_numbers[v_i] IS DISTINCT FROM p_after.v_history_numbers[v_i]'));
  assert.ok(comparison.includes('pg_catalog.scale(p_before.v_history_numbers[v_i]) IS DISTINCT FROM pg_catalog.scale(p_after.v_history_numbers[v_i])'));
  assert.ok(discovery.includes('resource and allocation qualification remains held'));
  // Inert decimal-string model; no SQL or runtime execution.
  const valid = (s: string | null, positive: boolean) => {
    if (s === null || !/^[+-]?\d+(?:\.\d+)?$/.test(s)) return false;
    const [integer, fraction = ''] = s.replace(/^[+-]/, '').split('.');
    const zero = /^0+$/.test(integer) && !/[1-9]/.test(fraction);
    return !/[1-9]/.test(fraction) && !(s.startsWith('-') && !zero) && (!positive || !zero);
  };
  const equal = (a: string | null,b: string | null, positive: boolean) => valid(a,positive) && valid(b,positive) && BigInt(a!.split('.')[0]) === BigInt(b!.split('.')[0]) && (a!.split('.')[1]?.length ?? 0) === (b!.split('.')[1]?.length ?? 0);
  for (const positive of [true,false]) {
    for (const value of ['+42','99999999999999999999999999999999999999','1.00000000000000000000']) assert.equal(equal(value,value,positive),true,value);
    for (const value of ['-1','NaN','Infinity','-Infinity','1.01',null]) assert.equal(valid(value,positive),false,String(value));
    assert.equal(equal('1.00000000000000000000','1.0',positive),false);
    assert.equal(equal(null,'1',positive),false); assert.equal(equal('1',null,positive),false);
    assert.equal(equal('-1','-1',positive),false);
  }
  assert.equal(valid('0',true),false); assert.equal(valid('0',false),true); assert.equal(valid('-0.00',false),true);
});

test('history text cell roles use source hashes and derived key bounds', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const discovery = sql.split('v_history_text:=ARRAY[')[1].split('v_history_numbers:=')[0];
  const comparison = sql.split('-- field: v_history_text')[1].split('-- field: v_history_numbers')[0];
  const fields = discovery.split('];')[0].split(',').map(s => s.trim().replace('v_route.history_', ''));
  const hashes = [5,6,7,14,16,18,19,21,25,26,29,34,37,38,43,46,47,49];
  assert.deepEqual(fields.flatMap((f,i) => /Hash$/.test(f) ? [i+1] : []), hashes);
  assert.equal(fields[16], 'prov_bootstrapKind'); assert.equal(fields[27], 'prov_chargeEventKey');
  for (const [part,index] of [[discovery,'v_snapshot_i'],[comparison,'v_i']] as const) {
    assert.ok(part.includes(`${index}=ANY(ARRAY[${hashes.join(',')}])`));
    assert.ok(part.includes(`${index}=17 THEN 288 ELSE 256 END`));
    assert.ok(part.includes("pg_catalog.convert_to(")); assert.ok(part.includes(",'UTF8')"));
    assert.ok(part.includes("!~ '^[a-f0-9]{64}$'"));
    assert.doesNotMatch(part, /BETWEEN 1 AND 512|THEN 276/);
    assert.ok(part.includes('compatibility remains held'));
  }
  assert.ok(sql.includes("WHEN 'QUALIFIER_BASELINE_INITIAL' THEN 'SELECTION_CONTROL_PLANE_INITIAL:' ELSE 'SELECTION_CONTROL_PLANE_REVOKE:' END||v_id"));
  assert.ok(sql.includes('"chargeEventKey"="trustId"||\':\'||"generation"::TEXT'));
  const textValid = (i:number,s:string|null) => s !== null && (hashes.includes(i) ? /^[a-f0-9]{64}$/.test(s) : Buffer.byteLength(s)>=1 && Buffer.byteLength(s)<=(i===17?288:256));
  for (let i=1;i<=50;i++) { assert.equal(textValid(i,null),false); assert.equal(textValid(i,hashes.includes(i)?'a'.repeat(64):'x'),true); }
  assert.equal(textValid(17,'x'.repeat(288)),true); assert.equal(textValid(17,'x'.repeat(289)),false);
  assert.equal(textValid(28,'x'.repeat(256)),true); assert.equal(textValid(28,'x'.repeat(276)),false);
  assert.equal(textValid(28,'é'.repeat(128)),true); assert.equal(textValid(28,'é'.repeat(129)),false);
  assert.equal(textValid(5,'A'.repeat(64)),false); assert.equal(textValid(5,'a'.repeat(63)),false);
  const baselineKey = 'SELECTION_CONTROL_PLANE_INITIAL:'+'x'.repeat(256);
  assert.equal(textValid(17,baselineKey),true);
  const provisioningKey = 'x'.repeat(256)+':'+'9223372036854775807';
  assert.equal(Buffer.byteLength(provisioningKey),276);
  assert.equal(textValid(28,provisioningKey),false); // This field is the installer charge, not provisioning provenance.
});
test('PRO311 installer binding retains seven stored scalars per route and slot', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273InstallerSlotBinding" (')[1].split('\n);')[0];
  const discover = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const projection = discover.split('FOR v_key IN SELECT x.id FROM (VALUES (v_route.current_expectation)')[1].split('INTO STRICT v_installer')[0];
  const retained = discover.split('-- Preserve both claim/reservation roles per route')[1].split('-- Both table schemas require')[0];
  const compare = sql.split('-- field: v_installer_binding_text')[1].split('-- field: v_installer_slot_hashes')[0];
  const fields = ['reservationId','expectationId','credentialEpoch','launchEpoch','phase','expectedEventKey','bindingKind'];
  assert.doesNotMatch(schema, /"creationTransactionId"/);
  for (const [alias,role] of [['cb','constructor'],['ob','observation']] as const) {
    for (const field of fields) {
      assert.ok(schema.includes(`"${field}" TEXT`));
      assert.ok(projection.includes(`${alias}."${field}" AS ${role}_binding_${field}`));
      assert.ok(retained.includes(`v_installer.${role}_binding_${field}`));
    }
  }
  assert.ok(retained.includes('v_installer_binding_text:=pg_catalog.array_cat'));
  assert.ok(discover.includes('array_length(v_installer_binding_text,1) IS DISTINCT FROM 4 OR pg_catalog.array_length(v_installer_binding_text,2) IS DISTINCT FROM 7'));
  assert.ok(discover.includes('v_installer_binding_text[v_snapshot_i:v_snapshot_i][1:7]'));
  for (const side of ['p_before','p_after']) {
    assert.ok(compare.includes(`array_length(${side}.v_installer_binding_text,1) IS DISTINCT FROM 4`));
    assert.ok(compare.includes(`array_length(${side}.v_installer_binding_text,2) IS DISTINCT FROM 7`));
    assert.ok(compare.includes(`octet_length(${side}.v_installer_binding_text[v_i][v_j]) NOT BETWEEN 1 AND 256`));
    for (const [col,source] of [[1,'v_installer_slot_text[v_i][5]'],[2,'v_expectation_text[(v_i+1)/2][1]'],[3,'v_expectation_text[(v_i+1)/2][10]'],[4,'v_expectation_text[(v_i+1)/2][11]'],[5,'v_installer_slot_text[v_i][4]'],[6,'v_installer_slot_text[v_i][3]']] as const)
      assert.ok(compare.includes(`${side}.v_installer_binding_text[v_i][${col}] COLLATE "C" IS DISTINCT FROM ${side}.${source} COLLATE "C"`));
    assert.ok(compare.includes(`${side}.v_installer_binding_text[v_i][7]`));
  }
  assert.ok(compare.includes('p_before.v_installer_binding_text[v_i][v_j] COLLATE "C" IS DISTINCT FROM p_after.v_installer_binding_text[v_i][v_j] COLLATE "C"'));
  assert.match(discover, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  const rows = ['one','two'].flatMap(route => ['constructor','observation'].map(role => [
    `${route}-${role}`, route, `${route}-credential`, `${route}-launch`, `${role}-phase`, `${role}-event`,
    role === 'constructor' ? 'INSTALLER_CONSTRUCTOR_INPUT' : 'INSTALLER_OBSERVATION',
  ]));
  const same = (before: (string | null)[][], after: (string | null)[][]) => before.length === 4 && after.length === 4 && before.every((row,i) => row.length === 7 && after[i].length === 7 && row.every((cell,j) => typeof cell === 'string' && Buffer.byteLength(cell) >= 1 && Buffer.byteLength(cell) <= 256 && cell === after[i][j]));
  assert.equal(same(rows, rows.map(row => [...row])), true);
  for (let i=0; i<4; i++) for (let j=0; j<7; j++) {
    const changed = rows.map(row => [...row]); changed[i][j] += '-changed';
    assert.equal(same(rows, changed), false);
    const missing: (string | null)[][] = rows.map(row => [...row]); missing[i][j] = null;
    assert.equal(same(rows, missing), false);
  }
  assert.equal(same(rows, rows.slice(1)), false);
});

test('PRO311 original binding scalar projection retains and compares both routes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const entry = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('END $pro273_snapshot_equal$')[0];
  const type = sql.split('CREATE TYPE public.pro273_qualifier_discovery_snapshot AS (')[1].split(');')[0];
  const route = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  const select = route.split('INTO STRICT v_history')[0];
  const fields = ['reservationId','creationTransactionId','baselineId','purpose','eventId','trustId','trustGeneration','chargeKind','chargeEventKey','chargeBindingHash'];
  for (const field of fields) assert.ok(select.includes(`b."${field}" AS initial_binding_`), field);
  for (const field of ['kind','bootstrapKind','expectedCoreHash','expectedEvidenceHash']) assert.ok(select.includes(`b."target"->>'${field}' AS initial_binding_target_`), field);
  const mappings = [
    ['text', ['reservation','baseline','purpose','event','trust','charge_kind','charge_event','target_kind','target_bootstrap']],
    ['hashes', ['charge_hash','target_core','target_evidence']],
    ['generation', ['generation']], ['xid', ['xid']],
  ] as const;
  for (const [name, aliases] of mappings) {
    const retained = route.split(`v_initial_binding_${name}:=pg_catalog.array_cat`)[1].split(';')[0];
    for (const alias of aliases) {
      const value = `v_history.initial_binding_${alias}`;
      assert.ok(retained.includes(value), value);
      assert.equal(retained.replace(value, 'REMOVED_ALIAS').includes(value), false, value);
    }
  }
  assert.ok(route.includes('JOIN public."Pro273ControlPlaneInputBinding" b ON'));
  assert.ok(route.includes('r."target" IS NOT DISTINCT FROM b."target"'));
  assert.ok(route.includes("'SELECTION_QUALIFIER_LAYOUT:'||v_route.physical_id"));
  assert.ok(route.includes("'SELECTION_QUALIFIER_ALLOCATION:'||v_route.allocation_id"));
  assert.ok(route.includes('v_history.initial_binding_target_bootstrap COLLATE "C" IS DISTINCT FROM v_key.target_bootstrap COLLATE "C"'));
  assert.match(route, /initial_binding_target_bootstrap\) NOT BETWEEN 1 AND 288/);
  assert.match(route, /initial_binding_charge_event\).*?initial_binding_target_kind/s);
  assert.match(route, /octet_length\(t.value\) NOT BETWEEN 1 AND 256/);
  for (const [name, dataType, width] of [['text','TEXT[][]',9],['hashes','TEXT[][]',3],['generation','BIGINT[]',0],['xid','xid8[]',0]] as const) {
    const variable = `v_initial_binding_${name}`;
    assert.ok(type.includes(`${variable} ${dataType}`));
    assert.ok(entry.includes(`${variable}:=pg_catalog.array_cat(${variable},`));
    assert.ok(entry.includes(`  ${variable},`));
    assert.ok(comparator.includes(`array_length(p_before.${variable},1) IS DISTINCT FROM 2`));
    assert.ok(comparator.includes(`array_length(p_after.${variable},1) IS DISTINCT FROM 2`));
    if (width) assert.ok(comparator.includes(`array_length(p_before.${variable},2) IS DISTINCT FROM ${width}`));
    assert.ok(comparator.includes(`p_before.${variable}[v_i]`));
    assert.ok(comparator.includes(`p_after.${variable}[v_i]`));
  }
  assert.match(comparator, /v_initial_binding_text\[v_i\]\[v_j\] COLLATE "C" IS DISTINCT FROM/);
  assert.match(comparator, /v_initial_binding_hashes\[v_i\]\[v_j\] COLLATE "C" IS DISTINCT FROM/);
  assert.match(comparator, /v_initial_binding_xid\[v_i\] IS DISTINCT FROM/);
  assert.match(comparator, /v_initial_binding_generation\[v_i\] IS DISTINCT FROM/);
  for (const part of [entry, comparator]) {
    assert.ok(part.includes('v_initial_binding_text[1][1] COLLATE "C" IS NOT DISTINCT FROM'));
    assert.ok(part.includes("'ALLOCATION'")); assert.ok(part.includes("'LAYOUT'"));
    assert.ok(part.includes("RAISE EXCEPTION 'SELECTION_UNAVAILABLE'"));
  }
  assert.doesNotMatch(select, /b\."target"\s+AS\s|SESSION_USER|current_user|pg_backend|FOR\s+(?:UPDATE|SHARE)/i);
  assert.match(entry, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection/);
  assert.ok(sql.startsWith('-- INCOMPLETE SOURCE CHECKPOINT. Installation remains prohibited under R6 STOP.'));
  const constructor = sql.split('CREATE FUNCTION public.pro273_qualifier_reserve_control(p_expectation_id TEXT,p_captured BYTEA)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA)')[0];
  assert.match(constructor, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*EXCEPTION WHEN OTHERS/);

  // Inert contract vectors; these do not parse or execute SQL.
  type Row = { text: string[]; hashes: string[]; generation: bigint; xid: bigint };
  const retain = (rows: Row[]) => rows.length === 2 && rows.every((row, i) => {
    const prefix = i ? 'SELECTION_QUALIFIER_LAYOUT:' : 'SELECTION_QUALIFIER_ALLOCATION:';
    const bootstrap = row.text[8];
    return row.text.length === 9 && row.hashes.length === 3 && row.text.every((v, j) => typeof v === 'string' && Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= (j === 8 ? 288 : 256)) && bootstrap.startsWith(prefix) && Buffer.byteLength(bootstrap.slice(prefix.length)) >= 1 && Buffer.byteLength(bootstrap.slice(prefix.length)) <= 256 && row.hashes.every(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) && typeof row.generation === 'bigint' && typeof row.xid === 'bigint';
  }) && rows[0].text[0] !== rows[1].text[0];
  const rows: Row[] = ['ALLOCATION','LAYOUT'].map((name, i) => ({ text: [`reservation${i}`,...Array.from({length: 7}, (_, j) => `${name}-${j}`),`SELECTION_QUALIFIER_${name}:id${i}`], hashes: Array(3).fill((i ? 'b' : 'a').repeat(64)), generation: BigInt(i + 1), xid: BigInt(i + 10) }));
  const clone = () => rows.map(row => ({ ...row, text: [...row.text], hashes: [...row.hashes] }));
  assert.ok(retain(rows)); assert.equal(retain(rows.slice(1)), false); assert.equal(retain([...rows, rows[0]]), false);
  const equal = (a: Row[], b: Row[]) => retain(a) && retain(b) && a.every((row, i) => row.text.every((v, j) => v === b[i].text[j]) && row.hashes.every((v, j) => v === b[i].hashes[j]) && row.generation === b[i].generation && row.xid === b[i].xid);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 9; j++) { const changed = clone(); changed[i].text[j] += 'x'; assert.equal(equal(rows, changed), false); const missing = clone(); (missing[i].text as (string | null)[])[j] = null; assert.equal(retain(missing), false); }
    for (let j = 0; j < 3; j++) { const changed = clone(); changed[i].hashes[j] = 'c'.repeat(64); assert.equal(equal(rows, changed), false); }
    for (const key of ['generation','xid'] as const) { const changed = clone(); changed[i][key]++; assert.equal(equal(rows, changed), false); }
    const max = clone(); max[i].text[8] = `SELECTION_QUALIFIER_${i ? 'LAYOUT' : 'ALLOCATION'}:` + 'x'.repeat(256); assert.ok(retain(max)); max[i].text[8] += 'x'; assert.equal(retain(max), false);
  }
  const alias = clone(); alias[1].text[0] = alias[0].text[0]; assert.equal(retain(alias), false);
  const wrongPrefix = clone(); wrongPrefix[0].text[8] = 'SELECTION_QUALIFIER_LAYOUT:id'; assert.equal(retain(wrongPrefix), false);
  const oversizedCharge = clone(); oversizedCharge[0].text[6] = 'x'.repeat(257); assert.equal(retain(oversizedCharge), false);
});

test('PRO311 original claim scalar projection retains and compares both routes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneInputClaim" (')[1].split('\n);')[0];
  const entry = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const route = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  const select = route.split('INTO STRICT v_history')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('END $pro273_snapshot_equal$')[0];
  const fields: Record<string,string> = {id:'inputClaimId',xid:'creationTransactionId',baseline:'baselineId',session:'sessionClaimId',reservation:'reservationId',purpose:'purpose',event:'eventId',charge_kind:'chargeKind',charge_event:'chargeEventKey',charge_hash:'chargeBindingHash'};
  for (const [alias,field] of Object.entries(fields)) {
    assert.match(schema, new RegExp(`"${field}" ${alias === 'xid' ? 'xid8' : 'TEXT'} (?:NOT NULL|PRIMARY KEY)`));
    assert.ok(select.includes(`c."${field}" AS initial_claim_${alias}`), field);
  }
  const targets: Record<string,string> = {kind:'kind',bootstrap:'bootstrapKind',core:'expectedCoreHash',evidence:'expectedEvidenceHash'};
  for (const [alias,field] of Object.entries(targets)) assert.ok(select.includes(`c."target"->>'${field}' AS initial_claim_target_${alias}`), field);
  for (const [name,aliases] of Object.entries({text:['id','baseline','session','reservation','purpose','event','charge_kind','charge_event','target_kind','target_bootstrap'],hashes:['charge_hash','target_core','target_evidence'],xid:['xid']})) {
    const retained = route.split(`v_initial_claim_${name}:=pg_catalog.array_cat`)[1].split(';')[0];
    for (const alias of aliases) assert.equal(retained.split(`v_history.initial_claim_${alias}`).length - 1, 1, alias);
    assert.deepEqual([...retained.matchAll(/v_history\.initial_claim_(\w+)/g)].map(m => m[1]), aliases);
    assert.ok(entry.includes(`  v_initial_claim_${name},`));
    assert.ok(comparator.includes(`-- field: v_initial_claim_${name}`));
  }
  assert.ok(route.includes('JOIN public."Pro273ControlPlaneInputClaim" c ON (c."inputClaimId",c."reservationId",c."baselineId",c."sessionClaimId",c."eventId",c."chargeKind",c."chargeEventKey",c."chargeBindingHash")=(r."inputClaimId",r."reservationId",r."baselineId",r."sessionClaimId",r."eventId",r."chargeKind",r."chargeEventKey",r."chargeBindingHash")'));
  assert.ok(route.includes('JOIN public."Pro273ControlPlaneInputBinding" b ON'));
  assert.ok(route.includes('r."target" IS NOT DISTINCT FROM c."target"'));
  assert.doesNotMatch(select, /c\."target"\s+AS\s|SESSION_USER|current_user|pg_backend|FOR\s+(?:UPDATE|SHARE)/i);
  for (const side of ['p_before','p_after']) for (const [i,role] of [[1,'ALLOCATION'],[2,'LAYOUT']] as const) {
    for (const [claim,key] of [[1,2],[3,5],[4,6],[6,4]]) assert.ok(comparator.includes(`${side}.v_initial_claim_text[${i}][${claim}] COLLATE "C" IS DISTINCT FROM ${side}.v_initial_keys[${i}][${key}] COLLATE "C"`));
    assert.ok(comparator.includes(`starts_with(${side}.v_initial_claim_text[${i}][10],'SELECTION_QUALIFIER_${role}:')`));
  }
  assert.ok(sql.startsWith('-- INCOMPLETE SOURCE CHECKPOINT. Installation remains prohibited under R6 STOP.'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(entry, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection/);
  assert.match(comparator, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(comparator, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN TRUE/);
  // Inert vectors only; they do not execute or parse SQL.
  type Row = {text:(string|null)[]; hashes:(string|null)[]; xid:bigint|null};
  const rows:Row[] = ['ALLOCATION','LAYOUT'].map((role,i) => ({text:[`claim${i}`,'baseline',`session${i}`,`reservation${i}`,'QUALIFIER_BASELINE_INITIAL',`event${i}`,'kind',`charge${i}`,'INITIAL',`SELECTION_QUALIFIER_${role}:id${i}`],hashes:Array(3).fill('a'.repeat(64)),xid:BigInt(i+1)}));
  const clone = (r:Row[]) => r.map(x=>({text:[...x.text],hashes:[...x.hashes],xid:x.xid}));
  const valid = (r:Row[]) => r.length===2 && r.every((x,i)=>x.text.length===10 && x.hashes.length===3 && x.xid!==null && x.text.every((v,j)=>typeof v==='string' && (j===9 ? v.startsWith(`SELECTION_QUALIFIER_${i?'LAYOUT':'ALLOCATION'}:`) && Buffer.byteLength(v.slice(`SELECTION_QUALIFIER_${i?'LAYOUT':'ALLOCATION'}:`.length))>=1 && Buffer.byteLength(v.slice(`SELECTION_QUALIFIER_${i?'LAYOUT':'ALLOCATION'}:`.length))<=256 : Buffer.byteLength(v)>=1 && Buffer.byteLength(v)<=256)) && x.hashes.every(v=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v)));
  const equal = (a:Row[],b:Row[]) => valid(a) && valid(b) && a.every((x,i)=>x.xid===b[i].xid && x.text.every((v,j)=>v===b[i].text[j]) && x.hashes.every((v,j)=>v===b[i].hashes[j]));
  assert.ok(equal(rows,clone(rows)));
  // Both routes share a baseline value; an alteration to either occurrence remains visible.
  for (let i=0;i<2;i++) {const alias=clone(rows);alias[i].text[1]='other-baseline';assert.equal(equal(rows,alias),false);}
  for (let i=0;i<2;i++) for (const group of ['text','hashes','xid'] as const) {
    const count=group==='text'?10:group==='hashes'?3:1;
    for(let j=0;j<count;j++) {
      const changed=clone(rows), missing=clone(rows);
      if(group==='xid'){changed[i].xid=99n;missing[i].xid=null;} else {changed[i][group][j]=group==='hashes'?'b'.repeat(64):changed[i][group][j]+'x';missing[i][group][j]=null;}
      assert.equal(equal(rows,changed),false); assert.equal(equal(rows,missing),false); assert.equal(equal(missing,rows),false); assert.equal(equal(missing,missing),false);
    }
  }
  for (let i=0;i<2;i++) {const max=clone(rows), prefix=`SELECTION_QUALIFIER_${i?'LAYOUT':'ALLOCATION'}:`; max[i].text[9]=prefix+'é'.repeat(128);assert.equal(Buffer.byteLength(max[i].text[9]!),i?283:287);assert.ok(valid(max));max[i].text[9]+='x';assert.equal(valid(max),false);}
  const swapped=clone(rows); [swapped[0],swapped[1]]=[swapped[1],swapped[0]];assert.equal(equal(rows,swapped),false);
});


test('original input receipt scalar projection binds both routes without byte authority', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneInputReceipt" (')[1].split('\n);')[0];
  assert.match(schema, /"inputClaimId" TEXT PRIMARY KEY/);
  assert.match(schema, /"capturedLength" BIGINT NOT NULL/);
  assert.match(schema, /"capturedHash" TEXT NOT NULL CHECK/);
  assert.match(schema, /"operationReceipt" TEXT NOT NULL/);
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const select = helper.split('cap."inputClaimId" AS input_receipt_claim')[1].split('INTO STRICT v_history')[0];
  for (const term of ['cap."capturedLength" AS input_receipt_length', 'cap."capturedHash" AS input_capture_hash', 'cap."operationReceipt" AS input_receipt_operation']) assert.ok(select.includes(term), term);
  assert.doesNotMatch(select, /capturedBytes/);
  assert.doesNotMatch(helper, /cap\."capturedBytes"/);
  assert.match(helper, /ORDER BY x\.route_kind COLLATE "C" LOOP/);
  assert.ok(helper.includes('JOIN public."Pro273ControlPlaneInputReceipt" cap ON cap."inputClaimId"=c."inputClaimId"'));
  assert.ok(helper.includes('(cap."capturedHash",cap."operationReceipt")=(v_key.capture_hash,v_key.receipt_hash)'));
  for (const term of ['input_receipt_claim COLLATE "C" IS DISTINCT FROM v_key.claim_id', 'input_receipt_length<=0', 'input_capture_hash COLLATE "C" IS DISTINCT FROM v_key.capture_hash', 'input_receipt_operation COLLATE "C" IS DISTINCT FROM v_key.receipt_hash', 'v_initial_input_receipt_text:=pg_catalog.array_cat', 'v_initial_input_receipt_length:=pg_catalog.array_cat']) assert.ok(helper.includes(term), term);
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('END $pro273_snapshot_equal$')[0];
  for (const side of ['p_before','p_after']) for (const [column,other,index] of [[1,'v_initial_keys',2],[1,'v_initial_claim_text',1],[2,'v_initial_facts',1],[3,'v_initial_facts',2]] as const) assert.ok(comparator.includes(`${side}.v_initial_input_receipt_text[v_i][${column}] COLLATE "C" IS DISTINCT FROM ${side}.${other}[v_i][${index}] COLLATE "C"`));
  const hash = 'a'.repeat(64); const receipt = 'b'.repeat(64);
  type Row = {claim:string; length:bigint; hash:string; operation:string};
  const valid = (rows: Row[], claims: string[], facts: string[][]) => rows.length === 2 && claims.length === 2 && facts.length === 2 && rows.every((r,i) => Buffer.byteLength(r.claim) >= 1 && Buffer.byteLength(r.claim) <= 256 && r.claim === claims[i] && r.length > 0n && /^[a-f0-9]{64}$/.test(r.hash) && /^[a-f0-9]{64}$/.test(r.operation) && r.hash === facts[i][0] && r.operation === facts[i][1]);
  const rows = [{claim:'allocation',length:3n,hash,operation:receipt},{claim:'layout',length:4n,hash,operation:receipt}];
  const facts = [[hash,receipt],[hash,receipt]]; const claims = ['allocation','layout'];
  assert.ok(valid(rows,claims,facts));
  assert.equal(valid(rows.slice(0,1),claims,facts),false);
  for (const bad of [{...rows[0],claim:'layout'}, {...rows[0],length:0n}, {...rows[0],hash:receipt}, {...rows[0],operation:hash}]) assert.equal(valid([bad,rows[1]],claims,facts),false);
  const equal = (a: Row[], b: Row[]) => valid(a,claims,facts) && valid(b,claims,facts) && a.every((r,i) => r.claim===b[i].claim && r.length===b[i].length && r.hash===b[i].hash && r.operation===b[i].operation);
  assert.ok(equal(rows,rows.map(r => ({...r}))));
  assert.equal(equal(rows,[{...rows[0],length:5n},rows[1]]),false);
});


test('PRO311 original launch attempt scalar projection retains both joined routes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneLaunchAttempt" (')[1].split('\n);')[0];
  const entry = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const route = entry.split('FOR v_key IN SELECT x.route_kind')[1].split('-- Require two aligned rows per route family')[0];
  const select = route.split('INTO STRICT v_history')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('END $pro273_snapshot_equal$')[0];
  const columns: Record<string,string> = {id:'attemptId',baseline:'baselineId',receiver:'receiverIdentity',charge_kind:'chargeKind',charge_event:'chargeEventKey',session_charge_kind:'sessionChargeKind',session_charge_event:'sessionChargeEventKey',request_hash:'requestHash',charge_hash:'chargeBindingHash',session_charge_hash:'sessionChargeBindingHash',ordinal:'attemptOrdinal',xid:'creationTransactionId',time:'claimedAt'};
  for (const [alias, column] of Object.entries(columns)) {
    assert.ok(schema.includes(`"${column}"`), column);
    assert.ok(select.includes(`a."${column}" AS initial_attempt_${alias}`), column);
  }
  assert.ok(schema.includes('"creationTransactionId" xid8 NOT NULL'));
  assert.ok(sql.includes('CREATE TRIGGER "Pro273ControlPlaneLaunchAttempt_creation_xid" BEFORE INSERT'));
  assert.ok(route.includes('JOIN public."Pro273ControlPlaneLaunchAttempt" a ON (a."baselineId",a."attemptId",a."receiverIdentity")=(s."baselineId",s."attemptId",s."receiverIdentity")'));
  for (const [field, aliases] of Object.entries({text:['id','baseline','receiver','charge_kind','charge_event','session_charge_kind','session_charge_event'],hashes:['request_hash','charge_hash','session_charge_hash'],ordinal:['ordinal'],xid:['xid'],time:['time']})) {
    const retained = route.split(`v_initial_attempt_${field}:=pg_catalog.array_cat`)[1].split(';')[0];
    assert.deepEqual([...retained.matchAll(/v_history\.initial_attempt_(\w+)/g)].map(m=>m[1]), aliases);
    assert.ok(entry.includes(`  v_initial_attempt_${field},`));
    assert.ok(comparator.includes(`-- field: v_initial_attempt_${field}`));
  }
  for (const side of ['p_before','p_after']) {
    for (const [attempt,session] of [[1,3],[2,2],[3,6]]) assert.ok(comparator.includes(`${side}.v_initial_attempt_text[v_i][${attempt}] COLLATE "C" IS DISTINCT FROM ${side}.v_initial_session_text[v_i][${session}] COLLATE "C"`));
    assert.ok(comparator.includes(`${side}.v_initial_attempt_text[v_i][1] COLLATE "C" IS DISTINCT FROM ${side}.v_initial_keys[v_i][10] COLLATE "C"`));
    assert.ok(comparator.includes(`${side}.v_initial_attempt_ordinal[v_i]<=0`));
  }
  assert.doesNotMatch(select, /SESSION_USER|current_user|pg_backend|FOR\s+(?:UPDATE|SHARE)/i);
  assert.ok(sql.startsWith('-- INCOMPLETE SOURCE CHECKPOINT. Installation remains prohibited under R6 STOP.'));
  assert.match(entry, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(entry, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection/);
  assert.match(comparator, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(comparator, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN TRUE/);
});

test('shared historical baseline provenance retains typed original scalars', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneBaselineProvenance" (')[1].split('\n);')[0];
  const helper = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(p_expectation_id TEXT)')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const route = helper.split('-- Denied discovery prototype only:')[1].split('-- Selected allocation and physical-domain scalars only;')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  const groups = [
    ['text','TEXT','baselineId bootstrapKind trustId inputClaimId sessionClaimId eventId chargeKind chargeEventKey'],
    ['hashes','TEXT','coreHash bootstrapRecordHash bootstrapEvidenceHash trustRecordHash capturedHash evidenceHash chargeBindingHash'],
    ['oid','OID','publisherPrincipalOid'], ['name','NAME','publisherPrincipalName'],
    ['bigints','BIGINT','trustGeneration capturedLength evidenceLength'], ['xid','xid8','constructionTransactionId'],
  ] as const;
  for (const [group,type,columns] of groups) {
    const fields = columns.split(' '), name = `v_baseline_provenance_${group}`;
    for (const field of fields) {
      assert.match(schema, new RegExp(`"${field}" ${type} (?:NOT NULL|PRIMARY KEY)`));
      assert.ok(route.includes(`prov."${field}" AS history_prov_${field}`), field);
    }
    assert.ok(route.includes(`${name}:=ARRAY[${fields.map(f => `v_route.history_prov_${f}`).join(',')}];`));
    const part = comparator.split(`-- field: ${name}`)[1].split(' -- field:')[0];
    for (const side of ['p_before','p_after']) {
      assert.ok(part.includes(`array_ndims(${side}.${name}) IS DISTINCT FROM 1`));
      assert.ok(part.includes(`array_lower(${side}.${name},1) IS DISTINCT FROM 1`));
      assert.ok(part.includes(`array_length(${side}.${name},1) IS DISTINCT FROM ${fields.length}`));
      assert.ok(part.includes(`${side}.${name}[v_i] IS NULL`));
    }
    const c = type === 'TEXT' || type === 'NAME' ? ' COLLATE "C"' : '';
    assert.ok(part.includes(`p_before.${name}[v_i]${c} IS DISTINCT FROM p_after.${name}[v_i]${c}`));
    assert.ok(route.includes(`array_length(${name},1) IS DISTINCT FROM ${fields.length}`));
  }
  assert.match(route, /\(prov\."baselineId",prov\."coreHash"\)=\(base\."baselineId",base\."coreHash"\)/);
  assert.match(route, /\(lb\."baselineId",lb\."baselineCoreHash",lb\."layoutInputClaimId"\)=\(ap\."baselineId",ap\."baselineCoreHash",ap\."layoutInputClaimId"\)/);
  for (const field of ['sessionClaimId','eventId','publisherPrincipalOid','publisherPrincipalName','trustId','trustGeneration','chargeKind','chargeEventKey','chargeBindingHash']) assert.ok(route.includes(`prov."${field}"`));
  assert.match(route, /hist\."expectationId" AS historical_expectation/);
  assert.match(route, /v_baseline_provenance_bigints\[v_snapshot_i\]<=0/);
  assert.match(comparator, /p_before\.v_baseline_provenance_bigints\[v_i\]<=0/);
  assert.match(comparator, /p_after\.v_baseline_provenance_bigints\[v_i\]<=0/);
  assert.doesNotMatch(route, /prov\."(?:capturedBytes|evidenceBytes)"|pg_current_xact_id|SESSION_USER/i);
  assert.match(helper, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(helper, /RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*RETURN v_projection/);
  assert.match(comparator, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
});

test('shared provenance inert shape and scalar mutations fail closed', () => {
  type Snapshot = { text: (string | null)[]; hashes: (string | null)[]; oid: (number | null)[]; name: (string | null)[]; bigints: (bigint | null)[]; xid: (bigint | null)[] };
  const original: Snapshot = { text: ['baseline','bootstrap','trust','input','session','event','kind','charge'], hashes: Array(7).fill('a'.repeat(64)), oid: [42], name: ['publisher'], bigints: [1n,2n,3n], xid: [4n] };
  const valid = (s: Snapshot) => s.text.length === 8 && s.text.every((v,i) => v !== null && Buffer.byteLength(v) >= 1 && Buffer.byteLength(v) <= (i === 1 ? 288 : 256)) && s.hashes.length === 7 && s.hashes.every(v => v !== null && /^[a-f0-9]{64}$/.test(v)) && s.oid.length === 1 && s.oid[0] !== null && s.name.length === 1 && s.name[0] !== null && Buffer.byteLength(s.name[0]) >= 1 && Buffer.byteLength(s.name[0]) <= 256 && s.bigints.length === 3 && s.bigints.every(v => v !== null && v > 0n) && s.xid.length === 1 && s.xid[0] !== null;
  const equal = (a: Snapshot,b: Snapshot) => valid(a) && valid(b) && (Object.keys(a) as (keyof Snapshot)[]).every(k => a[k].every((v,i) => v === b[k][i]));
  const copy = (): Snapshot => ({text:[...original.text],hashes:[...original.hashes],oid:[...original.oid],name:[...original.name],bigints:[...original.bigints],xid:[...original.xid]});
  assert.equal(equal(original,copy()),true);
  for (const key of Object.keys(original) as (keyof Snapshot)[]) for (let i=0;i<original[key].length;i++) {
    const changed = copy(); const row = changed[key] as (string | number | bigint | null)[];
    row[i] = key === 'hashes' ? 'b'.repeat(64) : typeof row[i] === 'string' ? `${row[i]}x` : typeof row[i] === 'bigint' ? (row[i] as bigint) + 1n : 43;
    assert.equal(equal(original,changed),false); row[i] = null; assert.equal(equal(changed,changed),false);
    const short = copy(); short[key].pop(); assert.equal(equal(short,short),false);
  }
  for (const index of [0,1,2]) {const bad=copy(); bad.bigints[index]=0n; assert.equal(valid(bad),false);}
  const badHash=copy(); badHash.hashes[0]='A'.repeat(64); assert.equal(valid(badHash),false);
  const longKey=copy(); longKey.text[0]='x'.repeat(257); assert.equal(valid(longKey),false);
  const bootstrap=copy(); bootstrap.text[1]='x'.repeat(288); assert.equal(valid(bootstrap),true); bootstrap.text[1]+='x'; assert.equal(valid(bootstrap),false);
});

test('shared historical baseline enforces original cross-field semantics on discovery and comparison', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const schema = sql.split('CREATE TABLE public."Pro273ControlPlaneBaseline" (')[1].split('\n);')[0];
  const entry = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('-- Selected allocation and physical-domain scalars only')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  const columns = [...schema.matchAll(/"(\w+)" (?:TEXT|OID|NAME|NUMERIC|TIMESTAMPTZ) (?:PRIMARY KEY|NOT NULL)/g)].map(m => m[1]);
  const projected = [...entry.matchAll(/base\."(\w+)" AS history_base_\w+/g)].map(m => m[1]);
  assert.deepEqual([...projected].sort(), [...columns].sort());
  assert.equal(new Set(projected).size, columns.length);
  assert.ok(entry.includes('JOIN public."Pro273ControlPlaneBaseline" base ON (base."baselineId",base."coreHash")=(ap."baselineId",ap."baselineCoreHash")'));
  const numbers = 'reservedBackendBytes reservedSharedBytes reservedTemporaryBytes maxInputBytes maxOutputBytes maxAllocationBytes stackBytes parentBytes maxProcessCount maxBackendCount maxLaunchAttempts maxEvents backendProcessBytes qualifierRuntimeBytes launcherSupervisorBytes retainedParentBytes driverSocketIpcBytes inputEvidenceSerializationBytes primitiveParserCacheBytes rollbackCleanupBytes sharedRuntimeBytes'.split(' ');
  assert.deepEqual(entry.split('v_history_numbers:=ARRAY[')[1].split('];')[0].split(',').map(s => s.trim().replace('v_route.history_base_', '')), numbers);
  for (const [part, prefix] of [[entry,'v_history'],[comparator,'p_before.v_history'],[comparator,'p_after.v_history']] as const) {
    for (const fragment of [
      `${prefix}_text[2] NOT IN ('QUALIFIER_BASELINE_INITIAL','SELECTION_PROFILE_REVOKE')`,
      `${prefix}_oids[1]=0`, `${prefix}_times[1]>=${prefix}_times[2]`,
      `${prefix}_numbers[1]<${[13,14,15,16,17,18,19,20].map(i => `${prefix}_numbers[${i}]`).join('+')}`,
      `${prefix}_numbers[2]<${prefix}_numbers[21]+${prefix}_numbers[3]`,
      `${prefix}_numbers[8]>${prefix}_numbers[16]`, `${prefix}_numbers[6]>${prefix}_numbers[1]`, `${prefix}_numbers[7]>${prefix}_numbers[1]`,
    ]) assert.ok(part.includes(fragment), fragment);
  }
  // Inert model of the schema inequalities; large integers are not narrowed to JS numbers.
  const valid = (n: bigint[]) => n[0]>=n.slice(12,20).reduce((a,b)=>a+b,0n) && n[1]>=n[20]+n[2] && n[7]<=n[15] && n[5]<=n[0] && n[6]<=n[0];
  const n = Array<bigint>(21).fill(1n); n[0]=100000000000000000000000000000000000000n; n[1]=2n;
  assert.equal(valid(n),true);
  for (const [index,value] of [[0,7n],[1,1n],[7,2n],[5,n[0]+1n],[6,n[0]+1n]] as const) {
    const changed=[...n]; changed[index]=value; assert.equal(valid(changed),false,`cell ${index+1}`);
  }
  assert.doesNotMatch(entry, /base\."(?:capturedBytes|evidenceBytes|record|target)"|SESSION_USER|current_user|pg_current_xact_id/i);
});

test('historical publication and binding identities join each original route and receipt', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal')[0];
  const block = comparator.split('-- Bind the stored publication and binding occurrences to their original routes and receipts.')[1].split('-- field: v_relation_keys')[0];
  const pairs: [number, string][] = [
    [1,'route_baseline_id'],[14,'route_baseline_hash'],[3,'route_physical_id'],[4,'route_proof_id'],[7,'route_layout_hash'],
    [15,'route_baseline_id'],[16,'route_baseline_hash'],[33,'route_baseline_id'],[34,'route_baseline_hash'],
    [35,'route_physical_id'],[36,'route_proof_id'],[37,'route_layout_hash'],[42,'route_baseline_id'],[43,'route_baseline_hash'],
    [44,'v_history_text[30]'],[45,'route_allocation_id'],[46,'route_allocation_hash'],[48,'route_baseline_id'],[49,'route_baseline_hash'],[50,'v_history_text[30]'],
    [39,'v_initial_keys[1][2]'],[40,'v_initial_keys[1][3]'],[41,'v_initial_keys[1][4]'],[47,'v_initial_facts[1][2]'],
    [30,'v_initial_keys[2][2]'],[31,'v_initial_keys[2][3]'],[32,'v_initial_keys[2][4]'],[38,'v_initial_facts[2][2]'],
  ];
  for (const side of ['p_before','p_after']) {
    for (const [index,target] of pairs) assert.ok(block.includes(`${side}.v_history_text[${index}] COLLATE "C" IS DISTINCT FROM ${side}.${target} COLLATE "C"`), `${side} ${index} ${target}`);
    assert.ok(block.includes(`${side}.v_history_text[30] COLLATE "C" IS NOT DISTINCT FROM ${side}.v_history_text[39] COLLATE "C"`));
  }
  // Model a consistently forged snapshot: changing both before and after still
  // must fail when any stored occurrence no longer matches its route identity.
  const values: Record<string,string> = {route_baseline_id:'baseline',route_baseline_hash:'base-hash',route_physical_id:'physical',route_proof_id:'proof',route_layout_hash:'layout-hash',route_allocation_id:'allocation',route_allocation_hash:'allocation-hash','v_initial_keys[1][2]':'a-claim','v_initial_keys[1][3]':'a-admission','v_initial_keys[1][4]':'a-event','v_initial_facts[1][2]':'a-receipt','v_initial_keys[2][2]':'l-claim','v_initial_keys[2][3]':'l-admission','v_initial_keys[2][4]':'l-event','v_initial_facts[2][2]':'l-receipt'};
  values['v_history_text[30]'] = values['v_initial_keys[2][2]'];
  for (const [index,target] of pairs) values[`v_history_text[${index}]`] = values[target];
  const valid = (v: Record<string,string>) => pairs.every(([i,t]) => v[`v_history_text[${i}]`] === v[t]) && v['v_history_text[30]'] !== v['v_history_text[39]'];
  assert.equal(valid(values),true);
  for (const [index] of pairs) { const changed={...values,[`v_history_text[${index}]`]:'altered'}; assert.equal(valid(changed),false,`history ${index}`); }
  assert.equal(valid({...values,'v_history_text[39]':values['v_history_text[30]'],'v_initial_keys[1][2]':values['v_history_text[30]']}),false);
});


test('reservation event scalars preserve original claim joins across historical routes', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const discovery = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const comparator = sql.split('CREATE FUNCTION public.pro273_qualifier_snapshot_equal(')[1].split('END $pro273_snapshot_equal$')[0];
  for (const [alias, name] of [['cs','constructor'],['os','observation'],['slot','initial_input'],['cs','initial_capture']] as const) {
    assert.ok(discovery.includes(`CASE WHEN pg_catalog.jsonb_typeof(${alias}."record"->'expectedEventKey')='string' THEN ${alias}."record"->>'expectedEventKey' ELSE NULL END AS ${name}_slot_expectedEvent`));
  }
  for (const group of ['installer','initial']) {
    assert.ok(discovery.includes(`v_${group}_slot_event:=pg_catalog.array_cat(v_${group}_slot_event,ARRAY[v_fact.expected_event])`));
    const part = comparator.split(`-- field: v_${group}_slot_event`)[1].split(' -- field:')[0];
    for (const side of ['p_before','p_after']) {
      assert.ok(part.includes(`${side}.v_${group}_slot_event[v_i] COLLATE "C" IS DISTINCT FROM ${side}.v_${group}_slot_text[v_i][3] COLLATE "C"`));
      assert.ok(part.includes(`array_length(${side}.v_${group}_slot_event,1) IS DISTINCT FROM 4`));
    }
  }
  assert.ok(discovery.includes('v_fact.expected_event COLLATE "C" IS DISTINCT FROM v_fact.claim_event COLLATE "C"'));
  for (const [left,right] of [['installer','installer'],['initial','initial'],['initial','installer']]) assert.ok(discovery.includes(`v_${left}_slot_event[v_snapshot_i] COLLATE "C" IS DISTINCT FROM v_${right}_slot_event[v_snapshot_j] COLLATE "C"`));
  const valid = (event: string | null, claim: string) => event !== null && Buffer.byteLength(event) >= 1 && Buffer.byteLength(event) <= 256 && event === claim;
  assert.equal(valid('event','event'),true); assert.equal(valid('other','event'),false); assert.equal(valid(null,'event'),false); assert.equal(valid('x'.repeat(257),'x'.repeat(257)),false);
  assert.match(discovery, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(comparator, /BEGIN\s*--[^\n]*\s*RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
});

test('historical reservation JSON scalar types and original input PIDs fail closed', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const discovery = sql.split('CREATE FUNCTION public.pro273_qualifier_discover(')[1].split('REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT)')[0];
  const comparator = sql.split('-- field: v_initial_input_slot_pid')[1].split(' -- field: v_initial_receipt_time')[0];
  const pidProjection = `CASE WHEN pg_catalog.jsonb_typeof(slot."record"->'observerBackendPid')='string' THEN slot."record"->>'observerBackendPid' ELSE NULL END AS initial_input_slot_backendPid`;
  const checkProjection = (source: string) => {
    assert.ok(source.includes(pidProjection));
    for (const [alias, name] of [['cs','constructor'],['os','observation'],['slot','initial_input'],['cs','initial_capture']] as const) {
      assert.ok(source.includes(`CASE WHEN pg_catalog.jsonb_typeof(${alias}."record"->'expectedEventKey')='string' THEN ${alias}."record"->>'expectedEventKey' ELSE NULL END AS ${name}_slot_expectedEvent`));
    }
    const value = 'v_history.initial_input_slot_backendPid';
    for (const term of [`${value} IS NULL`, `octet_length(${value}) NOT BETWEEN 1 AND 10`, `${value} COLLATE "C" !~ '^[1-9][0-9]{0,9}$'`, `${value} COLLATE "C">'2147483647' COLLATE "C"`, `${value} COLLATE "C" IS DISTINCT FROM v_history.initial_receipt_backendPid::TEXT COLLATE "C"`]) assert.ok(source.includes(term), term);
  };
  checkProjection(discovery);
  assert.throws(() => checkProjection(discovery.replace(pidProjection, 'NULL AS initial_input_slot_backendPid')));
  assert.throws(() => checkProjection(discovery.replace("jsonb_typeof(cs.\"record\"->'expectedEventKey')='string'", "jsonb_typeof(cs.\"record\"->'expectedEventKey')='number'")));

  assert.ok(discovery.includes('v_initial_input_slot_pid:=pg_catalog.array_cat(v_initial_input_slot_pid,ARRAY[v_history.initial_input_slot_backendPid])'));
  assert.ok(discovery.includes('v_history.initial_input_slot_backendPid COLLATE "C" IS DISTINCT FROM v_history.initial_receipt_backendPid::TEXT COLLATE "C"'));
  assert.match(discovery, /Non-string historical event keys and observer PIDs are incompatible/);
  assert.match(discovery, /do not qualify detoast or resource safety/);
  for (const side of ['p_before','p_after']) {
    const pid = `${side}.v_initial_input_slot_pid[v_i]`;
    for (const term of [`${pid} COLLATE "C" !~ '^[1-9][0-9]{0,9}$'`, `octet_length(${pid}) NOT BETWEEN 1 AND 10`, `${pid} COLLATE "C">'2147483647' COLLATE "C"`, `${pid} COLLATE "C" IS DISTINCT FROM ${side}.v_initial_receipt_pid[v_i]::TEXT COLLATE "C"`]) assert.ok(comparator.includes(term), term);
  }
  assert.doesNotMatch(comparator, /pg_backend_pid|v_initial_input_slot_pid\[v_i\]::/);
  const event = (value: unknown, claim: string) => typeof value === 'string' && Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= 256 && value === claim;
  for (const bad of [123, true, false, null, undefined, '', 'wrong', 'x'.repeat(257)]) assert.equal(event(bad, '123'), false);
  assert.equal(event('123', '123'), true);
  const pid = (value: unknown, receipt: number) => typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) && Buffer.byteLength(value) <= 10 && (value.length < 10 || value <= '2147483647') && Number.isInteger(receipt) && receipt > 0 && value === String(receipt);
  for (const bad of [1, true, false, null, undefined, '', '0', '01', '-1', '+1', ' 1', '1.0', '١', '2147483648', '99999999999']) assert.equal(pid(bad, 1), false, String(bad));
  assert.equal(pid('1', 1), true); assert.equal(pid('2147483647', 2147483647), true); assert.equal(pid('2', 1), false);
  const compare = (before: unknown[], after: unknown[], receipts: number[]) => before.length === 2 && after.length === 2 && receipts.length === 2 && before.every((v,i) => pid(v, receipts[i]) && pid(after[i], receipts[i]) && v === after[i]);
  assert.equal(compare(['1','2'], ['1','2'], [1,2]), true);
  assert.equal(compare(['1','2'], ['2','1'], [1,2]), false);
  assert.equal(compare(['1','2'], ['1',2], [1,2]), false);
  assert.equal(compare(['1','3'], ['1','3'], [1,2]), false);
  assert.equal(compare(['1'], ['1'], [1]), false);
});

test('prospective issuer provenance remains closed and legacy unqualified', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = sql.split('CREATE TABLE public."Pro273PublisherTrustProvenance" (')[1].split('\n);')[0];
  const fields = ['provisionerOid', 'provisionerName', 'provisioningTransactionId', 'provisionedAt'];
  for (const field of fields) {
    assert.ok(table.includes(`"${field}" IS NULL`));
    assert.ok(table.includes(`"${field}" IS NOT NULL`));
    assert.ok(roles.includes(`"${field}"`));
  }
  assert.match(table, /"provisionerOid"<>0::OID/);
  assert.match(table, /"provisionerName"::TEXT<>''/);
  assert.match(table, /pg_catalog\.isfinite\("provisionedAt"\)/);
  assert.doesNotMatch(table, /\bDEFAULT\b/i);
  assert.match(sql, /"Pro273PublisherTrustProvenance_block_insert" BEFORE INSERT ON public\."Pro273PublisherTrustProvenance" FOR EACH ROW EXECUTE FUNCTION public\.pro273_sel_immutable\(\)/);
  const closed = (present: boolean[]) => present.every(Boolean) || present.every(x => !x);
  for (let bits = 0; bits < 16; bits++) {
    const present = fields.map((_, i) => Boolean(bits & (1 << i)));
    assert.equal(closed(present), bits === 0 || bits === 15);
  }
  for (const kind of ['layout', 'allocation']) {
    const body = sql.split(`CREATE FUNCTION public.pro273_initial_verify_committed_${kind}(`)[1].split('END $$;')[0];
    assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
    for (const field of fields) assert.ok(body.includes(`tp."${field}" IS NULL`), field);
    assert.ok(body.includes('tp."provisionerName" IS DISTINCT FROM bt."principal"'));
    assert.doesNotMatch(body, /publisherPrincipalName"\) IS DISTINCT FROM \(bt\."recordHash",bt\."principal"/);
  }
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT[\s\S]*?RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'/);
  assert.match(sql, /IF p_record->>'purpose'='QUALIFIER_BASELINE_PUBLISHER' AND \(p_record->'scope'\) \? 'initialQualification' THEN\s+RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'/);
  assert.match(sql, /jsonb_object_keys\(p_record\)\)<>11/);
  assert.match(sql, /digest\(pg_catalog\.convert_to\(p_record::TEXT,'UTF8'\),'sha256'\)/);
  assert.doesNotMatch(sql + roles, /INSERT\s+INTO\s+public\."Pro273PublisherTrustProvenance"|GRANT\s+[^;]*\b(?:INSERT|UPDATE|ALL)\b[^;]*ON\s+(?:TABLE\s+)?public\."Pro273PublisherTrustProvenance"/i);
  const audit = roles.split("IF v_name IN ('Pro273PublisherTrustProvenance','Pro273BaselineTrustProvenance') AND (")[1].split('END LOOP;')[0];
  assert.match(audit, /aclexplode\(col\.attacl\)/);
  assert.match(audit, /a\.grantee<>v_owner/);
  assert.match(audit, /PRO273_SEL_AUDIT_PROVENANCE_PRIVATE_ACL/);
  const revoke = roles.split('-- Table-level REVOKE does not remove separately granted column privileges.')[1].split(';')[0];
  for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
    const columns = revoke.split(`${privilege} (`)[1].split(')')[0];
    for (const field of fields) assert.ok(columns.includes(`"${field}"`), `${privilege} ${field}`);
  }
  const qualifies = (present: boolean[]) => present.every(Boolean);
  assert.equal(qualifies(fields.map(() => false)), false);
  for (let missing = 0; missing < fields.length; missing++) assert.equal(qualifies(fields.map((_, i) => i !== missing)), false);
});

test('trust issuance source holds preserve original grant ABI and expose retry and lock gaps', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const supplier = readFileSync(join(__dirname, '../prisma/migrations/20261028140000_pro262_capacity_supplier/migration.sql'), 'utf8');
  const grants = readFileSync(join(__dirname, '../prisma/roles/pro262_capacity_supplier_roles.sql'), 'utf8');
  const provision = sql.split('CREATE OR REPLACE FUNCTION public.pro262_capacity_trust_provision(')[1].split('END $$;')[0];
  const charge = supplier.split('CREATE FUNCTION public.pro262_capacity_control_charge(')[1].split('END $$;')[0];
  const immutable = sql.split('CREATE FUNCTION public.pro273_sel_immutable()')[1].split('END $$;')[0];
  assert.match(grants, /GRANT EXECUTE ON FUNCTION public\.pro262_capacity_trust_provision\(TEXT,BIGINT,JSONB\) TO pro262_trust_provisioner/);
  assert.match(provision, /jsonb_object_keys\(p_record\)\)<>11/);
  assert.match(provision, /digest\(pg_catalog\.convert_to\(p_record::TEXT,'UTF8'\),'sha256'\)/);
  assert.match(provision, /root\."principal" IS DISTINCT FROM SESSION_USER::NAME/);
  assert.match(provision, /root\."recordHash" IS DISTINCT FROM record_hash/);
  assert.match(provision, /existing\."issuer" IS DISTINCT FROM p_record->>'issuer'/);
  assert.match(provision, /existing\."supplierPrincipal"::TEXT IS DISTINCT FROM p_record->>'supplierPrincipal'/);
  assert.match(provision, /"kind"='TRUST_PROVISION' AND x\."eventKey"=trust_id\|\|':'\|\|v_generation::TEXT AND x\."bindingHash"=record_hash/);
  assert.match(provision, /p_record->>'purpose'='CONTROL_ALLOCATOR'[\s\S]*?b\."enabled" AND b\."coverageEvidenceHash"=root\."evidenceHash"/);
  const retry = provision.split('SELECT * INTO existing FROM public."Pro262CapacityTrust"')[1].split('END IF;\n IF NOT EXISTS')[0];
  assert.match(retry, /RETURN trust_id/);
  assert.doesNotMatch(retry, /Pro273(?:Publisher|Baseline)TrustProvenance/);
  assert.ok(provision.indexOf('FROM public."Pro262CapacityBootstrapTrust"') < provision.indexOf('FROM public."Pro262CapacityControlBaseline"'));
  assert.match(charge, /FROM public\."Pro262CapacityControlBaseline" x WHERE x\."kind"=v_kind FOR UPDATE NOWAIT/);
  assert.match(immutable, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.doesNotMatch(immutable, /\b(?:INSERT|UPDATE|DELETE)\b/i);
  for (const table of ['Pro273PublisherTrustProvenance', 'Pro273BaselineTrustProvenance']) {
    assert.ok(sql.includes(`"${table}_block_insert" BEFORE INSERT ON public."${table}"`));
    assert.doesNotMatch(sql, new RegExp(`INSERT\\s+INTO\\s+public\\."${table}"`, 'i'));
  }
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\.[\s\S]*?RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'/);
});

test('historical baseline trust provenance is separate, immutable, private and denied', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = sql.split('CREATE TABLE public."Pro273BaselineTrustProvenance" (')[1].split('\n);')[0];
  const fields = ['provisionerOid','provisionerName','provisioningTransactionId','provisionedAt'];
  for (const field of fields) {
    assert.ok(table.includes(`"${field}" IS NULL`));
    assert.ok(table.includes(`"${field}" IS NOT NULL`));
  }
  const completeTuple = (present: boolean[]) => present.every(Boolean) || present.every(x => !x);
  for (let bits = 0; bits < 16; bits++) assert.equal(completeTuple(fields.map((_, i) => Boolean(bits & (1 << i)))), bits === 0 || bits === 15);
  for (const fragment of ['"generation">0', '"recordHash" ~', "'TRUST_PROVISION'", '"chargeEventKey"="trustId"', '"provisionerOid"<>0::OID', '"provisionerName"::TEXT<>\'\'', 'pg_catalog.isfinite("provisionedAt")', 'PRIMARY KEY ("trustId","generation")']) assert.ok(table.includes(fragment), fragment);
  for (const relation of ['Pro262CapacityTrust','Pro262CapacityBootstrapTrust','Pro262CapacityControlCharge','Pro262CapacityControlBaseline']) assert.match(table, new RegExp(`REFERENCES public\\."${relation}"[^\\n]*ON UPDATE RESTRICT ON DELETE RESTRICT`));
  assert.doesNotMatch(table, /\bDEFAULT\b/i);
  assert.match(sql, /"Pro273BaselineTrustProvenance_block_insert" BEFORE INSERT ON public\."Pro273BaselineTrustProvenance" FOR EACH ROW EXECUTE FUNCTION public\.pro273_sel_immutable\(\)/);
  assert.match(sql, /"Pro273BaselineTrustProvenance_immutable" BEFORE UPDATE OR DELETE ON public\."Pro273BaselineTrustProvenance" FOR EACH ROW EXECUTE FUNCTION public\.pro273_sel_immutable\(\)/);
  assert.doesNotMatch(sql + roles, /INSERT\s+INTO\s+public\."Pro273BaselineTrustProvenance"|GRANT\s+[^;]*\b(?:INSERT|UPDATE|ALL)\b[^;]*ON\s+(?:TABLE\s+)?public\."Pro273BaselineTrustProvenance"/i);
  assert.ok(roles.includes("('Pro273BaselineTrustProvenance','pro273_sel_immutable')"));
  assert.ok(roles.includes("('Pro273BaselineTrustProvenance','p'::\"char\",ARRAY['trustId','generation'])"));
  assert.match(roles, /v_name IN \('Pro273PublisherTrustProvenance','Pro273BaselineTrustProvenance'\)[\s\S]*?tgtype=7 AND t\.tgenabled='O'/);
  assert.match(roles, /ALTER TABLE public\."Pro273BaselineTrustProvenance" OWNER TO pro262_capacity_owner/);
  const revoke = roles.split('REVOKE ALL ON TABLE public."Pro273BaselineTrustProvenance" FROM ')[1].split('-- Table-level')[0];
  for (const principal of ['PUBLIC','pro273_selection_owner','pro273_install_bootstrap','pro273_primitive_publisher','pro273_qualification_allocator','pro262_control_allocator','pro262_install_observer','pro262_qualification_publisher','huroof_pg_runtime','huroof_pg_service_executor','huroof_pg_executor','enta_runtime','enta_gameplay_runtime','enta_outbox_worker']) assert.ok(revoke.includes(principal));
  for (const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']) for (const field of ['trustId','generation','recordHash','fundingMode','chargeKind','chargeEventKey','baselineKind','baselineCoverageEvidenceHash','baselineEnabledAtProvisioning',...fields]) assert.ok(revoke.split(`${privilege} (`)[1].split(')')[0].includes(`"${field}"`));
  for (const kind of ['layout','allocation']) {
    const body = sql.split(`CREATE FUNCTION public.pro273_initial_verify_committed_${kind}(`)[1].split('END $$;')[0];
    assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
    assert.ok(body.includes('SELECT x.* INTO STRICT btp FROM public."Pro273BaselineTrustProvenance" x WHERE (x."trustId",x."generation")=(prov."trustId",prov."trustGeneration")'));
    for (const field of fields) assert.ok(body.includes(`btp."${field}" IS NULL`));
    for (const predicate of ['prov."trustRecordHash" IS DISTINCT FROM pt."recordHash"','btp."recordHash" IS DISTINCT FROM pt."recordHash"','btp."provisionerName" IS DISTINCT FROM pt."principal"','(btp."chargeKind",btp."chargeEventKey",btp."recordHash")','ptrust."supplierPrincipal" IS DISTINCT FROM prov."publisherPrincipalName"','(prov."bootstrapRecordHash",prov."bootstrapEvidenceHash",prov."publisherPrincipalName") IS DISTINCT FROM (pb."recordHash",pb."evidenceHash",pb."publisherPrincipal")']) assert.ok(body.includes(predicate), predicate);
    assert.doesNotMatch(body, /prov\."publisherPrincipalName"\) IS DISTINCT FROM \(pt\."recordHash",pt\."principal"/);
  }
  // Independent identities may differ; absence or mutation of any required original binding denies.
  const valid = {publisher:'publisher',subject:'publisher',issuer:'issuer',provisioner:'provisioner',bootstrap:'provisioner',hash:'h',rootHash:'h',chargeHash:'h',oid:1,xid:1,time:1};
  const accepts = (x: typeof valid) => Boolean(x.publisher && x.issuer && x.oid && x.xid && x.time && x.provisioner && x.publisher === x.subject && x.provisioner === x.bootstrap && x.hash === x.rootHash && x.hash === x.chargeHash);
  assert.equal(accepts(valid), true);
  for (const [key,value] of Object.entries({publisher:'other',subject:'other',provisioner:'other',bootstrap:'other',hash:'other',rootHash:'other',chargeHash:'other',oid:0,xid:0,time:0})) assert.equal(accepts({...valid,[key]:value}), false, key);
});

test('historical baseline funding alternatives preserve original evidence and denials', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const table = sql.split('CREATE TABLE public."Pro273BaselineTrustProvenance" (')[1].split('\n);')[0];
  for (const field of ['chargeKind','chargeEventKey','baselineKind','baselineCoverageEvidenceHash','baselineEnabledAtProvisioning']) {
    assert.ok(table.includes(`"${field}" IS NULL`), field);
    assert.ok(table.includes(`"${field}" IS NOT NULL`), field);
  }
  for (const fragment of ['"fundingMode" TEXT NOT NULL', `"fundingMode"='CHARGE'`, `"fundingMode"='CONTROL_BASELINE'`, `"baselineKind"='TRUST_PROVISION'`, '"baselineEnabledAtProvisioning" IS TRUE', `"baselineCoverageEvidenceHash" ~ '^[a-f0-9]{64}$'`]) assert.ok(table.includes(fragment), fragment);
  assert.ok(roles.includes("('Pro262CapacityControlBaseline','p'::\"char\",ARRAY['kind'])"));
  for (const fragment of ['pro262_capacity_control_baseline_guard()', 'Pro262CapacityControlBaseline_guard', 'PRO273_SEL_AUDIT_BASELINE_GUARD', "-''spent''-''enabled''", 'c.relowner=v_owner', 'p.proowner=v_owner', 'pg_catalog.aclexplode(col.attacl)']) assert.ok(roles.includes(fragment), fragment);
  for (const kind of ['layout','allocation']) {
    const body = sql.split(`CREATE FUNCTION public.pro273_initial_verify_committed_${kind}(`)[1].split('END $$;')[0];
    for (const fragment of [`btp."fundingMode"='CHARGE'`, `btp."fundingMode"='CONTROL_BASELINE'`, `ptrust."purpose" IS NOT DISTINCT FROM 'CONTROL_ALLOCATOR'`, 'btp."baselineCoverageEvidenceHash" IS NOT DISTINCT FROM pt."evidenceHash"', 'x."coverageEvidenceHash"=btp."baselineCoverageEvidenceHash"', 'btp."baselineEnabledAtProvisioning" IS TRUE', '(x."kind",x."eventKey",x."bindingHash")=(btp."chargeKind",btp."chargeEventKey",btp."recordHash")']) assert.ok(body.includes(fragment), fragment);
    assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
    assert.doesNotMatch(body, /x\."enabled"|x\."spent"/);
  }
  assert.doesNotMatch(sql + roles, /INSERT\s+INTO\s+public\."Pro273BaselineTrustProvenance"|GRANT\s+[^;]*\b(?:INSERT|UPDATE|ALL)\b[^;]*ON\s+(?:TABLE\s+)?public\."Pro273BaselineTrustProvenance"/i);
  const hash = 'a'.repeat(64);
  const charge = {mode:'CHARGE', kind:'TRUST_PROVISION' as string | null, event:'trust:1' as string | null, baseline:null as string | null, coverage:null as string | null, enabled:null as boolean | null, purpose:'CONTROL_ALLOCATOR', root:hash, rootEvidence:'c'.repeat(64), record:hash, chargeHash:hash, storedCoverage:'c'.repeat(64), nowEnabled:false, present:true};
  const baseline = {...charge, mode:'CONTROL_BASELINE',kind:null,event:null,baseline:'TRUST_PROVISION',coverage:'c'.repeat(64),enabled:true,purpose:'CONTROL_ALLOCATOR'};
  const accepts = (x: typeof charge) => x.present && x.record === x.root && x.purpose === 'CONTROL_ALLOCATOR' && (x.mode === 'CHARGE'
    ? x.kind === 'TRUST_PROVISION' && x.event === 'trust:1' && x.baseline === null && x.coverage === null && x.enabled === null && x.chargeHash === x.record
    : x.mode === 'CONTROL_BASELINE' && x.kind === null && x.event === null && x.baseline === 'TRUST_PROVISION' && x.coverage !== null && /^[a-f0-9]{64}$/.test(x.coverage) && x.enabled === true && x.purpose === 'CONTROL_ALLOCATOR' && x.coverage === x.rootEvidence && x.coverage === x.storedCoverage);
  assert.equal(accepts(charge), true);
  assert.equal(accepts(baseline), true); // disabled now does not erase recorded original evidence
  for (const invalid of [{...charge,purpose:'OTHER'}, {...charge,kind:null},{...charge,event:null},{...charge,baseline:'TRUST_PROVISION'},{...charge,chargeHash:'b'.repeat(64)}, {...baseline,kind:'TRUST_PROVISION'}, {...baseline,baseline:null}, {...baseline,coverage:null}, {...baseline,enabled:null}, {...baseline,enabled:false}, {...baseline,purpose:'OTHER'}, {...baseline,coverage:'b'.repeat(64)}, {...baseline,storedCoverage:'b'.repeat(64)}, {...baseline,record:'b'.repeat(64)}, {...baseline,present:false}, {...baseline,mode:'LEGACY'}]) assert.equal(accepts(invalid),false,JSON.stringify(invalid));
});

test('issuance probe inert fixed-key lock and reread contract', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const signature = 'public.pro273_trust_issuance_probe(TEXT,BIGINT,JSONB,TEXT)';
  const body = sql.split('CREATE FUNCTION public.pro273_trust_issuance_probe(')[1].split('END $$;')[0];
  const check = (source: string) => {
    const entry = source.indexOf("RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; -- entry denial");
    const discovery = source.indexOf('-- Discovery has exactly one key');
    const locks = source.split('-- Ordered acquisition.')[1]?.split('-- Full fixed-key reread')[0] ?? '';
    const reread = source.split('-- Full fixed-key reread')[1]?.split('-- No new issuance')[0] ?? '';
    const ordered = [
      'Pro311ControlDomain" WHERE "id" COLLATE "C"=\'global-v1\' COLLATE "C" FOR UPDATE NOWAIT',
      'Pro262CapacityPhysicalDomain" WHERE "physicalIdentity" COLLATE "C"=g0."physicalIdentity" COLLATE "C" FOR UPDATE NOWAIT',
      'Pro262CapacityTrust" WHERE ("trustId" COLLATE "C","generation")=(p_id COLLATE "C",p_generation) FOR SHARE NOWAIT',
      'Pro262CapacityControlBaseline" WHERE "kind" COLLATE "C"=\'TRUST_PROVISION\' COLLATE "C" FOR SHARE NOWAIT',
      'Pro262CapacityBootstrapTrust" WHERE ("trustId" COLLATE "C","generation")=(p_id COLLATE "C",p_generation) FOR UPDATE NOWAIT',
      'Pro262CapacityControlCharge" WHERE ("kind" COLLATE "C","eventKey" COLLATE "C")=(\'TRUST_PROVISION\' COLLATE "C",v_event COLLATE "C") FOR SHARE NOWAIT',
      'Pro273PublisherTrustProvenance"', 'Pro273BaselineTrustProvenance"',
    ].map(s => locks.indexOf(s));
    return entry >= 0 && entry < discovery && source.includes("current_setting('transaction_isolation') COLLATE \"C\" IS DISTINCT FROM 'read committed' COLLATE \"C\"") &&
      source.includes(`p_id COLLATE "C"='' COLLATE "C"`) && !source.includes('octet_length(p_id)') && ordered.every((n,i) => n >= 0 && (i===0 || n > ordered[i-1])) &&
      !/FOR\s+(?:UPDATE|SHARE)/i.test(reread) && ['ht','hc','hp','hq'].every(v => reread.includes(`present IS DISTINCT FROM ${v}`)) &&
      ['g','d','b','r'].every(x => reread.includes(`${x}0."`) && reread.includes(`${x}1."`)) &&
      source.includes("RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; -- terminal denial");
  };
  assert.equal(check(body), true);
  for (const mutated of [body.replace('FOR UPDATE NOWAIT','FOR SHARE NOWAIT'), body.replace('present IS DISTINCT FROM ht','FALSE'), body.replace('read committed','repeatable read'), body.replace('-- terminal denial','-- removed')]) assert.equal(check(mutated), false);
  assert.ok(roles.includes(`ALTER FUNCTION ${signature} OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,`));
  assert.doesNotMatch(roles, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*pro273_trust_issuance_probe/i);
  assert.equal(sql.split('pro273_trust_issuance_probe(').length - 1, 2); // declaration and PUBLIC revoke only
  assert.doesNotMatch(body, /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|pro262_capacity_trust_provision\s*\(|pro262_capacity_control_charge\s*\()/i);
});

test('issuance probe inert retry and funding mutations fail closed', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_trust_issuance_probe(')[1].split('END $$;')[0];
  for (const fragment of ['NOT ht', 'NOT hp OR hq', 'NOT hq OR hp', 'p1."provisioningTransactionId" IS NULL', 'q1."provisioningTransactionId" IS NULL', 'p1."provisionedAt" IS NULL', 'q1."provisionedAt" IS NULL', '(p1."provisionerName"::TEXT COLLATE "C") IS DISTINCT FROM (r1."principal"::TEXT COLLATE "C")', '(t1."issuer"::TEXT COLLATE "C") IS DISTINCT FROM ((p_record->>\'issuer\') COLLATE "C")', '(t1."supplierPrincipal"::TEXT COLLATE "C") IS DISTINCT FROM ((p_record->>\'supplierPrincipal\') COLLATE "C")', "q1.\"fundingMode\" COLLATE \"C\"='CHARGE' COLLATE \"C\"", "q1.\"fundingMode\" COLLATE \"C\"='CONTROL_BASELINE' COLLATE \"C\"", '(b1."coverageEvidenceHash"::TEXT COLLATE "C") IS NOT DISTINCT FROM (q1."baselineCoverageEvidenceHash"::TEXT COLLATE "C")']) assert.ok(body.includes(fragment), fragment);
  const valid = {trust:true, receipt:true, other:false, issuer:'issuer', subject:'publisher', publisher:'publisher', provisioner:'provisioner', root:'provisioner', xid:12, time:123, hash:'h', chargeHash:'h', mode:'CHARGE', coverage:'e', rootEvidence:'e', baselineEvidence:'e', enabled:true, purpose:'CONTROL_ALLOCATOR'};
  const complete = (x: typeof valid) => x.trust && x.receipt && !x.other && x.purpose==='CONTROL_ALLOCATOR' && !!x.issuer && x.subject===x.publisher && x.provisioner===x.root && !!x.xid && !!x.time && (x.mode==='CHARGE' ? x.hash===x.chargeHash : x.mode==='CONTROL_BASELINE' && x.purpose==='CONTROL_ALLOCATOR' && x.enabled && x.coverage===x.rootEvidence && x.coverage===x.baselineEvidence);
  assert.equal(complete(valid),true);
  assert.equal(complete({...valid,mode:'CONTROL_BASELINE'}),true);
  for (const changed of [{purpose:'OTHER'},{trust:false},{receipt:false},{other:true},{subject:'other'},{provisioner:'other'},{xid:0},{time:0},{chargeHash:'other'},{mode:'LEGACY'},{mode:'CONTROL_BASELINE',coverage:'other'}]) assert.equal(complete({...valid,...changed}),false,JSON.stringify(changed));
});


test('baseline trust scope and currentness gates remain inert and fail closed', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const probe = sql.split('CREATE FUNCTION public.pro273_trust_issuance_probe(')[1].split('END $$;')[0];
  const readers = ['layout', 'allocation'].map(kind => sql.split(`CREATE FUNCTION public.pro273_initial_verify_committed_${kind}(`)[1].split('END $$;')[0]);
  for (const [body, alias] of [...readers.map(body => [body, 'ptrust']), [probe, 't1']]) {
    const purpose = body.indexOf(alias === 't1' ? `(t1."purpose"::TEXT COLLATE "C") IS DISTINCT FROM ('CONTROL_ALLOCATOR'::TEXT COLLATE "C")` : `${alias}."purpose" IS DISTINCT FROM 'CONTROL_ALLOCATOR'`);
    const scopeExpr = alias === 't1' ? "(p_record->'scope')" : `${alias}."scope"`;
    const scope = body.indexOf(`pg_catalog.jsonb_typeof(${scopeExpr})${alias === 't1' ? ' COLLATE "C"' : ''} IS DISTINCT FROM 'object'`, purpose);
    const funding = body.indexOf(alias === 't1' ? `"fundingMode" COLLATE "C"='CHARGE'` : `"fundingMode"='CHARGE'`, scope);
    assert.ok(purpose >= 0 && scope > purpose && funding > scope);
    const kind = alias === 't1' ? `((${scopeExpr}->>'kind') COLLATE "C") IS DISTINCT FROM 'INSTALLER_CONSTRUCTOR_INPUT'` : `${scopeExpr}->>'kind' IS DISTINCT FROM 'INSTALLER_CONSTRUCTOR_INPUT'`;
    for (const part of [kind, `jsonb_object_keys(${scopeExpr}))=1`, `jsonb_object_keys(${scopeExpr}))=3`, "ARRAY['kind','inputEnvelope','inputBound']", '9223372036854775807']) assert.ok(body.includes(part), part);
    assert.match(body, /BEGIN\s+RAISE EXCEPTION '(?:SELECTION|CAPACITY)_UNAVAILABLE';/);
  }
  const validScope = (x: Record<string, unknown>) => x.kind === 'INSTALLER_CONSTRUCTOR_INPUT' && (Object.keys(x).length === 1 || (Object.keys(x).length === 3 && typeof x.inputEnvelope === 'string' && x.inputEnvelope.length > 0 && typeof x.inputBound === 'string' && /^[1-9][0-9]{0,18}$/.test(x.inputBound) && BigInt(x.inputBound) <= 9223372036854775807n));
  const charged = (purpose: string, scope: Record<string, unknown>) => purpose === 'CONTROL_ALLOCATOR' && validScope(scope);
  assert.equal(charged('CONTROL_ALLOCATOR', {kind:'INSTALLER_CONSTRUCTOR_INPUT'}), true);
  assert.equal(charged('CONTROL_ALLOCATOR', {kind:'INSTALLER_CONSTRUCTOR_INPUT', inputEnvelope:'proof', inputBound:'9223372036854775807'}), true);
  for (const scope of [{kind:'OTHER'}, {kind:'INSTALLER_CONSTRUCTOR_INPUT', inputBound:'1'}, {kind:'INSTALLER_CONSTRUCTOR_INPUT', inputEnvelope:'', inputBound:'1'}, {kind:'INSTALLER_CONSTRUCTOR_INPUT', inputEnvelope:'x', inputBound:'9223372036854775808'}, {kind:'INSTALLER_CONSTRUCTOR_INPUT', extra:'x'}]) assert.equal(charged('CONTROL_ALLOCATOR',scope),false);
  assert.equal(charged('OTHER',{kind:'INSTALLER_CONSTRUCTOR_INPUT'}),false);
  assert.match(probe, /Currentness gate only;[^\n]*does not prove the original role incarnation/);
  assert.match(probe, /Current role mapping only: rename\/recreation may deny or alias/);
  const current = (savedOid:number, savedName:string, oid:number, name:string) => savedOid === oid && savedName === name;
  assert.equal(current(10,'issuer',10,'renamed'),false);
  assert.equal(current(10,'issuer',11,'issuer'),false);
  assert.equal(current(10,'issuer',10,'issuer'),true); // OID reuse cannot establish historic incarnation.
  const reread = probe.split('-- Full fixed-key reread')[1].split('-- No new issuance')[0];
  assert.doesNotMatch(reread, /FOR\s+(?:UPDATE|SHARE)/i);
  assert.match(sql, /Narrow semantic projection plus selected native NUMERIC fields; not unchanged resource snapshots/);
});

test('issuance probe inert typed projection manifest and scope representations', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_trust_issuance_probe(')[1].split('END $$;')[0];
  const manifests: Record<string, string[]> = {
    g: ['id','physicalIdentity','proofIdentity','capacity','baseline','perWriteWorstCase','committed'],
    d: ['physicalIdentity','proofIdentity','backendCapacity','sharedCapacity','baselineBackend','baselineShared','enabled'],
    t: ['trustId','generation','issuer','supplierPrincipal','channelId','verifierKeyId','trustRootId','policyRevision','policyHash','purpose','scopeMatchesRecord','validFrom','validUntil','revoked'],
    b: ['kind','physicalIdentity','controlProofIdentity','coverageEvidenceHash','allocated','archiveBaselineUsed','eventWorstCase','coverageContract','maxClosedScopeBytes','spent','enabled'],
    r: ['trustId','generation','principal','channelId','recordHash','evidenceHash','validUntil'],
    c: ['kind','eventKey','bindingHash','amount'],
    p: ['trustId','generation','recordHash','chargeKind','chargeEventKey','provisionerOid','provisionerName','provisioningTransactionId','provisionedAt'],
    q: ['trustId','generation','recordHash','fundingMode','chargeKind','chargeEventKey','baselineKind','baselineCoverageEvidenceHash','baselineEnabledAtProvisioning','provisionerOid','provisionerName','provisioningTransactionId','provisionedAt'],
  };
  assert.doesNotMatch(body, /%ROWTYPE|SELECT\s+\*/i);
  for (const [key, fields] of Object.entries(manifests)) {
    for (const snapshot of ['0','1']) {
      const selects = [...body.matchAll(new RegExp(`SELECT ([^;]+?) INTO (?:STRICT )?${key}${snapshot} FROM public\\.`, 'g'))];
      assert.ok(selects.length > 0, key + snapshot);
      for (const [, projection] of selects) {
        const actual = [...projection.matchAll(/"([^"]+)"/g)].map(x => x[1]);
        if (key === 't') actual.splice(actual.indexOf('scope'), 1);
        assert.deepEqual(actual, fields, key + snapshot);
      }
    }
    for (const field of fields) assert.ok(body.includes(`${key}0."${field}"`) && body.includes(`${key}1."${field}"`), key + field);
  }
  for (const key of ['ht','hc','hp','hq']) assert.ok(body.includes(`present IS DISTINCT FROM ${key}`));
  for (const field of ['chargeKind','chargeEventKey','baselineKind','baselineCoverageEvidenceHash','baselineEnabledAtProvisioning','provisionerOid','provisionerName','provisioningTransactionId','provisionedAt']) assert.match(body, new RegExp(`q0\\."${field}"[^\\n]*IS DISTINCT FROM[^\\n]*q1\\."${field}"`));
  assert.equal((body.match(/"scope" IS NOT DISTINCT FROM p_record->'scope'/g) || []).length, 3);
  assert.match(body, /t1\."scopeMatchesRecord" IS DISTINCT FROM TRUE/);
  assert.match(body, /::TEXT COLLATE "C"/);
  for (const [key, field] of [['g','capacity'],['d','backendCapacity'],['b','allocated'],['c','amount']]) {
    assert.ok(body.includes(`${key}0."${field}" IS DISTINCT FROM ${key}1."${field}"`));
    assert.ok(body.includes(`pg_catalog.scale(${key}0."${field}") IS DISTINCT FROM pg_catalog.scale(${key}1."${field}")`));
  }
  const valid = (x: Record<string, unknown>) => typeof x.kind === 'string' && x.kind === 'INSTALLER_CONSTRUCTOR_INPUT' && (Object.keys(x).length === 1 || (Object.keys(x).length === 3 && typeof x.inputEnvelope === 'string' && x.inputEnvelope.length > 0 && typeof x.inputBound === 'string' && /^[1-9][0-9]{0,18}$/.test(x.inputBound) && BigInt(x.inputBound) <= 9223372036854775807n));
  assert.ok(valid({kind:'INSTALLER_CONSTRUCTOR_INPUT'}));
  assert.ok(valid({kind:'INSTALLER_CONSTRUCTOR_INPUT',inputEnvelope:'x'.repeat(1000),inputBound:'9223372036854775807'}));
  for (const extra of [{inputEnvelope:null,inputBound:'1'}, {inputEnvelope:'x',inputBound:null}, {inputEnvelope:'x',inputBound:1}, {inputEnvelope:'x',inputBound:'01'}, {inputEnvelope:'x',inputBound:'9223372036854775808'}, {inputEnvelope:'x',inputBound:'1',extra:null}]) assert.equal(valid({kind:'INSTALLER_CONSTRUCTOR_INPUT',...extra}),false);
  assert.match(body, /entry denial/); assert.match(body, /terminal denial/);
  assert.match(body, /EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'/);
  assert.doesNotMatch(body, /INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
  assert.match(sql, /^-- INCOMPLETE SOURCE CHECKPOINT\.[\s\S]*?RAISE EXCEPTION 'PRO273_SEL_IMPLEMENTATION_INCOMPLETE'/);
  for (const table of ['Pro273PublisherTrustProvenance','Pro273BaselineTrustProvenance']) assert.ok(sql.includes(`"${table}_block_insert" BEFORE INSERT`));
  for (const kind of ['layout','allocation']) assert.match(sql.split(`CREATE FUNCTION public.pro273_initial_verify_committed_${kind}(`)[1].split('END $$;')[0], /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.doesNotMatch(roles, /GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]*pro273_trust_issuance_probe/i);
  assert.equal(sql.split('pro273_trust_issuance_probe(').length, 3);
  // JSON equality leaves arbitrary nested publisher targets intact; the SQL does not retain a JSONB row.
  assert.doesNotMatch(body, /\b(?:t0|t1)\."scope"/);
  assert.match(sql, /Publisher target remains open: exact JSON equality is computed at each read, resource-unqualified/);
  const original = {target:{unknown:{future:[1, null, {enabled:true}]}}};
  assert.notDeepEqual(original, {target:{unknown:{future:[1, null, {enabled:false}]}}});
});


test('issuance probe inert C-exact routing scope and comparator mutations', () => {
  const sql = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
  const body = sql.split('CREATE FUNCTION public.pro273_trust_issuance_probe(')[1].split('END $$;')[0];
  const expected: [string, number][] = [
    [`"id" COLLATE "C"='global-v1' COLLATE "C"`,3],
    [`"physicalIdentity" COLLATE "C"=g0."physicalIdentity" COLLATE "C"`,3],
    [`("trustId" COLLATE "C","generation")=(p_id COLLATE "C",p_generation)`,12],
    [`"kind" COLLATE "C"='TRUST_PROVISION' COLLATE "C"`,3],
    [`("kind" COLLATE "C","eventKey" COLLATE "C")=('TRUST_PROVISION' COLLATE "C",v_event COLLATE "C")`,3],
    [`p_route COLLATE "C"='PUBLISHER' COLLATE "C"`,3],
    [`p_route COLLATE "C"='BASELINE' COLLATE "C"`,2],
    [`p_route COLLATE "C" NOT IN ('PUBLISHER' COLLATE "C",'BASELINE' COLLATE "C")`,1],
    ...['CHARGE','CONTROL_BASELINE'].map(mode => [`q1."fundingMode" COLLATE "C"='${mode}' COLLATE "C"`,1] as [string,number]),
    [`t1."purpose" COLLATE "C"='CONTROL_ALLOCATOR' COLLATE "C"`,1],
    [`q1."baselineKind" COLLATE "C"='TRUST_PROVISION' COLLATE "C"`,1],
    [`(((p_record->'scope')->>'kind') COLLATE "C") IS DISTINCT FROM 'INSTALLER_CONSTRUCTOR_INPUT' COLLATE "C"`,1],
    ...['inputEnvelope','inputBound'].map(field => [`pg_catalog.jsonb_typeof((p_record->'scope')->'${field}') COLLATE "C"='string' COLLATE "C"`,1] as [string,number]),
    [`COALESCE((p_record->'scope')->>'inputEnvelope','') COLLATE "C"<>'' COLLATE "C"`,1],
    [`COALESCE((p_record->'scope')->>'inputBound','') COLLATE "C" ~ '^[1-9][0-9]{0,18}$' COLLATE "C"`,1],
  ];
  const count = (source: string, term: string) => source.split(term).length - 1;
  const check = (source: string) => expected.every(([term, n]) => count(source,term) === n);
  assert.equal(check(body),true);
  for (const [term] of expected) {
    // Strip either operand's explicit collation and require the manifest to reject it.
    const positions = [...term.matchAll(/ COLLATE "C"/g)].map(m => m.index!);
    for (const pos of positions) {
      const changed = term.slice(0,pos) + term.slice(pos).replace(' COLLATE "C"','');
      assert.equal(check(body.replace(term,changed)),false,term);
    }
  }
  for (const field of ['issuer','supplierPrincipal','channelId','verifierKeyId','trustRootId','policyRevision','policyHash','purpose'])
    assert.ok(body.includes(`(t1."${field}"::TEXT COLLATE "C") IS DISTINCT FROM ((p_record->>'${field}') COLLATE "C")`),field);
  assert.equal((body.match(/"scope" IS NOT DISTINCT FROM p_record->'scope'/g) || []).length,3);
  assert.ok(body.includes(`p_generation<=0`));
  assert.ok(body.includes(`v_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex')`));
});
