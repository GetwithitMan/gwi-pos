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
# =============================================================================

# ── Minisign public key (embedded) ─────────────────────────────────────────
if ! declare -p _GWI_MINISIGN_PUB &>/dev/null 2>&1; then
  readonly _GWI_MINISIGN_PUB='untrusted comment: minisign public key 6A8006EFB1B4BF0A
RWQKv7Sx7waAahboOQ+1oTmS1uU5fHebSLBqOoOBHpFa6MsLyFMqZdVl'
fi

# ── Module refresh ────────────────────────────────────────────────────────
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

  for script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh; do
    if [[ -f "$checkout_scripts/$script" ]]; then
      cp "$checkout_scripts/$script" /opt/gwi-pos/scripts/ 2>/dev/null && chmod +x "/opt/gwi-pos/scripts/$script" \
        && log "  Deployed scripts/$script" || warn "  FAILED to deploy scripts/$script"
    fi
  done
  # NOTE: pre-update-backup.sh removed — DB backups handled by pre-update-safety.sh
  # library (sourced by gwi-node pre-deploy hook). Standalone wrapper is legacy.

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
  # Only server/backup roles deploy the app
  if [[ "$STATION_ROLE" != "server" ]] && [[ "$STATION_ROLE" != "backup" ]]; then
    log "Skipping app deploy for role: $STATION_ROLE"
    return 0
  fi

  header "Installing POS Application via gwi-node"

  # Install Docker if not present
  if ! command -v docker &>/dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker "$POSUSER" 2>/dev/null || true
    systemctl enable docker
    systemctl start docker
    log "Docker installed"
  fi

  # Create required directories
  mkdir -p "$APP_BASE/shared/state" "$APP_BASE/shared/logs/deploys" "$APP_BASE/shared/data"
  chown -R "$POSUSER:$POSUSER" "$APP_BASE/shared"

  # Install gwi-node.sh (the single bootstrap agent)
  local gwi_node="$APP_BASE/gwi-node.sh"
  if [[ -f "${MODULES_DIR:-}/gwi-node.sh" ]]; then
    cp "${MODULES_DIR}/gwi-node.sh" "$gwi_node"
  elif [[ -f "$APP_BASE/current/public/scripts/gwi-node.sh" ]]; then
    cp "$APP_BASE/current/public/scripts/gwi-node.sh" "$gwi_node"
  else
    err "gwi-node.sh not found in installer bundle or current release"
    return 1
  fi
  chmod 755 "$gwi_node"
  chown "$POSUSER:$POSUSER" "$gwi_node"

  # Ensure shared/.env exists (copied from canonical .env)
  if [[ -f "$APP_BASE/.env" ]] && [[ ! -f "$APP_BASE/shared/.env" ]]; then
    cp "$APP_BASE/.env" "$APP_BASE/shared/.env"
    chown "$POSUSER:$POSUSER" "$APP_BASE/shared/.env"
    chmod 640 "$APP_BASE/shared/.env"
  fi

  # Run gwi-node install (pulls image, migrates, starts container)
  log "Running gwi-node install..."
  if bash "$gwi_node" install; then
    log "gwi-node install successful"
  else
    err "gwi-node install failed"
    local latest_log
    latest_log=$(ls -t "$APP_BASE/shared/logs/deploys/"*.json 2>/dev/null | head -1)
    if [[ -n "$latest_log" ]]; then
      local errors
      errors=$(python3 -c "import json; m=json.load(open('$latest_log')); print('; '.join(m.get('errors',[])))" 2>/dev/null)
      [[ -n "$errors" ]] && err "Errors: $errors"
    fi
    return 1
  fi

  # Stop/disable systemd POS service (Docker owns the runtime now)
  systemctl stop thepasspos 2>/dev/null || true
  systemctl disable thepasspos 2>/dev/null || true

  log "App deployed via Docker container"
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

# ── Install deploy-release.sh (DEPRECATED — legacy compat only) ───────────
# gwi-node.sh is the canonical deploy agent (v2.0.0+). This function is
# kept so pre-Docker NUCs can still receive the script, and for any external
# tooling that references /opt/gwi-pos/deploy-release.sh.
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


# NOTE: Legacy deploy (LEGACY_DEPLOY=1, git clone + npm ci) was removed.
# Docker-based deploy via gwi-node is the only supported path.
# Emergency recovery: use `gwi-node rollback`.
