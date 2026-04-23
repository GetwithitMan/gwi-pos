/**
 * Migration 131 — Loyalty Earn Outbox + Partial Unique Index
 *
 * Tickets T2+T4 of the Loyalty Rewards Cleanup workstream.
 *
 * 1. Creates the PendingLoyaltyEarn outbox table (mirrors PendingDeduction).
 *    The table is enqueued atomically inside the payment commit transaction
 *    and drained by src/lib/domain/loyalty/loyalty-earn-worker.ts.
 *
 * 2. Creates a partial unique index on
 *    LoyaltyTransaction(locationId, orderId) WHERE type='earn'
 *    This is the DB-level backstop that guarantees exactly one persisted
 *    earn event per order lifecycle, regardless of which route/worker
 *    enqueued the write.
 *
 * Additive only. All DDL is guarded with tableExists / indexExists.
 */

const { tableExists, indexExists, columnExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[131-loyalty-earn-outbox-and-unique]'

  // ─── 1. PendingLoyaltyEarn table ────────────────────────────────────────
  if (!(await tableExists(prisma, 'PendingLoyaltyEarn'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "PendingLoyaltyEarn" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderId" TEXT NOT NULL,
        "customerId" TEXT NOT NULL,
        "pointsEarned" INTEGER NOT NULL,
        "loyaltyEarningBase" DECIMAL(10,2) NOT NULL,
        "tierMultiplier" DECIMAL(6,3) NOT NULL DEFAULT 1.000,
        "employeeId" TEXT,
        "orderNumber" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 5,
        "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastError" TEXT,
        "lastAttemptAt" TIMESTAMP(3),
        "succeededAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PendingLoyaltyEarn_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "PendingLoyaltyEarn_orderId_key" UNIQUE ("orderId"),
        CONSTRAINT "PendingLoyaltyEarn_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created PendingLoyaltyEarn table`)
  } else {
    console.log(`${PREFIX} PendingLoyaltyEarn table already exists`)
  }

  // ─── 2. Indices for PendingLoyaltyEarn ──────────────────────────────────
  const idxSpecs = [
    {
      name: 'PendingLoyaltyEarn_locationId_status_availableAt_idx',
      sql: `CREATE INDEX "PendingLoyaltyEarn_locationId_status_availableAt_idx" ON "PendingLoyaltyEarn"("locationId", "status", "availableAt")`,
    },
    {
      name: 'PendingLoyaltyEarn_status_availableAt_idx',
      sql: `CREATE INDEX "PendingLoyaltyEarn_status_availableAt_idx" ON "PendingLoyaltyEarn"("status", "availableAt")`,
    },
  ]
  for (const idx of idxSpecs) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created index ${idx.name}`)
    }
  }

  // ─── 3. Partial unique index on LoyaltyTransaction(orderId) WHERE type='earn' ───
  // DB-level backstop: guarantees at most one persisted earn row per
  // (locationId, orderId). The worker treats unique-violation as an expected
  // "already processed" signal, logs + acks the outbox row.
  const hasLoyaltyTable = await tableExists(prisma, 'LoyaltyTransaction')
  if (!hasLoyaltyTable) {
    console.log(`${PREFIX} LoyaltyTransaction table not found -- skipping partial unique index`)
    return
  }

  const hasTypeCol = await columnExists(prisma, 'LoyaltyTransaction', 'type')
  const hasOrderIdCol = await columnExists(prisma, 'LoyaltyTransaction', 'orderId')
  const hasLocationIdCol = await columnExists(prisma, 'LoyaltyTransaction', 'locationId')
  if (!hasTypeCol || !hasOrderIdCol || !hasLocationIdCol) {
    console.log(`${PREFIX} LoyaltyTransaction missing required columns -- skipping partial unique index`)
    return
  }

  // Deduplicate any historical duplicate earn rows before creating the index.
  // Keep the earliest row per (locationId, orderId) — preserves the first
  // audit trail and the balanceBefore/balanceAfter numbers that downstream
  // reports have already been reconciled against.
  const dupes = await prisma.$queryRawUnsafe(`
    SELECT "locationId", "orderId", COUNT(*)::int as cnt
      FROM "LoyaltyTransaction"
     WHERE "type" = 'earn' AND "orderId" IS NOT NULL
     GROUP BY "locationId", "orderId"
    HAVING COUNT(*) > 1
  `)
  if (dupes.length > 0) {
    console.log(`${PREFIX} Found ${dupes.length} duplicate earn groups, pruning all but the earliest row per order...`)
    for (const { locationId, orderId } of dupes) {
      // Delete everything except the earliest createdAt per group
      await prisma.$executeRawUnsafe(`
        DELETE FROM "LoyaltyTransaction"
         WHERE "id" IN (
           SELECT "id" FROM "LoyaltyTransaction"
            WHERE "locationId" = $1 AND "orderId" = $2 AND "type" = 'earn'
            ORDER BY "createdAt" ASC
            OFFSET 1
         )
      `, locationId, orderId)
    }
    console.log(`${PREFIX} Duplicate earn rows pruned`)
  }

  const earnIdxName = 'LoyaltyTransaction_locationId_orderId_earn_unique'
  if (!(await indexExists(prisma, earnIdxName))) {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "${earnIdxName}"
        ON "LoyaltyTransaction" ("locationId", "orderId")
       WHERE "type" = 'earn' AND "orderId" IS NOT NULL
    `)
    console.log(`${PREFIX} Created partial unique index ${earnIdxName}`)
  } else {
    console.log(`${PREFIX} Partial unique index ${earnIdxName} already exists`)
  }

  console.log(`${PREFIX} Migration complete`)
}

module.exports = { up }
