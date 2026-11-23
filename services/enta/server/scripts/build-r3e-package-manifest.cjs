"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_FILES = 16_384;
const MAX_PACKAGE_DIRS = 4_096;
const MAX_PACKAGE_DEPTH = 32;
const MAX_PACKAGE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
const EXCLUDED_NAMES = new Set(["package.manifest", "bin/r3e-issuer-launcher"]);
const ELF_LIBRARY_DIR = "lib";

function validRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") ||
      value.includes("\t") || value.includes("\r") || value.includes("\n") || value.startsWith("/") ||
      value.endsWith("/") || value.includes("//")) return false;
  const components = value.split("/");
  return components.length <= MAX_PACKAGE_DEPTH && components.every((part) =>
    part.length > 0 && part !== "." && part !== ".." && /^[\x21-\x7e]+$/.test(part));
}

function safePackageRoot(root) {
  if (typeof root !== "string" || !path.posix.isAbsolute(root) || root === "/" ||
      root.length > 4096 || root.endsWith("/") || root.includes("//") ||
      root.split("/").some((part, index) => index > 0 && (!part || part === "." || part === ".."))) {
    throw new Error("invalid R3-E package root");
  }
  return root;
}

function checkCustody(stat, isDirectory) {
  if (stat.uid !== 0n || (stat.mode & 0o022n) !== 0n || stat.isSymbolicLink()) {
    throw new Error("R3-E package entry is not root-owned and immutable");
  }
  if (isDirectory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1n)) {
    throw new Error("R3-E package entry has an unsupported file type or link count");
  }
}

function hashRegularFile(filename, before) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== before.size || opened.nlink !== 1n || opened.uid !== 0n ||
        (opened.mode & 0o022n) !== 0n || opened.size > BigInt(MAX_PACKAGE_FILE_BYTES)) {
      throw new Error("R3-E package file changed during manifest assembly");
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    if (BigInt(bytes.length) !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
      throw new Error("R3-E package file changed during manifest assembly");
    }
    return { digest: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  } finally {
    fs.closeSync(fd);
  }
}

function readelf(filename, argument) {
  const result = spawnSync("readelf", [argument, filename], {
    encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024, shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string" || result.stdout.length > 1024 * 1024) {
    throw new Error("R3-E ELF inspection unavailable");
  }
  return result.stdout;
}

function validateElfClosure(packageRoot, fileRecords) {
  const records = new Map(fileRecords.map(({ absolute, digest }) => [absolute, digest]));
  const dependencies = [];
  for (const absolute of records.keys()) {
    const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    let magic;
    try { magic = Buffer.alloc(4); fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (!magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) continue;
    const header = readelf(absolute, "-h");
    if (!/Class:\s+ELF64/.test(header) || !/Data:\s+2's complement, little endian/.test(header) ||
        !/Machine:\s+Advanced Micro Devices X86-64/.test(header) || !/Type:\s+(EXEC|DYN)\b/.test(header)) {
      throw new Error("R3-E ELF architecture or type is unsupported");
    }
    const dynamic = readelf(absolute, "-d");
    if (/\((?:RPATH|RUNPATH)\)/.test(dynamic)) throw new Error("R3-E ELF RPATH/RUNPATH denied");
    for (const match of dynamic.matchAll(/\(NEEDED\)\s+Shared library:\s+\[([^\]]+)\]/g)) {
      const soname = match[1];
      if (!soname || soname.startsWith("/") || !/^[A-Za-z0-9_.+-]{1,255}$/.test(soname)) {
        throw new Error("R3-E ELF absolute or noncanonical DT_NEEDED denied");
      }
      const dependencyPath = path.posix.join(packageRoot, ELF_LIBRARY_DIR, soname);
      if (!records.has(dependencyPath)) throw new Error("R3-E ELF dependency is not packaged in the fixed library directory");
      dependencies.push([absolute, soname, records.get(dependencyPath)]);
    }
  }
  return dependencies.sort((left, right) => `${left[0]}\0${left[1]}`.localeCompare(`${right[0]}\0${right[1]}`));
}

function buildPackageManifest(packageRoot) {
  safePackageRoot(packageRoot);
  const rootStat = fs.lstatSync(packageRoot, { bigint: true });
  checkCustody(rootStat, true);
  if (fs.realpathSync(packageRoot) !== packageRoot) throw new Error("R3-E package root is not canonical");

  const entries = [];
  const fileRecords = [];
  let files = 0;
  let directories = 0;
  let totalBytes = 0;
  const visit = (absoluteDirectory, relativeDirectory, depth) => {
    if (depth > MAX_PACKAGE_DEPTH) throw new Error("R3-E package depth exceeded");
    const names = fs.readdirSync(absoluteDirectory).sort();
    for (const name of names) {
      if (!/^[\x21-\x7e]+$/.test(name) || name.includes("/") || name.includes("\\") || name.includes("\t")) {
        throw new Error("R3-E package has a noncanonical name");
      }
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (!validRelativePath(relative)) throw new Error("R3-E package has a noncanonical path");
      const absolute = path.join(absoluteDirectory, name);
      const stat = fs.lstatSync(absolute, { bigint: true });
      if (stat.isSymbolicLink()) throw new Error("R3-E package symlink denied");
      if (stat.isDirectory()) {
        checkCustody(stat, true);
        directories += 1;
        if (directories > MAX_PACKAGE_DIRS) throw new Error("R3-E package directory bound exceeded");
        entries.push(`D\t${path.posix.join(packageRoot, relative)}`);
        visit(absolute, relative, depth + 1);
      } else if (stat.isFile()) {
        checkCustody(stat, false);
        if (EXCLUDED_NAMES.has(relative)) continue;
        if (stat.size > BigInt(MAX_PACKAGE_FILE_BYTES)) throw new Error("R3-E package file bound exceeded");
        const { digest, size } = hashRegularFile(absolute, stat);
        fileRecords.push({ absolute: path.posix.join(packageRoot, relative), digest });
        files += 1;
        totalBytes += size;
        if (files > MAX_PACKAGE_FILES || totalBytes > MAX_PACKAGE_BYTES) throw new Error("R3-E package file/byte bound exceeded");
        entries.push(`F\t${digest}\t${path.posix.join(packageRoot, relative)}`);
      } else {
        throw new Error("R3-E package has an unsupported file type");
      }
    }
  };
  visit(packageRoot, "", 0);
  const elfDependencies = validateElfClosure(packageRoot, fileRecords);
  const entryPath = (line) => line.startsWith("F\t") ? line.slice(line.indexOf("\t", 2) + 1) : line.slice(2);
  entries.sort((left, right) => {
    const leftPath = entryPath(left);
    const rightPath = entryPath(right);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  const manifest = Buffer.from(`R3E-PACKAGE-V2\n${entries.join("\n")}\n`, "utf8");
  if (manifest.length > MAX_MANIFEST_BYTES || entries.length === 0) throw new Error("R3-E package manifest invalid or too large");
  return { bytes: manifest, fileCount: files, directoryCount: directories, totalBytes, elfDependencies };
}

function writePackageManifest(packageRoot) {
  const { bytes, ...summary } = buildPackageManifest(packageRoot);
  const output = path.join(packageRoot, "package.manifest");
  const existing = (() => {
    try { return fs.lstatSync(output); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  })();
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== 0 || (existing.mode & 0o022) !== 0) {
      throw new Error("R3-E package manifest target is not a protected regular file");
    }
  }
  const temporary = path.join(packageRoot, `.package-manifest-${process.pid}.tmp`);
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o444);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, output);
  fs.chmodSync(output, 0o444);
  process.stdout.write(`${crypto.createHash("sha256").update(bytes).digest("hex")} ${summary.fileCount} files ${summary.directoryCount} directories\n`);
  return output;
}

if (require.main === module) {
  try {
    const root = process.env.ENTA_R3E_PACKAGE_ROOT;
    if (!root) throw new Error("R3-E package root unavailable");
    writePackageManifest(root);
  } catch {
    process.stderr.write("R3-E package manifest assembly unavailable.\n");
    process.exitCode = 1;
  }
}

module.exports = { buildPackageManifest, validRelativePath, validateElfClosure, writePackageManifest };
