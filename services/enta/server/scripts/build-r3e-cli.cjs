"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "../../../..");
const entry = path.join(root, "services/enta/server/src/catalog/r3e-issuer-cli.ts");
const output = path.join(root, "services/enta/server/dist/catalog/r3e-issuer-cli.bundle.cjs");

function removeOnlyGeneratedOutput() {
  try {
    const stat = fs.lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("unexpected private CLI bundle target");
    fs.chmodSync(output, 0o644);
    fs.unlinkSync(output);
  } catch (error) {
    if (!error || error.code !== "ENOENT") throw error;
  }
}

async function main() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  removeOnlyGeneratedOutput();
  await esbuild.build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    sourcemap: false,
    sourcesContent: false,
    legalComments: "none",
    packages: "external",
    logLevel: "silent",
  });
  const stat = fs.lstatSync(output);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > 16 * 1024 * 1024) {
    throw new Error("R3-E private CLI bundle failed output validation");
  }
  fs.chmodSync(output, 0o444);
  process.stdout.write("Built private R3-E CLI bundle; the native launcher still requires a pinned release manifest.\n");
}

main().catch(() => {
  process.stderr.write("R3-E private CLI bundle build failed.\n");
  process.exitCode = 1;
});
