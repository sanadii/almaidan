import { createHash } from "node:crypto";
import { open, lstat, realpath, readdir } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";
import { verifyR3eNativeCustody } from "./r3e-native-custody";
import { getValidatedR3eIssuerLaunch, r3eLaunchIdentity } from "./r3e-launch-context";

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_RUNTIME_FILE_BYTES = 128 * 1024 * 1024;
const MAX_RUNTIME_FILES = 12_000;
const REQUIRED_DB_HELPERS = new Set([
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

export interface R3eDatabaseHelperDefinition {
  identityArguments: string;
  name: string;
  source: string;
}

export interface R3eRuntimeIdentity {
  buildSha256: string;
  databaseHelpersSha256: string;
  nodeVersion: string;
  platform: string;
  architecture: string;
  fileCount: number;
}

export interface R3ePackagedRuntimeClosure {
  /** Full approved package/deployment identity; independent of what one run loads. */
  buildSha256: string;
  /** Observed loaded closure for this invocation; never part of buildSha256. */
  executionSha256: string;
  packageManifestSha256: string;
  fileCount: number;
}

export class R3eRuntimeIdentityError extends Error {
  constructor(readonly reasonCode: "R3E_RUNTIME_CLOSURE_INVALID" | "R3E_DATABASE_HELPER_SET_INVALID") {
    super(reasonCode);
    this.name = "R3eRuntimeIdentityError";
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function readStableRegularFile(filePath: string, descriptorSha256?: string): Promise<Buffer> {
  const absolute = path.resolve(filePath);
  let canonical: string;
  let before: Awaited<ReturnType<typeof lstat>>;
  try {
    before = await lstat(absolute);
    canonical = await realpath(absolute);
  } catch {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  if (!samePath(absolute, canonical) || before.isSymbolicLink() || !before.isFile() || before.size < 0 || before.size > MAX_RUNTIME_FILE_BYTES) {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== before.size || opened.size > MAX_RUNTIME_FILE_BYTES) {
      throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        (descriptorSha256 !== undefined && sha256(bytes) !== descriptorSha256)) {
      throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function assertNoReparseAncestors(target: string, boundary: string): Promise<void> {
  const absoluteTarget = path.resolve(target);
  const absoluteBoundary = path.resolve(boundary);
  const relative = path.relative(absoluteBoundary, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");

  let current = absoluteBoundary;
  const boundaryStat = await lstat(current).catch(() => undefined);
  const boundaryReal = await realpath(current).catch(() => undefined);
  if (!boundaryStat?.isDirectory() || boundaryStat.isSymbolicLink() || !boundaryReal || !samePath(current, boundaryReal)) {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  for (const segment of relative.split(path.sep).filter(Boolean).slice(0, -1)) {
    current = path.join(current, segment);
    const stat = await lstat(current).catch(() => undefined);
    const real = await realpath(current).catch(() => undefined);
    if (!stat?.isDirectory() || stat.isSymbolicLink() || !real || !samePath(current, real)) {
      throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    }
  }
}

async function walkRegularTree(root: string, boundary: string): Promise<string[]> {
  const rootStat = await lstat(root).catch(() => undefined);
  const rootReal = await realpath(root).catch(() => undefined);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || !rootReal || !samePath(root, rootReal)) {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const item = path.join(directory, entry.name);
      await assertNoReparseAncestors(item, boundary);
      const stat = await lstat(item);
      if (stat.isSymbolicLink()) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
      if (stat.isDirectory()) await visit(item);
      else if (stat.isFile()) found.push(item);
      else throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
      if (found.length > MAX_RUNTIME_FILES) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    }
  };
  await visit(root);
  return found;
}

function workspaceRoot(): string {
  let current = path.resolve(__dirname);
  for (;;) {
    if (require("node:fs").existsSync(path.join(current, "package-lock.json")) &&
        require("node:fs").existsSync(path.join(current, "services", "enta", "server", "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    current = parent;
  }
}

function executedModuleClosure(): string[] {
  const entryPaths = [
    require.resolve("./r3e-runtime-identity"),
    require.resolve("./private-validator"),
    require.resolve("./postgres-evidence-reader"),
    require.resolve("./independent-evidence"),
    require.resolve("./selector-replay"),
    require.resolve("./selectors"),
    require.resolve("./source-artifact"),
    require.resolve("./r3e-issuer-trust"),
    require.resolve("./r3e-issuer"),
    require.resolve("./r3e-native-custody"),
  ];
  const seen = new Set<string>();
  const visit = (filename: string): void => {
    const resolved = path.resolve(filename);
    if (seen.has(resolved)) return;
    const moduleRecord = require.cache[resolved];
    if (!moduleRecord) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    seen.add(resolved);
    for (const child of moduleRecord.children) visit(child.filename);
  };
  for (const entry of entryPaths) visit(entry);
  return [...seen];
}

function loadedFileMappings(): string[] {
  const mappings = new Set<string>();
  let mapBytes: Buffer;
  try { mapBytes = require("node:fs").readFileSync("/proc/self/maps"); }
  catch { throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID"); }
  if (mapBytes.length > 1024 * 1024) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  let rows: string[];
  try { rows = new TextDecoder("utf-8", { fatal: true }).decode(mapBytes).split("\n"); }
  catch { throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID"); }
  for (const row of rows) {
    if (!row) continue;
    const fields = row.trim().split(/\s+/);
    const pathname = fields.length >= 6 ? fields.slice(5).join(" ") : "";
    if (!pathname.startsWith("/")) continue;
    if (pathname.endsWith(" (deleted)")) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    mappings.add(pathname);
    if (mappings.size > MAX_RUNTIME_FILES) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  return [...mappings].sort();
}

export function hashR3eDatabaseHelperDefinitions(input: readonly R3eDatabaseHelperDefinition[]): string {
  const definitions = input.map((item) => ({
    identityArguments: item.identityArguments.replace(/\s+/g, " ").trim(),
    name: item.name,
    source: item.source,
  })).sort((left, right) => `${left.name}(${left.identityArguments})`.localeCompare(`${right.name}(${right.identityArguments})`));
  const identities = definitions.map((item) => `${item.name}(${item.identityArguments})`);
  if (identities.length !== REQUIRED_DB_HELPERS.size || new Set(identities).size !== identities.length ||
      identities.some((identity) => !REQUIRED_DB_HELPERS.has(identity)) || definitions.some((item) => !item.source.trim())) {
    throw new R3eRuntimeIdentityError("R3E_DATABASE_HELPER_SET_INVALID");
  }
  return sha256(Buffer.from(JSON.stringify(definitions), "utf8"));
}

/** Hash the externally pinned full package identity, not the invocation's loaded subset. */
export function hashR3ePackagedRuntimeBuildIdentity(
  packageManifestSha256: string,
  launchContext: Readonly<Record<string, string | number>>,
): string {
  if (!SHA256.test(packageManifestSha256)) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  return sha256(Buffer.from(JSON.stringify({
    version: "enta-r3e-packaged-runtime-closure-v3",
    packageManifestSha256,
    launchContext,
  }), "utf8"));
}

/** Measure the launched package and actual mapped native files without DB data or credentials. */
export function measureR3ePackagedRuntimeClosure(): R3ePackagedRuntimeClosure {
  if (process.platform !== "linux") throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  const launch = getValidatedR3eIssuerLaunch();
  const trackerCandidate = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("maydan.r3e.module-tracker.v2")];
  if (!launch || !trackerCandidate || typeof trackerCandidate !== "object" ||
      typeof (trackerCandidate as { measureExecution?: unknown }).measureExecution !== "function") {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  const execution = (trackerCandidate as { measureExecution(): {
    sha256: string;
    modules: readonly unknown[];
    nativeMappings: readonly unknown[];
  } }).measureExecution();
  if (!SHA256.test(execution.sha256) || execution.modules.length === 0 || execution.nativeMappings.length === 0) {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  const launchContext = r3eLaunchIdentity(launch);
  const buildSha256 = hashR3ePackagedRuntimeBuildIdentity(launch.manifestSha256, launchContext);
  return Object.freeze({
    buildSha256,
    executionSha256: execution.sha256,
    packageManifestSha256: launch.manifestSha256,
    fileCount: execution.modules.length + execution.nativeMappings.length,
  });
}

/**
 * Measures the actual executed CommonJS closure plus generated Prisma client,
 * query engine, lock/config and Node executable bytes. It is descriptive until
 * compared with the operator-signed R3-E trust manifest.
 */
export async function measureR3eRuntimeIdentity(
  databaseHelpers: readonly R3eDatabaseHelperDefinition[],
): Promise<R3eRuntimeIdentity> {
  const launch = process.platform === "linux" ? getValidatedR3eIssuerLaunch() : undefined;
  if (process.platform === "linux" && !launch) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  const launchContext = launch ? r3eLaunchIdentity(launch) : undefined;
  if (launch && process.platform === "linux") {
    const execution = measureR3ePackagedRuntimeClosure();
    const databaseHelpersSha256 = hashR3eDatabaseHelperDefinitions(databaseHelpers);
    const buildSha256 = sha256(Buffer.from(JSON.stringify({
      version: "enta-r3e-database-bound-runtime-v2",
      packageRuntimeBuildSha256: execution.buildSha256,
      databaseHelpersSha256,
    }), "utf8"));
    return {
      buildSha256,
      databaseHelpersSha256,
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      fileCount: execution.fileCount,
    };
  }
  const root = workspaceRoot();
  const files = new Map<string, string>();
  const add = async (logicalName: string, filePath: string, allowedRoot = root): Promise<void> => {
    const absolute = path.resolve(filePath);
    await assertNoReparseAncestors(absolute, allowedRoot);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const key = samePath(absolute, root) || (!relative.startsWith("../") && !path.isAbsolute(relative))
      ? relative
      : logicalName;
    if (files.has(key)) return;
    files.set(key, absolute);
  };

  for (const filename of executedModuleClosure()) await add(filename, filename);
  if (launch) await add("node-runtime", launch.nodePath, launch.packageRoot);
  else await add("node-runtime", process.execPath, path.parse(process.execPath).root);
  await add(path.join("package-lock.json"), path.join(root, "package-lock.json"));
  await add(path.join("services", "enta", "server", "package.json"), path.join(root, "services", "enta", "server", "package.json"));
  await add("node_modules/@prisma/client/default.js", require.resolve("@prisma/client"));
  await add("node_modules/@prisma/client/runtime/library.js", require.resolve("@prisma/client/runtime/library"));
  const generatedClient = path.join(root, "node_modules", ".prisma", "client");
  const generatedFiles = await walkRegularTree(generatedClient, root);
  for (const filename of generatedFiles) await add(filename, filename);
  if (launch) {
    for (const filename of loadedFileMappings()) {
      await assertNoReparseAncestors(filename, launch.packageRoot);
      await add(filename, filename, launch.packageRoot);
    }
  }
  const nativeCustodyHelper = path.join(root, "services", "enta", "server", "dist", "catalog", "native", "r3e-custody");
  if (existsSync(nativeCustodyHelper)) await add(nativeCustodyHelper, nativeCustodyHelper);
  else if (process.platform === "linux") throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");

  const databaseHelpersSha256 = hashR3eDatabaseHelperDefinitions(databaseHelpers);
  const orderedPaths = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
  const absolutePaths = orderedPaths.map(([, filePath]) => filePath);
  const nativeBefore = process.platform === "linux" ? await verifyR3eNativeCustody(absolutePaths) : undefined;
  if (process.platform === "linux" && nativeBefore?.status !== "verified") {
    throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
  }
  const orderedFiles: Array<[string, string]> = [];
  for (const [logicalName, filePath] of orderedPaths) {
    const expectedDigest = nativeBefore?.status === "verified"
      ? nativeBefore.snapshot.fileSha256.get(path.resolve(filePath))
      : undefined;
    if (process.platform === "linux" && !expectedDigest) throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    const bytes = await readStableRegularFile(filePath, expectedDigest);
    orderedFiles.push([logicalName, sha256(bytes)]);
  }
  if (nativeBefore?.status === "verified") {
    const nativeAfter = await verifyR3eNativeCustody(absolutePaths);
    if (nativeAfter.status !== "verified" || nativeAfter.snapshot.metadataSha256 !== nativeBefore.snapshot.metadataSha256 ||
        absolutePaths.some((filePath) => nativeAfter.snapshot.fileSha256.get(path.resolve(filePath)) !== nativeBefore.snapshot.fileSha256.get(path.resolve(filePath)))) {
      throw new R3eRuntimeIdentityError("R3E_RUNTIME_CLOSURE_INVALID");
    }
  }
  const buildMaterial = {
    version: "enta-r3e-executed-closure-v1",
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    databaseHelpersSha256,
    launchContext,
    files: orderedFiles,
  };
  return {
    buildSha256: sha256(Buffer.from(JSON.stringify(buildMaterial), "utf8")),
    databaseHelpersSha256,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    fileCount: orderedFiles.length,
  };
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
