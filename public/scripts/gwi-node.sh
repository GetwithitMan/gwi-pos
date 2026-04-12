#!/usr/bin/env bash
# gwi-node.sh — GWI POS node agent (install | deploy | rollback | promote | rejoin | status | full-status | self-update | watch | dashboard-check | dashboard-rollback | converge | converge-loop | venue-state | cleanup | clear-quarantine)
# One agent. One runtime. One flow. Install and update are the same operation.
set -euo pipefail

readonly BASE_DIR="/opt/gwi-pos"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly STATE_DIR="${SHARED_DIR}/state"
readonly LOG_DIR="${SHARED_DIR}/logs/deploys"
readonly LOCK_FILE="${STATE_DIR}/gwi-node.lock"
readonly VERSION_FILE="${STATE_DIR}/running-version.json"
readonly PREVIOUS_IMAGE_FILE="${STATE_DIR}/previous-image.txt"
readonly LKG_IMAGE_FILE="${STATE_DIR}/last-known-good-image"
readonly LKG_VERSION_FILE="${STATE_DIR}/last-known-good-version"
readonly LKG_DASHBOARD_FILE="${STATE_DIR}/last-known-good-dashboard"
readonly REQUESTS_DIR="${STATE_DIR}/deploy-requests"
readonly RESULTS_DIR="${STATE_DIR}/deploy-results"
readonly VENUE_STATE_FILE="${STATE_DIR}/venue-state.json"
readonly CONTAINER_NAME="gwi-pos"
readonly AGENT_CONTAINER_NAME="gwi-agent"
readonly R2_ORIGIN="https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev"
readonly LOCK_TIMEOUT=300 HEALTH_MAX_ATTEMPTS=30 HEALTH_INTERVAL=2 HEALTH_CONSECUTIVE=3
ENV_FILE="${SHARED_DIR}/.env"; [[ -f "$ENV_FILE" ]] || ENV_FILE="${BASE_DIR}/.env"; readonly ENV_FILE

DEPLOY_ID="" DEPLOY_START=0 IMAGE_REF="" IMAGE_DIGEST="" PREVIOUS_IMAGE=""
MANIFEST_URL="${R2_ORIGIN}/latest/manifest.json" FORCE=false FINAL_STATUS="pending"
SCHEMA_RESULT="" ROLLBACK_RESULT="" ROLLBACK_READINESS="" LOCK_FD="" ERRORS=()
WATCH_MODE=false WATCH_DIE_FIRED=false SKIP_SELF_UPDATE=false
SELF_UPDATED=false
BOOTSTRAP_SCRIPT_UPDATED=false BOOTSTRAP_SERVICE_UPDATED=false
BOOTSTRAP_WATCHER_STARTED=false BOOTSTRAP_DEGRADED=false

log() { echo "[gwi-node] $(date -u +%FT%TZ) $*"; }
err() { echo "[gwi-node] $(date -u +%FT%TZ) ERROR: $*" >&2; ERRORS+=("$*"); }

# Extract a file from a Docker image. Returns 0 on success, 1 on failure.
# Usage: extract_from_image <image> <container-path> <host-dest>
extract_from_image() {
  local image="$1" src="$2" dest="$3"
  local tmp="${dest}.tmp.$$"

  docker run --rm "$image" cat "$src" > "$tmp" 2>/dev/null || {
    log "Extract failed: $src from $image"
    rm -f "$tmp"; return 1
  }

  if [[ ! -s "$tmp" ]]; then
    log "Extract empty: $src from $image"
    rm -f "$tmp"; return 1
  fi

  # For shell scripts, validate shebang
  if [[ "$src" == *.sh ]]; then
    if ! head -1 "$tmp" | grep -q "^#!/"; then
      log "Extract invalid (no shebang): $src from $image"
      rm -f "$tmp"; return 1
    fi
  fi

  mv "$tmp" "$dest"
  return 0
}

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
  "deployMethod": "docker",
  "selfUpdated": ${SELF_UPDATED},
  "bootstrap": {
    "scriptUpdated": ${BOOTSTRAP_SCRIPT_UPDATED},
    "serviceUpdated": ${BOOTSTRAP_SERVICE_UPDATED},
    "watcherStarted": ${BOOTSTRAP_WATCHER_STARTED},
    "degraded": ${BOOTSTRAP_DEGRADED}
  }
}
DEOF
  chmod 644 "$log_file" 2>/dev/null || true
  log "Deploy log: $log_file"
}

write_deploy_state() {
  local state="$1"  # healthy, failed, rolled_back, rollback_failed, in_progress
  local target_version="${IMAGE_REF##*:}"
  local previous_version=""
  [[ -f "$VERSION_FILE" ]] && previous_version="$(jq -r '.version // empty' "$VERSION_FILE" 2>/dev/null || true)"

  cat > "${STATE_DIR}/deploy-state.json" <<DSEOF
{
  "state": "${state}",
  "releaseId": "${target_version}",
  "previousReleaseId": "${previous_version}",
  "updatedAt": "$(date -u +%FT%TZ)",
  "deployId": "${DEPLOY_ID}",
  "deployMethod": "docker"
}
DSEOF
  chmod 644 "${STATE_DIR}/deploy-state.json" 2>/dev/null || true
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
    local port; port="$(read_port)"
    echo "=== Docker containers ==="
    docker ps -a --format '{{.Names}} {{.Image}} {{.Status}}' 2>/dev/null || true
    echo "=== Container logs (last 50 lines) ==="
    docker logs "$CONTAINER_NAME" 2>&1 | tail -50 || true
    echo "=== Port $port listeners ==="
    ss -tlnp "sport = :$port" 2>/dev/null || true
    echo "=== Runtime dirs ==="
    ls -ld /opt/gwi-pos/state /opt/gwi-pos/shared/state 2>/dev/null || true
    echo "=== systemd services ==="
    systemctl is-active thepasspos gwi-node 2>/dev/null || true
  } > "$DIAG_FILE" 2>/dev/null || true
}

# ── Deploy preflight checks ────────────────────────────────────────────────
# Run before starting containers to prevent crash loops.

# Wait for the app port to become free, with retries.  After docker rm -f the
# kernel may hold the port in TIME_WAIT briefly.  We poll for up to 10 seconds,
# then force-kill as a last resort.
ensure_port_available() {
  local port; port="$(read_port)"
  local attempt max_attempts=10

  # Fast path: port already free
  if ! ss -tlnp "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
    log "Preflight: port $port is free"
    return 0
  fi

  # Port is occupied — wait up to 10 seconds for it to release
  log "Preflight: port $port still in use, waiting up to ${max_attempts}s for release..."
  for (( attempt=1; attempt<=max_attempts; attempt++ )); do
    sleep 1
    if ! ss -tlnp "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
      log "Preflight: port $port freed after ${attempt}s"
      return 0
    fi
    log "Preflight: port $port still occupied (attempt ${attempt}/${max_attempts})"
  done

  # Still occupied — identify and try to kill the holder
  local listener_pid listener_name
  listener_pid="$(ss -tlnp "sport = :$port" 2>/dev/null | grep -oP 'pid=\K\d+' | head -1 || true)"
  listener_name="$(ps -p "${listener_pid:-0}" -o comm= 2>/dev/null || echo unknown)"
  log "Preflight: port $port held by PID ${listener_pid:-?} ($listener_name) after ${max_attempts}s wait"

  # Kill known stale processes (node, docker-proxy)
  if [[ "$listener_name" == "node" ]] || [[ "$listener_name" == "docker-proxy" ]]; then
    log "Preflight: killing stale listener PID $listener_pid ($listener_name)"
    kill "$listener_pid" 2>/dev/null || true
    sleep 2
    if ss -tlnp "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
      kill -9 "$listener_pid" 2>/dev/null || true
      sleep 1
    fi
  fi

  # Last resort: fuser -k to free the port regardless of who holds it
  if ss -tlnp "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
    log "Preflight: last resort — running fuser -k $port/tcp"
    fuser -k "$port/tcp" 2>/dev/null || true
    sleep 2
  fi

  # Final check
  if ss -tlnp "sport = :$port" 2>/dev/null | grep -q "LISTEN"; then
    die "Preflight: port $port still occupied after all cleanup attempts"
  fi
  log "Preflight: port $port cleared"
}

# Create host-mounted directories the app needs at runtime.
# The gwi-pos container runs as nextjs (uid 1001) and needs writable paths.
ensure_runtime_dirs() {
  local dirs=(
    "/opt/gwi-pos/state"
    "${SHARED_DIR}/state"
    "${REQUESTS_DIR}"
    "${RESULTS_DIR}"
    "${LOG_DIR}"
  )
  for d in "${dirs[@]}"; do
    mkdir -p "$d" 2>/dev/null || true
  done
  # /opt/gwi-pos/state must be writable by container user (nextjs, uid 1001)
  chown 1001:1001 /opt/gwi-pos/state 2>/dev/null || true
  chmod 755 /opt/gwi-pos/state 2>/dev/null || true
  # shared/state dirs stay root-writable (host watcher + container root agent)
  chmod 777 "${REQUESTS_DIR}" 2>/dev/null || true
  chmod 755 "${RESULTS_DIR}" 2>/dev/null || true
  log "Preflight: runtime dirs verified"
}

# Verify host state paths are writable before deploy operations that need them.
# Catches the Falcon/Monument class of failures early with clear diagnostics.
ensure_host_state_writable() {
  local test_file
  local dirs=("${STATE_DIR}" "${LOG_DIR}" "${REQUESTS_DIR}" "${RESULTS_DIR}")
  for d in "${dirs[@]}"; do
    mkdir -p "$d" 2>/dev/null || true
    test_file="${d}/.write-test-$$"
    if ! touch "$test_file" 2>/dev/null; then
      die "Preflight: directory not writable: $d (check permissions/ownership)"
    fi
    rm -f "$test_file"
  done
  log "Preflight: host state dirs writable"
}

start_container() {
  docker run -d --name "$CONTAINER_NAME" --restart=unless-stopped \
    --network=host --env-file "$ENV_FILE" -v "${SHARED_DIR}:${SHARED_DIR}" \
    -v /opt/gwi-pos/state:/opt/gwi-pos/state \
    "$1"
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

# ── Idempotent host watcher bootstrap ──────────────────────────────────────
# Ensures gwi-node.sh, gwi-node.service, trigger dirs, and legacy masking
# are all current after every successful deploy. Safe to run repeatedly.
# Matches stage 07 installer behavior.
bootstrap_host_watcher() {
  local image="$1"
  [[ -z "$image" ]] && return 0

  # Refresh host script if changed
  local _sh_tmp="/tmp/gwi-node-bootstrap-$$.sh"
  if extract_from_image "$image" /app/public/scripts/gwi-node.sh "$_sh_tmp"; then
    if ! cmp -s "$_sh_tmp" "${BASE_DIR}/gwi-node.sh" 2>/dev/null; then
      cp "$_sh_tmp" "${BASE_DIR}/gwi-node.sh"
      chown root:root "${BASE_DIR}/gwi-node.sh"
      chmod 755 "${BASE_DIR}/gwi-node.sh"
      BOOTSTRAP_SCRIPT_UPDATED=true
      log "Bootstrap: gwi-node.sh updated"
    fi
  else
    BOOTSTRAP_DEGRADED=true
    log "WARN: Bootstrap degraded — could not extract gwi-node.sh from image"
  fi
  rm -f "$_sh_tmp"

  # Refresh service unit if changed
  local _svc_tmp="/tmp/gwi-node-bootstrap-$$.service"
  if extract_from_image "$image" /app/public/scripts/gwi-node.service "$_svc_tmp"; then
    if ! cmp -s "$_svc_tmp" /etc/systemd/system/gwi-node.service 2>/dev/null; then
      cp "$_svc_tmp" /etc/systemd/system/gwi-node.service
      systemctl daemon-reload
      BOOTSTRAP_SERVICE_UPDATED=true
      log "Bootstrap: gwi-node.service updated"
    fi
    systemctl enable gwi-node.service 2>/dev/null || true
  else
    BOOTSTRAP_DEGRADED=true
    log "WARN: Bootstrap degraded — could not extract gwi-node.service from image"
  fi
  rm -f "$_svc_tmp"

  # Ensure trigger directories exist with correct permissions
  mkdir -p "${REQUESTS_DIR}" "${RESULTS_DIR}"
  chmod 777 "${REQUESTS_DIR}"
  chmod 755 "${RESULTS_DIR}"

  # Mask legacy services — delete unit files first so mask symlink can be created.
  # Without rm, systemctl mask fails silently if the .service file already exists.
  for _legacy in thepasspos thepasspos-sync; do
    systemctl stop "$_legacy" 2>/dev/null || true
    systemctl disable "$_legacy" 2>/dev/null || true
    rm -f "/etc/systemd/system/${_legacy}.service"
  done
  systemctl daemon-reload 2>/dev/null || true
  systemctl mask thepasspos thepasspos-sync 2>/dev/null || true

  # Ensure watcher is enabled
  if ! systemctl enable gwi-node.service 2>/dev/null; then
    BOOTSTRAP_DEGRADED=true
    log "WARN: Bootstrap degraded — gwi-node.service enable failed"
  fi

  # If watcher is already running (trigger-file deploy path), do NOT restart
  # it here — the watch loop detects the script SHA change after dispatch and
  # re-execs itself. Restarting mid-deploy would kill this process.
  # Only start if not running (fresh install or manual deploy path).
  if ! systemctl is-active gwi-node.service >/dev/null 2>&1; then
    if ! systemctl start gwi-node.service 2>/dev/null; then
      BOOTSTRAP_DEGRADED=true
      log "WARN: Bootstrap degraded — gwi-node.service failed to start"
    else
      BOOTSTRAP_WATCHER_STARTED=true
      log "Bootstrap: gwi-node.service started"
    fi
  fi
}

# ── Self-update and re-exec ─────────────────────────────────────────────────
# Extract the latest gwi-node.sh from the target image, replace this script
# on disk, then re-exec with the same arguments + --skip-self-update so the
# rest of the deploy runs with the newest code (including bootstrap).
self_update_and_reexec() {
  local source_image="$1"
  [[ -z "$source_image" ]] && return 0

  local tmp="/tmp/gwi-node-update-$$.sh"
  local old_sha new_sha
  old_sha="$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1 || echo none)"

  if ! extract_from_image "$source_image" /app/public/scripts/gwi-node.sh "$tmp"; then
    log "Self-update: could not extract from $source_image — continuing with current script"
    return 0
  fi

  new_sha="$(sha256sum "$tmp" 2>/dev/null | cut -d' ' -f1 || echo none)"
  if [[ "$old_sha" == "$new_sha" ]]; then
    log "Self-update: script already current (${old_sha:0:12})"
    rm -f "$tmp"; return 0
  fi

  # Atomic replace
  chmod 755 "$tmp"
  mv "$tmp" "$0"
  log "Self-update: ${old_sha:0:12} → ${new_sha:0:12} (from $source_image)"

  # Re-exec with --skip-self-update to prevent loop, preserving all flags
  local -a reexec_args
  reexec_args=("$SUBCOMMAND" "--skip-self-update" "--self-updated")
  [[ -n "$IMAGE_REF" ]]     && reexec_args+=("--image-ref" "$IMAGE_REF")
  [[ -n "$IMAGE_DIGEST" ]]  && reexec_args+=("--image-digest" "$IMAGE_DIGEST")
  [[ -n "$MANIFEST_URL" ]]  && reexec_args+=("--manifest-url" "$MANIFEST_URL")
  [[ "$FORCE" == true ]]    && reexec_args+=("--force")
  log "Re-executing with updated script..."
  exec "$0" "${reexec_args[@]}"
}

# ── Resolve target image from manifest ─────────────────────────────────────
# Called early in deploy() so IMAGE_REF is known before self-update.
resolve_target_image() {
  [[ -n "$IMAGE_REF" ]] && return 0
  log "Fetching manifest: $MANIFEST_URL"
  local manifest attempt
  for attempt in 1 2 3; do
    manifest="$(curl -fsSL --max-time 30 "$MANIFEST_URL" 2>/dev/null)" || {
      [[ $attempt -lt 3 ]] && { log "Manifest fetch failed (attempt $attempt/3), retrying in 10s..."; sleep 10; continue; }
      die "Failed to fetch manifest after 3 attempts"
    }
    [[ "$WATCH_DIE_FIRED" == true ]] && return 1
    IMAGE_REF="$(echo "$manifest" | jq -r '.imageRef // empty')"
    if [[ -n "$IMAGE_REF" ]]; then
      break
    fi
    # Manifest fetched but imageRef missing — release may still be building
    if [[ $attempt -lt 3 ]]; then
      log "Manifest fetched but imageRef missing (Docker image not ready yet), retrying in 30s..."
      sleep 30
    else
      die "Manifest missing imageRef after 3 attempts — Docker image may not be built yet"
    fi
  done
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  [[ -z "$IMAGE_DIGEST" ]] && IMAGE_DIGEST="$(echo "$manifest" | jq -r '.imageDigest // empty' || true)"
  log "Manifest resolved: image=$IMAGE_REF digest=${IMAGE_DIGEST:-none}"
}

deploy() {
  DEPLOY_ID="$(gen_deploy_id)"; DEPLOY_START="$(date +%s)"
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  write_deploy_state "in_progress"

  # ── Venue state: mark server as converging ───────────────────────────────
  local _vs_target="${IMAGE_REF##*:}"
  [[ -z "$_vs_target" ]] && _vs_target="unknown"
  vs_update_component "server" "behind" "" "$_vs_target" 2>/dev/null || log "WARN: venue state update failed"

  # ── Resolve target BEFORE self-update ─────────────────────────────────────
  # Manifest fetch must happen first so self-update always pulls from the
  # TARGET image, not the currently running old image.
  resolve_target_image
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1

  # ── Self-update from target image ─────────────────────────────────────────
  # Ensures the host script is current before the deploy cycle runs.
  # On re-exec, the updated script re-enters deploy() with --skip-self-update.
  if [[ "$SKIP_SELF_UPDATE" != true ]]; then
    self_update_and_reexec "$IMAGE_REF"
    # If we get here, no update was needed (same SHA)
    log "Self-update: no change needed"
  fi

  # ── Verify host state is writable before anything else ────────────────────
  ensure_host_state_writable
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1

  exec {LOCK_FD}>"$LOCK_FILE"
  flock -w "$LOCK_TIMEOUT" "$LOCK_FD" || die "Could not acquire lock (another deploy running?)"
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  # In watch mode, skip the EXIT trap — watch_loop manages its own lifecycle.
  [[ "$WATCH_MODE" != true ]] && trap 'cleanup' EXIT
  log "Deploy $DEPLOY_ID starting"

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
  vs_update_component "schema" "behind" "" "$_vs_target" 2>/dev/null || log "WARN: venue state update failed"
  if docker run --rm --env-file "$ENV_FILE" --network=host "$IMAGE_REF" \
    node deploy-tools/src/migrate.js; then
    SCHEMA_RESULT="pass"
    log "Local migration complete"
    vs_update_component "schema" "converged" "$_vs_target" "$_vs_target" 2>/dev/null || log "WARN: venue state update failed"
  else
    SCHEMA_RESULT="fail"
    vs_update_component "schema" "failed" "" "$_vs_target" "Local schema migration failed" 2>/dev/null || log "WARN: venue state update failed"
    die "Local schema migration failed"
    [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  fi
  # ── Neon schema is MC's responsibility (AUTHORITY-MODEL.md) ────────
  # NUC applies migrations to local PG only. Neon schema updates are
  # handled by MC provisioning pipeline and Vercel build. The NUC
  # observes Neon schema version via _venue_schema_state and blocks
  # sync if incompatible, but never executes DDL against Neon.
  log "Stopping old runtime..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  docker rm -f "$AGENT_CONTAINER_NAME" 2>/dev/null || true
  # Kill legacy services and delete unit files so mask symlink works
  for _legacy in thepasspos thepasspos-sync; do
    systemctl stop "$_legacy" 2>/dev/null || true
    systemctl disable "$_legacy" 2>/dev/null || true
    rm -f "/etc/systemd/system/${_legacy}.service"
  done
  systemctl daemon-reload 2>/dev/null || true
  systemctl mask thepasspos thepasspos-sync 2>/dev/null || true
  # Kill any bare node process left by old services
  pkill -f "preload.js server.js" 2>/dev/null || true
  sleep 1

  # Preflight: ensure port is free and runtime dirs exist before starting
  ensure_port_available
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  ensure_runtime_dirs

  log "Starting: $IMAGE_REF"
  start_container "$IMAGE_REF" || die "Failed to start container"
  [[ "$WATCH_DIE_FIRED" == true ]] && return 1
  log "Waiting for health..."
  health_check ""
  [[ "$healthy" == true ]] && { deploy_success; return; }
  deploy_failure
}

deploy_success() {
  write_deploy_state "healthy"
  local tag="${IMAGE_REF##*:}"

  # ── Venue state: mark server converged ───────────────────────────────────
  vs_update_component "server" "converged" "$tag" "$tag" 2>/dev/null || log "WARN: venue state update failed"
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

  # Save last-known-good image ref and version for future rollbacks
  echo "$IMAGE_REF" > "$LKG_IMAGE_FILE"
  echo "$tag" > "$LKG_VERSION_FILE"
  log "Last-known-good saved: $IMAGE_REF (v${tag})"

  docker image prune -f --filter "dangling=true" 2>/dev/null || true
  start_agent "$IMAGE_REF" || log "WARN: gwi-agent failed to start (non-fatal)"

  bootstrap_host_watcher "$IMAGE_REF"

  # ── Dashboard update (non-fatal) ──────────────────────────────────────────
  # Check if a newer dashboard .deb is available and install it.
  # Downloads from the POS Vercel deployment (same origin as version-contract).
  update_dashboard || log "WARN: Dashboard update skipped (non-fatal)"

  # ── Convergence agent (auto-install on first deploy) ──────────────────────
  # Ensures the recurring self-healing loop is active. Idempotent — skips if
  # the service is already installed and running.
  if ! systemctl is-active gwi-converge.service >/dev/null 2>&1; then
    log "Installing convergence agent service..."
    install_converge_service "${CONVERGE_INTERVAL:-300}" 2>/dev/null || log "WARN: Convergence service install failed (non-fatal)"
  fi

  FINAL_STATUS="healthy"
  write_deploy_log
  log "Deploy $DEPLOY_ID complete: $IMAGE_REF"
}

# ── update_dashboard ──────────────────────────────────────────────────────────
# Downloads and installs the NUC dashboard .deb if a newer version is available.
# Compares installed version (dpkg) against version-contract.json dashboardVersion.
# Non-fatal: returns 0 even on failure so deploy is not blocked.
# ──────────────────────────────────────────────────────────────────────────────
update_dashboard() {
  # Skip on terminal role — dashboard is only for server/backup NUCs
  if [[ "${STATION_ROLE:-}" == "terminal" ]]; then
    log "Dashboard: skipping on terminal role"
    return 0
  fi

  local installed available deb_url deb_path _dashboard_warning=""

  # Read desired version from the running container's version-contract
  available=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardVersion',''))" 2>/dev/null || true)
  if [[ -z "$available" ]]; then
    _dashboard_warning="no dashboardVersion in version-contract"
    err "Dashboard: $_dashboard_warning"
    _write_dashboard_warning "$_dashboard_warning" "" ""
    return 0
  fi

  # Get currently installed version
  installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "0.0.0")

  if [[ "$installed" == "$available" ]]; then
    log "Dashboard: converged at v${installed}"
    _clear_dashboard_warning
    return 0
  fi

  log "Dashboard: updating v${installed} -> v${available}"

  # Download .deb from the POS app (Vercel serves static files from /public)
  deb_path="/tmp/gwi-nuc-dashboard-${available}.deb"
  deb_url="$(docker exec "$CONTAINER_NAME" printenv NEXT_PUBLIC_BASE_URL 2>/dev/null || echo 'http://localhost:3005')/gwi-nuc-dashboard.deb"

  if ! curl -sfL "$deb_url" -o "$deb_path" 2>/dev/null; then
    # Fallback: try the container's static files directly
    docker cp "${CONTAINER_NAME}:/app/public/gwi-nuc-dashboard.deb" "$deb_path" 2>/dev/null || {
      _dashboard_warning="download failed from $deb_url and container copy failed"
      err "Dashboard: $_dashboard_warning"
      _write_dashboard_warning "$_dashboard_warning" "$available" "$installed"
      rm -f "$deb_path" 2>/dev/null
      return 0
    }
  fi

  # Validate file size (must be > 100KB to be a real .deb)
  local size
  size=$(stat -c%s "$deb_path" 2>/dev/null || echo 0)
  if [[ "$size" -lt 100000 ]]; then
    _dashboard_warning="downloaded file too small (${size} bytes)"
    err "Dashboard: $_dashboard_warning"
    _write_dashboard_warning "$_dashboard_warning" "$available" "$installed"
    rm -f "$deb_path" 2>/dev/null
    return 0
  fi

  # Validate .deb structure
  if ! dpkg --info "$deb_path" > /dev/null 2>&1; then
    _dashboard_warning="downloaded file is not a valid .deb package"
    err "Dashboard: $_dashboard_warning"
    _write_dashboard_warning "$_dashboard_warning" "$available" "$installed"
    rm -f "$deb_path"
    return 0
  fi

  # Validate expected package name
  local pkg_name
  pkg_name=$(dpkg-deb -f "$deb_path" Package 2>/dev/null)
  if [[ "$pkg_name" != "gwi-nuc-dashboard" ]]; then
    _dashboard_warning="unexpected package name '$pkg_name' — expected gwi-nuc-dashboard"
    err "Dashboard: $_dashboard_warning"
    _write_dashboard_warning "$_dashboard_warning" "$available" "$installed"
    rm -f "$deb_path"
    return 0
  fi

  # Checksum validation (if hash available in version-contract)
  local expected_sha
  expected_sha=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('components',{}).get('dashboard',{}).get('sha256',''))" 2>/dev/null)
  if [[ -n "$expected_sha" ]]; then
    local actual_sha
    actual_sha=$(sha256sum "$deb_path" | awk '{print $1}')
    if [[ "$actual_sha" != "$expected_sha" ]]; then
      _dashboard_warning="SHA256 mismatch — expected $expected_sha, got $actual_sha"
      err "Dashboard: $_dashboard_warning"
      _write_dashboard_warning "$_dashboard_warning" "$available" "$installed"
      rm -f "$deb_path"
      return 0
    fi
    log "Dashboard: SHA256 verified"
  fi

  # Install — dpkg may return non-zero on trigger warnings (icon cache),
  # so we always run --configure -a and verify the installed version afterward.
  sudo dpkg -i "$deb_path" 2>&1 | while IFS= read -r line; do log "Dashboard: $line"; done
  sudo dpkg --configure -a 2>&1 | while IFS= read -r line; do log "Dashboard: configure: $line"; done || true
  sudo apt-get install -f -y -qq 2>/dev/null || true

  # ── Version reconciliation check ──────────────────────────────────────────
  # After install, compare installed version vs target. If mismatch, log an
  # explicit WARNING that persists in deploy results.
  local final_version
  final_version=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "0.0.0")
  if [[ "$final_version" == "$available" ]]; then
    log "Dashboard: v${available} installed and configured successfully"
    echo "$available" > "$LKG_DASHBOARD_FILE"
    # Cache the .deb so dashboard_rollback() can use it even if the container
    # ships a newer version after the next deploy.
    cp "$deb_path" "${STATE_DIR}/dashboard-lkg.deb" 2>/dev/null || log "WARN: could not cache dashboard .deb for rollback"
    log "Dashboard: last-known-good saved: v${available}"
    _clear_dashboard_warning
    vs_update_component "dashboard" "converged" "$available" "$available" 2>/dev/null || log "WARN: venue state update failed"
    # Ensure systemd user service exists (may be first install on this NUC)
    local _posuser="${POSUSER:-gwipos}"
    local _svc_dir
    _svc_dir=$(eval echo "~${_posuser}/.config/systemd/user")
    if [[ ! -f "${_svc_dir}/gwi-dashboard.service" ]]; then
      local _dash_bin
      _dash_bin=$(command -v gwi-dashboard 2>/dev/null || command -v gwi-nuc-dashboard 2>/dev/null || true)
      if [[ -n "$_dash_bin" ]]; then
        mkdir -p "$_svc_dir"
        chown -R "${_posuser}:${_posuser}" "$(eval echo "~${_posuser}/.config")"
        cat > "${_svc_dir}/gwi-dashboard.service" <<SVCEOF
[Unit]
Description=GWI NUC Dashboard
After=graphical-session.target

[Service]
ExecStart=${_dash_bin}
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=120
Environment=DISPLAY=:0
Environment=GWI_POS_URL=http://localhost:3005

[Install]
WantedBy=default.target
SVCEOF
        chown "${_posuser}:${_posuser}" "${_svc_dir}/gwi-dashboard.service"
        loginctl enable-linger "${_posuser}" 2>/dev/null || true
        log "Dashboard: created systemd user service"
      fi
    fi
    # Start or restart the service
    sudo -u "${_posuser}" bash -c \
      "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user daemon-reload && systemctl --user enable gwi-dashboard.service && systemctl --user restart gwi-dashboard.service" 2>/dev/null || true
    # Audit log for dashboard update
    mkdir -p "${RESULTS_DIR}" 2>/dev/null || true
    echo "{\"action\":\"dashboard_update\",\"version\":\"$available\",\"installedVersion\":\"$final_version\",\"status\":\"converged\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
      > "${RESULTS_DIR}/dashboard-$(date +%s).json" 2>/dev/null || true
  else
    _dashboard_warning="VERSION MISMATCH after install — expected v${available}, got v${final_version}"
    err "Dashboard: WARNING: $_dashboard_warning"
    _write_dashboard_warning "$_dashboard_warning" "$available" "$final_version"
    vs_update_component "dashboard" "failed" "$final_version" "$available" "$_dashboard_warning" 2>/dev/null || log "WARN: venue state update failed"
  fi

  rm -f "$deb_path" 2>/dev/null
  return 0
}

# ── Dashboard warning state (persistent) ────────────────────────────────────
# Writes/clears a persistent warning file so operators and MC can detect
# dashboard convergence failures without scrolling through deploy logs.
# ─────────────────────────────────────────────────────────────────────────────
_write_dashboard_warning() {
  local reason="$1" target="$2" installed="$3"
  mkdir -p "${RESULTS_DIR}" 2>/dev/null || true
  cat > "${STATE_DIR}/dashboard-warning.json" <<WEOF
{
  "warning": true,
  "reason": "${reason}",
  "targetVersion": "${target}",
  "installedVersion": "${installed}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname 2>/dev/null || echo unknown)"
}
WEOF
  chmod 644 "${STATE_DIR}/dashboard-warning.json" 2>/dev/null || true
  # Also write to results dir for deploy-level audit
  cp "${STATE_DIR}/dashboard-warning.json" \
    "${RESULTS_DIR}/dashboard-warning-$(date +%s).json" 2>/dev/null || true
}

_clear_dashboard_warning() {
  rm -f "${STATE_DIR}/dashboard-warning.json" 2>/dev/null || true
}

# ── Venue State Machine ──────────────────────────────────────────────────────
# Read/write venue-state.json with python3 for atomic JSON manipulation.
# Matches src/lib/venue-state.ts types exactly.
# ──────────────────────────────────────────────────────────────────────────────

readonly VS_MAX_ATTEMPTS=5

# Initialize a default venue-state.json if it does not exist.
vs_ensure_file() {
  [[ -f "$VENUE_STATE_FILE" ]] && return 0
  mkdir -p "$(dirname "$VENUE_STATE_FILE")" 2>/dev/null || true
  python3 << 'VSINIT'
import json, datetime
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
comp = lambda n: {'name':n,'targetVersion':'0.0.0','currentVersion':'0.0.0','lastKnownGoodVersion':None,'status':'unknown','lastConvergedAt':None,'lastAttemptAt':None,'attemptCount':0,'error':None}
# Baseline is NOT managed by the convergence engine (updated by Ansible independently).
# Initialize it as 'converged' so it does not block or confuse venue lifecycle computation.
baseline = {'name':'baseline','targetVersion':'0.0.0','currentVersion':'0.0.0','lastKnownGoodVersion':None,'status':'converged','lastConvergedAt':now,'lastAttemptAt':None,'attemptCount':0,'error':None}
state = {
  'lifecycleState':'BOOTSTRAPPING',
  'components':{'server':comp('server'),'schema':comp('schema'),'dashboard':comp('dashboard'),'baseline':baseline},
  'lastConvergedAt':None,'lastStateChangeAt':now,'blockedReason':None,'degradedReasons':[],'convergenceAttempts':0
}
import os
sf = os.environ.get('_VS_FILE', '/opt/gwi-pos/shared/state/venue-state.json')
with open(sf,'w') as f:
  json.dump(state, f, indent=2)
  f.write('\n')
VSINIT
  chmod 644 "$VENUE_STATE_FILE" 2>/dev/null || true
}

# Update a component and recompute venue lifecycle.
# Usage: vs_update_component <name> <status> <currentVersion> <targetVersion> [error]
vs_update_component() {
  local comp_name="$1" comp_status="$2" comp_current="$3" comp_target="$4" comp_error="${5:-}"
  vs_ensure_file
  _VS_FILE="$VENUE_STATE_FILE" _VS_MAX="$VS_MAX_ATTEMPTS" \
  python3 - "$comp_name" "$comp_status" "$comp_current" "$comp_target" "$comp_error" << 'VSUPDATE'
import json, sys, os, datetime

comp_name, comp_status, comp_current, comp_target, comp_error = sys.argv[1:6]
state_file = os.environ['_VS_FILE']
max_attempts = int(os.environ['_VS_MAX'])
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')

with open(state_file) as f:
    state = json.load(f)

c = state['components'].get(comp_name)
if not c:
    sys.exit(0)

c['status'] = comp_status
c['currentVersion'] = comp_current
c['targetVersion'] = comp_target
c['lastAttemptAt'] = now
if comp_error:
    c['error'] = comp_error
    c['attemptCount'] = c.get('attemptCount', 0) + 1
else:
    c['error'] = None

if comp_status == 'converged':
    c['lastConvergedAt'] = now
    c['lastKnownGoodVersion'] = comp_current
    c['attemptCount'] = 0
    c['error'] = None

# Recompute lifecycle (baseline is informational only — not managed by convergence engine)
managed = [state['components'][k] for k in ('server', 'schema', 'dashboard')]
all_converged = all(x['status'] == 'converged' for x in managed)
blocked = [x for x in managed if x['status'] == 'failed' and x.get('attemptCount', 0) >= max_attempts]
server_healthy = state['components']['server']['status'] == 'converged'
behind_or_failed = [x for x in managed if x['status'] in ('behind', 'failed', 'ahead')]

if blocked:
    new_lifecycle = 'BLOCKED'
    state['blockedReason'] = '; '.join(
        f"{x['name']}: {x.get('error','unknown')} ({x['attemptCount']} attempts)" for x in blocked)
    state['degradedReasons'] = []
elif all_converged:
    new_lifecycle = 'CONVERGED'
    state['blockedReason'] = None
    state['degradedReasons'] = []
elif server_healthy and behind_or_failed:
    new_lifecycle = 'DEGRADED'
    state['blockedReason'] = None
    state['degradedReasons'] = [
        f"{x['name']}: {x['status']} (current={x['currentVersion']}, target={x['targetVersion']})"
        for x in behind_or_failed]
else:
    new_lifecycle = 'CONVERGING'
    state['blockedReason'] = None
    state['degradedReasons'] = []

VALID = {
    'BOOTSTRAPPING': {'CONVERGING','CONVERGED','BLOCKED'},
    'CONVERGING': {'CONVERGED','DEGRADED','BLOCKED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'CONVERGED': {'CONVERGING','DEGRADED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'DEGRADED': {'CONVERGING','CONVERGED','BLOCKED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'BLOCKED': {'CONVERGING','RECOVERY_REQUIRED'},
    'ROLLING_BACK': {'CONVERGED','DEGRADED','RECOVERY_REQUIRED'},
    'RECOVERY_REQUIRED': {'BOOTSTRAPPING','CONVERGING'},
}

prev = state.get('lifecycleState', 'BOOTSTRAPPING')
allowed = VALID.get(prev, set())
if new_lifecycle != prev and new_lifecycle in allowed:
    state['lifecycleState'] = new_lifecycle
    state['lastStateChangeAt'] = now
    if new_lifecycle == 'CONVERGED':
        state['lastConvergedAt'] = now
        state['convergenceAttempts'] = 0
    elif new_lifecycle == 'CONVERGING':
        state['convergenceAttempts'] = state.get('convergenceAttempts', 0) + 1

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
VSUPDATE
  chmod 644 "$VENUE_STATE_FILE" 2>/dev/null || true
}

# Transition venue lifecycle directly (for ROLLING_BACK, RECOVERY_REQUIRED).
# Usage: vs_transition <target_state>
vs_transition() {
  local target_state="$1"
  vs_ensure_file
  _VS_FILE="$VENUE_STATE_FILE" python3 - "$target_state" << 'VSTRANS'
import json, sys, os, datetime

target = sys.argv[1]
state_file = os.environ['_VS_FILE']
now = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')

with open(state_file) as f:
    state = json.load(f)

VALID = {
    'BOOTSTRAPPING': {'CONVERGING','CONVERGED','BLOCKED'},
    'CONVERGING': {'CONVERGED','DEGRADED','BLOCKED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'CONVERGED': {'CONVERGING','DEGRADED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'DEGRADED': {'CONVERGING','CONVERGED','BLOCKED','ROLLING_BACK','RECOVERY_REQUIRED'},
    'BLOCKED': {'CONVERGING','RECOVERY_REQUIRED'},
    'ROLLING_BACK': {'CONVERGED','DEGRADED','RECOVERY_REQUIRED'},
    'RECOVERY_REQUIRED': {'BOOTSTRAPPING','CONVERGING'},
}

prev = state.get('lifecycleState', 'BOOTSTRAPPING')
if target == prev:
    sys.exit(0)

allowed = VALID.get(prev, set())
if target not in allowed:
    print(f"Invalid transition: {prev} -> {target} (allowed: {sorted(allowed)})", file=sys.stderr)
    sys.exit(1)

state['lifecycleState'] = target
state['lastStateChangeAt'] = now
if target == 'CONVERGED':
    state['lastConvergedAt'] = now
    state['convergenceAttempts'] = 0
    state['blockedReason'] = None
    state['degradedReasons'] = []
elif target == 'CONVERGING':
    state['convergenceAttempts'] = state.get('convergenceAttempts', 0) + 1

with open(state_file, 'w') as f:
    json.dump(state, f, indent=2)
    f.write('\n')
VSTRANS
  chmod 644 "$VENUE_STATE_FILE" 2>/dev/null || true
}

# Print current venue state as formatted JSON + component summary.
# Returns non-zero if BLOCKED or RECOVERY_REQUIRED.
venue_state() {
  vs_ensure_file
  echo "=== Venue State ==="
  python3 -m json.tool "$VENUE_STATE_FILE" 2>/dev/null || cat "$VENUE_STATE_FILE"
  echo ""
  echo "--- Component Summary ---"
  _VS_FILE="$VENUE_STATE_FILE" python3 << 'VSPRINT'
import json, sys, os

with open(os.environ['_VS_FILE']) as f:
    state = json.load(f)

lifecycle = state.get('lifecycleState', 'UNKNOWN')
print(f"  Lifecycle: {lifecycle}")
print(f"  Last converged: {state.get('lastConvergedAt') or 'never'}")
print(f"  Convergence attempts: {state.get('convergenceAttempts', 0)}")

if state.get('blockedReason'):
    print(f"  BLOCKED: {state['blockedReason']}")
for r in state.get('degradedReasons', []):
    print(f"  DEGRADED: {r}")

print("")
for name in ('server', 'schema', 'dashboard', 'baseline'):
    c = state.get('components', {}).get(name, {})
    status = c.get('status', 'unknown')
    current = c.get('currentVersion', '?')
    target = c.get('targetVersion', '?')
    converged_at = c.get('lastConvergedAt') or 'never'
    indicator = 'OK' if status == 'converged' else 'FAIL' if status == 'failed' else '..'
    line = f"  [{indicator:4s}] {name:12s} {status:10s} current={current} target={target} converged={converged_at}"
    error = c.get('error')
    if error:
        line += f" ERROR: {error} (attempts={c.get('attemptCount',0)})"
    print(line)

# Exit code
if lifecycle in ('BLOCKED', 'RECOVERY_REQUIRED'):
    sys.exit(1)
VSPRINT
}

# ── dashboard_check ──────────────────────────────────────────────────────────
# Manual convergence tool: checks current vs target dashboard version and
# installs if mismatched. Operators can run: gwi-node dashboard-check
# ─────────────────────────────────────────────────────────────────────────────
dashboard_check() {
  log "=== Dashboard Convergence Check ==="

  # Skip on terminal role
  if [[ "${STATION_ROLE:-}" == "terminal" ]]; then
    log "Dashboard: not applicable on terminal role"
    return 0
  fi

  local installed available

  # Get installed version
  installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "not-installed")

  # Get target version from running container
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    err "Dashboard check: no running ${CONTAINER_NAME} container — cannot determine target version"
    return 1
  fi

  available=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardVersion',''))" 2>/dev/null || true)

  if [[ -z "$available" ]]; then
    err "Dashboard check: no dashboardVersion in version-contract"
    return 1
  fi

  echo "  Target version:    v${available}"
  echo "  Installed version: ${installed}"

  # Check for persistent warning
  if [[ -f "${STATE_DIR}/dashboard-warning.json" ]]; then
    echo "  WARNING file:      ${STATE_DIR}/dashboard-warning.json"
    cat "${STATE_DIR}/dashboard-warning.json" 2>/dev/null
    echo ""
  fi

  # Check systemd service
  local _posuser="${POSUSER:-gwipos}"
  local _svc_status
  _svc_status=$(sudo -u "${_posuser}" bash -c \
    "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user is-active gwi-dashboard.service" 2>/dev/null || echo "unknown")
  echo "  Service status:    ${_svc_status}"

  if [[ "$installed" == "$available" ]]; then
    log "Dashboard: CONVERGED at v${installed}"
    _clear_dashboard_warning
    return 0
  fi

  log "Dashboard: DIVERGED — installed=${installed}, target=${available}. Attempting update..."
  update_dashboard
  local rc=$?

  # Final reconciliation
  local final_installed
  final_installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "not-installed")
  if [[ "$final_installed" == "$available" ]]; then
    log "Dashboard: CONVERGED after update — now at v${final_installed}"
    return 0
  else
    err "Dashboard: STILL DIVERGED after update — installed=${final_installed}, target=${available}"
    return 1
  fi
}

# ── dashboard_rollback ────────────────────────────────────────────────────────
# Rolls the dashboard back to the last-known-good version. Downloads the
# matching .deb from the POS container's static files and reinstalls it.
# ──────────────────────────────────────────────────────────────────────────────
dashboard_rollback() {
  local lkg
  lkg="$(cat "$LKG_DASHBOARD_FILE" 2>/dev/null || true)"
  if [[ -z "$lkg" ]]; then
    err "No last-known-good dashboard version recorded — cannot rollback"
    return 1
  fi

  local installed
  installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "not-installed")
  if [[ "$installed" == "$lkg" ]]; then
    log "Dashboard: already at last-known-good v${lkg} — nothing to do"
    return 0
  fi

  log "Dashboard: rolling back v${installed} -> v${lkg} (last-known-good)"

  # Attempt to find the LKG .deb. Priority order:
  #   1. Cached .deb from the successful install (most reliable)
  #   2. Running container's HTTP endpoint
  #   3. Container filesystem copy
  local deb_path="/tmp/gwi-nuc-dashboard-${lkg}.deb"
  local deb_url

  # Try cached .deb first (saved during successful install by update_dashboard)
  if [[ -f "${STATE_DIR}/dashboard-lkg.deb" ]]; then
    local cached_ver
    cached_ver=$(dpkg-deb -f "${STATE_DIR}/dashboard-lkg.deb" Version 2>/dev/null || echo "")
    if [[ "$cached_ver" == "$lkg" ]]; then
      cp "${STATE_DIR}/dashboard-lkg.deb" "$deb_path" 2>/dev/null || true
      log "Dashboard rollback: using cached LKG .deb (v${lkg})"
    else
      log "Dashboard rollback: cached .deb is v${cached_ver}, need v${lkg} — trying container"
    fi
  fi

  # Try the running container's HTTP endpoint
  if [[ ! -f "$deb_path" ]]; then
    deb_url="$(docker exec "$CONTAINER_NAME" printenv NEXT_PUBLIC_BASE_URL 2>/dev/null || echo 'http://localhost:3005')/gwi-nuc-dashboard.deb"
    if curl -sfL "$deb_url" -o "$deb_path" 2>/dev/null; then
      # Verify the downloaded .deb matches LKG version
      local pkg_ver
      pkg_ver=$(dpkg-deb -f "$deb_path" Version 2>/dev/null || echo "")
      if [[ "$pkg_ver" != "$lkg" ]]; then
        log "Dashboard rollback: container serves v${pkg_ver}, need v${lkg} — trying container copy"
        rm -f "$deb_path"
      fi
    fi
  fi

  # Fallback: try copying from container filesystem
  if [[ ! -f "$deb_path" ]]; then
    docker cp "${CONTAINER_NAME}:/app/public/gwi-nuc-dashboard.deb" "$deb_path" 2>/dev/null || true
    if [[ -f "$deb_path" ]]; then
      local pkg_ver
      pkg_ver=$(dpkg-deb -f "$deb_path" Version 2>/dev/null || echo "")
      if [[ "$pkg_ver" != "$lkg" ]]; then
        log "Dashboard rollback: container .deb is v${pkg_ver}, need v${lkg}"
        rm -f "$deb_path"
      fi
    fi
  fi

  if [[ ! -f "$deb_path" ]]; then
    err "Dashboard rollback: could not obtain v${lkg} .deb — rollback failed"
    return 1
  fi

  # Validate and install
  if ! dpkg --info "$deb_path" > /dev/null 2>&1; then
    err "Dashboard rollback: downloaded file is not a valid .deb"
    rm -f "$deb_path"
    return 1
  fi

  sudo dpkg -i "$deb_path" 2>&1 | while IFS= read -r line; do log "Dashboard rollback: $line"; done
  sudo dpkg --configure -a 2>&1 | while IFS= read -r line; do log "Dashboard rollback: configure: $line"; done || true
  sudo apt-get install -f -y -qq 2>/dev/null || true

  local final_version
  final_version=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "0.0.0")
  rm -f "$deb_path" 2>/dev/null

  if [[ "$final_version" == "$lkg" ]]; then
    log "Dashboard rollback: restored to v${lkg}"
    _clear_dashboard_warning
    # Restart service
    local _posuser="${POSUSER:-gwipos}"
    sudo -u "${_posuser}" bash -c \
      "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user restart gwi-dashboard.service" 2>/dev/null || true
    # Audit log
    mkdir -p "${RESULTS_DIR}" 2>/dev/null || true
    echo "{\"action\":\"dashboard_rollback\",\"version\":\"$lkg\",\"previousVersion\":\"$installed\",\"status\":\"rolled_back\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
      > "${RESULTS_DIR}/dashboard-rollback-$(date +%s).json" 2>/dev/null || true
    return 0
  else
    err "Dashboard rollback: expected v${lkg}, got v${final_version}"
    _write_dashboard_warning "Rollback failed — expected v${lkg}, got v${final_version}" "$lkg" "$final_version"
    return 1
  fi
}

deploy_failure() {
  err "Health check failed after $HEALTH_MAX_ATTEMPTS attempts"

  # ── Venue state: mark server failed and transition BEFORE rollback ───
  # Operators must see the failure state even if rollback takes time or hangs.
  local _vs_target="${IMAGE_REF##*:}"
  vs_update_component "server" "failed" "" "${_vs_target:-unknown}" "Health check failed after $HEALTH_MAX_ATTEMPTS attempts" 2>/dev/null || log "WARN: venue state update failed"
  vs_transition "ROLLING_BACK" 2>/dev/null || log "WARN: venue state transition to ROLLING_BACK failed"

  capture_diagnostics

  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true

  # Resolve rollback image: previous-image first, then LKG as fallback
  local prev=""
  if [[ -f "$PREVIOUS_IMAGE_FILE" ]]; then
    prev="$(cat "$PREVIOUS_IMAGE_FILE")"
  elif [[ -f "$LKG_IMAGE_FILE" ]]; then
    prev="$(cat "$LKG_IMAGE_FILE")"
    log "No previous image — falling back to last-known-good"
  fi

  if [[ -n "$prev" ]]; then
    log "Auto-rolling back to: $prev"
    vs_transition "ROLLING_BACK" 2>/dev/null || log "WARN: venue state transition failed"
    if start_container "$prev"; then
      log "Verifying rollback health..."
      health_check "Rollback: "
      if [[ "$healthy" == true ]]; then
        ROLLBACK_RESULT="pass"; ROLLBACK_READINESS="pass"; FINAL_STATUS="rolled_back"
        write_deploy_state "rolled_back"
        log "Rollback healthy — previous image restored"
        local _rb_tag="${prev##*:}"
        vs_update_component "server" "converged" "$_rb_tag" "$_rb_tag" 2>/dev/null || log "WARN: venue state update failed"
      else
        ROLLBACK_RESULT="pass"; ROLLBACK_READINESS="fail"; FINAL_STATUS="rollback_failed"
        write_deploy_state "rollback_failed"
        err "Rollback container started but health check failed"
        vs_transition "RECOVERY_REQUIRED" 2>/dev/null || log "WARN: venue state transition failed"
        systemd_last_resort
      fi
    else
      ROLLBACK_RESULT="fail"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
      write_deploy_state "rollback_failed"
      err "Failed to start rollback container"
      vs_transition "RECOVERY_REQUIRED" 2>/dev/null || log "WARN: venue state transition failed"
      systemd_last_resort
    fi
  else
    ROLLBACK_RESULT="not_attempted"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
    write_deploy_state "rollback_failed"
    err "No previous image or last-known-good for rollback"
    vs_transition "RECOVERY_REQUIRED" 2>/dev/null || log "WARN: venue state transition failed"
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
  local lkg_image
  lkg_image="$(cat "$LKG_IMAGE_FILE" 2>/dev/null || true)"
  if [[ -n "$lkg_image" ]]; then
    IMAGE_REF="$lkg_image"
    local lkg_ver; lkg_ver="$(cat "$LKG_VERSION_FILE" 2>/dev/null || echo unknown)"
    log "Rollback to last-known-good: $IMAGE_REF (v${lkg_ver})"
  elif [[ -f "$PREVIOUS_IMAGE_FILE" ]]; then
    IMAGE_REF="$(cat "$PREVIOUS_IMAGE_FILE")"
    log "Rollback to previous image (no LKG available): $IMAGE_REF"
  else
    err "No last-known-good or previous image to roll back to"
    vs_transition "RECOVERY_REQUIRED" 2>/dev/null || log "WARN: venue state transition to RECOVERY_REQUIRED failed"
    if [[ "$WATCH_MODE" == true ]]; then FINAL_STATUS="failed"; return 1; else exit 1; fi
  fi
  deploy
}

# ── promote ───────────────────────────────────────────────────────────────────
# HA failover: promote this standby NUC to primary.
#   1. pg_ctl promote (PostgreSQL exits recovery)
#   2. Update .env STATION_ROLE=server
#   3. Start gwi-pos container
#   4. Verify health
#
# Called by keepalived notify_master (via promote.sh wrapper) or
# by ha-promote.ts Step 6 with --skip-pg-promote when PG is already promoted.
#
# Flags:
#   --skip-pg-promote    Skip pg_ctl promote (PG already promoted by ha-promote.ts)
#   --new-primary-ip=IP  (unused, accepted for symmetry with rejoin)

promote() {
  local skip_pg_promote=false
  for arg in "$@"; do
    case "$arg" in
      --skip-pg-promote) skip_pg_promote=true ;;
      --new-primary-ip=*) ;; # accepted but unused for promote
    esac
  done

  log "HA promote: starting (skip_pg_promote=$skip_pg_promote)"

  # Step 1: pg_ctl promote (unless skipped)
  if [[ "$skip_pg_promote" != "true" ]]; then
    log "HA promote: promoting PostgreSQL..."
    local pg_promoted=false
    for pgver in 17 16 15; do
      local datadir="/var/lib/postgresql/${pgver}/main"
      if [[ -d "$datadir" ]]; then
        if sudo -u postgres pg_ctl promote -D "$datadir" 2>/dev/null; then
          log "HA promote: pg_ctl promote succeeded (PG ${pgver})"
          pg_promoted=true
          break
        fi
      fi
    done
    if [[ "$pg_promoted" != "true" ]]; then
      err "HA promote: pg_ctl promote failed for all PG versions"
      return 1
    fi

    # Wait for PG to exit recovery (max 30s)
    local waited=0
    while [[ $waited -lt 30 ]]; do
      local in_recovery
      in_recovery="$(sudo -u postgres psql -tAc 'SELECT pg_is_in_recovery()' 2>/dev/null || echo t)"
      if [[ "$in_recovery" == "f" ]]; then
        log "HA promote: PG exited recovery after ${waited}s"
        break
      fi
      sleep 1
      waited=$((waited + 1))
    done
    if [[ $waited -ge 30 ]]; then
      err "HA promote: PG still in recovery after 30s"
      return 1
    fi
  fi

  # Step 2: Update .env
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^STATION_ROLE=.*|STATION_ROLE=server|" "$ENV_FILE"
    else
      echo "STATION_ROLE=server" >> "$ENV_FILE"
    fi
    log "HA promote: STATION_ROLE=server written to $ENV_FILE"
  fi

  # Step 3: Start gwi-pos container
  if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    log "HA promote: starting Docker container ${CONTAINER_NAME}..."
    docker start "$CONTAINER_NAME" 2>/dev/null || {
      err "HA promote: docker start failed"
      return 1
    }
  else
    log "HA promote: container ${CONTAINER_NAME} not found — running deploy"
    deploy
    return $?
  fi

  # Step 4: Health check (max 60s)
  local port; port="$(read_port)"
  local hc_waited=0
  while [[ $hc_waited -lt 60 ]]; do
    if curl -sf --max-time 3 "http://localhost:${port}/api/health" >/dev/null 2>&1; then
      log "HA promote: POS healthy after ${hc_waited}s"
      log "HA promote: complete"
      return 0
    fi
    sleep 2
    hc_waited=$((hc_waited + 2))
  done

  err "HA promote: POS not healthy after 60s (container may still be starting)"
  return 0  # non-fatal — container is running
}

# ── rejoin ────────────────────────────────────────────────────────────────────
# HA rejoin: demote this NUC back to standby after the primary reclaims VIP.
#   1. Stop gwi-pos container (graceful drain)
#   2. Update .env STATION_ROLE=backup
#   3. (Optional) If --new-primary-ip is given, log it for operator reference
#
# pg_basebackup is NOT run automatically — it is destructive and should be
# triggered by the full rejoin-as-standby.sh script or MC fleet command.
# This subcommand handles the app-layer demotion (stop serving traffic).
#
# Flags:
#   --new-primary-ip=IP  The IP of the new primary (logged, not used for basebackup)

rejoin() {
  local new_primary_ip=""
  for arg in "$@"; do
    case "$arg" in
      --new-primary-ip=*) new_primary_ip="${arg#*=}" ;;
    esac
  done

  log "HA rejoin: starting (new_primary_ip=${new_primary_ip:-unset})"

  # Step 1: Stop gwi-pos container (15s grace period for connection draining)
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    log "HA rejoin: stopping Docker container ${CONTAINER_NAME} (15s grace)..."
    docker stop --time 15 "$CONTAINER_NAME" 2>/dev/null || {
      err "HA rejoin: docker stop failed — force killing"
      docker kill "$CONTAINER_NAME" 2>/dev/null || true
    }
    log "HA rejoin: container stopped"
  else
    log "HA rejoin: container ${CONTAINER_NAME} not running — nothing to stop"
  fi

  # Step 2: Update .env
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q "^STATION_ROLE=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^STATION_ROLE=.*|STATION_ROLE=backup|" "$ENV_FILE"
    else
      echo "STATION_ROLE=backup" >> "$ENV_FILE"
    fi
    # Also update PRIMARY_NUC_IP if new primary IP is provided
    if [[ -n "$new_primary_ip" ]]; then
      if grep -q "^PRIMARY_NUC_IP=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^PRIMARY_NUC_IP=.*|PRIMARY_NUC_IP=$new_primary_ip|" "$ENV_FILE"
      fi
      if grep -q "^HA_PEER_IP=" "$ENV_FILE" 2>/dev/null; then
        sed -i "s|^HA_PEER_IP=.*|HA_PEER_IP=$new_primary_ip|" "$ENV_FILE"
      fi
    fi
    log "HA rejoin: STATION_ROLE=backup written to $ENV_FILE"
  fi

  log "HA rejoin: complete — POS stopped, node demoted to standby"
  log "HA rejoin: NOTE — pg_basebackup NOT run. Use rejoin-as-standby.sh for full data resync."
  return 0
}

status() {
  # Compact status — one-liner per component
  echo "=== GWI Node Status (short) ==="

  # Server version
  local _ver _img
  _ver="$(jq -r '.version // "unknown"' "$VERSION_FILE" 2>/dev/null || echo "unknown")"
  _img="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")"
  echo "Server: ${_ver} (${_img})"

  # Container state
  local _cstate _chealth _uptime
  _cstate="$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not running")"
  _chealth="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
  _uptime="$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER_NAME" 2>/dev/null || echo "")"
  echo "Container: ${_cstate} (${_chealth})"

  # Venue lifecycle
  local _vs_lifecycle="not initialized"
  [[ -f "$VENUE_STATE_FILE" ]] && _vs_lifecycle="$(jq -r '.lifecycleState // "UNKNOWN"' "$VENUE_STATE_FILE" 2>/dev/null || echo "UNKNOWN")"
  echo "Venue: ${_vs_lifecycle}"

  # Dashboard
  local _dash_installed _dash_target
  _dash_installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "not-installed")
  _dash_target=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardVersion',''))" 2>/dev/null || echo "unknown")
  local _dash_label="v${_dash_installed}"
  [[ "$_dash_installed" == "$_dash_target" ]] && _dash_label="${_dash_label} (converged)" || _dash_label="${_dash_label} (diverged)"
  echo "Dashboard: ${_dash_label}"

  # Dashboard warning
  if [[ -f "${STATE_DIR}/dashboard-warning.json" ]]; then
    echo "Warning: $(jq -r '.message // .reason // "see dashboard-warning.json"' "${STATE_DIR}/dashboard-warning.json" 2>/dev/null || echo "active")"
  fi

  echo ""
  echo "Run 'gwi-node full-status' for detailed report."
}

full_status() {
  echo "=== GWI POS Appliance Status ==="
  echo ""

  # ── Venue lifecycle ──
  local _vs_lifecycle="not initialized"
  [[ -f "$VENUE_STATE_FILE" ]] && _vs_lifecycle="$(jq -r '.lifecycleState // "UNKNOWN"' "$VENUE_STATE_FILE" 2>/dev/null || echo "UNKNOWN")"
  echo "Venue Lifecycle: ${_vs_lifecycle}"

  # ── Server version ──
  local _ver="unknown" _ver_status="unknown"
  if [[ -f "$VERSION_FILE" ]]; then
    _ver="$(jq -r '.version // "unknown"' "$VERSION_FILE" 2>/dev/null || echo "unknown")"
  fi
  if [[ -f "$VENUE_STATE_FILE" ]]; then
    _ver_status="$(jq -r '.components.server.status // "unknown"' "$VENUE_STATE_FILE" 2>/dev/null || echo "unknown")"
  fi
  echo "Server: v${_ver} (${_ver_status})"

  # ── Schema ──
  local _schema_count="unknown" _schema_status="unknown"
  if [[ -f "$VENUE_STATE_FILE" ]]; then
    _schema_status="$(jq -r '.components.schema.status // "unknown"' "$VENUE_STATE_FILE" 2>/dev/null || echo "unknown")"
    _schema_count="$(jq -r '.components.schema.currentVersion // "unknown"' "$VENUE_STATE_FILE" 2>/dev/null || echo "unknown")"
  fi
  echo "Schema: ${_schema_count} migrations (${_schema_status})"

  # ── Dashboard ──
  local _dash_installed _dash_target _dash_status
  _dash_installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "not-installed")
  _dash_target=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardVersion',''))" 2>/dev/null || echo "unknown")
  if [[ "$_dash_installed" == "$_dash_target" ]]; then
    _dash_status="converged"
  else
    _dash_status="diverged (target=${_dash_target})"
  fi
  echo "Dashboard: v${_dash_installed} (${_dash_status})"

  # ── Container health ──
  local _cstate _chealth _started _uptime_str
  _cstate="$(docker inspect --format='{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "not running")"
  _chealth="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")"
  _started="$(docker inspect --format='{{.State.StartedAt}}' "$CONTAINER_NAME" 2>/dev/null || echo "")"
  _uptime_str=""
  if [[ -n "$_started" ]] && command -v python3 &>/dev/null; then
    _uptime_str="$(python3 -c "
from datetime import datetime, timezone
try:
    s = datetime.fromisoformat('${_started}'.replace('Z','+00:00'))
    d = datetime.now(timezone.utc) - s
    h, r = divmod(int(d.total_seconds()), 3600)
    m = r // 60
    print(f'uptime {h}h{m}m')
except:
    print('')
" 2>/dev/null || echo "")"
  fi
  echo "Container: ${_cstate} (${_chealth}${_uptime_str:+, ${_uptime_str}})"

  # ── Last deploy result ──
  local _last_deploy="none"
  if [[ -d "$RESULTS_DIR" ]]; then
    local _latest_file
    _latest_file="$(ls -1t "$RESULTS_DIR"/*.json 2>/dev/null | head -1)"
    if [[ -n "$_latest_file" ]]; then
      local _deploy_ts _deploy_status
      _deploy_ts="$(jq -r '.timestamp // "unknown"' "$_latest_file" 2>/dev/null || echo "unknown")"
      _deploy_status="$(jq -r '.finalStatus // "unknown"' "$_latest_file" 2>/dev/null || echo "unknown")"
      _last_deploy="${_deploy_ts} (${_deploy_status})"
    fi
  fi
  # Also check deploy logs dir
  if [[ "$_last_deploy" == "none" ]] && [[ -d "$LOG_DIR" ]]; then
    local _latest_log
    _latest_log="$(ls -1t "$LOG_DIR"/*.json 2>/dev/null | head -1)"
    if [[ -n "$_latest_log" ]]; then
      local _deploy_ts _deploy_status
      _deploy_ts="$(jq -r '.timestamp // "unknown"' "$_latest_log" 2>/dev/null || echo "unknown")"
      _deploy_status="$(jq -r '.finalStatus // "unknown"' "$_latest_log" 2>/dev/null || echo "unknown")"
      _last_deploy="${_deploy_ts} (${_deploy_status})"
    fi
  fi
  echo "Last Deploy: ${_last_deploy}"

  # ── Install state ──
  local _install_state_file="${STATE_DIR}/install-state.json"
  local _install_stage="unknown" _install_status="unknown"
  if [[ -f "$_install_state_file" ]]; then
    _install_stage="$(jq -r '.currentStage // "unknown"' "$_install_state_file" 2>/dev/null || echo "unknown")"
    _install_status="$(jq -r '.stageStatus // "unknown"' "$_install_state_file" 2>/dev/null || echo "unknown")"
    echo "Install State: ${_install_status} (stage: ${_install_stage})"
  else
    echo "Install State: no install-state.json"
  fi

  # ── Dashboard warning ──
  if [[ -f "${STATE_DIR}/dashboard-warning.json" ]]; then
    local _warn_msg
    _warn_msg="$(jq -r '.message // .reason // "see dashboard-warning.json"' "${STATE_DIR}/dashboard-warning.json" 2>/dev/null || echo "active")"
    echo "Dashboard Warning: ${_warn_msg}"
  else
    echo "Dashboard Warning: none"
  fi

  # ── LKG info ──
  echo ""
  echo "--- Last Known Good ---"
  echo "  Server image:    $(cat "$LKG_IMAGE_FILE" 2>/dev/null || echo none)"
  echo "  Server version:  $(cat "$LKG_VERSION_FILE" 2>/dev/null || echo none)"
  echo "  Dashboard:       $(cat "$LKG_DASHBOARD_FILE" 2>/dev/null || echo none)"
}

self_update() {
  local current_image tmp="/tmp/gwi-node-new.sh"
  current_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null)" || {
    echo "No running container to extract from"; return 0; }
  if extract_from_image "$current_image" /app/public/scripts/gwi-node.sh "$tmp"; then
    chmod 755 "$tmp"; mv "$tmp" "$0"
    log "Self-updated from $current_image"
  else
    echo "Could not extract gwi-node.sh from image — skipping"
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
  WATCH_DIE_FIRED=false SELF_UPDATED=false BOOTSTRAP_SCRIPT_UPDATED=false BOOTSTRAP_SERVICE_UPDATED=false
  BOOTSTRAP_WATCHER_STARTED=false BOOTSTRAP_DEGRADED=false
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
    dashboard-check)
      dashboard_check || dispatch_rc=$?
      [[ $dispatch_rc -eq 0 ]] && FINAL_STATUS="healthy"
      ;;
    dashboard-rollback)
      dashboard_rollback || dispatch_rc=$?
      [[ $dispatch_rc -eq 0 ]] && FINAL_STATUS="healthy"
      ;;
    promote)
      promote || dispatch_rc=$?
      [[ $dispatch_rc -eq 0 ]] && FINAL_STATUS="healthy"
      ;;
    rejoin)
      rejoin || dispatch_rc=$?
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

  # Snapshot our own SHA so we can detect when bootstrap updates us on disk
  local _self_sha
  _self_sha="$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1 || echo none)"

  # Graceful shutdown on SIGTERM/SIGINT
  local watch_running=true
  trap 'log "Watch mode shutting down (signal received)"; watch_running=false' SIGTERM SIGINT

  while [[ "$watch_running" == true ]]; do
    # Pick first trigger file by filename sort (UUID-based, not chronological)
    local oldest
    oldest="$(ls -1 "$REQUESTS_DIR"/*.json 2>/dev/null | sort | head -1 || true)"

    if [[ -n "$oldest" ]] && [[ -f "$oldest" ]]; then
      dispatch_trigger "$oldest"

      # After dispatch, check if the host script was updated on disk by
      # deploy_success() → bootstrap_host_watcher(). If so, re-exec so
      # the watcher runs the new code (with preflight, new features, etc.)
      local _new_sha
      _new_sha="$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1 || echo none)"
      if [[ "$_new_sha" != "$_self_sha" ]]; then
        log "Watch: host script updated on disk (${_self_sha:0:12} → ${_new_sha:0:12}), re-execing..."
        exec "$0" watch
      fi
    fi

    # Stale trigger cleanup
    cleanup_stale_triggers

    sleep "$WATCH_POLL_INTERVAL" &
    wait $! 2>/dev/null || true  # wait is interruptible by signals
  done

  log "Watch mode exited"
}

# ---------------------------------------------------------------------------
#  converge — single-run check-and-fix for all venue components
# ---------------------------------------------------------------------------
# Reads venue state and version-contract, compares each component against
# its target, and attempts reconciliation for any diverged components.
# Idempotent: safe to run repeatedly. Uses existing deploy/update/vs_* functions.
# ---------------------------------------------------------------------------

# Read a field from the version-contract inside the running container.
# Usage: _cv_read_contract <jq_expression>
_cv_read_contract() {
  docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | jq -r "$1" 2>/dev/null || echo ""
}

# Quick health probe — single HTTP check (not the full HEALTH_CONSECUTIVE loop).
# Returns 0 if healthy, 1 otherwise.
_cv_health_probe() {
  local port code
  port="$(read_port)"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:${port}/api/health/ready" 2>/dev/null || echo 000)"
  [[ "$code" == "200" ]]
}

converge() {
  log "=== Convergence check ==="
  mkdir -p "$STATE_DIR"
  vs_ensure_file

  local _cv_server_running=false
  local _cv_server_image="" _cv_server_version=""
  local _cv_target_version=""

  # ── Observe current server state ───────────────────────────────────────────
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    _cv_server_running=true
    _cv_server_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    _cv_server_version="${_cv_server_image##*:}"
  fi

  if [[ "$_cv_server_running" == true ]]; then
    _cv_target_version=$(_cv_read_contract '.version // empty')
  fi

  # ── Component: Server ──────────────────────────────────────────────────────
  if [[ "$_cv_server_running" != true ]]; then
    log "Converge/server: NOT RUNNING — attempting start"

    local last_image=""
    [[ -f "$VERSION_FILE" ]] && last_image="$(jq -r '.imageRef // empty' "$VERSION_FILE" 2>/dev/null || true)"

    if [[ -n "$last_image" ]]; then
      ensure_port_available 2>/dev/null || true
      ensure_runtime_dirs 2>/dev/null || true
      if start_container "$last_image" 2>/dev/null; then
        sleep 5
        if _cv_health_probe; then
          vs_update_component "server" "converged" "${last_image##*:}" "${last_image##*:}"
          log "Converge/server: started from $last_image"
          start_agent "$last_image" 2>/dev/null || log "WARN: converge — gwi-agent failed to start"
          _cv_server_running=true
          _cv_server_image="$last_image"
          _cv_server_version="${last_image##*:}"
        else
          vs_update_component "server" "failed" "" "${last_image##*:}" "Container started but unhealthy"
        fi
      else
        vs_update_component "server" "failed" "" "${last_image##*:}" "start_container failed"
      fi
    else
      vs_update_component "server" "failed" "" "unknown" "No known image to start from"
    fi

  elif ! _cv_health_probe; then
    log "Converge/server: UNHEALTHY — restarting container"
    docker restart "$CONTAINER_NAME" 2>/dev/null || true
    sleep 10
    if _cv_health_probe; then
      vs_update_component "server" "converged" "$_cv_server_version" "$_cv_server_version"
      log "Converge/server: healthy after restart"
    else
      vs_update_component "server" "failed" "$_cv_server_version" "$_cv_server_version" "Still unhealthy after restart"
    fi

  elif [[ -n "$_cv_target_version" ]] && [[ "$_cv_server_version" != "$_cv_target_version" ]]; then
    log "Converge/server: VERSION MISMATCH (${_cv_server_version} != ${_cv_target_version}) — triggering deploy"
    vs_update_component "server" "behind" "$_cv_server_version" "$_cv_target_version"

    # Use the existing deploy flow
    reset_deploy_state 2>/dev/null || true
    MANIFEST_URL="${R2_ORIGIN}/latest/manifest.json"
    SKIP_SELF_UPDATE=true
    if deploy 2>/dev/null; then
      log "Converge/server: deploy succeeded"
      # deploy_success already calls vs_update_component
    else
      # deploy() returns non-zero even when rollback succeeds inside deploy_failure().
      # Re-read venue state: if rollback already marked server=converged at the
      # rolled-back version, don't overwrite with "failed".
      local _cv_post_status=""
      _cv_post_status=$(python3 -c "
import json, sys
try:
    s = json.load(open('$VENUE_STATE_FILE'))
    print(s['components']['server']['status'])
except: print('')
" 2>/dev/null || true)
      if [[ "$_cv_post_status" == "converged" ]]; then
        log "Converge/server: deploy failed but rollback succeeded — keeping converged state"
      else
        vs_update_component "server" "failed" "$_cv_server_version" "$_cv_target_version" "Deploy failed"
      fi
    fi

  else
    vs_update_component "server" "converged" "$_cv_server_version" "${_cv_target_version:-$_cv_server_version}"
    log "Converge/server: OK (${_cv_server_version})"
  fi

  # Refresh running state after server reconciliation
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
    _cv_server_running=true
    _cv_server_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
    _cv_server_version="${_cv_server_image##*:}"
    [[ -z "$_cv_target_version" ]] && _cv_target_version=$(_cv_read_contract '.version // empty')
  fi

  # ── Component: Dashboard ───────────────────────────────────────────────────
  if [[ "${STATION_ROLE:-}" == "terminal" ]]; then
    log "Converge/dashboard: skipped (terminal role)"
  elif [[ "$_cv_server_running" != true ]]; then
    log "Converge/dashboard: skipped (server not running)"
  else
    local _cv_dash_installed _cv_dash_target
    _cv_dash_installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "")
    _cv_dash_target=$(_cv_read_contract '.dashboardVersion // empty')

    if [[ -z "$_cv_dash_target" ]]; then
      log "Converge/dashboard: no target in version-contract"
    elif [[ "$_cv_dash_installed" != "$_cv_dash_target" ]]; then
      log "Converge/dashboard: DIVERGED (${_cv_dash_installed:-none} != ${_cv_dash_target}) — updating"
      vs_update_component "dashboard" "behind" "${_cv_dash_installed:-0.0.0}" "$_cv_dash_target"

      if update_dashboard 2>/dev/null; then
        local _cv_dash_after
        _cv_dash_after=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "")
        if [[ "$_cv_dash_after" == "$_cv_dash_target" ]]; then
          vs_update_component "dashboard" "converged" "$_cv_dash_after" "$_cv_dash_target"
          log "Converge/dashboard: updated to ${_cv_dash_after}"
        else
          vs_update_component "dashboard" "failed" "${_cv_dash_after:-0.0.0}" "$_cv_dash_target" "Update ran but version still ${_cv_dash_after:-none}"
        fi
      else
        vs_update_component "dashboard" "failed" "${_cv_dash_installed:-0.0.0}" "$_cv_dash_target" "update_dashboard failed"
      fi
    else
      # Version matches — check if service is running
      local _cv_dash_svc _posuser="${POSUSER:-gwipos}"
      _cv_dash_svc=$(sudo -u "${_posuser}" bash -c \
        "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user is-active gwi-dashboard.service" 2>/dev/null || echo "inactive")
      if [[ "$_cv_dash_svc" != "active" ]]; then
        log "Converge/dashboard: service not running — starting"
        sudo -u "${_posuser}" bash -c \
          "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user start gwi-dashboard.service" 2>/dev/null || true
        sleep 2
        _cv_dash_svc=$(sudo -u "${_posuser}" bash -c \
          "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user is-active gwi-dashboard.service" 2>/dev/null || echo "inactive")
        if [[ "$_cv_dash_svc" == "active" ]]; then
          vs_update_component "dashboard" "converged" "$_cv_dash_installed" "$_cv_dash_target"
          log "Converge/dashboard: service started"
        else
          vs_update_component "dashboard" "failed" "$_cv_dash_installed" "$_cv_dash_target" "Service failed to start"
        fi
      else
        vs_update_component "dashboard" "converged" "$_cv_dash_installed" "$_cv_dash_target"
        log "Converge/dashboard: OK (${_cv_dash_installed})"
      fi
    fi
  fi

  # ── Component: Schema ──────────────────────────────────────────────────────
  if [[ "$_cv_server_running" != true ]]; then
    log "Converge/schema: skipped (server not running)"
  else
    local _cv_schema_target _cv_schema_current
    _cv_schema_target=$(_cv_read_contract '.migrationCount // 0')
    # Query local PG for applied migration count
    _cv_schema_current=$(docker exec "$CONTAINER_NAME" \
      node -e "
        const { PrismaClient } = require('@prisma/client');
        const p = new PrismaClient();
        p.\$queryRawUnsafe('SELECT COUNT(*) as c FROM _gwi_migrations')
          .then(r => { console.log(r[0].c || 0); process.exit(0); })
          .catch(() => { console.log(0); process.exit(0); });
      " 2>/dev/null || echo 0)

    if [[ "$_cv_schema_target" -eq 0 ]]; then
      log "Converge/schema: no migrationCount in version-contract"
    elif [[ "$_cv_schema_current" -lt "$_cv_schema_target" ]]; then
      log "Converge/schema: BEHIND (${_cv_schema_current}/${_cv_schema_target}) — running migrations"
      vs_update_component "schema" "behind" "$_cv_schema_current" "$_cv_schema_target"

      if docker run --rm --env-file "$ENV_FILE" --network=host "$_cv_server_image" \
        node deploy-tools/src/migrate.js 2>/dev/null; then
        # Re-check
        _cv_schema_current=$(docker exec "$CONTAINER_NAME" \
          node -e "
            const { PrismaClient } = require('@prisma/client');
            const p = new PrismaClient();
            p.\$queryRawUnsafe('SELECT COUNT(*) as c FROM _gwi_migrations')
              .then(r => { console.log(r[0].c || 0); process.exit(0); })
              .catch(() => { console.log(0); process.exit(0); });
          " 2>/dev/null || echo 0)
        if [[ "$_cv_schema_current" -ge "$_cv_schema_target" ]]; then
          vs_update_component "schema" "converged" "$_cv_schema_current" "$_cv_schema_target"
          log "Converge/schema: migrations applied (${_cv_schema_current}/${_cv_schema_target})"
        else
          vs_update_component "schema" "failed" "$_cv_schema_current" "$_cv_schema_target" "Migrations ran but count still ${_cv_schema_current}/${_cv_schema_target}"
        fi
      else
        vs_update_component "schema" "failed" "$_cv_schema_current" "$_cv_schema_target" "Migration runner failed"
      fi
    else
      vs_update_component "schema" "converged" "$_cv_schema_current" "$_cv_schema_target"
      log "Converge/schema: OK (${_cv_schema_current}/${_cv_schema_target})"
    fi
  fi

  # ── Summary ────────────────────────────────────────────────────────────────
  local lifecycle
  lifecycle=$(jq -r '.lifecycleState // "UNKNOWN"' "$VENUE_STATE_FILE" 2>/dev/null || echo "UNKNOWN")
  log "Convergence complete: lifecycle=${lifecycle}"
  return 0
}

# ---------------------------------------------------------------------------
#  converge-loop — run converge on a recurring timer
# ---------------------------------------------------------------------------
converge_loop() {
  local interval="${1:-300}"  # Default: every 5 minutes
  log "Starting convergence loop (interval: ${interval}s)"

  # Graceful shutdown on SIGTERM/SIGINT
  local loop_running=true
  trap 'log "Convergence loop shutting down (signal received)"; loop_running=false' SIGTERM SIGINT

  while [[ "$loop_running" == true ]]; do
    converge || log "WARN: converge returned non-zero (non-fatal)"

    # Interruptible sleep
    sleep "$interval" &
    wait $! 2>/dev/null || true
  done

  log "Convergence loop exited"
}

# ---------------------------------------------------------------------------
#  install_converge_service — write systemd unit for the convergence agent
# ---------------------------------------------------------------------------
install_converge_service() {
  local interval="${1:-300}"
  local unit_path="/etc/systemd/system/gwi-converge.service"
  local script_path="${BASE_DIR}/gwi-node.sh"

  # Prefer the installed copy; fall back to this script's location
  [[ -f "$script_path" ]] || script_path="$0"

  log "Installing convergence service (interval: ${interval}s)"

  cat > "$unit_path" <<SVCEOF
[Unit]
Description=GWI POS Venue Convergence Agent
After=docker.service
Requires=docker.service

[Service]
Type=simple
ExecStart=${script_path} converge-loop ${interval}
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gwi-converge

[Install]
WantedBy=multi-user.target
SVCEOF

  chmod 644 "$unit_path"
  systemctl daemon-reload

  if ! systemctl enable gwi-converge.service; then
    err "Failed to enable gwi-converge.service"
    return 1
  fi

  # Restart if already running (e.g., unit file was updated); start otherwise
  if systemctl is-active gwi-converge.service >/dev/null 2>&1; then
    if ! systemctl restart gwi-converge.service; then
      err "Failed to restart gwi-converge.service"
    fi
    log "Convergence service restarted: $unit_path"
  else
    if ! systemctl start gwi-converge.service; then
      err "Failed to start gwi-converge.service — will start on next boot"
    else
      log "Convergence service installed and started: $unit_path"
    fi
  fi
}

# ── cleanup ────────────────────────────────────────────────────────────────────
# Reclaim disk space: prune dangling Docker images, remove old deploy logs.
# Safe to run at any time. Does NOT remove the running or LKG images.
cleanup_node() {
  log "=== GWI Node Cleanup ==="

  # Prune dangling Docker images
  local pruned
  pruned=$(docker image prune -f --filter "dangling=true" 2>&1) || true
  log "Docker image prune: $pruned"

  # Remove deploy logs older than 30 days
  local removed=0
  if [[ -d "$LOG_DIR" ]]; then
    while IFS= read -r -d '' f; do
      rm -f "$f" && removed=$((removed + 1))
    done < <(find "$LOG_DIR" -name '*.json' -type f -mtime +30 -print0 2>/dev/null)
  fi
  log "Removed $removed deploy log(s) older than 30 days"

  # Remove stale deploy results older than 7 days
  local stale_results=0
  if [[ -d "$RESULTS_DIR" ]]; then
    while IFS= read -r -d '' f; do
      rm -f "$f" && stale_results=$((stale_results + 1))
    done < <(find "$RESULTS_DIR" -name '*.json' -type f -mtime +7 -print0 2>/dev/null)
  fi
  log "Removed $stale_results stale deploy result(s) older than 7 days"

  log "Cleanup complete"
}

# ── clear-quarantine ──────────────────────────────────────────────────────────
# Remove quarantine marker for a specific release (or all) from bad-releases.json.
# Usage: clear_quarantine [releaseId]
#   - With releaseId: remove that single entry from bad-releases.json
#   - Without releaseId: delete bad-releases.json entirely (clear all)
clear_quarantine() {
  local release_id="${1:-}"
  local bad_releases_file="${STATE_DIR}/bad-releases.json"

  if [[ ! -f "$bad_releases_file" ]]; then
    log "No quarantine file found — nothing to clear"
    return 0
  fi

  if [[ -z "$release_id" ]]; then
    rm -f "$bad_releases_file"
    log "Cleared all quarantined releases"
  else
    # Remove the specific entry using python3 (jq may not be installed)
    python3 - "$release_id" "$bad_releases_file" << 'CLEARQ'
import json, sys
release_id = sys.argv[1]
path = sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
    if isinstance(data, list):
        data = [e for e in data if e.get('releaseId') != release_id]
    elif isinstance(data, dict):
        data.pop(release_id, None)
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"Removed {release_id} from quarantine")
except Exception as e:
    print(f"WARN: Could not update quarantine file: {e}")
CLEARQ
    log "Cleared quarantine for release: $release_id"
  fi
}

# ── Source guard ────────────────────────────────────────────────────────────
# When sourced by the installer (source installer-modules/gwi-node.sh), only
# define functions — do not parse args or run commands. The installer calls
# gwi-node.sh functions directly (e.g., via "bash gwi-node.sh install").
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0 2>/dev/null || true
fi

SUBCOMMAND="${1:-deploy}"
shift 2>/dev/null || true

# converge-loop and install-converge-service accept a positional interval arg
# promote/rejoin accept HA-specific flags passed through as HA_ARGS
# clear-quarantine accepts an optional releaseId positional arg
CONVERGE_INTERVAL=""
CLEAR_QUARANTINE_RELEASE=""
HA_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)              FORCE=true; shift ;;
    --manifest-url)       MANIFEST_URL="$2"; shift 2 ;;
    --image-ref)          IMAGE_REF="$2"; shift 2 ;;
    --image-digest)       IMAGE_DIGEST="$2"; shift 2 ;;
    --skip-self-update)   SKIP_SELF_UPDATE=true; shift ;;
    --self-updated)       SELF_UPDATED=true; shift ;;
    --skip-pg-promote)    HA_ARGS+=("$1"); shift ;;
    --new-primary-ip=*)   HA_ARGS+=("$1"); shift ;;
    *)
      # Positional arg for converge-loop / install-converge-service / clear-quarantine
      if [[ "$SUBCOMMAND" == "converge-loop" ]] || [[ "$SUBCOMMAND" == "install-converge-service" ]]; then
        CONVERGE_INTERVAL="$1"; shift
      elif [[ "$SUBCOMMAND" == "clear-quarantine" ]]; then
        CLEAR_QUARANTINE_RELEASE="$1"; shift
      else
        echo "Unknown flag: $1"; exit 1
      fi
      ;;
  esac
done

case "$SUBCOMMAND" in
  install)                    install ;;
  deploy)                     deploy ;;
  rollback)                   rollback ;;
  promote)                    promote "${HA_ARGS[@]}" ;;
  rejoin)                     rejoin "${HA_ARGS[@]}" ;;
  status)                     status ;;
  full-status)                full_status ;;
  self-update)                self_update ;;
  watch)                      watch_loop ;;
  dashboard-check)            dashboard_check ;;
  dashboard-rollback)         dashboard_rollback ;;
  venue-state)                venue_state ;;
  converge)                   converge ;;
  converge-loop)              converge_loop "${CONVERGE_INTERVAL:-300}" ;;
  install-converge-service)   install_converge_service "${CONVERGE_INTERVAL:-300}" ;;
  cleanup)                    cleanup_node ;;
  clear-quarantine)           clear_quarantine "${CLEAR_QUARANTINE_RELEASE:-}" ;;
  *)                          echo "Usage: gwi-node.sh {install|deploy|rollback|promote|rejoin|status|full-status|self-update|watch|dashboard-check|dashboard-rollback|venue-state|converge|converge-loop|install-converge-service|cleanup|clear-quarantine}"; exit 1 ;;
esac
