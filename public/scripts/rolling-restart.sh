#!/usr/bin/env bash
# GWI POS Rolling Restart — Zero-downtime update
# Builds new version alongside running app, then swaps and restarts
set -euo pipefail

APP_DIR="/opt/gwi-pos/app"
STAGING_DIR="/opt/gwi-pos/app-staging"
ACTIVE_LINK="/opt/gwi-pos/active"
ENV_FILE="/opt/gwi-pos/.env"
POS_PORT="${POS_PORT:-3005}"

log() { echo "[$(date -u +%FT%TZ)] ROLLING-RESTART: $*"; }
err() { echo "[$(date -u +%FT%TZ)] ROLLING-RESTART ERROR: $*" >&2; }

# Load error codes if available
[[ -f /opt/gwi-pos/installer-modules/lib/error-codes.sh ]] && source /opt/gwi-pos/installer-modules/lib/error-codes.sh

cleanup_staging() {
  rm -rf "$STAGING_DIR" 2>/dev/null || true
}

# Check if POS is currently healthy
wait_for_health() {
  local max_attempts="${1:-30}"
  local attempt=0
  while [[ $attempt -lt $max_attempts ]]; do
    local status
    status=$(curl -sf --connect-timeout 3 --max-time 5 "http://localhost:${POS_PORT}/api/health" 2>/dev/null | jq -r '.status // empty' 2>/dev/null) || true
    if [[ "$status" == "healthy" || "$status" == "degraded" ]]; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

main() {
  local target_version="${1:-}"

  if [[ -z "$target_version" ]]; then
    err "Usage: rolling-restart.sh <target-version-or-git-sha>"
    exit 1
  fi

  log "Starting rolling restart to version: $target_version"

  # Phase 1: Prepare staging directory
  log "Phase 1: Preparing staging build..."
  cleanup_staging

  # Copy current app to staging
  cp -a "$APP_DIR" "$STAGING_DIR"

  # Update staging to target version
  cd "$STAGING_DIR"
  git fetch origin 2>/dev/null || true
  git checkout "$target_version" 2>/dev/null || git reset --hard "origin/$target_version" 2>/dev/null || {
    err "Failed to checkout $target_version"
    cleanup_staging
    exit 1
  }

  # Symlink .env
  ln -sf "$ENV_FILE" "$STAGING_DIR/.env" 2>/dev/null || true

  # Install deps and build in staging (while current app still serves traffic)
  log "Phase 2: Building in staging (current app still serving)..."
  npm ci --production=false 2>&1 | tail -5 || {
    err "npm ci failed in staging"
    cleanup_staging
    exit 1
  }

  npx prisma generate 2>&1 | tail -3 || {
    err "Prisma generate failed in staging"
    cleanup_staging
    exit 1
  }

  # Run migrations before build
  if [[ -f scripts/nuc-pre-migrate.js ]]; then
    node scripts/nuc-pre-migrate.js 2>&1 || {
      err "Migration failed — aborting rolling restart"
      cleanup_staging
      exit 1
    }
  fi

  SKIP_TYPECHECK=1 NODE_OPTIONS="--max-old-space-size=4096" npm run build 2>&1 | tail -10 || {
    err "Build failed in staging"
    cleanup_staging
    exit 1
  }

  log "Phase 3: Swapping to new version..."

  # Atomic swap: rename current → .old, staging → current
  local old_dir="/opt/gwi-pos/app-previous"
  rm -rf "$old_dir" 2>/dev/null || true
  mv "$APP_DIR" "$old_dir"
  mv "$STAGING_DIR" "$APP_DIR"

  # Symlink .env into new app dir
  ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true

  # Phase 4: Graceful restart
  log "Phase 4: Graceful restart..."
  systemctl restart thepasspos 2>/dev/null || {
    err "Service restart failed — rolling back"
    rm -rf "$APP_DIR"
    mv "$old_dir" "$APP_DIR"
    systemctl restart thepasspos 2>/dev/null || true
    exit 1
  }

  # Phase 5: Health check
  log "Phase 5: Waiting for health check..."
  if wait_for_health 30; then
    log "SUCCESS — new version is healthy"
    # Clean up old version (keep for 1 hour in case manual rollback needed)
    (sleep 3600 && rm -rf "$old_dir" 2>/dev/null) &
    disown
  else
    err "Health check failed — rolling back"
    systemctl stop thepasspos 2>/dev/null || true
    rm -rf "$APP_DIR"
    mv "$old_dir" "$APP_DIR"
    ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
    systemctl restart thepasspos 2>/dev/null || true

    if wait_for_health 15; then
      log "Rollback successful — previous version restored"
    else
      err "CRITICAL: Rollback health check also failed"
    fi
    exit 1
  fi

  # Record result
  cat > "/opt/gwi-pos/state/last-rolling-restart.json" <<RRJSON
{
  "version": "$target_version",
  "completedAt": "$(date -u +%FT%TZ)",
  "status": "COMPLETED",
  "method": "rolling-restart"
}
RRJSON

  log "Rolling restart complete"
}

main "$@"
