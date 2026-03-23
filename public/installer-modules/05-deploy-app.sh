#!/usr/bin/env bash
# =============================================================================
# 05-deploy-app.sh — Git clone/pull, npm install, prisma generate, build
# =============================================================================
# Entry: run_deploy_app
# Expects: STATION_ROLE, APP_BASE, APP_DIR, ENV_FILE, KEY_DIR, POSUSER,
#          GIT_REPO, DEPLOY_TOKEN
# =============================================================================

# _git_repair — Clean up stale state that prevents git operations from succeeding.
# Fixes: lock files from interrupted ops, merge/rebase state, ownership mismatches.
_git_repair() {
  local dir="$1"

  # Safety: refuse to operate on empty, root-like, or unexpected paths
  if [[ -z "$dir" ]] || [[ "$dir" == "/" ]] || [[ ! "$dir" == /opt/gwi-pos/* ]]; then
    log "  ERROR: _git_repair refused to operate on path: '$dir'"
    return 1
  fi

  [[ -d "$dir/.git" ]] || return 0

  log "  Running git self-repair on $dir..."

  # 1. Remove stale lock files (left by interrupted fetch/reset/merge)
  local locks=(
    "$dir/.git/index.lock"
    "$dir/.git/refs/remotes/origin/main.lock"
    "$dir/.git/HEAD.lock"
    "$dir/.git/config.lock"
    "$dir/.git/shallow.lock"
    "$dir/.git/refs/heads/main.lock"
  )
  for lf in "${locks[@]}"; do
    if [[ -f "$lf" ]]; then
      log "  Removing stale lock: $lf"
      rm -f "$lf"
    fi
  done

  # 2. Abort interrupted merge/rebase/cherry-pick state
  if [[ -f "$dir/.git/MERGE_HEAD" ]]; then
    log "  Aborting interrupted merge"
    sudo -u "$POSUSER" bash -c "cd '$dir' && git merge --abort" 2>/dev/null || true
  fi
  if [[ -d "$dir/.git/rebase-merge" ]] || [[ -d "$dir/.git/rebase-apply" ]]; then
    log "  Aborting interrupted rebase"
    sudo -u "$POSUSER" bash -c "cd '$dir' && git rebase --abort" 2>/dev/null || true
  fi
  if [[ -f "$dir/.git/CHERRY_PICK_HEAD" ]]; then
    log "  Aborting interrupted cherry-pick"
    sudo -u "$POSUSER" bash -c "cd '$dir' && git cherry-pick --abort" 2>/dev/null || true
  fi

  # 3. Fix ownership — previous sudo/root operations may have left files root-owned,
  #    causing git (running as POSUSER) to fail with "Permission denied"
  log "  Fixing file ownership for $POSUSER..."
  chown -R "$POSUSER":"$POSUSER" "$dir" 2>/dev/null || true
  # Re-lock sensitive files that must stay root-owned
  [[ -f "$ENV_FILE" ]] && chown root:"$POSUSER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
  [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
  local _cred="$APP_BASE/.git-credentials"
  [[ -f "$_cred" ]] && chown root:"$POSUSER" "$_cred" && chmod 640 "$_cred"

  log "  Git self-repair complete."
}

# _git_validate_credentials — Test that git can authenticate before attempting clone/pull.
# Returns 0 if credentials work, 1 if not.
_git_validate_credentials() {
  local cred_file="$1"
  local repo="$2"

  if [[ ! -f "$cred_file" ]]; then
    log "  WARNING: Credentials file missing at $cred_file"
    return 1
  fi

  log "  Validating git credentials..."
  if sudo -u "$POSUSER" bash -c "
    git config --global credential.helper 'store --file=$cred_file'
    git ls-remote --exit-code '$repo' HEAD >/dev/null 2>&1
  "; then
    log "  Credentials valid."
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
    return 0
  else
    log "  WARNING: Credentials failed — git ls-remote returned non-zero."
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
    return 1
  fi
}

# _git_with_retry — Run a git command with retry logic for transient network failures.
# Usage: _git_with_retry <max_attempts> <delay_seconds> <command...>
_git_with_retry() {
  local max_attempts="$1"; shift
  local delay="$1"; shift
  local attempt=1

  while [[ $attempt -le $max_attempts ]]; do
    if eval "$@"; then
      return 0
    fi
    if [[ $attempt -lt $max_attempts ]]; then
      log "  Git operation failed (attempt $attempt/$max_attempts). Retrying in ${delay}s..."
      sleep "$delay"
    fi
    attempt=$(( attempt + 1 ))
  done

  return 1
}

run_deploy_app() {
  local _start=$(date +%s)
  log "Stage: deploy_app — starting"

  # Load error codes library
  source "$(dirname "${BASH_SOURCE[0]}")/lib/error-codes.sh" 2>/dev/null || true

  # Only server + backup roles need the app
  if [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: deploy_app — skipped (terminal role)"
    return 0
  fi

  header "Installing POS Application"

  # ── Offline install mode — app already deployed by offline installer ──
  if [[ "${SKIP_GIT_CLONE:-}" == "1" ]]; then
    log "Offline mode: Skipping git clone (app pre-deployed)"
    if [[ "${SKIP_NPM_INSTALL:-}" == "1" ]]; then
      log "Offline mode: Skipping npm install (dependencies pre-bundled)"
    fi
    if [[ "${SKIP_BUILD:-}" == "1" ]]; then
      log "Offline mode: Skipping build (pre-built)"
    fi
    # Just ensure symlinks and prisma client
    ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
    ln -sf "$ENV_FILE" "$APP_DIR/.env.local" 2>/dev/null || true
    if [[ "${SKIP_NPM_INSTALL:-}" == "1" ]] && [[ "${SKIP_BUILD:-}" == "1" ]]; then
      log "Offline deploy stage complete"
      log "Stage: deploy_app — completed in $(( $(date +%s) - _start ))s"
      return 0
    fi
    # Partial offline — still need some steps, fall through to normal flow
  fi

  # Disk space check — build requires ~5 GB temp space
  AVAIL_KB=$(df -k "$APP_BASE" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  if [[ "$AVAIL_KB" -lt 5000000 ]]; then
    err_code "ERR-INST-003" "$(( AVAIL_KB / 1024 ))MB free in $APP_BASE, need 5GB for build"
    err "Insufficient disk space: $(( AVAIL_KB / 1024 )) MB free in $APP_BASE (need ~5 GB)"
    err "Free up space and re-run the installer."
    return 1
  fi

  # ── Credential setup ────────────────────────────────────────────────────
  CRED_FILE="$APP_BASE/.git-credentials"
  if [[ -n "${DEPLOY_TOKEN:-}" ]] && [[ "${DEPLOY_TOKEN:-}" != "null" ]]; then
    log "Configuring deploy token via git credential store."
    echo "https://${DEPLOY_TOKEN}:x-oauth-basic@github.com" > "$CRED_FILE"
    chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"
  elif [[ -f "$CRED_FILE" ]]; then
    log "No new deploy token — reusing existing credentials file."
  else
    err "WARNING: No deploy token available and no existing credentials file."
    err "  Git clone/pull will likely fail. Ensure MC registration provides a deploy token."
    track_warn "No git credentials available — deploy may fail"
  fi

  # Validate credentials before attempting git operations
  if [[ -f "$CRED_FILE" ]]; then
    if ! _git_validate_credentials "$CRED_FILE" "$GIT_REPO"; then
      err_code "ERR-INST-152" "git ls-remote failed for $GIT_REPO"
      err "WARNING: Git credentials validation failed."
      err "  The deploy token may be expired or revoked."
      err "  Re-register this NUC from Mission Control to get a fresh token."
      track_warn "Git credentials invalid — token may be expired"
    fi
  fi

  # ── Clone or update ─────────────────────────────────────────────────────
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Updating existing app code..."

    # Self-repair: fix ownership, locks, merge state BEFORE git operations
    _git_repair "$APP_DIR"

    if ! _git_with_retry 3 5 "sudo -u '$POSUSER' bash -c \"
      cd '$APP_DIR'
      git config credential.helper 'store --file=$CRED_FILE'
      git remote set-url origin '$GIT_REPO' 2>/dev/null || true
      git fetch --all --prune
    \""; then
      err_code "ERR-INST-151" "git fetch failed after 3 attempts for $GIT_REPO"
      err "Failed to fetch from git after 3 attempts."
      err "  Check: network connectivity, deploy token, firewall rules."
      err "  If this persists, re-register the NUC to get a fresh deploy token."
      return 1
    fi

    # Reset to remote HEAD (separate from fetch so we get clear error attribution)
    if ! sudo -u "$POSUSER" bash -c "
      cd '$APP_DIR'
      git reset --hard origin/main
      git clean -fd
    "; then
      err_code "ERR-INST-155" "git reset --hard failed in $APP_DIR"
      err "Git reset failed. Attempting nuclear recovery..."
      # Nuclear option: blow away the checkout and re-clone
      # Safety: validate path before rm -rf
      if [[ -n "$APP_DIR" ]] && [[ "$APP_DIR" == /opt/gwi-pos/* ]] && [[ ${#APP_DIR} -gt 15 ]]; then
        log "  Removing corrupted git state at $APP_DIR and re-cloning..."
        rm -rf "$APP_DIR"
      else
        err_code "ERR-INST-155" "Refusing to rm -rf suspicious path: '$APP_DIR'"
        err "FATAL: Refusing to rm -rf suspicious path: '$APP_DIR'"
        return 1
      fi
      # Fall through to the clone path below
    fi
  fi

  # Clone path (either fresh install or nuclear recovery from failed reset)
  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Cloning app from repository..."
    mkdir -p "$(dirname "$APP_DIR")"
    chown -R "$POSUSER":"$POSUSER" "$APP_BASE"
    # Re-lock sensitive files after bulk chown
    [[ -f "$ENV_FILE" ]] && chown root:"$POSUSER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
    [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
    [[ -f "$CRED_FILE" ]] && chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"

    if ! _git_with_retry 3 10 "sudo -u '$POSUSER' bash -c \"
      git config --global credential.helper 'store --file=$CRED_FILE'
      git clone --depth 1 '$GIT_REPO' '$APP_DIR'
      cd '$APP_DIR'
      git config credential.helper 'store --file=$CRED_FILE'
    \""; then
      err_code "ERR-INST-150" "git clone failed after 3 attempts to $GIT_REPO"
      err "Failed to clone app repository after 3 attempts."
      err "  Check: network connectivity, deploy token, repo access."
      err "  Try: curl -sI https://github.com (should return 200)"
      return 1
    fi
    # Remove global credential helper (keep it repo-local only)
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
  fi

  log "App code ready at $APP_DIR"

  # ── Env symlinks ────────────────────────────────────────────────────────
  rm -f "$APP_DIR/.env" "$APP_DIR/.env.local"
  ln -sf "$ENV_FILE" "$APP_DIR/.env"
  ln -sf "$ENV_FILE" "$APP_DIR/.env.local"
  chown -h "$POSUSER":"$POSUSER" "$APP_DIR/.env" "$APP_DIR/.env.local"

  for _ef in "$APP_DIR/.env" "$APP_DIR/.env.local"; do
    if [[ ! -L "$_ef" ]]; then
      err_code "ERR-INST-150" "Failed to create symlink at $_ef"
      err "FATAL: Failed to create symlink at $_ef"
      err "  This usually means a permission issue prevented rm -f or ln -sf from succeeding."
      err "  Check ownership of $APP_DIR and ensure $POSUSER has write access."
      return 1
    fi
  done

  # ── Build ───────────────────────────────────────────────────────────────
  rm -rf "$APP_DIR/.next" 2>/dev/null || true

  log "Installing npm dependencies..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm ci --production=false"; then
    err "npm install failed. Attempting cache clean + retry..."
    sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm cache clean --force" 2>/dev/null || true
    if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && rm -rf node_modules && npm ci --production=false"; then
      err_code "ERR-INST-153" "npm ci failed after retry in $APP_DIR"
      err "npm install failed after retry. Check Node.js version and network."
      return 1
    fi
  fi

  log "Generating Prisma client..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npx prisma generate"; then
    err_code "ERR-INST-154" "npx prisma generate failed in $APP_DIR"
    err "Prisma generate failed. Check schema.prisma for errors."
    return 1
  fi

  # ── Refresh installer modules from git checkout ──────────────────────────
  # The git checkout has the LATEST modules. The installer.run we're running
  # from may be stale (downloaded before the git pull). Switch to using the
  # checkout's modules so stages 06-12 use the latest code.
  _refresh_modules_from_checkout() {
    local checkout_modules="${APP_DIR}/public/installer-modules"
    local checkout_scripts="${APP_DIR}/public/scripts"
    local checkout_watchdog="${APP_DIR}/public/watchdog.sh"

    if [[ ! -d "$checkout_modules" ]]; then
      warn "No installer modules found in checkout at $checkout_modules — skipping refresh"
      return 0
    fi

    local checkout_version=""
    if [[ -f "${APP_DIR}/package.json" ]]; then
      checkout_version=$(node -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || true)
    fi

    log "Refreshing installer modules from git checkout (v${checkout_version:-unknown})..."

    # Copy updated modules to the running installer's module dir
    # This ensures stages 06-12 use the LATEST code
    if [[ -d "$MODULES_DIR" ]]; then
      cp -a "$checkout_modules"/* "$MODULES_DIR/" 2>/dev/null || true
      chmod +x "$MODULES_DIR"/*.sh 2>/dev/null || true
      [[ -d "$MODULES_DIR/lib" ]] && chmod +x "$MODULES_DIR"/lib/*.sh 2>/dev/null || true
      log "  Updated installer modules from checkout"

      # Re-source all modules so the running installer picks up new function definitions
      for _mod in "$MODULES_DIR"/*.sh; do
        if [[ -f "$_mod" ]]; then
          source "$_mod"
        fi
      done
      log "  Re-sourced updated module definitions"
    fi

    # Deploy operational scripts to /opt/gwi-pos for service use
    mkdir -p /opt/gwi-pos/scripts /opt/gwi-pos/installer-modules/lib 2>/dev/null || true

    # Watchdog
    if [[ -f "$checkout_watchdog" ]]; then
      cp "$checkout_watchdog" /opt/gwi-pos/watchdog.sh
      chmod +x /opt/gwi-pos/watchdog.sh
      log "  Deployed watchdog.sh"
    fi
    [[ -f "${APP_DIR}/public/watchdog.service" ]] && cp "${APP_DIR}/public/watchdog.service" /opt/gwi-pos/ && log "  Deployed watchdog.service"
    [[ -f "${APP_DIR}/public/watchdog.timer" ]] && cp "${APP_DIR}/public/watchdog.timer" /opt/gwi-pos/ && log "  Deployed watchdog.timer"

    # Monitoring scripts
    for script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh pre-update-backup.sh; do
      if [[ -f "$checkout_scripts/$script" ]]; then
        cp "$checkout_scripts/$script" /opt/gwi-pos/scripts/
        chmod +x "/opt/gwi-pos/scripts/$script"
        log "  Deployed scripts/$script"
      fi
    done

    # Shared libraries (error codes, etc.)
    if [[ -d "$checkout_modules/lib" ]]; then
      cp -a "$checkout_modules"/lib/*.sh /opt/gwi-pos/installer-modules/lib/ 2>/dev/null || true
      chmod +x /opt/gwi-pos/installer-modules/lib/*.sh 2>/dev/null || true
      log "  Deployed installer libraries"
    fi

    # Sync agent
    if [[ -f "${APP_DIR}/public/sync-agent.js" ]]; then
      cp "${APP_DIR}/public/sync-agent.js" /opt/gwi-pos/sync-agent.js
      log "  Deployed sync-agent.js"
    fi

    log "Module refresh complete — remaining stages will use latest code"
  }

  # Always refresh modules after successful deploy
  _refresh_modules_from_checkout

  log "Stage: deploy_app — completed in $(( $(date +%s) - _start ))s"
  return 0
}
