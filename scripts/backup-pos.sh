#!/usr/bin/env bash
# GWI POS - Daily PostgreSQL Backup Script
# Installed by installer.run to /opt/gwi-pos/backup-pos.sh
# Runs daily via cron at 4 AM and before any installer re-run.
#
# Usage:
#   /opt/gwi-pos/backup-pos.sh
#
# Backups stored in /opt/gwi-pos/backups/ with 7-day retention.

set -euo pipefail

BACKUP_DIR=/opt/gwi-pos/backups
RETENTION_DAYS=7

# Read DB credentials from env file if available
if [ -f /opt/gwi-pos/.env ]; then
  DB_NAME=$(grep -oP '^DB_NAME=\K.*' /opt/gwi-pos/.env 2>/dev/null || echo "pulse_pos")
  DB_USER=$(grep -oP '^DB_USER=\K.*' /opt/gwi-pos/.env 2>/dev/null || echo "pulse_pos")
else
  DB_NAME="${DB_NAME:-pulse_pos}"
  DB_USER="${DB_USER:-pulse_pos}"
fi

mkdir -p "$BACKUP_DIR"

timestamp=$(date +%Y%m%d-%H%M%S)
backup_file="$BACKUP_DIR/pos-$timestamp.sql.gz"

echo "[Backup] Starting PostgreSQL backup of '$DB_NAME'..."

if pg_dump -U "$DB_USER" "$DB_NAME" 2>/dev/null | gzip > "$backup_file"; then
  size=$(du -h "$backup_file" | cut -f1)
  echo "[Backup] Success: $backup_file ($size)"
else
  echo "[Backup] WARNING: pg_dump failed. Is PostgreSQL running?"
  rm -f "$backup_file"
  exit 1
fi

# Remove backups older than retention period
deleted=$(find "$BACKUP_DIR" -type f -name 'pos-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete -print | wc -l)
if [ "$deleted" -gt 0 ]; then
  echo "[Backup] Cleaned up $deleted old backup(s) (>${RETENTION_DAYS} days)."
fi

echo "[Backup] Done. Total backups: $(find "$BACKUP_DIR" -type f -name 'pos-*.sql.gz' | wc -l)"
