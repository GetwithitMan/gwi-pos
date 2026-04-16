/**
 * Migration 129 — Combo Pick N of M (Phase 1: Server Schema)
 *
 * Adds per-combo opt-in upcharge support and a snapshot table that records
 * the customer's actual picks at order time.
 *
 * Changes:
 *   1. ComboTemplate.allowUpcharges  BOOLEAN NOT NULL DEFAULT false
 *   2. OrderItemComboSelection table (snapshot-first):
 *      - Hard FK: orderItemId (CASCADE), menuItemId (NO ACTION — snapshot refs)
 *      - Soft FKs: comboComponentId, comboComponentOptionId (SET NULL)
 *      - locationId FK to Location
 *   3. Indices matching prisma schema.
 *
 * Additive only. No backfill. All DDL is guarded with tableExists / columnExists.
 */

const { columnExists, tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[129]'

  // ─── 1. ComboTemplate.allowUpcharges ──────────────────────────────────────
  if (!(await columnExists(prisma, 'ComboTemplate', 'allowUpcharges'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "ComboTemplate" ADD COLUMN "allowUpcharges" BOOLEAN NOT NULL DEFAULT false`
    )
    console.log(`${PREFIX} Added ComboTemplate.allowUpcharges`)
  }

  // ─── 2. OrderItemComboSelection table ─────────────────────────────────────
  const tableAlreadyExists = await tableExists(prisma, 'OrderItemComboSelection')
  if (!tableAlreadyExists) {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "OrderItemComboSelection" (
        "id" TEXT NOT NULL,
        "locationId" TEXT NOT NULL,
        "orderItemId" TEXT NOT NULL,
        "comboComponentId" TEXT,
        "comboComponentOptionId" TEXT,
        "menuItemId" TEXT NOT NULL,
        "optionName" TEXT NOT NULL,
        "upchargeApplied" DECIMAL(10,2) NOT NULL DEFAULT 0,
        "sortIndex" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP(3),
        "syncedAt" TIMESTAMP(3),
        "lastMutatedBy" TEXT,
        CONSTRAINT "OrderItemComboSelection_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "OrderItemComboSelection_orderItemId_fkey"
          FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "OrderItemComboSelection_comboComponentId_fkey"
          FOREIGN KEY ("comboComponentId") REFERENCES "ComboComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "OrderItemComboSelection_comboComponentOptionId_fkey"
          FOREIGN KEY ("comboComponentOptionId") REFERENCES "ComboComponentOption"("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "OrderItemComboSelection_menuItemId_fkey"
          FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
        CONSTRAINT "OrderItemComboSelection_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE NO ACTION ON UPDATE CASCADE
      )
    `)
    console.log(`${PREFIX} Created OrderItemComboSelection table`)
  }

  // ─── 3. Indices (idempotent via IF NOT EXISTS / indexExists guard) ───────
  const idxSpecs = [
    {
      name: 'OrderItemComboSelection_orderItemId_idx',
      sql: `CREATE INDEX "OrderItemComboSelection_orderItemId_idx" ON "OrderItemComboSelection"("orderItemId")`,
    },
    {
      name: 'OrderItemComboSelection_locationId_idx',
      sql: `CREATE INDEX "OrderItemComboSelection_locationId_idx" ON "OrderItemComboSelection"("locationId")`,
    },
    {
      name: 'OrderItemComboSelection_menuItemId_idx',
      sql: `CREATE INDEX "OrderItemComboSelection_menuItemId_idx" ON "OrderItemComboSelection"("menuItemId")`,
    },
    {
      name: 'OrderItemComboSelection_orderItemId_sortIndex_idx',
      sql: `CREATE INDEX "OrderItemComboSelection_orderItemId_sortIndex_idx" ON "OrderItemComboSelection"("orderItemId", "sortIndex")`,
    },
    {
      name: 'OrderItemComboSelection_comboComponentId_idx',
      sql: `CREATE INDEX "OrderItemComboSelection_comboComponentId_idx" ON "OrderItemComboSelection"("comboComponentId")`,
    },
  ]

  for (const idx of idxSpecs) {
    if (!(await indexExists(prisma, idx.name))) {
      await prisma.$executeRawUnsafe(idx.sql)
      console.log(`${PREFIX} Created index ${idx.name}`)
    }
  }

  console.log(`${PREFIX} Migration complete`)
}

module.exports = { up }
