-- INCOMPLETE ROLE SOURCE. The exact effective grant, ownership, default ACL,
-- overload and transitive SET ROLE audit is still required. No installation
-- or principal assignment is authorized under R6 STOP.
DO $$ BEGIN RAISE EXCEPTION 'PRO273_SEL_ROLE_CLOSURE_INCOMPLETE'; END $$;

-- PRO273-SEL immutable installer lock-removal candidates (Source inventory,
-- not an installed privilege-closure assertion). Each row has an UPDATE /
-- DELETE denial trigger in the named migration; its listed key is the lookup
-- identity. Supplier definitions are evidence only, never altered here.
-- selection migration / pro273_sel_immutable:
-- INITIAL Source-only inventory: Pro273InitialLayoutPublication (inputClaimId;
-- baselineId, baselineCoreHash, inputClaimId unique),
-- Pro273InitialBaselineLayoutBinding (baselineId, baselineCoreHash,
-- layoutInputClaimId; baseline pair unique), Pro273InitialAllocationPublication
-- (inputClaimId). Each has ordinary row BEFORE INSERT block_insert and BEFORE
-- UPDATE OR DELETE immutable triggers; both trigger functions are plpgsql
-- SECURITY DEFINER, search_path=pg_catalog, owned by pro262_capacity_owner.
-- block_insert stamps constructionTransactionId with pg_current_xact_id() then
-- unconditionally raises SELECTION_UNAVAILABLE; immutable only raises it.
-- pro273_initial_verify_committed_layout(TEXT) and
-- pro273_initial_verify_committed_allocation(TEXT) are fixed, private historical
-- candidates owned by pro262_capacity_owner; their entries unconditionally deny.
-- Its joins and hashes are Source evidence only, not installed authorization.
-- Owner/SET ROLE, other definer mutations, trigger disable/replace, replication,
-- creator authority, complete ACL and referenced-key/wait qualification remain
-- unproved; these objects confer no publication or installation authority.
-- Pro273ControlPlaneInstallerExpectation: expectationId; bootstrapKind unique
-- Pro273InstallerProcessObservation: expectationId, credentialEpoch, launchEpoch
-- Pro273InstallerSlotBinding: reservationId
-- Pro273InstallerSessionClaim: sessionClaimId; expectationId unique
-- Pro273InstallerDispatchAttempt: attemptId; expectationId unique
-- Pro273InstallerDelivery: attemptId; expectationId unique
-- supplier migration / pro262_capacity_immutable:
-- Pro262CapacityBootstrapBaseline: kind
-- Pro262CapacityBootstrapTrust: trustId, generation
-- Pro262CapacityObserverInputReservation: reservationId
-- Pro262CapacityObserverInputClaim: inputClaimId; reservationId unique
-- Pro262CapacityControlCharge: kind, eventKey
-- Source lock removal requires reviewed Source closure covering the candidate
-- relation, keys, immutable enforcement and all mutation paths. Installation
-- and use separately require independent installed evidence. Before installation,
-- an audit must establish
-- exact relation and trigger-function owners; enabled immutable triggers and
-- exact key constraints; table and column ACLs including PUBLIC, TRUNCATE and
-- TRIGGER; default ACLs and schema CREATE; transitive owner membership and SET
-- ROLE paths; and every callable SECURITY DEFINER mutation path, including
-- dynamic SQL, overloads and trigger disabling/replacement. A source inventory
-- cannot establish those installed properties. Until an executable audit and
-- independent installed evidence exist, this separate audit gate always denies.
-- Source trace (not closure): pro262_capacity_supplier_roles.sql enumerates
-- the exact routine signatures and proposed grantees. In particular,
-- pro262_capacity_control_prepare(text,text,jsonb) is granted to
-- pro262_control_allocator and calls the owner-private
-- pro262_capacity_control_charge(text,text,text), which inserts charge rows.
-- pro262_capacity_provision_observer_input(jsonb) is granted to
-- pro262_qualification_publisher; pro262_capacity_claim_observer_input
-- (text,text,text) is granted to pro262_control_allocator. Both insert their
-- respective immutable rows and are replaced by the selection migration.
-- The supplier role script also uses dynamic ALTER/REVOKE against its explicit
-- signature and relation inventories. These proposed direct edges do not prove
-- final effective privileges, other-owner call chains, or installed bodies.
DO $$ BEGIN RAISE EXCEPTION 'PRO273_SEL_IMMUTABLE_INSTALLER_AUDIT_INCOMPLETE'; END $$;

-- Conservative audit candidate only. The unconditional gates above remain in
-- force: passing these catalog checks would not prove function bodies, dynamic
-- SQL, extension code, key constraints, or installed authority. No privilege
-- is granted or revoked by this block. Independent review must resolve those
-- paths and the deliberately strict ownership/ACL expectations before use.
DO $$
DECLARE
 v_owner OID := pg_catalog.to_regrole('pro262_capacity_owner');
 v_relation OID; v_trigger_function OID; v_name TEXT; v_function TEXT;
 v_key_type "char"; v_key_columns TEXT[];
 v_signature TEXT; v_grantee_name TEXT; v_return_type TEXT; v_body_sha256 TEXT;
 v_entry OID; v_grantee OID;
 v_dependency_owner OID; v_reader OID; v_stats OID; v_dependency_owner_name TEXT;
 v_huroof_owner OID := pg_catalog.to_regrole('huroof_pg_owner');
 -- Independent approval must supply the exact outgoing membership rows; an
 -- empty set is not inferred from the role name or its current attributes.
 v_huroof_owner_memberships JSONB := NULL;
 -- No independently approved public-schema owner was supplied in this Source
 -- packet. Do not infer it from the capacity owner or the current catalog.
 v_approved_schema_owner OID := NULL;
 -- Historical creation and ownership require independent evidence; neither
 -- current catalog ownership nor session identity establishes these facts.
 v_approved_installation_executor OID := NULL;
 v_authorized_creators OID[] := NULL;
 v_creation_ownership_transitions_proven BOOLEAN := FALSE;
 -- Independently specified complete catalog principal partition and membership
 -- snapshot, not derived from the catalog being audited. Trusted administrators
 -- and provisioners can assume ownership or change grants outside this audit;
 -- their identities and controls require separate evidence, never superuser
 -- status alone. The snapshot includes every pg_auth_members column, including
 -- version-specific inheritance / SET ROLE options.
 v_runtime_principals OID[] := NULL;
 v_trusted_admin_principals OID[] := NULL;
 v_expected_memberships JSONB := NULL;
 v_trusted_admin_boundary_proven BOOLEAN := FALSE;
 v_set_role_and_owner_assumptions_proven BOOLEAN := FALSE;
BEGIN
 IF v_owner IS NULL THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_OWNER_MISSING'; END IF;
 FOR v_name, v_function IN SELECT * FROM (VALUES
  ('Pro273PublisherTrustProvenance','pro273_sel_immutable'),
  ('Pro273BaselineTrustProvenance','pro273_sel_immutable'),
  ('Pro273ControlPlaneInstallerExpectation','pro273_sel_immutable'),
  ('Pro273InstallerProcessObservation','pro273_sel_immutable'),
  ('Pro273InstallerSlotBinding','pro273_sel_immutable'),
  ('Pro273InstallerSessionClaim','pro273_sel_immutable'),
  ('Pro273InstallerDispatchAttempt','pro273_sel_immutable'),
  ('Pro273InstallerDelivery','pro273_sel_immutable'),
  ('Pro262CapacityBootstrapBaseline','pro262_capacity_immutable'),
  ('Pro262CapacityBootstrapTrust','pro262_capacity_immutable'),
  ('Pro262CapacityObserverInputReservation','pro262_capacity_immutable'),
  ('Pro262CapacityObserverInputClaim','pro262_capacity_immutable'),
  ('Pro262CapacityControlCharge','pro262_capacity_immutable')
 ) AS candidates(relation_name, function_name) LOOP
  v_relation := pg_catalog.to_regclass(pg_catalog.format('public.%I',v_name));
  v_trigger_function := pg_catalog.to_regprocedure(pg_catalog.format('public.%I()',v_function));
  IF v_relation IS NULL OR v_trigger_function IS NULL OR NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_proc p ON p.oid=v_trigger_function
   WHERE c.oid=v_relation AND c.relkind='r' AND c.relowner=v_owner AND p.proowner=v_owner
    AND p.prorettype='pg_catalog.trigger'::pg_catalog.regtype
  ) THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_OBJECT_OWNER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=v_relation
   AND t.tgname=v_name||'_immutable' AND NOT t.tgisinternal AND t.tgfoid=v_trigger_function
   AND t.tgtype=27 AND t.tgenabled='O' AND t.tgqual IS NULL)
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRIGGER'; END IF;
  -- Exact function source and execution context, not merely its name. Any
  -- alternate spelling, owner, configuration, language or body fails closed.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=v_trigger_function AND l.lanname='plpgsql' AND p.prosecdef
    AND p.proconfig=ARRAY['search_path=pg_catalog']::TEXT[]
    AND p.prosrc=CASE v_function
     WHEN 'pro273_sel_immutable' THEN E'\nBEGIN\n  RAISE EXCEPTION ''SELECTION_UNAVAILABLE'';\nEND '
     WHEN 'pro262_capacity_immutable' THEN E'\nBEGIN RAISE EXCEPTION ''CAPACITY_IMMUTABLE''; END '
     ELSE NULL END)
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRIGGER_BODY'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
   LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
   WHERE c.oid=v_relation AND a.grantee<>v_owner
    AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER'))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col,
    LATERAL pg_catalog.aclexplode(col.attacl) a WHERE col.attrelid=v_relation
    AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>v_owner
    AND a.privilege_type IN ('INSERT','UPDATE'))
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_RELATION_ACL'; END IF;
  IF v_name IN ('Pro273PublisherTrustProvenance','Pro273BaselineTrustProvenance') AND (
   EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
    LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
    WHERE c.oid=v_relation AND a.grantee<>v_owner)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col,
    LATERAL pg_catalog.aclexplode(col.attacl) a WHERE col.attrelid=v_relation
    AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>v_owner))
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_PROVENANCE_PRIVATE_ACL'; END IF;
  IF v_name IN ('Pro273PublisherTrustProvenance','Pro273BaselineTrustProvenance') AND NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=v_relation
    AND t.tgname=v_name||'_block_insert' AND NOT t.tgisinternal AND t.tgfoid=v_trigger_function
    AND t.tgtype=7 AND t.tgenabled='O' AND t.tgqual IS NULL)
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRIGGER'; END IF;
 END LOOP;
 -- Coverage is immutable under this guard; spent and enabled may change.
 -- This audit remains denied below and does not establish privileged closure.
 v_relation:=pg_catalog.to_regclass('public."Pro262CapacityControlBaseline"');
 v_trigger_function:=pg_catalog.to_regprocedure('public.pro262_capacity_control_baseline_guard()');
 IF v_relation IS NULL OR v_trigger_function IS NULL OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_proc p ON p.oid=v_trigger_function
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_trigger t ON t.tgrelid=c.oid
  WHERE c.oid=v_relation AND c.relkind='r' AND c.relowner=v_owner AND p.proowner=v_owner
   AND p.prorettype='pg_catalog.trigger'::pg_catalog.regtype AND l.lanname='plpgsql' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=pg_catalog']::TEXT[]
   AND p.prosrc=E'\nBEGIN\n IF TG_OP=''DELETE'' OR (pg_catalog.to_jsonb(NEW)-''spent''-''enabled'') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-''spent''-''enabled'') OR\n    NEW."spent"<OLD."spent" OR (NOT OLD."enabled" AND NEW."enabled") OR\n    (NEW."spent"=OLD."spent" AND NEW."enabled"=OLD."enabled") THEN RAISE EXCEPTION ''CAPACITY_IMMUTABLE''; END IF;\n RETURN NEW;\nEND '
   AND t.tgname='Pro262CapacityControlBaseline_guard' AND NOT t.tgisinternal AND t.tgfoid=v_trigger_function
   AND t.tgtype=27 AND t.tgenabled='O' AND t.tgqual IS NULL)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
   WHERE c.oid=v_relation AND a.grantee<>v_owner AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER'))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col, LATERAL pg_catalog.aclexplode(col.attacl) a
   WHERE col.attrelid=v_relation AND col.attnum>0 AND NOT col.attisdropped AND a.grantee<>v_owner AND a.privilege_type IN ('INSERT','UPDATE'))
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_BASELINE_GUARD'; END IF;
 -- Lookup keys used by the candidate lock sites. A matching constraint must
 -- have a valid, ready, immediate unique index and exactly these ordered columns.
 FOR v_name,v_key_type,v_key_columns IN SELECT * FROM (VALUES
  ('Pro273PublisherTrustProvenance','p'::"char",ARRAY['trustId','generation']),
  ('Pro273BaselineTrustProvenance','p'::"char",ARRAY['trustId','generation']),
  ('Pro273ControlPlaneInstallerExpectation','p'::"char",ARRAY['expectationId']),
  ('Pro273ControlPlaneInstallerExpectation','u'::"char",ARRAY['bootstrapKind']),
  ('Pro273InstallerProcessObservation','p'::"char",ARRAY['expectationId','credentialEpoch','launchEpoch']),
  ('Pro273InstallerSlotBinding','p'::"char",ARRAY['reservationId']),
  ('Pro273InstallerSessionClaim','p'::"char",ARRAY['sessionClaimId']),
  ('Pro273InstallerSessionClaim','u'::"char",ARRAY['expectationId']),
  ('Pro273InstallerDispatchAttempt','p'::"char",ARRAY['attemptId']),
  ('Pro273InstallerDispatchAttempt','u'::"char",ARRAY['expectationId']),
  ('Pro273InstallerDelivery','p'::"char",ARRAY['attemptId']),
  ('Pro273InstallerDelivery','u'::"char",ARRAY['expectationId']),
  ('Pro262CapacityBootstrapBaseline','p'::"char",ARRAY['kind']),
  ('Pro262CapacityBootstrapTrust','p'::"char",ARRAY['trustId','generation']),
  ('Pro262CapacityObserverInputReservation','p'::"char",ARRAY['reservationId']),
  ('Pro262CapacityObserverInputClaim','p'::"char",ARRAY['inputClaimId']),
  ('Pro262CapacityObserverInputClaim','u'::"char",ARRAY['reservationId']),
  ('Pro262CapacityControlBaseline','p'::"char",ARRAY['kind']),
  ('Pro262CapacityControlCharge','p'::"char",ARRAY['kind','eventKey'])
 ) AS keys(relation_name,key_type,key_columns) LOOP
  v_relation:=pg_catalog.to_regclass(pg_catalog.format('public.%I',v_name));
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_index i ON i.indexrelid=c.conindid
   WHERE c.conrelid=v_relation AND c.contype=v_key_type AND c.convalidated AND NOT c.condeferrable
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL
    AND (SELECT pg_catalog.array_agg(a.attname::TEXT ORDER BY k.ordinality)
     FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY AS k(attnum,ordinality)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum AND NOT a.attisdropped)=v_key_columns)
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_LOOKUP_KEY'; END IF;
 END LOOP;
 -- Source creates ordinary triggers. They do not protect replica-mode
 -- sessions; catalog agreement therefore cannot authorize lock removal.
 RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRIGGER_REPLICATION_BYPASS_UNRESOLVED';
 -- Key checks do not establish exact FK targets/actions or complete writers.
 RAISE EXCEPTION 'PRO273_SEL_AUDIT_PROVENANCE_FK_WRITER_UNPROVEN';
 -- Every membership edge is treated as potentially usable by SET ROLE,
 -- including NOINHERIT and indirect paths, independent of server version.
 IF EXISTS (WITH RECURSIVE member_path(member,roleid) AS (
  SELECT m.member,m.roleid FROM pg_catalog.pg_auth_members m
  UNION SELECT p.member,m.roleid FROM member_path p JOIN pg_catalog.pg_auth_members m ON m.member=p.roleid
 ) SELECT 1 FROM member_path WHERE roleid=v_owner AND member<>v_owner)
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_OWNER_MEMBERSHIP'; END IF;
 IF v_approved_schema_owner IS NULL THEN
  RAISE EXCEPTION 'PRO273_SEL_AUDIT_SCHEMA_OWNER_APPROVAL_REQUIRED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname='public' AND n.nspowner=v_approved_schema_owner)
  OR EXISTS (WITH RECURSIVE member_path(member,roleid) AS (
   SELECT m.member,m.roleid FROM pg_catalog.pg_auth_members m
   UNION SELECT p.member,m.roleid FROM member_path p JOIN pg_catalog.pg_auth_members m ON m.member=p.roleid
  ) SELECT 1 FROM member_path WHERE roleid=v_approved_schema_owner AND member<>v_approved_schema_owner)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
  LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
  WHERE n.nspname='public' AND a.grantee<>v_approved_schema_owner AND a.privilege_type='CREATE')
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_SCHEMA_CREATE'; END IF;
 -- The exact complete creator set, executor and per-object ownership
 -- transitions are unknown and require independent evidence before use.
 IF v_approved_installation_executor IS NULL OR v_authorized_creators IS NULL
  OR pg_catalog.cardinality(v_authorized_creators)=0
  OR pg_catalog.array_position(v_authorized_creators,NULL) IS NOT NULL
  OR v_creation_ownership_transitions_proven IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_CREATION_HISTORY_UNPROVEN'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d
  LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace,
  LATERAL pg_catalog.aclexplode(d.defaclacl) a
  WHERE d.defaclrole=ANY(v_authorized_creators)
   AND d.defaclobjtype IN ('r','f') AND (d.defaclnamespace=0 OR n.nspname='public')
   AND a.grantee<>d.defaclrole AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','EXECUTE'))
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_DEFAULT_ACL'; END IF;
 -- Missing global function defaults imply PUBLIC EXECUTE for each exact
 -- authorized creator; schema-specific explicit defaults are checked above.
 IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_authorized_creators) AS creator(oid)
  LEFT JOIN pg_catalog.pg_default_acl d ON d.defaclrole=creator.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f',
  LATERAL pg_catalog.aclexplode(COALESCE(d.defaclacl,pg_catalog.acldefault('f',creator.oid))) a
  WHERE a.grantee<>creator.oid AND a.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_IMPLICIT_FUNCTION_PUBLIC_EXECUTE'; END IF;
 -- Unknown login, administrator, capability, or membership evidence denies.
 -- All catalog roles are partitioned so an unlisted NOLOGIN intermediary
 -- cannot acquire a capability via SET ROLE. Membership options are compared
 -- as complete catalog rows; independent evidence must also establish what
 -- SET ROLE / owner assumption and privileged provisioners can do.
 IF v_runtime_principals IS NULL OR v_trusted_admin_principals IS NULL
  OR v_expected_memberships IS NULL OR pg_catalog.jsonb_typeof(v_expected_memberships) IS DISTINCT FROM 'array'
  OR pg_catalog.array_position(v_runtime_principals,NULL) IS NOT NULL
  OR pg_catalog.array_position(v_trusted_admin_principals,NULL) IS NOT NULL
  OR v_trusted_admin_boundary_proven IS DISTINCT FROM TRUE
  OR v_set_role_and_owner_assumptions_proven IS DISTINCT FROM TRUE
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_PRINCIPAL_CONTRACT_UNPROVEN'; END IF;
 IF v_owner=ANY(v_runtime_principals) OR v_owner=ANY(v_trusted_admin_principals)
  OR v_runtime_principals && v_trusted_admin_principals
  OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_runtime_principals || v_trusted_admin_principals) x(oid)
   WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=x.oid))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid<>v_owner
   AND NOT (r.oid=ANY(v_runtime_principals) OR r.oid=ANY(v_trusted_admin_principals)))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(v_runtime_principals) AND r.rolsuper)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_owner AND (r.rolcanlogin OR r.rolsuper))
  OR (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.member,m.roleid,m.grantor),'[]'::JSONB)
   FROM pg_catalog.pg_auth_members m) IS DISTINCT FROM v_expected_memberships
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_PRINCIPAL_CONTRACT_MISMATCH'; END IF;
 -- Conditional Source-reviewed edges only, pinned to the FINAL migration body.
 -- SHA-256 is over the exact UTF-8 prosrc bytes, including whitespace. This
 -- inventory is not authority to grant execution or evidence of installation.
 FOR v_signature,v_grantee_name,v_return_type,v_body_sha256 IN SELECT * FROM (VALUES
  ('public.pro262_capacity_control_prepare(text,text,jsonb)','pro262_control_allocator','void','a9d2eb9cf402482527ed696870990555a1277d2faed5a54002dc71afc9a0b5f5'),
  ('public.pro262_capacity_provision_observer_input(jsonb)','pro262_qualification_publisher','text','d216c03efd88b071047fc30ebbd0ceebf4320f4d24b2f1292072cfb154a4ef5f'),
  ('public.pro262_capacity_claim_observer_input(text,text,text)','pro262_control_allocator','jsonb','0de28ea45ecb8448b309e41fdb7fe3f93a6b04a6c25f5c34f994ec566c42ef2a'),
  ('public.pro273_installer_accept_process_observation(text,text,jsonb,bytea)','pro262_install_observer','text','7cb74b687eae14fb92710eb7cf19376d2055faa3e3a87ef59f4d0016697ea648')
 ) AS edges(signature,grantee_name,return_type,body_sha256) LOOP
  v_entry:=pg_catalog.to_regprocedure(v_signature); v_grantee:=pg_catalog.to_regrole(v_grantee_name);
  IF v_entry IS NULL OR v_grantee IS NULL OR NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=v_entry AND p.proowner=v_owner AND p.prokind='f' AND p.prosecdef
    AND l.lanname='plpgsql' AND p.prorettype=pg_catalog.to_regtype(v_return_type)
    AND NOT p.proretset AND NOT p.proisstrict AND p.provolatile='v'
    AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0 AND p.proargmodes IS NULL
    AND p.proconfig=ARRAY['search_path=pg_catalog']::TEXT[]
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=v_body_sha256
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_proc expected ON expected.oid=v_entry
   WHERE p.pronamespace=expected.pronamespace AND p.proname=expected.proname AND p.oid<>v_entry)
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_WRITER_DEFINITION'; END IF;
  -- Require the owner-issued direct grant; deny PUBLIC, other grantees and
  -- grant options, even when effective privileges happen to look equivalent.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
   LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   WHERE p.oid=v_entry AND a.grantee=v_grantee AND a.grantor=v_owner
    AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid=v_entry AND a.privilege_type='EXECUTE' AND a.grantee<>v_owner
     AND (a.grantee<>v_grantee OR a.grantor<>v_owner OR a.is_grantable))
   OR NOT (v_grantee=ANY(v_runtime_principals))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_grantee AND (r.rolcanlogin OR r.rolsuper))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(v_runtime_principals)
    AND pg_catalog.has_function_privilege(r.oid,v_entry,'EXECUTE') IS DISTINCT FROM pg_catalog.pg_has_role(r.oid,v_grantee,'USAGE'))
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_WRITER_EXECUTE'; END IF;
 END LOOP;
 -- Other owner-definer external edges are not established by this partial
 -- inventory. Unknown owners, overloads, caller paths and extension effects
 -- cannot be inferred safe from a scan of these four entries.
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
  LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
  WHERE p.proowner=v_owner AND p.prosecdef AND a.grantee<>v_owner AND a.privilege_type='EXECUTE'
   AND NOT ((p.oid=pg_catalog.to_regprocedure('public.pro262_capacity_control_prepare(text,text,jsonb)') AND a.grantee=pg_catalog.to_regrole('pro262_control_allocator'))
    OR (p.oid=pg_catalog.to_regprocedure('public.pro262_capacity_provision_observer_input(jsonb)') AND a.grantee=pg_catalog.to_regrole('pro262_qualification_publisher'))
    OR (p.oid=pg_catalog.to_regprocedure('public.pro262_capacity_claim_observer_input(text,text,text)') AND a.grantee=pg_catalog.to_regrole('pro262_control_allocator'))
    OR (p.oid=pg_catalog.to_regprocedure('public.pro273_installer_accept_process_observation(text,text,jsonb,bytea)') AND a.grantee=pg_catalog.to_regrole('pro262_install_observer'))) IS TRUE)
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_DEFINER_PATH'; END IF;
 -- Pin the Source-reviewed private definer bodies as well. No non-owner
 -- effective execution is accepted for these helpers.
 FOR v_signature,v_return_type,v_body_sha256 IN SELECT * FROM (VALUES
  ('public.pro262_capacity_control_charge(text,text,text)','void','e593b816b4d0158053d2d39a32eb415386f480203b7e6d701c190e983faa9b37'),
  ('public.pro273_installer_slot_matches(text)','boolean','6d2e88ab5db2e8594a8411f84af997123c1e4454a5b5210d838a56d31e925ce9'),
  ('public.pro262_capacity_assert_observer_claim(text,text,text,numeric)','void','d57c10097b224e336e615e7d833426ef0daffe88108a368c8a5f4c3c24e60e5a')
 ) AS private_helpers(signature,return_type,body_sha256) LOOP
  v_entry:=pg_catalog.to_regprocedure(v_signature);
  IF v_entry IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=v_entry AND p.proowner=v_owner AND p.prokind='f' AND p.prosecdef AND l.lanname='plpgsql'
    AND p.prorettype=pg_catalog.to_regtype(v_return_type) AND p.proconfig=ARRAY['search_path=pg_catalog']::TEXT[]
    AND NOT p.proretset AND NOT p.proisstrict AND p.provolatile='v'
    AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0 AND p.proargmodes IS NULL
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=v_body_sha256)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_proc expected ON expected.oid=v_entry
    WHERE p.pronamespace=expected.pronamespace AND p.proname=expected.proname AND p.oid<>v_entry)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid=v_entry AND a.privilege_type='EXECUTE' AND a.grantee<>v_owner)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(v_runtime_principals)
    AND pg_catalog.has_function_privilege(r.oid,v_entry,'EXECUTE'))
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_PRIVATE_HELPER'; END IF;
 END LOOP;
 -- Exact Source dependency chain; this neither grants access nor establishes
 -- installation provenance. The complete principal contract above is required.
 FOR v_signature,v_dependency_owner_name,v_grantee_name,v_return_type,v_body_sha256 IN SELECT * FROM (VALUES
  ('public.pro262_capacity_backend_start()','huroof_pg_owner','pro262_capacity_owner','timestamptz','127acd8ba0977b58fb35719ebdae9c5fb4f06f2be2386d53a95a8cd2b4b0013e'),
  ('public.pro262_capacity_backend_live(name,integer,timestamptz)','huroof_pg_owner','pro262_capacity_owner','boolean','952ae5626db298cbfbfc37830d8a89964431199bb21ad7073e29f8e7fb3090c8'),
  ('public.pro311_own_backend_start()','pro311_activity_reader','huroof_pg_owner','timestamptz','1aa63d99f1a5058c42ad8cf0936c5ea3bd9e9edce38997d7c11f6c90e27c247f'),
  ('public.pro311_backend_is_live(name,integer,timestamptz)','pro311_activity_reader','huroof_pg_owner','boolean','d6d5c8a3ce9b9c4eafc8d4ec286260c1ac47d51d3347dcd9664c06a58eebb135')
 ) AS dependencies(signature,owner_name,grantee_name,return_type,body_sha256) LOOP
  v_entry:=pg_catalog.to_regprocedure(v_signature);
  v_dependency_owner:=pg_catalog.to_regrole(v_dependency_owner_name);
  v_grantee:=pg_catalog.to_regrole(v_grantee_name);
  IF v_entry IS NULL OR v_dependency_owner IS NULL OR v_grantee IS NULL OR NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
   WHERE p.oid=v_entry AND p.proowner=v_dependency_owner AND p.prokind='f' AND p.prosecdef
    AND l.lanname='sql' AND p.prorettype=pg_catalog.to_regtype(v_return_type)
    AND NOT p.proretset AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
    AND p.proargnames IS NOT DISTINCT FROM CASE WHEN v_signature IN
     ('public.pro262_capacity_backend_live(name,integer,timestamptz)','public.pro311_backend_is_live(name,integer,timestamptz)')
     THEN ARRAY['p_principal','p_pid','p_started']::TEXT[] ELSE NULL::TEXT[] END
    AND p.pronargdefaults=0 AND p.proargdefaults IS NULL AND p.provariadic=0 AND p.proargmodes IS NULL
    AND p.proconfig=ARRAY['search_path=pg_catalog']::TEXT[]
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=v_body_sha256)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_proc expected ON expected.oid=v_entry
    WHERE p.pronamespace=expected.pronamespace AND p.proname=expected.proname AND p.oid<>v_entry)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::pg_catalog.regclass
    AND d.objid=v_entry AND d.refclassid='pg_catalog.pg_extension'::pg_catalog.regclass AND d.deptype='e')
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_BACKEND_DEPENDENCY_DEFINITION'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
   LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
   WHERE p.oid=v_entry AND a.grantee=v_grantee AND a.grantor=v_dependency_owner
    AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p,
    LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    WHERE p.oid=v_entry AND a.privilege_type='EXECUTE' AND a.grantee<>v_dependency_owner
     AND (a.grantee<>v_grantee OR a.grantor<>v_dependency_owner OR a.is_grantable))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(v_runtime_principals)
    AND pg_catalog.has_function_privilege(r.oid,v_entry,'EXECUTE') IS DISTINCT FROM
     (pg_catalog.pg_has_role(r.oid,v_dependency_owner,'USAGE') OR pg_catalog.pg_has_role(r.oid,v_grantee,'USAGE')))
  THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_BACKEND_DEPENDENCY_EXECUTE'; END IF;
 END LOOP;
 -- Source requires this owner to be a non-login, unprivileged NOINHERIT role
 -- and forbids other roles from assuming it. Outgoing membership remains an
 -- independently approved exact contract, not an inference from the catalog.
 IF v_huroof_owner IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
  WHERE r.oid=v_huroof_owner AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls))
  OR EXISTS (WITH RECURSIVE member_path(member,roleid) AS (
   SELECT m.member,m.roleid FROM pg_catalog.pg_auth_members m
   UNION SELECT p.member,m.roleid FROM member_path p JOIN pg_catalog.pg_auth_members m ON m.member=p.roleid
  ) SELECT 1 FROM member_path WHERE roleid=v_huroof_owner AND member<>v_huroof_owner)
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_HUROOF_OWNER_UNSAFE'; END IF;
 IF v_huroof_owner_memberships IS NULL OR pg_catalog.jsonb_typeof(v_huroof_owner_memberships) IS DISTINCT FROM 'array'
  OR (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.member,m.roleid,m.grantor),'[]'::JSONB)
   FROM pg_catalog.pg_auth_members m WHERE m.member=v_huroof_owner) IS DISTINCT FROM v_huroof_owner_memberships
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_HUROOF_OWNER_MEMBERSHIP_UNPROVEN'; END IF;
 -- The reader may inherit only the stats capability, with no SET or ADMIN
 -- option, and no principal may assume it. Its two pinned bodies expose only
 -- the caller's backend start and an exact principal/pid/start boolean.
 v_reader:=pg_catalog.to_regrole('pro311_activity_reader'); v_stats:=pg_catalog.to_regrole('pg_read_all_stats');
 IF v_reader IS NULL OR v_stats IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
  WHERE r.oid=v_reader AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls))
  OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=v_reader AND m.roleid=v_stats
   AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=v_reader AND m.roleid=v_stats
   AND (m.admin_option OR m.set_option OR NOT m.inherit_option))
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=v_reader AND m.roleid<>v_stats)
  OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=v_stats)
  OR EXISTS (WITH RECURSIVE member_path(member,roleid) AS (
   SELECT m.member,m.roleid FROM pg_catalog.pg_auth_members m
   UNION SELECT p.member,m.roleid FROM member_path p JOIN pg_catalog.pg_auth_members m ON m.member=p.roleid
  ) SELECT 1 FROM member_path WHERE roleid=v_reader AND member<>v_reader)
  OR NOT pg_catalog.pg_has_role(v_reader,v_stats,'USAGE')
 THEN RAISE EXCEPTION 'PRO273_SEL_AUDIT_ACTIVITY_VISIBILITY'; END IF;
 -- Private effects are not additional executable grants: prepare calls
 -- pro262_capacity_control_charge(text,text,text), inserting ControlCharge and
 -- updating ControlBaseline spent. Provision atomically inserts reservation and
 -- installer slot binding; claim inserts a claim with idempotency/currentness;
 -- observation checks claim/session/prepayment before inserting observation.
 -- The paths also call pro273_installer_slot_matches(text), the final replacement
 -- pro262_capacity_assert_observer_claim(text,text,text,numeric), backend identity
 -- and liveness helpers, and native/extension code. Source records the latter
 -- SQL SECURITY DEFINER wrappers as huroof_pg_owner functions with search_path
 -- pg_catalog, non-STRICT, VOLATILE, scalar returns and no defaults:
 -- pro262_capacity_backend_start() returns timestamptz, body
 -- ` SELECT public.pro311_own_backend_start() `;
 -- pro262_capacity_backend_live(name,integer,timestamptz) returns boolean, body
 -- ` SELECT public.pro311_backend_is_live(p_principal,p_pid,p_started) `.
 -- The pinned dependency chain is conditional Source evidence only; final
 -- provenance, installed authority and the wider effects remain unproved.
 -- Trigger/rule, other-owner,
 -- dynamic dispatch and complete transitive effect identities remain unproved.
 -- No generic DML, owner membership, private helper grant or inferred bootstrap,
 -- expectation, session or attempt provisioning is permitted by this inventory.
 RAISE EXCEPTION 'PRO273_SEL_AUDIT_TRANSITIVE_EFFECTS_UNPROVEN';
 RAISE EXCEPTION 'PRO273_SEL_AUDIT_BODY_AND_KEY_REVIEW_REQUIRED';
END $$;
DO $$
DECLARE v_name TEXT;
BEGIN
 FOREACH v_name IN ARRAY ARRAY['pro273_selection_owner','pro273_primitive_publisher','pro273_qualification_allocator','pro273_install_bootstrap'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=v_name) THEN
   EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',v_name);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=v_name AND (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls)) THEN
   RAISE EXCEPTION 'PRO273_SEL_UNSAFE_ROLE';
  END IF;
 END LOOP;
END $$;

-- Fixed installer observation capability. The full effective ACL/owner audit
-- remains a prerequisite to removing the installation abort above.
-- The provenance table is owner-private; this source inventory does not prove
-- all effective/default/column privileges, restrictive FK definitions, trigger
-- bypass, or the complete transitive provisioner writer paths. Those require
-- independent changed-byte and installed audits before any denial is lifted.
-- Deny-only observation inventory: binding reservationId PK, sessionClaimId and
-- expectedEventKey unique; linkage sessionClaimId PK, reservationId, inputClaimId
-- and eventId unique; each has a unique charge pair and restrictive FKs. Separate
-- references do not authenticate or establish a same-row relationship. Installed
-- ACLs, trigger execution/bypass and transitive writers remain unqualified.
-- Admission: claim PK, unique reservation and charge pair, restrictive claim,
-- binding, trust and charge FKs. These do not prove same-row correspondence,
-- issuer authority, receiver fence or durable attempt/UNKNOWN handling.
ALTER FUNCTION public.pro273_control_observation_shape_candidate(BYTEA,TEXT[],INTEGER[],TEXT[],INTEGER[],BYTEA[]) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_control_observation_shape_candidate(BYTEA,TEXT[],INTEGER[],TEXT[],INTEGER[],BYTEA[]) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.pro273_control_observation_span_candidate(BYTEA,INTEGER[],INTEGER[],BYTEA[]) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_control_observation_span_candidate(BYTEA,INTEGER[],INTEGER[],BYTEA[]) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER TABLE public."Pro273ControlPlaneObservationAdmission" OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_observation_admission_deny_insert() OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273ControlPlaneObservationAdmission" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_control_observation_admission_deny_insert() FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER TABLE public."Pro273ControlPlaneObservationBinding" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273ControlPlaneObservationLinkage" OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_observation_deny_insert() OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_observation_deny_mutation() OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273ControlPlaneObservationBinding",public."Pro273ControlPlaneObservationLinkage" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_control_observation_deny_insert(),public.pro273_control_observation_deny_mutation() FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER TABLE public."Pro273PublisherTrustProvenance" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273BaselineTrustProvenance" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273InitialLayoutPublication" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273InitialBaselineLayoutBinding" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273InitialAllocationPublication" OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_linkage_block_insert() OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_assert_publication_receipt(public."Pro273InitialPreinputReceipt",TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,xid8,TEXT,TEXT,TEXT,xid8) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_linkage_immutable() OWNER TO pro262_capacity_owner;
ALTER TYPE public.pro273_qualifier_discovery_snapshot OWNER TO pro262_capacity_owner;
REVOKE ALL ON TYPE public.pro273_qualifier_discovery_snapshot FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.pro273_qualifier_snapshot_equal(public.pro273_qualifier_discovery_snapshot,public.pro273_qualifier_discovery_snapshot) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_snapshot_equal(public.pro273_qualifier_discovery_snapshot,public.pro273_qualifier_discovery_snapshot) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.pro273_qualifier_discover(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_discover(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER FUNCTION public.pro273_initial_discover_installer_history(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_discover_current_layout(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_verify_committed_layout(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_initial_verify_committed_allocation(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273InitialLayoutPublication",public."Pro273InitialBaselineLayoutBinding",public."Pro273InitialAllocationPublication" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_linkage_block_insert(),public.pro273_initial_linkage_immutable() FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_assert_publication_receipt(public."Pro273InitialPreinputReceipt",TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,xid8,TEXT,TEXT,TEXT,xid8) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_discover_installer_history(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_discover_current_layout(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_verify_committed_layout(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE ALL ON FUNCTION public.pro273_initial_verify_committed_allocation(TEXT) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
ALTER TABLE public."Pro273QualifierDescriptorProvenance" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273QualifierDescriptorLinkage" OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid() OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_descriptor_stamp_construction_xid() FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;
ALTER TABLE public."Pro273QualifierDescriptorProof" OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273QualifierDescriptorProvenance",public."Pro273QualifierDescriptorLinkage",public."Pro273QualifierDescriptorProof" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;
ALTER FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_reserve_control(TEXT,BYTEA) FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;
REVOKE ALL ON TABLE public."Pro273PublisherTrustProvenance" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;
REVOKE ALL ON TABLE public."Pro273BaselineTrustProvenance" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
REVOKE SELECT ("trustId","generation","recordHash","fundingMode","chargeKind","chargeEventKey","baselineKind","baselineCoverageEvidenceHash","baselineEnabledAtProvisioning","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), INSERT ("trustId","generation","recordHash","fundingMode","chargeKind","chargeEventKey","baselineKind","baselineCoverageEvidenceHash","baselineEnabledAtProvisioning","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), UPDATE ("trustId","generation","recordHash","fundingMode","chargeKind","chargeEventKey","baselineKind","baselineCoverageEvidenceHash","baselineEnabledAtProvisioning","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), REFERENCES ("trustId","generation","recordHash","fundingMode","chargeKind","chargeEventKey","baselineKind","baselineCoverageEvidenceHash","baselineEnabledAtProvisioning","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt") ON TABLE public."Pro273BaselineTrustProvenance" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
-- Table-level REVOKE does not remove separately granted column privileges.
REVOKE SELECT ("trustId","generation","recordHash","chargeKind","chargeEventKey","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), INSERT ("trustId","generation","recordHash","chargeKind","chargeEventKey","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), UPDATE ("trustId","generation","recordHash","chargeKind","chargeEventKey","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt"), REFERENCES ("trustId","generation","recordHash","chargeKind","chargeEventKey","provisionerOid","provisionerName","provisioningTransactionId","provisionedAt") ON TABLE public."Pro273PublisherTrustProvenance" FROM PUBLIC,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher;
ALTER TABLE public."Pro273InitialPreinputReceipt" OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273InitialPreinputReceipt" FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_control_plane_stamp_creation_xid() OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_plane_lock_input_authority(TEXT,TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_plane_assert_input(TEXT,TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_plane_claim_input(TEXT,TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_plane_evaluate_initial(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_control_plane_evaluate_initial(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,pro273_selection_owner;
REVOKE ALL ON FUNCTION public.pro273_control_plane_assert_input(TEXT,TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_control_plane_claim_input(TEXT,TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_control_plane_lock_input_authority(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_control_plane_stamp_creation_xid() FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
GRANT EXECUTE ON FUNCTION public.pro273_installer_accept_process_observation(TEXT,TEXT,JSONB,BYTEA) TO pro262_install_observer;
ALTER FUNCTION public.pro273_installer_slot_matches(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_acquire_authority(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_assert_observed(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_slot_matches(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_installer_acquire_authority(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_installer_assert_observed(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

-- Private reconstruction helpers; no runtime role may invoke them directly.
ALTER FUNCTION public.pro273_sel_assert_explicit_future_plan(BYTEA[],BYTEA[],BYTEA[],BYTEA[],BYTEA[],BYTEA[]) OWNER TO pro273_selection_owner;
ALTER FUNCTION public.pro273_sel_retry_lineage_update(BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA[],BYTEA[]) OWNER TO pro273_selection_owner;
REVOKE ALL ON FUNCTION public.pro273_sel_assert_explicit_future_plan(BYTEA[],BYTEA[],BYTEA[],BYTEA[],BYTEA[],BYTEA[]), public.pro273_sel_retry_lineage_update(BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA,BYTEA[],BYTEA[]) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_sel_json_object_member(BYTEA,BIGINT,BYTEA) OWNER TO pro273_selection_owner;
REVOKE ALL ON FUNCTION public.pro273_sel_json_object_member(BYTEA,BIGINT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
-- Invocation budget authority and work binding are owner-private.  The
-- installation abort remains until the full effective ACL audit is complete.
ALTER TABLE public."Pro273InvocationDebitGrant" OWNER TO pro262_capacity_owner;
ALTER TABLE public."Pro273InvocationWorkBodyBinding" OWNER TO pro262_capacity_owner;
REVOKE ALL ON TABLE public."Pro273InvocationDebitGrant",public."Pro273InvocationWorkBodyBinding" FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

ALTER FUNCTION public.pro273_installer_utf8_valid(BYTEA,NUMERIC) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_metadata_grammar(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
-- INITIAL grammar is private and does not confer capture authority.
ALTER TYPE public.pro273_initial_parser_limits OWNER TO pro262_capacity_owner;
REVOKE ALL ON TYPE public.pro273_initial_parser_limits FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER TYPE public.pro273_initial_spans OWNER TO pro262_capacity_owner;
REVOKE ALL ON TYPE public.pro273_initial_spans FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_schema_grammar(public.pro273_initial_parser_limits,BYTEA,INTEGER) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_schema_grammar(public.pro273_initial_parser_limits,BYTEA,INTEGER) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_semantic_field(INTEGER,INTEGER,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_semantic_field(INTEGER,INTEGER,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_name_units_valid(BYTEA,INTEGER) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_name_units_valid(BYTEA,INTEGER) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_utc_units_valid(BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_utc_units_valid(BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_utc_order_valid(BYTEA,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_utc_order_valid(BYTEA,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_string_units(public.pro273_initial_parser_limits,BYTEA,INTEGER,INTEGER) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_decoder_resource_preflight(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_decoder_resource_preflight(NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_initial_string_units(public.pro273_initial_parser_limits,BYTEA,INTEGER,INTEGER) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_string_scalars(BYTEA,INTEGER,INTEGER) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_string_scalars(BYTEA,INTEGER,INTEGER) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_key_ordinal(BYTEA,INTEGER,INTEGER,INTEGER) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_key_ordinal(BYTEA,INTEGER,INTEGER,INTEGER) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_initial_data_grammar(public.pro273_initial_parser_limits,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_initial_data_grammar(public.pro273_initial_parser_limits,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_installer_utf8_valid(BYTEA,NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_grammar(TEXT,BYTEA) FROM PUBLIC;

ALTER FUNCTION public.pro273_installer_metadata_string_units(TEXT,BYTEA,INTEGER,INTEGER) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_string_units(TEXT,BYTEA,INTEGER,INTEGER) FROM PUBLIC;

-- Installer token/canonical helpers remain private to the capacity owner.
ALTER TYPE public.pro273_installer_metadata_tokens OWNER TO pro262_capacity_owner;
REVOKE ALL ON TYPE public.pro273_installer_metadata_tokens FROM PUBLIC;
ALTER FUNCTION public.pro273_installer_metadata_tokenize(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_metadata_quote(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_metadata_canonical(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_metadata_context(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_sel_scan_string_end(BYTEA,INTEGER,INTEGER) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_sel_utf16_compare(BYTEA,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_sel_js_array_index(BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_tokenize(TEXT,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_quote(TEXT,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_canonical(TEXT,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_installer_metadata_context(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pro273_sel_scan_string_end(BYTEA,INTEGER,INTEGER),public.pro273_sel_utf16_compare(BYTEA,BYTEA),public.pro273_sel_js_array_index(BYTEA) TO pro273_selection_owner;

ALTER FUNCTION public.pro273_installer_ascii_units(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_qualifier_numeric_vector_valid(JSONB,TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_qualifier_core_valid(JSONB,TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_numeric_vector_valid(JSONB,TEXT),public.pro273_qualifier_core_valid(JSONB,TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_installer_parse_metadata(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_control_plane_bootstrap(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_sel_construct_invocation_pair(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_ascii_units(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pro273_installer_parse_metadata(TEXT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_control_plane_bootstrap(TEXT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_sel_construct_invocation_pair(TEXT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

ALTER FUNCTION public.pro273_installer_commit_delivery(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_assert_committed_delivery(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_commit_delivery(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
REVOKE ALL ON FUNCTION public.pro273_installer_assert_committed_delivery(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

ALTER FUNCTION public.pro273_installer_decimal_units_valid(BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_qualifier_numeric_units_valid(BYTEA,BOOLEAN) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_qualifier_numeric_units_valid(BYTEA,BOOLEAN) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_installer_hash_units_valid(BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_positive_bigint_units_valid(BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_oid_units_valid(BYTEA) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_members_are_strings(public.pro273_installer_metadata_tokens,INTEGER[],INTEGER[]) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_object_members(TEXT,public.pro273_installer_metadata_tokens,INTEGER,TEXT[]) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_unique_object_members(TEXT,public.pro273_installer_metadata_tokens,INTEGER,TEXT[]) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_unique_object_members(TEXT,public.pro273_installer_metadata_tokens,INTEGER,TEXT[]) FROM PUBLIC;
ALTER FUNCTION public.pro273_installer_parse_pair_metadata(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_parse_pair_metadata(TEXT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;
ALTER FUNCTION public.pro273_installer_parse_descriptor_metadata(TEXT,BYTEA) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_parse_descriptor_metadata(TEXT,BYTEA) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

-- Receipt functions remain private until the fixed installer ACL is audited.
ALTER FUNCTION public.pro273_installer_delivery_receipt(TEXT) OWNER TO pro262_capacity_owner;
ALTER FUNCTION public.pro273_installer_constructor_receipt(TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_installer_delivery_receipt(TEXT),public.pro273_installer_constructor_receipt(TEXT) FROM PUBLIC,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator;

-- Disconnected inspection prototype remains private and ungranted.
ALTER FUNCTION public.pro273_trust_issuance_probe(TEXT,BIGINT,JSONB,TEXT) OWNER TO pro262_capacity_owner;
REVOKE ALL ON FUNCTION public.pro273_trust_issuance_probe(TEXT,BIGINT,JSONB,TEXT) FROM PUBLIC,pro262_trust_provisioner,pro273_selection_owner,pro273_install_bootstrap,pro273_primitive_publisher,pro273_qualification_allocator,pro262_control_allocator,pro262_install_observer,pro262_qualification_publisher,huroof_pg_runtime,huroof_pg_service_executor,huroof_pg_executor,enta_runtime,enta_gameplay_runtime,enta_outbox_worker;
