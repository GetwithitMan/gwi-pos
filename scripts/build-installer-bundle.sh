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
tar czf - -C "$PUBLIC_DIR" installer-modules | base64 >> "$INSTALLER"

MODULE_COUNT=$(ls "$MODULES_DIR"/*.sh | wc -l)
INSTALLER_SIZE=$(du -h "$INSTALLER" | cut -f1)
echo "Built $INSTALLER ($INSTALLER_SIZE, $MODULE_COUNT embedded modules)"
