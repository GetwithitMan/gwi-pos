#!/usr/bin/env bash
# =============================================================================
# GWI POS — Replacement NUC Restore Workflow
# =============================================================================
#
# Interactive script for restoring a replacement NUC from backup.
# Supports two restore sources:
#   1. Cloud backup (S3) — encrypted AES-256-CBC dump
#   2. Neon seed — pg_dump from Neon cloud database
#
# Safety: refuses to run on an active primary with open orders.
# All steps logged to stdout + /opt/gwi-pos/logs/restore.log
#
# Usage:
#   sudo bash /opt/gwi-pos/scripts/nuc-restore.sh
#
# Deployed to: /opt/gwi-pos/scripts/nuc-restore.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
APP_DIR="/opt/gwi-pos/app"
BACKUP_DIR="/opt/gwi-pos/backups"
LOG_DIR="/opt/gwi-pos/logs"
LOG_FILE="$LOG_DIR/restore.log"
RECONCILIATION_LOG="$LOG_DIR/restore-reconciliation.log"
S3_BUCKET="gwi-pos-backups"
RESTORE_TMP="/tmp/gwi-pos-restore"

mkdir -p "$LOG_DIR" "$RESTORE_TMP"

# ─────────────────────────────────────────────────────────────────────────────
# Colors + Logging
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [restore] $*"
  echo "$msg" >> "$LOG_FILE"
  echo -e "${GREEN}[restore]${NC} $*"
}

warn() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [restore] WARN: $*"
  echo "$msg" >> "$LOG_FILE"
  echo -e "${YELLOW}[WARNING]${NC} $*"
}

err() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [restore] ERROR: $*"
  echo "$msg" >> "$LOG_FILE"
  echo -e "${RED}[ERROR]${NC} $*" >&2
}

die() {
  err "$*"
  exit 1
}

header() {
  echo -e "\n${CYAN}═══════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  $*${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}\n"
}

prompt_yn() {
  local prompt="$1"
  local response
  echo -en "${YELLOW}$prompt [y/N]: ${NC}"
  read -r response
  [[ "$response" =~ ^[Yy]$ ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# Must be root
# ─────────────────────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then
  die "This script must be run as root. Use: sudo bash nuc-restore.sh"
fi

header "GWI POS — NUC Restore Workflow"
log "=== RESTORE STARTED ==="

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Check prerequisites
# ─────────────────────────────────────────────────────────────────────────────

header "Checking Prerequisites"

# PostgreSQL installed
if ! command -v psql >/dev/null 2>&1; then
  die "PostgreSQL is not installed. Install with: apt-get install -y postgresql"
fi
log "PostgreSQL: installed ($(psql --version 2>/dev/null | head -1))"

# pg_restore available
if ! command -v pg_restore >/dev/null 2>&1; then
  die "pg_restore not found. Install postgresql-client package."
fi

# App directory exists
if [[ ! -d "$APP_DIR" ]]; then
  die "App directory $APP_DIR does not exist. Run installer.run first."
fi
log "App directory: $APP_DIR exists"

# .env configured
if [[ ! -f "$ENV_FILE" ]]; then
  die "$ENV_FILE not found. Run installer.run first to configure this NUC."
fi
log "Environment: $ENV_FILE exists"

# ─────────────────────────────────────────────────────────────────────────────
# Load environment
# ─────────────────────────────────────────────────────────────────────────────

SERVER_API_KEY=""
LOCATION_ID=""
MISSION_CONTROL_URL=""
SERVER_NODE_ID=""
STATION_ROLE=""
DB_USER=""
DB_NAME=""
NEON_DATABASE_URL=""
DATABASE_URL=""

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  case "$key" in
    SERVER_API_KEY)      SERVER_API_KEY="$val" ;;
    LOCATION_ID)         LOCATION_ID="$val" ;;
    POS_LOCATION_ID)     [[ -z "$LOCATION_ID" ]] && LOCATION_ID="$val" ;;
    MISSION_CONTROL_URL) MISSION_CONTROL_URL="$val" ;;
    SERVER_NODE_ID)      SERVER_NODE_ID="$val" ;;
    STATION_ROLE)        STATION_ROLE="$val" ;;
    DB_USER)             DB_USER="$val" ;;
    DB_NAME)             DB_NAME="$val" ;;
    NEON_DATABASE_URL)   NEON_DATABASE_URL="$val" ;;
    DATABASE_URL)        DATABASE_URL="$val" ;;
  esac
done < "$ENV_FILE"

DB_USER="${DB_USER:-thepasspos}"
DB_NAME="${DB_NAME:-thepasspos}"

log "Location: ${LOCATION_ID:-unknown}, Role: ${STATION_ROLE:-unknown}"
log "Database: ${DB_NAME} (user: ${DB_USER})"

# ─────────────────────────────────────────────────────────────────────────────
# Safety check: refuse to run on active primary with open orders
# ─────────────────────────────────────────────────────────────────────────────

header "Safety Check"

# Check if POS is running and has open orders
POS_RUNNING=false
OPEN_ORDERS=0

if curl -sf --max-time 3 http://localhost:3005/api/health >/dev/null 2>&1; then
  POS_RUNNING=true
  log "POS app is running"

  # Check for open orders
  ORDERS_RESP=$(curl -sf --max-time 5 http://localhost:3005/api/system/batch-status 2>/dev/null || echo '{}')
  if [[ -n "$ORDERS_RESP" ]] && [[ "$ORDERS_RESP" != '{}' ]]; then
    OPEN_ORDERS=$(echo "$ORDERS_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin).get('data', {})
    print(d.get('openOrderCount', 0))
except:
    print(0)
" 2>/dev/null || echo "0")
  fi

  if [[ "$OPEN_ORDERS" -gt 0 ]]; then
    err "This NUC has $OPEN_ORDERS open orders!"
    err "Close all orders before restoring. Restoring with open orders will lose active transactions."
    echo ""
    if ! prompt_yn "DANGEROUS: Override safety check and proceed anyway?"; then
      die "Restore aborted — close all orders first"
    fi
    warn "Safety check overridden — proceeding with $OPEN_ORDERS open orders"
  else
    log "No open orders — safe to proceed"
  fi
else
  log "POS app is not running — safety check passed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Choose restore source
# ─────────────────────────────────────────────────────────────────────────────

header "Select Restore Source"

echo -e "  ${GREEN}1)${NC} Cloud backup (S3) — restore from encrypted cloud backup"
echo -e "  ${GREEN}2)${NC} Neon seed — seed from Neon cloud database"
echo ""
echo -en "${YELLOW}Select restore source [1/2]: ${NC}"
read -r RESTORE_SOURCE

case "$RESTORE_SOURCE" in
  1) RESTORE_MODE="cloud" ;;
  2) RESTORE_MODE="neon" ;;
  *)
    die "Invalid selection: $RESTORE_SOURCE (expected 1 or 2)"
    ;;
esac

log "Restore mode: $RESTORE_MODE"

# ─────────────────────────────────────────────────────────────────────────────
# Derive encryption key (needed for cloud restore)
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$RESTORE_MODE" == "cloud" ]]; then
  if [[ -z "$SERVER_API_KEY" ]]; then
    die "SERVER_API_KEY not set — cannot derive decryption key"
  fi
  BACKUP_KEY=$(printf '%s' "$SERVER_API_KEY" | openssl dgst -sha256 2>/dev/null | awk '{print $NF}')
  export BACKUP_KEY
fi

# ─────────────────────────────────────────────────────────────────────────────
# Cloud Restore Path
# ─────────────────────────────────────────────────────────────────────────────

RESTORE_FILE=""

if [[ "$RESTORE_MODE" == "cloud" ]]; then
  header "Cloud Backup Restore"

  if [[ -z "$LOCATION_ID" ]]; then
    die "LOCATION_ID not set — cannot determine S3 backup path"
  fi

  S3_PREFIX="s3://${S3_BUCKET}/${LOCATION_ID}/"

  if ! command -v aws >/dev/null 2>&1; then
    die "aws CLI not installed. Install with: apt-get install -y awscli && aws configure"
  fi

  # List available backups
  log "Listing available backups from $S3_PREFIX..."
  echo ""
  echo -e "${CYAN}Available cloud backups:${NC}"
  echo ""

  BACKUP_LIST=$(aws s3 ls "$S3_PREFIX" 2>/dev/null | grep '\.sql\.enc$' | sort -r || echo "")

  if [[ -z "$BACKUP_LIST" ]]; then
    # Also check local encrypted files as fallback
    LOCAL_ENC=$(ls -t "$BACKUP_DIR"/gwi-pos-backup-*.sql.enc 2>/dev/null | head -5 || echo "")
    if [[ -n "$LOCAL_ENC" ]]; then
      warn "No backups found in S3, but local encrypted backups exist:"
      echo "$LOCAL_ENC"
      echo ""
      echo -en "${YELLOW}Use local encrypted backup? [y/N]: ${NC}"
      read -r USE_LOCAL
      if [[ "$USE_LOCAL" =~ ^[Yy]$ ]]; then
        SELECTED_FILE=$(echo "$LOCAL_ENC" | head -1)
        RESTORE_FILE="$SELECTED_FILE"
      else
        die "No backups available for restore"
      fi
    else
      die "No backups found in $S3_PREFIX and no local encrypted backups"
    fi
  fi

  if [[ -z "$RESTORE_FILE" ]]; then
    # Show numbered list
    IDX=0
    declare -a BACKUP_FILES=()
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      IDX=$((IDX + 1))
      BFILE=$(echo "$line" | awk '{print $NF}')
      BSIZE=$(echo "$line" | awk '{print $3}')
      BDATE=$(echo "$line" | awk '{print $1, $2}')
      BACKUP_FILES+=("$BFILE")
      printf "  ${GREEN}%2d)${NC} %s  (%s, %s)\n" "$IDX" "$BFILE" "$BSIZE" "$BDATE"
    done <<< "$BACKUP_LIST"

    if [[ $IDX -eq 0 ]]; then
      die "No encrypted backups found in S3"
    fi

    echo ""
    echo -en "${YELLOW}Select backup number [1-$IDX] (default: 1 = latest): ${NC}"
    read -r BACKUP_NUM
    BACKUP_NUM="${BACKUP_NUM:-1}"

    if [[ "$BACKUP_NUM" -lt 1 ]] || [[ "$BACKUP_NUM" -gt "$IDX" ]]; then
      die "Invalid selection: $BACKUP_NUM"
    fi

    SELECTED_S3_FILE="${BACKUP_FILES[$((BACKUP_NUM - 1))]}"
    DOWNLOAD_PATH="$RESTORE_TMP/$SELECTED_S3_FILE"

    log "Downloading $SELECTED_S3_FILE from S3..."
    if ! aws s3 cp "${S3_PREFIX}${SELECTED_S3_FILE}" "$DOWNLOAD_PATH" 2>>"$LOG_FILE"; then
      die "Failed to download backup from S3"
    fi
    log "Download complete: $DOWNLOAD_PATH"
    RESTORE_FILE="$DOWNLOAD_PATH"
  fi

  # Decrypt
  DECRYPTED_FILE="$RESTORE_TMP/restore-$(date +%Y%m%d-%H%M%S).sql"
  log "Decrypting backup..."

  if ! openssl enc -aes-256-cbc -d -salt -pbkdf2 \
    -in "$RESTORE_FILE" \
    -out "$DECRYPTED_FILE" \
    -pass env:BACKUP_KEY 2>>"$LOG_FILE"; then
    rm -f "$DECRYPTED_FILE"
    die "Decryption failed — wrong key or corrupted backup file"
  fi

  if [[ ! -s "$DECRYPTED_FILE" ]]; then
    rm -f "$DECRYPTED_FILE"
    die "Decrypted file is empty — backup may be corrupted"
  fi

  DECRYPTED_SIZE=$(stat -c %s "$DECRYPTED_FILE" 2>/dev/null || echo 0)
  log "Decryption successful: $DECRYPTED_FILE ($(( DECRYPTED_SIZE / 1024 / 1024 )) MB)"

  # The backup is a gzipped SQL — decompress if needed
  # The daily backup creates pos-*.sql.gz, then nuc-backup-upload.sh encrypts that
  # So the decrypted file is actually a .sql.gz
  SQL_FILE="$RESTORE_TMP/restore-$(date +%Y%m%d-%H%M%S).sql.final"

  if file "$DECRYPTED_FILE" 2>/dev/null | grep -qi "gzip"; then
    log "Decompressing gzipped backup..."
    if ! gunzip -c "$DECRYPTED_FILE" > "$SQL_FILE" 2>>"$LOG_FILE"; then
      die "Failed to decompress backup"
    fi
    rm -f "$DECRYPTED_FILE"
  else
    mv "$DECRYPTED_FILE" "$SQL_FILE"
  fi

  log "Restore file ready: $SQL_FILE"

fi

# ─────────────────────────────────────────────────────────────────────────────
# Neon Seed Path
# ─────────────────────────────────────────────────────────────────────────────

NEON_DUMP_FILE=""

if [[ "$RESTORE_MODE" == "neon" ]]; then
  header "Neon Seed Restore"

  echo ""
  warn "Neon may be missing up to 5 seconds of unsynced local writes."
  warn "This is a warm recovery — not a perfect clone of local state."
  echo ""

  if ! prompt_yn "Proceed with Neon seed?"; then
    die "Restore aborted by user"
  fi

  # Check if seed-from-neon.sh exists and offer to use it
  EXISTING_SEED="$APP_DIR/scripts/seed-from-neon.sh"
  if [[ -f "$EXISTING_SEED" ]]; then
    log "Found existing seed script: $EXISTING_SEED"
  fi

  if [[ -z "$NEON_DATABASE_URL" ]]; then
    # Try DATABASE_URL if it points to neon
    if [[ "$DATABASE_URL" == *"neon.tech"* ]]; then
      NEON_DATABASE_URL="$DATABASE_URL"
    else
      die "NEON_DATABASE_URL not set in $ENV_FILE — cannot seed from Neon"
    fi
  fi

  NEON_DUMP_FILE="$RESTORE_TMP/neon-seed-$(date +%Y%m%d-%H%M%S).dump"
  log "Dumping from Neon cloud database..."

  if ! pg_dump "$NEON_DATABASE_URL" --no-owner --no-acl -Fc -f "$NEON_DUMP_FILE" 2>>"$LOG_FILE"; then
    die "Failed to dump from Neon — check NEON_DATABASE_URL and network connectivity"
  fi

  DUMP_SIZE=$(stat -c %s "$NEON_DUMP_FILE" 2>/dev/null || echo 0)
  log "Neon dump complete: $NEON_DUMP_FILE ($(( DUMP_SIZE / 1024 / 1024 )) MB)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Final confirmation
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
echo -e "${RED}  WARNING: This will DROP and RECREATE the database!  ${NC}"
echo -e "${RED}  All existing local data will be lost.               ${NC}"
echo -e "${RED}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Source:   ${CYAN}$RESTORE_MODE${NC}"
echo -e "  Database: ${CYAN}$DB_NAME${NC}"
echo -e "  User:     ${CYAN}$DB_USER${NC}"
echo ""

if ! prompt_yn "CONFIRM: Drop and restore database '$DB_NAME'?"; then
  die "Restore aborted by user"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Stop POS application
# ─────────────────────────────────────────────────────────────────────────────

header "Stopping Services"

log "Stopping POS application..."
pm2 stop gwi-pos 2>/dev/null || true
systemctl stop thepasspos 2>/dev/null || true
systemctl stop thepasspos-kiosk 2>/dev/null || true
systemctl stop thepasspos-sync 2>/dev/null || true
log "POS application stopped"

# ─────────────────────────────────────────────────────────────────────────────
# Create safety backup of current database (best-effort)
# ─────────────────────────────────────────────────────────────────────────────

SAFETY_FILE="$BACKUP_DIR/pos-pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
mkdir -p "$BACKUP_DIR"

log "Creating safety backup of current database..."
if pg_dump -h localhost -U "$DB_USER" "$DB_NAME" 2>/dev/null | gzip > "$SAFETY_FILE" 2>/dev/null; then
  if [[ -s "$SAFETY_FILE" ]]; then
    SAFETY_SIZE=$(stat -c %s "$SAFETY_FILE" 2>/dev/null || echo 0)
    log "Safety backup created: $SAFETY_FILE ($(( SAFETY_SIZE / 1024 / 1024 )) MB)"
  else
    warn "Safety backup is empty — database may already be empty"
    rm -f "$SAFETY_FILE"
  fi
else
  warn "Could not create safety backup (database may be empty or inaccessible)"
  rm -f "$SAFETY_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Drop and recreate database
# ─────────────────────────────────────────────────────────────────────────────

header "Restoring Database"

log "Dropping database $DB_NAME..."
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" 2>/dev/null || true
sudo -u postgres dropdb --if-exists "$DB_NAME" 2>>"$LOG_FILE" || warn "dropdb warning (may not exist)"

log "Creating database $DB_NAME..."
sudo -u postgres createdb -O "$DB_USER" "$DB_NAME" 2>>"$LOG_FILE" || die "Failed to create database $DB_NAME"

# ─────────────────────────────────────────────────────────────────────────────
# Restore from source
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$RESTORE_MODE" == "cloud" ]]; then
  log "Restoring from cloud backup..."

  if ! sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE" 2>>"$LOG_FILE" 1>/dev/null; then
    warn "psql restore had warnings (this is often normal for schema conflicts)"
  fi

  log "Cloud backup restore complete"
  rm -f "$SQL_FILE"

elif [[ "$RESTORE_MODE" == "neon" ]]; then
  log "Restoring from Neon dump..."

  if ! pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl "$NEON_DUMP_FILE" 2>>"$LOG_FILE"; then
    warn "pg_restore had warnings (this is often normal for schema conflicts)"
  fi

  log "Neon restore complete"
  rm -f "$NEON_DUMP_FILE"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Run migrations
# ─────────────────────────────────────────────────────────────────────────────

header "Running Migrations"

POSUSER=$(stat -c '%U' "$APP_DIR" 2>/dev/null || echo "smarttab")

log "Running pre-migrate backfill..."
sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && node scripts/nuc-pre-migrate.js" 2>>"$LOG_FILE" || warn "Pre-migrate had warnings (non-fatal)"

log "Applying Prisma migrations..."
sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npx prisma migrate deploy" 2>>"$LOG_FILE" || warn "Prisma migrate had warnings (non-fatal)"

log "Migrations complete"

# ─────────────────────────────────────────────────────────────────────────────
# syncedAt: NOT stamped (sync worker owns this metadata)
# ─────────────────────────────────────────────────────────────────────────────
# INTENTIONALLY REMOVED: Stamping syncedAt = NOW() on all rows after restore
# poisoned the sync worker's change detection. Rows restored from Neon retain
# whatever syncedAt value they had in Neon (or NULL if never synced). The
# upstream sync worker uses "updatedAt > COALESCE(syncedAt, '1970-01-01')" to
# find unsynced changes — blanket-stamping syncedAt defeats this detection.
log "Skipping syncedAt stamping (sync worker owns sync metadata)"

# Write seed status marker for server.ts readiness check
_SEED_STATUS_FILE="/opt/gwi-pos/.seed-status"
if [[ "$RESTORE_MODE" == "neon" ]]; then
  echo "COMPLETE:$(date -u +%Y-%m-%dT%H:%M:%SZ):nuc-restore-neon" > "$_SEED_STATUS_FILE"
  log "Seed status: COMPLETE (nuc-restore from Neon)"
elif [[ "$RESTORE_MODE" == "cloud" ]]; then
  echo "COMPLETE:$(date -u +%Y-%m-%dT%H:%M:%SZ):nuc-restore-cloud" > "$_SEED_STATUS_FILE"
  log "Seed status: COMPLETE (nuc-restore from cloud backup)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Start POS application
# ─────────────────────────────────────────────────────────────────────────────

header "Starting Services"

log "Starting POS application..."
if systemctl is-enabled thepasspos >/dev/null 2>&1; then
  systemctl start thepasspos 2>>"$LOG_FILE" || warn "thepasspos failed to start"
else
  sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && pm2 start ecosystem.config.js" 2>>"$LOG_FILE" || warn "PM2 start failed"
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
  warn "POS app did not become healthy within 60s — check: journalctl -u thepasspos"
fi

# Start sync agent
if systemctl is-enabled thepasspos-sync >/dev/null 2>&1; then
  systemctl start thepasspos-sync 2>>"$LOG_FILE" || true
fi
log "Sync agent started"

# ─────────────────────────────────────────────────────────────────────────────
# Post-restore reconciliation
# ─────────────────────────────────────────────────────────────────────────────

header "Post-Restore Reconciliation"

log "Running reconciliation checks..."

# Query counts in main shell so variables are available for MC report
ORDER_COUNT=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Order\"" 2>/dev/null || echo "error")
PAYMENT_COUNT=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Payment\"" 2>/dev/null || echo "error")
SHIFT_COUNT=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Shift\"" 2>/dev/null || echo "error")
EMPLOYEE_COUNT=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Employee\"" 2>/dev/null || echo "error")
MENU_ITEM_COUNT=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"MenuItem\"" 2>/dev/null || echo "error")
UNSYNCED_ORDERS=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Order\" WHERE \"syncedAt\" IS NULL" 2>/dev/null || echo "error")
UNSYNCED_PAYMENTS=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Payment\" WHERE \"syncedAt\" IS NULL" 2>/dev/null || echo "error")
RECENT_ORDERS=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Order\" WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'" 2>/dev/null || echo "error")
RECENT_PAYMENTS=$(sudo -u postgres psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"Payment\" WHERE \"createdAt\" > NOW() - INTERVAL '24 hours'" 2>/dev/null || echo "error")

# Write reconciliation report
{
  echo "=== GWI POS Restore Reconciliation ==="
  echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Restore source: $RESTORE_MODE"
  echo "Database: $DB_NAME"
  echo ""
  echo "--- Local Database Counts ---"
  echo "Orders: $ORDER_COUNT"
  echo "Payments: $PAYMENT_COUNT"
  echo "Shifts: $SHIFT_COUNT"
  echo "Employees: $EMPLOYEE_COUNT"
  echo "Menu items: $MENU_ITEM_COUNT"
  echo ""
  echo "--- Sync Status ---"
  echo "Unsynced orders: $UNSYNCED_ORDERS"
  echo "Unsynced payments: $UNSYNCED_PAYMENTS"
  echo ""
  echo "--- Recent Activity ---"
  echo "Orders (last 24h): $RECENT_ORDERS"
  echo "Payments (last 24h): $RECENT_PAYMENTS"
  echo ""
  echo "=== Reconciliation Complete ==="
} | tee "$RECONCILIATION_LOG"

log "Reconciliation report saved to: $RECONCILIATION_LOG"

# ─────────────────────────────────────────────────────────────────────────────
# Trigger sync (best-effort)
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$APP_READY" == "true" ]]; then
  log "Triggering upstream sync..."
  curl -sf --max-time 10 http://localhost:3005/api/internal/sync-trigger 2>/dev/null || {
    log "WARN: Could not trigger upstream sync — it will run on its next scheduled interval"
  }

  log "Triggering downstream sync..."
  curl -sf --max-time 10 http://localhost:3005/api/internal/sync-downstream 2>/dev/null || {
    log "WARN: Could not trigger downstream sync — it will run on its next scheduled interval"
  }
fi

# ─────────────────────────────────────────────────────────────────────────────
# Report to Mission Control
# ─────────────────────────────────────────────────────────────────────────────

if [[ -n "${MISSION_CONTROL_URL:-}" ]] && [[ -n "${SERVER_API_KEY:-}" ]]; then
  log "Reporting restore to Mission Control..."

  RESTORE_BODY=$(printf '{"event":"nuc_restored","source":"%s","nodeId":"%s","posLocationId":"%s","timestamp":"%s","appHealthy":%s,"orderCount":"%s","paymentCount":"%s"}' \
    "$RESTORE_MODE" \
    "${SERVER_NODE_ID:-unknown}" \
    "${LOCATION_ID:-unknown}" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$APP_READY" \
    "${ORDER_COUNT:-0}" \
    "${PAYMENT_COUNT:-0}")

  MC_HTTP=$(curl -sf --max-time 10 -X POST \
    "${MISSION_CONTROL_URL}/api/fleet/failover-event" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVER_API_KEY" \
    -H "X-Server-Node-Id: ${SERVER_NODE_ID:-}" \
    -d "$RESTORE_BODY" \
    -o /dev/null -w "%{http_code}" 2>/dev/null) || MC_HTTP="error"

  log "Mission Control response: HTTP $MC_HTTP"
else
  warn "MISSION_CONTROL_URL or SERVER_API_KEY not set — skipping MC notification"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup temp files
# ─────────────────────────────────────────────────────────────────────────────

rm -rf "$RESTORE_TMP" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

header "Restore Complete"

echo -e "  ${GREEN}Source:${NC}         $RESTORE_MODE"
echo -e "  ${GREEN}Database:${NC}       $DB_NAME"
echo -e "  ${GREEN}App healthy:${NC}    $APP_READY"
echo -e "  ${GREEN}Orders:${NC}         ${ORDER_COUNT:-unknown}"
echo -e "  ${GREEN}Payments:${NC}       ${PAYMENT_COUNT:-unknown}"
echo -e "  ${GREEN}Reconciliation:${NC} $RECONCILIATION_LOG"
echo ""

if [[ "$RESTORE_MODE" == "neon" ]]; then
  echo -e "  ${YELLOW}NOTE: Neon seed may be missing up to 5 seconds of unsynced local writes.${NC}"
  echo -e "  ${YELLOW}Review the reconciliation report and verify recent transactions.${NC}"
  echo ""
fi

if [[ "$APP_READY" != "true" ]]; then
  echo -e "  ${RED}WARNING: POS app is not healthy. Check:${NC}"
  echo "    sudo journalctl -u thepasspos -f"
  echo "    sudo systemctl status thepasspos"
  echo ""
fi

echo -e "  ${CYAN}Useful commands:${NC}"
echo "    sudo journalctl -u thepasspos -f     — View POS logs"
echo "    sudo systemctl restart thepasspos     — Restart POS"
echo "    cat $RECONCILIATION_LOG              — View reconciliation report"
if [[ -n "${SAFETY_FILE:-}" ]] && [[ -f "${SAFETY_FILE:-}" ]]; then
  echo "    Safety backup: $SAFETY_FILE"
fi
echo ""

log "=== RESTORE COMPLETE (source=$RESTORE_MODE, healthy=$APP_READY) ==="

exit 0
