-- PRO273 role candidate. DO NOT APPLY: inherited ACL text requires final review and runtime authority.
BEGIN;
ALTER FUNCTION public.pro273_supplement_put(JSONB,JSONB,TEXT,BYTEA,BYTEA) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro273_supplement_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.pro273_audience_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) OWNER TO huroof_pg_realtime_reader;
REVOKE ALL ON FUNCTION public.pro273_supplement_put(JSONB,JSONB,TEXT,BYTEA,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_supplement_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_audience_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pro273_supplement_put(JSONB,JSONB,TEXT,BYTEA,BYTEA) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.pro273_supplement_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) TO huroof_pg_content_publisher;
GRANT EXECUTE ON FUNCTION public.pro273_audience_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) TO huroof_pg_runtime;
-- Successor graph deliberately removes the obsolete policy-unbound read edge.
REVOKE EXECUTE ON FUNCTION public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT) FROM huroof_pg_runtime;
-- Existing 05 prepare_profile remains owner-only; no new edge is granted.
DO $pro273_new_edges$
DECLARE item RECORD; fn OID; role_name TEXT; actual_owner TEXT; actual_result TEXT; actual_definer BOOLEAN; actual_config TEXT[]; actual_volatility "char"; relation RECORD; col RECORD; privilege_name TEXT;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.pro273_supplement_put(jsonb,jsonb,text,bytea,bytea)','huroof_pg_owner','huroof_pg_content_publisher','v'),
  ('public.pro273_supplement_prepare(jsonb,text,text,text,text)','huroof_pg_owner','huroof_pg_content_publisher','v'),
  ('public.pro273_audience_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)','huroof_pg_realtime_reader','huroof_pg_runtime','s')
 ) v(signature,owner_name,executor_name,volatility) LOOP
  fn:=pg_catalog.to_regprocedure(item.signature)::OID; IF fn IS NULL THEN RAISE EXCEPTION 'PRO273 function unavailable'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=(SELECT f.proname FROM pg_catalog.pg_proc f WHERE f.oid=fn))<>1 THEN RAISE EXCEPTION 'PRO273 unexpected function overload'; END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner),pg_catalog.pg_get_function_result(p.oid),p.prosecdef,p.proconfig,p.provolatile INTO actual_owner,actual_result,actual_definer,actual_config,actual_volatility FROM pg_catalog.pg_proc p WHERE p.oid=fn;
  IF actual_owner IS DISTINCT FROM item.owner_name OR actual_result IS DISTINCT FROM 'jsonb' OR actual_definer IS DISTINCT FROM true OR actual_volatility::TEXT IS DISTINCT FROM item.volatility OR actual_config IS NULL OR NOT ('search_path=pg_catalog'=ANY(actual_config)) THEN RAISE EXCEPTION 'PRO273 function identity mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=fn),pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE r.rolname=item.executor_name AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN RAISE EXCEPTION 'PRO273 required direct function edge missing'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=fn),pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn) AND (a.grantee=0 OR a.is_grantable OR r.rolname IS DISTINCT FROM item.executor_name)) THEN RAISE EXCEPTION 'PRO273 unexpected direct function edge'; END IF;
  FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP
   IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') IS DISTINCT FROM (role_name=item.executor_name OR role_name=item.owner_name) THEN RAISE EXCEPTION 'PRO273 unexpected effective function edge'; END IF;
  END LOOP;
 END LOOP;
 fn:=pg_catalog.to_regprocedure('public.eng03_05_prepare_profile(jsonb,jsonb,text,bigint)')::OID;
 IF fn IS NULL OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid=fn) IS DISTINCT FROM 'huroof_pg_owner' OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=fn),pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)))) a WHERE a.grantee<>(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)) THEN RAISE EXCEPTION 'PRO273 prepare_profile must remain owner-only'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'PRO273 prepare_profile effective edge forbidden'; END IF; END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)','enta_finance_executor'),
  ('public.eng03_03_content_load(text,text,text,bigint,text,text)','huroof_pg_service_executor'),
  ('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','huroof_pg_service_executor'),
  ('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)','huroof_pg_service_executor'),
  ('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)','huroof_pg_service_executor'),
  ('public.eng03_03_projection_read(text,text,text,bigint)','huroof_pg_service_executor'),
  ('public.eng03_04_realtime_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)','huroof_pg_realtime_reader'),
  ('public.eng03_05_profile_append(jsonb,jsonb,jsonb)','huroof_pg_owner'),
  ('public.eng03_05_pointer_move(jsonb,jsonb,jsonb)','huroof_pg_owner')
 ) v(signature,owner_name) LOOP
  fn:=pg_catalog.to_regprocedure(item.signature)::OID; IF fn IS NULL THEN RAISE EXCEPTION 'PRO273 inherited function unavailable'; END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig INTO actual_owner,actual_definer,actual_config FROM pg_catalog.pg_proc p WHERE p.oid=fn;
  IF actual_owner IS DISTINCT FROM item.owner_name OR actual_definer IS DISTINCT FROM true OR actual_config IS NULL OR NOT ('search_path=pg_catalog'=ANY(actual_config)) THEN RAISE EXCEPTION 'PRO273 inherited function identity mismatch'; END IF;
 END LOOP;
 -- Private canonical-byte helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_payload_bytes(text,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_payload_bytes')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='bytea' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 payload helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private payload effective edge forbidden'; END IF; END LOOP;
 -- Private semantic helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_semantic(jsonb,jsonb)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_semantic')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='boolean' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 semantic helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private semantic effective edge forbidden'; END IF; END LOOP;
 -- Private game helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_game(jsonb,jsonb,text,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_game')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 game helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private game effective edge forbidden'; END IF; END LOOP;
 -- Private verdict helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_verdict(jsonb,jsonb,jsonb,jsonb,text,bigint)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_verdict')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 verdict helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private verdict effective edge forbidden'; END IF; END LOOP;
 -- Private compact-state helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_nonaward(jsonb,jsonb,jsonb,jsonb,jsonb,text,bigint)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_nonaward')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='boolean' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 state helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private state effective edge forbidden'; END IF; END LOOP;
 -- Private snapshot-root helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_snapshot_root(bytea,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_snapshot_root')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='text' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 snapshot helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private snapshot effective edge forbidden'; END IF; END LOOP;
 -- Narrow owner-definer publication proof: only the service executor receives EXECUTE.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_publication_proof(text,text,text,text,bigint,text,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_publication_proof')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_owner' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND p.prosecdef AND p.provolatile='s' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=fn AND r.rolname='huroof_pg_service_executor' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=fn AND a.grantee<>p.proowner AND (a.grantee=0 OR a.is_grantable OR r.rolname IS DISTINCT FROM 'huroof_pg_service_executor')) THEN RAISE EXCEPTION 'PRO273 publication proof identity unavailable'; END IF;
 IF NOT pg_catalog.has_function_privilege('huroof_pg_service_executor',fn,'EXECUTE') OR pg_catalog.has_function_privilege('huroof_pg_service_executor',fn,'EXECUTE WITH GRANT OPTION') OR pg_catalog.pg_has_role('huroof_pg_service_executor','huroof_pg_owner','MEMBER') THEN RAISE EXCEPTION 'PRO273 publication proof service edge unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_owner','MEMBER') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 publication proof effective edge forbidden'; END IF; END LOOP;
 -- Private pinned-definition helper: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_definition(text,text,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_definition')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND NOT p.prosecdef AND p.provolatile='s' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 definition helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private definition effective edge forbidden'; END IF; END LOOP;
 -- Private candidate definition resolver: owner-only and no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_definition_candidate(text,text,text,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_definition_candidate')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND NOT p.prosecdef AND p.provolatile='s' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 candidate definition identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private candidate effective edge forbidden'; END IF; END LOOP;
 -- Private path helper: owner only; no effective access for other service roles.
 fn:=pg_catalog.to_regprocedure('public.pro273_r1_path(jsonb,text)')::OID;
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='pro273_r1_path')<>1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='jsonb' AND NOT p.prosecdef AND p.provolatile='i' AND 'search_path=pg_catalog'=ANY(p.proconfig)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 path helper identity unavailable'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') OR pg_catalog.pg_has_role(role_name,'huroof_pg_service_executor','MEMBER') THEN RAISE EXCEPTION 'PRO273 private path effective edge forbidden'; END IF; END LOOP;
 -- CREATE OR REPLACE must not change the pre-existing direct or effective edges.
 FOR item IN SELECT * FROM (VALUES
  ('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)','enta_finance_executor','huroof_pg_runtime'),
  ('public.eng03_03_content_load(text,text,text,bigint,text,text)','huroof_pg_service_executor','huroof_pg_runtime'),
  ('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','huroof_pg_service_executor','huroof_pg_runtime'),
  ('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)','huroof_pg_service_executor','huroof_pg_runtime'),
  ('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)','huroof_pg_service_executor','huroof_pg_runtime'),
  ('public.eng03_04_realtime_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)','huroof_pg_realtime_reader','huroof_pg_runtime'),
  ('public.eng03_05_profile_append(jsonb,jsonb,jsonb)','huroof_pg_owner','huroof_pg_content_publisher'),
  ('public.eng03_05_pointer_move(jsonb,jsonb,jsonb)','huroof_pg_owner','huroof_pg_content_publisher')
 ) v(signature,owner_name,executor_name) LOOP
  fn:=pg_catalog.to_regprocedure(item.signature)::OID;
  IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=fn),pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE r.rolname=item.executor_name AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid=fn),pg_catalog.acldefault('f',(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn)))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>(SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid=fn) AND (a.grantee=0 OR a.is_grantable OR r.rolname IS DISTINCT FROM item.executor_name)) THEN RAISE EXCEPTION 'PRO273 inherited direct function edge mismatch'; END IF;
  FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP
   IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') IS DISTINCT FROM (role_name=item.executor_name OR role_name=item.owner_name) THEN RAISE EXCEPTION 'PRO273 inherited effective function edge mismatch'; END IF;
  END LOOP;
 END LOOP;
 fn:=pg_catalog.to_regprocedure('public.eng03_03_projection_read(text,text,text,bigint)')::OID;
 IF fn IS NULL OR (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid=fn) IS DISTINCT FROM 'huroof_pg_service_executor' OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee<>p.proowner) THEN RAISE EXCEPTION 'PRO273 obsolete projection edge remains'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') THEN RAISE EXCEPTION 'PRO273 obsolete projection effective edge remains'; END IF; END LOOP;
 fn:=pg_catalog.to_regprocedure('public.eng03_03_projection_safe(jsonb,boolean)')::OID;
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND pg_catalog.pg_get_userbyid(p.proowner)='huroof_pg_service_executor' AND pg_catalog.pg_get_function_result(p.oid)='boolean' AND NOT p.prosecdef) OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=fn AND r.rolname='enta_finance_executor' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=fn AND a.grantee<>p.proowner AND (a.grantee=0 OR a.is_grantable OR r.rolname IS DISTINCT FROM 'enta_finance_executor')) THEN RAISE EXCEPTION 'PRO273 projection safety function identity or edge mismatch'; END IF;
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor','huroof_pg_realtime_reader','huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_runtime'] LOOP
  IF pg_catalog.has_function_privilege(role_name,fn,'EXECUTE') IS DISTINCT FROM (role_name IN ('huroof_pg_service_executor','enta_finance_executor')) THEN RAISE EXCEPTION 'PRO273 projection safety effective edge mismatch'; END IF;
 END LOOP;
 FOR relation IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (c.relname LIKE 'Huroof%' OR c.relname LIKE 'Catalog%' OR c.relname IN ('Wallet','Admission','Reservation','LedgerEntry')) LOOP
  FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_publisher'] LOOP
   FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP IF pg_catalog.has_table_privilege(role_name,relation.oid,privilege_name) THEN RAISE EXCEPTION 'PRO273 direct table access forbidden: %',relation.relname; END IF; END LOOP;
   FOR col IN SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=relation.oid AND a.attnum>0 AND NOT a.attisdropped LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP IF pg_catalog.has_column_privilege(role_name,relation.oid,col.attname,privilege_name) THEN RAISE EXCEPTION 'PRO273 direct column access forbidden: %.%',relation.relname,col.attname; END IF; END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
END $pro273_new_edges$;
-- Retained accepted04 graph, with only the policy-unbound 03 projection edge subtracted.
DO $pro273_inherited_04$
DECLARE obj RECORD; col RECORD; privilege TEXT; checked_role TEXT; allowed BOOLEAN; fn OID := pg_catalog.to_regprocedure('public.eng03_04_realtime_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)');
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='huroof_pg_runtime' AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls)) THEN RAISE EXCEPTION 'unsafe runtime attributes'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname IN ('huroof_pg_runtime','huroof_pg_realtime_reader')) THEN RAISE EXCEPTION 'outgoing role membership forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname='huroof_pg_realtime_reader') THEN RAISE EXCEPTION 'reader role assumption forbidden'; END IF;
 FOR obj IN SELECT c.oid,c.relname,c.relowner,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f','S') LOOP
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_realtime_reader','huroof_pg_runtime'] LOOP
   IF pg_catalog.pg_get_userbyid(obj.relowner)=checked_role THEN RAISE EXCEPTION 'raw relation ownership forbidden: %',obj.relname; END IF;
   IF obj.relkind='S' THEN
    FOREACH privilege IN ARRAY ARRAY['SELECT','USAGE','UPDATE'] LOOP
     IF has_sequence_privilege(checked_role,obj.oid,privilege) OR has_sequence_privilege(checked_role,obj.oid,privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'sequence privilege forbidden: % % %',checked_role,obj.relname,privilege; END IF;
    END LOOP;
   ELSE
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
     allowed:=checked_role='huroof_pg_realtime_reader' AND privilege='SELECT' AND obj.relname IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult');
     IF (has_table_privilege(checked_role,obj.oid,privilege) AND NOT allowed) OR has_table_privilege(checked_role,obj.oid,privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'unexpected effective table privilege: % % %',checked_role,obj.relname,privilege; END IF;
    END LOOP;
    FOR col IN SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid=obj.oid AND a.attnum>0 AND NOT a.attisdropped LOOP
     FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      allowed:=checked_role='huroof_pg_realtime_reader' AND privilege='SELECT' AND obj.relname IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult');
      IF (has_column_privilege(checked_role,obj.oid,col.attname,privilege) AND NOT allowed) OR has_column_privilege(checked_role,obj.oid,col.attname,privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'unexpected effective column privilege: % % % %',checked_role,obj.relname,col.attname,privilege; END IF;
     END LOOP;
    END LOOP;
   END IF;
  END LOOP;
 END LOOP;
 FOR obj IN SELECT signature FROM (VALUES
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)')) required(signature) LOOP
  IF pg_catalog.to_regprocedure(obj.signature) IS NULL OR NOT has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE') OR has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'required runtime function edge missing: %',obj.signature; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND r.rolname='huroof_pg_runtime' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime direct or PUBLIC function edge mismatch: %',obj.signature; END IF;
 END LOOP;
 -- Preserve the accepted03 runtime graph and admit only the new04 edge after provisioning.
 FOR obj IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'eng03\_02\_%' ESCAPE '\' OR p.proname LIKE 'eng03\_03\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname='eng03_04_realtime_read') LOOP
  SELECT obj.oid IN (SELECT pg_catalog.to_regprocedure(signature)::oid FROM (VALUES
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)')) expected(signature)) OR (true AND obj.oid=fn) INTO allowed;
  IF has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE') IS DISTINCT FROM allowed OR has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'runtime function graph drift: %',obj.proname; END IF;
 END LOOP;
 IF true THEN
  IF has_schema_privilege('huroof_pg_realtime_reader','public','CREATE') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.oid=fn AND r.rolname='huroof_pg_realtime_reader' AND p.prokind='f' AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'final routine owner or properties invalid'; END IF;
  FOR obj IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult') LOOP
   IF NOT has_table_privilege('huroof_pg_realtime_reader',obj.oid,'SELECT') THEN RAISE EXCEPTION 'reader SELECT edge missing: %',obj.relname; END IF;
  END LOOP;
 END IF;
END $pro273_inherited_04$;
DO $pro273_crypto_graph$
DECLARE obj RECORD; checked_role TEXT;
BEGIN
 FOR obj IN SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.prokind,e.extowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace LEFT JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e' LEFT JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid AND e.extname='pgcrypto' AND e.extnamespace=n.oid WHERE n.nspname='int4_crypto' LOOP
  IF obj.extowner IS NULL OR obj.proowner<>obj.extowner OR obj.prosecdef OR obj.prokind<>'f' THEN RAISE EXCEPTION 'unqualified crypto provider'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj.proacl,pg_catalog.acldefault('f',obj.proowner))) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>obj.proowner AND (a.is_grantable OR NOT (a.grantee=0 OR (obj.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)') AND r.rolname IN ('huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor','huroof_pg_realtime_reader'))))) THEN RAISE EXCEPTION 'unexpected private crypto edge or grant option'; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_realtime_reader'] LOOP
   IF has_schema_privilege(checked_role,'int4_crypto','USAGE') AND has_function_privilege(checked_role,obj.oid,'EXECUTE') THEN
    IF has_function_privilege(checked_role,obj.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'crypto grant option forbidden'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj.proacl,pg_catalog.acldefault('f',obj.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) AND NOT (checked_role IN ('huroof_pg_service_executor','huroof_pg_realtime_reader') AND obj.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')) THEN RAISE EXCEPTION 'unexpected effective crypto edge'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor','huroof_pg_realtime_reader'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)') AND r.rolname=checked_role AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) THEN RAISE EXCEPTION 'required digest edge missing: %',checked_role; END IF;
 END LOOP;
END $pro273_crypto_graph$;
-- Retained accepted05 ownership, role, and effective ACL verification.
DO $pro273_owner_dependencies$
DECLARE owner_oid OID := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner'); rel TEXT;
BEGIN
 FOREACH rel IN ARRAY ARRAY['public."DeploymentNamespace"','public."FirebaseIdentity"','public."ActiveCatalogPointer"','public."CatalogValidationReceipt"','public."CatalogReleaseSeal"','public."HuroofContentPointer"','public."HuroofContentRevision"','public."HuroofRawArtifact"','public."HuroofMediaRevision"','public."HuroofRoom"','public."HuroofMember"'] LOOP
  IF NOT pg_catalog.has_table_privilege(owner_oid,rel,'SELECT') THEN RAISE EXCEPTION 'owner lacks existing read dependency %',rel; END IF;
 END LOOP;
 IF NOT pg_catalog.has_column_privilege(owner_oid,'public."ActiveCatalogPointer"','updatedAt','UPDATE') OR pg_catalog.has_table_privilege(owner_oid,'public."ActiveCatalogPointer"','SELECT WITH GRANT OPTION') OR pg_catalog.has_table_privilege(owner_oid,'public."ActiveCatalogPointer"','UPDATE') OR pg_catalog.has_column_privilege(owner_oid,'public."ActiveCatalogPointer"','updatedAt','UPDATE WITH GRANT OPTION') OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."ActiveCatalogPointer"'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attname<>'updatedAt' AND pg_catalog.has_column_privilege(owner_oid,a.attrelid,a.attname,'UPDATE')) THEN RAISE EXCEPTION 'catalog owner capability exceeds or lacks bounded row lock'; END IF;
 IF NOT pg_catalog.has_table_privilege(owner_oid,'public."HuroofContentPointer"','UPDATE') THEN RAISE EXCEPTION 'owner lacks required row-lock capability'; END IF;
 FOREACH rel IN ARRAY ARRAY['public."HuroofRawArtifact"','public."HuroofContentRevision"','public."HuroofContentPointer"','public."HuroofContentAudit"','public."HuroofMediaRevision"'] LOOP
  IF NOT pg_catalog.has_table_privilege(owner_oid,rel,'INSERT') THEN RAISE EXCEPTION 'owner lacks existing insert dependency %',rel; END IF;
 END LOOP;
 IF NOT pg_catalog.has_function_privilege(owner_oid,'public.eng03_03_assert_current(text,text,text,text)','EXECUTE') OR NOT pg_catalog.has_function_privilege(owner_oid,'public.int5b_hash_json(jsonb)','EXECUTE') OR NOT pg_catalog.has_function_privilege(owner_oid,'public.int5b_canonical_json(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'owner lacks exact existing helper capability'; END IF;
END $pro273_owner_dependencies$;
DO $pro273_inherited_05$
DECLARE item RECORD;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member ON member.oid=m.member WHERE member.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'executor group membership forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher')) THEN RAISE EXCEPTION 'executor default ACL forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.prokind='f' AND f.prosecdef AND f.proname<>'eng03_05_media_append' AND position('eng03_05_media_append' in pg_catalog.pg_get_functiondef(f.oid))>0 AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_runtime','huroof_pg_service_executor','huroof_pg_realtime_reader','enta_runtime') AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'general-callable media forwarding wrapper'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles src CROSS JOIN pg_catalog.pg_roles dst WHERE NOT src.rolsuper AND src.rolname<>'huroof_pg_owner' AND src.oid<>dst.oid AND dst.rolname IN ('huroof_pg_owner','huroof_pg_content_publisher','huroof_pg_admin_sync','huroof_pg_material_executor') AND pg_catalog.pg_has_role(src.oid,dst.oid,'MEMBER')) THEN RAISE EXCEPTION 'unexpected privileged role member'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid=cl.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(cl.relacl,pg_catalog.acldefault('r',cl.relowner))) a WHERE n.nspname='public' AND cl.relname IN ('HuroofAdminPrincipal','HuroofAdminAuthzInvariant','HuroofAdminOperation','HuroofAdminIdentitySyncOutcome','HuroofAdminAudit','HuroofAdminRateWindow','HuroofAdminQuestionDraftRevision','HuroofAdminReviewRevision','HuroofAdminPublishedQuestionInspection','HuroofAdminCategoryCorrectionRevision','HuroofAdminCategoryMetadataRevision','HuroofAdminSettingsRevision') AND (cl.relowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner') OR a.grantee<>cl.relowner)) THEN RAISE EXCEPTION 'unexpected table owner or ACL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles src CROSS JOIN pg_catalog.pg_roles dst WHERE src.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_runtime','huroof_pg_executor','huroof_pg_service_executor','huroof_pg_realtime_reader','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_result_importer','enta_finance_executor','enta_runtime') AND dst.rolname IN ('huroof_pg_owner','huroof_pg_content_publisher','huroof_pg_admin_sync','huroof_pg_material_executor') AND src.oid<>dst.oid AND pg_catalog.pg_has_role(src.oid,dst.oid,'MEMBER')) THEN RAISE EXCEPTION 'forbidden transitive role membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('huroof_pg_admin_reader','huroof_pg_admin_registry','huroof_pg_admin_sync','huroof_pg_material_executor','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (pg_catalog.has_schema_privilege(r.oid,'public','CREATE') OR pg_catalog.has_schema_privilege(r.oid,'int4_crypto','CREATE'))) THEN RAISE EXCEPTION 'schema create forbidden'; END IF;
 FOR item IN SELECT * FROM (VALUES ('public.eng03_05_lock_namespace(TEXT)','void'),
('public.eng03_05_assert_admin(JSONB,TEXT)','jsonb'),
('public.eng03_05_principal(JSONB)','jsonb'),
('public.eng03_05_rate_take(JSONB)','jsonb'),
('public.eng03_05_snapshot_documents_root(BYTEA)','text'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_media_authorize(JSONB,JSONB)','jsonb'),
('public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_append_audit(TEXT,TEXT,TEXT)','void'),
('public.eng03_05_settings_get(JSONB)','jsonb'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_draft_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_draft_chain_guard()','trigger'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','jsonb'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_review_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_review_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','jsonb'),
('public.eng03_05_room_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_room_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_category_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_audit_list(JSONB,JSONB)','jsonb'),
('public.eng03_05_operation_get(JSONB,TEXT)','jsonb'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','jsonb'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','jsonb'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','jsonb'),
('public.eng03_05_review_chain_guard()','trigger'),
('public.eng03_05_metadata_chain_guard()','trigger'),
('public.eng03_05_settings_chain_guard()','trigger'),
('public.eng03_05_correction_chain_guard()','trigger'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_assert_evidence(JSONB,JSONB)','void'),
('public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT)','jsonb'),
('public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','jsonb'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','jsonb'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','jsonb'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','jsonb'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','jsonb')) AS expected(signature,result_type) LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND NOT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_05_principal(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_media_authorize(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_draft_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_draft_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_review_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_review_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_category_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_category_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_audit_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_settings_get(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','huroof_pg_content_editor'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','huroof_pg_admin_sync'),
('public.eng03_05_principal(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_principal(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','huroof_pg_material_executor')) allowed(signature,role_name) WHERE allowed.signature=item.signature AND allowed.role_name=gr.rolname)) THEN RAISE EXCEPTION 'unexpected routine execute grant %',item.signature; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM (VALUES ('public.eng03_05_principal(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_media_authorize(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_room_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_draft_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_draft_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_review_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_review_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_category_get(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_category_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_audit_list(JSONB,JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_settings_get(JSONB)','huroof_pg_admin_reader'),
('public.eng03_05_registry_lookup(JSONB,TEXT)','huroof_pg_admin_reader'),
('public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA)','huroof_pg_content_editor'),
('public.eng03_05_revision_append(JSONB,JSONB,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_draft_archive(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_submit(JSONB,JSONB,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB)','huroof_pg_content_editor'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_editor'),
('public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT)','huroof_pg_content_reviewer'),
('public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_settings_update(JSONB,JSONB,JSONB)','huroof_pg_admin_registry'),
('public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT)','huroof_pg_admin_sync'),
('public.eng03_05_principal(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT)','huroof_pg_content_publisher'),
('public.eng03_05_profile_append(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_pointer_move(JSONB,JSONB,JSONB)','huroof_pg_content_publisher'),
('public.eng03_05_principal(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_rate_take(JSONB)','huroof_pg_material_executor'),
('public.eng03_05_snapshot_read(JSONB,TEXT,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_operation_get(JSONB,TEXT)','huroof_pg_material_executor'),
('public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB)','huroof_pg_material_executor')) allowed(signature,role_name) WHERE NOT pg_catalog.has_function_privilege(allowed.role_name,allowed.signature,'EXECUTE')) THEN RAISE EXCEPTION 'missing required routine execute grant'; END IF;
END $pro273_inherited_05$;
-- Retained accepted03 graph with the accepted04/06 edges and the one old read edge subtraction.
DO $pro273_inherited_03$
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
   ('HuroofSuccessorSetup','SELECT'),('HuroofSuccessorSetup','INSERT'),('HuroofRoom','SELECT')) AS a(name,priv) WHERE a.name=obj_record.relname AND a.priv=privilege) INTO allowed;
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
     SELECT checked_role='huroof_pg_service_executor' AND EXISTS(SELECT 1 FROM (VALUES ('ActiveCatalogPointer','SELECT'), ('Admission','SELECT'), ('CatalogReleaseSeal','SELECT'), ('CatalogValidationReceipt','SELECT'), ('DeploymentNamespace','SELECT'), ('FirebaseIdentity','SELECT'), ('HuroofCanonicalState','SELECT'), ('HuroofCommandReceipt','INSERT'), ('HuroofCommandReceipt','SELECT'), ('HuroofContentPointer','SELECT'), ('HuroofContentRevision','SELECT'), ('HuroofEvent','INSERT'), ('HuroofIdentityPolicyHead','SELECT'), ('HuroofIdentityPolicyRevision','SELECT'), ('HuroofLobbyRevision','INSERT'), ('HuroofLobbyRevision','SELECT'), ('HuroofLocator','INSERT'), ('HuroofLocator','SELECT'), ('HuroofMatch','SELECT'), ('HuroofMatchPin','SELECT'), ('HuroofMatchResult','INSERT'), ('HuroofMatchResult','SELECT'), ('HuroofMember','INSERT'), ('HuroofMember','SELECT'), ('HuroofOutboxDelivery','INSERT'), ('HuroofOwnerHistoryEntry','INSERT'), ('HuroofOwnerHistoryEntry','SELECT'), ('HuroofOwnerHistoryHead','INSERT'), ('HuroofOwnerHistoryHead','SELECT'), ('HuroofParticipant','INSERT'), ('HuroofParticipant','SELECT'), ('HuroofProjection','INSERT'), ('HuroofProjection','SELECT'), ('HuroofRawArtifact','INSERT'), ('HuroofRawArtifact','SELECT'), ('HuroofRealtimeOutbox','INSERT'), ('HuroofRematchLink','SELECT'), ('HuroofRoom','INSERT'), ('HuroofSuccessorSetup','SELECT'),('HuroofSuccessorSetup','INSERT'),('HuroofRoom','SELECT')) AS a(name,priv) WHERE a.name=obj_record.relname AND a.priv=column_privilege) INTO allowed;
     IF has_column_privilege(checked_role,obj_record.oid,privilege,column_privilege) AND NOT allowed THEN RAISE EXCEPTION 'unexpected protected column privilege: % % % %',checked_role,obj_record.relname,privilege,column_privilege; END IF;
     IF has_column_privilege(checked_role,obj_record.oid,privilege,column_privilege||' WITH GRANT OPTION') THEN RAISE EXCEPTION 'protected column grant option forbidden'; END IF;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=acl.grantee WHERE n.nspname='public' AND c.relname='HuroofLobbyRevision' AND acl.grantee<>c.relowner AND (acl.is_grantable OR gr.rolname IS NULL OR NOT ((gr.rolname='huroof_pg_service_executor' AND acl.privilege_type IN ('SELECT','INSERT')) OR (gr.rolname IN ('enta_finance_executor','huroof_pg_realtime_reader') AND acl.privilege_type='SELECT')))) THEN RAISE EXCEPTION 'unexpected lobby revision ACL'; END IF;
 FOR obj_record IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'eng03\_02\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\') LOOP
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor'] LOOP
   SELECT checked_role='huroof_pg_service_executor' AND obj_record.oid IN (pg_catalog.to_regprocedure('public.eng03_02_has_secret_key(JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.int5b_hash_json(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_canonical_json(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_valid_config(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_id(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_hash(JSONB)')::oid,pg_catalog.to_regprocedure('public.int5b_json_integer(JSONB,NUMERIC,NUMERIC)')::oid) INTO allowed;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE') AND NOT allowed THEN RAISE EXCEPTION 'unexpected protected helper execute: % %',checked_role,obj_record.proname; END IF;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'protected helper grant option forbidden'; END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles role_info ON role_info.oid=p.proowner WHERE n.nspname='public' AND ((role_info.rolname='huroof_pg_service_executor' AND p.oid NOT IN (pg_catalog.to_regprocedure('public.pro273_r1_definition_candidate(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_definition(TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_snapshot_root(BYTEA,TEXT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_nonaward(JSONB,JSONB,JSONB,JSONB,JSONB,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_verdict(JSONB,JSONB,JSONB,JSONB,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_game(JSONB,JSONB,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_semantic(JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_payload_bytes(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.pro273_r1_path(JSONB,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_policy_read(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_identity_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_locator_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_safe(JSONB,BOOLEAN)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_policy(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_06_successor_setup(JSONB,JSONB,JSONB)')::oid)) OR (role_info.rolname IN ('huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher') AND (p.proname LIKE 'eng03\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\')))) THEN RAISE EXCEPTION 'unexpected function ownership'; END IF;
 FOR obj_record IN SELECT p.oid,p.proname,p.proowner,p.proacl FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid IN (pg_catalog.to_regprocedure('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_policy_read(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_identity_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_locator_find(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_room(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_match_update_guard()')::oid,pg_catalog.to_regprocedure('public.eng03_03_match_transition_closure()')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_safe(JSONB,BOOLEAN)')::oid,pg_catalog.to_regprocedure('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_policy(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_custody(TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_history(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_insert_guard()')::oid,pg_catalog.to_regprocedure('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_profile(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_lock_members(TEXT,TEXT)')::oid,pg_catalog.to_regprocedure('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)')::oid) LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) acl LEFT JOIN pg_catalog.pg_roles gr ON gr.oid=acl.grantee WHERE acl.grantee<>obj_record.proowner AND (acl.is_grantable OR gr.rolname IS NULL OR NOT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner'),('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
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
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner'),('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_policy_read(TEXT)','huroof_pg_runtime'),
   
   ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','enta_finance_executor'),
   ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime')) AS a(signature,role_name) WHERE pg_catalog.to_regprocedure(a.signature)::oid=obj_record.oid AND a.role_name=gr.rolname))) THEN RAISE EXCEPTION 'unexpected function ACL: %',obj_record.proname; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor'] LOOP
   SELECT EXISTS(SELECT 1 FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','enta_finance_executor'),
   ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor'),
   ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner'),('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
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
   ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner'),('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_runtime'),
   ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','huroof_pg_runtime'),
   ('public.eng03_03_policy_read(TEXT)','huroof_pg_runtime'),
   
   ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','enta_finance_executor'),
   ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_runtime')) AS a(signature,role_name) WHERE pg_catalog.to_regprocedure(a.signature)::oid=obj_record.oid AND a.role_name=checked_role) OR pg_catalog.pg_get_userbyid(obj_record.proowner)=checked_role INTO allowed;
   IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE') AND NOT allowed THEN RAISE EXCEPTION 'unexpected inherited function execute: % %',checked_role,obj_record.proname; END IF;
   IF pg_catalog.pg_get_userbyid(obj_record.proowner)<>checked_role AND has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'function grant option forbidden'; END IF;
  END LOOP;
 END LOOP;
 -- Preserve only qualified pgcrypto PUBLIC defaults and exact accepted private digest edges.
 FOR obj_record IN SELECT proc_info.oid,proc_info.proowner,proc_info.proacl,proc_info.prosecdef,proc_info.prokind,extension_info.extowner FROM pg_catalog.pg_proc proc_info JOIN pg_catalog.pg_namespace namespace_info ON namespace_info.oid=proc_info.pronamespace LEFT JOIN pg_catalog.pg_depend dependency_info ON dependency_info.classid='pg_catalog.pg_proc'::regclass AND dependency_info.objid=proc_info.oid AND dependency_info.refclassid='pg_catalog.pg_extension'::regclass AND dependency_info.deptype='e' LEFT JOIN pg_catalog.pg_extension extension_info ON extension_info.oid=dependency_info.refobjid AND extension_info.extname='pgcrypto' AND extension_info.extnamespace=namespace_info.oid WHERE namespace_info.nspname='int4_crypto' LOOP
  IF obj_record.extowner IS NULL OR obj_record.proowner<>obj_record.extowner OR obj_record.prosecdef OR obj_record.prokind<>'f' THEN RAISE EXCEPTION 'unqualified crypto provider routine'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) acl_info LEFT JOIN pg_catalog.pg_roles grantee_info ON grantee_info.oid=acl_info.grantee WHERE acl_info.grantee<>obj_record.proowner AND (acl_info.is_grantable OR NOT (acl_info.grantee=0 OR (obj_record.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid AND grantee_info.rolname IN ('huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor','huroof_pg_realtime_reader'))))) THEN RAISE EXCEPTION 'unexpected private crypto ACL or grant option'; END IF;
  FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
   IF has_schema_privilege(checked_role,'int4_crypto','USAGE') AND has_function_privilege(checked_role,obj_record.oid,'EXECUTE') THEN
    IF has_function_privilege(checked_role,obj_record.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'crypto grant option forbidden'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(obj_record.proacl,pg_catalog.acldefault('f',obj_record.proowner))) public_acl WHERE public_acl.grantee=0 AND public_acl.privilege_type='EXECUTE' AND NOT public_acl.is_grantable) AND NOT (checked_role='huroof_pg_service_executor' AND obj_record.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid) THEN RAISE EXCEPTION 'crypto execute not from qualified PUBLIC baseline or exact digest edge'; END IF;
   END IF;
  END LOOP;
 END LOOP;
 FOREACH checked_role IN ARRAY ARRAY['huroof_pg_service_executor','huroof_pg_owner','huroof_pg_executor','enta_finance_executor','huroof_pg_realtime_reader'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc digest_info CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(digest_info.proacl,pg_catalog.acldefault('f',digest_info.proowner))) acl_info JOIN pg_catalog.pg_roles grantee_info ON grantee_info.oid=acl_info.grantee WHERE digest_info.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)')::oid AND grantee_info.rolname=checked_role AND acl_info.privilege_type='EXECUTE' AND NOT acl_info.is_grantable) THEN RAISE EXCEPTION 'required digest caller edge missing: %',checked_role; END IF;
 END LOOP;
END $pro273_inherited_03$;
DO $pro273_03_owners$
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
END $pro273_03_owners$;
-- Guarded 06 dependency graph: Source evidence only; its application refusal remains binding.
DO $pro273_successor_function_acl$
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
END $pro273_successor_function_acl$;
DO $pro273_successor_table_acl$
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
END $pro273_successor_table_acl$;
DO $pro273_successor_table_graph$
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
END $pro273_successor_table_graph$;
DO $pro273_successor_inheritance$
DECLARE actor TEXT;privileged TEXT;
BEGIN
 FOREACH actor IN ARRAY ARRAY['huroof_pg_runtime','enta_runtime','enta_gameplay_runtime','enta_outbox_worker','huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher'] LOOP
  FOREACH privileged IN ARRAY ARRAY['huroof_pg_owner','huroof_pg_service_executor','enta_finance_executor'] LOOP
   IF pg_catalog.pg_has_role(actor,privileged,'MEMBER') THEN RAISE EXCEPTION 'unexpected inherited successor authority: % -> %',actor,privileged;END IF;
  END LOOP;
  IF pg_catalog.has_schema_privilege(actor,'public','CREATE') OR pg_catalog.has_schema_privilege(actor,'int4_crypto','CREATE') THEN RAISE EXCEPTION 'unexpected successor schema CREATE: %',actor;END IF;
 END LOOP;
END $pro273_successor_inheritance$;
-- Graph candidate requires independent review; no installed ACL claim is made.
