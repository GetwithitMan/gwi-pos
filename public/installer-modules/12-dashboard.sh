#!/usr/bin/env bash
# =============================================================================
# 12-dashboard.sh — Stage 12: GWI NUC Dashboard Installation
# =============================================================================
# Entry: run_dashboard
# Expects: APP_BASE, APP_DIR, POSUSER, STATION_ROLE
# Uses:    header(), log(), warn(), err(), track_warn(), start_timer(), end_timer()
#
# Installs the GWI NUC Dashboard .deb package and configures autostart.
# The dashboard is optional — if the .deb is not found, the stage succeeds
# with a warning. Only installed on server and backup roles (terminals don't
# need a dashboard).
# =============================================================================

run_dashboard() {
  start_timer
  header "Stage 12: GWI NUC Dashboard"

  # ─────────────────────────────────────────────────────────────────────────
  # Skip on terminal role — dashboard is only for server/backup NUCs
  # ─────────────────────────────────────────────────────────────────────────
  if [[ "$STATION_ROLE" == "terminal" ]]; then
    log "Skipping dashboard install — not needed for terminal role"
    end_timer "Stage 12 (dashboard)"
    return 0
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Locate the .deb package
  # ─────────────────────────────────────────────────────────────────────────
  local DASHBOARD_DEB=""

  local SEARCH_PATHS=(
    "$APP_BASE/dashboard"
    "$APP_DIR/packaging"
    "$APP_DIR/dashboard"
    "$(dirname "$0")"
  )

  for dir in "${SEARCH_PATHS[@]}"; do
    if [[ ! -d "$dir" ]]; then
      continue
    fi
    local found
    found=$(find "$dir" -maxdepth 2 -name "gwi-nuc-dashboard*.deb" -type f 2>/dev/null | sort -V | tail -1)
    if [[ -n "$found" ]]; then
      DASHBOARD_DEB="$found"
      break
    fi
  done

  if [[ -z "$DASHBOARD_DEB" ]]; then
    track_warn "Dashboard .deb not found — skipping (can be installed later via: sudo dpkg -i gwi-nuc-dashboard_*.deb)"
    end_timer "Stage 12 (dashboard)"
    return 0  # Non-fatal: dashboard is optional
  fi

  log "Found dashboard package: ${DASHBOARD_DEB}"

  # ─────────────────────────────────────────────────────────────────────────
  # Install dependencies
  # ─────────────────────────────────────────────────────────────────────────
  log "Installing dashboard dependencies..."
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq libwebkit2gtk-4.1-0 libappindicator3-1 libgtk-3-0 2>/dev/null || {
    track_warn "Some dashboard dependencies failed to install — dashboard may not start"
  }

  # ─────────────────────────────────────────────────────────────────────────
  # Install the .deb
  # ─────────────────────────────────────────────────────────────────────────
  log "Installing dashboard .deb..."
  if ! dpkg -i "$DASHBOARD_DEB" 2>/dev/null; then
    warn "dpkg install failed, attempting dependency fix..."
    apt-get install -f -y -qq 2>/dev/null || true
    if ! dpkg -i "$DASHBOARD_DEB" 2>/dev/null; then
      track_warn "Dashboard .deb installation failed — can be retried manually"
      end_timer "Stage 12 (dashboard)"
      return 0  # Non-fatal: dashboard is optional
    fi
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Verify binary exists
  # ─────────────────────────────────────────────────────────────────────────
  if command -v gwi-nuc-dashboard >/dev/null 2>&1; then
    log "Dashboard binary verified: $(which gwi-nuc-dashboard)"
  else
    track_warn "Dashboard binary not found in PATH after install"
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Set up autostart (for all users via /etc/xdg/autostart)
  # ─────────────────────────────────────────────────────────────────────────
  local AUTOSTART_DIR="/etc/xdg/autostart"
  if [[ -d "$AUTOSTART_DIR" ]]; then
    cat > "${AUTOSTART_DIR}/gwi-dashboard-autostart.desktop" << 'DESKTOP'
[Desktop Entry]
Name=GWI NUC Dashboard
Comment=Auto-start GWI system dashboard
Exec=gwi-nuc-dashboard
Type=Application
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=10
Hidden=false
NoDisplay=false
DESKTOP
    chmod 644 "${AUTOSTART_DIR}/gwi-dashboard-autostart.desktop"
    log "Autostart entry created at ${AUTOSTART_DIR}/gwi-dashboard-autostart.desktop"
  else
    track_warn "Autostart directory ${AUTOSTART_DIR} not found — dashboard won't auto-start"
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Add sudoers rules for service restarts (if not already present)
  # ─────────────────────────────────────────────────────────────────────────
  local SUDOERS_FILE="/etc/sudoers.d/gwi-dashboard"
  if [[ ! -f "$SUDOERS_FILE" ]]; then
    cat > "$SUDOERS_FILE" << SUDOERS
# GWI NUC Dashboard — allow service restarts without password
${POSUSER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart thepasspos
${POSUSER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart thepasspos-kiosk
${POSUSER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart thepasspos-sync
${POSUSER} ALL=(root) NOPASSWD: /usr/bin/systemctl restart postgresql
SUDOERS
    chmod 440 "$SUDOERS_FILE"
    log "Sudoers rules installed at ${SUDOERS_FILE}"
  else
    log "Sudoers rules already present at ${SUDOERS_FILE}"
  fi

  end_timer "Stage 12 (dashboard)"
  return 0
}
