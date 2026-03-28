#!/usr/bin/env bash
# =============================================================================
# validate-deploy-tools.sh — CI gate: deploy-tools artifact builds and validates
# =============================================================================
# Builds the deploy-tools artifact and runs validate-only mode from the
# extracted artifact. Proves the shipped artifact is self-contained.
#
# Usage:
#   bash scripts/ci/validate-deploy-tools.sh
# =============================================================================
set -euo pipefail

echo "=== Deploy-Tools Artifact Validation ==="

# Build the artifact
echo "--- Building deploy-tools artifact ---"
bash deploy-tools/build.sh

# Find the artifact
ARTIFACT=$(ls -t public/artifacts/deploy-tools-*.tar.* 2>/dev/null | head -1)
if [[ -z "$ARTIFACT" ]]; then
    echo "FAIL: No deploy-tools artifact found in public/artifacts/"
    exit 1
fi
echo "Artifact: $ARTIFACT ($(du -h "$ARTIFACT" | cut -f1))"

# Extract to clean directory
EXTRACT_DIR=$(mktemp -d)
trap "rm -rf $EXTRACT_DIR" EXIT

echo "--- Extracting to clean directory ---"
if [[ "$ARTIFACT" == *.zst ]]; then
    zstd -d "$ARTIFACT" --stdout | tar xf - -C "$EXTRACT_DIR"
else
    tar xzf "$ARTIFACT" -C "$EXTRACT_DIR"
fi

# Validate imports resolve
echo "--- Running validate-only mode ---"
DEPLOY_TOOLS_VALIDATE_ONLY=1 node "$EXTRACT_DIR/src/migrate.js"

# Verify no app runtime deps leaked in
echo "--- Checking for contamination ---"
CONTAMINATED=false
for pkg in prisma @prisma tsx dotenv next react; do
    if [[ -d "$EXTRACT_DIR/node_modules/$pkg" ]]; then
        echo "FAIL: node_modules/$pkg should not be in deploy-tools"
        CONTAMINATED=true
    fi
done

if [[ "$CONTAMINATED" == "true" ]]; then
    exit 1
fi

# Verify required files
echo "--- Checking required files ---"
for f in src/migrate.js src/pg-compat.js src/apply-schema.js migration-helpers.js package.json; do
    if [[ ! -f "$EXTRACT_DIR/$f" ]]; then
        echo "FAIL: Missing $f"
        exit 1
    fi
done

if [[ ! -d "$EXTRACT_DIR/migrations" ]]; then
    echo "FAIL: Missing migrations/ directory"
    exit 1
fi

MIGRATION_COUNT=$(ls "$EXTRACT_DIR/migrations/"*.js 2>/dev/null | wc -l | tr -d ' ')
echo "Migrations: $MIGRATION_COUNT files"

echo ""
echo "=== Deploy-Tools Validation PASSED ==="
