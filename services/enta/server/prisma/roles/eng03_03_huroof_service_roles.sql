-- ENG03-03 role source candidate; application requires independent review and separate authorization.
BEGIN;
DO $role$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor') THEN
  CREATE ROLE huroof_pg_service_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit)) THEN RAISE EXCEPTION 'unsafe service executor attributes'; END IF;
 IF EXISTS(WITH RECURSIVE inherited(oid) AS (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor' UNION SELECT m.roleid FROM pg_catalog.pg_auth_members m JOIN inherited i ON m.member=i.oid) SELECT 1 FROM inherited i JOIN pg_catalog.pg_roles r ON r.oid=i.oid WHERE r.rolname IN ('huroof_pg_owner','enta_finance_executor')) THEN RAISE EXCEPTION 'service executor inherits forbidden owner or finance role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor'),'member') OR has_schema_privilege(r.oid,(SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='public'),'CREATE') OR has_schema_privilege(r.oid,(SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='int4_crypto'),'CREATE'))) THEN RAISE EXCEPTION 'runtime/content roles may not assume executor or replace boundary functions'; END IF;
END $role$;
DO $verify_source_inventory$
DECLARE item RECORD;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members member_edge JOIN pg_catalog.pg_roles root_role ON root_role.oid=member_edge.member WHERE root_role.rolname IN ('huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'checked role membership is forbidden'; END IF;
 FOR item IN SELECT * FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles own ON own.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(item.result_type)::oid AND p.prosecdef=item.definer AND own.rolname IN (current_user,item.expected_owner)) THEN RAISE EXCEPTION 'source routine identity or owner mismatch: %',item.signature; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'eng03\_03\_%' ESCAPE '\' AND p.oid NOT IN (SELECT pg_catalog.to_regprocedure(inventory.signature)::oid FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer))) THEN RAISE EXCEPTION 'unexpected new routine overload'; END IF;
 FOR item IN SELECT * FROM (VALUES ('public.eng03_02_has_secret_key(JSONB)','huroof_pg_owner','boolean',false),
 ('public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_executor','jsonb',true),
 ('public.int5b_hash_json(JSONB)','enta_finance_executor','text',false),
 ('public.int5b_canonical_json(JSONB)','enta_finance_executor','text',false),
 ('public.int5b_valid_config(JSONB)','enta_finance_executor','boolean',false),
 ('public.int5b_json_id(JSONB)','enta_finance_executor','boolean',false),
 ('public.int5b_json_hash(JSONB)','enta_finance_executor','boolean',false),
 ('public.int5b_json_integer(JSONB,NUMERIC,NUMERIC)','enta_finance_executor','boolean',false)) AS lower_dep(signature,expected_owner,result_type,definer) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles own ON own.oid=p.proowner WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(item.result_type)::oid AND p.prosecdef=item.definer AND own.rolname=item.expected_owner) THEN RAISE EXCEPTION 'lower routine identity or owner mismatch: %',item.signature; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=(SELECT proname FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature)::oid) AND p.oid<>pg_catalog.to_regprocedure(item.signature)::oid) THEN RAISE EXCEPTION 'unexpected lower routine overload: %',item.signature; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e' JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid WHERE p.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid AND n.nspname='int4_crypto' AND e.extname='pgcrypto' AND p.proowner=e.extowner AND p.prorettype='bytea'::regtype AND NOT p.prosecdef) THEN RAISE EXCEPTION 'pgcrypto digest provider or owner mismatch'; END IF;
END $verify_source_inventory$;
-- Restrict named default privileges on newly created objects before exact grants.
REVOKE ALL ON public."HuroofLobbyRevision" FROM PUBLIC,huroof_pg_runtime,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_service_executor;
DO $clean_new_functions$
DECLARE fn regprocedure; role_name TEXT;
BEGIN
 FOR fn IN SELECT pg_catalog.to_regprocedure(inventory.signature) FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer) LOOP
  FOREACH role_name IN ARRAY ARRAY['PUBLIC','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor'] LOOP
   IF role_name='PUBLIC' THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn); ELSE EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name); END IF;
  END LOOP;
 END LOOP;
END $clean_new_functions$;
GRANT USAGE ON SCHEMA public TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_policy_read(TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_identity_find(TEXT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_locator_find(TEXT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) OWNER TO huroof_pg_service_executor;
GRANT USAGE ON SCHEMA public TO huroof_pg_service_executor;
GRANT SELECT ON public."HuroofIdentityPolicyHead",public."HuroofIdentityPolicyRevision",public."DeploymentNamespace",public."FirebaseIdentity",public."HuroofRoom",public."HuroofLocator",public."HuroofMember",public."HuroofParticipant" TO huroof_pg_service_executor;
GRANT INSERT ON public."HuroofRoom",public."HuroofLocator",public."HuroofMember",public."HuroofParticipant" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_policy_read(TEXT),public.eng03_03_identity_find(TEXT,TEXT),public.eng03_03_locator_find(TEXT,TEXT),public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO huroof_pg_service_executor;
GRANT SELECT ON public."HuroofRawArtifact",public."HuroofContentPointer",public."HuroofContentRevision",public."HuroofMatch",public."HuroofMatchPin",public."HuroofCanonicalState",public."HuroofCommandReceipt",public."HuroofProjection",public."ActiveCatalogPointer",public."CatalogValidationReceipt",public."CatalogReleaseSeal" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_lock_room(TEXT,TEXT) OWNER TO huroof_pg_owner;
GRANT EXECUTE ON FUNCTION public.eng03_03_lock_room(TEXT,TEXT) TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_match_update_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_match_transition_closure() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_projection_safe(JSONB,BOOLEAN) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB) OWNER TO huroof_pg_service_executor;
GRANT USAGE ON SCHEMA int4_crypto TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION int4_crypto.digest(BYTEA,TEXT),public.eng03_02_has_secret_key(JSONB) TO huroof_pg_service_executor;
GRANT INSERT ON public."HuroofCommandReceipt",public."HuroofEvent",public."HuroofProjection",public."HuroofRealtimeOutbox",public."HuroofOutboxDelivery" TO huroof_pg_service_executor;
GRANT UPDATE ("status","revision","sequence","privateState","updatedAt") ON public."HuroofCanonicalState" TO huroof_pg_service_executor;
GRANT UPDATE ("state","version") ON public."HuroofMatch" TO huroof_pg_service_executor;
GRANT UPDATE ("revision","throughSequence","authGeneration","payload","updatedAt") ON public."HuroofProjection" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_custody_policy(TEXT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_custody_policy(TEXT) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_lock_custody(TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_lock_custody(TEXT) TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_lock_history(TEXT,TEXT) OWNER TO huroof_pg_owner;
GRANT EXECUTE ON FUNCTION public.eng03_03_lock_history(TEXT,TEXT) TO huroof_pg_service_executor;
GRANT SELECT ON public."HuroofMatchResult",public."HuroofRematchLink",public."HuroofOwnerHistoryHead",public."HuroofOwnerHistoryEntry" TO huroof_pg_service_executor;
GRANT INSERT ON public."HuroofRawArtifact",public."HuroofMatchResult",public."HuroofOwnerHistoryHead",public."HuroofOwnerHistoryEntry" TO huroof_pg_service_executor;
ALTER TABLE public."HuroofLobbyRevision" OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_lobby_insert_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT) TO huroof_pg_runtime;
GRANT SELECT,INSERT ON public."HuroofLobbyRevision" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.int5b_hash_json(JSONB),public.int5b_canonical_json(JSONB),public.int5b_valid_config(JSONB),public.int5b_json_id(JSONB),public.int5b_json_hash(JSONB),public.int5b_json_integer(JSONB,NUMERIC,NUMERIC) TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB) OWNER TO enta_finance_executor;
GRANT SELECT ON public."HuroofLobbyRevision",public."HuroofMember",public."HuroofParticipant" TO enta_finance_executor;
GRANT UPDATE ("state","version") ON public."HuroofMatch" TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.int5b_hash_json(JSONB),public.int5b_canonical_json(JSONB),public.int5b_valid_config(JSONB),public.int5b_json_id(JSONB),public.int5b_json_hash(JSONB),public.int5b_json_integer(JSONB,NUMERIC,NUMERIC),public.eng03_03_projection_safe(JSONB,BOOLEAN),public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_service_executor;
GRANT SELECT ON public."Admission" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO huroof_pg_runtime;
GRANT EXECUTE ON FUNCTION public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT) TO huroof_pg_runtime;
GRANT EXECUTE ON FUNCTION public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT) TO enta_finance_executor;
ALTER FUNCTION public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB),public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_service_executor;
ALTER FUNCTION public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO huroof_pg_service_executor;
GRANT UPDATE ("team") ON public."HuroofParticipant" TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT),public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB) TO huroof_pg_runtime;
ALTER FUNCTION public.eng03_03_lock_profile(TEXT,TEXT) OWNER TO huroof_pg_owner;
GRANT EXECUTE ON FUNCTION public.eng03_03_lock_profile(TEXT,TEXT),public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT) TO enta_finance_executor;
ALTER FUNCTION public.eng03_03_lock_members(TEXT,TEXT) OWNER TO huroof_pg_owner;
GRANT EXECUTE ON FUNCTION public.eng03_03_lock_members(TEXT,TEXT) TO huroof_pg_service_executor,enta_finance_executor;
ALTER FUNCTION public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT) TO huroof_pg_runtime;
-- Fail closed on pre-existing direct, inherited, PUBLIC, ownership or default ACL drift.
DO $verify_exact_graph$
DECLARE obj_record record; privilege TEXT; checked_role TEXT; column_privilege TEXT; allowed BOOLEAN; grantable BOOLEAN;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles role_info ON role_info.oid=m.member WHERE role_info.rolname IN ('huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'checked role membership is forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles role_info WHERE role_info.rolname IN ('huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (pg_has_role(role_info.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor'),'member') OR pg_has_role(role_info.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'),'member') OR pg_has_role(role_info.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='enta_finance_executor'),'member'))) THEN RAISE EXCEPTION 'runtime or content role can assume protected role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles role_info ON role_info.oid=n.nspowner WHERE n.nspname IN ('public','int4_crypto') AND role_info.rolname IN ('huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'protected schema ownership forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles role_info WHERE role_info.rolname='huroof_pg_service_executor' AND (has_schema_privilege(role_info.oid,'public','CREATE') OR has_schema_privilege(role_info.oid,'int4_crypto','CREATE'))) THEN RAISE EXCEPTION 'executor schema CREATE forbidden'; END IF;
 FOR obj_record IN SELECT c.oid,c.relname,c.relowner FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND (c.relname LIKE 'Huroof%' OR c.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionEvent','AdmissionOutbox','GameCategoryPin','FirebaseAdminScope','DeploymentNamespace','FirebaseIdentity','ActiveCatalogPointer','CatalogValidationReceipt','CatalogReleaseSeal')) LOOP
  IF pg_catalog.pg_get_userbyid(obj_record.relowner) IN ('huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') THEN RAISE EXCEPTION 'protected relation ownership forbidden: %',obj_record.relname; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
   FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    SELECT checked_role='huroof_pg_service_executor' AND EXISTS(SELECT 1 FROM (VALUES ('ActiveCatalogPointer','SELECT'),
   ('Admission','SELECT'),
   ('CatalogReleaseSeal','SELECT'),
   ('CatalogValidationReceipt','SELECT'),
   ('DeploymentNamespace','SELECT'),
   ('FirebaseIdentity','SELECT'),
   ('HuroofCanonicalState','SELECT'),
   ('HuroofCommandReceipt','INSERT'),
   ('HuroofCommandReceipt','SELECT'),
   ('HuroofContentPointer','SELECT'),
   ('HuroofContentRevision','SELECT'),
   ('HuroofEvent','INSERT'),
   ('HuroofIdentityPolicyHead','SELECT'),
   ('HuroofIdentityPolicyRevision','SELECT'),
   ('HuroofLobbyRevision','INSERT'),
   ('HuroofLobbyRevision','SELECT'),
   ('HuroofLocator','INSERT'),
   ('HuroofLocator','SELECT'),
   ('HuroofMatch','SELECT'),
   ('HuroofMatchPin','SELECT'),
   ('HuroofMatchResult','INSERT'),
   ('HuroofMatchResult','SELECT'),
   ('HuroofMember','INSERT'),
   ('HuroofMember','SELECT'),
   ('HuroofOutboxDelivery','INSERT'),
   ('HuroofOwnerHistoryEntry','INSERT'),
   ('HuroofOwnerHistoryEntry','SELECT'),
   ('HuroofOwnerHistoryHead','INSERT'),
   ('HuroofOwnerHistoryHead','SELECT'),
   ('HuroofParticipant','INSERT'),
   ('HuroofParticipant','SELECT'),
   ('HuroofProjection','INSERT'),
   ('HuroofProjection','SELECT'),
   ('HuroofRawArtifact','INSERT'),
   ('HuroofRawArtifact','SELECT'),
   ('HuroofRealtimeOutbox','INSERT'),
   ('HuroofRematchLink','SELECT'),
   ('HuroofRoom','INSERT'),
   ('HuroofRoom','SELECT')) AS a(name,priv) WHERE a.name=obj_record.relname AND a.priv=privilege) INTO allowed;
    IF has_table_privilege(checked_role,obj_record.oid,privilege) AND NOT allowed THEN RAISE EXCEPTION 'unexpected protected relation privilege: % % %',checked_role,obj_record.relname,privilege; END IF;
    IF has_table_privilege(checked_role,obj_record.oid,privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'protected relation grant option forbidden'; END IF;
   END LOOP;
   FOR privilege IN SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=obj_record.oid AND a.attnum>0 AND NOT a.attisdropped LOOP
    FOREACH grantable IN ARRAY ARRAY[false,true] LOOP
     IF has_column_privilege(checked_role,obj_record.oid,privilege,CASE WHEN grantable THEN 'UPDATE WITH GRANT OPTION' ELSE 'UPDATE' END) AND (grantable OR checked_role<>'huroof_pg_service_executor' OR NOT EXISTS(SELECT 1 FROM (VALUES ('HuroofCanonicalState','privateState'),
   ('HuroofCanonicalState','revision'),
   ('HuroofCanonicalState','sequence'),
   ('HuroofCanonicalState','status'),
   ('HuroofCanonicalState','updatedAt'),
   ('HuroofMatch','state'),
   ('HuroofMatch','version'),
   ('HuroofParticipant','team'),
   ('HuroofProjection','authGeneration'),
   ('HuroofProjection','payload'),
   ('HuroofProjection','revision'),
   ('HuroofProjection','throughSequence'),
   ('HuroofProjection','updatedAt')) AS a(name,col) WHERE a.name=obj_record.relname AND a.col=privilege)) THEN RAISE EXCEPTION 'unexpected protected column update: % % %',checked_role,obj_record.relname,privilege; END IF;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 FOR obj_record IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND (c.relname LIKE 'Huroof%' OR c.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionEvent','AdmissionOutbox','GameCategoryPin','FirebaseAdminScope','DeploymentNamespace','FirebaseIdentity','ActiveCatalogPointer','CatalogValidationReceipt','CatalogReleaseSeal')) LOOP
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
   FOR privilege IN SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=obj_record.oid AND a.attnum>0 AND NOT a.attisdropped LOOP
    FOREACH column_privilege IN ARRAY ARRAY['SELECT','INSERT','REFERENCES'] LOOP
     SELECT checked_role='huroof_pg_service_executor' AND EXISTS(SELECT 1 FROM (VALUES ('ActiveCatalogPointer','SELECT'), ('Admission','SELECT'), ('CatalogReleaseSeal','SELECT'), ('CatalogValidationReceipt','SELECT'), ('DeploymentNamespace','SELECT'), ('FirebaseIdentity','SELECT'), ('HuroofCanonicalState','SELECT'), ('HuroofCommandReceipt','INSERT'), ('HuroofCommandReceipt','SELECT'), ('HuroofContentPointer','SELECT'), ('HuroofContentRevision','SELECT'), ('HuroofEvent','INSERT'), ('HuroofIdentityPolicyHead','SELECT'), ('HuroofIdentityPolicyRevision','SELECT'), ('HuroofLobbyRevision','INSERT'), ('HuroofLobbyRevision','SELECT'), ('HuroofLocator','INSERT'), ('HuroofLocator','SELECT'), ('HuroofMatch','SELECT'), ('HuroofMatchPin','SELECT'), ('HuroofMatchResult','INSERT'), ('HuroofMatchResult','SELECT'), ('HuroofMember','INSERT'), ('HuroofMember','SELECT'), ('HuroofOutboxDelivery','INSERT'), ('HuroofOwnerHistoryEntry','INSERT'), ('HuroofOwnerHistoryEntry','SELECT'), ('HuroofOwnerHistoryHead','INSERT'), ('HuroofOwnerHistoryHead','SELECT'), ('HuroofParticipant','INSERT'), ('HuroofParticipant','SELECT'), ('HuroofProjection','INSERT'), ('HuroofProjection','SELECT'), ('HuroofRawArtifact','INSERT'), ('HuroofRawArtifact','SELECT'), ('HuroofRealtimeOutbox','INSERT'), ('HuroofRematchLink','SELECT'), ('HuroofRoom','INSERT'), ('HuroofRoom','SELECT')) AS a(name,priv) WHERE a.name=obj_record.relname AND a.priv=column_privilege) INTO allowed;
     IF has_column_privilege(checked_role,obj_record.oid,privilege,column_privilege) AND NOT allowed THEN RAISE EXCEPTION 'unexpected protected column privilege: % % % %',checked_role,obj_record.relname,privilege,column_privilege; END IF;
     IF has_column_privilege(checked_role,obj_record.oid,privilege,column_privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'protected column grant option forbidden'; END IF;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=acl.grantee WHERE n.nspname='public' AND c.relname='HuroofLobbyRevision' AND acl.grantee<>c.relowner AND (acl.is_grantable OR gr.rolname IS NULL OR NOT ((gr.rolname='huroof_pg_service_executor' AND acl.privilege_type IN ('SELECT','INSERT')) OR (gr.rolname='enta_finance_executor' AND acl.privilege_type='SELECT')))) THEN RAISE EXCEPTION 'unexpected lobby revision ACL'; END IF;
 FOR obj_record IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'eng03\_02\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\') LOOP
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor'] LOOP
   SELECT checked_role='huroof_pg_service_executor' AND obj_record.oid IN (pg_catalog.to_regprocedure('public.eng03_02_has_secret_key(JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.int5b_hash_json(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_canonical_json(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_valid_config(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_id(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_hash(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_integer(JSONB,NUMERIC,NUMERIC)')::oid) INTO allowed;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE') AND NOT allowed THEN RAISE EXCEPTION 'unexpected protected helper execute: % %',checked_role,obj_record.proname; END IF;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'protected helper grant option forbidden'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles role_info ON role_info.oid=p.proowner WHERE n.nspname='public' AND ((role_info.rolname='huroof_pg_service_executor' AND p.oid NOT IN (pg_catalog.to_regprocedure('public.eng03_03_policy_read(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_identity_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_locator_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_safe(JSONB,BOOLEAN)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_policy(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)')::oid)) OR (role_info.rolname IN ('huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (p.proname LIKE 'eng03\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\')))) THEN RAISE EXCEPTION 'unexpected function ownership'; END IF;
 FOR obj_record IN SELECT p.oid,p.proname,p.proowner,p.proacl FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid IN (pg_catalog.to_regprocedure('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_policy_read(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_identity_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_locator_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_room(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_match_update_guard()')::oid,pg_catalog.to_regprocedure('public.eng03_03_match_transition_closure()')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_safe(JSONB,BOOLEAN)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_policy(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_custody(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_history(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_insert_guard()')::oid,pg_catalog.to_regprocedure('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_profile(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_members(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)')::oid) LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) acl LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=acl.grantee WHERE acl.grantee<>obj_record.proowner AND (acl.is_grantable OR gr.rolname IS NULL OR NOT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','enta_finance_executor'),
   ('public.eng03_03_custody_policy(TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_lock_custody(TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_members(TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_profile(TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_policy_read(TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','enta_finance_executor'),
   ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime')) AS a(signature,role_name) WHERE pg_catalog.to_regprocedure(a.signature)::oid=obj_record.oid AND a.role_name=gr.rolname))) THEN RAISE EXCEPTION 'unexpected function ACL: %',obj_record.proname; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor'] LOOP
   SELECT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','enta_finance_executor'),
   ('public.eng03_03_custody_policy(TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_lock_custody(TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_members(TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_lock_profile(TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_policy_read(TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_runtime'),
   ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','enta_finance_executor'),
   ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime')) AS a(signature,role_name) WHERE pg_catalog.to_regprocedure(a.signature)::oid=obj_record.oid AND a.role_name=checked_role) OR pg_catalog.pg_get_userbyid(obj_record.proowner)=checked_role INTO allowed;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE') AND NOT allowed THEN RAISE EXCEPTION 'unexpected inherited function execute: % %',checked_role,obj_record.proname; END IF;
   IF pg_catalog.pg_get_userbyid(obj_record.proowner)<>checked_role AND has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'function grant option forbidden'; END IF;
  END LOOP;
 END LOOP;
 -- Preserve only qualified pgcrypto PUBLIC defaults and exact accepted private digest edges.
 FOR obj_record IN SELECT proc_info.oid,proc_info.proowner,proc_info.proacl,proc_info.prosecdef,proc_info.prokind,extension_info.extowner FROM pg_catalog.pg_proc proc_info JOIN pg_catalog.pg_namespace namespace_info ON namespace_info.oid=proc_info.pronamespace LEFT JOIN pg_catalog.pg_depend dependency_info ON dependency_info.classid='pg_catalog.pg_proc'::regclass AND dependency_info.objid=proc_info.oid AND dependency_info.refclassid='pg_catalog.pg_extension'::regclass AND dependency_info.deptype='e' LEFT JOIN pg_catalog.pg_extension extension_info ON extension_info.oid=dependency_info.refobjid AND extension_info.extname='pgcrypto' AND extension_info.extnamespace=namespace_info.oid WHERE namespace_info.nspname='int4_crypto' LOOP
  IF obj_record.extowner IS NULL OR obj_record.proowner<>obj_record.extowner OR obj_record.prosecdef OR obj_record.prokind<>'f' THEN RAISE EXCEPTION 'unqualified crypto provider routine'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) acl_info LEFT JOIN pg_catalog.pg_roles grantee_info ON grantee_info.oid=acl_info.grantee WHERE acl_info.grantee<>obj_record.proowner AND (acl_info.is_grantable OR NOT (acl_info.grantee=0 OR (obj_record.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid AND grantee_info.rolname IN ('huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor'))))) THEN RAISE EXCEPTION 'unexpected private crypto ACL or grant option'; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
   IF has_schema_privilege(checked_role,'int4_crypto','USAGE') AND has_function_privilege(checked_role,obj_record.oid,'EXECUTE') THEN
    IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'crypto grant option forbidden'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) public_acl WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE' AND NOT public_acl.is_grantable) AND NOT (checked_role='huroof_pg_service_executor' AND obj_record.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid) THEN RAISE EXCEPTION 'crypto execute not from qualified PUBLIC baseline or exact digest edge'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc digest_info CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(digest_info.proacl,pg_catalog.acldefault('f',digest_info.proowner))) acl_info JOIN pg_catalog.pg_roles grantee_info ON grantee_info.oid=acl_info.grantee WHERE digest_info.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid AND grantee_info.rolname=checked_role AND acl_info.privilege_type='EXECUTE' AND NOT acl_info.is_grantable) THEN RAISE EXCEPTION 'required digest caller edge missing: %',checked_role; END IF;
 END LOOP;
END $verify_exact_graph$;
DO $verify_routine_owners$
DECLARE item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc proc_info JOIN pg_catalog.pg_roles owner_info ON owner_info.oid=proc_info.proowner WHERE proc_info.oid=pg_catalog.to_regprocedure(item.signature)::oid AND owner_info.rolname=item.expected_owner AND proc_info.prorettype=pg_catalog.to_regtype(item.result_type)::oid AND proc_info.prosecdef=item.definer) THEN RAISE EXCEPTION 'final routine ownership mismatch: %',item.signature; END IF;
 END LOOP;
END $verify_routine_owners$;
-- End of source candidate.
COMMIT;
