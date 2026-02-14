#!/bin/bash
# =============================================================================
# GWI POS - Database Restore Script (PostgreSQL)
# =============================================================================
# Restores the PostgreSQL database from a pg_dump backup.
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

# Check DATABASE_URL is set
check_database() {
    if [ -z "$DATABASE_URL" ]; then
        error "DATABASE_URL environment variable is not set"
    fi
}

# List available backups
list_backups() {
    echo ""
    echo "Available backups in $BACKUP_DIR:"
    echo ""
    ls -lt "$BACKUP_DIR"/pos-*.dump 2>/dev/null | head -20 || echo "No backups found"
    echo ""
    LATEST=$(ls -t "$BACKUP_DIR"/pos-*.dump 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
        echo "Latest backup: $(basename $LATEST)"
    fi
}

# Find latest backup
get_latest_backup() {
    ls -t "$BACKUP_DIR"/pos-*.dump 2>/dev/null | head -1
}

# Stop the POS service
stop_service() {
    log "Stopping GWI POS service..."
    if systemctl is-active --quiet gwi-pos 2>/dev/null; then
        systemctl stop gwi-pos
        success "Service stopped via systemd"
        return
    fi
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
    if systemctl list-unit-files | grep -q gwi-pos; then
        systemctl start gwi-pos
        success "Service started via systemd"
        return
    fi
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

    if [ ! -f "$BACKUP_FILE" ]; then
        error "Backup file not found: $BACKUP_FILE"
    fi

    log "=== GWI POS Restore (PostgreSQL) ==="
    info "Restoring from: $BACKUP_FILE"

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
    sleep 3

    # Create safety backup of current database
    SAFETY_FILE="$BACKUP_DIR/pos-pre-restore-$(date +%Y%m%d-%H%M%S).dump"
    log "Creating safety backup of current database..."
    pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl > "$SAFETY_FILE" 2>/dev/null || warn "Could not create safety backup (database may be empty)"
    if [ -f "$SAFETY_FILE" ] && [ -s "$SAFETY_FILE" ]; then
        success "Safety backup created: $SAFETY_FILE"
    fi

    # Restore
    log "Restoring database from backup..."
    pg_restore "$DATABASE_URL" --clean --if-exists --no-owner --no-acl "$BACKUP_FILE"

    success "Database restored from: $BACKUP_FILE"

    # Start service
    start_service

    log "=== Restore Complete ==="
    echo ""
    echo "Please verify the POS is working correctly."
    echo "If there are issues, restore the safety backup:"
    echo "  ./restore.sh $SAFETY_FILE"
}

# Show help
show_help() {
    echo "GWI POS Database Restore Script (PostgreSQL)"
    echo ""
    echo "Usage:"
    echo "  $0                      Restore from latest backup"
    echo "  $0 <backup-file>        Restore from specific file"
    echo "  $0 --list               List available backups"
    echo "  $0 --help               Show this help"
    echo ""
    echo "Environment variables:"
    echo "  DATABASE_URL       PostgreSQL connection string (REQUIRED)"
    echo "  BACKUP_DIR         Backup directory"
    echo ""
    echo "WARNING: This will stop the POS service during restore!"
}

main() {
    check_database

    case "$1" in
        --list|-l)
            list_backups
            ;;
        --help|-h)
            show_help
            ;;
        "")
            LATEST=$(get_latest_backup)
            if [ -z "$LATEST" ]; then
                error "No backups found in $BACKUP_DIR"
            fi
            restore_backup "$LATEST"
            ;;
        *)
            restore_backup "$1"
            ;;
    esac
}

main "$@"
