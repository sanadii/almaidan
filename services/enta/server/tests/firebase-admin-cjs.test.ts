import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Firebase Admin JWKS dependency graph loads without CommonJS requiring ESM", () => {
  const script = [
    "require('firebase-admin/auth')",
    "const { retrieveSigningKeys } = require('jwks-rsa/src/utils')",
    "if (typeof retrieveSigningKeys !== 'function') process.exit(2)",
  ].join(";");
  const result = spawnSync(process.execPath, ["--no-experimental-require-module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});
