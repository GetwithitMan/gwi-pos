#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?Usage: validate-dashboard-deb.sh <image-tag>}"
echo "=== Dashboard .deb Validation: $IMAGE ==="

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

docker run --rm -v "$TMP:/out" "$IMAGE" sh -c 'cp public/gwi-nuc-dashboard.deb /out/ 2>/dev/null || true'

if [[ ! -f "$TMP/gwi-nuc-dashboard.deb" ]]; then
  echo "  ○ No dashboard .deb bundled (optional)"
  exit 0
fi

FAIL=0
# Structure check
if dpkg --info "$TMP/gwi-nuc-dashboard.deb" >/dev/null 2>&1; then
  echo "  ✓ Valid .deb structure"
else
  echo "  ✗ Invalid .deb structure"; ((FAIL++))
fi

# Package name
PKG=$(dpkg-deb -f "$TMP/gwi-nuc-dashboard.deb" Package 2>/dev/null)
if [[ "$PKG" == "gwi-nuc-dashboard" ]]; then
  echo "  ✓ Package name: $PKG"
else
  echo "  ✗ Wrong package: $PKG (expected gwi-nuc-dashboard)"; ((FAIL++))
fi

# Version
VER=$(dpkg-deb -f "$TMP/gwi-nuc-dashboard.deb" Version 2>/dev/null)
echo "  ✓ Version: $VER"

# Size
SIZE=$(stat -c%s "$TMP/gwi-nuc-dashboard.deb" 2>/dev/null || stat -f%z "$TMP/gwi-nuc-dashboard.deb" 2>/dev/null)
echo "  ✓ Size: ${SIZE} bytes"

echo ""
exit $FAIL
