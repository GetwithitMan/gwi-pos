#!/usr/bin/env bash
# =============================================================================
# GWI POS — HA Health Check (keepalived VRRP_SCRIPT)
# =============================================================================
#
# Called by keepalived every 2 seconds (interval 2, fall 3 = ~6s before action).
# Exit 0 = healthy, Exit 1 = unhealthy.
#
# PRIMARY (STATION_ROLE=server):
#   - PG writable and not in recovery
#   - POS app responds on /api/health
#
# STANDBY (STATION_ROLE=backup):
#   - PG running and in recovery mode
#   - Replication lag monitored (warn-only, no auto-failover)
#
# Deployed to: /opt/gwi-pos/scripts/ha-check.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
LOG_DIR="/var/log/gwi-pos"
LOG_FILE="$LOG_DIR/ha-check.log"
LAG_STATE_FILE="/tmp/gwi-ha-lag-count"
MAX_LAG_SECONDS=30
MAX_LAG_CONSECUTIVE=3

mkdir -p "$LOG_DIR"

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [ha-check] $*" >> "$LOG_FILE"
}

# Keep log file from growing unbounded (keepalived calls every 2s)
trim_log() {
  if [[ -f "$LOG_FILE" ]] && [[ $(wc -l < "$LOG_FILE" 2>/dev/null || echo 0) -gt 2000 ]]; then
    tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Load environment
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: $ENV_FILE not found"
  exit 1
fi

STATION_ROLE=""
DB_USER=""
DB_NAME=""
MISSION_CONTROL_URL=""
SERVER_NODE_ID=""
SERVER_API_KEY=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  case "$key" in
    STATION_ROLE)        STATION_ROLE="$val" ;;
    DB_USER)             DB_USER="$val" ;;
    DB_NAME)             DB_NAME="$val" ;;
    MISSION_CONTROL_URL) MISSION_CONTROL_URL="$val" ;;
    SERVER_NODE_ID)      SERVER_NODE_ID="$val" ;;
    SERVER_API_KEY)      SERVER_API_KEY="$val" ;;
  esac
done < "$ENV_FILE"

DB_USER="${DB_USER:-thepasspos}"
DB_NAME="${DB_NAME:-thepasspos}"

if [[ -z "$STATION_ROLE" ]]; then
  log "ERROR: STATION_ROLE not set in $ENV_FILE"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# PRIMARY health check
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$STATION_ROLE" == "server" ]]; then

  # Check 1: PG is running and accepts queries
  if ! sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
    log "FAIL: PostgreSQL not responding"
    trim_log
    exit 1
  fi

  # Check 2: PG is primary (not in recovery)
  IN_RECOVERY=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
  if [[ "$IN_RECOVERY" != "f" ]]; then
    log "FAIL: PostgreSQL is in recovery mode (expected primary)"
    trim_log
    exit 1
  fi

  # Check 3: POS app is healthy
  if ! curl -sf --max-time 3 http://localhost:3005/api/health >/dev/null 2>&1; then
    log "FAIL: POS app /api/health not responding"
    trim_log
    exit 1
  fi

  # All checks passed
  trim_log
  exit 0

# ─────────────────────────────────────────────────────────────────────────────
# STANDBY health check
# ─────────────────────────────────────────────────────────────────────────────

elif [[ "$STATION_ROLE" == "backup" ]]; then

  # Check 1: PG is running
  if ! sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
    log "FAIL: PostgreSQL not running on standby"
    trim_log
    exit 1
  fi

  # Check 2: PG is in recovery mode (standby)
  IN_RECOVERY=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
  if [[ "$IN_RECOVERY" != "t" ]]; then
    log "WARN: Standby PostgreSQL is NOT in recovery mode — may have been promoted"
    # Still exit 0 — this is informational, keepalived handles state
    trim_log
    exit 0
  fi

  # Check 3: Replication lag (warn-only — no auto-failover per design)
  LAG_SECONDS=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc \
    "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int, -1)" 2>/dev/null || echo "-1")

  if [[ "$LAG_SECONDS" -gt "$MAX_LAG_SECONDS" ]]; then
    # Increment consecutive lag counter
    PREV_COUNT=0
    if [[ -f "$LAG_STATE_FILE" ]]; then
      PREV_COUNT=$(cat "$LAG_STATE_FILE" 2>/dev/null || echo 0)
    fi
    NEW_COUNT=$((PREV_COUNT + 1))
    echo "$NEW_COUNT" > "$LAG_STATE_FILE"

    log "WARN: Replication lag=${LAG_SECONDS}s (threshold=${MAX_LAG_SECONDS}s, consecutive=${NEW_COUNT}/${MAX_LAG_CONSECUTIVE})"

    if [[ "$NEW_COUNT" -ge "$MAX_LAG_CONSECUTIVE" ]]; then
      log "ALERT: Replication lag exceeded threshold for ${NEW_COUNT} consecutive checks — notifying MC"
      # Send warning to Mission Control (best-effort, non-blocking)
      if [[ -n "$MISSION_CONTROL_URL" ]] && [[ -n "$SERVER_NODE_ID" ]] && [[ -n "$SERVER_API_KEY" ]]; then
        ALERT_BODY=$(printf '{"nodeId":"%s","alert":"replication_lag","lagSeconds":%d,"consecutiveChecks":%d}' \
          "$SERVER_NODE_ID" "$LAG_SECONDS" "$NEW_COUNT")
        curl -sf --max-time 5 -X POST \
          "${MISSION_CONTROL_URL}/api/fleet/heartbeat" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $SERVER_API_KEY" \
          -H "X-Server-Node-Id: $SERVER_NODE_ID" \
          -d "$ALERT_BODY" >/dev/null 2>&1 || true
      fi
    fi
  else
    # Lag is OK — reset consecutive counter
    echo "0" > "$LAG_STATE_FILE" 2>/dev/null || true
  fi

  # Standby PG is running and streaming — healthy
  trim_log
  exit 0

else
  log "ERROR: Unknown STATION_ROLE=$STATION_ROLE (expected 'server' or 'backup')"
  trim_log
  exit 1
fi
