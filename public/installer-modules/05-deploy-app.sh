#!/usr/bin/env bash
# =============================================================================
# 05-deploy-app.sh -- Artifact-based deployment (replaces git clone + npm ci)
# =============================================================================
# Entry: run_deploy_app
# Expects: STATION_ROLE, APP_BASE, APP_DIR, ENV_FILE, KEY_DIR, POSUSER,
#          GIT_REPO, DEPLOY_TOKEN
#
# Deploys a pre-built, self-contained artifact via deploy-release.sh.
# No git clone. No npm ci. No prisma generate. The artifact has everything.
#
# Legacy git+npm flow preserved behind LEGACY_DEPLOY=1 env var.
# =============================================================================

# ── Minisign public key (embedded) ─────────────────────────────────────────
if ! declare -p _GWI_MINISIGN_PUB &>/dev/null 2>&1; then
  readonly _GWI_MINISIGN_PUB='untrusted comment: minisign public key 6A8006EFB1B4BF0A
RWQKv7Sx7waAahboOQ+1oTmS1uU5fHebSLBqOoOBHpFa6MsLyFMqZdVl'
fi

# ── Legacy helpers (only loaded when LEGACY_DEPLOY=1) ──────────────────────
if [[ "${LEGACY_DEPLOY:-}" == "1" ]]; then

_git_repair() {
  local dir="$1"
  if [[ -z "$dir" ]] || [[ "$dir" == "/" ]] || [[ ! "$dir" == /opt/gwi-pos/* ]]; then
    log "  ERROR: _git_repair refused to operate on path: '$dir'"
    return 1
  fi
  [[ -d "$dir/.git" ]] || return 0
  log "  Running git self-repair on $dir..."
  local locks=(
    "$dir/.git/index.lock" "$dir/.git/refs/remotes/origin/main.lock"
    "$dir/.git/HEAD.lock" "$dir/.git/config.lock"
    "$dir/.git/shallow.lock" "$dir/.git/refs/heads/main.lock"
  )
  for lf in "${locks[@]}"; do
    [[ -f "$lf" ]] && log "  Removing stale lock: $lf" && rm -f "$lf"
  done
  [[ -f "$dir/.git/MERGE_HEAD" ]] && sudo -u "$POSUSER" bash -c "cd '$dir' && git merge --abort" 2>/dev/null || true
  if [[ -d "$dir/.git/rebase-merge" ]] || [[ -d "$dir/.git/rebase-apply" ]]; then
    sudo -u "$POSUSER" bash -c "cd '$dir' && git rebase --abort" 2>/dev/null || true
  fi
  [[ -f "$dir/.git/CHERRY_PICK_HEAD" ]] && sudo -u "$POSUSER" bash -c "cd '$dir' && git cherry-pick --abort" 2>/dev/null || true
  chown -R "$POSUSER":"$POSUSER" "$dir" 2>/dev/null || true
  [[ -f "$ENV_FILE" ]] && chown root:"$POSUSER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
  [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
  local _cred="$APP_BASE/.git-credentials"
  [[ -f "$_cred" ]] && chown root:"$POSUSER" "$_cred" && chmod 640 "$_cred"
  log "  Git self-repair complete."
}

_git_validate_credentials() {
  local cred_file="$1" repo="$2"
  [[ ! -f "$cred_file" ]] && log "  WARNING: Credentials file missing at $cred_file" && return 1
  log "  Validating git credentials..."
  if sudo -u "$POSUSER" bash -c "
    git config --global credential.helper 'store --file=$cred_file'
    git ls-remote --exit-code '$repo' HEAD >/dev/null 2>&1
  "; then
    log "  Credentials valid."
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
    return 0
  else
    log "  WARNING: Credentials failed."
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
    return 1
  fi
}

_git_with_retry() {
  local max_attempts="$1"; shift
  local delay="$1"; shift
  local attempt=1
  while [[ $attempt -le $max_attempts ]]; do
    if eval "$@"; then return 0; fi
    [[ $attempt -lt $max_attempts ]] && log "  Git failed (attempt $attempt/$max_attempts). Retrying in ${delay}s..." && sleep "$delay"
    attempt=$(( attempt + 1 ))
  done
  return 1
}

fi  # end LEGACY_DEPLOY guard

# ── Module refresh (shared by both paths) ──────────────────────────────────
_refresh_modules_from_checkout() {
  local checkout_modules="${APP_DIR}/public/installer-modules"
  local checkout_scripts="${APP_DIR}/public/scripts"
  local checkout_watchdog="${APP_DIR}/public/watchdog.sh"

  if [[ ! -d "$checkout_modules" ]]; then
    warn "IMPORTANT: No installer modules found in checkout at $checkout_modules"
    warn "Stages 06-12 will use embedded (potentially stale) modules"
    track_warn "Module refresh skipped -- checkout modules not found"
    return 0
  fi

  local checkout_version=""
  if [[ -f "${APP_DIR}/package.json" ]]; then
    checkout_version=$(node -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || true)
  fi

  log "Refreshing installer modules from deployed release (v${checkout_version:-unknown})..."

  if [[ -d "$MODULES_DIR" ]]; then
    cp -a "$checkout_modules"/* "$MODULES_DIR/" 2>/dev/null || true
    chmod +x "$MODULES_DIR"/*.sh 2>/dev/null || true
    [[ -d "$MODULES_DIR/lib" ]] && chmod +x "$MODULES_DIR"/lib/*.sh 2>/dev/null || true
    log "  Updated installer modules from release"

    for _mod in "$MODULES_DIR"/*.sh; do
      [[ -f "$_mod" ]] && source "$_mod"
    done
    log "  Re-sourced updated module definitions"

    if [[ -d "$MODULES_DIR/lib" ]]; then
      for _lib in "$MODULES_DIR"/lib/*.sh; do
        [[ -f "$_lib" ]] && source "$_lib"
      done
      log "  Re-sourced installer libraries"
    fi

    local _refresh_ok=true
    for _expected_mod in 06-schema 07-services 08-ha 09-remote-access 10-finalize 11-system-hardening 12-dashboard; do
      [[ ! -f "$MODULES_DIR/${_expected_mod}.sh" ]] && warn "Module $_expected_mod missing after refresh" && _refresh_ok=false
    done
    [[ "$_refresh_ok" == "true" ]] && log "  Module integrity validated (all stages 06-12 present)" \
      || { warn "  Module refresh incomplete -- some stages may use embedded (stale) code"; track_warn "Module refresh incomplete"; }
  fi

  # Deploy operational scripts
  mkdir -p /opt/gwi-pos/scripts /opt/gwi-pos/installer-modules/lib 2>/dev/null || true

  if [[ -f "$checkout_watchdog" ]]; then
    cp "$checkout_watchdog" /opt/gwi-pos/watchdog.sh && chmod +x /opt/gwi-pos/watchdog.sh && log "  Deployed watchdog.sh"
  fi
  [[ -f "${APP_DIR}/public/watchdog.service" ]] && cp "${APP_DIR}/public/watchdog.service" /opt/gwi-pos/ && log "  Deployed watchdog.service"
  [[ -f "${APP_DIR}/public/watchdog.timer" ]] && cp "${APP_DIR}/public/watchdog.timer" /opt/gwi-pos/ && log "  Deployed watchdog.timer"

  for script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh pre-update-backup.sh; do
    if [[ -f "$checkout_scripts/$script" ]]; then
      cp "$checkout_scripts/$script" /opt/gwi-pos/scripts/ 2>/dev/null && chmod +x "/opt/gwi-pos/scripts/$script" \
        && log "  Deployed scripts/$script" || warn "  FAILED to deploy scripts/$script"
    fi
  done

  if [[ -d "$checkout_modules/lib" ]]; then
    cp -a "$checkout_modules"/lib/*.sh /opt/gwi-pos/installer-modules/lib/ 2>/dev/null || true
    chmod +x /opt/gwi-pos/installer-modules/lib/*.sh 2>/dev/null || true
    log "  Deployed installer libraries"
  fi

  [[ -f "${APP_DIR}/public/sync-agent.js" ]] && cp "${APP_DIR}/public/sync-agent.js" /opt/gwi-pos/sync-agent.js && log "  Deployed sync-agent.js"

  log "Module refresh complete -- remaining stages will use latest code"
}

# ── Main entry ──────────────────────────────────────────────────────────────
run_deploy_app() {
  local _start=$(date +%s)
  log "Stage: deploy_app -- starting"

  source "$(dirname "${BASH_SOURCE[0]}")/lib/error-codes.sh" 2>/dev/null || true

  # Only server + backup roles need the app
  if [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: deploy_app -- skipped (terminal role)"
    return 0
  fi

  header "Installing POS Application"

  # Detect deployment method: Docker (preferred) or tarball (legacy)
  local use_docker=false
  if command -v docker &>/dev/null && [[ "${DEPLOYMENT_METHOD:-}" == "docker" || -f "$APP_BASE/.docker-mode" ]]; then
      use_docker=true
      log "Docker deployment mode detected"
  fi

  if [[ "$use_docker" == "true" ]]; then
    # ── Docker-based deployment ──
    log "Installing Docker if needed..."
    if ! command -v docker &>/dev/null; then
        curl -fsSL https://get.docker.com | sh
        usermod -aG docker "$POSUSER"
        systemctl enable docker
        systemctl start docker
        log "Docker installed"
    fi

    # Ensure docker-deploy.sh is in place
    if [[ -f "$APP_BASE/current/public/scripts/docker-deploy.sh" ]]; then
        cp "$APP_BASE/current/public/scripts/docker-deploy.sh" "$APP_BASE/docker-deploy.sh"
        chmod +x "$APP_BASE/docker-deploy.sh"
    elif [[ -f "${INSTALLER_MODULES_DIR}/docker-deploy.sh" ]]; then
        cp "${INSTALLER_MODULES_DIR}/docker-deploy.sh" "$APP_BASE/docker-deploy.sh"
        chmod +x "$APP_BASE/docker-deploy.sh"
    fi

    # Create shared dirs (Docker still needs these for volume mounts)
    mkdir -p "$APP_BASE/shared/logs/deploys" "$APP_BASE/shared/data" "$APP_BASE/shared/state"
    chown -R "$POSUSER:$POSUSER" "$APP_BASE/shared"

    # Run Docker deploy
    local manifest_url="https://${POS_DOMAIN:-ordercontrolcenter.com}/artifacts/manifest.json"
    log "Deploying via docker-deploy.sh: $manifest_url"
    if bash "$APP_BASE/docker-deploy.sh" --manifest-url "$manifest_url" --force; then
        log "Docker deployment successful"
        touch "$APP_BASE/.docker-mode"
    else
        err "Docker deployment failed"
        # Parse deploy log for error details (same format as tarball)
        local latest_log
        latest_log=$(ls -t "$APP_BASE/shared/logs/deploys/"*.json 2>/dev/null | head -1)
        if [[ -n "$latest_log" ]]; then
            local status errors
            status=$(python3 -c "import json; m=json.load(open('$latest_log')); print(m.get('finalStatus','unknown'))" 2>/dev/null)
            errors=$(python3 -c "import json; m=json.load(open('$latest_log')); print('; '.join(m.get('errors',[])))" 2>/dev/null)
            err "Deploy status: $status"
            [[ -n "$errors" ]] && err "Errors: $errors"
        fi
        return 1
    fi

    # Refresh installer modules from the deployed release (shared by all paths)
    _refresh_modules_from_checkout

  else
  # ── Existing tarball/artifact-based deployment (unchanged) ──

  # ── Offline install mode -- app already deployed ──
  if [[ "${SKIP_GIT_CLONE:-}" == "1" ]]; then
    log "Offline mode: Skipping deploy (app pre-deployed)"
    [[ "${SKIP_NPM_INSTALL:-}" == "1" ]] && log "Offline mode: Skipping npm install (dependencies pre-bundled)"
    [[ "${SKIP_BUILD:-}" == "1" ]] && log "Offline mode: Skipping build (pre-built)"
    ln -sf "$ENV_FILE" "$APP_DIR/.env" 2>/dev/null || true
    ln -sf "$ENV_FILE" "$APP_DIR/.env.local" 2>/dev/null || true
    if [[ "${SKIP_NPM_INSTALL:-}" == "1" ]] && [[ "${SKIP_BUILD:-}" == "1" ]]; then
      log "Offline deploy stage complete"
      log "Stage: deploy_app -- completed in $(( $(date +%s) - _start ))s"
      return 0
    fi
  fi

  # Disk space check -- artifact deploy needs ~2 GB
  local _disk_path="$APP_BASE"
  [[ ! -d "$_disk_path" ]] && _disk_path=$(dirname "$APP_BASE")
  AVAIL_KB=$(df -k "$_disk_path" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  if [[ "$AVAIL_KB" -lt 2000000 ]]; then
    err_code "ERR-INST-003" "$(( AVAIL_KB / 1024 ))MB free in $APP_BASE, need 2GB for artifact deploy"
    err "Insufficient disk space: $(( AVAIL_KB / 1024 )) MB free in $APP_BASE (need ~2 GB)"
    return 1
  fi

  # ── LEGACY PATH ────────────────────────────────────────────────────────────
  if [[ "${LEGACY_DEPLOY:-}" == "1" ]]; then
    log "LEGACY_DEPLOY=1 -- using git clone + npm ci flow"
    if ! _run_legacy_deploy; then
      return 1
    fi
    _refresh_modules_from_checkout
    log "Stage: deploy_app -- completed in $(( $(date +%s) - _start ))s"
    return 0
  fi

  # ── ARTIFACT PATH (default) ────────────────────────────────────────────────

  # Step 1: Bootstrap prerequisites
  _bootstrap_artifact_dirs

  # Step 2: Install deploy-release.sh
  _install_deploy_script

  # Step 3: Sync .env to shared/.env for deploy-release.sh
  # deploy-release.sh validates against /opt/gwi-pos/shared/.env.
  # ALWAYS copy -- stale shared/.env from failed installs causes validation failures.
  if [[ -f "$ENV_FILE" ]]; then
    mkdir -p "$APP_BASE/shared"
    cp "$ENV_FILE" "$APP_BASE/shared/.env"
    chown gwipos:gwipos "$APP_BASE/shared/.env" 2>/dev/null || true
    chmod 640 "$APP_BASE/shared/.env"
    log "Synced .env to shared directory for deploy-release.sh"
  fi

  # Step 4: Deploy artifact
  local _pos_domain="${POS_DOMAIN:-ordercontrolcenter.com}"
  local _manifest_url="https://${_pos_domain}/artifacts/manifest.json"

  log "Deploying artifact from ${_manifest_url}..."
  local _deploy_exit=0
  "$APP_BASE/deploy-release.sh" --manifest-url "$_manifest_url" --force || _deploy_exit=$?

  if [[ $_deploy_exit -ne 0 ]]; then
    # Parse the structured deploy log to determine ACTUAL failure cause
    local _latest_log=""
    _latest_log=$(ls -1t "$APP_BASE/shared/logs/deploys/"*.json 2>/dev/null | head -1)

    local _final_status="" _readiness_result="" _rollback_result="" _release_id="" _prev_release=""
    if [[ -n "$_latest_log" ]] && command -v jq &>/dev/null; then
      _final_status=$(jq -r '.finalStatus // empty' "$_latest_log" 2>/dev/null)
      _readiness_result=$(jq -r '.readinessResult // empty' "$_latest_log" 2>/dev/null)
      _rollback_result=$(jq -r '.rollbackResult // empty' "$_latest_log" 2>/dev/null)
      _release_id=$(jq -r '.releaseId // empty' "$_latest_log" 2>/dev/null)
      _prev_release=$(jq -r '.previousReleaseId // empty' "$_latest_log" 2>/dev/null)
    elif [[ -n "$_latest_log" ]]; then
      # Fallback without jq
      _final_status=$(sed -n 's/.*"finalStatus"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_latest_log" 2>/dev/null | head -1)
      _readiness_result=$(sed -n 's/.*"readinessResult"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_latest_log" 2>/dev/null | head -1)
      _rollback_result=$(sed -n 's/.*"rollbackResult"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_latest_log" 2>/dev/null | head -1)
      _release_id=$(sed -n 's/.*"releaseId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_latest_log" 2>/dev/null | head -1)
      _prev_release=$(sed -n 's/.*"previousReleaseId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_latest_log" 2>/dev/null | head -1)
    fi

    # Rolled back = the deploy pipeline worked correctly, old release is running
    if [[ "$_final_status" == "rolled_back" ]]; then
      warn "Release ${_release_id:-unknown} failed readiness and was safely rolled back to ${_prev_release:-unknown}"
      warn "The previous release is running normally. Investigate the new release before retrying."
      if [[ -n "$_latest_log" ]]; then
        local _debug_file="${_latest_log%.json}"
        _debug_file="${APP_BASE}/shared/logs/deploys/$(basename "$_latest_log" .json | sed 's/\.json$//')"
        warn "Debug bundle: ${APP_BASE}/shared/logs/deploys/ (check *-readiness-debug.txt)"
      fi
      # Treat as success -- old release is healthy, installer can continue
      log "Continuing installation with previous release (rolled_back is acceptable)"
    elif [[ "$_final_status" == "rollback_failed" ]]; then
      err_code "ERR-INST-150" "Release ${_release_id:-unknown} failed readiness AND rollback failed"
      err "CRITICAL: Both the new release and rollback failed."
      err "  The system may be in a broken state. Check deploy logs at: $_latest_log"
      err "  Manual intervention required."
      return 1
    elif [[ "$_readiness_result" == "fail" ]]; then
      err_code "ERR-INST-150" "Release ${_release_id:-unknown} failed readiness (rollback: ${_rollback_result:-unknown})"
      err "Artifact deployed but the new release did not become ready."
      err "  Deploy log: $_latest_log"
      return 1
    elif [[ "$_final_status" == "failed" ]]; then
      # Parse more specific cause from the log
      local _schema_result=""
      if command -v jq &>/dev/null && [[ -n "$_latest_log" ]]; then
        _schema_result=$(jq -r '.schemaResult // empty' "$_latest_log" 2>/dev/null)
      fi
      if [[ "$_schema_result" == "fail" ]]; then
        err_code "ERR-INST-150" "Schema migration failed for release ${_release_id:-unknown}"
        err "Database schema migration failed. Check: ${APP_BASE}/shared/logs/deploys/schema-*.log"
      else
        err_code "ERR-INST-150" "Artifact deploy failed (status: ${_final_status:-unknown})"
        err "Deploy log: ${_latest_log:-no log found}"
      fi
      return 1
    else
      # Generic fallback only when we truly can't parse
      err_code "ERR-INST-150" "Artifact deploy failed from $_manifest_url (exit code: $_deploy_exit)"
      err "Could not parse deploy log. Check: ${APP_BASE}/shared/logs/deploys/"
      err "  To fall back to git clone: LEGACY_DEPLOY=1 installer.run --resume-from=05-deploy-app"
      return 1
    fi
  fi

  # Step 5: Verify current symlink exists
  if [[ ! -L "$APP_BASE/current" ]]; then
    err_code "ERR-INST-150" "deploy-release.sh succeeded but /opt/gwi-pos/current symlink missing"
    err "FATAL: Deploy reported success but current symlink is missing."
    return 1
  fi

  # Step 6: Update APP_DIR for downstream stages and create compat symlink
  APP_DIR="$APP_BASE/current"
  export APP_DIR
  # Compat symlink: /opt/gwi-pos/app -> /opt/gwi-pos/current
  # So any hardcoded references to /opt/gwi-pos/app still work
  rm -f "$APP_BASE/app" 2>/dev/null || true
  ln -sfn "$APP_BASE/current" "$APP_BASE/app"
  log "APP_DIR updated to $APP_DIR (compat symlink at $APP_BASE/app)"

  # Step 7: Verify .env symlink inside the release
  if [[ ! -e "$APP_DIR/.env" ]]; then
    # deploy-release.sh should have wired this, but belt-and-suspenders
    ln -sf "$APP_BASE/shared/.env" "$APP_DIR/.env" 2>/dev/null || true
    ln -sf "$APP_BASE/shared/.env" "$APP_DIR/.env.local" 2>/dev/null || true
    log "Wired .env symlinks manually (deploy-release.sh may not have done it)"
  fi

  log "App deployed at $APP_DIR ($(readlink -f "$APP_BASE/current" 2>/dev/null || echo '?'))"

  # Step 8: Refresh installer modules from the deployed release
  _refresh_modules_from_checkout

  # Step 9: Copy deploy-release.sh from the deployed release (for future updates)
  if [[ -f "$APP_DIR/public/scripts/deploy-release.sh" ]]; then
    cp "$APP_DIR/public/scripts/deploy-release.sh" "$APP_BASE/deploy-release.sh"
    chmod +x "$APP_BASE/deploy-release.sh"
    log "Updated deploy-release.sh from deployed release"
  fi

  fi  # end Docker vs tarball/artifact branch

  log "Stage: deploy_app -- completed in $(( $(date +%s) - _start ))s"
  return 0
}

# ── Bootstrap artifact directory skeleton ──────────────────────────────────
_bootstrap_artifact_dirs() {
  log "Bootstrapping artifact directory structure..."

  # Create gwipos service user if not exists
  if ! id -u gwipos &>/dev/null; then
    useradd -r -s /bin/false -m -d /home/gwipos gwipos
    log "Created gwipos service user"
  fi

  # Create directory skeleton
  mkdir -p \
    "$APP_BASE/releases" \
    "$APP_BASE/shared/logs/deploys" \
    "$APP_BASE/shared/data" \
    "$APP_BASE/shared/state" \
    "$APP_BASE/cache/artifacts" \
    "$APP_BASE/keys"

  # Embed minisign public key
  local _pub_key="$APP_BASE/keys/gwi-pos-release.pub"
  if [[ ! -f "$_pub_key" ]]; then
    cat > "$_pub_key" <<'PUBKEY'
untrusted comment: minisign public key 6A8006EFB1B4BF0A
RWQKv7Sx7waAahboOQ+1oTmS1uU5fHebSLBqOoOBHpFa6MsLyFMqZdVl
PUBKEY
    log "Embedded minisign public key"
  fi

  # Set ownership (but preserve root-owned sensitive dirs)
  chown -R gwipos:gwipos "$APP_BASE" 2>/dev/null || true
  # Re-lock sensitive paths
  [[ -f "$ENV_FILE" ]] && chown root:gwipos "$ENV_FILE" && chmod 640 "$ENV_FILE"
  [[ -d "$APP_BASE/keys" ]] && chown root:gwipos "$APP_BASE/keys" && chmod 750 "$APP_BASE/keys"
  # Private key stays locked; pub key readable by gwipos for deploy signature verification
  [[ -f "$APP_BASE/keys/private.pem" ]] && chown root:root "$APP_BASE/keys/private.pem" && chmod 600 "$APP_BASE/keys/private.pem"
  local _cred="$APP_BASE/.git-credentials"
  [[ -f "$_cred" ]] && chown root:gwipos "$_cred" && chmod 640 "$_cred"

  log "Directory skeleton ready at $APP_BASE"
}

# ── Install deploy-release.sh ─────────────────────────────────────────────
_install_deploy_script() {
  local _target="$APP_BASE/deploy-release.sh"
  local _src_local="$(dirname "${BASH_SOURCE[0]}")/../scripts/deploy-release.sh"
  local _src_url="https://${POS_DOMAIN:-ordercontrolcenter.com}/scripts/deploy-release.sh"

  # Prefer the local copy from the installer bundle
  if [[ -f "$_src_local" ]]; then
    cp "$_src_local" "$_target"
    chmod +x "$_target"
    log "Installed deploy-release.sh from installer bundle"
  elif curl -fsSL --connect-timeout 10 --max-time 30 -o "$_target" "$_src_url" 2>/dev/null; then
    chmod +x "$_target"
    log "Downloaded deploy-release.sh from $_src_url"
  else
    err_code "ERR-INST-150" "Cannot find deploy-release.sh locally or download from $_src_url"
    err "FATAL: deploy-release.sh not available. Cannot proceed with artifact deploy."
    return 1
  fi

  chown root:gwipos "$_target" 2>/dev/null || true
}

# ── Legacy deploy (git clone + npm ci) ─────────────────────────────────────
_run_legacy_deploy() {
  log "=== LEGACY DEPLOY PATH ==="

  # Credential setup
  CRED_FILE="$APP_BASE/.git-credentials"
  if [[ -n "${DEPLOY_TOKEN:-}" ]] && [[ "${DEPLOY_TOKEN:-}" != "null" ]]; then
    echo "https://${DEPLOY_TOKEN}:x-oauth-basic@github.com" > "$CRED_FILE"
    chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"
  elif [[ ! -f "$CRED_FILE" ]]; then
    err "WARNING: No deploy token and no credentials file."
    track_warn "No git credentials available -- legacy deploy may fail"
  fi

  [[ -f "$CRED_FILE" ]] && ! _git_validate_credentials "$CRED_FILE" "$GIT_REPO" && \
    track_warn "Git credentials invalid -- token may be expired"

  # Clone or update
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Updating existing app code..."
    _git_repair "$APP_DIR"
    if ! _git_with_retry 3 5 "sudo -u '$POSUSER' bash -c \"
      cd '$APP_DIR' && git config credential.helper 'store --file=$CRED_FILE'
      git remote set-url origin '$GIT_REPO' 2>/dev/null || true
      git fetch --all --prune
    \""; then
      err_code "ERR-INST-151" "git fetch failed after 3 attempts"
      return 1
    fi
    if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && git reset --hard origin/main && git clean -fd"; then
      if [[ -n "$APP_DIR" ]] && [[ "$APP_DIR" == /opt/gwi-pos/* ]] && [[ ${#APP_DIR} -gt 15 ]]; then
        rm -rf "$APP_DIR"
      else
        err "FATAL: Refusing to rm -rf suspicious path: '$APP_DIR'"
        return 1
      fi
    fi
  fi

  if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Cloning app from repository..."
    mkdir -p "$(dirname "$APP_DIR")"
    chown -R "$POSUSER":"$POSUSER" "$APP_BASE"
    [[ -f "$ENV_FILE" ]] && chown root:"$POSUSER" "$ENV_FILE" && chmod 640 "$ENV_FILE"
    [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"
    [[ -f "$CRED_FILE" ]] && chown root:"$POSUSER" "$CRED_FILE" && chmod 640 "$CRED_FILE"
    if ! _git_with_retry 3 10 "sudo -u '$POSUSER' bash -c \"
      git config --global credential.helper 'store --file=$CRED_FILE'
      git clone --depth 1 '$GIT_REPO' '$APP_DIR'
      cd '$APP_DIR' && git config credential.helper 'store --file=$CRED_FILE'
    \""; then
      err_code "ERR-INST-150" "git clone failed after 3 attempts"
      return 1
    fi
    sudo -u "$POSUSER" git config --global --unset credential.helper 2>/dev/null || true
  fi

  # Env symlinks
  rm -f "$APP_DIR/.env" "$APP_DIR/.env.local"
  ln -sf "$ENV_FILE" "$APP_DIR/.env"
  ln -sf "$ENV_FILE" "$APP_DIR/.env.local"
  chown -h "$POSUSER":"$POSUSER" "$APP_DIR/.env" "$APP_DIR/.env.local"

  # npm install + prisma generate
  rm -rf "$APP_DIR/.next" 2>/dev/null || true
  log "Installing npm dependencies (legacy)..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm ci --production=false"; then
    sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm cache clean --force" 2>/dev/null || true
    if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && rm -rf node_modules && npm ci --production=false"; then
      err_code "ERR-INST-153" "npm ci failed after retry"
      return 1
    fi
  fi

  log "Generating Prisma client (legacy)..."
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npx prisma generate"; then
    err_code "ERR-INST-154" "npx prisma generate failed"
    return 1
  fi

  log "=== LEGACY DEPLOY COMPLETE ==="
}
