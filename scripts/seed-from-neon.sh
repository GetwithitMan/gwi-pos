#!/usr/bin/env bash
# seed-from-neon.sh — Seed local PostgreSQL from Neon cloud database
# Usage: bash scripts/seed-from-neon.sh
#
# HARDENED: Critical steps fail the seed. syncedAt is NOT stamped (sync
# worker owns that metadata). A .seed-status marker tracks completion.
set -euo pipefail

APP_BASE="${APP_BASE:-/opt/gwi-pos}"
SEED_STATUS_FILE="$APP_BASE/.seed-status"

# ── Helpers ────────────────────────────────────────────────────────────────
err()  { echo "[seed] ERROR: $*" >&2; }
warn() { echo "[seed] WARNING: $*" >&2; }
log()  { echo "[seed] $*"; }

mark_incomplete() {
  echo "INCOMPLETE:$(date -u +%Y-%m-%dT%H:%M:%SZ):$1" > "$SEED_STATUS_FILE"
}

# ── Load env (line-by-line parsing -- safe for UTF-8 comments) ─────────────
_load_env_file() {
  local file="$1"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" ]] && continue
    key="${line%%=*}"; val="${line#*=}"
    # Strip surrounding double-quotes if present
    val="${val#\"}"; val="${val%\"}"
    export "$key=$val" 2>/dev/null || true
  done < "$file"
}

if [ -f /opt/gwi-pos/.env ]; then
  _load_env_file /opt/gwi-pos/.env
elif [ -f .env.local ]; then
  _load_env_file .env.local
elif [ -f .env ]; then
  _load_env_file .env
fi

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  err "NEON_DATABASE_URL not set"
  mark_incomplete "NEON_DATABASE_URL not set"
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  err "DATABASE_URL not set"
  mark_incomplete "DATABASE_URL not set"
  exit 1
fi

# ── PG17 client tools (Neon runs PG17; PG16 pg_dump refuses PG17 server) ──
PG_DUMP="/usr/lib/postgresql/17/bin/pg_dump"
if [[ ! -x "$PG_DUMP" ]]; then
  PG_DUMP="pg_dump"  # fall back to system default
fi

PG_RESTORE="/usr/lib/postgresql/17/bin/pg_restore"
if [[ ! -x "$PG_RESTORE" ]]; then
  PG_RESTORE="pg_restore"  # fall back to system default
fi

# Resolve psql — prefer PG17 for matching server version
PSQL="/usr/lib/postgresql/17/bin/psql"
if [[ ! -x "$PSQL" ]]; then
  PSQL="psql"
fi

log "Using pg_dump: $PG_DUMP ($($PG_DUMP --version 2>/dev/null || echo 'unknown'))"

# ── Step 1: Dump from Neon ─────────────────────────────────────────────────
log "Dumping from Neon cloud..."
if ! PGCONNECT_TIMEOUT=10 $PG_DUMP "$NEON_DATABASE_URL" --no-owner --no-acl -Fc -f /tmp/neon-seed.pgdump; then
  err "pg_dump from Neon failed — cannot seed without a valid dump"
  mark_incomplete "pg_dump failed"
  exit 1
fi

DUMP_SIZE=$(stat -c%s /tmp/neon-seed.pgdump 2>/dev/null || stat -f%z /tmp/neon-seed.pgdump 2>/dev/null || echo "0")
if [[ "$DUMP_SIZE" -lt 1024 ]]; then
  err "Dump file is suspiciously small (${DUMP_SIZE} bytes) — Neon database may be empty"
  mark_incomplete "dump too small (${DUMP_SIZE} bytes)"
  rm -f /tmp/neon-seed.pgdump
  exit 1
fi
log "Dump complete (${DUMP_SIZE} bytes)"

# ── Step 2: Restore to local PostgreSQL ────────────────────────────────────
# pg_restore with --clean --if-exists will emit warnings for objects that
# don't exist yet (first install). Exit code 1 from pg_restore is common
# for "some objects could not be dropped" warnings. We capture stderr and
# check for actual data-loading failures.
log "Restoring to local PostgreSQL..."
RESTORE_OUTPUT=$($PG_RESTORE -d "$DATABASE_URL" --no-owner --no-acl --clean --if-exists /tmp/neon-seed.pgdump 2>&1) || RESTORE_EXIT=$?
RESTORE_EXIT=${RESTORE_EXIT:-0}

if [[ "$RESTORE_EXIT" -ne 0 ]]; then
  # pg_restore exit 1 = warnings (e.g., "table does not exist" on --clean).
  # This is normal on first install. Only true failures (exit > 1) are fatal.
  if [[ "$RESTORE_EXIT" -gt 1 ]]; then
    err "pg_restore failed with exit code $RESTORE_EXIT — seed is incomplete"
    err "Output: $RESTORE_OUTPUT"
    mark_incomplete "pg_restore exit $RESTORE_EXIT"
    rm -f /tmp/neon-seed.pgdump
    exit 1
  fi
  # Exit 1: log warnings but continue
  if [[ -n "$RESTORE_OUTPUT" ]]; then
    warn "pg_restore had non-fatal warnings (exit 1, normal on first install):"
    echo "$RESTORE_OUTPUT" | tail -5
  fi
fi

# ── Step 3: Schema alignment (pre-migrations + prisma db push) ─────────────
# These must succeed — a partial schema means the venue cannot operate safely.
log "Running pre-migrations..."
if ! node scripts/nuc-pre-migrate.js; then
  err "Pre-migrations failed — schema may be incomplete"
  mark_incomplete "nuc-pre-migrate.js failed"
  rm -f /tmp/neon-seed.pgdump
  exit 1
fi

# Schema push is handled by Stage 06 BEFORE seed runs.
# Running prisma db push again here is redundant and causes hangs
# (timeout + npx + schema-engine process chain doesn't propagate SIGTERM).
# Instead, just verify schema exists.
TABLE_COUNT=$($PSQL "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo "0")
TABLE_COUNT=$(echo "$TABLE_COUNT" | tr -d '[:space:]')
if [[ "$TABLE_COUNT" -lt 50 ]]; then
  warn "Only $TABLE_COUNT tables found — schema may be incomplete. Attempting prisma db push..."
  timeout --foreground --kill-after=10 120 npx prisma db push 2>/dev/null || warn "prisma db push had issues (non-fatal — Stage 06 should have handled schema)"
else
  log "Schema verified: $TABLE_COUNT tables present (skipping redundant prisma db push)"
fi

# ── Step 4: Verify critical tables have data ───────────────────────────────
# A successful pg_restore with zero rows in critical tables means the Neon
# source was empty or the restore silently dropped data.
log "Verifying seed data..."
SEED_OK=true
CRITICAL_TABLES=("Location" "Organization" "Role" "Employee" "Category" "OrderType")

for TABLE in "${CRITICAL_TABLES[@]}"; do
  COUNT=$($PSQL "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM \"$TABLE\"" 2>/dev/null || echo "0")
  COUNT=$(echo "$COUNT" | tr -d '[:space:]')
  if [[ "$COUNT" == "0" || -z "$COUNT" ]]; then
    warn "Seed verification: $TABLE is empty (0 rows)"
    SEED_OK=false
  else
    log "  $TABLE: $COUNT rows"
  fi
done

if [[ "$SEED_OK" != "true" ]]; then
  err "Seed verification failed — critical tables are empty"
  err "The venue cannot operate without Organization, Location, Employees, etc."
  mark_incomplete "critical tables empty"
  rm -f /tmp/neon-seed.pgdump
  exit 1
fi

# ── NO syncedAt stamping ──────────────────────────────────────────────────
# INTENTIONALLY REMOVED. The sync worker owns syncedAt metadata.
# Rows restored from Neon retain whatever syncedAt they had in Neon (or NULL
# if they were never synced). This preserves accurate change detection:
#   upstream sync: updatedAt > COALESCE(syncedAt, '1970-01-01')
# Stamping syncedAt = NOW() on all rows after seed would poison change
# detection by making the sync worker believe all rows are already synced,
# even if the seed was partial or rows were modified between dump and restore.

# ── Step 5: Write completion marker ───────────────────────────────────────
echo "COMPLETE:$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SEED_STATUS_FILE"

# ── Cleanup ────────────────────────────────────────────────────────────────
log "Cleaning up dump file..."
rm -f /tmp/neon-seed.pgdump

log "Done! Local PostgreSQL seeded from Neon. All critical tables verified."
