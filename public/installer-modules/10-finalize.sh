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
    header "Installation Complete!"
  else
    header "Installation Complete (with warnings)"
  fi

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
  echo "    curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
  echo ""

  # Honest health summary
  if [[ ${#INSTALL_WARNINGS[@]} -eq 0 ]]; then
    log "Done! GWI POS is fully installed and healthy."
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
  "deviceId": "${HARDWARE_FINGERPRINT:-unknown}",
  "venueId": "${LOCATION_ID:-unknown}",
  "installedAt": "$(date -u +%FT%TZ)",
  "installerVersion": "${INSTALLER_VERSION:-unknown}",
  "role": "${STATION_ROLE:-unknown}",
  "gitSha": "${_git_sha}",
  "commitDate": "${_commit_date}",
  "stages": ${_stages_json},
  "warnings": ${_warnings_json},
  "warningsCount": ${#INSTALL_WARNINGS[@]},
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

  log "Stage: finalize — completed in $(( $(date +%s) - _start ))s"
  return 0
}
