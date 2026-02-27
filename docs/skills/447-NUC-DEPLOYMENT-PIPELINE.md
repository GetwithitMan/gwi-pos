# Skill 447: NUC Deployment Pipeline — Pre-Migrate + Sync Agent

**Date:** 2026-02-25
**Commits:** `fa4c803`, `5b28181`
**Status:** DONE

## Overview

End-to-end NUC fleet deployment via Mission Control. Covers the full FORCE_UPDATE cycle: sync agent receives command via SSE, pulls code, runs pre-flight database migrations, builds, and restarts the POS service.

## Architecture

```
MC "Deploy" button
  → Creates FORCE_UPDATE FleetCommand (DB)
  → NUC sync agent receives via SSE stream
  → handleForceUpdate() runs:
      1. git fetch origin + git reset --hard origin/main
      2. cp /opt/gwi-pos/.env → app/.env + .env.local
      3. npm install --production=false
      4. npx prisma generate
      5. node scripts/nuc-pre-migrate.js  ← pre-flight DB migrations
      6. npx prisma migrate deploy        ← soft fail (P3005 expected)
      7. npx prisma db push --accept-data-loss
      8. npm run build
      9. sudo systemctl restart thepasspos
     10. Self-update: copy new sync-agent.js from repo
     11. ACK COMPLETED → MC updates deployment status
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
| `FORCE_UPDATE` | `handleForceUpdate()` | Full deploy cycle (see architecture above) |
| `RE_PROVISION` | Aliases to `handleForceUpdate()` | Same as FORCE_UPDATE |
| `RELOAD_TERMINALS` | Service restart | `systemctl restart thepasspos` (forces client reconnect) |
| `RELOAD_TERMINAL` | Service restart | Same as RELOAD_TERMINALS on NUC |
| `RESTART_KIOSK` | Service restart | `systemctl restart thepasspos-kiosk` |
| `DATA_CHANGED` | Domain sync | Fetches settings from MC, pushes to local POS |
| `UPDATE_PAYMENT_CONFIG` | RSA decrypt + push | Decrypts payload with private key, pushes to local API |
| `KILL_SWITCH` | Acknowledge only | Grace shutdown signal |
| `SCHEDULE_REBOOT` | System reboot | `sudo shutdown -r +N` |
| `CANCEL_REBOOT` | Cancel reboot | `sudo shutdown -c` |
| `REPAIR_GIT_CREDENTIALS` | Credential update | Writes deploy token to .git-credentials, validates with fetch |

### Service Name Resolution

NUC services may have different names depending on installer version:
- **Current:** `thepasspos`, `thepasspos-sync`, `thepasspos-kiosk`
- **Legacy:** `thepasspos`, `thepasspos-sync`, `thepasspos-kiosk`

Sync agent tries current name first, falls back to legacy.

## Self-Update Mechanism

The sync agent updates itself on two occasions:

1. **Boot self-update** (`checkBootUpdate()`): On every startup, downloads latest sync-agent.js from GitHub API. If content differs, writes new file and exits (systemd restarts with new code).

2. **Post-deploy self-update**: After successful FORCE_UPDATE, copies `public/sync-agent.js` from freshly pulled repo to `/opt/gwi-pos/sync-agent.js`, then schedules `systemctl restart thepasspos-sync` after 15s (allows ACK to send first).

### Chicken-and-Egg Recovery

If the sync agent has a bug that prevents deployment:
1. Push fix to GitHub repo
2. Reboot NUC (or `systemctl restart thepasspos-sync`)
3. Boot self-update downloads fixed code from GitHub
4. Next FORCE_UPDATE works with corrected handler

## Debugging NUC Deploys

```bash
# SSH into NUC
ssh smarttab@<nuc-ip>

# Watch sync agent logs (real-time)
sudo journalctl -u thepasspos-sync -f

# Watch POS service logs
sudo journalctl -u thepasspos -f -n 100

# Check current deployed version
cat /opt/gwi-pos/app/package.json | grep version

# Check sync agent version matches repo
diff /opt/gwi-pos/sync-agent.js /opt/gwi-pos/app/public/sync-agent.js

# Manually trigger pre-migrate
cd /opt/gwi-pos/app && node scripts/nuc-pre-migrate.js

# Check database state
psql thepasspos -c "SELECT data_type FROM information_schema.columns WHERE table_name='Payment' AND column_name='paymentMethod'"
```
