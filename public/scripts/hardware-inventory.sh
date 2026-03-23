#!/usr/bin/env bash
# GWI POS Hardware Inventory — detects connected hardware
# Called by heartbeat.sh to enrich payload
# Outputs JSON to stdout

set -euo pipefail

detect_touchscreen() {
  local found="false"
  local model=""
  # Check for touchscreen via xinput or libinput
  if command -v xinput &>/dev/null; then
    local ts
    ts=$(xinput list 2>/dev/null | grep -i "touch" | head -1 | sed 's/.*↳ //' | sed 's/\s*id=.*//' | xargs)
    if [[ -n "$ts" ]]; then
      found="true"
      model="$ts"
    fi
  fi
  # Fallback: check /dev/input for touchscreen
  if [[ "$found" == "false" ]] && ls /dev/input/event* &>/dev/null; then
    for dev in /dev/input/event*; do
      local caps
      caps=$(udevadm info --query=property "$dev" 2>/dev/null | grep "ID_INPUT_TOUCHSCREEN=1" || true)
      if [[ -n "$caps" ]]; then
        found="true"
        model=$(udevadm info --query=property "$dev" 2>/dev/null | grep "ID_MODEL=" | cut -d= -f2 || echo "unknown")
        break
      fi
    done
  fi
  echo "{\"detected\":$found,\"model\":\"${model}\"}"
}

detect_thermal_printer() {
  local found="false"
  local model=""
  local port=""
  # Check common thermal printer paths
  for dev in /dev/usb/lp0 /dev/usb/lp1 /dev/ttyUSB0 /dev/ttyACM0; do
    if [[ -e "$dev" ]]; then
      found="true"
      port="$dev"
      model=$(udevadm info --query=property "$dev" 2>/dev/null | grep "ID_MODEL=" | cut -d= -f2 || echo "unknown")
      break
    fi
  done
  # Check CUPS
  if [[ "$found" == "false" ]] && command -v lpstat &>/dev/null; then
    local printer
    printer=$(lpstat -p 2>/dev/null | grep -i "thermal\|epson\|star\|bixolon" | head -1 | awk '{print $2}')
    if [[ -n "$printer" ]]; then
      found="true"
      model="$printer"
    fi
  fi
  echo "{\"detected\":$found,\"model\":\"${model}\",\"port\":\"${port}\"}"
}

detect_card_reader() {
  local found="false"
  local model=""
  # Check for Datacap/PAX/Ingenico USB devices
  if command -v lsusb &>/dev/null; then
    local reader
    reader=$(lsusb 2>/dev/null | grep -iE "datacap|pax|ingenico|verifone|magtek|id tech" | head -1 || true)
    if [[ -n "$reader" ]]; then
      found="true"
      model=$(echo "$reader" | sed 's/.*: ID [0-9a-f:]* //')
    fi
  fi
  # Check for serial card readers
  for dev in /dev/ttyUSB* /dev/ttyACM*; do
    if [[ -e "$dev" ]] && [[ "$found" == "false" ]]; then
      local info
      info=$(udevadm info --query=property "$dev" 2>/dev/null | grep "ID_MODEL=" | cut -d= -f2 || true)
      if echo "$info" | grep -qiE "datacap|pax|ingenico|verifone|magtek"; then
        found="true"
        model="$info"
      fi
    fi
  done
  echo "{\"detected\":$found,\"model\":\"${model}\"}"
}

detect_serial_scale() {
  local found="false"
  local port=""
  # CAS PDN scale is on /dev/ttyUSB* typically
  for dev in /dev/ttyUSB*; do
    if [[ -e "$dev" ]]; then
      local info
      info=$(udevadm info --query=property "$dev" 2>/dev/null || true)
      if echo "$info" | grep -qiE "cas|scale|prolific|ftdi"; then
        found="true"
        port="$dev"
        break
      fi
    fi
  done
  echo "{\"detected\":$found,\"port\":\"${port}\"}"
}

detect_usb_devices() {
  local count=0
  local devices="[]"
  if command -v lsusb &>/dev/null; then
    count=$(lsusb 2>/dev/null | wc -l)
    devices=$(lsusb 2>/dev/null | awk -F': ID ' '{print $2}' | jq -R -s 'split("\n") | map(select(length > 0))' 2>/dev/null || echo "[]")
  fi
  echo "{\"count\":$count,\"devices\":$devices}"
}

detect_display() {
  local resolution=""
  local display_type=""
  if command -v xrandr &>/dev/null && [[ -n "${DISPLAY:-}" ]]; then
    resolution=$(xrandr 2>/dev/null | grep '\*' | head -1 | awk '{print $1}' || echo "unknown")
    display_type=$(xrandr 2>/dev/null | grep ' connected' | head -1 | awk '{print $1}' || echo "unknown")
  fi
  echo "{\"resolution\":\"${resolution}\",\"output\":\"${display_type}\"}"
}

# Main: output complete inventory as JSON
main() {
  local ts
  ts=$(detect_touchscreen)
  local printer
  printer=$(detect_thermal_printer)
  local reader
  reader=$(detect_card_reader)
  local scale
  scale=$(detect_serial_scale)
  local usb
  usb=$(detect_usb_devices)
  local display
  display=$(detect_display)

  cat <<INVJSON
{
  "inventoryAt": "$(date -u +%FT%TZ)",
  "touchscreen": $ts,
  "thermalPrinter": $printer,
  "cardReader": $reader,
  "serialScale": $scale,
  "usbDevices": $usb,
  "display": $display
}
INVJSON
}

main "$@"
