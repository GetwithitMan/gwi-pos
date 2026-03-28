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

# Verify version is not a downgrade (semver comparison)
version_gte() {
  local v1="$1" v2="$2"
  local v1_major v1_minor v1_patch v2_major v2_minor v2_patch
  IFS='.' read -r v1_major v1_minor v1_patch <<< "$v1"
  IFS='.' read -r v2_major v2_minor v2_patch <<< "$v2"
  v1_major="${v1_major:-0}"; v1_minor="${v1_minor:-0}"; v1_patch="${v1_patch:-0}"
  v2_major="${v2_major:-0}"; v2_minor="${v2_minor:-0}"; v2_patch="${v2_patch:-0}"
  if [[ "$v1_major" -gt "$v2_major" ]]; then return 0; fi
  if [[ "$v1_major" -lt "$v2_major" ]]; then return 1; fi
  if [[ "$v1_minor" -gt "$v2_minor" ]]; then return 0; fi
  if [[ "$v1_minor" -lt "$v2_minor" ]]; then return 1; fi
  if [[ "$v1_patch" -ge "$v2_patch" ]]; then return 0; fi
  return 1
}

if ! version_gte "$HEAD_VERSION" "$BASE_VERSION"; then
  echo "FAIL: Version downgrade detected: $HEAD_VERSION < $BASE_VERSION"
  exit 1
fi

echo "Version bumped: $BASE_VERSION → $HEAD_VERSION — PASS"
exit 0
