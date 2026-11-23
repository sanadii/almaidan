import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";

const MAX_BATCH = 255;
const MAX_OUTPUT = 64 * 1024;

export interface R3eCustodySnapshot {
  mountId: string;
  metadataSha256: string;
  fileCount: number;
  /** Native SHA-256 of bytes read from each verified open descriptor. */
  fileSha256: ReadonlyMap<string, string>;
}

export type R3eCustodyResult =
  | { status: "verified"; snapshot: R3eCustodySnapshot }
  | { status: "unavailable"; reasonCode: "R3E_NATIVE_CUSTODY_PLATFORM_UNAVAILABLE" | "R3E_NATIVE_CUSTODY_HELPER_UNAVAILABLE" | "R3E_NATIVE_CUSTODY_CHECK_FAILED" };

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function helperPath(): string {
  return path.join(__dirname, "native", "r3e-custody");
}

async function verifyBatch(helper: string, paths: readonly string[]): Promise<{ mountId: string; rows: string[]; fileSha256: string[] } | undefined> {
  const result = spawnSync(helper, paths, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: MAX_OUTPUT,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || !result.stdout || result.stdout.length > MAX_OUTPUT) return undefined;
  const lines = result.stdout.trimEnd().split("\n");
  const header = lines.shift()?.split("\t");
  if (!header || header.length !== 3 || header[0] !== "R3E-CUSTODY-V1" || !/^[1-9][0-9]*$/.test(header[1]) ||
      header[2] !== String(paths.length) || lines.length !== paths.length) return undefined;
  const mountId = header[1];
  const metadata: string[] = [];
  const fileSha256: string[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const fields = lines[index].split("\t");
    if (fields.length !== 5 || fields.slice(0, 4).some((field) => !/^(0|[1-9][0-9]*)$/.test(field)) || !/^[a-f0-9]{64}$/.test(fields[4])) return undefined;
    let stat;
    try { stat = await lstat(paths[index], { bigint: true }); }
    catch { return undefined; }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.dev.toString() !== fields[0] ||
        stat.ino.toString() !== fields[1] || stat.size.toString() !== fields[2] ||
        (stat.mode & 0o7777n).toString() !== fields[3]) return undefined;
    metadata.push(fields.slice(0, 4).join("\t"));
    fileSha256.push(fields[4]);
  }
  return { mountId, rows: metadata, fileSha256 };
}

/**
 * Uses the packaged Linux openat2 helper. It is deliberately fixed-path and
 * has no request/config override; unsupported platforms and missing binaries
 * fail closed. The helper pins root as operator owner and a compile-time issuer
 * UID, checks ext4/mount identity, ancestor traversal, ACLs, capabilities,
 * hardlinks, ownership, and effective write access.
 */
export async function verifyR3eNativeCustody(paths: readonly string[]): Promise<R3eCustodyResult> {
  if (process.platform !== "linux" || typeof process.geteuid !== "function" || process.geteuid() === 0 ||
      process.getuid?.() !== process.geteuid() || paths.length === 0 || paths.length > 12_000 ||
      paths.some((item) => !path.isAbsolute(item))) {
    return { status: "unavailable", reasonCode: "R3E_NATIVE_CUSTODY_PLATFORM_UNAVAILABLE" };
  }
  const helper = helperPath();
  let helperStat;
  try { helperStat = await lstat(helper, { bigint: true }); }
  catch { return { status: "unavailable", reasonCode: "R3E_NATIVE_CUSTODY_HELPER_UNAVAILABLE" }; }
  if (!helperStat.isFile() || helperStat.isSymbolicLink()) return { status: "unavailable", reasonCode: "R3E_NATIVE_CUSTODY_HELPER_UNAVAILABLE" };

  const normalized = [...new Set([...paths.map((item) => path.resolve(item)), path.resolve(helper)])];
  const rows: string[] = [];
  const fileSha256: string[] = [];
  let rootMount: string | undefined;
  for (let offset = 0; offset < normalized.length; offset += MAX_BATCH) {
    const batch = normalized.slice(offset, offset + MAX_BATCH);
    const checked = await verifyBatch(helper, batch);
    if (!checked || (rootMount !== undefined && checked.mountId !== rootMount)) {
      return { status: "unavailable", reasonCode: "R3E_NATIVE_CUSTODY_CHECK_FAILED" };
    }
    rootMount = checked.mountId;
    rows.push(...checked.rows);
    fileSha256.push(...checked.fileSha256);
  }
  return {
    status: "verified",
    snapshot: {
      mountId: rootMount!,
      metadataSha256: sha256(JSON.stringify({ version: "r3e-linux-openat2-custody-v2", files: normalized.map((file, index) => [file, rows[index], fileSha256[index]]) })),
      fileCount: normalized.length,
      fileSha256: new Map(normalized.map((file, index) => [file, fileSha256[index]])),
    },
  };
}
