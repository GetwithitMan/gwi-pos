#!/usr/bin/env bash
# Builds a self-contained installer.run by appending all modules as a
# base64-encoded tar.gz payload after a __MODULES_PAYLOAD__ marker.
# This way only ONE file needs to be served — and it already works on Vercel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$REPO_DIR/public"
MODULES_DIR="$PUBLIC_DIR/installer-modules"
INSTALLER="$PUBLIC_DIR/installer.run"

if [[ ! -d "$MODULES_DIR" ]]; then
  echo "ERROR: $MODULES_DIR not found"
  exit 1
fi

if [[ ! -f "$INSTALLER" ]]; then
  echo "ERROR: $INSTALLER not found"
  exit 1
fi

echo "Building self-contained installer.run..."

# ── Stamp version info into installer.run ──────────────────────────────────
# These placeholders are replaced with actual values from package.json + git.
# First restore placeholders in case this runs twice without a git checkout.
VERSION=$(node -e "console.log(require('$REPO_DIR/package.json').version)")
BUILD_DATE=$(date -u +%FT%TZ)
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo "Stamping installer: version=$VERSION date=$BUILD_DATE sha=$GIT_SHA"

# Restore placeholders (idempotent — handles re-runs without git reset)
perl -pi -e 's/^INSTALLER_VERSION="[^"]*"/INSTALLER_VERSION="__INSTALLER_VERSION__"/' "$INSTALLER"
perl -pi -e 's/^INSTALLER_BUILD_DATE="[^"]*"/INSTALLER_BUILD_DATE="__INSTALLER_BUILD_DATE__"/' "$INSTALLER"
perl -pi -e 's/^INSTALLER_GIT_SHA="[^"]*"/INSTALLER_GIT_SHA="__INSTALLER_GIT_SHA__"/' "$INSTALLER"

# Now stamp actual values — ONLY on the assignment lines (not in comparison checks)
perl -pi -e "s/^INSTALLER_VERSION=\"__INSTALLER_VERSION__\"/INSTALLER_VERSION=\"$VERSION\"/" "$INSTALLER"
perl -pi -e "s/^INSTALLER_BUILD_DATE=\"__INSTALLER_BUILD_DATE__\"/INSTALLER_BUILD_DATE=\"$BUILD_DATE\"/" "$INSTALLER"
perl -pi -e "s/^INSTALLER_GIT_SHA=\"__INSTALLER_GIT_SHA__\"/INSTALLER_GIT_SHA=\"$GIT_SHA\"/" "$INSTALLER"

# Strip any existing payload + exit marker (from previous builds)
if grep -q '^__MODULES_PAYLOAD__$' "$INSTALLER"; then
  # Remove everything from "exit 0" before the marker onwards
  MARKER_LINE=$(grep -n '^__MODULES_PAYLOAD__$' "$INSTALLER" | head -1 | cut -d: -f1)
  # Also remove the "exit 0" and comment line before the marker
  CUT_LINE=$((MARKER_LINE - 3))
  if [[ $CUT_LINE -gt 10 ]]; then
    head -n "$CUT_LINE" "$INSTALLER" > "${INSTALLER}.tmp" && mv "${INSTALLER}.tmp" "$INSTALLER"
  else
    sed -i '/^__MODULES_PAYLOAD__$/,$d' "$INSTALLER"
  fi
fi

# Append exit + marker + base64 tar.gz of installer-modules/
echo "" >> "$INSTALLER"
echo "# End of installer — payload below" >> "$INSTALLER"
echo "exit 0" >> "$INSTALLER"
echo "__MODULES_PAYLOAD__" >> "$INSTALLER"
# COPYFILE_DISABLE=1 prevents macOS from including ._* resource fork files
# which cause "Permission denied" errors on Linux
# Copy gwi-node.sh into installer-modules so it's bundled with the payload
cp "$PUBLIC_DIR/scripts/gwi-node.sh" "$MODULES_DIR/gwi-node.sh" 2>/dev/null || true
COPYFILE_DISABLE=1 tar czf - -C "$PUBLIC_DIR" installer-modules | base64 >> "$INSTALLER"

MODULE_COUNT=$(ls "$MODULES_DIR"/*.sh | wc -l)
INSTALLER_SIZE=$(du -h "$INSTALLER" | cut -f1)
echo "Built $INSTALLER ($INSTALLER_SIZE, $MODULE_COUNT embedded modules)"

# MC no longer stores a local copy — it proxies from POS Vercel deployment.
# No sync needed. ONE source of truth: public/installer.run in gwi-pos.
