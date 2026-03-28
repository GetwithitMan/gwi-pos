#!/usr/bin/env bash
# GWI POS Rolling Restart — Thin wrapper around deploy-release.sh
# Kept for backward compatibility. All heavy lifting is in deploy-release.sh.
#
# Usage:
#   rolling-restart.sh [target-version]                    # artifact-based deploy (default)
#   rolling-restart.sh [target-version] --legacy           # old git-based build-on-NUC flow
set -euo pipefail

# ---------------------------------------------------------------------------
# Backward-compat variables (referenced by other scripts / monitoring)
# ---------------------------------------------------------------------------
APP_DIR="/opt/gwi-pos/app"
ENV_FILE="/opt/gwi-pos/.env"
POS_PORT="${POS_PORT:-3005}"

DEPLOY_RELEASE="/opt/gwi-pos/deploy-release.sh"
MANIFEST_URL="https://ordercontrolcenter.com/artifacts/manifest.json"
STATE_DIR="/opt/gwi-pos/shared/state"
MAINTENANCE_FLAG="${STATE_DIR}/deploy-in-progress"
RESULT_FILE="/opt/gwi-pos/state/last-rolling-restart.json"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() { echo "[$(date -u +%FT%TZ)] ROLLING-RESTART: $*"; }
err() { echo "[$(date -u +%FT%TZ)] ROLLING-RESTART ERROR: $*" >&2; }

# Load error codes if available
[[ -f /opt/gwi-pos/installer-modules/lib/error-codes.sh ]] && source /opt/gwi-pos/installer-modules/lib/error-codes.sh

# ---------------------------------------------------------------------------
# Record result to state file (same location as before)
# ---------------------------------------------------------------------------
record_result() {
  local version="$1" status="$2" method="$3"
  mkdir -p "$(dirname "$RESULT_FILE")"
  cat > "$RESULT_FILE" <<RRJSON
{
  "version": "$version",
  "completedAt": "$(date -u +%FT%TZ)",
  "status": "$status",
  "method": "$method"
}
RRJSON
}

# ---------------------------------------------------------------------------
# Legacy git-based flow (original rolling-restart logic)
# ---------------------------------------------------------------------------
legacy_flow() {
  local target_version="$1"
  local STAGING_DIR="/opt/gwi-pos/app-staging"

  cleanup_staging() { rm -rf "$STAGING_DIR" 2>/dev/null || true; }

  wait_for_health() {
    local max_attempts="${1:-30}" attempt=0
    while [[ $attempt -lt $max_attempts ]]; do
      local status
      status=$(curl -sf --connect-timeout 3 --max-time 5 \
        "http://localhost:${POS_PORT}/api/health" 2>/dev/null \
        | jq -r '.status // empty' 2>/dev/null) || true
      if [[ "$status" == "healthy" || "$status" == "degraded" ]]; then return 0; fi
      attempt=$((attempt + 1)); sleep 2
    done
    return 1
  }

  log "Phase 1: Preparing staging build..."
  cleanup_staging
  cp -a "$APP_DIR" "$STAGING_DIR"
  cd "$STAGING_DIR"
  git fetch origin 2>/dev/null || true
  git checkout "$target_version" 2>/dev/null || git reset --hard "origin/$target_version" 2>/dev/null || {
    err "Failed to checkout $target_version"; cleanup_staging; exit 1
  }
  ln -sf "$ENV_FILE" "$STAGING_DIR/.env" 2>/dev/null || true

  log "Phase 2: Building in staging (current app still serving)..."
  rm -f tsconfig.tsbuildinfo 2>/dev/null || true
  npm ci --production=false 2>&1 | tail -5 || { err "npm ci failed"; cleanup_staging; exit 1; }
  npx prisma generate 2>&1 | tail -3 || { err "Prisma generate failed"; cleanup_staging; exit 1; }
  [[ -f scripts/nuc-pre-migrate.js ]] && { node scripts/nuc-pre-migrate.js 2>&1 || { err "Migration failed"; cleanup_staging; exit 1; }; }
  SKIP_TYPECHECK=1 NODE_OPTIONS="--max-old-space-size=4096" npm run build 2>&1 | tail -10 || { err "Build failed"; cleanup_staging; exit 1; }

  if [[ -f "$STAGING_DIR/public/installer.run" ]]; then
    cp "$STAGING_DIR/public/installer.run" /opt/gwi-pos/installer.run 2>/dev/null || true
    rm -rf /opt/gwi-pos/installer-modules 2>/dev/null || true
    cp -r "$STAGING_DIR/public/installer-modules" /opt/gwi-pos/installer-modules 2>/dev/null || true
    log "Synced installer + modules from build"
  fi

  log "Phase 3: Swapping to new version..."
  local old_dir="/opt/gwi-pos/app-previous"
  rm -rf "$old_dir" 2>/dev/null || true
  mv "$APP_DIR" "$old_dir"
  mv "$STAGING_DIR" "$APP_DIR"
  ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true

  log "Phase 4: Graceful restart..."
  systemctl restart thepasspos 2>/dev/null || {
    err "Restart failed — rolling back"
    rm -rf "$APP_DIR"; mv "$old_dir" "$APP_DIR"
    systemctl restart thepasspos 2>/dev/null || true; exit 1
  }

  log "Phase 5: Waiting for health check..."
  if wait_for_health 30; then
    log "SUCCESS — new version is healthy"
    (sleep 3600 && rm -rf "$old_dir" 2>/dev/null) & disown
  else
    err "Health check failed — rolling back"
    systemctl stop thepasspos 2>/dev/null || true
    rm -rf "$APP_DIR"; mv "$old_dir" "$APP_DIR"
    ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
    systemctl restart thepasspos 2>/dev/null || true
    if wait_for_health 15; then log "Rollback successful"; else err "CRITICAL: Rollback also failed"; fi
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local target_version="" legacy=false
  for arg in "$@"; do
    case "$arg" in
      --legacy) legacy=true ;;
      *)        target_version="$arg" ;;
    esac
  done

  if [[ -z "$target_version" ]]; then
    err "Usage: rolling-restart.sh <target-version> [--legacy]"
    exit 1
  fi

  # Check for deploy already in progress
  if [[ -f "$MAINTENANCE_FLAG" ]]; then
    err "Deploy already in progress (since $(cat "$MAINTENANCE_FLAG" 2>/dev/null || echo "unknown")). Aborting."
    record_result "$target_version" "ABORTED" "deploy-in-progress"
    exit 1
  fi

  log "Starting rolling restart to version: $target_version"

  if [[ "$legacy" == true ]]; then
    log "Using legacy git-based flow (--legacy)"
    legacy_flow "$target_version"
    record_result "$target_version" "COMPLETED" "legacy-rolling-restart"
  else
    # Delegate to deploy-release.sh
    if [[ ! -x "$DEPLOY_RELEASE" ]]; then
      err "deploy-release.sh not found at $DEPLOY_RELEASE — falling back to --legacy"
      legacy_flow "$target_version"
      record_result "$target_version" "COMPLETED" "legacy-rolling-restart-fallback"
    else
      log "Delegating to deploy-release.sh --manifest-url $MANIFEST_URL"
      "$DEPLOY_RELEASE" --manifest-url "$MANIFEST_URL" || {
        local rc=$?
        err "deploy-release.sh exited with code $rc"
        record_result "$target_version" "FAILED" "deploy-release"
        exit $rc
      }
      record_result "$target_version" "COMPLETED" "deploy-release"
    fi
  fi

  log "Rolling restart complete"
}

main "$@"
