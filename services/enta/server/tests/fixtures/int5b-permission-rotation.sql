-- REVIEWED DISPOSABLE SUPPORT DRAFT; no production/R3E readiness.
-- Run after existing int5b-synthetic fixture, before candidate INT5B migration.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database() NOT IN ('maydan_perm3_20261005_empty_int5b_test','maydan_perm3_20261005_legacy_int5b_test') OR current_setting('server_encoding')<>'UTF8' OR current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999 OR inet_server_port()<>55440 THEN RAISE EXCEPTION 'exact UTF8 permission-repair target required'; END IF;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=session_user) OR to_regclass('public."HuroofAdmissionProof"') IS NOT NULL OR to_regclass('public."CatalogValidationProof"') IS NOT NULL THEN RAISE EXCEPTION 'DBA preINT5B preR3E fixture only'; END IF;
 IF (SELECT "validationReceiptId" FROM public."ActiveCatalogPointer" WHERE id='singleton') IS DISTINCT FROM 'int5b-synthetic-receipt' THEN RAISE EXCEPTION 'original synthetic pointer required'; END IF;
END $$;
INSERT INTO public."CatalogRelease"("id","releaseRootHash","manifestVersion") VALUES('int5b-rotation-catalog',repeat('b',64),1);
INSERT INTO public."CatalogReleaseSeal"("id","catalogReleaseId","releaseRootHash","sealHash","canonicalizationVersion") VALUES('int5b-rotation-seal','int5b-rotation-catalog',repeat('b',64),repeat('9',64),1);
INSERT INTO public."CatalogValidationReceipt"("id","catalogReleaseId","releaseRootHash","sealHash","validatorRef","policyVersion","sourceEvidenceManifestHash","selectorVersion","huroofProjectId","huroofReleaseId","huroofRootSha256","huroofCapabilityStateHash","huroofSelectorAttestation")
VALUES('int5b-rotation-receipt','int5b-rotation-catalog',repeat('b',64),repeat('9',64),'synthetic-clone-only','int5b-synthetic-policy-v1',repeat('f',64),'int5b-synthetic-selector-v1','demo-int5b-admission','int5b-synthetic-release',repeat('a',64),repeat('d',64),'synthetic-clone-only');
-- Receipt is not activated here. Real restricted activator session races later.
COMMIT;
