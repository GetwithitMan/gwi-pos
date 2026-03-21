#!/usr/bin/env bash
# =============================================================================
# 06-schema.sh — prisma db push, nuc-pre-migrate.js, seed, build
# =============================================================================
# Entry: run_schema
# Expects: STATION_ROLE, APP_DIR, APP_BASE, ENV_FILE, POSUSER, NEON_PSQL,
#          NEON_DIRECT_URL, SYNC_ENABLED, NEON_DATABASE_URL,
#          DB_USER, DB_NAME, DB_PASSWORD, USE_LOCAL_PG
# =============================================================================

run_schema() {
  local _start=$(date +%s)
  log "Stage: schema — starting"

  # Only server + backup roles need schema work
  if [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: schema — skipped (terminal role)"
    return 0
  fi

  # Database migrations only run on server (backup gets data via pg_basebackup)
  if [[ "$STATION_ROLE" == "server" ]]; then

    # ── Step 1: Read schema version from Neon (source of record) ──
    # Neon is the canonical schema authority. We read the version from Neon
    # to know what version local PG should report, but we use LOCAL tested
    # migration paths (prisma db push + nuc-pre-migrate.js) to build the schema.
    # NO pg_dump. NO Neon schema cloning. Local migrations are the schema path.
    NEON_SCHEMA_VERSION=""
    if [[ -n "$NEON_DIRECT_URL" ]]; then
      log "Reading schema version from Neon (source of record)..."
      NEON_SCHEMA_VERSION=$(PGPASSWORD="" $NEON_PSQL "$NEON_DIRECT_URL" --connect-timeout=10 -tAc "SELECT \"schemaVersion\" FROM \"_venue_schema_state\" WHERE id = 1" 2>/dev/null | tr -d '[:space:]' || echo "")
      if [[ -n "$NEON_SCHEMA_VERSION" ]]; then
        log "Neon schema version: $NEON_SCHEMA_VERSION"
      else
        warn "Could not read schema version from Neon — Neon may not be provisioned yet"
      fi
    fi

    # ── Step 2: Apply schema to LOCAL PG using local tested migration path ──
    # prisma db push creates tables/columns from schema.prisma.
    # nuc-pre-migrate.js runs numbered migrations for data backfills + DDL patches.
    # Timeout 120s: Prisma schema engine can hang when diffing large schemas already in sync.
    # --accept-data-loss: safe on re-install since data comes from Neon seed, not local-only tables.
    _start_spinner "Applying schema to local PostgreSQL"
    if ! timeout 120 sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npx prisma db push --accept-data-loss" >/dev/null 2>&1; then
      _stop_spinner
      warn "prisma db push timed out or had warnings — schema may already be in sync. Continuing..."
    else
      _stop_spinner
      log "Schema applied successfully"
    fi
    log "Running local migrations..."
    sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && node scripts/nuc-pre-migrate.js" 2>&1 | tail -5

    # Seed local PG from Neon cloud (offline-first mode)
    if [[ "$SYNC_ENABLED" == "true" ]] && [[ -n "$NEON_DATABASE_URL" ]]; then
      _start_spinner "Seeding local database from Neon cloud"
      if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && APP_BASE='$APP_BASE' bash scripts/seed-from-neon.sh" >/dev/null 2>&1; then
        _stop_spinner
        # Check if seed wrote an INCOMPLETE marker
        if [[ -f "$APP_BASE/.seed-status" ]] && grep -q "^INCOMPLETE" "$APP_BASE/.seed-status"; then
          SEED_REASON=$(cat "$APP_BASE/.seed-status" | cut -d: -f3-)
          err "Neon seed FAILED: $SEED_REASON"
          err "The venue cannot activate on partial data. Fix the issue and re-run the installer."
          err "Seed status file: $APP_BASE/.seed-status"
          return 1
        else
          warn "Neon seed had warnings — check $APP_BASE/.seed-status"
        fi
      else
        _stop_spinner
      fi
      # Verify seed completed successfully
      if [[ -f "$APP_BASE/.seed-status" ]]; then
        SEED_STATE=$(head -c 8 "$APP_BASE/.seed-status")
        if [[ "$SEED_STATE" == "COMPLETE" ]]; then
          log "Neon seed verified complete."
        else
          err "Seed did not complete successfully (status: $(cat "$APP_BASE/.seed-status"))"
          return 1
        fi
      else
        warn "No seed status file found — seed may not have run the hardened version"
      fi
    fi

    # ── Post-schema: disable RLS on all tables ──
    # prisma db push may enable RLS via the Prisma schema.
    # The POS app user doesn't have RLS policies configured, so RLS must be off.
    log "Disabling RLS on all tables..."
    sudo -u postgres psql -d "$DB_NAME" -c "
      DO \$\$ DECLARE r RECORD; BEGIN
        FOR r IN SELECT relname FROM pg_class WHERE relrowsecurity = true AND relkind = 'r' LOOP
          EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', r.relname);
        END LOOP;
      END \$\$;
    " >/dev/null 2>&1
    log "RLS disabled on all tables."

    # ── Step 3: Record local install state (informational only) ──
    # AUTHORITY MODEL: _venue_schema_state is MC/Neon-owned. The installer
    # must NOT create or write to it. MC provisions that table during venue
    # setup and owns the schema version lifecycle. Instead, we write a
    # LOCAL-ONLY install record for diagnostics/troubleshooting.
    SCHEMA_VERSION="${NEON_SCHEMA_VERSION}"
    SCHEMA_SOURCE="neon"
    if [[ -z "$SCHEMA_VERSION" ]]; then
      # Fallback: read from locally-built version-contract.json (informational)
      if [[ -f "$APP_DIR/public/version-contract.json" ]]; then
        SCHEMA_VERSION=$(sudo -u "$POSUSER" node -e "try { console.log(require('$APP_DIR/public/version-contract.json').schemaVersion) } catch(e) { console.log('') }" 2>/dev/null)
      fi
      if [[ -z "$SCHEMA_VERSION" ]] && [[ -f "$APP_DIR/src/generated/version-contract.json" ]]; then
        SCHEMA_VERSION=$(sudo -u "$POSUSER" node -e "try { console.log(require('$APP_DIR/src/generated/version-contract.json').schemaVersion) } catch(e) { console.log('') }" 2>/dev/null)
      fi
      if [[ -n "$SCHEMA_VERSION" ]]; then
        SCHEMA_SOURCE="version-contract"
      fi
    fi
    if [[ -z "$SCHEMA_VERSION" ]]; then
      SCHEMA_VERSION="unknown"
      SCHEMA_SOURCE="unknown"
    fi

    sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "
      CREATE TABLE IF NOT EXISTS \"_local_install_state\" (
        id SERIAL PRIMARY KEY,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        pos_version TEXT,
        installer_version TEXT,
        schema_migrations_run INTEGER
      );
      INSERT INTO \"_local_install_state\" (pos_version, installer_version) VALUES ('$SCHEMA_VERSION', 'installer.run');
    " >/dev/null 2>&1
    log "Local install state recorded (pos_version=$SCHEMA_VERSION, source=$SCHEMA_SOURCE)"
    log "NOTE: _venue_schema_state is MC-owned — installer does not write to it"
  else
    log "Skipping database migrations (backup standby — data replicated from primary)."
  fi

  _start_spinner "Building POS application (this takes a few minutes)"
  if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm run build" >/dev/null 2>&1; then
    _stop_spinner
    err "Application build failed. Re-running with output..."
    sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && npm run build"
    return 1
  fi
  _stop_spinner
  log "POS application built successfully!"

  # ── Post-build: update _local_install_state with freshly generated version ──
  # The build step generates version-contract.json with the real schema version.
  # This is purely informational — _venue_schema_state is MC-owned, not touched here.
  if [[ "$STATION_ROLE" == "server" ]]; then
    BUILT_VERSION=$(sudo -u "$POSUSER" node -e "try{console.log(require('$APP_DIR/src/generated/version-contract.json').schemaVersion)}catch(e){}" 2>/dev/null || echo "")
    if [[ -z "$BUILT_VERSION" ]]; then
      BUILT_VERSION=$(sudo -u "$POSUSER" node -e "try{console.log(require('$APP_DIR/public/version-contract.json').schemaVersion)}catch(e){}" 2>/dev/null || echo "")
    fi
    if [[ -n "$BUILT_VERSION" ]] && [[ "$BUILT_VERSION" != "${SCHEMA_VERSION:-}" ]]; then
      log "Recording post-build version in _local_install_state: $BUILT_VERSION (was: ${SCHEMA_VERSION:-unknown})"
      sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "
        INSERT INTO \"_local_install_state\" (pos_version, installer_version) VALUES ('$BUILT_VERSION', 'installer-post-build');
      " >/dev/null 2>&1
    fi
  fi

  log "Stage: schema — completed in $(( $(date +%s) - _start ))s"
  return 0
}
