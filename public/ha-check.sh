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
LEASE_RENEW_STATE="/tmp/gwi-ha-lease-last-renew"
LEASE_RENEW_INTERVAL=10  # seconds between MC lease renewals
LEASE_TTL=30             # requested lease duration in seconds
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
POS_VENUE_SLUG=""
INTERNAL_API_SECRET=""
HA_SHARED_SECRET=""

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
    POS_VENUE_SLUG)      POS_VENUE_SLUG="$val" ;;
    INTERNAL_API_SECRET) INTERNAL_API_SECRET="$val" ;;
    HA_SHARED_SECRET)    HA_SHARED_SECRET="$val" ;;
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

  # ─────────────────────────────────────────────────────────────────────────
  # MC Primary Lease Renewal (best-effort, non-blocking)
  # ─────────────────────────────────────────────────────────────────────────
  # keepalived calls this script every 2 seconds. We only renew the MC
  # lease every LEASE_RENEW_INTERVAL seconds (10s) to avoid hammering MC.
  # The lease TTL is 30s, so we have ~20s of safety margin.
  #
  # This runs AFTER the health checks so a failing primary never renews
  # its lease — allowing the backup to claim it.

  if [[ -n "$MISSION_CONTROL_URL" ]] && [[ -n "$SERVER_NODE_ID" ]] && [[ -n "$SERVER_API_KEY" ]]; then
    SHOULD_RENEW=false
    NOW_EPOCH=$(date +%s)

    if [[ -f "$LEASE_RENEW_STATE" ]]; then
      LAST_RENEW=$(cat "$LEASE_RENEW_STATE" 2>/dev/null || echo "0")
      ELAPSED=$((NOW_EPOCH - LAST_RENEW))
      if [[ "$ELAPSED" -ge "$LEASE_RENEW_INTERVAL" ]]; then
        SHOULD_RENEW=true
      fi
    else
      SHOULD_RENEW=true
    fi

    if [[ "$SHOULD_RENEW" == "true" ]]; then
      RENEW_BODY=$(printf '{"venueSlug":"%s","nodeId":"%s","ttl":%d}' \
        "${POS_VENUE_SLUG:-unknown}" \
        "$SERVER_NODE_ID" \
        "$LEASE_TTL")

      RENEW_RESP=$(mktemp)
      RENEW_HTTP=$(curl -sf --max-time 3 --connect-timeout 2 \
        -X POST "${MISSION_CONTROL_URL}/api/fleet/ha/renew-lease" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $SERVER_API_KEY" \
        -H "X-Server-Node-Id: $SERVER_NODE_ID" \
        -o "$RENEW_RESP" \
        -w "%{http_code}" 2>/dev/null) || RENEW_HTTP="000"

      echo "$NOW_EPOCH" > "$LEASE_RENEW_STATE" 2>/dev/null || true

      if [[ "$RENEW_HTTP" == "200" ]]; then
        # Extract lease expiry and update local POS app
        LEASE_EXP=$(cat "$RENEW_RESP" 2>/dev/null | grep -o '"leaseExpiresAt":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
        if [[ -n "$LEASE_EXP" ]]; then
          # Update local POS in-memory lease state (best-effort)
          LOCAL_AUTH="${INTERNAL_API_SECRET:-${HA_SHARED_SECRET:-}}"
          if [[ -n "$LOCAL_AUTH" ]]; then
            curl -sf --max-time 1 -X POST \
              "http://localhost:3005/api/internal/ha-lease" \
              -H "Content-Type: application/json" \
              -H "Authorization: Bearer $LOCAL_AUTH" \
              -d "{\"leaseExpiresAt\":\"$LEASE_EXP\"}" \
              >/dev/null 2>&1 || true
          fi
        fi
        # Renewal succeeded — no log (too noisy at 2s intervals)
      elif [[ "$RENEW_HTTP" == "000" ]]; then
        log "WARN: MC lease renewal unreachable (HTTP 000) — lease may expire"
      else
        log "WARN: MC lease renewal failed (HTTP $RENEW_HTTP)"
      fi

      rm -f "$RENEW_RESP" 2>/dev/null || true
    fi
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
    log "FAIL: Standby PostgreSQL is NOT in recovery mode — may have been promoted"
    # Exit 1 — a promoted standby is no longer a valid standby; keepalived must detect this
    trim_log
    exit 1
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
