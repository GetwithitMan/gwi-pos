/**
 * Migration 009: MenuItem deduplication
 *
 * After category dedup (008), items from duplicate categories got merged into one,
 * creating duplicate items (same name) within the same category.
 * Keep the item with the most OrderItem references (actively used).
 *
 * Guards against missing tables (OrderItem, MenuItemDailyMetrics, etc.)
 * to prevent failures on fresh or partial databases.
 */

const { tableExists } = require('../migration-helpers')

async function up(prisma) {
  const PREFIX = '[009-menuitem-dedup]'

  try {
    // Guard: required tables must exist
    const menuItemExists = await tableExists(prisma, 'MenuItem')
    const orderItemExists = await tableExists(prisma, 'OrderItem')
    if (!menuItemExists || !orderItemExists) {
      console.log(`${PREFIX}   Skipping MenuItem dedup -- required tables not found (MenuItem: ${menuItemExists}, OrderItem: ${orderItemExists})`)
      return
    }

    const hasDupeItems = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM "MenuItem" a
      JOIN "MenuItem" b
        ON a."categoryId" = b."categoryId"
        AND a."name" = b."name"
        AND a."id" < b."id"
        AND a."deletedAt" IS NULL
        AND b."deletedAt" IS NULL
      LIMIT 1
    `)
    if (hasDupeItems.length > 0) {
      console.log(`${PREFIX}   Deduplicating MenuItem rows by (categoryId, name)...`)

      // Build keeper/dupe mapping in a temp table
      await prisma.$executeRawUnsafe(`
        CREATE TEMP TABLE _mi_dupes AS
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
        // Reassign non-cascade FK references from dupe to keeper
        // These tables always exist at this point:
        await prisma.$executeRawUnsafe(`UPDATE "OrderItem" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "OrderItem"."menuItemId" = d.dupe_id`)
        if (await tableExists(prisma, 'InventoryTransaction')) {
          await prisma.$executeRawUnsafe(`UPDATE "InventoryTransaction" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "InventoryTransaction"."menuItemId" = d.dupe_id`)
        }
        // These tables may not exist in all venue DBs -- check first:
        if (await tableExists(prisma, 'StockAlert')) {
          await prisma.$executeRawUnsafe(`UPDATE "StockAlert" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "StockAlert"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'TimedSession')) {
          await prisma.$executeRawUnsafe(`UPDATE "TimedSession" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "TimedSession"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ComboComponent')) {
          await prisma.$executeRawUnsafe(`UPDATE "ComboComponent" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "ComboComponent"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ComboSlotItem')) {
          await prisma.$executeRawUnsafe(`UPDATE "ComboSlotItem" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "ComboSlotItem"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'ItemBarcode')) {
          await prisma.$executeRawUnsafe(`UPDATE "ItemBarcode" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "ItemBarcode"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'BergPluMapping')) {
          await prisma.$executeRawUnsafe(`UPDATE "BergPluMapping" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "BergPluMapping"."menuItemId" = d.dupe_id`)
        }
        if (await tableExists(prisma, 'OrderSnapshotItem')) {
          await prisma.$executeRawUnsafe(`UPDATE "OrderSnapshotItem" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "OrderSnapshotItem"."menuItemId" = d.dupe_id`)
        }
        // ComboTemplate has unique(menuItemId) -- delete dupe's template
        if (await tableExists(prisma, 'ComboTemplate')) {
          await prisma.$executeRawUnsafe(`DELETE FROM "ComboTemplate" ct USING _mi_dupes d WHERE ct."menuItemId" = d.dupe_id`)
        }
        // MenuItemDailyMetrics has unique(locationId, menuItemId, businessDate) -- delete conflicts first
        if (await tableExists(prisma, 'MenuItemDailyMetrics')) {
          await prisma.$executeRawUnsafe(`
            DELETE FROM "MenuItemDailyMetrics" mdm
            USING _mi_dupes d
            WHERE mdm."menuItemId" = d.dupe_id
              AND EXISTS (
                SELECT 1 FROM "MenuItemDailyMetrics" k
                WHERE k."menuItemId" = d.keeper_id
                  AND k."locationId" = mdm."locationId"
                  AND k."businessDate" = mdm."businessDate"
              )
          `)
          await prisma.$executeRawUnsafe(`UPDATE "MenuItemDailyMetrics" SET "menuItemId" = d.keeper_id FROM _mi_dupes d WHERE "MenuItemDailyMetrics"."menuItemId" = d.dupe_id`)
        }

        // Delete duplicate MenuItems (cascade handles ModifierGroup, Recipe, PricingOptionGroup, etc.)
        await prisma.$executeRawUnsafe(`DELETE FROM "MenuItem" WHERE id IN (SELECT dupe_id FROM _mi_dupes)`)

        console.log(`${PREFIX}   Done -- MenuItem duplicates removed`)
      } finally {
        await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS _mi_dupes`)
      }
    }
  } catch (err) {
    console.error(`${PREFIX}   FAILED MenuItem dedup:`, err.message)
  }
}

module.exports = { up }
