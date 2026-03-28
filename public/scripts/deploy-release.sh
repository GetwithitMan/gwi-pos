#!/usr/bin/env bash
# =============================================================================
# deploy-release.sh — THE canonical deploy script for GWI POS NUC servers
# =============================================================================
# Every deploy path (update-agent, sync-agent, installer, Ansible, manual)
# calls this ONE script. No duplicate deploy logic anywhere.
#
# Usage:
#   deploy-release.sh [--artifact /path/to.tar.zst | --manifest-url URL] [--force]
#   deploy-release.sh [--rollback-to <releaseId>]
#   deploy-release.sh [--offline /path/to.tar.zst]
#   deploy-release.sh --status
#   deploy-release.sh --list-releases
#   deploy-release.sh --cleanup
#   deploy-release.sh --clear-quarantine [releaseId]
#   deploy-release.sh --validate-artifact <path>
#
# Directory layout:
#   /opt/gwi-pos/
#   ├── releases/{releaseId}/       <- extracted artifacts
#   ├── current -> releases/X       <- atomic symlink
#   ├── previous -> releases/Y      <- explicit rollback target
#   ├── shared/
#   │   ├── .env
#   │   ├── logs/deploys/           <- structured JSON deploy logs
#   │   ├── data/
#   │   └── state/
#   │       ├── deploy-state.json   <- state machine
#   │       ├── bad-releases.json   <- quarantine
#   │       └── deploy-in-progress  <- maintenance mode flag
#   ├── cache/artifacts/            <- downloaded artifacts survive retries
#   ├── keys/gwi-pos-release.pub   <- minisign public key
#   └── deploy-release.sh          <- this script (also at current/public/scripts/)
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly BASE_DIR="/opt/gwi-pos"
readonly RELEASES_DIR="${BASE_DIR}/releases"
readonly CURRENT_LINK="${BASE_DIR}/current"
readonly PREVIOUS_LINK="${BASE_DIR}/previous"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly STATE_DIR="${SHARED_DIR}/state"
readonly DEPLOY_LOG_DIR="${SHARED_DIR}/logs/deploys"
readonly CACHE_DIR="${BASE_DIR}/cache/artifacts"
readonly KEYS_DIR="${BASE_DIR}/keys"
readonly PUB_KEY="${KEYS_DIR}/gwi-pos-release.pub"

readonly DEPLOY_STATE_FILE="${STATE_DIR}/deploy-state.json"
readonly BAD_RELEASES_FILE="${STATE_DIR}/bad-releases.json"
readonly MAINTENANCE_FLAG="${STATE_DIR}/deploy-in-progress"
readonly LOCKFILE="${STATE_DIR}/deploy.lock"
readonly INSTALLER_VERSION_FILE="${BASE_DIR}/installer-version"

readonly POS_PORT="${POS_PORT:-3005}"
readonly HEALTH_URL="http://localhost:${POS_PORT}/api/health/ready"
readonly SERVICE_NAME="thepasspos"

readonly LOCK_TIMEOUT_SECONDS=720  # 12 minutes
readonly SCHEMA_TIMEOUT_SECONDS=120
readonly READINESS_MAX_ATTEMPTS=30
readonly READINESS_INTERVAL=2
readonly READINESS_CONSECUTIVE_REQUIRED=3
readonly DOWNLOAD_RETRIES=3
readonly RETAIN_RELEASES=3
readonly RETAIN_SIZE_BYTES=$((2 * 1024 * 1024 * 1024))  # 2GB
readonly MIN_DISK_BYTES=$((2 * 1024 * 1024 * 1024))     # 2GB minimum
readonly MIN_RAM_MB=1536                                  # 1.5GB

readonly REQUIRED_FILES=(
    "server.js"
    "prisma/schema.prisma"
    "prisma/cli/prisma"
    "launcher.sh"
    "required-env.json"
)

# ---------------------------------------------------------------------------
# Global State
# ---------------------------------------------------------------------------
DEPLOY_ID=""
DEPLOY_START_EPOCH=""
DEPLOY_ERRORS=()
LOCK_FD=""
MANIFEST_URL=""
ARTIFACT_PATH=""
ARTIFACT_URL=""
RELEASE_ID=""
PREVIOUS_RELEASE_ID=""
FORCE=false
OFFLINE=false
DRY_RUN=false
CHECKSUM_RESULT="skipped"
SIGNATURE_RESULT="skipped"
PREFLIGHT_RESULT="skipped"
ENV_VALIDATION_RESULT="skipped"
SCHEMA_RESULT="skipped"
SCHEMA_FAILURE_CLASS="null"
RESTART_RESULT="skipped"
READINESS_RESULT="skipped"
ROLLBACK_RESULT="null"
ROLLBACK_READINESS_RESULT="null"
FINAL_STATUS="pending"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() { echo "[$(date -u +%FT%TZ)] DEPLOY: $*"; }
warn() { echo "[$(date -u +%FT%TZ)] DEPLOY WARNING: $*" >&2; }
err() {
    echo "[$(date -u +%FT%TZ)] DEPLOY ERROR: $*" >&2
    DEPLOY_ERRORS+=("$*")
}
fatal() {
    err "$*"
    FINAL_STATUS="failed"
    write_deploy_log
    release_lock
    remove_maintenance_mode
    exit 1
}

# ---------------------------------------------------------------------------
# UUID Generation
# ---------------------------------------------------------------------------
generate_uuid() {
    if [[ -f /proc/sys/kernel/random/uuid ]]; then
        cat /proc/sys/kernel/random/uuid
    elif command -v uuidgen &>/dev/null; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        # Fallback: construct from urandom
        od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}'
    fi
}

# ---------------------------------------------------------------------------
# JSON Helpers — prefer jq, fallback to printf
# ---------------------------------------------------------------------------
has_jq() { command -v jq &>/dev/null; }

json_get() {
    local file="$1" key="$2"
    if has_jq; then
        jq -r ".$key // empty" "$file" 2>/dev/null
    else
        # Crude extraction for simple keys — handles "key": "value" and "key": number
        sed -n 's/.*"'"$key"'"[[:space:]]*:[[:space:]]*"\?\([^",}]*\)"\?.*/\1/p' "$file" 2>/dev/null | head -1
    fi
}

json_array_contains() {
    local file="$1" value="$2"
    if has_jq; then
        jq -e "if type == \"array\" then any(. == \"$value\") else false end" "$file" 2>/dev/null && return 0
        return 1
    else
        grep -q "\"$value\"" "$file" 2>/dev/null
    fi
}

# Atomic JSON write: write to .tmp then mv
atomic_write() {
    local target="$1" content="$2"
    local tmpfile="${target}.tmp.$$"
    printf '%s\n' "$content" > "$tmpfile"
    mv -f "$tmpfile" "$target"
}

# ---------------------------------------------------------------------------
# State Machine
# ---------------------------------------------------------------------------
# States: pending -> downloaded -> verified -> extracted -> validated ->
#         migrated -> activated -> healthy
#         activated -> rolled_back -> (failed | rollback_failed)

set_state() {
    local new_state="$1"
    local release_id="${2:-$RELEASE_ID}"
    local now
    now="$(date -u +%FT%TZ)"

    local state_json
    state_json=$(cat <<SJEOF
{
  "state": "${new_state}",
  "releaseId": "${release_id}",
  "previousReleaseId": "${PREVIOUS_RELEASE_ID:-}",
  "updatedAt": "${now}",
  "deployId": "${DEPLOY_ID}"
}
SJEOF
)
    mkdir -p "$(dirname "$DEPLOY_STATE_FILE")"
    atomic_write "$DEPLOY_STATE_FILE" "$state_json"
    log "State -> ${new_state} (release: ${release_id})"
}

get_state() {
    if [[ -f "$DEPLOY_STATE_FILE" ]]; then
        json_get "$DEPLOY_STATE_FILE" "state"
    else
        echo "none"
    fi
}

get_current_release_id() {
    if [[ -L "$CURRENT_LINK" ]]; then
        basename "$(readlink -f "$CURRENT_LINK" 2>/dev/null)" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

get_previous_release_id() {
    if [[ -L "$PREVIOUS_LINK" ]]; then
        basename "$(readlink -f "$PREVIOUS_LINK" 2>/dev/null)" 2>/dev/null || echo ""
    else
        echo ""
    fi
}

# ---------------------------------------------------------------------------
# Lock Management
# ---------------------------------------------------------------------------
acquire_lock() {
    mkdir -p "$(dirname "$LOCKFILE")"

    # Check for stale lock with PID liveness
    if [[ -f "$LOCKFILE" ]]; then
        local lock_pid lock_epoch now_epoch elapsed
        lock_pid="$(head -1 "$LOCKFILE" 2>/dev/null || echo "")"
        lock_epoch="$(tail -1 "$LOCKFILE" 2>/dev/null || echo "0")"
        now_epoch="$(date +%s)"
        elapsed=$(( now_epoch - ${lock_epoch:-0} ))

        if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
            # PID is alive — NEVER break, even if old. A real long-running deploy must not be killed.
            err "Deploy already in progress (PID: $lock_pid, age: ${elapsed}s)"
            err "If this is stale, remove $LOCKFILE manually or use --force"
            exit 1
        else
            # PID is dead — safe to break if old enough
            if [[ $elapsed -ge $LOCK_TIMEOUT_SECONDS ]]; then
                warn "Removing stale lock from dead PID $lock_pid (age: ${elapsed}s)"
                rm -f "$LOCKFILE"
            else
                # PID dead but lock is recent — may be a crash. Break it.
                warn "Lock PID $lock_pid is dead (age: ${elapsed}s) — removing stale lock"
                rm -f "$LOCKFILE"
            fi
        fi
    fi

    # Use flock for atomic lock acquisition
    exec 200>"$LOCKFILE"
    if ! flock -n 200; then
        err "Failed to acquire deploy lock — another deploy may be starting"
        exit 1
    fi
    LOCK_FD=200

    # Write our PID and epoch for liveness checks
    printf '%s\n%s\n' "$$" "$(date +%s)" > "$LOCKFILE"
    log "Lock acquired (PID: $$)"
}

release_lock() {
    if [[ -n "$LOCK_FD" ]]; then
        flock -u "$LOCK_FD" 2>/dev/null || true
        exec 200>&- 2>/dev/null || true
        LOCK_FD=""
    fi
    rm -f "$LOCKFILE" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Maintenance Mode
# ---------------------------------------------------------------------------
set_maintenance_mode() {
    mkdir -p "$(dirname "$MAINTENANCE_FLAG")"
    printf '%s\n' "$(date -u +%FT%TZ)" > "$MAINTENANCE_FLAG"
    log "Maintenance mode ENABLED"
}

remove_maintenance_mode() {
    rm -f "$MAINTENANCE_FLAG" 2>/dev/null || true
    log "Maintenance mode DISABLED"
}

is_maintenance_mode() {
    [[ -f "$MAINTENANCE_FLAG" ]]
}

# ---------------------------------------------------------------------------
# Quarantine (Bad Releases)
# ---------------------------------------------------------------------------
init_quarantine() {
    if [[ ! -f "$BAD_RELEASES_FILE" ]]; then
        mkdir -p "$(dirname "$BAD_RELEASES_FILE")"
        atomic_write "$BAD_RELEASES_FILE" '{"quarantined":[]}'
    fi
}

is_quarantined() {
    local release_id="$1"
    init_quarantine
    if has_jq; then
        jq -e ".quarantined[] | select(.releaseId == \"$release_id\")" "$BAD_RELEASES_FILE" &>/dev/null
    else
        grep -q "\"$release_id\"" "$BAD_RELEASES_FILE" 2>/dev/null
    fi
}

quarantine_release() {
    local release_id="$1"
    local reason="${2:-health_check_failed}"
    local now
    now="$(date -u +%FT%TZ)"

    init_quarantine

    if has_jq; then
        local updated
        updated=$(jq \
            --arg rid "$release_id" \
            --arg reason "$reason" \
            --arg ts "$now" \
            '.quarantined += [{"releaseId": $rid, "reason": $reason, "quarantinedAt": $ts}]' \
            "$BAD_RELEASES_FILE")
        atomic_write "$BAD_RELEASES_FILE" "$updated"
    else
        # Fallback: rewrite with simple append
        local entry="{\"releaseId\":\"${release_id}\",\"reason\":\"${reason}\",\"quarantinedAt\":\"${now}\"}"
        local current
        current="$(cat "$BAD_RELEASES_FILE")"
        if echo "$current" | grep -q '"quarantined":\[\]'; then
            atomic_write "$BAD_RELEASES_FILE" "{\"quarantined\":[${entry}]}"
        else
            # Insert before closing ]
            local updated
            updated="$(echo "$current" | sed "s/\]}/,${entry}]}/")"
            atomic_write "$BAD_RELEASES_FILE" "$updated"
        fi
    fi
    log "Release $release_id QUARANTINED (reason: $reason)"
}

clear_quarantine() {
    local release_id="${1:-}"
    init_quarantine

    if [[ -z "$release_id" ]]; then
        atomic_write "$BAD_RELEASES_FILE" '{"quarantined":[]}'
        log "All quarantined releases cleared"
    else
        if has_jq; then
            local updated
            updated=$(jq --arg rid "$release_id" \
                '.quarantined |= map(select(.releaseId != $rid))' \
                "$BAD_RELEASES_FILE")
            atomic_write "$BAD_RELEASES_FILE" "$updated"
        else
            warn "Cannot selectively clear quarantine without jq — clearing all"
            atomic_write "$BAD_RELEASES_FILE" '{"quarantined":[]}'
        fi
        log "Release $release_id removed from quarantine"
    fi
}

# ---------------------------------------------------------------------------
# Environment Helpers
# ---------------------------------------------------------------------------
load_env() {
    local env_file="${SHARED_DIR}/.env"
    if [[ -f "$env_file" ]]; then
        # Source .env but protect current shell vars
        set -a
        # shellcheck source=/dev/null
        source "$env_file" 2>/dev/null || true
        set +a
    fi
}

get_venue_id() {
    load_env
    echo "${LOCATION_ID:-unknown}"
}

# ---------------------------------------------------------------------------
# Compression Detection
# ---------------------------------------------------------------------------
detect_compression() {
    local file="$1"
    local magic
    magic="$(od -A n -t x1 -N 4 "$file" 2>/dev/null | tr -d ' ')"

    case "$magic" in
        28b52ffd) echo "zstd" ;;
        1f8b*)    echo "gzip" ;;
        *)
            # Try file extension
            case "$file" in
                *.tar.zst|*.tar.zstd) echo "zstd" ;;
                *.tar.gz|*.tgz)       echo "gzip" ;;
                *.tar.xz)             echo "xz" ;;
                *.tar.bz2)            echo "bzip2" ;;
                *)                    echo "unknown" ;;
            esac
            ;;
    esac
}

# ---------------------------------------------------------------------------
# Preflight Checks
# ---------------------------------------------------------------------------
preflight_check_disk() {
    local required_bytes="${1:-$MIN_DISK_BYTES}"
    local avail_bytes

    avail_bytes="$(df -B1 "$BASE_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
    if [[ -z "$avail_bytes" ]]; then
        warn "Cannot determine available disk space — proceeding anyway"
        return 0
    fi

    if [[ "$avail_bytes" -lt "$required_bytes" ]]; then
        log "Low disk space ($(( avail_bytes / 1024 / 1024 ))MB available, need $(( required_bytes / 1024 / 1024 ))MB) — attempting cleanup first"
        do_cleanup
        # Re-check
        avail_bytes="$(df -B1 "$BASE_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
        if [[ "$avail_bytes" -lt "$required_bytes" ]]; then
            err "Insufficient disk space after cleanup: $(( avail_bytes / 1024 / 1024 ))MB available, need $(( required_bytes / 1024 / 1024 ))MB"
            return 1
        fi
    fi
    log "Disk space OK: $(( avail_bytes / 1024 / 1024 ))MB available"
    return 0
}

preflight_check_ram() {
    local avail_mb
    avail_mb="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")"

    if [[ "$avail_mb" -eq 0 ]]; then
        # /proc/meminfo not available (non-Linux or restricted)
        warn "Cannot determine available RAM — proceeding anyway"
        return 0
    fi

    if [[ "$avail_mb" -lt "$MIN_RAM_MB" ]]; then
        err "Insufficient RAM: ${avail_mb}MB available, need ${MIN_RAM_MB}MB"
        return 1
    fi
    log "RAM OK: ${avail_mb}MB available"
    return 0
}

preflight_check_db() {
    if command -v pg_isready &>/dev/null; then
        if ! pg_isready -q 2>/dev/null; then
            err "PostgreSQL is not ready — cannot deploy"
            return 1
        fi
        log "PostgreSQL: ready"
    else
        warn "pg_isready not found — skipping database preflight check"
    fi
    return 0
}

run_preflight() {
    local artifact_size="${1:-0}"
    local required_disk

    # Require max(2GB, artifactSize * 4)
    required_disk=$(( artifact_size * 4 ))
    if [[ "$required_disk" -lt "$MIN_DISK_BYTES" ]]; then
        required_disk="$MIN_DISK_BYTES"
    fi

    log "Running preflight checks..."

    local failed=false

    if ! preflight_check_disk "$required_disk"; then
        failed=true
    fi
    if ! preflight_check_ram; then
        failed=true
    fi
    if ! preflight_check_db; then
        failed=true
    fi

    if [[ "$failed" == "true" ]]; then
        PREFLIGHT_RESULT="fail"
        return 1
    fi

    PREFLIGHT_RESULT="pass"
    log "All preflight checks passed"
    return 0
}

# ---------------------------------------------------------------------------
# Manifest Handling
# ---------------------------------------------------------------------------
fetch_manifest() {
    local url="$1"
    local manifest_file="${CACHE_DIR}/manifest.json"
    local sig_file="${CACHE_DIR}/manifest.json.minisig"

    mkdir -p "$CACHE_DIR"

    # ALWAYS delete stale manifest before fetching — never serve cached versions.
    # Every deploy must get the latest manifest from the server.
    rm -f "$manifest_file" "$sig_file" 2>/dev/null

    # Add cache-busting param to bypass CDN/edge caches (Vercel, CloudFlare, etc.)
    local bust_url="${url}?_=$(date +%s)"

    log "Fetching manifest from $url (cache-bust)"
    if ! download_file_no_cache "$bust_url" "$manifest_file"; then
        # Retry without cache-bust in case the server doesn't accept query params
        if ! download_file_no_cache "$url" "$manifest_file"; then
            fatal "Failed to download manifest from $url"
        fi
    fi

    # Fetch detached signature and verify (fail-closed when infrastructure exists)
    if ! download_file_no_cache "${url}.minisig?_=$(date +%s)" "$sig_file" && ! download_file_no_cache "${url}.minisig" "$sig_file"; then
        if [[ -f "$PUB_KEY" ]] && command -v minisign &>/dev/null; then
            fatal "Manifest signature not available — cannot verify manifest integrity"
        else
            warn "Manifest signature not available and minisign not installed — skipping (transition period)"
        fi
    else
        if [[ -f "$PUB_KEY" ]] && command -v minisign &>/dev/null; then
            if ! minisign -Vm "$manifest_file" -p "$PUB_KEY" -x "$sig_file" 2>/dev/null; then
                fatal "Manifest signature verification FAILED"
            fi
            log "Manifest signature verified"
        else
            # Public key exists but minisign missing — try auto-install
            if command -v apt-get &>/dev/null; then
                log "minisign not installed — attempting auto-install for manifest verification..."
                apt-get install -y minisign &>/dev/null || true
            fi
            if command -v minisign &>/dev/null; then
                if ! minisign -Vm "$manifest_file" -p "$PUB_KEY" -x "$sig_file" 2>/dev/null; then
                    fatal "Manifest signature verification FAILED"
                fi
                log "Manifest signature verified (after auto-install)"
            else
                fatal "minisign required for manifest verification but could not be installed"
            fi
        fi
    fi

    # Extract fields from manifest
    RELEASE_ID="$(json_get "$manifest_file" "releaseId")"
    ARTIFACT_URL="$(json_get "$manifest_file" "artifactUrl")"

    if [[ -z "$RELEASE_ID" ]]; then
        fatal "Manifest missing required field: releaseId"
    fi
    if [[ -z "$ARTIFACT_URL" ]]; then
        fatal "Manifest missing required field: artifactUrl"
    fi

    # Resolve relative artifact URL against manifest base URL
    if [[ "$ARTIFACT_URL" == /* ]]; then
        # Relative path — resolve against the manifest URL's origin
        local base_origin
        base_origin="$(echo "$url" | sed 's|^\(https\?://[^/]*\).*|\1|')"
        ARTIFACT_URL="${base_origin}${ARTIFACT_URL}"
        log "Resolved artifact URL: $ARTIFACT_URL"
    fi

    log "Manifest parsed: releaseId=$RELEASE_ID"

    # Run compatibility gates from manifest
    check_manifest_compatibility "$manifest_file"
}

check_manifest_compatibility() {
    local manifest="$1"

    # Gate 1: artifactFormatVersion
    local format_version
    format_version="$(json_get "$manifest" "artifactFormatVersion")"
    if [[ -n "$format_version" ]] && [[ "$format_version" -gt 2 ]]; then
        fatal "Unsupported artifact format version: $format_version (max supported: 2). Update deploy-release.sh first."
    fi

    # Gate 2: minInstallerVersion
    local min_installer
    min_installer="$(json_get "$manifest" "minInstallerVersion")"
    if [[ -n "$min_installer" ]] && [[ -f "$INSTALLER_VERSION_FILE" ]]; then
        local current_installer
        current_installer="$(cat "$INSTALLER_VERSION_FILE" 2>/dev/null | tr -d '[:space:]')"
        if [[ -n "$current_installer" ]]; then
            if ! version_gte "$current_installer" "$min_installer"; then
                fatal "Installer too old: $current_installer < required $min_installer. Run installer update first."
            fi
        fi
    fi

    # Gate 3: supportedUbuntuVersions
    local supported_versions_file="${CACHE_DIR}/.supported-versions"
    if has_jq; then
        jq -r '.supportedUbuntuVersions[]? // empty' "$manifest" > "$supported_versions_file" 2>/dev/null || true
    fi
    if [[ -s "$supported_versions_file" ]] && command -v lsb_release &>/dev/null; then
        local codename
        codename="$(lsb_release -cs 2>/dev/null || echo "")"
        if [[ -n "$codename" ]] && ! grep -qx "$codename" "$supported_versions_file"; then
            fatal "Ubuntu codename '$codename' not in supported versions: $(cat "$supported_versions_file" | tr '\n' ', ')"
        fi
    fi
    rm -f "$supported_versions_file" 2>/dev/null || true

    # Gate 4: Node.js major version
    local required_node_major
    required_node_major="$(json_get "$manifest" "requiredNodeMajor")"
    if [[ -n "$required_node_major" ]]; then
        local current_node_major
        current_node_major="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
        if [[ -n "$current_node_major" ]]; then
            if [[ "$current_node_major" -ne "$required_node_major" ]]; then
                fatal "Node.js major version mismatch: have v${current_node_major}, need v${required_node_major}"
            fi
        fi
    fi
    local required_node_minor
    required_node_minor="$(json_get "$manifest" "requiredNodeMinor")"
    if [[ -n "$required_node_minor" ]]; then
        local current_node_minor
        current_node_minor="$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f2)"
        if [[ -n "$current_node_minor" ]] && [[ "$current_node_minor" -lt "$required_node_minor" ]]; then
            warn "Node.js minor version lower than recommended: have $(node -v), want >=${required_node_major}.${required_node_minor}"
        fi
    fi

    # Gate 5: compatibleSchemaVersions
    local compat_schema_file="${CACHE_DIR}/.compat-schema"
    if has_jq; then
        jq -r '.compatibleSchemaVersions[]? // empty' "$manifest" > "$compat_schema_file" 2>/dev/null || true
    fi
    if [[ -s "$compat_schema_file" ]]; then
        local current_schema
        current_schema="$(get_current_schema_version)"
        if [[ -n "$current_schema" ]] && ! grep -qx "$current_schema" "$compat_schema_file"; then
            fatal "Current schema version '$current_schema' not in compatible versions: $(cat "$compat_schema_file" | tr '\n' ', ')"
        fi
    fi
    rm -f "$compat_schema_file" 2>/dev/null || true

    # Gate 6: compatibleFromReleases — reject if current release is not in the list
    local compat_releases_file="${CACHE_DIR}/.compat-releases"
    if has_jq; then
        jq -r '.compatibleFromReleases[]? // empty' "$manifest" > "$compat_releases_file" 2>/dev/null || true
    fi
    if [[ -s "$compat_releases_file" ]]; then
        local current_release_id
        current_release_id="$(get_current_release_id)"
        if [[ -n "$current_release_id" ]] && ! grep -qx "$current_release_id" "$compat_releases_file"; then
            # Also check version-only match (releaseId may include SHA)
            local current_version
            current_version="$(json_get "${CURRENT_LINK}/package.json" "version" 2>/dev/null)" || true
            if [[ -n "$current_version" ]] && ! grep -q "$current_version" "$compat_releases_file"; then
                fatal "Current release '$current_release_id' (v$current_version) not in compatibleFromReleases: $(cat "$compat_releases_file" | tr '\n' ', ')"
            fi
        fi
    fi
    rm -f "$compat_releases_file" 2>/dev/null || true

    log "Manifest compatibility gates passed"
}

get_current_schema_version() {
    # Read from current release if available
    local schema_file="${CURRENT_LINK}/version-contract.json"
    if [[ -f "$schema_file" ]]; then
        json_get "$schema_file" "schemaVersion"
    else
        echo ""
    fi
}

version_gte() {
    # Returns 0 if $1 >= $2 (semver comparison)
    local v1="$1" v2="$2"
    if [[ "$v1" == "$v2" ]]; then return 0; fi

    local v1_major v1_minor v1_patch v2_major v2_minor v2_patch
    IFS='.' read -r v1_major v1_minor v1_patch <<< "$v1"
    IFS='.' read -r v2_major v2_minor v2_patch <<< "$v2"

    v1_major="${v1_major:-0}"; v1_minor="${v1_minor:-0}"; v1_patch="${v1_patch:-0}"
    v2_major="${v2_major:-0}"; v2_minor="${v2_minor:-0}"; v2_patch="${v2_patch:-0}"

    if [[ "$v1_major" -gt "$v2_major" ]]; then return 0; fi
    if [[ "$v1_major" -lt "$v2_major" ]]; then return 1; fi
    if [[ "$v1_minor" -gt "$v2_minor" ]]; then return 0; fi
    if [[ "$v1_minor" -lt "$v2_minor" ]]; then return 1; fi
    if [[ "$v1_patch" -ge "$v2_patch" ]]; then return 0; fi
    return 1
}

# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------
# Download with explicit no-cache headers — used for manifest fetches.
# Prevents Vercel edge cache, CDN cache, and any intermediate proxy from serving stale data.
download_file_no_cache() {
    local url="$1" dest="$2"
    log "Downloading (no-cache): $url"
    if curl -fSL --connect-timeout 30 --max-time 60 --retry 2 \
        -H "Cache-Control: no-cache, no-store, must-revalidate" \
        -H "Pragma: no-cache" \
        -o "$dest" "$url" 2>/dev/null; then
        return 0
    fi
    return 1
}

download_file() {
    local url="$1" dest="$2"
    local attempt=0 max_retries="${3:-$DOWNLOAD_RETRIES}"

    while [[ $attempt -lt $max_retries ]]; do
        attempt=$(( attempt + 1 ))

        # Try axel first (parallel download)
        if command -v axel &>/dev/null; then
            log "Downloading (axel, attempt $attempt/$max_retries): $url"
            if axel -n 4 -q -o "$dest" "$url" 2>/dev/null; then
                return 0
            fi
            warn "axel download failed, falling back to curl"
        fi

        # curl with resume support
        log "Downloading (curl, attempt $attempt/$max_retries): $url"
        if curl -fSL -C - --connect-timeout 30 --max-time 600 --retry 2 -o "$dest" "$url" 2>/dev/null; then
            return 0
        fi

        if [[ $attempt -lt $max_retries ]]; then
            local backoff=$(( 2 ** attempt ))
            warn "Download attempt $attempt failed — retrying in ${backoff}s"
            sleep "$backoff"
        fi
    done

    err "Download failed after $max_retries attempts: $url"
    return 1
}

download_artifact() {
    local url="$1"
    local dest="${CACHE_DIR}/${RELEASE_ID}.tar.zst"

    mkdir -p "$CACHE_DIR"

    # Skip if already cached and same size
    if [[ -f "$dest" ]]; then
        log "Artifact already cached at $dest — verifying"
        ARTIFACT_PATH="$dest"
        return 0
    fi

    if ! download_file "$url" "$dest"; then
        fatal "Failed to download artifact from $url"
    fi

    ARTIFACT_PATH="$dest"
    log "Artifact downloaded: $dest ($(du -sh "$dest" 2>/dev/null | cut -f1))"
}

# ---------------------------------------------------------------------------
# Verification (SHA256 + Minisign)
# ---------------------------------------------------------------------------
verify_checksum() {
    local artifact="$1"
    local expected_sha256="${2:-}"

    if [[ -z "$expected_sha256" ]]; then
        # Try to get from manifest or .sha256 sidecar
        local sha_file="${artifact}.sha256"
        if [[ -f "$sha_file" ]]; then
            expected_sha256="$(awk '{print $1}' "$sha_file" 2>/dev/null)"
        fi
    fi

    if [[ -z "$expected_sha256" ]]; then
        warn "No expected SHA256 checksum available — skipping checksum verification"
        CHECKSUM_RESULT="skipped"
        return 0
    fi

    local actual_sha256
    actual_sha256="$(sha256sum "$artifact" 2>/dev/null | awk '{print $1}')"

    if [[ -z "$actual_sha256" ]]; then
        err "Failed to compute SHA256 for $artifact"
        CHECKSUM_RESULT="fail"
        return 1
    fi

    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
        err "SHA256 mismatch for $artifact"
        err "  Expected: $expected_sha256"
        err "  Actual:   $actual_sha256"
        CHECKSUM_RESULT="fail"
        return 1
    fi

    log "SHA256 verified: $actual_sha256"
    CHECKSUM_RESULT="pass"
    return 0
}

verify_signature() {
    local artifact="$1"
    local sig_file="${artifact}.minisig"

    # Fail-closed: if signing infrastructure exists, verification is MANDATORY.
    # Only skip if minisign was never installed (transition period for old NUCs).
    if [[ ! -f "$PUB_KEY" ]]; then
        if [[ "$FORCE" == "true" ]]; then
            warn "Public key not found at $PUB_KEY — skipping (--force)"
            SIGNATURE_RESULT="skipped"
            return 0
        fi
        err "Public key not found at $PUB_KEY"
        err "Run installer to bootstrap keys, or use --force to skip verification"
        SIGNATURE_RESULT="fail"
        return 1
    fi

    if ! command -v minisign &>/dev/null; then
        # Public key exists but minisign is not installed — attempt auto-install
        if command -v apt-get &>/dev/null; then
            log "minisign not installed — attempting auto-install..."
            if apt-get install -y minisign &>/dev/null; then
                log "minisign installed successfully"
            else
                err "Failed to install minisign. Signature verification cannot proceed."
                err "Install manually: apt-get install -y minisign"
                SIGNATURE_RESULT="fail"
                return 1
            fi
        else
            err "minisign not installed and cannot auto-install. Signature verification required."
            SIGNATURE_RESULT="fail"
            return 1
        fi
    fi

    if [[ ! -f "$sig_file" ]]; then
        # Try downloading the signature
        if [[ -n "$ARTIFACT_URL" ]]; then
            download_file "${ARTIFACT_URL}.minisig" "$sig_file" 1 || true
        fi
    fi

    if [[ ! -f "$sig_file" ]]; then
        err "No signature file found for artifact — cannot verify integrity"
        err "Artifact may be unsigned or signature download failed"
        SIGNATURE_RESULT="fail"
        return 1
    fi

    if ! minisign -Vm "$artifact" -p "$PUB_KEY" -x "$sig_file" 2>/dev/null; then
        err "Minisign signature verification FAILED for $artifact"
        SIGNATURE_RESULT="fail"
        return 1
    fi

    log "Minisign signature verified"
    SIGNATURE_RESULT="pass"
    return 0
}

verify_artifact() {
    local artifact="$1"
    local manifest_checksum="${2:-}"

    log "Verifying artifact: $artifact"

    if ! verify_checksum "$artifact" "$manifest_checksum"; then
        return 1
    fi

    if ! verify_signature "$artifact"; then
        return 1
    fi

    set_state "verified"
    return 0
}

# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
extract_artifact() {
    local artifact="$1"
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
    local temp_extract="${RELEASES_DIR}/.extract-${RELEASE_ID}-$$"

    if [[ -d "$release_dir" ]]; then
        if [[ "$FORCE" == "true" ]]; then
            log "Release directory exists — removing (--force)"
            rm -rf "$release_dir"
        else
            log "Release directory already exists at $release_dir — skipping extraction"
            set_state "extracted"
            return 0
        fi
    fi

    mkdir -p "$temp_extract"

    local compression
    compression="$(detect_compression "$artifact")"

    log "Extracting artifact ($compression): $artifact -> $temp_extract"

    # Security: check for path traversal and absolute paths BEFORE extracting
    local tar_list_cmd="tar"
    case "$compression" in
        zstd)
            if command -v zstd &>/dev/null; then
                tar_list_cmd="tar --zstd"
            else
                # Fallback: pipe through zstdcat
                tar_list_cmd="zstdcat '$artifact' | tar"
            fi
            ;;
        gzip)  tar_list_cmd="tar --gzip" ;;
        xz)    tar_list_cmd="tar --xz" ;;
        bzip2) tar_list_cmd="tar --bzip2" ;;
        *)     tar_list_cmd="tar" ;;  # Let tar auto-detect
    esac

    # Security scan: reject path traversal and absolute paths
    local unsafe_paths
    case "$compression" in
        zstd)
            if command -v zstd &>/dev/null; then
                unsafe_paths="$(tar --zstd -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            else
                unsafe_paths="$(zstdcat "$artifact" 2>/dev/null | tar -tf - 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            fi
            ;;
        gzip)
            unsafe_paths="$(tar --gzip -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            ;;
        *)
            unsafe_paths="$(tar -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            ;;
    esac

    if [[ -n "$unsafe_paths" ]]; then
        rm -rf "$temp_extract"
        fatal "SECURITY: Artifact contains path traversal or absolute paths — REJECTED:\n$unsafe_paths"
    fi

    # Extract
    case "$compression" in
        zstd)
            if command -v zstd &>/dev/null; then
                tar --zstd -xf "$artifact" -C "$temp_extract" --no-same-owner 2>&1 || {
                    rm -rf "$temp_extract"
                    fatal "Extraction failed (zstd)"
                }
            else
                zstdcat "$artifact" | tar -xf - -C "$temp_extract" --no-same-owner 2>&1 || {
                    rm -rf "$temp_extract"
                    fatal "Extraction failed (zstd pipe)"
                }
            fi
            ;;
        gzip)
            tar --gzip -xf "$artifact" -C "$temp_extract" --no-same-owner 2>&1 || {
                rm -rf "$temp_extract"
                fatal "Extraction failed (gzip)"
            }
            ;;
        xz)
            tar --xz -xf "$artifact" -C "$temp_extract" --no-same-owner 2>&1 || {
                rm -rf "$temp_extract"
                fatal "Extraction failed (xz)"
            }
            ;;
        *)
            tar -xf "$artifact" -C "$temp_extract" --no-same-owner 2>&1 || {
                rm -rf "$temp_extract"
                fatal "Extraction failed (auto-detect)"
            }
            ;;
    esac

    # Handle tarbomb: if extraction produced a single top-level directory, use its contents
    local top_level_count
    top_level_count="$(ls -1 "$temp_extract" | wc -l)"

    if [[ "$top_level_count" -eq 1 ]]; then
        local inner_dir
        inner_dir="$(ls -1 "$temp_extract")"
        if [[ -d "${temp_extract}/${inner_dir}" ]]; then
            # Single directory inside — validate name matches releaseId
            if [[ -n "$RELEASE_ID" ]] && [[ "$inner_dir" != "$RELEASE_ID" ]]; then
                rm -rf "$temp_extract"
                fatal "Top-level directory name '$inner_dir' does not match releaseId '$RELEASE_ID' — artifact may be corrupt or tampered"
            fi
            # Unwrap
            mv "${temp_extract}/${inner_dir}" "$release_dir"
            rm -rf "$temp_extract"
            log "Extracted single directory '${inner_dir}' as release root"
        else
            # Single file — that's a tarbomb of a different kind
            mv "$temp_extract" "$release_dir"
        fi
    elif [[ "$top_level_count" -eq 0 ]]; then
        rm -rf "$temp_extract"
        fatal "Extraction produced no files — artifact may be empty or corrupted"
    else
        # Multiple top-level entries (standard layout from build-nuc-artifact.sh)
        # Our build uses `tar -C staging .` so all files are at root level
        mv "$temp_extract" "$release_dir"
    fi

    # Validate release directory has expected structure (catches corrupted/wrong artifacts)
    if [[ ! -f "$release_dir/server.js" ]] && [[ ! -f "$release_dir/launcher.sh" ]]; then
        rm -rf "$release_dir"
        fatal "Extracted artifact does not contain expected release structure (no server.js or launcher.sh)"
    fi

    log "Extracted to $release_dir ($(du -sh "$release_dir" 2>/dev/null | cut -f1))"
    set_state "extracted"
    return 0
}

# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------
set_permissions() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"

    log "Setting ownership and permissions on $release_dir"
    chown -R gwipos:gwipos "$release_dir" 2>/dev/null || {
        warn "chown failed — user 'gwipos' may not exist. Attempting with current user."
    }
    chmod -R u+rwX,g+rX,o-rwx "$release_dir" 2>/dev/null || {
        warn "chmod failed on $release_dir"
    }

    # Ensure launcher.sh and prisma CLI are executable
    chmod +x "${release_dir}/launcher.sh" 2>/dev/null || true
    chmod +x "${release_dir}/prisma/cli/prisma" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
validate_required_files() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
    local missing=()

    for f in "${REQUIRED_FILES[@]}"; do
        if [[ ! -f "${release_dir}/${f}" ]]; then
            missing+=("$f")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        err "Missing required files in release: ${missing[*]}"
        return 1
    fi

    log "All required files present: ${REQUIRED_FILES[*]}"
    return 0
}

validate_checksums_txt() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
    local checksums_file="${release_dir}/checksums.txt"

    if [[ ! -f "$checksums_file" ]]; then
        warn "No checksums.txt in release — skipping internal checksum validation"
        return 0
    fi

    log "Validating internal checksums..."
    local failed=0
    local checked=0

    while IFS= read -r line; do
        # Skip empty lines and comments
        [[ -z "$line" ]] && continue
        [[ "$line" =~ ^# ]] && continue

        local expected_hash file_path
        # shasum format: "hash  filename" (two spaces). Filename may contain spaces.
        expected_hash="${line%% *}"
        file_path="${line#*  }"

        # Strip leading ./ or /
        file_path="${file_path#./}"
        file_path="${file_path#/}"

        local full_path="${release_dir}/${file_path}"
        if [[ ! -f "$full_path" ]]; then
            warn "checksums.txt references missing file: $file_path"
            failed=$(( failed + 1 ))
            continue
        fi

        local actual_hash
        actual_hash="$(sha256sum "$full_path" 2>/dev/null | awk '{print $1}')"
        if [[ "$actual_hash" != "$expected_hash" ]]; then
            err "Checksum mismatch: $file_path"
            err "  Expected: $expected_hash"
            err "  Actual:   $actual_hash"
            failed=$(( failed + 1 ))
        fi
        checked=$(( checked + 1 ))
    done < "$checksums_file"

    if [[ $failed -gt 0 ]]; then
        err "$failed/$checked internal checksums FAILED"
        return 1
    fi

    log "Internal checksums verified: $checked files OK"
    return 0
}

validate_env() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
    local required_env_file="${release_dir}/required-env.json"
    local env_file="${SHARED_DIR}/.env"

    if [[ ! -f "$required_env_file" ]]; then
        warn "No required-env.json found — skipping env validation"
        ENV_VALIDATION_RESULT="skipped"
        return 0
    fi

    if [[ ! -f "$env_file" ]]; then
        err "Shared .env file not found at $env_file"
        ENV_VALIDATION_RESULT="fail"
        return 1
    fi

    log "Validating .env against required-env.json..."
    local errors=()

    if has_jq; then
        # Parse required-env.json format: {"required": [{"key":"X","format":"regex","description":"..."}]}
        local entries
        entries="$(jq -r '.required[]? | "\(.key)\t\(.format // "")\t\(.description // "")"' "$required_env_file" 2>/dev/null)" || entries=""

        while IFS=$'\t' read -r var_key var_format var_desc; do
            [[ -z "$var_key" ]] && continue
            local var_value
            var_value="$(grep "^${var_key}=" "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^["'"'"']//;s/["'"'"']$//')"

            if [[ -z "$var_value" ]]; then
                errors+=("FATAL: missing $var_key — $var_desc")
            elif [[ -n "$var_format" ]] && ! echo "$var_value" | grep -qE "$var_format" 2>/dev/null; then
                errors+=("WARN: invalid $var_key — expected pattern: $var_format (got: ${var_value:0:30}...)")
            fi
        done <<< "$entries"

        # Check deprecated keys
        local deprecated
        deprecated="$(jq -r '.deprecated[]? | "\(.key)\t\(.replacement // "")\t\(.removeAfter // "")"' "$required_env_file" 2>/dev/null)" || deprecated=""
        while IFS=$'\t' read -r dep_key dep_replacement dep_remove; do
            [[ -z "$dep_key" ]] && continue
            if grep -q "^${dep_key}=" "$env_file" 2>/dev/null; then
                local msg="WARN: deprecated $dep_key"
                [[ -n "$dep_replacement" ]] && msg="$msg — use $dep_replacement instead"
                [[ -n "$dep_remove" ]] && msg="$msg (removing in $dep_remove)"
                errors+=("$msg")
            fi
        done <<< "$deprecated"
    else
        # Fallback without jq: check key presence only
        local var_list
        var_list="$(grep -oE '"key"\s*:\s*"[A-Z_][A-Z0-9_]*"' "$required_env_file" 2>/dev/null | grep -oE '[A-Z_][A-Z0-9_]*')"
        while IFS= read -r var_name; do
            [[ -z "$var_name" ]] && continue
            if ! grep -q "^${var_name}=" "$env_file" 2>/dev/null; then
                errors+=("FATAL: missing $var_name")
            fi
        done <<< "$var_list"
    fi

    # Separate fatals from warnings
    local fatals=0
    for e in "${errors[@]}"; do
        if [[ "$e" == FATAL:* ]]; then
            err "$e"
            fatals=$(( fatals + 1 ))
        else
            warn "$e"
        fi
    done

    if [[ $fatals -gt 0 ]]; then
        err ""
        err "$fatals required env var(s) missing. Add them to $env_file before deploying."
        ENV_VALIDATION_RESULT="fail"
        return 1
    fi

    log "Environment validation passed (${#errors[@]} warnings)"
    ENV_VALIDATION_RESULT="pass"
    return 0
}

run_validation() {
    log "Validating release ${RELEASE_ID}..."

    if ! validate_required_files; then
        return 1
    fi

    if ! validate_checksums_txt; then
        return 1
    fi

    if ! validate_env; then
        return 1
    fi

    set_state "validated"
    return 0
}

# ---------------------------------------------------------------------------
# Symlink Wiring
# ---------------------------------------------------------------------------
wire_symlinks() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"

    log "Wiring shared symlinks..."

    # .env -> ../../shared/.env (relative so it works regardless of mount)
    ln -sfn "../../shared/.env" "${release_dir}/.env"

    # logs -> ../../shared/logs
    ln -sfn "../../shared/logs" "${release_dir}/logs" 2>/dev/null || true

    log "Symlinks wired: .env, logs"
}

# ---------------------------------------------------------------------------
# Schema Migration
# ---------------------------------------------------------------------------
run_schema_step() {
    local release_dir="${RELEASES_DIR}/${RELEASE_ID}"
    local prisma_cli="${release_dir}/prisma/cli/prisma"

    log "Running schema migration step (timeout: ${SCHEMA_TIMEOUT_SECONDS}s)..."

    # Ensure .env is available for prisma
    export DOTENV_CONFIG_PATH="${SHARED_DIR}/.env"

    local schema_failed=false
    local failure_class=""

    # Step 1: prisma db push (schema sync)
    # The bundled Prisma CLI needs NODE_PATH to find @prisma/engines in its own directory.
    # Also set PRISMA_SCHEMA_ENGINE_BINARY to the bundled schema engine.
    local prisma_cli_dir="${release_dir}/prisma/cli"
    local schema_engine="${prisma_cli_dir}/schema-engine-rhel-openssl-3.0.x"
    if [[ ! -f "$schema_engine" ]]; then
        schema_engine="$(find "$prisma_cli_dir" -name 'schema-engine-*' -type f 2>/dev/null | head -1)"
    fi

    if [[ -f "$prisma_cli" ]]; then
        log "Running: prisma db push --skip-generate (expand-safe only, NO --accept-data-loss)"
        if ! timeout "$SCHEMA_TIMEOUT_SECONDS" \
            env DATABASE_URL="$(grep '^DATABASE_URL=' "${SHARED_DIR}/.env" 2>/dev/null | cut -d= -f2-)" \
                NODE_PATH="${prisma_cli_dir}/node_modules:${prisma_cli_dir}" \
                PRISMA_SCHEMA_ENGINE_BINARY="${schema_engine:-}" \
                PRISMA_QUERY_ENGINE_LIBRARY="${prisma_cli_dir}/libquery_engine-rhel-openssl-3.0.x.so.node" \
            node "$prisma_cli" db push --skip-generate --schema="${release_dir}/prisma/schema.prisma" 2>&1 | tee -a "${DEPLOY_LOG_DIR}/schema-${RELEASE_ID}.log"; then

            local exit_code=$?
            if [[ $exit_code -eq 124 ]]; then
                failure_class="schema_timeout"
                err "Schema push timed out after ${SCHEMA_TIMEOUT_SECONDS}s"
            else
                failure_class="schema_push_failed"
                err "Schema push failed with exit code $exit_code"
            fi
            schema_failed=true
        fi
    else
        warn "Prisma CLI not found or not executable at $prisma_cli — skipping schema push"
    fi

    # Step 2: nuc-pre-migrate.js (custom migrations)
    if [[ "$schema_failed" == "false" ]]; then
        local migrate_script="${release_dir}/scripts/nuc-pre-migrate.js"
        if [[ -f "$migrate_script" ]]; then
            log "Running: nuc-pre-migrate.js"
            if ! timeout "$SCHEMA_TIMEOUT_SECONDS" \
                env DATABASE_URL="$(grep '^DATABASE_URL=' "${SHARED_DIR}/.env" 2>/dev/null | cut -d= -f2-)" \
                node "$migrate_script" 2>&1 | tee -a "${DEPLOY_LOG_DIR}/schema-${RELEASE_ID}.log"; then

                local exit_code=$?
                if [[ $exit_code -eq 124 ]]; then
                    failure_class="post_migrate_timeout"
                    err "Migration script timed out after ${SCHEMA_TIMEOUT_SECONDS}s"
                else
                    failure_class="post_migrate_failed"
                    err "Migration script failed with exit code $exit_code"
                fi
                schema_failed=true
            fi
        else
            log "No nuc-pre-migrate.js found — skipping custom migrations"
        fi
    fi

    if [[ "$schema_failed" == "true" ]]; then
        SCHEMA_RESULT="fail"
        SCHEMA_FAILURE_CLASS="\"$failure_class\""

        # Reclassify based on log content (more specific than exit code alone)
        local schema_log="${DEPLOY_LOG_DIR}/schema-${RELEASE_ID}.log"
        if grep -qi "connection refused\|ECONNREFUSED\|could not connect\|no pg_hba.conf" "$schema_log" 2>/dev/null; then
            SCHEMA_FAILURE_CLASS="\"schema_connection_failed\""
        elif grep -qi "destructive changes\|data loss\|cannot be executed\|incompatible" "$schema_log" 2>/dev/null; then
            SCHEMA_FAILURE_CLASS="\"schema_incompatible\""
        fi
        return 1
    fi

    SCHEMA_RESULT="pass"
    set_state "migrated"
    log "Schema step completed successfully"
    return 0
}

# ---------------------------------------------------------------------------
# Atomic Symlink Swap
# ---------------------------------------------------------------------------
swap_symlinks() {
    log "Performing atomic symlink swap..."

    # Save previous release
    if [[ -L "$CURRENT_LINK" ]]; then
        local current_target
        current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null)"
        PREVIOUS_RELEASE_ID="$(basename "$current_target" 2>/dev/null)"

        # Update previous symlink
        local temp_prev="${PREVIOUS_LINK}.tmp.$$"
        ln -sfn "$current_target" "$temp_prev"
        mv -Tf "$temp_prev" "$PREVIOUS_LINK" 2>/dev/null || {
            # mv -T not available on all systems
            rm -f "$PREVIOUS_LINK" 2>/dev/null || true
            mv -f "$temp_prev" "$PREVIOUS_LINK"
        }
        log "Previous symlink updated: $PREVIOUS_RELEASE_ID"
    fi

    # Atomic swap of current symlink
    local new_target="${RELEASES_DIR}/${RELEASE_ID}"
    local temp_current="${CURRENT_LINK}.tmp.$$"
    ln -sfn "$new_target" "$temp_current"
    mv -Tf "$temp_current" "$CURRENT_LINK" 2>/dev/null || {
        rm -f "$CURRENT_LINK" 2>/dev/null || true
        mv -f "$temp_current" "$CURRENT_LINK"
    }

    log "Current symlink swapped: $RELEASE_ID"
}

# ---------------------------------------------------------------------------
# Service Restart
# ---------------------------------------------------------------------------
restart_service() {
    log "Restarting $SERVICE_NAME..."

    if ! systemctl restart "$SERVICE_NAME" 2>&1; then
        err "systemctl restart $SERVICE_NAME failed"
        RESTART_RESULT="fail"
        return 1
    fi

    RESTART_RESULT="pass"
    set_state "activated"
    log "$SERVICE_NAME restart initiated"
    return 0
}

# ---------------------------------------------------------------------------
# Readiness Check
# ---------------------------------------------------------------------------
check_readiness() {
    local max_attempts="${1:-$READINESS_MAX_ATTEMPTS}"
    local interval="${2:-$READINESS_INTERVAL}"
    local consecutive_required="${3:-$READINESS_CONSECUTIVE_REQUIRED}"
    local consecutive_ok=0
    local attempt=0

    log "Waiting for readiness: $max_attempts attempts, ${interval}s apart, need $consecutive_required consecutive"

    while [[ $attempt -lt $max_attempts ]]; do
        attempt=$(( attempt + 1 ))

        local http_code
        http_code="$(curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 5 "$HEALTH_URL" 2>/dev/null)" || http_code="000"

        if [[ "$http_code" == "200" ]]; then
            consecutive_ok=$(( consecutive_ok + 1 ))
            log "Readiness check $attempt/$max_attempts: OK ($consecutive_ok/$consecutive_required consecutive)"

            if [[ $consecutive_ok -ge $consecutive_required ]]; then
                log "Readiness confirmed: $consecutive_required consecutive successes"
                return 0
            fi
        else
            if [[ $consecutive_ok -gt 0 ]]; then
                warn "Readiness check $attempt/$max_attempts: FAIL (HTTP $http_code) — resetting consecutive counter"
            else
                log "Readiness check $attempt/$max_attempts: waiting (HTTP $http_code)"
            fi
            consecutive_ok=0
        fi

        sleep "$interval"
    done

    err "Readiness check failed after $max_attempts attempts"
    return 1
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
do_rollback() {
    local target_release="${1:-}"

    if [[ -z "$target_release" ]]; then
        # Default: roll back to previous
        target_release="$(get_previous_release_id)"
    fi

    if [[ -z "$target_release" ]]; then
        err "No rollback target available — no previous release found"
        ROLLBACK_RESULT="fail"
        return 1
    fi

    local target_dir="${RELEASES_DIR}/${target_release}"
    if [[ ! -d "$target_dir" ]]; then
        err "Rollback target directory does not exist: $target_dir"
        ROLLBACK_RESULT="fail"
        return 1
    fi

    log "Rolling back to release: $target_release"

    # Swap current to target
    local temp_current="${CURRENT_LINK}.tmp.$$"
    ln -sfn "$target_dir" "$temp_current"
    mv -Tf "$temp_current" "$CURRENT_LINK" 2>/dev/null || {
        rm -f "$CURRENT_LINK" 2>/dev/null || true
        mv -f "$temp_current" "$CURRENT_LINK"
    }

    # Restart service
    if ! systemctl restart "$SERVICE_NAME" 2>&1; then
        err "Service restart failed during rollback"
        ROLLBACK_RESULT="fail"
        set_state "rollback_failed" "$target_release"
        return 1
    fi

    set_state "rolled_back" "$target_release"

    # Verify rollback readiness (fewer attempts — we need to know fast)
    log "Verifying rollback readiness..."
    if check_readiness 15 2 3; then
        ROLLBACK_RESULT="pass"
        ROLLBACK_READINESS_RESULT="pass"
        log "Rollback successful — now running release: $target_release"
        return 0
    else
        ROLLBACK_READINESS_RESULT="fail"
        err "Rollback readiness check ALSO FAILED"
        set_state "rollback_failed" "$target_release"
        ROLLBACK_RESULT="fail"
        return 1
    fi
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
do_cleanup() {
    log "Running cleanup..."

    local current_id previous_id
    current_id="$(get_current_release_id)"
    previous_id="$(get_previous_release_id)"

    # List all releases sorted by modification time (oldest first)
    if [[ ! -d "$RELEASES_DIR" ]]; then
        log "No releases directory — nothing to clean"
        return 0
    fi

    local all_releases=()
    local total_size=0

    while IFS= read -r release_path; do
        [[ -z "$release_path" ]] && continue
        local rid
        rid="$(basename "$release_path")"
        all_releases+=("$rid")
    done < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null || true)

    local keep_count=0
    local removed=0

    for rid in "${all_releases[@]}"; do
        local release_path="${RELEASES_DIR}/${rid}"

        # Never remove current or previous
        if [[ "$rid" == "$current_id" ]] || [[ "$rid" == "$previous_id" ]]; then
            local sz
            sz="$(du -sb "$release_path" 2>/dev/null | cut -f1)"
            total_size=$(( total_size + ${sz:-0} ))
            keep_count=$(( keep_count + 1 ))
            continue
        fi

        keep_count=$(( keep_count + 1 ))

        if [[ $keep_count -gt $RETAIN_RELEASES ]]; then
            log "Removing old release: $rid"
            rm -rf "$release_path"
            removed=$(( removed + 1 ))
        else
            local sz
            sz="$(du -sb "$release_path" 2>/dev/null | cut -f1)"
            total_size=$(( total_size + ${sz:-0} ))

            # Also enforce size limit
            if [[ $total_size -gt $RETAIN_SIZE_BYTES ]]; then
                log "Size limit exceeded — removing release: $rid"
                rm -rf "$release_path"
                local sz_removed
                sz_removed="$(du -sb "$release_path" 2>/dev/null | cut -f1)"  # Already removed, will be 0
                removed=$(( removed + 1 ))
            fi
        fi
    done

    # Clean cached artifacts (keep only current release's artifact)
    if [[ -d "$CACHE_DIR" ]]; then
        local cached_removed=0
        for cached in "${CACHE_DIR}"/*.tar.*; do
            [[ -f "$cached" ]] || continue
            local cached_name
            cached_name="$(basename "$cached")"
            if [[ -n "$current_id" ]] && [[ "$cached_name" == "${current_id}."* ]]; then
                continue
            fi
            rm -f "$cached"
            cached_removed=$(( cached_removed + 1 ))
        done
        [[ $cached_removed -gt 0 ]] && log "Removed $cached_removed cached artifacts"
    fi

    # Clean temp extraction directories
    rm -rf "${RELEASES_DIR}"/.extract-* 2>/dev/null || true

    log "Cleanup complete: removed $removed releases"
}

# ---------------------------------------------------------------------------
# Deploy Log
# ---------------------------------------------------------------------------
write_deploy_log() {
    mkdir -p "$DEPLOY_LOG_DIR"

    local now
    now="$(date -u +%FT%TZ)"
    local duration_ms=0
    if [[ -n "$DEPLOY_START_EPOCH" ]]; then
        local now_epoch
        now_epoch="$(date +%s)"
        duration_ms=$(( (now_epoch - DEPLOY_START_EPOCH) * 1000 ))
    fi

    local venue_id
    venue_id="$(get_venue_id)"
    local hostname_val
    hostname_val="$(hostname 2>/dev/null || echo "unknown")"

    # Build errors array
    local errors_json="[]"
    if [[ ${#DEPLOY_ERRORS[@]} -gt 0 ]]; then
        if has_jq; then
            errors_json="$(printf '%s\n' "${DEPLOY_ERRORS[@]}" | jq -R . | jq -s .)"
        else
            local err_items=""
            for e in "${DEPLOY_ERRORS[@]}"; do
                # Escape quotes in error messages
                local escaped="${e//\"/\\\"}"
                if [[ -n "$err_items" ]]; then
                    err_items="${err_items},\"${escaped}\""
                else
                    err_items="\"${escaped}\""
                fi
            done
            errors_json="[${err_items}]"
        fi
    fi

    local log_file="${DEPLOY_LOG_DIR}/${now//[:.]/-}.json"

    local log_json
    log_json=$(cat <<DLJEOF
{
  "deployId": "${DEPLOY_ID}",
  "timestamp": "${now}",
  "venueId": "${venue_id}",
  "hostname": "${hostname_val}",
  "releaseId": "${RELEASE_ID:-}",
  "previousReleaseId": "${PREVIOUS_RELEASE_ID:-}",
  "manifestUrl": "${MANIFEST_URL:-}",
  "artifactUrl": "${ARTIFACT_URL:-}",
  "checksumResult": "${CHECKSUM_RESULT}",
  "signatureResult": "${SIGNATURE_RESULT}",
  "preflightResult": "${PREFLIGHT_RESULT}",
  "envValidationResult": "${ENV_VALIDATION_RESULT}",
  "schemaResult": "${SCHEMA_RESULT}",
  "schemaFailureClass": ${SCHEMA_FAILURE_CLASS},
  "restartResult": "${RESTART_RESULT}",
  "readinessResult": "${READINESS_RESULT}",
  "rollbackResult": "${ROLLBACK_RESULT}",
  "rollbackReadinessResult": "${ROLLBACK_READINESS_RESULT}",
  "finalStatus": "${FINAL_STATUS}",
  "durationMs": ${duration_ms},
  "errors": ${errors_json}
}
DLJEOF
)

    atomic_write "$log_file" "$log_json"
    log "Deploy log written: $log_file"

    # Also write to stdout for capture by callers
    echo "$log_json"
}

# ---------------------------------------------------------------------------
# Alert MC (for rollback_failed state)
# ---------------------------------------------------------------------------
alert_mc() {
    local reason="$1"
    local alert_file="${STATE_DIR}/deploy-alert.json"
    local now
    now="$(date -u +%FT%TZ)"

    local alert_json
    alert_json=$(cat <<ALERTEOF
{
  "alert": true,
  "reason": "${reason}",
  "releaseId": "${RELEASE_ID:-}",
  "previousReleaseId": "${PREVIOUS_RELEASE_ID:-}",
  "state": "rollback_failed",
  "alertedAt": "${now}",
  "hostname": "$(hostname 2>/dev/null || echo "unknown")",
  "venueId": "$(get_venue_id)"
}
ALERTEOF
)

    atomic_write "$alert_file" "$alert_json"
    log "ALERT written for Mission Control: $alert_file"
}

# ---------------------------------------------------------------------------
# Trap Handler
# ---------------------------------------------------------------------------
cleanup_on_exit() {
    local exit_code=$?

    if [[ $exit_code -ne 0 ]] && [[ "$FINAL_STATUS" == "pending" ]]; then
        FINAL_STATUS="failed"
        err "Deploy terminated unexpectedly (exit code: $exit_code)"
        write_deploy_log 2>/dev/null || true
    fi

    release_lock
    # Do NOT remove maintenance mode on unexpected exit — leave it for investigation
    # It will be cleared by the next successful deploy or --status command
}

# ---------------------------------------------------------------------------
# Ensure Directories
# ---------------------------------------------------------------------------
ensure_directories() {
    mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "${SHARED_DIR}/data" "$STATE_DIR" \
             "$DEPLOY_LOG_DIR" "$CACHE_DIR" "$KEYS_DIR" 2>/dev/null || true
}

# =============================================================================
# MAIN DEPLOY FLOW
# =============================================================================
do_deploy() {
    DEPLOY_ID="$(generate_uuid)"
    DEPLOY_START_EPOCH="$(date +%s)"
    PREVIOUS_RELEASE_ID="$(get_current_release_id)"

    trap cleanup_on_exit EXIT

    log "=========================================="
    log "Deploy starting: $DEPLOY_ID"
    log "=========================================="

    # Step 1: Acquire lock
    acquire_lock

    # Step 2: Set maintenance mode
    set_maintenance_mode

    # Step 3: Fetch manifest or use provided artifact
    if [[ -n "$MANIFEST_URL" ]]; then
        fetch_manifest "$MANIFEST_URL"
    elif [[ -n "$ARTIFACT_PATH" ]]; then
        # Artifact provided directly — derive releaseId from filename if not set
        if [[ -z "$RELEASE_ID" ]]; then
            RELEASE_ID="$(basename "$ARTIFACT_PATH" | sed 's/\.tar\.\(zst\|gz\|xz\|bz2\)$//')"
        fi
    else
        fatal "No --manifest-url or --artifact provided"
    fi

    if [[ -z "$RELEASE_ID" ]]; then
        fatal "Cannot determine release ID"
    fi

    log "Release ID: $RELEASE_ID"
    log "Previous release: ${PREVIOUS_RELEASE_ID:-none}"
    set_state "pending"

    # Step 4: Compatibility gates (already run during manifest fetch if manifest used)

    # Step 5: Check broken state
    local current_state
    current_state="$(get_state)"
    if [[ "$current_state" == "failed" || "$current_state" == "rollback_failed" ]]; then
        if [[ "$FORCE" != "true" ]]; then
            fatal "System in broken state ($current_state). Use --force to override."
        fi
        warn "Overriding broken state ($current_state) with --force"
    fi

    # Step 6: Check quarantine
    if is_quarantined "$RELEASE_ID"; then
        if [[ "$FORCE" != "true" ]]; then
            fatal "Release $RELEASE_ID is quarantined. Use --force to override, or --clear-quarantine $RELEASE_ID"
        fi
        warn "Overriding quarantine for $RELEASE_ID with --force"
    fi

    # Step 7: Check same release
    if [[ "$RELEASE_ID" == "$PREVIOUS_RELEASE_ID" ]]; then
        if [[ "$FORCE" != "true" ]]; then
            log "Release $RELEASE_ID is already active — skipping (use --force to redeploy)"
            FINAL_STATUS="healthy"
            write_deploy_log
            release_lock
            remove_maintenance_mode
            exit 0
        fi
        warn "Redeploying same release $RELEASE_ID with --force"
    fi

    # Step 8: Preflight checks
    local artifact_size=0
    if [[ -n "$ARTIFACT_PATH" ]] && [[ -f "$ARTIFACT_PATH" ]]; then
        artifact_size="$(stat -c%s "$ARTIFACT_PATH" 2>/dev/null || stat -f%z "$ARTIFACT_PATH" 2>/dev/null || echo "0")"
    fi
    if ! run_preflight "$artifact_size"; then
        fatal "Preflight checks failed — aborting deploy"
    fi

    # Step 9: Download artifact (if URL, not local path)
    if [[ -z "$ARTIFACT_PATH" ]] && [[ -n "$ARTIFACT_URL" ]]; then
        download_artifact "$ARTIFACT_URL"
    fi
    set_state "downloaded"

    if [[ ! -f "$ARTIFACT_PATH" ]]; then
        fatal "Artifact file not found: $ARTIFACT_PATH"
    fi

    # Step 10: Verify artifact (SHA256 + minisign)
    local manifest_checksum=""
    if [[ -f "${CACHE_DIR}/manifest.json" ]]; then
        manifest_checksum="$(json_get "${CACHE_DIR}/manifest.json" "artifactSha256")"
    fi
    if ! verify_artifact "$ARTIFACT_PATH" "$manifest_checksum"; then
        fatal "Artifact verification failed"
    fi

    # Step 11: Extract artifact
    if ! extract_artifact "$ARTIFACT_PATH"; then
        fatal "Artifact extraction failed"
    fi

    # Step 12: Set permissions
    set_permissions

    # Step 13-14: Validate release contents
    if ! run_validation; then
        fatal "Release validation failed"
    fi

    # Step 15: Wire symlinks
    wire_symlinks

    # Step 16: Schema migration
    if ! run_schema_step; then
        err "Schema migration failed — aborting deploy"
        # Do NOT roll back on schema failure — the database may be in a partial state
        # Leave for manual intervention
        FINAL_STATUS="failed"
        write_deploy_log
        release_lock
        # Keep maintenance mode — system needs manual attention
        exit 1
    fi

    # Step 17: Atomic symlink swap
    swap_symlinks

    # Step 18: Restart service
    if ! restart_service; then
        err "Service restart failed — attempting rollback"
        if do_rollback "$PREVIOUS_RELEASE_ID"; then
            FINAL_STATUS="rolled_back"
        else
            FINAL_STATUS="rollback_failed"
            alert_mc "Service restart failed, rollback also failed"
            write_deploy_log
            release_lock
            # Keep maintenance mode
            exit 1
        fi
        write_deploy_log
        release_lock
        remove_maintenance_mode
        exit 1
    fi

    # Step 19-20: Readiness check
    if check_readiness; then
        # SUCCESS
        READINESS_RESULT="pass"
        FINAL_STATUS="healthy"
        set_state "healthy"
        log "=========================================="
        log "Deploy SUCCESSFUL: $RELEASE_ID"
        log "=========================================="
        write_deploy_log
        release_lock
        remove_maintenance_mode
    else
        # Step 21: FAILED — quarantine + rollback
        READINESS_RESULT="fail"
        err "Readiness check failed — quarantining release $RELEASE_ID and rolling back"
        quarantine_release "$RELEASE_ID" "readiness_check_failed"

        if do_rollback "$PREVIOUS_RELEASE_ID"; then
            FINAL_STATUS="rolled_back"
            log "Rolled back to $PREVIOUS_RELEASE_ID after failed readiness"
            write_deploy_log
            release_lock
            remove_maintenance_mode
            exit 1
        else
            FINAL_STATUS="rollback_failed"
            alert_mc "Readiness check failed, rollback also failed"
            write_deploy_log
            release_lock
            # Keep maintenance mode — system needs manual attention
            exit 1
        fi
    fi

    # Step 22: Cleanup old releases
    do_cleanup

    # Step 23: Lock released + maintenance removed above
    log "Deploy complete in $(( ($(date +%s) - DEPLOY_START_EPOCH) ))s"
}

# =============================================================================
# OPERATOR COMMANDS
# =============================================================================

# --status
cmd_status() {
    local current_id previous_id state maintenance_mode node_version
    current_id="$(get_current_release_id)"
    previous_id="$(get_previous_release_id)"
    state="$(get_state)"
    node_version="$(node -v 2>/dev/null || echo "not found")"

    if is_maintenance_mode; then
        maintenance_mode="ACTIVE (since $(cat "$MAINTENANCE_FLAG" 2>/dev/null || echo "unknown"))"
    else
        maintenance_mode="inactive"
    fi

    # Get quarantined releases
    local quarantined="none"
    init_quarantine
    if has_jq; then
        local q_count
        q_count="$(jq '.quarantined | length' "$BAD_RELEASES_FILE" 2>/dev/null || echo "0")"
        if [[ "$q_count" -gt 0 ]]; then
            quarantined="$(jq -r '.quarantined[] | "\(.releaseId) (\(.reason), \(.quarantinedAt))"' "$BAD_RELEASES_FILE" 2>/dev/null)"
        fi
    fi

    # Disk usage
    local disk_usage
    disk_usage="$(du -sh "$BASE_DIR" 2>/dev/null | cut -f1 || echo "unknown")"
    local releases_usage
    releases_usage="$(du -sh "$RELEASES_DIR" 2>/dev/null | cut -f1 || echo "unknown")"

    # Last healthy deploy
    local last_healthy="unknown"
    if [[ -d "$DEPLOY_LOG_DIR" ]]; then
        local latest_log
        latest_log="$(ls -1t "$DEPLOY_LOG_DIR"/*.json 2>/dev/null | head -1)"
        if [[ -n "$latest_log" ]] && has_jq; then
            local log_status
            log_status="$(json_get "$latest_log" "finalStatus")"
            if [[ "$log_status" == "healthy" ]]; then
                last_healthy="$(json_get "$latest_log" "timestamp")"
            fi
        fi
    fi

    cat <<STATUS_EOF
GWI POS Deploy Status
=====================
Current release:    ${current_id:-none}
Previous release:   ${previous_id:-none}
Deploy state:       ${state}
Maintenance mode:   ${maintenance_mode}
Node.js:            ${node_version}
Quarantined:        ${quarantined}
Last healthy:       ${last_healthy}
Disk (total):       ${disk_usage}
Disk (releases):    ${releases_usage}
Current link:       $(readlink "$CURRENT_LINK" 2>/dev/null || echo "not set")
Previous link:      $(readlink "$PREVIOUS_LINK" 2>/dev/null || echo "not set")
STATUS_EOF
}

# --list-releases
cmd_list_releases() {
    local current_id previous_id
    current_id="$(get_current_release_id)"
    previous_id="$(get_previous_release_id)"

    if [[ ! -d "$RELEASES_DIR" ]]; then
        echo "No releases directory found."
        return 0
    fi

    echo "GWI POS Releases"
    echo "================"
    printf "%-40s  %-10s  %-20s  %s\n" "RELEASE ID" "SIZE" "DATE" "STATUS"
    printf "%-40s  %-10s  %-20s  %s\n" "----------" "----" "----" "------"

    while IFS= read -r release_path; do
        [[ -z "$release_path" ]] && continue
        [[ ! -d "$release_path" ]] && continue

        local rid size mod_date markers
        rid="$(basename "$release_path")"
        size="$(du -sh "$release_path" 2>/dev/null | cut -f1)"
        mod_date="$(stat -c '%Y' "$release_path" 2>/dev/null || stat -f '%m' "$release_path" 2>/dev/null || echo "0")"
        mod_date="$(date -d "@$mod_date" '+%Y-%m-%d %H:%M' 2>/dev/null || date -r "$mod_date" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")"

        markers=""
        [[ "$rid" == "$current_id" ]] && markers="${markers} [ACTIVE]"
        [[ "$rid" == "$previous_id" ]] && markers="${markers} [PREVIOUS]"
        is_quarantined "$rid" 2>/dev/null && markers="${markers} [QUARANTINED]"

        printf "%-40s  %-10s  %-20s  %s\n" "$rid" "$size" "$mod_date" "$markers"
    done < <(ls -1dt "${RELEASES_DIR}"/*/ 2>/dev/null || true)
}

# --rollback-to
cmd_rollback_to() {
    local target="$1"

    if [[ -z "$target" ]]; then
        err "Usage: deploy-release.sh --rollback-to <releaseId>"
        exit 1
    fi

    DEPLOY_ID="$(generate_uuid)"
    DEPLOY_START_EPOCH="$(date +%s)"
    RELEASE_ID="$target"
    PREVIOUS_RELEASE_ID="$(get_current_release_id)"

    trap cleanup_on_exit EXIT

    log "Manual rollback to: $target"

    acquire_lock
    set_maintenance_mode

    if do_rollback "$target"; then
        FINAL_STATUS="healthy"
        set_state "healthy" "$target"
        log "Manual rollback successful"
        write_deploy_log
        remove_maintenance_mode
    else
        FINAL_STATUS="rollback_failed"
        alert_mc "Manual rollback to $target failed"
        write_deploy_log
        # Keep maintenance mode
    fi

    release_lock
}

# --validate-artifact
cmd_validate_artifact() {
    local artifact="$1"

    if [[ -z "$artifact" ]] || [[ ! -f "$artifact" ]]; then
        err "Usage: deploy-release.sh --validate-artifact <path>"
        err "File not found: ${artifact:-<none>}"
        exit 1
    fi

    log "Validating artifact: $artifact"

    # Check signature
    verify_signature "$artifact"
    echo "Signature: $SIGNATURE_RESULT"

    # Check checksum (if sidecar exists)
    verify_checksum "$artifact"
    echo "Checksum: $CHECKSUM_RESULT"

    # Detect compression
    local compression
    compression="$(detect_compression "$artifact")"
    echo "Compression: $compression"

    # List contents
    echo ""
    echo "Contents (first 30 entries):"
    case "$compression" in
        zstd)
            if command -v zstd &>/dev/null; then
                tar --zstd -tf "$artifact" 2>/dev/null | head -30
            else
                zstdcat "$artifact" 2>/dev/null | tar -tf - 2>/dev/null | head -30
            fi
            ;;
        gzip) tar --gzip -tf "$artifact" 2>/dev/null | head -30 ;;
        *)    tar -tf "$artifact" 2>/dev/null | head -30 ;;
    esac

    # Security check
    local unsafe
    case "$compression" in
        zstd)
            if command -v zstd &>/dev/null; then
                unsafe="$(tar --zstd -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            else
                unsafe="$(zstdcat "$artifact" 2>/dev/null | tar -tf - 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)"
            fi
            ;;
        gzip) unsafe="$(tar --gzip -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)" ;;
        *)    unsafe="$(tar -tf "$artifact" 2>/dev/null | grep -E '(^/|\.\./|^\.\./)' || true)" ;;
    esac

    echo ""
    if [[ -n "$unsafe" ]]; then
        echo "SECURITY WARNING: Path traversal or absolute paths detected:"
        echo "$unsafe"
    else
        echo "Security: PASS (no path traversal or absolute paths)"
    fi

    # File size
    local size
    size="$(du -sh "$artifact" 2>/dev/null | cut -f1)"
    echo "Size: $size"
}

# =============================================================================
# ARGUMENT PARSING
# =============================================================================
main() {
    ensure_directories

    local command=""
    local rollback_target=""
    local validate_path=""
    local clear_quarantine_id=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --manifest-url)
                MANIFEST_URL="${2:?--manifest-url requires a URL}"
                command="deploy"
                shift 2
                ;;
            --artifact)
                ARTIFACT_PATH="${2:?--artifact requires a path}"
                command="deploy"
                shift 2
                ;;
            --offline)
                ARTIFACT_PATH="${2:?--offline requires a path}"
                OFFLINE=true
                command="deploy"
                shift 2
                ;;
            --force)
                FORCE=true
                shift
                ;;
            --rollback-to)
                rollback_target="${2:?--rollback-to requires a releaseId}"
                command="rollback"
                shift 2
                ;;
            --status)
                command="status"
                shift
                ;;
            --list-releases)
                command="list"
                shift
                ;;
            --cleanup)
                command="cleanup"
                shift
                ;;
            --clear-quarantine)
                command="clear-quarantine"
                clear_quarantine_id="${2:-}"
                shift
                [[ -n "$clear_quarantine_id" ]] && shift
                ;;
            --validate-artifact)
                validate_path="${2:?--validate-artifact requires a path}"
                command="validate"
                shift 2
                ;;
            --help|-h)
                command="help"
                shift
                ;;
            *)
                err "Unknown argument: $1"
                command="help"
                shift
                ;;
        esac
    done

    case "$command" in
        deploy)
            do_deploy
            ;;
        rollback)
            cmd_rollback_to "$rollback_target"
            ;;
        status)
            cmd_status
            ;;
        list)
            cmd_list_releases
            ;;
        cleanup)
            do_cleanup
            ;;
        clear-quarantine)
            clear_quarantine "$clear_quarantine_id"
            ;;
        validate)
            cmd_validate_artifact "$validate_path"
            ;;
        help|"")
            cat <<HELPEOF
GWI POS Deploy Script — Canonical deploy pipeline for NUC servers

DEPLOY:
  deploy-release.sh --manifest-url <URL> [--force]
  deploy-release.sh --artifact <path> [--force]
  deploy-release.sh --offline <path> [--force]

OPERATOR:
  deploy-release.sh --status                  Current state, releases, health
  deploy-release.sh --list-releases           All retained releases with sizes
  deploy-release.sh --rollback-to <releaseId> Manual rollback to a release
  deploy-release.sh --cleanup                 Remove old releases + cached artifacts
  deploy-release.sh --clear-quarantine [id]   Remove release(s) from quarantine
  deploy-release.sh --validate-artifact <path> Verify sig + checksums + list contents

FLAGS:
  --force    Override quarantine, broken state, or same-release checks

DEPLOY FLOW:
  1. Lock + maintenance mode
  2. Fetch manifest + verify signature
  3. Compatibility gates (format, installer, Ubuntu, Node, schema)
  4. Check quarantine + state + same-release
  5. Preflight (disk, RAM, DB)
  6. Download artifact (axel || curl, 3x retry)
  7. Verify (SHA256 + minisign)
  8. Extract (zstd/gzip, security scan)
  9. Set permissions (gwipos:gwipos)
  10. Validate (required files, checksums.txt, .env)
  11. Wire symlinks (.env, logs)
  12. Schema (prisma db push + nuc-pre-migrate.js)
  13. Atomic swap (current symlink)
  14. Restart service
  15. Readiness (30 attempts, 3 consecutive successes)
  16. If fail: quarantine + rollback + verify
  17. Cleanup (retain 3 releases, <2GB)

STATE MACHINE:
  pending -> downloaded -> verified -> extracted -> validated ->
  migrated -> activated -> healthy
                             \-> rolled_back -> (ok | rollback_failed)
HELPEOF
            ;;
    esac
}

main "$@"
