/**
 * Migration 118 — Unified Split Checks (Phase 1)
 *
 * Adds split-family semantics to Order:
 *   splitClass, splitMode, splitFamilyRootId, splitFamilyTotal,
 *   splitResolution, supersededBy, supersededAt
 *
 * Creates:
 *   ItemShare — item-level share splits (one line item divided across checks)
 *
 * Backfills:
 *   Legacy even/custom allocation children (zero items, non-null parentOrderId)
 *   get splitClass='allocation', splitMode='even', splitFamilyRootId=parentOrderId
 */

const { tableExists, columnExists, indexExists } = require('../migration-helpers')

module.exports.up = async function up(prisma) {
  const PREFIX = '[118]'

  // ─── 1. New columns on Order ───────────────────────────────────────────────

  if (!(await columnExists(prisma, 'Order', 'splitClass'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "splitClass" TEXT`)
    console.log(`${PREFIX} Added Order.splitClass`)
  } else {
    console.log(`${PREFIX} Order.splitClass already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'splitMode'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "splitMode" TEXT`)
    console.log(`${PREFIX} Added Order.splitMode`)
  } else {
    console.log(`${PREFIX} Order.splitMode already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'splitFamilyRootId'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "splitFamilyRootId" TEXT`)
    console.log(`${PREFIX} Added Order.splitFamilyRootId`)
  } else {
    console.log(`${PREFIX} Order.splitFamilyRootId already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'splitFamilyTotal'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "splitFamilyTotal" DECIMAL(65, 30)`)
    console.log(`${PREFIX} Added Order.splitFamilyTotal`)
  } else {
    console.log(`${PREFIX} Order.splitFamilyTotal already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'splitResolution'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "splitResolution" TEXT`)
    console.log(`${PREFIX} Added Order.splitResolution`)
  } else {
    console.log(`${PREFIX} Order.splitResolution already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'supersededBy'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "supersededBy" TEXT`)
    console.log(`${PREFIX} Added Order.supersededBy`)
  } else {
    console.log(`${PREFIX} Order.supersededBy already exists — skipped`)
  }

  if (!(await columnExists(prisma, 'Order', 'supersededAt'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN "supersededAt" TIMESTAMP(3)`)
    console.log(`${PREFIX} Added Order.supersededAt`)
  } else {
    console.log(`${PREFIX} Order.supersededAt already exists — skipped`)
  }

  // ─── 2. Indexes on Order ──────────────────────────────────────────────────

  if (!(await indexExists(prisma, 'Order_splitFamilyRootId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Order_splitFamilyRootId_idx" ON "Order" ("splitFamilyRootId")`)
    console.log(`${PREFIX} Created Order_splitFamilyRootId_idx`)
  } else {
    console.log(`${PREFIX} Order_splitFamilyRootId_idx already exists — skipped`)
  }

  if (!(await indexExists(prisma, 'Order_splitResolution_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "Order_splitResolution_idx" ON "Order" ("splitResolution")`)
    console.log(`${PREFIX} Created Order_splitResolution_idx`)
  } else {
    console.log(`${PREFIX} Order_splitResolution_idx already exists — skipped`)
  }

  // ─── 3. ItemShare table ───────────────────────────────────────────────────

  if (!(await tableExists(prisma, 'ItemShare'))) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "ItemShare" (
        "id"                  TEXT NOT NULL PRIMARY KEY,
        "locationId"          TEXT NOT NULL,
        "sourceItemId"        TEXT NOT NULL,
        "sourceOrderId"       TEXT NOT NULL,
        "targetOrderId"       TEXT NOT NULL,
        "shareIndex"          INTEGER NOT NULL,
        "totalShares"         INTEGER NOT NULL,
        "allocatedAmount"     DECIMAL(10,2) NOT NULL,
        "allocatedTax"        DECIMAL(10,2) NOT NULL DEFAULT 0,
        "allocatedDiscount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
        "resolvedAt"          TIMESTAMP(3),
        "resolvedByPaymentId" TEXT,
        "splitResolution"     TEXT,
        "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"           TIMESTAMP(3),

        CONSTRAINT "ItemShare_sourceItemId_fkey"
          FOREIGN KEY ("sourceItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "ItemShare_sourceOrderId_fkey"
          FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "ItemShare_targetOrderId_fkey"
          FOREIGN KEY ("targetOrderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "ItemShare_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created ItemShare table`)
  } else {
    console.log(`${PREFIX} ItemShare table already exists — skipped`)
  }

  // ItemShare indexes
  if (!(await indexExists(prisma, 'ItemShare_sourceItemId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "ItemShare_sourceItemId_idx" ON "ItemShare" ("sourceItemId")`)
    console.log(`${PREFIX} Created ItemShare_sourceItemId_idx`)
  }
  if (!(await indexExists(prisma, 'ItemShare_targetOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "ItemShare_targetOrderId_idx" ON "ItemShare" ("targetOrderId")`)
    console.log(`${PREFIX} Created ItemShare_targetOrderId_idx`)
  }
  if (!(await indexExists(prisma, 'ItemShare_sourceOrderId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "ItemShare_sourceOrderId_idx" ON "ItemShare" ("sourceOrderId")`)
    console.log(`${PREFIX} Created ItemShare_sourceOrderId_idx`)
  }
  if (!(await indexExists(prisma, 'ItemShare_locationId_idx'))) {
    await prisma.$executeRawUnsafe(`CREATE INDEX "ItemShare_locationId_idx" ON "ItemShare" ("locationId")`)
    console.log(`${PREFIX} Created ItemShare_locationId_idx`)
  }

  // ─── 4. Backfill legacy allocation splits ─────────────────────────────────
  //
  // Conservatively classify legacy children with zero non-deleted items as
  // allocation/even splits. Structural splits (which have items) are left NULL
  // for runtime fallback or manual classification.

  const result = await prisma.$executeRawUnsafe(`
    UPDATE "Order"
    SET "splitClass" = 'allocation',
        "splitMode" = 'even',
        "splitFamilyRootId" = "parentOrderId"
    WHERE "parentOrderId" IS NOT NULL
      AND "splitClass" IS NULL
      AND (SELECT COUNT(*) FROM "OrderItem" WHERE "orderId" = "Order".id AND "deletedAt" IS NULL) = 0
  `)
  console.log(`${PREFIX} Backfilled legacy allocation splits (${result} rows updated)`)

  console.log(`${PREFIX} Migration 118 complete — Unified Split Checks Phase 1`)
}
