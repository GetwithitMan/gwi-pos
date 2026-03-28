#!/usr/bin/env bash
# =============================================================================
# enforce-version-bump.sh — CI gate: protected path changes require version bump
# =============================================================================
# Compares the current branch against the base branch (default: origin/main).
# If any file in PROTECTED_PATHS changed and package.json version did NOT change,
# exits 1 (fails CI).
#
# Usage:
#   bash scripts/ci/enforce-version-bump.sh                    # compare against origin/main
#   bash scripts/ci/enforce-version-bump.sh origin/develop     # custom base
#
# In GitHub Actions:
#   - name: Enforce version bump
#     run: bash scripts/ci/enforce-version-bump.sh origin/${{ github.base_ref }}
# =============================================================================
set -euo pipefail

BASE_REF="${1:-origin/main}"

# Protected paths — changes here REQUIRE a version bump in package.json
PROTECTED_PATHS=(
    "public/installer.run"
    "public/installer-modules/"
    "public/scripts/deploy-release.sh"
    "scripts/build-nuc-artifact.sh"
    "scripts/vercel-build.js"
    "deploy-tools/"
    "public/install.sh"
    "public/setup-remote.sh"
    "public/uninstall.sh"
    "public/usb-remote-setup.sh"
)

echo "=== Version Bump Enforcement ==="
echo "Base: $BASE_REF"

# Get changed files
CHANGED_FILES=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null || git diff --name-only "$BASE_REF" HEAD 2>/dev/null || echo "")

if [[ -z "$CHANGED_FILES" ]]; then
    echo "No changed files detected — PASS"
    exit 0
fi

# Check if any protected path was changed
PROTECTED_CHANGED=false
PROTECTED_LIST=""
for path in "${PROTECTED_PATHS[@]}"; do
    matches=$(echo "$CHANGED_FILES" | grep "^${path}" || true)
    if [[ -n "$matches" ]]; then
        PROTECTED_CHANGED=true
        PROTECTED_LIST="${PROTECTED_LIST}${matches}\n"
    fi
done

if [[ "$PROTECTED_CHANGED" == "false" ]]; then
    echo "No protected paths changed — PASS"
    exit 0
fi

echo "Protected paths changed:"
echo -e "$PROTECTED_LIST" | sed 's/^/  /'

# Check if version changed
BASE_VERSION=$(git show "${BASE_REF}:package.json" 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/' || echo "unknown")
HEAD_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"\([^"]*\)".*/\1/')

echo "Base version: $BASE_VERSION"
echo "Head version: $HEAD_VERSION"

if [[ "$BASE_VERSION" == "$HEAD_VERSION" ]]; then
    echo ""
    echo "FAIL: Protected installer/deploy paths changed but package.json version was NOT bumped."
    echo ""
    echo "You MUST bump the version in package.json when changing:"
    echo -e "$PROTECTED_LIST" | sed 's/^/  /'
    echo ""
    echo "Current version: $HEAD_VERSION"
    echo "Bump it: npm version patch (or minor/major)"
    exit 1
fi

echo "Version bumped: $BASE_VERSION → $HEAD_VERSION — PASS"
exit 0
