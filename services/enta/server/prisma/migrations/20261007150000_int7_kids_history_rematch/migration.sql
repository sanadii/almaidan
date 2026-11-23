-- INT-060.E2 SOURCE ONLY. Unapplied, dual production receipt denial retained.
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
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
-- Mode must be immutable BEFORE the formerly fixed constraint is relaxed.
DO $$ BEGIN IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='Game' AND column_name IN ('createdAt','finishedAt') AND udt_name='timestamp' AND datetime_precision=3)<>2 THEN RAISE EXCEPTION 'Game history requires existing millisecond UTC-convention timestamp columns; no automatic repair'; END IF; END $$;
-- First-launch only: no historical UTC provenance is invented or rewritten.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public."Game" WHERE "gameFormat"='FIREBASE_PINNED') THEN RAISE EXCEPTION 'pre-existing pinned Game timestamps require separately reviewed UTC provenance; preserve rows and stop'; END IF; END $$;
-- Function-local trusted time context; no global/session change or auth GUC.
ALTER FUNCTION public.int6_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT) SET timezone='UTC';
ALTER FUNCTION public.int6_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) SET timezone='UTC';
CREATE FUNCTION public.int7_enta_admission_mode_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW."mode" IS DISTINCT FROM OLD."mode" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW; END $$;
CREATE TRIGGER "Admission_mode_immutable" BEFORE UPDATE ON public."Admission" FOR EACH ROW EXECUTE FUNCTION public.int7_enta_admission_mode_guard();
ALTER TABLE public."Admission" DROP CONSTRAINT "Admission_mode_check", ADD CONSTRAINT "Admission_mode_check" CHECK("mode" IN ('CLASSIC','KIDS'));
ALTER TABLE public."Admission" DROP CONSTRAINT "Admission_engine_branch_check", ADD CONSTRAINT "Admission_engine_branch_check" CHECK (
 ("engine"='ENTA' AND (("mode"='CLASSIC' AND "operation"='PAID_ENTA_CLASSIC') OR ("mode"='KIDS' AND "operation"='PAID_ENTA_KIDS' AND "requestVersion"=3)) AND "catalogReleaseId" IS NOT NULL AND "releaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL
 AND "huroofBinding" IS NULL AND "huroofConfig" IS NULL AND "predecessorAdmissionId" IS NULL AND "huroofCatalogReleaseId" IS NULL AND "huroofCatalogRootHash" IS NULL AND "huroofValidationReceiptId" IS NULL)
 OR ("engine"='HUROOF' AND "mode"='CLASSIC' AND "operation"='HOSTED_HUROOF' AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL AND "validationReceiptId" IS NULL AND "huroofBinding" IS NOT NULL AND "huroofConfig" IS NOT NULL AND "roomProjectId" IS NOT NULL AND "roomId" IS NOT NULL AND "huroofCatalogReleaseId" IS NOT NULL AND "huroofCatalogRootHash" IS NOT NULL AND "huroofValidationReceiptId" IS NOT NULL)
);
ALTER TABLE public."Game" DROP CONSTRAINT "Game_financial_format_check", ADD CONSTRAINT "Game_financial_format_check" CHECK (
 ("gameFormat"='LEGACY' AND "firebaseIdentityId" IS NULL AND "admissionId" IS NULL AND "validationReceiptId" IS NULL AND "catalogReleaseId" IS NULL AND "catalogReleaseRootHash" IS NULL)
 OR ("gameFormat"='FIREBASE_PINNED' AND "userId" IS NULL AND "firebaseIdentityId" IS NOT NULL AND "admissionId" IS NOT NULL AND "catalogReleaseId" IS NOT NULL AND "catalogReleaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL AND "mode" IN ('CLASSIC','KIDS'))
);
CREATE INDEX "Game_enta_owner_history_idx" ON public."Game"("firebaseIdentityId","createdAt","id");
CREATE TABLE public."EntaRematchLink" (
 "childGameId" TEXT PRIMARY KEY, "firebaseIdentityId" TEXT NOT NULL, "predecessorGameId" TEXT NOT NULL, UNIQUE("childGameId","firebaseIdentityId"),
 "predecessorRuntimeVersion" INTEGER NOT NULL CHECK("predecessorRuntimeVersion" BETWEEN 2 AND 2000000000), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 CHECK("childGameId"<>"predecessorGameId"),
 FOREIGN KEY("childGameId","firebaseIdentityId") REFERENCES public."Game"("id","firebaseIdentityId") ON DELETE RESTRICT,
 FOREIGN KEY("predecessorGameId","firebaseIdentityId") REFERENCES public."Game"("id","firebaseIdentityId") ON DELETE RESTRICT,
 FOREIGN KEY("predecessorGameId","predecessorRuntimeVersion") REFERENCES public."GameEvent"("gameId","sequence") ON DELETE RESTRICT
);
CREATE TABLE public."EntaModeReleaseEvidence" (
 "receiptId" TEXT NOT NULL, "mode" TEXT NOT NULL CHECK("mode" IN ('CLASSIC','KIDS')), "catalogReleaseId" TEXT NOT NULL, "releaseRootHash" TEXT NOT NULL,
 "policyVersion" TEXT NOT NULL, "targetCohort" TEXT, "reviewerIdentityId" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL CHECK("evidenceHash"~'^[a-f0-9]{64}$'),
 "kidsSources" JSONB NOT NULL, "kidsProofs" JSONB NOT NULL, "suitabilityManifestHash" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("receiptId","mode"), FOREIGN KEY("receiptId","catalogReleaseId","releaseRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT,
 FOREIGN KEY("reviewerIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT,
 CHECK(jsonb_typeof("kidsSources")='array' AND jsonb_typeof("kidsProofs")='array' AND jsonb_array_length("kidsSources")<=12000 AND jsonb_array_length("kidsProofs")<=3000),
 CHECK(("mode"='CLASSIC' AND "policyVersion"='enta-mode-classic-v1' AND "targetCohort" IS NULL AND "suitabilityManifestHash" IS NULL AND "kidsSources"='[]'::JSONB AND "kidsProofs"='[]'::JSONB) OR ("mode"='KIDS' AND "policyVersion"='enta-kids-suitability-v1' AND "targetCohort" IS NOT NULL AND "suitabilityManifestHash" IS NOT NULL AND "targetCohort"~'^[A-Za-z0-9_-]{1,128}$' AND "suitabilityManifestHash"~'^[a-f0-9]{64}$'))
);
REVOKE ALL ON public."EntaRematchLink",public."EntaModeReleaseEvidence" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
CREATE TRIGGER "EntaRematchLink_immutable" BEFORE UPDATE OR DELETE ON public."EntaRematchLink" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "EntaRematchLink_no_truncate" BEFORE TRUNCATE ON public."EntaRematchLink" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "EntaModeReleaseEvidence_immutable" BEFORE UPDATE OR DELETE ON public."EntaModeReleaseEvidence" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "EntaModeReleaseEvidence_no_truncate" BEFORE TRUNCATE ON public."EntaModeReleaseEvidence" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
-- No INSERT/authoring grant, no issuer or approval API. Production stays denied.
CREATE FUNCTION public.int7_enta_assert_receipt(receipt_id TEXT,release_id TEXT,root_hash TEXT,mode TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.int6_enta_error('CATALOG_RECEIPT_POLICY_UNAVAILABLE'); END $$;
CREATE FUNCTION public.int7_enta_valid_setup(s JSONB,chosen_mode TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE t JSONB; category_count INTEGER:=CASE WHEN chosen_mode='KIDS' THEN 1 ELSE 6 END;
BEGIN
 IF chosen_mode NOT IN ('CLASSIC','KIDS') OR NOT public.int6_enta_exact_keys(s,ARRAY['version','categoryKeys','teams','rules']) OR s->'version' IS DISTINCT FROM '3'::JSONB OR jsonb_typeof(s->'categoryKeys') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'categoryKeys')<>category_count OR (SELECT count(DISTINCT k) FROM jsonb_array_elements(s->'categoryKeys') k)<>category_count
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'categoryKeys') k WHERE jsonb_typeof(k)<>'string' OR k#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$') OR jsonb_typeof(s->'teams') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'teams') NOT BETWEEN 2 AND 4 OR NOT public.int6_enta_exact_keys(s->'rules',ARRAY['questionSeconds']) OR NOT public.int5b_json_integer(s->'rules'->'questionSeconds',5,120) THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT translate(t->>'name','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) FROM jsonb_array_elements(s->'teams') t)<>jsonb_array_length(s->'teams') THEN RETURN FALSE; END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(s->'teams') x LOOP IF NOT public.int6_enta_exact_keys(t,ARRAY['name','players','lifelines']) OR NOT public.int6_enta_valid_text(t->'name',2,22) OR jsonb_typeof(t->'players') IS DISTINCT FROM 'array' OR jsonb_array_length(t->'players') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(t->'players') p WHERE NOT public.int6_enta_valid_text(p,1,30)) OR t->'lifelines' IS DISTINCT FROM '[]'::JSONB THEN RETURN FALSE; END IF; END LOOP; RETURN TRUE;
END $$;
CREATE FUNCTION public.int7_enta_rematch_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE child public."Game"%ROWTYPE; predecessor public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; r public."GameRuntime"%ROWTYPE;
BEGIN
 SELECT * INTO child FROM public."Game" WHERE "id"=NEW."childGameId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 SELECT * INTO predecessor FROM public."Game" WHERE "id"=NEW."predecessorGameId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 SELECT * INTO a FROM public."Admission" WHERE "id"=child."admissionId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=child."id";
 IF child."gameFormat" IS DISTINCT FROM 'FIREBASE_PINNED' OR predecessor."gameFormat" IS DISTINCT FROM 'FIREBASE_PINNED' OR child."mode" IS DISTINCT FROM predecessor."mode" OR predecessor."status" IS DISTINCT FROM 'FINISHED' OR child."status" IS DISTINCT FROM 'ACTIVE' OR a."state" IS DISTINCT FROM 'HELD' OR a."requestVersion" IS DISTINCT FROM 3 OR a."predecessorAdmissionId" IS NOT NULL OR r."state" IS DISTINCT FROM 'BOARD' OR r."version" IS DISTINCT FROM 1
 OR NOT EXISTS(SELECT 1 FROM public."GameEvent" e JOIN public."GameRuntime" pr ON pr."gameId"=e."gameId" WHERE e."gameId"=predecessor."id" AND e."sequence"=NEW."predecessorRuntimeVersion" AND e."type"='FINISH' AND e."actorFirebaseIdentityId"=NEW."firebaseIdentityId" AND pr."state"='FINISHED' AND pr."version"=e."sequence") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "EntaRematchLink_insert_guard" BEFORE INSERT ON public."EntaRematchLink" FOR EACH ROW EXECUTE FUNCTION public.int7_enta_rematch_link_guard();

CREATE FUNCTION public.int7_enta_load(ns TEXT,project TEXT,uid TEXT,game_id TEXT,lock_game BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; teams JSONB; categories JSONB; questions JSONB;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF lock_game THEN
  SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode" IN ('CLASSIC','KIDS') FOR UPDATE;
 ELSE SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode" IN ('CLASSIC','KIDS') FOR SHARE; END IF;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF lock_game THEN SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id" FOR UPDATE; ELSE SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id" FOR SHARE; END IF;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=g."admissionId" AND a."firebaseIdentityId"=identity_id AND a."engine"='ENTA' AND a."state"='COMMITTED' AND a."mode"=g."mode" AND a."operation"=CASE WHEN g."mode"='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END AND a."catalogReleaseId"=g."catalogReleaseId" AND a."releaseRootHash"=g."catalogReleaseRootHash" AND a."validationReceiptId"=g."validationReceiptId" AND ((a."requestVersion"=2 AND g."mode"='CLASSIC' AND public.int6_enta_valid_setup(r."setup")) OR (a."requestVersion"=3 AND public.int7_enta_valid_setup(r."setup",g."mode") AND EXISTS(SELECT 1 FROM public."EntaModeReleaseEvidence" evidence WHERE evidence."receiptId"=a."validationReceiptId" AND evidence."mode"=g."mode" AND evidence."catalogReleaseId"=g."catalogReleaseId" AND evidence."releaseRootHash"=g."catalogReleaseRootHash")))) THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 SELECT jsonb_agg(jsonb_build_object('id',t."id",'name',t."name",'score',t."score",'players',r."setup"->'teams'->(o.ord::INTEGER-1)->'players') ORDER BY o.ord) INTO teams FROM unnest(r."teamOrder") WITH ORDINALITY o(id,ord) JOIN public."Team" t ON t."id"=o.id AND t."gameId"=g."id";
 SELECT jsonb_agg(jsonb_build_object('key',p."categoryKey",'label',c."labelAr",'revisionId',p."categoryRevisionId") ORDER BY p."ordinal") INTO categories FROM public."GameCategoryPin" p JOIN public."CanonicalCategoryRevision" c ON c."id"=p."categoryRevisionId" WHERE p."gameId"=g."id";
 SELECT jsonb_agg(jsonb_build_object('id',gq."id",'revisionId',q."id",'contentHash',q."contentHash",'sourceQuestionId',q."sourceQuestionId",'categoryKey',m."categoryKey",'points',q."points",'prompt',q."prompt",'answers',(
  SELECT COALESCE(jsonb_agg(jsonb_build_object('text',a."text",'isCorrect',a."isCorrect",'isTrap',a."isTrap") ORDER BY a."sortOrder"),'[]'::JSONB) FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId"=q."id" AND a."questionContentHash"=q."contentHash"
 ),'isOpened',gq."isOpened",'isCorrect',gq."isCorrect",'answeredByTeamId',gq."answeredByTeamId") ORDER BY p."ordinal",q."points",gq."id") INTO questions
 FROM public."GameQuestion" gq JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=gq."catalogReleaseId" AND m."questionRevisionId"=gq."questionRevisionId" JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" AND q."contentHash"=m."questionContentHash" JOIN public."GameCategoryPin" p ON p."gameId"=g."id" AND p."categoryKey"=m."categoryKey" WHERE gq."gameId"=g."id";
 RETURN jsonb_build_object('mode',g."mode",'createdAt',to_char(g."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN g."finishedAt" IS NULL THEN NULL ELSE to_char(g."finishedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'id',g."id",'identityId',identity_id,'projectId',project,'hostUid',uid,'admissionId',g."admissionId",'releaseId',g."catalogReleaseId",'releaseRootHash',g."catalogReleaseRootHash",'setup',r."setup",'setupHash',r."setupHash",'version',r."version",'phase',r."state",'turnIndex',r."turnIndex",'activeQuestionId',r."activeQuestionId",'activeTeamId',r."activeTeamId",'deadlineAt',CASE WHEN r."deadlineAt" IS NULL THEN NULL ELSE extract(epoch FROM r."deadlineAt")*1000 END,'resultReason',r."resultReason",'unplayedCount',r."unplayedCount",'teams',teams,'categories',categories,'questions',questions);
END $$;
CREATE FUNCTION public.int7_enta_command(ns TEXT,project TEXT,uid TEXT,game_id TEXT,c JSONB,intent_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; q public."GameQuestion"%ROWTYPE; old_event public."GameEvent"%ROWTYPE;
 kind TEXT:=c->>'type'; qid TEXT:=c->>'questionId'; tid TEXT:=c->>'teamId'; award INTEGER; remaining INTEGER; finish_reason TEXT; top_score INTEGER; winner_ids TEXT[]; moment TIMESTAMPTZ;
BEGIN
 IF jsonb_typeof(c->'type') IS DISTINCT FROM 'string' OR kind NOT IN ('OPEN_QUESTION','REVEAL_ANSWER','ADJUDICATE','FINISH') OR NOT public.int6_enta_exact_keys(c,CASE kind WHEN 'FINISH' THEN ARRAY['commandId','expectedVersion','type','confirmEarly'] WHEN 'ADJUDICATE' THEN ARRAY['commandId','expectedVersion','type','questionId','ruling','teamId'] ELSE ARRAY['commandId','expectedVersion','type','questionId'] END)
 OR jsonb_typeof(c->'commandId') IS DISTINCT FROM 'string' OR c->>'commandId'!~'^[A-Za-z0-9._:-]{8,128}$' OR NOT public.int5b_json_integer(c->'expectedVersion',1,2000000000) OR intent_hash IS DISTINCT FROM public.int6_enta_hash(c) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind='FINISH' AND jsonb_typeof(c->'confirmEarly') IS DISTINCT FROM 'boolean' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind<>'FINISH' AND (jsonb_typeof(c->'questionId') IS DISTINCT FROM 'string' OR qid!~'^[A-Za-z0-9_-]{1,128}$') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF kind='ADJUDICATE' AND (jsonb_typeof(c->'ruling') IS DISTINCT FROM 'string' OR c->>'ruling' NOT IN ('CORRECT','NO_SCORE') OR (c->>'ruling'='CORRECT' AND (jsonb_typeof(c->'teamId') IS DISTINCT FROM 'string' OR tid!~'^[A-Za-z0-9_-]{1,128}$')) OR (c->>'ruling'='NO_SCORE' AND c->'teamId' IS DISTINCT FROM 'null'::JSONB)) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode" IN ('CLASSIC','KIDS') FOR UPDATE;
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
  SELECT qr."points" INTO award FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevision" qr ON qr."id"=m."questionRevisionId" AND qr."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=g."catalogReleaseId" AND m."questionRevisionId"=q."questionRevisionId" AND qr."engine"='ENTA' AND qr."mode" IN ('CLASSIC','KIDS') AND qr."modality"='classic';
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
CREATE FUNCTION public.int7_enta_find_start(ns TEXT,project TEXT,uid TEXT,request_key TEXT,logical_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; a public."Admission"%ROWTYPE; game_id TEXT;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF (request_key IS NULL)=(logical_id IS NULL) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND ((request_key IS NOT NULL AND "requestKey"=request_key) OR (logical_id IS NOT NULL AND "engine"='ENTA' AND "logicalMatchId"=logical_id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a."engine"<>'ENTA' OR a."requestVersion" NOT IN (2,3) OR NOT ((a."mode"='CLASSIC' AND a."operation"='PAID_ENTA_CLASSIC') OR (a."mode"='KIDS' AND a."operation"='PAID_ENTA_KIDS' AND a."requestVersion"=3)) THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF;
 SELECT g."id" INTO game_id FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."admissionId"=a."id" AND g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND a."state"='COMMITTED';
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('gameId',game_id,'requestHash',a."requestHash",'intentHash',a."intentHash");
END $$;
CREATE OR REPLACE FUNCTION public.int6_enta_runtime_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; i INTEGER; names TEXT[];
BEGIN
 IF TG_OP='DELETE' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW."gameId",NEW."setup",NEW."setupHash",NEW."teamOrder",NEW."createdAt") IS DISTINCT FROM (OLD."gameId",OLD."setup",OLD."setupHash",OLD."teamOrder",OLD."createdAt") OR OLD."state"='FINISHED' OR NEW."version"<>OLD."version"+1 OR NEW."turnIndex"<OLD."turnIndex" OR NEW."turnIndex">OLD."turnIndex"+1 THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO g FROM public."Game" WHERE "id"=NEW."gameId";
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF g."gameFormat"<>'FIREBASE_PINNED' OR g."mode" NOT IN ('CLASSIC','KIDS') OR a."mode" IS DISTINCT FROM g."mode" OR a."state"<>'HELD' OR a."requestVersion" NOT IN (2,3) OR NEW."version"<>1 OR NEW."state"<>'BOARD' OR NEW."turnIndex"<>0 OR NOT (CASE WHEN a."requestVersion"=2 THEN g."mode"='CLASSIC' AND public.int6_enta_valid_setup(NEW."setup") ELSE public.int7_enta_valid_setup(NEW."setup",g."mode") END) OR NEW."setupHash"<>public.int6_enta_hash(NEW."setup") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF cardinality(NEW."teamOrder")<>(SELECT count(*) FROM public."Team" WHERE "gameId"=g."id") OR (SELECT count(DISTINCT id) FROM unnest(NEW."teamOrder") id)<>cardinality(NEW."teamOrder") OR EXISTS(SELECT 1 FROM unnest(NEW."teamOrder") id WHERE NOT EXISTS(SELECT 1 FROM public."Team" t WHERE t."gameId"=g."id" AND t."id"=id)) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 FOR i IN 1..cardinality(NEW."teamOrder") LOOP
  IF (SELECT "name" FROM public."Team" WHERE "gameId"=g."id" AND "id"=NEW."teamOrder"[i]) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->>'name' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  SELECT array_agg("name" ORDER BY "id") INTO names FROM public."Player" WHERE "teamId"=NEW."teamOrder"[i];
  IF to_jsonb(names) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->'players' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 END LOOP; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.int6_enta_game_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."Admission"%ROWTYPE;
BEGIN
 IF NEW."gameFormat"<>'FIREBASE_PINNED' OR NEW."userId" IS NOT NULL OR NEW."mode" NOT IN ('CLASSIC','KIDS') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=NEW."admissionId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 IF NOT FOUND OR a."state"<>'HELD' OR a."engine"<>'ENTA' OR a."mode" IS DISTINCT FROM NEW."mode" OR a."operation" IS DISTINCT FROM (CASE WHEN NEW."mode"='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END) OR a."requestVersion" NOT IN (2,3) OR (a."requestVersion"=2 AND NEW."mode"<>'CLASSIC')
 OR a."catalogReleaseId" IS DISTINCT FROM NEW."catalogReleaseId" OR a."releaseRootHash" IS DISTINCT FROM NEW."catalogReleaseRootHash" OR a."validationReceiptId" IS DISTINCT FROM NEW."validationReceiptId" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF a."requestVersion"=2 THEN PERFORM public.int6_enta_assert_receipt(a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash"); ELSE PERFORM public.int7_enta_assert_receipt(a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash",a."mode"); END IF; RETURN NEW;
END $$;
DROP TRIGGER "Game_financial_start_completeness" ON public."Game";
CREATE CONSTRAINT TRIGGER "Game_financial_start_completeness" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."mode" IS DISTINCT FROM 'KIDS') EXECUTE FUNCTION public.int5a_game_start_completeness();
CREATE FUNCTION public.int7_enta_kids_financial_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; reservation_state TEXT; pin_count INTEGER; q_count INTEGER;
BEGIN
 SELECT * INTO g FROM public."Game" WHERE "id"=NEW."id";
 IF g."gameFormat"<>'FIREBASE_PINNED' OR g."mode"<>'KIDS' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF NOT FOUND OR a."state"<>'COMMITTED' OR a."operation"<>'PAID_ENTA_KIDS' OR a."catalogReleaseId"<>g."catalogReleaseId" OR a."releaseRootHash"<>g."catalogReleaseRootHash" OR a."validationReceiptId"<>g."validationReceiptId" THEN
  RAISE EXCEPTION 'new game requires same-owner committed admission and exact pins';
 END IF;
 SELECT r."state" INTO reservation_state FROM public."Reservation" r WHERE r."admissionId"=a."id";
 IF reservation_state IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" e JOIN public."Reservation" r ON r."id"=e."reservationId" WHERE r."admissionId"=a."id" AND e."effect"='RESERVE') OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" e JOIN public."Reservation" r ON r."id"=e."reservationId" WHERE r."admissionId"=a."id" AND e."effect"='COMMIT') THEN
  RAISE EXCEPTION 'committed start requires matching reservation and ledger effects';
 END IF;
 IF EXISTS(SELECT 1 FROM public."GameCategory" WHERE "gameId"=g."id") THEN RAISE EXCEPTION 'pinned game cannot contain legacy category rows'; END IF;
 SELECT count(*) INTO pin_count FROM public."GameCategoryPin" WHERE "gameId"=g."id";
 IF pin_count<>1 OR EXISTS(SELECT 1 FROM generate_series(0,pin_count-1) n WHERE NOT EXISTS(SELECT 1 FROM public."GameCategoryPin" p WHERE p."gameId"=g."id" AND p."ordinal"=n)) THEN RAISE EXCEPTION 'ordered category pins must be complete'; END IF;
 IF (SELECT count(*) FROM public."Team" WHERE "gameId"=g."id")<2 THEN RAISE EXCEPTION 'pinned game needs at least two teams'; END IF;
 SELECT count(*) INTO q_count FROM public."GameQuestion" WHERE "gameId"=g."id" AND "catalogReleaseId"=g."catalogReleaseId";
 IF q_count<>pin_count*6 THEN RAISE EXCEPTION 'CLASSIC game requires six pinned questions per category'; END IF;
 IF EXISTS (SELECT 1 FROM public."GameCategoryPin" p CROSS JOIN (VALUES ('200'),('400'),('600')) t(tier)
   WHERE p."gameId"=g."id" AND NOT EXISTS (SELECT 1 FROM public."CatalogReleaseAvailability" availability_row WHERE availability_row."catalogReleaseId"=g."catalogReleaseId" AND availability_row."categoryKey"=p."categoryKey" AND availability_row."engine"='ENTA' AND availability_row."mode"='KIDS' AND availability_row."modality"='classic' AND availability_row."tier"=t.tier)) THEN
  RAISE EXCEPTION 'release must seal all three supported CLASSIC availability tiers per category';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public."GameCategoryPin" p CROSS JOIN (VALUES ('200',200),('400',400),('600',600)) t(tier,points)
   LEFT JOIN LATERAL (SELECT count(*) n, count(DISTINCT q."sourceQuestionId") sources,
     count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" m WHERE m."questionRevisionId"=q."id")) media_count
     FROM public."GameQuestion" gq JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=gq."catalogReleaseId" AND m."questionRevisionId"=gq."questionRevisionId" AND m."categoryKey"=p."categoryKey"
     JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId"
     WHERE gq."gameId"=g."id" AND q."engine"='ENTA' AND q."mode"='KIDS' AND q."modality"='classic' AND q."tier"=t.tier AND q."points"=t.points) selected ON TRUE
   WHERE p."gameId"=g."id" GROUP BY p."categoryKey",t.tier HAVING max(selected.n)<>2 OR max(selected.sources)<>2 OR max(selected.media_count)<>0
 ) THEN RAISE EXCEPTION 'CLASSIC pins require exact two-per-tier unique-source text-only supply'; END IF;
 IF EXISTS (SELECT 1 FROM public."GameCategoryPin" p LEFT JOIN public."GameQuestion" gq ON gq."gameId"=g."id" AND gq."catalogReleaseId"=g."catalogReleaseId"
   LEFT JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=gq."catalogReleaseId" AND m."questionRevisionId"=gq."questionRevisionId" AND m."categoryKey"=p."categoryKey"
   LEFT JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId"
   WHERE p."gameId"=g."id" GROUP BY p."categoryKey" HAVING count(DISTINCT q."sourceQuestionId")<>6) THEN
  RAISE EXCEPTION 'CLASSIC board cannot reuse source question identity across tiers';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Game_kids_financial_completeness" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."mode"='KIDS') EXECUTE FUNCTION public.int7_enta_kids_financial_complete();
CREATE FUNCTION public.int7_enta_kids_selection(sources JSONB,category_key TEXT,tier INTEGER,seed BIGINT,cohort TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE ids JSONB;
BEGIN
 IF seed<0 OR seed>4294967295 OR tier NOT IN (200,400,600) OR (SELECT count(*) FROM jsonb_array_elements(sources) s WHERE s->>'categoryKey'=category_key AND (s->>'points')::INTEGER=tier)<4 THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 SELECT jsonb_agg(id ORDER BY rank,id COLLATE "C") INTO ids FROM (SELECT s->>'revisionId' id,public.int6_enta_hash(jsonb_build_object('selector','enta-reviewed-kids-tier-v1','seed',seed,'id',s->>'revisionId')) rank FROM jsonb_array_elements(sources) s WHERE s->>'categoryKey'=category_key AND (s->>'points')::INTEGER=tier ORDER BY rank COLLATE "C",id COLLATE "C" LIMIT 2) chosen;
 RETURN jsonb_build_object('seed',seed,'ids',ids,'hash',public.int6_enta_hash(jsonb_build_object('selector','enta-reviewed-kids-tier-v1','targetCohort',cohort,'categoryKey',category_key,'points',tier,'seed',seed,'ids',ids)));
END $$;

CREATE FUNCTION public.int7_enta_catalog(ns TEXT,project TEXT,uid TEXT,chosen_mode TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT; pointer public."ActiveCatalogPointer"%ROWTYPE; proof public."EntaModeReleaseEvidence"%ROWTYPE; old_catalog JSONB; categories JSONB; item JSONB; category_key TEXT; tier INTEGER; fresh JSONB; repeat JSONB; count_categories INTEGER;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF chosen_mode NOT IN ('CLASSIC','KIDS') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO pointer FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 SELECT evidence.* INTO proof FROM public."EntaModeReleaseEvidence" evidence JOIN public."CatalogValidationReceipt" receipt ON receipt."id"=evidence."receiptId" AND receipt."catalogReleaseId"=evidence."catalogReleaseId" AND receipt."releaseRootHash"=evidence."releaseRootHash"
 JOIN public."CatalogReleaseSeal" seal ON seal."catalogReleaseId"=receipt."catalogReleaseId" AND seal."releaseRootHash"=receipt."releaseRootHash" AND seal."sealHash"=receipt."sealHash"
 JOIN public."CatalogRelease" release ON release."id"=seal."catalogReleaseId" AND release."releaseRootHash"=seal."releaseRootHash"
 WHERE evidence."receiptId"=pointer."validationReceiptId" AND evidence."catalogReleaseId"=pointer."catalogReleaseId" AND evidence."releaseRootHash"=pointer."releaseRootHash" AND evidence."mode"=chosen_mode AND release."sealedAt" IS NOT NULL;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 IF chosen_mode='CLASSIC' THEN
  IF proof."policyVersion"<>'enta-mode-classic-v1' THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  old_catalog:=public.int6_enta_catalog(ns,project,uid); categories:=old_catalog->'categories';
 ELSE
  IF proof."policyVersion"<>'enta-kids-suitability-v1' OR proof."targetCohort" IS NULL OR proof."suitabilityManifestHash" IS DISTINCT FROM public.int6_enta_hash(proof."kidsSources") OR jsonb_array_length(proof."kidsSources")=0 OR jsonb_array_length(proof."kidsSources")>12000 OR jsonb_array_length(proof."kidsProofs")>3000 THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  FOR item IN SELECT x FROM jsonb_array_elements(proof."kidsSources") x LOOP
   IF NOT public.int6_enta_exact_keys(item,ARRAY['revisionId','contentHash','sourceQuestionId','categoryKey','points','engine','mode','modality','editorialDecision','rightsDecision','sourceNamespace','suitability']) OR item->>'engine' IS DISTINCT FROM 'ENTA' OR item->>'mode' IS DISTINCT FROM 'KIDS' OR item->>'modality' IS DISTINCT FROM 'classic' OR item->>'sourceNamespace' IS DISTINCT FROM 'enta.question' OR item->>'editorialDecision' IS DISTINCT FROM 'APPROVED' OR item->>'rightsDecision' IS DISTINCT FROM 'CLEARED'
   OR NOT public.int6_enta_exact_keys(item->'suitability',ARRAY['policyVersion','targetCohort','reviewerIdentityId','evidenceHash','decision']) OR item->'suitability'->>'policyVersion' IS DISTINCT FROM proof."policyVersion" OR item->'suitability'->>'targetCohort' IS DISTINCT FROM proof."targetCohort" OR item->'suitability'->>'reviewerIdentityId' IS DISTINCT FROM proof."reviewerIdentityId" OR jsonb_typeof(item->'suitability'->'evidenceHash') IS DISTINCT FROM 'string' OR item->'suitability'->>'evidenceHash'!~'^[a-f0-9]{64}$' OR item->'suitability'->>'decision' IS DISTINCT FROM 'APPROVED'
   OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" membership JOIN public."QuestionRevision" q ON q."id"=membership."questionRevisionId" AND q."contentHash"=membership."questionContentHash" JOIN public."QuestionRevisionSeal" qs ON qs."questionRevisionId"=q."id" AND qs."contentHash"=q."contentHash" JOIN public."CatalogReleaseCategory" c ON c."catalogReleaseId"=membership."catalogReleaseId" AND c."categoryKey"=membership."categoryKey" JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" AND cr."contentHash"=c."categoryContentHash"
    WHERE membership."catalogReleaseId"=pointer."catalogReleaseId" AND q."id"=item->>'revisionId' AND q."contentHash"=item->>'contentHash' AND q."sourceQuestionId"=item->>'sourceQuestionId' AND membership."categoryKey"=item->>'categoryKey' AND q."engine"='ENTA' AND q."mode"='KIDS' AND q."modality"='classic' AND q."sourceNamespace"='enta.question' AND q."points"=(item->>'points')::INTEGER AND q."points" IN (200,400,600) AND q."tier"=item->>'points' AND q."editorialDecision"='APPROVED' AND q."rightsDecision"='CLEARED' AND cr."editorialDecision"='APPROVED' AND cr."coverMediaRevisionId" IS NULL AND NOT EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" media WHERE media."questionRevisionId"=q."id")) THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  END LOOP;
  IF (SELECT count(DISTINCT item->>'revisionId') FROM jsonb_array_elements(proof."kidsSources") item)<>jsonb_array_length(proof."kidsSources") OR (SELECT count(DISTINCT (item->>'categoryKey',item->>'sourceQuestionId')) FROM jsonb_array_elements(proof."kidsSources") item)<>jsonb_array_length(proof."kidsSources") THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  SELECT count(DISTINCT x->>'categoryKey') INTO count_categories FROM jsonb_array_elements(proof."kidsSources") x;
  IF count_categories NOT BETWEEN 1 AND 1000 OR jsonb_array_length(proof."kidsProofs")<>count_categories*3 THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  FOR category_key IN SELECT DISTINCT x->>'categoryKey' FROM jsonb_array_elements(proof."kidsSources") x LOOP FOR tier IN SELECT x FROM unnest(ARRAY[200,400,600]) x LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(proof."kidsProofs") x WHERE x->>'categoryKey'=category_key AND (x->>'tier')::INTEGER=tier)<>1 THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
   SELECT x INTO item FROM jsonb_array_elements(proof."kidsProofs") x WHERE x->>'categoryKey'=category_key AND (x->>'tier')::INTEGER=tier;
   IF NOT public.int6_enta_exact_keys(item,ARRAY['categoryKey','tier','selectorVersion','fresh','repeat','manifestHash']) OR item->>'selectorVersion' IS DISTINCT FROM 'enta-reviewed-kids-tier-v1' OR NOT public.int6_enta_exact_keys(item->'fresh',ARRAY['seed','ids','hash']) OR NOT public.int6_enta_exact_keys(item->'repeat',ARRAY['seed','ids','hash']) OR NOT public.int5b_json_integer(item->'fresh'->'seed',0,4294967295) OR NOT public.int5b_json_integer(item->'repeat'->'seed',0,4294967295) THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
   fresh:=public.int7_enta_kids_selection(proof."kidsSources",category_key,tier,(item->'fresh'->>'seed')::BIGINT,proof."targetCohort"); repeat:=public.int7_enta_kids_selection(proof."kidsSources",category_key,tier,(item->'repeat'->>'seed')::BIGINT,proof."targetCohort");
   IF item->'fresh' IS DISTINCT FROM fresh OR item->'repeat' IS DISTINCT FROM repeat OR item->>'manifestHash' IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('selector','enta-reviewed-kids-tier-v1','targetCohort',proof."targetCohort",'categoryKey',category_key,'tier',tier,'fresh',fresh,'repeat',repeat)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(fresh->'ids') f JOIN jsonb_array_elements_text(repeat->'ids') r ON f.value=r.value) THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
  END LOOP; END LOOP;
  SELECT jsonb_agg(jsonb_build_object('key',c."categoryKey",'label',cr."labelAr",'revisionId',cr."id",'questions',(
   SELECT jsonb_agg(jsonb_build_object('revisionId',q."id",'contentHash',q."contentHash",'sourceQuestionId',q."sourceQuestionId",'categoryKey',q."canonicalCategoryKey",'points',q."points",'prompt',q."prompt",'answers',(SELECT jsonb_agg(jsonb_build_object('text',a."text",'isCorrect',a."isCorrect",'isTrap',a."isTrap") ORDER BY a."sortOrder") FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId"=q."id" AND a."questionContentHash"=q."contentHash")) ORDER BY (p->>'tier')::INTEGER,selection.ord)
   FROM jsonb_array_elements(proof."kidsProofs") p CROSS JOIN LATERAL jsonb_array_elements_text(p->'fresh'->'ids') WITH ORDINALITY selection(id,ord) JOIN public."QuestionRevision" q ON q."id"=selection.id WHERE p->>'categoryKey'=c."categoryKey"
  )) ORDER BY c."categoryKey") INTO categories FROM public."CatalogReleaseCategory" c JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" AND cr."contentHash"=c."categoryContentHash" WHERE c."catalogReleaseId"=pointer."catalogReleaseId" AND c."categoryKey" IN (SELECT DISTINCT s->>'categoryKey' FROM jsonb_array_elements(proof."kidsSources") s);
 END IF;
 RETURN jsonb_build_object('receipt',jsonb_build_object('version',1,'projectId',project,'identityId',identity_id,'mode',chosen_mode,'operation',CASE WHEN chosen_mode='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END,'releaseId',proof."catalogReleaseId",'rootHash',proof."releaseRootHash",'receiptId',proof."receiptId",'selectorVersion',CASE WHEN chosen_mode='KIDS' THEN 'enta-reviewed-kids-tier-v1' ELSE old_catalog->'receipt'->>'selectorVersion' END,'policyVersion',proof."policyVersion",'targetCohort',proof."targetCohort",'reviewerIdentityId',proof."reviewerIdentityId",'suitabilityManifestHash',proof."suitabilityManifestHash"),'categories',categories,'kidsSources',proof."kidsSources",'kidsProofs',proof."kidsProofs",'classic',old_catalog);
END $$;

CREATE FUNCTION public.int7_enta_complete_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; r public."GameRuntime"%ROWTYPE; link public."EntaRematchLink"%ROWTYPE; predecessor JSONB:='null'::JSONB; start_kind TEXT:='START'; game_id TEXT; expected_count INTEGER;
BEGIN
 game_id:=CASE WHEN TG_TABLE_NAME='Game' THEN NEW."id" ELSE NEW."gameId" END; SELECT * INTO g FROM public."Game" WHERE "id"=game_id;
 IF g."gameFormat"<>'FIREBASE_PINNED' THEN RETURN NULL; END IF; SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF NOT FOUND THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; IF a."requestVersion"<>3 THEN RETURN NULL; END IF;
 SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id"; expected_count:=CASE WHEN g."mode"='KIDS' THEN 1 ELSE 6 END;
 IF NOT FOUND OR a."engine"<>'ENTA' OR a."state"<>'COMMITTED' OR a."mode" IS DISTINCT FROM g."mode" OR a."operation" IS DISTINCT FROM (CASE WHEN g."mode"='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END) OR a."predecessorAdmissionId" IS NOT NULL OR NOT public.int7_enta_valid_setup(r."setup",g."mode") OR r."setupHash"<>public.int6_enta_hash(r."setup") OR (SELECT count(*) FROM public."GameCategoryPin" WHERE "gameId"=g."id")<>expected_count OR (SELECT count(*) FROM public."GameQuestion" WHERE "gameId"=g."id")<>expected_count*6 THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO link FROM public."EntaRematchLink" WHERE "childGameId"=g."id";
 IF FOUND THEN start_kind:='REMATCH'; predecessor:=jsonb_build_object('gameId',link."predecessorGameId",'version',link."predecessorRuntimeVersion"); END IF;
 IF a."intentHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',3,'engine','ENTA','operation',a."operation",'mode',g."mode",'startKind',start_kind,'predecessor',predecessor,'logicalMatchId',a."logicalMatchId",'setup',r."setup")) OR a."requestHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',3,'requestKey',a."requestKey",'intentHash',a."intentHash"))
 OR NOT EXISTS(SELECT 1 FROM public."GameEvent" e WHERE e."gameId"=g."id" AND e."sequence"=1 AND e."type"='START' AND e."actorFirebaseIdentityId"=g."firebaseIdentityId" AND e."commandId"=a."requestKey" AND e."intentHash"=a."intentHash") OR EXISTS(SELECT 1 FROM public."GameCategoryPin" p WHERE p."gameId"=g."id" AND p."categoryKey" IS DISTINCT FROM r."setup"->'categoryKeys'->>p."ordinal") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF g."mode"='KIDS' AND (a."selectorVersion"<>'enta-reviewed-kids-tier-v1' OR NOT EXISTS(SELECT 1 FROM public."EntaModeReleaseEvidence" evidence WHERE evidence."receiptId"=a."validationReceiptId" AND evidence."mode"='KIDS' AND evidence."catalogReleaseId"=g."catalogReleaseId" AND evidence."releaseRootHash"=g."catalogReleaseRootHash" AND evidence."policyVersion"='enta-kids-suitability-v1') OR EXISTS(
  SELECT 1 FROM public."GameQuestion" pinned JOIN public."QuestionRevision" q ON q."id"=pinned."questionRevisionId" WHERE pinned."gameId"=g."id" AND NOT EXISTS(SELECT 1 FROM public."EntaModeReleaseEvidence" evidence CROSS JOIN LATERAL jsonb_array_elements(evidence."kidsProofs") proof CROSS JOIN LATERAL jsonb_array_elements_text(proof->'fresh'->'ids') chosen WHERE evidence."receiptId"=a."validationReceiptId" AND evidence."mode"='KIDS' AND proof->>'categoryKey'=r."setup"->'categoryKeys'->>0 AND (proof->>'tier')::INTEGER=q."points" AND chosen.value=q."id")
 )) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Game_E2_complete_start" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int7_enta_complete_start();
CREATE CONSTRAINT TRIGGER "GameRuntime_E2_complete_start" AFTER INSERT ON public."GameRuntime" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int7_enta_complete_start();

CREATE FUNCTION public.int7_enta_history(ns TEXT,project TEXT,uid TEXT,query JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; result JSONB; anchor TIMESTAMP(3);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" WHERE "id"='singleton' AND "namespaceId"=ns AND "firebaseProjectId"=project) THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 IF NOT public.int6_enta_exact_keys(query,ARRAY['limit','mode','status','cursor']) OR NOT public.int5b_json_integer(query->'limit',1,50) OR query->'mode' NOT IN ('null'::JSONB,'"CLASSIC"'::JSONB,'"KIDS"'::JSONB) OR query->'status' NOT IN ('null'::JSONB,'"ACTIVE"'::JSONB,'"FINISHED"'::JSONB) THEN PERFORM public.int6_enta_error('INVALID_HISTORY_QUERY'); END IF;
 SELECT "id" INTO identity_id FROM public."FirebaseIdentity" WHERE "firebaseProjectId"=project AND "firebaseUid"=uid;
 IF NOT FOUND THEN IF query->'cursor' IS DISTINCT FROM 'null'::JSONB THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF; RETURN '[]'::JSONB; END IF;
 IF query->'cursor' IS DISTINCT FROM 'null'::JSONB THEN
  IF NOT public.int6_enta_exact_keys(query->'cursor',ARRAY['id','createdAt']) OR query->'cursor'->>'id'!~'^[A-Za-z0-9_-]{1,128}$' OR query->'cursor'->>'createdAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF;
  anchor:=(query->'cursor'->>'createdAt')::TIMESTAMPTZ AT TIME ZONE 'UTC';
  IF NOT EXISTS(SELECT 1 FROM public."Game" g WHERE g."id"=query->'cursor'->>'id' AND g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND g."mode" IN ('CLASSIC','KIDS') AND g."createdAt"=anchor AND (query->>'mode' IS NULL OR g."mode"=query->>'mode') AND (query->>'status' IS NULL OR g."status"=query->>'status')) THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF;
 END IF;
 -- One statement: coherent aggregate snapshot, no wallet/catalog/grading reads.
 SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC,id COLLATE "C" DESC),'[]'::JSONB) INTO result FROM (
  SELECT g."createdAt" created_at,g."id" id,jsonb_build_object('id',g."id",'mode',g."mode",'status',g."status",'createdAt',to_char(g."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN g."finishedAt" IS NULL THEN NULL ELSE to_char(g."finishedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'teams',(SELECT jsonb_agg(jsonb_build_object('name',t."name",'score',t."score") ORDER BY ordered.ord) FROM unnest(r."teamOrder") WITH ORDINALITY ordered(id,ord) JOIN public."Team" t ON t."gameId"=g."id" AND t."id"=ordered.id),'resultReason',r."resultReason",'unplayedCount',r."unplayedCount") row
  FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND g."mode" IN ('CLASSIC','KIDS') AND (query->>'mode' IS NULL OR g."mode"=query->>'mode') AND (query->>'status' IS NULL OR g."status"=query->>'status') AND (anchor IS NULL OR g."createdAt"<anchor OR (g."createdAt"=anchor AND g."id" COLLATE "C"<(query->'cursor'->>'id') COLLATE "C"))
  ORDER BY g."createdAt" DESC,g."id" COLLATE "C" DESC LIMIT (query->>'limit')::INTEGER+1
 ) selected; RETURN result;
END $$;
CREATE FUNCTION public.int7_enta_start(ns TEXT,project TEXT,uid TEXT,p JSONB,receipt_id TEXT,predecessor_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT; w public."Wallet"%ROWTYPE; a public."Admission"%ROWTYPE; catalog JSONB; receipt JSONB; s JSONB; intent JSONB;
 game_id TEXT:=gen_random_uuid()::TEXT; admission_id TEXT:=gen_random_uuid()::TEXT; reservation_id TEXT:=gen_random_uuid()::TEXT;
 team_ids TEXT[]:=ARRAY[]::TEXT[]; team JSONB; player JSONB; category JSONB; question JSONB; category_key TEXT; team_id TEXT; i INTEGER:=0; j INTEGER; ord INTEGER:=0; moment TIMESTAMPTZ; existing JSONB; predecessor public."Game"%ROWTYPE; predecessor_runtime public."GameRuntime"%ROWTYPE; chosen_mode TEXT; operation TEXT;
BEGIN
 IF NOT public.int6_enta_exact_keys(p,ARRAY['requestKey','logicalMatchId','setup','setupHash','intentHash','requestHash','requestVersion','mode','operation','startKind','predecessor']) OR p->'requestVersion' IS DISTINCT FROM '3'::JSONB OR jsonb_typeof(p->'requestKey') IS DISTINCT FROM 'string' OR p->>'requestKey'!~'^[A-Za-z0-9._:-]{8,128}$' OR jsonb_typeof(p->'logicalMatchId') IS DISTINCT FROM 'string' OR p->>'logicalMatchId'!~'^[A-Za-z0-9_-]{1,128}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('ACCOUNT_NOT_READY'); END IF;
 IF predecessor_id IS NOT NULL THEN
 SELECT * INTO predecessor FROM public."Game" WHERE "id"=predecessor_id AND "firebaseIdentityId"=identity_id AND "gameFormat"='FIREBASE_PINNED' AND "mode" IN ('CLASSIC','KIDS') FOR UPDATE;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 SELECT * INTO predecessor_runtime FROM public."GameRuntime" WHERE "gameId"=predecessor_id FOR UPDATE;
 IF NOT FOUND OR predecessor_runtime."state"<>'FINISHED' OR predecessor."status"<>'FINISHED' THEN PERFORM public.int6_enta_error('PREDECESSOR_NOT_FINISHED'); END IF;
 chosen_mode:=predecessor."mode";
 IF NOT public.int6_enta_exact_keys(p->'predecessor',ARRAY['gameId','version']) OR p->'predecessor'->>'gameId' IS DISTINCT FROM predecessor_id OR NOT public.int5b_json_integer(p->'predecessor'->'version',2,2000000000) OR p->>'startKind' IS DISTINCT FROM 'REMATCH' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 ELSE chosen_mode:='KIDS'; IF p->'predecessor' IS DISTINCT FROM 'null'::JSONB OR p->>'startKind' IS DISTINCT FROM 'START' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; END IF;
 operation:=CASE WHEN chosen_mode='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END; s:=p->'setup';
 IF p->>'mode' IS DISTINCT FROM chosen_mode OR p->>'operation' IS DISTINCT FROM operation OR NOT public.int7_enta_valid_setup(s,chosen_mode) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 intent:=jsonb_build_object('version',3,'engine','ENTA','operation',operation,'mode',chosen_mode,'startKind',p->>'startKind','predecessor',p->'predecessor','logicalMatchId',p->>'logicalMatchId','setup',s);
 IF p->>'setupHash' IS DISTINCT FROM public.int6_enta_hash(s) OR p->>'intentHash' IS DISTINCT FROM public.int6_enta_hash(intent) OR p->>'requestHash' IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',3,'requestKey',p->>'requestKey','intentHash',p->>'intentHash')) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND "requestKey"=p->>'requestKey' FOR UPDATE;
 IF FOUND THEN
  IF a."engine"<>'ENTA' OR a."operation" IS DISTINCT FROM operation OR a."mode" IS DISTINCT FROM chosen_mode OR a."requestVersion"<>3 OR a."requestHash"<>p->>'requestHash' OR a."intentHash"<>p->>'intentHash' OR a."state"<>'COMMITTED' THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF;
  SELECT g."id" INTO game_id FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."admissionId"=a."id" AND g."firebaseIdentityId"=identity_id AND r."setupHash"=p->>'setupHash';
  IF NOT FOUND THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF; RETURN jsonb_build_object('gameId',game_id);
 END IF;
 IF EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND "engine"='ENTA' AND "logicalMatchId"=p->>'logicalMatchId') THEN PERFORM public.int6_enta_error('LOGICAL_MATCH_ALREADY_CHARGED'); END IF;
 IF predecessor_id IS NOT NULL AND (predecessor_runtime."version"<>(p->'predecessor'->>'version')::INTEGER OR NOT EXISTS(SELECT 1 FROM public."GameEvent" e WHERE e."gameId"=predecessor_id AND e."sequence"=(p->'predecessor'->>'version')::INTEGER AND e."type"='FINISH' AND e."actorFirebaseIdentityId"=identity_id)) THEN PERFORM public.int6_enta_error('PREDECESSOR_VERSION_CONFLICT'); END IF;
 IF w."debt">0 THEN PERFORM public.int6_enta_error('WALLET_DEBT_BLOCKS_START'); END IF;
 IF w."available"<1 THEN PERFORM public.int6_enta_error('INSUFFICIENT_CREDIT'); END IF;
 catalog:=public.int7_enta_catalog(ns,project,uid,chosen_mode); receipt:=catalog->'receipt';
 IF receipt->>'receiptId' IS DISTINCT FROM receipt_id THEN PERFORM public.int6_enta_error('CATALOG_UNAVAILABLE'); END IF;
 PERFORM public.int7_enta_assert_receipt(receipt_id,receipt->>'releaseId',receipt->>'rootHash',chosen_mode);
 -- No effect is possible while the separately reviewed SQL issuer is absent.
 moment:=clock_timestamp();
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","state","version","updatedAt") VALUES(admission_id,identity_id,w."id",'ENTA',operation,chosen_mode,p->>'logicalMatchId',p->>'requestKey',p->>'requestHash',p->>'intentHash',3,receipt->>'releaseId',receipt->>'rootHash',receipt_id,receipt->>'selectorVersion','HELD',0,moment);
 INSERT INTO public."Reservation"("id","admissionId","quantity","state","updatedAt") VALUES(reservation_id,admission_id,1,'HELD',moment);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',admission_id,'RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",identity_id,p->>'requestHash');
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,admission_id,1,'HELD',p->>'requestHash');
 INSERT INTO public."Game"("id","userId","gameFormat","firebaseIdentityId","admissionId","catalogReleaseId","catalogReleaseRootHash","validationReceiptId","mode","status") VALUES(game_id,NULL,'FIREBASE_PINNED',identity_id,admission_id,receipt->>'releaseId',receipt->>'rootHash',receipt_id,chosen_mode,'ACTIVE');
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
 IF predecessor_id IS NOT NULL THEN INSERT INTO public."EntaRematchLink"("childGameId","firebaseIdentityId","predecessorGameId","predecessorRuntimeVersion") VALUES(game_id,identity_id,predecessor_id,(p->'predecessor'->>'version')::INTEGER); END IF;
 SELECT * INTO w FROM public."Wallet" WHERE "id"=w."id";
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',admission_id,'COMMIT',reservation_id,0,-1,0,w."available",w."held"-1,w."debt",identity_id,p->>'requestHash');
 UPDATE public."Wallet" SET "held"="held"-1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id";
 UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=moment,"updatedAt"=moment WHERE "id"=reservation_id;
 UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=moment WHERE "id"=admission_id;
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,admission_id,2,'COMMITTED',p->>'requestHash');
 RETURN jsonb_build_object('gameId',game_id);
END $$;
ALTER FUNCTION public.int7_enta_admission_mode_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_admission_mode_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_assert_receipt(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_assert_receipt(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_valid_setup(JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_valid_setup(JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_rematch_link_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_rematch_link_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int6_enta_runtime_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int6_enta_runtime_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int6_enta_game_insert_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int6_enta_game_insert_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_kids_financial_complete() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_kids_financial_complete() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_kids_selection(JSONB,TEXT,INTEGER,BIGINT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_kids_selection(JSONB,TEXT,INTEGER,BIGINT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_catalog(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_catalog(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_complete_start() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_complete_start() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int7_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
GRANT SELECT ON public."EntaRematchLink",public."EntaModeReleaseEvidence" TO enta_finance_executor;
GRANT INSERT ON public."EntaRematchLink" TO enta_finance_executor;
GRANT EXECUTE ON FUNCTION public.int7_enta_find_start(TEXT,TEXT,TEXT,TEXT,TEXT),public.int7_enta_catalog(TEXT,TEXT,TEXT,TEXT),public.int7_enta_start(TEXT,TEXT,TEXT,JSONB,TEXT,TEXT),public.int7_enta_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN),public.int7_enta_command(TEXT,TEXT,TEXT,TEXT,JSONB,TEXT),public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) TO enta_gameplay_runtime;
COMMIT;
