#!/usr/bin/env bash
# =============================================================================
# GWI POS — USB Remote Access Setup (double-click from USB drive)
# =============================================================================
# Copy this file to a USB drive. On a fresh Ubuntu NUC:
#   1. Plug in USB
#   2. Open file manager, find this script
#   3. Right-click → "Run as a program" or open Terminal here and: sudo bash usb-remote-setup.sh
#
# Downloads and runs the remote setup script from the internet.
# If no internet, installs x11vnc from local repos (usually cached).
# =============================================================================

set -euo pipefail

# Get sudo if not already root
if [[ $EUID -ne 0 ]]; then
  echo "This needs admin access. Enter your password:"
  exec sudo bash "$0" "$@"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  GWI POS — Setting Up Remote Access"
echo "══════════════════════════════════════════════"
echo ""

# Install curl if missing (fresh U24 doesn't have it)
if ! command -v curl >/dev/null 2>&1; then
  echo "Installing curl..."
  apt-get update -qq && apt-get install -y curl >/dev/null 2>&1
fi

# Try the online version first (has RealVNC + full setup)
if curl -fsSL --connect-timeout 5 https://ordercontrolcenter.com/setup-remote.sh -o /tmp/gwi-setup-remote.sh 2>/dev/null; then
  echo "Downloaded setup script. Running..."
  bash /tmp/gwi-setup-remote.sh
  rm -f /tmp/gwi-setup-remote.sh
  exit 0
fi

# Offline fallback: just install x11vnc from local apt cache
echo "No internet — installing x11vnc from local packages..."
apt-get install -y x11vnc 2>/dev/null || {
  echo "ERROR: Cannot install x11vnc without internet. Connect to WiFi/ethernet first."
  read -rp "Press Enter to exit..." < /dev/tty
  exit 1
}

# Quick VNC setup
VNC_PASS="gwi-temp-$(date +%s | tail -c 5)"
mkdir -p /etc/x11vnc
x11vnc -storepasswd "$VNC_PASS" /etc/x11vnc/passwd >/dev/null 2>&1
chmod 600 /etc/x11vnc/passwd

POSUSER=$(who | grep -E 'tty|:0' | head -1 | awk '{print $1}')
[[ -z "$POSUSER" ]] && POSUSER=$(getent passwd 1000 | cut -d: -f1)
POSUSER_HOME=$(getent passwd "$POSUSER" 2>/dev/null | cut -d: -f6)

# Start x11vnc immediately
x11vnc -display :0 -auth "$POSUSER_HOME/.Xauthority" -forever -loop -noxdamage -repeat -rfbauth /etc/x11vnc/passwd -rfbport 5900 -shared -bg 2>/dev/null

LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "══════════════════════════════════════════════"
echo "  VNC Ready!"
echo "  Connect to: $LOCAL_IP:5900"
echo "  Password: $VNC_PASS"
echo ""
echo "  Now connect via VNC and run the POS installer."
echo "══════════════════════════════════════════════"
echo ""
read -rp "Press Enter to close this window..." < /dev/tty
