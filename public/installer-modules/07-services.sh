#!/usr/bin/env bash
# =============================================================================
# 07-services.sh — systemd units (thepasspos, sync-agent), sudoers,
#                  backups, pre-start, terminal kiosk (kiosk removed from server)
# =============================================================================
# Entry: run_services
# Expects: STATION_ROLE, APP_BASE, APP_DIR, ENV_FILE, POSUSER, POSUSER_HOME,
#          USE_LOCAL_PG, VIRTUAL_IP, SERVER_URL, DB_NAME, BACKUP_DIR,
#          BACKUP_SCRIPT
# Sets: POS_READY
# =============================================================================

run_services() {
  local _start=$(date +%s)
  log "Stage: services — starting"

  # Load error codes library
  source "$(dirname "${BASH_SOURCE[0]}")/lib/error-codes.sh" 2>/dev/null || true

  # ─────────────────────────────────────────────────────────────────────────────
  # Server + Backup Roles: Systemd Services
  # ─────────────────────────────────────────────────────────────────────────────

  if [[ "$STATION_ROLE" == "server" || "$STATION_ROLE" == "backup" ]]; then
    header "Configuring Systemd Services"

    # ── RLS-disable script: root-owned, called by pre-start via sudo ──
    # Replaces blanket `sudo -u postgres psql` with a fixed-purpose script.
    RLS_SCRIPT="$APP_BASE/disable-rls.sh"
    cat > "$RLS_SCRIPT" <<'RLSEOF'
#!/usr/bin/env bash
# Disable RLS on all tables in the POS database.
# Root-owned, called via sudo from pre-start.sh. No user input accepted.
set -euo pipefail
DB="${1:-thepasspos}"
# Validate DB name (alphanumeric + underscore only — no injection)
if [[ ! "$DB" =~ ^[a-zA-Z0-9_]+$ ]]; then
  echo "ERROR: invalid database name" >&2
  exit 1
fi
sudo -u postgres psql -d "$DB" -c "
  DO \$\$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT relname FROM pg_class WHERE relrowsecurity = true AND relkind = 'r'
    LOOP EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
    END LOOP;
  END \$\$;
" 2>/dev/null
RLSEOF
    chown root:root "$RLS_SCRIPT"
    chmod 755 "$RLS_SCRIPT"

    # ── Pre-start script: auto-sync database schema on every boot ──
    PRE_START="$APP_BASE/pre-start.sh"
    cat > "$PRE_START" <<'PSEOF'
#!/usr/bin/env bash
# GWI POS Pre-Start — runs before thepasspos.service on every boot/restart.
# Ensures the database schema matches the deployed Prisma schema.
set -euo pipefail
_APP_DIR="/opt/gwi-pos/app"
cd "$_APP_DIR"

# Ensure app env files are symlinked to canonical /opt/gwi-pos/.env
# (repairs broken symlinks or copies left by older installers)
_CANONICAL_ENV="/opt/gwi-pos/.env"

# ── Per-boot reconciliation gate — prevents infinite restart loops ──
BOOT_ID=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null | tr -d '-')
RECONCILE_MARKER="/opt/gwi-pos/state/.reconciled-${BOOT_ID}"

if [[ -f "$RECONCILE_MARKER" ]]; then
  echo "[pre-start] Reconciliation already completed this boot — skipping full cycle"
  # Still do minimal checks (symlinks only)
  if [[ -f "$_CANONICAL_ENV" ]]; then
    for _ef in "$_APP_DIR/.env" "$_APP_DIR/.env.local"; do
      if [[ ! -L "$_ef" ]] || [[ "$(readlink -f "$_ef" 2>/dev/null)" != "$(readlink -f "$_CANONICAL_ENV")" ]]; then
        rm -f "$_ef"
        ln -sf "$_CANONICAL_ENV" "$_ef"
      fi
    done
  fi
  exit 0
fi

# 5-minute hard timeout
PRE_START_DEADLINE=$(($(date +%s) + 300))

if [[ -f "$_CANONICAL_ENV" ]]; then
  for _ef in .env .env.local; do
    if [[ ! -L "$_ef" ]] || [[ "$(readlink -f "$_ef" 2>/dev/null)" != "$(readlink -f "$_CANONICAL_ENV")" ]]; then
      rm -f "$_ef"
      ln -sf "$_CANONICAL_ENV" "$_ef"
      echo "[pre-start] Re-linked $_ef -> $_CANONICAL_ENV"
    fi
  done
fi

echo "[pre-start] Cleaning stale Prisma cache..."
rm -rf node_modules/.prisma 2>/dev/null || true

# Clean stale .next.backup from inside project dir (Turbopack crash — scans 17k+ files)
rm -rf "$_APP_DIR/.next.backup" 2>/dev/null || true
# Also clean the outside-project backup if it exists from a previously failed build
rm -rf /opt/gwi-pos/.next.backup 2>/dev/null || true
# Remove stale .next/lock from interrupted builds (prevents build hangs)
rm -f "$_APP_DIR/.next/lock" 2>/dev/null || true

# Guard: DATABASE_URL must be set for any DB operations
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[pre-start] FATAL: DATABASE_URL is not set. Check /opt/gwi-pos/.env"
  exit 1
fi

echo "[pre-start] Regenerating Prisma client..."
if timeout --kill-after=10 60 npx --yes prisma generate 2>&1; then
  echo "[pre-start] Prisma client regenerated."
else
  EXIT_CODE=$?
  if [[ $EXIT_CODE -eq 124 ]]; then
    echo "[pre-start] WARNING: prisma generate timed out after 60s — continuing with existing client."
  else
    echo "[pre-start] WARNING: prisma generate failed — continuing with existing client."
  fi
fi

# Timeout check
if [[ $(date +%s) -gt $PRE_START_DEADLINE ]]; then
  echo "[pre-start] CRITICAL: Pre-start exceeded 5-minute timeout — continuing with current state"
  mkdir -p /opt/gwi-pos/state
  touch "$RECONCILE_MARKER"
  exit 0
fi

# Clean stale .schema-stage-done marker from older installers
rm -f /opt/gwi-pos/.schema-stage-done 2>/dev/null || true

# NOTE: prisma db push removed — deploy-tools migrate.js is the SOLE schema
# migration path on NUCs. prisma generate (above) builds the client; schema
# changes come exclusively from deploy-tools migrations.

# Disable RLS on all tables before migrations.
# Schema changes or migrations may (re-)enable RLS, but the POS app
# user doesn't have RLS policies configured. RLS blocks sync, queries, login.
# NOTE: ALTER TABLE DISABLE ROW LEVEL SECURITY requires superuser.
# The POS app user ($POSUSER) is NOT a superuser, so we must run as postgres.
# Extract DB name from DATABASE_URL (format: postgresql://user:pass@host:port/dbname)
_DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*://[^/]*/\([^?]*\).*|\1|p')
_DB_NAME="${_DB_NAME:-thepasspos}"
echo "[pre-start] Disabling RLS on all tables (ensuring clean state, db=$_DB_NAME)..."
_rls_start=$(date +%s%N 2>/dev/null || date +%s)
sudo /opt/gwi-pos/disable-rls.sh "$_DB_NAME" && {
  _rls_end=$(date +%s%N 2>/dev/null || date +%s)
  if [[ "$_rls_start" =~ ^[0-9]{10,}$ ]]; then
    _rls_ms=$(( (_rls_end - _rls_start) / 1000000 ))
    echo "[pre-start] RLS disabled (${_rls_ms}ms)."
  else
    echo "[pre-start] RLS disabled."
  fi
} || echo "[pre-start] WARNING: RLS disable had issues — continuing."

# Timeout check
if [[ $(date +%s) -gt $PRE_START_DEADLINE ]]; then
  echo "[pre-start] CRITICAL: Pre-start exceeded 5-minute timeout — continuing with current state"
  mkdir -p /opt/gwi-pos/state
  touch "$RECONCILE_MARKER"
  exit 0
fi

# Run migrations via deploy-tools (pg-only, no Prisma CLI)
# TIMEOUT: 300s (5min) matches the internal timeout in the runner
_DT_DIR="/opt/gwi-pos/deploy-tools"
if [[ -f "$_DT_DIR/src/migrate.js" ]]; then
  echo "[pre-start] Setting migration state..."
  mkdir -p /opt/gwi-pos/shared/state
  echo "migrating" > /opt/gwi-pos/shared/state/schema-state 2>/dev/null || true

  echo "[pre-start] Running migrations via deploy-tools..."
  DATABASE_URL="$DATABASE_URL" timeout --kill-after=10 300 node "$_DT_DIR/src/migrate.js" 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      echo "[pre-start] WARNING: deploy-tools migrations timed out after 300s — continuing."
    else
      if [[ ! -f /opt/gwi-pos/.first-boot-done ]]; then
        echo "[pre-start] CRITICAL: deploy-tools migrate.js failed on first boot (exit $EXIT_CODE) — aborting."
        exit 1
      else
        echo "[pre-start] WARNING: deploy-tools migrations had issues (exit $EXIT_CODE) — continuing (not first boot)."
      fi
    fi
  }

  echo "ready" > /opt/gwi-pos/shared/state/schema-state 2>/dev/null || true
else
  echo "[pre-start] WARNING: deploy-tools not found at $_DT_DIR — skipping migrations."
fi

# Run migrations against Neon cloud DB too (ensures venue Neon is always current)
if [[ -n "${NEON_DATABASE_URL:-}" ]] && [[ -f "$_DT_DIR/src/migrate.js" ]]; then
  echo "[pre-start] Running Neon migrations via deploy-tools..."
  NEON_MIGRATE=true NEON_DATABASE_URL="$NEON_DATABASE_URL" timeout --kill-after=10 120 node "$_DT_DIR/src/migrate.js" 2>&1 || {
    _NEON_EXIT=$?
    echo "[pre-start] WARNING: Neon migrations failed (exit $_NEON_EXIT) — will retry next boot"
  }
  # NOTE: _venue_schema_state is owned by MC (sole source of truth).
  # The NUC must NEVER write to it — observe and report only.
fi

# Check seed completion status — hard stop on first boot if incomplete
_SEED_STATUS="/opt/gwi-pos/.seed-status"
if [[ -f "$_SEED_STATUS" ]]; then
  _SEED_STATE=$(head -c 10 "$_SEED_STATUS")
  if [[ "$_SEED_STATE" == "INCOMPLETE:" ]]; then
    echo "[pre-start] CRITICAL: Seed from Neon is INCOMPLETE. Details: $(cat "$_SEED_STATUS")"
    echo "[pre-start] The venue may be missing critical data (Organization, Location, Employees, etc.)"
    echo "[pre-start] Re-run the installer or manually run: bash scripts/seed-from-neon.sh"
    if [[ ! -f /opt/gwi-pos/.first-boot-done ]]; then
      echo "[pre-start] FATAL: Incomplete seed on first boot — refusing to start. Fix seed and retry."
      exit 1
    fi
    # Subsequent boots: warn but allow start so operators can diagnose via the UI/API.
    echo "[pre-start] WARNING: Allowing start on incomplete seed (not first boot) — sync/orders may fail."
  fi
fi

# Mark first boot as complete (all critical checks passed)
if [[ ! -f /opt/gwi-pos/.first-boot-done ]]; then
  touch /opt/gwi-pos/.first-boot-done
  echo "[pre-start] First boot completed successfully — future boots will be more lenient."
fi

# ── Service health checks — ensure critical services are running ──
echo "[pre-start] Verifying critical services..."

# Sync service
if systemctl is-enabled thepasspos-sync >/dev/null 2>&1; then
  if ! systemctl is-active thepasspos-sync >/dev/null 2>&1; then
    echo "[pre-start] Sync service not running — starting..."
    systemctl start thepasspos-sync 2>/dev/null || echo "[pre-start] WARNING: Failed to start sync service"
  fi
fi

# Watchdog timer
if [[ -f /opt/gwi-pos/watchdog.sh ]]; then
  if ! systemctl is-active gwi-watchdog.timer >/dev/null 2>&1; then
    echo "[pre-start] Watchdog timer not active — enabling..."
    systemctl enable --now gwi-watchdog.timer 2>/dev/null || echo "[pre-start] WARNING: Failed to enable watchdog"
  fi
fi

# Dashboard (user service — check via process list)
if command -v gwi-dashboard >/dev/null 2>&1 || command -v gwi-nuc-dashboard >/dev/null 2>&1; then
  if ! pgrep -f gwi-dashboard >/dev/null 2>&1; then
    echo "[pre-start] Dashboard not running — will start via user service on login"
  fi
fi

# Deploy latest scripts from checkout if available
if [[ -d "$_APP_DIR/public/scripts" ]]; then
  for _script in watchdog.sh; do
    [[ -f "$_APP_DIR/public/$_script" ]] && cp "$_APP_DIR/public/$_script" /opt/gwi-pos/ && chmod +x "/opt/gwi-pos/$_script" 2>/dev/null || true
  done
  for _script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh; do
    [[ -f "$_APP_DIR/public/scripts/$_script" ]] && cp "$_APP_DIR/public/scripts/$_script" /opt/gwi-pos/scripts/ && chmod +x "/opt/gwi-pos/scripts/$_script" 2>/dev/null || true
  done
fi

# ── Mark reconciliation complete for this boot ──
mkdir -p /opt/gwi-pos/state
touch "$RECONCILE_MARKER"
# Clean old markers (keep last 5)
ls -t /opt/gwi-pos/state/.reconciled-* 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
echo "[pre-start] Reconciliation complete (marker: $RECONCILE_MARKER)"
PSEOF
    chmod +x "$PRE_START"
    chown "$POSUSER":"$POSUSER" "$PRE_START"
    log "Pre-start schema sync script created."

    # ── Self-healing sudoers repair script (called by ExecStartPre as root) ──
    # Ensures enumerated NOPASSWD rules exist on every boot.
    # Replaces legacy NOPASSWD: ALL on older venues.
    FIX_SUDOERS="$APP_BASE/fix-sudoers.sh"
    cat > "$FIX_SUDOERS" <<FIXEOF
#!/usr/bin/env bash
set -euo pipefail
SUDOERS_FILE="/etc/sudoers.d/gwi-pos"
# If the enumerated rules already exist, nothing to do
if grep -q "systemctl restart thepasspos" "\$SUDOERS_FILE" 2>/dev/null; then
  exit 0
fi
echo "[sudoers] Repairing: writing enumerated NOPASSWD rules for $POSUSER"
cat > "\$SUDOERS_FILE" <<'SUDOFIX'
# GWI POS — enumerated passwordless sudo for POS service user
# --- systemctl: service lifecycle ---
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos, /bin/systemctl stop thepasspos, /bin/systemctl start thepasspos, /bin/systemctl enable thepasspos
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos-sync, /bin/systemctl start thepasspos-sync
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos-kiosk, /bin/systemctl stop thepasspos-kiosk, /bin/systemctl start thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart gwi-watchdog.timer, /bin/systemctl restart gwi-watchdog.service
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl enable gwi-watchdog.timer, /bin/systemctl enable --now gwi-watchdog.timer
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl status *, /bin/systemctl is-active *, /bin/systemctl is-enabled *, /bin/systemctl list-unit-files *
# --- Database tools ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/psql, /usr/lib/postgresql/*/bin/psql, /usr/bin/pg_isready, /usr/bin/pg_dump
# --- POS scripts ---
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/deploy-release.sh, /opt/gwi-pos/scripts/*, /opt/gwi-pos/watchdog.sh, /opt/gwi-pos/heartbeat.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/backup-pos.sh, /opt/gwi-pos/disable-rls.sh, /opt/gwi-pos/pre-start.sh, /opt/gwi-pos/clear-kiosk-session.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/kiosk-control.sh, /opt/gwi-pos/boot-diagnostic.sh
# --- Package management ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/dpkg
# --- System administration ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/timedatectl, /bin/journalctl
$POSUSER ALL=(ALL) NOPASSWD: /sbin/shutdown, /usr/sbin/shutdown
# --- File management (sync-agent: ownership fixes, file deployment) ---
$POSUSER ALL=(ALL) NOPASSWD: /bin/chown, /usr/bin/chown, /bin/chmod, /usr/bin/chmod, /bin/cp, /usr/bin/cp, /bin/mkdir, /usr/bin/mkdir
SUDOFIX
chmod 440 "\$SUDOERS_FILE"
echo "[sudoers] Fixed: enumerated NOPASSWD for $POSUSER"
FIXEOF
    chown root:root "$FIX_SUDOERS"
    chmod 755 "$FIX_SUDOERS"
    log "Self-healing sudoers script created: $FIX_SUDOERS"

    # thepasspos.service — POS backend/UI
    PG_AFTER=""
    PG_WANTS=""
    if [[ "$USE_LOCAL_PG" == "true" ]]; then
      PG_AFTER=" postgresql.service"
      PG_WANTS="Wants=network-online.target postgresql.service"
    else
      PG_WANTS="Wants=network-online.target"
    fi
    cat > /etc/systemd/system/thepasspos.service <<SVCEOF
[Unit]
Description=ThePassPOS Server
After=network-online.target${PG_AFTER}
${PG_WANTS}

[Service]
User=$POSUSER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
# Self-healing sudoers: runs as root (+prefix) before pre-start.sh runs as POSUSER.
# Ensures enumerated NOPASSWD rules exist. Replaces legacy NOPASSWD: ALL on older venues.
ExecStartPre=+/opt/gwi-pos/fix-sudoers.sh
ExecStartPre=$APP_BASE/pre-start.sh
ExecStart=/usr/bin/node -r ./preload.js server.js
Restart=always
RestartSec=3
TimeoutStartSec=120
StandardOutput=journal
StandardError=journal
SyslogIdentifier=thepasspos

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload

    if [[ "$STATION_ROLE" == "backup" ]]; then
      # Backup role: DISABLE POS app so it does NOT auto-start on reboot.
      # If backup reboots with POS enabled, the upstream sync worker would read
      # stale standby PG and overwrite newer data in Neon. POS will be started
      # by promote.sh if this NUC takes over as primary.
      systemctl disable thepasspos 2>/dev/null || true
      log "POS service installed but DISABLED (backup standby mode)."
      log "POS will start automatically on promotion via promote.sh."
    else
      systemctl enable thepasspos

      # Ensure POSUSER owns the entire app directory — root-created dirs/files
      # from installer stages (mkdir, cp) cause "Permission denied" at runtime
      chown -R "$POSUSER":"$POSUSER" "$APP_BASE" 2>/dev/null || true
      # Keys stay root-owned (secrets)
      [[ -d "$KEY_DIR" ]] && chown -R root:root "$KEY_DIR" && chmod 700 "$KEY_DIR"

      log "Starting POS server..."
      timeout --kill-after=10 180 systemctl restart thepasspos || { err_code "ERR-INST-211" "systemctl restart thepasspos failed"; warn "POS service failed to start — will retry on reboot"; track_warn "POS service restart failed — will retry on reboot"; }

      # Wait for POS to be order-ready, not just alive
      # Check /api/health AND verify response contains "status":"healthy"
      # (HTTP 200 alone is insufficient — POS may be booting but not ready for orders)
      # 90 iterations x 2s = 180s (3 min). First boots with cold npm cache need extra time.
      log "Waiting for POS to be order-ready (up to 180s)..."
      POS_READY=false
      for i in $(seq 1 90); do
        if curl -sf http://localhost:3005/api/health 2>/dev/null | grep -q '"status":"healthy"'; then
          log "POS is ready!"
          POS_READY=true
          break
        fi
        sleep 2
      done

      if [[ "$POS_READY" == "true" ]]; then
        # Enhanced: check sync readiness (DEGRADED is OK, FAILED is not)
        if [[ "$SYNC_ENABLED" == "true" ]]; then
          local sync_health
          sync_health=$(curl -sf http://localhost:3005/api/health/sync 2>/dev/null || echo '{}')
          local readiness
          readiness=$(echo "$sync_health" | grep -o '"level":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "UNKNOWN")
          if [[ "$readiness" == "FAILED" ]]; then
            warn "Sync readiness is FAILED — venue may not be fully operational"
            track_warn "Sync readiness FAILED after install"
          elif [[ "$readiness" != "" ]] && [[ "$readiness" != "ORDERS" ]]; then
            log "Sync readiness: $readiness (may still be warming up)"
          fi
        fi
      fi

      if [[ "$POS_READY" != "true" ]]; then
        err_code "ERR-INST-212" "Health check failed after 180s — /api/health did not return healthy"
        track_warn "POS not ready after 180s — will retry on reboot"
        track_warn "Check: sudo journalctl -u thepasspos -f"
        # Capture diagnostics for troubleshooting
        err "POS failed to start within timeout. Diagnostics:"
        journalctl -u thepasspos --no-pager -n 30 2>/dev/null | tail -20 || true
        echo "--- Memory ---"
        free -m 2>/dev/null || true
        echo "--- Disk ---"
        df -h /opt/gwi-pos 2>/dev/null || true
        echo "--- PostgreSQL ---"
        pg_isready 2>/dev/null || echo "PostgreSQL not reachable"
      fi
      log "Services configured and started (no kiosk — web UI for settings/admin only)."
    fi

    # ───────────────────────────────────────────────────────────────────────────
    # Server Role: Backup Script + Cron (local PostgreSQL only)
    # ───────────────────────────────────────────────────────────────────────────

    if [[ "$USE_LOCAL_PG" == "true" ]]; then
      header "Setting Up Backups"

      mkdir -p "$BACKUP_DIR"
      chown "$POSUSER":"$POSUSER" "$BACKUP_DIR"

      # Generate backup encryption key if it doesn't exist
      if [[ ! -f "$APP_BASE/.backup-key" ]]; then
        openssl rand -hex 32 > "$APP_BASE/.backup-key"
        chmod 600 "$APP_BASE/.backup-key"
        chown root:root "$APP_BASE/.backup-key"
        log "Generated backup encryption key: $APP_BASE/.backup-key"
      fi

      # Install backup script
      cat > "$BACKUP_SCRIPT" <<'BKEOF'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR=/opt/gwi-pos/backups
BACKUP_KEY="/opt/gwi-pos/.backup-key"
RETENTION_DAYS=7

if [ -f /opt/gwi-pos/.env ]; then
  DB_NAME=$(grep -oP '^DB_NAME=\K.+' /opt/gwi-pos/.env 2>/dev/null | tr -d '"' || echo "thepasspos")
  DB_USER=$(grep -oP '^DB_USER=\K.+' /opt/gwi-pos/.env 2>/dev/null | tr -d '"' || echo "thepasspos")
else
  DB_NAME="${DB_NAME:-thepasspos}"
  DB_USER="${DB_USER:-thepasspos}"
fi

mkdir -p "$BACKUP_DIR"
timestamp=$(date +%Y%m%d-%H%M%S)

# Use encrypted backup if key exists, otherwise fall back to unencrypted
if [[ -f "$BACKUP_KEY" ]]; then
  backup_file="$BACKUP_DIR/pos-$timestamp.sql.gz.enc"
  echo "[Backup] Starting encrypted PostgreSQL backup of '$DB_NAME'..."
  set -o pipefail
  if pg_dump -U "$DB_USER" "$DB_NAME" 2>/tmp/pgdump_err | gzip | openssl enc -aes-256-cbc -pbkdf2 -pass file:"$BACKUP_KEY" -out "$backup_file"; then
    size=$(du -h "$backup_file" | cut -f1)
    echo "[Backup] Success (encrypted): $backup_file ($size)"
  else
    echo "[Backup] WARNING: pg_dump or encryption failed."
    cat /tmp/pgdump_err 2>/dev/null || true
    rm -f "$backup_file" /tmp/pgdump_err
    exit 1
  fi
else
  backup_file="$BACKUP_DIR/pos-$timestamp.sql.gz"
  echo "[Backup] Starting PostgreSQL backup of '$DB_NAME' (no encryption key found)..."
  set -o pipefail
  if pg_dump -U "$DB_USER" "$DB_NAME" 2>/tmp/pgdump_err | gzip > "$backup_file"; then
    size=$(du -h "$backup_file" | cut -f1)
    echo "[Backup] Success: $backup_file ($size)"
  else
    echo "[Backup] WARNING: pg_dump failed."
    cat /tmp/pgdump_err 2>/dev/null || true
    rm -f "$backup_file" /tmp/pgdump_err
    exit 1
  fi
fi
rm -f /tmp/pgdump_err

find "$BACKUP_DIR" -type f \( -name 'pos-*.sql.gz' -o -name 'pos-*.sql.gz.enc' \) -mtime +"$RETENTION_DAYS" -delete
echo "[Backup] Done."
BKEOF

      chmod +x "$BACKUP_SCRIPT"
      chown "$POSUSER":"$POSUSER" "$BACKUP_SCRIPT"

      # Add cron entry (idempotent)
      CRON_LINE="0 4 * * * $BACKUP_SCRIPT"
      ( crontab -u "$POSUSER" -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" || true ; echo "$CRON_LINE" ) | crontab -u "$POSUSER" -

      log "Daily backup configured (4 AM, 7-day retention)."

      # ── Cloud Backup Upload (encrypted -> S3) ──
      UPLOAD_SCRIPT="$APP_BASE/scripts/nuc-backup-upload.sh"
      if [[ -f "$APP_DIR/public/nuc-backup-upload.sh" ]]; then
        mkdir -p "$APP_BASE/scripts"
        cp "$APP_DIR/public/nuc-backup-upload.sh" "$UPLOAD_SCRIPT"
        chmod +x "$UPLOAD_SCRIPT"
        chown "$POSUSER":"$POSUSER" "$UPLOAD_SCRIPT"

        # Add cron entry: 4:15 AM daily (15 min after pg_dump)
        UPLOAD_CRON="15 4 * * * $UPLOAD_SCRIPT"
        ( crontab -u "$POSUSER" -l 2>/dev/null | grep -v "$UPLOAD_SCRIPT" || true ; echo "$UPLOAD_CRON" ) | crontab -u "$POSUSER" -

        log "Cloud backup upload configured (4:15 AM daily -> S3)."
      else
        track_warn "nuc-backup-upload.sh not found at $APP_DIR/public/nuc-backup-upload.sh — cloud backup upload not configured."
      fi
    else
      log "Cloud database (Neon) — backups managed by provider. Skipping local backup."
    fi

    # ── Restore Script ──
    RESTORE_SCRIPT="$APP_BASE/scripts/nuc-restore.sh"
    if [[ -f "$APP_DIR/public/nuc-restore.sh" ]]; then
      mkdir -p "$APP_BASE/scripts"
      cp "$APP_DIR/public/nuc-restore.sh" "$RESTORE_SCRIPT"
      chmod +x "$RESTORE_SCRIPT"
      chown root:root "$RESTORE_SCRIPT"
      log "Restore script installed: $RESTORE_SCRIPT"
    else
      track_warn "nuc-restore.sh not found at $APP_DIR/public/nuc-restore.sh — restore script not installed."
    fi

    # ── Deploy full ha-check.sh (replaces bootstrap version written before git clone) ──
    if [[ -n "${VIRTUAL_IP:-}" ]] && [[ -f "$APP_DIR/public/ha-check.sh" ]]; then
      mkdir -p "$APP_BASE/scripts"
      cp "$APP_DIR/public/ha-check.sh" "$APP_BASE/scripts/ha-check.sh"
      chmod +x "$APP_BASE/scripts/ha-check.sh"
      chown root:root "$APP_BASE/scripts/ha-check.sh"
      log "Full ha-check.sh deployed (pg_is_in_recovery, replication lag, MC alerting)."
    elif [[ -n "${VIRTUAL_IP:-}" ]]; then
      track_warn "ha-check.sh not found at $APP_DIR/public/ha-check.sh — using bootstrap version (no replication lag monitoring)."
    fi

    # ───────────────────────────────────────────────────────────────────────────
    # Server Role: Sudoers Rules
    # ───────────────────────────────────────────────────────────────────────────

    header "Configuring Sudoers"

    # NOTE: kiosk-control.sh is only needed on terminal role (created in terminal section).
    # Server role has no kiosk service.

    cat > /etc/sudoers.d/gwi-pos <<SUDEOF
# GWI POS — enumerated passwordless sudo for POS service user
# Principle of least privilege: only commands the POS service actually needs.
# If a new command is required, add it here — do NOT revert to NOPASSWD: ALL.
#
# --- systemctl: service lifecycle (restart, stop, start, enable, daemon-reload) ---
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos, /bin/systemctl stop thepasspos, /bin/systemctl start thepasspos, /bin/systemctl enable thepasspos
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos-sync, /bin/systemctl start thepasspos-sync
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart thepasspos-kiosk, /bin/systemctl stop thepasspos-kiosk, /bin/systemctl start thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl restart gwi-watchdog.timer, /bin/systemctl restart gwi-watchdog.service
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl enable gwi-watchdog.timer, /bin/systemctl enable --now gwi-watchdog.timer
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl daemon-reload
$POSUSER ALL=(ALL) NOPASSWD: /bin/systemctl status *, /bin/systemctl is-active *, /bin/systemctl is-enabled *, /bin/systemctl list-unit-files *
#
# --- Database tools ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/psql, /usr/lib/postgresql/*/bin/psql, /usr/bin/pg_isready, /usr/bin/pg_dump
#
# --- POS scripts (deploy, watchdog, backups, schema) ---
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/deploy-release.sh, /opt/gwi-pos/scripts/*, /opt/gwi-pos/watchdog.sh, /opt/gwi-pos/heartbeat.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/backup-pos.sh, /opt/gwi-pos/disable-rls.sh, /opt/gwi-pos/pre-start.sh, /opt/gwi-pos/clear-kiosk-session.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/kiosk-control.sh, /opt/gwi-pos/boot-diagnostic.sh
#
# --- Package management (dashboard .deb installs, minisign, etc.) ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/bin/dpkg
#
# --- System administration ---
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/timedatectl, /bin/journalctl
$POSUSER ALL=(ALL) NOPASSWD: /sbin/shutdown, /usr/sbin/shutdown
#
# --- File management (sync-agent: ownership fixes, file deployment) ---
$POSUSER ALL=(ALL) NOPASSWD: /bin/chown, /usr/bin/chown, /bin/chmod, /usr/bin/chmod, /bin/cp, /usr/bin/cp, /bin/mkdir, /usr/bin/mkdir
SUDEOF
    chmod 440 /etc/sudoers.d/gwi-pos

    log "Sudoers rules configured."

    # ───────────────────────────────────────────────────────────────────────────
    # Server Role: Sync Agent (receives deploy commands from Mission Control)
    # ───────────────────────────────────────────────────────────────────────────
    # NOTE: Heartbeat was already set up earlier (right after cron install +
    # .env write) so it runs even if later steps fail. Sync agent must be
    # after git clone since it copies sync-agent.js from the repo.

    header "Setting Up Sync Agent"

    SYNC_SCRIPT="$APP_BASE/sync-agent.js"
    # Copy sync agent from repo (self-updating — updated by FORCE_UPDATE deployments)
    if [[ -f "$APP_DIR/public/sync-agent.js" ]]; then
      cp "$APP_DIR/public/sync-agent.js" "$SYNC_SCRIPT"
      chown "$POSUSER":"$POSUSER" "$SYNC_SCRIPT"

      # thepasspos-sync.service — Sync Agent (only created when script exists)
      cat > /etc/systemd/system/thepasspos-sync.service <<SVCEOF
[Unit]
Description=ThePassPOS Sync Agent
After=network-online.target thepasspos.service
Wants=network-online.target

[Service]
User=$POSUSER
WorkingDirectory=$APP_BASE
ExecStart=/usr/bin/node $APP_BASE/sync-agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=thepasspos-sync

[Install]
WantedBy=multi-user.target
SVCEOF

      systemctl daemon-reload
      systemctl enable thepasspos-sync
      systemctl restart thepasspos-sync || { err_code "ERR-INST-213" "systemctl restart thepasspos-sync failed"; track_warn "Sync agent failed to start — check journalctl -u thepasspos-sync"; }
      log "Sync agent configured and started."
    else
      track_warn "sync-agent.js not found at $APP_DIR/public/sync-agent.js — sync agent will not start."
      systemctl disable thepasspos-sync 2>/dev/null || true
    fi

    # ───────────────────────────────────────────────────────────────────────────
    # Server + Backup Roles: Boot Diagnostic (post-boot forensic snapshot)
    # ───────────────────────────────────────────────────────────────────────────

    header "Installing Boot Diagnostic Service"

    BOOT_DIAG_SCRIPT="$APP_BASE/boot-diagnostic.sh"
    cat > "$BOOT_DIAG_SCRIPT" <<'DIAGEOF'
#!/usr/bin/env bash
# GWI POS Boot Diagnostic — runs once after boot to capture system state.
# Output: /opt/gwi-pos/.last-boot-diagnostic.json
set -euo pipefail

OUT="/opt/gwi-pos/.last-boot-diagnostic.json"

# Helper: escape a string for safe JSON embedding (handles quotes, backslashes, newlines)
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# Gather data
_ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
_hostname=$(hostname 2>/dev/null || echo "unknown")
_uptime=$(uptime -s 2>/dev/null || echo "unknown")
_boot_id=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "unknown")

# Service statuses (active, failed, activating, inactive, not-found)
_pos_status=$(systemctl is-active thepasspos 2>/dev/null || echo "not-found")
_sync_status=$(systemctl is-active thepasspos-sync 2>/dev/null || echo "not-found")
_dashboard_status=$(systemctl is-active gwi-dashboard 2>/dev/null || echo "not-found")
_kiosk_status=$(systemctl is-active thepasspos-kiosk 2>/dev/null || echo "not-found")

# Failed units (catch anything systemd considers broken)
_failed_units_raw=$(systemctl --failed --no-legend --no-pager 2>/dev/null | awk '{print $1}' | head -10 | tr '\n' ',' || echo "none")
_failed_units=$(json_escape "${_failed_units_raw%,}")

# Kiosk/dashboard resolved environment (for display debugging)
_kiosk_env_raw=$(systemctl show thepasspos-kiosk -p Environment --no-pager 2>/dev/null || echo "not-found")
_kiosk_env=$(json_escape "$_kiosk_env_raw")
_xauthority="${XAUTHORITY:-unset}"

# loginctl session state
_sessions_raw=$(loginctl list-sessions --no-legend --no-pager 2>/dev/null | head -5 || echo "none")
_sessions=$(json_escape "$_sessions_raw")

# POS health check
_health_raw=$(curl -sf --max-time 10 http://localhost:3005/api/health 2>/dev/null || echo "unreachable")
_health=$(json_escape "$_health_raw")

# Listening ports (3005 = POS, 5432 = PostgreSQL)
_port_3005=$(ss -tlnp 2>/dev/null | grep ':3005 ' || echo "not listening")
_port_3005=$(json_escape "$_port_3005")
_port_5432=$(ss -tlnp 2>/dev/null | grep ':5432 ' || echo "not listening")
_port_5432=$(json_escape "$_port_5432")

# Display session state
_display="${DISPLAY:-unset}"
if [[ -e /tmp/.X11-unix/X0 ]]; then
  _x11_socket="exists"
else
  _x11_socket="missing"
fi

# Disk space on /opt
_disk_free=$(df -h /opt 2>/dev/null | tail -1 | awk '{print $4}' || echo "unknown")
_disk_pct=$(df -h /opt 2>/dev/null | tail -1 | awk '{print $5}' || echo "unknown")

# Last 5 lines of thepasspos journal
_journal_raw=$(journalctl -u thepasspos --no-pager -n 5 2>/dev/null || echo "unavailable")
_journal=$(json_escape "$_journal_raw")

# Contract health
_contract_hash="unknown"
_contract_match="unknown"
if [[ -f /opt/gwi-pos/app/public/version-contract.json ]]; then
  _contract_hash=$(python3 -c "import json; print(json.load(open('/opt/gwi-pos/app/public/version-contract.json')).get('schemaSha256','unknown'))" 2>/dev/null || echo "unknown")
fi

# State file checks
_first_boot_done="false"
[[ -f /opt/gwi-pos/.first-boot-done ]] && _first_boot_done="true"
_env_exists="false"
_env_readable="false"
if [[ -f /opt/gwi-pos/.env ]]; then
  _env_exists="true"
  [[ -r /opt/gwi-pos/.env ]] && _env_readable="true"
fi

# Write JSON
printf '{\n' > "$OUT"
printf '  "timestamp": "%s",\n' "$_ts" >> "$OUT"
printf '  "hostname": "%s",\n' "$_hostname" >> "$OUT"
printf '  "bootId": "%s",\n' "$_boot_id" >> "$OUT"
printf '  "bootedAt": "%s",\n' "$_uptime" >> "$OUT"
printf '  "services": {\n' >> "$OUT"
printf '    "thepasspos": "%s",\n' "$_pos_status" >> "$OUT"
printf '    "thepasspos-sync": "%s",\n' "$_sync_status" >> "$OUT"
printf '    "gwi-dashboard": "%s",\n' "$_dashboard_status" >> "$OUT"
printf '    "thepasspos-kiosk": "%s"\n' "$_kiosk_status" >> "$OUT"
printf '  },\n' >> "$OUT"
printf '  "failedUnits": "%s",\n' "$_failed_units" >> "$OUT"
printf '  "healthCheck": "%s",\n' "$_health" >> "$OUT"
printf '  "ports": {\n' >> "$OUT"
printf '    "3005": "%s",\n' "$_port_3005" >> "$OUT"
printf '    "5432": "%s"\n' "$_port_5432" >> "$OUT"
printf '  },\n' >> "$OUT"
printf '  "display": {\n' >> "$OUT"
printf '    "DISPLAY": "%s",\n' "$_display" >> "$OUT"
printf '    "XAUTHORITY": "%s",\n' "$_xauthority" >> "$OUT"
printf '    "x11Socket": "%s",\n' "$_x11_socket" >> "$OUT"
printf '    "kioskEnv": "%s",\n' "$_kiosk_env" >> "$OUT"
printf '    "sessions": "%s"\n' "$_sessions" >> "$OUT"
printf '  },\n' >> "$OUT"
printf '  "disk": {\n' >> "$OUT"
printf '    "optFree": "%s",\n' "$_disk_free" >> "$OUT"
printf '    "optUsedPct": "%s"\n' "$_disk_pct" >> "$OUT"
printf '  },\n' >> "$OUT"
printf '  "journal": "%s",\n' "$_journal" >> "$OUT"
printf '  "firstBootDone": %s,\n' "$_first_boot_done" >> "$OUT"
printf '  "envExists": %s,\n' "$_env_exists" >> "$OUT"
printf '  "envReadable": %s,\n' "$_env_readable" >> "$OUT"
printf '  "contractHash": "%s",\n' "$_contract_hash" >> "$OUT"
printf '  "contractMatch": "%s",\n' "$_contract_match" >> "$OUT"
# Overall boot health verdict
_boot_healthy="false"
if [[ "$_pos_status" == "active" ]]; then
  if [[ -z "$_failed_units_raw" || "$_failed_units_raw" == "none" || "$_failed_units_raw" == "," ]]; then
    _boot_healthy="true"
  fi
fi
printf '  "bootHealthy": %s\n' "$_boot_healthy" >> "$OUT"
printf '}\n' >> "$OUT"

echo "[boot-diagnostic] Snapshot written to $OUT (healthy=$_boot_healthy)"
DIAGEOF
    chmod +x "$BOOT_DIAG_SCRIPT"
    chown "$POSUSER":"$POSUSER" "$BOOT_DIAG_SCRIPT"

    # gwi-boot-diagnostic.service — oneshot, runs 30s after POS starts
    cat > /etc/systemd/system/gwi-boot-diagnostic.service <<SVCEOF
[Unit]
Description=GWI POS Boot Diagnostic
After=thepasspos.service
Wants=thepasspos.service

[Service]
Type=oneshot
ExecStartPre=/bin/sleep 30
ExecStart=$APP_BASE/boot-diagnostic.sh
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable gwi-boot-diagnostic
    log "Boot diagnostic service installed and enabled (runs 30s after boot)."

    # ── Force convergence to current baseline (removes legacy services/configs) ──
    source "${MODULES_DIR:-$SCRIPT_DIR/installer-modules}/lib/legacy-cleanup.sh" 2>/dev/null || true
    if type converge_role >/dev/null 2>&1; then
      converge_role "$STATION_ROLE"
    fi

  fi  # end server + backup roles

  # ─────────────────────────────────────────────────────────────────────────────
  # Terminal Role: Kiosk Only
  # ─────────────────────────────────────────────────────────────────────────────

  if [[ "$STATION_ROLE" == "terminal" ]]; then
    header "Configuring Terminal Kiosk"

    # ── Terminal kiosk preflight ──
    TERM_KIOSK_OK=true
    # CHROMIUM_BIN may already be set by 04-database.sh (native, snap wrapper, etc.)
    TERM_CHROMIUM="${CHROMIUM_BIN:-}"
    if [[ -z "$TERM_CHROMIUM" ]]; then
      if command -v chromium-kiosk >/dev/null 2>&1; then
        TERM_CHROMIUM="chromium-kiosk"
      elif command -v chromium-browser >/dev/null 2>&1; then
        TERM_CHROMIUM="chromium-browser"
      elif command -v chromium >/dev/null 2>&1; then
        TERM_CHROMIUM="chromium"
      else
        track_warn "Chromium not found — terminal kiosk will not work."
        TERM_KIOSK_OK=false
      fi
    fi

    # Check for graphical session on terminals too (prefer x11 over wayland)
    if [[ "$TERM_KIOSK_OK" == "true" ]]; then
      TERM_POSUSER_SESSION=""
      TERM_SESSION="unknown"
      while read -r sid _ suser _rest; do
        [[ "$suser" != "$POSUSER" ]] && continue
        stype=$(loginctl show-session "$sid" -p Type --value 2>/dev/null || echo "")
        if [[ "$stype" == "x11" ]]; then
          TERM_POSUSER_SESSION="$sid"; TERM_SESSION="x11"; break
        elif [[ "$stype" == "wayland" ]] && [[ -z "$TERM_POSUSER_SESSION" ]]; then
          TERM_POSUSER_SESSION="$sid"; TERM_SESSION="wayland"
        elif [[ -z "$TERM_POSUSER_SESSION" ]]; then
          TERM_POSUSER_SESSION="$sid"; TERM_SESSION="${stype:-unknown}"
        fi
      done < <(loginctl list-sessions --no-legend 2>/dev/null)
      if [[ "$TERM_SESSION" == "wayland" ]]; then
        # Fix Wayland for next reboot
        if [[ -f /etc/gdm3/custom.conf ]]; then
          if ! grep -q "WaylandEnable=false" /etc/gdm3/custom.conf 2>/dev/null; then
            log "Disabling Wayland in GDM3 for next reboot (terminal)..."
            if grep -q "\[daemon\]" /etc/gdm3/custom.conf; then
              sed -i '/\[daemon\]/a WaylandEnable=false' /etc/gdm3/custom.conf
            else
              echo -e "\n[daemon]\nWaylandEnable=false" >> /etc/gdm3/custom.conf
            fi
          fi
        fi
        warn "Wayland detected on terminal — kiosk requires X11. Reboot after install."
        TERM_KIOSK_OK=false
      elif [[ "$TERM_SESSION" == "unknown" ]]; then
        warn "No graphical session detected on terminal — kiosk may not start until login."
        TERM_KIOSK_OK=false
      fi
    fi

    # Kill any existing kiosk Chromium instances before starting kiosk (user-scoped)
    pkill -u "$POSUSER" -f "${TERM_CHROMIUM}.*kiosk" 2>/dev/null || true
    sleep 1

    # thepasspos-kiosk.service — Chromium pointing at server (SERVER_URL via Environment for safety)
    # Resolve full path to Chromium binary (may be /usr/bin, /usr/local/bin, or /snap/bin)
    TERM_CHROMIUM_PATH=$(command -v "${TERM_CHROMIUM:-chromium-browser}" 2>/dev/null || echo "/usr/bin/${TERM_CHROMIUM:-chromium-browser}")
    cat > /etc/systemd/system/thepasspos-kiosk.service <<SVCEOF
[Unit]
Description=ThePassPOS Kiosk (Terminal)
After=graphical.target network-online.target
Wants=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=$POSUSER
Environment=DISPLAY=:0
EnvironmentFile=-/opt/gwi-pos/kiosk-display.env
Environment=XAUTHORITY=$POSUSER_HOME/.Xauthority
Environment=POS_SERVER_URL=$SERVER_URL
ExecStartPre=-/usr/bin/pkill -u %u -f 'chromium.*kiosk'
ExecStartPre=/opt/gwi-pos/clear-kiosk-session.sh
ExecStartPre=/opt/gwi-pos/wait-for-pos.sh ${SERVER_URL}/login
ExecStart=$TERM_CHROMIUM_PATH --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-features=TranslateUI --check-for-update-interval=31536000 --user-data-dir=/opt/gwi-pos/kiosk-profile $SERVER_URL
Restart=always
RestartSec=10
TimeoutStartSec=60

[Install]
WantedBy=graphical.target
SVCEOF

    systemctl daemon-reload
    if [[ "$TERM_KIOSK_OK" == "true" ]]; then
      systemctl enable thepasspos-kiosk
      systemctl restart thepasspos-kiosk || { err_code "ERR-INST-214" "systemctl restart thepasspos-kiosk failed"; track_warn "Terminal kiosk service restart failed — will retry on reboot"; }
      # Verify kiosk process actually launched
      sleep 5
      if ! pgrep -u "$POSUSER" -f "${TERM_CHROMIUM:-chromium}" >/dev/null 2>&1; then
        track_warn "Terminal kiosk process not detected — check display, graphics drivers, or X11 session"
      fi
    else
      track_warn "Skipping terminal kiosk service — preflight failed."
      systemctl disable thepasspos-kiosk 2>/dev/null || true
    fi

    log "Terminal kiosk configured -> $SERVER_URL"

    # Kiosk control script (also needed on terminals — exit-kiosk-server.py calls it)
    cat > /opt/gwi-pos/kiosk-control.sh <<'KIOSKCTL'
#!/bin/bash
set -euo pipefail
ACTION="${1:-stop}"
case "$ACTION" in
  stop)    systemctl stop    thepasspos-kiosk 2>/dev/null || true ;;
  start)   systemctl start   thepasspos-kiosk 2>/dev/null || true ;;
  restart) systemctl restart thepasspos-kiosk 2>/dev/null || true ;;
  *) echo "Usage: $0 {stop|start|restart}"; exit 1 ;;
esac
KIOSKCTL
    chown root:root /opt/gwi-pos/kiosk-control.sh
    chmod 755 /opt/gwi-pos/kiosk-control.sh

    # Sudoers for terminal — allow service user to manage kiosk + shutdown
    cat > /etc/sudoers.d/gwi-pos << SUDEOF
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/kiosk-control.sh
$POSUSER ALL=(ALL) NOPASSWD: /sbin/shutdown -h now
$POSUSER ALL=(ALL) NOPASSWD: /usr/sbin/shutdown -h now
SUDEOF
    chmod 440 /etc/sudoers.d/gwi-pos

    # ── Terminal kiosk exit micro-service ────────────────────────────────────
    # On terminals, the POS app runs on the server — so POST /api/system/exit-kiosk
    # kills the server's kiosk, not the terminal's. This tiny Python HTTP server
    # listens on localhost:3006 and handles the exit command locally.

    cat > /opt/gwi-pos/exit-kiosk-server.py << 'PYEOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess

# Security model: bound to 127.0.0.1 (no network access), path-restricted to /exit.
# On a dedicated appliance NUC with no user shell, localhost binding is the primary
# security boundary. Custom header auth is not feasible because the client uses
# fetch mode: 'no-cors' (browser strips custom headers in no-cors mode).

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/exit':
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')  # localhost-only binding makes this safe
        self.end_headers()
        subprocess.Popen(['sudo', '/opt/gwi-pos/kiosk-control.sh', 'stop'])
    def do_OPTIONS(self):
        if self.path != '/exit':
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')  # localhost-only binding makes this safe
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.end_headers()
    def log_message(self, format, *args):
        pass  # Suppress request logging

HTTPServer(('127.0.0.1', 3006), Handler).serve_forever()
PYEOF

    cat > /etc/systemd/system/thepasspos-exit-kiosk.service << SVCEOF
[Unit]
Description=ThePassPOS Terminal Kiosk Exit Service
After=network.target

[Service]
User=$POSUSER
ExecStart=/usr/bin/python3 /opt/gwi-pos/exit-kiosk-server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

    systemctl daemon-reload
    systemctl enable thepasspos-exit-kiosk
    systemctl start thepasspos-exit-kiosk
    log "Terminal kiosk exit service running on localhost:3006"
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # All Roles: Watchdog Health Monitor
  # ─────────────────────────────────────────────────────────────────────────────

  header "Installing watchdog health monitor..."

  # Resolve source directory: prefer $APP_DIR/public (post-clone), fall back to $MODULES_DIR/..
  local _WD_SRC="${APP_DIR:-/opt/gwi-pos/app}/public"
  [[ -f "$_WD_SRC/watchdog.sh" ]] || _WD_SRC="${MODULES_DIR:-$SCRIPT_DIR/installer-modules}/.."

  # Copy watchdog files
  if [[ -f "$_WD_SRC/watchdog.sh" ]]; then
    cp "$_WD_SRC/watchdog.sh" /opt/gwi-pos/watchdog.sh
    chmod +x /opt/gwi-pos/watchdog.sh

    if [[ -f "$_WD_SRC/watchdog.service" ]] && [[ -f "$_WD_SRC/watchdog.timer" ]]; then
      cp "$_WD_SRC/watchdog.service" /etc/systemd/system/gwi-watchdog.service
      cp "$_WD_SRC/watchdog.timer" /etc/systemd/system/gwi-watchdog.timer
    else
      track_warn "watchdog.service or watchdog.timer not found — watchdog timer not installed"
    fi

    # Copy monitoring scripts
    mkdir -p /opt/gwi-pos/scripts
    for script in hardware-inventory.sh disk-pressure-monitor.sh version-compat.sh rolling-restart.sh; do
      if [[ -f "$_WD_SRC/scripts/$script" ]]; then
        cp "$_WD_SRC/scripts/$script" /opt/gwi-pos/scripts/"$script"
      fi
    done
    chmod +x /opt/gwi-pos/scripts/*.sh 2>/dev/null || true

    # Create state and log directories
    mkdir -p /opt/gwi-pos/state /opt/gwi-pos/logs/watchdog-diagnostics

    # Enable and start watchdog timer
    if [[ -f /etc/systemd/system/gwi-watchdog.timer ]]; then
      systemctl daemon-reload
      systemctl enable gwi-watchdog.timer
      systemctl start gwi-watchdog.timer
      log "Watchdog timer enabled (health check every 30s)"
    fi
  else
    track_warn "watchdog.sh not found — watchdog not installed"
  fi

  # ─────────────────────────────────────────────────────────────────────────────
  # All Roles: Copy shared installer libraries to /opt/gwi-pos/
  # ─────────────────────────────────────────────────────────────────────────────

  local _LIB_SRC="${MODULES_DIR:-$SCRIPT_DIR/installer-modules}/lib"
  if [[ -d "$_LIB_SRC" ]]; then
    mkdir -p /opt/gwi-pos/installer-modules/lib
    cp "$_LIB_SRC"/*.sh /opt/gwi-pos/installer-modules/lib/
    chmod +x /opt/gwi-pos/installer-modules/lib/*.sh
    log "Shared installer libraries copied to /opt/gwi-pos/installer-modules/lib/"
  fi

  log "Stage: services — completed in $(( $(date +%s) - _start ))s"
  return 0
}
