# Schema Authority Model

> One authority per environment. Migrations are the sole mutation mechanism.
> All other layers validate but do not mutate schema independently.

## Principles

1. **Schema changes are authored as numbered migrations** in `scripts/migrations/NNN-*.js`
2. **Migrations are applied by exactly one controlled path** per environment
3. **No environment mutates another environment's schema independently**
4. **`_gwi_migrations` is the canonical tracking table** — same migration set everywhere
5. **gwi-node.sh is the primary lifecycle agent on every NUC** — deploy, rollback, converge, status

## Environment Authority

### Master Neon (cloud canonical)

- **Authority:** Vercel build pipeline (`scripts/vercel-build.js`)
- **Mutation path:** `nuc-pre-migrate.js` (migrations) + `prisma db push` (declarative sync)
- **When:** On every Vercel deployment (git push to main)
- **Gate:** Explicit user deploy command -> git push -> Vercel build hook
- **Schema source of truth:** `prisma/schema.prisma` + `scripts/migrations/*.js`

### Venue Neon Databases

- **Authority:** Mission Control (MC) via internal API
- **Mutation paths:**
  - `/api/internal/provision` — creates new venue DB, applies full `schema.sql`
  - `/api/internal/sync-schema` — incremental DDL diff-sync after release deploy
- **When:** MC API calls during provisioning or post-deploy
- **Gate:** `PROVISION_API_KEY` (MC API)
- **Rule:** Only MC-controlled API paths may mutate venue Neon.
  NUC runtime code NEVER mutates venue Neon schema. The NUC does not touch Neon at all —
  this capability was removed from gwi-node.sh. Neon is maintained exclusively by the
  Vercel build (master) and MC API calls (venue databases).

### NUC Local PostgreSQL

- **Authority:** gwi-node.sh (the single deploy agent on every NUC, v2.0.0+)
- **Mutation paths:**
  - `gwi-node.sh deploy` -> runs `deploy-tools/migrate.js` + `deploy-tools/apply-schema.js` inside the Docker container
  - Container boot -> `deploy-tools/migrate.js` (safety net for incomplete deploys)
- **When:** MC fleet command -> sync-agent -> `gwi-node deploy`, or on container restart
- **Gate:** MC fleet command -> sync-agent -> gwi-node
- **Rule:** Local PG is the **only** database the NUC may mutate schema on.
  gwi-node.sh is the sole orchestrator. Docker containers run deploy-tools internally.

## Prohibited Paths

| Path | Status | Reason |
|------|--------|--------|
| NUC -> Neon `prisma db push` | **REMOVED** | NUC must not declaratively push schema to any Neon DB |
| NUC -> Neon migrations (runtime) | **REMOVED** | NUC runtime code must not mutate Neon schema |
| NUC -> Neon migrations (deploy) | **REMOVED** | gwi-node.sh no longer touches Neon; MC API owns venue Neon schema |
| NUC -> local `prisma db push` | **REMOVED** | deploy-tools is sole local schema engine |
| deploy-release.sh (schema authority) | **DEPRECATED** | deploy-release.sh is a thin wrapper delegating to gwi-node.sh; it has no schema authority |
| sync-agent.js -> `prisma migrate deploy` | **REMOVED** | Legacy path; deploy-tools handles migrations |
| sync-agent.js -> `prisma db push` | **REMOVED** | Legacy path; deploy-tools handles schema |
| `--accept-data-loss` on any target | **REMOVED** | Destructive changes must be explicit migrations |

## Migration Lifecycle

```
Developer writes migration
  -> scripts/migrations/NNN-description.js (exports async function up(prisma))
  -> Commit + push to main
  -> Vercel build applies to master Neon (canonical Neon migration path)
  -> MC fleet command triggers NUC deploy
  -> gwi-node.sh pulls Docker image from GHCR (Cosign-verified)
  -> deploy-tools/migrate.js applies to NUC local PG (inside container)
  -> MC sync-schema applies to venue Neon (DDL diff-sync, post-deploy)
```

## Validation (Read-Only)

These paths CHECK schema state but never mutate it:

- **Container boot** validates local migration count (warns on mismatch)
- **`_venue_schema_state`** table is MC-owned — NUC reads, never writes
- **`/api/health/ready`** checks DB connectivity + critical tables
- **Watchdog** checks service health, not schema state

## Transaction Safety

- Each migration runs in its own `BEGIN/COMMIT` transaction (C4 fix)
- Migration tracking (`_gwi_migrations` INSERT) is inside the same transaction
- On failure: `ROLLBACK` — DB unchanged, migration can be retried
- Advisory lock (ID 20250101) prevents concurrent migration runners
- Lock is released before process exit on timeout (C5 fix)

## Schema Version Tracking

| Table | Owner | Purpose |
|-------|-------|---------|
| `_gwi_migrations` | Shared (all environments) | Tracks which numbered migrations have been applied |
| `_venue_schema_state` | MC only | MC's record of venue schema version; NUC reads only |
| `_local_install_state` | NUC only | Informational; installer version + schema version at install time |
| `version-contract.json` | Build artifact | Stamped at build time; declares expected schema version |
