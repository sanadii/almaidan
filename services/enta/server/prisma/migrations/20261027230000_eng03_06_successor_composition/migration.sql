-- Source candidate is incomplete; prevent accidental application until reviewed.
DO $$ BEGIN RAISE EXCEPTION 'ENG03_06_IMPLEMENTATION_INCOMPLETE'; END $$;
CREATE TABLE public."HuroofSuccessorSetup" (
 "namespace" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"setupKey" TEXT NOT NULL,"parentMatchId" TEXT NOT NULL,"parentRoomId" TEXT NOT NULL,
 "originalVersion" BIGINT NOT NULL CHECK("originalVersion"=1),"originalHash" TEXT NOT NULL CHECK("originalHash"~'^[a-f0-9]{64}$'),
 "latestVersion" BIGINT NOT NULL CHECK("latestVersion">0),"latestHash" TEXT NOT NULL CHECK("latestHash"~'^[a-f0-9]{64}$'),
 "freshRoomId" TEXT NOT NULL,"freshRoomGeneration" BIGINT NOT NULL CHECK("freshRoomGeneration">0),"createKey" TEXT NOT NULL,"createRevision" BIGINT NOT NULL CHECK("createRevision"=0),
 "externalRequest" JSONB NOT NULL,"externalHash" TEXT NOT NULL CHECK("externalHash"~'^[a-f0-9]{64}$'),"createIntent" JSONB NOT NULL,"createOutcome" JSONB NOT NULL,"createStateHash" TEXT NOT NULL CHECK("createStateHash"~'^[a-f0-9]{64}$'),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("namespace","ownerId","setupKey"), UNIQUE("namespace","freshRoomId"),UNIQUE("namespace","ownerId","setupKey","freshRoomId"),UNIQUE("namespace","ownerId","createKey"),CHECK("parentRoomId"<>"freshRoomId"),
 FOREIGN KEY("namespace","parentMatchId","parentRoomId","ownerId") REFERENCES public."HuroofMatch"("namespace","id","roomId","ownerFirebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","parentMatchId","originalVersion","ownerId","originalHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","parentMatchId","latestVersion","ownerId","latestHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","freshRoomId","ownerId") REFERENCES public."HuroofRoom"("namespace","id","ownerFirebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","freshRoomId","createRevision") REFERENCES public."HuroofLobbyRevision"("namespace","roomId","revision") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."HuroofSuccessorStartReservation" (
 "stageId" TEXT PRIMARY KEY,"namespace" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"setupKey" TEXT NOT NULL,"freshRoomId" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"logicalMatchId" TEXT NOT NULL,"nativeLogicalMatchId" TEXT NOT NULL,
 "externalRequest" JSONB NOT NULL,"externalHash" TEXT NOT NULL CHECK("externalHash"~'^[a-f0-9]{64}$'),"nativeIntent" JSONB NOT NULL,"nativeInitial" JSONB NOT NULL,"nativeProjections" JSONB NOT NULL,"nativeRequestHash" TEXT NOT NULL CHECK("nativeRequestHash"~'^[a-f0-9]{64}$'),"expectedAdmissionId" TEXT NOT NULL,"expectedMatchId" TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("ownerId","requestKey"),UNIQUE("ownerId","logicalMatchId"),UNIQUE("namespace","ownerId","setupKey"),UNIQUE("stageId","ownerId","requestKey","nativeLogicalMatchId","nativeRequestHash"),UNIQUE("stageId","namespace","ownerId","setupKey","freshRoomId"),
 FOREIGN KEY("namespace","ownerId","setupKey","freshRoomId") REFERENCES public."HuroofSuccessorSetup"("namespace","ownerId","setupKey","freshRoomId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("ownerId") REFERENCES public."FirebaseIdentity"("id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."HuroofSuccessorAdmissionWitness" (
 "stageId" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL,"requestKey" TEXT NOT NULL,"nativeLogicalMatchId" TEXT NOT NULL,"nativeRequestHash" TEXT NOT NULL CHECK("nativeRequestHash"~'^[a-f0-9]{64}$'),"admissionId" TEXT NOT NULL UNIQUE,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),UNIQUE("stageId","ownerId","admissionId"),
 FOREIGN KEY("stageId","ownerId","requestKey","nativeLogicalMatchId","nativeRequestHash") REFERENCES public."HuroofSuccessorStartReservation"("stageId","ownerId","requestKey","nativeLogicalMatchId","nativeRequestHash") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("admissionId","ownerId") REFERENCES public."Admission"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."HuroofSuccessorSeal" (
 "stageId" TEXT PRIMARY KEY,"namespace" TEXT NOT NULL,"ownerId" TEXT NOT NULL,"setupKey" TEXT NOT NULL,"freshRoomId" TEXT NOT NULL,"admissionId" TEXT NOT NULL UNIQUE,"childMatchId" TEXT NOT NULL,"startSequence" BIGINT NOT NULL,"startEventId" TEXT NOT NULL,"requestKey" TEXT NOT NULL,
 "material" JSONB NOT NULL,"materialHash" TEXT NOT NULL CHECK("materialHash"~'^[a-f0-9]{64}$'),"outcome" JSONB NOT NULL,"outcomeHash" TEXT NOT NULL CHECK("outcomeHash"~'^[a-f0-9]{64}$'),"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 UNIQUE("namespace","childMatchId"),UNIQUE("stageId","namespace","ownerId","setupKey","freshRoomId","admissionId","childMatchId"),
 FOREIGN KEY("stageId","ownerId","admissionId") REFERENCES public."HuroofSuccessorAdmissionWitness"("stageId","ownerId","admissionId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("stageId","namespace","ownerId","setupKey","freshRoomId") REFERENCES public."HuroofSuccessorStartReservation"("stageId","namespace","ownerId","setupKey","freshRoomId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","childMatchId","freshRoomId","ownerId","admissionId") REFERENCES public."HuroofMatch"("namespace","id","roomId","ownerFirebaseIdentityId","admissionId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","freshRoomId","startSequence","startEventId","childMatchId") REFERENCES public."HuroofEvent"("namespace","roomId","sequence","id","matchId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY("namespace","freshRoomId","ownerId","requestKey") REFERENCES public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey") ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE FUNCTION public.eng03_06_context(c JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(c) AS keys(key)) IS DISTINCT FROM ARRAY['identityId','namespace','policyHash','policyRevision','projectId','uid']::TEXT[] OR EXISTS(SELECT 1 FROM jsonb_each(c) AS e(key,value) WHERE jsonb_typeof(value) IS DISTINCT FROM 'string') OR NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=c->>'namespace' AND n."firebaseProjectId"=c->>'projectId' AND i."id"=c->>'identityId' AND i."firebaseUid"=c->>'uid') THEN RAISE EXCEPTION 'SUCCESSOR_CONTEXT_INVALID';END IF;RETURN c;
END $$;
CREATE FUNCTION public.eng03_06_setup_request(r JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r) AS keys(key)) IS DISTINCT FROM ARRAY['config','displayName','expectedResultHash','expectedResultVersion','parentMatchId','setupKey','version']::TEXT[] OR r->'version' IS DISTINCT FROM '1'::JSONB OR COALESCE(r->>'setupKey'~'^[A-Za-z0-9_-]{1,120}$',FALSE) IS NOT TRUE OR COALESCE(r->>'parentMatchId'~'^[A-Za-z0-9_-]{1,128}$',FALSE) IS NOT TRUE OR COALESCE(r->>'expectedResultHash'~'^[a-f0-9]{64}$',FALSE) IS NOT TRUE OR public.int5b_json_integer(r->'expectedResultVersion',1,9007199254740991) IS NOT TRUE OR jsonb_typeof(r->'config') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'displayName') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_INVALID';END IF;
END $$;
CREATE FUNCTION public.eng03_06_create_key(c JSONB,k TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 's_'||public.int5b_hash_json(jsonb_build_array('eng03-06-successor-create-v1',c->>'namespace',c->>'projectId',c->>'identityId',k))
$$;
CREATE FUNCTION public.eng03_06_lock_parent(ns TEXT,room_id TEXT,owner_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM 1 FROM public."HuroofRoom" WHERE ("namespace","id","ownerFirebaseIdentityId")=(ns,room_id,owner_id) FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'SUCCESSOR_PARENT_UNAVAILABLE';END IF;END $$;
CREATE FUNCTION public.eng03_06_lock_rooms(ns TEXT,a TEXT,b TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item RECORD; BEGIN FOR item IN SELECT "id" FROM public."HuroofRoom" WHERE "namespace"=ns AND "id" IN(a,b) ORDER BY "id" COLLATE "C" FOR UPDATE LOOP NULL;END LOOP;IF NOT EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE "namespace"=ns AND "id"=a) OR NOT EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE "namespace"=ns AND "id"=b) THEN RAISE EXCEPTION 'SUCCESSOR_ROOM_UNAVAILABLE';END IF;END $$;
CREATE FUNCTION public.eng03_06_lock_room_dependents(ns TEXT,a TEXT,b TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item RECORD;BEGIN
 FOR item IN SELECT "roomId","firebaseIdentityId" FROM public."HuroofMember" WHERE "namespace"=ns AND "roomId" IN(a,b) ORDER BY "roomId" COLLATE "C","firebaseIdentityId" COLLATE "C" FOR SHARE LOOP NULL;END LOOP;
 FOR item IN SELECT "roomId" FROM public."HuroofCanonicalState" WHERE "namespace"=ns AND "roomId" IN(a,b) ORDER BY "roomId" COLLATE "C" FOR UPDATE LOOP NULL;END LOOP;
END $$;
CREATE FUNCTION public.eng03_06_assert_parent(ns TEXT,owner_id TEXT,match_id TEXT,version BIGINT,hash TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public."HuroofMatch"%ROWTYPE; original public."HuroofMatchResult"%ROWTYPE; latest public."HuroofMatchResult"%ROWTYPE;
BEGIN
 SELECT * INTO m FROM public."HuroofMatch" WHERE ("namespace","id","ownerFirebaseIdentityId")=(ns,match_id,owner_id) FOR UPDATE;
 IF NOT FOUND OR m."state" NOT IN('FINISHED','ABANDONED') THEN RAISE EXCEPTION 'SUCCESSOR_PARENT_UNAVAILABLE';END IF;
 SELECT * INTO original FROM public."HuroofMatchResult" WHERE ("namespace","matchId","ownerFirebaseIdentityId","resultVersion")=(ns,match_id,owner_id,1);
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."HuroofEvent" e WHERE (e."namespace",e."roomId",e."sequence",e."id",e."matchId")=(ns,m."roomId",original."terminalSequence",original."terminalEventId",m."id") AND e."eventType"=m."state") THEN RAISE EXCEPTION 'SUCCESSOR_ORIGINAL_UNAVAILABLE';END IF;
 SELECT * INTO latest FROM public."HuroofMatchResult" WHERE ("namespace","matchId","ownerFirebaseIdentityId")=(ns,match_id,owner_id) ORDER BY "resultVersion" DESC LIMIT 1;
 IF NOT FOUND OR latest."resultVersion" IS DISTINCT FROM version OR latest."resultHash" IS DISTINCT FROM hash THEN RAISE EXCEPTION 'SUCCESSOR_STALE_HEAD';END IF;
 RETURN jsonb_build_object('roomId',m."roomId",'originalVersion',1,'originalHash',original."resultHash",'latestVersion',latest."resultVersion",'latestHash',latest."resultHash");
END $$;
CREATE FUNCTION public.eng03_06_assert_setup(ns TEXT,owner_id TEXT,k TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."HuroofSuccessorSetup"%ROWTYPE;l public."HuroofLobbyRevision"%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey")=(ns,owner_id,k);IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO l FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId","revision","ownerFirebaseIdentityId")=(ns,s."freshRoomId",0,owner_id);
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE ("namespace","id","ownerFirebaseIdentityId","generation")=(ns,s."freshRoomId",owner_id,s."freshRoomGeneration")) OR l."requestKey" IS DISTINCT FROM s."createKey" OR convert_from(l."intent",'UTF8')::JSONB IS DISTINCT FROM s."createIntent" OR convert_from(l."outcome",'UTF8')::JSONB IS DISTINCT FROM s."createOutcome" OR l."stateHash" IS DISTINCT FROM s."createStateHash" OR l."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(l."outcome",'sha256'),'hex') OR s."externalHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-setup-v1','request',s."externalRequest")) THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_INCOMPLETE';END IF;
 RETURN jsonb_build_object('request',s."externalRequest",'outcome',s."createOutcome");
END $$;
CREATE FUNCTION public.eng03_06_successor_setup(c JSONB,r JSONB,state JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved JSONB;parent_room TEXT;parent JSONB;created JSONB;derived JSONB;create_key TEXT;native_intent JSONB;
BEGIN
 PERFORM public.eng03_06_context(c);PERFORM public.eng03_06_setup_request(r);
 IF state='null'::JSONB THEN RAISE EXCEPTION 'SUCCESSOR_STATE_INVALID';END IF;
 SELECT public.eng03_06_assert_setup(c->>'namespace',c->>'identityId',r->>'setupKey') INTO saved;
 IF saved IS NOT NULL OR state IS NULL THEN
  PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
  IF saved IS NULL THEN RETURN NULL;END IF;
  IF saved->'request' IS DISTINCT FROM r THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_CONFLICT';END IF;
  RETURN saved->'outcome'||jsonb_build_object('replayed',true);
 END IF;
 IF jsonb_typeof(state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SUCCESSOR_STATE_INVALID';END IF;
 SELECT "roomId" INTO parent_room FROM public."HuroofMatch" WHERE ("namespace","id","ownerFirebaseIdentityId")=(c->>'namespace',r->>'parentMatchId',c->>'identityId');
 IF NOT FOUND THEN RAISE EXCEPTION 'SUCCESSOR_PARENT_UNAVAILABLE';END IF;
 PERFORM public.eng03_06_lock_parent(c->>'namespace',parent_room,c->>'identityId');PERFORM public.eng03_06_lock_room_dependents(c->>'namespace',parent_room,parent_room);
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 saved:=public.eng03_06_assert_setup(c->>'namespace',c->>'identityId',r->>'setupKey');IF saved IS NOT NULL THEN IF saved->'request' IS DISTINCT FROM r THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_CONFLICT';END IF; RETURN saved->'outcome'||jsonb_build_object('replayed',true);END IF;
 parent:=public.eng03_06_assert_parent(c->>'namespace',c->>'identityId',r->>'parentMatchId',(r->>'expectedResultVersion')::BIGINT,r->>'expectedResultHash');
 create_key:=public.eng03_06_create_key(c,r->>'setupKey');derived:=public.eng03_03_create_identity(c->>'namespace',c->>'projectId',c->>'identityId',create_key);
 IF derived->>'roomId'=parent_room OR EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE ("namespace","id")=(c->>'namespace',derived->>'roomId')) THEN RAISE EXCEPTION 'SUCCESSOR_FRESH_ROOM_COLLISION';END IF;
 native_intent:=jsonb_build_object('type','CREATE_ROOM','intentId',create_key,'displayName',r->'displayName','config',r->'config');
 created:=public.eng03_03_setup_create(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash',create_key,native_intent,state);
 IF created->'replayed' IS DISTINCT FROM 'false'::JSONB OR created->'revision' IS DISTINCT FROM '0'::JSONB OR created->>'roomId' IS DISTINCT FROM derived->>'roomId' THEN RAISE EXCEPTION 'SUCCESSOR_NATIVE_CREATE_REPLAY';END IF;
 INSERT INTO public."HuroofSuccessorSetup"("namespace","ownerId","setupKey","parentMatchId","parentRoomId","originalVersion","originalHash","latestVersion","latestHash","freshRoomId","freshRoomGeneration","createKey","createRevision","externalRequest","externalHash","createIntent","createOutcome","createStateHash") VALUES(c->>'namespace',c->>'identityId',r->>'setupKey',r->>'parentMatchId',parent_room,1,parent->>'originalHash',(parent->>'latestVersion')::BIGINT,parent->>'latestHash',derived->>'roomId',1,create_key,0,r,public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-setup-v1','request',r)),native_intent,created,public.int5b_hash_json(state));
 RETURN created;
END $$;
CREATE FUNCTION public.eng03_06_start_request(r JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r) AS keys(key)) IS DISTINCT FROM ARRAY['expectedRevision','logicalMatchId','profileScope','requestKey','setupKey','version']::TEXT[] OR r->'version' IS DISTINCT FROM '1'::JSONB OR COALESCE(r->>'requestKey'~'^[A-Za-z0-9_-]{1,120}$',FALSE) IS NOT TRUE OR COALESCE(r->>'logicalMatchId'~'^[A-Za-z0-9_-]{1,128}$',FALSE) IS NOT TRUE OR COALESCE(r->>'setupKey'~'^[A-Za-z0-9_-]{1,120}$',FALSE) IS NOT TRUE OR COALESCE(r->>'profileScope'~'^[A-Za-z0-9_-]{1,120}$',FALSE) IS NOT TRUE OR public.int5b_json_integer(r->'expectedRevision',0,9007199254740991) IS NOT TRUE THEN RAISE EXCEPTION 'SUCCESSOR_START_INVALID';END IF;
END $$;
CREATE FUNCTION public.eng03_06_admission_witness() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "nativeLogicalMatchId"=NEW."logicalMatchId");
 IF n=0 THEN RETURN NULL;END IF;IF n<>1 THEN RAISE EXCEPTION 'SUCCESSOR_CROSS_STAGE_COLLISION';END IF;
 SELECT * INTO STRICT s FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "nativeLogicalMatchId"=NEW."logicalMatchId");
 IF NEW."id" IS DISTINCT FROM s."expectedAdmissionId" OR NEW."engine" IS DISTINCT FROM 'HUROOF' OR NEW."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR NEW."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR NEW."state" IS DISTINCT FROM 'HELD' OR NEW."version" IS DISTINCT FROM 0 OR NEW."requestKey" IS DISTINCT FROM s."requestKey" OR NEW."logicalMatchId" IS DISTINCT FROM s."nativeLogicalMatchId" OR NEW."requestHash" IS DISTINCT FROM s."nativeRequestHash" OR NEW."predecessorAdmissionId" IS NOT NULL THEN RAISE EXCEPTION 'SUCCESSOR_ORIGIN_MISMATCH';END IF;
 INSERT INTO public."HuroofSuccessorAdmissionWitness"("stageId","ownerId","requestKey","nativeLogicalMatchId","nativeRequestHash","admissionId") VALUES(s."stageId",s."ownerId",s."requestKey",s."nativeLogicalMatchId",s."nativeRequestHash",NEW."id");RETURN NULL;
END $$;
CREATE TRIGGER "Admission_HuroofSuccessor_origin" AFTER INSERT ON public."Admission" FOR EACH ROW WHEN (NEW."storageAuthority"='PG_HUROOF_V2') EXECUTE FUNCTION public.eng03_06_admission_witness();
CREATE FUNCTION public.eng03_06_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'SUCCESSOR_IMMUTABLE';END $$;
CREATE TRIGGER "HuroofSuccessorSetup_immutable" BEFORE UPDATE OR DELETE ON public."HuroofSuccessorSetup" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorSetup_no_truncate" BEFORE TRUNCATE ON public."HuroofSuccessorSetup" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorStartReservation_immutable" BEFORE UPDATE OR DELETE ON public."HuroofSuccessorStartReservation" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorStartReservation_no_truncate" BEFORE TRUNCATE ON public."HuroofSuccessorStartReservation" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorAdmissionWitness_immutable" BEFORE UPDATE OR DELETE ON public."HuroofSuccessorAdmissionWitness" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorAdmissionWitness_no_truncate" BEFORE TRUNCATE ON public."HuroofSuccessorAdmissionWitness" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorSeal_immutable" BEFORE UPDATE OR DELETE ON public."HuroofSuccessorSeal" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_immutable();
CREATE TRIGGER "HuroofSuccessorSeal_no_truncate" BEFORE TRUNCATE ON public."HuroofSuccessorSeal" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_06_immutable();
CREATE FUNCTION public.eng03_06_setup_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l public."HuroofLobbyRevision"%ROWTYPE; project TEXT;ctx JSONB;derived JSONB;BEGIN
 PERFORM public.eng03_06_setup_request(NEW."externalRequest");
 SELECT n."firebaseProjectId" INTO project FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=NEW."namespace" AND i."id"=NEW."ownerId";
 IF NOT FOUND THEN RAISE EXCEPTION 'SUCCESSOR_CONTEXT_INVALID';END IF;
 ctx:=jsonb_build_object('namespace',NEW."namespace",'projectId',project,'identityId',NEW."ownerId");
 IF NEW."createKey" IS DISTINCT FROM public.eng03_06_create_key(ctx,NEW."setupKey") THEN RAISE EXCEPTION 'SUCCESSOR_CREATE_KEY_INVALID';END IF;
 derived:=public.eng03_03_create_identity(NEW."namespace",project,NEW."ownerId",NEW."createKey");
 IF NEW."freshRoomId" IS DISTINCT FROM derived->>'roomId' OR NEW."createOutcome"->>'locator' IS DISTINCT FROM 'M2-'||(derived->>'code') OR NEW."createIntent"->>'type' IS DISTINCT FROM 'CREATE_ROOM' OR NEW."createIntent"->>'intentId' IS DISTINCT FROM NEW."createKey" THEN RAISE EXCEPTION 'SUCCESSOR_CREATE_IDENTITY_INVALID';END IF;
 IF NEW."setupKey" IS DISTINCT FROM NEW."externalRequest"->>'setupKey' OR NEW."parentMatchId" IS DISTINCT FROM NEW."externalRequest"->>'parentMatchId' OR NEW."latestVersion"::TEXT IS DISTINCT FROM NEW."externalRequest"->>'expectedResultVersion' OR NEW."latestHash" IS DISTINCT FROM NEW."externalRequest"->>'expectedResultHash' OR NEW."externalHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-setup-v1','request',NEW."externalRequest")) OR NEW."createIntent"->'config' IS DISTINCT FROM NEW."externalRequest"->'config' OR NEW."createIntent"->'displayName' IS DISTINCT FROM NEW."externalRequest"->'displayName' OR EXISTS(SELECT 1 FROM public."HuroofMatchResult" WHERE "namespace"=NEW."namespace" AND "matchId"=NEW."parentMatchId" AND "resultVersion">NEW."latestVersion") THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_BINDING_INVALID';END IF;
 SELECT * INTO l FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId","revision","ownerFirebaseIdentityId","actorFirebaseIdentityId","requestKey")=(NEW."namespace",NEW."freshRoomId",0,NEW."ownerId",NEW."ownerId",NEW."createKey");
 IF NOT FOUND OR convert_from(l."intent",'UTF8')::JSONB IS DISTINCT FROM NEW."createIntent" OR convert_from(l."outcome",'UTF8')::JSONB IS DISTINCT FROM NEW."createOutcome" OR l."stateHash" IS DISTINCT FROM NEW."createStateHash" OR l."roomGeneration" IS DISTINCT FROM NEW."freshRoomGeneration" OR NEW."createOutcome"->'replayed' IS DISTINCT FROM 'false'::JSONB OR NEW."createOutcome"->'revision' IS DISTINCT FROM '0'::JSONB THEN RAISE EXCEPTION 'SUCCESSOR_CREATE_BINDING_INVALID';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "HuroofSuccessorSetup_guard" BEFORE INSERT ON public."HuroofSuccessorSetup" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_setup_guard();
CREATE FUNCTION public.eng03_06_stage_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids JSONB;project TEXT;envelope JSONB;
BEGIN
 PERFORM public.eng03_06_start_request(NEW."externalRequest");
 SELECT n."firebaseProjectId" INTO project FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=NEW."namespace" AND i."id"=NEW."ownerId";
 IF NOT FOUND OR NEW."externalRequest"->>'requestKey' IS DISTINCT FROM NEW."requestKey" OR NEW."externalRequest"->>'logicalMatchId' IS DISTINCT FROM NEW."logicalMatchId" OR NEW."externalRequest"->>'setupKey' IS DISTINCT FROM NEW."setupKey" OR NEW."externalHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-start-v1','request',NEW."externalRequest")) OR EXISTS(SELECT 1 FROM public."Admission" a WHERE a."firebaseIdentityId"=NEW."ownerId" AND (a."requestKey"=NEW."requestKey" OR (a."engine"='HUROOF' AND a."logicalMatchId"=NEW."nativeLogicalMatchId"))) THEN RAISE EXCEPTION 'SUCCESSOR_STAGE_INVALID';END IF;
 ids:=public.eng03_03_paid_identity(NEW."namespace",project,NEW."ownerId",NEW."freshRoomId",NEW."requestKey");
 envelope:=jsonb_build_object('version',2,'identityId',NEW."ownerId",'requestKey',NEW."requestKey",'logicalMatchId',NEW."nativeLogicalMatchId",'intent',NEW."nativeIntent"-'requestHash','initial',NEW."nativeInitial");
 IF ids->>'admissionId' IS DISTINCT FROM NEW."expectedAdmissionId" OR ids->>'matchId' IS DISTINCT FROM NEW."expectedMatchId" OR ids->>'logicalMatchId' IS DISTINCT FROM NEW."nativeLogicalMatchId" OR NEW."nativeRequestHash" IS DISTINCT FROM public.int5b_hash_json(envelope) OR NEW."nativeIntent"->>'namespace' IS DISTINCT FROM NEW."namespace" OR NEW."nativeIntent"->>'roomId' IS DISTINCT FROM NEW."freshRoomId" OR NEW."nativeIntent"->>'requestKey' IS DISTINCT FROM NEW."requestKey" OR NEW."nativeIntent"->>'logicalMatchId' IS DISTINCT FROM NEW."nativeLogicalMatchId" OR NEW."nativeIntent"->>'profileScope' IS DISTINCT FROM NEW."externalRequest"->>'profileScope' OR NEW."nativeIntent"->>'lobbyRevision' IS DISTINCT FROM NEW."externalRequest"->>'expectedRevision' OR NEW."nativeIntent"->>'admissionId' IS DISTINCT FROM NEW."expectedAdmissionId" OR NEW."nativeIntent"->>'matchId' IS DISTINCT FROM NEW."expectedMatchId" THEN RAISE EXCEPTION 'SUCCESSOR_NATIVE_STAGE_MISMATCH';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "HuroofSuccessorStartReservation_guard" BEFORE INSERT ON public."HuroofSuccessorStartReservation" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_stage_guard();
CREATE FUNCTION public.eng03_06_successor_retry(c JSONB,r JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;w public."HuroofSuccessorAdmissionWitness"%ROWTYPE;z public."HuroofSuccessorSeal"%ROWTYPE;a public."Admission"%ROWTYPE;m public."HuroofMatch"%ROWTYPE;receipt public."HuroofCommandReceipt"%ROWTYPE;setup public."HuroofSuccessorSetup"%ROWTYPE;
BEGIN
 PERFORM public.eng03_06_context(c);PERFORM public.eng03_06_start_request(r);
 PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=c->>'identityId' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_UNAVAILABLE';END IF;
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 SELECT * INTO s FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "requestKey"=r->>'requestKey';
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "logicalMatchId"=r->>'logicalMatchId') OR EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=c->>'identityId' AND "requestKey"=r->>'requestKey') THEN RAISE EXCEPTION 'SUCCESSOR_IDEMPOTENCY_COLLISION';END IF;RETURN NULL;
 END IF;
 IF s."namespace" IS DISTINCT FROM c->>'namespace' OR s."externalRequest" IS DISTINCT FROM r OR s."externalHash" IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-start-v1','request',r)) THEN RAISE EXCEPTION 'SUCCESSOR_IDEMPOTENCY_CONFLICT';END IF;
 SELECT * INTO STRICT w FROM public."HuroofSuccessorAdmissionWitness" WHERE "stageId"=s."stageId";
 SELECT * INTO STRICT z FROM public."HuroofSuccessorSeal" WHERE "stageId"=s."stageId";
 SELECT * INTO STRICT a FROM public."Admission" WHERE "id"=w."admissionId" AND "firebaseIdentityId"=s."ownerId";
 SELECT * INTO STRICT m FROM public."HuroofMatch" WHERE ("namespace","id","ownerFirebaseIdentityId","admissionId")=(s."namespace",z."childMatchId",s."ownerId",a."id");
 SELECT * INTO STRICT receipt FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId")=(s."namespace",s."freshRoomId",s."ownerId",s."requestKey",m."id");
 SELECT * INTO STRICT setup FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey")=(s."namespace",s."ownerId",s."setupKey");
 IF a."state" IS DISTINCT FROM 'COMMITTED' OR a."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR a."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR a."requestHash" IS DISTINCT FROM s."nativeRequestHash" OR a."intentHash" IS DISTINCT FROM m."rawIntentHash" OR m."rawIntentHash" IS DISTINCT FROM encode(int4_crypto.digest(m."rawIntent",'sha256'),'hex') OR receipt."intent" IS DISTINCT FROM m."rawIntent" OR receipt."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(receipt."outcome",'sha256'),'hex') OR convert_from(receipt."outcome",'UTF8')::JSONB IS DISTINCT FROM z."outcome" OR z."outcomeHash" IS DISTINCT FROM public.int5b_hash_json(z."outcome") OR z."materialHash" IS DISTINCT FROM public.int5b_hash_json(z."material") OR z."material"->'externalRequest' IS DISTINCT FROM r OR z."material"->>'externalHash' IS DISTINCT FROM s."externalHash" OR z."material"->'stage' IS DISTINCT FROM to_jsonb(s) OR z."material"->'setup' IS DISTINCT FROM to_jsonb(setup) OR z."material"->'witness' IS DISTINCT FROM to_jsonb(w) OR z."material"->'admission'->>'id' IS DISTINCT FROM a."id" OR z."material"->'match'->>'id' IS DISTINCT FROM m."id" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request' IS DISTINCT FROM jsonb_build_object('version',2,'identityId',s."ownerId",'requestKey',s."requestKey",'logicalMatchId',s."nativeLogicalMatchId",'intent',s."nativeIntent"-'requestHash','initial',s."nativeInitial") OR NOT EXISTS(SELECT 1 FROM public."HuroofEvent" e WHERE (e."namespace",e."roomId",e."sequence",e."id",e."matchId",e."eventType")=(s."namespace",s."freshRoomId",z."startSequence",z."startEventId",m."id",'STARTED') AND e."sequence"=1) OR NOT EXISTS(SELECT 1 FROM public."HuroofRematchLink" l WHERE (l."namespace",l."childMatchId",l."predecessorMatchId",l."ownerFirebaseIdentityId",l."predecessorResultVersion",l."predecessorResultHash")=(s."namespace",m."id",setup."parentMatchId",s."ownerId",setup."latestVersion",setup."latestHash")) THEN RAISE EXCEPTION 'SUCCESSOR_SEALED_RETRY_INVALID';END IF;
 RETURN z."outcome"||jsonb_build_object('replayed',true);
END $$;
CREATE FUNCTION public.eng03_06_native_material(stage_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;u public."HuroofSuccessorSetup"%ROWTYPE;w public."HuroofSuccessorAdmissionWitness"%ROWTYPE;a public."Admission"%ROWTYPE;m public."HuroofMatch"%ROWTYPE;p public."HuroofMatchPin"%ROWTYPE;e public."HuroofEvent"%ROWTYPE;c public."HuroofCommandReceipt"%ROWTYPE;v public."Reservation"%ROWTYPE;entries JSONB;projections JSONB;envelope JSONB;
BEGIN
 SELECT * INTO STRICT s FROM public."HuroofSuccessorStartReservation" WHERE "stageId"=stage_id;
 SELECT * INTO STRICT u FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey","freshRoomId")=(s."namespace",s."ownerId",s."setupKey",s."freshRoomId");
 SELECT * INTO STRICT w FROM public."HuroofSuccessorAdmissionWitness" WHERE "stageId"=s."stageId";
 SELECT * INTO STRICT a FROM public."Admission" WHERE ("id","firebaseIdentityId")=(w."admissionId",s."ownerId");
 SELECT * INTO STRICT m FROM public."HuroofMatch" WHERE ("namespace","id","roomId","ownerFirebaseIdentityId","admissionId")=(s."namespace",s."expectedMatchId",s."freshRoomId",s."ownerId",a."id");
 SELECT * INTO STRICT p FROM public."HuroofMatchPin" WHERE ("namespace","matchId")=(s."namespace",m."id");
 SELECT * INTO STRICT e FROM public."HuroofEvent" WHERE ("namespace","roomId","matchId","sequence","eventType","actorFirebaseIdentityId","requestKey")=(s."namespace",s."freshRoomId",m."id",1,'STARTED',s."ownerId",s."requestKey");
 SELECT * INTO STRICT c FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId")=(s."namespace",s."freshRoomId",s."ownerId",s."requestKey",m."id");
 SELECT * INTO STRICT v FROM public."Reservation" WHERE "admissionId"=a."id";
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x."sequence") INTO entries FROM public."WalletEntry" x WHERE x."originType"='ADMISSION' AND x."originId"=a."id";
 SELECT jsonb_agg(to_jsonb(pr) ORDER BY pr."audience" COLLATE "C",pr."scope" COLLATE "C") INTO projections FROM public."HuroofProjection" pr WHERE (pr."namespace",pr."roomId")=(s."namespace",s."freshRoomId");
 envelope:=jsonb_build_object('version',2,'identityId',s."ownerId",'requestKey',s."requestKey",'logicalMatchId',s."nativeLogicalMatchId",'intent',s."nativeIntent"-'requestHash','initial',s."nativeInitial");
 IF a."id" IS DISTINCT FROM s."expectedAdmissionId" OR a."engine" IS DISTINCT FROM 'HUROOF' OR a."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR a."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR a."state" IS DISTINCT FROM 'COMMITTED' OR a."requestKey" IS DISTINCT FROM s."requestKey" OR a."logicalMatchId" IS DISTINCT FROM s."nativeLogicalMatchId" OR a."requestHash" IS DISTINCT FROM s."nativeRequestHash" OR a."predecessorAdmissionId" IS NOT NULL OR m."state" IS DISTINCT FROM 'ACTIVE' OR m."rawIntentHash" IS DISTINCT FROM encode(int4_crypto.digest(m."rawIntent",'sha256'),'hex') OR a."intentHash" IS DISTINCT FROM m."rawIntentHash" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request' IS DISTINCT FROM envelope OR c."intent" IS DISTINCT FROM m."rawIntent" OR c."intentHash" IS DISTINCT FROM m."rawIntentHash" OR c."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(c."outcome",'sha256'),'hex') OR c."resultingSequence"<>1 OR c."resultingRevision" IS DISTINCT FROM e."revision" OR convert_from(c."outcome",'UTF8')::JSONB->>'admissionId' IS DISTINCT FROM a."id" OR convert_from(c."outcome",'UTF8')::JSONB->>'matchId' IS DISTINCT FROM m."id" OR convert_from(c."outcome",'UTF8')::JSONB->>'roomId' IS DISTINCT FROM s."freshRoomId" OR convert_from(c."outcome",'UTF8')::JSONB->>'status' IS DISTINCT FROM 'STARTED' OR convert_from(c."outcome",'UTF8')::JSONB->>'state' IS DISTINCT FROM 'COMMITTED' OR convert_from(c."outcome",'UTF8')::JSONB->'replayed' IS DISTINCT FROM 'false'::JSONB OR convert_from(c."outcome",'UTF8')::JSONB->'sequence' IS DISTINCT FROM '1'::JSONB OR convert_from(c."outcome",'UTF8')::JSONB->>'revision' IS DISTINCT FROM e."revision"::TEXT OR p."config" IS DISTINCT FROM s."nativeInitial"->'config' OR m."config" IS DISTINCT FROM s."nativeInitial"->'config' OR m."configHash" IS DISTINCT FROM s."nativeInitial"->>'configHash' OR p."profile" IS DISTINCT FROM m."profile" OR p."profileRawArtifactId" IS DISTINCT FROM m."profileRawArtifactId" OR p."profileRawArtifactHash" IS DISTINCT FROM m."profileHash" OR p."validationReceiptId" IS DISTINCT FROM convert_from(m."rawIntent",'UTF8')::JSONB->'resolved'->>'validationReceiptId' OR p."catalogReleaseId" IS DISTINCT FROM convert_from(m."rawIntent",'UTF8')::JSONB->'resolved'->>'catalogReleaseId' OR p."releaseRootHash" IS DISTINCT FROM convert_from(m."rawIntent",'UTF8')::JSONB->'resolved'->>'releaseRootHash' OR v."state" IS DISTINCT FROM 'COMMITTED' OR v."quantity"<>1 OR jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries)<>2 THEN RAISE EXCEPTION 'SUCCESSOR_NATIVE_MATERIAL_INVALID';END IF;
 IF jsonb_typeof(s."nativeProjections") IS DISTINCT FROM 'array' OR jsonb_typeof(projections) IS DISTINCT FROM 'array' OR jsonb_array_length(projections)<>jsonb_array_length(s."nativeProjections")+1 OR NOT EXISTS(SELECT 1 FROM public."HuroofProjection" pr WHERE (pr."namespace",pr."roomId",pr."audience",pr."scope",pr."revision",pr."throughSequence")=(s."namespace",s."freshRoomId",'PUBLIC','public',e."revision",1)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(s."nativeProjections") j(value) WHERE NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" fi JOIN public."HuroofProjection" pr ON pr."scope"=fi."id" AND pr."namespace"=s."namespace" AND pr."roomId"=s."freshRoomId" WHERE fi."firebaseUid"=j.value->>'uid' AND EXISTS(SELECT 1 FROM public."DeploymentNamespace" n WHERE n."namespaceId"=s."namespace" AND n."firebaseProjectId"=fi."firebaseProjectId") AND pr."revision"=e."revision" AND pr."throughSequence"=1 AND pr."payload" IS NOT DISTINCT FROM j.value->'payload')) THEN RAISE EXCEPTION 'SUCCESSOR_PROJECTION_MISMATCH';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."WalletEntry" x WHERE x."originType"='ADMISSION' AND x."originId"=a."id" AND x."walletId"=a."walletId" AND x."reservationId"=v."id" AND x."actorFirebaseIdentityId"=s."ownerId" AND x."effect"='RESERVE' AND x."deltaAvailable"=-1 AND x."deltaHeld"=1 AND x."deltaDebt"=0) OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" x WHERE x."originType"='ADMISSION' AND x."originId"=a."id" AND x."walletId"=a."walletId" AND x."reservationId"=v."id" AND x."actorFirebaseIdentityId"=s."ownerId" AND x."effect"='COMMIT' AND x."deltaAvailable"=0 AND x."deltaHeld"=-1 AND x."deltaDebt"=0) THEN RAISE EXCEPTION 'SUCCESSOR_CHARGE_MISMATCH';END IF;
 RETURN jsonb_build_object('version',1,'externalRequest',s."externalRequest",'externalHash',s."externalHash",'stage',to_jsonb(s),'setup',to_jsonb(u),'witness',to_jsonb(w),'admission',to_jsonb(a),'match',to_jsonb(m),'pin',to_jsonb(p),'event',to_jsonb(e),'receipt',to_jsonb(c),'reservation',to_jsonb(v),'entries',entries,'projections',projections);
END $$;
CREATE FUNCTION public.eng03_06_seal_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actual JSONB;BEGIN
 actual:=public.eng03_06_native_material(NEW."stageId");
 IF NEW."namespace" IS DISTINCT FROM actual->'stage'->>'namespace' OR NEW."ownerId" IS DISTINCT FROM actual->'stage'->>'ownerId' OR NEW."setupKey" IS DISTINCT FROM actual->'stage'->>'setupKey' OR NEW."freshRoomId" IS DISTINCT FROM actual->'stage'->>'freshRoomId' OR NEW."requestKey" IS DISTINCT FROM actual->'stage'->>'requestKey' OR NEW."admissionId" IS DISTINCT FROM actual->'admission'->>'id' OR NEW."childMatchId" IS DISTINCT FROM actual->'match'->>'id' OR NEW."startSequence" IS DISTINCT FROM 1 OR NEW."startEventId" IS DISTINCT FROM actual->'event'->>'id' OR NEW."material" IS DISTINCT FROM actual OR NEW."materialHash" IS DISTINCT FROM public.int5b_hash_json(actual) OR NEW."outcome" IS DISTINCT FROM (SELECT convert_from(c."outcome",'UTF8')::JSONB FROM public."HuroofCommandReceipt" c WHERE (c."namespace",c."roomId",c."actorFirebaseIdentityId",c."requestKey")=(NEW."namespace",NEW."freshRoomId",NEW."ownerId",NEW."requestKey")) OR NEW."outcomeHash" IS DISTINCT FROM public.int5b_hash_json(NEW."outcome") THEN RAISE EXCEPTION 'SUCCESSOR_SEAL_MISMATCH';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "HuroofSuccessorSeal_guard" BEFORE INSERT ON public."HuroofSuccessorSeal" FOR EACH ROW EXECUTE FUNCTION public.eng03_06_seal_guard();
CREATE FUNCTION public.eng03_06_assert_closure(stage_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;u public."HuroofSuccessorSetup"%ROWTYPE;z public."HuroofSuccessorSeal"%ROWTYPE;actual JSONB;
BEGIN
 SELECT * INTO STRICT s FROM public."HuroofSuccessorStartReservation" WHERE "stageId"=stage_id;
 SELECT * INTO STRICT u FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey","freshRoomId")=(s."namespace",s."ownerId",s."setupKey",s."freshRoomId");
 SELECT * INTO STRICT z FROM public."HuroofSuccessorSeal" WHERE "stageId"=stage_id;
 actual:=public.eng03_06_native_material(stage_id);
 IF z."material" IS DISTINCT FROM actual OR z."materialHash" IS DISTINCT FROM public.int5b_hash_json(actual) OR z."outcomeHash" IS DISTINCT FROM public.int5b_hash_json(z."outcome") OR z."childMatchId" IS DISTINCT FROM s."expectedMatchId" OR z."admissionId" IS DISTINCT FROM s."expectedAdmissionId" OR NOT EXISTS(SELECT 1 FROM public."HuroofRematchLink" l WHERE (l."namespace",l."childMatchId",l."predecessorMatchId",l."ownerFirebaseIdentityId",l."predecessorResultVersion",l."predecessorResultHash")=(s."namespace",s."expectedMatchId",u."parentMatchId",s."ownerId",u."latestVersion",u."latestHash")) THEN RAISE EXCEPTION 'SUCCESSOR_CLOSURE_MISMATCH';END IF;
END $$;
CREATE FUNCTION public.eng03_06_deferred_close() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.eng03_06_assert_closure(NEW."stageId");RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER "HuroofSuccessorStartReservation_closed" AFTER INSERT ON public."HuroofSuccessorStartReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_06_deferred_close();
CREATE CONSTRAINT TRIGGER "HuroofSuccessorAdmissionWitness_closed" AFTER INSERT ON public."HuroofSuccessorAdmissionWitness" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_06_deferred_close();
CREATE CONSTRAINT TRIGGER "HuroofSuccessorSeal_closed" AFTER INSERT ON public."HuroofSuccessorSeal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_06_deferred_close();

CREATE OR REPLACE FUNCTION public.eng03_02_rematch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'rematch relation is append-only'; END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofMatch" child JOIN public."HuroofMatch" prior ON (prior."namespace",prior."id",prior."ownerFirebaseIdentityId")=(NEW."namespace",NEW."predecessorMatchId",NEW."ownerFirebaseIdentityId") WHERE (child."namespace",child."id",child."ownerFirebaseIdentityId")=(NEW."namespace",NEW."childMatchId",NEW."ownerFirebaseIdentityId") AND child."roomId"<>prior."roomId") THEN
  IF NOT EXISTS(SELECT 1 FROM public."HuroofSuccessorSetup" u JOIN public."HuroofSuccessorStartReservation" s ON (s."namespace",s."ownerId",s."setupKey",s."freshRoomId")=(u."namespace",u."ownerId",u."setupKey",u."freshRoomId") JOIN public."HuroofSuccessorAdmissionWitness" w ON (w."stageId",w."ownerId")=(s."stageId",s."ownerId") JOIN public."HuroofSuccessorSeal" z ON (z."stageId",z."ownerId",z."admissionId")=(s."stageId",s."ownerId",w."admissionId") WHERE (u."namespace",u."ownerId",u."parentMatchId",u."latestVersion",u."latestHash",z."childMatchId")=(NEW."namespace",NEW."ownerFirebaseIdentityId",NEW."predecessorMatchId",NEW."predecessorResultVersion",NEW."predecessorResultHash",NEW."childMatchId") AND z."material"=public.eng03_06_native_material(s."stageId") AND z."materialHash"=public.int5b_hash_json(z."material")) THEN RAISE EXCEPTION 'SUCCESSOR_CROSS_ROOM_CLOSURE_INVALID';END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofMatch" child JOIN public."HuroofMatch" prior ON prior."namespace"=child."namespace" AND prior."roomId"=child."roomId" AND prior."ownerFirebaseIdentityId"=child."ownerFirebaseIdentityId" JOIN public."HuroofMatchResult" r ON r."namespace"=prior."namespace" AND r."matchId"=prior."id" AND r."resultVersion"=NEW."predecessorResultVersion" AND r."resultHash"=NEW."predecessorResultHash" AND r."ownerFirebaseIdentityId"=prior."ownerFirebaseIdentityId" JOIN public."HuroofEvent" e ON e."namespace"=r."namespace" AND e."roomId"=r."roomId" AND e."matchId"=r."matchId" AND e."sequence"=r."terminalSequence" AND e."id"=r."terminalEventId" WHERE (child."namespace",child."id",child."ownerFirebaseIdentityId")=(NEW."namespace",NEW."childMatchId",NEW."ownerFirebaseIdentityId") AND child."state"='STARTED' AND (prior."namespace",prior."id")=(NEW."namespace",NEW."predecessorMatchId") AND prior."state" IN ('FINISHED','ABANDONED') AND e."eventType"=prior."state") THEN RAISE EXCEPTION 'rematch requires same-owner same-room terminal predecessor result and a new STARTED child'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.eng03_06_successor_start(c JSONB,r JSONB,intent JSONB,initial JSONB,projections JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public."HuroofSuccessorSetup"%ROWTYPE;s public."HuroofSuccessorStartReservation"%ROWTYPE;ids JSONB;parent JSONB;stage_id TEXT;native_hash TEXT;reply JSONB;material JSONB;event_id TEXT;
BEGIN
 PERFORM public.eng03_06_context(c);PERFORM public.eng03_06_start_request(r);
 PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=c->>'identityId' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "requestKey"=r->>'requestKey') THEN RETURN public.eng03_06_successor_retry(c,r);END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "logicalMatchId"=r->>'logicalMatchId') OR EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=c->>'identityId' AND "requestKey"=r->>'requestKey') THEN RAISE EXCEPTION 'SUCCESSOR_IDEMPOTENCY_COLLISION';END IF;
 -- SQL-visible whole-wrapper capacity authority remains unproved; never bypass via direct EXECUTE.
 RAISE EXCEPTION 'SUCCESSOR_CAPACITY_UNAVAILABLE';
 SELECT * INTO u FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey")=(c->>'namespace',c->>'identityId',r->>'setupKey');IF NOT FOUND THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_UNAVAILABLE';END IF;
 PERFORM public.eng03_06_lock_rooms(u."namespace",u."parentRoomId",u."freshRoomId");PERFORM public.eng03_06_lock_room_dependents(u."namespace",u."parentRoomId",u."freshRoomId");
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 parent:=public.eng03_06_assert_parent(u."namespace",u."ownerId",u."parentMatchId",u."latestVersion",u."latestHash");
 IF parent->>'originalHash' IS DISTINCT FROM u."originalHash" OR public.eng03_06_assert_setup(u."namespace",u."ownerId",u."setupKey") IS NULL THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_UNAVAILABLE';END IF;
 IF jsonb_typeof(intent) IS DISTINCT FROM 'object' OR jsonb_typeof(initial) IS DISTINCT FROM 'object' OR jsonb_typeof(projections) IS DISTINCT FROM 'array' OR intent->>'namespace' IS DISTINCT FROM u."namespace" OR intent->>'roomId' IS DISTINCT FROM u."freshRoomId" OR intent->>'policyRevision' IS DISTINCT FROM c->>'policyRevision' OR intent->>'policyHash' IS DISTINCT FROM c->>'policyHash' OR intent->>'profileScope' IS DISTINCT FROM r->>'profileScope' OR intent->>'lobbyRevision' IS DISTINCT FROM r->>'expectedRevision' OR intent->>'requestKey' IS DISTINCT FROM r->>'requestKey' THEN RAISE EXCEPTION 'SUCCESSOR_PREPARATION_MISMATCH';END IF;
 ids:=public.eng03_03_paid_identity(u."namespace",c->>'projectId',u."ownerId",u."freshRoomId",r->>'requestKey');
 IF intent->>'admissionId' IS DISTINCT FROM ids->>'admissionId' OR intent->>'matchId' IS DISTINCT FROM ids->>'matchId' OR intent->>'logicalMatchId' IS DISTINCT FROM ids->>'logicalMatchId' THEN RAISE EXCEPTION 'SUCCESSOR_NATIVE_ID_MISMATCH';END IF;
 native_hash:=public.int5b_hash_json(jsonb_build_object('version',2,'identityId',u."ownerId",'requestKey',r->>'requestKey','logicalMatchId',ids->>'logicalMatchId','intent',intent-'requestHash','initial',initial));stage_id:='hs_'||public.int5b_hash_json(jsonb_build_array(u."namespace",u."ownerId",r->>'requestKey'));
 INSERT INTO public."HuroofSuccessorStartReservation"("stageId","namespace","ownerId","setupKey","freshRoomId","requestKey","logicalMatchId","nativeLogicalMatchId","externalRequest","externalHash","nativeIntent","nativeInitial","nativeProjections","nativeRequestHash","expectedAdmissionId","expectedMatchId") VALUES(stage_id,u."namespace",u."ownerId",u."setupKey",u."freshRoomId",r->>'requestKey',r->>'logicalMatchId',ids->>'logicalMatchId',r,public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-start-v1','request',r)),intent,initial,projections,native_hash,ids->>'admissionId',ids->>'matchId');
 reply:=public.eng03_03_paid_start(u."ownerId",r->>'requestKey',ids->>'logicalMatchId',intent,initial,projections);
 material:=public.eng03_06_native_material(stage_id);event_id:=material->'event'->>'id';
 INSERT INTO public."HuroofSuccessorSeal"("stageId","namespace","ownerId","setupKey","freshRoomId","admissionId","childMatchId","startSequence","startEventId","requestKey","material","materialHash","outcome","outcomeHash") VALUES(stage_id,u."namespace",u."ownerId",u."setupKey",u."freshRoomId",ids->>'admissionId',ids->>'matchId',1,event_id,r->>'requestKey',material,public.int5b_hash_json(material),reply,public.int5b_hash_json(reply));
 INSERT INTO public."HuroofRematchLink"("namespace","childMatchId","predecessorMatchId","ownerFirebaseIdentityId","predecessorResultVersion","predecessorResultHash") VALUES(u."namespace",ids->>'matchId',u."parentMatchId",u."ownerId",u."latestVersion",u."latestHash");
 PERFORM public.eng03_06_assert_closure(stage_id);RETURN reply;
END $$;
