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

  bootstrap_host_watcher "$IMAGE_REF"

  # ── Dashboard update (non-fatal) ──────────────────────────────────────────
  # Check if a newer dashboard .deb is available and install it.
  # Downloads from the POS Vercel deployment (same origin as version-contract).
  update_dashboard || log "WARN: Dashboard update skipped (non-fatal)"

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

  local installed available deb_url deb_path

  # Read desired version from the running container's version-contract
  available=$(docker exec "$CONTAINER_NAME" cat /app/public/version-contract.json 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('dashboardVersion',''))" 2>/dev/null || true)
  [[ -z "$available" ]] && { log "Dashboard: no dashboardVersion in version-contract — skipping"; return 0; }

  # Get currently installed version
  installed=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "0.0.0")

  if [[ "$installed" == "$available" ]]; then
    log "Dashboard: already at v${installed} — no update needed"
    return 0
  fi

  log "Dashboard: updating v${installed} → v${available}"

  # Download .deb from the POS app (Vercel serves static files from /public)
  deb_path="/tmp/gwi-nuc-dashboard-${available}.deb"
  deb_url="$(docker exec "$CONTAINER_NAME" printenv NEXT_PUBLIC_BASE_URL 2>/dev/null || echo 'http://localhost:3005')/gwi-nuc-dashboard.deb"

  if ! curl -sfL "$deb_url" -o "$deb_path" 2>/dev/null; then
    # Fallback: try the container's static files directly
    docker cp "${CONTAINER_NAME}:/app/public/gwi-nuc-dashboard.deb" "$deb_path" 2>/dev/null || {
      log "Dashboard: download failed — skipping"
      rm -f "$deb_path" 2>/dev/null
      return 0
    }
  fi

  # Validate file size (must be > 100KB to be a real .deb)
  local size
  size=$(stat -c%s "$deb_path" 2>/dev/null || echo 0)
  if [[ "$size" -lt 100000 ]]; then
    log "Dashboard: downloaded file too small (${size} bytes) — skipping"
    rm -f "$deb_path" 2>/dev/null
    return 0
  fi

  # Install — .deb is built without /usr/share/icons (stripped at CI time)
  # so dpkg won't fail on read-only icon paths. sudo ensures root privileges.
  sudo dpkg -i "$deb_path" 2>&1 | while IFS= read -r line; do log "Dashboard: $line"; done
  sudo dpkg --configure -a 2>/dev/null || true
  sudo apt-get install -f -y -qq 2>/dev/null || true

  # Verify the install actually worked by checking the installed version
  local final_version
  final_version=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "0.0.0")
  if [[ "$final_version" == "$available" ]]; then
    log "Dashboard: v${available} installed and configured successfully"
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
      "XDG_RUNTIME_DIR=/run/user/\$(id -u) systemctl --user daemon-reload && systemctl --user enable gwi-dashboard.service && systemctl --user start gwi-dashboard.service" 2>/dev/null || true
  else
    log "Dashboard: install may have failed — expected v${available}, got v${final_version}"
  fi

  rm -f "$deb_path" 2>/dev/null
  return 0
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
        write_deploy_state "rolled_back"
        log "Rollback healthy — previous image restored"
      else
        ROLLBACK_RESULT="pass"; ROLLBACK_READINESS="fail"; FINAL_STATUS="rollback_failed"
        write_deploy_state "rollback_failed"
        err "Rollback container started but health check failed"
        systemd_last_resort
      fi
    else
      ROLLBACK_RESULT="fail"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
      write_deploy_state "rollback_failed"
      err "Failed to start rollback container"
      systemd_last_resort
    fi
  else
    ROLLBACK_RESULT="not_attempted"; ROLLBACK_READINESS="not_attempted"; FINAL_STATUS="rollback_failed"
    write_deploy_state "rollback_failed"
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

# ── Source guard ────────────────────────────────────────────────────────────
# When sourced by the installer (source installer-modules/gwi-node.sh), only
# define functions — do not parse args or run commands. The installer calls
# gwi-node.sh functions directly (e.g., via "bash gwi-node.sh install").
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0 2>/dev/null || true
fi

SUBCOMMAND="${1:-deploy}"
shift 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)              FORCE=true; shift ;;
    --manifest-url)       MANIFEST_URL="$2"; shift 2 ;;
    --image-ref)          IMAGE_REF="$2"; shift 2 ;;
    --image-digest)       IMAGE_DIGEST="$2"; shift 2 ;;
    --skip-self-update)   SKIP_SELF_UPDATE=true; shift ;;
    --self-updated)       SELF_UPDATED=true; shift ;;
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
