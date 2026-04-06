#!/usr/bin/env bash
# =============================================================================
# test-installer-modules.sh -- Dry-run validation for installer modules
# =============================================================================
# Validates:
#   1. All installer modules can be sourced without error
#   2. All expected run_* functions are defined after sourcing
#   3. The STAGES array in installer.run matches the module files on disk
#   4. Error codes are complete (no gaps in required range anchors)
#   5. Support libraries source cleanly
#
# Compatible with Bash 3.2+ (macOS) and Bash 4+ (Ubuntu CI).
#
# Usage:
#   bash scripts/tests/test-installer-modules.sh
# =============================================================================
set -euo pipefail

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODULES_DIR="$SCRIPT_DIR/public/installer-modules"
LIB_DIR="$MODULES_DIR/lib"

# ── Test framework ───────────────────────────────────────────────────────────

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

assert_true() {
  local desc="$1" cond="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if [[ "$cond" == "true" ]]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: $desc"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: $desc"
  fi
}

assert_defined() {
  local desc="$1" func_name="$2"
  TESTS_RUN=$((TESTS_RUN + 1))
  if declare -F "$func_name" >/dev/null 2>&1; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "  PASS: $desc"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "  FAIL: $desc (function '$func_name' not defined)"
  fi
}

# ── Stubs for functions that modules expect from the orchestrator ────────────

log() { :; }
warn() { :; }
err() { :; }
err_code() { :; }
header() { :; }
track_warn() { :; }
start_timer() { :; }
end_timer() { :; }
run_with_progress() { :; }
export -f log warn err err_code header track_warn start_timer end_timer run_with_progress 2>/dev/null || true

# ── Stub variables with safe defaults ────────────────────────────────────────

APP_BASE="/opt/gwi-pos"
APP_DIR="/opt/gwi-pos/app"
POSUSER="gwipos"
POSUSER_HOME="/home/gwipos"
STATION_ROLE="server"
MC_URL="https://example.com"
POS_BASE_URL="https://example.com"
VENUE_CODE="test"
DRY_RUN="true"
INSTALLER_VERSION="0.0.0-test"
SHARED_DIR="/opt/gwi-pos/shared"
STATE_DIR="/opt/gwi-pos/shared/state"
DB_NAME="thepasspos"
DB_USER="thepasspos"
DB_PASS="testpass"
DATABASE_URL="postgresql://test:test@localhost:5432/test"
NEON_DATABASE_URL="postgresql://test:test@localhost:5432/test"
GIT_REPO_URL="https://example.com/repo.git"
DEPLOY_KEY_PATH="/tmp/test-deploy-key"
export APP_BASE APP_DIR POSUSER POSUSER_HOME STATION_ROLE MC_URL POS_BASE_URL
export VENUE_CODE DRY_RUN INSTALLER_VERSION SHARED_DIR STATE_DIR
export DB_NAME DB_USER DB_PASS DATABASE_URL NEON_DATABASE_URL
export GIT_REPO_URL DEPLOY_KEY_PATH

# ── Bash version detection ───────────────────────────────────────────────────

BASH_MAJOR="${BASH_VERSINFO[0]}"
ERROR_CODES_FILE="$LIB_DIR/error-codes.sh"

# ── Stage number lookup (Bash 3.2-compatible, no associative arrays) ─────────

stage_num_for() {
  case "$1" in
    preflight)         echo "01" ;;
    register)          echo "02" ;;
    secrets)           echo "03" ;;
    database)          echo "04" ;;
    deploy_app)        echo "05" ;;
    schema)            echo "06" ;;
    services)          echo "07" ;;
    ha)                echo "08" ;;
    remote_access)     echo "09" ;;
    finalize)          echo "10" ;;
    system_hardening)  echo "11" ;;
    dashboard)         echo "12" ;;
    *)                 echo "" ;;
  esac
}

# ── Preflight: verify module directory exists ────────────────────────────────

if [[ ! -d "$MODULES_DIR" ]]; then
  echo "FATAL: Modules directory not found at $MODULES_DIR"
  exit 1
fi

if [[ ! -d "$LIB_DIR" ]]; then
  echo "FATAL: Library directory not found at $LIB_DIR"
  exit 1
fi

# =============================================================================
echo "=== Test 1: All modules source without error ==="
# =============================================================================

for mod in "$MODULES_DIR"/*.sh; do
  mod_name=$(basename "$mod")
  # Source in a subshell to isolate side effects and prevent real system calls
  if ( source "$mod" ) 2>/dev/null; then
    assert_true "Module $mod_name sources cleanly" "true"
  else
    assert_true "Module $mod_name sources cleanly" "false"
  fi
done

# =============================================================================
echo ""
echo "=== Test 2: All run_* functions defined ==="
# =============================================================================

# Source all modules in the current shell (like installer.run does)
for mod in "$MODULES_DIR"/*.sh; do
  source "$mod" 2>/dev/null || true
done

# These function names match the STAGES array in installer.run:
#   STAGES=(preflight register secrets database deploy_app schema services
#           ha remote_access finalize system_hardening dashboard)
EXPECTED_FUNCTIONS=(
  "run_preflight"
  "run_register"
  "run_secrets"
  "run_database"
  "run_deploy_app"
  "run_schema"
  "run_services"
  "run_ha"
  "run_remote_access"
  "run_finalize"
  "run_system_hardening"
  "run_dashboard"
)

for func in "${EXPECTED_FUNCTIONS[@]}"; do
  assert_defined "Function $func exists" "$func"
done

# =============================================================================
echo ""
echo "=== Test 3: Stage array matches module files on disk ==="
# =============================================================================

# The STAGES array in installer.run defines the canonical stage order.
# Each stage "foo" must have a corresponding NN-foo.sh (or NN-foo-bar.sh) file.
STAGES=(preflight register secrets database deploy_app schema services ha remote_access finalize system_hardening dashboard)

for stage in "${STAGES[@]}"; do
  num=$(stage_num_for "$stage")
  if [[ -z "$num" ]]; then
    assert_true "Stage '$stage' has known number mapping" "false"
    continue
  fi

  expected_file="$MODULES_DIR/${num}-${stage}.sh"
  if [[ -f "$expected_file" ]]; then
    assert_true "Stage '$stage' has module file ${num}-${stage}.sh" "true"
  else
    # Try with hyphens instead of underscores (deploy_app -> deploy-app)
    alt_name="${stage//_/-}"
    alt_file="$MODULES_DIR/${num}-${alt_name}.sh"
    if [[ -f "$alt_file" ]]; then
      assert_true "Stage '$stage' has module file ${num}-${alt_name}.sh" "true"
    else
      assert_true "Stage '$stage' has module file ${num}-${stage}.sh" "false"
    fi
  fi
done

# Check for orphan module files (files without a matching STAGES entry)
for mod in "$MODULES_DIR"/*.sh; do
  mod_name=$(basename "$mod" .sh)
  # Skip non-stage files bundled in installer-modules (e.g., gwi-node.sh)
  [[ "$mod_name" == "gwi-node" ]] && continue
  # Strip leading number and dash: "01-preflight" -> "preflight"
  stage_name="${mod_name#[0-9][0-9]-}"
  # Convert hyphens to underscores for matching: "deploy-app" -> "deploy_app"
  stage_name="${stage_name//-/_}"

  found=false
  for stage in "${STAGES[@]}"; do
    if [[ "$stage" == "$stage_name" ]]; then
      found=true
      break
    fi
  done
  assert_true "Module $mod_name has matching STAGES entry" "$found"
done

# =============================================================================
echo ""
echo "=== Test 4: Support libraries source cleanly ==="
# =============================================================================

for lib in "$LIB_DIR"/*.sh; do
  lib_name=$(basename "$lib")
  # error-codes.sh uses declare -A (Bash 4+ only). On Bash 3 (macOS), skip
  # the subshell source test and validate via grep in Test 5 instead.
  if [[ "$lib_name" == "error-codes.sh" && "$BASH_MAJOR" -lt 4 ]]; then
    assert_true "Library $lib_name skipped (requires Bash 4+ for declare -A)" "true"
    continue
  fi
  if ( source "$lib" ) 2>/dev/null; then
    assert_true "Library $lib_name sources cleanly" "true"
  else
    assert_true "Library $lib_name sources cleanly" "false"
  fi
done

# =============================================================================
echo ""
echo "=== Test 5: Error codes library complete ==="
# =============================================================================

# Error codes use declare -A (Bash 4+). On Bash 3 (macOS), fall back to
# grep-based validation of the source file.
if [[ "$BASH_MAJOR" -ge 4 ]]; then
  # Bash 4+: source the file and inspect the associative array directly
  source "$ERROR_CODES_FILE" 2>/dev/null || true

  if declare -p GWI_ERROR_CODES &>/dev/null; then
    assert_true "GWI_ERROR_CODES associative array exists" "true"

    # Each stage range must have at least its anchor code defined.
    REQUIRED_ANCHOR_CODES=(
      "ERR-INST-001"   # Preflight
      "ERR-INST-050"   # Registration
      "ERR-INST-100"   # Secrets
      "ERR-INST-120"   # Database
      "ERR-INST-150"   # Deploy
      "ERR-INST-180"   # Schema
      "ERR-INST-210"   # Services
      "ERR-INST-240"   # HA
      "ERR-INST-280"   # Finalize
      "ERR-INST-300"   # Hardening
      "ERR-INST-330"   # Dashboard
      "ERR-UPD-400"    # Update
      "ERR-WDG-450"    # Watchdog
    )

    for code in "${REQUIRED_ANCHOR_CODES[@]}"; do
      if [[ -n "${GWI_ERROR_CODES[$code]:-}" ]]; then
        assert_true "Error code $code defined" "true"
      else
        assert_true "Error code $code defined" "false"
      fi
    done

    # Verify minimum total count
    code_count=${#GWI_ERROR_CODES[@]}
    if [[ $code_count -ge 50 ]]; then
      assert_true "At least 50 error codes defined (got $code_count)" "true"
    else
      assert_true "At least 50 error codes defined (got $code_count)" "false"
    fi

    # Verify no empty descriptions
    empty_desc=0
    for code in "${!GWI_ERROR_CODES[@]}"; do
      if [[ -z "${GWI_ERROR_CODES[$code]}" ]]; then
        empty_desc=$((empty_desc + 1))
        echo "  WARN: Error code $code has empty description"
      fi
    done
    if [[ $empty_desc -eq 0 ]]; then
      assert_true "No error codes have empty descriptions" "true"
    else
      assert_true "No error codes have empty descriptions" "false"
    fi
  else
    assert_true "GWI_ERROR_CODES associative array exists" "false"
  fi
else
  # Bash 3.x (macOS): validate via grep on the source file
  echo "  (Bash $BASH_MAJOR detected -- using grep-based error code validation)"

  if [[ -f "$ERROR_CODES_FILE" ]]; then
    assert_true "Error codes file exists" "true"
  else
    assert_true "Error codes file exists" "false"
  fi

  REQUIRED_ANCHOR_CODES=(
    "ERR-INST-001"
    "ERR-INST-050"
    "ERR-INST-100"
    "ERR-INST-120"
    "ERR-INST-150"
    "ERR-INST-180"
    "ERR-INST-210"
    "ERR-INST-240"
    "ERR-INST-280"
    "ERR-INST-300"
    "ERR-INST-330"
    "ERR-UPD-400"
    "ERR-WDG-450"
  )

  for code in "${REQUIRED_ANCHOR_CODES[@]}"; do
    if grep -q "\[$code\]" "$ERROR_CODES_FILE" 2>/dev/null; then
      assert_true "Error code $code defined" "true"
    else
      assert_true "Error code $code defined" "false"
    fi
  done

  # Count total error code lines
  code_count=$(grep -c 'GWI_ERROR_CODES\[' "$ERROR_CODES_FILE" 2>/dev/null || echo 0)
  if [[ $code_count -ge 50 ]]; then
    assert_true "At least 50 error codes defined (got $code_count)" "true"
  else
    assert_true "At least 50 error codes defined (got $code_count)" "false"
  fi

  # Check for empty descriptions (assignment with empty string)
  empty_lines="$(grep -c 'GWI_ERROR_CODES\[.*\]=""' "$ERROR_CODES_FILE" 2>/dev/null)" || empty_lines=0
  if [[ "$empty_lines" -eq 0 ]]; then
    assert_true "No error codes have empty descriptions" "true"
  else
    assert_true "No error codes have empty descriptions" "false"
  fi
fi

# =============================================================================
echo ""
echo "=== Test 6: Helper functions available ==="
# =============================================================================

# err_code and get_error_desc are defined in error-codes.sh.
# On Bash 3, sourcing may fail (declare -A), so check via grep fallback.
if [[ "$BASH_MAJOR" -ge 4 ]]; then
  # We already sourced error-codes.sh above
  if declare -F err_code >/dev/null 2>&1; then
    assert_true "err_code function exists" "true"
  else
    assert_true "err_code function exists" "false"
  fi

  if declare -F get_error_desc >/dev/null 2>&1; then
    assert_true "get_error_desc function exists" "true"
  else
    assert_true "get_error_desc function exists" "false"
  fi
else
  # Bash 3 fallback: check the function is defined in the file
  if grep -q '^err_code()' "$ERROR_CODES_FILE" 2>/dev/null; then
    assert_true "err_code function defined in error-codes.sh" "true"
  else
    assert_true "err_code function defined in error-codes.sh" "false"
  fi

  if grep -q '^get_error_desc()' "$ERROR_CODES_FILE" 2>/dev/null; then
    assert_true "get_error_desc function defined in error-codes.sh" "true"
  else
    assert_true "get_error_desc function defined in error-codes.sh" "false"
  fi
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "==========================================="
echo "  Results: $TESTS_PASSED/$TESTS_RUN passed"
if [[ $TESTS_FAILED -gt 0 ]]; then
  echo "  FAILED: $TESTS_FAILED test(s)"
  echo "==========================================="
  exit 1
else
  echo "  All tests passed."
  echo "==========================================="
  exit 0
fi
