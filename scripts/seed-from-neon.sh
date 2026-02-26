#!/usr/bin/env bash
# seed-from-neon.sh — Seed local PostgreSQL from Neon cloud database
# Usage: bash scripts/seed-from-neon.sh
set -euo pipefail

# Load env (NUC → installer path, dev → local files)
if [ -f /opt/gwi-pos/.env ]; then
  set -a; source /opt/gwi-pos/.env; set +a
elif [ -f .env.local ]; then
  set -a; source .env.local; set +a
elif [ -f .env ]; then
  set -a; source .env; set +a
fi

if [ -z "${NEON_DATABASE_URL:-}" ]; then
  echo "[seed] ERROR: NEON_DATABASE_URL not set"
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[seed] ERROR: DATABASE_URL not set"
  exit 1
fi

echo "[seed] Dumping from Neon cloud..."
pg_dump "$NEON_DATABASE_URL" --no-owner --no-acl -Fc -f /tmp/neon-seed.pgdump

echo "[seed] Restoring to local PostgreSQL..."
pg_restore -d "$DATABASE_URL" --no-owner --no-acl --clean --if-exists /tmp/neon-seed.pgdump || true

echo "[seed] Running pre-migrations..."
node scripts/nuc-pre-migrate.js || true

echo "[seed] Pushing schema..."
npx prisma db push --accept-data-loss || true

echo "[seed] Stamping syncedAt on all rows..."
psql "$DATABASE_URL" -c "
DO \$\$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'syncedAt' AND table_schema = 'public'
  LOOP
    EXECUTE format('UPDATE %I SET \"syncedAt\" = NOW() WHERE \"syncedAt\" IS NULL', tbl);
  END LOOP;
END
\$\$;
"

echo "[seed] Cleaning up dump file..."
rm -f /tmp/neon-seed.pgdump

echo "[seed] Done! Local PostgreSQL seeded from Neon."
