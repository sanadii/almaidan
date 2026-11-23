import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

const CONTEXT_ENV = "MAYDAN_R3E_CONTEXT";
const PRODUCTION_CGROUP = "/system.slice/enta-r3e-issuer.service";
const ISSUER_UID = 999;
const ISSUER_GID = 999;
const MAX_CONTEXT_BYTES = 8192;
const MAX_NODE_BYTES = 512 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const BASE_ENVIRONMENT = new Set(["NODE_ENV", CONTEXT_ENV, "INVOCATION_ID"]);
const POST_VALIDATION_ENVIRONMENT = new Set([
  ...BASE_ENVIRONMENT,
  "DATABASE_URL",
  "DIRECT_URL",
  "ENTA_R3C_REGISTRY_DIR",
  "ENTA_R3E_MANIFEST_SHA256",
  "ENTA_R3E_TRUST_ANCHOR_PATH",
  "ENTA_R3E_REVOCATIONS_PATH",
]);

export interface R3eLaunchContext {
  releaseId: string;
  invocationId: string;
  launcherPath: string;
  launcherSha256: string;
  nodePath: string;
  nodeSha256: string;
  cliPath: string;
  cliSha256: string;
  bootstrapPath: string;
  bootstrapSha256: string;
  helperPath: string;
  helperSha256: string;
  loaderPath: string;
  loaderSha256: string;
  manifestPath: string;
  manifestSha256: string;
  packageRoot: string;
  issuerUid: number;
  issuerGid: number;
  packageEntryCount: number;
}

function fail(): undefined {
  return undefined;
}

function safeAbsolutePackagePath(value: string, packageRoot: string): boolean {
  return value.length > 0 && value.length <= 4096 && !/[\0\r\n\t]/.test(value) &&
    path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    value.startsWith(`${packageRoot}/`) && !value.includes("//");
}

function parseContext(raw: string): R3eLaunchContext | undefined {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONTEXT_BYTES || !raw.endsWith("\n") || raw.includes("\r")) return undefined;
  const lines = raw.split("\n");
  if (lines.pop() !== "" || lines.length !== 21 || lines[0] !== "R3E-ISSUER-LAUNCH-V2") return undefined;
  const [
    , releaseId, invocationId, launcherPath, launcherSha256, nodePath, nodeSha256, cliPath, cliSha256,
    bootstrapPath, bootstrapSha256, helperPath, helperSha256, loaderPath, loaderSha256, manifestPath, manifestSha256,
    packageRoot, issuerUidText, issuerGidText, packageEntryCountText,
  ] = lines;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(releaseId) || !/^[a-f0-9]{32}$/.test(invocationId) || !path.posix.isAbsolute(packageRoot) ||
      path.posix.normalize(packageRoot) !== packageRoot || packageRoot.endsWith("/")) return undefined;
  const paths = [launcherPath, nodePath, cliPath, bootstrapPath, helperPath, loaderPath, manifestPath];
  if (paths.some((value) => !safeAbsolutePackagePath(value, packageRoot)) ||
      ![launcherSha256, nodeSha256, cliSha256, bootstrapSha256, helperSha256, loaderSha256, manifestSha256].every((value) => SHA256.test(value)) ||
      !/^(0|[1-9][0-9]{0,4})$/.test(packageEntryCountText)) return undefined;
  const packageEntryCount = Number(packageEntryCountText);
  if (!Number.isSafeInteger(packageEntryCount) || packageEntryCount < 1 || packageEntryCount > 20_480) return undefined;
  const issuerUid = Number(issuerUidText);
  const issuerGid = Number(issuerGidText);
  if (issuerUid !== ISSUER_UID || issuerGid !== ISSUER_GID) return undefined;
  return {
    releaseId, invocationId, launcherPath, launcherSha256, nodePath, nodeSha256, cliPath, cliSha256, bootstrapPath, bootstrapSha256,
    helperPath, helperSha256, loaderPath, loaderSha256, manifestPath, manifestSha256,
    packageRoot, issuerUid, issuerGid, packageEntryCount,
  };
}

function environmentAllowed(afterPolicyLoad: boolean): boolean {
  const allowed = afterPolicyLoad ? POST_VALIDATION_ENVIRONMENT : BASE_ENVIRONMENT;
  return Object.keys(process.env).every((name) => allowed.has(name));
}

function readNodeDescriptorDigest(expectedBytes: string): boolean {
  let fd: number | undefined;
  try {
    const nodeDescriptor = fstatSync(32);
    if (!nodeDescriptor.isFile() || nodeDescriptor.uid !== 0 || nodeDescriptor.nlink !== 1 ||
        (nodeDescriptor.mode & 0o022) !== 0 || nodeDescriptor.size < 1 || nodeDescriptor.size > MAX_NODE_BYTES) return false;
    fd = openSync("/proc/self/fd/32", "r");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length !== nodeDescriptor.size || after.dev !== nodeDescriptor.dev || after.ino !== nodeDescriptor.ino ||
        after.size !== nodeDescriptor.size || after.mtimeMs !== nodeDescriptor.mtimeMs) return false;
    return createHash("sha256").update(bytes).digest("hex") === expectedBytes;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function verifyLiveContext(context: R3eLaunchContext, afterPolicyLoad: boolean): boolean {
  if (!environmentAllowed(afterPolicyLoad) || process.env.NODE_ENV !== "production" ||
      process.env.INVOCATION_ID !== context.invocationId || process.ppid !== 1 ||
      process.argv.length !== 3 || process.argv[1] !== "-" || process.argv[2] !== context.releaseId ||
      process.cwd() !== context.packageRoot || process.execArgv.length !== 2 || process.execArgv[0] !== "--import" ||
      process.execArgv[1] !== context.bootstrapPath ||
      process.getuid?.() !== context.issuerUid || process.geteuid?.() !== context.issuerUid ||
      process.getgid?.() !== context.issuerGid || process.getegid?.() !== context.issuerGid) return false;
  const groups = process.getgroups?.().sort((left, right) => left - right);
  if (!groups || groups.length !== 1 || groups[0] !== context.issuerGid) return false;
  try {
    if (readFileSync("/proc/self/cgroup", "utf8").trim() !== `0::${PRODUCTION_CGROUP}`) return false;
    const status = readFileSync("/proc/self/status", "utf8");
    for (const label of ["CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"]) {
      const match = status.match(new RegExp(`^${label}:\\s+([a-f0-9]+)$`, "mi"));
      if (!match || BigInt(`0x${match[1]}`) !== 0n) return false;
    }
    if (!/^NoNewPrivs:\s+1$/m.test(status) || !fstatSync(0).isFile()) return false;
  } catch {
    return false;
  }
  return readNodeDescriptorDigest(context.nodeSha256);
}

/** Validate the one native-launch context before policy, credential, or DB access. */
export function validateR3eIssuerLaunch(): R3eLaunchContext | undefined {
  const raw = process.env[CONTEXT_ENV];
  if (!raw) return fail();
  const context = parseContext(raw);
  if (!context || !verifyLiveContext(context, false)) return fail();
  return context;
}

/** Used by the issuer entry after policy and systemd credentials are loaded. */
export function hasValidatedR3eIssuerLaunch(): boolean {
  const context = process.env[CONTEXT_ENV] ? parseContext(process.env[CONTEXT_ENV]!) : undefined;
  return context !== undefined && verifyLiveContext(context, true);
}

/** Return current launch identity only after the post-policy checks pass. */
export function getValidatedR3eIssuerLaunch(): R3eLaunchContext | undefined {
  const context = process.env[CONTEXT_ENV] ? parseContext(process.env[CONTEXT_ENV]!) : undefined;
  return context && verifyLiveContext(context, true) ? context : undefined;
}

export function r3eLaunchIdentity(context: R3eLaunchContext): Readonly<Record<string, string | number>> {
  return Object.freeze({
    packageRoot: context.packageRoot,
    packageManifestSha256: context.manifestSha256,
    packageEntryCount: context.packageEntryCount,
    launcherSha256: context.launcherSha256,
    nodeSha256: context.nodeSha256,
    cliSha256: context.cliSha256,
    bootstrapSha256: context.bootstrapSha256,
    helperSha256: context.helperSha256,
    loaderSha256: context.loaderSha256,
    issuerUid: context.issuerUid,
    issuerGid: context.issuerGid,
  });
}
