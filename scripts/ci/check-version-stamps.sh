#!/usr/bin/env bash
# =============================================================================
# check-version-stamps.sh — CI gate: installer stamps match repo state
# =============================================================================
# Fails if the installer bundle is stamped with a stale version or SHA.
# This prevents shipping an installer that identifies as v1.0.0 when
# package.json says v1.1.0.
#
# Usage:
#   bash scripts/ci/check-version-stamps.sh
# =============================================================================
set -euo pipefail

echo "=== Version Stamp Consistency Check ==="

VIOLATIONS=0

# ── Read package.json version ─────────────────────────────────────────────
PKG_VERSION=""
if command -v jq &>/dev/null; then
  PKG_VERSION=$(jq -r '.version' package.json 2>/dev/null)
elif command -v node &>/dev/null; then
  PKG_VERSION=$(node -e "console.log(require('./package.json').version)" 2>/dev/null)
fi

if [[ -z "$PKG_VERSION" ]]; then
  echo "FAIL: Cannot read version from package.json"
  exit 1
fi
echo "package.json version: $PKG_VERSION"

# ── Read installer stamps ─────────────────────────────────────────────────
INSTALLER_FILE="public/installer.run"
if [[ ! -f "$INSTALLER_FILE" ]]; then
  echo "SKIP: $INSTALLER_FILE not found (may not be built yet)"
  exit 0
fi

INSTALLER_VERSION=$(grep '^INSTALLER_VERSION=' "$INSTALLER_FILE" | head -1 | cut -d'"' -f2)
INSTALLER_SHA=$(grep '^INSTALLER_GIT_SHA=' "$INSTALLER_FILE" | head -1 | cut -d'"' -f2)

echo "Installer stamped version: ${INSTALLER_VERSION:-MISSING}"
echo "Installer stamped SHA:     ${INSTALLER_SHA:-MISSING}"

# ── Check 1: Version match ────────────────────────────────────────────────
if [[ -z "$INSTALLER_VERSION" ]] || [[ "$INSTALLER_VERSION" == "__INSTALLER_VERSION__" ]]; then
  echo "SKIP: Installer has no version stamp (development build)"
elif [[ "$INSTALLER_VERSION" != "$PKG_VERSION" ]]; then
  echo ""
  echo "FAIL: Installer version stamp ($INSTALLER_VERSION) does not match package.json ($PKG_VERSION)"
  echo "  The installer was built with a different version than the current code."
  echo "  Rebuild the installer: bash scripts/build-installer-bundle.sh"
  VIOLATIONS=$((VIOLATIONS + 1))
else
  echo "Version stamp: MATCH"
fi

# ── Check 2: Git SHA (warn-only — SHA changes on every commit) ────────────
CURRENT_SHA=$(git rev-parse --short=8 HEAD 2>/dev/null || echo "")
if [[ -n "$CURRENT_SHA" ]] && [[ -n "$INSTALLER_SHA" ]] && [[ "$INSTALLER_SHA" != "__INSTALLER_GIT_SHA__" ]]; then
  if [[ "$INSTALLER_SHA" != "$CURRENT_SHA" ]]; then
    echo "INFO: Installer SHA ($INSTALLER_SHA) differs from HEAD ($CURRENT_SHA)"
    echo "  This is expected if installer was built on a previous commit."
    echo "  Will become a FAIL if installer protected paths were changed since then."

    # Check if any protected paths changed since the stamped SHA
    PROTECTED_CHANGED=$(git diff --name-only "$INSTALLER_SHA"..HEAD -- \
      public/installer.run \
      public/installer-modules/ \
      public/scripts/deploy-release.sh \
      scripts/build-nuc-artifact.sh \
      deploy-tools/ \
      2>/dev/null || echo "")

    if [[ -n "$PROTECTED_CHANGED" ]]; then
      echo ""
      echo "FAIL: Protected installer paths changed since the stamped SHA ($INSTALLER_SHA):"
      echo "$PROTECTED_CHANGED" | sed 's/^/  /'
      echo "  Rebuild the installer: bash scripts/build-installer-bundle.sh"
      VIOLATIONS=$((VIOLATIONS + 1))
    else
      echo "SHA drift: OK (no protected paths changed)"
    fi
  else
    echo "Git SHA stamp: MATCH"
  fi
fi

# ── Result ─────────────────────────────────────────────────────────────────
echo ""
if [[ $VIOLATIONS -gt 0 ]]; then
  echo "FAIL: $VIOLATIONS version stamp violation(s) found"
  exit 1
fi

echo "All version stamp checks passed — PASS"
exit 0
