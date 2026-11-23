import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { R3eLaunchContext } from "./r3e-launch-context";

const MAX_POLICY_BYTES = 4096;
const MAX_DATABASE_CREDENTIAL_BYTES = 8192;
const POLICY_RELATIVE_PATH = "policy/issuer-runtime.conf";
const DATABASE_CREDENTIAL_PATH = "/run/credentials/enta-r3e-issuer.service/database-url";
const EXPECTED_POLICY_KEYS = [
  "ENTA_R3C_REGISTRY_DIR",
  "ENTA_R3E_MANIFEST_SHA256",
  "ENTA_R3E_REVOCATIONS_PATH",
  "ENTA_R3E_TRUST_ANCHOR_PATH",
] as const;
type IssuerPolicy = Record<(typeof EXPECTED_POLICY_KEYS)[number], string>;
interface R3eModuleTracker {
  snapshot(): readonly string[];
  verify(filename: string): void;
  packageFilesUnder(relativePrefix: string, suffix: string): readonly string[];
  measureExecution(): {
    sha256: string;
    modules: readonly (readonly [string, string])[];
    nativeMappings: readonly (readonly [string, string, string, string])[];
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function packageManifestFileRecord(manifestText: string, digest: string, filename: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(digest) || !path.isAbsolute(filename) || /[\0\r\n\t]/.test(filename)) return false;
  return manifestText.split("\n").includes(`F\t${digest}\t${filename}`);
}

function currentModuleTracker(): R3eModuleTracker | undefined {
  const candidate = (globalThis as Record<PropertyKey, unknown>)[Symbol.for("maydan.r3e.module-tracker.v2")];
  if (!candidate || typeof candidate !== "object") return undefined;
  const tracker = candidate as Partial<R3eModuleTracker>;
  return typeof tracker.snapshot === "function" && typeof tracker.verify === "function" && typeof tracker.measureExecution === "function"
    ? tracker as R3eModuleTracker
    : undefined;
}

function preCredentialClosureStillPresent(
  before: ReturnType<R3eModuleTracker["measureExecution"]>,
  after: ReturnType<R3eModuleTracker["measureExecution"]>,
): boolean {
  const afterModules = new Map(after.modules.map(([filename, digest]) => [filename, digest]));
  const afterMappings = new Map(after.nativeMappings.map(([filename, digest, device, inode]) => [filename, `${digest}\0${device}\0${inode}`]));
  return before.modules.every(([filename, digest]) => afterModules.get(filename) === digest) &&
    before.nativeMappings.every(([filename, digest, device, inode]) => afterMappings.get(filename) === `${digest}\0${device}\0${inode}`);
}

function readStableRootFile(filename: string, maxBytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    const before = lstatSync(filename, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.uid !== 0n ||
        (before.mode & 0o022n) !== 0n || before.size < 1n || before.size > BigInt(maxBytes)) return undefined;
    fd = openSync(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return undefined;
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) return undefined;
    return bytes;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

async function readPinnedPackageFile(
  filename: string,
  maxBytes: number,
  verifyCustody: (paths: readonly string[]) => Promise<{
    status: "verified";
    snapshot: { metadataSha256: string; fileSha256: ReadonlyMap<string, string> };
  } | { status: "unavailable" }>,
): Promise<Buffer | undefined> {
  const before = await verifyCustody([filename]);
  if (before.status !== "verified") return undefined;
  const bytes = readStableRootFile(filename, maxBytes);
  const expected = before.snapshot.fileSha256.get(path.resolve(filename));
  const after = await verifyCustody([filename]);
  if (!bytes || !expected || sha256(bytes) !== expected || after.status !== "verified" ||
      after.snapshot.metadataSha256 !== before.snapshot.metadataSha256 ||
      after.snapshot.fileSha256.get(path.resolve(filename)) !== expected) return undefined;
  return bytes;
}

async function parsePolicy(
  context: R3eLaunchContext,
  verifyCustody: Parameters<typeof readPinnedPackageFile>[2],
): Promise<IssuerPolicy | undefined> {
  const manifestBytes = await readPinnedPackageFile(context.manifestPath, 4 * 1024 * 1024, verifyCustody);
  if (!manifestBytes || sha256(manifestBytes) !== context.manifestSha256) return undefined;
  const manifestText = manifestBytes.toString("utf8");
  if (!Buffer.from(manifestText, "utf8").equals(manifestBytes)) return undefined;
  const policyPath = path.join(context.packageRoot, POLICY_RELATIVE_PATH);
  const bytes = await readPinnedPackageFile(policyPath, MAX_POLICY_BYTES, verifyCustody);
  if (!bytes) return undefined;
  const policyDigest = sha256(bytes);
  if (!packageManifestFileRecord(manifestText, policyDigest, policyPath)) return undefined;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes) || !text.endsWith("\n") || text.includes("\r")) return undefined;
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines.shift() !== "R3E-ISSUER-RUNTIME-V1" || lines.length !== EXPECTED_POLICY_KEYS.length) return undefined;
  const result: Partial<IssuerPolicy> = {};
  for (let index = 0; index < EXPECTED_POLICY_KEYS.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf("=");
    if (separator < 1 || line.indexOf("=", separator + 1) >= 0) return undefined;
    const key = line.slice(0, separator) as (typeof EXPECTED_POLICY_KEYS)[number];
    const value = line.slice(separator + 1);
    if (key !== EXPECTED_POLICY_KEYS[index] || !value || /[\0\r\n\t]/.test(value)) return undefined;
    result[key] = value;
  }
  const policy = result as IssuerPolicy;
  if (!/^[a-f0-9]{64}$/.test(policy.ENTA_R3E_MANIFEST_SHA256) ||
      ![policy.ENTA_R3C_REGISTRY_DIR, policy.ENTA_R3E_REVOCATIONS_PATH, policy.ENTA_R3E_TRUST_ANCHOR_PATH].every((item) => path.isAbsolute(item))) return undefined;
  return policy;
}

function readDatabaseCredential(): string | undefined {
  const bytes = readStableRootFile(DATABASE_CREDENTIAL_PATH, MAX_DATABASE_CREDENTIAL_BYTES);
  if (!bytes) return undefined;
  const connectionString = bytes.toString("utf8").trim();
  if (!Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes) || !/^postgres(?:ql)?:\/\//.test(connectionString) || /[\0\r\n]/.test(connectionString)) {
    return undefined;
  }
  return connectionString;
}

export async function runR3eIssuerCli(): Promise<number> {
  // The bundle is read from the verified CLI descriptor on stdin. The launch
  // context module is bundled into it; package imports are resolved only from
  // the manifest-pinned CLI location after that context has passed validation.
  const contextModule = await import("./r3e-launch-context");
  const context = contextModule.validateR3eIssuerLaunch();
  if (!context) {
    process.stderr.write("R3E_ISSUER_DENIED:R3E_LAUNCH_CONTEXT_REQUIRED\n");
    return 78;
  }
  const packageRequire = createRequire(context.cliPath);
  const { verifyR3eNativeCustody } = packageRequire("./r3e-native-custody") as typeof import("./r3e-native-custody");
  const policy = await parsePolicy(context, verifyR3eNativeCustody);
  if (!policy || !contextModule.hasValidatedR3eIssuerLaunch()) {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_OPERATOR_POLICY_UNAVAILABLE\n");
    return 78;
  }

  // Load the actual issuer/Prisma JS dependency closure before credential
  // access. The immutable package manifest is the launcher-verified complete
  // release inventory; the tracker measures every module actually resolved
  // so far against its exact pinned bytes.
  let PrismaClient: typeof import("@prisma/client").PrismaClient;
  let issueEntaR3eCatalogReceipt: typeof import("./r3e-issuer").issueEntaR3eCatalogReceipt;
  let measureR3ePackagedRuntimeClosure: typeof import("./r3e-runtime-identity").measureR3ePackagedRuntimeClosure;
  try {
    ({ PrismaClient } = packageRequire("@prisma/client") as typeof import("@prisma/client"));
    ({ issueEntaR3eCatalogReceipt } = packageRequire("./r3e-issuer") as typeof import("./r3e-issuer"));
    ({ measureR3ePackagedRuntimeClosure } = packageRequire("./r3e-runtime-identity") as typeof import("./r3e-runtime-identity"));
    // Prisma 5.22's Linux library engine can be dlopen()ed directly without a
    // datasource or connection. Require the one generated engine from the
    // pinned package before credentials so /proc/self/maps and the custody
    // helper can bind its actual loaded bytes, device and inode.
    const enginePaths = currentModuleTracker()?.packageFilesUnder("node_modules/.prisma/client", ".so.node")
      .filter((filename) => path.posix.basename(filename).startsWith("libquery_engine-") && filename.endsWith(".so.node")) ?? [];
    if (enginePaths.length !== 1) throw new Error("R3E_PRISMA_NATIVE_ENGINE_INVALID");
    const nativeEngine = packageRequire(enginePaths[0]) as unknown;
    if (!nativeEngine || (typeof nativeEngine !== "object" && typeof nativeEngine !== "function")) {
      throw new Error("R3E_PRISMA_NATIVE_ENGINE_INVALID");
    }
  } catch {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_PRE_CREDENTIAL_PACKAGE_CLOSURE_INVALID\n");
    return 78;
  }
  const tracker = currentModuleTracker();
  const preCredentialMeasurement = tracker?.measureExecution();
  let preCredentialPackageClosure: ReturnType<typeof measureR3ePackagedRuntimeClosure> | undefined;
  try {
    preCredentialPackageClosure = measureR3ePackagedRuntimeClosure();
  } catch {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_PRE_CREDENTIAL_PACKAGE_CLOSURE_INVALID\n");
    return 78;
  }
  if (!tracker || !preCredentialMeasurement || !preCredentialPackageClosure ||
      preCredentialPackageClosure.executionSha256 !== preCredentialMeasurement.sha256 ||
      preCredentialPackageClosure.packageManifestSha256 !== context.manifestSha256 ||
      !contextModule.hasValidatedR3eIssuerLaunch()) {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_PRE_CREDENTIAL_PACKAGE_CLOSURE_INVALID\n");
    return 78;
  }
  process.stderr.write("R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED\n");

  const databaseUrl = readDatabaseCredential();
  if (!databaseUrl || !contextModule.hasValidatedR3eIssuerLaunch()) {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_DATABASE_CREDENTIAL_UNAVAILABLE\n");
    return 78;
  }

  process.env.ENTA_R3C_REGISTRY_DIR = policy.ENTA_R3C_REGISTRY_DIR;
  process.env.ENTA_R3E_MANIFEST_SHA256 = policy.ENTA_R3E_MANIFEST_SHA256;
  process.env.ENTA_R3E_REVOCATIONS_PATH = policy.ENTA_R3E_REVOCATIONS_PATH;
  process.env.ENTA_R3E_TRUST_ANCHOR_PATH = policy.ENTA_R3E_TRUST_ANCHOR_PATH;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;

  const client = new PrismaClient();
  try {
    const postCredentialMeasurement = tracker.measureExecution();
    if (!preCredentialClosureStillPresent(preCredentialMeasurement, postCredentialMeasurement) ||
        !contextModule.hasValidatedR3eIssuerLaunch()) {
      process.stderr.write("R3E_ISSUER_DENIED:R3E_LAUNCH_CONTEXT_CHANGED\n");
      return 78;
    }
    const result = await issueEntaR3eCatalogReceipt(client, context.releaseId);
    if ("status" in result) {
      process.stderr.write(`R3E_ISSUER_${result.status.toUpperCase()}:${result.reasonCode}\n`);
      return result.status === "rejected" ? 2 : 3;
    }
    process.stdout.write(`R3E_ISSUER_RESULT:${result.receiptId}:${result.proofId}:${result.reportSha256}\n`);
    return 0;
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] === "-" && process.argv.length === 3) {
  void runR3eIssuerCli().then((code) => { process.exitCode = code; }).catch(() => {
    process.stderr.write("R3E_ISSUER_UNAVAILABLE:R3E_PRIVATE_EXECUTION_FAILED\n");
    process.exitCode = 3;
  });
}
