#!/usr/bin/env bash
# =============================================================================
# 01-preflight.sh — OS checks, disk space, network, essential package install
# =============================================================================
# Entry: run_preflight
# Expects: APP_BASE, MC_URL set by orchestrator
# Sets: POSUSER, POSUSER_HOME, FREE_MB
# =============================================================================

run_preflight() {
  local _start=$(date +%s)
  log "Stage: preflight — starting"

  # ── Must be root ──
  if [[ $EUID -ne 0 ]]; then
    err "This installer must be run as root. Use: sudo bash installer.run"
    return 1
  fi

  # ── Must be Ubuntu 22.04+ ──
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]] || [[ "${VERSION_ID%%.*}" -lt 22 ]]; then
      err "GWI POS requires Ubuntu 22.04 or later. Detected: $PRETTY_NAME"
      return 1
    fi
    log "OS: $PRETTY_NAME"
  else
    err "Cannot detect OS. /etc/os-release not found."
    return 1
  fi

  # ── Resolve service user ──
  # Supports: --user <name> flag, SUDO_USER, or auto-detect UID 1000
  POSUSER=""
  local prev_arg=""
  for arg in "$@"; do
    if [[ "$prev_arg" == "--user" ]]; then POSUSER="$arg"; break; fi
    prev_arg="$arg"
  done

  if [[ -z "$POSUSER" ]]; then
    POSUSER="${SUDO_USER:-}"
  fi

  if [[ -z "$POSUSER" ]] || [[ "$POSUSER" == "root" ]]; then
    # Auto-detect: try UID 1000 first, then first user >=1000
    POSUSER=$(getent passwd 1000 | cut -d: -f1 || echo "")
    if [[ -z "$POSUSER" ]]; then
      POSUSER=$(awk -F: '$3>=1000 && $3<65534 && $7 !~ /nologin|false/ {print $1; exit}' /etc/passwd || echo "")
    fi
    if [[ -z "$POSUSER" ]]; then
      err "Cannot determine service user. No non-root users with UID >= 1000 found."
      err "Run with: sudo ./installer.run --user <username>"
      return 1
    fi
    warn "Auto-detected service user: $POSUSER"
    warn "If this is wrong, re-run with: --user <correct-username>"
  fi

  POSUSER_HOME=$(getent passwd "$POSUSER" | cut -d: -f6)
  if [[ ! -d "$POSUSER_HOME" ]]; then
    err "Home directory for '$POSUSER' does not exist: $POSUSER_HOME"
    err "Create the user first or specify a different one with --user <name>"
    return 1
  fi
  log "Service user: $POSUSER (home: $POSUSER_HOME)"

  # ── Disk Space Check — abort if less than 2GB free ──
  FREE_MB=$(df -BM /opt 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'M')
  if [[ -n "$FREE_MB" ]] && [[ "$FREE_MB" -lt 2000 ]]; then
    err "Insufficient disk space: ${FREE_MB}MB free, need at least 2000MB."
    err "Free up space before running the installer."
    return 1
  fi
  log "Disk space: ${FREE_MB}MB free — OK"

  # ── Install Essential Tools (BEFORE registration — jq and openssl required) ──
  header "Installing Essential Tools"

  apt-get update -y
  apt-get install -y curl git jq openssl ca-certificates gnupg chrony
  systemctl enable chrony 2>/dev/null || true
  systemctl start chrony 2>/dev/null || true

  log "Essential tools + NTP (chrony) installed."

  # ── Force X11 on GNOME (kiosk requires X11, Wayland not supported) ──
  # Must happen BEFORE Stage 7 creates kiosk services. On Ubuntu 24.04+, GDM3
  # defaults to Wayland which breaks Chromium kiosk in systemd.
  if [[ -f /etc/gdm3/custom.conf ]]; then
    if ! grep -q "WaylandEnable=false" /etc/gdm3/custom.conf 2>/dev/null; then
      log "Disabling Wayland in GDM3 (kiosk requires X11)..."
      # Add WaylandEnable=false under the [daemon] section
      if grep -q "\[daemon\]" /etc/gdm3/custom.conf; then
        sed -i '/\[daemon\]/a WaylandEnable=false' /etc/gdm3/custom.conf
      else
        echo -e "\n[daemon]\nWaylandEnable=false" >> /etc/gdm3/custom.conf
      fi
      log "Wayland disabled. X11 will be used on next login."
      track_warn "Wayland was disabled for X11 kiosk support. A reboot may be needed after install."
    else
      log "Wayland already disabled in GDM3 — OK."
    fi
  fi

  # ── Network check (after curl is guaranteed installed) ──
  log "Checking network connectivity..."
  if ! curl -fsS --max-time 10 "$MC_URL" >/dev/null 2>&1; then
    warn "Cannot reach Mission Control ($MC_URL). Checking general internet..."
    if ! curl -fsS --max-time 10 "https://google.com" >/dev/null 2>&1; then
      err "No internet connection. Connect to the network and try again."
      return 1
    fi
    warn "Internet is available but Mission Control is unreachable. Registration may fail."
  fi
  log "Network: OK"

  log "Stage: preflight — completed in $(( $(date +%s) - _start ))s"
  return 0
}
