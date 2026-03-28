#!/usr/bin/env bash
# =============================================================================
# GWI POS — Quick Remote Access Setup
# =============================================================================
# Run this BEFORE the main installer so you can remote in via SSH/TeamViewer.
#
# Usage:
#   curl -fsSL https://ordercontrolcenter.com/setup-remote.sh | sudo bash
#
# What it does:
#   1. Forces X11 (disables Wayland if GNOME)
#   2. Enables SSH
#   3. Tells you to reboot if Wayland was active
#
# After this, you can remote in and run the full POS installer.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[GWI Setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

echo -e "\n${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  GWI POS — Remote Access Setup${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}\n"

# Must be root
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root (use sudo)"
  exit 1
fi

NEEDS_REBOOT=false

# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Force X11 (disable Wayland on GNOME)
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f /etc/gdm3/custom.conf ]]; then
  if ! grep -q "WaylandEnable=false" /etc/gdm3/custom.conf 2>/dev/null; then
    log "Disabling Wayland (POS kiosk requires X11)..."
    if grep -q "\[daemon\]" /etc/gdm3/custom.conf; then
      sed -i '/\[daemon\]/a WaylandEnable=false' /etc/gdm3/custom.conf
    else
      echo -e "\n[daemon]\nWaylandEnable=false" >> /etc/gdm3/custom.conf
    fi
    NEEDS_REBOOT=true
    log "Wayland disabled. X11 will be used after reboot."
  else
    log "X11 already configured (Wayland disabled)."
  fi
else
  log "SDDM/KDE detected — X11 is default. No changes needed."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Enable SSH
# ─────────────────────────────────────────────────────────────────────────────

if ! systemctl is-active --quiet ssh 2>/dev/null && ! systemctl is-active --quiet sshd 2>/dev/null; then
  log "Enabling SSH..."
  apt-get update -qq
  apt-get install -y openssh-server >/dev/null 2>&1
  systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
  systemctl start ssh 2>/dev/null || systemctl start sshd 2>/dev/null || true
  log "SSH enabled."
else
  log "SSH already running."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Remote Access Ready${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
log "SSH:  ssh $(whoami)@${LOCAL_IP:-<this-machine>}"
echo ""

if [[ "$NEEDS_REBOOT" == "true" ]]; then
  echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  REBOOT REQUIRED${NC}"
  echo -e "${YELLOW}  Wayland was disabled. Reboot to switch to X11.${NC}"
  echo -e "${YELLOW}  After reboot, remote in and run the POS installer:${NC}"
  echo ""
  echo -e "  curl -fsSL https://ordercontrolcenter.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
  echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
  echo ""
  read -rp "  Reboot now? (y/N): " DO_REBOOT < /dev/tty
  if [[ "$DO_REBOOT" =~ ^[Yy] ]]; then
    log "Rebooting..."
    reboot
  fi
else
  echo "  Now run the POS installer:"
  echo "  curl -fsSL https://ordercontrolcenter.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
fi
