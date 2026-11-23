-- Both this file and the role closure require one enclosing installation transaction.
-- Conditional Source candidate. No profile/admission is installed or qualified here.
-- Installation, SQL execution, native parsing, lock/resource/ACL qualification remain held.
-- Separate trusted qualifier creates profiles and reservations; worker cannot write these rows.
-- One audited physical control-storage domain covers baseline/DDL, all new object rows,
-- indices and bounded lifetime updates/WAL. It is initially absent: no unqualified writes.
-- Its qualified worst-case per write is external evidence, not an imposed record limit.
CREATE TABLE public."Pro311ControlDomain" (
 "id" TEXT PRIMARY KEY CHECK("id"='global-v1'), "physicalIdentity" TEXT NOT NULL CHECK("physicalIdentity"<>''),
 "proofIdentity" TEXT NOT NULL CHECK("proofIdentity"<>''), "sourceIdentity" TEXT NOT NULL CHECK("sourceIdentity"<>''), "indexProofIdentity" TEXT NOT NULL CHECK("indexProofIdentity"<>''), "walProofIdentity" TEXT NOT NULL CHECK("walProofIdentity"<>''), "lifecycleProofIdentity" TEXT NOT NULL CHECK("lifecycleProofIdentity"<>''), "capacityProofIdentity" TEXT NOT NULL CHECK("capacityProofIdentity"<>''),
 "capacity" NUMERIC NOT NULL CHECK("capacity">0), "baseline" NUMERIC NOT NULL CHECK("baseline">0),
 "perWriteWorstCase" NUMERIC NOT NULL CHECK("perWriteWorstCase">0), "committed" NUMERIC NOT NULL,
 CHECK("baseline">="perWriteWorstCase" AND "committed">="baseline" AND "committed"<="capacity")
);
CREATE FUNCTION public.pro311_lock_control() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- The table lock also fences bootstrap when no control row exists; no public advisory key.
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE;
 PERFORM 1 FROM public."Pro311ControlDomain" WHERE "id"='global-v1' FOR UPDATE;
END $$;
CREATE FUNCTION public.pro311_control_bootstrap(physical_id TEXT,proof_id TEXT,source_id TEXT,index_id TEXT,wal_id TEXT,lifecycle_id TEXT,capacity_id TEXT,capacity_value NUMERIC,baseline_value NUMERIC,per_write_value NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public."Pro311ControlDomain"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO existing FROM public."Pro311ControlDomain" WHERE "id"='global-v1';
 IF FOUND THEN
  IF (existing."physicalIdentity",existing."proofIdentity",existing."sourceIdentity",existing."indexProofIdentity",existing."walProofIdentity",existing."lifecycleProofIdentity",existing."capacityProofIdentity",existing."capacity",existing."baseline",existing."perWriteWorstCase") IS DISTINCT FROM (physical_id,proof_id,source_id,index_id,wal_id,lifecycle_id,capacity_id,capacity_value,baseline_value,per_write_value) THEN RAISE EXCEPTION 'RESOURCE_CONFLICT'; END IF;
  RETURN;
 END IF;
 INSERT INTO public."Pro311ControlDomain"("id","physicalIdentity","proofIdentity","sourceIdentity","indexProofIdentity","walProofIdentity","lifecycleProofIdentity","capacityProofIdentity","capacity","baseline","perWriteWorstCase","committed") VALUES('global-v1',physical_id,proof_id,source_id,index_id,wal_id,lifecycle_id,capacity_id,capacity_value,baseline_value,per_write_value,baseline_value);
END $$;
CREATE FUNCTION public.pro311_control_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW."committed" IS DISTINCT FROM NEW."baseline" THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'committed') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'committed') OR NEW."committed"<OLD."committed" THEN RAISE EXCEPTION 'control storage identity immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro311ControlDomain_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."Pro311ControlDomain" FOR EACH ROW EXECUTE FUNCTION public.pro311_control_guard();
-- Each trusted resource pool identifies a non-overlapping physical process/shared-capacity domain.
CREATE TABLE public."Pro311NativePool" ("id" TEXT PRIMARY KEY, "backendCapacity" NUMERIC NOT NULL CHECK("backendCapacity">0), "sharedCapacity" NUMERIC NOT NULL CHECK("sharedCapacity">0), "storageCapacity" NUMERIC NOT NULL CHECK("storageCapacity">0), "qualificationIdentity" TEXT NOT NULL);
CREATE TABLE public."Pro311NativeProfile" (
 "id" TEXT PRIMARY KEY, "poolId" TEXT NOT NULL REFERENCES public."Pro311NativePool"("id"), "domainIdentity" TEXT NOT NULL, "serverIdentity" TEXT NOT NULL,
 "producerIdentity" TEXT NOT NULL, "aclIdentity" TEXT NOT NULL, "driverIdentity" TEXT NOT NULL,
 "supervisorIdentity" TEXT NOT NULL, "encodingIdentity" TEXT NOT NULL, "stackIdentity" TEXT NOT NULL, "qualifiedMaxAllocation" NUMERIC NOT NULL CHECK("qualifiedMaxAllocation">0), "qualifiedStack" NUMERIC NOT NULL CHECK("qualifiedStack">0), "qualifiedElementCount" NUMERIC NOT NULL CHECK("qualifiedElementCount">0), "qualifiedPairCount" NUMERIC NOT NULL CHECK("qualifiedPairCount">0),
 "resourceProofIdentity" TEXT NOT NULL, "holderModelIdentity" TEXT NOT NULL, "metadataBackendWorstCase" NUMERIC NOT NULL CHECK("metadataBackendWorstCase">0), "metadataSharedWorstCase" NUMERIC NOT NULL CHECK("metadataSharedWorstCase">0), "inventoryBackendWorstCase" NUMERIC NOT NULL CHECK("inventoryBackendWorstCase">0), "inventorySharedWorstCase" NUMERIC NOT NULL CHECK("inventorySharedWorstCase">0), "inventoryStorageWorstCase" NUMERIC NOT NULL CHECK("inventoryStorageWorstCase">0),
 "enabled" BOOLEAN NOT NULL DEFAULT FALSE
);
ALTER TABLE public."Pro311NativePool" ADD CONSTRAINT "Pro311NativePool_proof_nonempty" CHECK("qualificationIdentity"<>'');
ALTER TABLE public."Pro311NativeProfile" ADD CONSTRAINT "Pro311NativeProfile_identity_nonempty" CHECK("domainIdentity"<>'' AND "serverIdentity"<>'' AND "producerIdentity"<>'' AND "aclIdentity"<>'' AND "driverIdentity"<>'' AND "supervisorIdentity"<>'' AND "encodingIdentity"<>'' AND "stackIdentity"<>'' AND "resourceProofIdentity"<>'' AND "holderModelIdentity"<>'');
CREATE TABLE public."Pro311NativeJob" (
 "id" TEXT PRIMARY KEY, "namespace" TEXT NOT NULL, "owner" TEXT NOT NULL, "matchId" TEXT NOT NULL,
 "resultVersion" BIGINT NOT NULL, "resultHash" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'PENDING'
 CHECK("state" IN ('PENDING','DEFERRED_RESOURCE','FAULT','COMPLETE')),
 UNIQUE("namespace","matchId","resultVersion")
);
-- Immutable audited worst-case requirements per exact job/profile; no default or fabricated envelope.
CREATE TABLE public."Pro311NativeRequirement" (
 "jobId" TEXT NOT NULL REFERENCES public."Pro311NativeJob"("id"), "profileId" TEXT NOT NULL REFERENCES public."Pro311NativeProfile"("id"), "proofIdentity" TEXT NOT NULL CHECK("proofIdentity"<>''),
 "compressedInput" NUMERIC NOT NULL CHECK("compressedInput">=0), "rawAndDetoast" NUMERIC NOT NULL CHECK("rawAndDetoast">=0), "hash" NUMERIC NOT NULL CHECK("hash">=0),
 "convertedTextAndCString" NUMERIC NOT NULL CHECK("convertedTextAndCString">=0), "lexerAndUnescape" NUMERIC NOT NULL CHECK("lexerAndUnescape">=0), "numeric" NUMERIC NOT NULL CHECK("numeric">=0),
 "jsonArraysAndRepalloc" NUMERIC NOT NULL CHECK("jsonArraysAndRepalloc">=0), "sort" NUMERIC NOT NULL CHECK("sort">=0), "parseTree" NUMERIC NOT NULL CHECK("parseTree">=0), "finalJsonb" NUMERIC NOT NULL CHECK("finalJsonb">=0),
 "nativeStack" NUMERIC NOT NULL CHECK("nativeStack">=0), "subtreeAndScalar" NUMERIC NOT NULL CHECK("subtreeAndScalar">=0), "bindingAndPublication" NUMERIC NOT NULL CHECK("bindingAndPublication">=0),
 "executorAndMetadata" NUMERIC NOT NULL CHECK("executorAndMetadata">=0), "retainedHighWater" NUMERIC NOT NULL CHECK("retainedHighWater">=0), "sharedReserve" NUMERIC NOT NULL CHECK("sharedReserve">=0),
 "storageReserve" NUMERIC NOT NULL CHECK("storageReserve">=0), "requiredMaxAllocation" NUMERIC NOT NULL CHECK("requiredMaxAllocation">=0), "qualifiedMaxAllocation" NUMERIC NOT NULL CHECK("qualifiedMaxAllocation">0), "requiredStack" NUMERIC NOT NULL CHECK("requiredStack">=0), "qualifiedStack" NUMERIC NOT NULL CHECK("qualifiedStack">0), "requiredElementCount" NUMERIC NOT NULL CHECK("requiredElementCount">=0), "qualifiedElementCount" NUMERIC NOT NULL CHECK("qualifiedElementCount">0), "requiredPairCount" NUMERIC NOT NULL CHECK("requiredPairCount">=0), "qualifiedPairCount" NUMERIC NOT NULL CHECK("qualifiedPairCount">0),
 PRIMARY KEY("jobId","profileId"), CHECK("requiredMaxAllocation"<="qualifiedMaxAllocation" AND "requiredStack"<="qualifiedStack" AND "requiredElementCount"<="qualifiedElementCount" AND "requiredPairCount"<="qualifiedPairCount")
);
CREATE TRIGGER "Pro311NativeRequirement_immutable" BEFORE UPDATE OR DELETE ON public."Pro311NativeRequirement" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TABLE public."Pro311NativeAdmission" (
 "jobId" TEXT NOT NULL REFERENCES public."Pro311NativeJob"("id"), "profileId" TEXT NOT NULL REFERENCES public."Pro311NativeProfile"("id"),
 "principal" NAME NOT NULL, "pid" INTEGER NOT NULL, "backendStart" TIMESTAMPTZ NOT NULL,
 "fence" BIGINT NOT NULL CHECK("fence">0), "policyRevision" TEXT NOT NULL, "policyHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMPTZ NOT NULL, "state" TEXT NOT NULL CHECK("state" IN ('RESERVED','CANCELLED','QUARANTINED','RELEASED')),
 "reservedBackendBytes" NUMERIC NOT NULL CHECK("reservedBackendBytes">=0), "reservedSharedBytes" NUMERIC NOT NULL CHECK("reservedSharedBytes">=0), "reservedStorageBytes" NUMERIC NOT NULL CHECK("reservedStorageBytes">=0),
 "resourceProofIdentity" TEXT NOT NULL, "supervisorIdentity" TEXT NOT NULL, PRIMARY KEY("jobId","fence")
);
CREATE TABLE public."Pro311PreflightAdmission" (
 "id" TEXT PRIMARY KEY, "operation" TEXT NOT NULL CHECK("operation" IN ('PREFLIGHT','READ','STATUS','INVENTORY_CREATE','INVENTORY_FINISH')), "boundaryId" TEXT, "namespace" TEXT, "owner" TEXT, "matchId" TEXT, "resultVersion" BIGINT,
 "profileId" TEXT NOT NULL REFERENCES public."Pro311NativeProfile"("id"), "principal" NAME NOT NULL, "pid" INTEGER NOT NULL, "backendStart" TIMESTAMPTZ NOT NULL,
 "fence" BIGINT NOT NULL CHECK("fence">0), "policyRevision" TEXT NOT NULL, "policyHash" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
 "resourceProofIdentity" TEXT NOT NULL, "supervisorIdentity" TEXT NOT NULL, "reservedBackendBytes" NUMERIC NOT NULL CHECK("reservedBackendBytes">0), "reservedSharedBytes" NUMERIC NOT NULL CHECK("reservedSharedBytes">0), "reservedStorageBytes" NUMERIC NOT NULL CHECK("reservedStorageBytes">=0),
 "state" TEXT NOT NULL CHECK("state" IN ('RESERVED','CANCELLED','QUARANTINED','RELEASED')),
 CHECK(("operation" IN ('PREFLIGHT','READ') AND "namespace" IS NOT NULL AND "owner" IS NOT NULL AND "matchId" IS NOT NULL AND "resultVersion" IS NOT NULL AND "resultVersion">0 AND "boundaryId" IS NULL) OR ("operation" IN ('STATUS','INVENTORY_CREATE','INVENTORY_FINISH') AND "boundaryId" IS NOT NULL AND "boundaryId"<>'' AND "namespace" IS NULL AND "owner" IS NULL AND "matchId" IS NULL AND "resultVersion" IS NULL))
);
CREATE UNIQUE INDEX "Pro311PreflightAdmission_session_occupied" ON public."Pro311PreflightAdmission"("principal","pid","backendStart") WHERE "state"<>'RELEASED';
CREATE UNIQUE INDEX "Pro311NativeAdmission_job_occupied" ON public."Pro311NativeAdmission"("jobId") WHERE "state"<>'RELEASED';
CREATE UNIQUE INDEX "Pro311NativeAdmission_session_occupied" ON public."Pro311NativeAdmission"("principal","pid","backendStart") WHERE "state"<>'RELEASED';
CREATE TABLE public."Pro311ResultAttestation" (
 "namespace" TEXT NOT NULL, "matchId" TEXT NOT NULL, "resultVersion" BIGINT NOT NULL, "algorithm" TEXT NOT NULL,
 "project" TEXT NOT NULL, "owner" TEXT NOT NULL, "roomId" TEXT NOT NULL, "admissionId" TEXT NOT NULL,
 "resultHash" TEXT NOT NULL, "rawId" TEXT NOT NULL, "rawLength" BIGINT NOT NULL, "mediaType" TEXT NOT NULL, "serialization" TEXT NOT NULL,
 "terminalType" TEXT NOT NULL CHECK("terminalType" IN ('FINISHED','ABANDONED')), "terminalId" TEXT NOT NULL, "terminalSequence" BIGINT NOT NULL,
 "historySequence" BIGINT NOT NULL, "occurredAt" TIMESTAMPTZ NOT NULL, "priorVersion" BIGINT, "priorHash" TEXT,
 "startPolicyRevision" BIGINT NOT NULL, "startPolicyHash" TEXT NOT NULL, "resultPolicyAvailability" TEXT NOT NULL CHECK("resultPolicyAvailability"='UNKNOWN'),
 "derivationPolicyRevision" TEXT NOT NULL, "derivationPolicyHash" TEXT NOT NULL, "derivationAuthority" TEXT NOT NULL, "profileIdentity" TEXT NOT NULL,
 "projection" JSONB NOT NULL, "bindingHash" TEXT NOT NULL, PRIMARY KEY("namespace","matchId","resultVersion","algorithm"),
 FOREIGN KEY("namespace","matchId","resultVersion","owner","resultHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash")
);
CREATE TRIGGER "Pro311ResultAttestation_immutable" BEFORE UPDATE OR DELETE ON public."Pro311ResultAttestation" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "Pro311ResultAttestation_no_truncate" BEFORE TRUNCATE ON public."Pro311ResultAttestation" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TABLE public."Pro311InventoryBoundary" ("id" TEXT PRIMARY KEY, "algorithm" TEXT NOT NULL CHECK("algorithm"='inventory-v1'), "authority" TEXT NOT NULL, "domainIdentity" TEXT NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(), "state" TEXT NOT NULL CHECK("state" IN ('OPEN','COMPLETE')));
CREATE TABLE public."Pro311InventoryMember" (
 "boundaryId" TEXT NOT NULL REFERENCES public."Pro311InventoryBoundary"("id"), "namespace" TEXT NOT NULL, "matchId" TEXT NOT NULL,
 "resultVersion" BIGINT NOT NULL, "resultHash" TEXT NOT NULL, "state" TEXT NOT NULL CHECK("state" IN ('PENDING','DEFERRED_RESOURCE','FAULT','COMPLETE')),
 PRIMARY KEY("boundaryId","namespace","matchId","resultVersion")
);
-- Admission duplicate denial precedes the global ordering lock and all conflicting waits.
CREATE FUNCTION public.pro311_reject_occupied_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" a WHERE a."jobId"=NEW."jobId" AND a."state"<>'RELEASED') THEN RAISE EXCEPTION 'RESOURCE_BUSY'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AAA_pro311_occupied" BEFORE INSERT ON public."Pro311NativeAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro311_reject_occupied_insert();
CREATE FUNCTION public.pro311_charge_control() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE domain_row public."Pro311ControlDomain"%ROWTYPE; outstanding NUMERIC; duplicate_row BOOLEAN:=FALSE;
BEGIN
 PERFORM public.pro311_lock_control();
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='Pro311NativePool' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311NativePool" WHERE "id"=NEW."id") INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311NativeProfile' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311NativeProfile" WHERE "id"=NEW."id") INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311NativeRequirement' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311NativeRequirement" WHERE ("jobId","profileId")=(NEW."jobId",NEW."profileId")) INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311NativeJob' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311NativeJob" WHERE "id"=NEW."id" OR ("namespace","matchId","resultVersion")=(NEW."namespace",NEW."matchId",NEW."resultVersion")) INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311NativeAdmission' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" WHERE ("jobId","fence")=(NEW."jobId",NEW."fence") OR ("state"<>'RELEASED' AND (("jobId"=NEW."jobId") OR ("principal","pid","backendStart")=(NEW."principal",NEW."pid",NEW."backendStart")))) INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311PreflightAdmission' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311PreflightAdmission" WHERE "id"=NEW."id" OR ("state"<>'RELEASED' AND ("principal","pid","backendStart")=(NEW."principal",NEW."pid",NEW."backendStart"))) INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311ResultAttestation' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311ResultAttestation" WHERE ("namespace","matchId","resultVersion","algorithm")=(NEW."namespace",NEW."matchId",NEW."resultVersion",NEW."algorithm")) INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311InventoryBoundary' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311InventoryBoundary" WHERE "id"=NEW."id") INTO duplicate_row;
  ELSIF TG_TABLE_NAME='Pro311InventoryMember' THEN SELECT EXISTS(SELECT 1 FROM public."Pro311InventoryMember" WHERE ("boundaryId","namespace","matchId","resultVersion")=(NEW."boundaryId",NEW."namespace",NEW."matchId",NEW."resultVersion")) INTO duplicate_row;
  ELSE RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
  IF duplicate_row THEN RAISE EXCEPTION 'RESOURCE_CONFLICT'; END IF;
 END IF;
 SELECT * INTO domain_row FROM public."Pro311ControlDomain" WHERE "id"='global-v1' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 SELECT COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0) INTO outstanding;
 IF domain_row."committed"+domain_row."perWriteWorstCase"+outstanding>domain_row."capacity" THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 UPDATE public."Pro311ControlDomain" SET "committed"="committed"+"perWriteWorstCase" WHERE "id"='global-v1';
 RETURN NEW;
END $$;
-- These triggers charge row + index + bounded lifecycle WAL before any durable write.
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311NativePool" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311NativeProfile" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311NativeRequirement" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT OR UPDATE ON public."Pro311NativeJob" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311NativeAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311PreflightAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT ON public."Pro311ResultAttestation" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT OR UPDATE ON public."Pro311InventoryBoundary" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE TRIGGER "AAB_control_charge" BEFORE INSERT OR UPDATE ON public."Pro311InventoryMember" FOR EACH ROW EXECUTE FUNCTION public.pro311_charge_control();
CREATE FUNCTION public.pro311_public_projection(p_kind TEXT,p_match TEXT,p_version BIGINT,p_at TIMESTAMPTZ,p_semantic JSONB) RETURNS JSONB
LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE scores JSONB; wins JSONB; winner JSONB; reason JSONB; ended JSONB; n JSONB;
BEGIN
 IF p_match !~ '^[A-Za-z0-9_-]{1,128}$' OR p_version<1 OR p_at IS NULL OR pg_catalog.to_char(p_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 IF p_kind='ABANDONED' THEN RETURN pg_catalog.jsonb_build_object('schemaVersion',1,'kind','ABANDONED','matchId',p_match,'resultVersion',p_version::TEXT,'occurredAt',pg_catalog.to_char(p_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')); END IF;
 IF p_kind IS DISTINCT FROM 'FINISHED' OR pg_catalog.jsonb_typeof(p_semantic) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 scores:=p_semantic->'questionScores'; wins:=p_semantic->'match'->'roundWins'; winner:=COALESCE(p_semantic->'match'->'matchWinner','null'::JSONB); reason:=COALESCE(p_semantic->'match'->'matchWinReason','null'::JSONB); ended:=p_semantic->'endedWithoutWinner';
 IF pg_catalog.jsonb_typeof(scores) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(scores) k) IS DISTINCT FROM ARRAY['horizontal','vertical'] OR pg_catalog.jsonb_typeof(wins) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(wins) k) IS DISTINCT FROM ARRAY['horizontal','vertical'] THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 FOR n IN SELECT v FROM (VALUES(scores->'horizontal'),(scores->'vertical'),(wins->'horizontal'),(wins->'vertical')) AS q(v) LOOP
  IF pg_catalog.jsonb_typeof(n) IS DISTINCT FROM 'number' OR (n::TEXT)::NUMERIC<0 OR (n::TEXT)::NUMERIC>2147483647 OR pg_catalog.trunc((n::TEXT)::NUMERIC)<>(n::TEXT)::NUMERIC THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 END LOOP;
 IF pg_catalog.jsonb_typeof(ended) IS DISTINCT FROM 'boolean' OR winner IS NULL OR reason IS NULL OR NOT ((winner='null'::JSONB AND reason='null'::JSONB) OR (pg_catalog.jsonb_typeof(winner)='string' AND winner #>> '{}' IN ('horizontal','vertical') AND pg_catalog.jsonb_typeof(reason)='string' AND reason #>> '{}' IN ('two_consecutive_round_wins','three_total_round_wins'))) THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('schemaVersion',1,'matchId',p_match,'resultVersion',p_version::TEXT,'occurredAt',pg_catalog.to_char(p_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'questionScores',scores,'roundWins',wins,'matchWinner',winner,'matchWinReason',reason,'endedWithoutWinner',ended);
EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE';
END $$;

-- This function reads only metadata. It never selects or transports rawBytes.
CREATE FUNCTION public.pro311_archive_metadata(ns TEXT, owner_id TEXT, match_id TEXT, version_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE v RECORD;
BEGIN
 SELECT r."namespace",r."matchId",r."resultVersion",r."resultHash",r."ownerFirebaseIdentityId",r."roomId",r."admissionId",r."terminalEventId",r."terminalSequence",r."rawArtifactId",r."previousVersion",r."previousHash", h."sequence" AS hs,h."occurredAt" AS at, m."id" AS mid,m."policyRevision" AS start_rev,m."policyHash" AS start_hash, e."eventType" AS terminal_type, a."id" AS aid,a."byteLength" AS len,a."mediaType" AS media,a."serialization" AS serial,pg_catalog.octet_length(a."rawBytes") AS actual_len, prior."resultHash" AS ph,n."firebaseProjectId" AS project
 INTO v FROM public."HuroofMatchResult" r
 LEFT JOIN public."HuroofOwnerHistoryEntry" h ON (h."namespace",h."ownerFirebaseIdentityId",h."matchId",h."resultVersion",h."resultHash")=(r."namespace",r."ownerFirebaseIdentityId",r."matchId",r."resultVersion",r."resultHash")
 LEFT JOIN public."HuroofMatch" m ON (m."namespace",m."id",m."roomId",m."ownerFirebaseIdentityId",m."admissionId")=(r."namespace",r."matchId",r."roomId",r."ownerFirebaseIdentityId",r."admissionId")
 LEFT JOIN public."HuroofEvent" e ON (e."namespace",e."roomId",e."sequence",e."id",e."matchId")=(r."namespace",r."roomId",r."terminalSequence",r."terminalEventId",r."matchId")
 LEFT JOIN public."HuroofRawArtifact" a ON (a."namespace",a."id",a."contentHash")=(r."namespace",r."rawArtifactId",r."resultHash")
 LEFT JOIN public."HuroofMatchResult" prior ON (prior."namespace",prior."matchId",prior."ownerFirebaseIdentityId",prior."resultVersion",prior."resultHash")=(r."namespace",r."matchId",r."ownerFirebaseIdentityId",r."previousVersion",r."previousHash")
 LEFT JOIN public."DeploymentNamespace" n ON n."namespaceId"=r."namespace" LEFT JOIN public."FirebaseIdentity" fi ON fi."id"=r."ownerFirebaseIdentityId" AND fi."firebaseProjectId"=n."firebaseProjectId"
 WHERE (r."namespace",r."ownerFirebaseIdentityId",r."matchId",r."resultVersion")=(ns,owner_id,match_id,version_id) AND fi."id" IS NOT NULL;
 IF NOT FOUND OR v.hs IS NULL OR v.mid IS NULL OR v.aid IS NULL OR v.project IS NULL OR v.terminal_type NOT IN ('FINISHED','ABANDONED') OR v.terminal_type IS NULL OR v.len IS DISTINCT FROM v.actual_len OR v.media IS DISTINCT FROM 'application/json' OR v.serial IS DISTINCT FROM 'huroof-command-result-v1' OR (version_id=1 AND (v."previousVersion" IS NOT NULL OR v."previousHash" IS NOT NULL)) OR (version_id>1 AND (v."previousVersion" IS DISTINCT FROM version_id-1 OR v.ph IS DISTINCT FROM v."previousHash" OR v.ph IS NULL)) THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('namespace',v."namespace",'matchId',v."matchId",'resultVersion',v."resultVersion",'resultHash',v."resultHash",'owner',v."ownerFirebaseIdentityId",'room',v."roomId",'admission',v."admissionId",'terminalType',v.terminal_type,'terminalId',v."terminalEventId",'terminalSequence',v."terminalSequence",'rawId',v."rawArtifactId",'rawLength',v.len,'media',v.media,'serialization',v.serial,'previousVersion',v."previousVersion",'previousHash',v."previousHash",'historySequence',v.hs,'occurredAt',pg_catalog.to_char(v.at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startPolicyRevision',v.start_rev,'startPolicyHash',v.start_hash,'project',v.project);
END $$;
-- Narrow activity reader owned by a non-login stats role; no arbitrary activity data is returned.
CREATE FUNCTION public.pro311_own_backend_start() RETURNS TIMESTAMPTZ
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT a.backend_start FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid() AND a.usename=SESSION_USER
$$;
CREATE FUNCTION public.pro311_backend_is_live(p_principal NAME,p_pid INTEGER,p_started TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a WHERE a.pid=p_pid AND a.backend_start=p_started AND a.usename=p_principal)
$$;
CREATE FUNCTION public.pro311_archive_preflight(ns TEXT, owner_id TEXT, policy_rev TEXT, policy_hash TEXT, match_id TEXT, version_id BIGINT, admission_id TEXT, fence_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m JSONB; job_id TEXT; existing public."Pro311NativeJob"%ROWTYPE; pre public."Pro311PreflightAdmission"%ROWTYPE; profile public."Pro311NativeProfile"%ROWTYPE; started TIMESTAMPTZ;
BEGIN
 PERFORM public.pro311_lock_control();
 started:=public.pro311_own_backend_start();
 SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId";
 IF started IS NULL OR pre."operation" IS DISTINCT FROM 'PREFLIGHT' OR pre."state" IS DISTINCT FROM 'RESERVED' OR pre."principal" IS DISTINCT FROM SESSION_USER OR pre."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR pre."backendStart" IS DISTINCT FROM started OR (pre."namespace",pre."owner",pre."matchId",pre."resultVersion",pre."policyRevision",pre."policyHash") IS DISTINCT FROM (ns,owner_id,match_id,version_id,policy_rev,policy_hash) OR pre."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE OR profile."resourceProofIdentity" IS DISTINCT FROM pre."resourceProofIdentity" OR profile."supervisorIdentity" IS DISTINCT FROM pre."supervisorIdentity" OR profile."serverVersion" IS DISTINCT FROM pg_catalog.current_setting('server_version') OR profile."serverEncoding" IS DISTINCT FROM pg_catalog.current_setting('server_encoding') OR profile."stackSetting" IS DISTINCT FROM pg_catalog.current_setting('max_stack_depth') THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 PERFORM public.eng03_03_assert_current(ns,owner_id,policy_rev,policy_hash);
 m:=public.pro311_archive_metadata(ns,owner_id,match_id,version_id);
 SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id FOR UPDATE;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId" FOR SHARE NOWAIT;
 IF pre."state" IS DISTINCT FROM 'RESERVED' OR pre."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 job_id:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('maydan.pro311.job.v1',ns,match_id,version_id::TEXT)::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO existing FROM public."Pro311NativeJob" WHERE "id"=job_id;
 IF NOT FOUND THEN
  INSERT INTO public."Pro311NativeJob"("id","namespace","owner","matchId","resultVersion","resultHash") VALUES(job_id,ns,owner_id,match_id,version_id,m->>'resultHash');
  SELECT * INTO existing FROM public."Pro311NativeJob" WHERE "id"=job_id;
 END IF;
 IF NOT FOUND OR (existing."namespace",existing."owner",existing."matchId",existing."resultVersion",existing."resultHash") IS DISTINCT FROM (ns,owner_id,match_id,version_id,m->>'resultHash') THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('job',job_id,'bytes',m->>'rawLength','resultHash',m->>'resultHash');
END $$;
CREATE FUNCTION public.pro311_archive_status(job_id TEXT, admission_id TEXT, fence_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state TEXT;
BEGIN PERFORM public.pro311_lock_control(); PERFORM public.pro311_inventory_authorize(job_id,admission_id,fence_id,'STATUS',FALSE); SELECT j."state" INTO state FROM public."Pro311NativeJob" j WHERE j."id"=job_id; IF state IS NULL THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF; PERFORM public.pro311_inventory_authorize(job_id,admission_id,fence_id,'STATUS',TRUE); RETURN state; END $$;

-- Internal only: caller must be the validated producer or admitted derivation, never a worker DTO.
CREATE FUNCTION public.pro311_publish_semantic(m JSONB, semantic JSONB, policy_rev TEXT, policy_hash TEXT, authority TEXT, profile_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE projection JSONB; bind JSONB; digest TEXT; old public."Pro311ResultAttestation"%ROWTYPE;
BEGIN
 PERFORM public.pro311_lock_control();
 projection:=public.pro311_public_projection(m->>'terminalType',m->>'matchId',(m->>'resultVersion')::BIGINT,(m->>'occurredAt')::TIMESTAMPTZ,semantic);
 bind:=pg_catalog.jsonb_build_array('maydan.pro311.attestation.v1',m,'UNKNOWN',policy_rev,policy_hash,authority,profile_id,projection);
 digest:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(bind::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO old FROM public."Pro311ResultAttestation" WHERE ("namespace","matchId","resultVersion","algorithm")=(m->>'namespace',m->>'matchId',(m->>'resultVersion')::BIGINT,'native-v1');
 IF FOUND THEN
  IF old."bindingHash" IS DISTINCT FROM digest OR old."projection" IS DISTINCT FROM projection THEN RAISE EXCEPTION 'RESULT_CONFLICT'; END IF;
  RETURN digest;
 END IF;
 INSERT INTO public."Pro311ResultAttestation"("namespace","matchId","resultVersion","algorithm","project","owner","roomId","admissionId","resultHash","rawId","rawLength","mediaType","serialization","terminalType","terminalId","terminalSequence","historySequence","occurredAt","priorVersion","priorHash","startPolicyRevision","startPolicyHash","resultPolicyAvailability","derivationPolicyRevision","derivationPolicyHash","derivationAuthority","profileIdentity","projection","bindingHash")
 VALUES(m->>'namespace',m->>'matchId',(m->>'resultVersion')::BIGINT,'native-v1',m->>'project',m->>'owner',m->>'room',m->>'admission',m->>'resultHash',m->>'rawId',(m->>'rawLength')::BIGINT,m->>'media',m->>'serialization',m->>'terminalType',m->>'terminalId',(m->>'terminalSequence')::BIGINT,(m->>'historySequence')::BIGINT,(m->>'occurredAt')::TIMESTAMPTZ,(m->>'previousVersion')::BIGINT,m->>'previousHash',(m->>'startPolicyRevision')::BIGINT,m->>'startPolicyHash','UNKNOWN',policy_rev,policy_hash,authority,profile_id,projection,digest);
 SELECT * INTO old FROM public."Pro311ResultAttestation" WHERE ("namespace","matchId","resultVersion","algorithm")=(m->>'namespace',m->>'matchId',(m->>'resultVersion')::BIGINT,'native-v1');
 IF NOT FOUND OR old."bindingHash" IS DISTINCT FROM digest OR old."projection" IS DISTINCT FROM projection THEN RAISE EXCEPTION 'RESULT_CONFLICT'; END IF;
 RETURN digest;
EXCEPTION WHEN query_canceled OR OTHERS THEN IF SQLERRM='RESULT_CONFLICT' THEN RAISE EXCEPTION 'RESULT_CONFLICT'; ELSE RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
END $$;
ALTER TABLE public."Pro311NativeProfile" ADD COLUMN "backendCapacity" NUMERIC NOT NULL CHECK("backendCapacity">0), ADD COLUMN "sharedCapacity" NUMERIC NOT NULL CHECK("sharedCapacity">0), ADD COLUMN "serverVersion" TEXT NOT NULL, ADD COLUMN "serverEncoding" TEXT NOT NULL, ADD COLUMN "stackSetting" TEXT NOT NULL;
-- Resource quantities are exact finite integral units; no numeric capacity is installed.
ALTER TABLE public."Pro311ControlDomain" ADD CONSTRAINT "Pro311ControlDomain_finite_integer_resources" CHECK(("capacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "capacity"=pg_catalog.trunc("capacity")) AND ("baseline"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "baseline"=pg_catalog.trunc("baseline")) AND ("perWriteWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "perWriteWorstCase"=pg_catalog.trunc("perWriteWorstCase")) AND ("committed"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "committed"=pg_catalog.trunc("committed")));
ALTER TABLE public."Pro311NativePool" ADD CONSTRAINT "Pro311NativePool_finite_integer_resources" CHECK(("backendCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "backendCapacity"=pg_catalog.trunc("backendCapacity")) AND ("sharedCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "sharedCapacity"=pg_catalog.trunc("sharedCapacity")) AND ("storageCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "storageCapacity"=pg_catalog.trunc("storageCapacity")));
ALTER TABLE public."Pro311NativeProfile" ADD CONSTRAINT "Pro311NativeProfile_finite_integer_resources" CHECK(("qualifiedMaxAllocation"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedMaxAllocation"=pg_catalog.trunc("qualifiedMaxAllocation")) AND ("qualifiedStack"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedStack"=pg_catalog.trunc("qualifiedStack")) AND ("qualifiedElementCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedElementCount"=pg_catalog.trunc("qualifiedElementCount")) AND ("qualifiedPairCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedPairCount"=pg_catalog.trunc("qualifiedPairCount")) AND ("metadataBackendWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "metadataBackendWorstCase"=pg_catalog.trunc("metadataBackendWorstCase")) AND ("metadataSharedWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "metadataSharedWorstCase"=pg_catalog.trunc("metadataSharedWorstCase")) AND ("inventoryBackendWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "inventoryBackendWorstCase"=pg_catalog.trunc("inventoryBackendWorstCase")) AND ("inventorySharedWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "inventorySharedWorstCase"=pg_catalog.trunc("inventorySharedWorstCase")) AND ("inventoryStorageWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "inventoryStorageWorstCase"=pg_catalog.trunc("inventoryStorageWorstCase")) AND ("backendCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "backendCapacity"=pg_catalog.trunc("backendCapacity")) AND ("sharedCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "sharedCapacity"=pg_catalog.trunc("sharedCapacity")));
ALTER TABLE public."Pro311NativeRequirement" ADD CONSTRAINT "Pro311NativeRequirement_finite_integer_resources" CHECK(("compressedInput"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "compressedInput"=pg_catalog.trunc("compressedInput")) AND ("rawAndDetoast"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "rawAndDetoast"=pg_catalog.trunc("rawAndDetoast")) AND ("hash"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "hash"=pg_catalog.trunc("hash")) AND ("convertedTextAndCString"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "convertedTextAndCString"=pg_catalog.trunc("convertedTextAndCString")) AND ("lexerAndUnescape"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "lexerAndUnescape"=pg_catalog.trunc("lexerAndUnescape")) AND ("numeric"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "numeric"=pg_catalog.trunc("numeric")) AND ("jsonArraysAndRepalloc"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "jsonArraysAndRepalloc"=pg_catalog.trunc("jsonArraysAndRepalloc")) AND ("sort"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "sort"=pg_catalog.trunc("sort")) AND ("parseTree"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "parseTree"=pg_catalog.trunc("parseTree")) AND ("finalJsonb"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "finalJsonb"=pg_catalog.trunc("finalJsonb")) AND ("nativeStack"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "nativeStack"=pg_catalog.trunc("nativeStack")) AND ("subtreeAndScalar"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "subtreeAndScalar"=pg_catalog.trunc("subtreeAndScalar")) AND ("bindingAndPublication"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "bindingAndPublication"=pg_catalog.trunc("bindingAndPublication")) AND ("executorAndMetadata"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "executorAndMetadata"=pg_catalog.trunc("executorAndMetadata")) AND ("retainedHighWater"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "retainedHighWater"=pg_catalog.trunc("retainedHighWater")) AND ("sharedReserve"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "sharedReserve"=pg_catalog.trunc("sharedReserve")) AND ("storageReserve"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "storageReserve"=pg_catalog.trunc("storageReserve")) AND ("requiredMaxAllocation"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "requiredMaxAllocation"=pg_catalog.trunc("requiredMaxAllocation")) AND ("qualifiedMaxAllocation"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedMaxAllocation"=pg_catalog.trunc("qualifiedMaxAllocation")) AND ("requiredStack"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "requiredStack"=pg_catalog.trunc("requiredStack")) AND ("qualifiedStack"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedStack"=pg_catalog.trunc("qualifiedStack")) AND ("requiredElementCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "requiredElementCount"=pg_catalog.trunc("requiredElementCount")) AND ("qualifiedElementCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedElementCount"=pg_catalog.trunc("qualifiedElementCount")) AND ("requiredPairCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "requiredPairCount"=pg_catalog.trunc("requiredPairCount")) AND ("qualifiedPairCount"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "qualifiedPairCount"=pg_catalog.trunc("qualifiedPairCount")));
ALTER TABLE public."Pro311NativeAdmission" ADD CONSTRAINT "Pro311NativeAdmission_finite_integer_resources" CHECK(("reservedBackendBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedBackendBytes"=pg_catalog.trunc("reservedBackendBytes")) AND ("reservedSharedBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedSharedBytes"=pg_catalog.trunc("reservedSharedBytes")) AND ("reservedStorageBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedStorageBytes"=pg_catalog.trunc("reservedStorageBytes")));
ALTER TABLE public."Pro311PreflightAdmission" ADD CONSTRAINT "Pro311PreflightAdmission_finite_integer_resources" CHECK(("reservedBackendBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedBackendBytes"=pg_catalog.trunc("reservedBackendBytes")) AND ("reservedSharedBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedSharedBytes"=pg_catalog.trunc("reservedSharedBytes")) AND ("reservedStorageBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity') AND "reservedStorageBytes"=pg_catalog.trunc("reservedStorageBytes")));
CREATE FUNCTION public.pro311_preflight_admission_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public."Pro311NativeProfile"%ROWTYPE; pool public."Pro311NativePool"%ROWTYPE; backend_used NUMERIC; shared_used NUMERIC; storage_used NUMERIC; other_backend NUMERIC; other_shared NUMERIC; other_storage NUMERIC;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reservation history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (pg_catalog.to_jsonb(NEW)-'state') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'reservation binding immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW."state"=OLD."state" THEN RAISE EXCEPTION 'no-op reservation update'; END IF;
 IF TG_OP='UPDATE' AND NOT ((OLD."state"='RESERVED' AND NEW."state" IN ('RESERVED','CANCELLED','QUARANTINED','RELEASED')) OR (OLD."state" IN ('CANCELLED','QUARANTINED') AND NEW."state" IN (OLD."state",'RELEASED'))) THEN RAISE EXCEPTION 'invalid reservation transition'; END IF;
 SELECT * INTO p FROM public."Pro311NativeProfile" WHERE "id"=NEW."profileId" FOR UPDATE NOWAIT;
 IF NOT FOUND OR (NEW."state"='RESERVED' AND NOT p."enabled") OR NEW."resourceProofIdentity" IS DISTINCT FROM p."resourceProofIdentity" OR NEW."supervisorIdentity" IS DISTINCT FROM p."supervisorIdentity" OR (NEW."operation" IN ('PREFLIGHT','READ') AND (NEW."reservedBackendBytes"<p."metadataBackendWorstCase" OR NEW."reservedSharedBytes"<p."metadataSharedWorstCase")) OR (NEW."operation" IN ('STATUS','INVENTORY_CREATE','INVENTORY_FINISH') AND (NEW."reservedBackendBytes"<p."inventoryBackendWorstCase" OR NEW."reservedSharedBytes"<p."inventorySharedWorstCase" OR NEW."reservedStorageBytes"<p."inventoryStorageWorstCase")) THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 IF NEW."state"='RELEASED' AND (TG_OP='INSERT' OR public.pro311_backend_is_live(NEW."principal",NEW."pid",NEW."backendStart")) THEN RAISE EXCEPTION 'RESOURCE_STILL_OCCUPIED'; END IF;
 IF TG_OP='INSERT' AND (NEW."state"<>'RESERVED' OR NEW."expiresAt"<=pg_catalog.clock_timestamp() OR NOT public.pro311_backend_is_live(NEW."principal",NEW."pid",NEW."backendStart") OR EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" a WHERE (a."principal",a."pid",a."backendStart")=(NEW."principal",NEW."pid",NEW."backendStart") AND a."state"<>'RELEASED')) THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public."Pro311ControlDomain" d WHERE d."id"='global-v1' AND d."committed"+NEW."reservedStorageBytes"+COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)<=d."capacity") THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 SELECT * INTO pool FROM public."Pro311NativePool" WHERE "id"=p."poolId" FOR UPDATE NOWAIT;
 SELECT COALESCE(sum(a."reservedBackendBytes"),0),COALESCE(sum(a."reservedSharedBytes"),0),COALESCE(sum(a."reservedStorageBytes"),0) INTO backend_used,shared_used,storage_used FROM public."Pro311NativeAdmission" a JOIN public."Pro311NativeProfile" ap ON ap."id"=a."profileId" WHERE ap."poolId"=p."poolId" AND a."state"<>'RELEASED';
 SELECT COALESCE(sum(a."reservedBackendBytes"),0),COALESCE(sum(a."reservedSharedBytes"),0),COALESCE(sum(a."reservedStorageBytes"),0) INTO other_backend,other_shared,other_storage FROM public."Pro311PreflightAdmission" a JOIN public."Pro311NativeProfile" ap ON ap."id"=a."profileId" WHERE ap."poolId"=p."poolId" AND a."state"<>'RELEASED' AND a."id"<>NEW."id";
 IF NEW."state"<>'RELEASED' AND (backend_used+other_backend+NEW."reservedBackendBytes">pool."backendCapacity" OR shared_used+other_shared+NEW."reservedSharedBytes">pool."sharedCapacity" OR storage_used+other_storage+NEW."reservedStorageBytes">pool."storageCapacity" OR NEW."reservedBackendBytes">p."backendCapacity" OR NEW."reservedSharedBytes">p."sharedCapacity") THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro311PreflightAdmission_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."Pro311PreflightAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro311_preflight_admission_guard();
CREATE FUNCTION public.pro311_admission_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public."Pro311NativeProfile"%ROWTYPE; pool public."Pro311NativePool"%ROWTYPE; req public."Pro311NativeRequirement"%ROWTYPE; backend_used NUMERIC; shared_used NUMERIC; storage_used NUMERIC; other_backend NUMERIC; other_shared NUMERIC; other_storage NUMERIC;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reservation history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW."jobId",NEW."profileId",NEW."principal",NEW."pid",NEW."backendStart",NEW."fence",NEW."expiresAt",NEW."policyRevision",NEW."policyHash",NEW."reservedBackendBytes",NEW."reservedSharedBytes",NEW."reservedStorageBytes",NEW."resourceProofIdentity",NEW."supervisorIdentity") IS DISTINCT FROM (OLD."jobId",OLD."profileId",OLD."principal",OLD."pid",OLD."backendStart",OLD."fence",OLD."expiresAt",OLD."policyRevision",OLD."policyHash",OLD."reservedBackendBytes",OLD."reservedSharedBytes",OLD."reservedStorageBytes",OLD."resourceProofIdentity",OLD."supervisorIdentity") THEN RAISE EXCEPTION 'reservation binding is immutable'; END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM public."Pro311PreflightAdmission" a WHERE (a."principal",a."pid",a."backendStart")=(NEW."principal",NEW."pid",NEW."backendStart") AND a."state"<>'RELEASED') THEN RAISE EXCEPTION 'RESOURCE_BUSY'; END IF;
  IF EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" a WHERE a."jobId"=NEW."jobId" AND a."state"<>'RELEASED') THEN RAISE EXCEPTION 'RESOURCE_BUSY'; END IF;
  PERFORM 1 FROM public."Pro311NativeJob" WHERE "id"=NEW."jobId" FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" a WHERE a."jobId"=NEW."jobId" AND a."state"<>'RELEASED') OR EXISTS(SELECT 1 FROM public."Pro311NativeAdmission" a WHERE a."jobId"=NEW."jobId" AND a."fence">=NEW."fence") THEN RAISE EXCEPTION 'RESOURCE_BUSY'; END IF;
 END IF;
 SELECT * INTO p FROM public."Pro311NativeProfile" WHERE "id"=NEW."profileId" FOR UPDATE NOWAIT;
 IF NOT FOUND OR (NEW."state"='RESERVED' AND NOT p."enabled") OR NEW."resourceProofIdentity" IS DISTINCT FROM p."resourceProofIdentity" OR NEW."supervisorIdentity" IS DISTINCT FROM p."supervisorIdentity" OR NEW."reservedBackendBytes"<=0 OR NEW."reservedSharedBytes"<=0 THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 IF TG_OP='UPDATE' AND NEW."state"=OLD."state" THEN RAISE EXCEPTION 'no-op reservation update'; END IF;
 IF TG_OP='UPDATE' AND NOT ((OLD."state"='RESERVED' AND NEW."state" IN ('RESERVED','CANCELLED','QUARANTINED','RELEASED')) OR (OLD."state" IN ('CANCELLED','QUARANTINED') AND NEW."state" IN (OLD."state",'RELEASED'))) THEN RAISE EXCEPTION 'invalid reservation transition'; END IF;
 IF NEW."state"='RELEASED' AND (TG_OP='INSERT' OR public.pro311_backend_is_live(NEW."principal",NEW."pid",NEW."backendStart")) THEN RAISE EXCEPTION 'RESOURCE_STILL_OCCUPIED'; END IF;
 IF TG_OP='INSERT' AND (NEW."state"<>'RESERVED' OR NEW."expiresAt"<=pg_catalog.clock_timestamp() OR NOT public.pro311_backend_is_live(NEW."principal",NEW."pid",NEW."backendStart")) THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 SELECT * INTO req FROM public."Pro311NativeRequirement" WHERE ("jobId","profileId")=(NEW."jobId",NEW."profileId");
 IF NOT FOUND OR req."proofIdentity" IS DISTINCT FROM NEW."resourceProofIdentity" OR (req."qualifiedMaxAllocation",req."qualifiedStack",req."qualifiedElementCount",req."qualifiedPairCount") IS DISTINCT FROM (p."qualifiedMaxAllocation",p."qualifiedStack",p."qualifiedElementCount",p."qualifiedPairCount") OR NEW."reservedBackendBytes" < req."compressedInput"+req."rawAndDetoast"+req."hash"+req."convertedTextAndCString"+req."lexerAndUnescape"+req."numeric"+req."jsonArraysAndRepalloc"+req."sort"+req."parseTree"+req."finalJsonb"+req."nativeStack"+req."subtreeAndScalar"+req."bindingAndPublication"+req."executorAndMetadata"+req."retainedHighWater" OR NEW."reservedSharedBytes" < req."sharedReserve" OR NEW."reservedStorageBytes" < req."storageReserve" THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public."Pro311ControlDomain" d WHERE d."id"='global-v1' AND d."committed"+NEW."reservedStorageBytes"+COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT sum("reservedStorageBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)<=d."capacity") THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 SELECT * INTO pool FROM public."Pro311NativePool" WHERE "id"=p."poolId" FOR UPDATE NOWAIT;
 SELECT COALESCE(sum(a."reservedBackendBytes"),0),COALESCE(sum(a."reservedSharedBytes"),0),COALESCE(sum(a."reservedStorageBytes"),0) INTO backend_used,shared_used,storage_used FROM public."Pro311NativeAdmission" a JOIN public."Pro311NativeProfile" ap ON ap."id"=a."profileId" WHERE ap."poolId"=p."poolId" AND a."state"<>'RELEASED' AND a."jobId"<>NEW."jobId";
 SELECT COALESCE(sum(a."reservedBackendBytes"),0),COALESCE(sum(a."reservedSharedBytes"),0),COALESCE(sum(a."reservedStorageBytes"),0) INTO other_backend,other_shared,other_storage FROM public."Pro311PreflightAdmission" a JOIN public."Pro311NativeProfile" ap ON ap."id"=a."profileId" WHERE ap."poolId"=p."poolId" AND a."state"<>'RELEASED';
 IF NEW."state"<>'RELEASED' AND (backend_used+other_backend+NEW."reservedBackendBytes">pool."backendCapacity" OR shared_used+other_shared+NEW."reservedSharedBytes">pool."sharedCapacity" OR storage_used+other_storage+NEW."reservedStorageBytes">pool."storageCapacity" OR NEW."reservedBackendBytes">p."backendCapacity" OR NEW."reservedSharedBytes">p."sharedCapacity") THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro311NativeAdmission_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."Pro311NativeAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro311_admission_guard();
-- Cancellers receive these narrow entrypoints, never direct UPDATE. Every target
-- is locked NOWAIT before UPDATE, including when several calls share a transaction.
CREATE FUNCTION public.pro311_cancel_profile(profile_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active BOOLEAN;
BEGIN
 SELECT "enabled" INTO active FROM public."Pro311NativeProfile" WHERE "id"=profile_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 IF active THEN UPDATE public."Pro311NativeProfile" SET "enabled"=FALSE WHERE "id"=profile_id; END IF;
END $$;
CREATE FUNCTION public.pro311_cancel_native_admission(job_id TEXT, fence_id BIGINT, requested_state TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_state TEXT;
BEGIN
 IF requested_state IS NULL OR requested_state NOT IN ('CANCELLED','QUARANTINED','RELEASED') THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 SELECT "state" INTO old_state FROM public."Pro311NativeAdmission" WHERE "jobId"=job_id AND "fence"=fence_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 IF old_state IS DISTINCT FROM requested_state THEN UPDATE public."Pro311NativeAdmission" SET "state"=requested_state WHERE "jobId"=job_id AND "fence"=fence_id; END IF;
END $$;
CREATE FUNCTION public.pro311_cancel_preflight_admission(admission_id TEXT, fence_id BIGINT, requested_state TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_state TEXT;
BEGIN
 IF requested_state IS NULL OR requested_state NOT IN ('CANCELLED','QUARANTINED','RELEASED') THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 SELECT "state" INTO old_state FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"=fence_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_UNAVAILABLE'; END IF;
 IF old_state IS DISTINCT FROM requested_state THEN UPDATE public."Pro311PreflightAdmission" SET "state"=requested_state WHERE "id"=admission_id AND "fence"=fence_id; END IF;
END $$;
CREATE FUNCTION public.pro311_archive_existing(m JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro311ResultAttestation"%ROWTYPE; expected TEXT;
BEGIN
 SELECT * INTO a FROM public."Pro311ResultAttestation" WHERE ("namespace","matchId","resultVersion","algorithm")=(m->>'namespace',m->>'matchId',(m->>'resultVersion')::BIGINT,'native-v1');
 IF NOT FOUND THEN RETURN NULL; END IF;
 expected:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('maydan.pro311.attestation.v1',m,'UNKNOWN',a."derivationPolicyRevision",a."derivationPolicyHash",a."derivationAuthority",a."profileIdentity",a."projection")::TEXT,'UTF8'),'sha256'),'hex');
 IF a."bindingHash" IS DISTINCT FROM expected OR (a."project",a."owner",a."roomId",a."admissionId",a."resultHash",a."rawId",a."rawLength",a."mediaType",a."serialization",a."terminalType",a."terminalId",a."terminalSequence",a."historySequence",a."occurredAt",a."priorVersion",a."priorHash",a."startPolicyRevision",a."startPolicyHash",a."resultPolicyAvailability") IS DISTINCT FROM (m->>'project',m->>'owner',m->>'room',m->>'admission',m->>'resultHash',m->>'rawId',(m->>'rawLength')::BIGINT,m->>'media',m->>'serialization',m->>'terminalType',m->>'terminalId',(m->>'terminalSequence')::BIGINT,(m->>'historySequence')::BIGINT,(m->>'occurredAt')::TIMESTAMPTZ,(m->>'previousVersion')::BIGINT,m->>'previousHash',(m->>'startPolicyRevision')::BIGINT,m->>'startPolicyHash','UNKNOWN') THEN RAISE EXCEPTION 'RESULT_CONFLICT'; END IF;
 RETURN expected;
END $$;
CREATE FUNCTION public.pro311_archive_derive(ns TEXT, owner_id TEXT, policy_rev TEXT, policy_hash TEXT, match_id TEXT, version_id BIGINT, job_id TEXT, fence_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m JSONB; admission public."Pro311NativeAdmission"%ROWTYPE; profile public."Pro311NativeProfile"%ROWTYPE; job public."Pro311NativeJob"%ROWTYPE; started TIMESTAMPTZ; raw BYTEA; semantic JSONB; digest TEXT;
BEGIN
 PERFORM public.pro311_lock_control();
 IF pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 started:=public.pro311_own_backend_start();
 SELECT * INTO job FROM public."Pro311NativeJob" WHERE "id"=job_id FOR UPDATE;
 SELECT * INTO admission FROM public."Pro311NativeAdmission" WHERE "jobId"=job_id AND "fence"::TEXT=fence_id;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=admission."profileId";
 IF started IS NULL OR job."id" IS NULL OR (job."namespace",job."owner",job."matchId",job."resultVersion") IS DISTINCT FROM (ns,owner_id,match_id,version_id) OR admission."state" IS DISTINCT FROM 'RESERVED' OR admission."principal" IS DISTINCT FROM SESSION_USER OR admission."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR admission."backendStart" IS DISTINCT FROM started OR admission."policyRevision" IS DISTINCT FROM policy_rev OR admission."policyHash" IS DISTINCT FROM policy_hash OR admission."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE OR profile."resourceProofIdentity" IS DISTINCT FROM admission."resourceProofIdentity" OR profile."supervisorIdentity" IS DISTINCT FROM admission."supervisorIdentity" OR profile."serverVersion" IS DISTINCT FROM pg_catalog.current_setting('server_version') OR profile."serverEncoding" IS DISTINCT FROM pg_catalog.current_setting('server_encoding') OR profile."stackSetting" IS DISTINCT FROM pg_catalog.current_setting('max_stack_depth') THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 PERFORM public.eng03_03_assert_current(ns,owner_id,policy_rev,policy_hash); -- lock held through publication
 m:=public.pro311_archive_metadata(ns,owner_id,match_id,version_id);
 IF job."resultHash" IS DISTINCT FROM m->>'resultHash' THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 digest:=public.pro311_archive_existing(m);
 IF digest IS NOT NULL THEN
  SELECT * INTO admission FROM public."Pro311NativeAdmission" WHERE "jobId"=job_id AND "fence"::TEXT=fence_id FOR UPDATE;
  SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=admission."profileId" FOR SHARE NOWAIT;
  IF admission."state" IS DISTINCT FROM 'RESERVED' OR admission."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
  UPDATE public."Pro311NativeJob" SET "state"='COMPLETE' WHERE "id"=job_id AND "state"<>'COMPLETE';
  UPDATE public."Pro311InventoryMember" SET "state"='COMPLETE' WHERE ("namespace","matchId","resultVersion","resultHash")=(ns,match_id,version_id,m->>'resultHash') AND "state" IN ('PENDING','DEFERRED_RESOURCE');
  RETURN pg_catalog.jsonb_build_object('status','COMPLETE','identity',digest);
 END IF;
 -- Fresh live admission after policy/metadata waits, immediately before the raw statement.
 SELECT * INTO admission FROM public."Pro311NativeAdmission" WHERE "jobId"=job_id AND "fence"::TEXT=fence_id;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=admission."profileId";
 IF public.pro311_own_backend_start() IS DISTINCT FROM started OR admission."state" IS DISTINCT FROM 'RESERVED' OR admission."expiresAt"<=pg_catalog.clock_timestamp() OR admission."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR admission."backendStart" IS DISTINCT FROM started OR admission."principal" IS DISTINCT FROM SESSION_USER OR admission."policyRevision" IS DISTINCT FROM policy_rev OR admission."policyHash" IS DISTINCT FROM policy_hash OR profile."enabled" IS DISTINCT FROM TRUE OR profile."resourceProofIdentity" IS DISTINCT FROM admission."resourceProofIdentity" OR profile."supervisorIdentity" IS DISTINCT FROM admission."supervisorIdentity" OR profile."serverVersion" IS DISTINCT FROM pg_catalog.current_setting('server_version') OR profile."serverEncoding" IS DISTINCT FROM pg_catalog.current_setting('server_encoding') OR profile."stackSetting" IS DISTINCT FROM pg_catalog.current_setting('max_stack_depth') THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 -- Only after procedural authorization/admission: one complete raw read and one native parse.
 BEGIN
 SELECT a."rawBytes" INTO raw FROM public."HuroofRawArtifact" a WHERE (a."namespace",a."id",a."contentHash")=(ns,m->>'rawId',m->>'resultHash');
 IF NOT FOUND OR pg_catalog.octet_length(raw) IS DISTINCT FROM (m->>'rawLength')::BIGINT OR pg_catalog.encode(int4_crypto.digest(raw,'sha256'),'hex') IS DISTINCT FROM m->>'resultHash' THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 semantic:=pg_catalog.convert_from(raw,'UTF8')::JSONB;
 SELECT * INTO admission FROM public."Pro311NativeAdmission" WHERE "jobId"=job_id AND "fence"::TEXT=fence_id FOR UPDATE;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=admission."profileId" FOR SHARE NOWAIT;
 IF profile."enabled" IS DISTINCT FROM TRUE OR admission."state" IS DISTINCT FROM 'RESERVED' OR admission."expiresAt"<=pg_catalog.clock_timestamp() OR admission."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR admission."backendStart" IS DISTINCT FROM started OR admission."principal" IS DISTINCT FROM SESSION_USER OR admission."policyRevision" IS DISTINCT FROM policy_rev OR admission."policyHash" IS DISTINCT FROM policy_hash OR NOT EXISTS(SELECT 1 FROM public."Pro311NativeProfile" p WHERE p."id"=admission."profileId" AND p."enabled" AND p."resourceProofIdentity"=admission."resourceProofIdentity" AND p."supervisorIdentity"=admission."supervisorIdentity") THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 digest:=public.pro311_publish_semantic(m,semantic,policy_rev,policy_hash,SESSION_USER::TEXT,profile."id");
 UPDATE public."Pro311NativeJob" SET "state"='COMPLETE' WHERE "id"=job_id AND "state"<>'COMPLETE';
 UPDATE public."Pro311InventoryMember" SET "state"='COMPLETE' WHERE ("namespace","matchId","resultVersion","resultHash")=(ns,match_id,version_id,m->>'resultHash') AND "state" IN ('PENDING','DEFERRED_RESOURCE');
 RETURN pg_catalog.jsonb_build_object('status','COMPLETE','identity',digest);
 EXCEPTION WHEN query_canceled OR OTHERS THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END;
END $$;
CREATE TRIGGER "Pro311NativePool_immutable" BEFORE UPDATE OR DELETE ON public."Pro311NativePool" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE FUNCTION public.pro311_profile_guard() RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'profile history cannot be deleted'; END IF;
 IF (pg_catalog.to_jsonb(NEW)-'enabled') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'enabled') OR OLD."enabled"=NEW."enabled" OR (OLD."enabled"=FALSE AND NEW."enabled"=TRUE) THEN RAISE EXCEPTION 'profile identity immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro311NativeProfile_guard" BEFORE UPDATE OR DELETE ON public."Pro311NativeProfile" FOR EACH ROW EXECUTE FUNCTION public.pro311_profile_guard();
CREATE FUNCTION public.pro311_archive_read(ns TEXT, owner_id TEXT, policy_rev TEXT, policy_hash TEXT, match_id TEXT, version_id BIGINT, admission_id TEXT, fence_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m JSONB; digest TEXT; projection JSONB; pre public."Pro311PreflightAdmission"%ROWTYPE; profile public."Pro311NativeProfile"%ROWTYPE; started TIMESTAMPTZ;
BEGIN
 PERFORM public.pro311_lock_control();
 started:=public.pro311_own_backend_start();
 SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId";
 IF started IS NULL OR pre."operation" IS DISTINCT FROM 'READ' OR pre."state" IS DISTINCT FROM 'RESERVED' OR pre."principal" IS DISTINCT FROM SESSION_USER OR pre."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR pre."backendStart" IS DISTINCT FROM started OR (pre."namespace",pre."owner",pre."matchId",pre."resultVersion",pre."policyRevision",pre."policyHash") IS DISTINCT FROM (ns,owner_id,match_id,version_id,policy_rev,policy_hash) OR pre."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE OR profile."resourceProofIdentity" IS DISTINCT FROM pre."resourceProofIdentity" OR profile."supervisorIdentity" IS DISTINCT FROM pre."supervisorIdentity" OR profile."serverVersion" IS DISTINCT FROM pg_catalog.current_setting('server_version') OR profile."serverEncoding" IS DISTINCT FROM pg_catalog.current_setting('server_encoding') OR profile."stackSetting" IS DISTINCT FROM pg_catalog.current_setting('max_stack_depth') THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 PERFORM public.eng03_03_assert_current(ns,owner_id,policy_rev,policy_hash);
 m:=public.pro311_archive_metadata(ns,owner_id,match_id,version_id); digest:=public.pro311_archive_existing(m);
 IF digest IS NULL THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 SELECT a."projection" INTO projection FROM public."Pro311ResultAttestation" a WHERE (a."namespace",a."matchId",a."resultVersion",a."algorithm",a."bindingHash")=(ns,match_id,version_id,'native-v1',digest);
 IF projection IS NULL THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id FOR UPDATE;
 SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId" FOR SHARE NOWAIT;
 IF pre."state" IS DISTINCT FROM 'RESERVED' OR pre."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
 RETURN pg_catalog.jsonb_build_object('terminalType',m->>'terminalType','projection',projection);
END $$;
-- Deferred fences apply only to newly inserted rows; old rows remain historical jobs.
CREATE FUNCTION public.pro311_new_result_coverage() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m JSONB;
BEGIN
 m:=public.pro311_archive_metadata(NEW."namespace",NEW."ownerFirebaseIdentityId",NEW."matchId",NEW."resultVersion");
 IF public.pro311_archive_existing(m) IS NULL THEN RAISE EXCEPTION 'RESULT_PROJECTION_REQUIRED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Pro311_new_result_coverage" AFTER INSERT ON public."HuroofMatchResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro311_new_result_coverage();
CREATE CONSTRAINT TRIGGER "Pro311_new_history_coverage" AFTER INSERT ON public."HuroofOwnerHistoryEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro311_new_result_coverage();
-- Only the distinct qualifier may record deferred, faulted or resumed work; completion is producer-owned.
CREATE FUNCTION public.pro311_archive_defer(job_id TEXT, next_state TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public."Pro311NativeJob"%ROWTYPE;
BEGIN
 PERFORM public.pro311_lock_control();
 IF next_state NOT IN ('PENDING','DEFERRED_RESOURCE','FAULT') OR next_state IS NULL THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 SELECT * INTO job FROM public."Pro311NativeJob" WHERE "id"=job_id FOR UPDATE;
 IF NOT FOUND OR job."state"='COMPLETE' THEN RAISE EXCEPTION 'RESULT_UNAVAILABLE'; END IF;
 UPDATE public."Pro311NativeJob" SET "state"=next_state WHERE "id"=job_id;
 UPDATE public."Pro311InventoryMember" SET "state"=next_state WHERE ("namespace","matchId","resultVersion","resultHash")=(job."namespace",job."matchId",job."resultVersion",job."resultHash") AND "state"<>'COMPLETE';
END $$;
-- A single READ COMMITTED statement snapshots every existing result; the deferred insert fence covers later commits.
CREATE FUNCTION public.pro311_inventory_authorize(boundary_id TEXT, admission_id TEXT, fence_id TEXT, expected_operation TEXT, final_check BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pre public."Pro311PreflightAdmission"%ROWTYPE; profile public."Pro311NativeProfile"%ROWTYPE; started TIMESTAMPTZ;
BEGIN
 started:=public.pro311_own_backend_start();
 IF final_check THEN SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id FOR UPDATE;
 ELSE SELECT * INTO pre FROM public."Pro311PreflightAdmission" WHERE "id"=admission_id AND "fence"::TEXT=fence_id; END IF;
 IF final_check THEN SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId" FOR SHARE NOWAIT;
 ELSE SELECT * INTO profile FROM public."Pro311NativeProfile" WHERE "id"=pre."profileId"; END IF;
 IF started IS NULL OR pre."operation" IS DISTINCT FROM expected_operation OR pre."boundaryId" IS DISTINCT FROM boundary_id OR pre."state" IS DISTINCT FROM 'RESERVED' OR pre."principal" IS DISTINCT FROM SESSION_USER OR pre."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR pre."backendStart" IS DISTINCT FROM started OR pre."expiresAt"<=pg_catalog.clock_timestamp() OR profile."enabled" IS DISTINCT FROM TRUE OR profile."resourceProofIdentity" IS DISTINCT FROM pre."resourceProofIdentity" OR profile."supervisorIdentity" IS DISTINCT FROM pre."supervisorIdentity" OR profile."serverVersion" IS DISTINCT FROM pg_catalog.current_setting('server_version') OR profile."serverEncoding" IS DISTINCT FROM pg_catalog.current_setting('server_encoding') OR profile."stackSetting" IS DISTINCT FROM pg_catalog.current_setting('max_stack_depth') THEN RAISE EXCEPTION 'RESOURCE_UNQUALIFIED'; END IF;
END $$;
CREATE FUNCTION public.pro311_inventory_create(boundary_id TEXT, admission_id TEXT, fence_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r RECORD; m JSONB; state TEXT; prior public."Pro311InventoryBoundary"%ROWTYPE; domain_id TEXT;
BEGIN
 PERFORM public.pro311_lock_control();
 IF boundary_id IS NULL OR boundary_id !~ '^[a-f0-9]{64}$' OR pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'INVENTORY_UNAVAILABLE'; END IF;
 PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_CREATE',FALSE);
 SELECT p."domainIdentity" INTO domain_id FROM public."Pro311PreflightAdmission" a JOIN public."Pro311NativeProfile" p ON p."id"=a."profileId" WHERE a."id"=admission_id AND a."fence"::TEXT=fence_id;
 SELECT * INTO prior FROM public."Pro311InventoryBoundary" WHERE "id"=boundary_id FOR UPDATE;
 IF FOUND THEN
  IF (prior."algorithm",prior."authority",prior."domainIdentity") IS DISTINCT FROM ('inventory-v1',SESSION_USER::TEXT,domain_id) THEN RAISE EXCEPTION 'INVENTORY_CONFLICT'; END IF;
  PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_CREATE',TRUE);
  RETURN boundary_id;
 END IF;
 INSERT INTO public."Pro311InventoryBoundary"("id","algorithm","authority","domainIdentity","state") VALUES(boundary_id,'inventory-v1',SESSION_USER::TEXT,domain_id,'OPEN');
 FOR r IN SELECT "namespace","ownerFirebaseIdentityId","matchId","resultVersion","resultHash" FROM public."HuroofMatchResult" LOOP
  state:='PENDING'; BEGIN
   m:=public.pro311_archive_metadata(r."namespace",r."ownerFirebaseIdentityId",r."matchId",r."resultVersion");
   IF public.pro311_archive_existing(m) IS NOT NULL THEN state:='COMPLETE'; END IF;
  EXCEPTION WHEN OTHERS THEN state:='FAULT'; END;
  INSERT INTO public."Pro311InventoryMember"("boundaryId","namespace","matchId","resultVersion","resultHash","state") VALUES(boundary_id,r."namespace",r."matchId",r."resultVersion",r."resultHash",state);
 END LOOP;
 PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_CREATE',TRUE);
 RETURN boundary_id;
END $$;
CREATE FUNCTION public.pro311_inventory_finish(boundary_id TEXT, admission_id TEXT, fence_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r RECORD; m JSONB; prior public."Pro311InventoryBoundary"%ROWTYPE; domain_id TEXT;
BEGIN
 PERFORM public.pro311_lock_control();
 IF boundary_id IS NULL OR boundary_id !~ '^[a-f0-9]{64}$' OR pg_catalog.current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'INVENTORY_UNAVAILABLE'; END IF;
 PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_FINISH',FALSE);
 SELECT p."domainIdentity" INTO domain_id FROM public."Pro311PreflightAdmission" a JOIN public."Pro311NativeProfile" p ON p."id"=a."profileId" WHERE a."id"=admission_id AND a."fence"::TEXT=fence_id;
 SELECT * INTO prior FROM public."Pro311InventoryBoundary" WHERE "id"=boundary_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVENTORY_UNAVAILABLE'; END IF;
 IF (prior."algorithm",prior."authority",prior."domainIdentity") IS DISTINCT FROM ('inventory-v1',SESSION_USER::TEXT,domain_id) THEN RAISE EXCEPTION 'INVENTORY_CONFLICT'; END IF;
 IF prior."state"='COMPLETE' THEN PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_FINISH',TRUE); RETURN 'COMPLETE'; END IF;
 IF EXISTS(SELECT 1 FROM public."Pro311InventoryMember" i LEFT JOIN public."HuroofMatchResult" r ON (r."namespace",r."matchId",r."resultVersion",r."resultHash")=(i."namespace",i."matchId",i."resultVersion",i."resultHash") WHERE i."boundaryId"=boundary_id AND (i."state"<>'COMPLETE' OR r."resultHash" IS NULL)) THEN RETURN 'INCOMPLETE'; END IF;
 FOR r IN SELECT "namespace","ownerFirebaseIdentityId","matchId","resultVersion" FROM public."HuroofMatchResult" LOOP
  BEGIN m:=public.pro311_archive_metadata(r."namespace",r."ownerFirebaseIdentityId",r."matchId",r."resultVersion"); IF public.pro311_archive_existing(m) IS NULL THEN RETURN 'INCOMPLETE'; END IF;
  EXCEPTION WHEN OTHERS THEN RETURN 'INCOMPLETE'; END;
 END LOOP;
 PERFORM public.pro311_inventory_authorize(boundary_id,admission_id,fence_id,'INVENTORY_FINISH',TRUE);
 UPDATE public."Pro311InventoryBoundary" SET "state"='COMPLETE' WHERE "id"=boundary_id;
 RETURN 'COMPLETE';
END $$;

-- Exact PRO273 command successor: only publication insertion is added.
CREATE OR REPLACE FUNCTION public.eng03_03_command_commit(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_member_generation BIGINT,p_revision BIGINT,p_sequence BIGINT,p_policy_revision TEXT,p_policy_hash TEXT,p_intent JSONB,p_next JSONB,p_members JSONB,p_projections JSONB,p_semantic JSONB,p_custody JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; st public."HuroofCanonicalState"%ROWTYPE; prior public."HuroofCommandReceipt"%ROWTYPE; project TEXT; actor_uid TEXT; item JSONB; subject_identity TEXT; subject_role TEXT; seq BIGINT; rev BIGINT; event_id TEXT; intent_bytes BYTEA; outcome JSONB; outcome_bytes BYTEA; matchrow public."HuroofMatch"%ROWTYPE; latest public."HuroofMatchResult"%ROWTYPE; history public."HuroofOwnerHistoryHead"%ROWTYPE; next_private JSONB; next_status TEXT; last_ref JSONB; result_bytes BYTEA; provenance_bytes BYTEA; result_hash TEXT; result_id TEXT; result_version BIGINT; event_type TEXT; terminal BOOLEAN; changed BOOLEAN; bridge JSONB; prior_bridge JSONB; next_bridge JSONB; bridge_entry RECORD; bridge_bytes BYTEA; separator INTEGER; idx INTEGER; occurrence_part TEXT; cell_part TEXT; active_key TEXT; expected_expiry JSONB; challenge_now BIGINT; challenge_clock NUMERIC; candidate_next JSONB; normalized_next JSONB; normalized_projections JSONB; challenge_context JSONB; challenge_people JSONB; host_uid TEXT; time_value NUMERIC; time_stamp TIMESTAMP; time_iso TEXT; deadline_iso TEXT; deadline_ms BIGINT; year_no INTEGER; proposed_challenge JSONB; expected_recipient TEXT; expected_team TEXT; projection_role TEXT; member_team TEXT; expected_challenge BOOLEAN; closed_room BOOLEAN; norm_item JSONB; challenge_definition JSONB; expected_game JSONB; expected_path JSONB; old_applied JSONB; new_applied JSONB; next_team TEXT;
BEGIN
 PERFORM public.pro311_lock_control();
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 IF NOT FOUND OR room."generation"<>p_generation THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT * INTO member FROM public."HuroofMember" WHERE ("namespace","roomId","firebaseIdentityId")=(p_namespace,p_room,p_identity) AND "revokedAt" IS NULL;
 IF NOT FOUND OR member."generation"<>p_member_generation THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT n."firebaseProjectId",i."firebaseUid" INTO project,actor_uid FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=p_namespace;
 IF NOT FOUND THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT * INTO st FROM public."HuroofCanonicalState" WHERE ("namespace","roomId")=(p_namespace,p_room) FOR UPDATE;
 IF NOT FOUND OR st."activeMatchId" IS NULL THEN RAISE EXCEPTION 'command unavailable'; END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'intentId' IS NULL OR (p_intent->>'type'='SERVER_TIME_EXPIRED' AND p_intent->>'intentId' IS DISTINCT FROM ':expiry:'||st."activeMatchId"||':'||(p_sequence+1)::TEXT) OR (p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' AND p_intent->>'intentId' !~ '^:challenge-expiry:[a-f0-9]{64}$') OR (p_intent->>'type' NOT IN ('SERVER_TIME_EXPIRED','SERVER_CHALLENGE_DEADLINE') AND p_intent->>'intentId' !~ '^[A-Za-z0-9_-]{1,120}$') THEN RAISE EXCEPTION 'invalid intent'; END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,p_identity,p_policy_revision,p_policy_hash);
 SELECT * INTO prior FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey")=(p_namespace,p_room,p_identity,p_intent->>'intentId');
 IF FOUND THEN
  IF convert_from(prior."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR prior."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(prior."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'command intent conflict'; END IF;
  RETURN convert_from(prior."outcome",'UTF8')::JSONB || jsonb_build_object('replayed',true);
 END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,p_identity,p_policy_revision,p_policy_hash);
 IF room."status"<>'ACTIVE' OR st."revision"<>p_revision OR st."sequence"<>p_sequence OR p_intent->>'expectedRevision' IS DISTINCT FROM p_revision::TEXT OR st."privateState"->'room'->>'revision' IS DISTINCT FROM p_revision::TEXT OR (p_next->>'revision') IS DISTINCT FROM (p_revision+1)::TEXT OR p_next->>'roomCode' IS DISTINCT FROM st."privateState"->'room'->>'roomCode' OR jsonb_typeof(p_next->'game') IS DISTINCT FROM 'object' OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_projections) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'command CAS unavailable'; END IF;
 -- A single database observation owns fresh challenge eligibility; replay returned before this point.
 IF p_intent->>'type' LIKE 'CHALLENGE_%' OR p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN
  challenge_clock:=floor(extract(epoch FROM clock_timestamp())*1000);
  IF challenge_clock<0 OR challenge_clock>8640000000000000 OR challenge_clock>9007199254740991 THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  challenge_now:=challenge_clock::BIGINT;
 END IF;
 candidate_next:=p_next; normalized_projections:=p_projections;
 -- Provisional reducer clocks are shape-checked; only named timing slots receive the database sample.
 IF p_intent->>'type' IN ('CHALLENGE_START','CHALLENGE_START_STEAL') THEN
  IF jsonb_typeof(p_next->'challenge'->'stageStartedAt') IS DISTINCT FROM 'number' OR jsonb_typeof(p_next->'challenge'->'deadlineAt') IS DISTINCT FROM 'number' OR p_next->'challenge'->>'stageStartedAt' !~ '^(0|[1-9][0-9]{0,15})$' OR p_next->'challenge'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (p_next->'challenge'->>'stageStartedAt')::NUMERIC>9007199254740991 OR (p_next->'challenge'->>'deadlineAt')::NUMERIC>9007199254740991 THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  time_value:=challenge_now+CASE WHEN p_intent->>'type'='CHALLENGE_START' THEN 3000 ELSE 15000 END;
  IF time_value>8640000000000000 THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  candidate_next:=jsonb_set(jsonb_set(candidate_next,'{challenge,stageStartedAt}',to_jsonb(challenge_now)),'{challenge,deadlineAt}',to_jsonb(time_value));
 ELSIF p_intent->>'type'='CHALLENGE_PAUSE' THEN
  IF jsonb_typeof(p_next->'challenge'->'paused') IS DISTINCT FROM 'object' OR (p_next->'challenge'->'paused'-ARRAY['at','from','deadlineAt']::TEXT[])<>'{}'::JSONB OR NOT (p_next->'challenge'->'paused') ?& ARRAY['at','from','deadlineAt'] OR jsonb_typeof(p_next->'challenge'->'paused'->'at') IS DISTINCT FROM 'number' OR p_next->'challenge'->'paused'->>'at' !~ '^(0|[1-9][0-9]{0,15})$' OR (p_next->'challenge'->'paused'->>'at')::NUMERIC>9007199254740991 OR p_next->'challenge'->'paused'->>'from' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'stage' OR p_next->'challenge'->'paused'->'deadlineAt' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'deadlineAt' THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  candidate_next:=jsonb_set(candidate_next,'{challenge,paused,at}',to_jsonb(challenge_now));
 ELSIF p_intent->>'type'='CHALLENGE_RESUME' THEN
  IF jsonb_typeof(p_next->'challenge'->'deadlineAt') IS DISTINCT FROM 'number' OR p_next->'challenge'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (p_next->'challenge'->>'deadlineAt')::NUMERIC>9007199254740991 OR (p_next->'challenge') ? 'paused' OR jsonb_typeof(st."privateState"->'room'->'challenge'->'paused'->'at') IS DISTINCT FROM 'number' OR jsonb_typeof(st."privateState"->'room'->'challenge'->'paused'->'deadlineAt') IS DISTINCT FROM 'number' OR st."privateState"->'room'->'challenge'->'paused'->>'at' !~ '^(0|[1-9][0-9]{0,15})$' OR st."privateState"->'room'->'challenge'->'paused'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  time_value:=(st."privateState"->'room'->'challenge'->'paused'->>'deadlineAt')::NUMERIC+challenge_now-(st."privateState"->'room'->'challenge'->'paused'->>'at')::NUMERIC;
  IF (st."privateState"->'room'->'challenge'->'paused'->>'at')::NUMERIC>challenge_now OR time_value>8640000000000000 THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  candidate_next:=jsonb_set(candidate_next,'{challenge,deadlineAt}',to_jsonb(time_value));
 ELSIF p_intent->>'type'='CHALLENGE_SUBMIT' AND p_next->'challenge'->>'stage'='steal_offer' THEN
  IF jsonb_typeof(p_next->'challenge'->'stageStartedAt') IS DISTINCT FROM 'number' OR p_next->'challenge'->>'stageStartedAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (p_next->'challenge'->>'stageStartedAt')::NUMERIC>9007199254740991 OR (p_next->'challenge') ? 'deadlineAt' THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
  candidate_next:=jsonb_set(candidate_next,'{challenge,stageStartedAt}',to_jsonb(challenge_now));
 END IF;
 -- Exact challenge-category replacement remains held; committed replay already returned.
 IF p_intent->>'type'='CHALLENGE_CONTINUE' AND st."privateState"->'room'->'config'->>'gameKind'='categories' THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
 IF p_intent->>'type' IS NULL OR p_intent->>'type' NOT IN ('SERVER_TIME_EXPIRED','ROUND_READY','SELECT_CELL','LETTER_REVEALED','OPEN_QUESTION','BUZZ','HOST_SELECT_TEAM','JUDGE_CORRECT','JUDGE_INCORRECT','RETRY_CELL','RETURN_CELL','END_WITHOUT_WINNER','AWARD_CELL','CHECK_PATH','START_NEXT_ROUND','PAUSE','RESUME','BEGIN_CORRECTION','CONFIRM_CORRECTION','CANCEL_CORRECTION','SET_AUDIENCE_QUESTION_VISIBILITY','REVEAL_ANSWER','SERVER_CHALLENGE_DEADLINE','CHALLENGE_ASSIGN','CHALLENGE_READY','CHALLENGE_START','CHALLENGE_MOVE','CHALLENGE_SUBMIT','CHALLENGE_START_STEAL','CHALLENGE_DECLINE_STEAL','CHALLENGE_PAUSE','CHALLENGE_RESUME','CHALLENGE_VOID','CHALLENGE_REVEAL','CHALLENGE_CONTINUE') OR (p_intent->>'type' NOT IN ('BUZZ','SERVER_TIME_EXPIRED','SERVER_CHALLENGE_DEADLINE','CHALLENGE_READY','CHALLENGE_MOVE','CHALLENGE_SUBMIT') AND member."role"<>'OWNER') THEN RAISE EXCEPTION 'command unauthorized'; END IF;
 IF p_members IS DISTINCT FROM st."privateState"->'members' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_members) AS x(value) WHERE x.value->>'uid'=actor_uid AND x.value->'active'='true'::JSONB AND ((member."role"='OWNER' AND x.value->>'role'='host') OR (member."role"='MEMBER' AND ((x.value->>'role'='player' AND p_intent->>'type' IN ('BUZZ','CHALLENGE_READY','CHALLENGE_MOVE','CHALLENGE_SUBMIT')) OR (x.value->>'role' IN ('player','audience') AND p_intent->>'type' IN ('SERVER_TIME_EXPIRED','SERVER_CHALLENGE_DEADLINE')))))) THEN RAISE EXCEPTION 'member authority mismatch'; END IF;
 IF p_intent->>'type'='SERVER_TIME_EXPIRED' THEN
  expected_expiry:=jsonb_set(jsonb_set((st."privateState"->'room')-ARRAY['timer','buzzWinner']::TEXT[],'{revision}',to_jsonb(st."revision"+1)),'{game,lifecycle}','"QUESTION_FAILED"'::JSONB);
  IF jsonb_typeof(expected_expiry->'challengeBridge')='object' AND NOT (expected_expiry->'challengeBridge') ? 'appliedEncoding' AND expected_expiry->'challengeBridge'->'applied'='{}'::JSONB THEN expected_expiry:=jsonb_set(expected_expiry,'{challengeBridge,appliedEncoding}','"utf8-hex-v1"'::JSONB); END IF;
 END IF;
 IF p_intent->>'type'='SERVER_TIME_EXPIRED' AND ((p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR p_intent->'payload' IS DISTINCT FROM '{}'::JSONB OR st."privateState"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'OPPONENT_CHANCE' OR st."privateState"->'room'->'timer'->>'deadlineMs' IS NULL OR st."privateState"->'room'->'timer'->>'deadlineMs' !~ '^(0|[1-9][0-9]*)$' OR (st."privateState"->'room'->'timer'->>'deadlineMs')::BIGINT>floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT OR candidate_next IS DISTINCT FROM expected_expiry) THEN RAISE EXCEPTION 'timer expiry unavailable'; END IF;
 prior_bridge:=st."privateState"->'room'->'challengeBridge'; next_bridge:=candidate_next->'challengeBridge';
 IF octet_length(candidate_next::TEXT)>262144 THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
 FOR bridge IN SELECT x FROM (VALUES(prior_bridge),(next_bridge)) v(x) WHERE x IS NOT NULL LOOP
  IF jsonb_typeof(bridge) IS DISTINCT FROM 'object' OR jsonb_typeof(bridge->'activeOccurrence') IS DISTINCT FROM 'string' OR jsonb_typeof(bridge->'selectedCellId') IS DISTINCT FROM 'string' OR length(bridge->>'activeOccurrence') NOT BETWEEN 1 AND 180 OR length(bridge->>'selectedCellId') NOT BETWEEN 1 AND 128 OR EXISTS(SELECT 1 FROM regexp_split_to_table(bridge->>'activeOccurrence','') ch WHERE ascii(ch) BETWEEN 1 AND 31 OR ascii(ch)=127) OR EXISTS(SELECT 1 FROM regexp_split_to_table(bridge->>'selectedCellId','') ch WHERE ascii(ch) BETWEEN 1 AND 31 OR ascii(ch)=127) OR jsonb_typeof(bridge->'applied') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
  IF (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(bridge->>'activeOccurrence','') ch)>180 OR (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(bridge->>'selectedCellId','') ch)>128 THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
  IF NOT bridge ? 'appliedEncoding' THEN
   IF (bridge-ARRAY['activeOccurrence','selectedCellId','applied']::TEXT[])<>'{}'::JSONB OR bridge->'applied'<>'{}'::JSONB OR bridge IS NOT DISTINCT FROM next_bridge THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
  ELSIF (bridge-ARRAY['activeOccurrence','selectedCellId','appliedEncoding','applied']::TEXT[])<>'{}'::JSONB OR bridge->>'appliedEncoding' IS DISTINCT FROM 'utf8-hex-v1' THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
  FOR bridge_entry IN SELECT key,value FROM jsonb_each(bridge->'applied') LOOP
   IF bridge_entry.key !~ '^([0-9a-f]{2})+$' OR length(bridge_entry.key) NOT BETWEEN 6 AND 1850 OR jsonb_typeof(bridge_entry.value) IS DISTINCT FROM 'string' OR bridge_entry.value#>>'{}' NOT IN ('award','continue') THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
   bridge_bytes:=decode(bridge_entry.key,'hex'); separator:=-1;
   FOR idx IN 0..octet_length(bridge_bytes)-1 LOOP IF get_byte(bridge_bytes,idx)=0 THEN IF separator<>-1 THEN RAISE EXCEPTION 'room storage unavailable'; END IF; separator:=idx; END IF; END LOOP;
   IF separator<1 OR separator>=octet_length(bridge_bytes)-1 THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
   occurrence_part:=convert_from(substring(bridge_bytes FROM 1 FOR separator),'UTF8'); cell_part:=convert_from(substring(bridge_bytes FROM separator+2),'UTF8');
   IF length(occurrence_part) NOT BETWEEN 1 AND 180 OR length(cell_part) NOT BETWEEN 1 AND 128 OR (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(occurrence_part,'') ch)>180 OR (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(cell_part,'') ch)>128 OR EXISTS(SELECT 1 FROM regexp_split_to_table(occurrence_part,'') ch WHERE ascii(ch) BETWEEN 1 AND 31 OR ascii(ch)=127) OR EXISTS(SELECT 1 FROM regexp_split_to_table(cell_part,'') ch WHERE ascii(ch) BETWEEN 1 AND 31 OR ascii(ch)=127) OR encode(convert_to(occurrence_part,'UTF8'),'hex')||'00'||encode(convert_to(cell_part,'UTF8'),'hex') IS DISTINCT FROM bridge_entry.key THEN RAISE EXCEPTION 'room storage unavailable'; END IF;
  END LOOP;
 END LOOP;
 -- Fresh bridge creation is contained until exact initial occurrence selection/state/time are reviewed.
 IF next_bridge IS NOT NULL AND (prior_bridge IS NULL OR prior_bridge->>'activeOccurrence' IS DISTINCT FROM next_bridge->>'activeOccurrence') THEN RAISE EXCEPTION 'fresh challenge occurrence unavailable'; END IF;
 -- Ordinary transitions cannot introduce, reset or replace canonical challenge authority.
 IF p_intent->>'type' NOT LIKE 'CHALLENGE_%' AND p_intent->>'type'<>'SERVER_CHALLENGE_DEADLINE' THEN
  IF candidate_next->'challenge' IS DISTINCT FROM st."privateState"->'room'->'challenge' OR (candidate_next ? 'challenge') IS DISTINCT FROM ((st."privateState"->'room') ? 'challenge') OR (candidate_next ? 'challenge' AND jsonb_typeof(candidate_next->'challenge') NOT IN ('object','null')) THEN RAISE EXCEPTION 'ordinary challenge mutation unavailable'; END IF;
  IF candidate_next ? 'activeQuestion' AND jsonb_typeof(candidate_next->'activeQuestion') NOT IN ('object','null') THEN RAISE EXCEPTION 'ordinary challenge binding unavailable'; END IF;
  IF COALESCE(jsonb_typeof(candidate_next->'activeQuestion'),'null')='null' AND COALESCE(candidate_next->'activeQuestionOccurrence','null'::JSONB)<>'null'::JSONB THEN RAISE EXCEPTION 'ordinary challenge binding unavailable'; END IF;
  IF next_bridge IS NOT NULL AND (jsonb_typeof(candidate_next->'challenge') IS DISTINCT FROM 'object' OR next_bridge->>'activeOccurrence' IS DISTINCT FROM candidate_next->'challenge'->>'occurrence') THEN RAISE EXCEPTION 'ordinary challenge binding unavailable'; END IF;
  IF jsonb_typeof(candidate_next->'challenge')='object' AND jsonb_typeof(candidate_next->'activeQuestion')='object' AND NOT (candidate_next->'activeQuestion') ? 'challenge' AND candidate_next->>'activeQuestionOccurrence' IS NOT DISTINCT FROM candidate_next->'challenge'->>'occurrence' THEN RAISE EXCEPTION 'ordinary challenge binding unavailable'; END IF;
  IF jsonb_typeof(candidate_next->'activeQuestion')='object' AND (candidate_next->'activeQuestion') ? 'challenge' THEN
   IF jsonb_typeof(candidate_next->'activeQuestion'->'challenge') IS DISTINCT FROM 'object' OR jsonb_typeof(candidate_next->'challenge') IS DISTINCT FROM 'object' OR next_bridge IS NULL OR candidate_next->'activeQuestion' IS DISTINCT FROM st."privateState"->'room'->'activeQuestion' OR candidate_next->'activeQuestionOccurrence' IS DISTINCT FROM st."privateState"->'room'->'activeQuestionOccurrence' OR candidate_next->>'activeQuestionOccurrence' IS DISTINCT FROM candidate_next->'challenge'->>'occurrence' OR candidate_next->'activeQuestion'->'challenge'->'definition'->>'id' IS DISTINCT FROM candidate_next->'challenge'->>'definitionId' OR candidate_next->'activeQuestion'->'challenge'->'definition'->>'definitionSha256' IS DISTINCT FROM candidate_next->'challenge'->>'definitionHash' THEN RAISE EXCEPTION 'ordinary challenge binding unavailable'; END IF;
  END IF;
 END IF;
 IF next_bridge IS NOT NULL AND (prior_bridge IS NULL OR prior_bridge->>'activeOccurrence' IS DISTINCT FROM next_bridge->>'activeOccurrence') THEN
  IF (prior_bridge IS NOT NULL AND st."privateState"->'room'->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB) OR p_intent->>'type' NOT IN ('SELECT_CELL','LETTER_REVEALED','RETRY_CELL','RETURN_CELL','START_NEXT_ROUND') OR next_bridge->'applied' IS DISTINCT FROM '{}'::JSONB OR next_bridge->>'activeOccurrence' IS DISTINCT FROM candidate_next->>'activeQuestionOccurrence' OR next_bridge->>'selectedCellId' IS DISTINCT FROM candidate_next->'game'->>'activeCellId' THEN RAISE EXCEPTION 'new bridge unavailable'; END IF;
 ELSIF prior_bridge IS NOT NULL THEN
  IF next_bridge IS NULL OR next_bridge->>'selectedCellId' IS DISTINCT FROM prior_bridge->>'selectedCellId' OR NOT (next_bridge->'applied') @> (prior_bridge->'applied') THEN RAISE EXCEPTION 'bridge history unavailable'; END IF;
  active_key:=encode(convert_to(prior_bridge->>'activeOccurrence','UTF8'),'hex')||'00'||encode(convert_to(prior_bridge->>'selectedCellId','UTF8'),'hex');
  IF (SELECT count(*) FROM jsonb_each(next_bridge->'applied') e WHERE NOT (prior_bridge->'applied') ? e.key)>1 OR EXISTS(SELECT 1 FROM jsonb_each(next_bridge->'applied') e WHERE NOT (prior_bridge->'applied') ? e.key AND (e.key IS DISTINCT FROM active_key OR NOT ((e.value='"award"'::JSONB AND ((p_intent->>'type'='CHALLENGE_MOVE' AND st."privateState"->'room'->'challenge'->>'stage'='answer') OR (p_intent->>'type'='CHALLENGE_SUBMIT' AND st."privateState"->'room'->'challenge'->>'stage' IN ('answer','steal'))) AND st."privateState"->'room'->'challenge'->>'result' IS NULL AND st."privateState"->'room'->'challenge'->'attemptsClosed' IS DISTINCT FROM 'true'::JSONB AND candidate_next->'challenge'->>'result'='correct' AND candidate_next->'challenge'->'attemptsClosed'='true'::JSONB AND candidate_next->'challenge'->'awarded'='true'::JSONB) OR (e.value='"continue"'::JSONB AND p_intent->>'type'='CHALLENGE_CONTINUE' AND st."privateState"->'room'->'challenge'->>'result' IN ('failed','void') AND st."privateState"->'room'->'challenge'->'attemptsClosed'='true'::JSONB AND st."privateState"->'room'->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB AND candidate_next->'challenge'->>'result' IS NOT DISTINCT FROM st."privateState"->'room'->'challenge'->>'result' AND candidate_next->'challenge'->'continued'='true'::JSONB)))) OR ((prior_bridge->'applied') ? active_key AND st."privateState"->'room'->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB AND candidate_next->'game'->'board' IS DISTINCT FROM st."privateState"->'room'->'game'->'board') THEN RAISE EXCEPTION 'bridge transition unavailable'; END IF;
 END IF;
 IF jsonb_typeof(st."privateState"->'room'->'challenge')='object' AND st."privateState"->'room'->'challenge' ? 'paused' AND NOT COALESCE((jsonb_typeof(st."privateState"->'room'->'challenge'->'paused')='object' AND (st."privateState"->'room'->'challenge'->'paused'-ARRAY['at','from','deadlineAt']::TEXT[])='{}'::JSONB AND (st."privateState"->'room'->'challenge'->'paused') ?& ARRAY['at','from','deadlineAt'] AND jsonb_typeof(st."privateState"->'room'->'challenge'->'paused'->'at')='number' AND st."privateState"->'room'->'challenge'->'paused'->>'at' ~ '^(0|[1-9][0-9]{0,15})$' AND jsonb_typeof(st."privateState"->'room'->'challenge'->'paused'->'deadlineAt')='number' AND st."privateState"->'room'->'challenge'->'paused'->>'deadlineAt' ~ '^(0|[1-9][0-9]{0,15})$' AND st."privateState"->'room'->'challenge'->'paused'->>'from' IN ('countdown','observation','answer','steal_offer','steal') AND st."privateState"->'room'->'challenge'->'paused'->>'from'=st."privateState"->'room'->'challenge'->>'stage' AND st."privateState"->'room'->'challenge'->'paused'->'deadlineAt'=st."privateState"->'room'->'challenge'->'deadlineAt' AND (st."privateState"->'room'->'challenge'->'paused'->>'at')::NUMERIC<(st."privateState"->'room'->'challenge'->'paused'->>'deadlineAt')::NUMERIC),FALSE) THEN RAISE EXCEPTION 'challenge pause unavailable'; END IF;
 IF jsonb_typeof(candidate_next->'challenge')='object' AND (candidate_next->'challenge') ? 'paused' AND NOT COALESCE((jsonb_typeof(candidate_next->'challenge'->'paused')='object' AND (candidate_next->'challenge'->'paused'-ARRAY['at','from','deadlineAt']::TEXT[])='{}'::JSONB AND (candidate_next->'challenge'->'paused') ?& ARRAY['at','from','deadlineAt'] AND jsonb_typeof(candidate_next->'challenge'->'paused'->'at')='number' AND candidate_next->'challenge'->'paused'->>'at' ~ '^(0|[1-9][0-9]{0,15})$' AND jsonb_typeof(candidate_next->'challenge'->'paused'->'deadlineAt')='number' AND candidate_next->'challenge'->'paused'->>'deadlineAt' ~ '^(0|[1-9][0-9]{0,15})$' AND candidate_next->'challenge'->'paused'->>'from' IN ('countdown','observation','answer','steal_offer','steal') AND candidate_next->'challenge'->'paused'->>'from'=candidate_next->'challenge'->>'stage' AND candidate_next->'challenge'->'paused'->'deadlineAt'=candidate_next->'challenge'->'deadlineAt' AND (candidate_next->'challenge'->'paused'->>'at')::NUMERIC<(candidate_next->'challenge'->'paused'->>'deadlineAt')::NUMERIC),FALSE) THEN RAISE EXCEPTION 'challenge pause unavailable'; END IF;
 IF p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN
  IF (p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR jsonb_typeof(p_intent->'payload') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))<>4 OR NOT (p_intent->'payload') ?& ARRAY['occurrence','challengeRevision','stage','observedDeadlineMs'] OR jsonb_typeof(p_intent->'payload'->'occurrence') IS DISTINCT FROM 'string' OR jsonb_typeof(p_intent->'payload'->'challengeRevision') IS DISTINCT FROM 'number' OR jsonb_typeof(p_intent->'payload'->'stage') IS DISTINCT FROM 'string' OR p_intent->'payload'->>'occurrence' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'occurrence' OR p_intent->'payload'->>'challengeRevision' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'revision' OR p_intent->'payload'->>'stage' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'stage' OR p_intent->'payload'->>'observedDeadlineMs' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'deadlineAt' OR (st."privateState"->'room'->'challenge' ? 'paused') OR jsonb_typeof(p_intent->'payload'->'observedDeadlineMs') IS DISTINCT FROM 'number' OR p_intent->'payload'->>'observedDeadlineMs' !~ '^(0|[1-9][0-9]{0,15})$' OR (p_intent->'payload'->>'observedDeadlineMs')::NUMERIC>challenge_now OR p_intent->>'intentId' IS DISTINCT FROM ':challenge-expiry:'||public.int5b_hash_json(jsonb_build_array(p_namespace,p_room,st."activeMatchId",p_intent->'payload'->>'occurrence',p_intent->'payload'->'challengeRevision',p_intent->'payload'->>'stage',p_intent->'payload'->'observedDeadlineMs',p_revision)) THEN RAISE EXCEPTION 'challenge deadline unavailable'; END IF;
 END IF;
 IF jsonb_typeof(st."privateState"->'room'->'challenge')='object' AND st."privateState"->'room'->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB AND p_intent->>'type' NOT LIKE 'CHALLENGE_%' AND p_intent->>'type'<>'SERVER_CHALLENGE_DEADLINE' THEN RAISE EXCEPTION 'challenge command required'; END IF;
 IF p_intent->>'type' LIKE 'CHALLENGE_%' OR p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN
  IF candidate_next->'challenge'->'schemaVersion' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'schemaVersion' OR candidate_next->'challenge'->'definitionId' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'definitionId' OR candidate_next->'challenge'->'definitionHash' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'definitionHash' OR candidate_next->'challenge'->'occurrence' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'occurrence' OR candidate_next->'challenge'->'entitledTeam' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'entitledTeam' THEN RAISE EXCEPTION 'challenge identity unavailable'; END IF;
  IF (candidate_next->'challengeBridge'->'applied') IS NOT DISTINCT FROM (st."privateState"->'room'->'challengeBridge'->'applied') AND (candidate_next-ARRAY['revision','challenge','challengeBridge']::TEXT[]) IS DISTINCT FROM ((st."privateState"->'room')-ARRAY['revision','challenge','challengeBridge']::TEXT[]) THEN RAISE EXCEPTION 'challenge game mutation unavailable'; END IF;
  IF (candidate_next->'challenge'->>'result'='correct' AND st."privateState"->'room'->'challenge'->>'result' IS DISTINCT FROM 'correct' AND candidate_next->'challengeBridge'->'applied'->>active_key IS DISTINCT FROM 'award') OR (candidate_next->'challenge'->'continued'='true'::JSONB AND st."privateState"->'room'->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB AND st."privateState"->'room'->'challenge'->>'result' IN ('failed','void') AND candidate_next->'challengeBridge'->'applied'->>active_key IS DISTINCT FROM 'continue') THEN RAISE EXCEPTION 'challenge bridge marker unavailable'; END IF;
  IF p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' AND ((candidate_next->'challengeBridge'->'applied') IS DISTINCT FROM (st."privateState"->'room'->'challengeBridge'->'applied') OR candidate_next->'challenge'->>'result'='correct' OR (candidate_next->'challenge'-ARRAY['revision','stage','stageStartedAt','deadlineAt','disclosureGeneration','answeringTeam','attempt','attemptsClosed','result']::TEXT[]) IS DISTINCT FROM (st."privateState"->'room'->'challenge'-ARRAY['revision','stage','stageStartedAt','deadlineAt','disclosureGeneration','answeringTeam','attempt','attemptsClosed','result']::TEXT[])) THEN RAISE EXCEPTION 'challenge deadline mutation unavailable'; END IF;
  IF p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' AND (jsonb_typeof(candidate_next->'challenge'->'disclosureGeneration') IS DISTINCT FROM 'number' OR candidate_next->'challenge'->>'disclosureGeneration' !~ '^(0|[1-9][0-9]{0,15})$' OR jsonb_typeof(st."privateState"->'room'->'challenge'->'disclosureGeneration') IS DISTINCT FROM 'number' OR st."privateState"->'room'->'challenge'->>'disclosureGeneration' !~ '^(0|[1-9][0-9]{0,15})$' OR (candidate_next->'challenge'->>'disclosureGeneration')::NUMERIC-(st."privateState"->'room'->'challenge'->>'disclosureGeneration')::NUMERIC IS DISTINCT FROM (candidate_next->'challenge'->>'revision')::NUMERIC-(st."privateState"->'room'->'challenge'->>'revision')::NUMERIC OR (candidate_next->'challenge'->>'stage'='steal_offer' AND (candidate_next->'challenge' ? 'result' OR candidate_next->'challenge'->'attemptsClosed' IS DISTINCT FROM 'false'::JSONB)) OR (candidate_next->'challenge'->>'stage' IN ('observation','answer','result') AND (candidate_next->'challenge'->'answeringTeam' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'answeringTeam' OR candidate_next->'challenge'->'attempt' IS DISTINCT FROM st."privateState"->'room'->'challenge'->'attempt')) OR (candidate_next->'challenge'->>'stage' IN ('observation','answer') AND candidate_next->'challenge'->'attemptsClosed' IS DISTINCT FROM 'false'::JSONB)) THEN RAISE EXCEPTION 'challenge deadline disclosure unavailable'; END IF;
  IF p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' AND (NOT COALESCE((CASE st."privateState"->'room'->'challenge'->>'stage' WHEN 'countdown' THEN candidate_next->'challenge'->>'stage' IN ('observation','answer','steal_offer','result') WHEN 'observation' THEN candidate_next->'challenge'->>'stage' IN ('answer','steal_offer','result') WHEN 'answer' THEN candidate_next->'challenge'->>'stage' IN ('steal_offer','result') WHEN 'steal' THEN candidate_next->'challenge'->>'stage'='result' ELSE false END),FALSE) OR jsonb_typeof(candidate_next->'challenge'->'stageStartedAt') IS DISTINCT FROM 'number' OR candidate_next->'challenge'->>'stageStartedAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (candidate_next->'challenge'->>'stageStartedAt')::NUMERIC>(challenge_now) OR (candidate_next->'challenge'->>'stage'='result' AND (candidate_next->'challenge'->>'result' IS DISTINCT FROM 'failed' OR candidate_next->'challenge'->'attemptsClosed' IS DISTINCT FROM 'true'::JSONB OR candidate_next->'challenge' ? 'deadlineAt')) OR (candidate_next->'challenge'->>'stage'='steal_offer' AND (candidate_next->'challenge'->>'attempt' IS DISTINCT FROM 'steal' OR candidate_next->'challenge' ? 'deadlineAt' OR candidate_next->'challenge'->>'answeringTeam' IS DISTINCT FROM CASE st."privateState"->'room'->'challenge'->>'entitledTeam' WHEN 'horizontal' THEN 'vertical' WHEN 'vertical' THEN 'horizontal' ELSE NULL END)) OR (candidate_next->'challenge'->>'stage' IN ('observation','answer') AND (jsonb_typeof(candidate_next->'challenge'->'deadlineAt') IS DISTINCT FROM 'number' OR candidate_next->'challenge'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (candidate_next->'challenge'->>'deadlineAt')::NUMERIC<=(candidate_next->'challenge'->>'stageStartedAt')::NUMERIC OR candidate_next->'challenge' ? 'result'))) THEN RAISE EXCEPTION 'challenge deadline stage unavailable'; END IF;
  IF (p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR NOT p_intent ?& ARRAY['type','intentId','expectedRevision','payload'] OR jsonb_typeof(p_intent->'type') IS DISTINCT FROM 'string' OR jsonb_typeof(p_intent->'intentId') IS DISTINCT FROM 'string' OR jsonb_typeof(p_intent->'expectedRevision') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF jsonb_typeof(st."privateState"->'room'->'challenge') IS DISTINCT FROM 'object' OR jsonb_typeof(st."privateState"->'room'->'challengeBridge') IS DISTINCT FROM 'object' OR st."privateState"->'room'->'challengeBridge'->>'activeOccurrence' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'occurrence' OR st."privateState"->'room'->'challengeBridge'->>'selectedCellId' IS DISTINCT FROM st."privateState"->'room'->'game'->>'activeCellId' OR jsonb_typeof(candidate_next->'challenge') IS DISTINCT FROM 'object' OR jsonb_typeof(candidate_next->'challengeBridge') IS DISTINCT FROM 'object' OR candidate_next->'challenge'->>'occurrence' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'occurrence' OR candidate_next->'challengeBridge'->>'activeOccurrence' IS DISTINCT FROM st."privateState"->'room'->'challengeBridge'->>'activeOccurrence' THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF st."privateState"->'room'->'challenge'->>'revision' !~ '^(0|[1-9][0-9]{0,15})$' OR candidate_next->'challenge'->>'revision' !~ '^(0|[1-9][0-9]{0,15})$' OR (candidate_next->'challenge'->>'revision')::NUMERIC<=(st."privateState"->'room'->'challenge'->>'revision')::NUMERIC OR (candidate_next->'challenge'->>'revision')::NUMERIC>(st."privateState"->'room'->'challenge'->>'revision')::NUMERIC+CASE WHEN p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN 3 ELSE 1 END OR candidate_next->'challengeBridge'->>'selectedCellId' IS DISTINCT FROM st."privateState"->'room'->'challengeBridge'->>'selectedCellId' OR jsonb_typeof(st."privateState"->'room'->'challengeBridge'->'applied') IS DISTINCT FROM 'object' OR jsonb_typeof(candidate_next->'challengeBridge'->'applied') IS DISTINCT FROM 'object' OR NOT (candidate_next->'challengeBridge'->'applied') @> (st."privateState"->'room'->'challengeBridge'->'applied') THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF p_intent->>'type' LIKE 'CHALLENGE_%' AND (jsonb_typeof(p_intent->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(p_intent->'payload'->'occurrence') IS DISTINCT FROM 'string' OR jsonb_typeof(p_intent->'payload'->'challengeRevision') IS DISTINCT FROM 'number' OR jsonb_typeof(p_intent->'payload'->'stage') IS DISTINCT FROM 'string' OR p_intent->'payload'->>'occurrence' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'occurrence' OR p_intent->'payload'->>'challengeRevision' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'revision' OR p_intent->'payload'->>'stage' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'stage') THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF p_intent->>'type' LIKE 'CHALLENGE_%' AND ((p_intent->'payload')-ARRAY['occurrence','challengeRevision','stage','assignment','participantId','readiness','direction','answers','start','end']::TEXT[])<>'{}'::JSONB THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF p_intent->>'type'='CHALLENGE_ASSIGN' AND ((SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))<>5 OR jsonb_typeof(p_intent->'payload'->'assignment') IS DISTINCT FROM 'string' OR jsonb_typeof(p_intent->'payload'->'participantId') IS DISTINCT FROM 'string' OR p_intent->'payload'->>'assignment' NOT IN ('guide','mover','captain','stealCaptain') OR p_intent->'payload'->>'participantId' !~ '^(member|manual):[A-Za-z0-9_-]{1,120}$') THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF p_intent->>'type'='CHALLENGE_READY' AND ((SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))<>5 OR jsonb_typeof(p_intent->'payload'->'participantId') IS DISTINCT FROM 'string' OR p_intent->'payload'->>'participantId' !~ '^(member|manual):[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(p_intent->'payload'->'readiness') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'->'readiness'))<>3 OR NOT (p_intent->'payload'->'readiness') ?& ARRAY['protocolHash','assignmentHash','stimulusHash'] OR EXISTS(SELECT 1 FROM jsonb_each(p_intent->'payload'->'readiness') r WHERE jsonb_typeof(r.value) IS DISTINCT FROM 'string' OR length(r.value#>>'{}') NOT BETWEEN 1 AND 256)) THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF p_intent->>'type'='CHALLENGE_MOVE' AND ((SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))<>4 OR jsonb_typeof(p_intent->'payload'->'direction') IS DISTINCT FROM 'string' OR p_intent->'payload'->>'direction' NOT IN ('north','east','south','west')) THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF p_intent->>'type'='CHALLENGE_SUBMIT' AND NOT (((SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))=4 AND jsonb_typeof(p_intent->'payload'->'answers')='array' AND jsonb_array_length(p_intent->'payload'->'answers') BETWEEN 1 AND 3 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_intent->'payload'->'answers') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR length(a#>>'{}')>64)) OR ((SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))=5 AND jsonb_typeof(p_intent->'payload'->'start')='object' AND jsonb_typeof(p_intent->'payload'->'end')='object' AND (p_intent->'payload'->'start'-ARRAY['row','column']::TEXT[])='{}'::JSONB AND (p_intent->'payload'->'end'-ARRAY['row','column']::TEXT[])='{}'::JSONB AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['start','end']) endpoint CROSS JOIN unnest(ARRAY['row','column']) coordinate WHERE jsonb_typeof(p_intent->'payload'->endpoint->coordinate) IS DISTINCT FROM 'number' OR p_intent->'payload'->endpoint->>coordinate !~ '^[0-8]$'))) THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF p_intent->>'type' LIKE 'CHALLENGE_%' AND p_intent->>'type' NOT IN ('CHALLENGE_ASSIGN','CHALLENGE_READY','CHALLENGE_MOVE','CHALLENGE_SUBMIT') AND (SELECT count(*) FROM jsonb_object_keys(p_intent->'payload'))<>3 THEN RAISE EXCEPTION 'challenge payload unavailable'; END IF;
  IF member."role"='MEMBER' AND ((p_intent->>'type'='CHALLENGE_READY' AND (p_intent->'payload'->>'participantId' IS DISTINCT FROM 'member:'||actor_uid OR NOT (st."privateState"->'room'->'challenge'->'assignments') @> jsonb_build_object('guide','member:'||actor_uid) AND NOT (st."privateState"->'room'->'challenge'->'assignments') @> jsonb_build_object('mover','member:'||actor_uid) AND NOT (st."privateState"->'room'->'challenge'->'assignments') @> jsonb_build_object('captain','member:'||actor_uid) AND NOT (st."privateState"->'room'->'challenge'->'assignments') @> jsonb_build_object('stealCaptain','member:'||actor_uid))) OR (p_intent->>'type'='CHALLENGE_MOVE' AND st."privateState"->'room'->'challenge'->'assignments'->>'mover' IS DISTINCT FROM 'member:'||actor_uid) OR (p_intent->>'type'='CHALLENGE_SUBMIT' AND (CASE WHEN st."privateState"->'room'->'challenge'->>'stage'='steal' THEN st."privateState"->'room'->'challenge'->'assignments'->>'stealCaptain' ELSE st."privateState"->'room'->'challenge'->'assignments'->>'captain' END) IS DISTINCT FROM 'member:'||actor_uid)) THEN RAISE EXCEPTION 'challenge participant unavailable'; END IF;
  IF p_intent->>'type' LIKE 'CHALLENGE_%' AND NOT (st."privateState"->'room'->'challenge' ? 'paused') AND st."privateState"->'room'->'challenge' ? 'deadlineAt' THEN
   IF jsonb_typeof(st."privateState"->'room'->'challenge'->'deadlineAt') IS DISTINCT FROM 'number' OR st."privateState"->'room'->'challenge'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (st."privateState"->'room'->'challenge'->>'deadlineAt')::NUMERIC>9007199254740991 THEN RAISE EXCEPTION 'challenge deadline unavailable'; END IF;
   IF (st."privateState"->'room'->'challenge'->>'deadlineAt')::NUMERIC<=challenge_now THEN RAISE EXCEPTION 'challenge reconciliation required' USING ERRCODE='P2731'; END IF;
  END IF;
 END IF;
 IF p_intent->>'type'='SET_AUDIENCE_QUESTION_VISIBILITY' THEN
  IF member."role" IS DISTINCT FROM 'OWNER' OR (p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR NOT p_intent ?& ARRAY['type','intentId','expectedRevision','payload'] OR jsonb_typeof(p_intent->'payload') IS DISTINCT FROM 'object' OR (p_intent->'payload'-ARRAY['showQuestion']::TEXT[])<>'{}'::JSONB OR NOT (p_intent->'payload') ? 'showQuestion' OR jsonb_typeof(p_intent->'payload'->'showQuestion') IS DISTINCT FROM 'boolean' OR jsonb_typeof(candidate_next->'config'->'showQuestionOnAudience') IS DISTINCT FROM 'boolean' OR (candidate_next->'config'-'showQuestionOnAudience') IS DISTINCT FROM (st."privateState"->'room'->'config'-'showQuestionOnAudience') OR candidate_next->'config'->'showQuestionOnAudience' IS DISTINCT FROM p_intent->'payload'->'showQuestion' THEN RAISE EXCEPTION 'config mutation mismatch'; END IF;
 ELSIF candidate_next->'config' IS DISTINCT FROM st."privateState"->'room'->'config' THEN RAISE EXCEPTION 'config mutation mismatch'; END IF;
 SELECT * INTO matchrow FROM public."HuroofMatch" WHERE ("namespace","id","roomId")=(p_namespace,st."activeMatchId",p_room) FOR UPDATE;
 IF NOT FOUND OR matchrow."state" NOT IN ('ACTIVE','FINISHED') OR st."privateState"->'room'->'game'->>'lifecycle' IS NULL OR candidate_next->'game'->>'lifecycle' IS NULL THEN RAISE EXCEPTION 'current match unavailable'; END IF;
 IF matchrow."profile"->>'schemaVersion'='huroof-gameplay-profile-v1' AND matchrow."profile"->>'gameKind'='categories' AND NOT EXISTS(SELECT 1 FROM public."HuroofMatchPin" mp WHERE (mp."namespace",mp."matchId")=(matchrow."namespace",matchrow."id") AND (mp."profileRawArtifactId",mp."profileRawArtifactHash")=(matchrow."profileRawArtifactId",matchrow."profileHash") AND mp."config"=matchrow."config" AND (st."privateState"->'room'->'config'-'showQuestionOnAudience')=(matchrow."config"-'showQuestionOnAudience') AND (NOT (st."privateState"->'room'->'config') ? 'showQuestionOnAudience' OR jsonb_typeof(st."privateState"->'room'->'config'->'showQuestionOnAudience')='boolean') AND public.int5b_hash_json(matchrow."config")=matchrow."configHash" AND encode(int4_crypto.digest(matchrow."rawIntent",'sha256'),'hex')=matchrow."rawIntentHash" AND convert_from(matchrow."rawIntent",'UTF8')::JSONB->'request'->'initial'->'config'=matchrow."config" AND convert_from(matchrow."rawIntent",'UTF8')::JSONB->'request'->'initial'->>'configHash'=matchrow."configHash" AND convert_from(matchrow."rawIntent",'UTF8')::JSONB->'resolved'->'config'=matchrow."config" AND convert_from(matchrow."rawIntent",'UTF8')::JSONB->'resolved'->>'configHash'=matchrow."configHash") THEN RAISE EXCEPTION 'category configuration chain unavailable'; END IF;
 IF st."status"='FINISHED' AND (matchrow."state"<>'FINISHED' OR NOT ((p_intent->>'type'='BEGIN_CORRECTION' AND candidate_next->'game'->>'lifecycle'='CORRECTION') OR (p_intent->>'type'='SET_AUDIENCE_QUESTION_VISIBILITY' AND candidate_next->'game'->>'lifecycle'='MATCH_COMPLETE'))) THEN RAISE EXCEPTION 'terminal command unavailable'; END IF;
 IF st."status"='ACTIVE' AND matchrow."state"<>'ACTIVE' THEN RAISE EXCEPTION 'match state mismatch'; END IF;
 IF st."status" NOT IN ('ACTIVE','FINISHED') THEN RAISE EXCEPTION 'current match unavailable'; END IF;
 -- Build private challenge authority from the locked canonical roster and current membership rows.
 IF p_intent->>'type' LIKE 'CHALLENGE_%' OR p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN
  SELECT i."firebaseUid" INTO host_uid FROM public."FirebaseIdentity" i JOIN public."HuroofMember" m ON m."firebaseIdentityId"=i."id" WHERE (m."namespace",m."roomId",m."firebaseIdentityId")=(p_namespace,p_room,room."ownerFirebaseIdentityId") AND m."revokedAt" IS NULL AND m."role"='OWNER' AND i."firebaseProjectId"=project;
  IF NOT FOUND OR host_uid IS NULL OR host_uid='' OR jsonb_typeof(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB)) IS DISTINCT FROM 'array' OR (SELECT count(*) FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB)<>(SELECT count(*) FROM public."HuroofMember" m WHERE (m."namespace",m."roomId")=(p_namespace,p_room) AND m."revokedAt" IS NULL) OR (SELECT count(DISTINCT x.value->>'uid') FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB)<>(SELECT count(*) FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB AND (jsonb_typeof(x.value->'uid') IS DISTINCT FROM 'string' OR x.value->>'role' NOT IN ('host','player','audience') OR (x.value->>'role'='player' AND (x.value->>'team' IS NULL OR x.value->>'team' NOT IN ('horizontal','vertical'))) OR NOT EXISTS(SELECT 1 FROM public."HuroofMember" m JOIN public."FirebaseIdentity" i ON i."id"=m."firebaseIdentityId" WHERE (m."namespace",m."roomId")=(p_namespace,p_room) AND m."revokedAt" IS NULL AND i."firebaseProjectId"=project AND i."firebaseUid"=x.value->>'uid' AND ((x.value->>'role'='host' AND m."role"='OWNER' AND i."firebaseUid"=host_uid) OR (x.value->>'role' IN ('player','audience') AND m."role"='MEMBER'))))) THEN RAISE EXCEPTION 'challenge roster unavailable'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB)))<>(SELECT count(*) FROM public."HuroofParticipant" pp WHERE (pp."namespace",pp."roomId")=(p_namespace,p_room) AND pp."memberFirebaseIdentityId" IS NULL) OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB)))<>(SELECT count(*) FROM jsonb_array_elements(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB))) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB)) x(value) WHERE jsonb_typeof(x.value->'id') IS DISTINCT FROM 'string' OR x.value->>'team' IS NULL OR x.value->>'team' NOT IN ('horizontal','vertical') OR NOT EXISTS(SELECT 1 FROM public."HuroofParticipant" pp WHERE (pp."namespace",pp."roomId",pp."id")=(p_namespace,p_room,x.value->>'id') AND pp."memberFirebaseIdentityId" IS NULL AND pp."team"=x.value->>'team' AND pp."displayName"=x.value->>'displayName')) THEN RAISE EXCEPTION 'challenge roster unavailable'; END IF;
  SELECT COALESCE(jsonb_agg(v),'[]'::JSONB) INTO challenge_people FROM (
   SELECT jsonb_build_object('kind','member','id','member:'||(x.value->>'uid'),'actorUid',x.value->>'uid','team',x.value->>'team') v FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB AND x.value->>'role'='player'
   UNION ALL SELECT jsonb_build_object('kind','manual','id','manual:'||(x.value->>'id'),'controllerUid',host_uid,'team',x.value->>'team') FROM jsonb_array_elements(COALESCE(st."privateState"->'room'->'manualParticipants','[]'::JSONB)) x(value)
  ) participants;
  challenge_context:=jsonb_build_object('hostUid',host_uid,'participants',challenge_people,'assignmentBase',(st."privateState"->'room'->>'activeQuestionOccurrence')||':'||st."revision"::TEXT,'protocolHash',st."privateState"->'room'->'config'->'challenge'->>'protocolVersion','stimulusHash',st."privateState"->'room'->'challenge'->>'definitionHash');
 END IF;
 -- Rejoin immutable definition and derive every bridge-owned state/game/result delta before effects.
 IF p_intent->>'type' LIKE 'CHALLENGE_%' OR p_intent->>'type'='SERVER_CHALLENGE_DEADLINE' THEN
  challenge_definition:=public.pro273_r1_definition(p_namespace,p_room,st."activeMatchId");
  IF NOT public.pro273_r1_nonaward(challenge_definition,st."privateState"->'room'->'challenge',candidate_next->'challenge',p_intent,challenge_context,actor_uid,challenge_now) THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF (candidate_next-ARRAY['revision','challenge','challengeBridge','game']::TEXT[]) IS DISTINCT FROM (st."privateState"->'room'-ARRAY['revision','challenge','challengeBridge','game']::TEXT[]) THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  old_applied:=prior_bridge->'applied';new_applied:=next_bridge->'applied';
  IF (CASE WHEN NOT prior_bridge ? 'appliedEncoding' THEN prior_bridge||jsonb_build_object('appliedEncoding','utf8-hex-v1') ELSE prior_bridge END)-'applied' IS DISTINCT FROM next_bridge-'applied' THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  IF old_applied IS NOT DISTINCT FROM new_applied THEN expected_game:=st."privateState"->'room'->'game';
  ELSE
   next_team:=candidate_next->'challenge'->>'answeringTeam';
   IF next_team NOT IN ('horizontal','vertical') OR next_team IS NULL OR (st."privateState"->'room'->'game'->>'answeringTeam' IS DISTINCT FROM next_team AND (candidate_next->'challenge'->>'attempt' IS DISTINCT FROM 'steal' OR st."privateState"->'room'->'game'->>'answeringTeam' IS DISTINCT FROM st."privateState"->'room'->'challenge'->>'entitledTeam' OR st."privateState"->'room'->'game'->>'attempt' IS DISTINCT FROM 'initial')) THEN RAISE EXCEPTION 'challenge transition unavailable'; END IF;
   IF new_applied->>active_key='award' THEN
    expected_path:=public.pro273_r1_path(candidate_next->'game'->'board',next_team);
    expected_game:=public.pro273_r1_game(st."privateState"->'room'->'game',expected_path,next_team,'award');
   ELSIF new_applied->>active_key='continue' THEN expected_game:=public.pro273_r1_game(st."privateState"->'room'->'game',NULL,next_team,'continue');
   ELSE RAISE EXCEPTION 'challenge transition unavailable'; END IF;
  END IF;
  IF candidate_next->'game' IS DISTINCT FROM expected_game OR NOT public.pro273_r1_semantic(expected_game,p_semantic) THEN RAISE EXCEPTION 'challenge result unavailable'; END IF;
 END IF;
 normalized_next:=candidate_next;
 -- Exact current policy and historical immutable subject are rejoined after room/state locks.
 IF (p_intent->>'type' IN ('SELECT_CELL','LETTER_REVEALED','RETRY_CELL','RETURN_CELL','START_NEXT_ROUND') OR (p_intent->>'type'='CHALLENGE_CONTINUE' AND st."privateState"->'room'->'config'->>'gameKind'='categories' AND st."privateState"->'room'->'challenge'->>'result' IN ('failed','void'))) AND p_custody IS NULL THEN RAISE EXCEPTION 'custody evidence unavailable'; END IF;
 IF p_custody IS NOT NULL THEN PERFORM public.eng03_03_custody_assert(p_namespace,project,p_identity,p_room,p_generation,NULL,matchrow."id",p_policy_revision,p_policy_hash,p_custody); END IF;
 terminal:=normalized_next->'game'->>'lifecycle'='MATCH_COMPLETE';
 IF jsonb_typeof(p_semantic) IS DISTINCT FROM 'object' OR p_semantic->'board' IS DISTINCT FROM normalized_next->'game'->'board' OR p_semantic->'questionScores' IS DISTINCT FROM normalized_next->'game'->'questionScores' OR p_semantic->'roundOutcomeHistory' IS DISTINCT FROM normalized_next->'game'->'roundOutcomeHistory' OR p_semantic->'currentRound' IS DISTINCT FROM normalized_next->'game'->'currentRound' OR p_semantic->'endedWithoutWinner' IS DISTINCT FROM COALESCE(normalized_next->'game'->'endedWithoutWinner','false'::JSONB) THEN RAISE EXCEPTION 'result semantics mismatch'; END IF;
 SELECT * INTO latest FROM public."HuroofMatchResult" WHERE "namespace"=p_namespace AND "matchId"=matchrow."id" ORDER BY "resultVersion" DESC LIMIT 1;
 last_ref:=st."privateState"->'lastResult';
 IF last_ref='null'::JSONB THEN last_ref:=NULL; END IF;
 IF FOUND THEN
  IF jsonb_typeof(last_ref) IS DISTINCT FROM 'object' OR last_ref->>'version' IS DISTINCT FROM latest."resultVersion"::TEXT OR last_ref->>'hash' IS DISTINCT FROM latest."resultHash" THEN RAISE EXCEPTION 'latest result reference mismatch'; END IF;
 ELSE
  IF last_ref IS NOT NULL AND last_ref<>'null'::JSONB THEN RAISE EXCEPTION 'unexpected result reference'; END IF;
 END IF;
 IF st."status"='FINISHED' AND (st."privateState"->'currentResult' IS DISTINCT FROM last_ref OR last_ref IS NULL OR (p_intent->>'type'='BEGIN_CORRECTION' AND EXISTS(SELECT 1 FROM public."HuroofRematchLink" child WHERE child."namespace"=p_namespace AND child."predecessorMatchId"=matchrow."id"))) THEN RAISE EXCEPTION 'correction on superseded result'; END IF;
 changed:=terminal AND (last_ref IS NULL OR st."privateState"->'previousTerminalSemantic' IS DISTINCT FROM p_semantic);
 IF st."status"='FINISHED' AND p_intent->>'type'='SET_AUDIENCE_QUESTION_VISIBILITY' AND changed THEN RAISE EXCEPTION 'terminal result cannot change during visibility command'; END IF;
 event_type:=CASE WHEN changed THEN 'FINISHED' ELSE p_intent->>'type' END;
 next_status:=CASE WHEN terminal THEN 'FINISHED' ELSE 'ACTIVE' END;
 -- Normalize only the two reviewed projection timing paths after nontiming validation and before writes.
 IF challenge_now IS NOT NULL THEN
  time_stamp:=timestamp '1970-01-01 00:00:00'+make_interval(days=>(challenge_now/86400000)::INTEGER,secs=>((challenge_now%86400000)/1000)::DOUBLE PRECISION)+(challenge_now%1000)*interval '1 millisecond';
  year_no:=extract(year FROM time_stamp)::INTEGER;
  time_iso:=CASE WHEN year_no<10000 THEN lpad(year_no::TEXT,4,'0') ELSE '+'||lpad(year_no::TEXT,6,'0') END||to_char(time_stamp,'-MM-DD"T"HH24:MI:SS')||'.'||lpad((challenge_now%1000)::TEXT,3,'0')||'Z';
  deadline_iso:=NULL;
  IF normalized_next->'challenge' ? 'deadlineAt' THEN
   IF jsonb_typeof(normalized_next->'challenge'->'deadlineAt') IS DISTINCT FROM 'number' OR normalized_next->'challenge'->>'deadlineAt' !~ '^(0|[1-9][0-9]{0,15})$' OR (normalized_next->'challenge'->>'deadlineAt')::NUMERIC>8640000000000000 THEN RAISE EXCEPTION 'challenge time unavailable'; END IF;
   deadline_ms:=(normalized_next->'challenge'->>'deadlineAt')::BIGINT;
   time_stamp:=timestamp '1970-01-01 00:00:00'+make_interval(days=>(deadline_ms/86400000)::INTEGER,secs=>((deadline_ms%86400000)/1000)::DOUBLE PRECISION)+(deadline_ms%1000)*interval '1 millisecond';
   year_no:=extract(year FROM time_stamp)::INTEGER;
   deadline_iso:=CASE WHEN year_no<10000 THEN lpad(year_no::TEXT,4,'0') ELSE '+'||lpad(year_no::TEXT,6,'0') END||to_char(time_stamp,'-MM-DD"T"HH24:MI:SS')||'.'||lpad((deadline_ms%1000)::TEXT,3,'0')||'Z';
  END IF;
  closed_room:=CASE jsonb_typeof(normalized_next->'closedAt') WHEN 'boolean' THEN normalized_next->'closedAt'='true'::JSONB WHEN 'number' THEN (normalized_next->>'closedAt')::NUMERIC<>0 WHEN 'string' THEN normalized_next->>'closedAt'<>'' WHEN 'object' THEN true WHEN 'array' THEN true ELSE false END;
  normalized_projections:='[]'::JSONB;
  FOR item IN SELECT value FROM jsonb_array_elements(p_projections) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'uid') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'payload'->'serverTime') IS DISTINCT FROM 'string' OR item->'payload'->>'serverTime' !~ '^(\+[0-9]{6}|[0-9]{4})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' OR jsonb_typeof(item->'payload'->'projection') IS DISTINCT FROM 'object' OR item->'payload'->>'roomId' IS DISTINCT FROM p_room OR item->'payload'->>'revision' IS DISTINCT FROM normalized_next->>'revision' THEN RAISE EXCEPTION 'challenge projection unavailable'; END IF;
   SELECT x.value->>'role',x.value->>'team' INTO projection_role,member_team FROM jsonb_array_elements(p_members) x(value) WHERE x.value->'active'='true'::JSONB AND x.value->>'uid'=item->>'uid';
   IF NOT FOUND OR projection_role NOT IN ('host','player','audience') OR item->'payload'->>'role' IS DISTINCT FROM projection_role THEN RAISE EXCEPTION 'challenge projection unavailable'; END IF;
   expected_recipient:=projection_role;expected_team:=NULL;
   IF projection_role='player' THEN
    expected_recipient:=CASE WHEN normalized_next->'challenge'->'assignments'->>'guide'='member:'||(item->>'uid') THEN 'guide' WHEN normalized_next->'challenge'->'assignments'->>'mover'='member:'||(item->>'uid') THEN 'mover' WHEN normalized_next->'challenge'->'assignments'->>'captain'='member:'||(item->>'uid') THEN 'captain' WHEN normalized_next->'challenge'->'assignments'->>'stealCaptain'='member:'||(item->>'uid') THEN 'stealCaptain' ELSE 'waiting' END;
    IF expected_recipient IN ('guide','mover','captain') THEN expected_team:=normalized_next->'challenge'->>'entitledTeam'; ELSIF expected_recipient='stealCaptain' THEN expected_team:=CASE normalized_next->'challenge'->>'entitledTeam' WHEN 'horizontal' THEN 'vertical' WHEN 'vertical' THEN 'horizontal' ELSE NULL END; END IF;
   END IF;
   expected_challenge:=jsonb_typeof(normalized_next->'challenge')='object' AND normalized_next->'challenge'->'continued' IS DISTINCT FROM 'true'::JSONB AND NOT closed_room AND (projection_role<>'player' OR expected_team IS NULL OR member_team=expected_team);
   proposed_challenge:=item->'payload'->'projection'->'challenge';
   IF expected_challenge THEN
    IF jsonb_typeof(proposed_challenge) IS DISTINCT FROM 'object' OR proposed_challenge->>'recipient' IS DISTINCT FROM expected_recipient OR proposed_challenge->'occurrence' IS DISTINCT FROM normalized_next->'challenge'->'occurrence' OR proposed_challenge->'revision' IS DISTINCT FROM normalized_next->'challenge'->'revision' OR proposed_challenge->'stage' IS DISTINCT FROM normalized_next->'challenge'->'stage' OR proposed_challenge->'assignmentGeneration' IS DISTINCT FROM normalized_next->'challenge'->'assignmentGeneration' OR proposed_challenge->'entitledTeam' IS DISTINCT FROM normalized_next->'challenge'->'entitledTeam' OR proposed_challenge->'answeringTeam' IS DISTINCT FROM normalized_next->'challenge'->'answeringTeam' OR proposed_challenge->'strikes' IS DISTINCT FROM normalized_next->'challenge'->'strikes' OR proposed_challenge->'assignments' IS DISTINCT FROM normalized_next->'challenge'->'assignments' OR proposed_challenge->'attemptsClosed' IS DISTINCT FROM normalized_next->'challenge'->'attemptsClosed' OR proposed_challenge->'solutionRevealed' IS DISTINCT FROM normalized_next->'challenge'->'solutionRevealed' OR proposed_challenge->'result' IS DISTINCT FROM normalized_next->'challenge'->'result' OR proposed_challenge->'disclosureGeneration' IS DISTINCT FROM normalized_next->'challenge'->'disclosureGeneration' OR proposed_challenge->'paused' IS DISTINCT FROM to_jsonb((normalized_next->'challenge') ? 'paused') OR (proposed_challenge ? 'deadlineAt' AND (jsonb_typeof(proposed_challenge->'deadlineAt') IS DISTINCT FROM 'string' OR proposed_challenge->>'deadlineAt' !~ '^(\+[0-9]{6}|[0-9]{4})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$')) THEN RAISE EXCEPTION 'challenge projection unavailable'; END IF;
    IF deadline_iso IS NULL THEN norm_item:=jsonb_set(item,'{payload,projection,challenge}',proposed_challenge-'deadlineAt'); ELSE norm_item:=jsonb_set(item,'{payload,projection,challenge,deadlineAt}',to_jsonb(deadline_iso),true); END IF;
   ELSE
    IF (item->'payload'->'projection') ? 'challenge' THEN RAISE EXCEPTION 'challenge projection unavailable'; END IF; norm_item:=item;
   END IF;
   norm_item:=jsonb_set(norm_item,'{payload,serverTime}',to_jsonb(time_iso));
   IF NOT public.eng03_03_projection_safe(norm_item->'payload',projection_role='host') THEN RAISE EXCEPTION 'challenge projection unavailable'; END IF;
   normalized_projections:=normalized_projections||jsonb_build_array(norm_item);
  END LOOP;
 END IF;
 next_private:=st."privateState"||jsonb_build_object('room',normalized_next,'members',p_members,'currentResult',CASE WHEN terminal AND NOT changed THEN last_ref ELSE 'null'::JSONB END);
 IF jsonb_array_length(normalized_projections)<>(SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."revokedAt" IS NULL) OR (SELECT count(DISTINCT value->>'uid') FROM jsonb_array_elements(normalized_projections))<>jsonb_array_length(normalized_projections) THEN RAISE EXCEPTION 'projection scope mismatch'; END IF;
 seq:=st."sequence"+1; rev:=st."revision"+1;
 event_id:=encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,p_room,p_identity,p_intent->>'intentId')::TEXT,'UTF8'),'sha256'),'hex');
 intent_bytes:=convert_to(p_intent::TEXT,'UTF8'); outcome:=jsonb_build_object('revision',rev,'sequence',seq,'replayed',false); outcome_bytes:=convert_to(outcome::TEXT,'UTF8');
 INSERT INTO public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId","intent","intentHash","outcome","outcomeHash","resultingRevision","resultingSequence") VALUES(p_namespace,p_room,p_identity,p_intent->>'intentId',st."activeMatchId",intent_bytes,encode(int4_crypto.digest(intent_bytes,'sha256'),'hex'),outcome_bytes,encode(int4_crypto.digest(outcome_bytes,'sha256'),'hex'),rev,seq);
 INSERT INTO public."HuroofEvent"("namespace","roomId","sequence","id","matchId","actorFirebaseIdentityId","requestKey","revision","eventType") VALUES(p_namespace,p_room,seq,event_id,st."activeMatchId",p_identity,p_intent->>'intentId',rev,event_type);
 -- The exact receipt/event exists before the match guard validates a terminal reopening.
 IF st."status"='FINISHED' AND p_intent->>'type'='BEGIN_CORRECTION' THEN UPDATE public."HuroofMatch" SET "state"='ACTIVE',"version"="version"+1 WHERE ("namespace","id")=(p_namespace,matchrow."id"); END IF;
 IF terminal AND matchrow."state"='ACTIVE' THEN UPDATE public."HuroofMatch" SET "state"='FINISHED',"version"="version"+1 WHERE ("namespace","id")=(p_namespace,matchrow."id"); END IF;
 IF changed THEN
  result_version:=CASE WHEN last_ref IS NULL THEN 1 ELSE (last_ref->>'version')::BIGINT+1 END;
  result_bytes:=convert_to(p_semantic::TEXT,'UTF8'); result_hash:=encode(int4_crypto.digest(result_bytes,'sha256'),'hex');
  result_id:=encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,matchrow."id",seq,'result')::TEXT,'UTF8'),'sha256'),'hex');
  provenance_bytes:=convert_to(jsonb_build_object('schema','huroof-command-result-v1','namespace',p_namespace,'roomId',p_room,'matchId',matchrow."id",'admissionId',matchrow."admissionId",'eventId',event_id,'revision',rev,'sequence',seq,'intentHash',encode(int4_crypto.digest(intent_bytes,'sha256'),'hex'))::TEXT,'UTF8');
  INSERT INTO public."HuroofRawArtifact"("namespace","id","contentHash","byteLength","mediaType","rawBytes","provenanceBytes","provenanceHash","serialization") VALUES(p_namespace,result_id,result_hash,octet_length(result_bytes),'application/json',result_bytes,provenance_bytes,encode(int4_crypto.digest(provenance_bytes,'sha256'),'hex'),'huroof-command-result-v1');
  INSERT INTO public."HuroofMatchResult"("namespace","matchId","roomId","resultVersion","resultHash","ownerFirebaseIdentityId","admissionId","terminalEventId","terminalSequence","rawArtifactId","previousVersion","previousHash") VALUES(p_namespace,matchrow."id",p_room,result_version,result_hash,room."ownerFirebaseIdentityId",matchrow."admissionId",event_id,seq,result_id,CASE WHEN last_ref IS NULL THEN NULL ELSE (last_ref->>'version')::BIGINT END,CASE WHEN last_ref IS NULL THEN NULL ELSE last_ref->>'hash' END);
  INSERT INTO public."HuroofOwnerHistoryHead"("namespace","ownerFirebaseIdentityId") VALUES(p_namespace,room."ownerFirebaseIdentityId") ON CONFLICT("namespace","ownerFirebaseIdentityId") DO NOTHING;
  PERFORM public.eng03_03_lock_history(p_namespace,room."ownerFirebaseIdentityId");
  SELECT * INTO history FROM public."HuroofOwnerHistoryHead" WHERE ("namespace","ownerFirebaseIdentityId")=(p_namespace,room."ownerFirebaseIdentityId");
  INSERT INTO public."HuroofOwnerHistoryEntry"("namespace","ownerFirebaseIdentityId","sequence","matchId","resultVersion","resultHash","occurredAt","provenance","provenanceHash") VALUES(p_namespace,room."ownerFirebaseIdentityId",history."nextSequence",matchrow."id",result_version,result_hash,clock_timestamp(),provenance_bytes,encode(int4_crypto.digest(provenance_bytes,'sha256'),'hex'));
  PERFORM public.pro311_publish_semantic(public.pro311_archive_metadata(p_namespace,room."ownerFirebaseIdentityId",matchrow."id",result_version),p_semantic,p_policy_revision,p_policy_hash,'validated-pro273-producer','producer-pro273-v1');
  last_ref:=jsonb_build_object('version',result_version,'hash',result_hash);
  next_private:=next_private||jsonb_build_object('lastResult',last_ref,'currentResult',last_ref,'previousTerminalRoom',normalized_next,'previousTerminalSemantic',p_semantic);
 END IF;
 UPDATE public."HuroofCanonicalState" SET "status"=next_status,"revision"=rev,"sequence"=seq,"privateState"=next_private,"updatedAt"=clock_timestamp() WHERE ("namespace","roomId")=(p_namespace,p_room);
 FOR item IN SELECT value FROM jsonb_array_elements(normalized_projections) LOOP
  SELECT i."id" INTO subject_identity FROM public."FirebaseIdentity" i JOIN public."HuroofMember" m ON m."firebaseIdentityId"=i."id" AND m."namespace"=p_namespace AND m."roomId"=p_room AND m."revokedAt" IS NULL WHERE i."firebaseProjectId"=project AND i."firebaseUid"=item->>'uid';
  IF NOT FOUND THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  SELECT x.value->>'role' INTO subject_role FROM jsonb_array_elements(p_members) AS x(value) WHERE x.value->>'uid'=item->>'uid' AND x.value->'active'='true'::JSONB;
  IF NOT FOUND OR subject_role NOT IN ('host','player','audience') OR item->'payload'->>'role' IS DISTINCT FROM subject_role OR item->'payload'->>'revision' IS DISTINCT FROM rev::TEXT OR NOT public.eng03_03_projection_safe(item->'payload',subject_identity=room."ownerFirebaseIdentityId") THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(p_namespace,p_room,CASE WHEN subject_identity=room."ownerFirebaseIdentityId" THEN 'OWNER' ELSE 'MEMBER' END,subject_identity,rev,seq,room."generation",item->'payload') ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 END LOOP;
 INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(p_namespace,p_room,'PUBLIC','public',rev,seq,room."generation",jsonb_build_object('status',normalized_next->'game'->>'lifecycle','revision',rev)) ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 INSERT INTO public."HuroofRealtimeOutbox"("namespace","roomId","sequence","eventId") VALUES(p_namespace,p_room,seq,event_id);
 INSERT INTO public."HuroofOutboxDelivery"("namespace","roomId","sequence") VALUES(p_namespace,p_room,seq);
 RETURN outcome;
END $$;

