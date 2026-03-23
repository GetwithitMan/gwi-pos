#!/usr/bin/env bash
# =============================================================================
# pre-update-backup.sh — Thin wrapper for pre-update backup & verification
# =============================================================================
# Callable from Node's execSync() or directly from shell.
# Sources the shared safety library then runs backup + integrity check.
#
# Usage:
#   bash public/scripts/pre-update-backup.sh
#   DB_USER=myuser DB_NAME=mydb bash public/scripts/pre-update-backup.sh
#
# Env overrides:
#   DB_USER   (default: thepasspos)
#   DB_NAME   (default: thepasspos)
#   APP_DIR   (default: /opt/gwi-pos/app)
#   APP_BASE  (default: /opt/gwi-pos)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults — override via environment variables
# ---------------------------------------------------------------------------
export DB_USER="${DB_USER:-thepasspos}"
export DB_NAME="${DB_NAME:-thepasspos}"
export APP_DIR="${APP_DIR:-/opt/gwi-pos/app}"
export APP_BASE="${APP_BASE:-/opt/gwi-pos}"

# ---------------------------------------------------------------------------
# Locate and source the shared safety library
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_PATH=""

# Try 1: relative to this script (repo layout: public/scripts/ → ../installer-modules/lib/)
if [ -f "${SCRIPT_DIR}/../installer-modules/lib/pre-update-safety.sh" ]; then
  LIB_PATH="${SCRIPT_DIR}/../installer-modules/lib/pre-update-safety.sh"
# Try 2: deployed location on NUC
elif [ -f "/opt/gwi-pos/app/public/installer-modules/lib/pre-update-safety.sh" ]; then
  LIB_PATH="/opt/gwi-pos/app/public/installer-modules/lib/pre-update-safety.sh"
else
  echo "[pre-update-backup] ERROR: Cannot find pre-update-safety.sh library" >&2
  exit 1
fi

# shellcheck source=../installer-modules/lib/pre-update-safety.sh
source "$LIB_PATH"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local backup_result
  local backup_path

  # ── Create the backup ──
  # create_pre_update_backup prints JSON to stdout; capture it
  backup_result="$(create_pre_update_backup)"
  local rc=$?

  if [ "$rc" -ne 0 ]; then
    echo "[pre-update-backup] ERROR: Backup creation failed" >&2
    exit 1
  fi

  # ── Extract path from the JSON result ──
  # Result format: {"path":"/opt/...","size":123,"checksum":"sha256:...","status":"OK"}
  backup_path="$(printf '%s' "$backup_result" | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"

  if [ -z "$backup_path" ]; then
    echo "[pre-update-backup] ERROR: Could not parse backup path from result" >&2
    echo "[pre-update-backup] Raw result: ${backup_result}" >&2
    exit 1
  fi

  # ── Verify integrity ──
  if ! verify_backup_integrity "$backup_path"; then
    echo "[pre-update-backup] ERROR: Backup integrity check failed for ${backup_path}" >&2
    exit 1
  fi

  # ── Output the result (for Node's execSync to capture) ──
  echo "$backup_result"
  exit 0
}

main "$@"
