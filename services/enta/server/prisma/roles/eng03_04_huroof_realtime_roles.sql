-- Source only. Provisioning requires separately authorized database operation.
BEGIN;
DO $guard$
DECLARE fn oid := pg_catalog.to_regprocedure('public.eng03_04_realtime_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)'); item record;
BEGIN
 IF fn IS NULL OR (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='eng03_04_realtime_read')<>1 THEN RAISE EXCEPTION 'unexpected realtime routine inventory'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=fn AND p.prokind='f' AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'unexpected realtime routine properties'; END IF;
 FOR item IN SELECT * FROM (VALUES ('public.int5b_hash_json(jsonb)'),('public.int5b_canonical_json(jsonb)')) h(signature) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc hp JOIN pg_catalog.pg_roles owner ON owner.oid=hp.proowner WHERE hp.oid=pg_catalog.to_regprocedure(item.signature) AND hp.prokind='f' AND hp.prorettype='text'::regtype AND hp.provolatile='i' AND NOT hp.prosecdef AND hp.proconfig=ARRAY['search_path=pg_catalog'] AND owner.rolname='enta_finance_executor') THEN RAISE EXCEPTION 'unqualified hash helper %',item.signature; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc hp JOIN pg_catalog.pg_namespace n ON n.oid=hp.pronamespace WHERE n.nspname='public' AND hp.proname=(SELECT proname FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature)) AND hp.oid<>pg_catalog.to_regprocedure(item.signature)) THEN RAISE EXCEPTION 'unexpected helper overload %',item.signature; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc hp JOIN pg_catalog.pg_namespace n ON n.oid=hp.pronamespace JOIN pg_catalog.pg_depend d ON d.classid='pg_catalog.pg_proc'::regclass AND d.objid=hp.oid AND d.refclassid='pg_catalog.pg_extension'::regclass AND d.deptype='e' JOIN pg_catalog.pg_extension e ON e.oid=d.refobjid WHERE hp.oid=pg_catalog.to_regprocedure('int4_crypto.digest(bytea,text)') AND n.nspname='int4_crypto' AND e.extname='pgcrypto' AND e.extnamespace=n.oid AND hp.proowner=e.extowner AND hp.prokind='f' AND hp.prorettype='bytea'::regtype AND NOT hp.prosecdef) THEN RAISE EXCEPTION 'unqualified digest provider'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_realtime_reader') THEN CREATE ROLE huroof_pg_realtime_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_realtime_reader' AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)) OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname='huroof_pg_realtime_reader') OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname='huroof_pg_realtime_reader') OR has_schema_privilege('huroof_pg_realtime_reader','public','CREATE') THEN RAISE EXCEPTION 'unsafe realtime reader'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='huroof_pg_runtime' AND (pg_has_role(r.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_realtime_reader'),'member') OR has_schema_privilege(r.oid,'public','CREATE'))) THEN RAISE EXCEPTION 'unsafe runtime membership'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname='huroof_pg_realtime_reader') THEN RAISE EXCEPTION 'reader owns table'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole WHERE r.rolname='huroof_pg_realtime_reader') THEN RAISE EXCEPTION 'reader default ACL forbidden'; END IF;
 FOR item IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') LOOP
  IF has_table_privilege('huroof_pg_realtime_reader',item.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,SELECT WITH GRANT OPTION') OR (has_table_privilege('huroof_pg_realtime_reader',item.oid,'SELECT') AND item.relname NOT IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult')) THEN RAISE EXCEPTION 'unexpected reader table privilege'; END IF;
 END LOOP;
END $guard$;
DO $effective_before$
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
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)'),('public.eng03_03_projection_read(text,text,text,bigint)')) required(signature) LOOP
  IF pg_catalog.to_regprocedure(obj.signature) IS NULL OR NOT has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE') OR has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'required runtime function edge missing: %',obj.signature; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND r.rolname='huroof_pg_runtime' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime direct or PUBLIC function edge mismatch: %',obj.signature; END IF;
 END LOOP;
 -- Preserve the accepted03 runtime graph and admit only the new04 edge after provisioning.
 FOR obj IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'eng03\_02\_%' ESCAPE '\' OR p.proname LIKE 'eng03\_03\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname='eng03_04_realtime_read') LOOP
  SELECT obj.oid IN (SELECT pg_catalog.to_regprocedure(signature)::oid FROM (VALUES
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)'),('public.eng03_03_projection_read(text,text,text,bigint)')) expected(signature)) OR (false AND obj.oid=fn) INTO allowed;
  IF has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE') IS DISTINCT FROM allowed OR has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'runtime function graph drift: %',obj.proname; END IF;
 END LOOP;
 IF false THEN
  IF has_schema_privilege('huroof_pg_realtime_reader','public','CREATE') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.oid=fn AND r.rolname='huroof_pg_realtime_reader' AND p.prokind='f' AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'final routine owner or properties invalid'; END IF;
  FOR obj IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult') LOOP
   IF NOT has_table_privilege('huroof_pg_realtime_reader',obj.oid,'SELECT') THEN RAISE EXCEPTION 'reader SELECT edge missing: %',obj.relname; END IF;
  END LOOP;
 END IF;
END $effective_before$;

GRANT USAGE ON SCHEMA public,int4_crypto TO huroof_pg_realtime_reader;
GRANT EXECUTE ON FUNCTION public.int5b_hash_json(JSONB),public.int5b_canonical_json(JSONB),int4_crypto.digest(BYTEA,TEXT) TO huroof_pg_realtime_reader;
GRANT SELECT ON public."DeploymentNamespace",public."FirebaseIdentity",public."HuroofIdentityPolicyHead",public."HuroofIdentityPolicyRevision",public."HuroofRoom",public."HuroofMember",public."HuroofLobbyRevision",public."HuroofCanonicalState",public."HuroofProjection",public."HuroofEvent",public."HuroofRealtimeOutbox",public."HuroofMatch",public."HuroofMatchResult" TO huroof_pg_realtime_reader;
GRANT CREATE ON SCHEMA public TO huroof_pg_realtime_reader;
ALTER FUNCTION public.eng03_04_realtime_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) OWNER TO huroof_pg_realtime_reader;
REVOKE CREATE ON SCHEMA public FROM huroof_pg_realtime_reader;
REVOKE ALL ON FUNCTION public.eng03_04_realtime_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eng03_04_realtime_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) TO huroof_pg_runtime;
DO $verify$
DECLARE fn oid := pg_catalog.to_regprocedure('public.eng03_04_realtime_read(text,text,text,text,text,bigint,text,text,bigint,bigint,bigint)');
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.aclexplode((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=fn)) a LEFT JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE a.grantee<>(SELECT proowner FROM pg_catalog.pg_proc WHERE oid=fn) AND (a.is_grantable OR r.rolname IS DISTINCT FROM 'huroof_pg_runtime')) THEN RAISE EXCEPTION 'unexpected realtime function ACL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.oid NOT IN (fn,pg_catalog.to_regprocedure('public.int5b_hash_json(jsonb)'),pg_catalog.to_regprocedure('public.int5b_canonical_json(jsonb)')) AND has_function_privilege('huroof_pg_realtime_reader',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'reader has unexpected public function execute'; END IF;
 IF NOT has_function_privilege('huroof_pg_runtime',fn,'EXECUTE') OR has_function_privilege('huroof_pg_runtime',fn,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'runtime execute mismatch'; END IF;
END $verify$;
DO $effective_after$
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
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)'),('public.eng03_03_projection_read(text,text,text,bigint)')) required(signature) LOOP
  IF pg_catalog.to_regprocedure(obj.signature) IS NULL OR NOT has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE') OR has_function_privilege('huroof_pg_runtime',pg_catalog.to_regprocedure(obj.signature),'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'required runtime function edge missing: %',obj.signature; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a JOIN pg_catalog.pg_roles r ON r.oid=a.grantee WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND r.rolname='huroof_pg_runtime' AND a.privilege_type='EXECUTE' AND NOT a.is_grantable) OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE p.oid=pg_catalog.to_regprocedure(obj.signature) AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'runtime direct or PUBLIC function edge mismatch: %',obj.signature; END IF;
 END LOOP;
 -- Preserve the accepted03 runtime graph and admit only the new04 edge after provisioning.
 FOR obj IN SELECT p.oid,p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'eng03\_02\_%' ESCAPE '\' OR p.proname LIKE 'eng03\_03\_%' ESCAPE '\' OR p.proname LIKE 'int4\_%' ESCAPE '\' OR p.proname LIKE 'int5a\_%' ESCAPE '\' OR p.proname LIKE 'int5b\_%' ESCAPE '\' OR p.proname='eng03_04_realtime_read') LOOP
  SELECT obj.oid IN (SELECT pg_catalog.to_regprocedure(signature)::oid FROM (VALUES
   ('public.eng03_03_policy_read(text)'),('public.eng03_03_identity_find(text,text)'),('public.eng03_03_locator_find(text,text)'),('public.eng03_03_setup_create(text,text,text,text,text,jsonb,jsonb)'),('public.eng03_03_content_load(text,text,text,bigint,text,text)'),('public.eng03_03_command_load(text,text,text,bigint,text)'),('public.eng03_03_command_commit(text,text,text,bigint,bigint,bigint,bigint,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'),('public.eng03_03_custody_policy(text)'),('public.eng03_03_create_identity(text,text,text,text)'),('public.eng03_03_find_create(text,text,text,jsonb)'),('public.eng03_03_paid_start(text,text,text,jsonb,jsonb,jsonb)'),('public.eng03_03_lobby_load(text,text,text,bigint)'),('public.eng03_03_find_paid(text,text,text,text,text,jsonb)'),('public.eng03_03_paid_identity(text,text,text,text,text)'),('public.eng03_03_lobby_receipt(text,text,text,text,jsonb)'),('public.eng03_03_lobby_join_prepare(text,text,text,bigint)'),('public.eng03_03_manual_identity(text,text,text,text)'),('public.eng03_03_lobby_commit(text,text,text,bigint,bigint,text,text,jsonb,jsonb)'),('public.eng03_03_projection_read(text,text,text,bigint)')) expected(signature)) OR (true AND obj.oid=fn) INTO allowed;
  IF has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE') IS DISTINCT FROM allowed OR has_function_privilege('huroof_pg_runtime',obj.oid,'EXECUTE WITH GRANT OPTION') THEN RAISE EXCEPTION 'runtime function graph drift: %',obj.proname; END IF;
 END LOOP;
 IF true THEN
  IF has_schema_privilege('huroof_pg_realtime_reader','public','CREATE') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE p.oid=fn AND r.rolname='huroof_pg_realtime_reader' AND p.prokind='f' AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'final routine owner or properties invalid'; END IF;
  FOR obj IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('DeploymentNamespace','FirebaseIdentity','HuroofIdentityPolicyHead','HuroofIdentityPolicyRevision','HuroofRoom','HuroofMember','HuroofLobbyRevision','HuroofCanonicalState','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofMatch','HuroofMatchResult') LOOP
   IF NOT has_table_privilege('huroof_pg_realtime_reader',obj.oid,'SELECT') THEN RAISE EXCEPTION 'reader SELECT edge missing: %',obj.relname; END IF;
  END LOOP;
 END IF;
END $effective_after$;
DO $crypto_graph$
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
END $crypto_graph$;


COMMIT;
