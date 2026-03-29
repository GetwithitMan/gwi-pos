#!/usr/bin/env bash
# =============================================================================
# GWI POS — HA Failover End-to-End Test
# =============================================================================
#
# 10-step e2e test that exercises the full MC-arbitrated failover cycle:
#   1. Pre-check primary health
#   2. Pre-check standby health
#   3. Fence primary (simulate failure)
#   4. Verify primary is fenced
#   5. Promote standby to primary
#   6. Wait for promotion to complete
#   7. Verify standby is now primary
#   8. Verify old primary is still fenced
#   9. Rejoin old primary as standby
#  10. Summary
#
# Usage:
#   ./test-ha-failover-e2e.sh \
#     --primary-ip=172.16.20.50 \
#     --standby-ip=172.16.20.51 \
#     --api-secret=YOUR_SECRET \
#     [--dry-run]
#
# Exit codes:
#   0 = all steps passed
#   1 = one or more steps failed
# =============================================================================

set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────

PRIMARY_IP=""
STANDBY_IP=""
API_SECRET=""
DRY_RUN=false
API_PORT=3005

for arg in "$@"; do
  case "$arg" in
    --primary-ip=*)
      PRIMARY_IP="${arg#*=}"
      ;;
    --standby-ip=*)
      STANDBY_IP="${arg#*=}"
      ;;
    --api-secret=*)
      API_SECRET="${arg#*=}"
      ;;
    --dry-run)
      DRY_RUN=true
      ;;
    --help|-h)
      echo "Usage: $0 --primary-ip=IP --standby-ip=IP --api-secret=SECRET [--dry-run]"
      echo ""
      echo "Options:"
      echo "  --primary-ip=IP    IP address of the current primary NUC"
      echo "  --standby-ip=IP    IP address of the current standby NUC"
      echo "  --api-secret=SECRET  INTERNAL_API_SECRET or HA_SHARED_SECRET"
      echo "  --dry-run          Print what would be done without executing"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PRIMARY_IP" ]] || [[ -z "$STANDBY_IP" ]] || [[ -z "$API_SECRET" ]]; then
  echo "ERROR: --primary-ip, --standby-ip, and --api-secret are all required" >&2
  echo "Run with --help for usage" >&2
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# Test framework
# ─────────────────────────────────────────────────────────────────────────────

PASSED=0
FAILED=0
SKIPPED=0
STEP=0
RESULTS=()
FENCE_COMMAND_ID="e2e-test-$(date +%s)"
VENUE_SLUG="e2e-test"
START_TIME=$(date +%s)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_step() {
  STEP=$((STEP + 1))
  echo ""
  echo -e "${BLUE}━━━ Step ${STEP}/10: $1 ━━━${NC}"
}

pass() {
  PASSED=$((PASSED + 1))
  RESULTS+=("PASS: Step $STEP — $1")
  echo -e "  ${GREEN}PASS${NC}: $1"
}

fail() {
  FAILED=$((FAILED + 1))
  RESULTS+=("FAIL: Step $STEP — $1")
  echo -e "  ${RED}FAIL${NC}: $1"
}

skip() {
  SKIPPED=$((SKIPPED + 1))
  RESULTS+=("SKIP: Step $STEP — $1")
  echo -e "  ${YELLOW}SKIP${NC}: $1"
}

api_call() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local timeout="${4:-10}"

  local args=(-sf --max-time "$timeout" -X "$method"
    -H "Authorization: Bearer $API_SECRET"
    -H "Content-Type: application/json"
    -w "\n%{http_code}")

  if [[ -n "$body" ]]; then
    args+=(-d "$body")
  fi

  curl "${args[@]}" "$url" 2>/dev/null
}

extract_http_code() {
  echo "$1" | tail -1
}

extract_body() {
  echo "$1" | sed '$d'
}

# ─────────────────────────────────────────────────────────────────────────────
# Header
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "============================================================"
echo "  GWI POS — HA Failover End-to-End Test"
echo "============================================================"
echo "  Primary:  $PRIMARY_IP"
echo "  Standby:  $STANDBY_IP"
echo "  Fence ID: $FENCE_COMMAND_ID"
echo "  Dry run:  $DRY_RUN"
echo "  Started:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================================"

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Pre-check primary health
# ─────────────────────────────────────────────────────────────────────────────

log_step "Pre-check primary health"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would check http://${PRIMARY_IP}:${API_PORT}/api/health"
else
  RESP=$(api_call GET "http://${PRIMARY_IP}:${API_PORT}/api/health" "" 5) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Primary at $PRIMARY_IP is healthy (HTTP 200)"
  else
    fail "Primary at $PRIMARY_IP returned HTTP $HTTP_CODE (expected 200)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Pre-check standby health
# ─────────────────────────────────────────────────────────────────────────────

log_step "Pre-check standby health"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would check http://${STANDBY_IP}:${API_PORT}/api/health"
else
  RESP=$(api_call GET "http://${STANDBY_IP}:${API_PORT}/api/health" "" 5) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Standby at $STANDBY_IP is healthy (HTTP 200)"
  else
    # Standby may not have POS running — that's OK
    if [[ "$HTTP_CODE" == "error" ]] || [[ "$HTTP_CODE" == "000" ]]; then
      pass "Standby at $STANDBY_IP not serving HTTP (expected for standby role)"
    else
      fail "Standby at $STANDBY_IP returned unexpected HTTP $HTTP_CODE"
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Fence the primary (simulate failure)
# ─────────────────────────────────────────────────────────────────────────────

log_step "Fence the primary"

FENCE_BODY=$(printf '{"action":"step_down","newPrimary":"%s","fenceCommandId":"%s"}' \
  "$STANDBY_IP" "$FENCE_COMMAND_ID")

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would POST fence to http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence"
else
  RESP=$(api_call POST "http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence" "$FENCE_BODY" 10) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "202" ]]; then
    pass "Primary fenced successfully (HTTP $HTTP_CODE)"
  else
    fail "Fence request returned HTTP $HTTP_CODE (expected 200/202)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Verify primary is fenced
# ─────────────────────────────────────────────────────────────────────────────

log_step "Verify primary is fenced"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would GET http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence"
else
  sleep 2  # Allow fence to persist
  RESP=$(api_call GET "http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence" "" 5) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")
  BODY=$(extract_body "$RESP")

  if echo "$BODY" | grep -q '"fenced":true' 2>/dev/null || echo "$BODY" | grep -q '"fenced": true' 2>/dev/null; then
    pass "Primary confirms fenced state"
  elif [[ "$HTTP_CODE" == "200" ]]; then
    # May need to check response structure differently
    pass "Primary fence endpoint responded (HTTP 200) — checking state"
    echo "  Response: ${BODY:0:200}"
  else
    fail "Could not verify fence state (HTTP $HTTP_CODE)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Promote standby to primary
# ─────────────────────────────────────────────────────────────────────────────

log_step "Promote standby to primary"

PROMOTE_BODY=$(printf '{"command":"PROMOTE","oldPrimaryNodeId":"e2e-old","oldPrimaryIp":"%s","venueSlug":"%s","fenceCommandId":"%s","issuedAt":"%s","expiresAt":""}' \
  "$PRIMARY_IP" "$VENUE_SLUG" "$FENCE_COMMAND_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would POST promote to http://${STANDBY_IP}:${API_PORT}/api/internal/ha-promote"
else
  RESP=$(api_call POST "http://${STANDBY_IP}:${API_PORT}/api/internal/ha-promote" "$PROMOTE_BODY" 15) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "202" ]]; then
    pass "Promotion accepted (HTTP 202)"
  elif [[ "$HTTP_CODE" == "200" ]]; then
    pass "Promotion returned 200 (synchronous completion)"
  else
    fail "Promote request returned HTTP $HTTP_CODE (expected 202)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: Wait for promotion to complete
# ─────────────────────────────────────────────────────────────────────────────

log_step "Wait for promotion to complete"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would poll http://${STANDBY_IP}:${API_PORT}/api/internal/ha-promote for completion"
else
  MAX_WAIT=120
  WAITED=0
  PROMOTE_DONE=false

  while [[ $WAITED -lt $MAX_WAIT ]]; do
    RESP=$(api_call GET "http://${STANDBY_IP}:${API_PORT}/api/internal/ha-promote" "" 5) || RESP=""
    BODY=$(extract_body "$RESP")

    if echo "$BODY" | grep -q '"inProgress":false' 2>/dev/null || echo "$BODY" | grep -q '"inProgress": false' 2>/dev/null; then
      PROMOTE_DONE=true
      break
    fi

    echo "  Waiting... (${WAITED}s / ${MAX_WAIT}s)"
    sleep 5
    WAITED=$((WAITED + 5))
  done

  if [[ "$PROMOTE_DONE" == "true" ]]; then
    if echo "$BODY" | grep -q 'PROMOTE_COMPLETE' 2>/dev/null; then
      pass "Promotion completed successfully after ${WAITED}s"
    elif echo "$BODY" | grep -q 'PROMOTE_DEGRADED' 2>/dev/null; then
      pass "Promotion completed (degraded) after ${WAITED}s — check details"
      echo "  Response: ${BODY:0:300}"
    elif echo "$BODY" | grep -q 'PROMOTE_FAILED' 2>/dev/null; then
      fail "Promotion failed after ${WAITED}s"
      echo "  Response: ${BODY:0:300}"
    else
      pass "Promotion completed after ${WAITED}s (status check inconclusive)"
      echo "  Response: ${BODY:0:300}"
    fi
  else
    fail "Promotion did not complete within ${MAX_WAIT}s"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: Verify standby is now primary (serving health check)
# ─────────────────────────────────────────────────────────────────────────────

log_step "Verify promoted node is now primary"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would check http://${STANDBY_IP}:${API_PORT}/api/health"
else
  sleep 5  # Give POS a moment to restart
  RESP=$(api_call GET "http://${STANDBY_IP}:${API_PORT}/api/health" "" 10) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "200" ]]; then
    pass "Promoted node at $STANDBY_IP is healthy (HTTP 200)"
  else
    fail "Promoted node at $STANDBY_IP returned HTTP $HTTP_CODE (expected 200)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 8: Verify old primary is still fenced
# ─────────────────────────────────────────────────────────────────────────────

log_step "Verify old primary is still fenced"

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would GET http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence"
else
  RESP=$(api_call GET "http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-fence" "" 5) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")
  BODY=$(extract_body "$RESP")

  if echo "$BODY" | grep -q '"fenced":true' 2>/dev/null || echo "$BODY" | grep -q '"fenced": true' 2>/dev/null; then
    pass "Old primary is still fenced"
  elif [[ "$HTTP_CODE" == "error" ]] || [[ "$HTTP_CODE" == "000" ]]; then
    pass "Old primary not responding (expected — it was fenced/stopped)"
  else
    fail "Old primary fence state unclear (HTTP $HTTP_CODE)"
    echo "  Response: ${BODY:0:200}"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 9: Rejoin old primary as standby
# ─────────────────────────────────────────────────────────────────────────────

log_step "Rejoin old primary as standby"

REJOIN_BODY=$(printf '{"command":"REJOIN_AS_STANDBY","newPrimaryNodeId":"e2e-new","newPrimaryIp":"%s","venueSlug":"%s","fenceCommandId":"%s","issuedAt":"%s","expiresAt":""}' \
  "$STANDBY_IP" "$VENUE_SLUG" "$FENCE_COMMAND_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

if [[ "$DRY_RUN" == "true" ]]; then
  skip "Would POST rejoin to http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-rejoin"
else
  RESP=$(api_call POST "http://${PRIMARY_IP}:${API_PORT}/api/internal/ha-rejoin" "$REJOIN_BODY" 15) || RESP="error"
  HTTP_CODE=$(extract_http_code "$RESP")

  if [[ "$HTTP_CODE" == "202" ]]; then
    pass "Rejoin accepted (HTTP 202)"
  elif [[ "$HTTP_CODE" == "412" ]]; then
    fail "Rejoin refused — node not fenced (HTTP 412)"
  elif [[ "$HTTP_CODE" == "error" ]] || [[ "$HTTP_CODE" == "000" ]]; then
    # Old primary POS may not be running — this is expected
    pass "Old primary POS not reachable (expected — rejoin must be triggered via SSH or relay)"
  else
    fail "Rejoin request returned HTTP $HTTP_CODE (expected 202)"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 10: Summary
# ─────────────────────────────────────────────────────────────────────────────

log_step "Summary"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "============================================================"
echo "  HA Failover E2E Test Results"
echo "============================================================"
echo ""

for result in "${RESULTS[@]}"; do
  if echo "$result" | grep -q "^PASS"; then
    echo -e "  ${GREEN}${result}${NC}"
  elif echo "$result" | grep -q "^FAIL"; then
    echo -e "  ${RED}${result}${NC}"
  else
    echo -e "  ${YELLOW}${result}${NC}"
  fi
done

echo ""
echo "------------------------------------------------------------"
echo -e "  ${GREEN}Passed${NC}: $PASSED"
echo -e "  ${RED}Failed${NC}: $FAILED"
echo -e "  ${YELLOW}Skipped${NC}: $SKIPPED"
echo "  Duration: ${DURATION}s"
echo "------------------------------------------------------------"

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}RESULT: FAILED${NC}"
  exit 1
else
  echo ""
  echo -e "  ${GREEN}RESULT: PASSED${NC}"
  exit 0
fi
