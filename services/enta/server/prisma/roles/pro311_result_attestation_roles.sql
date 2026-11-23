-- Run with the migration in one externally managed installation transaction.
-- Conditional Source role closure; install atomically with migration under separate authority.
DO $$
DECLARE role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['pro311_archive_worker','pro311_resource_qualifier','pro311_resource_canceller','pro311_activity_reader'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',role_name); END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe archive role'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members e JOIN pg_catalog.pg_roles r ON r.oid=e.member WHERE r.rolname IN ('pro311_archive_worker','pro311_resource_qualifier','pro311_resource_canceller')) THEN RAISE EXCEPTION 'archive capability role membership is forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members e JOIN pg_catalog.pg_roles member_role ON member_role.oid=e.member JOIN pg_catalog.pg_roles target_role ON target_role.oid=e.roleid WHERE member_role.rolname='pro311_activity_reader' AND target_role.rolname<>'pg_read_all_stats') THEN RAISE EXCEPTION 'unexpected activity reader membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles login_role WHERE login_role.rolcanlogin AND NOT login_role.rolsuper AND pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_activity_reader'),'MEMBER')) THEN RAISE EXCEPTION 'activity reader cannot be assumed by a login'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles login_role WHERE login_role.rolcanlogin AND NOT login_role.rolsuper AND pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_archive_worker'),'MEMBER') AND (pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_qualifier'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_activity_reader'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'),'MEMBER') OR pg_catalog.pg_has_role(login_role.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor'),'MEMBER'))) THEN RAISE EXCEPTION 'worker login crosses privileged role boundary'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolcanlogin AND NOT r.rolsuper AND ((pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_canceller'),'MEMBER') AND (pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_qualifier'),'MEMBER') OR pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_archive_worker'),'MEMBER'))) OR (pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_qualifier'),'MEMBER') AND pg_catalog.pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_archive_worker'),'MEMBER')))) THEN RAISE EXCEPTION 'issuer, cancellation and worker logins must be disjoint'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members e JOIN pg_catalog.pg_roles r ON r.oid=e.roleid WHERE r.rolname IN ('huroof_pg_owner','pro311_activity_reader') AND e.member<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=r.rolname)) THEN RAISE EXCEPTION 'owner or activity reader must not be assumable'; END IF;
 IF pg_catalog.pg_has_role('pro311_archive_worker','pro311_resource_qualifier','MEMBER') OR pg_catalog.pg_has_role('pro311_archive_worker','huroof_pg_owner','MEMBER') OR pg_catalog.pg_has_role('pro311_archive_worker','huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'archive worker has privileged membership'; END IF;
END $$;
-- Scoped definer helpers expose only current-backend start or a live/incarnation boolean.
GRANT pg_read_all_stats TO pro311_activity_reader WITH INHERIT TRUE, SET FALSE;
ALTER FUNCTION public.pro311_own_backend_start() OWNER TO pro311_activity_reader;
ALTER FUNCTION public.pro311_backend_is_live(NAME,INTEGER,TIMESTAMPTZ) OWNER TO pro311_activity_reader;
REVOKE ALL ON FUNCTION public.pro311_own_backend_start(),public.pro311_backend_is_live(NAME,INTEGER,TIMESTAMPTZ) FROM PUBLIC,pro311_archive_worker,pro311_resource_qualifier,pro311_resource_canceller,huroof_pg_runtime,huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.pro311_own_backend_start(),public.pro311_backend_is_live(NAME,INTEGER,TIMESTAMPTZ) TO huroof_pg_owner;
ALTER TABLE public."Pro311ControlDomain" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311NativePool" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311NativeProfile" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311NativeRequirement" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311NativeJob" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311PreflightAdmission" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311NativeAdmission" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311ResultAttestation" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311InventoryBoundary" OWNER TO huroof_pg_owner;
ALTER TABLE public."Pro311InventoryMember" OWNER TO huroof_pg_owner;
REVOKE ALL ON public."Pro311ControlDomain",public."Pro311NativePool",public."Pro311NativeProfile",public."Pro311NativeRequirement",public."Pro311NativeJob",public."Pro311PreflightAdmission",public."Pro311NativeAdmission",public."Pro311ResultAttestation",public."Pro311InventoryBoundary",public."Pro311InventoryMember" FROM PUBLIC,pro311_archive_worker,pro311_resource_qualifier,pro311_resource_canceller,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer,enta_runtime,enta_gameplay_runtime;
GRANT SELECT ON public."Pro311ControlDomain" TO pro311_resource_qualifier;
GRANT SELECT,INSERT ON public."Pro311NativePool",public."Pro311NativeRequirement" TO pro311_resource_qualifier;
GRANT SELECT,INSERT ON public."Pro311NativeProfile",public."Pro311PreflightAdmission",public."Pro311NativeAdmission" TO pro311_resource_qualifier;
GRANT SELECT ON public."Pro311NativeProfile",public."Pro311PreflightAdmission",public."Pro311NativeAdmission" TO pro311_resource_canceller;
-- Direct mutation is forbidden: target-row locks must be acquired NOWAIT inside fixed functions.
REVOKE UPDATE("enabled") ON public."Pro311NativeProfile" FROM PUBLIC,pro311_archive_worker,pro311_resource_qualifier,pro311_resource_canceller;
REVOKE UPDATE("state") ON public."Pro311PreflightAdmission",public."Pro311NativeAdmission" FROM PUBLIC,pro311_archive_worker,pro311_resource_qualifier,pro311_resource_canceller;
ALTER FUNCTION public.pro311_lock_control() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_control_bootstrap(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_control_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_charge_control() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_reject_occupied_insert() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_public_projection(TEXT,TEXT,BIGINT,TIMESTAMPTZ,JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_metadata(TEXT,TEXT,TEXT,BIGINT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_preflight(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_status(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_publish_semantic(JSONB,JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_preflight_admission_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_admission_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_profile_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_cancel_profile(TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_cancel_native_admission(TEXT,BIGINT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_cancel_preflight_admission(TEXT,BIGINT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_existing(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_derive(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_new_result_coverage() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_archive_defer(TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_inventory_authorize(TEXT,TEXT,TEXT,TEXT,BOOLEAN) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_inventory_create(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro311_inventory_finish(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
REVOKE ALL ON FUNCTION public.pro311_lock_control(),public.pro311_control_bootstrap(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC),public.pro311_control_guard(),public.pro311_charge_control(),public.pro311_reject_occupied_insert(),public.pro311_public_projection(TEXT,TEXT,BIGINT,TIMESTAMPTZ,JSONB),public.pro311_archive_metadata(TEXT,TEXT,TEXT,BIGINT),public.pro311_archive_preflight(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_archive_status(TEXT,TEXT,TEXT),public.pro311_publish_semantic(JSONB,JSONB,TEXT,TEXT,TEXT,TEXT),public.pro311_admission_guard(),public.pro311_preflight_admission_guard(),public.pro311_profile_guard(),public.pro311_cancel_profile(TEXT),public.pro311_cancel_native_admission(TEXT,BIGINT,TEXT),public.pro311_cancel_preflight_admission(TEXT,BIGINT,TEXT),public.pro311_archive_existing(JSONB),public.pro311_archive_derive(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_archive_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_new_result_coverage(),public.pro311_archive_defer(TEXT,TEXT),public.pro311_inventory_authorize(TEXT,TEXT,TEXT,TEXT,BOOLEAN),public.pro311_inventory_create(TEXT,TEXT,TEXT),public.pro311_inventory_finish(TEXT,TEXT,TEXT) FROM PUBLIC,pro311_archive_worker,pro311_resource_qualifier,pro311_resource_canceller,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer,enta_runtime,enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.pro311_archive_preflight(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_archive_status(TEXT,TEXT,TEXT),public.pro311_archive_derive(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_archive_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT),public.pro311_inventory_create(TEXT,TEXT,TEXT),public.pro311_inventory_finish(TEXT,TEXT,TEXT) TO pro311_archive_worker;
GRANT EXECUTE ON FUNCTION public.pro311_archive_metadata(TEXT,TEXT,TEXT,BIGINT),public.pro311_publish_semantic(JSONB,JSONB,TEXT,TEXT,TEXT,TEXT),public.pro311_lock_control() TO huroof_pg_service_executor;

GRANT EXECUTE ON FUNCTION public.pro311_archive_defer(TEXT,TEXT),public.pro311_control_bootstrap(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC) TO pro311_resource_qualifier;
GRANT EXECUTE ON FUNCTION public.pro311_cancel_profile(TEXT),public.pro311_cancel_native_admission(TEXT,BIGINT,TEXT),public.pro311_cancel_preflight_admission(TEXT,BIGINT,TEXT) TO pro311_resource_canceller;
-- Fail closed on effective ACLs and pre-existing/default grants; never alter global defaults.
DO $audit$
DECLARE rel RECORD; col RECORD; ace RECORD; fn RECORD; cap RECORD; signature TEXT; names TEXT[]:=ARRAY[
 'Pro311ControlDomain','Pro311NativePool','Pro311NativeProfile','Pro311NativeRequirement','Pro311NativeJob','Pro311PreflightAdmission','Pro311NativeAdmission','Pro311ResultAttestation','Pro311InventoryBoundary','Pro311InventoryMember'];
 signatures TEXT[]:=ARRAY[
 'public.pro311_own_backend_start()','public.pro311_backend_is_live(name,integer,timestamptz)',
 'public.pro311_lock_control()','public.pro311_control_bootstrap(text,text,text,text,text,text,text,numeric,numeric,numeric)','public.pro311_control_guard()','public.pro311_charge_control()','public.pro311_reject_occupied_insert()',
 'public.pro311_public_projection(text,text,bigint,timestamptz,jsonb)','public.pro311_archive_metadata(text,text,text,bigint)',
 'public.pro311_archive_preflight(text,text,text,text,text,bigint,text,text)','public.pro311_archive_status(text,text,text)',
 'public.pro311_publish_semantic(jsonb,jsonb,text,text,text,text)','public.pro311_preflight_admission_guard()','public.pro311_admission_guard()',
 'public.pro311_profile_guard()','public.pro311_cancel_profile(text)','public.pro311_cancel_native_admission(text,bigint,text)','public.pro311_cancel_preflight_admission(text,bigint,text)','public.pro311_archive_existing(jsonb)','public.pro311_archive_derive(text,text,text,text,text,bigint,text,text)',
 'public.pro311_archive_read(text,text,text,text,text,bigint,text,text)','public.pro311_new_result_coverage()','public.pro311_archive_defer(text,text)',
 'public.pro311_inventory_authorize(text,text,text,text,boolean)','public.pro311_inventory_create(text,text,text)','public.pro311_inventory_finish(text,text,text)'];
 owner_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'); reader_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_activity_reader');
 worker_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_archive_worker'); qualifier_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_qualifier');
 canceller_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='pro311_resource_canceller'); executor_oid OID:=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_service_executor');
BEGIN
 IF owner_oid IS NULL OR reader_oid IS NULL OR worker_oid IS NULL OR qualifier_oid IS NULL OR canceller_oid IS NULL OR executor_oid IS NULL THEN RAISE EXCEPTION 'missing role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid IN (owner_oid,reader_oid,worker_oid,qualifier_oid,canceller_oid,executor_oid) AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls)) THEN RAISE EXCEPTION 'unsafe role attributes'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member IN (owner_oid,worker_oid,qualifier_oid,canceller_oid,executor_oid)) THEN RAISE EXCEPTION 'unexpected protected-role inheritance'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid IN (owner_oid,reader_oid,worker_oid,qualifier_oid,canceller_oid,executor_oid) AND m.admin_option) THEN RAISE EXCEPTION 'grant option on protected role'; END IF;
 IF EXISTS(WITH RECURSIVE edges(roleid,member,admin_option) AS (
  SELECT m.roleid,m.member,m.admin_option FROM pg_catalog.pg_auth_members m WHERE m.roleid IN (owner_oid,reader_oid,worker_oid,qualifier_oid,canceller_oid,executor_oid)
  UNION SELECT m.roleid,m.member,m.admin_option FROM pg_catalog.pg_auth_members m JOIN edges e ON m.roleid=e.member
 ) SELECT 1 FROM edges WHERE admin_option) THEN RAISE EXCEPTION 'transitive grant option on protected path'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid IN (worker_oid,qualifier_oid,canceller_oid,reader_oid) AND (pg_catalog.has_schema_privilege(r.oid,'public','CREATE') OR pg_catalog.has_schema_privilege(r.oid,'int4_crypto','CREATE'))) THEN RAISE EXCEPTION 'capability role can replace protected objects'; END IF;

 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.roleid IN (owner_oid,reader_oid) AND m.member<>m.roleid) THEN RAISE EXCEPTION 'protected owner/helper role assumable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=reader_oid AND r.rolname='pg_read_all_stats' AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option) OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE m.member=reader_oid AND r.rolname<>'pg_read_all_stats') THEN RAISE EXCEPTION 'activity reader membership mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles l CROSS JOIN pg_catalog.pg_roles protected WHERE l.rolcanlogin AND NOT l.rolsuper AND protected.rolname IN ('huroof_pg_owner','huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_executor','huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_result_importer','enta_runtime','enta_gameplay_runtime') AND (pg_catalog.pg_has_role(l.oid,worker_oid,'MEMBER') OR pg_catalog.pg_has_role(l.oid,qualifier_oid,'MEMBER') OR pg_catalog.pg_has_role(l.oid,canceller_oid,'MEMBER')) AND pg_catalog.pg_has_role(l.oid,protected.oid,'MEMBER')) THEN RAISE EXCEPTION 'capability login has unrelated privileged role'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles l WHERE l.rolcanlogin AND NOT l.rolsuper AND ((pg_catalog.pg_has_role(l.oid,worker_oid,'MEMBER') AND (pg_catalog.pg_has_role(l.oid,qualifier_oid,'MEMBER') OR pg_catalog.pg_has_role(l.oid,canceller_oid,'MEMBER'))) OR (pg_catalog.pg_has_role(l.oid,qualifier_oid,'MEMBER') AND pg_catalog.pg_has_role(l.oid,canceller_oid,'MEMBER')) OR pg_catalog.pg_has_role(l.oid,reader_oid,'MEMBER'))) THEN RAISE EXCEPTION 'capability login separation failed'; END IF;
 FOR rel IN SELECT c.oid,c.relname,c.relowner,c.relacl FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(names) AND c.relkind='r' LOOP
  IF rel.relowner<>owner_oid THEN RAISE EXCEPTION 'relation owner mismatch: %',rel.relname; END IF;
  FOR ace IN SELECT * FROM pg_catalog.aclexplode(COALESCE(rel.relacl,pg_catalog.acldefault('r',rel.relowner))) LOOP
   IF ace.grantor<>rel.relowner OR (ace.grantee<>rel.relowner AND ace.is_grantable) OR NOT (ace.grantee=rel.relowner OR (ace.grantee=qualifier_oid AND ace.privilege_type IN ('SELECT','INSERT') AND rel.relname IN ('Pro311NativePool','Pro311NativeRequirement','Pro311NativeProfile','Pro311PreflightAdmission','Pro311NativeAdmission')) OR (ace.grantee=qualifier_oid AND ace.privilege_type='SELECT' AND rel.relname='Pro311ControlDomain') OR (ace.grantee=canceller_oid AND ace.privilege_type='SELECT' AND rel.relname IN ('Pro311NativeProfile','Pro311PreflightAdmission','Pro311NativeAdmission'))) THEN RAISE EXCEPTION 'unexpected relation ACL: %',rel.relname; END IF;
  END LOOP;
  FOR col IN SELECT a.attname,a.attacl FROM pg_catalog.pg_attribute a WHERE a.attrelid=rel.oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL LOOP
   FOR ace IN SELECT * FROM pg_catalog.aclexplode(col.attacl) LOOP
    IF ace.grantor<>rel.relowner OR (ace.grantee<>rel.relowner AND ace.is_grantable) OR NOT (ace.grantee=rel.relowner ) THEN RAISE EXCEPTION 'unexpected column ACL: %.%',rel.relname,col.attname; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(names) AND c.relkind='r')<>pg_catalog.cardinality(names) THEN RAISE EXCEPTION 'missing new relation'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class t ON t.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid WHERE n.nspname='public' AND t.relname=ANY(names) AND (ix.relowner<>owner_oid OR ix.relacl IS NOT NULL)) THEN RAISE EXCEPTION 'new index owner or ACL mismatch'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('Pro311NativePool','Pro311NativeProfile','Pro311NativeRequirement','Pro311NativeJob','Pro311NativeAdmission','Pro311PreflightAdmission','Pro311ResultAttestation','Pro311InventoryBoundary','Pro311InventoryMember') AND t.tgname='AAB_control_charge' AND t.tgenabled='O' AND t.tgfoid=pg_catalog.to_regprocedure('public.pro311_charge_control()'))<>9 THEN RAISE EXCEPTION 'durable charge trigger closure missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.oid='public."Pro311NativeAdmission"'::regclass AND t.tgname='AAA_pro311_occupied' AND t.tgenabled='O' AND t.tgfoid=pg_catalog.to_regprocedure('public.pro311_reject_occupied_insert()')) THEN RAISE EXCEPTION 'duplicate admission guard missing'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND ((c.relname='HuroofMatchResult' AND t.tgname='Pro311_new_result_coverage') OR (c.relname='HuroofOwnerHistoryEntry' AND t.tgname='Pro311_new_history_coverage')) AND t.tgenabled='O' AND t.tgdeferrable AND t.tginitdeferred AND t.tgfoid=pg_catalog.to_regprocedure('public.pro311_new_result_coverage()'))<>2 THEN RAISE EXCEPTION 'coverage trigger closure missing'; END IF;

 FOREACH signature IN ARRAY signatures LOOP
  SELECT p.oid,p.proname,p.proowner,p.proacl INTO fn FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(signature);
  IF NOT FOUND OR fn.proowner<>CASE WHEN fn.proname IN ('pro311_own_backend_start','pro311_backend_is_live') THEN reader_oid ELSE owner_oid END THEN RAISE EXCEPTION 'function identity or owner mismatch: %',signature; END IF;
  FOR ace IN SELECT * FROM pg_catalog.aclexplode(COALESCE(fn.proacl,pg_catalog.acldefault('f',fn.proowner))) LOOP
   IF ace.grantor<>fn.proowner OR (ace.grantee<>fn.proowner AND ace.is_grantable) OR ace.privilege_type<>'EXECUTE' OR NOT (ace.grantee=fn.proowner OR (ace.grantee=owner_oid AND fn.proowner=reader_oid) OR (ace.grantee=worker_oid AND fn.proname IN ('pro311_archive_preflight','pro311_archive_status','pro311_archive_derive','pro311_archive_read','pro311_inventory_create','pro311_inventory_finish')) OR (ace.grantee=qualifier_oid AND fn.proname IN ('pro311_archive_defer','pro311_control_bootstrap')) OR (ace.grantee=canceller_oid AND fn.proname IN ('pro311_cancel_profile','pro311_cancel_native_admission','pro311_cancel_preflight_admission')) OR (ace.grantee=executor_oid AND fn.proname IN ('pro311_archive_metadata','pro311_publish_semantic','pro311_lock_control'))) THEN RAISE EXCEPTION 'unexpected function ACL: %',signature; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (SELECT q.proname FROM pg_catalog.pg_proc q WHERE q.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(x)::OID FROM pg_catalog.unnest(signatures) x))) AND NOT p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(x)::OID FROM pg_catalog.unnest(signatures) x))) THEN RAISE EXCEPTION 'unexpected new function overload'; END IF;
 -- Detect direct or inherited grants on unrelated public relations and SECURITY DEFINER entrypoints.
 FOR cap IN SELECT oid,rolname FROM pg_catalog.pg_roles WHERE oid IN (worker_oid,qualifier_oid,canceller_oid) LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%' AND c.relkind IN ('r','p','v','m') AND NOT (n.nspname='public' AND c.relname=ANY(names)) AND (pg_catalog.has_table_privilege(cap.oid,c.oid,'SELECT') OR pg_catalog.has_table_privilege(cap.oid,c.oid,'INSERT') OR pg_catalog.has_table_privilege(cap.oid,c.oid,'UPDATE') OR pg_catalog.has_table_privilege(cap.oid,c.oid,'DELETE') OR pg_catalog.has_table_privilege(cap.oid,c.oid,'TRUNCATE') OR pg_catalog.has_any_column_privilege(cap.oid,c.oid,'SELECT') OR pg_catalog.has_any_column_privilege(cap.oid,c.oid,'INSERT') OR pg_catalog.has_any_column_privilege(cap.oid,c.oid,'UPDATE') OR pg_catalog.has_any_column_privilege(cap.oid,c.oid,'REFERENCES'))) THEN RAISE EXCEPTION 'capability role has unrelated relation privilege: %',cap.rolname; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%' AND c.relkind='S' AND (pg_catalog.has_sequence_privilege(cap.oid,c.oid,'USAGE') OR pg_catalog.has_sequence_privilege(cap.oid,c.oid,'SELECT') OR pg_catalog.has_sequence_privilege(cap.oid,c.oid,'UPDATE'))) THEN RAISE EXCEPTION 'capability role has unrelated sequence privilege: %',cap.rolname; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%' AND p.prosecdef AND NOT p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(x)::OID FROM pg_catalog.unnest(signatures) x)) AND pg_catalog.has_function_privilege(cap.oid,p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'capability role has unrelated definer privilege: %',cap.rolname; END IF;
 END LOOP;
END $audit$;
