-- INT-5B ISOLATED DRAFT ONLY. Unapplied; exact SQL/roles/proof review first.
-- Additive on the accepted INT-5A migration. No historical rows are rewritten.
BEGIN;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls) THEN
   RAISE EXCEPTION 'INT-5B requires audited nonprivileged NOLOGIN operation groups';
  END IF;
  IF pg_has_role(role_name,'enta_finance_executor','member') OR pg_has_role(role_name,'enta_outbox_worker','member') OR
     pg_has_role('enta_runtime',role_name,'member') THEN RAISE EXCEPTION 'INT-5B operation groups cannot inherit financial ownership'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler'))) THEN
  RAISE EXCEPTION 'INT-5B requires empty role groups before separately reviewed runtime membership';
 END IF;
END $$;

ALTER TABLE public."FirebaseIdentity" ADD CONSTRAINT "FirebaseIdentity_id_project_key" UNIQUE("id","firebaseProjectId");
ALTER TABLE public."Admission"
 DROP CONSTRAINT "Admission_engine_check", DROP CONSTRAINT "Admission_operation_check",
 ALTER COLUMN "catalogReleaseId" DROP NOT NULL, ALTER COLUMN "releaseRootHash" DROP NOT NULL,
 ALTER COLUMN "validationReceiptId" DROP NOT NULL,
 ADD COLUMN "huroofBinding" JSONB, ADD COLUMN "huroofConfig" JSONB,
 ADD COLUMN "huroofCatalogReleaseId" TEXT, ADD COLUMN "huroofCatalogRootHash" TEXT, ADD COLUMN "huroofValidationReceiptId" TEXT,
 ADD COLUMN "predecessorAdmissionId" TEXT,
 ADD CONSTRAINT "Admission_room_project_owner_fkey" FOREIGN KEY("firebaseIdentityId","roomProjectId") REFERENCES public."FirebaseIdentity"("id","firebaseProjectId") ON DELETE RESTRICT,
 ADD CONSTRAINT "Admission_predecessor_fkey" FOREIGN KEY("predecessorAdmissionId") REFERENCES public."Admission"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT "Admission_huroof_catalog_fkey" FOREIGN KEY("huroofCatalogReleaseId","huroofCatalogRootHash") REFERENCES public."CatalogRelease"("id","releaseRootHash") ON DELETE RESTRICT,
 ADD CONSTRAINT "Admission_huroof_receipt_fkey" FOREIGN KEY("huroofValidationReceiptId","huroofCatalogReleaseId","huroofCatalogRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT,
 ADD CONSTRAINT "Admission_engine_branch_check" CHECK (
  ("engine"='ENTA' AND "operation"='PAID_ENTA_CLASSIC' AND "catalogReleaseId" IS NOT NULL AND "releaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL
   AND "huroofBinding" IS NULL AND "huroofConfig" IS NULL AND "predecessorAdmissionId" IS NULL AND "huroofCatalogReleaseId" IS NULL AND "huroofCatalogRootHash" IS NULL AND "huroofValidationReceiptId" IS NULL)
  OR ("engine"='HUROOF' AND "operation"='HOSTED_HUROOF' AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL AND "validationReceiptId" IS NULL
   AND "huroofBinding" IS NOT NULL AND "huroofConfig" IS NOT NULL AND "roomProjectId" IS NOT NULL AND "roomId" IS NOT NULL
   AND "huroofCatalogReleaseId" IS NOT NULL AND "huroofCatalogRootHash" IS NOT NULL AND "huroofValidationReceiptId" IS NOT NULL)
 );

CREATE TABLE public."HuroofAdmissionProof" (
 "id" TEXT PRIMARY KEY, "admissionId" TEXT NOT NULL UNIQUE,
 "proofVersion" INTEGER NOT NULL CHECK("proofVersion"=1),
 "terminalState" TEXT NOT NULL CHECK("terminalState" IN ('STARTED','CANCELLED')),
 "proof" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY("admissionId") REFERENCES public."Admission"("id") ON DELETE RESTRICT
);
REVOKE ALL ON public."HuroofAdmissionProof" FROM PUBLIC, enta_runtime, enta_huroof_reserver, enta_huroof_provisioner, enta_huroof_reconciler;
CREATE TRIGGER "HuroofAdmissionProof_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdmissionProof" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "HuroofAdmissionProof_no_truncate" BEFORE TRUNCATE ON public."HuroofAdmissionProof" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

-- This protocol only admits integer fields and ASCII object keys. Compact,
-- sorted-key UTF-8 JSON agrees with the shared Node protocol canonicalizer.
CREATE FUNCTION public.int5b_canonical_json(p_value JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE jsonb_typeof(p_value)
  WHEN 'object' THEN '{'||COALESCE((SELECT string_agg(to_jsonb(key)::TEXT||':'||public.int5b_canonical_json(value),',' ORDER BY key COLLATE "C") FROM jsonb_each(p_value)),'')||'}'
  WHEN 'array' THEN '['||COALESCE((SELECT string_agg(public.int5b_canonical_json(value),',' ORDER BY ordinal) FROM jsonb_array_elements(p_value) WITH ORDINALITY a(value,ordinal)),'')||']'
  ELSE p_value::TEXT END
$$;
CREATE FUNCTION public.int5b_hash_json(p_value JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT encode(int4_crypto.digest(convert_to(public.int5b_canonical_json(p_value),'UTF8'),'sha256'),'hex')
$$;

-- JSON types are authoritative: ->> alone would accept string versions/numbers.
CREATE FUNCTION public.int5b_json_id(v JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND v #>> '{}' ~ '^[A-Za-z0-9._:-]{1,200}$',FALSE)
$$;
CREATE FUNCTION public.int5b_json_hash(v JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT COALESCE(jsonb_typeof(v)='string' AND v #>> '{}' ~ '^[a-f0-9]{64}$',FALSE)
$$;
CREATE FUNCTION public.int5b_json_integer(v JSONB,lo NUMERIC,hi NUMERIC) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v)='number' THEN (v::TEXT)::NUMERIC BETWEEN lo AND hi AND trunc((v::TEXT)::NUMERIC)=(v::TEXT)::NUMERIC ELSE FALSE END
$$;
CREATE FUNCTION public.int5b_valid_binding(b JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE k TEXT;
BEGIN
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->'version' IS DISTINCT FROM '1'::JSONB OR
    b->'engine' IS DISTINCT FROM '"HUROOF"'::JSONB OR b->'operation' IS DISTINCT FROM '"HOSTED_HUROOF"'::JSONB THEN RETURN FALSE; END IF;
 FOREACH k IN ARRAY ARRAY['admissionId','identityId','projectId','uid','logicalMatchId','roomId','requestKey','catalogReleaseId','validationReceiptId','releaseId','selectorVersion','readinessPolicyVersion'] LOOP
  IF NOT public.int5b_json_id(b->k) THEN RETURN FALSE; END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['requestHash','catalogRootHash','releaseRootHash','capabilityHash','configHash'] LOOP
  IF NOT public.int5b_json_hash(b->k) THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN b ? 'predecessorId' AND (b->'predecessorId'='null'::JSONB OR public.int5b_json_id(b->'predecessorId'));
END $$;
CREATE FUNCTION public.int5b_valid_proof(b JSONB,p JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE provision JSONB; terminal JSONB; state TEXT;
BEGIN
 IF NOT public.int5b_valid_binding(b) OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->'version' IS DISTINCT FROM '1'::JSONB OR p->'binding' IS DISTINCT FROM b THEN RETURN FALSE; END IF;
 state:=p->>'state'; provision:=p->'provision'; terminal:=p->'terminal';
 IF jsonb_typeof(p->'state') IS DISTINCT FROM 'string' OR state NOT IN ('RESERVED','STARTED','CANCELLED') THEN RETURN FALSE; END IF;
 IF provision IS NULL THEN RETURN FALSE; END IF;
 IF provision<>'null'::JSONB THEN
  IF jsonb_typeof(provision) IS DISTINCT FROM 'object' OR provision->'version' IS DISTINCT FROM '1'::JSONB OR provision->'kind' IS DISTINCT FROM '"PROVISION"'::JSONB OR
     jsonb_typeof(provision->'roomCode') IS DISTINCT FROM 'string' OR provision->>'roomCode' !~ '^[A-Z0-9]{8}$' OR provision->'configHash' IS DISTINCT FROM b->'configHash' THEN RETURN FALSE; END IF;
 END IF;
 IF state='RESERVED' THEN RETURN provision<>'null'::JSONB AND terminal IS NOT DISTINCT FROM 'null'::JSONB; END IF;
 IF jsonb_typeof(terminal) IS DISTINCT FROM 'object' OR terminal->'version' IS DISTINCT FROM '1'::JSONB OR
    terminal->'kind' IS DISTINCT FROM to_jsonb(CASE state WHEN 'STARTED' THEN 'START'::TEXT ELSE 'CANCEL'::TEXT END) OR
    NOT public.int5b_json_id(terminal->'actorUid') OR NOT public.int5b_json_id(terminal->'intentId') OR NOT public.int5b_json_hash(terminal->'requestHash') OR
    NOT public.int5b_json_integer(terminal->'fromRevision',0,9007199254740990) OR NOT public.int5b_json_integer(terminal->'toRevision',1,9007199254740991) THEN RETURN FALSE; END IF;
 IF (terminal->>'toRevision')::NUMERIC<>(terminal->>'fromRevision')::NUMERIC+1 THEN RETURN FALSE; END IF;
 RETURN state<>'STARTED' OR (provision<>'null'::JSONB AND terminal->'actorUid'=b->'uid' AND (terminal->>'fromRevision')::NUMERIC>=1);
END $$;

CREATE FUNCTION public.int5b_valid_config(c JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE categories JSONB; k TEXT; team TEXT;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->'demo' IS DISTINCT FROM 'false'::JSONB OR c->'releaseDemoFixture' IS DISTINCT FROM 'false'::JSONB OR c->'policyVersion' IS DISTINCT FROM '1'::JSONB OR
    c->'mapPresentation' IS DISTINCT FROM '"ordinary"'::JSONB OR c->'gameKind' IS DISTINCT FROM '"huroof"'::JSONB OR c->'modality' IS DISTINCT FROM '"classic"'::JSONB OR
    jsonb_typeof(c->'mode') IS DISTINCT FROM 'string' OR c->>'mode' NOT IN ('classic','fast','custom') OR NOT public.int5b_json_id(c->'releaseId') OR NOT public.int5b_json_hash(c->'releaseRootSha256') OR
    NOT public.int5b_json_integer(c->'questionSeconds',5,120) OR NOT public.int5b_json_integer(c->'opponentSeconds',5,120) OR
    jsonb_typeof(c->'labelledColours') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'difficulty') IS DISTINCT FROM 'string' THEN RETURN FALSE; END IF;
 FOR k IN SELECT jsonb_object_keys(c) LOOP
  IF k NOT IN ('demo','releaseDemoFixture','policyVersion','mapPresentation','gameKind','modality','mode','releaseId','releaseRootSha256','categories','teams','questionSeconds','opponentSeconds','labelledColours','difficulty','showQuestionOnAudience') THEN RETURN FALSE; END IF;
 END LOOP;
 categories:=c->'categories';
 IF jsonb_typeof(categories) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
 IF jsonb_array_length(categories) NOT BETWEEN 1 AND 10 OR EXISTS(SELECT 1 FROM jsonb_array_elements(categories) a(v) WHERE NOT public.int5b_json_id(v)) OR
    (SELECT count(DISTINCT v) FROM jsonb_array_elements(categories) a(v))<>jsonb_array_length(categories) OR jsonb_typeof(c->'teams') IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
 FOREACH k IN ARRAY ARRAY['horizontal','vertical'] LOOP
  IF jsonb_typeof(c->'teams'->k) IS DISTINCT FROM 'string' THEN RETURN FALSE; END IF;
  team:=c->'teams'->>k;
  IF team !~ '[^[:space:]]' OR (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(team,'') ch)>40 THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;

CREATE FUNCTION public.int5b_huroof_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE b JSONB; identity_row public."FirebaseIdentity"%ROWTYPE; predecessor public."Admission"%ROWTYPE; receipt public."CatalogValidationReceipt"%ROWTYPE; field_name TEXT;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."huroofBinding",NEW."huroofConfig",NEW."roomProjectId",NEW."roomId",NEW."predecessorAdmissionId",NEW."huroofCatalogReleaseId",NEW."huroofCatalogRootHash",NEW."huroofValidationReceiptId") IS DISTINCT FROM
   (OLD."huroofBinding",OLD."huroofConfig",OLD."roomProjectId",OLD."roomId",OLD."predecessorAdmissionId",OLD."huroofCatalogReleaseId",OLD."huroofCatalogRootHash",OLD."huroofValidationReceiptId") THEN RAISE EXCEPTION 'immutable Huroof binding'; END IF;
 IF NEW."engine"<>'HUROOF' THEN RETURN NEW; END IF;
 b:=NEW."huroofBinding";
 IF NOT public.int5b_valid_binding(b) OR NOT public.int5b_valid_config(NEW."huroofConfig") THEN RAISE EXCEPTION 'Huroof typed binding/config required'; END IF;
 FOREACH field_name IN ARRAY ARRAY['admissionId','identityId','projectId','uid','logicalMatchId','roomId','requestKey','catalogReleaseId','validationReceiptId','releaseId','selectorVersion','readinessPolicyVersion'] LOOP
  IF b->>field_name IS NULL OR b->>field_name !~ '^[A-Za-z0-9._:-]{1,200}$' THEN RAISE EXCEPTION 'Huroof binding identifier required'; END IF;
 END LOOP;
 FOREACH field_name IN ARRAY ARRAY['requestHash','catalogRootHash','releaseRootHash','capabilityHash','configHash'] LOOP
  IF b->>field_name IS NULL OR b->>field_name !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Huroof binding hash required'; END IF;
 END LOOP;
 SELECT * INTO identity_row FROM public."FirebaseIdentity" WHERE "id"=NEW."firebaseIdentityId";
 IF (b->>'admissionId',b->>'identityId',b->>'projectId',b->>'uid',b->>'logicalMatchId',b->>'roomId',b->>'requestKey',b->>'requestHash',b->>'selectorVersion') IS DISTINCT FROM
    (NEW."id",NEW."firebaseIdentityId",identity_row."firebaseProjectId",identity_row."firebaseUid",NEW."logicalMatchId",NEW."roomId",NEW."requestKey",NEW."requestHash",NEW."selectorVersion") OR
    (b->>'predecessorId') IS DISTINCT FROM NEW."predecessorAdmissionId" OR NOT b ? 'predecessorId' THEN RAISE EXCEPTION 'Huroof owner/intent pin mismatch'; END IF;
 IF (b->>'catalogReleaseId',b->>'catalogRootHash',b->>'validationReceiptId') IS DISTINCT FROM (NEW."huroofCatalogReleaseId",NEW."huroofCatalogRootHash",NEW."huroofValidationReceiptId") OR
    public.int5b_hash_json(NEW."huroofConfig") IS DISTINCT FROM b->>'configHash' THEN RAISE EXCEPTION 'Huroof catalog/config hash mismatch'; END IF;
 IF (NEW."huroofConfig"->>'demo') IS DISTINCT FROM 'false' OR (NEW."huroofConfig"->>'releaseDemoFixture') IS DISTINCT FROM 'false' OR
    NEW."huroofConfig" ? 'qaAdmission' OR NEW."huroofConfig" ? 'paidAdmission' OR
    (NEW."huroofConfig"->>'releaseId') IS DISTINCT FROM (b->>'releaseId') OR (NEW."huroofConfig"->>'releaseRootSha256') IS DISTINCT FROM (b->>'releaseRootHash') THEN RAISE EXCEPTION 'Huroof material config mismatch'; END IF;
 SELECT * INTO receipt FROM public."CatalogValidationReceipt" WHERE "id"=b->>'validationReceiptId';
 IF NOT FOUND OR (receipt."catalogReleaseId",receipt."releaseRootHash",receipt."huroofProjectId",receipt."huroofReleaseId",receipt."huroofRootSha256",receipt."selectorVersion",receipt."policyVersion",receipt."huroofCapabilityStateHash") IS DISTINCT FROM
    (b->>'catalogReleaseId',b->>'catalogRootHash',b->>'projectId',b->>'releaseId',b->>'releaseRootHash',b->>'selectorVersion',b->>'readinessPolicyVersion',b->>'capabilityHash') THEN RAISE EXCEPTION 'Huroof trusted receipt mismatch'; END IF;
 IF NEW."predecessorAdmissionId" IS NOT NULL THEN
  SELECT * INTO predecessor FROM public."Admission" WHERE "id"=NEW."predecessorAdmissionId";
  IF NOT FOUND OR predecessor."engine"<>'HUROOF' OR predecessor."firebaseIdentityId"<>NEW."firebaseIdentityId" OR predecessor."state"<>'COMMITTED' OR predecessor."id"=NEW."id" THEN RAISE EXCEPTION 'invalid same-owner played predecessor'; END IF;
  -- Existing predecessors are immutable; an inserted node can reference only
  -- an existing committed node, so cycles cannot be introduced.
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Admission_huroof_binding_guard" BEFORE INSERT OR UPDATE ON public."Admission" FOR EACH ROW EXECUTE FUNCTION public.int5b_huroof_binding_guard();

CREATE FUNCTION public.int5b_huroof_terminal_invariant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE admission_id TEXT; a public."Admission"%ROWTYPE; proof_row public."HuroofAdmissionProof"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Admission' THEN admission_id:=NEW."id"; ELSE admission_id:=NEW."admissionId"; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=admission_id;
 IF a."engine"<>'HUROOF' THEN RETURN NULL; END IF;
 SELECT * INTO proof_row FROM public."HuroofAdmissionProof" WHERE "admissionId"=admission_id;
 IF FOUND AND (proof_row."proofVersion"<>1 OR proof_row."terminalState" IS DISTINCT FROM proof_row."proof"->>'state' OR NOT public.int5b_valid_proof(a."huroofBinding",proof_row."proof")) THEN RAISE EXCEPTION 'Huroof typed terminal proof required'; END IF;
 IF a."state"='HELD' AND FOUND THEN RAISE EXCEPTION 'terminal proof cannot leave financial hold unsettled'; END IF;
 IF a."state"<>'HELD' AND (NOT FOUND OR proof_row."proof"->'binding' IS DISTINCT FROM a."huroofBinding" OR
   proof_row."terminalState" IS DISTINCT FROM CASE a."state" WHEN 'COMMITTED' THEN 'STARTED' ELSE 'CANCELLED' END) THEN RAISE EXCEPTION 'Huroof settlement requires matching immutable terminal proof'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Admission_huroof_terminal_invariant" AFTER INSERT OR UPDATE ON public."Admission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5b_huroof_terminal_invariant();
CREATE CONSTRAINT TRIGGER "HuroofAdmissionProof_settlement_invariant" AFTER INSERT ON public."HuroofAdmissionProof" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5b_huroof_terminal_invariant();

-- Fixed, narrowly scoped operations. The API's current Firebase verifier and
-- the internal project's IAM identity are separate required trust boundaries.
CREATE FUNCTION public.int5b_lock_wallet(p_project TEXT,p_uid TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE w public."Wallet"%ROWTYPE; identity_id TEXT;
BEGIN
 SELECT "id" INTO identity_id FROM public."FirebaseIdentity" WHERE "firebaseProjectId"=p_project AND "firebaseUid"=p_uid;
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet is not provisioned'; END IF;
 RETURN jsonb_build_object('identityId',identity_id,'available',w."available"::TEXT,'debt',w."debt"::TEXT);
END $$;
CREATE FUNCTION public.int5b_find_admission(p_identity TEXT,p_key TEXT,p_logical TEXT) RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT jsonb_build_object('binding',a."huroofBinding",'intentHash',a."intentHash",'engine',a."engine",'state',a."state") FROM public."Admission" a
 WHERE a."firebaseIdentityId"=p_identity AND ((p_key IS NOT NULL AND a."requestKey"=p_key) OR (p_logical IS NOT NULL AND a."engine"='HUROOF' AND a."logicalMatchId"=p_logical)) LIMIT 1
$$;
CREATE FUNCTION public.int5b_huroof_readiness() RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT jsonb_build_object('catalogReleaseId',r."catalogReleaseId",'catalogRootHash',r."releaseRootHash",'validationReceiptId',r."id",'releaseId',r."huroofReleaseId",'releaseRootHash',r."huroofRootSha256",'selectorVersion',r."selectorVersion",'readinessPolicyVersion',r."policyVersion",'capabilityHash',r."huroofCapabilityStateHash")
 FROM public."ActiveCatalogPointer" p JOIN public."CatalogValidationReceipt" r ON r."id"=p."validationReceiptId" WHERE p."id"='singleton' AND r."huroofProjectId" IS NOT NULL
$$;

CREATE FUNCTION public.int5b_reserve_huroof(p_binding JSONB,p_intent_hash TEXT,p_config JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE w public."Wallet"%ROWTYPE; existing public."Admission"%ROWTYPE; reservation_id TEXT; active_receipt TEXT;
BEGIN
 IF NOT public.int5b_valid_binding(p_binding) OR NOT public.int5b_valid_config(p_config) OR p_intent_hash IS NULL OR p_intent_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Huroof typed binding/config required'; END IF;
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=p_binding->>'identityId' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet is not provisioned'; END IF;
 SELECT * INTO existing FROM public."Admission" WHERE "firebaseIdentityId"=w."firebaseIdentityId" AND "requestKey"=p_binding->>'requestKey';
 IF FOUND THEN
  IF existing."engine"='HUROOF' AND existing."requestHash"=p_binding->>'requestHash' AND existing."intentHash"=p_intent_hash THEN RETURN; END IF;
  RAISE EXCEPTION 'idempotency key conflict';
 END IF;
 IF w."debt">0 OR w."available"<1 THEN RAISE EXCEPTION 'wallet cannot reserve'; END IF;
 SELECT "validationReceiptId" INTO active_receipt FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 IF active_receipt IS DISTINCT FROM p_binding->>'validationReceiptId' THEN RAISE EXCEPTION 'active readiness rotated'; END IF;
 reservation_id:=(p_binding->>'admissionId') || ':reservation';
 IF p_intent_hash IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('engine','HUROOF','operation','HOSTED_HUROOF','logicalMatchId',p_binding->>'logicalMatchId','config',p_config,'predecessorId',p_binding->'predecessorId')) OR
    p_binding->>'requestHash' IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('version',1,'requestKey',p_binding->>'requestKey','intentHash',p_intent_hash)) THEN RAISE EXCEPTION 'Huroof request hash mismatch'; END IF;
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","selectorVersion","roomProjectId","roomId","huroofBinding","huroofConfig","predecessorAdmissionId","huroofCatalogReleaseId","huroofCatalogRootHash","huroofValidationReceiptId","updatedAt")
 VALUES(p_binding->>'admissionId',w."firebaseIdentityId",w."id",'HUROOF','HOSTED_HUROOF',p_binding->>'logicalMatchId',p_binding->>'requestKey',p_binding->>'requestHash',p_intent_hash,1,p_binding->>'selectorVersion',p_binding->>'projectId',p_binding->>'roomId',p_binding,p_config,p_binding->>'predecessorId',p_binding->>'catalogReleaseId',p_binding->>'catalogRootHash',p_binding->>'validationReceiptId',clock_timestamp());
 INSERT INTO public."Reservation"("id","admissionId","updatedAt") VALUES(reservation_id,p_binding->>'admissionId',clock_timestamp());
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId")
 VALUES((p_binding->>'admissionId')||':reserve',w."id",w."version"+1,'ADMISSION',p_binding->>'admissionId','RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",w."firebaseIdentityId");
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType") VALUES((p_binding->>'admissionId')||':held',p_binding->>'admissionId',1,'HELD');
 INSERT INTO public."AdmissionOutbox"("id","admissionId","jobKind","transitionVersion","updatedAt") VALUES((p_binding->>'admissionId')||':huroof',p_binding->>'admissionId','HUROOF_PROVISION_RECONCILE',1,clock_timestamp());
END $$;

-- Replace the old generic outbox guard with an exact state/lease CAS guard.
-- Existing ENTA jobs keep their former policy; HUROOF jobs use one fixed kind.
CREATE OR REPLACE FUNCTION public.int5a_outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW."admissionId",NEW."jobKind",NEW."transitionVersion") IS DISTINCT FROM (OLD."admissionId",OLD."jobKind",OLD."transitionVersion") OR OLD."state" IN ('DONE','FAILED') THEN RAISE EXCEPTION 'invalid outbox transition'; END IF;
 IF NEW."jobKind"='HUROOF_PROVISION_RECONCILE' THEN
  IF NOT pg_has_role(current_user,'enta_finance_executor','member') THEN RAISE EXCEPTION 'fixed outbox operation required'; END IF;
  IF NEW."state"='LEASED' THEN
   IF NOT (OLD."state"='PENDING' OR (OLD."state"='LEASED' AND OLD."leaseExpiresAt"<=clock_timestamp())) OR
    NEW."leaseVersion"<>OLD."leaseVersion"+1 OR NEW."attemptCount"<>OLD."attemptCount"+1 OR NEW."leaseOwner" IS NULL OR NEW."leaseExpiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'invalid lease claim'; END IF;
  ELSIF NEW."state" IN ('PENDING','DONE') THEN
   IF OLD."state"<>'LEASED' OR OLD."leaseExpiresAt"<=clock_timestamp() OR NEW."leaseVersion"<>OLD."leaseVersion" OR NEW."attemptCount"<>OLD."attemptCount" OR NEW."leaseOwner" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL THEN RAISE EXCEPTION 'invalid lease completion'; END IF;
  ELSE RAISE EXCEPTION 'Huroof jobs remain pending or complete; no automatic failed/refund outcome'; END IF;
 ELSE
  IF NOT pg_has_role(current_user,'enta_outbox_worker','member') OR NEW."leaseVersion" NOT IN (OLD."leaseVersion",OLD."leaseVersion"+1) THEN RAISE EXCEPTION 'invalid ENTA fenced update'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.int5b_claim_huroof(p_owner TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE job public."AdmissionOutbox"%ROWTYPE; admission_row public."Admission"%ROWTYPE;
BEGIN
 IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,120}$' THEN RAISE EXCEPTION 'lease owner required'; END IF;
 SELECT * INTO job FROM public."AdmissionOutbox" WHERE "jobKind"='HUROOF_PROVISION_RECONCILE' AND
  (("state"='PENDING' AND "availableAt"<=clock_timestamp()) OR ("state"='LEASED' AND "leaseExpiresAt"<=clock_timestamp()))
  ORDER BY "availableAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE public."AdmissionOutbox" SET "state"='LEASED',"leaseOwner"=p_owner,"leaseExpiresAt"=clock_timestamp()+INTERVAL '30 seconds',"leaseVersion"="leaseVersion"+1,"attemptCount"="attemptCount"+1,"updatedAt"=clock_timestamp() WHERE "id"=job."id" RETURNING * INTO job;
 SELECT * INTO admission_row FROM public."Admission" WHERE "id"=job."admissionId";
 RETURN jsonb_build_object('jobId',job."id",'leaseOwner',job."leaseOwner",'leaseVersion',job."leaseVersion",'binding',admission_row."huroofBinding",'config',admission_row."huroofConfig");
END $$;

CREATE FUNCTION public.int5b_finish_huroof(p_job TEXT,p_owner TEXT,p_fence INTEGER,p_proof JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE job public."AdmissionOutbox"%ROWTYPE; a public."Admission"%ROWTYPE; w public."Wallet"%ROWTYPE; r public."Reservation"%ROWTYPE; terminal_state TEXT; effect TEXT; available_delta INTEGER;
BEGIN
 IF p_job IS NULL OR p_job !~ '^[A-Za-z0-9._:-]{1,240}$' OR p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,120}$' OR p_fence IS NULL OR p_fence<=0 THEN RETURN FALSE; END IF;
 SELECT * INTO job FROM public."AdmissionOutbox" WHERE "id"=p_job AND "jobKind"='HUROOF_PROVISION_RECONCILE';
 IF NOT FOUND THEN RETURN FALSE; END IF;
 -- Wallet -> Admission -> Reservation -> outbox, including every retry.
 SELECT * INTO w FROM public."Wallet" WHERE "id"=(SELECT "walletId" FROM public."Admission" WHERE "id"=job."admissionId") FOR UPDATE;
 SELECT * INTO a FROM public."Admission" WHERE "id"=job."admissionId" FOR UPDATE;
 SELECT * INTO r FROM public."Reservation" WHERE "admissionId"=a."id" FOR UPDATE;
 SELECT * INTO job FROM public."AdmissionOutbox" WHERE "id"=p_job FOR UPDATE;
 IF job."state"<>'LEASED' OR job."leaseOwner" IS DISTINCT FROM p_owner OR job."leaseVersion" IS DISTINCT FROM p_fence OR job."leaseExpiresAt" IS NULL OR job."leaseExpiresAt"<=clock_timestamp() THEN RETURN FALSE; END IF;
 IF p_proof IS NULL THEN
  UPDATE public."AdmissionOutbox" SET "state"='PENDING',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"availableAt"=clock_timestamp()+INTERVAL '5 seconds',"updatedAt"=clock_timestamp() WHERE "id"=p_job;
  RETURN TRUE;
 END IF;
 terminal_state:=p_proof->>'state';
 IF NOT public.int5b_valid_proof(a."huroofBinding",p_proof) OR terminal_state NOT IN ('STARTED','CANCELLED') THEN RAISE EXCEPTION 'authenticated typed terminal proof required'; END IF;
 effect:=CASE terminal_state WHEN 'STARTED' THEN 'COMMIT' ELSE 'RELEASE' END; available_delta:=CASE terminal_state WHEN 'STARTED' THEN 0 ELSE 1 END;
 IF a."state"<>'HELD' THEN RAISE EXCEPTION 'financial terminal disagreement'; END IF;
 INSERT INTO public."HuroofAdmissionProof"("id","admissionId","proofVersion","terminalState","proof") VALUES(a."id"||':proof',a."id",1,terminal_state,p_proof);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId")
 VALUES(a."id"||':terminal',w."id",w."version"+1,'ADMISSION',a."id",effect,r."id",available_delta,-1,0,w."available"+available_delta,w."held"-1,w."debt",a."firebaseIdentityId");
 UPDATE public."Wallet" SET "available"="available"+available_delta,"held"="held"-1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 UPDATE public."Admission" SET "state"=CASE terminal_state WHEN 'STARTED' THEN 'COMMITTED' ELSE 'RELEASED' END,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=a."id";
 UPDATE public."Reservation" SET "state"=CASE terminal_state WHEN 'STARTED' THEN 'COMMITTED' ELSE 'RELEASED' END,"committedAt"=CASE terminal_state WHEN 'STARTED' THEN clock_timestamp() ELSE NULL END,"releasedAt"=CASE terminal_state WHEN 'CANCELLED' THEN clock_timestamp() ELSE NULL END,"updatedAt"=clock_timestamp() WHERE "id"=r."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","detailCode") VALUES(a."id"||':terminal',a."id",2,CASE terminal_state WHEN 'STARTED' THEN 'COMMITTED' ELSE 'RELEASED' END,'FIRESTORE_TERMINAL_V1');
 UPDATE public."AdmissionOutbox" SET "state"='DONE',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp() WHERE "id"=p_job;
 RETURN TRUE;
END $$;

-- The NOLOGIN definer owns only these fixed operations. Runtime identities
-- receive no finance DML, no arbitrary effect function and no definer membership.
GRANT SELECT ON public."FirebaseIdentity",public."CatalogValidationReceipt",public."ActiveCatalogPointer" TO enta_finance_executor;
-- PostgreSQL row-locking SELECT requires UPDATE on one column. Binding columns remain denied.
GRANT UPDATE ("updatedAt") ON public."ActiveCatalogPointer" TO enta_finance_executor;
GRANT USAGE ON SCHEMA int4_crypto TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION int4_crypto.digest(BYTEA,TEXT) TO enta_finance_executor;
GRANT SELECT,INSERT,UPDATE ON public."Wallet",public."Admission",public."Reservation",public."AdmissionOutbox" TO enta_finance_executor;
GRANT SELECT,INSERT ON public."WalletEntry",public."AdmissionEvent",public."HuroofAdmissionProof" TO enta_finance_executor;
DO $$ DECLARE f RECORD; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'int5b_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, enta_runtime, enta_huroof_reserver, enta_huroof_provisioner, enta_huroof_reconciler',f.signature);
  EXECUTE format('ALTER FUNCTION %s OWNER TO enta_finance_executor',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.int5b_lock_wallet(TEXT,TEXT),public.int5b_find_admission(TEXT,TEXT,TEXT),public.int5b_huroof_readiness(),public.int5b_reserve_huroof(JSONB,TEXT,JSONB) TO enta_huroof_reserver;
GRANT EXECUTE ON FUNCTION public.int5b_claim_huroof(TEXT) TO enta_huroof_provisioner;
GRANT EXECUTE ON FUNCTION public.int5b_finish_huroof(TEXT,TEXT,INTEGER,JSONB) TO enta_huroof_reconciler;
COMMIT;
