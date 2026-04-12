#!/usr/bin/env bash
set -uo pipefail

echo "=== Legacy Regression Guard ==="
FAIL=0

# 1. No source file should treat thepasspos as primary runtime
if grep -rn 'systemctl.*start.*thepasspos' src/ --include="*.ts" --include="*.tsx" | grep -v 'legacy\|fallback\|deprecated\|comment\|DEPRECATED' | grep -v test | grep -v __tests__; then
  echo "FAIL: Source code still starts thepasspos as primary runtime"
  FAIL=1
else
  echo "OK: No primary thepasspos references in source"
fi

# 2. No installer stage should reference rolling-restart.sh as a required entrypoint
#    (optional copy loops with 'for ... do' or '|| true' are OK)
if grep -n 'rolling-restart\.sh' public/installer-modules/*.sh | grep -v '#\|deprecated\|legacy\|optional\|comment' | grep -v 'for .*in .*rolling-restart' | grep -v '|| true' | grep -v '2>/dev/null'; then
  echo "FAIL: Installer still requires rolling-restart.sh as a hard dependency"
  FAIL=1
else
  echo "OK: rolling-restart.sh not a hard installer dependency"
fi

# 3. Manifests should not declare thepasspos as a primary app service
#    (thepasspos-kiosk and thepasspos-exit-kiosk are legitimate terminal services)
if grep -n '"thepasspos"' installer/manifests/*.json | grep -v '#\|deprecated'; then
  echo "FAIL: Manifests still declare thepasspos as a service"
  FAIL=1
else
  echo "OK: Manifests use Docker container model"
fi

# 4. Sudoers should not grant bare thepasspos control (kiosk variants are OK)
if grep -n 'systemctl.*thepasspos[^-]' public/installer-modules/07-services.sh | grep 'NOPASSWD' | grep -v '#\|deprecated'; then
  echo "FAIL: Sudoers still grants bare thepasspos control"
  FAIL=1
else
  echo "OK: Sudoers aligned with Docker-first model"
fi

# 5. deploy-release.sh should be a thin wrapper (< 50 lines)
LINES=$(wc -l < public/scripts/deploy-release.sh)
if [ "$LINES" -gt 50 ]; then
  echo "FAIL: deploy-release.sh has grown back to $LINES lines (should be <50)"
  FAIL=1
else
  echo "OK: deploy-release.sh is a thin wrapper ($LINES lines)"
fi

# 6. SCHEMA-AUTHORITY.md should not reference deploy-release.sh as canonical
if grep -n 'deploy-release\.sh' docs/architecture/SCHEMA-AUTHORITY.md | grep -iv deprecated; then
  echo "FAIL: SCHEMA-AUTHORITY.md still references deploy-release.sh"
  FAIL=1
else
  echo "OK: Schema authority documentation is current"
fi

echo ""
if [ $FAIL -eq 0 ]; then
  echo "=== All legacy regression guards passed ==="
else
  echo "=== LEGACY REGRESSION DETECTED -- fix before release ==="
  exit 1
fi
