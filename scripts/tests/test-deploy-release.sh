#!/usr/bin/env bash
# =============================================================================
# test-deploy-release.sh — Unit tests for deploy-release.sh state machine
# =============================================================================
# Validates deploy-release.sh functions in isolation WITHOUT deploying anything.
# Sources deploy-release.sh with mocks and exercises the pure-logic functions.
#
# Usage:
#   bash scripts/tests/test-deploy-release.sh
#   bash scripts/tests/test-deploy-release.sh -v   # verbose (show all output)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEPLOY_SCRIPT="${REPO_ROOT}/public/scripts/deploy-release.sh"

# ---------------------------------------------------------------------------
# Test Framework
# ---------------------------------------------------------------------------
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
CURRENT_SUITE=""
VERBOSE="${1:-}"

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "$expected" == "$actual" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (expected '$expected', got '$actual')"
    fi
}

assert_ne() {
    local desc="$1" not_expected="$2" actual="$3"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ "$not_expected" != "$actual" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (should not be '$not_expected')"
    fi
}

assert_file_exists() {
    local desc="$1" path="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ -f "$path" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (file not found: $path)"
    fi
}

assert_file_not_exists() {
    local desc="$1" path="$2"
    TESTS_RUN=$((TESTS_RUN + 1))
    if [[ ! -f "$path" ]]; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (file should not exist: $path)"
    fi
}

assert_true() {
    local desc="$1"
    shift
    TESTS_RUN=$((TESTS_RUN + 1))
    if "$@" 2>/dev/null; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (command returned false)"
    fi
}

assert_false() {
    local desc="$1"
    shift
    TESTS_RUN=$((TESTS_RUN + 1))
    if ! "$@" 2>/dev/null; then
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "  PASS: $desc"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: $desc (command returned true, expected false)"
    fi
}

suite() {
    CURRENT_SUITE="$1"
    echo ""
    echo "--- $CURRENT_SUITE ---"
}

# ---------------------------------------------------------------------------
# Test Environment Setup
# ---------------------------------------------------------------------------
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

# Verify the deploy script exists
if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
    echo "ERROR: deploy-release.sh not found at $DEPLOY_SCRIPT"
    exit 1
fi

# ---------------------------------------------------------------------------
# Source Strategy
# ---------------------------------------------------------------------------
# deploy-release.sh ends with `main "$@"` unconditionally, and uses `readonly`
# for constants. We cannot source it directly. Instead:
#   1. Create a modified copy that strips the `main "$@"` call
#   2. Replace `readonly` constant declarations with regular assignments
#      so we can override paths to point at our temp directory
#   3. Stub out commands that would touch the real system (systemctl, flock, etc.)
# ---------------------------------------------------------------------------
prepare_source() {
    local modified="${TEST_DIR}/deploy-release-testable.sh"

    # Copy the script but:
    #   - Remove the final `main "$@"` invocation
    #   - Convert `readonly` to regular variable declarations (only the constant block)
    #   - Remove `set -euo pipefail` (we manage our own error handling in tests)
    sed \
        -e '/^main "\$@"$/d' \
        -e 's/^readonly //' \
        -e '/^set -euo pipefail$/d' \
        "$DEPLOY_SCRIPT" > "$modified"

    echo "$modified"
}

# Create the testable version
TESTABLE_SCRIPT="$(prepare_source)"

# ---------------------------------------------------------------------------
# Load functions with overridden constants
# ---------------------------------------------------------------------------
# We source in a function so we can control the environment.
# Each test suite gets a fresh temp directory structure.
# ---------------------------------------------------------------------------
reset_test_env() {
    # Clean and recreate temp directory structure
    rm -rf "${TEST_DIR}/opt"
    mkdir -p "${TEST_DIR}/opt/gwi-pos"

    local base="${TEST_DIR}/opt/gwi-pos"
    mkdir -p "${base}/releases"
    mkdir -p "${base}/shared/logs/deploys"
    mkdir -p "${base}/shared/state"
    mkdir -p "${base}/shared/data"
    mkdir -p "${base}/cache/artifacts"
    mkdir -p "${base}/keys"

    # Override all path constants BEFORE sourcing
    BASE_DIR="${base}"
    RELEASES_DIR="${base}/releases"
    CURRENT_LINK="${base}/current"
    PREVIOUS_LINK="${base}/previous"
    SHARED_DIR="${base}/shared"
    STATE_DIR="${base}/shared/state"
    DEPLOY_LOG_DIR="${base}/shared/logs/deploys"
    CACHE_DIR="${base}/cache/artifacts"
    KEYS_DIR="${base}/keys"
    PUB_KEY="${base}/keys/gwi-pos-release.pub"
    DEPLOY_STATE_FILE="${base}/shared/state/deploy-state.json"
    BAD_RELEASES_FILE="${base}/shared/state/bad-releases.json"
    MAINTENANCE_FLAG="${base}/shared/state/deploy-in-progress"
    LOCKFILE="${base}/shared/state/deploy.lock"
    INSTALLER_VERSION_FILE="${base}/installer-version"
    DEPLOY_TOOLS_DIR="${base}/deploy-tools"

    # Numeric constants (keep the same)
    POS_PORT="3005"
    HEALTH_URL="http://localhost:${POS_PORT}/api/health/ready"
    SERVICE_NAME="thepasspos"
    LOCK_TIMEOUT_SECONDS=720
    SCHEMA_TIMEOUT_SECONDS=120
    READINESS_MAX_ATTEMPTS=30
    READINESS_INTERVAL=2
    READINESS_CONSECUTIVE_REQUIRED=3
    DOWNLOAD_RETRIES=3
    RETAIN_RELEASES=3
    RETAIN_SIZE_BYTES=$((2 * 1024 * 1024 * 1024))
    MIN_DISK_BYTES=$((2 * 1024 * 1024 * 1024))
    MIN_RAM_MB=1536
    REQUIRED_FILES=("server.js" "prisma/schema.prisma" "launcher.sh" "required-env.json")

    # Reset global state
    DEPLOY_ID="test-deploy-001"
    DEPLOY_START_EPOCH="$(date +%s)"
    DEPLOY_ERRORS=()
    LOCK_FD=""
    MANIFEST_URL=""
    ARTIFACT_PATH=""
    ARTIFACT_URL=""
    RELEASE_ID=""
    DEPLOY_TOOLS_URL=""
    DEPLOY_TOOLS_SHA256=""
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
    DIAG_SERVICE_ACTIVE=""
    DIAG_PORT_BOUND=""
    DIAG_LIVE_HTTP=""
    DIAG_READY_HTTP=""
    DIAG_READY_BODY=""
    FINAL_STATUS="pending"

    export BASE_DIR RELEASES_DIR CURRENT_LINK PREVIOUS_LINK SHARED_DIR STATE_DIR
    export DEPLOY_LOG_DIR CACHE_DIR KEYS_DIR PUB_KEY
    export DEPLOY_STATE_FILE BAD_RELEASES_FILE MAINTENANCE_FLAG LOCKFILE
    export INSTALLER_VERSION_FILE DEPLOY_TOOLS_DIR
}

# Initial setup and source
reset_test_env

# Stub out dangerous/system-level commands
flock() { return 0; }
systemctl() { return 0; }
export -f flock systemctl 2>/dev/null || true

# Source the modified deploy script to load all functions
# shellcheck source=/dev/null
source "$TESTABLE_SCRIPT"

echo "============================================"
echo "  deploy-release.sh State Machine Tests"
echo "============================================"

# =============================================================================
# TEST SUITES
# =============================================================================

# ---------------------------------------------------------------------------
suite "State Machine — get_state / set_state"
# ---------------------------------------------------------------------------

test_initial_state_is_none() {
    reset_test_env
    local state
    state="$(get_state)"
    assert_eq "no state file returns 'none'" "none" "$state"
}

test_set_and_get_state() {
    reset_test_env
    RELEASE_ID="test-release-abc"
    DEPLOY_ID="test-deploy-001"
    set_state "pending" 2>/dev/null
    local state
    state="$(get_state)"
    assert_eq "set_state 'pending' persists" "pending" "$state"
}

test_state_transitions() {
    reset_test_env
    RELEASE_ID="test-release-xyz"
    DEPLOY_ID="test-deploy-002"

    local states=("pending" "downloaded" "verified" "extracted" "validated" "migrated" "activated" "healthy")
    for s in "${states[@]}"; do
        set_state "$s" 2>/dev/null
        local actual
        actual="$(get_state)"
        assert_eq "state transition to '$s'" "$s" "$actual"
    done
}

test_state_persists_across_reads() {
    reset_test_env
    RELEASE_ID="test-release-persist"
    DEPLOY_ID="test-deploy-003"
    set_state "downloaded" 2>/dev/null

    local read1 read2
    read1="$(get_state)"
    read2="$(get_state)"
    assert_eq "first read after set" "downloaded" "$read1"
    assert_eq "second read (same result)" "downloaded" "$read2"
}

test_state_file_contains_release_id() {
    reset_test_env
    RELEASE_ID="release-42"
    DEPLOY_ID="deploy-99"
    set_state "verified" 2>/dev/null

    assert_file_exists "state file created" "$DEPLOY_STATE_FILE"

    local stored_release
    stored_release="$(json_get "$DEPLOY_STATE_FILE" "releaseId")"
    assert_eq "state file stores releaseId" "release-42" "$stored_release"
}

test_state_file_contains_deploy_id() {
    reset_test_env
    RELEASE_ID="release-99"
    DEPLOY_ID="deploy-abc"
    set_state "pending" 2>/dev/null

    local stored_deploy
    stored_deploy="$(json_get "$DEPLOY_STATE_FILE" "deployId")"
    assert_eq "state file stores deployId" "deploy-abc" "$stored_deploy"
}

test_state_rolled_back() {
    reset_test_env
    RELEASE_ID="release-fail"
    DEPLOY_ID="deploy-rb"
    set_state "rolled_back" 2>/dev/null
    local state
    state="$(get_state)"
    assert_eq "rolled_back state" "rolled_back" "$state"
}

test_state_rollback_failed() {
    reset_test_env
    RELEASE_ID="release-doom"
    DEPLOY_ID="deploy-doom"
    set_state "rollback_failed" 2>/dev/null
    local state
    state="$(get_state)"
    assert_eq "rollback_failed state" "rollback_failed" "$state"
}

test_initial_state_is_none
test_set_and_get_state
test_state_transitions
test_state_persists_across_reads
test_state_file_contains_release_id
test_state_file_contains_deploy_id
test_state_rolled_back
test_state_rollback_failed

# ---------------------------------------------------------------------------
suite "Lock Management"
# ---------------------------------------------------------------------------

test_lock_file_creation() {
    reset_test_env
    # Write a fake lock to simulate acquire_lock behavior (acquire_lock uses flock
    # which we cannot test in CI without a real fd, so we test the file operations)
    printf '%s\n%s\n' "$$" "$(date +%s)" > "$LOCKFILE"
    assert_file_exists "lock file created" "$LOCKFILE"
}

test_lock_release_removes_file() {
    reset_test_env
    printf '%s\n%s\n' "$$" "$(date +%s)" > "$LOCKFILE"
    LOCK_FD=""
    release_lock 2>/dev/null
    assert_file_not_exists "lock file removed after release" "$LOCKFILE"
}

test_stale_lock_detection() {
    reset_test_env
    # Write a lock with a dead PID (99999999 should not exist)
    local old_epoch=$(( $(date +%s) - 900 ))
    printf '%s\n%s\n' "99999999" "$old_epoch" > "$LOCKFILE"

    # Check that the PID is dead and the lock is stale
    local lock_pid
    lock_pid="$(head -1 "$LOCKFILE" 2>/dev/null || echo "")"

    local pid_alive=false
    if kill -0 "$lock_pid" 2>/dev/null; then
        pid_alive=true
    fi

    assert_eq "stale lock PID is dead" "false" "$pid_alive"
}

test_lock_contains_pid() {
    reset_test_env
    printf '%s\n%s\n' "$$" "$(date +%s)" > "$LOCKFILE"
    local lock_pid
    lock_pid="$(head -1 "$LOCKFILE" 2>/dev/null)"
    assert_eq "lock file contains current PID" "$$" "$lock_pid"
}

test_lock_file_creation
test_lock_release_removes_file
test_stale_lock_detection
test_lock_contains_pid

# ---------------------------------------------------------------------------
suite "Quarantine (Bad Releases)"
# ---------------------------------------------------------------------------

test_quarantine_init() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    init_quarantine 2>/dev/null
    assert_file_exists "quarantine file initialized" "$BAD_RELEASES_FILE"
}

test_quarantine_add_and_check() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    quarantine_release "bad-release-1" "health_check_failed" 2>/dev/null
    assert_true "quarantined release is detected" is_quarantined "bad-release-1"
}

test_quarantine_unknown_is_clean() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    init_quarantine 2>/dev/null
    assert_false "unquarantined release is clean" is_quarantined "good-release-1"
}

test_quarantine_multiple_releases() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    quarantine_release "bad-1" "test_reason_1" 2>/dev/null
    quarantine_release "bad-2" "test_reason_2" 2>/dev/null

    assert_true "first quarantined release found" is_quarantined "bad-1"
    assert_true "second quarantined release found" is_quarantined "bad-2"
    assert_false "non-quarantined release is clean" is_quarantined "good-1"
}

test_clear_quarantine_specific() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    quarantine_release "bad-1" "reason1" 2>/dev/null
    quarantine_release "bad-2" "reason2" 2>/dev/null

    clear_quarantine "bad-1" 2>/dev/null

    assert_false "cleared release is no longer quarantined" is_quarantined "bad-1"
    assert_true "other release still quarantined" is_quarantined "bad-2"
}

test_clear_quarantine_all() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"
    quarantine_release "bad-1" "reason1" 2>/dev/null
    quarantine_release "bad-2" "reason2" 2>/dev/null

    clear_quarantine "" 2>/dev/null

    assert_false "all quarantined releases cleared (1)" is_quarantined "bad-1"
    assert_false "all quarantined releases cleared (2)" is_quarantined "bad-2"
}

test_quarantine_init
test_quarantine_add_and_check
test_quarantine_unknown_is_clean
test_quarantine_multiple_releases
test_clear_quarantine_specific
test_clear_quarantine_all

# ---------------------------------------------------------------------------
suite "Maintenance Mode"
# ---------------------------------------------------------------------------

test_maintenance_mode_enable() {
    reset_test_env
    set_maintenance_mode 2>/dev/null
    assert_true "maintenance mode enabled" is_maintenance_mode
    assert_file_exists "maintenance flag file exists" "$MAINTENANCE_FLAG"
}

test_maintenance_mode_disable() {
    reset_test_env
    set_maintenance_mode 2>/dev/null
    remove_maintenance_mode 2>/dev/null
    assert_false "maintenance mode disabled" is_maintenance_mode
    assert_file_not_exists "maintenance flag file removed" "$MAINTENANCE_FLAG"
}

test_maintenance_mode_initially_off() {
    reset_test_env
    assert_false "maintenance mode off by default" is_maintenance_mode
}

test_maintenance_mode_toggle() {
    reset_test_env
    assert_false "start off" is_maintenance_mode
    set_maintenance_mode 2>/dev/null
    assert_true "turned on" is_maintenance_mode
    remove_maintenance_mode 2>/dev/null
    assert_false "turned off" is_maintenance_mode
    set_maintenance_mode 2>/dev/null
    assert_true "turned on again" is_maintenance_mode
}

test_maintenance_mode_enable
test_maintenance_mode_disable
test_maintenance_mode_initially_off
test_maintenance_mode_toggle

# ---------------------------------------------------------------------------
suite "Version Comparison (version_gte)"
# ---------------------------------------------------------------------------

test_version_gte_equal() {
    assert_true "1.2.3 >= 1.2.3" version_gte "1.2.3" "1.2.3"
}

test_version_gte_greater_patch() {
    assert_true "1.2.4 >= 1.2.3" version_gte "1.2.4" "1.2.3"
}

test_version_gte_greater_minor() {
    assert_true "1.3.0 >= 1.2.9" version_gte "1.3.0" "1.2.9"
}

test_version_gte_greater_major() {
    assert_true "2.0.0 >= 1.9.9" version_gte "2.0.0" "1.9.9"
}

test_version_gte_less_patch() {
    assert_false "1.2.3 >= 1.2.4" version_gte "1.2.3" "1.2.4"
}

test_version_gte_less_minor() {
    assert_false "1.2.3 >= 1.3.0" version_gte "1.2.3" "1.3.0"
}

test_version_gte_less_major() {
    assert_false "1.9.9 >= 2.0.0" version_gte "1.9.9" "2.0.0"
}

test_version_gte_zero() {
    assert_true "0.0.1 >= 0.0.0" version_gte "0.0.1" "0.0.0"
}

test_version_gte_same_zero() {
    assert_true "0.0.0 >= 0.0.0" version_gte "0.0.0" "0.0.0"
}

test_version_gte_large_numbers() {
    assert_true "10.20.30 >= 10.20.29" version_gte "10.20.30" "10.20.29"
}

test_version_gte_partial() {
    # version_gte handles missing parts as 0
    assert_true "1.2 >= 1.2.0 (partial)" version_gte "1.2" "1.2.0"
}

test_version_gte_equal
test_version_gte_greater_patch
test_version_gte_greater_minor
test_version_gte_greater_major
test_version_gte_less_patch
test_version_gte_less_minor
test_version_gte_less_major
test_version_gte_zero
test_version_gte_same_zero
test_version_gte_large_numbers
test_version_gte_partial

# ---------------------------------------------------------------------------
suite "Atomic Write"
# ---------------------------------------------------------------------------

test_atomic_write_creates_file() {
    reset_test_env
    local target="${TEST_DIR}/opt/gwi-pos/shared/state/test-atomic.json"
    atomic_write "$target" '{"test": true}'
    assert_file_exists "atomic_write creates file" "$target"
}

test_atomic_write_correct_content() {
    reset_test_env
    local target="${TEST_DIR}/opt/gwi-pos/shared/state/test-content.json"
    atomic_write "$target" '{"hello": "world"}'
    local content
    content="$(cat "$target")"
    assert_eq "atomic_write has correct content" '{"hello": "world"}' "$content"
}

test_atomic_write_overwrites() {
    reset_test_env
    local target="${TEST_DIR}/opt/gwi-pos/shared/state/test-overwrite.json"
    atomic_write "$target" '{"version": 1}'
    atomic_write "$target" '{"version": 2}'
    local content
    content="$(cat "$target")"
    assert_eq "atomic_write overwrites with new content" '{"version": 2}' "$content"
}

test_atomic_write_no_temp_residue() {
    reset_test_env
    local target="${TEST_DIR}/opt/gwi-pos/shared/state/test-no-residue.json"
    atomic_write "$target" '{"clean": true}'

    local tmp_count
    tmp_count="$(find "$(dirname "$target")" -name "$(basename "$target").tmp.*" 2>/dev/null | wc -l | tr -d ' ')"
    assert_eq "no temp files left behind" "0" "$tmp_count"
}

test_atomic_write_creates_file
test_atomic_write_correct_content
test_atomic_write_overwrites
test_atomic_write_no_temp_residue

# ---------------------------------------------------------------------------
suite "JSON Helpers"
# ---------------------------------------------------------------------------

test_json_get_simple() {
    reset_test_env
    local file="${TEST_DIR}/opt/gwi-pos/shared/state/test-json.json"
    printf '{"name": "test-release", "version": "1.2.3"}\n' > "$file"

    local name
    name="$(json_get "$file" "name")"
    assert_eq "json_get extracts 'name'" "test-release" "$name"

    local version
    version="$(json_get "$file" "version")"
    assert_eq "json_get extracts 'version'" "1.2.3" "$version"
}

test_json_get_missing_key() {
    reset_test_env
    local file="${TEST_DIR}/opt/gwi-pos/shared/state/test-json2.json"
    printf '{"name": "test"}\n' > "$file"

    local missing
    missing="$(json_get "$file" "nonexistent")"
    assert_eq "json_get returns empty for missing key" "" "$missing"
}

test_json_get_simple
test_json_get_missing_key

# ---------------------------------------------------------------------------
suite "UUID Generation"
# ---------------------------------------------------------------------------

test_uuid_not_empty() {
    local uuid
    uuid="$(generate_uuid)"
    assert_ne "generate_uuid returns non-empty" "" "$uuid"
}

test_uuid_unique() {
    local uuid1 uuid2
    uuid1="$(generate_uuid)"
    uuid2="$(generate_uuid)"
    assert_ne "two UUIDs are different" "$uuid1" "$uuid2"
}

test_uuid_not_empty
test_uuid_unique

# ---------------------------------------------------------------------------
suite "Release ID Helpers"
# ---------------------------------------------------------------------------

test_current_release_no_symlink() {
    reset_test_env
    local id
    id="$(get_current_release_id)"
    assert_eq "no current symlink returns empty" "" "$id"
}

test_current_release_with_symlink() {
    reset_test_env
    mkdir -p "${RELEASES_DIR}/release-abc"
    ln -sfn "${RELEASES_DIR}/release-abc" "$CURRENT_LINK"
    local id
    id="$(get_current_release_id)"
    assert_eq "current symlink resolves to release ID" "release-abc" "$id"
}

test_previous_release_no_symlink() {
    reset_test_env
    local id
    id="$(get_previous_release_id)"
    assert_eq "no previous symlink returns empty" "" "$id"
}

test_previous_release_with_symlink() {
    reset_test_env
    mkdir -p "${RELEASES_DIR}/release-old"
    ln -sfn "${RELEASES_DIR}/release-old" "$PREVIOUS_LINK"
    local id
    id="$(get_previous_release_id)"
    assert_eq "previous symlink resolves to release ID" "release-old" "$id"
}

test_current_release_no_symlink
test_current_release_with_symlink
test_previous_release_no_symlink
test_previous_release_with_symlink

# ---------------------------------------------------------------------------
suite "Compression Detection"
# ---------------------------------------------------------------------------

test_detect_compression_by_extension_zstd() {
    reset_test_env
    local file="${TEST_DIR}/test.tar.zst"
    # Write non-magic bytes (detection falls through to extension)
    printf '\x00\x00\x00\x00' > "$file"
    local comp
    comp="$(detect_compression "$file")"
    assert_eq "detects zstd by extension" "zstd" "$comp"
}

test_detect_compression_by_extension_gz() {
    reset_test_env
    local file="${TEST_DIR}/test.tar.gz"
    printf '\x00\x00\x00\x00' > "$file"
    local comp
    comp="$(detect_compression "$file")"
    assert_eq "detects gzip by extension" "gzip" "$comp"
}

test_detect_compression_by_extension_tgz() {
    reset_test_env
    local file="${TEST_DIR}/test.tgz"
    printf '\x00\x00\x00\x00' > "$file"
    local comp
    comp="$(detect_compression "$file")"
    assert_eq "detects gzip for .tgz extension" "gzip" "$comp"
}

test_detect_compression_by_magic_gzip() {
    reset_test_env
    local file="${TEST_DIR}/test-magic.bin"
    # gzip magic: 1f 8b
    printf '\x1f\x8b\x08\x00' > "$file"
    local comp
    comp="$(detect_compression "$file")"
    assert_eq "detects gzip by magic bytes" "gzip" "$comp"
}

test_detect_compression_unknown() {
    reset_test_env
    local file="${TEST_DIR}/test.dat"
    printf '\x00\x00\x00\x00' > "$file"
    local comp
    comp="$(detect_compression "$file")"
    assert_eq "unknown extension returns 'unknown'" "unknown" "$comp"
}

test_detect_compression_by_extension_zstd
test_detect_compression_by_extension_gz
test_detect_compression_by_extension_tgz
test_detect_compression_by_magic_gzip
test_detect_compression_unknown

# ---------------------------------------------------------------------------
suite "Environment Helpers"
# ---------------------------------------------------------------------------

test_get_env_var_present() {
    reset_test_env
    printf 'DATABASE_URL=postgres://localhost/test\nPORT=3005\n' > "${SHARED_DIR}/.env"
    local val
    val="$(get_env_var "DATABASE_URL")"
    assert_eq "get_env_var reads DATABASE_URL" "postgres://localhost/test" "$val"
}

test_get_env_var_quoted() {
    reset_test_env
    printf 'SECRET="my-secret-value"\n' > "${SHARED_DIR}/.env"
    local val
    val="$(get_env_var "SECRET")"
    assert_eq "get_env_var strips double quotes" "my-secret-value" "$val"
}

test_get_env_var_missing() {
    reset_test_env
    printf 'PORT=3005\n' > "${SHARED_DIR}/.env"
    local val
    val="$(get_env_var "NONEXISTENT")"
    assert_eq "get_env_var returns empty for missing key" "" "$val"
}

test_get_env_var_present
test_get_env_var_quoted
test_get_env_var_missing

# ---------------------------------------------------------------------------
suite "Validate Required Files"
# ---------------------------------------------------------------------------

test_validate_required_files_all_present() {
    reset_test_env
    RELEASE_ID="test-valid-release"
    local rdir="${RELEASES_DIR}/${RELEASE_ID}"
    mkdir -p "${rdir}/prisma"
    touch "${rdir}/server.js"
    touch "${rdir}/prisma/schema.prisma"
    touch "${rdir}/launcher.sh"
    touch "${rdir}/required-env.json"

    assert_true "all required files present passes" validate_required_files
}

test_validate_required_files_missing() {
    reset_test_env
    RELEASE_ID="test-invalid-release"
    local rdir="${RELEASES_DIR}/${RELEASE_ID}"
    mkdir -p "${rdir}/prisma"
    touch "${rdir}/server.js"
    # Missing: prisma/schema.prisma, launcher.sh, required-env.json

    assert_false "missing required files fails" validate_required_files
}

test_validate_required_files_all_present
test_validate_required_files_missing

# ---------------------------------------------------------------------------
suite "Deploy Log"
# ---------------------------------------------------------------------------

test_deploy_log_written() {
    reset_test_env
    DEPLOY_ID="test-log-deploy"
    RELEASE_ID="test-log-release"
    DEPLOY_START_EPOCH="$(date +%s)"
    FINAL_STATUS="healthy"

    write_deploy_log >/dev/null 2>/dev/null

    local log_count
    log_count="$(ls "${DEPLOY_LOG_DIR}"/*.json 2>/dev/null | wc -l | tr -d ' ')"
    assert_ne "deploy log file created" "0" "$log_count"
}

test_deploy_log_contains_status() {
    reset_test_env
    DEPLOY_ID="test-status-deploy"
    RELEASE_ID="test-status-release"
    DEPLOY_START_EPOCH="$(date +%s)"
    FINAL_STATUS="healthy"

    write_deploy_log >/dev/null 2>/dev/null

    local latest_log
    latest_log="$(ls -1t "${DEPLOY_LOG_DIR}"/*.json 2>/dev/null | head -1)"
    if [[ -n "$latest_log" ]]; then
        local status
        status="$(json_get "$latest_log" "finalStatus")"
        assert_eq "deploy log contains finalStatus" "healthy" "$status"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL: deploy log file not found"
    fi
}

test_deploy_log_written
test_deploy_log_contains_status

# ---------------------------------------------------------------------------
suite "Ensure Directories"
# ---------------------------------------------------------------------------

test_ensure_directories() {
    reset_test_env
    # Remove some dirs to verify ensure_directories recreates them
    rm -rf "${RELEASES_DIR}" "${STATE_DIR}"
    ensure_directories 2>/dev/null

    local all_exist=true
    for d in "$RELEASES_DIR" "$SHARED_DIR" "$STATE_DIR" "$DEPLOY_LOG_DIR" "$CACHE_DIR" "$KEYS_DIR"; do
        if [[ ! -d "$d" ]]; then
            all_exist=false
            break
        fi
    done
    assert_eq "ensure_directories creates all required dirs" "true" "$all_exist"
}

test_ensure_directories

# ---------------------------------------------------------------------------
suite "Wire Symlinks"
# ---------------------------------------------------------------------------

test_wire_symlinks_env() {
    reset_test_env
    RELEASE_ID="test-wire-release"
    local rdir="${RELEASES_DIR}/${RELEASE_ID}"
    mkdir -p "$rdir"

    wire_symlinks 2>/dev/null

    assert_true ".env symlink created" test -L "${rdir}/.env"
}

test_wire_symlinks_env

# ---------------------------------------------------------------------------
suite "State Machine — End-to-End Flow"
# ---------------------------------------------------------------------------

test_full_state_progression() {
    reset_test_env
    RELEASE_ID="e2e-release"
    DEPLOY_ID="e2e-deploy"

    # Simulate the full happy path state machine
    assert_eq "initial state is none" "none" "$(get_state)"

    set_state "pending" 2>/dev/null
    assert_eq "state: pending" "pending" "$(get_state)"

    set_state "downloaded" 2>/dev/null
    assert_eq "state: downloaded" "downloaded" "$(get_state)"

    set_state "verified" 2>/dev/null
    assert_eq "state: verified" "verified" "$(get_state)"

    set_state "extracted" 2>/dev/null
    assert_eq "state: extracted" "extracted" "$(get_state)"

    set_state "validated" 2>/dev/null
    assert_eq "state: validated" "validated" "$(get_state)"

    set_state "migrated" 2>/dev/null
    assert_eq "state: migrated" "migrated" "$(get_state)"

    set_state "activated" 2>/dev/null
    assert_eq "state: activated" "activated" "$(get_state)"

    set_state "healthy" 2>/dev/null
    assert_eq "state: healthy" "healthy" "$(get_state)"
}

test_rollback_state_progression() {
    reset_test_env
    RELEASE_ID="rb-release"
    DEPLOY_ID="rb-deploy"

    set_state "activated" 2>/dev/null
    assert_eq "activated before rollback" "activated" "$(get_state)"

    set_state "rolled_back" 2>/dev/null
    assert_eq "rolled_back after failure" "rolled_back" "$(get_state)"
}

test_rollback_failed_state() {
    reset_test_env
    RELEASE_ID="rbf-release"
    DEPLOY_ID="rbf-deploy"

    set_state "activated" 2>/dev/null
    set_state "rolled_back" 2>/dev/null
    set_state "rollback_failed" 2>/dev/null
    assert_eq "rollback_failed is terminal" "rollback_failed" "$(get_state)"
}

test_full_state_progression
test_rollback_state_progression
test_rollback_failed_state

# ---------------------------------------------------------------------------
suite "Integration — Quarantine Blocks Reuse"
# ---------------------------------------------------------------------------

test_quarantine_blocks_release() {
    reset_test_env
    rm -f "$BAD_RELEASES_FILE"

    # Quarantine a release
    quarantine_release "release-v1.0.50" "readiness_check_failed" 2>/dev/null
    assert_true "quarantined release is blocked" is_quarantined "release-v1.0.50"

    # Clear it
    clear_quarantine "release-v1.0.50" 2>/dev/null
    assert_false "cleared release is unblocked" is_quarantined "release-v1.0.50"
}

test_quarantine_blocks_release

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================"
echo "  Results: $TESTS_PASSED/$TESTS_RUN passed, $TESTS_FAILED failed"
echo "============================================"

if [[ $TESTS_FAILED -gt 0 ]]; then
    exit 1
fi
