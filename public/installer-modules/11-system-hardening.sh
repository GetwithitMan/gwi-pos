#!/usr/bin/env bash
# =============================================================================
# 11-system-hardening.sh — Stage 11: Ansible Baseline Enforcement
# =============================================================================
# Entry: run_system_hardening
# Expects: APP_BASE, APP_DIR, ENV_FILE, POSUSER, STATION_ROLE, SERVER_NODE_ID
# Uses:    header(), log(), warn(), err(), track_warn(), start_timer(), end_timer()
#
# Bootstraps a pinned Ansible venv, acquires the shared baseline execution
# lock, runs the versioned site.yml playbook, and writes structured JSON
# artifacts for all outcomes (success, warning, failure, skip).
#
# Environment overrides:
#   HARDENING_TAGS       — Ansible --tags filter (e.g. "firewall,sshd_hardening")
#   SKIP_HARDENING_TAGS  — Ansible --skip-tags filter (e.g. "branding,optional")
#   HARDENING_DRY_RUN    — Set to "true" for check mode (--check)
# =============================================================================

run_system_hardening() {
  start_timer
  header "Stage 11: System Hardening (Ansible Baseline)"

  # ─────────────────────────────────────────────────────────────────────────
  # Constants
  # ─────────────────────────────────────────────────────────────────────────
  local STATE_DIR="$APP_BASE/state"
  local LOCK_FILE="$STATE_DIR/baseline.lock"
  local RUN_STATE_FILE="$STATE_DIR/run-state.json"
  local RESULT_FILE="$STATE_DIR/stage11-result.json"
  local ANSIBLE_RESULT_FILE="$STATE_DIR/ansible-result.json"
  local ANSIBLE_STDERR_FILE="$STATE_DIR/ansible-stderr.log"
  local EVENTS_FILE="$STATE_DIR/install-events.jsonl"
  local ANSIBLE_DIR="$APP_DIR/installer"
  local SITE_YML="$ANSIBLE_DIR/site.yml"
  local VERSION_FILE="$ANSIBLE_DIR/VERSION"
  local VENV_DIR="$APP_BASE/.ansible-venv"
  local ANSIBLE_BIN="$VENV_DIR/bin/ansible-playbook"
  local PINNED_ANSIBLE_VERSION="2.16.4"
  local TRIGGERED_BY="installer"
  local RUN_START
  RUN_START=$(date +%s)

  # ─────────────────────────────────────────────────────────────────────────
  # Helpers
  # ─────────────────────────────────────────────────────────────────────────

  # ISO 8601 UTC timestamp
  _iso_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

  # Read baseline version from VERSION file
  _read_baseline_version() {
    if [[ -f "$VERSION_FILE" ]]; then
      cat "$VERSION_FILE" | tr -d '[:space:]'
    else
      echo "unknown"
    fi
  }

  # Read SERVER_NODE_ID from .env if not already set
  _read_node_id() {
    if [[ -n "${SERVER_NODE_ID:-}" ]]; then
      echo "$SERVER_NODE_ID"
      return
    fi
    if [[ -f "$ENV_FILE" ]]; then
      grep -m1 '^SERVER_NODE_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo ""
    else
      echo ""
    fi
  }

  # Write run-state.json
  _write_run_state() {
    local state="$1"
    local extra="${2:-}"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)
    local boot_id=""
    if [[ -f /proc/sys/kernel/random/boot_id ]]; then
      boot_id=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "")
    fi

    cat > "$RUN_STATE_FILE" <<RUNSTATE_EOF
{
  "schema_version": "1.0",
  "producer": "11-system-hardening.sh",
  "generated_at": "$(_iso_now)",
  "node_id": "$node_id",
  "baseline_version": "$baseline_version",
  "state": "$state",
  "pid": $$,
  "started_at": "$(_iso_now)",
  "triggered_by": "$TRIGGERED_BY",
  "host_boot_id": "$boot_id"${extra:+,
  $extra}
}
RUNSTATE_EOF
  }

  # Write stage11-result.json
  _write_result() {
    local outcome="$1"
    local ansible_exit="$2"
    local duration="$3"
    local changed_count="${4:-0}"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)

    cat > "$RESULT_FILE" <<RESULT_EOF
{
  "schema_version": "1.0",
  "producer": "11-system-hardening.sh",
  "generated_at": "$(_iso_now)",
  "node_id": "$node_id",
  "baseline_version": "$baseline_version",
  "outcome": "$outcome",
  "ansible_exit_code": $ansible_exit,
  "duration_seconds": $duration,
  "changed_count": $changed_count,
  "failed_tasks": [],
  "optional_warnings": [],
  "triggered_by": "$TRIGGERED_BY"
}
RESULT_EOF
  }

  # Append event to install-events.jsonl
  _write_event() {
    local event_type="$1"
    local outcome="$2"
    local ansible_exit="$3"
    local duration="$4"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)

    echo "{\"schema_version\":\"1.0\",\"producer\":\"11-system-hardening.sh\",\"generated_at\":\"$(_iso_now)\",\"node_id\":\"$node_id\",\"baseline_version\":\"$baseline_version\",\"event\":\"$event_type\",\"outcome\":\"$outcome\",\"ansible_exit_code\":$ansible_exit,\"duration_seconds\":$duration,\"triggered_by\":\"$TRIGGERED_BY\"}" >> "$EVENTS_FILE"
  }

  # Extract changed count from ansible-result.json stats
  # Returns: integer (0 if unavailable)
  _extract_changed_count() {
    local result_file="$1"
    if [[ ! -f "$result_file" ]] || [[ ! -s "$result_file" ]]; then
      echo "0"
      return
    fi
    local count
    count=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    total = sum(h.get('changed', 0) for h in data.get('stats', {}).values())
    print(total)
except Exception:
    print(0)
" "$result_file" 2>/dev/null)
    echo "${count:-0}"
  }

  # Parse ansible-result.json to classify outcome
  # Returns: success | success_with_warnings | failed_required | skipped_unavailable
  _classify_outcome() {
    local result_file="$1"
    local exit_code="$2"

    # If ansible never ran or produced no output
    if [[ ! -f "$result_file" ]] || [[ ! -s "$result_file" ]]; then
      if [[ "$exit_code" -eq 0 ]]; then
        echo "success"
      else
        echo "failed_required"
      fi
      return
    fi

    # Validate JSON before parsing
    if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$result_file" 2>/dev/null; then
      warn "ansible-result.json is not valid JSON — classifying as failed"
      echo "failed_required"
      return
    fi

    # Parse the JSON callback output for failure/unreachable counts
    local parse_result
    parse_result=$(python3 <<'PARSE_EOF'
import json, sys

try:
    with open(sys.argv[1]) as f:
        data = json.load(f)

    stats = data.get("stats", {})
    has_failures = False
    has_unreachable = False

    for host, host_stats in stats.items():
        if host_stats.get("failures", 0) > 0:
            has_failures = True
        if host_stats.get("unreachable", 0) > 0:
            has_unreachable = True

    # Check for rescued tasks (warnings)
    has_rescued = False
    for host, host_stats in stats.items():
        if host_stats.get("rescued", 0) > 0:
            has_rescued = True

    if has_failures or has_unreachable:
        print("failed_required")
    elif has_rescued:
        print("success_with_warnings")
    else:
        print("success")
except Exception as e:
    print("failed_required", file=sys.stderr)
    print("failed_required")
PARSE_EOF
    "$result_file" 2>/dev/null)

    echo "${parse_result:-failed_required}"
  }

  # ─────────────────────────────────────────────────────────────────────────
  # Create state directory
  # ─────────────────────────────────────────────────────────────────────────
  mkdir -p "$STATE_DIR"
  chmod 755 "$STATE_DIR"

  # ─────────────────────────────────────────────────────────────────────────
  # Check for site.yml existence — graceful skip if baseline not yet shipped
  # ─────────────────────────────────────────────────────────────────────────
  if [[ ! -f "$SITE_YML" ]]; then
    log "Ansible baseline not found at $SITE_YML"

    # Determine if this is expected (pre-baseline node) or an error
    if [[ -f "$VERSION_FILE" ]]; then
      # VERSION exists but site.yml missing — something is broken
      warn "installer/VERSION exists but site.yml is missing — baseline incomplete"
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: baseline files incomplete (site.yml missing)"
    else
      # No baseline files at all — pre-baseline node, clean skip
      log "No baseline files present — skipping system hardening (pre-baseline node)"
      _write_result "skipped_unavailable" 0 0
      _write_event "baseline_run" "skipped_unavailable" 0 0
    fi

    end_timer "Stage 11: System Hardening"
    return 0
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Bootstrap Ansible in a pinned virtualenv
  # ─────────────────────────────────────────────────────────────────────────
  if [[ ! -x "$ANSIBLE_BIN" ]]; then
    log "Bootstrapping Ansible $PINNED_ANSIBLE_VERSION in virtualenv..."

    # Ensure python3-venv is available
    if ! python3 -m venv --help >/dev/null 2>&1; then
      log "Installing python3-venv..."
      local PY_VERSION
      PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "3")
      apt-get update -qq && apt-get install -y -qq "python${PY_VERSION}-venv" python3-venv >/dev/null 2>&1
      if [[ $? -ne 0 ]]; then
        warn "Failed to install python3-venv — cannot bootstrap Ansible"
        _write_run_state "degraded"
        _write_result "failed_required" 1 0
        _write_event "baseline_run" "failed_required" 1 0
        track_warn "System hardening: python3-venv installation failed"
        end_timer "Stage 11: System Hardening"
        return 0
      fi
    fi

    # Create venv and install pinned ansible-core
    python3 -m venv "$VENV_DIR" 2>/dev/null
    if [[ $? -ne 0 ]]; then
      warn "Failed to create Python virtualenv at $VENV_DIR"
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: virtualenv creation failed"
      end_timer "Stage 11: System Hardening"
      return 0
    fi

    "$VENV_DIR/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1
    "$VENV_DIR/bin/pip" install --quiet "ansible-core==$PINNED_ANSIBLE_VERSION" >/dev/null 2>&1
    if [[ $? -ne 0 ]]; then
      warn "Failed to install ansible-core==$PINNED_ANSIBLE_VERSION"
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: ansible-core installation failed"
      end_timer "Stage 11: System Hardening"
      return 0
    fi

    log "Ansible bootstrapped: $("$ANSIBLE_BIN" --version 2>/dev/null | head -1)"
  else
    # Verify pinned version matches
    local installed_version
    installed_version=$("$VENV_DIR/bin/ansible" --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
    if [[ "$installed_version" != "$PINNED_ANSIBLE_VERSION" ]]; then
      log "Ansible version mismatch (have $installed_version, want $PINNED_ANSIBLE_VERSION) — upgrading..."
      "$VENV_DIR/bin/pip" install --quiet "ansible-core==$PINNED_ANSIBLE_VERSION" >/dev/null 2>&1
    fi
  fi

  # Final check that ansible-playbook binary works
  if [[ ! -x "$ANSIBLE_BIN" ]]; then
    warn "ansible-playbook not found at $ANSIBLE_BIN after bootstrap"
    _write_run_state "degraded"
    _write_result "failed_required" 1 0
    _write_event "baseline_run" "failed_required" 1 0
    track_warn "System hardening: ansible-playbook binary not executable"
    end_timer "Stage 11: System Hardening"
    return 0
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Resolve variables for Ansible extra-vars
  # ─────────────────────────────────────────────────────────────────────────
  local _posuser="${POSUSER:-gwipos}"
  local _station_role="${STATION_ROLE:-server}"

  # ─────────────────────────────────────────────────────────────────────────
  # Acquire execution lock via flock
  # ─────────────────────────────────────────────────────────────────────────
  log "Acquiring baseline execution lock..."

  # Create lock file parent if needed (state dir already created above)
  touch "$LOCK_FILE"

  # Open lock fd for the remainder of the subshell
  exec 9>"$LOCK_FILE"

  if ! flock -w 300 9; then
    warn "Could not acquire baseline lock within 300 seconds — another baseline run may be in progress"
    _write_run_state "idle" "\"lock_wait_timeout\": true"
    _write_result "failed_required" 1 0
    _write_event "baseline_run" "failed_required" 1 0
    track_warn "System hardening: lock acquisition timeout (300s)"
    exec 9>&-
    end_timer "Stage 11: System Hardening"
    return 0
  fi

  log "Lock acquired (PID $$)"

  # ─────────────────────────────────────────────────────────────────────────
  # Update run-state: idle → running
  # ─────────────────────────────────────────────────────────────────────────
  _write_run_state "running"

  # ─────────────────────────────────────────────────────────────────────────
  # Build ansible-playbook command
  # ─────────────────────────────────────────────────────────────────────────
  local ANSIBLE_CMD=(
    "$ANSIBLE_BIN"
    "-i" "$ANSIBLE_DIR/inventory/local.yml"
    "$SITE_YML"
    "--extra-vars" "gwi_posuser=$_posuser gwi_station_role=$_station_role"
  )

  # Tag filtering via environment variables
  if [[ -n "${HARDENING_TAGS:-}" ]]; then
    ANSIBLE_CMD+=("--tags" "$HARDENING_TAGS")
    log "Tag filter: --tags $HARDENING_TAGS"
  fi

  if [[ -n "${SKIP_HARDENING_TAGS:-}" ]]; then
    ANSIBLE_CMD+=("--skip-tags" "$SKIP_HARDENING_TAGS")
    log "Tag filter: --skip-tags $SKIP_HARDENING_TAGS"
  fi

  # Dry-run / check mode
  if [[ "${HARDENING_DRY_RUN:-}" == "true" ]]; then
    ANSIBLE_CMD+=("--check")
    log "Running in CHECK (dry-run) mode"
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Execute Ansible with JSON callback
  # ─────────────────────────────────────────────────────────────────────────
  log "Running Ansible baseline enforcement..."
  log "  Playbook: $SITE_YML"
  log "  Station role: $_station_role"
  log "  POS user: $_posuser"
  log "  Baseline version: $(_read_baseline_version)"

  local ansible_exit=0

  # ANSIBLE_STDOUT_CALLBACK=json sends structured JSON to stdout.
  # Stdout goes ONLY to ansible-result.json (no tee). Stderr to separate log.
  ANSIBLE_STDOUT_CALLBACK=json \
  ANSIBLE_CONFIG="$ANSIBLE_DIR/ansible.cfg" \
  ANSIBLE_FORCE_COLOR=0 \
    "${ANSIBLE_CMD[@]}" \
    > "$ANSIBLE_RESULT_FILE" \
    2> "$ANSIBLE_STDERR_FILE" \
    || ansible_exit=$?

  # ─────────────────────────────────────────────────────────────────────────
  # Calculate duration
  # ─────────────────────────────────────────────────────────────────────────
  local run_end
  run_end=$(date +%s)
  local duration=$(( run_end - RUN_START ))

  # ─────────────────────────────────────────────────────────────────────────
  # Classify outcome from ansible-result.json
  # ─────────────────────────────────────────────────────────────────────────
  local outcome
  outcome=$(_classify_outcome "$ANSIBLE_RESULT_FILE" "$ansible_exit")

  local changed_count
  changed_count=$(_extract_changed_count "$ANSIBLE_RESULT_FILE")

  log "Ansible completed: exit_code=$ansible_exit outcome=$outcome changed=$changed_count duration=${duration}s"

  # ─────────────────────────────────────────────────────────────────────────
  # Update run-state based on outcome
  # ─────────────────────────────────────────────────────────────────────────
  case "$outcome" in
    success)
      _write_run_state "idle"
      log "Baseline enforcement completed successfully"
      ;;
    success_with_warnings)
      _write_run_state "idle"
      warn "Baseline enforcement completed with warnings"
      track_warn "System hardening: completed with warnings (check ansible-stderr.log)"
      ;;
    failed_required)
      _write_run_state "degraded"
      warn "Baseline enforcement had required-role failures"
      track_warn "System hardening: required role(s) failed (exit=$ansible_exit)"
      ;;
    skipped_unavailable)
      _write_run_state "idle"
      log "Baseline enforcement skipped (not applicable)"
      ;;
    *)
      _write_run_state "degraded"
      warn "Baseline enforcement: unknown outcome '$outcome'"
      track_warn "System hardening: unknown outcome '$outcome' (exit=$ansible_exit)"
      ;;
  esac

  # ─────────────────────────────────────────────────────────────────────────
  # Write stage11-result.json
  # ─────────────────────────────────────────────────────────────────────────
  _write_result "$outcome" "$ansible_exit" "$duration" "$changed_count"

  # ─────────────────────────────────────────────────────────────────────────
  # Append install event to install-events.jsonl
  # ─────────────────────────────────────────────────────────────────────────
  _write_event "baseline_run" "$outcome" "$ansible_exit" "$duration"

  # ─────────────────────────────────────────────────────────────────────────
  # Release lock (fd 9 closed when function exits, but be explicit)
  # ─────────────────────────────────────────────────────────────────────────
  exec 9>&-
  log "Baseline lock released"

  # ─────────────────────────────────────────────────────────────────────────
  # Phase A rollout policy: always return 0 (non-fatal)
  # The outcome is recorded in stage11-result.json for MC to evaluate.
  # After 3+ venues, 2+ weeks stable → promote to fail-closed.
  # ─────────────────────────────────────────────────────────────────────────

  end_timer "Stage 11: System Hardening"
  return 0
}
