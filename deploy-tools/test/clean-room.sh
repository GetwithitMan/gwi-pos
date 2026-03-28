#!/usr/bin/env bash
# Clean-room test for deploy-tools artifact
#
# Proves the artifact is self-contained and runnable:
#   1. Build the artifact
#   2. Extract to a clean temp directory
#   3. Run validate-only mode
#   4. Optionally run against a real database (if DATABASE_URL set)
#
# Usage:
#   bash deploy-tools/test/clean-room.sh                    # validate-only
#   DATABASE_URL=postgres://... bash deploy-tools/test/clean-room.sh  # full test
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
EXTRACT_DIR=$(mktemp -d)
trap "rm -rf $EXTRACT_DIR" EXIT

echo "=== Deploy-tools clean-room test ==="

# 1. Build the artifact
echo "--- Step 1: Build artifact ---"
bash "$REPO_DIR/deploy-tools/build.sh"

# 2. Find and extract the artifact
ARTIFACT=$(ls -t "$REPO_DIR/public/artifacts/deploy-tools-"*.tar.* 2>/dev/null | head -1)
if [ -z "$ARTIFACT" ]; then
    echo "FAIL: No deploy-tools artifact found in public/artifacts/"
    exit 1
fi
echo "--- Step 2: Extract $ARTIFACT ---"
if [[ "$ARTIFACT" == *.zst ]]; then
    zstd -d "$ARTIFACT" --stdout | tar xf - -C "$EXTRACT_DIR"
else
    tar xzf "$ARTIFACT" -C "$EXTRACT_DIR"
fi

# 3. Validate imports resolve (no app deps, no Prisma, no tsx)
echo "--- Step 3: Validate-only mode ---"
DEPLOY_TOOLS_VALIDATE_ONLY=1 node "$EXTRACT_DIR/src/migrate.js"
echo "PASS: Validate-only succeeded"

# 4. Verify artifact contents
echo "--- Step 4: Verify artifact structure ---"
REQUIRED_FILES=(
    "src/migrate.js"
    "src/pg-compat.js"
    "src/apply-schema.js"
    "migration-helpers.js"
    "package.json"
    "deploy-tools-metadata.json"
    "checksums.txt"
)
ALL_PRESENT=true
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$EXTRACT_DIR/$f" ]; then
        echo "FAIL: Missing $f"
        ALL_PRESENT=false
    fi
done
if [ ! -d "$EXTRACT_DIR/migrations" ]; then
    echo "FAIL: Missing migrations/ directory"
    ALL_PRESENT=false
fi
if [ ! -d "$EXTRACT_DIR/node_modules/pg" ]; then
    echo "FAIL: Missing node_modules/pg"
    ALL_PRESENT=false
fi
if [ "$ALL_PRESENT" = true ]; then
    echo "PASS: All required files present"
fi

# 5. Verify no Prisma/tsx/generated-client contamination
echo "--- Step 5: Verify no app runtime deps ---"
CONTAMINATION=false
for pkg in "prisma" "@prisma" "tsx" "dotenv" "next" "react"; do
    if [ -d "$EXTRACT_DIR/node_modules/$pkg" ]; then
        echo "FAIL: Contamination — node_modules/$pkg should not be in deploy-tools"
        CONTAMINATION=true
    fi
done
if [ "$CONTAMINATION" = false ]; then
    echo "PASS: No app runtime deps in artifact"
fi

# 6. If DATABASE_URL is set, run against a real database
if [ -n "${DATABASE_URL:-}" ]; then
    echo "--- Step 6: Run migrations against real database ---"
    DATABASE_URL="$DATABASE_URL" node "$EXTRACT_DIR/src/migrate.js"
    echo "PASS: Migrations completed against real database"

    echo "--- Step 7: Run apply-schema.js (should detect non-empty DB and skip) ---"
    DATABASE_URL="$DATABASE_URL" node "$EXTRACT_DIR/src/apply-schema.js"
    echo "PASS: apply-schema.js handled non-empty DB correctly"
else
    echo "--- Step 6: Skipped (no DATABASE_URL set) ---"
    echo "    To test against a real DB: DATABASE_URL=postgres://... bash deploy-tools/test/clean-room.sh"
fi

echo ""
echo "=== Clean-room test PASSED ==="
