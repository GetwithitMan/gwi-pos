#!/usr/bin/env bash
# =============================================================================
# 09-remote-access.sh — VNC, RealVNC, desktop launchers
# =============================================================================
# Entry: run_remote_access
# Expects: STATION_ROLE, POSUSER, POSUSER_HOME, APP_BASE, VNC_PASSWORD,
#          SERVER_URL, CHROMIUM_BIN, LOCATION_NAME, VENUE_NAME,
#          REALVNC_CLOUD_TOKEN (optional, from .env)
# Sets: VENUE_NAME, LOCATION_NAME (for finalize)
# =============================================================================

run_remote_access() {
  local _start=$(date +%s)
  log "Stage: remote_access — starting"

  # ─────────────────────────────────────────────────────────────────────────────
  # VNC Remote Desktop Access (Both Roles)
  # ─────────────────────────────────────────────────────────────────────────────

  header "Setting Up VNC Remote Access"

  # x11vnc: free, shares the actual X11 desktop, works with any VNC viewer
  if ! command -v x11vnc >/dev/null 2>&1; then
    log "Installing x11vnc..."
    apt-get install -y x11vnc >/dev/null 2>&1 || {
      warn "Failed to install x11vnc. Remote desktop access will not be available."
    }
  fi

  if command -v x11vnc >/dev/null 2>&1; then
    # Store VNC password (remove old file first to prevent partial state on re-runs)
    mkdir -p /etc/x11vnc
    rm -f /etc/x11vnc/passwd 2>/dev/null || true
    x11vnc -storepasswd "$VNC_PASSWORD" /etc/x11vnc/passwd
    chmod 600 /etc/x11vnc/passwd
    chown root:root /etc/x11vnc/passwd

    # Create systemd service for persistent unattended access
    cat > /etc/systemd/system/x11vnc.service <<VNCSVC
[Unit]
Description=x11vnc VNC Server
After=display-manager.service network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :0 -auth ${POSUSER_HOME}/.Xauthority -forever -loop -noxdamage -repeat -rfbauth /etc/x11vnc/passwd -rfbport 5900 -localhost -shared
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
VNCSVC

    systemctl daemon-reload
    systemctl enable x11vnc
    systemctl start x11vnc
    log "x11vnc: Running on localhost:5900 (use SSH tunnel: ssh -L 5900:localhost:5900 user@host)"
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # RealVNC Connect Server (always installed — sign in via desktop icon)
  # ─────────────────────────────────────────────────────────────────────────────

  header "Setting Up RealVNC Connect"

  if ! command -v vncserver-x11 >/dev/null 2>&1; then
    log "Downloading RealVNC Server..."
    curl -fsSL -o /tmp/vncserver.deb \
      "https://www.realvnc.com/download/file/vnc.files/VNC-Server-Latest-Linux-x64.deb" 2>/dev/null || {
      warn "Failed to download RealVNC Server. You can install it manually later."
    }

    if [[ -f /tmp/vncserver.deb ]]; then
      apt-get install -y /tmp/vncserver.deb 2>/dev/null || {
        warn "RealVNC Server install failed. You can install it manually later."
      }
      rm -f /tmp/vncserver.deb
    fi
  else
    log "RealVNC Server already installed."
  fi

  if command -v vncserver-x11 >/dev/null 2>&1; then
    # Enable and start the RealVNC service
    systemctl enable vncserver-x11-serviced 2>/dev/null || true
    systemctl start vncserver-x11-serviced 2>/dev/null || true

    # Set friendly name from venue name
    # Priority: LOCATION_NAME from MC registration (Stage 2) > local POS API > hostname
    ROLE_SUFFIX="Server"
    [[ "$STATION_ROLE" == "terminal" ]] && ROLE_SUFFIX="Terminal"
    [[ "$STATION_ROLE" == "backup" ]] && ROLE_SUFFIX="Backup"

    # Use LOCATION_NAME/VENUE_NAME from registration if available (set by 02-register.sh)
    if [[ -z "${VENUE_NAME:-}" ]]; then
      # Fall back to querying local POS API (may not be running yet on first install)
      if curl -sf --max-time 3 "http://localhost:3005/api/settings" >/dev/null 2>&1; then
        VENUE_NAME=$(curl -sf --max-time 5 "http://localhost:3005/api/settings" 2>/dev/null \
          | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d?.data?.locationName||'')}catch(e){}" 2>/dev/null || echo "")
      fi
    fi

    if [[ -n "${VENUE_NAME:-}" ]]; then
      FRIENDLY_NAME="ThePassPOS-${VENUE_NAME}-${ROLE_SUFFIX}"
    else
      FRIENDLY_NAME="ThePassPOS-$(hostname)-${ROLE_SUFFIX}"
    fi
    FRIENDLY_NAME=$(echo "$FRIENDLY_NAME" | tr ' ' '-' | tr -cd 'A-Za-z0-9-_')

    # Write friendly name to RealVNC config (always overwrite — handles renames + role switches)
    mkdir -p /root/.vnc/config.d
    echo "FriendlyName=$FRIENDLY_NAME" > /root/.vnc/config.d/vncserver-x11-serviced

    log "RealVNC Server installed — FriendlyName: $FRIENDLY_NAME"

    # ── RealVNC Cloud Sign-In (credentials from environment or .env) ──
    REALVNC_EMAIL="${REALVNC_EMAIL:-}"
    REALVNC_PASSWORD="${REALVNC_PASSWORD:-}"

    # Try to read from /opt/gwi-pos/.env if not set
    if [[ -z "$REALVNC_EMAIL" ]] && [[ -f /opt/gwi-pos/.env ]]; then
      REALVNC_EMAIL=$(grep "^REALVNC_EMAIL=" /opt/gwi-pos/.env 2>/dev/null | cut -d= -f2- || echo "")
      REALVNC_PASSWORD=$(grep "^REALVNC_PASSWORD=" /opt/gwi-pos/.env 2>/dev/null | cut -d= -f2- || echo "")
    fi

    if [[ -n "$REALVNC_EMAIL" ]] && [[ -n "$REALVNC_PASSWORD" ]]; then
      log "Signing in to RealVNC cloud..."
      # Timeout after 30s to prevent blocking the installer if RealVNC hangs
      if timeout 30 vncserver-x11 -service -login -email "$REALVNC_EMAIL" -password "$REALVNC_PASSWORD" 2>/dev/null; then
        log "Signed in to RealVNC cloud — device: $FRIENDLY_NAME"
      else
        warn "RealVNC auto-sign-in failed or timed out. Sign in manually via desktop icon."
      fi
    else
      log "No RealVNC credentials configured. Sign in manually via desktop icon."
      log "To auto-sign-in, set REALVNC_EMAIL and REALVNC_PASSWORD in /opt/gwi-pos/.env"
    fi

    # Desktop shortcut for RealVNC Server settings
    DESKTOP_DIR="$POSUSER_HOME/Desktop"
    mkdir -p "$DESKTOP_DIR"
    cat > "$DESKTOP_DIR/realvnc-server.desktop" <<RVNCEOF
[Desktop Entry]
Type=Application
Name=RealVNC Server — Sign In
Comment=Open RealVNC Server to sign in with your RealVNC Connect account
Exec=/usr/bin/vncserver-x11 -config
Icon=preferences-desktop-remote-desktop
Terminal=false
Categories=Network;RemoteAccess;
StartupNotify=true
RVNCEOF
    chown "$POSUSER":"$POSUSER" "$DESKTOP_DIR/realvnc-server.desktop"
    chmod +x "$DESKTOP_DIR/realvnc-server.desktop"
    if command -v gio >/dev/null 2>&1; then
      sudo -u "$POSUSER" gio set "$DESKTOP_DIR/realvnc-server.desktop" metadata::trusted true 2>/dev/null || true
    fi
  else
    warn "RealVNC Server not available. Use x11vnc for LAN access (port 5900)."
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # Desktop Launcher
  # ─────────────────────────────────────────────────────────────────────────────

  header "Creating Desktop Launcher"

  mkdir -p "$APP_BASE"

  # Clean old launchers before re-creating (prevents stale URLs after role switch)
  rm -f /usr/share/applications/gwi-pos.desktop 2>/dev/null || true
  rm -f "$POSUSER_HOME/Desktop/gwi-pos.desktop" 2>/dev/null || true

  POS_URL="http://localhost:3005"
  [[ "$STATION_ROLE" == "terminal" ]] && POS_URL="$SERVER_URL"

  # Reuse venue name from registration/RealVNC setup if available, else query POS, else default
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
    curl -fsSL "https://app.thepasspos.com/icon.svg" -o "$POS_ICON" 2>/dev/null || true
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
# GWI POS Launcher — opens the POS in fullscreen Chromium
$LAUNCHER_EXEC &
LSEOF
  chmod +x "$LAUNCHER_SCRIPT"
  chown "$POSUSER":"$POSUSER" "$LAUNCHER_SCRIPT"

  # Application menu entry (.desktop file)
  cat > /usr/share/applications/gwi-pos.desktop <<DTEOF
[Desktop Entry]
Type=Application
Name=GWI POS
Comment=Launch GWI POS — $LOCATION_NAME
Exec=$LAUNCHER_SCRIPT
Icon=$POS_ICON
Terminal=false
Categories=Office;Utility;
StartupNotify=true
DTEOF

  # Copy to user desktop (create Desktop dir if it doesn't exist — fresh Ubuntu installs)
  DESKTOP_DIR="$POSUSER_HOME/Desktop"
  mkdir -p "$DESKTOP_DIR"
  chown "$POSUSER":"$POSUSER" "$DESKTOP_DIR"
  cp /usr/share/applications/gwi-pos.desktop "$DESKTOP_DIR/"
  chown "$POSUSER":"$POSUSER" "$DESKTOP_DIR/gwi-pos.desktop"
  chmod +x "$DESKTOP_DIR/gwi-pos.desktop"

  # Mark as trusted — different desktops need different approaches
  # GNOME (Ubuntu): gio metadata::trusted
  if command -v gio >/dev/null 2>&1; then
    sudo -u "$POSUSER" gio set "$DESKTOP_DIR/gwi-pos.desktop" metadata::trusted true 2>/dev/null || true
  fi
  # KDE Plasma (Kubuntu): writes TryExec and marks executable — that's enough for KDE
  # KDE trusts .desktop files if they are executable + have valid Exec= line
  # No extra metadata needed — chmod +x (done above) is sufficient

  log "Desktop launcher created: $DESKTOP_DIR/gwi-pos.desktop"
  log "  Quick launch: $LAUNCHER_SCRIPT"

  # ─────────────────────────────────────────────────────────────────────────────
  # TeamViewer (backup remote access — server/backup roles only)
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

  log "Stage: remote_access — completed in $(( $(date +%s) - _start ))s"
  return 0
}
