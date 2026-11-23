import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const ENTA_SOURCE_SNAPSHOT_VERSION = "enta-source-snapshot-v1";
export const ENTA_SOURCE_PARSER_VERSION = "enta-extra-questions-parser-v2";
export const INT4_JSONB_TEXT_HASH_VERSION = "int4-pg-jsonb-v1";
export const MAX_ENTA_SOURCE_ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface EntaTextSourcePayload {
  text: string;
  answer: string;
  points: number;
  hint?: string;
}

export interface EntaArtifactMember {
  /** Domain-separated deterministic source ID derived from artifact + locator. */
  sourceId: string;
  artifactSha256: string;
  categoryName: string;
  arrayIndexOneBased: number;
  sourceCategoryId: string;
  categoryKey: string;
  sourcePayload: EntaTextSourcePayload;
  /** Untrusted text until a PostgreSQL canonical-payload reader proves origin. */
  untrustedSourcePayloadJsonbText: string;
  sourceContentHash: string;
}

export interface EntaArtifactSnapshotVerification {
  /** Local artifact/snapshot consistency only; not complete SQL/source evidence. */
  artifactSnapshotMatched: boolean;
  pendingEvidence: ["POSTGRES_CANONICAL_TEXT_READER"];
  reasons: string[];
  sourceRootSha256?: string;
  snapshotHash?: string;
  parserVersion: typeof ENTA_SOURCE_PARSER_VERSION;
  hashVersion: typeof INT4_JSONB_TEXT_HASH_VERSION;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function safeUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** Strict recursive-descent JSON parser that rejects duplicate object keys. */
export function parseJsonRejectingDuplicateKeys(text: string): unknown {
  let offset = 0;
  const fail = (): never => { throw new Error("JSON_INVALID_OR_AMBIGUOUS"); };
  const whitespace = () => { while (/[\u0009\u000a\u000d\u0020]/.test(text[offset] ?? "")) offset += 1; };

  function stringValue(): string {
    if (text[offset] !== '"') return fail();
    const start = offset++;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        let value: unknown;
        try { value = JSON.parse(text.slice(start, offset)); } catch { return fail(); }
        if (typeof value !== "string" || !safeUnicode(value)) return fail();
        return value;
      }
      if (code < 0x20) return fail();
      if (code === 0x5c) {
        offset += 1;
        const escaped = text[offset];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) return fail();
          offset += 5;
          continue;
        }
        if (!["\"", "\\", "/", "b", "f", "n", "r", "t"].includes(escaped ?? "")) return fail();
      }
      offset += 1;
    }
    return fail();
  }

  function value(depth: number): unknown {
    if (depth > 64) return fail();
    whitespace();
    const next = text[offset];
    if (next === '"') return stringValue();
    if (next === "{") {
      offset += 1;
      whitespace();
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (text[offset] === "}") { offset += 1; return result; }
      while (offset < text.length) {
        whitespace();
        const key = stringValue();
        if (keys.has(key)) return fail();
        keys.add(key);
        whitespace();
        if (text[offset++] !== ":") return fail();
        Object.defineProperty(result, key, { value: value(depth + 1), enumerable: true, configurable: true, writable: true });
        whitespace();
        if (text[offset] === "}") { offset += 1; return result; }
        if (text[offset++] !== ",") return fail();
      }
      return fail();
    }
    if (next === "[") {
      offset += 1;
      whitespace();
      const result: unknown[] = [];
      if (text[offset] === "]") { offset += 1; return result; }
      while (offset < text.length) {
        result.push(value(depth + 1));
        whitespace();
        if (text[offset] === "]") { offset += 1; return result; }
        if (text[offset++] !== ",") return fail();
      }
      return fail();
    }
    for (const [literal, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return parsed; }
    }
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(text.slice(offset));
    if (!match) return fail();
    const number = Number(match[0]);
    if (!Number.isSafeInteger(number) || match[0] === "-0") return fail();
    offset += match[0].length;
    return number;
  }

  const parsed = value(0);
  whitespace();
  if (offset !== text.length) return fail();
  return parsed;
}

export function deriveEntaSourceId(input: { artifactSha256: string; categoryName: string; arrayIndexOneBased: number }): string {
  if (!validHash(input.artifactSha256) || !safeUnicode(input.categoryName) || !input.categoryName.trim() ||
      !Number.isSafeInteger(input.arrayIndexOneBased) || input.arrayIndexOneBased < 1) {
    throw new Error("ENTA_SOURCE_LOCATOR_INVALID");
  }
  const categoryBytes = Buffer.byteLength(input.categoryName, "utf8");
  const locator = `enta-source-question-v1\n${input.artifactSha256}\n${categoryBytes}:${input.categoryName}\n${input.arrayIndexOneBased}`;
  return sha256(locator);
}

export function deriveEntaSourceCategoryId(categoryName: string): string {
  if (!safeUnicode(categoryName) || !categoryName.trim()) throw new Error("ENTA_SOURCE_CATEGORY_INVALID");
  return sha256(`enta-source-category-v1\n${Buffer.byteLength(categoryName, "utf8")}:${categoryName}`);
}

export function normalizeEntaTextSourcePayload(value: unknown): EntaTextSourcePayload | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (!(keys.join(",") === "answer,points,text" || keys.join(",") === "answer,hint,points,text") ||
      typeof row.text !== "string" || !row.text.trim() || !safeUnicode(row.text) ||
      typeof row.answer !== "string" || !row.answer.trim() || !safeUnicode(row.answer) ||
      !Number.isSafeInteger(row.points) || ![200, 400, 600].includes(row.points as number) ||
      (row.hint !== undefined && row.hint !== null && (typeof row.hint !== "string" || !safeUnicode(row.hint))) ) return undefined;
  return row.hint === undefined || row.hint === null
    ? { text: row.text, answer: row.answer, points: row.points as number }
    : { text: row.text, answer: row.answer, points: row.points as number, hint: row.hint as string };
}

function snapshotMember(member: EntaArtifactMember) {
  return {
    sourceId: member.sourceId,
    artifactSha256: member.artifactSha256,
    categoryName: member.categoryName,
    arrayIndexOneBased: member.arrayIndexOneBased,
    sourceCategoryId: member.sourceCategoryId,
    categoryKey: member.categoryKey,
    sourcePayload: member.sourcePayload,
    sourceContentHash: member.sourceContentHash,
  };
}

/**
 * Verify one raw immutable artifact and its SQL-text snapshot. The caller must
 * obtain snapshot/payload TEXT from the reviewed read-only PostgreSQL helpers;
 * no content, report, approval, or receipt is persisted here.
 */
export function verifyEntaSourceArtifactSnapshot(input: {
  rawArtifactBytes: Uint8Array;
  expectedSourceRootSha256: string;
  sourceNamespace: string;
  sourceReleaseId: string;
  expectedSnapshotHash: string;
  snapshotJsonbText: string;
  members: readonly EntaArtifactMember[];
}): EntaArtifactSnapshotVerification {
  const reasons: string[] = [];
  const fail = (reason: string) => reasons.push(reason);
  let sourceRootSha256: string | undefined;
  let snapshotHash: string | undefined;
  try {
    if (!input.sourceNamespace.trim() || !input.sourceReleaseId.trim() || !Array.isArray(input.members)) {
      throw new Error("SOURCE_SNAPSHOT_IDENTITY_INVALID");
    }
    if (input.rawArtifactBytes.byteLength === 0 || input.rawArtifactBytes.byteLength > MAX_ENTA_SOURCE_ARTIFACT_BYTES) {
      throw new Error("SOURCE_ARTIFACT_SIZE_INVALID");
    }
    if (input.rawArtifactBytes[0] === 0xef && input.rawArtifactBytes[1] === 0xbb && input.rawArtifactBytes[2] === 0xbf) {
      throw new Error("SOURCE_ARTIFACT_BOM_UNSUPPORTED");
    }
    sourceRootSha256 = sha256(input.rawArtifactBytes);
    if (!validHash(input.expectedSourceRootSha256) || sourceRootSha256 !== input.expectedSourceRootSha256) fail("SOURCE_ROOT_MISMATCH");

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.rawArtifactBytes);
    const artifact = parseJsonRejectingDuplicateKeys(decoded);
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new Error("SOURCE_ARTIFACT_SHAPE_INVALID");
    for (const [categoryName, questions] of Object.entries(artifact as Record<string, unknown>)) {
      if (!safeUnicode(categoryName) || !Array.isArray(questions)) throw new Error("SOURCE_ARTIFACT_SHAPE_INVALID");
      for (const question of questions) {
        if (!normalizeEntaTextSourcePayload(question)) throw new Error("SOURCE_ARTIFACT_UNSUPPORTED_PAYLOAD");
      }
    }

    if (!validHash(input.expectedSnapshotHash)) fail("SNAPSHOT_HASH_INVALID");
    snapshotHash = sha256(input.snapshotJsonbText);
    if (snapshotHash !== input.expectedSnapshotHash) fail("SNAPSHOT_HASH_MISMATCH");
    const parsedSnapshot = parseJsonRejectingDuplicateKeys(input.snapshotJsonbText);
    if (!parsedSnapshot || typeof parsedSnapshot !== "object" || Array.isArray(parsedSnapshot)) throw new Error("SNAPSHOT_SHAPE_INVALID");
    const snapshot = parsedSnapshot as Record<string, unknown>;
    const sortedMembers = [...input.members].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
    if (!isDeepStrictEqual(input.members, sortedMembers)) fail("SNAPSHOT_MEMBERS_NOT_SORTED");

    const sourceIds = new Set<string>();
    const locators = new Set<string>();
    for (const member of input.members) {
      const locator = `${member.categoryName}\u0000${member.arrayIndexOneBased}`;
      if (!validHash(member.sourceId) || member.sourceId !== deriveEntaSourceId({
        artifactSha256: sourceRootSha256,
        categoryName: member.categoryName,
        arrayIndexOneBased: member.arrayIndexOneBased,
      }) || member.artifactSha256 !== sourceRootSha256 || !KEY.test(member.categoryKey) ||
          member.sourceCategoryId !== deriveEntaSourceCategoryId(member.categoryName) ||
          !Number.isSafeInteger(member.arrayIndexOneBased) || member.arrayIndexOneBased < 1 ||
          sourceIds.has(member.sourceId) || locators.has(locator)) {
        fail("SNAPSHOT_MEMBER_IDENTITY_INVALID");
      }
      sourceIds.add(member.sourceId);
      locators.add(locator);
      const categoryQuestions = (artifact as Record<string, unknown>)[member.categoryName];
      if (!Array.isArray(categoryQuestions) || member.arrayIndexOneBased > categoryQuestions.length) {
        fail("SOURCE_MEMBER_MISSING");
        continue;
      }
      const sourcePayload = normalizeEntaTextSourcePayload(categoryQuestions[member.arrayIndexOneBased - 1]);
      if (!sourcePayload || !isDeepStrictEqual(sourcePayload, member.sourcePayload)) fail("SOURCE_MEMBER_CONTENT_MISMATCH");
      const payloadJson = parseJsonRejectingDuplicateKeys(member.untrustedSourcePayloadJsonbText);
      const canonicalPayload = normalizeEntaTextSourcePayload(payloadJson);
      if (!canonicalPayload || !isDeepStrictEqual(canonicalPayload, member.sourcePayload) ||
          !validHash(member.sourceContentHash) || sha256(member.untrustedSourcePayloadJsonbText) !== member.sourceContentHash) {
        fail("SOURCE_CONTENT_HASH_MISMATCH");
      }
    }

    const expected = {
      version: ENTA_SOURCE_SNAPSHOT_VERSION,
      sourceNamespace: input.sourceNamespace,
      sourceReleaseId: input.sourceReleaseId,
      sourceRootSha256: sourceRootSha256,
      parserVersion: ENTA_SOURCE_PARSER_VERSION,
      members: input.members.map(snapshotMember),
    };
    if (!isDeepStrictEqual(snapshot, expected)) fail("SOURCE_SNAPSHOT_CONTENT_MISMATCH");
  } catch (error) {
    const message = error instanceof Error ? error.message : "SOURCE_VALIDATION_FAILED";
    fail(/^[A-Z0-9_]{1,80}$/.test(message) ? message : "SOURCE_VALIDATION_FAILED");
  }
  return {
    artifactSnapshotMatched: reasons.length === 0,
    pendingEvidence: ["POSTGRES_CANONICAL_TEXT_READER"],
    reasons: [...new Set(reasons)].sort(),
    ...(sourceRootSha256 ? { sourceRootSha256 } : {}),
    ...(snapshotHash ? { snapshotHash } : {}),
    parserVersion: ENTA_SOURCE_PARSER_VERSION,
    hashVersion: INT4_JSONB_TEXT_HASH_VERSION,
  };
}

const KEY = /^[A-Za-z0-9:_-]{1,128}$/;
