#!/usr/bin/env bash
# Builds public/installer-bundle.run — a self-contained file that includes
# all installer modules as a base64-encoded tar.gz payload.
# Vercel serves .run files as static assets (no auth interception).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PUBLIC_DIR="$REPO_DIR/public"
MODULES_DIR="$PUBLIC_DIR/installer-modules"
OUTPUT="$PUBLIC_DIR/installer-bundle.run"

if [[ ! -d "$MODULES_DIR" ]]; then
  echo "ERROR: $MODULES_DIR not found"
  exit 1
fi

# Create the bundle: a small header script + base64 tar.gz of installer-modules/
echo "Building installer bundle..."

# Header
cat > "$OUTPUT" <<'HEADER'
#!/usr/bin/env bash
# GWI POS Installer Module Bundle
# This file is auto-generated — do not edit manually.
# It contains all installer-modules as a base64-encoded tar.gz.
echo "This is an installer bundle, not meant to be run directly."
echo "It is downloaded and extracted by installer.run automatically."
exit 0
__BUNDLE_BELOW__
HEADER

# Payload: tar.gz the installer-modules directory, base64 encode, append
tar czf - -C "$PUBLIC_DIR" installer-modules | base64 >> "$OUTPUT"

chmod +x "$OUTPUT"
MODULE_COUNT=$(ls "$MODULES_DIR"/*.sh | wc -l)
BUNDLE_SIZE=$(du -h "$OUTPUT" | cut -f1)
echo "Built $OUTPUT ($BUNDLE_SIZE, $MODULE_COUNT modules)"
