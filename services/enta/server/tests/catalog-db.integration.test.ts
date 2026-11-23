import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { test } from "node:test";
import { deriveEntaSourceCategoryId, deriveEntaSourceId, ENTA_SOURCE_PARSER_VERSION } from "../src/catalog/source-artifact";
import { readEntaPostgresReleaseEvidence } from "../src/catalog/postgres-evidence-reader";
import { ENTA_CLASSIC_SELECTOR_VERSION } from "../src/catalog/selectors";
import { verifyIndependentEntaEvidence, type EntaEvidenceReleaseBinding } from "../src/catalog/independent-evidence";
import type { EntaReceiptClaim } from "../src/catalog/postgres-evidence-reader";

const databaseUrl = process.env.INT4_CATALOG_TEST_DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : undefined;
const safeIsolatedDatabase = Boolean(parsedDatabaseUrl &&
  ["localhost", "127.0.0.1", "::1"].includes(parsedDatabaseUrl.hostname) &&
  parsedDatabaseUrl.pathname.toLowerCase().endsWith("_int4_test"));

if (databaseUrl && !safeIsolatedDatabase) {
  throw new Error("INT4_CATALOG_TEST_DATABASE_URL must target a loopback database ending in _int4_test");
}

const EVIDENCE_DOMAIN = Buffer.from("INT4-R3C-MANIFEST-V1\0", "utf8");
const EVIDENCE_ENV = ["ENTA_R3C_MANIFEST_SHA256", "ENTA_R3C_TRUST_ANCHOR_PATH", "ENTA_R3C_REVOCATIONS_PATH", "ENTA_R3C_REGISTRY_DIR"] as const;
const syntheticEvidenceBytes = (claim: Pick<EntaReceiptClaim, "evidenceType" | "sourceNamespace" | "sourceKey">) =>
  Buffer.from(`int4-synthetic-evidence-v1\0${claim.evidenceType}\0${claim.sourceNamespace}\0${claim.sourceKey}`, "utf8");

async function verifySyntheticReceiptManifest(
  claims: readonly EntaReceiptClaim[],
  binding: EntaEvidenceReleaseBinding,
  omittedEvidenceType?: EntaReceiptClaim["evidenceType"],
) {
  const root = await mkdtemp(path.join(tmpdir(), "int4-db-evidence-"));
  const registry = path.join(root, "registry");
  await mkdir(registry);
  const previousEnv = new Map(EVIDENCE_ENV.map((name) => [name, process.env[name]]));
  try {
    const editorial = generateKeyPairSync("ed25519");
    const rights = generateKeyPairSync("ed25519");
    const now = Date.now();
    const iso = (offset: number) => new Date(now + offset).toISOString();
    const decisions = claims.filter((claim) => claim.evidenceType !== omittedEvidenceType).map((claim) => {
      const evidenceBytes = syntheticEvidenceBytes(claim);
      const evidenceDigest = createHash("sha256").update(evidenceBytes).digest("hex");
      return {
        receiptId: claim.receiptId, evidenceType: claim.evidenceType, sourceNamespace: claim.sourceNamespace,
        sourceKey: claim.sourceKey, sourceRevision: claim.sourceRevision, subjectHash: claim.subjectHash,
        decision: claim.decision, evidenceDigest, releaseRootHash: binding.releaseRootHash, revoked: false,
        ...(claim.evidenceType === "EDITORIAL"
          ? { classification: claim.sourceNamespace === "canonical.category" ? "CATEGORY_METADATA" : "CLASSIC" }
          : { rightsScope: "QUESTION_CONTENT", rightsHolderRef: claim.rightsHolderRef, licenseRef: claim.licenseRef }),
      };
    }).sort((a, b) => `${a.evidenceType}\0${a.receiptId}`.localeCompare(`${b.evidenceType}\0${b.receiptId}`));
    for (const claim of claims) {
      const bytes = syntheticEvidenceBytes(claim);
      await writeFile(path.join(registry, createHash("sha256").update(bytes).digest("hex")), bytes, { mode: 0o444 });
    }
    const manifest = {
      version: "enta-r3c-decision-manifest-v1", issuedAt: iso(-60_000), expiresAt: iso(3_600_000), policyVersion: "int4-db-synthetic-v1",
      ...binding, decisions,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
    const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
    const anchor = {
      version: "enta-r3c-trust-anchor-v1", environment: "synthetic",
      keys: [
        { keyId: "editorial-db-test", role: "EDITORIAL", publicKeyPem: editorial.publicKey.export({ type: "spki", format: "pem" }), sourceNamespaces: ["canonical.category", "enta.question"], policyVersions: ["int4-db-synthetic-v1"], notBefore: iso(-3_600_000), notAfter: iso(7_200_000), revokedAt: null },
        { keyId: "rights-db-test", role: "RIGHTS", publicKeyPem: rights.publicKey.export({ type: "spki", format: "pem" }), sourceNamespaces: ["enta.question"], policyVersions: ["int4-db-synthetic-v1"], notBefore: iso(-3_600_000), notAfter: iso(7_200_000), revokedAt: null },
      ],
    };
    const anchorPath = path.join(root, "anchor.json");
    const revocationsPath = path.join(root, "revocations.json");
    await writeFile(anchorPath, JSON.stringify(anchor), { mode: 0o444 });
    await writeFile(revocationsPath, JSON.stringify({ version: "enta-r3c-revocations-v1", issuedAt: iso(-60_000), expiresAt: iso(3_600_000), revokedReceiptIds: [], revokedEvidenceDigests: [] }), { mode: 0o444 });
    await writeFile(path.join(registry, `${manifestSha256}.manifest`), manifestBytes, { mode: 0o444 });
    const signedBytes = Buffer.concat([EVIDENCE_DOMAIN, manifestBytes]);
    await writeFile(path.join(registry, `${manifestSha256}.sig`), JSON.stringify({
      version: "enta-r3c-signature-envelope-v1", manifestSha256,
      signatures: [
        { keyId: "editorial-db-test", signatureBase64: sign(null, signedBytes, editorial.privateKey).toString("base64") },
        { keyId: "rights-db-test", signatureBase64: sign(null, signedBytes, rights.privateKey).toString("base64") },
      ],
    }), { mode: 0o444 });
    process.env.ENTA_R3C_MANIFEST_SHA256 = manifestSha256;
    process.env.ENTA_R3C_TRUST_ANCHOR_PATH = anchorPath;
    process.env.ENTA_R3C_REVOCATIONS_PATH = revocationsPath;
    process.env.ENTA_R3C_REGISTRY_DIR = registry;
    return await verifyIndependentEntaEvidence({ binding, receiptClaims: claims });
  } finally {
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

const sessionRoles = new Set(["enta_runtime", "catalog_assembler", "catalog_reviewer", "catalog_publisher", "catalog_validator", "catalog_activator"]);

async function withSessionAuthorization<T>(
  tx: Prisma.TransactionClient,
  role: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!sessionRoles.has(role)) throw new Error("Unapproved test role");
  await tx.$executeRawUnsafe("SAVEPOINT int4_session_authorization");
  let result: T | undefined;
  let actionFailure: unknown;
  try {
    await tx.$executeRawUnsafe(`SET SESSION AUTHORIZATION ${role}`);
    result = await action();
  } catch (error) {
    actionFailure = error;
    try {
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT int4_session_authorization");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Role-scoped action failed and savepoint recovery also failed");
    }
  }
  try {
    await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT int4_session_authorization");
  } catch (cleanupError) {
    if (actionFailure) {
      throw new AggregateError([actionFailure, cleanupError], "Role-scoped action failed and authorization cleanup also failed");
    }
    throw cleanupError;
  }
  if (actionFailure) throw actionFailure;
  return result as T;
}

async function expectDatabaseFailure(
  tx: Prisma.TransactionClient,
  action: () => Promise<unknown>,
  pattern: RegExp,
  role?: string,
): Promise<void> {
  await tx.$executeRawUnsafe("SAVEPOINT int4_expected_failure");
  if (role) {
    if (!sessionRoles.has(role)) throw new Error("Unapproved test role");
    await tx.$executeRawUnsafe(`SET SESSION AUTHORIZATION ${role}`);
  }
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT int4_expected_failure");
  await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT int4_expected_failure");
  assert.ok(failure, "expected database operation to fail");
  assert.match(failure instanceof Error ? failure.message : String(failure), pattern);
}

test("isolated PostgreSQL seals, validates and activates catalog content under separate roles", { skip: !safeIsolatedDatabase }, async () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl! });
  const token = randomUUID().replaceAll("-", "");
  const id = (prefix: string) => `${prefix}_${token}`;
  const hash = (suffix: string) => `${suffix.repeat(64).slice(0, 64)}`;
  const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  const namespace = "enta.question";
  const categoryKey = `int4-test-${token.slice(0, 12)}`;
  const sourceCategoryName = `فئة "اختبار" \\ ${token.slice(0, 6)}`;
  const sourcePrompt = `سؤال عربي \"مقتبس\" \\\nسطر ثانٍ`;
  const sourceAnswer = `إجابة \"صحيحة\" \\`;
  const sourceHint = `تلميح\n\"خاص\"`;
  const rawArtifactBytes = Buffer.from(JSON.stringify({
    [sourceCategoryName]: [{ text: sourcePrompt, answer: sourceAnswer, points: 200, hint: sourceHint }],
  }), "utf8");
  const sourceRootHash = sha256(rawArtifactBytes);
  const sourceCategoryId = deriveEntaSourceCategoryId(sourceCategoryName);
  const sourceQuestionId = deriveEntaSourceId({ artifactSha256: sourceRootHash, categoryName: sourceCategoryName, arrayIndexOneBased: 1 });
  const categoryEditorialEvidenceHash = sha256(`int4-synthetic-evidence-v1\0EDITORIAL\0canonical.category\0${categoryKey}`);
  const questionEditorialEvidenceHash = sha256(`int4-synthetic-evidence-v1\0EDITORIAL\0${namespace}\0${sourceQuestionId}`);
  const questionRightsEvidenceHash = sha256(`int4-synthetic-evidence-v1\0RIGHTS\0${namespace}\0${sourceQuestionId}`);
  const categoryRevisionId = id("category_revision");
  const categoryEditorialId = id("category_editorial");
  const crosswalkId = id("crosswalk");
  const questionId = id("question_revision");
  const answerId = id("answer_revision");
  const questionEditorialId = id("question_editorial");
  // These are separate tables with independent ID spaces. Deliberately collide
  // this ID to prove provenance uses (evidenceType, receiptId), not ID alone.
  const questionRightsId = questionEditorialId;
  const releaseId = id("release");
  const sourceSnapshotId = id("source_snapshot");
  const sourceReleaseId = id("source_release");
  let snapshotHash = "";
  let sourceContentHash = "";
  let releaseRootHash = "";
  let sourceEvidenceManifestHash = "";
  const validHostUserId = id("valid_new_game_user");
  let primaryFailure: unknown;
  const answerContentHash = hash("d");
  const releasePlaceholderHash = hash("e");

  try {
    await prisma.$transaction(async (tx) => {
      const crosswalkHashRow = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
          'sourceNamespace', ${namespace}, 'sourceCategoryId', ${sourceCategoryId}, 'revision', 1,
          'canonicalCategoryKey', ${categoryKey}
        )::text, 'UTF8'), 'sha256'), 'hex') AS value`;
      const crosswalkHash = crosswalkHashRow[0].value;

      const sourcePayloadTextRow = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT jsonb_build_object('text',${sourcePrompt},'answer',${sourceAnswer},'points',200,'hint',${sourceHint})::text AS value`;
      const sourcePayloadText = sourcePayloadTextRow[0].value;
      sourceContentHash = sha256(sourcePayloadText);
      const sourceSnapshotMember = {
        sourceId: sourceQuestionId, artifactSha256: sourceRootHash, categoryName: sourceCategoryName,
        arrayIndexOneBased: 1, sourceCategoryId, categoryKey,
        sourcePayload: { text: sourcePrompt, answer: sourceAnswer, points: 200, hint: sourceHint }, sourceContentHash,
      };
      const snapshotTextRow = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT jsonb_build_object('version','enta-source-snapshot-v1','sourceNamespace',${namespace},
          'sourceReleaseId',${sourceReleaseId},'sourceRootSha256',${sourceRootHash},
          'parserVersion',${ENTA_SOURCE_PARSER_VERSION},'members',${JSON.stringify([sourceSnapshotMember])}::jsonb)::text AS value`;
      snapshotHash = sha256(snapshotTextRow[0].value);

      const categoryContentHashRow = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
          'canonicalizationVersion', 1,
          'category', jsonb_build_object(
            'id', ${categoryRevisionId}, 'sourceNamespace', 'canonical.category',
            'categoryKey', ${categoryKey}, 'revision', 1,
            'labelAr', 'فئة اختبار', 'description', 'وصف اختباري', 'cover', NULL
          )
        )::text, 'UTF8'), 'sha256'), 'hex') AS value`;
      const categoryContentHash = categoryContentHashRow[0].value;

      const questionContentHashRow = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
          'canonicalizationVersion', 1,
          'question', jsonb_build_object(
            'id', ${questionId}, 'sourceNamespace', ${namespace}, 'sourceQuestionId', ${sourceQuestionId},
            'revision', 1, 'sourceContentHash', ${sourceContentHash},
            'sourceCategoryId', ${sourceCategoryId}, 'crosswalkRevisionId', ${crosswalkId},
            'crosswalkRevision', 1, 'canonicalCategoryKey', ${categoryKey}, 'prompt', ${sourcePrompt},
            'points', 200, 'hints', to_jsonb(ARRAY[${sourceHint}]::TEXT[]), 'modality', 'classic', 'engine', 'ENTA',
            'mode', 'CLASSIC', 'tier', '200', 'crosswalkHash', ${crosswalkHash}
          ),
          'answers', jsonb_build_array(jsonb_build_object(
            'id', ${answerId}, 'sortOrder', 0, 'text', ${sourceAnswer}, 'points', 200,
            'isCorrect', true, 'isTrap', false, 'contentHash', ${answerContentHash}
          )),
          'media', '[]'::jsonb
        )::text, 'UTF8'), 'sha256'), 'hex') AS value`;
      const questionContentHash = questionContentHashRow[0].value;

      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${categoryEditorialId},'canonical.category',${categoryKey},1,${categoryContentHash},'APPROVED','int4-synthetic-reviewer',${categoryEditorialEvidenceHash})`;
      await tx.$executeRaw`INSERT INTO "CanonicalCategoryRevision"
        ("id","sourceNamespace","categoryKey","revision","labelAr","description","contentHash","editorialReceiptId","editorialDecision")
        VALUES (${categoryRevisionId},'canonical.category',${categoryKey},1,'فئة اختبار','وصف اختباري',${categoryContentHash},${categoryEditorialId},'APPROVED')`;
      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${questionEditorialId},${namespace},${sourceQuestionId},1,${questionContentHash},'APPROVED','int4-synthetic-reviewer',${questionEditorialEvidenceHash})`;
      await tx.$executeRaw`INSERT INTO "ContentRightsReceipt"
        ("id","sourceNamespace","subjectType","sourceKey","subjectHash","decision","rightsHolderRef","licenseRef","evidenceHash")
        VALUES (${questionRightsId},${namespace},'QUESTION',${sourceQuestionId},${questionContentHash},'CLEARED','int4-synthetic-holder','int4-synthetic-license',${questionRightsEvidenceHash})`;

      await withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "CatalogRelease" ("id","releaseRootHash","manifestVersion") VALUES (${releaseId},${releasePlaceholderHash},1)`;
        await tx.$executeRaw`INSERT INTO "CatalogReleaseSourceSnapshot"
          ("id","catalogReleaseId","sourceNamespace","sourceReleaseId","sourceRootSha256","snapshotHash")
          VALUES (${sourceSnapshotId},${releaseId},${namespace},${sourceReleaseId},${sourceRootHash},${snapshotHash})`;
        await tx.$executeRaw`INSERT INTO "CatalogReleaseCategory"
          ("id","catalogReleaseId","categoryKey","categoryRevisionId","categoryContentHash")
          VALUES (${id("release_category")},${releaseId},${categoryKey},${categoryRevisionId},${categoryContentHash})`;
        await tx.$executeRaw`INSERT INTO "SourceCategoryCrosswalkRevision"
          ("id","sourceNamespace","sourceCategoryId","revision","canonicalCategoryKey","mappingHash")
          VALUES (${crosswalkId},${namespace},${sourceCategoryId},1,${categoryKey},${crosswalkHash})`;
        await tx.$executeRaw`INSERT INTO "QuestionRevision"
          ("id","sourceNamespace","sourceQuestionId","revision","sourceContentHash","contentHash","sourceCategoryId","crosswalkRevisionId","crosswalkRevision","canonicalCategoryKey","prompt","points","hints","modality","engine","mode","tier","editorialReceiptId","editorialDecision","rightsReceiptId","rightsSubjectType","rightsDecision")
          VALUES (${questionId},${namespace},${sourceQuestionId},1,${sourceContentHash},${questionContentHash},${sourceCategoryId},${crosswalkId},1,${categoryKey},${sourcePrompt},200,ARRAY[${sourceHint}]::TEXT[],'classic','ENTA','CLASSIC','200',${questionEditorialId},'APPROVED',${questionRightsId},'QUESTION','CLEARED')`;
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${answerId},${questionId},${questionContentHash},0,${sourceAnswer},200,true,false,${answerContentHash})`;
      });

      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`,
        /permission denied|42501|P2010/i,
        "catalog_assembler",
      );
      await withSessionAuthorization(tx, "catalog_publisher", async () => {
        await tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`;
      });
      await expectDatabaseFailure(
        tx,
        () => tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${id("late_answer")},${questionId},${questionContentHash},99,'Late child',0,false,false,${hash("3")})`,
        /question revision is sealed|P2010|55000/i,
        "catalog_assembler",
      );
      await withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "CatalogReleaseQuestion"
          ("id","catalogReleaseId","sourceNamespace","sourceSnapshotHash","questionRevisionId","questionContentHash","categoryKey")
          VALUES (${id("membership")},${releaseId},${namespace},${snapshotHash},${questionId},${questionContentHash},${categoryKey})`;
      });

      await withSessionAuthorization(tx, "catalog_publisher", async () => {
        await tx.$queryRaw`SELECT public.seal_catalog_release(${releaseId})`;
      });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      const release = await tx.$queryRaw<Array<{ releaseRootHash: string; sealHash: string }>>`
        SELECT r."releaseRootHash", s."sealHash" FROM "CatalogRelease" r
        JOIN "CatalogReleaseSeal" s ON s."catalogReleaseId"=r."id" AND s."releaseRootHash"=r."releaseRootHash"
        WHERE r."id"=${releaseId}`;
      releaseRootHash = release[0].releaseRootHash;
      const sourceManifestHashExpected = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT encode(int4_crypto.digest(convert_to(COALESCE((
          SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
          FROM "CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=${releaseId}
        ),'[]'),'UTF8'),'sha256'),'hex') AS value`;
      sourceEvidenceManifestHash = sourceManifestHashExpected[0].value;
      const canonicalProbe = await withSessionAuthorization(tx, "catalog_validator", async () => tx.$queryRaw<Array<{ text: string; digest: string }>>`
        SELECT jsonb_build_object('arabic','العربية','nullable',NULL,'escaped','quote " slash \\ newline\nsecond line')::text AS text,
          encode(int4_crypto.digest(convert_to(jsonb_build_object('arabic','العربية','nullable',NULL,'escaped','quote " slash \\ newline\nsecond line')::text,'UTF8'),'sha256'),'hex') AS digest`);
      assert.equal(sha256(canonicalProbe[0].text), canonicalProbe[0].digest);
      assert.match(canonicalProbe[0].text, /"nullable": null/);
      assert.match(canonicalProbe[0].text, /العربية/);
      assert.match(canonicalProbe[0].text, /\\n/);

      const sourceManifest = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT encode(int4_crypto.digest(convert_to(COALESCE((
          SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
          FROM "CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=${releaseId}
        ),'[]'),'UTF8'),'sha256'),'hex') AS value`;
      assert.equal(sourceManifest[0].value, sourceManifestHashExpected[0].value, "reader source summary must match receipt issuer expression");
      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.issue_catalog_validation_receipt(${releaseId},${release[0].releaseRootHash},${release[0].sealHash},'int4-test-policy-v1',${sourceManifest[0].value},${ENTA_CLASSIC_SELECTOR_VERSION})`,
        /trusted catalog validator role required|permission denied|42501|P2010/i,
        "catalog_assembler",
      );
      const receipt = await withSessionAuthorization(tx, "catalog_validator", async () => tx.$queryRaw<Array<{ id: string }>>`
        SELECT public.issue_catalog_validation_receipt(${releaseId},${release[0].releaseRootHash},${release[0].sealHash},'int4-test-policy-v1',${sourceManifest[0].value},${ENTA_CLASSIC_SELECTOR_VERSION}) AS id`);

      await withSessionAuthorization(tx, "catalog_validator", async () => {
        const proof = await tx.$queryRaw<Array<{ question: unknown; answers: string; category: unknown; release: unknown; readableRows: number }>>`
          SELECT public.int4_question_payload(${questionId}) AS question,
            public.int4_question_child_manifest(${questionId},'answer') AS answers,
            public.int4_category_payload(${categoryRevisionId}) AS category,
            public.int4_release_payload(${releaseId}) AS release,
            (SELECT count(*)::int FROM public."SourceCategoryCrosswalkRevision") +
            (SELECT count(*)::int FROM public."CanonicalCategoryRevision") +
            (SELECT count(*)::int FROM public."EditorialReviewReceipt") +
            (SELECT count(*)::int FROM public."ContentRightsReceipt") +
            (SELECT count(*)::int FROM public."QuestionRevision") +
            (SELECT count(*)::int FROM public."QuestionAnswerRevision") +
            (SELECT count(*)::int FROM public."MediaRevision") +
            (SELECT count(*)::int FROM public."QuestionRevisionMedia") +
            (SELECT count(*)::int FROM public."QuestionRevisionSeal") +
            (SELECT count(*)::int FROM public."CatalogRelease") +
            (SELECT count(*)::int FROM public."CatalogReleaseSourceSnapshot") +
            (SELECT count(*)::int FROM public."CatalogReleaseCategory") +
            (SELECT count(*)::int FROM public."CatalogReleaseQuestion") +
            (SELECT count(*)::int FROM public."CatalogReleaseAvailability") +
            (SELECT count(*)::int FROM public."CatalogReleaseSeal") +
            (SELECT count(*)::int FROM public."CatalogValidationReceipt") AS "readableRows"`;
        assert.ok(proof[0].question);
        assert.equal(typeof proof[0].answers, "string");
        assert.ok(proof[0].category);
        assert.ok(proof[0].release);
        assert.ok(proof[0].readableRows >= 1);
      });
      await expectDatabaseFailure(
        tx,
        () => tx.$executeRaw`UPDATE public."QuestionRevision" SET "prompt"='tampered' WHERE "id"=${questionId}`,
        /permission denied|42501|P2010/i,
        "catalog_validator",
      );
      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`,
        /permission denied|42501|P2010/i,
        "catalog_validator",
      );
      for (const role of ["enta_runtime", "catalog_assembler"]) {
        await expectDatabaseFailure(
          tx,
          () => tx.$queryRaw`SELECT public.int4_question_payload(${questionId})`,
          /permission denied|42501|P2010/i,
          role,
        );
      }
      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.issue_catalog_validation_receipt(${releaseId},${release[0].releaseRootHash},${release[0].sealHash},'int4-test-policy-v1',${sourceManifest[0].value},${ENTA_CLASSIC_SELECTOR_VERSION})`,
        /permission denied|42501|P2010/i,
        "enta_runtime",
      );

      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.activate_catalog_release(NULL,${receipt[0].id})`,
        /permission denied|42501|P2010/i,
        "catalog_validator",
      );
      await expectDatabaseFailure(
        tx,
        () => tx.$queryRaw`SELECT public.activate_catalog_release(NULL,${id("forged_unvalidated_receipt")})`,
        /valid immutable receipt|P2010|activation requires/i,
        "catalog_activator",
      );
      await withSessionAuthorization(tx, "catalog_activator", async () => {
        const activation = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release(NULL,${receipt[0].id})`;
        assert.equal(activation[0].activate_catalog_release, true);
        const staleCas = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release('stale-receipt',${receipt[0].id})`;
        assert.equal(staleCas[0].activate_catalog_release, false);
      });

      await tx.$executeRaw`INSERT INTO "User" ("id","name") VALUES (${validHostUserId},${id("valid_new_game_name")})`;
      await expectDatabaseFailure(
        tx,
        () => tx.$executeRaw`INSERT INTO "Game" ("id","userId","catalogReleaseId") VALUES (${id("new_game")},${validHostUserId},NULL)`,
        /new games require the active validated catalog release pin/i,
      );

    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const evidence = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const posture = await tx.$queryRaw<Array<{ isolation: string; readOnly: boolean }>>`
        SELECT current_setting('transaction_isolation') AS isolation,
          current_setting('transaction_read_only')='on' AS "readOnly"`;
      assert.equal(posture[0].isolation, "repeatable read");
      assert.equal(posture[0].readOnly, true);
      return withSessionAuthorization(tx, "catalog_validator", () => readEntaPostgresReleaseEvidence(tx, {
        catalogReleaseId: releaseId, expectedReleaseRootHash: releaseRootHash, expectedSourceRootSha256: sourceRootHash, rawArtifactBytes,
      }));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    assert.equal(evidence.status, "partial", evidence.status === "partial" ? undefined : evidence.reasonCode);
    if (evidence.status === "partial") {
      assert.equal(evidence.sourceSnapshotHash, snapshotHash);
      assert.equal(evidence.sourceEvidenceManifestHash, sourceEvidenceManifestHash);
      assert.ok(evidence.reasonCodes.includes("DATABASE_AVAILABILITY_TIER_SET_INCOMPLETE"));
      assert.ok(evidence.reasonCodes.includes("SELECTOR_REPLAY_PENDING"));
      assert.ok(evidence.reasonCodes.includes("INDEPENDENT_EDITORIAL_PROVENANCE_PENDING"));
      assert.ok(evidence.reasonCodes.includes("ISSUER_POLICY_PENDING"));
      assert.deepEqual(evidence.declaredAvailability, [], "availability comes from the sealed database release, never caller input");
      assert.deepEqual(evidence.revisions.map((revision) => ({ id: revision.questionRevisionId, points: revision.sourcePoints, tier: revision.tier })), [
        { id: questionId, points: 200, tier: "200" },
      ]);
      const collisionClaims = evidence.receiptClaims.filter((claim) => claim.receiptId === questionEditorialId);
      assert.deepEqual(collisionClaims.map((claim) => claim.evidenceType).sort(), ["EDITORIAL", "RIGHTS"]);
      const binding: EntaEvidenceReleaseBinding = {
        catalogReleaseId: evidence.catalogReleaseId, releaseRootHash: evidence.releaseRootHash,
        sourceNamespace: "enta.question", sourceReleaseId: evidence.sourceReleaseId,
        sourceRootSha256: evidence.sourceRootSha256, snapshotHash: evidence.sourceSnapshotHash,
        selectorVersion: evidence.selectorVersion, selectorBuildId: evidence.selectorBuildId,
      };
      const verifiedManifest = await verifySyntheticReceiptManifest(evidence.receiptClaims, binding);
      assert.equal(verifiedManifest.status, "verified");
      if (verifiedManifest.status === "verified") assert.match(verifiedManifest.manifestSha256, /^[a-f0-9]{64}$/);
      const missingRightsDecision = await verifySyntheticReceiptManifest(evidence.receiptClaims, binding, "RIGHTS");
      assert.deepEqual(missingRightsDecision, { status: "rejected", reasonCode: "INDEPENDENT_EVIDENCE_RECEIPT_SET_MISMATCH" });
    }
    for (const role of ["enta_runtime", "catalog_assembler"]) {
      const deniedRead = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return withSessionAuthorization(tx, role, () => readEntaPostgresReleaseEvidence(tx, {
          catalogReleaseId: releaseId, expectedReleaseRootHash: releaseRootHash, expectedSourceRootSha256: sourceRootHash, rawArtifactBytes,
        }));
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      assert.equal(deniedRead.status, "unavailable");
      if (deniedRead.status === "unavailable") assert.equal(deniedRead.reasonCode, "DATABASE_READER_ROLE_INVALID");
    }
  } catch (error) {
    primaryFailure = error;
  } finally {
    let cleanupFailure: unknown;
    if (safeIsolatedDatabase) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
          await tx.$executeRaw`DELETE FROM "ActiveCatalogPointer" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogActivationEvent" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogValidationReceipt" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseSeal" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseQuestion" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseCategory" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogRelease" WHERE "id"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "QuestionRevisionSeal" WHERE "questionRevisionId"=${questionId}`;
          await tx.$executeRaw`DELETE FROM "QuestionAnswerRevision" WHERE "questionRevisionId"=${questionId}`;
          await tx.$executeRaw`DELETE FROM "QuestionRevision" WHERE "id"=${questionId}`;
          await tx.$executeRaw`DELETE FROM "CanonicalCategoryRevision" WHERE "id"=${categoryRevisionId}`;
          await tx.$executeRaw`DELETE FROM "EditorialReviewReceipt" WHERE "id" IN (${Prisma.join([categoryEditorialId, questionEditorialId])})`;
          await tx.$executeRaw`DELETE FROM "ContentRightsReceipt" WHERE "id"=${questionRightsId}`;
          await tx.$executeRaw`DELETE FROM "SourceCategoryCrosswalkRevision" WHERE "id"=${crosswalkId}`;
          await tx.$executeRaw`DELETE FROM "User" WHERE "id"=${validHostUserId}`;
        });
      } catch (cleanupError) {
        cleanupFailure = cleanupError;
      }
    }
    try {
      await prisma.$disconnect();
    } catch (disconnectError) {
      cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, disconnectError], "Synthetic fixture cleanup/disconnect failed") : disconnectError;
    }
    if (primaryFailure && cleanupFailure) throw new AggregateError([primaryFailure, cleanupFailure], "Catalog reader assertion failed and exact-ID cleanup also failed");
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
  }
});

test("a concurrent answer insert and seal serialize on the revision row", { skip: !safeIsolatedDatabase }, async () => {
  const setup = new PrismaClient({ datasourceUrl: databaseUrl! });
  const writer = new PrismaClient({ datasourceUrl: databaseUrl! });
  const publisher = new PrismaClient({ datasourceUrl: databaseUrl! });
  const token = randomUUID().replaceAll("-", "");
  const id = (prefix: string) => `${prefix}_${token}`;
  const hash = (suffix: string) => suffix.repeat(64).slice(0, 64);
  const namespace = "enta.question";
  const sourceQuestionId = id("race_source_question");
  const categoryKey = `int4-race-${token.slice(0, 12)}`;
  const crosswalkId = id("race_crosswalk");
  const questionId = id("race_question");
  const firstAnswerId = id("race_answer_first");
  const lateAnswerId = id("race_answer_late");
  const firstAnswerHash = hash("a");
  const lateAnswerHash = hash("b");
  const questionEditorialId = id("race_editorial");
  const questionRightsId = id("race_rights");
  let childTransactionStarted = false;
  let releaseWriter: (() => void) | undefined;
  let primaryFailure: unknown;
  let activeTasks: Promise<unknown>[] = [];

  try {
    const crosswalkHashRow = await setup.$queryRaw<Array<{ value: string }>>`
      SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
        'sourceNamespace', ${namespace}, 'sourceCategoryId', ${categoryKey}, 'revision', 1,
        'canonicalCategoryKey', ${categoryKey}
      )::text,'UTF8'),'sha256'),'hex') AS value`;
    const crosswalkHash = crosswalkHashRow[0].value;
    const plannedAnswerRows = await setup.$queryRaw<Array<{ answers: unknown }>>`
      SELECT jsonb_build_array(
        jsonb_build_object('id',${firstAnswerId},'sortOrder',0,'text','First synthetic answer','points',200,'isCorrect',true,'isTrap',false,'contentHash',${firstAnswerHash}),
        jsonb_build_object('id',${lateAnswerId},'sortOrder',1,'text','Concurrent synthetic answer','points',100,'isCorrect',false,'isTrap',false,'contentHash',${lateAnswerHash})
      ) AS answers`;
    const sourceContentHash = hash("c");
    const questionContentHashRow = await setup.$queryRaw<Array<{ value: string }>>`
      SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
        'canonicalizationVersion',1,
        'question',jsonb_build_object(
          'id',${questionId},'sourceNamespace',${namespace},'sourceQuestionId',${sourceQuestionId},
          'revision',1,'sourceContentHash',${sourceContentHash},'sourceCategoryId',${categoryKey},
          'crosswalkRevisionId',${crosswalkId},'crosswalkRevision',1,'canonicalCategoryKey',${categoryKey},
          'prompt','Private concurrent synthetic prompt','points',200,'hints',to_jsonb(ARRAY[]::TEXT[]),
          'modality','TEXT','engine','ENTA','mode','CLASSIC','tier','200','crosswalkHash',${crosswalkHash}
        ),
        'answers',${JSON.stringify(plannedAnswerRows[0].answers)}::jsonb,
        'media','[]'::jsonb
      )::text,'UTF8'),'sha256'),'hex') AS value`;
    const questionContentHash = questionContentHashRow[0].value;

    await setup.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${questionEditorialId},${namespace},${sourceQuestionId},1,${questionContentHash},'APPROVED','int4-race-synthetic-reviewer',${hash("d")})`;
      await tx.$executeRaw`INSERT INTO "ContentRightsReceipt"
        ("id","sourceNamespace","subjectType","sourceKey","subjectHash","decision","rightsHolderRef","licenseRef","evidenceHash")
        VALUES (${questionRightsId},${namespace},'QUESTION',${sourceQuestionId},${questionContentHash},'CLEARED','int4-race-synthetic-holder','int4-race-synthetic-license',${hash("e")})`;
      await withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "SourceCategoryCrosswalkRevision"
          ("id","sourceNamespace","sourceCategoryId","revision","canonicalCategoryKey","mappingHash")
          VALUES (${crosswalkId},${namespace},${categoryKey},1,${categoryKey},${crosswalkHash})`;
        await tx.$executeRaw`INSERT INTO "QuestionRevision"
          ("id","sourceNamespace","sourceQuestionId","revision","sourceContentHash","contentHash","sourceCategoryId","crosswalkRevisionId","crosswalkRevision","canonicalCategoryKey","prompt","points","hints","modality","engine","mode","tier","editorialReceiptId","editorialDecision","rightsReceiptId","rightsSubjectType","rightsDecision")
          VALUES (${questionId},${namespace},${sourceQuestionId},1,${sourceContentHash},${questionContentHash},${categoryKey},${crosswalkId},1,${categoryKey},'Private concurrent synthetic prompt',200,ARRAY[]::TEXT[],'TEXT','ENTA','CLASSIC','200',${questionEditorialId},'APPROVED',${questionRightsId},'QUESTION','CLEARED')`;
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${firstAnswerId},${questionId},${questionContentHash},0,'First synthetic answer',200,true,false,${firstAnswerHash})`;
      });
    });

    let signalWriterInsertSettled!: (error?: unknown) => void;
    const writerInsertSettled = new Promise<unknown | undefined>((resolve) => {
      signalWriterInsertSettled = resolve;
    });
    const writerMayCommit = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let signalPublisherPid!: (pid: number) => void;
    const publisherPidReady = new Promise<number>((resolve) => { signalPublisherPid = resolve; });

    childTransactionStarted = true;
    const childInsert = writer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_assembler");
      try {
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${lateAnswerId},${questionId},${questionContentHash},1,'Concurrent synthetic answer',100,false,false,${lateAnswerHash})`;
        signalWriterInsertSettled();
        await writerMayCommit;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    }).catch((error: unknown) => {
      signalWriterInsertSettled(error);
      throw error;
    });
    const writerInsertError = await writerInsertSettled;
    if (writerInsertError) throw writerInsertError;

    const seal = publisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_publisher");
      try {
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        signalPublisherPid(pid[0].pid);
        await tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    activeTasks = [childInsert, seal];
    const publisherPid = await publisherPidReady;
    const waitUntil = Date.now() + 5000;
    let observedLockWait = false;
    while (Date.now() < waitUntil) {
      const activity = await setup.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid=${publisherPid}`;
      if (activity[0]?.wait_event_type === "Lock") {
        observedLockWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseWriter?.();
    await Promise.all([childInsert, seal]);
    childTransactionStarted = false;
    assert.equal(observedLockWait, true, "publisher should wait for the answer insert's parent-row lock");

    const state = await setup.$queryRaw<Array<{ sealedAt: Date | null; answerCount: bigint }>>`
      SELECT q."sealedAt", count(a."id") AS "answerCount"
      FROM "QuestionRevision" q JOIN "QuestionAnswerRevision" a ON a."questionRevisionId"=q."id"
      WHERE q."id"=${questionId} GROUP BY q."id"`;
    assert.ok(state[0].sealedAt);
    assert.equal(state[0].answerCount, 2n);
  } catch (error) {
    primaryFailure = error;
  } finally {
    // This target is hard-gated to loopback *_int4_test. Exact-ID cleanup uses
    // replica mode only to remove the synthetic rows protected by append-only
    // guards; it does not alter or disable constraints for any other records.
    if (childTransactionStarted) releaseWriter?.();
    await Promise.allSettled(activeTasks);
    let cleanupFailure: unknown;
    try {
      await setup.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`DELETE FROM "QuestionAnswerRevision" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionRevisionSeal" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionRevision" WHERE "id"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "EditorialReviewReceipt" WHERE "id"=${questionEditorialId}`;
        await tx.$executeRaw`DELETE FROM "ContentRightsReceipt" WHERE "id"=${questionRightsId}`;
        await tx.$executeRaw`DELETE FROM "SourceCategoryCrosswalkRevision" WHERE "id"=${crosswalkId}`;
      });
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await Promise.all([setup.$disconnect(), writer.$disconnect(), publisher.$disconnect()]);
    } catch (error) {
      cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error], "Database cleanup and disconnect failed") : error;
    }
    if (primaryFailure && cleanupFailure) {
      throw new AggregateError([primaryFailure, cleanupFailure], "Race assertion failed and exact-ID cleanup also failed");
    }
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
  }
});

test("a seal that locks first rejects a concurrent late answer insert", { skip: !safeIsolatedDatabase }, async () => {
  const setup = new PrismaClient({ datasourceUrl: databaseUrl! });
  const publisher = new PrismaClient({ datasourceUrl: databaseUrl! });
  const writer = new PrismaClient({ datasourceUrl: databaseUrl! });
  const token = randomUUID().replaceAll("-", "");
  const id = (prefix: string) => `${prefix}_${token}`;
  const hash = (suffix: string) => suffix.repeat(64).slice(0, 64);
  const namespace = "enta.question";
  const sourceQuestionId = id("seal_first_source_question");
  const categoryKey = `int4-seal-first-${token.slice(0, 12)}`;
  const crosswalkId = id("seal_first_crosswalk");
  const questionId = id("seal_first_question");
  const answerId = id("seal_first_answer");
  const lateAnswerId = id("seal_first_late_answer");
  const answerHash = hash("a");
  const questionEditorialId = id("seal_first_editorial");
  const questionRightsId = id("seal_first_rights");
  const sourceContentHash = hash("b");
  const crosswalkHashRow = await setup.$queryRaw<Array<{ value: string }>>`
    SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
      'sourceNamespace', ${namespace}, 'sourceCategoryId', ${categoryKey}, 'revision', 1,
      'canonicalCategoryKey', ${categoryKey}
    )::text,'UTF8'),'sha256'),'hex') AS value`;
  const crosswalkHash = crosswalkHashRow[0].value;
  const questionContentHashRow = await setup.$queryRaw<Array<{ value: string }>>`
    SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
      'canonicalizationVersion',1,
      'question',jsonb_build_object(
        'id',${questionId},'sourceNamespace',${namespace},'sourceQuestionId',${sourceQuestionId},
        'revision',1,'sourceContentHash',${sourceContentHash},'sourceCategoryId',${categoryKey},
        'crosswalkRevisionId',${crosswalkId},'crosswalkRevision',1,'canonicalCategoryKey',${categoryKey},
        'prompt','Private seal-first synthetic prompt','points',200,'hints',to_jsonb(ARRAY[]::TEXT[]),
        'modality','TEXT','engine','ENTA','mode','CLASSIC','tier','200','crosswalkHash',${crosswalkHash}
      ),
      'answers',jsonb_build_array(jsonb_build_object(
        'id',${answerId},'sortOrder',0,'text','First synthetic answer','points',200,
        'isCorrect',true,'isTrap',false,'contentHash',${answerHash}
      )),
      'media','[]'::jsonb
    )::text,'UTF8'),'sha256'),'hex') AS value`;
  const questionContentHash = questionContentHashRow[0].value;
  let releasePublisher: (() => void) | undefined;
  let signalSealFinished!: () => void;
  let signalWriterStarted!: (pid: number) => void;
  const sealFinished = new Promise<void>((resolve) => { signalSealFinished = resolve; });
  const writerStarted = new Promise<number>((resolve) => { signalWriterStarted = resolve; });
  const publisherMayCommit = new Promise<void>((resolve) => { releasePublisher = resolve; });
  let sealTask: Promise<unknown> | undefined;
  let insertTask: Promise<unknown> | undefined;
  let primaryFailure: unknown;

  try {
    await setup.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${questionEditorialId},${namespace},${sourceQuestionId},1,${questionContentHash},'APPROVED','int4-seal-first-reviewer',${hash("c")})`;
      await tx.$executeRaw`INSERT INTO "ContentRightsReceipt"
        ("id","sourceNamespace","subjectType","sourceKey","subjectHash","decision","rightsHolderRef","licenseRef","evidenceHash")
        VALUES (${questionRightsId},${namespace},'QUESTION',${sourceQuestionId},${questionContentHash},'CLEARED','int4-seal-first-holder','int4-seal-first-license',${hash("d")})`;
      await withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "SourceCategoryCrosswalkRevision"
          ("id","sourceNamespace","sourceCategoryId","revision","canonicalCategoryKey","mappingHash")
          VALUES (${crosswalkId},${namespace},${categoryKey},1,${categoryKey},${crosswalkHash})`;
        await tx.$executeRaw`INSERT INTO "QuestionRevision"
          ("id","sourceNamespace","sourceQuestionId","revision","sourceContentHash","contentHash","sourceCategoryId","crosswalkRevisionId","crosswalkRevision","canonicalCategoryKey","prompt","points","hints","modality","engine","mode","tier","editorialReceiptId","editorialDecision","rightsReceiptId","rightsSubjectType","rightsDecision")
          VALUES (${questionId},${namespace},${sourceQuestionId},1,${sourceContentHash},${questionContentHash},${categoryKey},${crosswalkId},1,${categoryKey},'Private seal-first synthetic prompt',200,ARRAY[]::TEXT[],'TEXT','ENTA','CLASSIC','200',${questionEditorialId},'APPROVED',${questionRightsId},'QUESTION','CLEARED')`;
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${answerId},${questionId},${questionContentHash},0,'First synthetic answer',200,true,false,${answerHash})`;
      });
    });

    sealTask = publisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_publisher");
      try {
        await tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`;
        signalSealFinished();
        await publisherMayCommit;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    await sealFinished;

    insertTask = writer.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_assembler");
      await tx.$executeRawUnsafe("SAVEPOINT int4_late_answer_insert");
      const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      signalWriterStarted(pid[0].pid);
      let insertionError: unknown;
      try {
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${lateAnswerId},${questionId},${questionContentHash},1,'Late synthetic answer',100,false,false,${hash("e")})`;
      } catch (error) {
        insertionError = error;
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT int4_late_answer_insert");
      }
      await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      return insertionError instanceof Error ? insertionError.message : String(insertionError ?? "insert unexpectedly succeeded");
    });

    const writerPid = await writerStarted;
    const waitUntil = Date.now() + 5000;
    let observedLockWait = false;
    while (Date.now() < waitUntil) {
      const activity = await setup.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid=${writerPid}`;
      if (activity[0]?.wait_event_type === "Lock") {
        observedLockWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releasePublisher?.();
    const [, insertionMessage] = await Promise.all([sealTask, insertTask]);
    assert.equal(observedLockWait, true, "late answer insert should wait for the seal transaction's parent-row lock");
    assert.match(String(insertionMessage), /question revision is sealed/i);
    const state = await setup.$queryRaw<Array<{ sealedAt: Date | null; answerCount: bigint }>>`
      SELECT q."sealedAt", count(a."id") AS "answerCount"
      FROM "QuestionRevision" q JOIN "QuestionAnswerRevision" a ON a."questionRevisionId"=q."id"
      WHERE q."id"=${questionId} GROUP BY q."id"`;
    assert.ok(state[0].sealedAt);
    assert.equal(state[0].answerCount, 1n);
  } catch (error) {
    primaryFailure = error;
  } finally {
    releasePublisher?.();
    await Promise.allSettled([sealTask, insertTask].filter((task): task is Promise<unknown> => Boolean(task)));
    let cleanupFailure: unknown;
    try {
      await setup.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`DELETE FROM "QuestionAnswerRevision" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionRevisionSeal" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionRevision" WHERE "id"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "EditorialReviewReceipt" WHERE "id"=${questionEditorialId}`;
        await tx.$executeRaw`DELETE FROM "ContentRightsReceipt" WHERE "id"=${questionRightsId}`;
        await tx.$executeRaw`DELETE FROM "SourceCategoryCrosswalkRevision" WHERE "id"=${crosswalkId}`;
      });
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await Promise.all([setup.$disconnect(), publisher.$disconnect(), writer.$disconnect()]);
    } catch (error) {
      cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error], "Database cleanup and disconnect failed") : error;
    }
    if (primaryFailure && cleanupFailure) {
      throw new AggregateError([primaryFailure, cleanupFailure], "Seal-first assertion failed and exact-ID cleanup also failed");
    }
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
  }
});

test("concurrent first activations return one CAS winner and one miss", { skip: !safeIsolatedDatabase }, async () => {
  const setup = new PrismaClient({ datasourceUrl: databaseUrl! });
  const firstPublisher = new PrismaClient({ datasourceUrl: databaseUrl! });
  const secondPublisher = new PrismaClient({ datasourceUrl: databaseUrl! });
  const token = randomUUID().replaceAll("-", "");
  const id = (prefix: string) => `${prefix}_${token}`;
  const hash = (suffix: string) => suffix.repeat(64).slice(0, 64);
  const namespace = "enta.question";
  const sourceQuestionId = id("activation_race_source_question");
  const categoryKey = `int4-activation-${token.slice(0, 12)}`;
  const categoryRevisionId = id("activation_category_revision");
  const categoryEditorialId = id("activation_category_editorial");
  const crosswalkId = id("activation_crosswalk");
  const questionId = id("activation_question");
  const answerId = id("activation_answer");
  const questionEditorialId = id("activation_question_editorial");
  const questionRightsId = id("activation_question_rights");
  const sourceContentHash = hash("a");
  const answerContentHash = hash("b");
  const snapshotHash = hash("c");
  const sourceRootHash = hash("d");
  const releaseIds = [id("activation_release_a"), id("activation_release_b")];
  const snapshotIds = [id("activation_snapshot_a"), id("activation_snapshot_b")];
  const sourceReleaseIds = [id("activation_source_a"), id("activation_source_b")];
  const releaseChildRaceIds = [id("release_child_insert_wins"), id("release_seal_wins")];
  const releaseChildRaceSnapshotIds = [id("release_child_baseline_a"), id("release_child_baseline_b")];
  const releaseChildRaceSourceIds = [id("release_child_source_a"), id("release_child_source_b")];
  const allReleaseIds = [...releaseIds, ...releaseChildRaceIds];
  const legacyCategoryId = id("legacy_game_category");
  const legacyQuestionId = id("legacy_game_question");
  const testUserId = id("pinned_game_user");
  const testGameId = id("pinned_game");
  const testGameQuestionId = id("pinned_game_question");
  const activationReceipts: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let signalFirstActivated!: (receipt: string) => void;
  let signalSecondPid!: (pid: number) => void;
  const firstActivated = new Promise<string>((resolve) => { signalFirstActivated = resolve; });
  const firstMayCommit = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondPidReady = new Promise<number>((resolve) => { signalSecondPid = resolve; });
  let firstTask: Promise<boolean> | undefined;
  let secondTask: Promise<boolean> | undefined;
  let releaseRollbackWinner: (() => void) | undefined;
  let rollbackFirstTask: Promise<never> | undefined;
  let rollbackSecondTask: Promise<boolean> | undefined;
  let primaryFailure: unknown;

  try {
    const crosswalkHashRow = await setup.$queryRaw<Array<{ value: string }>>`
      SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
        'sourceNamespace',${namespace},'sourceCategoryId',${categoryKey},'revision',1,
        'canonicalCategoryKey',${categoryKey}
      )::text,'UTF8'),'sha256'),'hex') AS value`;
    const crosswalkHash = crosswalkHashRow[0].value;
    const categoryContentHashRow = await setup.$queryRaw<Array<{ value: string }>>`
      SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
        'canonicalizationVersion',1,'category',jsonb_build_object(
          'id',${categoryRevisionId},'sourceNamespace','canonical.category','categoryKey',${categoryKey},
          'revision',1,'labelAr','فئة سباق اختبار','description','بيانات تركيبية','cover',NULL
        )
      )::text,'UTF8'),'sha256'),'hex') AS value`;
    const categoryContentHash = categoryContentHashRow[0].value;
    const questionContentHashRow = await setup.$queryRaw<Array<{ value: string }>>`
      SELECT encode(int4_crypto.digest(convert_to(jsonb_build_object(
        'canonicalizationVersion',1,
        'question',jsonb_build_object(
          'id',${questionId},'sourceNamespace',${namespace},'sourceQuestionId',${sourceQuestionId},
          'revision',1,'sourceContentHash',${sourceContentHash},'sourceCategoryId',${categoryKey},
          'crosswalkRevisionId',${crosswalkId},'crosswalkRevision',1,'canonicalCategoryKey',${categoryKey},
          'prompt','Private synthetic activation race prompt','points',200,'hints',to_jsonb(ARRAY[]::TEXT[]),
          'modality','TEXT','engine','ENTA','mode','CLASSIC','tier','200','crosswalkHash',${crosswalkHash}
        ),
        'answers',jsonb_build_array(jsonb_build_object(
          'id',${answerId},'sortOrder',0,'text','Synthetic answer','points',200,
          'isCorrect',true,'isTrap',false,'contentHash',${answerContentHash}
        )),
        'media','[]'::jsonb
      )::text,'UTF8'),'sha256'),'hex') AS value`;
    const questionContentHash = questionContentHashRow[0].value;

    await setup.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${categoryEditorialId},'canonical.category',${categoryKey},1,${categoryContentHash},'APPROVED','int4-activation-reviewer',${hash("e")})`;
      await tx.$executeRaw`INSERT INTO "CanonicalCategoryRevision"
        ("id","sourceNamespace","categoryKey","revision","labelAr","description","contentHash","editorialReceiptId","editorialDecision")
        VALUES (${categoryRevisionId},'canonical.category',${categoryKey},1,'فئة سباق اختبار','بيانات تركيبية',${categoryContentHash},${categoryEditorialId},'APPROVED')`;
      await tx.$executeRaw`INSERT INTO "EditorialReviewReceipt"
        ("id","sourceNamespace","sourceKey","sourceRevision","subjectHash","decision","reviewerRef","evidenceHash")
        VALUES (${questionEditorialId},${namespace},${sourceQuestionId},1,${questionContentHash},'APPROVED','int4-activation-reviewer',${hash("f")})`;
      await tx.$executeRaw`INSERT INTO "ContentRightsReceipt"
        ("id","sourceNamespace","subjectType","sourceKey","subjectHash","decision","rightsHolderRef","licenseRef","evidenceHash")
        VALUES (${questionRightsId},${namespace},'QUESTION',${sourceQuestionId},${questionContentHash},'CLEARED','int4-activation-holder','int4-activation-license',${hash("1")})`;
      await withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "SourceCategoryCrosswalkRevision"
          ("id","sourceNamespace","sourceCategoryId","revision","canonicalCategoryKey","mappingHash")
          VALUES (${crosswalkId},${namespace},${categoryKey},1,${categoryKey},${crosswalkHash})`;
        await tx.$executeRaw`INSERT INTO "QuestionRevision"
          ("id","sourceNamespace","sourceQuestionId","revision","sourceContentHash","contentHash","sourceCategoryId","crosswalkRevisionId","crosswalkRevision","canonicalCategoryKey","prompt","points","hints","modality","engine","mode","tier","editorialReceiptId","editorialDecision","rightsReceiptId","rightsSubjectType","rightsDecision")
          VALUES (${questionId},${namespace},${sourceQuestionId},1,${sourceContentHash},${questionContentHash},${categoryKey},${crosswalkId},1,${categoryKey},'Private synthetic activation race prompt',200,ARRAY[]::TEXT[],'TEXT','ENTA','CLASSIC','200',${questionEditorialId},'APPROVED',${questionRightsId},'QUESTION','CLEARED')`;
        await tx.$executeRaw`INSERT INTO "QuestionAnswerRevision"
          ("id","questionRevisionId","questionContentHash","sortOrder","text","points","isCorrect","isTrap","contentHash")
          VALUES (${answerId},${questionId},${questionContentHash},0,'Synthetic answer',200,true,false,${answerContentHash})`;
      });
      await withSessionAuthorization(tx, "catalog_publisher", async () => {
        await tx.$queryRaw`SELECT public.seal_question_revision(${questionId})`;
      });

      for (let index = 0; index < releaseIds.length; index += 1) {
        const releaseId = releaseIds[index];
        await withSessionAuthorization(tx, "catalog_assembler", async () => {
          await tx.$executeRaw`INSERT INTO "CatalogRelease" ("id","releaseRootHash","manifestVersion") VALUES (${releaseId},${hash(index === 0 ? "2" : "3")},1)`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseSourceSnapshot"
            ("id","catalogReleaseId","sourceNamespace","sourceReleaseId","sourceRootSha256","snapshotHash")
            VALUES (${snapshotIds[index]},${releaseId},${namespace},${sourceReleaseIds[index]},${sourceRootHash},${snapshotHash})`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseCategory"
            ("id","catalogReleaseId","categoryKey","categoryRevisionId","categoryContentHash")
            VALUES (${id(`activation_release_category_${index}`)},${releaseId},${categoryKey},${categoryRevisionId},${categoryContentHash})`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseQuestion"
            ("id","catalogReleaseId","sourceNamespace","sourceSnapshotHash","questionRevisionId","questionContentHash","categoryKey")
            VALUES (${id(`activation_membership_${index}`)},${releaseId},${namespace},${snapshotHash},${questionId},${questionContentHash},${categoryKey})`;
        });
        await withSessionAuthorization(tx, "catalog_publisher", async () => {
          await tx.$queryRaw`SELECT public.seal_catalog_release(${releaseId})`;
        });
        const seal = await tx.$queryRaw<Array<{ releaseRootHash: string; sealHash: string }>>`
          SELECT r."releaseRootHash",s."sealHash" FROM "CatalogRelease" r
          JOIN "CatalogReleaseSeal" s ON s."catalogReleaseId"=r."id" AND s."releaseRootHash"=r."releaseRootHash"
          WHERE r."id"=${releaseId}`;
        const sourceManifest = await tx.$queryRaw<Array<{ value: string }>>`
          SELECT encode(int4_crypto.digest(convert_to(COALESCE((
            SELECT jsonb_agg(jsonb_build_object('namespace',s."sourceNamespace",'releaseId',s."sourceReleaseId",'root',s."sourceRootSha256",'snapshotHash',s."snapshotHash") ORDER BY s."sourceNamespace")::text
            FROM "CatalogReleaseSourceSnapshot" s WHERE s."catalogReleaseId"=${releaseId}
          ),'[]'),'UTF8'),'sha256'),'hex') AS value`;
        const receipt = await withSessionAuthorization(tx, "catalog_validator", async () => tx.$queryRaw<Array<{ id: string }>>`
          SELECT public.issue_catalog_validation_receipt(${releaseId},${seal[0].releaseRootHash},${seal[0].sealHash},'int4-activation-race-policy-v1',${sourceManifest[0].value},${ENTA_CLASSIC_SELECTOR_VERSION}) AS id`);
        activationReceipts.push(receipt[0].id);
      }
      for (let index = 0; index < releaseChildRaceIds.length; index += 1) {
        const releaseId = releaseChildRaceIds[index];
        await withSessionAuthorization(tx, "catalog_assembler", async () => {
          await tx.$executeRaw`INSERT INTO "CatalogRelease" ("id","releaseRootHash","manifestVersion")
            VALUES (${releaseId},${hash(index === 0 ? "6" : "7")},1)`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseSourceSnapshot"
            ("id","catalogReleaseId","sourceNamespace","sourceReleaseId","sourceRootSha256","snapshotHash")
            VALUES (${releaseChildRaceSnapshotIds[index]},${releaseId},${namespace},${releaseChildRaceSourceIds[index]},${sourceRootHash},${snapshotHash})`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseCategory"
            ("id","catalogReleaseId","categoryKey","categoryRevisionId","categoryContentHash")
            VALUES (${id(`release_child_category_${index}`)},${releaseId},${categoryKey},${categoryRevisionId},${categoryContentHash})`;
          await tx.$executeRaw`INSERT INTO "CatalogReleaseQuestion"
            ("id","catalogReleaseId","sourceNamespace","sourceSnapshotHash","questionRevisionId","questionContentHash","categoryKey")
            VALUES (${id(`release_child_membership_${index}`)},${releaseId},${namespace},${snapshotHash},${questionId},${questionContentHash},${categoryKey})`;
        });
      }
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    });

    const waitedForLock = async (pid: number): Promise<boolean> => {
      const waitUntil = Date.now() + 5000;
      while (Date.now() < waitUntil) {
        const activity = await setup.$queryRaw<Array<{ wait_event_type: string | null }>>`
          SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
        if (activity[0]?.wait_event_type === "Lock") return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    };

    // Insert wins: the second source snapshot owns the parent lock first;
    // release sealing waits, then includes both snapshots after the insert commits.
    let releaseInsertFirst: (() => void) | undefined;
    let signalInsertedFirst!: (error?: unknown) => void;
    const insertedFirst = new Promise<unknown | undefined>((resolve) => { signalInsertedFirst = resolve; });
    const insertFirstMayCommit = new Promise<void>((resolve) => { releaseInsertFirst = resolve; });
    let insertFirstSignalled = false;
    let insertFirstTask: Promise<unknown> | undefined;
    let insertFirstSealTask: Promise<unknown> | undefined;
    try {
      insertFirstTask = firstPublisher.$transaction(async (tx) => withSessionAuthorization(tx, "catalog_assembler", async () => {
        await tx.$executeRaw`INSERT INTO "CatalogReleaseSourceSnapshot"
          ("id","catalogReleaseId","sourceNamespace","sourceReleaseId","sourceRootSha256","snapshotHash")
          VALUES (${id("insert_first_extra_snapshot")},${releaseChildRaceIds[0]},'enta.question.extra',${id("insert_first_extra_source")},${hash("8")},${hash("9")})`;
        insertFirstSignalled = true;
        signalInsertedFirst();
        await insertFirstMayCommit;
      })).catch((error: unknown) => {
        if (!insertFirstSignalled) signalInsertedFirst(error);
        throw error;
      });
      const insertError = await insertedFirst;
      if (insertError) throw insertError;
      let signalWaitingSealPid!: (pid: number) => void;
      const waitingSealPidReady = new Promise<number>((resolve) => { signalWaitingSealPid = resolve; });
      insertFirstSealTask = secondPublisher.$transaction(async (tx) => withSessionAuthorization(tx, "catalog_publisher", async () => {
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        signalWaitingSealPid(pid[0].pid);
        await tx.$queryRaw`SELECT public.seal_catalog_release(${releaseChildRaceIds[0]})`;
      }));
      const sealPid = await waitingSealPidReady;
      const observedInsertFirstWait = await waitedForLock(sealPid);
      releaseInsertFirst?.();
      await Promise.all([insertFirstTask, insertFirstSealTask]);
      assert.equal(observedInsertFirstWait, true, "seal should wait for the concurrent release-child insert");
      const insertFirstState = await setup.$queryRaw<Array<{ childCount: bigint; sealCount: bigint }>>`
        SELECT (SELECT count(*) FROM "CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=${releaseChildRaceIds[0]}) AS "childCount",
          (SELECT count(*) FROM "CatalogReleaseSeal" WHERE "catalogReleaseId"=${releaseChildRaceIds[0]}) AS "sealCount"`;
      assert.equal(insertFirstState[0].childCount, 2n);
      assert.equal(insertFirstState[0].sealCount, 1n);
    } finally {
      releaseInsertFirst?.();
      await Promise.allSettled([insertFirstTask, insertFirstSealTask].filter((task) => task !== undefined));
    }

    // Seal wins: a later release child waits on the same parent row and then
    // fails once the sealing transaction commits.
    let releaseSealFirst: (() => void) | undefined;
    let signalSealedFirst!: (error?: unknown) => void;
    const sealedFirst = new Promise<unknown | undefined>((resolve) => { signalSealedFirst = resolve; });
    const sealFirstMayCommit = new Promise<void>((resolve) => { releaseSealFirst = resolve; });
    let sealFirstSignalled = false;
    let sealFirstTask: Promise<unknown> | undefined;
    let lateReleaseChildTask: Promise<unknown> | undefined;
    try {
      sealFirstTask = firstPublisher.$transaction(async (tx) => withSessionAuthorization(tx, "catalog_publisher", async () => {
        await tx.$queryRaw`SELECT public.seal_catalog_release(${releaseChildRaceIds[1]})`;
        sealFirstSignalled = true;
        signalSealedFirst();
        await sealFirstMayCommit;
      })).catch((error: unknown) => {
        if (!sealFirstSignalled) signalSealedFirst(error);
        throw error;
      });
      const sealError = await sealedFirst;
      if (sealError) throw sealError;
      let signalLateChildPid!: (pid: number) => void;
      const lateChildPidReady = new Promise<number>((resolve) => { signalLateChildPid = resolve; });
      lateReleaseChildTask = secondPublisher.$transaction(async (tx) => {
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        signalLateChildPid(pid[0].pid);
        try {
          await withSessionAuthorization(tx, "catalog_assembler", async () => tx.$executeRaw`INSERT INTO "CatalogReleaseSourceSnapshot"
            ("id","catalogReleaseId","sourceNamespace","sourceReleaseId","sourceRootSha256","snapshotHash")
            VALUES (${id("seal_first_late_snapshot")},${releaseChildRaceIds[1]},'enta.question.extra',${id("seal_first_late_source")},${hash("a1")},${hash("b1")})`);
          return "inserted";
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      const lateChildPid = await lateChildPidReady;
      const observedSealFirstWait = await waitedForLock(lateChildPid);
      releaseSealFirst?.();
      const [sealed, lateInsertResult] = await Promise.all([sealFirstTask, lateReleaseChildTask]);
      assert.equal(sealed, undefined);
      assert.equal(observedSealFirstWait, true, "late release-child insert should wait for the seal transaction");
      assert.match(String(lateInsertResult), /catalog release is sealed/i);
      const sealFirstState = await setup.$queryRaw<Array<{ childCount: bigint; sealCount: bigint }>>`
        SELECT (SELECT count(*) FROM "CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=${releaseChildRaceIds[1]}) AS "childCount",
          (SELECT count(*) FROM "CatalogReleaseSeal" WHERE "catalogReleaseId"=${releaseChildRaceIds[1]}) AS "sealCount"`;
      assert.equal(sealFirstState[0].childCount, 1n);
      assert.equal(sealFirstState[0].sealCount, 1n);
    } finally {
      releaseSealFirst?.();
      await Promise.allSettled([sealFirstTask, lateReleaseChildTask].filter((task) => task !== undefined));
    }

    firstTask = firstPublisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_activator");
      try {
        const result = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release(NULL,${activationReceipts[0]})`;
        assert.equal(result[0].activate_catalog_release, true);
        signalFirstActivated(activationReceipts[0]);
        await firstMayCommit;
        return result[0].activate_catalog_release;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    const winningReceipt = await firstActivated;
    secondTask = secondPublisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_activator");
      try {
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        signalSecondPid(pid[0].pid);
        const result = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release(NULL,${activationReceipts[1]})`;
        return result[0].activate_catalog_release;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    const waitingPid = await secondPidReady;
    const waitUntil = Date.now() + 5000;
    let observedConflictWait = false;
    while (Date.now() < waitUntil) {
      const activity = await setup.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid=${waitingPid}`;
      if (activity[0]?.wait_event_type === "Lock") {
        observedConflictWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseFirst?.();
    const [firstResult, secondResult] = await Promise.all([firstTask, secondTask]);
    assert.equal(firstResult, true);
    assert.equal(secondResult, false);
    assert.equal(observedConflictWait, true, "the competing insert should wait on the uncommitted singleton pointer");
    const state = await setup.$queryRaw<Array<{ pointerCount: bigint; eventCount: bigint; validationReceiptId: string }>>`
      SELECT (SELECT count(*) FROM "ActiveCatalogPointer" WHERE "id"='singleton') AS "pointerCount",
        (SELECT count(*) FROM "CatalogActivationEvent" WHERE "validationReceiptId" IN (${Prisma.join(activationReceipts)})) AS "eventCount",
        (SELECT "validationReceiptId" FROM "ActiveCatalogPointer" WHERE "id"='singleton') AS "validationReceiptId"`;
    assert.equal(state[0].pointerCount, 1n);
    assert.equal(state[0].eventCount, 1n);
    assert.equal(state[0].validationReceiptId, winningReceipt);

    await setup.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "User" ("id","name") VALUES (${testUserId},${id("pinned-user-name")})`;
      await tx.$executeRaw`INSERT INTO "Category" ("id","name") VALUES (${legacyCategoryId},${id("legacy-category-name")})`;
      await tx.$executeRaw`INSERT INTO "Question" ("id","categoryId","text","answer")
        VALUES (${legacyQuestionId},${legacyCategoryId},'Synthetic game question','Synthetic answer')`;
      await tx.$executeRaw`INSERT INTO "Game" ("id","userId","catalogReleaseId")
        VALUES (${testGameId},${testUserId},${releaseIds[0]})`;
      await tx.$executeRaw`INSERT INTO "GameQuestion"
        ("id","gameId","catalogReleaseId","questionId","questionRevisionId")
        VALUES (${testGameQuestionId},${testGameId},${releaseIds[0]},${legacyQuestionId},${questionId})`;
      await expectDatabaseFailure(
        tx,
        () => tx.$executeRaw`INSERT INTO "GameQuestion"
          ("id","gameId","catalogReleaseId","questionId","questionRevisionId")
          VALUES (${id("null_game_question_pin")},${testGameId},NULL,${legacyQuestionId},NULL)`,
        /pinned game question must match parent release and sealed membership|P2010/i,
      );
      await expectDatabaseFailure(
        tx,
        () => tx.$executeRaw`INSERT INTO "GameQuestion"
          ("id","gameId","catalogReleaseId","questionId","questionRevisionId")
          VALUES (${id("mismatched_game_question_pin")},${testGameId},${releaseIds[1]},${legacyQuestionId},${questionId})`,
        /pinned game question must match parent release and sealed membership|P2010/i,
      );
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");

      const historical = await tx.$queryRaw<Array<{ gameId: string }>>`
        SELECT "gameId" FROM "LegacyUnpinnedGame" ORDER BY "gameId" LIMIT 1`;
      if (historical[0]) {
        await tx.$executeRawUnsafe("SAVEPOINT int4_historical_null_pin");
        await tx.$executeRaw`INSERT INTO "GameQuestion"
          ("id","gameId","catalogReleaseId","questionId","questionRevisionId")
          VALUES (${id("historical_game_question")},${historical[0].gameId},NULL,${legacyQuestionId},NULL)`;
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT int4_historical_null_pin");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT int4_historical_null_pin");
      }
    });

    // Reuse the two valid receipts to prove that a first activation rolled back
    // while holding the unique-key conflict lets the waiting activation win.
    await setup.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`DELETE FROM "ActiveCatalogPointer" WHERE "catalogReleaseId" IN (${Prisma.join(releaseIds)})`;
      await tx.$executeRaw`DELETE FROM "CatalogActivationEvent" WHERE "catalogReleaseId" IN (${Prisma.join(releaseIds)})`;
    });
    let signalRollbackFirst!: () => void;
    let signalRollbackSecondPid!: (pid: number) => void;
    const rollbackFirstActivated = new Promise<void>((resolve) => { signalRollbackFirst = resolve; });
    const rollbackSecondPidReady = new Promise<number>((resolve) => { signalRollbackSecondPid = resolve; });
    const rollbackWinnerMayFail = new Promise<void>((resolve) => { releaseRollbackWinner = resolve; });
    rollbackFirstTask = firstPublisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_activator");
      try {
        const result = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release(NULL,${activationReceipts[0]})`;
        assert.equal(result[0].activate_catalog_release, true);
        signalRollbackFirst();
        await rollbackWinnerMayFail;
        throw new Error("INT4_EXPECTED_ACTIVATION_WINNER_ROLLBACK");
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    await rollbackFirstActivated;
    rollbackSecondTask = secondPublisher.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET SESSION AUTHORIZATION catalog_activator");
      try {
        const pid = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        signalRollbackSecondPid(pid[0].pid);
        const result = await tx.$queryRaw<Array<{ activate_catalog_release: boolean }>>`
          SELECT public.activate_catalog_release(NULL,${activationReceipts[1]})`;
        return result[0].activate_catalog_release;
      } finally {
        await tx.$executeRawUnsafe("RESET SESSION AUTHORIZATION");
      }
    });
    const rollbackWaitPid = await rollbackSecondPidReady;
    const rollbackWaitUntil = Date.now() + 5000;
    let observedRollbackConflictWait = false;
    while (Date.now() < rollbackWaitUntil) {
      const activity = await setup.$queryRaw<Array<{ wait_event_type: string | null }>>`
        SELECT wait_event_type FROM pg_stat_activity WHERE pid=${rollbackWaitPid}`;
      if (activity[0]?.wait_event_type === "Lock") {
        observedRollbackConflictWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    releaseRollbackWinner?.();
    const rollbackResults = await Promise.allSettled([rollbackFirstTask, rollbackSecondTask]);
    assert.equal(rollbackResults[0].status, "rejected");
    if (rollbackResults[0].status === "rejected") {
      assert.match(String(rollbackResults[0].reason), /INT4_EXPECTED_ACTIVATION_WINNER_ROLLBACK/);
    }
    assert.equal(rollbackResults[1].status, "fulfilled");
    if (rollbackResults[1].status === "fulfilled") assert.equal(rollbackResults[1].value, true);
    assert.equal(observedRollbackConflictWait, true, "the competing activation should wait until the first activation rolls back");
    const afterRollback = await setup.$queryRaw<Array<{ pointerCount: bigint; eventCount: bigint; validationReceiptId: string }>>`
      SELECT (SELECT count(*) FROM "ActiveCatalogPointer" WHERE "id"='singleton') AS "pointerCount",
        (SELECT count(*) FROM "CatalogActivationEvent" WHERE "catalogReleaseId" IN (${Prisma.join(releaseIds)})) AS "eventCount",
        (SELECT "validationReceiptId" FROM "ActiveCatalogPointer" WHERE "id"='singleton') AS "validationReceiptId"`;
    assert.equal(afterRollback[0].pointerCount, 1n);
    assert.equal(afterRollback[0].eventCount, 1n);
    assert.equal(afterRollback[0].validationReceiptId, activationReceipts[1]);
  } catch (error) {
    primaryFailure = error;
  } finally {
    releaseFirst?.();
    releaseRollbackWinner?.();
    await Promise.allSettled([firstTask, secondTask, rollbackFirstTask, rollbackSecondTask].filter((task) => task !== undefined));
    let cleanupFailure: unknown;
    try {
      await setup.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await tx.$executeRaw`DELETE FROM "GameQuestion" WHERE "gameId"=${testGameId}`;
        await tx.$executeRaw`DELETE FROM "Game" WHERE "id"=${testGameId}`;
        await tx.$executeRaw`DELETE FROM "Question" WHERE "id"=${legacyQuestionId}`;
        await tx.$executeRaw`DELETE FROM "Category" WHERE "id"=${legacyCategoryId}`;
        await tx.$executeRaw`DELETE FROM "User" WHERE "id"=${testUserId}`;
        await tx.$executeRaw`DELETE FROM "ActiveCatalogPointer" WHERE "catalogReleaseId" IN (${Prisma.join(allReleaseIds)})`;
        await tx.$executeRaw`DELETE FROM "CatalogActivationEvent" WHERE "catalogReleaseId" IN (${Prisma.join(allReleaseIds)})`;
        for (const releaseId of allReleaseIds) {
          await tx.$executeRaw`DELETE FROM "CatalogValidationReceipt" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseSeal" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseQuestion" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseCategory" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogReleaseSourceSnapshot" WHERE "catalogReleaseId"=${releaseId}`;
          await tx.$executeRaw`DELETE FROM "CatalogRelease" WHERE "id"=${releaseId}`;
        }
        await tx.$executeRaw`DELETE FROM "QuestionRevisionSeal" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionAnswerRevision" WHERE "questionRevisionId"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "QuestionRevision" WHERE "id"=${questionId}`;
        await tx.$executeRaw`DELETE FROM "CanonicalCategoryRevision" WHERE "id"=${categoryRevisionId}`;
        await tx.$executeRaw`DELETE FROM "EditorialReviewReceipt" WHERE "id" IN (${Prisma.join([categoryEditorialId, questionEditorialId])})`;
        await tx.$executeRaw`DELETE FROM "ContentRightsReceipt" WHERE "id"=${questionRightsId}`;
        await tx.$executeRaw`DELETE FROM "SourceCategoryCrosswalkRevision" WHERE "id"=${crosswalkId}`;
      });
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await Promise.all([setup.$disconnect(), firstPublisher.$disconnect(), secondPublisher.$disconnect()]);
    } catch (error) {
      cleanupFailure = cleanupFailure ? new AggregateError([cleanupFailure, error], "Database cleanup and disconnect failed") : error;
    }
    if (primaryFailure && cleanupFailure) {
      throw new AggregateError([primaryFailure, cleanupFailure], "CAS race failed and exact-ID cleanup also failed");
    }
    if (primaryFailure) throw primaryFailure;
    if (cleanupFailure) throw cleanupFailure;
  }
});
