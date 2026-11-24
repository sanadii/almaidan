-- Forward fix: the int8 definition of int7_enta_command listed 11 GameEvent
-- columns but supplied 10 values (intentHash was omitted), so every accepted
-- classic/kids command failed at INSERT. Body copied verbatim from
-- 20261007170000_int8_formats_rounds except the corrected VALUES list.
-- CREATE OR REPLACE keeps the existing owner, search_path/timezone settings
-- declared below, and EXECUTE grants.
CREATE OR REPLACE FUNCTION public.int7_enta_command(ns TEXT,project TEXT,uid TEXT,game_id TEXT,c JSONB,intent_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; q public."GameQuestion"%ROWTYPE; old_event public."GameEvent"%ROWTYPE;
 kind TEXT:=c->>'type'; qid TEXT:=c->>'questionId'; tid TEXT:=c->>'teamId'; award INTEGER; remaining INTEGER; finish_reason TEXT; top_score INTEGER; winner_ids TEXT[]; moment TIMESTAMPTZ;
BEGIN
 PERFORM public.int6_enta_identity(ns,project,uid);
 IF EXISTS(SELECT 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=(public.int6_enta_identity(ns,project,uid)->>'id') AND "executionFormat"<>'TIER_BOARD') THEN PERFORM public.int6_enta_error('MATCH_FORMAT_REQUIRES_V4'); END IF;
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
 INSERT INTO public."GameEvent"("gameId","commandId","sequence","actorFirebaseIdentityId","type","intentHash","questionId","teamId","ruling","resultReason","unplayedCount") VALUES(g."id",c->>'commandId',r."version"+1,identity_id,kind,intent_hash,qid,tid,CASE WHEN kind='ADJUDICATE' THEN c->>'ruling' ELSE NULL END,finish_reason,remaining);
 RETURN jsonb_build_object('commandId',c->>'commandId','type',kind,'sequence',r."version"+1,'intentHash',intent_hash);
END $$;
