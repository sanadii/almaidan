import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import { test } from "node:test";
import { createApp } from "../src/app";
import { createHuroofReleaseReader, type ReleaseDocumentStore } from "../src/catalog/firebase-release-reader";
import { createCatalogRouter } from "../src/catalog/router";
import { readPublicCatalog } from "../src/catalog/service";
import { ENTA_CLASSIC_SELECTOR_VERSION } from "../src/catalog/selectors";
import type { ActiveCatalogRecord, CatalogAvailabilityRecord, CatalogStore, HuroofReleaseReader } from "../src/catalog/types";
import type { IdentityStore } from "../src/identity";
import type { RuntimeConfig } from "../src/runtime-config";

const projectId = "maydan-catalog-test-project";
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const config: RuntimeConfig = {
  environment: "test",
  firebaseProjectId: projectId,
  namespaceId: "maydan-catalog-test",
  allowDevMocks: false,
};

function entaAvailability(categoryKey = "canonical-sports"): CatalogAvailabilityRecord {
  const freshSelectionIds = ["revision-1", "revision-2"];
  const repeatSelectionIds = ["revision-3", "revision-4"];
  const freshSelectionHash = digest(freshSelectionIds.join(","));
  const repeatSelectionHash = digest(repeatSelectionIds.join(","));
  const freshSelectionSeed = 1;
  const repeatSelectionSeed = 2;
  const selectorVersion = ENTA_CLASSIC_SELECTOR_VERSION;
  return {
    engine: "ENTA", mode: "CLASSIC", tier: "200", modality: "classic", selectorVersion,
    selectionManifestHash: digest([
      selectorVersion, categoryKey, "200", "classic", String(freshSelectionSeed), freshSelectionIds.join(","), freshSelectionHash,
      String(repeatSelectionSeed), repeatSelectionIds.join(","), repeatSelectionHash,
    ].join("\n")),
    freshSelectionHash, repeatSelectionHash, freshSelectionIds, repeatSelectionIds,
    freshSelectionSeed, repeatSelectionSeed, validatedAt: new Date("2026-10-02T00:00:00Z"),
  };
}

function activeRecord(): ActiveCatalogRecord {
  return {
    pointerReleaseId: "release-1",
    pointerRootHash: "a".repeat(64),
    pointerReceiptId: "receipt-1",
    releaseSealedAt: new Date("2026-10-02T00:00:00Z"),
    releaseId: "release-1",
    releaseRootHash: "a".repeat(64),
    validation: {
      id: "receipt-1", catalogReleaseId: "release-1", releaseRootHash: "a".repeat(64), sealHash: "b".repeat(64),
      validatorRef: "trusted-validator", policyVersion: "catalog-policy-v1", sourceEvidenceManifestHash: "c".repeat(64),
      selectorVersion: "catalog-validator-v1", huroofProjectId: null, huroofReleaseId: null, huroofRootSha256: null,
      huroofCapabilityStateHash: null, huroofSelectorAttestation: null,
    },
    sourceSnapshots: [{
      sourceNamespace: "enta.question", sourceReleaseId: "enta-snapshot-1", sourceRootSha256: "d".repeat(64), snapshotHash: "e".repeat(64),
    }, {
      sourceNamespace: "huroof.firestore", sourceReleaseId: "huroof-release-1", sourceRootSha256: "f".repeat(64), snapshotHash: "1".repeat(64),
    }],
    categories: [{
      categoryKey: "canonical-sports", labelAr: "رياضة", description: "وصف عام", editorialDecision: "APPROVED",
      availability: [entaAvailability()],
    }],
  };
}

const store = (record: ActiveCatalogRecord | null): CatalogStore => ({ async readActiveCatalog() { return record; } });
const huroofReader = (options: { project?: string; releaseId?: string; root?: string; error?: boolean } = {}): HuroofReleaseReader => ({
  projectId: options.project ?? projectId,
  purpose: "paid-readiness", expectedSelectorVersion: "huroof-selector-deployed-v1",
  expectedPolicyVersion: "huroof-policy-deployed-v1",
  async readActiveRelease() {
    if (options.error) throw new Error("unavailable");
    return {
      projectId: options.project ?? projectId,
      releaseId: options.releaseId ?? "huroof-release-1",
      rootSha256: options.root ?? "f".repeat(64),
      approvedCount: 0,
      categoryInventory: [],
      inventoryHash: digest(""),
      capabilityStateHash: digest(""),
      capabilityFlags: {},
    };
  },
});

test("public catalog exposes only sealed, receipt-backed Enta availability", async () => {
  const record = activeRecord() as ActiveCatalogRecord & Record<string, unknown>;
  (record.categories[0] as unknown as Record<string, unknown>).prompt = "secret prompt";
  (record.categories[0] as unknown as Record<string, unknown>).answer = "secret answer";
  (record.categories[0] as unknown as Record<string, unknown>).sourceQuestionId = "private-source-id";
  (record.categories[0] as unknown as Record<string, unknown>).correctIndex = 4;
  const dto = await readPublicCatalog({ store: store(record), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId });
  assert.equal(dto.sources.enta.available, true);
  assert.deepEqual(dto.sources.huroof, { available: false });
  assert.deepEqual(dto.categories[0].availability, [
    { engine: "ENTA", mode: "CLASSIC", tier: "200", modality: "classic" },
  ]);
  const serialized = JSON.stringify(dto);
  for (const forbidden of ["prompt", "answer", "correctIndex", "sourceQuestionId", "rawCount", "objectKey", "private-source-id", "revision-1"]) {
    assert.equal(serialized.includes(forbidden), false, `public DTO leaked ${forbidden}`);
  }
});

test("hash-shaped snapshots or fabricated selectors do not advertise content", async () => {
  const record = activeRecord();
  record.categories[0].availability = [{
    ...entaAvailability(), selectorVersion: "invented-v99", selectionManifestHash: "a".repeat(64),
    freshSelectionIds: [], repeatSelectionIds: [], freshSelectionHash: "b".repeat(64), repeatSelectionHash: "c".repeat(64),
  }];
  const dto = await readPublicCatalog({ store: store(record), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId });
  assert.deepEqual(dto.sources.enta, { available: false });
  assert.deepEqual(dto.sources.huroof, { available: false });
  assert.deepEqual(dto.categories[0].availability, []);
});

test("Huroof availability fails closed on wrong project, stale root, or unavailable source", async () => {
  for (const reader of [
    huroofReader({ project: "foreign-firebase-project" }),
    huroofReader({ root: "2".repeat(64) }),
    huroofReader({ error: true }),
  ]) {
    const dto = await readPublicCatalog({ store: store(activeRecord()), huroofReader: reader, expectedFirebaseProjectId: projectId });
    assert.deepEqual(dto.sources.huroof, { available: false });
    assert.deepEqual(dto.categories[0].availability, [{ engine: "ENTA", mode: "CLASSIC", tier: "200", modality: "classic" }]);
  }
});

test("pointer must bind the exact receipt, release root and seal", async () => {
  for (const change of [
    (record: ActiveCatalogRecord) => { record.pointerRootHash = "2".repeat(64); },
    (record: ActiveCatalogRecord) => { record.pointerReceiptId = "other-receipt"; },
    (record: ActiveCatalogRecord) => { record.validation.releaseRootHash = "3".repeat(64); },
    (record: ActiveCatalogRecord) => { record.releaseSealedAt = null; },
  ]) {
    const record = activeRecord();
    change(record);
    await assert.rejects(() => readPublicCatalog({ store: store(record), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId }), /CATALOG_UNAVAILABLE/);
  }
  await assert.rejects(() => readPublicCatalog({ store: store(null), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId }), /CATALOG_UNAVAILABLE/);
});

test("unmounted catalog router returns safe receipt-backed JSON", async (t) => {
  const app = express();
  app.use("/api/v1/catalog", createCatalogRouter({ store: store(activeRecord()), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/catalog`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json() as { sources: { huroof: { available: boolean }; enta: { available: boolean } } };
  assert.equal(body.sources.enta.available, true);
  assert.equal(body.sources.huroof.available, false);
});

test("unmounted catalog router fails closed on missing pointer without surfacing errors", async (t) => {
  const app = express();
  app.use("/api/v1/catalog", createCatalogRouter({ store: store(null), huroofReader: huroofReader(), expectedFirebaseProjectId: projectId }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/catalog`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "CATALOG_UNAVAILABLE" });
});

test("production app still returns JSON 404 for unmounted catalog route", async (t) => {
  const identityStore: IdentityStore = {
    async assertDeploymentNamespace() {},
    async upsertIdentity() {},
    async getAdminScopes() { return []; },
  };
  const app = createApp({ config, verifyIdToken: async () => { throw new Error("unused"); }, identityStore });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/catalog`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
});

test("migration pins complete releases, locks seal/child races, and isolates privileged roles", async () => {
  const sql = await readFile(resolve(process.cwd(), "services/enta/server/prisma/migrations/20261002130000_immutable_catalog_revisions/migration.sql"), "utf8");
  assert.match(sql, /GameQuestion_catalogReleaseId_questionRevisionId_fkey[\s\S]*?ON DELETE RESTRICT/);
  assert.match(sql, /QuestionRevisionSeal[\s\S]*?CatalogReleaseSeal[\s\S]*?CatalogValidationReceipt/);
  assert.match(sql, /int4_lock_question_child/);
  assert.match(sql, /int4_lock_release_child/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /seal_question_revision\(p_revision_id TEXT\)/);
  assert.match(sql, /seal_catalog_release\(p_release_id TEXT\)/);
  assert.match(sql, /issue_catalog_validation_receipt/);
  assert.match(sql, /activate_catalog_release/);
  assert.match(sql, /search_path = pg_catalog, int4_crypto/);
  assert.match(sql, /catalog publisher role required/);
  assert.match(sql, /trusted catalog validator role required/);
  assert.match(sql, /catalog activator role required/);
  assert.match(sql, /LegacyUnpinnedGame/);
  assert.match(sql, /GameQuestion_parent_pin_guard/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /CREATE TABLE "QuestionRevision" \([\s\S]*?"sealedAt" TIMESTAMP\(3\)/);
  assert.match(sql, /int4_lock_question_child\(\) RETURNS trigger\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto/);
  assert.match(sql, /int4_lock_release_child\(\) RETURNS trigger\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto/);
  assert.match(sql, /int4_game_pin_guard\(\) RETURNS trigger\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto/);
  assert.match(sql, /int4_game_pin_completeness\(\) RETURNS trigger\s+LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, int4_crypto/);
  assert.doesNotMatch(sql, /search_path = pg_catalog, public/);
  assert.doesNotMatch(sql, /'QuestionRevision',[\s\S]{0,220}'QuestionAnswerRevision'/);
  assert.doesNotMatch(sql, /'CatalogRelease',[\s\S]{0,220}'CatalogReleaseSourceSnapshot'/);
  assert.match(sql, /'catalogReleaseId',next_row\."catalogReleaseId"/);
  assert.match(sql, /'releaseRootHash',next_row\."releaseRootHash"/);
  assert.match(sql, /int4_crypto[\s\S]*?only the owner may have CREATE on int4_crypto/);
  assert.match(sql, /UPDATE public\."CatalogRelease" SET "releaseRootHash"=root_hash,"sealedAt"=clock_timestamp\(\)/);
  assert.match(sql, /ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED/);
  assert.doesNotMatch(sql, /Game_id_catalogReleaseId_key|GameQuestion_gameId_catalogReleaseId_fkey|CREATE ROLE/);
  const provisioning = await readFile(resolve(process.cwd(), "services/enta/server/prisma/roles/int4_publication_roles.sql"), "utf8");
  assert.match(provisioning, /CREATE ROLE catalog_validator NOLOGIN/);
  assert.match(provisioning, /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA int4_crypto/);
  assert.match(provisioning, /ALTER EXTENSION pgcrypto SET SCHEMA int4_crypto/);
  assert.match(sql, /roles must be provisioned by the database owner/);
});

test("R3 validator grants are limited to reviewed proof reads and payload helpers", async () => {
  const sql = await readFile(resolve(process.cwd(), "services/enta/server/prisma/migrations/20261002140000_catalog_validator_read_access/migration.sql"), "utf8");
  assert.match(sql, /GRANT SELECT ON TABLE[\s\S]*?public\."CatalogValidationReceipt"\s+TO catalog_validator;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*?public\.int4_release_payload\(TEXT\)\s+TO catalog_validator;/);
  assert.equal((sql.match(/public\."/g) ?? []).length, 16);
  assert.equal((sql.match(/public\.int4_[a-z_]+\(TEXT/g) ?? []).length, 4);
  assert.match(sql, /int4_question_child_manifest\(TEXT,TEXT\)/);
  assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|TRUNCATE|ActiveCatalogPointer|Game"/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER|TO PUBLIC|GRANT ALL/i);
});
