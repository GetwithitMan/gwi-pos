#!/usr/bin/env bash
# =============================================================================
# 04-database.sh — PostgreSQL setup, DB create, user, grants, replication
# =============================================================================
# Entry: run_database
# Expects: STATION_ROLE, USE_LOCAL_PG, POSUSER, POSUSER_HOME, APP_BASE,
#          ENV_FILE, VIRTUAL_IP, PRIMARY_NUC_IP, DATABASE_URL, DIRECT_URL
# Sets: DB_USER, DB_NAME, DB_PASSWORD, DATABASE_URL, DIRECT_URL, REPL_PASSWORD,
#       NEON_PSQL
# =============================================================================

run_database() {
  local _start=$(date +%s)
  log "Stage: database — starting"

  # ─────────────────────────────────────────────────────────────────────────────
  # Common Setup (Both Roles) — Dependencies
  # ─────────────────────────────────────────────────────────────────────────────

  header "Installing Dependencies"

  # Ensure cron is installed (needed for heartbeat + backup jobs)
  apt-get install -y cron 2>/dev/null || true
  systemctl enable cron 2>/dev/null || true
  systemctl start cron 2>/dev/null || true

  # ── Kiosk helper scripts (both server + terminal roles need these) ──
  # Health-check gate script — kiosk waits for POS server to be ready
  mkdir -p /opt/gwi-pos
  cat > /opt/gwi-pos/wait-for-pos.sh <<'WAITEOF'
#!/bin/bash
URL="${1:-http://localhost:3005/login}"
TIMEOUT=120
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  if curl -sf -o /dev/null "$URL" 2>/dev/null; then
    exit 0
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo "POS server not ready after ${TIMEOUT}s" >&2
exit 1
WAITEOF
  chmod +x /opt/gwi-pos/wait-for-pos.sh

  # Clear Chromium session data — prevents stale "site can't be reached" restore
  cat > /opt/gwi-pos/clear-kiosk-session.sh <<'CLEAREOF'
#!/bin/bash
# Chromium restores previous sessions on launch. If the POS was down when
# Chromium last ran, it caches the error page and restores it even after
# the POS comes back up. Wipe session/cache so kiosk always starts fresh.
SNAP_PROFILE="$HOME/snap/chromium/common/chromium/Default"
NATIVE_PROFILE="$HOME/.config/chromium/Default"
KIOSK_PROFILE="/opt/gwi-pos/kiosk-profile/Default"
for PROFILE in "$SNAP_PROFILE" "$NATIVE_PROFILE" "$KIOSK_PROFILE"; do
  if [ -d "$PROFILE" ]; then
    rm -rf "$PROFILE/Sessions" "$PROFILE/Session Storage" \
           "$PROFILE/Cache" "$PROFILE/Code Cache" \
           "$PROFILE/GPUCache" "$PROFILE/DawnGraphiteCache" \
           "$PROFILE/Service Worker/CacheStorage"
  fi
done
exit 0
CLEAREOF
  chmod +x /opt/gwi-pos/clear-kiosk-session.sh

  # ─────────────────────────────────────────────────────────────────────────────
  # Server Role: Heartbeat Script + Cron (runs early — before app build)
  # ─────────────────────────────────────────────────────────────────────────────
  # IMPORTANT: Heartbeat is set up immediately after cron + .env exist so that
  # Mission Control sees the NUC even if a later step (npm build, service start)
  # fails. The heartbeat script is self-contained and doesn't need the app.

  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]] && [[ -f "$ENV_FILE" ]]; then
    header "Setting Up Heartbeat"

    # Ensure POSUSER owns the base directory (needed to write heartbeat.log)
    chown "$POSUSER":"$POSUSER" "$APP_BASE"

    HB_SCRIPT="$APP_BASE/heartbeat.sh"
    cat > "$HB_SCRIPT" <<'HBEOF'
#!/usr/bin/env bash
# GWI POS Heartbeat — sends system metrics to Mission Control
set -eo pipefail

LOG="/opt/gwi-pos/heartbeat.log"

# Guard: node is required for batch info parsing — skip silently if not yet installed
command -v node >/dev/null 2>&1 || exit 0

ENV_FILE="/opt/gwi-pos/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERR no-env $(date -u +%H:%M:%S)" >> "$LOG"
  exit 1
fi

# Parse env (line-by-line, handles values with = signs and # in values)
SERVER_NODE_ID="" SERVER_API_KEY="" HARDWARE_FINGERPRINT="" MISSION_CONTROL_URL="" LOCATION_ID=""
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  line="${line#"${line%%[![:space:]]*}"}"
  [[ -z "$line" ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  case "$key" in
    SERVER_NODE_ID)       SERVER_NODE_ID="$val" ;;
    SERVER_API_KEY)       SERVER_API_KEY="$val" ;;
    HARDWARE_FINGERPRINT) HARDWARE_FINGERPRINT="$val" ;;
    MISSION_CONTROL_URL)  MISSION_CONTROL_URL="$val" ;;
    LOCATION_ID)          LOCATION_ID="$val" ;;
  esac
done < "$ENV_FILE"

if [[ -z "$SERVER_NODE_ID" || -z "$SERVER_API_KEY" || -z "$MISSION_CONTROL_URL" ]]; then
  echo "ERR missing-env NODE=${SERVER_NODE_ID:-(empty)} KEY=${SERVER_API_KEY:+set} MC=${MISSION_CONTROL_URL:-(empty)} $(date -u +%H:%M:%S)" >> "$LOG"
  exit 1
fi

# Metrics
UPTIME=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null || echo 0)
CPU=$(awk '/^cpu /{u=$2+$4; t=$2+$4+$5; printf "%.1f", u*100/t}' /proc/stat 2>/dev/null || echo "0")
MEM_TOTAL=$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || echo 1)
MEM_USED=$(free -m 2>/dev/null | awk '/Mem:/{print $3}' || echo 0)
DISK_TOTAL=$(df -BG / 2>/dev/null | awk 'NR==2{gsub("G",""); print $2+0}' || echo 1)
DISK_USED=$(df -BG / 2>/dev/null | awk 'NR==2{gsub("G",""); print $3+0}' || echo 0)
VERSION=$(jq -r '.version // "unknown"' /opt/gwi-pos/app/package.json 2>/dev/null || echo "unknown")
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")

# Read last batch info (from file written at batch close time)
BATCH_CLOSED_AT="null"
BATCH_STATUS="null"
BATCH_ITEM_COUNT="null"
BATCH_NO="null"
if [ -f /opt/gwi-pos/last-batch.json ]; then
  BATCH_CLOSED_AT=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('/opt/gwi-pos/last-batch.json','utf-8'));process.stdout.write('\"'+(d.closedAt||'')+'\"')}catch(e){process.stdout.write('null')}" 2>/dev/null)
  BATCH_STATUS=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('/opt/gwi-pos/last-batch.json','utf-8'));process.stdout.write('\"'+(d.status||'unknown')+'\"')}catch(e){process.stdout.write('null')}" 2>/dev/null)
  BATCH_ITEM_COUNT=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('/opt/gwi-pos/last-batch.json','utf-8'));process.stdout.write(String(d.itemCount||0))}catch(e){process.stdout.write('null')}" 2>/dev/null)
  BATCH_NO=$(node -e "try{const d=JSON.parse(require('fs').readFileSync('/opt/gwi-pos/last-batch.json','utf-8'));process.stdout.write('\"'+(d.batchNo||'')+'\"')}catch(e){process.stdout.write('null')}" 2>/dev/null)
fi

# Get live batch status from local POS API (open orders, unadjusted tips, batch total)
OPEN_ORDER_COUNT="null"
UNADJUSTED_TIP_COUNT="null"
CURRENT_BATCH_TOTAL="null"
BATCH_API=$(curl -sf --max-time 3 "http://localhost:3005/api/system/batch-status" 2>/dev/null || echo '{}')
if [ -n "$BATCH_API" ] && [ "$BATCH_API" != '{}' ]; then
  OPEN_ORDER_COUNT=$(echo "$BATCH_API" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const v=d?.data?.openOrderCount;process.stdout.write(v!=null?String(v):'null')}catch(e){process.stdout.write('null')}" 2>/dev/null)
  UNADJUSTED_TIP_COUNT=$(echo "$BATCH_API" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const v=d?.data?.unadjustedTipCount;process.stdout.write(v!=null?String(v):'null')}catch(e){process.stdout.write('null')}" 2>/dev/null)
  CURRENT_BATCH_TOTAL=$(echo "$BATCH_API" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));const v=d?.data?.currentBatchTotal;process.stdout.write(v!=null?String(v):'null')}catch(e){process.stdout.write('null')}" 2>/dev/null)
fi

BODY=$(jq -nc \
  --arg version "$VERSION" \
  --argjson uptime "${UPTIME:-0}" \
  --argjson cpuPercent "${CPU:-0}" \
  --argjson memoryUsedMb "${MEM_USED:-0}" \
  --argjson memoryTotalMb "${MEM_TOTAL:-1}" \
  --argjson diskUsedGb "${DISK_USED:-0}" \
  --argjson diskTotalGb "${DISK_TOTAL:-1}" \
  --arg localIp "$LOCAL_IP" \
  --arg posLocationId "${LOCATION_ID:-}" \
  --argjson batchClosedAt "${BATCH_CLOSED_AT:-null}" \
  --argjson batchStatus "${BATCH_STATUS:-null}" \
  --argjson batchItemCount "${BATCH_ITEM_COUNT:-null}" \
  --argjson batchNo "${BATCH_NO:-null}" \
  --argjson openOrderCount "${OPEN_ORDER_COUNT:-null}" \
  --argjson unadjustedTipCount "${UNADJUSTED_TIP_COUNT:-null}" \
  --argjson currentBatchTotal "${CURRENT_BATCH_TOTAL:-null}" \
  '{version:$version,uptime:$uptime,activeOrders:0,cpuPercent:$cpuPercent,memoryUsedMb:$memoryUsedMb,memoryTotalMb:$memoryTotalMb,diskUsedGb:$diskUsedGb,diskTotalGb:$diskTotalGb,localIp:$localIp,posLocationId:$posLocationId,batchClosedAt:$batchClosedAt,batchStatus:$batchStatus,batchItemCount:$batchItemCount,batchNo:$batchNo,openOrderCount:$openOrderCount,unadjustedTipCount:$unadjustedTipCount,currentBatchTotal:$currentBatchTotal}')

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SERVER_API_KEY" 2>/dev/null | awk '{print $NF}')

RESP_FILE=$(mktemp)
HTTP_CODE=$(curl -sS --max-time 15 -o "$RESP_FILE" -w "%{http_code}" -X POST \
  "${MISSION_CONTROL_URL}/api/fleet/heartbeat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SERVER_API_KEY" \
  -H "X-Server-Node-Id: $SERVER_NODE_ID" \
  -H "X-Hardware-Fingerprint: ${HARDWARE_FINGERPRINT:-none}" \
  -H "X-Request-Signature: $SIG" \
  -d "$BODY" 2>&1) || HTTP_CODE="err"

# Log result — include response body on failures for debugging
if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "201" ]]; then
  echo "OK $HTTP_CODE $(date -u +%H:%M:%S)" >> "$LOG"
else
  RESP_BODY=$(cat "$RESP_FILE" 2>/dev/null | head -c 200 || echo "")
  echo "FAIL $HTTP_CODE $(date -u +%H:%M:%S) $RESP_BODY" >> "$LOG"
fi
rm -f "$RESP_FILE"

# Keep log small
if [[ -f "$LOG" ]] && [[ $(wc -l < "$LOG") -gt 500 ]]; then
  tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
HBEOF

    chmod +x "$HB_SCRIPT"
    chown "$POSUSER":"$POSUSER" "$HB_SCRIPT"

    # Add heartbeat cron (every minute, as POSUSER)
    HB_CRON="* * * * * $HB_SCRIPT"
    ( crontab -u "$POSUSER" -l 2>/dev/null | grep -v "$HB_SCRIPT" || true ; echo "$HB_CRON" ) | crontab -u "$POSUSER" -

    # Run first heartbeat NOW (visible output so user can see if it works)
    log "Testing first heartbeat..."
    if sudo -u "$POSUSER" bash "$HB_SCRIPT"; then
      LAST_HB=$(tail -1 "$APP_BASE/heartbeat.log" 2>/dev/null || echo "no log")
      if [[ "$LAST_HB" == OK* ]]; then
        log "Heartbeat: $LAST_HB"
      else
        warn "Heartbeat response: $LAST_HB"
        warn "Check /opt/gwi-pos/heartbeat.log for details."
      fi
    else
      warn "First heartbeat failed. Check /opt/gwi-pos/heartbeat.log"
    fi

    log "Heartbeat configured (every 60 seconds)."
  fi

  # ── Install Chromium (prefer native .deb over snap for systemd compatibility) ──
  # On Ubuntu 24.04, `apt-get install chromium` installs the SNAP version, which
  # cannot run inside a systemd service due to AppArmor sandboxing. We try multiple
  # methods to get a native .deb Chromium that works as a kiosk service.
  log "Installing Chromium browser..."
  CHROMIUM_BIN=""

  # Method 1: Try native chromium-browser package (exists on some Ubuntu flavors)
  if apt-get install -y chromium-browser 2>/dev/null; then
    if command -v chromium-browser >/dev/null 2>&1 && ! snap list chromium-browser >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium-browser"
      log "Chromium installed (native chromium-browser)"
    fi
  fi

  # Method 2: Try native chromium, avoiding snap redirect
  if [[ -z "$CHROMIUM_BIN" ]]; then
    # Remove snap Chromium if present (can't run in systemd)
    if snap list chromium >/dev/null 2>&1; then
      log "Removing snap Chromium (incompatible with systemd kiosk)..."
      snap remove chromium 2>/dev/null || true
    fi

    # Check if a native chromium exists after snap removal
    if command -v chromium-browser >/dev/null 2>&1 && ! snap list chromium-browser >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium-browser"
      log "Chromium available (native chromium-browser after snap removal)"
    elif command -v chromium >/dev/null 2>&1 && ! snap list chromium >/dev/null 2>&1; then
      CHROMIUM_BIN="chromium"
      log "Chromium available (native chromium after snap removal)"
    else
      # Pin apt to avoid snap redirect, then install
      log "Pinning apt to avoid snap redirect for Chromium..."
      cat > /etc/apt/preferences.d/chromium-no-snap.pref <<'APTPIN'
Package: chromium*
Pin: release a=*
Pin-Priority: -1

Package: chromium*
Pin: origin "*.ubuntu.com"
Pin-Priority: 500

Package: chromium*
Pin: origin "*.debian.org"
Pin-Priority: 500
APTPIN

      apt-get update -qq 2>/dev/null || true
      apt-get install -y --no-install-recommends chromium 2>/dev/null || true

      if command -v chromium >/dev/null 2>&1 && ! snap list chromium >/dev/null 2>&1; then
        CHROMIUM_BIN="chromium"
        log "Chromium installed (native .deb via apt pinning)"
      elif command -v chromium-browser >/dev/null 2>&1 && ! snap list chromium-browser >/dev/null 2>&1; then
        CHROMIUM_BIN="chromium-browser"
        log "Chromium installed (native chromium-browser via apt pinning)"
      else
        # Last resort: install snap but create a wrapper that works in systemd
        log "No native Chromium available — installing snap with systemd wrapper..."
        snap install chromium 2>/dev/null || apt-get install -y chromium 2>/dev/null || true

        if snap list chromium >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1; then
          # Create wrapper script that runs snap chromium with proper environment
          cat > /usr/local/bin/chromium-kiosk <<'WRAPPER'
#!/bin/bash
# Wrapper for snap Chromium to work in systemd services.
# Snap apps need HOME and XDG_RUNTIME_DIR set correctly.
export HOME="${HOME:-/home/$(whoami)}"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
# Use snap binary if available, fall back to PATH
if [[ -x /snap/bin/chromium ]]; then
  exec /snap/bin/chromium "$@"
else
  exec chromium "$@"
fi
WRAPPER
          chmod +x /usr/local/bin/chromium-kiosk
          CHROMIUM_BIN="chromium-kiosk"
          log "Chromium installed (snap with systemd wrapper at /usr/local/bin/chromium-kiosk)"
        fi
      fi
    fi
  fi

  if [[ -z "$CHROMIUM_BIN" ]]; then
    track_warn "Chromium install failed — kiosk mode may not work."
  else
    log "Browser ready: $CHROMIUM_BIN"
  fi

  # Install Node.js 20 via pinned apt repo (no shell script execution)
  install_node20() {
    log "Setting up NodeSource repository for Node.js 20..."
    local KEYRING="/usr/share/keyrings/nodesource.gpg"
    # Download and install the GPG key
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o "$KEYRING" 2>/dev/null
    # Add the repo with pinned key
    echo "deb [signed-by=$KEYRING] https://deb.nodesource.com/node_20.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list
    apt-get update -qq
    apt-get install -y nodejs
  }

  if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 20..."
    install_node20
  elif [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
    log "Upgrading Node.js to 20..."
    install_node20
  fi
  log "Node.js: $(node -v)"
  log "npm: $(npm -v)"

  # ─────────────────────────────────────────────────────────────────────────────
  # PostgreSQL Official Apt Repository (PGDG)
  # ─────────────────────────────────────────────────────────────────────────────
  # Required for PG17 packages on Ubuntu 22.04/24.04. Neon runs PG17, so we
  # need postgresql-client-17 (pg_dump, psql, pg_restore) to talk to Neon.
  # The local server also installs PG17 via this repo.

  if ! dpkg -l postgresql-client-17 >/dev/null 2>&1; then
    log "Adding PostgreSQL official apt repository (PGDG) for PG17..."
    # Use VERSION_CODENAME from /etc/os-release (already sourced above)
    local_codename="${VERSION_CODENAME:-$(. /etc/os-release && echo "$VERSION_CODENAME")}"
    echo "deb [signed-by=/usr/share/keyrings/postgresql-archive-keyring.gpg] http://apt.postgresql.org/pub/repos/apt ${local_codename}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/keyrings/postgresql-archive-keyring.gpg 2>/dev/null
    apt-get update -qq
  fi
  apt-get install -y postgresql-client-17 || warn "Could not install postgresql-client-17 — pg_dump may fail against Neon PG17"

  # Set up PG17 binary aliases for Neon connections
  # (Neon runs PG17; version mismatch causes pg_dump to abort)
  NEON_PSQL="/usr/lib/postgresql/17/bin/psql"
  if [[ ! -x "$NEON_PSQL" ]]; then
    NEON_PSQL="psql"
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # Server Role: Local PostgreSQL (always — offline-first architecture)
  # ─────────────────────────────────────────────────────────────────────────────

  if [[ "$STATION_ROLE" == "server" ]] && [[ "$USE_LOCAL_PG" == "true" ]]; then
    header "Setting Up Local PostgreSQL"

    # Unmask first — may have been masked by a prior server->terminal switch
    systemctl unmask postgresql 2>/dev/null || true

    apt-get install -y postgresql-17 postgresql-contrib-17 || apt-get install -y postgresql postgresql-contrib

    # Ensure PostgreSQL is running
    systemctl enable postgresql
    systemctl start postgresql

    DB_USER="thepasspos"
    DB_NAME="thepasspos"

    # Reuse existing password from .env on re-runs; generate random on first install
    # Try 3 sources: DATABASE_URL in .env -> .pgpass -> generate new
    # If generating new, ALTER ROLE will sync PG to match (idempotent)
    # Try 4 sources: DB_PASSWORD in .env -> DATABASE_URL in .env -> .pgpass -> generate new
    EXISTING_DB_PW=""
    if [[ -f "$ENV_FILE" ]]; then
      # Prefer explicit DB_PASSWORD var (avoids URL parsing)
      EXISTING_DB_PW=$(grep "^DB_PASSWORD=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | head -1 || echo "")
      # Fallback: parse from DATABASE_URL (less reliable for special chars)
      if [[ -z "$EXISTING_DB_PW" ]]; then
        EXISTING_DB_PW=$(grep "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p' | head -1 || echo "")
      fi
    fi
    if [[ -z "$EXISTING_DB_PW" ]] && [[ -f "$POSUSER_HOME/.pgpass" ]]; then
      EXISTING_DB_PW=$(grep "localhost:5432:$DB_NAME:$DB_USER:" "$POSUSER_HOME/.pgpass" 2>/dev/null | cut -d: -f5 | head -1 || echo "")
    fi
    if [[ -n "$EXISTING_DB_PW" ]]; then
      DB_PASSWORD="$EXISTING_DB_PW"
      log "Reusing existing database password."
    else
      DB_PASSWORD=$(openssl rand -hex 16)
      # If PG role already exists, warn that password is being reset
      if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; then
        warn "Database user '$DB_USER' exists but password not found in .env or .pgpass."
        warn "Generating new password — ALTER ROLE will update PostgreSQL to match."
      fi
      log "Generated new random database password."
    fi

    # Create database and user (idempotent)
    log "Creating database '$DB_NAME' and user '$DB_USER'..."
    sudo -u postgres psql -v ON_ERROR_STOP=0 <<EOSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASSWORD';
  END IF;
END\$\$;

SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
EOSQL

    # Allow local connections with password
    PG_HBA=$(sudo -u postgres psql -t -c "SHOW hba_file;" | tr -d '[:space:]')
    # Check for exact managed lines (not just username anywhere in file)
    GWI_HBA_MARKER="# GWI POS — added by installer.run"
    if ! grep -qF "$GWI_HBA_MARKER" "$PG_HBA" 2>/dev/null; then
      log "Adding $DB_USER to pg_hba.conf..."
      cat >> "$PG_HBA" <<HBAEOF

$GWI_HBA_MARKER
local   $DB_NAME   $DB_USER   md5
host    $DB_NAME   $DB_USER   127.0.0.1/32   md5
HBAEOF
      systemctl reload postgresql
    fi

    # Verify database connection works
    if sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
      log "Database connection verified."
    else
      err "Cannot connect to PostgreSQL as $DB_USER."
      err "Check pg_hba.conf at: $PG_HBA"
      err "Ensure the line 'local $DB_NAME $DB_USER md5' exists."
      return 1
    fi

    # Grant full permissions to the POS user on all existing and future tables.
    # This is critical because prisma db push may be run as postgres (root) but
    # the POS app connects as $DB_USER. Without these grants, the app gets
    # "relation does not exist" errors despite tables existing.
    sudo -u postgres psql -d "$DB_NAME" -c "
      GRANT ALL ON ALL TABLES IN SCHEMA public TO $DB_USER;
      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
    " >/dev/null 2>&1
    # Disable RLS on all tables — prisma db push enables it as part of the schema,
    # but the POS app user doesn't have the right RLS policies configured.
    # RLS blocks downstream sync, menu queries, and login. Must be disabled.
    sudo -u postgres psql -d "$DB_NAME" -c "
      DO \$\$ DECLARE r RECORD; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = true LOOP
          EXECUTE 'ALTER TABLE public.\"' || r.tablename || '\" DISABLE ROW LEVEL SECURITY';
        END LOOP;
      END \$\$;
    " >/dev/null 2>&1
    log "Database permissions granted + RLS disabled for $DB_USER."

    # Set UTC timezone for database (CRITICAL for offline-first sync integrity)
    # Without this, timestamps synced from Neon cloud can be silently shifted by the
    # local timezone offset when inserted into "timestamp without time zone" columns.
    # See Skill 449 for full root cause analysis.
    log "Setting database timezone to UTC..."
    sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" \
      -c "ALTER DATABASE $DB_NAME SET timezone = 'UTC';" >/dev/null 2>&1 || {
      warn "Failed to set database timezone to UTC — data sync may have timestamp inconsistencies."
    }

    # Create .pgpass for passwordless pg_dump in backups/cron
    PGPASS_FILE="$POSUSER_HOME/.pgpass"
    echo "localhost:5432:$DB_NAME:$DB_USER:$DB_PASSWORD" > "$PGPASS_FILE"
    chmod 600 "$PGPASS_FILE"
    chown "$POSUSER":"$POSUSER" "$PGPASS_FILE"

    # Set DATABASE_URL for local PostgreSQL
    DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
    DIRECT_URL="$DATABASE_URL"

    # Update .env with local database URLs
    if grep -q "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
      sed -i "s|^DIRECT_URL=.*|DIRECT_URL=$DIRECT_URL|" "$ENV_FILE"
    else
      echo "" >> "$ENV_FILE"
      echo "# Local PostgreSQL" >> "$ENV_FILE"
      echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
      echo "DIRECT_URL=$DIRECT_URL" >> "$ENV_FILE"
    fi

    # Also add DB_USER/DB_NAME/DB_PASSWORD for backup script and re-run password detection
    if ! grep -q "^DB_USER=" "$ENV_FILE" 2>/dev/null; then
      echo "DB_USER=$DB_USER" >> "$ENV_FILE"
      echo "DB_NAME=$DB_NAME" >> "$ENV_FILE"
    fi
    # Persist DB_PASSWORD separately — avoids fragile DATABASE_URL regex parsing on re-runs
    if grep -q "^DB_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" "$ENV_FILE"
    else
      echo "DB_PASSWORD=$DB_PASSWORD" >> "$ENV_FILE"
    fi

    log "PostgreSQL ready: $DB_NAME owned by $DB_USER"

    # ── Server HA: configure PG as primary for streaming replication ──
    if [[ -n "${VIRTUAL_IP:-}" ]]; then
      header "Configuring PostgreSQL Primary for Replication"

      # Ensure NTP is running (clock sync critical for replication)
      timedatectl set-ntp true 2>/dev/null || true

      PG_CONF=$(sudo -u postgres psql -t -c "SHOW config_file;" | tr -d '[:space:]')
      PG_HBA=${PG_HBA:-$(sudo -u postgres psql -t -c "SHOW hba_file;" | tr -d '[:space:]')}

      # Configure WAL settings for streaming replication
      REPL_MARKER="# GWI POS HA — streaming replication"
      if ! grep -qF "$REPL_MARKER" "$PG_CONF" 2>/dev/null; then
        log "Configuring postgresql.conf for replication..."
        cat >> "$PG_CONF" <<REPLEOF

$REPL_MARKER
wal_level = replica
max_wal_senders = 3
wal_keep_size = '1GB'
# Allow per-transaction synchronous_commit = 'remote_apply' for payment durability.
# 'ANY 1 (*)' means: wait for ANY one standby to confirm. If no standby is
# connected, PG falls back to async (no blocking). Only payment transactions
# opt in via SET LOCAL — all other writes remain async by default.
synchronous_standby_names = 'ANY 1 (*)'
REPLEOF
      fi

      # Create replication user (idempotent)
      # Only generate REPL_PASSWORD on first install, not re-runs.
      # On re-runs, read the existing password from .env to avoid rotating
      # the replication password (which would break the standby connection).
      EXISTING_REPL_PW=""
      if [[ -f "$ENV_FILE" ]]; then
        EXISTING_REPL_PW=$(grep "^REPL_PASSWORD=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 | head -1 || echo "")
      fi
      if [[ -n "$EXISTING_REPL_PW" ]]; then
        REPL_PASSWORD="$EXISTING_REPL_PW"
        log "Reusing existing replication password from .env."
      else
        REPL_PASSWORD=$(openssl rand -hex 16)
        log "Generated new replication password."
      fi
      sudo -u postgres psql -v ON_ERROR_STOP=0 <<REPLSQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '$REPL_PASSWORD';
  ELSE
    ALTER ROLE replicator WITH PASSWORD '$REPL_PASSWORD';
  END IF;
END\$\$;
REPLSQL

      # Save replication password for backup NUC provisioning
      if ! grep -q "^REPL_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
        echo "REPL_PASSWORD=$REPL_PASSWORD" >> "$ENV_FILE"
      else
        sed -i "s|^REPL_PASSWORD=.*|REPL_PASSWORD=$REPL_PASSWORD|" "$ENV_FILE"
      fi

      # Create replication slot for the standby (prevents WAL recycling before standby catches up)
      # Replication slots are more reliable than fixed wal_keep_size for WAL retention.
      log "Creating replication slot 'standby_slot'..."
      sudo -u postgres psql -c "SELECT pg_create_physical_replication_slot('standby_slot', true);" 2>/dev/null || true

      # Add pg_hba entry allowing replication connections from the local subnet only
      REPL_HBA_MARKER="# GWI POS HA — replication access"
      # Detect actual subnet mask from the interface instead of hardcoding /24
      LOCAL_IP=$(hostname -I | awk '{print $1}')
      LOCAL_CIDR=$(ip -o -4 addr show 2>/dev/null | awk -v ip="$LOCAL_IP" '$4 ~ ip {print $4; exit}')
      if [[ -n "$LOCAL_CIDR" ]]; then
        # Compute network address using the actual prefix length from the interface
        LOCAL_SUBNET=$(python3 -c "import ipaddress; print(ipaddress.ip_network('${LOCAL_CIDR}', strict=False))" 2>/dev/null || echo "${LOCAL_CIDR}")
      else
        # Fallback: assume /24 if ip addr detection fails
        LOCAL_SUBNET=$(echo "$LOCAL_IP" | sed 's/\.[0-9]*$/\.0\/24/')
        warn "Could not detect subnet mask — defaulting to ${LOCAL_SUBNET}"
      fi
      if ! grep -qF "$REPL_HBA_MARKER" "$PG_HBA" 2>/dev/null; then
        log "Adding replication access to pg_hba.conf (subnet: ${LOCAL_SUBNET})..."
        cat >> "$PG_HBA" <<REPHBA

$REPL_HBA_MARKER
host    replication     replicator      ${LOCAL_SUBNET}       md5
REPHBA
      fi

      systemctl restart postgresql
      log "PostgreSQL primary configured for streaming replication."
    fi
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # Backup Role: PostgreSQL Streaming Replication (standby)
  # ─────────────────────────────────────────────────────────────────────────────

  if [[ "$STATION_ROLE" == "backup" ]] && [[ "$USE_LOCAL_PG" == "true" ]]; then
    header "Setting Up PostgreSQL Standby (Backup)"

    # Ensure NTP is running (clock sync critical for replication)
    timedatectl set-ntp true 2>/dev/null || true

    # Unmask first — may have been masked by a prior role switch
    systemctl unmask postgresql 2>/dev/null || true

    apt-get install -y postgresql-17 postgresql-contrib-17 || apt-get install -y postgresql postgresql-contrib

    DB_USER="thepasspos"
    DB_NAME="thepasspos"

    # Get replication password from user (must match primary's REPL_PASSWORD)
    echo ""
    echo "Enter the replication password from the primary server."
    echo "(Found in the primary's /opt/gwi-pos/.env as REPL_PASSWORD)"
    echo ""
    read -rsp "Replication password: " REPL_PASSWORD < /dev/tty
    echo ""
    if [[ -z "$REPL_PASSWORD" ]]; then
      err "Replication password is required for backup setup."
      return 1
    fi

    # Get the app database password from primary (for DATABASE_URL)
    echo ""
    echo "Enter the database password from the primary server."
    echo "(Found in primary's /opt/gwi-pos/.env in DATABASE_URL after the colon)"
    echo ""
    read -rsp "Database password: " DB_PASSWORD < /dev/tty
    echo ""
    if [[ -z "$DB_PASSWORD" ]]; then
      err "Database password is required for backup setup."
      return 1
    fi

    # Detect installed PostgreSQL version (may be 16 or 17)
    PG_VERSION=$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}' || echo "16")
    PG_DATA="/var/lib/postgresql/${PG_VERSION}/main"

    # SAFETY: Verify primary is reachable and credentials work BEFORE deleting data.
    # A failed pg_basebackup after data deletion leaves an empty, unrecoverable box.
    log "Verifying replication connectivity to primary ($PRIMARY_NUC_IP)..."
    if ! PGPASSWORD="$REPL_PASSWORD" psql -h "$PRIMARY_NUC_IP" -U replicator -d postgres -c "SELECT 1" >/dev/null 2>&1; then
      err "Cannot connect to primary NUC at $PRIMARY_NUC_IP as replicator."
      err "Fix the connection before proceeding — NOT deleting local data."
      err "Check: IP reachable, REPL_PASSWORD correct, pg_hba.conf allows this IP."
      return 1
    fi
    log "Primary replication connection verified."

    # Stop PostgreSQL before pg_basebackup
    systemctl stop postgresql

    # Clear existing data directory for fresh base backup (safe — we verified primary first)
    if [[ -d "$PG_DATA" ]]; then
      log "Clearing existing PostgreSQL data directory..."
      rm -rf "$PG_DATA"
    fi

    # Run pg_basebackup from primary
    log "Running pg_basebackup from primary ($PRIMARY_NUC_IP)..."
    log "This may take several minutes depending on database size..."
    if ! PGPASSWORD="$REPL_PASSWORD" sudo -u postgres pg_basebackup \
      -h "$PRIMARY_NUC_IP" -U replicator -D "$PG_DATA" -P -R -Xs --slot=standby_slot; then
      err "pg_basebackup failed. Check:"
      err "  - Primary NUC IP ($PRIMARY_NUC_IP) is reachable"
      err "  - Replication password matches primary's REPL_PASSWORD"
      err "  - Primary has replication configured (wal_level=replica)"
      err "  - Primary pg_hba.conf allows replication from this IP"
      return 1
    fi

    # pg_basebackup with -R creates standby.signal and sets primary_conninfo
    # Verify standby.signal was created
    if [[ ! -f "$PG_DATA/standby.signal" ]]; then
      log "Creating standby.signal..."
      touch "$PG_DATA/standby.signal"
      chown postgres:postgres "$PG_DATA/standby.signal"
    fi

    # Ensure correct ownership
    chown -R postgres:postgres "$PG_DATA"

    # Start PostgreSQL in standby mode
    systemctl enable postgresql
    systemctl start postgresql

    # Verify replication is working
    sleep 3
    RECOVERY_STATUS=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery();" 2>/dev/null || echo "")
    if [[ "$RECOVERY_STATUS" == "t" ]]; then
      log "PostgreSQL standby is running and receiving WAL from primary."
    else
      warn "PostgreSQL started but may not be in recovery mode."
      warn "Check: sudo -u postgres psql -c 'SELECT pg_is_in_recovery();'"
    fi

    # Create .pgpass for the app database user
    PGPASS_FILE="$POSUSER_HOME/.pgpass"
    echo "localhost:5432:$DB_NAME:$DB_USER:$DB_PASSWORD" > "$PGPASS_FILE"
    chmod 600 "$PGPASS_FILE"
    chown "$POSUSER":"$POSUSER" "$PGPASS_FILE"

    # Set DATABASE_URL for local PostgreSQL (read-only on standby)
    DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
    DIRECT_URL="$DATABASE_URL"

    # Update .env with local database URLs
    if grep -q "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
      sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" "$ENV_FILE"
      sed -i "s|^DIRECT_URL=.*|DIRECT_URL=$DIRECT_URL|" "$ENV_FILE"
    else
      echo "" >> "$ENV_FILE"
      echo "# Local PostgreSQL (standby — read-only until promoted)" >> "$ENV_FILE"
      echo "DATABASE_URL=$DATABASE_URL" >> "$ENV_FILE"
      echo "DIRECT_URL=$DIRECT_URL" >> "$ENV_FILE"
    fi

    # Also add DB_USER/DB_NAME + REPL_PASSWORD for scripts
    if ! grep -q "^DB_USER=" "$ENV_FILE" 2>/dev/null; then
      echo "DB_USER=$DB_USER" >> "$ENV_FILE"
      echo "DB_NAME=$DB_NAME" >> "$ENV_FILE"
    fi
    if ! grep -q "^REPL_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
      echo "REPL_PASSWORD=$REPL_PASSWORD" >> "$ENV_FILE"
    else
      sed -i "s|^REPL_PASSWORD=.*|REPL_PASSWORD=$REPL_PASSWORD|" "$ENV_FILE"
    fi

    log "PostgreSQL standby ready: replicating from $PRIMARY_NUC_IP"
  fi

  log "Stage: database — completed in $(( $(date +%s) - _start ))s"
  return 0
}
