#!/usr/bin/env bash
# GWI POS Heartbeat — sends system + sync status to Mission Control every 60s
# Installed by installer.run as a cron job
#
# NOTE: There are two heartbeat paths:
#   1. This shell script (legacy/external) — runs via cron, sends system metrics
#   2. The Node update-agent inside the POS app — also hits /api/fleet/heartbeat, drives updates
# Long-term plan: consolidate to a single Node heartbeat path. This shell script
# will remain for initial registration and pre-boot metrics when the POS app isn't running.
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
SYNC_ENABLED="${SYNC_ENABLED:-false}"
NEON_CONFIGURED="false"
if [ -n "${NEON_DATABASE_URL:-}" ]; then
  NEON_CONFIGURED="true"
fi

# Get sync status from local POS (if running)
SYNC_STATUS="{}"
SYNC_JSON=$(curl -s --max-time 3 http://localhost:3005/api/internal/sync-status 2>/dev/null || echo "")
if [ -n "$SYNC_JSON" ] && echo "$SYNC_JSON" | python3 -m json.tool >/dev/null 2>&1; then
  SYNC_STATUS="$SYNC_JSON"
fi

# Get NUC readiness from dedicated endpoint (pre-normalized for heartbeat)
NUC_READINESS=""
PROVISION_KEY="${PROVISION_API_KEY:-}"
if [ -n "$PROVISION_KEY" ]; then
  NUC_READINESS=$(curl -s --max-time 3 \
    -H "x-api-key: $PROVISION_KEY" \
    http://localhost:3005/api/internal/nuc-readiness 2>/dev/null || echo "")
  # Validate JSON — drop if malformed (never invent healthy state)
  if [ -n "$NUC_READINESS" ]; then
    echo "$NUC_READINESS" | jq empty 2>/dev/null || NUC_READINESS=""
  fi
fi

# Build nucReadiness JSON fragment (empty string if unavailable)
NUC_READINESS_FRAGMENT=""
if [ -n "$NUC_READINESS" ]; then
  NUC_READINESS_FRAGMENT="\"nucReadiness\": $NUC_READINESS,"
fi

# Fallback: if POS app is not running, read sync-status.json state file directly.
# This ensures MC sees schema block state even when the app is down.
SYNC_STATUS_FRAGMENT=""
if [ -z "$NUC_READINESS" ] && [ -f /opt/gwi-pos/state/sync-status.json ]; then
  SYNC_STATUS_FILE=$(cat /opt/gwi-pos/state/sync-status.json 2>/dev/null || echo "")
  if [ -n "$SYNC_STATUS_FILE" ] && echo "$SYNC_STATUS_FILE" | jq empty 2>/dev/null; then
    SYNC_STATUS_FRAGMENT="\"syncStatusFile\": $SYNC_STATUS_FILE,"
  fi
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
  "syncEnabled": $SYNC_ENABLED,
  "neonConfigured": $NEON_CONFIGURED,
  $NUC_READINESS_FRAGMENT
  $SYNC_STATUS_FRAGMENT
  "syncStatus": $SYNC_STATUS
}
EOJSON
)

# HMAC signature
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$API_KEY" | awk '{print $NF}')

# Send to Mission Control and capture response
RESPONSE=$(curl -s --max-time 10 \
  -X POST "${MC_URL}/api/fleet/heartbeat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Server-Node-Id: $NODE_ID" \
  -H "X-Request-Signature: $SIG" \
  -d "$BODY" 2>/dev/null || echo "")

# Update cloud identity if heartbeat returned it
if [ -n "$RESPONSE" ]; then
  CLOUD_LOC=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(d.get('cloudLocationId',''))" 2>/dev/null || echo "")
  if [ -n "$CLOUD_LOC" ]; then
    CLOUD_ORG=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(d.get('cloudOrganizationId',''))" 2>/dev/null || echo "")
    CLOUD_ENT=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(d.get('cloudEnterpriseId',''))" 2>/dev/null || echo "")
    INTERNAL_SECRET="${INTERNAL_API_SECRET:-}"
    if [ -n "$INTERNAL_SECRET" ]; then
      curl -s --max-time 5 \
        -X POST "http://localhost:3005/api/internal/cloud-identity" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $INTERNAL_SECRET" \
        -d "{\"cloudLocationId\":\"$CLOUD_LOC\",\"cloudOrganizationId\":\"$CLOUD_ORG\",\"cloudEnterpriseId\":\"$CLOUD_ENT\"}" \
        >/dev/null 2>&1 || true
    fi
  fi

  # Version-targeted update: compare MC targetVersion to current running version
  TARGET_VER=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin).get('data',{}); print(d.get('targetVersion',''))" 2>/dev/null || echo "")
  if [ -n "$TARGET_VER" ]; then
    CURRENT_VER=$(python3 -c "import json; print(json.load(open('/opt/gwi-pos/app/package.json')).get('version','unknown'))" 2>/dev/null || echo "unknown")
    if [ "$CURRENT_VER" != "$TARGET_VER" ] && [ "$CURRENT_VER" != "unknown" ]; then
      # Trigger version-targeted update via local update agent
      INTERNAL_SECRET="${INTERNAL_API_SECRET:-}"
      if [ -n "$INTERNAL_SECRET" ]; then
        curl -s --max-time 5 \
          -X POST "http://localhost:3005/api/system/update" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $INTERNAL_SECRET" \
          -d "{\"targetVersion\":\"$TARGET_VER\"}" \
          >/dev/null 2>&1 || true
      else
        curl -s --max-time 5 \
          -X POST "http://localhost:3005/api/system/update" \
          -H "Content-Type: application/json" \
          -d "{\"targetVersion\":\"$TARGET_VER\"}" \
          >/dev/null 2>&1 || true
      fi
    fi
  fi
fi
