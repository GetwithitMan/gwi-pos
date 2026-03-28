#!/usr/bin/env bash
# =============================================================================
# pre-update-safety.sh — Shared safety library for pre-update backups & checks
# =============================================================================
# Sourced by: installer, sync-agent wrapper, update-agent wrapper,
#             public/scripts/pre-update-backup.sh
#
# Functions:
#   create_pre_update_backup   — pg_dump + optional encrypt + manifest + rotation
#   verify_backup_integrity    — file + pg_restore --list + checksum verification
#   ensure_data_synced_to_neon — trigger sync + poll until unsynced rows = 0
#   record_pre_update_state    — snapshot current app/schema/git state to JSON
#
# Expects (with defaults):
#   DB_USER   (default: thepasspos)
#   DB_NAME   (default: thepasspos)
#   APP_DIR   (default: /opt/gwi-pos/app)
#   APP_BASE  (default: /opt/gwi-pos)
# =============================================================================
# NOTE: Do NOT set -euo pipefail here — this file is sourced into callers
# and would change their error handling behavior unexpectedly.
# Callers are responsible for their own error handling mode.

# ---------------------------------------------------------------------------
# Defaults — callers may override before sourcing or via env
# ---------------------------------------------------------------------------
: "${DB_USER:=thepasspos}"
: "${DB_NAME:=thepasspos}"
: "${APP_DIR:=/opt/gwi-pos/app}"
: "${APP_BASE:=/opt/gwi-pos}"

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
_pus_log() {
  printf '[pre-update-safety] %s\n' "$*" >&2
}

_pus_iso_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

_pus_file_size() {
  local path="$1"
  if command -v stat >/dev/null 2>&1; then
    # GNU stat (Linux)
    stat -c '%s' "$path" 2>/dev/null || stat -f '%z' "$path" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

_pus_read_json_field() {
  # Minimal JSON field reader — no jq dependency
  # Usage: _pus_read_json_field file.json fieldName
  local file="$1" field="$2"
  if [ -f "$file" ]; then
    # Handles: "field": "value" or "field":"value"
    sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$file" | head -1
  fi
}

# =============================================================================
# create_pre_update_backup
# =============================================================================
# Creates a pg_dump backup, optionally encrypts it, writes a JSON manifest,
# rotates old backups, and prints a structured JSON result to stdout.
# Returns 0 on success, 1 on failure.
# =============================================================================
create_pre_update_backup() {
  local backup_dir="${APP_BASE}/backups/pre-update"
  local backup_key="${APP_BASE}/.backup-key"
  local timestamp
  local backup_filename
  local backup_path
  local final_path
  local encrypted=false
  local checksum
  local file_size
  local schema_version
  local git_sha
  local app_version
  local manifest_path

  # Require pg_dump
  if ! command -v pg_dump >/dev/null 2>&1; then
    _pus_log "ERROR: pg_dump not found — cannot create backup"
    return 1
  fi

  # Create backup directory
  mkdir -p "$backup_dir"

  timestamp="$(date +%Y%m%d-%H%M%S)"
  backup_filename="pre-update-${timestamp}.dump"
  backup_path="${backup_dir}/${backup_filename}"

  # ── pg_dump with 120s timeout ──
  _pus_log "Starting pg_dump → ${backup_path}"
  if ! timeout --kill-after=10 120 pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" -f "$backup_path" 2>&1; then
    _pus_log "ERROR: pg_dump failed"
    rm -f "$backup_path"
    return 1
  fi

  if [ ! -s "$backup_path" ]; then
    _pus_log "ERROR: pg_dump produced empty file"
    rm -f "$backup_path"
    return 1
  fi

  final_path="$backup_path"

  # ── Optional encryption ──
  if [ -f "$backup_key" ]; then
    _pus_log "Encrypting backup with .backup-key"
    if openssl enc -aes-256-cbc -pbkdf2 \
         -in "$backup_path" \
         -out "${backup_path}.enc" \
         -pass "file:${backup_key}" 2>&1; then
      rm -f "$backup_path"
      final_path="${backup_path}.enc"
      encrypted=true
      _pus_log "Encryption complete → ${final_path}"
    else
      _pus_log "WARNING: Encryption failed — keeping unencrypted backup"
      # final_path stays as the unencrypted dump
    fi
  fi

  # ── Compute SHA-256 ──
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "$final_path" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    checksum="$(shasum -a 256 "$final_path" | awk '{print $1}')"
  else
    checksum="unavailable"
  fi

  # ── Get schema version ──
  schema_version="unknown"
  if [ -f "${APP_DIR}/public/version-contract.json" ]; then
    local sv
    sv="$(_pus_read_json_field "${APP_DIR}/public/version-contract.json" "schemaVersion")"
    if [ -n "$sv" ]; then
      schema_version="$sv"
    fi
  fi
  # Fallback: query DB
  if [ "$schema_version" = "unknown" ] && command -v psql >/dev/null 2>&1; then
    local db_ver
    db_ver="$(psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT version FROM _local_install_state LIMIT 1" 2>/dev/null || true)"
    if [ -n "$db_ver" ]; then
      schema_version="$db_ver"
    fi
  fi

  # ── Get git SHA ──
  git_sha="unknown"
  if command -v git >/dev/null 2>&1 && [ -d "${APP_DIR}/.git" ]; then
    local sha
    sha="$(cd "$APP_DIR" && git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "$sha" ]; then
      git_sha="$sha"
    fi
  fi

  # ── Get app version ──
  app_version="unknown"
  if [ -f "${APP_DIR}/package.json" ]; then
    local av
    av="$(_pus_read_json_field "${APP_DIR}/package.json" "version")"
    if [ -n "$av" ]; then
      app_version="$av"
    fi
  fi

  # ── File size ──
  file_size="$(_pus_file_size "$final_path")"

  # ── Write manifest JSON ──
  manifest_path="${backup_path}.json"
  cat > "$manifest_path" <<MANIFEST_EOF
{"timestamp":"$(_pus_iso_timestamp)","hostname":"$(hostname)","dbName":"${DB_NAME}","schemaVersion":"${schema_version}","appVersion":"${app_version}","gitSha":"${git_sha}","fileSize":${file_size},"checksum":"sha256:${checksum}","encrypted":${encrypted}}
MANIFEST_EOF
  _pus_log "Manifest written → ${manifest_path}"

  # ── Rotation: keep newest 10 files (5 backup+manifest pairs) ──
  _rotate_old_backups "$backup_dir"

  # ── Output structured JSON to stdout ──
  printf '{"path":"%s","size":%s,"checksum":"sha256:%s","status":"OK"}\n' \
    "$final_path" "$file_size" "$checksum"

  _pus_log "Backup complete: ${final_path} (${file_size} bytes)"
  return 0
}

_rotate_old_backups() {
  local dir="$1"
  local file_count
  local files_to_delete

  # Count all backup-related files (dumps, encrypted dumps, manifests)
  file_count="$(find "$dir" -maxdepth 1 -name "pre-update-*" -type f 2>/dev/null | wc -l)"

  if [ "$file_count" -le 10 ]; then
    return 0
  fi

  # Sort by name (which includes timestamp) and delete all but newest 10
  files_to_delete="$(find "$dir" -maxdepth 1 -name "pre-update-*" -type f 2>/dev/null | sort | head -n -10)"

  if [ -n "$files_to_delete" ]; then
    _pus_log "Rotating old backups: removing $(echo "$files_to_delete" | wc -l) files"
    echo "$files_to_delete" | while IFS= read -r old_file; do
      rm -f "$old_file"
      _pus_log "  Removed: $(basename "$old_file")"
    done
  fi
}

# =============================================================================
# verify_backup_integrity
# =============================================================================
# Verifies a backup file: exists, non-empty, pg_restore --list (if .dump),
# and checksum match (if .json manifest exists).
# Args: $1 = path to backup file
# Returns 0 if valid, 1 if not.
# =============================================================================
verify_backup_integrity() {
  local backup_path="${1:-}"
  local manifest_path
  local expected_checksum
  local actual_checksum

  if [ -z "$backup_path" ]; then
    _pus_log "ERROR: verify_backup_integrity requires a file path argument"
    return 1
  fi

  # ── File exists and is non-empty ──
  if [ ! -f "$backup_path" ]; then
    _pus_log "ERROR: Backup file does not exist: ${backup_path}"
    return 1
  fi

  if [ ! -s "$backup_path" ]; then
    _pus_log "ERROR: Backup file is empty: ${backup_path}"
    return 1
  fi

  # ── pg_restore --list validation (only for unencrypted .dump files) ──
  if [[ "$backup_path" == *.dump ]] && [[ "$backup_path" != *.enc ]]; then
    if command -v pg_restore >/dev/null 2>&1; then
      if ! pg_restore --list "$backup_path" >/dev/null 2>&1; then
        _pus_log "ERROR: pg_restore --list failed — backup may be corrupt: ${backup_path}"
        return 1
      fi
      _pus_log "pg_restore --list: OK"
    else
      _pus_log "WARNING: pg_restore not found — skipping archive validation"
    fi
  fi

  # ── Checksum verification against manifest ──
  # The manifest filename is always based on the original .dump path
  # e.g., pre-update-20260323-120000.dump.json (for both .dump and .dump.enc)
  manifest_path="${backup_path%.enc}.json"

  if [ -f "$manifest_path" ]; then
    # Extract checksum from manifest JSON
    expected_checksum="$(_pus_read_json_field "$manifest_path" "checksum")"
    # Strip "sha256:" prefix if present
    expected_checksum="${expected_checksum#sha256:}"

    if [ -n "$expected_checksum" ] && [ "$expected_checksum" != "unavailable" ]; then
      if command -v sha256sum >/dev/null 2>&1; then
        actual_checksum="$(sha256sum "$backup_path" | awk '{print $1}')"
      elif command -v shasum >/dev/null 2>&1; then
        actual_checksum="$(shasum -a 256 "$backup_path" | awk '{print $1}')"
      else
        _pus_log "WARNING: No sha256sum or shasum available — skipping checksum verification"
        actual_checksum=""
      fi

      if [ -n "$actual_checksum" ] && [ "$actual_checksum" != "$expected_checksum" ]; then
        _pus_log "ERROR: Checksum mismatch!"
        _pus_log "  Expected: ${expected_checksum}"
        _pus_log "  Actual:   ${actual_checksum}"
        return 1
      fi

      if [ -n "$actual_checksum" ]; then
        _pus_log "Checksum verified: OK"
      fi
    fi
  else
    _pus_log "WARNING: No manifest found at ${manifest_path} — skipping checksum verification"
  fi

  _pus_log "Backup integrity: PASS (${backup_path})"
  return 0
}

# =============================================================================
# ensure_data_synced_to_neon
# =============================================================================
# Triggers a sync and polls until critical tables have zero unsynced rows.
# Does NOT stop the POS service.
# Returns 0 if all synced, 1 if timeout.
# =============================================================================
ensure_data_synced_to_neon() {
  local api_secret="${INTERNAL_API_SECRET:-}"
  local max_wait=30
  local elapsed=0
  local delay=2
  local pending

  # ── Trigger sync (best-effort) ──
  if [ -n "$api_secret" ]; then
    _pus_log "Triggering sync via internal API..."
    curl -sf -X POST "http://localhost:3005/api/internal/trigger-sync" \
      -H "Authorization: Bearer ${api_secret}" \
      -H "Content-Type: application/json" \
      -d '{}' 2>/dev/null || true
  else
    _pus_log "WARNING: INTERNAL_API_SECRET not set — skipping sync trigger"
  fi

  # ── Require psql for polling ──
  if ! command -v psql >/dev/null 2>&1; then
    _pus_log "WARNING: psql not found — cannot verify sync status"
    return 1
  fi

  # ── Poll with exponential backoff: 2s, 4s, 8s, 16s (max 30s total) ──
  _pus_log "Polling for unsynced rows (max ${max_wait}s)..."

  while [ "$elapsed" -lt "$max_wait" ]; do
    sleep "$delay"
    elapsed=$((elapsed + delay))

    pending="$(psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT COALESCE(SUM(c),0) FROM (
        SELECT COUNT(*) as c FROM \"Order\" WHERE \"syncedAt\" IS NULL
        UNION ALL SELECT COUNT(*) FROM \"Payment\" WHERE \"syncedAt\" IS NULL
        UNION ALL SELECT COUNT(*) FROM \"Shift\" WHERE \"syncedAt\" IS NULL
        UNION ALL SELECT COUNT(*) FROM \"TipLedgerEntry\" WHERE \"syncedAt\" IS NULL
      ) t" 2>/dev/null || echo "-1")"

    if [ "$pending" = "0" ]; then
      _pus_log "All critical tables synced (${elapsed}s elapsed)"
      return 0
    fi

    if [ "$pending" = "-1" ]; then
      _pus_log "WARNING: psql query failed at ${elapsed}s"
    else
      _pus_log "  Pending rows: ${pending} (${elapsed}s elapsed, next check in ${delay}s)"
    fi

    # Exponential backoff: 2 → 4 → 8 → 16
    delay=$((delay * 2))
    if [ $((elapsed + delay)) -gt "$max_wait" ]; then
      delay=$((max_wait - elapsed))
      if [ "$delay" -le 0 ]; then
        break
      fi
    fi
  done

  # ── Timeout — log which tables have pending rows ──
  _pus_log "WARNING: Sync poll timed out after ${max_wait}s"

  local table
  for table in Order Payment Shift TipLedgerEntry; do
    local count
    count="$(psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT COUNT(*) FROM \"${table}\" WHERE \"syncedAt\" IS NULL" 2>/dev/null || echo "?")"
    if [ "$count" != "0" ] && [ "$count" != "?" ]; then
      _pus_log "  ${table}: ${count} unsynced rows"
    fi
  done

  return 1
}

# =============================================================================
# record_pre_update_state
# =============================================================================
# Writes a JSON snapshot of the current app/schema/git state to
# /opt/gwi-pos/state/pre-update-state.json
# Returns 0 on success, 1 on failure.
# =============================================================================
record_pre_update_state() {
  local state_dir="${APP_BASE}/state"
  local state_file="${state_dir}/pre-update-state.json"
  local git_sha="unknown"
  local app_version="unknown"
  local schema_version="unknown"
  local migration_count="0"
  local dirty_tree=""
  local package_lock_hash="unknown"
  local timestamp

  mkdir -p "$state_dir"

  timestamp="$(_pus_iso_timestamp)"

  # ── Git SHA ──
  if command -v git >/dev/null 2>&1 && [ -d "${APP_DIR}/.git" ]; then
    local sha
    sha="$(cd "$APP_DIR" && git rev-parse HEAD 2>/dev/null || true)"
    if [ -n "$sha" ]; then
      git_sha="$sha"
    fi
  fi

  # ── App version ──
  if [ -f "${APP_DIR}/package.json" ]; then
    local av
    av="$(_pus_read_json_field "${APP_DIR}/package.json" "version")"
    if [ -n "$av" ]; then
      app_version="$av"
    fi
  fi

  # ── Schema version ──
  if [ -f "${APP_DIR}/public/version-contract.json" ]; then
    local sv
    sv="$(_pus_read_json_field "${APP_DIR}/public/version-contract.json" "schemaVersion")"
    if [ -n "$sv" ]; then
      schema_version="$sv"
    fi
  fi

  # ── Migration count ──
  if command -v psql >/dev/null 2>&1; then
    local mc
    mc="$(psql -U "$DB_USER" -d "$DB_NAME" -tAc \
      "SELECT COUNT(*) FROM _gwi_migrations" 2>/dev/null || echo "0")"
    if [ -n "$mc" ]; then
      migration_count="$mc"
    fi
  fi

  # ── Dirty tree ──
  if command -v git >/dev/null 2>&1 && [ -d "${APP_DIR}/.git" ]; then
    dirty_tree="$(cd "$APP_DIR" && git status --porcelain 2>/dev/null || true)"
  fi

  # ── Package lock hash ──
  if [ -f "${APP_DIR}/package-lock.json" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
      package_lock_hash="$(sha256sum "${APP_DIR}/package-lock.json" | awk '{print $1}')"
    elif command -v shasum >/dev/null 2>&1; then
      package_lock_hash="$(shasum -a 256 "${APP_DIR}/package-lock.json" | awk '{print $1}')"
    fi
  fi

  # ── Escape dirty_tree for JSON (newlines → \n, quotes → \") ──
  local escaped_dirty_tree
  escaped_dirty_tree="$(printf '%s' "$dirty_tree" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/' | tr -d '\n')"
  # Remove trailing \n if dirty_tree was empty
  if [ -z "$dirty_tree" ]; then
    escaped_dirty_tree=""
  else
    # Remove the final trailing \n we added
    escaped_dirty_tree="${escaped_dirty_tree%\\n}"
  fi

  # ── Write state file ──
  cat > "$state_file" <<STATE_EOF
{
  "gitSha": "${git_sha}",
  "appVersion": "${app_version}",
  "schemaVersion": "${schema_version}",
  "migrationCount": ${migration_count},
  "dirtyTree": "${escaped_dirty_tree}",
  "packageLockHash": "${package_lock_hash}",
  "timestamp": "${timestamp}"
}
STATE_EOF

  _pus_log "Pre-update state recorded → ${state_file}"
  return 0
}
