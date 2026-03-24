#!/usr/bin/env bash
# GWI POS Version Compatibility Matrix
# Validates that an update target is compatible with current version
# Usage: version-compat.sh <current-schema-version> <target-schema-version> [<current-app-version> <target-app-version>]
set -euo pipefail

MAX_SCHEMA_SKIP=1  # Max schema versions we can skip in one update

log() { echo "[$(date -u +%FT%TZ)] VERSION-COMPAT: $*"; }
err() { echo "[$(date -u +%FT%TZ)] VERSION-COMPAT ERROR: $*" >&2; }

check_schema_compatibility() {
  local current="$1"
  local target="$2"

  # Validate both are numeric (schema versions are like 093, 096 — NOT semver)
  if [[ ! "$current" =~ ^[0-9]+$ ]]; then
    log "Current schema version '$current' is not numeric — skipping schema compat check"
    echo '{"compatible":true,"reason":"non_numeric_current","current":"'"$current"'","target":"'"$target"'"}'
    return 0
  fi
  if [[ ! "$target" =~ ^[0-9]+$ ]]; then
    log "Target schema version '$target' is not numeric — skipping schema compat check"
    echo '{"compatible":true,"reason":"non_numeric_target","current":"'"$current"'","target":"'"$target"'"}'
    return 0
  fi

  # Strip leading zeros for arithmetic
  local current_num=$((10#$current))
  local target_num=$((10#$target))

  if [[ $target_num -lt $current_num ]]; then
    err "Target schema version ($target) is OLDER than current ($current) — downgrade not supported"
    echo '{"compatible":false,"reason":"schema_downgrade","current":"'"$current"'","target":"'"$target"'"}'
    return 1
  fi

  local skip=$((target_num - current_num))

  if [[ $skip -gt $MAX_SCHEMA_SKIP ]]; then
    err "Schema skip too large: $current → $target (skip=$skip, max=$MAX_SCHEMA_SKIP)"
    err "Must update through intermediate versions"
    echo '{"compatible":false,"reason":"schema_skip_too_large","current":"'"$current"'","target":"'"$target"'","skip":'$skip',"maxSkip":'$MAX_SCHEMA_SKIP'}'
    return 1
  fi

  log "Schema compatible: $current → $target (skip=$skip)"
  echo '{"compatible":true,"current":"'"$current"'","target":"'"$target"'","skip":'$skip'}'
  return 0
}

check_app_compatibility() {
  local current="$1"
  local target="$2"

  # Parse semver (major.minor.patch)
  local cur_major cur_minor cur_patch
  IFS='.' read -r cur_major cur_minor cur_patch <<< "$current"
  local tgt_major tgt_minor tgt_patch
  IFS='.' read -r tgt_major tgt_minor tgt_patch <<< "$target"

  # Block major version downgrades
  if [[ "${tgt_major:-0}" -lt "${cur_major:-0}" ]]; then
    err "Major version downgrade not supported: $current → $target"
    echo '{"compatible":false,"reason":"major_downgrade"}'
    return 1
  fi

  # Warn on major version jumps
  local major_diff=$(( ${tgt_major:-0} - ${cur_major:-0} ))
  if [[ $major_diff -gt 1 ]]; then
    log "WARNING: Major version jump: $current → $target"
  fi

  echo '{"compatible":true,"current":"'"$current"'","target":"'"$target"'"}'
  return 0
}

main() {
  local current_schema="${1:-}"
  local target_schema="${2:-}"
  local current_app="${3:-}"
  local target_app="${4:-}"

  if [[ -z "$current_schema" || -z "$target_schema" ]]; then
    err "Usage: version-compat.sh <current-schema> <target-schema> [<current-app> <target-app>]"
    exit 1
  fi

  local schema_result
  schema_result=$(check_schema_compatibility "$current_schema" "$target_schema") || exit 1

  if [[ -n "$current_app" && -n "$target_app" ]]; then
    local app_result
    app_result=$(check_app_compatibility "$current_app" "$target_app") || exit 1
  fi

  log "Version compatibility check PASSED"
  exit 0
}

main "$@"
