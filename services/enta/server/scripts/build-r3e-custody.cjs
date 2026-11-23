"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "../../../..");
const source = path.join(repositoryRoot, "services/enta/server/src/catalog/native/r3e-custody.c");
const output = path.join(repositoryRoot, "services/enta/server/dist/catalog/native/r3e-custody");

function removeOnlyGeneratedBinary() {
  try {
    const stat = fs.lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("unexpected generated helper target");
    fs.unlinkSync(output);
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

if (process.platform !== "linux") {
  removeOnlyGeneratedBinary();
  process.stdout.write("R3-E native custody helper omitted on unsupported build platform; issuance remains unavailable.\n");
  process.exit(0);
}

const issuerUid = process.env.ENTA_R3E_ISSUER_UID;
if (!/^[1-9][0-9]{0,9}$/.test(issuerUid || "") || !fs.existsSync(source)) {
  removeOnlyGeneratedBinary();
  process.stdout.write("R3-E native custody helper omitted without an operator-pinned Linux issuer UID; issuance remains unavailable.\n");
  process.exit(0);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const compile = spawnSync("gcc", [
  "-static", "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
  "-DPINNED_ISSUER_UID=" + issuerUid, source, "-o", output,
], { stdio: "inherit", shell: false });
if (compile.error || compile.status !== 0) {
  removeOnlyGeneratedBinary();
  process.stderr.write("R3-E native custody helper compilation failed.\n");
  process.exit(1);
}
const stat = fs.lstatSync(output);
if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1) {
  throw new Error("R3-E native custody helper output is not a regular file");
}
fs.chmodSync(output, 0o555);
process.stdout.write("Built R3-E native custody helper for pinned issuer UID " + issuerUid + ".\n");
