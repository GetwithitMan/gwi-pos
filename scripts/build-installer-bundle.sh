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

# Strip any existing payload (from previous builds)
if grep -q '^__MODULES_PAYLOAD__$' "$INSTALLER"; then
  sed -i '/^__MODULES_PAYLOAD__$/,$d' "$INSTALLER"
fi

# Append marker + base64 tar.gz of installer-modules/
echo "__MODULES_PAYLOAD__" >> "$INSTALLER"
tar czf - -C "$PUBLIC_DIR" installer-modules | base64 >> "$INSTALLER"

MODULE_COUNT=$(ls "$MODULES_DIR"/*.sh | wc -l)
INSTALLER_SIZE=$(du -h "$INSTALLER" | cut -f1)
echo "Built $INSTALLER ($INSTALLER_SIZE, $MODULE_COUNT embedded modules)"
