#!/usr/bin/env bash
# =============================================================================
# GWI POS — Rejoin as Standby (old primary → standby)
# =============================================================================
#
# Called when a previously-failed primary comes back online and needs to
# rejoin the cluster as a standby. Also triggered on boot if this node
# does not own the VIP.
#
# DESTRUCTIVE: Wipes local PG data and rebuilds from the current primary
# via pg_basebackup. All app services are stopped first.
#
# Exit codes:
#   0 = successfully rejoined as standby
#   1 = fatal error
#
# Deployed to: /opt/gwi-pos/scripts/rejoin-as-standby.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
APP_DIR="/opt/gwi-pos/app"
LOG_DIR="/var/log/gwi-pos"
LOG_FILE="$LOG_DIR/rejoin.log"
PG_DATA="/var/lib/postgresql/16/main"
PG_REPLICATION_USER="replicator"
BASEBACKUP_TIMEOUT=1800  # 30 minutes max for pg_basebackup

mkdir -p "$LOG_DIR"

log() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [rejoin] $*"
  echo "$msg" >> "$LOG_FILE"
  echo "$msg"
}

die() {
  log "FATAL: $*"
  exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Load environment
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  die "$ENV_FILE not found"
fi

STATION_ROLE=""
DB_USER=""
DB_NAME=""
HA_PEER_IP=""
MISSION_CONTROL_URL=""
SERVER_NODE_ID=""
SERVER_API_KEY=""
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
    HA_PEER_IP)          HA_PEER_IP="$val" ;;
    MISSION_CONTROL_URL) MISSION_CONTROL_URL="$val" ;;
    SERVER_NODE_ID)      SERVER_NODE_ID="$val" ;;
    SERVER_API_KEY)      SERVER_API_KEY="$val" ;;
    VIRTUAL_IP)          VIRTUAL_IP="$val" ;;
    HA_IFACE)            HA_IFACE="$val" ;;
  esac
done < "$ENV_FILE"

DB_USER="${DB_USER:-thepasspos}"
DB_NAME="${DB_NAME:-thepasspos}"

log "=== REJOIN AS STANDBY STARTED ==="
log "Current role: ${STATION_ROLE:-unknown}, Peer (new primary): ${HA_PEER_IP:-unknown}"

# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight: Determine the current primary's IP
# ─────────────────────────────────────────────────────────────────────────────

# The current primary is at HA_PEER_IP (the other node)
CURRENT_PRIMARY_IP="${HA_PEER_IP:-}"

if [[ -z "$CURRENT_PRIMARY_IP" ]]; then
  die "HA_PEER_IP not set in .env — cannot determine current primary"
fi

# Verify the current primary is actually reachable and serving
log "Verifying current primary at $CURRENT_PRIMARY_IP is reachable..."
if ! curl -sf --max-time 5 "http://${CURRENT_PRIMARY_IP}:3005/api/health" >/dev/null 2>&1; then
  log "WARN: Current primary at $CURRENT_PRIMARY_IP is not responding on /api/health"
  log "Attempting rejoin anyway — pg_basebackup will fail if primary is truly down"
fi

# Verify the primary's PG is accepting replication connections
if ! pg_isready -h "$CURRENT_PRIMARY_IP" -p 5432 -U "$PG_REPLICATION_USER" -t 5 >/dev/null 2>&1; then
  log "WARN: PostgreSQL on $CURRENT_PRIMARY_IP not accepting connections"
  log "Will attempt pg_basebackup anyway — it has its own timeout"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step A: Stop sync workers
# ─────────────────────────────────────────────────────────────────────────────

log "Stopping sync workers..."
pm2 stop sync-upstream 2>/dev/null || true
systemctl stop thepasspos-sync 2>/dev/null || true
log "Sync workers stopped"

# ─────────────────────────────────────────────────────────────────────────────
# Step B: Gracefully drain and stop POS application
# ─────────────────────────────────────────────────────────────────────────────
# Send SIGTERM first to allow the Node.js server's graceful shutdown handler
# to finish in-flight requests (typically a 10s drain timeout in server.ts).
# Wait 15 seconds for draining, then force-stop if still running.

log "Sending graceful shutdown signal to POS app..."

# systemd: SIGTERM for connection draining
systemctl kill --signal=SIGTERM thepasspos 2>/dev/null || true

# PM2: send SIGINT (PM2's graceful stop signal)
POSUSER=$(stat -c '%U' /opt/gwi-pos/app 2>/dev/null || echo "smarttab")
sudo -u "$POSUSER" pm2 sendSignal SIGINT gwi-pos 2>/dev/null || true

log "Waiting 15 seconds for in-flight requests to drain..."
sleep 15

# Now force-stop if still running
systemctl stop thepasspos 2>/dev/null || true
systemctl stop thepasspos-kiosk 2>/dev/null || true
sudo -u "$POSUSER" pm2 stop all 2>/dev/null || true

log "POS application stopped"

# ─────────────────────────────────────────────────────────────────────────────
# Step C: Safety check BEFORE stopping PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────
# Verify PG is not still acting as primary before we proceed with teardown.
# This prevents WAL loss if this script is called on a node that hasn't actually
# been demoted yet (e.g., operator error or split-brain scenario).
# MUST run BEFORE PG stop — once PG is stopped we can't query it.

log "Running safety check: verifying this node is not still acting as primary..."
PG_IN_RECOVERY=$(sudo -u postgres psql -t -c "SELECT pg_is_in_recovery();" 2>/dev/null | tr -d ' ')
if [[ "$PG_IN_RECOVERY" != "t" ]] && [[ "$PG_IN_RECOVERY" != "" ]] && [[ "$PG_IN_RECOVERY" != "unknown" ]]; then
  log "ERROR: PostgreSQL is NOT in recovery mode — it may still be acting as primary!"
  log "This means data could be lost. Refusing to proceed."
  log "If you are SURE this node should be standby, first promote the other node, then retry."
  die "Safety check failed: PG not in recovery. Manual intervention required."
fi
log "Safety check passed: PG is in recovery mode (standby)"

# ─────────────────────────────────────────────────────────────────────────────
# Step D: Stop PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

log "Stopping PostgreSQL..."
systemctl stop postgresql 2>/dev/null || true

# Verify PG is actually stopped
if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  log "WARN: PostgreSQL still running after systemctl stop — force killing"
  pkill -9 postgres 2>/dev/null || true
  sleep 2
fi

log "PostgreSQL stopped"

# ─────────────────────────────────────────────────────────────────────────────
# Step E: Remove old PG data
# ─────────────────────────────────────────────────────────────────────────────

log "Removing old PostgreSQL data directory ($PG_DATA)..."

if [[ ! -d "$PG_DATA" ]]; then
  log "WARN: PG data directory doesn't exist — creating it"
  mkdir -p "$PG_DATA"
else
  rm -rf "${PG_DATA:?}"/*
fi

log "PG data directory cleared"

# ─────────────────────────────────────────────────────────────────────────────
# Step E: pg_basebackup from current primary
# ─────────────────────────────────────────────────────────────────────────────

log "Running pg_basebackup from $CURRENT_PRIMARY_IP (timeout ${BASEBACKUP_TIMEOUT}s)..."

if ! timeout "$BASEBACKUP_TIMEOUT" sudo -u postgres pg_basebackup \
  -h "$CURRENT_PRIMARY_IP" \
  -D "$PG_DATA" \
  -U "$PG_REPLICATION_USER" \
  -P \
  -R \
  --checkpoint=fast \
  --wal-method=stream \
  2>&1 | tee -a "$LOG_FILE"; then
  die "pg_basebackup failed — check network, replication user, and pg_hba.conf on primary"
fi

log "pg_basebackup completed"

# ─────────────────────────────────────────────────────────────────────────────
# Step F: Create standby.signal
# ─────────────────────────────────────────────────────────────────────────────

# pg_basebackup -R creates standby.signal + postgresql.auto.conf, but verify
if [[ ! -f "$PG_DATA/standby.signal" ]]; then
  log "Creating standby.signal..."
  touch "$PG_DATA/standby.signal"
fi

log "standby.signal present"

# ─────────────────────────────────────────────────────────────────────────────
# Step G: Verify/configure primary_conninfo
# ─────────────────────────────────────────────────────────────────────────────

AUTO_CONF="$PG_DATA/postgresql.auto.conf"

# pg_basebackup -R should have written primary_conninfo, but verify
if ! grep -q "primary_conninfo" "$AUTO_CONF" 2>/dev/null; then
  log "Adding primary_conninfo to postgresql.auto.conf..."
  echo "primary_conninfo = 'host=$CURRENT_PRIMARY_IP port=5432 user=$PG_REPLICATION_USER'" >> "$AUTO_CONF"
fi

log "primary_conninfo configured: $(grep primary_conninfo "$AUTO_CONF" 2>/dev/null | head -1)"

# ─────────────────────────────────────────────────────────────────────────────
# Step H: Fix ownership
# ─────────────────────────────────────────────────────────────────────────────

log "Setting ownership on PG data directory..."
chown -R postgres:postgres "$PG_DATA"
chmod 700 "$PG_DATA"
log "Ownership set"

# ─────────────────────────────────────────────────────────────────────────────
# Step I: Start PostgreSQL
# ─────────────────────────────────────────────────────────────────────────────

log "Starting PostgreSQL..."
systemctl start postgresql 2>&1 | tee -a "$LOG_FILE"

# Wait for PG to be ready
WAITED=0
PG_READY=false
while [[ $WAITED -lt 30 ]]; do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    PG_READY=true
    log "PostgreSQL started after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [[ "$PG_READY" != "true" ]]; then
  die "PostgreSQL did not start within 30s — check journalctl -u postgresql"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step J: Verify replication streaming
# ─────────────────────────────────────────────────────────────────────────────

log "Verifying replication streaming..."

# Check that PG is in recovery mode (standby)
IN_RECOVERY=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
if [[ "$IN_RECOVERY" != "t" ]]; then
  log "WARN: PostgreSQL is NOT in recovery mode (got: $IN_RECOVERY) — standby setup may have failed"
fi

# Check WAL receiver status (may take a few seconds to connect)
sleep 3
WAL_STATUS=$(sudo -u postgres psql -tAc "SELECT status FROM pg_stat_wal_receiver LIMIT 1" 2>/dev/null || echo "none")
log "WAL receiver status: $WAL_STATUS"

if [[ "$WAL_STATUS" == "streaming" ]]; then
  log "Replication streaming confirmed"
elif [[ "$WAL_STATUS" == "catchup" ]] || [[ "$WAL_STATUS" == "startup" ]]; then
  log "Replication catching up — this is expected after basebackup"
else
  log "WARN: WAL receiver status is '$WAL_STATUS' — replication may not be established"
  log "Check primary's pg_hba.conf allows replication from this node"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step K: Update .env to reflect standby role
# ─────────────────────────────────────────────────────────────────────────────

log "Updating STATION_ROLE=backup in .env..."

if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^STATION_ROLE=.*|STATION_ROLE=backup|" "$ENV_FILE"
else
  echo "STATION_ROLE=backup" >> "$ENV_FILE"
fi

# Copy updated .env into app directory
cp "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
cp "$ENV_FILE" "$APP_DIR/.env.local" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# Step L: Report to Mission Control
# ─────────────────────────────────────────────────────────────────────────────

if [[ -n "${MISSION_CONTROL_URL:-}" ]] && [[ -n "${SERVER_API_KEY:-}" ]]; then
  log "Reporting rejoin to Mission Control..."
  REJOIN_BODY=$(printf '{"event":"rejoin_standby","nodeId":"%s","primaryIp":"%s","walStatus":"%s","timestamp":"%s"}' \
    "${SERVER_NODE_ID:-unknown}" \
    "$CURRENT_PRIMARY_IP" \
    "$WAL_STATUS" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

  MC_HTTP=$(curl -sf --max-time 10 -X POST \
    "${MISSION_CONTROL_URL}/api/fleet/failover-event" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVER_API_KEY" \
    -H "X-Server-Node-Id: ${SERVER_NODE_ID:-}" \
    -d "$REJOIN_BODY" \
    -o /dev/null -w "%{http_code}" 2>/dev/null) || MC_HTTP="error"

  log "Mission Control response: HTTP $MC_HTTP"
else
  log "WARN: MISSION_CONTROL_URL or SERVER_API_KEY not set — skipping MC notification"
fi

log "=== REJOIN AS STANDBY COMPLETE ==="
log "This node is now a standby. POS app is NOT running (standby does not serve traffic)."
log "WAL receiver: $WAL_STATUS | Recovery mode: $IN_RECOVERY"

exit 0
