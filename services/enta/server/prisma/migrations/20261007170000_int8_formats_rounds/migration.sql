-- INT-061.E1 SOURCE ONLY; no application/receipt activation.
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
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public."Game" WHERE "gameFormat"='FIREBASE_PINNED') THEN RAISE EXCEPTION 'first-launch only; existing pinned histories require reviewed compatibility, preserve and stop'; END IF; END $$;
ALTER TABLE public."Game" ADD COLUMN "executionFormat" TEXT NOT NULL DEFAULT 'TIER_BOARD';
ALTER TABLE public."GameRuntime" ADD COLUMN "activeRoundId" TEXT;
CREATE UNIQUE INDEX "Answer_format_same_question_key" ON public."QuestionAnswerRevision"("id","questionRevisionId","questionContentHash","contentHash");
CREATE UNIQUE INDEX "Question_format_source_identity_key" ON public."QuestionRevision"("id","sourceNamespace","sourceQuestionId","canonicalCategoryKey","contentHash");
CREATE TABLE public."EntaFormatRelease" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "baseReleaseId" TEXT NOT NULL,
 "baseRoot" TEXT NOT NULL,
 "receiptId" TEXT NOT NULL UNIQUE,
 "formatRoot" TEXT NOT NULL UNIQUE,
 "mediaRoot" TEXT NOT NULL,
 "policyVersion" TEXT NOT NULL,
 "issuerEvidenceHash" TEXT NOT NULL,
 "sealedAt" TIMESTAMPTZ(3),
 UNIQUE("id","formatRoot","mediaRoot")
);
CREATE TABLE public."EntaFormatRevision" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "releaseId" TEXT NOT NULL,
 "questionRevisionId" TEXT NOT NULL,
 "questionHash" TEXT NOT NULL,
 "sourceNamespace" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL,
 "categoryKey" TEXT NOT NULL,
 "opaqueRef" TEXT NOT NULL,
 "format" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL,
 "rules" JSONB NOT NULL,
 UNIQUE("releaseId","opaqueRef"),
 UNIQUE("releaseId","categoryKey","sourceNamespace","sourceId"),
 UNIQUE("id","questionRevisionId","questionHash","contentHash"),
 UNIQUE("id","questionRevisionId","sourceNamespace","sourceId","categoryKey","questionHash","contentHash"),
 UNIQUE("id","questionRevisionId","questionHash")
);
CREATE TABLE public."EntaFormatItem" (
 "formatId" TEXT NOT NULL,
 "id" TEXT NOT NULL,
 "questionRevisionId" TEXT NOT NULL,
 "questionHash" TEXT NOT NULL,
 "answerRevisionId" TEXT NOT NULL,
 "answerHash" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "value" INTEGER NOT NULL,
 "trap" BOOLEAN NOT NULL,
 PRIMARY KEY("formatId","id"),
 UNIQUE("formatId","ordinal"),
 UNIQUE("formatId","id","answerRevisionId","answerHash")
);
CREATE TABLE public."MediaObjectProof" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "mediaRevisionId" TEXT NOT NULL,
 "mediaHash" TEXT NOT NULL,
 "objectVersion" TEXT NOT NULL,
 "byteLength" INTEGER NOT NULL,
 "width" INTEGER NOT NULL,
 "height" INTEGER NOT NULL,
 "durationMs" INTEGER,
 "codec" TEXT,
 "manifestHash" TEXT NOT NULL,
 "issuerEvidenceHash" TEXT NOT NULL,
 "sealedAt" TIMESTAMPTZ(3),
 UNIQUE("id","mediaHash","manifestHash")
);
CREATE TABLE public."MediaChunkProof" (
 "proofId" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "byteLength" INTEGER NOT NULL,
 "sha256" TEXT NOT NULL,
 PRIMARY KEY("proofId","ordinal")
);
CREATE TABLE public."EntaFormatMedia" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "formatId" TEXT NOT NULL,
 "questionRevisionId" TEXT NOT NULL,
 "questionHash" TEXT NOT NULL,
 "itemId" TEXT,
 "proofId" TEXT NOT NULL,
 "role" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 UNIQUE("formatId","role","ordinal")
);
CREATE TABLE public."EntaFormatCover" (
 "releaseId" TEXT NOT NULL,
 "categoryKey" TEXT NOT NULL,
 "proofId" TEXT NOT NULL,
 PRIMARY KEY("releaseId","categoryKey")
);
CREATE TABLE public."EntaExecutionPin" (
 "gameId" TEXT NOT NULL PRIMARY KEY,
 "firebaseIdentityId" TEXT NOT NULL,
 "executionFormat" TEXT NOT NULL,
 "formatReleaseId" TEXT NOT NULL,
 "formatRoot" TEXT NOT NULL,
 "mediaRoot" TEXT NOT NULL,
 "clientBinding" JSONB NOT NULL,
 "clientHash" TEXT NOT NULL,
 "fullIntent" JSONB NOT NULL,
 "intentHash" TEXT NOT NULL,
 "state" JSONB NOT NULL,
 UNIQUE("gameId","firebaseIdentityId","executionFormat"),
 UNIQUE("gameId","firebaseIdentityId")
);
CREATE TABLE public."EntaSourceExposure" (
 "gameId" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "firebaseIdentityId" TEXT NOT NULL,
 "executionFormat" TEXT NOT NULL,
 "categoryKey" TEXT NOT NULL,
 "sourceNamespace" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL,
 "cycle" INTEGER NOT NULL,
 "revisionId" TEXT NOT NULL,
 PRIMARY KEY("gameId","ordinal"),
 UNIQUE("firebaseIdentityId","executionFormat","categoryKey","sourceNamespace","sourceId","cycle")
);
CREATE TABLE public."GameRound" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "gameQuestionId" TEXT NOT NULL UNIQUE,
 "formatId" TEXT NOT NULL,
 "questionRevisionId" TEXT NOT NULL,
 "questionHash" TEXT NOT NULL,
 "categoryKey" TEXT NOT NULL,
 "sourceNamespace" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL,
 "formatHash" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 "pin" JSONB NOT NULL,
 "state" JSONB NOT NULL,
 UNIQUE("gameId","id"),
 UNIQUE("gameId","ordinal"),
 UNIQUE("gameId","ordinal","questionRevisionId","sourceNamespace","sourceId","categoryKey"),
 UNIQUE("id","formatId"),
 UNIQUE("gameId","gameQuestionId")
);
CREATE TABLE public."RoundItemPin" (
 "roundId" TEXT NOT NULL,
 "formatId" TEXT NOT NULL,
 "itemId" TEXT NOT NULL,
 "answerRevisionId" TEXT NOT NULL,
 "answerHash" TEXT NOT NULL,
 "ordinal" INTEGER NOT NULL,
 PRIMARY KEY("roundId","itemId"),
 UNIQUE("roundId","ordinal")
);
CREATE TABLE public."RoundAuthorityEvent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "ownerIdentityId" TEXT NOT NULL,
 "roundId" TEXT,
 "commandId" TEXT NOT NULL,
 "sequence" INTEGER NOT NULL,
 "type" TEXT NOT NULL,
 "intentHash" TEXT NOT NULL,
 "authorityKind" TEXT NOT NULL,
 "authorityGrantId" TEXT,
 "authorityGeneration" INTEGER,
 "assignmentId" TEXT,
 "systemOperation" TEXT,
 "pauseReason" TEXT,
 "at" TIMESTAMPTZ(3) NOT NULL,
 UNIQUE("gameId","commandId"),
 UNIQUE("gameId","sequence"),
 UNIQUE("id","gameId","roundId")
);
CREATE TABLE public."RoundScorePosting" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "roundId" TEXT NOT NULL,
 "itemId" TEXT,
 "eventId" TEXT NOT NULL,
 "teamId" TEXT NOT NULL,
 "delta" INTEGER NOT NULL,
 "before" INTEGER NOT NULL,
 "after" INTEGER NOT NULL,
 "rulesVersion" TEXT NOT NULL,
 UNIQUE("roundId","itemId")
);
CREATE TABLE public."RoundGrantScope" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "roundId" TEXT NOT NULL,
 "role" TEXT NOT NULL,
 "assignmentId" TEXT,
 "generation" INTEGER NOT NULL,
 "activeGrantId" TEXT UNIQUE,
 UNIQUE("gameId","roundId","role","assignmentId"),
 UNIQUE("id","activeGrantId"),
 UNIQUE("id","gameId","roundId")
);
CREATE TABLE public."RoundGrant" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "scopeId" TEXT NOT NULL,
 "roundId" TEXT NOT NULL,
 "role" TEXT NOT NULL,
 "assignmentId" TEXT,
 "generation" INTEGER NOT NULL,
 "tokenHash" TEXT NOT NULL UNIQUE,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "revoked" BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE("gameId","id"),
 UNIQUE("scopeId","id"),
 UNIQUE("scopeId","generation"),
 UNIQUE("id","gameId","roundId","generation","assignmentId")
);
CREATE TABLE public."DrawingCanvasState" (
 "roundId" TEXT NOT NULL PRIMARY KEY,
 "revision" INTEGER NOT NULL,
 "state" JSONB NOT NULL
);
CREATE TABLE public."RoundActorAssignment" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "gameId" TEXT NOT NULL,
 "roundId" TEXT NOT NULL,
 "teamId" TEXT NOT NULL,
 "playerIndex" INTEGER NOT NULL CHECK("playerIndex" BETWEEN 0 AND 7),
 "itemId" TEXT,
 "generation" INTEGER NOT NULL CHECK("generation">0),
 UNIQUE("id","gameId","roundId"),
 UNIQUE("roundId","generation")
);
ALTER TABLE public."EntaFormatRelease" ADD FOREIGN KEY("baseReleaseId","baseRoot") REFERENCES public."CatalogRelease"("id","releaseRootHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatRelease" ADD FOREIGN KEY("receiptId","baseReleaseId","baseRoot") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatRevision" ADD FOREIGN KEY("releaseId") REFERENCES public."EntaFormatRelease"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatRevision" ADD FOREIGN KEY("questionRevisionId","sourceNamespace","sourceId","categoryKey","questionHash") REFERENCES public."QuestionRevision"("id","sourceNamespace","sourceQuestionId","canonicalCategoryKey","contentHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatItem" ADD FOREIGN KEY("formatId","questionRevisionId","questionHash") REFERENCES public."EntaFormatRevision"("id","questionRevisionId","questionHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatItem" ADD FOREIGN KEY("answerRevisionId","questionRevisionId","questionHash","answerHash") REFERENCES public."QuestionAnswerRevision"("id","questionRevisionId","questionContentHash","contentHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."MediaObjectProof" ADD FOREIGN KEY("mediaRevisionId","mediaHash") REFERENCES public."MediaRevision"("id","mediaSha256") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."MediaChunkProof" ADD FOREIGN KEY("proofId") REFERENCES public."MediaObjectProof"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatMedia" ADD FOREIGN KEY("formatId","questionRevisionId","questionHash") REFERENCES public."EntaFormatRevision"("id","questionRevisionId","questionHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatMedia" ADD FOREIGN KEY("formatId","itemId") REFERENCES public."EntaFormatItem"("formatId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatMedia" ADD FOREIGN KEY("proofId") REFERENCES public."MediaObjectProof"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatCover" ADD FOREIGN KEY("releaseId") REFERENCES public."EntaFormatRelease"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaFormatCover" ADD FOREIGN KEY("proofId") REFERENCES public."MediaObjectProof"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaExecutionPin" ADD FOREIGN KEY("gameId","firebaseIdentityId") REFERENCES public."Game"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaExecutionPin" ADD FOREIGN KEY("formatReleaseId","formatRoot","mediaRoot") REFERENCES public."EntaFormatRelease"("id","formatRoot","mediaRoot") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaSourceExposure" ADD FOREIGN KEY("gameId","firebaseIdentityId","executionFormat") REFERENCES public."EntaExecutionPin"("gameId","firebaseIdentityId","executionFormat") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."EntaSourceExposure" ADD FOREIGN KEY("gameId","ordinal","revisionId","sourceNamespace","sourceId","categoryKey") REFERENCES public."GameRound"("gameId","ordinal","questionRevisionId","sourceNamespace","sourceId","categoryKey") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."GameRound" ADD FOREIGN KEY("gameId","categoryKey") REFERENCES public."GameCategoryPin"("gameId","categoryKey") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."GameRound" ADD FOREIGN KEY("gameId") REFERENCES public."Game"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."GameRound" ADD FOREIGN KEY("gameId","gameQuestionId") REFERENCES public."GameQuestion"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."GameRound" ADD FOREIGN KEY("formatId","questionRevisionId","sourceNamespace","sourceId","categoryKey","questionHash","formatHash") REFERENCES public."EntaFormatRevision"("id","questionRevisionId","sourceNamespace","sourceId","categoryKey","questionHash","contentHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundItemPin" ADD FOREIGN KEY("roundId","formatId") REFERENCES public."GameRound"("id","formatId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundItemPin" ADD FOREIGN KEY("formatId","itemId","answerRevisionId","answerHash") REFERENCES public."EntaFormatItem"("formatId","id","answerRevisionId","answerHash") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundAuthorityEvent" ADD FOREIGN KEY("gameId","ownerIdentityId") REFERENCES public."Game"("id","firebaseIdentityId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundAuthorityEvent" ADD FOREIGN KEY("gameId","roundId") REFERENCES public."GameRound"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundAuthorityEvent" ADD FOREIGN KEY("authorityGrantId","gameId","roundId","authorityGeneration","assignmentId") REFERENCES public."RoundGrant"("id","gameId","roundId","generation","assignmentId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundScorePosting" ADD FOREIGN KEY("eventId","gameId","roundId") REFERENCES public."RoundAuthorityEvent"("id","gameId","roundId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundScorePosting" ADD FOREIGN KEY("roundId","itemId") REFERENCES public."RoundItemPin"("roundId","itemId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundScorePosting" ADD FOREIGN KEY("gameId","teamId") REFERENCES public."Team"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundGrantScope" ADD FOREIGN KEY("gameId","roundId") REFERENCES public."GameRound"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundGrantScope" ADD FOREIGN KEY("assignmentId","gameId","roundId") REFERENCES public."RoundActorAssignment"("id","gameId","roundId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundGrantScope" ADD FOREIGN KEY("id","activeGrantId") REFERENCES public."RoundGrant"("scopeId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundGrant" ADD FOREIGN KEY("scopeId","gameId","roundId") REFERENCES public."RoundGrantScope"("id","gameId","roundId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."DrawingCanvasState" ADD FOREIGN KEY("roundId") REFERENCES public."GameRound"("id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundActorAssignment" ADD FOREIGN KEY("gameId","roundId") REFERENCES public."GameRound"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundActorAssignment" ADD FOREIGN KEY("gameId","teamId") REFERENCES public."Team"("gameId","id") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."RoundActorAssignment" ADD FOREIGN KEY("roundId","itemId") REFERENCES public."RoundItemPin"("roundId","itemId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."GameRuntime" ADD FOREIGN KEY("gameId","activeRoundId") REFERENCES public."GameRound"("gameId","id") ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public."MediaChunkProof" ADD CHECK("ordinal">=0 AND "byteLength" BETWEEN 1 AND 262144 AND "sha256"~'^[a-f0-9]{64}$');
ALTER TABLE public."MediaObjectProof" ADD CHECK("objectVersion"~'^[0-9]{1,24}$' AND "mediaHash"~'^[a-f0-9]{64}$' AND "manifestHash"~'^[a-f0-9]{64}$' AND "issuerEvidenceHash"~'^[a-f0-9]{64}$' AND "byteLength" BETWEEN 1 AND 67108864 AND "width">0 AND "height">0 AND "width"::BIGINT*"height"<=16000000);
ALTER TABLE public."EntaFormatRevision" ADD CHECK("format" IN ('ORDINARY_TIER','DRAWING_TARGET','LIST_ITEMS','ACTING_ITEMS'));
ALTER TABLE public."EntaFormatItem" ADD CHECK("ordinal" BETWEEN 0 AND 127 AND "value" BETWEEN 1 AND 10000);
ALTER TABLE public."EntaSourceExposure" ADD CHECK("cycle">0 AND "ordinal" BETWEEN 0 AND 35);
ALTER TABLE public."RoundAuthorityEvent" ADD CHECK(("authorityKind"='HOST' AND "authorityGrantId" IS NULL AND "systemOperation" IS NULL AND "assignmentId" IS NULL AND "authorityGeneration" IS NULL) OR ("authorityKind"='GRANT' AND "authorityGrantId" IS NOT NULL AND "authorityGeneration" IS NOT NULL AND "authorityGeneration">0 AND "assignmentId" IS NOT NULL AND "systemOperation" IS NULL) OR ("authorityKind"='SYSTEM' AND "systemOperation"='CLOCK_SETTLEMENT' AND "authorityGrantId" IS NULL AND "assignmentId" IS NULL AND "authorityGeneration" IS NULL));
ALTER TABLE public."RoundScorePosting" ADD CHECK("after"::BIGINT-"before"::BIGINT="delta" AND "rulesVersion"='enta-format-1');
ALTER TABLE public."RoundGrant" ADD CHECK("tokenHash"~'^[a-f0-9]{64}$' AND "generation">=0 AND "role" IN ('JUDGE','ACTOR'));
REVOKE ALL ON public."EntaFormatRelease" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaFormatRevision" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaFormatItem" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."MediaObjectProof" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."MediaChunkProof" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaFormatMedia" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaFormatCover" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaExecutionPin" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."EntaSourceExposure" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."GameRound" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."RoundItemPin" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."RoundAuthorityEvent" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."RoundScorePosting" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."RoundGrantScope" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."RoundGrant" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
REVOKE ALL ON public."DrawingCanvasState" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

CREATE UNIQUE INDEX "RoundGrantScope_null_assignment_scope" ON public."RoundGrantScope"("gameId","roundId","role") WHERE "assignmentId" IS NULL;
REVOKE ALL ON public."RoundActorAssignment" FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
GRANT SELECT,INSERT ON public."RoundActorAssignment" TO enta_finance_executor;
CREATE TRIGGER "RoundActorAssignment_immutable" BEFORE UPDATE OR DELETE ON public."RoundActorAssignment" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
-- Execution format is immutable before any Admission/Game check widening.
CREATE FUNCTION public.int8_execution_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW."executionFormat" IS DISTINCT FROM OLD."executionFormat" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW; END $$;
CREATE TRIGGER "Game_execution_immutable" BEFORE UPDATE ON public."Game" FOR EACH ROW EXECUTE FUNCTION public.int8_execution_guard();
ALTER TABLE public."Game" ADD CHECK("executionFormat" IN ('TIER_BOARD','MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING'));
ALTER TABLE public."Admission" DROP CONSTRAINT "Admission_mode_check", ADD CONSTRAINT "Admission_mode_check" CHECK("mode" IN ('CLASSIC','KIDS','LIST','ACTING'));
ALTER TABLE public."Admission" DROP CONSTRAINT "Admission_engine_branch_check", ADD CONSTRAINT "Admission_engine_branch_check" CHECK (
 ("engine"='ENTA' AND (("mode"='CLASSIC' AND "operation"='PAID_ENTA_CLASSIC') OR ("mode"='KIDS' AND "operation"='PAID_ENTA_KIDS' AND "requestVersion"=3) OR ("mode"='LIST' AND "operation"='PAID_ENTA_LIST' AND "requestVersion"=4) OR ("mode"='ACTING' AND "operation"='PAID_ENTA_ACTING' AND "requestVersion"=4)) AND "catalogReleaseId" IS NOT NULL AND "releaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL
 AND "huroofBinding" IS NULL AND "huroofConfig" IS NULL AND "predecessorAdmissionId" IS NULL AND "huroofCatalogReleaseId" IS NULL AND "huroofCatalogRootHash" IS NULL AND "huroofValidationReceiptId" IS NULL)
 OR ("engine"='HUROOF' AND "mode"='CLASSIC' AND "operation"='HOSTED_HUROOF' AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL AND "validationReceiptId" IS NULL AND "huroofBinding" IS NOT NULL AND "huroofConfig" IS NOT NULL AND "roomProjectId" IS NOT NULL AND "roomId" IS NOT NULL AND "huroofCatalogReleaseId" IS NOT NULL AND "huroofCatalogRootHash" IS NOT NULL AND "huroofValidationReceiptId" IS NOT NULL)
);
ALTER TABLE public."Game" DROP CONSTRAINT "Game_financial_format_check", ADD CONSTRAINT "Game_financial_format_check" CHECK (
 ("gameFormat"='LEGACY' AND "executionFormat"='TIER_BOARD' AND "firebaseIdentityId" IS NULL AND "admissionId" IS NULL AND "validationReceiptId" IS NULL AND "catalogReleaseId" IS NULL AND "catalogReleaseRootHash" IS NULL)
 OR ("gameFormat"='FIREBASE_PINNED' AND "userId" IS NULL AND "firebaseIdentityId" IS NOT NULL AND "admissionId" IS NOT NULL AND "catalogReleaseId" IS NOT NULL AND "catalogReleaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL AND (("executionFormat"='TIER_BOARD' AND "mode" IN ('CLASSIC','KIDS')) OR ("executionFormat"='MIXED_BOARD' AND "mode"='CLASSIC') OR ("executionFormat"='STANDALONE_LIST' AND "mode"='LIST') OR ("executionFormat"='STANDALONE_ACTING' AND "mode"='ACTING')))
);
-- No new authoring issuer, approval Boolean/GUC or executable activation seam.
CREATE FUNCTION public.int8_assert_format(release_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN PERFORM public.int6_enta_error('FORMAT_RECEIPT_POLICY_UNAVAILABLE'); END $$;
CREATE FUNCTION public.int8_namespace(ns TEXT,project TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" WHERE "id"='singleton' AND "namespaceId"=ns AND "firebaseProjectId"=project) THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF; END $$;
CREATE FUNCTION public.int8_media_pin(proof_id TEXT,role TEXT,item_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."MediaObjectProof"%ROWTYPE; m public."MediaRevision"%ROWTYPE; chunks JSONB; BEGIN
 SELECT * INTO p FROM public."MediaObjectProof" WHERE "id"=proof_id AND "sealedAt" IS NOT NULL; IF NOT FOUND THEN PERFORM public.int6_enta_error('MEDIA_PROOF_UNAVAILABLE'); END IF;
 SELECT * INTO m FROM public."MediaRevision" WHERE "id"=p."mediaRevisionId" AND "mediaSha256"=p."mediaHash";
 SELECT jsonb_agg(jsonb_build_object('ordinal',"ordinal",'byteLength',"byteLength",'sha256',"sha256") ORDER BY "ordinal") INTO chunks FROM public."MediaChunkProof" WHERE "proofId"=p."id";
 IF m."byteLength"<>p."byteLength" OR m."objectKey"!~'^enta-private/[A-Za-z0-9_/-]{1,180}$' OR position('..' IN m."objectKey")>0 OR (SELECT count(*) FROM public."MediaChunkProof" WHERE "proofId"=p."id")<>ceil(p."byteLength"/262144.0) OR EXISTS(SELECT 1 FROM generate_series(0,ceil(p."byteLength"/262144.0)::INTEGER-1) n WHERE NOT EXISTS(SELECT 1 FROM public."MediaChunkProof" c WHERE c."proofId"=p."id" AND c."ordinal"=n AND c."byteLength"=least(262144,p."byteLength"-n*262144))) THEN PERFORM public.int6_enta_error('MEDIA_PROOF_UNAVAILABLE'); END IF;
 IF COALESCE(CASE WHEN m."mimeType" IN ('video/mp4','video/webm') THEN p."byteLength"<=67108864 AND p."durationMs" BETWEEN 1 AND 120000 AND p."codec" IN ('h264','vp8','vp9') ELSE m."mimeType" IN ('image/png','image/jpeg','image/webp') AND p."byteLength"<=10485760 AND p."durationMs" IS NULL AND p."codec" IS NULL END,FALSE) IS NOT TRUE THEN PERFORM public.int6_enta_error('MEDIA_POLICY_UNAVAILABLE'); END IF;
 RETURN jsonb_build_object('id',p."id",'objectKey',m."objectKey",'objectVersion',p."objectVersion",'sha256',p."mediaHash",'mime',m."mimeType",'bytes',p."byteLength",'width',p."width",'height',p."height",'durationMs',p."durationMs",'codec',p."codec",'chunks',chunks,'role',role,'itemId',item_id);
END $$;
CREATE FUNCTION public.int8_prompt_pin(format_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE f public."EntaFormatRevision"%ROWTYPE; q public."QuestionRevision"%ROWTYPE; items JSONB; media JSONB; BEGIN
 SELECT * INTO f FROM public."EntaFormatRevision" WHERE "id"=format_id; SELECT * INTO q FROM public."QuestionRevision" WHERE "id"=f."questionRevisionId" AND "contentHash"=f."questionHash";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i."id",'revisionId',i."answerRevisionId",'hash',i."answerHash",'ordinal',i."ordinal",'text',a."text",'value',i."value",'trap',i."trap",'mediaIds',(SELECT COALESCE(jsonb_agg(m."proofId" ORDER BY m."ordinal"),'[]'::JSONB) FROM public."EntaFormatMedia" m WHERE m."formatId"=i."formatId" AND m."itemId"=i."id")) ORDER BY i."ordinal"),'[]'::JSONB) INTO items FROM public."EntaFormatItem" i JOIN public."QuestionAnswerRevision" a ON a."id"=i."answerRevisionId" AND a."contentHash"=i."answerHash" AND a."questionRevisionId"=f."questionRevisionId" WHERE i."formatId"=f."id";
 SELECT COALESCE(jsonb_agg(public.int8_media_pin(m."proofId",m."role",m."itemId") ORDER BY m."role" COLLATE "C",m."ordinal"),'[]'::JSONB) INTO media FROM public."EntaFormatMedia" m WHERE m."formatId"=f."id";
 RETURN jsonb_build_object('ref',f."opaqueRef",'sourceNamespace',f."sourceNamespace",'sourceId',f."sourceId",'revisionId',f."questionRevisionId",'hash',f."questionHash",'formatId',f."id",'formatHash',f."contentHash",'categoryKey',f."categoryKey",'format',f."format",'prompt',q."prompt",'target',CASE WHEN f."format" IN ('ORDINARY_TIER','DRAWING_TARGET') THEN f."rules"->'target' ELSE 'null'::JSONB END,'points',CASE WHEN f."format" IN ('ORDINARY_TIER','DRAWING_TARGET') THEN to_jsonb(q."points") ELSE 'null'::JSONB END,'items',items,'media',media,'rules',f."rules");
END $$;
-- Child writes lock the independent parent before checking its seal. No append
-- can race a seal, and no existing question/answer/media seal is extended.
CREATE FUNCTION public.int8_format_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE parent_id TEXT; stamp TIMESTAMPTZ; BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF;
 IF TG_TABLE_NAME='MediaChunkProof' THEN SELECT "sealedAt" INTO stamp FROM public."MediaObjectProof" WHERE "id"=NEW."proofId" FOR UPDATE;
 ELSIF TG_TABLE_NAME IN ('EntaFormatItem','EntaFormatMedia') THEN SELECT f."releaseId" INTO parent_id FROM public."EntaFormatRevision" f WHERE f."id"=NEW."formatId"; SELECT "sealedAt" INTO stamp FROM public."EntaFormatRelease" WHERE "id"=parent_id FOR UPDATE;
 ELSE SELECT "sealedAt" INTO stamp FROM public."EntaFormatRelease" WHERE "id"=NEW."releaseId" FOR UPDATE; END IF;
 IF NOT FOUND OR stamp IS NOT NULL THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "MediaChunkProof_parent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."MediaChunkProof" FOR EACH ROW EXECUTE FUNCTION public.int8_format_child_guard();
CREATE TRIGGER "EntaFormatRevision_parent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."EntaFormatRevision" FOR EACH ROW EXECUTE FUNCTION public.int8_format_child_guard();
CREATE TRIGGER "EntaFormatItem_parent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."EntaFormatItem" FOR EACH ROW EXECUTE FUNCTION public.int8_format_child_guard();
CREATE TRIGGER "EntaFormatMedia_parent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."EntaFormatMedia" FOR EACH ROW EXECUTE FUNCTION public.int8_format_child_guard();
CREATE TRIGGER "EntaFormatCover_parent_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."EntaFormatCover" FOR EACH ROW EXECUTE FUNCTION public.int8_format_child_guard();
CREATE OR REPLACE FUNCTION public.int8_media_seal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE chunks JSONB; m public."MediaRevision"%ROWTYPE; payload JSONB; BEGIN
 IF (to_jsonb(NEW)-'sealedAt') IS DISTINCT FROM (to_jsonb(OLD)-'sealedAt') OR OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF;
 SELECT * INTO m FROM public."MediaRevision" WHERE "id"=NEW."mediaRevisionId" AND "mediaSha256"=NEW."mediaHash";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('ordinal',"ordinal",'byteLength',"byteLength",'sha256',"sha256") ORDER BY "ordinal"),'[]'::JSONB) INTO chunks FROM public."MediaChunkProof" WHERE "proofId"=NEW."id";
 IF m."id" IS NULL OR m."byteLength"<>NEW."byteLength" OR m."objectKey"!~'^enta-private/[A-Za-z0-9_/-]{1,180}$' OR position('..' IN m."objectKey")>0 OR jsonb_array_length(chunks)<>ceil(NEW."byteLength"/262144.0) OR EXISTS(SELECT 1 FROM jsonb_array_elements(chunks) WITH ORDINALITY c(x,n) WHERE (x->>'ordinal')::INTEGER<>n-1 OR (x->>'byteLength')::INTEGER<>least(262144,NEW."byteLength"-(n-1)*262144)) THEN PERFORM public.int6_enta_error('MEDIA_PROOF_UNAVAILABLE'); END IF;
 IF COALESCE(CASE WHEN m."mimeType" IN ('video/mp4','video/webm') THEN NEW."durationMs" BETWEEN 1 AND 120000 AND NEW."codec" IN ('h264','vp8','vp9') AND NEW."byteLength"<=67108864 ELSE m."mimeType" IN ('image/png','image/jpeg','image/webp') AND NEW."byteLength"<=10485760 AND NEW."durationMs" IS NULL AND NEW."codec" IS NULL END,FALSE) IS NOT TRUE THEN PERFORM public.int6_enta_error('MEDIA_POLICY_UNAVAILABLE'); END IF;
 payload:=jsonb_build_object('version',1,'mediaRevisionId',NEW."mediaRevisionId",'sha256',NEW."mediaHash",'objectKey',m."objectKey",'mime',m."mimeType",'objectVersion',NEW."objectVersion",'byteLength',NEW."byteLength",'width',NEW."width",'height',NEW."height",'durationMs',NEW."durationMs",'codec',NEW."codec",'chunks',chunks,'issuerEvidenceHash',NEW."issuerEvidenceHash");
 IF NEW."manifestHash" IS DISTINCT FROM public.int6_enta_hash(payload) THEN PERFORM public.int6_enta_error('MEDIA_PROOF_UNAVAILABLE'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "MediaObjectProof_seal_guard" BEFORE UPDATE ON public."MediaObjectProof" FOR EACH ROW EXECUTE FUNCTION public.int8_media_seal_guard();
CREATE OR REPLACE FUNCTION public.int8_release_seal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE pins JSONB; proofs JSONB; f public."EntaFormatRevision"%ROWTYPE; pin JSONB; item_count INTEGER; BEGIN
 IF (to_jsonb(NEW)-'sealedAt') IS DISTINCT FROM (to_jsonb(OLD)-'sealedAt') OR OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL OR NEW."policyVersion"<>'enta-format-1' THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF;
 FOR f IN SELECT * FROM public."EntaFormatRevision" WHERE "releaseId"=NEW."id" LOOP
  pin:=public.int8_prompt_pin(f."id");
  IF NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" cq WHERE cq."catalogReleaseId"=NEW."baseReleaseId" AND cq."questionRevisionId"=f."questionRevisionId" AND cq."questionContentHash"=f."questionHash" AND cq."categoryKey"=f."categoryKey") OR NOT public.int6_enta_exact_keys(f."rules",ARRAY['version','kind','target']) OR f."rules"->'version'<>'1'::JSONB OR f."rules"->>'kind'<>f."format" OR f."contentHash" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',1,'pin',pin-'formatHash')) OR f."sourceNamespace"!~'^[A-Za-z0-9._:-]{1,128}$' OR f."sourceId"!~'^[A-Za-z0-9._:-]{1,200}$' OR NOT EXISTS(SELECT 1 FROM public."QuestionRevision" q WHERE q."id"=f."questionRevisionId" AND q."sourceNamespace"=f."sourceNamespace" AND q."sourceQuestionId"=f."sourceId" AND q."contentHash"=f."questionHash" AND q."engine"='ENTA' AND q."editorialDecision"='APPROVED' AND q."rightsDecision"='CLEARED') THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF;
  item_count:=jsonb_array_length(pin->'items');
  IF f."format" IN ('LIST_ITEMS','ACTING_ITEMS') THEN
   IF item_count NOT BETWEEN 1 AND 128 OR f."rules"->'target'<>'null'::JSONB OR EXISTS(SELECT 1 FROM generate_series(0,item_count-1) n WHERE NOT EXISTS(SELECT 1 FROM public."EntaFormatItem" i WHERE i."formatId"=f."id" AND i."ordinal"=n)) OR (SELECT count(DISTINCT "answerRevisionId") FROM public."EntaFormatItem" WHERE "formatId"=f."id")<>item_count THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF;
  ELSE IF item_count<>0 OR NOT public.int6_enta_valid_text(f."rules"->'target',1,512) OR pin->'points' NOT IN ('200'::JSONB,'400'::JSONB,'600'::JSONB) OR NOT EXISTS(SELECT 1 FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId"=f."questionRevisionId" AND a."questionContentHash"=f."questionHash" AND a."isCorrect" AND NOT a."isTrap" AND to_jsonb(a."text")=f."rules"->'target') THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF; END IF;
  IF EXISTS(SELECT 1 FROM public."EntaFormatItem" i JOIN public."QuestionAnswerRevision" a ON a."id"=i."answerRevisionId" AND a."questionRevisionId"=f."questionRevisionId" WHERE i."formatId"=f."id" AND (i."value"<>a."points" OR i."trap"<>a."isTrap" OR NOT public.int6_enta_valid_text(to_jsonb(a."text"),1,512))) OR EXISTS(SELECT 1 FROM public."EntaFormatMedia" m WHERE m."formatId"=f."id" AND ((m."role"='ITEM') IS DISTINCT FROM (m."itemId" IS NOT NULL) OR m."role" NOT IN ('PROMPT','MASKED','CLEAR','ACTOR','ITEM') OR (m."role"='ACTOR' AND f."format"<>'DRAWING_TARGET') OR (m."role"='ITEM' AND f."format" NOT IN ('LIST_ITEMS','ACTING_ITEMS')) OR NOT EXISTS(SELECT 1 FROM public."MediaObjectProof" p WHERE p."id"=m."proofId" AND p."sealedAt" IS NOT NULL))) THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF;
  IF EXISTS(SELECT 1 FROM public."EntaFormatMedia" masked JOIN public."MediaObjectProof" mp ON mp."id"=masked."proofId" JOIN public."MediaRevision" mm ON mm."id"=mp."mediaRevisionId" JOIN public."EntaFormatMedia" clear ON clear."formatId"=masked."formatId" JOIN public."MediaObjectProof" cp ON cp."id"=clear."proofId" JOIN public."MediaRevision" cm ON cm."id"=cp."mediaRevisionId" WHERE masked."formatId"=f."id" AND masked."role"='MASKED' AND clear."role" IN ('CLEAR','ACTOR') AND (mp."mediaHash"=cp."mediaHash" OR (mm."objectKey"=cm."objectKey" AND mp."objectVersion"=cp."objectVersion"))) THEN PERFORM public.int6_enta_error('MEDIA_VARIANTS_NOT_DISTINCT'); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public."EntaFormatCover" c WHERE c."releaseId"=NEW."id" AND (NOT EXISTS(SELECT 1 FROM public."MediaObjectProof" p JOIN public."MediaRevision" m ON m."id"=p."mediaRevisionId" WHERE p."id"=c."proofId" AND p."sealedAt" IS NOT NULL AND m."mimeType" IN ('image/png','image/jpeg','image/webp')) OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseCategory" rc WHERE rc."catalogReleaseId"=NEW."baseReleaseId" AND rc."categoryKey"=c."categoryKey"))) THEN PERFORM public.int6_enta_error('MEDIA_PROOF_UNAVAILABLE'); END IF;
 SELECT COALESCE(jsonb_agg(public.int8_prompt_pin(fr."id") ORDER BY fr."categoryKey" COLLATE "C",fr."opaqueRef" COLLATE "C"),'[]'::JSONB) INTO pins FROM public."EntaFormatRevision" fr WHERE fr."releaseId"=NEW."id";
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p."id",'manifestHash',p."manifestHash",'issuerEvidenceHash',p."issuerEvidenceHash") ORDER BY p."id" COLLATE "C"),'[]'::JSONB) INTO proofs FROM public."MediaObjectProof" p WHERE p."id" IN (SELECT "proofId" FROM public."EntaFormatMedia" m JOIN public."EntaFormatRevision" fr ON fr."id"=m."formatId" WHERE fr."releaseId"=NEW."id" UNION SELECT "proofId" FROM public."EntaFormatCover" WHERE "releaseId"=NEW."id");
 IF jsonb_array_length(pins)<1 OR NEW."mediaRoot" IS DISTINCT FROM public.int6_enta_hash(proofs) OR NEW."formatRoot" IS DISTINCT FROM public.int6_enta_hash(jsonb_build_object('version',1,'baseReleaseId',NEW."baseReleaseId",'baseRoot',NEW."baseRoot",'receiptId',NEW."receiptId",'policyVersion',NEW."policyVersion",'mediaRoot',NEW."mediaRoot",'pins',pins,'covers',(SELECT COALESCE(jsonb_agg(jsonb_build_object('categoryKey',"categoryKey",'proofId',"proofId") ORDER BY "categoryKey" COLLATE "C"),'[]'::JSONB) FROM public."EntaFormatCover" WHERE "releaseId"=NEW."id"),'issuerEvidenceHash',NEW."issuerEvidenceHash")) THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "EntaFormatRelease_seal_guard" BEFORE UPDATE ON public."EntaFormatRelease" FOR EACH ROW EXECUTE FUNCTION public.int8_release_seal_guard();
CREATE FUNCTION public.int8_catalog(ns TEXT,project TEXT,uid TEXT,execution_format TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; f public."EntaFormatRelease"%ROWTYPE; categories JSONB; BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id'; IF execution_format NOT IN ('MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 -- Shared exact approved base pointer. Format issuer/activation is absent and
 -- remains explicitly denied; latest timestamps are never editorial authority.
 SELECT fr.* INTO f FROM public."ActiveCatalogPointer" pointer JOIN public."EntaFormatRelease" fr ON fr."receiptId"=pointer."validationReceiptId" AND fr."baseReleaseId"=pointer."catalogReleaseId" AND fr."baseRoot"=pointer."releaseRootHash" WHERE pointer."id"='singleton' AND fr."sealedAt" IS NOT NULL FOR SHARE OF pointer;
 IF NOT FOUND THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF; PERFORM public.int8_assert_format(f."id");
 SELECT jsonb_agg(jsonb_build_object('key',c."categoryKey",'label',cr."labelAr",'format',c.format,'prompts',(SELECT jsonb_agg(public.int8_prompt_pin(p."id") ORDER BY p."opaqueRef" COLLATE "C") FROM public."EntaFormatRevision" p WHERE p."releaseId"=f."id" AND p."categoryKey"=c."categoryKey"),'cover',(SELECT public.int8_media_pin("proofId",'COVER',NULL) FROM public."EntaFormatCover" WHERE "releaseId"=f."id" AND "categoryKey"=c."categoryKey")) ORDER BY c."categoryKey" COLLATE "C") INTO categories FROM (SELECT "categoryKey",min("format") format FROM public."EntaFormatRevision" WHERE "releaseId"=f."id" GROUP BY "categoryKey" HAVING count(DISTINCT "format")=1) c JOIN public."CatalogReleaseCategory" rc ON rc."catalogReleaseId"=f."baseReleaseId" AND rc."categoryKey"=c."categoryKey" JOIN public."CanonicalCategoryRevision" cr ON cr."id"=rc."categoryRevisionId" WHERE execution_format='MIXED_BOARD' OR c.format=CASE WHEN execution_format='STANDALONE_LIST' THEN 'LIST_ITEMS' ELSE 'ACTING_ITEMS' END;
 RETURN jsonb_build_object('baseReleaseId',f."baseReleaseId",'baseRoot',f."baseRoot",'receiptId',f."receiptId",'formatReleaseId',f."id",'formatRoot',f."formatRoot",'mediaRoot',f."mediaRoot",'policyVersion',f."policyVersion",'categories',COALESCE(categories,'[]'::JSONB));
END $$;
CREATE FUNCTION public.int8_locked_state(ns TEXT,project TEXT,game_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE state JSONB; BEGIN
 PERFORM public.int8_namespace(ns,project);
 PERFORM 1 FROM public."Game" g JOIN public."FirebaseIdentity" i ON i."id"=g."firebaseIdentityId" WHERE g."id"=game_id AND g."gameFormat"='FIREBASE_PINNED' AND g."executionFormat"<>'TIER_BOARD' AND i."firebaseProjectId"=project FOR UPDATE OF g;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM 1 FROM public."GameRuntime" WHERE "gameId"=game_id FOR UPDATE;
 PERFORM 1 FROM public."GameRound" WHERE "gameId"=game_id ORDER BY "ordinal" FOR UPDATE;
 -- Immutable RoundItemPin membership is protected by the locked Game/round. No UPDATE privilege is granted merely to lock it.
 PERFORM 1 FROM public."RoundGrantScope" WHERE "gameId"=game_id ORDER BY "id" COLLATE "C" FOR UPDATE;
 PERFORM 1 FROM public."RoundGrant" WHERE "gameId"=game_id ORDER BY "id" COLLATE "C" FOR UPDATE;
 PERFORM 1 FROM public."DrawingCanvasState" c JOIN public."GameRound" r ON r."id"=c."roundId" WHERE r."gameId"=game_id ORDER BY r."ordinal" FOR UPDATE OF c;
 PERFORM 1 FROM public."Team" WHERE "gameId"=game_id ORDER BY "id" COLLATE "C" FOR UPDATE;
 PERFORM public.int8_assert_stored(game_id); SELECT "state" INTO state FROM public."EntaExecutionPin" WHERE "gameId"=game_id;
 RETURN state;
END $$;
CREATE FUNCTION public.int8_owner_load(ns TEXT,project TEXT,uid TEXT,game_id TEXT,locked BOOLEAN) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; state JSONB; BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 IF NOT EXISTS(SELECT 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id AND "executionFormat"<>'TIER_BOARD') THEN RETURN NULL; END IF;
 IF locked THEN RETURN public.int8_locked_state(ns,project,game_id); END IF;
 -- Parent SHARE keeps aggregate versions/scores/pins coherent against commands.
 PERFORM 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=identity_id FOR SHARE;
 PERFORM public.int8_assert_stored(game_id); SELECT "state" INTO state FROM public."EntaExecutionPin" WHERE "gameId"=game_id; RETURN state;
END $$;
CREATE FUNCTION public.int8_locate_grant(ns TEXT,project TEXT,token_hash TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE game_id TEXT; BEGIN
 PERFORM public.int8_namespace(ns,project); IF token_hash!~'^[a-f0-9]{64}$' THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
 SELECT gr."gameId" INTO game_id FROM public."RoundGrant" gr JOIN public."Game" g ON g."id"=gr."gameId" JOIN public."FirebaseIdentity" i ON i."id"=g."firebaseIdentityId" WHERE gr."tokenHash"=token_hash AND i."firebaseProjectId"=project; IF NOT FOUND THEN RETURN NULL; END IF; RETURN jsonb_build_object('gameId',game_id);
END $$;
CREATE FUNCTION public.int8_grant_load(ns TEXT,project TEXT,game_id TEXT,token_hash TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE state JSONB; gr public."RoundGrant"%ROWTYPE; sc public."RoundGrantScope"%ROWTYPE; round JSONB; moment DOUBLE PRECISION; BEGIN
 state:=public.int8_locked_state(ns,project,game_id); moment:=floor(extract(epoch FROM clock_timestamp())*1000);
 SELECT * INTO gr FROM public."RoundGrant" WHERE "gameId"=game_id AND "tokenHash"=token_hash; SELECT * INTO sc FROM public."RoundGrantScope" WHERE "id"=gr."scopeId" AND "gameId"=game_id;
 SELECT x INTO round FROM jsonb_array_elements(state->'rounds') x WHERE x->>'id'=gr."roundId";
 IF state IS NULL OR state->'finished'='true'::JSONB OR gr."id" IS NULL OR gr."revoked" OR extract(epoch FROM gr."expiresAt")*1000<=moment OR sc."activeGrantId" IS DISTINCT FROM gr."id" OR sc."generation"<>gr."generation" OR sc."roundId"<>gr."roundId" OR state->>'activeRoundId' IS DISTINCT FROM gr."roundId" OR round->>'state' IS DISTINCT FROM 'RUNNING' OR round->'revealed'='true'::JSONB OR gr."assignmentId" IS DISTINCT FROM sc."assignmentId" OR (gr."role"='JUDGE' AND (round->'pin'->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS') OR gr."assignmentId" IS NOT NULL)) OR (gr."role"='ACTOR' AND (round->'assignment'->>'id' IS DISTINCT FROM gr."assignmentId" OR round->'pin'->>'format' NOT IN ('ACTING_ITEMS','DRAWING_TARGET') OR EXISTS(SELECT 1 FROM jsonb_array_elements(round->'consumed') x WHERE x->>'itemId'=round->'assignment'->>'itemId'))) THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF; RETURN state;
END $$;
CREATE FUNCTION public.int8_find_start(ns TEXT,project TEXT,uid TEXT,request_key TEXT,logical_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; a public."Admission"%ROWTYPE; g public."Game"%ROWTYPE; state JSONB; BEGIN
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT * INTO a FROM public."Admission" WHERE "firebaseIdentityId"=identity_id AND ("requestKey"=request_key OR ("engine"='ENTA' AND "logicalMatchId"=logical_id)) ORDER BY CASE WHEN "requestKey"=request_key THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a."engine"<>'ENTA' OR a."requestVersion"<>4 OR a."state"<>'COMMITTED' THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF;
 SELECT * INTO g FROM public."Game" WHERE "admissionId"=a."id" AND "firebaseIdentityId"=identity_id;
 state:=public.int8_owner_load(ns,project,uid,g."id",TRUE);
 IF state IS NULL OR public.int6_enta_hash(state->'request') IS DISTINCT FROM a."requestHash" OR public.int6_enta_hash(state->'intent') IS DISTINCT FROM a."intentHash" OR state->'intent'->'request' IS DISTINCT FROM state->'request' OR public.int6_enta_hash((SELECT jsonb_agg(x->'pin' ORDER BY (x->>'ordinal')::INTEGER) FROM jsonb_array_elements(state->'rounds') x)) IS DISTINCT FROM state->'intent'->>'pinsHash' THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 -- Stored immutable pins/exposure evidence reconstruct v4, no active pointer or
 -- remaining-credit query on replay. Content rotation cannot change old intent.
 IF jsonb_array_length(state->'intent'->'selection')<>jsonb_array_length(state->'rounds') OR (g."executionFormat"<>'MIXED_BOARD' AND (SELECT count(*) FROM public."EntaSourceExposure" WHERE "gameId"=g."id")<>jsonb_array_length(state->'rounds')) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 RETURN state;
END $$;
CREATE FUNCTION public.int8_exposures(ns TEXT,project TEXT,uid TEXT,execution_format TEXT,category_key TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; result JSONB; BEGIN identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('categoryKey',"categoryKey",'sourceNamespace',"sourceNamespace",'sourceId',"sourceId",'cycle',"cycle") ORDER BY "cycle","sourceId" COLLATE "C"),'[]'::JSONB) INTO result FROM public."EntaSourceExposure" WHERE "firebaseIdentityId"=identity_id AND "executionFormat"=execution_format AND "categoryKey"=category_key; RETURN result;
END $$;
CREATE FUNCTION public.int8_valid_request(request JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE s JSONB:=request->'setup'; category JSONB; team JSONB; fmt TEXT:=request->>'executionFormat'; BEGIN
 IF NOT public.int6_enta_exact_keys(request,ARRAY['version','operation','executionFormat','predecessor','requestKey','logicalMatchId','setup']) OR request->'version' IS DISTINCT FROM '4'::JSONB OR request->'predecessor' IS DISTINCT FROM 'null'::JSONB OR request->>'logicalMatchId'!~'^[A-Za-z0-9_-]{1,128}$' OR request->>'requestKey'!~'^[A-Za-z0-9._:-]{8,128}$' OR fmt NOT IN ('MIXED_BOARD','STANDALONE_LIST','STANDALONE_ACTING') OR request->>'operation' IS DISTINCT FROM (CASE fmt WHEN 'MIXED_BOARD' THEN 'PAID_ENTA_CLASSIC' WHEN 'STANDALONE_LIST' THEN 'PAID_ENTA_LIST' ELSE 'PAID_ENTA_ACTING' END) OR NOT public.int6_enta_exact_keys(s,ARRAY['version','categories','teams','rules']) OR s->'version' IS DISTINCT FROM '4'::JSONB OR jsonb_typeof(s->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'categories')<>(CASE WHEN fmt='MIXED_BOARD' THEN 6 ELSE 1 END) OR jsonb_typeof(s->'teams') IS DISTINCT FROM 'array' OR jsonb_array_length(s->'teams') NOT BETWEEN 2 AND (CASE WHEN fmt='MIXED_BOARD' THEN 4 ELSE 2 END) OR NOT public.int6_enta_exact_keys(s->'rules',ARRAY['turnSeconds','overallSeconds','questionSeconds']) OR s->'rules'->'turnSeconds' NOT IN ('15'::JSONB,'30'::JSONB,'45'::JSONB) OR s->'rules'->'overallSeconds' NOT IN ('null'::JSONB,'300'::JSONB,'600'::JSONB) OR NOT public.int5b_json_integer(s->'rules'->'questionSeconds',5,120) THEN RETURN FALSE; END IF;
 IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(s->'categories') x)<>jsonb_array_length(s->'categories') OR (SELECT count(DISTINCT translate(x->>'name','ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) FROM jsonb_array_elements(s->'teams') x)<>jsonb_array_length(s->'teams') THEN RETURN FALSE; END IF;
 FOR category IN SELECT x FROM jsonb_array_elements(s->'categories') x LOOP IF NOT public.int6_enta_exact_keys(category,ARRAY['key','promptRefs']) OR category->>'key'!~'^[A-Za-z0-9_-]{1,128}$' OR jsonb_typeof(category->'promptRefs') IS DISTINCT FROM 'array' OR jsonb_array_length(category->'promptRefs')>6 OR (fmt<>'MIXED_BOARD' AND category->'promptRefs'<>'[]'::JSONB) OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(category->'promptRefs') x)<>jsonb_array_length(category->'promptRefs') OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(category->'promptRefs') x WHERE x!~'^[A-Za-z0-9_-]{1,128}$') THEN RETURN FALSE; END IF; END LOOP;
 FOR team IN SELECT x FROM jsonb_array_elements(s->'teams') x LOOP IF NOT public.int6_enta_exact_keys(team,ARRAY['name','players']) OR NOT public.int6_enta_valid_text(team->'name',2,22) OR jsonb_typeof(team->'players') IS DISTINCT FROM 'array' OR jsonb_array_length(team->'players') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(team->'players') x WHERE NOT public.int6_enta_valid_text(x,1,30)) THEN RETURN FALSE; END IF; END LOOP; RETURN TRUE;
END $$;
CREATE FUNCTION public.int8_start(ns TEXT,project TEXT,uid TEXT,request JSONB,intent JSONB,pins JSONB,receipt_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE identity_id TEXT; w public."Wallet"%ROWTYPE; a_id TEXT:=gen_random_uuid()::TEXT; res_id TEXT:=gen_random_uuid()::TEXT; game_id TEXT:=request->>'logicalMatchId'; existing JSONB; catalog JSONB; fmt TEXT:=request->>'executionFormat'; mode TEXT; s JSONB:=request->'setup'; categories JSONB:='[]'::JSONB; teams JSONB:='[]'::JSONB; rounds JSONB:='[]'::JSONB; state JSONB; team JSONB; player JSONB; category JSONB; pin JSONB; item JSONB; choice JSONB; team_id TEXT; round_id TEXT; question_id TEXT; team_ids TEXT[]:=ARRAY[]::TEXT[]; moment TIMESTAMPTZ; i INTEGER:=0; j INTEGER; remaining_count INTEGER:=0; selected_cycle INTEGER; pool_count INTEGER; taken INTEGER; expected_selection JSONB:='[]'::JSONB; pool_hash TEXT;
BEGIN
 IF NOT public.int8_valid_request(request) OR NOT public.int6_enta_exact_keys(intent,ARRAY['version','request','baseReleaseId','baseRoot','receiptId','formatReleaseId','formatRoot','mediaRoot','policyVersion','poolHash','seed','selection','roundCount','pinsHash']) OR intent->'version'<>'4'::JSONB OR intent->'request' IS DISTINCT FROM request OR intent->>'seed'!~'^[a-f0-9]{64}$' OR jsonb_typeof(pins) IS DISTINCT FROM 'array' OR jsonb_array_length(pins) NOT BETWEEN 1 AND 36 OR intent->>'pinsHash' IS DISTINCT FROM public.int6_enta_hash(pins) OR intent->'roundCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(pins)) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id'; SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id FOR UPDATE; IF NOT FOUND THEN PERFORM public.int6_enta_error('ACCOUNT_NOT_READY'); END IF;
 existing:=public.int8_find_start(ns,project,uid,request->>'requestKey',game_id); IF existing IS NOT NULL THEN IF existing->'request' IS DISTINCT FROM request THEN PERFORM public.int6_enta_error('IDEMPOTENCY_KEY_CONFLICT'); END IF; RETURN existing; END IF;
 IF w."debt">0 THEN PERFORM public.int6_enta_error('WALLET_DEBT_BLOCKS_START'); END IF; IF w."available"<1 THEN PERFORM public.int6_enta_error('INSUFFICIENT_CREDIT'); END IF;
 catalog:=public.int8_catalog(ns,project,uid,fmt); PERFORM public.int8_assert_format(catalog->>'formatReleaseId');
 IF (intent->>'baseReleaseId',intent->>'baseRoot',intent->>'receiptId',intent->>'formatReleaseId',intent->>'formatRoot',intent->>'mediaRoot',intent->>'policyVersion') IS DISTINCT FROM (catalog->>'baseReleaseId',catalog->>'baseRoot',catalog->>'receiptId',catalog->>'formatReleaseId',catalog->>'formatRoot',catalog->>'mediaRoot',catalog->>'policyVersion') OR receipt_id IS DISTINCT FROM catalog->>'receiptId' THEN PERFORM public.int6_enta_error('FORMAT_CATALOG_UNAVAILABLE'); END IF;
 FOR pin IN SELECT x FROM jsonb_array_elements(pins) x LOOP IF public.int8_prompt_pin(pin->>'formatId') IS DISTINCT FROM pin OR NOT EXISTS(SELECT 1 FROM public."EntaFormatRevision" f JOIN public."CatalogReleaseQuestion" q ON q."questionRevisionId"=f."questionRevisionId" AND q."questionContentHash"=f."questionHash" AND q."catalogReleaseId"=catalog->>'baseReleaseId' WHERE f."id"=pin->>'formatId' AND f."releaseId"=catalog->>'formatReleaseId') THEN PERFORM public.int6_enta_error('PROMPT_UNAVAILABLE'); END IF; END LOOP;
 IF (SELECT count(DISTINCT (x->>'sourceNamespace',x->>'sourceId')) FROM jsonb_array_elements(pins) x)<>jsonb_array_length(pins) OR (SELECT count(DISTINCT x->>'revisionId') FROM jsonb_array_elements(pins) x)<>jsonb_array_length(pins) THEN PERFORM public.int6_enta_error('SELECTION_UNAVAILABLE'); END IF;
 -- Wallet serializes exposure for this owner. Source identity, never revision
 -- novelty. Drain unseen remainder, then fill new cycle excluding current picks.
 IF fmt<>'MIXED_BOARD' THEN
 SELECT x INTO category FROM jsonb_array_elements(catalog->'categories') x WHERE x->>'key'=s->'categories'->0->>'key' AND x->>'format'=CASE fmt WHEN 'STANDALONE_LIST' THEN 'LIST_ITEMS' ELSE 'ACTING_ITEMS' END; IF NOT FOUND THEN PERFORM public.int6_enta_error('CATEGORY_UNAVAILABLE'); END IF;
 pool_count:=jsonb_array_length(category->'prompts'); taken:=least(4,pool_count); SELECT greatest(1,COALESCE(max("cycle"),1)) INTO selected_cycle FROM public."EntaSourceExposure" WHERE "firebaseIdentityId"=identity_id AND "executionFormat"=fmt AND "categoryKey"=category->>'key';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceNamespace',x->>'sourceNamespace','sourceId',x->>'sourceId','revisionId',x->>'revisionId','cycle',selected_cycle,'ordinal',ord-1) ORDER BY ord),'[]'::JSONB) INTO expected_selection FROM (SELECT x,row_number() OVER(ORDER BY public.int6_enta_hash(jsonb_build_array(intent->>'seed',selected_cycle,x->>'sourceNamespace',x->>'sourceId')) COLLATE "C",(x->>'sourceNamespace') COLLATE "C",(x->>'sourceId') COLLATE "C",(x->>'ref') COLLATE "C") ord FROM jsonb_array_elements(category->'prompts') x WHERE NOT EXISTS(SELECT 1 FROM public."EntaSourceExposure" e WHERE e."firebaseIdentityId"=identity_id AND e."executionFormat"=fmt AND e."categoryKey"=category->>'key' AND e."sourceNamespace"=x->>'sourceNamespace' AND e."sourceId"=x->>'sourceId' AND e."cycle"=selected_cycle) ORDER BY ord LIMIT taken) selected;
 IF jsonb_array_length(expected_selection)<taken THEN remaining_count:=jsonb_array_length(expected_selection); selected_cycle:=selected_cycle+1; SELECT expected_selection||COALESCE(jsonb_agg(jsonb_build_object('sourceNamespace',x->>'sourceNamespace','sourceId',x->>'sourceId','revisionId',x->>'revisionId','cycle',selected_cycle,'ordinal',remaining_count+ord-1) ORDER BY ord),'[]'::JSONB) INTO expected_selection FROM (SELECT x,row_number() OVER(ORDER BY public.int6_enta_hash(jsonb_build_array(intent->>'seed',selected_cycle,x->>'sourceNamespace',x->>'sourceId')) COLLATE "C",(x->>'sourceNamespace') COLLATE "C",(x->>'sourceId') COLLATE "C",(x->>'ref') COLLATE "C") ord FROM jsonb_array_elements(category->'prompts') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected_selection) picked WHERE picked->>'sourceNamespace'=x->>'sourceNamespace' AND picked->>'sourceId'=x->>'sourceId') ORDER BY ord LIMIT taken-remaining_count) selected; END IF;
 ELSE
 FOR category IN SELECT x FROM jsonb_array_elements(s->'categories') x LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(catalog->'categories') c WHERE c->>'key'=category->>'key') THEN PERFORM public.int6_enta_error('CATEGORY_UNAVAILABLE'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(pins) p WHERE p->>'categoryKey'=category->>'key' AND p->>'format' IN ('LIST_ITEMS','ACTING_ITEMS')) THEN
   IF jsonb_array_length(category->'promptRefs') NOT BETWEEN 1 AND 6 OR (SELECT jsonb_agg(p->'ref' ORDER BY ord) FROM jsonb_array_elements(pins) WITH ORDINALITY p(p,ord) WHERE p->>'categoryKey'=category->>'key') IS DISTINCT FROM category->'promptRefs' THEN PERFORM public.int6_enta_error('PROMPT_UNAVAILABLE'); END IF;
  ELSE IF category->'promptRefs'<>'[]'::JSONB OR (SELECT count(*) FROM jsonb_array_elements(pins) p WHERE p->>'categoryKey'=category->>'key')<>6 OR EXISTS(SELECT 1 FROM (VALUES(200),(400),(600)) tiers(value) WHERE (SELECT count(*) FROM jsonb_array_elements(pins) p WHERE p->>'categoryKey'=category->>'key' AND (p->>'points')::INTEGER=tiers.value)<>2) THEN PERFORM public.int6_enta_error('TIER_SUPPLY_UNAVAILABLE'); END IF; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('sourceNamespace',p->>'sourceNamespace','sourceId',p->>'sourceId','revisionId',p->>'revisionId','cycle',0,'ordinal',ord-1) ORDER BY ord) INTO expected_selection FROM jsonb_array_elements(pins) WITH ORDINALITY p(p,ord);
 END IF;
 IF expected_selection IS DISTINCT FROM intent->'selection' OR EXISTS(SELECT 1 FROM jsonb_array_elements(pins) WITH ORDINALITY p(x,n) WHERE x->>'sourceNamespace' IS DISTINCT FROM expected_selection->(n::INTEGER-1)->>'sourceNamespace' OR x->>'sourceId' IS DISTINCT FROM expected_selection->(n::INTEGER-1)->>'sourceId' OR x->>'revisionId' IS DISTINCT FROM expected_selection->(n::INTEGER-1)->>'revisionId') THEN PERFORM public.int6_enta_error('SELECTION_UNAVAILABLE'); END IF;
 SELECT public.int6_enta_hash(jsonb_agg(jsonb_build_object('key',c->>'key','sources',(SELECT jsonb_agg(jsonb_build_object('sourceNamespace',p->>'sourceNamespace','sourceId',p->>'sourceId','revisionId',p->>'revisionId','hash',p->>'hash') ORDER BY (p->>'sourceNamespace') COLLATE "C",(p->>'sourceId') COLLATE "C") FROM jsonb_array_elements(c->'prompts') p)) ORDER BY selected.ord)) INTO pool_hash FROM jsonb_array_elements(s->'categories') WITH ORDINALITY selected(wanted,ord) JOIN LATERAL (SELECT c FROM jsonb_array_elements(catalog->'categories') c WHERE c->>'key'=wanted->>'key') categories ON TRUE;
 IF pool_hash IS DISTINCT FROM intent->>'poolHash' THEN PERFORM public.int6_enta_error('SELECTION_UNAVAILABLE'); END IF;
 mode:=CASE fmt WHEN 'STANDALONE_LIST' THEN 'LIST' WHEN 'STANDALONE_ACTING' THEN 'ACTING' ELSE 'CLASSIC' END; moment:=clock_timestamp();
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","catalogReleaseId","releaseRootHash","validationReceiptId","selectorVersion","state","version","updatedAt") VALUES(a_id,identity_id,w."id",'ENTA',request->>'operation',mode,game_id,request->>'requestKey',public.int6_enta_hash(request),public.int6_enta_hash(intent),4,catalog->>'baseReleaseId',catalog->>'baseRoot',receipt_id,'enta-format-1','HELD',0,moment);
 INSERT INTO public."Reservation"("id","admissionId","quantity","state","updatedAt") VALUES(res_id,a_id,1,'HELD',moment);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',a_id,'RESERVE',res_id,-1,1,0,w."available"-1,w."held"+1,w."debt",identity_id,public.int6_enta_hash(request));
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,a_id,1,'HELD',public.int6_enta_hash(request));
 INSERT INTO public."Game"("id","userId","gameFormat","executionFormat","firebaseIdentityId","admissionId","catalogReleaseId","catalogReleaseRootHash","validationReceiptId","mode","status","createdAt") VALUES(game_id,NULL,'FIREBASE_PINNED',fmt,identity_id,a_id,catalog->>'baseReleaseId',catalog->>'baseRoot',receipt_id,mode,'ACTIVE',moment AT TIME ZONE 'UTC');
 FOR team IN SELECT x FROM jsonb_array_elements(s->'teams') x LOOP team_id:=gen_random_uuid()::TEXT; team_ids:=array_append(team_ids,team_id); INSERT INTO public."Team"("id","gameId","name","color","score") VALUES(team_id,game_id,team->>'name',CASE i WHEN 0 THEN '#cc005e' ELSE '#176b66' END,0); j:=0; FOR player IN SELECT x FROM jsonb_array_elements(team->'players') x LOOP j:=j+1; INSERT INTO public."Player"("id","teamId","name") VALUES(team_id||'-p'||lpad(j::TEXT,2,'0'),team_id,player#>>'{}'); END LOOP; teams:=teams||jsonb_build_array(jsonb_build_object('id',team_id,'name',team->>'name','players',team->'players','score',0)); i:=i+1; END LOOP;
 i:=0; FOR category IN SELECT x FROM jsonb_array_elements(s->'categories') x LOOP INSERT INTO public."GameCategoryPin"("id","gameId","catalogReleaseId","categoryKey","categoryRevisionId","ordinal") SELECT gen_random_uuid()::TEXT,game_id,catalog->>'baseReleaseId',category->>'key',"categoryRevisionId",i FROM public."CatalogReleaseCategory" WHERE "catalogReleaseId"=catalog->>'baseReleaseId' AND "categoryKey"=category->>'key'; SELECT categories||jsonb_build_array(c-'prompts'-'roundCount') INTO categories FROM jsonb_array_elements(catalog->'categories') c WHERE c->>'key'=category->>'key'; i:=i+1; END LOOP;
 i:=0; FOR pin IN SELECT x FROM jsonb_array_elements(pins) x LOOP round_id:=gen_random_uuid()::TEXT; question_id:=gen_random_uuid()::TEXT; INSERT INTO public."GameQuestion"("id","gameId","catalogReleaseId","questionRevisionId","questionId","isOpened","usedVar","alsoCorrectTeamIds") VALUES(question_id,game_id,catalog->>'baseReleaseId',pin->>'revisionId',NULL,FALSE,FALSE,ARRAY[]::TEXT[]);
 choice:=jsonb_build_object('id',round_id,'questionId',question_id,'ordinal',i,'pin',pin,'state','READY','version',0,'scoringTeamId',NULL,'turnDeadline',NULL,'overallDeadline',NULL,'remainingTurn',NULL,'remainingOverall',NULL,'revealed',FALSE,'assignment',NULL,'consumed','[]'::JSONB,'reason',NULL);
 INSERT INTO public."GameRound"("id","gameId","gameQuestionId","formatId","questionRevisionId","questionHash","categoryKey","sourceNamespace","sourceId","formatHash","ordinal","pin","state") VALUES(round_id,game_id,question_id,pin->>'formatId',pin->>'revisionId',pin->>'hash',pin->>'categoryKey',pin->>'sourceNamespace',pin->>'sourceId',pin->>'formatHash',i,pin,choice);
 FOR item IN SELECT x FROM jsonb_array_elements(pin->'items') x LOOP INSERT INTO public."RoundItemPin"("roundId","formatId","itemId","answerRevisionId","answerHash","ordinal") VALUES(round_id,pin->>'formatId',item->>'id',item->>'revisionId',item->>'hash',(item->>'ordinal')::INTEGER); END LOOP;
 rounds:=rounds||jsonb_build_array(choice); i:=i+1; END LOOP;
 state:=jsonb_build_object('id',game_id,'identityId',identity_id,'projectId',project,'hostUid',uid,'admissionId',a_id,'request',request,'clientHash',public.int6_enta_hash(request),'intent',intent,'intentHash',public.int6_enta_hash(intent),'version',1,'finished',FALSE,'activeRoundId',NULL,'turnIndex',0,'resultReason',NULL,'teams',teams,'categories',categories,'rounds',rounds,'events','[]'::JSONB,'postings','[]'::JSONB,'grants','[]'::JSONB,'grantScopes','[]'::JSONB,'canvases','[]'::JSONB);
 INSERT INTO public."EntaExecutionPin"("gameId","firebaseIdentityId","executionFormat","formatReleaseId","formatRoot","mediaRoot","clientBinding","clientHash","fullIntent","intentHash","state") VALUES(game_id,identity_id,fmt,catalog->>'formatReleaseId',catalog->>'formatRoot',catalog->>'mediaRoot',request,public.int6_enta_hash(request),intent,public.int6_enta_hash(intent),state);
 IF fmt<>'MIXED_BOARD' THEN FOR choice IN SELECT x FROM jsonb_array_elements(expected_selection) x LOOP INSERT INTO public."EntaSourceExposure"("gameId","ordinal","firebaseIdentityId","executionFormat","categoryKey","sourceNamespace","sourceId","cycle","revisionId") VALUES(game_id,(choice->>'ordinal')::INTEGER,identity_id,fmt,s->'categories'->0->>'key',choice->>'sourceNamespace',choice->>'sourceId',(choice->>'cycle')::INTEGER,choice->>'revisionId'); END LOOP; END IF;
 INSERT INTO public."GameRuntime"("gameId","version","state","setup","setupHash","teamOrder","turnIndex","updatedAt") VALUES(game_id,1,'BOARD',s,public.int6_enta_hash(s),team_ids,0,moment);
 INSERT INTO public."GameEvent"("gameId","commandId","sequence","actorFirebaseIdentityId","type","intentHash") VALUES(game_id,request->>'requestKey',1,identity_id,'START',public.int6_enta_hash(intent));
 SELECT * INTO w FROM public."Wallet" WHERE "id"=w."id";
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId","evidenceHash") VALUES(gen_random_uuid()::TEXT,w."id",w."version"+1,'ADMISSION',a_id,'COMMIT',res_id,0,-1,0,w."available",w."held"-1,w."debt",identity_id,public.int6_enta_hash(intent));
 UPDATE public."Wallet" SET "held"="held"-1,"version"="version"+1,"updatedAt"=moment WHERE "id"=w."id"; UPDATE public."Reservation" SET "state"='COMMITTED',"updatedAt"=moment WHERE "id"=res_id; UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=moment WHERE "id"=a_id; INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType","evidenceHash") VALUES(gen_random_uuid()::TEXT,a_id,2,'COMMITTED',public.int6_enta_hash(intent)); RETURN state;
END $$;

-- NULL-safe exact command typing precedes duplicate recovery. Existing child
-- authorization still precedes duplicate; phase/unused checks remain after it.
CREATE FUNCTION public.int8_json_id(x JSONB) RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$ SELECT COALESCE(jsonb_typeof(x)='string' AND (x#>>'{}')~'^[A-Za-z0-9_-]{1,128}$',FALSE) $$;
CREATE FUNCTION public.int8_valid_command(c JSONB,capability BOOLEAN) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE kind TEXT:=c->>'type'; extra TEXT[]; stroke JSONB; pt JSONB; BEGIN
 extra:=CASE kind WHEN 'OPEN_ROUND' THEN ARRAY['roundId'] WHEN 'NEXT_ROUND' THEN ARRAY[]::TEXT[] WHEN 'PAUSE_ROUND' THEN ARRAY['roundId','reason'] WHEN 'RESUME_ROUND' THEN ARRAY['roundId'] WHEN 'CLOSE_ROUND' THEN ARRAY['roundId'] WHEN 'REVEAL_TARGET' THEN ARRAY['roundId'] WHEN 'SELECT_SCORING_TEAM' THEN ARRAY['roundId','teamId'] WHEN 'ASSIGN_ACTOR' THEN ARRAY['roundId','teamId','playerIndex','itemId'] WHEN 'JUDGE_ITEM' THEN ARRAY['roundId','itemId'] WHEN 'ADJUDICATE_ROUND' THEN ARRAY['roundId','teamId','correct'] WHEN 'FINISH' THEN ARRAY['confirmEarly'] WHEN 'CREATE_GRANT' THEN ARRAY['roundId','role','durationSeconds'] WHEN 'ROTATE_GRANT' THEN ARRAY['roundId','scopeId','expectedGeneration','durationSeconds'] WHEN 'REVOKE_GRANT' THEN ARRAY['roundId','scopeId'] WHEN 'APPEND' THEN ARRAY['stroke'] WHEN 'UNDO' THEN ARRAY[]::TEXT[] WHEN 'REDO' THEN ARRAY[]::TEXT[] WHEN 'CLEAR' THEN ARRAY[]::TEXT[] ELSE NULL END;
 IF extra IS NULL OR public.int6_enta_exact_keys(c,CASE WHEN capability THEN ARRAY['type','commandId','expectedRevision'] ELSE ARRAY['type','commandId','expectedVersion'] END||extra) IS NOT TRUE OR jsonb_typeof(c->'type') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'commandId') IS DISTINCT FROM 'string' OR COALESCE(c->>'commandId'~'^[A-Za-z0-9._:-]{8,128}$',FALSE) IS NOT TRUE THEN RETURN FALSE; END IF;
 IF capability THEN IF kind NOT IN ('APPEND','UNDO','REDO','CLEAR') OR public.int5b_json_integer(c->'expectedRevision',0,2000000000) IS NOT TRUE THEN RETURN FALSE; END IF;
 ELSE IF kind IN ('APPEND','UNDO','REDO','CLEAR') OR public.int5b_json_integer(c->'expectedVersion',1,2000000000) IS NOT TRUE THEN RETURN FALSE; END IF; END IF;
 IF c ? 'roundId' AND NOT public.int8_json_id(c->'roundId') OR c ? 'scopeId' AND NOT public.int8_json_id(c->'scopeId') THEN RETURN FALSE; END IF;
 IF kind IN ('SELECT_SCORING_TEAM','ASSIGN_ACTOR') AND NOT public.int8_json_id(c->'teamId') OR kind='JUDGE_ITEM' AND NOT public.int8_json_id(c->'itemId') THEN RETURN FALSE; END IF;
 IF kind='ASSIGN_ACTOR' AND (public.int5b_json_integer(c->'playerIndex',0,7) IS NOT TRUE OR c->'itemId' IS DISTINCT FROM 'null'::JSONB AND NOT public.int8_json_id(c->'itemId')) THEN RETURN FALSE; END IF;
 IF kind='ADJUDICATE_ROUND' AND (jsonb_typeof(c->'correct') IS DISTINCT FROM 'boolean' OR (CASE WHEN c->'correct'='true'::JSONB THEN NOT public.int8_json_id(c->'teamId') ELSE c->'teamId' IS DISTINCT FROM 'null'::JSONB END)) THEN RETURN FALSE; END IF;
 IF kind='FINISH' AND jsonb_typeof(c->'confirmEarly') IS DISTINCT FROM 'boolean' OR kind='PAUSE_ROUND' AND public.int6_enta_valid_text(c->'reason',3,160) IS NOT TRUE THEN RETURN FALSE; END IF;
 IF kind='CREATE_GRANT' AND (jsonb_typeof(c->'role') IS DISTINCT FROM 'string' OR c->>'role' NOT IN ('JUDGE','ACTOR')) OR kind='ROTATE_GRANT' AND public.int5b_json_integer(c->'expectedGeneration',1,2000000000) IS NOT TRUE OR kind IN ('CREATE_GRANT','ROTATE_GRANT') AND public.int5b_json_integer(c->'durationSeconds',1,600) IS NOT TRUE THEN RETURN FALSE; END IF;
 IF kind='APPEND' THEN stroke:=c->'stroke';
  IF public.int6_enta_exact_keys(stroke,ARRAY['id','color','width','erase','points']) IS NOT TRUE OR NOT public.int8_json_id(stroke->'id') OR jsonb_typeof(stroke->'color') IS DISTINCT FROM 'string' OR stroke->>'color' NOT IN ('#191615','#ffffff','#ff2e95','#3478bd','#267448') OR stroke->'width' NOT IN ('2'::JSONB,'5'::JSONB,'10'::JSONB) OR jsonb_typeof(stroke->'erase') IS DISTINCT FROM 'boolean' OR jsonb_typeof(stroke->'points') IS DISTINCT FROM 'array' OR jsonb_array_length(stroke->'points') NOT BETWEEN 1 AND 256 THEN RETURN FALSE; END IF;
  FOR pt IN SELECT value FROM jsonb_array_elements(stroke->'points') LOOP IF jsonb_typeof(pt) IS DISTINCT FROM 'array' OR jsonb_array_length(pt)<>2 OR public.int5b_json_integer(pt->0,0,10000) IS NOT TRUE OR public.int5b_json_integer(pt->1,0,10000) IS NOT TRUE THEN RETURN FALSE; END IF; END LOOP;
 END IF; RETURN TRUE;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN RETURN FALSE;
END $$;

CREATE FUNCTION public.int8_apply(ns TEXT,project TEXT,uid TEXT,token_hash TEXT,game_id TEXT,expected_version INTEGER,c JSONB,nxt JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE old JSONB; settled JSONB; authoritative JSONB; e JSONB; r JSONB; nr JSONB; gr JSONB; scope JSONB; cv JSONB; post JSONB; prior_event JSONB; kind TEXT; rid TEXT; moment DOUBLE PRECISION; event_count INTEGER; identity_id TEXT; rejection TEXT; tuple RECORD;
BEGIN
 PERFORM public.int8_namespace(ns,project); IF (uid IS NULL)=(token_hash IS NULL) THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
 IF uid IS NOT NULL THEN old:=public.int8_owner_load(ns,project,uid,game_id,TRUE); ELSE old:=public.int8_grant_load(ns,project,game_id,token_hash); END IF;
 IF old IS NULL THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
 IF NOT public.int8_state_shape(old) OR NOT public.int8_state_shape(nxt) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 -- Complete locks have been acquired; this is the authoritative final sample.
 moment:=floor(extract(epoch FROM clock_timestamp())*1000);
 IF token_hash IS NOT NULL THEN
  SELECT x INTO gr FROM jsonb_array_elements(old->'grants') x WHERE x->>'tokenHash'=token_hash;
  IF gr IS NULL OR gr->'revoked'='true'::JSONB OR (gr->>'expiresAt')::DOUBLE PRECISION<=moment OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old->'grantScopes') x WHERE x->'activeGrantId'=gr->'id' AND x->'generation'=gr->'generation' AND x->'assignmentId'=gr->'assignmentId' AND x->'role'=gr->'role' AND x->'roundId'=gr->'roundId') THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
 END IF;
 -- Existing same-parent children are authorized before duplicate lookup; phase
 -- and unused-item restrictions belong AFTER exact duplicate recovery.
 IF c IS NOT NULL AND c<>'null'::JSONB THEN
  IF public.int8_valid_command(c,token_hash IS NOT NULL) IS NOT TRUE THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  IF c ? 'roundId' AND NOT EXISTS(SELECT 1 FROM public."GameRound" WHERE "gameId"=game_id AND "id"=c->>'roundId') OR c ? 'teamId' AND c->>'teamId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Team" WHERE "gameId"=game_id AND "id"=c->>'teamId') OR c ? 'itemId' AND c->>'itemId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."RoundItemPin" i JOIN public."GameRound" rr ON rr."id"=i."roundId" WHERE rr."gameId"=game_id AND rr."id"=c->>'roundId' AND i."itemId"=c->>'itemId') OR c ? 'scopeId' AND NOT EXISTS(SELECT 1 FROM public."RoundGrantScope" WHERE "gameId"=game_id AND "roundId"=c->>'roundId' AND "id"=c->>'scopeId') THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
  SELECT x INTO prior_event FROM jsonb_array_elements(old->'events') x WHERE x->>'commandId'=c->>'commandId';
  IF prior_event IS NOT NULL THEN IF prior_event->>'hash' IS DISTINCT FROM public.int6_enta_hash(c) OR gr IS NOT NULL AND prior_event->>'roundId' IS DISTINCT FROM gr->>'roundId' THEN PERFORM public.int6_enta_error('COMMAND_KEY_CONFLICT'); END IF; RETURN jsonb_build_object('game',old,'rejection',NULL); END IF;
 END IF;
 settled:=public.int8_clock(old,moment); rejection:=settled->>'rejection';
 IF rejection IS NOT NULL THEN authoritative:=settled->'game';
 ELSE
  IF c IS NULL OR c='null'::JSONB THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  IF (old->>'version')::INTEGER<>expected_version THEN PERFORM public.int6_enta_error('STALE_VERSION'); END IF;
  authoritative:=public.int8_reduce(old,c,nxt,moment,gr);
  IF NOT public.int8_state_shape(authoritative) OR public.int8_compare(nxt) IS DISTINCT FROM public.int8_compare(authoritative) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 END IF;
 event_count:=jsonb_array_length(old->'events'); e:=authoritative->'events'->event_count; kind:=e->>'type'; rid:=e->>'roundId';
 SELECT x INTO nr FROM jsonb_array_elements(authoritative->'rounds') x WHERE x->>'id'=rid;
 INSERT INTO public."RoundAuthorityEvent"("id","gameId","ownerIdentityId","roundId","commandId","sequence","type","intentHash","authorityKind","authorityGrantId","authorityGeneration","assignmentId","systemOperation","pauseReason","at") VALUES(e->>'id',game_id,old->>'identityId',rid,e->>'commandId',(e->>'sequence')::INTEGER,kind,e->>'hash',e->'authority'->>'kind',e->'authority'->>'grantId',(e->'authority'->>'generation')::INTEGER,e->'authority'->>'assignmentId',e->'authority'->>'operation',e->>'pauseReason',to_timestamp(moment/1000));
 IF jsonb_array_length(authoritative->'postings')>jsonb_array_length(old->'postings') THEN
  post:=authoritative->'postings'->(jsonb_array_length(old->'postings')); INSERT INTO public."RoundScorePosting"("id","gameId","roundId","itemId","eventId","teamId","delta","before","after","rulesVersion") VALUES(post->>'id',game_id,rid,post->>'itemId',post->>'eventId',post->>'teamId',(post->>'delta')::INTEGER,(post->>'before')::INTEGER,(post->>'after')::INTEGER,'enta-format-1'); UPDATE public."Team" SET "score"=(post->>'after')::INTEGER WHERE "id"=post->>'teamId' AND "gameId"=game_id;
 END IF;
 IF kind='ASSIGN_ACTOR' THEN INSERT INTO public."RoundActorAssignment"("id","gameId","roundId","teamId","playerIndex","itemId","generation") VALUES(nr->'assignment'->>'id',game_id,rid,nr->'assignment'->>'teamId',(nr->'assignment'->>'playerIndex')::INTEGER,nr->'assignment'->>'itemId',(nr->'assignment'->>'generation')::INTEGER); END IF;
 FOR scope IN SELECT x FROM jsonb_array_elements(authoritative->'grantScopes') x LOOP
  IF NOT EXISTS(SELECT 1 FROM public."GameRound" WHERE "gameId"=game_id AND "id"=scope->>'roundId') THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  INSERT INTO public."RoundGrantScope"("id","gameId","roundId","role","assignmentId","generation","activeGrantId") VALUES(scope->>'id',game_id,scope->>'roundId',scope->>'role',scope->>'assignmentId',(scope->>'generation')::INTEGER,scope->>'activeGrantId') ON CONFLICT("id") DO UPDATE SET "generation"=EXCLUDED."generation","activeGrantId"=EXCLUDED."activeGrantId" WHERE "RoundGrantScope"."gameId"=game_id AND "RoundGrantScope"."roundId"=EXCLUDED."roundId";
 END LOOP;
 FOR gr IN SELECT x FROM jsonb_array_elements(authoritative->'grants') x LOOP
  INSERT INTO public."RoundGrant"("id","gameId","scopeId","roundId","role","assignmentId","generation","tokenHash","expiresAt","revoked") VALUES(gr->>'id',game_id,gr->>'scopeId',gr->>'roundId',gr->>'role',gr->>'assignmentId',(gr->>'generation')::INTEGER,gr->>'tokenHash',to_timestamp((gr->>'expiresAt')::DOUBLE PRECISION/1000),(gr->>'revoked')::BOOLEAN) ON CONFLICT("id") DO UPDATE SET "revoked"=EXCLUDED."revoked" WHERE "RoundGrant"."gameId"=game_id;
 END LOOP;
 -- Exact derived collection means no new foreign entries. Write only current
 -- authorized canvas; round/game predicate remains present at the physical sink.
 IF kind IN ('CANVAS_APPEND','CANVAS_UNDO','CANVAS_REDO','CANVAS_CLEAR') THEN
  SELECT x INTO cv FROM jsonb_array_elements(authoritative->'canvases') x WHERE x->>'roundId'=rid;
  IF NOT EXISTS(SELECT 1 FROM public."GameRound" WHERE "id"=rid AND "gameId"=game_id) THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  INSERT INTO public."DrawingCanvasState"("roundId","revision","state") VALUES(rid,(cv->>'revision')::INTEGER,cv) ON CONFLICT("roundId") DO UPDATE SET "revision"=EXCLUDED."revision","state"=EXCLUDED."state" WHERE EXISTS(SELECT 1 FROM public."GameRound" rr WHERE rr."id"="DrawingCanvasState"."roundId" AND rr."gameId"=game_id);
 END IF;
 IF nr IS NOT NULL AND nr IS DISTINCT FROM (SELECT x FROM jsonb_array_elements(old->'rounds') x WHERE x->>'id'=rid) THEN
  UPDATE public."GameRound" SET "state"=nr WHERE "gameId"=game_id AND "id"=rid;
  UPDATE public."GameQuestion" SET "isOpened"=(nr->>'state'<>'READY'),"isCorrect"=CASE WHEN nr->>'state'='RESOLVED' THEN COALESCE((c->>'correct')::BOOLEAN,FALSE) ELSE NULL END,"answeredByTeamId"=CASE WHEN kind='ADJUDICATE_ROUND' AND c->'correct'='true'::JSONB THEN c->>'teamId' ELSE NULL END WHERE "gameId"=game_id AND "id"=nr->>'questionId';
 END IF;
 UPDATE public."EntaExecutionPin" SET "state"=authoritative WHERE "gameId"=game_id;
 UPDATE public."GameRuntime" SET "version"=(authoritative->>'version')::INTEGER,"activeRoundId"=authoritative->>'activeRoundId',"turnIndex"=(authoritative->>'turnIndex')::INTEGER,"state"=CASE WHEN authoritative->'finished'='true'::JSONB THEN 'FINISHED' ELSE 'BOARD' END,"resultReason"=CASE WHEN authoritative->'finished'='true'::JSONB THEN CASE WHEN authoritative->>'resultReason'='HOST_ENDED' THEN 'HOST_ENDED' ELSE 'ALL_QUESTIONS_PLAYED' END ELSE NULL END,"unplayedCount"=CASE WHEN authoritative->'finished'='true'::JSONB THEN (SELECT count(*) FROM jsonb_array_elements(authoritative->'rounds') x WHERE x->>'state'<>'RESOLVED') ELSE 0 END,"updatedAt"=to_timestamp(moment/1000) WHERE "gameId"=game_id;
 IF authoritative->'finished'='true'::JSONB THEN UPDATE public."Game" SET "status"='FINISHED',"finishedAt"=to_timestamp(moment/1000) AT TIME ZONE 'UTC',"winnerTeamId"=(SELECT CASE WHEN count(*)=1 THEN min("id") ELSE NULL END FROM public."Team" WHERE "gameId"=game_id AND "score"=(SELECT max("score") FROM public."Team" WHERE "gameId"=game_id)),"isTie"=((SELECT count(*) FROM public."Team" WHERE "gameId"=game_id AND "score"=(SELECT max("score") FROM public."Team" WHERE "gameId"=game_id))>1) WHERE "id"=game_id; END IF;
 RETURN jsonb_build_object('game',authoritative,'rejection',rejection);
END $$;

-- Frozen v2/v3 bodies remain byte-preserved in their original migrations. New
-- source-only definitions add only explicit format dispatch at this boundary.
CREATE OR REPLACE FUNCTION public.int6_enta_game_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE a public."Admission"%ROWTYPE;
BEGIN
 IF NEW."executionFormat"<>'TIER_BOARD' THEN
 SELECT * INTO a FROM public."Admission" WHERE "id"=NEW."admissionId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 IF NOT FOUND OR NEW."gameFormat"<>'FIREBASE_PINNED' OR NEW."userId" IS NOT NULL OR a."state"<>'HELD' OR a."engine"<>'ENTA' OR a."requestVersion"<>4 OR a."mode" IS DISTINCT FROM NEW."mode" OR a."operation" IS DISTINCT FROM (CASE NEW."executionFormat" WHEN 'MIXED_BOARD' THEN 'PAID_ENTA_CLASSIC' WHEN 'STANDALONE_LIST' THEN 'PAID_ENTA_LIST' WHEN 'STANDALONE_ACTING' THEN 'PAID_ENTA_ACTING' END) OR a."catalogReleaseId" IS DISTINCT FROM NEW."catalogReleaseId" OR a."releaseRootHash" IS DISTINCT FROM NEW."catalogReleaseRootHash" OR a."validationReceiptId" IS DISTINCT FROM NEW."validationReceiptId" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; PERFORM public.int8_assert_format((SELECT "id" FROM public."EntaFormatRelease" WHERE "receiptId"=a."validationReceiptId" AND "baseReleaseId"=a."catalogReleaseId" AND "baseRoot"=a."releaseRootHash" AND "sealedAt" IS NOT NULL)); RETURN NEW; END IF;

 IF NEW."gameFormat"<>'FIREBASE_PINNED' OR NEW."userId" IS NOT NULL OR NEW."mode" NOT IN ('CLASSIC','KIDS') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=NEW."admissionId" AND "firebaseIdentityId"=NEW."firebaseIdentityId";
 IF NOT FOUND OR a."state"<>'HELD' OR a."engine"<>'ENTA' OR a."mode" IS DISTINCT FROM NEW."mode" OR a."operation" IS DISTINCT FROM (CASE WHEN NEW."mode"='KIDS' THEN 'PAID_ENTA_KIDS' ELSE 'PAID_ENTA_CLASSIC' END) OR a."requestVersion" NOT IN (2,3) OR (a."requestVersion"=2 AND NEW."mode"<>'CLASSIC')
 OR a."catalogReleaseId" IS DISTINCT FROM NEW."catalogReleaseId" OR a."releaseRootHash" IS DISTINCT FROM NEW."catalogReleaseRootHash" OR a."validationReceiptId" IS DISTINCT FROM NEW."validationReceiptId" THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF a."requestVersion"=2 THEN PERFORM public.int6_enta_assert_receipt(a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash"); ELSE PERFORM public.int7_enta_assert_receipt(a."validationReceiptId",a."catalogReleaseId",a."releaseRootHash",a."mode"); END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.int6_enta_runtime_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; i INTEGER; names TEXT[];
BEGIN
 SELECT * INTO g FROM public."Game" WHERE "id"=CASE WHEN TG_OP='DELETE' THEN OLD."gameId" ELSE NEW."gameId" END;
 IF g."executionFormat"<>'TIER_BOARD' THEN
 IF TG_OP='DELETE' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF TG_OP='UPDATE' THEN IF (NEW."gameId",NEW."setup",NEW."setupHash",NEW."teamOrder",NEW."createdAt") IS DISTINCT FROM (OLD."gameId",OLD."setup",OLD."setupHash",OLD."teamOrder",OLD."createdAt") OR OLD."state"='FINISHED' OR NEW."version"<>OLD."version"+1 OR NEW."turnIndex"<OLD."turnIndex" OR NEW."turnIndex">OLD."turnIndex"+1 THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF a."state" IS DISTINCT FROM 'HELD' OR a."requestVersion"<>4 OR NEW."version"<>1 OR NEW."state"<>'BOARD' OR NEW."turnIndex"<>0 OR NEW."setupHash"<>public.int6_enta_hash(NEW."setup") OR NOT EXISTS(SELECT 1 FROM public."EntaExecutionPin" p WHERE p."gameId"=g."id" AND p."clientBinding"->'setup'=NEW."setup" AND public.int8_valid_request(p."clientBinding")) OR cardinality(NEW."teamOrder")<>(SELECT count(*) FROM public."Team" WHERE "gameId"=g."id") OR (SELECT count(DISTINCT id) FROM unnest(NEW."teamOrder") id)<>cardinality(NEW."teamOrder") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 FOR i IN 1..cardinality(NEW."teamOrder") LOOP IF (SELECT "name" FROM public."Team" WHERE "gameId"=g."id" AND "id"=NEW."teamOrder"[i]) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->>'name' OR (SELECT jsonb_agg("name" ORDER BY "id") FROM public."Player" WHERE "teamId"=NEW."teamOrder"[i]) IS DISTINCT FROM NEW."setup"->'teams'->(i-1)->'players' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; END LOOP; RETURN NEW; END IF;

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
CREATE OR REPLACE FUNCTION public.int6_enta_command(ns TEXT,project TEXT,uid TEXT,game_id TEXT,c JSONB,intent_hash TEXT) RETURNS JSONB
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
 INSERT INTO public."GameEvent"("gameId","commandId","sequence","actorFirebaseIdentityId","type","intentHash","questionId","teamId","ruling","resultReason","unplayedCount") VALUES(g."id",c->>'commandId',r."version"+1,identity_id,kind,qid,tid,CASE WHEN kind='ADJUDICATE' THEN c->>'ruling' ELSE NULL END,finish_reason,remaining);
 RETURN jsonb_build_object('commandId',c->>'commandId','type',kind,'sequence',r."version"+1,'intentHash',intent_hash);
END $$;
CREATE OR REPLACE FUNCTION public.int6_enta_load(ns TEXT,project TEXT,uid TEXT,game_id TEXT,lock_game BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; teams JSONB; categories JSONB; questions JSONB;
BEGIN
 PERFORM public.int6_enta_identity(ns,project,uid);
 IF EXISTS(SELECT 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=(public.int6_enta_identity(ns,project,uid)->>'id') AND "executionFormat"<>'TIER_BOARD') THEN PERFORM public.int6_enta_error('MATCH_FORMAT_REQUIRES_V4'); END IF;
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
CREATE OR REPLACE FUNCTION public.int7_enta_load(ns TEXT,project TEXT,uid TEXT,game_id TEXT,lock_game BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; g public."Game"%ROWTYPE; r public."GameRuntime"%ROWTYPE; teams JSONB; categories JSONB; questions JSONB;
BEGIN
 PERFORM public.int6_enta_identity(ns,project,uid);
 IF EXISTS(SELECT 1 FROM public."Game" WHERE "id"=game_id AND "firebaseIdentityId"=(public.int6_enta_identity(ns,project,uid)->>'id') AND "executionFormat"<>'TIER_BOARD') THEN PERFORM public.int6_enta_error('MATCH_FORMAT_REQUIRES_V4'); END IF;
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
CREATE FUNCTION public.int8_complete_start() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; p public."EntaExecutionPin"%ROWTYPE; r public."GameRuntime"%ROWTYPE; count_rounds INTEGER; BEGIN
 SELECT * INTO g FROM public."Game" WHERE "id"=NEW."id"; IF g."gameFormat"<>'FIREBASE_PINNED' OR g."executionFormat"='TIER_BOARD' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId"; SELECT * INTO p FROM public."EntaExecutionPin" WHERE "gameId"=g."id"; SELECT * INTO r FROM public."GameRuntime" WHERE "gameId"=g."id";
 SELECT count(*) INTO count_rounds FROM public."GameRound" WHERE "gameId"=g."id";
 IF a."state" IS DISTINCT FROM 'COMMITTED' OR a."requestVersion"<>4 OR a."engine"<>'ENTA' OR a."mode"<>g."mode" OR a."catalogReleaseId"<>g."catalogReleaseId" OR a."releaseRootHash"<>g."catalogReleaseRootHash" OR a."validationReceiptId"<>g."validationReceiptId" OR a."predecessorAdmissionId" IS NOT NULL OR p."gameId" IS NULL OR r."gameId" IS NULL OR p."executionFormat"<>g."executionFormat" OR NOT public.int8_valid_request(p."clientBinding") OR p."clientHash"<>public.int6_enta_hash(p."clientBinding") OR p."intentHash"<>public.int6_enta_hash(p."fullIntent") OR p."clientHash"<>a."requestHash" OR p."intentHash"<>a."intentHash" OR p."fullIntent"->'request'<>p."clientBinding" OR r."setup"<>p."clientBinding"->'setup' OR r."setupHash"<>public.int6_enta_hash(r."setup") OR count_rounds NOT BETWEEN 1 AND 36 OR count_rounds<>(p."fullIntent"->>'roundCount')::INTEGER OR count_rounds<>(SELECT count(*) FROM public."GameQuestion" WHERE "gameId"=g."id") OR (g."executionFormat"<>'MIXED_BOARD' AND (count_rounds NOT BETWEEN 1 AND 4 OR cardinality(r."teamOrder")<>2)) OR (SELECT count(*) FROM public."GameCategoryPin" WHERE "gameId"=g."id")<>(CASE WHEN g."executionFormat"='MIXED_BOARD' THEN 6 ELSE 1 END) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF p."fullIntent"->>'pinsHash'<>public.int6_enta_hash((SELECT jsonb_agg("pin" ORDER BY "ordinal") FROM public."GameRound" WHERE "gameId"=g."id")) OR EXISTS(SELECT 1 FROM public."GameRound" rr WHERE rr."gameId"=g."id" AND rr."pin" IS DISTINCT FROM public.int8_prompt_pin(rr."formatId")) OR EXISTS(SELECT 1 FROM generate_series(0,count_rounds-1) n WHERE NOT EXISTS(SELECT 1 FROM public."GameRound" rr WHERE rr."gameId"=g."id" AND rr."ordinal"=n)) OR EXISTS(SELECT 1 FROM public."GameRound" rr WHERE rr."gameId"=g."id" AND (SELECT count(*) FROM public."RoundItemPin" i WHERE i."roundId"=rr."id")<>jsonb_array_length(rr."pin"->'items')) OR (SELECT count(DISTINCT ("sourceNamespace","sourceId")) FROM public."GameRound" WHERE "gameId"=g."id")<>count_rounds THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public."GameEvent" e WHERE e."gameId"=g."id" AND e."sequence"=1 AND e."type"='START' AND e."actorFirebaseIdentityId"=g."firebaseIdentityId" AND e."commandId"=a."requestKey" AND e."intentHash"=a."intentHash") OR NOT EXISTS(SELECT 1 FROM public."Reservation" rr WHERE rr."admissionId"=a."id" AND rr."state"='COMMITTED' AND EXISTS(SELECT 1 FROM public."WalletEntry" e WHERE e."reservationId"=rr."id" AND e."walletId"=a."walletId" AND e."effect"='RESERVE') AND EXISTS(SELECT 1 FROM public."WalletEntry" e WHERE e."reservationId"=rr."id" AND e."walletId"=a."walletId" AND e."effect"='COMMIT')) OR EXISTS(SELECT 1 FROM public."GameCategory" WHERE "gameId"=g."id") OR EXISTS(SELECT 1 FROM public."EntaRematchLink" WHERE "childGameId"=g."id") THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF g."executionFormat"<>'MIXED_BOARD' AND (SELECT count(*) FROM public."EntaSourceExposure" WHERE "gameId"=g."id")<>count_rounds THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 PERFORM public.int8_assert_stored(g."id"); RETURN NULL;
END $$;
-- Existing fixed CLASSIC financial completeness stays exact for TIER_BOARD;
-- v4 invokes equally restrictive same-owner/runtime/pins/ledger final checking.
DROP TRIGGER "Game_financial_start_completeness" ON public."Game";
CREATE CONSTRAINT TRIGGER "Game_financial_start_completeness" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."executionFormat"='TIER_BOARD' AND NEW."mode" IS DISTINCT FROM 'KIDS') EXECUTE FUNCTION public.int5a_game_start_completeness();
CREATE CONSTRAINT TRIGGER "Game_E3_complete_start" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int8_complete_start();
CREATE FUNCTION public.int8_pin_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE game_id TEXT; g public."Game"%ROWTYPE; BEGIN
 IF TG_TABLE_NAME='EntaExecutionPin' THEN game_id:=NEW."gameId"; IF TG_OP='UPDATE' THEN IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='GameRound' THEN game_id:=NEW."gameId"; IF TG_OP='UPDATE' THEN IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD."state"->>'state'='RESOLVED' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW; END IF;
 ELSE SELECT "gameId" INTO game_id FROM public."GameRound" WHERE "id"=NEW."roundId"; END IF;
 IF TG_OP<>'INSERT' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; SELECT * INTO g FROM public."Game" WHERE "id"=game_id FOR UPDATE;
 IF g."executionFormat"='TIER_BOARD' OR NOT EXISTS(SELECT 1 FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId" AND "state"='HELD' AND "requestVersion"=4) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; RETURN NEW;
END $$;
CREATE TRIGGER "EntaExecutionPin_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."EntaExecutionPin" FOR EACH ROW EXECUTE FUNCTION public.int8_pin_guard();
CREATE TRIGGER "GameRound_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."GameRound" FOR EACH ROW EXECUTE FUNCTION public.int8_pin_guard();
CREATE TRIGGER "RoundItemPin_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."RoundItemPin" FOR EACH ROW EXECUTE FUNCTION public.int8_pin_guard();
CREATE TRIGGER "EntaSourceExposure_immutable" BEFORE UPDATE OR DELETE ON public."EntaSourceExposure" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "RoundAuthorityEvent_immutable" BEFORE UPDATE OR DELETE ON public."RoundAuthorityEvent" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "RoundScorePosting_immutable" BEFORE UPDATE OR DELETE ON public."RoundScorePosting" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "EntaFormatRelease_no_delete" BEFORE DELETE OR TRUNCATE ON public."EntaFormatRelease" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "MediaObjectProof_no_delete" BEFORE DELETE OR TRUNCATE ON public."MediaObjectProof" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
-- Dedicated trusted executor only. Runtime gets fixed function EXECUTE, never
-- table DML or editorial/format/media authoring. Original financial ACLs remain.
GRANT SELECT ON public."EntaFormatRelease",public."EntaFormatRevision",public."EntaFormatItem",public."MediaObjectProof",public."MediaChunkProof",public."EntaFormatMedia",public."EntaFormatCover",public."EntaExecutionPin",public."EntaSourceExposure",public."GameRound",public."RoundItemPin",public."RoundAuthorityEvent",public."RoundScorePosting",public."RoundGrantScope",public."RoundGrant",public."DrawingCanvasState" TO enta_finance_executor;
GRANT INSERT ON public."EntaExecutionPin",public."EntaSourceExposure",public."GameRound",public."RoundItemPin",public."RoundAuthorityEvent",public."RoundScorePosting",public."RoundGrantScope",public."RoundGrant",public."DrawingCanvasState" TO enta_finance_executor;
GRANT UPDATE("state") ON public."EntaExecutionPin",public."GameRound" TO enta_finance_executor;
GRANT UPDATE("activeRoundId") ON public."GameRuntime" TO enta_finance_executor;
GRANT UPDATE("generation","activeGrantId") ON public."RoundGrantScope" TO enta_finance_executor;
GRANT UPDATE("revoked") ON public."RoundGrant" TO enta_finance_executor;
GRANT UPDATE("revision","state") ON public."DrawingCanvasState" TO enta_finance_executor;

CREATE FUNCTION public.int8_put_round(s JSONB,r JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_set(s,'{rounds}',(SELECT jsonb_agg(CASE WHEN x->'id'=r->'id' THEN r ELSE x END ORDER BY n) FROM jsonb_array_elements(s->'rounds') WITH ORDINALITY a(x,n))) $$;
CREATE FUNCTION public.int8_invalidate(s JSONB,rid TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_set(jsonb_set(s,'{grants}',(SELECT COALESCE(jsonb_agg(CASE WHEN x->>'roundId'=rid THEN jsonb_set(x,'{revoked}','true'::JSONB) ELSE x END ORDER BY n),'[]'::JSONB) FROM jsonb_array_elements(s->'grants') WITH ORDINALITY a(x,n))),'{grantScopes}',(SELECT COALESCE(jsonb_agg(CASE WHEN x->>'roundId'=rid THEN jsonb_set(x,'{activeGrantId}','null'::JSONB) ELSE x END ORDER BY n),'[]'::JSONB) FROM jsonb_array_elements(s->'grantScopes') WITH ORDINALITY a(x,n))) $$;
CREATE FUNCTION public.int8_close(s JSONB,r JSONB,reason TEXT) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ BEGIN
 r:=r||jsonb_build_object('state','RESOLVED','reason',reason,'version',(r->>'version')::INTEGER+1,'turnDeadline',NULL,'overallDeadline',NULL,'remainingTurn',NULL,'remainingOverall',NULL);
 s:=public.int8_put_round(s,r)||jsonb_build_object('activeRoundId',NULL,'turnIndex',(s->>'turnIndex')::INTEGER+1); RETURN public.int8_invalidate(s,r->>'id');
END $$;
CREATE FUNCTION public.int8_add_event(s JSONB,event_id TEXT,command_id TEXT,intent_hash TEXT,kind TEXT,rid TEXT,authority JSONB,moment DOUBLE PRECISION,pause_reason TEXT) RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$ SELECT s||jsonb_build_object('version',(s->>'version')::INTEGER+1,'events',s->'events'||jsonb_build_array(jsonb_build_object('id',event_id,'commandId',command_id,'hash',intent_hash,'sequence',(s->>'version')::INTEGER+1,'type',kind,'roundId',rid,'authority',authority,'at',moment,'pauseReason',pause_reason))) $$;
CREATE FUNCTION public.int8_clock(s JSONB,moment DOUBLE PRECISION) RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE r JSONB; duration INTEGER; elapsed INTEGER; team_index INTEGER; kind TEXT; BEGIN
 SELECT x INTO r FROM jsonb_array_elements(s->'rounds') x WHERE x->'id'=s->'activeRoundId';
 IF r IS NULL OR r->>'state'<>'RUNNING' OR r->'pin'->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS') THEN RETURN jsonb_build_object('game',s,'rejection',NULL); END IF;
 IF (r->>'overallDeadline')::DOUBLE PRECISION<=moment OR s->'request'->>'executionFormat'='MIXED_BOARD' AND (r->>'turnDeadline')::DOUBLE PRECISION<=moment THEN s:=public.int8_close(s,r,'TIME_EXPIRED'); kind:='TIME_EXPIRED';
 ELSIF (r->>'turnDeadline')::DOUBLE PRECISION<=moment THEN
 duration:=(s->'request'->'setup'->'rules'->>'turnSeconds')::INTEGER*1000; elapsed:=floor((moment-(r->>'turnDeadline')::DOUBLE PRECISION)/duration)::INTEGER+1;
 SELECT (n-1)::INTEGER INTO team_index FROM jsonb_array_elements(s->'teams') WITH ORDINALITY a(x,n) WHERE x->'id'=r->'scoringTeamId';
 r:=r||jsonb_build_object('scoringTeamId',s->'teams'->((team_index+elapsed)%jsonb_array_length(s->'teams'))->'id','turnDeadline',(r->>'turnDeadline')::DOUBLE PRECISION+elapsed*duration,'version',(r->>'version')::INTEGER+1,'assignment',NULL);
 s:=public.int8_invalidate(public.int8_put_round(s,r),r->>'id'); kind:='TURN_EXPIRED';
 ELSE RETURN jsonb_build_object('game',s,'rejection',NULL); END IF;
 s:=public.int8_add_event(s,gen_random_uuid()::TEXT,'clock-'||(r->>'id')||'-'||(s->>'version'),public.int6_enta_hash(jsonb_build_object('roundId',r->>'id','version',s->'version','moment',moment)),kind,r->>'id',jsonb_build_object('kind','SYSTEM','operation','CLOCK_SETTLEMENT'),moment,NULL);
 RETURN jsonb_build_object('game',s,'rejection','ROUND_TIME_EXPIRED');
END $$;
CREATE FUNCTION public.int8_state_shape(s JSONB) RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$ DECLARE x JSONB; y JSONB; BEGIN
 IF NOT public.int6_enta_exact_keys(s,ARRAY['id','identityId','projectId','hostUid','admissionId','request','clientHash','intent','intentHash','version','finished','activeRoundId','turnIndex','resultReason','teams','categories','rounds','events','postings','grants','grantScopes','canvases']) OR NOT public.int5b_json_integer(s->'version',1,2000000000) OR jsonb_typeof(s->'finished')<>'boolean' OR NOT public.int8_valid_request(s->'request') THEN RETURN FALSE; END IF;
 FOREACH x IN ARRAY ARRAY[s->'teams',s->'categories',s->'rounds',s->'events',s->'postings',s->'grants',s->'grantScopes',s->'canvases'] LOOP IF jsonb_typeof(x)<>'array' THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'grants') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','scopeId','roundId','role','assignmentId','generation','tokenHash','expiresAt','revoked']) OR x->>'tokenHash'!~'^[a-f0-9]{64}$' OR x->>'role' NOT IN ('JUDGE','ACTOR') OR jsonb_typeof(x->'expiresAt')<>'number' OR jsonb_typeof(x->'revoked')<>'boolean' OR NOT public.int5b_json_integer(x->'generation',1,2000000000) THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'grantScopes') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','roundId','role','assignmentId','generation','activeGrantId']) OR NOT public.int5b_json_integer(x->'generation',0,2000000000) OR x->>'role' NOT IN ('JUDGE','ACTOR') THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'events') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','commandId','hash','sequence','type','roundId','authority','at','pauseReason']) OR x->>'hash'!~'^[a-f0-9]{64}$' OR jsonb_typeof(x->'at')<>'number' OR NOT public.int5b_json_integer(x->'sequence',1,2000000000) THEN RETURN FALSE; END IF;
 IF (CASE x->'authority'->>'kind' WHEN 'HOST' THEN NOT public.int6_enta_exact_keys(x->'authority',ARRAY['kind','identityId']) WHEN 'GRANT' THEN NOT public.int6_enta_exact_keys(x->'authority',ARRAY['kind','grantId','generation','assignmentId']) WHEN 'SYSTEM' THEN NOT public.int6_enta_exact_keys(x->'authority',ARRAY['kind','operation']) ELSE TRUE END) THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'rounds') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','questionId','ordinal','pin','state','version','scoringTeamId','turnDeadline','overallDeadline','remainingTurn','remainingOverall','revealed','assignment','consumed','reason']) OR jsonb_typeof(x->'state') IS DISTINCT FROM 'string' OR x->>'state' NOT IN ('READY','RUNNING','PAUSED','RESOLVED') OR NOT public.int5b_json_integer(x->'version',0,2000000000) OR jsonb_typeof(x->'revealed')<>'boolean' OR jsonb_typeof(x->'consumed')<>'array' THEN RETURN FALSE; END IF;
 IF x->'assignment'<>'null'::JSONB AND (NOT public.int6_enta_exact_keys(x->'assignment',ARRAY['id','teamId','playerIndex','itemId','generation']) OR NOT public.int5b_json_integer(x->'assignment'->'playerIndex',0,7) OR NOT public.int5b_json_integer(x->'assignment'->'generation',1,2000000000)) THEN RETURN FALSE; END IF;
 FOR y IN SELECT value FROM jsonb_array_elements(x->'consumed') LOOP IF NOT public.int6_enta_exact_keys(y,ARRAY['itemId','teamId','eventId']) THEN RETURN FALSE; END IF; END LOOP;
 FOREACH y IN ARRAY ARRAY[x->'turnDeadline',x->'overallDeadline',x->'remainingTurn',x->'remainingOverall'] LOOP IF jsonb_typeof(y) NOT IN ('null','number') THEN RETURN FALSE; END IF; END LOOP; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'canvases') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['roundId','revision','strokes','visibleIds','redoIds','cumulativePoints','mutations','receipts']) OR NOT public.int5b_json_integer(x->'revision',0,512) OR NOT public.int5b_json_integer(x->'cumulativePoints',0,8192) OR NOT public.int5b_json_integer(x->'mutations',0,512) OR jsonb_typeof(x->'strokes')<>'array' OR jsonb_array_length(x->'strokes')>128 THEN RETURN FALSE; END IF; FOR y IN SELECT value FROM jsonb_array_elements(x->'strokes') LOOP IF NOT public.int6_enta_exact_keys(y,ARRAY['id','color','width','erase','points']) THEN RETURN FALSE; END IF; END LOOP; END LOOP;

 FOR x IN SELECT value FROM jsonb_array_elements(s->'teams') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','name','players','score']) OR NOT public.int5b_json_integer(x->'score',-2147483648,2147483647) OR jsonb_typeof(x->'players')<>'array' THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'categories') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['key','label','format','cover']) THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'postings') LOOP IF NOT public.int6_enta_exact_keys(x,ARRAY['id','eventId','roundId','itemId','teamId','delta','before','after','rulesVersion']) OR x->>'rulesVersion'<>'enta-format-1' OR NOT public.int5b_json_integer(x->'delta',-2147483648,2147483647) OR NOT public.int5b_json_integer(x->'before',-2147483648,2147483647) OR NOT public.int5b_json_integer(x->'after',-2147483648,2147483647) THEN RETURN FALSE; END IF; END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(s->'canvases') LOOP
  IF jsonb_typeof(x->'visibleIds')<>'array' OR jsonb_typeof(x->'redoIds')<>'array' OR jsonb_typeof(x->'receipts')<>'array' OR jsonb_array_length(x->'receipts')<>(x->>'revision')::INTEGER OR (x->>'revision')::INTEGER<>(x->>'mutations')::INTEGER OR (SELECT count(DISTINCT z->>'commandId') FROM jsonb_array_elements(x->'receipts') z)<>jsonb_array_length(x->'receipts') OR (SELECT COALESCE(sum(jsonb_array_length(z->'points')),0) FROM jsonb_array_elements(x->'strokes') z)<>(x->>'cumulativePoints')::INTEGER OR (SELECT count(DISTINCT z->>'id') FROM jsonb_array_elements(x->'strokes') z)<>jsonb_array_length(x->'strokes') THEN RETURN FALSE; END IF;
  FOR y IN SELECT value FROM jsonb_array_elements(x->'receipts') LOOP IF NOT public.int6_enta_exact_keys(y,ARRAY['commandId','hash','revision']) OR y->>'hash'!~'^[a-f0-9]{64}$' OR NOT public.int5b_json_integer(y->'revision',1,512) THEN RETURN FALSE; END IF; END LOOP;
  FOR y IN SELECT value FROM jsonb_array_elements(x->'strokes') LOOP IF y->>'id'!~'^[A-Za-z0-9_-]{1,128}$' OR y->>'color' NOT IN ('#191615','#ffffff','#ff2e95','#3478bd','#267448') OR y->'width' NOT IN ('2'::JSONB,'5'::JSONB,'10'::JSONB) OR jsonb_typeof(y->'erase')<>'boolean' OR jsonb_typeof(y->'points')<>'array' OR jsonb_array_length(y->'points') NOT BETWEEN 1 AND 256 OR EXISTS(SELECT 1 FROM jsonb_array_elements(y->'points') z WHERE jsonb_typeof(z)<>'array' OR jsonb_array_length(z)<>2 OR NOT public.int5b_json_integer(z->0,0,10000) OR NOT public.int5b_json_integer(z->1,0,10000)) THEN RETURN FALSE; END IF; END LOOP;
 END LOOP;

 FOR x IN SELECT value FROM jsonb_array_elements(s->'rounds') LOOP
  IF x->>'state' IN ('RUNNING','PAUSED') AND (NOT public.int8_json_id(x->'scoringTeamId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'teams') t WHERE t->'id'=x->'scoringTeamId')) THEN RETURN FALSE; END IF;
  IF x->'assignment' IS DISTINCT FROM 'null'::JSONB AND (NOT public.int8_json_id(x->'assignment'->'id') OR NOT public.int8_json_id(x->'assignment'->'teamId') OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'teams') t WHERE t->'id'=x->'assignment'->'teamId' AND t->'players'->(x->'assignment'->>'playerIndex')::INTEGER IS NOT NULL) OR x->'assignment'->'itemId' IS DISTINCT FROM 'null'::JSONB AND NOT public.int8_json_id(x->'assignment'->'itemId')) THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
END $$;
-- Remove only SQL-derived clock values for comparison with the TS proposal.
-- Stored values always come from SQL, never this normalized comparison payload.
CREATE FUNCTION public.int8_compare(s JSONB) RETURNS JSONB LANGUAGE SQL IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_set(jsonb_set(jsonb_set(s,'{rounds}',(SELECT jsonb_agg(x-ARRAY['turnDeadline','overallDeadline','remainingTurn','remainingOverall'] ORDER BY n) FROM jsonb_array_elements(s->'rounds') WITH ORDINALITY a(x,n))),'{events}',(SELECT COALESCE(jsonb_agg(x-'at' ORDER BY n),'[]'::JSONB) FROM jsonb_array_elements(s->'events') WITH ORDINALITY a(x,n))),'{grants}',(SELECT COALESCE(jsonb_agg(x-'expiresAt' ORDER BY n),'[]'::JSONB) FROM jsonb_array_elements(s->'grants') WITH ORDINALITY a(x,n))) $$;
CREATE FUNCTION public.int8_reduce(s JSONB,c JSONB,proposal JSONB,moment DOUBLE PRECISION,"grant" JSONB) RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE kind TEXT:=c->>'type'; rid TEXT:=c->>'roundId'; r JSONB; e JSONB:=proposal->'events'->(jsonb_array_length(proposal->'events')-1); authority JSONB; extra TEXT[]; item JSONB; team JSONB; assignment JSONB; scope JSONB; new_grant JSONB; new_scope BOOLEAN:=FALSE; cv JSONB; stroke JSONB; post JSONB; delta BIGINT; score_before BIGINT; score_after BIGINT; event_id TEXT:=e->>'id'; team_index INTEGER; standalone BOOLEAN:=s->'request'->>'executionFormat'<>'MIXED_BOARD'; duration INTEGER; closes BOOLEAN:=FALSE; pause_reason TEXT;
BEGIN
 IF public.int8_valid_command(c,"grant" IS NOT NULL) IS NOT TRUE THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF event_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 extra:=CASE kind WHEN 'OPEN_ROUND' THEN ARRAY['roundId'] WHEN 'NEXT_ROUND' THEN ARRAY[]::TEXT[] WHEN 'PAUSE_ROUND' THEN ARRAY['roundId','reason'] WHEN 'RESUME_ROUND' THEN ARRAY['roundId'] WHEN 'CLOSE_ROUND' THEN ARRAY['roundId'] WHEN 'REVEAL_TARGET' THEN ARRAY['roundId'] WHEN 'SELECT_SCORING_TEAM' THEN ARRAY['roundId','teamId'] WHEN 'ASSIGN_ACTOR' THEN ARRAY['roundId','teamId','playerIndex','itemId'] WHEN 'JUDGE_ITEM' THEN ARRAY['roundId','itemId'] WHEN 'ADJUDICATE_ROUND' THEN ARRAY['roundId','teamId','correct'] WHEN 'FINISH' THEN ARRAY['confirmEarly'] WHEN 'CREATE_GRANT' THEN ARRAY['roundId','role','durationSeconds'] WHEN 'ROTATE_GRANT' THEN ARRAY['roundId','scopeId','expectedGeneration','durationSeconds'] WHEN 'REVOKE_GRANT' THEN ARRAY['roundId','scopeId'] WHEN 'APPEND' THEN ARRAY['stroke'] WHEN 'UNDO' THEN ARRAY[]::TEXT[] WHEN 'REDO' THEN ARRAY[]::TEXT[] WHEN 'CLEAR' THEN ARRAY[]::TEXT[] ELSE NULL END;
 IF extra IS NULL OR NOT public.int6_enta_exact_keys(c,CASE WHEN "grant" IS NULL THEN ARRAY['type','commandId','expectedVersion'] ELSE ARRAY['type','commandId','expectedRevision'] END||extra) OR c->>'commandId'!~'^[A-Za-z0-9._:-]{8,128}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
 IF "grant" IS NOT NULL THEN IF kind NOT IN ('APPEND','UNDO','REDO','CLEAR') OR "grant"->>'role'<>'ACTOR' THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF; rid:="grant"->>'roundId'; authority:=jsonb_build_object('kind','GRANT','grantId',"grant"->>'id','generation',"grant"->'generation','assignmentId',"grant"->>'assignmentId');
 ELSE IF NOT public.int5b_json_integer(c->'expectedVersion',1,2000000000) OR c->'expectedVersion' IS DISTINCT FROM s->'version' THEN PERFORM public.int6_enta_error('STALE_VERSION'); END IF; authority:=jsonb_build_object('kind','HOST','identityId',s->>'identityId'); END IF;
 IF s->'finished'='true'::JSONB THEN PERFORM public.int6_enta_error('MATCH_FINISHED'); END IF;
 IF kind='NEXT_ROUND' THEN IF NOT standalone THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF; SELECT x INTO r FROM jsonb_array_elements(s->'rounds') x WHERE x->>'state'='READY' ORDER BY (x->>'ordinal')::INTEGER LIMIT 1; IF r IS NULL THEN PERFORM public.int6_enta_error('NO_MORE_ROUNDS'); END IF; rid:=r->>'id'; ELSE SELECT x INTO r FROM jsonb_array_elements(s->'rounds') x WHERE x->>'id'=rid; END IF;
 IF kind IN ('OPEN_ROUND','NEXT_ROUND') THEN
  IF r IS NULL OR s->'activeRoundId'<>'null'::JSONB OR r->>'state'<>'READY' THEN PERFORM public.int6_enta_error('ROUND_UNAVAILABLE'); END IF;
  duration:=CASE WHEN r->'pin'->>'format' IN ('LIST_ITEMS','ACTING_ITEMS') THEN CASE WHEN standalone THEN (s->'request'->'setup'->'rules'->>'turnSeconds')::INTEGER ELSE 40 END ELSE (s->'request'->'setup'->'rules'->>'questionSeconds')::INTEGER END*1000;
  r:=r||jsonb_build_object('state','RUNNING','version',(r->>'version')::INTEGER+1,'scoringTeamId',s->'teams'->((s->>'turnIndex')::INTEGER%jsonb_array_length(s->'teams'))->'id','turnDeadline',moment+duration,'overallDeadline',CASE WHEN standalone AND r->'pin'->>'format' IN ('LIST_ITEMS','ACTING_ITEMS') AND s->'request'->'setup'->'rules'->'overallSeconds'<>'null'::JSONB THEN moment+(s->'request'->'setup'->'rules'->>'overallSeconds')::INTEGER*1000 ELSE NULL END); s:=public.int8_put_round(s,r)||jsonb_build_object('activeRoundId',rid);
 ELSIF kind='FINISH' THEN
  IF s->'activeRoundId'<>'null'::JSONB OR jsonb_typeof(c->'confirmEarly')<>'boolean' OR (EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rounds') x WHERE x->>'state'<>'RESOLVED') AND c->'confirmEarly'<>'true'::JSONB) THEN PERFORM public.int6_enta_error('EARLY_FINISH_CONFIRMATION_REQUIRED'); END IF;
  s:=s||jsonb_build_object('finished',TRUE,'resultReason',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rounds') x WHERE x->>'state'<>'RESOLVED') THEN 'HOST_ENDED' ELSE 'ALL_ROUNDS' END);
  FOR r IN SELECT x FROM jsonb_array_elements(s->'rounds') x LOOP s:=public.int8_invalidate(s,r->>'id'); END LOOP; rid:=NULL;
 ELSE
  IF r IS NULL OR s->>'activeRoundId' IS DISTINCT FROM rid OR r->>'state' NOT IN ('RUNNING','PAUSED') THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF;
  IF kind='RESUME_ROUND' THEN IF r->>'state'<>'PAUSED' THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF;
   r:=r||jsonb_build_object('state','RUNNING','turnDeadline',CASE WHEN r->'remainingTurn'='null'::JSONB THEN NULL ELSE moment+(r->>'remainingTurn')::DOUBLE PRECISION END,'overallDeadline',CASE WHEN r->'remainingOverall'='null'::JSONB THEN NULL ELSE moment+(r->>'remainingOverall')::DOUBLE PRECISION END,'remainingTurn',NULL,'remainingOverall',NULL,'version',(r->>'version')::INTEGER+1); s:=public.int8_put_round(s,r);
  ELSE
   IF r->>'state'<>'RUNNING' THEN PERFORM public.int6_enta_error('ROUND_PAUSED'); END IF;
   IF kind='PAUSE_ROUND' THEN IF NOT public.int6_enta_valid_text(c->'reason',3,160) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; pause_reason:=c->>'reason'; r:=r||jsonb_build_object('state','PAUSED','remainingTurn',CASE WHEN r->'turnDeadline'='null'::JSONB THEN NULL ELSE greatest(0,(r->>'turnDeadline')::DOUBLE PRECISION-moment) END,'remainingOverall',CASE WHEN r->'overallDeadline'='null'::JSONB THEN NULL ELSE greatest(0,(r->>'overallDeadline')::DOUBLE PRECISION-moment) END,'turnDeadline',NULL,'overallDeadline',NULL,'version',(r->>'version')::INTEGER+1); s:=public.int8_put_round(s,r);
   ELSIF kind='SELECT_SCORING_TEAM' THEN IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'teams') x WHERE x->'id'=c->'teamId') THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF; IF standalone OR r->'pin'->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS') THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF; r:=r||jsonb_build_object('scoringTeamId',c->'teamId','version',(r->>'version')::INTEGER+1); s:=public.int8_put_round(s,r);
   ELSIF kind='ASSIGN_ACTOR' THEN
    SELECT x INTO team FROM jsonb_array_elements(s->'teams') x WHERE x->'id'=c->'teamId'; IF NOT public.int5b_json_integer(c->'playerIndex',0,7) OR team->'players'->(c->>'playerIndex')::INTEGER IS NULL OR r->'pin'->>'format' NOT IN ('ACTING_ITEMS','DRAWING_TARGET') OR (r->'pin'->>'format'='DRAWING_TARGET' AND c->'itemId'<>'null'::JSONB) OR (r->'pin'->>'format'='ACTING_ITEMS' AND (c->'itemId'='null'::JSONB OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'consumed') x WHERE x->'itemId'=c->'itemId'))) THEN PERFORM public.int6_enta_error('ASSIGNMENT_UNAVAILABLE'); END IF;
    SELECT x->'assignment' INTO assignment FROM jsonb_array_elements(proposal->'rounds') x WHERE x->>'id'=rid; IF assignment->>'id'!~'^[0-9a-f-]{36}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
    r:=r||jsonb_build_object('assignment',jsonb_build_object('id',assignment->>'id','teamId',c->'teamId','playerIndex',c->'playerIndex','itemId',c->'itemId','generation',(r->>'version')::INTEGER+1),'version',(r->>'version')::INTEGER+1); s:=public.int8_invalidate(public.int8_put_round(s,r),rid);
   ELSIF kind='REVEAL_TARGET' THEN IF r->'pin'->>'format' IN ('LIST_ITEMS','ACTING_ITEMS') OR r->'revealed'='true'::JSONB THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF; r:=r||jsonb_build_object('revealed',TRUE,'version',(r->>'version')::INTEGER+1); s:=public.int8_invalidate(public.int8_put_round(s,r),rid);
   ELSIF kind IN ('JUDGE_ITEM','ADJUDICATE_ROUND','CLOSE_ROUND') THEN
    IF kind IN ('JUDGE_ITEM','CLOSE_ROUND') AND r->'pin'->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS') OR kind='ADJUDICATE_ROUND' AND (r->'pin'->>'format' IN ('LIST_ITEMS','ACTING_ITEMS') OR r->'revealed'<>'true'::JSONB OR jsonb_typeof(c->'correct')<>'boolean' OR (c->'correct'='true'::JSONB)=(c->'teamId'='null'::JSONB)) THEN PERFORM public.int6_enta_error('INVALID_PHASE'); END IF;
    r:=r||jsonb_build_object('version',(r->>'version')::INTEGER+1);
    IF kind='JUDGE_ITEM' THEN SELECT x INTO item FROM jsonb_array_elements(r->'pin'->'items') x WHERE x->'id'=c->'itemId'; IF item IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'consumed') x WHERE x->'itemId'=c->'itemId') THEN PERFORM public.int6_enta_error('ITEM_RESOLVED'); END IF;
     r:=r||jsonb_build_object('consumed',r->'consumed'||jsonb_build_array(jsonb_build_object('itemId',c->'itemId','teamId',r->'scoringTeamId','eventId',event_id)));
     IF standalone THEN SELECT (n-1)::INTEGER INTO team_index FROM jsonb_array_elements(s->'teams') WITH ORDINALITY a(x,n) WHERE x->'id'=r->'scoringTeamId'; r:=r||jsonb_build_object('turnDeadline',moment+(s->'request'->'setup'->'rules'->>'turnSeconds')::INTEGER*1000,'scoringTeamId',s->'teams'->((team_index+CASE WHEN item->'trap'='true'::JSONB THEN 1 ELSE 0 END)%jsonb_array_length(s->'teams'))->'id'); END IF;
     IF r->'assignment'->'itemId'=c->'itemId' THEN r:=r||jsonb_build_object('assignment',NULL); s:=public.int8_invalidate(s,rid); END IF;
    END IF;
    s:=public.int8_put_round(s,r);
    IF kind='CLOSE_ROUND' THEN s:=public.int8_close(s,r,'HOST_CLOSED'); ELSIF kind='ADJUDICATE_ROUND' THEN s:=public.int8_close(s,r,'ADJUDICATED'); ELSIF jsonb_array_length(r->'consumed')=jsonb_array_length(r->'pin'->'items') THEN s:=public.int8_close(s,r,'ALL_ITEMS'); END IF;
   ELSIF kind IN ('CREATE_GRANT','ROTATE_GRANT','REVOKE_GRANT') THEN
    IF "grant" IS NOT NULL OR r->'revealed'='true'::JSONB THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
    IF kind='CREATE_GRANT' THEN
     IF c->>'role' NOT IN ('JUDGE','ACTOR') OR (c->>'role'='JUDGE' AND r->'pin'->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS')) OR (c->>'role'='ACTOR' AND (r->'pin'->>'format' NOT IN ('ACTING_ITEMS','DRAWING_TARGET') OR r->'assignment'='null'::JSONB)) THEN PERFORM public.int6_enta_error('ASSIGNMENT_UNAVAILABLE'); END IF;
     SELECT x INTO scope FROM jsonb_array_elements(s->'grantScopes') x WHERE x->'roundId'=r->'id' AND x->'role'=c->'role' AND x->'assignmentId'=CASE WHEN c->>'role'='ACTOR' THEN r->'assignment'->'id' ELSE 'null'::JSONB END;
     IF scope->>'activeGrantId' IS NOT NULL THEN PERFORM public.int6_enta_error('GRANT_ALREADY_ACTIVE'); END IF;
     IF scope IS NULL THEN SELECT x INTO scope FROM jsonb_array_elements(proposal->'grantScopes') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s->'grantScopes') prior WHERE prior->'id'=x->'id'); IF scope->>'id'!~'^[0-9a-f-]{36}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF; scope:=jsonb_build_object('id',scope->>'id','roundId',rid,'role',c->'role','assignmentId',CASE WHEN c->>'role'='ACTOR' THEN r->'assignment'->'id' ELSE 'null'::JSONB END,'generation',0,'activeGrantId',NULL); new_scope:=TRUE; END IF;
    ELSE SELECT x INTO scope FROM jsonb_array_elements(s->'grantScopes') x WHERE x->'id'=c->'scopeId' AND x->>'roundId'=rid; IF scope IS NULL THEN PERFORM public.int6_enta_error('MATCH_NOT_FOUND'); END IF;
     IF kind='ROTATE_GRANT' AND (NOT public.int5b_json_integer(c->'expectedGeneration',1,2000000000) OR scope->'generation' IS DISTINCT FROM c->'expectedGeneration') THEN PERFORM public.int6_enta_error('STALE_GRANT_GENERATION'); END IF;
     IF scope->>'role'='ACTOR' AND scope->'assignmentId' IS DISTINCT FROM r->'assignment'->'id' THEN PERFORM public.int6_enta_error('ASSIGNMENT_UNAVAILABLE'); END IF;
    END IF;
    IF kind<>'REVOKE_GRANT' AND NOT public.int5b_json_integer(c->'durationSeconds',1,600) THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
    SELECT x INTO new_grant FROM jsonb_array_elements(proposal->'grants') x WHERE x->>'id'=event_id; IF new_grant->>'tokenHash'!~'^[a-f0-9]{64}$' THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
    s:=jsonb_set(s,'{grants}',(SELECT COALESCE(jsonb_agg(CASE WHEN x->'id'=scope->'activeGrantId' THEN jsonb_set(x,'{revoked}','true'::JSONB) ELSE x END ORDER BY n),'[]'::JSONB) FROM jsonb_array_elements(s->'grants') WITH ORDINALITY a(x,n)));
    scope:=scope||jsonb_build_object('generation',(scope->>'generation')::INTEGER+1,'activeGrantId',CASE WHEN kind='REVOKE_GRANT' THEN NULL ELSE event_id END);
    new_grant:=jsonb_build_object('id',event_id,'scopeId',scope->>'id','roundId',rid,'role',scope->'role','assignmentId',scope->'assignmentId','generation',scope->'generation','tokenHash',new_grant->>'tokenHash','expiresAt',CASE WHEN kind='REVOKE_GRANT' THEN moment ELSE moment+(c->>'durationSeconds')::INTEGER*1000 END,'revoked',kind='REVOKE_GRANT');
    s:=jsonb_set(s,'{grants}',s->'grants'||jsonb_build_array(new_grant)); IF new_scope THEN s:=jsonb_set(s,'{grantScopes}',s->'grantScopes'||jsonb_build_array(scope)); ELSE s:=jsonb_set(s,'{grantScopes}',(SELECT jsonb_agg(CASE WHEN x->'id'=scope->'id' THEN scope ELSE x END ORDER BY n) FROM jsonb_array_elements(s->'grantScopes') WITH ORDINALITY a(x,n))); END IF;
   ELSIF kind IN ('APPEND','UNDO','REDO','CLEAR') THEN
    IF "grant" IS NULL OR r->'pin'->>'format'<>'DRAWING_TARGET' THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
    SELECT x INTO cv FROM jsonb_array_elements(s->'canvases') x WHERE x->>'roundId'=rid; IF cv IS NULL THEN cv:=jsonb_build_object('roundId',rid,'revision',0,'strokes','[]'::JSONB,'visibleIds','[]'::JSONB,'redoIds','[]'::JSONB,'cumulativePoints',0,'mutations',0,'receipts','[]'::JSONB); END IF;
    IF NOT public.int5b_json_integer(c->'expectedRevision',0,512) OR c->'expectedRevision' IS DISTINCT FROM cv->'revision' THEN PERFORM public.int6_enta_error('STALE_CANVAS_REVISION'); END IF; IF (cv->>'mutations')::INTEGER>=512 THEN PERFORM public.int6_enta_error('CANVAS_BUDGET_EXCEEDED'); END IF;
    IF kind='APPEND' THEN stroke:=c->'stroke'; IF NOT public.int6_enta_exact_keys(stroke,ARRAY['id','color','width','erase','points']) OR stroke->>'id'!~'^[A-Za-z0-9_-]{1,128}$' OR stroke->>'color' NOT IN ('#191615','#ffffff','#ff2e95','#3478bd','#267448') OR stroke->'width' NOT IN ('2'::JSONB,'5'::JSONB,'10'::JSONB) OR jsonb_typeof(stroke->'erase')<>'boolean' OR jsonb_typeof(stroke->'points')<>'array' OR jsonb_array_length(stroke->'points') NOT BETWEEN 1 AND 256 OR EXISTS(SELECT 1 FROM jsonb_array_elements(stroke->'points') p WHERE jsonb_typeof(p)<>'array' OR jsonb_array_length(p)<>2 OR NOT public.int5b_json_integer(p->0,0,10000) OR NOT public.int5b_json_integer(p->1,0,10000)) OR jsonb_array_length(cv->'strokes')>=128 OR (cv->>'cumulativePoints')::INTEGER+jsonb_array_length(stroke->'points')>8192 OR EXISTS(SELECT 1 FROM jsonb_array_elements(cv->'strokes') x WHERE x->'id'=stroke->'id') THEN PERFORM public.int6_enta_error('CANVAS_BUDGET_EXCEEDED'); END IF;
     cv:=cv||jsonb_build_object('strokes',cv->'strokes'||jsonb_build_array(stroke),'visibleIds',cv->'visibleIds'||jsonb_build_array(stroke->'id'),'redoIds','[]'::JSONB,'cumulativePoints',(cv->>'cumulativePoints')::INTEGER+jsonb_array_length(stroke->'points'));
    ELSIF kind='UNDO' THEN IF jsonb_array_length(cv->'visibleIds')<1 THEN PERFORM public.int6_enta_error('CANVAS_EMPTY'); END IF; cv:=cv||jsonb_build_object('redoIds',cv->'redoIds'||jsonb_build_array(cv->'visibleIds'->-1),'visibleIds',(cv->'visibleIds')-(jsonb_array_length(cv->'visibleIds')-1));
    ELSIF kind='REDO' THEN IF jsonb_array_length(cv->'redoIds')<1 THEN PERFORM public.int6_enta_error('NO_REDO'); END IF; cv:=cv||jsonb_build_object('visibleIds',cv->'visibleIds'||jsonb_build_array(cv->'redoIds'->-1),'redoIds',(cv->'redoIds')-(jsonb_array_length(cv->'redoIds')-1)); ELSE cv:=cv||jsonb_build_object('visibleIds','[]'::JSONB,'redoIds','[]'::JSONB); END IF;
    cv:=cv||jsonb_build_object('revision',(cv->>'revision')::INTEGER+1,'mutations',(cv->>'mutations')::INTEGER+1,'receipts',cv->'receipts'||jsonb_build_array(jsonb_build_object('commandId',c->>'commandId','hash',public.int6_enta_hash(c),'revision',(cv->>'revision')::INTEGER+1)));
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'canvases') x WHERE x->>'roundId'=rid) THEN s:=jsonb_set(s,'{canvases}',(SELECT jsonb_agg(CASE WHEN x->>'roundId'=rid THEN cv ELSE x END ORDER BY n) FROM jsonb_array_elements(s->'canvases') WITH ORDINALITY a(x,n))); ELSE s:=jsonb_set(s,'{canvases}',s->'canvases'||jsonb_build_array(cv)); END IF;
   ELSE PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  END IF;
 END IF;
 s:=public.int8_add_event(s,event_id,c->>'commandId',public.int6_enta_hash(c),CASE WHEN "grant" IS NULL THEN kind ELSE 'CANVAS_'||kind END,rid,authority,moment,pause_reason);
 IF kind='JUDGE_ITEM' OR kind='ADJUDICATE_ROUND' AND c->'correct'='true'::JSONB THEN
  SELECT x INTO team FROM jsonb_array_elements(s->'teams') x WHERE x->'id'=CASE WHEN kind='JUDGE_ITEM' THEN (SELECT prior->'scoringTeamId' FROM jsonb_array_elements(proposal->'rounds') prior WHERE prior->>'id'=rid) ELSE c->'teamId' END;
  -- For standalone traps the successor team transferred; original consumed
  -- record is the authoritative team receiving the pinned posting.
  IF kind='JUDGE_ITEM' THEN SELECT x INTO team FROM jsonb_array_elements(s->'teams') x WHERE x->'id'=(SELECT rr->'consumed'->-1->'teamId' FROM jsonb_array_elements(s->'rounds') rr WHERE rr->>'id'=rid); END IF;
  delta:=CASE WHEN kind='JUDGE_ITEM' THEN (item->>'value')::BIGINT*CASE WHEN item->'trap'='true'::JSONB THEN -1 ELSE 1 END ELSE (r->'pin'->>'points')::BIGINT END; score_before:=(team->>'score')::BIGINT; score_after:=CASE WHEN standalone THEN score_before+delta ELSE greatest(0,score_before+delta) END; IF score_after NOT BETWEEN -2147483648 AND 2147483647 THEN PERFORM public.int6_enta_error('SCORE_BOUND_EXCEEDED'); END IF;
  post:=proposal->'postings'->(jsonb_array_length(proposal->'postings')-1); IF post->>'id'!~'^[0-9a-f-]{36}$' THEN PERFORM public.int6_enta_error('INVALID_REQUEST'); END IF;
  post:=jsonb_build_object('id',post->>'id','eventId',event_id,'roundId',rid,'itemId',CASE WHEN kind='JUDGE_ITEM' THEN c->'itemId' ELSE 'null'::JSONB END,'teamId',team->'id','delta',score_after-score_before,'before',score_before,'after',score_after,'rulesVersion','enta-format-1');
  s:=jsonb_set(jsonb_set(s,'{postings}',s->'postings'||jsonb_build_array(post)),'{teams}',(SELECT jsonb_agg(CASE WHEN x->'id'=team->'id' THEN jsonb_set(x,'{score}',to_jsonb(score_after)) ELSE x END ORDER BY n) FROM jsonb_array_elements(s->'teams') WITH ORDINALITY a(x,n)));
 END IF;
 RETURN s;
END $$;

CREATE FUNCTION public.int8_unsealed_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF NEW."sealedAt" IS NOT NULL THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF; RETURN NEW; END $$;
CREATE TRIGGER "EntaFormatRelease_insert_unsealed" BEFORE INSERT ON public."EntaFormatRelease" FOR EACH ROW EXECUTE FUNCTION public.int8_unsealed_insert();
CREATE TRIGGER "MediaObjectProof_insert_unsealed" BEFORE INSERT ON public."MediaObjectProof" FOR EACH ROW EXECUTE FUNCTION public.int8_unsealed_insert();
CREATE FUNCTION public.int8_scope_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE scope public."RoundGrantScope"%ROWTYPE; gr public."RoundGrant"%ROWTYPE; r public."GameRound"%ROWTYPE; e public."RoundAuthorityEvent"%ROWTYPE; assignment public."RoundActorAssignment"%ROWTYPE; scope_key TEXT; BEGIN
 IF TG_TABLE_NAME='RoundAuthorityEvent' THEN
  SELECT * INTO e FROM public."RoundAuthorityEvent" WHERE "id"=NEW."id";
  IF e."authorityKind"='GRANT' THEN SELECT * INTO gr FROM public."RoundGrant" WHERE "id"=e."authorityGrantId" AND "gameId"=e."gameId" AND "roundId"=e."roundId" AND "generation"=e."authorityGeneration" AND "assignmentId"=e."assignmentId"; SELECT * INTO scope FROM public."RoundGrantScope" WHERE "id"=gr."scopeId"; SELECT * INTO r FROM public."GameRound" WHERE "id"=e."roundId" AND "gameId"=e."gameId";
   IF gr."id" IS NULL OR gr."revoked" OR gr."expiresAt"<=e."at" OR gr."role"<>'ACTOR' OR scope."activeGrantId" IS DISTINCT FROM gr."id" OR scope."generation"<>gr."generation" OR r."state"->'assignment'->>'id' IS DISTINCT FROM gr."assignmentId" OR e."type" NOT IN ('CANVAS_APPEND','CANVAS_UNDO','CANVAS_REDO','CANVAS_CLEAR') THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  END IF; RETURN NULL;
 END IF;
 IF TG_TABLE_NAME='RoundGrantScope' THEN scope_key:=NEW."id"; ELSE scope_key:=NEW."scopeId"; END IF;
 FOR scope IN SELECT * FROM public."RoundGrantScope" WHERE "id"=scope_key LOOP
  IF scope."activeGrantId" IS NULL THEN CONTINUE; END IF;
  SELECT * INTO gr FROM public."RoundGrant" WHERE "id"=scope."activeGrantId" AND "scopeId"=scope."id" AND "gameId"=scope."gameId" AND "roundId"=scope."roundId"; SELECT * INTO r FROM public."GameRound" WHERE "id"=scope."roundId" AND "gameId"=scope."gameId";
  IF gr."id" IS NULL OR gr."revoked" OR (SELECT "status" FROM public."Game" WHERE "id"=scope."gameId")='FINISHED' OR gr."role"<>scope."role" OR gr."generation"<>scope."generation" OR gr."assignmentId" IS DISTINCT FROM scope."assignmentId" OR r."state"->>'state' NOT IN ('RUNNING','PAUSED') OR r."state"->'revealed'='true'::JSONB OR (SELECT "activeRoundId" FROM public."GameRuntime" WHERE "gameId"=scope."gameId") IS DISTINCT FROM r."id" THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  IF scope."role"='JUDGE' THEN IF scope."assignmentId" IS NOT NULL OR r."pin"->>'format' NOT IN ('LIST_ITEMS','ACTING_ITEMS') THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  ELSE SELECT * INTO assignment FROM public."RoundActorAssignment" WHERE "id"=scope."assignmentId" AND "gameId"=scope."gameId" AND "roundId"=scope."roundId";
   IF assignment."id" IS NULL OR r."state"->'assignment'->>'id' IS DISTINCT FROM assignment."id" OR (assignment."itemId" IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(r."state"->'consumed') x WHERE x->>'itemId'=assignment."itemId")) THEN PERFORM public.int6_enta_error('GRANT_DENIED'); END IF;
  END IF;
 END LOOP; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RoundGrantScope_final_scope" AFTER INSERT OR UPDATE ON public."RoundGrantScope" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int8_scope_complete();
CREATE CONSTRAINT TRIGGER "RoundGrant_final_scope" AFTER INSERT OR UPDATE ON public."RoundGrant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int8_scope_complete();
CREATE CONSTRAINT TRIGGER "RoundAuthorityEvent_grant_tuple" AFTER INSERT ON public."RoundAuthorityEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int8_scope_complete();
CREATE FUNCTION public.int8_grant_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN IF TG_OP='DELETE' OR to_jsonb(NEW)-'revoked' IS DISTINCT FROM to_jsonb(OLD)-'revoked' OR OLD."revoked" AND NOT NEW."revoked" THEN PERFORM public.int6_enta_error('IMMUTABLE_FORMAT'); END IF; RETURN NEW; END $$;
CREATE TRIGGER "RoundGrant_immutable_binding" BEFORE UPDATE OR DELETE ON public."RoundGrant" FOR EACH ROW EXECUTE FUNCTION public.int8_grant_immutable();
CREATE FUNCTION public.int8_assert_stored(game_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE p public."EntaExecutionPin"%ROWTYPE; g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; rt public."GameRuntime"%ROWTYPE; f public."EntaFormatRelease"%ROWTYPE; rows JSONB; selection JSONB; t JSONB; names JSONB; ord INTEGER; wanted JSONB; selected_refs JSONB; profile TEXT; BEGIN
 SELECT * INTO p FROM public."EntaExecutionPin" WHERE "gameId"=game_id; SELECT * INTO g FROM public."Game" WHERE "id"=game_id; SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId"; SELECT * INTO rt FROM public."GameRuntime" WHERE "gameId"=game_id; SELECT * INTO f FROM public."EntaFormatRelease" WHERE "id"=p."formatReleaseId";
 IF p."gameId" IS NULL OR NOT public.int8_state_shape(p."state") OR p."clientHash"<>public.int6_enta_hash(p."clientBinding") OR p."intentHash"<>public.int6_enta_hash(p."fullIntent") OR p."state"->'request' IS DISTINCT FROM p."clientBinding" OR p."state"->'intent' IS DISTINCT FROM p."fullIntent" OR p."state"->>'clientHash' IS DISTINCT FROM p."clientHash" OR p."state"->>'intentHash' IS DISTINCT FROM p."intentHash" OR p."state"->>'identityId' IS DISTINCT FROM g."firebaseIdentityId" OR p."firebaseIdentityId"<>g."firebaseIdentityId" OR p."state"->>'id' IS DISTINCT FROM game_id OR p."state"->>'admissionId' IS DISTINCT FROM a."id" OR p."state"->>'hostUid' IS DISTINCT FROM (SELECT "firebaseUid" FROM public."FirebaseIdentity" WHERE "id"=g."firebaseIdentityId") OR p."state"->>'projectId' IS DISTINCT FROM (SELECT "firebaseProjectId" FROM public."FirebaseIdentity" WHERE "id"=g."firebaseIdentityId") OR a."engine"<>'ENTA' OR a."catalogReleaseId" IS DISTINCT FROM g."catalogReleaseId" OR a."releaseRootHash" IS DISTINCT FROM g."catalogReleaseRootHash" OR a."validationReceiptId" IS DISTINCT FROM g."validationReceiptId" OR a."selectorVersion"<>'enta-format-1' OR a."state"<>'COMMITTED' OR a."requestVersion"<>4 OR a."requestHash"<>p."clientHash" OR a."intentHash"<>p."intentHash" OR a."logicalMatchId"<>game_id OR a."operation"<>p."clientBinding"->>'operation' OR g."executionFormat"<>p."executionFormat" OR p."executionFormat"<>p."clientBinding"->>'executionFormat' OR g."mode" IS DISTINCT FROM (CASE p."executionFormat" WHEN 'MIXED_BOARD' THEN 'CLASSIC' WHEN 'STANDALONE_LIST' THEN 'LIST' WHEN 'STANDALONE_ACTING' THEN 'ACTING' END) OR a."mode"<>g."mode" OR p."fullIntent"->'request'<>p."clientBinding" OR p."fullIntent"->>'baseReleaseId'<>g."catalogReleaseId" OR p."fullIntent"->>'baseRoot'<>g."catalogReleaseRootHash" OR p."fullIntent"->>'receiptId'<>g."validationReceiptId" OR p."fullIntent"->>'formatReleaseId'<>p."formatReleaseId" OR p."fullIntent"->>'formatRoot'<>p."formatRoot" OR p."fullIntent"->>'mediaRoot'<>p."mediaRoot" OR f."sealedAt" IS NULL OR f."baseReleaseId"<>g."catalogReleaseId" OR f."baseRoot"<>g."catalogReleaseRootHash" OR f."receiptId"<>g."validationReceiptId" OR f."formatRoot"<>p."formatRoot" OR f."mediaRoot"<>p."mediaRoot" OR rt."setup" IS DISTINCT FROM p."clientBinding"->'setup' OR rt."setupHash"<>public.int6_enta_hash(rt."setup") OR rt."version"<>(p."state"->>'version')::INTEGER OR rt."activeRoundId" IS DISTINCT FROM p."state"->>'activeRoundId' THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 SELECT jsonb_agg("pin" ORDER BY "ordinal") INTO rows FROM public."GameRound" WHERE "gameId"=game_id;
 IF public.int6_enta_hash(rows)<>p."fullIntent"->>'pinsHash' OR jsonb_array_length(rows)<>(p."fullIntent"->>'roundCount')::INTEGER OR (SELECT jsonb_agg("state" ORDER BY "ordinal") FROM public."GameRound" WHERE "gameId"=game_id) IS DISTINCT FROM p."state"->'rounds' OR EXISTS(SELECT 1 FROM public."GameRound" r JOIN public."EntaFormatRevision" fr ON fr."id"=r."formatId" JOIN public."GameQuestion" q ON q."id"=r."gameQuestionId" AND q."gameId"=r."gameId" WHERE r."gameId"=game_id AND (fr."releaseId"<>p."formatReleaseId" OR q."questionRevisionId" IS DISTINCT FROM r."questionRevisionId" OR r."pin" IS DISTINCT FROM public.int8_prompt_pin(r."formatId"))) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 SELECT jsonb_agg(jsonb_build_object('sourceNamespace',r."sourceNamespace",'sourceId',r."sourceId",'revisionId',r."questionRevisionId",'cycle',CASE WHEN p."executionFormat"='MIXED_BOARD' THEN 0 ELSE e."cycle" END,'ordinal',r."ordinal") ORDER BY r."ordinal") INTO selection FROM public."GameRound" r LEFT JOIN public."EntaSourceExposure" e ON e."gameId"=r."gameId" AND e."ordinal"=r."ordinal" AND e."firebaseIdentityId"=g."firebaseIdentityId" AND e."executionFormat"=g."executionFormat" AND e."categoryKey"=r."pin"->>'categoryKey' AND e."sourceNamespace"=r."sourceNamespace" AND e."sourceId"=r."sourceId" AND e."revisionId"=r."questionRevisionId" WHERE r."gameId"=game_id;
 IF selection IS DISTINCT FROM p."fullIntent"->'selection' OR p."executionFormat"='MIXED_BOARD' AND EXISTS(SELECT 1 FROM public."EntaSourceExposure" WHERE "gameId"=game_id) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 IF cardinality(rt."teamOrder")<>jsonb_array_length(p."clientBinding"->'setup'->'teams') OR cardinality(rt."teamOrder")<>(SELECT count(*) FROM public."Team" WHERE "gameId"=game_id) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 FOR ord IN 1..cardinality(rt."teamOrder") LOOP SELECT jsonb_build_object('id',"id",'name',"name",'players',(SELECT jsonb_agg("name" ORDER BY "id") FROM public."Player" WHERE "teamId"=rt."teamOrder"[ord]),'score',"score") INTO t FROM public."Team" WHERE "gameId"=game_id AND "id"=rt."teamOrder"[ord]; IF t IS DISTINCT FROM p."state"->'teams'->(ord-1) OR t->'name' IS DISTINCT FROM p."clientBinding"->'setup'->'teams'->(ord-1)->'name' OR t->'players' IS DISTINCT FROM p."clientBinding"->'setup'->'teams'->(ord-1)->'players' THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF; END LOOP;
 IF (SELECT jsonb_agg("categoryKey" ORDER BY "ordinal") FROM public."GameCategoryPin" WHERE "gameId"=game_id) IS DISTINCT FROM (SELECT jsonb_agg(x->'key' ORDER BY n) FROM jsonb_array_elements(p."clientBinding"->'setup'->'categories') WITH ORDINALITY cats(x,n)) OR EXISTS(SELECT 1 FROM public."GameRound" r WHERE r."gameId"=game_id AND NOT EXISTS(SELECT 1 FROM public."GameCategoryPin" cp WHERE cp."gameId"=game_id AND cp."categoryKey"=r."pin"->>'categoryKey')) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;

 FOR wanted IN SELECT x FROM jsonb_array_elements(p."clientBinding"->'setup'->'categories') x LOOP
  SELECT min("pin"->>'format') INTO profile FROM public."GameRound" WHERE "gameId"=game_id AND "categoryKey"=wanted->>'key';
  IF profile IS NULL OR (SELECT count(DISTINCT "pin"->>'format') FROM public."GameRound" WHERE "gameId"=game_id AND "categoryKey"=wanted->>'key')<>1 THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
  IF p."executionFormat"='MIXED_BOARD' AND profile IN ('LIST_ITEMS','ACTING_ITEMS') THEN SELECT jsonb_agg("pin"->'ref' ORDER BY "ordinal") INTO selected_refs FROM public."GameRound" WHERE "gameId"=game_id AND "categoryKey"=wanted->>'key'; IF selected_refs IS DISTINCT FROM wanted->'promptRefs' OR jsonb_array_length(selected_refs) NOT BETWEEN 1 AND 6 THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
  ELSIF p."executionFormat"='MIXED_BOARD' THEN IF wanted->'promptRefs'<>'[]'::JSONB OR (SELECT count(*) FROM public."GameRound" WHERE "gameId"=game_id AND "categoryKey"=wanted->>'key')<>6 OR EXISTS(SELECT 1 FROM (VALUES(200),(400),(600)) tiers(value) WHERE (SELECT count(*) FROM public."GameRound" WHERE "gameId"=game_id AND "categoryKey"=wanted->>'key' AND ("pin"->>'points')::INTEGER=tiers.value)<>2) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
  ELSE IF profile IS DISTINCT FROM (CASE p."executionFormat" WHEN 'STANDALONE_LIST' THEN 'LIST_ITEMS' ELSE 'ACTING_ITEMS' END) OR wanted->'promptRefs'<>'[]'::JSONB OR (SELECT count(*) FROM public."GameRound" WHERE "gameId"=game_id)<>least(4,(SELECT count(*) FROM public."EntaFormatRevision" WHERE "releaseId"=p."formatReleaseId" AND "categoryKey"=wanted->>'key' AND "format"=profile)) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF; END IF;
 END LOOP;

 IF jsonb_array_length(p."state"->'grants')<>(SELECT count(*) FROM public."RoundGrant" WHERE "gameId"=game_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p."state"->'grants') x WHERE NOT EXISTS(SELECT 1 FROM public."RoundGrant" gr WHERE gr."gameId"=game_id AND x=jsonb_build_object('id',gr."id",'scopeId',gr."scopeId",'roundId',gr."roundId",'role',gr."role",'assignmentId',gr."assignmentId",'generation',gr."generation",'tokenHash',gr."tokenHash",'expiresAt',floor(extract(epoch FROM gr."expiresAt")*1000),'revoked',gr."revoked"))) OR jsonb_array_length(p."state"->'grantScopes')<>(SELECT count(*) FROM public."RoundGrantScope" WHERE "gameId"=game_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p."state"->'grantScopes') x WHERE NOT EXISTS(SELECT 1 FROM public."RoundGrantScope" sc WHERE sc."gameId"=game_id AND x=jsonb_build_object('id',sc."id",'roundId',sc."roundId",'role',sc."role",'assignmentId',sc."assignmentId",'generation',sc."generation",'activeGrantId',sc."activeGrantId"))) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 IF (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e."id",'commandId',e."commandId",'hash',e."intentHash",'sequence',e."sequence",'type',e."type",'roundId',e."roundId",'authority',CASE e."authorityKind" WHEN 'HOST' THEN jsonb_build_object('kind','HOST','identityId',e."ownerIdentityId") WHEN 'GRANT' THEN jsonb_build_object('kind','GRANT','grantId',e."authorityGrantId",'generation',e."authorityGeneration",'assignmentId',e."assignmentId") ELSE jsonb_build_object('kind','SYSTEM','operation',e."systemOperation") END,'at',floor(extract(epoch FROM e."at")*1000),'pauseReason',e."pauseReason") ORDER BY e."sequence"),'[]'::JSONB) FROM public."RoundAuthorityEvent" e WHERE e."gameId"=game_id) IS DISTINCT FROM p."state"->'events' THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
 IF jsonb_array_length(p."state"->'postings')<>(SELECT count(*) FROM public."RoundScorePosting" WHERE "gameId"=game_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p."state"->'postings') x WHERE NOT EXISTS(SELECT 1 FROM public."RoundScorePosting" sp WHERE sp."gameId"=game_id AND x=jsonb_build_object('id',sp."id",'eventId',sp."eventId",'roundId',sp."roundId",'itemId',sp."itemId",'teamId',sp."teamId",'delta',sp."delta",'before',sp."before",'after',sp."after",'rulesVersion',sp."rulesVersion"))) OR jsonb_array_length(p."state"->'canvases')<>(SELECT count(*) FROM public."DrawingCanvasState" cs JOIN public."GameRound" rr ON rr."id"=cs."roundId" WHERE rr."gameId"=game_id) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p."state"->'canvases') x WHERE NOT EXISTS(SELECT 1 FROM public."DrawingCanvasState" cs JOIN public."GameRound" rr ON rr."id"=cs."roundId" WHERE rr."gameId"=game_id AND cs."state"=x AND cs."revision"=(x->>'revision')::INTEGER)) THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;

 IF EXISTS(SELECT 1 FROM public."GameRound" rr WHERE rr."gameId"=game_id AND
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i."itemId",'revisionId',i."answerRevisionId",'hash',i."answerHash",'ordinal',i."ordinal") ORDER BY i."ordinal"),'[]'::JSONB) FROM public."RoundItemPin" i WHERE i."roundId"=rr."id" AND i."formatId"=rr."formatId") IS DISTINCT FROM
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',x->>'id','revisionId',x->>'revisionId','hash',x->>'hash','ordinal',x->'ordinal') ORDER BY (x->>'ordinal')::INTEGER),'[]'::JSONB) FROM jsonb_array_elements(rr."pin"->'items') x))
 THEN PERFORM public.int6_enta_error('MATCH_DATA_UNAVAILABLE'); END IF;
END $$;

ALTER TABLE public."RoundAuthorityEvent" ADD CHECK(CASE WHEN "authorityKind"='GRANT' THEN "roundId" IS NOT NULL AND "authorityGrantId" IS NOT NULL AND "authorityGeneration" IS NOT NULL AND "authorityGeneration">0 AND "assignmentId" IS NOT NULL AND "systemOperation" IS NULL ELSE TRUE END);
ALTER TABLE public."EntaFormatRelease" ADD CHECK("formatRoot"~'^[a-f0-9]{64}$' AND "mediaRoot"~'^[a-f0-9]{64}$' AND "issuerEvidenceHash"~'^[a-f0-9]{64}$' AND "policyVersion"='enta-format-1');
GRANT SELECT ON public."MediaRevision" TO enta_finance_executor;

CREATE TRIGGER "EntaFormatRevision_no_truncate" BEFORE TRUNCATE ON public."EntaFormatRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "EntaFormatItem_no_truncate" BEFORE TRUNCATE ON public."EntaFormatItem" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "EntaFormatMedia_no_truncate" BEFORE TRUNCATE ON public."EntaFormatMedia" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "EntaFormatCover_no_truncate" BEFORE TRUNCATE ON public."EntaFormatCover" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "MediaChunkProof_no_truncate" BEFORE TRUNCATE ON public."MediaChunkProof" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "EntaExecutionPin_no_truncate" BEFORE TRUNCATE ON public."EntaExecutionPin" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "GameRound_no_truncate" BEFORE TRUNCATE ON public."GameRound" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundItemPin_no_truncate" BEFORE TRUNCATE ON public."RoundItemPin" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "EntaSourceExposure_no_truncate" BEFORE TRUNCATE ON public."EntaSourceExposure" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundAuthorityEvent_no_truncate" BEFORE TRUNCATE ON public."RoundAuthorityEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundScorePosting_no_truncate" BEFORE TRUNCATE ON public."RoundScorePosting" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundActorAssignment_no_truncate" BEFORE TRUNCATE ON public."RoundActorAssignment" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundGrantScope_no_truncate" BEFORE TRUNCATE ON public."RoundGrantScope" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "RoundGrant_no_truncate" BEFORE TRUNCATE ON public."RoundGrant" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();

CREATE TRIGGER "DrawingCanvasState_no_truncate" BEFORE TRUNCATE ON public."DrawingCanvasState" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
DO $$ DECLARE ids OID[]; BEGIN WITH RECURSIVE actual_members(oid) AS (SELECT oid FROM pg_roles WHERE rolname IN ('enta_gameplay_runtime','enta_runtime') UNION SELECT m.member FROM pg_auth_members m JOIN actual_members a ON m.roleid=a.oid) SELECT array_agg(oid) INTO ids FROM actual_members;
 IF EXISTS(SELECT 1 FROM pg_roles role JOIN pg_class t ON TRUE JOIN pg_namespace n ON n.oid=t.relnamespace WHERE role.oid=ANY(ids) AND n.nspname='public' AND t.relname IN ('EntaFormatRelease','EntaFormatRevision','EntaFormatItem','MediaObjectProof','MediaChunkProof','EntaFormatMedia','EntaFormatCover','EntaExecutionPin','EntaSourceExposure','GameRound','RoundItemPin','RoundAuthorityEvent','RoundScorePosting','RoundGrantScope','RoundGrant','DrawingCanvasState','RoundActorAssignment') AND (has_table_privilege(role.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR pg_has_role(role.oid,t.relowner,'member'))) THEN RAISE EXCEPTION 'new gameplay tables inherit nonminimal runtime authority; audit externally, no automatic remedy'; END IF; END $$;

ALTER FUNCTION public.int8_json_id(JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_json_id(JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
ALTER FUNCTION public.int8_valid_command(JSONB,BOOLEAN) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_valid_command(JSONB,BOOLEAN) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_execution_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_execution_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_assert_format(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_assert_format(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_namespace(TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_namespace(TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_media_pin(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_media_pin(TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_prompt_pin(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_prompt_pin(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_format_child_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_format_child_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_media_seal_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_media_seal_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_release_seal_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_release_seal_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_catalog(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_catalog(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_locked_state(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_locked_state(TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_owner_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_owner_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_locate_grant(TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_locate_grant(TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_grant_load(TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_grant_load(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_exposures(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_exposures(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_valid_request(JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_valid_request(JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_apply(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_apply(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_complete_start() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_complete_start() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_pin_guard() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_pin_guard() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_put_round(JSONB,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_put_round(JSONB,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_invalidate(JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_invalidate(JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_close(JSONB,JSONB,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_close(JSONB,JSONB,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_add_event(JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,DOUBLE PRECISION,TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_add_event(JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,DOUBLE PRECISION,TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_clock(JSONB,DOUBLE PRECISION) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_clock(JSONB,DOUBLE PRECISION) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_state_shape(JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_state_shape(JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_compare(JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_compare(JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_reduce(JSONB,JSONB,JSONB,DOUBLE PRECISION,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_reduce(JSONB,JSONB,JSONB,DOUBLE PRECISION,JSONB) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_unsealed_insert() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_unsealed_insert() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_scope_complete() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_scope_complete() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_grant_immutable() OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_grant_immutable() FROM PUBLIC,enta_runtime,enta_gameplay_runtime;

ALTER FUNCTION public.int8_assert_stored(TEXT) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int8_assert_stored(TEXT) FROM PUBLIC,enta_runtime,enta_gameplay_runtime;
GRANT EXECUTE ON FUNCTION public.int8_catalog(TEXT,TEXT,TEXT,TEXT),public.int8_find_start(TEXT,TEXT,TEXT,TEXT,TEXT),public.int8_exposures(TEXT,TEXT,TEXT,TEXT,TEXT),public.int8_start(TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,TEXT),public.int8_owner_load(TEXT,TEXT,TEXT,TEXT,BOOLEAN),public.int8_locate_grant(TEXT,TEXT,TEXT),public.int8_grant_load(TEXT,TEXT,TEXT,TEXT),public.int8_apply(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,JSONB,JSONB) TO enta_gameplay_runtime;
-- INT-061 bounded retained-history safeguard; v4 history/rematch is INT-060.E3.
CREATE OR REPLACE FUNCTION public.int7_enta_history(ns TEXT,project TEXT,uid TEXT,query JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE identity_id TEXT; result JSONB; anchor TIMESTAMP(3);
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public."DeploymentNamespace" WHERE "id"='singleton' AND "namespaceId"=ns AND "firebaseProjectId"=project) THEN PERFORM public.int6_enta_error('ENTA_UNAVAILABLE'); END IF;
 IF NOT public.int6_enta_exact_keys(query,ARRAY['limit','mode','status','cursor']) OR NOT public.int5b_json_integer(query->'limit',1,50) OR query->'mode' NOT IN ('null'::JSONB,'"CLASSIC"'::JSONB,'"KIDS"'::JSONB) OR query->'status' NOT IN ('null'::JSONB,'"ACTIVE"'::JSONB,'"FINISHED"'::JSONB) THEN PERFORM public.int6_enta_error('INVALID_HISTORY_QUERY'); END IF;
 SELECT "id" INTO identity_id FROM public."FirebaseIdentity" WHERE "firebaseProjectId"=project AND "firebaseUid"=uid;
 IF NOT FOUND THEN IF query->'cursor' IS DISTINCT FROM 'null'::JSONB THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF; RETURN '[]'::JSONB; END IF;
 IF query->'cursor' IS DISTINCT FROM 'null'::JSONB THEN
  IF NOT public.int6_enta_exact_keys(query->'cursor',ARRAY['id','createdAt']) OR query->'cursor'->>'id'!~'^[A-Za-z0-9_-]{1,128}$' OR query->'cursor'->>'createdAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF;
  anchor:=(query->'cursor'->>'createdAt')::TIMESTAMPTZ AT TIME ZONE 'UTC';
  IF NOT EXISTS(SELECT 1 FROM public."Game" g WHERE g."id"=query->'cursor'->>'id' AND g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND g."mode" IN ('CLASSIC','KIDS') AND g."executionFormat"='TIER_BOARD' AND EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=g."admissionId" AND a."firebaseIdentityId"=g."firebaseIdentityId" AND a."requestVersion" IN (2,3)) AND g."createdAt"=anchor AND (query->>'mode' IS NULL OR g."mode"=query->>'mode') AND (query->>'status' IS NULL OR g."status"=query->>'status')) THEN PERFORM public.int6_enta_error('INVALID_HISTORY_CURSOR'); END IF;
 END IF;
 -- One statement: coherent aggregate snapshot, no wallet/catalog/grading reads.
 SELECT COALESCE(jsonb_agg(row ORDER BY created_at DESC,id COLLATE "C" DESC),'[]'::JSONB) INTO result FROM (
  SELECT g."createdAt" created_at,g."id" id,jsonb_build_object('id',g."id",'mode',g."mode",'status',g."status",'createdAt',to_char(g."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'finishedAt',CASE WHEN g."finishedAt" IS NULL THEN NULL ELSE to_char(g."finishedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,'teams',(SELECT jsonb_agg(jsonb_build_object('name',t."name",'score',t."score") ORDER BY ordered.ord) FROM unnest(r."teamOrder") WITH ORDINALITY ordered(id,ord) JOIN public."Team" t ON t."gameId"=g."id" AND t."id"=ordered.id),'resultReason',r."resultReason",'unplayedCount',r."unplayedCount") row
  FROM public."Game" g JOIN public."GameRuntime" r ON r."gameId"=g."id" WHERE g."firebaseIdentityId"=identity_id AND g."gameFormat"='FIREBASE_PINNED' AND g."mode" IN ('CLASSIC','KIDS') AND g."executionFormat"='TIER_BOARD' AND EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=g."admissionId" AND a."firebaseIdentityId"=g."firebaseIdentityId" AND a."requestVersion" IN (2,3)) AND (query->>'mode' IS NULL OR g."mode"=query->>'mode') AND (query->>'status' IS NULL OR g."status"=query->>'status') AND (anchor IS NULL OR g."createdAt"<anchor OR (g."createdAt"=anchor AND g."id" COLLATE "C"<(query->'cursor'->>'id') COLLATE "C"))
  ORDER BY g."createdAt" DESC,g."id" COLLATE "C" DESC LIMIT (query->>'limit')::INTEGER+1
 ) selected; RETURN result;
END $$;
ALTER FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) OWNER TO enta_finance_executor;
REVOKE ALL ON FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC,enta_runtime;
GRANT EXECUTE ON FUNCTION public.int7_enta_history(TEXT,TEXT,TEXT,JSONB) TO enta_gameplay_runtime;
COMMIT;
