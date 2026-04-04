#!/usr/bin/env bash
# gwi-node.sh — GWI POS node agent (install | deploy | rollback | status | self-update | watch)
# One agent. One runtime. One flow. Install and update are the same operation.
set -euo pipefail

readonly BASE_DIR="/opt/gwi-pos"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly STATE_DIR="${SHARED_DIR}/state"
readonly LOG_DIR="${SHARED_DIR}/logs/deploys"
readonly LOCK_FILE="${STATE_DIR}/gwi-node.lock"
readonly VERSION_FILE="${STATE_DIR}/running-version.json"
readonly PREVIOUS_IMAGE_FILE="${STATE_DIR}/previous-image.txt"
readonly REQUESTS_DIR="${STATE_DIR}/deploy-requests"
readonly RESULTS_DIR="${STATE_DIR}/deploy-results"
readonly CONTAINER_NAME="gwi-pos"
readonly AGENT_CONTAINER_NAME="gwi-agent"
readonly R2_ORIGIN="https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev"
readonly LOCK_TIMEOUT=300 HEALTH_MAX_ATTEMPTS=30 HEALTH_INTERVAL=2 HEALTH_CONSECUTIVE=3
ENV_FILE="${SHARED_DIR}/.env"; [[ -f "$ENV_FILE" ]] || ENV_FILE="${BASE_DIR}/.env"; readonly ENV_FILE

DEPLOY_ID="" DEPLOY_START=0 IMAGE_REF="" IMAGE_DIGEST="" PREVIOUS_IMAGE=""
MANIFEST_URL="${R2_ORIGIN}/latest/manifest.json" FORCE=false FINAL_STATUS="pending"
SCHEMA_RESULT="" ROLLBACK_RESULT="" ROLLBACK_READINESS="" LOCK_FD="" ERRORS=()
WATCH_MODE=false WATCH_DIE_FIRED=false

log() { echo "[gwi-node] $(date -u +%FT%TZ) $*"; }
err() { echo "[gwi-node] $(date -u +%FT%TZ) ERROR: $*" >&2; ERRORS+=("$*"); }

read_port() {
  local port=3005
  if [[ -f "$ENV_FILE" ]]; then
    port="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]' || echo 3005)"
    [[ -z "$port" ]] && port=3005
  fi
  echo "$port"
}

gen_deploy_id() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null \
    || python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null \
    || date +%s-%N
}

write_deploy_log() {
  mkdir -p "$LOG_DIR"
  local now duration_ms hostname_val errors_json diag_json log_file
  now="$(date -u +%FT%TZ)"
  duration_ms=$(( ($(date +%s) - DEPLOY_START) * 1000 ))
  hostname_val="$(hostname 2>/dev/null || echo unknown)"
  errors_json="[]"
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    errors_json="$(printf '%s\n' "${ERRORS[@]}" | jq -R . 2>/dev/null | jq -s . 2>/dev/null || echo '[]')"
  fi
  diag_json="null"
  if [[ -n "${DIAG_FILE:-}" ]] && [[ -f "${DIAG_FILE:-}" ]]; then
    diag_json="$(jq -Rs . < "$DIAG_FILE" 2>/dev/null || echo null)"
  fi
  log_file="${LOG_DIR}/${now//[:.]/-}.json"
  cat > "$log_file" <<DEOF
{
  "deployId": "${DEPLOY_ID}",
  "timestamp": "${now}",
  "hostname": "${hostname_val}",
  "imageRef": "${IMAGE_REF}",
  "imageDigest": "${IMAGE_DIGEST:-}",
  "previousImage": "${PREVIOUS_IMAGE:-}",
  "manifestUrl": "${MANIFEST_URL:-}",
  "finalStatus": "${FINAL_STATUS}",
  "schemaResult": "${SCHEMA_RESULT:-}",
  "rollbackResult": "${ROLLBACK_RESULT:-}",
  "rollbackReadinessResult": "${ROLLBACK_READINESS:-}",
  "diagnostics": ${diag_json},
  "durationMs": ${duration_ms},
  "errors": ${errors_json},
  "deployMethod": "docker"
}
DEOF
  chmod 644 "$log_file" 2>/dev/null || true
  log "Deploy log: $log_file"
}

die() {
  err "$*"; FINAL_STATUS="failed"; write_deploy_log
  if [[ "$WATCH_MODE" == true ]]; then
    # Return 0 so set -e does not kill the watch loop.
    # Watch loop reads FINAL_STATUS to detect failure.
    WATCH_DIE_FIRED=true; return 0
  else
    exit 1
  fi
}

health_check() {
  local port label url consecutive=0
  port="$(read_port)"
  label="${1:-}"
  url="http://localhost:${port}/api/health/ready"
  healthy=false
  for attempt in $(seq 1 "$HEALTH_MAX_ATTEMPTS"); do
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      consecutive=$((consecutive + 1))
      log "${label}Health OK ($consecutive/$HEALTH_CONSECUTIVE) [attempt $attempt/$HEALTH_MAX_ATTEMPTS]"
      [[ $consecutive -ge $HEALTH_CONSECUTIVE ]] && { healthy=true; return; }
    else
      consecutive=0
      log "${label}Health HTTP $code [attempt $attempt/$HEALTH_MAX_ATTEMPTS]"
    fi
    sleep "$HEALTH_INTERVAL"
  done
}

capture_diagnostics() {
  DIAG_FILE="${LOG_DIR}/diag-${DEPLOY_ID}.txt"
  {
    echo "=== Docker containers ==="
    docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || true
    echo "=== Container logs (last 50 lines) ==="
    docker logs "$CONTAINER_NAME" 2>&1 | tail -50 || true
    echo "=== systemd thepasspos ==="
    systemctl is-active thepasspos 2>/dev/null || echo "inactive"
  } > "$DIAG_FILE" 2>/dev/null || true
}

start_container() {
  docker run -d --name "$CONTAINER_NAME" --restart=unless-stopped \
    --network=host --env-file "$ENV_FILE" -v "${SHARED_DIR}:${SHARED_DIR}" "$1"
}

start_agent() {
  log "Starting gwi-agent..."
  docker stop "$AGENT_CONTAINER_NAME" 2>/dev/null || true
  docker rm "$AGENT_CONTAINER_NAME" 2>/dev/null || true
  docker run -d --name "$AGENT_CONTAINER_NAME" \
    --restart=unless-stopped \
    --network=host \
    --user root \
    --env-file "$ENV_FILE" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${SHARED_DIR}:${SHARED_DIR}" \
    "$1" \
    node public/sync-agent.js
  log "gwi-agent started"
}

systemd_last_resort() {
  # Legacy services are masked — no fallback runtime exists.
  # Log the failure state so it surfaces in deploy logs and MC.
  log "CRITICAL: Deploy and rollback both failed. No fallback runtime available."
  log "CRITICAL: Venue may be down. Check journalctl -u gwi-node and docker ps."
}

cleanup() {
  local rc=$?
  [[ -n "${LOCK_FD:-}" ]] && flock -u "$LOCK_FD" 2>/dev/null || true
  if [[ $rc -ne 0 ]] && [[ "$FINAL_STATUS" == "pending" ]]; then
    FINAL_STATUS="failed"
    write_deploy_log 2>/dev/null || true
  fi
}

deploy() {
  DEPLOY_ID="$(gen_deploy_id)"; DEPLOY_START="$(date +%s)"
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  exec {LOCK_FD}>"$LOCK_FILE"
  flock -w "$LOCK_TIMEOUT" "$LOCK_FD" || die "Could not acquire lock (another deploy running?)"
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  # In watch mode, skip the EXIT trap — watch_loop manages its own lifecycle.
  # Cleanup (lock release) happens via reset_deploy_state between dispatches.
  [[ "$WATCH_MODE" != true ]] && trap 'cleanup' EXIT
  log "Deploy $DEPLOY_ID starting"
  if [[ -z "$IMAGE_REF" ]]; then
    log "Fetching manifest: $MANIFEST_URL"
    local manifest
    manifest="$(curl -fsSL --max-time 30 "$MANIFEST_URL")" || die "Failed to fetch manifest"
    [[ "$WATCH_DIE_FIRED" == true ]] && return 1
    IMAGE_REF="$(echo "$manifest" | jq -r '.imageRef // empty')"
    [[ -n "$IMAGE_REF" ]] || die "Manifest missing imageRef"
    [[ "$WATCH_DIE_FIRED" == true ]] && return 1
    [[ -z "$IMAGE_DIGEST" ]] && IMAGE_DIGEST="$(echo "$manifest" | jq -r '.imageDigest // empty' || true)"
    log "Manifest resolved: image=$IMAGE_REF digest=${IMAGE_DIGEST:-none}"
  fi

  PREVIOUS_IMAGE="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [[ -n "$PREVIOUS_IMAGE" ]] && echo "$PREVIOUS_IMAGE" > "$PREVIOUS_IMAGE_FILE"
  log "Pulling: $IMAGE_REF"
  docker pull "$IMAGE_REF" || die "Failed to pull: $IMAGE_REF"
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  if [[ -n "$IMAGE_DIGEST" ]]; then
    local actual expected
    actual="$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE_REF" 2>/dev/null \
      | grep -oP 'sha256:[a-f0-9]+' || true)"
    expected="$(echo "$IMAGE_DIGEST" | grep -oP 'sha256:[a-f0-9]+')"
    if [[ "$actual" != "$expected" ]]; then
      [[ "$FORCE" == true ]] \
        && log "WARN: Digest mismatch (forced): expected=$expected actual=$actual" \
        || die "Digest mismatch: expected=$expected actual=$actual"
      [[ "$WATCH_DIE_FIRED" == true ]] && return 1
    fi
    log "Digest verified: $actual"
  fi
  log "Running schema migration (local PG)..."
  if docker run --rm --env-file "$ENV_FILE" --network=host "$IMAGE_REF" \
    node deploy-tools/src/migrate.js; then
    SCHEMA_RESULT="pass"
    log "Local migration complete"
  else
    SCHEMA_RESULT="fail"
    die "Local schema migration failed"
    [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  fi
  if grep -q "^NEON_DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
    log "Running schema migration (Neon)..."
    docker run --rm --env-file "$ENV_FILE" --network=host \
      -e NEON_MIGRATE=true "$IMAGE_REF" \
      node deploy-tools/src/migrate.js \
      && log "Neon migration complete" \
      || log "WARNING: Neon migration failed — continuing"
  fi
  log "Stopping old runtime..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
  docker stop "$AGENT_CONTAINER_NAME" 2>/dev/null || true
  docker rm "$AGENT_CONTAINER_NAME" 2>/dev/null || true
  systemctl stop thepasspos 2>/dev/null || true
  systemctl disable thepasspos 2>/dev/null || true
  systemctl stop thepasspos-sync 2>/dev/null || true
  systemctl disable thepasspos-sync 2>/dev/null || true
  log "Starting: $IMAGE_REF"
  start_container "$IMAGE_REF" || die "Failed to start container"
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  log "Waiting for health..."
  health_check ""
  [[ "$healthy" == true ]] && { deploy_success; return; }
  deploy_failure
}

deploy_success() {
  local tag="${IMAGE_REF##*:}"
  cat > "$VERSION_FILE" <<EOF
{
  "version": "${tag}",
  "imageRef": "${IMAGE_REF}",
  "imageDigest": "${IMAGE_DIGEST:-unknown}",
  "deployedAt": "$(date -u +%FT%TZ)",
  "deployId": "${DEPLOY_ID}",
  "deployMethod": "docker"
}
EOF
  chmod 644 "$VERSION_FILE" 2>/dev/null || true
  docker image prune -f --filter "dangling=true" 2>/dev/null || true
  start_agent "$IMAGE_REF" || log "WARN: gwi-agent failed to start (non-fatal)"

  # ── Self-bootstrap gwi-node.service for existing venue upgrades ───────────
  # On venues that upgraded via the old execSync path (no installer re-run),
  # gwi-node.service and trigger dirs don't exist yet. Bootstrap them here so
  # the next deploy uses the trigger-file protocol instead of the dead old path.
  if ! systemctl is-enabled gwi-node.service >/dev/null 2>&1 \
    && ! systemctl is-active gwi-node.service >/dev/null 2>&1; then
    log "Bootstrapping gwi-node.service (first trigger-file upgrade)..."
    local _ok=true

    # Extract both host artifacts from the newly deployed image
    local _sh_tmp="/tmp/gwi-node-bootstrap.sh"
    local _svc_tmp="/tmp/gwi-node-bootstrap.service"
    docker run --rm "$IMAGE_REF" cat /app/public/scripts/gwi-node.sh > "$_sh_tmp" 2>/dev/null || _ok=false
    docker run --rm "$IMAGE_REF" cat /app/public/scripts/gwi-node.service > "$_svc_tmp" 2>/dev/null || _ok=false

    if [[ "$_ok" == true ]] && [[ -s "$_sh_tmp" ]] && [[ -s "$_svc_tmp" ]]; then
      # Install host script
      cp "$_sh_tmp" "${BASE_DIR}/gwi-node.sh"
      chown root:root "${BASE_DIR}/gwi-node.sh"
      chmod 755 "${BASE_DIR}/gwi-node.sh"

      # Install systemd unit
      cp "$_svc_tmp" /etc/systemd/system/gwi-node.service
      systemctl daemon-reload
      systemctl enable gwi-node.service

      # Create trigger directories (matches stage 07 permissions)
      mkdir -p "${REQUESTS_DIR}" "${RESULTS_DIR}"
      chmod 777 "${REQUESTS_DIR}"
      chmod 755 "${RESULTS_DIR}"

      # Mask legacy services
      systemctl mask thepasspos 2>/dev/null || true
      systemctl mask thepasspos-sync 2>/dev/null || true

      # Start the watcher
      systemctl start gwi-node.service
      log "gwi-node.service bootstrapped and started"
    else
      log "WARN: Bootstrap extraction failed — venue needs installer re-run for trigger-file deploys"
    fi
    rm -f "$_sh_tmp" "$_svc_tmp"
  fi

  FINAL_STATUS="healthy"
  write_deploy_log
  log "Deploy $DEPLOY_ID complete: $IMAGE_REF"
}

deploy_failure() {
  err "Health check failed after $HEALTH_MAX_ATTEMPTS attempts"
  capture_diagnostics
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
  if [[ -f "$PREVIOUS_IMAGE_FILE" ]]; then
    local prev
    prev="$(cat "$PREVIOUS_IMAGE_FILE")"
    log "Auto-rolling back to: $prev"
    if start_container "$prev"; then
      log "Verifying rollback health..."
      health_check "Rollback: "
      if [[ "$healthy" == true ]]; then
        ROLLBACK_RESULT="pass"; ROLLBACK_READINESS="pass"; FINAL_STATUS="rolled_back"
        log "Rollback healthy — previous image restored"
      else
        ROLLBACK_RESULT="pass"; ROLLBACK_READINESS="fail"; FINAL_STATUS="rollback_failed"
        err "Rollback container started but health check failed"
        systemd_last_resort
      fi
    else
      ROLLBACK_RESULT="fail"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
      err "Failed to start rollback container"
      systemd_last_resort
    fi
  else
    ROLLBACK_RESULT="not_attempted"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
    err "No previous image for rollback"
    systemd_last_resort
  fi
  write_deploy_log
  # In watch mode, return so the watch loop can write the result file.
  # deploy_failure sets FINAL_STATUS; watch_loop reads it.
  if [[ "$WATCH_MODE" == true ]]; then return 1; else exit 1; fi
}

install() {
  log "=== GWI Node Install ==="
  if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
  fi
  usermod -aG docker gwipos 2>/dev/null || true
  mkdir -p "$SHARED_DIR" "$STATE_DIR" "$LOG_DIR"
  deploy
}

rollback() {
  if [[ ! -f "$PREVIOUS_IMAGE_FILE" ]]; then
    echo "No previous image to roll back to"
    if [[ "$WATCH_MODE" == true ]]; then FINAL_STATUS="failed"; return 1; else exit 1; fi
  fi
  IMAGE_REF="$(cat "$PREVIOUS_IMAGE_FILE")"
  log "Rollback requested: $IMAGE_REF"
  deploy
}

status() {
  echo "=== GWI Node Status ==="
  cat "$VERSION_FILE" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "No version info"
  echo ""
  docker ps --filter "name=$CONTAINER_NAME" --format '{{.Names}}  {{.Image}}  {{.Status}}' 2>/dev/null || echo "No container"
  echo ""
  local port; port="$(read_port)"
  curl -sf "http://localhost:${port}/api/health/ready" 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "Health: no response"
}

self_update() {
  local current_image tmp="/tmp/gwi-node-new.sh"
  current_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null)" || {
    echo "No running container to extract from"; return 0; }
  docker run --rm "$current_image" cat /app/public/scripts/gwi-node.sh > "$tmp" 2>/dev/null || {
    echo "Could not extract gwi-node.sh from image"; return 0; }
  if [[ -s "$tmp" ]]; then
    chmod 755 "$tmp"; mv "$tmp" "$0"
    log "Self-updated from $current_image"
  else
    rm -f "$tmp"; echo "Extracted file was empty — skipping"
  fi
}

# ---------------------------------------------------------------------------
#  watch mode — long-running dispatcher that polls for trigger files
# ---------------------------------------------------------------------------

readonly WATCH_POLL_INTERVAL=3
readonly STALE_THRESHOLD_MIN=30

# Reset per-deploy globals so each dispatch starts clean.
reset_deploy_state() {
  DEPLOY_ID="" DEPLOY_START=0 IMAGE_REF="" IMAGE_DIGEST="" PREVIOUS_IMAGE=""
  MANIFEST_URL="${R2_ORIGIN}/latest/manifest.json" FORCE=false FINAL_STATUS="pending"
  SCHEMA_RESULT="" ROLLBACK_RESULT="" ROLLBACK_READINESS="" LOCK_FD="" ERRORS=()
  WATCH_DIE_FIRED=false
}

# Write a result JSON atomically into RESULTS_DIR.
# Usage: write_result <attemptId> <commandId> <action> <status> <targetVersion> <error>
write_result() {
  local attempt_id="$1" command_id="$2" action="$3" status="$4" target_version="$5" error_msg="$6"
  local result_version="${target_version}"
  local completed_at started_at deploy_log_path

  completed_at="$(date -u +%FT%TZ)"
  started_at="${WATCH_STARTED_AT:-$completed_at}"

  # If the deploy succeeded, read the actual running version
  if [[ "$status" == "COMPLETED" ]] && [[ -f "$VERSION_FILE" ]]; then
    result_version="$(jq -r '.version // empty' "$VERSION_FILE" 2>/dev/null || echo "$target_version")"
  fi

  # Find the most recent deploy log
  deploy_log_path="$(ls -t "$LOG_DIR"/*.json 2>/dev/null | head -1 || echo "")"

  # Encode error as proper JSON (null or escaped string)
  local error_json="null"
  if [[ -n "$error_msg" ]]; then
    error_json="$(echo "$error_msg" | jq -Rs . 2>/dev/null || echo "\"$error_msg\"")"
  fi

  local tmp_file="${RESULTS_DIR}/${attempt_id}.json.tmp"
  cat > "$tmp_file" <<REOF
{
  "attemptId": "${attempt_id}",
  "commandId": "${command_id}",
  "action": "${action}",
  "status": "${status}",
  "targetVersion": "${target_version}",
  "resultVersion": "${result_version}",
  "startedAt": "${started_at}",
  "completedAt": "${completed_at}",
  "finalStatus": "${FINAL_STATUS}",
  "error": ${error_json},
  "deployId": "${DEPLOY_ID}",
  "imageRef": "${IMAGE_REF}",
  "deployLogPath": "${deploy_log_path}"
}
REOF
  mv "$tmp_file" "${RESULTS_DIR}/${attempt_id}.json"
  log "Result written: ${RESULTS_DIR}/${attempt_id}.json (status=$status)"
}

# Clean up trigger files older than STALE_THRESHOLD_MIN minutes.
cleanup_stale_triggers() {
  local stale_files
  stale_files="$(find "$REQUESTS_DIR" -name '*.json' -mmin +${STALE_THRESHOLD_MIN} 2>/dev/null || true)"
  [[ -z "$stale_files" ]] && return

  # Only clean up if no deploy lock is active
  if flock -n "$LOCK_FILE" true 2>/dev/null; then
    while IFS= read -r stale_file; do
      [[ -z "$stale_file" ]] && continue
      local stale_attempt stale_command stale_action
      stale_attempt="$(jq -r '.attemptId // "unknown"' "$stale_file" 2>/dev/null || echo "unknown")"
      stale_command="$(jq -r '.commandId // "unknown"' "$stale_file" 2>/dev/null || echo "unknown")"
      stale_action="$(jq -r '.action // "unknown"' "$stale_file" 2>/dev/null || echo "unknown")"
      log "Stale trigger: $stale_attempt (age > ${STALE_THRESHOLD_MIN}m)"
      reset_deploy_state
      FINAL_STATUS="stale"
      write_result "$stale_attempt" "$stale_command" "$stale_action" "FAILED" "" "Trigger file exceeded ${STALE_THRESHOLD_MIN}m age limit"
      rm -f "$stale_file"
    done <<< "$stale_files"
  fi
}

# Dispatch a single trigger file.
dispatch_trigger() {
  local trigger_file="$1"
  local attempt_id command_id action payload_version payload_image payload_digest payload_manifest

  # Parse the trigger JSON
  attempt_id="$(jq -r '.attemptId // empty' "$trigger_file" 2>/dev/null)"
  command_id="$(jq -r '.commandId // empty' "$trigger_file" 2>/dev/null)"
  action="$(jq -r '.action // empty' "$trigger_file" 2>/dev/null)"
  payload_version="$(jq -r '.payload.version // empty' "$trigger_file" 2>/dev/null)"
  payload_image="$(jq -r '.payload.imageRef // empty' "$trigger_file" 2>/dev/null)"
  payload_digest="$(jq -r '.payload.imageDigest // empty' "$trigger_file" 2>/dev/null)"
  payload_manifest="$(jq -r '.payload.manifestUrl // empty' "$trigger_file" 2>/dev/null)"

  # Validate required fields
  if [[ -z "$attempt_id" ]] || [[ -z "$action" ]]; then
    log "Invalid trigger file (missing attemptId or action): $trigger_file"
    rm -f "$trigger_file"
    return
  fi

  log "Dispatching: attemptId=$attempt_id action=$action version=${payload_version:-none}"

  # Single-flight check: if deploy lock is held, reject immediately
  if ! flock -n "$LOCK_FILE" true 2>/dev/null; then
    log "Deploy lock held — rejecting $attempt_id"
    reset_deploy_state
    FINAL_STATUS="rejected"
    write_result "$attempt_id" "$command_id" "$action" "REJECTED" "$payload_version" "Another deploy is in progress"
    rm -f "$trigger_file"
    return
  fi

  # Reset state and set up for this dispatch
  reset_deploy_state
  WATCH_STARTED_AT="$(date -u +%FT%TZ)"

  # Set globals from payload for deploy/rollback
  [[ -n "$payload_image" ]] && IMAGE_REF="$payload_image"
  [[ -n "$payload_digest" ]] && IMAGE_DIGEST="$payload_digest"
  [[ -n "$payload_manifest" ]] && MANIFEST_URL="$payload_manifest"

  local dispatch_rc=0
  case "$action" in
    deploy)
      deploy || dispatch_rc=$?
      ;;
    rollback)
      rollback || dispatch_rc=$?
      ;;
    self-update)
      self_update || dispatch_rc=$?
      # self_update does not set FINAL_STATUS; mark healthy on success
      [[ $dispatch_rc -eq 0 ]] && FINAL_STATUS="healthy"
      ;;
    *)
      log "Unknown action: $action"
      FINAL_STATUS="failed"
      write_result "$attempt_id" "$command_id" "$action" "FAILED" "$payload_version" "Unknown action: $action"
      rm -f "$trigger_file"
      return
      ;;
  esac

  # Release deploy lock if held (in watch mode, no EXIT trap does this)
  [[ -n "${LOCK_FD:-}" ]] && flock -u "$LOCK_FD" 2>/dev/null || true

  # Determine result status from FINAL_STATUS (set by deploy/rollback/die)
  local result_status="FAILED"
  local error_msg=""
  if [[ "$FINAL_STATUS" == "healthy" ]]; then
    result_status="COMPLETED"
  else
    result_status="FAILED"
    # Collect error messages
    if [[ ${#ERRORS[@]} -gt 0 ]]; then
      error_msg="${ERRORS[*]}"
    else
      error_msg="Action '$action' finished with status: $FINAL_STATUS"
    fi
  fi

  write_result "$attempt_id" "$command_id" "$action" "$result_status" "$payload_version" "$error_msg"
  rm -f "$trigger_file"
}

watch_loop() {
  WATCH_MODE=true
  mkdir -p "$REQUESTS_DIR" "$RESULTS_DIR" "$STATE_DIR" "$LOG_DIR"
  log "Watch mode started — polling $REQUESTS_DIR every ${WATCH_POLL_INTERVAL}s"

  # Graceful shutdown on SIGTERM/SIGINT
  local watch_running=true
  trap 'log "Watch mode shutting down (signal received)"; watch_running=false' SIGTERM SIGINT

  while [[ "$watch_running" == true ]]; do
    # Pick the oldest trigger file (FIFO by filename sort)
    local oldest
    oldest="$(ls -1 "$REQUESTS_DIR"/*.json 2>/dev/null | sort | head -1 || true)"

    if [[ -n "$oldest" ]] && [[ -f "$oldest" ]]; then
      dispatch_trigger "$oldest"
    fi

    # Stale trigger cleanup
    cleanup_stale_triggers

    sleep "$WATCH_POLL_INTERVAL" &
    wait $! 2>/dev/null || true  # wait is interruptible by signals
  done

  log "Watch mode exited"
}

SUBCOMMAND="${1:-deploy}"
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)         FORCE=true; shift ;;
    --manifest-url)  MANIFEST_URL="$2"; shift 2 ;;
    --image-ref)     IMAGE_REF="$2"; shift 2 ;;
    --image-digest)  IMAGE_DIGEST="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

case "$SUBCOMMAND" in
  install)     install ;;
  deploy)      deploy ;;
  rollback)    rollback ;;
  status)      status ;;
  self-update) self_update ;;
  watch)       watch_loop ;;
  *)           echo "Usage: gwi-node.sh {install|deploy|rollback|status|self-update|watch}"; exit 1 ;;
esac
