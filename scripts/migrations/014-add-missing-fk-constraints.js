/**
 * Migration 014: Add missing FK constraints
 *
 * Schema audit found that 13 tables created in migration 006 (and later)
 * lack the FOREIGN KEY constraints that Prisma declares. This migration
 * adds them retroactively.
 *
 * Each ALTER TABLE is wrapped in try/catch so that:
 *   - If the constraint already exists, the error is caught and logged.
 *   - If the referenced row is missing (orphan data), we log and skip.
 *
 * ON DELETE behavior matches prisma/schema.prisma:
 *   - Most locationId FKs: RESTRICT (Prisma default when no onDelete specified)
 *   - VendorOrderLineItem.vendorOrderId: CASCADE (explicit in schema)
 *   - InventoryCountEntry.inventoryCountId: CASCADE (explicit in schema)
 *   - Optional (nullable) FKs like WasteLog.inventoryItemId: SET NULL
 */

async function up(prisma) {
  const PREFIX = '[014-add-missing-fk-constraints]'

  // Each entry: [table, constraintName, column, refTable, refColumn, onDelete]
  const constraints = [
    // CfdSettings
    ['CfdSettings', 'CfdSettings_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],

    // QuickBarPreference
    ['QuickBarPreference', 'QuickBarPreference_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['QuickBarPreference', 'QuickBarPreference_employeeId_fkey', 'employeeId', 'Employee', 'id', 'RESTRICT'],

    // IngredientCostHistory
    ['IngredientCostHistory', 'IngredientCostHistory_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['IngredientCostHistory', 'IngredientCostHistory_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'RESTRICT'],

    // VendorOrder
    ['VendorOrder', 'VendorOrder_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['VendorOrder', 'VendorOrder_vendorId_fkey', 'vendorId', 'Vendor', 'id', 'RESTRICT'],

    // VendorOrderLineItem
    ['VendorOrderLineItem', 'VendorOrderLineItem_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['VendorOrderLineItem', 'VendorOrderLineItem_vendorOrderId_fkey', 'vendorOrderId', 'VendorOrder', 'id', 'CASCADE'],
    ['VendorOrderLineItem', 'VendorOrderLineItem_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'RESTRICT'],

    // InventoryCountEntry
    ['InventoryCountEntry', 'InventoryCountEntry_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['InventoryCountEntry', 'InventoryCountEntry_inventoryCountId_fkey', 'inventoryCountId', 'InventoryCount', 'id', 'CASCADE'],
    ['InventoryCountEntry', 'InventoryCountEntry_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'RESTRICT'],

    // WasteLog
    ['WasteLog', 'WasteLog_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['WasteLog', 'WasteLog_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'SET NULL'],

    // MarginEdgeProductMapping
    ['MarginEdgeProductMapping', 'MarginEdgeProductMapping_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['MarginEdgeProductMapping', 'MarginEdgeProductMapping_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'RESTRICT'],

    // MenuItemDailyMetrics
    ['MenuItemDailyMetrics', 'MenuItemDailyMetrics_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['MenuItemDailyMetrics', 'MenuItemDailyMetrics_menuItemId_fkey', 'menuItemId', 'MenuItem', 'id', 'RESTRICT'],

    // PendingDeduction
    ['PendingDeduction', 'PendingDeduction_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],

    // CompReason
    ['CompReason', 'CompReason_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],

    // ReasonAccess
    ['ReasonAccess', 'ReasonAccess_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],

    // ItemBarcode
    ['ItemBarcode', 'ItemBarcode_locationId_fkey', 'locationId', 'Location', 'id', 'RESTRICT'],
    ['ItemBarcode', 'ItemBarcode_menuItemId_fkey', 'menuItemId', 'MenuItem', 'id', 'SET NULL'],
    ['ItemBarcode', 'ItemBarcode_inventoryItemId_fkey', 'inventoryItemId', 'InventoryItem', 'id', 'SET NULL'],
  ]

  let added = 0
  let skipped = 0

  for (const [table, constraintName, column, refTable, refColumn, onDelete] of constraints) {
    try {
      // Check if constraint already exists
      const existing = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = $1 AND table_name = $2 AND constraint_type = 'FOREIGN KEY'
         LIMIT 1`,
        constraintName,
        table
      )

      if (existing.length > 0) {
        skipped++
        continue
      }

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}"
         ADD CONSTRAINT "${constraintName}"
         FOREIGN KEY ("${column}") REFERENCES "${refTable}"("${refColumn}")
         ON DELETE ${onDelete} ON UPDATE CASCADE`
      )
      added++
      console.log(`${PREFIX}   Added ${constraintName}`)
    } catch (err) {
      // Constraint already exists or orphan data prevents creation
      if (err.message.includes('already exists')) {
        skipped++
        console.log(`${PREFIX}   ${constraintName} already exists — skipping`)
      } else {
        console.error(`${PREFIX}   FAILED ${constraintName}: ${err.message}`)
        // Don't throw — continue adding other constraints
        // Orphan data or missing table should not block the rest
      }
    }
  }

  console.log(`${PREFIX}   Done — ${added} FK(s) added, ${skipped} already existed`)
}

module.exports = { up }
