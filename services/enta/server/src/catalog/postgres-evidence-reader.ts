import { createHash, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Prisma } from "@prisma/client";
import {
  deriveEntaSourceCategoryId,
  deriveEntaSourceId,
  MAX_ENTA_SOURCE_ARTIFACT_BYTES,
  ENTA_SOURCE_PARSER_VERSION,
  ENTA_SOURCE_SNAPSHOT_VERSION,
  normalizeEntaTextSourcePayload,
  parseJsonRejectingDuplicateKeys,
  verifyEntaSourceArtifactSnapshot,
  type EntaArtifactMember,
  type EntaTextSourcePayload,
} from "./source-artifact";
import { ENTA_CLASSIC_SELECTOR_BUILD_ID, ENTA_CLASSIC_SELECTOR_VERSION } from "./selectors";
import { replayStoredEntaAvailability, type EntaSelectorReplayProof } from "./selector-replay";

type ReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type EntaEvidenceReadPrincipal = "validator" | "issuer";

export interface EntaPostgresEvidenceRequest {
  catalogReleaseId: string;
  expectedReleaseRootHash: string;
  expectedSourceRootSha256: string;
  rawArtifactBytes: Uint8Array;
}

export interface VerifiedEntaRevision {
  questionRevisionId: string;
  sourceQuestionId: string;
  categoryKey: string;
  sourceNamespace: string;
  sourceCategoryId: string;
  sourceQuestionCategoryId: string;
  categoryEditorialDecision: string;
  questionEditorialDecision: string;
  questionRightsDecision: string;
  sourcePoints: number;
  engine: string;
  mode: string;
  tier: string;
  modality: string;
  sourceHasQuestionMedia: boolean;
  sourceCategoryHasCoverMedia: boolean;
}

export interface StoredEntaAvailability {
  categoryKey: string; engine: string; mode: string; tier: string; modality: string; selectorVersion: string;
  selectionManifestHash: string; freshSelectionHash: string; repeatSelectionHash: string;
  freshSelectionIds: string[]; repeatSelectionIds: string[]; freshSelectionSeed: number; repeatSelectionSeed: number;
}

export type EntaPostgresEvidenceResult =
  | { status: "partial"; reasonCodes: string[]; structuralStatus: "verified"; selectorStatus: "verified" | "incomplete" | "rejected"; provenanceStatus: "unavailable"; evidenceRef: string; catalogReleaseId: string; releaseRootHash: string; sourceReleaseId: string; sourceRootSha256: string; sourceSnapshotHash: string; sourceEvidenceManifestHash: string; selectorVersion: string; selectorBuildId: string; revisions: VerifiedEntaRevision[]; declaredAvailability: StoredEntaAvailability[]; selectorProofs: EntaSelectorReplayProof[]; receiptClaims: EntaReceiptClaim[] }
  | { status: "rejected" | "unavailable"; reasonCode: string };

export interface EntaReceiptClaim {
  receiptId: string;
  evidenceType: "EDITORIAL" | "RIGHTS";
  sourceNamespace: string;
  sourceKey: string;
  sourceRevision: number;
  subjectHash: string;
  evidenceHash: string;
  decision: string;
  rightsHolderRef?: string;
  licenseRef?: string;
  usageScope?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SOURCE_NAMESPACE = "enta.question";

function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

function receiptIdentity(claim: Pick<EntaReceiptClaim, "evidenceType" | "receiptId">): string {
  return JSON.stringify([claim.evidenceType, claim.receiptId]);
}

function deduplicateReceiptClaims(claims: readonly EntaReceiptClaim[]): EntaReceiptClaim[] | undefined {
  const byIdentity = new Map<string, { canonical: string; claim: EntaReceiptClaim }>();
  for (const claim of claims) {
    const identity = receiptIdentity(claim);
    const canonical = JSON.stringify([
      claim.sourceNamespace, claim.sourceKey, claim.sourceRevision, claim.subjectHash,
      claim.evidenceHash, claim.decision, claim.rightsHolderRef ?? null,
      claim.licenseRef ?? null, claim.usageScope ?? null,
    ]);
    const previous = byIdentity.get(identity);
    if (previous && previous.canonical !== canonical) return undefined;
    if (!previous) byIdentity.set(identity, { canonical, claim });
  }
  return [...byIdentity.values()].map(({ claim }) => claim);
}

function hashMatches(text: string, expected: unknown): expected is string {
  if (typeof expected !== "string" || !SHA256.test(expected)) return false;
  const actual = Buffer.from(sha256(text), "hex");
  const wanted = Buffer.from(expected, "hex");
  return timingSafeEqual(actual, wanted);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function reject(reasonCode: string, status: "rejected" | "unavailable" = "rejected"): EntaPostgresEvidenceResult {
  return { status, reasonCode };
}

/**
 * Reads only through the caller's PostgreSQL role and the already reviewed
 * invoker helpers. Call inside one REPEATABLE READ transaction connected as
 * catalog_validator. This function performs no writes and never issues a
 * receipt. Its evidence result is private and synthetic fixtures prove wiring,
 * not editorial approval of any real source rows.
 */
export async function readEntaPostgresReleaseEvidence(
  tx: ReadClient,
  input: EntaPostgresEvidenceRequest,
): Promise<EntaPostgresEvidenceResult> {
  return readEntaPostgresReleaseEvidenceAs(tx, input, "validator");
}

/** Private R3-E companion path; never used by the public/diagnostic reader. */
export async function readEntaPostgresReleaseEvidenceForIssuer(
  tx: ReadClient,
  input: EntaPostgresEvidenceRequest,
): Promise<EntaPostgresEvidenceResult> {
  return readEntaPostgresReleaseEvidenceAs(tx, input, "issuer");
}

async function readEntaPostgresReleaseEvidenceAs(
  tx: ReadClient,
  input: EntaPostgresEvidenceRequest,
  principal: EntaEvidenceReadPrincipal,
): Promise<EntaPostgresEvidenceResult> {
  try {
    const roleRows = await tx.$queryRaw<Array<{
      isValidator: boolean; isRuntime: boolean; isAssembler: boolean; isReviewer: boolean; isPublisher: boolean; isActivator: boolean;
      privilegedAttributes: boolean; ownsCatalogTables: boolean; canWriteProofData: boolean; canSeal: boolean; canActivate: boolean;
      isolationLevel: string; readOnly: boolean; sessionUser: string; issuerLoginValid: boolean;
      issuerNoRoleMemberships: boolean; issuerOwnerCustodyValid: boolean; issuerCanExecute: boolean; canReadProofData: boolean;
    }>>(Prisma.sql`
      SELECT pg_has_role(session_user,'catalog_validator','member') AS "isValidator",
        pg_has_role(session_user,'enta_runtime','member') AS "isRuntime",
        pg_has_role(session_user,'catalog_assembler','member') AS "isAssembler",
        pg_has_role(session_user,'catalog_reviewer','member') AS "isReviewer",
        pg_has_role(session_user,'catalog_publisher','member') AS "isPublisher",
        pg_has_role(session_user,'catalog_activator','member') AS "isActivator",
        COALESCE((SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=session_user),true) AS "privilegedAttributes",
        EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname IN ('QuestionRevision','CatalogRelease','CatalogReleaseSourceSnapshot')
          AND pg_has_role(session_user,c.relowner,'USAGE')) AS "ownsCatalogTables",
        EXISTS(SELECT 1 FROM (VALUES
          ('SourceCategoryCrosswalkRevision'),('CanonicalCategoryRevision'),('EditorialReviewReceipt'),('ContentRightsReceipt'),
          ('QuestionRevision'),('QuestionAnswerRevision'),('MediaRevision'),('QuestionRevisionMedia'),('QuestionRevisionSeal'),
          ('CatalogRelease'),('CatalogReleaseSourceSnapshot'),('CatalogReleaseCategory'),('CatalogReleaseQuestion'),
          ('CatalogReleaseAvailability'),('CatalogReleaseSeal'),('CatalogValidationReceipt'),('CatalogValidationProof')
        ) AS proof_table(name) JOIN pg_catalog.pg_class c ON c.relname=proof_table.name
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
          CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) AS mutation(privilege)
        WHERE has_table_privilege(session_user,c.oid,mutation.privilege)) AS "canWriteProofData",
        has_function_privilege(session_user,'public.seal_question_revision(text)','EXECUTE') OR
          has_function_privilege(session_user,'public.seal_catalog_release(text)','EXECUTE') AS "canSeal",
        has_function_privilege(session_user,'public.activate_catalog_release(text,text)','EXECUTE') AS "canActivate",
        session_user AS "sessionUser",
        session_user='enta_catalog_issuer_login' AND COALESCE((SELECT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=session_user),false) AS "issuerLoginValid",
        NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=session_user)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname=session_user) AS "issuerNoRoleMemberships",
        (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
          WHERE owner_role.rolname='catalog_issuer')=1
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
            JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
            JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
            JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
            WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
              AND grantor_role.rolname='enta_catalog_bootstrap_dba' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
            WHERE member_role.rolname='catalog_issuer')
          AND NOT has_schema_privilege('catalog_issuer','public','CREATE') AS "issuerOwnerCustodyValid",
        has_function_privilege(session_user,'public.issue_r3e_catalog_receipt(text,text,text,text,text,text,text,text,text,text,text,text,text)','EXECUTE') AS "issuerCanExecute",
        EXISTS(SELECT 1 FROM (VALUES
          ('SourceCategoryCrosswalkRevision'),('CanonicalCategoryRevision'),('EditorialReviewReceipt'),('ContentRightsReceipt'),
          ('QuestionRevision'),('QuestionAnswerRevision'),('MediaRevision'),('QuestionRevisionMedia'),
          ('QuestionRevisionSeal'),('CatalogRelease'),('CatalogReleaseSourceSnapshot'),('CatalogReleaseCategory'),
          ('CatalogReleaseQuestion'),('CatalogReleaseAvailability'),('CatalogReleaseSeal'),('CatalogValidationReceipt')
        ) AS proof_table(name) WHERE has_table_privilege(session_user,format('public.%I',proof_table.name),'SELECT')) AS "canReadProofData",
        current_setting('transaction_isolation') AS "isolationLevel",
        current_setting('transaction_read_only')='on' AS "readOnly"
    `);
    const role = roleRows[0];
    if (!role || role.isolationLevel !== "repeatable read" || (principal === "validator" && !role.readOnly) ||
        (principal === "issuer" && (role.readOnly || role.sessionUser !== "enta_catalog_issuer_login" || !role.issuerLoginValid ||
          !role.issuerNoRoleMemberships || !role.issuerOwnerCustodyValid || !role.issuerCanExecute || !role.canReadProofData))) return reject("DATABASE_READER_TRANSACTION_INVALID", "unavailable");
    if (principal === "validator" && (!role.isValidator || role.isRuntime || role.isAssembler || role.isReviewer || role.isPublisher || role.isActivator ||
        role.privilegedAttributes || role.ownsCatalogTables || role.canWriteProofData || role.canSeal || role.canActivate)) {
      return reject("DATABASE_READER_ROLE_INVALID", "unavailable");
    }
    if (principal === "issuer" && (role.isValidator || role.isRuntime || role.isAssembler || role.isReviewer || role.isPublisher || role.isActivator ||
        role.privilegedAttributes || role.ownsCatalogTables || role.canWriteProofData || role.canSeal || role.canActivate)) return reject("DATABASE_READER_ROLE_INVALID", "unavailable");

    if (!input.catalogReleaseId.trim() || !SHA256.test(input.expectedReleaseRootHash) ||
        !SHA256.test(input.expectedSourceRootSha256) || input.rawArtifactBytes.byteLength === 0 ||
        input.rawArtifactBytes.byteLength > MAX_ENTA_SOURCE_ARTIFACT_BYTES) {
      return reject("EVIDENCE_REQUEST_INVALID");
    }

    const sourceRootHash = sha256(input.rawArtifactBytes);
    if (sourceRootHash !== input.expectedSourceRootSha256) return reject("SOURCE_ROOT_MISMATCH");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.rawArtifactBytes);
    const rawArtifact = record(parseJsonRejectingDuplicateKeys(decoded));
    if (!rawArtifact) return reject("SOURCE_ARTIFACT_SHAPE_INVALID");

    const artifactLocators = new Map<string, {
      categoryName: string; arrayIndexOneBased: number; sourcePayload: EntaTextSourcePayload; sourceId: string; sourceCategoryId: string;
    }>();
    let artifactRowCount = 0;
    for (const [categoryName, values] of Object.entries(rawArtifact)) {
      if (!categoryName.trim() || !Array.isArray(values)) return reject("SOURCE_ARTIFACT_SHAPE_INVALID");
      for (let index = 0; index < values.length; index += 1) {
        artifactRowCount += 1;
        if (artifactRowCount > 10000) return reject("SOURCE_ARTIFACT_MEMBER_LIMIT");
        const sourcePayload = normalizeEntaTextSourcePayload(values[index]);
        if (!sourcePayload) return reject("SOURCE_PAYLOAD_UNSUPPORTED");
        const locator = {
          categoryName,
          arrayIndexOneBased: index + 1,
          sourcePayload,
          sourceId: deriveEntaSourceId({ artifactSha256: sourceRootHash, categoryName, arrayIndexOneBased: index + 1 }),
          sourceCategoryId: deriveEntaSourceCategoryId(categoryName),
        };
        if (artifactLocators.has(locator.sourceId)) return reject("SOURCE_LOCATOR_DUPLICATE");
        artifactLocators.set(locator.sourceId, locator);
      }
    }

    const releases = await tx.$queryRaw<Array<{
      id: string; releaseRootHash: string; sealedAt: Date | null; sealHash: string; canonicalizationVersion: number;
      releasePayloadText: string; sealPayloadText: string;
    }>>(Prisma.sql`
      SELECT r."id", r."releaseRootHash", r."sealedAt", s."sealHash", s."canonicalizationVersion",
        public.int4_release_payload(r."id")::text AS "releasePayloadText",
        jsonb_build_object('releaseId',r."id",'releaseRootHash',r."releaseRootHash",'canonicalizationVersion',s."canonicalizationVersion")::text AS "sealPayloadText"
      FROM public."CatalogRelease" r
      JOIN public."CatalogReleaseSeal" s ON s."catalogReleaseId"=r."id" AND s."releaseRootHash"=r."releaseRootHash"
      WHERE r."id"=${input.catalogReleaseId} AND r."sealedAt" IS NOT NULL
    `);
    if (releases.length !== 1) return reject("SEALED_RELEASE_MISSING");
    const release = releases[0];
    if (release.releaseRootHash !== input.expectedReleaseRootHash || !hashMatches(release.releasePayloadText, release.releaseRootHash) ||
        release.canonicalizationVersion !== 1 || !hashMatches(release.sealPayloadText, release.sealHash)) return reject("RELEASE_SEAL_MISMATCH");

    const snapshots = await tx.$queryRaw<Array<{ sourceNamespace: string; sourceReleaseId: string; sourceRootSha256: string; snapshotHash: string }>>(Prisma.sql`
      SELECT "sourceNamespace", "sourceReleaseId", "sourceRootSha256", "snapshotHash"
      FROM public."CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=${input.catalogReleaseId}
      ORDER BY "sourceNamespace"
    `);
    const sourceSnapshot = snapshots.find((row) => row.sourceNamespace === SOURCE_NAMESPACE);
    if (snapshots.length !== 1 || !sourceSnapshot ||
        sourceSnapshot.sourceRootSha256 !== sourceRootHash || !SHA256.test(sourceSnapshot.snapshotHash)) return reject("SOURCE_SNAPSHOT_IDENTITY_MISMATCH");

    const summaryRows = await tx.$queryRaw<Array<{ summaryText: string; summaryHash: string }>>(Prisma.sql`
      SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
        FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=${input.catalogReleaseId}),'[]') AS "summaryText",
        encode(int4_crypto.digest(convert_to(COALESCE((SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
        FROM public."CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=${input.catalogReleaseId}),'[]'),'UTF8'),'sha256'),'hex') AS "summaryHash"
    `);
    if (summaryRows.length !== 1 || !hashMatches(summaryRows[0].summaryText, summaryRows[0].summaryHash)) return reject("SOURCE_SUMMARY_HASH_MISMATCH");

    const availability = await tx.$queryRaw<StoredEntaAvailability[]>(Prisma.sql`
      SELECT "categoryKey", "engine", "mode", "tier", "modality", "selectorVersion", "selectionManifestHash",
        "freshSelectionHash", "repeatSelectionHash", "freshSelectionIds", "repeatSelectionIds", "freshSelectionSeed", "repeatSelectionSeed"
      FROM public."CatalogReleaseAvailability" WHERE "catalogReleaseId"=${input.catalogReleaseId}
      ORDER BY "categoryKey","engine","mode","tier","modality"
    `);
    const releasePayload = record(parseJsonRejectingDuplicateKeys(release.releasePayloadText));
    const payloadAvailability = Array.isArray(releasePayload?.availability) ? releasePayload.availability : undefined;
    const dbAvailabilityShape = availability.map((row) => ({ ...row }));
    if (!payloadAvailability || !isDeepStrictEqual(payloadAvailability, dbAvailabilityShape)) {
      return reject("SEALED_AVAILABILITY_MISMATCH");
    }

    const members = await tx.$queryRaw<Array<{
      revisionId: string; sourceNamespace: string; sourceQuestionId: string; sourceContentHash: string; contentHash: string;
      revision: number; sourceCategoryId: string; canonicalCategoryKey: string; prompt: string; points: number; hints: string[];
      engine: string; mode: string; tier: string; modality: string; crosswalkNamespace: string; crosswalkSourceCategoryId: string;
      crosswalkCategoryKey: string; crosswalkHash: string; questionPayloadText: string; sourcePayloadText: string;
      crosswalkCalculatedHash: string; questionSealHash: string; answerManifestHash: string; mediaManifestHash: string;
      computedAnswerManifestHash: string; computedMediaManifestHash: string; categoryRevisionId: string;
      categoryRevision: number;
      categoryContentHash: string; categoryEditorialDecision: string; categoryEditorialReceiptDecision: string; categoryEditorialSubjectHash: string;
      categoryCoverId: string | null; categoryPayloadText: string; categoryEditorialReceiptId: string; categoryEditorialEvidenceHash: string;
      questionEditorialReceiptId: string; questionEditorialEvidenceHash: string; questionRightsReceiptId: string; questionRightsEvidenceHash: string;
      rightsHolderRef: string; licenseRef: string; questionEditorialDecision: string;
      questionEditorialNamespace: string; questionEditorialSourceKey: string; questionEditorialRevision: number;
      questionEditorialSubjectHash: string; questionRightsDecision: string; questionRightsNamespace: string;
      questionRightsSubjectType: string;
      questionRightsSourceKey: string; questionRightsSubjectHash: string; categoryEditorialNamespace: string;
      categoryEditorialSourceKey: string; categoryEditorialRevision: number;
    }>>(Prisma.sql`
      SELECT q."id" AS "revisionId", q."sourceNamespace", q."sourceQuestionId", q."sourceContentHash", q."contentHash", q."revision",
        q."sourceCategoryId", q."canonicalCategoryKey", q."prompt", q."points", q."hints", q."engine", q."mode", q."tier", q."modality",
        x."sourceNamespace" AS "crosswalkNamespace", x."sourceCategoryId" AS "crosswalkSourceCategoryId",
        x."canonicalCategoryKey" AS "crosswalkCategoryKey", x."mappingHash" AS "crosswalkHash",
        encode(int4_crypto.digest(convert_to(jsonb_build_object('sourceNamespace',x."sourceNamespace",'sourceCategoryId',x."sourceCategoryId",'revision',x."revision",'canonicalCategoryKey',x."canonicalCategoryKey")::text,'UTF8'),'sha256'),'hex') AS "crosswalkCalculatedHash",
        public.int4_question_payload(q."id")::text AS "questionPayloadText",
        CASE WHEN count(a."id")=1 AND bool_and(a."isCorrect") AND NOT bool_or(a."isTrap") AND min(a."points")=q."points"
          AND cardinality(q."hints")=0 THEN jsonb_build_object('text',q."prompt",'answer',min(a."text"),'points',q."points")::text
          WHEN count(a."id")=1 AND bool_and(a."isCorrect") AND NOT bool_or(a."isTrap") AND min(a."points")=q."points"
          AND cardinality(q."hints")=1 THEN jsonb_build_object('text',q."prompt",'answer',min(a."text"),'points',q."points",'hint',q."hints"[1])::text
          ELSE NULL END AS "sourcePayloadText",
        qs."contentHash" AS "questionSealHash", qs."answerManifestHash", qs."mediaManifestHash",
        public.int4_question_child_manifest(q."id",'answer') AS "computedAnswerManifestHash",
        public.int4_question_child_manifest(q."id",'media') AS "computedMediaManifestHash",
        c."categoryRevisionId", c."categoryRevision", c."categoryContentHash", c."categoryRevisionEditorialDecision" AS "categoryEditorialDecision",
        c."categoryEditorialNamespace", c."categoryEditorialSourceKey", c."categoryEditorialRevision", c."categoryEditorialReceiptDecision",
        c."categoryEditorialSubjectHash", c."categoryCoverId", c."categoryPayloadText", c."categoryEditorialReceiptId", c."categoryEditorialEvidenceHash",
        qer."id" AS "questionEditorialReceiptId", qer."decision" AS "questionEditorialDecision", qer."sourceNamespace" AS "questionEditorialNamespace",
        qer."evidenceHash" AS "questionEditorialEvidenceHash", qer."sourceKey" AS "questionEditorialSourceKey", qer."sourceRevision" AS "questionEditorialRevision",
        qer."subjectHash" AS "questionEditorialSubjectHash",
        qr."id" AS "questionRightsReceiptId", qr."evidenceHash" AS "questionRightsEvidenceHash", qr."rightsHolderRef", qr."licenseRef", qr."decision" AS "questionRightsDecision", qr."sourceNamespace" AS "questionRightsNamespace", qr."subjectType" AS "questionRightsSubjectType",
        qr."sourceKey" AS "questionRightsSourceKey", qr."subjectHash" AS "questionRightsSubjectHash"
      FROM public."CatalogReleaseQuestion" m
      JOIN public."QuestionRevision" q ON q."id"=m."questionRevisionId"
      JOIN public."SourceCategoryCrosswalkRevision" x ON x."id"=q."crosswalkRevisionId"
      JOIN public."QuestionRevisionSeal" qs ON qs."questionRevisionId"=q."id" AND qs."contentHash"=q."contentHash"
      JOIN public."EditorialReviewReceipt" qer ON qer."id"=q."editorialReceiptId"
      JOIN public."ContentRightsReceipt" qr ON qr."id"=q."rightsReceiptId"
      JOIN public."CatalogReleaseCategory" rc ON rc."catalogReleaseId"=m."catalogReleaseId" AND rc."categoryKey"=m."categoryKey"
      JOIN public."CanonicalCategoryRevision" cr ON cr."id"=rc."categoryRevisionId"
      JOIN public."EditorialReviewReceipt" cer ON cer."id"=cr."editorialReceiptId"
      JOIN LATERAL (SELECT cr."id" AS "categoryRevisionId", cr."revision" AS "categoryRevision", rc."categoryContentHash", cr."editorialDecision" AS "categoryRevisionEditorialDecision",
        cer."sourceNamespace" AS "categoryEditorialNamespace", cer."sourceKey" AS "categoryEditorialSourceKey",
        cer."id" AS "categoryEditorialReceiptId", cer."evidenceHash" AS "categoryEditorialEvidenceHash", cer."sourceRevision" AS "categoryEditorialRevision", cer."decision" AS "categoryEditorialReceiptDecision", cer."subjectHash" AS "categoryEditorialSubjectHash",
        cr."coverMediaRevisionId" AS "categoryCoverId",
        public.int4_category_payload(cr."id")::text AS "categoryPayloadText") c ON TRUE
      LEFT JOIN public."QuestionAnswerRevision" a ON a."questionRevisionId"=q."id"
      WHERE m."catalogReleaseId"=${input.catalogReleaseId}
      GROUP BY q."id",x."sourceNamespace",x."sourceCategoryId",x."revision",x."canonicalCategoryKey",x."mappingHash",qs."contentHash",qs."answerManifestHash",qs."mediaManifestHash",
        c."categoryRevisionId",c."categoryContentHash",c."categoryRevisionEditorialDecision",c."categoryEditorialSubjectHash",c."categoryCoverId",c."categoryPayloadText",c."categoryEditorialReceiptId",c."categoryEditorialEvidenceHash",
        c."categoryRevision",c."categoryEditorialNamespace",c."categoryEditorialSourceKey",c."categoryEditorialRevision",c."categoryEditorialReceiptDecision",
        qer."id",qer."evidenceHash",qer."decision",qer."sourceNamespace",qer."sourceKey",qer."sourceRevision",qer."subjectHash",
        qr."id",qr."evidenceHash",qr."rightsHolderRef",qr."licenseRef",qr."decision",qr."sourceNamespace",qr."subjectType",qr."sourceKey",qr."subjectHash"
      ORDER BY q."sourceQuestionId"
    `);

    const membershipIds = new Set(members.map((row) => row.sourceQuestionId));
    if (membershipIds.size !== members.length) return reject("SOURCE_MEMBERSHIP_DUPLICATE");
    const artifactMembers: EntaArtifactMember[] = [];
    const revisions: VerifiedEntaRevision[] = [];
    const receiptClaims: EntaReceiptClaim[] = [];
    for (const row of members) {
      const locator = artifactLocators.get(row.sourceQuestionId);
      if (!locator || row.sourceNamespace !== SOURCE_NAMESPACE || row.sourceCategoryId !== locator.sourceCategoryId ||
          row.crosswalkNamespace !== SOURCE_NAMESPACE ||
          row.crosswalkSourceCategoryId !== locator.sourceCategoryId || row.crosswalkCategoryKey !== row.canonicalCategoryKey ||
          row.crosswalkHash !== row.crosswalkCalculatedHash) return reject("SOURCE_CROSSWALK_MISMATCH");
      if (row.categoryCoverId !== null || row.categoryEditorialDecision !== "APPROVED") return reject("CATEGORY_EDITORIAL_POLICY_MISMATCH");
      if (row.categoryEditorialNamespace !== "canonical.category") return reject("CATEGORY_EDITORIAL_NAMESPACE_MISMATCH");
      if (row.categoryEditorialSourceKey !== row.canonicalCategoryKey) return reject("CATEGORY_EDITORIAL_SOURCE_KEY_MISMATCH");
      if (row.categoryEditorialRevision !== row.categoryRevision) return reject("CATEGORY_EDITORIAL_REVISION_MISMATCH");
      if (row.categoryEditorialReceiptDecision !== "APPROVED") return reject("CATEGORY_EDITORIAL_RECEIPT_DECISION_MISMATCH");
      if (row.categoryEditorialSubjectHash !== row.categoryContentHash) return reject("CATEGORY_EDITORIAL_HASH_MISMATCH");
      if (!hashMatches(row.categoryPayloadText, row.categoryContentHash)) return reject("CATEGORY_CANONICAL_HASH_MISMATCH");
      if (row.questionEditorialDecision !== "APPROVED" || row.questionEditorialSubjectHash !== row.contentHash ||
          row.questionEditorialNamespace !== SOURCE_NAMESPACE || row.questionEditorialSourceKey !== row.sourceQuestionId ||
          row.questionEditorialRevision !== row.revision || row.questionRightsDecision !== "CLEARED" ||
          row.questionRightsSubjectHash !== row.contentHash || row.questionRightsNamespace !== SOURCE_NAMESPACE ||
          row.questionRightsSubjectType !== "QUESTION" || row.questionRightsSourceKey !== row.sourceQuestionId ||
          row.questionSealHash !== row.contentHash || !row.sourcePayloadText ||
          row.answerManifestHash !== row.computedAnswerManifestHash || row.mediaManifestHash !== row.computedMediaManifestHash ||
          !hashMatches(row.sourcePayloadText, row.sourceContentHash) || !hashMatches(row.questionPayloadText, row.contentHash)) return reject("REVISION_EDITORIAL_OR_HASH_MISMATCH");
      const sourcePayload = normalizeEntaTextSourcePayload(parseJsonRejectingDuplicateKeys(row.sourcePayloadText));
      if (!sourcePayload || JSON.stringify(sourcePayload) !== JSON.stringify(locator.sourcePayload)) return reject("SOURCE_CONTENT_MISMATCH");
      const questionPayload = record(parseJsonRejectingDuplicateKeys(row.questionPayloadText));
      const question = record(questionPayload?.question);
      const answers = questionPayload?.answers;
      const media = questionPayload?.media;
      const categoryPayload = record(parseJsonRejectingDuplicateKeys(row.categoryPayloadText));
      const category = record(categoryPayload?.category);
      if (!question || !Array.isArray(answers) || answers.length !== 1 || !record(answers[0])?.isCorrect ||
          !Array.isArray(media) || media.length !== 0 || !category || category.cover !== null ||
          question.sourceQuestionId !== locator.sourceId || question.sourceCategoryId !== locator.sourceCategoryId ||
          question.canonicalCategoryKey !== row.canonicalCategoryKey || question.points !== locator.sourcePayload.points ||
          question.engine !== "ENTA" || question.mode !== "CLASSIC" || question.tier !== String(locator.sourcePayload.points) || question.modality !== "classic") {
        return reject("REVISION_TRANSFORM_MISMATCH");
      }
      artifactMembers.push({
        sourceId: locator.sourceId, artifactSha256: sourceRootHash, categoryName: locator.categoryName,
        arrayIndexOneBased: locator.arrayIndexOneBased, sourceCategoryId: locator.sourceCategoryId,
        categoryKey: row.canonicalCategoryKey, sourcePayload: locator.sourcePayload,
        untrustedSourcePayloadJsonbText: row.sourcePayloadText, sourceContentHash: row.sourceContentHash,
      });
      revisions.push({
        questionRevisionId: row.revisionId, sourceQuestionId: row.sourceQuestionId, categoryKey: row.canonicalCategoryKey,
        sourceNamespace: row.sourceNamespace, sourceCategoryId: locator.sourceCategoryId,
        sourceQuestionCategoryId: row.crosswalkSourceCategoryId,
        categoryEditorialDecision: row.categoryEditorialDecision, questionEditorialDecision: row.questionEditorialDecision,
        questionRightsDecision: row.questionRightsDecision, sourcePoints: row.points, engine: row.engine,
        mode: row.mode, tier: row.tier, modality: row.modality,
        sourceHasQuestionMedia: media.length > 0, sourceCategoryHasCoverMedia: row.categoryCoverId !== null,
      });
      receiptClaims.push(
        { receiptId: row.categoryEditorialReceiptId, evidenceType: "EDITORIAL", sourceNamespace: row.categoryEditorialNamespace,
          sourceKey: row.categoryEditorialSourceKey, sourceRevision: row.categoryEditorialRevision,
          subjectHash: row.categoryEditorialSubjectHash, evidenceHash: row.categoryEditorialEvidenceHash, decision: row.categoryEditorialReceiptDecision },
        { receiptId: row.questionEditorialReceiptId, evidenceType: "EDITORIAL", sourceNamespace: row.questionEditorialNamespace,
          sourceKey: row.questionEditorialSourceKey, sourceRevision: row.questionEditorialRevision,
          subjectHash: row.questionEditorialSubjectHash, evidenceHash: row.questionEditorialEvidenceHash, decision: row.questionEditorialDecision },
        { receiptId: row.questionRightsReceiptId, evidenceType: "RIGHTS", sourceNamespace: row.questionRightsNamespace,
          sourceKey: row.questionRightsSourceKey, sourceRevision: row.revision,
          subjectHash: row.questionRightsSubjectHash, evidenceHash: row.questionRightsEvidenceHash, decision: row.questionRightsDecision,
          rightsHolderRef: row.rightsHolderRef, licenseRef: row.licenseRef },
      );
    }
    if (artifactMembers.length !== members.length) return reject("SOURCE_MEMBERSHIP_MISSING");
    const uniqueReceiptClaims = deduplicateReceiptClaims(receiptClaims);
    if (!uniqueReceiptClaims) return reject("RECEIPT_CLAIM_CONFLICT");

    const releaseCategories = await tx.$queryRaw<Array<{ categoryKey: string }>>(Prisma.sql`
      SELECT "categoryKey" FROM public."CatalogReleaseCategory" WHERE "catalogReleaseId"=${input.catalogReleaseId} ORDER BY "categoryKey"
    `);
    const categoryKeys = [...new Set(revisions.map((revision) => revision.categoryKey))].sort();
    const releaseCategoryKeys = releaseCategories.map(({ categoryKey }) => categoryKey);
    if (releaseCategoryKeys.length === 0 || releaseCategoryKeys.length !== categoryKeys.length ||
        releaseCategoryKeys.some((categoryKey, index) => categoryKey !== categoryKeys[index])) return reject("RELEASE_CATEGORY_MEMBERSHIP_MISMATCH");

    const membersForSnapshot = artifactMembers.map(({ untrustedSourcePayloadJsonbText: _untrusted, ...member }) => member)
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const snapshotRows = await tx.$queryRaw<Array<{ snapshotJsonbText: string }>>(Prisma.sql`
      SELECT jsonb_build_object('version',${ENTA_SOURCE_SNAPSHOT_VERSION},'sourceNamespace',${SOURCE_NAMESPACE},
        'sourceReleaseId',${sourceSnapshot.sourceReleaseId},'sourceRootSha256',${sourceRootHash},
        'parserVersion',${ENTA_SOURCE_PARSER_VERSION},'members',${JSON.stringify(membersForSnapshot)}::jsonb)::text AS "snapshotJsonbText"
    `);
    if (snapshotRows.length !== 1 || Buffer.byteLength(snapshotRows[0].snapshotJsonbText, "utf8") > MAX_ENTA_SOURCE_ARTIFACT_BYTES ||
        !hashMatches(snapshotRows[0].snapshotJsonbText, sourceSnapshot.snapshotHash)) return reject("SOURCE_SNAPSHOT_HASH_MISMATCH");
    const artifactCheck = verifyEntaSourceArtifactSnapshot({
      rawArtifactBytes: input.rawArtifactBytes, expectedSourceRootSha256: sourceRootHash, sourceNamespace: SOURCE_NAMESPACE,
      sourceReleaseId: sourceSnapshot.sourceReleaseId, expectedSnapshotHash: sourceSnapshot.snapshotHash,
      snapshotJsonbText: snapshotRows[0].snapshotJsonbText, members: artifactMembers.sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    });
    if (!artifactCheck.artifactSnapshotMatched) return reject(artifactCheck.reasons[0] ?? "SOURCE_ARTIFACT_SNAPSHOT_MISMATCH");

    const selectorReplay = replayStoredEntaAvailability(availability, revisions, releaseCategoryKeys);
    const selectorPending = selectorReplay.status === "verified" ? [] : ["SELECTOR_REPLAY_PENDING"];
    const tierReason = selectorReplay.status === "incomplete" ? [selectorReplay.reasonCode] : [];
    const selectorRejectReason = selectorReplay.status === "rejected" ? [selectorReplay.reasonCode] : [];
    return {
      status: "partial",
      reasonCodes: [...tierReason, ...selectorRejectReason, ...selectorPending, "INDEPENDENT_EDITORIAL_PROVENANCE_PENDING", "ISSUER_POLICY_PENDING"].sort(),
      structuralStatus: "verified",
      selectorStatus: selectorReplay.status,
      provenanceStatus: "unavailable",
      evidenceRef: `postgres-read:${input.catalogReleaseId}:${sourceSnapshot.snapshotHash}`,
      catalogReleaseId: input.catalogReleaseId,
      releaseRootHash: release.releaseRootHash,
      sourceReleaseId: sourceSnapshot.sourceReleaseId,
      sourceRootSha256: sourceSnapshot.sourceRootSha256,
      sourceSnapshotHash: sourceSnapshot.snapshotHash,
      sourceEvidenceManifestHash: summaryRows[0].summaryHash,
      selectorVersion: ENTA_CLASSIC_SELECTOR_VERSION,
      selectorBuildId: ENTA_CLASSIC_SELECTOR_BUILD_ID,
      revisions,
      declaredAvailability: availability,
      selectorProofs: selectorReplay.status === "verified" ? selectorReplay.proofs : [],
      receiptClaims: uniqueReceiptClaims,
    };
  } catch (error) {
    // Let database failures escape so the caller's savepoint/transaction can
    // roll back the failed statement. Returning a closed result from an aborted
    // PostgreSQL transaction would hide the primary SQL error and break cleanup.
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError ||
        (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string")) throw error;
    const message = error instanceof Error ? error.message : "POSTGRES_EVIDENCE_READ_FAILED";
    return reject(/^[A-Z0-9_]{1,80}$/.test(message) ? message : "POSTGRES_EVIDENCE_READ_FAILED", "unavailable");
  }
}

export interface EntaIssuerSourceIdentity {
  catalogReleaseId: string;
  releaseRootHash: string;
  sealHash: string;
  sourceNamespace: string;
  sourceReleaseId: string;
  sourceRootSha256: string;
  snapshotHash: string;
}

/** Read source lineage from the same caller-owned issuer transaction before registry IO. */
export async function readEntaIssuerSourceIdentity(tx: ReadClient, catalogReleaseId: string): Promise<EntaIssuerSourceIdentity | undefined> {
  const rows = await tx.$queryRaw<Array<{
    sessionUser: string; isolationLevel: string; readOnly: boolean; issuerLoginValid: boolean; issuerNoRoleMemberships: boolean;
    issuerOwnerCustodyValid: boolean; catalogReleaseId: string; releaseRootHash: string; sealHash: string;
    sourceNamespace: string; sourceReleaseId: string; sourceRootSha256: string; snapshotHash: string;
  }>>(Prisma.sql`
    SELECT session_user AS "sessionUser", current_setting('transaction_isolation') AS "isolationLevel",
      current_setting('transaction_read_only')='on' AS "readOnly",
      session_user='enta_catalog_issuer_login' AND COALESCE((SELECT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=session_user),false) AS "issuerLoginValid",
      NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.member WHERE r.rolname=session_user)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid WHERE r.rolname=session_user) AS "issuerNoRoleMemberships",
      (SELECT count(*) FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
        WHERE owner_role.rolname='catalog_issuer')=1
        AND EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m
          JOIN pg_catalog.pg_roles owner_role ON owner_role.oid=m.roleid
          JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
          JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid=m.grantor
          WHERE owner_role.rolname='catalog_issuer' AND member_role.rolname='enta_catalog_migration_custodian'
            AND grantor_role.rolname='enta_catalog_bootstrap_dba' AND m.admin_option AND NOT m.set_option AND NOT m.inherit_option)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles member_role ON member_role.oid=m.member
          WHERE member_role.rolname='catalog_issuer')
        AND NOT has_schema_privilege('catalog_issuer','public','CREATE') AS "issuerOwnerCustodyValid",
      s."catalogReleaseId", r."releaseRootHash", seal."sealHash",
      s."sourceNamespace", s."sourceReleaseId", s."sourceRootSha256", s."snapshotHash"
    FROM public."CatalogReleaseSourceSnapshot" s
    JOIN public."CatalogRelease" r ON r."id"=s."catalogReleaseId" AND r."sealedAt" IS NOT NULL
    JOIN public."CatalogReleaseSeal" seal ON seal."catalogReleaseId"=r."id" AND seal."releaseRootHash"=r."releaseRootHash"
    WHERE s."catalogReleaseId"=${catalogReleaseId} AND s."sourceNamespace"='enta.question'
    ORDER BY s."sourceNamespace"
  `);
  const row = rows[0];
  if (!row || rows.length !== 1 || row.sessionUser !== "enta_catalog_issuer_login" || row.isolationLevel !== "repeatable read" ||
      row.readOnly || !row.issuerLoginValid || !row.issuerNoRoleMemberships || !row.issuerOwnerCustodyValid || !SHA256.test(row.releaseRootHash) ||
      !SHA256.test(row.sealHash) || !SHA256.test(row.sourceRootSha256) || !SHA256.test(row.snapshotHash)) return undefined;
  return row;
}

export async function readR3eDatabaseHelperDefinitions(tx: ReadClient): Promise<Array<{
  identityArguments: string; name: string; source: string;
}> | undefined> {
  const rows = await tx.$queryRaw<Array<{ identityArguments: string; name: string; source: string }>>(Prisma.sql`
    SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) AS "identityArguments",
      CASE WHEN n.nspname='int4_crypto' THEN 'int4_crypto.'||p.proname ELSE p.proname END AS name,
      pg_catalog.pg_get_functiondef(p.oid) AS source
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN
      ('block_r3e_catalog_activation','int4_category_payload','int4_question_child_manifest','int4_question_payload','int4_release_payload',
       'issue_catalog_validation_receipt','issue_r3e_catalog_receipt','reject_immutable_catalog_mutation','reject_r3e_direct_proof_insert',
       'require_r3e_proof_for_successor_receipt')) OR
      (n.nspname='int4_crypto' AND p.proname='digest' AND pg_catalog.pg_get_function_identity_arguments(p.oid)='bytea, text')
    ORDER BY p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
  `);
  const expected = new Set([
    "block_r3e_catalog_activation()",
    "int4_crypto.digest(bytea, text)",
    "int4_category_payload(text)",
    "int4_question_child_manifest(text, text)",
    "int4_question_payload(text)",
    "int4_release_payload(text)",
    "issue_catalog_validation_receipt(text, text, text, text, text, text, text, text, text, text, text)",
    "issue_r3e_catalog_receipt(text, text, text, text, text, text, text, text, text, text, text, text, text)",
    "reject_immutable_catalog_mutation()",
    "reject_r3e_direct_proof_insert()",
    "require_r3e_proof_for_successor_receipt()",
  ]);
  const identities = rows.map((row) => `${row.name}(${row.identityArguments.replace(/\s+/g, " ").trim()})`);
  return rows.length === expected.size && new Set(identities).size === identities.length && identities.every((id) => expected.has(id)) ? rows : undefined;
}

