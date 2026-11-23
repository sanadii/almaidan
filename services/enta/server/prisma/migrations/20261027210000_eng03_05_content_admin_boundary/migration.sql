-- PRO-310 ENG03-05: source draft, not an installed migration.
-- This file is incomplete until fixed routines and role inventory are present.
BEGIN;
CREATE TABLE public."HuroofAdminPrincipal" (
 "namespace" TEXT NOT NULL REFERENCES public."DeploymentNamespace"("namespaceId"), "identityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"),
 "enabled" BOOLEAN NOT NULL, "disabled" BOOLEAN NOT NULL, "authzVersion" BIGINT NOT NULL CHECK ("authzVersion">0), "identityReady" BOOLEAN NOT NULL DEFAULT false,
 "roles" TEXT[] NOT NULL CHECK (cardinality("roles") BETWEEN 1 AND 5 AND "roles" <@ ARRAY['super_admin','content_admin','reviewer','game_ops','viewer']::TEXT[]),
 "categoryScopes" TEXT[] NOT NULL CHECK (cardinality("categoryScopes")<=100), "reviewerScopes" TEXT[] NOT NULL CHECK (cardinality("reviewerScopes")<=100),
 "pendingSyncOperation" TEXT, "desiredAuthorizationHash" TEXT NOT NULL CHECK ("desiredAuthorizationHash" ~ '^[a-f0-9]{64}$'), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY ("namespace","identityId"),
 CHECK (NOT ('reviewer'=ANY("roles")) OR (cardinality("categoryScopes")>0 AND cardinality("reviewerScopes")>0))
);
CREATE TABLE public."HuroofAdminAuthzInvariant" ("namespace" TEXT PRIMARY KEY REFERENCES public."DeploymentNamespace"("namespaceId"), "revision" BIGINT NOT NULL CHECK ("revision">=0));
CREATE TABLE public."HuroofAdminOperation" (
 "namespace" TEXT NOT NULL REFERENCES public."DeploymentNamespace"("namespaceId"), "operationId" TEXT NOT NULL, "actorIdentityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"),
 "actorAuthzVersion" BIGINT NOT NULL CHECK ("actorAuthzVersion">0), "actorRoles" TEXT[] NOT NULL, "actorProjectId" TEXT NOT NULL, "actorPolicyRevision" TEXT NOT NULL, "actorPolicyHash" TEXT NOT NULL CHECK("actorPolicyHash" ~ '^[a-f0-9]{64}$'), "action" TEXT NOT NULL, "target" TEXT NOT NULL, "scope" TEXT,
 "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'), "expectedRevision" BIGINT, "resultRevision" BIGINT NOT NULL CHECK ("resultRevision">=0),
 "resultCode" TEXT NOT NULL, "result" JSONB NOT NULL, "committedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","operationId")
);
CREATE TABLE public."HuroofAdminIdentitySyncOutcome" (
 "namespace" TEXT NOT NULL, "operationId" TEXT NOT NULL, "targetIdentityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "targetAuthzVersion" BIGINT NOT NULL CHECK ("targetAuthzVersion">0),
 "desiredAuthorizationHash" TEXT NOT NULL CHECK ("desiredAuthorizationHash" ~ '^[a-f0-9]{64}$'), "outcome" TEXT NOT NULL CHECK ("outcome" IN ('identity_synced','identity_sync_failed')),
 "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","operationId"),
 FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminAudit" (
 "namespace" TEXT NOT NULL, "operationId" TEXT NOT NULL, "eventKind" TEXT NOT NULL CHECK ("eventKind" IN ('mutation','identity_sync')),
 "actorIdentityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "actorRoles" TEXT[] NOT NULL, "action" TEXT NOT NULL, "target" TEXT NOT NULL, "scope" TEXT,
 "requestHash" TEXT NOT NULL CHECK("requestHash" ~ '^[a-f0-9]{64}$'), "expectedRevision" BIGINT, "resultRevision" BIGINT NOT NULL, "resultCode" TEXT NOT NULL,
 "evidence" JSONB, "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","operationId","eventKind"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminRateWindow" (
 "namespace" TEXT NOT NULL REFERENCES public."DeploymentNamespace"("namespaceId"), "identityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"),
 "windowStart" TIMESTAMPTZ(3) NOT NULL, "count" INTEGER NOT NULL CHECK("count" BETWEEN 1 AND 120), "expiresAt" TIMESTAMPTZ(3) NOT NULL, PRIMARY KEY("namespace","identityId","windowStart")
);
CREATE TABLE public."HuroofAdminQuestionDraftRevision" (
 "namespace" TEXT NOT NULL, "questionId" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "authorIdentityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "createdBy" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"),
 "categoryId" TEXT NOT NULL, "modality" TEXT NOT NULL CHECK("modality" IN ('classic','image','charades')), "status" TEXT NOT NULL CHECK("status" IN ('draft','ready_for_review','in_review','changes_requested','archived')),
 "headerAr" TEXT NOT NULL CHECK(length("headerAr")<=240), "promptAr" TEXT NOT NULL CHECK(length("promptAr")<=4000), "canonicalAnswer" TEXT NOT NULL CHECK(length("canonicalAnswer")<=1000),
 "acceptedAnswers" TEXT[] NOT NULL CHECK(cardinality("acceptedAnswers") BETWEEN 1 AND 32), "specialistRoles" TEXT[] NOT NULL, "sources" JSONB NOT NULL,
 "contentHash" TEXT NOT NULL CHECK("contentHash" ~ '^[a-f0-9]{64}$'), "reviewBindingHash" TEXT NOT NULL CHECK("reviewBindingHash" ~ '^[a-f0-9]{64}$'), "predecessorRevision" BIGINT, "predecessorHash" TEXT, "operationId" TEXT NOT NULL,
 PRIMARY KEY("namespace","questionId","revision"), UNIQUE("namespace","questionId","revision","reviewBindingHash"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminReviewRevision" (
 "namespace" TEXT NOT NULL, "reviewId" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "questionId" TEXT NOT NULL, "submittedQuestionRevision" BIGINT NOT NULL, "submittedQuestionHash" TEXT NOT NULL,
 "categoryId" TEXT NOT NULL, "authorIdentityId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "status" TEXT NOT NULL CHECK("status" IN ('in_review','changes_requested')), "decidedBy" TEXT REFERENCES public."FirebaseIdentity"("id"), "reason" TEXT CHECK(length("reason")<=2000), "operationId" TEXT NOT NULL,
 PRIMARY KEY("namespace","reviewId","revision"), FOREIGN KEY("namespace","questionId","submittedQuestionRevision","submittedQuestionHash") REFERENCES public."HuroofAdminQuestionDraftRevision"("namespace","questionId","revision","reviewBindingHash"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminPublishedQuestionInspection" (
 "namespace" TEXT NOT NULL, "releaseId" TEXT NOT NULL, "questionId" TEXT NOT NULL, "releaseRootHash" TEXT NOT NULL CHECK("releaseRootHash" ~ '^[a-f0-9]{64}$'), "digestKind" TEXT NOT NULL CHECK("digestKind"='release-question-document-raw-sha256-v1'), "questionDocumentDigest" TEXT NOT NULL CHECK("questionDocumentDigest" ~ '^[a-f0-9]{64}$'), "categoryId" TEXT NOT NULL,
 "inspectedBy" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "inspectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "operationId" TEXT NOT NULL, "revision" BIGINT NOT NULL DEFAULT 1 CHECK("revision"=1),
 PRIMARY KEY("namespace","releaseId","questionId"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminCategoryCorrectionRevision" (
 "namespace" TEXT NOT NULL, "categoryId" TEXT NOT NULL, "releaseId" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "baseReleaseRootHash" TEXT NOT NULL CHECK("baseReleaseRootHash" ~ '^[a-f0-9]{64}$'),
 "publishedLabelAr" TEXT NOT NULL CHECK(length("publishedLabelAr")<=160), "proposedLabelAr" TEXT NOT NULL CHECK(length("proposedLabelAr")<=160), "internalNote" TEXT NOT NULL CHECK(length("internalNote")<=2000), "status" TEXT NOT NULL CHECK("status"='draft'),
 "originalAuthorId" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "updatedBy" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "predecessorRevision" BIGINT, "predecessorHash" TEXT, "operationId" TEXT NOT NULL,
 PRIMARY KEY("namespace","categoryId","releaseId","revision"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminCategoryMetadataRevision" (
 "namespace" TEXT NOT NULL, "categoryId" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "titleAr" TEXT CHECK(length("titleAr")<=160), "descriptionAr" TEXT CHECK(length("descriptionAr")<=1000), "enabled" BOOLEAN,
 "updatedBy" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "operationId" TEXT NOT NULL, "predecessorRevision" BIGINT, "predecessorHash" TEXT, PRIMARY KEY("namespace","categoryId","revision"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TABLE public."HuroofAdminSettingsRevision" (
 "namespace" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK("schemaVersion"=1), "maintenanceMode" BOOLEAN NOT NULL, "maintenanceMessageAr" TEXT NOT NULL CHECK(length("maintenanceMessageAr")<=500), "roomCreationEnabled" BOOLEAN NOT NULL,
 "defaultQuestionTimerSeconds" INTEGER NOT NULL CHECK("defaultQuestionTimerSeconds" BETWEEN 5 AND 600), "defaultOpponentTimerSeconds" INTEGER NOT NULL CHECK("defaultOpponentTimerSeconds" BETWEEN 3 AND 300), "roomRetentionDays" INTEGER NOT NULL CHECK("roomRetentionDays" BETWEEN 1 AND 365),
 "updatedBy" TEXT NOT NULL REFERENCES public."FirebaseIdentity"("id"), "operationId" TEXT NOT NULL, "predecessorRevision" BIGINT, "predecessorHash" TEXT, PRIMARY KEY("namespace","revision"), FOREIGN KEY("namespace","operationId") REFERENCES public."HuroofAdminOperation"("namespace","operationId")
);
CREATE TRIGGER "HuroofAdminOperation_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminOperation" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminOperation_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminOperation" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminIdentitySyncOutcome_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminIdentitySyncOutcome" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminIdentitySyncOutcome_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminIdentitySyncOutcome" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminAudit_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminAudit" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminAudit_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminAudit" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminQuestionDraftRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminQuestionDraftRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminQuestionDraftRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminQuestionDraftRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminReviewRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminReviewRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminReviewRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminReviewRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminPublishedQuestionInspection_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminPublishedQuestionInspection" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminPublishedQuestionInspection_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminPublishedQuestionInspection" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminCategoryCorrectionRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminCategoryCorrectionRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminCategoryCorrectionRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminCategoryCorrectionRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminCategoryMetadataRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminCategoryMetadataRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminCategoryMetadataRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminCategoryMetadataRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdminSettingsRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofAdminSettingsRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofAdminSettingsRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdminSettingsRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE FUNCTION public.eng03_05_lock_namespace(p_namespace TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public."HuroofAdminAuthzInvariant"("namespace","revision") SELECT "namespaceId",0 FROM public."DeploymentNamespace" WHERE "namespaceId"=p_namespace ON CONFLICT("namespace") DO NOTHING;
 PERFORM 1 FROM public."HuroofAdminAuthzInvariant" WHERE "namespace"=p_namespace FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'admin unavailable'; END IF;
END $$;
-- Context is built by the verified service, never request JSON. Token verification
-- is not provided by this SQL function. Category checks belong to each operation.
CREATE FUNCTION public.eng03_05_assert_admin(c JSONB, required TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."HuroofAdminPrincipal"%ROWTYPE; claim_roles TEXT[]; live_caps TEXT[];
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>9 OR NOT c ?& ARRAY['namespace','projectId','identityId','claimAuthzVersion','claimRoles','provider','emailVerified','policyRevision','policyHash'] OR
    jsonb_typeof(c->'claimRoles') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'emailVerified') IS DISTINCT FROM 'boolean' OR c->'emailVerified' IS DISTINCT FROM 'true'::jsonb OR
    c->>'provider' NOT IN ('password','google.com') OR (c->>'claimAuthzVersion') !~ '^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'admin unavailable'; END IF;
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 SELECT array_agg(v ORDER BY v) INTO claim_roles FROM jsonb_array_elements_text(c->'claimRoles') AS e(v);
 IF cardinality(claim_roles) NOT BETWEEN 1 AND 5 OR cardinality(claim_roles)<>(SELECT count(DISTINCT v) FROM unnest(claim_roles) AS e(v)) THEN RAISE EXCEPTION 'admin unavailable'; END IF;
 SELECT p.* INTO a FROM public."HuroofAdminPrincipal" p JOIN public."DeploymentNamespace" n ON n."namespaceId"=p."namespace" JOIN public."FirebaseIdentity" i ON i."id"=p."identityId" AND i."firebaseProjectId"=n."firebaseProjectId"
 WHERE p."namespace"=c->>'namespace' AND p."identityId"=c->>'identityId' AND n."firebaseProjectId"=c->>'projectId' FOR UPDATE OF p;
 IF NOT FOUND OR NOT a."enabled" OR a."disabled" OR NOT a."identityReady" OR a."authzVersion"<>(c->>'claimAuthzVersion')::BIGINT OR a."roles" IS DISTINCT FROM claim_roles THEN RAISE EXCEPTION 'admin unavailable'; END IF;
 live_caps:=ARRAY[]::TEXT[];
 IF 'super_admin'=ANY(a."roles") THEN live_caps:=ARRAY['session','questions.read','questions.inspect','questions.write','reviews.read','reviews.decide','categories.read','categories.write','releases.read','releases.stage','rooms.read','rooms.act','users.read','users.write','audit.read','health.read','settings.read','settings.write']; END IF;
 IF 'content_admin'=ANY(a."roles") THEN live_caps:=live_caps||ARRAY['session','questions.read','questions.inspect','questions.write','reviews.read','categories.read','categories.write','releases.read','releases.stage','audit.read','health.read','settings.read']; END IF;
 IF 'reviewer'=ANY(a."roles") THEN live_caps:=live_caps||ARRAY['session','questions.read','questions.inspect','reviews.read','reviews.decide','categories.read','audit.read','health.read']; END IF;
 IF 'game_ops'=ANY(a."roles") THEN live_caps:=live_caps||ARRAY['session','rooms.read','rooms.act','audit.read','health.read']; END IF;
 IF 'viewer'=ANY(a."roles") THEN live_caps:=live_caps||ARRAY['session','questions.read','reviews.read','categories.read','releases.read','rooms.read','audit.read','health.read','settings.read']; END IF;
 IF NOT required=ANY(live_caps) THEN RAISE EXCEPTION 'admin unavailable'; END IF;
 RETURN jsonb_build_object('namespace',a."namespace",'projectId',c->>'projectId','identityId',a."identityId",'enabled',a."enabled",'disabled',a."disabled",'identityReady',a."identityReady",'authzVersion',a."authzVersion",'roles',to_jsonb(a."roles"),'categoryScopes',to_jsonb(a."categoryScopes"),'reviewerScopes',to_jsonb(a."reviewerScopes"));
END $$;
CREATE FUNCTION public.eng03_05_principal(c JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM public.eng03_05_lock_namespace(c->>'namespace'); RETURN public.eng03_05_assert_admin(c,'session'); END $$;
CREATE FUNCTION public.eng03_05_rate_take(c JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t TIMESTAMPTZ; now_ts TIMESTAMPTZ; n INTEGER;
BEGIN
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); PERFORM public.eng03_05_assert_admin(c,'session'); now_ts:=clock_timestamp(); t:=date_trunc('minute',now_ts);
 INSERT INTO public."HuroofAdminRateWindow"("namespace","identityId","windowStart","count","expiresAt") VALUES(c->>'namespace',c->>'identityId',t,1,now_ts+interval '5 minutes')
 ON CONFLICT ("namespace","identityId","windowStart") DO UPDATE SET "count"=public."HuroofAdminRateWindow"."count"+1 WHERE public."HuroofAdminRateWindow"."count"<120 RETURNING "count" INTO n;
 IF NOT FOUND THEN RAISE EXCEPTION 'rate exceeded'; END IF; RETURN jsonb_build_object('count',n);
END $$;
-- Owner-only lexical helper: never JSONB-reserialize document elements for hashing.
CREATE FUNCTION public.eng03_05_snapshot_documents_root(p_bytes BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j JSON; release_id TEXT; root_text TEXT; bad BOOLEAN; docs_count BIGINT;
BEGIN
 IF p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 67108864 THEN RAISE EXCEPTION 'snapshot unavailable'; END IF;
 j:=convert_from(p_bytes,'UTF8')::JSON;
 IF json_typeof(j) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM json_each(j))<>3 OR (SELECT count(DISTINCT key) FROM json_each(j))<>3 OR EXISTS(SELECT 1 FROM json_each(j) WHERE key NOT IN ('documents','releaseId','schemaVersion')) OR j->>'schemaVersion' IS DISTINCT FROM 'huroof-release-snapshot-v1' OR json_typeof(j->'releaseId') IS DISTINCT FROM 'string' OR j->>'releaseId' !~ '^[A-Za-z0-9_-]{1,120}$' OR json_typeof(j->'documents') IS DISTINCT FROM 'array' OR json_array_length(j->'documents')>100000 THEN RAISE EXCEPTION 'snapshot unavailable'; END IF;
 release_id:=j->>'releaseId';
 WITH RECURSIVE walk(v,depth) AS (
  SELECT j,0 UNION ALL
  SELECT child.v,w.depth+1 FROM walk w CROSS JOIN LATERAL (
   SELECT value v FROM json_each(CASE WHEN json_typeof(w.v)='object' THEN w.v ELSE '{}'::JSON END)
   UNION ALL SELECT value v FROM json_array_elements(CASE WHEN json_typeof(w.v)='array' THEN w.v ELSE '[]'::JSON END)
  ) child WHERE w.depth<=64
 ) SELECT EXISTS(SELECT 1 FROM walk WHERE depth>64) INTO bad;
 IF bad THEN RAISE EXCEPTION 'snapshot unavailable'; END IF;
 WITH docs AS (SELECT value elem,value->>'path' path,value->'data' data FROM json_array_elements(j->'documents'))
 SELECT count(*),COALESCE(bool_or(json_typeof(elem) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM json_each(elem))<>2 OR (SELECT count(DISTINCT key) FROM json_each(elem))<>2 OR EXISTS(SELECT 1 FROM json_each(elem) WHERE key NOT IN ('data','path')) OR json_typeof(elem->'path') IS DISTINCT FROM 'string' OR json_typeof(data) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM json_each(data))<>(SELECT count(DISTINCT key) FROM json_each(data)) OR path !~ ('^releases/'||release_id||'/(catalogCategories|questions|inventory)/[A-Za-z0-9_-]{1,120}$')),false) OR count(*)<>count(DISTINCT path) INTO docs_count,bad FROM docs;
 IF bad THEN RAISE EXCEPTION 'snapshot unavailable'; END IF;
 WITH docs AS (SELECT value elem,value->>'path' path,value->'data' data,split_part(value->>'path','/',3) family,split_part(value->>'path','/',4) doc_id FROM json_array_elements(j->'documents'))
 SELECT EXISTS(SELECT 1 FROM docs WHERE (family='catalogCategories' AND data->>'id' IS DISTINCT FROM doc_id) OR (family='questions' AND (data->>'id' IS DISTINCT FROM doc_id OR data->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$')) OR (family='inventory' AND (data->>'categoryId' IS DISTINCT FROM doc_id OR json_typeof(data->'approvedCount') IS DISTINCT FROM 'number' OR data->>'approvedCount' !~ '^[1-9][0-9]{0,15}$' OR (data->>'approvedCount')::NUMERIC>9007199254740991))) OR
 EXISTS(SELECT 1 FROM docs c WHERE c.family='catalogCategories' AND (NOT EXISTS(SELECT 1 FROM docs i WHERE i.family='inventory' AND i.doc_id=c.doc_id) OR NOT EXISTS(SELECT 1 FROM docs q WHERE q.family='questions' AND q.data->>'categoryId'=c.doc_id))) OR
 EXISTS(SELECT 1 FROM docs i WHERE i.family='inventory' AND (NOT EXISTS(SELECT 1 FROM docs c WHERE c.family='catalogCategories' AND c.doc_id=i.doc_id) OR (i.data->>'approvedCount')::NUMERIC<>(SELECT count(*) FROM docs q WHERE q.family='questions' AND q.data->>'categoryId'=i.doc_id))) OR
 EXISTS(SELECT 1 FROM docs q WHERE q.family='questions' AND NOT EXISTS(SELECT 1 FROM docs c WHERE c.family='catalogCategories' AND c.doc_id=q.data->>'categoryId')) INTO bad;
 IF bad THEN RAISE EXCEPTION 'snapshot unavailable'; END IF;
 SELECT '['||COALESCE(string_agg(elem::TEXT,',' ORDER BY path COLLATE "C"),'')||']' INTO root_text FROM (SELECT value elem,value->>'path' path FROM json_array_elements(j->'documents')) d;
 RETURN encode(int4_crypto.digest(convert_to(root_text,'UTF8'),'sha256'),'hex');
END $$;
CREATE FUNCTION public.eng03_05_snapshot_read(c JSONB, p_scope TEXT, p_release TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; ptr public."HuroofContentPointer"%ROWTYPE; rev public."HuroofContentRevision"%ROWTYPE; prof public."HuroofRawArtifact"%ROWTYPE; snap public."HuroofRawArtifact"%ROWTYPE; rec public."CatalogValidationReceipt"%ROWTYPE; ref JSONB;
BEGIN
 IF (p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_scope='huroof-release-snapshot-v1') OR p_release !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'content unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.read');
 PERFORM 1 FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 SELECT * INTO ptr FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope","family")=(c->>'namespace','profile',p_scope,'profile') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;

 SELECT * INTO rev FROM public."HuroofContentRevision" WHERE ("namespace","family","sourceId","revision","rawArtifactHash")=(ptr."namespace",ptr."family",ptr."sourceId",ptr."revision",ptr."rawArtifactHash");
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 SELECT * INTO prof FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash")=(rev."namespace",rev."rawArtifactId",rev."rawArtifactHash") AND "byteLength" BETWEEN 1 AND 67108864 AND octet_length("provenanceBytes")<=67108864;
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 SELECT receipt.* INTO rec FROM public."CatalogValidationReceipt" receipt JOIN public."ActiveCatalogPointer" active ON active."id"='singleton' AND (active."validationReceiptId",active."catalogReleaseId",active."releaseRootHash")=(receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash") JOIN public."CatalogReleaseSeal" seal ON (seal."catalogReleaseId",seal."releaseRootHash",seal."sealHash")=(receipt."catalogReleaseId",receipt."releaseRootHash",receipt."sealHash")
 WHERE (receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash")=(rev."validationReceiptId",rev."catalogReleaseId",rev."releaseRootHash") AND receipt."huroofProjectId"=c->>'projectId' AND receipt."huroofReleaseId"=p_release;
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 ref:=convert_from(prof."rawBytes",'UTF8')::JSONB->'contentSnapshot';
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref->>'namespace' IS DISTINCT FROM c->>'namespace' OR ref->>'serialization' IS DISTINCT FROM 'huroof-release-snapshot-v1' OR ref->>'mediaType' IS DISTINCT FROM 'application/json' THEN RAISE EXCEPTION 'content unavailable'; END IF;
 SELECT * INTO snap FROM public."HuroofRawArtifact" WHERE "namespace"=c->>'namespace' AND "id"=ref->>'id' AND "contentHash"=ref->>'hash' AND "byteLength"::TEXT=ref->>'byteLength' AND "mediaType"=ref->>'mediaType' AND "serialization"=ref->>'serialization' AND "provenanceHash"=ref->>'provenanceHash' AND "byteLength" BETWEEN 1 AND 67108864 AND octet_length("provenanceBytes")<=67108864;
 IF NOT FOUND OR public.eng03_05_snapshot_documents_root(snap."rawBytes") IS DISTINCT FROM rec."huroofRootSha256" THEN RAISE EXCEPTION 'content unavailable'; END IF;
 RETURN jsonb_build_object('registry',live,'namespace',ptr."namespace",'projectId',c->>'projectId','profileScope',ptr."scope",'pointerVersion',ptr."version"::TEXT,'profileSourceId',rev."sourceId",'profileRevision',rev."revision"::TEXT,
 'profileId',prof."id",'profileHash',prof."contentHash",'profileLength',prof."byteLength"::TEXT,'profileMediaType',prof."mediaType",'profileSerialization',prof."serialization",'profileProvenanceHash',prof."provenanceHash",'profileBase64',replace(replace(encode(prof."rawBytes",'base64'),chr(10),''),chr(13),''),'profileProvenanceBase64',replace(replace(encode(prof."provenanceBytes",'base64'),chr(10),''),chr(13),''),
 'releaseId',rec."huroofReleaseId",'releaseRoot',rec."huroofRootSha256",'receiptId',rec."id",'catalogId',rec."catalogReleaseId",'catalogRoot',rec."releaseRootHash",'sealHash',rec."sealHash",
 'snapshotId',snap."id",'snapshotHash',snap."contentHash",'snapshotLength',snap."byteLength"::TEXT,'snapshotMediaType',snap."mediaType",'snapshotSerialization',snap."serialization",'snapshotProvenanceHash',snap."provenanceHash",'snapshotBase64',replace(replace(encode(snap."rawBytes",'base64'),chr(10),''),chr(13),''),'snapshotProvenanceBase64',replace(replace(encode(snap."provenanceBytes",'base64'),chr(10),''),chr(13),''));
END $$;
CREATE FUNCTION public.eng03_05_media_authorize(c JSONB, subject JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; base JSONB; doc JSONB; doc_elem JSON; question_digest TEXT; q JSONB; binding JSONB; provenance JSONB; media public."HuroofMediaRevision"%ROWTYPE; raw public."HuroofRawArtifact"%ROWTYPE; matches INTEGER; category TEXT; epoch TEXT;
BEGIN
 IF jsonb_typeof(subject) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(subject))<>5 OR NOT subject ?& ARRAY['mode','profileScope','releaseId','questionId','variant'] OR subject->>'mode'<>'published-preview' OR subject->>'variant' NOT IN ('question','answer') OR subject->>'questionId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'media unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.read');
 base:=public.eng03_05_snapshot_read(c,subject->>'profileScope',subject->>'releaseId');
 SELECT value INTO doc_elem FROM json_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSON->'documents') WHERE value->>'path'='releases/'||(subject->>'releaseId')||'/questions/'||(subject->>'questionId'); doc:=(doc_elem->'data')::JSONB; question_digest:=encode(int4_crypto.digest(convert_to(doc_elem::TEXT,'UTF8'),'sha256'),'hex');
 IF doc IS NULL OR doc->>'id' IS DISTINCT FROM subject->>'questionId' OR doc->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'media unavailable'; END IF;
 category:=doc->>'categoryId';
 IF NOT ((live->'roles') ? 'super_admin') AND NOT ((live->'categoryScopes') ? category) THEN RAISE EXCEPTION 'media unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSONB->'documents') d WHERE d->>'path'='releases/'||(subject->>'releaseId')||'/catalogCategories/'||category AND d->'data'->>'id'=category) THEN RAISE EXCEPTION 'media unavailable'; END IF;
 q:=(CASE WHEN subject->>'variant'='question' THEN doc->'media' ELSE doc->'answerMedia' END);
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR q->>'mediaId' !~ '^[A-Za-z0-9:_-]{1,128}$' OR q->>'assetSha256' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'media unavailable'; END IF;
 SELECT count(*) INTO matches FROM public."HuroofMediaRevision" WHERE "namespace"=c->>'namespace' AND "objectId"=q->>'mediaId' AND "contentHash"=q->>'assetSha256';
 IF matches<>1 THEN RAISE EXCEPTION 'media unavailable'; END IF;
 SELECT * INTO media FROM public."HuroofMediaRevision" WHERE "namespace"=c->>'namespace' AND "objectId"=q->>'mediaId' AND "contentHash"=q->>'assetSha256';
 SELECT * INTO raw FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash","mediaType","byteLength","provenanceHash")=(media."namespace",media."rawArtifactId",media."contentHash",media."mediaType",media."byteLength",media."provenanceHash") AND "mediaType" IN ('image/png','image/jpeg','video/mp4') AND "byteLength" BETWEEN 1 AND 1000000 AND octet_length("provenanceBytes")<=65536;
 IF NOT FOUND THEN RAISE EXCEPTION 'media unavailable'; END IF;
 provenance:=convert_from(raw."provenanceBytes",'UTF8')::JSONB;
 IF convert_from(raw."provenanceBytes",'UTF8') IS DISTINCT FROM public.int5b_canonical_json(provenance) OR jsonb_typeof(provenance) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(provenance))<>9 OR NOT provenance ?& ARRAY['schemaVersion','namespace','profileScope','releaseId','questionId','variant','mediaId','generation','contentHash'] OR provenance->>'schemaVersion'<>'huroof-admin-media-binding-v1' OR provenance->>'namespace' IS DISTINCT FROM c->>'namespace' OR provenance->>'profileScope' IS DISTINCT FROM subject->>'profileScope' OR provenance->>'releaseId' IS DISTINCT FROM subject->>'releaseId' OR provenance->>'questionId' IS DISTINCT FROM subject->>'questionId' OR provenance->>'variant' IS DISTINCT FROM subject->>'variant' OR provenance->>'mediaId' IS DISTINCT FROM media."objectId" OR provenance->>'generation' IS DISTINCT FROM media."generation"::TEXT OR provenance->>'contentHash' IS DISTINCT FROM media."contentHash" THEN RAISE EXCEPTION 'media unavailable'; END IF;
 epoch:=encode(int4_crypto.digest(convert_to(jsonb_build_object('namespace',c->>'namespace','identity',c->>'identityId','authzVersion',c->>'claimAuthzVersion','policyRevision',c->>'policyRevision','policyHash',c->>'policyHash','scope',subject->>'profileScope','release',subject->>'releaseId','pointerVersion',base->>'pointerVersion','releaseRoot',base->>'releaseRoot','question',subject->>'questionId','variant',subject->>'variant','category',category,'mediaId',media."objectId",'generation',media."generation"::TEXT,'hash',media."contentHash",'provenanceHash',media."provenanceHash")::TEXT,'UTF8'),'sha256'),'hex');
 binding:=jsonb_build_object('epoch',epoch,'objectId',media."objectId",'generation',media."generation"::TEXT,'hash',media."contentHash",'byteLength',media."byteLength",'mediaType',media."mediaType",'provenanceHash',media."provenanceHash");
 RETURN jsonb_build_object('binding',binding,'baseline',jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','profileScope',subject->>'profileScope','pointerVersion',base->>'pointerVersion','profileSourceId',base->>'profileSourceId','profileRevision',base->>'profileRevision','profileHash',base->>'profileHash','snapshotHash',base->>'snapshotHash','releaseId',subject->>'releaseId','releaseRoot',base->>'releaseRoot','receiptId',base->>'receiptId','catalogId',base->>'catalogId','catalogRoot',base->>'catalogRoot','sealHash',base->>'sealHash','questionId',subject->>'questionId','questionDocumentDigest',question_digest,'categoryId',category,'variant',subject->>'variant'),'base64',replace(replace(encode(raw."rawBytes",'base64'),chr(10),''),chr(13),''),'provenanceBase64',replace(replace(encode(raw."provenanceBytes",'base64'),chr(10),''),chr(13),''));
END $$;
CREATE FUNCTION public.eng03_05_replay(c JSONB, m JSONB, p_action TEXT, p_target TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old public."HuroofAdminOperation"%ROWTYPE;
BEGIN
 IF jsonb_typeof(m) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(m))<>3 OR NOT m ?& ARRAY['operationId','requestHash','expectedRevision'] OR m->>'operationId' !~ '^[A-Za-z0-9_-]{1,120}$' OR m->>'requestHash' !~ '^[a-f0-9]{64}$' OR (m->'expectedRevision'<>'null'::JSONB AND (jsonb_typeof(m->'expectedRevision') NOT IN ('number','string') OR m->>'expectedRevision' !~ '^(0|[1-9][0-9]{0,18})$' OR (m->>'expectedRevision')::NUMERIC>9223372036854775806 OR (jsonb_typeof(m->'expectedRevision')='number' AND (m->>'expectedRevision')::NUMERIC>9007199254740990))) THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 SELECT * INTO old FROM public."HuroofAdminOperation" WHERE ("namespace","operationId")=(c->>'namespace',m->>'operationId');
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF old."actorIdentityId" IS DISTINCT FROM c->>'identityId' OR old."action" IS DISTINCT FROM p_action OR old."target" IS DISTINCT FROM p_target OR old."requestHash" IS DISTINCT FROM m->>'requestHash' OR old."expectedRevision" IS DISTINCT FROM (CASE WHEN m->'expectedRevision'='null'::JSONB THEN NULL ELSE (m->>'expectedRevision')::BIGINT END) THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 RETURN old."result";
END $$;
CREATE FUNCTION public.eng03_05_append_audit(p_namespace TEXT,p_operation TEXT,p_kind TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public."HuroofAdminAudit"("namespace","operationId","eventKind","actorIdentityId","actorRoles","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","evidence")
 SELECT "namespace","operationId",p_kind,"actorIdentityId","actorRoles","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode",CASE WHEN "action"='published-question.inspection.mark' THEN jsonb_build_object('digestKind',"result"->'digestKind','questionDocumentDigest',"result"->'questionDocumentDigest','releaseRoot',"result"->'releaseRoot') WHEN "action"='category.correction-draft.save' THEN jsonb_build_object('releaseRoot',"result"->'releaseRoot','publishedLabelAr',"result"->'publishedLabelAr') ELSE "result"->'authority' END FROM public."HuroofAdminOperation" WHERE ("namespace","operationId")=(p_namespace,p_operation);
 IF NOT FOUND THEN RAISE EXCEPTION 'audit unavailable'; END IF;
END $$;
CREATE FUNCTION public.eng03_05_settings_get(c JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."HuroofAdminSettingsRevision"%ROWTYPE;
BEGIN
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); PERFORM public.eng03_05_assert_admin(c,'settings.read');
 SELECT * INTO s FROM public."HuroofAdminSettingsRevision" WHERE "namespace"=c->>'namespace' ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('revision',0,'schemaVersion',1,'maintenanceMode',false,'maintenanceMessageAr','','roomCreationEnabled',true,'defaultQuestionTimerSeconds',30,'defaultOpponentTimerSeconds',10,'roomRetentionDays',30); END IF;
 RETURN jsonb_build_object('revision',s."revision",'schemaVersion',s."schemaVersion",'maintenanceMode',s."maintenanceMode",'maintenanceMessageAr',s."maintenanceMessageAr",'roomCreationEnabled',s."roomCreationEnabled",'defaultQuestionTimerSeconds',s."defaultQuestionTimerSeconds",'defaultOpponentTimerSeconds',s."defaultOpponentTimerSeconds",'roomRetentionDays',s."roomRetentionDays");
END $$;
CREATE FUNCTION public.eng03_05_settings_update(c JSONB,m JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; old JSONB; previous JSONB; merged JSONB; expected BIGINT; result JSONB; v TEXT;
BEGIN
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'settings.write');
 IF NOT (live->'roles' ? 'super_admin') OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('maintenanceMode','maintenanceMessageAr','roomCreationEnabled','defaultQuestionTimerSeconds','defaultOpponentTimerSeconds','roomRetentionDays')) THEN RAISE EXCEPTION 'settings unavailable'; END IF;
 old:=public.eng03_05_replay(c,m,'settings.update','runtime');
 IF public.int5b_hash_json(jsonb_build_object('action','settings.update','target','runtime','expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 IF old IS NOT NULL THEN RETURN old; END IF;
 IF m->'expectedRevision'='null'::JSONB THEN RAISE EXCEPTION 'settings unavailable'; END IF; expected:=(m->>'expectedRevision')::BIGINT;
 previous:=public.eng03_05_settings_get(c); IF (previous->>'revision')::BIGINT<>expected THEN RAISE EXCEPTION 'stale revision'; END IF; merged:=previous||p;
 IF jsonb_typeof(merged->'maintenanceMode') IS DISTINCT FROM 'boolean' OR jsonb_typeof(merged->'roomCreationEnabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(merged->'maintenanceMessageAr') IS DISTINCT FROM 'string' OR length(merged->>'maintenanceMessageAr')>500 THEN RAISE EXCEPTION 'settings unavailable'; END IF;
 FOREACH v IN ARRAY ARRAY['defaultQuestionTimerSeconds','defaultOpponentTimerSeconds','roomRetentionDays'] LOOP IF jsonb_typeof(merged->v) IS DISTINCT FROM 'number' OR merged->>v !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'settings unavailable'; END IF; END LOOP;
 IF (merged->>'defaultQuestionTimerSeconds')::INTEGER NOT BETWEEN 5 AND 600 OR (merged->>'defaultOpponentTimerSeconds')::INTEGER NOT BETWEEN 3 AND 300 OR (merged->>'roomRetentionDays')::INTEGER NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'settings unavailable'; END IF;
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','updated');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','settings.update','runtime',m->>'requestHash',expected,expected+1,'updated',result);
 INSERT INTO public."HuroofAdminSettingsRevision"("namespace","revision","maintenanceMode","maintenanceMessageAr","roomCreationEnabled","defaultQuestionTimerSeconds","defaultOpponentTimerSeconds","roomRetentionDays","updatedBy","operationId","predecessorRevision","predecessorHash") VALUES(c->>'namespace',expected+1,(merged->>'maintenanceMode')::BOOLEAN,merged->>'maintenanceMessageAr',(merged->>'roomCreationEnabled')::BOOLEAN,(merged->>'defaultQuestionTimerSeconds')::INTEGER,(merged->>'defaultOpponentTimerSeconds')::INTEGER,(merged->>'roomRetentionDays')::INTEGER,c->>'identityId',m->>'operationId',CASE WHEN expected=0 THEN NULL ELSE expected END,CASE WHEN expected=0 THEN NULL ELSE public.int5b_hash_json(previous) END);
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_registry_change(c JSONB,m JSONB,p_target TEXT,p_mode TEXT,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; target public."HuroofAdminPrincipal"%ROWTYPE; prior JSONB; expected BIGINT; v BIGINT; rs TEXT[]; cats TEXT[]; specialists TEXT[]; enabled BOOLEAN; disabled BOOLEAN; desired TEXT; result JSONB; action TEXT;
BEGIN
 IF p_mode NOT IN ('role','status','revoke') OR p_target !~ '^[A-Za-z0-9._:-]{1,200}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'registry unavailable'; END IF;
 action:='user.'||p_mode;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace');
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 PERFORM 1 FROM public."HuroofAdminPrincipal" WHERE "namespace"=c->>'namespace' AND "identityId" IN (c->>'identityId',p_target) ORDER BY "identityId" COLLATE "C" FOR UPDATE;
 live:=public.eng03_05_assert_admin(c,'users.write'); IF NOT (live->'roles' ? 'super_admin') THEN RAISE EXCEPTION 'registry unavailable'; END IF;
 prior:=public.eng03_05_replay(c,m,action,p_target);
 IF public.int5b_hash_json(jsonb_build_object('action',action,'target',p_target,'expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN jsonb_build_object('replayed',true,'receipt',prior,'sync',COALESCE((SELECT jsonb_build_object('status',o."outcome",'revision',o."targetAuthzVersion",'completedAt',o."completedAt") FROM public."HuroofAdminIdentitySyncOutcome" o WHERE (o."namespace",o."operationId")=(c->>'namespace',m->>'operationId')),jsonb_build_object('status','pending','revision',prior->'revision'))); END IF;
 IF m->'expectedRevision'='null'::JSONB OR NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" i WHERE i."id"=p_target AND i."firebaseProjectId"=c->>'projectId') THEN RAISE EXCEPTION 'registry unavailable'; END IF;
 expected:=(m->>'expectedRevision')::BIGINT;
 SELECT * INTO target FROM public."HuroofAdminPrincipal" WHERE ("namespace","identityId")=(c->>'namespace',p_target);
 v:=COALESCE(target."authzVersion",0); IF expected<>v OR target."pendingSyncOperation" IS NOT NULL THEN RAISE EXCEPTION 'stale or pending registry'; END IF;
 IF v>0 AND target."enabled" AND NOT target."disabled" AND target."identityReady" AND 'super_admin'=ANY(target."roles") AND NOT EXISTS(SELECT 1 FROM public."HuroofAdminPrincipal" other WHERE other."namespace"=c->>'namespace' AND other."identityId"<>p_target AND other."enabled" AND NOT other."disabled" AND other."identityReady" AND 'super_admin'=ANY(other."roles")) THEN RAISE EXCEPTION 'last usable super admin'; END IF;
 IF p_mode='role' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p))<>4 OR NOT p ?& ARRAY['enabled','roles','categoryScopes','reviewerScopes'] OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'categoryScopes') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'reviewerScopes') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'registry unavailable'; END IF;
  SELECT array_agg(v ORDER BY v COLLATE "C") INTO rs FROM jsonb_array_elements_text(p->'roles') e(v); SELECT COALESCE(array_agg(v ORDER BY v COLLATE "C"),ARRAY[]::TEXT[]) INTO cats FROM jsonb_array_elements_text(p->'categoryScopes') e(v); SELECT COALESCE(array_agg(v ORDER BY v COLLATE "C"),ARRAY[]::TEXT[]) INTO specialists FROM jsonb_array_elements_text(p->'reviewerScopes') e(v);
  IF cardinality(rs) NOT BETWEEN 1 AND 5 OR NOT rs <@ ARRAY['super_admin','content_admin','reviewer','game_ops','viewer']::TEXT[] OR cardinality(rs)<>(SELECT count(DISTINCT x) FROM unnest(rs) x) OR cardinality(cats)>100 OR cardinality(cats)<>(SELECT count(DISTINCT x) FROM unnest(cats) x) OR EXISTS(SELECT 1 FROM unnest(cats) x WHERE x !~ '^[A-Za-z0-9_-]{1,120}$') OR cardinality(specialists)>100 OR cardinality(specialists)<>(SELECT count(DISTINCT x) FROM unnest(specialists) x) OR NOT specialists <@ ARRAY['fact_reviewer','language_reviewer','image_rights_reviewer','charades_performance_reviewer','charades_originality_reviewer','charades_cultural_suitability_reviewer']::TEXT[] OR ('reviewer'=ANY(rs) AND (cardinality(cats)=0 OR cardinality(specialists)=0)) THEN RAISE EXCEPTION 'registry unavailable'; END IF;
  enabled:=(p->>'enabled')::BOOLEAN; disabled:=COALESCE(target."disabled",false);
 ELSIF p_mode='status' THEN
  IF v=0 OR (SELECT count(*) FROM jsonb_object_keys(p))<>1 OR NOT p ? 'disabled' OR jsonb_typeof(p->'disabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'registry unavailable'; END IF;
  disabled:=(p->>'disabled')::BOOLEAN; enabled:=NOT disabled; rs:=target."roles"; cats:=target."categoryScopes"; specialists:=target."reviewerScopes";
 ELSE
  IF v=0 OR (SELECT count(*) FROM jsonb_object_keys(p))<>0 THEN RAISE EXCEPTION 'registry unavailable'; END IF;
  disabled:=target."disabled"; enabled:=target."enabled"; rs:=target."roles"; cats:=target."categoryScopes"; specialists:=target."reviewerScopes";
 END IF;
 desired:=public.int5b_hash_json(jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','identityId',p_target,'authzVersion',v+1,'enabled',enabled,'disabled',disabled,'roles',to_jsonb(rs),'categoryScopes',to_jsonb(cats),'reviewerScopes',to_jsonb(specialists)));
 result:=jsonb_build_object('operationId',m->>'operationId','revision',v+1,'status','registry_committed');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash',action,p_target,m->>'requestHash',expected,v+1,'registry_committed',result);
 INSERT INTO public."HuroofAdminPrincipal"("namespace","identityId","enabled","disabled","authzVersion","identityReady","roles","categoryScopes","reviewerScopes","pendingSyncOperation","desiredAuthorizationHash") VALUES(c->>'namespace',p_target,enabled,disabled,v+1,false,rs,cats,specialists,m->>'operationId',desired)
 ON CONFLICT("namespace","identityId") DO UPDATE SET "enabled"=EXCLUDED."enabled","disabled"=EXCLUDED."disabled","authzVersion"=EXCLUDED."authzVersion","identityReady"=false,"roles"=EXCLUDED."roles","categoryScopes"=EXCLUDED."categoryScopes","reviewerScopes"=EXCLUDED."reviewerScopes","pendingSyncOperation"=EXCLUDED."pendingSyncOperation","desiredAuthorizationHash"=EXCLUDED."desiredAuthorizationHash","updatedAt"=clock_timestamp();
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN jsonb_build_object('replayed',false,'receipt',result,'desired',jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','identityId',p_target,'authzVersion',v+1,'enabled',enabled,'disabled',disabled,'roles',to_jsonb(rs),'categoryScopes',to_jsonb(cats),'reviewerScopes',to_jsonb(specialists),'desiredAuthorizationHash',desired));
END $$;
CREATE FUNCTION public.eng03_05_sync_complete(p_namespace TEXT,p_operation TEXT,p_target TEXT,p_version BIGINT,p_desired TEXT,p_outcome TEXT,p_evidence TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE op public."HuroofAdminOperation"%ROWTYPE; target public."HuroofAdminPrincipal"%ROWTYPE; existing public."HuroofAdminIdentitySyncOutcome"%ROWTYPE;
BEGIN
 IF p_outcome NOT IN ('identity_synced','identity_sync_failed') OR p_evidence !~ '^[a-f0-9]{64}$' OR p_desired !~ '^[a-f0-9]{64}$' OR p_version<1 THEN RAISE EXCEPTION 'sync unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(p_namespace);
 SELECT * INTO op FROM public."HuroofAdminOperation" WHERE ("namespace","operationId")=(p_namespace,p_operation);
 IF NOT FOUND OR op."action" NOT IN ('user.role','user.status','user.revoke') OR op."target" IS DISTINCT FROM p_target OR op."resultRevision"<>p_version OR NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" n WHERE n."namespaceId"=p_namespace AND n."firebaseProjectId"=op."actorProjectId") THEN RAISE EXCEPTION 'sync unavailable'; END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,op."actorIdentityId",op."actorPolicyRevision",op."actorPolicyHash");
 SELECT * INTO target FROM public."HuroofAdminPrincipal" WHERE ("namespace","identityId")=(p_namespace,p_target) FOR UPDATE;
 SELECT * INTO existing FROM public."HuroofAdminIdentitySyncOutcome" WHERE ("namespace","operationId")=(p_namespace,p_operation);
 IF FOUND THEN
  IF existing."targetIdentityId" IS DISTINCT FROM p_target OR existing."targetAuthzVersion"<>p_version OR existing."desiredAuthorizationHash" IS DISTINCT FROM p_desired OR existing."outcome" IS DISTINCT FROM p_outcome OR existing."evidenceHash" IS DISTINCT FROM p_evidence THEN RAISE EXCEPTION 'sync unavailable'; END IF;
  RETURN jsonb_build_object('status',existing."outcome",'revision',existing."targetAuthzVersion");
 END IF;
 IF target."identityId" IS NULL OR target."authzVersion"<>p_version OR target."pendingSyncOperation" IS DISTINCT FROM p_operation OR target."desiredAuthorizationHash" IS DISTINCT FROM p_desired THEN RAISE EXCEPTION 'sync unavailable'; END IF;
 INSERT INTO public."HuroofAdminIdentitySyncOutcome"("namespace","operationId","targetIdentityId","targetAuthzVersion","desiredAuthorizationHash","outcome","evidenceHash") VALUES(p_namespace,p_operation,p_target,p_version,p_desired,p_outcome,p_evidence);
 UPDATE public."HuroofAdminPrincipal" SET "pendingSyncOperation"=NULL,"identityReady"=(p_outcome='identity_synced' AND "enabled" AND NOT "disabled"),"updatedAt"=clock_timestamp() WHERE ("namespace","identityId","authzVersion","pendingSyncOperation","desiredAuthorizationHash")=(p_namespace,p_target,p_version,p_operation,p_desired);
 IF NOT FOUND THEN RAISE EXCEPTION 'sync unavailable'; END IF;
 INSERT INTO public."HuroofAdminAudit"("namespace","operationId","eventKind","actorIdentityId","actorRoles","action","target","requestHash","expectedRevision","resultRevision","resultCode") VALUES(p_namespace,p_operation,'identity_sync',op."actorIdentityId",op."actorRoles",op."action"||'.'||p_outcome,p_target,op."requestHash",op."expectedRevision",p_version,p_outcome);
 UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=p_namespace; RETURN jsonb_build_object('status',p_outcome,'revision',p_version);
END $$;
CREATE INDEX "HuroofAdminDraftLatest" ON public."HuroofAdminQuestionDraftRevision" ("namespace","questionId","revision" DESC);
CREATE INDEX "HuroofAdminDraftScope" ON public."HuroofAdminQuestionDraftRevision" ("namespace","categoryId","status","questionId","revision" DESC);
CREATE INDEX "HuroofAdminReviewLatest" ON public."HuroofAdminReviewRevision" ("namespace","reviewId","revision" DESC);
CREATE INDEX "HuroofAdminReviewScope" ON public."HuroofAdminReviewRevision" ("namespace","categoryId","status","reviewId","revision" DESC);
CREATE INDEX "HuroofAdminCorrectionLatest" ON public."HuroofAdminCategoryCorrectionRevision" ("namespace","categoryId","releaseId","revision" DESC);
CREATE INDEX "HuroofAdminMetadataLatest" ON public."HuroofAdminCategoryMetadataRevision" ("namespace","categoryId","revision" DESC);
CREATE INDEX "HuroofAdminInspectionScope" ON public."HuroofAdminPublishedQuestionInspection" ("namespace","releaseId","categoryId","questionId");
CREATE INDEX "HuroofAdminAuditActor" ON public."HuroofAdminAudit" ("namespace","actorIdentityId","occurredAt","operationId");
CREATE FUNCTION public.eng03_05_draft_save(c JSONB,m JSONB,p_id TEXT,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; current_row public."HuroofAdminQuestionDraftRevision"%ROWTYPE; old_row public."HuroofAdminQuestionDraftRevision"%ROWTYPE; expected BIGINT; cat TEXT; expected_roles TEXT[]; roles TEXT[]; answer TEXT[]; source JSONB; actor_uid TEXT; author_uid TEXT; author_id TEXT; content_hash TEXT; binding_hash TEXT; result JSONB; status TEXT;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['categoryId','modality','headerAr','promptAr','canonicalAnswer','acceptedAnswers','specialistRoles','sources','status'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>9 THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write');
 prior:=public.eng03_05_replay(c,m,'question.save',p_id);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','question.save','target',p_id,'expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 expected:=(m->>'expectedRevision')::BIGINT; cat:=p->>'categoryId';
 IF jsonb_typeof(p->'categoryId') IS DISTINCT FROM 'string' OR cat !~ '^[A-Za-z0-9_-]{1,120}$' OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? cat)) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF expected>0 THEN SELECT * INTO old_row FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId","revision")=(c->>'namespace',p_id,expected); IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? old_row."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF; END IF;
 SELECT * INTO current_row FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF current_row."questionId" IS NOT NULL AND NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? current_row."categoryId") THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF COALESCE(current_row."revision",0)<>expected OR current_row."status" IN ('in_review','archived') THEN RAISE EXCEPTION 'stale draft'; END IF;
 status:=p->>'status'; IF status NOT IN ('draft','ready_for_review') OR p->>'modality' NOT IN ('classic','image','charades') OR jsonb_typeof(p->'headerAr') IS DISTINCT FROM 'string' OR length(btrim(p->>'headerAr'))=0 OR length(p->>'headerAr')>240 OR jsonb_typeof(p->'promptAr') IS DISTINCT FROM 'string' OR length(btrim(p->>'promptAr'))=0 OR length(p->>'promptAr')>4000 OR jsonb_typeof(p->'canonicalAnswer') IS DISTINCT FROM 'string' OR length(btrim(p->>'canonicalAnswer'))=0 OR length(p->>'canonicalAnswer')>1000 OR jsonb_typeof(p->'acceptedAnswers') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'acceptedAnswers') NOT BETWEEN 1 AND 32 OR jsonb_typeof(p->'specialistRoles') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'sources')>16 THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'acceptedAnswers') a(v) WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(btrim(v#>>'{}'))=0 OR length(v#>>'{}')>1000) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 SELECT array_agg(v ORDER BY ord) INTO answer FROM jsonb_array_elements_text(p->'acceptedAnswers') WITH ORDINALITY a(v,ord);
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO roles FROM jsonb_array_elements_text(p->'specialistRoles') a(v);
 expected_roles:=(CASE p->>'modality' WHEN 'classic' THEN ARRAY['fact_reviewer','language_reviewer'] WHEN 'image' THEN ARRAY['fact_reviewer','image_rights_reviewer','language_reviewer'] ELSE ARRAY['charades_cultural_suitability_reviewer','charades_originality_reviewer','charades_performance_reviewer','fact_reviewer','language_reviewer'] END);
 IF roles IS DISTINCT FROM expected_roles THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(p->'sources') LOOP
  IF jsonb_typeof(source) IS DISTINCT FROM 'object' OR NOT source ?& ARRAY['sourceUrl','publisher','title','sourceTier'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(source) k WHERE k NOT IN ('sourceUrl','publisher','title','sourceTier','retrievedAt')) OR jsonb_typeof(source->'sourceUrl') IS DISTINCT FROM 'string' OR jsonb_typeof(source->'publisher') IS DISTINCT FROM 'string' OR jsonb_typeof(source->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(source->'sourceTier') IS DISTINCT FROM 'string' OR (source ? 'retrievedAt' AND jsonb_typeof(source->'retrievedAt') IS DISTINCT FROM 'string') OR source->>'sourceUrl' !~ '^https://[^/@[:space:]?#]+([/?#][^[:space:]]*)?$' OR length(source->>'sourceUrl')>2048 OR length(btrim(source->>'publisher')) NOT BETWEEN 1 AND 240 OR length(btrim(source->>'title')) NOT BETWEEN 1 AND 500 OR length(btrim(source->>'sourceTier')) NOT BETWEEN 1 AND 64 OR (source ? 'retrievedAt' AND source->>'retrievedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T') THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 END LOOP;
 SELECT "firebaseUid" INTO actor_uid FROM public."FirebaseIdentity" WHERE "id"=c->>'identityId' AND "firebaseProjectId"=c->>'projectId';
 author_id:=COALESCE(current_row."authorIdentityId",c->>'identityId'); SELECT "firebaseUid" INTO author_uid FROM public."FirebaseIdentity" WHERE "id"=author_id AND "firebaseProjectId"=c->>'projectId';
 IF actor_uid IS NULL OR author_uid IS NULL THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 content_hash:=public.int5b_hash_json(p);
 binding_hash:=public.int5b_hash_json(jsonb_build_object('revision',expected+1,'authorUid',author_uid,'categoryId',cat,'modality',p->'modality','headerAr',p->'headerAr','promptAr',p->'promptAr','canonicalAnswer',p->'canonicalAnswer','acceptedAnswers',p->'acceptedAnswers','specialistRoles',p->'specialistRoles','sources',p->'sources'));
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','saved');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','question.save',p_id,m->>'requestHash',expected,expected+1,'saved',result);
 INSERT INTO public."HuroofAdminQuestionDraftRevision"("namespace","questionId","revision","authorIdentityId","createdBy","categoryId","modality","status","headerAr","promptAr","canonicalAnswer","acceptedAnswers","specialistRoles","sources","contentHash","reviewBindingHash","predecessorRevision","predecessorHash","operationId") VALUES(c->>'namespace',p_id,expected+1,author_id,c->>'identityId',cat,p->>'modality',status,p->>'headerAr',p->>'promptAr',p->>'canonicalAnswer',answer,ARRAY(SELECT jsonb_array_elements_text(p->'specialistRoles')),p->'sources',content_hash,binding_hash,CASE WHEN expected=0 THEN NULL ELSE expected END,current_row."contentHash",m->>'operationId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_draft_get(c JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; d public."HuroofAdminQuestionDraftRevision"%ROWTYPE;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.read');
 SELECT * INTO d FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? d."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 RETURN jsonb_build_object('id',d."questionId",'revision',d."revision",'categoryId',d."categoryId",'modality',d."modality",'status',d."status",'headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources");
END $$;
CREATE FUNCTION public.eng03_05_draft_list(c JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; cat TEXT; lim INTEGER; rev BIGINT; last_id TEXT; filter_status TEXT; cur JSONB; items JSONB; next_id TEXT; has_more BOOLEAN;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['categoryId','limit','status','cursor'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>4 OR jsonb_typeof(p->'categoryId') IS DISTINCT FROM 'string' OR p->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR p->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 cat:=p->>'categoryId'; lim:=(p->>'limit')::INTEGER; IF lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF p->'status'<>'null'::JSONB AND (jsonb_typeof(p->'status') IS DISTINCT FROM 'string' OR p->>'status' NOT IN ('draft','ready_for_review','in_review','changes_requested','archived')) THEN RAISE EXCEPTION 'draft unavailable'; END IF; filter_status:=p->>'status';
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.read');
 IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? cat) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 SELECT "revision" INTO rev FROM public."HuroofAdminAuthzInvariant" WHERE "namespace"=c->>'namespace'; cur:=p->'cursor';
 IF cur<>'null'::JSONB THEN
  IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cur))<>6 OR NOT cur ?& ARRAY['namespace','family','categoryId','status','snapshotRevision','lastId'] OR cur->>'namespace' IS DISTINCT FROM c->>'namespace' OR cur->>'family' IS DISTINCT FROM 'draft' OR cur->>'categoryId' IS DISTINCT FROM cat OR cur->'status' IS DISTINCT FROM p->'status' OR cur->>'snapshotRevision' IS DISTINCT FROM rev::TEXT OR cur->>'lastId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'stale cursor'; END IF;
  last_id:=cur->>'lastId';
  IF NOT EXISTS(SELECT 1 FROM (SELECT DISTINCT ON("questionId") * FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=c->>'namespace' ORDER BY "questionId","revision" DESC) d WHERE d."questionId"=last_id AND d."categoryId"=cat AND (filter_status IS NULL OR d."status"=filter_status)) THEN RAISE EXCEPTION 'stale cursor'; END IF;
 END IF;
 WITH latest AS (SELECT DISTINCT ON("questionId") * FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=c->>'namespace' ORDER BY "questionId","revision" DESC), filtered AS (SELECT * FROM latest WHERE "categoryId"=cat AND (filter_status IS NULL OR "status"=filter_status) AND (last_id IS NULL OR "questionId" COLLATE "C">last_id COLLATE "C") ORDER BY "questionId" COLLATE "C" LIMIT lim+1), numbered AS (SELECT *,row_number() OVER(ORDER BY "questionId" COLLATE "C") AS ord FROM filtered)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',"questionId",'revision',"revision",'status',"status",'categoryId',"categoryId",'modality',"modality",'headerAr',"headerAr") ORDER BY ord) FILTER(WHERE ord<=lim),'[]'::JSONB),max("questionId") FILTER(WHERE ord=lim),count(*)>lim INTO items,next_id,has_more FROM numbered;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN jsonb_build_object('namespace',c->>'namespace','family','draft','categoryId',cat,'status',p->'status','snapshotRevision',rev::TEXT,'lastId',next_id) ELSE NULL END);
END $$;
CREATE FUNCTION public.eng03_05_draft_archive(c JSONB,m JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; d public."HuroofAdminQuestionDraftRevision"%ROWTYPE; expected BIGINT; uid TEXT; binding_hash TEXT; result JSONB;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); prior:=public.eng03_05_replay(c,m,'question.archive',p_id);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','question.archive','target',p_id,'expectedRevision',m->'expectedRevision','payload','{}'::JSONB)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 expected:=(m->>'expectedRevision')::BIGINT;
 SELECT * INTO d FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId","revision")=(c->>'namespace',p_id,expected);
 IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? d."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM (SELECT "categoryId" FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=c->>'namespace' AND "questionId"=p_id ORDER BY "revision" DESC LIMIT 1) latest WHERE NOT (live->'categoryScopes' ? latest."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF d."status" NOT IN ('draft','ready_for_review','changes_requested') OR EXISTS(SELECT 1 FROM public."HuroofAdminQuestionDraftRevision" newer WHERE newer."namespace"=d."namespace" AND newer."questionId"=d."questionId" AND newer."revision">expected) THEN RAISE EXCEPTION 'stale draft'; END IF;
 SELECT "firebaseUid" INTO uid FROM public."FirebaseIdentity" WHERE "id"=d."authorIdentityId" AND "firebaseProjectId"=c->>'projectId'; IF uid IS NULL THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 binding_hash:=public.int5b_hash_json(jsonb_build_object('revision',expected+1,'authorUid',uid,'categoryId',d."categoryId",'modality',d."modality",'headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources"));
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','archived');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','question.archive',p_id,m->>'requestHash',expected,expected+1,'archived',result);
 INSERT INTO public."HuroofAdminQuestionDraftRevision"("namespace","questionId","revision","authorIdentityId","createdBy","categoryId","modality","status","headerAr","promptAr","canonicalAnswer","acceptedAnswers","specialistRoles","sources","contentHash","reviewBindingHash","predecessorRevision","predecessorHash","operationId") VALUES(d."namespace",p_id,expected+1,d."authorIdentityId",c->>'identityId',d."categoryId",d."modality",'archived',d."headerAr",d."promptAr",d."canonicalAnswer",d."acceptedAnswers",d."specialistRoles",d."sources",public.int5b_hash_json(jsonb_build_object('categoryId',d."categoryId",'modality',d."modality",'status','archived','headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources")),binding_hash,expected,d."contentHash",m->>'operationId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_draft_chain_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev public."HuroofAdminQuestionDraftRevision"%ROWTYPE; author_uid TEXT;
BEGIN
 IF NEW."contentHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('categoryId',NEW."categoryId",'modality',NEW."modality",'status',NEW."status",'headerAr',NEW."headerAr",'promptAr',NEW."promptAr",'canonicalAnswer',NEW."canonicalAnswer",'acceptedAnswers',to_jsonb(NEW."acceptedAnswers"),'specialistRoles',to_jsonb(NEW."specialistRoles"),'sources',NEW."sources")) THEN RAISE EXCEPTION 'invalid draft hash'; END IF;
 SELECT i."firebaseUid" INTO author_uid FROM public."FirebaseIdentity" i JOIN public."DeploymentNamespace" n ON n."firebaseProjectId"=i."firebaseProjectId" WHERE i."id"=NEW."authorIdentityId" AND n."namespaceId"=NEW."namespace";
 IF author_uid IS NULL OR NEW."reviewBindingHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('revision',NEW."revision",'authorUid',author_uid,'categoryId',NEW."categoryId",'modality',NEW."modality",'headerAr',NEW."headerAr",'promptAr',NEW."promptAr",'canonicalAnswer',NEW."canonicalAnswer",'acceptedAnswers',to_jsonb(NEW."acceptedAnswers"),'specialistRoles',to_jsonb(NEW."specialistRoles"),'sources',NEW."sources")) THEN RAISE EXCEPTION 'invalid review binding'; END IF;
 IF NEW."revision"=1 THEN
  IF NEW."predecessorRevision" IS NOT NULL OR NEW."predecessorHash" IS NOT NULL OR EXISTS(SELECT 1 FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=NEW."namespace" AND "questionId"=NEW."questionId") THEN RAISE EXCEPTION 'invalid draft chain'; END IF;
 ELSE
  SELECT * INTO prev FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId","revision")=(NEW."namespace",NEW."questionId",NEW."revision"-1);
  IF NOT FOUND OR NEW."predecessorRevision" IS DISTINCT FROM prev."revision" OR NEW."predecessorHash" IS DISTINCT FROM prev."contentHash" OR NEW."authorIdentityId" IS DISTINCT FROM prev."authorIdentityId" OR EXISTS(SELECT 1 FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=NEW."namespace" AND "questionId"=NEW."questionId" AND "revision">=NEW."revision") THEN RAISE EXCEPTION 'invalid draft chain'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdminDraftChain" BEFORE INSERT ON public."HuroofAdminQuestionDraftRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_05_draft_chain_guard();
CREATE FUNCTION public.eng03_05_review_submit(c JSONB,m JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; d public."HuroofAdminQuestionDraftRevision"%ROWTYPE; review public."HuroofAdminReviewRevision"%ROWTYPE; expected BIGINT; uid TEXT; binding_hash TEXT; result JSONB;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'review unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); prior:=public.eng03_05_replay(c,m,'question.submit-review',p_id);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','question.submit-review','target',p_id,'expectedRevision',m->'expectedRevision','payload','{}'::JSONB)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 expected:=(m->>'expectedRevision')::BIGINT; SELECT * INTO d FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId","revision")=(c->>'namespace',p_id,expected);
 IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? d."categoryId")) THEN RAISE EXCEPTION 'review unavailable'; END IF;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM (SELECT "categoryId" FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=c->>'namespace' AND "questionId"=p_id ORDER BY "revision" DESC LIMIT 1) latest WHERE NOT (live->'categoryScopes' ? latest."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF d."status"<>'ready_for_review' OR EXISTS(SELECT 1 FROM public."HuroofAdminQuestionDraftRevision" newer WHERE newer."namespace"=d."namespace" AND newer."questionId"=d."questionId" AND newer."revision">expected) THEN RAISE EXCEPTION 'stale draft'; END IF;
 SELECT * INTO review FROM public."HuroofAdminReviewRevision" WHERE ("namespace","reviewId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF review."status"='in_review' THEN RAISE EXCEPTION 'review already pending'; END IF;
 SELECT "firebaseUid" INTO uid FROM public."FirebaseIdentity" WHERE "id"=d."authorIdentityId" AND "firebaseProjectId"=c->>'projectId'; IF uid IS NULL THEN RAISE EXCEPTION 'review unavailable'; END IF;
 binding_hash:=public.int5b_hash_json(jsonb_build_object('revision',expected+1,'authorUid',uid,'categoryId',d."categoryId",'modality',d."modality",'headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources"));
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','submitted');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','question.submit-review',p_id,m->>'requestHash',expected,expected+1,'submitted',result);
 INSERT INTO public."HuroofAdminQuestionDraftRevision"("namespace","questionId","revision","authorIdentityId","createdBy","categoryId","modality","status","headerAr","promptAr","canonicalAnswer","acceptedAnswers","specialistRoles","sources","contentHash","reviewBindingHash","predecessorRevision","predecessorHash","operationId") VALUES(d."namespace",p_id,expected+1,d."authorIdentityId",c->>'identityId',d."categoryId",d."modality",'in_review',d."headerAr",d."promptAr",d."canonicalAnswer",d."acceptedAnswers",d."specialistRoles",d."sources",public.int5b_hash_json(jsonb_build_object('categoryId',d."categoryId",'modality',d."modality",'status','in_review','headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources")),binding_hash,expected,d."contentHash",m->>'operationId');
 INSERT INTO public."HuroofAdminReviewRevision"("namespace","reviewId","revision","questionId","submittedQuestionRevision","submittedQuestionHash","categoryId","authorIdentityId","status","operationId") VALUES(c->>'namespace',p_id,COALESCE(review."revision",0)+1,p_id,expected+1,binding_hash,d."categoryId",d."authorIdentityId",'in_review',m->>'operationId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_review_decide(c JSONB,m JSONB,p_id TEXT,p_decision TEXT,p_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; r public."HuroofAdminReviewRevision"%ROWTYPE; d public."HuroofAdminQuestionDraftRevision"%ROWTYPE; expected BIGINT; uid TEXT; binding_hash TEXT; result JSONB;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' OR p_decision IS DISTINCT FROM 'changes_requested' OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'review unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'reviews.decide'); prior:=public.eng03_05_replay(c,m,'review.decide',p_id);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','review.decide','target',p_id,'expectedRevision',m->'expectedRevision','payload',jsonb_build_object('decision',p_decision,'reason',p_reason))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 expected:=(m->>'expectedRevision')::BIGINT; SELECT * INTO r FROM public."HuroofAdminReviewRevision" WHERE ("namespace","reviewId","revision")=(c->>'namespace',p_id,expected);
 IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? r."categoryId")) OR r."authorIdentityId"=c->>'identityId' THEN RAISE EXCEPTION 'review unavailable'; END IF;
 SELECT * INTO d FROM public."HuroofAdminQuestionDraftRevision" WHERE ("namespace","questionId","revision","reviewBindingHash")=(r."namespace",r."questionId",r."submittedQuestionRevision",r."submittedQuestionHash");
 IF NOT FOUND OR NOT d."specialistRoles" <@ ARRAY(SELECT jsonb_array_elements_text(live->'reviewerScopes')) THEN RAISE EXCEPTION 'review unavailable'; END IF;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM (SELECT "categoryId" FROM public."HuroofAdminQuestionDraftRevision" WHERE "namespace"=c->>'namespace' AND "questionId"=p_id ORDER BY "revision" DESC LIMIT 1) latest WHERE NOT (live->'categoryScopes' ? latest."categoryId")) THEN RAISE EXCEPTION 'draft unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF r."status"<>'in_review' OR d."status"<>'in_review' OR r."categoryId" IS DISTINCT FROM d."categoryId" OR r."authorIdentityId" IS DISTINCT FROM d."authorIdentityId" OR EXISTS(SELECT 1 FROM public."HuroofAdminReviewRevision" newer WHERE newer."namespace"=r."namespace" AND newer."reviewId"=r."reviewId" AND newer."revision">expected) OR EXISTS(SELECT 1 FROM public."HuroofAdminQuestionDraftRevision" newer WHERE newer."namespace"=d."namespace" AND newer."questionId"=d."questionId" AND newer."revision">d."revision") THEN RAISE EXCEPTION 'stale review'; END IF;
 SELECT "firebaseUid" INTO uid FROM public."FirebaseIdentity" WHERE "id"=d."authorIdentityId" AND "firebaseProjectId"=c->>'projectId'; IF uid IS NULL THEN RAISE EXCEPTION 'review unavailable'; END IF;
 binding_hash:=public.int5b_hash_json(jsonb_build_object('revision',d."revision"+1,'authorUid',uid,'categoryId',d."categoryId",'modality',d."modality",'headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources"));
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','changes_requested');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','review.decide',p_id,m->>'requestHash',expected,expected+1,'changes_requested',result);
 INSERT INTO public."HuroofAdminQuestionDraftRevision"("namespace","questionId","revision","authorIdentityId","createdBy","categoryId","modality","status","headerAr","promptAr","canonicalAnswer","acceptedAnswers","specialistRoles","sources","contentHash","reviewBindingHash","predecessorRevision","predecessorHash","operationId") VALUES(d."namespace",d."questionId",d."revision"+1,d."authorIdentityId",c->>'identityId',d."categoryId",d."modality",'changes_requested',d."headerAr",d."promptAr",d."canonicalAnswer",d."acceptedAnswers",d."specialistRoles",d."sources",public.int5b_hash_json(jsonb_build_object('categoryId',d."categoryId",'modality',d."modality",'status','changes_requested','headerAr',d."headerAr",'promptAr',d."promptAr",'canonicalAnswer',d."canonicalAnswer",'acceptedAnswers',to_jsonb(d."acceptedAnswers"),'specialistRoles',to_jsonb(d."specialistRoles"),'sources',d."sources")),binding_hash,d."revision",d."contentHash",m->>'operationId');
 INSERT INTO public."HuroofAdminReviewRevision"("namespace","reviewId","revision","questionId","submittedQuestionRevision","submittedQuestionHash","categoryId","authorIdentityId","status","decidedBy","reason","operationId") VALUES(r."namespace",r."reviewId",r."revision"+1,r."questionId",r."submittedQuestionRevision",r."submittedQuestionHash",r."categoryId",r."authorIdentityId",'changes_requested',c->>'identityId',p_reason,m->>'operationId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_review_get(c JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; r public."HuroofAdminReviewRevision"%ROWTYPE;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'review unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'reviews.read');
 SELECT * INTO r FROM public."HuroofAdminReviewRevision" WHERE ("namespace","reviewId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? r."categoryId")) THEN RAISE EXCEPTION 'review unavailable'; END IF;
 RETURN jsonb_build_object('id',r."reviewId",'revision',r."revision",'questionId',r."questionId",'questionRevision',r."submittedQuestionRevision",'categoryId',r."categoryId",'status',r."status",'reason',r."reason");
END $$;
CREATE FUNCTION public.eng03_05_review_list(c JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; cat TEXT; lim INTEGER; rev BIGINT; last_id TEXT; filter_status TEXT; cur JSONB; items JSONB; next_id TEXT; has_more BOOLEAN;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['categoryId','limit','status','cursor'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>4 OR jsonb_typeof(p->'categoryId') IS DISTINCT FROM 'string' OR p->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR p->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'review unavailable'; END IF;
 cat:=p->>'categoryId'; lim:=(p->>'limit')::INTEGER; IF lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'review unavailable'; END IF;
 IF p->'status'<>'null'::JSONB AND (jsonb_typeof(p->'status') IS DISTINCT FROM 'string' OR p->>'status' NOT IN ('in_review','changes_requested')) THEN RAISE EXCEPTION 'review unavailable'; END IF; filter_status:=p->>'status';
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'reviews.read'); IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? cat) THEN RAISE EXCEPTION 'review unavailable'; END IF;
 SELECT "revision" INTO rev FROM public."HuroofAdminAuthzInvariant" WHERE "namespace"=c->>'namespace'; cur:=p->'cursor';
 IF cur<>'null'::JSONB THEN
  IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cur))<>6 OR NOT cur ?& ARRAY['namespace','family','categoryId','status','snapshotRevision','lastId'] OR cur->>'namespace' IS DISTINCT FROM c->>'namespace' OR cur->>'family' IS DISTINCT FROM 'review' OR cur->>'categoryId' IS DISTINCT FROM cat OR cur->'status' IS DISTINCT FROM p->'status' OR cur->>'snapshotRevision' IS DISTINCT FROM rev::TEXT OR cur->>'lastId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'stale cursor'; END IF; last_id:=cur->>'lastId';
  IF NOT EXISTS(SELECT 1 FROM (SELECT DISTINCT ON("reviewId") * FROM public."HuroofAdminReviewRevision" WHERE "namespace"=c->>'namespace' ORDER BY "reviewId","revision" DESC) r WHERE r."reviewId"=last_id AND r."categoryId"=cat AND (filter_status IS NULL OR r."status"=filter_status)) THEN RAISE EXCEPTION 'stale cursor'; END IF;
 END IF;
 WITH latest AS (SELECT DISTINCT ON("reviewId") * FROM public."HuroofAdminReviewRevision" WHERE "namespace"=c->>'namespace' ORDER BY "reviewId","revision" DESC), filtered AS (SELECT * FROM latest WHERE "categoryId"=cat AND (filter_status IS NULL OR "status"=filter_status) AND (last_id IS NULL OR "reviewId" COLLATE "C">last_id COLLATE "C") ORDER BY "reviewId" COLLATE "C" LIMIT lim+1), numbered AS (SELECT *,row_number() OVER(ORDER BY "reviewId" COLLATE "C") ord FROM filtered)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',"reviewId",'revision',"revision",'questionId',"questionId",'categoryId',"categoryId",'status',"status") ORDER BY ord) FILTER(WHERE ord<=lim),'[]'::JSONB),max("reviewId") FILTER(WHERE ord=lim),count(*)>lim INTO items,next_id,has_more FROM numbered;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN jsonb_build_object('namespace',c->>'namespace','family','review','categoryId',cat,'status',p->'status','snapshotRevision',rev::TEXT,'lastId',next_id) ELSE NULL END);
END $$;
CREATE FUNCTION public.eng03_05_category_get(c JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; d public."HuroofAdminCategoryMetadataRevision"%ROWTYPE;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'category unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'categories.read');
 IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? p_id) THEN RAISE EXCEPTION 'category unavailable'; END IF;
 SELECT * INTO d FROM public."HuroofAdminCategoryMetadataRevision" WHERE ("namespace","categoryId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'category unavailable'; END IF;
 RETURN jsonb_strip_nulls(jsonb_build_object('id',d."categoryId",'revision',d."revision",'titleAr',d."titleAr",'descriptionAr',d."descriptionAr",'enabled',d."enabled"));
END $$;
CREATE FUNCTION public.eng03_05_category_update(c JSONB,m JSONB,p_id TEXT,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; d public."HuroofAdminCategoryMetadataRevision"%ROWTYPE; expected BIGINT; merged JSONB; result JSONB;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('titleAr','descriptionAr','enabled')) THEN RAISE EXCEPTION 'category unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'categories.write'); IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? p_id) THEN RAISE EXCEPTION 'category unavailable'; END IF;
 prior:=public.eng03_05_replay(c,m,'category.update',p_id);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','category.update','target',p_id,'expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF; expected:=(m->>'expectedRevision')::BIGINT;
 SELECT * INTO d FROM public."HuroofAdminCategoryMetadataRevision" WHERE ("namespace","categoryId")=(c->>'namespace',p_id) ORDER BY "revision" DESC LIMIT 1;
 IF COALESCE(d."revision",0)<>expected THEN RAISE EXCEPTION 'stale category'; END IF;
 merged:=(CASE WHEN expected=0 THEN '{}'::JSONB ELSE jsonb_build_object('titleAr',d."titleAr",'descriptionAr',d."descriptionAr",'enabled',d."enabled") END) || p;
 IF (p ? 'titleAr' AND (jsonb_typeof(p->'titleAr') IS DISTINCT FROM 'string' OR length(btrim(p->>'titleAr')) NOT BETWEEN 1 AND 160)) OR (p ? 'descriptionAr' AND (jsonb_typeof(p->'descriptionAr') IS DISTINCT FROM 'string' OR length(btrim(p->>'descriptionAr')) NOT BETWEEN 1 AND 1000)) OR (p ? 'enabled' AND jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'category unavailable'; END IF;
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','updated');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','category.update',p_id,m->>'requestHash',expected,expected+1,'updated',result);
 INSERT INTO public."HuroofAdminCategoryMetadataRevision"("namespace","categoryId","revision","titleAr","descriptionAr","enabled","updatedBy","operationId","predecessorRevision","predecessorHash") VALUES(c->>'namespace',p_id,expected+1,merged->>'titleAr',merged->>'descriptionAr',(merged->>'enabled')::BOOLEAN,c->>'identityId',m->>'operationId',CASE WHEN expected=0 THEN NULL ELSE expected END,CASE WHEN expected=0 THEN NULL ELSE public.int5b_hash_json(jsonb_build_object('revision',d."revision",'titleAr',d."titleAr",'descriptionAr',d."descriptionAr",'enabled',d."enabled")) END);
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_room_get(c JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; out_members JSONB; members_count BIGINT;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'room unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); PERFORM public.eng03_05_assert_admin(c,'rooms.act');
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(c->>'namespace',p_id); IF NOT FOUND THEN RAISE EXCEPTION 'room unavailable'; END IF;
 SELECT count(*) INTO members_count FROM public."HuroofMember" WHERE "namespace"=room."namespace" AND "roomId"=room."id" AND "revokedAt" IS NULL;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('uid',v.uid,'role',v.role) ORDER BY v.uid),'[]'::JSONB) INTO out_members FROM (SELECT i."firebaseUid" uid,m."role" role FROM public."HuroofMember" m JOIN public."FirebaseIdentity" i ON i."id"=m."firebaseIdentityId" AND i."firebaseProjectId"=c->>'projectId' WHERE m."namespace"=room."namespace" AND m."roomId"=room."id" AND m."revokedAt" IS NULL ORDER BY i."firebaseUid" COLLATE "C" LIMIT 100) v;
 RETURN jsonb_build_object('id',room."id",'revision',room."version",'lifecycle',room."status",'createdAt',room."createdAt",'updatedAt',room."updatedAt",'memberCount',members_count,'members',out_members);
END $$;
CREATE FUNCTION public.eng03_05_room_list(c JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lim INTEGER; cutoff TIMESTAMPTZ; last_id TEXT; cur JSONB; items JSONB; next_id TEXT; has_more BOOLEAN;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['limit','cursor'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR p->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'room unavailable'; END IF; lim:=(p->>'limit')::INTEGER; IF lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'room unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); PERFORM public.eng03_05_assert_admin(c,'rooms.read'); cur:=p->'cursor';
 IF cur='null'::JSONB THEN cutoff:=clock_timestamp(); ELSE
  IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cur))<>4 OR NOT cur ?& ARRAY['namespace','family','createdBefore','lastId'] OR cur->>'namespace' IS DISTINCT FROM c->>'namespace' OR cur->>'family' IS DISTINCT FROM 'rooms' OR cur->>'lastId' !~ '^[A-Za-z0-9_-]{1,120}$' OR length(cur->>'createdBefore')>40 THEN RAISE EXCEPTION 'stale cursor'; END IF;
  BEGIN cutoff:=(cur->>'createdBefore')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'stale cursor'; END; last_id:=cur->>'lastId';
  IF cutoff>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE "namespace"=c->>'namespace' AND "id"=last_id AND "createdAt"<=cutoff) THEN RAISE EXCEPTION 'stale cursor'; END IF;
 END IF;
 WITH selected AS (SELECT r.* FROM public."HuroofRoom" r WHERE r."namespace"=c->>'namespace' AND r."createdAt"<=cutoff AND (last_id IS NULL OR r."id" COLLATE "C">last_id COLLATE "C") ORDER BY r."id" COLLATE "C" LIMIT lim+1), numbered AS (SELECT *,row_number() OVER(ORDER BY "id" COLLATE "C") ord FROM selected)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',n."id",'revision',n."version",'lifecycle',n."status",'createdAt',n."createdAt",'updatedAt',n."updatedAt",'memberCount',(SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=n."namespace" AND m."roomId"=n."id" AND m."revokedAt" IS NULL)) ORDER BY n.ord) FILTER(WHERE n.ord<=lim),'[]'::JSONB),max(n."id") FILTER(WHERE n.ord=lim),count(*)>lim INTO items,next_id,has_more FROM numbered n;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN jsonb_build_object('namespace',c->>'namespace','family','rooms','createdBefore',cutoff,'lastId',next_id) ELSE NULL END);
END $$;
CREATE FUNCTION public.eng03_05_category_list(c JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; lim INTEGER; cat TEXT; rev BIGINT; last_id TEXT; cur JSONB; items JSONB; next_id TEXT; has_more BOOLEAN;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['categoryId','limit','cursor'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>3 OR jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR p->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'category unavailable'; END IF; lim:=(p->>'limit')::INTEGER; IF lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'category unavailable'; END IF;
 IF p->'categoryId'<>'null'::JSONB AND (jsonb_typeof(p->'categoryId') IS DISTINCT FROM 'string' OR p->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$') THEN RAISE EXCEPTION 'category unavailable'; END IF; cat:=p->>'categoryId';
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'categories.read');
 IF cat IS NOT NULL AND NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? cat) THEN RAISE EXCEPTION 'category unavailable'; END IF;
 SELECT "revision" INTO rev FROM public."HuroofAdminAuthzInvariant" WHERE "namespace"=c->>'namespace'; cur:=p->'cursor';
 IF cur<>'null'::JSONB THEN
  IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cur))<>5 OR NOT cur ?& ARRAY['namespace','family','categoryId','snapshotRevision','lastId'] OR cur->>'namespace' IS DISTINCT FROM c->>'namespace' OR cur->>'family' IS DISTINCT FROM 'category' OR cur->'categoryId' IS DISTINCT FROM p->'categoryId' OR cur->>'snapshotRevision' IS DISTINCT FROM rev::TEXT OR cur->>'lastId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'stale cursor'; END IF; last_id:=cur->>'lastId';
  IF (cat IS NOT NULL AND last_id<>cat) OR (NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? last_id)) OR NOT EXISTS(SELECT 1 FROM public."HuroofAdminCategoryMetadataRevision" WHERE "namespace"=c->>'namespace' AND "categoryId"=last_id) THEN RAISE EXCEPTION 'stale cursor'; END IF;
 END IF;
 WITH latest AS (SELECT DISTINCT ON("categoryId") * FROM public."HuroofAdminCategoryMetadataRevision" WHERE "namespace"=c->>'namespace' ORDER BY "categoryId","revision" DESC), filtered AS (SELECT * FROM latest WHERE (cat IS NULL OR "categoryId"=cat) AND ((live->'roles' ? 'super_admin') OR (live->'categoryScopes' ? "categoryId")) AND (last_id IS NULL OR "categoryId" COLLATE "C">last_id COLLATE "C") ORDER BY "categoryId" COLLATE "C" LIMIT lim+1), numbered AS (SELECT *,row_number() OVER(ORDER BY "categoryId" COLLATE "C") ord FROM filtered)
 SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',"categoryId",'revision',"revision",'titleAr',"titleAr",'descriptionAr',"descriptionAr",'enabled',"enabled")) ORDER BY ord) FILTER(WHERE ord<=lim),'[]'::JSONB),max("categoryId") FILTER(WHERE ord=lim),count(*)>lim INTO items,next_id,has_more FROM numbered;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN jsonb_build_object('namespace',c->>'namespace','family','category','categoryId',p->'categoryId','snapshotRevision',rev::TEXT,'lastId',next_id) ELSE NULL END);
END $$;
CREATE FUNCTION public.eng03_05_audit_list(c JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; lim INTEGER; rev BIGINT; cur JSONB; last_time TIMESTAMPTZ; last_op TEXT; last_kind TEXT; actor TEXT; items JSONB; next_item JSONB; has_more BOOLEAN;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['limit','cursor'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>2 OR jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR p->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'audit unavailable'; END IF; lim:=(p->>'limit')::INTEGER; IF lim NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'audit unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'audit.read'); actor:=(CASE WHEN live->'roles' ? 'super_admin' THEN NULL ELSE c->>'identityId' END);
 SELECT "revision" INTO rev FROM public."HuroofAdminAuthzInvariant" WHERE "namespace"=c->>'namespace'; cur:=p->'cursor';
 IF cur<>'null'::JSONB THEN
  IF jsonb_typeof(cur) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cur))<>7 OR NOT cur ?& ARRAY['namespace','family','snapshotRevision','actor','occurredAt','operationId','eventKind'] OR cur->>'namespace' IS DISTINCT FROM c->>'namespace' OR cur->>'family' IS DISTINCT FROM 'audit' OR cur->>'snapshotRevision' IS DISTINCT FROM rev::TEXT OR cur->>'actor' IS DISTINCT FROM actor OR cur->>'operationId' !~ '^[A-Za-z0-9_-]{1,120}$' OR cur->>'eventKind' NOT IN ('mutation','identity_sync') OR length(cur->>'occurredAt')>40 THEN RAISE EXCEPTION 'stale cursor'; END IF;
  BEGIN last_time:=(cur->>'occurredAt')::TIMESTAMPTZ; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'stale cursor'; END; last_op:=cur->>'operationId'; last_kind:=cur->>'eventKind';
  IF NOT EXISTS(SELECT 1 FROM public."HuroofAdminAudit" a WHERE a."namespace"=c->>'namespace' AND a."operationId"=last_op AND a."eventKind"=last_kind AND a."occurredAt"=last_time AND (actor IS NULL OR a."actorIdentityId"=actor)) THEN RAISE EXCEPTION 'stale cursor'; END IF;
 END IF;
 WITH selected AS (SELECT a.* FROM public."HuroofAdminAudit" a WHERE a."namespace"=c->>'namespace' AND (actor IS NULL OR a."actorIdentityId"=actor) AND (last_time IS NULL OR (a."occurredAt",a."operationId" COLLATE "C",a."eventKind" COLLATE "C")>(last_time,last_op COLLATE "C",last_kind COLLATE "C")) ORDER BY a."occurredAt",a."operationId" COLLATE "C",a."eventKind" COLLATE "C" LIMIT lim+1), numbered AS (SELECT *,row_number() OVER(ORDER BY "occurredAt","operationId" COLLATE "C","eventKind" COLLATE "C") ord FROM selected)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('operationId',"operationId",'eventKind',"eventKind",'actorUid',(SELECT i."firebaseUid" FROM public."FirebaseIdentity" i WHERE i."id"="actorIdentityId" AND i."firebaseProjectId"=c->>'projectId'),'actorRoles',to_jsonb("actorRoles"),'action',"action",'target',"target",'scope',"scope",'expectedRevision',"expectedRevision",'resultRevision',"resultRevision",'result',"resultCode",'occurredAt',"occurredAt") ORDER BY ord) FILTER(WHERE ord<=lim),'[]'::JSONB),max(jsonb_build_object('namespace',c->>'namespace','family','audit','snapshotRevision',rev::TEXT,'actor',actor,'occurredAt',"occurredAt",'operationId',"operationId",'eventKind',"eventKind")::TEXT) FILTER(WHERE ord=lim)::JSONB,count(*)>lim INTO items,next_item,has_more FROM numbered;
 RETURN jsonb_build_object('items',items,'nextCursor',CASE WHEN has_more THEN next_item ELSE NULL END);
END $$;
CREATE FUNCTION public.eng03_05_operation_get(c JSONB,p_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; o public."HuroofAdminOperation"%ROWTYPE; sync public."HuroofAdminIdentitySyncOutcome"%ROWTYPE;
BEGIN
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'operation unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'audit.read');
 SELECT * INTO o FROM public."HuroofAdminOperation" WHERE ("namespace","operationId")=(c->>'namespace',p_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF; IF o."actorIdentityId"<>c->>'identityId' AND NOT (live->'roles' ? 'super_admin') THEN RAISE EXCEPTION 'operation unavailable'; END IF;
 SELECT * INTO sync FROM public."HuroofAdminIdentitySyncOutcome" WHERE ("namespace","operationId")=(c->>'namespace',p_id);
 RETURN jsonb_build_object('found',true,'receipt',o."result",'sync',CASE WHEN sync."operationId" IS NOT NULL THEN jsonb_build_object('status',sync."outcome",'revision',sync."targetAuthzVersion",'completedAt',sync."completedAt") WHEN o."action" IN ('user.role','user.status','user.revoke') THEN jsonb_build_object('status','pending','revision',o."resultRevision") ELSE NULL END);
END $$;
-- Media raw admission is restricted to a validated, current release question binding.
-- Release-snapshot raw admission is still required; this draft does not claim it.
CREATE FUNCTION public.eng03_05_raw_put(c JSONB,m JSONB,p_id TEXT,p_bytes BYTEA,p_type TEXT,p_serialization TEXT,p_provenance BYTEA) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; raw_hash TEXT; provenance_hash TEXT; proof JSONB; base JSONB; question JSONB; variant JSONB; category TEXT; existing public."HuroofRawArtifact"%ROWTYPE; result JSONB;
BEGIN
 IF p_type='application/json' AND p_serialization='huroof-release-snapshot-v1' THEN
  IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 67108864 OR p_provenance IS NULL OR octet_length(p_provenance)>67108864 THEN RAISE EXCEPTION 'raw unavailable'; END IF;
  raw_hash:=encode(int4_crypto.digest(p_bytes,'sha256'),'hex'); provenance_hash:=encode(int4_crypto.digest(p_provenance,'sha256'),'hex');
  -- Validates structural document sets; root is derived from the immutable lexical bytes.
  category:=public.eng03_05_snapshot_documents_root(p_bytes);
  PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); prior:=public.eng03_05_replay(c,m,'raw.put',p_id);
  IF m->'expectedRevision'<>'null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','raw.put','target',p_id,'expectedRevision',NULL,'payload',jsonb_build_object('hash',raw_hash,'length',octet_length(p_bytes),'mediaType',p_type,'serialization',p_serialization,'provenanceHash',provenance_hash))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
  IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM json_array_elements(convert_from(p_bytes,'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories' AND NOT (live->'categoryScopes' ? split_part(e->>'path','/',4))) THEN RAISE EXCEPTION 'raw unavailable'; END IF;
  IF prior IS NOT NULL THEN RETURN prior; END IF;
  SELECT * INTO existing FROM public."HuroofRawArtifact" WHERE ("namespace","id")=(c->>'namespace',p_id);
  IF FOUND AND (existing."contentHash" IS DISTINCT FROM raw_hash OR existing."rawBytes" IS DISTINCT FROM p_bytes OR existing."mediaType" IS DISTINCT FROM p_type OR existing."serialization" IS DISTINCT FROM p_serialization OR existing."provenanceBytes" IS DISTINCT FROM p_provenance OR existing."provenanceHash" IS DISTINCT FROM provenance_hash) THEN RAISE EXCEPTION 'immutable raw conflict'; END IF;
  result:=jsonb_build_object('operationId',m->>'operationId','revision',1,'status',CASE WHEN existing."id" IS NULL THEN 'created' ELSE 'already_present' END,'documentRoot',category);
  INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','raw.put',p_id,m->>'requestHash',NULL,1,result->>'status',result);
  IF existing."id" IS NULL THEN INSERT INTO public."HuroofRawArtifact"("namespace","id","contentHash","byteLength","mediaType","rawBytes","provenanceBytes","provenanceHash","serialization") VALUES(c->>'namespace',p_id,raw_hash,octet_length(p_bytes),p_type,p_bytes,p_provenance,provenance_hash,p_serialization); END IF;
  PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
 END IF;
 IF p_id !~ '^[A-Za-z0-9_-]{1,120}$' OR p_bytes IS NULL OR octet_length(p_bytes) NOT BETWEEN 1 AND 1000000 OR p_provenance IS NULL OR octet_length(p_provenance)>65536 OR p_type NOT IN ('image/png','image/jpeg','video/mp4') OR p_serialization IS DISTINCT FROM 'huroof-admin-media-v1' THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 raw_hash:=encode(int4_crypto.digest(p_bytes,'sha256'),'hex'); provenance_hash:=encode(int4_crypto.digest(p_provenance,'sha256'),'hex');
 proof:=convert_from(p_provenance,'UTF8')::JSONB;
 IF convert_from(p_provenance,'UTF8') IS DISTINCT FROM public.int5b_canonical_json(proof) OR jsonb_typeof(proof) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>9 OR NOT proof ?& ARRAY['schemaVersion','namespace','profileScope','releaseId','questionId','variant','mediaId','generation','contentHash'] OR proof->>'schemaVersion'<>'huroof-admin-media-binding-v1' OR proof->>'namespace' IS DISTINCT FROM c->>'namespace' OR proof->>'profileScope' !~ '^[A-Za-z0-9_-]{1,120}$' OR proof->>'releaseId' !~ '^[A-Za-z0-9_-]{1,120}$' OR proof->>'questionId' !~ '^[A-Za-z0-9_-]{1,120}$' OR proof->>'variant' NOT IN ('question','answer') OR proof->>'mediaId' !~ '^[A-Za-z0-9:_-]{1,128}$' OR proof->>'generation' !~ '^[1-9][0-9]{0,18}$' OR proof->>'contentHash' IS DISTINCT FROM raw_hash THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 IF (p_type='image/png' AND encode(substring(p_bytes FROM 1 FOR 8),'hex')<>'89504e470d0a1a0a') OR (p_type='image/jpeg' AND encode(substring(p_bytes FROM 1 FOR 3),'hex')<>'ffd8ff') OR (p_type='video/mp4' AND (octet_length(p_bytes)<12 OR convert_from(substring(p_bytes FROM 5 FOR 4),'SQL_ASCII')<>'ftyp')) THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); prior:=public.eng03_05_replay(c,m,'raw.put',p_id);
 IF m->'expectedRevision'<>'null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','raw.put','target',p_id,'expectedRevision',NULL,'payload',jsonb_build_object('hash',raw_hash,'length',octet_length(p_bytes),'mediaType',p_type,'serialization',p_serialization,'provenanceHash',provenance_hash))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 base:=public.eng03_05_snapshot_read(c,proof->>'profileScope',proof->>'releaseId');
 SELECT value->'data' INTO question FROM jsonb_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSONB->'documents') WHERE value->>'path'='releases/'||(proof->>'releaseId')||'/questions/'||(proof->>'questionId');
 IF question IS NULL OR question->>'id' IS DISTINCT FROM proof->>'questionId' OR question->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 category:=question->>'categoryId'; IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? category) THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 variant:=(CASE WHEN proof->>'variant'='question' THEN question->'media' ELSE question->'answerMedia' END);
 IF variant->>'mediaId' IS DISTINCT FROM proof->>'mediaId' OR variant->>'assetSha256' IS DISTINCT FROM raw_hash OR (variant ? 'contentType' AND variant->>'contentType' IS DISTINCT FROM p_type) OR (variant ? 'type' AND variant->>'type' IS DISTINCT FROM (CASE WHEN p_type='video/mp4' THEN 'video' ELSE 'image' END)) THEN RAISE EXCEPTION 'raw unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 SELECT * INTO existing FROM public."HuroofRawArtifact" WHERE ("namespace","id")=(c->>'namespace',p_id);
 IF FOUND AND (existing."contentHash" IS DISTINCT FROM raw_hash OR existing."rawBytes" IS DISTINCT FROM p_bytes OR existing."mediaType" IS DISTINCT FROM p_type OR existing."serialization" IS DISTINCT FROM p_serialization OR existing."provenanceBytes" IS DISTINCT FROM p_provenance OR existing."provenanceHash" IS DISTINCT FROM provenance_hash) THEN RAISE EXCEPTION 'immutable raw conflict'; END IF;
 result:=jsonb_build_object('operationId',m->>'operationId','revision',1,'status',CASE WHEN existing."id" IS NULL THEN 'created' ELSE 'already_present' END);
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','raw.put',p_id,m->>'requestHash',NULL,1,result->>'status',result);
 IF existing."id" IS NULL THEN INSERT INTO public."HuroofRawArtifact"("namespace","id","contentHash","byteLength","mediaType","rawBytes","provenanceBytes","provenanceHash","serialization") VALUES(c->>'namespace',p_id,raw_hash,octet_length(p_bytes),p_type,p_bytes,p_provenance,provenance_hash,p_serialization); END IF;
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_registry_lookup(c JSONB,p_target TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."HuroofAdminPrincipal"%ROWTYPE;
BEGIN
 IF p_target !~ '^[A-Za-z0-9._:-]{1,200}$' THEN RAISE EXCEPTION 'registry unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); PERFORM public.eng03_05_assert_admin(c,'users.read');
 IF NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" i WHERE i."id"=p_target AND i."firebaseProjectId"=c->>'projectId') THEN RAISE EXCEPTION 'registry unavailable'; END IF;
 SELECT * INTO r FROM public."HuroofAdminPrincipal" WHERE ("namespace","identityId")=(c->>'namespace',p_target);
 IF NOT FOUND THEN RETURN 'null'::JSONB; END IF;
 RETURN jsonb_build_object('enabled',r."enabled",'disabled',r."disabled",'identityReady',r."identityReady",'roles',to_jsonb(r."roles"),'categoryScopes',to_jsonb(r."categoryScopes"),'reviewerScopes',to_jsonb(r."reviewerScopes"),'authzVersion',r."authzVersion"::TEXT);
END $$;
CREATE FUNCTION public.eng03_05_correction_get(c JSONB,p_scope TEXT,p_category TEXT,p_release TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; base JSONB; cat JSONB; label TEXT; d public."HuroofAdminCategoryCorrectionRevision"%ROWTYPE;
BEGIN
 IF p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_category !~ '^[A-Za-z0-9_-]{1,120}$' OR p_release !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'categories.read');
 IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? p_category) THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 base:=public.eng03_05_snapshot_read(c,p_scope,p_release);
 SELECT value->'data' INTO cat FROM jsonb_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSONB->'documents') WHERE value->>'path'='releases/'||p_release||'/catalogCategories/'||p_category;
 IF cat IS NULL OR cat->>'id' IS DISTINCT FROM p_category THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 IF (cat ? 'labelAr' AND jsonb_typeof(cat->'labelAr') NOT IN ('string','null')) OR (cat ? 'displayNameAr' AND jsonb_typeof(cat->'displayNameAr') NOT IN ('string','null')) THEN RAISE EXCEPTION 'correction unavailable'; END IF; label:=COALESCE(cat->>'labelAr',cat->>'displayNameAr',p_category); IF length(label)>160 THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 SELECT * INTO d FROM public."HuroofAdminCategoryCorrectionRevision" WHERE ("namespace","categoryId","releaseId")=(c->>'namespace',p_category,p_release) ORDER BY "revision" DESC LIMIT 1;
 IF d."revision" IS NOT NULL AND (d."baseReleaseRootHash" IS DISTINCT FROM base->>'releaseRoot' OR d."publishedLabelAr" IS DISTINCT FROM label) THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 RETURN jsonb_build_object('categoryId',p_category,'releaseId',p_release,'releaseRoot',base->>'releaseRoot','publishedLabelAr',label,'draft',CASE WHEN d."revision" IS NULL THEN NULL ELSE jsonb_build_object('revision',d."revision",'proposedLabelAr',d."proposedLabelAr",'internalNote',CASE WHEN (live->'roles' ? 'super_admin') OR (live->'roles' ? 'content_admin') THEN d."internalNote" ELSE NULL END,'status',d."status") END);
END $$;
CREATE FUNCTION public.eng03_05_correction_save(c JSONB,m JSONB,p_scope TEXT,p_category TEXT,p_release TEXT,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; base JSONB; d public."HuroofAdminCategoryCorrectionRevision"%ROWTYPE; expected BIGINT; result JSONB; target TEXT; old_hash TEXT;
BEGIN
 IF p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_category !~ '^[A-Za-z0-9_-]{1,120}$' OR p_release !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>4 OR NOT p ?& ARRAY['proposedLabelAr','internalNote','expectedRoot','publishedLabelAr'] OR jsonb_typeof(p->'expectedRoot') IS DISTINCT FROM 'string' OR p->>'expectedRoot' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'publishedLabelAr') IS DISTINCT FROM 'string' OR length(p->>'publishedLabelAr')>160 OR jsonb_typeof(p->'proposedLabelAr') IS DISTINCT FROM 'string' OR length(btrim(p->>'proposedLabelAr')) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p->'internalNote') IS DISTINCT FROM 'string' OR length(p->>'internalNote')>2000 THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'categories.write'); IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? p_category) THEN RAISE EXCEPTION 'correction unavailable'; END IF;
 target:=p_category||'/'||p_release; prior:=public.eng03_05_replay(c,m,'category.correction-draft.save',target);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','category.correction-draft.save','target',target,'expectedRevision',m->'expectedRevision','payload',jsonb_build_object('profileScope',p_scope,'releaseId',p_release,'categoryId',p_category,'draft',p))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 base:=public.eng03_05_correction_get(c,p_scope,p_category,p_release); IF base->>'releaseRoot' IS DISTINCT FROM p->>'expectedRoot' OR base->>'publishedLabelAr' IS DISTINCT FROM p->>'publishedLabelAr' THEN RAISE EXCEPTION 'stale baseline'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF; expected:=(m->>'expectedRevision')::BIGINT;
 SELECT * INTO d FROM public."HuroofAdminCategoryCorrectionRevision" WHERE ("namespace","categoryId","releaseId")=(c->>'namespace',p_category,p_release) ORDER BY "revision" DESC LIMIT 1;
 IF COALESCE(d."revision",0)<>expected THEN RAISE EXCEPTION 'stale correction'; END IF;
 old_hash:=(CASE WHEN expected=0 THEN NULL ELSE public.int5b_hash_json(jsonb_build_object('revision',d."revision",'baseReleaseRootHash',d."baseReleaseRootHash",'publishedLabelAr',d."publishedLabelAr",'proposedLabelAr',d."proposedLabelAr",'internalNote',CASE WHEN (live->'roles' ? 'super_admin') OR (live->'roles' ? 'content_admin') THEN d."internalNote" ELSE NULL END,'status',d."status")) END);
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','draft_saved','releaseRoot',base->>'releaseRoot','publishedLabelAr',base->>'publishedLabelAr');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','category.correction-draft.save',target,p_scope,m->>'requestHash',expected,expected+1,'draft_saved',result);
 INSERT INTO public."HuroofAdminCategoryCorrectionRevision"("namespace","categoryId","releaseId","revision","baseReleaseRootHash","publishedLabelAr","proposedLabelAr","internalNote","status","originalAuthorId","updatedBy","predecessorRevision","predecessorHash","operationId") VALUES(c->>'namespace',p_category,p_release,expected+1,base->>'releaseRoot',base->>'publishedLabelAr',p->>'proposedLabelAr',p->>'internalNote','draft',COALESCE(d."originalAuthorId",c->>'identityId'),c->>'identityId',CASE WHEN expected=0 THEN NULL ELSE expected END,old_hash,m->>'operationId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_review_chain_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev public."HuroofAdminReviewRevision"%ROWTYPE;
BEGIN
 IF NEW."revision"=1 THEN IF NEW."status"<>'in_review' OR EXISTS(SELECT 1 FROM public."HuroofAdminReviewRevision" WHERE "namespace"=NEW."namespace" AND "reviewId"=NEW."reviewId") THEN RAISE EXCEPTION 'invalid review chain'; END IF;
 ELSE SELECT * INTO prev FROM public."HuroofAdminReviewRevision" WHERE ("namespace","reviewId","revision")=(NEW."namespace",NEW."reviewId",NEW."revision"-1);
  IF NOT FOUND OR NEW."questionId" IS DISTINCT FROM prev."questionId" OR NEW."authorIdentityId" IS DISTINCT FROM prev."authorIdentityId" OR NOT ((prev."status"='changes_requested' AND NEW."status"='in_review') OR (prev."status"='in_review' AND NEW."status"='changes_requested' AND NEW."submittedQuestionRevision"=prev."submittedQuestionRevision" AND NEW."submittedQuestionHash"=prev."submittedQuestionHash" AND NEW."categoryId"=prev."categoryId")) OR EXISTS(SELECT 1 FROM public."HuroofAdminReviewRevision" WHERE "namespace"=NEW."namespace" AND "reviewId"=NEW."reviewId" AND "revision">=NEW."revision") THEN RAISE EXCEPTION 'invalid review chain'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdminReviewChain" BEFORE INSERT ON public."HuroofAdminReviewRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_05_review_chain_guard();
CREATE FUNCTION public.eng03_05_metadata_chain_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev public."HuroofAdminCategoryMetadataRevision"%ROWTYPE; prev_hash TEXT;
BEGIN
 IF NEW."revision"=1 THEN IF NEW."predecessorRevision" IS NOT NULL OR NEW."predecessorHash" IS NOT NULL OR EXISTS(SELECT 1 FROM public."HuroofAdminCategoryMetadataRevision" WHERE "namespace"=NEW."namespace" AND "categoryId"=NEW."categoryId") THEN RAISE EXCEPTION 'invalid metadata chain'; END IF;
 ELSE SELECT * INTO prev FROM public."HuroofAdminCategoryMetadataRevision" WHERE ("namespace","categoryId","revision")=(NEW."namespace",NEW."categoryId",NEW."revision"-1);
  prev_hash:=public.int5b_hash_json(jsonb_build_object('revision',prev."revision",'titleAr',prev."titleAr",'descriptionAr',prev."descriptionAr",'enabled',prev."enabled"));
  IF NOT FOUND OR NEW."predecessorRevision" IS DISTINCT FROM prev."revision" OR NEW."predecessorHash" IS DISTINCT FROM prev_hash OR EXISTS(SELECT 1 FROM public."HuroofAdminCategoryMetadataRevision" WHERE "namespace"=NEW."namespace" AND "categoryId"=NEW."categoryId" AND "revision">=NEW."revision") THEN RAISE EXCEPTION 'invalid metadata chain'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdminMetadataChain" BEFORE INSERT ON public."HuroofAdminCategoryMetadataRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_05_metadata_chain_guard();
CREATE FUNCTION public.eng03_05_settings_chain_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev public."HuroofAdminSettingsRevision"%ROWTYPE; prev_hash TEXT;
BEGIN
 IF NEW."revision"=1 THEN IF NEW."predecessorRevision" IS NOT NULL OR NEW."predecessorHash" IS NOT NULL OR EXISTS(SELECT 1 FROM public."HuroofAdminSettingsRevision" WHERE "namespace"=NEW."namespace") THEN RAISE EXCEPTION 'invalid settings chain'; END IF;
 ELSE SELECT * INTO prev FROM public."HuroofAdminSettingsRevision" WHERE ("namespace","revision")=(NEW."namespace",NEW."revision"-1);
  prev_hash:=public.int5b_hash_json(jsonb_build_object('revision',prev."revision",'schemaVersion',prev."schemaVersion",'maintenanceMode',prev."maintenanceMode",'maintenanceMessageAr',prev."maintenanceMessageAr",'roomCreationEnabled',prev."roomCreationEnabled",'defaultQuestionTimerSeconds',prev."defaultQuestionTimerSeconds",'defaultOpponentTimerSeconds',prev."defaultOpponentTimerSeconds",'roomRetentionDays',prev."roomRetentionDays"));
  IF NOT FOUND OR NEW."predecessorRevision" IS DISTINCT FROM prev."revision" OR NEW."predecessorHash" IS DISTINCT FROM prev_hash OR EXISTS(SELECT 1 FROM public."HuroofAdminSettingsRevision" WHERE "namespace"=NEW."namespace" AND "revision">=NEW."revision") THEN RAISE EXCEPTION 'invalid settings chain'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdminSettingsChain" BEFORE INSERT ON public."HuroofAdminSettingsRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_05_settings_chain_guard();
CREATE FUNCTION public.eng03_05_correction_chain_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prev public."HuroofAdminCategoryCorrectionRevision"%ROWTYPE; prev_hash TEXT;
BEGIN
 IF NEW."revision"=1 THEN IF NEW."predecessorRevision" IS NOT NULL OR NEW."predecessorHash" IS NOT NULL OR EXISTS(SELECT 1 FROM public."HuroofAdminCategoryCorrectionRevision" WHERE "namespace"=NEW."namespace" AND "categoryId"=NEW."categoryId" AND "releaseId"=NEW."releaseId") THEN RAISE EXCEPTION 'invalid correction chain'; END IF;
 ELSE SELECT * INTO prev FROM public."HuroofAdminCategoryCorrectionRevision" WHERE ("namespace","categoryId","releaseId","revision")=(NEW."namespace",NEW."categoryId",NEW."releaseId",NEW."revision"-1);
  prev_hash:=public.int5b_hash_json(jsonb_build_object('revision',prev."revision",'baseReleaseRootHash',prev."baseReleaseRootHash",'publishedLabelAr',prev."publishedLabelAr",'proposedLabelAr',prev."proposedLabelAr",'internalNote',prev."internalNote",'status',prev."status"));
  IF NOT FOUND OR NEW."predecessorRevision" IS DISTINCT FROM prev."revision" OR NEW."predecessorHash" IS DISTINCT FROM prev_hash OR NEW."originalAuthorId" IS DISTINCT FROM prev."originalAuthorId" OR NEW."baseReleaseRootHash" IS DISTINCT FROM prev."baseReleaseRootHash" OR NEW."publishedLabelAr" IS DISTINCT FROM prev."publishedLabelAr" OR EXISTS(SELECT 1 FROM public."HuroofAdminCategoryCorrectionRevision" WHERE "namespace"=NEW."namespace" AND "categoryId"=NEW."categoryId" AND "releaseId"=NEW."releaseId" AND "revision">=NEW."revision") THEN RAISE EXCEPTION 'invalid correction chain'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdminCorrectionChain" BEFORE INSERT ON public."HuroofAdminCategoryCorrectionRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_05_correction_chain_guard();
CREATE FUNCTION public.eng03_05_inspection_get(c JSONB,p_scope TEXT,p_release TEXT,p_question TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; base JSONB; doc JSON; category TEXT; digest TEXT; marker public."HuroofAdminPublishedQuestionInspection"%ROWTYPE;
BEGIN
 IF p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_release !~ '^[A-Za-z0-9_-]{1,120}$' OR p_question !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'inspection unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.read'); base:=public.eng03_05_snapshot_read(c,p_scope,p_release);
 SELECT value INTO doc FROM json_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSON->'documents') WHERE value->>'path'='releases/'||p_release||'/questions/'||p_question;
 IF doc IS NULL OR doc->'data'->>'id' IS DISTINCT FROM p_question OR doc->'data'->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'inspection unavailable'; END IF;
 category:=doc->'data'->>'categoryId'; IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? category) THEN RAISE EXCEPTION 'inspection unavailable'; END IF;
 digest:=encode(int4_crypto.digest(convert_to(doc::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO marker FROM public."HuroofAdminPublishedQuestionInspection" WHERE ("namespace","releaseId","questionId")=(c->>'namespace',p_release,p_question);
 IF marker."questionId" IS NOT NULL AND (marker."releaseRootHash" IS DISTINCT FROM base->>'releaseRoot' OR marker."categoryId" IS DISTINCT FROM category OR marker."digestKind" IS DISTINCT FROM 'release-question-document-raw-sha256-v1' OR marker."questionDocumentDigest" IS DISTINCT FROM digest) THEN RAISE EXCEPTION 'inspection unavailable'; END IF;
 RETURN jsonb_build_object('releaseId',p_release,'releaseRoot',base->>'releaseRoot','questionId',p_question,'categoryId',category,'digestKind','release-question-document-raw-sha256-v1','questionDocumentDigest',digest,'reviewed',marker."questionId" IS NOT NULL,'reviewedAt',marker."inspectedAt");
END $$;
CREATE FUNCTION public.eng03_05_inspection_mark(c JSONB,m JSONB,p_scope TEXT,p_release TEXT,p_question TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; baseline JSONB; target TEXT; marker public."HuroofAdminPublishedQuestionInspection"%ROWTYPE; result JSONB; result_code TEXT;
BEGIN
 IF p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_release !~ '^[A-Za-z0-9_-]{1,120}$' OR p_question !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'inspection unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.inspect'); target:=p_release||'/'||p_question; prior:=public.eng03_05_replay(c,m,'published-question.inspection.mark',target);
 baseline:=public.eng03_05_inspection_get(c,p_scope,p_release,p_question);
 IF m->'expectedRevision'<>'null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','published-question.inspection.mark','target',target,'expectedRevision',NULL,'payload',jsonb_build_object('profileScope',p_scope,'releaseId',p_release,'questionId',p_question,'releaseRoot',baseline->>'releaseRoot','digestKind',baseline->>'digestKind','questionDocumentDigest',baseline->>'questionDocumentDigest'))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 SELECT * INTO marker FROM public."HuroofAdminPublishedQuestionInspection" WHERE ("namespace","releaseId","questionId")=(c->>'namespace',p_release,p_question);
 result_code:=(CASE WHEN marker."questionId" IS NULL THEN 'inspected' ELSE 'already_inspected' END);
 result:=jsonb_build_object('operationId',m->>'operationId','revision',1,'status',result_code,'digestKind',baseline->>'digestKind','questionDocumentDigest',baseline->>'questionDocumentDigest','releaseRoot',baseline->>'releaseRoot');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','published-question.inspection.mark',target,p_scope,m->>'requestHash',NULL,1,result_code,result);
 IF marker."questionId" IS NULL THEN INSERT INTO public."HuroofAdminPublishedQuestionInspection"("namespace","releaseId","questionId","releaseRootHash","digestKind","questionDocumentDigest","categoryId","inspectedBy","operationId") VALUES(c->>'namespace',p_release,p_question,baseline->>'releaseRoot',baseline->>'digestKind',baseline->>'questionDocumentDigest',baseline->>'categoryId',c->>'identityId',m->>'operationId'); END IF;
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_revision_append(c JSONB,m JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; raw public."HuroofRawArtifact"%ROWTYPE; previous public."HuroofContentRevision"%ROWTYPE; old_raw public."HuroofRawArtifact"%ROWTYPE; expected BIGINT; source TEXT; target TEXT; root TEXT; result JSONB;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>8 OR NOT p ?& ARRAY['family','sourceId','revision','rawArtifactId','rawArtifactHash','previousRevision','previousHash','previousRawArtifactId'] OR p->>'family' IS DISTINCT FROM 'release' OR p->>'sourceId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'rawArtifactId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'rawArtifactHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p->'revision') IS DISTINCT FROM 'number' OR p->>'revision' !~ '^[1-9][0-9]{0,15}$' OR (p->>'revision')::NUMERIC>9007199254740991 THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 source:=p->>'sourceId'; target:='release/'||source;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); prior:=public.eng03_05_replay(c,m,'content.revision.append',target);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','content.revision.append','target',target,'expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF; expected:=(m->>'expectedRevision')::BIGINT;
 IF (p->>'revision')::BIGINT<>expected+1 THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 SELECT * INTO raw FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash","mediaType","serialization")=(c->>'namespace',p->>'rawArtifactId',p->>'rawArtifactHash','application/json','huroof-release-snapshot-v1'); IF NOT FOUND THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 root:=public.eng03_05_snapshot_documents_root(raw."rawBytes"); IF convert_from(raw."rawBytes",'UTF8')::JSON->>'releaseId' IS DISTINCT FROM source THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM json_array_elements(convert_from(raw."rawBytes",'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories' AND NOT (live->'categoryScopes' ? split_part(e->>'path','/',4))) THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 IF expected=0 THEN IF p->'previousRevision'<>'null'::JSONB OR p->'previousHash'<>'null'::JSONB OR p->'previousRawArtifactId'<>'null'::JSONB THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 ELSE SELECT * INTO previous FROM public."HuroofContentRevision" WHERE ("namespace","family","sourceId","revision")=(c->>'namespace','release',source,expected);
  IF NOT FOUND OR p->>'previousRevision' IS DISTINCT FROM expected::TEXT OR p->>'previousHash' IS DISTINCT FROM previous."rawArtifactHash" OR p->>'previousRawArtifactId' IS DISTINCT FROM previous."rawArtifactId" THEN RAISE EXCEPTION 'revision unavailable'; END IF;
  SELECT * INTO old_raw FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash")=(previous."namespace",previous."rawArtifactId",previous."rawArtifactHash");
  IF NOT FOUND OR old_raw."serialization" IS DISTINCT FROM 'huroof-release-snapshot-v1' THEN RAISE EXCEPTION 'revision unavailable'; END IF;
  PERFORM public.eng03_05_snapshot_documents_root(old_raw."rawBytes");
  IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM json_array_elements(convert_from(old_raw."rawBytes",'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories' AND NOT (live->'categoryScopes' ? split_part(e->>'path','/',4))) THEN RAISE EXCEPTION 'revision unavailable'; END IF;
 END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofContentRevision" r WHERE (r."namespace",r."family",r."sourceId")=(c->>'namespace','release',source) AND r."revision">expected) THEN RAISE EXCEPTION 'stale revision'; END IF;
 result:=jsonb_build_object('operationId',m->>'operationId','revision',expected+1,'status','appended','documentRoot',root);
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','content.revision.append',target,m->>'requestHash',expected,expected+1,'appended',result);
 INSERT INTO public."HuroofContentRevision"("namespace","family","sourceId","revision","rawArtifactId","rawArtifactHash","previousRevision","previousHash","previousRawArtifactId","actorFirebaseIdentityId") VALUES(c->>'namespace','release',source,expected+1,raw."id",raw."contentHash",CASE WHEN expected=0 THEN NULL ELSE expected END,CASE WHEN expected=0 THEN NULL ELSE previous."rawArtifactHash" END,CASE WHEN expected=0 THEN NULL ELSE previous."rawArtifactId" END,c->>'identityId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_assert_evidence(p_subject JSONB,p_authority JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE now_ms NUMERIC;
BEGIN
 IF jsonb_typeof(p_subject) IS DISTINCT FROM 'object' OR jsonb_typeof(p_authority) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_authority))<>12 OR NOT p_authority ?& ARRAY['evidenceVersion','evidenceId','evidenceHash','issuerId','keyId','trustRootId','policyId','policyRevision','policyHash','validatedAt','validUntil','subjectHash'] OR EXISTS(SELECT 1 FROM jsonb_each(p_authority) WHERE key NOT IN ('validatedAt','validUntil') AND jsonb_typeof(value) IS DISTINCT FROM 'string') OR p_authority->>'evidenceVersion' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'evidenceId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'issuerId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'keyId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'trustRootId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'policyId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_authority->>'policyRevision' !~ '^[1-9][0-9]*$' OR p_authority->>'policyHash' !~ '^[a-f0-9]{64}$' OR p_authority->>'evidenceHash' !~ '^[a-f0-9]{64}$' OR p_authority->>'subjectHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_authority->'validatedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(p_authority->'validUntil') IS DISTINCT FROM 'number' OR p_authority->>'validatedAt' !~ '^[0-9]{1,16}$' OR p_authority->>'validUntil' !~ '^[0-9]{1,16}$' THEN RAISE EXCEPTION 'evidence unavailable'; END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000);
 IF (p_authority->>'validatedAt')::NUMERIC>now_ms OR (p_authority->>'validUntil')::NUMERIC<=now_ms OR (p_authority->>'validUntil')::NUMERIC<=(p_authority->>'validatedAt')::NUMERIC OR p_authority->>'subjectHash' IS DISTINCT FROM public.int5b_hash_json(p_subject) THEN RAISE EXCEPTION 'evidence unavailable'; END IF;
END $$;
-- Owner-only preparation helpers. Callers hold invariant, policy/principal,
-- catalog singleton and profile pointer locks in that order before invoking.
CREATE FUNCTION public.eng03_05_prepare_snapshot(c JSONB,live JSONB,p_snapshot TEXT,p_receipt TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE snap public."HuroofRawArtifact"%ROWTYPE; rec public."CatalogValidationReceipt"%ROWTYPE; cats JSONB; root TEXT;
BEGIN
 SELECT * INTO snap FROM public."HuroofRawArtifact" WHERE "namespace"=c->>'namespace' AND "id"=p_snapshot AND "mediaType"='application/json' AND "serialization"='huroof-release-snapshot-v1' AND "byteLength" BETWEEN 1 AND 67108864 AND octet_length("provenanceBytes")<=67108864;
 IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 SELECT receipt.* INTO rec FROM public."CatalogValidationReceipt" receipt JOIN public."CatalogReleaseSeal" seal ON (seal."catalogReleaseId",seal."releaseRootHash",seal."sealHash")=(receipt."catalogReleaseId",receipt."releaseRootHash",receipt."sealHash") JOIN public."ActiveCatalogPointer" active ON active."id"='singleton' AND (active."validationReceiptId",active."catalogReleaseId",active."releaseRootHash")=(receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash") WHERE receipt."id"=p_receipt AND receipt."huroofProjectId"=c->>'projectId';
 IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 root:=public.eng03_05_snapshot_documents_root(snap."rawBytes"); IF root IS DISTINCT FROM rec."huroofRootSha256" OR convert_from(snap."rawBytes",'UTF8')::JSON->>'releaseId' IS DISTINCT FROM rec."huroofReleaseId" THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 SELECT COALESCE(jsonb_agg(id ORDER BY id COLLATE "C"),'[]'::JSONB) INTO cats FROM (SELECT split_part(e->>'path','/',4) id FROM json_array_elements(convert_from(snap."rawBytes",'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories') x;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(cats) e(id) WHERE NOT (live->'categoryScopes' ? id)) THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 RETURN jsonb_build_object('snapshot',jsonb_build_object('id',snap."id",'hash',snap."contentHash",'length',snap."byteLength"::TEXT,'mediaType',snap."mediaType",'serialization',snap."serialization",'provenanceHash',snap."provenanceHash",'rawBase64',replace(replace(encode(snap."rawBytes",'base64'),chr(10),''),chr(13),''),'provenanceBase64',replace(replace(encode(snap."provenanceBytes",'base64'),chr(10),''),chr(13),'')),
 'receipt',jsonb_build_object('id',rec."id",'catalogId',rec."catalogReleaseId",'catalogRoot',rec."releaseRootHash",'sealHash',rec."sealHash",'huroofProjectId',rec."huroofProjectId",'releaseId',rec."huroofReleaseId",'releaseRoot',rec."huroofRootSha256",'sourceEvidenceManifestHash',rec."sourceEvidenceManifestHash",'selectorVersion',rec."selectorVersion",'policyVersion',rec."policyVersion"),'categories',cats);
END $$;
CREATE FUNCTION public.eng03_05_prepare_profile(c JSONB,live JSONB,p_source TEXT,p_revision BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE rev public."HuroofContentRevision"%ROWTYPE; raw public."HuroofRawArtifact"%ROWTYPE; ref JSONB; bound JSONB;
BEGIN
 SELECT * INTO rev FROM public."HuroofContentRevision" WHERE ("namespace","family","sourceId","revision")=(c->>'namespace','profile',p_source,p_revision); IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 SELECT * INTO raw FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash")=(rev."namespace",rev."rawArtifactId",rev."rawArtifactHash") AND "byteLength" BETWEEN 1 AND 67108864 AND "mediaType"='application/json' AND "serialization" NOT IN ('huroof-custody-authority-policy-v1','huroof-release-snapshot-v1') AND octet_length("provenanceBytes")<=67108864; IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 ref:=convert_from(raw."rawBytes",'UTF8')::JSONB->'contentSnapshot'; IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref->>'namespace' IS DISTINCT FROM c->>'namespace' THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 bound:=public.eng03_05_prepare_snapshot(c,live,ref->>'id',rev."validationReceiptId");
 IF bound->'snapshot'->>'id' IS DISTINCT FROM ref->>'id' OR bound->'snapshot'->>'hash' IS DISTINCT FROM ref->>'hash' OR bound->'snapshot'->>'length' IS DISTINCT FROM ref->>'byteLength' OR bound->'snapshot'->>'mediaType' IS DISTINCT FROM ref->>'mediaType' OR bound->'snapshot'->>'serialization' IS DISTINCT FROM ref->>'serialization' OR bound->'snapshot'->>'provenanceHash' IS DISTINCT FROM ref->>'provenanceHash' OR bound->'receipt'->>'catalogId' IS DISTINCT FROM rev."catalogReleaseId" OR bound->'receipt'->>'catalogRoot' IS DISTINCT FROM rev."releaseRootHash" THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 RETURN jsonb_build_object('family','profile','sourceId',rev."sourceId",'revision',rev."revision"::TEXT,'rawArtifactId',raw."id",'rawArtifactHash',raw."contentHash",'rawByteLength',raw."byteLength"::TEXT,'rawMediaType',raw."mediaType",'rawSerialization',raw."serialization",'rawProvenanceHash',raw."provenanceHash",'profileRawBase64',replace(replace(encode(raw."rawBytes",'base64'),chr(10),''),chr(13),''),'profileProvenanceBase64',replace(replace(encode(raw."provenanceBytes",'base64'),chr(10),''),chr(13),''),'snapshot',bound->'snapshot','receipt',bound->'receipt','categories',bound->'categories');
END $$;
CREATE FUNCTION public.eng03_05_profile_prepare(c JSONB,p_scope TEXT,p_source TEXT,p_snapshot TEXT,p_receipt TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; ptr public."HuroofContentPointer"%ROWTYPE; current_data JSONB; current_pointer JSONB; latest BIGINT; predecessor JSONB; bound JSONB;
BEGIN
 IF (p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_scope='huroof-release-snapshot-v1') OR p_source !~ '^[A-Za-z0-9_-]{1,120}$' OR p_snapshot !~ '^[A-Za-z0-9_-]{1,120}$' OR p_receipt !~ '^[A-Za-z0-9._:-]{1,200}$' THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'releases.stage');
 PERFORM 1 FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 SELECT * INTO ptr FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope")=(c->>'namespace','profile',p_scope) FOR SHARE;
 IF ptr."scope" IS NOT NULL THEN
  IF ptr."family"<>'profile' THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
  current_data:=public.eng03_05_prepare_profile(c,live,ptr."sourceId",ptr."revision"); IF current_data->>'rawArtifactHash' IS DISTINCT FROM ptr."rawArtifactHash" THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
  current_pointer:=jsonb_build_object('exists',true,'version',ptr."version"::TEXT,'family','profile','sourceId',ptr."sourceId",'revision',ptr."revision"::TEXT,'rawArtifactId',current_data->>'rawArtifactId','rawArtifactHash',current_data->>'rawArtifactHash','validationReceiptId',current_data->'receipt'->>'id','catalogReleaseId',current_data->'receipt'->>'catalogId','releaseRootHash',current_data->'receipt'->>'catalogRoot');
 ELSE current_pointer:=jsonb_build_object('exists',false); END IF;
 bound:=public.eng03_05_prepare_snapshot(c,live,p_snapshot,p_receipt);
 SELECT max("revision") INTO latest FROM public."HuroofContentRevision" WHERE ("namespace","family","sourceId")=(c->>'namespace','profile',p_source); IF latest IS NOT NULL THEN predecessor:=public.eng03_05_prepare_profile(c,live,p_source,latest); END IF;
 RETURN jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','identityId',c->>'identityId','identityPolicyRevision',c->>'policyRevision','identityPolicyHash',c->>'policyHash','profileScope',p_scope,'profileSourceId',p_source,'currentPointer',current_pointer,'predecessor',predecessor,'snapshot',bound->'snapshot','receipt',bound->'receipt','categories',bound->'categories');
END $$;
CREATE FUNCTION public.eng03_05_pointer_prepare(c JSONB,p_scope TEXT,p_source TEXT,p_revision BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; ptr public."HuroofContentPointer"%ROWTYPE; current_data JSONB; current_pointer JSONB; target JSONB;
BEGIN
 IF (p_scope !~ '^[A-Za-z0-9_-]{1,120}$' OR p_scope='huroof-release-snapshot-v1') OR p_source !~ '^[A-Za-z0-9_-]{1,120}$' OR p_revision<1 THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'releases.stage');
 PERFORM 1 FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'preparation unavailable'; END IF;
 SELECT * INTO ptr FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope")=(c->>'namespace','profile',p_scope) FOR SHARE;
 IF ptr."scope" IS NOT NULL THEN IF ptr."family"<>'profile' THEN RAISE EXCEPTION 'preparation unavailable'; END IF; current_data:=public.eng03_05_prepare_profile(c,live,ptr."sourceId",ptr."revision"); IF current_data->>'rawArtifactHash' IS DISTINCT FROM ptr."rawArtifactHash" THEN RAISE EXCEPTION 'preparation unavailable'; END IF; current_pointer:=jsonb_build_object('exists',true,'version',ptr."version"::TEXT,'family','profile','sourceId',ptr."sourceId",'revision',ptr."revision"::TEXT,'rawArtifactId',current_data->>'rawArtifactId','rawArtifactHash',current_data->>'rawArtifactHash','validationReceiptId',current_data->'receipt'->>'id','catalogReleaseId',current_data->'receipt'->>'catalogId','releaseRootHash',current_data->'receipt'->>'catalogRoot'); ELSE current_pointer:=jsonb_build_object('exists',false); END IF;
 target:=public.eng03_05_prepare_profile(c,live,p_source,p_revision);
 RETURN jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','identityId',c->>'identityId','identityPolicyRevision',c->>'policyRevision','identityPolicyHash',c->>'policyHash','profileScope',p_scope,'currentPointer',current_pointer,'target',target);
END $$;
-- Publisher-only trusted backend: independently validated authority summary is persisted,
-- while SQL rechecks the locked subject. SQL does not verify external signatures.
CREATE FUNCTION public.eng03_05_profile_append(c JSONB,m JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; metadata JSONB; raw_bytes BYTEA; provenance BYTEA; raw_hash TEXT; prov_hash TEXT; profile JSONB; ref JSONB; snap public."HuroofRawArtifact"%ROWTYPE; old_raw public."HuroofRawArtifact"%ROWTYPE; old_snap public."HuroofRawArtifact"%ROWTYPE; existing public."HuroofRawArtifact"%ROWTYPE; prev public."HuroofContentRevision"%ROWTYPE; rec public."CatalogValidationReceipt"%ROWTYPE; pointer public."HuroofContentPointer"%ROWTYPE; pointer_data JSONB; predecessor_data JSONB; expected BIGINT; cats JSONB; old_ref JSONB; subj JSONB; result JSONB; target TEXT; scope TEXT;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>22 OR NOT p ?& ARRAY['profileScope','sourceId','revision','rawArtifactId','rawArtifactHash','byteLength','mediaType','serialization','provenanceHash','profileBase64','provenanceBase64','previousRevision','previousHash','previousRawArtifactId','validationReceiptId','catalogReleaseId','releaseRootHash','snapshotId','snapshotHash','snapshotProvenanceHash','subject','authority'] OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key NOT IN ('previousRevision','previousHash','previousRawArtifactId','subject','authority') AND jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR jsonb_typeof(p->'subject') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'authority') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('previousRevision','previousHash','previousRawArtifactId') AND jsonb_typeof(e.value) NOT IN ('string','null')) OR (p->>'profileScope' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'profileScope'='huroof-release-snapshot-v1') OR p->>'sourceId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'rawArtifactId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'sourceId'='eng03.custody-authority.v1' OR p->>'rawArtifactHash' !~ '^[a-f0-9]{64}$' OR p->>'provenanceHash' !~ '^[a-f0-9]{64}$' OR p->>'snapshotHash' !~ '^[a-f0-9]{64}$' OR p->>'snapshotProvenanceHash' !~ '^[a-f0-9]{64}$' OR p->>'mediaType' IS DISTINCT FROM 'application/json' OR p->>'serialization' IN ('huroof-custody-authority-policy-v1','huroof-release-snapshot-v1') OR p->>'serialization' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p->>'byteLength' !~ '^[1-9][0-9]{0,7}$' OR (p->>'byteLength')::NUMERIC>67108864 OR p->>'revision' !~ '^[1-9][0-9]{0,15}$' OR length(p->>'profileBase64')>89478488 OR length(p->>'provenanceBase64')>89478488 OR p->>'profileBase64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' OR p->>'provenanceBase64' !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 raw_bytes:=decode(p->>'profileBase64','base64'); provenance:=decode(p->>'provenanceBase64','base64'); raw_hash:=encode(int4_crypto.digest(raw_bytes,'sha256'),'hex'); prov_hash:=encode(int4_crypto.digest(provenance,'sha256'),'hex');
 IF octet_length(raw_bytes)<>(p->>'byteLength')::BIGINT OR octet_length(provenance)>67108864 OR raw_hash IS DISTINCT FROM p->>'rawArtifactHash' OR prov_hash IS DISTINCT FROM p->>'provenanceHash' OR replace(replace(encode(raw_bytes,'base64'),chr(10),''),chr(13),'') IS DISTINCT FROM p->>'profileBase64' OR replace(replace(encode(provenance,'base64'),chr(10),''),chr(13),'') IS DISTINCT FROM p->>'provenanceBase64' THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 profile:=convert_from(raw_bytes,'UTF8')::JSONB; ref:=profile->'contentSnapshot';
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref->>'namespace' IS DISTINCT FROM c->>'namespace' OR ref->>'id' IS DISTINCT FROM p->>'snapshotId' OR ref->>'hash' IS DISTINCT FROM p->>'snapshotHash' OR ref->>'provenanceHash' IS DISTINCT FROM p->>'snapshotProvenanceHash' OR ref->>'mediaType' IS DISTINCT FROM 'application/json' OR ref->>'serialization' IS DISTINCT FROM 'huroof-release-snapshot-v1' THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 scope:=p->>'profileScope'; target:='profile/'||(p->>'sourceId'); metadata:=p-'profileBase64'-'provenanceBase64';
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'releases.stage'); prior:=public.eng03_05_replay(c,m,'profile.append',target);
 IF m->'expectedRevision'='null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','profile.append','target',target,'expectedRevision',m->'expectedRevision','payload',metadata)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF; expected:=(m->>'expectedRevision')::BIGINT;
 IF p->>'revision' IS DISTINCT FROM (expected+1)::TEXT THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 PERFORM 1 FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 SELECT * INTO pointer FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope")=(c->>'namespace','profile',scope) FOR SHARE; IF pointer."scope" IS NOT NULL AND pointer."family"<>'profile' THEN RAISE EXCEPTION 'profile unavailable'; END IF; IF pointer."scope" IS NOT NULL THEN pointer_data:=public.eng03_05_prepare_profile(c,live,pointer."sourceId",pointer."revision"); IF pointer_data->>'rawArtifactHash' IS DISTINCT FROM pointer."rawArtifactHash" THEN RAISE EXCEPTION 'profile unavailable'; END IF; END IF;

 SELECT * INTO snap FROM public."HuroofRawArtifact" WHERE "namespace"=c->>'namespace' AND "id"=p->>'snapshotId' AND "contentHash"=p->>'snapshotHash' AND "provenanceHash"=p->>'snapshotProvenanceHash' AND "byteLength"::TEXT=ref->>'byteLength' AND "mediaType"=ref->>'mediaType' AND "serialization"=ref->>'serialization'; IF NOT FOUND THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 SELECT receipt.* INTO rec FROM public."CatalogValidationReceipt" receipt JOIN public."CatalogReleaseSeal" seal ON (seal."catalogReleaseId",seal."releaseRootHash",seal."sealHash")=(receipt."catalogReleaseId",receipt."releaseRootHash",receipt."sealHash") WHERE (receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash")=(p->>'validationReceiptId',p->>'catalogReleaseId',p->>'releaseRootHash') AND receipt."huroofProjectId"=c->>'projectId';
 IF NOT FOUND OR public.eng03_05_snapshot_documents_root(snap."rawBytes") IS DISTINCT FROM rec."huroofRootSha256" OR convert_from(snap."rawBytes",'UTF8')::JSON->>'releaseId' IS DISTINCT FROM rec."huroofReleaseId" THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 SELECT COALESCE(jsonb_agg(id ORDER BY id COLLATE "C"),'[]'::JSONB) INTO cats FROM (SELECT split_part(e->>'path','/',4) id FROM json_array_elements(convert_from(snap."rawBytes",'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories') x;
 IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(cats) e(id) WHERE NOT (live->'categoryScopes' ? id)) THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 IF expected=0 THEN IF p->'previousRevision'<>'null'::JSONB OR p->'previousHash'<>'null'::JSONB OR p->'previousRawArtifactId'<>'null'::JSONB THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 ELSE SELECT * INTO prev FROM public."HuroofContentRevision" WHERE ("namespace","family","sourceId","revision")=(c->>'namespace','profile',p->>'sourceId',expected);
  IF NOT FOUND OR p->>'previousRevision' IS DISTINCT FROM expected::TEXT OR p->>'previousHash' IS DISTINCT FROM prev."rawArtifactHash" OR p->>'previousRawArtifactId' IS DISTINCT FROM prev."rawArtifactId" THEN RAISE EXCEPTION 'profile unavailable'; END IF; predecessor_data:=public.eng03_05_prepare_profile(c,live,p->>'sourceId',expected); IF predecessor_data->>'rawArtifactHash' IS DISTINCT FROM prev."rawArtifactHash" THEN RAISE EXCEPTION 'profile unavailable'; END IF;
  SELECT * INTO old_raw FROM public."HuroofRawArtifact" WHERE ("namespace","id","contentHash")=(prev."namespace",prev."rawArtifactId",prev."rawArtifactHash"); IF NOT FOUND THEN RAISE EXCEPTION 'profile unavailable'; END IF; old_ref:=convert_from(old_raw."rawBytes",'UTF8')::JSONB->'contentSnapshot'; IF jsonb_typeof(old_ref) IS DISTINCT FROM 'object' OR old_ref->>'namespace' IS DISTINCT FROM c->>'namespace' OR old_ref->>'mediaType' IS DISTINCT FROM 'application/json' OR old_ref->>'serialization' IS DISTINCT FROM 'huroof-release-snapshot-v1' THEN RAISE EXCEPTION 'profile unavailable'; END IF;
  SELECT * INTO old_snap FROM public."HuroofRawArtifact" WHERE "namespace"=c->>'namespace' AND "id"=old_ref->>'id' AND "contentHash"=old_ref->>'hash' AND "provenanceHash"=old_ref->>'provenanceHash' AND "byteLength"::TEXT=old_ref->>'byteLength' AND "mediaType"='application/json' AND "serialization"='huroof-release-snapshot-v1'; IF NOT FOUND THEN RAISE EXCEPTION 'profile unavailable'; END IF; PERFORM public.eng03_05_snapshot_documents_root(old_snap."rawBytes");
  IF NOT (live->'roles' ? 'super_admin') AND EXISTS(SELECT 1 FROM json_array_elements(convert_from(old_snap."rawBytes",'UTF8')::JSON->'documents') e WHERE split_part(e->>'path','/',3)='catalogCategories' AND NOT (live->'categoryScopes' ? split_part(e->>'path','/',4))) THEN RAISE EXCEPTION 'profile unavailable'; END IF;
 END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofContentRevision" r WHERE (r."namespace",r."family",r."sourceId")=(c->>'namespace','profile',p->>'sourceId') AND r."revision">expected) OR NOT EXISTS(SELECT 1 FROM public."ActiveCatalogPointer" a WHERE a."id"='singleton' AND (a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash")=(rec."id",rec."catalogReleaseId",rec."releaseRootHash")) THEN RAISE EXCEPTION 'stale profile'; END IF;

 subj:=jsonb_build_object('kind','profile-append','namespace',c->>'namespace','projectId',c->>'projectId','identityId',c->>'identityId','identityPolicyRevision',c->>'policyRevision','identityPolicyHash',c->>'policyHash','profileScope',scope,'pointerVersion',CASE WHEN pointer."scope" IS NULL THEN NULL ELSE pointer."version"::TEXT END,'profileSourceId',p->>'sourceId','profileRevision',p->>'revision','profileRawId',p->>'rawArtifactId','profileHash',raw_hash,'snapshotId',snap."id",'snapshotHash',snap."contentHash",'snapshotProvenanceHash',snap."provenanceHash",'releaseId',rec."huroofReleaseId",'releaseRoot',rec."huroofRootSha256",'receiptId',rec."id",'catalogId',rec."catalogReleaseId",'catalogRoot',rec."releaseRootHash",'sealHash',rec."sealHash",'categories',cats);
 IF p->'subject' IS DISTINCT FROM subj THEN RAISE EXCEPTION 'stale profile subject'; END IF; PERFORM public.eng03_05_assert_evidence(subj,p->'authority');
 SELECT * INTO existing FROM public."HuroofRawArtifact" WHERE ("namespace","id")=(c->>'namespace',p->>'rawArtifactId');
 IF FOUND AND (existing."rawBytes" IS DISTINCT FROM raw_bytes OR existing."contentHash" IS DISTINCT FROM raw_hash OR existing."mediaType" IS DISTINCT FROM p->>'mediaType' OR existing."serialization" IS DISTINCT FROM p->>'serialization' OR existing."provenanceBytes" IS DISTINCT FROM provenance OR existing."provenanceHash" IS DISTINCT FROM prov_hash) THEN RAISE EXCEPTION 'immutable raw conflict'; END IF;
 result:=jsonb_build_object('operationId',m->>'operationId','revision',(expected+1)::TEXT,'status','profile_appended','subject',subj,'authority',p->'authority','descriptor',metadata);
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','profile.append',target,scope,m->>'requestHash',expected,expected+1,'profile_appended',result);
 IF existing."id" IS NULL THEN INSERT INTO public."HuroofRawArtifact"("namespace","id","contentHash","byteLength","mediaType","rawBytes","provenanceBytes","provenanceHash","serialization") VALUES(c->>'namespace',p->>'rawArtifactId',raw_hash,octet_length(raw_bytes),p->>'mediaType',raw_bytes,provenance,prov_hash,p->>'serialization'); END IF;
 INSERT INTO public."HuroofContentRevision"("namespace","family","sourceId","revision","rawArtifactId","rawArtifactHash","previousRevision","previousHash","previousRawArtifactId","validationReceiptId","catalogReleaseId","releaseRootHash","actorFirebaseIdentityId") VALUES(c->>'namespace','profile',p->>'sourceId',expected+1,p->>'rawArtifactId',raw_hash,CASE WHEN expected=0 THEN NULL ELSE expected END,CASE WHEN expected=0 THEN NULL ELSE prev."rawArtifactHash" END,CASE WHEN expected=0 THEN NULL ELSE prev."rawArtifactId" END,rec."id",rec."catalogReleaseId",rec."releaseRootHash",c->>'identityId');
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_media_append(c JSONB,m JSONB,p_object TEXT,p_generation BIGINT,p_raw TEXT,p_evidence JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; raw public."HuroofRawArtifact"%ROWTYPE; existing public."HuroofMediaRevision"%ROWTYPE; proof JSONB; base JSONB; elem JSON; q JSONB; variant JSONB; category TEXT; digest TEXT; subj JSONB; target TEXT; result JSONB; code TEXT;
BEGIN
 IF p_object !~ '^[A-Za-z0-9:_-]{1,128}$' OR p_generation<1 OR p_raw !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_evidence))<>2 OR NOT p_evidence ?& ARRAY['subject','authority'] THEN RAISE EXCEPTION 'media unavailable'; END IF;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'questions.write'); target:='media/'||p_object||'/'||p_generation::TEXT; prior:=public.eng03_05_replay(c,m,'media.append',target);
 base:=public.eng03_05_snapshot_read(c,p_evidence->'subject'->>'profileScope',p_evidence->'subject'->>'releaseId');
 SELECT * INTO raw FROM public."HuroofRawArtifact" WHERE ("namespace","id")=(c->>'namespace',p_raw) AND "serialization"='huroof-admin-media-v1' AND "mediaType" IN ('image/png','image/jpeg','video/mp4') AND "byteLength" BETWEEN 1 AND 1000000 AND octet_length("provenanceBytes")<=65536; IF NOT FOUND THEN RAISE EXCEPTION 'media unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofAdminOperation" admitted WHERE admitted."namespace"=c->>'namespace' AND admitted."action"='raw.put' AND admitted."target"=p_raw AND admitted."requestHash"=public.int5b_hash_json(jsonb_build_object('action','raw.put','target',p_raw,'expectedRevision',NULL,'payload',jsonb_build_object('hash',raw."contentHash",'length',raw."byteLength",'mediaType',raw."mediaType",'serialization',raw."serialization",'provenanceHash',raw."provenanceHash")))) THEN RAISE EXCEPTION 'media origin unavailable'; END IF;
 proof:=convert_from(raw."provenanceBytes",'UTF8')::JSONB;
 IF convert_from(raw."provenanceBytes",'UTF8') IS DISTINCT FROM public.int5b_canonical_json(proof) OR jsonb_typeof(proof) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(proof))<>9 OR NOT proof ?& ARRAY['schemaVersion','namespace','profileScope','releaseId','questionId','variant','mediaId','generation','contentHash'] OR proof->>'schemaVersion'<>'huroof-admin-media-binding-v1' OR proof->>'namespace' IS DISTINCT FROM c->>'namespace' OR proof->>'profileScope' IS DISTINCT FROM p_evidence->'subject'->>'profileScope' OR proof->>'releaseId' IS DISTINCT FROM p_evidence->'subject'->>'releaseId' OR proof->>'mediaId' IS DISTINCT FROM p_object OR proof->>'generation' IS DISTINCT FROM p_generation::TEXT OR proof->>'contentHash' IS DISTINCT FROM raw."contentHash" OR proof->>'variant' NOT IN ('question','answer') THEN RAISE EXCEPTION 'media unavailable'; END IF;

 SELECT value INTO elem FROM json_array_elements(convert_from(decode(base->>'snapshotBase64','base64'),'UTF8')::JSON->'documents') WHERE value->>'path'='releases/'||(proof->>'releaseId')||'/questions/'||(proof->>'questionId');
 q:=(elem->'data')::JSONB; IF elem IS NULL OR q->>'id' IS DISTINCT FROM proof->>'questionId' OR q->>'categoryId' !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'media unavailable'; END IF;
 category:=q->>'categoryId'; IF NOT (live->'roles' ? 'super_admin') AND NOT (live->'categoryScopes' ? category) THEN RAISE EXCEPTION 'media unavailable'; END IF;
 variant:=(CASE WHEN proof->>'variant'='question' THEN q->'media' ELSE q->'answerMedia' END);
 IF variant->>'mediaId' IS DISTINCT FROM p_object OR variant->>'assetSha256' IS DISTINCT FROM raw."contentHash" OR (variant ? 'contentType' AND variant->>'contentType' IS DISTINCT FROM raw."mediaType") OR (variant ? 'type' AND variant->>'type' IS DISTINCT FROM (CASE WHEN raw."mediaType"='video/mp4' THEN 'video' ELSE 'image' END)) THEN RAISE EXCEPTION 'media unavailable'; END IF;
 digest:=encode(int4_crypto.digest(convert_to(elem::TEXT,'UTF8'),'sha256'),'hex');
 subj:=jsonb_build_object('namespace',c->>'namespace','projectId',c->>'projectId','identityId',c->>'identityId','identityPolicyRevision',c->>'policyRevision','identityPolicyHash',c->>'policyHash','profileScope',proof->>'profileScope','pointerVersion',base->>'pointerVersion','profileSourceId',base->>'profileSourceId','profileRevision',base->>'profileRevision','profileHash',base->>'profileHash','snapshotHash',base->>'snapshotHash','releaseId',proof->>'releaseId','releaseRoot',base->>'releaseRoot','receiptId',base->>'receiptId','catalogId',base->>'catalogId','catalogRoot',base->>'catalogRoot','sealHash',base->>'sealHash','questionId',proof->>'questionId','digestKind','release-question-document-raw-sha256-v1','questionDocumentDigest',digest,'categoryId',category,'variant',proof->>'variant','mediaId',p_object,'generation',p_generation::TEXT,'assetHash',raw."contentHash",'byteLength',raw."byteLength",'mediaType',raw."mediaType",'provenanceHash',raw."provenanceHash");
 IF p_evidence->'subject' IS DISTINCT FROM subj OR m->'expectedRevision'<>'null'::JSONB OR public.int5b_hash_json(jsonb_build_object('action','media.append','target',target,'expectedRevision',NULL,'payload',jsonb_build_object('rawArtifactId',p_raw,'subject',subj,'authority',p_evidence->'authority'))) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'stale media subject'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF; PERFORM public.eng03_05_assert_evidence(subj,p_evidence->'authority');
 IF EXISTS(SELECT 1 FROM public."HuroofMediaRevision" WHERE "namespace"=c->>'namespace' AND "objectId"=p_object AND "contentHash"=raw."contentHash" AND "generation"<>p_generation) THEN RAISE EXCEPTION 'ambiguous media generation'; END IF;
 SELECT * INTO existing FROM public."HuroofMediaRevision" WHERE ("namespace","objectId","generation")=(c->>'namespace',p_object,p_generation);
 IF FOUND AND (existing."rawArtifactId" IS DISTINCT FROM p_raw OR existing."contentHash" IS DISTINCT FROM raw."contentHash" OR existing."provenanceHash" IS DISTINCT FROM raw."provenanceHash" OR existing."byteLength" IS DISTINCT FROM raw."byteLength" OR existing."mediaType" IS DISTINCT FROM raw."mediaType") THEN RAISE EXCEPTION 'immutable media conflict'; END IF;
 code:=(CASE WHEN existing."objectId" IS NULL THEN 'appended' ELSE 'already_present' END);result:=jsonb_build_object('operationId',m->>'operationId','revision',1,'status',code,'rawArtifactId',p_raw,'subject',subj,'authority',p_evidence->'authority');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','media.append',target,proof->>'profileScope',m->>'requestHash',NULL,1,code,result);
 IF existing."objectId" IS NULL THEN INSERT INTO public."HuroofMediaRevision"("namespace","objectId","generation","contentHash","mediaType","byteLength","provenanceHash","rawArtifactId") VALUES(c->>'namespace',p_object,p_generation,raw."contentHash",raw."mediaType",raw."byteLength",raw."provenanceHash",p_raw); END IF;
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
CREATE FUNCTION public.eng03_05_pointer_move(c JSONB,m JSONB,p JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE live JSONB; prior JSONB; ptr public."HuroofContentPointer"%ROWTYPE; current_data JSONB; target_data JSONB; scope TEXT; target TEXT; expected TEXT; next_version BIGINT; subj JSONB; result JSONB; evidence BYTEA;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p))<>11 OR NOT p ?& ARRAY['profileScope','expectedVersion','sourceId','revision','rawArtifactId','rawArtifactHash','validationReceiptId','catalogReleaseId','releaseRootHash','subject','authority'] OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key NOT IN ('expectedVersion','subject','authority') AND jsonb_typeof(e.value) IS DISTINCT FROM 'string') OR jsonb_typeof(p->'subject') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'authority') IS DISTINCT FROM 'object' OR (p->>'profileScope' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'profileScope'='huroof-release-snapshot-v1') OR p->>'sourceId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'revision' !~ '^[1-9][0-9]{0,18}$' OR (p->>'revision')::NUMERIC>9223372036854775807 OR p->>'rawArtifactId' !~ '^[A-Za-z0-9_-]{1,120}$' OR p->>'rawArtifactHash' !~ '^[a-f0-9]{64}$' OR (p->'expectedVersion'<>'null'::JSONB AND (jsonb_typeof(p->'expectedVersion') IS DISTINCT FROM 'string' OR p->>'expectedVersion' !~ '^(0|[1-9][0-9]{0,18})$' OR (p->>'expectedVersion')::NUMERIC>9223372036854775806)) THEN RAISE EXCEPTION 'pointer unavailable'; END IF;
 scope:=p->>'profileScope'; expected:=p->>'expectedVersion'; target:='profile/'||scope;
 PERFORM public.eng03_05_lock_namespace(c->>'namespace'); live:=public.eng03_05_assert_admin(c,'releases.stage'); prior:=public.eng03_05_replay(c,m,'profile.pointer.move',target);
 IF m->'expectedRevision' IS DISTINCT FROM p->'expectedVersion' OR public.int5b_hash_json(jsonb_build_object('action','profile.pointer.move','target',target,'expectedRevision',m->'expectedRevision','payload',p)) IS DISTINCT FROM m->>'requestHash' THEN RAISE EXCEPTION 'mutation unavailable'; END IF;
 PERFORM 1 FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'pointer unavailable'; END IF;
 SELECT * INTO ptr FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope")=(c->>'namespace','profile',scope) FOR UPDATE;
 IF ptr."scope" IS NOT NULL THEN IF ptr."family"<>'profile' THEN RAISE EXCEPTION 'pointer unavailable'; END IF; current_data:=public.eng03_05_prepare_profile(c,live,ptr."sourceId",ptr."revision"); IF current_data->>'rawArtifactHash' IS DISTINCT FROM ptr."rawArtifactHash" THEN RAISE EXCEPTION 'pointer unavailable'; END IF; END IF;
 target_data:=public.eng03_05_prepare_profile(c,live,p->>'sourceId',(p->>'revision')::BIGINT);
 IF target_data->>'rawArtifactId' IS DISTINCT FROM p->>'rawArtifactId' OR target_data->>'rawArtifactHash' IS DISTINCT FROM p->>'rawArtifactHash' OR target_data->'receipt'->>'id' IS DISTINCT FROM p->>'validationReceiptId' OR target_data->'receipt'->>'catalogId' IS DISTINCT FROM p->>'catalogReleaseId' OR target_data->'receipt'->>'catalogRoot' IS DISTINCT FROM p->>'releaseRootHash' THEN RAISE EXCEPTION 'pointer unavailable'; END IF;
 IF prior IS NOT NULL THEN RETURN prior; END IF;
 IF (ptr."scope" IS NULL AND expected IS NOT NULL) OR (ptr."scope" IS NOT NULL AND (expected IS NULL OR ptr."version"::TEXT IS DISTINCT FROM expected)) THEN RAISE EXCEPTION 'stale pointer'; END IF;
 subj:=jsonb_build_object('kind','pointer-move','namespace',c->>'namespace','projectId',c->>'projectId','identityId',c->>'identityId','identityPolicyRevision',c->>'policyRevision','identityPolicyHash',c->>'policyHash','profileScope',scope,'pointerVersion',CASE WHEN ptr."scope" IS NULL THEN NULL ELSE ptr."version"::TEXT END,'profileSourceId',target_data->>'sourceId','profileRevision',target_data->>'revision','profileRawId',target_data->>'rawArtifactId','profileHash',target_data->>'rawArtifactHash','snapshotId',target_data->'snapshot'->>'id','snapshotHash',target_data->'snapshot'->>'hash','snapshotProvenanceHash',target_data->'snapshot'->>'provenanceHash','releaseId',target_data->'receipt'->>'releaseId','releaseRoot',target_data->'receipt'->>'releaseRoot','receiptId',target_data->'receipt'->>'id','catalogId',target_data->'receipt'->>'catalogId','catalogRoot',target_data->'receipt'->>'catalogRoot','sealHash',target_data->'receipt'->>'sealHash','categories',target_data->'categories');
 IF p->'subject' IS DISTINCT FROM subj THEN RAISE EXCEPTION 'stale pointer subject'; END IF; PERFORM public.eng03_05_assert_evidence(subj,p->'authority');
 next_version:=(CASE WHEN ptr."scope" IS NULL THEN 0 ELSE ptr."version"+1 END);
 result:=jsonb_build_object('operationId',m->>'operationId','revision',next_version::TEXT,'status','moved','subject',subj,'authority',p->'authority');
 INSERT INTO public."HuroofAdminOperation"("namespace","operationId","actorIdentityId","actorAuthzVersion","actorRoles","actorProjectId","actorPolicyRevision","actorPolicyHash","action","target","scope","requestHash","expectedRevision","resultRevision","resultCode","result") VALUES(c->>'namespace',m->>'operationId',c->>'identityId',(c->>'claimAuthzVersion')::BIGINT,ARRAY(SELECT jsonb_array_elements_text(c->'claimRoles')),c->>'projectId',c->>'policyRevision',c->>'policyHash','profile.pointer.move',target,scope,m->>'requestHash',CASE WHEN expected IS NULL THEN NULL ELSE expected::BIGINT END,next_version,'moved',result);
 IF ptr."scope" IS NULL THEN INSERT INTO public."HuroofContentPointer"("namespace","kind","scope","family","sourceId","revision","rawArtifactHash","version") VALUES(c->>'namespace','profile',scope,'profile',p->>'sourceId',(p->>'revision')::BIGINT,p->>'rawArtifactHash',0);
 ELSE UPDATE public."HuroofContentPointer" SET "family"='profile',"sourceId"=p->>'sourceId',"revision"=(p->>'revision')::BIGINT,"rawArtifactHash"=p->>'rawArtifactHash',"version"=next_version,"updatedAt"=clock_timestamp() WHERE ("namespace","kind","scope","version")=(c->>'namespace','profile',scope,expected::BIGINT); IF NOT FOUND THEN RAISE EXCEPTION 'stale pointer'; END IF; END IF;
 evidence:=convert_to(public.int5b_canonical_json(jsonb_build_object('subject',subj,'authority',p->'authority','expectedVersion',p->'expectedVersion')),'UTF8');
 INSERT INTO public."HuroofContentAudit"("namespace","operationKey","actorFirebaseIdentityId","kind","scope","expectedVersion","outcome","rawEvidence","evidenceHash") VALUES(c->>'namespace',m->>'operationId',c->>'identityId','profile',scope,COALESCE(expected::BIGINT,0),CASE WHEN expected IS NULL THEN 'created' ELSE 'moved' END,evidence,encode(int4_crypto.digest(evidence,'sha256'),'hex'));
 PERFORM public.eng03_05_append_audit(c->>'namespace',m->>'operationId','mutation'); UPDATE public."HuroofAdminAuthzInvariant" SET "revision"="revision"+1 WHERE "namespace"=c->>'namespace'; RETURN result;
END $$;
REVOKE ALL ON TABLE public."HuroofAdminPrincipal" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminAuthzInvariant" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminOperation" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminIdentitySyncOutcome" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminAudit" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminRateWindow" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminQuestionDraftRevision" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminReviewRevision" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminPublishedQuestionInspection" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminCategoryCorrectionRevision" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminCategoryMetadataRevision" FROM PUBLIC;
REVOKE ALL ON TABLE public."HuroofAdminSettingsRevision" FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_lock_namespace(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_assert_admin(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_principal(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_rate_take(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_snapshot_documents_root(BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_snapshot_read(JSONB,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_media_authorize(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_replay(JSONB,JSONB,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_append_audit(TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_settings_get(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_settings_update(JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_registry_change(JSONB,JSONB,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_sync_complete(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_draft_save(JSONB,JSONB,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_draft_get(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_draft_list(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_draft_archive(JSONB,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_draft_chain_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_review_submit(JSONB,JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_review_decide(JSONB,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_review_get(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_review_list(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_category_get(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_category_update(JSONB,JSONB,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_room_get(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_room_list(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_category_list(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_audit_list(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_operation_get(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_raw_put(JSONB,JSONB,TEXT,BYTEA,TEXT,TEXT,BYTEA) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_registry_lookup(JSONB,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_correction_get(JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_correction_save(JSONB,JSONB,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_review_chain_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_metadata_chain_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_settings_chain_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_correction_chain_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_inspection_get(JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_inspection_mark(JSONB,JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_revision_append(JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_assert_evidence(JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_prepare_snapshot(JSONB,JSONB,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_prepare_profile(JSONB,JSONB,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_profile_prepare(JSONB,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_pointer_prepare(JSONB,TEXT,TEXT,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_profile_append(JSONB,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_media_append(JSONB,JSONB,TEXT,BIGINT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_05_pointer_move(JSONB,JSONB,JSONB) FROM PUBLIC;
-- Role ownership and exact executor grants are in the separate 05 role artifact.
COMMIT;
