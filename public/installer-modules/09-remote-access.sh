#!/usr/bin/env bash
# =============================================================================
# 09-remote-access.sh -- SSH hardening, TeamViewer, desktop launchers
# =============================================================================
# Entry: run_remote_access
# Expects: STATION_ROLE, POSUSER, POSUSER_HOME, APP_BASE,
#          SERVER_URL, CHROMIUM_BIN, LOCATION_NAME, VENUE_NAME
# Sets: VENUE_NAME, LOCATION_NAME (for finalize)
# =============================================================================

run_remote_access() {
  local _start=$(date +%s)
  log "Stage: remote_access -- starting"

  # ─────────────────────────────────────────────────────────────────────────────
  # Desktop Launcher
  # ─────────────────────────────────────────────────────────────────────────────

  header "Creating Desktop Launcher"

  mkdir -p "$APP_BASE"

  # Clean old launchers (prevents stale URLs after role switch)
  rm -f /usr/share/applications/gwi-pos.desktop 2>/dev/null || true
  rm -f "$POSUSER_HOME/Desktop/gwi-pos.desktop" 2>/dev/null || true

  # Server/backup: dashboard is the desktop app, NOT a web UI shortcut.
  # Only terminals need the Chromium POS launcher on the desktop.
  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    log "Server role -- skipping web UI desktop shortcut (dashboard handles this)"
  else

  POS_URL="http://localhost:3005"
  [[ "$STATION_ROLE" == "terminal" ]] && POS_URL="$SERVER_URL"

  # Reuse venue name from registration if available, else query POS, else default
  if [[ -z "${VENUE_NAME:-}" ]]; then
    if curl -sf --max-time 3 "http://localhost:3005/api/settings" >/dev/null 2>&1; then
      VENUE_NAME=$(curl -sf --max-time 5 "http://localhost:3005/api/settings" 2>/dev/null \
        | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d?.data?.locationName||'')}catch(e){}" 2>/dev/null || echo "")
    fi
  fi
  LOCATION_NAME="${VENUE_NAME:-ThePassPOS}"

  # Detect Chromium binary (may already be set from 04-database.sh / 07-services.sh)
  if [[ -z "${CHROMIUM_BIN:-}" ]]; then
    if command -v chromium-kiosk >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium-kiosk"
    elif command -v chromium-browser >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium-browser"
    elif command -v chromium >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium"
    fi
  fi

  # Download icon to shared location (works for both server and terminal roles)
  POS_ICON="$APP_BASE/icon.svg"
  if [[ ! -f "$POS_ICON" ]]; then
    curl -fsSL "https://ordercontrolcenter.com/icon.svg" -o "$POS_ICON" 2>/dev/null || true
  fi
  if [[ ! -f "$POS_ICON" ]]; then
    # Fall back to system icon if download fails
    POS_ICON="web-browser"
  fi

  # Build Exec command: use Chromium with fullscreen if available, else xdg-open
  if [[ -n "${CHROMIUM_BIN:-}" ]]; then
    LAUNCHER_CHROMIUM_PATH=$(command -v "$CHROMIUM_BIN" 2>/dev/null || echo "/usr/bin/$CHROMIUM_BIN")
    LAUNCHER_EXEC="$LAUNCHER_CHROMIUM_PATH --start-fullscreen --noerrdialogs --disable-infobars --disable-session-crashed-bubble $POS_URL"
  else
    LAUNCHER_EXEC="xdg-open $POS_URL"
  fi

  # Create a launcher shell script (easy to double-click or run from terminal)
  LAUNCHER_SCRIPT="$APP_BASE/launch-pos.sh"
  cat > "$LAUNCHER_SCRIPT" <<LSEOF
#!/usr/bin/env bash
# GWI POS Launcher -- opens the POS in fullscreen Chromium
$LAUNCHER_EXEC &
LSEOF
  chmod +x "$LAUNCHER_SCRIPT"
  chown "$POSUSER":"$POSUSER" "$LAUNCHER_SCRIPT"

  # Application menu entry (.desktop file)
  cat > /usr/share/applications/gwi-pos.desktop <<DTEOF
[Desktop Entry]
Type=Application
Name=GWI POS
Comment=Launch GWI POS -- $LOCATION_NAME
Exec=$LAUNCHER_SCRIPT
Icon=$POS_ICON
Terminal=false
Categories=Office;Utility;
StartupNotify=true
DTEOF

  # Copy to user desktop (create Desktop dir if it doesn't exist -- fresh Ubuntu installs)
  DESKTOP_DIR="$POSUSER_HOME/Desktop"
  mkdir -p "$DESKTOP_DIR"
  chown "$POSUSER":"$POSUSER" "$DESKTOP_DIR"
  cp /usr/share/applications/gwi-pos.desktop "$DESKTOP_DIR/"
  chown "$POSUSER":"$POSUSER" "$DESKTOP_DIR/gwi-pos.desktop"
  chmod +x "$DESKTOP_DIR/gwi-pos.desktop"

  # Mark as trusted -- different desktops need different approaches
  # GNOME (Ubuntu): gio metadata::trusted
  if command -v gio >/dev/null 2>&1; then
    sudo -u "$POSUSER" gio set "$DESKTOP_DIR/gwi-pos.desktop" metadata::trusted true 2>/dev/null || true
  fi
  # KDE Plasma (Kubuntu): writes TryExec and marks executable -- that's enough for KDE
  # KDE trusts .desktop files if they are executable + have valid Exec= line
  # No extra metadata needed -- chmod +x (done above) is sufficient

  log "Desktop launcher created: $DESKTOP_DIR/gwi-pos.desktop"
  log "  Quick launch: $LAUNCHER_SCRIPT"

  fi # end terminal-only desktop shortcut block

  # ─────────────────────────────────────────────────────────────────────────────
  # TeamViewer (backup remote access -- server/backup roles only)
  # ─────────────────────────────────────────────────────────────────────────────

  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    if ! command -v teamviewer >/dev/null 2>&1; then
      log "Installing TeamViewer..."
      local tv_deb="/tmp/teamviewer_amd64.deb"
      if curl -fsSL -o "$tv_deb" "https://download.teamviewer.com/download/linux/teamviewer_amd64.deb" 2>/dev/null; then
        dpkg -i "$tv_deb" 2>/dev/null || true
        apt-get install -f -y -qq 2>/dev/null || true
        rm -f "$tv_deb"
        if command -v teamviewer >/dev/null 2>&1; then
          systemctl enable teamviewerd.service 2>/dev/null || true
          log "TeamViewer installed"
        else
          warn "TeamViewer package install failed (non-fatal)"
        fi
      else
        warn "TeamViewer download failed (non-fatal)"
      fi
    else
      log "TeamViewer already installed"
    fi
  fi

  log "Stage: remote_access -- completed in $(( $(date +%s) - _start ))s"
  return 0
}
