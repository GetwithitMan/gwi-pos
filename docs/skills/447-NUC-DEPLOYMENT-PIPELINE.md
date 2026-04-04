# Skill 447: NUC Deployment Pipeline — Pre-Migrate + Sync Agent

**Date:** 2026-02-25
**Commits:** `fa4c803`, `5b28181`
**Status:** DONE

## Overview

End-to-end NUC fleet deployment via Mission Control. Covers the full FORCE_UPDATE cycle: sync agent receives command via SSE, pulls code, runs pre-flight database migrations, builds, and restarts the POS service.

## Architecture

```
MC "Deploy" button (or trigger-file protocol for automated deploys)
  → Creates FORCE_UPDATE FleetCommand (DB)
  → gwi-agent container receives via SSE stream
  → handleForceUpdate() calls gwi-node.sh deploy:
      1. Pull Docker image from GHCR (Cosign-verified)
      2. Run deploy-tools inside container:
         a. node scripts/migrate.js       ← pre-flight DB migrations
         b. node scripts/apply-schema.js   ← schema alignment
      3. Swap running gwi-pos container with new image
      4. Health check (HTTP /api/health on port 3005)
      5. Verify version-contract.json matches expected
      6. gwi-agent container also swapped (new sync-agent.js in new image)
      7. ACK COMPLETED → MC updates deployment status
```

## Key Files

| File | Purpose |
|------|---------|
| `public/sync-agent.js` | SSE listener, command dispatcher, FORCE_UPDATE handler |
| `scripts/nuc-pre-migrate.js` | Pre-flight SQL migrations for NUC local PostgreSQL |
| `scripts/vercel-build.js` | Same migrations for Vercel/Neon (cloud equivalent) |

## nuc-pre-migrate.js — Migration Suite

Mirrors `vercel-build.js` but uses `PrismaClient.$executeRawUnsafe()` instead of `@neondatabase/serverless`. All operations are idempotent.

### Migration Steps (in order)

1. **Column additions** — locationId, deletedAt on OrderOwnershipEntry, cloud_event_queue, ModifierTemplate
2. **Orphaned FK cleanup** — Null out Payment.terminalId/drawerId/shiftId/paymentReaderId/employeeId referencing non-existent rows (prevents FK constraint violations when db push adds @relation constraints)
3. **updatedAt backfills** — Add column if missing, backfill NULLs with NOW(), set NOT NULL on: OrderOwnershipEntry, PaymentReaderLog, TipLedgerEntry, TipTransaction, cloud_event_queue
4. **Order deduplication** — Deduplicate root orders with colliding (locationId, orderNumber), create partial unique index
5. **Int → Decimal(10,2)** — TipLedger.currentBalanceCents, TipLedgerEntry.amountCents, TipTransaction.amountCents/ccFeeAmountCents, TipDebt.originalAmountCents/remainingCents, CashTipDeclaration.amountCents
6. **String → Enum casts** — Payment.paymentMethod→PaymentMethod, TipLedgerEntry.type→TipLedgerEntryType, TipTransaction.sourceType→TipTransactionSourceType

### Adding New Migrations

When a schema change would fail `prisma db push` on tables with existing data:
1. Add the migration to BOTH `scripts/nuc-pre-migrate.js` AND `scripts/vercel-build.js`
2. nuc-pre-migrate uses `prisma.$executeRawUnsafe()` (PrismaClient)
3. vercel-build uses `sql\`...\`` (@neondatabase/serverless tagged templates)
4. Both must be idempotent — check before acting
5. New required columns: add as nullable → backfill → set NOT NULL
6. New enum columns: CREATE TYPE (with exception handler) → ALTER COLUMN TYPE USING cast
7. New FK constraints: null orphaned references first

## sync-agent.js — Command Handlers

| Command | Handler | Action |
|---------|---------|--------|
| `FORCE_UPDATE` | `handleForceUpdate()` | Calls `gwi-node.sh deploy` (see architecture above) |
| `RE_PROVISION` | Aliases to `handleForceUpdate()` | Same as FORCE_UPDATE |
| `RELOAD_TERMINALS` | Container restart | `docker restart gwi-pos` (forces client reconnect) |
| `RELOAD_TERMINAL` | Container restart | Same as RELOAD_TERMINALS on NUC |
| `RESTART_KIOSK` | Service restart | `systemctl restart thepasspos-kiosk` |
| `DATA_CHANGED` | Domain sync | Fetches settings from MC, pushes to local POS |
| `UPDATE_PAYMENT_CONFIG` | RSA decrypt + push | Decrypts payload with private key, pushes to local API |
| `KILL_SWITCH` | Acknowledge only | Grace shutdown signal |
| `SCHEDULE_REBOOT` | System reboot | `sudo shutdown -r +N` |
| `CANCEL_REBOOT` | Cancel reboot | `sudo shutdown -c` |
| `REPAIR_GIT_CREDENTIALS` | Credential update | Writes deploy token to .git-credentials, validates with fetch |

### Container Name Resolution

NUC runs Docker containers managed by `gwi-node.sh`:
- **gwi-pos** — POS application container (port 3005)
- **gwi-agent** — Sync agent container (SSE listener, fleet command handler)
- **thepasspos-kiosk** — Chromium kiosk (still a systemd service)

## Self-Update Mechanism

The sync agent is containerized inside the `gwi-agent` Docker container. It updates automatically when `gwi-node.sh deploy` pulls a new image -- both `gwi-pos` and `gwi-agent` containers are swapped together, so the sync agent always matches the deployed app version.

### Chicken-and-Egg Recovery

If the sync agent has a bug that prevents deployment:
1. Push fix to GitHub repo (triggers new Docker image build)
2. SSH into NUC and run `gwi-node.sh deploy` manually
3. Both containers are swapped with the fixed image
4. Next FORCE_UPDATE works with corrected handler

## Debugging NUC Deploys

```bash
# SSH into NUC
ssh gwipos@<nuc-ip>

# Watch sync agent logs (real-time)
docker logs gwi-agent -f

# Watch POS service logs
docker logs gwi-pos -f --tail 100

# Check container status
gwi-node.sh status

# Manually trigger deploy
gwi-node.sh deploy

# Check database state
psql thepasspos -c "SELECT data_type FROM information_schema.columns WHERE table_name='Payment' AND column_name='paymentMethod'"
```
