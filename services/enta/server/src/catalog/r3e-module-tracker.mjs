import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import childProcess from "node:child_process";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CONTEXT_ENV = "MAYDAN_R3E_CONTEXT";
const TRACKER_SYMBOL = Symbol.for("maydan.r3e.module-tracker.v2");
const MAX_CONTEXT = 8192;
const MAX_MANIFEST = 4 * 1024 * 1024;
const MAX_FILES = 16_384;
const MAX_DIRS = 4_096;
const MAX_PATH = 4096;
const MAX_MODULE = 128 * 1024 * 1024;
const MAX_MAP_BYTES = 1024 * 1024;
const MAX_CUSTODY_BATCH = 255;
const SHA256 = /^[a-f0-9]{64}$/;
const DENIED_BUILTINS = new Set([
  "node:cluster",
  "node:worker_threads",
]);

function fail(reason = "R3E_EXECUTABLE_CLOSURE_INVALID") {
  throw new Error(reason);
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readExact(fd, maxBytes, expectedSha256) {
  const before = fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.size < 1n || before.size > BigInt(maxBytes) || before.uid !== 0n ||
      before.nlink !== 1n || (before.mode & 0o022n) !== 0n) fail();
  const bytes = readFileSync(fd);
  const after = fstatSync(fd, { bigint: true });
  if (BigInt(bytes.length) !== before.size || after.dev !== before.dev || after.ino !== before.ino ||
      after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
      (expectedSha256 && hash(bytes) !== expectedSha256)) fail();
  return bytes;
}

function readPinnedFile(filename, maxBytes, expectedSha256) {
  let fd;
  try {
    fd = openSync(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    return readExact(fd, maxBytes, expectedSha256);
  } catch {
    return fail();
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function linuxDeviceParts(device) {
  const major = ((device & 0x00000000000fff00n) >> 8n) | ((device & 0xfffff00000000000n) >> 32n);
  const minor = (device & 0xffn) | ((device & 0x00000ffffff00000n) >> 12n);
  return [major.toString(16), minor.toString(16)];
}

function readMappedFiles() {
  let bytes;
  try { bytes = readFileSync("/proc/self/maps"); } catch { return fail("R3E_RUNTIME_MAP_READ_FAILED"); }
  if (bytes.length > MAX_MAP_BYTES) return fail("R3E_RUNTIME_MAP_BOUNDS_FAILED");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("R3E_RUNTIME_MAP_ENCODING_FAILED"); }
  const mapped = new Map();
  for (const row of text.split("\n")) {
    if (!row) continue;
    const fields = row.trim().split(/\s+/);
    if (fields.length < 6) continue;
    const address = fields[0];
    const device = fields[3];
    const inodeText = fields[4];
    const pathname = fields.slice(5).join(" ");
    if (!pathname.startsWith("/")) continue;
    if (pathname.endsWith(" (deleted)") || !pathname.startsWith(`${context.packageRoot}/`) ||
        !/^[a-f0-9]+:[a-f0-9]+$/.test(device) || !/^(0|[1-9][0-9]*)$/.test(inodeText) ||
        !/^[a-f0-9]+-[a-f0-9]+$/.test(address)) return fail("R3E_RUNTIME_MAP_PATH_INVALID");
    const expected = expectedFiles.get(pathname);
    if (!expected) return fail("R3E_RUNTIME_MAP_NOT_IN_PACKAGE");
    let stat;
    try { stat = lstatSync(pathname, { bigint: true }); } catch { return fail("R3E_RUNTIME_MAP_STAT_FAILED"); }
    const [major, minor] = linuxDeviceParts(stat.dev);
    const actualDevice = `${major}:${minor}`;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== 0n || (stat.mode & 0o022n) !== 0n) {
      return fail("R3E_RUNTIME_MAP_FILE_POLICY_MISMATCH");
    }
    const normalizedDevice = device.split(":").map((part) => BigInt(`0x${part}`).toString(16)).join(":");
    if (normalizedDevice !== actualDevice) return fail("R3E_RUNTIME_MAP_DEVICE_MISMATCH");
    if (stat.ino.toString() !== inodeText) return fail("R3E_RUNTIME_MAP_INODE_MISMATCH");
    mapped.set(pathname, { address, digest: expected, device, inode: inodeText });
    if (mapped.size > MAX_FILES) return fail();
  }
  if (mapped.size === 0) return fail("R3E_RUNTIME_MAP_EMPTY");
  return [...mapped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function verifyMappedFileBytes(mappings) {
  const rows = [];
  for (let offset = 0; offset < mappings.length; offset += MAX_CUSTODY_BATCH) {
    const batch = mappings.slice(offset, offset + MAX_CUSTODY_BATCH);
    let result;
    try {
      result = checkedCustodySpawnSync(context.helperPath, batch.map(([filename]) => filename), {
        encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, shell: false,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch { return fail("R3E_NATIVE_MAP_CUSTODY_SPAWN_FAILED"); }
    if (result.error || result.status !== 0 || typeof result.stdout !== "string" || result.stdout.length > 64 * 1024) return fail();
    const lines = result.stdout.trimEnd().split("\n");
    const header = lines.shift()?.split("\t");
    if (!header || header.length !== 3 || header[0] !== "R3E-CUSTODY-V1" || !/^[1-9][0-9]*$/.test(header[1]) ||
        header[2] !== String(batch.length) || lines.length !== batch.length) return fail("R3E_NATIVE_MAP_CUSTODY_HEADER_INVALID");
    for (let index = 0; index < batch.length; index += 1) {
      const fields = lines[index].split("\t");
      const [filename, identity] = batch[index];
      const expected = identity.digest;
      if (fields.length !== 5 || !/^(0|[1-9][0-9]*)$/.test(fields[0]) || !/^(0|[1-9][0-9]*)$/.test(fields[1]) ||
          !/^(0|[1-9][0-9]*)$/.test(fields[2]) || !/^(0|[1-9][0-9]*)$/.test(fields[3])) return fail("R3E_NATIVE_MAP_CUSTODY_ROW_INVALID");
      if (fields[4] !== expected) {
        const kind = filename.includes("/.prisma/client/libquery_engine-") ? "ENGINE" :
          filename.includes("/lib/") ? "LIBRARY" : filename.endsWith("/bin/node") ? "NODE" : "APP";
        return fail(`R3E_NATIVE_MAP_CUSTODY_DIGEST_MISMATCH_${kind}`);
      }
      rows.push(Object.freeze([filename, expected, fields[0], fields[1]]));
    }
  }
  return rows;
}

function parseLaunchContext(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_CONTEXT || !raw.endsWith("\n") || raw.includes("\r")) fail();
  const lines = raw.split("\n");
  if (lines.pop() !== "" || lines.length !== 21 || lines[0] !== "R3E-ISSUER-LAUNCH-V2") fail();
  const fields = lines.slice(1);
  const [releaseId, invocationId, launcherPath, launcherSha256, nodePath, nodeSha256, cliPath, cliSha256,
    bootstrapPath, bootstrapSha256, helperPath, helperSha256, loaderPath, loaderSha256, manifestPath,
    manifestSha256, packageRoot, issuerUidText, issuerGidText, entryCountText] = fields;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(releaseId) || !/^[a-f0-9]{32}$/.test(invocationId) ||
      !path.posix.isAbsolute(packageRoot) || path.posix.normalize(packageRoot) !== packageRoot || packageRoot.endsWith("/")) fail();
  for (const pathname of [launcherPath, nodePath, cliPath, bootstrapPath, helperPath, loaderPath, manifestPath]) {
    if (pathname.length > MAX_PATH || !pathname.startsWith(`${packageRoot}/`) || pathname.includes("//") ||
        path.posix.normalize(pathname) !== pathname || pathname.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."))) fail();
  }
  if (![launcherSha256, nodeSha256, cliSha256, bootstrapSha256, helperSha256, loaderSha256, manifestSha256].every((value) => SHA256.test(value)) ||
      issuerUidText !== "999" || issuerGidText !== "999" || !/^(0|[1-9][0-9]{0,4})$/.test(entryCountText)) fail();
  return {
    packageRoot, releaseId, invocationId, launcherPath, launcherSha256, nodePath, nodeSha256, cliPath, cliSha256,
    bootstrapPath, bootstrapSha256, helperPath, helperSha256, loaderPath, loaderSha256, manifestPath, manifestSha256,
    issuerUid: Number(issuerUidText), issuerGid: Number(issuerGidText), entryCount: Number(entryCountText),
  };
}

function parsePackageManifest(bytes, packageRoot, manifestSha256) {
  if (hash(bytes) !== manifestSha256) fail();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(text, "utf8").equals(bytes) || !text.endsWith("\n") || text.includes("\r")) fail();
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines.shift() !== "R3E-PACKAGE-V2") fail();
  const files = new Map();
  const directories = new Set();
  let previous = "";
  let fileCount = 0;
  let directoryCount = 0;
  for (const line of lines) {
    let pathname;
    if (line.startsWith("F\t")) {
      const secondTab = line.indexOf("\t", 2);
      if (secondTab < 0 || line.indexOf("\t", secondTab + 1) >= 0) fail();
      const digest = line.slice(2, secondTab);
      pathname = line.slice(secondTab + 1);
      if (!SHA256.test(digest)) fail();
      fileCount++;
      files.set(pathname, digest);
    } else if (line.startsWith("D\t")) {
      pathname = line.slice(2);
      if (!pathname || line.indexOf("\t", 2) >= 0 || directories.has(pathname)) fail();
      directoryCount++;
      directories.add(pathname);
    } else fail();
    const relative = path.posix.relative(packageRoot, pathname);
    if (!pathname.startsWith(`${packageRoot}/`) || !relative || relative.startsWith("../") || relative.includes("//") ||
        relative.length > MAX_PATH || relative.split("/").some((part) => !part || part === "." || part === ".." || !/^[\x21-\x7e]+$/.test(part)) ||
        pathname <= previous || files.has(pathname) && directories.has(pathname)) fail();
    previous = pathname;
  }
  if (fileCount < 1 || fileCount > MAX_FILES || directoryCount > MAX_DIRS || files.size !== fileCount) fail();
  return { files, directoryCount };
}

const context = parseLaunchContext(process.env[CONTEXT_ENV]);
const manifestBytes = readPinnedFile(context.manifestPath, MAX_MANIFEST, context.manifestSha256);
const parsedManifest = parsePackageManifest(manifestBytes, context.packageRoot, context.manifestSha256);
const expectedFiles = parsedManifest.files;
if (expectedFiles.size + parsedManifest.directoryCount !== context.entryCount) fail();
if (expectedFiles.get(context.bootstrapPath) !== context.bootstrapSha256 || !expectedFiles.has(context.cliPath) || !expectedFiles.has(context.helperPath)) fail();

/* The private issuer needs only the descriptor-check helper subprocess. Keep
 * that one fixed executable call and deny every general process API before
 * application modules are allowed to load. */
const nativeSpawnSync = childProcess.spawnSync.bind(childProcess);
function deniedProcessApi() { return fail(); }
function checkedCustodySpawnSync(command, args = [], options = {}) {
  if (command !== context.helperPath || !Array.isArray(args) || args.length < 1 || args.length > 255 ||
      args.some((item) => typeof item !== "string" || item.length < 1 || item.length > MAX_PATH ||
        !path.posix.isAbsolute(item) || path.posix.normalize(item) !== item || /[\0\r\n\t]/.test(item)) ||
      options === null || typeof options !== "object" ||
      options.encoding !== "utf8" || options.timeout !== 5000 || options.maxBuffer !== 64 * 1024 ||
      options.windowsHide !== true || options.shell !== false ||
      !Array.isArray(options.stdio) || options.stdio.length !== 3 ||
      options.stdio[0] !== "ignore" || options.stdio[1] !== "pipe" || options.stdio[2] !== "ignore" ||
      Object.keys(options).some((key) => !new Set(["encoding", "timeout", "maxBuffer", "windowsHide", "shell", "stdio"]).has(key))) fail();
  return nativeSpawnSync(command, args, { ...options, cwd: context.packageRoot, env: {} });
}
childProcess.spawnSync = checkedCustodySpawnSync;
for (const name of ["spawn", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]) {
  childProcess[name] = deniedProcessApi;
}
childProcess.promises = Object.freeze({ exec: deniedProcessApi, execFile: deniedProcessApi });
syncBuiltinESMExports();

const loaded = new Set([context.bootstrapPath, context.cliPath]);
function verifiedPackageFile(filename) {
  if (!path.posix.isAbsolute(filename) || path.posix.normalize(filename) !== filename) fail();
  const expected = expectedFiles.get(filename);
  if (!expected) fail();
  readPinnedFile(filename, MAX_MODULE, expected);
  loaded.add(filename);
  return expected;
}

function measureExecution() {
  const modules = [...loaded].sort().map((filename) => [filename, verifiedPackageFile(filename)]);
  const mappings = readMappedFiles();
  const verifiedMappings = verifyMappedFileBytes(mappings);
  const material = {
    version: "r3e-precredential-loaded-runtime-v2",
    packageManifestSha256: context.manifestSha256,
    packageEntryCount: context.entryCount,
    nodePath: context.nodePath,
    nodeSha256: context.nodeSha256,
    launcherPath: context.launcherPath,
    launcherSha256: context.launcherSha256,
    helperPath: context.helperPath,
    helperSha256: context.helperSha256,
    loaderPath: context.loaderPath,
    loaderSha256: context.loaderSha256,
    modules,
    nativeMappings: verifiedMappings,
  };
  return Object.freeze({ sha256: hash(Buffer.from(JSON.stringify(material), "utf8")), modules: Object.freeze(modules.map((entry) => Object.freeze(entry))), nativeMappings: Object.freeze(verifiedMappings) });
}

const tracker = Object.freeze({
  snapshot: () => Object.freeze([...loaded].sort()),
  verify: (filename) => verifiedPackageFile(filename),
  packageFilesUnder: (relativePrefix, suffix) => {
    if (typeof relativePrefix !== "string" || typeof suffix !== "string" || relativePrefix.startsWith("/") || relativePrefix.includes("..")) return fail();
    const prefix = `${context.packageRoot}/${relativePrefix.replace(/\/$/, "")}/`;
    return Object.freeze([...expectedFiles.keys()].filter((filename) => filename.startsWith(prefix) && filename.endsWith(suffix)).sort());
  },
  measureExecution,
});
Object.defineProperty(globalThis, TRACKER_SYMBOL, { value: tracker, configurable: false, enumerable: false, writable: false });

registerHooks({
  resolve(specifier, hookContext, nextResolve) {
    const resolved = nextResolve(specifier, hookContext);
    if (resolved.url.startsWith("node:")) {
      if (DENIED_BUILTINS.has(resolved.url)) fail();
      return resolved;
    }
    if (!resolved.url.startsWith("file:")) fail();
    let filename;
    try { filename = fileURLToPath(resolved.url); } catch { return fail(); }
    if (pathToFileURL(filename).href !== resolved.url) fail();
    verifiedPackageFile(filename);
    return resolved;
  },
  load(url, hookContext, nextLoad) {
    if (url.startsWith("node:")) {
      if (DENIED_BUILTINS.has(url)) fail();
      return nextLoad(url, hookContext);
    }
    if (!url.startsWith("file:")) fail();
    let filename;
    try { filename = fileURLToPath(url); } catch { return fail(); }
    verifiedPackageFile(filename);
    return nextLoad(url, hookContext);
  },
});
