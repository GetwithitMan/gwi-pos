#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?Usage: validate-version-contract.sh <image-tag>}"
echo "=== Version Contract Validation: $IMAGE ==="

CONTRACT=$(docker run --rm "$IMAGE" cat /app/public/version-contract.json 2>/dev/null)
if [[ -z "$CONTRACT" ]]; then
  echo "✗ FAIL: version-contract.json not readable"
  exit 1
fi

# Validate required fields
FAIL=0
for field in version schemaVersion migrationCount installerVersion buildDate gitSha; do
  val=$(echo "$CONTRACT" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d.get('$field'); print(v if v is not None else '')" 2>/dev/null)
  if [[ -n "$val" ]]; then
    echo "  ✓ $field: $val"
  else
    echo "  ✗ $field: MISSING"
    ((FAIL++))
  fi
done

# Validate dashboard component
dash_ver=$(echo "$CONTRACT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('components',{}).get('dashboard',{}).get('version',''))" 2>/dev/null)
if [[ -n "$dash_ver" ]]; then
  echo "  ✓ components.dashboard.version: $dash_ver"
else
  echo "  ○ components.dashboard.version: not set (optional)"
fi

echo ""
exit $FAIL
