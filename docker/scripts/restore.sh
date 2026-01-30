#!/bin/bash
# =============================================================================
# GWI POS - Database Restore Script
# =============================================================================
# Restores the SQLite database from a backup.
#
# Usage:
#   ./restore.sh                    # Restore from latest backup
#   ./restore.sh <backup-file>      # Restore from specific file
#   ./restore.sh --list             # List available backups
#
# WARNING: This will stop the POS service during restore!
# =============================================================================

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/opt/gwi-pos/docker/backups}"
DATA_DIR="${DATA_DIR:-/opt/gwi-pos/docker/data}"
DB_FILE="$DATA_DIR/pos.db"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }
success() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${GREEN}SUCCESS${NC} $1"; }
warn() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${YELLOW}WARN${NC} $1"; }
error() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${RED}ERROR${NC} $1"; exit 1; }
info() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] ${BLUE}INFO${NC} $1"; }

# List available backups
list_backups() {
    echo ""
    echo "Available backups in $BACKUP_DIR:"
    echo ""

    # List backups sorted by date (newest first)
    ls -lt "$BACKUP_DIR"/pos-*.db* 2>/dev/null | head -20 || echo "No backups found"

    echo ""

    # Show latest
    LATEST=$(ls -t "$BACKUP_DIR"/pos-*.db* 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
        echo "Latest backup: $(basename $LATEST)"
    fi
}

# Find latest backup
get_latest_backup() {
    # Try compressed first
    LATEST=$(ls -t "$BACKUP_DIR"/pos-*.db.gz 2>/dev/null | head -1)

    # Fall back to uncompressed
    if [ -z "$LATEST" ]; then
        LATEST=$(ls -t "$BACKUP_DIR"/pos-*.db 2>/dev/null | head -1)
    fi

    echo "$LATEST"
}

# Stop the POS service
stop_service() {
    log "Stopping GWI POS service..."

    # Try systemd first
    if systemctl is-active --quiet gwi-pos 2>/dev/null; then
        systemctl stop gwi-pos
        success "Service stopped via systemd"
        return
    fi

    # Try docker compose
    if [ -f "/opt/gwi-pos/docker/docker-compose.yml" ]; then
        cd /opt/gwi-pos/docker
        docker compose down 2>/dev/null || true
        success "Service stopped via docker compose"
        return
    fi

    warn "Could not stop service automatically. Ensure POS is not running!"
}

# Start the POS service
start_service() {
    log "Starting GWI POS service..."

    # Try systemd first
    if systemctl list-unit-files | grep -q gwi-pos; then
        systemctl start gwi-pos
        success "Service started via systemd"
        return
    fi

    # Try docker compose
    if [ -f "/opt/gwi-pos/docker/docker-compose.yml" ]; then
        cd /opt/gwi-pos/docker
        docker compose up -d
        success "Service started via docker compose"
        return
    fi

    warn "Could not start service automatically. Start manually!"
}

# Restore from backup
restore_backup() {
    BACKUP_FILE="$1"

    # Validate backup file
    if [ ! -f "$BACKUP_FILE" ]; then
        error "Backup file not found: $BACKUP_FILE"
    fi

    log "=== GWI POS Restore ==="
    info "Restoring from: $BACKUP_FILE"

    # Confirm with user
    echo ""
    echo -e "${YELLOW}WARNING: This will replace the current database!${NC}"
    echo ""
    read -p "Are you sure you want to restore? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        log "Restore cancelled"
        exit 0
    fi

    # Stop service
    stop_service

    # Wait for service to fully stop
    sleep 3

    # Create safety backup of current database
    if [ -f "$DB_FILE" ]; then
        SAFETY_BACKUP="$BACKUP_DIR/pos-pre-restore-$(date +%Y%m%d-%H%M%S).db"
        log "Creating safety backup of current database..."
        cp "$DB_FILE" "$SAFETY_BACKUP"
        success "Safety backup created: $SAFETY_BACKUP"
    fi

    # Ensure data directory exists
    mkdir -p "$DATA_DIR"

    # Restore based on file type
    if [[ "$BACKUP_FILE" == *.gz ]]; then
        log "Decompressing and restoring backup..."
        gunzip -c "$BACKUP_FILE" > "$DB_FILE"
    else
        log "Restoring backup..."
        cp "$BACKUP_FILE" "$DB_FILE"
    fi

    # Restore journal if exists
    JOURNAL_BACKUP="${BACKUP_FILE}-journal"
    if [ -f "$JOURNAL_BACKUP" ]; then
        cp "$JOURNAL_BACKUP" "$DB_FILE-journal"
    else
        # Remove old journal
        rm -f "$DB_FILE-journal"
    fi

    # Verify restore
    if [ -f "$DB_FILE" ]; then
        DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
        success "Database restored: $DB_FILE ($DB_SIZE)"

        # Verify integrity
        if command -v sqlite3 &> /dev/null; then
            log "Verifying database integrity..."
            INTEGRITY=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1)
            if [ "$INTEGRITY" = "ok" ]; then
                success "Database integrity check passed"
            else
                warn "Database integrity check: $INTEGRITY"
            fi
        fi
    else
        error "Restore failed - database file not created"
    fi

    # Start service
    start_service

    log "=== Restore Complete ==="
    echo ""
    echo "Please verify the POS is working correctly."
    echo "If there are issues, restore the safety backup:"
    echo "  ./restore.sh $SAFETY_BACKUP"
}

# Show help
show_help() {
    echo "GWI POS Database Restore Script"
    echo ""
    echo "Usage:"
    echo "  $0                      Restore from latest backup"
    echo "  $0 <backup-file>        Restore from specific file"
    echo "  $0 --list               List available backups"
    echo "  $0 --help               Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                                          # Latest backup"
    echo "  $0 /opt/gwi-pos/docker/backups/pos-20240115-020000.db.gz"
    echo ""
    echo "WARNING: This will stop the POS service during restore!"
}

# Main execution
main() {
    case "$1" in
        --list|-l)
            list_backups
            ;;
        --help|-h)
            show_help
            ;;
        "")
            # Restore from latest
            LATEST=$(get_latest_backup)
            if [ -z "$LATEST" ]; then
                error "No backups found in $BACKUP_DIR"
            fi
            restore_backup "$LATEST"
            ;;
        *)
            # Restore from specified file
            restore_backup "$1"
            ;;
    esac
}

main "$@"
