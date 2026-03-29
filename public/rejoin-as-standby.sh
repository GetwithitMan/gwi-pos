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
#   1 = safety check failed
#   2 = pg_basebackup failed
#   3 = verification failed (PG not in recovery after rejoin)
#
# Flags:
#   --automated           Skip interactive prompts (for programmatic use)
#   --new-primary-ip=IP   Override HA_PEER_IP with the specified IP
#
# Deployed to: /opt/gwi-pos/scripts/rejoin-as-standby.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Parse arguments
# ─────────────────────────────────────────────────────────────────────────────

AUTOMATED=false
NEW_PRIMARY_IP_ARG=""

for arg in "$@"; do
  case "$arg" in
    --automated)
      AUTOMATED=true
      ;;
    --new-primary-ip=*)
      NEW_PRIMARY_IP_ARG="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--automated] [--new-primary-ip=IP]" >&2
      exit 1
      ;;
  esac
done

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
APP_DIR="/opt/gwi-pos/app"
LOG_DIR="/var/log/gwi-pos"
LOG_FILE="$LOG_DIR/rejoin.log"
STATE_DIR="/opt/gwi-pos/state"
REJOIN_RESULT_FILE="$STATE_DIR/rejoin-result.json"
PG_DATA="/var/lib/postgresql/16/main"
PG_REPLICATION_USER="replicator"
BASEBACKUP_TIMEOUT=1800  # 30 minutes max for pg_basebackup

mkdir -p "$LOG_DIR"
mkdir -p "$STATE_DIR"

log() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [rejoin] $*"
  echo "$msg" >> "$LOG_FILE"
  echo "$msg"
}

# Write structured JSON result for programmatic consumption
write_result() {
  local status="$1"
  local error="${2:-}"
  local wal_status="${3:-none}"
  local lag_bytes="${4:--1}"
  local primary_ip="${5:-unknown}"

  cat > "$REJOIN_RESULT_FILE" <<EOJSON
{"role":"backup","rejoinStatus":"$status","rejoinError":"$error","walStatus":"$wal_status","lagBytes":${lag_bytes},"primaryIp":"$primary_ip","checkedAt":"$(date -u +%FT%TZ)"}
EOJSON
  log "Result written to $REJOIN_RESULT_FILE (status=$status)"
}

die_safety() {
  log "FATAL (safety): $*"
  write_result "failed" "safety_check_failed" "none" "-1" "${CURRENT_PRIMARY_IP:-unknown}"
  exit 1
}

die_basebackup() {
  log "FATAL (basebackup): $*"
  write_result "failed" "pg_basebackup_failed" "none" "-1" "${CURRENT_PRIMARY_IP:-unknown}"
  exit 2
}

die_verification() {
  log "FATAL (verification): $*"
  write_result "failed" "verification_failed" "none" "-1" "${CURRENT_PRIMARY_IP:-unknown}"
  exit 3
}

# Legacy die (defaults to safety exit code 1)
die() {
  log "FATAL: $*"
  write_result "failed" "fatal_error" "none" "-1" "${CURRENT_PRIMARY_IP:-unknown}"
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
REPL_PASSWORD=""

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
    REPL_PASSWORD)       REPL_PASSWORD="$val" ;;
  esac
done < "$ENV_FILE"

DB_USER="${DB_USER:-thepasspos}"
DB_NAME="${DB_NAME:-thepasspos}"

log "=== REJOIN AS STANDBY STARTED ==="
log "Current role: ${STATION_ROLE:-unknown}, Peer (new primary): ${HA_PEER_IP:-unknown}"
if [[ "$AUTOMATED" == "true" ]]; then
  log "Running in --automated mode (no interactive prompts)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight: Determine the current primary's IP
# ─────────────────────────────────────────────────────────────────────────────

# --new-primary-ip flag overrides the .env value
if [[ -n "$NEW_PRIMARY_IP_ARG" ]]; then
  CURRENT_PRIMARY_IP="$NEW_PRIMARY_IP_ARG"
  log "Using --new-primary-ip override: $CURRENT_PRIMARY_IP"
else
  CURRENT_PRIMARY_IP="${HA_PEER_IP:-}"
fi

if [[ -z "$CURRENT_PRIMARY_IP" ]]; then
  die "HA_PEER_IP not set in .env and --new-primary-ip not provided — cannot determine current primary"
fi

# Verify the current primary is actually reachable and serving
log "Verifying current primary at $CURRENT_PRIMARY_IP is reachable..."
if ! curl -sf --max-time 5 "http://${CURRENT_PRIMARY_IP}:3005/api/health" >/dev/null 2>&1; then
  log "WARN: Current primary at $CURRENT_PRIMARY_IP is not responding on /api/health"
  if [[ "$AUTOMATED" == "true" ]]; then
    log "In automated mode — proceeding anyway"
  else
    log "Attempting rejoin anyway — pg_basebackup will fail if primary is truly down"
  fi
fi

# Verify the primary's PG is accepting replication connections
if ! pg_isready -h "$CURRENT_PRIMARY_IP" -p 5432 -U "$PG_REPLICATION_USER" -t 5 >/dev/null 2>&1; then
  log "WARN: PostgreSQL on $CURRENT_PRIMARY_IP not accepting connections"
  log "Will attempt pg_basebackup anyway — it has its own timeout"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Interactive confirmation (skipped in --automated mode)
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$AUTOMATED" != "true" ]]; then
  echo ""
  echo "==================================================================="
  echo "  WARNING: This will DESTROY all local PostgreSQL data."
  echo "  The database will be rebuilt from $CURRENT_PRIMARY_IP."
  echo "==================================================================="
  echo ""
  read -r -p "Type 'yes' to continue: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    log "User cancelled rejoin"
    exit 1
  fi
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
  die_safety "Safety check failed: PG not in recovery. Manual intervention required."
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
# Step F: pg_basebackup from current primary
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
  --slot=standby_slot \
  2>&1 | tee -a "$LOG_FILE"; then

  # ── Diagnose pg_basebackup failure ──
  log "ERROR: pg_basebackup failed. Running diagnostics..."

  # Check 1: Is the primary reachable at all?
  if ! ping -c 1 -W 3 "$CURRENT_PRIMARY_IP" >/dev/null 2>&1; then
    log "  DIAG: Primary $CURRENT_PRIMARY_IP is NOT reachable (ping failed)"
  else
    log "  DIAG: Primary $CURRENT_PRIMARY_IP is reachable (ping OK)"
  fi

  # Check 2: Is PostgreSQL accepting connections on the primary?
  if ! pg_isready -h "$CURRENT_PRIMARY_IP" -p 5432 -t 5 >/dev/null 2>&1; then
    log "  DIAG: PostgreSQL on $CURRENT_PRIMARY_IP is NOT accepting connections"
  else
    log "  DIAG: PostgreSQL on $CURRENT_PRIMARY_IP is accepting connections"
  fi

  # Check 3: Can the replication user authenticate?
  if ! PGPASSWORD="${REPL_PASSWORD:-}" psql -h "$CURRENT_PRIMARY_IP" -U "$PG_REPLICATION_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
    log "  DIAG: Replication user '$PG_REPLICATION_USER' cannot authenticate on primary"
    log "  DIAG: Check REPL_PASSWORD in .env matches primary's REPL_PASSWORD"
  else
    log "  DIAG: Replication user authentication OK"
  fi

  # Check 4: Is the replication slot available?
  SLOT_EXISTS=$(PGPASSWORD="${REPL_PASSWORD:-}" psql -h "$CURRENT_PRIMARY_IP" -U "$PG_REPLICATION_USER" -d postgres -tAc \
    "SELECT count(*) FROM pg_replication_slots WHERE slot_name = 'standby_slot'" 2>/dev/null || echo "unknown")
  log "  DIAG: Replication slot 'standby_slot' on primary: ${SLOT_EXISTS} (1=exists, 0=missing)"

  # Check 5: Is wal_level set to replica on primary?
  WAL_LEVEL=$(PGPASSWORD="${REPL_PASSWORD:-}" psql -h "$CURRENT_PRIMARY_IP" -U "$PG_REPLICATION_USER" -d postgres -tAc \
    "SHOW wal_level" 2>/dev/null || echo "unknown")
  log "  DIAG: Primary wal_level = $WAL_LEVEL (must be 'replica' or 'logical')"

  die_basebackup "pg_basebackup failed — see diagnostics above"
fi

log "pg_basebackup completed"

# ─────────────────────────────────────────────────────────────────────────────
# Step G: Verify standby.signal
# ─────────────────────────────────────────────────────────────────────────────

# pg_basebackup -R creates standby.signal + postgresql.auto.conf, but verify
if [[ ! -f "$PG_DATA/standby.signal" ]]; then
  log "WARN: standby.signal missing after pg_basebackup -R — creating it manually"
  touch "$PG_DATA/standby.signal"
  chown postgres:postgres "$PG_DATA/standby.signal"
fi

log "standby.signal present at $PG_DATA/standby.signal"

# ─────────────────────────────────────────────────────────────────────────────
# Step H: Verify/configure primary_conninfo
# ─────────────────────────────────────────────────────────────────────────────

AUTO_CONF="$PG_DATA/postgresql.auto.conf"

# pg_basebackup -R should have written primary_conninfo, but verify
if ! grep -q "primary_conninfo" "$AUTO_CONF" 2>/dev/null; then
  log "Adding primary_conninfo to postgresql.auto.conf..."
  echo "primary_conninfo = 'host=$CURRENT_PRIMARY_IP port=5432 user=$PG_REPLICATION_USER'" >> "$AUTO_CONF"
fi

log "primary_conninfo configured: $(grep primary_conninfo "$AUTO_CONF" 2>/dev/null | head -1)"

# ─────────────────────────────────────────────────────────────────────────────
# Step I: Fix ownership
# ─────────────────────────────────────────────────────────────────────────────

log "Setting ownership on PG data directory..."
chown -R postgres:postgres "$PG_DATA"
chmod 700 "$PG_DATA"
log "Ownership set"

# ─────────────────────────────────────────────────────────────────────────────
# Step J: Start PostgreSQL
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
  die_verification "PostgreSQL did not start within 30s — check journalctl -u postgresql"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step K: Verify replication streaming
# ─────────────────────────────────────────────────────────────────────────────

log "Verifying replication streaming..."

# Check that PG is in recovery mode (standby) — this is the critical gate
IN_RECOVERY=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
if [[ "$IN_RECOVERY" == "t" ]]; then
  log "pg_is_in_recovery() = true — PostgreSQL is in standby mode"
else
  log "ERROR: pg_is_in_recovery() = $IN_RECOVERY — PostgreSQL is NOT in recovery mode"
  log "The standby setup failed. standby.signal may be missing or primary_conninfo wrong."
  log "Check: ls -la $PG_DATA/standby.signal"
  log "Check: grep primary_conninfo $PG_DATA/postgresql.auto.conf"
  die_verification "PG not in recovery mode after rejoin"
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

# Check replication lag
LAG_BYTES=$(sudo -u postgres psql -tAc "SELECT COALESCE(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()), -1)" 2>/dev/null || echo "-1")
if [[ "$LAG_BYTES" != "-1" ]]; then
  log "Replication lag: ${LAG_BYTES} bytes"
fi

# Write structured result for programmatic consumption
REPL_OK=$( [[ "$IN_RECOVERY" == "t" ]] && echo "true" || echo "false" )
LAST_RECEIVE_LSN=$(sudo -u postgres psql -tAc "SELECT COALESCE(pg_last_wal_receive_lsn()::text, 'none')" 2>/dev/null || echo "none")

# Write both the replication-status.json (legacy) and rejoin-result.json (new)
cat > "$STATE_DIR/replication-status.json" <<EOJSON
{"role":"backup","inRecovery":$REPL_OK,"rejoinStatus":"completed","walStatus":"$WAL_STATUS","lagBytes":${LAG_BYTES},"lastReceiveLsn":"$LAST_RECEIVE_LSN","primaryIp":"$CURRENT_PRIMARY_IP","checkedAt":"$(date -u +%FT%TZ)"}
EOJSON
log "Replication status written to $STATE_DIR/replication-status.json"

write_result "completed" "" "$WAL_STATUS" "$LAG_BYTES" "$CURRENT_PRIMARY_IP"

# ─────────────────────────────────────────────────────────────────────────────
# Step L: Update .env to reflect standby role
# ─────────────────────────────────────────────────────────────────────────────

log "Updating STATION_ROLE=backup in .env..."

if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
  sed -i "s|^STATION_ROLE=.*|STATION_ROLE=backup|" "$ENV_FILE"
else
  echo "STATION_ROLE=backup" >> "$ENV_FILE"
fi

# Also update PRIMARY_NUC_IP to point at the new primary
if [[ -n "$CURRENT_PRIMARY_IP" ]]; then
  if grep -q "^PRIMARY_NUC_IP=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^PRIMARY_NUC_IP=.*|PRIMARY_NUC_IP=$CURRENT_PRIMARY_IP|" "$ENV_FILE"
  fi
  if grep -q "^HA_PEER_IP=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^HA_PEER_IP=.*|HA_PEER_IP=$CURRENT_PRIMARY_IP|" "$ENV_FILE"
  fi
fi

# Copy updated .env into app directory
cp "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
cp "$ENV_FILE" "$APP_DIR/.env.local" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# Step M: Report to Mission Control
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
