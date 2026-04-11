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

# 3. gwi-node.sh is executable (check multiple possible locations)
GWI_NODE=""
for p in /opt/gwi-pos/gwi-node.sh /opt/gwi-pos/app/public/scripts/gwi-node.sh /usr/local/bin/gwi-node; do
  if test -x "$p"; then GWI_NODE="$p"; break; fi
done
if [[ -n "$GWI_NODE" ]]; then
  pass "gwi-node.sh is executable ($GWI_NODE)"
else
  # Also check inside Docker container (Docker-first model)
  if docker exec gwi-pos test -f /app/public/scripts/gwi-node.sh 2>/dev/null; then
    pass "gwi-node.sh accessible inside container"
  else
    fail "gwi-node.sh not found on host or in container"
  fi
fi

# 4. installer.run is executable (check multiple locations)
INSTALLER=""
for p in /opt/gwi-pos/installer.run /opt/gwi-pos/app/public/installer.run; do
  if test -x "$p"; then INSTALLER="$p"; break; fi
done
if [[ -n "$INSTALLER" ]]; then
  pass "installer.run is executable ($INSTALLER)"
else
  if docker exec gwi-pos test -f /app/public/installer.run 2>/dev/null; then
    pass "installer.run accessible inside container"
  else
    fail "installer.run not found on host or in container"
  fi
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

# ── Container-internal checks (appliance validation matrix) ──
# These mirror the CI "Appliance validation matrix" step so the same
# validation runs both in CI (on the image) and on the NUC (on the
# running container).  All checks are skipped when the container is down.

if [[ -n "$CONTAINER_ID" ]]; then
  echo ""
  echo "--- Container-internal validation ---"

  # 12. deploy-tools accessible
  if docker exec gwi-pos test -f /app/deploy-tools/src/migrate.js 2>/dev/null; then
    pass "deploy-tools/migrate.js accessible inside container"
  else
    fail "deploy-tools/migrate.js not found inside container"
  fi

  if docker exec gwi-pos test -f /app/deploy-tools/src/apply-schema.js 2>/dev/null; then
    pass "deploy-tools/apply-schema.js accessible inside container"
  else
    fail "deploy-tools/apply-schema.js not found inside container"
  fi

  # 13. version-contract accessible and well-formed
  if docker exec gwi-pos test -f /app/public/version-contract.json 2>/dev/null; then
    pass "version-contract.json accessible inside container"
  else
    fail "version-contract.json not found inside container"
  fi

  VC_JSON=$(docker exec gwi-pos cat /app/public/version-contract.json 2>/dev/null || echo "")
  if [[ -n "$VC_JSON" ]]; then
    # Validate required fields
    for FIELD in version schemaVersion migrationCount; do
      VALUE=$(echo "$VC_JSON" | python3 -c "import json,sys; m=json.load(sys.stdin); v=m.get('$FIELD',''); print(v if v else '')" 2>/dev/null || echo "")
      if [[ -n "$VALUE" ]]; then
        pass "version-contract has $FIELD ($VALUE)"
      else
        fail "version-contract missing $FIELD"
      fi
    done

    # 14. Schema migration count matches version-contract
    VC_MIGRATION_COUNT=$(echo "$VC_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('migrationCount',0))" 2>/dev/null || echo "0")
    ACTUAL_MIGRATION_COUNT=$(docker exec gwi-pos sh -c 'ls -1 /app/scripts/migrations/*.js 2>/dev/null | wc -l' 2>/dev/null || echo "0")
    ACTUAL_MIGRATION_COUNT=$(echo "$ACTUAL_MIGRATION_COUNT" | tr -d '[:space:]')
    if [[ "$VC_MIGRATION_COUNT" -eq "$ACTUAL_MIGRATION_COUNT" ]]; then
      pass "Migration count matches version-contract ($VC_MIGRATION_COUNT)"
    else
      fail "Migration count mismatch: version-contract=$VC_MIGRATION_COUNT, actual=$ACTUAL_MIGRATION_COUNT"
    fi
  else
    fail "version-contract.json could not be read"
  fi

  # 15. Venue state file exists and is valid JSON
  VENUE_STATE_PATH="/opt/gwi-pos/shared/state/venue-state.json"
  if test -f "$VENUE_STATE_PATH"; then
    if python3 -c "import json; json.load(open('$VENUE_STATE_PATH'))" 2>/dev/null; then
      LIFECYCLE=$(python3 -c "import json; print(json.load(open('$VENUE_STATE_PATH')).get('lifecycleState','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
      pass "venue-state.json valid (lifecycleState=$LIFECYCLE)"
    else
      fail "venue-state.json exists but is not valid JSON"
    fi
  else
    fail "venue-state.json not found at $VENUE_STATE_PATH"
  fi

  # 16. Server runtime files
  if docker exec gwi-pos test -f /app/server.js 2>/dev/null; then
    pass "server.js exists inside container"
  else
    fail "server.js not found inside container"
  fi

  if docker exec gwi-pos test -f /app/preload.js 2>/dev/null; then
    pass "preload.js exists inside container"
  else
    fail "preload.js not found inside container"
  fi

  if docker exec gwi-pos test -d /app/.next 2>/dev/null; then
    pass ".next build exists inside container"
  else
    fail ".next build not found inside container"
  fi

  if docker exec gwi-pos test -d /app/src/generated/prisma 2>/dev/null; then
    pass "prisma client generated inside container"
  else
    fail "prisma client not found inside container"
  fi

  # 17. Dashboard convergence state
  if test -f "$VENUE_STATE_PATH"; then
    DASH_STATUS=$(python3 -c "
import json, sys
vs = json.load(open('$VENUE_STATE_PATH'))
dash = vs.get('components', {}).get('dashboard', {})
status = dash.get('status', 'unknown')
current = dash.get('currentVersion', '?')
target = dash.get('targetVersion', '?')
print(f'{status}|{current}|{target}')
" 2>/dev/null || echo "unknown|?|?")
    DASH_STATE=$(echo "$DASH_STATUS" | cut -d'|' -f1)
    DASH_CURRENT=$(echo "$DASH_STATUS" | cut -d'|' -f2)
    DASH_TARGET=$(echo "$DASH_STATUS" | cut -d'|' -f3)
    if [[ "$DASH_STATE" == "converged" ]]; then
      pass "Dashboard converged (v$DASH_CURRENT)"
    elif [[ "$DASH_STATE" == "unknown" && "$DASH_CURRENT" == "0.0.0" ]]; then
      # Fresh install, not yet converged — not a failure
      pass "Dashboard not yet converged (fresh install)"
    else
      fail "Dashboard diverged: status=$DASH_STATE, current=$DASH_CURRENT, target=$DASH_TARGET"
    fi
  else
    fail "Dashboard convergence check skipped (no venue-state.json)"
  fi

else
  fail "Container-internal checks skipped (container not running)"
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
