#!/usr/bin/env bash
# Write GWI POS ISO to USB drive
# Usage: sudo bash scripts/write-usb.sh [/dev/sdX]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ISO=$(ls -t "$PROJECT_DIR"/dist/gwi-pos-ubuntu-*.iso 2>/dev/null | head -1)
if [[ -z "$ISO" ]]; then
  echo "No ISO found in dist/. Run: npm run build:iso first"
  exit 1
fi

USB_DEV="${1:-}"
if [[ -z "$USB_DEV" ]]; then
  echo "Available USB drives:"
  lsblk -d -o NAME,SIZE,MODEL,TRAN | grep usb || echo "  (none found)"
  echo ""
  read -rp "Enter USB device (e.g., /dev/sdb): " USB_DEV
fi

if [[ -z "$USB_DEV" ]] || [[ ! -b "$USB_DEV" ]]; then
  echo "Invalid device: $USB_DEV"
  exit 1
fi

echo ""
echo "WARNING: This will ERASE ALL DATA on $USB_DEV"
echo "ISO: $ISO"
lsblk "$USB_DEV" 2>/dev/null
echo ""
read -rp "Type YES to confirm: " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "Aborted"
  exit 1
fi

echo "Writing ISO to $USB_DEV..."
dd if="$ISO" of="$USB_DEV" bs=4M status=progress oflag=sync
sync
echo ""
echo "Done! USB drive is ready. Boot the NUC from this USB."
