#!/usr/bin/env bash
# =============================================================================
# 06-schema.sh -- Schema bootstrap + migrations via deploy-tools
# =============================================================================
# Entry: run_schema
# Expects: APP_BASE, APP_DIR, ENV_FILE, DATABASE_URL, NEON_DATABASE_URL,
#          POSUSER, STATION_ROLE, IS_REINSTALL
# Container: deploy-tools operations run inside the gwi-pos Docker container
#            via `docker exec`. The container must be running before this stage.
#
# Schema path: deploy-tools ONLY (no Prisma CLI on NUC runtime).
#   1. deploy-tools/apply-schema.js -- bootstrap empty DBs from schema.sql
#   2. deploy-tools/migrate.js -- run numbered migrations (local PG)
#   3. Neon schema observe-only (MC is schema authority -- NUC never mutates Neon)
#   4. seed-from-neon.sh -- restore venue data from Neon cloud
#
# Fresh install: schema/migration failure is FATAL (fail-closed).
# Re-install: migration failure is a warning (existing data intact).
# =============================================================================

run_schema() {
  local _start=$(date +%s)
  log "Stage: schema -- starting"

  # Load error codes library
  source "$(dirname "${BASH_SOURCE[0]}")/lib/error-codes.sh" 2>/dev/null || true

  # Stop AND disable POS service -- prevents Restart=always from bringing it back
  # during schema operations. Re-enabled in 07-services.sh.
  if systemctl is-active --quiet thepasspos 2>/dev/null || systemctl is-enabled --quiet thepasspos 2>/dev/null; then
    log "Stopping POS service for schema operations..."
    systemctl disable --now thepasspos 2>/dev/null || true
    sleep 2
  fi

  # Guard: gwi-pos container must be running for deploy-tools operations
  if ! docker ps -q --filter name=gwi-pos --filter status=running | grep -q .; then
    err "gwi-pos container is not running -- cannot execute deploy-tools"
    err "Ensure stage 05 (deploy-app) completed successfully and the container is up."
    return 1
  fi

  # Only server + backup roles need schema work
  if [[ "$STATION_ROLE" != "server" && "$STATION_ROLE" != "backup" ]]; then
    log "Stage: schema -- skipped (terminal role)"
    return 0
  fi

  # Database migrations only run on server (backup gets data via pg_basebackup)
  if [[ "$STATION_ROLE" == "server" ]]; then

    # ── Step 1: Read schema version from Neon (source of record) ──
    # Neon is the canonical schema authority. We read the version from Neon
    # to know what version local PG should report, but we use LOCAL tested
    # migration paths (deploy-tools/apply-schema.js + deploy-tools/migrate.js)
    # to build the schema. NO pg_dump. NO Neon schema cloning. Local migrations
    # are the schema path.
    NEON_SCHEMA_VERSION=""
    if [[ -n "$NEON_DIRECT_URL" ]]; then
      log "Reading schema version from Neon (source of record)..."
      NEON_SCHEMA_VERSION=$($NEON_PSQL "$NEON_DIRECT_URL" --connect-timeout=10 -tAc "SELECT \"schemaVersion\" FROM \"_venue_schema_state\" WHERE id = 1" 2>/dev/null | tr -d '[:space:]' || echo "")
      if [[ -n "$NEON_SCHEMA_VERSION" ]]; then
        log "Neon schema version: $NEON_SCHEMA_VERSION"
      else
        warn "Could not read schema version from Neon -- Neon may not be provisioned yet"
      fi
    fi

    # ── Step 2: Apply schema to LOCAL PG using deploy-tools ──
    # deploy-tools/apply-schema.js bootstraps empty DBs from schema.sql.
    # deploy-tools/migrate.js runs numbered migrations for data backfills + DDL patches.
    # Timeout 120s: apply-schema can be slow on first run against an empty DB.

    # Capture pre-push table list for drift detection
    local PRE_PUSH_TABLES
    PRE_PUSH_TABLES=$(sudo -u "$POSUSER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" 2>/dev/null || echo "")

    # ── Check if deploy-release.sh already completed schema migrations ──────
    local _skip_migrations=false
    if [[ "${LEGACY_DEPLOY:-}" != "1" ]]; then
      local _ds_file="$APP_BASE/shared/state/deploy-state.json"
      if [[ -f "$_ds_file" ]]; then
        local _ds_state="" _ds_release=""
        if command -v jq &>/dev/null; then
          _ds_state=$(jq -r '.state // empty' "$_ds_file" 2>/dev/null) || true
          _ds_release=$(jq -r '.releaseId // empty' "$_ds_file" 2>/dev/null) || true
        else
          _ds_state=$(sed -n 's/.*"state"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_ds_file" 2>/dev/null | head -1) || true
          _ds_release=$(sed -n 's/.*"releaseId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_ds_file" 2>/dev/null | head -1) || true
        fi

        # Read current release ID from deployed artifact
        local _current_release=""
        if [[ -f "$APP_DIR/artifact-metadata.json" ]]; then
          if command -v jq &>/dev/null; then
            _current_release=$(jq -r '.releaseId // empty' "$APP_DIR/artifact-metadata.json" 2>/dev/null) || true
          else
            _current_release=$(sed -n 's/.*"releaseId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/artifact-metadata.json" 2>/dev/null | head -1) || true
          fi
        fi

        case "$_ds_state" in
          migrated|healthy|activated|installed_pending_service)
            if [[ -n "$_ds_release" ]] && [[ -n "$_current_release" ]] && [[ "$_ds_release" == "$_current_release" ]]; then
              log "Schema migrations already completed by deploy-release.sh"
              log "  Release: $_ds_release | State: $_ds_state"
              log "  Skipping apply-schema + migrate — proceeding to seed/validation"
              _skip_migrations=true
            else
              log "deploy-state shows '$_ds_state' but release mismatch (deploy: ${_ds_release:-none}, current: ${_current_release:-none})"
              log "Running migrations to ensure consistency"
            fi
            ;;
          *)
            if [[ -n "$_ds_state" ]]; then
              log "deploy-state is '$_ds_state' — running migrations"
            fi
            ;;
        esac
      fi
    fi

    # ── Preferred path: deploy-tools inside gwi-pos container (pg-only, no Prisma) ──
    if docker ps -q --filter name=gwi-pos --filter status=running | grep -q .; then
      if [[ "$_skip_migrations" == "false" ]]; then
        log "Applying schema via deploy-tools (pg-only, docker exec)..."
        if ! timeout --kill-after=10 120 docker exec gwi-pos bash -c "cd /app/deploy-tools && DATABASE_URL='$DATABASE_URL' node src/apply-schema.js" 2>&1 | tail -5; then
          if [[ "${IS_REINSTALL:-false}" == "false" ]]; then
            err_code "ERR-INST-183" "apply-schema.js failed on fresh install -- cannot continue with empty database"
            return 1
          else
            warn "apply-schema.js had issues on re-install -- continuing (existing schema should be intact)"
          fi
        else
          log "Schema applied successfully (deploy-tools)"
          touch "$APP_BASE/shared/state/.schema-stage-done"
        fi

        log "Running local migrations via deploy-tools (docker exec)..."
        if ! docker exec gwi-pos bash -c "cd /app/deploy-tools && DATABASE_URL='$DATABASE_URL' node src/migrate.js" 2>&1; then
          if [[ "${IS_REINSTALL:-false}" == "false" ]]; then
            err_code "ERR-INST-184" "Migration runner failed on fresh install -- cannot continue with partial schema"
            return 1
          else
            warn "Migrations failed on re-install -- continuing (existing data should be intact)"
            track_warn "deploy-tools migrate.js failed on re-install"
          fi
        fi
      fi

      # ── Venue Neon: observe-only (MC is schema authority) ──
      if [[ -n "${NEON_DATABASE_URL:-}" ]]; then
        log "Venue Neon migration skipped: MC is schema authority (observe-only mode)"
        # Read Neon migration count for diagnostics only — never execute migrations
        _neon_mig_count=$(docker exec gwi-pos bash -c "DATABASE_URL='$NEON_DATABASE_URL' node -e \"
          const { Client } = require('pg');
          const c = new Client({ connectionString: process.env.DATABASE_URL });
          c.connect().then(() => c.query('SELECT COUNT(*)::int as cnt FROM \\\"_gwi_migrations\\\"'))
            .then(r => { console.log(r.rows[0].cnt); c.end(); })
            .catch(() => { console.log('-1'); c.end(); });
        \"" 2>/dev/null || echo "-1")
        if [[ "$_neon_mig_count" != "-1" ]]; then
          log "Neon migration count (observed): $_neon_mig_count"
        else
          warn "Could not read Neon migration count (Neon may not be provisioned)"
        fi
      fi
    else
      err_code "ERR-INST-184" "gwi-pos container not running -- deploy-tools unavailable"
      warn "Schema migration requires the gwi-pos container to be running"
      track_warn "gwi-pos container not running for deploy-tools"
    fi

    # Capture post-schema tables and detect dropped tables
    local POST_PUSH_TABLES
    POST_PUSH_TABLES=$(sudo -u "$POSUSER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename" 2>/dev/null || echo "")
    if [[ -n "$PRE_PUSH_TABLES" ]] && [[ -n "$POST_PUSH_TABLES" ]]; then
      local dropped
      dropped=$(comm -23 <(echo "$PRE_PUSH_TABLES") <(echo "$POST_PUSH_TABLES"))
      if [[ -n "$dropped" ]]; then
        err_code "ERR-INST-181" "Dropped tables: $dropped"
        warn "Tables dropped by schema operation: $dropped"
        track_warn "Schema operation dropped tables: $dropped"
      fi
    fi

    # ── Step 2.5: Warn if _venue_schema_state missing in Neon ──
    # AUTHORITY MODEL: _venue_schema_state is MC-owned. The installer must NOT
    # create or write to it in Neon. MC provisions that table during venue setup.
    # If it's missing, the readiness gate will block sync -- that's the correct
    # behavior until MC completes provisioning. Log a clear warning so the tech
    # knows to check MC provisioning status.
    if [[ -n "$NEON_DIRECT_URL" ]] && [[ -z "$NEON_SCHEMA_VERSION" ]]; then
      TABLE_COUNT=$(PGPASSWORD="" $NEON_PSQL "$NEON_DIRECT_URL" --connect-timeout=10 -tAc \
        "SELECT COUNT(*)::text FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" \
        2>/dev/null | tr -d '[:space:]' || echo "0")

      if [[ "$TABLE_COUNT" -gt "0" ]]; then
        warn "Neon has $TABLE_COUNT tables but _venue_schema_state is MISSING."
        warn "This means MC provisioning did not complete for this venue."
        warn "Sync readiness gate will block until MC provisions this table."
        warn "Fix: Go to Mission Control -> this venue -> re-run provisioning."
        track_warn "Neon _venue_schema_state missing -- MC provisioning incomplete"
      fi
    fi

    # Seed local PG from Neon cloud (offline-first mode)
    if [[ "$SYNC_ENABLED" == "true" ]] && [[ -n "$NEON_DATABASE_URL" ]]; then
      log "Seeding local database from Neon cloud..."
      if ! docker exec gwi-pos bash -c "cd /app && APP_BASE='$APP_BASE' bash scripts/seed-from-neon.sh" 2>&1 | tail -5; then
        # Check if seed wrote an INCOMPLETE marker
        if [[ -f "$APP_BASE/.seed-status" ]] && grep -q "^INCOMPLETE" "$APP_BASE/.seed-status"; then
          SEED_REASON=$(cat "$APP_BASE/.seed-status" | cut -d: -f3-)
          err_code "ERR-INST-183" "Neon seed incomplete: $SEED_REASON"
          err "Neon seed FAILED: $SEED_REASON"
          err "The venue cannot activate on partial data. Fix the issue and re-run the installer."
          err "Seed status file: $APP_BASE/.seed-status"
          return 1
        else
          warn "Neon seed had warnings -- check $APP_BASE/.seed-status"
          if [[ "${IS_REINSTALL:-false}" == "false" ]]; then
            err_code "ERR-INST-186" "Seed incomplete on fresh install -- venue cannot operate without data"
            return 1
          fi
        fi
      fi
      # Verify seed completed successfully
      if [[ -f "$APP_BASE/.seed-status" ]]; then
        SEED_STATE=$(head -c 8 "$APP_BASE/.seed-status")
        if [[ "$SEED_STATE" == "COMPLETE" ]]; then
          log "Neon seed verified complete."
        else
          err_code "ERR-INST-183" "Seed status: $(cat "$APP_BASE/.seed-status")"
          err "Seed did not complete successfully (status: $(cat "$APP_BASE/.seed-status"))"
          return 1
        fi
      else
        warn "No seed status file found -- seed may not have run the hardened version"
        if [[ "${IS_REINSTALL:-false}" == "false" ]]; then
          err_code "ERR-INST-186" "Seed incomplete on fresh install -- venue cannot operate without data"
          return 1
        fi
      fi
    fi

    # ── Post-schema: validate critical tables ──
    log "Validating critical tables..."
    local critical_tables=("Organization" "Location" "Employee" "Role" "OrderType")
    local validation_failed=false
    for tbl in "${critical_tables[@]}"; do
      local exists
      exists=$(PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h localhost -d "$DB_NAME" -tAc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='$tbl' AND table_schema='public')" 2>/dev/null || echo "f")
      if [[ "$exists" == "t" ]]; then
        local count
        count=$(PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h localhost -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM \"$tbl\"" 2>/dev/null || echo "0")
        if [[ "$count" -eq 0 ]]; then
          warn "$tbl exists but is empty (seed may be pending)"
        else
          log "  $tbl: $count rows"
        fi
      else
        err "$tbl table MISSING -- schema apply may have failed"
        validation_failed=true
      fi
    done
    if [[ "$validation_failed" == "true" ]]; then
      err_code "ERR-INST-182" "One or more critical tables missing after schema apply"
      err "Critical tables missing -- cannot proceed"
      return 1
    fi

    # ── Post-schema: disable RLS on all tables ──
    # Schema migrations may enable RLS on some tables.
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

    # Escape single quotes to prevent SQL injection
    local _esc_version="${SCHEMA_VERSION//\'/\'\'}"
    sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "
      CREATE TABLE IF NOT EXISTS \"_local_install_state\" (
        id SERIAL PRIMARY KEY,
        installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        pos_version TEXT,
        installer_version TEXT,
        schema_migrations_run INTEGER
      );
      INSERT INTO \"_local_install_state\" (pos_version, installer_version) VALUES ('$_esc_version', 'installer.run');
    " >/dev/null 2>&1
    log "Local install state recorded (pos_version=$SCHEMA_VERSION, source=$SCHEMA_SOURCE)"
    log "NOTE: _venue_schema_state is MC-owned -- installer does not write to it"
  else
    log "Skipping database migrations (backup standby -- data replicated from primary)."
  fi

  # ── Build step ──
  # Artifact deploys are pre-built on Vercel -- skip npm run build.
  # Legacy deploys (git clone) need a local build.
  if [[ -d "$APP_DIR/.next" ]] && [[ "${LEGACY_DEPLOY:-}" != "1" ]]; then
    log "Artifact deploy detected (.next exists) -- skipping build (already pre-built on Vercel)"
  else
    # NUC builds skip TypeScript type-checking (tsc --noEmit) because:
    # 1. Types are already verified in CI/Vercel before code reaches the NUC
    # 2. tsc needs 4-16GB heap and takes 2-3 minutes -- wasteful on every install
    # 3. Type errors don't affect runtime behavior (Next.js builds fine without tsc)
    local BUILD_NODE_OPTS="--max-old-space-size=4096"

    # Clear stale tsc incremental cache -- prevents false type errors after schema changes
    rm -f "$APP_DIR/tsconfig.tsbuildinfo" 2>/dev/null || true

    log "Building POS application (this takes a few minutes)..."
    if ! sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && SKIP_TYPECHECK=1 NODE_OPTIONS='$BUILD_NODE_OPTS' npm run build" 2>&1 | tail -5; then
      err_code "ERR-INST-186" "npm run build failed in $APP_DIR"
      err "Application build failed. Re-running with full output..."
      sudo -u "$POSUSER" bash -c "cd '$APP_DIR' && SKIP_TYPECHECK=1 NODE_OPTIONS='$BUILD_NODE_OPTS' npm run build"
      return 1
    fi
    log "POS application built successfully!"
  fi

  # ── Post-build: update _local_install_state with freshly generated version ──
  # The build step generates version-contract.json with the real schema version.
  # This is purely informational -- _venue_schema_state is MC-owned, not touched here.
  if [[ "$STATION_ROLE" == "server" ]]; then
    BUILT_VERSION=$(sudo -u "$POSUSER" node -e "try{console.log(require('$APP_DIR/src/generated/version-contract.json').schemaVersion)}catch(e){}" 2>/dev/null || echo "")
    if [[ -z "$BUILT_VERSION" ]]; then
      BUILT_VERSION=$(sudo -u "$POSUSER" node -e "try{console.log(require('$APP_DIR/public/version-contract.json').schemaVersion)}catch(e){}" 2>/dev/null || echo "")
    fi
    if [[ -n "$BUILT_VERSION" ]] && [[ "$BUILT_VERSION" != "${SCHEMA_VERSION:-}" ]]; then
      log "Recording post-build version in _local_install_state: $BUILT_VERSION (was: ${SCHEMA_VERSION:-unknown})"
      # Escape single quotes to prevent SQL injection
      local _esc_built_version="${BUILT_VERSION//\'/\'\'}"
      sudo -u "$POSUSER" PGPASSWORD="$DB_PASSWORD" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -c "
        INSERT INTO \"_local_install_state\" (pos_version, installer_version) VALUES ('$_esc_built_version', 'installer-post-build');
      " >/dev/null 2>&1
    fi
  fi

  log "Stage: schema -- completed in $(( $(date +%s) - _start ))s"
  return 0
}
