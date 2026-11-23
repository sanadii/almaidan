-- INCOMPLETE ROLE CHECKPOINT; migration and role closure require one installation transaction.
-- Never execute or install under R6 STOP. No real principal is granted a capability here.
DO $$ BEGIN RAISE EXCEPTION 'PRO262_CAP_ROLE_CLOSURE_INCOMPLETE'; END $$;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['pro262_capacity_owner','pro262_control_allocator','pro262_trust_provisioner','pro262_supplier_publisher','pro262_approval_importer','pro262_qualification_publisher','pro262_supervisor','pro262_replay_executor','pro262_issuer','pro262_producer','pro262_revoker','pro262_cleanup_publisher','pro262_install_observer','pro262_release_authority'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
   EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',role_name);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)) THEN
   RAISE EXCEPTION 'PRO262_CAP_UNSAFE_ROLE';
  END IF;
 END LOOP;
END $$;
-- INCOMPLETE: exact object ownership, fixed entry EXECUTE, cross-owner column SELECT /
-- REFERENCES / monotonic committed UPDATE, inherited membership, grant-option, PUBLIC,
-- default ACL, overload, schema CREATE and transitive LOGIN / SET ROLE audits remain.
-- No broad relation access, producer mutation, owner membership or helper grant is approved.
-- Exact ownership/revocation for the new protected relation set.
DO $$
DECLARE name TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['Pro262CapacityTrust','Pro262VerifiedSupplierReceipt','Pro262CapacityApproval','Pro262CapacityQualification','Pro262CapacityControlReservation','Pro262CapacityReplayMiss','Pro262CapacityIssuanceRequest','Pro262CapacityDebit','Pro262CapacityAdmission','Pro262CapacityCleanupReceipt','Pro262CapacityStageBinding','Pro262CapacitySetupIntent','Pro262CapacityControlBaseline','Pro262CapacityControlCharge','Pro262CapacityReplay','Pro262CapacitySpool','Pro262CapacitySpoolConsumption','Pro262CapacityBootstrapTrust','Pro262CapacityBootstrapQualification','Pro262CapacityPhysicalDomain','Pro262CapacityBootstrapPhysical','Pro262CapacityBootstrapBaseline','Pro262CapacityReplayProfile','Pro262CapacityBootstrapReplayProfile','Pro262CapacityReplayCleanupReceipt','Pro262CapacityControlCleanupReceipt','Pro262CapacityConnectionIntent','Pro262CapacityConnectionObservation','Pro262CapacityPrincipalLease','Pro262CapacityClosedScopeReceipt','Pro262CapacityLaunchReservation','Pro262CapacityObserverInputReservation','Pro262CapacityObserverInputClaim','Pro262CapacityProcessObservation','Pro262CapacityApplicability'] LOOP
  IF pg_catalog.to_regclass(pg_catalog.format('public.%I',name)) IS NULL THEN RAISE EXCEPTION 'PRO262_CAP_RELATION_MISSING'; END IF;
  EXECUTE pg_catalog.format('ALTER TABLE public.%I OWNER TO pro262_capacity_owner',name);
  EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,pro262_control_allocator,pro262_trust_provisioner,pro262_supplier_publisher,pro262_approval_importer,pro262_qualification_publisher,pro262_supervisor,pro262_replay_executor,pro262_issuer,pro262_producer,pro262_revoker,pro262_cleanup_publisher,pro262_install_observer,pro262_release_authority',name);
 END LOOP;
END $$;
-- Precisely named routines and overloads; nothing is executable by PUBLIC by default.
DO $$
DECLARE signature TEXT; procedure_oid REGPROCEDURE;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.pro262_capacity_applicability_immutable()','public.pro262_capacity_valid_native_subject(jsonb)','public.pro262_capacity_owner_context(text,bigint)','public.pro262_capacity_pg_subject_lock(text,bigint,text,text,text,bigint,text,text)','public.pro262_capacity_pg_policy(text,bigint,text)','public.pro262_capacity_pg_lobby(text,bigint,text,text,text,bigint)','public.pro262_capacity_pg_content(text,bigint,text,text,text,bigint,text,text)','public.pro262_capacity_pg_custody(text,bigint,text)','public.pro262_capacity_owner_request(text,bigint)','public.pro262_capacity_owner_fence(text)','public.pro262_capacity_owner_discovery(text,bigint)','public.pro262_capacity_assert_native_subject(jsonb)','public.pro262_capacity_enta_subject(text,bigint,text,text,text)','public.pro262_capacity_enta_parent(text,bigint,text,text,text,jsonb)','public.pro262_capacity_enta_catalog(text,bigint,text,text,text,text)','public.pro262_capacity_enta_exposure(text,bigint,text,text,text,text,text,text,text)','public.pro262_capacity_immutable()','public.pro262_capacity_admission_guard()','public.pro262_capacity_trust_guard()','public.pro262_capacity_qualification_guard()','public.pro262_capacity_control_guard()',
  'public.pro262_capacity_precharge(text)','public.pro262_capacity_revoke(text,bigint)','public.pro262_capacity_revoke_trust(text,bigint)','public.pro262_capacity_quarantine(text,bigint)',
  'public.pro262_capacity_validate_proof(jsonb)','public.pro262_capacity_recheck(text,bigint)','public.pro262_capacity_resolve(text,text,text,text)',
  'public.pro262_capacity_accept_cleanup(text,bigint,text,text,jsonb,bytea)','public.pro262_capacity_release(text,bigint,text)',
  'public.pro262_capacity_control_baseline_guard()','public.pro262_capacity_control_charge(text,text,text)','public.pro262_capacity_control_prepare(text,text,jsonb)','public.pro262_capacity_setup_intent(jsonb,jsonb,jsonb,text,text)',
  'public.pro262_capacity_assert_setup_row(jsonb)','public.pro262_capacity_setup_close()','public.pro262_capacity_stage_resolve(text,jsonb)','public.pro262_capacity_stage_before()',
  'public.pro262_capacity_bind(text,text)','public.pro262_capacity_stage_after()','public.pro262_capacity_assert_stage(text,text)','public.pro262_capacity_stage_close()',
  'public.pro262_capacity_material_before()','public.pro262_capacity_assert_stage_identity(text,text)','public.pro262_capacity_spool_commit(text,bytea)','public.pro262_capacity_replay_probe(text,text)',
  'public.pro262_capacity_read_spool(text,bigint,text)','public.pro262_capacity_begin(text,bigint)','public.pro262_capacity_read_context(text,bigint)','public.pro262_capacity_assert_spool_request(text,bigint,jsonb)','public.pro262_capacity_accept_supplier(text,text,bigint,bytea,bytea)','public.pro262_capacity_import(text)','public.pro262_capacity_find_qualification(text)',
  'public.pro262_capacity_trust_provision(text,bigint,jsonb)','public.pro262_capacity_read_miss(text)','public.pro262_capacity_read_admission(text,bigint)','public.pro262_capacity_read_outcome(text,bigint)','public.pro262_capacity_read_issued(text)','public.pro262_capacity_read_cleanup(text,bigint,text)','public.pro262_capacity_publish_qualification(text,text,bigint,jsonb)',
  'public.pro262_capacity_register_control(text,jsonb)','public.pro262_capacity_register_replay(text,text,jsonb)','public.pro262_capacity_register_issuance(text,jsonb)',
  'public.pro262_capacity_physical_domain_guard()','public.pro262_capacity_publish_replay_profile(jsonb)','public.pro262_capacity_read_replay_profile(text)','public.pro262_capacity_revoke_replay_profile(text)','public.pro262_capacity_quarantine_control(text)','public.pro262_capacity_accept_replay_cleanup(text,text,text,jsonb,bytea)','public.pro262_capacity_accept_control_cleanup(text,text,text,jsonb,bytea)','public.pro262_capacity_release_control(text,text,text)','public.pro262_capacity_issue(text)','public.pro262_capacity_provision_observer_input(jsonb)','public.pro262_capacity_claim_observer_input(text,text,text)','public.pro262_capacity_assert_observer_claim(text,text,text,numeric)','public.pro262_capacity_accept_install_observation(text,text,text,jsonb,bytea)','public.pro262_capacity_assert_process_installation(text,text)','public.pro262_capacity_assert_observed_target(text,text,name,integer,timestamp with time zone)','public.pro262_capacity_launch_guard()','public.pro262_capacity_assert_launch_integrity()','public.pro262_capacity_reserve_launch(text,text)','public.pro262_capacity_principal_lease_guard()','public.pro262_capacity_control_backends_absent(text)','public.pro262_capacity_read_observer_input_limit()','public.pro262_capacity_read_cleanup_limit(text,text,bigint)','public.pro262_capacity_read_closed_scope_limit(text)','public.pro262_capacity_accept_closed_scope(text,text,jsonb,bytea)','public.pro262_capacity_connection_guard()','public.pro262_capacity_prepare_connection(text,text)','public.pro262_capacity_bind_connection(text,text,name,integer,timestamp with time zone,text,text,text)','public.pro262_capacity_observe_connection(text,text,text,jsonb,bytea)','public.pro262_capacity_archive_gate()','public.pro262_capacity_physical_provision(jsonb)','public.pro262_capacity_control_provision(jsonb)'
 ] LOOP
  procedure_oid:=pg_catalog.to_regprocedure(signature);
  IF procedure_oid IS NULL THEN RAISE EXCEPTION 'PRO262_CAP_ROUTINE_MISSING'; END IF;
  EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO pro262_capacity_owner',procedure_oid);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,pro262_control_allocator,pro262_trust_provisioner,pro262_supplier_publisher,pro262_approval_importer,pro262_qualification_publisher,pro262_supervisor,pro262_replay_executor,pro262_issuer,pro262_producer,pro262_revoker,pro262_cleanup_publisher,pro262_install_observer,pro262_release_authority',procedure_oid);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_control_prepare(TEXT,TEXT,JSONB),public.pro262_capacity_claim_observer_input(TEXT,TEXT,TEXT) TO pro262_control_allocator;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_trust_provision(TEXT,BIGINT,JSONB) TO pro262_trust_provisioner;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_accept_supplier(TEXT,TEXT,BIGINT,BYTEA,BYTEA) TO pro262_supplier_publisher;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_import(TEXT),public.pro262_capacity_find_qualification(TEXT) TO pro262_approval_importer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_publish_qualification(TEXT,TEXT,BIGINT,JSONB),public.pro262_capacity_physical_provision(JSONB),public.pro262_capacity_control_provision(JSONB),public.pro262_capacity_publish_replay_profile(JSONB),public.pro262_capacity_provision_observer_input(JSONB) TO pro262_qualification_publisher;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_register_control(TEXT,JSONB),public.pro262_capacity_register_replay(TEXT,TEXT,JSONB),public.pro262_capacity_register_issuance(TEXT,JSONB),public.pro262_capacity_spool_commit(TEXT,BYTEA),public.pro262_capacity_read_miss(TEXT),public.pro262_capacity_read_admission(TEXT,BIGINT),public.pro262_capacity_read_outcome(TEXT,BIGINT),public.pro262_capacity_read_issued(TEXT),public.pro262_capacity_read_cleanup(TEXT,BIGINT,TEXT),public.pro262_capacity_read_replay_profile(TEXT),public.pro262_capacity_quarantine(TEXT,BIGINT),public.pro262_capacity_quarantine_control(TEXT),public.pro262_capacity_prepare_connection(TEXT,TEXT),public.pro262_capacity_reserve_launch(TEXT,TEXT) TO pro262_supervisor;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_replay_probe(TEXT,TEXT),public.pro262_capacity_read_miss(TEXT) TO pro262_replay_executor;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_issue(TEXT) TO pro262_issuer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_read_spool(TEXT,BIGINT,TEXT),public.pro262_capacity_begin(TEXT,BIGINT),public.pro262_capacity_read_context(TEXT,BIGINT),public.pro262_capacity_assert_spool_request(TEXT,BIGINT,JSONB) TO pro262_producer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_revoke(TEXT,BIGINT),public.pro262_capacity_revoke_trust(TEXT,BIGINT),public.pro262_capacity_revoke_replay_profile(TEXT) TO pro262_revoker;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_accept_cleanup(TEXT,BIGINT,TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_accept_replay_cleanup(TEXT,TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_accept_control_cleanup(TEXT,TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_observe_connection(TEXT,TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_accept_closed_scope(TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_read_closed_scope_limit(TEXT),public.pro262_capacity_read_observer_input_limit(),public.pro262_capacity_read_cleanup_limit(TEXT,TEXT,BIGINT) TO pro262_cleanup_publisher;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_accept_install_observation(TEXT,TEXT,TEXT,JSONB,BYTEA),public.pro262_capacity_read_observer_input_limit() TO pro262_install_observer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_release(TEXT,BIGINT,TEXT),public.pro262_capacity_release_control(TEXT,TEXT,TEXT) TO pro262_release_authority;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_resolve(TEXT,TEXT,TEXT,TEXT),public.pro262_capacity_assert_stage(TEXT,TEXT),public.pro262_capacity_assert_stage_identity(TEXT,TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_resolve(TEXT,TEXT,TEXT,TEXT),public.pro262_capacity_setup_intent(JSONB,JSONB,JSONB,TEXT,TEXT),public.pro262_capacity_assert_setup_row(JSONB) TO huroof_pg_service_executor,huroof_pg_owner;

-- New wrappers use the existing native owner; producer cannot call the heavy originals.
ALTER FUNCTION public.pro262_capacity_enta_subject(TEXT,BIGINT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.pro262_capacity_enta_parent(TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.pro262_capacity_enta_catalog(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.pro262_capacity_enta_exposure(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.pro262_capacity_enta_subject(TEXT,BIGINT,TEXT,TEXT,TEXT),public.pro262_capacity_enta_parent(TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB),public.pro262_capacity_enta_catalog(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT),public.pro262_capacity_enta_exposure(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,pro262_producer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_enta_parent(TEXT,BIGINT,TEXT,TEXT,TEXT,JSONB),public.pro262_capacity_enta_catalog(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT),public.pro262_capacity_enta_exposure(TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO pro262_producer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_owner_request(TEXT,BIGINT),public.pro262_capacity_owner_fence(TEXT),public.pro262_capacity_owner_discovery(TEXT,BIGINT),public.pro262_capacity_assert_native_subject(JSONB) TO enta_finance_executor,huroof_pg_service_executor;
REVOKE EXECUTE ON FUNCTION public.e3_comp_parent(TEXT,TEXT,TEXT,JSONB),public.int8_catalog(TEXT,TEXT,TEXT,TEXT),public.e3_comp_exposure_frontier(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM pro262_producer;
ALTER FUNCTION public.pro262_capacity_pg_subject_lock(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro262_capacity_pg_policy(TEXT,BIGINT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.pro262_capacity_pg_lobby(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.pro262_capacity_pg_content(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.pro262_capacity_pg_custody(TEXT,BIGINT,TEXT) OWNER TO huroof_pg_service_executor;
REVOKE ALL ON FUNCTION public.pro262_capacity_pg_policy(TEXT,BIGINT,TEXT),public.pro262_capacity_pg_subject_lock(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro262_capacity_pg_lobby(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT),public.pro262_capacity_pg_content(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro262_capacity_pg_custody(TEXT,BIGINT,TEXT) FROM PUBLIC,pro262_producer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_pg_subject_lock(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) TO huroof_pg_service_executor,pro262_capacity_owner;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_enta_subject(TEXT,BIGINT,TEXT,TEXT,TEXT) TO pro262_capacity_owner;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_pg_policy(TEXT,BIGINT,TEXT),public.pro262_capacity_pg_lobby(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT),public.pro262_capacity_pg_content(TEXT,BIGINT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro262_capacity_pg_custody(TEXT,BIGINT,TEXT) TO pro262_producer;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_owner_context(TEXT,BIGINT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_owner_context(TEXT,BIGINT),public.pro262_capacity_owner_request(TEXT,BIGINT),public.pro262_capacity_owner_fence(TEXT),public.pro262_capacity_owner_discovery(TEXT,BIGINT),public.pro262_capacity_assert_native_subject(JSONB) TO huroof_pg_owner;
REVOKE EXECUTE ON FUNCTION public.eng03_03_policy_read(TEXT),public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT),public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.eng03_03_custody_policy(TEXT) FROM pro262_producer;
-- Do not change the accepted activity-reader ACL; wrappers retain its original owner edge.
ALTER FUNCTION public.pro262_capacity_backend_start() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro262_capacity_backend_live(NAME,INTEGER,TIMESTAMPTZ) OWNER TO huroof_pg_owner;
REVOKE ALL ON FUNCTION public.pro262_capacity_backend_start(),public.pro262_capacity_backend_live(NAME,INTEGER,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pro262_capacity_backend_start(),public.pro262_capacity_backend_live(NAME,INTEGER,TIMESTAMPTZ) TO pro262_capacity_owner;
-- Private owner reads only columns actually referenced by its protected consumers.
GRANT SELECT ("id","physicalIdentity","proofIdentity","capacity","committed","baseline"), UPDATE ("committed") ON public."Pro311ControlDomain" TO pro262_capacity_owner;
GRANT SELECT ("state","reservedBackendBytes","reservedSharedBytes","reservedStorageBytes") ON public."Pro311NativeAdmission",public."Pro311PreflightAdmission" TO pro262_capacity_owner;
GRANT SELECT ("id","ownerId","walletId","namespaceId","projectId","uid","envelopeVersion","e3Protocol","requestKey","logicalId","clientHash","protocol","format","rules","mode","parentGameId","terminalHash","externalRequest","nativeRequest","nativeRequestHash"), REFERENCES ("id") ON public."E3StartReservation" TO pro262_capacity_owner;
GRANT SELECT ("stageId","namespace","ownerId","setupKey","freshRoomId","requestKey","logicalMatchId","nativeLogicalMatchId","externalRequest","externalHash","nativeIntent","nativeInitial","nativeProjections","nativeRequestHash","expectedAdmissionId","expectedMatchId","createdAt"), REFERENCES ("stageId") ON public."HuroofSuccessorStartReservation" TO pro262_capacity_owner;
GRANT SELECT ("namespace","ownerId","setupKey","parentMatchId","parentRoomId","originalVersion","originalHash","latestVersion","latestHash","freshRoomId","freshRoomGeneration","createKey","createRevision","externalRequest","externalHash","createIntent","createOutcome","createStateHash","createdAt"), REFERENCES ("namespace","ownerId","setupKey","freshRoomId") ON public."HuroofSuccessorSetup" TO pro262_capacity_owner;
GRANT USAGE ON SCHEMA int4_crypto TO pro262_capacity_owner;
GRANT EXECUTE ON FUNCTION int4_crypto.digest(BYTEA,TEXT) TO pro262_capacity_owner;
GRANT EXECUTE ON FUNCTION public.int5b_hash_json(JSONB),public.int6_enta_hash(JSONB),public.int6_enta_identity(TEXT,TEXT,TEXT),public.e3_comp_validate_external(JSONB),public.e3_comp_retry(TEXT,TEXT,TEXT,JSONB),public.eng03_06_context(JSONB),public.eng03_06_setup_request(JSONB),public.eng03_06_start_request(JSONB),public.eng03_06_create_key(JSONB,TEXT),public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT),public.eng03_06_assert_setup(TEXT,TEXT,TEXT),public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT),public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT),public.eng03_06_successor_setup(JSONB,JSONB,JSONB),public.eng03_06_successor_retry(JSONB,JSONB) TO pro262_capacity_owner;
-- The dedicated producer receives only the exact source-pinned calls, never table DML,
-- private owner/helper membership, arbitrary SQL, or supplier/issuer authority.
GRANT EXECUTE ON FUNCTION public.e3_comp_retry(TEXT,TEXT,TEXT,JSONB),public.e3_comp_retained_commit(TEXT,TEXT,TEXT,JSONB,TEXT),public.int6_enta_lock_wallet(TEXT,TEXT,TEXT),public.e3_comp_native4_commit(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,TEXT),public.eng03_03_identity_find(TEXT,TEXT),public.eng03_03_locator_find(TEXT,TEXT),public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT),public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT),public.eng03_06_successor_setup(JSONB,JSONB,JSONB),public.eng03_06_successor_retry(JSONB,JSONB),public.eng03_06_successor_start(JSONB,JSONB,JSONB,JSONB,JSONB) TO pro262_producer;

-- This installation audit is fail-closed and changes no global default privileges.
-- It checks complete capability membership, schema CREATE, and new relation/column ACLs.
DO $$
DECLARE roles TEXT[]:=ARRAY['pro262_capacity_owner','pro262_control_allocator','pro262_trust_provisioner','pro262_supplier_publisher','pro262_approval_importer','pro262_qualification_publisher','pro262_supervisor','pro262_replay_executor','pro262_issuer','pro262_producer','pro262_revoker','pro262_cleanup_publisher','pro262_install_observer','pro262_release_authority'];
        role_name TEXT; role_oid OID; relation_oid OID; owner_oid OID; rel RECORD; ace RECORD; member_count INTEGER; login_role RECORD; attr RECORD;
BEGIN
 FOREACH role_name IN ARRAY roles LOOP
  SELECT oid INTO STRICT role_oid FROM pg_catalog.pg_roles WHERE rolname=role_name AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolinherit AND NOT rolbypassrls;
  IF pg_catalog.has_schema_privilege(role_oid,'public','CREATE') OR pg_catalog.has_schema_privilege(role_oid,'int4_crypto','CREATE') THEN RAISE EXCEPTION 'PRO262_CAP_SCHEMA_CREATE'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members x WHERE x.member=role_oid) THEN RAISE EXCEPTION 'PRO262_CAP_UNEXPECTED_ROLE_MEMBERSHIP'; END IF;
 END LOOP;
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname='pro262_capacity_owner';
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members x WHERE x.roleid=owner_oid) THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_ASSUMABLE'; END IF;
 FOR login_role IN SELECT oid FROM pg_catalog.pg_roles WHERE rolcanlogin AND NOT rolsuper LOOP
  SELECT pg_catalog.count(*) INTO member_count FROM pg_catalog.unnest(roles) n WHERE pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=n),'MEMBER');
  IF member_count>1 THEN RAISE EXCEPTION 'PRO262_CAP_CROSS_CAPABILITY_LOGIN'; END IF;
  IF member_count>0 AND (pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='enta_finance_executor'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_activity_reader'),'MEMBER')) THEN RAISE EXCEPTION 'PRO262_CAP_PRIVILEGED_LOGIN'; END IF;
 END LOOP;
 FOR rel IN SELECT c.oid,c.relowner,c.relacl FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (c.relname LIKE 'Pro262Capacity%' OR c.relname LIKE 'Pro262VerifiedSupplierReceipt%') LOOP
  relation_oid:=rel.oid;
  IF rel.relowner<>owner_oid THEN RAISE EXCEPTION 'PRO262_CAP_RELATION_OWNER'; END IF;
  FOR ace IN SELECT * FROM pg_catalog.aclexplode(COALESCE(rel.relacl,pg_catalog.acldefault('r',rel.relowner))) LOOP
   IF ace.grantee<>owner_oid THEN RAISE EXCEPTION 'PRO262_CAP_RELATION_ACL'; END IF;
  END LOOP;
  FOR attr IN SELECT attacl FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL LOOP
   FOR ace IN SELECT * FROM pg_catalog.aclexplode(attr.attacl) LOOP
    IF ace.grantee<>owner_oid THEN RAISE EXCEPTION 'PRO262_CAP_COLUMN_ACL'; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 -- Any default grants for this private owner that could leak objects fail installation.
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE d.defaclrole=owner_oid AND (a.grantee<>owner_oid)) THEN RAISE EXCEPTION 'PRO262_CAP_DEFAULT_ACL'; END IF;
END $$;
DO $$
DECLARE owner_oid OID; fn RECORD; ace RECORD; allowed TEXT[]; grantee_name TEXT; allowed_names TEXT[]:=ARRAY[
 'pro262_capacity_backend_start','pro262_capacity_backend_live','pro262_capacity_applicability_immutable','pro262_capacity_valid_native_subject','pro262_capacity_owner_context','pro262_capacity_pg_subject_lock','pro262_capacity_pg_policy','pro262_capacity_pg_lobby','pro262_capacity_pg_content','pro262_capacity_pg_custody','pro262_capacity_owner_request','pro262_capacity_owner_fence','pro262_capacity_owner_discovery','pro262_capacity_assert_native_subject','pro262_capacity_enta_subject','pro262_capacity_enta_parent','pro262_capacity_enta_catalog','pro262_capacity_enta_exposure','pro262_capacity_immutable','pro262_capacity_admission_guard','pro262_capacity_trust_guard','pro262_capacity_qualification_guard','pro262_capacity_control_guard','pro262_capacity_precharge','pro262_capacity_revoke','pro262_capacity_revoke_trust','pro262_capacity_quarantine','pro262_capacity_validate_proof','pro262_capacity_recheck','pro262_capacity_resolve','pro262_capacity_accept_cleanup','pro262_capacity_release','pro262_capacity_control_baseline_guard','pro262_capacity_control_charge','pro262_capacity_control_prepare','pro262_capacity_setup_intent','pro262_capacity_assert_setup_row','pro262_capacity_setup_close','pro262_capacity_stage_resolve','pro262_capacity_stage_before','pro262_capacity_bind','pro262_capacity_stage_after','pro262_capacity_assert_stage','pro262_capacity_stage_close','pro262_capacity_material_before','pro262_capacity_assert_stage_identity','pro262_capacity_spool_commit','pro262_capacity_replay_probe','pro262_capacity_read_spool','pro262_capacity_begin','pro262_capacity_read_context','pro262_capacity_assert_spool_request','pro262_capacity_accept_supplier','pro262_capacity_import','pro262_capacity_find_qualification','pro262_capacity_trust_provision','pro262_capacity_read_miss','pro262_capacity_read_admission','pro262_capacity_read_outcome','pro262_capacity_read_issued','pro262_capacity_read_cleanup','pro262_capacity_publish_qualification','pro262_capacity_register_control','pro262_capacity_register_replay','pro262_capacity_register_issuance','pro262_capacity_physical_domain_guard','pro262_capacity_publish_replay_profile','pro262_capacity_read_replay_profile','pro262_capacity_revoke_replay_profile','pro262_capacity_quarantine_control','pro262_capacity_accept_replay_cleanup','pro262_capacity_accept_control_cleanup','pro262_capacity_release_control','pro262_capacity_provision_observer_input','pro262_capacity_claim_observer_input','pro262_capacity_assert_observer_claim','pro262_capacity_accept_install_observation','pro262_capacity_assert_process_installation','pro262_capacity_assert_observed_target','pro262_capacity_launch_guard','pro262_capacity_assert_launch_integrity','pro262_capacity_reserve_launch','pro262_capacity_principal_lease_guard','pro262_capacity_control_backends_absent','pro262_capacity_accept_closed_scope','pro262_capacity_read_closed_scope_limit','pro262_capacity_read_observer_input_limit','pro262_capacity_read_cleanup_limit','pro262_capacity_connection_guard','pro262_capacity_prepare_connection','pro262_capacity_bind_connection','pro262_capacity_observe_connection','pro262_capacity_issue','pro262_capacity_archive_gate','pro262_capacity_physical_provision','pro262_capacity_control_provision'];
BEGIN
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname='pro262_capacity_owner';
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pro262_capacity_%' AND NOT (p.proname=ANY(allowed_names))) THEN RAISE EXCEPTION 'PRO262_CAP_UNEXPECTED_FUNCTION'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.unnest(allowed_names) x(name) WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=x.name)<>1) THEN RAISE EXCEPTION 'PRO262_CAP_MISSING_OR_OVERLOADED_FUNCTION'; END IF;
 FOR fn IN SELECT p.oid,p.proname,p.proowner,p.proacl,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY(allowed_names) LOOP
  IF (fn.proname IN ('pro262_capacity_backend_start','pro262_capacity_backend_live','pro262_capacity_pg_subject_lock') AND fn.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner')) OR (fn.proname IN ('pro262_capacity_pg_policy','pro262_capacity_pg_lobby','pro262_capacity_pg_content','pro262_capacity_pg_custody') AND fn.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor')) OR (fn.proname IN ('pro262_capacity_enta_subject','pro262_capacity_enta_parent','pro262_capacity_enta_catalog','pro262_capacity_enta_exposure') AND fn.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='enta_finance_executor')) OR (fn.proname NOT IN ('pro262_capacity_backend_start','pro262_capacity_backend_live','pro262_capacity_enta_subject','pro262_capacity_enta_parent','pro262_capacity_enta_catalog','pro262_capacity_enta_exposure','pro262_capacity_pg_subject_lock','pro262_capacity_pg_policy','pro262_capacity_pg_lobby','pro262_capacity_pg_content','pro262_capacity_pg_custody') AND fn.proowner<>owner_oid) OR NOT fn.prosecdef OR NOT ('search_path=pg_catalog'=ANY(fn.proconfig)) THEN RAISE EXCEPTION 'PRO262_CAP_FUNCTION_OWNER_OR_PATH'; END IF;
  allowed:=CASE fn.proname
   WHEN 'pro262_capacity_backend_start' THEN ARRAY['pro262_capacity_owner']
   WHEN 'pro262_capacity_backend_live' THEN ARRAY['pro262_capacity_owner']
   WHEN 'pro262_capacity_owner_context' THEN ARRAY['huroof_pg_owner','huroof_pg_service_executor']
   WHEN 'pro262_capacity_enta_subject' THEN ARRAY['pro262_capacity_owner']
   WHEN 'pro262_capacity_pg_subject_lock' THEN ARRAY['huroof_pg_service_executor','pro262_capacity_owner']
   WHEN 'pro262_capacity_pg_policy' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_pg_lobby' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_pg_content' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_pg_custody' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_owner_request' THEN ARRAY['enta_finance_executor','huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_owner_fence' THEN ARRAY['enta_finance_executor','huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_owner_discovery' THEN ARRAY['enta_finance_executor','huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_assert_native_subject' THEN ARRAY['enta_finance_executor','huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_enta_parent' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_enta_catalog' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_enta_exposure' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_control_prepare' THEN ARRAY['pro262_control_allocator']
   WHEN 'pro262_capacity_claim_observer_input' THEN ARRAY['pro262_control_allocator']
   WHEN 'pro262_capacity_provision_observer_input' THEN ARRAY['pro262_qualification_publisher']
   WHEN 'pro262_capacity_accept_install_observation' THEN ARRAY['pro262_install_observer']
   WHEN 'pro262_capacity_trust_provision' THEN ARRAY['pro262_trust_provisioner']
   WHEN 'pro262_capacity_accept_supplier' THEN ARRAY['pro262_supplier_publisher']
   WHEN 'pro262_capacity_import' THEN ARRAY['pro262_approval_importer']
   WHEN 'pro262_capacity_find_qualification' THEN ARRAY['pro262_approval_importer']
   WHEN 'pro262_capacity_publish_qualification' THEN ARRAY['pro262_qualification_publisher']
   WHEN 'pro262_capacity_physical_provision' THEN ARRAY['pro262_qualification_publisher']
   WHEN 'pro262_capacity_publish_replay_profile' THEN ARRAY['pro262_qualification_publisher']
   WHEN 'pro262_capacity_control_provision' THEN ARRAY['pro262_qualification_publisher']
   WHEN 'pro262_capacity_register_control' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_register_replay' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_register_issuance' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_spool_commit' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_read_miss' THEN ARRAY['pro262_supervisor','pro262_replay_executor']
   WHEN 'pro262_capacity_read_admission' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_read_outcome' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_read_issued' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_read_cleanup' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_read_replay_profile' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_quarantine_control' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_prepare_connection' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_reserve_launch' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_quarantine' THEN ARRAY['pro262_supervisor']
   WHEN 'pro262_capacity_replay_probe' THEN ARRAY['pro262_replay_executor']
   WHEN 'pro262_capacity_issue' THEN ARRAY['pro262_issuer']
   WHEN 'pro262_capacity_read_spool' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_begin' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_read_context' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_assert_spool_request' THEN ARRAY['pro262_producer']
   WHEN 'pro262_capacity_revoke' THEN ARRAY['pro262_revoker']
   WHEN 'pro262_capacity_revoke_trust' THEN ARRAY['pro262_revoker']
   WHEN 'pro262_capacity_revoke_replay_profile' THEN ARRAY['pro262_revoker']
   WHEN 'pro262_capacity_accept_cleanup' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_accept_replay_cleanup' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_accept_control_cleanup' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_observe_connection' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_accept_closed_scope' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_read_closed_scope_limit' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_read_observer_input_limit' THEN ARRAY['pro262_cleanup_publisher','pro262_install_observer']
   WHEN 'pro262_capacity_read_cleanup_limit' THEN ARRAY['pro262_cleanup_publisher']
   WHEN 'pro262_capacity_release' THEN ARRAY['pro262_release_authority']
   WHEN 'pro262_capacity_release_control' THEN ARRAY['pro262_release_authority']
   WHEN 'pro262_capacity_resolve' THEN ARRAY['enta_finance_executor','huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_assert_stage' THEN ARRAY['enta_finance_executor']
   WHEN 'pro262_capacity_assert_stage_identity' THEN ARRAY['enta_finance_executor']
   WHEN 'pro262_capacity_setup_intent' THEN ARRAY['huroof_pg_service_executor','huroof_pg_owner']
   WHEN 'pro262_capacity_assert_setup_row' THEN ARRAY['huroof_pg_service_executor','huroof_pg_owner']
   ELSE ARRAY[]::TEXT[] END;
  FOREACH grantee_name IN ARRAY allowed LOOP
   IF NOT pg_catalog.has_function_privilege(grantee_name,fn.oid,'EXECUTE') THEN RAISE EXCEPTION 'PRO262_CAP_REQUIRED_EXECUTE_MISSING'; END IF;
  END LOOP;
  FOR ace IN SELECT * FROM pg_catalog.aclexplode(COALESCE(fn.proacl,pg_catalog.acldefault('f',fn.proowner))) LOOP
   IF ace.grantor<>fn.proowner OR (ace.grantee<>fn.proowner AND ace.is_grantable) OR ace.privilege_type<>'EXECUTE' OR (ace.grantee<>fn.proowner AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles rr WHERE rr.oid=ace.grantee AND rr.rolname=ANY(allowed))) THEN RAISE EXCEPTION 'PRO262_CAP_FUNCTION_ACL'; END IF;
  END LOOP;
 END LOOP;
END $$;
-- Reject inherited PUBLIC or transitive EXECUTE / table privileges outside each
-- capability's fixed call map; no unrelated privilege is changed by this audit.
DO $$
DECLARE role_name TEXT; fn RECORD; rel RECORD; allowed TEXT[];
 caps TEXT[]:=ARRAY['pro262_control_allocator','pro262_trust_provisioner','pro262_supplier_publisher','pro262_approval_importer','pro262_qualification_publisher','pro262_supervisor','pro262_replay_executor','pro262_issuer','pro262_producer','pro262_revoker','pro262_cleanup_publisher','pro262_install_observer','pro262_release_authority'];
BEGIN
 FOREACH role_name IN ARRAY caps LOOP
  allowed:=CASE role_name
   WHEN 'pro262_control_allocator' THEN ARRAY['public.pro262_capacity_control_prepare(text,text,jsonb)','public.pro262_capacity_claim_observer_input(text,text,text)']
   WHEN 'pro262_trust_provisioner' THEN ARRAY['public.pro262_capacity_trust_provision(text,bigint,jsonb)']
   WHEN 'pro262_supplier_publisher' THEN ARRAY['public.pro262_capacity_accept_supplier(text,text,bigint,bytea,bytea)']
   WHEN 'pro262_approval_importer' THEN ARRAY['public.pro262_capacity_import(text)','public.pro262_capacity_find_qualification(text)']
   WHEN 'pro262_qualification_publisher' THEN ARRAY['public.pro262_capacity_publish_qualification(text,text,bigint,jsonb)','public.pro262_capacity_physical_provision(jsonb)','public.pro262_capacity_control_provision(jsonb)','public.pro262_capacity_publish_replay_profile(jsonb)','public.pro262_capacity_provision_observer_input(jsonb)']
   WHEN 'pro262_supervisor' THEN ARRAY['public.pro262_capacity_register_control(text,jsonb)','public.pro262_capacity_register_replay(text,text,jsonb)','public.pro262_capacity_register_issuance(text,jsonb)','public.pro262_capacity_spool_commit(text,bytea)','public.pro262_capacity_read_miss(text)','public.pro262_capacity_read_admission(text,bigint)','public.pro262_capacity_read_outcome(text,bigint)','public.pro262_capacity_read_issued(text)','public.pro262_capacity_read_cleanup(text,bigint,text)','public.pro262_capacity_read_replay_profile(text)','public.pro262_capacity_quarantine(text,bigint)','public.pro262_capacity_quarantine_control(text)','public.pro262_capacity_prepare_connection(text,text)','public.pro262_capacity_reserve_launch(text,text)']
   WHEN 'pro262_replay_executor' THEN ARRAY['public.pro262_capacity_replay_probe(text,text)','public.pro262_capacity_read_miss(text)']
   WHEN 'pro262_issuer' THEN ARRAY['public.pro262_capacity_issue(text)']
   WHEN 'pro262_revoker' THEN ARRAY['public.pro262_capacity_revoke(text,bigint)','public.pro262_capacity_revoke_trust(text,bigint)','public.pro262_capacity_revoke_replay_profile(text)']
   WHEN 'pro262_cleanup_publisher' THEN ARRAY['public.pro262_capacity_accept_cleanup(text,bigint,text,text,jsonb,bytea)','public.pro262_capacity_accept_replay_cleanup(text,text,text,jsonb,bytea)','public.pro262_capacity_accept_control_cleanup(text,text,text,jsonb,bytea)','public.pro262_capacity_observe_connection(text,text,text,jsonb,bytea)','public.pro262_capacity_accept_closed_scope(text,text,jsonb,bytea)','public.pro262_capacity_read_closed_scope_limit(text)','public.pro262_capacity_read_observer_input_limit()','public.pro262_capacity_read_cleanup_limit(text,text,bigint)']
   WHEN 'pro262_install_observer' THEN ARRAY['public.pro262_capacity_accept_install_observation(text,text,text,jsonb,bytea)','public.pro262_capacity_read_observer_input_limit()']
   WHEN 'pro262_release_authority' THEN ARRAY['public.pro262_capacity_release(text,bigint,text)','public.pro262_capacity_release_control(text,text,text)']
   WHEN 'pro262_producer' THEN ARRAY['public.pro262_capacity_pg_policy(text,bigint,text)','public.pro262_capacity_pg_lobby(text,bigint,text,text,text,bigint)','public.pro262_capacity_pg_content(text,bigint,text,text,text,bigint,text,text)','public.pro262_capacity_pg_custody(text,bigint,text)','public.pro262_capacity_enta_parent(text,bigint,text,text,text,jsonb)','public.pro262_capacity_enta_catalog(text,bigint,text,text,text,text)','public.pro262_capacity_enta_exposure(text,bigint,text,text,text,text,text,text,text)','public.pro262_capacity_read_spool(text,bigint,text)','public.pro262_capacity_begin(text,bigint)','public.pro262_capacity_read_context(text,bigint)','public.pro262_capacity_assert_spool_request(text,bigint,jsonb)','public.e3_comp_retry(text,text,text,jsonb)','public.e3_comp_retained_commit(text,text,text,jsonb,text)','public.int6_enta_lock_wallet(text,text,text)','public.e3_comp_native4_commit(text,text,text,jsonb,jsonb,jsonb,jsonb,text)','public.eng03_03_identity_find(text,text)','public.eng03_03_locator_find(text,text)','public.eng03_03_create_identity(text,text,text,text)','public.eng03_03_paid_identity(text,text,text,text,text)','public.eng03_06_successor_setup(jsonb,jsonb,jsonb)','public.eng03_06_successor_retry(jsonb,jsonb)','public.eng03_06_successor_start(jsonb,jsonb,jsonb,jsonb,jsonb)']
   ELSE ARRAY[]::TEXT[] END;
  FOR fn IN SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','int4_crypto') LOOP
   IF pg_catalog.has_function_privilege(role_name,fn.oid,'EXECUTE') AND NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(allowed) s WHERE pg_catalog.to_regprocedure(s)=fn.oid) THEN RAISE EXCEPTION 'PRO262_CAP_UNEXPECTED_EFFECTIVE_EXECUTE'; END IF;
  END LOOP;
  FOR rel IN SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
   IF pg_catalog.has_table_privilege(role_name,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_any_column_privilege(role_name,rel.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'PRO262_CAP_UNEXPECTED_EFFECTIVE_RELATION'; END IF;
  END LOOP;
 END LOOP;
END $$;
DO $$
DECLARE owner_oid OID; fn RECORD; rel RECORD; col RECORD; allowed_select JSONB; allowed_ref JSONB;
        allowed_helpers TEXT[]:=ARRAY['int4_crypto.digest(bytea,text)','public.int5b_hash_json(jsonb)','public.int6_enta_hash(jsonb)','public.int6_enta_identity(text,text,text)','public.e3_comp_validate_external(jsonb)','public.e3_comp_retry(text,text,text,jsonb)','public.eng03_06_context(jsonb)','public.eng03_06_setup_request(jsonb)','public.eng03_06_start_request(jsonb)','public.eng03_06_create_key(jsonb,text)','public.eng03_06_assert_parent(text,text,text,bigint,text)','public.eng03_06_assert_setup(text,text,text)','public.eng03_03_assert_current(text,text,text,text)','public.eng03_03_create_identity(text,text,text,text)','public.eng03_06_successor_setup(jsonb,jsonb,jsonb)','public.eng03_06_successor_retry(jsonb,jsonb)'];
BEGIN
 SELECT oid INTO STRICT owner_oid FROM pg_catalog.pg_roles WHERE rolname='pro262_capacity_owner';
 allowed_select:=pg_catalog.jsonb_build_object(
  'Pro311ControlDomain',pg_catalog.to_jsonb(ARRAY['id','physicalIdentity','proofIdentity','capacity','committed','baseline']),
  'Pro311NativeAdmission',pg_catalog.to_jsonb(ARRAY['state','reservedBackendBytes','reservedSharedBytes','reservedStorageBytes']),
  'Pro311PreflightAdmission',pg_catalog.to_jsonb(ARRAY['state','reservedBackendBytes','reservedSharedBytes','reservedStorageBytes']),
  'E3StartReservation',pg_catalog.to_jsonb(ARRAY['id','ownerId','walletId','namespaceId','projectId','uid','envelopeVersion','e3Protocol','requestKey','logicalId','clientHash','protocol','format','rules','mode','parentGameId','terminalHash','externalRequest','nativeRequest','nativeRequestHash']),
  'HuroofSuccessorStartReservation',pg_catalog.to_jsonb(ARRAY['stageId','namespace','ownerId','setupKey','freshRoomId','requestKey','logicalMatchId','nativeLogicalMatchId','externalRequest','externalHash','nativeIntent','nativeInitial','nativeProjections','nativeRequestHash','expectedAdmissionId','expectedMatchId','createdAt']),
  'HuroofSuccessorSetup',pg_catalog.to_jsonb(ARRAY['namespace','ownerId','setupKey','parentMatchId','parentRoomId','originalVersion','originalHash','latestVersion','latestHash','freshRoomId','freshRoomGeneration','createKey','createRevision','externalRequest','externalHash','createIntent','createOutcome','createStateHash','createdAt'])
 );
 allowed_ref:=pg_catalog.jsonb_build_object('E3StartReservation',pg_catalog.to_jsonb(ARRAY['id']),'HuroofSuccessorStartReservation',pg_catalog.to_jsonb(ARRAY['stageId']),'HuroofSuccessorSetup',pg_catalog.to_jsonb(ARRAY['namespace','ownerId','setupKey','freshRoomId']));
 FOR fn IN SELECT p.oid,p.proname,n.nspname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','int4_crypto') LOOP
  IF pg_catalog.has_function_privilege(owner_oid,fn.oid,'EXECUTE') AND NOT (fn.nspname='public' AND fn.proname LIKE 'pro262_capacity_%') AND NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(allowed_helpers) s WHERE pg_catalog.to_regprocedure(s)=fn.oid) THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_UNEXPECTED_EXECUTE'; END IF;
 END LOOP;
 FOR rel IN SELECT c.oid,c.relname,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND c.relowner<>owner_oid LOOP
  IF pg_catalog.has_table_privilege(owner_oid,rel.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_TABLE_GRANT'; END IF;
  FOR col IN SELECT attname,attnum FROM pg_catalog.pg_attribute WHERE attrelid=rel.oid AND attnum>0 AND NOT attisdropped LOOP
   IF pg_catalog.has_column_privilege(owner_oid,rel.oid,col.attnum,'SELECT') AND NOT COALESCE((allowed_select->rel.relname) ? col.attname,FALSE) THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_COLUMN_SELECT'; END IF;
   IF pg_catalog.has_column_privilege(owner_oid,rel.oid,col.attnum,'REFERENCES') AND NOT COALESCE((allowed_ref->rel.relname) ? col.attname,FALSE) THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_COLUMN_REFERENCE'; END IF;
   IF pg_catalog.has_column_privilege(owner_oid,rel.oid,col.attnum,'UPDATE') AND NOT (rel.relname='Pro311ControlDomain' AND col.attname='committed') THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_COLUMN_UPDATE'; END IF;
   IF pg_catalog.has_column_privilege(owner_oid,rel.oid,col.attnum,'INSERT') THEN RAISE EXCEPTION 'PRO262_CAP_OWNER_COLUMN_INSERT'; END IF;
  END LOOP;
 END LOOP;
END $$;
