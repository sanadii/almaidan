-- INCOMPLETE SOURCE CHECKPOINT. Remove this guard only after full implementation and review.
-- Never execute or install under R6 STOP.
DO $$ BEGIN RAISE EXCEPTION 'PRO262_CAP_IMPLEMENTATION_INCOMPLETE'; END $$;
-- Protected rows are initially absent: no trust root, issuer, limit or approval is seeded.
-- Existing activity-reader grants remain unchanged. These owner-controlled wrappers
-- expose exactly the existing own-backend start and exact-incarnation liveness boolean.
CREATE FUNCTION public.pro262_capacity_backend_start() RETURNS TIMESTAMPTZ
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.pro311_own_backend_start() $$;
CREATE FUNCTION public.pro262_capacity_backend_live(p_principal NAME,p_pid INTEGER,p_started TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT public.pro311_backend_is_live(p_principal,p_pid,p_started) $$;
CREATE TABLE public."Pro262CapacityTrust" (
 "trustId" TEXT NOT NULL, "generation" BIGINT NOT NULL CHECK ("generation">0),
 "issuer" TEXT NOT NULL, "supplierPrincipal" NAME NOT NULL, "channelId" TEXT NOT NULL,
 "verifierKeyId" TEXT NOT NULL, "trustRootId" TEXT NOT NULL, "policyRevision" TEXT NOT NULL,
 "policyHash" TEXT NOT NULL CHECK ("policyHash" ~ '^[a-f0-9]{64}$'),
 "purpose" TEXT NOT NULL CHECK ("purpose" IN ('CAPACITY_APPROVAL','CLEANUP_OBSERVATION','SUPERVISOR','OPERATION_ISSUER','CONTROL_ALLOCATOR','INSTALL_OBSERVATION')), "scope" JSONB NOT NULL,
 "validFrom" TIMESTAMPTZ NOT NULL, "validUntil" TIMESTAMPTZ NOT NULL,
 "revoked" BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY ("trustId","generation"), CHECK ("validUntil">"validFrom")
);
-- One non-revoked installed generation per lane. Consumers SHARE-lock that
-- generation; revocation uses NOWAIT before the next generation can be inserted.
CREATE UNIQUE INDEX "Pro262CapacityTrust_install_lane_current" ON public."Pro262CapacityTrust" (("scope"->'lane')) WHERE "purpose"='INSTALL_OBSERVATION' AND NOT "revoked";
CREATE TABLE public."Pro262VerifiedSupplierReceipt" (
 "supplierId" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "receiptHash" TEXT NOT NULL CHECK ("receiptHash" ~ '^[a-f0-9]{64}$'),
 "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "supplierPrincipal" NAME NOT NULL, "channelId" TEXT NOT NULL, "issuer" TEXT NOT NULL, "keyId" TEXT NOT NULL,
 "serialization" TEXT NOT NULL, "evidence" BYTEA NOT NULL, "signature" BYTEA NOT NULL, "verification" BYTEA NOT NULL,
 "subject" JSONB NOT NULL, PRIMARY KEY ("supplierId","receiptId"), UNIQUE ("receiptId"), UNIQUE ("receiptHash"),
 FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust" ("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."Pro262CapacityApproval" (
 "approvalId" TEXT PRIMARY KEY, "supplierId" TEXT NOT NULL, "receiptId" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
 "issuer" TEXT NOT NULL, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "reuse" TEXT NOT NULL CHECK ("reuse" IN ('ONE_USE','REUSABLE')), "scope" JSONB NOT NULL,
 "validFrom" TIMESTAMPTZ NOT NULL, "validUntil" TIMESTAMPTZ NOT NULL,
 UNIQUE ("supplierId","receiptId"), UNIQUE ("issuer","receiptId","evidenceHash"),
 FOREIGN KEY ("supplierId","receiptId") REFERENCES public."Pro262VerifiedSupplierReceipt" ("supplierId","receiptId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust" ("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CHECK ("validUntil">"validFrom")
);
CREATE TABLE public."Pro262CapacityQualification" (
 "qualificationId" TEXT NOT NULL, "generation" BIGINT NOT NULL CHECK ("generation">0),
 "approvalId" TEXT NOT NULL REFERENCES public."Pro262CapacityApproval" ("approvalId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "proof" JSONB NOT NULL, "proofHash" TEXT NOT NULL CHECK ("proofHash" ~ '^[a-f0-9]{64}$'),
 "domain" TEXT NOT NULL, "sourceClosure" TEXT NOT NULL CHECK ("sourceClosure" ~ '^[a-f0-9]{64}$'),
 "validUntil" TIMESTAMPTZ NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY ("qualificationId","generation"), UNIQUE ("approvalId","proofHash")
);
CREATE TABLE public."Pro262CapacityControlReservation" (
 "controlKey" TEXT PRIMARY KEY, "route" TEXT NOT NULL, "subject" JSONB NOT NULL,
 "requestIdentity" TEXT NOT NULL, "holderEnvelope" TEXT NOT NULL, "parentEnvelope" TEXT NOT NULL,
 "launchEnvelope" TEXT NOT NULL, "replayEnvelope" TEXT NOT NULL, "storageProof" TEXT NOT NULL, "parentHost" TEXT NOT NULL, "parentBoot" TEXT NOT NULL, "parentProcessTree" TEXT NOT NULL, "expectedReplayPrincipal" NAME NOT NULL, "expectedProducerPrincipal" NAME NOT NULL,
 CHECK ("expectedReplayPrincipal"<>"expectedProducerPrincipal"),
 "expiresAt" TIMESTAMPTZ NOT NULL, "state" TEXT NOT NULL CHECK ("state" IN ('RESERVED','DRAINING','QUARANTINED','RELEASED')), "releasedReplayReceiptId" TEXT, "releasedControlReceiptId" TEXT,
 CHECK (("state"='RELEASED')=("releasedControlReceiptId" IS NOT NULL))
);
-- Each login identity is bound by catalog OID before either private launch.
-- The protected lease survives crashes and is closed only by the control release transaction.
CREATE TABLE public."Pro262CapacityPrincipalLease" (
 "controlKey" TEXT NOT NULL REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('REPLAY','PRODUCER')), "principalOid" OID NOT NULL,
 "credentialEpoch" TEXT NOT NULL CHECK ("credentialEpoch"<>''), "launchEpoch" TEXT NOT NULL CHECK ("launchEpoch"<>''),
 "state" TEXT NOT NULL CHECK ("state" IN ('ACTIVE','SEALED','CLOSED')),
 PRIMARY KEY ("controlKey","kind"), UNIQUE ("principalOid","credentialEpoch"),
 UNIQUE ("principalOid","launchEpoch")
);
CREATE UNIQUE INDEX "Pro262CapacityPrincipalLease_active" ON public."Pro262CapacityPrincipalLease"("principalOid") WHERE "state" IN ('ACTIVE','SEALED');
CREATE FUNCTION public.pro262_capacity_principal_lease_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'state') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state') OR NOT ((OLD."state"='ACTIVE' AND NEW."state"='SEALED') OR (OLD."state"='SEALED' AND NEW."state"='CLOSED')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityPrincipalLease_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityPrincipalLease" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_principal_lease_guard();
-- Counted before any private process/backend can open. A transfer is valid only
-- with its exact committed target, and release requires the closed-scope cleanup.
CREATE TABLE public."Pro262CapacityLaunchReservation" (
 "controlKey" TEXT NOT NULL REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('REPLAY','PRODUCER')),
 "profileId" TEXT NOT NULL, "profileGeneration" BIGINT, "profileHash" TEXT NOT NULL,
 "subject" JSONB NOT NULL, "reservedBackendBytes" NUMERIC NOT NULL CHECK ("reservedBackendBytes">0), "reservedSharedBytes" NUMERIC NOT NULL CHECK ("reservedSharedBytes">0),
 "state" TEXT NOT NULL CHECK ("state" IN ('RESERVED','TRANSFERRED','RELEASED')), "targetId" TEXT, "targetFence" BIGINT,
 PRIMARY KEY ("controlKey","kind"),
 CHECK (("state"='RESERVED' AND "targetId" IS NULL AND "targetFence" IS NULL) OR ("state"='TRANSFERRED' AND "targetId" IS NOT NULL AND (("kind"='REPLAY' AND "targetFence" IS NULL) OR ("kind"='PRODUCER' AND "targetFence">0))) OR ("state"='RELEASED' AND "targetId" IS NULL AND "targetFence" IS NULL))
);
CREATE FUNCTION public.pro262_capacity_launch_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'state'-'targetId'-'targetFence') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state'-'targetId'-'targetFence') OR OLD."state"<>'RESERVED' OR NEW."state" NOT IN ('TRANSFERRED','RELEASED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityLaunchReservation_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityLaunchReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_launch_guard();
CREATE TABLE public."Pro262CapacityReplayMiss" (
 "replayId" TEXT PRIMARY KEY, "controlKey" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityControlReservation" ("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "spoolId" TEXT NOT NULL, "spoolDigest" TEXT NOT NULL CHECK ("spoolDigest" ~ '^[a-f0-9]{64}$'),
 "spoolEnvelope" TEXT NOT NULL, "route" TEXT NOT NULL, "subject" JSONB NOT NULL,
 "requestDigest" TEXT NOT NULL CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'), "requestIdentity" TEXT NOT NULL,
 "principal" NAME NOT NULL, "pid" INTEGER NOT NULL CHECK ("pid">0), "backendStart" TIMESTAMPTZ NOT NULL,
 UNIQUE ("replayId","spoolDigest")
);
CREATE TABLE public."Pro262CapacityIssuanceRequest" (
 "issuanceKey" TEXT PRIMARY KEY, "qualificationId" TEXT NOT NULL, "qualificationGeneration" BIGINT NOT NULL,
 "replayId" TEXT NOT NULL UNIQUE, "spoolDigest" TEXT NOT NULL, "request" JSONB NOT NULL,
 "supervisorPrincipal" NAME NOT NULL, "host" TEXT NOT NULL, "boot" TEXT NOT NULL, "processTree" TEXT NOT NULL,
 "backendPrincipal" NAME NOT NULL, "backendPid" INTEGER NOT NULL CHECK ("backendPid">0), "backendStart" TIMESTAMPTZ NOT NULL,
 "parentEnvelope" TEXT NOT NULL, "producerClosure" TEXT NOT NULL CHECK ("producerClosure" ~ '^[a-f0-9]{64}$'), "expiresAt" TIMESTAMPTZ NOT NULL,
 FOREIGN KEY ("qualificationId","qualificationGeneration") REFERENCES public."Pro262CapacityQualification" ("qualificationId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("replayId","spoolDigest") REFERENCES public."Pro262CapacityReplayMiss" ("replayId","spoolDigest") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."Pro262CapacityDebit" (
 "issuanceKey" TEXT PRIMARY KEY REFERENCES public."Pro262CapacityIssuanceRequest" ("issuanceKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "physicalIdentity" TEXT NOT NULL, "proofIdentity" TEXT NOT NULL, "debit" NUMERIC NOT NULL CHECK ("debit">0 AND "debit"=pg_catalog.trunc("debit") AND "debit"::TEXT NOT IN ('NaN','Infinity','-Infinity'))
);
CREATE TABLE public."Pro262CapacityAdmission" (
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL CHECK ("fence">0), "issuanceKey" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityDebit" ("issuanceKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "qualificationId" TEXT NOT NULL, "qualificationGeneration" BIGINT NOT NULL,
 "approvalId" TEXT NOT NULL REFERENCES public."Pro262CapacityApproval" ("approvalId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "reuse" TEXT NOT NULL CHECK ("reuse" IN ('ONE_USE','REUSABLE')),
 "subject" JSONB NOT NULL, "principal" NAME NOT NULL, "pid" INTEGER NOT NULL CHECK ("pid">0), "backendStart" TIMESTAMPTZ NOT NULL,
 "host" TEXT NOT NULL, "boot" TEXT NOT NULL, "processTree" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL,
 "reservedBackendBytes" NUMERIC NOT NULL CHECK ("reservedBackendBytes">0 AND "reservedBackendBytes"=pg_catalog.trunc("reservedBackendBytes") AND "reservedBackendBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "reservedSharedBytes" NUMERIC NOT NULL CHECK ("reservedSharedBytes">0 AND "reservedSharedBytes"=pg_catalog.trunc("reservedSharedBytes") AND "reservedSharedBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "state" TEXT NOT NULL CHECK ("state" IN ('RESERVED','RUNNING','DRAINING','QUARANTINED','RELEASED')), "releasedReceiptId" TEXT,
 CHECK (("state"='RELEASED')=("releasedReceiptId" IS NOT NULL)),
 PRIMARY KEY ("admissionId","fence"), FOREIGN KEY ("qualificationId","qualificationGeneration") REFERENCES public."Pro262CapacityQualification" ("qualificationId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "Pro262CapacityAdmission_session_occupied" ON public."Pro262CapacityAdmission" ("principal","pid","backendStart") WHERE "state"<>'RELEASED';
CREATE UNIQUE INDEX "Pro262CapacityAdmission_one_use" ON public."Pro262CapacityAdmission" ("approvalId") WHERE "reuse"='ONE_USE';
CREATE UNIQUE INDEX "Pro262CapacityAdmission_process_occupied" ON public."Pro262CapacityAdmission" ("host","boot","processTree") WHERE "state"<>'RELEASED';
CREATE TABLE public."Pro262CapacityApplicability" (
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL, "qualificationId" TEXT NOT NULL, "qualificationGeneration" BIGINT NOT NULL,
 "metadata" JSONB NOT NULL, PRIMARY KEY ("admissionId","fence"),
 FOREIGN KEY ("admissionId","fence") REFERENCES public."Pro262CapacityAdmission"("admissionId","fence") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("qualificationId","qualificationGeneration") REFERENCES public."Pro262CapacityQualification"("qualificationId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION public.pro262_capacity_applicability_immutable() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE TRIGGER "Pro262CapacityApplicability_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityApplicability" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_applicability_immutable();
CREATE TABLE public."Pro262CapacityCleanupReceipt" (
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL, "supervisorGeneration" BIGINT NOT NULL CHECK ("supervisorGeneration">0), "receiptId" TEXT NOT NULL,
 "observerPrincipal" NAME NOT NULL, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL, "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'), "inputClaimId" TEXT NOT NULL,  "evidence" BYTEA NOT NULL,
 FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust" ("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT,
 PRIMARY KEY ("admissionId","fence","supervisorGeneration","receiptId"), UNIQUE ("admissionId","fence","receiptId"), UNIQUE ("admissionId","fence"),
 FOREIGN KEY ("admissionId","fence") REFERENCES public."Pro262CapacityAdmission" ("admissionId","fence") ON UPDATE RESTRICT ON DELETE RESTRICT
);
ALTER TABLE public."Pro262CapacityAdmission" ADD CONSTRAINT "Pro262CapacityAdmission_release_receipt_fk" FOREIGN KEY ("admissionId","fence","releasedReceiptId") REFERENCES public."Pro262CapacityCleanupReceipt" ("admissionId","fence","receiptId") ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE TABLE public."Pro262CapacityStageBinding" (
 "stageKind" TEXT NOT NULL CHECK ("stageKind" IN ('ENTA','PG')), "e3StageId" TEXT UNIQUE, "pgStageId" TEXT UNIQUE,
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL, "binding" JSONB NOT NULL,
 UNIQUE ("admissionId","fence"), CHECK (("stageKind"='ENTA' AND "e3StageId" IS NOT NULL AND "pgStageId" IS NULL) OR ("stageKind"='PG' AND "pgStageId" IS NOT NULL AND "e3StageId" IS NULL)),
 FOREIGN KEY ("e3StageId") REFERENCES public."E3StartReservation" ("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("pgStageId") REFERENCES public."HuroofSuccessorStartReservation" ("stageId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("admissionId","fence") REFERENCES public."Pro262CapacityAdmission" ("admissionId","fence") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."Pro262CapacitySetupIntent" (
 "namespace" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "setupKey" TEXT NOT NULL, "freshRoomId" TEXT NOT NULL, "createKey" TEXT NOT NULL,
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL, "binding" JSONB NOT NULL,
 PRIMARY KEY ("namespace","ownerId","setupKey","freshRoomId"), UNIQUE ("namespace","ownerId","createKey"), UNIQUE ("admissionId","fence"),
 FOREIGN KEY ("namespace","ownerId","setupKey","freshRoomId") REFERENCES public."HuroofSuccessorSetup" ("namespace","ownerId","setupKey","freshRoomId") ON UPDATE RESTRICT ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY ("admissionId","fence") REFERENCES public."Pro262CapacityAdmission" ("admissionId","fence") ON UPDATE RESTRICT ON DELETE RESTRICT
);
-- INCOMPLETE: protected writers, precharge, immutable guards, setup/stage hooks, wrappers,
-- deferred closure and complete effective ACL audit have not yet been authored.
CREATE FUNCTION public.pro262_capacity_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'CAPACITY_IMMUTABLE'; END $$;
CREATE TRIGGER "Pro262VerifiedSupplierReceipt_immutable" BEFORE UPDATE OR DELETE ON public."Pro262VerifiedSupplierReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityApproval_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityApproval" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityReplayMiss_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityReplayMiss" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityIssuanceRequest_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityIssuanceRequest" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityDebit_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityDebit" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityCleanupReceipt_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityCleanupReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacityStageBinding_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityStageBinding" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacitySetupIntent_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacitySetupIntent" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();

-- Guards are supplemental; DML must only be reachable through the eventual NOWAIT entrypoints.
CREATE FUNCTION public.pro262_capacity_admission_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'state'-'releasedReceiptId') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state'-'releasedReceiptId') OR (NEW."state"<>'RELEASED' AND NEW."releasedReceiptId" IS DISTINCT FROM OLD."releasedReceiptId") THEN
  RAISE EXCEPTION 'CAPACITY_IMMUTABLE';
 END IF;
 IF NOT ((OLD."state"='RESERVED' AND NEW."state" IN ('RUNNING','DRAINING','QUARANTINED')) OR
         (OLD."state"='RUNNING' AND NEW."state" IN ('DRAINING','QUARANTINED')) OR
         (OLD."state"='DRAINING' AND NEW."state" IN ('QUARANTINED','RELEASED')) OR
         (OLD."state"='QUARANTINED' AND NEW."state"='RELEASED')) THEN
  RAISE EXCEPTION 'CAPACITY_TRANSITION_DENIED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityAdmission_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_admission_guard();
CREATE FUNCTION public.pro262_capacity_trust_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'revoked') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'revoked') OR OLD."revoked" OR NOT NEW."revoked" THEN
  RAISE EXCEPTION 'CAPACITY_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityTrust_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityTrust" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_trust_guard();
CREATE FUNCTION public.pro262_capacity_qualification_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'enabled') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'enabled') OR NOT OLD."enabled" OR NEW."enabled" THEN
  RAISE EXCEPTION 'CAPACITY_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityQualification_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityQualification" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_qualification_guard();
CREATE FUNCTION public.pro262_capacity_control_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'state'-'releasedReplayReceiptId'-'releasedControlReceiptId') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state'-'releasedReplayReceiptId'-'releasedControlReceiptId') OR (NEW."state"<>'RELEASED' AND (NEW."releasedReplayReceiptId" IS DISTINCT FROM OLD."releasedReplayReceiptId" OR NEW."releasedControlReceiptId" IS DISTINCT FROM OLD."releasedControlReceiptId")) THEN
  RAISE EXCEPTION 'CAPACITY_IMMUTABLE';
 END IF;
 IF NOT ((OLD."state"='RESERVED' AND NEW."state" IN ('DRAINING','QUARANTINED')) OR
         (OLD."state"='DRAINING' AND NEW."state" IN ('QUARANTINED','RELEASED')) OR
         (OLD."state"='QUARANTINED' AND NEW."state"='RELEASED')) THEN
  RAISE EXCEPTION 'CAPACITY_TRANSITION_DENIED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityControlReservation_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityControlReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_control_guard();

-- This helper is unreachable until protected issuance, qualification, and exact role closure exist.
-- Its debit is derived exclusively from the protected qualified proof; no caller amount is accepted.
CREATE FUNCTION public.pro262_capacity_precharge(issuance_key TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 domain_row RECORD;
 issuance public."Pro262CapacityIssuanceRequest"%ROWTYPE;
 qualification public."Pro262CapacityQualification"%ROWTYPE;
 approval public."Pro262CapacityApproval"%ROWTYPE;
 trust public."Pro262CapacityTrust"%ROWTYPE;
 existing public."Pro262CapacityDebit"%ROWTYPE;
 outstanding NUMERIC; v_debit NUMERIC;
BEGIN
 IF issuance_key IS NULL OR issuance_key='' OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 -- Compatible with the accepted bootstrap table fence; no blocking global charge under Wallet.
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT "physicalIdentity","proofIdentity","capacity","committed","baseline" INTO domain_row FROM public."Pro311ControlDomain" WHERE "id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO issuance FROM public."Pro262CapacityIssuanceRequest" WHERE "issuanceKey"=issuance_key FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO existing FROM public."Pro262CapacityDebit" WHERE "issuanceKey"=issuance_key;
 IF FOUND THEN RETURN existing."issuanceKey"; END IF;
 SELECT * INTO qualification FROM public."Pro262CapacityQualification" WHERE "qualificationId"=issuance."qualificationId" AND "generation"=issuance."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT qualification."enabled" OR qualification."validUntil"<=pg_catalog.clock_timestamp() OR NOT public.pro262_capacity_validate_proof(qualification."proof") OR qualification."proofHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(qualification."proof"::TEXT,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO approval FROM public."Pro262CapacityApproval" WHERE "approvalId"=qualification."approvalId" FOR SHARE NOWAIT;
 IF NOT FOUND OR approval."validFrom">pg_catalog.clock_timestamp() OR approval."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" WHERE "trustId"=approval."trustId" AND "generation"=approval."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."revoked" OR trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() OR issuance."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF qualification."domain"<>domain_row."physicalIdentity" OR qualification."proof"->'physicalDomain'->>'identity' IS DISTINCT FROM domain_row."physicalIdentity" OR qualification."proof"->'physicalDomain'->>'proofIdentity' IS DISTINCT FROM domain_row."proofIdentity" OR pg_catalog.jsonb_typeof(qualification."proof"->'qualifiedLimits'->'storageDebit') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 BEGIN v_debit := (qualification."proof"->'qualifiedLimits'->>'storageDebit')::NUMERIC; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END;
 IF v_debit IS NULL OR v_debit<=0 OR v_debit::TEXT IN ('NaN','Infinity','-Infinity') OR v_debit<>pg_catalog.trunc(v_debit) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT COALESCE((SELECT pg_catalog.sum("reservedStorageBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedStorageBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0) INTO outstanding;
 IF domain_row."committed"+outstanding+v_debit>domain_row."capacity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityDebit"("issuanceKey","physicalIdentity","proofIdentity","debit") VALUES(issuance_key,domain_row."physicalIdentity",domain_row."proofIdentity",v_debit);
 UPDATE public."Pro311ControlDomain" SET "committed"="committed"+v_debit WHERE "id"='global-v1';
 RETURN issuance_key;
END $$;

-- Caller grants are absent until the complete capability audit is authored.
CREATE FUNCTION public.pro262_capacity_revoke(qualification_id TEXT,v_generation BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row public."Pro262CapacityQualification"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityQualification" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO old_row FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=qualification_id AND q."generation"=v_generation FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT old_row."enabled" THEN RETURN; END IF;
 UPDATE public."Pro262CapacityQualification" q SET "enabled"=FALSE WHERE q."qualificationId"=qualification_id AND q."generation"=v_generation;
END $$;
CREATE FUNCTION public.pro262_capacity_revoke_trust(trust_id TEXT,v_generation BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityTrust" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO old_row FROM public."Pro262CapacityTrust" t WHERE t."trustId"=trust_id AND t."generation"=v_generation FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF old_row."revoked" THEN RETURN; END IF;
 UPDATE public."Pro262CapacityTrust" t SET "revoked"=TRUE WHERE t."trustId"=trust_id AND t."generation"=v_generation;
END $$;
CREATE FUNCTION public.pro262_capacity_quarantine(admission_id TEXT,v_fence BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityAdmission" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO old_row FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=admission_id AND a."fence"=v_fence FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF old_row."state"='QUARANTINED' THEN RETURN; END IF;
 IF old_row."state"='RELEASED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 UPDATE public."Pro262CapacityAdmission" a SET "state"='QUARANTINED' WHERE a."admissionId"=admission_id AND a."fence"=v_fence;
END $$;

-- Closed proof shape only; this is not authentication or a physical qualification.
-- A protected publisher must additionally verify the original approval/evidence and holder schedule.
CREATE FUNCTION public.pro262_capacity_validate_proof(v_proof JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE key TEXT; v_value NUMERIC;
 identity_keys TEXT[]:=ARRAY['deployment','namespace','project','environment','sourceClosure','nativeClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'];
 holder_keys TEXT[]:=ARRAY['controlReplay','launchParentIpc','wrapper','nativeDiscovery','native23','native4','native5','pgPreparation','jsNativeDriverBackend','sqlNative','stageClosure','sharedTempSpill','durableWal','cleanup'];
 limit_keys TEXT[]:=ARRAY['backendBytes','sharedBytes','storageDebit','maxAllocation','stackBytes','parentBytes','concurrency'];
BEGIN
 IF pg_catalog.jsonb_typeof(v_proof) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof))<>21 OR
    NOT (v_proof ?& (identity_keys || ARRAY['physicalDomain','holderSchedule','qualifiedLimits','validity','overlapSchedule','schemaVersion','installationLane','installation','nativeApplicability','discoveryDomain'])) OR v_proof->>'schemaVersion' IS DISTINCT FROM 'pro262-applicability-v2' OR pg_catalog.jsonb_typeof(v_proof->'installationLane') IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(v_proof->'installation') IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(v_proof->'nativeApplicability') IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
 FOREACH key IN ARRAY identity_keys LOOP
  IF pg_catalog.jsonb_typeof(v_proof->key) IS DISTINCT FROM 'string' OR COALESCE(v_proof->>key,'')='' THEN RETURN FALSE; END IF;
 END LOOP;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'installationLane'))<>5 OR NOT ((v_proof->'installationLane') ?& ARRAY['deployment','namespace','project','environment','kind']) OR v_proof->'installationLane'->>'kind' IS DISTINCT FROM 'PRODUCER' OR v_proof->'installationLane'->>'deployment' IS DISTINCT FROM v_proof->>'deployment' OR v_proof->'installationLane'->>'namespace' IS DISTINCT FROM v_proof->>'namespace' OR v_proof->'installationLane'->>'project' IS DISTINCT FROM v_proof->>'project' OR v_proof->'installationLane'->>'environment' IS DISTINCT FROM v_proof->>'environment' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'installation'))<>18 OR NOT ((v_proof->'installation') ?& ARRAY['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack']) THEN RETURN FALSE; END IF;
 FOREACH key IN ARRAY ARRAY['nativeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack'] LOOP IF v_proof->'installation'->>key IS DISTINCT FROM v_proof->>key THEN RETURN FALSE; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(v_proof->'installation') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')) THEN RETURN FALSE; END IF;
 IF pg_catalog.jsonb_typeof(v_proof->'discoveryDomain') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'discoveryDomain'))<>4 OR NOT ((v_proof->'discoveryDomain') ?& ARRAY['kind','maxMetadataBytes','backendBytes','sharedBytes']) OR COALESCE(v_proof->'discoveryDomain'->>'kind','') NOT IN ('EXACT_PUBLISHED_HEAD','PINNED_MATCH','NONPLAYABLE_SETUP') THEN RETURN FALSE; END IF;
 FOREACH key IN ARRAY ARRAY['maxMetadataBytes','backendBytes','sharedBytes'] LOOP
  IF pg_catalog.jsonb_typeof(v_proof->'discoveryDomain'->key) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  v_value:=(v_proof->'discoveryDomain'->>key)::NUMERIC;IF v_value<=0 OR v_value<>pg_catalog.trunc(v_value) OR v_value::TEXT IN ('NaN','Infinity','-Infinity') THEN RETURN FALSE; END IF;
 END LOOP;
 IF (v_proof->'discoveryDomain'->>'backendBytes')::NUMERIC>(v_proof->'qualifiedLimits'->>'backendBytes')::NUMERIC OR (v_proof->'discoveryDomain'->>'sharedBytes')::NUMERIC>(v_proof->'qualifiedLimits'->>'sharedBytes')::NUMERIC OR (v_proof->'holderSchedule'->>'nativeDiscovery')::NUMERIC<=0 THEN RETURN FALSE; END IF;
 IF NOT public.pro262_capacity_valid_native_subject(v_proof->'nativeApplicability') OR v_proof->>'sourceClosure' !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(v_proof->'physicalDomain') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'physicalDomain'))<>2 OR
    NOT ((v_proof->'physicalDomain') ?& ARRAY['identity','proofIdentity']) OR
    COALESCE(v_proof->'physicalDomain'->>'identity','')='' OR COALESCE(v_proof->'physicalDomain'->>'proofIdentity','')='' OR
    pg_catalog.jsonb_typeof(v_proof->'overlapSchedule') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'overlapSchedule'))<>3 OR
    NOT ((v_proof->'overlapSchedule') ?& ARRAY['replayProfileId','replayProofHash','operationAccounting']) OR
    COALESCE(v_proof->'overlapSchedule'->>'replayProfileId','')='' OR COALESCE(v_proof->'overlapSchedule'->>'replayProofHash','') !~ '^[a-f0-9]{64}$' OR
    v_proof->'overlapSchedule'->>'operationAccounting' IS DISTINCT FROM 'INCREMENTAL_AFTER_REPLAY' OR
    pg_catalog.jsonb_typeof(v_proof->'holderSchedule') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'holderSchedule'))<>pg_catalog.array_length(holder_keys,1) OR
    NOT ((v_proof->'holderSchedule') ?& holder_keys) OR
    pg_catalog.jsonb_typeof(v_proof->'qualifiedLimits') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'qualifiedLimits'))<>pg_catalog.array_length(limit_keys,1) OR
    NOT ((v_proof->'qualifiedLimits') ?& limit_keys) OR
    pg_catalog.jsonb_typeof(v_proof->'validity') IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'validity'))<>2 OR
    NOT ((v_proof->'validity') ?& ARRAY['from','until']) OR
    pg_catalog.jsonb_typeof(v_proof->'validity'->'from') IS DISTINCT FROM 'string' OR
    pg_catalog.jsonb_typeof(v_proof->'validity'->'until') IS DISTINCT FROM 'string' OR
    (v_proof->'validity'->>'from') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR
    (v_proof->'validity'->>'until') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR
    (v_proof->'validity'->>'from')::TIMESTAMPTZ >= (v_proof->'validity'->>'until')::TIMESTAMPTZ THEN RETURN FALSE; END IF;
 FOREACH key IN ARRAY holder_keys LOOP
  IF pg_catalog.jsonb_typeof(v_proof->'holderSchedule'->key) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  v_value:=(v_proof->'holderSchedule'->>key)::NUMERIC;
  IF v_value<0 OR v_value::TEXT IN ('NaN','Infinity','-Infinity') OR v_value<>pg_catalog.trunc(v_value) THEN RETURN FALSE; END IF;
 END LOOP;
 FOREACH key IN ARRAY limit_keys LOOP
  IF pg_catalog.jsonb_typeof(v_proof->'qualifiedLimits'->key) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  v_value:=(v_proof->'qualifiedLimits'->>key)::NUMERIC;
  IF v_value<=0 OR v_value::TEXT IN ('NaN','Infinity','-Infinity') OR v_value<>pg_catalog.trunc(v_value) THEN RETURN FALSE; END IF;
 END LOOP;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;

-- Only owning native definers can submit metadata, after locking their actual
-- owning rows. The admitted producer cannot submit its own claimed applicability.
CREATE FUNCTION public.pro262_capacity_valid_native_subject(p_metadata JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_keys TEXT[]; v_key TEXT; v_engine TEXT; v_operation TEXT; v_protocol TEXT;
BEGIN
 IF pg_catalog.jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
 v_engine:=p_metadata->>'engine';v_operation:=p_metadata->>'operation';v_protocol:=p_metadata->>'protocol';
 IF v_engine='ENTA' AND v_operation='ENTA_SUCCESSOR' AND v_protocol IN ('2','3','4','5') THEN
  v_keys:=ARRAY['engine','operation','protocol','mode','format','rules','predecessorId','predecessorVersion','baseReleaseId','receiptId','baseRoot','sealHash','policyVersion','formatPolicyVersion','formatReleaseId','formatRoot','mediaRoot','competitiveReleaseId','competitiveProofRoot','competitivePaletteRoot','profile','custody'];
  IF pg_catalog.jsonb_typeof(p_metadata->'protocol') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(p_metadata->'predecessorVersion') NOT IN ('number','null') THEN RETURN FALSE; END IF;
  IF p_metadata->'profile' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'custody' IS DISTINCT FROM 'null'::JSONB THEN RETURN FALSE; END IF;
  FOREACH v_key IN ARRAY ARRAY['formatPolicyVersion','formatReleaseId','formatRoot','mediaRoot','competitiveReleaseId','competitiveProofRoot','competitivePaletteRoot'] LOOP IF p_metadata->v_key IS DISTINCT FROM 'null'::JSONB AND (pg_catalog.jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'string' OR COALESCE(p_metadata->>v_key,'') IN ('','*')) THEN RETURN FALSE; END IF; END LOOP;
  IF v_protocol IN ('2','3') AND (p_metadata->'formatPolicyVersion' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'formatReleaseId' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'formatRoot' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'mediaRoot' IS DISTINCT FROM 'null'::JSONB) THEN RETURN FALSE; END IF;
  IF v_protocol<>'5' AND (p_metadata->'competitiveReleaseId' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'competitiveProofRoot' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'competitivePaletteRoot' IS DISTINCT FROM 'null'::JSONB) THEN RETURN FALSE; END IF;
  IF v_protocol='4' AND (COALESCE(p_metadata->>'formatPolicyVersion','')='' OR COALESCE(p_metadata->>'formatReleaseId','')='' OR COALESCE(p_metadata->>'formatRoot','')='' OR COALESCE(p_metadata->>'mediaRoot','')='') THEN RETURN FALSE; END IF;
  IF v_protocol='5' AND (COALESCE(p_metadata->>'formatPolicyVersion','')='' OR COALESCE(p_metadata->>'formatReleaseId','')='' OR COALESCE(p_metadata->>'formatRoot','')='' OR COALESCE(p_metadata->>'mediaRoot','')='' OR COALESCE(p_metadata->>'competitiveReleaseId','')='' OR COALESCE(p_metadata->>'competitiveProofRoot','')='' OR COALESCE(p_metadata->>'competitivePaletteRoot','')='') THEN RETURN FALSE; END IF;
  FOREACH v_key IN ARRAY ARRAY['mode','format','rules','predecessorId','baseReleaseId','receiptId','baseRoot','sealHash','policyVersion'] LOOP IF pg_catalog.jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'string' OR COALESCE(p_metadata->>v_key,'') IN ('','*') THEN RETURN FALSE; END IF; END LOOP;
 ELSIF v_engine='PG' AND v_operation='PG_SETUP' THEN
  v_keys:=ARRAY['engine','operation','protocol','namespace','owner','policyRevision','policyHash','parentMatchId','resultVersion','resultHash','requestedConfig','activeCatalog','profile','custody','matchPin'];
  IF p_metadata->'activeCatalog' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'profile' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'custody' IS DISTINCT FROM 'null'::JSONB OR p_metadata->'matchPin' IS DISTINCT FROM 'null'::JSONB OR pg_catalog.jsonb_typeof(p_metadata->'requestedConfig') IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
 ELSIF v_engine='PG' AND v_operation='PG_START' THEN
  v_keys:=ARRAY['engine','operation','protocol','namespace','owner','policyRevision','policyHash','roomId','roomGeneration','roomRevision','activeCatalog','profile','custody','matchPin'];
  IF pg_catalog.jsonb_typeof(p_metadata->'profile') IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(p_metadata->'custody') IS DISTINCT FROM 'object' OR (pg_catalog.jsonb_typeof(p_metadata->'matchPin') NOT IN ('object','null')) OR (pg_catalog.jsonb_typeof(p_metadata->'matchPin')='null' AND pg_catalog.jsonb_typeof(p_metadata->'activeCatalog') IS DISTINCT FROM 'object') OR (pg_catalog.jsonb_typeof(p_metadata->'matchPin')='object' AND p_metadata->'activeCatalog' IS DISTINCT FROM 'null'::JSONB) THEN RETURN FALSE; END IF;
 ELSE RETURN FALSE; END IF;
 IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_metadata))<>pg_catalog.array_length(v_keys,1) OR NOT (p_metadata ?& v_keys) THEN RETURN FALSE; END IF;
 IF v_engine='PG' THEN
  IF p_metadata->'protocol' IS DISTINCT FROM 'null'::JSONB THEN RETURN FALSE; END IF;
  FOREACH v_key IN ARRAY ARRAY['namespace','owner','policyRevision','policyHash'] LOOP IF pg_catalog.jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'string' OR COALESCE(p_metadata->>v_key,'') IN ('','*') THEN RETURN FALSE; END IF; END LOOP;
  IF v_operation='PG_SETUP' THEN
   FOREACH v_key IN ARRAY ARRAY['parentMatchId','resultVersion','resultHash'] LOOP IF pg_catalog.jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'string' OR COALESCE(p_metadata->>v_key,'') IN ('','*') THEN RETURN FALSE; END IF; END LOOP;
  ELSE
   FOREACH v_key IN ARRAY ARRAY['roomId','roomGeneration','roomRevision'] LOOP IF pg_catalog.jsonb_typeof(p_metadata->v_key) IS DISTINCT FROM 'string' OR COALESCE(p_metadata->>v_key,'') IN ('','*') THEN RETURN FALSE; END IF; END LOOP;
   IF pg_catalog.jsonb_typeof(p_metadata->'activeCatalog')='object' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_metadata->'activeCatalog'))<>6 OR NOT ((p_metadata->'activeCatalog') ?& ARRAY['catalogReleaseId','releaseRootHash','validationReceiptId','sealHash','huroofReleaseId','huroofRootSha256']) OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_metadata->'activeCatalog') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')) THEN RETURN FALSE; END IF;
   END IF;
   IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_metadata->'profile'))<>7 OR NOT ((p_metadata->'profile') ?& ARRAY['scope','family','sourceId','revision','rawArtifactId','rawArtifactHash','pointerVersion']) OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_metadata->'custody'))<>4 OR NOT ((p_metadata->'custody') ?& ARRAY['sourceId','revision','rawArtifactHash','pointerVersion']) THEN RETURN FALSE; END IF;
   IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_metadata->'profile') e WHERE ((e.key<>'pointerVersion' OR pg_catalog.jsonb_typeof(p_metadata->'matchPin')<>'object') AND (pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*'))) OR (e.key='pointerVersion' AND pg_catalog.jsonb_typeof(p_metadata->'matchPin')='object' AND e.value IS DISTINCT FROM 'null'::JSONB)) OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_metadata->'custody') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')) THEN RETURN FALSE; END IF;
   IF pg_catalog.jsonb_typeof(p_metadata->'matchPin')='object' THEN
    IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_metadata->'matchPin'))<>9 OR NOT ((p_metadata->'matchPin') ?& ARRAY['matchId','profileFamily','profileSourceId','profileRevision','profileRawArtifactId','profileRawArtifactHash','catalogReleaseId','releaseRootHash','catalogSealHash']) OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_metadata->'matchPin') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')) THEN RETURN FALSE; END IF;
   END IF;
  END IF;
 END IF;
 RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.pro262_capacity_owner_request(p_admission_id TEXT,p_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_admission public."Pro262CapacityAdmission"%ROWTYPE; v_request JSONB;
BEGIN
 SELECT * INTO STRICT v_admission FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=p_admission_id AND a."fence"=p_fence AND a."principal"=SESSION_USER::NAME AND a."pid"=pg_catalog.pg_backend_pid() AND a."backendStart"=public.pro262_capacity_backend_start() AND a."state"='RUNNING' FOR SHARE NOWAIT;
 PERFORM public.pro262_capacity_recheck(p_admission_id,p_fence);
 SELECT spool."request" INTO STRICT v_request FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" AND m."spoolDigest"=i."spoolDigest" JOIN public."Pro262CapacitySpool" spool ON spool."spoolId"=m."spoolId" AND spool."replayId"=m."replayId" WHERE i."issuanceKey"=v_admission."issuanceKey";
 RETURN v_request;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_owner_fence(p_admission_id TEXT) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_admission public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v_admission FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=p_admission_id AND a."principal"=SESSION_USER::NAME AND a."pid"=pg_catalog.pg_backend_pid() AND a."backendStart"=public.pro262_capacity_backend_start() AND a."state"='RUNNING' FOR SHARE NOWAIT;
 PERFORM public.pro262_capacity_recheck(v_admission."admissionId",v_admission."fence"); RETURN v_admission."fence";
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE FUNCTION public.pro262_capacity_owner_discovery(p_admission_id TEXT,p_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_admission public."Pro262CapacityAdmission"%ROWTYPE; v_proof JSONB;
BEGIN
 SELECT * INTO STRICT v_admission FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=p_admission_id AND a."fence"=p_fence AND a."principal"=SESSION_USER::NAME AND a."pid"=pg_catalog.pg_backend_pid() AND a."backendStart"=public.pro262_capacity_backend_start() AND a."state"='RUNNING' FOR SHARE NOWAIT;
 PERFORM public.pro262_capacity_recheck(p_admission_id,p_fence);
 SELECT q."proof" INTO STRICT v_proof FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=v_admission."qualificationId" AND q."generation"=v_admission."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT public.pro262_capacity_validate_proof(v_proof) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF; RETURN v_proof->'discoveryDomain';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE FUNCTION public.pro262_capacity_owner_context(p_admission_id TEXT,p_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_admission public."Pro262CapacityAdmission"%ROWTYPE; v_context JSONB;
BEGIN
 SELECT * INTO STRICT v_admission FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=p_admission_id AND a."fence"=p_fence AND a."principal"=SESSION_USER::NAME AND a."pid"=pg_catalog.pg_backend_pid() AND a."backendStart"=public.pro262_capacity_backend_start() AND a."state"='RUNNING' FOR SHARE NOWAIT;
 PERFORM public.pro262_capacity_recheck(p_admission_id,p_fence);
 SELECT r."context" INTO STRICT v_context FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplay" r ON r."replayId"=i."replayId" WHERE i."issuanceKey"=v_admission."issuanceKey";
 RETURN v_context;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE FUNCTION public.pro262_capacity_assert_native_subject(p_metadata JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_admission public."Pro262CapacityAdmission"%ROWTYPE; v_qualification public."Pro262CapacityQualification"%ROWTYPE; v_prior public."Pro262CapacityApplicability"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v_admission FROM public."Pro262CapacityAdmission" a WHERE a."principal"=SESSION_USER::NAME AND a."pid"=pg_catalog.pg_backend_pid() AND a."backendStart"=public.pro262_capacity_backend_start() AND a."state"='RUNNING' FOR SHARE NOWAIT;
 PERFORM public.pro262_capacity_recheck(v_admission."admissionId",v_admission."fence");
 SELECT * INTO STRICT v_qualification FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=v_admission."qualificationId" AND q."generation"=v_admission."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT public.pro262_capacity_valid_native_subject(p_metadata) OR v_qualification."proof"->'nativeApplicability' IS DISTINCT FROM p_metadata OR p_metadata->>'operation' IS DISTINCT FROM v_admission."subject"->>'operation' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO v_prior FROM public."Pro262CapacityApplicability" x WHERE x."admissionId"=v_admission."admissionId" AND x."fence"=v_admission."fence";
 IF FOUND THEN IF v_prior."qualificationId" IS DISTINCT FROM v_admission."qualificationId" OR v_prior."qualificationGeneration" IS DISTINCT FROM v_admission."qualificationGeneration" OR v_prior."metadata" IS DISTINCT FROM p_metadata THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN; END IF;
 INSERT INTO public."Pro262CapacityApplicability"("admissionId","fence","qualificationId","qualificationGeneration","metadata") VALUES(v_admission."admissionId",v_admission."fence",v_admission."qualificationId",v_admission."qualificationGeneration",p_metadata);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
-- Consumer checks always derive the backend from the current session; input identifiers only narrow matches.
CREATE FUNCTION public.pro262_capacity_recheck(admission_id TEXT,v_fence BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE;
        approval public."Pro262CapacityApproval"%ROWTYPE; trust public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR SHARE NOWAIT;
 IF NOT FOUND OR a."state" NOT IN ('RESERVED','RUNNING') OR a."expiresAt"<=pg_catalog.clock_timestamp() OR
    a."principal" IS DISTINCT FROM SESSION_USER::NAME OR a."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR
    a."backendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_process_installation((SELECT r."controlKey" FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplay" r ON r."replayId"=i."replayId" WHERE i."issuanceKey"=a."issuanceKey"),'PRODUCER');
 SELECT * INTO q FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=a."qualificationId" AND x."generation"=a."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT q."enabled" OR q."validUntil"<=pg_catalog.clock_timestamp() OR q."approvalId" IS DISTINCT FROM a."approvalId" OR NOT public.pro262_capacity_validate_proof(q."proof") OR q."sourceClosure" IS DISTINCT FROM q."proof"->>'sourceClosure' OR q."proofHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(q."proof"::TEXT,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO approval FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=a."approvalId" FOR SHARE NOWAIT;
 IF NOT FOUND OR approval."reuse" IS DISTINCT FROM a."reuse" OR approval."validFrom">pg_catalog.clock_timestamp() OR approval."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=approval."trustId" AND x."generation"=approval."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."revoked" OR trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.pro262_capacity_resolve(v_namespace TEXT,identity_id TEXT,v_operation TEXT,request_digest TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 IF v_namespace IS NULL OR identity_id IS NULL OR v_operation IS NULL OR request_digest IS NULL OR request_digest !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."principal"=SESSION_USER::NAME AND x."pid"=pg_catalog.pg_backend_pid() AND x."backendStart"=public.pro262_capacity_backend_start() AND x."state"='RUNNING' FOR SHARE NOWAIT;
 IF a."subject"->>'namespace' IS DISTINCT FROM v_namespace OR a."subject"->>'owner' IS DISTINCT FROM identity_id OR a."subject"->>'operation' IS DISTINCT FROM v_operation OR a."subject"->>'requestDigest' IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_recheck(a."admissionId",a."fence");
 RETURN a."admissionId";
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- The qualified cleanup channel must be separately configured; no trust rows are seeded.
-- Ingestion records exact original observer evidence, after protected session/subject joins.
CREATE FUNCTION public.pro262_capacity_accept_cleanup(admission_id TEXT,v_fence BIGINT,receipt_id TEXT,p_input_claim_id TEXT,v_observation JSONB,p_captured BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; trust public."Pro262CapacityTrust"%ROWTYPE;
        prior public."Pro262CapacityCleanupReceipt"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE; evidence_bytes BYTEA; observed_generation BIGINT;
BEGIN
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'OPERATION_CLEANUP',pg_catalog.octet_length(pg_catalog.convert_to(admission_id,'UTF8'))::TEXT||':'||admission_id||pg_catalog.octet_length(pg_catalog.convert_to(v_fence::TEXT,'UTF8'))::TEXT||':'||v_fence::TEXT||pg_catalog.octet_length(pg_catalog.convert_to(receipt_id,'UTF8'))::TEXT||':'||receipt_id,GREATEST(pg_catalog.octet_length(v_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" cl JOIN public."Pro262CapacityObserverInputReservation" sl ON sl."reservationId"=cl."reservationId" WHERE cl."inputClaimId"=p_input_claim_id AND sl."observerTrustId"=v_observation->>'trustId' AND sl."observerTrustGeneration"::TEXT=v_observation->>'observerGeneration') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" JOIN public."Pro262CapacityAdmission" a ON a."admissionId"=admission_id AND a."fence"=v_fence JOIN public."Pro262CapacityIssuanceRequest" i ON i."issuanceKey"=a."issuanceKey" JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=m."controlKey" AND slot."record"->>'targetKind'='PRODUCER' ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM v_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF receipt_id IS NULL OR receipt_id='' OR pg_catalog.jsonb_typeof(v_observation) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_observation))<>14 OR NOT (v_observation ?& ARRAY['host','boot','processTree','backendPrincipal','backendPid','backendStart','outcome','protocolDrain','IPCDrain','parentDrain','termination','observerGeneration','evidence','trustId']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR SHARE NOWAIT;
 IF NOT FOUND OR a."state" NOT IN ('DRAINING','QUARANTINED','RELEASED') OR
    NOT EXISTS(SELECT 1 FROM public."Pro262CapacityDebit" d WHERE d."issuanceKey"=a."issuanceKey") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=(SELECT m."controlKey" FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE i."issuanceKey"=a."issuanceKey") AND o."kind"='PRODUCER' AND o."targetOid"=l."principalOid" AND (a."principal",a."pid",a."backendStart",a."host",a."boot",a."processTree")=(o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO q FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=a."qualificationId" AND x."generation"=a."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT public.pro262_capacity_validate_proof(q."proof") OR (pg_catalog.octet_length(v_observation::TEXT)::NUMERIC+pg_catalog.octet_length(receipt_id)::NUMERIC)>(q."proof"->'holderSchedule'->>'cleanup')::NUMERIC THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 observed_generation:=(v_observation->>'observerGeneration')::BIGINT;
 evidence_bytes:=pg_catalog.decode(v_observation->>'evidence','base64');
 IF observed_generation<=0 OR pg_catalog.octet_length(evidence_bytes)=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;

 SELECT * INTO trust FROM public."Pro262CapacityTrust" t WHERE t."trustId"=v_observation->>'trustId' AND t."generation"=observed_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."purpose"<>'CLEANUP_OBSERVATION' OR trust."revoked" OR trust."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR
    trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() OR
    trust."scope"->>'host' IS DISTINCT FROM a."host" OR trust."scope"->>'boot' IS DISTINCT FROM a."boot" OR
    v_observation->>'host' IS DISTINCT FROM a."host" OR v_observation->>'boot' IS DISTINCT FROM a."boot" OR v_observation->>'processTree' IS DISTINCT FROM a."processTree" OR
    v_observation->>'backendPrincipal' IS DISTINCT FROM a."principal"::TEXT OR (v_observation->>'backendPid')::INTEGER IS DISTINCT FROM a."pid" OR
    (v_observation->>'backendStart')::TIMESTAMPTZ IS DISTINCT FROM a."backendStart" OR COALESCE(v_observation->>'outcome','') NOT IN ('COMMITTED','ROLLED_BACK') OR
    v_observation->'protocolDrain' IS DISTINCT FROM 'true'::JSONB OR v_observation->'IPCDrain' IS DISTINCT FROM 'true'::JSONB OR
    v_observation->'parentDrain' IS DISTINCT FROM 'true'::JSONB OR v_observation->'termination' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262CapacityCleanupReceipt" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence AND x."supervisorGeneration"=observed_generation AND x."receiptId"=receipt_id;
 IF FOUND THEN
  IF prior."inputClaimId" IS DISTINCT FROM p_input_claim_id OR prior."captured" IS DISTINCT FROM p_captured OR prior."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR prior."trustId" IS DISTINCT FROM trust."trustId" OR prior."observation" IS DISTINCT FROM v_observation OR prior."evidence" IS DISTINCT FROM evidence_bytes THEN RAISE EXCEPTION 'CAPACITY_CONFLICT'; END IF;
  RETURN receipt_id;
 END IF;
 IF a."state"='RELEASED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityCleanupReceipt"("admissionId","fence","supervisorGeneration","receiptId","observerPrincipal","trustId","trustGeneration","observation","captured","capturedHash","inputClaimId","evidence") VALUES(admission_id,v_fence,observed_generation,receipt_id,SESSION_USER::NAME,trust."trustId",trust."generation",v_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),p_input_claim_id,evidence_bytes);
 RETURN receipt_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

CREATE FUNCTION public.pro262_capacity_release(admission_id TEXT,v_fence BIGINT,cleanup_receipt_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; receipt public."Pro262CapacityCleanupReceipt"%ROWTYPE; trust public."Pro262CapacityTrust"%ROWTYPE; owner_control TEXT; control_row public."Pro262CapacityControlReservation"%ROWTYPE; scope_row RECORD;
BEGIN
 SELECT r."controlKey" INTO STRICT owner_control FROM public."Pro262CapacityAdmission" a0 JOIN public."Pro262CapacityIssuanceRequest" i ON i."issuanceKey"=a0."issuanceKey" JOIN public."Pro262CapacityReplay" r ON r."replayId"=i."replayId" WHERE a0."admissionId"=admission_id AND a0."fence"=v_fence;
 SELECT * INTO STRICT control_row FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=owner_control FOR UPDATE NOWAIT;
 LOCK TABLE public."Pro262CapacityAdmission" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF a."state"='RELEASED' THEN
  IF a."releasedReceiptId" IS DISTINCT FROM cleanup_receipt_id THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN;
 END IF;
 IF a."state" NOT IN ('DRAINING','QUARANTINED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=(SELECT m."controlKey" FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE i."issuanceKey"=a."issuanceKey") AND o."kind"='PRODUCER' AND o."targetOid"=l."principalOid" AND (a."principal",a."pid",a."backendStart",a."host",a."boot",a."processTree")=(o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT receipt FROM public."Pro262CapacityCleanupReceipt" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence AND x."receiptId"=cleanup_receipt_id FOR SHARE NOWAIT;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=receipt."trustId" AND x."generation"=receipt."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."purpose"<>'CLEANUP_OBSERVATION' OR trust."revoked" OR trust."supplierPrincipal" IS DISTINCT FROM receipt."observerPrincipal" OR
    trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() OR
    trust."scope"->>'host' IS DISTINCT FROM a."host" OR trust."scope"->>'boot' IS DISTINCT FROM a."boot" OR
    receipt."observation"->>'processTree' IS DISTINCT FROM a."processTree" OR public.pro262_capacity_backend_live(a."principal",a."pid",a."backendStart") IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF control_row."state"<>'QUARANTINED' OR (SELECT pg_catalog.count(*) FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=owner_control AND l."state"='SEALED')<>2 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT scope_row FROM public."Pro262CapacityClosedScopeReceipt" x WHERE x."controlKey"=owner_control;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=scope_row."trustId" AND x."generation"=scope_row."generation" FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."purpose"<>'CLEANUP_OBSERVATION' OR trust."supplierPrincipal" IS DISTINCT FROM scope_row."observerPrincipal" OR trust."revoked" OR trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() OR public.pro262_capacity_control_backends_absent(owner_control) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 UPDATE public."Pro262CapacityAdmission" x SET "state"='RELEASED',"releasedReceiptId"=cleanup_receipt_id WHERE x."admissionId"=admission_id AND x."fence"=v_fence;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- A separately qualified, externally provisioned baseline must include these rows, their
-- indices/WAL and every charge transition. This relation starts empty. Its protected
-- provisioning/authentication and installation-time proof are not implemented yet.
CREATE TABLE public."Pro262CapacityControlBaseline" (
 "kind" TEXT PRIMARY KEY, "physicalIdentity" TEXT NOT NULL, "controlProofIdentity" TEXT NOT NULL,
 "coverageEvidenceHash" TEXT NOT NULL CHECK ("coverageEvidenceHash" ~ '^[a-f0-9]{64}$'),
 "allocated" NUMERIC NOT NULL CHECK ("allocated">0 AND "allocated"=pg_catalog.trunc("allocated") AND "allocated"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "archiveBaselineUsed" NUMERIC NOT NULL CHECK ("archiveBaselineUsed">=0 AND "archiveBaselineUsed"=pg_catalog.trunc("archiveBaselineUsed") AND "archiveBaselineUsed"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "eventWorstCase" NUMERIC NOT NULL CHECK ("eventWorstCase">0 AND "eventWorstCase"=pg_catalog.trunc("eventWorstCase") AND "eventWorstCase"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "coverageContract" TEXT NOT NULL, "maxClosedScopeBytes" NUMERIC NOT NULL CHECK ("maxClosedScopeBytes">0 AND "maxClosedScopeBytes"=pg_catalog.trunc("maxClosedScopeBytes") AND "maxClosedScopeBytes"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "spent" NUMERIC NOT NULL DEFAULT 0 CHECK ("spent">=0 AND "spent"<="allocated" AND "spent"=pg_catalog.trunc("spent") AND "spent"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "enabled" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public."Pro262CapacityControlCharge" (
 "kind" TEXT NOT NULL REFERENCES public."Pro262CapacityControlBaseline" ("kind") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "eventKey" TEXT NOT NULL, "bindingHash" TEXT NOT NULL CHECK ("bindingHash" ~ '^[a-f0-9]{64}$'),
 "amount" NUMERIC NOT NULL CHECK ("amount">0 AND "amount"=pg_catalog.trunc("amount") AND "amount"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 PRIMARY KEY ("kind","eventKey")
);
ALTER TABLE public."Pro262CapacityControlReservation" ADD COLUMN "controlChargeKind" TEXT NOT NULL, ADD COLUMN "controlChargeEventKey" TEXT NOT NULL;
ALTER TABLE public."Pro262CapacityControlReservation" ADD CONSTRAINT "Pro262CapacityControlReservation_charge_fk" FOREIGN KEY ("controlChargeKind","controlChargeEventKey") REFERENCES public."Pro262CapacityControlCharge"("kind","eventKey") ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE TRIGGER "Pro262CapacityControlCharge_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityControlCharge" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_control_baseline_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'spent'-'enabled') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'spent'-'enabled') OR
    NEW."spent"<OLD."spent" OR (NOT OLD."enabled" AND NEW."enabled") OR
    (NEW."spent"=OLD."spent" AND NEW."enabled"=OLD."enabled") THEN RAISE EXCEPTION 'CAPACITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityControlBaseline_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityControlBaseline" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_control_baseline_guard();
-- Owner-only. Caller supplies an identity, never an amount. Each event binds immutable
-- actual payload/subject hash; conflicting reuse fails and exact replay causes no write.
CREATE FUNCTION public.pro262_capacity_control_charge(v_kind TEXT,event_key TEXT,binding_hash TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public."Pro262CapacityControlBaseline"%ROWTYPE; c public."Pro262CapacityControlCharge"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
        domain_row RECORD;
BEGIN
 IF v_kind IS NULL OR v_kind='' OR event_key IS NULL OR event_key='' OR binding_hash IS NULL OR binding_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT "physicalIdentity","proofIdentity","capacity","committed","baseline" INTO domain_row FROM public."Pro311ControlDomain" WHERE "id"='global-v1';
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='CONTROL_ALLOCATOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND x."scope"->>'kind'=v_kind FOR SHARE NOWAIT;
 IF t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro262CapacityControlBaseline" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO b FROM public."Pro262CapacityControlBaseline" x WHERE x."kind"=v_kind FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT b."enabled" OR b."physicalIdentity" IS DISTINCT FROM domain_row."physicalIdentity" OR b."controlProofIdentity" IS DISTINCT FROM domain_row."proofIdentity" OR b."allocated">domain_row."baseline" OR
    b."archiveBaselineUsed"+(SELECT COALESCE(pg_catalog.sum(x."allocated"),0) FROM public."Pro262CapacityControlBaseline" x WHERE x."physicalIdentity"=b."physicalIdentity")>domain_row."baseline" OR
    EXISTS(SELECT 1 FROM public."Pro262CapacityControlBaseline" x WHERE x."physicalIdentity"=b."physicalIdentity" AND (x."coverageEvidenceHash" IS DISTINCT FROM b."coverageEvidenceHash" OR x."archiveBaselineUsed" IS DISTINCT FROM b."archiveBaselineUsed")) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlCharge" x WHERE x."kind"=v_kind AND x."eventKey"=event_key;
 IF FOUND THEN
  IF c."bindingHash" IS DISTINCT FROM binding_hash OR c."amount" IS DISTINCT FROM b."eventWorstCase" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN;
 END IF;
 IF b."spent"+b."eventWorstCase">b."allocated" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityControlCharge" ("kind","eventKey","bindingHash","amount") VALUES (v_kind,event_key,binding_hash,b."eventWorstCase");
 UPDATE public."Pro262CapacityControlBaseline" x SET "spent"=x."spent"+b."eventWorstCase" WHERE x."kind"=v_kind;
END $$;

CREATE TABLE public."Pro262CapacityPhysicalDomain" (
 "physicalIdentity" TEXT PRIMARY KEY, "proofIdentity" TEXT NOT NULL, "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'),
 "backendCapacity" NUMERIC NOT NULL CHECK ("backendCapacity">0 AND "backendCapacity"=pg_catalog.trunc("backendCapacity") AND "backendCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "sharedCapacity" NUMERIC NOT NULL CHECK ("sharedCapacity">0 AND "sharedCapacity"=pg_catalog.trunc("sharedCapacity") AND "sharedCapacity"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "baselineBackend" NUMERIC NOT NULL CHECK ("baselineBackend">=0 AND "baselineBackend"=pg_catalog.trunc("baselineBackend") AND "baselineBackend"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "baselineShared" NUMERIC NOT NULL CHECK ("baselineShared">=0 AND "baselineShared"=pg_catalog.trunc("baselineShared") AND "baselineShared"::TEXT NOT IN ('NaN','Infinity','-Infinity')),
 "nextFence" BIGINT NOT NULL DEFAULT 0 CHECK ("nextFence">=0), "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
 CHECK ("baselineBackend"<="backendCapacity" AND "baselineShared"<="sharedCapacity")
);

CREATE TABLE public."Pro262CapacityReplayProfile" (
 "id" TEXT PRIMARY KEY, "proof" JSONB NOT NULL, "proofHash" TEXT NOT NULL CHECK ("proofHash" ~ '^[a-f0-9]{64}$'),
 "physicalIdentity" TEXT NOT NULL, "proofIdentity" TEXT NOT NULL, "sourceClosure" TEXT NOT NULL CHECK ("sourceClosure" ~ '^[a-f0-9]{64}$'),
 "maxBodyBytes" NUMERIC NOT NULL CHECK ("maxBodyBytes">0 AND "maxBodyBytes"=pg_catalog.trunc("maxBodyBytes") AND "maxBodyBytes"<=9007199254740991),
 "reservedBackendBytes" NUMERIC NOT NULL CHECK ("reservedBackendBytes">0 AND "reservedBackendBytes"=pg_catalog.trunc("reservedBackendBytes")),
 "reservedSharedBytes" NUMERIC NOT NULL CHECK ("reservedSharedBytes">0 AND "reservedSharedBytes"=pg_catalog.trunc("reservedSharedBytes")),
 "validUntil" TIMESTAMPTZ NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public."Pro262CapacityBootstrapReplayProfile" (
 "id" TEXT PRIMARY KEY, "publisherPrincipal" NAME NOT NULL, "proofHash" TEXT NOT NULL CHECK ("proofHash" ~ '^[a-f0-9]{64}$'),
 "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "validUntil" TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER "Pro262CapacityBootstrapReplayProfile_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityBootstrapReplayProfile" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TABLE public."Pro262CapacityReplay" (
 "replayId" TEXT PRIMARY KEY, "controlKey" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "operation" TEXT NOT NULL CHECK ("operation" IN ('ENTA_SUCCESSOR','PG_SETUP','PG_START')),
 "context" JSONB NOT NULL, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "supervisorPrincipal" NAME NOT NULL, "supervisorPid" INTEGER NOT NULL CHECK ("supervisorPid">0), "supervisorBackendStart" TIMESTAMPTZ NOT NULL,
 "executorPrincipal" NAME NOT NULL, "executorPid" INTEGER NOT NULL CHECK ("executorPid">0), "executorBackendStart" TIMESTAMPTZ NOT NULL,
 "executorHost" TEXT NOT NULL, "executorBoot" TEXT NOT NULL, "executorProcessTree" TEXT NOT NULL,
 "replayProofIdentity" TEXT NOT NULL REFERENCES public."Pro262CapacityReplayProfile"("id") ON UPDATE RESTRICT ON DELETE RESTRICT, "reservedBackendBytes" NUMERIC NOT NULL CHECK ("reservedBackendBytes">0), "reservedSharedBytes" NUMERIC NOT NULL CHECK ("reservedSharedBytes">0), "expiresAt" TIMESTAMPTZ NOT NULL,
 FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Called after the wrapper's second exact replay and parent checks, before native create.
-- Request JSON is candidate material; every identity is recomputed from protected Source.
CREATE FUNCTION public.pro262_capacity_setup_intent(c JSONB,r JSONB,v_state JSONB,fresh_room_id TEXT,create_key TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE resolved TEXT; a public."Pro262CapacityAdmission"%ROWTYPE; issuance public."Pro262CapacityIssuanceRequest"%ROWTYPE; replay public."Pro262CapacityReplay"%ROWTYPE; derived JSONB; parent JSONB; native_intent JSONB; request_hash TEXT;
BEGIN
 PERFORM public.eng03_06_context(c);
 PERFORM public.eng03_06_setup_request(r);
 IF pg_catalog.jsonb_typeof(v_state) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 request_hash:=public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-setup-v1','request',r));
 resolved:=public.pro262_capacity_resolve(c->>'namespace',c->>'identityId','PG_SETUP',request_hash);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=resolved AND x."principal"=SESSION_USER::NAME AND x."pid"=pg_catalog.pg_backend_pid() AND x."backendStart"=public.pro262_capacity_backend_start() AND x."state" IN ('RESERVED','RUNNING') FOR SHARE NOWAIT;
 SELECT * INTO STRICT issuance FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT replay FROM public."Pro262CapacityReplay" x WHERE x."replayId"=issuance."replayId";
 IF a."subject"->>'project' IS DISTINCT FROM c->>'projectId' OR replay."context" IS DISTINCT FROM c THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF create_key IS DISTINCT FROM public.eng03_06_create_key(c,r->>'setupKey') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 derived:=public.eng03_03_create_identity(c->>'namespace',c->>'projectId',c->>'identityId',create_key);
 IF fresh_room_id IS DISTINCT FROM derived->>'roomId' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 parent:=public.eng03_06_assert_parent(c->>'namespace',c->>'identityId',r->>'parentMatchId',(r->>'expectedResultVersion')::BIGINT,r->>'expectedResultHash');
 native_intent:=pg_catalog.jsonb_build_object('type','CREATE_ROOM','intentId',create_key,'displayName',r->'displayName','config',r->'config');
 PERFORM public.pro262_capacity_recheck(a."admissionId",a."fence");
 INSERT INTO public."Pro262CapacitySetupIntent"("namespace","ownerId","setupKey","freshRoomId","createKey","admissionId","fence","binding") VALUES
  (c->>'namespace',c->>'identityId',r->>'setupKey',fresh_room_id,create_key,a."admissionId",a."fence",
   pg_catalog.jsonb_build_object('context',c,'request',r,'requestHash',request_hash,'stateHash',public.int5b_hash_json(v_state),'nativeIntent',native_intent,'parent',parent,'qualificationId',a."qualificationId",'qualificationGeneration',a."qualificationGeneration",'fence',a."fence",'applicability',(SELECT x."metadata" FROM public."Pro262CapacityApplicability" x WHERE x."admissionId"=a."admissionId" AND x."fence"=a."fence")));
END $$;

-- Effective setup replacement: original body with the single pre-create capacity call.
CREATE OR REPLACE FUNCTION public.eng03_06_successor_setup(c JSONB,r JSONB,state JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capacity_id TEXT;saved JSONB;parent_room TEXT;parent JSONB;created JSONB;derived JSONB;create_key TEXT;native_intent JSONB;
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
 capacity_id:=public.pro262_capacity_resolve(c->>'namespace',c->>'identityId','PG_SETUP',public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-setup-v1','request',r)));
 PERFORM public.pro262_capacity_pg_subject_lock(capacity_id,public.pro262_capacity_owner_fence(capacity_id),c->>'namespace',c->>'identityId',NULL,NULL,NULL,NULL);
 parent:=public.eng03_06_assert_parent(c->>'namespace',c->>'identityId',r->>'parentMatchId',(r->>'expectedResultVersion')::BIGINT,r->>'expectedResultHash');
 create_key:=public.eng03_06_create_key(c,r->>'setupKey');derived:=public.eng03_03_create_identity(c->>'namespace',c->>'projectId',c->>'identityId',create_key);
 IF derived->>'roomId'=parent_room OR EXISTS(SELECT 1 FROM public."HuroofRoom" WHERE ("namespace","id")=(c->>'namespace',derived->>'roomId')) THEN RAISE EXCEPTION 'SUCCESSOR_FRESH_ROOM_COLLISION';END IF;
 native_intent:=jsonb_build_object('type','CREATE_ROOM','intentId',create_key,'displayName',r->'displayName','config',r->'config');
 PERFORM public.pro262_capacity_setup_intent(c,r,state,derived->>'roomId',create_key);
 created:=public.eng03_03_setup_create(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash',create_key,native_intent,state);
 IF created->'replayed' IS DISTINCT FROM 'false'::JSONB OR created->'revision' IS DISTINCT FROM '0'::JSONB OR created->>'roomId' IS DISTINCT FROM derived->>'roomId' THEN RAISE EXCEPTION 'SUCCESSOR_NATIVE_CREATE_REPLAY';END IF;
 INSERT INTO public."HuroofSuccessorSetup"("namespace","ownerId","setupKey","parentMatchId","parentRoomId","originalVersion","originalHash","latestVersion","latestHash","freshRoomId","freshRoomGeneration","createKey","createRevision","externalRequest","externalHash","createIntent","createOutcome","createStateHash") VALUES(c->>'namespace',c->>'identityId',r->>'setupKey',r->>'parentMatchId',parent_room,1,parent->>'originalHash',(parent->>'latestVersion')::BIGINT,parent->>'latestHash',derived->>'roomId',1,create_key,0,r,public.int5b_hash_json(jsonb_build_object('domain','eng03-06-successor-setup-v1','request',r)),native_intent,created,public.int5b_hash_json(state));
 RETURN created;
END $$;

CREATE FUNCTION public.pro262_capacity_assert_setup_row(row_data JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public."Pro262CapacitySetupIntent"%ROWTYPE; a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 SELECT * INTO i FROM public."Pro262CapacitySetupIntent" x WHERE (x."namespace",x."ownerId",x."setupKey",x."freshRoomId")=(row_data->>'namespace',row_data->>'ownerId',row_data->>'setupKey',row_data->>'freshRoomId');
 IF NOT FOUND OR i."createKey" IS DISTINCT FROM row_data->>'createKey' OR i."binding"->'request' IS DISTINCT FROM row_data->'externalRequest' OR
    i."binding"->>'requestHash' IS DISTINCT FROM row_data->>'externalHash' OR i."binding"->>'stateHash' IS DISTINCT FROM row_data->>'createStateHash' OR
    i."binding"->'nativeIntent' IS DISTINCT FROM row_data->'createIntent' OR i."binding"->'parent'->>'originalHash' IS DISTINCT FROM row_data->>'originalHash' OR
    i."binding"->'parent'->>'latestVersion' IS DISTINCT FROM row_data->>'latestVersion' OR i."binding"->'parent'->>'latestHash' IS DISTINCT FROM row_data->>'latestHash' OR
    i."binding"->'context'->>'namespace' IS DISTINCT FROM row_data->>'namespace' OR i."binding"->'context'->>'identityId' IS DISTINCT FROM row_data->>'ownerId' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=i."admissionId" AND x."fence"=i."fence" FOR SHARE NOWAIT;
 IF NOT FOUND OR i."binding"->>'qualificationId' IS DISTINCT FROM a."qualificationId" OR i."binding"->>'qualificationGeneration' IS DISTINCT FROM a."qualificationGeneration"::TEXT OR i."binding"->>'fence' IS DISTINCT FROM a."fence"::TEXT THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_recheck(a."admissionId",a."fence");
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityApplicability" x WHERE x."admissionId"=a."admissionId" AND x."fence"=a."fence" AND x."qualificationId"=a."qualificationId" AND x."qualificationGeneration"=a."qualificationGeneration" AND x."metadata"=i."binding"->'applicability') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_pg_subject_lock(a."admissionId",a."fence",row_data->>'namespace',row_data->>'ownerId',NULL,NULL,NULL,NULL);
END $$;
CREATE FUNCTION public.pro262_capacity_setup_close() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual public."HuroofSuccessorSetup"%ROWTYPE;
BEGIN
 SELECT * INTO actual FROM public."HuroofSuccessorSetup" s WHERE (s."namespace",s."ownerId",s."setupKey",s."freshRoomId")=(NEW."namespace",NEW."ownerId",NEW."setupKey",NEW."freshRoomId");
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_setup_row(pg_catalog.to_jsonb(actual));
 PERFORM public.eng03_06_assert_setup(actual."namespace",actual."ownerId",actual."setupKey");
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Pro262CapacitySetupIntent_closed" AFTER INSERT ON public."Pro262CapacitySetupIntent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_setup_close();
CREATE CONSTRAINT TRIGGER "HuroofSuccessorSetup_capacity_closed" AFTER INSERT ON public."HuroofSuccessorSetup" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_setup_close();

-- Effective setup guard: all original checks retained, then protected intent binding.
CREATE OR REPLACE FUNCTION public.eng03_06_setup_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF NOT FOUND OR convert_from(l."intent",'UTF8')::JSONB IS DISTINCT FROM NEW."createIntent" OR convert_from(l."outcome",'UTF8')::JSONB IS DISTINCT FROM NEW."createOutcome" OR l."stateHash" IS DISTINCT FROM NEW."createStateHash" OR l."roomGeneration" IS DISTINCT FROM NEW."freshRoomGeneration" OR NEW."createOutcome"->'replayed' IS DISTINCT FROM 'false'::JSONB OR NEW."createOutcome"->'revision' IS DISTINCT FROM '0'::JSONB THEN RAISE EXCEPTION 'SUCCESSOR_CREATE_BINDING_INVALID';END IF; PERFORM public.pro262_capacity_assert_setup_row(pg_catalog.to_jsonb(NEW)); RETURN NEW;
END $$;

CREATE FUNCTION public.pro262_capacity_stage_resolve(stage_kind TEXT,row_data JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ns TEXT; owner_id TEXT; request_hash TEXT; op TEXT; resolved TEXT; a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 IF stage_kind='ENTA' THEN ns:=row_data->>'namespaceId'; owner_id:=row_data->>'ownerId'; request_hash:=row_data->>'clientHash'; op:='ENTA_SUCCESSOR';
 ELSIF stage_kind='PG' THEN ns:=row_data->>'namespace'; owner_id:=row_data->>'ownerId'; request_hash:=row_data->>'externalHash'; op:='PG_START';
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 resolved:=public.pro262_capacity_resolve(ns,owner_id,op,request_hash);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=resolved AND x."principal"=SESSION_USER::NAME AND x."pid"=pg_catalog.pg_backend_pid() AND x."backendStart"=public.pro262_capacity_backend_start() AND x."state" IN ('RESERVED','RUNNING') FOR SHARE NOWAIT;
 IF stage_kind='ENTA' AND a."subject"->>'project' IS DISTINCT FROM row_data->>'projectId' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_recheck(a."admissionId",a."fence"); RETURN resolved;
END $$;
CREATE FUNCTION public.pro262_capacity_stage_before() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.pro262_capacity_stage_resolve(CASE TG_TABLE_NAME WHEN 'E3StartReservation' THEN 'ENTA' WHEN 'HuroofSuccessorStartReservation' THEN 'PG' ELSE NULL END,pg_catalog.to_jsonb(NEW)); RETURN NEW;
END $$;
CREATE TRIGGER "E3StartReservation_capacity_before" BEFORE INSERT ON public."E3StartReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_before();
CREATE TRIGGER "HuroofSuccessorStartReservation_capacity_before" BEFORE INSERT ON public."HuroofSuccessorStartReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_before();
CREATE FUNCTION public.pro262_capacity_bind(stage_kind TEXT,stage_identity TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stage JSONB; resolved TEXT; a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 IF stage_kind='ENTA' THEN SELECT pg_catalog.to_jsonb(s) INTO stage FROM public."E3StartReservation" s WHERE s."id"=stage_identity;
 ELSIF stage_kind='PG' THEN SELECT pg_catalog.to_jsonb(s) INTO stage FROM public."HuroofSuccessorStartReservation" s WHERE s."stageId"=stage_identity;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF stage IS NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 resolved:=public.pro262_capacity_stage_resolve(stage_kind,stage);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=resolved AND x."principal"=SESSION_USER::NAME AND x."pid"=pg_catalog.pg_backend_pid() AND x."backendStart"=public.pro262_capacity_backend_start() AND x."state" IN ('RESERVED','RUNNING') FOR SHARE NOWAIT;
 INSERT INTO public."Pro262CapacityStageBinding"("stageKind","e3StageId","pgStageId","admissionId","fence","binding") VALUES
  (stage_kind,CASE WHEN stage_kind='ENTA' THEN stage_identity END,CASE WHEN stage_kind='PG' THEN stage_identity END,a."admissionId",a."fence",
   pg_catalog.jsonb_build_object('stage',stage,'qualificationId',a."qualificationId",'qualificationGeneration',a."qualificationGeneration",'fence',a."fence",'applicability',(SELECT x."metadata" FROM public."Pro262CapacityApplicability" x WHERE x."admissionId"=a."admissionId" AND x."fence"=a."fence")));
END $$;
CREATE FUNCTION public.pro262_capacity_stage_after() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_data JSONB:=pg_catalog.to_jsonb(NEW); k TEXT; stage_id TEXT;
BEGIN
 k:=CASE TG_TABLE_NAME WHEN 'E3StartReservation' THEN 'ENTA' WHEN 'HuroofSuccessorStartReservation' THEN 'PG' ELSE NULL END;
 stage_id:=CASE k WHEN 'ENTA' THEN row_data->>'id' WHEN 'PG' THEN row_data->>'stageId' ELSE NULL END;
 PERFORM public.pro262_capacity_bind(k,stage_id); RETURN NULL;
END $$;
CREATE TRIGGER "E3StartReservation_capacity_bind" AFTER INSERT ON public."E3StartReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_after();
CREATE TRIGGER "HuroofSuccessorStartReservation_capacity_bind" AFTER INSERT ON public."HuroofSuccessorStartReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_after();
CREATE FUNCTION public.pro262_capacity_assert_stage(stage_kind TEXT,stage_identity TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual JSONB; b public."Pro262CapacityStageBinding"%ROWTYPE; a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 IF stage_kind='ENTA' THEN SELECT pg_catalog.to_jsonb(s) INTO actual FROM public."E3StartReservation" s WHERE s."id"=stage_identity;
 ELSIF stage_kind='PG' THEN SELECT pg_catalog.to_jsonb(s) INTO actual FROM public."HuroofSuccessorStartReservation" s WHERE s."stageId"=stage_identity;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO b FROM public."Pro262CapacityStageBinding" x WHERE x."stageKind"=stage_kind AND (CASE stage_kind WHEN 'ENTA' THEN x."e3StageId" ELSE x."pgStageId" END)=stage_identity;
 IF NOT FOUND OR actual IS NULL OR b."binding"->'stage' IS DISTINCT FROM actual THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=b."admissionId" AND x."fence"=b."fence" FOR SHARE NOWAIT;
 IF NOT FOUND OR b."binding"->>'qualificationId' IS DISTINCT FROM a."qualificationId" OR b."binding"->>'qualificationGeneration' IS DISTINCT FROM a."qualificationGeneration"::TEXT OR b."binding"->>'fence' IS DISTINCT FROM a."fence"::TEXT THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_recheck(a."admissionId",a."fence");
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityApplicability" x WHERE x."admissionId"=a."admissionId" AND x."fence"=a."fence" AND x."qualificationId"=a."qualificationId" AND x."qualificationGeneration"=a."qualificationGeneration" AND x."metadata"=b."binding"->'applicability') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF stage_kind='ENTA' THEN PERFORM public.pro262_capacity_enta_subject(a."admissionId",a."fence",actual->>'namespaceId',actual->>'projectId',actual->>'uid');
 ELSIF stage_kind='PG' THEN PERFORM public.pro262_capacity_pg_subject_lock(a."admissionId",a."fence",actual->>'namespace',actual->>'ownerId',actual->>'freshRoomId',NULL,actual->'externalRequest'->>'profileScope',NULL); END IF;

 IF public.pro262_capacity_stage_resolve(stage_kind,actual) IS DISTINCT FROM a."admissionId" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.pro262_capacity_stage_close() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row_data JSONB:=pg_catalog.to_jsonb(NEW); k TEXT; stage_id TEXT;
BEGIN
 k:=CASE TG_TABLE_NAME WHEN 'E3StartReservation' THEN 'ENTA' WHEN 'HuroofSuccessorStartReservation' THEN 'PG' ELSE row_data->>'stageKind' END;
 stage_id:=CASE k WHEN 'ENTA' THEN COALESCE(row_data->>'id',row_data->>'e3StageId') WHEN 'PG' THEN COALESCE(row_data->>'stageId',row_data->>'pgStageId') ELSE NULL END;
 PERFORM public.pro262_capacity_assert_stage(k,stage_id); RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Pro262CapacityStageBinding_closed" AFTER INSERT ON public."Pro262CapacityStageBinding" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_close();
CREATE CONSTRAINT TRIGGER "E3StartReservation_capacity_closed" AFTER INSERT ON public."E3StartReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_close();
CREATE CONSTRAINT TRIGGER "HuroofSuccessorStartReservation_capacity_closed" AFTER INSERT ON public."HuroofSuccessorStartReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_stage_close();

-- Existing origin, seal and closure bodies with capacity assertions only.
CREATE OR REPLACE FUNCTION public.e3_comp_admission_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 PERFORM public.pro262_capacity_assert_stage('ENTA',s."id");
 INSERT INTO public."E3AdmissionInsertWitness"("stageId","ownerId","protocol","requestKey","logicalId","nativeRequestHash","admissionId","walletId","nativeIntentHash","baseReleaseId","baseRoot","receiptId","selector") VALUES(s."id",s."ownerId",s."protocol",s."requestKey",s."logicalId",s."nativeRequestHash",NEW."id",NEW."walletId",NEW."intentHash",NEW."catalogReleaseId",NEW."releaseRootHash",NEW."validationReceiptId",NEW."selectorVersion");
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_06_admission_witness() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;n INTEGER;
BEGIN
 SELECT count(*) INTO n FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "nativeLogicalMatchId"=NEW."logicalMatchId");
 IF n=0 THEN RETURN NULL;END IF;IF n<>1 THEN RAISE EXCEPTION 'SUCCESSOR_CROSS_STAGE_COLLISION';END IF;
 SELECT * INTO STRICT s FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=NEW."firebaseIdentityId" AND ("requestKey"=NEW."requestKey" OR "nativeLogicalMatchId"=NEW."logicalMatchId");
 IF NEW."id" IS DISTINCT FROM s."expectedAdmissionId" OR NEW."engine" IS DISTINCT FROM 'HUROOF' OR NEW."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' OR NEW."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR NEW."state" IS DISTINCT FROM 'HELD' OR NEW."version" IS DISTINCT FROM 0 OR NEW."requestKey" IS DISTINCT FROM s."requestKey" OR NEW."logicalMatchId" IS DISTINCT FROM s."nativeLogicalMatchId" OR NEW."requestHash" IS DISTINCT FROM s."nativeRequestHash" OR NEW."predecessorAdmissionId" IS NOT NULL THEN RAISE EXCEPTION 'SUCCESSOR_ORIGIN_MISMATCH';END IF;
 PERFORM public.pro262_capacity_assert_stage('PG',s."stageId");
 INSERT INTO public."HuroofSuccessorAdmissionWitness"("stageId","ownerId","requestKey","nativeLogicalMatchId","nativeRequestHash","admissionId") VALUES(s."stageId",s."ownerId",s."requestKey",s."nativeLogicalMatchId",s."nativeRequestHash",NEW."id");RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_06_seal_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actual JSONB;BEGIN
 PERFORM public.pro262_capacity_assert_stage('PG',NEW."stageId");
 actual:=public.eng03_06_native_material(NEW."stageId");
 IF NEW."namespace" IS DISTINCT FROM actual->'stage'->>'namespace' OR NEW."ownerId" IS DISTINCT FROM actual->'stage'->>'ownerId' OR NEW."setupKey" IS DISTINCT FROM actual->'stage'->>'setupKey' OR NEW."freshRoomId" IS DISTINCT FROM actual->'stage'->>'freshRoomId' OR NEW."requestKey" IS DISTINCT FROM actual->'stage'->>'requestKey' OR NEW."admissionId" IS DISTINCT FROM actual->'admission'->>'id' OR NEW."childMatchId" IS DISTINCT FROM actual->'match'->>'id' OR NEW."startSequence" IS DISTINCT FROM 1 OR NEW."startEventId" IS DISTINCT FROM actual->'event'->>'id' OR NEW."material" IS DISTINCT FROM actual OR NEW."materialHash" IS DISTINCT FROM public.int5b_hash_json(actual) OR NEW."outcome" IS DISTINCT FROM (SELECT convert_from(c."outcome",'UTF8')::JSONB FROM public."HuroofCommandReceipt" c WHERE (c."namespace",c."roomId",c."actorFirebaseIdentityId",c."requestKey")=(NEW."namespace",NEW."freshRoomId",NEW."ownerId",NEW."requestKey")) OR NEW."outcomeHash" IS DISTINCT FROM public.int5b_hash_json(NEW."outcome") THEN RAISE EXCEPTION 'SUCCESSOR_SEAL_MISMATCH';END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.e3_comp_assert_closure(stage_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."E3StartReservation"%ROWTYPE;w public."E3AdmissionInsertWitness"%ROWTYPE;z public."E3ImmutableSeal"%ROWTYPE;n JSONB;a JSONB;start_row JSONB;paid JSONB;terminal JSONB;expected JSONB;native_hash TEXT;legacy_link JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityStageBinding" b WHERE b."stageKind"='ENTA' AND b."e3StageId"=stage_id) THEN PERFORM public.pro262_capacity_assert_stage_identity('ENTA',stage_id); END IF;
 SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;SELECT * INTO STRICT w FROM public."E3AdmissionInsertWitness" WHERE "stageId"=stage_id;SELECT * INTO STRICT z FROM public."E3ImmutableSeal" WHERE "stageId"=stage_id;
 SELECT "material" INTO STRICT terminal FROM public."E3OriginalTerminal" WHERE "gameId"=s."parentGameId" AND "ownerId"=s."ownerId" AND "terminalHash"=s."terminalHash";
 IF NOT EXISTS(SELECT 1 FROM public."E3SuccessorLink" l WHERE (l."stageId",l."ownerId",l."parentGameId",l."terminalHash",l."childGameId",l."admissionId")=(s."id",s."ownerId",s."parentGameId",s."terminalHash",z."gameId",w."admissionId")) THEN RAISE EXCEPTION 'E3_LINK_MISSING'; END IF;
 PERFORM public.e3_comp_assert_stage_material(s."id",to_jsonb(s));n:=public.e3_comp_actual_native(stage_id);a:=n->'admission';start_row:=n->'nativeStart';paid:=n->'paid';legacy_link:=n->'legacyLink';
 native_hash:=CASE WHEN s."protocol"=5 THEN public.int9_intent_hash(n->'nativeIntent') ELSE public.int6_enta_hash(n->'nativeIntent') END;
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
 OR jsonb_array_length(n->'selected'->'categoryPins')<>CASE WHEN s."mode"='KIDS' OR s."format" IN('STANDALONE_LIST','STANDALONE_ACTING') THEN 1 ELSE 6 END THEN RAISE EXCEPTION 'E3_SELECTED_SET_INCOMPLETE';END IF;
 IF s."protocol" IN(2,3) THEN
  IF jsonb_array_length(n->'selected'->'questionRefs')<>CASE WHEN s."mode"='KIDS' THEN 6 ELSE 36 END OR n->'selected'->'roundPins'<>'[]'::JSONB OR n->'selected'->'itemPins'<>'[]'::JSONB OR n->'selected'->'exposures'<>'[]'::JSONB OR n->'selected'->'competitive' IS DISTINCT FROM 'null'::JSONB THEN RAISE EXCEPTION 'E3_FALSE_LEGACY_SELECTION';END IF;
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

CREATE OR REPLACE FUNCTION public.eng03_06_assert_closure(stage_id TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public."HuroofSuccessorStartReservation"%ROWTYPE;u public."HuroofSuccessorSetup"%ROWTYPE;z public."HuroofSuccessorSeal"%ROWTYPE;actual JSONB;
BEGIN
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityStageBinding" b WHERE b."stageKind"='PG' AND b."pgStageId"=stage_id) THEN PERFORM public.pro262_capacity_assert_stage_identity('PG',stage_id); END IF;
 SELECT * INTO STRICT s FROM public."HuroofSuccessorStartReservation" WHERE "stageId"=stage_id;
 SELECT * INTO STRICT u FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey","freshRoomId")=(s."namespace",s."ownerId",s."setupKey",s."freshRoomId");
 SELECT * INTO STRICT z FROM public."HuroofSuccessorSeal" WHERE "stageId"=stage_id;
 actual:=public.eng03_06_native_material(stage_id);
 IF z."material" IS DISTINCT FROM actual OR z."materialHash" IS DISTINCT FROM public.int5b_hash_json(actual) OR z."outcomeHash" IS DISTINCT FROM public.int5b_hash_json(z."outcome") OR z."childMatchId" IS DISTINCT FROM s."expectedMatchId" OR z."admissionId" IS DISTINCT FROM s."expectedAdmissionId" OR NOT EXISTS(SELECT 1 FROM public."HuroofRematchLink" l WHERE (l."namespace",l."childMatchId",l."predecessorMatchId",l."ownerFirebaseIdentityId",l."predecessorResultVersion",l."predecessorResultHash")=(s."namespace",s."expectedMatchId",u."parentMatchId",s."ownerId",u."latestVersion",u."latestHash")) THEN RAISE EXCEPTION 'SUCCESSOR_CLOSURE_MISMATCH';END IF;
END $$;

CREATE FUNCTION public.pro262_capacity_material_before() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stage_id TEXT:=pg_catalog.to_jsonb(NEW)->>'stageId'; k TEXT;
BEGIN
 k:=CASE WHEN TG_TABLE_NAME IN ('E3AdmissionInsertWitness','E3ImmutableSeal','E3SuccessorLink') THEN 'ENTA'
         WHEN TG_TABLE_NAME IN ('HuroofSuccessorAdmissionWitness','HuroofSuccessorSeal') THEN 'PG' ELSE NULL END;
 PERFORM public.pro262_capacity_assert_stage(k,stage_id); RETURN NEW;
END $$;
CREATE TRIGGER "E3AdmissionInsertWitness_capacity_before" BEFORE INSERT ON public."E3AdmissionInsertWitness" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_material_before();
CREATE TRIGGER "E3ImmutableSeal_capacity_before" BEFORE INSERT ON public."E3ImmutableSeal" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_material_before();
CREATE TRIGGER "E3SuccessorLink_capacity_before" BEFORE INSERT ON public."E3SuccessorLink" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_material_before();
CREATE TRIGGER "HuroofSuccessorAdmissionWitness_capacity_before" BEFORE INSERT ON public."HuroofSuccessorAdmissionWitness" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_material_before();

-- Static binding inspection supports immutable committed replay after expiry/revocation/cleanup.
-- New-insert deferred hooks separately call the live admission assertion before commit.
CREATE FUNCTION public.pro262_capacity_assert_stage_identity(stage_kind TEXT,stage_identity TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual JSONB; b public."Pro262CapacityStageBinding"%ROWTYPE; a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 IF stage_kind='ENTA' THEN SELECT pg_catalog.to_jsonb(s) INTO actual FROM public."E3StartReservation" s WHERE s."id"=stage_identity;
 ELSIF stage_kind='PG' THEN SELECT pg_catalog.to_jsonb(s) INTO actual FROM public."HuroofSuccessorStartReservation" s WHERE s."stageId"=stage_identity;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO b FROM public."Pro262CapacityStageBinding" x WHERE x."stageKind"=stage_kind AND (CASE stage_kind WHEN 'ENTA' THEN x."e3StageId" ELSE x."pgStageId" END)=stage_identity;
 IF NOT FOUND OR actual IS NULL OR b."binding"->'stage' IS DISTINCT FROM actual THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=b."admissionId" AND x."fence"=b."fence";
 IF NOT FOUND OR b."binding"->>'qualificationId' IS DISTINCT FROM a."qualificationId" OR b."binding"->>'qualificationGeneration' IS DISTINCT FROM a."qualificationGeneration"::TEXT OR b."binding"->>'fence' IS DISTINCT FROM a."fence"::TEXT THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;

-- Effective successor wrappers: exact committed replay first; fresh branch resolves capacity.
CREATE OR REPLACE FUNCTION public.e3_comp_native4_commit(ns TEXT,project TEXT,uid TEXT,r JSONB,request JSONB,intent JSONB,pins JSONB,receipt_id TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE capacity_id TEXT;prior JSONB;identity_id TEXT;stage_id TEXT;native JSONB;BEGIN
 PERFORM public.e3_comp_validate_external(r);IF r->'profile'->'physicalProtocol' IS DISTINCT FROM '4'::JSONB THEN RAISE EXCEPTION 'E3_NATIVE4_PROFILE_REQUIRED';END IF;
 prior:=public.e3_comp_retry(ns,project,uid,r);IF prior IS NOT NULL THEN RETURN prior;END IF;
 capacity_id:=public.pro262_capacity_resolve(ns,public.int6_enta_identity(ns,project,uid)->>'id','ENTA_SUCCESSOR',public.int6_enta_hash(pg_catalog.jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',r)));
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';IF NOT EXISTS(SELECT 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id AND "debt"=0 AND "available">=1) THEN RAISE EXCEPTION 'E3_CREDIT_UNAVAILABLE';END IF;
 PERFORM public.pro262_capacity_enta_subject(capacity_id,public.pro262_capacity_owner_fence(capacity_id),ns,project,uid);
 native:=public.e3_comp_native_request(r,public.e3_comp_parent(ns,project,uid,r));
 IF request IS DISTINCT FROM native OR intent->'request' IS DISTINCT FROM native OR intent->>'receiptId' IS DISTINCT FROM receipt_id OR intent->>'pinsHash' IS DISTINCT FROM public.int6_enta_hash(pins) OR intent->'roundCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(pins)) THEN RAISE EXCEPTION 'E3_NATIVE4_RAW_MAPPING_MISMATCH';END IF;
 stage_id:=public.e3_comp_create_stage(ns,project,uid,r);native:=NULL;prior:=NULL;
 -- Genuine original producer remains the independent content/hash/issuer verifier.
 PERFORM public.int8_start(ns,project,uid,request,intent,pins,receipt_id);
 prior:=public.e3_comp_finalize(stage_id); PERFORM public.pro262_capacity_assert_stage('ENTA',stage_id); RETURN prior;
END $$;


CREATE OR REPLACE FUNCTION public.e3_comp_retained_commit(ns TEXT,project TEXT,uid TEXT,r JSONB,seed TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE capacity_id TEXT;prior JSONB;identity_id TEXT;stage_id TEXT;s public."E3StartReservation"%ROWTYPE;receipt_id TEXT;BEGIN
 PERFORM public.e3_comp_validate_external(r);IF r->'profile'->'physicalProtocol' NOT IN('2'::JSONB,'3'::JSONB,'5'::JSONB) THEN RAISE EXCEPTION 'E3_PROFILE_UNSUPPORTED';END IF;
 prior:=public.e3_comp_retry(ns,project,uid,r);IF prior IS NOT NULL THEN RETURN prior;END IF;
 capacity_id:=public.pro262_capacity_resolve(ns,public.int6_enta_identity(ns,project,uid)->>'id','ENTA_SUCCESSOR',public.int6_enta_hash(pg_catalog.jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',r)));
 IF seed!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'E3_INVALID_SEED';END IF;
 identity_id:=public.int6_enta_identity(ns,project,uid)->>'id';IF NOT EXISTS(SELECT 1 FROM public."Wallet" WHERE "firebaseIdentityId"=identity_id AND "debt"=0 AND "available">=1) THEN RAISE EXCEPTION 'E3_CREDIT_UNAVAILABLE';END IF;
 PERFORM public.pro262_capacity_enta_subject(capacity_id,public.pro262_capacity_owner_fence(capacity_id),ns,project,uid);
 stage_id:=public.e3_comp_create_stage(ns,project,uid,r);SELECT * INTO STRICT s FROM public."E3StartReservation" WHERE "id"=stage_id;
 IF s."protocol" IN(2,3) THEN receipt_id:=public.e3_comp_legacy_receipt(ns,project,uid,stage_id);END IF;
 IF s."protocol"=2 THEN PERFORM public.int6_enta_start(ns,project,uid,s."nativeRequest",receipt_id);
 ELSIF s."protocol"=3 THEN PERFORM public.int7_enta_start(ns,project,uid,s."nativeRequest",receipt_id,s."parentGameId");
 ELSE PERFORM public.int9_start_request(ns,project,uid,s."nativeRequest",seed);END IF;
 prior:=public.e3_comp_finalize(stage_id); PERFORM public.pro262_capacity_assert_stage('ENTA',stage_id); RETURN prior;
END $$;


CREATE OR REPLACE FUNCTION public.eng03_06_successor_start(c JSONB,r JSONB,intent JSONB,initial JSONB,projections JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capacity_id TEXT;u public."HuroofSuccessorSetup"%ROWTYPE;s public."HuroofSuccessorStartReservation"%ROWTYPE;ids JSONB;parent JSONB;stage_id TEXT;native_hash TEXT;reply JSONB;material JSONB;event_id TEXT;
BEGIN
 PERFORM public.eng03_06_context(c);PERFORM public.eng03_06_start_request(r);
 PERFORM 1 FROM public."Wallet" WHERE "firebaseIdentityId"=c->>'identityId' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'WALLET_UNAVAILABLE';END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "requestKey"=r->>'requestKey') THEN RETURN public.eng03_06_successor_retry(c,r);END IF;
 IF EXISTS(SELECT 1 FROM public."HuroofSuccessorStartReservation" WHERE "ownerId"=c->>'identityId' AND "logicalMatchId"=r->>'logicalMatchId') OR EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=c->>'identityId' AND "requestKey"=r->>'requestKey') THEN RAISE EXCEPTION 'SUCCESSOR_IDEMPOTENCY_COLLISION';END IF;
 capacity_id:=public.pro262_capacity_resolve(c->>'namespace',c->>'identityId','PG_START',public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-start-v1','request',r)));
 SELECT * INTO u FROM public."HuroofSuccessorSetup" WHERE ("namespace","ownerId","setupKey")=(c->>'namespace',c->>'identityId',r->>'setupKey');IF NOT FOUND THEN RAISE EXCEPTION 'SUCCESSOR_SETUP_UNAVAILABLE';END IF;
 PERFORM public.eng03_06_lock_rooms(u."namespace",u."parentRoomId",u."freshRoomId");PERFORM public.eng03_06_lock_room_dependents(u."namespace",u."parentRoomId",u."freshRoomId");
 PERFORM public.eng03_03_assert_current(c->>'namespace',c->>'identityId',c->>'policyRevision',c->>'policyHash');
 PERFORM public.pro262_capacity_pg_subject_lock(capacity_id,public.pro262_capacity_owner_fence(capacity_id),c->>'namespace',c->>'identityId',u."freshRoomId",u."freshRoomGeneration",r->>'profileScope',NULL);
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
 PERFORM public.eng03_06_assert_closure(stage_id); PERFORM public.pro262_capacity_assert_stage('PG',stage_id); RETURN reply;
END $$;

-- Owning Enta reader: wallet -> actual predecessor -> active pointer. The
-- scalar head is compared inside this transaction before any catalog aggregation.
CREATE FUNCTION public.pro262_capacity_enta_subject(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_project TEXT,p_uid TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_request JSONB; v_discovery JSONB; v_identity TEXT; v_game RECORD; v_admission RECORD; v_profile public."E3PhysicalProfile"%ROWTYPE; v_pointer public."ActiveCatalogPointer"%ROWTYPE; v_receipt RECORD; v_format public."EntaFormatRelease"%ROWTYPE; v_competitive public."EntaCompetitiveRelease"%ROWTYPE; v_sequence BIGINT; v_metadata JSONB;
BEGIN
 v_request:=public.pro262_capacity_owner_request(p_admission_id,p_fence);v_discovery:=public.pro262_capacity_owner_discovery(p_admission_id,p_fence);
 IF v_discovery->>'kind' IS DISTINCT FROM 'EXACT_PUBLISHED_HEAD' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_identity:=public.int6_enta_identity(p_namespace,p_project,p_uid)->>'id';
 IF public.pro262_capacity_resolve(p_namespace,v_identity,'ENTA_SUCCESSOR',public.int6_enta_hash(pg_catalog.jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',v_request))) IS DISTINCT FROM p_admission_id THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM 1 FROM public."Wallet" w WHERE w."firebaseIdentityId"=v_identity FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT g."id",g."admissionId",g."executionFormat",g."mode",g."status",g."gameFormat" INTO STRICT v_game FROM public."Game" g WHERE g."id"=v_request->'predecessor'->>'gameId' AND g."firebaseIdentityId"=v_identity FOR UPDATE;
 SELECT a."requestVersion",a."engine",a."state" INTO STRICT v_admission FROM public."Admission" a WHERE a."id"=v_game."admissionId" AND a."firebaseIdentityId"=v_identity;
 SELECT * INTO STRICT v_profile FROM public."E3PhysicalProfile" x WHERE x."protocol"=v_admission."requestVersion" AND x."format"=v_game."executionFormat" AND x."mode"=v_game."mode";
 IF v_game."status"<>'FINISHED' OR v_game."gameFormat"<>'FIREBASE_PINNED' OR v_admission."engine"<>'ENTA' OR v_admission."state"<>'COMMITTED' OR v_request->'profile' IS DISTINCT FROM pg_catalog.jsonb_build_object('physicalProtocol',v_profile."protocol",'format',v_profile."format",'retainedRules',v_profile."rules",'mode',v_profile."mode") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_profile."protocol"=3 THEN SELECT e."sequence" INTO STRICT v_sequence FROM public."GameEvent" e WHERE e."gameId"=v_game."id" AND e."type"='FINISH' AND e."actorFirebaseIdentityId"=v_identity; END IF;
 SELECT * INTO STRICT v_pointer FROM public."ActiveCatalogPointer" x WHERE x."id"='singleton' FOR SHARE;
 SELECT x."sealHash",x."policyVersion" INTO STRICT v_receipt FROM public."CatalogValidationReceipt" x WHERE x."id"=v_pointer."validationReceiptId" AND x."catalogReleaseId"=v_pointer."catalogReleaseId" AND x."releaseRootHash"=v_pointer."releaseRootHash";
 IF v_profile."protocol" IN (4,5) THEN SELECT * INTO STRICT v_format FROM public."EntaFormatRelease" x WHERE x."receiptId"=v_pointer."validationReceiptId" AND x."baseReleaseId"=v_pointer."catalogReleaseId" AND x."baseRoot"=v_pointer."releaseRootHash" AND x."sealedAt" IS NOT NULL; END IF;
 IF v_profile."protocol"=5 THEN SELECT * INTO STRICT v_competitive FROM public."EntaCompetitiveRelease" x WHERE x."formatReleaseId"=v_format."id" AND x."formatRoot"=v_format."formatRoot" AND x."mediaRoot"=v_format."mediaRoot" AND x."rulesVersion"='enta-competitive-1' AND x."sealedAt" IS NOT NULL; END IF;
 v_metadata:=pg_catalog.jsonb_build_object('engine','ENTA','operation','ENTA_SUCCESSOR','protocol',v_profile."protocol",'mode',v_profile."mode",'format',v_profile."format",'rules',v_profile."rules",'predecessorId',v_game."id",'predecessorVersion',v_sequence,'baseReleaseId',v_pointer."catalogReleaseId",'receiptId',v_pointer."validationReceiptId",'baseRoot',v_pointer."releaseRootHash",'sealHash',v_receipt."sealHash",'policyVersion',v_receipt."policyVersion",'formatPolicyVersion',v_format."policyVersion",'formatReleaseId',v_format."id",'formatRoot',v_format."formatRoot",'mediaRoot',v_format."mediaRoot",'competitiveReleaseId',v_competitive."id",'competitiveProofRoot',v_competitive."proofRoot",'competitivePaletteRoot',v_competitive."paletteRoot",'profile',NULL,'custody',NULL);
 IF pg_catalog.octet_length(v_metadata::TEXT)::NUMERIC>(v_discovery->>'maxMetadataBytes')::NUMERIC THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_native_subject(v_metadata); RETURN v_metadata;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE FUNCTION public.pro262_capacity_enta_parent(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_project TEXT,p_uid TEXT,p_request JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_request IS DISTINCT FROM public.pro262_capacity_owner_request(p_admission_id,p_fence) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_enta_subject(p_admission_id,p_fence,p_namespace,p_project,p_uid);
 RETURN public.e3_comp_parent(p_namespace,p_project,p_uid,p_request);
END $$;
CREATE FUNCTION public.pro262_capacity_enta_catalog(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_project TEXT,p_uid TEXT,p_format TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_metadata JSONB; v_result JSONB;
BEGIN
 v_metadata:=public.pro262_capacity_enta_subject(p_admission_id,p_fence,p_namespace,p_project,p_uid);
 IF v_metadata->>'protocol' IS DISTINCT FROM '4' OR v_metadata->>'format' IS DISTINCT FROM p_format THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_result:=public.int8_catalog(p_namespace,p_project,p_uid,p_format);
 PERFORM public.pro262_capacity_enta_subject(p_admission_id,p_fence,p_namespace,p_project,p_uid); RETURN v_result;
END $$;
CREATE FUNCTION public.pro262_capacity_enta_exposure(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_project TEXT,p_uid TEXT,p_format TEXT,p_category TEXT,p_release TEXT,p_root TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_metadata JSONB; v_result JSONB;
BEGIN
 v_metadata:=public.pro262_capacity_enta_subject(p_admission_id,p_fence,p_namespace,p_project,p_uid);
 IF v_metadata->>'protocol' IS DISTINCT FROM '4' OR v_metadata->>'format' IS DISTINCT FROM p_format OR v_metadata->>'formatReleaseId' IS DISTINCT FROM p_release OR v_metadata->>'formatRoot' IS DISTINCT FROM p_root THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_result:=public.e3_comp_exposure_frontier(p_namespace,p_project,p_uid,p_format,p_category,p_release,p_root);
 PERFORM public.pro262_capacity_enta_subject(p_admission_id,p_fence,p_namespace,p_project,p_uid); RETURN v_result;
END $$;
-- The PG owner locks the real source rows and returns only qualified scalar
-- identity metadata; original heavy reads execute under the same transaction.
CREATE FUNCTION public.pro262_capacity_pg_subject_lock(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_scope TEXT,p_match TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_request JSONB; v_context JSONB; v_discovery JSONB; v_policy public."HuroofIdentityPolicyHead"%ROWTYPE; v_setup_room TEXT; v_room_id TEXT; v_room_generation BIGINT; v_pointer public."ActiveCatalogPointer"%ROWTYPE; v_receipt public."CatalogValidationReceipt"%ROWTYPE; v_profile_pointer public."HuroofContentPointer"%ROWTYPE; v_profile_revision public."HuroofContentRevision"%ROWTYPE; v_custody_pointer public."HuroofContentPointer"%ROWTYPE; v_custody_revision public."HuroofContentRevision"%ROWTYPE; v_latest_version BIGINT; v_latest_hash TEXT; v_room_revision BIGINT; v_parent_room TEXT; v_active JSONB; v_profile JSONB; v_custody JSONB; v_match_pin JSONB; v_metadata JSONB;
BEGIN
 v_request:=public.pro262_capacity_owner_request(p_admission_id,p_fence);v_context:=public.pro262_capacity_owner_context(p_admission_id,p_fence);v_discovery:=public.pro262_capacity_owner_discovery(p_admission_id,p_fence);
 IF v_context->>'namespace' IS DISTINCT FROM p_namespace OR v_context->>'identityId' IS DISTINCT FROM p_identity THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_request ? 'parentMatchId' THEN
  IF v_discovery->>'kind' IS DISTINCT FROM 'NONPLAYABLE_SETUP' OR p_room IS NOT NULL OR p_generation IS NOT NULL OR p_scope IS NOT NULL OR p_match IS NOT NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF public.pro262_capacity_resolve(p_namespace,p_identity,'PG_SETUP',public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-setup-v1','request',v_request))) IS DISTINCT FROM p_admission_id THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT m."roomId" INTO STRICT v_parent_room FROM public."HuroofMatch" m WHERE m."namespace"=p_namespace AND m."id"=v_request->>'parentMatchId' AND m."ownerFirebaseIdentityId"=p_identity;
  PERFORM public.eng03_06_lock_parent(p_namespace,v_parent_room,p_identity);PERFORM public.eng03_06_lock_room_dependents(p_namespace,v_parent_room,v_parent_room);
  SELECT * INTO STRICT v_policy FROM public."HuroofIdentityPolicyHead" h WHERE h."namespace"=p_namespace FOR SHARE;
  SELECT z."resultVersion",z."resultHash" INTO STRICT v_latest_version,v_latest_hash FROM public."HuroofMatchResult" z WHERE z."namespace"=p_namespace AND z."matchId"=v_request->>'parentMatchId' AND z."ownerFirebaseIdentityId"=p_identity ORDER BY z."resultVersion" DESC LIMIT 1;
  IF v_latest_version::TEXT IS DISTINCT FROM v_request->>'expectedResultVersion' OR v_latest_hash IS DISTINCT FROM v_request->>'expectedResultHash' OR v_policy."revision"::TEXT IS DISTINCT FROM v_context->>'policyRevision' OR v_policy."policyHash" IS DISTINCT FROM v_context->>'policyHash' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  v_metadata:=pg_catalog.jsonb_build_object('engine','PG','operation','PG_SETUP','protocol',NULL,'namespace',p_namespace,'owner',p_identity,'policyRevision',v_policy."revision"::TEXT,'policyHash',v_policy."policyHash",'parentMatchId',v_request->>'parentMatchId','resultVersion',v_latest_version::TEXT,'resultHash',v_latest_hash,'requestedConfig',v_request->'config','activeCatalog',NULL,'profile',NULL,'custody',NULL,'matchPin',NULL);
 ELSE
  IF public.pro262_capacity_resolve(p_namespace,p_identity,'PG_START',public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-start-v1','request',v_request))) IS DISTINCT FROM p_admission_id THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT x."freshRoomId" INTO STRICT v_setup_room FROM public."HuroofSuccessorSetup" x WHERE x."namespace"=p_namespace AND x."ownerId"=p_identity AND x."setupKey"=v_request->>'setupKey';
  IF p_room IS NOT NULL AND p_room IS DISTINCT FROM v_setup_room OR p_scope IS NOT NULL AND p_scope IS DISTINCT FROM v_request->>'profileScope' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  PERFORM public.eng03_03_lock_room(p_namespace,v_setup_room);PERFORM public.eng03_03_lock_members(p_namespace,v_setup_room);
  SELECT x."id",x."generation" INTO STRICT v_room_id,v_room_generation FROM public."HuroofRoom" x WHERE x."namespace"=p_namespace AND x."id"=v_setup_room AND x."ownerFirebaseIdentityId"=p_identity;
  IF p_generation IS NOT NULL AND p_generation IS DISTINCT FROM v_room_generation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT * INTO STRICT v_policy FROM public."HuroofIdentityPolicyHead" h WHERE h."namespace"=p_namespace FOR SHARE;
  IF v_policy."revision"::TEXT IS DISTINCT FROM v_context->>'policyRevision' OR v_policy."policyHash" IS DISTINCT FROM v_context->>'policyHash' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF p_match IS NULL THEN
   IF v_discovery->>'kind' IS DISTINCT FROM 'EXACT_PUBLISHED_HEAD' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
   SELECT x."revision" INTO STRICT v_room_revision FROM public."HuroofLobbyRevision" x WHERE x."namespace"=p_namespace AND x."roomId"=v_room_id ORDER BY x."revision" DESC LIMIT 1;
   SELECT * INTO STRICT v_pointer FROM public."ActiveCatalogPointer" x WHERE x."id"='singleton' FOR SHARE;
   PERFORM public.eng03_03_lock_profile(p_namespace,v_request->>'profileScope');
   SELECT * INTO STRICT v_profile_pointer FROM public."HuroofContentPointer" x WHERE x."namespace"=p_namespace AND x."kind"='profile' AND x."scope"=v_request->>'profileScope' AND x."family"='profile';
   SELECT * INTO STRICT v_profile_revision FROM public."HuroofContentRevision" x WHERE (x."namespace",x."family",x."sourceId",x."revision",x."rawArtifactHash")=(v_profile_pointer."namespace",v_profile_pointer."family",v_profile_pointer."sourceId",v_profile_pointer."revision",v_profile_pointer."rawArtifactHash");
   SELECT * INTO STRICT v_receipt FROM public."CatalogValidationReceipt" x WHERE (x."id",x."catalogReleaseId",x."releaseRootHash")=(v_pointer."validationReceiptId",v_pointer."catalogReleaseId",v_pointer."releaseRootHash") AND (x."id",x."catalogReleaseId",x."releaseRootHash")=(v_profile_revision."validationReceiptId",v_profile_revision."catalogReleaseId",v_profile_revision."releaseRootHash");
   v_active:=pg_catalog.jsonb_build_object('catalogReleaseId',v_pointer."catalogReleaseId",'releaseRootHash',v_pointer."releaseRootHash",'validationReceiptId',v_pointer."validationReceiptId",'sealHash',v_receipt."sealHash",'huroofReleaseId',v_receipt."huroofReleaseId",'huroofRootSha256',v_receipt."huroofRootSha256");
   v_profile:=pg_catalog.jsonb_build_object('scope',v_profile_pointer."scope",'family',v_profile_pointer."family",'sourceId',v_profile_pointer."sourceId",'revision',v_profile_pointer."revision"::TEXT,'rawArtifactId',v_profile_revision."rawArtifactId",'rawArtifactHash',v_profile_pointer."rawArtifactHash",'pointerVersion',v_profile_pointer."version"::TEXT);v_match_pin:='null'::JSONB;
  ELSE
   IF v_discovery->>'kind' IS DISTINCT FROM 'PINNED_MATCH' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
   SELECT st."revision" INTO STRICT v_room_revision FROM public."HuroofCanonicalState" st JOIN public."HuroofMatch" m ON m."namespace"=st."namespace" AND m."roomId"=st."roomId" AND m."id"=st."activeMatchId" WHERE st."namespace"=p_namespace AND st."roomId"=v_room_id AND m."id"=p_match AND m."ownerFirebaseIdentityId"=p_identity;
   SELECT pg_catalog.jsonb_build_object('scope',x."profileScope",'family',x."profileFamily",'sourceId',x."profileSourceId",'revision',x."profileRevision"::TEXT,'rawArtifactId',x."profileRawArtifactId",'rawArtifactHash',x."profileRawArtifactHash",'pointerVersion',NULL),pg_catalog.jsonb_build_object('matchId',x."matchId",'profileFamily',x."profileFamily",'profileSourceId',x."profileSourceId",'profileRevision',x."profileRevision"::TEXT,'profileRawArtifactId',x."profileRawArtifactId",'profileRawArtifactHash',x."profileRawArtifactHash",'catalogReleaseId',x."catalogReleaseId",'releaseRootHash',x."releaseRootHash",'catalogSealHash',x."catalogSealHash") INTO STRICT v_profile,v_match_pin FROM public."HuroofMatchPin" x WHERE x."namespace"=p_namespace AND x."matchId"=p_match AND x."profileScope"=v_request->>'profileScope';
   v_active:='null'::JSONB;
  END IF;
  PERFORM public.eng03_03_lock_custody(p_namespace);
  SELECT * INTO STRICT v_custody_pointer FROM public."HuroofContentPointer" x WHERE (x."namespace",x."kind",x."scope",x."family",x."sourceId")=(p_namespace,'custody-authority','huroof-release-snapshot-v1','policy','eng03.custody-authority.v1');
  SELECT * INTO STRICT v_custody_revision FROM public."HuroofContentRevision" x WHERE (x."namespace",x."family",x."sourceId",x."revision",x."rawArtifactHash")=(v_custody_pointer."namespace",v_custody_pointer."family",v_custody_pointer."sourceId",v_custody_pointer."revision",v_custody_pointer."rawArtifactHash");
  v_custody:=pg_catalog.jsonb_build_object('sourceId',v_custody_pointer."sourceId",'revision',v_custody_pointer."revision"::TEXT,'rawArtifactHash',v_custody_pointer."rawArtifactHash",'pointerVersion',v_custody_pointer."version"::TEXT);
  v_metadata:=pg_catalog.jsonb_build_object('engine','PG','operation','PG_START','protocol',NULL,'namespace',p_namespace,'owner',p_identity,'policyRevision',v_policy."revision"::TEXT,'policyHash',v_policy."policyHash",'roomId',v_room_id,'roomGeneration',v_room_generation::TEXT,'roomRevision',v_room_revision::TEXT,'activeCatalog',v_active,'profile',v_profile,'custody',v_custody,'matchPin',v_match_pin);
 END IF;
 IF pg_catalog.octet_length(v_metadata::TEXT)::NUMERIC>(v_discovery->>'maxMetadataBytes')::NUMERIC THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_native_subject(v_metadata); RETURN v_metadata;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END $$;
CREATE FUNCTION public.pro262_capacity_pg_policy(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_context JSONB; v_result JSONB;
BEGIN
 v_context:=public.pro262_capacity_owner_context(p_admission_id,p_fence);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,v_context->>'identityId',NULL,NULL,NULL,NULL);
 v_result:=public.eng03_03_policy_read(p_namespace);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,v_context->>'identityId',NULL,NULL,NULL,NULL); RETURN v_result;
END $$;
CREATE FUNCTION public.pro262_capacity_pg_lobby(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_metadata JSONB; v_result JSONB;
BEGIN
 v_metadata:=public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,p_identity,p_room,p_generation,NULL,NULL);
 v_result:=public.eng03_03_lobby_load(p_namespace,p_identity,p_room,p_generation);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,p_identity,p_room,p_generation,NULL,NULL); RETURN v_result;
END $$;
CREATE FUNCTION public.pro262_capacity_pg_content(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT,p_identity TEXT,p_room TEXT,p_generation BIGINT,p_scope TEXT,p_match TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_metadata JSONB; v_result JSONB;
BEGIN
 v_metadata:=public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,p_identity,p_room,p_generation,p_scope,p_match);
 v_result:=public.eng03_03_content_load(p_namespace,p_identity,p_room,p_generation,p_scope,p_match);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,p_identity,p_room,p_generation,p_scope,p_match); RETURN v_result;
END $$;
CREATE FUNCTION public.pro262_capacity_pg_custody(p_admission_id TEXT,p_fence BIGINT,p_namespace TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_context JSONB; v_result JSONB;
BEGIN
 v_context:=public.pro262_capacity_owner_context(p_admission_id,p_fence);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,v_context->>'identityId',NULL,NULL,NULL,NULL);
 v_result:=public.eng03_03_custody_policy(p_namespace);
 PERFORM public.pro262_capacity_pg_subject_lock(p_admission_id,p_fence,p_namespace,v_context->>'identityId',NULL,NULL,NULL,NULL); RETURN v_result;
END $$;
-- Replay metadata and raw spool are immutable and private. Replay admission and its
-- qualified prepaid control/parent/driver/parser envelope must exist before body pull.
CREATE TABLE public."Pro262CapacitySpool" (
 "spoolId" TEXT PRIMARY KEY, "replayId" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityReplay"("replayId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "body" BYTEA NOT NULL, "bodyDigest" TEXT NOT NULL CHECK ("bodyDigest" ~ '^[a-f0-9]{64}$'),
 "request" JSONB NOT NULL, "requestDigest" TEXT NOT NULL CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
 UNIQUE ("replayId","spoolId"), UNIQUE ("spoolId","bodyDigest","requestDigest")
);
CREATE TRIGGER "Pro262CapacityReplay_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityReplay" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TRIGGER "Pro262CapacitySpool_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacitySpool" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
ALTER TABLE public."Pro262CapacityReplayMiss" ADD CONSTRAINT "Pro262CapacityReplayMiss_spool_fk" FOREIGN KEY ("replayId","spoolId") REFERENCES public."Pro262CapacitySpool"("replayId","spoolId") ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE FUNCTION public.pro262_capacity_spool_commit(replay_id TEXT,v_body BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
        prior public."Pro262CapacitySpool"%ROWTYPE; v_profile public."Pro262CapacityReplayProfile"%ROWTYPE; v_request JSONB; v_text TEXT; raw_hash TEXT; request_hash TEXT; spool_id TEXT;
BEGIN
 IF v_body IS NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id FOR SHARE NOWAIT;
 IF NOT FOUND OR r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() OR r."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=r."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<=pg_catalog.clock_timestamp() OR c."replayEnvelope" IS DISTINCT FROM r."replayProofIdentity" OR c."subject"->>'operation' IS DISTINCT FROM r."operation" OR c."subject"->>'namespace' IS DISTINCT FROM r."context"->>'namespace' OR c."subject"->>'project' IS DISTINCT FROM r."context"->>'projectId' OR c."subject"->>'owner' IS DISTINCT FROM r."context"->>'identityId' OR c."subject"->>'uid' IS DISTINCT FROM r."context"->>'uid' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=r."trustId" AND x."generation"=r."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'SUPERVISOR' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'controlKey' IS DISTINCT FROM c."controlKey" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observed_target(r."controlKey",'REPLAY',r."executorPrincipal",r."executorPid",r."executorBackendStart");
 SELECT * INTO v_profile FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=r."replayProofIdentity" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT v_profile."enabled" OR v_profile."validUntil"<=pg_catalog.clock_timestamp() OR v_profile."reservedBackendBytes" IS DISTINCT FROM r."reservedBackendBytes" OR v_profile."reservedSharedBytes" IS DISTINCT FROM r."reservedSharedBytes" OR pg_catalog.octet_length(v_body)>v_profile."maxBodyBytes" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 raw_hash:=pg_catalog.encode(int4_crypto.digest(v_body,'sha256'),'hex');
 SELECT * INTO prior FROM public."Pro262CapacitySpool" x WHERE x."replayId"=replay_id;
 IF FOUND THEN IF prior."bodyDigest" IS DISTINCT FROM raw_hash OR prior."body" IS DISTINCT FROM v_body THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF; RETURN prior."spoolId"; END IF;
 IF NOT EXISTS (SELECT 1 FROM public."Pro262CapacityControlCharge" z WHERE z."kind"=c."controlChargeKind" AND z."eventKey"=c."controlChargeEventKey" AND z."bindingHash"=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.control.v1',c."controlKey",c."route",c."subject",c."requestIdentity",c."holderEnvelope",c."parentEnvelope",c."launchEnvelope",c."replayEnvelope",c."storageProof",c."parentHost",c."parentBoot",c."parentProcessTree",c."expectedReplayPrincipal"::TEXT,c."expectedProducerPrincipal"::TEXT)::TEXT,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_text:=pg_catalog.convert_from(v_body,'UTF8');
 IF v_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_request:=v_text::JSONB;
 IF pg_catalog.jsonb_typeof(v_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF r."operation"='ENTA_SUCCESSOR' THEN
  PERFORM public.e3_comp_validate_external(v_request);
  request_hash:=public.int6_enta_hash(pg_catalog.jsonb_build_object('domain','maydan.enta.e3.external-request.v1','envelope',v_request));
 ELSIF r."operation"='PG_SETUP' THEN
  PERFORM public.eng03_06_setup_request(v_request);
  request_hash:=public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-setup-v1','request',v_request));
 ELSE
  PERFORM public.eng03_06_start_request(v_request);
  request_hash:=public.int5b_hash_json(pg_catalog.jsonb_build_object('domain','eng03-06-successor-start-v1','request',v_request));
 END IF;
 spool_id:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.spool.v1',replay_id,raw_hash)::TEXT,'UTF8'),'sha256'),'hex');
 INSERT INTO public."Pro262CapacitySpool"("spoolId","replayId","body","bodyDigest","request","requestDigest") VALUES(spool_id,replay_id,v_body,raw_hash,v_request,request_hash);
 RETURN spool_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- The SQL executor itself runs the selected original replay, so no caller can attest MISS.
CREATE FUNCTION public.pro262_capacity_replay_probe(replay_id TEXT,spool_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE;
        t public."Pro262CapacityTrust"%ROWTYPE; s public."Pro262CapacitySpool"%ROWTYPE;
        prior public."Pro262CapacityReplayMiss"%ROWTYPE; v_profile public."Pro262CapacityReplayProfile"%ROWTYPE; v_outcome JSONB; v_subject JSONB; error_text TEXT;
BEGIN
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id FOR SHARE NOWAIT;
 IF NOT FOUND OR r."executorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."executorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."executorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() OR r."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=r."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<=pg_catalog.clock_timestamp() OR c."replayEnvelope" IS DISTINCT FROM r."replayProofIdentity" OR
    c."subject"->>'operation' IS DISTINCT FROM r."operation" OR c."subject"->>'namespace' IS DISTINCT FROM r."context"->>'namespace' OR
    c."subject"->>'project' IS DISTINCT FROM r."context"->>'projectId' OR c."subject"->>'owner' IS DISTINCT FROM r."context"->>'identityId' OR c."subject"->>'uid' IS DISTINCT FROM r."context"->>'uid' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=r."trustId" AND x."generation"=r."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'SUPERVISOR' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM r."supervisorPrincipal" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'controlKey' IS DISTINCT FROM c."controlKey" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_process_installation(r."controlKey",'REPLAY');
 SELECT * INTO v_profile FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=r."replayProofIdentity" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT v_profile."enabled" OR v_profile."validUntil"<=pg_catalog.clock_timestamp() OR v_profile."reservedBackendBytes" IS DISTINCT FROM r."reservedBackendBytes" OR v_profile."reservedSharedBytes" IS DISTINCT FROM r."reservedSharedBytes" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public."Pro262CapacityControlCharge" z WHERE z."kind"=c."controlChargeKind" AND z."eventKey"=c."controlChargeEventKey" AND z."bindingHash"=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.control.v1',c."controlKey",c."route",c."subject",c."requestIdentity",c."holderEnvelope",c."parentEnvelope",c."launchEnvelope",c."replayEnvelope",c."storageProof",c."parentHost",c."parentBoot",c."parentProcessTree",c."expectedReplayPrincipal"::TEXT,c."expectedProducerPrincipal"::TEXT)::TEXT,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO s FROM public."Pro262CapacitySpool" x WHERE x."replayId"=replay_id AND x."spoolId"=spool_id;
 IF NOT FOUND OR s."bodyDigest" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(s."body",'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=replay_id;
 IF FOUND THEN
  IF prior."spoolId" IS DISTINCT FROM spool_id OR prior."spoolDigest" IS DISTINCT FROM s."bodyDigest" OR prior."requestDigest" IS DISTINCT FROM s."requestDigest" OR prior."principal" IS DISTINCT FROM SESSION_USER::NAME OR prior."pid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR prior."backendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN pg_catalog.jsonb_build_object('kind','MISS','receiptId',replay_id);
 END IF;
 IF r."operation"='ENTA_SUCCESSOR' THEN v_outcome:=public.e3_comp_retry(r."context"->>'namespace',r."context"->>'projectId',r."context"->>'uid',s."request");
 ELSIF r."operation"='PG_SETUP' THEN v_outcome:=public.eng03_06_successor_setup(r."context",s."request",NULL::JSONB);
 ELSIF r."operation"='PG_START' THEN v_outcome:=public.eng03_06_successor_retry(r."context",s."request");
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_outcome IS NOT NULL THEN
  IF pg_catalog.jsonb_typeof(v_outcome) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF r."operation"='ENTA_SUCCESSOR' THEN
   IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_outcome))<>6 OR NOT (v_outcome ?& ARRAY['gameId','admissionId','physicalProtocol','envelopeVersion','e3Protocol','idempotent']) OR
      COALESCE(v_outcome->>'gameId','') !~ '^[A-Za-z0-9_-]{1,128}$' OR COALESCE(v_outcome->>'admissionId','') !~ '^[A-Za-z0-9_-]{1,128}$' OR v_outcome->'physicalProtocol' IS DISTINCT FROM s."request"->'profile'->'physicalProtocol' OR v_outcome->'envelopeVersion' IS DISTINCT FROM '6'::JSONB OR v_outcome->'e3Protocol' IS DISTINCT FROM '1'::JSONB OR (v_outcome->'physicalProtocol' IN ('4'::JSONB,'5'::JSONB) AND v_outcome->>'gameId' IS DISTINCT FROM s."request"->>'logicalMatchId') OR v_outcome->'idempotent' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  ELSIF r."operation"='PG_SETUP' THEN
   IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_outcome))<>4 OR NOT (v_outcome ?& ARRAY['roomId','locator','revision','replayed']) OR COALESCE(v_outcome->>'roomId','') !~ '^l_[a-f0-9]{64}$' OR COALESCE(v_outcome->>'locator','') !~ '^M2-[A-Za-z0-9]{8}$' OR v_outcome->'revision' IS DISTINCT FROM '0'::JSONB OR v_outcome->'replayed' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  ELSE
   IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_outcome))<>8 OR NOT (v_outcome ?& ARRAY['admissionId','matchId','roomId','status','state','revision','sequence','replayed']) OR COALESCE(v_outcome->>'admissionId','') !~ '^ha_[a-f0-9]{64}$' OR COALESCE(v_outcome->>'matchId','') !~ '^hm_[a-f0-9]{64}$' OR COALESCE(v_outcome->>'roomId','') !~ '^l_[a-f0-9]{64}$' OR v_outcome->>'status' IS DISTINCT FROM 'STARTED' OR v_outcome->>'state' IS DISTINCT FROM 'COMMITTED' OR pg_catalog.jsonb_typeof(v_outcome->'revision') IS DISTINCT FROM 'number' OR (v_outcome->>'revision')::NUMERIC<1 OR (v_outcome->>'revision')::NUMERIC>9007199254740991 OR (v_outcome->>'revision')::NUMERIC<>pg_catalog.trunc((v_outcome->>'revision')::NUMERIC) OR v_outcome->'sequence' IS DISTINCT FROM '1'::JSONB OR v_outcome->'replayed' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  END IF;
  RETURN pg_catalog.jsonb_build_object('kind','OUTCOME','outcome',v_outcome);
 END IF;
 v_subject:=pg_catalog.jsonb_build_object('namespace',c."subject"->>'namespace','project',c."subject"->>'project','owner',c."subject"->>'owner','route',c."route",'operation',r."operation",'requestDigest',s."requestDigest");
 INSERT INTO public."Pro262CapacityReplayMiss"("replayId","controlKey","spoolId","spoolDigest","spoolEnvelope","route","subject","requestDigest","requestIdentity","principal","pid","backendStart") VALUES(replay_id,c."controlKey",spool_id,s."bodyDigest",c."parentEnvelope",c."route",v_subject,s."requestDigest",c."requestIdentity",SESSION_USER::NAME,pg_catalog.pg_backend_pid(),public.pro262_capacity_backend_start());
 RETURN pg_catalog.jsonb_build_object('kind','MISS','receiptId',replay_id);
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS error_text = MESSAGE_TEXT;
 IF error_text IN ('E3_EXTERNAL_IDEMPOTENCY_CONFLICT','E3_EXTERNAL_LOGICAL_COLLISION','E3_EXISTING_NATIVE_NOT_ATTACHABLE','SUCCESSOR_IDEMPOTENCY_COLLISION','SUCCESSOR_IDEMPOTENCY_CONFLICT','SUCCESSOR_SETUP_CONFLICT','ACCOUNT_NOT_READY') THEN RAISE EXCEPTION '%',error_text; END IF;
 RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

CREATE TABLE public."Pro262CapacitySpoolConsumption" (
 "admissionId" TEXT NOT NULL, "fence" BIGINT NOT NULL, "spoolId" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacitySpool"("spoolId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 PRIMARY KEY ("admissionId","fence"), FOREIGN KEY ("admissionId","fence") REFERENCES public."Pro262CapacityAdmission"("admissionId","fence") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacitySpoolConsumption_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacitySpoolConsumption" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
-- Grant solely to the dedicated admitted producer; the row is consumed before bytes leave.
CREATE FUNCTION public.pro262_capacity_read_spool(admission_id TEXT,v_fence BIGINT,spool_id TEXT) RETURNS BYTEA
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE; s public."Pro262CapacitySpool"%ROWTYPE;
BEGIN
 PERFORM public.pro262_capacity_recheck(admission_id,v_fence);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR SHARE NOWAIT;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=i."replayId" AND x."spoolDigest"=i."spoolDigest";
 SELECT * INTO STRICT s FROM public."Pro262CapacitySpool" x WHERE x."spoolId"=m."spoolId" AND x."replayId"=m."replayId";
 IF a."state"<>'RUNNING' OR s."spoolId" IS DISTINCT FROM spool_id OR a."subject" IS DISTINCT FROM m."subject" OR s."bodyDigest" IS DISTINCT FROM m."spoolDigest" OR s."requestDigest" IS DISTINCT FROM m."requestDigest" OR s."bodyDigest" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(s."body",'sha256'),'hex') OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityDebit" d WHERE d."issuanceKey"=a."issuanceKey") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacitySpoolConsumption"("admissionId","fence","spoolId") VALUES(admission_id,v_fence,s."spoolId");
 RETURN s."body";
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- Authenticated supplier channel is separately provisioned and qualified. The verifier
-- principal/session must match protected trust; evidence and its verifier receipt remain exact.
CREATE FUNCTION public.pro262_capacity_accept_supplier(receipt_id TEXT,trust_id TEXT,v_generation BIGINT,v_evidence BYTEA,v_verification BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE trust public."Pro262CapacityTrust"%ROWTYPE; v JSONB; evidence_hash TEXT; receipt_hash TEXT; signature_bytes BYTEA; prior public."Pro262VerifiedSupplierReceipt"%ROWTYPE; charge_hash TEXT;
BEGIN
 IF receipt_id IS NULL OR receipt_id='' OR v_evidence IS NULL OR v_verification IS NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" t WHERE t."trustId"=trust_id AND t."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."purpose"<>'CAPACITY_APPROVAL' OR trust."revoked" OR trust."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 evidence_hash:=pg_catalog.encode(int4_crypto.digest(v_evidence,'sha256'),'hex'); receipt_hash:=pg_catalog.encode(int4_crypto.digest(v_verification,'sha256'),'hex');
 v:=pg_catalog.convert_from(v_verification,'UTF8')::JSONB;
 IF pg_catalog.jsonb_typeof(v) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v))<>11 OR NOT (v ?& ARRAY['version','purpose','receiptId','issuer','trustId','generation','evidenceHash','keyId','serialization','subject','signature']) OR
    v->'version' IS DISTINCT FROM '1'::JSONB OR v->>'purpose' IS DISTINCT FROM 'CAPACITY_APPROVAL' OR v->>'receiptId' IS DISTINCT FROM receipt_id OR v->>'issuer' IS DISTINCT FROM trust."issuer" OR v->>'trustId' IS DISTINCT FROM trust."trustId" OR v->>'generation' IS DISTINCT FROM trust."generation"::TEXT OR v->>'evidenceHash' IS DISTINCT FROM evidence_hash OR v->>'keyId' IS DISTINCT FROM trust."verifierKeyId" OR COALESCE(v->>'serialization','')='' OR v->'subject' IS DISTINCT FROM trust."scope"->'subject' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 signature_bytes:=pg_catalog.decode(v->>'signature','base64'); IF pg_catalog.octet_length(signature_bytes)=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262VerifiedSupplierReceipt" x WHERE x."receiptId"=receipt_id;
 IF FOUND THEN
  IF prior."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR prior."trustId" IS DISTINCT FROM trust_id OR prior."trustGeneration" IS DISTINCT FROM v_generation OR prior."evidence" IS DISTINCT FROM v_evidence OR prior."verification" IS DISTINCT FROM v_verification THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN receipt_id;
 END IF;
 charge_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.supplier.v1',receipt_id,trust_id,v_generation,evidence_hash,receipt_hash)::TEXT,'UTF8'),'sha256'),'hex');
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='SUPPLIER_RECEIPT' AND x."eventKey"=receipt_id AND x."bindingHash"=charge_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262VerifiedSupplierReceipt"("supplierId","receiptId","receiptHash","trustId","trustGeneration","supplierPrincipal","channelId","issuer","keyId","serialization","evidence","signature","verification","subject") VALUES(SESSION_USER::TEXT,receipt_id,receipt_hash,trust_id,v_generation,SESSION_USER::NAME,trust."channelId",trust."issuer",trust."verifierKeyId",v->>'serialization',v_evidence,signature_bytes,v_verification,v->'subject');
 RETURN receipt_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

CREATE FUNCTION public.pro262_capacity_import(verified_receipt_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public."Pro262VerifiedSupplierReceipt"%ROWTYPE; trust public."Pro262CapacityTrust"%ROWTYPE; existing public."Pro262CapacityApproval"%ROWTYPE;
        approval JSONB; evidence_hash TEXT; approval_id TEXT; from_time TIMESTAMPTZ; until_time TIMESTAMPTZ; charge_hash TEXT;
BEGIN
 SELECT * INTO receipt FROM public."Pro262VerifiedSupplierReceipt" x WHERE x."receiptId"=verified_receipt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=receipt."trustId" AND x."generation"=receipt."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR trust."purpose"<>'CAPACITY_APPROVAL' OR trust."revoked" OR trust."validFrom">pg_catalog.clock_timestamp() OR trust."validUntil"<=pg_catalog.clock_timestamp() OR trust."supplierPrincipal" IS DISTINCT FROM receipt."supplierPrincipal" OR trust."issuer" IS DISTINCT FROM receipt."issuer" OR trust."channelId" IS DISTINCT FROM receipt."channelId" OR trust."verifierKeyId" IS DISTINCT FROM receipt."keyId" OR trust."scope"->>'serialization' IS DISTINCT FROM receipt."serialization" OR receipt."serialization"<>'json-utf8-v1' OR trust."scope"->'subject' IS DISTINCT FROM receipt."subject" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF receipt."receiptHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(receipt."verification",'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 evidence_hash:=pg_catalog.encode(int4_crypto.digest(receipt."evidence",'sha256'),'hex'); approval:=pg_catalog.convert_from(receipt."evidence",'UTF8')::JSONB;
 IF pg_catalog.jsonb_typeof(approval) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(approval))<>11 OR NOT (approval ?& ARRAY['version','purpose','approvalId','issuer','trustId','generation','subject','reuse','validFrom','validUntil','scope']) OR
    approval->'version' IS DISTINCT FROM '1'::JSONB OR approval->>'purpose' IS DISTINCT FROM 'CAPACITY_APPROVAL' OR COALESCE(approval->>'approvalId','')='' OR approval->>'issuer' IS DISTINCT FROM trust."issuer" OR approval->>'trustId' IS DISTINCT FROM trust."trustId" OR approval->>'generation' IS DISTINCT FROM trust."generation"::TEXT OR approval->'subject' IS DISTINCT FROM receipt."subject" OR COALESCE(approval->>'reuse','') NOT IN ('ONE_USE','REUSABLE') OR approval->'scope' IS DISTINCT FROM trust."scope"->'approvedScope' OR
    COALESCE(approval->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR COALESCE(approval->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 from_time:=(approval->>'validFrom')::TIMESTAMPTZ; until_time:=(approval->>'validUntil')::TIMESTAMPTZ; approval_id:=approval->>'approvalId';
 IF from_time<trust."validFrom" OR until_time>trust."validUntil" OR from_time>pg_catalog.clock_timestamp() OR until_time<=pg_catalog.clock_timestamp() OR from_time>=until_time THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO existing FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=approval_id;
 IF FOUND THEN
  IF existing."receiptId" IS DISTINCT FROM receipt."receiptId" OR existing."supplierId" IS DISTINCT FROM receipt."supplierId" OR existing."evidenceHash" IS DISTINCT FROM evidence_hash OR existing."reuse" IS DISTINCT FROM approval->>'reuse' OR existing."scope" IS DISTINCT FROM approval->'scope' OR existing."validFrom" IS DISTINCT FROM from_time OR existing."validUntil" IS DISTINCT FROM until_time THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN approval_id;
 END IF;
 charge_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.import.v1',receipt."receiptId",evidence_hash)::TEXT,'UTF8'),'sha256'),'hex');
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='APPROVAL_IMPORT' AND x."eventKey"=receipt."receiptId" AND x."bindingHash"=charge_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityApproval"("approvalId","supplierId","receiptId","evidenceHash","issuer","trustId","trustGeneration","reuse","scope","validFrom","validUntil") VALUES(approval_id,receipt."supplierId",receipt."receiptId",evidence_hash,trust."issuer",trust."trustId",trust."generation",approval->>'reuse',approval->'scope',from_time,until_time);
 RETURN approval_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- Installation/qualification may supply an exact bootstrap grant only under separately
-- authorized operator custody. No bootstrap identity, approved record or budget is seeded.
CREATE TABLE public."Pro262CapacityBootstrapTrust" (
 "trustId" TEXT NOT NULL, "generation" BIGINT NOT NULL CHECK ("generation">0),
 "principal" NAME NOT NULL, "channelId" TEXT NOT NULL, "recordHash" TEXT NOT NULL CHECK ("recordHash" ~ '^[a-f0-9]{64}$'),
 "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "validUntil" TIMESTAMPTZ NOT NULL,
 PRIMARY KEY ("trustId","generation")
);
CREATE TRIGGER "Pro262CapacityBootstrapTrust_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityBootstrapTrust" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_trust_provision(trust_id TEXT,v_generation BIGINT,p_record JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE root public."Pro262CapacityBootstrapTrust"%ROWTYPE; existing public."Pro262CapacityTrust"%ROWTYPE;
        record_hash TEXT; from_time TIMESTAMPTZ; until_time TIMESTAMPTZ;
BEGIN
 IF trust_id IS NULL OR trust_id='' OR v_generation IS NULL OR v_generation<=0 OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>11 OR NOT (p_record ?& ARRAY['issuer','supplierPrincipal','channelId','verifierKeyId','trustRootId','policyRevision','policyHash','purpose','scope','validFrom','validUntil']) OR
    COALESCE(p_record->>'issuer','')='' OR COALESCE(p_record->>'supplierPrincipal','')='' OR COALESCE(p_record->>'channelId','')='' OR COALESCE(p_record->>'verifierKeyId','')='' OR COALESCE(p_record->>'trustRootId','')='' OR COALESCE(p_record->>'policyRevision','')='' OR COALESCE(p_record->>'policyHash','') !~ '^[a-f0-9]{64}$' OR
    COALESCE(p_record->>'purpose','') NOT IN ('CAPACITY_APPROVAL','CLEANUP_OBSERVATION','SUPERVISOR','OPERATION_ISSUER','CONTROL_ALLOCATOR','INSTALL_OBSERVATION') OR pg_catalog.jsonb_typeof(p_record->'scope') IS DISTINCT FROM 'object' OR
    COALESCE(p_record->>'validFrom','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR COALESCE(p_record->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 record_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO root FROM public."Pro262CapacityBootstrapTrust" x WHERE x."trustId"=trust_id AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR root."principal" IS DISTINCT FROM SESSION_USER::NAME OR root."validUntil"<=pg_catalog.clock_timestamp() OR root."recordHash" IS DISTINCT FROM record_hash THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF (p_record->>'supplierPrincipal')::NAME::TEXT IS DISTINCT FROM p_record->>'supplierPrincipal' OR
    (p_record->>'purpose'='CAPACITY_APPROVAL' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>3 OR NOT ((p_record->'scope') ?& ARRAY['subject','serialization','approvedScope']))) OR
    (p_record->>'purpose'='SUPERVISOR' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>4 OR NOT ((p_record->'scope') ?& ARRAY['controlKey','credentialEpoch','sourceIdentity','supervisorIdentity']) OR COALESCE(p_record->'scope'->>'controlKey','')='' OR COALESCE(p_record->'scope'->>'credentialEpoch','')='' OR COALESCE(p_record->'scope'->>'sourceIdentity','')='' OR COALESCE(p_record->'scope'->>'supervisorIdentity','')='')) OR
    (p_record->>'purpose'='INSTALL_OBSERVATION' AND (pg_catalog.jsonb_typeof(p_record->'scope') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>5 OR NOT ((p_record->'scope') ?& ARRAY['lane','installationGeneration','installationEvidenceHash','installation','observerHolderId']) OR pg_catalog.jsonb_typeof(p_record->'scope'->'lane') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'->'lane'))<>5 OR NOT ((p_record->'scope'->'lane') ?& ARRAY['deployment','namespace','project','environment','kind']) OR p_record->'scope'->'lane'->>'kind' NOT IN ('REPLAY','PRODUCER') OR COALESCE(p_record->'scope'->>'installationGeneration','') !~ '^[1-9][0-9]{0,18}$' OR COALESCE(p_record->'scope'->>'installationEvidenceHash','') !~ '^[a-f0-9]{64}$' OR COALESCE(p_record->'scope'->>'observerHolderId','')='' OR pg_catalog.jsonb_typeof(p_record->'scope'->'installation') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'->'installation'))<>18 OR NOT ((p_record->'scope'->'installation') ?& ARRAY['host','boot','clusterIdentity','databaseIdentity','serverVersion','serverBuild','serverBinary','settingsIdentity','nativeClosure','migrationClosure','roleClosure','runtimeClosure','sourceClosure','driverClosure','supervisorClosure','executableIdentity','encoding','stack']) OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_record->'scope'->'installation') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')) OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_record->'scope'->'lane') e WHERE pg_catalog.jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR e.value#>>'{}' IN ('','*')))) OR
    (p_record->>'purpose'='CONTROL_ALLOCATOR' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>1 OR COALESCE(p_record->'scope'->>'kind','')='')) OR
    (p_record->>'purpose'='OPERATION_ISSUER' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>1 OR COALESCE(p_record->'scope'->>'physicalIdentity','')='')) OR
    (p_record->>'purpose'='CLEANUP_OBSERVATION' AND ((SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record->'scope'))<>4 OR NOT ((p_record->'scope') ?& ARRAY['host','boot','inputBound','inputEnvelope']) OR COALESCE(p_record->'scope'->>'host','')='' OR COALESCE(p_record->'scope'->>'boot','')='' OR COALESCE(p_record->'scope'->>'inputEnvelope','')='' OR pg_catalog.jsonb_typeof(p_record->'scope'->'inputBound') IS DISTINCT FROM 'string' OR COALESCE(p_record->'scope'->>'inputBound','') !~ '^[1-9][0-9]{0,18}$' OR (p_record->'scope'->>'inputBound')::NUMERIC>9223372036854775807)) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 from_time:=(p_record->>'validFrom')::TIMESTAMPTZ; until_time:=(p_record->>'validUntil')::TIMESTAMPTZ;
 IF from_time>=until_time OR until_time>root."validUntil" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO existing FROM public."Pro262CapacityTrust" x WHERE x."trustId"=trust_id AND x."generation"=v_generation;
 IF FOUND THEN
  IF existing."issuer" IS DISTINCT FROM p_record->>'issuer' OR existing."supplierPrincipal"::TEXT IS DISTINCT FROM p_record->>'supplierPrincipal' OR existing."channelId" IS DISTINCT FROM p_record->>'channelId' OR existing."verifierKeyId" IS DISTINCT FROM p_record->>'verifierKeyId' OR existing."trustRootId" IS DISTINCT FROM p_record->>'trustRootId' OR existing."policyRevision" IS DISTINCT FROM p_record->>'policyRevision' OR existing."policyHash" IS DISTINCT FROM p_record->>'policyHash' OR existing."purpose" IS DISTINCT FROM p_record->>'purpose' OR existing."scope" IS DISTINCT FROM p_record->'scope' OR existing."validFrom" IS DISTINCT FROM from_time OR existing."validUntil" IS DISTINCT FROM until_time THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN trust_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='TRUST_PROVISION' AND x."eventKey"=trust_id||':'||v_generation::TEXT AND x."bindingHash"=record_hash) AND NOT (p_record->>'purpose'='CONTROL_ALLOCATOR' AND EXISTS(SELECT 1 FROM public."Pro262CapacityControlBaseline" b WHERE b."kind"='TRUST_PROVISION' AND b."enabled" AND b."coverageEvidenceHash"=root."evidenceHash")) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityTrust"("trustId","generation","issuer","supplierPrincipal","channelId","verifierKeyId","trustRootId","policyRevision","policyHash","purpose","scope","validFrom","validUntil") VALUES(trust_id,v_generation,p_record->>'issuer',(p_record->>'supplierPrincipal')::NAME,p_record->>'channelId',p_record->>'verifierKeyId',p_record->>'trustRootId',p_record->>'policyRevision',p_record->>'policyHash',p_record->>'purpose',p_record->'scope',from_time,until_time);
 RETURN trust_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- Only the protected supervisor or the exact replay executor can read this bounded descriptor.
CREATE FUNCTION public.pro262_capacity_read_miss(replay_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id;
 IF NOT FOUND OR NOT ((r."supervisorPrincipal"=SESSION_USER::NAME AND r."supervisorPid"=pg_catalog.pg_backend_pid() AND r."supervisorBackendStart"=public.pro262_capacity_backend_start()) OR (r."executorPrincipal"=SESSION_USER::NAME AND r."executorPid"=pg_catalog.pg_backend_pid() AND r."executorBackendStart"=public.pro262_capacity_backend_start())) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=replay_id;
 IF NOT FOUND OR m."principal" IS DISTINCT FROM r."executorPrincipal" OR m."pid" IS DISTINCT FROM r."executorPid" OR m."backendStart" IS DISTINCT FROM r."executorBackendStart" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('id',m."replayId",'replay',m."replayId",'requestIdentity',m."requestIdentity",'spool',pg_catalog.jsonb_build_object('id',m."spoolId",'digest',m."spoolDigest",'envelope',m."spoolEnvelope"),'subject',m."subject",'incarnation',pg_catalog.jsonb_build_object('host',r."executorHost",'boot',r."executorBoot",'processTree',r."executorProcessTree",'backendPrincipal',m."principal"::TEXT,'backendPid',m."pid",'backendStart',m."backendStart"::TEXT));
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- No bootstrap qualification is seeded; an independently qualified operator must
-- establish the exact proof hash and physical evidence under separately approved custody.
CREATE TABLE public."Pro262CapacityBootstrapQualification" (
 "qualificationId" TEXT NOT NULL, "generation" BIGINT NOT NULL CHECK ("generation">0), "approvalId" TEXT NOT NULL REFERENCES public."Pro262CapacityApproval"("approvalId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "publisherPrincipal" NAME NOT NULL, "proofHash" TEXT NOT NULL CHECK ("proofHash" ~ '^[a-f0-9]{64}$'), "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "validUntil" TIMESTAMPTZ NOT NULL,
 PRIMARY KEY ("qualificationId","generation")
);
CREATE TRIGGER "Pro262CapacityBootstrapQualification_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityBootstrapQualification" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_publish_qualification(approval_id TEXT,qualification_id TEXT,v_generation BIGINT,v_proof JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_boot public."Pro262CapacityBootstrapQualification"%ROWTYPE; a public."Pro262CapacityApproval"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
        existing public."Pro262CapacityQualification"%ROWTYPE; proof_hash TEXT; from_time TIMESTAMPTZ; until_time TIMESTAMPTZ;
BEGIN
 IF qualification_id IS NULL OR qualification_id='' OR v_generation IS NULL OR v_generation<=0 OR NOT public.pro262_capacity_validate_proof(v_proof) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 proof_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(v_proof::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO v_boot FROM public."Pro262CapacityBootstrapQualification" x WHERE x."qualificationId"=qualification_id AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR v_boot."publisherPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_boot."approvalId" IS DISTINCT FROM approval_id OR v_boot."proofHash" IS DISTINCT FROM proof_hash OR v_boot."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=approval_id FOR SHARE NOWAIT;
 IF NOT FOUND OR a."validFrom">pg_catalog.clock_timestamp() OR a."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=a."trustId" AND x."generation"=a."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CAPACITY_APPROVAL' OR t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF a."scope" IS DISTINCT FROM (v_proof-'holderSchedule'-'qualifiedLimits'-'validity') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 from_time:=(v_proof->'validity'->>'from')::TIMESTAMPTZ; until_time:=(v_proof->'validity'->>'until')::TIMESTAMPTZ;
 IF from_time<a."validFrom" OR from_time>pg_catalog.clock_timestamp() OR until_time>a."validUntil" OR until_time>v_boot."validUntil" OR until_time<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO existing FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=qualification_id AND x."generation"=v_generation;
 IF FOUND THEN
  IF existing."approvalId" IS DISTINCT FROM approval_id OR existing."proofHash" IS DISTINCT FROM proof_hash OR existing."proof" IS DISTINCT FROM v_proof OR existing."validUntil" IS DISTINCT FROM until_time THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN qualification_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='QUALIFICATION' AND x."eventKey"=qualification_id||':'||v_generation::TEXT AND x."bindingHash"=proof_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityQualification"("qualificationId","generation","approvalId","proof","proofHash","domain","sourceClosure","validUntil","enabled") VALUES(qualification_id,v_generation,approval_id,v_proof,proof_hash,v_proof->'physicalDomain'->>'identity',v_proof->>'sourceClosure',until_time,TRUE);
 RETURN qualification_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

CREATE FUNCTION public.pro262_capacity_register_control(control_key TEXT,v_request JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public."Pro262CapacityTrust"%ROWTYPE; old_row public."Pro262CapacityControlReservation"%ROWTYPE; charge_hash TEXT; expires TIMESTAMPTZ;
BEGIN
 IF control_key IS NULL OR control_key='' OR pg_catalog.jsonb_typeof(v_request) IS DISTINCT FROM 'object' OR
    (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_request))<>14 OR NOT (v_request ?& ARRAY['route','subject','requestIdentity','holderEnvelope','parentEnvelope','launchEnvelope','replayEnvelope','storageProof','expiry','parentHost','parentBoot','parentProcessTree','expectedReplayPrincipal','expectedProducerPrincipal']) OR
    pg_catalog.jsonb_typeof(v_request->'subject') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_request->'subject'))<>5 OR NOT ((v_request->'subject') ?& ARRAY['namespace','project','owner','uid','operation']) OR
    COALESCE(v_request->>'route','')='' OR COALESCE(v_request->>'requestIdentity','')='' OR COALESCE(v_request->>'holderEnvelope','')='' OR COALESCE(v_request->>'parentEnvelope','')='' OR COALESCE(v_request->>'launchEnvelope','')='' OR COALESCE(v_request->>'replayEnvelope','')='' OR COALESCE(v_request->>'storageProof','')='' OR COALESCE(v_request->>'parentHost','')='' OR COALESCE(v_request->>'parentBoot','')='' OR COALESCE(v_request->>'parentProcessTree','')='' OR COALESCE(v_request->>'expectedReplayPrincipal','')='' OR COALESCE(v_request->>'expectedProducerPrincipal','')='' OR (v_request->>'expectedReplayPrincipal')::NAME::TEXT IS DISTINCT FROM v_request->>'expectedReplayPrincipal' OR (v_request->>'expectedProducerPrincipal')::NAME::TEXT IS DISTINCT FROM v_request->>'expectedProducerPrincipal' OR v_request->>'expectedReplayPrincipal'=v_request->>'expectedProducerPrincipal' OR
    COALESCE(v_request->'subject'->>'namespace','')='' OR COALESCE(v_request->'subject'->>'project','')='' OR COALESCE(v_request->'subject'->>'owner','')='' OR COALESCE(v_request->'subject'->>'uid','')='' OR COALESCE(v_request->'subject'->>'operation','') NOT IN ('ENTA_SUCCESSOR','PG_SETUP','PG_START') OR COALESCE(v_request->>'expiry','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 expires:=(v_request->>'expiry')::TIMESTAMPTZ;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND NOT x."revoked" AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR expires<=pg_catalog.clock_timestamp() OR expires>t."validUntil" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key;
 IF FOUND THEN
  IF old_row."route" IS DISTINCT FROM v_request->>'route' OR old_row."subject" IS DISTINCT FROM v_request->'subject' OR old_row."requestIdentity" IS DISTINCT FROM v_request->>'requestIdentity' OR old_row."holderEnvelope" IS DISTINCT FROM v_request->>'holderEnvelope' OR old_row."parentEnvelope" IS DISTINCT FROM v_request->>'parentEnvelope' OR old_row."launchEnvelope" IS DISTINCT FROM v_request->>'launchEnvelope' OR old_row."replayEnvelope" IS DISTINCT FROM v_request->>'replayEnvelope' OR old_row."storageProof" IS DISTINCT FROM v_request->>'storageProof' OR old_row."parentHost" IS DISTINCT FROM v_request->>'parentHost' OR old_row."parentBoot" IS DISTINCT FROM v_request->>'parentBoot' OR old_row."parentProcessTree" IS DISTINCT FROM v_request->>'parentProcessTree' OR old_row."expectedReplayPrincipal"::TEXT IS DISTINCT FROM v_request->>'expectedReplayPrincipal' OR old_row."expectedProducerPrincipal"::TEXT IS DISTINCT FROM v_request->>'expectedProducerPrincipal' OR old_row."expiresAt" IS DISTINCT FROM expires THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN control_key;
 END IF;
 charge_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.control.v1',control_key,v_request->>'route',v_request->'subject',v_request->>'requestIdentity',v_request->>'holderEnvelope',v_request->>'parentEnvelope',v_request->>'launchEnvelope',v_request->>'replayEnvelope',v_request->>'storageProof',v_request->>'parentHost',v_request->>'parentBoot',v_request->>'parentProcessTree',v_request->>'expectedReplayPrincipal',v_request->>'expectedProducerPrincipal')::TEXT,'UTF8'),'sha256'),'hex');
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=x."kind" WHERE x."kind"='CONTROL_RESERVATION' AND x."eventKey"=control_key AND x."bindingHash"=charge_hash AND b."coverageContract"='principal-launch-and-closed-scope-v2') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityControlReservation"("controlKey","route","subject","requestIdentity","holderEnvelope","parentEnvelope","launchEnvelope","replayEnvelope","storageProof","parentHost","parentBoot","parentProcessTree","expectedReplayPrincipal","expectedProducerPrincipal","expiresAt","state","controlChargeKind","controlChargeEventKey") VALUES(control_key,v_request->>'route',v_request->'subject',v_request->>'requestIdentity',v_request->>'holderEnvelope',v_request->>'parentEnvelope',v_request->>'launchEnvelope',v_request->>'replayEnvelope',v_request->>'storageProof',v_request->>'parentHost',v_request->>'parentBoot',v_request->>'parentProcessTree',(v_request->>'expectedReplayPrincipal')::NAME,(v_request->>'expectedProducerPrincipal')::NAME,expires,'RESERVED','CONTROL_RESERVATION',control_key);
 IF COALESCE(t."scope"->>'credentialEpoch','')='' OR COALESCE(t."scope"->>'sourceIdentity','')='' OR COALESCE(t."scope"->>'supervisorIdentity','')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityPrincipalLease"("controlKey","kind","principalOid","credentialEpoch","launchEpoch","state")
 SELECT control_key,v.kind,r.oid,t."scope"->>'credentialEpoch',v_request->>'launchEnvelope','ACTIVE'
 FROM (VALUES ('REPLAY',v_request->>'expectedReplayPrincipal'),('PRODUCER',v_request->>'expectedProducerPrincipal')) AS v(kind,principal)
 JOIN pg_catalog.pg_roles r ON r.rolname=v.principal AND r.rolcanlogin AND NOT r.rolsuper;
 IF (SELECT pg_catalog.count(*) FROM public."Pro262CapacityPrincipalLease" x WHERE x."controlKey"=control_key)<>2 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN control_key;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_assert_launch_integrity() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityLaunchReservation" l WHERE l."state"='TRANSFERRED' AND
 ((l."kind"='REPLAY' AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r JOIN public."Pro262CapacityControlReservation" c ON c."controlKey"=r."controlKey" JOIN public."Pro262CapacityReplayProfile" p ON p."id"=r."replayProofIdentity" WHERE r."replayId"=l."targetId" AND r."controlKey"=l."controlKey" AND l."subject"=c."subject" AND l."profileId"=p."id" AND l."profileHash"=p."proofHash" AND l."reservedBackendBytes"=r."reservedBackendBytes" AND l."reservedSharedBytes"=r."reservedSharedBytes")) OR
  (l."kind"='PRODUCER' AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityAdmission" a JOIN public."Pro262CapacityQualification" q ON (q."qualificationId",q."generation")=(a."qualificationId",a."qualificationGeneration") JOIN public."Pro262CapacityIssuanceRequest" i ON i."issuanceKey"=a."issuanceKey" JOIN public."Pro262CapacityReplay" r ON r."replayId"=i."replayId" WHERE r."controlKey"=l."controlKey" AND a."admissionId"=l."targetId" AND a."fence"=l."targetFence" AND l."subject"=a."subject" AND l."profileId"=q."qualificationId" AND l."profileGeneration"=q."generation" AND l."profileHash"=q."proofHash" AND l."reservedBackendBytes"=a."reservedBackendBytes" AND l."reservedSharedBytes"=a."reservedSharedBytes")))) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.pro262_capacity_reserve_launch(control_key TEXT,intent_kind TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE global_row RECORD; d public."Pro262CapacityPhysicalDomain"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; rp public."Pro262CapacityReplayProfile"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE; old_row public."Pro262CapacityLaunchReservation"%ROWTYPE; backend NUMERIC; shared NUMERIC; used_backend NUMERIC; used_shared NUMERIC; v_id TEXT; gen BIGINT; v_hash TEXT; subj JSONB; v_install public."Pro262CapacityTrust"%ROWTYPE; v_expected_lane JSONB; v_expected_installation JSONB;
BEGIN
 IF intent_kind NOT IN ('REPLAY','PRODUCER') OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO d FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=global_row."physicalIdentity" FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT d."enabled" OR d."proofIdentity" IS DISTINCT FROM global_row."proofIdentity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=control_key AND b."coverageContract"='principal-launch-and-closed-scope-v2') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<c."expiresAt" OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=control_key AND l."kind"=intent_kind AND l."state"='ACTIVE') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityConnectionIntent" x JOIN public."Pro262CapacityPrincipalLease" l ON l."controlKey"=x."controlKey" AND l."kind"=x."kind" JOIN pg_catalog.pg_roles r ON r.oid=l."principalOid" WHERE x."controlKey"=control_key AND x."kind"=intent_kind AND x."state"='OPENING' AND r.rolname=x."expectedPrincipal") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO rp FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=c."replayEnvelope" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT rp."enabled" OR rp."validUntil"<c."expiresAt" OR rp."physicalIdentity" IS DISTINCT FROM global_row."physicalIdentity" OR rp."proofIdentity" IS DISTINCT FROM global_row."proofIdentity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF intent_kind='REPLAY' THEN v_id:=rp."id";gen:=NULL;v_hash:=rp."proofHash";backend:=rp."reservedBackendBytes";shared:=rp."reservedSharedBytes";subj:=c."subject";
 ELSE
  SELECT * INTO STRICT m FROM public."Pro262CapacityReplayMiss" x WHERE x."controlKey"=control_key;
  SELECT q0.* INTO STRICT q FROM public."Pro262CapacityQualification" q0 JOIN public."Pro262CapacityApproval" a ON a."approvalId"=q0."approvalId" JOIN public."Pro262VerifiedSupplierReceipt" r ON (r."supplierId",r."receiptId")=(a."supplierId",a."receiptId") JOIN public."Pro262CapacityTrust" tr ON (tr."trustId",tr."generation")=(a."trustId",a."trustGeneration") WHERE tr."purpose"='CAPACITY_APPROVAL' AND NOT tr."revoked" AND tr."validFrom"<=pg_catalog.clock_timestamp() AND tr."validUntil">=c."expiresAt" AND a."evidenceHash"=pg_catalog.encode(int4_crypto.digest(r."evidence",'sha256'),'hex') AND q0."proofHash"=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(q0."proof"::TEXT,'UTF8'),'sha256'),'hex') AND q0."enabled" AND q0."validUntil">=c."expiresAt" AND a."validFrom"<=pg_catalog.clock_timestamp() AND a."validUntil">=c."expiresAt" AND r."subject"=m."subject" AND q0."proof"->>'namespace'=m."subject"->>'namespace' AND q0."proof"->>'project'=m."subject"->>'project' AND q0."domain"=global_row."physicalIdentity" AND q0."proof"->'physicalDomain'->>'proofIdentity'=global_row."proofIdentity" AND q0."proof"->'overlapSchedule'->>'replayProfileId'=rp."id" AND q0."proof"->'overlapSchedule'->>'replayProofHash'=rp."proofHash" AND public.pro262_capacity_validate_proof(q0."proof") FOR SHARE OF q0,a,tr NOWAIT;
  v_id:=q."qualificationId";gen:=q."generation";v_hash:=q."proofHash";backend:=(q."proof"->'qualifiedLimits'->>'backendBytes')::NUMERIC;shared:=(q."proof"->'qualifiedLimits'->>'sharedBytes')::NUMERIC;subj:=m."subject";
 END IF;
 IF intent_kind='REPLAY' THEN v_expected_lane:=rp."proof"->'installationLane';v_expected_installation:=rp."proof"->'installation'; ELSE v_expected_lane:=q."proof"->'installationLane';v_expected_installation:=q."proof"->'installation'; END IF;
 SELECT * INTO STRICT v_install FROM public."Pro262CapacityTrust" x WHERE x."purpose"='INSTALL_OBSERVATION' AND x."scope"->'lane'=v_expected_lane AND NOT x."revoked" AND x."validFrom"<=pg_catalog.clock_timestamp() AND x."validUntil">=c."expiresAt" FOR SHARE NOWAIT;
 IF v_expected_lane->>'namespace' IS DISTINCT FROM c."subject"->>'namespace' OR v_expected_lane->>'project' IS DISTINCT FROM c."subject"->>'project' OR v_expected_lane->>'kind' IS DISTINCT FROM intent_kind OR v_install."scope"->'installation' IS DISTINCT FROM v_expected_installation OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputReservation" slot WHERE slot."baselineAllocationProof"=v_install."scope"->>'observerHolderId' AND slot."observerTrustId"=v_install."trustId" AND slot."observerTrustGeneration"=v_install."generation" AND slot."phase"='INSTALL_PROCESS' AND slot."record"->>'targetControlKey'=control_key AND slot."record"->>'targetKind'=intent_kind AND EXISTS(SELECT 1 FROM public."Pro262CapacityPrincipalLease" lease WHERE lease."controlKey"=control_key AND lease."kind"=intent_kind AND lease."state"='ACTIVE' AND lease."credentialEpoch"=slot."record"->>'targetCredentialEpoch' AND lease."launchEpoch"=slot."record"->>'targetLaunchEpoch') AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claimed WHERE claimed."reservationId"=slot."reservationId")) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=control_key AND x."kind"=intent_kind;
 IF FOUND THEN IF (old_row."profileId",old_row."profileGeneration",old_row."profileHash",old_row."subject",old_row."reservedBackendBytes",old_row."reservedSharedBytes") IS DISTINCT FROM (v_id,gen,v_hash,subj,backend,shared) OR old_row."state"<>'RESERVED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN 'EXISTING'; END IF;
 PERFORM public.pro262_capacity_assert_launch_integrity();
 SELECT COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro262CapacityAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum(r."reservedBackendBytes") FROM public."Pro262CapacityReplay" r JOIN public."Pro262CapacityControlReservation" x ON x."controlKey"=r."controlKey" WHERE x."state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro262CapacityLaunchReservation" WHERE "state"='RESERVED'),0),
 COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro262CapacityAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum(r."reservedSharedBytes") FROM public."Pro262CapacityReplay" r JOIN public."Pro262CapacityControlReservation" x ON x."controlKey"=r."controlKey" WHERE x."state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro262CapacityLaunchReservation" WHERE "state"='RESERVED'),0) INTO used_backend,used_shared;
 IF d."baselineBackend"+used_backend+backend>d."backendCapacity" OR d."baselineShared"+used_shared+shared>d."sharedCapacity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityLaunchReservation"("controlKey","kind","profileId","profileGeneration","profileHash","subject","reservedBackendBytes","reservedSharedBytes","state") VALUES(control_key,intent_kind,v_id,gen,v_hash,subj,backend,shared,'RESERVED'); RETURN 'CREATED';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_register_replay(replay_id TEXT,control_key TEXT,p_record JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; old_row public."Pro262CapacityReplay"%ROWTYPE;
        executor_pid INTEGER; executor_start TIMESTAMPTZ; expires TIMESTAMPTZ; supervisor_start TIMESTAMPTZ; binding_hash TEXT; global_row RECORD; d public."Pro262CapacityPhysicalDomain"%ROWTYPE; v_profile public."Pro262CapacityReplayProfile"%ROWTYPE; occupied_backend NUMERIC; occupied_shared NUMERIC; launch public."Pro262CapacityLaunchReservation"%ROWTYPE;
BEGIN
 IF replay_id IS NULL OR replay_id='' OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>9 OR NOT (p_record ?& ARRAY['context','executorPrincipal','executorPid','executorBackendStart','executorHost','executorBoot','executorProcessTree','replayProofIdentity','expiresAt']) OR
    pg_catalog.jsonb_typeof(p_record->'context') IS DISTINCT FROM 'object' OR COALESCE(p_record->>'executorPrincipal','')='' OR (p_record->>'executorPrincipal')::NAME::TEXT IS DISTINCT FROM p_record->>'executorPrincipal' OR pg_catalog.jsonb_typeof(p_record->'executorPid') IS DISTINCT FROM 'number' OR COALESCE(p_record->>'executorHost','')='' OR COALESCE(p_record->>'executorBoot','')='' OR COALESCE(p_record->>'executorProcessTree','')='' OR COALESCE(p_record->>'replayProofIdentity','')='' OR
    COALESCE(p_record->>'executorBackendStart','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR COALESCE(p_record->>'expiresAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 executor_pid:=(p_record->>'executorPid')::INTEGER;executor_start:=(p_record->>'executorBackendStart')::TIMESTAMPTZ;expires:=(p_record->>'expiresAt')::TIMESTAMPTZ;supervisor_start:=public.pro262_capacity_backend_start();
 IF executor_pid<=0 OR supervisor_start IS NULL OR expires<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<expires OR c."replayEnvelope" IS DISTINCT FROM p_record->>'replayProofIdentity' OR c."subject"->>'namespace' IS DISTINCT FROM p_record->'context'->>'namespace' OR c."subject"->>'project' IS DISTINCT FROM p_record->'context'->>'projectId' OR c."subject"->>'owner' IS DISTINCT FROM p_record->'context'->>'identityId' OR c."subject"->>'uid' IS DISTINCT FROM p_record->'context'->>'uid' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND NOT x."revoked" AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<expires OR public.pro262_capacity_backend_live((p_record->>'executorPrincipal')::NAME,executor_pid,executor_start) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF c."subject"->>'operation'='ENTA_SUCCESSOR' THEN
  IF public.int6_enta_identity(p_record->'context'->>'namespace',p_record->'context'->>'projectId',p_record->'context'->>'uid')->>'id' IS DISTINCT FROM c."subject"->>'owner' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 ELSE PERFORM public.eng03_06_context(p_record->'context'); END IF;
 PERFORM public.pro262_capacity_assert_observed_target(control_key,'REPLAY',(p_record->>'executorPrincipal')::NAME,executor_pid,executor_start);
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=control_key AND o."kind"='REPLAY' AND (o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')=(p_record->>'executorHost',p_record->>'executorBoot',p_record->>'executorProcessTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id;
 IF FOUND THEN
  IF old_row."controlKey" IS DISTINCT FROM control_key OR old_row."context" IS DISTINCT FROM p_record->'context' OR old_row."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR old_row."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR old_row."supervisorBackendStart" IS DISTINCT FROM supervisor_start OR old_row."executorPrincipal"::TEXT IS DISTINCT FROM p_record->>'executorPrincipal' OR old_row."executorPid" IS DISTINCT FROM executor_pid OR old_row."executorBackendStart" IS DISTINCT FROM executor_start OR old_row."executorHost" IS DISTINCT FROM p_record->>'executorHost' OR old_row."executorBoot" IS DISTINCT FROM p_record->>'executorBoot' OR old_row."executorProcessTree" IS DISTINCT FROM p_record->>'executorProcessTree' OR old_row."replayProofIdentity" IS DISTINCT FROM p_record->>'replayProofIdentity' OR old_row."expiresAt" IS DISTINCT FROM expires THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  PERFORM public.pro262_capacity_assert_launch_integrity();
  IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityLaunchReservation" l WHERE l."controlKey"=control_key AND l."kind"='REPLAY' AND l."state"='TRANSFERRED' AND l."targetId"=replay_id) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN replay_id;
 END IF;
 SELECT * INTO v_profile FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=p_record->>'replayProofIdentity' FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT v_profile."enabled" OR v_profile."validUntil"<expires OR v_profile."physicalIdentity" IS DISTINCT FROM global_row."physicalIdentity" OR v_profile."proofIdentity" IS DISTINCT FROM global_row."proofIdentity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO d FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=global_row."physicalIdentity" FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT d."enabled" OR d."proofIdentity" IS DISTINCT FROM v_profile."proofIdentity" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO launch FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=control_key AND x."kind"='REPLAY' FOR UPDATE NOWAIT;
 IF NOT FOUND OR launch."state"<>'RESERVED' OR launch."profileId" IS DISTINCT FROM v_profile."id" OR launch."profileHash" IS DISTINCT FROM v_profile."proofHash" OR launch."subject" IS DISTINCT FROM c."subject" OR launch."reservedBackendBytes" IS DISTINCT FROM v_profile."reservedBackendBytes" OR launch."reservedSharedBytes" IS DISTINCT FROM v_profile."reservedSharedBytes" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_launch_integrity();
 binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.replay.v1',replay_id,control_key,p_record)::TEXT,'UTF8'),'sha256'),'hex');
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='REPLAY_REGISTRATION' AND x."eventKey"=replay_id AND x."bindingHash"=binding_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observed_target(control_key,'REPLAY',(p_record->>'executorPrincipal')::NAME,executor_pid,executor_start);
 PERFORM public.pro262_capacity_bind_connection(control_key,'REPLAY',(p_record->>'executorPrincipal')::NAME,executor_pid,executor_start,p_record->>'executorHost',p_record->>'executorBoot',p_record->>'executorProcessTree');
 INSERT INTO public."Pro262CapacityReplay"("replayId","controlKey","operation","context","trustId","trustGeneration","supervisorPrincipal","supervisorPid","supervisorBackendStart","executorPrincipal","executorPid","executorBackendStart","executorHost","executorBoot","executorProcessTree","replayProofIdentity","reservedBackendBytes","reservedSharedBytes","expiresAt") VALUES(replay_id,control_key,c."subject"->>'operation',p_record->'context',t."trustId",t."generation",SESSION_USER::NAME,pg_catalog.pg_backend_pid(),supervisor_start,(p_record->>'executorPrincipal')::NAME,executor_pid,executor_start,p_record->>'executorHost',p_record->>'executorBoot',p_record->>'executorProcessTree',p_record->>'replayProofIdentity',v_profile."reservedBackendBytes",v_profile."reservedSharedBytes",expires);
 UPDATE public."Pro262CapacityLaunchReservation" x SET "state"='TRANSFERRED',"targetId"=replay_id WHERE x."controlKey"=control_key AND x."kind"='REPLAY';
 RETURN replay_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_register_issuance(issuance_key TEXT,v_request JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE;
        q public."Pro262CapacityQualification"%ROWTYPE; approval public."Pro262CapacityApproval"%ROWTYPE; receipt public."Pro262VerifiedSupplierReceipt"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; old_row public."Pro262CapacityIssuanceRequest"%ROWTYPE;
        v_generation BIGINT; backend_pid INTEGER; backend_start TIMESTAMPTZ; expires TIMESTAMPTZ; binding_hash TEXT;
BEGIN
 IF issuance_key IS NULL OR issuance_key='' OR pg_catalog.jsonb_typeof(v_request) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_request))<>14 OR
    NOT (v_request ?& ARRAY['qualificationId','qualificationGeneration','replayId','spoolDigest','subject','host','boot','processTree','backendPrincipal','backendPid','backendStart','parentEnvelope','producerClosure','expiresAt']) OR
    COALESCE(v_request->>'qualificationId','')='' OR (pg_catalog.jsonb_typeof(v_request->'qualificationGeneration') IS DISTINCT FROM 'string' OR COALESCE(v_request->>'qualificationGeneration','') !~ '^[1-9][0-9]*$') OR COALESCE(v_request->>'replayId','')='' OR COALESCE(v_request->>'spoolDigest','') !~ '^[a-f0-9]{64}$' OR
    pg_catalog.jsonb_typeof(v_request->'subject') IS DISTINCT FROM 'object' OR COALESCE(v_request->>'host','')='' OR COALESCE(v_request->>'boot','')='' OR COALESCE(v_request->>'processTree','')='' OR COALESCE(v_request->>'backendPrincipal','')='' OR (v_request->>'backendPrincipal')::NAME::TEXT IS DISTINCT FROM v_request->>'backendPrincipal' OR pg_catalog.jsonb_typeof(v_request->'backendPid') IS DISTINCT FROM 'number' OR COALESCE(v_request->>'parentEnvelope','')='' OR COALESCE(v_request->>'producerClosure','') !~ '^[a-f0-9]{64}$' OR
    COALESCE(v_request->>'backendStart','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR COALESCE(v_request->>'expiresAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_generation:=(v_request->>'qualificationGeneration')::BIGINT;backend_pid:=(v_request->>'backendPid')::INTEGER;backend_start:=(v_request->>'backendStart')::TIMESTAMPTZ;expires:=(v_request->>'expiresAt')::TIMESTAMPTZ;
 IF v_generation<=0 OR backend_pid<=0 OR expires<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=v_request->>'replayId' FOR SHARE NOWAIT;
 IF NOT FOUND OR r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() OR r."expiresAt"<expires THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=r."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<expires OR c."parentEnvelope" IS DISTINCT FROM v_request->>'parentEnvelope' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=r."trustId" AND x."generation"=r."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'SUPERVISOR' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<expires OR t."scope"->>'controlKey' IS DISTINCT FROM c."controlKey" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=r."replayId" AND x."spoolDigest"=v_request->>'spoolDigest';
 IF NOT FOUND OR m."subject" IS DISTINCT FROM v_request->'subject' OR m."principal" IS DISTINCT FROM r."executorPrincipal" OR m."pid" IS DISTINCT FROM r."executorPid" OR m."backendStart" IS DISTINCT FROM r."executorBackendStart" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO q FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=v_request->>'qualificationId' AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT q."enabled" OR q."validUntil"<expires OR q."sourceClosure" IS DISTINCT FROM v_request->>'producerClosure' OR q."proof"->>'namespace' IS DISTINCT FROM m."subject"->>'namespace' OR q."proof"->>'project' IS DISTINCT FROM m."subject"->>'project' OR NOT public.pro262_capacity_validate_proof(q."proof") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO approval FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=q."approvalId" FOR SHARE NOWAIT;
 IF NOT FOUND OR approval."validFrom">pg_catalog.clock_timestamp() OR approval."validUntil"<expires THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO receipt FROM public."Pro262VerifiedSupplierReceipt" x WHERE x."supplierId"=approval."supplierId" AND x."receiptId"=approval."receiptId";
 IF NOT FOUND OR receipt."subject" IS DISTINCT FROM m."subject" OR approval."evidenceHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(receipt."evidence",'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF public.pro262_capacity_backend_live((v_request->>'backendPrincipal')::NAME,backend_pid,backend_start) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observed_target(c."controlKey",'PRODUCER',(v_request->>'backendPrincipal')::NAME,backend_pid,backend_start);
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=c."controlKey" AND o."kind"='PRODUCER' AND (o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')=(v_request->>'host',v_request->>'boot',v_request->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=issuance_key;
 IF FOUND THEN
  IF old_row."request" IS DISTINCT FROM v_request OR old_row."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN issuance_key;
 END IF;
 binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.issuance.v1',issuance_key,v_request)::TEXT,'UTF8'),'sha256'),'hex');
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='ISSUANCE_REQUEST' AND x."eventKey"=issuance_key AND x."bindingHash"=binding_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observed_target(c."controlKey",'PRODUCER',(v_request->>'backendPrincipal')::NAME,backend_pid,backend_start);
 PERFORM public.pro262_capacity_bind_connection(c."controlKey",'PRODUCER',(v_request->>'backendPrincipal')::NAME,backend_pid,backend_start,v_request->>'host',v_request->>'boot',v_request->>'processTree');
 INSERT INTO public."Pro262CapacityIssuanceRequest"("issuanceKey","qualificationId","qualificationGeneration","replayId","spoolDigest","request","supervisorPrincipal","host","boot","processTree","backendPrincipal","backendPid","backendStart","parentEnvelope","producerClosure","expiresAt") VALUES(issuance_key,q."qualificationId",q."generation",r."replayId",m."spoolDigest",v_request,SESSION_USER::NAME,v_request->>'host',v_request->>'boot',v_request->>'processTree',(v_request->>'backendPrincipal')::NAME,backend_pid,backend_start,v_request->>'parentEnvelope',v_request->>'producerClosure',expires);
 RETURN issuance_key;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- The physical domain is externally qualified, starts absent, and cannot be created by
-- issuer/worker. Its baseline includes all other permitted work and replay/parent envelopes.
CREATE FUNCTION public.pro262_capacity_physical_domain_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (pg_catalog.to_jsonb(NEW)-'nextFence'-'enabled') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'nextFence'-'enabled') OR
    NEW."nextFence"<OLD."nextFence" OR (NOT OLD."enabled" AND NEW."enabled") OR
    (NEW."nextFence"=OLD."nextFence" AND NEW."enabled"=OLD."enabled") THEN RAISE EXCEPTION 'CAPACITY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityPhysicalDomain_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityPhysicalDomain" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_physical_domain_guard();
CREATE FUNCTION public.pro262_capacity_issue(issuance_key TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE global_row RECORD; domain_row public."Pro262CapacityPhysicalDomain"%ROWTYPE;
        i public."Pro262CapacityIssuanceRequest"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE; a public."Pro262CapacityApproval"%ROWTYPE; v_issuer public."Pro262CapacityTrust"%ROWTYPE;
        m public."Pro262CapacityReplayMiss"%ROWTYPE; receipt public."Pro262VerifiedSupplierReceipt"%ROWTYPE; replay public."Pro262CapacityReplay"%ROWTYPE; replay_profile public."Pro262CapacityReplayProfile"%ROWTYPE; control public."Pro262CapacityControlReservation"%ROWTYPE; previous public."Pro262CapacityAdmission"%ROWTYPE;
        launch public."Pro262CapacityLaunchReservation"%ROWTYPE; needed_backend NUMERIC; needed_shared NUMERIC; occupied_backend NUMERIC; occupied_shared NUMERIC; admission_id TEXT; next_fence BIGINT;
BEGIN
 IF issuance_key IS NULL OR issuance_key='' OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=issuance_key FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT v_issuer FROM public."Pro262CapacityTrust" x WHERE x."purpose"='OPERATION_ISSUER' AND x."supplierPrincipal"=SESSION_USER::NAME AND x."scope"->>'physicalIdentity'=global_row."physicalIdentity" FOR SHARE NOWAIT;
 IF v_issuer."revoked" OR v_issuer."validFrom">pg_catalog.clock_timestamp() OR v_issuer."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO previous FROM public."Pro262CapacityAdmission" x WHERE x."issuanceKey"=issuance_key;
 IF FOUND THEN
  PERFORM public.pro262_capacity_assert_launch_integrity();
  IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r JOIN public."Pro262CapacityLaunchReservation" l ON l."controlKey"=r."controlKey" AND l."kind"='PRODUCER' WHERE r."replayId"=i."replayId" AND l."state"='TRANSFERRED' AND l."targetId"=previous."admissionId" AND l."targetFence"=previous."fence") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN previous."admissionId";
 END IF;
 SELECT * INTO replay FROM public."Pro262CapacityReplay" x WHERE x."replayId"=i."replayId";
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO control FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=replay."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR control."state"<>'RESERVED' OR control."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO q FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=i."qualificationId" AND x."generation"=i."qualificationGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT q."enabled" OR q."validUntil"<i."expiresAt" OR i."expiresAt"<=pg_catalog.clock_timestamp() OR q."domain" IS DISTINCT FROM global_row."physicalIdentity" OR NOT public.pro262_capacity_validate_proof(q."proof") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO replay_profile FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=replay."replayProofIdentity" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT replay_profile."enabled" OR replay_profile."validUntil"<=pg_catalog.clock_timestamp() OR q."proof"->'overlapSchedule'->>'replayProfileId' IS DISTINCT FROM replay_profile."id" OR q."proof"->'overlapSchedule'->>'replayProofHash' IS DISTINCT FROM replay_profile."proofHash" OR q."proof"->'overlapSchedule'->>'operationAccounting' IS DISTINCT FROM 'INCREMENTAL_AFTER_REPLAY' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO a FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=q."approvalId" FOR SHARE NOWAIT;
 IF NOT FOUND OR a."validFrom">pg_catalog.clock_timestamp() OR a."validUntil"<i."expiresAt" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=i."replayId" AND x."spoolDigest"=i."spoolDigest";
 IF NOT FOUND OR m."subject" IS DISTINCT FROM i."request"->'subject' OR q."sourceClosure" IS DISTINCT FROM i."producerClosure" OR public.pro262_capacity_backend_live(i."backendPrincipal",i."backendPid",i."backendStart") IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO receipt FROM public."Pro262VerifiedSupplierReceipt" x WHERE x."supplierId"=a."supplierId" AND x."receiptId"=a."receiptId";
 IF NOT FOUND OR receipt."subject" IS DISTINCT FROM m."subject" OR a."evidenceHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(receipt."evidence",'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO domain_row FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=global_row."physicalIdentity" FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT domain_row."enabled" OR domain_row."proofIdentity" IS DISTINCT FROM q."proof"->'physicalDomain'->>'proofIdentity' OR domain_row."nextFence"=9223372036854775807 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 needed_backend:=(q."proof"->'qualifiedLimits'->>'backendBytes')::NUMERIC; needed_shared:=(q."proof"->'qualifiedLimits'->>'sharedBytes')::NUMERIC;
 SELECT * INTO launch FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=control."controlKey" AND x."kind"='PRODUCER' FOR UPDATE NOWAIT;
 IF NOT FOUND OR launch."state"<>'RESERVED' OR launch."profileId" IS DISTINCT FROM q."qualificationId" OR launch."profileGeneration" IS DISTINCT FROM q."generation" OR launch."profileHash" IS DISTINCT FROM q."proofHash" OR launch."subject" IS DISTINCT FROM m."subject" OR launch."reservedBackendBytes" IS DISTINCT FROM needed_backend OR launch."reservedSharedBytes" IS DISTINCT FROM needed_shared THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_launch_integrity();
 PERFORM public.pro262_capacity_precharge(issuance_key);
 next_fence:=domain_row."nextFence"+1;
 admission_id:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.admission.v1',issuance_key)::TEXT,'UTF8'),'sha256'),'hex');
 UPDATE public."Pro262CapacityPhysicalDomain" x SET "nextFence"=next_fence WHERE x."physicalIdentity"=domain_row."physicalIdentity";
 INSERT INTO public."Pro262CapacityAdmission"("admissionId","fence","issuanceKey","qualificationId","qualificationGeneration","approvalId","reuse","subject","principal","pid","backendStart","host","boot","processTree","expiresAt","reservedBackendBytes","reservedSharedBytes","state") VALUES(admission_id,next_fence,issuance_key,q."qualificationId",q."generation",a."approvalId",a."reuse",m."subject",i."backendPrincipal",i."backendPid",i."backendStart",i."host",i."boot",i."processTree",i."expiresAt",needed_backend,needed_shared,'RESERVED');
 UPDATE public."Pro262CapacityLaunchReservation" x SET "state"='TRANSFERRED',"targetId"=admission_id,"targetFence"=next_fence WHERE x."controlKey"=control."controlKey" AND x."kind"='PRODUCER';
 RETURN admission_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

-- Future archive admissions must see occupied PRO262 work as well. These triggers sort
-- after the accepted AAB global-lock trigger and acquire their own NOWAIT check defensively.
-- No accepted historical migration or existing trigger/function body is replaced.
CREATE FUNCTION public.pro262_capacity_archive_gate() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE global_row RECORD; d public."Pro262CapacityPhysicalDomain"%ROWTYPE; used_backend NUMERIC; used_shared NUMERIC;
BEGIN
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 SELECT * INTO d FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=global_row."physicalIdentity" FOR UPDATE NOWAIT;
 IF NOT FOUND THEN
  IF EXISTS(SELECT 1 FROM public."Pro262CapacityAdmission" a WHERE a."state"<>'RELEASED') OR EXISTS(SELECT 1 FROM public."Pro262CapacityLaunchReservation" l WHERE l."state"='RESERVED') OR EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r JOIN public."Pro262CapacityControlReservation" c ON c."controlKey"=r."controlKey" WHERE c."state"<>'RELEASED') THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
  RETURN NEW;
 END IF;
 IF d."proofIdentity" IS DISTINCT FROM global_row."proofIdentity" OR NEW."reservedBackendBytes" IS NULL OR NEW."reservedSharedBytes" IS NULL OR NEW."reservedBackendBytes"<0 OR NEW."reservedSharedBytes"<0 THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 PERFORM public.pro262_capacity_assert_launch_integrity();
 SELECT COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro262CapacityAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum(rp."reservedBackendBytes") FROM public."Pro262CapacityReplay" rp JOIN public."Pro262CapacityControlReservation" cr ON cr."controlKey"=rp."controlKey" WHERE cr."state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro262CapacityLaunchReservation" WHERE "state"='RESERVED'),0),
        COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro262CapacityAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum(rp."reservedSharedBytes") FROM public."Pro262CapacityReplay" rp JOIN public."Pro262CapacityControlReservation" cr ON cr."controlKey"=rp."controlKey" WHERE cr."state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro262CapacityLaunchReservation" WHERE "state"='RESERVED'),0)
 INTO used_backend,used_shared;
 IF d."baselineBackend"+used_backend+NEW."reservedBackendBytes">d."backendCapacity" OR d."baselineShared"+used_shared+NEW."reservedSharedBytes">d."sharedCapacity" THEN RAISE EXCEPTION 'DEFERRED_RESOURCE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AAC_pro262_capacity_archive_gate" BEFORE INSERT ON public."Pro311NativeAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_archive_gate();
CREATE TRIGGER "AAC_pro262_capacity_archive_gate" BEFORE INSERT ON public."Pro311PreflightAdmission" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_archive_gate();
CREATE TABLE public."Pro262CapacityBootstrapPhysical" (
 "physicalIdentity" TEXT PRIMARY KEY, "publisherPrincipal" NAME NOT NULL, "recordHash" TEXT NOT NULL CHECK ("recordHash" ~ '^[a-f0-9]{64}$'), "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "validUntil" TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER "Pro262CapacityBootstrapPhysical_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityBootstrapPhysical" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_physical_provision(p_record JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_boot public."Pro262CapacityBootstrapPhysical"%ROWTYPE; global_row RECORD; old_row public."Pro262CapacityPhysicalDomain"%ROWTYPE;
        record_hash TEXT; field TEXT; n NUMERIC; backend_capacity NUMERIC; shared_capacity NUMERIC; baseline_backend NUMERIC; baseline_shared NUMERIC; used_backend NUMERIC; used_shared NUMERIC;
BEGIN
 IF pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>7 OR NOT (p_record ?& ARRAY['physicalIdentity','proofIdentity','evidenceHash','backendCapacity','sharedCapacity','baselineBackend','baselineShared']) OR COALESCE(p_record->>'physicalIdentity','')='' OR COALESCE(p_record->>'proofIdentity','')='' OR COALESCE(p_record->>'evidenceHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 FOREACH field IN ARRAY ARRAY['backendCapacity','sharedCapacity','baselineBackend','baselineShared'] LOOP
  IF pg_catalog.jsonb_typeof(p_record->field) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  n:=(p_record->>field)::NUMERIC; IF n<0 OR n::TEXT IN ('NaN','Infinity','-Infinity') OR n<>pg_catalog.trunc(n) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 END LOOP;
 backend_capacity:=(p_record->>'backendCapacity')::NUMERIC;shared_capacity:=(p_record->>'sharedCapacity')::NUMERIC;baseline_backend:=(p_record->>'baselineBackend')::NUMERIC;baseline_shared:=(p_record->>'baselineShared')::NUMERIC;
 IF backend_capacity<=0 OR shared_capacity<=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 record_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND OR global_row."physicalIdentity" IS DISTINCT FROM p_record->>'physicalIdentity' OR global_row."proofIdentity" IS DISTINCT FROM p_record->>'proofIdentity' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO v_boot FROM public."Pro262CapacityBootstrapPhysical" x WHERE x."physicalIdentity"=p_record->>'physicalIdentity' FOR SHARE NOWAIT;
 IF NOT FOUND OR v_boot."publisherPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_boot."recordHash" IS DISTINCT FROM record_hash OR v_boot."evidenceHash" IS DISTINCT FROM p_record->>'evidenceHash' OR v_boot."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=p_record->>'physicalIdentity';
 IF FOUND THEN
  IF old_row."proofIdentity" IS DISTINCT FROM p_record->>'proofIdentity' OR old_row."evidenceHash" IS DISTINCT FROM p_record->>'evidenceHash' OR old_row."backendCapacity" IS DISTINCT FROM backend_capacity OR old_row."sharedCapacity" IS DISTINCT FROM shared_capacity OR old_row."baselineBackend" IS DISTINCT FROM baseline_backend OR old_row."baselineShared" IS DISTINCT FROM baseline_shared THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN old_row."physicalIdentity";
 END IF;
 SELECT COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedBackendBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0),COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311NativeAdmission" WHERE "state"<>'RELEASED'),0)+COALESCE((SELECT pg_catalog.sum("reservedSharedBytes") FROM public."Pro311PreflightAdmission" WHERE "state"<>'RELEASED'),0) INTO used_backend,used_shared;
 IF baseline_backend+used_backend>backend_capacity OR baseline_shared+used_shared>shared_capacity OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='PHYSICAL_DOMAIN' AND x."eventKey"=p_record->>'physicalIdentity' AND x."bindingHash"=record_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityPhysicalDomain"("physicalIdentity","proofIdentity","evidenceHash","backendCapacity","sharedCapacity","baselineBackend","baselineShared","enabled") VALUES(p_record->>'physicalIdentity',p_record->>'proofIdentity',p_record->>'evidenceHash',backend_capacity,shared_capacity,baseline_backend,baseline_shared,TRUE);
 RETURN p_record->>'physicalIdentity';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE TABLE public."Pro262CapacityBootstrapBaseline" (
 "kind" TEXT PRIMARY KEY, "publisherPrincipal" NAME NOT NULL, "recordHash" TEXT NOT NULL CHECK ("recordHash" ~ '^[a-f0-9]{64}$'), "evidenceHash" TEXT NOT NULL CHECK ("evidenceHash" ~ '^[a-f0-9]{64}$'), "validUntil" TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER "Pro262CapacityBootstrapBaseline_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityBootstrapBaseline" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
-- Permanently allocated observer input slots are a partition of the already-counted
-- physical baseline; claiming/capturing never releases, replenishes or reuses a slot.
CREATE TABLE public."Pro262CapacityObserverInputReservation" (
 "reservationId" TEXT PRIMARY KEY, "physicalIdentity" TEXT NOT NULL, "physicalProofIdentity" TEXT NOT NULL,
 "baselineAllocationProof" TEXT NOT NULL, "observerPrincipalOid" OID NOT NULL, "observerPrincipalName" NAME NOT NULL,
 "observerTrustId" TEXT NOT NULL, "observerTrustGeneration" BIGINT NOT NULL, "phase" TEXT NOT NULL,
 "maxInputBytes" NUMERIC NOT NULL, "backendBytes" NUMERIC NOT NULL, "sharedBytes" NUMERIC NOT NULL,
 "otherBaselineBackend" NUMERIC NOT NULL, "otherBaselineShared" NUMERIC NOT NULL, "concurrencySlot" TEXT NOT NULL,
 "record" JSONB NOT NULL, "recordHash" TEXT NOT NULL, "prepaidEventKey" TEXT NOT NULL,
 FOREIGN KEY ("observerTrustId","observerTrustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT,
 UNIQUE ("physicalIdentity","concurrencySlot"), CHECK ("maxInputBytes">0 AND "backendBytes">0 AND "sharedBytes">0 AND "otherBaselineBackend">=0 AND "otherBaselineShared">=0)
);
CREATE TRIGGER "Pro262CapacityObserverInputReservation_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityObserverInputReservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE TABLE public."Pro262CapacityObserverInputClaim" (
 "inputClaimId" TEXT PRIMARY KEY, "reservationId" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityObserverInputReservation"("reservationId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "eventKey" TEXT NOT NULL UNIQUE, "phase" TEXT NOT NULL, "observerPrincipalOid" OID NOT NULL, "observerPrincipalName" NAME NOT NULL,
 "claimedAt" TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TRIGGER "Pro262CapacityObserverInputClaim_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityObserverInputClaim" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_provision_observer_input(p_record JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_boot public."Pro262CapacityBootstrapBaseline"%ROWTYPE; v_domain public."Pro262CapacityPhysicalDomain"%ROWTYPE; v_prior public."Pro262CapacityObserverInputReservation"%ROWTYPE; v_trust public."Pro262CapacityTrust"%ROWTYPE; v_global RECORD; v_hash TEXT; v_key TEXT; v_field TEXT; v_amount NUMERIC; v_other_backend NUMERIC; v_other_shared NUMERIC; v_backend NUMERIC; v_shared NUMERIC; v_max NUMERIC; v_oid OID;
BEGIN
 IF pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>35 OR NOT (p_record ?& ARRAY['reservationId','physicalIdentity','physicalProofIdentity','baselineAllocationProof','observerPrincipalOid','observerPrincipalName','observerTrustId','observerTrustGeneration','observerSourceClosure','observerExecutableIdentity','observerHost','observerBoot','observerProcessTree','observerCredentialEpoch','observerLaunchEpoch','phase','maxInputBytes','backendBytes','sharedBytes','parentBytes','driverBytes','serializationBytes','sqlParserBytes','concurrencySlot','prepaidEventKey','prepaidStorageIdentity','otherBaselineBackend','otherBaselineShared','observerBackendPid','observerBackendStart','targetControlKey','targetKind','targetCredentialEpoch','targetLaunchEpoch','expectedEventKey']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_key:=p_record->>'reservationId';v_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 IF COALESCE(v_key,'')='' OR COALESCE(p_record->>'targetControlKey','')='' OR COALESCE(p_record->>'targetKind','') NOT IN ('REPLAY','PRODUCER') OR COALESCE(p_record->>'targetCredentialEpoch','')='' OR COALESCE(p_record->>'targetLaunchEpoch','')='' OR COALESCE(p_record->>'expectedEventKey','')='' OR COALESCE(p_record->>'concurrencySlot','')='' OR COALESCE(p_record->>'prepaidEventKey','')='' OR COALESCE(p_record->>'prepaidStorageIdentity','')='' OR COALESCE(p_record->>'observerSourceClosure','') !~ '^[a-f0-9]{64}$' OR COALESCE(p_record->>'observerExecutableIdentity','')='' OR COALESCE(p_record->>'observerHost','')='' OR COALESCE(p_record->>'observerBoot','')='' OR COALESCE(p_record->>'observerProcessTree','')='' OR COALESCE(p_record->>'observerBackendStart','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR (p_record->>'observerBackendPid')::NUMERIC<=0 OR (p_record->>'observerBackendPid')::NUMERIC>2147483647 OR COALESCE(p_record->>'observerCredentialEpoch','')='' OR COALESCE(p_record->>'observerLaunchEpoch','')='' OR COALESCE(p_record->>'phase','') NOT IN ('INSTALL_PROCESS','OPERATION_CLEANUP','REPLAY_CLEANUP','CONTROL_CLEANUP','CONNECTION_OBSERVATION','CLOSED_SCOPE') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 FOREACH v_field IN ARRAY ARRAY['observerPrincipalOid','observerTrustGeneration','observerBackendPid','maxInputBytes','backendBytes','sharedBytes','parentBytes','driverBytes','serializationBytes','sqlParserBytes','otherBaselineBackend','otherBaselineShared'] LOOP
  IF pg_catalog.jsonb_typeof(p_record->v_field) IS DISTINCT FROM 'string' OR COALESCE(p_record->>v_field,'') !~ '^(0|[1-9][0-9]{0,18})$' OR (p_record->>v_field)::NUMERIC>9223372036854775807 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 END LOOP;
 v_oid:=(p_record->>'observerPrincipalOid')::OID;v_backend:=(p_record->>'backendBytes')::NUMERIC;v_shared:=(p_record->>'sharedBytes')::NUMERIC;v_max:=(p_record->>'maxInputBytes')::NUMERIC;v_other_backend:=(p_record->>'otherBaselineBackend')::NUMERIC;v_other_shared:=(p_record->>'otherBaselineShared')::NUMERIC;
 IF v_oid=0 OR v_backend<=0 OR v_shared<=0 OR v_max<=0 OR COALESCE(p_record->>'observerPrincipalName','')='' OR (p_record->>'observerPrincipalName')::NAME::TEXT IS DISTINCT FROM p_record->>'observerPrincipalName' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity" INTO v_global FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 SELECT * INTO STRICT v_domain FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=v_global."physicalIdentity" FOR UPDATE NOWAIT;
 SELECT * INTO STRICT v_boot FROM public."Pro262CapacityBootstrapBaseline" x WHERE x."kind"='OBSERVER_INPUT:'||v_key FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=p_record->>'observerTrustId' AND x."generation"=(p_record->>'observerTrustGeneration')::BIGINT FOR SHARE NOWAIT;
 IF NOT v_domain."enabled" OR v_boot."publisherPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_boot."recordHash" IS DISTINCT FROM v_hash OR v_boot."evidenceHash" IS DISTINCT FROM p_record->>'baselineAllocationProof' OR v_boot."validUntil"<=pg_catalog.clock_timestamp() OR v_domain."proofIdentity" IS DISTINCT FROM p_record->>'physicalProofIdentity' OR v_domain."physicalIdentity" IS DISTINCT FROM p_record->>'physicalIdentity' OR v_trust."supplierPrincipal"::TEXT IS DISTINCT FROM p_record->>'observerPrincipalName' OR v_trust."purpose" NOT IN ('CLEANUP_OBSERVATION','INSTALL_OBSERVATION') OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_oid AND r.rolname=v_trust."supplierPrincipal" AND r.rolcanlogin AND NOT r.rolsuper) OR (p_record->>'phase'='INSTALL_PROCESS') IS DISTINCT FROM (v_trust."purpose"='INSTALL_OBSERVATION') OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" z JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=z."kind" WHERE z."kind"='OBSERVER_INPUT_SLOT' AND z."eventKey"=p_record->>'prepaidEventKey' AND z."bindingHash"=v_hash AND b."physicalIdentity"=v_domain."physicalIdentity" AND b."controlProofIdentity"=p_record->>'prepaidStorageIdentity' AND b."controlProofIdentity"=v_global."proofIdentity" AND b."enabled") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_trust."revoked" OR v_trust."validFrom">pg_catalog.clock_timestamp() OR v_trust."validUntil"<=pg_catalog.clock_timestamp() OR (v_trust."purpose"='CLEANUP_OBSERVATION' AND (v_trust."scope"->>'inputEnvelope' IS DISTINCT FROM p_record->>'baselineAllocationProof' OR v_max>(v_trust."scope"->>'inputBound')::NUMERIC)) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO v_prior FROM public."Pro262CapacityObserverInputReservation" x WHERE x."reservationId"=v_key;
 IF FOUND THEN IF v_prior."record" IS DISTINCT FROM p_record OR v_prior."recordHash" IS DISTINCT FROM v_hash THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN v_key; END IF;
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputReservation" x WHERE x."physicalIdentity"=v_domain."physicalIdentity" AND (x."physicalProofIdentity" IS DISTINCT FROM v_domain."proofIdentity" OR x."otherBaselineBackend" IS DISTINCT FROM v_other_backend OR x."otherBaselineShared" IS DISTINCT FROM v_other_shared)) OR v_other_backend+v_backend+COALESCE((SELECT pg_catalog.sum(x."backendBytes") FROM public."Pro262CapacityObserverInputReservation" x WHERE x."physicalIdentity"=v_domain."physicalIdentity"),0)>v_domain."baselineBackend" OR v_other_shared+v_shared+COALESCE((SELECT pg_catalog.sum(x."sharedBytes") FROM public."Pro262CapacityObserverInputReservation" x WHERE x."physicalIdentity"=v_domain."physicalIdentity"),0)>v_domain."baselineShared" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityObserverInputReservation" VALUES(v_key,v_domain."physicalIdentity",v_domain."proofIdentity",p_record->>'baselineAllocationProof',v_oid,v_trust."supplierPrincipal",v_trust."trustId",v_trust."generation",p_record->>'phase',v_max,v_backend,v_shared,v_other_backend,v_other_shared,p_record->>'concurrencySlot',p_record,v_hash,p_record->>'prepaidEventKey'); RETURN v_key;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_claim_observer_input(p_reservation_id TEXT,p_event_key TEXT,p_phase TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_slot public."Pro262CapacityObserverInputReservation"%ROWTYPE; v_prior public."Pro262CapacityObserverInputClaim"%ROWTYPE; v_allocator public."Pro262CapacityTrust"%ROWTYPE; v_observer_trust public."Pro262CapacityTrust"%ROWTYPE; v_claim TEXT;
BEGIN
 SELECT * INTO STRICT v_allocator FROM public."Pro262CapacityTrust" t WHERE t."purpose"='CONTROL_ALLOCATOR' AND t."supplierPrincipal"=SESSION_USER::NAME AND t."scope"->>'kind'='OBSERVER_INPUT_CLAIM' FOR SHARE NOWAIT;
 IF v_allocator."revoked" OR v_allocator."validFrom">pg_catalog.clock_timestamp() OR v_allocator."validUntil"<=pg_catalog.clock_timestamp() OR COALESCE(p_event_key,'')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT v_slot FROM public."Pro262CapacityObserverInputReservation" x WHERE x."reservationId"=p_reservation_id FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_observer_trust FROM public."Pro262CapacityTrust" t WHERE (t."trustId",t."generation")=(v_slot."observerTrustId",v_slot."observerTrustGeneration") FOR SHARE NOWAIT;
 IF v_observer_trust."revoked" OR v_observer_trust."validFrom">pg_catalog.clock_timestamp() OR v_observer_trust."validUntil"<=pg_catalog.clock_timestamp() OR NOT ((v_slot."phase"='INSTALL_PROCESS' AND v_observer_trust."purpose"='INSTALL_OBSERVATION' AND v_observer_trust."scope"->>'observerHolderId'=v_slot."baselineAllocationProof") OR (v_slot."phase"<>'INSTALL_PROCESS' AND v_observer_trust."purpose"='CLEANUP_OBSERVATION' AND v_observer_trust."scope"->>'inputEnvelope'=v_slot."baselineAllocationProof" AND v_slot."maxInputBytes"<=(v_observer_trust."scope"->>'inputBound')::NUMERIC)) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_slot."phase" IS DISTINCT FROM p_phase OR v_slot."record"->>'expectedEventKey' IS DISTINCT FROM p_event_key OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=v_slot."record"->>'targetControlKey' AND l."kind"=v_slot."record"->>'targetKind' AND l."credentialEpoch"=v_slot."record"->>'targetCredentialEpoch' AND l."launchEpoch"=v_slot."record"->>'targetLaunchEpoch' AND l."state" IN ('ACTIVE','SEALED')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_claim:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.observer-input.v1',p_reservation_id,p_event_key,p_phase)::TEXT,'UTF8'),'sha256'),'hex');
 SELECT * INTO v_prior FROM public."Pro262CapacityObserverInputClaim" x WHERE x."reservationId"=p_reservation_id;
 IF FOUND THEN IF v_prior."inputClaimId" IS DISTINCT FROM v_claim OR v_prior."eventKey" IS DISTINCT FROM p_event_key OR v_prior."phase" IS DISTINCT FROM p_phase THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN pg_catalog.jsonb_build_object('status','EXISTING','inputClaimId',v_claim,'maxInputBytes',v_slot."maxInputBytes"::TEXT); END IF;
 INSERT INTO public."Pro262CapacityObserverInputClaim"("inputClaimId","reservationId","eventKey","phase","observerPrincipalOid","observerPrincipalName") VALUES(v_claim,p_reservation_id,p_event_key,p_phase,v_slot."observerPrincipalOid",v_slot."observerPrincipalName");
 RETURN pg_catalog.jsonb_build_object('status','CREATED','inputClaimId',v_claim,'maxInputBytes',v_slot."maxInputBytes"::TEXT);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
-- Called only by specific authenticated publishers; a claim is not a capability
-- to choose quantities, create trust, capture another event or reuse a slot.
CREATE FUNCTION public.pro262_capacity_assert_observer_claim(p_claim_id TEXT,p_phase TEXT,p_event_key TEXT,p_payload_bytes NUMERIC) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_claim public."Pro262CapacityObserverInputClaim"%ROWTYPE; v_slot public."Pro262CapacityObserverInputReservation"%ROWTYPE; v_trust public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v_claim FROM public."Pro262CapacityObserverInputClaim" x WHERE x."inputClaimId"=p_claim_id;
 SELECT * INTO STRICT v_slot FROM public."Pro262CapacityObserverInputReservation" x WHERE x."reservationId"=v_claim."reservationId" FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_slot."observerTrustId" AND x."generation"=v_slot."observerTrustGeneration" FOR SHARE NOWAIT;
 IF v_claim."phase" IS DISTINCT FROM p_phase OR v_slot."phase" IS DISTINCT FROM p_phase OR v_claim."eventKey" IS DISTINCT FROM p_event_key OR v_slot."record"->>'expectedEventKey' IS DISTINCT FROM p_event_key OR v_slot."observerPrincipalName" IS DISTINCT FROM SESSION_USER::NAME OR v_claim."observerPrincipalName" IS DISTINCT FROM SESSION_USER::NAME OR v_claim."observerPrincipalOid" IS DISTINCT FROM v_slot."observerPrincipalOid" OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_slot."observerPrincipalOid" AND r.rolname=SESSION_USER::NAME AND r.rolcanlogin AND NOT r.rolsuper) OR (v_slot."record"->>'observerBackendPid')::INTEGER IS DISTINCT FROM pg_catalog.pg_backend_pid() OR (v_slot."record"->>'observerBackendStart')::TIMESTAMPTZ IS DISTINCT FROM public.pro262_capacity_backend_start() OR v_trust."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_trust."revoked" OR v_trust."validFrom">pg_catalog.clock_timestamp() OR v_trust."validUntil"<=pg_catalog.clock_timestamp() OR (p_phase='INSTALL_PROCESS' AND (v_trust."purpose"<>'INSTALL_OBSERVATION' OR v_trust."scope"->>'observerHolderId' IS DISTINCT FROM v_slot."baselineAllocationProof")) OR (p_phase<>'INSTALL_PROCESS' AND (v_trust."purpose"<>'CLEANUP_OBSERVATION' OR v_trust."scope"->>'inputEnvelope' IS DISTINCT FROM v_slot."baselineAllocationProof" OR v_slot."maxInputBytes">(v_trust."scope"->>'inputBound')::NUMERIC)) OR p_payload_bytes IS NULL OR p_payload_bytes<0 OR p_payload_bytes>v_slot."maxInputBytes" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
-- Bootstrap record publication itself must be included in the genuinely qualified
-- initial baseline. The exact proof and operator are absent until external qualification.
CREATE FUNCTION public.pro262_capacity_control_provision(p_record JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_boot public."Pro262CapacityBootstrapBaseline"%ROWTYPE; global_row RECORD; existing public."Pro262CapacityControlBaseline"%ROWTYPE;
        key TEXT; record_hash TEXT; v_allocated NUMERIC; archive_used NUMERIC; worst NUMERIC; allocated_total NUMERIC;
BEGIN
 IF pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>9 OR NOT (p_record ?& ARRAY['kind','physicalIdentity','controlProofIdentity','coverageEvidenceHash','archiveBaselineUsed','allocated','eventWorstCase','coverageContract','maxClosedScopeBytes']) OR COALESCE(p_record->>'kind','')='' OR COALESCE(p_record->>'physicalIdentity','')='' OR COALESCE(p_record->>'controlProofIdentity','')='' OR COALESCE(p_record->>'coverageEvidenceHash','') !~ '^[a-f0-9]{64}$' OR pg_catalog.jsonb_typeof(p_record->'archiveBaselineUsed') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(p_record->'allocated') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(p_record->'eventWorstCase') IS DISTINCT FROM 'number' OR pg_catalog.jsonb_typeof(p_record->'maxClosedScopeBytes') IS DISTINCT FROM 'number' OR COALESCE(p_record->>'coverageContract','')='' OR (p_record->>'maxClosedScopeBytes')::NUMERIC<=0 OR (p_record->>'maxClosedScopeBytes')::NUMERIC<>pg_catalog.trunc((p_record->>'maxClosedScopeBytes')::NUMERIC) OR (p_record->>'maxClosedScopeBytes') IN ('NaN','Infinity','-Infinity') OR (p_record->>'kind'='CONTROL_RESERVATION' AND p_record->>'coverageContract'<>'principal-launch-and-closed-scope-v2') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 key:=p_record->>'kind';archive_used:=(p_record->>'archiveBaselineUsed')::NUMERIC;v_allocated:=(p_record->>'allocated')::NUMERIC;worst:=(p_record->>'eventWorstCase')::NUMERIC;
 IF archive_used<0 OR archive_used<>pg_catalog.trunc(archive_used) OR archive_used::TEXT IN ('NaN','Infinity','-Infinity') OR v_allocated<=0 OR worst<=0 OR v_allocated<>pg_catalog.trunc(v_allocated) OR worst<>pg_catalog.trunc(worst) OR v_allocated::TEXT IN ('NaN','Infinity','-Infinity') OR worst::TEXT IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 record_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 LOCK TABLE public."Pro311ControlDomain" IN ACCESS SHARE MODE NOWAIT;
 SELECT x."physicalIdentity",x."proofIdentity",x."capacity",x."committed",x."baseline" INTO global_row FROM public."Pro311ControlDomain" x WHERE x."id"='global-v1' FOR UPDATE NOWAIT;
 IF NOT FOUND OR global_row."physicalIdentity" IS DISTINCT FROM p_record->>'physicalIdentity' OR global_row."proofIdentity" IS DISTINCT FROM p_record->>'controlProofIdentity' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO v_boot FROM public."Pro262CapacityBootstrapBaseline" x WHERE x."kind"=key FOR SHARE NOWAIT;
 IF NOT FOUND OR v_boot."publisherPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_boot."recordHash" IS DISTINCT FROM record_hash OR v_boot."evidenceHash" IS DISTINCT FROM p_record->>'coverageEvidenceHash' OR v_boot."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO existing FROM public."Pro262CapacityControlBaseline" x WHERE x."kind"=key;
 IF FOUND THEN
  IF existing."physicalIdentity" IS DISTINCT FROM p_record->>'physicalIdentity' OR existing."controlProofIdentity" IS DISTINCT FROM p_record->>'controlProofIdentity' OR existing."coverageEvidenceHash" IS DISTINCT FROM p_record->>'coverageEvidenceHash' OR existing."archiveBaselineUsed" IS DISTINCT FROM archive_used OR existing."allocated" IS DISTINCT FROM v_allocated OR existing."eventWorstCase" IS DISTINCT FROM worst OR existing."coverageContract" IS DISTINCT FROM p_record->>'coverageContract' OR existing."maxClosedScopeBytes" IS DISTINCT FROM (p_record->>'maxClosedScopeBytes')::NUMERIC THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  RETURN key;
 END IF;
 SELECT COALESCE(pg_catalog.sum(x."allocated"),0) INTO allocated_total FROM public."Pro262CapacityControlBaseline" x WHERE x."physicalIdentity"=global_row."physicalIdentity";
 IF archive_used+allocated_total+v_allocated>global_row."baseline" OR EXISTS(SELECT 1 FROM public."Pro262CapacityControlBaseline" x WHERE x."physicalIdentity"=global_row."physicalIdentity" AND (x."coverageEvidenceHash" IS DISTINCT FROM p_record->>'coverageEvidenceHash' OR x."archiveBaselineUsed" IS DISTINCT FROM archive_used)) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityControlBaseline"("kind","physicalIdentity","controlProofIdentity","coverageEvidenceHash","archiveBaselineUsed","allocated","eventWorstCase","coverageContract","maxClosedScopeBytes","enabled") VALUES(key,p_record->>'physicalIdentity',p_record->>'controlProofIdentity',p_record->>'coverageEvidenceHash',archive_used,v_allocated,worst,p_record->>'coverageContract',(p_record->>'maxClosedScopeBytes')::NUMERIC,TRUE);
 RETURN key;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
-- The producer submits parsed candidate JSON only for equality against the protected
-- spool's SQL-derived canonical request. No supplied hash is accepted as proof.
CREATE FUNCTION public.pro262_capacity_assert_spool_request(admission_id TEXT,v_fence BIGINT,v_request JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE; s public."Pro262CapacitySpool"%ROWTYPE;
BEGIN
 PERFORM public.pro262_capacity_recheck(admission_id,v_fence);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR SHARE NOWAIT;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=i."replayId" AND x."spoolDigest"=i."spoolDigest";
 SELECT * INTO STRICT s FROM public."Pro262CapacitySpool" x WHERE x."spoolId"=m."spoolId" AND x."replayId"=m."replayId";
 IF v_request IS DISTINCT FROM s."request" OR s."requestDigest" IS DISTINCT FROM m."requestDigest" OR a."subject" IS DISTINCT FROM m."subject" OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacitySpoolConsumption" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence AND x."spoolId"=s."spoolId") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.pro262_capacity_read_context(admission_id TEXT,v_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; r public."Pro262CapacityReplay"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE;
BEGIN
 PERFORM public.pro262_capacity_recheck(admission_id,v_fence);
 SELECT * INTO STRICT a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR SHARE NOWAIT;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=i."replayId";
 SELECT * INTO STRICT m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=r."replayId" AND x."spoolDigest"=i."spoolDigest";
 IF a."state"<>'RUNNING' OR a."subject" IS DISTINCT FROM m."subject" OR a."subject"->>'namespace' IS DISTINCT FROM r."context"->>'namespace' OR a."subject"->>'project' IS DISTINCT FROM r."context"->>'projectId' OR a."subject"->>'owner' IS DISTINCT FROM r."context"->>'identityId' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN r."context";
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_admission(admission_id TEXT,v_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; r public."Pro262CapacityReplay"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=i."replayId";
 IF r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT q FROM public."Pro262CapacityQualification" x WHERE x."qualificationId"=a."qualificationId" AND x."generation"=a."qualificationGeneration";
 RETURN pg_catalog.jsonb_build_object('id',a."admissionId",'fence',a."fence"::TEXT,'subject',a."subject",'incarnation',pg_catalog.jsonb_build_object('host',a."host",'boot',a."boot",'processTree',a."processTree",'backendPrincipal',a."principal"::TEXT,'backendPid',a."pid",'backendStart',a."backendStart"::TEXT),'qualification',pg_catalog.jsonb_build_object('id',q."qualificationId",'generation',q."generation"::TEXT,'evidenceHash',q."proofHash",'validUntil',pg_catalog.to_char(q."validUntil",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reuse',a."reuse",'domain',q."domain",'sourceClosure',q."sourceClosure"),'expiresAt',pg_catalog.to_char(a."expiresAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'state',a."state");
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_issued(issuance_key TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."issuanceKey"=issuance_key;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.pro262_capacity_read_admission(a."admissionId",a."fence");
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_begin(admission_id TEXT,v_fence BIGINT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityAdmission" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence FOR UPDATE NOWAIT;
 IF NOT FOUND OR a."state"<>'RESERVED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_recheck(admission_id,v_fence);
 UPDATE public."Pro262CapacityAdmission" x SET "state"='RUNNING' WHERE x."admissionId"=admission_id AND x."fence"=v_fence;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_cleanup(admission_id TEXT,v_fence BIGINT,receipt_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; r public."Pro262CapacityReplay"%ROWTYPE;
        receipt public."Pro262CapacityCleanupReceipt"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=i."replayId";
 IF r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO receipt FROM public."Pro262CapacityCleanupReceipt" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence AND x."receiptId"=receipt_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=receipt."trustId" AND x."generation"=receipt."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM receipt."observerPrincipal" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM a."host" OR t."scope"->>'boot' IS DISTINCT FROM a."boot" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('admissionId',a."admissionId",'fence',a."fence"::TEXT,'incarnation',pg_catalog.jsonb_build_object('host',a."host",'boot',a."boot",'processTree',a."processTree",'backendPrincipal',a."principal"::TEXT,'backendPid',a."pid",'backendStart',a."backendStart"::TEXT),'outcome',receipt."observation"->>'outcome','protocolDrained',receipt."observation"->'protocolDrain','ipcDrained',receipt."observation"->'IPCDrain','parentDrained',receipt."observation"->'parentDrain','processTreeTerminated',receipt."observation"->'termination','backendAbsent',NOT public.pro262_capacity_backend_live(a."principal",a."pid",a."backendStart"),'observerGeneration',receipt."supervisorGeneration"::TEXT);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_control_prepare(v_kind TEXT,event_key TEXT,p_record JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding_hash TEXT;
BEGIN
 IF pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR event_key IS NULL OR event_key='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_kind='CONTROL_RESERVATION' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>14 OR NOT (p_record ?& ARRAY['route','subject','requestIdentity','holderEnvelope','parentEnvelope','launchEnvelope','replayEnvelope','storageProof','expiry','parentHost','parentBoot','parentProcessTree','expectedReplayPrincipal','expectedProducerPrincipal']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.control.v1',event_key,p_record->>'route',p_record->'subject',p_record->>'requestIdentity',p_record->>'holderEnvelope',p_record->>'parentEnvelope',p_record->>'launchEnvelope',p_record->>'replayEnvelope',p_record->>'storageProof',p_record->>'parentHost',p_record->>'parentBoot',p_record->>'parentProcessTree',p_record->>'expectedReplayPrincipal',p_record->>'expectedProducerPrincipal')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='OBSERVER_INPUT_SLOT' THEN
  IF event_key IS DISTINCT FROM p_record->>'prepaidEventKey' OR COALESCE(p_record->>'reservationId','')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='REPLAY_REGISTRATION' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>2 OR NOT (p_record ?& ARRAY['controlKey','replay']) OR pg_catalog.jsonb_typeof(p_record->'replay') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.replay.v1',event_key,p_record->>'controlKey',p_record->'replay')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='ISSUANCE_REQUEST' THEN
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.issuance.v1',event_key,p_record)::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='TRUST_PROVISION' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>3 OR NOT (p_record ?& ARRAY['trustId','generation','trust']) OR event_key IS DISTINCT FROM (p_record->>'trustId')||':'||(p_record->>'generation') OR pg_catalog.jsonb_typeof(p_record->'trust') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to((p_record->'trust')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='SUPPLIER_RECEIPT' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>4 OR NOT (p_record ?& ARRAY['trustId','generation','evidenceHash','receiptHash']) OR COALESCE(p_record->>'evidenceHash','') !~ '^[a-f0-9]{64}$' OR COALESCE(p_record->>'receiptHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.supplier.v1',event_key,p_record->>'trustId',(p_record->>'generation')::BIGINT,p_record->>'evidenceHash',p_record->>'receiptHash')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='APPROVAL_IMPORT' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>1 OR COALESCE(p_record->>'evidenceHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('pro262.import.v1',event_key,p_record->>'evidenceHash')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='QUALIFICATION' THEN
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_record))<>3 OR NOT (p_record ?& ARRAY['qualificationId','generation','proof']) OR event_key IS DISTINCT FROM (p_record->>'qualificationId')||':'||(p_record->>'generation') OR pg_catalog.jsonb_typeof(p_record->'proof') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to((p_record->'proof')::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='REPLAY_PROFILE' THEN
  IF event_key IS DISTINCT FROM p_record->>'id' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 ELSIF v_kind='PHYSICAL_DOMAIN' THEN
  IF event_key IS DISTINCT FROM p_record->>'physicalIdentity' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  binding_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(p_record::TEXT,'UTF8'),'sha256'),'hex');
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_control_charge(v_kind,event_key,binding_hash);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE TRIGGER "Pro262CapacityReplayProfile_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityReplayProfile" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_qualification_guard();
CREATE FUNCTION public.pro262_capacity_publish_replay_profile(v_proof JSONB) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_boot public."Pro262CapacityBootstrapReplayProfile"%ROWTYPE; d public."Pro262CapacityPhysicalDomain"%ROWTYPE; old_row public."Pro262CapacityReplayProfile"%ROWTYPE; proof_hash TEXT; k TEXT; n NUMERIC; valid_until TIMESTAMPTZ;
BEGIN
 IF pg_catalog.jsonb_typeof(v_proof) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof))<>11 OR NOT (v_proof ?& ARRAY['id','physicalIdentity','proofIdentity','sourceClosure','maxBodyBytes','reservedBackendBytes','reservedSharedBytes','holders','validUntil','installationLane','installation']) OR pg_catalog.jsonb_typeof(v_proof->'installationLane') IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(v_proof->'installation') IS DISTINCT FROM 'object' OR COALESCE(v_proof->>'id','')='' OR COALESCE(v_proof->>'sourceClosure','') !~ '^[a-f0-9]{64}$' OR COALESCE(v_proof->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR pg_catalog.jsonb_typeof(v_proof->'holders') IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_proof->'holders'))<>9 OR NOT ((v_proof->'holders') ?& ARRAY['raw','text','json','driver','seal','parent','launch','authentication','metadata']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 FOREACH k IN ARRAY ARRAY['maxBodyBytes','reservedBackendBytes','reservedSharedBytes'] LOOP
  IF pg_catalog.jsonb_typeof(v_proof->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  n:=(v_proof->>k)::NUMERIC;IF n<=0 OR n<>pg_catalog.trunc(n) OR n::TEXT IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 END LOOP;
 IF (v_proof->>'maxBodyBytes')::NUMERIC>9007199254740991 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 FOREACH k IN ARRAY ARRAY['raw','text','json','driver','seal','parent','launch','authentication','metadata'] LOOP
  IF pg_catalog.jsonb_typeof(v_proof->'holders'->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  n:=(v_proof->'holders'->>k)::NUMERIC;IF n<0 OR n<>pg_catalog.trunc(n) OR n::TEXT IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 END LOOP;
 proof_hash:=pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(v_proof::TEXT,'UTF8'),'sha256'),'hex');valid_until:=(v_proof->>'validUntil')::TIMESTAMPTZ;
 SELECT * INTO v_boot FROM public."Pro262CapacityBootstrapReplayProfile" x WHERE x."id"=v_proof->>'id' FOR SHARE NOWAIT;
 IF NOT FOUND OR v_boot."publisherPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_boot."proofHash" IS DISTINCT FROM proof_hash OR v_boot."validUntil"<valid_until OR valid_until<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO d FROM public."Pro262CapacityPhysicalDomain" x WHERE x."physicalIdentity"=v_proof->>'physicalIdentity' FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT d."enabled" OR d."proofIdentity" IS DISTINCT FROM v_proof->>'proofIdentity' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=v_proof->>'id';
 IF FOUND THEN IF old_row."proof" IS DISTINCT FROM v_proof OR old_row."proofHash" IS DISTINCT FROM proof_hash THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN old_row."id"; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" x WHERE x."kind"='REPLAY_PROFILE' AND x."eventKey"=v_proof->>'id' AND x."bindingHash"=proof_hash) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityReplayProfile"("id","proof","proofHash","physicalIdentity","proofIdentity","sourceClosure","maxBodyBytes","reservedBackendBytes","reservedSharedBytes","validUntil","enabled") VALUES(v_proof->>'id',v_proof,proof_hash,v_proof->>'physicalIdentity',v_proof->>'proofIdentity',v_proof->>'sourceClosure',(v_proof->>'maxBodyBytes')::NUMERIC,(v_proof->>'reservedBackendBytes')::NUMERIC,(v_proof->>'reservedSharedBytes')::NUMERIC,valid_until,TRUE);
 RETURN v_proof->>'id';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_replay_profile(replay_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE; p public."Pro262CapacityReplayProfile"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id;
 IF NOT FOUND OR r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() OR r."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=r."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=r."trustId" AND x."generation"=r."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'SUPERVISOR' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."scope"->>'controlKey' IS DISTINCT FROM c."controlKey" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observed_target(r."controlKey",'REPLAY',r."executorPrincipal",r."executorPid",r."executorBackendStart");
 SELECT * INTO p FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=r."replayProofIdentity" FOR SHARE NOWAIT;
 IF NOT FOUND OR NOT p."enabled" OR p."validUntil"<=pg_catalog.clock_timestamp() OR p."reservedBackendBytes" IS DISTINCT FROM r."reservedBackendBytes" OR p."reservedSharedBytes" IS DISTINCT FROM r."reservedSharedBytes" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('id',p."id",'proofHash',p."proofHash",'maxBodyBytes',p."maxBodyBytes"::TEXT,'parentEnvelope',c."parentEnvelope");
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_revoke_replay_profile(profile_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_row public."Pro262CapacityReplayProfile"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityReplayProfile" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO old_row FROM public."Pro262CapacityReplayProfile" x WHERE x."id"=profile_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT old_row."enabled" THEN RETURN; END IF;
 UPDATE public."Pro262CapacityReplayProfile" x SET "enabled"=FALSE WHERE x."id"=profile_id;
END $$;
CREATE TABLE public."Pro262CapacityReplayCleanupReceipt" (
 "replayId" TEXT NOT NULL REFERENCES public."Pro262CapacityReplay"("replayId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "receiptId" TEXT NOT NULL, "observerPrincipal" NAME NOT NULL, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'), "inputClaimId" TEXT NOT NULL,  "evidence" BYTEA NOT NULL,
 PRIMARY KEY ("replayId","receiptId"), UNIQUE ("replayId"), FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacityReplayCleanupReceipt_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityReplayCleanupReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_quarantine_control(control_key TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityControlReservation" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF c."state"='QUARANTINED' THEN RETURN; END IF;
 IF c."state"='RELEASED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 UPDATE public."Pro262CapacityPrincipalLease" x SET "state"='SEALED' WHERE x."controlKey"=control_key AND x."state"='ACTIVE';
 UPDATE public."Pro262CapacityControlReservation" x SET "state"='QUARANTINED' WHERE x."controlKey"=control_key;
END $$;
CREATE FUNCTION public.pro262_capacity_accept_replay_cleanup(replay_id TEXT,receipt_id TEXT,p_input_claim_id TEXT,v_observation JSONB,p_captured BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public."Pro262CapacityReplay"%ROWTYPE; c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; prior public."Pro262CapacityReplayCleanupReceipt"%ROWTYPE; v_evidence BYTEA; v_generation BIGINT;
BEGIN
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'REPLAY_CLEANUP',pg_catalog.octet_length(pg_catalog.convert_to(replay_id,'UTF8'))::TEXT||':'||replay_id||pg_catalog.octet_length(pg_catalog.convert_to(receipt_id,'UTF8'))::TEXT||':'||receipt_id,GREATEST(pg_catalog.octet_length(v_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" cl JOIN public."Pro262CapacityObserverInputReservation" sl ON sl."reservationId"=cl."reservationId" WHERE cl."inputClaimId"=p_input_claim_id AND sl."observerTrustId"=v_observation->>'trustId' AND sl."observerTrustGeneration"::TEXT=v_observation->>'observerGeneration') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" JOIN public."Pro262CapacityReplay" r ON r."replayId"=replay_id WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=r."controlKey" AND slot."record"->>'targetKind'='REPLAY' ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM v_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF receipt_id IS NULL OR receipt_id='' OR pg_catalog.jsonb_typeof(v_observation) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_observation))<>13 OR NOT (v_observation ?& ARRAY['host','boot','processTree','backendPrincipal','backendPid','backendStart','protocolDrain','ipcDrain','parentDrain','termination','observerGeneration','evidence','trustId']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;

 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=replay_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=r."controlKey" AND o."kind"='REPLAY' AND o."targetOid"=l."principalOid" AND (r."executorPrincipal",r."executorPid",r."executorBackendStart",r."executorHost",r."executorBoot",r."executorProcessTree")=(o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=r."controlKey" FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state" NOT IN ('DRAINING','QUARANTINED','RELEASED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=c."controlKey" AND b."coverageContract"='principal-launch-and-closed-scope-v2' AND (pg_catalog.octet_length(v_observation::TEXT)::NUMERIC+pg_catalog.octet_length(receipt_id)::NUMERIC)<=b."maxClosedScopeBytes") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_generation:=(v_observation->>'observerGeneration')::BIGINT;v_evidence:=pg_catalog.decode(v_observation->>'evidence','base64');IF v_generation<=0 OR pg_catalog.octet_length(v_evidence)=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation->>'trustId' AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM r."executorHost" OR t."scope"->>'boot' IS DISTINCT FROM r."executorBoot" OR
    v_observation->>'host' IS DISTINCT FROM r."executorHost" OR v_observation->>'boot' IS DISTINCT FROM r."executorBoot" OR v_observation->>'processTree' IS DISTINCT FROM r."executorProcessTree" OR v_observation->>'backendPrincipal' IS DISTINCT FROM r."executorPrincipal"::TEXT OR (v_observation->>'backendPid')::INTEGER IS DISTINCT FROM r."executorPid" OR (v_observation->>'backendStart')::TIMESTAMPTZ IS DISTINCT FROM r."executorBackendStart" OR v_observation->'protocolDrain' IS DISTINCT FROM 'true'::JSONB OR v_observation->'ipcDrain' IS DISTINCT FROM 'true'::JSONB OR v_observation->'parentDrain' IS DISTINCT FROM 'true'::JSONB OR v_observation->'termination' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262CapacityReplayCleanupReceipt" x WHERE x."replayId"=replay_id AND x."receiptId"=receipt_id;
 IF FOUND THEN IF prior."inputClaimId" IS DISTINCT FROM p_input_claim_id OR prior."captured" IS DISTINCT FROM p_captured OR prior."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR prior."trustId" IS DISTINCT FROM t."trustId" OR prior."trustGeneration" IS DISTINCT FROM t."generation" OR prior."observation" IS DISTINCT FROM v_observation OR prior."evidence" IS DISTINCT FROM v_evidence THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN receipt_id; END IF;
 IF c."state"='RELEASED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityReplayCleanupReceipt"("replayId","receiptId","observerPrincipal","trustId","trustGeneration","observation","captured","capturedHash","inputClaimId","evidence") VALUES(replay_id,receipt_id,SESSION_USER::NAME,t."trustId",t."generation",v_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),p_input_claim_id,v_evidence);
 RETURN receipt_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

CREATE FUNCTION public.pro262_capacity_find_qualification(approval_id TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE a public."Pro262CapacityApproval"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; q public."Pro262CapacityQualification"%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public."Pro262CapacityApproval" x WHERE x."approvalId"=approval_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=a."trustId" AND x."generation"=a."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CAPACITY_APPROVAL' OR t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR a."validFrom">pg_catalog.clock_timestamp() OR a."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT q FROM public."Pro262CapacityQualification" x WHERE x."approvalId"=approval_id AND x."enabled" AND x."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 IF NOT public.pro262_capacity_validate_proof(q."proof") OR q."proofHash" IS DISTINCT FROM pg_catalog.encode(int4_crypto.digest(pg_catalog.convert_to(q."proof"::TEXT,'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN pg_catalog.jsonb_build_object('id',q."qualificationId",'generation',q."generation"::TEXT,'evidenceHash',q."proofHash",'validUntil',pg_catalog.to_char(q."validUntil",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reuse',a."reuse",'domain',q."domain",'sourceClosure',q."sourceClosure");
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE TABLE public."Pro262CapacityControlCleanupReceipt" (
 "controlKey" TEXT NOT NULL REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "receiptId" TEXT NOT NULL, "observerPrincipal" NAME NOT NULL, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'), "inputClaimId" TEXT NOT NULL,  "evidence" BYTEA NOT NULL,
 PRIMARY KEY ("controlKey","receiptId"), UNIQUE ("controlKey"), FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacityControlCleanupReceipt_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityControlCleanupReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_accept_control_cleanup(control_key TEXT,receipt_id TEXT,p_input_claim_id TEXT,v_observation JSONB,p_captured BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; prior public."Pro262CapacityControlCleanupReceipt"%ROWTYPE; v_evidence BYTEA; v_generation BIGINT;
BEGIN
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'CONTROL_CLEANUP',pg_catalog.octet_length(pg_catalog.convert_to(control_key,'UTF8'))::TEXT||':'||control_key||pg_catalog.octet_length(pg_catalog.convert_to(receipt_id,'UTF8'))::TEXT||':'||receipt_id,GREATEST(pg_catalog.octet_length(v_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" cl JOIN public."Pro262CapacityObserverInputReservation" sl ON sl."reservationId"=cl."reservationId" WHERE cl."inputClaimId"=p_input_claim_id AND sl."observerTrustId"=v_observation->>'trustId' AND sl."observerTrustGeneration"::TEXT=v_observation->>'observerGeneration') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=control_key ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM v_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF receipt_id IS NULL OR receipt_id='' OR pg_catalog.jsonb_typeof(v_observation) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_observation))<>10 OR NOT (v_observation ?& ARRAY['host','boot','parentProcessTree','parentEnvelope','ipcDrained','parentDrained','descendantsTerminated','observerGeneration','evidence','trustId']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;

 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state" NOT IN ('DRAINING','QUARANTINED','RELEASED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=c."controlKey" AND b."coverageContract"='principal-launch-and-closed-scope-v2' AND (pg_catalog.octet_length(v_observation::TEXT)::NUMERIC+pg_catalog.octet_length(receipt_id)::NUMERIC)<=b."maxClosedScopeBytes") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_generation:=(v_observation->>'observerGeneration')::BIGINT;v_evidence:=pg_catalog.decode(v_observation->>'evidence','base64');IF v_generation<=0 OR pg_catalog.octet_length(v_evidence)=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation->>'trustId' AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM c."parentHost" OR t."scope"->>'boot' IS DISTINCT FROM c."parentBoot" OR v_observation->>'host' IS DISTINCT FROM c."parentHost" OR v_observation->>'boot' IS DISTINCT FROM c."parentBoot" OR v_observation->>'parentProcessTree' IS DISTINCT FROM c."parentProcessTree" OR v_observation->>'parentEnvelope' IS DISTINCT FROM c."parentEnvelope" OR v_observation->'ipcDrained' IS DISTINCT FROM 'true'::JSONB OR v_observation->'parentDrained' IS DISTINCT FROM 'true'::JSONB OR v_observation->'descendantsTerminated' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262CapacityControlCleanupReceipt" x WHERE x."controlKey"=control_key AND x."receiptId"=receipt_id;
 IF FOUND THEN IF prior."inputClaimId" IS DISTINCT FROM p_input_claim_id OR prior."captured" IS DISTINCT FROM p_captured OR prior."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR prior."trustId" IS DISTINCT FROM t."trustId" OR prior."trustGeneration" IS DISTINCT FROM t."generation" OR prior."observation" IS DISTINCT FROM v_observation OR prior."evidence" IS DISTINCT FROM v_evidence THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN receipt_id; END IF;
 IF c."state"='RELEASED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityControlCleanupReceipt"("controlKey","receiptId","observerPrincipal","trustId","trustGeneration","observation","captured","capturedHash","inputClaimId","evidence") VALUES(control_key,receipt_id,SESSION_USER::NAME,t."trustId",t."generation",v_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),p_input_claim_id,v_evidence);
 RETURN receipt_id;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE TABLE public."Pro262CapacityClosedScopeReceipt" (
 "controlKey" TEXT PRIMARY KEY REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "trustId" TEXT NOT NULL, "generation" BIGINT NOT NULL, "observerPrincipal" NAME NOT NULL, "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'), "inputClaimId" TEXT NOT NULL,  "evidence" BYTEA NOT NULL,
 FOREIGN KEY ("trustId","generation") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacityClosedScopeReceipt_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityClosedScopeReceipt" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
-- This zero-input lookup is a separately qualified observer input envelope. It is
-- provisioned from the authenticated bootstrap record and is absent by default.
CREATE FUNCTION public.pro262_capacity_read_observer_input_limit() RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_limit NUMERIC;
BEGIN
 SELECT pg_catalog.max(slot."maxInputBytes") INTO v_limit FROM public."Pro262CapacityObserverInputReservation" slot JOIN public."Pro262CapacityTrust" t ON t."trustId"=slot."observerTrustId" AND t."generation"=slot."observerTrustGeneration" JOIN pg_catalog.pg_roles r ON r.oid=slot."observerPrincipalOid" WHERE slot."observerPrincipalName"=SESSION_USER::NAME AND r.rolname=SESSION_USER::NAME AND r.rolcanlogin AND NOT r.rolsuper AND (slot."record"->>'observerBackendPid')::INTEGER=pg_catalog.pg_backend_pid() AND (slot."record"->>'observerBackendStart')::TIMESTAMPTZ=public.pro262_capacity_backend_start() AND t."supplierPrincipal"=SESSION_USER::NAME AND ((t."purpose"='INSTALL_OBSERVATION' AND slot."phase"='INSTALL_PROCESS' AND t."scope"->>'observerHolderId'=slot."baselineAllocationProof") OR (t."purpose"='CLEANUP_OBSERVATION' AND slot."phase"<>'INSTALL_PROCESS' AND t."scope"->>'inputEnvelope'=slot."baselineAllocationProof" AND slot."maxInputBytes"<=(t."scope"->>'inputBound')::NUMERIC)) AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp();
 IF v_limit IS NULL OR v_limit<=0 OR v_limit>9223372036854775807 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF; RETURN pg_catalog.trunc(v_limit)::TEXT;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_cleanup_limit(receipt_kind TEXT,receipt_key TEXT,receipt_fence BIGINT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE control_id TEXT; expected_host TEXT; expected_boot TEXT; admission_row public."Pro262CapacityAdmission"%ROWTYPE; qualification_row public."Pro262CapacityQualification"%ROWTYPE; cap NUMERIC; v_slot_limit NUMERIC;
BEGIN
 IF receipt_kind='OPERATION' THEN
  SELECT * INTO STRICT admission_row FROM public."Pro262CapacityAdmission" a WHERE a."admissionId"=receipt_key AND a."fence"=receipt_fence;
  SELECT * INTO STRICT qualification_row FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=admission_row."qualificationId" AND q."generation"=admission_row."qualificationGeneration";
  IF NOT public.pro262_capacity_validate_proof(qualification_row."proof") OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityTrust" t WHERE t."purpose"='CLEANUP_OBSERVATION' AND t."supplierPrincipal"=SESSION_USER::NAME AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp() AND t."scope"->>'host'=admission_row."host" AND t."scope"->>'boot'=admission_row."boot") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT m."controlKey" INTO STRICT control_id FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE i."issuanceKey"=admission_row."issuanceKey";
  cap:=(qualification_row."proof"->'holderSchedule'->>'cleanup')::NUMERIC;
 ELSE
  IF receipt_kind='REPLAY' THEN SELECT r."controlKey",r."executorHost",r."executorBoot" INTO STRICT control_id,expected_host,expected_boot FROM public."Pro262CapacityReplay" r WHERE r."replayId"=receipt_key;
  ELSIF receipt_kind IN ('CONTROL','CONNECTION','CLOSED_SCOPE') THEN SELECT c."controlKey",c."parentHost",c."parentBoot" INTO STRICT control_id,expected_host,expected_boot FROM public."Pro262CapacityControlReservation" c WHERE c."controlKey"=receipt_key;
  ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityTrust" t WHERE t."purpose"='CLEANUP_OBSERVATION' AND t."supplierPrincipal"=SESSION_USER::NAME AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp() AND (receipt_kind='CONNECTION' OR (t."scope"->>'host'=expected_host AND t."scope"->>'boot'=expected_boot))) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT b."maxClosedScopeBytes" INTO STRICT cap FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=control_id AND b."coverageContract"='principal-launch-and-closed-scope-v2';
 END IF;
 SELECT pg_catalog.max(slot."maxInputBytes") INTO v_slot_limit FROM public."Pro262CapacityObserverInputReservation" slot JOIN public."Pro262CapacityTrust" t ON (t."trustId",t."generation")=(slot."observerTrustId",slot."observerTrustGeneration") WHERE slot."record"->>'targetControlKey'=control_id AND slot."phase"=CASE receipt_kind WHEN 'OPERATION' THEN 'OPERATION_CLEANUP' WHEN 'REPLAY' THEN 'REPLAY_CLEANUP' WHEN 'CONTROL' THEN 'CONTROL_CLEANUP' WHEN 'CONNECTION' THEN 'CONNECTION_OBSERVATION' ELSE 'CLOSED_SCOPE' END AND slot."observerPrincipalName"=SESSION_USER::NAME AND EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=slot."observerPrincipalOid" AND r.rolname=SESSION_USER::NAME AND r.rolcanlogin AND NOT r.rolsuper) AND (slot."record"->>'observerBackendPid')::INTEGER=pg_catalog.pg_backend_pid() AND (slot."record"->>'observerBackendStart')::TIMESTAMPTZ=public.pro262_capacity_backend_start() AND t."supplierPrincipal"=SESSION_USER::NAME AND t."purpose"='CLEANUP_OBSERVATION' AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp() AND t."scope"->>'inputEnvelope'=slot."baselineAllocationProof" AND slot."maxInputBytes"<=(t."scope"->>'inputBound')::NUMERIC;
 IF v_slot_limit IS NULL OR cap IS NULL OR cap<=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF; cap:=LEAST(cap,v_slot_limit); RETURN pg_catalog.trunc(LEAST(cap,public.pro262_capacity_read_observer_input_limit()::NUMERIC))::TEXT;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_closed_scope_limit(control_key TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; lim NUMERIC;
BEGIN
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'QUARANTINED' OR NOT EXISTS(SELECT 1 FROM public."Pro262CapacityTrust" t WHERE t."purpose"='CLEANUP_OBSERVATION' AND t."supplierPrincipal"=SESSION_USER::NAME AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp() AND t."scope"->>'host'=c."parentHost" AND t."scope"->>'boot'=c."parentBoot") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT b."maxClosedScopeBytes" INTO STRICT lim FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=control_key AND b."coverageContract"='principal-launch-and-closed-scope-v2';
 RETURN lim::TEXT;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_accept_closed_scope(control_key TEXT,p_input_claim_id TEXT,v_observation JSONB,p_captured BYTEA) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; supervisor public."Pro262CapacityTrust"%ROWTYPE; replay_oid OID; producer_oid OID; credential_epoch TEXT; launch_epoch TEXT; v_evidence BYTEA; old_row public."Pro262CapacityClosedScopeReceipt"%ROWTYPE;
BEGIN
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'CLOSED_SCOPE',pg_catalog.octet_length(pg_catalog.convert_to(control_key,'UTF8'))::TEXT||':'||control_key,GREATEST(pg_catalog.octet_length(v_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" cl JOIN public."Pro262CapacityObserverInputReservation" sl ON sl."reservationId"=cl."reservationId" WHERE cl."inputClaimId"=p_input_claim_id AND sl."observerTrustId"=v_observation->>'trustId' AND sl."observerTrustGeneration"::TEXT=v_observation->>'observerGeneration') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=control_key ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM v_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF pg_catalog.jsonb_typeof(v_observation) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_observation))<>19 OR NOT (v_observation ?& ARRAY['controlKey','replayOid','producerOid','credentialEpoch','launchEpoch','sourceIdentity','supervisorIdentity','host','boot','parentProcessTree','priorAttemptsQuiesced','credentialsClosed','socketsDrained','ipcDrained','parentDrained','descendantsTerminated','observerGeneration','trustId','evidence']) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR UPDATE NOWAIT;
 IF NOT FOUND OR c."state"<>'QUARANTINED' OR v_observation->>'controlKey' IS DISTINCT FROM control_key THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT l."principalOid",l."credentialEpoch",l."launchEpoch" INTO STRICT replay_oid,credential_epoch,launch_epoch FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=control_key AND l."kind"='REPLAY' AND l."state"='SEALED' FOR SHARE NOWAIT;
 SELECT l."principalOid" INTO STRICT producer_oid FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=control_key AND l."kind"='PRODUCER' AND l."state"='SEALED' AND l."credentialEpoch"=credential_epoch AND l."launchEpoch"=launch_epoch FOR SHARE NOWAIT;
 SELECT * INTO STRICT supervisor FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF supervisor."revoked" OR supervisor."validFrom">pg_catalog.clock_timestamp() OR supervisor."validUntil"<=pg_catalog.clock_timestamp() OR supervisor."scope"->>'credentialEpoch' IS DISTINCT FROM credential_epoch THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation->>'trustId' AND x."generation"=(v_observation->>'observerGeneration')::BIGINT FOR SHARE NOWAIT;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=control_key AND b."coverageContract"='principal-launch-and-closed-scope-v2' AND pg_catalog.octet_length(v_observation::TEXT)::NUMERIC<=b."maxClosedScopeBytes") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_evidence:=pg_catalog.decode(v_observation->>'evidence','base64');
 IF t."purpose"<>'CLEANUP_OBSERVATION'  OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."supplierPrincipal"=supervisor."supplierPrincipal" OR t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM c."parentHost" OR t."scope"->>'boot' IS DISTINCT FROM c."parentBoot" OR pg_catalog.octet_length(v_evidence)=0 OR
 v_observation->>'replayOid' IS DISTINCT FROM replay_oid::TEXT OR v_observation->>'producerOid' IS DISTINCT FROM producer_oid::TEXT OR v_observation->>'credentialEpoch' IS DISTINCT FROM credential_epoch OR v_observation->>'launchEpoch' IS DISTINCT FROM launch_epoch OR v_observation->>'sourceIdentity' IS DISTINCT FROM supervisor."scope"->>'sourceIdentity' OR v_observation->>'supervisorIdentity' IS DISTINCT FROM supervisor."scope"->>'supervisorIdentity' OR v_observation->>'host' IS DISTINCT FROM c."parentHost" OR v_observation->>'boot' IS DISTINCT FROM c."parentBoot" OR v_observation->>'parentProcessTree' IS DISTINCT FROM c."parentProcessTree" OR
 v_observation->'priorAttemptsQuiesced' IS DISTINCT FROM 'true'::JSONB OR v_observation->'credentialsClosed' IS DISTINCT FROM 'true'::JSONB OR v_observation->'socketsDrained' IS DISTINCT FROM 'true'::JSONB OR v_observation->'ipcDrained' IS DISTINCT FROM 'true'::JSONB OR v_observation->'parentDrained' IS DISTINCT FROM 'true'::JSONB OR v_observation->'descendantsTerminated' IS DISTINCT FROM 'true'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityClosedScopeReceipt" x WHERE x."controlKey"=control_key;
 IF FOUND THEN IF old_row."trustId" IS DISTINCT FROM t."trustId" OR old_row."generation" IS DISTINCT FROM t."generation" OR old_row."inputClaimId" IS DISTINCT FROM p_input_claim_id OR old_row."captured" IS DISTINCT FROM p_captured OR old_row."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR old_row."observation" IS DISTINCT FROM v_observation OR old_row."evidence" IS DISTINCT FROM v_evidence THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF; RETURN; END IF;
 INSERT INTO public."Pro262CapacityClosedScopeReceipt" VALUES(control_key,t."trustId",t."generation",SESSION_USER::NAME,v_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),p_input_claim_id,v_evidence);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
-- Boolean-only private helper: no caller-supplied principals or activity data.
CREATE FUNCTION public.pro262_capacity_control_backends_absent(control_key TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF (SELECT pg_catalog.count(*) FROM public."Pro262CapacityPrincipalLease" l WHERE l."controlKey"=control_key AND l."state"='SEALED')<>2 THEN RETURN FALSE; END IF;
 PERFORM pg_catalog.pg_stat_clear_snapshot();
 RETURN NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a JOIN public."Pro262CapacityPrincipalLease" l ON l."principalOid"=a.usesysid WHERE l."controlKey"=control_key AND l."state"='SEALED');
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END $$;
CREATE FUNCTION public.pro262_capacity_release_control(control_key TEXT,control_receipt_id TEXT,replay_receipt_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; r public."Pro262CapacityReplay"%ROWTYPE; parent_receipt public."Pro262CapacityControlCleanupReceipt"%ROWTYPE; replay_receipt public."Pro262CapacityReplayCleanupReceipt"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; v_intent RECORD; scope_receipt public."Pro262CapacityClosedScopeReceipt"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityControlReservation" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF c."state"='RELEASED' THEN IF c."releasedControlReceiptId" IS DISTINCT FROM control_receipt_id OR c."releasedReplayReceiptId" IS DISTINCT FROM replay_receipt_id THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN; END IF;
 IF c."state" NOT IN ('DRAINING','QUARANTINED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT parent_receipt FROM public."Pro262CapacityControlCleanupReceipt" x WHERE x."controlKey"=control_key AND x."receiptId"=control_receipt_id;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=parent_receipt."trustId" AND x."generation"=parent_receipt."trustGeneration" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM parent_receipt."observerPrincipal" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM c."parentHost" OR t."scope"->>'boot' IS DISTINCT FROM c."parentBoot" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO r FROM public."Pro262CapacityReplay" x WHERE x."controlKey"=control_key;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=control_key AND o."kind"='REPLAY' AND o."targetOid"=l."principalOid" AND (r."executorPrincipal",r."executorPid",r."executorBackendStart",r."executorHost",r."executorBoot",r."executorProcessTree")=(o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')) OR EXISTS(SELECT 1 FROM public."Pro262CapacityIssuanceRequest" i WHERE i."replayId"=r."replayId" AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=control_key AND o."kind"='PRODUCER' AND o."targetOid"=l."principalOid" AND (i."backendPrincipal",i."backendPid",i."backendStart",i."host",i."boot",i."processTree")=(o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree'))) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  SELECT * INTO STRICT replay_receipt FROM public."Pro262CapacityReplayCleanupReceipt" x WHERE x."replayId"=r."replayId" AND x."receiptId"=replay_receipt_id;
  SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=replay_receipt."trustId" AND x."generation"=replay_receipt."trustGeneration" FOR SHARE NOWAIT;
  IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM replay_receipt."observerPrincipal" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM r."executorHost" OR t."scope"->>'boot' IS DISTINCT FROM r."executorBoot" OR public.pro262_capacity_backend_live(r."executorPrincipal",r."executorPid",r."executorBackendStart") IS DISTINCT FROM FALSE OR
     EXISTS(SELECT 1 FROM public."Pro262CapacityIssuanceRequest" i LEFT JOIN public."Pro262CapacityAdmission" a ON a."issuanceKey"=i."issuanceKey" WHERE i."replayId"=r."replayId" AND ((a."admissionId" IS NOT NULL AND a."state"<>'RELEASED') OR (a."admissionId" IS NULL AND public.pro262_capacity_backend_live(i."backendPrincipal",i."backendPid",i."backendStart") IS DISTINCT FROM FALSE))) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 ELSIF replay_receipt_id IS NOT NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT scope_receipt FROM public."Pro262CapacityClosedScopeReceipt" z WHERE z."controlKey"=control_key;
 SELECT * INTO t FROM public."Pro262CapacityTrust" tr WHERE tr."trustId"=scope_receipt."trustId" AND tr."generation"=scope_receipt."generation" FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."supplierPrincipal" IS DISTINCT FROM scope_receipt."observerPrincipal" OR t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR public.pro262_capacity_control_backends_absent(control_key) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 -- Each possible private login was durably fenced before any launch. An uncertain
 -- OPENING intent can never be released; authenticated observation must reconcile it.
 FOR v_intent IN SELECT * FROM public."Pro262CapacityConnectionIntent" x WHERE x."controlKey"=control_key FOR UPDATE NOWAIT LOOP
  IF v_intent."state"='OPENING' OR v_intent."state"='CLOSED' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF v_intent."state"='BOUND' AND public.pro262_capacity_backend_live(v_intent."expectedPrincipal",v_intent."pid",v_intent."backendStart") IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  IF v_intent."state"='NEVER_OPENED' AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityConnectionObservation" o JOIN public."Pro262CapacityTrust" tr ON tr."trustId"=o."observerTrustId" AND tr."generation"=o."observerGeneration" WHERE o."controlKey"=control_key AND o."kind"=v_intent."kind" AND o."observation"->>'outcome'='NEVER_OPENED' AND o."observerPrincipal"=v_intent."observerPrincipal" AND tr."supplierPrincipal"=o."observerPrincipal" AND tr."purpose"='CLEANUP_OBSERVATION' AND NOT tr."revoked" AND tr."validFrom"<=pg_catalog.clock_timestamp() AND tr."validUntil">pg_catalog.clock_timestamp()) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  UPDATE public."Pro262CapacityConnectionIntent" x SET "state"='CLOSED' WHERE x."controlKey"=control_key AND x."kind"=v_intent."kind";
 END LOOP;
 UPDATE public."Pro262CapacityLaunchReservation" x SET "state"='RELEASED' WHERE x."controlKey"=control_key AND x."state"='RESERVED';
 UPDATE public."Pro262CapacityPrincipalLease" x SET "state"='CLOSED' WHERE x."controlKey"=control_key AND x."state"='SEALED';
 UPDATE public."Pro262CapacityControlReservation" x SET "state"='RELEASED',"releasedControlReceiptId"=control_receipt_id,"releasedReplayReceiptId"=replay_receipt_id WHERE x."controlKey"=control_key;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_read_outcome(admission_id TEXT,v_fence BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a public."Pro262CapacityAdmission"%ROWTYPE; i public."Pro262CapacityIssuanceRequest"%ROWTYPE; r public."Pro262CapacityReplay"%ROWTYPE; m public."Pro262CapacityReplayMiss"%ROWTYPE; s public."Pro262CapacitySpool"%ROWTYPE; v_outcome JSONB; own_result BOOLEAN; error_text TEXT;
BEGIN
 SELECT * INTO a FROM public."Pro262CapacityAdmission" x WHERE x."admissionId"=admission_id AND x."fence"=v_fence;
 IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT i FROM public."Pro262CapacityIssuanceRequest" x WHERE x."issuanceKey"=a."issuanceKey";
 SELECT * INTO STRICT r FROM public."Pro262CapacityReplay" x WHERE x."replayId"=i."replayId";
 IF r."supervisorPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR r."supervisorPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR r."supervisorBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT m FROM public."Pro262CapacityReplayMiss" x WHERE x."replayId"=r."replayId" AND x."spoolDigest"=i."spoolDigest";
 SELECT * INTO STRICT s FROM public."Pro262CapacitySpool" x WHERE x."replayId"=r."replayId" AND x."spoolId"=m."spoolId";
 IF a."subject" IS DISTINCT FROM m."subject" OR s."requestDigest" IS DISTINCT FROM m."requestDigest" THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF r."operation"='ENTA_SUCCESSOR' THEN
  v_outcome:=public.e3_comp_retry(r."context"->>'namespace',r."context"->>'projectId',r."context"->>'uid',s."request");
  SELECT EXISTS(SELECT 1 FROM public."Pro262CapacityStageBinding" b JOIN public."E3StartReservation" st ON st."id"=b."e3StageId" WHERE b."admissionId"=a."admissionId" AND b."fence"=a."fence" AND b."stageKind"='ENTA' AND st."externalRequest"=s."request") INTO own_result;
  IF v_outcome IS NOT NULL AND own_result THEN v_outcome:=pg_catalog.jsonb_set(v_outcome,ARRAY['idempotent'],'false'::JSONB,FALSE); END IF;
 ELSIF r."operation"='PG_SETUP' THEN
  v_outcome:=public.eng03_06_successor_setup(r."context",s."request",NULL::JSONB);
  SELECT EXISTS(SELECT 1 FROM public."Pro262CapacitySetupIntent" b JOIN public."HuroofSuccessorSetup" st ON (st."namespace",st."ownerId",st."setupKey",st."freshRoomId")=(b."namespace",b."ownerId",b."setupKey",b."freshRoomId") WHERE b."admissionId"=a."admissionId" AND b."fence"=a."fence" AND st."externalRequest"=s."request") INTO own_result;
  IF v_outcome IS NOT NULL AND own_result THEN v_outcome:=pg_catalog.jsonb_set(v_outcome,ARRAY['replayed'],'false'::JSONB,FALSE); END IF;
 ELSIF r."operation"='PG_START' THEN
  v_outcome:=public.eng03_06_successor_retry(r."context",s."request");
  SELECT EXISTS(SELECT 1 FROM public."Pro262CapacityStageBinding" b JOIN public."HuroofSuccessorStartReservation" st ON st."stageId"=b."pgStageId" WHERE b."admissionId"=a."admissionId" AND b."fence"=a."fence" AND b."stageKind"='PG' AND st."externalRequest"=s."request") INTO own_result;
  IF v_outcome IS NOT NULL AND own_result THEN v_outcome:=pg_catalog.jsonb_set(v_outcome,ARRAY['replayed'],'false'::JSONB,FALSE); END IF;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_outcome IS NULL THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN v_outcome;
EXCEPTION WHEN OTHERS THEN
 GET STACKED DIAGNOSTICS error_text = MESSAGE_TEXT;
 IF error_text IN ('E3_EXTERNAL_IDEMPOTENCY_CONFLICT','E3_EXTERNAL_LOGICAL_COLLISION','E3_EXISTING_NATIVE_NOT_ATTACHABLE','SUCCESSOR_IDEMPOTENCY_COLLISION','SUCCESSOR_IDEMPOTENCY_CONFLICT','SUCCESSOR_SETUP_CONFLICT','ACCOUNT_NOT_READY') THEN RAISE EXCEPTION '%',error_text; END IF;
 RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE TABLE public."Pro262CapacityConnectionIntent" (
 "controlKey" TEXT NOT NULL REFERENCES public."Pro262CapacityControlReservation"("controlKey") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('REPLAY','PRODUCER')), "expectedPrincipal" NAME NOT NULL,
 "state" TEXT NOT NULL CHECK ("state" IN ('OPENING','BOUND','NEVER_OPENED','CLOSED')),
 "pid" INTEGER, "backendStart" TIMESTAMPTZ, "host" TEXT, "boot" TEXT, "processTree" TEXT,
 "observerTrustId" TEXT, "observerGeneration" BIGINT, "observerPrincipal" NAME, "observation" JSONB, "evidence" BYTEA,
 PRIMARY KEY ("controlKey","kind"),
 CHECK (("state"='OPENING' AND "pid" IS NULL AND "backendStart" IS NULL AND "observation" IS NULL) OR
        ("state"='BOUND' AND "pid">0 AND "backendStart" IS NOT NULL AND "host" IS NOT NULL AND "boot" IS NOT NULL AND "processTree" IS NOT NULL) OR
        ("state"='NEVER_OPENED' AND "pid" IS NULL AND "backendStart" IS NULL AND "observerTrustId" IS NOT NULL AND "observerGeneration" IS NOT NULL AND "observerPrincipal" IS NOT NULL AND "observation" IS NOT NULL AND "evidence" IS NOT NULL) OR
        ("state"='CLOSED')),
 FOREIGN KEY ("observerTrustId","observerGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE public."Pro262CapacityProcessObservation" (
 "controlKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "credentialEpoch" TEXT NOT NULL, "launchEpoch" TEXT NOT NULL,
 "observationId" TEXT NOT NULL UNIQUE, "trustId" TEXT NOT NULL, "trustGeneration" BIGINT NOT NULL,
 "inputClaimId" TEXT NOT NULL UNIQUE REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "targetPrincipal" NAME NOT NULL, "targetOid" OID NOT NULL, "targetPid" INTEGER NOT NULL, "targetBackendStart" TIMESTAMPTZ NOT NULL,
 "observerPrincipal" NAME NOT NULL, "observerOid" OID NOT NULL, "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 "validUntil" TIMESTAMPTZ NOT NULL, "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'),  "evidence" BYTEA NOT NULL, "evidenceHash" TEXT NOT NULL,
 PRIMARY KEY ("controlKey","kind","credentialEpoch","launchEpoch"),
 FOREIGN KEY ("controlKey","kind") REFERENCES public."Pro262CapacityConnectionIntent"("controlKey","kind") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("controlKey","kind") REFERENCES public."Pro262CapacityPrincipalLease"("controlKey","kind") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("controlKey","kind") REFERENCES public."Pro262CapacityLaunchReservation"("controlKey","kind") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("trustId","trustGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacityProcessObservation_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityProcessObservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_accept_install_observation(p_control_key TEXT,p_kind TEXT,p_input_claim_id TEXT,p_observation JSONB,p_captured BYTEA) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_control public."Pro262CapacityControlReservation"%ROWTYPE; v_lease public."Pro262CapacityPrincipalLease"%ROWTYPE; v_intent public."Pro262CapacityConnectionIntent"%ROWTYPE; v_launch public."Pro262CapacityLaunchReservation"%ROWTYPE; v_trust public."Pro262CapacityTrust"%ROWTYPE; v_prior public."Pro262CapacityProcessObservation"%ROWTYPE; v_claim public."Pro262CapacityObserverInputClaim"%ROWTYPE; v_slot public."Pro262CapacityObserverInputReservation"%ROWTYPE; v_observer_oid OID; v_evidence BYTEA; v_pid INTEGER; v_started TIMESTAMPTZ; v_until TIMESTAMPTZ; v_now TIMESTAMPTZ; v_expected_lane JSONB; v_expected_installation JSONB; v_field TEXT;
BEGIN
 IF p_kind NOT IN ('REPLAY','PRODUCER') OR pg_catalog.jsonb_typeof(p_observation) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_observation))<>23 OR NOT (p_observation ?& ARRAY['observationVersion','observationId','trustId','trustGeneration','controlKey','kind','credentialEpoch','launchEpoch','principalName','principalOid','pid','backendStart','host','boot','processTree','installationGeneration','installationEvidenceHash','installation','observedAt','validUntil','evidence','evidenceHash','inputClaimId']) OR p_observation->>'controlKey' IS DISTINCT FROM p_control_key OR p_observation->>'kind' IS DISTINCT FROM p_kind OR p_observation->>'inputClaimId' IS DISTINCT FROM p_input_claim_id OR p_observation->>'observationVersion' IS DISTINCT FROM '1' OR COALESCE(p_observation->>'observationId','')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'INSTALL_PROCESS',pg_catalog.octet_length(pg_catalog.convert_to(p_control_key,'UTF8'))::TEXT||':'||p_control_key||pg_catalog.octet_length(pg_catalog.convert_to(p_kind,'UTF8'))::TEXT||':'||p_kind,GREATEST(pg_catalog.octet_length(p_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=p_control_key AND slot."record"->>'targetKind'=p_kind ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 FOREACH v_field IN ARRAY ARRAY['observationVersion','observationId','trustId','trustGeneration','controlKey','kind','credentialEpoch','launchEpoch','principalName','principalOid','pid','backendStart','host','boot','processTree','installationGeneration','installationEvidenceHash','observedAt','validUntil','evidence','evidenceHash','inputClaimId'] LOOP
  IF pg_catalog.jsonb_typeof(p_observation->v_field) IS DISTINCT FROM 'string' OR COALESCE(p_observation->>v_field,'')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 END LOOP;
 IF pg_catalog.jsonb_typeof(p_observation->'installation') IS DISTINCT FROM 'object' OR p_observation->>'trustGeneration' !~ '^[1-9][0-9]{0,18}$' OR p_observation->>'principalOid' !~ '^[1-9][0-9]{0,9}$' OR p_observation->>'installationGeneration' !~ '^[1-9][0-9]{0,18}$' OR p_observation->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR p_observation->>'validUntil' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' OR p_observation->>'backendStart' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM p_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT v_claim FROM public."Pro262CapacityObserverInputClaim" x WHERE x."inputClaimId"=p_input_claim_id;
 SELECT * INTO STRICT v_slot FROM public."Pro262CapacityObserverInputReservation" x WHERE x."reservationId"=v_claim."reservationId";
 SELECT * INTO STRICT v_control FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=p_control_key FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_lease FROM public."Pro262CapacityPrincipalLease" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_intent FROM public."Pro262CapacityConnectionIntent" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_launch FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind FOR SHARE NOWAIT;
 IF p_kind='REPLAY' THEN SELECT rp."proof"->'installationLane',rp."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityReplayProfile" rp WHERE rp."id"=v_launch."profileId" AND rp."proofHash"=v_launch."profileHash" FOR SHARE NOWAIT;
 ELSE SELECT q."proof"->'installationLane',q."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=v_launch."profileId" AND q."generation"=v_launch."profileGeneration" AND q."proofHash"=v_launch."profileHash" FOR SHARE NOWAIT; END IF;
 SELECT * INTO STRICT v_trust FROM public."Pro262CapacityTrust" t WHERE t."purpose"='INSTALL_OBSERVATION' AND t."scope"->'lane'=v_expected_lane AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 IF v_trust."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_trust."scope"->'installation' IS DISTINCT FROM v_expected_installation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT oid INTO STRICT v_observer_oid FROM pg_catalog.pg_roles WHERE rolname=SESSION_USER::NAME AND rolcanlogin AND NOT rolsuper;
 IF v_control."state"<>'RESERVED' OR v_lease."state"<>'ACTIVE' OR v_intent."state" NOT IN ('OPENING','BOUND') OR v_launch."state"<>'RESERVED' OR v_observer_oid=v_lease."principalOid" OR v_claim."observerPrincipalOid" IS DISTINCT FROM v_observer_oid OR v_slot."baselineAllocationProof" IS DISTINCT FROM v_trust."scope"->>'observerHolderId' OR v_slot."observerTrustId" IS DISTINCT FROM v_trust."trustId" OR v_slot."observerTrustGeneration" IS DISTINCT FROM v_trust."generation" OR p_observation->>'trustId' IS DISTINCT FROM v_trust."trustId" OR p_observation->>'trustGeneration' IS DISTINCT FROM v_trust."generation"::TEXT OR p_observation->>'credentialEpoch' IS DISTINCT FROM v_lease."credentialEpoch" OR p_observation->>'launchEpoch' IS DISTINCT FROM v_lease."launchEpoch" OR p_observation->>'principalName' IS DISTINCT FROM v_intent."expectedPrincipal"::TEXT OR p_observation->>'principalOid' IS DISTINCT FROM v_lease."principalOid"::TEXT OR p_observation->'installation' IS DISTINCT FROM v_trust."scope"->'installation' OR p_observation->>'installationGeneration' IS DISTINCT FROM v_trust."scope"->>'installationGeneration' OR p_observation->>'installationEvidenceHash' IS DISTINCT FROM v_trust."scope"->>'installationEvidenceHash' OR p_observation->>'host' IS DISTINCT FROM v_trust."scope"->'installation'->>'host' OR p_observation->>'boot' IS DISTINCT FROM v_trust."scope"->'installation'->>'boot' OR COALESCE(p_observation->>'processTree','')='' OR COALESCE(p_observation->>'pid','') !~ '^[1-9][0-9]{0,9}$' OR COALESCE(p_observation->>'backendStart','')='' OR COALESCE(p_observation->>'observedAt','')='' OR COALESCE(p_observation->>'validUntil','')='' OR COALESCE(p_observation->>'evidenceHash','') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_pid:=(p_observation->>'pid')::INTEGER;v_started:=(p_observation->>'backendStart')::TIMESTAMPTZ;v_until:=(p_observation->>'validUntil')::TIMESTAMPTZ;v_now:=pg_catalog.clock_timestamp();v_evidence:=pg_catalog.decode(p_observation->>'evidence','base64');
 IF v_pid<=0 OR (p_observation->>'observedAt')::TIMESTAMPTZ>v_now OR v_until<=v_now OR v_until>v_trust."validUntil" OR pg_catalog.octet_length(v_evidence)=0 OR pg_catalog.encode(int4_crypto.digest(v_evidence,'sha256'),'hex') IS DISTINCT FROM p_observation->>'evidenceHash' OR public.pro262_capacity_backend_live(v_intent."expectedPrincipal",v_pid,v_started) IS DISTINCT FROM TRUE OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_lease."principalOid" AND r.rolname=v_intent."expectedPrincipal" AND r.rolcanlogin) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO v_prior FROM public."Pro262CapacityProcessObservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind AND x."credentialEpoch"=v_lease."credentialEpoch" AND x."launchEpoch"=v_lease."launchEpoch";
 IF FOUND THEN IF v_prior."inputClaimId" IS DISTINCT FROM p_input_claim_id OR v_prior."captured" IS DISTINCT FROM p_captured OR v_prior."observation" IS DISTINCT FROM p_observation OR v_prior."evidence" IS DISTINCT FROM v_evidence OR v_prior."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN v_prior."observationId"; END IF;
 INSERT INTO public."Pro262CapacityProcessObservation"("controlKey","kind","credentialEpoch","launchEpoch","observationId","trustId","trustGeneration","inputClaimId","targetPrincipal","targetOid","targetPid","targetBackendStart","observerPrincipal","observerOid","validUntil","observation","captured","capturedHash","evidence","evidenceHash") VALUES(p_control_key,p_kind,v_lease."credentialEpoch",v_lease."launchEpoch",p_observation->>'observationId',v_trust."trustId",v_trust."generation",p_input_claim_id,v_intent."expectedPrincipal",v_lease."principalOid",v_pid,v_started,SESSION_USER::NAME,v_observer_oid,v_until,p_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),v_evidence,p_observation->>'evidenceHash');
 RETURN p_observation->>'observationId';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_assert_process_installation(p_control_key TEXT,p_kind TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_control public."Pro262CapacityControlReservation"%ROWTYPE; v_lease public."Pro262CapacityPrincipalLease"%ROWTYPE; v_observation public."Pro262CapacityProcessObservation"%ROWTYPE; v_trust public."Pro262CapacityTrust"%ROWTYPE; v_launch public."Pro262CapacityLaunchReservation"%ROWTYPE; v_expected_lane JSONB; v_expected_installation JSONB;
BEGIN
 SELECT * INTO STRICT v_control FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=p_control_key FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_lease FROM public."Pro262CapacityPrincipalLease" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_observation FROM public."Pro262CapacityProcessObservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind AND x."credentialEpoch"=v_lease."credentialEpoch" AND x."launchEpoch"=v_lease."launchEpoch";
 SELECT * INTO STRICT v_trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation."trustId" AND x."generation"=v_observation."trustGeneration" FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_launch FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind;
 IF p_kind='REPLAY' THEN SELECT rp."proof"->'installationLane',rp."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityReplayProfile" rp WHERE rp."id"=v_launch."profileId" AND rp."proofHash"=v_launch."profileHash" AND rp."enabled" AND rp."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 ELSIF p_kind='PRODUCER' THEN SELECT q."proof"->'installationLane',q."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=v_launch."profileId" AND q."generation"=v_launch."profileGeneration" AND q."proofHash"=v_launch."profileHash" AND q."enabled" AND q."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_trust."scope"->'lane' IS DISTINCT FROM v_expected_lane OR v_trust."scope"->'installation' IS DISTINCT FROM v_expected_installation OR v_observation."observation"->'installation' IS DISTINCT FROM v_expected_installation OR (SELECT pg_catalog.count(*) FROM public."Pro262CapacityTrust" t WHERE t."purpose"='INSTALL_OBSERVATION' AND t."scope"->'lane'=v_expected_lane AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp())<>1 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_control."state"<>'RESERVED' OR v_lease."state"<>'ACTIVE' OR v_trust."purpose"<>'INSTALL_OBSERVATION' OR v_trust."revoked" OR v_trust."validFrom">pg_catalog.clock_timestamp() OR v_trust."validUntil"<=pg_catalog.clock_timestamp() OR v_observation."validUntil"<=pg_catalog.clock_timestamp() OR v_observation."targetPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR v_observation."targetOid" IS DISTINCT FROM v_lease."principalOid" OR v_observation."targetPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR v_observation."targetBackendStart" IS DISTINCT FROM public.pro262_capacity_backend_start() OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_observation."targetOid" AND r.rolname=SESSION_USER::NAME) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityConnectionIntent" i WHERE i."controlKey"=p_control_key AND i."kind"=p_kind AND i."state"='BOUND' AND (i."expectedPrincipal",i."pid",i."backendStart",i."host",i."boot",i."processTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_kind='REPLAY' AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r WHERE r."controlKey"=p_control_key AND (r."executorPrincipal",r."executorPid",r."executorBackendStart",r."executorHost",r."executorBoot",r."executorProcessTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_kind='PRODUCER' AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" JOIN public."Pro262CapacityAdmission" a ON a."issuanceKey"=i."issuanceKey" WHERE m."controlKey"=p_control_key AND (i."backendPrincipal",i."backendPid",i."backendStart",i."host",i."boot",i."processTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree') AND (a."principal",a."pid",a."backendStart",a."host",a."boot",a."processTree")=(i."backendPrincipal",i."backendPid",i."backendStart",i."host",i."boot",i."processTree")) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE FUNCTION public.pro262_capacity_assert_observed_target(p_control_key TEXT,p_kind TEXT,p_principal NAME,p_pid INTEGER,p_backend_start TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_lease public."Pro262CapacityPrincipalLease"%ROWTYPE; v_observation public."Pro262CapacityProcessObservation"%ROWTYPE; v_trust public."Pro262CapacityTrust"%ROWTYPE; v_launch public."Pro262CapacityLaunchReservation"%ROWTYPE; v_expected_lane JSONB; v_expected_installation JSONB;
BEGIN
 SELECT * INTO STRICT v_lease FROM public."Pro262CapacityPrincipalLease" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind AND x."state"='ACTIVE' FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_observation FROM public."Pro262CapacityProcessObservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind AND x."credentialEpoch"=v_lease."credentialEpoch" AND x."launchEpoch"=v_lease."launchEpoch";
 SELECT * INTO STRICT v_trust FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation."trustId" AND x."generation"=v_observation."trustGeneration" FOR SHARE NOWAIT;
 SELECT * INTO STRICT v_launch FROM public."Pro262CapacityLaunchReservation" x WHERE x."controlKey"=p_control_key AND x."kind"=p_kind;
 IF p_kind='REPLAY' THEN SELECT rp."proof"->'installationLane',rp."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityReplayProfile" rp WHERE rp."id"=v_launch."profileId" AND rp."proofHash"=v_launch."profileHash" AND rp."enabled" AND rp."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 ELSIF p_kind='PRODUCER' THEN SELECT q."proof"->'installationLane',q."proof"->'installation' INTO STRICT v_expected_lane,v_expected_installation FROM public."Pro262CapacityQualification" q WHERE q."qualificationId"=v_launch."profileId" AND q."generation"=v_launch."profileGeneration" AND q."proofHash"=v_launch."profileHash" AND q."enabled" AND q."validUntil">pg_catalog.clock_timestamp() FOR SHARE NOWAIT;
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_trust."scope"->'lane' IS DISTINCT FROM v_expected_lane OR v_trust."scope"->'installation' IS DISTINCT FROM v_expected_installation OR v_observation."observation"->'installation' IS DISTINCT FROM v_expected_installation OR (SELECT pg_catalog.count(*) FROM public."Pro262CapacityTrust" t WHERE t."purpose"='INSTALL_OBSERVATION' AND t."scope"->'lane'=v_expected_lane AND NOT t."revoked" AND t."validFrom"<=pg_catalog.clock_timestamp() AND t."validUntil">pg_catalog.clock_timestamp())<>1 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF v_trust."purpose"<>'INSTALL_OBSERVATION' OR v_trust."revoked" OR v_trust."validFrom">pg_catalog.clock_timestamp() OR v_trust."validUntil"<=pg_catalog.clock_timestamp() OR v_observation."validUntil"<=pg_catalog.clock_timestamp() OR v_observation."targetPrincipal" IS DISTINCT FROM p_principal OR v_observation."targetOid" IS DISTINCT FROM v_lease."principalOid" OR v_observation."targetPid" IS DISTINCT FROM p_pid OR v_observation."targetBackendStart" IS DISTINCT FROM p_backend_start OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=v_lease."principalOid" AND r.rolname=p_principal AND r.rolcanlogin) OR public.pro262_capacity_backend_live(p_principal,p_pid,p_backend_start) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityConnectionIntent" i WHERE i."controlKey"=p_control_key AND i."kind"=p_kind AND i."state"='BOUND') AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityConnectionIntent" i WHERE i."controlKey"=p_control_key AND i."kind"=p_kind AND i."state"='BOUND' AND (i."expectedPrincipal",i."pid",i."backendStart",i."host",i."boot",i."processTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_kind='REPLAY' AND EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r WHERE r."controlKey"=p_control_key) AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityReplay" r WHERE r."controlKey"=p_control_key AND (r."executorPrincipal",r."executorPid",r."executorBackendStart",r."executorHost",r."executorBoot",r."executorProcessTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_kind='PRODUCER' AND EXISTS(SELECT 1 FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE m."controlKey"=p_control_key) AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityIssuanceRequest" i JOIN public."Pro262CapacityReplayMiss" m ON m."replayId"=i."replayId" WHERE m."controlKey"=p_control_key AND (i."backendPrincipal",i."backendPid",i."backendStart",i."host",i."boot",i."processTree")=(v_observation."targetPrincipal",v_observation."targetPid",v_observation."targetBackendStart",v_observation."observation"->>'host',v_observation."observation"->>'boot',v_observation."observation"->>'processTree')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
END $$;
CREATE UNIQUE INDEX "Pro262CapacityConnectionIntent_principal_occupied" ON public."Pro262CapacityConnectionIntent"("expectedPrincipal") WHERE "state" IN ('OPENING','BOUND');
CREATE FUNCTION public.pro262_capacity_connection_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD."controlKey",OLD."kind",OLD."expectedPrincipal") IS DISTINCT FROM (NEW."controlKey",NEW."kind",NEW."expectedPrincipal") OR
    NOT ((OLD."state"='OPENING' AND NEW."state" IN ('BOUND','NEVER_OPENED')) OR (OLD."state" IN ('BOUND','NEVER_OPENED') AND NEW."state"='CLOSED')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF OLD."state" IN ('BOUND','NEVER_OPENED') AND (pg_catalog.to_jsonb(NEW)-'state') IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Pro262CapacityConnectionIntent_guard" BEFORE UPDATE OR DELETE ON public."Pro262CapacityConnectionIntent" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_connection_guard();
CREATE FUNCTION public.pro262_capacity_prepare_connection(control_key TEXT,v_kind TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; old_row public."Pro262CapacityConnectionIntent"%ROWTYPE; v_principal NAME; target_role TEXT;
BEGIN
 IF v_kind NOT IN ('REPLAY','PRODUCER') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state"<>'RESERVED' OR c."expiresAt"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO STRICT t FROM public."Pro262CapacityTrust" x WHERE x."purpose"='SUPERVISOR' AND x."supplierPrincipal"=SESSION_USER::NAME AND x."scope"->>'controlKey'=control_key FOR SHARE NOWAIT;
 IF t."revoked" OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_principal:=CASE v_kind WHEN 'REPLAY' THEN c."expectedReplayPrincipal" ELSE c."expectedProducerPrincipal" END;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityPrincipalLease" l JOIN pg_catalog.pg_roles r ON r.oid=l."principalOid" WHERE l."controlKey"=control_key AND l."kind"=v_kind AND l."state"='ACTIVE' AND r.rolname=v_principal) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 target_role:=CASE v_kind WHEN 'REPLAY' THEN 'pro262_replay_executor' ELSE 'pro262_producer' END;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname=v_principal AND x.rolcanlogin AND NOT x.rolsuper AND x.rolconnlimit=1 AND pg_catalog.pg_has_role(x.oid,(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=target_role),'MEMBER')) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO old_row FROM public."Pro262CapacityConnectionIntent" x WHERE x."controlKey"=control_key AND x."kind"=v_kind;
 IF FOUND THEN IF old_row."expectedPrincipal" IS DISTINCT FROM v_principal THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN 'EXISTING'; END IF;
 INSERT INTO public."Pro262CapacityConnectionIntent"("controlKey","kind","expectedPrincipal","state") VALUES(control_key,v_kind,v_principal,'OPENING');
 RETURN 'CREATED';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;
CREATE FUNCTION public.pro262_capacity_bind_connection(control_key TEXT,v_kind TEXT,v_principal NAME,v_pid INTEGER,started TIMESTAMPTZ,v_host TEXT,v_boot TEXT,process_tree TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE i public."Pro262CapacityConnectionIntent"%ROWTYPE;
BEGIN
 LOCK TABLE public."Pro262CapacityConnectionIntent" IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO i FROM public."Pro262CapacityConnectionIntent" x WHERE x."controlKey"=control_key AND x."kind"=v_kind FOR UPDATE NOWAIT;
 IF NOT FOUND OR i."expectedPrincipal" IS DISTINCT FROM v_principal OR v_pid IS NULL OR v_pid<=0 OR started IS NULL OR COALESCE(v_host,'')='' OR COALESCE(v_boot,'')='' OR COALESCE(process_tree,'')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o WHERE o."controlKey"=control_key AND o."kind"=v_kind) AND NOT EXISTS(SELECT 1 FROM public."Pro262CapacityProcessObservation" o JOIN public."Pro262CapacityPrincipalLease" l ON (l."controlKey",l."kind",l."credentialEpoch",l."launchEpoch")=(o."controlKey",o."kind",o."credentialEpoch",o."launchEpoch") WHERE o."controlKey"=control_key AND o."kind"=v_kind AND o."targetOid"=l."principalOid" AND (o."targetPrincipal",o."targetPid",o."targetBackendStart",o."observation"->>'host',o."observation"->>'boot',o."observation"->>'processTree')=(v_principal,v_pid,started,v_host,v_boot,process_tree)) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF i."state"='BOUND' THEN IF (i."pid",i."backendStart",i."host",i."boot",i."processTree") IS DISTINCT FROM (v_pid,started,v_host,v_boot,process_tree) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN; END IF;
 IF i."state"<>'OPENING' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 UPDATE public."Pro262CapacityConnectionIntent" x SET "state"='BOUND',"pid"=v_pid,"backendStart"=started,"host"=v_host,"boot"=v_boot,"processTree"=process_tree WHERE x."controlKey"=control_key AND x."kind"=v_kind;
END $$;
CREATE TABLE public."Pro262CapacityConnectionObservation" (
 "controlKey" TEXT NOT NULL, "kind" TEXT NOT NULL, "observerTrustId" TEXT NOT NULL, "observerGeneration" BIGINT NOT NULL, "observerPrincipal" NAME NOT NULL,
 "observation" JSONB NOT NULL, "captured" BYTEA NOT NULL, "capturedHash" TEXT NOT NULL CHECK ("capturedHash" ~ '^[a-f0-9]{64}$'), "inputClaimId" TEXT NOT NULL,  "evidence" BYTEA NOT NULL, PRIMARY KEY ("controlKey","kind"),
 FOREIGN KEY ("controlKey","kind") REFERENCES public."Pro262CapacityConnectionIntent"("controlKey","kind") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("observerTrustId","observerGeneration") REFERENCES public."Pro262CapacityTrust"("trustId","generation") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TRIGGER "Pro262CapacityConnectionObservation_immutable" BEFORE UPDATE OR DELETE ON public."Pro262CapacityConnectionObservation" FOR EACH ROW EXECUTE FUNCTION public.pro262_capacity_immutable();
CREATE FUNCTION public.pro262_capacity_observe_connection(control_key TEXT,v_kind TEXT,p_input_claim_id TEXT,v_observation JSONB,p_captured BYTEA) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public."Pro262CapacityControlReservation"%ROWTYPE; i public."Pro262CapacityConnectionIntent"%ROWTYPE; t public."Pro262CapacityTrust"%ROWTYPE; prior public."Pro262CapacityConnectionObservation"%ROWTYPE; evidence_bytes BYTEA; v_generation BIGINT; v_pid INTEGER; started TIMESTAMPTZ;
BEGIN
 PERFORM public.pro262_capacity_assert_observer_claim(p_input_claim_id,'CONNECTION_OBSERVATION',pg_catalog.octet_length(pg_catalog.convert_to(control_key,'UTF8'))::TEXT||':'||control_key||pg_catalog.octet_length(pg_catalog.convert_to(v_kind,'UTF8'))::TEXT||':'||v_kind,GREATEST(pg_catalog.octet_length(v_observation::TEXT)::NUMERIC,pg_catalog.octet_length(p_captured)::NUMERIC));
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" cl JOIN public."Pro262CapacityObserverInputReservation" sl ON sl."reservationId"=cl."reservationId" WHERE cl."inputClaimId"=p_input_claim_id AND sl."observerTrustId"=v_observation->>'trustId' AND sl."observerTrustGeneration"::TEXT=v_observation->>'observerGeneration') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityObserverInputClaim" claim JOIN public."Pro262CapacityObserverInputReservation" slot ON slot."reservationId"=claim."reservationId" WHERE claim."inputClaimId"=p_input_claim_id AND slot."record"->>'targetControlKey'=control_key AND slot."record"->>'targetKind'=v_kind ) THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF p_captured IS NULL OR pg_catalog.octet_length(p_captured)=0 OR pg_catalog.convert_from(p_captured,'UTF8')::JSONB IS DISTINCT FROM v_observation THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF pg_catalog.jsonb_typeof(v_observation) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(v_observation))<>13 OR NOT (v_observation ?& ARRAY['controlKey','kind','outcome','expectedPrincipal','host','boot','processTree','pid','backendStart','observerGeneration','trustId','traceId','evidence']) OR v_observation->>'controlKey' IS DISTINCT FROM control_key OR v_observation->>'kind' IS DISTINCT FROM v_kind OR COALESCE(v_observation->>'traceId','')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;

 SELECT * INTO c FROM public."Pro262CapacityControlReservation" x WHERE x."controlKey"=control_key FOR SHARE NOWAIT;
 IF NOT FOUND OR c."state" NOT IN ('DRAINING','QUARANTINED') THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Pro262CapacityControlCharge" charge JOIN public."Pro262CapacityControlBaseline" b ON b."kind"=charge."kind" WHERE charge."kind"='CONTROL_RESERVATION' AND charge."eventKey"=c."controlKey" AND b."coverageContract"='principal-launch-and-closed-scope-v2' AND pg_catalog.octet_length(v_observation::TEXT)::NUMERIC<=b."maxClosedScopeBytes") THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 v_generation:=(v_observation->>'observerGeneration')::BIGINT;evidence_bytes:=pg_catalog.decode(v_observation->>'evidence','base64');IF v_generation<=0 OR pg_catalog.octet_length(evidence_bytes)=0 THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO i FROM public."Pro262CapacityConnectionIntent" x WHERE x."controlKey"=control_key AND x."kind"=v_kind FOR UPDATE NOWAIT;
 IF NOT FOUND OR v_observation->>'expectedPrincipal' IS DISTINCT FROM i."expectedPrincipal"::TEXT THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO t FROM public."Pro262CapacityTrust" x WHERE x."trustId"=v_observation->>'trustId' AND x."generation"=v_generation FOR SHARE NOWAIT;
 IF NOT FOUND OR t."purpose"<>'CLEANUP_OBSERVATION' OR t."revoked" OR t."supplierPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR t."validFrom">pg_catalog.clock_timestamp() OR t."validUntil"<=pg_catalog.clock_timestamp() OR t."scope"->>'host' IS DISTINCT FROM v_observation->>'host' OR t."scope"->>'boot' IS DISTINCT FROM v_observation->>'boot' OR COALESCE(v_observation->>'processTree','')='' THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 SELECT * INTO prior FROM public."Pro262CapacityConnectionObservation" x WHERE x."controlKey"=control_key AND x."kind"=v_kind;
 IF FOUND THEN IF prior."inputClaimId" IS DISTINCT FROM p_input_claim_id OR prior."captured" IS DISTINCT FROM p_captured OR prior."observerPrincipal" IS DISTINCT FROM SESSION_USER::NAME OR prior."observerTrustId" IS DISTINCT FROM t."trustId" OR prior."observerGeneration" IS DISTINCT FROM t."generation" OR prior."observation" IS DISTINCT FROM v_observation OR prior."evidence" IS DISTINCT FROM evidence_bytes THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;RETURN; END IF;
 IF v_observation->>'outcome'='NEVER_OPENED' THEN
  IF i."state"<>'OPENING' OR v_observation->'pid' IS DISTINCT FROM 'null'::JSONB OR v_observation->'backendStart' IS DISTINCT FROM 'null'::JSONB THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
  UPDATE public."Pro262CapacityConnectionIntent" x SET "state"='NEVER_OPENED',"observerTrustId"=t."trustId","observerGeneration"=t."generation","observerPrincipal"=SESSION_USER::NAME,"observation"=v_observation,"evidence"=evidence_bytes WHERE x."controlKey"=control_key AND x."kind"=v_kind;
 ELSIF v_observation->>'outcome'='BOUND' THEN
  v_pid:=(v_observation->>'pid')::INTEGER;started:=(v_observation->>'backendStart')::TIMESTAMPTZ;
  PERFORM public.pro262_capacity_bind_connection(control_key,v_kind,i."expectedPrincipal",v_pid,started,v_observation->>'host',v_observation->>'boot',v_observation->>'processTree');
 ELSE RAISE EXCEPTION 'CAPACITY_UNAVAILABLE'; END IF;
 INSERT INTO public."Pro262CapacityConnectionObservation"("controlKey","kind","observerTrustId","observerGeneration","observerPrincipal","observation","captured","capturedHash","inputClaimId","evidence") VALUES(control_key,v_kind,t."trustId",t."generation",SESSION_USER::NAME,v_observation,p_captured,pg_catalog.encode(int4_crypto.digest(p_captured,'sha256'),'hex'),p_input_claim_id,evidence_bytes);
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'CAPACITY_UNAVAILABLE';
END $$;

ALTER TABLE public."Pro262CapacityCleanupReceipt" ADD CONSTRAINT "Pro262CapacityCleanupReceipt_input_claim_fk" FOREIGN KEY ("inputClaimId") REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public."Pro262CapacityReplayCleanupReceipt" ADD CONSTRAINT "Pro262CapacityReplayCleanupReceipt_input_claim_fk" FOREIGN KEY ("inputClaimId") REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public."Pro262CapacityControlCleanupReceipt" ADD CONSTRAINT "Pro262CapacityControlCleanupReceipt_input_claim_fk" FOREIGN KEY ("inputClaimId") REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public."Pro262CapacityConnectionObservation" ADD CONSTRAINT "Pro262CapacityConnectionObservation_input_claim_fk" FOREIGN KEY ("inputClaimId") REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE public."Pro262CapacityClosedScopeReceipt" ADD CONSTRAINT "Pro262CapacityClosedScopeReceipt_input_claim_fk" FOREIGN KEY ("inputClaimId") REFERENCES public."Pro262CapacityObserverInputClaim"("inputClaimId") ON UPDATE RESTRICT ON DELETE RESTRICT;
