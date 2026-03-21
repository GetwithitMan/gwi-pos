#!/usr/bin/env bash
# =============================================================================
# 05-deploy-app.sh — Git clone/pull, npm install, prisma generate, build
# =============================================================================
# Entry: run_deploy_app
# Expects: STATION_ROLE, APP_BASE, APP_DIR, ENV_FILE, KEY_DIR, POSUSER,
#          GIT_REPO, DEPLOY_TOKEN
# =============================================================================

run_deploy_app() {
  local _start=$(date +%s)
  log "Stage: deploy_app — starting"

  # Only server + backup roles need the app
  if [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: deploy_app — skipped (terminal role)"
    return 0
  fi

  header "Installing POS Application"

  # Disk space check — build requires ~5 GB temp space, 10 GB gives margin
  AVAIL_KB=$(df -k "$APP_BASE" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  if [[ "$AVAIL_KB" -lt 5000000 ]]; then
    err "Insufficient disk space: $(( AVAIL_KB / 1024 )) MB free in $APP_BASE (need ~5 GB)"
    err "Free up space and re-run the installer."
    return 1
  fi

  # Set up git credential store so deploy token stays out of remote URL
  CRED_FILE="$APP_BASE/.git-credentials"
  if [[ -n "${DEPLOY_TOKEN:-}" ]] && [[ "${DEPLOY_TOKEN:-}" != "null" ]]; then
    log "Configuring deploy token via git credential store."
    echo "https://${DEPLOY_TOKEN}:x-oauth-basic@github.com" > "$CRED_FILE"
    chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"
  else
    log "No deploy token — using public repo URL."
  fi

  # Clone or update (remote URL is always clean — no token embedded)
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Updating existing app code..."
    if ! sudo -u "$POSUSER" bash -c "
      cd '$APP_DIR'
      git config credential.helper 'store --file=$CRED_FILE'
      git remote set-url origin '$GIT_REPO' 2>/dev/null || true
      git fetch --all && git reset --hard origin/main
      git clean -fd
    "; then
      err "Failed to update app code from git."
      err "Check network connectivity and deploy token validity."
      return 1
    fi
  else
    log "Cloning app from repository..."
    mkdir -p "$APP_DIR"
    chown -R "$POSUSER":"$POSUSER" "$APP_BASE"
    # Re-lock sensitive files after bulk chown (root-owned, not app-user-owned)
    [[ -f "$ENV_FILE" ]] && chown root:"$POSUSER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
    [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
    [[ -f "$CRED_FILE" ]] && chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"
    if ! sudo -u "$POSUSER" bash -c "
      git config --global credential.helper 'store --file=$CRED_FILE'
      git clone '$GIT_REPO' '$APP_DIR'
      cd '$APP_DIR'
      git config credential.helper 'store --file=$CRED_FILE'
    "; then
      err "Failed to clone app repository."
      err "Check: network connectivity, deploy token, repo access."
      return 1
    fi
    # Remove global credential helper (keep it repo-local only)
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
  fi

  log "App code ready at $APP_DIR"

  # Symlink env files into app directory — ensures app always reads canonical /opt/gwi-pos/.env.
  # Symlinks survive .env updates from fleet commands, re-registration, and manual edits
  # without requiring a full deploy cycle.
  rm -f "$APP_DIR/.env" "$APP_DIR/.env.local"
  ln -sf "$ENV_FILE" "$APP_DIR/.env"
  ln -sf "$ENV_FILE" "$APP_DIR/.env.local"
  chown -h "$POSUSER":"$POSUSER" "$APP_DIR/.env" "$APP_DIR/.env.local"

  # Verify symlinks were created correctly (catches silent rm/ln failures from permission errors)
  for _ef in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    if [[ ! -L "$_ef" ]]; then
      err "FATAL: Failed to create symlink at $_ef"
      err "  This usually means a permission issue prevented rm -f or ln -sf from succeeding."
      err "  Check ownership of $APP_DIR and ensure $POSUSER has write access."
      return 1
    fi
  done

  # Build the application (each step checked explicitly)
  # Clean stale build artifacts first (prevents mixed old+new state)
  rm -rf "$APP_DIR/.next" 2>/dev/null || true

  log "Installing npm dependencies..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm ci --production=false"; then
    err "npm install failed. Check Node.js version and network."
    return 1
  fi

  log "Generating Prisma client..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npx prisma generate"; then
    err "Prisma generate failed. Check schema.prisma for errors."
    return 1
  fi

  log "Stage: deploy_app — completed in $(( $(date +%s) - _start ))s"
  return 0
}
