#!/usr/bin/env bash
# =============================================================================
# GWI POS — Promote Standby to Primary
# =============================================================================
#
# Called when a backup NUC needs to become the primary.
# Triggered by keepalived VRRP transition or manual invocation.
#
# Exit codes:
#   0 = promotion successful
#   1 = fencing abort (old primary still alive)
#   2 = PG promote failed
#   3 = POS app failed to start
#
# Deployed to: /opt/gwi-pos/scripts/promote.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
APP_DIR="/opt/gwi-pos/app"
LOG_DIR="/var/log/gwi-pos"
LOG_FILE="$LOG_DIR/promote.log"
PG_DATA="/var/lib/postgresql/16/main"
PG_PROMOTE_TIMEOUT=10

mkdir -p "$LOG_DIR"

log() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [promote] $*"
  echo "$msg" >> "$LOG_FILE"
  echo "$msg"
}

die() {
  local code=$1; shift
  log "FATAL: $* (exit $code)"
  exit "$code"
}

# ─────────────────────────────────────────────────────────────────────────────
# Load environment
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  die 3 "$ENV_FILE not found"
fi

STATION_ROLE=""
DB_USER=""
DB_NAME=""
MISSION_CONTROL_URL=""
SERVER_NODE_ID=""
SERVER_API_KEY=""
HA_PEER_IP=""
HA_SHARED_SECRET=""
VIRTUAL_IP=""
HA_IFACE=""

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
    HA_PEER_IP)          HA_PEER_IP="$val" ;;
    HA_SHARED_SECRET)    HA_SHARED_SECRET="$val" ;;
    VIRTUAL_IP)          VIRTUAL_IP="$val" ;;
    HA_IFACE)            HA_IFACE="$val" ;;
  esac
done < "$ENV_FILE"

DB_USER="${DB_USER:-thepasspos}"
DB_NAME="${DB_NAME:-thepasspos}"

log "=== PROMOTION STARTED ==="
log "Current role: ${STATION_ROLE:-unknown}, Peer: ${HA_PEER_IP:-unknown}"

# ─────────────────────────────────────────────────────────────────────────────
# Step A: Stop sync workers (if running)
# ─────────────────────────────────────────────────────────────────────────────

log "Stopping sync workers..."
pm2 stop sync-upstream 2>/dev/null || true
systemctl stop thepasspos-sync 2>/dev/null || true
log "Sync workers stopped"

# ─────────────────────────────────────────────────────────────────────────────
# Step B: Fencing check (MANDATORY)
# ─────────────────────────────────────────────────────────────────────────────
# If the old primary is still alive and serving, we MUST NOT promote.
# Split-brain prevention: only promote if old primary is unreachable or fenced.

log "Performing fencing check against old primary..."

if [[ -n "$HA_PEER_IP" ]]; then
  FENCE_URL="http://${HA_PEER_IP}:3005/api/fence-check"
  FENCE_HTTP_CODE="000"

  FENCE_RESP=$(mktemp)
  FENCE_HTTP_CODE=$(curl -sf --max-time 2 --connect-timeout 2 \
    -H "X-HA-Secret: ${HA_SHARED_SECRET:-}" \
    -o "$FENCE_RESP" \
    -w "%{http_code}" \
    "$FENCE_URL" 2>/dev/null) || FENCE_HTTP_CODE="000"

  if [[ "$FENCE_HTTP_CODE" == "200" ]]; then
    # Old primary responded — check if it thinks it's still primary
    PEER_ROLE=$(cat "$FENCE_RESP" 2>/dev/null | grep -o '"role":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
    rm -f "$FENCE_RESP"

    if [[ "$PEER_ROLE" == "primary" ]] || [[ "$PEER_ROLE" == "server" ]]; then
      log "ABORT: Old primary at $HA_PEER_IP is still alive (role=$PEER_ROLE, HTTP $FENCE_HTTP_CODE)"
      log "Split-brain prevention: will NOT promote while old primary is reachable"

      # Alert Mission Control
      if [[ -n "$MISSION_CONTROL_URL" ]] && [[ -n "$SERVER_API_KEY" ]]; then
        curl -sf --max-time 5 -X POST \
          "${MISSION_CONTROL_URL}/api/fleet/failover-event" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $SERVER_API_KEY" \
          -H "X-Server-Node-Id: ${SERVER_NODE_ID:-}" \
          -d "{\"event\":\"promotion_aborted\",\"reason\":\"fencing_failed\",\"peerIp\":\"$HA_PEER_IP\",\"peerRole\":\"$PEER_ROLE\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
          >/dev/null 2>&1 || true
      fi

      die 1 "Fencing check failed — old primary still active"
    fi

    rm -f "$FENCE_RESP"
    log "Fencing OK: old primary responded but role=$PEER_ROLE (not primary)"
  else
    rm -f "$FENCE_RESP" 2>/dev/null || true
    log "Fencing OK: old primary unreachable (HTTP $FENCE_HTTP_CODE) — safe to promote"
  fi
else
  log "WARN: HA_PEER_IP not configured — skipping fencing check (manual promotion assumed)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step C: Promote PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

log "Promoting PostgreSQL from standby to primary..."

# Check if PG is actually in recovery mode
IN_RECOVERY=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")

if [[ "$IN_RECOVERY" == "f" ]]; then
  log "PostgreSQL is already primary (not in recovery) — skipping pg_ctl promote"
elif [[ "$IN_RECOVERY" == "t" ]]; then
  # Promote using pg_ctl
  if ! sudo -u postgres pg_ctlcluster 16 main promote 2>&1 | tee -a "$LOG_FILE"; then
    # Fallback to direct pg_ctl
    if ! sudo -u postgres pg_ctl promote -D "$PG_DATA" 2>&1 | tee -a "$LOG_FILE"; then
      die 2 "pg_ctl promote failed"
    fi
  fi
  log "pg_ctl promote issued"
else
  die 2 "Cannot determine PG recovery state (got: $IN_RECOVERY)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step D: Wait for PG to accept writes
# ─────────────────────────────────────────────────────────────────────────────

log "Waiting for PostgreSQL to exit recovery mode (max ${PG_PROMOTE_TIMEOUT}s)..."

WAITED=0
while [[ $WAITED -lt $PG_PROMOTE_TIMEOUT ]]; do
  CHECK=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
  if [[ "$CHECK" == "f" ]]; then
    log "PostgreSQL is now primary (read-write) after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [[ "$CHECK" != "f" ]]; then
  die 2 "PostgreSQL did not exit recovery mode within ${PG_PROMOTE_TIMEOUT}s"
fi

# Remove standby.signal if it exists (PG removes it on promote, but be safe)
rm -f "$PG_DATA/standby.signal" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# Step E: Start POS application
# ─────────────────────────────────────────────────────────────────────────────

log "Starting POS application..."

# Try systemd first (production), fall back to PM2
if systemctl is-enabled thepasspos >/dev/null 2>&1; then
  systemctl restart thepasspos 2>&1 | tee -a "$LOG_FILE" || true
else
  # Fallback: PM2
  POSUSER=$(stat -c '%U' /opt/gwi-pos/app 2>/dev/null || echo "smarttab")
  sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && pm2 start ecosystem.config.js" 2>&1 | tee -a "$LOG_FILE" || true
fi

# Wait for POS to become healthy
log "Waiting for POS app to become healthy (up to 60s)..."
APP_READY=false
for i in $(seq 1 30); do
  if curl -sf --max-time 2 http://localhost:3005/api/health >/dev/null 2>&1; then
    APP_READY=true
    log "POS app healthy after $((i * 2))s"
    break
  fi
  sleep 2
done

if [[ "$APP_READY" != "true" ]]; then
  log "ERROR: POS app did not become healthy within 60s"
  # Don't die here — PG is promoted, we should continue with remaining steps
  # The app may come up later
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step F: Gratuitous ARP (claim the VIP on the network)
# ─────────────────────────────────────────────────────────────────────────────

if [[ -n "$VIRTUAL_IP" ]] && [[ -n "$HA_IFACE" ]]; then
  log "Sending gratuitous ARP for VIP $VIRTUAL_IP on $HA_IFACE..."
  arping -U -I "$HA_IFACE" "$VIRTUAL_IP" -c 3 2>&1 | tee -a "$LOG_FILE" || {
    log "WARN: arping failed (may need to install iputils-arping)"
  }
else
  log "WARN: VIRTUAL_IP or HA_IFACE not set — skipping gratuitous ARP"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step G: Hardware self-test (best-effort)
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$APP_READY" == "true" ]]; then
  log "Running hardware self-test..."
  HW_RESULT=$(curl -sf --max-time 10 http://localhost:3005/api/hardware/test-all 2>/dev/null || echo '{"error":"unreachable"}')
  log "Hardware test result: $HW_RESULT"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step H: Start upstream sync (if configured)
# ─────────────────────────────────────────────────────────────────────────────

log "Starting upstream sync workers..."
if systemctl is-enabled thepasspos-sync >/dev/null 2>&1; then
  systemctl start thepasspos-sync 2>&1 | tee -a "$LOG_FILE" || true
else
  POSUSER=$(stat -c '%U' /opt/gwi-pos/app 2>/dev/null || echo "smarttab")
  sudo -u "$POSUSER" pm2 start sync-upstream 2>/dev/null || true
fi
log "Sync workers started"

# ─────────────────────────────────────────────────────────────────────────────
# Step I: Report to Mission Control
# ─────────────────────────────────────────────────────────────────────────────

if [[ -n "$MISSION_CONTROL_URL" ]] && [[ -n "$SERVER_API_KEY" ]]; then
  log "Reporting failover event to Mission Control..."
  FAILOVER_BODY=$(printf '{"event":"promotion_complete","fromNodeId":"%s","toNodeId":"%s","peerIp":"%s","timestamp":"%s","appHealthy":%s}' \
    "${HA_PEER_IP:-unknown}" \
    "${SERVER_NODE_ID:-unknown}" \
    "${HA_PEER_IP:-unknown}" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$APP_READY")

  MC_HTTP=$(curl -sf --max-time 10 -X POST \
    "${MISSION_CONTROL_URL}/api/fleet/failover-event" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVER_API_KEY" \
    -H "X-Server-Node-Id: ${SERVER_NODE_ID:-}" \
    -d "$FAILOVER_BODY" \
    -o /dev/null -w "%{http_code}" 2>/dev/null) || MC_HTTP="error"

  log "Mission Control response: HTTP $MC_HTTP"
else
  log "WARN: MISSION_CONTROL_URL or SERVER_API_KEY not set — skipping MC notification"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step J: Update .env to reflect new role
# ─────────────────────────────────────────────────────────────────────────────

log "Updating STATION_ROLE=server in .env..."

if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^STATION_ROLE=.*|STATION_ROLE=server|" "$ENV_FILE"
else
  echo "STATION_ROLE=server" >> "$ENV_FILE"
fi

# Copy updated .env into app directory
cp "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
cp "$ENV_FILE" "$APP_DIR/.env.local" 2>/dev/null || true

log "=== PROMOTION COMPLETE ==="

if [[ "$APP_READY" != "true" ]]; then
  die 3 "Promotion completed but POS app is not healthy — check logs"
fi

exit 0
