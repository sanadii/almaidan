-- INERT COMP-01 SOURCE PROPOSAL. NOT PARSED, COMPILED, QUERIED OR APPLIED.
-- No COMP-02 adoption. Install ordering / roles / indexes require exact reviews.
-- Physical protocols remain2..5; external envelope6 is an independent axis.
CREATE TABLE public."E3PhysicalProfile" (
 "protocol" INTEGER NOT NULL,"format" TEXT NOT NULL,"rules" TEXT NOT NULL,"mode" TEXT NOT NULL,
 PRIMARY KEY("protocol","format","rules","mode"),CHECK("protocol" IN(2,3,4,5))
);
INSERT INTO public."E3PhysicalProfile" VALUES
 (2,'TIER_BOARD','enta-classic-2','CLASSIC'),(3,'TIER_BOARD','enta-classic-3','CLASSIC'),(3,'TIER_BOARD','enta-kids-3','KIDS'),
 (4,'MIXED_BOARD','enta-format-1','CLASSIC'),(4,'STANDALONE_LIST','enta-format-1','LIST'),(4,'STANDALONE_ACTING','enta-format-1','ACTING'),
 (5,'TIER_BOARD','enta-competitive-1','CLASSIC'),(5,'MIXED_BOARD','enta-competitive-1','CLASSIC'),(5,'STANDALONE_LIST','enta-competitive-1','LIST'),(5,'STANDALONE_ACTING','enta-competitive-1','ACTING');

CREATE TABLE public."E3OriginalTerminal" (
 "gameId" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"admissionId" TEXT NOT NULL,"terminalHash" TEXT NOT NULL,
 "protocol" INTEGER NOT NULL,"format" TEXT NOT NULL,"rules" TEXT NOT NULL,"mode" TEXT NOT NULL,
 "legacySequence" INTEGER,"authorityEventId" TEXT,"resultVersion" INTEGER,"resultHash" TEXT,
 "material" JSONB NOT NULL,
 PRIMARY KEY("gameId","ownerId","terminalHash"),
 FOREIGN KEY("gameId","admissionId","ownerId") REFERENCES public."Game"("id","admissionId","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("protocol","format","rules","mode") REFERENCES public."E3PhysicalProfile" ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("gameId","legacySequence") REFERENCES public."GameEvent"("gameId","sequence") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("gameId","authorityEventId") REFERENCES public."RoundAuthorityEvent"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("gameId","resultVersion","resultHash") REFERENCES public."EngineMatchResult"("gameId","resultVersion","resultHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK("terminalHash"~'^[a-f0-9]{64}$'),
 CHECK(("protocol" IN(2,3) AND "legacySequence" IS NOT NULL AND "authorityEventId" IS NULL AND "resultVersion" IS NULL AND "resultHash" IS NULL)
 OR ("protocol"=4 AND "legacySequence" IS NULL AND "authorityEventId" IS NOT NULL AND "resultVersion" IS NULL AND "resultHash" IS NULL)
 OR ("protocol"=5 AND "legacySequence" IS NOT NULL AND "authorityEventId" IS NOT NULL AND "resultVersion" IS NOT NULL AND "resultVersion"=1 AND "resultHash" IS NOT NULL))
);

CREATE TABLE public."E3StartReservation" (
 "id" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"walletId" TEXT NOT NULL,
 "namespaceId" TEXT NOT NULL,"projectId" TEXT NOT NULL,"uid" TEXT NOT NULL,
 "envelopeVersion" INTEGER NOT NULL DEFAULT 6,"e3Protocol" INTEGER NOT NULL DEFAULT 1,
 "requestKey" TEXT NOT NULL,"logicalId" TEXT NOT NULL,"clientHash" TEXT NOT NULL,
 "protocol" INTEGER NOT NULL,"format" TEXT NOT NULL,"rules" TEXT NOT NULL,"mode" TEXT NOT NULL,
 "parentGameId" TEXT NOT NULL,"terminalHash" TEXT NOT NULL,"externalRequest" JSONB NOT NULL,
 "nativeRequest" JSONB NOT NULL,"nativeRequestHash" TEXT NOT NULL,
 UNIQUE("ownerId","requestKey"),UNIQUE("ownerId","logicalId"),
 UNIQUE("id","ownerId"),UNIQUE("id","ownerId","protocol","requestKey","logicalId","nativeRequestHash"),
 FOREIGN KEY("ownerId") REFERENCES public."FirebaseIdentity"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("walletId","ownerId") REFERENCES public."Wallet"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("protocol","format","rules","mode") REFERENCES public."E3PhysicalProfile" ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("parentGameId","ownerId","terminalHash") REFERENCES public."E3OriginalTerminal"("gameId","ownerId","terminalHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK("envelopeVersion"=6 AND "e3Protocol"=1),
 CHECK("requestKey"~'^[A-Za-z0-9._:-]{8,128}$' AND "logicalId"~'^[A-Za-z0-9_-]{1,128}$'),
 CHECK("clientHash"~'^[a-f0-9]{64}$' AND "nativeRequestHash"~'^[a-f0-9]{64}$')
);

CREATE TABLE public."E3AdmissionInsertWitness" (
 "stageId" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"protocol" INTEGER NOT NULL,
 "requestKey" TEXT NOT NULL,"logicalId" TEXT NOT NULL,"nativeRequestHash" TEXT NOT NULL,
 "admissionId" TEXT NOT NULL UNIQUE,"walletId" TEXT NOT NULL,"nativeIntentHash" TEXT NOT NULL,
 "baseReleaseId" TEXT NOT NULL,"baseRoot" TEXT NOT NULL,"receiptId" TEXT NOT NULL,"selector" TEXT NOT NULL,
 UNIQUE("stageId","ownerId","admissionId"),
 FOREIGN KEY("stageId","ownerId","protocol","requestKey","logicalId","nativeRequestHash") REFERENCES public."E3StartReservation"("id","ownerId","protocol","requestKey","logicalId","nativeRequestHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("admissionId","ownerId") REFERENCES public."Admission"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("walletId","ownerId") REFERENCES public."Wallet"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK("protocol" IN(2,3,4,5) AND "nativeIntentHash"~'^[a-f0-9]{64}$')
 -- Deliberately NO child Game FK: no Game exists at Admission INSERT.
);

CREATE TABLE public."E3ImmutableSeal" (
 "stageId" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"admissionId" TEXT NOT NULL UNIQUE,"gameId" TEXT NOT NULL UNIQUE,
 "startSequence" INTEGER NOT NULL DEFAULT 1,"fullIntentHash" TEXT NOT NULL,"fullMaterial" JSONB NOT NULL,
 UNIQUE("stageId","ownerId","admissionId","gameId"),
 FOREIGN KEY("stageId","ownerId","admissionId") REFERENCES public."E3AdmissionInsertWitness"("stageId","ownerId","admissionId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("gameId","admissionId","ownerId") REFERENCES public."Game"("id","admissionId","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("gameId","startSequence") REFERENCES public."GameEvent"("gameId","sequence") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK("startSequence"=1 AND "fullIntentHash"~'^[a-f0-9]{64}$')
);

CREATE TABLE public."E3SuccessorLink" (
 "stageId" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"parentGameId" TEXT NOT NULL,"terminalHash" TEXT NOT NULL,
 "childGameId" TEXT NOT NULL UNIQUE,"admissionId" TEXT NOT NULL UNIQUE,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY("parentGameId","ownerId","terminalHash") REFERENCES public."E3OriginalTerminal"("gameId","ownerId","terminalHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("stageId","ownerId","admissionId","childGameId") REFERENCES public."E3ImmutableSeal"("stageId","ownerId","admissionId","gameId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK("parentGameId"<>"childGameId")
);
CREATE FUNCTION public.e3_comp_link_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."E3StartReservation" s JOIN public."E3ImmutableSeal" z ON z."stageId"=s."id" JOIN public."E3AdmissionInsertWitness" w ON w."stageId"=s."id" WHERE (s."id",s."ownerId",s."parentGameId",s."terminalHash",z."gameId",w."admissionId")=(NEW."stageId",NEW."ownerId",NEW."parentGameId",NEW."terminalHash",NEW."childGameId",NEW."admissionId") AND z."ownerId"=s."ownerId" AND z."admissionId"=w."admissionId") THEN RAISE EXCEPTION 'E3_LINK_MISMATCH'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER "E3SuccessorLink_guard" BEFORE INSERT ON public."E3SuccessorLink" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_link_guard();

CREATE FUNCTION public.e3_comp_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'E3_IMMUTABLE';END $$;
CREATE TRIGGER "E3OriginalTerminal_immutable" BEFORE UPDATE OR DELETE ON public."E3OriginalTerminal" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();
CREATE TRIGGER "E3StartReservation_immutable" BEFORE UPDATE OR DELETE ON public."E3StartReservation" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();
CREATE TRIGGER "E3AdmissionInsertWitness_immutable" BEFORE UPDATE OR DELETE ON public."E3AdmissionInsertWitness" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();
CREATE TRIGGER "E3ImmutableSeal_immutable" BEFORE UPDATE OR DELETE ON public."E3ImmutableSeal" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();
CREATE TRIGGER "E3PhysicalProfile_immutable" BEFORE UPDATE OR DELETE ON public."E3PhysicalProfile" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();

-- The only witness issuer is an Admission AFTER INSERT trigger. No public
-- function accepts a caller-provided admission/Game identity to manufacture it.
CREATE FUNCTION public.e3_comp_admission_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stage_id TEXT; matches INTEGER; s public."E3StartReservation"%ROWTYPE;
BEGIN
 SELECT count(*) INTO matches FROM public."E3StartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "logicalId"=NEW."logicalMatchId");
 IF matches=0 THEN RETURN NULL;END IF; -- Strict ordinary-native no-op branch.
 IF matches<>1 THEN RAISE EXCEPTION 'E3_CROSS_STAGE_COLLISION';END IF;
 SELECT "id" INTO STRICT stage_id FROM public."E3StartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "logicalId"=NEW."logicalMatchId");
 SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;
 IF NEW."engine" IS DISTINCT FROM 'ENTA' OR NEW."state" IS DISTINCT FROM 'HELD' OR NEW."version" IS DISTINCT FROM 0
 OR NEW."requestVersion" IS DISTINCT FROM s."protocol" OR NEW."requestKey" IS DISTINCT FROM s."requestKey" OR NEW."logicalMatchId" IS DISTINCT FROM s."logicalId"
 OR NEW."walletId" IS DISTINCT FROM s."walletId" OR NEW."mode" IS DISTINCT FROM s."mode" OR NEW."requestHash" IS DISTINCT FROM s."nativeRequestHash"
 OR NEW."predecessorAdmissionId" IS NOT NULL OR NEW."catalogReleaseId" IS NULL OR NEW."releaseRootHash" IS NULL OR NEW."validationReceiptId" IS NULL THEN RAISE EXCEPTION 'E3_ORIGIN_CONFLICT';END IF;
 INSERT INTO public."E3AdmissionInsertWitness"("stageId","ownerId","protocol","requestKey","logicalId","nativeRequestHash","admissionId","walletId","nativeIntentHash","baseReleaseId","baseRoot","receiptId","selector") VALUES(s."id",s."ownerId",s."protocol",s."requestKey",s."logicalId",s."nativeRequestHash",NEW."id",NEW."walletId",NEW."intentHash",NEW."catalogReleaseId",NEW."releaseRootHash",NEW."validationReceiptId",NEW."selectorVersion");
 RETURN NULL;
END $$;
CREATE TRIGGER "Admission_E3_insert_origin" AFTER INSERT ON public."Admission" FOR EACH ROW WHEN (NEW."engine"='ENTA' AND NEW."requestVersion" IN(2,3,4,5)) EXECUTE FUNCTION public.e3_comp_admission_insert();

-- The stage INSERT guard repeats origin nonexistence. Its actual private
-- creator must also hold owner Wallet before parent Game and any native call.
CREATE FUNCTION public.e3_comp_stage_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" WHERE "id"='singleton' AND "namespaceId"=NEW."namespaceId" AND "firebaseProjectId"=NEW."projectId")
 OR NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" WHERE "id"=NEW."ownerId" AND "firebaseProjectId"=NEW."projectId" AND "firebaseUid"=NEW."uid")
 OR EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=NEW."ownerId" AND ("requestKey"=NEW."requestKey" OR ("engine"='ENTA' AND "logicalMatchId"=NEW."logicalId")))
 THEN RAISE EXCEPTION 'E3_LATE_STAGE_OR_OWNER_CONFLICT';END IF;
 IF NEW."clientHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',NEW."externalRequest"))
 OR NEW."externalRequest"->'envelopeVersion' IS DISTINCT FROM '6'::JSONB OR NEW."externalRequest"->'e3Protocol' IS DISTINCT FROM '1'::JSONB
 OR NEW."externalRequest"->>'requestKey' IS DISTINCT FROM NEW."requestKey" OR NEW."externalRequest"->>'logicalMatchId' IS DISTINCT FROM NEW."logicalId"
 OR NEW."externalRequest"->'predecessor'->>'gameId' IS DISTINCT FROM NEW."parentGameId" OR NEW."externalRequest"->'predecessor'->>'originalTerminalHash' IS DISTINCT FROM NEW."terminalHash" THEN RAISE EXCEPTION 'E3_EXTERNAL_MISMATCH';END IF;
 -- Full retained setup / native request material equivalence is additionally
 -- checked by e3_comp_assert_stage_material, defined in02 (not hash equality alone).
 PERFORM public.e3_comp_assert_stage_material(NEW."id",to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER "E3StartReservation_guard" BEFORE INSERT ON public."E3StartReservation" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_stage_guard();

-- Deferred closure runs from every stage/witness/seal INSERT. Witness NEW was
-- HELD; current Admission is selected again by immutable identity after native
-- return. No demand that captured NEW already represent final COMMITTED.
CREATE FUNCTION public.e3_comp_deferred_close() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stage_id TEXT;BEGIN stage_id:=(CASE WHEN TG_TABLE_NAME='E3StartReservation' THEN NEW."id" ELSE NEW."stageId" END);PERFORM public.e3_comp_assert_closure(stage_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER "E3StartReservation_closed" AFTER INSERT ON public."E3StartReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.e3_comp_deferred_close();
CREATE CONSTRAINT TRIGGER "E3AdmissionInsertWitness_closed" AFTER INSERT ON public."E3AdmissionInsertWitness" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.e3_comp_deferred_close();
CREATE CONSTRAINT TRIGGER "E3ImmutableSeal_closed" AFTER INSERT ON public."E3ImmutableSeal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.e3_comp_deferred_close();
-- Install all02 definitions before granting any E3 entrypoint; no operational
-- installation or proof of these SQL bytes is authorized by this inert file.

CREATE TRIGGER "E3SuccessorLink_immutable" BEFORE UPDATE OR DELETE ON public."E3SuccessorLink" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_immutable();
CREATE TRIGGER "E3SuccessorLink_no_truncate" BEFORE TRUNCATE ON public."E3SuccessorLink" FOR EACH STATEMENT EXECUTE FUNCTION public.e3_comp_immutable();
CREATE FUNCTION public.e3_comp_link_closed() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.e3_comp_assert_closure(NEW."stageId"); RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER "E3SuccessorLink_closed" AFTER INSERT ON public."E3SuccessorLink" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.e3_comp_link_closed();

-- INERT COMP-01. This text is deliberately not SQL-parsed/compiled/executed.
CREATE FUNCTION public.e3_comp_original_terminal(owner_id TEXT,game_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; legacy public."GameEvent"%ROWTYPE; authority public."RoundAuthorityEvent"%ROWTYPE; original public."EngineMatchResult"%ROWTYPE; material JSONB; profile JSONB;
BEGIN
 SELECT * INTO STRICT g FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=owner_id;
 SELECT * INTO STRICT a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=owner_id;
 IF a."engine"<>'ENTA' OR a."state"<>'COMMITTED' OR a."requestVersion" NOT IN(2,3,4,5) OR g."gameFormat"<>'FIREBASE_PINNED' OR g."status"<>'FINISHED' THEN RAISE EXCEPTION 'E3_PARENT_NOT_ORIGINAL_TERMINAL';END IF;
 SELECT jsonb_build_object('physicalProtocol',"protocol",'format',"format",'retainedRules',"rules",'mode',"mode") INTO STRICT profile FROM public."E3PhysicalProfile" WHERE "protocol"=a."requestVersion" AND "format"=g."executionFormat" AND "mode"=g."mode";
 IF a."requestVersion" IN(2,3) THEN
  SELECT * INTO STRICT legacy FROM public."GameEvent" WHERE "gameId"=game_id AND "type"='FINISH' AND "actorFirebaseIdentityId"=owner_id;
  material:=jsonb_build_object('kind','LEGACY','ownerIdentityId',owner_id,'gameId',game_id,'admissionId',a."id",'physicalProtocol',a."requestVersion",'profile',profile,'event',jsonb_build_object('sequence',legacy."sequence",'commandId',legacy."commandId",'type',legacy."type",'intentHash',legacy."intentHash",'actorIdentityId',legacy."actorFirebaseIdentityId"));
 ELSIF a."requestVersion"=4 THEN
  SELECT * INTO STRICT authority FROM public."RoundAuthorityEvent" WHERE "gameId"=game_id AND "type"='FINISH' AND "ownerIdentityId"=owner_id;
  IF authority."authorityKind"<>'HOST' OR authority."authorityGrantId" IS NOT NULL OR authority."authorityGeneration" IS NOT NULL OR authority."assignmentId" IS NOT NULL OR authority."systemOperation" IS NOT NULL OR authority."pauseReason" IS NOT NULL OR authority."roundId" IS NOT NULL THEN RAISE EXCEPTION 'E3_PARENT_NOT_ORIGINAL_TERMINAL';END IF;
  material:=jsonb_build_object('kind','ROUND','ownerIdentityId',owner_id,'gameId',game_id,'admissionId',a."id",'physicalProtocol',4,'profile',profile,'authority',jsonb_build_object('id',authority."id",'sequence',authority."sequence",'commandId',authority."commandId",'type','FINISH','intentHash',authority."intentHash",'ownerIdentityId',owner_id,'kind','HOST','grant',NULL,'assignment',NULL,'systemOperation',NULL,'roundId',NULL));
 ELSE
  -- Read ORIGINAL result1, never current ResultHead/corrected scores as authority.
  SELECT * INTO STRICT original FROM public."EngineMatchResult" WHERE "gameId"=game_id AND "resultVersion"=1 AND "ownerIdentityId"=owner_id AND "admissionId"=a."id";
  SELECT * INTO STRICT authority FROM public."RoundAuthorityEvent" WHERE "gameId"=game_id AND "id"=original."terminalEventId" AND "ownerIdentityId"=owner_id;
  SELECT * INTO STRICT legacy FROM public."GameEvent" WHERE "gameId"=game_id AND "sequence"=original."terminalRevision" AND "actorFirebaseIdentityId"=owner_id;
  IF original."authorityEventId" IS DISTINCT FROM authority."id" OR original."terminalRevision" IS DISTINCT FROM authority."sequence" OR authority."type"<>'FINISH' OR authority."authorityKind"<>'HOST'
  OR authority."authorityGrantId" IS NOT NULL OR authority."authorityGeneration" IS NOT NULL OR authority."assignmentId" IS NOT NULL OR authority."systemOperation" IS NOT NULL OR authority."pauseReason" IS NOT NULL OR authority."roundId" IS NOT NULL
  OR legacy."type"<>'FINISH' OR legacy."commandId" IS DISTINCT FROM authority."commandId" OR legacy."intentHash" IS DISTINCT FROM authority."intentHash"
  OR original."predecessorVersion" IS NOT NULL OR original."predecessorHash" IS NOT NULL OR original."bindingId" IS NOT NULL OR original."bindingHash" IS NOT NULL
  OR original."payload"->'schemaVersion' IS DISTINCT FROM '1'::JSONB OR original."payload"->'requestVersion' IS DISTINCT FROM '5'::JSONB OR original."payload"->'resultVersion' IS DISTINCT FROM '1'::JSONB
  OR original."payload"->>'engine' IS DISTINCT FROM 'ENTA' OR original."payload"->>'rulesVersion' IS DISTINCT FROM 'enta-competitive-1'
  OR original."payload"->>'gameId' IS DISTINCT FROM game_id OR original."payload"->>'logicalMatchId' IS DISTINCT FROM game_id OR original."payload"->>'admissionId' IS DISTINCT FROM a."id" OR original."payload"->>'executionFormat' IS DISTINCT FROM g."executionFormat"
  OR original."payload"->>'projectId' IS DISTINCT FROM (SELECT "firebaseProjectId" FROM public."FirebaseIdentity" WHERE "id"=owner_id)
  OR original."payload"->'terminal' IS DISTINCT FROM jsonb_build_object('eventId',authority."id",'revision',authority."sequence") OR original."payload"->'authority' IS DISTINCT FROM jsonb_build_object('eventId',authority."id",'kind','HOST','correctionReason',NULL)
  OR original."payload"->'predecessor'  IS DISTINCT FROM 'null'::JSONB OR original."payload"->'tournamentBinding' IS DISTINCT FROM 'null'::JSONB
  OR original."resultHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.result.v1','payload',original."payload")) THEN RAISE EXCEPTION 'E3_PARENT_NOT_ORIGINAL_TERMINAL';END IF;
  material:=jsonb_build_object('kind','COMPETITIVE','ownerIdentityId',owner_id,'gameId',game_id,'admissionId',a."id",'physicalProtocol',5,'profile',profile,
   'legacy',jsonb_build_object('sequence',legacy."sequence",'commandId',legacy."commandId",'type','FINISH','intentHash',legacy."intentHash",'actorIdentityId',owner_id),
   'authority',jsonb_build_object('id',authority."id",'sequence',authority."sequence",'commandId',authority."commandId",'type','FINISH','intentHash',authority."intentHash",'ownerIdentityId',owner_id,'kind','HOST','grant',NULL,'assignment',NULL,'systemOperation',NULL,'roundId',NULL),
   'result',jsonb_build_object('resultVersion',1,'schemaVersion',1,'requestVersion',5,'resultHash',original."resultHash",'terminalRevision',original."terminalRevision",'terminalEventId',original."terminalEventId",'authorityEventId',original."authorityEventId",'predecessor',NULL,'tournamentBinding',NULL));
 END IF;
 RETURN material;
END $$;

CREATE FUNCTION public.e3_comp_native_request(external_request JSONB,terminal JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p INTEGER:=(external_request->'profile'->>'physicalProtocol')::INTEGER; operation TEXT; native_intent JSONB; intent_hash TEXT; predecessor JSONB;
BEGIN
 operation:=(CASE external_request->'profile'->>'mode' WHEN 'KIDS' THEN 'PAID_ENTA_KIDS' WHEN 'LIST' THEN 'PAID_ENTA_LIST' WHEN 'ACTING' THEN 'PAID_ENTA_ACTING' ELSE 'PAID_ENTA_CLASSIC' END);
 IF p=2 THEN
  IF public.int6_enta_valid_setup(external_request->'setup') IS NOT TRUE THEN RAISE EXCEPTION 'E3_SETUP_MISMATCH';END IF;
  native_intent:=jsonb_build_object('version',2,'engine','ENTA','operation',operation,'mode','CLASSIC','logicalMatchId',external_request->'logicalMatchId','setup',external_request->'setup');intent_hash:=public.int6_enta_hash(native_intent);
  RETURN jsonb_build_object('requestKey',external_request->'requestKey','logicalMatchId',external_request->'logicalMatchId','setup',external_request->'setup','setupHash',public.int6_enta_hash(external_request->'setup'),'intentHash',intent_hash,'requestHash',public.int6_enta_hash(jsonb_build_object('version',2,'requestKey',external_request->'requestKey','intentHash',intent_hash)),'requestVersion',2);
 ELSIF p=3 THEN
  IF terminal->>'kind'<>'LEGACY' OR terminal->'physicalProtocol' IS DISTINCT FROM '3'::JSONB OR public.int7_enta_valid_setup(external_request->'setup',external_request->'profile'->>'mode') IS NOT TRUE THEN RAISE EXCEPTION 'E3_SETUP_MISMATCH';END IF;
  predecessor:=jsonb_build_object('gameId',terminal->'gameId','version',terminal->'event'->'sequence');
  native_intent:=jsonb_build_object('version',3,'engine','ENTA','operation',operation,'mode',external_request->'profile'->'mode','startKind','REMATCH','predecessor',predecessor,'logicalMatchId',external_request->'logicalMatchId','setup',external_request->'setup');intent_hash:=public.int6_enta_hash(native_intent);
  RETURN jsonb_build_object('requestKey',external_request->'requestKey','logicalMatchId',external_request->'logicalMatchId','setup',external_request->'setup','setupHash',public.int6_enta_hash(external_request->'setup'),'intentHash',intent_hash,'requestHash',public.int6_enta_hash(jsonb_build_object('version',3,'requestKey',external_request->'requestKey','intentHash',intent_hash)),'requestVersion',3,'mode',external_request->'profile'->'mode','operation',operation,'startKind','REMATCH','predecessor',predecessor);
 ELSIF p IN(4,5) THEN
  native_intent:=jsonb_build_object('version',p,'operation',operation,'executionFormat',external_request->'profile'->'format','predecessor',NULL,'requestKey',external_request->'requestKey','logicalMatchId',external_request->'logicalMatchId','setup',external_request->'setup');
  IF (p=4 AND public.int8_valid_request(native_intent) IS NOT TRUE) OR (p=5 AND public.int9_valid_request(native_intent) IS NOT TRUE) THEN RAISE EXCEPTION 'E3_SETUP_MISMATCH';END IF;RETURN native_intent;
 END IF;RAISE EXCEPTION 'E3_PROFILE_UNSUPPORTED';
END $$;

CREATE FUNCTION public.e3_comp_assert_stage_material(stage_id TEXT,row_data JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE terminal JSONB; n JSONB; p INTEGER:=(row_data->>'protocol')::INTEGER;
BEGIN
 SELECT "material" INTO STRICT terminal FROM public."E3OriginalTerminal" WHERE "gameId"=row_data->>'parentGameId' AND "ownerId"=row_data->>'ownerId' AND "terminalHash"=row_data->>'terminalHash';
 IF row_data->'externalRequest'->'profile' IS DISTINCT FROM terminal->'profile' OR row_data->'externalRequest'->'setup'->'version' IS DISTINCT FROM to_jsonb(p)
 OR row_data->'externalRequest'->'profile' IS DISTINCT FROM jsonb_build_object('physicalProtocol',p,'format',row_data->'format','retainedRules',row_data->'rules','mode',row_data->'mode') THEN RAISE EXCEPTION 'E3_RETAINED_PROFILE_MISMATCH';END IF;
 n:=public.e3_comp_native_request(row_data->'externalRequest',terminal);
 IF row_data->'nativeRequest' IS DISTINCT FROM n OR row_data->>'nativeRequestHash' IS DISTINCT FROM (CASE WHEN p IN(2,3) THEN n->>'requestHash' ELSE public.int6_enta_hash(n) END) THEN RAISE EXCEPTION 'E3_NATIVE_RAW_MAPPING_MISMATCH';END IF;
END $$;

CREATE FUNCTION public.e3_comp_actual_native(stage_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."E3StartReservation"%ROWTYPE;w public."E3AdmissionInsertWitness"%ROWTYPE;a public."Admission"%ROWTYPE;g public."Game"%ROWTYPE;setup JSONB;setup_hash TEXT;native_intent JSONB;request JSONB;selected JSONB;start_row JSONB;legacy_link JSONB;paid JSONB;category_pins JSONB;questions JSONB;round_pins JSONB;item_pins JSONB;exposures JSONB;competitive JSONB;
BEGIN
 SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;SELECT * INTO STRICT w FROM public."E3AdmissionInsertWitness" WHERE "stageId"=stage_id;
 SELECT * INTO STRICT a FROM public."Admission" WHERE "id"=w."admissionId" AND "firebaseIdentityId"=s."ownerId";
 SELECT * INTO STRICT g FROM public."Game" WHERE "admissionId"=a."id" AND "firebaseIdentityId"=s."ownerId";
 SELECT "setup","setupHash" INTO STRICT setup,setup_hash FROM public."GameRuntime" WHERE "gameId"=g."id";
 IF s."protocol" IN(2,3) THEN
  request:=s."nativeRequest";
  native_intent:=(CASE WHEN s."protocol"=2 THEN jsonb_build_object('version',2,'engine','ENTA','operation','PAID_ENTA_CLASSIC','mode','CLASSIC','logicalMatchId',s."logicalId",'setup',setup)
  ELSE jsonb_build_object('version',3,'engine','ENTA','operation',a."operation",'mode',a."mode",'startKind','REMATCH','predecessor',s."nativeRequest"->'predecessor','logicalMatchId',s."logicalId",'setup',setup) END);
 ELSE SELECT "clientBinding","fullIntent" INTO STRICT request,native_intent FROM public."EntaExecutionPin" WHERE "gameId"=g."id" AND "firebaseIdentityId"=s."ownerId";END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p."ordinal"),'[]'::JSONB) INTO category_pins FROM public."GameCategoryPin" p WHERE p."gameId"=g."id";
 -- No invented GameQuestion ordinal. The typed set has deterministic revision/id
 -- order, and carries actual sealed membership/source identities/content roots.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('gameQuestionId',q."id",'gameId',q."gameId",'catalogReleaseId',q."catalogReleaseId",'questionRevisionId',q."questionRevisionId",'membership',to_jsonb(m),'revisionId',r."id",'contentHash',r."contentHash",'sourceNamespace',r."sourceNamespace",'sourceQuestionId',r."sourceQuestionId",'sourceContentHash',r."sourceContentHash",'crosswalkRevisionId',r."crosswalkRevisionId",'seal',to_jsonb(z)) ORDER BY q."questionRevisionId" COLLATE "C",q."id" COLLATE "C"),'[]'::JSONB) INTO questions FROM public."GameQuestion" q JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=q."catalogReleaseId" AND m."questionRevisionId"=q."questionRevisionId" JOIN public."QuestionRevision" r ON r."id"=q."questionRevisionId" JOIN public."QuestionRevisionSeal" z ON z."questionRevisionId"=r."id" WHERE q."gameId"=g."id";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r."id",'gameId',r."gameId",'ordinal',r."ordinal",'pin',r."pin") ORDER BY r."ordinal"),'[]'::JSONB) INTO round_pins FROM public."GameRound" r WHERE r."gameId"=g."id";
 SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY r."ordinal",i."ordinal"),'[]'::JSONB) INTO item_pins FROM public."RoundItemPin" i JOIN public."GameRound" r ON r."id"=i."roundId" WHERE r."gameId"=g."id";
 SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e."ordinal"),'[]'::JSONB) INTO exposures FROM public."EntaSourceExposure" e WHERE e."gameId"=g."id";
 competitive:=NULL;IF s."protocol"=5 THEN SELECT jsonb_build_object('header',to_jsonb(p),'roundPins',(SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY r."ordinal"),'[]'::JSONB) FROM public."CompetitiveRoundPin" c JOIN public."GameRound" r ON r."id"=c."roundId" WHERE c."gameId"=g."id")) INTO STRICT competitive FROM public."GameCompetitivePin" p WHERE p."gameId"=g."id";END IF;
 selected:=jsonb_build_object('categoryPins',category_pins,'questionRefs',questions,'roundPins',round_pins,'itemPins',item_pins,'exposures',exposures,'competitive',competitive);
 SELECT jsonb_build_object('gameId',"gameId",'sequence',"sequence",'commandId',"commandId",'type',"type",'ownerIdentityId',"actorFirebaseIdentityId",'intentHash',"intentHash") INTO STRICT start_row FROM public."GameEvent" WHERE "gameId"=g."id" AND "sequence"=1;
 legacy_link:=NULL;SELECT jsonb_build_object('childId',"childGameId",'parentId',"predecessorGameId",'parentVersion',"predecessorRuntimeVersion",'ownerIdentityId',"firebaseIdentityId") INTO legacy_link FROM public."EntaRematchLink" WHERE "childGameId"=g."id";
 SELECT jsonb_build_object('reservationId',r."id",'quantity',r."quantity",'state',r."state",'reserve',(SELECT jsonb_build_object('requestHash',e."evidenceHash",'deltaAvailable',e."deltaAvailable",'deltaHeld',e."deltaHeld",'deltaDebt',e."deltaDebt") FROM public."WalletEntry" e WHERE e."reservationId"=r."id" AND e."walletId"=a."walletId" AND e."actorFirebaseIdentityId"=s."ownerId" AND e."originType"='ADMISSION' AND e."originId"=a."id" AND e."effect"='RESERVE'),'commit',(SELECT jsonb_build_object('evidenceHash',e."evidenceHash",'deltaAvailable',e."deltaAvailable",'deltaHeld',e."deltaHeld",'deltaDebt',e."deltaDebt") FROM public."WalletEntry" e WHERE e."reservationId"=r."id" AND e."walletId"=a."walletId" AND e."actorFirebaseIdentityId"=s."ownerId" AND e."originType"='ADMISSION' AND e."originId"=a."id" AND e."effect"='COMMIT'),'entryCount',(SELECT count(*) FROM public."WalletEntry" e WHERE e."reservationId"=r."id")) INTO STRICT paid FROM public."Reservation" r WHERE r."admissionId"=a."id";
 RETURN jsonb_build_object('admission',jsonb_build_object('id',a."id",'identityId',a."firebaseIdentityId",'walletId',a."walletId",'requestVersion',a."requestVersion",'requestKey',a."requestKey",'logicalMatchId',a."logicalMatchId",'requestHash',a."requestHash",'intentHash',a."intentHash",'state',a."state",'baseReleaseId',a."catalogReleaseId",'baseRoot',a."releaseRootHash",'receiptId',a."validationReceiptId",'selector',a."selectorVersion"),
 'game',jsonb_build_object('id',g."id",'admissionId',g."admissionId",'ownerIdentityId',g."firebaseIdentityId",'profile',(SELECT jsonb_build_object('physicalProtocol',p."protocol",'format',p."format",'retainedRules',p."rules",'mode',p."mode") FROM public."E3PhysicalProfile" p WHERE p."protocol"=a."requestVersion" AND p."format"=g."executionFormat" AND p."mode"=g."mode")),'setup',setup,'setupHash',setup_hash,'nativeRequest',request,'nativeIntent',native_intent,'selected',selected,'nativeStart',start_row,'legacyLink',legacy_link,'paid',paid);
END $$;

-- Full SQL closure below compares actual native producers; external/native
-- hashes are separately recomputed. It does not relabel a result or admission.
CREATE FUNCTION public.e3_comp_assert_closure(stage_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."E3StartReservation"%ROWTYPE;w public."E3AdmissionInsertWitness"%ROWTYPE;z public."E3ImmutableSeal"%ROWTYPE;n JSONB;a JSONB;start_row JSONB;paid JSONB;terminal JSONB;expected JSONB;native_hash TEXT;legacy_link JSONB;
BEGIN
 SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;SELECT * INTO STRICT w FROM public."E3AdmissionInsertWitness" WHERE "stageId"=stage_id;SELECT * INTO STRICT z FROM public."E3ImmutableSeal" WHERE "stageId"=stage_id;
 SELECT "material" INTO STRICT terminal FROM public."E3OriginalTerminal" WHERE "gameId"=s."parentGameId" AND "ownerId"=s."ownerId" AND "terminalHash"=s."terminalHash";
 IF NOT EXISTS(SELECT 1 FROM public."E3SuccessorLink" l WHERE (l."stageId",l."ownerId",l."parentGameId",l."terminalHash",l."childGameId",l."admissionId")=(s."id",s."ownerId",s."parentGameId",s."terminalHash",z."gameId",w."admissionId")) THEN RAISE EXCEPTION 'E3_LINK_MISSING'; END IF;
 PERFORM public.e3_comp_assert_stage_material(s."id",to_jsonb(s));n:=public.e3_comp_actual_native(stage_id);a:=n->'admission';start_row:=n->'nativeStart';paid:=n->'paid';legacy_link:=n->'legacyLink';
 native_hash:=(CASE WHEN s."protocol"=5 THEN public.int9_intent_hash(n->'nativeIntent') ELSE public.int6_enta_hash(n->'nativeIntent') END);
 IF w."ownerId" IS DISTINCT FROM s."ownerId" OR w."admissionId" IS DISTINCT FROM a->>'id' OR z."admissionId" IS DISTINCT FROM w."admissionId" OR z."ownerId" IS DISTINCT FROM s."ownerId" OR z."gameId" IS DISTINCT FROM n->'game'->>'id'
 OR w."walletId" IS DISTINCT FROM s."walletId" OR a->>'baseReleaseId' IS DISTINCT FROM w."baseReleaseId" OR a->>'baseRoot' IS DISTINCT FROM w."baseRoot" OR a->>'receiptId' IS DISTINCT FROM w."receiptId" OR a->>'selector' IS DISTINCT FROM w."selector"
 OR a->>'state'<>'COMMITTED'  OR a->>'identityId' IS DISTINCT FROM s."ownerId" OR a->>'walletId' IS DISTINCT FROM s."walletId" OR a->'requestVersion' IS DISTINCT FROM to_jsonb(s."protocol") OR a->>'requestKey' IS DISTINCT FROM s."requestKey" OR a->>'logicalMatchId' IS DISTINCT FROM s."logicalId"
 OR a->>'requestHash' IS DISTINCT FROM s."nativeRequestHash" OR a->>'intentHash' IS DISTINCT FROM w."nativeIntentHash" OR native_hash IS DISTINCT FROM a->>'intentHash'
 OR n->'game'->'profile' IS DISTINCT FROM s."externalRequest"->'profile' OR n->'nativeRequest' IS DISTINCT FROM s."nativeRequest" OR n->'setup' IS DISTINCT FROM s."externalRequest"->'setup' OR n->>'setupHash' IS DISTINCT FROM public.int6_enta_hash(n->'setup')
 OR (s."protocol" IN(4,5) AND n->'game'->>'id' IS DISTINCT FROM s."logicalId") OR start_row->>'gameId' IS DISTINCT FROM z."gameId" OR start_row->'sequence' IS DISTINCT FROM '1'::JSONB OR start_row->>'commandId' IS DISTINCT FROM s."requestKey" OR start_row->>'type' IS DISTINCT FROM 'START' OR start_row->>'ownerIdentityId' IS DISTINCT FROM s."ownerId" OR start_row->>'intentHash' IS DISTINCT FROM native_hash THEN RAISE EXCEPTION 'E3_NATIVE_CLOSURE_MISMATCH';END IF;
 IF s."protocol"=3 THEN
  IF legacy_link IS DISTINCT FROM jsonb_build_object('childId',z."gameId",'parentId',s."parentGameId",'parentVersion',terminal->'event'->'sequence','ownerIdentityId',s."ownerId") THEN RAISE EXCEPTION 'E3_NATIVE3_LINK_MISMATCH';END IF;
 ELSIF legacy_link IS DISTINCT FROM 'null'::JSONB THEN RAISE EXCEPTION 'E3_UNEXPECTED_LEGACY_LINK';END IF;
 IF jsonb_array_length(n->'selected'->'questionRefs')<>(SELECT count(*) FROM public."GameQuestion" WHERE "gameId"=z."gameId")
 OR jsonb_array_length(n->'selected'->'categoryPins')<>(CASE WHEN s."mode"='KIDS' OR s."format" IN('STANDALONE_LIST','STANDALONE_ACTING') THEN 1 ELSE 6 END) THEN RAISE EXCEPTION 'E3_SELECTED_SET_INCOMPLETE';END IF;
 IF s."protocol" IN(2,3) THEN
  IF jsonb_array_length(n->'selected'->'questionRefs')<>(CASE WHEN s."mode"='KIDS' THEN 6 ELSE 36 END) OR n->'selected'->'roundPins'<>'[]'::JSONB OR n->'selected'->'itemPins'<>'[]'::JSONB OR n->'selected'->'exposures'<>'[]'::JSONB OR n->'selected'->'competitive' IS DISTINCT FROM 'null'::JSONB THEN RAISE EXCEPTION 'E3_FALSE_LEGACY_SELECTION';END IF;
 ELSE
  IF n->'nativeIntent'->'request' IS DISTINCT FROM s."nativeRequest" OR n->'nativeIntent'->'roundCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(n->'selected'->'roundPins')) THEN RAISE EXCEPTION 'E3_NATIVE_PIN_CLOSURE';END IF;
  IF s."protocol"=4 AND n->'nativeIntent'->>'pinsHash' IS DISTINCT FROM public.int6_enta_hash((SELECT jsonb_agg(x->'pin' ORDER BY ordinal) FROM jsonb_array_elements(n->'selected'->'roundPins') WITH ORDINALITY rows(x,ordinal))) THEN RAISE EXCEPTION 'E3_NATIVE_PIN_CLOSURE';END IF;
  IF s."protocol"=5 AND (n->'nativeIntent'->>'pinsHash' IS DISTINCT FROM public.int9_references_hash(n->'nativeIntent'->'selection') OR n->'nativeIntent'->'tournamentBinding' IS DISTINCT FROM 'null'::JSONB OR n->'selected'->'competitive' IS NULL OR n->'selected'->'competitive'='null'::JSONB) THEN RAISE EXCEPTION 'E3_NATIVE_PIN_CLOSURE';END IF;
 END IF;
 IF paid->'quantity' IS DISTINCT FROM '1'::JSONB OR paid->>'state'<>'COMMITTED' OR paid->'entryCount' IS DISTINCT FROM '2'::JSONB
 OR paid->'reserve' IS DISTINCT FROM jsonb_build_object('requestHash',s."nativeRequestHash",'deltaAvailable',-1,'deltaHeld',1,'deltaDebt',0)
 OR paid->'commit' IS DISTINCT FROM jsonb_build_object('evidenceHash',CASE WHEN s."protocol" IN(2,3) THEN s."nativeRequestHash" ELSE native_hash END,'deltaAvailable',0,'deltaHeld',-1,'deltaDebt',0) THEN RAISE EXCEPTION 'E3_FINANCIAL_CLOSURE_MISMATCH';END IF;
 expected:=jsonb_build_object('version',1,'owner',jsonb_build_object('namespaceId',s."namespaceId",'projectId',s."projectId",'uid',s."uid",'identityId',s."ownerId",'walletId',s."walletId"),'external',s."externalRequest",'clientHash',s."clientHash",'originalTerminal',terminal||jsonb_build_object('proofHash',s."terminalHash"),'native',n);
 IF z."fullMaterial" IS DISTINCT FROM expected OR z."fullIntentHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.seal-material.v1','material',expected)) THEN RAISE EXCEPTION 'E3_SEAL_RAW_MATERIAL_MISMATCH';END IF;
END $$;

-- INERT COMP-01 A-prime / genuine retained branch source. No SQL tooling run.
CREATE FUNCTION public.e3_comp_validate_external(r JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF public.int6_enta_exact_keys(r,ARRAY['envelopeVersion','e3Protocol','requestKey','logicalMatchId','profile','predecessor','setup']) IS NOT TRUE OR r->'envelopeVersion' IS DISTINCT FROM '6'::JSONB OR r->'e3Protocol' IS DISTINCT FROM '1'::JSONB
 OR public.int6_enta_exact_keys(r->'profile',ARRAY['physicalProtocol','format','retainedRules','mode']) IS NOT TRUE OR public.int6_enta_exact_keys(r->'predecessor',ARRAY['gameId','originalTerminalHash']) IS NOT TRUE
 OR COALESCE(r->>'requestKey'~'^[A-Za-z0-9._:-]{8,128}$',FALSE) IS NOT TRUE OR public.int8_json_id(r->'logicalMatchId') IS NOT TRUE OR public.int8_json_id(r->'predecessor'->'gameId') IS NOT TRUE OR COALESCE(r->'predecessor'->>'originalTerminalHash'~'^[a-f0-9]{64}$',FALSE) IS NOT TRUE
 OR r->'setup'->'version' IS DISTINCT FROM r->'profile'->'physicalProtocol' OR octet_length(convert_to(public.int6_enta_canonical(r),'UTF8'))>65536
 OR NOT EXISTS(SELECT 1 FROM public."E3PhysicalProfile" p WHERE to_jsonb(p."protocol")=r->'profile'->'physicalProtocol' AND p."format"=r->'profile'->>'format' AND p."rules"=r->'profile'->>'retainedRules' AND p."mode"=r->'profile'->>'mode') THEN RAISE EXCEPTION 'E3_EXTERNAL_INVALID';END IF;
END $$;

CREATE FUNCTION public.e3_comp_retry(ns TEXT,project TEXT,uid TEXT,r JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT;s public."E3StartReservation"%ROWTYPE;z public."E3ImmutableSeal"%ROWTYPE;w public."E3AdmissionInsertWitness"%ROWTYPE;actual_game TEXT;BEGIN
 PERFORM public.e3_comp_validate_external(r);identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_READY';END IF;
 SELECT * INTO s FROM public."E3StartReservation" WHERE "ownerId"=identity_id AND "requestKey"=r->>'requestKey';
 IF FOUND THEN
  IF s."namespaceId" IS DISTINCT FROM ns OR s."projectId" IS DISTINCT FROM project OR s."uid" IS DISTINCT FROM uid OR s."externalRequest" IS DISTINCT FROM r OR s."clientHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',r)) THEN RAISE EXCEPTION 'E3_EXTERNAL_IDEMPOTENCY_CONFLICT';END IF;
  SELECT * INTO STRICT w FROM public."E3AdmissionInsertWitness" WHERE "stageId"=s."id";SELECT * INTO STRICT z FROM public."E3ImmutableSeal" WHERE "stageId"=s."id";
  SELECT g."id" INTO STRICT actual_game FROM public."Game" g JOIN public."Admission" a ON a."id"=g."admissionId" AND a."firebaseIdentityId"=g."firebaseIdentityId" WHERE g."id"=z."gameId" AND g."firebaseIdentityId"=identity_id AND a."id"=w."admissionId" AND a."state"='COMMITTED' AND a."requestVersion"=s."protocol" AND a."requestKey"=s."requestKey" AND a."logicalMatchId"=s."logicalId" AND a."requestHash"=w."nativeRequestHash" AND a."intentHash"=w."nativeIntentHash";
  IF z."ownerId" IS DISTINCT FROM identity_id OR z."admissionId" IS DISTINCT FROM w."admissionId" OR z."fullMaterial"->'external' IS DISTINCT FROM r OR z."fullMaterial"->>'clientHash' IS DISTINCT FROM s."clientHash" OR z."fullIntentHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.seal-material.v1','material',z."fullMaterial")) THEN RAISE EXCEPTION 'E3_STORED_SEAL_INVALID';END IF;
  IF NOT EXISTS(SELECT 1 FROM public."E3SuccessorLink" l WHERE (l."stageId",l."ownerId",l."parentGameId",l."terminalHash",l."childGameId",l."admissionId")=(s."id",s."ownerId",s."parentGameId",s."terminalHash",z."gameId",w."admissionId")) THEN RAISE EXCEPTION 'E3_STORED_LINK_INVALID';END IF;
  -- Crucial: no catalog, debt, mutable parent/current ResultHead or native start.
  RETURN jsonb_build_object('gameId',actual_game,'admissionId',z."admissionId",'physicalProtocol',s."protocol",'envelopeVersion',6,'e3Protocol',1,'idempotent',TRUE);
 END IF;
 IF EXISTS(SELECT 1 FROM public."E3StartReservation" WHERE "ownerId"=identity_id AND "logicalId"=r->>'logicalMatchId') THEN RAISE EXCEPTION 'E3_EXTERNAL_LOGICAL_COLLISION';END IF;
 IF EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND ("requestKey"=r->>'requestKey' OR ("engine"='ENTA' AND "logicalMatchId"=r->>'logicalMatchId'))) THEN RAISE EXCEPTION 'E3_EXISTING_NATIVE_NOT_ATTACHABLE';END IF;RETURN NULL;
END $$;

CREATE FUNCTION public.e3_comp_parent(ns TEXT,project TEXT,uid TEXT,r JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT;material JSONB;BEGIN
 PERFORM public.e3_comp_validate_external(r);identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_READY';END IF;
 PERFORM 1 FROM public."Game" WHERE "id"=r->'predecessor'->>'gameId' AND "firebaseIdentityId"=identity_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'MATCH_NOT_FOUND';END IF;
 IF r->'profile'->'physicalProtocol'='3'::JSONB THEN PERFORM 1 FROM public."GameRuntime" WHERE "gameId"=r->'predecessor'->>'gameId' FOR UPDATE;END IF;
 material:=public.e3_comp_original_terminal(identity_id,r->'predecessor'->>'gameId');
 IF material->'profile' IS DISTINCT FROM r->'profile' OR public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.original-terminal.v1','material',material)) IS DISTINCT FROM r->'predecessor'->>'originalTerminalHash' THEN RAISE EXCEPTION 'E3_ORIGINAL_PARENT_MISMATCH';END IF;RETURN material;
END $$;

CREATE FUNCTION public.e3_comp_terminal_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual JSONB;BEGIN actual:=public.e3_comp_original_terminal(NEW."ownerId",NEW."gameId");
 IF NEW."material" IS DISTINCT FROM actual OR NEW."terminalHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.original-terminal.v1','material',actual))
 OR NEW."admissionId" IS DISTINCT FROM actual->>'admissionId' OR to_jsonb(NEW."protocol") IS DISTINCT FROM actual->'physicalProtocol' OR NEW."format" IS DISTINCT FROM actual->'profile'->>'format' OR NEW."rules" IS DISTINCT FROM actual->'profile'->>'retainedRules' OR NEW."mode" IS DISTINCT FROM actual->'profile'->>'mode'
 OR COALESCE(to_jsonb(NEW."legacySequence"),'null'::JSONB) IS DISTINCT FROM COALESCE(actual->'event'->'sequence',actual->'legacy'->'sequence','null'::JSONB)
 OR COALESCE(to_jsonb(NEW."authorityEventId"),'null'::JSONB) IS DISTINCT FROM COALESCE(actual->'authority'->'id','null'::JSONB) OR COALESCE(to_jsonb(NEW."resultVersion"),'null'::JSONB) IS DISTINCT FROM COALESCE(actual->'result'->'resultVersion','null'::JSONB) OR COALESCE(to_jsonb(NEW."resultHash"),'null'::JSONB) IS DISTINCT FROM COALESCE(actual->'result'->'resultHash','null'::JSONB) THEN RAISE EXCEPTION 'E3_TERMINAL_TUPLE_MISMATCH';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "E3OriginalTerminal_guard" BEFORE INSERT ON public."E3OriginalTerminal" FOR EACH ROW EXECUTE FUNCTION public.e3_comp_terminal_guard();

CREATE FUNCTION public.e3_comp_create_stage(ns TEXT,project TEXT,uid TEXT,r JSONB) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT;wallet_id TEXT;terminal JSONB;native JSONB;stage_id TEXT:=gen_random_uuid()::TEXT;BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';SELECT "id" INTO STRICT wallet_id FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 terminal:=public.e3_comp_parent(ns,project,uid,r);native:=public.e3_comp_native_request(r,terminal);
 INSERT INTO public."E3OriginalTerminal"("gameId","ownerId","admissionId","terminalHash","protocol","format","rules","mode","legacySequence","authorityEventId","resultVersion","resultHash","material") VALUES(terminal->>'gameId',identity_id,terminal->>'admissionId',r->'predecessor'->>'originalTerminalHash',(terminal->>'physicalProtocol')::INTEGER,r->'profile'->>'format',r->'profile'->>'retainedRules',r->'profile'->>'mode',COALESCE((terminal->'event'->>'sequence')::INTEGER,(terminal->'legacy'->>'sequence')::INTEGER),terminal->'authority'->>'id',(terminal->'result'->>'resultVersion')::INTEGER,terminal->'result'->>'resultHash',terminal) ON CONFLICT("gameId","ownerId","terminalHash") DO NOTHING;
 INSERT INTO public."E3StartReservation"("id","ownerId","walletId","namespaceId","projectId","uid","requestKey","logicalId","clientHash","protocol","format","rules","mode","parentGameId","terminalHash","externalRequest","nativeRequest","nativeRequestHash") VALUES(stage_id,identity_id,wallet_id,ns,project,uid,r->>'requestKey',r->>'logicalMatchId',public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',r)),(r->'profile'->>'physicalProtocol')::INTEGER,r->'profile'->>'format',r->'profile'->>'retainedRules',r->'profile'->>'mode',r->'predecessor'->>'gameId',r->'predecessor'->>'originalTerminalHash',r,native,CASE WHEN (r->'profile'->>'physicalProtocol')::INTEGER IN(2,3) THEN native->>'requestHash' ELSE public.int6_enta_hash(native) END);RETURN stage_id;
END $$;

CREATE FUNCTION public.e3_comp_finalize(stage_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."E3StartReservation"%ROWTYPE;w public."E3AdmissionInsertWitness"%ROWTYPE;terminal JSONB;n JSONB;material JSONB;BEGIN
 SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;SELECT * INTO STRICT w FROM public."E3AdmissionInsertWitness" WHERE "stageId"=stage_id;
 SELECT "material" INTO STRICT terminal FROM public."E3OriginalTerminal" WHERE "gameId"=s."parentGameId" AND "ownerId"=s."ownerId" AND "terminalHash"=s."terminalHash";n:=public.e3_comp_actual_native(stage_id);
 material:=jsonb_build_object('version',1,'owner',jsonb_build_object('namespaceId',s."namespaceId",'projectId',s."projectId",'uid',s."uid",'identityId',s."ownerId",'walletId',s."walletId"),'external',s."externalRequest",'clientHash',s."clientHash",'originalTerminal',terminal||jsonb_build_object('proofHash',s."terminalHash"),'native',n);
 INSERT INTO public."E3ImmutableSeal"("stageId","ownerId","admissionId","gameId","fullIntentHash","fullMaterial") VALUES(stage_id,s."ownerId",w."admissionId",n->'game'->>'id',public.int6_enta_hash(jsonb_build_object('domain','maydan.enta.e3.seal-material.v1','material',material)),material);
 INSERT INTO public."E3SuccessorLink"("stageId","ownerId","parentGameId","terminalHash","childGameId","admissionId") VALUES(stage_id,s."ownerId",s."parentGameId",s."terminalHash",n->'game'->>'id',w."admissionId");
 -- Explicit closure now; deferred triggers independently repeat before commit.
 PERFORM public.e3_comp_assert_closure(stage_id);
 RETURN jsonb_build_object('gameId',n->'game'->'id','admissionId',w."admissionId",'physicalProtocol',s."protocol",'envelopeVersion',6,'e3Protocol',1,'idempotent',FALSE);
END $$;

CREATE FUNCTION public.e3_comp_native4_commit(ns TEXT,project TEXT,uid TEXT,r JSONB,request JSONB,intent JSONB,pins JSONB,receipt_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE prior JSONB;identity_id TEXT;stage_id TEXT;native JSONB;BEGIN
 PERFORM public.e3_comp_validate_external(r);IF r->'profile'->'physicalProtocol' IS DISTINCT FROM '4'::JSONB THEN RAISE EXCEPTION 'E3_NATIVE4_PROFILE_REQUIRED';END IF;
 prior:=public.e3_comp_retry(ns,project,uid,r);IF prior IS NOT NULL THEN RETURN prior;END IF;
 -- Pending whole-wrapper capacity authority: deny fresh work, retain exact retry.
 RAISE EXCEPTION 'E3_CAPACITY_UNAVAILABLE';
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';IF NOT EXISTS(SELECT 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id AND "debt"=0 AND "available">=1) THEN RAISE EXCEPTION 'E3_CREDIT_UNAVAILABLE';END IF;
 native:=public.e3_comp_native_request(r,public.e3_comp_parent(ns,project,uid,r));
 IF request IS DISTINCT FROM native OR intent->'request' IS DISTINCT FROM native OR intent->>'receiptId' IS DISTINCT FROM receipt_id OR intent->>'pinsHash' IS DISTINCT FROM public.int6_enta_hash(pins) OR intent->'roundCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(pins)) THEN RAISE EXCEPTION 'E3_NATIVE4_RAW_MAPPING_MISMATCH';END IF;
 stage_id:=public.e3_comp_create_stage(ns,project,uid,r);native:=NULL;prior:=NULL;
 -- Genuine original producer remains the independent content/hash/issuer verifier.
 PERFORM public.int8_start(ns,project,uid,request,intent,pins,receipt_id);
 RETURN public.e3_comp_finalize(stage_id);
END $$;

CREATE FUNCTION public.e3_comp_legacy_receipt(ns TEXT,project TEXT,uid TEXT,stage_id TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."E3StartReservation"%ROWTYPE;catalog JSONB;BEGIN SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;
 IF s."protocol"=2 THEN catalog:=public.int6_enta_catalog(ns,project,uid);ELSIF s."protocol"=3 THEN catalog:=public.int7_enta_catalog(ns,project,uid,s."mode");ELSE RAISE EXCEPTION 'E3_LEGACY_PROFILE_REQUIRED';END IF;RETURN catalog->'receipt'->>'receiptId';END $$;

CREATE FUNCTION public.e3_comp_retained_commit(ns TEXT,project TEXT,uid TEXT,r JSONB,seed TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE prior JSONB;identity_id TEXT;stage_id TEXT;s public."E3StartReservation"%ROWTYPE;receipt_id TEXT;BEGIN
 PERFORM public.e3_comp_validate_external(r);IF r->'profile'->'physicalProtocol' NOT IN('2'::JSONB,'3'::JSONB,'5'::JSONB) THEN RAISE EXCEPTION 'E3_PROFILE_UNSUPPORTED';END IF;
 prior:=public.e3_comp_retry(ns,project,uid,r);IF prior IS NOT NULL THEN RETURN prior;END IF;
 -- Pending whole-wrapper capacity authority: deny fresh work, retain exact retry.
 RAISE EXCEPTION 'E3_CAPACITY_UNAVAILABLE';
 IF seed!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'E3_INVALID_SEED';END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';IF NOT EXISTS(SELECT 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id AND "debt"=0 AND "available">=1) THEN RAISE EXCEPTION 'E3_CREDIT_UNAVAILABLE';END IF;
 stage_id:=public.e3_comp_create_stage(ns,project,uid,r);SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;
 IF s."protocol" IN(2,3) THEN receipt_id:=public.e3_comp_legacy_receipt(ns,project,uid,stage_id);END IF;
 IF s."protocol"=2 THEN PERFORM public.int6_enta_start(ns,project,uid,s."nativeRequest",receipt_id);
 ELSIF s."protocol"=3 THEN PERFORM public.int7_enta_start(ns,project,uid,s."nativeRequest",receipt_id,s."parentGameId");
 ELSE PERFORM public.int9_start_request(ns,project,uid,s."nativeRequest",seed);END IF;
 RETURN public.e3_comp_finalize(stage_id);
END $$;

-- Full20-profile legacy+wrapper history is deliberately unavailable until the
-- exact timestamp-without-time-zone provenance obligation has separate evidence.
CREATE FUNCTION public.e3_comp_history_utc_gate() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'E3_HISTORY_UTC_PROVENANCE_UNAVAILABLE';END $$;

-- INERT Option A proposal; not parsed/compiled/executed. Bounded returned
-- material does not bound scan/group/sort work or close full native4 capacity.
-- Pool comes from exact approved immutable catalog rows, never caller JSON.
CREATE FUNCTION public.e3_comp_exposure_frontier(ns TEXT,project TEXT,uid TEXT,execution_format TEXT,category_key TEXT,release_id TEXT,format_root TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE identity_id TEXT; max_cycle INTEGER; result JSONB; pool_count BIGINT;
BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE;
 IF NOT FOUND OR COALESCE(category_key~'^[A-Za-z0-9_-]{1,128}$',FALSE) IS NOT TRUE OR COALESCE(release_id~'^[A-Za-z0-9_-]{1,128}$',FALSE) IS NOT TRUE OR COALESCE(format_root~'^[a-f0-9]{64}$',FALSE) IS NOT TRUE OR COALESCE(execution_format IN('STANDALONE_LIST','STANDALONE_ACTING'),FALSE) IS NOT TRUE THEN RAISE EXCEPTION 'E3_EXPOSURE_UNAVAILABLE';END IF;
 PERFORM 1 FROM public."ActiveCatalogPointer" a JOIN public."EntaFormatRelease" f ON f."receiptId"=a."validationReceiptId" AND f."baseReleaseId"=a."catalogReleaseId" AND f."baseRoot"=a."releaseRootHash"
 WHERE a."id"='singleton' AND f."id"=release_id AND f."formatRoot"=format_root AND f."sealedAt" IS NOT NULL FOR SHARE OF a;
 IF NOT FOUND THEN RAISE EXCEPTION 'E3_EXPOSURE_UNAVAILABLE';END IF;
 PERFORM public.int8_assert_format(release_id); -- retains real issuer/rights denial
 SELECT count(*) INTO pool_count FROM public."EntaFormatRevision" p WHERE p."releaseId"=release_id AND p."categoryKey"=category_key AND p."format"=(CASE WHEN execution_format='STANDALONE_LIST' THEN 'LIST_ITEMS' ELSE 'ACTING_ITEMS' END);
 IF pool_count<1 OR pool_count>1000 OR pool_count<>(SELECT count(*) FROM public."EntaFormatRevision" WHERE "releaseId"=release_id AND "categoryKey"=category_key) OR EXISTS(SELECT 1 FROM public."EntaFormatRevision" p WHERE p."releaseId"=release_id AND p."categoryKey"=category_key GROUP BY p."sourceNamespace",p."sourceId" HAVING count(*)>1) THEN RAISE EXCEPTION 'E3_EXPOSURE_UNAVAILABLE';END IF;
 -- Whole scoped H, including retired sources and physical4/5, is validated
 -- BEFORE projection; no JSON history constructor and no trusting omitted rows.
 IF EXISTS(SELECT 1 FROM public."EntaSourceExposure" h WHERE h."firebaseIdentityId"=identity_id AND h."executionFormat"=execution_format AND h."categoryKey"=category_key AND (h."sourceNamespace" IS NULL OR h."sourceNamespace"!~'^[A-Za-z0-9._:-]{1,128}$' OR h."sourceId" IS NULL OR h."sourceId"!~'^[A-Za-z0-9._:-]{1,200}$' OR h."cycle" IS NULL OR h."cycle"<1))
 OR EXISTS(SELECT 1 FROM public."EntaSourceExposure" h WHERE h."firebaseIdentityId"=identity_id AND h."executionFormat"=execution_format AND h."categoryKey"=category_key GROUP BY h."sourceNamespace",h."sourceId",h."cycle" HAVING count(*)>1) THEN RAISE EXCEPTION 'E3_EXPOSURE_UNAVAILABLE';END IF;
 SELECT max(h."cycle") INTO max_cycle FROM public."EntaSourceExposure" h WHERE h."firebaseIdentityId"=identity_id AND h."executionFormat"=execution_format AND h."categoryKey"=category_key;
 WITH actual_seen AS (
 SELECT h."categoryKey",h."sourceNamespace",h."sourceId",h."cycle" FROM public."EntaSourceExposure" h
 WHERE h."firebaseIdentityId"=identity_id AND h."executionFormat"=execution_format AND h."categoryKey"=category_key AND h."cycle"=max_cycle
 AND EXISTS(SELECT 1 FROM public."EntaFormatRevision" p WHERE p."releaseId"=release_id AND p."categoryKey"=category_key AND p."sourceNamespace"=h."sourceNamespace" AND p."sourceId"=h."sourceId")
 ), actual_anchor AS (
 SELECT h."categoryKey",h."sourceNamespace",h."sourceId",h."cycle" FROM public."EntaSourceExposure" h
 WHERE h."firebaseIdentityId"=identity_id AND h."executionFormat"=execution_format AND h."categoryKey"=category_key AND h."cycle"=max_cycle AND NOT EXISTS(SELECT 1 FROM actual_seen)
 ORDER BY h."sourceNamespace" COLLATE "C",h."sourceId" COLLATE "C" LIMIT 1
 ), frontier AS (SELECT * FROM actual_seen UNION ALL SELECT * FROM actual_anchor)
 SELECT COALESCE(jsonb_agg(jsonb_build_object('categoryKey',"categoryKey",'sourceNamespace',"sourceNamespace",'sourceId',"sourceId",'cycle',"cycle") ORDER BY "sourceNamespace" COLLATE "C","sourceId" COLLATE "C"),'[]'::JSONB) INTO result FROM frontier;
 RETURN result;
END $$;
