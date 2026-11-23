// Inert literal consistency checks; no SQL parsing or execution.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = path => readFileSync(join(__dirname, '../prisma', path), 'utf8');
const roles = read('roles/pro273_selection_completion_roles.sql');
const selection = read('migrations/20261028160000_pro273_selection_completion/migration.sql');
const supplier = read('migrations/20261028140000_pro262_capacity_supplier/migration.sql');

test('candidate names match source ordinary immutable triggers and retain replication denial', () => {
  for (const [source, fn, names] of [
    [selection, 'pro273_sel_immutable', ['Pro273ControlPlaneInstallerExpectation', 'Pro273InstallerProcessObservation', 'Pro273InstallerSlotBinding', 'Pro273InstallerSessionClaim', 'Pro273InstallerDispatchAttempt', 'Pro273InstallerDelivery']],
    [supplier, 'pro262_capacity_immutable', ['Pro262CapacityBootstrapBaseline', 'Pro262CapacityBootstrapTrust', 'Pro262CapacityObserverInputReservation', 'Pro262CapacityObserverInputClaim', 'Pro262CapacityControlCharge']],
  ]) for (const name of names) {
    assert.ok(source.includes(`CREATE TRIGGER "${name}_immutable" BEFORE UPDATE OR DELETE ON public."${name}" FOR EACH ROW EXECUTE FUNCTION public.${fn}();`), name);
    assert.ok(roles.includes(`('${name}','${fn}')`), name);
  }
  assert.ok(roles.includes("t.tgtype=27 AND t.tgenabled='O'"));
  assert.ok(roles.includes('PRO273_SEL_AUDIT_TRIGGER_REPLICATION_BYPASS_UNRESOLVED'));
  assert.ok(roles.includes('PRO273_SEL_ROLE_CLOSURE_INCOMPLETE'));
  assert.ok(roles.includes('PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE'));
});

test('schema owner requires separate approval and fixed observer grant remains', () => {
  assert.ok(roles.includes('v_approved_schema_owner OID := NULL'));
  assert.ok(roles.includes('PRO273_SEL_AUDIT_SCHEMA_OWNER_APPROVAL_REQUIRED'));
  assert.ok(!roles.includes('n.nspowner<>v_owner'));
  assert.ok(roles.includes('GRANT EXECUTE ON FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) TO pro262_install_observer;'));
  assert.ok(roles.includes('ALTER FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) OWNER TO pro262_capacity_owner;'));
  assert.ok(roles.includes("p.oid=pg_catalog.to_regprocedure('public.pro273_installer_accept_process_observation(text,text,jsonb,bytea)')"));
  assert.ok(roles.includes("a.grantee=pg_catalog.to_regrole('pro262_install_observer')"));
  assert.ok(roles.includes("a.grantee=v_grantee AND a.grantor=v_owner\n    AND a.privilege_type='EXECUTE' AND NOT a.is_grantable"));
  assert.ok(roles.includes('a.grantee<>v_grantee OR a.grantor<>v_owner OR a.is_grantable'));
});

test('unknown creation history remains denied, including a null proof', () => {
  assert.ok(roles.includes('v_approved_installation_executor OID := NULL'));
  assert.ok(roles.includes('v_authorized_creators OID[] := NULL'));
  assert.ok(roles.includes('v_creation_ownership_transitions_proven BOOLEAN := FALSE'));
  assert.ok(roles.includes('OR v_creation_ownership_transitions_proven IS DISTINCT FROM TRUE'));
  assert.ok(!roles.includes('OR NOT v_creation_ownership_transitions_proven'));
  assert.ok(roles.includes("THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN'"));
});

test('effective execution uses the independent principal and membership contract', () => {
  for (const literal of [
    'v_runtime_principals OID[] := NULL', 'v_trusted_admin_principals OID[] := NULL',
    'v_expected_memberships JSONB := NULL', 'v_trusted_admin_boundary_proven BOOLEAN := FALSE',
    'v_set_role_and_owner_assumptions_proven BOOLEAN := FALSE',
    'PRO273_SEL_AUDIT_PRINCIPAL_CONTRACT_UNPROVEN', 'PRO273_SEL_AUDIT_PRINCIPAL_CONTRACT_MISMATCH',
    'pg_catalog.to_jsonb(m) ORDER BY m.member,m.roleid,m.grantor',
    'r.oid=ANY(v_runtime_principals) AND r.rolsuper',
    "pg_catalog.has_function_privilege(r.oid,v_entry,'EXECUTE') IS DISTINCT FROM pg_catalog.pg_has_role(r.oid,v_grantee,'USAGE')",
    'r.oid=v_grantee AND (r.rolcanlogin OR r.rolsuper)',
    'a.grantee<>v_grantee OR a.grantor<>v_owner OR a.is_grantable',
    "AND NOT p.proretset AND NOT p.proisstrict AND p.provolatile='v'",
    'p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0 AND p.proargmodes IS NULL',
    'SELECT public.pro311_own_backend_start()', 'SELECT public.pro311_backend_is_live(p_principal,p_pid,p_started)',
    'PRO273_SEL_AUDIT_TRANSITIVE_EFFECTS_UNPROVEN',
  ]) assert.ok(roles.includes(literal), literal);
  assert.ok(!roles.includes('r.oid NOT IN (v_owner,v_grantee)'));
  assert.ok(!roles.includes('r.oid<>v_owner\n    AND pg_catalog.has_function_privilege'));
});
