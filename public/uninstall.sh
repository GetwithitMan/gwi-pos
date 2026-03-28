#!/usr/bin/env bash
# =============================================================================
# GWI POS Uninstaller
# =============================================================================
# Removes all GWI POS components from the NUC. Leaves the OS clean.
#
# Usage:
#   sudo bash uninstall.sh              # Interactive — asks before each step
#   sudo bash uninstall.sh --confirm    # Non-interactive — removes everything
#   sudo bash uninstall.sh --keep-db    # Removes everything EXCEPT the database
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[Uninstall]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Must be run as root (use sudo)"
  exit 1
fi

AUTO_CONFIRM=false
KEEP_DB=false
for arg in "$@"; do
  [[ "$arg" == "--confirm" ]] && AUTO_CONFIRM=true
  [[ "$arg" == "--keep-db" ]] && KEEP_DB=true
done

confirm() {
  if [[ "$AUTO_CONFIRM" == "true" ]]; then return 0; fi
  read -rp "  $1 (y/N): " response < /dev/tty
  [[ "$response" =~ ^[Yy] ]]
}

echo -e "\n${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  GWI POS Uninstaller${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}\n"

if [[ "$AUTO_CONFIRM" != "true" ]]; then
  echo -e "${RED}This will REMOVE the GWI POS system from this NUC.${NC}"
  echo ""
  if ! confirm "Are you sure you want to continue?"; then
    echo "Cancelled."
    exit 0
  fi
  echo ""
fi

# ── Step 1: Stop all services ────────────────────────────────────────────────
log "Stopping GWI POS services..."
for svc in thepasspos-kiosk thepasspos-sync thepasspos-exit-kiosk thepasspos gwi-pos-verify gwi-pos-drift.timer gwi-pos-baseline-retry; do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done
log "Services stopped."

# ── Step 2: Remove systemd service files ─────────────────────────────────────
log "Removing systemd services..."
rm -f /etc/systemd/system/thepasspos.service
rm -f /etc/systemd/system/thepasspos-kiosk.service
rm -f /etc/systemd/system/thepasspos-sync.service
rm -f /etc/systemd/system/thepasspos-exit-kiosk.service
rm -f /etc/systemd/system/x11vnc.service
rm -f /etc/systemd/system/gwi-pos-verify.service
rm -f /etc/systemd/system/gwi-pos-drift.service
rm -f /etc/systemd/system/gwi-pos-drift.timer
rm -f /etc/systemd/system/gwi-pos-baseline-retry.service
rm -f /etc/systemd/system/gwi-pos-baseline-retry.timer
systemctl daemon-reload
log "Systemd services removed."

# ── Step 3: Remove cron jobs ─────────────────────────────────────────────────
log "Removing cron jobs..."
POSUSER=$(stat -c '%U' /opt/gwi-pos/.env 2>/dev/null || echo "gwipos")
crontab -u "$POSUSER" -r 2>/dev/null || true
log "Cron jobs removed."

# ── Step 4: Remove sudoers ───────────────────────────────────────────────────
log "Removing sudoers rules..."
rm -f /etc/sudoers.d/gwi-pos
log "Sudoers rules removed."

# ── Step 5: Remove udev rules ───────────────────────────────────────────────
log "Removing udev rules..."
rm -f /etc/udev/rules.d/99-epson-tm.rules
rm -f /etc/udev/rules.d/99-gwi-pos-devices.rules
rm -f /etc/udev/rules.d/99-gwi-touchscreen.conf
udevadm control --reload-rules 2>/dev/null || true
log "udev rules removed."

# ── Step 6: Remove OS hardening configs ──────────────────────────────────────
log "Removing OS hardening configs..."
rm -f /etc/systemd/logind.conf.d/gwi-pos.conf
rm -f /etc/systemd/journald.conf.d/gwi-pos.conf
rm -f /etc/logrotate.d/gwi-pos
rm -f /etc/ssh/sshd_config.d/99-gwi-pos.conf
rm -f /etc/fail2ban/jail.d/gwi-pos.conf
rm -f /etc/sddm.conf.d/gwi-autologin.conf
rm -f /etc/sddm.conf.d/gwi-branding.conf
rm -f /etc/sysctl.d/99-gwi-pos.conf
rm -rf /etc/systemd/resolved.conf.d/gwi-pos.conf
rm -f /etc/apt/apt.conf.d/50unattended-upgrades
rm -f /etc/apt/apt.conf.d/20auto-upgrades
rm -f /etc/apt/preferences.d/chromium-no-snap.pref
# Unmask sleep targets
systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target 2>/dev/null || true
systemctl restart systemd-logind 2>/dev/null || true
log "OS hardening configs removed."

# ── Step 7: Remove Plymouth theme ────────────────────────────────────────────
log "Removing Plymouth theme..."
rm -rf /usr/share/plymouth/themes/gwi-pos
plymouth-set-default-theme -R 2>/dev/null || true
log "Plymouth theme removed."

# ── Step 8: Remove desktop shortcuts ────────────────────────────────────────
log "Removing desktop shortcuts..."
POSUSER_HOME=$(getent passwd "$POSUSER" 2>/dev/null | cut -d: -f6 || echo "/home/$POSUSER")
rm -f "$POSUSER_HOME/Desktop/gwi-pos.desktop"
rm -f "$POSUSER_HOME/Desktop/realvnc-server.desktop"
rm -f "$POSUSER_HOME/.xbindkeysrc"
rm -f /usr/share/applications/gwi-pos.desktop
rm -f /usr/share/backgrounds/gwi-wallpaper.png
rm -f /etc/motd
rm -f /etc/issue.net
log "Desktop shortcuts removed."

# ── Step 9: Remove VNC configs ──────────────────────────────────────────────
log "Removing VNC configs..."
rm -rf /etc/x11vnc
rm -rf /root/.vnc/config.d/vncserver-x11-serviced
log "VNC configs removed."

# ── Step 10: Drop database (optional) ───────────────────────────────────────
if [[ "$KEEP_DB" == "true" ]]; then
  log "Keeping database (--keep-db flag)."
else
  if confirm "Drop the PostgreSQL database 'thepasspos'? (ALL DATA WILL BE LOST)"; then
    log "Dropping database..."
    su - postgres -c "dropdb thepasspos 2>/dev/null" || true
    su - postgres -c "dropuser thepasspos 2>/dev/null" || true
    log "Database dropped."
  else
    log "Keeping database."
  fi
fi

# ── Step 11: Remove /opt/gwi-pos ────────────────────────────────────────────
log "Removing /opt/gwi-pos..."
rm -rf /opt/gwi-pos
log "/opt/gwi-pos removed."

# ── Step 12: Remove Ansible venv ────────────────────────────────────────────
# Already under /opt/gwi-pos, but just in case
rm -rf /opt/gwi-pos/.ansible-venv 2>/dev/null || true

# ── Step 13: Remove X11 touchscreen config ──────────────────────────────────
rm -f /etc/X11/xorg.conf.d/99-gwi-touchscreen.conf 2>/dev/null || true

# ── Step 14: Remove kiosk wrapper ───────────────────────────────────────────
rm -f /usr/local/bin/chromium-kiosk 2>/dev/null || true

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  GWI POS Uninstalled${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
log "The following were NOT removed (system packages):"
echo "  - Node.js, PostgreSQL, Chromium, x11vnc, RealVNC, fail2ban"
echo "  - To remove: sudo apt remove nodejs postgresql-17 chromium x11vnc realvnc-vnc-server fail2ban"
echo ""
log "To reinstall:"
echo "  curl -fsSL https://ordercontrolcenter.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
echo ""
