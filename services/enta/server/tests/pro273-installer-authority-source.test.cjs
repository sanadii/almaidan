// Inert text/trace checks only: these do not parse or execute SQL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const migration = readFileSync(join(__dirname, '../prisma/migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
const roles = readFileSync(join(__dirname, '../prisma/roles/pro273_selection_completion_roles.sql'), 'utf8');
const body = migration.split('CREATE FUNCTION public.pro273_installer_acquire_authority')[1].split('REVOKE ALL ON FUNCTION public.pro273_installer_acquire_authority')[0];

test('source routes every trust before ordered acquisition and rejects changed routing', () => {
  const ordered = body.indexOf('FOR v_key IN SELECT DISTINCT');
  for (const name of ['v_hint', 'v_observation_hint', 'v_input_hint', 'v_obs_slot_hint']) {
    assert.match(body.slice(ordered, body.indexOf('END LOOP;', ordered)), new RegExp(name + '\\."(?:observerTrustId|trustId)"'));
  }
  for (const name of ['v_input', 'v_binding', 'v_claim', 'v_obs_claim', 'v_obs_slot', 'v_expected', 'v_observation']) {
    assert.ok(body.includes(`${name} IS DISTINCT FROM ${name === 'v_expected' ? 'v_hint' : name + '_hint'}`), name);
  }
  assert.match(body, /COLLATE "C"[\s\S]*ORDER BY trust_id,generation/);
  assert.match(body, /v_obs_slot\."observerTrustId"[\s\S]*IS DISTINCT FROM \(v_observation\."trustId"/);
  for (const term of ['CONTROL_ALLOCATOR', 'INSTALLER_CONSTRUCTOR_INPUT', 'supplierPrincipal', 'revoked', 'validFrom', 'validUntil', 'pro273_installer_slot_matches']) assert.ok(body.includes(term), term);
  assert.ok(body.indexOf('v_input IS DISTINCT FROM v_input_hint') < body.indexOf('INTO STRICT v_input_trust'));
  assert.match(roles, /Source lock removal requires reviewed Source closure/);
  assert.match(roles, /PRO273_SEL_ROLE_CLOSURE_INCOMPLETE/);
  assert.match(roles, /PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE/);
});

test('inert trace model covers distinct, duplicate, reverse, revocation and substitution', () => {
  // Illustrates intended decisions; the assertions above bind the relevant source text.
  const trace = (hint, current, revoked = []) => {
    const locks = [...new Set(hint.map(([id, gen]) => `${id}:${gen}`))].sort();
    return { locks, allow: JSON.stringify(hint) === JSON.stringify(current) && !revoked.some(x => locks.includes(x)) };
  };
  const three = [['c', 1], ['a', 1], ['b', 1], ['a', 1]];
  assert.deepEqual(trace(three, three).locks, ['a:1', 'b:1', 'c:1']);
  assert.deepEqual(trace([...three].reverse(), [...three].reverse()).locks, ['a:1', 'b:1', 'c:1']);
  assert.equal(trace(three, three, ['b:1']).allow, false);
  assert.equal(trace(three, [['c', 1], ['a', 1], ['x', 1], ['a', 1]]).allow, false);
});

test('pair entry takes strong locks before installer reads and remains deny-only', () => {
  const entry = migration.split('CREATE FUNCTION public.pro273_sel_construct_invocation_pair')[1]
    .split('REVOKE ALL ON FUNCTION public.pro273_sel_construct_invocation_pair')[0];
  const global = entry.indexOf('FROM public."Pro311ControlDomain"');
  const physical = entry.indexOf('FROM public."Pro262CapacityPhysicalDomain"');
  const delivery = entry.indexOf('pro273_installer_assert_committed_delivery');
  const context = entry.indexOf('pro273_installer_metadata_context');
  const parser = entry.indexOf('pro273_installer_parse_pair_metadata');
  assert.ok(global > 0 && global < physical && physical < delivery && delivery < context && context < parser);
  assert.equal((entry.slice(global, delivery).match(/FOR UPDATE NOWAIT/g) || []).length, 2);
  assert.match(entry, /current_setting\('transaction_isolation'\).*read committed/);
  assert.match(entry, /v_charge\."bindingHash" IS DISTINCT FROM v_context->'charge'->>'bindingHash'/);
  assert.match(entry, /deny rather than insert partial records[\s\S]*RAISE EXCEPTION 'SELECTION_UNAVAILABLE'/);
  assert.doesNotMatch(entry, /\bINSERT\s+INTO\b/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.pro273_sel_construct_invocation_pair\(TEXT,BYTEA\) FROM PUBLIC/);
});
