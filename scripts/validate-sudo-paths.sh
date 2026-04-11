#!/usr/bin/env bash
# validate-sudo-paths.sh — Verify all entrypoints work under sudo on a NUC.
# Usage: sudo bash scripts/validate-sudo-paths.sh

set -euo pipefail

PASS=0
FAIL=0
CRITICAL_FAIL=0

pass() { PASS=$((PASS + 1)); printf "  [PASS] %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  [FAIL] %s\n" "$1"; }
critical() { CRITICAL_FAIL=$((CRITICAL_FAIL + 1)); FAIL=$((FAIL + 1)); printf "  [FAIL] %s  (CRITICAL)\n" "$1"; }

echo "=== GWI POS Sudo Path Validation ==="
echo ""

# 1. Running as root
if [[ $EUID -eq 0 ]]; then
  pass "Running as root"
else
  critical "Not running as root — run with sudo"
fi

# 2. Docker accessible
if docker ps >/dev/null 2>&1; then
  pass "Docker is accessible"
else
  critical "Docker is not accessible"
fi

# 3. gwi-node.sh is executable
if test -x /opt/gwi-pos/app/public/scripts/gwi-node.sh; then
  pass "gwi-node.sh is executable"
else
  fail "gwi-node.sh is missing or not executable"
fi

# 4. installer.run is executable
if test -x /opt/gwi-pos/app/public/installer.run; then
  pass "installer.run is executable"
else
  fail "installer.run is missing or not executable"
fi

# 5. /opt/gwi-pos ownership is root:root
if [[ -d /opt/gwi-pos ]]; then
  OWNER=$(stat -c '%U:%G' /opt/gwi-pos 2>/dev/null || echo "unknown")
  if [[ "$OWNER" == "root:root" ]]; then
    pass "/opt/gwi-pos owned by root:root"
  else
    critical "/opt/gwi-pos owned by $OWNER (expected root:root)"
  fi
else
  critical "/opt/gwi-pos does not exist"
fi

# 6. .env is readable
if test -r /opt/gwi-pos/.env; then
  pass ".env is readable"
else
  critical ".env is missing or not readable"
fi

# 7. Shared state dir exists and is writable
if test -d /opt/gwi-pos/shared/state && test -w /opt/gwi-pos/shared/state; then
  pass "Shared state dir exists and is writable"
else
  fail "Shared state dir missing or not writable"
fi

# 8. No symlink under /opt/gwi-pos points to /home/
HOME_LINKS=$(find /opt/gwi-pos -type l -exec readlink -f {} \; 2>/dev/null | grep -c '^/home/' || true)
if [[ "$HOME_LINKS" -eq 0 ]]; then
  pass "No symlinks point to /home/"
else
  critical "$HOME_LINKS symlink(s) under /opt/gwi-pos point to /home/"
fi

# 9. dpkg is accessible
if dpkg --version >/dev/null 2>&1; then
  pass "dpkg is accessible"
else
  fail "dpkg is not accessible"
fi

# 10. Dashboard .deb install path
if test -d /usr/lib/gwi-nuc-dashboard; then
  pass "Dashboard install path exists (/usr/lib/gwi-nuc-dashboard)"
else
  fail "Dashboard install path missing (/usr/lib/gwi-nuc-dashboard)"
fi

# 11. Container is running
CONTAINER_ID=$(docker ps --filter name=gwi-pos --filter status=running -q 2>/dev/null || true)
if [[ -n "$CONTAINER_ID" ]]; then
  pass "gwi-pos container is running"
else
  critical "gwi-pos container is not running"
fi

# 12. deploy-tools accessible inside container
if [[ -n "$CONTAINER_ID" ]]; then
  if docker exec gwi-pos test -f /app/deploy-tools/src/migrate.js 2>/dev/null; then
    pass "deploy-tools/migrate.js accessible inside container"
  else
    fail "deploy-tools/migrate.js not found inside container"
  fi
else
  fail "deploy-tools check skipped (container not running)"
fi

# 13. version-contract accessible inside container
if [[ -n "$CONTAINER_ID" ]]; then
  if docker exec gwi-pos test -f /app/public/version-contract.json 2>/dev/null; then
    pass "version-contract.json accessible inside container"
  else
    fail "version-contract.json not found inside container"
  fi
else
  fail "version-contract check skipped (container not running)"
fi

# Summary
echo ""
echo "=== Results: $PASS passed, $FAIL failed ($CRITICAL_FAIL critical) ==="

if [[ "$CRITICAL_FAIL" -gt 0 ]]; then
  echo "CRITICAL failures detected — this NUC is not deployment-ready."
  exit 1
elif [[ "$FAIL" -gt 0 ]]; then
  echo "Non-critical failures detected — review before deploying."
  exit 0
else
  echo "All checks passed."
  exit 0
fi
