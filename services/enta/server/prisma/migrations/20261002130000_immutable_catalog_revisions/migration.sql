-- DRAFT ONLY: do not apply before the isolated target's version, row counts,
-- lock plan, backup and restore rehearsal are reviewed. No content is backfilled.
-- Existing tables gain nullable pins. The repair snapshots historical null-pin
-- identities and guards every new game/question pin at the database boundary.
-- Fail before any DDL if the separately provisioned managed-Postgres boundary is absent.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto' AND n.nspname='int4_crypto') THEN
   RAISE EXCEPTION 'pgcrypto must be provisioned in restricted int4_crypto schema by the database owner before INT-4R migration';
 END IF;
 IF EXISTS(
   SELECT 1 FROM pg_namespace n
   CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) privilege
   WHERE n.nspname='int4_crypto' AND privilege.privilege_type='CREATE' AND privilege.grantee<>n.nspowner
 ) THEN RAISE EXCEPTION 'only the owner may have CREATE on int4_crypto'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='enta_runtime')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalog_assembler')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalog_reviewer')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalog_publisher')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalog_validator')
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='catalog_activator') THEN
   RAISE EXCEPTION 'INT-4R publication roles must be provisioned by the database owner before migration';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('enta_runtime','catalog_assembler','catalog_reviewer','catalog_publisher','catalog_validator','catalog_activator') AND rolcanlogin) THEN
   RAISE EXCEPTION 'INT-4R role groups must remain NOLOGIN; provision login roles separately';
 END IF;
 IF pg_has_role('enta_runtime','catalog_assembler','member') OR pg_has_role('enta_runtime','catalog_reviewer','member') OR pg_has_role('enta_runtime','catalog_publisher','member') OR pg_has_role('enta_runtime','catalog_validator','member') OR pg_has_role('enta_runtime','catalog_activator','member') THEN
   RAISE EXCEPTION 'enta_runtime must not inherit any publication workflow role';
 END IF;
 IF pg_has_role('catalog_assembler','catalog_reviewer','member') OR pg_has_role('catalog_assembler','catalog_publisher','member') OR pg_has_role('catalog_assembler','catalog_validator','member') OR pg_has_role('catalog_assembler','catalog_activator','member')
   OR pg_has_role('catalog_reviewer','catalog_assembler','member') OR pg_has_role('catalog_reviewer','catalog_publisher','member') OR pg_has_role('catalog_reviewer','catalog_validator','member') OR pg_has_role('catalog_reviewer','catalog_activator','member')
   OR pg_has_role('catalog_publisher','catalog_assembler','member') OR pg_has_role('catalog_publisher','catalog_reviewer','member') OR pg_has_role('catalog_publisher','catalog_validator','member') OR pg_has_role('catalog_publisher','catalog_activator','member')
   OR pg_has_role('catalog_validator','catalog_assembler','member') OR pg_has_role('catalog_validator','catalog_reviewer','member') OR pg_has_role('catalog_validator','catalog_publisher','member') OR pg_has_role('catalog_validator','catalog_activator','member')
   OR pg_has_role('catalog_activator','catalog_assembler','member') OR pg_has_role('catalog_activator','catalog_reviewer','member') OR pg_has_role('catalog_activator','catalog_publisher','member') OR pg_has_role('catalog_activator','catalog_validator','member') THEN
   RAISE EXCEPTION 'INT-4R publication workflow roles must remain mutually separate';
 END IF;
END $$;

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "catalogReleaseId" TEXT;

-- AlterTable
ALTER TABLE "GameQuestion" ADD COLUMN     "catalogReleaseId" TEXT,
ADD COLUMN     "questionRevisionId" TEXT;

-- CreateTable
CREATE TABLE "SourceCategoryCrosswalkRevision" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceCategoryId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "canonicalCategoryKey" TEXT NOT NULL,
    "mappingHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCategoryCrosswalkRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalCategoryRevision" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL DEFAULT 'canonical.category',
    "categoryKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "labelAr" TEXT NOT NULL,
    "description" TEXT,
    "coverMediaRevisionId" TEXT,
    "contentHash" TEXT NOT NULL,
    "editorialReceiptId" TEXT NOT NULL,
    "editorialDecision" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalCategoryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialReviewReceipt" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRevision" INTEGER NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewerRef" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialReviewReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRightsReceipt" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rightsHolderRef" TEXT NOT NULL,
    "licenseRef" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRightsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionRevision" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceQuestionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceContentHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "sourceCategoryId" TEXT NOT NULL,
    "crosswalkRevisionId" TEXT NOT NULL,
    "crosswalkRevision" INTEGER NOT NULL,
    "canonicalCategoryKey" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "hints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "modality" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "editorialReceiptId" TEXT NOT NULL,
    "editorialDecision" TEXT NOT NULL DEFAULT 'APPROVED',
    "rightsReceiptId" TEXT NOT NULL,
    "rightsSubjectType" TEXT NOT NULL DEFAULT 'QUESTION',
    "rightsDecision" TEXT NOT NULL DEFAULT 'CLEARED',
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAnswerRevision" (
    "id" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "questionContentHash" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "isTrap" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionAnswerRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRevision" (
    "id" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceMediaId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mediaSha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteLength" BIGINT NOT NULL,
    "rightsReceiptId" TEXT NOT NULL,
    "rightsSubjectType" TEXT NOT NULL DEFAULT 'MEDIA',
    "rightsDecision" TEXT NOT NULL DEFAULT 'CLEARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionRevisionMedia" (
    "id" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "questionContentHash" TEXT NOT NULL,
    "mediaRevisionId" TEXT NOT NULL,
    "mediaSha256" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionRevisionMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogRelease" (
    "id" TEXT NOT NULL,
    "releaseRootHash" TEXT NOT NULL,
    "manifestVersion" INTEGER NOT NULL,
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogReleaseSourceSnapshot" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceReleaseId" TEXT NOT NULL,
    "sourceRootSha256" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogReleaseSourceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogReleaseCategory" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "categoryRevisionId" TEXT NOT NULL,
    "categoryContentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogReleaseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogReleaseQuestion" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "sourceNamespace" TEXT NOT NULL,
    "sourceSnapshotHash" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "questionContentHash" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogReleaseQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogReleaseAvailability" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "selectorVersion" TEXT NOT NULL,
    "selectionManifestHash" TEXT NOT NULL,
    "freshSelectionHash" TEXT NOT NULL,
    "repeatSelectionHash" TEXT NOT NULL,
    "freshSelectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repeatSelectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "freshSelectionSeed" INTEGER NOT NULL,
    "repeatSelectionSeed" INTEGER NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogReleaseAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveCatalogPointer" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "catalogReleaseId" TEXT NOT NULL,
    "releaseRootHash" TEXT NOT NULL,
    "validationReceiptId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveCatalogPointer_pkey" PRIMARY KEY ("id")
);

-- Publication state is represented by append-only seals, receipts and events.
CREATE TABLE "QuestionRevisionSeal" (
    "id" TEXT NOT NULL,
    "questionRevisionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "answerManifestHash" TEXT NOT NULL,
    "mediaManifestHash" TEXT NOT NULL,
    "canonicalizationVersion" INTEGER NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionRevisionSeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogReleaseSeal" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "releaseRootHash" TEXT NOT NULL,
    "sealHash" TEXT NOT NULL,
    "canonicalizationVersion" INTEGER NOT NULL,
    "sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogReleaseSeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogValidationReceipt" (
    "id" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "releaseRootHash" TEXT NOT NULL,
    "sealHash" TEXT NOT NULL,
    "validatorRef" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "sourceEvidenceManifestHash" TEXT NOT NULL,
    "selectorVersion" TEXT NOT NULL,
    "huroofProjectId" TEXT,
    "huroofReleaseId" TEXT,
    "huroofRootSha256" TEXT,
    "huroofCapabilityStateHash" TEXT,
    "huroofSelectorAttestation" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogValidationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogActivationEvent" (
    "id" TEXT NOT NULL,
    "expectedPreviousReceiptId" TEXT,
    "validationReceiptId" TEXT NOT NULL,
    "catalogReleaseId" TEXT NOT NULL,
    "releaseRootHash" TEXT NOT NULL,
    "eventHash" TEXT NOT NULL,
    "activatedBy" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogActivationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegacyUnpinnedGame" (
    "gameId" TEXT NOT NULL,
    "snapshottedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegacyUnpinnedGame_pkey" PRIMARY KEY ("gameId")
);

-- Snapshot exact pre-cutover null-pin identities. No later runtime inserts are allowed.
INSERT INTO "LegacyUnpinnedGame" ("gameId")
SELECT "id" FROM "Game" WHERE "catalogReleaseId" IS NULL;

CREATE UNIQUE INDEX "QuestionRevisionSeal_questionRevisionId_key" ON "QuestionRevisionSeal"("questionRevisionId");
CREATE UNIQUE INDEX "QuestionRevisionSeal_revision_hash_key" ON "QuestionRevisionSeal"("questionRevisionId", "contentHash");
CREATE UNIQUE INDEX "CatalogReleaseSeal_catalogReleaseId_key" ON "CatalogReleaseSeal"("catalogReleaseId");
CREATE UNIQUE INDEX "CatalogReleaseSeal_release_root_seal_key" ON "CatalogReleaseSeal"("catalogReleaseId", "releaseRootHash", "sealHash");
CREATE UNIQUE INDEX "CatalogReleaseSeal_release_root_key" ON "CatalogReleaseSeal"("catalogReleaseId", "releaseRootHash");
CREATE UNIQUE INDEX "CatalogValidationReceipt_id_release_key" ON "CatalogValidationReceipt"("id", "catalogReleaseId");
CREATE UNIQUE INDEX "CatalogValidationReceipt_id_release_root_key" ON "CatalogValidationReceipt"("id", "catalogReleaseId", "releaseRootHash");
CREATE UNIQUE INDEX "CatalogActivationEvent_receipt_hash_key" ON "CatalogActivationEvent"("validationReceiptId", "eventHash");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCrosswalk_source_revision_key" ON "SourceCategoryCrosswalkRevision"("sourceNamespace", "sourceCategoryId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCrosswalk_source_hash_key" ON "SourceCategoryCrosswalkRevision"("sourceNamespace", "sourceCategoryId", "mappingHash");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCategoryCrosswalkRevision_id_sourceNamespace_sourceCa_key" ON "SourceCategoryCrosswalkRevision"("id", "sourceNamespace", "sourceCategoryId", "revision", "canonicalCategoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "SourceCategoryCrosswalkRevision_id_mappingHash_key" ON "SourceCategoryCrosswalkRevision"("id", "mappingHash");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalCategoryRevision_categoryKey_revision_key" ON "CanonicalCategoryRevision"("categoryKey", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalCategoryRevision_categoryKey_contentHash_key" ON "CanonicalCategoryRevision"("categoryKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalCategoryRevision_id_categoryKey_contentHash_key" ON "CanonicalCategoryRevision"("id", "categoryKey", "contentHash");

-- CreateIndex
CREATE INDEX "EditorialReviewReceipt_sourceNamespace_sourceKey_sourceRevi_idx" ON "EditorialReviewReceipt"("sourceNamespace", "sourceKey", "sourceRevision");

-- CreateIndex
CREATE UNIQUE INDEX "EditorialReviewReceipt_id_sourceNamespace_sourceKey_sourceR_key" ON "EditorialReviewReceipt"("id", "sourceNamespace", "sourceKey", "sourceRevision", "subjectHash", "decision");

-- CreateIndex
CREATE INDEX "ContentRightsReceipt_sourceNamespace_subjectType_sourceKey_idx" ON "ContentRightsReceipt"("sourceNamespace", "subjectType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRightsReceipt_id_sourceNamespace_subjectType_sourceK_key" ON "ContentRightsReceipt"("id", "sourceNamespace", "subjectType", "sourceKey", "subjectHash", "decision");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_source_revision_key" ON "QuestionRevision"("sourceNamespace", "sourceQuestionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_source_hash_key" ON "QuestionRevision"("sourceNamespace", "sourceQuestionId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_id_contentHash_key" ON "QuestionRevision"("id", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_id_canonicalCategoryKey_contentHash_key" ON "QuestionRevision"("id", "canonicalCategoryKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevision_id_sourceNamespace_canonicalCategoryKey_co_key" ON "QuestionRevision"("id", "sourceNamespace", "canonicalCategoryKey", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAnswerRevision_questionRevisionId_sortOrder_key" ON "QuestionAnswerRevision"("questionRevisionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAnswerRevision_id_contentHash_key" ON "QuestionAnswerRevision"("id", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRevision_source_revision_key" ON "MediaRevision"("sourceNamespace", "sourceMediaId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRevision_source_hash_key" ON "MediaRevision"("sourceNamespace", "sourceMediaId", "mediaSha256");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRevision_id_mediaSha256_key" ON "MediaRevision"("id", "mediaSha256");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRevision_objectKey_mediaSha256_key" ON "MediaRevision"("objectKey", "mediaSha256");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionRevisionMedia_questionRevisionId_role_sortOrder_key" ON "QuestionRevisionMedia"("questionRevisionId", "role", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogRelease_releaseRootHash_key" ON "CatalogRelease"("releaseRootHash");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogRelease_id_releaseRootHash_key" ON "CatalogRelease"("id", "releaseRootHash");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseSourceSnapshot_release_namespace_key" ON "CatalogReleaseSourceSnapshot"("catalogReleaseId", "sourceNamespace");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseSourceSnapshot_release_namespace_hash_key" ON "CatalogReleaseSourceSnapshot"("catalogReleaseId", "sourceNamespace", "snapshotHash");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseSourceSnapshot_id_snapshotHash_key" ON "CatalogReleaseSourceSnapshot"("id", "snapshotHash");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseCategory_catalogReleaseId_categoryKey_key" ON "CatalogReleaseCategory"("catalogReleaseId", "categoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseCategory_catalogReleaseId_categoryKey_categor_key" ON "CatalogReleaseCategory"("catalogReleaseId", "categoryKey", "categoryRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseCategory_id_catalogReleaseId_categoryKey_key" ON "CatalogReleaseCategory"("id", "catalogReleaseId", "categoryKey");

-- CreateIndex
CREATE INDEX "CatalogReleaseQuestion_catalogReleaseId_categoryKey_idx" ON "CatalogReleaseQuestion"("catalogReleaseId", "categoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseQuestion_catalogReleaseId_questionRevisionId_key" ON "CatalogReleaseQuestion"("catalogReleaseId", "questionRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseQuestion_catalogReleaseId_questionRevisionId__key" ON "CatalogReleaseQuestion"("catalogReleaseId", "questionRevisionId", "categoryKey");

-- CreateIndex
CREATE INDEX "CatalogReleaseAvailability_catalogReleaseId_categoryKey_idx" ON "CatalogReleaseAvailability"("catalogReleaseId", "categoryKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogReleaseAvailability_catalogReleaseId_categoryKey_eng_key" ON "CatalogReleaseAvailability"("catalogReleaseId", "categoryKey", "engine", "mode", "tier", "modality");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "CatalogRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "GameQuestion" ADD CONSTRAINT "GameQuestion_catalogReleaseId_questionRevisionId_fkey" FOREIGN KEY ("catalogReleaseId", "questionRevisionId") REFERENCES "CatalogReleaseQuestion"("catalogReleaseId", "questionRevisionId") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "CanonicalCategoryRevision" ADD CONSTRAINT "CanonicalCategoryRevision_coverMediaRevisionId_fkey" FOREIGN KEY ("coverMediaRevisionId") REFERENCES "MediaRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionRevision" ADD CONSTRAINT "QuestionRevision_crosswalkRevisionId_sourceNamespace_sourc_fkey" FOREIGN KEY ("crosswalkRevisionId", "sourceNamespace", "sourceCategoryId", "crosswalkRevision", "canonicalCategoryKey") REFERENCES "SourceCategoryCrosswalkRevision"("id", "sourceNamespace", "sourceCategoryId", "revision", "canonicalCategoryKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionRevision" ADD CONSTRAINT "QuestionRevision_editorialReceiptId_sourceNamespace_source_fkey" FOREIGN KEY ("editorialReceiptId", "sourceNamespace", "sourceQuestionId", "revision", "contentHash", "editorialDecision") REFERENCES "EditorialReviewReceipt"("id", "sourceNamespace", "sourceKey", "sourceRevision", "subjectHash", "decision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionRevision" ADD CONSTRAINT "QuestionRevision_rightsReceiptId_sourceNamespace_rightsSub_fkey" FOREIGN KEY ("rightsReceiptId", "sourceNamespace", "rightsSubjectType", "sourceQuestionId", "contentHash", "rightsDecision") REFERENCES "ContentRightsReceipt"("id", "sourceNamespace", "subjectType", "sourceKey", "subjectHash", "decision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAnswerRevision" ADD CONSTRAINT "QuestionAnswerRevision_questionRevisionId_questionContentH_fkey" FOREIGN KEY ("questionRevisionId", "questionContentHash") REFERENCES "QuestionRevision"("id", "contentHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRevision" ADD CONSTRAINT "MediaRevision_rightsReceiptId_sourceNamespace_rightsSubjec_fkey" FOREIGN KEY ("rightsReceiptId", "sourceNamespace", "rightsSubjectType", "sourceMediaId", "mediaSha256", "rightsDecision") REFERENCES "ContentRightsReceipt"("id", "sourceNamespace", "subjectType", "sourceKey", "subjectHash", "decision") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionRevisionMedia" ADD CONSTRAINT "QuestionRevisionMedia_questionRevisionId_questionContentHa_fkey" FOREIGN KEY ("questionRevisionId", "questionContentHash") REFERENCES "QuestionRevision"("id", "contentHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionRevisionMedia" ADD CONSTRAINT "QuestionRevisionMedia_mediaRevisionId_mediaSha256_fkey" FOREIGN KEY ("mediaRevisionId", "mediaSha256") REFERENCES "MediaRevision"("id", "mediaSha256") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseSourceSnapshot" ADD CONSTRAINT "CatalogReleaseSourceSnapshot_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "CatalogRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseCategory" ADD CONSTRAINT "CatalogReleaseCategory_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "CatalogRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseCategory" ADD CONSTRAINT "CatalogReleaseCategory_categoryRevisionId_categoryKey_cate_fkey" FOREIGN KEY ("categoryRevisionId", "categoryKey", "categoryContentHash") REFERENCES "CanonicalCategoryRevision"("id", "categoryKey", "contentHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseQuestion" ADD CONSTRAINT "CatalogReleaseQuestion_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "CatalogRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseQuestion" ADD CONSTRAINT "CatalogReleaseQuestion_catalogReleaseId_sourceNamespace_so_fkey" FOREIGN KEY ("catalogReleaseId", "sourceNamespace", "sourceSnapshotHash") REFERENCES "CatalogReleaseSourceSnapshot"("catalogReleaseId", "sourceNamespace", "snapshotHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseQuestion" ADD CONSTRAINT "CatalogReleaseQuestion_questionRevisionId_sourceNamespace__fkey" FOREIGN KEY ("questionRevisionId", "sourceNamespace", "categoryKey", "questionContentHash") REFERENCES "QuestionRevision"("id", "sourceNamespace", "canonicalCategoryKey", "contentHash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseQuestion" ADD CONSTRAINT "CatalogReleaseQuestion_catalogReleaseId_categoryKey_fkey" FOREIGN KEY ("catalogReleaseId", "categoryKey") REFERENCES "CatalogReleaseCategory"("catalogReleaseId", "categoryKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseAvailability" ADD CONSTRAINT "CatalogReleaseAvailability_catalogReleaseId_fkey" FOREIGN KEY ("catalogReleaseId") REFERENCES "CatalogRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogReleaseAvailability" ADD CONSTRAINT "CatalogReleaseAvailability_catalogReleaseId_categoryKey_fkey" FOREIGN KEY ("catalogReleaseId", "categoryKey") REFERENCES "CatalogReleaseCategory"("catalogReleaseId", "categoryKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveCatalogPointer" ADD CONSTRAINT "ActiveCatalogPointer_catalogReleaseId_releaseRootHash_fkey" FOREIGN KEY ("catalogReleaseId", "releaseRootHash") REFERENCES "CatalogRelease"("id", "releaseRootHash") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing Game and GameQuestion rows retain NULL release/revision pins. A new
-- pinned game question must have both values and its composite foreign keys
-- bind the question to the same release as its parent game.
ALTER TABLE "GameQuestion"
  ADD CONSTRAINT "GameQuestion_catalog_pin_pair_check"
  CHECK (("catalogReleaseId" IS NULL) = ("questionRevisionId" IS NULL));

-- The singleton is provisioned out of band only after isolated target review.
-- No pointer row is inserted by this migration.
ALTER TABLE "ActiveCatalogPointer"
  ADD CONSTRAINT "ActiveCatalogPointer_singleton_id_check"
  CHECK ("id" = 'singleton');

-- INT-4R sealed publication repair. This SQL is a draft and is never applied
-- by deployment. Hashes use PostgreSQL jsonb canonical text plus pgcrypto.
ALTER TABLE "CanonicalCategoryRevision"
  ALTER COLUMN "editorialReceiptId" SET NOT NULL;

ALTER TABLE "CanonicalCategoryRevision"
  ADD CONSTRAINT "CanonicalCategoryRevision_editorial_receipt_fkey"
  FOREIGN KEY ("editorialReceiptId", "sourceNamespace", "categoryKey", "revision", "contentHash", "editorialDecision")
  REFERENCES "EditorialReviewReceipt"("id", "sourceNamespace", "sourceKey", "sourceRevision", "subjectHash", "decision")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "QuestionRevisionSeal"
  ADD CONSTRAINT "QuestionRevisionSeal_revision_hash_fkey"
  FOREIGN KEY ("questionRevisionId", "contentHash") REFERENCES "QuestionRevision"("id", "contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CatalogReleaseQuestion"
  ADD CONSTRAINT "CatalogReleaseQuestion_question_seal_fkey"
  FOREIGN KEY ("questionRevisionId", "questionContentHash") REFERENCES "QuestionRevisionSeal"("questionRevisionId", "contentHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CatalogReleaseSeal"
  ADD CONSTRAINT "CatalogReleaseSeal_release_root_fkey"
  FOREIGN KEY ("catalogReleaseId", "releaseRootHash") REFERENCES "CatalogRelease"("id", "releaseRootHash") ON DELETE RESTRICT ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "CatalogValidationReceipt"
  ADD CONSTRAINT "CatalogValidationReceipt_seal_root_fkey"
  FOREIGN KEY ("catalogReleaseId", "releaseRootHash", "sealHash") REFERENCES "CatalogReleaseSeal"("catalogReleaseId", "releaseRootHash", "sealHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CatalogActivationEvent"
  ADD CONSTRAINT "CatalogActivationEvent_receipt_fkey"
  FOREIGN KEY ("validationReceiptId", "catalogReleaseId", "releaseRootHash") REFERENCES "CatalogValidationReceipt"("id", "catalogReleaseId", "releaseRootHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ActiveCatalogPointer"
  ADD CONSTRAINT "ActiveCatalogPointer_receipt_fkey"
  FOREIGN KEY ("validationReceiptId", "catalogReleaseId", "releaseRootHash") REFERENCES "CatalogValidationReceipt"("id", "catalogReleaseId", "releaseRootHash") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LegacyUnpinnedGame"
  ADD CONSTRAINT "LegacyUnpinnedGame_game_fkey"
  FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION int4_question_payload(p_revision_id TEXT) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path = pg_catalog, int4_crypto AS $$
  SELECT jsonb_build_object(
    'canonicalizationVersion', 1,
    'question', jsonb_build_object(
      'id', q."id", 'sourceNamespace', q."sourceNamespace", 'sourceQuestionId', q."sourceQuestionId",
      'revision', q."revision", 'sourceContentHash', q."sourceContentHash",
      'sourceCategoryId', q."sourceCategoryId", 'crosswalkRevisionId', q."crosswalkRevisionId",
      'crosswalkRevision', q."crosswalkRevision", 'canonicalCategoryKey', q."canonicalCategoryKey",
      'prompt', q."prompt", 'points', q."points", 'hints', to_jsonb(q."hints"),
      'modality', q."modality", 'engine', q."engine", 'mode', q."mode", 'tier', q."tier",
      'crosswalkHash', x."mappingHash"
    ),
    'answers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a."id", 'sortOrder', a."sortOrder", 'text', a."text",
        'points', a."points", 'isCorrect', a."isCorrect", 'isTrap', a."isTrap", 'contentHash', a."contentHash") ORDER BY a."sortOrder", a."id")
      FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId" = q."id"
    ), '[]'::jsonb),
    'media', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('role', b."role", 'sortOrder', b."sortOrder", 'mediaId', m."id",
        'mediaSha256', m."mediaSha256", 'objectKey', m."objectKey", 'mimeType', m."mimeType",
        'byteLength', m."byteLength", 'rightsReceiptId', m."rightsReceiptId", 'rightsEvidenceHash', r."evidenceHash") ORDER BY b."role", b."sortOrder", m."id")
      FROM public."QuestionRevisionMedia" b
      JOIN public."MediaRevision" m ON m."id" = b."mediaRevisionId" AND m."mediaSha256" = b."mediaSha256"
      JOIN public."ContentRightsReceipt" r ON r."id" = m."rightsReceiptId"
      WHERE b."questionRevisionId" = q."id"
    ), '[]'::jsonb)
  )
  FROM public."QuestionRevision" q
  JOIN public."SourceCategoryCrosswalkRevision" x ON x."id" = q."crosswalkRevisionId"
  WHERE q."id" = p_revision_id;
$$;

CREATE OR REPLACE FUNCTION int4_question_child_manifest(p_revision_id TEXT, p_kind TEXT) RETURNS TEXT
LANGUAGE SQL STABLE SET search_path = pg_catalog, int4_crypto AS $$
  SELECT encode(digest(convert_to(CASE WHEN p_kind = 'answer'
    THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a."id", 'sortOrder', a."sortOrder", 'text', a."text", 'points', a."points", 'isCorrect', a."isCorrect", 'isTrap', a."isTrap", 'contentHash', a."contentHash") ORDER BY a."sortOrder", a."id")::text FROM public."QuestionAnswerRevision" a WHERE a."questionRevisionId" = p_revision_id), '[]')
    ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('role', b."role", 'sortOrder', b."sortOrder", 'mediaId', m."id", 'mediaSha256', m."mediaSha256", 'objectKey', m."objectKey", 'mimeType', m."mimeType", 'byteLength', m."byteLength", 'rightsReceiptId', m."rightsReceiptId", 'rightsEvidenceHash', r."evidenceHash") ORDER BY b."role", b."sortOrder", m."id")::text FROM public."QuestionRevisionMedia" b JOIN public."MediaRevision" m ON m."id" = b."mediaRevisionId" AND m."mediaSha256" = b."mediaSha256" JOIN public."ContentRightsReceipt" r ON r."id" = m."rightsReceiptId" WHERE b."questionRevisionId" = p_revision_id), '[]') END, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION seal_question_revision(p_revision_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE q public."QuestionRevision"%ROWTYPE; full_payload JSONB; full_hash TEXT; answer_hash TEXT; media_hash TEXT; seal_id TEXT;
BEGIN
  IF NOT pg_has_role(session_user, 'catalog_publisher', 'member') THEN RAISE EXCEPTION 'catalog publisher role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO q FROM public."QuestionRevision" WHERE "id" = p_revision_id FOR UPDATE;
  IF NOT FOUND OR q."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'question revision missing or already sealed'; END IF;
  full_payload := public.int4_question_payload(p_revision_id);
  IF full_payload IS NULL OR NOT EXISTS (SELECT 1 FROM public."QuestionAnswerRevision" WHERE "questionRevisionId" = p_revision_id) THEN RAISE EXCEPTION 'question revision requires a render payload and answer rows'; END IF;
  full_hash := encode(digest(convert_to(full_payload::text, 'UTF8'), 'sha256'), 'hex');
  answer_hash := public.int4_question_child_manifest(p_revision_id, 'answer');
  media_hash := public.int4_question_child_manifest(p_revision_id, 'media');
  IF q."contentHash" <> full_hash THEN RAISE EXCEPTION 'question content hash does not match full render/grade payload'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."EditorialReviewReceipt" e WHERE e."id"=q."editorialReceiptId" AND e."sourceNamespace"=q."sourceNamespace" AND e."sourceKey"=q."sourceQuestionId" AND e."sourceRevision"=q."revision" AND e."subjectHash"=full_hash AND e."decision"='APPROVED') THEN RAISE EXCEPTION 'exact editorial approval missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public."ContentRightsReceipt" r WHERE r."id"=q."rightsReceiptId" AND r."sourceNamespace"=q."sourceNamespace" AND r."subjectType"='QUESTION' AND r."sourceKey"=q."sourceQuestionId" AND r."subjectHash"=full_hash AND r."decision"='CLEARED') THEN RAISE EXCEPTION 'exact question rights receipt missing'; END IF;
  seal_id := 'question-seal:' || p_revision_id;
  INSERT INTO public."QuestionRevisionSeal"("id","questionRevisionId","contentHash","answerManifestHash","mediaManifestHash","canonicalizationVersion") VALUES(seal_id,p_revision_id,full_hash,answer_hash,media_hash,1);
  UPDATE public."QuestionRevision" SET "sealedAt"=clock_timestamp() WHERE "id"=p_revision_id;
  RETURN full_hash;
END;
$$;

CREATE OR REPLACE FUNCTION int4_category_payload(p_category_revision_id TEXT) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path = pg_catalog, int4_crypto AS $$
 SELECT jsonb_build_object('canonicalizationVersion',1,'category',jsonb_build_object(
   'id', c."id",'sourceNamespace',c."sourceNamespace",'categoryKey',c."categoryKey",'revision',c."revision",
   'labelAr',c."labelAr",'description',c."description",'cover',CASE WHEN m."id" IS NULL THEN NULL ELSE jsonb_build_object('id',m."id",'mediaSha256',m."mediaSha256",'objectKey',m."objectKey",'mimeType',m."mimeType",'byteLength',m."byteLength",'rightsReceiptId',m."rightsReceiptId",'rightsEvidenceHash',r."evidenceHash") END))
 FROM public."CanonicalCategoryRevision" c
 LEFT JOIN public."MediaRevision" m ON m."id"=c."coverMediaRevisionId"
 LEFT JOIN public."ContentRightsReceipt" r ON r."id"=m."rightsReceiptId"
 WHERE c."id"=p_category_revision_id;
$$;

CREATE OR REPLACE FUNCTION int4_release_payload(p_release_id TEXT) RETURNS JSONB
LANGUAGE SQL STABLE SET search_path = pg_catalog, int4_crypto AS $$
 SELECT jsonb_build_object(
  'canonicalizationVersion',1,
  'release',jsonb_build_object('id',r."id",'manifestVersion',r."manifestVersion"),
  'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace") FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=r."id"),'[]'::jsonb),
  'categories',COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryKey',c."categoryKey",'contentHash',c."categoryContentHash",'metadataHash',cr."contentHash",'editorialReceiptId',cr."editorialReceiptId",'coverId',cr."coverMediaRevisionId") ORDER BY c."categoryKey") FROM public."CatalogReleaseCategory" c JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" WHERE c."catalogReleaseId"=r."id"),'[]'::jsonb),
  'crosswalks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',crosswalk."id",'namespace',crosswalk."sourceNamespace",'sourceCategoryId',crosswalk."sourceCategoryId",'revision',crosswalk."revision",'canonicalCategoryKey',crosswalk."canonicalCategoryKey",'mappingHash',crosswalk."mappingHash") ORDER BY crosswalk."sourceNamespace",crosswalk."sourceCategoryId",crosswalk."revision",crosswalk."id") FROM (SELECT DISTINCT x."id",x."sourceNamespace",x."sourceCategoryId",x."revision",x."canonicalCategoryKey",x."mappingHash" FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" JOIN public."SourceCategoryCrosswalkRevision" x ON x."id"=q."crosswalkRevisionId" WHERE m."catalogReleaseId"=r."id") crosswalk),'[]'::jsonb),
  'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('questionRevisionId',m."questionRevisionId",'questionHash',m."questionContentHash",'namespace',m."sourceNamespace",'sourceSnapshotHash',m."sourceSnapshotHash",'categoryKey',m."categoryKey",'questionSealHash',s."contentHash",'answerManifestHash',s."answerManifestHash",'mediaManifestHash',s."mediaManifestHash") ORDER BY m."categoryKey",m."sourceNamespace",m."questionRevisionId") FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevisionSeal" s ON s."questionRevisionId"=m."questionRevisionId" AND s."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=r."id"),'[]'::jsonb),
  'availability',COALESCE((SELECT jsonb_agg(jsonb_build_object('categoryKey',a."categoryKey",'engine',a."engine",'mode',a."mode",'tier',a."tier",'modality',a."modality",'selectorVersion',a."selectorVersion",'selectionManifestHash',a."selectionManifestHash",'freshSelectionHash',a."freshSelectionHash",'repeatSelectionHash',a."repeatSelectionHash",'freshSelectionIds',to_jsonb(a."freshSelectionIds"),'repeatSelectionIds',to_jsonb(a."repeatSelectionIds"),'freshSelectionSeed',a."freshSelectionSeed",'repeatSelectionSeed',a."repeatSelectionSeed") ORDER BY a."categoryKey",a."engine",a."mode",a."tier",a."modality") FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=r."id"),'[]'::jsonb)
 ) FROM public."CatalogRelease" r WHERE r."id"=p_release_id;
$$;

CREATE OR REPLACE FUNCTION seal_catalog_release(p_release_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE r public."CatalogRelease"%ROWTYPE; payload JSONB; root_hash TEXT; seal_hash TEXT; rec RECORD; selected_count INTEGER;
BEGIN
 IF NOT pg_has_role(session_user,'catalog_publisher','member') THEN RAISE EXCEPTION 'catalog publisher role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public."CatalogRelease" WHERE "id"=p_release_id FOR UPDATE;
 IF NOT FOUND OR r."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'catalog release missing or already sealed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=p_release_id)
   OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseCategory" WHERE "catalogReleaseId"=p_release_id)
   OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" WHERE "catalogReleaseId"=p_release_id) THEN RAISE EXCEPTION 'release requires source, approved category and question membership'; END IF;
 IF EXISTS(SELECT 1 FROM public."CatalogReleaseCategory" c JOIN public."CanonicalCategoryRevision" cr ON cr."id"=c."categoryRevisionId" WHERE c."catalogReleaseId"=p_release_id AND (cr."editorialDecision"<>'APPROVED' OR cr."contentHash"<>encode(digest(convert_to(public.int4_category_payload(cr."id")::text,'UTF8'),'sha256'),'hex'))) THEN RAISE EXCEPTION 'category metadata hash or approval invalid'; END IF;
 IF EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" m LEFT JOIN public."QuestionRevisionSeal" qs ON qs."questionRevisionId"=m."questionRevisionId" AND qs."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=p_release_id AND qs."id" IS NULL) THEN RAISE EXCEPTION 'release contains unsealed question membership'; END IF;
 IF EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" JOIN public."SourceCategoryCrosswalkRevision" x ON x."id"=q."crosswalkRevisionId" WHERE m."catalogReleaseId"=p_release_id AND x."mappingHash"<>encode(digest(convert_to(jsonb_build_object('sourceNamespace',x."sourceNamespace",'sourceCategoryId',x."sourceCategoryId",'revision',x."revision",'canonicalCategoryKey',x."canonicalCategoryKey")::text,'UTF8'),'sha256'),'hex')) THEN RAISE EXCEPTION 'source category crosswalk hash is invalid'; END IF;
 FOR rec IN SELECT * FROM public."CatalogReleaseAvailability" WHERE "catalogReleaseId"=p_release_id LOOP
   IF rec."engine" <> 'ENTA' OR rec."mode" <> 'CLASSIC' OR rec."modality" <> 'classic' OR rec."tier" NOT IN ('200','400','600') THEN RAISE EXCEPTION 'unsupported selector combination cannot be published'; END IF;
   IF cardinality(rec."freshSelectionIds")<>2 OR cardinality(rec."repeatSelectionIds")<>2 OR rec."freshSelectionIds" && rec."repeatSelectionIds" THEN RAISE EXCEPTION 'fresh and repeat selector runs require disjoint exact tier supply'; END IF;
   IF rec."freshSelectionHash"<>encode(digest(convert_to(array_to_string(rec."freshSelectionIds",','),'UTF8'),'sha256'),'hex') OR rec."repeatSelectionHash"<>encode(digest(convert_to(array_to_string(rec."repeatSelectionIds",','),'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'selector run hash does not bind ordered IDs'; END IF;
   SELECT count(DISTINCT selected.id) INTO selected_count FROM unnest(rec."freshSelectionIds" || rec."repeatSelectionIds") selected(id) JOIN public."CatalogReleaseQuestion" m ON m."catalogReleaseId"=p_release_id AND m."questionRevisionId"=selected.id AND m."categoryKey"=rec."categoryKey" JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId" WHERE q."engine"=rec."engine" AND q."mode"=rec."mode" AND q."tier"=rec."tier" AND q."modality"=rec."modality";
   IF selected_count<>4 THEN RAISE EXCEPTION 'selector evidence includes nonmembers or mismatched engine/mode/tier/modality'; END IF;
   IF rec."selectionManifestHash"<>encode(digest(convert_to(concat_ws(E'\n',rec."selectorVersion",rec."categoryKey",rec."tier",rec."modality",rec."freshSelectionSeed"::text,array_to_string(rec."freshSelectionIds",','),rec."freshSelectionHash",rec."repeatSelectionSeed"::text,array_to_string(rec."repeatSelectionIds",','),rec."repeatSelectionHash"),'UTF8'),'sha256'),'hex') THEN RAISE EXCEPTION 'selector manifest does not bind exact adapter version, seeds and run IDs'; END IF;
 END LOOP;
 payload := public.int4_release_payload(p_release_id);
 root_hash := encode(digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');
 seal_hash := encode(digest(convert_to(jsonb_build_object('releaseId',p_release_id,'releaseRootHash',root_hash,'canonicalizationVersion',1)::text,'UTF8'),'sha256'),'hex');
 INSERT INTO public."CatalogReleaseSeal"("id","catalogReleaseId","releaseRootHash","sealHash","canonicalizationVersion") VALUES('catalog-seal:'||p_release_id,p_release_id,root_hash,seal_hash,1);
 UPDATE public."CatalogRelease" SET "releaseRootHash"=root_hash,"sealedAt"=clock_timestamp() WHERE "id"=p_release_id;
 RETURN seal_hash;
END;
$$;

CREATE OR REPLACE FUNCTION issue_catalog_validation_receipt(p_release_id TEXT,p_release_root TEXT,p_seal_hash TEXT,p_policy_version TEXT,p_source_manifest_hash TEXT,p_selector_version TEXT,p_huroof_project TEXT DEFAULT NULL,p_huroof_release TEXT DEFAULT NULL,p_huroof_root TEXT DEFAULT NULL,p_huroof_capability_hash TEXT DEFAULT NULL,p_huroof_attestation TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE receipt_id TEXT;
BEGIN
 IF NOT pg_has_role(session_user,'catalog_validator','member') THEN RAISE EXCEPTION 'trusted catalog validator role required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSeal" s WHERE s."catalogReleaseId"=p_release_id AND s."releaseRootHash"=p_release_root AND s."sealHash"=p_seal_hash)
   OR NOT EXISTS(SELECT 1 FROM public."CatalogRelease" r WHERE r."id"=p_release_id AND r."releaseRootHash"=p_release_root AND r."sealedAt" IS NOT NULL) THEN RAISE EXCEPTION 'validated receipt must bind an exact sealed release root'; END IF;
 IF encode(digest(convert_to(COALESCE((SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=p_release_id),'[]'),'UTF8'),'sha256'),'hex') <> p_source_manifest_hash THEN RAISE EXCEPTION 'source evidence manifest does not match release snapshots'; END IF;
 IF EXISTS(SELECT 1 FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id AND a."selectorVersion"<>p_selector_version) THEN RAISE EXCEPTION 'receipt selector version differs from advertised evidence'; END IF;
 IF EXISTS(SELECT 1 FROM public."CatalogReleaseAvailability" a WHERE a."catalogReleaseId"=p_release_id AND a."engine"='HUROOF') AND (p_huroof_project IS NULL OR p_huroof_release IS NULL OR p_huroof_root IS NULL OR p_huroof_capability_hash IS NULL OR p_huroof_attestation IS NULL) THEN RAISE EXCEPTION 'Huroof availability requires trusted project, readiness and deployed selector attestation'; END IF;
 IF p_policy_version='' OR p_selector_version='' OR p_source_manifest_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'validation receipt evidence identity invalid'; END IF;
 receipt_id := 'catalog-receipt:'||encode(digest(convert_to(p_release_id||':'||p_release_root||':'||p_seal_hash||':'||session_user||':'||clock_timestamp()::text,'UTF8'),'sha256'),'hex');
 INSERT INTO public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash","sealHash","validatorRef","policyVersion","sourceEvidenceManifestHash","selectorVersion","huroofProjectId","huroofReleaseId","huroofRootSha256","huroofCapabilityStateHash","huroofSelectorAttestation") VALUES(receipt_id,p_release_id,p_release_root,p_seal_hash,session_user,p_policy_version,p_source_manifest_hash,p_selector_version,p_huroof_project,p_huroof_release,p_huroof_root,p_huroof_capability_hash,p_huroof_attestation);
 RETURN receipt_id;
END;
$$;

CREATE OR REPLACE FUNCTION activate_catalog_release(p_expected_receipt TEXT,p_next_receipt TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE next_row public."CatalogValidationReceipt"%ROWTYPE; current_row public."ActiveCatalogPointer"%ROWTYPE; event_id TEXT; event_hash TEXT;
BEGIN
 IF NOT pg_has_role(session_user,'catalog_activator','member') THEN RAISE EXCEPTION 'catalog activator role required' USING ERRCODE='42501'; END IF;
 SELECT * INTO next_row FROM public."CatalogValidationReceipt" WHERE "id"=p_next_receipt;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSeal" s WHERE s."catalogReleaseId"=next_row."catalogReleaseId" AND s."releaseRootHash"=next_row."releaseRootHash" AND s."sealHash"=next_row."sealHash") THEN RAISE EXCEPTION 'activation requires a valid immutable receipt'; END IF;
 SELECT * INTO current_row FROM public."ActiveCatalogPointer" WHERE "id"='singleton' FOR UPDATE;
 IF NOT FOUND THEN
   IF p_expected_receipt IS NOT NULL THEN RETURN FALSE; END IF;
   INSERT INTO public."ActiveCatalogPointer"("id","catalogReleaseId","releaseRootHash","validationReceiptId","updatedAt") VALUES('singleton',next_row."catalogReleaseId",next_row."releaseRootHash",next_row."id",clock_timestamp()) ON CONFLICT ("id") DO NOTHING;
   IF NOT FOUND THEN RETURN FALSE; END IF;
 ELSE
   IF p_expected_receipt IS NULL OR current_row."validationReceiptId"<>p_expected_receipt THEN RETURN FALSE; END IF;
   UPDATE public."ActiveCatalogPointer" SET "catalogReleaseId"=next_row."catalogReleaseId","releaseRootHash"=next_row."releaseRootHash","validationReceiptId"=next_row."id","updatedAt"=clock_timestamp() WHERE "id"='singleton' AND "validationReceiptId"=p_expected_receipt;
   IF NOT FOUND THEN RETURN FALSE; END IF;
 END IF;
 event_id := 'activation:'||encode(digest(convert_to(next_row."id"||':'||clock_timestamp()::text,'UTF8'),'sha256'),'hex');
 event_hash := encode(digest(convert_to(jsonb_build_object('previousReceipt',p_expected_receipt,'nextReceipt',next_row."id",'catalogReleaseId',next_row."catalogReleaseId",'releaseRootHash',next_row."releaseRootHash",'activatedBy',session_user)::text,'UTF8'),'sha256'),'hex');
 INSERT INTO public."CatalogActivationEvent"("id","expectedPreviousReceiptId","validationReceiptId","catalogReleaseId","releaseRootHash","eventHash","activatedBy") VALUES(event_id,p_expected_receipt,next_row."id",next_row."catalogReleaseId",next_row."releaseRootHash",event_hash,session_user);
 RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION int4_lock_question_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE parent_sealed TIMESTAMP(3);
BEGIN
 SELECT "sealedAt" INTO parent_sealed FROM public."QuestionRevision" WHERE "id"=NEW."questionRevisionId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'question revision parent missing'; END IF;
 IF parent_sealed IS NOT NULL THEN RAISE EXCEPTION 'question revision is sealed'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_lock_release_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE parent_sealed TIMESTAMP(3);
BEGIN
 SELECT "sealedAt" INTO parent_sealed FROM public."CatalogRelease" WHERE "id"=NEW."catalogReleaseId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'catalog release parent missing'; END IF;
 IF parent_sealed IS NOT NULL THEN RAISE EXCEPTION 'catalog release is sealed'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_parent_seal_update_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
 IF TG_TABLE_NAME='QuestionRevision' THEN
   IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL OR
     (to_jsonb(NEW)-'sealedAt')<>(to_jsonb(OLD)-'sealedAt') OR
     NOT EXISTS(SELECT 1 FROM public."QuestionRevisionSeal" s WHERE s."questionRevisionId"=OLD."id" AND s."contentHash"=OLD."contentHash") THEN
     RAISE EXCEPTION 'question revision is immutable except one verified seal transition';
   END IF;
 ELSE
   IF OLD."sealedAt" IS NOT NULL OR NEW."sealedAt" IS NULL OR
     (to_jsonb(NEW)-'sealedAt'-'releaseRootHash')<>(to_jsonb(OLD)-'sealedAt'-'releaseRootHash') OR
     NOT EXISTS(SELECT 1 FROM public."CatalogReleaseSeal" s WHERE s."catalogReleaseId"=OLD."id" AND s."releaseRootHash"=NEW."releaseRootHash") THEN
     RAISE EXCEPTION 'catalog release is immutable except one verified seal and computed-root transition';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_game_pin_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE parent_release TEXT; parent_row public."Game"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Game' THEN
   IF TG_OP='INSERT' THEN
     IF NEW."catalogReleaseId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."ActiveCatalogPointer" p JOIN public."CatalogValidationReceipt" v ON v."id"=p."validationReceiptId" AND v."catalogReleaseId"=p."catalogReleaseId" AND v."releaseRootHash"=p."releaseRootHash" JOIN public."CatalogReleaseSeal" s ON s."catalogReleaseId"=v."catalogReleaseId" AND s."releaseRootHash"=v."releaseRootHash" AND s."sealHash"=v."sealHash" WHERE p."catalogReleaseId"=NEW."catalogReleaseId") THEN RAISE EXCEPTION 'new games require the active validated catalog release pin'; END IF;
   ELSIF NEW."catalogReleaseId" IS DISTINCT FROM OLD."catalogReleaseId" THEN RAISE EXCEPTION 'game catalog pins are immutable';
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO parent_row FROM public."Game" WHERE "id"=NEW."gameId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'game parent missing'; END IF;
 parent_release := parent_row."catalogReleaseId";
 IF parent_release IS NULL THEN
   IF NEW."catalogReleaseId" IS NOT NULL OR NEW."questionRevisionId" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public."LegacyUnpinnedGame" WHERE "gameId"=NEW."gameId") THEN RAISE EXCEPTION 'legacy null pins allowed only for snapshotted historical game IDs'; END IF;
 ELSE
   IF NEW."catalogReleaseId" IS DISTINCT FROM parent_release OR NEW."questionRevisionId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevisionSeal" s ON s."questionRevisionId"=m."questionRevisionId" AND s."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=parent_release AND m."questionRevisionId"=NEW."questionRevisionId") THEN RAISE EXCEPTION 'pinned game question must match parent release and sealed membership'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_active_pointer_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
 IF TG_OP='DELETE' OR NOT pg_has_role(session_user,'catalog_activator','member') THEN RAISE EXCEPTION 'active catalog pointer changes require the restricted activator'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_question_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
 IF NEW."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'new question revisions must be unsealed'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_release_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
 IF NEW."sealedAt" IS NOT NULL THEN RAISE EXCEPTION 'new catalog releases must be unsealed'; END IF;
 RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION int4_game_pin_completeness() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto AS $$
DECLARE expected_release TEXT; total_rows INTEGER; invalid_rows INTEGER;
BEGIN
 SELECT "catalogReleaseId" INTO expected_release FROM public."Game" WHERE "id"=NEW."id";
 IF expected_release IS NULL THEN RAISE EXCEPTION 'new game lost its catalog release pin'; END IF;
 SELECT count(*),count(*) FILTER (WHERE "catalogReleaseId" IS DISTINCT FROM expected_release OR "questionRevisionId" IS NULL OR NOT EXISTS(SELECT 1 FROM public."CatalogReleaseQuestion" m JOIN public."QuestionRevisionSeal" s ON s."questionRevisionId"=m."questionRevisionId" AND s."contentHash"=m."questionContentHash" WHERE m."catalogReleaseId"=expected_release AND m."questionRevisionId"="GameQuestion"."questionRevisionId")) INTO total_rows,invalid_rows FROM public."GameQuestion" WHERE "gameId"=NEW."id";
 IF total_rows=0 OR invalid_rows>0 THEN RAISE EXCEPTION 'new game requires a complete, sealed same-release question pin set'; END IF;
 RETURN NULL;
END;
$$;

-- These trigger functions must exist before the migration installs triggers.
CREATE FUNCTION reject_immutable_catalog_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
  RAISE EXCEPTION 'INT-4 immutable table % rejects %', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION reject_catalog_pin_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, int4_crypto AS $$
BEGIN
  IF TG_TABLE_NAME = 'Game' THEN
    IF NEW."catalogReleaseId" IS DISTINCT FROM OLD."catalogReleaseId" THEN
      RAISE EXCEPTION 'INT-4 game catalog pin is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW."catalogReleaseId" IS DISTINCT FROM OLD."catalogReleaseId"
     OR NEW."questionRevisionId" IS DISTINCT FROM OLD."questionRevisionId" THEN
    RAISE EXCEPTION 'INT-4 game question catalog pin is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Replace the draft statement-level parent immutability triggers with a one-time
-- seal transition guard; the parent row lock closes seal-vs-child-insert races.
DROP TRIGGER IF EXISTS "QuestionRevision_immutable_mutation" ON "QuestionRevision";
DROP TRIGGER IF EXISTS "CatalogRelease_immutable_mutation" ON "CatalogRelease";
CREATE TRIGGER "QuestionRevision_seal_only_update" BEFORE UPDATE ON "QuestionRevision" FOR EACH ROW EXECUTE FUNCTION int4_parent_seal_update_guard();
CREATE TRIGGER "QuestionRevision_no_delete" BEFORE DELETE OR TRUNCATE ON "QuestionRevision" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_catalog_mutation();
CREATE TRIGGER "CatalogRelease_seal_only_update" BEFORE UPDATE ON "CatalogRelease" FOR EACH ROW EXECUTE FUNCTION int4_parent_seal_update_guard();
CREATE TRIGGER "CatalogRelease_no_delete" BEFORE DELETE OR TRUNCATE ON "CatalogRelease" FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_catalog_mutation();

CREATE TRIGGER "QuestionAnswerRevision_parent_lock" BEFORE INSERT ON "QuestionAnswerRevision" FOR EACH ROW EXECUTE FUNCTION int4_lock_question_child();
CREATE TRIGGER "QuestionRevisionMedia_parent_lock" BEFORE INSERT ON "QuestionRevisionMedia" FOR EACH ROW EXECUTE FUNCTION int4_lock_question_child();
CREATE TRIGGER "CatalogReleaseSourceSnapshot_parent_lock" BEFORE INSERT ON "CatalogReleaseSourceSnapshot" FOR EACH ROW EXECUTE FUNCTION int4_lock_release_child();
CREATE TRIGGER "CatalogReleaseCategory_parent_lock" BEFORE INSERT ON "CatalogReleaseCategory" FOR EACH ROW EXECUTE FUNCTION int4_lock_release_child();
CREATE TRIGGER "CatalogReleaseQuestion_parent_lock" BEFORE INSERT ON "CatalogReleaseQuestion" FOR EACH ROW EXECUTE FUNCTION int4_lock_release_child();
CREATE TRIGGER "CatalogReleaseAvailability_parent_lock" BEFORE INSERT ON "CatalogReleaseAvailability" FOR EACH ROW EXECUTE FUNCTION int4_lock_release_child();
CREATE TRIGGER "QuestionRevision_insert_unsealed" BEFORE INSERT ON "QuestionRevision" FOR EACH ROW EXECUTE FUNCTION int4_question_insert_guard();
CREATE TRIGGER "CatalogRelease_insert_unsealed" BEFORE INSERT ON "CatalogRelease" FOR EACH ROW EXECUTE FUNCTION int4_release_insert_guard();
CREATE TRIGGER "Game_new_release_pin_guard" BEFORE INSERT ON "Game" FOR EACH ROW EXECUTE FUNCTION int4_game_pin_guard();
CREATE TRIGGER "Game_pin_immutability" BEFORE UPDATE OF "catalogReleaseId" ON "Game" FOR EACH ROW EXECUTE FUNCTION reject_catalog_pin_mutation();
CREATE TRIGGER "GameQuestion_parent_pin_guard" BEFORE INSERT ON "GameQuestion" FOR EACH ROW EXECUTE FUNCTION int4_game_pin_guard();
CREATE TRIGGER "GameQuestion_pin_immutability" BEFORE UPDATE OF "catalogReleaseId","questionRevisionId" ON "GameQuestion" FOR EACH ROW EXECUTE FUNCTION reject_catalog_pin_mutation();
CREATE CONSTRAINT TRIGGER "Game_question_pin_completeness" AFTER INSERT ON "Game" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION int4_game_pin_completeness();
CREATE TRIGGER "ActiveCatalogPointer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ActiveCatalogPointer" FOR EACH ROW EXECUTE FUNCTION int4_active_pointer_guard();

-- All publication objects remain append-only. The only mutable publication
-- object is the pointer, whose only writer is the CAS function above.
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['QuestionRevisionSeal','CatalogReleaseSeal','CatalogValidationReceipt','CatalogActivationEvent','LegacyUnpinnedGame'] LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_catalog_mutation()',t||'_immutable_mutation',t);
 END LOOP;
END $$;

-- Runtime reads publication data only; privileged workflow roles are separate
-- NOLOGIN roles and are not granted to the application role here.
GRANT USAGE ON SCHEMA public TO enta_runtime,catalog_assembler,catalog_reviewer,catalog_publisher,catalog_validator,catalog_activator;
REVOKE ALL ON "QuestionRevisionSeal","CatalogReleaseSeal","CatalogValidationReceipt","CatalogActivationEvent","LegacyUnpinnedGame","ActiveCatalogPointer" FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON "SourceCategoryCrosswalkRevision","CanonicalCategoryRevision","EditorialReviewReceipt","ContentRightsReceipt","QuestionRevision","QuestionAnswerRevision","MediaRevision","QuestionRevisionMedia","CatalogRelease","CatalogReleaseSourceSnapshot","CatalogReleaseCategory","CatalogReleaseQuestion","CatalogReleaseAvailability","QuestionRevisionSeal","CatalogReleaseSeal","CatalogValidationReceipt","CatalogActivationEvent","LegacyUnpinnedGame","ActiveCatalogPointer" FROM enta_runtime;
GRANT SELECT ON "SourceCategoryCrosswalkRevision","CanonicalCategoryRevision","EditorialReviewReceipt","ContentRightsReceipt","QuestionRevision","QuestionAnswerRevision","MediaRevision","QuestionRevisionMedia","CatalogRelease","CatalogReleaseSourceSnapshot","CatalogReleaseCategory","CatalogReleaseQuestion","CatalogReleaseAvailability","QuestionRevisionSeal","CatalogReleaseSeal","CatalogValidationReceipt","CatalogActivationEvent","ActiveCatalogPointer" TO enta_runtime;
GRANT INSERT ON "SourceCategoryCrosswalkRevision","CanonicalCategoryRevision","QuestionRevision","QuestionAnswerRevision","MediaRevision","QuestionRevisionMedia","CatalogRelease","CatalogReleaseSourceSnapshot","CatalogReleaseCategory","CatalogReleaseQuestion","CatalogReleaseAvailability" TO catalog_assembler;
GRANT INSERT ON "EditorialReviewReceipt","ContentRightsReceipt" TO catalog_reviewer;
GRANT EXECUTE ON FUNCTION seal_question_revision(TEXT),seal_catalog_release(TEXT) TO catalog_publisher;
GRANT EXECUTE ON FUNCTION issue_catalog_validation_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO catalog_validator;
GRANT EXECUTE ON FUNCTION activate_catalog_release(TEXT,TEXT) TO catalog_activator;
REVOKE ALL ON FUNCTION seal_question_revision(TEXT),seal_catalog_release(TEXT),issue_catalog_validation_receipt(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),activate_catalog_release(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION int4_question_payload(TEXT),int4_question_child_manifest(TEXT,TEXT),int4_category_payload(TEXT),int4_release_payload(TEXT),int4_lock_question_child(),int4_lock_release_child(),int4_parent_seal_update_guard(),int4_game_pin_guard(),int4_active_pointer_guard(),int4_question_insert_guard(),int4_release_insert_guard(),int4_game_pin_completeness(),reject_immutable_catalog_mutation(),reject_catalog_pin_mutation() FROM PUBLIC;

ALTER TABLE "SourceCategoryCrosswalkRevision"
  ADD CONSTRAINT "SourceCategoryCrosswalkRevision_valid_revision_hash_check"
  CHECK ("revision" > 0 AND "mappingHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "CanonicalCategoryRevision"
  ADD CONSTRAINT "CanonicalCategoryRevision_valid_revision_hash_check"
  CHECK ("revision" > 0 AND "contentHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "EditorialReviewReceipt"
  ADD CONSTRAINT "EditorialReviewReceipt_hash_decision_check"
  CHECK ("subjectHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "decision" IN ('APPROVED', 'REJECTED', 'HELD'));

ALTER TABLE "ContentRightsReceipt"
  ADD CONSTRAINT "ContentRightsReceipt_hash_decision_check"
  CHECK ("subjectHash" ~ '^[a-f0-9]{64}$' AND "evidenceHash" ~ '^[a-f0-9]{64}$' AND "decision" IN ('CLEARED', 'REJECTED', 'PENDING'));

ALTER TABLE "QuestionRevision"
  ADD CONSTRAINT "QuestionRevision_review_rights_hash_check"
  CHECK ("sourceContentHash" ~ '^[a-f0-9]{64}$' AND "contentHash" ~ '^[a-f0-9]{64}$' AND "revision" > 0 AND "editorialDecision" = 'APPROVED' AND "rightsSubjectType" = 'QUESTION' AND "rightsDecision" = 'CLEARED');

ALTER TABLE "QuestionAnswerRevision"
  ADD CONSTRAINT "QuestionAnswerRevision_hash_order_check"
  CHECK ("contentHash" ~ '^[a-f0-9]{64}$' AND "sortOrder" >= 0);

ALTER TABLE "MediaRevision"
  ADD CONSTRAINT "MediaRevision_rights_hash_bytes_check"
  CHECK ("mediaSha256" ~ '^[a-f0-9]{64}$' AND "revision" > 0 AND "byteLength" > 0 AND "rightsSubjectType" = 'MEDIA' AND "rightsDecision" = 'CLEARED' AND "objectKey" <> '' AND "objectKey" !~* '^https?://');

ALTER TABLE "CatalogRelease"
  ADD CONSTRAINT "CatalogRelease_valid_root_check"
  CHECK ("releaseRootHash" ~ '^[a-f0-9]{64}$' AND "manifestVersion" > 0);

ALTER TABLE "CatalogReleaseSourceSnapshot"
  ADD CONSTRAINT "CatalogReleaseSourceSnapshot_valid_hashes_check"
  CHECK ("sourceRootSha256" ~ '^[a-f0-9]{64}$' AND "snapshotHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "CatalogReleaseCategory"
  ADD CONSTRAINT "CatalogReleaseCategory_valid_hash_check"
  CHECK ("categoryContentHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "CatalogReleaseQuestion"
  ADD CONSTRAINT "CatalogReleaseQuestion_valid_hashes_check"
  CHECK ("sourceSnapshotHash" ~ '^[a-f0-9]{64}$' AND "questionContentHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "CatalogReleaseAvailability"
  ADD CONSTRAINT "CatalogReleaseAvailability_validation_hashes_check"
  CHECK ("selectionManifestHash" ~ '^[a-f0-9]{64}$' AND "freshSelectionHash" ~ '^[a-f0-9]{64}$' AND "repeatSelectionHash" ~ '^[a-f0-9]{64}$' AND "selectorVersion" <> '');

-- Validate the new references separately so the initial ALTER obtains a short
-- metadata lock; validation still scans legacy tables and requires a reviewed
-- maintenance window on the isolated target.
ALTER TABLE "Game" VALIDATE CONSTRAINT "Game_catalogReleaseId_fkey";
ALTER TABLE "GameQuestion" VALIDATE CONSTRAINT "GameQuestion_catalogReleaseId_questionRevisionId_fkey";

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'SourceCategoryCrosswalkRevision',
    'CanonicalCategoryRevision',
    'EditorialReviewReceipt',
    'ContentRightsReceipt',
    'QuestionAnswerRevision',
    'MediaRevision',
    'QuestionRevisionMedia',
    'CatalogReleaseSourceSnapshot',
    'CatalogReleaseCategory',
    'CatalogReleaseQuestion',
    'CatalogReleaseAvailability'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_catalog_mutation()',
      table_name || '_immutable_mutation', table_name
    );
  END LOOP;
END;
$$;


