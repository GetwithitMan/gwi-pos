#!/usr/bin/env bash
# =============================================================================
# GWI POS — Encrypted Cloud Backup Upload
# =============================================================================
#
# Runs AFTER the daily 4 AM pg_dump (cron: 4:15 AM). Encrypts the latest
# local backup with AES-256-CBC and uploads to S3. Reports status to
# Mission Control via heartbeat endpoint.
#
# Prerequisites:
#   - Daily pg_dump already runs at 4 AM (installed by installer.run)
#   - aws CLI installed (fail gracefully if not)
#   - SERVER_API_KEY and LOCATION_ID set in /opt/gwi-pos/.env
#
# Idempotent: safe to re-run. Skips if today's encrypted backup already
# uploaded. Retries failed uploads on next run.
#
# Deployed to: /opt/gwi-pos/scripts/nuc-backup-upload.sh
# =============================================================================

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

ENV_FILE="/opt/gwi-pos/.env"
BACKUP_DIR="/opt/gwi-pos/backups"
LOG_DIR="/opt/gwi-pos/logs"
LOG_FILE="$LOG_DIR/backup-upload.log"
S3_BUCKET="gwi-pos-backups"
RETENTION_DAYS=7

mkdir -p "$LOG_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

log() {
  local msg="$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-upload] $*"
  echo "$msg" >> "$LOG_FILE"
  echo "$msg"
}

die() {
  log "FATAL: $*"
  # report_status may not be defined yet if die is called early
  if declare -f report_status >/dev/null 2>&1; then
    report_status "failed" "0" "$*"
  fi
  exit 1
}

# Keep log from growing unbounded
trim_log() {
  if [[ -f "$LOG_FILE" ]] && [[ $(wc -l < "$LOG_FILE" 2>/dev/null || echo 0) -gt 2000 ]]; then
    tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Load environment
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [backup-upload] FATAL: $ENV_FILE not found" >> "$LOG_FILE"
  exit 1
fi

SERVER_API_KEY=""
LOCATION_ID=""
MISSION_CONTROL_URL=""
SERVER_NODE_ID=""
STATION_ROLE=""

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
  esac
done < "$ENV_FILE"

if [[ -z "$SERVER_API_KEY" ]]; then
  die "SERVER_API_KEY not set in $ENV_FILE"
fi

if [[ -z "$LOCATION_ID" ]]; then
  die "LOCATION_ID (or POS_LOCATION_ID) not set in $ENV_FILE"
fi

# Only run on server or backup roles
if [[ -n "$STATION_ROLE" ]] && [[ "$STATION_ROLE" != "server" ]] && [[ "$STATION_ROLE" != "backup" ]]; then
  log "Skipping — STATION_ROLE=$STATION_ROLE (only server/backup upload backups)"
  exit 0
fi

log "=== CLOUD BACKUP UPLOAD STARTED ==="
log "Location: $LOCATION_ID, Role: ${STATION_ROLE:-unknown}"

# ─────────────────────────────────────────────────────────────────────────────
# Derive encryption key from SERVER_API_KEY
# ─────────────────────────────────────────────────────────────────────────────

BACKUP_KEY=$(printf '%s' "$SERVER_API_KEY" | openssl dgst -sha256 2>/dev/null | awk '{print $NF}')
if [[ -z "$BACKUP_KEY" ]]; then
  die "Failed to derive encryption key from SERVER_API_KEY"
fi
export BACKUP_KEY

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Find the latest pg_dump file
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -d "$BACKUP_DIR" ]]; then
  die "Backup directory $BACKUP_DIR does not exist — is the daily backup cron configured?"
fi

# The installer creates backups as pos-YYYYMMDD-HHMMSS.sql.gz
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/pos-*.sql.gz 2>/dev/null | head -1 || echo "")

if [[ -z "$LATEST_BACKUP" ]]; then
  die "No backup files found in $BACKUP_DIR (expected pos-*.sql.gz from daily dump)"
fi

# Check if the backup is from today (within last 2 hours — the dump runs at 4 AM)
BACKUP_AGE_SECONDS=$(( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP" 2>/dev/null || echo 0) ))
if [[ "$BACKUP_AGE_SECONDS" -gt 7200 ]]; then
  log "WARN: Latest backup is ${BACKUP_AGE_SECONDS}s old (>2 hours) — may be stale"
fi

BACKUP_SIZE_BYTES=$(stat -c %s "$LATEST_BACKUP" 2>/dev/null || echo 0)
log "Found backup: $LATEST_BACKUP ($(( BACKUP_SIZE_BYTES / 1024 / 1024 )) MB, age=${BACKUP_AGE_SECONDS}s)"

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Encrypt the backup
# ─────────────────────────────────────────────────────────────────────────────

TODAY=$(date +%Y-%m-%d)
ENC_FILENAME="gwi-pos-backup-${LOCATION_ID}-${TODAY}.sql.enc"
ENC_FILEPATH="$BACKUP_DIR/$ENC_FILENAME"

# Skip encryption if today's encrypted file already exists and is non-empty
if [[ -f "$ENC_FILEPATH" ]] && [[ -s "$ENC_FILEPATH" ]]; then
  log "Encrypted backup already exists: $ENC_FILEPATH — skipping encryption"
else
  log "Encrypting backup with AES-256-CBC..."

  if ! openssl enc -aes-256-cbc -salt -pbkdf2 \
    -in "$LATEST_BACKUP" \
    -out "$ENC_FILEPATH" \
    -pass env:BACKUP_KEY 2>>"$LOG_FILE"; then
    rm -f "$ENC_FILEPATH"
    die "Encryption failed — will not upload unencrypted backup"
  fi

  if [[ ! -s "$ENC_FILEPATH" ]]; then
    rm -f "$ENC_FILEPATH"
    die "Encrypted file is empty — encryption may have failed silently"
  fi

  ENC_SIZE=$(stat -c %s "$ENC_FILEPATH" 2>/dev/null || echo 0)
  log "Encryption successful: $ENC_FILEPATH ($(( ENC_SIZE / 1024 / 1024 )) MB)"
fi

ENC_SIZE_BYTES=$(stat -c %s "$ENC_FILEPATH" 2>/dev/null || echo 0)

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Upload to S3
# ─────────────────────────────────────────────────────────────────────────────

UPLOAD_STATUS="skipped"

if ! command -v aws >/dev/null 2>&1; then
  log "WARN: aws CLI not installed — skipping S3 upload"
  log "Install with: apt-get install -y awscli && aws configure"
  UPLOAD_STATUS="aws_cli_missing"
else
  S3_PATH="s3://${S3_BUCKET}/${LOCATION_ID}/${ENC_FILENAME}"
  log "Uploading to $S3_PATH..."

  if aws s3 cp "$ENC_FILEPATH" "$S3_PATH" \
    --storage-class STANDARD_IA \
    --no-progress 2>>"$LOG_FILE"; then
    log "Upload successful: $S3_PATH"
    UPLOAD_STATUS="success"
  else
    log "ERROR: S3 upload failed — keeping encrypted file for retry on next run"
    UPLOAD_STATUS="upload_failed"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Report to Mission Control
# ─────────────────────────────────────────────────────────────────────────────

report_status() {
  local status="${1:-unknown}"
  local size="${2:-0}"
  local error_msg="${3:-}"

  if [[ -z "${MISSION_CONTROL_URL:-}" ]] || [[ -z "${SERVER_API_KEY:-}" ]]; then
    log "WARN: MISSION_CONTROL_URL or SERVER_API_KEY not set — skipping MC report"
    return
  fi

  local TIMESTAMP
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  local BODY
  if [[ -n "$error_msg" ]]; then
    BODY=$(printf '{"lastBackupAt":"%s","backupSizeBytes":%s,"backupStatus":"%s","backupError":"%s","backupUploadStatus":"%s","posLocationId":"%s"}' \
      "$TIMESTAMP" "$size" "$status" "$error_msg" "$UPLOAD_STATUS" "$LOCATION_ID")
  else
    BODY=$(printf '{"lastBackupAt":"%s","backupSizeBytes":%s,"backupStatus":"%s","backupUploadStatus":"%s","posLocationId":"%s"}' \
      "$TIMESTAMP" "$size" "$status" "$UPLOAD_STATUS" "$LOCATION_ID")
  fi

  local MC_HTTP
  MC_HTTP=$(curl -sf --max-time 15 -X POST \
    "${MISSION_CONTROL_URL}/api/fleet/heartbeat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVER_API_KEY" \
    -H "X-Server-Node-Id: ${SERVER_NODE_ID:-}" \
    -d "$BODY" \
    -o /dev/null -w "%{http_code}" 2>/dev/null) || MC_HTTP="error"

  log "Mission Control backup report: HTTP $MC_HTTP (status=$status, size=$size, upload=$UPLOAD_STATUS)"
}

report_status "success" "$ENC_SIZE_BYTES"

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Retention — delete local backups older than 7 days
# ─────────────────────────────────────────────────────────────────────────────

log "Cleaning up local backups older than ${RETENTION_DAYS} days..."

# Clean up old encrypted files
OLD_ENC_COUNT=$(find "$BACKUP_DIR" -type f -name 'gwi-pos-backup-*.sql.enc' -mtime +"$RETENTION_DAYS" 2>/dev/null | wc -l || echo 0)
find "$BACKUP_DIR" -type f -name 'gwi-pos-backup-*.sql.enc' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true

if [[ "$OLD_ENC_COUNT" -gt 0 ]]; then
  log "Deleted $OLD_ENC_COUNT old encrypted backup(s)"
fi

# Also clean up successfully-uploaded encrypted files from previous days
# (keep today's in case we need to re-upload)
if [[ "$UPLOAD_STATUS" == "success" ]]; then
  find "$BACKUP_DIR" -type f -name 'gwi-pos-backup-*.sql.enc' ! -name "$ENC_FILENAME" -mtime +1 -delete 2>/dev/null || true
fi

log "=== CLOUD BACKUP UPLOAD COMPLETE (upload=$UPLOAD_STATUS) ==="

trim_log
exit 0
