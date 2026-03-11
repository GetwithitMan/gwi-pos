/**
 * Migration 042: MenuItem unique constraint + re-dedup
 *
 * Migration 009 deduplicates MenuItem but never added a unique constraint,
 * allowing duplicates to re-appear (via downstream sync or dual-DB creation).
 *
 * This migration:
 * 1. Re-deduplicates MenuItem by (categoryId, name) — keeps the one with most OrderItem refs
 * 2. Adds a partial unique index on (categoryId, name) WHERE deletedAt IS NULL
 *    to permanently prevent future duplication
 */

const { tableExists, indexExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[042-menuitem-unique-constraint]'

  try {
    const menuItemExists = await tableExists(prisma, 'MenuItem')
    if (!menuItemExists) {
      console.log(`${PREFIX}   MenuItem table not found -- skipping`)
      return
    }

    const hasIdx = await indexExists(prisma, 'MenuItem_categoryId_name_active_key')
    if (hasIdx) {
      console.log(`${PREFIX}   MenuItem already has unique constraint -- skipping`)
      return
    }

    // ── Step 1: Count duplicates ───────────────────────────────────────────
    const dupeCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) as cnt FROM (
        SELECT "categoryId", "name", COUNT(*) as c
        FROM "MenuItem"
        WHERE "deletedAt" IS NULL
        GROUP BY "categoryId", "name"
        HAVING COUNT(*) > 1
      ) sub
    `)
    const numDupeGroups = Number(dupeCount[0]?.cnt ?? 0)

    if (numDupeGroups > 0) {
      console.log(`${PREFIX}   Found ${numDupeGroups} duplicate MenuItem groups -- deduplicating`)

      // Build keeper/dupe mapping: keep the item with the most OrderItem references
      await prisma.$executeRawUnsafe(`
        CREATE TEMP TABLE _mi_dedup AS
        WITH item_order_counts AS (
          SELECT mi.id, mi."categoryId", mi.name, mi."createdAt",
                 COALESCE(oc.cnt, 0) AS order_count
          FROM "MenuItem" mi
          LEFT JOIN (
            SELECT "menuItemId", COUNT(*) AS cnt
            FROM "OrderItem"
            GROUP BY "menuItemId"
          ) oc ON oc."menuItemId" = mi.id
          WHERE mi."deletedAt" IS NULL
        ),
        ranked AS (
          SELECT id, "categoryId", name,
                 ROW_NUMBER() OVER (
                   PARTITION BY "categoryId", name
                   ORDER BY order_count DESC, "createdAt" ASC
                 ) AS rn
          FROM item_order_counts
        )
        SELECT r.id AS dupe_id, k.id AS keeper_id
        FROM ranked r
        JOIN ranked k ON r."categoryId" = k."categoryId" AND r.name = k.name AND k.rn = 1
        WHERE r.rn > 1
      `)

      try {
        const dupeRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as cnt FROM _mi_dedup`)
        console.log(`${PREFIX}   Reassigning ${Number(dupeRows[0]?.cnt ?? 0)} duplicate MenuItem rows`)

        // Reassign FK references from dupe to keeper
        await prisma.$executeRawUnsafe(`UPDATE "OrderItem" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "OrderItem"."menuItemId" = d.dupe_id`)

        // Guard each optional table
        if (await tableExists(prisma, 'InventoryTransaction')) {
          await prisma.$executeRawUnsafe(`UPDATE "InventoryTransaction" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "InventoryTransaction"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'InventoryItemTransaction')) {
          await prisma.$executeRawUnsafe(`UPDATE "InventoryItemTransaction" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "InventoryItemTransaction"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'StockAlert')) {
          await prisma.$executeRawUnsafe(`UPDATE "StockAlert" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "StockAlert"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'TimedSession')) {
          await prisma.$executeRawUnsafe(`UPDATE "TimedSession" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "TimedSession"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ComboComponent')) {
          await prisma.$executeRawUnsafe(`UPDATE "ComboComponent" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "ComboComponent"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ComboSlotItem')) {
          await prisma.$executeRawUnsafe(`UPDATE "ComboSlotItem" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "ComboSlotItem"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ItemBarcode')) {
          await prisma.$executeRawUnsafe(`UPDATE "ItemBarcode" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "ItemBarcode"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'BergPluMapping')) {
          await prisma.$executeRawUnsafe(`UPDATE "BergPluMapping" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "BergPluMapping"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'OrderSnapshotItem')) {
          await prisma.$executeRawUnsafe(`UPDATE "OrderSnapshotItem" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "OrderSnapshotItem"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'OrderItemSnapshot')) {
          await prisma.$executeRawUnsafe(`UPDATE "OrderItemSnapshot" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "OrderItemSnapshot"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ComboTemplate')) {
          await prisma.$executeRawUnsafe(`DELETE FROM "ComboTemplate" ct USING _mi_dedup d WHERE ct."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'MenuItemRecipe')) {
          // Delete dupe recipes that conflict with keeper recipes
          await prisma.$executeRawUnsafe(`
            DELETE FROM "MenuItemRecipe" r
            USING _mi_dedup d
            WHERE r."menuItemId" = d.dupe_id
          `)
        }
        if (await tableExists(prisma, 'PricingOptionGroup')) {
          await prisma.$executeRawUnsafe(`
            DELETE FROM "PricingOptionGroup" p
            USING _mi_dedup d
            WHERE p."menuItemId" = d.dupe_id
          `)
        }
        if (await tableExists(prisma, 'EntertainmentItem')) {
          await prisma.$executeRawUnsafe(`UPDATE "EntertainmentItem" SET "menuItemId" = d.keeper_id FROM _mi_dedup d WHERE "EntertainmentItem"."menuItemId" = d.dupe_id`)
        }

        // Delete duplicate MenuItems
        await prisma.$executeRawUnsafe(`DELETE FROM "MenuItem" WHERE id IN (SELECT dupe_id FROM _mi_dedup)`)

        console.log(`${PREFIX}   Duplicate MenuItems removed`)
      } finally {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _mi_dedup`)
      }
    } else {
      console.log(`${PREFIX}   No duplicate MenuItems found`)
    }

    // ── Step 2: Clean up soft-deleted rows that clash with active rows ───
    await prisma.$executeRawUnsafe(`
      DELETE FROM "MenuItem" d
      WHERE d."deletedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "MenuItem" a
          WHERE a."deletedAt" IS NULL
            AND a."categoryId" = d."categoryId"
            AND a."name" = d."name"
        )
    `)

    // ── Step 3: Add partial unique index ──────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX "MenuItem_categoryId_name_active_key"
      ON "MenuItem" ("categoryId", "name")
      WHERE "deletedAt" IS NULL
    `)
    console.log(`${PREFIX}   Done -- unique constraint MenuItem(categoryId, name) added`)

  } catch (err) {
    console.error(`${PREFIX}   FAILED:`, err.message)
  }
}

module.exports = { up }
