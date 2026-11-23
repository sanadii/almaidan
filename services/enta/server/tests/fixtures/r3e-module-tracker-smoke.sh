#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT=${1:?pass the isolated checkout root as a mounted WSL path}
FIXTURE_ROOT=/home/maydan-r3e-check
NODE=/home/maydan-r3e-check/node/node-v22.23.3-linux-x64/bin/node
BUILDER="$SOURCE_ROOT/services/enta/server/scripts/build-r3e-package-manifest.cjs"
BOOTSTRAP="$SOURCE_ROOT/services/enta/server/src/catalog/r3e-module-tracker.mjs"
PKG=$(mktemp -d "$FIXTURE_ROOT/e-r4-p2-module.XXXXXX")
chmod 0700 "$PKG"
mkdir -p "$PKG/bin" "$PKG/lib" "$PKG/app/bootstrap" "$PKG/app/native" "$PKG/policy"
cp "$NODE" "$PKG/bin/node"
cp "$BOOTSTRAP" "$PKG/app/bootstrap/r3e-module-tracker.mjs"
cp "$BUILDER" "$PKG/policy/build-r3e-package-manifest.cjs"
printf 'loader-fixture\n' > "$PKG/lib/ld-linux-x86-64.so.2"
printf 'helper-fixture\n' > "$PKG/app/native/r3e-custody"
printf 'launcher-external-fixture\n' > "$PKG/bin/r3e-issuer-launcher"
cat > "$PKG/app/dependency.cjs" <<'JS'
module.exports = Object.freeze({ marker: "R3E_DEPENDENCY_LOADED" });
JS
cat > "$PKG/app/dependency-esm.mjs" <<'JS'
export const marker = "R3E_ESM_DEPENDENCY_LOADED";
JS
cat > "$PKG/app/cli.cjs" <<'JS'
"use strict";
const { pathToFileURL } = require("node:url");
const tracker = globalThis[Symbol.for("maydan.r3e.module-tracker.v2")];
if (!tracker || typeof tracker.snapshot !== "function") process.exit(91);
async function main() {
  const app = `${process.cwd()}/app`;
  const mode = process.env.R3E_TEST_CASE || "positive";
  const denied = (label, operation) => Promise.resolve().then(operation).then(() => false, () => {
    process.stdout.write(`${label}\n`);
    return true;
  });
  if (mode === "unlisted-cjs") {
    if (!await denied("R3E_UNLISTED_CJS_DENIED", () => require(`${app}/unlisted.cjs`))) process.exitCode = 92;
    return;
  }
  if (mode === "unlisted-esm") {
    if (!await denied("R3E_UNLISTED_ESM_DENIED", () => import(`${app}/unlisted.mjs`))) process.exitCode = 93;
    return;
  }
  if (mode === "query-alias" || mode === "fragment-alias") {
    const suffix = mode === "query-alias" ? "?probe=1" : "#probe";
    if (!await denied("R3E_MODULE_URL_ALIAS_DENIED", () => import(pathToFileURL(`${app}/dependency-esm.mjs`).href + suffix))) process.exitCode = 94;
    return;
  }
  if (mode === "child-process") {
    const child = await import("node:child_process");
    if (!await denied("R3E_SUBPROCESS_DENIED", () => child.spawnSync("/usr/bin/true", [], {}))) process.exitCode = 95;
    return;
  }
  if (mode === "worker") {
    if (!await denied("R3E_WORKER_IMPORT_DENIED", () => import("node:worker_threads"))) process.exitCode = 96;
    return;
  }
  const dependency = require(`${app}/dependency.cjs`);
  if (dependency.marker !== "R3E_DEPENDENCY_LOADED" || !tracker.snapshot().includes(`${app}/dependency.cjs`)) process.exitCode = 97;
  const module = await import(`${app}/dependency-esm.mjs`);
  if (module.marker !== "R3E_ESM_DEPENDENCY_LOADED" || !tracker.snapshot().includes(`${app}/dependency-esm.mjs`)) process.exitCode = 98;
  process.stdout.write("R3E_MODULE_TRACKER_MARKER\n");
}
void main().catch(() => { process.exitCode = 99; });
JS
chown -R root:root "$PKG"
chmod 0755 "$PKG" "$PKG/bin" "$PKG/lib" "$PKG/app" "$PKG/app/bootstrap" "$PKG/app/native" "$PKG/policy"
chmod 0555 "$PKG/bin/node"
chmod 0444 "$PKG/app/bootstrap/r3e-module-tracker.mjs" "$PKG/app/dependency.cjs" "$PKG/app/dependency-esm.mjs" "$PKG/app/cli.cjs" "$PKG/policy/build-r3e-package-manifest.cjs"
ENTA_R3E_PACKAGE_ROOT="$PKG" "$NODE" "$PKG/policy/build-r3e-package-manifest.cjs"
MANIFEST_SHA=$(sha256sum "$PKG/package.manifest" | awk '{print $1}')
NODE_SHA=$(sha256sum "$PKG/bin/node" | awk '{print $1}')
CLI_SHA=$(sha256sum "$PKG/app/cli.cjs" | awk '{print $1}')
BOOTSTRAP_SHA=$(sha256sum "$PKG/app/bootstrap/r3e-module-tracker.mjs" | awk '{print $1}')
HELPER_SHA=$(sha256sum "$PKG/app/native/r3e-custody" | awk '{print $1}')
LOADER_SHA=$(sha256sum "$PKG/lib/ld-linux-x86-64.so.2" | awk '{print $1}')
MANIFEST_PATH="$PKG/package.manifest"
CLI_PATH="$PKG/app/cli.cjs"
BOOTSTRAP_PATH="$PKG/app/bootstrap/r3e-module-tracker.mjs"
LAUNCHER_PATH="$PKG/bin/r3e-issuer-launcher"
NODE_PATH="$PKG/bin/node"
HELPER_PATH="$PKG/app/native/r3e-custody"
LOADER_PATH="$PKG/lib/ld-linux-x86-64.so.2"
ENTRY_COUNT=$(($(wc -l < "$PKG/package.manifest") - 1))
CONTEXT=$( {
  printf '%s\n' 'R3E-ISSUER-LAUNCH-V2' 'synthetic-v2' '0123456789abcdef0123456789abcdef'
  printf '%s\n' "$LAUNCHER_PATH" "$(printf 'a%.0s' {1..64})" "$NODE_PATH" "$NODE_SHA" "$CLI_PATH" "$CLI_SHA"
  printf '%s\n' "$BOOTSTRAP_PATH" "$BOOTSTRAP_SHA" "$HELPER_PATH" "$HELPER_SHA" "$LOADER_PATH" "$LOADER_SHA"
  printf '%s\n' "$MANIFEST_PATH" "$MANIFEST_SHA" "$PKG" '999' '999' "$ENTRY_COUNT"
  printf '.'
} )
CONTEXT=${CONTEXT%.}

positive=$(cd "$PKG" && NODE_ENV=production INVOCATION_ID=0123456789abcdef0123456789abcdef MAYDAN_R3E_CONTEXT="$CONTEXT" \
  "$NODE" --import "$BOOTSTRAP_PATH" - < "$CLI_PATH")
test "$positive" = "R3E_MODULE_TRACKER_MARKER"
printf 'POSITIVE %s\n' "$positive"

printf 'process.stdout.write("UNLISTED_EXECUTED\\n");\n' > "$PKG/app/unlisted.cjs"
printf 'export const marker = "UNLISTED_EXECUTED";\n' > "$PKG/app/unlisted.mjs"
chown root:root "$PKG/app/unlisted.cjs"
chown root:root "$PKG/app/unlisted.mjs"
chmod 0444 "$PKG/app/unlisted.cjs" "$PKG/app/unlisted.mjs"
for case_name in unlisted-cjs unlisted-esm query-alias fragment-alias child-process worker; do
  negative=$(cd "$PKG" && NODE_ENV=production INVOCATION_ID=0123456789abcdef0123456789abcdef MAYDAN_R3E_CONTEXT="$CONTEXT" R3E_TEST_CASE="$case_name" \
    "$NODE" --import "$BOOTSTRAP_PATH" - < "$CLI_PATH")
  case "$case_name" in
    unlisted-cjs) expected=R3E_UNLISTED_CJS_DENIED ;;
    unlisted-esm) expected=R3E_UNLISTED_ESM_DENIED ;;
    query-alias|fragment-alias) expected=R3E_MODULE_URL_ALIAS_DENIED ;;
    child-process) expected=R3E_SUBPROCESS_DENIED ;;
    worker) expected=R3E_WORKER_IMPORT_DENIED ;;
  esac
  test "$negative" = "$expected"
  printf 'NEGATIVE %s %s\n' "$case_name" "$negative"
done
printf 'FIXTURE %s\n' "$PKG"
