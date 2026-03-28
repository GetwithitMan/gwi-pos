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
# Vercel may run Node 24+, but NUCs run Node 20.x (LTS).
# This value goes into the manifest for compatibility gating.
NODE_VERSION="${NUC_NODE_VERSION:-v20.12.2}"
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
    "scripts/nuc-pre-migrate.js"
    "scripts/migrations"
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
_SERVER_PKGS=(
    next @next/env @swc/helpers baseline-browser-mapping caniuse-lite
    picocolors postcss styled-jsx source-map-js nanoid
    socket.io-client engine.io-client engine.io-parser socket.io-parser
    xmlhttprequest-ssl ws debug ms
    @socket.io/component-emitter
    twilio
    zod
)
for pkg in "${_SERVER_PKGS[@]}"; do
    if [ -d "$REPO_DIR/node_modules/$pkg" ]; then
        echo "    ensuring $pkg for custom server..."
        rm -rf "$STAGING/node_modules/$pkg" 2>/dev/null || true
        mkdir -p "$(dirname "$STAGING/node_modules/$pkg")"
        cp -r "$REPO_DIR/node_modules/$pkg" "$STAGING/node_modules/$pkg"
    fi
done

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

# Prisma 7 config: datasource URL lives in prisma.config.mjs, NOT in schema.
# Generate a minimal config that reads DATABASE_URL from env.
# Use .mjs so Node loads it as ESM without any TypeScript compilation.
cat > "$STAGING/prisma.config.mjs" << 'PRISMACONFIG'
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: { url: process.env.DATABASE_URL },
});
PRISMACONFIG
echo "    prisma.config.mjs (Prisma 7 datasource config)"

# NOTE: node_modules wiring happens AFTER step 5 (Prisma CLI bundle).
# prisma/cli/node_modules doesn't exist yet at this point.

# Migration scripts
echo "    migration scripts..."
mkdir -p "$STAGING/scripts/migrations"
cp "$REPO_DIR/scripts/nuc-pre-migrate.js" "$STAGING/scripts/nuc-pre-migrate.js"
cp -r "$REPO_DIR/scripts/migrations/." "$STAGING/scripts/migrations/"
if [ -f "$REPO_DIR/scripts/migration-helpers.js" ]; then
    cp "$REPO_DIR/scripts/migration-helpers.js" "$STAGING/scripts/migration-helpers.js"
fi

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

# ─── 5. Bundle Prisma CLI (isolated npm install — complete dependency tree) ──
echo "==> [5/12] Bundling Prisma CLI..."

# Get the exact prisma version from the project
PRISMA_VERSION=$(node -e "console.log(require('$REPO_DIR/node_modules/prisma/package.json').version)" 2>/dev/null || echo "7.5.0")
echo "    Prisma version: $PRISMA_VERSION"

# Create an isolated temp directory and do a clean npm install.
# This guarantees the COMPLETE dependency tree — no missing transitive deps.
# No more whack-a-mole with graphmatch, zeptomatch, @neondatabase, etc.
PRISMA_BUNDLE_DIR=$(mktemp -d)
echo "    Installing prisma@${PRISMA_VERSION} in isolated context..."

# Get versions from the project for packages nuc-pre-migrate.js needs at runtime.
# tsx: Prisma 7 generates ESM TypeScript — tsx bridges require() for .ts imports.
# @prisma/adapter-pg + pg: TCP connection adapter used by nuc-pre-migrate.js.
# Standalone may tree-shake these since they're dynamically loaded, so bundle them.
TSX_VERSION=$(node -e "console.log(require('$REPO_DIR/node_modules/tsx/package.json').version)" 2>/dev/null || echo "4.19.4")
ADAPTER_PG_VERSION=$(node -e "console.log(require('$REPO_DIR/node_modules/@prisma/adapter-pg/package.json').version)" 2>/dev/null || echo "7.5.0")
PG_VERSION=$(node -e "console.log(require('$REPO_DIR/node_modules/pg/package.json').version)" 2>/dev/null || echo "8.20.0")
echo "    tsx: $TSX_VERSION, @prisma/adapter-pg: $ADAPTER_PG_VERSION, pg: $PG_VERSION"

cat > "$PRISMA_BUNDLE_DIR/package.json" << PKGJSON
{
  "name": "prisma-cli-bundle",
  "private": true,
  "dependencies": {
    "prisma": "${PRISMA_VERSION}",
    "tsx": "${TSX_VERSION}",
    "@prisma/adapter-pg": "${ADAPTER_PG_VERSION}",
    "pg": "${PG_VERSION}"
  }
}
PKGJSON

# Do NOT use --ignore-scripts — Prisma needs postinstall to download engines
(cd "$PRISMA_BUNDLE_DIR" && npm install --no-audit --no-fund 2>&1 | tail -5)

# Verify engine files were actually downloaded by postinstall
echo "    Verifying Prisma engine files..."
SCHEMA_ENGINE_COUNT=$(find "$PRISMA_BUNDLE_DIR" -type f -name "schema-engine*" 2>/dev/null | wc -l)
WASM_COUNT=$(find "$PRISMA_BUNDLE_DIR" -type f -name "*.wasm" 2>/dev/null | wc -l)
echo "    Engine binaries: $SCHEMA_ENGINE_COUNT schema-engine files, $WASM_COUNT WASM files"
if [ "$WASM_COUNT" -eq 0 ]; then
    echo "FATAL: No WASM files found — Prisma postinstall may have failed" >&2
    echo "  Check if npm postinstall scripts ran correctly" >&2
    rm -rf "$PRISMA_BUNDLE_DIR"
    exit 1
fi

# Validate the installed CLI works — two checks:
# 1. --version: proves the CLI loads and its core deps resolve
# 2. db push --help: exercises schema engine + WASM loading (no DB needed)
echo "    Validating isolated Prisma CLI..."
PRISMA_BIN="$PRISMA_BUNDLE_DIR/node_modules/.bin/prisma"

PRISMA_TEST_OUTPUT=$("$PRISMA_BIN" --version 2>&1) || true
if echo "$PRISMA_TEST_OUTPUT" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
    PRISMA_CLI_VERSION=$(echo "$PRISMA_TEST_OUTPUT" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    echo "    prisma --version: v${PRISMA_CLI_VERSION} OK"
else
    echo "FATAL: Prisma CLI --version failed:" >&2
    echo "$PRISMA_TEST_OUTPUT" | head -10 >&2
    rm -rf "$PRISMA_BUNDLE_DIR"
    exit 1
fi

# Validate schema engine loads (db push --help triggers WASM + engine resolution)
if "$PRISMA_BIN" db push --help > /dev/null 2>&1; then
    echo "    prisma db push --help: OK (schema engine loads)"
else
    echo "FATAL: Prisma CLI 'db push --help' failed — schema engine may be missing" >&2
    "$PRISMA_BIN" db push --help 2>&1 | tail -5 >&2
    rm -rf "$PRISMA_BUNDLE_DIR"
    exit 1
fi

# Copy the complete, working prisma installation into the artifact
mkdir -p "$STAGING/prisma/cli"
cp -r "$PRISMA_BUNDLE_DIR/node_modules" "$STAGING/prisma/cli/node_modules"

# Create a convenience symlink/script so deploy can find the CLI
cp "$PRISMA_BUNDLE_DIR/node_modules/.bin/prisma" "$STAGING/prisma/cli/prisma" 2>/dev/null || true
chmod +x "$STAGING/prisma/cli/prisma" 2>/dev/null || true

echo "    Prisma CLI bundle: $(du -sh "$STAGING/prisma/cli/node_modules" | cut -f1)"

# Clean up temp dir
rm -rf "$PRISMA_BUNDLE_DIR"

# Wire prisma package into release-root node_modules so that
# prisma.config.mjs can resolve 'prisma/config' via normal Node resolution.
# This MUST happen after step 5 copies prisma/cli/node_modules into staging.
echo "    Merging Prisma CLI deps into release-root node_modules..."
if [ -d "$STAGING/node_modules" ]; then
    # Standalone ships its own node_modules/ — we CANNOT replace it.
    # Merge ALL packages from the isolated Prisma install into standalone's
    # node_modules. This ships the COMPLETE transitive dependency tree
    # (prisma, @prisma/config, effect, etc.) without whack-a-mole.
    # Skip packages that already exist (don't break Next.js runtime deps).
    PRISMA_NM="$STAGING/prisma/cli/node_modules"
    MERGED=0

    # Non-scoped packages (prisma, effect, etc.)
    for pkg_dir in "$PRISMA_NM"/[^@]*; do
        [ -d "$pkg_dir" ] || continue
        pkg_name=$(basename "$pkg_dir")
        if [ ! -e "$STAGING/node_modules/$pkg_name" ]; then
            cp -r "$pkg_dir" "$STAGING/node_modules/$pkg_name"
            MERGED=$((MERGED + 1))
        fi
    done

    # Scoped packages (@prisma/*, @effect/*, etc.)
    for scope_dir in "$PRISMA_NM"/@*; do
        [ -d "$scope_dir" ] || continue
        scope_name=$(basename "$scope_dir")
        mkdir -p "$STAGING/node_modules/$scope_name"
        for pkg_dir in "$scope_dir"/*; do
            [ -d "$pkg_dir" ] || continue
            pkg_name=$(basename "$pkg_dir")
            if [ ! -e "$STAGING/node_modules/$scope_name/$pkg_name" ]; then
                cp -r "$pkg_dir" "$STAGING/node_modules/$scope_name/$pkg_name"
                MERGED=$((MERGED + 1))
            fi
        done
    done

    # Also merge .bin entries so prisma CLI is callable from release root
    if [ -d "$PRISMA_NM/.bin" ]; then
        mkdir -p "$STAGING/node_modules/.bin"
        for bin_entry in "$PRISMA_NM/.bin"/*; do
            [ -e "$bin_entry" ] || continue
            bin_name=$(basename "$bin_entry")
            if [ ! -e "$STAGING/node_modules/.bin/$bin_name" ]; then
                cp -P "$bin_entry" "$STAGING/node_modules/.bin/$bin_name"
            fi
        done
    fi

    echo "    Merged $MERGED packages from Prisma CLI bundle into standalone node_modules"
else
    # No standalone node_modules — create symlink (shouldn't happen normally)
    ln -sfn prisma/cli/node_modules "$STAGING/node_modules"
    echo "    node_modules -> prisma/cli/node_modules (symlink)"
fi

# Final validation: simulate NUC execution shape.
# Run from STAGING dir (like deploy-release.sh does from release dir)
# with prisma.config.mjs + DATABASE_URL + bundled CLI.
echo "    Validating NUC execution shape (cd staging + prisma.config.mjs + node_modules)..."
STAGED_PRISMA="$STAGING/prisma/cli/node_modules/.bin/prisma"
if [ -f "$STAGED_PRISMA" ]; then
    # Fail-closed: prisma.config.ts MUST be absent, prisma.config.mjs MUST be present.
    # Prisma resolves .ts before .mjs — if the dev config sneaks back via standalone
    # copy or cleanup drift, it will be chosen first and fail (requires dotenv).
    if [ -f "$STAGING/prisma.config.ts" ]; then
        echo "FATAL: prisma.config.ts found in staged release — must be removed" >&2
        echo "  Prisma resolves .ts before .mjs; dev config requires dotenv (not in artifact)" >&2
        exit 1
    fi
    if [ ! -f "$STAGING/prisma.config.mjs" ]; then
        echo "FATAL: prisma.config.mjs missing from staged release" >&2
        exit 1
    fi
    # Verify prisma package is resolvable from release root.
    # Standalone has a real node_modules dir (not a symlink) — we copy prisma into it.
    # Either way, the prisma package must exist at node_modules/prisma for config resolution.
    if [ ! -d "$STAGING/node_modules/prisma" ]; then
        echo "FATAL: prisma package missing from release-root node_modules" >&2
        echo "  Expected: $STAGING/node_modules/prisma/" >&2
        echo "  node_modules exists: $([ -e "$STAGING/node_modules" ] && echo 'yes' || echo 'no')" >&2
        echo "  node_modules is dir: $([ -d "$STAGING/node_modules" ] && echo 'yes' || echo 'no')" >&2
        echo "  node_modules is link: $([ -L "$STAGING/node_modules" ] && echo 'yes' || echo 'no')" >&2
        exit 1
    fi
    # Verify the prisma/config module chain is resolvable:
    # prisma.config.mjs -> prisma/config -> @prisma/config
    if [ ! -e "$STAGING/node_modules/prisma/config.js" ] && [ ! -e "$STAGING/node_modules/prisma/config/index.js" ]; then
        echo "FATAL: prisma/config module not found in release-root node_modules" >&2
        echo "  Checked: node_modules/prisma/config.js and node_modules/prisma/config/index.js" >&2
        ls -la "$STAGING/node_modules/prisma/" 2>&1 | head -10 >&2
        exit 1
    fi
    if [ ! -d "$STAGING/node_modules/@prisma/config" ]; then
        echo "FATAL: @prisma/config missing from release-root node_modules" >&2
        echo "  prisma/config.js requires @prisma/config — it must be copied from the CLI bundle" >&2
        exit 1
    fi
    # Validate the config import chain BEFORE running CLI.
    # This catches the exact failure mode: prisma.config.mjs -> prisma/config -> @prisma/config
    echo "    Validating config import chain (node -e require)..."
    CONFIG_CHAIN_TEST=$(cd "$STAGING" && node -e "require('prisma/config'); console.log('prisma/config OK')" 2>&1) || true
    if echo "$CONFIG_CHAIN_TEST" | grep -q "prisma/config OK"; then
        echo "    Config chain: prisma/config resolves OK"
    else
        echo "FATAL: prisma/config import chain broken from release root:" >&2
        echo "$CONFIG_CHAIN_TEST" | head -10 >&2
        echo "  Staged @prisma contents:" >&2
        ls -la "$STAGING/node_modules/@prisma/" 2>&1 | head -10 >&2
        echo "  Staged prisma contents:" >&2
        ls -la "$STAGING/node_modules/prisma/" 2>&1 | head -10 >&2
        exit 1
    fi

    # Simulate NUC: cd to release dir, set DATABASE_URL, run prisma db push --help
    NUC_TEST_OUTPUT=$(cd "$STAGING" && DATABASE_URL="postgresql://test:test@localhost:5432/test" "$STAGED_PRISMA" db push --help 2>&1) || true
    if echo "$NUC_TEST_OUTPUT" | grep -qi "prisma db push\|push the state"; then
        echo "    NUC execution shape: OK (prisma.config.mjs resolves, CLI loads from release root)"
    else
        echo "FATAL: Prisma CLI failed from staged release directory:" >&2
        echo "$NUC_TEST_OUTPUT" | head -10 >&2
        exit 1
    fi

    # Validate nuc-pre-migrate.js by running it in validate-only mode from the
    # staged artifact. This executes the REAL import chain (dotenv→tsx→PrismaClient
    # →PrismaPg→fs→path) instead of a separate guessed require() — so if the script
    # can load here, it can load on the NUC.
    echo "    Validating nuc-pre-migrate.js from staged artifact (validate-only)..."
    MIGRATE_VALIDATE_TEST=$(cd "$STAGING" && NUC_PRE_MIGRATE_VALIDATE_ONLY=1 node scripts/nuc-pre-migrate.js 2>&1) || true
    if echo "$MIGRATE_VALIDATE_TEST" | grep -q "all imports resolved OK"; then
        echo "    nuc-pre-migrate.js: all runtime deps resolve from artifact"
        echo "$MIGRATE_VALIDATE_TEST" | grep "\[nuc-pre-migrate\]" | sed 's/^/      /'
    else
        echo "FATAL: nuc-pre-migrate.js cannot load from staged artifact:" >&2
        echo "$MIGRATE_VALIDATE_TEST" >&2
        echo "  Staged generated client contents:" >&2
        ls -la "$STAGING/src/generated/prisma/" 2>&1 | head -10 >&2
        exit 1
    fi
fi

# ─── 6. Generate required-env.json ───────────────────────────────────────────
echo "==> [6/12] Generating required-env.json..."

cat > "$STAGING/required-env.json" << 'ENVJSON'
{
  "required": [
    { "key": "DATABASE_URL", "format": "^postgres(ql)?://", "description": "Local PostgreSQL connection" },
    { "key": "NEXTAUTH_URL", "format": "^https?://", "description": "POS web URL for auth callbacks" },
    { "key": "NEXTAUTH_SECRET", "format": ".{32,}", "description": "Auth secret (min 32 chars)" },
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
  "requiredEnvKeys": ["DATABASE_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET", "LOCATION_ID"]
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
