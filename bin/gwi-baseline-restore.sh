#!/usr/bin/env bash
# gwi-baseline-restore.sh — Restore config files from a baseline snapshot
# Part of the GWI POS Node Baseline Enforcement System
# Installed to /opt/gwi-pos/bin/gwi-baseline-restore.sh
#
# Usage:
#   sudo ./gwi-baseline-restore.sh                           # Show usage + available snapshots
#   sudo ./gwi-baseline-restore.sh <snapshot.tar.gz>         # Preview what would be restored
#   sudo ./gwi-baseline-restore.sh <snapshot.tar.gz> --confirm  # Actually restore
#
# WARNING: This is config rollback only.
# Packages, kernels, apt state, and database state are NOT affected.

set -euo pipefail

readonly BASE_DIR="/opt/gwi-pos"
readonly BACKUP_DIR="${BASE_DIR}/backups"
readonly SNAPSHOT_PATTERN="baseline-snapshot-*.tar.gz"

# --- Colors (if terminal supports them) ---

RED=""
YELLOW=""
GREEN=""
BOLD=""
RESET=""
if [[ -t 1 ]]; then
    RED="\033[0;31m"
    YELLOW="\033[0;33m"
    GREEN="\033[0;32m"
    BOLD="\033[1m"
    RESET="\033[0m"
fi

# --- Functions ---

show_usage() {
    echo ""
    echo "${BOLD}gwi-baseline-restore.sh${RESET} — Restore config from baseline snapshot"
    echo ""
    echo "Usage:"
    echo "  sudo $0                              Show available snapshots"
    echo "  sudo $0 <snapshot.tar.gz>            Preview what will be restored"
    echo "  sudo $0 <snapshot.tar.gz> --confirm  Restore config files"
    echo ""
    echo -e "${YELLOW}WARNING: This is config rollback only.${RESET}"
    echo "  Packages, kernels, and DB state are not affected."
    echo ""
}

list_snapshots() {
    echo "Available snapshots in ${BACKUP_DIR}/:"
    echo ""

    local found=false
    if [[ -d "$BACKUP_DIR" ]]; then
        for snapshot in "${BACKUP_DIR}"/${SNAPSHOT_PATTERN}; do
            if [[ -f "$snapshot" ]]; then
                found=true
                local size
                size=$(du -h "$snapshot" | cut -f1)
                local mtime
                mtime=$(stat -c '%Y' "$snapshot" 2>/dev/null || stat -f '%m' "$snapshot" 2>/dev/null || echo "unknown")
                local mtime_human
                mtime_human=$(date -d "@${mtime}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "${mtime}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "unknown")
                echo "  ${snapshot}"
                echo "    Size: ${size}  Created: ${mtime_human}"
                echo ""
            fi
        done
    fi

    if [[ "$found" == false ]]; then
        echo "  (none found)"
        echo ""
        echo "  Snapshots are created by the reboot_manager role before rebooting."
        echo "  They are stored as: ${BACKUP_DIR}/baseline-snapshot-YYYYMMDD-HHMMSS.tar.gz"
    fi
    echo ""
}

preview_snapshot() {
    local snapshot="$1"

    echo ""
    echo "${BOLD}Snapshot contents:${RESET} ${snapshot}"
    echo ""

    # List config files that would be restored (filter to known config paths)
    echo "Config files that would be restored:"
    echo ""

    local has_files=false
    while IFS= read -r entry; do
        # Show only actual files (not directories)
        if [[ "$entry" != */ ]] && [[ -n "$entry" ]]; then
            echo "  ${entry}"
            has_files=true
        fi
    done < <(tar tzf "$snapshot" 2>/dev/null || true)

    if [[ "$has_files" == false ]]; then
        echo "  (no files found or archive is corrupt)"
        return 1
    fi

    echo ""
    echo -e "${YELLOW}WARNING: This is config rollback only.${RESET}"
    echo "  Packages, kernels, and DB state are not affected."
    echo ""
    echo "To restore, run:"
    echo "  sudo $0 ${snapshot} --confirm"
    echo ""
}

restore_snapshot() {
    local snapshot="$1"

    echo ""
    echo -e "${BOLD}Restoring config from snapshot:${RESET} ${snapshot}"
    echo ""

    # Create a temp dir for safe extraction
    local restore_tmp
    restore_tmp=$(mktemp -d "/tmp/gwi-baseline-restore.XXXXXX")
    trap 'rm -rf "$restore_tmp"' EXIT

    # Extract to temp dir first
    tar xzf "$snapshot" -C "$restore_tmp"

    local restored_count=0

    # Define which paths are safe to restore (config only — NOT packages, kernels, DB)
    local -a SAFE_RESTORE_PATHS=(
        "opt/gwi-pos/state"
        "etc/systemd/logind.conf.d"
        "etc/ufw"
        "etc/ssh/sshd_config.d"
        "etc/sddm.conf.d"
        "etc/gdm3"
        "etc/udev/rules.d"
    )

    # Walk the extracted files and copy safe ones back to /
    for safe_prefix in "${SAFE_RESTORE_PATHS[@]}"; do
        local src_path="${restore_tmp}/${safe_prefix}"
        # The tarball might store with leading / or relative — check both
        if [[ ! -d "$src_path" ]]; then
            # Try finding it under a subdirectory (tar might have a top-level dir)
            for subdir in "${restore_tmp}"/*/; do
                if [[ -d "${subdir}${safe_prefix}" ]]; then
                    src_path="${subdir}${safe_prefix}"
                    break
                fi
            done
        fi

        if [[ -d "$src_path" ]]; then
            local dest_path="/${safe_prefix}"
            mkdir -p "$dest_path"

            # Copy files, preserving permissions
            while IFS= read -r file; do
                if [[ -f "$file" ]]; then
                    local rel_path="${file#${src_path}/}"
                    local dest_file="${dest_path}/${rel_path}"

                    # Ensure parent dir exists
                    mkdir -p "$(dirname "$dest_file")"

                    cp -p "$file" "$dest_file"
                    echo -e "  ${GREEN}[RESTORED]${RESET} ${dest_file}"
                    ((restored_count++)) || true
                fi
            done < <(find "$src_path" -type f 2>/dev/null)
        fi
    done

    echo ""
    if [[ "$restored_count" -eq 0 ]]; then
        echo -e "${YELLOW}No matching config files found in snapshot.${RESET}"
    else
        echo -e "${GREEN}Restored ${restored_count} config file(s).${RESET}"
    fi

    echo ""
    echo -e "${YELLOW}WARNING: This is config rollback only.${RESET}"
    echo "  Packages, kernels, and DB state are not affected."
    echo ""
    echo "You may need to restart services for changes to take effect:"
    echo "  sudo systemctl daemon-reload"
    echo "  sudo systemctl restart thepasspos"
    echo "  sudo ufw reload"
    echo ""
}

# --- Main ---

# Must be root
if [[ "$(id -u)" -ne 0 ]]; then
    echo "Error: This script must be run as root (sudo)." >&2
    exit 2
fi

# No arguments — show usage and list snapshots
if [[ $# -eq 0 ]]; then
    show_usage
    list_snapshots
    exit 0
fi

# First argument should be the snapshot path
SNAPSHOT_PATH="$1"
CONFIRM=false

# Check for --confirm flag
for arg in "$@"; do
    if [[ "$arg" == "--confirm" ]]; then
        CONFIRM=true
    fi
done

# Validate snapshot file exists
if [[ ! -f "$SNAPSHOT_PATH" ]]; then
    echo "Error: Snapshot file not found: ${SNAPSHOT_PATH}" >&2
    echo ""
    list_snapshots
    exit 2
fi

# Validate it's a gzip tarball
if ! file "$SNAPSHOT_PATH" | grep -q "gzip"; then
    echo "Error: File does not appear to be a gzip tarball: ${SNAPSHOT_PATH}" >&2
    exit 2
fi

if [[ "$CONFIRM" == true ]]; then
    restore_snapshot "$SNAPSHOT_PATH"
else
    preview_snapshot "$SNAPSHOT_PATH"
fi
