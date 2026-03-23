#!/usr/bin/env bash
# GWI POS Watchdog — Self-healing health monitor
# Installed as systemd timer, runs every 30s
# 3 consecutive failures → restart POS service
# 10 min continuous failure → escalate to MC

set -euo pipefail

STATE_DIR="/opt/gwi-pos/state"
FAIL_COUNT_FILE="$STATE_DIR/.watchdog-fail-count"
FIRST_FAIL_FILE="$STATE_DIR/.watchdog-first-fail"
DIAG_DIR="/opt/gwi-pos/logs/watchdog-diagnostics"
POS_PORT="${POS_PORT:-3005}"
HEALTH_URL="http://localhost:${POS_PORT}/api/health"
MAX_CONSECUTIVE_FAILURES=3
ESCALATION_WINDOW_SECONDS=600  # 10 minutes

mkdir -p "$STATE_DIR" "$DIAG_DIR" 2>/dev/null || true

log() { echo "[$(date -u +%FT%TZ)] WATCHDOG: $*"; }

# Capture diagnostics before any restart
capture_diagnostics() {
  local ts
  ts=$(date +%Y%m%d-%H%M%S)
  local diag_file="$DIAG_DIR/diag-$ts.txt"
  {
    echo "=== GWI POS Watchdog Diagnostics ==="
    echo "Timestamp: $(date -u +%FT%TZ)"
    echo ""
    echo "=== System Resources ==="
    free -m 2>/dev/null || true
    echo ""
    df -h /opt/gwi-pos 2>/dev/null || true
    echo ""
    echo "=== Top Processes ==="
    top -b -n1 | head -20 2>/dev/null || true
    echo ""
    echo "=== PostgreSQL ==="
    pg_isready 2>/dev/null && echo "PostgreSQL: READY" || echo "PostgreSQL: NOT READY"
    echo ""
    echo "=== POS Service Status ==="
    systemctl status thepasspos --no-pager 2>/dev/null || true
    echo ""
    echo "=== Recent POS Logs ==="
    journalctl -u thepasspos -n 50 --no-pager 2>/dev/null || true
    echo ""
    echo "=== Sync Service Status ==="
    systemctl status thepasspos-sync --no-pager 2>/dev/null || true
    echo ""
    echo "=== Network ==="
    ss -tlnp 2>/dev/null | grep -E ":(3005|5432)" || true
    echo ""
    echo "=== Disk I/O ==="
    iostat -x 1 1 2>/dev/null || true
  } > "$diag_file" 2>&1

  # Rotate: keep last 20 diagnostic files
  ls -t "$DIAG_DIR"/diag-*.txt 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null || true

  log "Diagnostics captured: $diag_file"
}

# Check POS health
check_health() {
  local response
  local http_code

  http_code=$(curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null) || http_code="000"

  if [[ "$http_code" == "200" ]]; then
    # Also verify the response is actually healthy
    response=$(curl -sf --connect-timeout 5 --max-time 10 "$HEALTH_URL" 2>/dev/null) || return 1
    local status
    status=$(echo "$response" | jq -r '.status // empty' 2>/dev/null) || return 1

    case "$status" in
      healthy) return 0 ;;
      degraded) return 0 ;;  # degraded is OK, don't restart
      *) return 1 ;;
    esac
  else
    return 1
  fi
}

# Check PostgreSQL
check_database() {
  pg_isready -q 2>/dev/null
}

# Escalate to MC via heartbeat modification
escalate_to_mc() {
  local reason="$1"
  local fail_count
  fail_count=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo "0")

  # Write escalation state for heartbeat to pick up
  cat > "$STATE_DIR/watchdog-escalation.json" <<ESCJSON
{
  "escalated": true,
  "reason": "$reason",
  "failCount": $fail_count,
  "firstFailAt": "$(cat "$FIRST_FAIL_FILE" 2>/dev/null || echo "unknown")",
  "escalatedAt": "$(date -u +%FT%TZ)",
  "diagnosticsDir": "$DIAG_DIR"
}
ESCJSON
  log "ESCALATION: $reason (fail count: $fail_count)"
}

# Clear escalation state
clear_escalation() {
  rm -f "$STATE_DIR/watchdog-escalation.json" 2>/dev/null || true
}

# Main health check
main() {
  local now
  now=$(date +%s)

  # Check database first
  if ! check_database; then
    log "Database unreachable — skipping POS health check (DB must come up first)"
    # Don't count as POS failure — DB issues are separate
    return 0
  fi

  # Check POS health
  if check_health; then
    # Healthy — reset counters
    local prev_count
    prev_count=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo "0")
    if [[ "$prev_count" -gt 0 ]]; then
      log "POS recovered after $prev_count consecutive failures"
    fi
    echo "0" > "$FAIL_COUNT_FILE"
    rm -f "$FIRST_FAIL_FILE" 2>/dev/null || true
    clear_escalation

    # Write healthy state
    echo "{\"status\":\"healthy\",\"checkedAt\":\"$(date -u +%FT%TZ)\"}" > "$STATE_DIR/watchdog-status.json" 2>/dev/null || true
    return 0
  fi

  # UNHEALTHY — increment failure counter
  local fail_count
  fail_count=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo "0")
  fail_count=$((fail_count + 1))
  echo "$fail_count" > "$FAIL_COUNT_FILE"

  # Record first failure time
  if [[ ! -f "$FIRST_FAIL_FILE" ]]; then
    echo "$now" > "$FIRST_FAIL_FILE"
  fi

  log "Health check FAILED (consecutive: $fail_count/$MAX_CONSECUTIVE_FAILURES)"

  # Write unhealthy state
  echo "{\"status\":\"unhealthy\",\"failCount\":$fail_count,\"checkedAt\":\"$(date -u +%FT%TZ)\"}" > "$STATE_DIR/watchdog-status.json" 2>/dev/null || true

  # Check if we should restart
  if [[ "$fail_count" -ge "$MAX_CONSECUTIVE_FAILURES" ]]; then
    log "Threshold reached — capturing diagnostics and restarting POS service"
    capture_diagnostics

    # Restart POS service
    if systemctl restart thepasspos 2>/dev/null; then
      log "POS service restart initiated"
      # Reset fail counter after restart (give it time to come up)
      echo "0" > "$FAIL_COUNT_FILE"
      # Don't clear first-fail — escalation window still counting
    else
      log "POS service restart FAILED"
    fi
  fi

  # Check escalation window
  local first_fail
  first_fail=$(cat "$FIRST_FAIL_FILE" 2>/dev/null || echo "$now")
  local elapsed=$((now - first_fail))

  if [[ "$elapsed" -ge "$ESCALATION_WINDOW_SECONDS" ]]; then
    escalate_to_mc "POS unhealthy for ${elapsed}s (>${ESCALATION_WINDOW_SECONDS}s threshold)"
  fi
}

main "$@"
