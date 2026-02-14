#!/bin/bash
# =============================================================================
# GWI POS - Database Backup Script (PostgreSQL)
# =============================================================================
# Creates timestamped backups of the PostgreSQL database using pg_dump.
# Designed to be run via cron or manually.
#
# Usage:
#   ./backup.sh              # Create backup
#   ./backup.sh --cleanup    # Create backup and clean old ones
#   ./backup.sh --list       # List existing backups
#
# Environment variables:
#   DATABASE_URL        - PostgreSQL connection string (REQUIRED)
#   BACKUP_DIR          - Backup directory (default: /opt/gwi-pos/docker/backups)
#   BACKUP_RETENTION    - Days to keep backups (default: 30)
# =============================================================================

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/gwi-pos/docker/backups}"
RETENTION_DAYS="${BACKUP_RETENTION:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/pos-$TIMESTAMP.dump"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}SUCCESS${NC} $1"; }
warn() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}WARN${NC} $1"; }
error() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}ERROR${NC} $1"; exit 1; }

# Check DATABASE_URL is set
check_database() {
    if [ -z "$DATABASE_URL" ]; then
        error "DATABASE_URL environment variable is not set"
    fi
}

# Create backup directory
ensure_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        log "Created backup directory: $BACKUP_DIR"
    fi
}

# Create backup using pg_dump
create_backup() {
    log "Starting PostgreSQL backup..."
    log "Destination: $BACKUP_FILE"

    pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl > "$BACKUP_FILE"

    # Verify backup
    if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        success "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        error "Backup failed - file not created or empty"
    fi
}

# Cleanup old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."

    BEFORE_COUNT=$(find "$BACKUP_DIR" -name "pos-*.dump" -type f | wc -l)
    find "$BACKUP_DIR" -name "pos-*.dump" -type f -mtime +$RETENTION_DAYS -delete
    AFTER_COUNT=$(find "$BACKUP_DIR" -name "pos-*.dump" -type f | wc -l)
    DELETED=$((BEFORE_COUNT - AFTER_COUNT))

    if [ $DELETED -gt 0 ]; then
        log "Deleted $DELETED old backup(s)"
    else
        log "No old backups to delete"
    fi
}

# List existing backups
list_backups() {
    log "Existing backups:"
    echo ""
    ls -lah "$BACKUP_DIR"/pos-*.dump 2>/dev/null || echo "No backups found"
    echo ""
    TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
    log "Total backup size: $TOTAL_SIZE"
}

# Main execution
main() {
    log "=== GWI POS Backup (PostgreSQL) ==="

    check_database
    ensure_backup_dir
    create_backup

    if [ "$1" = "--cleanup" ] || [ "$1" = "-c" ]; then
        cleanup_old_backups
    fi

    list_backups
    log "=== Backup Complete ==="
}

case "$1" in
    --list|-l)
        list_backups
        ;;
    --cleanup|-c)
        main --cleanup
        ;;
    --help|-h)
        echo "GWI POS Backup Script (PostgreSQL)"
        echo ""
        echo "Usage:"
        echo "  $0              Create backup"
        echo "  $0 --cleanup    Create backup and remove old ones"
        echo "  $0 --list       List existing backups"
        echo "  $0 --help       Show this help"
        echo ""
        echo "Environment variables:"
        echo "  DATABASE_URL       PostgreSQL connection string (REQUIRED)"
        echo "  BACKUP_DIR         Backup directory"
        echo "  BACKUP_RETENTION   Days to keep backups (default: 30)"
        ;;
    *)
        main "$@"
        ;;
esac
