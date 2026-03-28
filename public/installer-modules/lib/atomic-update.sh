#!/usr/bin/env bash
# =============================================================================
# lib/atomic-update.sh -- Atomic update transaction support
# =============================================================================
#
# Sourced by other scripts (installer stages, sync agent, etc.) to provide
# safe, rollback-capable update transactions for the POS application directory.
#
# Functions:
#   start_update_transaction  -- Safety checks + backup + code snapshot
#   commit_update             -- Clean up artifacts, restart dashboard
#   rollback_transaction      -- Restore code from snapshot, restart dashboard
#
# Expected variables (set by caller or defaulted):
#   APP_DIR   -- Path to the application directory (default: /opt/gwi-pos/app)
#   APP_BASE  -- Path to the base install directory (default: /opt/gwi-pos)
#
# Uses log() if available, falls back to timestamped echo.
# =============================================================================

# ── Defaults ──────────────────────────────────────────────────────────────────

APP_DIR="${APP_DIR:-/opt/gwi-pos/app}"
APP_BASE="${APP_BASE:-/opt/gwi-pos}"

# State directory for lock files and transaction metadata
_STATE_DIR="$APP_BASE/state"

# Lock file path
_LOCK_FILE="$_STATE_DIR/.update-transaction.lock"

# Code snapshot path (the "last known good" copy)
_SNAPSHOT_DIR="$APP_BASE/app.last-good"

# Minimum free disk space in MB required to start an update
_MIN_FREE_MB=6000

# ── Logging fallback ─────────────────────────────────────────────────────────
# If log() is not defined (e.g., script sourced outside the installer), provide
# a fallback that prints with a timestamp.

if ! type log &>/dev/null; then
  log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [GWI-UPDATE] $*"; }
fi
if ! type warn &>/dev/null; then
  warn() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WARNING] $*"; }
fi
if ! type err &>/dev/null; then
  err() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*" >&2; }
fi

# ── Path Safety ───────────────────────────────────────────────────────────────
# Validates that the given path is non-empty, not "/", and rooted under
# /opt/gwi-pos/. This prevents catastrophic rm -rf or cp operations against
# wrong directories.

_validate_app_dir() {
  local dir="$1"

  if [[ -z "$dir" ]]; then
    err "APP_DIR is empty. Refusing to proceed."
    return 1
  fi

  if [[ "$dir" == "/" ]]; then
    err "APP_DIR is '/'. Refusing to proceed."
    return 1
  fi

  if [[ "$dir" != /opt/gwi-pos/* ]]; then
    err "APP_DIR '$dir' is not under /opt/gwi-pos/. Refusing to proceed."
    return 1
  fi

  return 0
}

# =============================================================================
# start_update_transaction()
# =============================================================================
# Prepares for an atomic update:
#   1. Path safety validation
#   2. Disk space check (>= 6000 MB free)
#   3. Write lock file (prevents concurrent updates)
#   4. Create pre-update backup (DB + config, via pre-update-safety.sh)
#   5. Snapshot current application directory to app.last-good
#
# Returns 0 on success, non-zero on failure.
# Echoes backup result JSON to stdout for callers to capture.
# =============================================================================

start_update_transaction() {
  log "Starting update transaction..."

  # ── 1. Path safety ──
  if ! _validate_app_dir "$APP_DIR"; then
    return 1
  fi

  # ── 2. Disk space check ──
  local free_mb
  free_mb=$(df -BM "$APP_BASE" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'M')

  if [[ -z "$free_mb" ]]; then
    err "Could not determine free disk space on $APP_BASE."
    return 1
  fi

  if [[ "$free_mb" -lt "$_MIN_FREE_MB" ]]; then
    err "Insufficient disk space: ${free_mb}MB free, need at least ${_MIN_FREE_MB}MB."
    err "Free up space before updating. Current partition:"
    df -h "$APP_BASE" >&2
    return 1
  fi

  log "Disk space: ${free_mb}MB free (need ${_MIN_FREE_MB}MB) -- OK"

  # ── 3. Write lock file ──
  mkdir -p "$_STATE_DIR"

  if [[ -f "$_LOCK_FILE" ]]; then
    warn "Lock file already exists -- a previous update may have failed or is still running."
    warn "Lock contents:"
    cat "$_LOCK_FILE" >&2 || true
    warn "Overwriting stale lock and proceeding."
  fi

  local iso_now
  iso_now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

  cat > "$_LOCK_FILE" <<EOF
{"status":"IN_PROGRESS","startedAt":"$iso_now"}
EOF

  log "Update lock written: $_LOCK_FILE"

  # ── 4. Pre-update backup (DB + config) ──
  local backup_result='{"backup":"skipped","reason":"pre-update-safety.sh not found"}'
  local safety_lib="$APP_BASE/installer-modules/lib/pre-update-safety.sh"

  # Also check the module directory relative to this script
  if [[ ! -f "$safety_lib" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    safety_lib="$script_dir/pre-update-safety.sh"
  fi

  if [[ -f "$safety_lib" ]]; then
    log "Sourcing pre-update safety: $safety_lib"
    # shellcheck disable=SC1090
    source "$safety_lib"

    if type create_pre_update_backup &>/dev/null; then
      backup_result=$(create_pre_update_backup) || {
        warn "Pre-update backup returned non-zero, but continuing with update."
        warn "Backup output: $backup_result"
      }
    else
      warn "pre-update-safety.sh sourced but create_pre_update_backup() not found."
    fi
  else
    log "pre-update-safety.sh not found -- skipping DB/config backup (not yet created)."
  fi

  # ── 5. Code snapshot ──
  if [[ -d "$APP_DIR" ]]; then
    log "Creating code snapshot: $APP_DIR -> $_SNAPSHOT_DIR"

    # Remove old snapshot first to avoid stale data
    if [[ -d "$_SNAPSHOT_DIR" ]]; then
      rm -rf "$_SNAPSHOT_DIR"
    fi

    cp -a "$APP_DIR" "$_SNAPSHOT_DIR"

    if [[ -d "$_SNAPSHOT_DIR" ]]; then
      log "Code snapshot created successfully."
    else
      err "Failed to create code snapshot at $_SNAPSHOT_DIR."
      rm -f "$_LOCK_FILE"
      return 1
    fi
  else
    warn "APP_DIR '$APP_DIR' does not exist yet -- no snapshot to create (fresh install?)."
  fi

  # Echo backup result JSON for callers to capture
  echo "$backup_result"

  log "Update transaction started successfully."
  return 0
}

# =============================================================================
# commit_update()
# =============================================================================
# Finalizes a successful update:
#   1. Remove lock file
#   2. Remove code snapshot (no longer needed -- update succeeded)
#   3. Restart NUC Dashboard service
#
# Returns 0 on success.
# =============================================================================

commit_update() {
  log "Committing update transaction..."

  # ── 1. Remove lock file ──
  if [[ -f "$_LOCK_FILE" ]]; then
    rm -f "$_LOCK_FILE"
    log "Lock file removed."
  fi

  # ── 2. Remove code snapshot ──
  if [[ -d "$_SNAPSHOT_DIR" ]]; then
    rm -rf "$_SNAPSHOT_DIR"
    log "Code snapshot removed (update succeeded, no longer needed)."
  fi

  # ── 3. Restart Dashboard ──
  # The dashboard displays update status -- restart it so it picks up the new state.
  # Uses --user because gwi-dashboard runs as a user service, not root.
  # Failure is non-fatal (dashboard may not be installed yet).
  systemctl --user restart gwi-dashboard.service 2>/dev/null || true
  log "Dashboard restart requested."

  log "Update transaction committed."
  return 0
}

# =============================================================================
# rollback_transaction()
# =============================================================================
# Rolls back a failed update by restoring code from the snapshot:
#   1. Validate snapshot exists
#   2. Path safety on APP_DIR
#   3. Replace APP_DIR with snapshot
#   4. Remove lock file
#   5. Restart Dashboard
#
# NOTE: This does NOT auto-restore the database. This is a deliberate
# conservative policy. Database rollback is risky because:
#   - Migrations may have been partially applied
#   - Other NUCs/cloud may have already synced data against the new schema
#   - Automatic DB rollback could cause data loss or sync divergence
#   - Manual DB restore from backup is safer and allows operator judgment
#
# If a DB restore is needed, the operator should manually run:
#   /opt/gwi-pos/scripts/nuc-restore.sh
#
# Returns 0 on success, non-zero on failure.
# =============================================================================

rollback_transaction() {
  log "Rolling back update transaction..."

  # ── 1. Validate snapshot exists ──
  if [[ ! -d "$_SNAPSHOT_DIR" ]]; then
    err "Cannot rollback: snapshot directory '$_SNAPSHOT_DIR' does not exist."
    err "No previous version to restore. Manual intervention required."
    return 1
  fi

  # ── 2. Path safety ──
  if ! _validate_app_dir "$APP_DIR"; then
    return 1
  fi

  # ── 3. Replace APP_DIR with snapshot ──
  log "Removing failed update: $APP_DIR"
  rm -rf "$APP_DIR"

  log "Restoring from snapshot: $_SNAPSHOT_DIR -> $APP_DIR"
  mv "$_SNAPSHOT_DIR" "$APP_DIR"

  if [[ -d "$APP_DIR" ]]; then
    log "Code restored successfully."
  else
    err "Restore failed -- APP_DIR '$APP_DIR' does not exist after mv."
    return 1
  fi

  # ── 4. Remove lock file ──
  if [[ -f "$_LOCK_FILE" ]]; then
    rm -f "$_LOCK_FILE"
    log "Lock file removed."
  fi

  # ── 5. Restart Dashboard ──
  systemctl --user restart gwi-dashboard.service 2>/dev/null || true
  log "Dashboard restart requested."

  log "Rollback complete. Code restored to pre-update state."
  log "NOTE: Database was NOT rolled back (conservative policy)."
  log "If DB restore is needed, run: /opt/gwi-pos/scripts/nuc-restore.sh"
  return 0
}
