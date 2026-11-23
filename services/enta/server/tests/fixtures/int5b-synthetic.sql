-- FROZEN CLONE-ONLY FIXTURE DRAFT. Exact Database/Security rereview first.
-- Prepare on a fresh pre-R3-E INT-5A clone BEFORE INT-5B is applied.
-- These hashes are deliberately synthetic and confer no content approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database() !~ '_int5b_test$' OR current_setting('server_version_num')::INTEGER NOT BETWEEN 180000 AND 189999 THEN RAISE EXCEPTION 'fresh disposable PostgreSQL18 INT5B clone required'; END IF;
 IF to_regclass('public."Wallet"') IS NULL OR to_regclass('public."HuroofAdmissionProof"') IS NOT NULL OR to_regclass('public."CatalogValidationProof"') IS NOT NULL THEN RAISE EXCEPTION 'requires accepted INT5A baseline before INT5B and before R3E'; END IF;
 IF EXISTS(SELECT 1 FROM public."ActiveCatalogPointer") OR EXISTS(SELECT 1 FROM public."CatalogValidationReceipt" WHERE "id"='int5b-synthetic-receipt') THEN RAISE EXCEPTION 'fixture cannot replace an existing active pointer or receipt'; END IF;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) THEN RAISE EXCEPTION 'disposable clone fixture DBA only'; END IF;
END $$;
INSERT INTO public."CatalogRelease"("id","releaseRootHash","manifestVersion") VALUES('int5b-synthetic-catalog',repeat('c',64),1);
INSERT INTO public."CatalogReleaseSeal"("id","catalogReleaseId","releaseRootHash","sealHash","canonicalizationVersion") VALUES('int5b-synthetic-seal','int5b-synthetic-catalog',repeat('c',64),repeat('e',64),1);
INSERT INTO public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash","sealHash","validatorRef","policyVersion","sourceEvidenceManifestHash","selectorVersion","huroofProjectId","huroofReleaseId","huroofRootSha256","huroofCapabilityStateHash","huroofSelectorAttestation")
VALUES('int5b-synthetic-receipt','int5b-synthetic-catalog',repeat('c',64),repeat('e',64),'synthetic-clone-only','int5b-synthetic-policy-v1',repeat('f',64),'int5b-synthetic-selector-v1','demo-int5b-admission','int5b-synthetic-release',repeat('a',64),repeat('d',64),'synthetic-clone-only');
SELECT public.activate_catalog_release(NULL,'int5b-synthetic-receipt');
DO $$ BEGIN
 IF (SELECT "validationReceiptId" FROM public."ActiveCatalogPointer" WHERE "id"='singleton') IS DISTINCT FROM 'int5b-synthetic-receipt' THEN RAISE EXCEPTION 'synthetic pointer activation failed'; END IF;
END $$;
COMMIT;
