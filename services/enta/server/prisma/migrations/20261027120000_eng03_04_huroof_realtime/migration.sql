-- Source-only candidate. Installation and role provisioning require separate authority.
BEGIN;
CREATE FUNCTION public.eng03_04_realtime_read(p_namespace TEXT,p_identity TEXT,p_project TEXT,p_uid TEXT,p_room TEXT,p_room_generation BIGINT,p_policy_revision TEXT,p_policy_hash TEXT,p_member_generation BIGINT,p_after BIGINT,p_after_revision BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
WITH auth AS (
 SELECT r.*,m."role" AS member_role,m."generation" AS member_generation,m."version" AS member_version,
        h."revision" AS policy_revision,h."policyHash" AS policy_hash
 FROM public."HuroofIdentityPolicyHead" h
 JOIN public."HuroofIdentityPolicyRevision" pol ON (pol."namespace",pol."revision",pol."policyHash")=(h."namespace",h."revision",h."policyHash")
 JOIN public."DeploymentNamespace" n ON n."namespaceId"=h."namespace" AND n."firebaseProjectId"=pol."firebaseProjectId"
 JOIN public."FirebaseIdentity" i ON i."id"=p_identity AND i."firebaseProjectId"=n."firebaseProjectId" AND i."firebaseUid"=p_uid
 JOIN public."HuroofRoom" r ON r."namespace"=h."namespace" AND r."id"=p_room AND r."generation"=p_room_generation
 JOIN public."HuroofMember" m ON (m."namespace",m."roomId",m."firebaseIdentityId")=(r."namespace",r."id",i."id") AND m."revokedAt" IS NULL
 WHERE h."namespace"=p_namespace AND pol."firebaseProjectId"=p_project AND h."revision"::TEXT=p_policy_revision AND h."policyHash"=p_policy_hash
 AND (p_member_generation IS NULL OR m."generation"=p_member_generation)
), lobby AS (
 SELECT a.*,l."revision" AS lobby_revision,l."state" AS lobby_state
 FROM auth a JOIN LATERAL (SELECT * FROM public."HuroofLobbyRevision" x WHERE (x."namespace",x."roomId")=(a."namespace",a."id") ORDER BY x."revision" DESC LIMIT 1) l ON true
 WHERE l."stateHash"=public.int5b_hash_json(l."state") AND jsonb_typeof(l."state"->'members')='array' AND jsonb_typeof(l."state"->'memberBindings')='array'
 AND jsonb_array_length(l."state"->'members')<=217 AND jsonb_array_length(l."state"->'memberBindings')<=217
 AND (SELECT count(*) FROM jsonb_array_elements(l."state"->'members') x WHERE x->>'uid'=p_uid AND x->'active'='true'::jsonb)=1
 AND (SELECT count(*) FROM jsonb_array_elements(l."state"->'memberBindings') x WHERE x->>'identityId'=p_identity AND x->>'uid'=p_uid AND x->>'generation'=a.member_generation::TEXT AND x->>'version'=a.member_version::TEXT)=1
 AND jsonb_array_length(l."state"->'memberBindings')=(SELECT count(*) FROM public."HuroofMember" mm WHERE (mm."namespace",mm."roomId")=(a."namespace",a."id") AND mm."revokedAt" IS NULL)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(l."state"->'memberBindings') b LEFT JOIN public."HuroofMember" mm ON (mm."namespace",mm."roomId",mm."firebaseIdentityId")=(a."namespace",a."id",b->>'identityId') AND mm."revokedAt" IS NULL WHERE mm."firebaseIdentityId" IS NULL OR mm."generation"::TEXT IS DISTINCT FROM b->>'generation' OR mm."version"::TEXT IS DISTINCT FROM b->>'version')
), actor AS (
 SELECT l.*,x.value->>'role' AS actor_role FROM lobby l CROSS JOIN LATERAL jsonb_array_elements(l.lobby_state->'members') x(value)
 WHERE x.value->>'uid'=p_uid AND x.value->'active'='true'::jsonb AND x.value->>'role' IN ('host','player','audience')
 AND ((l.member_role='OWNER' AND l."ownerFirebaseIdentityId"=p_identity AND x.value->>'role'='host') OR (l.member_role='MEMBER' AND l."ownerFirebaseIdentityId"<>p_identity AND x.value->>'role' IN ('player','audience')))
), head AS (
 SELECT a.*,s."revision" AS state_revision,s."sequence" AS state_sequence,s."status" AS state_status,s."activeMatchId",s."privateState",p."payload" AS projection
 FROM actor a LEFT JOIN public."HuroofCanonicalState" s ON (s."namespace",s."roomId")=(a."namespace",a."id")
 LEFT JOIN public."HuroofProjection" p ON (p."namespace",p."roomId",p."audience",p."scope")=(a."namespace",a."id",CASE WHEN a.member_role='OWNER' THEN 'OWNER' ELSE 'MEMBER' END,p_identity)
 AND p."authGeneration"=a."generation" AND p."revision"=s."revision" AND p."throughSequence"=s."sequence"
 WHERE (a."status"='SETUP' AND s."roomId" IS NULL) OR (a."status"='ACTIVE' AND s."roomId" IS NOT NULL AND p."payload" IS NOT NULL AND p."payload"->>'roomId'=a."id" AND p."payload"->>'role'=a.actor_role AND p."payload"->>'revision'=s."revision"::TEXT AND s."ownerFirebaseIdentityId"=a."ownerFirebaseIdentityId" AND s."status" IN ('ACTIVE','FINISHED') AND s."activeMatchId" IS NOT NULL AND jsonb_typeof(s."privateState"->'members')='array' AND (SELECT count(*) FROM jsonb_array_elements(s."privateState"->'members') pm WHERE pm->>'uid'=p_uid AND pm->'active'='true'::jsonb)=1 AND (SELECT count(*) FROM jsonb_array_elements(s."privateState"->'members') pm WHERE pm->>'uid'=p_uid AND pm->'active'='true'::jsonb AND pm->>'role'=a.actor_role)=1 AND EXISTS(SELECT 1 FROM public."HuroofMatch" mt WHERE (mt."namespace",mt."id",mt."roomId",mt."ownerFirebaseIdentityId")=(a."namespace",s."activeMatchId",a."id",a."ownerFirebaseIdentityId") AND mt."state"=s."status"))
), events AS (
 SELECT e."sequence",e."revision" FROM head h JOIN public."HuroofEvent" e ON (e."namespace",e."roomId")=(h."namespace",h."id")
 JOIN public."HuroofRealtimeOutbox" o ON (o."namespace",o."roomId",o."sequence",o."eventId")=(e."namespace",e."roomId",e."sequence",e."id")
 WHERE p_after IS NOT NULL AND e."sequence">p_after AND e."sequence"<=h.state_sequence ORDER BY e."sequence" LIMIT 65
), ev AS (
 SELECT count(*) AS count, min("sequence") AS first_sequence,max("sequence") AS last_sequence,min("revision") AS first_revision,max("revision") AS last_revision, bool_and("revision"=p_after_revision+("sequence"-p_after)) AS revisions_ordered,
 coalesce(jsonb_agg(jsonb_build_object('sequence',"sequence"::TEXT,'revision',"revision"::TEXT,'kind','CHANGED') ORDER BY "sequence"),'[]'::jsonb) AS data FROM events
), result AS (
 SELECT h.*,ev.*,CASE WHEN h."status"='SETUP' THEN h.lobby_revision ELSE h.state_revision END AS rev,
 CASE WHEN h."status"='SETUP' THEN 0 ELSE h.state_sequence END AS seq,
 CASE WHEN h."status"='SETUP' THEN h.lobby_state ELSE h.projection END AS internal_snapshot
 FROM head h CROSS JOIN ev
)
SELECT jsonb_build_object('schemaVersion','huroof-realtime-internal-v1','namespace',p_namespace,'projectId',p_project,'roomId',id,'roomGeneration',"generation"::TEXT,'memberGeneration',member_generation::TEXT,'policyRevision',policy_revision::TEXT,'policyHash',policy_hash,'principal',p_uid,'role',actor_role,'stage',CASE WHEN "status"='SETUP' THEN 'SETUP' ELSE 'PAID' END,'revision',rev::TEXT,'throughSequence',seq::TEXT,'readAt',statement_timestamp(),'internalSnapshot',internal_snapshot,
 'terminal',CASE WHEN state_status='FINISHED' AND EXISTS(SELECT 1 FROM public."HuroofMatch" mt JOIN public."HuroofMatchResult" mr ON (mr."namespace",mr."matchId",mr."roomId",mr."ownerFirebaseIdentityId")=(mt."namespace",mt."id",mt."roomId",mt."ownerFirebaseIdentityId") JOIN public."HuroofEvent" te ON (te."namespace",te."roomId",te."sequence",te."id",te."matchId")=(mr."namespace",mr."roomId",mr."terminalSequence",mr."terminalEventId",mr."matchId") AND te."eventType"='FINISHED' WHERE (mt."namespace",mt."id",mt."roomId",mt."ownerFirebaseIdentityId")=(result."namespace",result."activeMatchId",result."id",result."ownerFirebaseIdentityId") AND mt."state"='FINISHED' AND mr."resultVersion"::TEXT=result."privateState"->'currentResult'->>'version' AND mr."resultHash"=result."privateState"->'currentResult'->>'hash' AND mr."terminalSequence"<=seq AND result.projection->'projection'->'room'->>'state'='MATCH_COMPLETE') THEN jsonb_build_object('version',"privateState"->'currentResult'->>'version','hash',"privateState"->'currentResult'->>'hash') ELSE NULL END,
 'replay',jsonb_build_object('mode',CASE WHEN p_after IS NULL THEN 'SNAPSHOT' WHEN "status"='SETUP' AND p_after=0 AND p_after_revision=rev THEN 'REPLAY' WHEN "status"='SETUP' OR p_after=0 OR p_after>seq OR p_after_revision IS NULL OR count>64 OR (p_after=seq AND p_after_revision<>rev) OR (p_after<seq AND (first_sequence IS DISTINCT FROM p_after+1 OR last_sequence IS DISTINCT FROM seq OR count IS DISTINCT FROM seq-p_after OR first_revision IS DISTINCT FROM p_after_revision+1 OR last_revision IS DISTINCT FROM rev OR count IS DISTINCT FROM last_revision-first_revision+1 OR revisions_ordered IS DISTINCT FROM true)) THEN 'RESET' ELSE 'REPLAY' END,'events',CASE WHEN p_after IS NOT NULL AND "status"<>'SETUP' AND p_after>0 AND p_after<=seq AND count<=64 AND ((p_after=seq AND p_after_revision=rev) OR (p_after<seq AND first_sequence=p_after+1 AND last_sequence=seq AND count=seq-p_after AND first_revision=p_after_revision+1 AND last_revision=rev AND count=last_revision-first_revision+1 AND revisions_ordered IS TRUE)) THEN data ELSE '[]'::jsonb END))
FROM result WHERE octet_length(internal_snapshot::TEXT)<=262144 AND (p_after IS NULL)=(p_after_revision IS NULL)
 AND length(p_namespace) BETWEEN 1 AND 128 AND length(p_project) BETWEEN 1 AND 128 AND length(p_uid) BETWEEN 1 AND 128 AND length(p_room) BETWEEN 1 AND 128 AND length(p_identity) BETWEEN 1 AND 128
 AND (state_status IS DISTINCT FROM 'ACTIVE' OR projection->'projection'->'room'->>'state' IS DISTINCT FROM 'MATCH_COMPLETE')
 AND (state_status IS DISTINCT FROM 'FINISHED' OR EXISTS(SELECT 1 FROM public."HuroofMatch" mt JOIN public."HuroofMatchResult" mr ON (mr."namespace",mr."matchId",mr."roomId",mr."ownerFirebaseIdentityId")=(mt."namespace",mt."id",mt."roomId",mt."ownerFirebaseIdentityId") JOIN public."HuroofEvent" te ON (te."namespace",te."roomId",te."sequence",te."id",te."matchId")=(mr."namespace",mr."roomId",mr."terminalSequence",mr."terminalEventId",mr."matchId") AND te."eventType"='FINISHED' WHERE (mt."namespace",mt."id",mt."roomId",mt."ownerFirebaseIdentityId")=(result."namespace",result."activeMatchId",result."id",result."ownerFirebaseIdentityId") AND mt."state"='FINISHED' AND mr."resultVersion"::TEXT=result."privateState"->'currentResult'->>'version' AND mr."resultHash"=result."privateState"->'currentResult'->>'hash' AND mr."terminalSequence"<=seq AND result.projection->'projection'->'room'->>'state'='MATCH_COMPLETE'))
$$;
REVOKE ALL ON FUNCTION public.eng03_04_realtime_read(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,BIGINT,BIGINT,BIGINT) FROM PUBLIC;
COMMIT;
