#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# build-nuc-artifact.sh — Package a self-contained NUC release artifact
#
# Runs AFTER `next build` + `build-server.mjs` on Vercel.
# Produces a compressed, signed artifact ready for the NUC update agent.
#
# Output: public/artifacts/pos-release-<releaseId>.tar.zst (or .tar.gz)
#         public/artifacts/manifest.json
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAGING="$REPO_DIR/.artifact-staging"
ARTIFACTS_DIR="$REPO_DIR/public/artifacts"

# ─── 1. Read metadata ────────────────────────────────────────────────────────
echo "==> [1/12] Reading build metadata..."

VERSION=$(node -e "console.log(require('$REPO_DIR/package.json').version)")
GIT_SHA=$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")
# Target Node version for NUCs (NOT the build machine's version).
# Vercel may run Node 24+, but NUCs run Node 22.x (LTS until April 2027).
# This value goes into the manifest for compatibility gating (minimum, not exact).
NODE_VERSION="${NUC_NODE_VERSION:-v22.14.0}"
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Schema version = highest NNN prefix in scripts/migrations/
SCHEMA_VERSION="000"
if [ -d "$REPO_DIR/scripts/migrations" ]; then
    SCHEMA_VERSION=$(ls "$REPO_DIR/scripts/migrations/" 2>/dev/null \
        | grep -oE '^[0-9]{3}' \
        | sort -n \
        | tail -1 || echo "000")
fi

RELEASE_ID="${VERSION}-${GIT_SHA}"

echo "    version:       $VERSION"
echo "    releaseId:     $RELEASE_ID"
echo "    schemaVersion: $SCHEMA_VERSION"
echo "    gitSha:        $GIT_SHA"
echo "    nodeVersion:   $NODE_VERSION"
echo "    buildDate:     $BUILD_DATE"

# ─── 2. Validate required build outputs ──────────────────────────────────────
echo "==> [2/12] Validating required build outputs..."

REQUIRED_FILES=(
    ".next/standalone"
    ".next/static"
    "server.js"
    "preload.js"
    "scripts/launcher.sh"
    "prisma/schema.prisma"
    "public"
    "src/generated/prisma"
    "package.json"
)

MISSING=()
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -e "$REPO_DIR/$f" ]; then
        MISSING+=("$f")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "FATAL: Required build outputs missing:" >&2
    for m in "${MISSING[@]}"; do
        echo "  - $m" >&2
    done
    echo "Did 'next build' and 'build-server.mjs' complete successfully?" >&2
    exit 1
fi

echo "    All required files present."

# ─── 3. Create staging directory ─────────────────────────────────────────────
echo "==> [3/12] Preparing staging directory..."

rm -rf "$STAGING"
mkdir -p "$STAGING"

# ─── 4. Copy required files to staging ───────────────────────────────────────
echo "==> [4/12] Copying files to staging..."

# .next/standalone/ -> staging root (this IS the runtime with bundled node_modules)
# Next.js standalone copies the entire repo — remove non-runtime files after copy.
echo "    standalone runtime..."
cp -r "$REPO_DIR/.next/standalone/." "$STAGING/"

# Remove non-runtime files that standalone copies from repo root.
# NUCs don't need docs, tests, configs, IDE files, etc.
echo "    removing non-runtime files from standalone..."
rm -rf \
    "$STAGING/.git" \
    "$STAGING/.github" \
    "$STAGING/.gitignore" \
    "$STAGING/docs" \
    "$STAGING/docker" \
    "$STAGING/playwright-report" \
    "$STAGING/playwright.config.ts" \
    "$STAGING/eslint.config.mjs" \
    "$STAGING/postcss.config.mjs" \
    "$STAGING/tailwind.config.ts" \
    "$STAGING/tsconfig.json" \
    "$STAGING/tsconfig.tsbuildinfo" \
    "$STAGING/CHANGELOG.md" \
    "$STAGING/CLAUDE.md" \
    "$STAGING/API_CALLS_AUDIT.csv" \
    "$STAGING/.env.example" \
    "$STAGING/.eslintrc*" \
    "$STAGING/.prettierrc*" \
    "$STAGING/bin" \
    "$STAGING/installer" \
    "$STAGING/keys" \
    "$STAGING/ecosystem.config.js" \
    "$STAGING/package-lock.json" \
    "$STAGING/prisma.config.ts" \
    2>/dev/null || true

# Aggressive cleanup: remove test files, markdown, .git dirs from node_modules
echo "    pruning node_modules bloat..."
find "$STAGING/node_modules" -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name ".git" \) -exec rm -rf {} + 2>/dev/null || true
find "$STAGING/node_modules" -type f \( -name "*.test.js" -o -name "*.spec.js" -o -name "*.test.ts" -o -name "CHANGELOG*" \) -delete 2>/dev/null || true
find "$STAGING" -type d -name ".git" -exec rm -rf {} + 2>/dev/null || true

# Ensure packages needed by the custom server (server.js) are in the artifact.
# Standalone tracing only includes subpaths used by pages, but the custom server
# imports from these packages at runtime via esbuild-bundled code.
#
# The custom server calls next() directly, which loads config-utils, SWC options,
# browserslist, etc. — code paths that standalone's traced subset doesn't include.
# Copy the FULL next package from repo, plus its transitive dep baseline-browser-mapping.
#
# Derived from: grep -oP 'require\("[^"]+"\)' server.js | sort -u
# Plus transitive deps of socket.io-client (8 packages).
# These packages MUST be the full repo versions, not standalone traces.
# Standalone may have partial traces that are incomplete for runtime use.
# next + its transitive deps that browserslist/SWC/config-utils load at runtime
# socket.io-client + full transitive tree for cloud-relay-client
# twilio for SMS workers, zod for validation
# Also include @prisma/adapter-pg and pg — previously merged from the Prisma CLI
# bundle (removed in Phase 2). The app runtime (db.ts) needs adapter-pg directly.
#
# PRISMA RUNTIME — all @prisma/* packages needed at runtime on the NUC.
# Grouped together so we stop discovering missing transitive deps in production.
# If Prisma upgrades add new runtime packages, add them HERE.
_PRISMA_RUNTIME_PKGS=(
    @prisma/adapter-pg
    @prisma/driver-adapter-utils
    @prisma/debug
    @prisma/engines
    @prisma/engines-version
    @prisma/fetch-engine
    @prisma/get-platform
)

_SERVER_PKGS=(
    next @next/env @swc/helpers baseline-browser-mapping caniuse-lite
    picocolors postcss styled-jsx source-map-js nanoid
    socket.io-client engine.io-client engine.io-parser socket.io-parser
    xmlhttprequest-ssl ws debug ms
    @socket.io/component-emitter
    twilio
    zod
    "${_PRISMA_RUNTIME_PKGS[@]}"
    pg postgres-array postgres-bytea postgres-date postgres-interval pg-types
)
for pkg in "${_SERVER_PKGS[@]}"; do
    if [ -d "$REPO_DIR/node_modules/$pkg" ]; then
        echo "    ensuring $pkg for custom server..."
        rm -rf "$STAGING/node_modules/$pkg" 2>/dev/null || true
        mkdir -p "$(dirname "$STAGING/node_modules/$pkg")"
        cp -r "$REPO_DIR/node_modules/$pkg" "$STAGING/node_modules/$pkg"
    fi
done

# Validate: every require() in server.js must resolve in staging node_modules
echo "    Validating server.js dependencies in artifact..."
_MISSING_DEPS=()
# Node.js builtins — never in node_modules
_NODE_BUILTINS="crypto fs http https net os path stream url util child_process events buffer tls dgram dns zlib readline tty cluster worker_threads v8 vm assert perf_hooks async_hooks inspector string_decoder punycode querystring"
for _dep in $(grep -oP 'require\("[^"]+"\)' "$REPO_DIR/server.js" 2>/dev/null | sed 's/require("//;s/")//' | grep -v '^node:' | grep -v '^\.' | sort -u); do
    # Skip Node.js builtins
    _is_builtin=false
    for _bi in $_NODE_BUILTINS; do
        [[ "$_dep" == "$_bi" || "$_dep" == "$_bi/"* ]] && _is_builtin=true && break
    done
    [[ "$_is_builtin" == "true" ]] && continue
    # Extract package name (handle scoped: @foo/bar → @foo/bar, foo/bar → foo)
    _pkg_name="$_dep"
    if [[ "$_dep" == @* ]]; then
        _pkg_name=$(echo "$_dep" | cut -d/ -f1,2)
    else
        _pkg_name=$(echo "$_dep" | cut -d/ -f1)
    fi
    if [[ ! -d "$STAGING/node_modules/$_pkg_name" ]]; then
        _MISSING_DEPS+=("$_pkg_name (required by: $_dep)")
    fi
done
if [[ ${#_MISSING_DEPS[@]} -gt 0 ]]; then
    echo "FATAL: server.js requires packages missing from artifact node_modules:" >&2
    for _m in "${_MISSING_DEPS[@]}"; do
        echo "  - $_m" >&2
    done
    echo "Add them to _SERVER_PKGS in build-nuc-artifact.sh" >&2
    exit 1
fi
echo "    All server.js dependencies present in artifact"

# ── Artifact smoke test: load the actual runtime entrypoint ──────────────
# Don't just check that packages exist on disk — actually require() the
# server's critical import chain to catch missing transitive dependencies
# BEFORE the artifact ships. This prevents the @prisma/debug-class of bugs
# where a package is on disk but its own deps are missing.
echo "    Smoke-testing runtime entrypoint against staged node_modules..."
_SMOKE_RESULT=$(cd "$STAGING" && node -e "
  // Simulate the real require chain: server.js → adapter-pg → driver-adapter-utils → debug
  try {
    require('@prisma/adapter-pg');
    require('@prisma/driver-adapter-utils');
    require('pg');
    require('socket.io-client');
    require('next/dist/server/next-server');
    console.log('SMOKE_OK');
  } catch (e) {
    console.error('SMOKE_FAIL: ' + e.message);
    process.exit(1);
  }
" 2>&1) || {
    echo "FATAL: Artifact smoke test FAILED — runtime dependencies broken:" >&2
    echo "  $_SMOKE_RESULT" >&2
    echo "  Fix: add missing packages to _PRISMA_RUNTIME_PKGS or _SERVER_PKGS" >&2
    exit 1
}
echo "    Smoke test passed: $_SMOKE_RESULT"

# ── Artifact smoke-BOOT test: start the server and verify it binds a port ──
# This catches ALL missing dependencies (transitive, lazy, generated internals)
# by actually running the staged artifact. Fails the build if the server can't
# start and bind a health port within 30 seconds.
echo "    Smoke-BOOT testing: starting staged server..."
_SMOKE_PORT=19123  # ephemeral port to avoid conflicts
_SMOKE_PID=""
_SMOKE_OK=false

# Minimal env for boot test — just enough to start without a real DB
(
  cd "$STAGING"
  PORT=$_SMOKE_PORT \
  NODE_ENV=production \
  DATABASE_URL="postgresql://test:test@localhost:5432/test" \
  LOCATION_ID="smoke-test" \
  NEXTAUTH_SECRET="smoke-test-secret-not-real" \
  INTERNAL_API_SECRET="smoke-test" \
  CELLULAR_TOKEN_SECRET="smoke-test" \
  SESSION_SECRET="smoke-test" \
  TENANT_SIGNING_KEY="smoke-test" \
  node -r ./preload.js server.js &
  echo $!
) > /tmp/smoke-boot-pid.txt 2>/tmp/smoke-boot-err.txt &
_SMOKE_WRAPPER_PID=$!

sleep 2  # let the process start
_SMOKE_PID=$(cat /tmp/smoke-boot-pid.txt 2>/dev/null || echo "")

# Wait up to 30s for the port to bind
# Any non-000 HTTP code means the server is running and responding.
# 200 = healthy, 503 = server started but DB not available (expected in CI).
for _i in $(seq 1 15); do
  if curl -sf --connect-timeout 1 --max-time 2 -o /dev/null "http://localhost:${_SMOKE_PORT}/api/health/ready" 2>/dev/null \
     || [[ "$(curl -so /dev/null -w '%{http_code}' --connect-timeout 1 --max-time 2 "http://localhost:${_SMOKE_PORT}/api/health/ready" 2>/dev/null)" != "000" ]]; then
    _SMOKE_OK=true
    echo "    Smoke-BOOT passed: server bound port $_SMOKE_PORT in $((_i * 2))s"
    break
  fi
  # Check if process died
  if [[ -n "$_SMOKE_PID" ]] && ! kill -0 "$_SMOKE_PID" 2>/dev/null; then
    echo "    Smoke-BOOT: server process died before binding port" >&2
    break
  fi
  sleep 2
done

# Cleanup: kill the server
if [[ -n "$_SMOKE_PID" ]]; then
  kill "$_SMOKE_PID" 2>/dev/null || true
  wait "$_SMOKE_PID" 2>/dev/null || true
fi
kill "$_SMOKE_WRAPPER_PID" 2>/dev/null || true
wait "$_SMOKE_WRAPPER_PID" 2>/dev/null || true

if [[ "$_SMOKE_OK" != "true" ]]; then
  echo "FATAL: Artifact smoke-BOOT test FAILED — server could not start and bind port $_SMOKE_PORT" >&2
  echo "  This means the artifact has missing runtime dependencies or a startup crash." >&2
  if [[ -f /tmp/smoke-boot-err.txt ]]; then
    echo "  Last 20 lines of stderr:" >&2
    tail -20 /tmp/smoke-boot-err.txt >&2
  fi
  rm -f /tmp/smoke-boot-pid.txt /tmp/smoke-boot-err.txt
  echo "  Fix: check _PRISMA_RUNTIME_PKGS and _SERVER_PKGS in build-nuc-artifact.sh" >&2
  exit 1
fi
rm -f /tmp/smoke-boot-pid.txt /tmp/smoke-boot-err.txt

# .next/static/ -> staging/.next/static/ (browser assets)
echo "    static assets..."
mkdir -p "$STAGING/.next/static"
cp -r "$REPO_DIR/.next/static/." "$STAGING/.next/static/"

# Custom server + preload
echo "    server.js + preload.js..."
cp "$REPO_DIR/server.js" "$STAGING/server.js"
cp "$REPO_DIR/preload.js" "$STAGING/preload.js"

# Launcher
echo "    launcher.sh..."
cp "$REPO_DIR/scripts/launcher.sh" "$STAGING/launcher.sh"
chmod +x "$STAGING/launcher.sh"

# Prisma schema + deploy schema + optional schema.sql
echo "    prisma schema..."
mkdir -p "$STAGING/prisma"
cp "$REPO_DIR/prisma/schema.prisma" "$STAGING/prisma/schema.prisma"
if [ -f "$REPO_DIR/prisma/schema.sql" ]; then
    cp "$REPO_DIR/prisma/schema.sql" "$STAGING/prisma/schema.sql"
    echo "    prisma/schema.sql (generated)"
fi

# NOTE: Prisma CLI, prisma.config.mjs, and migration scripts are NO LONGER
# shipped in the app artifact. Schema management is handled by the separate
# deploy-tools artifact (built by deploy-tools/build.sh). See Phase 2 of
# the deploy-tools separation plan.

# Public directory (static assets, installer, sync-agent, watchdog)
echo "    public/..."
mkdir -p "$STAGING/public"
cp -r "$REPO_DIR/public/." "$STAGING/public/"

# Generated Prisma client
echo "    generated Prisma client..."
mkdir -p "$STAGING/src/generated/prisma"
cp -r "$REPO_DIR/src/generated/prisma/." "$STAGING/src/generated/prisma/"

# package.json (for version detection only)
echo "    package.json..."
cp "$REPO_DIR/package.json" "$STAGING/package.json"

# Version contract (used by deploy schema compat gates + heartbeat)
if [ -f "$REPO_DIR/src/generated/version-contract.json" ]; then
    cp "$REPO_DIR/src/generated/version-contract.json" "$STAGING/version-contract.json"
    echo "    version-contract.json"
fi

# ─── 5. (REMOVED) Prisma CLI bundle ──────────────────────────────────────────
# Prisma CLI, tsx, adapter-pg, and the migration runner are no longer bundled
# in the app artifact. Schema management is handled by the separate deploy-tools
# artifact (192KB vs 50-150MB). See deploy-tools/VALIDATION.md for test evidence.
echo "==> [5/12] Prisma CLI bundle removed — deploy-tools handles migrations"
PRISMA_CLI_VERSION="none"

# ─── 6. Generate required-env.json ───────────────────────────────────────────
echo "==> [6/12] Generating required-env.json..."

cat > "$STAGING/required-env.json" << 'ENVJSON'
{
  "required": [
    { "key": "DATABASE_URL", "format": "^postgres(ql)?://", "description": "Local PostgreSQL connection" },
    { "key": "LOCATION_ID", "format": "^[a-zA-Z0-9_-]+$", "description": "Venue location ID (cuid or numeric)" }
  ],
  "optional": [
    { "key": "NEON_DATABASE_URL", "description": "Cloud Neon DB for sync" },
    { "key": "SENTRY_DSN", "description": "Error tracking" },
    { "key": "PORT", "description": "Server port (default 3005)", "default": "3005" },
    { "key": "SYNC_ENABLED", "description": "Enable cloud sync", "default": "true" },
    { "key": "POS_VENUE_SLUG", "description": "Venue slug for wildcard domain" },
    { "key": "NUC_NODE_ID", "description": "Unique server node identifier" },
    { "key": "SERVER_API_KEY", "description": "MC API key for sync-agent" },
    { "key": "STATION_ROLE", "description": "server|backup|terminal|kiosk" },
    { "key": "MISSION_CONTROL_URL", "description": "MC URL for fleet management" }
  ],
  "deprecated": []
}
ENVJSON

echo "    required-env.json written."

# ─── 7. Generate artifact-metadata.json (initial — sha256/size filled later) ─
echo "==> [7/12] Generating artifact-metadata.json..."

# Determine compression extension for URL fields
COMPRESS_EXT="tar.zst"
if ! command -v zstd &>/dev/null; then
    COMPRESS_EXT="tar.gz"
fi

ARTIFACT_FILENAME="pos-release-${RELEASE_ID}.${COMPRESS_EXT}"

# Discover deploy-tools artifact (built by deploy-tools/build.sh in vercel-build step 4c)
DT_ARTIFACT=$(ls -t "$ARTIFACTS_DIR"/deploy-tools-*.tar.* 2>/dev/null | head -1)
if [ -n "$DT_ARTIFACT" ]; then
    DT_ARTIFACT_FILENAME=$(basename "$DT_ARTIFACT")
    DT_ARTIFACT_SHA256=$(shasum -a 256 "$DT_ARTIFACT" | cut -d' ' -f1)
    DT_ARTIFACT_SIZE=$(wc -c < "$DT_ARTIFACT" | tr -d ' ')
    echo "    deploy-tools artifact: $DT_ARTIFACT_FILENAME ($DT_ARTIFACT_SIZE bytes)"
else
    DT_ARTIFACT_FILENAME=""
    DT_ARTIFACT_SHA256=""
    DT_ARTIFACT_SIZE=0
    echo "    WARNING: No deploy-tools artifact found — NUC deploys will use legacy migration path"
fi

cat > "$STAGING/artifact-metadata.json" << METAJSON
{
  "artifactFormatVersion": 3,
  "version": "${VERSION}",
  "releaseId": "${RELEASE_ID}",
  "schemaVersion": "${SCHEMA_VERSION}",
  "gitSha": "${GIT_SHA}",
  "artifactUrl": "/artifacts/${ARTIFACT_FILENAME}",
  "artifactSigUrl": "/artifacts/${ARTIFACT_FILENAME}.minisig",
  "artifactSha256": "__PENDING__",
  "deployToolsUrl": "${DT_ARTIFACT_FILENAME:+/artifacts/$DT_ARTIFACT_FILENAME}",
  "deployToolsSha256": "${DT_ARTIFACT_SHA256}",
  "deployToolsSize": ${DT_ARTIFACT_SIZE:-0},
  "signingKeyId": "gwi-pos-2026",
  "artifactSize": "__PENDING__",
  "buildDate": "${BUILD_DATE}",
  "buildPlatform": "linux-x64",
  "nodeVersion": "${NODE_VERSION}",
  "requiredNodeMajor": $(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f1),
  "requiredNodeMinor": $(echo "$NODE_VERSION" | sed 's/^v//' | cut -d. -f2),
  "prismaBinaryTargets": ["debian-openssl-3.0.x"],
  "prismaCLIVersion": "${PRISMA_CLI_VERSION}",
  "requiresSchemaVersion": "${SCHEMA_VERSION}",
  "minInstallerVersion": "${VERSION}",
  "supportedUbuntuVersions": ["jammy", "noble"],
  "healthCheckPath": "/api/health/ready",
  "rollbackSupported": true,
  "compatibleFromReleases": [$(
    # Include previous release tag if available (enables upgrade gate enforcement)
    prev_tag=$(git -C "$REPO_DIR" describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo "")
    if [ -n "$prev_tag" ]; then
        echo "\"${prev_tag}\""
    fi
  )],
  "compatibleSchemaVersions": [$(
    # Include current schema version AND N-1 for expand-safe upgrades
    prev=$((10#$SCHEMA_VERSION - 1))
    prev_padded=$(printf "%03d" "$prev")
    if [ "$prev" -ge 0 ]; then
        echo "\"${prev_padded}\", \"${SCHEMA_VERSION}\""
    else
        echo "\"${SCHEMA_VERSION}\""
    fi
  )],
  "schemaExpansionOnly": true,
  "requiredEnvKeys": ["DATABASE_URL", "LOCATION_ID"]
}
METAJSON

echo "    artifact-metadata.json written (sha256/size pending)."

# ─── 8. Generate checksums.txt ────────────────────────────────────────────────
echo "==> [8/12] Generating checksums.txt..."

# SHA256 of every file in staging (excluding the checksums file itself and metadata)
(cd "$STAGING" && find . -type f \
    ! -name "checksums.txt" \
    ! -name "artifact-metadata.json" \
    -print0 \
    | sort -z \
    | xargs -0 shasum -a 256) > "$STAGING/checksums.txt"

CHECKSUM_COUNT=$(wc -l < "$STAGING/checksums.txt" | tr -d ' ')
echo "    $CHECKSUM_COUNT file checksums computed."

# ─── 9. Compress artifact ────────────────────────────────────────────────────
echo "==> [9/12] Compressing artifact..."

mkdir -p "$ARTIFACTS_DIR"
ARTIFACT_PATH="$ARTIFACTS_DIR/$ARTIFACT_FILENAME"

if command -v zstd &>/dev/null; then
    echo "    Using zstd compression (level 19)..."
    # COPYFILE_DISABLE=1 prevents macOS ._* resource fork files
    COPYFILE_DISABLE=1 tar cf - -C "$STAGING" . | zstd -19 -T0 -o "$ARTIFACT_PATH"
else
    echo "    WARNING: zstd not available, falling back to gzip..."
    COPYFILE_DISABLE=1 tar czf "$ARTIFACT_PATH" -C "$STAGING" .
fi

# Verify artifact exists and is not empty
if [ ! -f "$ARTIFACT_PATH" ] || [ ! -s "$ARTIFACT_PATH" ]; then
    echo "FATAL: Artifact file is missing or empty after compression" >&2
    exit 1
fi

ARTIFACT_SIZE=$(wc -c < "$ARTIFACT_PATH" | tr -d ' ')
ARTIFACT_SIZE_HUMAN=$(du -h "$ARTIFACT_PATH" | cut -f1)
echo "    Artifact: $ARTIFACT_FILENAME ($ARTIFACT_SIZE_HUMAN)"

# ─── 10. Compute SHA256 and update artifact-metadata.json ─────────────────────
echo "==> [10/12] Computing artifact SHA256 and updating metadata..."

ARTIFACT_SHA256=$(shasum -a 256 "$ARTIFACT_PATH" | cut -d' ' -f1)

# Update the placeholders in the staging copy, then copy to artifacts dir
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|\"__PENDING__\"|\"${ARTIFACT_SHA256}\"|" "$STAGING/artifact-metadata.json"
    sed -i '' "s|\"__PENDING__\"|${ARTIFACT_SIZE}|" "$STAGING/artifact-metadata.json"
else
    sed -i "s|\"__PENDING__\"|\"${ARTIFACT_SHA256}\"|" "$STAGING/artifact-metadata.json"
    sed -i "s|\"__PENDING__\"|${ARTIFACT_SIZE}|" "$STAGING/artifact-metadata.json"
fi

echo "    sha256: $ARTIFACT_SHA256"
echo "    size:   $ARTIFACT_SIZE bytes"

# ─── 11. Sign with minisign (REQUIRED on CI, skipped only for local dev) ─────
echo "==> [11/12] Signing artifact..."

SIGNED=false
if [ -n "${MINISIGN_SECRET_KEY:-}" ]; then
    if ! command -v minisign &>/dev/null; then
        echo "    minisign not found — installing..."
        if command -v apt-get &>/dev/null; then
            apt-get update -qq && apt-get install -y -qq minisign 2>/dev/null
        elif command -v brew &>/dev/null; then
            brew install minisign 2>/dev/null
        fi
        if ! command -v minisign &>/dev/null; then
            # Fallback: download pre-built binary
            echo "    apt/brew install failed — downloading minisign binary..."
            curl -fsSL "https://github.com/jedisct1/minisign/releases/download/0.12/minisign-0.12-linux.tar.gz" \
                | tar xz -C /tmp/ 2>/dev/null
            if [ -f /tmp/minisign-linux/x86_64/minisign ]; then
                cp /tmp/minisign-linux/x86_64/minisign /usr/local/bin/minisign
                chmod +x /usr/local/bin/minisign
            fi
        fi
        if ! command -v minisign &>/dev/null; then
            echo "FATAL: Could not install minisign. Signing required." >&2
            exit 1
        fi
        echo "    minisign installed: $(minisign --version 2>&1 | head -1)"
    fi

    # Write secret key to temp file (minisign requires file input)
    TMPKEY=$(mktemp)
    trap 'rm -f "$TMPKEY"' EXIT
    echo "$MINISIGN_SECRET_KEY" > "$TMPKEY"

    # Sign the artifact
    minisign -S -s "$TMPKEY" -m "$ARTIFACT_PATH" \
        -t "GWI POS release ${RELEASE_ID}" 2>/dev/null
    echo "    Artifact signed: ${ARTIFACT_FILENAME}.minisig"

    # Sign the manifest
    minisign -S -s "$TMPKEY" -m "$STAGING/artifact-metadata.json" \
        -t "GWI POS manifest ${RELEASE_ID}" 2>/dev/null
    echo "    Manifest signed: artifact-metadata.json.minisig"

    rm -f "$TMPKEY"
    trap - EXIT
    SIGNED=true
elif [ -n "${VERCEL:-}" ] || [ -n "${CI:-}" ]; then
    # On CI/Vercel, signing is MANDATORY — fail the build
    echo "FATAL: MINISIGN_SECRET_KEY not set. Artifact signing is required on CI." >&2
    echo "Add MINISIGN_SECRET_KEY to Vercel environment variables." >&2
    exit 1
else
    # Local dev build — warn but allow unsigned artifacts for testing
    echo "    NOTE: MINISIGN_SECRET_KEY not set (local dev build). Artifact will be unsigned."
    echo "    Set MINISIGN_SECRET_KEY for production builds."
fi

# ─── 12. Copy outputs to public/artifacts/ ────────────────────────────────────
echo "==> [12/12] Publishing artifact to public/artifacts/..."

# Artifact is already written to $ARTIFACTS_DIR in step 9

# manifest.json = artifact-metadata.json (latest release pointer)
cp "$STAGING/artifact-metadata.json" "$ARTIFACTS_DIR/manifest.json"
echo "    manifest.json written."

# Copy signatures if they exist
if [ "$SIGNED" = true ]; then
    if [ -f "${ARTIFACT_PATH}.minisig" ]; then
        echo "    ${ARTIFACT_FILENAME}.minisig copied."
    fi
    if [ -f "$STAGING/artifact-metadata.json.minisig" ]; then
        cp "$STAGING/artifact-metadata.json.minisig" "$ARTIFACTS_DIR/manifest.json.minisig"
        echo "    manifest.json.minisig copied."
    fi
fi

# ─── Cleanup ──────────────────────────────────────────────────────────────────
echo "==> Cleaning up staging directory..."
rm -rf "$STAGING"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "========================================================"
echo "  NUC Release Artifact Built Successfully"
echo "========================================================"
echo "  Release ID:     $RELEASE_ID"
echo "  Version:        $VERSION"
echo "  Schema Version: $SCHEMA_VERSION"
echo "  Git SHA:        $GIT_SHA"
echo "  Node:           $NODE_VERSION"
echo "  Artifact:       $ARTIFACT_FILENAME"
echo "  Size:           $ARTIFACT_SIZE_HUMAN ($ARTIFACT_SIZE bytes)"
echo "  SHA256:         $ARTIFACT_SHA256"
echo "  Signed:         $SIGNED"
echo "  Output:         $ARTIFACTS_DIR/"
echo "========================================================"
