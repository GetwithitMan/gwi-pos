# Deploy-Tools Validation Record

## Phase 1a Gate — 2026-03-28

**Test environment:** Live NUC at 172.16.20.50 (Shaunel's venue)
- Node v20.20.0
- PostgreSQL local (DATABASE_URL from /opt/gwi-pos/.env)
- 245 public tables, 115 migrations already applied via legacy nuc-pre-migrate.js

**Artifact:** deploy-tools-1.1.1607-0ae9322f.tar.zst (192KB)
- Built on macOS, extracted on Ubuntu NUC
- pg@8.20.0 as sole runtime dependency
- No Prisma CLI, no tsx, no generated client, no dotenv

### migrate.js Results

```
[deploy-tools:migrate] Target: local PG
[deploy-tools:migrate] Running migrations...
[deploy-tools:migrate] Acquired advisory lock
[deploy-tools:migrate] Skipped 115 already-applied migration(s)
[deploy-tools:migrate] Migrations complete (0 applied, 115 skipped)
```

- **PgCompat wrapper:** Connected to local PG, advisory lock acquired/released
- **_gwi_migrations compatibility:** All 115 filenames matched — zero drift between old and new runner
- **Parameter syntax:** $1/$2 placeholders identical between Prisma and pg (no translation needed)

### apply-schema.js Results

```
[deploy-tools:apply-schema] schema.sql: 9287 lines
[deploy-tools:apply-schema] Database has 245 tables — schema already in place
[deploy-tools:apply-schema] Skipping schema.sql (migrations handle incremental changes)
```

- **Non-empty DB detection:** Correctly identified 245 tables and skipped bootstrap
- **Empty DB path:** Not tested (would require disposable database)

### Build Validation

```
==> Building deploy-tools artifact (1.1.1607-0ae9322f)...
    115 migration files
    schema.sql: 9286 lines
    Validating staged artifact... OK
    Re-validating from extracted artifact... OK
==> Deploy-tools artifact built: deploy-tools-1.1.1607-0ae9322f.tar.zst (192K)
```

- Staged validate-only: PASS
- Extracted validate-only: PASS (proves shipped artifact is self-contained)

### Clean-Room Contamination Check

- No `prisma` in node_modules
- No `@prisma` in node_modules
- No `tsx` in node_modules
- No `dotenv` in node_modules
- No `next` in node_modules
- No `react` in node_modules

### Verdict

Phase 1a gate **PASSED**. The deploy-tools migration runner is a drop-in replacement for nuc-pre-migrate.js on production NUC databases using only pg.
