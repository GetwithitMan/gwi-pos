#!/bin/bash
# =============================================================================
# GWI POS - Database Backup Script
# =============================================================================
# Creates timestamped backups of the SQLite database.
# Designed to be run via cron or manually.
#
# Usage:
#   ./backup.sh              # Create backup
#   ./backup.sh --cleanup    # Create backup and clean old ones
#
# Environment variables (optional):
#   BACKUP_DIR          - Backup directory (default: /opt/gwi-pos/docker/backups)
#   DATA_DIR            - Data directory (default: /opt/gwi-pos/docker/data)
#   BACKUP_RETENTION    - Days to keep backups (default: 30)
# =============================================================================

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/gwi-pos/docker/backups}"
DATA_DIR="${DATA_DIR:-/opt/gwi-pos/docker/data}"
RETENTION_DAYS="${BACKUP_RETENTION:-30}"
DB_FILE="$DATA_DIR/pos.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/pos-$TIMESTAMP.db"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}SUCCESS${NC} $1"; }
warn() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}WARN${NC} $1"; }
error() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}ERROR${NC} $1"; exit 1; }

# Check if database exists
check_database() {
    if [ ! -f "$DB_FILE" ]; then
        error "Database not found at $DB_FILE"
    fi
}

# Create backup directory
ensure_backup_dir() {
    if [ ! -d "$BACKUP_DIR" ]; then
        mkdir -p "$BACKUP_DIR"
        log "Created backup directory: $BACKUP_DIR"
    fi
}

# Create backup using SQLite backup command (safe for running database)
create_backup() {
    log "Starting backup..."
    log "Source: $DB_FILE"
    log "Destination: $BACKUP_FILE"

    # Use SQLite's backup command for safe online backup
    if command -v sqlite3 &> /dev/null; then
        sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
    else
        # Fallback to copy if sqlite3 not available (less safe)
        warn "sqlite3 not found, using file copy (ensure no writes during backup)"
        cp "$DB_FILE" "$BACKUP_FILE"
    fi

    # Also backup journal if exists
    if [ -f "$DB_FILE-journal" ]; then
        cp "$DB_FILE-journal" "$BACKUP_FILE-journal"
    fi

    # Verify backup
    if [ -f "$BACKUP_FILE" ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        success "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        error "Backup failed - file not created"
    fi
}

# Create compressed backup
create_compressed_backup() {
    COMPRESSED_FILE="$BACKUP_FILE.gz"
    log "Compressing backup..."

    gzip -c "$BACKUP_FILE" > "$COMPRESSED_FILE"
    rm "$BACKUP_FILE"

    COMPRESSED_SIZE=$(du -h "$COMPRESSED_FILE" | cut -f1)
    success "Compressed backup: $COMPRESSED_FILE ($COMPRESSED_SIZE)"
}

# Cleanup old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."

    # Count before
    BEFORE_COUNT=$(find "$BACKUP_DIR" -name "pos-*.db*" -type f | wc -l)

    # Delete old backups
    find "$BACKUP_DIR" -name "pos-*.db*" -type f -mtime +$RETENTION_DAYS -delete

    # Count after
    AFTER_COUNT=$(find "$BACKUP_DIR" -name "pos-*.db*" -type f | wc -l)
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
    ls -lah "$BACKUP_DIR"/pos-*.db* 2>/dev/null || echo "No backups found"
    echo ""

    # Calculate total size
    TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1 || echo "0")
    log "Total backup size: $TOTAL_SIZE"
}

# Main execution
main() {
    log "=== GWI POS Backup ==="

    check_database
    ensure_backup_dir
    create_backup

    # Compress if gzip is available
    if command -v gzip &> /dev/null; then
        create_compressed_backup
    fi

    # Cleanup if requested
    if [ "$1" = "--cleanup" ] || [ "$1" = "-c" ]; then
        cleanup_old_backups
    fi

    list_backups

    log "=== Backup Complete ==="
}

# Handle arguments
case "$1" in
    --list|-l)
        list_backups
        ;;
    --cleanup|-c)
        main --cleanup
        ;;
    --help|-h)
        echo "GWI POS Backup Script"
        echo ""
        echo "Usage:"
        echo "  $0              Create backup"
        echo "  $0 --cleanup    Create backup and remove old ones"
        echo "  $0 --list       List existing backups"
        echo "  $0 --help       Show this help"
        echo ""
        echo "Environment variables:"
        echo "  BACKUP_DIR         Backup directory"
        echo "  DATA_DIR           Data directory"
        echo "  BACKUP_RETENTION   Days to keep backups (default: 30)"
        ;;
    *)
        main "$@"
        ;;
esac
