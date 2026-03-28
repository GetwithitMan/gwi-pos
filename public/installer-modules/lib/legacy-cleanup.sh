#!/usr/bin/env bash
# =============================================================================
# legacy-cleanup.sh -- Force convergence to current supported state
# =============================================================================
# Sourced by installer stages and sync-agent after updates.
# Every re-install/upgrade MUST converge the machine -- not just deploy new code.
# Old services, launchers, configs, and kiosk behavior are explicitly removed.
#
# Rule: A good installer does not just "install new stuff."
#       It forces convergence to the current supported state.
# =============================================================================

# Defaults (caller should override via env)
: "${POSUSER:=gwipos}"
: "${POSUSER_HOME:=/home/$POSUSER}"
: "${APP_BASE:=/opt/gwi-pos}"
: "${STATION_ROLE:=server}"
: "${LOCATION_NAME:=POS Dashboard}"

# Logging fallback
if ! type log >/dev/null 2>&1; then
  log()  { echo "[$(date -u +%FT%TZ)] $*"; }
fi
if ! type warn >/dev/null 2>&1; then
  warn() { log "WARNING: $*"; }
fi

# =============================================================================
# converge_server_role -- Remove legacy kiosk, ensure Dashboard, verify services
# =============================================================================
converge_server_role() {
  log "Converging server role to current baseline..."

  # ── Remove legacy Chromium kiosk ──────────────────────────────────────
  log "  Removing legacy kiosk services..."
  local legacy_services=(
    thepasspos-kiosk.service
    thepasspos-exit-kiosk.service
    pulse-kiosk.service
  )
  for svc in "${legacy_services[@]}"; do
    if systemctl list-unit-files "$svc" >/dev/null 2>&1; then
      systemctl disable --now "$svc" 2>/dev/null || true
      rm -f "/etc/systemd/system/$svc" 2>/dev/null || true
      log "    Removed: $svc"
    fi
  done

  # Remove legacy kiosk scripts
  local legacy_scripts=(
    "$APP_BASE/wait-for-pos.sh"
    "$APP_BASE/clear-kiosk-session.sh"
    "$APP_BASE/kiosk-control.sh"
  )
  for script in "${legacy_scripts[@]}"; do
    if [[ -f "$script" ]]; then
      rm -f "$script"
      log "    Removed: $script"
    fi
  done

  # Remove old Chromium autostart entries
  local autostart_dir="$POSUSER_HOME/.config/autostart"
  if [[ -d "$autostart_dir" ]]; then
    for f in "$autostart_dir"/*chromium* "$autostart_dir"/*kiosk* "$autostart_dir"/*pos-browser*; do
      if [[ -f "$f" ]]; then
        rm -f "$f"
        log "    Removed autostart: $(basename "$f")"
      fi
    done
  fi

  # Remove old desktop shortcuts that launch browser/POS directly
  local desktop_dir="$POSUSER_HOME/Desktop"
  local legacy_desktop_files=(
    "gwi-pos.desktop"
    "pos-browser.desktop"
    "pos-kiosk.desktop"
  )
  for df in "${legacy_desktop_files[@]}"; do
    if [[ -f "$desktop_dir/$df" ]]; then
      rm -f "$desktop_dir/$df"
      log "    Removed desktop shortcut: $df"
    fi
  done

  # ── Ensure Dashboard state ────────────────────────────────────────────
  log "  Ensuring Dashboard is configured..."

  # Refresh Desktop icon with venue name
  if command -v gwi-dashboard >/dev/null 2>&1 || [[ -f /opt/gwi-pos/dashboard/gwi-nuc-dashboard ]]; then
    local dash_desktop="$desktop_dir/gwi-nuc-dashboard.desktop"
    cat > "$dash_desktop" <<DESK
[Desktop Entry]
Type=Application
Name=GWI POS - ${LOCATION_NAME}
Exec=gwi-dashboard
Icon=gwi-pos
Terminal=false
Categories=Utility;
DESK
    chmod +x "$dash_desktop"
    chown "$POSUSER":"$POSUSER" "$dash_desktop"
    log "    Desktop icon: GWI POS - ${LOCATION_NAME}"
  else
    warn "  Dashboard binary not found -- skipping desktop icon (Stage 12 will handle)"
  fi

  # Ensure Dashboard user service is enabled (Phase 5 Ansible creates it)
  local user_svc_dir="$POSUSER_HOME/.config/systemd/user"
  if [[ -f "$user_svc_dir/gwi-dashboard.service" ]]; then
    sudo -u "$POSUSER" XDG_RUNTIME_DIR="/run/user/$(id -u "$POSUSER")" \
      systemctl --user daemon-reload 2>/dev/null || true
    sudo -u "$POSUSER" XDG_RUNTIME_DIR="/run/user/$(id -u "$POSUSER")" \
      systemctl --user enable gwi-dashboard.service 2>/dev/null || true
    log "    Dashboard service: enabled"
  fi

  # Ensure keep-awake timer is enabled
  if [[ -f "$user_svc_dir/gwi-keep-awake.timer" ]]; then
    sudo -u "$POSUSER" XDG_RUNTIME_DIR="/run/user/$(id -u "$POSUSER")" \
      systemctl --user enable gwi-keep-awake.timer 2>/dev/null || true
    log "    Keep-awake timer: enabled"
  fi

  # ── Reload and verify ─────────────────────────────────────────────────
  systemctl daemon-reload

  log "  Convergence verification:"

  # Expected services for server role
  local expected_enabled=(thepasspos thepasspos-sync)
  for svc in "${expected_enabled[@]}"; do
    if systemctl is-enabled "$svc" >/dev/null 2>&1; then
      log "    $svc: enabled (correct)"
    else
      warn "  $svc: NOT enabled (expected for server role)"
    fi
  done

  # Legacy services that should NOT be enabled
  local expected_absent=(thepasspos-kiosk thepasspos-exit-kiosk pulse-kiosk)
  for svc in "${expected_absent[@]}"; do
    if systemctl is-enabled "$svc" >/dev/null 2>&1; then
      warn "  Legacy $svc still enabled -- force-disabling"
      systemctl disable "$svc" 2>/dev/null || true
    else
      log "    $svc: absent/disabled (correct)"
    fi
  done

  log "  Server role convergence complete."
}

# =============================================================================
# converge_terminal_role -- Ensure kiosk is set up, Dashboard NOT running
# =============================================================================
converge_terminal_role() {
  log "Converging terminal role to current baseline..."

  # Terminal role: kiosk service should be enabled, Dashboard should not be
  # (Terminals don't run the POS server, just display it)

  # Disable Dashboard user service if present
  sudo -u "$POSUSER" XDG_RUNTIME_DIR="/run/user/$(id -u "$POSUSER")" \
    systemctl --user disable --now gwi-dashboard.service 2>/dev/null || true

  # Verify kiosk service is enabled (if it exists)
  if systemctl list-unit-files thepasspos-kiosk.service >/dev/null 2>&1; then
    if systemctl is-enabled thepasspos-kiosk.service >/dev/null 2>&1; then
      log "    thepasspos-kiosk: enabled (correct for terminal)"
    else
      warn "  thepasspos-kiosk: NOT enabled (expected for terminal role)"
    fi
  fi

  # Server-only services should be disabled
  for svc in thepasspos thepasspos-sync; do
    if systemctl is-enabled "$svc" >/dev/null 2>&1; then
      warn "  $svc enabled on terminal -- disabling"
      systemctl disable "$svc" 2>/dev/null || true
    fi
  done

  log "  Terminal role convergence complete."
}

# =============================================================================
# converge_backup_role -- POS disabled, sync enabled, Dashboard standby
# =============================================================================
converge_backup_role() {
  log "Converging backup role to current baseline..."

  # POS service disabled (standby -- promote.sh starts it on takeover)
  if systemctl is-enabled thepasspos >/dev/null 2>&1; then
    systemctl disable thepasspos 2>/dev/null || true
    log "    thepasspos: disabled (correct for backup/standby)"
  fi

  # Sync agent enabled (receives promotion commands from MC)
  if ! systemctl is-enabled thepasspos-sync >/dev/null 2>&1; then
    systemctl enable thepasspos-sync 2>/dev/null || true
    log "    thepasspos-sync: enabled (correct for backup)"
  fi

  # Remove legacy kiosk (same as server -- backup doesn't need kiosk)
  local legacy_services=(thepasspos-kiosk.service thepasspos-exit-kiosk.service)
  for svc in "${legacy_services[@]}"; do
    systemctl disable --now "$svc" 2>/dev/null || true
    rm -f "/etc/systemd/system/$svc" 2>/dev/null || true
  done

  # Dashboard can be installed (shows standby status) but don't force-enable
  log "  Backup role convergence complete."
}

# =============================================================================
# converge_role -- Dispatch to the correct role convergence function
# =============================================================================
converge_role() {
  local role="${1:-$STATION_ROLE}"
  case "$role" in
    server)   converge_server_role ;;
    terminal) converge_terminal_role ;;
    backup)   converge_backup_role ;;
    *)
      warn "Unknown role '$role' -- skipping convergence"
      return 1
      ;;
  esac
}
