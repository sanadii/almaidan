-- INCOMPLETE SOURCE CANDIDATE. Never apply before final review and separate authority.
DO $$ BEGIN RAISE EXCEPTION 'ENG03_06_ROLE_IMPLEMENTATION_INCOMPLETE'; END $$;
ALTER FUNCTION public.eng03_06_context(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_setup_request(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_start_request(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_create_key(JSONB,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_lock_parent(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_lock_rooms(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_lock_room_dependents(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_assert_setup(TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_native_material(TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_assert_closure(TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_setup_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_stage_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_seal_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_deferred_close() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_immutable() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_06_successor_retry(JSONB,JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.eng03_06_successor_start(JSONB,JSONB,JSONB,JSONB,JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.eng03_06_admission_witness() OWNER TO enta_finance_executor;
ALTER FUNCTION public.eng03_06_successor_setup(JSONB,JSONB,JSONB) OWNER TO huroof_pg_service_executor;
REVOKE ALL ON FUNCTION public.eng03_06_context(JSONB) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_setup_request(JSONB) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_start_request(JSONB) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_create_key(JSONB,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_lock_parent(TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_lock_rooms(TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_lock_room_dependents(TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_assert_setup(TEXT,TEXT,TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_native_material(TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_assert_closure(TEXT) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_setup_guard() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_stage_guard() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_seal_guard() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_deferred_close() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_immutable() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_successor_retry(JSONB,JSONB) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_successor_start(JSONB,JSONB,JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_admission_witness() FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.eng03_06_successor_setup(JSONB,JSONB,JSONB) FROM PUBLIC,huroof_pg_runtime,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
GRANT EXECUTE ON FUNCTION public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_assert_setup(TEXT,TEXT,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_context(JSONB) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_create_key(JSONB,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_lock_parent(TEXT,TEXT,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_lock_room_dependents(TEXT,TEXT,TEXT) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_setup_request(JSONB) TO huroof_pg_service_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_assert_closure(TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_assert_setup(TEXT,TEXT,TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_context(JSONB) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_lock_room_dependents(TEXT,TEXT,TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_lock_rooms(TEXT,TEXT,TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_native_material(TEXT) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_start_request(JSONB) TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_06_successor_retry(JSONB,JSONB) TO huroof_pg_runtime;
GRANT EXECUTE ON FUNCTION public.eng03_06_successor_start(JSONB,JSONB,JSONB,JSONB,JSONB) TO huroof_pg_runtime;
GRANT EXECUTE ON FUNCTION public.eng03_06_successor_setup(JSONB,JSONB,JSONB) TO huroof_pg_runtime;
GRANT EXECUTE ON FUNCTION public.int5b_json_integer(JSONB,NUMERIC,NUMERIC),public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT),public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT) TO huroof_pg_owner;
ALTER TABLE public."HuroofSuccessorSetup" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofSuccessorStartReservation" OWNER TO enta_finance_executor;
ALTER TABLE public."HuroofSuccessorAdmissionWitness" OWNER TO enta_finance_executor;
ALTER TABLE public."HuroofSuccessorSeal" OWNER TO enta_finance_executor;
REVOKE ALL ON TABLE public."HuroofSuccessorSetup" FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_finance_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON TABLE public."HuroofSuccessorStartReservation" FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON TABLE public."HuroofSuccessorAdmissionWitness" FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON TABLE public."HuroofSuccessorSeal" FROM PUBLIC,huroof_pg_runtime,huroof_pg_service_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
GRANT SELECT,INSERT ON public."HuroofSuccessorSetup" TO huroof_pg_service_executor;
GRANT SELECT ON public."HuroofSuccessorSetup" TO enta_finance_executor;
GRANT REFERENCES ("namespace","ownerId","setupKey","freshRoomId") ON public."HuroofSuccessorSetup" TO enta_finance_executor;
GRANT REFERENCES ("id") ON public."FirebaseIdentity" TO enta_finance_executor;
GRANT SELECT ON public."HuroofSuccessorStartReservation",public."HuroofSuccessorAdmissionWitness",public."HuroofSuccessorSeal" TO huroof_pg_owner;
GRANT REFERENCES ("namespace","id","roomId","ownerFirebaseIdentityId","admissionId") ON public."HuroofMatch" TO enta_finance_executor;
GRANT REFERENCES ("namespace","roomId","sequence","id","matchId") ON public."HuroofEvent" TO enta_finance_executor;
GRANT REFERENCES ("namespace","roomId","actorFirebaseIdentityId","requestKey") ON public."HuroofCommandReceipt" TO enta_finance_executor;
GRANT INSERT ("namespace","childMatchId","predecessorMatchId","ownerFirebaseIdentityId","predecessorResultVersion","predecessorResultHash"), SELECT ("namespace","childMatchId","predecessorMatchId","ownerFirebaseIdentityId","predecessorResultVersion","predecessorResultHash") ON public."HuroofRematchLink" TO enta_finance_executor;
DO $successor_function_acl$
DECLARE item RECORD; obj pg_catalog.pg_proc%ROWTYPE; owner_name TEXT; a RECORD; role_name TEXT; allowed BOOLEAN;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('public.eng03_06_context(JSONB)','huroof_pg_owner',true,true,false,false),
('public.eng03_06_setup_request(JSONB)','huroof_pg_owner',true,false,false,false),
('public.eng03_06_start_request(JSONB)','huroof_pg_owner',false,true,false,false),
('public.eng03_06_create_key(JSONB,TEXT)','huroof_pg_owner',true,false,false,false),
('public.eng03_06_assert_parent(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_owner',true,true,false,false),
('public.eng03_06_lock_parent(TEXT,TEXT,TEXT)','huroof_pg_owner',true,false,false,false),
('public.eng03_06_lock_rooms(TEXT,TEXT,TEXT)','huroof_pg_owner',false,true,false,false),
('public.eng03_06_lock_room_dependents(TEXT,TEXT,TEXT)','huroof_pg_owner',true,true,false,false),
('public.eng03_06_assert_setup(TEXT,TEXT,TEXT)','huroof_pg_owner',true,true,false,false),
('public.eng03_06_native_material(TEXT)','huroof_pg_owner',false,true,false,true),
('public.eng03_06_assert_closure(TEXT)','huroof_pg_owner',false,true,false,true),
('public.eng03_06_setup_guard()','huroof_pg_owner',false,false,false,false),
('public.eng03_06_stage_guard()','huroof_pg_owner',false,false,false,false),
('public.eng03_06_seal_guard()','huroof_pg_owner',false,false,false,true),
('public.eng03_06_deferred_close()','huroof_pg_owner',false,false,false,false),
('public.eng03_06_immutable()','huroof_pg_owner',false,false,false,false),
('public.eng03_06_successor_retry(JSONB,JSONB)','enta_finance_executor',false,true,true,true),
('public.eng03_06_successor_start(JSONB,JSONB,JSONB,JSONB,JSONB)','enta_finance_executor',false,true,true,false),
('public.eng03_06_admission_witness()','enta_finance_executor',false,true,false,false),
('public.eng03_06_successor_setup(JSONB,JSONB,JSONB)','huroof_pg_service_executor',true,false,true,false)) AS inventory(signature,owner_name,service_allowed,finance_allowed,runtime_allowed,utc_required) LOOP
  SELECT * INTO obj FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF NOT FOUND THEN RAISE EXCEPTION 'successor function missing: %',item.signature;END IF;
  SELECT rolname INTO owner_name FROM pg_catalog.pg_roles WHERE oid=obj.proowner;
  IF owner_name IS DISTINCT FROM item.owner_name OR obj.prosecdef IS NOT TRUE OR NOT ('search_path=pg_catalog'=ANY(obj.proconfig)) OR (item.utc_required AND NOT ('TimeZone=UTC'=ANY(obj.proconfig) OR 'timezone=UTC'=ANY(obj.proconfig))) THEN RAISE EXCEPTION 'successor function identity mismatch: %',item.signature;END IF;
  FOR a IN SELECT * FROM pg_catalog.aclexplode(COALESCE(obj.proacl,pg_catalog.acldefault('f',obj.proowner))) LOOP
   IF a.grantee=obj.proowner THEN CONTINUE;END IF;
   SELECT rolname INTO role_name FROM pg_catalog.pg_roles WHERE oid=a.grantee;
   allowed:=a.privilege_type='EXECUTE' AND a.is_grantable IS FALSE AND ((role_name='huroof_pg_service_executor' AND item.service_allowed) OR (role_name='enta_finance_executor' AND item.finance_allowed) OR (role_name='huroof_pg_runtime' AND item.runtime_allowed));
   IF allowed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'unexpected successor function ACL: %',item.signature;END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE') IS DISTINCT FROM item.runtime_allowed OR pg_catalog.has_function_privilege('huroof_pg_service_executor',obj.oid,'EXECUTE') IS DISTINCT FROM item.service_allowed OR pg_catalog.has_function_privilege('enta_finance_executor',obj.oid,'EXECUTE') IS DISTINCT FROM item.finance_allowed THEN RAISE EXCEPTION 'effective successor EXECUTE mismatch: %',item.signature;END IF;
 END LOOP;
 IF pg_catalog.pg_has_role('huroof_pg_runtime','huroof_pg_owner','MEMBER') OR pg_catalog.pg_has_role('huroof_pg_runtime','huroof_pg_service_executor','MEMBER') OR pg_catalog.pg_has_role('huroof_pg_runtime','enta_finance_executor','MEMBER') OR pg_catalog.has_schema_privilege('huroof_pg_runtime','public','CREATE') OR pg_catalog.has_schema_privilege('huroof_pg_runtime','int4_crypto','CREATE') THEN RAISE EXCEPTION 'successor runtime escalation';END IF;
END $successor_function_acl$;
DO $successor_table_acl$
DECLARE name TEXT; col TEXT;
BEGIN
 FOREACH name IN ARRAY ARRAY['public."HuroofSuccessorSetup"','public."HuroofSuccessorStartReservation"','public."HuroofSuccessorAdmissionWitness"','public."HuroofSuccessorSeal"'] LOOP
  IF pg_catalog.has_table_privilege('huroof_pg_runtime',name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE c.oid=pg_catalog.to_regclass(name) AND a.grantee=0) THEN RAISE EXCEPTION 'successor table exposed: %',name;END IF;
 END LOOP;
 IF pg_catalog.has_table_privilege('enta_finance_executor','public."HuroofRematchLink"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'finance has broad rematch table privilege';END IF;
 FOREACH col IN ARRAY ARRAY['namespace','childMatchId','predecessorMatchId','ownerFirebaseIdentityId','predecessorResultVersion','predecessorResultHash'] LOOP
  IF pg_catalog.has_column_privilege('huroof_pg_runtime','public."HuroofRematchLink"',col,'INSERT,UPDATE,REFERENCES') OR pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"',col,'UPDATE,REFERENCES') THEN RAISE EXCEPTION 'unexpected rematch column mutation: %',col;END IF;
  IF NOT pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"',col,'SELECT') OR NOT pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"',col,'INSERT') OR pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"',col,'SELECT WITH GRANT OPTION') OR pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"',col,'INSERT WITH GRANT OPTION') THEN RAISE EXCEPTION 'rematch column ACL mismatch: %',col;END IF;
 END LOOP;
 IF pg_catalog.has_column_privilege('enta_finance_executor','public."HuroofRematchLink"','createdAt','SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'unexpected rematch createdAt privilege';END IF;
END $successor_table_acl$;
DO $successor_table_graph$
DECLARE item RECORD; rel pg_catalog.pg_class%ROWTYPE; a RECORD; who TEXT; allowed BOOLEAN; col RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public."HuroofSuccessorSetup"','huroof_pg_owner'),
  ('public."HuroofSuccessorStartReservation"','enta_finance_executor'),
  ('public."HuroofSuccessorAdmissionWitness"','enta_finance_executor'),
  ('public."HuroofSuccessorSeal"','enta_finance_executor')) AS inventory(name,owner_name) LOOP
  SELECT * INTO rel FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass(item.name);
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=rel.relowner AND rolname=item.owner_name) THEN RAISE EXCEPTION 'successor relation owner mismatch: %',item.name;END IF;
  FOR a IN SELECT * FROM pg_catalog.aclexplode(COALESCE(rel.relacl,pg_catalog.acldefault('r',rel.relowner))) LOOP
   IF a.grantee=rel.relowner THEN CONTINUE;END IF;
   SELECT rolname INTO who FROM pg_catalog.pg_roles WHERE oid=a.grantee;
   allowed:=a.is_grantable IS FALSE AND ((item.owner_name='huroof_pg_owner' AND who='huroof_pg_service_executor' AND a.privilege_type IN('SELECT','INSERT')) OR (item.owner_name='huroof_pg_owner' AND who='enta_finance_executor' AND a.privilege_type='SELECT') OR (item.owner_name='enta_finance_executor' AND who='huroof_pg_owner' AND a.privilege_type='SELECT'));
   IF allowed IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'unexpected successor table ACL: %',item.name;END IF;
  END LOOP;
  FOR col IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid=rel.oid AND attnum>0 AND NOT attisdropped LOOP
   IF pg_catalog.has_column_privilege('huroof_pg_runtime',rel.oid,col.attname,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'runtime successor column privilege: %.%',item.name,col.attname;END IF;
   IF item.owner_name='huroof_pg_owner' AND pg_catalog.has_column_privilege('enta_finance_executor',rel.oid,col.attname,'REFERENCES') IS DISTINCT FROM (col.attname IN('namespace','ownerId','setupKey','freshRoomId')) THEN RAISE EXCEPTION 'finance setup REFERENCES mismatch: %',col.attname;END IF;
   IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT attacl FROM pg_catalog.pg_attribute WHERE attrelid=rel.oid AND attname=col.attname),'{}'::aclitem[])) x WHERE x.is_grantable OR x.grantee=0 OR NOT (item.owner_name='huroof_pg_owner' AND x.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='enta_finance_executor') AND x.privilege_type='REFERENCES' AND col.attname IN('namespace','ownerId','setupKey','freshRoomId'))) THEN RAISE EXCEPTION 'unexpected successor column ACL: %.%',item.name,col.attname;END IF;
  END LOOP;
 END LOOP;
END $successor_table_graph$;
DO $successor_inheritance$
DECLARE actor TEXT;privileged TEXT;
BEGIN
 FOREACH actor IN ARRAY ARRAY['huroof_pg_runtime','enta_runtime','enta_gameplay_runtime','enta_outbox_worker','huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
  FOREACH privileged IN ARRAY ARRAY['huroof_pg_owner','huroof_pg_service_executor','enta_finance_executor'] LOOP
   IF pg_catalog.pg_has_role(actor,privileged,'MEMBER') THEN RAISE EXCEPTION 'unexpected inherited successor authority: % -> %',actor,privileged;END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege(actor,'public','CREATE') OR pg_catalog.has_schema_privilege(actor,'int4_crypto','CREATE') THEN RAISE EXCEPTION 'unexpected successor schema CREATE: %',actor;END IF;
 END LOOP;
END $successor_inheritance$;
