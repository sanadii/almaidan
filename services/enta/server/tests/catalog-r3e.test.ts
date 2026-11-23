import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  hashR3eDatabaseHelperDefinitions,
  hashR3ePackagedRuntimeBuildIdentity,
  measureR3eRuntimeIdentity,
  type R3eDatabaseHelperDefinition,
} from "../src/catalog/r3e-runtime-identity";
import { verifyR3eIssuerTrust } from "../src/catalog/r3e-issuer-trust";
import { issueEntaR3eCatalogReceipt } from "../src/catalog/r3e-issuer";
import { packageManifestFileRecord } from "../src/catalog/r3e-issuer-cli";

const launcherBuild = createRequire(__filename)("../scripts/build-r3e-launcher.cjs") as {
  compilerDefines: (config: Record<string, string | number>) => string[];
  isCanonicalPackageRoot: (value: string) => boolean;
  isPackageChild: (value: string, packageRoot: string) => boolean;
  parsePinnedBuildConfig: (env: Record<string, string>) => Record<string, string | number>;
};
const packageManifestBuild = createRequire(__filename)("../scripts/build-r3e-package-manifest.cjs") as {
  validRelativePath: (value: string) => boolean;
};

test("R3-E package manifest path grammar rejects aliases and control characters", () => {
  for (const accepted of ["bin/node", "app/node_modules/@scope/package/index.js", "app/empty"]) {
    assert.equal(packageManifestBuild.validRelativePath(accepted), true, accepted);
  }
  for (const rejected of ["", "/etc/passwd", "../escape", "app/../escape", "app/./module", "app//module", "app\\module", "app\t/module", "app/\u0001bad"]) {
    assert.equal(packageManifestBuild.validRelativePath(rejected), false, JSON.stringify(rejected));
  }
});

test("R3-E issuer policy parser requires the exact package manifest file record", () => {
  const policyPath = "/opt/enta-r3e/releases/test-v1/policy/issuer-runtime.conf";
  const digest = "a".repeat(64);
  const manifest = `R3E-PACKAGE-V2\nF\t${digest}\t${policyPath}\n`;
  assert.equal(packageManifestFileRecord(manifest, digest, policyPath), true);
  assert.equal(packageManifestFileRecord(`R3E-PACKAGE-V2\n${digest}\t${policyPath}\n`, digest, policyPath), false);
  assert.equal(packageManifestFileRecord(manifest, "b".repeat(64), policyPath), false);
  assert.equal(packageManifestFileRecord(manifest, digest, `${policyPath}?x=1`), false);
});

test("R3-E issuer loads and measures its package closure before reading the DB credential", async () => {
  const source = await readFile(resolve(process.cwd(), "services/enta/server/src/catalog/r3e-issuer-cli.ts"), "utf8");
  const prismaLoad = source.indexOf('packageRequire("@prisma/client")');
  const issuerLoad = source.indexOf('packageRequire("./r3e-issuer")');
  const nativeEngineLoad = source.indexOf('packageRequire(enginePaths[0])');
  const measurement = source.indexOf("tracker?.measureExecution()");
  const packagedMeasurement = source.indexOf("preCredentialPackageClosure = measureR3ePackagedRuntimeClosure()");
  const credentialRead = source.indexOf("readDatabaseCredential()", source.indexOf("export async function runR3eIssuerCli"));
  assert.ok(prismaLoad >= 0 && issuerLoad > prismaLoad && nativeEngineLoad > issuerLoad && measurement > nativeEngineLoad &&
    packagedMeasurement > measurement && credentialRead > packagedMeasurement);
  assert.match(source, /preCredentialPackageClosure\.executionSha256 !== preCredentialMeasurement\.sha256/);
  assert.match(source, /preCredentialPackageClosure\.packageManifestSha256 !== context\.manifestSha256/);
  assert.match(source, /packageFilesUnder\("node_modules\/\.prisma\/client", "\.so\.node"\)/);
  assert.match(source, /R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED/);
  assert.match(source, /preCredentialClosureStillPresent\(preCredentialMeasurement, postCredentialMeasurement\)/);
});

test("R3-E packaged runtime identity avoids repository discovery and binds mapped native files", async () => {
  const [runtime, tracker] = await Promise.all([
    readFile(resolve(process.cwd(), "services/enta/server/src/catalog/r3e-runtime-identity.ts"), "utf8"),
    readFile(resolve(process.cwd(), "services/enta/server/src/catalog/r3e-module-tracker.mjs"), "utf8"),
  ]);
  assert.match(runtime, /enta-r3e-packaged-runtime-closure-v3/);
  assert.match(runtime, /hashR3ePackagedRuntimeBuildIdentity\(launch\.manifestSha256, launchContext\)/);
  assert.doesNotMatch(runtime, /executionSha256:\s*execution\.sha256,[\s\S]{0,120}launchContext/);
  assert.match(runtime, /execution\.nativeMappings\.length === 0/);
  assert.match(runtime, /if \(launch && process\.platform === "linux"\)/);
  assert.match(tracker, /readMappedFiles\(\)/);
  assert.match(tracker, /verifyMappedFileBytes\(mappings\)/);
  assert.match(tracker, /R3E_EXECUTABLE_CLOSURE_INVALID/);
  assert.match(tracker, /nativeMappings: verifiedMappings/);
});

test("R3-E package build identity is full-manifest based, not a per-run loaded-subset digest", () => {
  const launch = Object.freeze({ launcherSha256: "a".repeat(64), nodeSha256: "b".repeat(64), packageEntryCount: 42 });
  const manifest = "c".repeat(64);
  const firstBuildIdentity = hashR3ePackagedRuntimeBuildIdentity(manifest, launch);
  const expected = createHash("sha256").update(JSON.stringify({
    version: "enta-r3e-packaged-runtime-closure-v3",
    packageManifestSha256: manifest,
    launchContext: launch,
  }), "utf8").digest("hex");
  assert.equal(firstBuildIdentity, expected);
  assert.notEqual(hashR3ePackagedRuntimeBuildIdentity("f".repeat(64), launch), firstBuildIdentity);
  assert.notEqual(hashR3ePackagedRuntimeBuildIdentity(manifest, { ...launch, launcherSha256: "0".repeat(64) }), firstBuildIdentity);
  assert.throws(() => hashR3ePackagedRuntimeBuildIdentity("not-a-digest", launch), /R3E_RUNTIME_CLOSURE_INVALID/);
});

const validLauncherBuildEnv = (): Record<string, string> => ({
  ENTA_R3E_ISSUER_UID: "999",
  ENTA_R3E_ISSUER_GID: "999",
  ENTA_R3E_EXPECTED_CGROUP: "/system.slice/enta-r3e-issuer.service",
  ENTA_R3E_PACKAGE_ROOT: "/opt/enta-r3e/releases/test-v1",
  ENTA_R3E_MANIFEST_PATH: "/opt/enta-r3e/releases/test-v1/package.manifest",
  ENTA_R3E_MANIFEST_SHA256: "a".repeat(64),
  ENTA_R3E_NODE_PATH: "/opt/enta-r3e/releases/test-v1/bin/node",
  ENTA_R3E_CLI_PATH: "/opt/enta-r3e/releases/test-v1/app/cli.cjs",
  ENTA_R3E_BOOTSTRAP_PATH: "/opt/enta-r3e/releases/test-v1/app/bootstrap/r3e-module-tracker.mjs",
  ENTA_R3E_HELPER_PATH: "/opt/enta-r3e/releases/test-v1/app/native/custody",
  ENTA_R3E_LOADER_PATH: "/opt/enta-r3e/releases/test-v1/lib/ld-linux-x86-64.so.2",
  ENTA_R3E_LIBRARY_PATH: "/opt/enta-r3e/releases/test-v1/lib",
  ENTA_R3E_LAUNCHER_PATH: "/opt/enta-r3e/releases/test-v1/bin/r3e-issuer-launcher",
});

test("R3-E launcher build validates package root independently and emits numeric identity defines", () => {
  const env = validLauncherBuildEnv();
  const config = launcherBuild.parsePinnedBuildConfig(env);
  assert.equal(config.packageRoot, "/opt/enta-r3e/releases/test-v1");
  assert.equal(config.issuerUid, 999);
  assert.equal(config.issuerGid, 999);
  const defines = launcherBuild.compilerDefines(config);
  assert.ok(defines.includes("-DR3E_ISSUER_UID=999"));
  assert.ok(defines.includes("-DR3E_ISSUER_GID=999"));
  assert.ok(!defines.includes('-DR3E_ISSUER_UID="999"'));
  assert.ok(defines.includes('-DR3E_PACKAGE_ROOT="/opt/enta-r3e/releases/test-v1"'));
  assert.ok(defines.includes('-DR3E_BOOTSTRAP_PATH="/opt/enta-r3e/releases/test-v1/app/bootstrap/r3e-module-tracker.mjs"'));
});

test("R3-E launcher build rejects dot aliases, noncanonical roots, escapes, and invalid numeric pins", () => {
  assert.equal(launcherBuild.isCanonicalPackageRoot("/opt/enta-r3e/releases/test-v1"), true);
  for (const root of ["/", "/opt/enta-r3e/../release", "/opt/enta-r3e/./release", "/opt//release", "/opt/release/"]) {
    assert.equal(launcherBuild.isCanonicalPackageRoot(root), false, root);
  }
  for (const child of [
    "/opt/enta-r3e/releases/test-v1/../bin/node",
    "/opt/enta-r3e/releases/test-v1/./bin/node",
    "/opt/enta-r3e/releases/test-v1//bin/node",
    "/opt/enta-r3e/releases/test-v1x/bin/node",
    "/opt/other/bin/node",
  ]) assert.equal(launcherBuild.isPackageChild(child, "/opt/enta-r3e/releases/test-v1"), false, child);

  for (const [key, value] of [
    ["ENTA_R3E_PACKAGE_ROOT", "/opt/enta-r3e/releases/../release"],
    ["ENTA_R3E_NODE_PATH", "/opt/enta-r3e/releases/test-v1/../node"],
    ["ENTA_R3E_ISSUER_UID", "0999"],
    ["ENTA_R3E_ISSUER_GID", "4294967295"],
  ]) {
    const env = validLauncherBuildEnv();
    env[key] = value;
    assert.throws(() => launcherBuild.parsePinnedBuildConfig(env), /R3-E release pins/);
  }
});

const helpers: R3eDatabaseHelperDefinition[] = [
  { identityArguments: "", name: "block_r3e_catalog_activation", source: "CREATE FUNCTION public.block_r3e_catalog_activation() ..." },
  { identityArguments: "text", name: "int4_category_payload", source: "CREATE FUNCTION public.int4_category_payload(text) ..." },
  { identityArguments: "text, text", name: "int4_question_child_manifest", source: "CREATE FUNCTION public.int4_question_child_manifest(text, text) ..." },
  { identityArguments: "text", name: "int4_question_payload", source: "CREATE FUNCTION public.int4_question_payload(text) ..." },
  { identityArguments: "text", name: "int4_release_payload", source: "CREATE FUNCTION public.int4_release_payload(text) ..." },
  { identityArguments: "bytea, text", name: "int4_crypto.digest", source: "CREATE FUNCTION int4_crypto.digest(bytea, text) ..." },
  { identityArguments: "text, text, text, text, text, text, text, text, text, text, text", name: "issue_catalog_validation_receipt", source: "CREATE FUNCTION public.issue_catalog_validation_receipt(...) ..." },
  { identityArguments: "text, text, text, text, text, text, text, text, text, text, text, text, text", name: "issue_r3e_catalog_receipt", source: "CREATE FUNCTION public.issue_r3e_catalog_receipt(...) ..." },
  { identityArguments: "", name: "reject_immutable_catalog_mutation", source: "CREATE FUNCTION public.reject_immutable_catalog_mutation() ..." },
  { identityArguments: "", name: "reject_r3e_direct_proof_insert", source: "CREATE FUNCTION public.reject_r3e_direct_proof_insert() ..." },
  { identityArguments: "", name: "require_r3e_proof_for_successor_receipt", source: "CREATE FUNCTION public.require_r3e_proof_for_successor_receipt() ..." },
];

test("R3-E helper identity requires the complete exact helper set and is order independent", () => {
  const original = hashR3eDatabaseHelperDefinitions(helpers);
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.equal(hashR3eDatabaseHelperDefinitions([...helpers].reverse()), original);
  assert.notEqual(hashR3eDatabaseHelperDefinitions(helpers.map((row, index) => index === 0 ? { ...row, source: `${row.source} altered` } : row)), original);
  assert.throws(() => hashR3eDatabaseHelperDefinitions(helpers.slice(0, -1)), /R3E_DATABASE_HELPER_SET_INVALID/);
  assert.throws(() => hashR3eDatabaseHelperDefinitions([...helpers, helpers[0]]), /R3E_DATABASE_HELPER_SET_INVALID/);
});

test("R3-E migration binds successor proof policy without changing historical receipt identity", async () => {
  const migrationPath = resolve(process.cwd(), "services/enta/server/prisma/migrations/20261002160000_r3e_private_issuer/migration.sql");
  const schemaPath = resolve(process.cwd(), "services/enta/server/prisma/schema.prisma");
  const [sql, schema] = await Promise.all([readFile(migrationPath, "utf8"), readFile(schemaPath, "utf8")]);
  const issueBody = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_r3e_catalog_receipt"), sql.indexOf("$$;\nALTER FUNCTION public.issue_r3e_catalog_receipt")).replace(/--.*$/gm, "");
  const legacyBody = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.issue_catalog_validation_receipt"), sql.indexOf("$$;\nCREATE OR REPLACE FUNCTION public.issue_r3e_catalog_receipt"));
  assert.match(sql, /CREATE UNIQUE INDEX "CatalogValidationReceipt_r3e_successor_identity_key"[\s\S]*?WHERE "policyVersion"='enta-r3e-private-issuer-v1'/);
  assert.doesNotMatch(schema.slice(schema.indexOf("model CatalogValidationReceipt"), schema.indexOf("model CatalogValidationProof")), /@@unique\(\[catalogReleaseId, releaseRootHash, sealHash, policyVersion\]/);
  assert.match(schema, /sourceSummarySha256\s+String/);
  assert.match(schema, /validatedAt\s+DateTime @db\.Timestamptz\(3\)/);
  assert.match(schema, /expiresAt\s+DateTime @db\.Timestamptz\(3\)/);
  assert.match(sql, /CatalogValidationReceipt_proof_unique" UNIQUE \("proofId"\)/);
  assert.match(sql, /CatalogValidationProof_reportSha256_id_key" UNIQUE \("reportSha256","id"\)/);
  assert.match(issueBody, /p_source_summary_sha256 TEXT/);
  assert.match(issueBody, /p_source_evidence_manifest_sha256 TEXT/);
  assert.match(issueBody, /p_source_summary_sha256/);
  assert.match(issueBody, /sourceEvidenceManifestSha256.*sourceEvidenceGenerationSha256.*sourceSummarySha256/s);
  assert.match(issueBody, /source_summary_sha256 IS DISTINCT FROM p_source_summary_sha256/);
  assert.match(issueBody, /p_source_evidence_manifest_sha256/);
  assert.doesNotMatch(issueBody, /FOR UPDATE/i);
  assert.match(issueBody, /pg_advisory_xact_lock/);
  assert.match(issueBody, /jsonb_typeof\(report_document->'sourceEvidenceExpiresAt'\) IS DISTINCT FROM 'string'/);
  assert.match(issueBody, /proof_expires_at IS DISTINCT FROM LEAST\(source_evidence_expires_at,trust_expires_at\)/);
  assert.match(legacyBody, /p_policy_version IS NULL OR NOT COALESCE\(p_policy_version = ANY/);
  assert.match(legacyBody, /enta-r3e-private-issuer-v1/);
  assert.match(legacyBody, /legacy receipt issuer is disabled by R3-E policy boundary/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.issue_catalog_validation_receipt\([\s\S]*?FROM PUBLIC, enta_runtime,[\s\S]*?enta_catalog_issuer_login/);
});

test("R3-E role transfer keeps one bootstrap edge around an exact custodian self-grant", async () => {
  const migrationPath = resolve(process.cwd(), "services/enta/server/prisma/migrations/20261002160000_r3e_private_issuer/migration.sql");
  const provisioningPath = resolve(process.cwd(), "services/enta/server/prisma/roles/r3e-issuer-provisioning.sql");
  const [sql, provisioning] = await Promise.all([readFile(migrationPath, "utf8"), readFile(provisioningPath, "utf8")]);
  const transferStart = sql.indexOf("-- Add a separate, self-granted SET edge");
  const transferEnd = sql.indexOf("GRANT SELECT ON TABLE", transferStart);
  const transfer = sql.slice(transferStart, transferEnd);
  assert.ok(transferStart >= 0 && transferEnd > transferStart);
  assert.match(provisioning, /session_user<>'enta_catalog_bootstrap_dba' OR current_user<>session_user/);
  assert.match(provisioning, /GRANT catalog_issuer TO enta_catalog_migration_custodian\s+WITH ADMIN OPTION, INHERIT FALSE, SET FALSE/);
  assert.match(sql, /session_user<>'enta_catalog_migration_custodian' OR current_user<>session_user/);
  assert.match(sql, /grantor_role\.rolname='enta_catalog_bootstrap_dba'.*m\.admin_option AND NOT m\.set_option AND NOT m\.inherit_option/s);
  assert.match(transfer, /GRANT catalog_issuer TO enta_catalog_migration_custodian WITH ADMIN FALSE, INHERIT FALSE, SET TRUE/);
  assert.match(transfer, /count\(\*\)[\s\S]*<>2[\s\S]*grantor_role\.rolname='enta_catalog_bootstrap_dba'[\s\S]*grantor_role\.rolname='enta_catalog_migration_custodian'/);
  assert.match(transfer, /REVOKE catalog_issuer FROM enta_catalog_migration_custodian GRANTED BY enta_catalog_migration_custodian RESTRICT/);
  assert.match(transfer, /count\(\*\)[\s\S]*<>1[\s\S]*grantor_role\.rolname='enta_catalog_bootstrap_dba'/);
  assert.match(transfer, /REVOKE CREATE ON SCHEMA public FROM catalog_issuer GRANTED BY enta_catalog_migration_custodian/);
  assert.match(transfer, /has_schema_privilege\('catalog_issuer','public','CREATE'\)/);
  assert.match(sql, /issuer login must have zero role membership edges/);
});
test("R3-E runtime identity measures executable closure and generated Prisma client/engine bytes", async () => {
  if (process.platform === "linux") {
    await assert.rejects(measureR3eRuntimeIdentity(helpers), /R3E_RUNTIME_CLOSURE_INVALID/);
    return;
  }
  const measured = await measureR3eRuntimeIdentity(helpers);
  assert.match(measured.buildSha256, /^[a-f0-9]{64}$/);
  assert.match(measured.databaseHelpersSha256, /^[a-f0-9]{64}$/);
  assert.equal(measured.nodeVersion, process.version);
  assert.equal(measured.platform, process.platform);
  assert.ok(measured.fileCount > 10, `expected actual loaded modules and generated Prisma files, got ${measured.fileCount}`);
});

test("R3-E native custody hashes opened bytes and binds source, evidence, trust, and runtime reads", async () => {
  const root = resolve(process.cwd(), "services/enta/server/src/catalog");
  const [nativeSource, adapter, issuer, trust, evidence, runtime] = await Promise.all([
    readFile(resolve(root, "native/r3e-custody.c"), "utf8"),
    readFile(resolve(root, "r3e-native-custody.ts"), "utf8"),
    readFile(resolve(root, "r3e-issuer.ts"), "utf8"),
    readFile(resolve(root, "r3e-issuer-trust.ts"), "utf8"),
    readFile(resolve(root, "independent-evidence.ts"), "utf8"),
    readFile(resolve(root, "r3e-runtime-identity.ts"), "utf8"),
  ]);
  assert.match(nativeSource, /sha256_open_file\(finalfd,\s*&st,\s*digest\)/);
  assert.match(nativeSource, /pread\(fd,\s*buffer,\s*request,\s*offset\)/);
  assert.match(nativeSource, /after\.st_ctim\.tv_nsec/);
  assert.match(nativeSource, /%u\\t%s\\n/);
  assert.match(adapter, /fields\.length !== 5/);
  assert.match(adapter, /fields\[4\]/);
  assert.match(issuer, /sha256\(bytes\) !== openedDigest/);
  assert.match(trust, /sha256\(bytes\) !== expectedDescriptorSha256/);
  assert.match(evidence, /verifyIndependentEntaEvidenceForIssuer/);
  assert.match(evidence, /sha256\(bytes\) !== descriptorSha256/);
  assert.match(runtime, /verifyR3eNativeCustody\(absolutePaths\)/);
  assert.match(runtime, /sha256\(bytes\) !== descriptorSha256/);
});

test("R3-E packaged custody helper is static for read-only RootImage execution", async () => {
  const builder = await readFile(resolve(process.cwd(), "services/enta/server/scripts/build-r3e-custody.cjs"), "utf8");
  const fixture = await readFile(resolve(process.cwd(), "services/enta/server/tests/fixtures/r3e-rootimage-launcher-smoke.sh"), "utf8");
  assert.match(builder, /"-static"/);
  assert.match(fixture, /readelf -l "\$PKG\/app\/native\/r3e-custody"[\s\S]*INTERP/);
});

test("R3-E launcher checks exhaustive package inventory, read-only image mounts, and hermetic loader flags", async () => {
  const source = await readFile(resolve(process.cwd(), "services/enta/server/src/catalog/native/r3e-issuer-launcher.c"), "utf8");
  const manifestBuilder = await readFile(resolve(process.cwd(), "services/enta/server/scripts/build-r3e-package-manifest.cjs"), "utf8");
  const fixture = await readFile(resolve(process.cwd(), "services/enta/server/tests/fixtures/r3e-rootimage-launcher-smoke.sh"), "utf8");
  assert.match(source, /R3E-PACKAGE-V2/);
  assert.match(source, /verify_package_tree\(package_fd/);
  assert.match(source, /inventory\.files \+ inventory\.directories != count/);
  assert.match(source, /verify_mount_topology\(\)/);
  assert.match(source, /statvfs\("\/"[\s\S]*ST_RDONLY/);
  assert.match(source, /RESOLVE_NO_XDEV/);
  assert.match(source, /"--inhibit-cache", "--glibc-hwcaps-mask", ""/);
  assert.match(source, /"--library-path", \(char \*\)R3E_LIBRARY_PATH/);
  assert.match(source, /"--import", \(char \*\)R3E_BOOTSTRAP_PATH/);
  assert.match(source, /static const allowed_mount mounts\[\]/);
  assert.match(source, /option_list_matches\(mount_options, policy->mount_allowed, policy->mount_required\)/);
  assert.doesNotMatch(source, /"\/home", "\/root", "\/tmp", "\/var\/tmp"/);
  assert.ok(manifestBuilder.includes("/\\((?:RPATH|RUNPATH)\\)/"));
  assert.match(manifestBuilder, /absolute or noncanonical DT_NEEDED denied/);
  assert.match(manifestBuilder, /ELF_LIBRARY_DIR = "lib"/);
  assert.match(fixture, /NEGATIVE HOST_LIBRARY_FALLBACK_DENIED/);
  assert.match(fixture, /NEGATIVE ELF_%s_DENIED/);
  assert.match(fixture, /enable-new-dtags/);
  assert.match(fixture, /NEGATIVE PACKAGE_BIND_MOUNT_DENIED/);
});

test("R3-E protected image pins and runs the actual CLI bundle from its descriptor", async () => {
  const fixture = await readFile(resolve(process.cwd(), "services/enta/server/tests/fixtures/r3e-rootimage-launcher-smoke.sh"), "utf8");
  assert.match(fixture, /CLI_PATH="\$PKG\/app\/r3e-issuer-cli\.bundle\.cjs"/);
  assert.match(fixture, /EXPECTED_CLI_RECORD=\$\(printf 'F\\t%s\\t%s'/);
  assert.match(fixture, /POSITIVE DIRECT_PINNED_BUNDLE_PRE_CREDENTIAL/);
  assert.match(fixture, /R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED/);
  assert.match(fixture, /R3E_ISSUER_UNAVAILABLE:R3E_DATABASE_CREDENTIAL_UNAVAILABLE/);
  assert.match(fixture, /NEGATIVE DIRECT_BUNDLE_NODE_OPTIONS_DENIED/);
  assert.match(fixture, /NEGATIVE DIRECT_BUNDLE_PACKAGE_BIND_MOUNT_DENIED/);
  assert.match(fixture, /NEGATIVE DIRECT_BUNDLE_UNLISTED_ESM_DENIED/);
  assert.match(fixture, /DIRECT_RECEIPT=.*prelaunch-receipt-direct-positive\.sha256/);
  assert.match(fixture, /! grep -q '\^LoadCredential' "\$UNIT_FILE"/);
});

test("R3-E trust reports missing operator configuration and cannot issue without a native custody adapter", async () => {
  const original = {
    manifest: process.env.ENTA_R3E_MANIFEST_SHA256,
    anchor: process.env.ENTA_R3E_TRUST_ANCHOR_PATH,
    revocations: process.env.ENTA_R3E_REVOCATIONS_PATH,
    registry: process.env.ENTA_R3E_REGISTRY_DIR,
  };
  delete process.env.ENTA_R3E_MANIFEST_SHA256;
  delete process.env.ENTA_R3E_TRUST_ANCHOR_PATH;
  delete process.env.ENTA_R3E_REVOCATIONS_PATH;
  delete process.env.ENTA_R3E_REGISTRY_DIR;
  try {
    const result = await verifyR3eIssuerTrust({
      binding: {
        catalogReleaseId: "synthetic-only",
        releaseRootHash: "a".repeat(64),
        sourceNamespace: "enta.question",
        sourceReleaseId: "synthetic-only",
        sourceRootSha256: "b".repeat(64),
        sourceBytesSha256: "b".repeat(64),
        snapshotHash: "c".repeat(64),
        selectorVersion: "enta-curated-classic-tier-v2",
        selectorBuildId: "enta-curated-classic-tier-v2+stored-seed-replay-v1",
      },
      runtimeIdentity: {
        buildSha256: "d".repeat(64), databaseHelpersSha256: "e".repeat(64), nodeVersion: process.version,
        platform: process.platform, architecture: process.arch, fileCount: 1,
      },
      sourceEvidenceManifestSha256: "f".repeat(64),
      sourceEvidenceGenerationSha256: "0".repeat(64),
    });
    assert.deepEqual(result, { status: "unavailable", reasonCode: "R3E_TRUST_CONFIG_MISSING" });
    process.env.ENTA_R3E_MANIFEST_SHA256 = "1".repeat(64);
    process.env.ENTA_R3E_TRUST_ANCHOR_PATH = "C:\\synthetic\\anchor.json";
    process.env.ENTA_R3E_REVOCATIONS_PATH = "C:\\synthetic\\revocations.json";
    process.env.ENTA_R3E_REGISTRY_DIR = "C:\\synthetic\\registry";
    const custody = await verifyR3eIssuerTrust({
      binding: {
        catalogReleaseId: "synthetic-only", releaseRootHash: "a".repeat(64), sourceNamespace: "enta.question",
        sourceReleaseId: "synthetic-only", sourceRootSha256: "b".repeat(64), sourceBytesSha256: "b".repeat(64),
        snapshotHash: "c".repeat(64), selectorVersion: "enta-curated-classic-tier-v2",
        selectorBuildId: "enta-curated-classic-tier-v2+stored-seed-replay-v1",
      },
      runtimeIdentity: {
        buildSha256: "d".repeat(64), databaseHelpersSha256: "e".repeat(64), nodeVersion: process.version,
        platform: process.platform, architecture: process.arch, fileCount: 1,
      },
      sourceEvidenceManifestSha256: "f".repeat(64), sourceEvidenceGenerationSha256: "0".repeat(64),
    });
    assert.deepEqual(custody, { status: "unavailable", reasonCode: "R3E_TRUST_CUSTODY_UNAVAILABLE" });
  } finally {
    for (const [name, value] of Object.entries({
      ENTA_R3E_MANIFEST_SHA256: original.manifest,
      ENTA_R3E_TRUST_ANCHOR_PATH: original.anchor,
      ENTA_R3E_REVOCATIONS_PATH: original.revocations,
      ENTA_R3E_REGISTRY_DIR: original.registry,
    })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("R3-E issuance refuses non-production process before touching a database client", async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const result = await issueEntaR3eCatalogReceipt({} as never, "synthetic-only");
    assert.deepEqual(result, { status: "unavailable", reasonCode: "R3E_PRODUCTION_ISSUER_REQUIRED" });
  } finally {
    if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original;
  }
});

test("R3-E production issuance fails closed without a validated native launch context", async () => {
  const original = { nodeEnv: process.env.NODE_ENV, context: process.env.MAYDAN_R3E_CONTEXT };
  process.env.NODE_ENV = "production";
  delete process.env.MAYDAN_R3E_CONTEXT;
  try {
    const result = await issueEntaR3eCatalogReceipt({} as never, "synthetic-only");
    assert.deepEqual(result, { status: "unavailable", reasonCode: "R3E_LAUNCH_CONTEXT_REQUIRED" });
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.context === undefined) delete process.env.MAYDAN_R3E_CONTEXT; else process.env.MAYDAN_R3E_CONTEXT = original.context;
  }
});
