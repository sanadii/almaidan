-- INT-5A additive draft. Unapplied: review and isolated rehearsal required.
BEGIN;
-- Roles are provisioned out of band; this migration never creates roles or grants function EXECUTE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='enta_runtime') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='enta_finance_executor') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='enta_outbox_worker') THEN
    RAISE EXCEPTION 'INT-5A requires audited runtime, finance executor, and outbox worker roles provisioned out of band';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('enta_runtime','enta_finance_executor','enta_outbox_worker') AND (rolcanlogin OR rolsuper OR rolcreaterole)) THEN
    RAISE EXCEPTION 'INT-5A role groups must be NOLOGIN, non-superuser, and non-creator roles';
  END IF;
  IF pg_has_role('enta_runtime','enta_finance_executor','member') OR pg_has_role('enta_runtime','enta_outbox_worker','member') OR pg_has_role('enta_finance_executor','enta_outbox_worker','member') OR pg_has_role('enta_outbox_worker','enta_finance_executor','member') THEN
    RAISE EXCEPTION 'INT-5A finance and outbox roles must not inherit one another';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public."Game" g
    LEFT JOIN public."LegacyUnpinnedGame" l ON l."gameId"=g."id"
    WHERE l."gameId" IS NULL
  ) THEN RAISE EXCEPTION 'INT-5A found Game rows outside the immutable legacy snapshot'; END IF;
END $$;

ALTER TABLE public."Game" ADD COLUMN "gameFormat" TEXT;
UPDATE public."Game" g SET "gameFormat"='LEGACY'
WHERE EXISTS (SELECT 1 FROM public."LegacyUnpinnedGame" l WHERE l."gameId"=g."id");
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public."Game" WHERE "gameFormat" IS NULL) THEN
    RAISE EXCEPTION 'INT-5A cannot classify every historical Game from the immutable legacy snapshot';
  END IF;
END $$;
ALTER TABLE public."Game" ALTER COLUMN "gameFormat" SET DEFAULT 'LEGACY';
ALTER TABLE public."Game" ALTER COLUMN "gameFormat" SET NOT NULL;
ALTER TABLE public."Game" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE public."GameQuestion" ALTER COLUMN "questionId" DROP NOT NULL;
ALTER TABLE public."Game"
  ADD COLUMN "firebaseIdentityId" TEXT,
  ADD COLUMN "admissionId" TEXT,
  ADD COLUMN "catalogReleaseRootHash" TEXT,
  ADD COLUMN "validationReceiptId" TEXT;

CREATE TABLE public."Wallet" (
  "id" TEXT PRIMARY KEY, "firebaseIdentityId" TEXT NOT NULL UNIQUE,
  "available" BIGINT NOT NULL DEFAULT 0 CHECK ("available">=0),
  "held" BIGINT NOT NULL DEFAULT 0 CHECK ("held">=0),
  "debt" BIGINT NOT NULL DEFAULT 0 CHECK ("debt">=0),
  "version" BIGINT NOT NULL DEFAULT 0 CHECK ("version">=0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("id","firebaseIdentityId"),
  CONSTRAINT "Wallet_identity_fkey" FOREIGN KEY("firebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT
);
CREATE TABLE public."Admission" (
  "id" TEXT PRIMARY KEY, "firebaseIdentityId" TEXT NOT NULL, "walletId" TEXT NOT NULL,
  "engine" TEXT NOT NULL CHECK ("engine"='ENTA'),
  "operation" TEXT NOT NULL CHECK ("operation"='PAID_ENTA_CLASSIC'), "mode" TEXT NOT NULL DEFAULT 'CLASSIC' CHECK ("mode"='CLASSIC'),
  "logicalMatchId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL CHECK ("requestHash" ~ '^[a-f0-9]{64}$'),
  "intentHash" TEXT NOT NULL CHECK ("intentHash" ~ '^[a-f0-9]{64}$'),
  "requestVersion" INTEGER NOT NULL CHECK ("requestVersion">0),
  "catalogReleaseId" TEXT NOT NULL, "releaseRootHash" TEXT NOT NULL,
  "validationReceiptId" TEXT NOT NULL, "selectorVersion" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'HELD' CHECK ("state" IN ('HELD','COMMITTED','RELEASED')),
  "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version">=0),
  "roomProjectId" TEXT, "roomId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("id","firebaseIdentityId"), UNIQUE("firebaseIdentityId","engine","logicalMatchId"),
  UNIQUE("firebaseIdentityId","requestKey"), UNIQUE("roomProjectId","roomId"),
  FOREIGN KEY("firebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT,
  FOREIGN KEY("walletId","firebaseIdentityId") REFERENCES public."Wallet"("id","firebaseIdentityId") ON DELETE RESTRICT,
  FOREIGN KEY("catalogReleaseId","releaseRootHash") REFERENCES public."CatalogRelease"("id","releaseRootHash") ON DELETE RESTRICT,
  FOREIGN KEY("validationReceiptId","catalogReleaseId","releaseRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT
);
CREATE TABLE public."Reservation" (
  "id" TEXT PRIMARY KEY, "admissionId" TEXT NOT NULL UNIQUE,
  "quantity" INTEGER NOT NULL DEFAULT 1 CHECK ("quantity"=1),
  "state" TEXT NOT NULL DEFAULT 'HELD' CHECK ("state" IN ('HELD','COMMITTED','RELEASED')),
  "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  FOREIGN KEY("admissionId") REFERENCES public."Admission"("id") ON DELETE RESTRICT
);
CREATE TABLE public."WalletEntry" (
  "id" TEXT PRIMARY KEY, "walletId" TEXT NOT NULL, "sequence" BIGINT NOT NULL,
  "originType" TEXT NOT NULL, "originId" TEXT NOT NULL,
  "effect" TEXT NOT NULL CHECK ("effect" IN ('FREE_FIRST_GRANT','RESERVE','COMMIT','RELEASE')),
  "reservationId" TEXT, "deltaAvailable" BIGINT NOT NULL, "deltaHeld" BIGINT NOT NULL, "deltaDebt" BIGINT NOT NULL,
  "resultingAvailable" BIGINT NOT NULL CHECK ("resultingAvailable">=0), "resultingHeld" BIGINT NOT NULL CHECK ("resultingHeld">=0), "resultingDebt" BIGINT NOT NULL CHECK ("resultingDebt">=0),
  "actorFirebaseIdentityId" TEXT, "evidenceHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("walletId","sequence"), UNIQUE("walletId","originType","originId","effect"), UNIQUE("reservationId","effect"),
  FOREIGN KEY("walletId") REFERENCES public."Wallet"("id") ON DELETE RESTRICT,
  FOREIGN KEY("reservationId") REFERENCES public."Reservation"("id") ON DELETE RESTRICT,
  FOREIGN KEY("actorFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT,
  CHECK (("effect"='FREE_FIRST_GRANT' AND "deltaAvailable"=1 AND "deltaHeld"=0 AND "deltaDebt"=0 AND "reservationId" IS NULL AND "actorFirebaseIdentityId" IS NOT NULL)
      OR ("effect"='RESERVE' AND "deltaAvailable"=-1 AND "deltaHeld"=1 AND "deltaDebt"=0 AND "reservationId" IS NOT NULL)
      OR ("effect"='COMMIT' AND "deltaAvailable"=0 AND "deltaHeld"=-1 AND "deltaDebt"=0 AND "reservationId" IS NOT NULL)
      OR ("effect"='RELEASE' AND "deltaAvailable"=1 AND "deltaHeld"=-1 AND "deltaDebt"=0 AND "reservationId" IS NOT NULL))
);
CREATE UNIQUE INDEX "WalletEntry_single_free_first_grant_key" ON public."WalletEntry"("walletId") WHERE "effect"='FREE_FIRST_GRANT';
CREATE UNIQUE INDEX "WalletEntry_free_first_grant_identity_key" ON public."WalletEntry"("actorFirebaseIdentityId") WHERE "effect"='FREE_FIRST_GRANT';
CREATE TABLE public."AdmissionEvent" (
  "id" TEXT PRIMARY KEY, "admissionId" TEXT NOT NULL, "sequence" BIGINT NOT NULL,
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('HELD','COMMITTED','RELEASED')),
  "evidenceHash" TEXT CHECK ("evidenceHash" IS NULL OR "evidenceHash" ~ '^[a-f0-9]{64}$'), "detailCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("admissionId","sequence"),
  FOREIGN KEY("admissionId") REFERENCES public."Admission"("id") ON DELETE RESTRICT
);
CREATE TABLE public."AdmissionOutbox" (
  "id" TEXT PRIMARY KEY, "admissionId" TEXT NOT NULL, "jobKind" TEXT NOT NULL, "transitionVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("state" IN ('PENDING','LEASED','DONE','FAILED')),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseOwner" TEXT, "leaseExpiresAt" TIMESTAMP(3),
  "leaseVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("leaseVersion">=0), "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK ("attemptCount">=0),
  "lastErrorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE("admissionId","jobKind","transitionVersion"), FOREIGN KEY("admissionId") REFERENCES public."Admission"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "Game_id_catalogReleaseId_key" ON public."Game"("id","catalogReleaseId");
CREATE TABLE public."GameCategoryPin" (
  "id" TEXT PRIMARY KEY, "gameId" TEXT NOT NULL, "catalogReleaseId" TEXT NOT NULL,
  "categoryKey" TEXT NOT NULL, "categoryRevisionId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL CHECK ("ordinal">=0),
  UNIQUE("gameId","ordinal"), UNIQUE("gameId","categoryKey"),
  FOREIGN KEY("gameId","catalogReleaseId") REFERENCES public."Game"("id","catalogReleaseId") ON DELETE RESTRICT,
  FOREIGN KEY("catalogReleaseId","categoryKey","categoryRevisionId") REFERENCES public."CatalogReleaseCategory"("catalogReleaseId","categoryKey","categoryRevisionId") ON DELETE RESTRICT
);

CREATE INDEX "WalletEntry_walletId_createdAt_idx" ON public."WalletEntry"("walletId","createdAt");
CREATE INDEX "Admission_walletId_state_idx" ON public."Admission"("walletId","state");
CREATE INDEX "AdmissionEvent_admissionId_createdAt_idx" ON public."AdmissionEvent"("admissionId","createdAt");
CREATE INDEX "AdmissionOutbox_state_availableAt_idx" ON public."AdmissionOutbox"("state","availableAt");
CREATE UNIQUE INDEX "Game_admissionId_firebaseIdentityId_key" ON public."Game"("admissionId","firebaseIdentityId");
CREATE UNIQUE INDEX "GameQuestion_gameId_questionRevisionId_key" ON public."GameQuestion"("gameId","questionRevisionId");
ALTER TABLE public."Game" ADD CONSTRAINT "Game_identity_fkey" FOREIGN KEY("firebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT;
ALTER TABLE public."Game" ADD CONSTRAINT "Game_admission_owner_fkey" FOREIGN KEY("admissionId","firebaseIdentityId") REFERENCES public."Admission"("id","firebaseIdentityId") ON DELETE RESTRICT;
ALTER TABLE public."Game" ADD CONSTRAINT "Game_receipt_release_root_fkey" FOREIGN KEY("validationReceiptId","catalogReleaseId","catalogReleaseRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT;
ALTER TABLE public."GameQuestion" ADD CONSTRAINT "GameQuestion_same_release_parent_fkey" FOREIGN KEY("gameId","catalogReleaseId") REFERENCES public."Game"("id","catalogReleaseId") ON DELETE RESTRICT;
ALTER TABLE public."GameQuestion" ADD CONSTRAINT "GameQuestion_same_release_membership_fkey" FOREIGN KEY("catalogReleaseId","questionRevisionId") REFERENCES public."CatalogReleaseQuestion"("catalogReleaseId","questionRevisionId") ON DELETE RESTRICT;
ALTER TABLE public."Game" ADD CONSTRAINT "Game_financial_format_check" CHECK (
  ("gameFormat"='LEGACY' AND "firebaseIdentityId" IS NULL AND "admissionId" IS NULL AND "validationReceiptId" IS NULL AND "catalogReleaseId" IS NULL AND "catalogReleaseRootHash" IS NULL)
  OR ("gameFormat"='FIREBASE_PINNED' AND "userId" IS NULL AND "firebaseIdentityId" IS NOT NULL AND "admissionId" IS NOT NULL AND "catalogReleaseId" IS NOT NULL AND "catalogReleaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL AND "mode"='CLASSIC')
);

-- New runtime logins receive no financial data or SQL function EXECUTE grants here.
REVOKE ALL ON public."Wallet", public."WalletEntry", public."Admission", public."Reservation", public."AdmissionEvent", public."AdmissionOutbox", public."GameCategoryPin" FROM PUBLIC;
REVOKE ALL ON public."Wallet", public."WalletEntry", public."Admission", public."Reservation", public."AdmissionEvent", public."AdmissionOutbox", public."GameCategoryPin" FROM enta_runtime;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public."Game", public."GameQuestion" FROM enta_runtime;

CREATE OR REPLACE FUNCTION public.int5a_reject_immutable_rows() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'INT-5A append-only relation rejects mutation' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.int5a_validate_wallet_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE w public."Wallet"%ROWTYPE; reservation_wallet TEXT; reservation_admission TEXT; reservation_state TEXT; admission_state TEXT;
BEGIN
 SELECT * INTO w FROM public."Wallet" WHERE "id"=NEW."walletId" FOR UPDATE;
 IF NOT FOUND OR NEW."sequence"<>w."version"+1 OR NEW."resultingAvailable"<>w."available"+NEW."deltaAvailable" OR NEW."resultingHeld"<>w."held"+NEW."deltaHeld" OR NEW."resultingDebt"<>w."debt"+NEW."deltaDebt" THEN RAISE EXCEPTION 'wallet sequence/result mismatch'; END IF;
 IF NEW."reservationId" IS NOT NULL THEN
  SELECT a."walletId",a."id",r."state",a."state" INTO reservation_wallet,reservation_admission,reservation_state,admission_state FROM public."Reservation" r JOIN public."Admission" a ON a."id"=r."admissionId" WHERE r."id"=NEW."reservationId";
  IF reservation_wallet IS DISTINCT FROM NEW."walletId" OR NEW."originType"<>'ADMISSION' OR NEW."originId" IS DISTINCT FROM reservation_admission THEN RAISE EXCEPTION 'reservation wallet or ledger origin mismatch'; END IF;
  IF NEW."effect"='RESERVE' AND (reservation_state<>'HELD' OR admission_state<>'HELD') THEN RAISE EXCEPTION 'reserve effect requires a new held admission'; END IF;
  IF NEW."effect"='RESERVE' AND w."debt">0 THEN RAISE EXCEPTION 'wallet debt blocks reservation'; END IF;
  IF NEW."effect" IN ('COMMIT','RELEASE') AND (reservation_state<>'HELD' OR admission_state<>'HELD' OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" e WHERE e."reservationId"=NEW."reservationId" AND e."effect"='RESERVE') OR EXISTS(SELECT 1 FROM public."WalletEntry" e WHERE e."reservationId"=NEW."reservationId" AND e."effect" IN ('COMMIT','RELEASE'))) THEN RAISE EXCEPTION 'terminal effect requires one unsettled held reservation'; END IF;
 ELSIF NEW."effect"='FREE_FIRST_GRANT' THEN
  IF NEW."originType"<>'FREE_FIRST_GRANT' OR NEW."originId"<>w."firebaseIdentityId" OR NEW."actorFirebaseIdentityId" IS DISTINCT FROM w."firebaseIdentityId" THEN RAISE EXCEPTION 'initial grant origin must be the wallet owner identity'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_wallet_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF NEW."available"<>0 OR NEW."held"<>0 OR NEW."debt"<>0 OR NEW."version"<>0 THEN RAISE EXCEPTION 'wallets must begin at zero; balances require ledger entries'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_wallet_reconcile_at_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE w public."Wallet"%ROWTYPE; last_entry public."WalletEntry"%ROWTYPE;
BEGIN
 SELECT * INTO w FROM public."Wallet" WHERE "id"=NEW."walletId";
 SELECT * INTO last_entry FROM public."WalletEntry" WHERE "walletId"=NEW."walletId" ORDER BY "sequence" DESC LIMIT 1;
 IF NOT FOUND THEN
  IF w."version"<>0 OR w."available"<>0 OR w."held"<>0 OR w."debt"<>0 THEN RAISE EXCEPTION 'wallet without entries must remain zero'; END IF;
 ELSIF w."version"<>last_entry."sequence" OR (w."available",w."held",w."debt") IS DISTINCT FROM (last_entry."resultingAvailable",last_entry."resultingHeld",last_entry."resultingDebt") THEN
  RAISE EXCEPTION 'wallet counters must reconcile to the latest immutable entry';
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_wallet_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF NEW."firebaseIdentityId" IS DISTINCT FROM OLD."firebaseIdentityId" THEN RAISE EXCEPTION 'wallet owner is immutable'; END IF;
 IF (NEW."available",NEW."held",NEW."debt",NEW."version") IS DISTINCT FROM (OLD."available",OLD."held",OLD."debt",OLD."version") THEN
  IF NOT pg_has_role(current_user,'enta_finance_executor','member') THEN RAISE EXCEPTION 'wallet balance updates require restricted financial operation'; END IF;
  IF NEW."version"<>OLD."version"+1 OR NOT EXISTS (SELECT 1 FROM public."WalletEntry" e WHERE e."walletId"=NEW."id" AND e."sequence"=NEW."version" AND e."resultingAvailable"=NEW."available" AND e."resultingHeld"=NEW."held" AND e."resultingDebt"=NEW."debt") THEN RAISE EXCEPTION 'wallet update must match ledger entry'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_identity_owner_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF (NEW."firebaseProjectId",NEW."firebaseUid") IS DISTINCT FROM (OLD."firebaseProjectId",OLD."firebaseUid") AND (EXISTS(SELECT 1 FROM public."Wallet" WHERE "firebaseIdentityId"=OLD."id") OR EXISTS(SELECT 1 FROM public."Admission" WHERE "firebaseIdentityId"=OLD."id")) THEN RAISE EXCEPTION 'Firebase identity tuple is immutable after financial ownership exists'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_admission_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'admissions are immutable history'; END IF;
 IF (NEW."firebaseIdentityId",NEW."walletId",NEW."engine",NEW."operation",NEW."logicalMatchId",NEW."requestKey",NEW."requestHash",NEW."intentHash",NEW."requestVersion",NEW."catalogReleaseId",NEW."releaseRootHash",NEW."validationReceiptId",NEW."selectorVersion") IS DISTINCT FROM (OLD."firebaseIdentityId",OLD."walletId",OLD."engine",OLD."operation",OLD."logicalMatchId",OLD."requestKey",OLD."requestHash",OLD."intentHash",OLD."requestVersion",OLD."catalogReleaseId",OLD."releaseRootHash",OLD."validationReceiptId",OLD."selectorVersion") THEN RAISE EXCEPTION 'admission owner and intent are immutable'; END IF;
 IF NOT pg_has_role(current_user,'enta_finance_executor','member') OR OLD."state" IN ('COMMITTED','RELEASED') OR NEW."version"<>OLD."version"+1 OR NOT (OLD."state"='HELD' AND NEW."state" IN ('COMMITTED','RELEASED')) THEN RAISE EXCEPTION 'invalid restricted admission transition'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_reservation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."admissionId" IS DISTINCT FROM OLD."admissionId" OR NEW."quantity"<>1 OR NOT pg_has_role(current_user,'enta_finance_executor','member') OR OLD."state"<>'HELD' OR NEW."state" NOT IN ('COMMITTED','RELEASED') THEN RAISE EXCEPTION 'invalid restricted reservation transition'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_admission_consistency_at_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE admission_id TEXT; a public."Admission"%ROWTYPE; r public."Reservation"%ROWTYPE; reserve_count INTEGER; commit_count INTEGER; release_count INTEGER;
BEGIN
 -- Any write that could change one side of the reservation invariant schedules
 -- this same final-row check. It intentionally takes no row locks: financial
 -- writers acquire Wallet first, so deferred validation must not invert that order.
 IF TG_TABLE_NAME='Admission' THEN
  admission_id := NEW."id";
 ELSIF TG_TABLE_NAME='Reservation' THEN
  admission_id := NEW."admissionId";
 ELSIF TG_TABLE_NAME='WalletEntry' THEN
  IF NEW."reservationId" IS NULL THEN RETURN NULL; END IF;
  SELECT reservation_lookup."admissionId" INTO admission_id FROM public."Reservation" reservation_lookup WHERE reservation_lookup."id"=NEW."reservationId";
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation-backed wallet entry lost its reservation before deferred validation'; END IF;
 ELSE
  RAISE EXCEPTION 'unexpected source relation for admission consistency validation';
 END IF;

 SELECT * INTO a FROM public."Admission" WHERE "id"=admission_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'admission must remain present through deferred validation'; END IF;
 SELECT * INTO r FROM public."Reservation" WHERE "admissionId"=a."id";
 IF NOT FOUND OR r."quantity"<>1 OR r."state" IS DISTINCT FROM a."state" THEN RAISE EXCEPTION 'admission and reservation states must agree'; END IF;
 SELECT count(*) FILTER(WHERE e."effect"='RESERVE'), count(*) FILTER(WHERE e."effect"='COMMIT'), count(*) FILTER(WHERE e."effect"='RELEASE')
 INTO reserve_count,commit_count,release_count FROM public."WalletEntry" e WHERE e."reservationId"=r."id";
 IF reserve_count<>1 OR (a."state"='HELD' AND (commit_count<>0 OR release_count<>0)) OR
    (a."state"='COMMITTED' AND (commit_count<>1 OR release_count<>0)) OR
    (a."state"='RELEASED' AND (commit_count<>0 OR release_count<>1)) THEN RAISE EXCEPTION 'admission state must have exactly one matching wallet effect'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."admissionId" IS DISTINCT FROM OLD."admissionId" OR NEW."jobKind" IS DISTINCT FROM OLD."jobKind" OR NEW."transitionVersion" IS DISTINCT FROM OLD."transitionVersion" OR NOT pg_has_role(current_user,'enta_outbox_worker','member') OR NEW."leaseVersion" NOT IN (OLD."leaseVersion",OLD."leaseVersion"+1) OR OLD."state" IN ('DONE','FAILED') THEN RAISE EXCEPTION 'invalid fenced outbox update'; END IF;
 RETURN NEW;
END $$;

-- Fail closed while the independently reviewed R3-E receipt policy is absent.
-- A later migration may replace this function only after exact policy review.
CREATE OR REPLACE FUNCTION public.int4_game_pin_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE parent public."Game"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Game' THEN
  IF TG_OP='INSERT' THEN
   IF NEW."gameFormat"<>'FIREBASE_PINNED' OR NEW."userId" IS NOT NULL THEN RAISE EXCEPTION 'new games require Firebase pinned format'; END IF;
   RAISE EXCEPTION 'catalog receipt policy is not approved for paid start';
  END IF;
  IF (NEW."gameFormat",NEW."firebaseIdentityId",NEW."admissionId",NEW."catalogReleaseId",NEW."catalogReleaseRootHash",NEW."validationReceiptId",NEW."userId",NEW."mode") IS DISTINCT FROM (OLD."gameFormat",OLD."firebaseIdentityId",OLD."admissionId",OLD."catalogReleaseId",OLD."catalogReleaseRootHash",OLD."validationReceiptId",OLD."userId",OLD."mode") THEN RAISE EXCEPTION 'game owner, mode and content pins are immutable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  SELECT * INTO parent FROM public."Game" WHERE "id"=OLD."gameId" FOR UPDATE;
  IF parent."gameFormat"='FIREBASE_PINNED' THEN RAISE EXCEPTION 'pinned game question membership is immutable'; END IF;
  RETURN OLD;
 END IF;
 SELECT * INTO parent FROM public."Game" WHERE "id"=NEW."gameId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'game parent missing'; END IF;
 IF TG_OP='UPDATE' AND (NEW."gameId",NEW."catalogReleaseId",NEW."questionRevisionId",NEW."questionId") IS DISTINCT FROM (OLD."gameId",OLD."catalogReleaseId",OLD."questionRevisionId",OLD."questionId") THEN RAISE EXCEPTION 'game question ownership and pins are immutable'; END IF;
 IF parent."gameFormat"='LEGACY' THEN
  IF NEW."questionId" IS NULL OR NEW."catalogReleaseId" IS NOT NULL OR NEW."questionRevisionId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."LegacyUnpinnedGame" WHERE "gameId"=NEW."gameId") THEN RAISE EXCEPTION 'legacy question ID required; null pins allowed only for snapshotted historical game IDs'; END IF;
 ELSE
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=parent."admissionId" AND a."firebaseIdentityId"=parent."firebaseIdentityId" AND a."state"='HELD') THEN RAISE EXCEPTION 'pinned game questions may be added only while admission is held'; END IF;
  IF NEW."catalogReleaseId" IS DISTINCT FROM parent."catalogReleaseId" OR NEW."questionRevisionId" IS NULL OR NEW."questionId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevisionSeal" s ON s."questionRevisionId"=m."questionRevisionId" AND s."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=parent."catalogReleaseId" AND m."questionRevisionId"=NEW."questionRevisionId") THEN RAISE EXCEPTION 'pinned question must match same-release sealed membership'; END IF;
 END IF;
 IF NEW."answeredByTeamId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Team" t WHERE t."id"=NEW."answeredByTeamId" AND t."gameId"=NEW."gameId") THEN RAISE EXCEPTION 'answering team must belong to same game'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW."alsoCorrectTeamIds") AS x(id) WHERE NOT EXISTS(SELECT 1 FROM public."Team" t WHERE t."id"=x.id AND t."gameId"=NEW."gameId")) THEN RAISE EXCEPTION 'credited teams must belong to same game'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_game_category_pin_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE parent public."Game"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'ordered category pins are immutable'; END IF;
 SELECT * INTO parent FROM public."Game" WHERE "id"=NEW."gameId" FOR UPDATE;
 IF NOT FOUND OR parent."gameFormat"<>'FIREBASE_PINNED' OR parent."catalogReleaseId" IS DISTINCT FROM NEW."catalogReleaseId" THEN RAISE EXCEPTION 'category pin does not match Firebase pinned game'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=parent."admissionId" AND a."firebaseIdentityId"=parent."firebaseIdentityId" AND a."state"='HELD') THEN RAISE EXCEPTION 'category pins may be added only while admission is held'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_game_legacy_category_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."Game" g WHERE g."id"=NEW."gameId" AND g."gameFormat"='FIREBASE_PINNED') THEN RAISE EXCEPTION 'pinned game cannot use legacy GameCategory'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_team_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM public."Game" WHERE "id"=OLD."gameId" AND "gameFormat"='FIREBASE_PINNED') THEN RAISE EXCEPTION 'pinned game teams cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND NEW."gameId" IS DISTINCT FROM OLD."gameId" AND EXISTS(SELECT 1 FROM public."Game" WHERE "id"=OLD."gameId" AND "gameFormat"='FIREBASE_PINNED') THEN RAISE EXCEPTION 'pinned game team ownership is immutable'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.int5a_game_start_completeness() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE g public."Game"%ROWTYPE; a public."Admission"%ROWTYPE; reservation_state TEXT; pin_count INTEGER; q_count INTEGER;
BEGIN
 SELECT * INTO g FROM public."Game" WHERE "id"=NEW."id";
 IF g."gameFormat"<>'FIREBASE_PINNED' THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=g."admissionId" AND "firebaseIdentityId"=g."firebaseIdentityId";
 IF NOT FOUND OR a."state"<>'COMMITTED' OR a."operation"<>'PAID_ENTA_CLASSIC' OR a."catalogReleaseId"<>g."catalogReleaseId" OR a."releaseRootHash"<>g."catalogReleaseRootHash" OR a."validationReceiptId"<>g."validationReceiptId" THEN
  RAISE EXCEPTION 'new game requires same-owner committed admission and exact pins';
 END IF;
 SELECT r."state" INTO reservation_state FROM public."Reservation" r WHERE r."admissionId"=a."id";
 IF reservation_state IS DISTINCT FROM 'COMMITTED' OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" e JOIN public."Reservation" r ON r."id"=e."reservationId" WHERE r."admissionId"=a."id" AND e."effect"='RESERVE') OR NOT EXISTS(SELECT 1 FROM public."WalletEntry" e JOIN public."Reservation" r ON r."id"=e."reservationId" WHERE r."admissionId"=a."id" AND e."effect"='COMMIT') THEN
  RAISE EXCEPTION 'committed start requires matching reservation and ledger effects';
 END IF;
 IF EXISTS(SELECT 1 FROM public."GameCategory" WHERE "gameId"=g."id") THEN RAISE EXCEPTION 'pinned game cannot contain legacy category rows'; END IF;
 SELECT count(*) INTO pin_count FROM public."GameCategoryPin" WHERE "gameId"=g."id";
 IF pin_count=0 OR EXISTS(SELECT 1 FROM generate_series(0,pin_count-1) n WHERE NOT EXISTS(SELECT 1 FROM public."GameCategoryPin" p WHERE p."gameId"=g."id" AND p."ordinal"=n)) THEN RAISE EXCEPTION 'ordered category pins must be complete'; END IF;
 IF (SELECT count(*) FROM public."Team" WHERE "gameId"=g."id")<2 THEN RAISE EXCEPTION 'pinned game needs at least two teams'; END IF;
 SELECT count(*) INTO q_count FROM public."GameQuestion" WHERE "gameId"=g."id" AND "catalogReleaseId"=g."catalogReleaseId";
 IF q_count<>pin_count*6 THEN RAISE EXCEPTION 'CLASSIC game requires six pinned questions per category'; END IF;
 IF EXISTS (SELECT 1 FROM public."GameCategoryPin" p CROSS JOIN (VALUES ('200'),('400'),('600')) t(tier)
   WHERE p."gameId"=g."id" AND NOT EXISTS (SELECT 1 FROM public."CatalogReleaseAvailability" availability_row WHERE availability_row."catalogReleaseId"=g."catalogReleaseId" AND availability_row."categoryKey"=p."categoryKey" AND availability_row."engine"='ENTA' AND availability_row."mode"='CLASSIC' AND availability_row."modality"='classic' AND availability_row."tier"=t.tier)) THEN
  RAISE EXCEPTION 'release must seal all three supported CLASSIC availability tiers per category';
 END IF;
 IF EXISTS (
   SELECT 1 FROM public."GameCategoryPin" p CROSS JOIN (VALUES ('200',200),('400',400),('600',600)) t(tier,points)
   LEFT JOIN LATERAL (SELECT count(*) n, count(DISTINCT q."sourceQuestionId") sources,
     count(*) FILTER (WHERE EXISTS(SELECT 1 FROM public."QuestionRevisionMedia" m WHERE m."questionRevisionId"=q."id")) media_count
     FROM public."GameQuestion" gq JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=gq."catalogReleaseId" AND m."questionRevisionId"=gq."questionRevisionId" AND m."categoryKey"=p."categoryKey"
     JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId"
     WHERE gq."gameId"=g."id" AND q."engine"='ENTA' AND q."mode"='CLASSIC' AND q."modality"='classic' AND q."tier"=t.tier AND q."points"=t.points) selected ON TRUE
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

CREATE TRIGGER "Wallet_update_guard" BEFORE UPDATE ON public."Wallet" FOR EACH ROW EXECUTE FUNCTION public.int5a_wallet_update_guard();
CREATE TRIGGER "Wallet_insert_zero_only" BEFORE INSERT ON public."Wallet" FOR EACH ROW EXECUTE FUNCTION public.int5a_wallet_insert_guard();
CREATE TRIGGER "WalletEntry_validate" BEFORE INSERT ON public."WalletEntry" FOR EACH ROW EXECUTE FUNCTION public.int5a_validate_wallet_entry();
CREATE CONSTRAINT TRIGGER "WalletEntry_reconcile_at_commit" AFTER INSERT ON public."WalletEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5a_wallet_reconcile_at_commit();
CREATE TRIGGER "WalletEntry_immutable" BEFORE UPDATE OR DELETE ON public."WalletEntry" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "WalletEntry_no_truncate" BEFORE TRUNCATE ON public."WalletEntry" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "Admission_transition_guard" BEFORE UPDATE OR DELETE ON public."Admission" FOR EACH ROW EXECUTE FUNCTION public.int5a_admission_guard();
CREATE CONSTRAINT TRIGGER "Admission_consistency_at_commit" AFTER INSERT OR UPDATE ON public."Admission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5a_admission_consistency_at_commit();
CREATE CONSTRAINT TRIGGER "Reservation_consistency_at_commit" AFTER INSERT OR UPDATE ON public."Reservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5a_admission_consistency_at_commit();
CREATE CONSTRAINT TRIGGER "WalletEntry_admission_consistency_at_commit" AFTER INSERT ON public."WalletEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5a_admission_consistency_at_commit();
CREATE TRIGGER "AdmissionEvent_immutable" BEFORE UPDATE OR DELETE ON public."AdmissionEvent" FOR EACH ROW EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "AdmissionEvent_no_truncate" BEFORE TRUNCATE ON public."AdmissionEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.int5a_reject_immutable_rows();
CREATE TRIGGER "Reservation_transition_guard" BEFORE UPDATE OR DELETE ON public."Reservation" FOR EACH ROW EXECUTE FUNCTION public.int5a_reservation_guard();
CREATE TRIGGER "AdmissionOutbox_fenced_update" BEFORE UPDATE OR DELETE ON public."AdmissionOutbox" FOR EACH ROW EXECUTE FUNCTION public.int5a_outbox_guard();
CREATE TRIGGER "FirebaseIdentity_financial_owner_guard" BEFORE UPDATE ON public."FirebaseIdentity" FOR EACH ROW EXECUTE FUNCTION public.int5a_identity_owner_guard();
CREATE TRIGGER "Game_financial_pin_update_guard" BEFORE UPDATE ON public."Game" FOR EACH ROW EXECUTE FUNCTION public.int4_game_pin_guard();
CREATE TRIGGER "GameQuestion_financial_update_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."GameQuestion" FOR EACH ROW EXECUTE FUNCTION public.int4_game_pin_guard();
CREATE TRIGGER "GameCategoryPin_immutable_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."GameCategoryPin" FOR EACH ROW EXECUTE FUNCTION public.int5a_game_category_pin_guard();
CREATE TRIGGER "GameCategory_legacy_only" BEFORE INSERT OR UPDATE ON public."GameCategory" FOR EACH ROW EXECUTE FUNCTION public.int5a_game_legacy_category_guard();
CREATE TRIGGER "Team_pinned_game_binding" BEFORE UPDATE OR DELETE ON public."Team" FOR EACH ROW EXECUTE FUNCTION public.int5a_team_binding_guard();
CREATE CONSTRAINT TRIGGER "Game_financial_start_completeness" AFTER INSERT ON public."Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.int5a_game_start_completeness();

REVOKE ALL ON FUNCTION public.int5a_reject_immutable_rows(), public.int5a_validate_wallet_entry(), public.int5a_wallet_insert_guard(), public.int5a_wallet_reconcile_at_commit(), public.int5a_wallet_update_guard(), public.int5a_identity_owner_guard(), public.int5a_admission_guard(), public.int5a_admission_consistency_at_commit(), public.int5a_reservation_guard(), public.int5a_outbox_guard(), public.int4_game_pin_guard(), public.int5a_game_category_pin_guard(), public.int5a_game_legacy_category_guard(), public.int5a_team_binding_guard(), public.int5a_game_start_completeness() FROM PUBLIC;
COMMIT;
