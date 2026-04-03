#!/usr/bin/env bash
# gwi-node.sh — GWI POS node agent (install | deploy | rollback | status | self-update)
# One agent. One runtime. One flow. Install and update are the same operation.
set -euo pipefail

readonly BASE_DIR="/opt/gwi-pos"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly STATE_DIR="${SHARED_DIR}/state"
readonly LOG_DIR="${SHARED_DIR}/logs/deploys"
readonly LOCK_FILE="${STATE_DIR}/gwi-node.lock"
readonly VERSION_FILE="${STATE_DIR}/running-version.json"
readonly PREVIOUS_IMAGE_FILE="${STATE_DIR}/previous-image.txt"
readonly CONTAINER_NAME="gwi-pos"
readonly R2_ORIGIN="https://pub-15bf4245be0e4c05b570d31988004d09.r2.dev"
readonly LOCK_TIMEOUT=300 HEALTH_MAX_ATTEMPTS=30 HEALTH_INTERVAL=2 HEALTH_CONSECUTIVE=3
ENV_FILE="${SHARED_DIR}/.env"; [[ -f "$ENV_FILE" ]] || ENV_FILE="${BASE_DIR}/.env"; readonly ENV_FILE

DEPLOY_ID="" DEPLOY_START=0 IMAGE_REF="" IMAGE_DIGEST="" PREVIOUS_IMAGE=""
MANIFEST_URL="${R2_ORIGIN}/latest/manifest.json" FORCE=false FINAL_STATUS="pending"
SCHEMA_RESULT="" ROLLBACK_RESULT="" ROLLBACK_READINESS="" LOCK_FD="" ERRORS=()

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

die() { err "$*"; FINAL_STATUS="failed"; write_deploy_log; exit 1; }

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

systemd_last_resort() {
  log "Last resort: attempting systemd thepasspos..."
  systemctl enable thepasspos 2>/dev/null || true
  systemctl start thepasspos 2>/dev/null || true
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
  trap 'cleanup' EXIT
  log "Deploy $DEPLOY_ID starting"
  if [[ -z "$IMAGE_REF" ]]; then
    log "Fetching manifest: $MANIFEST_URL"
    local manifest
    manifest="$(curl -fsSL --max-time 30 "$MANIFEST_URL")" || die "Failed to fetch manifest"
    IMAGE_REF="$(echo "$manifest" | jq -r '.imageRef // empty')"
    [[ -n "$IMAGE_REF" ]] || die "Manifest missing imageRef"
    [[ -z "$IMAGE_DIGEST" ]] && IMAGE_DIGEST="$(echo "$manifest" | jq -r '.imageDigest // empty' || true)"
    log "Manifest resolved: image=$IMAGE_REF digest=${IMAGE_DIGEST:-none}"
  fi

  PREVIOUS_IMAGE="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [[ -n "$PREVIOUS_IMAGE" ]] && echo "$PREVIOUS_IMAGE" > "$PREVIOUS_IMAGE_FILE"
  log "Pulling: $IMAGE_REF"
  docker pull "$IMAGE_REF" || die "Failed to pull: $IMAGE_REF"
  if [[ -n "$IMAGE_DIGEST" ]]; then
    local actual expected
    actual="$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE_REF" 2>/dev/null \
      | grep -oP 'sha256:[a-f0-9]+' || true)"
    expected="$(echo "$IMAGE_DIGEST" | grep -oP 'sha256:[a-f0-9]+')"
    if [[ "$actual" != "$expected" ]]; then
      [[ "$FORCE" == true ]] \
        && log "WARN: Digest mismatch (forced): expected=$expected actual=$actual" \
        || die "Digest mismatch: expected=$expected actual=$actual"
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
  fi
  if grep -q "^NEON_DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
    log "Running schema migration (Neon)..."
    docker run --rm --env-file "$ENV_FILE" --network=host \
      -e NEON_MIGRATE=true "$IMAGE_REF" \
      node deploy-tools/src/migrate.js \
      && log "Neon migration complete" \
      || log "WARNING: Neon migration failed — continuing"
  fi
  log "Stopping old container..."
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
  systemctl stop thepasspos 2>/dev/null || true
  systemctl disable thepasspos 2>/dev/null || true
  log "Starting: $IMAGE_REF"
  start_container "$IMAGE_REF" || die "Failed to start container"
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
  exit 1
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
  [[ -f "$PREVIOUS_IMAGE_FILE" ]] || { echo "No previous image to roll back to"; exit 1; }
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
  *)           echo "Usage: gwi-node.sh {install|deploy|rollback|status|self-update}"; exit 1 ;;
esac
