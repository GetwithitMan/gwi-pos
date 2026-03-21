#!/usr/bin/env bash
# =============================================================================
# GWI POS — Quick Remote Access Setup
# =============================================================================
# Run this BEFORE the main installer so you can remote in via RealVNC.
#
# Usage:
#   curl -fsSL https://app.thepasspos.com/setup-remote.sh | sudo bash
#
# What it does:
#   1. Installs RealVNC Server
#   2. Installs x11vnc (backup VNC)
#   3. Forces X11 (disables Wayland if GNOME)
#   4. Joins RealVNC cloud (optional — enter token when prompted)
#   5. Tells you to reboot if Wayland was active
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
# Step 2: Install x11vnc (lightweight backup VNC)
# ─────────────────────────────────────────────────────────────────────────────

if ! command -v x11vnc >/dev/null 2>&1; then
  log "Installing x11vnc..."
  apt-get update -qq
  apt-get install -y x11vnc >/dev/null 2>&1
fi

if command -v x11vnc >/dev/null 2>&1; then
  # Auto-generate a VNC password
  VNC_PASS=$(openssl rand -base64 12 | tr '+/' '-_' | cut -c1-12)
  mkdir -p /etc/x11vnc
  x11vnc -storepasswd "$VNC_PASS" /etc/x11vnc/passwd >/dev/null 2>&1
  chmod 600 /etc/x11vnc/passwd

  # Detect the logged-in user
  POSUSER=$(who | grep -E 'tty|:0' | head -1 | awk '{print $1}')
  [[ -z "$POSUSER" ]] && POSUSER=$(getent passwd 1000 | cut -d: -f1 || echo "")
  POSUSER_HOME=$(getent passwd "$POSUSER" 2>/dev/null | cut -d: -f6 || echo "/home/$POSUSER")

  # Create systemd service
  cat > /etc/systemd/system/x11vnc.service <<VNCSVC
[Unit]
Description=x11vnc VNC Server
After=display-manager.service network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/x11vnc -display :0 -auth ${POSUSER_HOME}/.Xauthority -forever -loop -noxdamage -repeat -rfbauth /etc/x11vnc/passwd -rfbport 5900 -shared
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
VNCSVC

  systemctl daemon-reload
  systemctl enable x11vnc
  systemctl start x11vnc 2>/dev/null || true
  log "x11vnc running on port 5900 (password: $VNC_PASS)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Install RealVNC Server
# ─────────────────────────────────────────────────────────────────────────────

if ! command -v vncserver-x11 >/dev/null 2>&1; then
  log "Downloading RealVNC Server..."
  curl -fsSL -o /tmp/vncserver.deb \
    "https://www.realvnc.com/download/file/vnc.files/VNC-Server-Latest-Linux-x64.deb" 2>/dev/null

  if [[ -f /tmp/vncserver.deb ]]; then
    log "Installing RealVNC Server..."
    apt-get install -y /tmp/vncserver.deb >/dev/null 2>&1 || {
      warn "RealVNC install failed. x11vnc is still available on port 5900."
    }
    rm -f /tmp/vncserver.deb
  fi
else
  log "RealVNC Server already installed."
fi

if command -v vncserver-x11 >/dev/null 2>&1; then
  systemctl enable vncserver-x11-serviced 2>/dev/null || true
  systemctl start vncserver-x11-serviced 2>/dev/null || true

  # Set friendly name
  HOSTNAME_NAME=$(hostname)
  mkdir -p /root/.vnc/config.d
  echo "FriendlyName=GWI-POS-${HOSTNAME_NAME}" > /root/.vnc/config.d/vncserver-x11-serviced

  log "RealVNC Server installed."

  # Prompt for cloud join
  echo ""
  echo -e "${CYAN}RealVNC Cloud Join${NC}"
  echo "  Get a token from: connect.realvnc.com → Deployment → Cloud join token"
  echo ""
  read -rp "  Enter RealVNC cloud join token (or Enter to skip): " REALVNC_TOKEN < /dev/tty
  if [[ -n "$REALVNC_TOKEN" ]]; then
    log "Joining RealVNC cloud..."
    if vncserver-x11 -service -joinCloud "$REALVNC_TOKEN" 2>/dev/null; then
      log "Joined RealVNC cloud — device will appear in your portal."
      # Save token for the POS installer to reuse
      mkdir -p /opt/gwi-pos
      echo "REALVNC_CLOUD_TOKEN=$REALVNC_TOKEN" >> /opt/gwi-pos/.env 2>/dev/null || true
    else
      warn "Cloud join failed. Sign in manually via the RealVNC desktop icon."
    fi
  else
    log "Skipped. You can join later from the desktop icon."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Remote Access Ready${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════${NC}"
echo ""
log "x11vnc:  port 5900 (LAN access via SSH tunnel)"
if command -v vncserver-x11 >/dev/null 2>&1; then
  log "RealVNC: cloud access (if joined) or direct connect"
fi
echo ""

if [[ "$NEEDS_REBOOT" == "true" ]]; then
  echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
  echo -e "${YELLOW}  REBOOT REQUIRED${NC}"
  echo -e "${YELLOW}  Wayland was disabled. Reboot to switch to X11.${NC}"
  echo -e "${YELLOW}  After reboot, remote in and run the POS installer:${NC}"
  echo ""
  echo -e "  curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
  echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
  echo ""
  read -rp "  Reboot now? (y/N): " DO_REBOOT < /dev/tty
  if [[ "$DO_REBOOT" =~ ^[Yy] ]]; then
    log "Rebooting..."
    reboot
  fi
else
  echo "  Now run the POS installer:"
  echo "  curl -fsSL https://app.thepasspos.com/installer.run -o installer.run && chmod +x installer.run && sudo ./installer.run"
fi
