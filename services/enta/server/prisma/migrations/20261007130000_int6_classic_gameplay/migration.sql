-- INT-060.E1 SOURCE DRAFT ONLY. Never applied by this task.
-- No role provisioning, seed, receipt activation, GUC approval or native recovery.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ DECLARE gameplay_role_ids OID[]; BEGIN
 -- Discover actual direct/transitive members. pg_has_role treats unrelated
 -- superusers as semantic members, so it cannot select the runtime LOGIN set.
 -- UNION deduplicates visited OIDs and terminates even with cyclic membership.
 WITH RECURSIVE actual_members(oid) AS (
  SELECT oid FROM pg_roles WHERE rolname='enta_gameplay_runtime'
  UNION
  SELECT membership.member FROM pg_auth_members membership JOIN actual_members prior ON membership.roleid=prior.oid
 ) SELECT array_agg(oid) INTO gameplay_role_ids FROM actual_members;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='enta_gameplay_runtime' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole)
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='enta_finance_executor' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole)
 OR pg_has_role('enta_gameplay_runtime','enta_finance_executor','member') THEN
  RAISE EXCEPTION 'audited separate NOLOGIN gameplay/finance roles required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r WHERE r.oid=ANY(gameplay_role_ids) AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication))
 OR EXISTS(SELECT 1 FROM pg_roles writer WHERE writer.rolname IN ('enta_finance_executor','enta_outbox_worker','catalog_assembler','catalog_reviewer','catalog_publisher','catalog_validator','catalog_activator','enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler') AND pg_has_role('enta_gameplay_runtime',writer.oid,'member'))
 OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','int4_crypto') AND (pg_has_role('enta_gameplay_runtime',n.nspowner,'member') OR has_schema_privilege('enta_gameplay_runtime',n.oid,'CREATE')))
 OR EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionEvent','AdmissionOutbox','Game','Team','Player','GameQuestion','GameCategoryPin','CatalogRelease','ActiveCatalogPointer','CatalogValidationReceipt') AND (has_table_privilege('enta_gameplay_runtime',t.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('enta_gameplay_runtime',t.oid,'INSERT,UPDATE'))) THEN
  RAISE EXCEPTION 'gameplay role has effective inherited writer/owner/schema/elevated authority; audit outside migration';
 END IF;
 -- Any eventual LOGIN member must also be audited for effective privileges;
 -- a clean group alone cannot erase authority inherited through another group.
 IF EXISTS(SELECT 1 FROM pg_roles login_role CROSS JOIN pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE login_role.rolcanlogin AND login_role.oid=ANY(gameplay_role_ids) AND n.nspname='public' AND t.relname IN ('Wallet','WalletEntry','Admission','Reservation','AdmissionEvent','AdmissionOutbox','Game','Team','Player','GameQuestion','GameCategoryPin','CatalogRelease','ActiveCatalogPointer','CatalogValidationReceipt') AND (has_table_privilege(login_role.oid,t.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(login_role.oid,t.oid,'INSERT,UPDATE')))
 OR EXISTS(SELECT 1 FROM pg_roles login_role CROSS JOIN pg_roles writer WHERE login_role.rolcanlogin AND login_role.oid=ANY(gameplay_role_ids) AND writer.rolname IN ('enta_finance_executor','enta_outbox_worker','catalog_assembler','catalog_reviewer','catalog_publisher','catalog_validator','catalog_activator','enta_huroof_reserver','enta_huroof_provisioner','enta_huroof_reconciler') AND pg_has_role(login_role.oid,writer.oid,'member'))
 OR EXISTS(SELECT 1 FROM pg_roles login_role CROSS JOIN pg_namespace n WHERE login_role.rolcanlogin AND login_role.oid=ANY(gameplay_role_ids) AND n.nspname IN ('public','int4_crypto') AND (pg_has_role(login_role.oid,n.nspowner,'member') OR has_schema_privilege(login_role.oid,n.oid,'CREATE'))) THEN
  RAISE EXCEPTION 'gameplay LOGIN member is not a minimal runtime; no automatic role remedy';
 END IF;
 IF EXISTS(SELECT 1 FROM public."GameQuestion" q LEFT JOIN public."Team" t ON t."id"=q."answeredByTeamId" WHERE q."answeredByTeamId" IS NOT NULL AND (t."id" IS NULL OR t."gameId"<>q."gameId"))
 OR EXISTS(SELECT 1 FROM public."Game" g LEFT JOIN public."Team" t ON t."id"=g."winnerTeamId" WHERE g."winnerTeamId" IS NOT NULL AND (t."id" IS NULL OR t."gameId"<>g."id")) THEN
  RAISE EXCEPTION 'historical cross-game references require separate review, never auto-repair';
 END IF;
END $$;
ALTER TABLE public."Game" ADD CONSTRAINT "Game_id_firebaseIdentityId_key" UNIQUE("id","firebaseIdentityId");
ALTER TABLE public."Team" ADD CONSTRAINT "Team_gameId_id_key" UNIQUE("gameId","id");
ALTER TABLE public."GameQuestion" ADD CONSTRAINT "GameQuestion_gameId_id_key" UNIQUE("gameId","id");
ALTER TABLE public."GameQuestion" ADD CONSTRAINT "GameQuestion_answer_same_game" FOREIGN KEY("gameId","answeredByTeamId") REFERENCES public."Team"("gameId","id") ON DELETE RESTRICT;
ALTER TABLE public."Game" ADD CONSTRAINT "Game_winner_same_game" FOREIGN KEY("id","winnerTeamId") REFERENCES public."Team"("gameId","id") ON DELETE RESTRICT;
CREATE TABLE public."GameRuntime" (
 "gameId" TEXT PRIMARY KEY REFERENCES public."Game"("id") ON DELETE RESTRICT,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK("version" BETWEEN 1 AND 2000000000),
 "state" TEXT NOT NULL DEFAULT 'BOARD' CHECK("state" IN ('BOARD','QUESTION_OPEN','REVEALED','FINISHED')),
 "setup" JSONB NOT NULL, "setupHash" TEXT NOT NULL CHECK("setupHash"~'^[a-f0-9]{64}$'),
 "teamOrder" TEXT[] NOT NULL CHECK(cardinality("teamOrder") BETWEEN 2 AND 4), "turnIndex" INTEGER NOT NULL DEFAULT 0 CHECK("turnIndex" BETWEEN 0 AND 36),
 "activeQuestionId" TEXT, "activeTeamId" TEXT, "deadlineAt" TIMESTAMPTZ(3),
 "resultReason" TEXT CHECK("resultReason" IS NULL OR "resultReason" IN ('ALL_QUESTIONS_PLAYED','HOST_ENDED')),
 "unplayedCount" INTEGER NOT NULL DEFAULT 0 CHECK("unplayedCount" BETWEEN 0 AND 36),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL,
 FOREIGN KEY("gameId","activeQuestionId") REFERENCES public."GameQuestion"("gameId","id") ON DELETE RESTRICT,
 FOREIGN KEY("gameId","activeTeamId") REFERENCES public."Team"("gameId","id") ON DELETE RESTRICT,
 CHECK(("state" IN ('BOARD','FINISHED') AND "activeQuestionId" IS NULL AND "activeTeamId" IS NULL AND "deadlineAt" IS NULL)
   OR ("state" IN ('QUESTION_OPEN','REVEALED') AND "activeQuestionId" IS NOT NULL AND "activeTeamId" IS NOT NULL AND "deadlineAt" IS NOT NULL)),
 CHECK(("state"='FINISHED' AND "resultReason" IS NOT NULL) OR ("state"<>'FINISHED' AND "resultReason" IS NULL AND "unplayedCount"=0))
);
CREATE TABLE public."GameEvent" (
 "gameId" TEXT NOT NULL, "commandId" TEXT NOT NULL CHECK("commandId"~'^[A-Za-z0-9._:-]{8,128}$'),
 "sequence" INTEGER NOT NULL CHECK("sequence">=1), "actorFirebaseIdentityId" TEXT NOT NULL,
 "type" TEXT NOT NULL CHECK("type" IN ('START','OPEN_QUESTION','REVEAL_ANSWER','ADJUDICATE','FINISH')),
 "intentHash" TEXT NOT NULL CHECK("intentHash"~'^[a-f0-9]{64}$'), "questionId" TEXT, "teamId" TEXT,
 "ruling" TEXT CHECK("ruling" IS NULL OR "ruling" IN ('CORRECT','NO_SCORE')),
 "resultReason" TEXT CHECK("resultReason" IS NULL OR "resultReason" IN ('ALL_QUESTIONS_PLAYED','HOST_ENDED')),
 "unplayedCount" INTEGER CHECK("unplayedCount" IS NULL OR "unplayedCount" BETWEEN 0 AND 36),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("gameId","commandId"), UNIQUE("gameId","sequence"),
 FOREIGN KEY("gameId","actorFirebaseIdentityId") REFERENCES public."Game"("id","firebaseIdentityId") ON DELETE RESTRICT,
 FOREIGN KEY("gameId","questionId") REFERENCES public."GameQuestion"("gameId","id") ON DELETE RESTRICT,
 FOREIGN KEY("gameId","teamId") REFERENCES public."Team"("gameId","id") ON DELETE RESTRICT,
 CHECK(("type" IN ('OPEN_QUESTION','REVEAL_ANSWER','ADJUDICATE') AND "questionId" IS NOT NULL) OR ("type" IN ('START','FINISH') AND "questionId" IS NULL)),
 CHECK(("type"='ADJUDICATE' AND (("ruling"='CORRECT' AND "teamId" IS NOT NULL) OR ("ruling"='NO_SCORE' AND "teamId" IS NULL))) OR ("type"<>'ADJUDICATE' AND "ruling" IS NULL AND "teamId" IS NULL)),
 CHECK(("type"='FINISH' AND "resultReason" IS NOT NULL AND "unplayedCount" IS NOT NULL) OR ("type"<>'FINISH' AND "resultReason" IS NULL AND "unplayedCount" IS NULL))
);
REVOKE ALL ON public."GameRuntime",public."GameEvent" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public."Game",public."Team",public."Player",public."GameQuestion",public."GameCategoryPin" FROM enta_gameplay_runtime;

CREATE FUNCTION public.int6_enta_error(code TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION USING MESSAGE='ENTA_ERROR',DETAIL=code,ERRCODE='P0001'; END $$;
CREATE FUNCTION public.int6_enta_exact_keys(v JSONB,keys TEXT[]) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(v)='object' THEN (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(v) k) IS NOT DISTINCT FROM (SELECT array_agg(k ORDER BY k COLLATE "C") FROM unnest(keys) k) ELSE FALSE END
$$;
-- Fixed accepted schemas have ASCII object keys and only bounded integers.
-- String scalar encoding uses PostgreSQL's JSON encoder, UTF8/NFC payloads.
CREATE FUNCTION public.int6_enta_canonical(v JSONB) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result TEXT; kind TEXT:=jsonb_typeof(v);
BEGIN
 IF kind='object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(k)::TEXT||':'||public.int6_enta_canonical(x),',' ORDER BY k COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v) e(k,x); RETURN result;
 ELSIF kind='array' THEN SELECT '['||COALESCE(string_agg(public.int6_enta_canonical(x),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY e(x,ord); RETURN result;
 ELSIF kind='number' THEN IF (v#>>'{}')::NUMERIC<>trunc((v#>>'{}')::NUMERIC) OR abs((v#>>'{}')::NUMERIC)>9007199254740991 THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN ((v#>>'{}')::BIGINT)::TEXT;
 ELSE RETURN v::TEXT; END IF;
END $$;
CREATE FUNCTION public.int6_enta_hash(v JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT encode(int4_crypto.digest(convert_to(public.int6_enta_canonical(v),'UTF8'),'sha256'),'hex') $$;
CREATE FUNCTION public.int6_enta_valid_text(v JSONB,min_chars INTEGER,max_chars INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(v)='string' AND (SELECT COALESCE(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0) FROM regexp_split_to_table(v#>>'{}','') ch) BETWEEN min_chars AND max_chars AND v#>>'{}'=btrim(normalize(v#>>'{}',NFC),' ') AND v#>>'{}' !~ '[<>]'
 AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(v#>>'{}','') ch WHERE ascii(ch)<32 OR ascii(ch) BETWEEN 127 AND 159 OR ascii(ch) IN (133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279))
$$;
CREATE FUNCTION public.int6_enta_valid_setup(s JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE t JSONB;
BEGIN
 IF NOT public.int6_enta_exact_keys(s,ARRAY['version','categoryKeys','teams','rules']) OR s->'version' IS DISTINCT FROM '2'::JSONB
 OR jsonb_typeof(s->'categoryKeys') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'categoryKeys')<>6
 OR (SELECT count(DISTINCT k) FROM jsonb_array_elements(s->'categoryKeys') k)<>6
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'categoryKeys') k WHERE jsonb_typeof(k)<>'string' OR k#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$')
 OR jsonb_typeof(s->'teams') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'teams') NOT BETWEEN 2 AND 4
 OR NOT public.int6_enta_exact_keys(s->'rules',ARRAY['questionSeconds']) OR NOT public.int5b_json_integer(s->'rules'->'questionSeconds',5,120) THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT translate(t->>'name','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) FROM jsonb_array_elements(s->'teams') t)<>jsonb_array_length(s->'teams') THEN RETURN FALSE; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(s->'teams') x LOOP
  IF NOT public.int6_enta_exact_keys(t,ARRAY['name','players','lifelines']) OR NOT public.int6_enta_valid_text(t->'name',2,22)
  OR jsonb_typeof(t->'players') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'players') NOT BETWEEN 1 AND 8
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(t->'players') p WHERE NOT public.int6_enta_valid_text(p,1,30)) OR t->'lifelines' IS DISTINCT FROM '[]'::JSONB THEN RETURN FALSE; END IF;
 END LOOP; RETURN TRUE;
END $$;
CREATE FUNCTION public.int6_enta_identity(ns TEXT,project TEXT,uid TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT;
BEGIN
 PERFORM 1 FROM public."DeploymentNamespace" WHERE "id"='singleton' AND "namespaceId"=ns AND "firebaseProjectId"=project;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 SELECT "id" INTO identity_id FROM public."FirebaseIdentity" WHERE "firebaseProjectId"=project AND "firebaseUid"=uid;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ACCOUNT_NOT_READY'); END IF;
 RETURN jsonb_build_object('id',identity_id);
END $$;
CREATE FUNCTION public.int6_enta_lock_wallet(ns TEXT,project TEXT,uid TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; w public."Wallet"%ROWTYPE;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ACCOUNT_NOT_READY'); END IF;
 RETURN jsonb_build_object('identityId',identity_id,'available',w."available"::TEXT,'held',w."held"::TEXT,'debt',w."debt"::TEXT);
END $$;
CREATE FUNCTION public.int6_enta_find_start(ns TEXT,project TEXT,uid TEXT,request_key TEXT,logical_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; a public."Admission"%ROWTYPE; game_id TEXT;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF (request_key IS NULL)=(logical_id IS NULL) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND ((request_key IS NOT NULL AND "requestKey"=request_key) OR (logical_id IS NOT NULL AND "engine"='ENTA' AND "logicalMatchId"=logical_id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a."engine"<>'ENTA' OR a."operation"<>'PAID_ENTA_CLASSIC' OR a."requestVersion"<>2 THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF;
 SELECT g."id" INTO game_id FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."admissionId"=a."id" AND g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND a."state"='COMMITTED';
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('gameId',game_id,'requestHash',a."requestHash",'intentHash',a."intentHash");
END $$;

CREATE FUNCTION public.int6_enta_catalog(ns TEXT,project TEXT,uid TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT; pointer public."ActiveCatalogPointer"%ROWTYPE; receipt public."CatalogValidationReceipt"%ROWTYPE; categories JSONB; availability JSONB; sources JSONB;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO pointer FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 SELECT v.* INTO receipt FROM public."CatalogValidationReceipt" v JOIN public."CatalogRelease" r ON r."id"=v."catalogReleaseId" AND r."releaseRootHash"=v."releaseRootHash"
 JOIN public."CatalogReleaseSeal" s ON s."catalogReleaseId"=r."id" AND s."releaseRootHash"=r."releaseRootHash" AND s."sealHash"=v."sealHash"
 WHERE v."id"=pointer."validationReceiptId" AND v."catalogReleaseId"=pointer."catalogReleaseId" AND v."releaseRootHash"=pointer."releaseRootHash" AND r."sealedAt" IS NOT NULL AND v."selectorVersion"='enta-curated-classic-tier-v2';
 IF NOT FOUND THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('key',c."categoryKey",'label',cr."labelAr",'revisionId',cr."id",'questions',(
   SELECT COALESCE(jsonb_agg(jsonb_build_object('revisionId',q."id",'contentHash',q."contentHash",'sourceQuestionId',q."sourceQuestionId",'categoryKey',q."canonicalCategoryKey",'points',q."points",'prompt',q."prompt",'answers',(
     SELECT COALESCE(jsonb_agg(jsonb_build_object('text',answer."text",'isCorrect',answer."isCorrect",'isTrap',answer."isTrap") ORDER BY answer."sortOrder"),'[]'::JSONB) FROM public."QuestionAnswerRevision" answer WHERE answer."questionRevisionId"=q."id" AND answer."questionContentHash"=q."contentHash"
   )) ORDER BY a."tier"::INTEGER,selected.ord),'[]'::JSONB)
   FROM public."CatalogReleaseAvailability" a CROSS JOIN LATERAL unnest(a."freshSelectionIds") WITH ORDINALITY selected(id,ord)
   JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=a."catalogReleaseId" AND m."questionRevisionId"=selected.id AND m."categoryKey"=c."categoryKey"
   JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash" JOIN public."QuestionRevisionSeal" qs ON qs."questionRevisionId"=q."id" AND qs."contentHash"=q."contentHash"
   WHERE a."catalogReleaseId"=pointer."catalogReleaseId" AND a."categoryKey"=c."categoryKey" AND a."engine"='ENTA' AND a."mode"='CLASSIC' AND a."modality"='classic' AND a."tier" IN ('200','400','600') AND a."selectorVersion"=receipt."selectorVersion"
     AND q."engine"='ENTA' AND q."mode"='CLASSIC' AND q."modality"='classic' AND q."tier"=a."tier" AND q."points"=a."tier"::INTEGER AND q."editorialDecision"='APPROVED' AND q."rightsDecision"='CLEARED'
     AND NOT EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" qm WHERE qm."questionRevisionId"=q."id")
  )) ORDER BY c."categoryKey"),'[]'::JSONB) INTO categories
 FROM public."CatalogReleaseCategory" c JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" AND cr."contentHash"=c."categoryContentHash" WHERE c."catalogReleaseId"=pointer."catalogReleaseId" AND cr."editorialDecision"='APPROVED' AND cr."coverMediaRevisionId" IS NULL
 AND (SELECT count(*) FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=c."catalogReleaseId" AND a."categoryKey"=c."categoryKey" AND a."engine"='ENTA' AND a."mode"='CLASSIC' AND a."modality"='classic' AND a."tier" IN ('200','400','600') AND cardinality(a."freshSelectionIds")=2 AND cardinality(a."repeatSelectionIds")=2 AND a."selectorVersion"=receipt."selectorVersion")=3;
 SELECT COALESCE(jsonb_agg(to_jsonb(a)-'id'-'catalogReleaseId'-'createdAt'-'validatedAt'),'[]'::JSONB) INTO availability FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=pointer."catalogReleaseId" AND a."engine"='ENTA' AND a."mode"='CLASSIC' AND a."modality"='classic' AND a."categoryKey" IN (SELECT x->>'key' FROM jsonb_array_elements(categories) x);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('questionRevisionId',q."id",'sourceQuestionId',q."sourceQuestionId",'categoryKey',q."canonicalCategoryKey",'sourceNamespace',q."sourceNamespace",'sourceCategoryId',cw."sourceCategoryId",'sourceQuestionCategoryId',q."sourceCategoryId",'categoryEditorialDecision',cr."editorialDecision",'questionEditorialDecision',q."editorialDecision",'questionRightsDecision',q."rightsDecision",'sourcePoints',q."points",'engine',q."engine",'mode',q."mode",'tier',q."tier",'modality',q."modality",'sourceHasQuestionMedia',EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" media WHERE media."questionRevisionId"=q."id"),'sourceCategoryHasCoverMedia',cr."coverMediaRevisionId" IS NOT NULL)),'[]'::JSONB) INTO sources
 FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash" JOIN public."QuestionRevisionSeal" qs ON qs."questionRevisionId"=q."id" AND qs."contentHash"=q."contentHash"
 JOIN public."SourceCategoryCrosswalkRevision" cw ON cw."id"=q."crosswalkRevisionId" JOIN public."CatalogReleaseCategory" c ON c."catalogReleaseId"=m."catalogReleaseId" AND c."categoryKey"=q."canonicalCategoryKey" JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId"
 WHERE m."catalogReleaseId"=pointer."catalogReleaseId" AND q."engine"='ENTA' AND q."mode"='CLASSIC' AND q."modality"='classic' AND q."canonicalCategoryKey" IN (SELECT x->>'key' FROM jsonb_array_elements(categories) x);
 IF jsonb_array_length(categories)<6 OR jsonb_array_length(categories)>1000 THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('receipt',jsonb_build_object('projectId',project,'identityId',identity_id,'releaseId',pointer."catalogReleaseId",'rootHash',pointer."releaseRootHash",'receiptId',receipt."id",'policyVersion',receipt."policyVersion",'selectorVersion',receipt."selectorVersion",'mode','CLASSIC'),'categories',categories,'availability',availability,'selectorSources',sources);
END $$;

-- This is deliberately unconditional. Replacing it needs a separately reviewed
-- authenticated issuer/receipt-policy migration, never caller labels or GUCs.
CREATE FUNCTION public.int6_enta_assert_receipt(receipt_id TEXT,release_id TEXT,root_hash TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.int6_enta_error('CATALOG_RECEIPT_POLICY_UNAVAILABLE'); END $$;
CREATE FUNCTION public.int6_enta_game_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."Admission"%ROWTYPE;
BEGIN
 IF NEW."gameFormat"<>'FIREBASE_PINNED' OR NEW."userId" IS NOT NULL OR NEW."mode"<>'CLASSIC' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=NEW."admissionId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 IF NOT FOUND OR a."state"<>'HELD' OR a."engine"<>'ENTA' OR a."operation"<>'PAID_ENTA_CLASSIC' OR a."requestVersion"<>2
 OR a."catalogReleaseId" IS DISTINCT FROM NEW."catalogReleaseId" OR a."releaseRootHash" IS DISTINCT FROM NEW."catalogReleaseRootHash" OR a."validationReceiptId" IS DISTINCT FROM NEW."validationReceiptId" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 PERFORM public.int6_enta_assert_receipt(a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash"); RETURN NEW;
END $$;
-- Sole explicitly reviewed successor replacement; original shared function and
-- every UPDATE/GameQuestion/completeness/HUROOF/ledger trigger remain unchanged.
DROP TRIGGER "Game_new_release_pin_guard" ON public."Game";
CREATE TRIGGER "Game_new_release_pin_guard" BEFORE INSERT ON public."Game" FOR EACH ROW EXECUTE FUNCTION public.int6_enta_game_insert_guard();

CREATE FUNCTION public.int6_enta_runtime_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; i INTEGER; names TEXT[];
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW."gameId",NEW."setup",NEW."setupHash",NEW."teamOrder",NEW."createdAt") IS DISTINCT FROM (OLD."gameId",OLD."setup",OLD."setupHash",OLD."teamOrder",OLD."createdAt") OR OLD."state"='FINISHED' OR NEW."version"<>OLD."version"+1 OR NEW."turnIndex"<OLD."turnIndex" OR NEW."turnIndex">OLD."turnIndex"+1 THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO g FROM public."Game" WHERE "id"=NEW."gameId";
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF g."gameFormat"<>'FIREBASE_PINNED' OR g."mode"<>'CLASSIC' OR a."state"<>'HELD' OR a."requestVersion"<>2 OR NEW."version"<>1 OR NEW."state"<>'BOARD' OR NEW."turnIndex"<>0 OR NOT public.int6_enta_valid_setup(NEW."setup") OR NEW."setupHash"<>public.int6_enta_hash(NEW."setup") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF cardinality(NEW."teamOrder")<>(SELECT count(*) FROM public."Team" WHERE "gameId"=g."id") OR (SELECT count(DISTINCT id) FROM unnest(NEW."teamOrder") id)<>cardinality(NEW."teamOrder") OR EXISTS(SELECT 1 FROM unnest(NEW."teamOrder") id WHERE NOT EXISTS(SELECT 1 FROM public."Team" t WHERE t."gameId"=g."id" AND t."id"=id)) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 FOR i IN 1..cardinality(NEW."teamOrder") LOOP
  IF (SELECT "name" FROM public."Team" WHERE "gameId"=g."id" AND "id"=NEW."teamOrder"[i]) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->>'name' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  SELECT array_agg("name" ORDER BY "id") INTO names FROM public."Player" WHERE "teamId"=NEW."teamOrder"[i];
  IF to_jsonb(names) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->'players' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 END LOOP; RETURN NEW;
END $$;
CREATE TRIGGER "GameRuntime_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."GameRuntime" FOR EACH ROW EXECUTE FUNCTION public.int6_enta_runtime_guard();
CREATE TRIGGER "GameEvent_immutable" BEFORE UPDATE OR DELETE ON public."GameEvent" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "GameEvent_no_truncate" BEFORE TRUNCATE ON public."GameEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE FUNCTION public.int6_enta_event_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE r public."GameRuntime"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=NEW."gameId";
 IF NOT FOUND OR NEW."sequence"<>r."version" OR (NEW."type"='START')<>(NEW."sequence"=1) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "GameEvent_sequence_guard" BEFORE INSERT ON public."GameEvent" FOR EACH ROW EXECUTE FUNCTION public.int6_enta_event_guard();
CREATE FUNCTION public.int6_enta_complete_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; a public."Admission"%ROWTYPE; game_id TEXT;
BEGIN
 game_id:=CASE WHEN TG_TABLE_NAME='Game' THEN NEW."id" ELSE NEW."gameId" END;
 SELECT * INTO g FROM public."Game" WHERE "id"=game_id;
 IF g."gameFormat"<>'FIREBASE_PINNED' OR g."mode"<>'CLASSIC' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF NOT FOUND THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF a."engine"<>'ENTA' OR a."operation"<>'PAID_ENTA_CLASSIC' OR a."requestVersion"<>2 THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id";
 IF NOT FOUND OR a."state"<>'COMMITTED' OR r."setupHash"<>public.int6_enta_hash(r."setup") OR (SELECT count(*) FROM public."GameQuestion" WHERE "gameId"=g."id")<>36 OR (SELECT count(*) FROM public."GameCategoryPin" WHERE "gameId"=g."id")<>6
 OR a."intentHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',2,'engine','ENTA','operation','PAID_ENTA_CLASSIC','mode','CLASSIC','logicalMatchId',a."logicalMatchId",'setup',r."setup"))
 OR NOT EXISTS(SELECT 1 FROM public."GameEvent" e WHERE e."gameId"=g."id" AND e."sequence"=1 AND e."type"='START' AND e."actorFirebaseIdentityId"=g."firebaseIdentityId" AND e."commandId"=a."requestKey" AND e."intentHash"=a."intentHash") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF EXISTS(SELECT 1 FROM public."GameCategoryPin" p WHERE p."gameId"=g."id" AND p."categoryKey" IS DISTINCT FROM r."setup"->'categoryKeys'->>p."ordinal") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 -- Existing Game_financial_start_completeness and ledger reconciliation enforce
 -- COMMITTED reservation, RESERVE+COMMIT, six/tier pins and immutable receipts.
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "GameRuntime_complete_start" AFTER INSERT ON public."GameRuntime" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int6_enta_complete_start();
CREATE CONSTRAINT TRIGGER "Game_E1_complete_start" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int6_enta_complete_start();

CREATE FUNCTION public.int6_enta_load(ns TEXT,project TEXT,uid TEXT,game_id TEXT,lock_game BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; teams JSONB; categories JSONB; questions JSONB;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF lock_game THEN
  SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode"='CLASSIC' FOR UPDATE;
 ELSE SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode"='CLASSIC' FOR SHARE; END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF lock_game THEN SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id" FOR UPDATE; ELSE SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id" FOR SHARE; END IF;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 SELECT jsonb_agg(jsonb_build_object('id',t."id",'name',t."name",'score',t."score",'players',r."setup"->'teams'->(o.ord::INTEGER-1)->'players') ORDER BY o.ord) INTO teams FROM unnest(r."teamOrder") WITH ORDINALITY o(id,ord) JOIN public."Team" t ON t."id"=o.id AND t."gameId"=g."id";
 SELECT jsonb_agg(jsonb_build_object('key',p."categoryKey",'label',c."labelAr",'revisionId',p."categoryRevisionId") ORDER BY p."ordinal") INTO categories FROM public."GameCategoryPin" p JOIN public."CanonicalCategoryRevision" c ON c."id"=p."categoryRevisionId" WHERE p."gameId"=g."id";
 SELECT jsonb_agg(jsonb_build_object('id',gq."id",'revisionId',q."id",'contentHash',q."contentHash",'sourceQuestionId',q."sourceQuestionId",'categoryKey',m."categoryKey",'points',q."points",'prompt',q."prompt",'answers',(
  SELECT COALESCE(jsonb_agg(jsonb_build_object('text',a."text",'isCorrect',a."isCorrect",'isTrap',a."isTrap") ORDER BY a."sortOrder"),'[]'::JSONB) FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId"=q."id" AND a."questionContentHash"=q."contentHash"
 ),'isOpened',gq."isOpened",'isCorrect',gq."isCorrect",'answeredByTeamId',gq."answeredByTeamId") ORDER BY p."ordinal",q."points",gq."id") INTO questions
 FROM public."GameQuestion" gq JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=gq."catalogReleaseId" AND m."questionRevisionId"=gq."questionRevisionId" JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash" JOIN public."GameCategoryPin" p ON p."gameId"=g."id" AND p."categoryKey"=m."categoryKey" WHERE gq."gameId"=g."id";
 RETURN jsonb_build_object('id',g."id",'identityId',identity_id,'projectId',project,'hostUid',uid,'admissionId',g."admissionId",'releaseId',g."catalogReleaseId",'releaseRootHash',g."catalogReleaseRootHash",'setup',r."setup",'setupHash',r."setupHash",'version',r."version",'phase',r."state",'turnIndex',r."turnIndex",'activeQuestionId',r."activeQuestionId",'activeTeamId',r."activeTeamId",'deadlineAt',CASE WHEN r."deadlineAt" IS NULL THEN NULL ELSE extract(epoch FROM r."deadlineAt")*1000 END,'resultReason',r."resultReason",'unplayedCount',r."unplayedCount",'teams',teams,'categories',categories,'questions',questions);
END $$;
CREATE FUNCTION public.int6_enta_receipt(ns TEXT,project TEXT,uid TEXT,game_id TEXT,command_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; e public."GameEvent"%ROWTYPE;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 PERFORM 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED';
 IF NOT FOUND THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 SELECT * INTO e FROM public."GameEvent" WHERE "gameId"=game_id AND "commandId"=command_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('commandId',e."commandId",'type',e."type",'sequence',e."sequence",'intentHash',e."intentHash");
END $$;

CREATE FUNCTION public.int6_enta_start(ns TEXT,project TEXT,uid TEXT,p JSONB,receipt_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT; w public."Wallet"%ROWTYPE; a public."Admission"%ROWTYPE; catalog JSONB; receipt JSONB; s JSONB; intent JSONB;
 game_id TEXT:=gen_random_uuid()::TEXT; admission_id TEXT:=gen_random_uuid()::TEXT; reservation_id TEXT:=gen_random_uuid()::TEXT;
 team_ids TEXT[]:=ARRAY[]::TEXT[]; team JSONB; player JSONB; category JSONB; question JSONB; category_key TEXT; team_id TEXT; i INTEGER:=0; j INTEGER; ord INTEGER:=0; moment TIMESTAMPTZ; existing JSONB;
BEGIN
 IF NOT public.int6_enta_exact_keys(p,ARRAY['requestKey','logicalMatchId','setup','setupHash','intentHash','requestHash','requestVersion']) OR p->'requestVersion' IS DISTINCT FROM '2'::JSONB OR jsonb_typeof(p->'requestKey') IS DISTINCT FROM 'string' OR p->>'requestKey'!~'^[A-Za-z0-9._:-]{8,128}$' OR jsonb_typeof(p->'logicalMatchId') IS DISTINCT FROM 'string' OR p->>'logicalMatchId'!~'^[A-Za-z0-9_-]{1,128}$' OR NOT public.int6_enta_valid_setup(p->'setup') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 s:=p->'setup'; intent:=jsonb_build_object('version',2,'engine','ENTA','operation','PAID_ENTA_CLASSIC','mode','CLASSIC','logicalMatchId',p->>'logicalMatchId','setup',s);
 IF p->>'setupHash' IS DISTINCT FROM public.int6_enta_hash(s) OR p->>'intentHash' IS DISTINCT FROM public.int6_enta_hash(intent) OR p->>'requestHash' IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',2,'requestKey',p->>'requestKey','intentHash',p->>'intentHash')) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ACCOUNT_NOT_READY'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND "requestKey"=p->>'requestKey' FOR UPDATE;
 IF FOUND THEN
  IF a."engine"<>'ENTA' OR a."operation"<>'PAID_ENTA_CLASSIC' OR a."requestVersion"<>2 OR a."requestHash"<>p->>'requestHash' OR a."intentHash"<>p->>'intentHash' OR a."state"<>'COMMITTED' THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF;
  SELECT g."id" INTO game_id FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."admissionId"=a."id" AND g."firebaseIdentityId"=identity_id AND r."setupHash"=p->>'setupHash';
  IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF; RETURN jsonb_build_object('gameId',game_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND "engine"='ENTA' AND "logicalMatchId"=p->>'logicalMatchId') THEN PERFORM public.int6_enta_error('LOGICAL_MATCH_ALREADY_CHARGED'); END IF;
 IF w."debt">0 THEN PERFORM public.int6_enta_error('WALLET_DEBT_BLOCKS_START'); END IF;
 IF w."available"<1 THEN PERFORM public.int6_enta_error('INSUFFICIENT_CREDIT'); END IF;
 catalog:=public.int6_enta_catalog(ns,project,uid); receipt:=catalog->'receipt';
 IF receipt->>'receiptId' IS DISTINCT FROM receipt_id THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 PERFORM public.int6_enta_assert_receipt(receipt_id,receipt->>'releaseId',receipt->>'rootHash');
 -- No effect is possible while the separately reviewed SQL issuer is absent.
 moment:=clock_timestamp();
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","state","version","updatedAt") VALUES(admission_id,identity_id,w."id",'ENTA','PAID_ENTA_CLASSIC','CLASSIC',p->>'logicalMatchId',p->>'requestKey',p->>'requestHash',p->>'intentHash',2,receipt->>'releaseId',receipt->>'rootHash',receipt_id,receipt->>'selectorVersion','HELD',0,moment);
 INSERT INTO public."Reservation"("id","admissionId","quantity","state","updatedAt") VALUES(reservation_id,admission_id,1,'HELD',moment);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',admission_id,'RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",identity_id,p->>'requestHash');
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,admission_id,1,'HELD',p->>'requestHash');
 INSERT INTO public."Game"("id","userId","gameFormat","firebaseIdentityId","admissionId","catalogReleaseId","catalogReleaseRootHash","validationReceiptId","mode","status") VALUES(game_id,NULL,'FIREBASE_PINNED',identity_id,admission_id,receipt->>'releaseId',receipt->>'rootHash',receipt_id,'CLASSIC','ACTIVE');
 FOR team IN SELECT x FROM jsonb_array_elements(s->'teams') x LOOP
  team_id:=gen_random_uuid()::TEXT; team_ids:=array_append(team_ids,team_id);
  INSERT INTO public."Team"("id","gameId","name","color","score") VALUES(team_id,game_id,team->>'name',CASE i WHEN 0 THEN '#cc005e' WHEN 1 THEN '#176b66' WHEN 2 THEN '#6543a5' ELSE '#8a4c20' END,0);
  j:=0; FOR player IN SELECT x FROM jsonb_array_elements(team->'players') x LOOP j:=j+1; INSERT INTO public."Player"("id","teamId","name") VALUES(team_id||'-p'||lpad(j::TEXT,2,'0'),team_id,player#>>'{}'); END LOOP; i:=i+1;
 END LOOP;
 FOR category_key IN SELECT x#>>'{}' FROM jsonb_array_elements(s->'categoryKeys') x LOOP
  SELECT x INTO category FROM jsonb_array_elements(catalog->'categories') x WHERE x->>'key'=category_key;
  IF NOT FOUND OR jsonb_array_length(category->'questions')<>6 THEN PERFORM public.int6_enta_error('CATEGORY_UNAVAILABLE'); END IF;
  INSERT INTO public."GameCategoryPin"("id","gameId","catalogReleaseId","categoryKey","categoryRevisionId","ordinal") VALUES(gen_random_uuid()::TEXT,game_id,receipt->>'releaseId',category_key,category->>'revisionId',ord);
  FOR question IN SELECT x FROM jsonb_array_elements(category->'questions') x LOOP INSERT INTO public."GameQuestion"("id","gameId","catalogReleaseId","questionRevisionId","questionId","isOpened","usedVar","alsoCorrectTeamIds") VALUES(gen_random_uuid()::TEXT,game_id,receipt->>'releaseId',question->>'revisionId',NULL,FALSE,FALSE,ARRAY[]::TEXT[]); END LOOP; ord:=ord+1;
 END LOOP;
 INSERT INTO public."GameRuntime"("gameId","version","state","setup","setupHash","teamOrder","turnIndex","updatedAt") VALUES(game_id,1,'BOARD',s,p->>'setupHash',team_ids,0,moment);
 INSERT INTO public."GameEvent"("gameId","commandId","sequence","actorFirebaseIdentityId","type","intentHash") VALUES(game_id,p->>'requestKey',1,identity_id,'START',p->>'intentHash');
 SELECT * INTO w FROM public."Wallet" WHERE "id"=w."id";
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',admission_id,'COMMIT',reservation_id,0,-1,0,w."available",w."held"-1,w."debt",identity_id,p->>'requestHash');
 UPDATE public."Wallet" SET "held"="held"-1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id";
 UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=moment,"updatedAt"=moment WHERE "id"=reservation_id;
 UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=moment WHERE "id"=admission_id;
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,admission_id,2,'COMMITTED',p->>'requestHash');
 RETURN jsonb_build_object('gameId',game_id);
END $$;

CREATE FUNCTION public.int6_enta_command(ns TEXT,project TEXT,uid TEXT,game_id TEXT,c JSONB,intent_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; q public."GameQuestion"%ROWTYPE; old_event public."GameEvent"%ROWTYPE;
 kind TEXT:=c->>'type'; qid TEXT:=c->>'questionId'; tid TEXT:=c->>'teamId'; award INTEGER; remaining INTEGER; finish_reason TEXT; top_score INTEGER; winner_ids TEXT[]; moment TIMESTAMPTZ;
BEGIN
 IF jsonb_typeof(c->'type') IS DISTINCT FROM 'string' OR kind NOT IN ('OPEN_QUESTION','REVEAL_ANSWER','ADJUDICATE','FINISH') OR NOT public.int6_enta_exact_keys(c,CASE kind WHEN 'FINISH' THEN ARRAY['commandId','expectedVersion','type','confirmEarly'] WHEN 'ADJUDICATE' THEN ARRAY['commandId','expectedVersion','type','questionId','ruling','teamId'] ELSE ARRAY['commandId','expectedVersion','type','questionId'] END)
 OR jsonb_typeof(c->'commandId') IS DISTINCT FROM 'string' OR c->>'commandId'!~'^[A-Za-z0-9._:-]{8,128}$' OR NOT public.int5b_json_integer(c->'expectedVersion',1,2000000000) OR intent_hash IS DISTINCT FROM public.int6_enta_hash(c) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind='FINISH' AND jsonb_typeof(c->'confirmEarly') IS DISTINCT FROM 'boolean' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind<>'FINISH' AND (jsonb_typeof(c->'questionId') IS DISTINCT FROM 'string' OR qid!~'^[A-Za-z0-9_-]{1,128}$') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind='ADJUDICATE' AND (jsonb_typeof(c->'ruling') IS DISTINCT FROM 'string' OR c->>'ruling' NOT IN ('CORRECT','NO_SCORE') OR (c->>'ruling'='CORRECT' AND (jsonb_typeof(c->'teamId') IS DISTINCT FROM 'string' OR tid!~'^[A-Za-z0-9_-]{1,128}$')) OR (c->>'ruling'='NO_SCORE' AND c->'teamId' IS DISTINCT FROM 'null'::JSONB)) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode"='CLASSIC' FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id" FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 -- Parent Game then Runtime then Questions then Teams: no wallet/pointer locks.
 IF kind<>'FINISH' THEN
  SELECT * INTO q FROM public."GameQuestion" WHERE "gameId"=g."id" AND "id"=qid FOR UPDATE;
  IF NOT FOUND THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 END IF;
 PERFORM "id" FROM public."Team" WHERE "gameId"=g."id" ORDER BY "id" FOR UPDATE;
 IF kind='ADJUDICATE' AND c->>'ruling'='CORRECT' AND NOT EXISTS(SELECT 1 FROM public."Team" WHERE "gameId"=g."id" AND "id"=tid) THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 SELECT * INTO old_event FROM public."GameEvent" WHERE "gameId"=g."id" AND "commandId"=c->>'commandId';
 IF FOUND THEN
  IF old_event."intentHash"<>intent_hash THEN PERFORM public.int6_enta_error('COMMAND_KEY_CONFLICT'); END IF;
  RETURN jsonb_build_object('commandId',old_event."commandId",'type',old_event."type",'sequence',old_event."sequence",'intentHash',old_event."intentHash");
 END IF;
 IF r."version"<>(c->>'expectedVersion')::INTEGER THEN PERFORM public.int6_enta_error('STALE_VERSION'); END IF;
 IF r."state"='FINISHED' THEN PERFORM public.int6_enta_error('MATCH_FINISHED'); END IF;
 moment:=clock_timestamp(); -- Only after all required locks; lock waiting cannot age a new deadline.
 IF kind='OPEN_QUESTION' THEN
  IF r."state"<>'BOARD' OR q."isOpened" OR q."isCorrect" IS NOT NULL THEN PERFORM public.int6_enta_error('QUESTION_UNAVAILABLE'); END IF;
  UPDATE public."GameQuestion" SET "isOpened"=TRUE WHERE "id"=qid AND "gameId"=g."id";
  UPDATE public."GameRuntime" SET "state"='QUESTION_OPEN',"activeQuestionId"=qid,"activeTeamId"=r."teamOrder"[(r."turnIndex"%cardinality(r."teamOrder"))+1],"deadlineAt"=moment+make_interval(secs=>(r."setup"->'rules'->>'questionSeconds')::INTEGER),"version"="version"+1,"updatedAt"=moment WHERE "gameId"=g."id" AND "version"=r."version";
 ELSIF kind='REVEAL_ANSWER' THEN
  IF r."state"<>'QUESTION_OPEN' OR r."activeQuestionId" IS DISTINCT FROM qid THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF;
  UPDATE public."GameRuntime" SET "state"='REVEALED',"version"="version"+1,"updatedAt"=moment WHERE "gameId"=g."id" AND "version"=r."version";
 ELSIF kind='ADJUDICATE' THEN
  IF r."state"<>'REVEALED' OR r."activeQuestionId" IS DISTINCT FROM qid OR q."isCorrect" IS NOT NULL THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF;
  SELECT qr."points" INTO award FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevision" qr ON qr."id"=m."questionRevisionId" AND qr."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=g."catalogReleaseId" AND m."questionRevisionId"=q."questionRevisionId" AND qr."engine"='ENTA' AND qr."mode"='CLASSIC' AND qr."modality"='classic';
  IF award NOT IN (200,400,600) OR award IS NULL THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
  IF c->>'ruling'='CORRECT' THEN UPDATE public."Team" SET "score"="score"+award WHERE "gameId"=g."id" AND "id"=tid; END IF;
  UPDATE public."GameQuestion" SET "isCorrect"=(c->>'ruling'='CORRECT'),"answeredByTeamId"=tid WHERE "gameId"=g."id" AND "id"=qid;
  UPDATE public."GameRuntime" SET "state"='BOARD',"activeQuestionId"=NULL,"activeTeamId"=NULL,"deadlineAt"=NULL,"turnIndex"="turnIndex"+1,"version"="version"+1,"updatedAt"=moment WHERE "gameId"=g."id" AND "version"=r."version";
 ELSE
  IF r."state"<>'BOARD' OR r."activeQuestionId" IS NOT NULL THEN PERFORM public.int6_enta_error('UNRESOLVED_QUESTION'); END IF;
  SELECT count(*) INTO remaining FROM public."GameQuestion" WHERE "gameId"=g."id" AND "isCorrect" IS NULL;
  IF remaining>0 AND c->'confirmEarly'<>'true'::JSONB THEN PERFORM public.int6_enta_error('EARLY_FINISH_CONFIRMATION_REQUIRED'); END IF;
  finish_reason:=CASE WHEN remaining>0 THEN 'HOST_ENDED' ELSE 'ALL_QUESTIONS_PLAYED' END;
  SELECT max("score") INTO top_score FROM public."Team" WHERE "gameId"=g."id";
  SELECT array_agg("id" ORDER BY "id") INTO winner_ids FROM public."Team" WHERE "gameId"=g."id" AND "score"=top_score;
  UPDATE public."Game" SET "status"='FINISHED',"finishedAt"=moment,"winnerTeamId"=CASE WHEN cardinality(winner_ids)=1 THEN winner_ids[1] ELSE NULL END,"isTie"=(cardinality(winner_ids)>1) WHERE "id"=g."id";
  UPDATE public."GameRuntime" SET "state"='FINISHED',"resultReason"=finish_reason,"unplayedCount"=remaining,"version"="version"+1,"updatedAt"=moment WHERE "gameId"=g."id" AND "version"=r."version";
 END IF;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('STALE_VERSION'); END IF;
 INSERT INTO public."GameEvent"("gameId","commandId","sequence","actorFirebaseIdentityId","type","intentHash","questionId","teamId","ruling","resultReason","unplayedCount") VALUES(g."id",c->>'commandId',r."version"+1,identity_id,kind,qid,tid,CASE WHEN kind='ADJUDICATE' THEN c->>'ruling' ELSE NULL END,finish_reason,remaining);
 RETURN jsonb_build_object('commandId',c->>'commandId','type',kind,'sequence',r."version"+1,'intentHash',intent_hash);
END $$;

-- Dedicated executor only. Callers get EXECUTE on fixed scoped operations, not DML.
GRANT SELECT ON public."DeploymentNamespace",public."FirebaseIdentity",public."Game",public."GameRuntime",public."GameEvent",public."Team",public."Player",public."GameQuestion",public."GameCategoryPin",public."CatalogRelease",public."CatalogReleaseSeal",public."CatalogReleaseCategory",public."CatalogReleaseQuestion",public."CatalogReleaseAvailability",public."CanonicalCategoryRevision",public."QuestionRevision",public."QuestionRevisionSeal",public."QuestionAnswerRevision",public."QuestionRevisionMedia",public."SourceCategoryCrosswalkRevision" TO enta_finance_executor;
GRANT INSERT ON public."Game",public."GameRuntime",public."GameEvent",public."Team",public."Player",public."GameQuestion",public."GameCategoryPin" TO enta_finance_executor;
GRANT UPDATE("status","finishedAt","winnerTeamId","isTie") ON public."Game" TO enta_finance_executor;
GRANT UPDATE("score") ON public."Team" TO enta_finance_executor;
GRANT UPDATE("isOpened","isCorrect","answeredByTeamId") ON public."GameQuestion" TO enta_finance_executor;
GRANT UPDATE("state","version","turnIndex","activeQuestionId","activeTeamId","deadlineAt","resultReason","unplayedCount","updatedAt") ON public."GameRuntime" TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_error(TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_exact_keys(JSONB,TEXT[]) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_canonical(JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_hash(JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_valid_text(JSONB,INTEGER,INTEGER) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_valid_setup(JSONB) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_identity(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_lock_wallet(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_catalog(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_assert_receipt(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_game_insert_guard() OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_runtime_guard() OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_event_guard() OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_complete_start() OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_receipt(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT) OWNER TO enta_finance_executor;
ALTER FUNCTION public.int6_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int6_enta_error(TEXT),public.int6_enta_exact_keys(JSONB,TEXT[]),public.int6_enta_canonical(JSONB),public.int6_enta_hash(JSONB),public.int6_enta_valid_text(JSONB,INTEGER,INTEGER),public.int6_enta_valid_setup(JSONB),public.int6_enta_identity(TEXT,TEXT,TEXT),public.int6_enta_lock_wallet(TEXT,TEXT,TEXT),public.int6_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT),public.int6_enta_catalog(TEXT,TEXT,TEXT),public.int6_enta_assert_receipt(TEXT,TEXT,TEXT),public.int6_enta_game_insert_guard(),public.int6_enta_runtime_guard(),public.int6_enta_event_guard(),public.int6_enta_complete_start(),public.int6_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN),public.int6_enta_receipt(TEXT,TEXT,TEXT,TEXT,TEXT),public.int6_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT),public.int6_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.int6_enta_identity(TEXT,TEXT,TEXT),public.int6_enta_lock_wallet(TEXT,TEXT,TEXT),public.int6_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT),public.int6_enta_catalog(TEXT,TEXT,TEXT),public.int6_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN),public.int6_enta_receipt(TEXT,TEXT,TEXT,TEXT,TEXT),public.int6_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT),public.int6_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) TO enta_gameplay_runtime;
COMMIT;
