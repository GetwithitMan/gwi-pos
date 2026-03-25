#!/usr/bin/env bash
# =============================================================================
# 08-ha.sh — HA/keepalived setup (only if backup/HA role)
# =============================================================================
# Entry: run_ha
# Expects: STATION_ROLE, VIRTUAL_IP, PRIMARY_NUC_IP, APP_BASE, ENV_FILE,
#          POSUSER
# =============================================================================

run_ha() {
  local _start=$(date +%s)
  log "Stage: ha — starting"

  # Only run if VIRTUAL_IP is set and role is server or backup
  if [[ -z "${VIRTUAL_IP:-}" ]] || [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: ha — skipped (no HA configuration needed)"
    return 0
  fi

  header "Setting Up keepalived (VIP Failover)"

  apt-get install -y keepalived

  # Auto-detect network interface
  HA_IFACE=$(ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
  if [[ -z "$HA_IFACE" ]]; then
    HA_IFACE="eth0"
    warn "Could not auto-detect network interface — defaulting to eth0"
  fi
  log "Network interface: $HA_IFACE"

  # Determine priority: primary=101, backup=100
  if [[ "$STATION_ROLE" == "server" ]]; then
    KA_STATE="MASTER"
    KA_PRIORITY=101
  else
    KA_STATE="BACKUP"
    KA_PRIORITY=100
  fi

  # Create HA health check script — prefer full version from repo if available
  # (07-services.sh already deployed it from $APP_DIR/public/ha-check.sh),
  # fall back to bootstrap version if repo hasn't been cloned yet.
  mkdir -p /opt/gwi-pos/scripts
  if [[ -f "$APP_DIR/public/ha-check.sh" ]]; then
    cp "$APP_DIR/public/ha-check.sh" /opt/gwi-pos/scripts/ha-check.sh
    chmod +x /opt/gwi-pos/scripts/ha-check.sh
    chown root:root /opt/gwi-pos/scripts/ha-check.sh
    log "Full ha-check.sh deployed (pg_is_in_recovery, replication lag, MC alerting)."
  elif [[ ! -f /opt/gwi-pos/scripts/ha-check.sh ]]; then
  cat > /opt/gwi-pos/scripts/ha-check.sh <<'HACHKEOF'
#!/usr/bin/env bash
# Bootstrap HA health check — minimal version so keepalived can start before
# the git clone completes. The full version (public/ha-check.sh) with
# pg_is_in_recovery(), replication lag monitoring, and MC alerting is deployed
# after the repo is cloned.

# Check 1: PostgreSQL is running
if ! systemctl is-active --quiet postgresql; then
  exit 1
fi

# Check 2: POS app is responding (only on server role — backup may not run app)
if [[ -f /opt/gwi-pos/.env ]]; then
  ROLE=$(grep -oP '(?<=^STATION_ROLE=).*' /opt/gwi-pos/.env 2>/dev/null || echo "")
  if [[ "$ROLE" == "server" ]]; then
    if ! curl -sf --max-time 5 http://localhost:3005/api/health >/dev/null 2>&1; then
      exit 1
    fi
  fi
fi

exit 0
HACHKEOF
    chmod +x /opt/gwi-pos/scripts/ha-check.sh
    log "Bootstrap ha-check.sh created (no full version available yet)."
  fi

  # VRRP auth password — must match between primary and backup for HA to work.
  # Primary generates it; backup must be given the same value.
  VRRP_AUTH_PASS=$(grep "^VRRP_AUTH_PASS=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [[ -z "$VRRP_AUTH_PASS" ]]; then
    if [[ "$STATION_ROLE" == "backup" ]]; then
      # Backup: prompt for primary's VRRP password (same as REPL_PASSWORD pattern)
      echo ""
      echo "Enter the VRRP auth password from the primary server."
      echo "(Found in the primary's /opt/gwi-pos/.env as VRRP_AUTH_PASS)"
      echo ""
      read -rp "VRRP auth password: " VRRP_AUTH_PASS < /dev/tty
      if [[ -z "$VRRP_AUTH_PASS" ]]; then
        # Generate one but warn — HA may not authenticate
        VRRP_AUTH_PASS=$(head -c 6 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 8)
        warn "No VRRP password entered — generated random. HA may fail if primary uses a different password."
      fi
    else
      # Primary: generate fresh password
      VRRP_AUTH_PASS=$(head -c 6 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 8)
    fi
  fi
  # Persist to .env
  grep -q "^VRRP_AUTH_PASS=" "$ENV_FILE" 2>/dev/null && \
    sed -i "s/^VRRP_AUTH_PASS=.*/VRRP_AUTH_PASS=$VRRP_AUTH_PASS/" "$ENV_FILE" || \
    echo "VRRP_AUTH_PASS=$VRRP_AUTH_PASS" >> "$ENV_FILE"

  # Virtual router ID — must match between primary and backup.
  # Configurable to avoid conflicts when multiple HA pairs share the same L2 segment.
  VRRP_ROUTER_ID=$(grep "^VRRP_ROUTER_ID=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [[ -z "$VRRP_ROUTER_ID" ]]; then
    VRRP_ROUTER_ID=51
    echo "VRRP_ROUTER_ID=$VRRP_ROUTER_ID" >> "$ENV_FILE"
  fi

  # Detect VIP subnet prefix from the interface (for virtual_ipaddress in keepalived.conf)
  VIP_PREFIX="24"
  _VIP_IFACE_CIDR=$(ip -o -4 addr show "$HA_IFACE" 2>/dev/null | awk '{print $4; exit}')
  if [[ -n "$_VIP_IFACE_CIDR" ]]; then
    VIP_PREFIX="${_VIP_IFACE_CIDR#*/}"
  fi

  # Create promote.sh stub — called by keepalived notify_master on failover
  cat > "$APP_BASE/scripts/promote.sh" <<'PROMOTE'
#!/usr/bin/env bash
# Promote this standby to primary
set -euo pipefail
echo "[HA] Promoting to primary..."
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/17/main 2>/dev/null || sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main 2>/dev/null || true
# Enable POS service so it survives reboots (backup role has it disabled)
sudo systemctl enable thepasspos
sudo systemctl start thepasspos
# Update STATION_ROLE in .env so POS knows it is now the primary
if [ -f /opt/gwi-pos/.env ]; then
  sed -i 's/STATION_ROLE=backup/STATION_ROLE=server/' /opt/gwi-pos/.env
  echo "[HA] Updated STATION_ROLE to server in .env"
fi
echo "[HA] Promotion complete"
PROMOTE
  chmod +x "$APP_BASE/scripts/promote.sh"

  # Create rejoin-as-standby.sh stub — called by keepalived notify_backup on demotion
  cat > "$APP_BASE/scripts/rejoin-as-standby.sh" <<'REJOIN'
#!/usr/bin/env bash
# Rejoin as standby after primary reclaims VIP
set -euo pipefail
echo "[HA] Rejoining as standby..."
sudo systemctl stop thepasspos 2>/dev/null || true
# Note: full rejoin requires pg_basebackup from the primary.
# This stub stops the POS app to prevent stale writes.
# A full rejoin procedure should be triggered manually or by a fleet command.
echo "[HA] POS stopped. Manual pg_basebackup required to fully rejoin as standby."
REJOIN
  chmod +x "$APP_BASE/scripts/rejoin-as-standby.sh"
  log "HA promotion/demotion scripts created."

  # Generate keepalived.conf
  cat > /etc/keepalived/keepalived.conf <<KAEOF
# GWI POS HA — keepalived configuration
# Generated by installer.run — $(date -u +%Y-%m-%dT%H:%M:%SZ)

vrrp_script chk_gwi_pos {
    script "/opt/gwi-pos/scripts/ha-check.sh"
    interval 5
    weight -20
    fall 3
    rise 2
}

vrrp_instance GWI_POS {
    state $KA_STATE
    interface $HA_IFACE
    virtual_router_id $VRRP_ROUTER_ID
    priority $KA_PRIORITY
    advert_int 1
    $([ "$STATION_ROLE" = "backup" ] && echo "nopreempt")

    authentication {
        auth_type PASS
        auth_pass $VRRP_AUTH_PASS
    }

    virtual_ipaddress {
        $VIRTUAL_IP/$VIP_PREFIX
    }

    track_script {
        chk_gwi_pos
    }

    notify_master "/opt/gwi-pos/scripts/promote.sh"
    notify_backup "/opt/gwi-pos/scripts/rejoin-as-standby.sh"
}
KAEOF

  # Firewall rules for VRRP (protocol 112) — only if firewalld is active
  if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    log "Adding VRRP firewall rule..."
    firewall-cmd --add-rich-rule='rule protocol value="vrrp" accept' --permanent 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
  elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    log "Adding VRRP ufw rule..."
    ufw allow proto vrrp from any to any 2>/dev/null || true
  fi

  systemctl daemon-reload
  systemctl enable keepalived
  systemctl start keepalived

  # Verify keepalived is running
  sleep 2
  if systemctl is-active --quiet keepalived; then
    log "keepalived running — state=$KA_STATE, priority=$KA_PRIORITY, VIP=$VIRTUAL_IP"
  else
    track_warn "keepalived failed to start — check: journalctl -u keepalived"
  fi

  log "Stage: ha — completed in $(( $(date +%s) - _start ))s"
  return 0
}
