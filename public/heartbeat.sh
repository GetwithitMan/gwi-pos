#!/usr/bin/env bash
# GWI POS Heartbeat — sends system + sync status to Mission Control every 60s
# Installed by installer.run as a cron job
set -euo pipefail

# Load env
if [ -f /opt/gwi-pos/.env ]; then
  set -a; source /opt/gwi-pos/.env; set +a
fi

NODE_ID="${SERVER_NODE_ID:-}"
API_KEY="${SERVER_API_KEY:-}"
MC_URL="${MISSION_CONTROL_URL:-}"

if [ -z "$NODE_ID" ] || [ -z "$API_KEY" ] || [ -z "$MC_URL" ]; then
  exit 0
fi

# System metrics
CPU=$(awk '{printf "%.1f", $1}' /proc/loadavg 2>/dev/null || echo "0")
MEM=$(free -m 2>/dev/null | awk '/Mem:/{printf "%.0f", $3/$2*100}' || echo "0")
DISK=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%' || echo "0")
UPTIME=$(cat /proc/uptime 2>/dev/null | awk '{printf "%.0f", $1}' || echo "0")
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
POS_LOC="${POS_LOCATION_ID:-}"

# Get sync status from local POS (if running)
SYNC_STATUS="{}"
SYNC_JSON=$(curl -s --max-time 3 http://localhost:3005/api/internal/sync-status 2>/dev/null || echo "")
if [ -n "$SYNC_JSON" ] && echo "$SYNC_JSON" | python3 -m json.tool >/dev/null 2>&1; then
  SYNC_STATUS="$SYNC_JSON"
fi

# Build payload
BODY=$(cat <<EOJSON
{
  "nodeId": "$NODE_ID",
  "cpu": $CPU,
  "memoryPercent": $MEM,
  "diskPercent": $DISK,
  "uptimeSeconds": $UPTIME,
  "localIp": "$LOCAL_IP",
  "posLocationId": "$POS_LOC",
  "syncStatus": $SYNC_STATUS
}
EOJSON
)

# HMAC signature
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print $NF}')

# Send to Mission Control
curl -s --max-time 10 \
  -X POST "${MC_URL}/api/fleet/heartbeat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Server-Node-Id: $NODE_ID" \
  -H "X-Request-Signature: $SIG" \
  -d "$BODY" >/dev/null 2>&1 || true
