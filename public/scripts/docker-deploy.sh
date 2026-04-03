#!/usr/bin/env bash
# =============================================================================
# docker-deploy.sh — Docker-based deploy for GWI POS NUC servers
# =============================================================================
# Replaces the 2,300-line deploy-release.sh for Docker-based deploys.
# All deploy paths call this ONE script.
#
# Usage:
#   docker-deploy.sh --image-ref ghcr.io/getwithitman/gwi-pos:1.2.82
#   docker-deploy.sh --image-ref <ref> --image-digest <sha256:...>
#   docker-deploy.sh --manifest-url <url>
#   docker-deploy.sh --rollback
#   docker-deploy.sh --force --image-ref <ref>
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
readonly BASE_DIR="/opt/gwi-pos"
readonly SHARED_DIR="${BASE_DIR}/shared"
readonly STATE_DIR="${SHARED_DIR}/state"
readonly DEPLOY_LOG_DIR="${SHARED_DIR}/logs/deploys"
readonly ENV_FILE="${BASE_DIR}/.env"
readonly LOCKFILE="${STATE_DIR}/docker-deploy.lock"
readonly MAINTENANCE_FLAG="${STATE_DIR}/deploy-in-progress"
readonly PREVIOUS_IMAGE_FILE="${STATE_DIR}/previous-image.txt"
readonly RUNNING_VERSION_FILE="${STATE_DIR}/running-version.json"
readonly CONTAINER_NAME="gwi-pos"

readonly LOCK_TIMEOUT=300  # 5 minutes
readonly HEALTH_MAX_ATTEMPTS=30
readonly HEALTH_INTERVAL=2
readonly HEALTH_CONSECUTIVE_REQUIRED=3

# Read port from .env or default
POS_PORT=3005
if [[ -f "$ENV_FILE" ]]; then
  POS_PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '[:space:]' || echo 3005)"
  [[ -z "$POS_PORT" ]] && POS_PORT=3005
fi
readonly HEALTH_URL="http://localhost:${POS_PORT}/api/health/ready"

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
DEPLOY_ID="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
DEPLOY_START_EPOCH="$(date +%s)"
IMAGE_REF=""
IMAGE_DIGEST=""
MANIFEST_URL=""
FORCE=false
ROLLBACK=false
FINAL_STATUS="pending"
ERRORS=()
LOCK_FD=""
current_image=""  # filled later, used in deploy log

# ---------------------------------------------------------------------------
# Logging helpers
# ---------------------------------------------------------------------------
log()  { echo "[docker-deploy] $(date -u +%FT%TZ) $*"; }
err()  { echo "[docker-deploy] $(date -u +%FT%TZ) ERROR: $*" >&2; ERRORS+=("$*"); }

# ---------------------------------------------------------------------------
# Write structured deploy log JSON (compatible with deploy-release.sh format)
# ---------------------------------------------------------------------------
write_deploy_log() {
  mkdir -p "$DEPLOY_LOG_DIR"
  local now duration_ms hostname_val errors_json
  now="$(date -u +%FT%TZ)"
  duration_ms=$(( ($(date +%s) - DEPLOY_START_EPOCH) * 1000 ))
  hostname_val="$(hostname 2>/dev/null || echo "unknown")"

  errors_json="[]"
  if [[ ${#ERRORS[@]} -gt 0 ]]; then
    errors_json="$(printf '%s\n' "${ERRORS[@]}" | jq -R . 2>/dev/null | jq -s . 2>/dev/null || echo "[]")"
  fi

  local log_file="${DEPLOY_LOG_DIR}/${now//[:.]/-}.json"
  cat > "$log_file" <<DEOF
{
  "deployId": "${DEPLOY_ID}",
  "timestamp": "${now}",
  "hostname": "${hostname_val}",
  "imageRef": "${IMAGE_REF}",
  "imageDigest": "${IMAGE_DIGEST:-}",
  "previousImage": "${current_image:-}",
  "manifestUrl": "${MANIFEST_URL:-}",
  "finalStatus": "${FINAL_STATUS}",
  "durationMs": ${duration_ms},
  "errors": ${errors_json},
  "deployMethod": "docker"
}
DEOF
  chmod 644 "$log_file" 2>/dev/null || true
  log "Deploy log written: $log_file"
}

die() { err "$*"; FINAL_STATUS="failed"; write_deploy_log; exit 1; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --image-ref)     IMAGE_REF="$2"; shift 2 ;;
    --image-digest)  IMAGE_DIGEST="$2"; shift 2 ;;
    --manifest-url)  MANIFEST_URL="$2"; shift 2 ;;
    --force)         FORCE=true; shift ;;
    --rollback)      ROLLBACK=true; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve image reference
# ---------------------------------------------------------------------------

# Option 1: Fetch from release manifest
if [[ -n "$MANIFEST_URL" ]] && [[ -z "$IMAGE_REF" ]]; then
  log "Fetching release manifest from $MANIFEST_URL"
  manifest_json="$(curl -fsSL --max-time 30 "$MANIFEST_URL")" || die "Failed to fetch manifest"
  IMAGE_REF="$(echo "$manifest_json" | jq -r '.imageRef // empty')"
  [[ -z "$IMAGE_REF" ]] && die "Manifest missing imageRef"
  if [[ -z "$IMAGE_DIGEST" ]]; then
    IMAGE_DIGEST="$(echo "$manifest_json" | jq -r '.imageDigest // empty')" || true
  fi
  log "Manifest resolved: image=$IMAGE_REF digest=${IMAGE_DIGEST:-none}"
fi

# Option 2: Rollback to previous image
if [[ "$ROLLBACK" == true ]]; then
  [[ -f "$PREVIOUS_IMAGE_FILE" ]] || die "No previous image to roll back to"
  IMAGE_REF="$(cat "$PREVIOUS_IMAGE_FILE")"
  log "Rolling back to previous image: $IMAGE_REF"
fi

[[ -n "$IMAGE_REF" ]] || die "Must provide --image-ref, --manifest-url, or --rollback"

# ---------------------------------------------------------------------------
# Lock (flock with 5-minute timeout)
# ---------------------------------------------------------------------------
mkdir -p "$STATE_DIR" "$DEPLOY_LOG_DIR"
exec {LOCK_FD}>"$LOCKFILE"
flock -w "$LOCK_TIMEOUT" "$LOCK_FD" || die "Could not acquire deploy lock (another deploy running?)"

cleanup() {
  local exit_code=$?
  rm -f "$MAINTENANCE_FLAG"
  [[ -n "${LOCK_FD:-}" ]] && flock -u "$LOCK_FD" 2>/dev/null || true
  if [[ $exit_code -ne 0 ]] && [[ "$FINAL_STATUS" == "pending" ]]; then
    FINAL_STATUS="failed"
    write_deploy_log 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ===========================================================================
# Deploy pipeline
# ===========================================================================
log "Deploy $DEPLOY_ID starting: $IMAGE_REF"

# Save current image as rollback target
current_image="$(docker inspect --format='{{.Config.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
[[ -n "$current_image" ]] && echo "$current_image" > "$PREVIOUS_IMAGE_FILE"

# Step 1: Maintenance mode
touch "$MAINTENANCE_FLAG"
log "Maintenance mode enabled"

# Step 2: Pull image
log "Pulling image: $IMAGE_REF"
docker pull "$IMAGE_REF" || die "Failed to pull image: $IMAGE_REF"

# Step 3: Verify digest (if provided)
if [[ -n "$IMAGE_DIGEST" ]]; then
  actual_digest="$(docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE_REF" 2>/dev/null \
    | grep -oP 'sha256:[a-f0-9]+' || true)"
  expected_digest="$(echo "$IMAGE_DIGEST" | grep -oP 'sha256:[a-f0-9]+')"
  if [[ "$actual_digest" != "$expected_digest" ]]; then
    [[ "$FORCE" == true ]] \
      && log "WARN: Digest mismatch (forced): expected=$expected_digest actual=$actual_digest" \
      || die "Digest mismatch: expected=$expected_digest actual=$actual_digest"
  fi
  log "Digest verified: $actual_digest"
fi

# Step 4: Run schema migration (ephemeral container)
log "Running schema migration..."
docker run --rm --env-file "$ENV_FILE" --network=host "$IMAGE_REF" \
  node deploy-tools/migrate.js || die "Schema migration failed"
log "Schema migration complete"

# Step 5: Stop old container
log "Stopping old container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# Step 6: Start new container
log "Starting new container: $IMAGE_REF"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart=unless-stopped \
  --env-file "$ENV_FILE" \
  --network=host \
  -v "${SHARED_DIR}:${SHARED_DIR}" \
  "$IMAGE_REF" || die "Failed to start container"

# Step 7: Health check (30 attempts x 2s, need 3 consecutive OK)
log "Waiting for health check..."
consecutive_ok=0
for attempt in $(seq 1 "$HEALTH_MAX_ATTEMPTS"); do
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")"
  if [[ "$http_code" == "200" ]]; then
    consecutive_ok=$((consecutive_ok + 1))
    log "Health OK ($consecutive_ok/$HEALTH_CONSECUTIVE_REQUIRED) [attempt $attempt/$HEALTH_MAX_ATTEMPTS]"
    [[ $consecutive_ok -ge $HEALTH_CONSECUTIVE_REQUIRED ]] && break
  else
    consecutive_ok=0
    log "Health not ready (HTTP $http_code) [attempt $attempt/$HEALTH_MAX_ATTEMPTS]"
  fi
  sleep "$HEALTH_INTERVAL"
done

# Step 8: On health failure — automatic rollback
if [[ $consecutive_ok -lt $HEALTH_CONSECUTIVE_REQUIRED ]]; then
  err "Health check failed after $HEALTH_MAX_ATTEMPTS attempts"
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true

  if [[ -f "$PREVIOUS_IMAGE_FILE" ]] && [[ "$ROLLBACK" != true ]]; then
    prev_image="$(cat "$PREVIOUS_IMAGE_FILE")"
    log "Auto-rolling back to: $prev_image"
    docker run -d \
      --name "$CONTAINER_NAME" \
      --restart=unless-stopped \
      --env-file "$ENV_FILE" \
      --network=host \
      -v "${SHARED_DIR}:${SHARED_DIR}" \
      "$prev_image" || { FINAL_STATUS="rollback_failed"; write_deploy_log; exit 1; }
    FINAL_STATUS="rollback_success"
  else
    FINAL_STATUS="rollback_failed"
  fi

  rm -f "$MAINTENANCE_FLAG"
  write_deploy_log
  exit 1
fi

# ===========================================================================
# Success
# ===========================================================================

# Step 9: Clear maintenance mode
rm -f "$MAINTENANCE_FLAG"
log "Maintenance mode cleared"

# Step 10: Write running-version.json
image_tag="${IMAGE_REF##*:}"
cat > "$RUNNING_VERSION_FILE" <<EOF
{
  "version": "${image_tag}",
  "imageRef": "${IMAGE_REF}",
  "imageDigest": "${IMAGE_DIGEST:-unknown}",
  "deployedAt": "$(date -u +%FT%TZ)",
  "deployId": "${DEPLOY_ID}",
  "deployMethod": "docker"
}
EOF
chmod 644 "$RUNNING_VERSION_FILE" 2>/dev/null || true
log "Version truth written: $IMAGE_REF"

# Step 11: Prune old images (keep last 3 tags for this repo)
log "Pruning old images..."
repo="${IMAGE_REF%%:*}"
docker images --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' \
  | grep "^${repo}:" \
  | sort -k2 -r \
  | tail -n +4 \
  | awk '{print $1}' \
  | xargs -r docker rmi 2>/dev/null || true

# Step 12: Write deploy log
FINAL_STATUS="success"
write_deploy_log
log "Deploy $DEPLOY_ID complete: $IMAGE_REF"
