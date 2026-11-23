#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT=${1:?pass the isolated checkout root as a mounted WSL path}
FIXTURE_ROOT=/home/maydan-r3e-check
NODE=/home/maydan-r3e-check/node/node-v22.23.3-linux-x64/bin/node
TAG="$(date +%s)-$$"
# The application launch-context verifier pins this exact unit cgroup. This
# fixture refuses to run if that system unit name is already present or active.
UNIT="enta-r3e-issuer.service"
CGROUP="/system.slice/${UNIT}"
PKG="/opt/maydan-r3e-synthetic-${TAG}"
STAGE="$FIXTURE_ROOT/rootimage-stage-${TAG}"
ROOTFS="$STAGE/rootfs"
IMAGE="$STAGE/rootimage.ext4"
UNLISTED_IMAGE="$STAGE/rootimage-unlisted-esm.ext4"
SOURCE="$STAGE/native-src"
UNLISTED_ROOTFS="$STAGE/rootfs-unlisted-esm"
UNIT_FILE="/run/systemd/system/${UNIT}"
RECEIPT="$STAGE/prelaunch-receipt.sha256"
BUILD_ROOT="$STAGE/build-root"
PRISMA_WORK="$STAGE/prisma-work"
MOUNTPOINT="$STAGE/image-mount"
UNLISTED_MOUNTPOINT="$STAGE/image-unlisted-mount"
ACTIVE_IMAGE="$IMAGE"
LOG_MARKER="R3E_ROOTIMAGE_MARKER_${TAG}"
MOUNTED=0

cleanup_unit() {
  systemctl stop "$UNIT" >/dev/null 2>&1 || true
  if [ -f "$UNIT_FILE" ] && [ "$(realpath -m "$UNIT_FILE")" = "$UNIT_FILE" ]; then
    rm -f -- "$UNIT_FILE"
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  if [ "$MOUNTED" = 1 ]; then
    umount "$MOUNTPOINT" || true
    MOUNTED=0
  fi
}
trap cleanup_unit EXIT

test "$(id -u)" = 0
test ! -e "$PKG" && test ! -e "$STAGE" && test ! -e "$UNIT_FILE"
mkdir -m 0700 "$STAGE" "$PKG" "$SOURCE"
mkdir -p "$PRISMA_WORK/services/enta/server/prisma"
cp "$SOURCE_ROOT/services/enta/server/prisma/schema.prisma" "$PRISMA_WORK/services/enta/server/prisma/schema.prisma"
printf '{"private":true}\n' > "$PRISMA_WORK/package.json"
export PATH="$(dirname "$NODE"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
npm --prefix "$PRISMA_WORK" install --no-audit --no-fund @prisma/client@5.22.0 prisma@5.22.0
"$PRISMA_WORK/node_modules/.bin/prisma" generate --schema="$PRISMA_WORK/services/enta/server/prisma/schema.prisma"
mkdir -p "$PKG/bin" "$PKG/lib" "$PKG/app/bootstrap" "$PKG/app/native" "$PKG/policy"
mkdir -p "$ROOTFS" \
  "$ROOTFS/dev" "$ROOTFS/run" "$ROOTFS/proc" "$ROOTFS/sys" "$ROOTFS/home" "$ROOTFS/root" \
  "$ROOTFS/mnt" "$ROOTFS/media" "$ROOTFS/var/tmp" "$ROOTFS/etc" "$ROOTFS/usr/bin" "$ROOTFS/usr/lib" \
  "$ROOTFS/opt" "$ROOTFS$(dirname "$PKG")"

cp "$NODE" "$PKG/bin/node"
cp "$SOURCE_ROOT/services/enta/server/src/catalog/r3e-module-tracker.mjs" "$PKG/app/bootstrap/r3e-module-tracker.mjs"
cp "$SOURCE_ROOT/services/enta/server/scripts/build-r3e-package-manifest.cjs" "$PKG/policy/build-r3e-package-manifest.cjs"
cp -L /lib64/ld-linux-x86-64.so.2 "$PKG/lib/ld-linux-x86-64.so.2"
for soname in libdl.so.2 libstdc++.so.6 libm.so.6 libgcc_s.so.1 libpthread.so.0 libc.so.6 \
  libssl.so.3 libcrypto.so.3 librt.so.1 libz.so.1 libzstd.so.1; do
  cp -L "/usr/lib/x86_64-linux-gnu/$soname" "$PKG/lib/$soname"
done
cp "$SOURCE_ROOT/services/enta/server/src/catalog/native/r3e-custody.c" "$SOURCE/r3e-custody.c"
cp "$SOURCE_ROOT/services/enta/server/src/catalog/native/r3e-issuer-launcher.c" "$SOURCE/r3e-issuer-launcher.c"
printf 'launcher-external-pin\n' > "$PKG/bin/r3e-issuer-launcher"
mkdir -p "$PKG/app/fixture"
mkdir -p "$PKG/node_modules/@prisma/client" "$PKG/node_modules/.prisma/client"
cp "$SOURCE_ROOT/services/enta/server/dist/catalog/"*.js "$PKG/app/"
cp "$SOURCE_ROOT/services/enta/server/dist/catalog/r3e-issuer-cli.bundle.cjs" "$PKG/app/"
cp -a "$PRISMA_WORK/node_modules/@prisma/client/." "$PKG/node_modules/@prisma/client/"
cp -a "$PRISMA_WORK/node_modules/.prisma/client/." "$PKG/node_modules/.prisma/client/"
ENGINE_PATH=$(find "$PKG/node_modules/.prisma/client" -maxdepth 1 -type f -name 'libquery_engine-*.so.node' -print -quit)
test -n "$ENGINE_PATH"
test "$(find "$PKG/node_modules/.prisma/client" -maxdepth 1 -type f -name 'libquery_engine-*.so.node' | wc -l)" -eq 1
if readelf -d "$ENGINE_PATH" | grep -E '\((RPATH|RUNPATH)\)' >/dev/null; then
  printf 'Prisma native engine has an RPATH/RUNPATH and is not accepted in the package.\n' >&2
  exit 1
fi
if ldd "$ENGINE_PATH" | grep -F 'not found' >/dev/null; then
  printf 'Prisma native engine has an unresolved ELF dependency.\n' >&2
  exit 1
fi
for required_library in libssl.so.3 libcrypto.so.3 libgcc_s.so.1 librt.so.1 libpthread.so.0 \
  libm.so.6 libdl.so.2 libc.so.6 libz.so.1 libzstd.so.1; do
  test -f "$PKG/lib/$required_library"
done

# Exercise the same committed ELF validator against isolated package roots.
# A matching host SONAME must not satisfy a package whose engine dependency is
# absent, and neither RPATH nor RUNPATH may enter a candidate image.
test -f /usr/lib/x86_64-linux-gnu/libssl.so.3
MISSING_LIBRARY_ROOT="$STAGE/package-missing-soname"
mkdir -p "$MISSING_LIBRARY_ROOT/policy" "$MISSING_LIBRARY_ROOT/node_modules/.prisma/client"
cp "$ENGINE_PATH" "$MISSING_LIBRARY_ROOT/node_modules/.prisma/client/$(basename "$ENGINE_PATH")"
cp "$PKG/policy/build-r3e-package-manifest.cjs" "$MISSING_LIBRARY_ROOT/policy/build-r3e-package-manifest.cjs"
chown -R root:root "$MISSING_LIBRARY_ROOT"
find "$MISSING_LIBRARY_ROOT" -type d -exec chmod 0755 {} +
find "$MISSING_LIBRARY_ROOT" -type f -exec chmod 0444 {} +
if ENTA_R3E_PACKAGE_ROOT="$MISSING_LIBRARY_ROOT" "$NODE" "$MISSING_LIBRARY_ROOT/policy/build-r3e-package-manifest.cjs" >/dev/null 2>&1; then
  printf 'ELF validator accepted a host-only libssl fallback.\n' >&2
  exit 1
fi
printf 'NEGATIVE HOST_LIBRARY_FALLBACK_DENIED host-libssl-present=1\n'

for linker_flag in '-Wl,-rpath,/tmp' '-Wl,--enable-new-dtags,-rpath,/tmp'; do
  case "$linker_flag" in
    *enable-new-dtags*) tag_name=RUNPATH ;;
    *) tag_name=RPATH ;;
  esac
  RPATH_ROOT="$STAGE/package-$tag_name"
  mkdir -p "$RPATH_ROOT/policy" "$RPATH_ROOT/bin"
  cp "$PKG/policy/build-r3e-package-manifest.cjs" "$RPATH_ROOT/policy/build-r3e-package-manifest.cjs"
  printf 'int main(void) { return 0; }\n' | gcc -x c - "$linker_flag" -o "$RPATH_ROOT/bin/linked"
  chown -R root:root "$RPATH_ROOT"
  find "$RPATH_ROOT" -type d -exec chmod 0755 {} +
  find "$RPATH_ROOT" -type f -exec chmod 0444 {} +
  if ENTA_R3E_PACKAGE_ROOT="$RPATH_ROOT" "$NODE" "$RPATH_ROOT/policy/build-r3e-package-manifest.cjs" >/dev/null 2>&1; then
    printf 'ELF validator accepted %s.\n' "$tag_name" >&2
    exit 1
  fi
  printf 'NEGATIVE ELF_%s_DENIED\n' "$tag_name"
done
cat > "$PKG/policy/issuer-runtime.conf" <<EOF
R3E-ISSUER-RUNTIME-V1
ENTA_R3C_REGISTRY_DIR=$PKG/policy/registry
ENTA_R3E_MANIFEST_SHA256=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
ENTA_R3E_REVOCATIONS_PATH=$PKG/policy/revocations.json
ENTA_R3E_TRUST_ANCHOR_PATH=$PKG/policy/anchor.json
EOF
cat > "$PKG/app/fixture/dependency.cjs" <<'JS'
module.exports = Object.freeze({ marker: "R3E_CJS_DEPENDENCY_LOADED" });
JS
cat > "$PKG/app/fixture/dependency-esm.mjs" <<'JS'
export const marker = "R3E_ESM_DEPENDENCY_LOADED";
JS

cat > "$PKG/app/issuer-cli.cjs" <<'JS'
"use strict";
const { pathToFileURL } = require("node:url");
const tracker = globalThis[Symbol.for("maydan.r3e.module-tracker.v2")];
if (!tracker || typeof tracker.snapshot !== "function") process.exit(91);
let stage = "cjs";
async function expectDenied(label, operation) {
  try { await operation(); process.exitCode = 92; return false; }
  catch { return true; }
}
async function main() {
  const cjs = require(`${process.cwd()}/app/fixture/dependency.cjs`);
  if (cjs.marker !== "R3E_CJS_DEPENDENCY_LOADED") process.exit(93);
  stage = "esm";
  const esm = await import(`${process.cwd()}/app/fixture/dependency-esm.mjs`);
  if (esm.marker !== "R3E_ESM_DEPENDENCY_LOADED") process.exit(94);
  stage = "precredential-measurement";
  const beforeCredential = tracker.measureExecution();
  if (!/^[a-f0-9]{64}$/.test(beforeCredential.sha256) || beforeCredential.modules.length < 4) process.exit(102);
  const esmPath = `${process.cwd()}/app/fixture/dependency-esm.mjs`;
  stage = "query";
  if (!await expectDenied("query", () => import(pathToFileURL(esmPath).href + "?x=1"))) process.exit(95);
  stage = "fragment";
  if (!await expectDenied("fragment", () => import(pathToFileURL(esmPath).href + "#x"))) process.exit(96);
  stage = "data-url";
  if (!await expectDenied("data", () => import("data:text/javascript,globalThis.R3E_DATA_ALIAS_RAN=true"))) process.exit(97);
  stage = "child-process";
  const child = await import("node:child_process");
  const custody = child.spawnSync(`${process.cwd()}/app/native/r3e-custody`, [esmPath], {
    encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true, shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (custody.status !== 0 || !custody.stdout.startsWith("R3E-CUSTODY-V1\t")) {
    const safeStatus = Number.isInteger(custody.status) ? String(custody.status) : "null";
    const safeError = custody.error && typeof custody.error.code === "string" ? custody.error.code : "none";
    const safePrefix = JSON.stringify(String(custody.stdout || "").slice(0, 40));
    process.stderr.write(`R3E_HELPER_RESULT status=${safeStatus} error=${safeError} stdout-prefix=${safePrefix}\n`);
    process.exit(98);
  }
  if (!await expectDenied("child-process", () => child.spawnSync("/usr/bin/true", [], {}))) process.exit(99);
  stage = "worker";
  if (!await expectDenied("worker", () => import("node:worker_threads"))) process.exit(100);
  stage = "snapshot";
  const loaded = tracker.snapshot();
  if (!loaded.includes(`${process.cwd()}/app/fixture/dependency.cjs`) ||
      !loaded.includes(`${process.cwd()}/app/fixture/dependency-esm.mjs`)) process.exit(100);
  const afterCredentialBoundary = tracker.measureExecution();
  const laterModules = new Map(afterCredentialBoundary.modules);
  if (!beforeCredential.modules.every(([filename, digest]) => laterModules.get(filename) === digest)) process.exit(103);
  process.stdout.write("R3E_ROOTIMAGE_MARKER:CJS,ESM,query-denied,fragment-denied,data-denied,subprocess-denied,worker-denied\n");
  stage = "actual-issuer-cli";
  let issuerDiagnostic = "";
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk) => { issuerDiagnostic += String(chunk); return true; });
  process.exitCode = undefined;
  try {
    require(`${process.cwd()}/app/r3e-issuer-cli.bundle.cjs`);
    for (let attempt = 0; attempt < 250 && process.exitCode === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    process.stderr.write = originalStderrWrite;
  }
  if (process.exitCode !== 78 || !issuerDiagnostic.includes("R3E_ISSUER_UNAVAILABLE:R3E_DATABASE_CREDENTIAL_UNAVAILABLE")) {
    const diagnostic = issuerDiagnostic.includes("R3E_DATABASE_CREDENTIAL_UNAVAILABLE") ? "DATABASE_CREDENTIAL_UNAVAILABLE" :
      issuerDiagnostic.includes("R3E_PRE_CREDENTIAL_PACKAGE_CLOSURE_INVALID") ? "PRE_CREDENTIAL_CLOSURE_UNAVAILABLE" :
      issuerDiagnostic.includes("R3E_OPERATOR_POLICY_UNAVAILABLE") ? "OPERATOR_POLICY_UNAVAILABLE" :
      issuerDiagnostic.includes("R3E_LAUNCH_CONTEXT_REQUIRED") ? "LAUNCH_CONTEXT_REQUIRED" :
      issuerDiagnostic.includes("R3E_PRIVATE_EXECUTION_FAILED") ? "PRIVATE_EXECUTION_FAILED" : "UNEXPECTED_PRIVATE_CLI_RESULT";
    process.stderr.write(`R3E_ACTUAL_CLI_DIAGNOSTIC:${diagnostic}:status=${String(process.exitCode)}\n`);
    process.exit(104);
  }
  process.stdout.write("R3E_ACTUAL_CLI_PRE_CREDENTIAL_MEASURED:DB_CREDENTIAL_UNAVAILABLE\n");
  process.exitCode = 0;
}
void main().catch((error) => {
  const code = error && typeof error.code === "string" ? error.code : error?.name === "Error" ? "ERROR" : "UNKNOWN";
  const message = error && typeof error.message === "string" && /^R3E_[A-Z0-9_]{1,80}$/.test(error.message)
    ? error.message : code;
  process.stderr.write(`R3E_MARKER_FAILURE:${stage}:${message}\n`);
  process.exitCode = 101;
});
JS
sed -i "s/R3E_ROOTIMAGE_MARKER/${LOG_MARKER}/g; s/R3E_ACTUAL_CLI_PRE_CREDENTIAL_MEASURED/R3E_ACTUAL_CLI_PRE_CREDENTIAL_MEASURED_${TAG}/g" "$PKG/app/issuer-cli.cjs"

mkdir -p "$BUILD_ROOT/services/enta/server/scripts" "$BUILD_ROOT/services/enta/server/src/catalog/native"
cp "$SOURCE_ROOT/services/enta/server/scripts/build-r3e-launcher.cjs" "$BUILD_ROOT/services/enta/server/scripts/build-r3e-launcher.cjs"
cp "$SOURCE/r3e-issuer-launcher.c" "$BUILD_ROOT/services/enta/server/src/catalog/native/r3e-issuer-launcher.c"
cp "$SOURCE/r3e-custody.c" "$BUILD_ROOT/services/enta/server/src/catalog/native/r3e-custody.c"

chown -R root:root "$PKG" "$SOURCE" "$BUILD_ROOT" "$ROOTFS"
find "$PKG" -type d -exec chmod 0755 {} +
find "$PKG" -type f -exec chmod 0444 {} +
chmod 0555 "$PKG/bin/node"
chmod 0555 "$PKG/lib/ld-linux-x86-64.so.2"
for soname in "$PKG"/lib/lib*.so*; do chmod 0555 "$soname"; done

gcc -static -std=c11 -O2 -Wall -Wextra -Werror -DPINNED_ISSUER_UID=999 "$SOURCE/r3e-custody.c" -o "$PKG/app/native/r3e-custody"
if readelf -l "$PKG/app/native/r3e-custody" | grep -F INTERP >/dev/null; then
  printf 'Expected the RootImage custody helper to have no ELF interpreter.\n' >&2
  exit 1
fi
chown root:root "$PKG/app/native/r3e-custody"
chmod 0555 "$PKG/app/native/r3e-custody"
chmod 0444 "$PKG/app/issuer-cli.cjs" "$PKG/app/fixture/dependency.cjs" "$PKG/app/fixture/dependency-esm.mjs" \
  "$PKG/app/bootstrap/r3e-module-tracker.mjs" "$PKG/policy/build-r3e-package-manifest.cjs"
chown -R root:root "$ROOTFS" "$BUILD_ROOT"
find "$BUILD_ROOT" -type d -exec chmod 0755 {} +
find "$BUILD_ROOT" -type f -exec chmod 0444 {} +

MANIFEST_PATH="$PKG/package.manifest"
NODE_PATH="$PKG/bin/node"
CLI_PATH="$PKG/app/issuer-cli.cjs"
BOOTSTRAP_PATH="$PKG/app/bootstrap/r3e-module-tracker.mjs"
HELPER_PATH="$PKG/app/native/r3e-custody"
LOADER_PATH="$PKG/lib/ld-linux-x86-64.so.2"
LAUNCHER_PATH="$PKG/bin/r3e-issuer-launcher"
LIBRARY_PATH="$PKG/lib"
ENTA_R3E_PACKAGE_ROOT="$PKG" "$NODE" "$PKG/policy/build-r3e-package-manifest.cjs"
MANIFEST_SHA=$(sha256sum "$PKG/package.manifest" | awk '{print $1}')
NODE_SHA=$(sha256sum "$PKG/bin/node" | awk '{print $1}')
CLI_SHA=$(sha256sum "$PKG/app/issuer-cli.cjs" | awk '{print $1}')
BOOTSTRAP_SHA=$(sha256sum "$PKG/app/bootstrap/r3e-module-tracker.mjs" | awk '{print $1}')
HELPER_SHA=$(sha256sum "$PKG/app/native/r3e-custody" | awk '{print $1}')
LOADER_SHA=$(sha256sum "$PKG/lib/ld-linux-x86-64.so.2" | awk '{print $1}')
EXPECTED_CGROUP="/system.slice/$UNIT"
env \
  ENTA_R3E_ISSUER_UID=999 ENTA_R3E_ISSUER_GID=999 \
  ENTA_R3E_EXPECTED_CGROUP="$EXPECTED_CGROUP" ENTA_R3E_PACKAGE_ROOT="$PKG" \
  ENTA_R3E_MANIFEST_PATH="$MANIFEST_PATH" ENTA_R3E_MANIFEST_SHA256="$MANIFEST_SHA" \
  ENTA_R3E_NODE_PATH="$NODE_PATH" ENTA_R3E_CLI_PATH="$CLI_PATH" \
  ENTA_R3E_BOOTSTRAP_PATH="$BOOTSTRAP_PATH" ENTA_R3E_HELPER_PATH="$HELPER_PATH" \
  ENTA_R3E_LOADER_PATH="$LOADER_PATH" ENTA_R3E_LIBRARY_PATH="$LIBRARY_PATH" \
  ENTA_R3E_LAUNCHER_PATH="$LAUNCHER_PATH" \
  "$NODE" "$BUILD_ROOT/services/enta/server/scripts/build-r3e-launcher.cjs"
LAUNCHER_SHA=$(sha256sum "$LAUNCHER_PATH" | awk '{print $1}')

mkdir -p "$ROOTFS$(dirname "$PKG")"
cp -a "$PKG" "$ROOTFS$(dirname "$PKG")/"
printf 'NAME="Maydan R3E synthetic root image"\nID=maydan-r3e-fixture\n' > "$ROOTFS/etc/os-release"
chown -R root:root "$ROOTFS"
IMAGE_SIZE=512M
truncate -s "$IMAGE_SIZE" "$IMAGE"
mkfs.ext4 -F -q -L "r3e-fixture" "$IMAGE"
mkdir -m 0700 "$MOUNTPOINT"
mount -o loop "$IMAGE" "$MOUNTPOINT"
MOUNTED=1
cp -a "$ROOTFS/." "$MOUNTPOINT/"
sync
umount "$MOUNTPOINT"
MOUNTED=0

write_unit() {
  local include_node_options=${1:-no}
  local bind_package_library=${2:-no}
  {
    cat <<EOF
[Unit]
Description=Disposable R3-E launcher proof ${TAG}
After=local-fs.target

[Service]
Type=oneshot
User=999
Group=999
SupplementaryGroups=
RootImage=${ACTIVE_IMAGE}
RootImageOptions=ro
PrivateMounts=yes
ExecStart=${LAUNCHER_PATH} synthetic-release-${TAG}
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectProc=invisible
SetLoginEnvironment=no
MemoryPressureWatch=no
UnsetEnvironment=PATH JOURNAL_STREAM LANG LANGUAGE LC_ALL LC_CTYPE USER LOGNAME HOME SHELL SYSTEMD_EXEC_PID MEMORY_PRESSURE_WATCH MEMORY_PRESSURE_WRITE
StandardOutput=journal
StandardError=journal
TimeoutStartSec=30
EOF
    if [ "$include_node_options" = yes ]; then
      printf 'Environment=NODE_OPTIONS=--require=/untrusted/preload.cjs\n'
    fi
    if [ "$bind_package_library" = yes ]; then
      printf 'BindReadOnlyPaths=/usr/lib/x86_64-linux-gnu/libssl.so.3:%s/lib/libssl.so.3\n' "$PKG"
    fi
  } > "$UNIT_FILE"
  chown root:root "$UNIT_FILE"
  chmod 0644 "$UNIT_FILE"
  systemctl daemon-reload
  sha256sum "$ACTIVE_IMAGE" "$UNIT_FILE" "$LAUNCHER_PATH" "$MANIFEST_PATH" > "$RECEIPT"
  (cd / && sha256sum --check --status "$RECEIPT")
}

write_unit yes
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected NODE_OPTIONS to be rejected before Node, but service succeeded.\n' >&2
  exit 1
fi
NEGATIVE_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
NEGATIVE_LOG=$(journalctl --no-pager -u "$UNIT" --since '2 minutes ago' 2>/dev/null || true)
test "$NEGATIVE_STATUS" = 67
printf '%s\n' "$NEGATIVE_LOG" | grep -F 'R3E_LAUNCH_DENIED:67' >/dev/null
if printf '%s\n' "$NEGATIVE_LOG" | grep -F "$LOG_MARKER" >/dev/null; then
  printf 'NODE_OPTIONS denial reached JavaScript.\n' >&2
  exit 1
fi
printf 'NEGATIVE NODE_OPTIONS_DENIED status=%s\n' "$NEGATIVE_STATUS"

write_unit no
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if ! systemctl start --wait "$UNIT"; then
  systemctl show --property=ExecMainStatus --property=Result "$UNIT" >&2
  journalctl --no-pager -u "$UNIT" --since '2 minutes ago' >&2 || true
  exit 1
fi
POSITIVE_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
POSITIVE_LOG=$(journalctl --no-pager -u "$UNIT" --since '2 minutes ago' 2>/dev/null || true)
test "$POSITIVE_STATUS" = 0
printf '%s\n' "$POSITIVE_LOG" | grep -F "$LOG_MARKER:CJS,ESM,query-denied,fragment-denied,data-denied,subprocess-denied,worker-denied" >/dev/null
printf '%s\n' "$POSITIVE_LOG" | grep -F "R3E_ACTUAL_CLI_PRE_CREDENTIAL_MEASURED_${TAG}:DB_CREDENTIAL_UNAVAILABLE" >/dev/null
printf 'POSITIVE ROOTIMAGE_MARKER status=%s\n' "$POSITIVE_STATUS"
printf 'POSITIVE ACTUAL_CLI_PRE_CREDENTIAL_MEASUREMENT status=%s\n' "$POSITIVE_STATUS"

cp "$RECEIPT" "$STAGE/prelaunch-receipt-positive.sha256"

MARKER_COUNT_BEFORE=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cF "$LOG_MARKER" || true)
write_unit no yes
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected a package library bind mount to be rejected before JavaScript, but service succeeded.\n' >&2
  exit 1
fi
BIND_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
BIND_LOG=$(journalctl --no-pager -u "$UNIT" --since '2 minutes ago' 2>/dev/null || true)
test "$BIND_STATUS" = 67
printf '%s\n' "$BIND_LOG" | grep -F 'R3E_LAUNCH_DENIED:67' >/dev/null
MARKER_COUNT_AFTER=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cF "$LOG_MARKER" || true)
test "$MARKER_COUNT_BEFORE" = "$MARKER_COUNT_AFTER"
printf 'NEGATIVE PACKAGE_BIND_MOUNT_DENIED status=%s marker-count=%s\n' "$BIND_STATUS" "$MARKER_COUNT_AFTER"

cp -a "$ROOTFS" "$UNLISTED_ROOTFS"
printf 'export const marker = "UNLISTED_ESM_MUST_NOT_RUN";\n' > "$UNLISTED_ROOTFS$PKG/app/fixture/unlisted.mjs"
chown root:root "$UNLISTED_ROOTFS$PKG/app/fixture/unlisted.mjs"
chmod 0444 "$UNLISTED_ROOTFS$PKG/app/fixture/unlisted.mjs"
truncate -s "$IMAGE_SIZE" "$UNLISTED_IMAGE"
mkfs.ext4 -F -q -L "r3e-extra" "$UNLISTED_IMAGE"
mkdir -m 0700 "$UNLISTED_MOUNTPOINT"
MOUNTPOINT="$UNLISTED_MOUNTPOINT"
mount -o loop "$UNLISTED_IMAGE" "$UNLISTED_MOUNTPOINT"
MOUNTED=1
cp -a "$UNLISTED_ROOTFS/." "$UNLISTED_MOUNTPOINT/"
sync
umount "$UNLISTED_MOUNTPOINT"
MOUNTED=0

MARKER_COUNT_BEFORE=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cF "$LOG_MARKER" || true)
ACTIVE_IMAGE="$UNLISTED_IMAGE"
write_unit no
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected unlisted ESM payload to be rejected before JavaScript, but service succeeded.\n' >&2
  exit 1
fi
UNLISTED_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
UNLISTED_LOG=$(journalctl --no-pager -u "$UNIT" --since '2 minutes ago' 2>/dev/null || true)
test "$UNLISTED_STATUS" = 70
printf '%s\n' "$UNLISTED_LOG" | grep -F 'R3E_LAUNCH_DENIED:70' >/dev/null
MARKER_COUNT_AFTER=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cF "$LOG_MARKER" || true)
test "$MARKER_COUNT_BEFORE" = "$MARKER_COUNT_AFTER"
printf 'NEGATIVE UNLISTED_ESM_PACKAGE_ENTRY_DENIED status=%s marker-count=%s\n' "$UNLISTED_STATUS" "$MARKER_COUNT_AFTER"

# Build a second image whose launcher pins the actual CLI bundle as the
# descriptor-backed stdin program. The earlier wrapper remains diagnostic; it
# cannot satisfy this launch-context test.
DIRECT_ROOTFS="$STAGE/rootfs-direct-bundle"
DIRECT_PKG="$DIRECT_ROOTFS$PKG"
DIRECT_IMAGE="$STAGE/rootimage-direct-bundle.ext4"
DIRECT_UNLISTED_ROOTFS="$STAGE/rootfs-direct-bundle-unlisted-esm"
DIRECT_UNLISTED_IMAGE="$STAGE/rootimage-direct-bundle-unlisted-esm.ext4"
DIRECT_MOUNTPOINT="$STAGE/image-direct-mount"
DIRECT_UNLISTED_MOUNTPOINT="$STAGE/image-direct-unlisted-mount"
cp -a "$ROOTFS" "$DIRECT_ROOTFS"
CLI_PATH="$PKG/app/r3e-issuer-cli.bundle.cjs"
CLI_SHA=$(sha256sum "$CLI_PATH" | awk '{print $1}')
EXPECTED_CGROUP="/system.slice/$UNIT"
EXPECTED_CLI_RECORD=$(printf 'F\t%s\t%s' "$CLI_SHA" "$CLI_PATH")
env \
  ENTA_R3E_ISSUER_UID=999 ENTA_R3E_ISSUER_GID=999 \
  ENTA_R3E_EXPECTED_CGROUP="$EXPECTED_CGROUP" ENTA_R3E_PACKAGE_ROOT="$PKG" \
  ENTA_R3E_MANIFEST_PATH="$MANIFEST_PATH" ENTA_R3E_MANIFEST_SHA256="$MANIFEST_SHA" \
  ENTA_R3E_NODE_PATH="$NODE_PATH" ENTA_R3E_CLI_PATH="$CLI_PATH" \
  ENTA_R3E_BOOTSTRAP_PATH="$BOOTSTRAP_PATH" ENTA_R3E_HELPER_PATH="$HELPER_PATH" \
  ENTA_R3E_LOADER_PATH="$LOADER_PATH" ENTA_R3E_LIBRARY_PATH="$LIBRARY_PATH" \
  ENTA_R3E_LAUNCHER_PATH="$LAUNCHER_PATH" \
  "$NODE" "$BUILD_ROOT/services/enta/server/scripts/build-r3e-launcher.cjs"
test "$(grep -Fxc "$EXPECTED_CLI_RECORD" "$MANIFEST_PATH")" -eq 1
cp "$LAUNCHER_PATH" "$DIRECT_PKG/bin/r3e-issuer-launcher"
chown root:root "$DIRECT_PKG/bin/r3e-issuer-launcher"
chmod 0555 "$DIRECT_PKG/bin/r3e-issuer-launcher"
chown -R root:root "$DIRECT_ROOTFS"

truncate -s "$IMAGE_SIZE" "$DIRECT_IMAGE"
mkfs.ext4 -F -q -L "r3e-direct" "$DIRECT_IMAGE"
mkdir -m 0700 "$DIRECT_MOUNTPOINT"
MOUNTPOINT="$DIRECT_MOUNTPOINT"
mount -o loop "$DIRECT_IMAGE" "$DIRECT_MOUNTPOINT"
MOUNTED=1
cp -a "$DIRECT_ROOTFS/." "$DIRECT_MOUNTPOINT/"
sync
umount "$DIRECT_MOUNTPOINT"
MOUNTED=0

ACTIVE_IMAGE="$DIRECT_IMAGE"
write_unit no
DIRECT_RECEIPT="$STAGE/prelaunch-receipt-direct-positive.sha256"
DIRECT_CREDENTIAL_PATH="$DIRECT_ROOTFS/run/credentials/$UNIT/database-url"
test ! -e "$DIRECT_CREDENTIAL_PATH"
! grep -q '^LoadCredential' "$UNIT_FILE"
if systemctl start --wait "$UNIT"; then
  printf 'Expected the direct pinned CLI to stop at missing credential, but service succeeded.\n' >&2
  exit 1
fi
DIRECT_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
test "$DIRECT_STATUS" = 78
DIRECT_INVOCATION_ID=$(systemctl show --property=InvocationID --value "$UNIT")
[[ "$DIRECT_INVOCATION_ID" =~ ^[a-f0-9]{32}$ ]]
DIRECT_LOG=$(journalctl --no-pager -o cat "_SYSTEMD_INVOCATION_ID=$DIRECT_INVOCATION_ID" 2>/dev/null || true)
MEASURED_LINE=$(printf '%s\n' "$DIRECT_LOG" | grep -nFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' | cut -d: -f1 | head -n1)
CREDENTIAL_LINE=$(printf '%s\n' "$DIRECT_LOG" | grep -nFx 'R3E_ISSUER_UNAVAILABLE:R3E_DATABASE_CREDENTIAL_UNAVAILABLE' | cut -d: -f1 | head -n1)
test -n "$MEASURED_LINE" && test -n "$CREDENTIAL_LINE" && test "$MEASURED_LINE" -lt "$CREDENTIAL_LINE"
printf 'POSITIVE DIRECT_PINNED_BUNDLE_PRE_CREDENTIAL status=%s cli=%s cli-sha=%s\n' "$DIRECT_STATUS" "$CLI_PATH" "$CLI_SHA"
cp "$RECEIPT" "$DIRECT_RECEIPT"

# Retain the same critical denials against the exact direct-bundle image.
DIRECT_MARKER_COUNT_BEFORE=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' || true)
write_unit yes
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected NODE_OPTIONS denial for direct CLI image.\n' >&2
  exit 1
fi
DIRECT_NODE_OPTIONS_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
test "$DIRECT_NODE_OPTIONS_STATUS" = 67
DIRECT_MARKER_COUNT_AFTER=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' || true)
test "$DIRECT_MARKER_COUNT_BEFORE" = "$DIRECT_MARKER_COUNT_AFTER"
printf 'NEGATIVE DIRECT_BUNDLE_NODE_OPTIONS_DENIED status=%s\n' "$DIRECT_NODE_OPTIONS_STATUS"

write_unit no yes
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected package-library bind mount denial for direct CLI image.\n' >&2
  exit 1
fi
DIRECT_BIND_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
test "$DIRECT_BIND_STATUS" = 67
DIRECT_MARKER_COUNT_AFTER=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' || true)
test "$DIRECT_MARKER_COUNT_BEFORE" = "$DIRECT_MARKER_COUNT_AFTER"
printf 'NEGATIVE DIRECT_BUNDLE_PACKAGE_BIND_MOUNT_DENIED status=%s\n' "$DIRECT_BIND_STATUS"

cp -a "$DIRECT_ROOTFS" "$DIRECT_UNLISTED_ROOTFS"
printf 'export const marker = "DIRECT_UNLISTED_ESM_MUST_NOT_RUN";\n' > "$DIRECT_UNLISTED_ROOTFS$PKG/app/fixture/unlisted-direct.mjs"
chown root:root "$DIRECT_UNLISTED_ROOTFS$PKG/app/fixture/unlisted-direct.mjs"
chmod 0444 "$DIRECT_UNLISTED_ROOTFS$PKG/app/fixture/unlisted-direct.mjs"
truncate -s "$IMAGE_SIZE" "$DIRECT_UNLISTED_IMAGE"
mkfs.ext4 -F -q -L "r3e-direct-extra" "$DIRECT_UNLISTED_IMAGE"
mkdir -m 0700 "$DIRECT_UNLISTED_MOUNTPOINT"
MOUNTPOINT="$DIRECT_UNLISTED_MOUNTPOINT"
mount -o loop "$DIRECT_UNLISTED_IMAGE" "$DIRECT_UNLISTED_MOUNTPOINT"
MOUNTED=1
cp -a "$DIRECT_UNLISTED_ROOTFS/." "$DIRECT_UNLISTED_MOUNTPOINT/"
sync
umount "$DIRECT_UNLISTED_MOUNTPOINT"
MOUNTED=0

MARKER_COUNT_BEFORE=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' || true)
ACTIVE_IMAGE="$DIRECT_UNLISTED_IMAGE"
write_unit no
systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
if systemctl start --wait "$UNIT"; then
  printf 'Expected unlisted ESM denial for direct CLI image.\n' >&2
  exit 1
fi
DIRECT_UNLISTED_STATUS=$(systemctl show --property=ExecMainStatus --value "$UNIT")
test "$DIRECT_UNLISTED_STATUS" = 70
DIRECT_MARKER_COUNT_AFTER=$(journalctl --no-pager -o cat -u "$UNIT" 2>/dev/null | grep -cFx 'R3E_PRE_CREDENTIAL_NATIVE_CLOSURE_VERIFIED' || true)
test "$MARKER_COUNT_BEFORE" = "$DIRECT_MARKER_COUNT_AFTER"
printf 'NEGATIVE DIRECT_BUNDLE_UNLISTED_ESM_DENIED status=%s marker-count=%s\n' "$DIRECT_UNLISTED_STATUS" "$DIRECT_MARKER_COUNT_AFTER"

sha256sum "$IMAGE" "$UNLISTED_IMAGE" "$DIRECT_IMAGE" "$DIRECT_UNLISTED_IMAGE" "$UNIT_FILE" "$LAUNCHER_PATH" "$MANIFEST_PATH" \
  "$STAGE/prelaunch-receipt-positive.sha256" "$DIRECT_RECEIPT" "$RECEIPT"
printf 'FIXTURE stage=%s package=%s unit=%s\n' "$STAGE" "$PKG" "$UNIT"
