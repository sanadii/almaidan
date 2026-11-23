-- DRAFT ONLY. Do not apply until Database, Security, and Gate review this exact
-- source/schema/grant/build package. This changes no existing R5 migration and
-- writes no catalog, receipt, wallet, game, or production content rows.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='catalog_issuer' AND NOT rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'preprovisioned unprivileged NOLOGIN catalog_issuer owner role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='enta_catalog_issuer_login' AND rolcanlogin AND NOT rolinherit
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'preprovisioned unprivileged NOINHERIT enta_catalog_issuer_login required';
  END IF;
  IF session_user<>'enta_catalog_migration_custodian' OR current_user<>session_user THEN
    RAISE EXCEPTION 'R3-E migration requires the named audited custodian as session and current user';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
      WHERE owner_role.rolname='catalog_issuer')<>1 OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
      JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
      WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
        AND grantor_role.rolname='enta_catalog_bootstrap_dba'
        AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option
    ) THEN
    RAISE EXCEPTION 'exact sole bootstrap-DBA custodian ADMIN-only owner-role edge required at rest';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
      WHERE member_role.rolname='enta_catalog_issuer_login') OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles granted_role ON granted_role.oid=m.roleid
      WHERE granted_role.rolname='enta_catalog_issuer_login') THEN
    RAISE EXCEPTION 'issuer login must have zero role membership edges';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
      WHERE member_role.rolname='catalog_issuer') THEN
    RAISE EXCEPTION 'function owner must have no parent roles or inherited privilege path';
  END IF;
  IF pg_has_role(session_user,'catalog_issuer','SET') OR has_schema_privilege('catalog_issuer','public','CREATE') THEN
    RAISE EXCEPTION 'custodian or owner role is not at its required closed-at-rest privilege state';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_roles function_owner ON function_owner.oid=p.proowner
      WHERE n.nspname='public' AND p.proname='issue_catalog_validation_receipt' AND function_owner.rolname=session_user
    ) THEN
    RAISE EXCEPTION 'named custodian must own the historical receipt issuer before migration';
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles schema_owner ON schema_owner.oid=n.nspowner
      WHERE n.nspname='public' AND (schema_owner.rolname=session_user OR EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl
        WHERE acl.grantee=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
          AND acl.privilege_type='CREATE' AND acl.is_grantable
      ))
    ) THEN
    RAISE EXCEPTION 'named custodian must be able to grant and revoke temporary public CREATE';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname IN ('catalog_issuer','enta_catalog_issuer_login') AND rolcanlogin AND rolsuper) THEN
    RAISE EXCEPTION 'issuer roles must not be privileged';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."CatalogValidationReceipt"
    WHERE "policyVersion"='enta-r3e-private-issuer-v1'
    GROUP BY "catalogReleaseId","releaseRootHash","sealHash","policyVersion"
    HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'existing duplicate successor receipt identities block R3-E'; END IF;
  IF EXISTS (SELECT 1 FROM public."CatalogValidationReceipt" WHERE "policyVersion"='enta-r3e-private-issuer-v1') THEN
    RAISE EXCEPTION 'successor policy identity already exists before R3-E migration';
  END IF;
END $$;

CREATE TABLE public."CatalogValidationProof" (
  "id" TEXT NOT NULL,
  "catalogReleaseId" TEXT NOT NULL,
  "releaseRootHash" TEXT NOT NULL,
  "sealHash" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "canonicalReportBytes" BYTEA NOT NULL,
  "reportSha256" TEXT NOT NULL,
  "sourceArtifactSha256" TEXT NOT NULL,
  "sourceSnapshotHash" TEXT NOT NULL,
  "sourceEvidenceManifestSha256" TEXT NOT NULL,
  "sourceEvidenceGenerationSha256" TEXT NOT NULL,
  "sourceSummarySha256" TEXT NOT NULL,
  "selectorVersion" TEXT NOT NULL,
  "selectorBuildId" TEXT NOT NULL,
  "executableBuildSha256" TEXT NOT NULL,
  "databaseHelpersSha256" TEXT NOT NULL,
  "issuerTrustManifestSha256" TEXT NOT NULL,
  "issuerTrustGenerationSha256" TEXT NOT NULL,
  "validatedAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogValidationProof_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogValidationProof_successor_policy_check" CHECK ("policyVersion"='enta-r3e-private-issuer-v1'),
  CONSTRAINT "CatalogValidationProof_report_sha_check" CHECK ("reportSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_source_sha_check" CHECK ("sourceArtifactSha256" ~ '^[a-f0-9]{64}$' AND "sourceSnapshotHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_evidence_sha_check" CHECK ("sourceEvidenceManifestSha256" ~ '^[a-f0-9]{64}$' AND "sourceEvidenceGenerationSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_build_sha_check" CHECK ("executableBuildSha256" ~ '^[a-f0-9]{64}$' AND "databaseHelpersSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_trust_sha_check" CHECK ("issuerTrustManifestSha256" ~ '^[a-f0-9]{64}$' AND "issuerTrustGenerationSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_source_summary_sha_check" CHECK ("sourceSummarySha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "CatalogValidationProof_validity_check" CHECK ("validatedAt" < "expiresAt"),
  CONSTRAINT "CatalogValidationProof_report_size_check" CHECK (octet_length("canonicalReportBytes") BETWEEN 1 AND 131072),
  CONSTRAINT "CatalogValidationProof_seal_fkey" FOREIGN KEY ("catalogReleaseId","releaseRootHash","sealHash")
    REFERENCES public."CatalogReleaseSeal"("catalogReleaseId","releaseRootHash","sealHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "CatalogValidationProof_release_policy_key" UNIQUE ("catalogReleaseId","releaseRootHash","sealHash","policyVersion"),
  CONSTRAINT "CatalogValidationProof_identity_fkey_key" UNIQUE ("id","catalogReleaseId","releaseRootHash","sealHash","policyVersion"),
  CONSTRAINT "CatalogValidationProof_reportSha256_id_key" UNIQUE ("reportSha256","id")
);

ALTER TABLE public."CatalogValidationReceipt" ADD COLUMN "proofId" TEXT;
ALTER TABLE public."CatalogValidationReceipt"
  ADD CONSTRAINT "CatalogValidationReceipt_proof_fkey"
    FOREIGN KEY ("proofId","catalogReleaseId","releaseRootHash","sealHash","policyVersion")
    REFERENCES public."CatalogValidationProof"("id","catalogReleaseId","releaseRootHash","sealHash","policyVersion")
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "CatalogValidationReceipt_proof_relation_key"
    UNIQUE ("proofId","catalogReleaseId","releaseRootHash","sealHash","policyVersion"),
  ADD CONSTRAINT "CatalogValidationReceipt_proof_unique" UNIQUE ("proofId");

-- Prisma does not model predicate-backed unique constraints. This index scopes
-- idempotent identity to the successor policy and preserves historical R5 duplicates.
CREATE UNIQUE INDEX "CatalogValidationReceipt_r3e_successor_identity_key"
  ON public."CatalogValidationReceipt"("catalogReleaseId","releaseRootHash","sealHash","policyVersion")
  WHERE "policyVersion"='enta-r3e-private-issuer-v1';

CREATE OR REPLACE FUNCTION public.reject_r3e_direct_proof_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,int4_crypto AS $$
BEGIN
  IF session_user<>'enta_catalog_issuer_login' OR current_user<>'catalog_issuer' THEN
    RAISE EXCEPTION 'R3-E proof inserts require fixed issuer function' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CatalogValidationProof_issuer_insert_only"
  BEFORE INSERT ON public."CatalogValidationProof" FOR EACH ROW EXECUTE FUNCTION public.reject_r3e_direct_proof_insert();
CREATE TRIGGER "CatalogValidationProof_immutable_mutation"
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public."CatalogValidationProof" FOR EACH STATEMENT
  EXECUTE FUNCTION public.reject_immutable_catalog_mutation();

CREATE OR REPLACE FUNCTION public.require_r3e_proof_for_successor_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,int4_crypto AS $$
BEGIN
  IF NEW."policyVersion"='enta-r3e-private-issuer-v1' THEN
    IF NEW."proofId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM public."CatalogValidationProof" p
      WHERE p."id"=NEW."proofId" AND p."catalogReleaseId"=NEW."catalogReleaseId"
        AND p."releaseRootHash"=NEW."releaseRootHash" AND p."sealHash"=NEW."sealHash"
        AND p."policyVersion"=NEW."policyVersion"
        AND p."sourceSummarySha256"=NEW."sourceEvidenceManifestHash"
        AND p."selectorVersion"=NEW."selectorVersion"
        AND p."validatedAt" <= clock_timestamp() AND p."expiresAt" > clock_timestamp()
    ) THEN RAISE EXCEPTION 'successor receipt requires exact immutable proof'; END IF;
  ELSIF NEW."proofId" IS NOT NULL THEN
    RAISE EXCEPTION 'historical policy receipts cannot claim R3-E proof';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CatalogValidationReceipt_require_r3e_proof"
  BEFORE INSERT ON public."CatalogValidationReceipt" FOR EACH ROW EXECUTE FUNCTION public.require_r3e_proof_for_successor_receipt();

CREATE OR REPLACE FUNCTION public.block_r3e_catalog_activation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,int4_crypto AS $$
DECLARE next_policy TEXT;
BEGIN
  SELECT r."policyVersion" INTO next_policy FROM public."CatalogValidationReceipt" r
    WHERE r."id"=NEW."validationReceiptId" AND r."catalogReleaseId"=NEW."catalogReleaseId";
  IF next_policy='enta-r3e-private-issuer-v1' THEN
    RAISE EXCEPTION 'R3-E private synthetic receipts cannot activate';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ActiveCatalogPointer_deny_r3e_receipt"
  BEFORE INSERT OR UPDATE ON public."ActiveCatalogPointer" FOR EACH ROW EXECUTE FUNCTION public.block_r3e_catalog_activation();
CREATE TRIGGER "CatalogActivationEvent_deny_r3e_receipt"
  BEFORE INSERT ON public."CatalogActivationEvent" FOR EACH ROW EXECUTE FUNCTION public.block_r3e_catalog_activation();

-- The old validator endpoint is permanently closed by this boundary. Preserve
-- an explicit known historical/synthetic policy allowlist for diagnostics, but
-- never let it issue a new receipt after R3-E is installed.
CREATE OR REPLACE FUNCTION public.issue_catalog_validation_receipt(
  p_release_id TEXT,p_release_root TEXT,p_seal_hash TEXT,p_policy_version TEXT,p_source_manifest_hash TEXT,p_selector_version TEXT,
  p_huroof_project TEXT DEFAULT NULL,p_huroof_release TEXT DEFAULT NULL,p_huroof_root TEXT DEFAULT NULL,
  p_huroof_capability_hash TEXT DEFAULT NULL,p_huroof_attestation TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,int4_crypto AS $$
BEGIN
  IF p_policy_version IS NULL OR NOT COALESCE(p_policy_version = ANY(ARRAY['int4-db-synthetic-v1','int4-test-policy-v1','int4-activation-race-policy-v1']::TEXT[]),FALSE) THEN
    RAISE EXCEPTION 'legacy receipt policy is not allowlisted' USING ERRCODE='22023';
  END IF;
  RAISE EXCEPTION 'legacy receipt issuer is disabled by R3-E policy boundary' USING ERRCODE='42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_r3e_catalog_receipt(
  p_release_id TEXT,
  p_report_json TEXT,
  p_source_artifact_sha256 TEXT,
  p_snapshot_hash TEXT,
  p_source_summary_sha256 TEXT,
  p_source_evidence_manifest_sha256 TEXT,
  p_source_evidence_generation_sha256 TEXT,
  p_selector_version TEXT,
  p_selector_build_id TEXT,
  p_executable_build_sha256 TEXT,
  p_database_helpers_sha256 TEXT,
  p_issuer_trust_manifest_sha256 TEXT,
  p_issuer_trust_generation_sha256 TEXT
) RETURNS TABLE("receiptId" TEXT,"proofId" TEXT,"reportSha256" TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,int4_crypto AS $$
DECLARE
  policy_version CONSTANT TEXT := 'enta-r3e-private-issuer-v1';
  release_row RECORD;
  source_summary_sha256 TEXT;
  report_document JSONB;
  report_bytes BYTEA;
  report_sha256 TEXT;
  deterministic_proof_id TEXT;
  deterministic_receipt_id TEXT;
  source_evidence_expires_at TIMESTAMPTZ;
  trust_expires_at TIMESTAMPTZ;
  proof_expires_at TIMESTAMPTZ;
  replayed_count BIGINT;
  availability_count BIGINT;
  category_count BIGINT;
  top_keys TEXT[];
  nested_keys TEXT[];
  item_keys TEXT[];
  stored_proof public."CatalogValidationProof"%ROWTYPE;
  stored_receipt public."CatalogValidationReceipt"%ROWTYPE;
BEGIN
  IF session_user<>'enta_catalog_issuer_login' OR current_user<>'catalog_issuer' THEN
    RAISE EXCEPTION 'exact private issuer login required' USING ERRCODE='42501';
  END IF;
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'off' OR
      EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member
        WHERE r.rolname=session_user) OR
      EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
        WHERE r.rolname=session_user) OR
      (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        WHERE owner_role.rolname='catalog_issuer')<>1 OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
          JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
        WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
          AND grantor_role.rolname='enta_catalog_bootstrap_dba' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option) OR
      EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member
        WHERE r.rolname='catalog_issuer') OR
      has_schema_privilege('catalog_issuer','public','CREATE') OR
      NOT COALESCE((SELECT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls
        FROM pg_catalog.pg_roles WHERE rolname=session_user),FALSE) OR
      pg_has_role(session_user,'catalog_validator','member') OR pg_has_role(session_user,'catalog_reviewer','member') OR
      pg_has_role(session_user,'catalog_assembler','member') OR pg_has_role(session_user,'catalog_publisher','member') OR
      pg_has_role(session_user,'catalog_activator','member') OR pg_has_role(session_user,'enta_runtime','member') THEN
    RAISE EXCEPTION 'issuer transaction identity or role boundary invalid' USING ERRCODE='42501';
  END IF;
  IF p_release_id IS NULL OR length(p_release_id)<1 OR length(p_release_id)>160 OR p_report_json IS NULL OR octet_length(p_report_json)>131072 THEN
    RAISE EXCEPTION 'R3-E report input invalid' USING ERRCODE='22023';
  END IF;
  IF NOT COALESCE(p_source_artifact_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_snapshot_hash ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_source_summary_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_source_evidence_manifest_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_source_evidence_generation_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_executable_build_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_database_helpers_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_issuer_trust_manifest_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      NOT COALESCE(p_issuer_trust_generation_sha256 ~ '^[a-f0-9]{64}$',FALSE) OR
      p_selector_version IS DISTINCT FROM 'enta-curated-classic-tier-v2' OR
      p_selector_build_id IS DISTINCT FROM 'enta-curated-classic-tier-v2+stored-seed-replay-v1' THEN
    RAISE EXCEPTION 'R3-E proof identity invalid' USING ERRCODE='22023';
  END IF;

  -- A transaction advisory lock serializes identical identities without granting
  -- the issuer UPDATE privileges needed by SELECT FOR UPDATE.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('r3e:'||p_release_id, 20261002));
  SELECT r."id",r."releaseRootHash",s."sealHash" INTO release_row
    FROM public."CatalogRelease" r JOIN public."CatalogReleaseSeal" s
      ON s."catalogReleaseId"=r."id" AND s."releaseRootHash"=r."releaseRootHash"
    WHERE r."id"=p_release_id AND r."sealedAt" IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'R3-E requires exact sealed release'; END IF;

  IF (SELECT count(*) FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=p_release_id AND s."sourceNamespace"='enta.question')<>1 OR
     (SELECT count(*) FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=p_release_id)<>1 OR
     NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=p_release_id AND s."sourceNamespace"='enta.question'
       AND s."sourceRootSha256"=p_source_artifact_sha256 AND s."snapshotHash"=p_snapshot_hash) THEN
    RAISE EXCEPTION 'R3-E source snapshot mismatch';
  END IF;
  SELECT encode(int4_crypto.digest(convert_to(COALESCE((
    SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
    FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=p_release_id
  ),'[]'),'UTF8'),'sha256'),'hex') INTO source_summary_sha256;
  IF source_summary_sha256 IS DISTINCT FROM p_source_summary_sha256 THEN RAISE EXCEPTION 'R3-E R5 source summary mismatch'; END IF;

  SELECT count(*), count(DISTINCT a."categoryKey") INTO availability_count, category_count
    FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id;
  IF availability_count=0 OR category_count=0 OR
      category_count<>(SELECT count(*) FROM public."CatalogReleaseCategory" c WHERE c."catalogReleaseId"=p_release_id) OR
      availability_count<>category_count*3 OR
      EXISTS(SELECT 1 FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id AND
        (a."engine" IS DISTINCT FROM 'ENTA' OR a."mode" IS DISTINCT FROM 'CLASSIC' OR a."modality" IS DISTINCT FROM 'classic' OR
         a."selectorVersion" IS DISTINCT FROM p_selector_version OR a."tier" IS NULL OR a."tier" NOT IN ('200','400','600') OR
         cardinality(a."freshSelectionIds") IS DISTINCT FROM 2 OR cardinality(a."repeatSelectionIds") IS DISTINCT FROM 2 OR
         a."freshSelectionIds" && a."repeatSelectionIds")) OR
      EXISTS(SELECT 1 FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id
        GROUP BY a."categoryKey" HAVING count(*)<>3 OR count(DISTINCT a."tier")<>3) THEN
    RAISE EXCEPTION 'R3-E requires complete Enta CLASSIC 200/400/600 availability';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public."CatalogReleaseCategory" c
    JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" AND cr."contentHash"=c."categoryContentHash"
    WHERE c."catalogReleaseId"=p_release_id AND cr."coverMediaRevisionId" IS NOT NULL
  ) OR EXISTS(
    SELECT 1 FROM public."CatalogReleaseQuestion" m
    JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash"
    WHERE m."catalogReleaseId"=p_release_id AND
      (m."sourceNamespace" IS DISTINCT FROM 'enta.question' OR q."sealedAt" IS NULL OR q."engine" IS DISTINCT FROM 'ENTA' OR
       q."mode" IS DISTINCT FROM 'CLASSIC' OR q."modality" IS DISTINCT FROM 'classic' OR
       EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" qm WHERE qm."questionRevisionId"=q."id"))
  ) THEN
    RAISE EXCEPTION 'R3-E source pool contains unsupported media or mode';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public."CatalogReleaseAvailability" a
    CROSS JOIN LATERAL unnest(a."freshSelectionIds"||a."repeatSelectionIds") AS selected("revisionId")
    LEFT JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=a."catalogReleaseId" AND m."questionRevisionId"=selected."revisionId"
      AND m."categoryKey"=a."categoryKey" AND m."sourceNamespace"='enta.question'
    LEFT JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash"
    WHERE a."catalogReleaseId"=p_release_id AND
      (q."id" IS NULL OR q."engine" IS DISTINCT FROM a."engine" OR q."mode" IS DISTINCT FROM a."mode" OR
       q."modality" IS DISTINCT FROM a."modality" OR q."tier" IS DISTINCT FROM a."tier" OR q."points"::TEXT IS DISTINCT FROM a."tier" OR
       EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" qm WHERE qm."questionRevisionId"=q."id"))
  ) OR EXISTS(
    SELECT a."categoryKey", q."sourceQuestionId"
    FROM public."CatalogReleaseAvailability" a
    CROSS JOIN LATERAL unnest(a."freshSelectionIds"||a."repeatSelectionIds") AS selected("revisionId")
    JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=a."catalogReleaseId" AND m."questionRevisionId"=selected."revisionId"
      AND m."categoryKey"=a."categoryKey" AND m."sourceNamespace"='enta.question'
    JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash"
    WHERE a."catalogReleaseId"=p_release_id
    GROUP BY a."categoryKey",q."sourceQuestionId" HAVING count(DISTINCT q."id")>1
  ) THEN
    RAISE EXCEPTION 'R3-E selected supply has missing, relabeled, repeated or media-backed revisions';
  END IF;

  report_document := p_report_json::jsonb;
  IF jsonb_typeof(report_document) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'R3-E report must be an object'; END IF;
  SELECT array_agg(k ORDER BY k) INTO top_keys FROM jsonb_object_keys(report_document) AS keys(k);
  IF top_keys IS DISTINCT FROM ARRAY['databaseHelpersSha256','executableBuildSha256','policyVersion','proofExpiresAt','release',
      'selector','source','sourceEvidenceExpiresAt','sourceEvidenceGenerationSha256','sourceEvidenceManifestSha256','sourceSummarySha256',
      'status','trustExpiresAt','trustGenerationSha256','trustManifestSha256','version']::TEXT[] OR
     jsonb_typeof(report_document->'release') IS DISTINCT FROM 'object' OR
     jsonb_typeof(report_document->'source') IS DISTINCT FROM 'object' OR
     jsonb_typeof(report_document->'selector') IS DISTINCT FROM 'object' OR
     jsonb_typeof(report_document#>'{selector,replayed}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'R3-E report shape is invalid';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO nested_keys FROM jsonb_object_keys(report_document->'release') AS keys(k);
  IF nested_keys IS DISTINCT FROM ARRAY['id','rootSha256']::TEXT[] THEN RAISE EXCEPTION 'R3-E release report shape is invalid'; END IF;
  SELECT array_agg(k ORDER BY k) INTO nested_keys FROM jsonb_object_keys(report_document->'source') AS keys(k);
  IF nested_keys IS DISTINCT FROM ARRAY['releaseId','rootSha256','snapshotHash']::TEXT[] THEN RAISE EXCEPTION 'R3-E source report shape is invalid'; END IF;
  SELECT array_agg(k ORDER BY k) INTO nested_keys FROM jsonb_object_keys(report_document->'selector') AS keys(k);
  IF nested_keys IS DISTINCT FROM ARRAY['buildId','replayed','version']::TEXT[] THEN RAISE EXCEPTION 'R3-E selector report shape is invalid'; END IF;
  IF report_document->>'version' IS DISTINCT FROM 'enta-r3e-validation-report-v1' OR
     report_document->>'status' IS DISTINCT FROM 'verified' OR report_document->>'policyVersion' IS DISTINCT FROM policy_version OR
     report_document#>>'{release,id}' IS DISTINCT FROM p_release_id OR
     report_document#>>'{release,rootSha256}' IS DISTINCT FROM release_row."releaseRootHash" OR
     report_document#>>'{source,releaseId}' IS DISTINCT FROM (SELECT s."sourceReleaseId" FROM public."CatalogReleaseSourceSnapshot" s
       WHERE s."catalogReleaseId"=p_release_id AND s."sourceNamespace"='enta.question') OR
     report_document#>>'{source,rootSha256}' IS DISTINCT FROM p_source_artifact_sha256 OR
     report_document#>>'{source,snapshotHash}' IS DISTINCT FROM p_snapshot_hash OR
     report_document->>'sourceSummarySha256' IS DISTINCT FROM p_source_summary_sha256 OR
     report_document->>'sourceEvidenceManifestSha256' IS DISTINCT FROM p_source_evidence_manifest_sha256 OR
     report_document->>'sourceEvidenceGenerationSha256' IS DISTINCT FROM p_source_evidence_generation_sha256 OR
     report_document#>>'{selector,version}' IS DISTINCT FROM p_selector_version OR
     report_document#>>'{selector,buildId}' IS DISTINCT FROM p_selector_build_id OR
     report_document->>'trustManifestSha256' IS DISTINCT FROM p_issuer_trust_manifest_sha256 OR
     report_document->>'trustGenerationSha256' IS DISTINCT FROM p_issuer_trust_generation_sha256 OR
     report_document->>'executableBuildSha256' IS DISTINCT FROM p_executable_build_sha256 OR
     report_document->>'databaseHelpersSha256' IS DISTINCT FROM p_database_helpers_sha256 OR
     jsonb_typeof(report_document->'sourceEvidenceExpiresAt') IS DISTINCT FROM 'string' OR
     jsonb_typeof(report_document->'trustExpiresAt') IS DISTINCT FROM 'string' OR
     jsonb_typeof(report_document->'proofExpiresAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'R3-E sanitized report does not bind exact proof identity';
  END IF;

  replayed_count := jsonb_array_length(report_document#>'{selector,replayed}');
  IF replayed_count<>availability_count THEN RAISE EXCEPTION 'R3-E selector report omits stored availability'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(report_document#>'{selector,replayed}') AS replay(value)
    WHERE jsonb_typeof(replay.value) IS DISTINCT FROM 'object' OR
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(replay.value) AS keys(k)) IS DISTINCT FROM
        ARRAY['categoryKey','freshHash','freshSeed','manifestHash','repeatHash','repeatSeed','tier']::TEXT[] OR
      jsonb_typeof(replay.value->'categoryKey') IS DISTINCT FROM 'string' OR jsonb_typeof(replay.value->'tier') IS DISTINCT FROM 'string' OR
      jsonb_typeof(replay.value->'freshSeed') IS DISTINCT FROM 'number' OR jsonb_typeof(replay.value->'repeatSeed') IS DISTINCT FROM 'number' OR
      (replay.value->'freshSeed')::TEXT !~ '^(0|[1-9][0-9]*)$' OR (replay.value->'repeatSeed')::TEXT !~ '^(0|[1-9][0-9]*)$' OR
      jsonb_typeof(replay.value->'freshHash') IS DISTINCT FROM 'string' OR jsonb_typeof(replay.value->'repeatHash') IS DISTINCT FROM 'string' OR
      jsonb_typeof(replay.value->'manifestHash') IS DISTINCT FROM 'string' OR
      NOT EXISTS(SELECT 1 FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id AND
        a."categoryKey"=replay.value->>'categoryKey' AND a."tier"=replay.value->>'tier' AND
        a."freshSelectionSeed"=CASE WHEN (replay.value->'freshSeed')::TEXT ~ '^(0|[1-9][0-9]*)$' THEN ((replay.value->'freshSeed')::TEXT)::INTEGER ELSE -1 END AND
        a."repeatSelectionSeed"=CASE WHEN (replay.value->'repeatSeed')::TEXT ~ '^(0|[1-9][0-9]*)$' THEN ((replay.value->'repeatSeed')::TEXT)::INTEGER ELSE -1 END AND
        a."freshSelectionHash"=replay.value->>'freshHash' AND a."repeatSelectionHash"=replay.value->>'repeatHash' AND
        a."selectionManifestHash"=replay.value->>'manifestHash')
  ) OR (SELECT count(DISTINCT jsonb_build_array(value->>'categoryKey',value->>'tier'))
        FROM jsonb_array_elements(report_document#>'{selector,replayed}') AS replay(value))<>replayed_count THEN
    RAISE EXCEPTION 'R3-E selector report does not match stored availability';
  END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(report_document#>'{selector,replayed}') AS replay(value)
    WHERE jsonb_typeof(replay.value->'freshSeed') IS DISTINCT FROM 'number' OR
      jsonb_typeof(replay.value->'repeatSeed') IS DISTINCT FROM 'number'
  ) THEN RAISE EXCEPTION 'R3-E selector report seeds must be numbers'; END IF;

  BEGIN
    source_evidence_expires_at := (report_document->>'sourceEvidenceExpiresAt')::TIMESTAMPTZ;
    trust_expires_at := (report_document->>'trustExpiresAt')::TIMESTAMPTZ;
    proof_expires_at := (report_document->>'proofExpiresAt')::TIMESTAMPTZ;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'R3-E report validity timestamps are invalid';
  END;
  IF proof_expires_at IS DISTINCT FROM LEAST(source_evidence_expires_at,trust_expires_at) OR
     source_evidence_expires_at<=clock_timestamp() OR trust_expires_at<=clock_timestamp() OR proof_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'R3-E evidence or issuer trust has expired';
  END IF;

  report_bytes := convert_to(report_document::text,'UTF8');
  report_sha256 := encode(int4_crypto.digest(report_bytes,'sha256'),'hex');
  deterministic_proof_id := 'r3e-proof:'||encode(int4_crypto.digest(convert_to(p_release_id||':'||release_row."releaseRootHash"||':'||release_row."sealHash"||':'||policy_version,'UTF8'),'sha256'),'hex');
  INSERT INTO public."CatalogValidationProof"(
    "id","catalogReleaseId","releaseRootHash","sealHash","policyVersion","canonicalReportBytes","reportSha256",
    "sourceArtifactSha256","sourceSnapshotHash","sourceEvidenceManifestSha256","sourceEvidenceGenerationSha256","sourceSummarySha256",
    "selectorVersion","selectorBuildId","executableBuildSha256","databaseHelpersSha256","issuerTrustManifestSha256","issuerTrustGenerationSha256",
    "validatedAt","expiresAt"
  ) VALUES(
    deterministic_proof_id,p_release_id,release_row."releaseRootHash",release_row."sealHash",policy_version,report_bytes,report_sha256,
    p_source_artifact_sha256,p_snapshot_hash,p_source_evidence_manifest_sha256,p_source_evidence_generation_sha256,p_source_summary_sha256,
    p_selector_version,p_selector_build_id,p_executable_build_sha256,p_database_helpers_sha256,p_issuer_trust_manifest_sha256,p_issuer_trust_generation_sha256,
    clock_timestamp(),proof_expires_at
  ) ON CONFLICT ("catalogReleaseId","releaseRootHash","sealHash","policyVersion") DO NOTHING;
  SELECT * INTO stored_proof FROM public."CatalogValidationProof" p
    WHERE p."catalogReleaseId"=p_release_id AND p."releaseRootHash"=release_row."releaseRootHash"
      AND p."sealHash"=release_row."sealHash" AND p."policyVersion"=policy_version;
  IF NOT FOUND OR stored_proof."id"<>deterministic_proof_id OR stored_proof."canonicalReportBytes"<>report_bytes OR
     stored_proof."reportSha256"<>report_sha256 OR stored_proof."sourceArtifactSha256"<>p_source_artifact_sha256 OR
     stored_proof."sourceSnapshotHash"<>p_snapshot_hash OR stored_proof."sourceEvidenceManifestSha256"<>p_source_evidence_manifest_sha256 OR
     stored_proof."sourceEvidenceGenerationSha256"<>p_source_evidence_generation_sha256 OR stored_proof."sourceSummarySha256"<>p_source_summary_sha256 OR
     stored_proof."selectorVersion"<>p_selector_version OR stored_proof."selectorBuildId"<>p_selector_build_id OR
     stored_proof."executableBuildSha256"<>p_executable_build_sha256 OR stored_proof."databaseHelpersSha256"<>p_database_helpers_sha256 OR
     stored_proof."issuerTrustManifestSha256"<>p_issuer_trust_manifest_sha256 OR
     stored_proof."issuerTrustGenerationSha256"<>p_issuer_trust_generation_sha256 OR stored_proof."expiresAt"<>proof_expires_at THEN
    RAISE EXCEPTION 'R3-E issuance identity conflicts with immutable proof';
  END IF;
  deterministic_receipt_id := 'r3e-receipt:'||encode(int4_crypto.digest(convert_to(deterministic_proof_id,'UTF8'),'sha256'),'hex');
  INSERT INTO public."CatalogValidationReceipt"(
    "id","catalogReleaseId","releaseRootHash","sealHash","proofId","validatorRef","policyVersion","sourceEvidenceManifestHash","selectorVersion"
  ) VALUES(
    deterministic_receipt_id,p_release_id,release_row."releaseRootHash",release_row."sealHash",deterministic_proof_id,session_user,
    policy_version,p_source_summary_sha256,p_selector_version
  ) ON CONFLICT ("catalogReleaseId","releaseRootHash","sealHash","policyVersion")
    WHERE "policyVersion"='enta-r3e-private-issuer-v1' DO NOTHING;
  SELECT * INTO stored_receipt FROM public."CatalogValidationReceipt" r
    WHERE r."catalogReleaseId"=p_release_id AND r."releaseRootHash"=release_row."releaseRootHash"
      AND r."sealHash"=release_row."sealHash" AND r."policyVersion"=policy_version;
  IF NOT FOUND OR stored_receipt."id"<>deterministic_receipt_id OR stored_receipt."proofId"<>deterministic_proof_id OR
      stored_receipt."sourceEvidenceManifestHash"<>p_source_summary_sha256 OR stored_receipt."selectorVersion"<>p_selector_version THEN
    RAISE EXCEPTION 'R3-E receipt identity conflicts with immutable proof';
  END IF;
  RETURN QUERY SELECT stored_receipt."id",stored_proof."id",stored_proof."reportSha256";
END;
$$;
-- Add a separate, self-granted SET edge without changing the bootstrap DBA's
-- permanent ADMIN-only row. The migration below requires the exact 1 -> 2 -> 1
-- pg_auth_members transition and aborts if the provider merges or alters rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
      JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
      WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
        AND grantor_role.rolname='enta_catalog_migration_custodian') THEN
    RAISE EXCEPTION 'unexpected pre-existing custodian self-grant edge';
  END IF;
END $$;
GRANT CREATE ON SCHEMA public TO catalog_issuer;
GRANT catalog_issuer TO enta_catalog_migration_custodian WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        WHERE owner_role.rolname='catalog_issuer')<>2 OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
        WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
          AND grantor_role.rolname='enta_catalog_bootstrap_dba' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
        WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
          AND grantor_role.rolname='enta_catalog_migration_custodian' AND NOT m.admin_option AND m.set_option AND NOT m.inherit_option
    ) THEN RAISE EXCEPTION 'expected distinct bootstrap ADMIN and custodian temporary SET grant rows'; END IF;
END $$;
ALTER FUNCTION public.issue_r3e_catalog_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO catalog_issuer;
ALTER FUNCTION public.reject_r3e_direct_proof_insert() OWNER TO catalog_issuer;
ALTER FUNCTION public.require_r3e_proof_for_successor_receipt() OWNER TO catalog_issuer;
ALTER FUNCTION public.block_r3e_catalog_activation() OWNER TO catalog_issuer;
REVOKE catalog_issuer FROM enta_catalog_migration_custodian GRANTED BY enta_catalog_migration_custodian RESTRICT;
REVOKE CREATE ON SCHEMA public FROM catalog_issuer GRANTED BY enta_catalog_migration_custodian;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
      WHERE owner_role.rolname='catalog_issuer')<>1 OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
        WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
          AND grantor_role.rolname='enta_catalog_bootstrap_dba' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option
    ) THEN RAISE EXCEPTION 'bootstrap-DBA custodian grant row did not remain exact ADMIN-only state'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
      WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
        AND grantor_role.rolname='enta_catalog_migration_custodian') THEN
    RAISE EXCEPTION 'temporary custodian self-grant edge survived owner transfer';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
      WHERE member_role.rolname='enta_catalog_issuer_login') OR
     EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles granted_role ON granted_role.oid=m.roleid
      WHERE granted_role.rolname='enta_catalog_issuer_login') THEN
    RAISE EXCEPTION 'issuer login acquired an unexpected role membership edge';
  END IF;
  IF pg_has_role('enta_catalog_migration_custodian','catalog_issuer','SET') OR
     has_schema_privilege('catalog_issuer','public','CREATE') THEN
    RAISE EXCEPTION 'temporary SET or schema CREATE privilege remains after transfer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_roles function_owner ON function_owner.oid=p.proowner
      WHERE n.nspname='public' AND p.proname='issue_r3e_catalog_receipt' AND function_owner.rolname='catalog_issuer') OR
     (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_roles function_owner ON function_owner.oid=p.proowner
      WHERE n.nspname='public' AND p.proname IN ('reject_r3e_direct_proof_insert','require_r3e_proof_for_successor_receipt','block_r3e_catalog_activation')
        AND function_owner.rolname='catalog_issuer')<>3 THEN
    RAISE EXCEPTION 'fixed R3-E functions did not transfer to catalog_issuer';
  END IF;
END $$;

GRANT SELECT ON TABLE
  public."SourceCategoryCrosswalkRevision", public."CanonicalCategoryRevision", public."EditorialReviewReceipt", public."ContentRightsReceipt",
  public."QuestionRevision", public."QuestionAnswerRevision", public."MediaRevision", public."QuestionRevisionMedia", public."QuestionRevisionSeal",
  public."CatalogRelease", public."CatalogReleaseSourceSnapshot", public."CatalogReleaseCategory", public."CatalogReleaseQuestion",
  public."CatalogReleaseAvailability", public."CatalogReleaseSeal", public."CatalogValidationReceipt"
TO catalog_issuer, enta_catalog_issuer_login;
GRANT SELECT ON TABLE public."CatalogValidationProof" TO catalog_issuer;
GRANT INSERT ON TABLE public."CatalogValidationProof", public."CatalogValidationReceipt" TO catalog_issuer;
GRANT EXECUTE ON FUNCTION public.int4_question_payload(TEXT), public.int4_question_child_manifest(TEXT,TEXT),
  public.int4_category_payload(TEXT), public.int4_release_payload(TEXT) TO catalog_issuer, enta_catalog_issuer_login;
GRANT EXECUTE ON FUNCTION public.issue_r3e_catalog_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
TO enta_catalog_issuer_login;

REVOKE ALL ON public."CatalogValidationProof" FROM PUBLIC, enta_runtime, catalog_assembler, catalog_reviewer,
  catalog_publisher, catalog_validator, catalog_activator, enta_catalog_issuer_login;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public."CatalogValidationReceipt" FROM PUBLIC, enta_runtime, catalog_assembler,
  catalog_reviewer, catalog_publisher, catalog_validator, catalog_activator, enta_catalog_issuer_login;
REVOKE ALL ON FUNCTION public.issue_catalog_validation_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, enta_runtime, catalog_assembler, catalog_reviewer, catalog_publisher, catalog_validator, catalog_activator, catalog_issuer, enta_catalog_issuer_login;
REVOKE ALL ON FUNCTION public.activate_catalog_release(TEXT,TEXT) FROM catalog_issuer, enta_catalog_issuer_login;
REVOKE ALL ON FUNCTION public.issue_r3e_catalog_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, enta_runtime, catalog_assembler, catalog_reviewer, catalog_publisher, catalog_validator, catalog_activator, catalog_issuer;
GRANT USAGE ON SCHEMA public, int4_crypto TO catalog_issuer;
GRANT USAGE ON SCHEMA public TO enta_catalog_issuer_login;

COMMIT;
