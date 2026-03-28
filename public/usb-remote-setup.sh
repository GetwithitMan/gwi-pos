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
# If no internet, enables SSH from local packages.
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

# Try the online version first (has full setup)
if curl -fsSL --connect-timeout 5 https://ordercontrolcenter.com/setup-remote.sh -o /tmp/gwi-setup-remote.sh 2>/dev/null; then
  echo "Downloaded setup script. Running..."
  bash /tmp/gwi-setup-remote.sh
  rm -f /tmp/gwi-setup-remote.sh
  exit 0
fi

# Offline fallback: enable SSH
echo "No internet — enabling SSH from local packages..."
apt-get install -y openssh-server 2>/dev/null || {
  echo "ERROR: Cannot install SSH server without internet. Connect to WiFi/ethernet first."
  read -rp "Press Enter to exit..." < /dev/tty
  exit 1
}

systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
systemctl start ssh 2>/dev/null || systemctl start sshd 2>/dev/null || true

LOCAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "══════════════════════════════════════════════"
echo "  SSH Ready!"
echo "  Connect to: ssh $(whoami)@$LOCAL_IP"
echo ""
echo "  Now connect via SSH and run the POS installer."
echo "══════════════════════════════════════════════"
echo ""
read -rp "Press Enter to close this window..." < /dev/tty
