-- ENG03-02 candidate R2. Output-only; do not apply before exact reviews and Root release.
-- Legacy replacements are generated from the pinned source bytes by splice_legacy().
BEGIN;

-- int4_crypto is an existing qualified dependency. No extension is installed here.

CREATE TABLE public."HuroofIdentityPolicyRevision" (
  "namespace" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK ("revision">0),
  "policyHash" TEXT NOT NULL CHECK ("policyHash" ~ '^[a-f0-9]{64}$'), "rawPolicy" BYTEA NOT NULL,
  "firebaseProjectId" TEXT NOT NULL, "audience" JSONB NOT NULL, "issuer" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","revision"),
  UNIQUE("namespace","revision","policyHash"), FOREIGN KEY("namespace") REFERENCES public."DeploymentNamespace"("namespaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (octet_length("rawPolicy")>0), CHECK (jsonb_typeof("audience")='object'),
  CHECK (encode(int4_crypto.digest("rawPolicy",'sha256'),'hex')="policyHash")
);
CREATE TABLE public."HuroofIdentityPolicyHead" (
  "namespace" TEXT PRIMARY KEY, "revision" BIGINT NOT NULL, "policyHash" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE("namespace","revision","policyHash"),
  FOREIGN KEY("namespace","revision","policyHash") REFERENCES public."HuroofIdentityPolicyRevision"("namespace","revision","policyHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofRoom" (
  "namespace" TEXT NOT NULL, "id" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL,
  "generation" BIGINT NOT NULL DEFAULT 1 CHECK("generation">0), "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "status" TEXT NOT NULL DEFAULT 'SETUP' CHECK("status" IN ('SETUP','ACTIVE','CLOSED')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","id"), UNIQUE("namespace","id","ownerFirebaseIdentityId"),
  FOREIGN KEY("ownerFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofLocator" (
  "namespace" TEXT NOT NULL, "code" TEXT NOT NULL, "roomId" TEXT NOT NULL, "generation" INTEGER NOT NULL DEFAULT 2 CHECK("generation"=2),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","code"), UNIQUE("namespace","roomId"),
  CHECK("code" ~ '^[A-Za-z0-9]{8}$'), FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofMember" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "firebaseIdentityId" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK("role" IN ('OWNER','MEMBER')), "generation" BIGINT NOT NULL DEFAULT 1 CHECK("generation">0),
  "revokedAt" TIMESTAMPTZ(3), "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","roomId","firebaseIdentityId"), UNIQUE("namespace","roomId","firebaseIdentityId","generation"),
  FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("firebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofParticipant" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "id" TEXT NOT NULL, "memberFirebaseIdentityId" TEXT,
  "displayName" TEXT NOT NULL, "team" TEXT NOT NULL, "ordinal" INTEGER NOT NULL CHECK("ordinal">=0), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","roomId","id"), UNIQUE("namespace","roomId","ordinal"),
  FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","memberFirebaseIdentityId") REFERENCES public."HuroofMember"("namespace","roomId","firebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT
);

ALTER TABLE public."Admission" ADD COLUMN "storageAuthority" TEXT NOT NULL DEFAULT 'LEGACY_PROTOCOL_V1';
ALTER TABLE public."Admission" ADD CONSTRAINT "Admission_storage_authority_check" CHECK("storageAuthority" IN ('LEGACY_PROTOCOL_V1','PG_HUROOF_V2'));
CREATE TABLE public."HuroofMatch" (
  "namespace" TEXT NOT NULL, "id" TEXT NOT NULL, "roomId" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL UNIQUE, "profile" JSONB NOT NULL, "profileRawArtifactId" TEXT NOT NULL, "profileHash" TEXT NOT NULL CHECK("profileHash" ~ '^[a-f0-9]{64}$'),
  "config" JSONB NOT NULL, "configHash" TEXT NOT NULL CHECK("configHash" ~ '^[a-f0-9]{64}$'),
  "rawIntent" BYTEA NOT NULL, "rawIntentHash" TEXT NOT NULL CHECK("rawIntentHash" ~ '^[a-f0-9]{64}$'),
  "policyRevision" BIGINT NOT NULL, "policyHash" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "state" TEXT NOT NULL DEFAULT 'STARTED' CHECK("state" IN ('STARTED','ACTIVE','FINISHED','ABANDONED')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","id"),
  UNIQUE("namespace","id","ownerFirebaseIdentityId"), UNIQUE("namespace","roomId","id"), UNIQUE("namespace","id","roomId"), UNIQUE("namespace","id","roomId","ownerFirebaseIdentityId"), UNIQUE("namespace","roomId","id","ownerFirebaseIdentityId"), UNIQUE("namespace","id","roomId","ownerFirebaseIdentityId","admissionId"),
  FOREIGN KEY("namespace","roomId","ownerFirebaseIdentityId") REFERENCES public."HuroofRoom"("namespace","id","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("admissionId","ownerFirebaseIdentityId") REFERENCES public."Admission"("id","firebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","policyRevision","policyHash") REFERENCES public."HuroofIdentityPolicyRevision"("namespace","revision","policyHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(octet_length("rawIntent")>0)
);
CREATE TABLE public."HuroofMatchPin" (
  "namespace" TEXT NOT NULL, "matchId" TEXT NOT NULL, "validationReceiptId" TEXT NOT NULL, "catalogReleaseId" TEXT NOT NULL,
  "profileScope" TEXT NOT NULL, "profileFamily" TEXT NOT NULL, "profileSourceId" TEXT NOT NULL, "profileRevision" BIGINT NOT NULL, "profileRawArtifactId" TEXT NOT NULL, "profileRawArtifactHash" TEXT NOT NULL,
  "releaseRootHash" TEXT NOT NULL, "catalogSealHash" TEXT NOT NULL, "sourceRef" TEXT NOT NULL, "rawRefs" JSONB NOT NULL,
  "selector" JSONB NOT NULL, "config" JSONB NOT NULL, "profile" JSONB NOT NULL, PRIMARY KEY("namespace","matchId"),
  FOREIGN KEY("namespace","matchId") REFERENCES public."HuroofMatch"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("validationReceiptId","catalogReleaseId","releaseRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofCanonicalState" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL, "activeMatchId" TEXT,
  "status" TEXT NOT NULL CHECK("status" IN ('SETUP','ACTIVE','FINISHED','CLOSED')), "revision" BIGINT NOT NULL DEFAULT 0 CHECK("revision">=0),
  "sequence" BIGINT NOT NULL DEFAULT 0 CHECK("sequence">=0), "privateState" JSONB NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","roomId"), FOREIGN KEY("namespace","roomId","ownerFirebaseIdentityId") REFERENCES public."HuroofRoom"("namespace","id","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","activeMatchId","ownerFirebaseIdentityId") REFERENCES public."HuroofMatch"("namespace","roomId","id","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofCommandReceipt" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "actorFirebaseIdentityId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "matchId" TEXT NOT NULL,
  "intent" BYTEA NOT NULL, "intentHash" TEXT NOT NULL CHECK("intentHash" ~ '^[a-f0-9]{64}$'), "outcome" BYTEA NOT NULL, "outcomeHash" TEXT NOT NULL CHECK("outcomeHash" ~ '^[a-f0-9]{64}$'),
  "resultingRevision" BIGINT NOT NULL CHECK("resultingRevision">=0), "resultingSequence" BIGINT NOT NULL CHECK("resultingSequence">=0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","roomId","actorFirebaseIdentityId","requestKey"),
  FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","matchId") REFERENCES public."HuroofMatch"("namespace","roomId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("actorFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(octet_length("intent")>0 AND octet_length("outcome")>0),
  CHECK(encode(int4_crypto.digest("intent",'sha256'),'hex')="intentHash"),
  CHECK(encode(int4_crypto.digest("outcome",'sha256'),'hex')="outcomeHash")
);
CREATE TABLE public."HuroofEvent" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "sequence" BIGINT NOT NULL CHECK("sequence">0), "id" TEXT NOT NULL UNIQUE,
  "matchId" TEXT, "actorFirebaseIdentityId" TEXT, "requestKey" TEXT, "revision" BIGINT NOT NULL CHECK("revision">=0),
  "eventType" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","roomId","sequence"),
  UNIQUE("namespace","roomId","id"), UNIQUE("namespace","roomId","sequence","id"), UNIQUE("namespace","roomId","sequence","id","matchId"), FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","matchId") REFERENCES public."HuroofMatch"("namespace","roomId","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","actorFirebaseIdentityId","requestKey") REFERENCES public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofProjection" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "audience" TEXT NOT NULL CHECK("audience" IN ('OWNER','MEMBER','PUBLIC')),
  "scope" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">=0), "throughSequence" BIGINT NOT NULL CHECK("throughSequence">=0),
  "authGeneration" BIGINT NOT NULL CHECK("authGeneration">=0), "payload" JSONB NOT NULL, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","roomId","audience","scope"), FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(("audience"='PUBLIC' AND "scope"='public') OR ("audience"<>'PUBLIC' AND "scope"<>'public'))
);
CREATE TABLE public."HuroofRealtimeOutbox" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "sequence" BIGINT NOT NULL, "eventId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","roomId","sequence"),
  FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","sequence","eventId") REFERENCES public."HuroofEvent"("namespace","roomId","sequence","id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofOutboxDelivery" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "sequence" BIGINT NOT NULL, "leaseOwner" TEXT, "leaseVersion" BIGINT NOT NULL DEFAULT 0 CHECK("leaseVersion">=0),
  "leaseExpiresAt" TIMESTAMPTZ(3), "attemptCount" INTEGER NOT NULL DEFAULT 0 CHECK("attemptCount">=0), "state" TEXT NOT NULL DEFAULT 'PENDING' CHECK("state" IN ('PENDING','LEASED','DONE')),
  "lastErrorCode" TEXT, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","roomId","sequence"),
  FOREIGN KEY("namespace","roomId","sequence") REFERENCES public."HuroofRealtimeOutbox"("namespace","roomId","sequence") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(("state"='LEASED' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("state"<>'LEASED' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL))
);
CREATE TABLE public."HuroofPresence" (
  "namespace" TEXT NOT NULL, "roomId" TEXT NOT NULL, "firebaseIdentityId" TEXT NOT NULL, "memberGeneration" BIGINT NOT NULL,
  "lastSeenAt" TIMESTAMPTZ(3) NOT NULL, "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL, "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0),
  PRIMARY KEY("namespace","roomId","firebaseIdentityId"), FOREIGN KEY("namespace","roomId") REFERENCES public."HuroofRoom"("namespace","id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","firebaseIdentityId","memberGeneration") REFERENCES public."HuroofMember"("namespace","roomId","firebaseIdentityId","generation") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofRawArtifact" (
  "namespace" TEXT NOT NULL, "id" TEXT NOT NULL, "contentHash" TEXT NOT NULL CHECK("contentHash" ~ '^[a-f0-9]{64}$'), "byteLength" BIGINT NOT NULL CHECK("byteLength">=0),
  "mediaType" TEXT NOT NULL, "rawBytes" BYTEA NOT NULL, "provenanceBytes" BYTEA NOT NULL, "provenanceHash" TEXT NOT NULL CHECK("provenanceHash" ~ '^[a-f0-9]{64}$'),
  "serialization" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","id"), UNIQUE("namespace","id","contentHash"), UNIQUE("namespace","id","contentHash","mediaType","byteLength","provenanceHash"),
  CHECK(octet_length("rawBytes")="byteLength"), CHECK(encode(int4_crypto.digest("rawBytes",'sha256'),'hex')="contentHash"),
  CHECK(encode(int4_crypto.digest("provenanceBytes",'sha256'),'hex')="provenanceHash")
);
ALTER TABLE public."HuroofMatch" ADD CONSTRAINT "HuroofMatch_profile_raw_fk" FOREIGN KEY("namespace","profileRawArtifactId","profileHash") REFERENCES public."HuroofRawArtifact"("namespace","id","contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE public."HuroofContentRevision" (
  "namespace" TEXT NOT NULL, "family" TEXT NOT NULL CHECK("family" IN ('runtime','activeRelease','release','challengeDefinitionSet','question','answer','category','profile','policy','media','map','result')),
  "sourceId" TEXT NOT NULL, "revision" BIGINT NOT NULL CHECK("revision">0), "rawArtifactId" TEXT NOT NULL, "rawArtifactHash" TEXT NOT NULL,
  "previousRevision" BIGINT, "previousHash" TEXT, "previousRawArtifactId" TEXT, "validationReceiptId" TEXT, "catalogReleaseId" TEXT, "releaseRootHash" TEXT, "actorFirebaseIdentityId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","family","sourceId","revision"), UNIQUE("namespace","family","sourceId","revision","rawArtifactHash"), UNIQUE("namespace","family","sourceId","revision","rawArtifactId","rawArtifactHash","validationReceiptId","catalogReleaseId","releaseRootHash"),
  FOREIGN KEY("namespace","rawArtifactId","rawArtifactHash") REFERENCES public."HuroofRawArtifact"("namespace","id","contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("actorFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","family","sourceId","previousRevision","previousHash") REFERENCES public."HuroofContentRevision"("namespace","family","sourceId","revision","rawArtifactHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","previousRawArtifactId","previousHash") REFERENCES public."HuroofRawArtifact"("namespace","id","contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("validationReceiptId","catalogReleaseId","releaseRootHash") REFERENCES public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(("family"='profile' AND "validationReceiptId" IS NOT NULL AND "catalogReleaseId" IS NOT NULL AND "releaseRootHash" IS NOT NULL) OR ("family"<>'profile' AND "validationReceiptId" IS NULL AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL)),
  CHECK(("previousRevision" IS NULL)=("previousHash" IS NULL) AND ("previousRevision" IS NULL)=("previousRawArtifactId" IS NULL))
);
ALTER TABLE public."HuroofMatchPin" ADD CONSTRAINT "HuroofMatchPin_profile_revision_fk" FOREIGN KEY("namespace","profileFamily","profileSourceId","profileRevision","profileRawArtifactId","profileRawArtifactHash","validationReceiptId","catalogReleaseId","releaseRootHash") REFERENCES public."HuroofContentRevision"("namespace","family","sourceId","revision","rawArtifactId","rawArtifactHash","validationReceiptId","catalogReleaseId","releaseRootHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TABLE public."HuroofContentPointer" (
  "namespace" TEXT NOT NULL, "kind" TEXT NOT NULL, "scope" TEXT NOT NULL, "family" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "revision" BIGINT NOT NULL, "rawArtifactHash" TEXT NOT NULL, "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","kind","scope"), FOREIGN KEY("namespace","family","sourceId","revision","rawArtifactHash") REFERENCES public."HuroofContentRevision"("namespace","family","sourceId","revision","rawArtifactHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofContentAudit" (
  "namespace" TEXT NOT NULL, "operationKey" TEXT NOT NULL, "actorFirebaseIdentityId" TEXT NOT NULL, "kind" TEXT NOT NULL, "scope" TEXT NOT NULL,
  "expectedVersion" BIGINT NOT NULL CHECK("expectedVersion">=0), "outcome" TEXT NOT NULL, "rawEvidence" BYTEA NOT NULL,
  "evidenceHash" TEXT NOT NULL CHECK("evidenceHash" ~ '^[a-f0-9]{64}$'), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","operationKey"), FOREIGN KEY("actorFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(encode(int4_crypto.digest("rawEvidence",'sha256'),'hex')="evidenceHash")
);
CREATE TABLE public."HuroofMediaRevision" (
  "namespace" TEXT NOT NULL, "objectId" TEXT NOT NULL, "generation" BIGINT NOT NULL CHECK("generation">0), "contentHash" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL, "byteLength" BIGINT NOT NULL CHECK("byteLength">=0), "provenanceHash" TEXT NOT NULL,
  "rawArtifactId" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","objectId","generation"), UNIQUE("namespace","objectId","generation","contentHash"),
  FOREIGN KEY("namespace","rawArtifactId","contentHash","mediaType","byteLength","provenanceHash") REFERENCES public."HuroofRawArtifact"("namespace","id","contentHash","mediaType","byteLength","provenanceHash") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofMatchResult" (
  "namespace" TEXT NOT NULL, "matchId" TEXT NOT NULL, "roomId" TEXT NOT NULL, "resultVersion" BIGINT NOT NULL CHECK("resultVersion">0), "resultHash" TEXT NOT NULL,
  "ownerFirebaseIdentityId" TEXT NOT NULL, "admissionId" TEXT NOT NULL, "terminalEventId" TEXT NOT NULL, "terminalSequence" BIGINT NOT NULL,
  "rawArtifactId" TEXT NOT NULL, "previousVersion" BIGINT, "previousHash" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","matchId","resultVersion"), UNIQUE("namespace","matchId","resultVersion","ownerFirebaseIdentityId"), UNIQUE("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash"),
  FOREIGN KEY("namespace","matchId","roomId","ownerFirebaseIdentityId","admissionId") REFERENCES public."HuroofMatch"("namespace","id","roomId","ownerFirebaseIdentityId","admissionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("admissionId","ownerFirebaseIdentityId") REFERENCES public."Admission"("id","firebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("ownerFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","roomId","terminalSequence","terminalEventId","matchId") REFERENCES public."HuroofEvent"("namespace","roomId","sequence","id","matchId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","rawArtifactId","resultHash") REFERENCES public."HuroofRawArtifact"("namespace","id","contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","matchId","previousVersion","ownerFirebaseIdentityId","previousHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(("previousVersion" IS NULL)=("previousHash" IS NULL))
);
CREATE TABLE public."HuroofOwnerHistoryHead" (
  "namespace" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL, "nextSequence" BIGINT NOT NULL DEFAULT 1 CHECK("nextSequence">0),
  "version" BIGINT NOT NULL DEFAULT 0 CHECK("version">=0), "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","ownerFirebaseIdentityId"),
  FOREIGN KEY("ownerFirebaseIdentityId") REFERENCES public."FirebaseIdentity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE public."HuroofOwnerHistoryEntry" (
  "namespace" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL, "sequence" BIGINT NOT NULL CHECK("sequence">0), "matchId" TEXT NOT NULL,
  "resultVersion" BIGINT NOT NULL, "resultHash" TEXT NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL, "provenance" BYTEA NOT NULL, "provenanceHash" TEXT NOT NULL CHECK("provenanceHash" ~ '^[a-f0-9]{64}$'), "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY("namespace","ownerFirebaseIdentityId","sequence"), UNIQUE("namespace","ownerFirebaseIdentityId","matchId","resultVersion"),
  FOREIGN KEY("namespace","ownerFirebaseIdentityId") REFERENCES public."HuroofOwnerHistoryHead"("namespace","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK(encode(int4_crypto.digest("provenance",'sha256'),'hex')="provenanceHash")
);
CREATE TABLE public."HuroofRematchLink" (
  "namespace" TEXT NOT NULL, "childMatchId" TEXT NOT NULL UNIQUE, "predecessorMatchId" TEXT NOT NULL, "ownerFirebaseIdentityId" TEXT NOT NULL,
  "predecessorResultVersion" BIGINT NOT NULL, "predecessorResultHash" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY("namespace","childMatchId"),
  FOREIGN KEY("namespace","childMatchId","ownerFirebaseIdentityId") REFERENCES public."HuroofMatch"("namespace","id","ownerFirebaseIdentityId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY("namespace","predecessorMatchId","predecessorResultVersion","ownerFirebaseIdentityId","predecessorResultHash") REFERENCES public."HuroofMatchResult"("namespace","matchId","resultVersion","ownerFirebaseIdentityId","resultHash") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK("childMatchId"<>"predecessorMatchId")
);

-- Legacy proof and provision work remain owned only by the original protocol.
CREATE OR REPLACE FUNCTION public.int5b_huroof_binding_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE b JSONB; identity_row public."FirebaseIdentity"%ROWTYPE; predecessor public."Admission"%ROWTYPE; receipt public."CatalogValidationReceipt"%ROWTYPE; field_name TEXT;
BEGIN
IF NEW."storageAuthority"='PG_HUROOF_V2' THEN
 IF NEW."engine"<>'HUROOF' OR NEW."operation"<>'HOSTED_HUROOF_PG_V2' OR NEW."mode"<>'CLASSIC' OR NEW."requestVersion"<>2 OR NEW."huroofBinding" IS NOT NULL OR NEW."huroofConfig" IS NOT NULL OR NEW."roomProjectId" IS NOT NULL OR NEW."roomId" IS NOT NULL OR NEW."huroofCatalogReleaseId" IS NOT NULL OR NEW."huroofCatalogRootHash" IS NOT NULL OR NEW."huroofValidationReceiptId" IS NOT NULL OR NEW."predecessorAdmissionId" IS NOT NULL THEN RAISE EXCEPTION 'invalid PG Huroof admission arm'; END IF;
 IF TG_OP='UPDATE' AND (NEW."storageAuthority",NEW."firebaseIdentityId",NEW."walletId",NEW."engine",NEW."operation",NEW."logicalMatchId",NEW."requestKey",NEW."requestHash",NEW."intentHash",NEW."requestVersion") IS DISTINCT FROM (OLD."storageAuthority",OLD."firebaseIdentityId",OLD."walletId",OLD."engine",OLD."operation",OLD."logicalMatchId",OLD."requestKey",OLD."requestHash",OLD."intentHash",OLD."requestVersion") THEN RAISE EXCEPTION 'immutable PG admission identity'; END IF;
 IF NEW."state"='COMMITTED' AND NOT EXISTS(SELECT 1 FROM public."HuroofMatch" m WHERE m."admissionId"=NEW."id" AND m."ownerFirebaseIdentityId"=NEW."firebaseIdentityId") THEN RAISE EXCEPTION 'committed PG admission requires owned match'; END IF;
 RETURN NEW;
END IF;

 IF TG_OP='UPDATE' AND (NEW."huroofBinding",NEW."huroofConfig",NEW."roomProjectId",NEW."roomId",NEW."predecessorAdmissionId",NEW."huroofCatalogReleaseId",NEW."huroofCatalogRootHash",NEW."huroofValidationReceiptId") IS DISTINCT FROM
   (OLD."huroofBinding",OLD."huroofConfig",OLD."roomProjectId",OLD."roomId",OLD."predecessorAdmissionId",OLD."huroofCatalogReleaseId",OLD."huroofCatalogRootHash",OLD."huroofValidationReceiptId") THEN RAISE EXCEPTION 'immutable Huroof binding'; END IF;
 IF NEW."engine"<>'HUROOF' THEN RETURN NEW; END IF;
 b:=NEW."huroofBinding";
 IF NOT public.int5b_valid_binding(b) OR NOT public.int5b_valid_config(NEW."huroofConfig") THEN RAISE EXCEPTION 'Huroof typed binding/config required'; END IF;
 FOREACH field_name IN ARRAY ARRAY['admissionId','identityId','projectId','uid','logicalMatchId','roomId','requestKey','catalogReleaseId','validationReceiptId','releaseId','selectorVersion','readinessPolicyVersion'] LOOP
  IF b->>field_name IS NULL OR b->>field_name !~ '^[A-Za-z0-9._:-]{1,200}$' THEN RAISE EXCEPTION 'Huroof binding identifier required'; END IF;
 END LOOP;
 FOREACH field_name IN ARRAY ARRAY['requestHash','catalogRootHash','releaseRootHash','capabilityHash','configHash'] LOOP
  IF b->>field_name IS NULL OR b->>field_name !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Huroof binding hash required'; END IF;
 END LOOP;
 SELECT * INTO identity_row FROM public."FirebaseIdentity" WHERE "id"=NEW."firebaseIdentityId";
 IF (b->>'admissionId',b->>'identityId',b->>'projectId',b->>'uid',b->>'logicalMatchId',b->>'roomId',b->>'requestKey',b->>'requestHash',b->>'selectorVersion') IS DISTINCT FROM
    (NEW."id",NEW."firebaseIdentityId",identity_row."firebaseProjectId",identity_row."firebaseUid",NEW."logicalMatchId",NEW."roomId",NEW."requestKey",NEW."requestHash",NEW."selectorVersion") OR
    (b->>'predecessorId') IS DISTINCT FROM NEW."predecessorAdmissionId" OR NOT b ? 'predecessorId' THEN RAISE EXCEPTION 'Huroof owner/intent pin mismatch'; END IF;
 IF (b->>'catalogReleaseId',b->>'catalogRootHash',b->>'validationReceiptId') IS DISTINCT FROM (NEW."huroofCatalogReleaseId",NEW."huroofCatalogRootHash",NEW."huroofValidationReceiptId") OR
    public.int5b_hash_json(NEW."huroofConfig") IS DISTINCT FROM b->>'configHash' THEN RAISE EXCEPTION 'Huroof catalog/config hash mismatch'; END IF;
 IF (NEW."huroofConfig"->>'demo') IS DISTINCT FROM 'false' OR (NEW."huroofConfig"->>'releaseDemoFixture') IS DISTINCT FROM 'false' OR
    NEW."huroofConfig" ? 'qaAdmission' OR NEW."huroofConfig" ? 'paidAdmission' OR
    (NEW."huroofConfig"->>'releaseId') IS DISTINCT FROM (b->>'releaseId') OR (NEW."huroofConfig"->>'releaseRootSha256') IS DISTINCT FROM (b->>'releaseRootHash') THEN RAISE EXCEPTION 'Huroof material config mismatch'; END IF;
 SELECT * INTO receipt FROM public."CatalogValidationReceipt" WHERE "id"=b->>'validationReceiptId';
 IF NOT FOUND OR (receipt."catalogReleaseId",receipt."releaseRootHash",receipt."huroofProjectId",receipt."huroofReleaseId",receipt."huroofRootSha256",receipt."selectorVersion",receipt."policyVersion",receipt."huroofCapabilityStateHash") IS DISTINCT FROM
    (b->>'catalogReleaseId',b->>'catalogRootHash',b->>'projectId',b->>'releaseId',b->>'releaseRootHash',b->>'selectorVersion',b->>'readinessPolicyVersion',b->>'capabilityHash') THEN RAISE EXCEPTION 'Huroof trusted receipt mismatch'; END IF;
 IF NEW."predecessorAdmissionId" IS NOT NULL THEN
  SELECT * INTO predecessor FROM public."Admission" WHERE "id"=NEW."predecessorAdmissionId";
  IF NOT FOUND OR predecessor."engine"<>'HUROOF' OR predecessor."firebaseIdentityId"<>NEW."firebaseIdentityId" OR predecessor."state"<>'COMMITTED' OR predecessor."id"=NEW."id" THEN RAISE EXCEPTION 'invalid same-owner played predecessor'; END IF;
  -- Existing predecessors are immutable; an inserted node can reference only
  -- an existing committed node, so cycles cannot be introduced.
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.int5b_huroof_terminal_invariant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE admission_id TEXT; a public."Admission"%ROWTYPE; proof_row public."HuroofAdmissionProof"%ROWTYPE;
BEGIN
IF TG_TABLE_NAME='Admission' THEN admission_id:=NEW."id"; ELSE admission_id:=NEW."admissionId"; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=admission_id;
 IF a."storageAuthority"='PG_HUROOF_V2' THEN
  IF TG_TABLE_NAME='HuroofAdmissionProof' THEN RAISE EXCEPTION 'PG Huroof admissions cannot attach legacy Firestore proofs'; END IF;
  IF a."state"<>'COMMITTED' OR (SELECT count(*) FROM public."HuroofMatch" m WHERE m."admissionId"=a."id" AND m."ownerFirebaseIdentityId"=a."firebaseIdentityId")<>1 THEN RAISE EXCEPTION 'PG Huroof terminal requires one owned match'; END IF;
  RETURN NULL;
 END IF;

 IF TG_TABLE_NAME='Admission' THEN admission_id:=NEW."id"; ELSE admission_id:=NEW."admissionId"; END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=admission_id;
 IF a."engine"<>'HUROOF' THEN RETURN NULL; END IF;
 SELECT * INTO proof_row FROM public."HuroofAdmissionProof" WHERE "admissionId"=admission_id;
 IF FOUND AND (proof_row."proofVersion"<>1 OR proof_row."terminalState" IS DISTINCT FROM proof_row."proof"->>'state' OR NOT public.int5b_valid_proof(a."huroofBinding",proof_row."proof")) THEN RAISE EXCEPTION 'Huroof typed terminal proof required'; END IF;
 IF a."state"='HELD' AND FOUND THEN RAISE EXCEPTION 'terminal proof cannot leave financial hold unsettled'; END IF;
 IF a."state"<>'HELD' AND (NOT FOUND OR proof_row."proof"->'binding' IS DISTINCT FROM a."huroofBinding" OR
   proof_row."terminalState" IS DISTINCT FROM (CASE a."state" WHEN 'COMMITTED' THEN 'STARTED' ELSE 'CANCELLED' END)) THEN RAISE EXCEPTION 'Huroof settlement requires matching immutable terminal proof'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.int5b_reserve_huroof(p_binding JSONB,p_intent_hash TEXT,p_config JSONB) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE w public."Wallet"%ROWTYPE; existing public."Admission"%ROWTYPE; request_admission public."Admission"%ROWTYPE; logical_admission public."Admission"%ROWTYPE; request_found BOOLEAN; logical_found BOOLEAN; reservation_id TEXT; active_receipt TEXT;
BEGIN
IF EXISTS(SELECT 1 FROM public."Admission" a WHERE a."firebaseIdentityId"=p_binding->>'identityId' AND ((a."requestKey"=p_binding->>'requestKey') OR (a."engine"='HUROOF' AND a."logicalMatchId"=p_binding->>'logicalMatchId')) AND a."storageAuthority"='PG_HUROOF_V2') THEN RAISE EXCEPTION 'cross-generation request collision'; END IF;

 IF NOT public.int5b_valid_binding(p_binding) OR NOT public.int5b_valid_config(p_config) OR p_intent_hash IS NULL OR p_intent_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Huroof typed binding/config required'; END IF;
 SELECT * INTO w FROM public."Wallet" WHERE "firebaseIdentityId"=p_binding->>'identityId' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'wallet is not provisioned'; END IF;
 SELECT * INTO request_admission FROM public."Admission" WHERE "firebaseIdentityId"=w."firebaseIdentityId" AND "requestKey"=p_binding->>'requestKey' FOR UPDATE;
 request_found:=FOUND;
 SELECT * INTO logical_admission FROM public."Admission" WHERE "firebaseIdentityId"=w."firebaseIdentityId" AND "engine"='HUROOF' AND "logicalMatchId"=p_binding->>'logicalMatchId' FOR UPDATE;
 logical_found:=FOUND;
 IF request_found AND logical_found AND request_admission."id"<>logical_admission."id" THEN RAISE EXCEPTION 'global request and logical-match keys resolve to distinct admissions'; END IF;
 IF request_found OR logical_found THEN
  IF request_found THEN existing:=request_admission; ELSE existing:=logical_admission; END IF;
  IF existing."storageAuthority" IS DISTINCT FROM 'LEGACY_PROTOCOL_V1' THEN RAISE EXCEPTION 'cross-generation request collision'; END IF;
  IF existing."engine"='HUROOF' AND existing."operation"='HOSTED_HUROOF' AND existing."requestKey"=p_binding->>'requestKey' AND existing."logicalMatchId"=p_binding->>'logicalMatchId' AND existing."requestHash"=p_binding->>'requestHash' AND existing."intentHash"=p_intent_hash THEN RETURN; END IF;
  RAISE EXCEPTION 'idempotency key conflict';
 END IF;
 IF w."debt">0 OR w."available"<1 THEN RAISE EXCEPTION 'wallet cannot reserve'; END IF;
 SELECT "validationReceiptId" INTO active_receipt FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR SHARE;
 IF active_receipt IS DISTINCT FROM p_binding->>'validationReceiptId' THEN RAISE EXCEPTION 'active readiness rotated'; END IF;
 reservation_id:=(p_binding->>'admissionId') || ':reservation';
 IF p_intent_hash IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('engine','HUROOF','operation','HOSTED_HUROOF','logicalMatchId',p_binding->>'logicalMatchId','config',p_config,'predecessorId',p_binding->'predecessorId')) OR
    p_binding->>'requestHash' IS DISTINCT FROM public.int5b_hash_json(jsonb_build_object('version',1,'requestKey',p_binding->>'requestKey','intentHash',p_intent_hash)) THEN RAISE EXCEPTION 'Huroof request hash mismatch'; END IF;
 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","selectorVersion","roomProjectId","roomId","huroofBinding","huroofConfig","predecessorAdmissionId","huroofCatalogReleaseId","huroofCatalogRootHash","huroofValidationReceiptId","updatedAt")
 VALUES(p_binding->>'admissionId',w."firebaseIdentityId",w."id",'HUROOF','HOSTED_HUROOF',p_binding->>'logicalMatchId',p_binding->>'requestKey',p_binding->>'requestHash',p_intent_hash,1,p_binding->>'selectorVersion',p_binding->>'projectId',p_binding->>'roomId',p_binding,p_config,p_binding->>'predecessorId',p_binding->>'catalogReleaseId',p_binding->>'catalogRootHash',p_binding->>'validationReceiptId',clock_timestamp());
 INSERT INTO public."Reservation"("id","admissionId","updatedAt") VALUES(reservation_id,p_binding->>'admissionId',clock_timestamp());
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId")
 VALUES((p_binding->>'admissionId')||':reserve',w."id",w."version"+1,'ADMISSION',p_binding->>'admissionId','RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",w."firebaseIdentityId");
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 INSERT INTO public."AdmissionEvent"("id","admissionId","sequence","eventType") VALUES((p_binding->>'admissionId')||':held',p_binding->>'admissionId',1,'HELD');
 INSERT INTO public."AdmissionOutbox"("id","admissionId","jobKind","transitionVersion","updatedAt") VALUES((p_binding->>'admissionId')||':huroof',p_binding->>'admissionId','HUROOF_PROVISION_RECONCILE',1,clock_timestamp());
END $$;
CREATE OR REPLACE FUNCTION public.int5b_find_admission(p_identity TEXT,p_key TEXT,p_logical TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE matches INTEGER; candidate_id TEXT; authority TEXT; result JSONB;
BEGIN
 SELECT count(DISTINCT a."id"), (array_agg(a."id" ORDER BY a."id"))[1], (array_agg(a."storageAuthority" ORDER BY a."id"))[1]
 INTO matches,candidate_id,authority FROM public."Admission" a WHERE a."firebaseIdentityId"=p_identity AND ((p_key IS NOT NULL AND a."requestKey"=p_key) OR (p_logical IS NOT NULL AND a."engine"='HUROOF' AND a."logicalMatchId"=p_logical));
 IF matches>1 THEN RAISE EXCEPTION 'global request and logical-match keys resolve to distinct admissions'; END IF;
 IF matches=0 THEN RETURN NULL; END IF;
 IF authority IS DISTINCT FROM 'LEGACY_PROTOCOL_V1' THEN RAISE EXCEPTION 'cross-generation request collision'; END IF;
 result := (SELECT jsonb_build_object('binding',a."huroofBinding",'intentHash',a."intentHash",'engine',a."engine",'state',a."state") FROM public."Admission" a
 WHERE a."firebaseIdentityId"=p_identity AND ((p_key IS NOT NULL AND a."requestKey"=p_key) OR (p_logical IS NOT NULL AND a."engine"='HUROOF' AND a."logicalMatchId"=p_logical)) LIMIT 1);
 IF result->'binding'->>'admissionId' IS DISTINCT FROM candidate_id THEN RAISE EXCEPTION 'legacy lookup row changed across the classified snapshot'; END IF;
 RETURN result;
END $$;
ALTER TABLE public."Admission" DROP CONSTRAINT "Admission_engine_branch_check", ADD CONSTRAINT "Admission_engine_branch_check" CHECK (
 ("storageAuthority"='LEGACY_PROTOCOL_V1' AND (
 ("engine"='ENTA' AND (("mode"='CLASSIC' AND "operation"='PAID_ENTA_CLASSIC') OR ("mode"='KIDS' AND "operation"='PAID_ENTA_KIDS' AND "requestVersion"=3) OR ("mode"='LIST' AND "operation"='PAID_ENTA_LIST' AND "requestVersion"=4) OR ("mode"='ACTING' AND "operation"='PAID_ENTA_ACTING' AND "requestVersion"=4)) AND "catalogReleaseId" IS NOT NULL AND "releaseRootHash" IS NOT NULL AND "validationReceiptId" IS NOT NULL
 AND "huroofBinding" IS NULL AND "huroofConfig" IS NULL AND "predecessorAdmissionId" IS NULL AND "huroofCatalogReleaseId" IS NULL AND "huroofCatalogRootHash" IS NULL AND "huroofValidationReceiptId" IS NULL)
 OR ("engine"='HUROOF' AND "mode"='CLASSIC' AND "operation"='HOSTED_HUROOF' AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL AND "validationReceiptId" IS NULL AND "huroofBinding" IS NOT NULL AND "huroofConfig" IS NOT NULL AND "roomProjectId" IS NOT NULL AND "roomId" IS NOT NULL AND "huroofCatalogReleaseId" IS NOT NULL AND "huroofCatalogRootHash" IS NOT NULL AND "huroofValidationReceiptId" IS NOT NULL)))
 OR ("storageAuthority"='PG_HUROOF_V2' AND "engine"='HUROOF' AND "operation"='HOSTED_HUROOF_PG_V2' AND "mode"='CLASSIC' AND "requestVersion"=2 AND "catalogReleaseId" IS NULL AND "releaseRootHash" IS NULL AND "validationReceiptId" IS NULL AND "huroofBinding" IS NULL AND "huroofConfig" IS NULL AND "roomProjectId" IS NULL AND "roomId" IS NULL AND "huroofCatalogReleaseId" IS NULL AND "huroofCatalogRootHash" IS NULL AND "huroofValidationReceiptId" IS NULL AND "predecessorAdmissionId" IS NULL)
);

-- @ROUTINES content spliced into migration.template.sql at build time.

CREATE OR REPLACE FUNCTION public.eng03_02_admission_authority_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW."storageAuthority" IS DISTINCT FROM OLD."storageAuthority" THEN RAISE EXCEPTION 'immutable admission storage authority'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Admission_storage_authority_guard" BEFORE UPDATE OR DELETE ON public."Admission" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_admission_authority_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_immutable_row() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'ENG03-02 append-only relation rejects mutation' USING ERRCODE='55000'; END $$;
CREATE TRIGGER "HuroofIdentityPolicyRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofIdentityPolicyRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofLocator_immutable" BEFORE UPDATE OR DELETE ON public."HuroofLocator" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofRealtimeOutbox_immutable" BEFORE UPDATE OR DELETE ON public."HuroofRealtimeOutbox" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofMatchPin_immutable" BEFORE UPDATE OR DELETE ON public."HuroofMatchPin" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofCommandReceipt_immutable" BEFORE UPDATE OR DELETE ON public."HuroofCommandReceipt" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofEvent_immutable" BEFORE UPDATE OR DELETE ON public."HuroofEvent" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofRawArtifact_immutable" BEFORE UPDATE OR DELETE ON public."HuroofRawArtifact" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofMediaRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofMediaRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofContentRevision_immutable" BEFORE UPDATE OR DELETE ON public."HuroofContentRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofContentAudit_immutable" BEFORE UPDATE OR DELETE ON public."HuroofContentAudit" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofMatchResult_immutable" BEFORE UPDATE OR DELETE ON public."HuroofMatchResult" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofOwnerHistoryEntry_immutable" BEFORE UPDATE OR DELETE ON public."HuroofOwnerHistoryEntry" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();
CREATE TRIGGER "HuroofRematchLink_immutable" BEFORE UPDATE OR DELETE ON public."HuroofRematchLink" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_immutable_row();

CREATE OR REPLACE FUNCTION public.eng03_02_content_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'content revisions are append-only'; END IF;
 IF NEW."revision"=1 THEN
  IF NEW."previousRevision" IS NOT NULL OR NEW."previousHash" IS NOT NULL OR NEW."previousRawArtifactId" IS NOT NULL THEN RAISE EXCEPTION 'first content revision cannot name a predecessor'; END IF;
 ELSIF NEW."revision"<=1 OR NEW."previousRevision" IS DISTINCT FROM NEW."revision"-1 OR NEW."previousHash" IS NULL OR NEW."previousRawArtifactId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."HuroofContentRevision" p WHERE (p."namespace",p."family",p."sourceId",p."revision",p."rawArtifactHash",p."rawArtifactId")=(NEW."namespace",NEW."family",NEW."sourceId",NEW."revision"-1,NEW."previousHash",NEW."previousRawArtifactId")) THEN RAISE EXCEPTION 'content revision requires the exact immediately prior revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofContentRevision_chain_guard" BEFORE INSERT ON public."HuroofContentRevision" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_content_revision_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_reject_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'ENG03-02 protected relation rejects TRUNCATE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER "Admission_reject_truncate" BEFORE TRUNCATE ON public."Admission" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "Reservation_reject_truncate" BEFORE TRUNCATE ON public."Reservation" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "WalletEntry_reject_truncate" BEFORE TRUNCATE ON public."WalletEntry" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofAdmissionProof_reject_truncate" BEFORE TRUNCATE ON public."HuroofAdmissionProof" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "AdmissionOutbox_reject_truncate" BEFORE TRUNCATE ON public."AdmissionOutbox" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofIdentityPolicyRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofIdentityPolicyRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofIdentityPolicyHead_reject_truncate" BEFORE TRUNCATE ON public."HuroofIdentityPolicyHead" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofRoom_reject_truncate" BEFORE TRUNCATE ON public."HuroofRoom" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofLocator_reject_truncate" BEFORE TRUNCATE ON public."HuroofLocator" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofMember_reject_truncate" BEFORE TRUNCATE ON public."HuroofMember" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofParticipant_reject_truncate" BEFORE TRUNCATE ON public."HuroofParticipant" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofMatch_reject_truncate" BEFORE TRUNCATE ON public."HuroofMatch" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofMatchPin_reject_truncate" BEFORE TRUNCATE ON public."HuroofMatchPin" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofCanonicalState_reject_truncate" BEFORE TRUNCATE ON public."HuroofCanonicalState" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofCommandReceipt_reject_truncate" BEFORE TRUNCATE ON public."HuroofCommandReceipt" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofEvent_reject_truncate" BEFORE TRUNCATE ON public."HuroofEvent" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofProjection_reject_truncate" BEFORE TRUNCATE ON public."HuroofProjection" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofRealtimeOutbox_reject_truncate" BEFORE TRUNCATE ON public."HuroofRealtimeOutbox" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofOutboxDelivery_reject_truncate" BEFORE TRUNCATE ON public."HuroofOutboxDelivery" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofPresence_reject_truncate" BEFORE TRUNCATE ON public."HuroofPresence" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofRawArtifact_reject_truncate" BEFORE TRUNCATE ON public."HuroofRawArtifact" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofContentRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofContentRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofContentPointer_reject_truncate" BEFORE TRUNCATE ON public."HuroofContentPointer" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofContentAudit_reject_truncate" BEFORE TRUNCATE ON public."HuroofContentAudit" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofMediaRevision_reject_truncate" BEFORE TRUNCATE ON public."HuroofMediaRevision" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofMatchResult_reject_truncate" BEFORE TRUNCATE ON public."HuroofMatchResult" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofOwnerHistoryHead_reject_truncate" BEFORE TRUNCATE ON public."HuroofOwnerHistoryHead" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofOwnerHistoryEntry_reject_truncate" BEFORE TRUNCATE ON public."HuroofOwnerHistoryEntry" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();
CREATE TRIGGER "HuroofRematchLink_reject_truncate" BEFORE TRUNCATE ON public."HuroofRematchLink" FOR EACH STATEMENT EXECUTE FUNCTION public.eng03_02_reject_truncate();

CREATE OR REPLACE FUNCTION public.eng03_02_policy_head_cas() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_has_role(current_user,'huroof_pg_content_publisher','member') THEN RAISE EXCEPTION 'policy publisher role required'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."version"<>0 OR NEW."revision"<=0 THEN RAISE EXCEPTION 'policy head must begin at version zero'; END IF;
 ELSIF TG_OP='DELETE' OR NEW."namespace" IS DISTINCT FROM OLD."namespace" OR NEW."version"<>OLD."version"+1 OR NEW."revision"<=OLD."revision" THEN RAISE EXCEPTION 'policy head must advance by CAS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofIdentityPolicyHead_cas" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofIdentityPolicyHead" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_policy_head_cas();

CREATE OR REPLACE FUNCTION public.eng03_02_pointer_cas() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND (NEW."namespace",NEW."kind",NEW."scope") IS DISTINCT FROM (OLD."namespace",OLD."kind",OLD."scope")) THEN RAISE EXCEPTION 'content pointer identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'content pointer CAS version mismatch'; END IF;
 IF TG_OP='INSERT' AND NEW."version"<>0 THEN RAISE EXCEPTION 'content pointer must start at version zero'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofContentPointer_cas" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofContentPointer" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_pointer_cas();

CREATE OR REPLACE FUNCTION public.eng03_02_mutable_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ENG03-02 mutable head cannot be deleted'; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='HuroofMatch' THEN
  IF NEW."version"<>0 OR NEW."state"<>'STARTED' THEN RAISE EXCEPTION 'new Huroof match must begin at STARTED version zero'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='HuroofRoom' THEN
  IF (NEW."namespace",NEW."id",NEW."ownerFirebaseIdentityId",NEW."generation",NEW."createdAt") IS DISTINCT FROM (OLD."namespace",OLD."id",OLD."ownerFirebaseIdentityId",OLD."generation",OLD."createdAt") OR NEW."version"<>OLD."version"+1 OR NEW."status" NOT IN ('ACTIVE','CLOSED') OR OLD."status" NOT IN ('SETUP','ACTIVE') THEN RAISE EXCEPTION 'invalid immutable room identity or state transition'; END IF;
 ELSIF TG_TABLE_NAME='HuroofMatch' THEN
  IF (NEW."namespace",NEW."id",NEW."roomId",NEW."ownerFirebaseIdentityId",NEW."admissionId",NEW."profile",NEW."profileRawArtifactId",NEW."profileHash",NEW."config",NEW."configHash",NEW."rawIntent",NEW."rawIntentHash",NEW."policyRevision",NEW."policyHash",NEW."createdAt") IS DISTINCT FROM (OLD."namespace",OLD."id",OLD."roomId",OLD."ownerFirebaseIdentityId",OLD."admissionId",OLD."profile",OLD."profileRawArtifactId",OLD."profileHash",OLD."config",OLD."configHash",OLD."rawIntent",OLD."rawIntentHash",OLD."policyRevision",OLD."policyHash",OLD."createdAt") OR NEW."version"<>OLD."version"+1 OR NOT ((OLD."state"='STARTED' AND NEW."state" IN ('ACTIVE','ABANDONED')) OR (OLD."state"='ACTIVE' AND NEW."state" IN ('FINISHED','ABANDONED'))) THEN RAISE EXCEPTION 'invalid immutable match or terminal transition'; END IF;
 ELSIF TG_TABLE_NAME='HuroofCanonicalState' THEN
  IF (NEW."namespace",NEW."roomId",NEW."ownerFirebaseIdentityId") IS DISTINCT FROM (OLD."namespace",OLD."roomId",OLD."ownerFirebaseIdentityId") OR NEW."revision"<>OLD."revision"+1 OR NEW."sequence"<>OLD."sequence"+1 OR NEW."status" NOT IN ('ACTIVE','FINISHED','CLOSED') THEN RAISE EXCEPTION 'canonical state CAS required'; END IF;
  IF NEW."activeMatchId" IS DISTINCT FROM OLD."activeMatchId" AND (OLD."status" IS DISTINCT FROM 'FINISHED' OR NEW."status" IS DISTINCT FROM 'ACTIVE' OR NOT EXISTS(SELECT 1 FROM public."HuroofMatch" pm JOIN public."HuroofMatchResult" pr ON pr."namespace"=pm."namespace" AND pr."matchId"=pm."id" AND pr."ownerFirebaseIdentityId"=pm."ownerFirebaseIdentityId" AND pr."admissionId"=pm."admissionId" JOIN public."HuroofEvent" pe ON pe."namespace"=pr."namespace" AND pe."roomId"=pr."roomId" AND pe."sequence"=pr."terminalSequence" AND pe."id"=pr."terminalEventId" AND pe."matchId"=pr."matchId" WHERE pm."namespace"=OLD."namespace" AND pm."id"=OLD."activeMatchId" AND pm."roomId"=OLD."roomId" AND pm."ownerFirebaseIdentityId"=OLD."ownerFirebaseIdentityId" AND pm."state" IN ('FINISHED','ABANDONED') AND pe."eventType"=pm."state")) THEN RAISE EXCEPTION 'new active match requires the same-room terminal result of the prior active match'; END IF;
 ELSIF TG_TABLE_NAME='HuroofProjection' THEN
  IF (NEW."namespace",NEW."roomId",NEW."audience",NEW."scope") IS DISTINCT FROM (OLD."namespace",OLD."roomId",OLD."audience",OLD."scope") OR NEW."revision"<>OLD."revision"+1 OR NEW."throughSequence"<=OLD."throughSequence" OR NEW."authGeneration"<OLD."authGeneration" THEN RAISE EXCEPTION 'projection head CAS cannot move backwards or change audience'; END IF;
 ELSIF TG_TABLE_NAME='HuroofIdentityPolicyHead' THEN
  IF NOT pg_has_role(current_user,'huroof_pg_content_publisher','member') THEN RAISE EXCEPTION 'policy activation role required'; END IF;
 ELSIF TG_TABLE_NAME='HuroofMember' THEN
  IF (NEW."namespace",NEW."roomId",NEW."firebaseIdentityId",NEW."role",NEW."generation",NEW."createdAt") IS DISTINCT FROM (OLD."namespace",OLD."roomId",OLD."firebaseIdentityId",OLD."role",OLD."generation",OLD."createdAt") OR NEW."version"<>OLD."version"+1 OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN RAISE EXCEPTION 'member identity is immutable and revocation is one-way CAS'; END IF;
 ELSIF TG_TABLE_NAME='HuroofPresence' THEN
  IF (NEW."namespace",NEW."roomId",NEW."firebaseIdentityId",NEW."memberGeneration") IS DISTINCT FROM (OLD."namespace",OLD."roomId",OLD."firebaseIdentityId",OLD."memberGeneration") OR NEW."version"<>OLD."version"+1 OR NEW."lastSeenAt"<OLD."lastSeenAt" THEN RAISE EXCEPTION 'presence lease CAS required'; END IF;
 ELSIF TG_TABLE_NAME='HuroofOutboxDelivery' THEN
  IF NOT pg_has_role(current_user,'huroof_pg_outbox_executor','member') OR (NEW."namespace",NEW."roomId",NEW."sequence") IS DISTINCT FROM (OLD."namespace",OLD."roomId",OLD."sequence") THEN RAISE EXCEPTION 'fixed outbox lease executor required'; END IF;
  IF NEW."state"='LEASED' THEN
   IF NOT (OLD."state"='PENDING' OR (OLD."state"='LEASED' AND OLD."leaseExpiresAt"<=clock_timestamp())) OR NEW."leaseVersion"<>OLD."leaseVersion"+1 OR NEW."attemptCount"<>OLD."attemptCount"+1 OR NEW."leaseOwner" IS NULL OR NEW."leaseExpiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'invalid outbox lease claim'; END IF;
  ELSIF NEW."state" IN ('PENDING','DONE') THEN
   IF OLD."state"<>'LEASED' OR OLD."leaseExpiresAt"<=clock_timestamp() OR NEW."leaseVersion"<>OLD."leaseVersion" OR NEW."attemptCount"<>OLD."attemptCount" OR NEW."leaseOwner" IS NOT NULL OR NEW."leaseExpiresAt" IS NOT NULL THEN RAISE EXCEPTION 'invalid outbox lease completion'; END IF;
  ELSE RAISE EXCEPTION 'invalid delivery state'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofRoom_guard" BEFORE UPDATE OR DELETE ON public."HuroofRoom" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofMatch_insert_guard" BEFORE INSERT ON public."HuroofMatch" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofMatch_guard" BEFORE UPDATE OR DELETE ON public."HuroofMatch" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofCanonicalState_guard" BEFORE UPDATE OR DELETE ON public."HuroofCanonicalState" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE OR REPLACE FUNCTION public.eng03_02_projection_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s public."HuroofCanonicalState"%ROWTYPE; r public."HuroofRoom"%ROWTYPE;
BEGIN
 SELECT * INTO s FROM public."HuroofCanonicalState" WHERE ("namespace","roomId")=(NEW."namespace",NEW."roomId");
 IF NOT FOUND THEN RAISE EXCEPTION 'projection requires same-room canonical state'; END IF;
 SELECT * INTO r FROM public."HuroofRoom" WHERE ("namespace","id")=(NEW."namespace",NEW."roomId");
 IF NOT FOUND OR s."sequence"<NEW."throughSequence" OR s."revision"<NEW."revision" OR r."generation" IS DISTINCT FROM NEW."authGeneration" THEN RAISE EXCEPTION 'projection must be bounded by current same-room state and authority generation'; END IF;
 IF NEW."audience"='PUBLIC' AND (jsonb_typeof(NEW."payload") IS DISTINCT FROM 'object' OR public.eng03_02_has_secret_key(NEW."payload") OR NEW."payload"-ARRAY['status','revision']::TEXT[]<>'{}'::JSONB OR NEW."payload"->>'revision' IS DISTINCT FROM NEW."revision"::TEXT OR NEW."payload"->>'status' IS NULL) THEN RAISE EXCEPTION 'public projection is restricted to minimal safe invalidation fields'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofProjection_safe_insert" BEFORE INSERT OR UPDATE ON public."HuroofProjection" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_projection_guard();
CREATE TRIGGER "HuroofProjection_guard" BEFORE UPDATE OR DELETE ON public."HuroofProjection" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofMember_guard" BEFORE UPDATE OR DELETE ON public."HuroofMember" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofPresence_guard" BEFORE UPDATE OR DELETE ON public."HuroofPresence" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();
CREATE TRIGGER "HuroofOutboxDelivery_guard" BEFORE UPDATE OR DELETE ON public."HuroofOutboxDelivery" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_mutable_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_result_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'result relation is append-only'; END IF;
 IF (NEW."resultVersion"=1 AND (NEW."previousVersion" IS NOT NULL OR NEW."previousHash" IS NOT NULL)) OR (NEW."resultVersion">1 AND (NEW."previousVersion" IS DISTINCT FROM NEW."resultVersion"-1 OR NEW."previousHash" IS NULL)) THEN RAISE EXCEPTION 'match result versions must be strictly contiguous'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofMatch" m JOIN public."HuroofEvent" e ON e."namespace"=m."namespace" AND e."roomId"=m."roomId" AND e."matchId"=m."id" AND e."sequence"=NEW."terminalSequence" AND e."id"=NEW."terminalEventId" WHERE (m."namespace",m."id",m."roomId",m."ownerFirebaseIdentityId",m."admissionId")=(NEW."namespace",NEW."matchId",NEW."roomId",NEW."ownerFirebaseIdentityId",NEW."admissionId") AND m."state" IN ('FINISHED','ABANDONED') AND e."eventType"=m."state") THEN RAISE EXCEPTION 'result requires exact same-match terminal state and event'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofMatchResult_terminal_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofMatchResult" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_result_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_rematch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'rematch relation is append-only'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofMatch" child JOIN public."HuroofMatch" prior ON prior."namespace"=child."namespace" AND prior."roomId"=child."roomId" AND prior."ownerFirebaseIdentityId"=child."ownerFirebaseIdentityId" JOIN public."HuroofMatchResult" r ON r."namespace"=prior."namespace" AND r."matchId"=prior."id" AND r."resultVersion"=NEW."predecessorResultVersion" AND r."resultHash"=NEW."predecessorResultHash" AND r."ownerFirebaseIdentityId"=prior."ownerFirebaseIdentityId" JOIN public."HuroofEvent" e ON e."namespace"=r."namespace" AND e."roomId"=r."roomId" AND e."matchId"=r."matchId" AND e."sequence"=r."terminalSequence" AND e."id"=r."terminalEventId" WHERE (child."namespace",child."id",child."ownerFirebaseIdentityId")=(NEW."namespace",NEW."childMatchId",NEW."ownerFirebaseIdentityId") AND child."state"='STARTED' AND (prior."namespace",prior."id")=(NEW."namespace",NEW."predecessorMatchId") AND prior."state" IN ('FINISHED','ABANDONED') AND e."eventType"=prior."state") THEN RAISE EXCEPTION 'rematch requires same-owner same-room terminal predecessor result and a new STARTED child'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofRematchLink_terminal_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofRematchLink" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_rematch_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_history_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."nextSequence"<>1 OR NEW."version"<>0 THEN RAISE EXCEPTION 'history head must begin at sequence one and version zero'; END IF;
 ELSIF TG_OP='DELETE' OR (NEW."namespace",NEW."ownerFirebaseIdentityId") IS DISTINCT FROM (OLD."namespace",OLD."ownerFirebaseIdentityId") OR NEW."nextSequence"<>OLD."nextSequence"+1 OR NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'history head requires one-step append CAS'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofOwnerHistoryHead_cas" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofOwnerHistoryHead" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_history_head_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_history_entry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h public."HuroofOwnerHistoryHead"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'owner history is append-only'; END IF;
 SELECT * INTO h FROM public."HuroofOwnerHistoryHead" WHERE ("namespace","ownerFirebaseIdentityId")=(NEW."namespace",NEW."ownerFirebaseIdentityId") FOR UPDATE;
 IF NOT FOUND OR NEW."sequence" IS DISTINCT FROM h."nextSequence" OR NEW."occurredAt" IS NULL OR encode(int4_crypto.digest(NEW."provenance",'sha256'),'hex') IS DISTINCT FROM NEW."provenanceHash" THEN RAISE EXCEPTION 'history entry must match the exact current head and provenance hash'; END IF;
 UPDATE public."HuroofOwnerHistoryHead" SET "nextSequence"="nextSequence"+1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE ("namespace","ownerFirebaseIdentityId")=(NEW."namespace",NEW."ownerFirebaseIdentityId") AND "version"=h."version" AND "nextSequence"=NEW."sequence";
 IF NOT FOUND THEN RAISE EXCEPTION 'owner history head compare-and-swap failed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofOwnerHistoryEntry_append_guard" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofOwnerHistoryEntry" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_history_entry_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_proof_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP<>'INSERT' OR EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=NEW."admissionId" AND a."storageAuthority"='PG_HUROOF_V2') THEN RAISE EXCEPTION 'legacy terminal proof cannot attach to PG Huroof'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "HuroofAdmissionProof_pg_isolation" BEFORE INSERT OR UPDATE OR DELETE ON public."HuroofAdmissionProof" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_proof_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=NEW."admissionId" AND a."storageAuthority"='PG_HUROOF_V2') THEN RAISE EXCEPTION 'PG Huroof start cannot use legacy provisioning outbox'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR EXISTS(SELECT 1 FROM public."Admission" a WHERE a."id"=OLD."admissionId" AND a."storageAuthority"='PG_HUROOF_V2') THEN RAISE EXCEPTION 'legacy outbox cannot mutate PG Huroof'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdmissionOutbox_pg_isolation" BEFORE INSERT OR UPDATE OR DELETE ON public."AdmissionOutbox" FOR EACH ROW EXECUTE FUNCTION public.eng03_02_outbox_guard();

CREATE OR REPLACE FUNCTION public.eng03_02_start_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE aid TEXT; rid TEXT; a public."Admission"%ROWTYPE; r public."Reservation"%ROWTYPE; m public."HuroofMatch"%ROWTYPE; room public."HuroofRoom"%ROWTYPE; reserve_n INTEGER; commit_n INTEGER; release_n INTEGER; match_n INTEGER; event_n INTEGER; outbox_n INTEGER; delivery_n INTEGER; receipt_n INTEGER; projection_n INTEGER;
BEGIN
 -- Deferred final-row validation takes no locks to preserve Wallet-first order.
 IF TG_TABLE_NAME='Admission' THEN aid:=COALESCE(NEW."id",OLD."id");
 ELSIF TG_TABLE_NAME='Reservation' THEN aid:=COALESCE(NEW."admissionId",OLD."admissionId");
 ELSIF TG_TABLE_NAME='WalletEntry' THEN
   rid:=COALESCE(NEW."reservationId",OLD."reservationId");
   SELECT "admissionId" INTO aid FROM public."Reservation" WHERE "id"=rid;
 ELSIF TG_TABLE_NAME='HuroofMatch' THEN aid:=COALESCE(NEW."admissionId",OLD."admissionId");
 ELSIF TG_TABLE_NAME='HuroofMatchPin' THEN SELECT "admissionId" INTO aid FROM public."HuroofMatch" WHERE "namespace"=COALESCE(NEW."namespace",OLD."namespace") AND "id"=COALESCE(NEW."matchId",OLD."matchId");
 ELSIF TG_TABLE_NAME='HuroofCanonicalState' THEN SELECT m0."admissionId" INTO aid FROM public."HuroofMatch" m0 WHERE m0."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND m0."id"=COALESCE(NEW."activeMatchId",OLD."activeMatchId");
 ELSIF TG_TABLE_NAME='HuroofRoom' THEN SELECT m0."admissionId" INTO aid FROM public."HuroofCanonicalState" s JOIN public."HuroofMatch" m0 ON (m0."namespace",m0."id")=(s."namespace",s."activeMatchId") WHERE s."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND s."roomId"=COALESCE(NEW."id",OLD."id");
 ELSIF TG_TABLE_NAME='HuroofCommandReceipt' THEN SELECT m0."admissionId" INTO aid FROM public."HuroofMatch" m0 WHERE m0."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND m0."id"=COALESCE(NEW."matchId",OLD."matchId");
 ELSIF TG_TABLE_NAME='HuroofProjection' THEN SELECT m0."admissionId" INTO aid FROM public."HuroofCanonicalState" s JOIN public."HuroofMatch" m0 ON (m0."namespace",m0."id")=(s."namespace",s."activeMatchId") WHERE s."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND s."roomId"=COALESCE(NEW."roomId",OLD."roomId");
 ELSIF TG_TABLE_NAME='HuroofEvent' THEN SELECT m0."admissionId" INTO aid FROM public."HuroofMatch" m0 WHERE m0."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND m0."id"=COALESCE(NEW."matchId",OLD."matchId");
 ELSIF TG_TABLE_NAME='HuroofRealtimeOutbox' THEN SELECT e."matchId" INTO rid FROM public."HuroofEvent" e WHERE (e."namespace",e."roomId",e."sequence")=(COALESCE(NEW."namespace",OLD."namespace"),COALESCE(NEW."roomId",OLD."roomId"),COALESCE(NEW."sequence",OLD."sequence")); SELECT m0."admissionId" INTO aid FROM public."HuroofMatch" m0 WHERE m0."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND m0."id"=rid;
 ELSIF TG_TABLE_NAME='HuroofOutboxDelivery' THEN SELECT e."matchId" INTO rid FROM public."HuroofRealtimeOutbox" o JOIN public."HuroofEvent" e ON e."namespace"=o."namespace" AND e."roomId"=o."roomId" AND e."sequence"=o."sequence" AND e."id"=o."eventId" WHERE (o."namespace",o."roomId",o."sequence")=(COALESCE(NEW."namespace",OLD."namespace"),COALESCE(NEW."roomId",OLD."roomId"),COALESCE(NEW."sequence",OLD."sequence")); SELECT m0."admissionId" INTO aid FROM public."HuroofMatch" m0 WHERE m0."namespace"=COALESCE(NEW."namespace",OLD."namespace") AND m0."id"=rid;
 ELSE RAISE EXCEPTION 'unexpected source for Huroof start closure'; END IF;
 IF aid IS NULL THEN
  IF TG_TABLE_NAME='HuroofRoom' AND COALESCE(NEW."status",OLD."status")='SETUP' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='HuroofRoom' THEN RAISE EXCEPTION 'active or closed Huroof room requires a typed same-room canonical match'; END IF;
  IF TG_TABLE_NAME IN ('HuroofMatch','HuroofMatchPin','HuroofCanonicalState','HuroofCommandReceipt','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofOutboxDelivery') THEN RAISE EXCEPTION 'owned Huroof start participant cannot be orphaned'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO a FROM public."Admission" WHERE "id"=aid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Huroof start participant has no shared admission'; END IF;
 IF a."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' THEN
  IF TG_TABLE_NAME IN ('HuroofMatch','HuroofMatchPin','HuroofCanonicalState','HuroofCommandReceipt','HuroofProjection','HuroofEvent','HuroofRealtimeOutbox','HuroofOutboxDelivery') THEN RAISE EXCEPTION 'owned Huroof participant cannot attach to legacy admission'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO r FROM public."Reservation" WHERE "admissionId"=aid;
 IF NOT FOUND OR r."quantity"<>1 OR a."state"<>'COMMITTED' OR r."state"<>'COMMITTED' THEN RAISE EXCEPTION 'PG Huroof start requires committed shared admission and reservation'; END IF;
 SELECT count(*) FILTER(WHERE e."effect"='RESERVE'), count(*) FILTER(WHERE e."effect"='COMMIT'), count(*) FILTER(WHERE e."effect"='RELEASE') INTO reserve_n,commit_n,release_n FROM public."WalletEntry" e WHERE e."reservationId"=r."id";
 IF reserve_n<>1 OR commit_n<>1 OR release_n<>0 THEN RAISE EXCEPTION 'PG Huroof shared ledger must contain exact RESERVE and COMMIT'; END IF;
 SELECT count(*) INTO match_n FROM public."HuroofMatch" mm WHERE mm."admissionId"=aid AND mm."ownerFirebaseIdentityId"=a."firebaseIdentityId";
 IF match_n<>1 THEN RAISE EXCEPTION 'PG Huroof admission requires exactly one typed match'; END IF;
 SELECT * INTO m FROM public."HuroofMatch" mm WHERE mm."admissionId"=aid;
 IF m."rawIntentHash" IS DISTINCT FROM encode(int4_crypto.digest(m."rawIntent",'sha256'),'hex') OR a."intentHash" IS DISTINCT FROM m."rawIntentHash" OR a."requestHash" IS DISTINCT FROM public.int5b_hash_json(convert_from(m."rawIntent",'UTF8')::JSONB->'request') OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'identityId' IS DISTINCT FROM a."firebaseIdentityId" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'requestKey' IS DISTINCT FROM a."requestKey" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'logicalMatchId' IS DISTINCT FROM a."logicalMatchId" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'version' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'PG Huroof admission, complete canonical raw intent and request identity disagree'; END IF;
 IF a."requestHash" IS DISTINCT FROM public.int5b_hash_json(convert_from(m."rawIntent",'UTF8')::JSONB->'request') OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'identityId' IS DISTINCT FROM a."firebaseIdentityId" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'requestKey' IS DISTINCT FROM a."requestKey" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->>'logicalMatchId' IS DISTINCT FROM a."logicalMatchId" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'namespace' IS DISTINCT FROM m."namespace" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'roomId' IS DISTINCT FROM m."roomId" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'admissionId' IS DISTINCT FROM a."id" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'matchId' IS DISTINCT FROM m."id" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'initial'->'config' IS DISTINCT FROM m."config" OR convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'initial'->>'configHash' IS DISTINCT FROM m."configHash" THEN RAISE EXCEPTION 'stored request envelope is detached from the paid match'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofMatchPin" p JOIN public."CatalogValidationReceipt" cr ON cr."id"=p."validationReceiptId" AND cr."catalogReleaseId"=p."catalogReleaseId" AND cr."releaseRootHash"=p."releaseRootHash" AND cr."sealHash"=p."catalogSealHash" JOIN public."CatalogReleaseSeal" cs ON cs."catalogReleaseId"=cr."catalogReleaseId" AND cs."releaseRootHash"=cr."releaseRootHash" AND cs."sealHash"=cr."sealHash" JOIN public."HuroofContentRevision" cv ON (cv."namespace",cv."family",cv."sourceId",cv."revision",cv."rawArtifactId",cv."rawArtifactHash",cv."validationReceiptId",cv."catalogReleaseId",cv."releaseRootHash")=(p."namespace",p."profileFamily",p."profileSourceId",p."profileRevision",p."profileRawArtifactId",p."profileRawArtifactHash",p."validationReceiptId",p."catalogReleaseId",p."releaseRootHash") JOIN public."HuroofRawArtifact" ra ON (ra."namespace",ra."id",ra."contentHash")=(cv."namespace",cv."rawArtifactId",cv."rawArtifactHash") JOIN public."HuroofIdentityPolicyRevision" pr ON (pr."namespace",pr."revision",pr."policyHash")=(m."namespace",m."policyRevision",m."policyHash") JOIN public."FirebaseIdentity" fi ON fi."id"=m."ownerFirebaseIdentityId" JOIN public."DeploymentNamespace" dn ON dn."namespaceId"=m."namespace" WHERE p."namespace"=m."namespace" AND p."matchId"=m."id" AND fi."firebaseProjectId"=dn."firebaseProjectId" AND dn."firebaseProjectId"=pr."firebaseProjectId" AND cr."huroofProjectId"=pr."firebaseProjectId" AND cr."huroofReleaseId"=m."config"->>'releaseId' AND cr."huroofRootSha256"=m."config"->>'releaseRootSha256' AND pr."rawPolicy" IS NOT NULL AND convert_from(ra."rawBytes",'UTF8')::JSONB=m."profile" AND p."profile"=m."profile" AND p."profileRawArtifactId"=m."profileRawArtifactId" AND p."profileRawArtifactHash"=m."profileHash" AND m."profileRawArtifactId"=cv."rawArtifactId" AND m."profileHash"=cv."rawArtifactHash" AND p."config"=m."config" AND public.int5b_hash_json(m."config")=m."configHash" AND (convert_from(m."rawIntent",'UTF8')::JSONB->'resolved')=jsonb_build_object('namespace',m."namespace",'roomId',m."roomId",'ownerFirebaseIdentityId',m."ownerFirebaseIdentityId",'admissionId',a."id",'matchId',m."id",'firebaseProjectId',pr."firebaseProjectId",'policyRevision',pr."revision",'policyHash',pr."policyHash",'profileScope',p."profileScope",'profileFamily',cv."family",'profileSourceId',cv."sourceId",'profileRevision',cv."revision",'profileRawArtifactId',cv."rawArtifactId",'profileRawArtifactHash',cv."rawArtifactHash",'validationReceiptId',cr."id",'catalogReleaseId',cr."catalogReleaseId",'releaseRootHash',cr."releaseRootHash",'catalogSealHash',cr."sealHash",'sourceRef',cr."sourceEvidenceManifestHash",'rawRefs',jsonb_build_object('profileId',cv."rawArtifactId",'profileHash',cv."rawArtifactHash"),'selector',jsonb_build_object('selectorVersion',cr."selectorVersion",'capabilityStateHash',cr."huroofCapabilityStateHash"),'selectorVersion',cr."selectorVersion",'readinessPolicyVersion',cr."policyVersion",'config',m."config",'configHash',m."configHash") AND convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'profileScope'=p."profileScope" AND convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'selectorVersion'=cr."selectorVersion" AND convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'policyRevision'=pr."revision"::TEXT AND convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'policyHash'=pr."policyHash" AND convert_from(m."rawIntent",'UTF8')::JSONB->'request'->'intent'->>'readinessPolicyVersion'=cr."policyVersion" AND p."sourceRef"=cr."sourceEvidenceManifestHash" AND p."rawRefs"=jsonb_build_object('profileId',cv."rawArtifactId",'profileHash',cv."rawArtifactHash") AND p."selector"=jsonb_build_object('selectorVersion',cr."selectorVersion",'capabilityStateHash',cr."huroofCapabilityStateHash")) THEN RAISE EXCEPTION 'historical paid start pins do not match the sealed intent'; END IF;
 SELECT * INTO room FROM public."HuroofRoom" WHERE ("namespace","id","ownerFirebaseIdentityId")=(m."namespace",m."roomId",m."ownerFirebaseIdentityId");
 IF NOT FOUND OR room."status" NOT IN ('ACTIVE','CLOSED') OR NOT EXISTS(SELECT 1 FROM public."HuroofCanonicalState" s JOIN public."HuroofEvent" e ON e."namespace"=s."namespace" AND e."roomId"=s."roomId" WHERE s."namespace"=m."namespace" AND s."roomId"=m."roomId" AND e."matchId"=m."id" AND e."eventType"='STARTED' AND s."sequence">=e."sequence" AND s."revision">=e."revision" AND s."status" IN ('ACTIVE','FINISHED','CLOSED') AND (s."sequence">e."sequence" OR (s."activeMatchId"=m."id" AND s."status"='ACTIVE'))) THEN RAISE EXCEPTION 'PG Huroof start requires canonical room state'; END IF;
 SELECT count(*) INTO event_n FROM public."HuroofEvent" e WHERE e."namespace"=m."namespace" AND e."roomId"=m."roomId" AND e."matchId"=m."id" AND e."eventType"='STARTED';
 SELECT count(*) INTO outbox_n FROM public."HuroofRealtimeOutbox" o JOIN public."HuroofEvent" e ON e."namespace"=o."namespace" AND e."roomId"=o."roomId" AND e."sequence"=o."sequence" AND e."id"=o."eventId" WHERE e."namespace"=m."namespace" AND e."roomId"=m."roomId" AND e."matchId"=m."id" AND e."eventType"='STARTED';
 SELECT count(*) INTO delivery_n FROM public."HuroofOutboxDelivery" d JOIN public."HuroofRealtimeOutbox" o ON (o."namespace",o."roomId",o."sequence")=(d."namespace",d."roomId",d."sequence") JOIN public."HuroofEvent" e ON e."namespace"=o."namespace" AND e."roomId"=o."roomId" AND e."sequence"=o."sequence" AND e."id"=o."eventId" WHERE e."namespace"=m."namespace" AND e."roomId"=m."roomId" AND e."matchId"=m."id" AND e."eventType"='STARTED';
 SELECT count(*) INTO receipt_n FROM public."HuroofCommandReceipt" c JOIN public."HuroofEvent" e ON e."namespace"=c."namespace" AND e."roomId"=c."roomId" AND e."matchId"=c."matchId" AND e."sequence"=c."resultingSequence" AND e."revision"=c."resultingRevision" AND e."actorFirebaseIdentityId"=c."actorFirebaseIdentityId" AND e."requestKey"=c."requestKey" WHERE c."namespace"=m."namespace" AND c."roomId"=m."roomId" AND c."matchId"=m."id" AND c."actorFirebaseIdentityId"=a."firebaseIdentityId" AND c."requestKey"=a."requestKey" AND c."intent"=m."rawIntent" AND c."intentHash"=m."rawIntentHash" AND c."outcome" IS NOT NULL AND c."outcomeHash"=encode(int4_crypto.digest(c."outcome",'sha256'),'hex') AND convert_from(c."outcome",'UTF8')::JSONB->>'admissionId'=a."id" AND convert_from(c."outcome",'UTF8')::JSONB->>'matchId'=m."id" AND convert_from(c."outcome",'UTF8')::JSONB->>'roomId'=m."roomId" AND convert_from(c."outcome",'UTF8')::JSONB->>'status'='STARTED' AND e."eventType"='STARTED';
 SELECT count(*) INTO projection_n FROM public."HuroofProjection" p JOIN public."HuroofEvent" e ON e."namespace"=p."namespace" AND e."roomId"=p."roomId" WHERE p."namespace"=m."namespace" AND p."roomId"=m."roomId" AND p."audience"='PUBLIC' AND p."scope"='public' AND p."authGeneration">=room."generation" AND e."matchId"=m."id" AND e."eventType"='STARTED' AND p."throughSequence">=e."sequence" AND p."revision">=e."revision";
 IF event_n<>1 OR outbox_n<>1 OR delivery_n<>1 OR receipt_n<>1 OR projection_n<1 THEN RAISE EXCEPTION 'PG Huroof start requires exact command, event, safe projection, invalidation and delivery closure'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Admission_pg_huroof_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."Admission" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "Reservation_pg_huroof_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."Reservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "WalletEntry_pg_huroof_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."WalletEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofMatch_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofMatchPin_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofMatchPin" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofCanonicalState_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofCanonicalState" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofRoom_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofRoom" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofCommandReceipt_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofCommandReceipt" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofProjection_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofProjection" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofEvent_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofRealtimeOutbox_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofRealtimeOutbox" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();
CREATE CONSTRAINT TRIGGER "HuroofOutboxDelivery_start_closure" AFTER INSERT OR UPDATE OR DELETE ON public."HuroofOutboxDelivery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.eng03_02_start_closure();

CREATE OR REPLACE FUNCTION public.eng03_02_has_secret_key(p_value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item RECORD;
BEGIN
 IF jsonb_typeof(p_value)='object' THEN
  FOR item IN SELECT key,value FROM pg_catalog.jsonb_each(p_value) LOOP
   IF lower(item.key)=ANY(ARRAY['access_token','accesstoken','id_token','idtoken','refresh_token','refreshtoken','authorization','credential','credentials','password','secret','private_key','privatekey','signature','firebase_token']) OR public.eng03_02_has_secret_key(item.value) THEN RETURN TRUE; END IF;
  END LOOP;
 ELSIF jsonb_typeof(p_value)='array' THEN
  FOR item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP
   IF public.eng03_02_has_secret_key(item.value) THEN RETURN TRUE; END IF;
  END LOOP;
 END IF;
 RETURN FALSE;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_huroof_start(p_identity TEXT,p_request_key TEXT,p_logical_match_id TEXT,p_intent JSONB,p_initial JSONB) RETURNS JSONB
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
 has_request BOOLEAN:=FALSE; has_logical BOOLEAN:=FALSE;
BEGIN
 IF p_identity IS NULL OR p_request_key IS NULL OR p_request_key='' OR p_logical_match_id IS NULL OR p_logical_match_id='' OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR jsonb_typeof(p_initial) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'typed start request required'; END IF;
 -- No caller EXECUTE is granted until ENG03-03 supplies genuine service auth.
 -- This subject argument is never an authentication proof; no JSON/GUC flag substitutes for verified context.
 IF public.eng03_02_has_secret_key(p_intent) OR public.eng03_02_has_secret_key(p_initial) THEN RAISE EXCEPTION 'credential-shaped request material is not persistable'; END IF;
 IF p_intent->>'namespace' IS NULL OR p_intent->>'roomId' IS NULL OR p_intent->>'profileScope' IS NULL OR p_intent->>'policyRevision' IS NULL OR p_intent->>'policyHash' IS NULL OR p_intent->>'selectorVersion' IS NULL OR p_intent->>'admissionId' IS NULL OR p_intent->>'matchId' IS NULL THEN RAISE EXCEPTION 'complete canonical owner intent required'; END IF;
 IF (p_intent ? 'requestKey' AND p_intent->>'requestKey' IS DISTINCT FROM p_request_key) OR (p_intent ? 'logicalMatchId' AND p_intent->>'logicalMatchId' IS DISTINCT FROM p_logical_match_id) THEN RAISE EXCEPTION 'request identity disagrees with canonical intent'; END IF;
 IF (p_initial-ARRAY['config','configHash']::TEXT[])<>'{}'::JSONB OR p_initial->'config' IS NULL OR jsonb_typeof(p_initial->'config') IS DISTINCT FROM 'object' OR p_initial->>'configHash' IS NULL THEN RAISE EXCEPTION 'initial state must contain only the typed config and its hash'; END IF;
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
  RETURN convert_from(c."outcome",'UTF8')::JSONB;
 END IF;

 IF w."debt">0 OR w."available"<1 THEN RAISE EXCEPTION 'wallet cannot reserve'; END IF;
 SELECT * INTO identity_row FROM public."FirebaseIdentity" WHERE "id"=p_identity;
 SELECT * INTO namespace_row FROM public."DeploymentNamespace" WHERE "namespaceId"=p_intent->>'namespace';
 IF NOT FOUND OR identity_row."firebaseProjectId" IS DISTINCT FROM namespace_row."firebaseProjectId" THEN RAISE EXCEPTION 'current identity and namespace project do not match'; END IF;
 SELECT * INTO room FROM public."HuroofRoom" WHERE "namespace"=p_intent->>'namespace' AND "id"=p_intent->>'roomId' AND "ownerFirebaseIdentityId"=p_identity FOR UPDATE;
 IF NOT FOUND OR room."status" NOT IN ('SETUP','ACTIVE') THEN RAISE EXCEPTION 'owned room unavailable'; END IF;
 SELECT * INTO state_row FROM public."HuroofCanonicalState" WHERE "namespace"=room."namespace" AND "roomId"=room."id" FOR UPDATE;
 IF FOUND THEN
  IF state_row."status" IS DISTINCT FROM 'FINISHED' OR state_row."activeMatchId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."HuroofMatch" pm JOIN public."HuroofMatchResult" pr ON pr."namespace"=pm."namespace" AND pr."matchId"=pm."id" AND pr."ownerFirebaseIdentityId"=pm."ownerFirebaseIdentityId" AND pr."admissionId"=pm."admissionId" JOIN public."HuroofEvent" pe ON pe."namespace"=pr."namespace" AND pe."roomId"=pr."roomId" AND pe."sequence"=pr."terminalSequence" AND pe."id"=pr."terminalEventId" AND pe."matchId"=pr."matchId" WHERE pm."namespace"=room."namespace" AND pm."id"=state_row."activeMatchId" AND pm."roomId"=room."id" AND pm."ownerFirebaseIdentityId"=room."ownerFirebaseIdentityId" AND pm."state" IN ('FINISHED','ABANDONED') AND pe."eventType"=pm."state") THEN RAISE EXCEPTION 'next match requires the current same-room match terminal result'; END IF;
  seq:=state_row."sequence"+1; rev:=state_row."revision"+1;
 ELSE seq:=1; rev:=1; END IF;
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

 INSERT INTO public."Admission"("id","firebaseIdentityId","walletId","engine","operation","mode","logicalMatchId","requestKey","requestHash","intentHash","requestVersion","selectorVersion","state","version","storageAuthority","updatedAt")
 VALUES(admission_id,p_identity,w."id",'HUROOF','HOSTED_HUROOF_PG_V2','CLASSIC',p_logical_match_id,p_request_key,request_hash,intent_hash,2,receipt."selectorVersion",'HELD',0,'PG_HUROOF_V2',clock_timestamp());
 INSERT INTO public."Reservation"("id","admissionId","quantity","state","updatedAt") VALUES(reservation_id,admission_id,1,'HELD',clock_timestamp());
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(admission_id||':reserve',w."id",w."version"+1,'ADMISSION',admission_id,'RESERVE',reservation_id,-1,1,0,w."available"-1,w."held"+1,w."debt",p_identity);
 UPDATE public."Wallet" SET "available"="available"-1,"held"="held"+1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 INSERT INTO public."HuroofMatch"("namespace","id","roomId","ownerFirebaseIdentityId","admissionId","profile","profileRawArtifactId","profileHash","config","configHash","rawIntent","rawIntentHash","policyRevision","policyHash","state") VALUES(room."namespace",match_id,room."id",p_identity,admission_id,profile,raw_profile."id",raw_profile."contentHash",cfg,p_initial->>'configHash',intent_bytes,intent_hash,policy_head."revision",policy_head."policyHash",'STARTED');
 INSERT INTO public."HuroofMatchPin"("namespace","matchId","profileScope","validationReceiptId","catalogReleaseId","releaseRootHash","profileFamily","profileSourceId","profileRevision","profileRawArtifactId","profileRawArtifactHash","catalogSealHash","sourceRef","rawRefs","selector","config","profile") VALUES(room."namespace",match_id,p_intent->>'profileScope',receipt."id",receipt."catalogReleaseId",receipt."releaseRootHash",profile_revision."family",profile_revision."sourceId",profile_revision."revision",profile_revision."rawArtifactId",profile_revision."rawArtifactHash",receipt."sealHash",receipt."sourceEvidenceManifestHash",jsonb_build_object('profileId',profile_revision."rawArtifactId",'profileHash',profile_revision."rawArtifactHash"),jsonb_build_object('selectorVersion',receipt."selectorVersion",'capabilityStateHash',receipt."huroofCapabilityStateHash"),cfg,profile);
 reply:=jsonb_build_object('admissionId',admission_id,'matchId',match_id,'roomId',room."id",'status','STARTED','state','COMMITTED','revision',rev,'sequence',seq);
 INSERT INTO public."HuroofCommandReceipt"("namespace","roomId","actorFirebaseIdentityId","requestKey","matchId","intent","intentHash","outcome","outcomeHash","resultingRevision","resultingSequence") VALUES(room."namespace",room."id",p_identity,p_request_key,match_id,intent_bytes,intent_hash,convert_to(reply::TEXT,'UTF8'),encode(int4_crypto.digest(convert_to(reply::TEXT,'UTF8'),'sha256'),'hex'),rev,seq);
 INSERT INTO public."HuroofCanonicalState"("namespace","roomId","ownerFirebaseIdentityId","activeMatchId","status","revision","sequence","privateState") VALUES(room."namespace",room."id",p_identity,match_id,'ACTIVE',rev,seq,jsonb_build_object('matchId',match_id,'profileHash',raw_profile."contentHash",'configHash',p_initial->>'configHash','phase','STARTED')) ON CONFLICT("namespace","roomId") DO UPDATE SET "activeMatchId"=EXCLUDED."activeMatchId","status"='ACTIVE',"revision"=EXCLUDED."revision","sequence"=EXCLUDED."sequence","privateState"=EXCLUDED."privateState","updatedAt"=clock_timestamp();
 UPDATE public."HuroofRoom" SET "status"='ACTIVE',"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "namespace"=room."namespace" AND "id"=room."id";
 INSERT INTO public."HuroofEvent"("namespace","roomId","sequence","id","matchId","actorFirebaseIdentityId","requestKey","revision","eventType") VALUES(room."namespace",room."id",seq,event_id,match_id,p_identity,p_request_key,rev,'STARTED');
 INSERT INTO public."HuroofProjection"("namespace","roomId","audience","scope","revision","throughSequence","authGeneration","payload") VALUES(room."namespace",room."id",'PUBLIC','public',rev,seq,room."generation",jsonb_build_object('status','ACTIVE','revision',rev)) ON CONFLICT("namespace","roomId","audience","scope") DO UPDATE SET "revision"=EXCLUDED."revision","throughSequence"=EXCLUDED."throughSequence","authGeneration"=EXCLUDED."authGeneration","payload"=EXCLUDED."payload","updatedAt"=clock_timestamp();
 INSERT INTO public."HuroofRealtimeOutbox"("namespace","roomId","sequence","eventId") VALUES(room."namespace",room."id",seq,event_id);
 INSERT INTO public."HuroofOutboxDelivery"("namespace","roomId","sequence") VALUES(room."namespace",room."id",seq);
 INSERT INTO public."WalletEntry"("id","walletId","sequence","originType","originId","effect","reservationId","deltaAvailable","deltaHeld","deltaDebt","resultingAvailable","resultingHeld","resultingDebt","actorFirebaseIdentityId") VALUES(admission_id||':commit',w."id",w."version"+2,'ADMISSION',admission_id,'COMMIT',reservation_id,0,-1,0,w."available"-1,w."held",w."debt",p_identity);
 UPDATE public."Wallet" SET "held"="held"-1,"version"="version"+1,"updatedAt"=clock_timestamp() WHERE "id"=w."id";
 UPDATE public."Admission" SET "state"='COMMITTED',"version"=1,"updatedAt"=clock_timestamp() WHERE "id"=admission_id;
 UPDATE public."Reservation" SET "state"='COMMITTED',"committedAt"=clock_timestamp(),"updatedAt"=clock_timestamp() WHERE "id"=reservation_id;
 RETURN reply;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_huroof_find_start(p_identity TEXT,p_key TEXT,p_logical TEXT,p_namespace TEXT,p_room TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request_admission public."Admission"%ROWTYPE; logical_admission public."Admission"%ROWTYPE; a public."Admission"%ROWTYPE; m public."HuroofMatch"%ROWTYPE; r public."Reservation"%ROWTYPE; c public."HuroofCommandReceipt"%ROWTYPE; has_request BOOLEAN:=FALSE; has_logical BOOLEAN:=FALSE;
BEGIN
 IF p_identity IS NULL OR p_namespace IS NULL OR p_room IS NULL OR (p_key IS NULL AND p_logical IS NULL) OR NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r WHERE r."namespace"=p_namespace AND r."id"=p_room AND (r."ownerFirebaseIdentityId"=p_identity OR EXISTS(SELECT 1 FROM public."HuroofMember" mb WHERE mb."namespace"=r."namespace" AND mb."roomId"=r."id" AND mb."firebaseIdentityId"=p_identity AND mb."revokedAt" IS NULL))) THEN RAISE EXCEPTION 'current room authority required'; END IF;
 IF p_key IS NOT NULL THEN SELECT * INTO request_admission FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "requestKey"=p_key; has_request:=FOUND; END IF;
 IF p_logical IS NOT NULL THEN SELECT * INTO logical_admission FROM public."Admission" WHERE "firebaseIdentityId"=p_identity AND "engine"='HUROOF' AND "logicalMatchId"=p_logical; has_logical:=FOUND; END IF;
 IF has_request AND has_logical AND request_admission."id"<>logical_admission."id" THEN RAISE EXCEPTION 'global request and logical-match keys resolve to distinct admissions'; END IF;
 IF NOT has_request AND NOT has_logical THEN RETURN NULL; END IF;
 IF has_request THEN a:=request_admission; ELSE a:=logical_admission; END IF;
 IF a."storageAuthority" IS DISTINCT FROM 'PG_HUROOF_V2' OR a."operation" IS DISTINCT FROM 'HOSTED_HUROOF_PG_V2' THEN RAISE EXCEPTION 'legacy or cross-generation idempotency collision'; END IF;
 IF a."state" IS DISTINCT FROM 'COMMITTED' THEN RAISE EXCEPTION 'paid start admission is not committed'; END IF;
 SELECT * INTO m FROM public."HuroofMatch" WHERE "admissionId"=a."id" AND "ownerFirebaseIdentityId"=p_identity AND "namespace"=p_namespace AND "roomId"=p_room;
 IF NOT FOUND THEN RAISE EXCEPTION 'start key does not resolve within the authorized namespace and room'; END IF;
 SELECT * INTO r FROM public."Reservation" WHERE "admissionId"=a."id";
 IF NOT FOUND OR r."state" IS DISTINCT FROM 'COMMITTED' OR r."quantity"<>1 THEN RAISE EXCEPTION 'paid start lookup requires committed reservation'; END IF;
 SELECT * INTO c FROM public."HuroofCommandReceipt" WHERE "namespace"=p_namespace AND "roomId"=p_room AND "actorFirebaseIdentityId"=p_identity AND "requestKey"=a."requestKey" AND "matchId"=m."id";
 IF NOT FOUND OR c."intent" IS DISTINCT FROM m."rawIntent" OR c."intentHash" IS DISTINCT FROM m."rawIntentHash" OR c."outcomeHash" IS DISTINCT FROM encode(int4_crypto.digest(c."outcome",'sha256'),'hex') THEN RAISE EXCEPTION 'paid start lookup requires exact sealed command result'; END IF;
 RETURN convert_from(c."outcome",'UTF8')::JSONB;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_huroof_snapshot(p_namespace TEXT,p_room TEXT,p_actor TEXT,p_audience TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public."HuroofProjection"%ROWTYPE;
BEGIN
 IF p_namespace IS NULL OR p_room IS NULL OR p_audience IS NULL OR p_audience NOT IN ('OWNER','MEMBER','PUBLIC') OR (p_audience<>'PUBLIC' AND p_actor IS NULL) OR (p_audience='OWNER' AND NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r WHERE r."namespace"=p_namespace AND r."id"=p_room AND r."ownerFirebaseIdentityId"=p_actor)) OR (p_audience='MEMBER' AND NOT EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."firebaseIdentityId"=p_actor AND m."revokedAt" IS NULL)) THEN RAISE EXCEPTION 'current projection audience authority required'; END IF;
 SELECT * INTO p FROM public."HuroofProjection" WHERE "namespace"=p_namespace AND "roomId"=p_room AND "audience"=p_audience AND "scope"=(CASE WHEN p_audience='PUBLIC' THEN 'public' ELSE p_actor END);
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r WHERE r."namespace"=p."namespace" AND r."id"=p."roomId" AND r."generation"=p."authGeneration") THEN RAISE EXCEPTION 'stale projection authorization generation'; END IF;
 RETURN jsonb_build_object('revision',p."revision",'throughSequence',p."throughSequence",'payload',p."payload");
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_huroof_replay(p_namespace TEXT,p_room TEXT,p_actor TEXT,p_audience TEXT,p_after BIGINT,p_limit INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE events JSONB;
BEGIN
 IF p_namespace IS NULL OR p_room IS NULL OR p_after IS NULL OR p_after<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_audience IS NULL OR p_audience NOT IN ('OWNER','MEMBER','PUBLIC') OR (p_audience<>'PUBLIC' AND p_actor IS NULL) THEN RAISE EXCEPTION 'bounded replay cursor and authority required'; END IF;
 IF (p_audience='OWNER' AND NOT EXISTS(SELECT 1 FROM public."HuroofRoom" r WHERE r."namespace"=p_namespace AND r."id"=p_room AND r."ownerFirebaseIdentityId"=p_actor)) OR (p_audience='MEMBER' AND NOT EXISTS(SELECT 1 FROM public."HuroofMember" m WHERE m."namespace"=p_namespace AND m."roomId"=p_room AND m."firebaseIdentityId"=p_actor AND m."revokedAt" IS NULL)) THEN RAISE EXCEPTION 'current replay authority required'; END IF;
 SELECT jsonb_agg(jsonb_build_object('sequence',x."sequence",'revision',x."revision") ORDER BY x."sequence") INTO events FROM (SELECT "sequence","revision" FROM public."HuroofEvent" WHERE "namespace"=p_namespace AND "roomId"=p_room AND "sequence">p_after ORDER BY "sequence" LIMIT p_limit) x;
 RETURN COALESCE(events,'[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_outbox_claim(p_owner TEXT,p_limit INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE jobs JSONB;
BEGIN
 IF p_owner IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,120}$' OR p_limit IS NULL OR p_limit<1 OR p_limit>50 OR NOT pg_has_role(current_user,'huroof_pg_outbox_executor','member') THEN RAISE EXCEPTION 'fixed bounded outbox executor required'; END IF;
 WITH picked AS (SELECT "namespace","roomId","sequence" FROM public."HuroofOutboxDelivery" WHERE ("state"='PENDING' OR ("state"='LEASED' AND "leaseExpiresAt"<=clock_timestamp())) ORDER BY "updatedAt","sequence" LIMIT p_limit FOR UPDATE SKIP LOCKED), updated AS (UPDATE public."HuroofOutboxDelivery" d SET "state"='LEASED',"leaseOwner"=p_owner,"leaseVersion"=d."leaseVersion"+1,"leaseExpiresAt"=clock_timestamp()+INTERVAL '30 seconds',"attemptCount"=d."attemptCount"+1,"updatedAt"=clock_timestamp() FROM picked p WHERE (d."namespace",d."roomId",d."sequence")=(p."namespace",p."roomId",p."sequence") RETURNING d."namespace",d."roomId",d."sequence",d."leaseVersion") SELECT jsonb_agg(jsonb_build_object('namespace',"namespace",'roomId',"roomId",'sequence',"sequence",'leaseVersion',"leaseVersion") ORDER BY "sequence") INTO jobs FROM updated;
 RETURN COALESCE(jobs,'[]'::JSONB);
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_outbox_complete(p_namespace TEXT,p_room TEXT,p_sequence BIGINT,p_owner TEXT,p_version BIGINT,p_success BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT pg_has_role(current_user,'huroof_pg_outbox_executor','member') THEN RAISE EXCEPTION 'fixed bounded outbox executor required'; END IF;
 UPDATE public."HuroofOutboxDelivery" SET "state"=(CASE WHEN p_success THEN 'DONE' ELSE 'PENDING' END),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=clock_timestamp() WHERE "namespace"=p_namespace AND "roomId"=p_room AND "sequence"=p_sequence AND "state"='LEASED' AND "leaseOwner"=p_owner AND "leaseVersion"=p_version AND "leaseExpiresAt">clock_timestamp();
 RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.eng03_02_owner_history(p_namespace TEXT,p_owner TEXT,p_actor TEXT,p_query JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE n INTEGER; cursor_seq BIGINT; rows JSONB;
BEGIN
 IF p_namespace IS NULL OR p_owner IS NULL OR p_actor IS NULL OR p_actor IS DISTINCT FROM p_owner OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'owner history authority required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."FirebaseIdentity" i JOIN public."HuroofRoom" r ON r."ownerFirebaseIdentityId"=i."id" WHERE i."id"=p_owner AND r."namespace"=p_namespace) THEN RETURN '[]'::JSONB; END IF;
 n:=LEAST(GREATEST(COALESCE((p_query->>'limit')::INTEGER,50),1),100); cursor_seq:=GREATEST(COALESCE((p_query->>'after')::BIGINT,0),0);
 SELECT jsonb_agg(jsonb_build_object('sequence',e."sequence",'matchId',e."matchId",'resultVersion',e."resultVersion",'resultHash',e."resultHash",'occurredAt',e."occurredAt") ORDER BY e."sequence") INTO rows FROM (SELECT * FROM public."HuroofOwnerHistoryEntry" WHERE "namespace"=p_namespace AND "ownerFirebaseIdentityId"=p_owner AND "sequence">cursor_seq ORDER BY "sequence" LIMIT n) e;
 RETURN COALESCE(rows,'[]'::JSONB);
END $$;

REVOKE ALL ON FUNCTION public.eng03_02_huroof_start(TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_find_start(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_snapshot(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_huroof_replay(TEXT,TEXT,TEXT,TEXT,BIGINT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_outbox_claim(TEXT,INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_outbox_complete(TEXT,TEXT,BIGINT,TEXT,BIGINT,BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_owner_history(TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_admission_authority_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_start_closure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_immutable_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_reject_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_mutable_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_policy_head_cas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_pointer_cas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_proof_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_outbox_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_has_secret_key(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_result_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_rematch_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_history_head_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_history_entry_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_content_revision_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.eng03_02_projection_guard() FROM PUBLIC;

-- No application EXECUTE grants in ENG03-02: Firebase project/UID arguments
-- are not authentication. ENG03-03 must provide real verified service context.


COMMIT;
