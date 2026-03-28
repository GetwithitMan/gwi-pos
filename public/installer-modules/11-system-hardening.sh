#!/usr/bin/env bash
# =============================================================================
# 11-system-hardening.sh -- Stage 11: System Hardening
# =============================================================================
# Entry: run_system_hardening
# Expects: APP_BASE, APP_DIR, ENV_FILE, POSUSER, STATION_ROLE, SERVER_NODE_ID
# Uses:    header(), log(), warn(), err(), track_warn(), start_timer(), end_timer()
#
# Two-layer approach:
#   1. _apply_critical_hardening_direct() -- ALWAYS runs. Disables screen sleep,
#      DPMS, screensavers, and notification nags via direct systemd/xset/Xorg.
#   2. Ansible baseline (optional) -- if installer/site.yml exists, bootstraps a
#      pinned Ansible venv and runs the versioned playbook for full enforcement.
#
# Environment overrides (Ansible path only):
#   HARDENING_TAGS       -- Ansible --tags filter (e.g. "firewall,sshd_hardening")
#   SKIP_HARDENING_TAGS  -- Ansible --skip-tags filter (e.g. "branding,optional")
#   HARDENING_DRY_RUN    -- Set to "true" for check mode (--check)
# =============================================================================

run_system_hardening() {
  start_timer
  header "Stage 11: System Hardening"

  # ─────────────────────────────────────────────────────────────────────────
  # Constants
  # ─────────────────────────────────────────────────────────────────────────
  local STATE_DIR="$APP_BASE/state"
  local LOCK_FILE="$STATE_DIR/baseline.lock"
  local RUN_STATE_FILE="$STATE_DIR/run-state.json"
  local RESULT_FILE="$STATE_DIR/stage11-result.json"
  local ANSIBLE_RESULT_FILE="$STATE_DIR/ansible-result.json"
  local ANSIBLE_STDERR_FILE="$STATE_DIR/ansible-stderr.log"
  local EVENTS_FILE="$STATE_DIR/install-events.jsonl"
  local ANSIBLE_DIR="$APP_DIR/installer"
  local SITE_YML="$ANSIBLE_DIR/site.yml"
  local VERSION_FILE="$ANSIBLE_DIR/VERSION"
  local VENV_DIR="$APP_BASE/.ansible-venv"
  local ANSIBLE_BIN="$VENV_DIR/bin/ansible-playbook"
  # Full ansible package version (includes json callback + community collections)
  # ansible 11.x bundles ansible-core 2.18.x; ansible 10.x bundles ansible-core 2.17.x
  local PINNED_ANSIBLE_VERSION="10.7.0"
  local TRIGGERED_BY="installer"
  local RUN_START
  RUN_START=$(date +%s)

  # ─────────────────────────────────────────────────────────────────────────
  # Helpers
  # ─────────────────────────────────────────────────────────────────────────

  # ISO 8601 UTC timestamp
  _iso_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

  # Read baseline version from VERSION file
  _read_baseline_version() {
    if [[ -f "$VERSION_FILE" ]]; then
      cat "$VERSION_FILE" | tr -d '[:space:]'
    else
      echo "unknown"
    fi
  }

  # Read SERVER_NODE_ID from .env if not already set
  _read_node_id() {
    if [[ -n "${SERVER_NODE_ID:-}" ]]; then
      echo "$SERVER_NODE_ID"
      return
    fi
    if [[ -f "$ENV_FILE" ]]; then
      grep -m1 '^SERVER_NODE_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo ""
    else
      echo ""
    fi
  }

  # Write run-state.json
  _write_run_state() {
    local state="$1"
    local extra="${2:-}"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)
    local boot_id=""
    if [[ -f /proc/sys/kernel/random/boot_id ]]; then
      boot_id=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "")
    fi

    cat > "$RUN_STATE_FILE" <<RUNSTATE_EOF
{
  "schema_version": "1.0",
  "producer": "11-system-hardening.sh",
  "generated_at": "$(_iso_now)",
  "node_id": "$node_id",
  "baseline_version": "$baseline_version",
  "state": "$state",
  "pid": $$,
  "started_at": "$(_iso_now)",
  "triggered_by": "$TRIGGERED_BY",
  "host_boot_id": "$boot_id"${extra:+,
  $extra}
}
RUNSTATE_EOF
  }

  # Write stage11-result.json
  _write_result() {
    local outcome="$1"
    local ansible_exit="$2"
    local duration="$3"
    local changed_count="${4:-0}"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)

    cat > "$RESULT_FILE" <<RESULT_EOF
{
  "schema_version": "1.0",
  "producer": "11-system-hardening.sh",
  "generated_at": "$(_iso_now)",
  "node_id": "$node_id",
  "baseline_version": "$baseline_version",
  "outcome": "$outcome",
  "ansible_exit_code": $ansible_exit,
  "duration_seconds": $duration,
  "changed_count": $changed_count,
  "failed_tasks": [],
  "optional_warnings": [],
  "triggered_by": "$TRIGGERED_BY"
}
RESULT_EOF
  }

  # Append event to install-events.jsonl
  _write_event() {
    local event_type="$1"
    local outcome="$2"
    local ansible_exit="$3"
    local duration="$4"
    local node_id
    node_id=$(_read_node_id)
    local baseline_version
    baseline_version=$(_read_baseline_version)

    echo "{\"schema_version\":\"1.0\",\"producer\":\"11-system-hardening.sh\",\"generated_at\":\"$(_iso_now)\",\"node_id\":\"$node_id\",\"baseline_version\":\"$baseline_version\",\"event\":\"$event_type\",\"outcome\":\"$outcome\",\"ansible_exit_code\":$ansible_exit,\"duration_seconds\":$duration,\"triggered_by\":\"$TRIGGERED_BY\"}" >> "$EVENTS_FILE"
  }

  # Extract changed count from ansible-result.json stats
  # Returns: integer (0 if unavailable)
  _extract_changed_count() {
    local result_file="$1"
    if [[ ! -f "$result_file" ]] || [[ ! -s "$result_file" ]]; then
      echo "0"
      return
    fi
    local count
    count=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    total = sum(h.get('changed', 0) for h in data.get('stats', {}).values())
    print(total)
except Exception:
    print(0)
" "$result_file" 2>/dev/null)
    echo "${count:-0}"
  }

  # Parse ansible-result.json to classify outcome
  # Returns: success | success_with_warnings | failed_required | skipped_unavailable
  _classify_outcome() {
    local result_file="$1"
    local exit_code="$2"

    # If ansible never ran or produced no output
    if [[ ! -f "$result_file" ]] || [[ ! -s "$result_file" ]]; then
      if [[ "$exit_code" -eq 0 ]]; then
        echo "success"
      else
        echo "failed_required"
      fi
      return
    fi

    # Validate JSON before parsing
    if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$result_file" 2>/dev/null; then
      warn "ansible-result.json is not valid JSON -- classifying as failed"
      echo "failed_required"
      return
    fi

    # Parse the JSON callback output for failure/unreachable counts
    local parse_result
    parse_result=$(python3 -c "
import json, sys

try:
    with open(sys.argv[1]) as f:
        data = json.load(f)

    stats = data.get('stats', {})
    has_failures = False
    has_unreachable = False
    has_ignored = False

    for host, host_stats in stats.items():
        if host_stats.get('failures', 0) > 0:
            has_failures = True
        if host_stats.get('unreachable', 0) > 0:
            has_unreachable = True
        if host_stats.get('ignored', 0) > 0:
            has_ignored = True

    if has_failures or has_unreachable:
        print('failed_required')
    elif has_ignored:
        print('success_with_warnings')
    else:
        print('success')
except Exception as e:
    print('failed_required')
" "$result_file" 2>/dev/null)

    echo "${parse_result:-failed_required}"
  }

  # ─────────────────────────────────────────────────────────────────────────
  # Create state directory
  # ─────────────────────────────────────────────────────────────────────────
  mkdir -p "$STATE_DIR"
  chmod 755 "$STATE_DIR"

  # ─────────────────────────────────────────────────────────────────────────
  # Direct hardening fallback -- defined early so early-return paths can call it.
  # These are the critical settings that must be applied on every NUC.
  # ─────────────────────────────────────────────────────────────────────────
  _apply_critical_hardening_direct() {
    log "Applying critical hardening (direct, no Ansible dependency)..."

    # Screen sleep prevention -- mask all sleep/suspend targets
    systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true

    # logind: no idle action, ignore lid/power keys
    mkdir -p /etc/systemd/logind.conf.d
    cat > /etc/systemd/logind.conf.d/gwi-no-sleep.conf <<'LOGIND_CONF'
[Login]
IdleAction=ignore
IdleActionSec=0
HandleLidSwitch=ignore
HandlePowerKey=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
LOGIND_CONF
    systemctl restart systemd-logind 2>/dev/null || true

    # Mask screensaver services
    for svc in xscreensaver gnome-screensaver light-locker; do
      systemctl mask "$svc.service" 2>/dev/null || true
    done

    # ── Phase 5B: Complete auto-update suppression ────────────────────────────
    log "Suppressing ALL auto-update mechanisms..."

    # Mask apt-daily timers (with retry)
    for svc in apt-daily.timer apt-daily.service apt-daily-upgrade.timer apt-daily-upgrade.service; do
        systemctl stop "$svc" 2>/dev/null || true
        systemctl disable "$svc" 2>/dev/null || true
        systemctl mask "$svc" 2>/dev/null || true
    done

    # Authoritative APT periodic config
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APTEOF'
APT::Periodic::Enable "0";
APT::Periodic::Update-Package-Lists "0";
APT::Periodic::Unattended-Upgrade "0";
APT::Periodic::Download-Upgradeable-Packages "0";
APT::Periodic::AutocleanInterval "0";
APTEOF

    # Remove update GUI/daemon packages
    DEBIAN_FRONTEND=noninteractive apt-get remove -y \
        plasma-discover plasma-discover-notifier \
        plasma-discover-backend-flatpak plasma-discover-backend-snap \
        packagekit apport apport-gtk whoopsie popularity-contest 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true

    # Suppress release upgrade prompts
    if [ -f /etc/update-manager/release-upgrades ]; then
        sed -i 's/^Prompt=.*/Prompt=never/' /etc/update-manager/release-upgrades
    fi

    # Disable apport permanently
    echo "enabled=0" > /etc/default/apport 2>/dev/null || true

    log "Auto-update suppression complete"

    # ── Phase 5E: PowerDevil masking ──────────────────────────────────────────
    # KDE's power management daemon can override systemd sleep target masking.
    # Use BOTH config file (works without user session) AND service masking.
    log "Disabling PowerDevil..."
    if [ -n "$POSUSER" ] && [ -d "/home/$POSUSER" ]; then
        mkdir -p "/home/$POSUSER/.config"
        cat > "/home/$POSUSER/.config/powerdevilrc" <<'PDEOF'
[AC][SuspendAndShutdown]
AutoSuspendAction=0
AutoSuspendIdleTimeoutSec=0
PowerButtonAction=0

[Battery][SuspendAndShutdown]
AutoSuspendAction=0
AutoSuspendIdleTimeoutSec=0
PowerButtonAction=0
PDEOF
        chown "$POSUSER:$POSUSER" "/home/$POSUSER/.config/powerdevilrc"
    fi
    # Also try service masking (may fail if no session -- that's OK, config file is the primary)
    if sudo -u "$POSUSER" systemctl --user status plasma-powerdevil.service &>/dev/null 2>&1; then
        sudo -u "$POSUSER" systemctl --user mask --now plasma-powerdevil.service 2>/dev/null || true
        log "PowerDevil service masked"
    else
        log "PowerDevil service not found (config file approach used instead)"
    fi

    # X11 DPMS off for all future sessions
    if [[ -n "$POSUSER" ]]; then
      local home_dir
      home_dir=$(eval echo "~$POSUSER")
      cat > "$home_dir/.xsessionrc" <<'XSRC'
#!/bin/bash
xset s off -dpms 2>/dev/null || true
xset s noblank 2>/dev/null || true
xset dpms 0 0 0 2>/dev/null || true
XSRC
      chmod +x "$home_dir/.xsessionrc"
      chown "$POSUSER:$POSUSER" "$home_dir/.xsessionrc"

      # Apply DPMS off NOW if X11 is running and accepting connections
      if [[ -S /tmp/.X11-unix/X0 ]] && sudo -u "$POSUSER" DISPLAY=:0 xset q &>/dev/null; then
        sudo -u "$POSUSER" DISPLAY=:0 xset s off -dpms 2>/dev/null || true
        sudo -u "$POSUSER" DISPLAY=:0 xset s noblank 2>/dev/null || true
        sudo -u "$POSUSER" DISPLAY=:0 xset dpms 0 0 0 2>/dev/null || true
        log "  xset DPMS-off applied to live X11 session"
      fi

      # GNOME settings -- requires both gsettings binary and a live DBUS session bus
      local _uid_posuser
      _uid_posuser=$(id -u "$POSUSER" 2>/dev/null || echo "")
      local _dbus_path="/run/user/${_uid_posuser}/bus"
      if command -v gsettings &>/dev/null && [[ -n "$_uid_posuser" ]] && [[ -S "$_dbus_path" ]]; then
        local dbus="unix:path=$_dbus_path"
        sudo -u "$POSUSER" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$dbus" gsettings set org.gnome.desktop.session idle-delay 0 2>/dev/null || true
        sudo -u "$POSUSER" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$dbus" gsettings set org.gnome.desktop.screensaver lock-enabled false 2>/dev/null || true
        sudo -u "$POSUSER" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$dbus" gsettings set org.gnome.desktop.screensaver lock-delay 0 2>/dev/null || true
        sudo -u "$POSUSER" DISPLAY=:0 DBUS_SESSION_BUS_ADDRESS="$dbus" gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type "nothing" 2>/dev/null || true
        log "  GNOME idle/screensaver settings applied"
      fi

      # ── Phase 5F: Plasma version detection + read-before-write ────────────────
      detect_plasma_version() {
          local ver
          ver=$(plasmashell --version 2>/dev/null | awk '{print $2}')
          case "$ver" in
              5.*) KREAD="kreadconfig5"; KWRITE="kwriteconfig5" ;;
              6.*) KREAD="kreadconfig6"; KWRITE="kwriteconfig6" ;;
              *)   KREAD="kreadconfig5"; KWRITE="kwriteconfig5" ;;  # fallback
          esac
          log "Plasma version: ${ver:-unknown} (using $KWRITE)"
      }

      kde_set_if_different() {
          local file="$1" group="$2" key="$3" value="$4"
          if ! command -v "$KREAD" &>/dev/null; then return 0; fi
          local current
          current=$("$KREAD" --file "$file" --group "$group" --key "$key" 2>/dev/null) || true
          if [ "$current" != "$value" ]; then
              sudo -u "$POSUSER" "$KWRITE" --file "$file" --group "$group" --key "$key" "$value" 2>/dev/null || true
              log "  KDE: $file [$group] $key = $value (was: ${current:-unset})"
          fi
      }

      detect_plasma_version
      kde_set_if_different kscreenlockerrc Daemon Autolock false
      kde_set_if_different kscreenlockerrc Daemon Timeout 0
      kde_set_if_different kscreenlockerrc Daemon LockOnResume false
      kde_set_if_different ksmserverrc General loginMode emptySession

      # Kill the running lock screen -- config only takes effect on next session start
      loginctl unlock-sessions 2>/dev/null || true
      pkill -9 kscreenlocker_greet 2>/dev/null || true

      # Xorg server-level DPMS disable (cannot be overridden by ANY desktop environment)
      mkdir -p /etc/X11/xorg.conf.d
      cat > /etc/X11/xorg.conf.d/10-no-dpms.conf <<'XORGCONF'
Section "ServerFlags"
    Option "StandbyTime" "0"
    Option "SuspendTime" "0"
    Option "OffTime" "0"
    Option "BlankTime" "0"
    Option "DPMS" "false"
EndSection

Section "Monitor"
    Identifier "Monitor0"
    Option "DPMS" "false"
EndSection
XORGCONF
      log "  Xorg DPMS disabled at server level"

      # Keep-awake timer -- runs xset every 60s as ultimate safety net
      cat > /etc/systemd/user/gwi-keep-awake.service <<'KASVC'
[Unit]
Description=GWI POS Keep Screen Awake
After=graphical-session.target
[Service]
Type=oneshot
Environment=DISPLAY=:0
ExecStart=/bin/bash -c "if xset q &>/dev/null; then xset -dpms; xset s off; xset s noblank; fi"
KASVC
      cat > /etc/systemd/user/gwi-keep-awake.timer <<'KATMR'
[Unit]
Description=GWI POS Keep Screen Awake Timer
After=graphical-session.target
[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
[Install]
WantedBy=timers.target
KATMR
      sudo -u "$POSUSER" systemctl --user daemon-reload 2>/dev/null || true
      sudo -u "$POSUSER" systemctl --user enable gwi-keep-awake.timer 2>/dev/null || true
      sudo -u "$POSUSER" systemctl --user start gwi-keep-awake.timer 2>/dev/null || true
      log "  Keep-awake timer installed (xset every 60s)"
    fi

    # Remove notification nags (non-fatal)
    apt-get remove -y update-notifier update-manager gnome-software 2>/dev/null || true

    # ── Phase 5G: Touchscreen detection (best-effort, never blocks install) ───
    detect_touchscreen() {
        grep -q ID_INPUT_TOUCHSCREEN=1 /sys/class/input/event*/device/uevent 2>/dev/null && return 0
        command -v libinput &>/dev/null && libinput list-devices 2>/dev/null | grep -q 'Capabilities:.*touch' && return 0
        return 1
    }

    if detect_touchscreen; then
        log "Touchscreen detected -- configuring..."
        # Install on-screen keyboard
        DEBIAN_FRONTEND=noninteractive apt-get install -y onboard 2>/dev/null || warn "Onboard keyboard install failed (non-fatal)"
        # Disable right-click emulation on touchscreen
        mkdir -p /etc/libinput
        cat > /etc/libinput/local-overrides.quirks <<'TOUCHEOF'
[Disable right-click on touchscreens]
MatchUdevType=touchscreen
AttrEventCodeDisable=BTN_RIGHT
TOUCHEOF
        udevadm control --reload-rules 2>/dev/null || true
        log "Touchscreen: on-screen keyboard installed, right-click disabled"
    else
        log "No touchscreen detected -- skipping touch configuration"
    fi

    # ── SDDM auto-login (server/backup only -- no login screen on POS NUCs) ──
    if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
      if command -v sddm &>/dev/null || systemctl is-active sddm &>/dev/null 2>&1; then
        mkdir -p /etc/sddm.conf.d
        # Detect available session file
        local _session="plasma.desktop"
        if [[ -f /usr/share/xsessions/plasma.desktop ]]; then
          _session="plasma.desktop"
        elif ls /usr/share/xsessions/*.desktop &>/dev/null; then
          _session="$(ls /usr/share/xsessions/*.desktop | head -1 | xargs basename)"
        fi
        cat > /etc/sddm.conf.d/autologin.conf << SDDMEOF
[Autologin]
User=${POSUSER}
Session=${_session}
SDDMEOF
        # ALWAYS write /etc/sddm.conf — it takes precedence over sddm.conf.d.
        # On fresh Kubuntu, sddm.conf may have Session=plasma (no .desktop)
        # which overrides our correct conf.d entry. Write it unconditionally.
        cat > /etc/sddm.conf << SDDMCONFEOF
[Autologin]
User=${POSUSER}
Session=${_session}
SDDMCONFEOF
        log "Written /etc/sddm.conf autologin (Session=${_session})"
        log "SDDM auto-login configured (user=${POSUSER}, session=${_session})"
      elif command -v gdm3 &>/dev/null || systemctl is-active gdm3 &>/dev/null 2>&1; then
        # GDM auto-login
        mkdir -p /etc/gdm3
        sed -i '/^\[daemon\]/,/^\[/{s/^AutomaticLoginEnable=.*/AutomaticLoginEnable=true/;s/^AutomaticLogin=.*/AutomaticLogin='"$POSUSER"'/}' /etc/gdm3/custom.conf 2>/dev/null || {
          cat >> /etc/gdm3/custom.conf << GDMEOF

[daemon]
AutomaticLoginEnable=true
AutomaticLogin=${POSUSER}
GDMEOF
        }
        log "GDM auto-login configured (user=${POSUSER})"
      fi
    fi

    log "Critical hardening applied (screen never sleeps, no notifications, auto-login)"
  }

  # ─────────────────────────────────────────────────────────────────────────
  # Check for site.yml existence -- graceful skip if baseline not yet shipped
  # ─────────────────────────────────────────────────────────────────────────
  if [[ ! -f "$SITE_YML" ]]; then
    log "Ansible baseline not found at $SITE_YML"

    # Determine if this is expected (pre-baseline node) or an error
    if [[ -f "$VERSION_FILE" ]]; then
      # VERSION exists but site.yml missing -- something is broken
      warn "installer/VERSION exists but site.yml is missing -- baseline incomplete"
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: baseline files incomplete (site.yml missing)"
    else
      # No baseline files at all -- pre-baseline node, clean skip
      log "No baseline files present -- skipping system hardening (pre-baseline node)"
      _write_result "skipped_unavailable" 0 0
      _write_event "baseline_run" "skipped_unavailable" 0 0
    fi

    # Direct hardening ALWAYS runs -- screen/sleep prevention is too critical
    _apply_critical_hardening_direct

    end_timer "Stage 11: System Hardening"
    return 0
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Bootstrap Ansible in a pinned virtualenv
  # ─────────────────────────────────────────────────────────────────────────
  if [[ ! -x "$ANSIBLE_BIN" ]]; then
    log "Bootstrapping Ansible $PINNED_ANSIBLE_VERSION in virtualenv..."

    # Ensure python3-venv is available (required for Ansible venv)
    if ! python3 -m venv --help >/dev/null 2>&1; then
      log "Installing python3-venv..."
      apt-get update -qq >/dev/null 2>&1 || true
      local PY_VERSION
      PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "3")
      # Try version-specific package first, then generic fallback
      if ! apt-get install -y -qq "python${PY_VERSION}-venv" >/dev/null 2>&1; then
        if ! apt-get install -y -qq python3-venv >/dev/null 2>&1; then
          warn "Failed to install python3-venv -- cannot bootstrap Ansible"
          _apply_critical_hardening_direct
          _write_run_state "degraded"
          _write_result "failed_required" 1 0
          _write_event "baseline_run" "failed_required" 1 0
          track_warn "System hardening: python3-venv installation failed"
          end_timer "Stage 11: System Hardening"
          return 0
        fi
      fi
      # Verify the module actually works now
      if ! python3 -m venv --help >/dev/null 2>&1; then
        warn "python3-venv installed but module still not available"
        _apply_critical_hardening_direct
        _write_run_state "degraded"
        _write_result "failed_required" 1 0
        _write_event "baseline_run" "failed_required" 1 0
        track_warn "System hardening: python3-venv module not functional after install"
        end_timer "Stage 11: System Hardening"
        return 0
      fi
      log "python3-venv installed successfully (Python ${PY_VERSION})"
    fi

    # Create venv and install pinned ansible
    if ! python3 -m venv "$VENV_DIR" 2>/dev/null; then
      warn "Failed to create Python virtualenv at $VENV_DIR"
      _apply_critical_hardening_direct
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: virtualenv creation failed"
      end_timer "Stage 11: System Hardening"
      return 0
    fi

    "$VENV_DIR/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1
    # Install full ansible (not just ansible-core) -- includes json callback plugin
    if ! { "$VENV_DIR/bin/pip" install --quiet "ansible==$PINNED_ANSIBLE_VERSION" >/dev/null 2>&1 \
      || "$VENV_DIR/bin/pip" install --quiet "ansible" >/dev/null 2>&1; }; then
      warn "Failed to install ansible==$PINNED_ANSIBLE_VERSION"
      _apply_critical_hardening_direct
      _write_run_state "degraded"
      _write_result "failed_required" 1 0
      _write_event "baseline_run" "failed_required" 1 0
      track_warn "System hardening: ansible installation failed"
      end_timer "Stage 11: System Hardening"
      return 0
    fi

    log "Ansible bootstrapped: $("$ANSIBLE_BIN" --version 2>/dev/null | head -1)"
  else
    # Verify pinned version matches
    local installed_version
    installed_version=$("$VENV_DIR/bin/ansible" --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
    if [[ "$installed_version" != "$PINNED_ANSIBLE_VERSION" ]]; then
      log "Ansible version mismatch (have $installed_version, want $PINNED_ANSIBLE_VERSION) -- upgrading..."
      "$VENV_DIR/bin/pip" install --quiet "ansible==$PINNED_ANSIBLE_VERSION" >/dev/null 2>&1
    fi
  fi

  # Final check that ansible-playbook binary works
  if [[ ! -x "$ANSIBLE_BIN" ]]; then
    warn "Ansible installation failed -- ansible-playbook not found at $ANSIBLE_BIN"
    warn "Falling back to direct hardening only (critical settings will still be applied)"
    _write_run_state "degraded"
    _write_result "failed_required" 1 0
    _write_event "baseline_run" "failed_required" 1 0
    track_warn "System hardening: ansible-playbook binary not executable -- direct fallback only"
    # Still apply critical hardening directly (screen sleep, notifications, etc.)
    _apply_critical_hardening_direct
    end_timer "Stage 11: System Hardening"
    return 0
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Resolve variables for Ansible extra-vars
  # ─────────────────────────────────────────────────────────────────────────
  local _posuser="${POSUSER:-gwipos}"
  local _station_role="${STATION_ROLE:-server}"

  # ─────────────────────────────────────────────────────────────────────────
  # Acquire execution lock via flock
  # ─────────────────────────────────────────────────────────────────────────
  log "Acquiring baseline execution lock..."

  # Create lock file parent if needed (state dir already created above)
  touch "$LOCK_FILE"

  # Open lock fd for the remainder of the subshell
  exec 9>"$LOCK_FILE"

  if ! flock -w 300 9; then
    warn "Could not acquire baseline lock within 300 seconds -- another baseline run may be in progress"
    _apply_critical_hardening_direct
    _write_run_state "idle" "\"lock_wait_timeout\": true"
    _write_result "failed_required" 1 0
    _write_event "baseline_run" "failed_required" 1 0
    track_warn "System hardening: lock acquisition timeout (300s)"
    exec 9>&-
    end_timer "Stage 11: System Hardening"
    return 0
  fi

  log "Lock acquired (PID $$)"

  # ─────────────────────────────────────────────────────────────────────────
  # Update run-state: idle → running
  # ─────────────────────────────────────────────────────────────────────────
  _write_run_state "running"

  # ─────────────────────────────────────────────────────────────────────────
  # Build ansible-playbook command
  # ─────────────────────────────────────────────────────────────────────────
  local ANSIBLE_CMD=(
    "$ANSIBLE_BIN"
    "-i" "$ANSIBLE_DIR/inventory/local.yml"
    "$SITE_YML"
    "--extra-vars" "gwi_posuser=$_posuser gwi_station_role=$_station_role"
  )

  # Tag filtering via environment variables
  if [[ -n "${HARDENING_TAGS:-}" ]]; then
    ANSIBLE_CMD+=("--tags" "$HARDENING_TAGS")
    log "Tag filter: --tags $HARDENING_TAGS"
  fi

  if [[ -n "${SKIP_HARDENING_TAGS:-}" ]]; then
    ANSIBLE_CMD+=("--skip-tags" "$SKIP_HARDENING_TAGS")
    log "Tag filter: --skip-tags $SKIP_HARDENING_TAGS"
  fi

  # Dry-run / check mode
  if [[ "${HARDENING_DRY_RUN:-}" == "true" ]]; then
    ANSIBLE_CMD+=("--check")
    log "Running in CHECK (dry-run) mode"
  fi

  # ─────────────────────────────────────────────────────────────────────────
  # Execute Ansible with JSON callback
  # ─────────────────────────────────────────────────────────────────────────
  log "Running Ansible baseline enforcement..."
  log "  Playbook: $SITE_YML"
  log "  Station role: $_station_role"
  log "  POS user: $_posuser"
  log "  Baseline version: $(_read_baseline_version)"
  # NOTE: Notification suppression (GNOME/desktop alerts) is handled by the
  # kiosk_hardening Ansible role which runs by default (no tag filter needed).
  # The role disables update-notifier, apport, and desktop notification daemons.
  log "  Includes: kiosk_hardening (notification suppression), firewall, sshd, branding, etc."

  local ansible_exit=0

  # ANSIBLE_STDOUT_CALLBACK=json sends structured JSON to stdout.
  # Stdout goes ONLY to ansible-result.json (no tee). Stderr to separate log.
  ANSIBLE_STDOUT_CALLBACK=json \
  ANSIBLE_CONFIG="$ANSIBLE_DIR/ansible.cfg" \
  ANSIBLE_FORCE_COLOR=0 \
    "${ANSIBLE_CMD[@]}" \
    > "$ANSIBLE_RESULT_FILE" \
    2> "$ANSIBLE_STDERR_FILE" \
    || ansible_exit=$?

  # ─────────────────────────────────────────────────────────────────────────
  # Calculate duration
  # ─────────────────────────────────────────────────────────────────────────
  local run_end
  run_end=$(date +%s)
  local duration=$(( run_end - RUN_START ))

  # ─────────────────────────────────────────────────────────────────────────
  # Classify outcome from ansible-result.json
  # ─────────────────────────────────────────────────────────────────────────
  local outcome
  outcome=$(_classify_outcome "$ANSIBLE_RESULT_FILE" "$ansible_exit")

  local changed_count
  changed_count=$(_extract_changed_count "$ANSIBLE_RESULT_FILE")

  log "Ansible completed: exit_code=$ansible_exit outcome=$outcome changed=$changed_count duration=${duration}s"

  # ─────────────────────────────────────────────────────────────────────────
  # Update run-state based on outcome
  # ─────────────────────────────────────────────────────────────────────────
  case "$outcome" in
    success)
      _write_run_state "idle"
      log "Baseline enforcement completed successfully"
      ;;
    success_with_warnings)
      _write_run_state "idle"
      warn "Baseline enforcement completed with warnings"
      track_warn "System hardening: completed with warnings (check ansible-stderr.log)"
      ;;
    failed_required)
      _write_run_state "degraded"
      warn "Baseline enforcement had required-role failures"
      track_warn "System hardening: required role(s) failed (exit=$ansible_exit)"
      ;;
    skipped_unavailable)
      _write_run_state "idle"
      log "Baseline enforcement skipped (not applicable)"
      ;;
    *)
      _write_run_state "degraded"
      warn "Baseline enforcement: unknown outcome '$outcome'"
      track_warn "System hardening: unknown outcome '$outcome' (exit=$ansible_exit)"
      ;;
  esac

  # ─────────────────────────────────────────────────────────────────────────
  # Write stage11-result.json
  # ─────────────────────────────────────────────────────────────────────────
  _write_result "$outcome" "$ansible_exit" "$duration" "$changed_count"

  # ─────────────────────────────────────────────────────────────────────────
  # Append install event to install-events.jsonl
  # ─────────────────────────────────────────────────────────────────────────
  _write_event "baseline_run" "$outcome" "$ansible_exit" "$duration"

  # ─────────────────────────────────────────────────────────────────────────
  # Release lock (fd 9 closed when function exits, but be explicit)
  # ─────────────────────────────────────────────────────────────────────────
  exec 9>&-
  log "Baseline lock released"

  # ─────────────────────────────────────────────────────────────────────────
  # Phase A rollout policy: always return 0 (non-fatal)
  # The outcome is recorded in stage11-result.json for MC to evaluate.
  # After 3+ venues, 2+ weeks stable → promote to fail-closed.
  # ─────────────────────────────────────────────────────────────────────────

  # Direct hardening always runs (function defined at top of run_system_hardening)
  _apply_critical_hardening_direct

  end_timer "Stage 11: System Hardening"
  return 0
}

# =============================================================================
# Self-execution support -- when run directly (not sourced by installer orchestrator)
# Provides stub helpers so the script works standalone from update-agent/sync-agent.
# =============================================================================
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  # Stub helpers (installer orchestrator provides these; standalone mode needs stubs)
  if ! declare -f log >/dev/null 2>&1; then
    log()    { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [Stage11] $*"; }
  fi
  if ! declare -f warn >/dev/null 2>&1; then
    warn()   { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [Stage11] WARNING: $*" >&2; }
  fi
  if ! declare -f err >/dev/null 2>&1; then
    err()    { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [Stage11] ERROR: $*" >&2; }
  fi
  if ! declare -f header >/dev/null 2>&1; then
    header() { echo ""; echo "=== $* ==="; echo ""; }
  fi
  if ! declare -f track_warn >/dev/null 2>&1; then
    track_warn() { warn "$*"; }
  fi
  if ! declare -f start_timer >/dev/null 2>&1; then
    _stage11_start_ts=$(date +%s)
    start_timer() { _stage11_start_ts=$(date +%s); }
  fi
  if ! declare -f end_timer >/dev/null 2>&1; then
    end_timer() {
      local elapsed=$(( $(date +%s) - ${_stage11_start_ts:-0} ))
      log "$1 completed in ${elapsed}s"
    }
  fi

  # Default env vars if not set
  : "${APP_BASE:=/opt/gwi-pos}"
  : "${APP_DIR:=/opt/gwi-pos/app}"
  : "${ENV_FILE:=/opt/gwi-pos/.env}"
  : "${POSUSER:=gwipos}"
  : "${STATION_ROLE:=server}"

  run_system_hardening
  exit $?
fi
