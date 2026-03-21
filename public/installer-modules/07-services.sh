#!/usr/bin/env bash
# =============================================================================
# 07-services.sh — systemd units (thepasspos, sync-agent, kiosk), sudoers,
#                  backups, pre-start, terminal kiosk
# =============================================================================
# Entry: run_services
# Expects: STATION_ROLE, APP_BASE, APP_DIR, ENV_FILE, POSUSER, POSUSER_HOME,
#          USE_LOCAL_PG, VIRTUAL_IP, SERVER_URL, DB_NAME, BACKUP_DIR,
#          BACKUP_SCRIPT
# Sets: KIOSK_OK, CHROMIUM_BIN, POS_READY
# =============================================================================

run_services() {
  local _start=$(date +%s)
  log "Stage: services — starting"

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
APP_DIR="/opt/gwi-pos/app"
cd "$APP_DIR"

# Ensure app env files are symlinked to canonical /opt/gwi-pos/.env
# (repairs broken symlinks or copies left by older installers)
_CANONICAL_ENV="/opt/gwi-pos/.env"
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

# Guard: DATABASE_URL must be set for any DB operations
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[pre-start] FATAL: DATABASE_URL is not set. Check /opt/gwi-pos/.env"
  exit 1
fi

echo "[pre-start] Regenerating Prisma client..."
if timeout 60 npx --yes prisma generate 2>&1; then
  echo "[pre-start] Prisma client regenerated."
else
  EXIT_CODE=$?
  if [[ $EXIT_CODE -eq 124 ]]; then
    echo "[pre-start] WARNING: prisma generate timed out after 60s — continuing with existing client."
  else
    echo "[pre-start] WARNING: prisma generate failed — continuing with existing client."
  fi
fi

echo "[pre-start] Checking database schema..."
# Use --accept-data-loss: safe because data is Neon-sourced (not local-only).
# Unique constraint additions and infrastructure table drops are expected
# after code updates. TIMEOUT: 120s prevents hung prisma schema engine.
PUSH_OUTPUT=$(timeout 120 npx --yes prisma db push --accept-data-loss 2>&1) && {
  echo "[pre-start] Schema sync complete."
} || {
  EXIT_CODE=$?
  if [[ $EXIT_CODE -eq 124 ]]; then
    echo "[pre-start] WARNING: prisma db push timed out after 120s — continuing with existing schema."
  elif echo "$PUSH_OUTPUT" | grep -qi "error\|fatal"; then
    echo "[pre-start] WARNING: prisma db push had errors — continuing with existing schema."
    echo "[pre-start] Details: $PUSH_OUTPUT"
  else
    echo "[pre-start] WARNING: prisma db push failed (non-destructive): $PUSH_OUTPUT"
    # Non-destructive failure (e.g., network issue) — continue anyway
  fi
}

# Disable RLS on all tables after schema push.
# prisma db push may (re-)enable RLS via the Prisma schema, but the POS app
# user doesn't have RLS policies configured. RLS blocks sync, queries, login.
# NOTE: ALTER TABLE DISABLE ROW LEVEL SECURITY requires superuser.
# The POS app user ($POSUSER) is NOT a superuser, so we must run as postgres.
# Extract DB name from DATABASE_URL (format: postgresql://user:pass@host:port/dbname)
_DB_NAME=$(echo "$DATABASE_URL" | sed -n 's|.*://[^/]*/\([^?]*\).*|\1|p')
_DB_NAME="${_DB_NAME:-thepasspos}"
echo "[pre-start] Disabling RLS on all tables (db=$_DB_NAME)..."
sudo /opt/gwi-pos/disable-rls.sh "$_DB_NAME" && echo "[pre-start] RLS disabled." || echo "[pre-start] WARNING: RLS disable had issues — continuing."

# Run custom migrations if the script exists
# TIMEOUT: 300s (5min) matches the internal timeout in nuc-pre-migrate.js
if [[ -f scripts/nuc-pre-migrate.js ]]; then
  echo "[pre-start] Running custom migrations..."
  timeout 300 node scripts/nuc-pre-migrate.js 2>&1 || {
    EXIT_CODE=$?
    if [[ $EXIT_CODE -eq 124 ]]; then
      echo "[pre-start] WARNING: custom migrations timed out after 300s — continuing."
    else
      # First boot (no .first-boot-done marker): hard stop on migration failure
      # Subsequent boots: warn and continue (venue is already operational)
      if [[ ! -f /opt/gwi-pos/.first-boot-done ]]; then
        echo "[pre-start] CRITICAL: nuc-pre-migrate.js failed on first boot (exit $EXIT_CODE) — aborting."
        echo "[pre-start] The database may be in an inconsistent state. Fix the issue and restart."
        exit 1
      else
        echo "[pre-start] WARNING: custom migrations had issues (exit $EXIT_CODE) — continuing (not first boot)."
      fi
    fi
  }
else
  echo "[pre-start] WARNING: scripts/nuc-pre-migrate.js not found — skipping custom migrations."
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
PSEOF
    chmod +x "$PRE_START"
    chown "$POSUSER":"$POSUSER" "$PRE_START"
    log "Pre-start schema sync script created."

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
ExecStartPre=$APP_BASE/pre-start.sh
ExecStart=/usr/bin/node -r ./preload.js server.js
Restart=always
RestartSec=3
TimeoutStartSec=600
StandardOutput=journal
StandardError=journal
SyslogIdentifier=thepasspos

[Install]
WantedBy=multi-user.target
SVCEOF

    # ── Kiosk preflight: verify X11 session is available ──
    KIOSK_OK=true
    # CHROMIUM_BIN may already be set by 04-database.sh (native, snap wrapper, etc.)
    if [[ -z "${CHROMIUM_BIN:-}" ]]; then
      if command -v chromium-kiosk >/dev/null 2>&1; then
        CHROMIUM_BIN="chromium-kiosk"
      elif command -v chromium-browser >/dev/null 2>&1; then
        CHROMIUM_BIN="chromium-browser"
      elif command -v chromium >/dev/null 2>&1; then
        CHROMIUM_BIN="chromium"
      else
        track_warn "Chromium not found — kiosk mode will not work."
        KIOSK_OK=false
      fi
    fi

    # Check for Wayland vs X11 (filter by POSUSER, prefer graphical sessions)
    if [[ "$KIOSK_OK" == "true" ]]; then
      # Find the best graphical session: prefer x11, then wayland, then any
      POSUSER_SESSION=""
      SESSION_TYPE="unknown"
      while read -r sid _ suser _rest; do
        [[ "$suser" != "$POSUSER" ]] && continue
        stype=$(loginctl show-session "$sid" -p Type --value 2>/dev/null || echo "")
        if [[ "$stype" == "x11" ]]; then
          POSUSER_SESSION="$sid"; SESSION_TYPE="x11"; break
        elif [[ "$stype" == "wayland" ]] && [[ -z "$POSUSER_SESSION" ]]; then
          POSUSER_SESSION="$sid"; SESSION_TYPE="wayland"
        elif [[ -z "$POSUSER_SESSION" ]]; then
          POSUSER_SESSION="$sid"; SESSION_TYPE="${stype:-unknown}"
        fi
      done < <(loginctl list-sessions --no-legend 2>/dev/null)
      if [[ "$SESSION_TYPE" == "wayland" ]]; then
        # Wayland was detected despite preflight fix — this means the session
        # started before the installer ran, or preflight didn't cover this DM.
        # Try to fix it now for next reboot.
        if [[ -f /etc/gdm3/custom.conf ]]; then
          if ! grep -q "WaylandEnable=false" /etc/gdm3/custom.conf 2>/dev/null; then
            log "Disabling Wayland in GDM3 for next reboot..."
            if grep -q "\[daemon\]" /etc/gdm3/custom.conf; then
              sed -i '/\[daemon\]/a WaylandEnable=false' /etc/gdm3/custom.conf
            else
              echo -e "\n[daemon]\nWaylandEnable=false" >> /etc/gdm3/custom.conf
            fi
          fi
        fi
        warn "Wayland session is currently active. Kiosk requires X11."
        warn "Wayland has been disabled in GDM3 — a REBOOT is required."
        warn "After reboot, the kiosk will start automatically on X11."
        KIOSK_OK=false
      elif [[ "$SESSION_TYPE" == "unknown" ]]; then
        warn "No active graphical session detected."
        warn "Ensure auto-login is configured for '$POSUSER' before rebooting."
        warn "Kiosk will be enabled but may not start until a graphical session is available."
        KIOSK_OK=false
      fi
    fi

    # thepasspos-kiosk.service — Chromium in kiosk mode
    # Resolve full path to Chromium binary (may be /usr/bin, /usr/local/bin, or /snap/bin)
    CHROMIUM_FULL_PATH=$(command -v "${CHROMIUM_BIN:-chromium-browser}" 2>/dev/null || echo "/usr/bin/${CHROMIUM_BIN:-chromium-browser}")
    cat > /etc/systemd/system/thepasspos-kiosk.service <<SVCEOF
[Unit]
Description=ThePassPOS Kiosk
After=graphical.target thepasspos.service
Wants=thepasspos.service
StartLimitIntervalSec=600
StartLimitBurst=10

[Service]
Type=simple
User=$POSUSER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$POSUSER_HOME/.Xauthority
ExecStartPre=-/usr/bin/pkill -u %u -f 'chromium.*kiosk'
ExecStartPre=/opt/gwi-pos/clear-kiosk-session.sh
ExecStartPre=/opt/gwi-pos/wait-for-pos.sh
ExecStart=$CHROMIUM_FULL_PATH --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-features=TranslateUI --check-for-update-interval=31536000 --user-data-dir=/opt/gwi-pos/kiosk-profile http://localhost:3005
Restart=always
RestartSec=30

[Install]
WantedBy=graphical.target
SVCEOF

    systemctl daemon-reload

    if [[ "$STATION_ROLE" == "backup" ]]; then
      # Backup role: DISABLE POS app so it does NOT auto-start on reboot.
      # If backup reboots with POS enabled, the upstream sync worker would read
      # stale standby PG and overwrite newer data in Neon. POS will be started
      # by promote.sh if this NUC takes over as primary.
      systemctl disable thepasspos 2>/dev/null || true
      systemctl disable thepasspos-kiosk 2>/dev/null || true
      log "POS service installed but DISABLED (backup standby mode)."
      log "POS will start automatically on promotion via promote.sh."
    else
      systemctl enable thepasspos

      # Don't enable kiosk yet — enable AFTER POS is confirmed ready.
      # If enabled now, systemd's Wants= dependency auto-starts kiosk
      # when POS starts, causing duplicate Chromium tabs.
      systemctl disable thepasspos-kiosk 2>/dev/null || true
      systemctl stop thepasspos-kiosk 2>/dev/null || true

      # Kill any stale Chromium kiosk processes from previous installs
      pkill -u "$POSUSER" -f "chromium.*kiosk" 2>/dev/null || true
      pkill -u "$POSUSER" -f "chromium-browser.*kiosk" 2>/dev/null || true

      log "Starting POS server..."
      systemctl restart thepasspos || track_warn "POS service restart failed — will retry on reboot"

      # Wait for POS to be order-ready, not just alive
      # Check /api/health AND verify response contains "status":"healthy"
      # (HTTP 200 alone is insufficient — POS may be booting but not ready for orders)
      log "Waiting for POS to be order-ready (up to 120s)..."
      POS_READY=false
      for i in $(seq 1 60); do
        if curl -sf http://localhost:3005/api/health 2>/dev/null | grep -q '"status":"healthy"'; then
          log "POS is ready!"
          POS_READY=true
          break
        fi
        sleep 2
      done

      if [[ "$KIOSK_OK" == "true" ]]; then
        if [[ "$POS_READY" == "true" ]]; then
          # POS is healthy — NOW enable and start kiosk
          systemctl enable thepasspos-kiosk
          systemctl restart thepasspos-kiosk || track_warn "Kiosk service restart failed — will retry on reboot"

          # Verify kiosk process actually launched
          sleep 5
          if ! pgrep -u "$POSUSER" -f "${CHROMIUM_BIN:-chromium}" >/dev/null 2>&1; then
            track_warn "Kiosk process not detected — check display, graphics drivers, or X11 session"
          fi
        else
          # POS didn't start in time — enable kiosk for reboot but don't start now
          systemctl enable thepasspos-kiosk
          track_warn "POS not ready after 120s — kiosk enabled for next reboot"
          track_warn "Check: sudo journalctl -u thepasspos -f"
        fi
      else
        track_warn "Skipping kiosk service — preflight failed (Chromium missing or Wayland)."
      fi
      log "Services configured and started."
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

    # Dedicated kiosk control script — no pkill, no eval, no untrusted input
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

    cat > /etc/sudoers.d/gwi-pos <<SUDEOF
# GWI POS — allow service user to manage POS services without password
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop thepasspos
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start thepasspos
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos-kiosk
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/kiosk-control.sh
$POSUSER ALL=(ALL) NOPASSWD: /sbin/shutdown -h now
$POSUSER ALL=(ALL) NOPASSWD: /usr/sbin/shutdown -h now
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart thepasspos-sync
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/scripts/promote.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/scripts/rejoin-as-standby.sh
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/scripts/nuc-restore.sh
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart keepalived
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop keepalived
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl start keepalived
$POSUSER ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart postgresql
$POSUSER ALL=(ALL) NOPASSWD: /opt/gwi-pos/disable-rls.sh
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
      systemctl restart thepasspos-sync || track_warn "Sync agent failed to start — check journalctl -u thepasspos-sync"
      log "Sync agent configured and started."
    else
      track_warn "sync-agent.js not found at $APP_DIR/public/sync-agent.js — sync agent will not start."
      systemctl disable thepasspos-sync 2>/dev/null || true
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
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$POSUSER
Environment=DISPLAY=:0
Environment=XAUTHORITY=$POSUSER_HOME/.Xauthority
Environment=POS_SERVER_URL=$SERVER_URL
ExecStartPre=-/usr/bin/pkill -u %u -f 'chromium.*kiosk'
ExecStartPre=/opt/gwi-pos/clear-kiosk-session.sh
ExecStartPre=/opt/gwi-pos/wait-for-pos.sh ${SERVER_URL}/login
ExecStart=$TERM_CHROMIUM_PATH --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run --disable-features=TranslateUI --check-for-update-interval=31536000 --user-data-dir=/opt/gwi-pos/kiosk-profile $SERVER_URL
Restart=always
RestartSec=10

[Install]
WantedBy=graphical.target
SVCEOF

    systemctl daemon-reload
    if [[ "$TERM_KIOSK_OK" == "true" ]]; then
      systemctl enable thepasspos-kiosk
      systemctl restart thepasspos-kiosk || track_warn "Terminal kiosk service restart failed — will retry on reboot"
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

  log "Stage: services — completed in $(( $(date +%s) - _start ))s"
  return 0
}
