# Skill 342: PostgreSQL-Only DevOps (Performance Phase 4)

**Status:** DONE
**Date:** February 14, 2026
**Commits:** `dbae96f` (source cleanup), `6302d95` (Docker/scripts/docs)
**Domain:** DevOps / Infrastructure
**Impact:** Zero SQLite references in codebase; clean PostgreSQL-only deployment

---

## Problem

Application code was fully on PostgreSQL (Neon, database-per-venue), but Docker, scripts, docs, and some API routes still referenced SQLite. JSON.parse string fallbacks from the SQLite era remained in 5 API routes.

## Solution

### Source Cleanup
- Removed SQLite fallback in `src/lib/db.ts`
- Removed `JSON.parse` string fallbacks in roles, tips, entertainment APIs (PostgreSQL returns real JSON)
- Standardized `Prisma.DbNull` usage

### Infrastructure
- `docker/Dockerfile`: Removed `sqlite3` install, removed hardcoded `DATABASE_URL="file:/app/data/pos.db"`
- `docker/docker-compose.yml`: Removed SQLite volume mounts
- `scripts/reset-db.sh`: Rewritten for PostgreSQL (`prisma db push --force-reset`)

### Documentation
18 doc files updated: DATABASE-REFERENCE, DEPLOYMENT-GUIDE, GWI-ARCHITECTURE, INSTALL.txt, etc.

### Connection Pooling
- `DATABASE_CONNECTION_LIMIT` env var (default 5)
- `DATABASE_POOL_TIMEOUT` env var (default 10s)
- Configured in `src/lib/db.ts`

## Verification

```bash
# Must return 0 matches
grep -Ri "sqlite|pos.db" src/ scripts/ docker/
```

## Database Architecture

```
Production: Neon PostgreSQL (database-per-venue)
  └── Each venue gets its own Neon database
  └── Per-venue PrismaClient cached in globalThis.venueClients
  └── withVenue() wrapper resolves DB from request context

Development: Local PostgreSQL (single database)
  └── DATABASE_URL in .env.local
```

## Key Files

| File | Changes |
|------|---------|
| `src/lib/db.ts` | PostgreSQL-only, connection pooling, 3-tier Proxy |
| `docker/Dockerfile` | No sqlite3, PostgreSQL client libs |
| `docker/docker-compose.yml` | PostgreSQL volumes only |
| `scripts/reset-db.sh` | pg_dump/psql commands |
| 18 documentation files | "Neon PostgreSQL (database-per-venue)" |
