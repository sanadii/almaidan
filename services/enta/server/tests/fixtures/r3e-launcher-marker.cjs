"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

function fail() {
  process.stderr.write("R3E_FIXTURE_DENIED\n");
  process.exit(90);
}

function hashDescriptor(number, maxBytes) {
  const filename = `/proc/self/fd/${number}`;
  const stat = fs.statSync(filename);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxBytes) fail();
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== stat.size) fail();
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readLaunchContext() {
  const raw = process.env.MAYDAN_R3E_CONTEXT;
  if (!raw || Buffer.byteLength(raw, "utf8") > 8192) fail();
  const lines = raw.split("\n");
  if (lines.at(-1) !== "") fail();
  lines.pop();
  if (lines.length !== 18 || lines[0] !== "R3E-ISSUER-LAUNCH-V1" || lines.some((line) => line.includes("\r"))) fail();
  const [
    , releaseId, launcherPath, launcherSha, nodePath, nodeSha, cliPath, cliSha,
    helperPath, helperSha, loaderPath, loaderSha, manifestPath, manifestSha,
    packageRoot, uidText, gidText, entryCountText,
  ] = lines;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(releaseId) ||
      ![launcherSha, nodeSha, cliSha, helperSha, loaderSha, manifestSha].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      ![launcherPath, nodePath, cliPath, helperPath, loaderPath, manifestPath, packageRoot].every((value) => value.startsWith("/home/maydan-r3e-check/e-r4-fixture/package")) ||
      uidText !== "999" || gidText !== "999" || !/^(0|[1-9][0-9]{0,4})$/.test(entryCountText)) fail();
  return { releaseId, launcherSha, nodeSha, cliSha, helperSha };
}

function verifyProcess(context) {
  const allowed = new Set(["NODE_ENV", "MAYDAN_R3E_CONTEXT"]);
  if (Object.keys(process.env).some((key) => !allowed.has(key)) || process.env.NODE_ENV !== "production" ||
      process.argv.length !== 3 || process.argv[1] !== "-" || process.argv[2] !== context.releaseId ||
      process.cwd() !== "/home/maydan-r3e-check/e-r4-fixture/package" ||
      process.getuid() !== 999 || process.geteuid() !== 999 || process.getgid() !== 999 || process.getegid() !== 999 ||
      JSON.stringify(process.getgroups().sort((a, b) => a - b)) !== "[999]") fail();

  const status = fs.readFileSync("/proc/self/status", "utf8");
  for (const key of ["CapEff", "CapPrm", "CapInh", "CapAmb", "CapBnd"]) {
    if (!new RegExp(`^${key}:\\s+0+$`, "m").test(status)) fail();
  }
  if (!/^NoNewPrivs:\s+1$/m.test(status) || fs.readFileSync("/proc/1/comm", "utf8").trim() !== "systemd" ||
      process.ppid !== 1 || fs.readFileSync("/proc/self/cgroup", "utf8").trim() !== "0::/system.slice/r3e-e4-fixture-good.service") fail();

  if (hashDescriptor(32, 256 * 1024 * 1024) !== context.nodeSha) fail();
}

const context = readLaunchContext();
verifyProcess(context);
process.stdout.write(`R3E_FIXTURE_MARKER:${context.releaseId}\n`);
