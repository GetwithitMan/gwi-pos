#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?Usage: validate-runtime-image.sh <image-tag>}"
PASS=0; FAIL=0; INFO=0

required() { # Fails build
  if docker run --rm "$IMAGE" "$@" >/dev/null 2>&1; then
    echo "  ✓ $DESC"; ((PASS++))
  else
    echo "  ✗ $DESC"; ((FAIL++))
  fi
}

optional() { # Informational only
  if docker run --rm "$IMAGE" "$@" >/dev/null 2>&1; then
    echo "  ✓ $DESC"; ((PASS++))
  else
    echo "  ○ $DESC (optional)"; ((INFO++))
  fi
}

echo "=== Runtime Image Validation: $IMAGE ==="

# Required: server runtime
DESC="server.js" required test -f /app/server.js
DESC="preload.js" required test -f /app/preload.js
DESC=".next build" required test -d /app/.next
DESC="prisma client" required test -d /app/src/generated/prisma
DESC="version-contract.json" required test -f /app/public/version-contract.json

# Required: deploy-tools
DESC="migrate.js" required test -f /app/deploy-tools/src/migrate.js
DESC="apply-schema.js" required test -f /app/deploy-tools/src/apply-schema.js
DESC="migration-helpers.js" required test -f /app/scripts/migration-helpers.js

# Required: lifecycle scripts
DESC="gwi-node.sh" required test -f /app/public/scripts/gwi-node.sh
DESC="installer.run" required test -f /app/public/installer.run

# Required: installer modules
for mod in 05-deploy-app 06-schema 07-services 12-dashboard; do
  DESC="$mod.sh" required test -f "/app/public/installer-modules/$mod.sh"
done

# Optional: not required in image
DESC="validate-sudo-paths.sh" optional test -f /app/scripts/validate-sudo-paths.sh
DESC="CANONICAL-MONEY-SPEC.md" optional test -f /app/docs/guides/CANONICAL-MONEY-SPEC.md

echo ""
echo "=== Results: $PASS required passed, $FAIL failed, $INFO optional skipped ==="
exit $FAIL  # 0 = all required passed
