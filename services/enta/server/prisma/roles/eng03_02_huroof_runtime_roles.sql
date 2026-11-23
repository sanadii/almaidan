-- ENG03-02 candidate role contract. Source only; deployment is not authorized.
DO $roles$
DECLARE r TEXT;
BEGIN
 FOREACH r IN ARRAY ARRAY[
  'huroof_pg_owner','huroof_pg_executor','huroof_pg_runtime','huroof_pg_outbox_executor',
  'huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer',
  'huroof_pg_content_publisher','huroof_pg_result_importer'
 ] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=r) THEN
   EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',r);
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=r AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolinherit)) THEN
   RAISE EXCEPTION 'unsafe existing role attributes for %',r;
  END IF;
 END LOOP;
END $roles$;

DO $membership$
DECLARE privileged_oid OID;
BEGIN
 FOREACH privileged_oid IN ARRAY ARRAY[
  (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='enta_finance_executor'),
  (SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner')
 ] LOOP
  IF privileged_oid IS NULL THEN RAISE EXCEPTION 'required isolated owner role is absent'; END IF;
  IF EXISTS(
   WITH RECURSIVE roots(oid) AS (
    SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('huroof_pg_runtime','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_result_importer')
   ), inherited(oid) AS (
    SELECT oid FROM roots UNION SELECT am.roleid FROM pg_catalog.pg_auth_members am JOIN inherited i ON am.member=i.oid
   ) SELECT 1 FROM inherited WHERE oid=privileged_oid
  ) THEN RAISE EXCEPTION 'runtime/service role recursively inherits finance or owner authority'; END IF;
 END LOOP;
 IF EXISTS(
  WITH RECURSIVE roots(oid) AS (
   SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('huroof_pg_runtime','huroof_pg_executor','huroof_pg_outbox_executor','huroof_pg_outbox_worker','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_result_importer')
  ), inherited(oid) AS (SELECT oid FROM roots UNION SELECT am.roleid FROM pg_catalog.pg_auth_members am JOIN inherited i ON am.member=i.oid)
  SELECT 1 FROM inherited WHERE oid=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='huroof_pg_owner')
 ) THEN RAISE EXCEPTION 'service role recursively inherits Huroof owner authority'; END IF;
END $membership$;

-- Existing fixed finance owner remains the only permitted owner of paid-start
-- effects, because INT5A guards require pg_has_role(current_user,...).
ALTER TABLE public."HuroofIdentityPolicyRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofIdentityPolicyHead" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofRoom" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofLocator" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofMember" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofParticipant" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofMatch" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofMatchPin" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofCanonicalState" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofCommandReceipt" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofEvent" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofProjection" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofRealtimeOutbox" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofOutboxDelivery" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofPresence" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofRawArtifact" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofContentRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofContentPointer" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofContentAudit" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofMediaRevision" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofMatchResult" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofOwnerHistoryHead" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofOwnerHistoryEntry" OWNER TO huroof_pg_owner;
ALTER TABLE public."HuroofRematchLink" OWNER TO huroof_pg_owner;

ALTER FUNCTION public.eng03_02_huroof_start(TEXT,TEXT,TEXT,JSONB,JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_executor;
ALTER FUNCTION public.eng03_02_huroof_snapshot(TEXT,TEXT,TEXT,TEXT) OWNER TO huroof_pg_executor;
ALTER FUNCTION public.eng03_02_huroof_replay(TEXT,TEXT,TEXT,TEXT,BIGINT,INTEGER) OWNER TO huroof_pg_executor;
ALTER FUNCTION public.eng03_02_owner_history(TEXT,TEXT,TEXT,JSONB) OWNER TO huroof_pg_executor;
ALTER FUNCTION public.eng03_02_outbox_claim(TEXT,INTEGER) OWNER TO huroof_pg_outbox_executor;
ALTER FUNCTION public.eng03_02_outbox_complete(TEXT,TEXT,BIGINT,TEXT,BIGINT,BOOLEAN) OWNER TO huroof_pg_outbox_executor;
ALTER FUNCTION public.eng03_02_start_closure() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_immutable_row() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_reject_truncate() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_mutable_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_policy_head_cas() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_pointer_cas() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_admission_authority_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_proof_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_outbox_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_has_secret_key(JSONB) OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_result_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_rematch_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_history_head_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_history_entry_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_content_revision_guard() OWNER TO huroof_pg_owner;
ALTER FUNCTION public.eng03_02_projection_guard() OWNER TO huroof_pg_owner;

REVOKE ALL ON public."HuroofIdentityPolicyRevision",public."HuroofIdentityPolicyHead",public."HuroofRoom",public."HuroofLocator",public."HuroofMember",public."HuroofParticipant",public."HuroofMatch",public."HuroofMatchPin",public."HuroofCanonicalState",public."HuroofCommandReceipt",public."HuroofEvent",public."HuroofProjection",public."HuroofRealtimeOutbox",public."HuroofOutboxDelivery",public."HuroofPresence",public."HuroofRawArtifact",public."HuroofContentRevision",public."HuroofContentPointer",public."HuroofContentAudit",public."HuroofMediaRevision",public."HuroofMatchResult",public."HuroofOwnerHistoryHead",public."HuroofOwnerHistoryEntry",public."HuroofRematchLink" FROM PUBLIC,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
GRANT SELECT ON public."HuroofIdentityPolicyRevision",public."HuroofIdentityPolicyHead",public."HuroofRoom",public."HuroofContentPointer",public."HuroofContentRevision",public."HuroofRawArtifact",public."HuroofMatch",public."HuroofMatchPin",public."HuroofCommandReceipt",public."HuroofCanonicalState",public."HuroofEvent",public."HuroofProjection",public."HuroofRealtimeOutbox",public."HuroofOutboxDelivery" TO enta_finance_executor;
GRANT SELECT ON public."HuroofMatchResult" TO enta_finance_executor;
GRANT SELECT ON public."DeploymentNamespace",public."CatalogReleaseSeal" TO enta_finance_executor;
GRANT SELECT ON public."CatalogValidationReceipt",public."CatalogReleaseSeal" TO huroof_pg_owner;
GRANT SELECT ON public."Reservation",public."HuroofCommandReceipt" TO huroof_pg_executor;
GRANT INSERT ON public."HuroofMatch",public."HuroofMatchPin",public."HuroofCommandReceipt",public."HuroofEvent",public."HuroofProjection",public."HuroofRealtimeOutbox",public."HuroofOutboxDelivery" TO enta_finance_executor;
GRANT UPDATE ("status","version","updatedAt") ON public."HuroofRoom" TO enta_finance_executor;
GRANT INSERT,UPDATE ON public."HuroofCanonicalState" TO enta_finance_executor;
GRANT INSERT,UPDATE ON public."HuroofProjection" TO enta_finance_executor;
GRANT SELECT ON public."Admission",public."Reservation",public."WalletEntry" TO huroof_pg_owner;
GRANT SELECT ON public."FirebaseIdentity",public."DeploymentNamespace" TO huroof_pg_owner;
GRANT SELECT ON public."Admission",public."HuroofRoom",public."HuroofMember",public."HuroofMatch",public."HuroofProjection",public."HuroofEvent",public."HuroofOwnerHistoryHead",public."HuroofOwnerHistoryEntry",public."FirebaseIdentity" TO huroof_pg_executor;
GRANT SELECT ON public."HuroofOutboxDelivery",public."HuroofRealtimeOutbox",public."HuroofEvent",public."HuroofMatch" TO huroof_pg_outbox_executor;
GRANT UPDATE ("state","leaseOwner","leaseVersion","leaseExpiresAt","attemptCount","lastErrorCode","updatedAt") ON public."HuroofOutboxDelivery" TO huroof_pg_outbox_executor;

-- These groups receive no inherited finance or owner capability. Role
-- memberships remain a separately audited prerequisite, not created here.
GRANT USAGE ON SCHEMA public TO huroof_pg_owner,huroof_pg_executor,huroof_pg_outbox_executor,enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.eng03_02_has_secret_key(JSONB) TO enta_finance_executor;
GRANT USAGE ON SCHEMA int4_crypto TO huroof_pg_owner,enta_finance_executor,huroof_pg_executor;
GRANT EXECUTE ON FUNCTION int4_crypto.digest(BYTEA,TEXT) TO huroof_pg_owner,enta_finance_executor,huroof_pg_executor;
GRANT EXECUTE ON FUNCTION public.int5b_hash_json(JSONB),public.int5b_canonical_json(JSONB) TO huroof_pg_owner;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_start(TEXT,TEXT,TEXT,JSONB,JSONB) FROM enta_finance_executor,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) FROM huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_snapshot(TEXT,TEXT,TEXT,TEXT) FROM huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_replay(TEXT,TEXT,TEXT,TEXT,BIGINT,INTEGER) FROM huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_outbox_claim(TEXT,INTEGER) FROM huroof_pg_outbox_executor,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_outbox_complete(TEXT,TEXT,BIGINT,TEXT,BIGINT,BOOLEAN) FROM huroof_pg_outbox_executor,huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;
REVOKE ALL ON FUNCTION public.eng03_02_owner_history(TEXT,TEXT,TEXT,JSONB) FROM huroof_pg_runtime,huroof_pg_executor,huroof_pg_outbox_executor,huroof_pg_outbox_worker,huroof_pg_content_editor,huroof_pg_content_reviewer,huroof_pg_content_publisher,huroof_pg_result_importer;

-- No EXECUTE is granted here: current SQL arguments do not prove Firebase
-- authentication. ENG03-03 must compose genuine service authority before a
-- reviewed caller grant can be added. Definitions remain source-visible only.
