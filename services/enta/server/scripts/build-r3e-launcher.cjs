"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../../../..");
const source = path.join(root, "services/enta/server/src/catalog/native/r3e-issuer-launcher.c");
const defaultOutput = path.join(root, "services/enta/server/dist/catalog/native/r3e-issuer-launcher");
let output = defaultOutput;
const keys = [
  "ENTA_R3E_ISSUER_UID", "ENTA_R3E_ISSUER_GID", "ENTA_R3E_EXPECTED_CGROUP", "ENTA_R3E_PACKAGE_ROOT",
  "ENTA_R3E_MANIFEST_PATH", "ENTA_R3E_MANIFEST_SHA256", "ENTA_R3E_NODE_PATH", "ENTA_R3E_CLI_PATH",
  "ENTA_R3E_BOOTSTRAP_PATH", "ENTA_R3E_HELPER_PATH", "ENTA_R3E_LOADER_PATH", "ENTA_R3E_LIBRARY_PATH", "ENTA_R3E_LAUNCHER_PATH",
];

function removeOnlyGeneratedOutput(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("unexpected launcher output type");
    fs.unlinkSync(target);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

function failClosedWithoutReleasePins(env = process.env) {
  if (keys.some((key) => env[key])) throw new Error("R3-E launcher build requires the complete pinned release configuration");
  removeOnlyGeneratedOutput(defaultOutput);
  process.stdout.write("R3-E native launcher omitted; no pinned release manifest configuration was supplied.\n");
}

function isCanonicalAbsolutePath(value) {
  return typeof value === "string" && value.length > 1 && value.length <= 4096 &&
    /^\/[A-Za-z0-9._/-]+$/.test(value) && !value.endsWith("/") && !value.includes("//") &&
    path.posix.isAbsolute(value) && path.posix.normalize(value) === value &&
    value.split("/").slice(1).every((part) => part !== "" && part !== "." && part !== "..");
}

function isCanonicalPackageRoot(value) {
  return isCanonicalAbsolutePath(value) && value !== "/";
}

function isPackageChild(value, packageRoot) {
  return isCanonicalAbsolutePath(value) && value.startsWith(`${packageRoot}/`);
}

function parseNumericId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric <= 4_294_967_294 ? numeric : undefined;
}

function parsePinnedBuildConfig(env) {
  if (keys.some((key) => !env[key])) throw new Error("incomplete or malformed R3-E release pins");
  const issuerUid = parseNumericId(env.ENTA_R3E_ISSUER_UID);
  const issuerGid = parseNumericId(env.ENTA_R3E_ISSUER_GID);
  const packageRoot = env.ENTA_R3E_PACKAGE_ROOT;
  if (issuerUid === undefined || issuerGid === undefined || !isCanonicalPackageRoot(packageRoot)) {
    throw new Error("incomplete or malformed R3-E release pins");
  }
  const pathPins = {
    manifestPath: env.ENTA_R3E_MANIFEST_PATH,
    nodePath: env.ENTA_R3E_NODE_PATH,
    cliPath: env.ENTA_R3E_CLI_PATH,
    bootstrapPath: env.ENTA_R3E_BOOTSTRAP_PATH,
    helperPath: env.ENTA_R3E_HELPER_PATH,
    loaderPath: env.ENTA_R3E_LOADER_PATH,
    libraryPath: env.ENTA_R3E_LIBRARY_PATH,
    launcherPath: env.ENTA_R3E_LAUNCHER_PATH,
  };
  if (Object.values(pathPins).some((pin) => !isPackageChild(pin, packageRoot)) ||
      new Set(Object.values(pathPins)).size !== Object.values(pathPins).length ||
      !/^[a-f0-9]{64}$/.test(env.ENTA_R3E_MANIFEST_SHA256)) {
    throw new Error("incomplete or malformed R3-E release pins");
  }
  const cgroup = env.ENTA_R3E_EXPECTED_CGROUP;
  if (!isCanonicalAbsolutePath(cgroup) || !cgroup.startsWith("/system.slice/") || cgroup === "/system.slice/") {
    throw new Error("incomplete or malformed R3-E release pins");
  }
  return Object.freeze({ issuerUid, issuerGid, packageRoot, manifestSha256: env.ENTA_R3E_MANIFEST_SHA256, cgroup, ...pathPins });
}

function cStringDefine(name, value) {
  if (typeof value !== "string" || !value || /[\0\r\n]/.test(value)) throw new Error("invalid R3-E launcher build pin");
  return `-D${name}=${JSON.stringify(value)}`;
}

function numericDefine(name, value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 4_294_967_294) throw new Error("invalid numeric R3-E launcher build pin");
  return `-D${name}=${value}`;
}

function compilerDefines(config) {
  return [
    numericDefine("R3E_ISSUER_UID", config.issuerUid), numericDefine("R3E_ISSUER_GID", config.issuerGid),
    cStringDefine("R3E_EXPECTED_CGROUP", config.cgroup), cStringDefine("R3E_PACKAGE_ROOT", config.packageRoot),
    cStringDefine("R3E_MANIFEST_PATH", config.manifestPath), cStringDefine("R3E_MANIFEST_SHA256", config.manifestSha256),
    cStringDefine("R3E_NODE_PATH", config.nodePath), cStringDefine("R3E_CLI_PATH", config.cliPath),
    cStringDefine("R3E_BOOTSTRAP_PATH", config.bootstrapPath),
    cStringDefine("R3E_HELPER_PATH", config.helperPath), cStringDefine("R3E_LOADER_PATH", config.loaderPath),
    cStringDefine("R3E_LIBRARY_PATH", config.libraryPath), cStringDefine("R3E_LAUNCHER_PATH", config.launcherPath),
  ];
}

function validatePinnedPayload(config) {
  const rootStat = fs.lstatSync(config.packageRoot);
  const rootReal = fs.realpathSync(config.packageRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootReal !== config.packageRoot) {
    throw new Error("R3-E package root is not a canonical directory");
  }
  const manifestStat = fs.lstatSync(config.manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size < 1 || manifestStat.size > 4 * 1024 * 1024) {
    throw new Error("R3-E package manifest is invalid");
  }
  const manifest = fs.readFileSync(config.manifestPath);
  if (crypto.createHash("sha256").update(manifest).digest("hex") !== config.manifestSha256) {
    throw new Error("R3-E package manifest digest mismatch");
  }
  const parent = path.dirname(config.launcherPath);
  const parentStat = fs.lstatSync(parent);
  const parentReal = fs.realpathSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || parentReal !== parent) {
    throw new Error("R3-E launcher output parent is not a canonical directory");
  }
}

function main(env = process.env) {
  if (process.platform !== "linux") {
    failClosedWithoutReleasePins(env);
    return 0;
  }
  if (keys.every((key) => !env[key])) {
    failClosedWithoutReleasePins(env);
    return 0;
  }
  let target = defaultOutput;
  try {
    const config = parsePinnedBuildConfig(env);
    target = config.launcherPath;
    validatePinnedPayload(config);
    output = target;
    removeOnlyGeneratedOutput(output);
    const result = spawnSync("gcc", [
      "-std=c11", "-O2", "-static", "-fno-pie", "-no-pie", "-Wall", "-Wextra", "-Werror",
      ...compilerDefines(config), source, "-o", output,
    ], { stdio: "inherit", shell: false });
    if (result.error || result.status !== 0) throw new Error("R3-E static launcher compilation failed");
    const stat = fs.lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) throw new Error("R3-E launcher output is invalid");
    fs.chmodSync(output, 0o555);
    process.stdout.write("Built static R3-E launcher at its pinned package path.\n");
    return 0;
  } catch (error) {
    if (target !== defaultOutput) removeOnlyGeneratedOutput(target);
    process.stderr.write(`${error instanceof Error ? error.message : "R3-E launcher build failed"}.\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { compilerDefines, isCanonicalAbsolutePath, isCanonicalPackageRoot, isPackageChild, main, parsePinnedBuildConfig };
