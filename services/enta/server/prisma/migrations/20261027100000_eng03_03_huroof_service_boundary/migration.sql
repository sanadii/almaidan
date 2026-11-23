-- ENG03-03 source candidate; application requires independent review and separate authorization.
-- All functions trust a dedicated backend service; they do not authenticate Firebase tokens.
BEGIN;
CREATE FUNCTION public.eng03_03_policy_read(p_namespace TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('namespace',r."namespace",'revision',r."revision"::TEXT,'hash',r."policyHash",'rawBase64',encode(r."rawPolicy",'base64'),'projectId',r."firebaseProjectId",'issuer',r."issuer",'audience',r."audience")
 FROM public."HuroofIdentityPolicyHead" h
 JOIN public."HuroofIdentityPolicyRevision" r ON (r."namespace",r."revision",r."policyHash")=(h."namespace",h."revision",h."policyHash")
 JOIN public."DeploymentNamespace" n ON n."namespaceId"=r."namespace" AND n."firebaseProjectId"=r."firebaseProjectId"
 WHERE h."namespace"=p_namespace AND octet_length(r."rawPolicy") BETWEEN 1 AND 65536
$$;
CREATE FUNCTION public.eng03_03_identity_find(p_project TEXT,p_uid TEXT) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT i."id" FROM public."FirebaseIdentity" i WHERE i."firebaseProjectId"=p_project AND i."firebaseUid"=p_uid
$$;
CREATE FUNCTION public.eng03_03_locator_find(p_namespace TEXT,p_code TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('namespace',l."namespace",'code',l."code",'roomId',r."id",'locatorGeneration',l."generation",'roomGeneration',r."generation")
 FROM public."HuroofLocator" l JOIN public."HuroofRoom" r ON (r."namespace",r."id")=(l."namespace",l."roomId")
 WHERE l."namespace"=p_namespace AND l."code"=p_code AND l."generation"=2
$$;
-- Identity is a trusted service argument; this check is not Firebase verification.
CREATE FUNCTION public.eng03_03_assert_current(p_namespace TEXT,p_identity TEXT,p_revision TEXT,p_hash TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 -- The narrow helper must be owned by the existing policy-table owner; it takes no policy write privilege into the service role.
 PERFORM 1 FROM public."HuroofIdentityPolicyHead" h WHERE h."namespace"=p_namespace AND h."revision"::TEXT=p_revision AND h."policyHash"=p_hash FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'identity or policy unavailable'; END IF;
 IF p_revision !~ '^[1-9][0-9]*$' OR p_hash !~ '^[a-f0-9]{64}$' OR NOT EXISTS (
  SELECT 1 FROM public."HuroofIdentityPolicyHead" h
  JOIN public."HuroofIdentityPolicyRevision" p ON (p."namespace",p."revision",p."policyHash")=(h."namespace",h."revision",h."policyHash")
  JOIN public."DeploymentNamespace" n ON n."namespaceId"=p."namespace" AND n."firebaseProjectId"=p."firebaseProjectId"
  JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId"
  WHERE h."namespace"=p_namespace AND h."revision"::TEXT=p_revision AND h."policyHash"=p_hash
 ) THEN RAISE EXCEPTION 'identity or policy unavailable'; END IF;
END $$;
-- Narrow owner-definer lock avoids granting the service role a room-update capability merely for locking.
CREATE FUNCTION public.eng03_03_lock_room(p_namespace TEXT,p_room TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'room unavailable'; END IF;
END $$;
-- SQL-owned append-only lobby: Prisma schema is deliberately unchanged.
-- Lock current members after room; conflicts with external revocation until transaction completion.
CREATE FUNCTION public.eng03_03_lock_members(p_namespace TEXT,p_room TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public."HuroofMember" WHERE ("namespace","roomId")=(p_namespace,p_room) ORDER BY "firebaseIdentityId" FOR SHARE;
END $$;
CREATE TABLE public."HuroofLobbyRevision" (
 "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL,
 "revision" BIGINT NOT NULL CHECK("revision">=0), "roomGeneration" BIGINT NOT NULL CHECK("roomGeneration">0),
 "actorFirebaseIdentityId" TEXT NOT NULL, "requestKey" TEXT NOT NULL CHECK("requestKey" ~ '^[A-Za-z0-9_-]{1,120}$'),
 "intent" BYTEA NOT NULL, "intentHash" TEXT NOT NULL, "outcome" BYTEA NOT NULL, "outcomeHash" TEXT NOT NULL,
 "state" JSONB NOT NULL, "stateHash" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY("namespace","roomId","revision"), UNIQUE("namespace","roomId","actorFirebaseIdentityId","requestKey"),
 FOREIGN KEY("namespace","roomId","ownerFirebaseIdentityId") REFERENCES public."HuroofRoom"("namespace","id","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("actorFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(octet_length("intent") BETWEEN 1 AND 262144 AND octet_length("outcome") BETWEEN 1 AND 4096 AND octet_length(convert_to("state"::TEXT,'UTF8'))<=2097152),
 CHECK(encode(int4_crypto.digest("intent",'sha256'),'hex')="intentHash" AND encode(int4_crypto.digest("outcome",'sha256'),'hex')="outcomeHash" AND public.int5b_hash_json("state")="stateHash")
);
CREATE FUNCTION public.eng03_03_lobby_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; code TEXT; project TEXT; prior BIGINT;
BEGIN
 PERFORM public.eng03_03_lock_room(NEW."namespace",NEW."roomId");
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(NEW."namespace",NEW."roomId");
 SELECT l."code" INTO code FROM public."HuroofLocator" l WHERE (l."namespace",l."roomId",l."generation")=(NEW."namespace",NEW."roomId",2);
 SELECT n."firebaseProjectId" INTO project FROM public."DeploymentNamespace" n WHERE n."namespaceId"=NEW."namespace";
 IF room."status" IS DISTINCT FROM 'SETUP' OR room."ownerFirebaseIdentityId" IS DISTINCT FROM NEW."ownerFirebaseIdentityId" OR room."generation" IS DISTINCT FROM NEW."roomGeneration" OR code IS NULL OR project IS NULL OR NOT EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE (m."namespace",m."roomId",m."firebaseIdentityId")=(NEW."namespace",NEW."roomId",NEW."actorFirebaseIdentityId") AND m."revokedAt" IS NULL) THEN RAISE EXCEPTION 'lobby authority unavailable'; END IF;
 SELECT max("revision") INTO prior FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId")=(NEW."namespace",NEW."roomId");
 IF NEW."revision" IS DISTINCT FROM COALESCE(prior+1,0) OR NEW."state"->>'schemaVersion' IS DISTINCT FROM 'huroof-lobby-v1' OR NEW."state"->'room'->>'revision' IS DISTINCT FROM NEW."revision"::TEXT OR NEW."state"->'room'->>'roomCode' IS DISTINCT FROM code OR NEW."state"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'LOBBY' OR jsonb_typeof(NEW."state"->'room'->'config') IS DISTINCT FROM 'object' OR jsonb_typeof(NEW."state"->'members') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW."state"->'memberBindings') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW."state"->'members')>217 OR jsonb_array_length(COALESCE(NEW."state"->'room'->'manualParticipants','[]'::JSONB))>16 THEN RAISE EXCEPTION 'invalid lobby revision'; END IF;
 IF jsonb_array_length(NEW."state"->'members')<>jsonb_array_length(NEW."state"->'memberBindings') OR (SELECT count(DISTINCT b.value->>'identityId') FROM jsonb_array_elements(NEW."state"->'memberBindings') AS b(value))<>jsonb_array_length(NEW."state"->'memberBindings') OR (SELECT count(DISTINCT c.value->>'uid') FROM jsonb_array_elements(NEW."state"->'members') AS c(value))<>jsonb_array_length(NEW."state"->'members') OR (SELECT count(*) FROM jsonb_array_elements(NEW."state"->'members') AS c(value) WHERE c.value->>'role'='host')<>1 OR (SELECT count(*) FROM jsonb_array_elements(NEW."state"->'members') AS c(value) WHERE c.value->>'role'='audience')>200 OR (SELECT count(*) FROM jsonb_array_elements(NEW."state"->'members') AS c(value) WHERE c.value->>'role'='player')+jsonb_array_length(COALESCE(NEW."state"->'room'->'manualParticipants','[]'::JSONB))>16 OR (SELECT count(*) FROM jsonb_array_elements(NEW."state"->'memberBindings'))<>(SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=NEW."namespace" AND m."roomId"=NEW."roomId" AND m."revokedAt" IS NULL) OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."state"->'memberBindings') AS b(value) LEFT JOIN public."HuroofMember" m ON (m."namespace",m."roomId",m."firebaseIdentityId")=(NEW."namespace",NEW."roomId",b.value->>'identityId') AND m."revokedAt" IS NULL LEFT JOIN public."FirebaseIdentity" i ON i."id"=m."firebaseIdentityId" AND i."firebaseProjectId"=project AND i."firebaseUid"=b.value->>'uid' WHERE m."firebaseIdentityId" IS NULL OR i."id" IS NULL OR b.value->>'generation' IS DISTINCT FROM m."generation"::TEXT OR b.value->>'version' IS DISTINCT FROM m."version"::TEXT OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."state"->'members') AS c(value) WHERE c.value->>'uid'=i."firebaseUid" AND c.value->'active'='true'::JSONB AND ((m."role"='OWNER' AND c.value->>'role'='host') OR (m."role"='MEMBER' AND c.value->>'role' IN ('player','audience'))))) THEN RAISE EXCEPTION 'lobby member binding mismatch'; END IF;
 IF jsonb_array_length(COALESCE(NEW."state"->'room'->'manualParticipants','[]'::JSONB))<>(SELECT count(*) FROM public."HuroofParticipant" p WHERE p."namespace"=NEW."namespace" AND p."roomId"=NEW."roomId" AND p."memberFirebaseIdentityId" IS NULL) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW."state"->'room'->'manualParticipants','[]'::JSONB)) AS a(value) WHERE NOT EXISTS(SELECT 1 FROM public."HuroofParticipant" p WHERE p."namespace"=NEW."namespace" AND p."roomId"=NEW."roomId" AND p."memberFirebaseIdentityId" IS NULL AND p."id"=a.value->>'id' AND p."displayName"=a.value->>'displayName' AND p."team"=a.value->>'team')) THEN RAISE EXCEPTION 'manual participant binding mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofLobbyRevision_insert_guard" BEFORE INSERT ON public."HuroofLobbyRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_03_lobby_insert_guard();
CREATE TRIGGER "HuroofLobbyRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofLobbyRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofLobbyRevision_no_truncate" BEFORE TRUNCATE ON public."HuroofLobbyRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE FUNCTION public.eng03_03_create_identity(p_namespace TEXT,p_project TEXT,p_identity TEXT,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bytes BYTEA; code TEXT;
BEGIN
 IF p_namespace IS NULL OR p_project IS NULL OR p_identity IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'invalid create key'; END IF;
 bytes:=int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,p_project,p_identity,p_key)::TEXT,'UTF8'),'sha256');
 code:=substr(regexp_replace(encode(bytes,'base64'),'[^A-Za-z0-9]','','g'),1,8);
 IF length(code)<>8 THEN RAISE EXCEPTION 'locator derivation failed'; END IF;
 RETURN jsonb_build_object('roomId','l_'||encode(bytes,'hex'),'code',code);
END $$;
CREATE FUNCTION public.eng03_03_find_create(p_namespace TEXT,p_identity TEXT,p_key TEXT,p_intent JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE project TEXT; derived JSONB; prior public."HuroofLobbyRevision"%ROWTYPE;
BEGIN
 SELECT n."firebaseProjectId" INTO project FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=p_namespace;
 IF NOT FOUND OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'type' IS DISTINCT FROM 'CREATE_ROOM' OR p_intent->>'intentId' IS DISTINCT FROM p_key THEN RAISE EXCEPTION 'create identity unavailable'; END IF;
 derived:=public.eng03_03_create_identity(p_namespace,project,p_identity,p_key);
 SELECT l.* INTO prior FROM public."HuroofLobbyRevision" l JOIN public."HuroofRoom" r ON (r."namespace",r."id",r."ownerFirebaseIdentityId")=(l."namespace",l."roomId",l."ownerFirebaseIdentityId") WHERE (l."namespace",l."roomId",l."actorFirebaseIdentityId",l."requestKey")=(p_namespace,derived->>'roomId',p_identity,p_key) AND r."ownerFirebaseIdentityId"=p_identity;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF convert_from(prior."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR prior."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(prior."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'create intent conflict'; END IF;
 RETURN convert_from(prior."outcome",'UTF8')::JSONB||jsonb_build_object('replayed',true);
END $$;
CREATE FUNCTION public.eng03_03_setup_create(p_namespace TEXT,p_identity TEXT,p_revision TEXT,p_hash TEXT,p_key TEXT,p_intent JSONB,p_state JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE project TEXT; uid TEXT; derived JSONB; room_id TEXT; code TEXT; prior public."HuroofLobbyRevision"%ROWTYPE; intent_bytes BYTEA; outcome JSONB; outcome_bytes BYTEA;
BEGIN
 SELECT n."firebaseProjectId",i."firebaseUid" INTO project,uid FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=p_namespace;
 IF NOT FOUND OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'type' IS DISTINCT FROM 'CREATE_ROOM' OR p_intent->>'intentId' IS DISTINCT FROM p_key OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' OR (p_intent-ARRAY['type','intentId','config','displayName']::TEXT[])<>'{}'::JSONB THEN RAISE EXCEPTION 'invalid create intent'; END IF;
 derived:=public.eng03_03_create_identity(p_namespace,project,p_identity,p_key); room_id:=derived->>'roomId'; code:=derived->>'code';
 SELECT l.* INTO prior FROM public."HuroofLobbyRevision" l JOIN public."HuroofRoom" r ON (r."namespace",r."id",r."ownerFirebaseIdentityId")=(l."namespace",l."roomId",l."ownerFirebaseIdentityId") WHERE (l."namespace",l."roomId",l."actorFirebaseIdentityId",l."requestKey")=(p_namespace,room_id,p_identity,p_key) AND r."ownerFirebaseIdentityId"=p_identity;
 IF FOUND THEN
  IF convert_from(prior."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR prior."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(prior."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'create intent conflict'; END IF;
  RETURN convert_from(prior."outcome",'UTF8')::JSONB||jsonb_build_object('replayed',true);
 END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,p_identity,p_revision,p_hash);
 IF public.eng03_02_has_secret_key(p_intent) OR public.eng03_02_has_secret_key(p_state) OR NOT public.int5b_valid_config(p_state->'room'->'config') OR p_state->'room'->'config'->>'mode' IS DISTINCT FROM 'classic' OR p_state->'room'->'config'->>'difficulty' IS DISTINCT FROM 'mixed' OR p_state->'members'->0->'ready' IS DISTINCT FROM 'true'::JSONB OR jsonb_array_length(COALESCE(p_state->'room'->'manualParticipants','[]'::JSONB))<>0 OR jsonb_typeof(p_state) IS DISTINCT FROM 'object' OR p_state->'room'->'config' IS DISTINCT FROM p_intent->'config' OR p_state->'room'->>'roomCode' IS DISTINCT FROM code OR p_state->'room'->>'revision' IS DISTINCT FROM '0' OR jsonb_array_length(p_state->'members')<>1 OR p_state->'members'->0->>'uid' IS DISTINCT FROM uid OR p_state->'members'->0->>'displayName' IS DISTINCT FROM p_intent->>'displayName' OR p_state->'members'->0->>'role' IS DISTINCT FROM 'host' THEN RAISE EXCEPTION 'invalid create state'; END IF;
 INSERT INTO public."HuroofRoom"("namespace","id","ownerFirebaseIdentityId") VALUES(p_namespace,room_id,p_identity);
 INSERT INTO public."HuroofLocator"("namespace","code","roomId","generation") VALUES(p_namespace,code,room_id,2);
 INSERT INTO public."HuroofMember"("namespace","roomId","firebaseIdentityId","role") VALUES(p_namespace,room_id,p_identity,'OWNER');
 intent_bytes:=convert_to(p_intent::TEXT,'UTF8'); outcome:=jsonb_build_object('roomId',room_id,'locator','M2-'||code,'revision',0,'replayed',false); outcome_bytes:=convert_to(outcome::TEXT,'UTF8');
 INSERT INTO public."HuroofLobbyRevision"("namespace","roomId","ownerFirebaseIdentityId","revision","roomGeneration","actorFirebaseIdentityId","requestKey","intent","intentHash","outcome","outcomeHash","state","stateHash") VALUES(p_namespace,room_id,p_identity,0,1,p_identity,p_key,intent_bytes,encode(int4_crypto.digest(intent_bytes,'sha256'),'hex'),outcome_bytes,encode(int4_crypto.digest(outcome_bytes,'sha256'),'hex'),p_state,public.int5b_hash_json(p_state));
 RETURN outcome;
END $$;
-- Reads bytes only through current membership and exact profile/receipt/seal/custody joins.
-- Current pointers are used solely before a match; continuation starts from the immutable MatchPin.
CREATE FUNCTION public.eng03_03_lobby_receipt(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_key TEXT,p_intent JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved public."HuroofLobbyRevision"%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r JOIN public."DeploymentNamespace" n ON n."namespaceId"=r."namespace" JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE (r."namespace",r."id")=(p_namespace,p_room)) THEN RAISE EXCEPTION 'lobby identity unavailable'; END IF;
 SELECT * INTO saved FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey")=(p_namespace,p_room,p_identity,p_key);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF convert_from(saved."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR saved."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(saved."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'lobby intent conflict'; END IF;
 RETURN jsonb_build_object('roomId',p_room,'revision',saved."revision",'replayed',true);
END $$;
CREATE FUNCTION public.eng03_03_lobby_join_prepare(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; lobby public."HuroofLobbyRevision"%ROWTYPE;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 IF NOT FOUND OR room."generation"<>p_generation OR room."status"<>'SETUP' OR NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" i JOIN public."DeploymentNamespace" n ON n."namespaceId"=p_namespace AND n."firebaseProjectId"=i."firebaseProjectId" WHERE i."id"=p_identity) OR EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE (m."namespace",m."roomId",m."firebaseIdentityId")=(p_namespace,p_room,p_identity)) THEN RAISE EXCEPTION 'join unavailable'; END IF;
 SELECT * INTO lobby FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId")=(p_namespace,p_room) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR lobby."stateHash" IS DISTINCT FROM public.int5b_hash_json(lobby."state") THEN RAISE EXCEPTION 'join unavailable'; END IF;
 RETURN jsonb_build_object('roomId',room."id",'generation',room."generation",'stateHash',lobby."stateHash",'state',lobby."state");
END $$;
CREATE FUNCTION public.eng03_03_lobby_load(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; lobby public."HuroofLobbyRevision"%ROWTYPE; uid TEXT; actor JSONB;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 IF NOT FOUND OR room."generation"<>p_generation OR room."status"<>'SETUP' THEN RAISE EXCEPTION 'lobby unavailable'; END IF;
 SELECT * INTO member FROM public."HuroofMember" WHERE ("namespace","roomId","firebaseIdentityId")=(p_namespace,p_room,p_identity) AND "revokedAt" IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'lobby unavailable'; END IF;
 SELECT i."firebaseUid" INTO uid FROM public."FirebaseIdentity" i JOIN public."DeploymentNamespace" n ON n."namespaceId"=p_namespace AND n."firebaseProjectId"=i."firebaseProjectId" WHERE i."id"=p_identity;
 IF NOT FOUND THEN RAISE EXCEPTION 'lobby unavailable'; END IF;
 SELECT * INTO lobby FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId")=(p_namespace,p_room) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR lobby."stateHash" IS DISTINCT FROM public.int5b_hash_json(lobby."state") THEN RAISE EXCEPTION 'lobby unavailable'; END IF;
 SELECT x.value INTO actor FROM jsonb_array_elements(lobby."state"->'members') AS x(value) WHERE x.value->>'uid'=uid AND x.value->'active'='true'::JSONB;
 IF actor IS NULL OR (SELECT count(*) FROM jsonb_array_elements(lobby."state"->'memberBindings') AS b(value) WHERE b.value->>'identityId'=p_identity AND b.value->>'uid'=uid AND b.value->>'generation'=member."generation"::TEXT AND b.value->>'version'=member."version"::TEXT)<>1 OR (member."role"='OWNER') IS DISTINCT FROM (actor->>'role'='host') THEN RAISE EXCEPTION 'lobby membership unavailable'; END IF;
 IF jsonb_array_length(lobby."state"->'memberBindings')<>(SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."revokedAt" IS NULL) OR EXISTS(SELECT 1 FROM jsonb_array_elements(lobby."state"->'memberBindings') AS b(value) LEFT JOIN public."HuroofMember" m ON (m."namespace",m."roomId",m."firebaseIdentityId")=(p_namespace,p_room,b.value->>'identityId') AND m."revokedAt" IS NULL WHERE m."firebaseIdentityId" IS NULL OR b.value->>'generation' IS DISTINCT FROM m."generation"::TEXT OR b.value->>'version' IS DISTINCT FROM m."version"::TEXT) THEN RAISE EXCEPTION 'lobby membership changed'; END IF;
 RETURN jsonb_build_object('roomId',room."id",'generation',room."generation",'memberGeneration',member."generation",'stateHash',lobby."stateHash",'state',lobby."state",'actor',actor);
END $$;
CREATE FUNCTION public.eng03_03_manual_identity(p_namespace TEXT,p_room TEXT,p_identity TEXT,p_key TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT 'manual_'||encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,p_room,p_identity,p_key)::TEXT,'UTF8'),'sha256'),'hex')
$$;
CREATE FUNCTION public.eng03_03_lobby_commit(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_revision BIGINT,p_policy_revision TEXT,p_policy_hash TEXT,p_intent JSONB,p_state JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; lobby public."HuroofLobbyRevision"%ROWTYPE; saved public."HuroofLobbyRevision"%ROWTYPE; uid TEXT; intent_type TEXT; key TEXT; expected JSONB; payload JSONB; item JSONB; target_uid TEXT; target_id TEXT; target_team TEXT; new_id TEXT; ord INTEGER; horizontal INTEGER; vertical INTEGER; role TEXT; name TEXT; raw BYTEA; outcome JSONB; outcome_bytes BYTEA;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 SELECT i."firebaseUid" INTO uid FROM public."FirebaseIdentity" i JOIN public."DeploymentNamespace" n ON n."namespaceId"=p_namespace AND n."firebaseProjectId"=i."firebaseProjectId" WHERE i."id"=p_identity;
 IF NOT FOUND OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'lobby identity unavailable'; END IF;
 key:=p_intent->>'intentId'; intent_type:=p_intent->>'type'; payload:=p_intent->'payload';
 IF key IS NULL OR key !~ '^[A-Za-z0-9_-]{1,120}$' OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR (p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR public.eng03_02_has_secret_key(p_intent) OR public.eng03_02_has_secret_key(p_state) THEN RAISE EXCEPTION 'invalid lobby intent'; END IF;
 SELECT * INTO saved FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey")=(p_namespace,p_room,p_identity,key);
 IF FOUND THEN IF convert_from(saved."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR saved."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(saved."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'lobby intent conflict'; END IF; RETURN jsonb_build_object('roomId',p_room,'revision',saved."revision",'replayed',true); END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,p_identity,p_policy_revision,p_policy_hash);
 IF room."status"<>'SETUP' OR room."generation"<>p_generation THEN RAISE EXCEPTION 'lobby unavailable'; END IF;
 SELECT * INTO lobby FROM public."HuroofLobbyRevision" WHERE ("namespace","roomId")=(p_namespace,p_room) ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR lobby."revision"<>p_revision OR p_intent->>'expectedRevision' IS DISTINCT FROM p_revision::TEXT OR lobby."stateHash" IS DISTINCT FROM public.int5b_hash_json(lobby."state") THEN RAISE EXCEPTION 'stale lobby'; END IF;
 expected:=jsonb_set(lobby."state",'{room,revision}',to_jsonb(p_revision+1));
 SELECT * INTO member FROM public."HuroofMember" WHERE ("namespace","roomId","firebaseIdentityId")=(p_namespace,p_room,p_identity);
 IF intent_type='JOIN_ROOM' THEN
  IF FOUND OR (payload-ARRAY['role','displayName']::TEXT[])<>'{}'::JSONB OR payload->>'role' NOT IN ('player','audience') OR length(btrim(payload->>'displayName')) NOT BETWEEN 1 AND 48 OR payload->>'displayName' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'join unavailable'; END IF;
  role:=payload->>'role'; name:=payload->>'displayName';
  item:=jsonb_build_object('uid',uid,'role',role,'displayName',name,'ready',false,'active',true);
  IF role='player' THEN
   SELECT count(*) FILTER(WHERE v.value->>'team'='horizontal'),count(*) FILTER(WHERE v.value->>'team'='vertical') INTO horizontal,vertical FROM (SELECT value FROM jsonb_array_elements(lobby."state"->'members') WHERE value->>'role'='player' AND value->'active'='true'::JSONB UNION ALL SELECT value FROM jsonb_array_elements(COALESCE(lobby."state"->'room'->'manualParticipants','[]'::JSONB))) v;
   target_team:=(CASE WHEN horizontal<=vertical THEN 'horizontal' ELSE 'vertical' END); item:=item||jsonb_build_object('team',target_team);
  END IF;
  expected:=jsonb_set(expected,'{members}',(expected->'members')||jsonb_build_array(item));
  expected:=jsonb_set(expected,'{memberBindings}',(expected->'memberBindings')||jsonb_build_array(jsonb_build_object('identityId',p_identity,'uid',uid,'generation','1','version','0')));
  INSERT INTO public."HuroofMember"("namespace","roomId","firebaseIdentityId","role") VALUES(p_namespace,p_room,p_identity,'MEMBER');
 ELSE
  IF NOT FOUND OR member."revokedAt" IS NOT NULL THEN RAISE EXCEPTION 'lobby member unavailable'; END IF;
  IF intent_type='LOBBY_SET_READY' THEN
   IF (payload-ARRAY['ready']::TEXT[])<>'{}'::JSONB OR jsonb_typeof(payload->'ready') IS DISTINCT FROM 'boolean' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(lobby."state"->'members') AS m(value) WHERE m.value->>'uid'=uid AND m.value->>'role'='player' AND m.value->'active'='true'::JSONB) THEN RAISE EXCEPTION 'ready unavailable'; END IF;
   SELECT jsonb_agg(CASE WHEN v.value->>'uid'=uid THEN jsonb_set(v.value,'{ready}',payload->'ready') ELSE v.value END ORDER BY v.ordinality) INTO item FROM jsonb_array_elements(expected->'members') WITH ORDINALITY AS v(value,ordinality); expected:=jsonb_set(expected,'{members}',item);
  ELSIF intent_type='LOBBY_ASSIGN_TEAM' THEN
   IF member."role"<>'OWNER' OR (payload-ARRAY['memberUid','manualParticipantId','team']::TEXT[])<>'{}'::JSONB OR payload->>'team' NOT IN ('horizontal','vertical') OR ((payload ? 'memberUid')=(payload ? 'manualParticipantId')) THEN RAISE EXCEPTION 'team assignment unavailable'; END IF;
   target_team:=payload->>'team'; target_uid:=payload->>'memberUid'; target_id:=payload->>'manualParticipantId';
   IF target_uid IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected->'members') AS v(value) WHERE v.value->>'uid'=target_uid AND v.value->>'role'='player' AND v.value->'active'='true'::JSONB) THEN RAISE EXCEPTION 'team target unavailable'; END IF;
    SELECT jsonb_agg(CASE WHEN v.value->>'uid'=target_uid AND v.value->>'team' IS DISTINCT FROM target_team THEN jsonb_set(jsonb_set(v.value,'{team}',to_jsonb(target_team)),'{ready}','false'::JSONB) ELSE v.value END ORDER BY v.ordinality) INTO item FROM jsonb_array_elements(expected->'members') WITH ORDINALITY AS v(value,ordinality); expected:=jsonb_set(expected,'{members}',item);
   ELSE
    IF NOT EXISTS(SELECT 1 FROM public."HuroofParticipant" p WHERE p."namespace"=p_namespace AND p."roomId"=p_room AND p."id"=target_id AND p."memberFirebaseIdentityId" IS NULL) THEN RAISE EXCEPTION 'team target unavailable'; END IF;
    UPDATE public."HuroofParticipant" SET "team"=target_team WHERE ("namespace","roomId","id")=(p_namespace,p_room,target_id);
    SELECT jsonb_agg(CASE WHEN v.value->>'id'=target_id THEN jsonb_set(v.value,'{team}',to_jsonb(target_team)) ELSE v.value END ORDER BY v.ordinality) INTO item FROM jsonb_array_elements(expected->'room'->'manualParticipants') WITH ORDINALITY AS v(value,ordinality); expected:=jsonb_set(expected,'{room,manualParticipants}',item);
   END IF;
  ELSIF intent_type='LOBBY_ADD_MANUAL_PLAYER' THEN
   IF member."role"<>'OWNER' OR (payload-ARRAY['displayName','team']::TEXT[])<>'{}'::JSONB OR length(btrim(payload->>'displayName')) NOT BETWEEN 1 AND 48 OR payload->>'displayName' ~ '[[:cntrl:]]' OR payload->>'team' NOT IN ('horizontal','vertical') THEN RAISE EXCEPTION 'manual participant unavailable'; END IF;
   new_id:=public.eng03_03_manual_identity(p_namespace,p_room,p_identity,key); name:=payload->>'displayName'; target_team:=payload->>'team';
   SELECT count(*) INTO ord FROM public."HuroofParticipant" p WHERE p."namespace"=p_namespace AND p."roomId"=p_room;
   INSERT INTO public."HuroofParticipant"("namespace","roomId","id","displayName","team","ordinal") VALUES(p_namespace,p_room,new_id,name,target_team,ord);
   expected:=jsonb_set(expected,'{room,manualParticipants}',COALESCE(expected->'room'->'manualParticipants','[]'::JSONB)||jsonb_build_array(jsonb_build_object('id',new_id,'displayName',name,'team',target_team)));
  ELSE RAISE EXCEPTION 'lobby operation unavailable'; END IF;
 END IF;
 IF p_state IS DISTINCT FROM expected THEN RAISE EXCEPTION 'lobby transition differs'; END IF;
 raw:=convert_to(p_intent::TEXT,'UTF8'); outcome:=jsonb_build_object('roomId',p_room,'revision',p_revision+1,'replayed',false); outcome_bytes:=convert_to(outcome::TEXT,'UTF8');
 INSERT INTO public."HuroofLobbyRevision"("namespace","roomId","ownerFirebaseIdentityId","revision","roomGeneration","actorFirebaseIdentityId","requestKey","intent","intentHash","outcome","outcomeHash","state","stateHash") VALUES(p_namespace,p_room,room."ownerFirebaseIdentityId",p_revision+1,p_generation,p_identity,key,raw,encode(int4_crypto.digest(raw,'sha256'),'hex'),outcome_bytes,encode(int4_crypto.digest(outcome_bytes,'sha256'),'hex'),p_state,public.int5b_hash_json(p_state));
 RETURN outcome;
END $$;
CREATE FUNCTION public.eng03_03_content_load(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_profile_scope TEXT,p_match TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; prof public."HuroofRawArtifact"%ROWTYPE; snap public."HuroofRawArtifact"%ROWTYPE; rec public."CatalogValidationReceipt"%ROWTYPE; ref JSONB; cfg JSONB; profile_catalog TEXT; profile_root TEXT; seal_hash TEXT; profile_id TEXT; receipt_id TEXT; profile_revision BIGINT; profile_scope TEXT; profile_family TEXT; profile_source TEXT;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE "namespace"=p_namespace AND "id"=p_room;
 IF NOT FOUND OR room."generation"<>p_generation OR NOT EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE (m."namespace",m."roomId",m."firebaseIdentityId")=(p_namespace,p_room,p_identity) AND m."revokedAt" IS NULL) THEN RAISE EXCEPTION 'content unavailable'; END IF;
 IF p_match IS NULL THEN
  IF room."status"<>'SETUP' OR room."ownerFirebaseIdentityId"<>p_identity THEN RAISE EXCEPTION 'content unavailable'; END IF;
  SELECT raw."id",receipt."id",v."revision",ptr."scope",v."family",v."sourceId" INTO profile_id,receipt_id,profile_revision,profile_scope,profile_family,profile_source FROM public."HuroofContentPointer" ptr
   JOIN public."HuroofContentRevision" v ON (v."namespace",v."family",v."sourceId",v."revision",v."rawArtifactHash")=(ptr."namespace",ptr."family",ptr."sourceId",ptr."revision",ptr."rawArtifactHash")
   JOIN public."HuroofRawArtifact" raw ON (raw."namespace",raw."id",raw."contentHash")=(v."namespace",v."rawArtifactId",v."rawArtifactHash")
   JOIN public."ActiveCatalogPointer" active ON active."id"='singleton' AND (active."validationReceiptId",active."catalogReleaseId",active."releaseRootHash")=(v."validationReceiptId",v."catalogReleaseId",v."releaseRootHash")
   JOIN public."CatalogValidationReceipt" receipt ON (receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash")=(v."validationReceiptId",v."catalogReleaseId",v."releaseRootHash")
   WHERE (ptr."namespace",ptr."kind",ptr."scope",ptr."family")=(p_namespace,'profile',p_profile_scope,'profile') AND raw."byteLength" BETWEEN 1 AND 67108864;
  IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
  SELECT * INTO rec FROM public."CatalogValidationReceipt" WHERE "id"=receipt_id;
  profile_catalog:=rec."catalogReleaseId"; profile_root:=rec."releaseRootHash";
  cfg:=jsonb_build_object('releaseId',rec."huroofReleaseId",'releaseRootSha256',rec."huroofRootSha256");
 ELSE
  SELECT raw."id",receipt."id",pin."catalogReleaseId",pin."releaseRootHash",pin."catalogSealHash",pin."config",pin."profileRevision",pin."profileScope",pin."profileFamily",pin."profileSourceId" INTO profile_id,receipt_id,profile_catalog,profile_root,seal_hash,cfg,profile_revision,profile_scope,profile_family,profile_source
   FROM public."HuroofMatchPin" pin JOIN public."HuroofMatch" m ON (m."namespace",m."id")=(pin."namespace",pin."matchId")
   JOIN public."HuroofCanonicalState" state ON (state."namespace",state."roomId",state."activeMatchId")=(m."namespace",m."roomId",m."id")
   JOIN public."HuroofRawArtifact" raw ON (raw."namespace",raw."id",raw."contentHash")=(pin."namespace",pin."profileRawArtifactId",pin."profileRawArtifactHash")
   JOIN public."CatalogValidationReceipt" receipt ON (receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash")=(pin."validationReceiptId",pin."catalogReleaseId",pin."releaseRootHash")
   WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."id"=p_match AND raw."byteLength" BETWEEN 1 AND 67108864;
  IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
  SELECT * INTO rec FROM public."CatalogValidationReceipt" WHERE "id"=receipt_id;
 END IF;
 SELECT * INTO prof FROM public."HuroofRawArtifact" WHERE "namespace"=p_namespace AND "id"=profile_id AND "byteLength" BETWEEN 1 AND 67108864;
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 IF rec."huroofProjectId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" n WHERE n."namespaceId"=p_namespace AND n."firebaseProjectId"=rec."huroofProjectId") OR rec."huroofRootSha256" IS NULL OR cfg->>'releaseId' IS DISTINCT FROM rec."huroofReleaseId" OR cfg->>'releaseRootSha256' IS DISTINCT FROM rec."huroofRootSha256" THEN RAISE EXCEPTION 'content unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSeal" seal WHERE (seal."catalogReleaseId",seal."releaseRootHash",seal."sealHash")=(rec."catalogReleaseId",rec."releaseRootHash",rec."sealHash")) OR (seal_hash IS NOT NULL AND seal_hash<>rec."sealHash") THEN RAISE EXCEPTION 'content unavailable'; END IF;
 ref:=convert_from(prof."rawBytes",'UTF8')::JSONB->'contentSnapshot';
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR ref->>'namespace' IS DISTINCT FROM p_namespace THEN RAISE EXCEPTION 'content unavailable'; END IF;
 SELECT * INTO snap FROM public."HuroofRawArtifact" WHERE "namespace"=p_namespace AND "id"=ref->>'id' AND "contentHash"=ref->>'hash' AND "provenanceHash"=ref->>'provenanceHash' AND "mediaType"=ref->>'mediaType' AND "serialization"=ref->>'serialization' AND "byteLength"::TEXT=ref->>'byteLength' AND "byteLength" BETWEEN 1 AND 67108864 AND octet_length("provenanceBytes")<=67108864;
 IF NOT FOUND THEN RAISE EXCEPTION 'content unavailable'; END IF;
 RETURN jsonb_build_object('namespace',p_namespace,'matchNamespace',room."namespace",'projectId',rec."huroofProjectId",'profileScope',profile_scope,'profileFamily',profile_family,'profileSourceId',profile_source,'profileRevision',profile_revision::TEXT,'receiptId',rec."id",'selectorVersion',rec."selectorVersion",'readinessPolicyVersion',rec."policyVersion",'releaseId',rec."huroofReleaseId",'huroofRoot',rec."huroofRootSha256",'configReleaseId',cfg->>'releaseId','configHuroofRoot',cfg->>'releaseRootSha256','profileArtifactId',prof."id",'profileArtifactHash',prof."contentHash",'profileArtifactLength',prof."byteLength",'profileRawBase64',encode(prof."rawBytes",'base64'),'profileSnapshotId',ref->>'id','profileSnapshotHash',ref->>'hash','profileSnapshotLength',(ref->>'byteLength')::BIGINT,'profileSnapshotMediaType',ref->>'mediaType','profileSnapshotSerialization',ref->>'serialization','profileSnapshotProvenanceHash',ref->>'provenanceHash','snapshotId',snap."id",'snapshotHash',snap."contentHash",'snapshotLength',snap."byteLength",'snapshotMediaType',snap."mediaType",'snapshotSerialization',snap."serialization",'snapshotProvenanceHash',snap."provenanceHash",'snapshotBase64',encode(snap."rawBytes",'base64'),'provenanceBase64',encode(snap."provenanceBytes",'base64'),'receiptCatalogId',rec."catalogReleaseId",'profileCatalogId',profile_catalog,'receiptCatalogRoot',rec."releaseRootHash",'profileCatalogRoot',profile_root,'receiptSealHash',rec."sealHash",'sealHash',rec."sealHash",'sourceEvidenceManifestHash',rec."sourceEvidenceManifestHash");
END $$;
-- Reserved custody policy is independently provisioned; no writer or default is supplied here.
CREATE FUNCTION public.eng03_03_custody_policy(p_namespace TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('namespace',ptr."namespace",'projectId',n."firebaseProjectId",'policyId',ptr."sourceId",'revision',rev."revision"::TEXT,'generation',ptr."version"::TEXT,'hash',raw."contentHash",'mediaType',raw."mediaType",'serialization',raw."serialization",'length',raw."byteLength",'rawBase64',encode(raw."rawBytes",'base64'))
 FROM public."HuroofContentPointer" ptr
 JOIN public."HuroofContentRevision" rev ON (rev."namespace",rev."family",rev."sourceId",rev."revision",rev."rawArtifactHash")=(ptr."namespace",ptr."family",ptr."sourceId",ptr."revision",ptr."rawArtifactHash")
 JOIN public."HuroofRawArtifact" raw ON (raw."namespace",raw."id",raw."contentHash")=(rev."namespace",rev."rawArtifactId",rev."rawArtifactHash")
 JOIN public."DeploymentNamespace" n ON n."namespaceId"=ptr."namespace"
 WHERE (ptr."namespace",ptr."kind",ptr."scope",ptr."family",ptr."sourceId")=(p_namespace,'custody-authority','huroof-release-snapshot-v1','policy','eng03.custody-authority.v1') AND raw."byteLength" BETWEEN 1 AND 65536 AND raw."mediaType"='application/json' AND raw."serialization"='huroof-custody-authority-policy-v1'
$$;
-- The existing table owner locks the reserved head; no service role receives pointer UPDATE.
CREATE FUNCTION public.eng03_03_lock_profile(p_namespace TEXT,p_scope TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope","family")=(p_namespace,'profile',p_scope,'profile') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile unavailable'; END IF;
END $$;
CREATE FUNCTION public.eng03_03_lock_custody(p_namespace TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public."HuroofContentPointer" WHERE ("namespace","kind","scope","family","sourceId")=(p_namespace,'custody-authority','huroof-release-snapshot-v1','policy','eng03.custody-authority.v1') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'custody policy unavailable'; END IF;
END $$;
-- Evidence cryptography is verified by the independently provisioned service verifier outside this transaction.
-- This fixed helper rechecks locked current policy and the entire immutable DB subject at the mutation point.
CREATE FUNCTION public.eng03_03_custody_assert(p_namespace TEXT,p_project TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_scope TEXT,p_match TEXT,p_identity_revision TEXT,p_identity_hash TEXT,p_verified JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE head JSONB; policy JSONB; pin JSONB; expected JSONB; now_ms BIGINT; valid_from BIGINT; valid_until BIGINT; max_age BIGINT; checked BIGINT; expires BIGINT;
BEGIN
 PERFORM public.eng03_03_lock_custody(p_namespace);
 head:=public.eng03_03_custody_policy(p_namespace);
 IF head IS NULL OR head->>'projectId' IS DISTINCT FROM p_project OR head->>'policyId' IS DISTINCT FROM 'eng03.custody-authority.v1' OR (head->>'length')::BIGINT<>octet_length(decode(head->>'rawBase64','base64')) OR encode(int4_crypto.digest(decode(head->>'rawBase64','base64'),'sha256'),'hex') IS DISTINCT FROM head->>'hash' THEN RAISE EXCEPTION 'custody policy unavailable'; END IF;
 policy:=convert_from(decode(head->>'rawBase64','base64'),'UTF8')::JSONB;
 IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(policy))<>12 OR policy->>'schemaVersion' IS DISTINCT FROM 'huroof-custody-authority-policy-v1' OR policy->>'namespace' IS DISTINCT FROM p_namespace OR policy->>'firebaseProjectId' IS DISTINCT FROM p_project OR policy->>'policyId' IS DISTINCT FROM head->>'policyId' OR policy->>'revision' IS DISTINCT FROM head->>'revision' OR policy->'enabled' IS DISTINCT FROM 'true'::JSONB OR jsonb_typeof(policy->'issuers') IS DISTINCT FROM 'array' OR jsonb_typeof(policy->'acceptedEvidenceVersions') IS DISTINCT FROM 'array' OR jsonb_typeof(policy->'revokedEvidenceIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'custody policy unavailable'; END IF;
 IF jsonb_typeof(p_verified) IS DISTINCT FROM 'object' OR p_verified->>'status' IS DISTINCT FROM 'verified' OR p_verified->>'authorityPolicyId' IS DISTINCT FROM head->>'policyId' OR p_verified->>'authorityPolicyRevision' IS DISTINCT FROM head->>'revision' OR p_verified->>'authorityPolicyHash' IS DISTINCT FROM head->>'hash' OR p_verified->>'authorityGeneration' IS DISTINCT FROM head->>'generation' OR p_verified->>'evidenceId' IS NULL OR p_verified->>'evidenceHash' IS NULL OR p_verified->>'evidenceVersion' IS NULL OR p_verified->>'evidenceId' !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_verified->>'evidenceHash' !~ '^[a-f0-9]{64}$' OR NOT (policy->'acceptedEvidenceVersions' ? (p_verified->>'evidenceVersion')) OR (policy->'revokedEvidenceIds' ? (p_verified->>'evidenceId')) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(policy->'issuers') AS i(value) WHERE i.value->>'issuerId'=p_verified->>'issuerId' AND i.value->>'keyId'=p_verified->>'keyId' AND i.value->>'trustRootId'=p_verified->>'trustRootId' AND i.value->'enabled'='true'::JSONB) THEN RAISE EXCEPTION 'custody evidence unavailable'; END IF;
 IF policy->>'validFromEpochMs' IS NULL OR policy->>'validUntilEpochMs' IS NULL OR policy->>'maxEvidenceAgeMs' IS NULL OR p_verified->>'validatedAt' IS NULL OR p_verified->>'validUntil' IS NULL OR policy->>'validFromEpochMs' !~ '^(0|[1-9][0-9]*)$' OR policy->>'validUntilEpochMs' !~ '^[1-9][0-9]*$' OR policy->>'maxEvidenceAgeMs' !~ '^[1-9][0-9]*$' OR p_verified->>'validatedAt' !~ '^(0|[1-9][0-9]*)$' OR p_verified->>'validUntil' !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'custody time invalid'; END IF;
 valid_from:=(policy->>'validFromEpochMs')::BIGINT; valid_until:=(policy->>'validUntilEpochMs')::BIGINT; max_age:=(policy->>'maxEvidenceAgeMs')::BIGINT; checked:=(p_verified->>'validatedAt')::BIGINT; expires:=(p_verified->>'validUntil')::BIGINT;
 pin:=public.eng03_03_content_load(p_namespace,p_identity,p_room,p_generation,p_scope,p_match);
 expected:=jsonb_build_object('namespace',pin->>'namespace','projectId',pin->>'projectId','profileScope',pin->>'profileScope','profileFamily',pin->>'profileFamily','profileSourceId',pin->>'profileSourceId','profileId',pin->>'profileArtifactId','profileHash',pin->>'profileArtifactHash','profileRevision',pin->>'profileRevision','snapshotId',pin->>'snapshotId','snapshotHash',pin->>'snapshotHash','snapshotLength',pin->'snapshotLength','snapshotSerialization',pin->>'snapshotSerialization','provenanceHash',pin->>'snapshotProvenanceHash','releaseId',pin->>'releaseId','huroofRoot',pin->>'huroofRoot','catalogId',pin->>'receiptCatalogId','catalogRoot',pin->>'receiptCatalogRoot','sealHash',pin->>'sealHash','receiptId',pin->>'receiptId','selectorVersion',pin->>'selectorVersion','readinessPolicyVersion',pin->>'readinessPolicyVersion','identityPolicyRevision',p_identity_revision,'identityPolicyHash',p_identity_hash);
 IF p_verified->'subject' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'custody subject mismatch'; END IF;
 now_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT;
 IF valid_from>9007199254740991 OR valid_until>9007199254740991 OR max_age>9007199254740991 OR checked>9007199254740991 OR expires>9007199254740991 OR valid_until<=valid_from OR now_ms<valid_from OR now_ms>=valid_until OR checked>now_ms OR expires<=now_ms OR expires>valid_until OR expires<=checked OR now_ms-checked>max_age THEN RAISE EXCEPTION 'custody evidence expired'; END IF;
END $$;
CREATE FUNCTION public.eng03_03_projection_safe(p_value JSONB,p_host BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item RECORD;
BEGIN
 IF p_value IS NULL OR public.eng03_02_has_secret_key(p_value) THEN RETURN FALSE; END IF;
 IF jsonb_typeof(p_value)='object' THEN
  FOR item IN SELECT key,value FROM pg_catalog.jsonb_each(p_value) LOOP
   IF (lower(item.key)=ANY(ARRAY['canonicalanswer','correctanswer','privategrading','rawbytes','provenancebytes','capability','capabilities']) OR (NOT p_host AND lower(item.key)=ANY(ARRAY['acceptedanswers','primaryanswer','sources']))) OR NOT public.eng03_03_projection_safe(item.value,p_host) THEN RETURN FALSE; END IF;
  END LOOP;
 ELSIF jsonb_typeof(p_value)='array' THEN
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP IF NOT public.eng03_03_projection_safe(item.value,p_host) THEN RETURN FALSE; END IF; END LOOP;
 END IF;
 RETURN TRUE;
END $$;
CREATE FUNCTION public.eng03_03_projection_read(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; state public."HuroofCanonicalState"%ROWTYPE; projection public."HuroofProjection"%ROWTYPE; audience TEXT;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 SELECT * INTO member FROM public."HuroofMember" WHERE ("namespace","roomId","firebaseIdentityId")=(p_namespace,p_room,p_identity) AND "revokedAt" IS NULL;
 IF NOT FOUND OR room."generation" IS DISTINCT FROM p_generation OR NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" i JOIN public."DeploymentNamespace" n ON n."namespaceId"=p_namespace AND n."firebaseProjectId"=i."firebaseProjectId" WHERE i."id"=p_identity) THEN RAISE EXCEPTION 'projection unavailable'; END IF;
 SELECT * INTO state FROM public."HuroofCanonicalState" WHERE ("namespace","roomId")=(p_namespace,p_room);
 IF NOT FOUND THEN RAISE EXCEPTION 'projection unavailable'; END IF;
 audience:=(CASE WHEN member."role"='OWNER' AND room."ownerFirebaseIdentityId"=p_identity THEN 'OWNER' ELSE 'MEMBER' END);
 SELECT * INTO projection FROM public."HuroofProjection" WHERE ("namespace","roomId","audience","scope")=(p_namespace,p_room,audience,p_identity);
 IF NOT FOUND OR projection."authGeneration" IS DISTINCT FROM room."generation" OR projection."revision" IS DISTINCT FROM state."revision" OR projection."throughSequence" IS DISTINCT FROM state."sequence" OR NOT public.eng03_03_projection_safe(projection."payload",audience='OWNER') THEN RAISE EXCEPTION 'projection unavailable'; END IF;
 RETURN projection."payload";
END $$;
CREATE FUNCTION public.eng03_03_command_load(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_request_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; state public."HuroofCanonicalState"%ROWTYPE; identity_row public."FirebaseIdentity"%ROWTYPE; receipt public."HuroofCommandReceipt"%ROWTYPE; stored JSONB; actor JSONB;
BEGIN
 PERFORM public.eng03_03_lock_room(p_namespace,p_room);
 PERFORM public.eng03_03_lock_members(p_namespace,p_room);
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id")=(p_namespace,p_room);
 IF NOT FOUND OR room."generation"<>p_generation THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT * INTO member FROM public."HuroofMember" WHERE ("namespace","roomId","firebaseIdentityId")=(p_namespace,p_room,p_identity) AND "revokedAt" IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT * INTO identity_row FROM public."FirebaseIdentity" WHERE "id"=p_identity;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" n WHERE n."namespaceId"=p_namespace AND n."firebaseProjectId"=identity_row."firebaseProjectId") THEN RAISE EXCEPTION 'command unavailable'; END IF;
 SELECT * INTO state FROM public."HuroofCanonicalState" WHERE ("namespace","roomId")=(p_namespace,p_room);
 IF NOT FOUND OR state."activeMatchId" IS NULL OR jsonb_typeof(state."privateState"->'room') IS DISTINCT FROM 'object' OR jsonb_typeof(state."privateState"->'members') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'playable state unavailable'; END IF;
 SELECT value INTO actor FROM jsonb_array_elements(state."privateState"->'members') value WHERE value->>'uid'=identity_row."firebaseUid" AND value->'active'='true'::JSONB;
 IF actor IS NULL OR (SELECT count(*) FROM jsonb_array_elements(state."privateState"->'members') value WHERE value->>'uid'=identity_row."firebaseUid" AND value->'active'='true'::JSONB)<>1 OR (member."role"='OWNER') IS DISTINCT FROM (actor->>'role'='host') THEN RAISE EXCEPTION 'member projection unavailable'; END IF;
 SELECT * INTO receipt FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey")=(p_namespace,p_room,p_identity,p_request_key);
 IF FOUND THEN stored:=jsonb_build_object('intent',convert_from(receipt."intent",'UTF8')::JSONB,'outcome',convert_from(receipt."outcome",'UTF8')::JSONB); END IF;
 RETURN jsonb_build_object('roomId',room."id",'generation',room."generation",'memberGeneration',member."generation",'sequence',state."sequence",'matchId',state."activeMatchId",'room',state."privateState"->'room','members',state."privateState"->'members','actor',actor,'receipt',stored,'previousTerminalRoom',state."privateState"->'previousTerminalRoom');
END $$;
-- Successor changes only the existing match UPDATE/DELETE guard; all 02 other guards remain.
CREATE FUNCTION public.eng03_03_match_update_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st public."HuroofCanonicalState"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'match cannot be deleted'; END IF;
 IF (NEW."namespace",NEW."id",NEW."roomId",NEW."ownerFirebaseIdentityId",NEW."admissionId",NEW."profile",NEW."profileRawArtifactId",NEW."profileHash",NEW."config",NEW."configHash",NEW."rawIntent",NEW."rawIntentHash",NEW."policyRevision",NEW."policyHash",NEW."createdAt") IS DISTINCT FROM (OLD."namespace",OLD."id",OLD."roomId",OLD."ownerFirebaseIdentityId",OLD."admissionId",OLD."profile",OLD."profileRawArtifactId",OLD."profileHash",OLD."config",OLD."configHash",OLD."rawIntent",OLD."rawIntentHash",OLD."policyRevision",OLD."policyHash",OLD."createdAt") OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'invalid match identity or version'; END IF;
 IF (OLD."state"='STARTED' AND NEW."state" IN ('ACTIVE','ABANDONED')) OR (OLD."state"='ACTIVE' AND NEW."state" IN ('FINISHED','ABANDONED')) THEN RETURN NEW; END IF;
 IF OLD."state"<>'FINISHED' OR NEW."state"<>'ACTIVE' THEN RAISE EXCEPTION 'invalid match transition'; END IF;
 SELECT * INTO st FROM public."HuroofCanonicalState" WHERE ("namespace","roomId","activeMatchId")=(OLD."namespace",OLD."roomId",OLD."id");
 IF NOT FOUND OR st."status"<>'FINISHED' OR st."privateState"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'MATCH_COMPLETE' OR EXISTS(SELECT 1 FROM public."HuroofRematchLink" c WHERE c."namespace"=OLD."namespace" AND c."predecessorMatchId"=OLD."id") THEN RAISE EXCEPTION 'correction requires current terminal match without child'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofEvent" e JOIN public."HuroofCommandReceipt" c ON (c."namespace",c."roomId",c."actorFirebaseIdentityId",c."requestKey",c."matchId",c."resultingRevision",c."resultingSequence")=(e."namespace",e."roomId",e."actorFirebaseIdentityId",e."requestKey",e."matchId",e."revision",e."sequence") WHERE (e."namespace",e."roomId",e."matchId",e."actorFirebaseIdentityId",e."eventType",e."revision",e."sequence")=(OLD."namespace",OLD."roomId",OLD."id",OLD."ownerFirebaseIdentityId",'BEGIN_CORRECTION',st."revision"+1,st."sequence"+1) AND convert_from(c."intent",'UTF8')::JSONB->>'type'='BEGIN_CORRECTION' AND convert_from(c."intent",'UTF8')::JSONB->>'intentId'=c."requestKey" AND convert_from(c."intent",'UTF8')::JSONB->>'expectedRevision'=st."revision"::TEXT AND EXISTS(SELECT 1 FROM public."HuroofMember" owner_member WHERE (owner_member."namespace",owner_member."roomId",owner_member."firebaseIdentityId")=(OLD."namespace",OLD."roomId",OLD."ownerFirebaseIdentityId") AND owner_member."role"='OWNER' AND owner_member."revokedAt" IS NULL)) THEN RAISE EXCEPTION 'correction receipt and event proof missing'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER "HuroofMatch_guard" BEFORE UPDATE OR DELETE ON public."HuroofMatch" FOR EACH ROW EXECUTE FUNCTION public.eng03_03_match_update_guard();
CREATE FUNCTION public.eng03_03_match_transition_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE st public."HuroofCanonicalState"%ROWTYPE;
BEGIN
 IF NOT ((OLD."state"='FINISHED' AND NEW."state"='ACTIVE') OR (OLD."state"='ACTIVE' AND NEW."state"='FINISHED')) THEN RETURN NULL; END IF;
 SELECT * INTO st FROM public."HuroofCanonicalState" WHERE ("namespace","roomId","activeMatchId")=(NEW."namespace",NEW."roomId",NEW."id");
 IF NOT FOUND THEN RAISE EXCEPTION 'match transition lost current canonical state'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofEvent" e JOIN public."HuroofCommandReceipt" c ON (c."namespace",c."roomId",c."actorFirebaseIdentityId",c."requestKey",c."matchId",c."resultingRevision",c."resultingSequence")=(e."namespace",e."roomId",e."actorFirebaseIdentityId",e."requestKey",e."matchId",e."revision",e."sequence") JOIN public."HuroofRealtimeOutbox" o ON (o."namespace",o."roomId",o."sequence",o."eventId")=(e."namespace",e."roomId",e."sequence",e."id") JOIN public."HuroofOutboxDelivery" d ON (d."namespace",d."roomId",d."sequence")=(o."namespace",o."roomId",o."sequence") WHERE (e."namespace",e."roomId",e."matchId",e."actorFirebaseIdentityId",e."revision",e."sequence")=(NEW."namespace",NEW."roomId",NEW."id",NEW."ownerFirebaseIdentityId",st."revision",st."sequence") AND (OLD."state"<>'FINISHED' OR e."eventType"='BEGIN_CORRECTION')) OR NOT EXISTS(SELECT 1 FROM public."HuroofProjection" p WHERE (p."namespace",p."roomId",p."audience",p."scope",p."revision",p."throughSequence")=(NEW."namespace",NEW."roomId",'PUBLIC','public',st."revision",st."sequence")) THEN RAISE EXCEPTION 'match transition lacks receipt event projection or outbox'; END IF;
 IF OLD."state"='FINISHED' AND (st."status"<>'ACTIVE' OR st."privateState"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'CORRECTION' OR st."privateState"->'currentResult' IS DISTINCT FROM 'null'::JSONB) THEN RAISE EXCEPTION 'correction transition incomplete'; END IF;
 IF NEW."state"='FINISHED' AND (st."status"<>'FINISHED' OR st."privateState"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'MATCH_COMPLETE' OR jsonb_typeof(st."privateState"->'currentResult') IS DISTINCT FROM 'object' OR NOT EXISTS(SELECT 1 FROM public."HuroofMatchResult" result WHERE result."namespace"=NEW."namespace" AND result."matchId"=NEW."id" AND result."resultVersion"::TEXT=st."privateState"->'currentResult'->>'version' AND result."resultHash"=st."privateState"->'currentResult'->>'hash' AND result."resultVersion"=(SELECT max(latest."resultVersion") FROM public."HuroofMatchResult" latest WHERE latest."namespace"=NEW."namespace" AND latest."matchId"=NEW."id"))) THEN RAISE EXCEPTION 'terminal result reference incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "HuroofMatch_transition_closure" AFTER UPDATE ON public."HuroofMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_03_match_transition_closure();

CREATE FUNCTION public.eng03_03_lock_history(p_namespace TEXT,p_owner TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public."HuroofOwnerHistoryHead" WHERE ("namespace","ownerFirebaseIdentityId")=(p_namespace,p_owner) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'history head unavailable'; END IF;
END $$;
-- Command transaction, including terminal and correction closure.
CREATE FUNCTION public.eng03_03_command_commit(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_member_generation BIGINT,p_revision BIGINT,p_sequence BIGINT,p_policy_revision TEXT,p_policy_hash TEXT,p_intent JSONB,p_next JSONB,p_members JSONB,p_projections JSONB,p_semantic JSONB,p_custody JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE room public."HuroofRoom"%ROWTYPE; member public."HuroofMember"%ROWTYPE; st public."HuroofCanonicalState"%ROWTYPE; prior public."HuroofCommandReceipt"%ROWTYPE; project TEXT; actor_uid TEXT; item JSONB; subject_identity TEXT; subject_role TEXT; seq BIGINT; rev BIGINT; event_id TEXT; intent_bytes BYTEA; outcome JSONB; outcome_bytes BYTEA; matchrow public."HuroofMatch"%ROWTYPE; latest public."HuroofMatchResult"%ROWTYPE; history public."HuroofOwnerHistoryHead"%ROWTYPE; next_private JSONB; next_status TEXT; last_ref JSONB; result_bytes BYTEA; provenance_bytes BYTEA; result_hash TEXT; result_id TEXT; result_version BIGINT; event_type TEXT; terminal BOOLEAN; changed BOOLEAN;
BEGIN
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
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'intentId' IS NULL OR (p_intent->>'type'='SERVER_TIME_EXPIRED' AND p_intent->>'intentId' IS DISTINCT FROM ':expiry:'||st."activeMatchId"||':'||(p_sequence+1)::TEXT) OR (p_intent->>'type' IS DISTINCT FROM 'SERVER_TIME_EXPIRED' AND p_intent->>'intentId' !~ '^[A-Za-z0-9_-]{1,120}$') THEN RAISE EXCEPTION 'invalid intent'; END IF;
 SELECT * INTO prior FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey")=(p_namespace,p_room,p_identity,p_intent->>'intentId');
 IF FOUND THEN
  IF convert_from(prior."intent",'UTF8')::JSONB IS DISTINCT FROM p_intent OR prior."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(prior."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'command intent conflict'; END IF;
  RETURN convert_from(prior."outcome",'UTF8')::JSONB || jsonb_build_object('replayed',true);
 END IF;
 PERFORM public.eng03_03_assert_current(p_namespace,p_identity,p_policy_revision,p_policy_hash);
 IF room."status"<>'ACTIVE' OR st."revision"<>p_revision OR st."sequence"<>p_sequence OR p_intent->>'expectedRevision' IS DISTINCT FROM p_revision::TEXT OR st."privateState"->'room'->>'revision' IS DISTINCT FROM p_revision::TEXT OR (p_next->>'revision') IS DISTINCT FROM (p_revision+1)::TEXT OR p_next->>'roomCode' IS DISTINCT FROM st."privateState"->'room'->>'roomCode' OR jsonb_typeof(p_next->'game') IS DISTINCT FROM 'object' OR jsonb_typeof(p_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_projections) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'command CAS unavailable'; END IF;
 IF p_intent->>'type' IS NULL OR p_intent->>'type' NOT IN ('SERVER_TIME_EXPIRED','ROUND_READY','SELECT_CELL','LETTER_REVEALED','OPEN_QUESTION','BUZZ','HOST_SELECT_TEAM','JUDGE_CORRECT','JUDGE_INCORRECT','RETRY_CELL','RETURN_CELL','END_WITHOUT_WINNER','AWARD_CELL','CHECK_PATH','START_NEXT_ROUND','PAUSE','RESUME','BEGIN_CORRECTION','CONFIRM_CORRECTION','CANCEL_CORRECTION','SET_AUDIENCE_QUESTION_VISIBILITY','REVEAL_ANSWER') OR (p_intent->>'type' NOT IN ('BUZZ','SERVER_TIME_EXPIRED') AND member."role"<>'OWNER') THEN RAISE EXCEPTION 'command unauthorized'; END IF;
 IF p_members IS DISTINCT FROM st."privateState"->'members' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_members) AS x(value) WHERE x.value->>'uid'=actor_uid AND x.value->'active'='true'::JSONB AND ((member."role"='OWNER' AND x.value->>'role'='host') OR (member."role"='MEMBER' AND ((x.value->>'role'='player' AND p_intent->>'type'='BUZZ') OR (x.value->>'role' IN ('player','audience') AND p_intent->>'type'='SERVER_TIME_EXPIRED'))))) THEN RAISE EXCEPTION 'member authority mismatch'; END IF;
 IF p_intent->>'type'='SERVER_TIME_EXPIRED' AND ((p_intent-ARRAY['type','intentId','expectedRevision','payload']::TEXT[])<>'{}'::JSONB OR p_intent->'payload' IS DISTINCT FROM '{}'::JSONB OR st."privateState"->'room'->'game'->>'lifecycle' IS DISTINCT FROM 'OPPONENT_CHANCE' OR st."privateState"->'room'->'timer'->>'deadlineMs' IS NULL OR st."privateState"->'room'->'timer'->>'deadlineMs' !~ '^(0|[1-9][0-9]*)$' OR (st."privateState"->'room'->'timer'->>'deadlineMs')::BIGINT>floor(extract(epoch FROM clock_timestamp())*1000)::BIGINT OR p_next IS DISTINCT FROM jsonb_set(jsonb_set((st."privateState"->'room')-ARRAY['timer','buzzWinner']::TEXT[],'{revision}',to_jsonb(st."revision"+1)),'{game,lifecycle}','"QUESTION_FAILED"'::JSONB)) THEN RAISE EXCEPTION 'timer expiry unavailable'; END IF;
 IF p_intent->>'type'='SET_AUDIENCE_QUESTION_VISIBILITY' THEN
  IF (p_next->'config'-'showQuestionOnAudience') IS DISTINCT FROM (st."privateState"->'room'->'config'-'showQuestionOnAudience') OR p_next->'config'->'showQuestionOnAudience' IS DISTINCT FROM p_intent->'payload'->'showQuestion' THEN RAISE EXCEPTION 'config mutation mismatch'; END IF;
 ELSIF p_next->'config' IS DISTINCT FROM st."privateState"->'room'->'config' THEN RAISE EXCEPTION 'config mutation mismatch'; END IF;
 SELECT * INTO matchrow FROM public."HuroofMatch" WHERE ("namespace","id","roomId")=(p_namespace,st."activeMatchId",p_room) FOR UPDATE;
 IF NOT FOUND OR matchrow."state" NOT IN ('ACTIVE','FINISHED') OR st."privateState"->'room'->'game'->>'lifecycle' IS NULL OR p_next->'game'->>'lifecycle' IS NULL THEN RAISE EXCEPTION 'current match unavailable'; END IF;
 IF st."status"='FINISHED' AND (matchrow."state"<>'FINISHED' OR NOT ((p_intent->>'type'='BEGIN_CORRECTION' AND p_next->'game'->>'lifecycle'='CORRECTION') OR (p_intent->>'type'='SET_AUDIENCE_QUESTION_VISIBILITY' AND p_next->'game'->>'lifecycle'='MATCH_COMPLETE'))) THEN RAISE EXCEPTION 'terminal command unavailable'; END IF;
 IF st."status"='ACTIVE' AND matchrow."state"<>'ACTIVE' THEN RAISE EXCEPTION 'match state mismatch'; END IF;
 IF st."status" NOT IN ('ACTIVE','FINISHED') THEN RAISE EXCEPTION 'current match unavailable'; END IF;
 -- Exact current policy and historical immutable subject are rejoined after room/state locks.
 IF p_intent->>'type' IN ('SELECT_CELL','LETTER_REVEALED','RETRY_CELL','RETURN_CELL','START_NEXT_ROUND') AND p_custody IS NULL THEN RAISE EXCEPTION 'custody evidence unavailable'; END IF;
 IF p_custody IS NOT NULL THEN PERFORM public.eng03_03_custody_assert(p_namespace,project,p_identity,p_room,p_generation,NULL,matchrow."id",p_policy_revision,p_policy_hash,p_custody); END IF;
 terminal:=p_next->'game'->>'lifecycle'='MATCH_COMPLETE';
 IF jsonb_typeof(p_semantic) IS DISTINCT FROM 'object' OR p_semantic->'board' IS DISTINCT FROM p_next->'game'->'board' OR p_semantic->'questionScores' IS DISTINCT FROM p_next->'game'->'questionScores' OR p_semantic->'roundOutcomeHistory' IS DISTINCT FROM p_next->'game'->'roundOutcomeHistory' OR p_semantic->'currentRound' IS DISTINCT FROM p_next->'game'->'currentRound' OR p_semantic->'endedWithoutWinner' IS DISTINCT FROM COALESCE(p_next->'game'->'endedWithoutWinner','false'::JSONB) THEN RAISE EXCEPTION 'result semantics mismatch'; END IF;
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
 event_type:=(CASE WHEN changed THEN 'FINISHED' ELSE p_intent->>'type' END);
 next_status:=(CASE WHEN terminal THEN 'FINISHED' ELSE 'ACTIVE' END);
 next_private:=st."privateState"||jsonb_build_object('room',p_next,'members',p_members,'currentResult',CASE WHEN terminal AND NOT changed THEN last_ref ELSE 'null'::JSONB END);
 IF jsonb_array_length(p_projections)<>(SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."revokedAt" IS NULL) OR (SELECT count(DISTINCT value->>'uid') FROM jsonb_array_elements(p_projections))<>jsonb_array_length(p_projections) THEN RAISE EXCEPTION 'projection scope mismatch'; END IF;
 seq:=st."sequence"+1; rev:=st."revision"+1;
 event_id:=encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,p_room,p_identity,p_intent->>'intentId')::TEXT,'UTF8'),'sha256'),'hex');
 intent_bytes:=convert_to(p_intent::TEXT,'UTF8'); outcome:=jsonb_build_object('revision',rev,'sequence',seq,'replayed',false); outcome_bytes:=convert_to(outcome::TEXT,'UTF8');
 INSERT INTO public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId","intent","intentHash","outcome","outcomeHash","resultingRevision","resultingSequence") VALUES(p_namespace,p_room,p_identity,p_intent->>'intentId',st."activeMatchId",intent_bytes,encode(int4_crypto.digest(intent_bytes,'sha256'),'hex'),outcome_bytes,encode(int4_crypto.digest(outcome_bytes,'sha256'),'hex'),rev,seq);
 INSERT INTO public."HuroofEvent"("namespace","roomId","sequence","id","matchId","actorFirebaseIdentityId","requestKey","revision","eventType") VALUES(p_namespace,p_room,seq,event_id,st."activeMatchId",p_identity,p_intent->>'intentId',rev,event_type);
 -- The exact receipt/event exists before the match guard validates a terminal reopening.
 IF st."status"='FINISHED' AND p_intent->>'type'='BEGIN_CORRECTION' THEN UPDATE public."HuroofMatch" SET "state"='ACTIVE',"version"="version"+1 WHERE ("namespace","id")=(p_namespace,matchrow."id"); END IF;
 IF terminal AND matchrow."state"='ACTIVE' THEN UPDATE public."HuroofMatch" SET "state"='FINISHED',"version"="version"+1 WHERE ("namespace","id")=(p_namespace,matchrow."id"); END IF;
 IF changed THEN
  result_version:=(CASE WHEN last_ref IS NULL THEN 1 ELSE (last_ref->>'version')::BIGINT+1 END);
  result_bytes:=convert_to(p_semantic::TEXT,'UTF8'); result_hash:=encode(int4_crypto.digest(result_bytes,'sha256'),'hex');
  result_id:=encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,matchrow."id",seq,'result')::TEXT,'UTF8'),'sha256'),'hex');
  provenance_bytes:=convert_to(jsonb_build_object('schema','huroof-command-result-v1','namespace',p_namespace,'roomId',p_room,'matchId',matchrow."id",'admissionId',matchrow."admissionId",'eventId',event_id,'revision',rev,'sequence',seq,'intentHash',encode(int4_crypto.digest(intent_bytes,'sha256'),'hex'))::TEXT,'UTF8');
  INSERT INTO public."HuroofRawArtifact"("namespace","id","contentHash","byteLength","mediaType","rawBytes","provenanceBytes","provenanceHash","serialization") VALUES(p_namespace,result_id,result_hash,octet_length(result_bytes),'application/json',result_bytes,provenance_bytes,encode(int4_crypto.digest(provenance_bytes,'sha256'),'hex'),'huroof-command-result-v1');
  INSERT INTO public."HuroofMatchResult"("namespace","matchId","roomId","resultVersion","resultHash","ownerFirebaseIdentityId","admissionId","terminalEventId","terminalSequence","rawArtifactId","previousVersion","previousHash") VALUES(p_namespace,matchrow."id",p_room,result_version,result_hash,room."ownerFirebaseIdentityId",matchrow."admissionId",event_id,seq,result_id,CASE WHEN last_ref IS NULL THEN NULL ELSE (last_ref->>'version')::BIGINT END,CASE WHEN last_ref IS NULL THEN NULL ELSE last_ref->>'hash' END);
  INSERT INTO public."HuroofOwnerHistoryHead"("namespace","ownerFirebaseIdentityId") VALUES(p_namespace,room."ownerFirebaseIdentityId") ON CONFLICT("namespace","ownerFirebaseIdentityId") DO NOTHING;
  PERFORM public.eng03_03_lock_history(p_namespace,room."ownerFirebaseIdentityId");
  SELECT * INTO history FROM public."HuroofOwnerHistoryHead" WHERE ("namespace","ownerFirebaseIdentityId")=(p_namespace,room."ownerFirebaseIdentityId");
  INSERT INTO public."HuroofOwnerHistoryEntry"("namespace","ownerFirebaseIdentityId","sequence","matchId","resultVersion","resultHash","occurredAt","provenance","provenanceHash") VALUES(p_namespace,room."ownerFirebaseIdentityId",history."nextSequence",matchrow."id",result_version,result_hash,clock_timestamp(),provenance_bytes,encode(int4_crypto.digest(provenance_bytes,'sha256'),'hex'));
  last_ref:=jsonb_build_object('version',result_version,'hash',result_hash);
  next_private:=next_private||jsonb_build_object('lastResult',last_ref,'currentResult',last_ref,'previousTerminalRoom',p_next,'previousTerminalSemantic',p_semantic);
 END IF;
 UPDATE public."HuroofCanonicalState" SET "status"=next_status,"revision"=rev,"sequence"=seq,"privateState"=next_private,"updatedAt"=clock_timestamp() WHERE ("namespace","roomId")=(p_namespace,p_room);
 FOR item IN SELECT value FROM jsonb_array_elements(p_projections) LOOP
  SELECT i."id" INTO subject_identity FROM public."FirebaseIdentity" i JOIN public."HuroofMember" m ON m."firebaseIdentityId"=i."id" AND m."namespace"=p_namespace AND m."roomId"=p_room AND m."revokedAt" IS NULL WHERE i."firebaseProjectId"=project AND i."firebaseUid"=item->>'uid';
  IF NOT FOUND THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  SELECT x.value->>'role' INTO subject_role FROM jsonb_array_elements(p_members) AS x(value) WHERE x.value->>'uid'=item->>'uid' AND x.value->'active'='true'::JSONB;
  IF NOT FOUND OR subject_role NOT IN ('host','player','audience') OR item->'payload'->>'role' IS DISTINCT FROM subject_role OR item->'payload'->>'revision' IS DISTINCT FROM rev::TEXT OR NOT public.eng03_03_projection_safe(item->'payload',subject_identity=room."ownerFirebaseIdentityId") THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(p_namespace,p_room,CASE WHEN subject_identity=room."ownerFirebaseIdentityId" THEN 'OWNER' ELSE 'MEMBER' END,subject_identity,rev,seq,room."generation",item->'payload') ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 END LOOP;
 INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(p_namespace,p_room,'PUBLIC','public',rev,seq,room."generation",jsonb_build_object('status',p_next->'game'->>'lifecycle','revision',rev)) ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 INSERT INTO public."HuroofRealtimeOutbox"("namespace","roomId","sequence","eventId") VALUES(p_namespace,p_room,seq,event_id);
 INSERT INTO public."HuroofOutboxDelivery"("namespace","roomId","sequence") VALUES(p_namespace,p_room,seq);
 RETURN outcome;
END $$;
CREATE FUNCTION public.eng03_03_paid_identity(p_namespace TEXT,p_project TEXT,p_identity TEXT,p_room TEXT,p_key TEXT) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE digest TEXT;
BEGIN
 IF p_namespace IS NULL OR p_project IS NULL OR p_identity IS NULL OR p_room IS NULL OR p_key IS NULL OR p_key !~ '^[A-Za-z0-9_-]{1,120}$' THEN RAISE EXCEPTION 'invalid paid key'; END IF;
 digest:=encode(int4_crypto.digest(convert_to(jsonb_build_array(p_namespace,p_project,p_identity,p_room,p_key)::TEXT,'UTF8'),'sha256'),'hex');
 RETURN jsonb_build_object('admissionId','ha_'||digest,'matchId','hm_'||digest,'logicalMatchId','hl_'||digest);
END $$;
-- Metadata-only replay compares client intent to the original complete stored request; no current content/policy eligibility is evaluated.
CREATE FUNCTION public.eng03_03_find_paid(p_namespace TEXT,p_identity TEXT,p_room TEXT,p_key TEXT,p_logical TEXT,p_client JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE by_key public."Admission"%ROWTYPE; by_logical public."Admission"%ROWTYPE; admission public."Admission"%ROWTYPE; matchrow public."HuroofMatch"%ROWTYPE; receipt public."HuroofCommandReceipt"%ROWTYPE; raw JSONB; saved JSONB; project TEXT; derived JSONB; has_key BOOLEAN; has_logical BOOLEAN;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r JOIN public."DeploymentNamespace" n ON n."namespaceId"=r."namespace" JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE (r."namespace",r."id",r."ownerFirebaseIdentityId")=(p_namespace,p_room,p_identity)) THEN RAISE EXCEPTION 'owner unavailable'; END IF;
 SELECT n."firebaseProjectId" INTO project FROM public."DeploymentNamespace" n WHERE n."namespaceId"=p_namespace;
 derived:=public.eng03_03_paid_identity(p_namespace,project,p_identity,p_room,p_key);
 IF derived->>'logicalMatchId' IS DISTINCT FROM p_logical THEN RAISE EXCEPTION 'paid identity mismatch'; END IF;
 SELECT * INTO by_key FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "requestKey"=p_key; has_key:=FOUND;
 SELECT * INTO by_logical FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "engine"='HUROOF' AND "logicalMatchId"=p_logical; has_logical:=FOUND;
 IF has_key AND has_logical AND by_key."id"<>by_logical."id" THEN RAISE EXCEPTION 'paid start collision'; END IF;
 IF NOT has_key AND NOT has_logical THEN RETURN NULL; END IF;
 IF has_key THEN admission:=by_key; ELSE admission:=by_logical; END IF;
 IF admission."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR admission."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR admission."state" IS DISTINCT FROM 'COMMITTED' OR admission."requestKey" IS DISTINCT FROM p_key OR admission."logicalMatchId" IS DISTINCT FROM p_logical THEN RAISE EXCEPTION 'paid start conflict'; END IF;
 SELECT * INTO matchrow FROM public."HuroofMatch" WHERE "admissionId"=admission."id" AND "namespace"=p_namespace AND "roomId"=p_room AND "ownerFirebaseIdentityId"=p_identity;
 IF NOT FOUND OR admission."id" IS DISTINCT FROM derived->>'admissionId' OR matchrow."id" IS DISTINCT FROM derived->>'matchId' OR matchrow."rawIntentHash" IS DISTINCT FROM encode(int4_crypto.digest(matchrow."rawIntent",'sha256'),'hex') OR admission."intentHash" IS DISTINCT FROM matchrow."rawIntentHash" THEN RAISE EXCEPTION 'paid receipt unavailable'; END IF;
 raw:=convert_from(matchrow."rawIntent",'UTF8')::JSONB;
 IF raw->'request'->'intent'->'clientIntent' IS DISTINCT FROM p_client OR raw->'request'->>'identityId' IS DISTINCT FROM p_identity OR raw->'request'->>'requestKey' IS DISTINCT FROM p_key OR raw->'request'->>'logicalMatchId' IS DISTINCT FROM p_logical OR admission."requestHash" IS DISTINCT FROM public.int5b_hash_json(raw->'request') OR raw->'request'->'initial'->'config' IS DISTINCT FROM matchrow."config" OR raw->'request'->'initial'->>'configHash' IS DISTINCT FROM matchrow."configHash" THEN RAISE EXCEPTION 'paid start intent conflict'; END IF;
 IF public.eng03_02_huroof_find_start(p_identity,p_key,p_logical,p_namespace,p_room) IS NULL THEN RAISE EXCEPTION 'paid receipt unavailable'; END IF;
 SELECT * INTO receipt FROM public."HuroofCommandReceipt" WHERE ("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId")=(p_namespace,p_room,p_identity,p_key,matchrow."id");
 IF NOT FOUND OR receipt."intent" IS DISTINCT FROM matchrow."rawIntent" OR receipt."intentHash" IS DISTINCT FROM matchrow."rawIntentHash" OR receipt."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(receipt."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'paid receipt unavailable'; END IF;
 saved:=convert_from(receipt."outcome",'UTF8')::JSONB;
 IF saved->>'admissionId' IS DISTINCT FROM admission."id" OR saved->>'matchId' IS DISTINCT FROM matchrow."id" OR saved->>'roomId' IS DISTINCT FROM p_room OR saved->>'status' IS DISTINCT FROM 'STARTED' OR saved->>'state' IS DISTINCT FROM 'COMMITTED' THEN RAISE EXCEPTION 'paid receipt unavailable'; END IF;
 RETURN jsonb_build_object('admissionId',admission."id",'matchId',matchrow."id",'roomId',p_room,'status','STARTED','state','COMMITTED','revision',receipt."resultingRevision",'sequence',receipt."resultingSequence",'replayed',true);
END $$;
-- Source successor copies accepted02 financial body with bounded lobby/custody/playable-state changes; exact equivalence review required.
CREATE FUNCTION public.eng03_03_paid_start(p_identity TEXT,p_request_key TEXT,p_logical_match_id TEXT,p_intent JSONB,p_initial JSONB,p_projections JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 w public."Wallet"%ROWTYPE; identity_row public."FirebaseIdentity"%ROWTYPE; namespace_row public."DeploymentNamespace"%ROWTYPE;
 request_admission public."Admission"%ROWTYPE; logical_admission public."Admission"%ROWTYPE; a public."Admission"%ROWTYPE;
 r public."Reservation"%ROWTYPE; m public."HuroofMatch"%ROWTYPE; c public."HuroofCommandReceipt"%ROWTYPE;
 room public."HuroofRoom"%ROWTYPE; state_row public."HuroofCanonicalState"%ROWTYPE;
 policy_head public."HuroofIdentityPolicyHead"%ROWTYPE; policy_row public."HuroofIdentityPolicyRevision"%ROWTYPE;
 ptr public."ActiveCatalogPointer"%ROWTYPE; receipt public."CatalogValidationReceipt"%ROWTYPE; seal public."CatalogReleaseSeal"%ROWTYPE;
 profile_pointer public."HuroofContentPointer"%ROWTYPE; profile_revision public."HuroofContentRevision"%ROWTYPE; raw_profile public."HuroofRawArtifact"%ROWTYPE;
 profile JSONB; cfg JSONB; request_envelope JSONB; resolved_envelope JSONB; full_intent JSONB; intent_bytes BYTEA; intent_hash TEXT; request_hash TEXT;
 admission_id TEXT; reservation_id TEXT; match_id TEXT; event_id TEXT; reply JSONB; seq BIGINT; rev BIGINT;
 has_request BOOLEAN:=FALSE; has_logical BOOLEAN:=FALSE; derived JSONB; identity_project TEXT; lobby public."HuroofLobbyRevision"%ROWTYPE; snapshot JSONB; prepared_room JSONB; prepared_members JSONB; projection_item JSONB; projection_identity TEXT; projection_role TEXT;
BEGIN
 IF p_identity IS NULL OR p_request_key IS NULL OR p_request_key='' OR p_logical_match_id IS NULL OR p_logical_match_id='' OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR jsonb_typeof(p_initial) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'typed start request required'; END IF;
 -- No caller EXECUTE is granted until ENG03-03 supplies genuine service auth.
 -- This subject argument is never an authentication proof; no JSON/GUC flag substitutes for verified context.
 IF public.eng03_02_has_secret_key(p_intent) OR public.eng03_02_has_secret_key(p_initial) THEN RAISE EXCEPTION 'credential-shaped request material is not persistable'; END IF;
 IF p_intent->>'namespace' IS NULL OR p_intent->>'roomId' IS NULL OR p_intent->>'profileScope' IS NULL OR p_intent->>'policyRevision' IS NULL OR p_intent->>'policyHash' IS NULL OR p_intent->>'selectorVersion' IS NULL OR p_intent->>'admissionId' IS NULL OR p_intent->>'matchId' IS NULL THEN RAISE EXCEPTION 'complete canonical owner intent required'; END IF;
 IF (p_intent ? 'requestKey' AND p_intent->>'requestKey' IS DISTINCT FROM p_request_key) OR (p_intent ? 'logicalMatchId' AND p_intent->>'logicalMatchId' IS DISTINCT FROM p_logical_match_id) THEN RAISE EXCEPTION 'request identity disagrees with canonical intent'; END IF;
 IF (p_initial-ARRAY['config','configHash']::TEXT[])<>'{}'::JSONB OR p_initial->'config' IS NULL OR jsonb_typeof(p_initial->'config') IS DISTINCT FROM 'object' OR p_initial->>'configHash' IS NULL THEN RAISE EXCEPTION 'initial state must contain only the typed config and its hash'; END IF;
 IF jsonb_typeof(p_intent->'preparedRoom') IS DISTINCT FROM 'object' OR jsonb_typeof(p_intent->'preparedMembers') IS DISTINCT FROM 'array' OR jsonb_typeof(p_intent->'custody') IS DISTINCT FROM 'object' OR p_intent->>'lobbyRevision' !~ '^(0|[1-9][0-9]*)$' OR p_intent->>'lobbyStateHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_projections) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'complete prepared lobby and verified custody required'; END IF;
 prepared_room:=p_intent->'preparedRoom'; prepared_members:=p_intent->'preparedMembers';
 SELECT n."firebaseProjectId" INTO identity_project FROM public."DeploymentNamespace" n JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" WHERE n."namespaceId"=p_intent->>'namespace';
 IF NOT FOUND THEN RAISE EXCEPTION 'identity namespace unavailable'; END IF;
 derived:=public.eng03_03_paid_identity(p_intent->>'namespace',identity_project,p_identity,p_intent->>'roomId',p_request_key);
 IF derived->>'admissionId' IS DISTINCT FROM p_intent->>'admissionId' OR derived->>'matchId' IS DISTINCT FROM p_intent->>'matchId' OR derived->>'logicalMatchId' IS DISTINCT FROM p_logical_match_id THEN RAISE EXCEPTION 'paid identity mismatch'; END IF;
 cfg:=p_initial->'config';
 IF public.eng03_02_has_secret_key(cfg) THEN RAISE EXCEPTION 'credential-shaped config is not persistable'; END IF;
 request_envelope:=jsonb_build_object('version',2,'identityId',p_identity,'requestKey',p_request_key,'logicalMatchId',p_logical_match_id,'intent',p_intent-'requestHash','initial',p_initial);
 request_hash:=public.int5b_hash_json(request_envelope);

 -- The shared wallet lock serializes new PG starts with the legacy reserve path.
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=p_identity FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet unavailable'; END IF;
 SELECT * INTO request_admission FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "requestKey"=p_request_key FOR UPDATE;
 has_request:=FOUND;
 SELECT * INTO logical_admission FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "engine"='HUROOF' AND "logicalMatchId"=p_logical_match_id FOR UPDATE;
 has_logical:=FOUND;
 IF has_request AND has_logical AND request_admission."id"<>logical_admission."id" THEN RAISE EXCEPTION 'global request and logical-match keys resolve to distinct admissions'; END IF;
 IF has_request THEN a:=request_admission; ELSIF has_logical THEN a:=logical_admission; END IF;
 IF has_request OR has_logical THEN
  IF a."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR a."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR a."requestKey" IS DISTINCT FROM p_request_key OR a."logicalMatchId" IS DISTINCT FROM p_logical_match_id THEN RAISE EXCEPTION 'global legacy or cross-generation start collision'; END IF;
  IF a."requestHash" IS DISTINCT FROM request_hash OR a."state" IS DISTINCT FROM 'COMMITTED' THEN RAISE EXCEPTION 'complete canonical start intent conflicts with stored admission'; END IF;
  SELECT * INTO r FROM public."Reservation" WHERE "admissionId"=a."id" FOR UPDATE;
  IF NOT FOUND OR r."state" IS DISTINCT FROM 'COMMITTED' OR r."quantity"<>1 THEN RAISE EXCEPTION 'stored paid start lacks committed reservation'; END IF;
  SELECT * INTO m FROM public."HuroofMatch" WHERE "admissionId"=a."id";
  IF NOT FOUND OR m."ownerFirebaseIdentityId" IS DISTINCT FROM p_identity OR m."rawIntentHash" IS DISTINCT FROM encode(int4_crypto.digest(m."rawIntent",'sha256'),'hex') OR a."intentHash" IS DISTINCT FROM m."rawIntentHash" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request' IS DISTINCT FROM request_envelope THEN RAISE EXCEPTION 'stored start identity or complete intent differs'; END IF;
  SELECT * INTO room FROM public."HuroofRoom" WHERE "namespace"=m."namespace" AND "id"=m."roomId" AND "ownerFirebaseIdentityId"=p_identity FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'current room owner authority required for saved replay'; END IF;
  SELECT * INTO c FROM public."HuroofCommandReceipt" WHERE "namespace"=m."namespace" AND "roomId"=m."roomId" AND "actorFirebaseIdentityId"=p_identity AND "requestKey"=p_request_key;
  IF NOT FOUND OR c."matchId" IS DISTINCT FROM m."id" OR c."intent" IS DISTINCT FROM m."rawIntent" OR c."intentHash" IS DISTINCT FROM m."rawIntentHash" OR c."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(c."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'stored sealed command outcome is incomplete'; END IF;
  RETURN convert_from(c."outcome",'UTF8')::JSONB||jsonb_build_object('replayed',true);
 END IF;

 IF w."debt">0 OR w."available"<1 THEN RAISE EXCEPTION 'wallet cannot reserve'; END IF;
 SELECT * INTO identity_row FROM public."FirebaseIdentity" WHERE "id"=p_identity;
 SELECT * INTO namespace_row FROM public."DeploymentNamespace" WHERE "namespaceId"=p_intent->>'namespace';
 IF NOT FOUND OR identity_row."firebaseProjectId" IS DISTINCT FROM namespace_row."firebaseProjectId" THEN RAISE EXCEPTION 'current identity and namespace project do not match'; END IF;
 SELECT * INTO room FROM public."HuroofRoom" WHERE "namespace"=p_intent->>'namespace' AND "id"=p_intent->>'roomId' AND "ownerFirebaseIdentityId"=p_identity FOR UPDATE;
 IF NOT FOUND OR room."status" NOT IN ('SETUP','ACTIVE') THEN RAISE EXCEPTION 'owned room unavailable'; END IF;
 PERFORM public.eng03_03_lock_members(room."namespace",room."id");
 IF room."status" IS DISTINCT FROM 'SETUP' THEN RAISE EXCEPTION 'same-room successor unavailable'; END IF;
 IF jsonb_typeof(p_intent->'clientIntent') IS DISTINCT FROM 'object' OR ((p_intent->'clientIntent')-ARRAY['locator','intentId','profileScope','expectedRevision']::TEXT[])<>'{}'::JSONB OR p_intent->'clientIntent'->>'intentId' IS DISTINCT FROM p_request_key OR p_intent->'clientIntent'->>'profileScope' IS DISTINCT FROM p_intent->>'profileScope' OR p_intent->'clientIntent'->>'expectedRevision' IS DISTINCT FROM p_intent->>'lobbyRevision' OR NOT EXISTS(SELECT 1 FROM public."HuroofLocator" l WHERE (l."namespace",l."roomId",l."generation")=(room."namespace",room."id",2) AND p_intent->'clientIntent'->>'locator'='M2-'||l."code") THEN RAISE EXCEPTION 'paid client intent mismatch'; END IF;
 SELECT * INTO lobby FROM public."HuroofLobbyRevision" WHERE "namespace"=room."namespace" AND "roomId"=room."id" ORDER BY "revision" DESC LIMIT 1;
 IF NOT FOUND OR lobby."revision"::TEXT IS DISTINCT FROM p_intent->>'lobbyRevision' OR lobby."stateHash" IS DISTINCT FROM p_intent->>'lobbyStateHash' OR public.int5b_hash_json(lobby."state") IS DISTINCT FROM lobby."stateHash" OR lobby."ownerFirebaseIdentityId" IS DISTINCT FROM p_identity OR lobby."roomGeneration" IS DISTINCT FROM room."generation" OR p_intent->>'roomGeneration' IS DISTINCT FROM room."generation"::TEXT OR prepared_room->>'revision' IS DISTINCT FROM (lobby."revision"+1)::TEXT OR prepared_room->>'roomCode' IS DISTINCT FROM lobby."state"->'room'->>'roomCode' OR prepared_room->'config' IS DISTINCT FROM cfg OR lobby."state"->'room'->'config' IS DISTINCT FROM cfg OR prepared_room->'manualParticipants' IS DISTINCT FROM lobby."state"->'room'->'manualParticipants' OR prepared_room->'questionCursor' IS DISTINCT FROM lobby."state"->'room'->'questionCursor' OR prepared_room->'game'->>'lifecycle' IS DISTINCT FROM 'ROUND_SETUP' OR jsonb_typeof(prepared_room->'game'->'board'->'cells') IS DISTINCT FROM 'array' OR jsonb_array_length(prepared_room->'game'->'board'->'cells')<>25 OR prepared_members IS DISTINCT FROM lobby."state"->'members' THEN RAISE EXCEPTION 'lobby preparation changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(lobby."state"->'memberBindings') AS b(value) LEFT JOIN public."HuroofMember" m ON (m."namespace",m."roomId",m."firebaseIdentityId")=(room."namespace",room."id",b.value->>'identityId') AND m."revokedAt" IS NULL WHERE m."firebaseIdentityId" IS NULL OR b.value->>'generation' IS DISTINCT FROM m."generation"::TEXT OR b.value->>'version' IS DISTINCT FROM m."version"::TEXT) OR (SELECT count(*) FROM public."HuroofMember" m WHERE m."namespace"=room."namespace" AND m."roomId"=room."id" AND m."revokedAt" IS NULL)<>jsonb_array_length(lobby."state"->'memberBindings') OR NOT EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE (m."namespace",m."roomId",m."firebaseIdentityId",m."role")=(room."namespace",room."id",p_identity,'OWNER') AND m."revokedAt" IS NULL) THEN RAISE EXCEPTION 'lobby authority changed'; END IF;
 IF jsonb_array_length(COALESCE(prepared_room->'manualParticipants','[]'::JSONB))<>(SELECT count(*) FROM public."HuroofParticipant" pp WHERE pp."namespace"=room."namespace" AND pp."roomId"=room."id" AND pp."memberFirebaseIdentityId" IS NULL) OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prepared_room->'manualParticipants','[]'::JSONB)) AS a(value) WHERE NOT EXISTS(SELECT 1 FROM public."HuroofParticipant" pp WHERE pp."namespace"=room."namespace" AND pp."roomId"=room."id" AND pp."memberFirebaseIdentityId" IS NULL AND pp."id"=a.value->>'id' AND pp."displayName"=a.value->>'displayName' AND pp."team"=a.value->>'team')) THEN RAISE EXCEPTION 'manual participants changed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(prepared_members) AS m(value) WHERE m.value->>'role'='player' AND m.value->'active'='true'::JSONB AND m.value->'ready' IS DISTINCT FROM 'true'::JSONB) OR ((SELECT count(*) FROM jsonb_array_elements(prepared_members) AS m(value) WHERE m.value->>'role'='player' AND m.value->'active'='true'::JSONB)+jsonb_array_length(COALESCE(prepared_room->'manualParticipants','[]'::JSONB))>0 AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prepared_members) AS m(value) WHERE m.value->>'role'='player' AND m.value->'active'='true'::JSONB AND m.value->>'team'='horizontal') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prepared_room->'manualParticipants','[]'::JSONB)) AS m(value) WHERE m.value->>'team'='horizontal') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prepared_members) AS m(value) WHERE m.value->>'role'='player' AND m.value->'active'='true'::JSONB AND m.value->>'team'='vertical') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(prepared_room->'manualParticipants','[]'::JSONB)) AS m(value) WHERE m.value->>'team'='vertical'))) THEN RAISE EXCEPTION 'lobby teams not ready'; END IF;
 SELECT * INTO state_row FROM public."HuroofCanonicalState" WHERE "namespace"=room."namespace" AND "roomId"=room."id" FOR UPDATE;
 IF FOUND THEN RAISE EXCEPTION 'same-room successor unavailable'; ELSE seq:=1; rev:=lobby."revision"+1; END IF;
 PERFORM public.eng03_03_assert_current(room."namespace",p_identity,p_intent->>'policyRevision',p_intent->>'policyHash');
 SELECT * INTO policy_head FROM public."HuroofIdentityPolicyHead" WHERE "namespace"=room."namespace";
 IF NOT FOUND OR policy_head."revision"::TEXT IS DISTINCT FROM p_intent->>'policyRevision' OR policy_head."policyHash" IS DISTINCT FROM p_intent->>'policyHash' THEN RAISE EXCEPTION 'current identity policy unavailable or changed'; END IF;
 SELECT * INTO policy_row FROM public."HuroofIdentityPolicyRevision" WHERE "namespace"=room."namespace" AND "revision"=policy_head."revision" AND "policyHash"=policy_head."policyHash";
 IF NOT FOUND OR policy_row."firebaseProjectId" IS DISTINCT FROM namespace_row."firebaseProjectId" OR policy_row."issuer"='' OR jsonb_typeof(policy_row."audience") IS DISTINCT FROM 'object' OR encode(int4_crypto.digest(policy_row."rawPolicy",'sha256'),'hex') IS DISTINCT FROM policy_row."policyHash" THEN RAISE EXCEPTION 'immutable namespace identity policy is not internally consistent'; END IF;
 SELECT * INTO ptr FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'active catalog pointer unavailable'; END IF;
 SELECT * INTO receipt FROM public."CatalogValidationReceipt" WHERE "id"=ptr."validationReceiptId" AND "catalogReleaseId"=ptr."catalogReleaseId" AND "releaseRootHash"=ptr."releaseRootHash";
 IF NOT FOUND OR receipt."huroofProjectId" IS DISTINCT FROM namespace_row."firebaseProjectId" OR receipt."huroofReleaseId" IS DISTINCT FROM cfg->>'releaseId' OR receipt."huroofRootSha256" IS DISTINCT FROM cfg->>'releaseRootSha256' OR receipt."huroofCapabilityStateHash" IS NULL OR receipt."selectorVersion" IS DISTINCT FROM p_intent->>'selectorVersion' OR receipt."policyVersion" IS DISTINCT FROM p_intent->>'readinessPolicyVersion' THEN RAISE EXCEPTION 'active sealed receipt does not authorize this namespace/config/selector'; END IF;
  IF NOT public.int5b_valid_config(cfg) OR public.int5b_hash_json(cfg) IS DISTINCT FROM p_initial->>'configHash' OR cfg->'demo' IS DISTINCT FROM 'false'::JSONB OR cfg->'releaseDemoFixture' IS DISTINCT FROM 'false'::JSONB OR cfg ? 'qaAdmission' OR cfg ? 'paidAdmission' THEN RAISE EXCEPTION 'paid config is demo or does not satisfy the fixed schema'; END IF;
 SELECT * INTO seal FROM public."CatalogReleaseSeal" WHERE "catalogReleaseId"=receipt."catalogReleaseId" AND "releaseRootHash"=receipt."releaseRootHash" AND "sealHash"=receipt."sealHash";
 IF NOT FOUND THEN RAISE EXCEPTION 'receipt lacks its exact immutable release seal'; END IF;
 PERFORM public.eng03_03_lock_profile(room."namespace",p_intent->>'profileScope');
 SELECT * INTO profile_pointer FROM public."HuroofContentPointer" WHERE "namespace"=room."namespace" AND "kind"='profile' AND "scope"=p_intent->>'profileScope' AND "family"='profile';
 IF NOT FOUND THEN RAISE EXCEPTION 'selected profile pointer unavailable'; END IF;
 SELECT * INTO profile_revision FROM public."HuroofContentRevision" WHERE "namespace"=profile_pointer."namespace" AND "family"=profile_pointer."family" AND "sourceId"=profile_pointer."sourceId" AND "revision"=profile_pointer."revision" AND "rawArtifactHash"=profile_pointer."rawArtifactHash" AND "validationReceiptId"=receipt."id" AND "catalogReleaseId"=receipt."catalogReleaseId" AND "releaseRootHash"=receipt."releaseRootHash";
 IF NOT FOUND THEN RAISE EXCEPTION 'selected profile is not pinned to the active sealed receipt'; END IF;
 SELECT * INTO raw_profile FROM public."HuroofRawArtifact" WHERE "namespace"=profile_revision."namespace" AND "id"=profile_revision."rawArtifactId" AND "contentHash"=profile_revision."rawArtifactHash";
 IF NOT FOUND THEN RAISE EXCEPTION 'selected profile raw artifact unavailable'; END IF;
 profile:=convert_from(raw_profile."rawBytes",'UTF8')::JSONB;
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR raw_profile."contentHash" IS DISTINCT FROM profile_revision."rawArtifactHash" THEN RAISE EXCEPTION 'selected profile raw bytes/hash mismatch'; END IF;
 IF p_intent ? 'config' AND p_intent->'config' IS DISTINCT FROM cfg OR p_intent ? 'configHash' AND p_intent->>'configHash' IS DISTINCT FROM p_initial->>'configHash' THEN RAISE EXCEPTION 'canonical intent config differs from charged config'; END IF;
 resolved_envelope:=jsonb_build_object('namespace',room."namespace",'roomId',room."id",'ownerFirebaseIdentityId',p_identity,'admissionId',p_intent->>'admissionId','matchId',p_intent->>'matchId','firebaseProjectId',namespace_row."firebaseProjectId",'policyRevision',policy_row."revision",'policyHash',policy_row."policyHash",'profileScope',profile_pointer."scope",'profileFamily',profile_revision."family",'profileSourceId',profile_revision."sourceId",'profileRevision',profile_revision."revision",'profileRawArtifactId',raw_profile."id",'profileRawArtifactHash',raw_profile."contentHash",'validationReceiptId',receipt."id",'catalogReleaseId',receipt."catalogReleaseId",'releaseRootHash',receipt."releaseRootHash",'catalogSealHash',receipt."sealHash",'sourceRef',receipt."sourceEvidenceManifestHash",'rawRefs',jsonb_build_object('profileId',raw_profile."id",'profileHash',raw_profile."contentHash"),'selector',jsonb_build_object('selectorVersion',receipt."selectorVersion",'capabilityStateHash',receipt."huroofCapabilityStateHash"),'selectorVersion',receipt."selectorVersion",'readinessPolicyVersion',receipt."policyVersion",'config',cfg,'configHash',p_initial->>'configHash');
 full_intent:=jsonb_build_object('request',request_envelope,'resolved',resolved_envelope);
 intent_bytes:=convert_to(full_intent::TEXT,'UTF8');
 intent_hash:=encode(int4_crypto.digest(intent_bytes,'sha256'),'hex');
 admission_id:=p_intent->>'admissionId'; match_id:=p_intent->>'matchId'; reservation_id:=admission_id||':reservation';
 IF admission_id !~ '^[A-Za-z0-9._:-]{1,200}$' OR match_id !~ '^[A-Za-z0-9._:-]{1,200}$' THEN RAISE EXCEPTION 'stable source ids required'; END IF;
 event_id:=encode(int4_crypto.digest(convert_to(room."namespace"||':'||room."id"||':'||match_id||':STARTED','UTF8'),'sha256'),'hex');

 PERFORM public.eng03_03_custody_assert(room."namespace",namespace_row."firebaseProjectId",p_identity,room."id",room."generation",p_intent->>'profileScope',NULL,p_intent->>'policyRevision',p_intent->>'policyHash',p_intent->'custody');
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","selectorVersion","state","version","storageAuthority","updatedAt")
 VALUES(admission_id,p_identity,w."id",'HUROOF','HOSTED_HUROOF_PG_V2','CLASSIC',p_logical_match_id,p_request_key,request_hash,intent_hash,2,receipt."selectorVersion",'HELD',0,'PG_HUROOF_V2',clock_timestamp());
 INSERT INTO public."Reservation"("id","admissionId","quantity","state","updatedAt") VALUES(reservation_id,admission_id,1,'HELD',clock_timestamp());
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(admission_id||':reserve',w."id",w."version"+1,'ADMISSION',admission_id,'RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",p_identity);
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 INSERT INTO public."HuroofMatch"("namespace","id","roomId","ownerFirebaseIdentityId","admissionId","profile","profileRawArtifactId","profileHash","config","configHash","rawIntent","rawIntentHash","policyRevision","policyHash","state") VALUES(room."namespace",match_id,room."id",p_identity,admission_id,profile,raw_profile."id",raw_profile."contentHash",cfg,p_initial->>'configHash',intent_bytes,intent_hash,policy_head."revision",policy_head."policyHash",'STARTED');
 UPDATE public."HuroofMatch" SET "state"='ACTIVE',"version"="version"+1 WHERE ("namespace","id")=(room."namespace",match_id);
 INSERT INTO public."HuroofMatchPin"("namespace","matchId","profileScope","validationReceiptId","catalogReleaseId","releaseRootHash","profileFamily","profileSourceId","profileRevision","profileRawArtifactId","profileRawArtifactHash","catalogSealHash","sourceRef","rawRefs","selector","config","profile") VALUES(room."namespace",match_id,p_intent->>'profileScope',receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash",profile_revision."family",profile_revision."sourceId",profile_revision."revision",profile_revision."rawArtifactId",profile_revision."rawArtifactHash",receipt."sealHash",receipt."sourceEvidenceManifestHash",jsonb_build_object('profileId',profile_revision."rawArtifactId",'profileHash',profile_revision."rawArtifactHash"),jsonb_build_object('selectorVersion',receipt."selectorVersion",'capabilityStateHash',receipt."huroofCapabilityStateHash"),cfg,profile);
 reply:=jsonb_build_object('admissionId',admission_id,'matchId',match_id,'roomId',room."id",'status','STARTED','state','COMMITTED','revision',rev,'sequence',seq,'replayed',false);
 INSERT INTO public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId","intent","intentHash","outcome","outcomeHash","resultingRevision","resultingSequence") VALUES(room."namespace",room."id",p_identity,p_request_key,match_id,intent_bytes,intent_hash,convert_to(reply::TEXT,'UTF8'),encode(int4_crypto.digest(convert_to(reply::TEXT,'UTF8'),'sha256'),'hex'),rev,seq);
 INSERT INTO public."HuroofCanonicalState"("namespace","roomId","ownerFirebaseIdentityId","activeMatchId","status","revision","sequence","privateState") VALUES(room."namespace",room."id",p_identity,match_id,'ACTIVE',rev,seq,jsonb_build_object('room',prepared_room,'members',prepared_members,'currentResult',NULL,'lastResult',NULL)) ON CONFLICT("namespace","roomId") DO UPDATE SET "activeMatchId"=EXCLUDED."activeMatchId","status"='ACTIVE',"revision"=EXCLUDED."revision","sequence"=EXCLUDED."sequence","privateState"=EXCLUDED."privateState","updatedAt"=clock_timestamp();
 UPDATE public."HuroofRoom" SET "status"='ACTIVE',"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "namespace"=room."namespace" AND "id"=room."id";
 INSERT INTO public."HuroofEvent"("namespace","roomId","sequence","id","matchId","actorFirebaseIdentityId","requestKey","revision","eventType") VALUES(room."namespace",room."id",seq,event_id,match_id,p_identity,p_request_key,rev,'STARTED');
 INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(room."namespace",room."id",'PUBLIC','public',rev,seq,room."generation",jsonb_build_object('status','ACTIVE','revision',rev)) ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 IF jsonb_array_length(p_projections)<>(SELECT count(*) FROM public."HuroofMember" mm WHERE mm."namespace"=room."namespace" AND mm."roomId"=room."id" AND mm."revokedAt" IS NULL) OR (SELECT count(DISTINCT value->>'uid') FROM jsonb_array_elements(p_projections))<>jsonb_array_length(p_projections) THEN RAISE EXCEPTION 'projection scope mismatch'; END IF;
 FOR projection_item IN SELECT value FROM jsonb_array_elements(p_projections) LOOP
  SELECT fi."id" INTO projection_identity FROM public."FirebaseIdentity" fi JOIN public."HuroofMember" mm ON mm."firebaseIdentityId"=fi."id" AND mm."namespace"=room."namespace" AND mm."roomId"=room."id" AND mm."revokedAt" IS NULL WHERE fi."firebaseProjectId"=namespace_row."firebaseProjectId" AND fi."firebaseUid"=projection_item->>'uid';
  IF NOT FOUND THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  SELECT mm.value->>'role' INTO projection_role FROM jsonb_array_elements(prepared_members) AS mm(value) WHERE mm.value->>'uid'=projection_item->>'uid' AND mm.value->'active'='true'::JSONB;
  IF NOT FOUND OR projection_role NOT IN ('host','player','audience') OR projection_item->'payload'->>'role' IS DISTINCT FROM projection_role OR projection_item->'payload'->>'revision' IS DISTINCT FROM rev::TEXT OR NOT public.eng03_03_projection_safe(projection_item->'payload',projection_identity=p_identity) THEN RAISE EXCEPTION 'projection scope invalid'; END IF;
  INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(room."namespace",room."id",CASE WHEN projection_identity=p_identity THEN 'OWNER' ELSE 'MEMBER' END,projection_identity,rev,seq,room."generation",projection_item->'payload');
 END LOOP;
 INSERT INTO public."HuroofRealtimeOutbox"("namespace","roomId","sequence","eventId") VALUES(room."namespace",room."id",seq,event_id);
 INSERT INTO public."HuroofOutboxDelivery"("namespace","roomId","sequence") VALUES(room."namespace",room."id",seq);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(admission_id||':commit',w."id",w."version"+2,'ADMISSION',admission_id,'COMMIT',reservation_id,0,-1,0,w."available"-1,w."held",w."debt",p_identity);
 UPDATE public."Wallet" SET "held"="held"-1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=clock_timestamp() WHERE "id"=admission_id;
 UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE "id"=reservation_id;
 RETURN reply;
END $$;


-- New objects must not expose default named grants between migration and role qualification.
DO $verify_new_inventory$
DECLARE item RECORD;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(item.signature)::oid AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(item.result_type)::oid AND p.prosecdef=item.definer AND p.proowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)) THEN RAISE EXCEPTION 'new routine identity or creator mismatch: %',item.signature; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'eng03\_03\_%' ESCAPE '\' AND p.oid NOT IN (SELECT pg_catalog.to_regprocedure(inventory.signature)::oid FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer))) THEN RAISE EXCEPTION 'unexpected new routine overload'; END IF;
END $verify_new_inventory$;
REVOKE ALL ON public."HuroofLobbyRevision" FROM PUBLIC;
DO $new_object_acl$
DECLARE fn regprocedure; role_name TEXT;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor'] LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON TABLE public."HuroofLobbyRevision" FROM %I',role_name); END IF;
 END LOOP;
 FOR fn IN SELECT pg_catalog.to_regprocedure(inventory.signature) FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer) LOOP
  FOREACH role_name IN ARRAY ARRAY['PUBLIC','huroof_pg_runtime','huroof_pg_content_editor','huroof_pg_content_reviewer','huroof_pg_content_publisher','huroof_pg_service_executor','enta_finance_executor'] LOOP
   IF role_name='PUBLIC' THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn); ELSIF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',fn,role_name); END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl WHERE n.nspname='public' AND c.relname='HuroofLobbyRevision' AND acl.grantee<>c.relowner) THEN RAISE EXCEPTION 'unexpected lobby default ACL'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl WHERE n.nspname='public' AND p.oid IN (SELECT pg_catalog.to_regprocedure(inventory.signature)::oid FROM (VALUES ('public.eng03_03_assert_current(TEXT,TEXT,TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_policy_read(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_identity_find(TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_locator_find(TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_setup_create(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_content_load(TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_command_load(TEXT,TEXT,TEXT,BIGINT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_room(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_match_update_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_match_transition_closure()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_projection_safe(JSONB,BOOLEAN)','huroof_pg_service_executor','BOOLEAN',false),
 ('public.eng03_03_command_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_custody_policy(TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_custody(TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_custody_assert(TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','VOID',true),
 ('public.eng03_03_lock_history(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lobby_insert_guard()','huroof_pg_owner','trigger',true),
 ('public.eng03_03_create_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_create(TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB)','enta_finance_executor','JSONB',true),
 ('public.eng03_03_lobby_load(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_find_paid(TEXT,TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_paid_identity(TEXT,TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_receipt(TEXT,TEXT,TEXT,TEXT,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lobby_join_prepare(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_manual_identity(TEXT,TEXT,TEXT,TEXT)','huroof_pg_service_executor','TEXT',true),
 ('public.eng03_03_lobby_commit(TEXT,TEXT,TEXT,BIGINT,BIGINT,TEXT,TEXT,JSONB,JSONB)','huroof_pg_service_executor','JSONB',true),
 ('public.eng03_03_lock_profile(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_lock_members(TEXT,TEXT)','huroof_pg_owner','VOID',true),
 ('public.eng03_03_projection_read(TEXT,TEXT,TEXT,BIGINT)','huroof_pg_service_executor','JSONB',true)) AS inventory(signature,expected_owner,result_type,definer)) AND acl.grantee<>p.proowner) THEN RAISE EXCEPTION 'unexpected function default ACL'; END IF;
END $new_object_acl$;
-- End of source candidate.
COMMIT;
