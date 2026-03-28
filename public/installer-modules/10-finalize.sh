#!/usr/bin/env bash
# =============================================================================
# 10-finalize.sh — Summary, warnings, VNC password storage, first-boot marker
# =============================================================================
# Entry: run_finalize
# Expects: STATION_ROLE, POSUSER, POSUSER_HOME, APP_BASE, ENV_FILE,
#          USE_LOCAL_PG, VIRTUAL_IP, PRIMARY_NUC_IP, SERVER_URL,
#          BACKUP_SCRIPT, VNC_PASSWORD, INSTALL_START, INSTALL_WARNINGS,
#          VENUE_NAME, LOCATION_NAME, BACKUP_DIR
# =============================================================================

run_finalize() {
  local _start=$(date +%s)
  log "Stage: finalize — starting"

  # ─────────────────────────────────────────────────────────────────────────────
  # Summary
  # ─────────────────────────────────────────────────────────────────────────────

  TOTAL_ELAPSED=$(( $(date +%s) - INSTALL_START ))
  TOTAL_MINS=$(( TOTAL_ELAPSED / 60 ))
  TOTAL_SECS=$(( TOTAL_ELAPSED % 60 ))

  # Resolve LOCATION_NAME if not already set
  if [[ -z "${LOCATION_NAME:-}" ]]; then
    if [[ -z "${VENUE_NAME:-}" ]]; then
      VENUE_NAME=$(curl -sf --max-time 3 "http://localhost:3005/api/settings" 2>/dev/null \
        | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));process.stdout.write(d?.data?.locationName||'')}catch(e){}" 2>/dev/null || echo "")
    fi
    LOCATION_NAME="${VENUE_NAME:-ThePassPOS}"
  fi

  if [[ ${#INSTALL_WARNINGS[@]} -eq 0 ]]; then
    header "Core Installation Complete"
  else
    header "Core Installation Complete (with warnings)"
  fi
  echo -e "  ${YELLOW}Note:${NC} System hardening and dashboard stages still follow this summary."
  echo ""

  echo -e "  ${GREEN}Total time:${NC} ${TOTAL_MINS}m ${TOTAL_SECS}s"
  echo -e "  ${GREEN}Role:${NC}     $STATION_ROLE"
  echo -e "  ${GREEN}Location:${NC} $LOCATION_NAME"

  if [[ "$STATION_ROLE" == "server" ]]; then
    echo -e "  ${GREEN}POS URL:${NC}  http://localhost:3005"
    if [[ "$USE_LOCAL_PG" == "true" ]]; then
      echo -e "  ${GREEN}Database:${NC} PostgreSQL (local primary)"
      echo -e "  ${GREEN}Backups:${NC}  $BACKUP_DIR (daily 4 AM, 7-day retention + S3 upload 4:15 AM)"
    else
      echo -e "  ${GREEN}Database:${NC} Neon (cloud)"
    fi
    if [[ -n "${VIRTUAL_IP:-}" ]]; then
      echo -e "  ${GREEN}HA Mode:${NC}  Primary (VIP: $VIRTUAL_IP)"
      echo -e "  ${GREEN}keepalived:${NC} $(systemctl is-active keepalived 2>/dev/null || echo 'not installed')"
    fi
    echo -e "  ${GREEN}Heartbeat:${NC} Every 60 seconds -> Mission Control"
    # Only show sync status if agent was actually installed
    SYNC_STATUS=$(systemctl is-active thepasspos-sync 2>/dev/null || echo "not installed")
    if [[ "$SYNC_STATUS" == "active" ]]; then
      echo -e "  ${GREEN}Sync:${NC}     Listening for deploy commands"
    else
      echo -e "  ${YELLOW}Sync:${NC}     $SYNC_STATUS"
    fi
    echo ""
    echo -e "  ${CYAN}Services:${NC}"
    echo "    thepasspos        — $(systemctl is-active thepasspos 2>/dev/null || echo 'unknown')"
    # Only show kiosk if it was enabled (not skipped by preflight)
    KIOSK_STATUS=$(systemctl is-enabled thepasspos-kiosk 2>/dev/null || echo "disabled")
    if [[ "$KIOSK_STATUS" != "disabled" ]]; then
      echo "    thepasspos-kiosk  — $(systemctl is-active thepasspos-kiosk 2>/dev/null || echo 'unknown')"
    else
      echo "    thepasspos-kiosk  — skipped (preflight failed)"
    fi
    echo "    thepasspos-sync   — $SYNC_STATUS"
    echo "    postgresql        — $(systemctl is-active postgresql 2>/dev/null || echo 'unknown')"
    if [[ -n "${VIRTUAL_IP:-}" ]]; then
      echo "    keepalived        — $(systemctl is-active keepalived 2>/dev/null || echo 'unknown')"
    fi
    echo "    x11vnc            — $(systemctl is-active x11vnc 2>/dev/null || echo 'unknown')"
    if command -v vncserver-x11 >/dev/null 2>&1; then
      echo "    realvnc      — $(systemctl is-active vncserver-x11-serviced 2>/dev/null || echo 'unknown')"
    fi
  elif [[ "$STATION_ROLE" == "backup" ]]; then
    echo -e "  ${GREEN}HA Mode:${NC}  Backup standby (VIP: ${VIRTUAL_IP:-none})"
    echo -e "  ${GREEN}Primary:${NC}  ${PRIMARY_NUC_IP:-unknown}"
    echo -e "  ${GREEN}Database:${NC} PostgreSQL (streaming replica)"
    echo -e "  ${GREEN}Heartbeat:${NC} Every 60 seconds -> Mission Control"
    SYNC_STATUS=$(systemctl is-active thepasspos-sync 2>/dev/null || echo "not installed")
    echo ""
    echo -e "  ${CYAN}Services:${NC}"
    echo "    thepasspos        — $(systemctl is-active thepasspos 2>/dev/null || echo 'standby (not started)')"
    echo "    thepasspos-sync   — $SYNC_STATUS"
    echo "    postgresql        — $(systemctl is-active postgresql 2>/dev/null || echo 'unknown') (standby)"
    echo "    keepalived        — $(systemctl is-active keepalived 2>/dev/null || echo 'unknown')"
    echo "    x11vnc            — $(systemctl is-active x11vnc 2>/dev/null || echo 'unknown')"
    if command -v vncserver-x11 >/dev/null 2>&1; then
      echo "    realvnc           — $(systemctl is-active vncserver-x11-serviced 2>/dev/null || echo 'unknown')"
    fi
  else
    echo -e "  ${GREEN}Server:${NC}   $SERVER_URL"
    echo ""
    echo -e "  ${CYAN}Services:${NC}"
    echo "    thepasspos-kiosk      — $(systemctl is-active thepasspos-kiosk 2>/dev/null || echo 'unknown')"
    echo "    thepasspos-exit-kiosk — $(systemctl is-active thepasspos-exit-kiosk 2>/dev/null || echo 'unknown')"
    echo "    x11vnc                — $(systemctl is-active x11vnc 2>/dev/null || echo 'unknown')"
    if command -v vncserver-x11 >/dev/null 2>&1; then
      echo "    realvnc               — $(systemctl is-active vncserver-x11-serviced 2>/dev/null || echo 'unknown')"
    fi
  fi

  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  if command -v x11vnc >/dev/null 2>&1; then
    echo -e "  ${GREEN}VNC:${NC}          localhost:5900 (SSH tunnel: ssh -L 5900:localhost:5900 $POSUSER@$LOCAL_IP)"
    # Write VNC password to root-owned file instead of printing to console
    echo "$VNC_PASSWORD" > /opt/gwi-pos/.vnc-password
    chmod 600 /opt/gwi-pos/.vnc-password
    chown root:root /opt/gwi-pos/.vnc-password
    echo -e "  ${GREEN}VNC Password:${NC} stored in /opt/gwi-pos/.vnc-password (read with: sudo cat /opt/gwi-pos/.vnc-password)"
  fi
  if command -v vncserver-x11 >/dev/null 2>&1; then
    echo -e "  ${GREEN}RealVNC:${NC}      Installed — sign in via desktop icon or: vncserver-x11 -config"
  fi

  echo ""
  echo -e "  ${CYAN}Useful commands:${NC}"
  if [[ "$STATION_ROLE" == "server" ]]; then
    echo "    sudo systemctl status thepasspos        — Check POS status"
    echo "    sudo systemctl status thepasspos-sync   — Check sync agent"
    echo "    sudo journalctl -u thepasspos -f        — View POS logs"
    echo "    sudo journalctl -u thepasspos-sync -f   — View sync agent logs"
    echo "    sudo systemctl restart thepasspos       — Restart POS"
    if [[ "$USE_LOCAL_PG" == "true" ]]; then
      echo "    sudo bash $BACKUP_SCRIPT               — Run manual backup"
      echo "    sudo /opt/gwi-pos/scripts/nuc-backup-upload.sh — Upload backup to S3"
      echo "    sudo /opt/gwi-pos/scripts/nuc-restore.sh       — Restore from backup"
    fi
    if [[ -n "${VIRTUAL_IP:-}" ]]; then
      echo "    sudo systemctl status keepalived        — Check HA status"
      echo "    ip addr show | grep $VIRTUAL_IP         — Check if VIP is on this node"
    fi
    echo "    cat /opt/gwi-pos/heartbeat.log          — View heartbeat log"
  elif [[ "$STATION_ROLE" == "backup" ]]; then
    echo "    sudo systemctl status postgresql         — Check PG standby"
    echo "    sudo systemctl status keepalived         — Check HA status"
    echo "    sudo -u postgres psql -c 'SELECT pg_is_in_recovery();'  — Verify standby mode"
    echo "    ip addr show | grep ${VIRTUAL_IP:-VIP}   — Check if VIP is on this node"
    echo "    sudo /opt/gwi-pos/scripts/promote.sh     — Promote to primary (failover)"
    echo "    sudo /opt/gwi-pos/scripts/nuc-restore.sh — Restore from backup"
    echo "    cat /opt/gwi-pos/heartbeat.log           — View heartbeat log"
  else
    echo "    sudo systemctl status thepasspos-kiosk  — Check kiosk status"
    echo "    sudo journalctl -u thepasspos-kiosk -f  — View kiosk logs"
    echo "    sudo systemctl restart thepasspos-kiosk — Restart kiosk"
    echo "    sudo /opt/gwi-pos/kiosk-control.sh stop — Exit kiosk mode"
  fi
  echo ""
  echo -e "  ${CYAN}Re-run this installer to update:${NC}"
  echo "    curl -fsSL https://ordercontrolcenter.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
  echo ""

  # Honest health summary (hardening + dashboard stages still follow)
  if [[ ${#INSTALL_WARNINGS[@]} -eq 0 ]]; then
    log "Core install healthy. System hardening and dashboard stages remain."
  else
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Installation completed with ${#INSTALL_WARNINGS[@]} warning(s):${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
    for w in "${INSTALL_WARNINGS[@]}"; do
      echo -e "  ${YELLOW}!${NC}  $w"
    done
    echo ""
    echo -e "  The station is installed but may not be fully operational."
    echo -e "  Review the warnings above and re-run the installer after fixing."
    echo ""
  fi

  # ── Write structured install report ──
  local report_file="$APP_BASE/state/install-report.json"
  mkdir -p "$APP_BASE/state"
  local _warnings_json
  _warnings_json=$(printf '%s\n' "${INSTALL_WARNINGS[@]:-}" | jq -R -s 'split("\n") | map(select(length > 0))' 2>/dev/null || echo '[]')
  # Gather extended report fields
  local _git_sha _commit_date _pos_version _node_version _pg_version
  _git_sha=$(cd "$APP_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")
  _commit_date=$(cd "$APP_DIR" && git log -1 --format=%cI 2>/dev/null || echo "unknown")
  _pos_version=$(cd "$APP_DIR" && node -e 'console.log(require("./package.json").version)' 2>/dev/null || echo "unknown")
  _node_version=$(node --version 2>/dev/null || echo "unknown")
  _pg_version=$(psql --version 2>/dev/null | head -1 || echo "unknown")

  # Watchdog installed?
  local _watchdog_installed="false"
  if [[ -f /etc/systemd/system/gwi-watchdog.timer ]]; then
    _watchdog_installed="true"
  fi

  # Hardware inventory (from watchdog script if available)
  local _hw_inventory="{}"
  if [[ -x /opt/gwi-pos/scripts/hardware-inventory.sh ]]; then
    _hw_inventory=$(/opt/gwi-pos/scripts/hardware-inventory.sh 2>/dev/null || echo "{}")
    # Validate JSON — fall back to empty object if invalid
    echo "$_hw_inventory" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || _hw_inventory="{}"
  fi

  # Disk state (usage of key partitions)
  local _disk_state="{}"
  if command -v df >/dev/null 2>&1; then
    local _disk_total _disk_used _disk_avail _disk_pct
    _disk_total=$(df -BM /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/M/,""); print $2}' || echo "0")
    _disk_used=$(df -BM /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/M/,""); print $3}' || echo "0")
    _disk_avail=$(df -BM /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/M/,""); print $4}' || echo "0")
    _disk_pct=$(df /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}' || echo "0")
    _disk_state="{\"totalMB\":${_disk_total:-0},\"usedMB\":${_disk_used:-0},\"availMB\":${_disk_avail:-0},\"usedPercent\":${_disk_pct:-0}}"
  fi

  # Dashboard installed?
  local _dashboard_installed="false"
  local _dashboard_version="null"
  if command -v gwi-dashboard >/dev/null 2>&1 || command -v gwi-nuc-dashboard >/dev/null 2>&1; then
    _dashboard_installed="true"
    _dashboard_version="\"$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "unknown")\""
  fi

  # Contract hash (from version-contract.json if available)
  local _contract_hash="unknown"
  if [[ -f "$APP_DIR/public/version-contract.json" ]]; then
    _contract_hash=$(python3 -c "import json; print(json.load(open('$APP_DIR/public/version-contract.json')).get('schemaSha256','unknown'))" 2>/dev/null || echo "unknown")
  fi

  # Build stage results from state files if available
  local _stages_json="{}"
  if [[ -f "$APP_BASE/state/stage11-result.json" ]]; then
    local _s11_outcome
    _s11_outcome=$(python3 -c "import json; print(json.load(open('$APP_BASE/state/stage11-result.json')).get('outcome','unknown'))" 2>/dev/null || echo "unknown")
    _stages_json="{\"hardening\":\"${_s11_outcome}\"}"
  fi

  cat > "$report_file" <<REPORT
{
  "installId": "$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo unknown)",
  "bootId": "$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)",
  "deviceId": "${HARDWARE_FINGERPRINT:-unknown}",
  "venueId": "${LOCATION_ID:-unknown}",
  "venueSlug": "${VENUE_SLUG:-unknown}",
  "installedAt": "$(date -u +%FT%TZ)",
  "installerVersion": "${INSTALLER_VERSION:-unknown}",
  "installerGitSha": "${INSTALLER_GIT_SHA:-unknown}",
  "moduleSource": "$([ -n "${RESUME_FROM:-}" ] && echo 'git-checkout' || echo 'embedded-payload')",
  "resumedFrom": "${RESUME_FROM:-null}",
  "dryRun": ${DRY_RUN:-false},
  "role": "${STATION_ROLE:-unknown}",
  "gitSha": "${_git_sha}",
  "commitDate": "${_commit_date}",
  "stages": ${_stages_json},
  "warnings": ${_warnings_json},
  "warningsCount": ${#INSTALL_WARNINGS[@]},
  "contractHash": "${_contract_hash}",
  "schemaVersion": "${SCHEMA_VERSION:-unknown}",
  "posVersion": "${_pos_version}",
  "nodeVersion": "${_node_version}",
  "pgVersion": "${_pg_version}",
  "duration": $(( $(date +%s) - ${INSTALL_START:-0} )),
  "degraded": $([ ${#INSTALL_WARNINGS[@]} -gt 0 ] && echo true || echo false),
  "failureReason": null,
  "watchdogInstalled": ${_watchdog_installed},
  "hardwareInventory": ${_hw_inventory},
  "diskState": ${_disk_state},
  "dashboardInstalled": ${_dashboard_installed},
  "dashboardVersion": ${_dashboard_version}
}
REPORT
  chown "$POSUSER":"$POSUSER" "$report_file" 2>/dev/null || true
  log "Install report written to $report_file"

  # ── Post-Install Verification ──────────────────────────────────────────────
  _run_verification

  log "Stage: finalize — completed in $(( $(date +%s) - _start ))s"
  return 0
}

# =============================================================================
# _run_verification — Comprehensive post-install verification
# =============================================================================
# Checks EVERY installed component: expected version vs installed version.
# Status codes: PASS, FAIL, MISSING, OUTDATED, WARN, SKIPPED
# Nothing is silently skipped. Every component is explicitly reported.
# Writes verification-report.json for MC consumption.
# Called at the very end of run_finalize() after the install report is written.
# =============================================================================

_run_verification() {
  local pass=0
  local fail=0
  local warn_count=0
  local results=()
  local POS_PORT="${POS_PORT:-3005}"
  local STATE_DIR="$APP_BASE/state"

  # ── Table data: name[i], expected[i], installed[i], status[i] ──────────────
  local -a tbl_name=()
  local -a tbl_expected=()
  local -a tbl_installed=()
  local -a tbl_status=()

  # Helper: record a check result and print the line
  _record() {
    local name="$1" expected="$2" installed="$3" status="$4" detail="${5:-}"
    tbl_name+=("$name")
    tbl_expected+=("$expected")
    tbl_installed+=("$installed")
    tbl_status+=("$status")
    # Print individual check line
    local icon
    case "$status" in
      PASS)     icon="✓"; ((pass++)) ;;
      FAIL)     icon="✗"; ((fail++)) ;;
      MISSING)  icon="✗"; ((fail++)) ;;
      OUTDATED) icon="✗"; ((fail++)) ;;
      WARN)     icon="⚠"; ((warn_count++)) ;;
      SKIPPED)  icon="—"; ((warn_count++)) ;;
      *)        icon="?"; ((warn_count++)) ;;
    esac
    local color
    case "$status" in
      PASS)     color="$GREEN" ;;
      WARN|SKIPPED) color="$YELLOW" ;;
      *)        color="$RED" ;;
    esac
    printf "  %b%s%b %-22s Expected: %-12s Installed: %-12s — %b%s%b\n" \
      "$color" "$icon" "$NC" "$name" "$expected" "$installed" "$color" "$status" "$NC"
    # Build JSON result entry
    local json="{\"component\":\"$name\",\"expected\":\"$expected\",\"installed\":\"$installed\",\"status\":\"$status\""
    if [[ -n "$detail" ]]; then
      json="${json},\"detail\":\"$detail\""
    fi
    json="${json}}"
    results+=("$json")
  }

  header "Post-Install Verification"
  echo ""

  # ── Read expected versions from version-contract.json + package.json ────────
  local contract_file="$APP_DIR/public/version-contract.json"
  local expected_schema="UNKNOWN"
  if [[ -f "$contract_file" ]]; then
    expected_schema=$(node -e "try{console.log(require('$contract_file').schemaVersion)}catch(e){console.log('UNKNOWN')}" 2>/dev/null || echo "UNKNOWN")
  fi
  local expected_pos_ver
  expected_pos_ver=$(node -e "try{console.log(require('$APP_DIR/package.json').version)}catch(e){console.log('UNKNOWN')}" 2>/dev/null || echo "UNKNOWN")

  # ── 1. POS Application ─────────────────────────────────────────────────────
  local pos_version
  pos_version=$(node -e "console.log(require('${APP_DIR}/package.json').version)" 2>/dev/null || echo "UNKNOWN")
  local pos_health
  pos_health=$(curl -sf --connect-timeout 5 --max-time 10 "http://localhost:${POS_PORT}/api/health" 2>/dev/null | jq -r '.data.status // empty' 2>/dev/null || echo "UNREACHABLE")

  if [[ "$pos_version" == "UNKNOWN" ]]; then
    _record "POS Application" "$expected_pos_ver" "MISSING" "MISSING" "$pos_health"
  elif [[ "$pos_health" == "healthy" || "$pos_health" == "degraded" ]]; then
    if [[ "$pos_version" == "$expected_pos_ver" ]]; then
      _record "POS Application" "$expected_pos_ver" "$pos_version" "PASS" "$pos_health"
    else
      _record "POS Application" "$expected_pos_ver" "$pos_version" "OUTDATED" "$pos_health"
    fi
  else
    _record "POS Application" "$expected_pos_ver" "$pos_version" "FAIL" "$pos_health"
  fi

  # ── 2. Installer ───────────────────────────────────────────────────────────
  local inst_ver="${INSTALLER_VERSION:-UNKNOWN}"
  if [[ "$inst_ver" == "__INSTALLER_VERSION__" || "$inst_ver" == "UNKNOWN" || -z "$inst_ver" ]]; then
    _record "Installer" "$expected_pos_ver" "UNKNOWN" "WARN" "version not stamped"
  else
    _record "Installer" "$expected_pos_ver" "$inst_ver" "PASS"
  fi

  # ── 3. Node.js ─────────────────────────────────────────────────────────────
  local node_ver
  node_ver=$(node --version 2>/dev/null || echo "MISSING")
  if [[ "$node_ver" == "MISSING" ]]; then
    _record "Node.js" "20+" "$node_ver" "MISSING"
  else
    # Check minimum version (20+)
    local node_major
    node_major=$(echo "$node_ver" | sed 's/^v//' | cut -d. -f1)
    if [[ "$node_major" -ge 20 ]]; then
      _record "Node.js" "20+" "$node_ver" "PASS"
    else
      _record "Node.js" "20+" "$node_ver" "OUTDATED"
    fi
  fi

  # ── 4. PostgreSQL ──────────────────────────────────────────────────────────
  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    local pg_ver
    pg_ver=$(psql --version 2>/dev/null | head -1 | grep -oP '\d+(\.\d+)?' || echo "MISSING")
    if [[ "$pg_ver" == "MISSING" ]]; then
      _record "PostgreSQL" "15+" "$pg_ver" "MISSING"
    else
      local pg_connected="no"
      pg_isready -q 2>/dev/null && pg_connected="yes"
      local pg_major
      pg_major=$(echo "$pg_ver" | cut -d. -f1)
      if [[ "$pg_connected" == "yes" && "$pg_major" -ge 15 ]]; then
        _record "PostgreSQL" "15+" "$pg_ver" "PASS" "connected"
      elif [[ "$pg_connected" == "yes" ]]; then
        _record "PostgreSQL" "15+" "$pg_ver" "OUTDATED" "connected but old"
      else
        _record "PostgreSQL" "15+" "$pg_ver" "FAIL" "not connected"
      fi
    fi
  else
    _record "PostgreSQL" "N/A" "N/A" "SKIPPED" "terminal role"
  fi

  # ── 5. Dashboard ───────────────────────────────────────────────────────────
  local dash_ver
  dash_ver=$(dpkg-query -W -f='${Version}' gwi-nuc-dashboard 2>/dev/null || echo "MISSING")
  local dash_running
  dash_running=$(pgrep -f gwi-dashboard > /dev/null 2>&1 && echo "running" || echo "not running")
  if [[ "$dash_ver" == "MISSING" ]]; then
    _record "Dashboard" "deployed" "MISSING" "WARN" "Stage 12 not yet run"
  else
    _record "Dashboard" "deployed" "v${dash_ver}" "PASS" "$dash_running"
  fi

  # ── 6. Services (role-aware) ───────────────────────────────────────────────
  local svc_list=()
  local skip_svc_list=()
  if [[ "$STATION_ROLE" == "server" ]]; then
    svc_list=(thepasspos thepasspos-sync)
    skip_svc_list=(thepasspos-kiosk thepasspos-exit-kiosk)
  elif [[ "$STATION_ROLE" == "backup" ]]; then
    svc_list=(thepasspos thepasspos-sync)
    skip_svc_list=(thepasspos-kiosk thepasspos-exit-kiosk)
  else
    svc_list=(thepasspos-kiosk)
    skip_svc_list=(thepasspos thepasspos-sync)
  fi

  for svc in "${svc_list[@]}"; do
    local svc_state
    svc_state=$(systemctl is-active "$svc" 2>/dev/null || echo "MISSING")
    if [[ "$svc_state" == "active" ]]; then
      _record "Svc:$svc" "active" "$svc_state" "PASS"
    elif [[ "$svc_state" == "MISSING" ]]; then
      _record "Svc:$svc" "active" "MISSING" "MISSING"
    else
      _record "Svc:$svc" "active" "$svc_state" "FAIL"
    fi
  done

  for svc in "${skip_svc_list[@]}"; do
    _record "Svc:$svc" "N/A" "N/A" "SKIPPED" "$STATION_ROLE role"
  done

  # ── 7. PostgreSQL Service ──────────────────────────────────────────────────
  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    local pg_svc
    pg_svc=$(systemctl is-active postgresql 2>/dev/null || echo "MISSING")
    if [[ "$pg_svc" == "active" ]]; then
      _record "Svc:postgresql" "active" "$pg_svc" "PASS"
    else
      _record "Svc:postgresql" "active" "$pg_svc" "FAIL"
    fi
  else
    _record "Svc:postgresql" "N/A" "N/A" "SKIPPED" "terminal role"
  fi

  # ── 8. Keepalived (HA) ─────────────────────────────────────────────────────
  if [[ -n "${VIRTUAL_IP:-}" ]]; then
    local ka_state
    ka_state=$(systemctl is-active keepalived 2>/dev/null || echo "MISSING")
    if [[ "$ka_state" == "active" ]]; then
      _record "Svc:keepalived" "active" "$ka_state" "PASS" "VIP=$VIRTUAL_IP"
    else
      _record "Svc:keepalived" "active" "$ka_state" "FAIL"
    fi
  else
    _record "Svc:keepalived" "N/A" "N/A" "SKIPPED" "no HA configured"
  fi

  # ── 9. VNC ─────────────────────────────────────────────────────────────────
  local vnc_state
  vnc_state=$(systemctl is-active x11vnc 2>/dev/null || echo "MISSING")
  if [[ "$vnc_state" == "active" ]]; then
    _record "Svc:x11vnc" "active" "$vnc_state" "PASS"
  elif [[ "$vnc_state" == "MISSING" ]]; then
    _record "Svc:x11vnc" "active" "MISSING" "WARN" "not installed"
  else
    _record "Svc:x11vnc" "active" "$vnc_state" "WARN"
  fi

  # RealVNC (optional addon)
  if command -v vncserver-x11 >/dev/null 2>&1; then
    local rvnc_state
    rvnc_state=$(systemctl is-active vncserver-x11-serviced 2>/dev/null || echo "MISSING")
    if [[ "$rvnc_state" == "active" ]]; then
      _record "Svc:realvnc" "active" "$rvnc_state" "PASS"
    else
      _record "Svc:realvnc" "active" "$rvnc_state" "WARN"
    fi
  else
    _record "Svc:realvnc" "optional" "not installed" "SKIPPED"
  fi

  # ── 10. Watchdog Timer ─────────────────────────────────────────────────────
  if [[ -f /etc/systemd/system/gwi-watchdog.timer ]]; then
    local wd_state
    wd_state=$(systemctl is-active gwi-watchdog.timer 2>/dev/null || echo "inactive")
    if [[ "$wd_state" == "active" ]]; then
      _record "Watchdog" "active" "$wd_state" "PASS"
    else
      _record "Watchdog" "active" "$wd_state" "WARN"
    fi
  else
    _record "Watchdog" "deployed" "MISSING" "WARN" "timer not installed"
  fi

  # ── 11. Monitoring Scripts ─────────────────────────────────────────────────
  local scripts_total=0
  local scripts_found=0
  for script in watchdog.sh scripts/hardware-inventory.sh scripts/disk-pressure-monitor.sh scripts/version-compat.sh scripts/rolling-restart.sh; do
    ((scripts_total++))
    if [[ -x "/opt/gwi-pos/$script" ]]; then
      ((scripts_found++))
    fi
  done
  if [[ "$scripts_found" -eq "$scripts_total" ]]; then
    _record "Monitoring Scripts" "deployed" "${scripts_found}/${scripts_total}" "PASS"
  elif [[ "$scripts_found" -gt 0 ]]; then
    _record "Monitoring Scripts" "deployed" "${scripts_found}/${scripts_total}" "FAIL" "$((scripts_total - scripts_found)) missing"
  else
    _record "Monitoring Scripts" "deployed" "MISSING" "MISSING"
  fi

  # ── 12. Error Codes Library ────────────────────────────────────────────────
  if [[ -f /opt/gwi-pos/installer-modules/lib/error-codes.sh ]]; then
    _record "Error Codes" "deployed" "deployed" "PASS"
  else
    _record "Error Codes" "deployed" "MISSING" "MISSING"
  fi

  # ── 13. Sync Agent ────────────────────────────────────────────────────────
  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    if [[ -f /opt/gwi-pos/sync-agent.js ]]; then
      _record "Sync Agent" "deployed" "deployed" "PASS"
    else
      _record "Sync Agent" "deployed" "MISSING" "MISSING"
    fi
  else
    _record "Sync Agent" "N/A" "N/A" "SKIPPED" "terminal role"
  fi

  # ── 14. Environment File ──────────────────────────────────────────────────
  if [[ -f "$ENV_FILE" ]]; then
    local env_keys=0
    env_keys=$(grep -c '=' "$ENV_FILE" 2>/dev/null || echo "0")
    _record "Environment (.env)" "present" "${env_keys} keys" "PASS"
  else
    _record "Environment (.env)" "present" "MISSING" "MISSING"
  fi

  # ── 15. Screen Sleep Prevention ────────────────────────────────────────────
  local sleep_masked
  sleep_masked=$(systemctl is-enabled sleep.target 2>/dev/null || echo "UNKNOWN")
  if [[ "$sleep_masked" == "masked" ]]; then
    _record "Screen Sleep" "masked" "masked" "PASS"
  else
    _record "Screen Sleep" "masked" "$sleep_masked" "WARN"
  fi

  # ── 16. Disk Space ────────────────────────────────────────────────────────
  local disk_pct
  disk_pct=$(df /opt/gwi-pos 2>/dev/null | awk 'NR==2 {gsub(/%/,""); print $5}' || echo "UNKNOWN")
  if [[ "$disk_pct" == "UNKNOWN" ]]; then
    _record "Disk Space" "<90%" "UNKNOWN" "WARN"
  elif [[ "$disk_pct" -lt 80 ]]; then
    _record "Disk Space" "<90%" "${disk_pct}%" "PASS"
  elif [[ "$disk_pct" -lt 90 ]]; then
    _record "Disk Space" "<90%" "${disk_pct}%" "WARN" "getting full"
  else
    _record "Disk Space" "<90%" "${disk_pct}%" "FAIL" "CRITICAL"
  fi

  # ── 17. Network / MC Reachability ──────────────────────────────────────────
  if curl -sf --connect-timeout 5 "https://mc.getwithitpos.com" > /dev/null 2>&1 || curl -sf --connect-timeout 5 "https://app.thepasspos.com" > /dev/null 2>&1; then
    _record "Network" "reachable" "reachable" "PASS"
  else
    _record "Network" "reachable" "unreachable" "WARN" "may be offline-only"
  fi

  # ── 18. Sync Readiness ────────────────────────────────────────────────────
  local sync_status
  sync_status=$(curl -sf --connect-timeout 5 "http://localhost:${POS_PORT}/api/health" 2>/dev/null | jq -r '.data.readiness.level // empty' 2>/dev/null || echo "UNKNOWN")
  if [[ -z "$sync_status" ]]; then sync_status="UNKNOWN"; fi
  if [[ "$sync_status" == "ORDERS" ]]; then
    _record "Sync Readiness" "ORDERS" "$sync_status" "PASS"
  elif [[ "$sync_status" == "SYNC" || "$sync_status" == "BOOT" ]]; then
    _record "Sync Readiness" "ORDERS" "$sync_status" "WARN" "still warming up"
  else
    _record "Sync Readiness" "ORDERS" "$sync_status" "FAIL"
  fi

  # ── 19. Schema Version ────────────────────────────────────────────────────
  local actual_schema="UNKNOWN"
  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    actual_schema=$(sudo -u postgres psql -d "${DB_NAME:-thepasspos}" -tAc "SELECT \"schemaVersion\" FROM \"_local_schema_state\" ORDER BY \"updatedAt\" DESC LIMIT 1" 2>/dev/null || echo "UNKNOWN")
    actual_schema=$(echo "$actual_schema" | tr -d '[:space:]')
    if [[ -z "$actual_schema" ]]; then actual_schema="UNKNOWN"; fi
  fi
  if [[ "$actual_schema" == "$expected_schema" && "$actual_schema" != "UNKNOWN" ]]; then
    _record "Schema Version" "$expected_schema" "$actual_schema" "PASS"
  elif [[ "$actual_schema" == "UNKNOWN" && "$expected_schema" == "UNKNOWN" ]]; then
    _record "Schema Version" "UNKNOWN" "UNKNOWN" "WARN" "cannot determine"
  elif [[ "$actual_schema" == "UNKNOWN" ]]; then
    _record "Schema Version" "$expected_schema" "UNKNOWN" "WARN" "cannot verify"
  else
    _record "Schema Version" "$expected_schema" "$actual_schema" "OUTDATED"
  fi

  # ── 20. Git Repo ──────────────────────────────────────────────────────────
  if [[ -d "$APP_DIR/.git" ]]; then
    local git_sha
    git_sha=$(cd "$APP_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "UNKNOWN")
    local git_branch
    git_branch=$(cd "$APP_DIR" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "UNKNOWN")
    _record "Git Repo" "cloned" "${git_branch}@${git_sha}" "PASS"
  else
    _record "Git Repo" "cloned" "MISSING" "MISSING"
  fi

  # ── 21. Prisma Client ─────────────────────────────────────────────────────
  if [[ -d "$APP_DIR/node_modules/.prisma/client" ]] || [[ -d "$APP_DIR/generated/prisma/client" ]]; then
    _record "Prisma Client" "generated" "generated" "PASS"
  else
    _record "Prisma Client" "generated" "MISSING" "MISSING"
  fi

  # ── 22. Next.js Build ─────────────────────────────────────────────────────
  if [[ -d "$APP_DIR/.next" ]]; then
    local build_id
    build_id=$(cat "$APP_DIR/.next/BUILD_ID" 2>/dev/null || echo "UNKNOWN")
    _record "Next.js Build" "built" "$build_id" "PASS"
  else
    _record "Next.js Build" "built" "MISSING" "MISSING"
  fi

  # ── 23. Heartbeat Cron ────────────────────────────────────────────────────
  local hb_cron
  hb_cron=$(crontab -l -u root 2>/dev/null | grep -c "heartbeat" || echo "0")
  if [[ "$hb_cron" -gt 0 ]]; then
    _record "Heartbeat Cron" "scheduled" "scheduled" "PASS"
  else
    _record "Heartbeat Cron" "scheduled" "MISSING" "WARN"
  fi

  # ── 24. Backup Script (server + local PG only) ────────────────────────────
  if [[ "$STATION_ROLE" == "server" && "$USE_LOCAL_PG" == "true" ]]; then
    if [[ -x "$BACKUP_SCRIPT" ]]; then
      _record "Backup Script" "executable" "executable" "PASS"
    else
      _record "Backup Script" "executable" "MISSING" "FAIL"
    fi
    local bk_cron
    bk_cron=$(crontab -l -u root 2>/dev/null | grep -c "backup-pos" || echo "0")
    if [[ "$bk_cron" -gt 0 ]]; then
      _record "Backup Cron" "scheduled" "scheduled" "PASS"
    else
      _record "Backup Cron" "scheduled" "MISSING" "WARN"
    fi
  else
    _record "Backup Script" "N/A" "N/A" "SKIPPED" "not server+localPG"
    _record "Backup Cron" "N/A" "N/A" "SKIPPED" "not server+localPG"
  fi

  # ══════════════════════════════════════════════════════════════════════════
  #  SUMMARY TABLE
  # ══════════════════════════════════════════════════════════════════════════
  local total=$((pass + fail + warn_count))
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${NC}  ${CYAN}Component               Expected       Installed      Status${NC}         ${CYAN}║${NC}"
  echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"

  local i
  for i in "${!tbl_name[@]}"; do
    local st="${tbl_status[$i]}"
    local color
    case "$st" in
      PASS)     color="$GREEN" ;;
      WARN|SKIPPED) color="$YELLOW" ;;
      *)        color="$RED" ;;
    esac
    printf "${CYAN}║${NC}  %-23s %-14s %-14s %b%-8s%b     ${CYAN}║${NC}\n" \
      "${tbl_name[$i]}" "${tbl_expected[$i]}" "${tbl_installed[$i]}" "$color" "$st" "$NC"
  done

  echo -e "${CYAN}╠══════════════════════════════════════════════════════════════════════════╣${NC}"
  if [[ $fail -eq 0 ]]; then
    printf "${CYAN}║${NC}  ${GREEN}TOTAL: %d PASS${NC} | ${YELLOW}%d WARN${NC} | ${RED}%d FAIL${NC} %-30s ${CYAN}║${NC}\n" \
      "$pass" "$warn_count" "$fail" ""
  else
    printf "${CYAN}║${NC}  ${GREEN}%d PASS${NC} | ${YELLOW}%d WARN${NC} | ${RED}%d FAIL  <<<  FAILURES DETECTED${NC} %-10s ${CYAN}║${NC}\n" \
      "$pass" "$warn_count" "$fail" ""
  fi
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  if [[ $fail -gt 0 ]]; then
    echo ""
    echo -e "  ${RED}!!!  $fail CRITICAL FAILURE(S) DETECTED — review verification table above  !!!${NC}"
    echo ""
  fi

  # ── Write structured verification report ────────────────────────────────────
  mkdir -p "$STATE_DIR"
  local verify_file="$STATE_DIR/verification-report.json"
  cat > "$verify_file" <<VERIFYJSON
{
  "verifiedAt": "$(date -u +%FT%TZ)",
  "installerVersion": "${INSTALLER_VERSION:-unknown}",
  "posVersion": "${pos_version}",
  "role": "${STATION_ROLE:-unknown}",
  "locationId": "${LOCATION_ID:-unknown}",
  "venueName": "${LOCATION_NAME:-unknown}",
  "passed": $pass,
  "warnings": $warn_count,
  "failed": $fail,
  "total": $total,
  "allPassed": $([ $fail -eq 0 ] && echo true || echo false),
  "results": [$(IFS=,; echo "${results[*]}")]
}
VERIFYJSON
  chown "$POSUSER":"$POSUSER" "$verify_file" 2>/dev/null || true
  log "Verification report saved to $verify_file"
}
