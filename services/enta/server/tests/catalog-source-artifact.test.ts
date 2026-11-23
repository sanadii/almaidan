import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deriveEntaSourceCategoryId, deriveEntaSourceId, ENTA_SOURCE_PARSER_VERSION, ENTA_SOURCE_SNAPSHOT_VERSION, MAX_ENTA_SOURCE_ARTIFACT_BYTES, normalizeEntaTextSourcePayload, parseJsonRejectingDuplicateKeys, verifyEntaSourceArtifactSnapshot, type EntaArtifactMember, type EntaTextSourcePayload } from "../src/catalog/source-artifact";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const artifact = {
    "فئة اختبار": [
      { text: "سؤال أول", answer: "جواب أول", points: 200, hint: "تلميح" },
      { text: "سؤال ثان", answer: "جواب ثان", points: 200 },
    ],
  };
  const rawArtifactBytes = Buffer.from(JSON.stringify(artifact), "utf8");
  const sourceRootSha256 = hash(rawArtifactBytes);
  const members = artifact["فئة اختبار"].map((sourcePayload, index): EntaArtifactMember => {
    const arrayIndexOneBased = index + 1;
    const sourcePayloadJsonbText = sourcePayload.hint === undefined
      ? `{"text": "${sourcePayload.text}", "answer": "${sourcePayload.answer}", "points": ${sourcePayload.points}}`
      : `{"text": "${sourcePayload.text}", "hint": "${sourcePayload.hint}", "answer": "${sourcePayload.answer}", "points": ${sourcePayload.points}}`;
    return {
      sourceId: deriveEntaSourceId({ artifactSha256: sourceRootSha256, categoryName: "فئة اختبار", arrayIndexOneBased }),
      artifactSha256: sourceRootSha256,
      categoryName: "فئة اختبار",
      arrayIndexOneBased,
      sourceCategoryId: deriveEntaSourceCategoryId("فئة اختبار"),
      categoryKey: "canonical-category",
      sourcePayload: sourcePayload as EntaTextSourcePayload,
      untrustedSourcePayloadJsonbText: sourcePayloadJsonbText,
      sourceContentHash: hash(sourcePayloadJsonbText),
    };
  }).sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
  const snapshot = {
    version: ENTA_SOURCE_SNAPSHOT_VERSION,
    sourceNamespace: "enta.question",
    sourceReleaseId: "synthetic-source-release",
    sourceRootSha256,
    parserVersion: ENTA_SOURCE_PARSER_VERSION,
    members: members.map(({ untrustedSourcePayloadJsonbText: _ignored, ...member }) => member),
  };
  // Synthetic exact-input text. It tests hashing/lineage behavior; it does not
  // claim PostgreSQL hash parity or editorial approval.
  const snapshotJsonbText = JSON.stringify(snapshot);
  return {
    rawArtifactBytes,
    sourceRootSha256,
    expectedSourceRootSha256: sourceRootSha256,
    members,
    snapshotJsonbText,
    expectedSnapshotHash: hash(snapshotJsonbText),
    sourceNamespace: "enta.question",
    sourceReleaseId: "synthetic-source-release",
  };
}

test("single-artifact verifier proves exact byte root and selected source membership", () => {
  const input = fixture();
  const result = verifyEntaSourceArtifactSnapshot(input);
  assert.equal(result.artifactSnapshotMatched, true);
  assert.deepEqual(result.pendingEvidence, ["POSTGRES_CANONICAL_TEXT_READER"]);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.sourceRootSha256, input.sourceRootSha256);
  assert.equal(result.snapshotHash, input.expectedSnapshotHash);
  assert.equal(JSON.stringify(result).includes("جواب"), false);
});

test("single-artifact verifier rejects false root, wrong snapshot and missing or extra selected members", () => {
  const input = fixture();
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...input, expectedSourceRootSha256: "0".repeat(64) }).reasons.includes("SOURCE_ROOT_MISMATCH"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...input, expectedSnapshotHash: "1".repeat(64) }).reasons.includes("SNAPSHOT_HASH_MISMATCH"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...input, members: input.members.slice(0, 1) }).reasons.includes("SOURCE_SNAPSHOT_CONTENT_MISMATCH"));
  const missing = { ...input.members[0], arrayIndexOneBased: 99 };
  const withMissing = { ...input, members: [missing] };
  assert.ok(verifyEntaSourceArtifactSnapshot(withMissing).reasons.includes("SOURCE_MEMBER_MISSING"));
  const brokenIdentity = { ...input, members: input.members.map((member, index) => index === 0 ? { ...member, sourceCategoryId: "arbitrary-unbound-id" } : member) };
  assert.ok(verifyEntaSourceArtifactSnapshot(brokenIdentity).reasons.includes("SNAPSHOT_MEMBER_IDENTITY_INVALID"));
  const brokenAnswer = { ...input, members: input.members.map((member, index) => index === 0
    ? { ...member, sourcePayload: { ...member.sourcePayload, answer: "altered" } } : member) };
  assert.ok(verifyEntaSourceArtifactSnapshot(brokenAnswer).reasons.includes("SOURCE_MEMBER_CONTENT_MISMATCH"));
  const falseContentHash = { ...input, members: input.members.map((member, index) => index === 0
    ? { ...member, sourceContentHash: "0".repeat(64) } : member) };
  assert.ok(verifyEntaSourceArtifactSnapshot(falseContentHash).reasons.includes("SOURCE_CONTENT_HASH_MISMATCH"));
});

test("source parser rejects duplicate keys, malformed UTF-8, ambiguous numbers, Unicode and unsupported media", () => {
  const base = fixture();
  const duplicateArtifact = Buffer.from('{"فئة اختبار": [{"text":"A","text":"B","answer":"C","points":200}]}', "utf8");
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...base, rawArtifactBytes: duplicateArtifact }).reasons.includes("JSON_INVALID_OR_AMBIGUOUS"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...base, rawArtifactBytes: Buffer.from([0xc3, 0x28]) }).reasons.includes("SOURCE_VALIDATION_FAILED"));
  assert.throws(() => deriveEntaSourceId({ artifactSha256: base.sourceRootSha256, categoryName: "bad\ud800", arrayIndexOneBased: 1 }), /LOCATOR_INVALID/);
  assert.ok(verifyEntaSourceArtifactSnapshot({
    ...base,
    rawArtifactBytes: Buffer.from('{"فئة اختبار":[{"text":"Q","answer":"A","points":2e2}]}', "utf8"),
  }).reasons.includes("JSON_INVALID_OR_AMBIGUOUS"));
  assert.ok(verifyEntaSourceArtifactSnapshot({
    ...base,
    rawArtifactBytes: Buffer.from('{"فئة اختبار":[{"text":"Q","answer":"A","points":-0}]}', "utf8"),
  }).reasons.includes("JSON_INVALID_OR_AMBIGUOUS"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...base, rawArtifactBytes: Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]) }).reasons.includes("SOURCE_ARTIFACT_BOM_UNSUPPORTED"));
  assert.ok(verifyEntaSourceArtifactSnapshot({
    ...base,
    rawArtifactBytes: Buffer.from('{"فئة اختبار":[{"text":"Q","answer":"A","points":200,"imageUrl":"https://example.invalid/x"}]}', "utf8"),
  }).reasons.includes("SOURCE_ARTIFACT_UNSUPPORTED_PAYLOAD"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...base, rawArtifactBytes: new Uint8Array(MAX_ENTA_SOURCE_ARTIFACT_BYTES + 1) }).reasons.includes("SOURCE_ARTIFACT_SIZE_INVALID"));
});

test("parser v2 normalizes a nullable hint to absent while retaining exact raw artifact bytes", () => {
  const rawArtifactBytes = Buffer.from('{"فئة": [{"text":"سؤال","answer":"جواب","points":200,"hint":null}]}', "utf8");
  const root = hash(rawArtifactBytes);
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawArtifactBytes)) as Record<string, Array<Record<string, unknown>>>;
  const sourcePayload = normalizeEntaTextSourcePayload(parsed["فئة"][0]);
  assert.deepEqual(sourcePayload, { text: "سؤال", answer: "جواب", points: 200 });
  assert.equal(root, hash(rawArtifactBytes), "the byte root is unchanged by the nullable-hint transform");
  assert.equal(ENTA_SOURCE_PARSER_VERSION, "enta-extra-questions-parser-v2");
});

const pinnedArtifactPath = process.env.INT4_ENTA_SOURCE_ARTIFACT_PATH;
test("pinned Enta source artifact matches exact bytes and parser-v2 accepts all rows without exposing content", { skip: !pinnedArtifactPath }, () => {
  const rawArtifactBytes = readFileSync(pinnedArtifactPath!);
  assert.equal(rawArtifactBytes.byteLength, 303_379);
  assert.equal(hash(rawArtifactBytes), "32a1bd7788d4f7d919af0e676c84b11d8a76e7f63d7752af535a5e1982ff1604");
  const parsed = parseJsonRejectingDuplicateKeys(new TextDecoder("utf-8", { fatal: true }).decode(rawArtifactBytes));
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed));
  const categories = Object.values(parsed as Record<string, unknown>);
  assert.equal(categories.length, 29);
  const rows = categories.flatMap((category) => Array.isArray(category) ? category : []);
  assert.equal(rows.length, 1_273);
  let nullHintCount = 0;
  let omittedHintCount = 0;
  for (const row of rows) {
    const raw = row as Record<string, unknown>;
    if (Object.hasOwn(raw, "hint") && raw.hint === null) nullHintCount += 1;
    if (!Object.hasOwn(raw, "hint")) omittedHintCount += 1;
    assert.ok(normalizeEntaTextSourcePayload(row));
  }
  assert.equal(nullHintCount, 1_184);
  assert.equal(omittedHintCount, 50);
});

test("snapshot parser rejects duplicate member keys and reordered members", () => {
  const input = fixture();
  const duplicateSnapshot = input.snapshotJsonbText.replace('"version":"enta-source-snapshot-v1"', '"version":"enta-source-snapshot-v1","version":"enta-source-snapshot-v1"');
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...input, snapshotJsonbText: duplicateSnapshot }).reasons.includes("JSON_INVALID_OR_AMBIGUOUS"));
  assert.ok(verifyEntaSourceArtifactSnapshot({ ...input, members: [...input.members].reverse() }).reasons.includes("SNAPSHOT_MEMBERS_NOT_SORTED"));
});
