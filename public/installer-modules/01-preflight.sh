#!/usr/bin/env bash
# =============================================================================
# 01-preflight.sh — OS checks, disk space, network, essential package install
# =============================================================================
# Entry: run_preflight
# Expects: APP_BASE, MC_URL set by orchestrator
# Sets: POSUSER, POSUSER_HOME, FREE_MB
# =============================================================================

# APT cache TTL — skip apt-get update if cache is fresh (< 1 hour)
apt_update_if_stale() {
    local stamp="/var/lib/apt/periodic/update-success-stamp"
    if [ -f "$stamp" ] && [ $(( $(date +%s) - $(stat -c %Y "$stamp" 2>/dev/null || echo 0) )) -lt 3600 ]; then
        log "APT cache is fresh — skipping apt-get update"
        return 0
    fi
    apt-get update -y
}

run_preflight() {
  local _start=$(date +%s)
  log "Stage: preflight — starting"

  # Ensure all apt operations are non-interactive (prevents dpkg dialog hangs)
  export DEBIAN_FRONTEND=noninteractive
  export DEBCONF_NONINTERACTIVE_SEEN=true

  # Load error codes library
  source "$(dirname "${BASH_SOURCE[0]}")/lib/error-codes.sh" 2>/dev/null || true

  # ── Must be root ──
  if [[ $EUID -ne 0 ]]; then
    err_code "ERR-INST-001" "EUID=$EUID"
    err "This installer must be run as root. Use: sudo bash installer.run"
    return 1
  fi

  # ── Must be Ubuntu 22.04+ ──
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]] || [[ "${VERSION_ID%%.*}" -lt 22 ]]; then
      err_code "ERR-INST-002" "Detected: $PRETTY_NAME"
      err "GWI POS requires Ubuntu 22.04 or later. Detected: $PRETTY_NAME"
      return 1
    fi
    log "OS: $PRETTY_NAME"
  else
    err_code "ERR-INST-002" "/etc/os-release not found"
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

  # ── Install Essential Tools (BEFORE registration — jq and openssl required) ──
  header "Installing Essential Tools"

  apt_update_if_stale
  apt-get install -y curl git jq openssl ca-certificates gnupg chrony axel
  systemctl enable chrony 2>/dev/null || true
  systemctl start chrony 2>/dev/null || true

  log "Essential tools + NTP (chrony) installed."

  # ── Phase 5A: Security updates (fresh install only) ───────────────────────
  # Apply security-only patches. SmartTab does this; we now do too.
  # Only on fresh install — routine deploys skip this.
  if [[ ! -f "$APP_BASE/shared/state/.security-updates-applied" ]]; then
    log "Applying security updates (first-time only)..."
    apt_update_if_stale
    if DEBIAN_FRONTEND=noninteractive apt-get -y dist-upgrade -t "$(lsb_release -cs)-security" 2>&1 | tail -5; then
      mkdir -p "$APP_BASE/shared/state"
      date -u +%FT%TZ > "$APP_BASE/shared/state/.security-updates-applied"
      log "Security updates applied"
      if [ -f /var/run/reboot-required ]; then
        warn "Kernel security patches require reboot"
        track_warn "Security patches applied — reboot required after install"
      fi
    else
      warn "Security updates failed (non-fatal) — continuing installation"
    fi
  fi

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
      err_code "ERR-INST-004" "No internet connectivity (google.com unreachable)"
      err "No internet connection. Connect to the network and try again."
      return 1
    fi
    warn "Internet is available but Mission Control is unreachable. Registration may fail."
  fi
  log "Network: OK"

  # ── DNS resolution (hard fail) ──
  log "Checking DNS resolution..."
  for host in github.com registry.npmjs.org; do
    if ! host "$host" >/dev/null 2>&1 && ! nslookup "$host" >/dev/null 2>&1; then
      err_code "ERR-INST-004" "DNS resolution failed for $host"
      err "DNS resolution failed for $host — check network/DNS configuration"
      return 1
    fi
  done
  log "DNS: OK"

  # ── Disk space — 8GB minimum (hard fail) ──
  # If APP_BASE doesn't exist yet (fresh install), check parent mount point
  local DISK_CHECK_PATH="$APP_BASE"
  if [[ ! -d "$DISK_CHECK_PATH" ]]; then
    DISK_CHECK_PATH=$(dirname "$APP_BASE")
    [[ ! -d "$DISK_CHECK_PATH" ]] && DISK_CHECK_PATH="/"
  fi
  local AVAIL_KB
  AVAIL_KB=$(df -k "$DISK_CHECK_PATH" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
  if [[ "$AVAIL_KB" -lt 8000000 ]]; then
    err_code "ERR-INST-003" "$(( AVAIL_KB / 1024 ))MB free on $APP_BASE, need 8GB"
    err "Insufficient disk: $(( AVAIL_KB / 1024 )) MB free (need 8 GB)"
    return 1
  fi
  log "Disk space: $(( AVAIL_KB / 1024 )) MB free — OK (8 GB minimum)"

  # ── System clock sanity — TLS and token validation fail with bad clocks (hard fail) ──
  if command -v timedatectl >/dev/null 2>&1; then
    local clock_synced
    clock_synced=$(timedatectl show --property=NTPSynchronized --value 2>/dev/null || echo "no")
    if [[ "$clock_synced" != "yes" ]]; then
      # Check if clock is within 5 minutes of reality
      local remote_time
      remote_time=$(curl -sI https://google.com 2>/dev/null | grep -i "^date:" | cut -d' ' -f2- || echo "")
      if [[ -n "$remote_time" ]]; then
        local remote_epoch
        remote_epoch=$(date -d "$remote_time" +%s 2>/dev/null || echo 0)
        local local_epoch
        local_epoch=$(date +%s)
        local drift=$(( local_epoch - remote_epoch ))
        if [[ ${drift#-} -gt 300 ]]; then
          err_code "ERR-INST-005" "Clock drift ${drift}s, NTP not synced"
          err "System clock off by ${drift}s — NTP not synced. TLS/tokens will fail."
          err "Run: sudo timedatectl set-ntp true"
          return 1
        fi
      fi
      warn "NTP not synced (clock may drift)"
    fi
  fi

  # ── Memory floor (hard fail) ──
  local mem_mb
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  if [[ "$mem_mb" -lt 2048 ]]; then
    err_code "ERR-INST-006" "${mem_mb}MB detected, need 2048MB"
    err "Insufficient memory: ${mem_mb}MB (need 2048MB minimum for build)"
    return 1
  fi
  log "Memory: ${mem_mb}MB — OK"

  # ── Role validation — early fail-fast ──
  if [[ -f "$APP_BASE/config/role.conf" ]]; then
    local _role
    _role=$(cat "$APP_BASE/config/role.conf" 2>/dev/null || echo "")
    case "$_role" in
      server|terminal|backup|"") ;; # empty is OK on fresh install
      *) err_code "ERR-INST-010" "role='$_role' in $APP_BASE/config/role.conf"; err "Invalid role '$_role' in $APP_BASE/config/role.conf"; return 1 ;;
    esac
  fi

  # ── Warn-only checks ──

  # Network quality (warn, don't block)
  local latency
  latency=$(ping -c 1 -W 3 github.com 2>/dev/null | grep "time=" | sed 's/.*time=\([0-9.]*\).*/\1/' || echo "999")
  if (( $(echo "$latency > 500" | bc -l 2>/dev/null || echo 1) )); then
    warn "High latency to GitHub (${latency}ms) — install may be slow"
  fi

  # Port availability
  for port in 3005 5432; do
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
      warn "Port $port already in use — may conflict"
    fi
  done

  log "Stage: preflight — completed in $(( $(date +%s) - _start ))s"
  return 0
}
