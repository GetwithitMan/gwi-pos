#!/usr/bin/env bash
# =============================================================================
# check-replication.sh -- Reports PG replication status as JSON for heartbeat
# =============================================================================
# Writes /opt/gwi-pos/state/replication-status.json which the heartbeat script
# reads and includes in the MC payload. Designed to be called from cron or
# from the heartbeat script itself.
#
# Deployed to: /opt/gwi-pos/scripts/check-replication.sh
# =============================================================================

set -euo pipefail

ENV_FILE="/opt/gwi-pos/.env"
STATE_DIR="/opt/gwi-pos/state"
STATE_FILE="$STATE_DIR/replication-status.json"

mkdir -p "$STATE_DIR"

# Parse STATION_ROLE from .env
ROLE="unknown"
if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    if [[ "$key" == "STATION_ROLE" ]]; then
      ROLE="$val"
      break
    fi
  done < "$ENV_FILE"
fi

if [[ "$ROLE" == "backup" ]]; then
  IN_RECOVERY=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "unknown")
  LAG_BYTES=$(sudo -u postgres psql -tAc "SELECT COALESCE(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()), -1)" 2>/dev/null || echo "-1")
  LAST_RECEIVE=$(sudo -u postgres psql -tAc "SELECT COALESCE(pg_last_wal_receive_lsn()::text, 'none')" 2>/dev/null || echo "none")

  cat > "$STATE_FILE" <<EOJSON
{"role":"backup","inRecovery":$( [[ "$IN_RECOVERY" == "t" ]] && echo "true" || echo "false"),"lagBytes":$LAG_BYTES,"lastReceiveLsn":"$LAST_RECEIVE","checkedAt":"$(date -u +%FT%TZ)"}
EOJSON

elif [[ "$ROLE" == "server" ]]; then
  SLOT_COUNT=$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_replication_slots" 2>/dev/null || echo "0")
  ACTIVE_CONNECTIONS=$(sudo -u postgres psql -tAc "SELECT count(*) FROM pg_stat_replication" 2>/dev/null || echo "0")

  cat > "$STATE_FILE" <<EOJSON
{"role":"server","replicationSlots":$SLOT_COUNT,"activeReplicas":$ACTIVE_CONNECTIONS,"checkedAt":"$(date -u +%FT%TZ)"}
EOJSON

else
  # Not a server or backup role -- write a no-op status
  cat > "$STATE_FILE" <<EOJSON
{"role":"$ROLE","replicationEnabled":false,"checkedAt":"$(date -u +%FT%TZ)"}
EOJSON
fi
