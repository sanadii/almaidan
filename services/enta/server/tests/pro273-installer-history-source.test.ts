import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../prisma');
const source = readFileSync(join(root, 'migrations/20261028160000_pro273_selection_completion/migration.sql'), 'utf8');
const roles = readFileSync(join(root, 'roles/pro273_selection_completion_roles.sql'), 'utf8');
const signature = 'pro273_initial_discover_installer_history';
const body = source.split(`CREATE FUNCTION public.${signature}(`)[1]?.split('END $$;')[0];

test('history discovery is private, unconditionally denied, and projects typed scalars', () => {
  assert.ok(body);
  assert.match(body, /^p_baseline_id TEXT\) RETURNS VOID\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS \$\$/);
  assert.match(body, /BEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
  assert.match(body, /delivery\."eventId"=exp\."eventId";\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';\s*$/);
  assert.match(body, /INTO STRICT[\s\S]*?FROM public\."Pro273ControlPlaneBaseline"/);
  assert.doesNotMatch(body, /SELECT\s+\*|\w+\.\*|%ROWTYPE|capturedBytes|evidenceBytes|\b(?:LOCK|INSERT|UPDATE|DELETE|GRANT)\b|FOR SHARE|\bJSONB\b/i);
  assert.match(roles, new RegExp(`ALTER FUNCTION public\\.${signature}\\(TEXT\\) OWNER TO pro262_capacity_owner;`));
  assert.ok(roles.includes(`REVOKE ALL ON FUNCTION public.${signature}(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;`));
  assert.doesNotMatch(roles, new RegExp(`GRANT[^;]*${signature}`));
  assert.ok(roles.includes("DO $$ BEGIN RAISE EXCEPTION 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE'; END $$;"));
  assert.match(source, /CREATE FUNCTION public\.pro273_initial_verify_committed_layout\([\s\S]*?\bBEGIN\s+RAISE EXCEPTION 'SELECTION_UNAVAILABLE';/);
});

test('fixed projection pairs source columns with typed destinations for installer keys', () => {
  assert.ok(body);
  const projection = body.match(/SELECT ([\s\S]*?)\s+INTO STRICT ([\s\S]*?)\s+FROM public\."Pro273ControlPlaneBaseline"/);
  assert.ok(projection);
  const columns = projection[1].split(',').map(value => value.trim());
  const variables = projection[2].split(',').map(value => value.trim());
  assert.equal(columns.length, variables.length);
  const pairs = new Map(columns.map((column, index) => [column, variables[index]]));
  for (const [column, variable, type] of [
    ['base."baselineId"', 'v_baseline_id', 'TEXT'], ['prov."bootstrapKind"', 'v_bootstrap_kind', 'TEXT'],
    ['exp."expectationId"', 'v_expectation_id', 'TEXT'], ['exp."launchEpoch"', 'v_launch_epoch', 'TEXT'],
    ['constructor_claim."inputClaimId"', 'v_constructor_claim_id', 'TEXT'], ['constructor_slot."reservationId"', 'v_constructor_reservation_id', 'TEXT'],
    ['constructor_slot."observerTrustGeneration"', 'v_constructor_trust_generation', 'BIGINT'], ['constructor_slot."recordHash"', 'v_constructor_slot_hash', 'TEXT'],
    ['observation."observationId"', 'v_observation_id', 'TEXT'], ['observation_claim."inputClaimId"', 'v_observation_claim_id', 'TEXT'],
    ['observation_slot."reservationId"', 'v_observation_reservation_id', 'TEXT'], ['observation_slot."prepaidEventKey"', 'v_observation_slot_event', 'TEXT'],
    ['observation."trustGeneration"', 'v_observation_trust_generation', 'BIGINT'], ['observation."chargeBindingHash"', 'v_observation_charge_hash', 'TEXT'],
    ['session_claim."sessionClaimId"', 'v_session_id', 'TEXT'], ['session_claim."chargeBindingHash"', 'v_session_charge_hash', 'TEXT'],
    ['attempt."attemptId"', 'v_attempt_id', 'TEXT'], ['attempt."chargeBindingHash"', 'v_dispatch_charge_hash', 'TEXT'],
    ['delivery."chargeBindingHash"', 'v_delivery_charge_hash', 'TEXT'], ['delivery."receiverClosureHash"', 'v_receiver_hash', 'TEXT'],
  ]) {
    assert.equal(pairs.get(column), variable, column);
    assert.match(body, new RegExp(`\\b${variable} ${type}\\b`));
  }
});

test('discovery follows the original keyed constructor and observation chains', () => {
  assert.ok(body);
  for (const fragment of [
    '(prov."baselineId",prov."coreHash")=(base."baselineId",base."coreHash")',
    'exp."bootstrapKind"=prov."bootstrapKind"',
    'constructor_claim."inputClaimId"=prov."inputClaimId"',
    'constructor_slot."reservationId"=constructor_claim."reservationId"',
    'constructor_binding."reservationId"=constructor_slot."reservationId"',
    '(observation."expectationId",observation."credentialEpoch",observation."launchEpoch")=(exp."expectationId",exp."credentialEpoch",exp."launchEpoch")',
    'observation_claim."inputClaimId"=observation."inputClaimId"',
    'observation_slot."reservationId"=observation_claim."reservationId"',
    'observation_binding."reservationId"=observation_slot."reservationId"',
    '(session_claim."expectationId",session_claim."sessionClaimId")=(exp."expectationId",exp."sessionClaimId")',
    'exp."dispatchAttemptId",exp."expectationId",session_claim."sessionClaimId",constructor_claim."inputClaimId"',
    'attempt."deliveryChargeKind",attempt."deliveryChargeEventKey",attempt."deliveryChargeBindingHash"',
    "'INSTALLER_CONSTRUCTOR_INPUT'", "'INSTALLER_OBSERVATION'", "'CONTROL_PLANE_BASELINE'",
    'delivery."eventId"=exp."eventId"',
  ]) assert.ok(body.includes(fragment), fragment);
});
