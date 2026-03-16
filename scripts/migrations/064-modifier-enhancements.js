/**
 * Migration 064 — Modifier Enhancements
 *
 * Adds columns to support open-entry modifiers, auto-advance modifier groups,
 * modifier swaps, inventory deduction tracking, and custom entry on order items.
 */
async function up(prisma) {
  async function columnExists(table, column) {
    const result = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = '${table}' AND column_name = '${column}'
    `)
    return result.length > 0
  }

  // --- ModifierGroup ---

  if (!(await columnExists('ModifierGroup', 'allowOpenEntry'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup" ADD COLUMN "allowOpenEntry" BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('[migration-064] Added allowOpenEntry to ModifierGroup')
  }

  if (!(await columnExists('ModifierGroup', 'autoAdvance'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ModifierGroup" ADD COLUMN "autoAdvance" BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('[migration-064] Added autoAdvance to ModifierGroup')
  }

  // --- Modifier ---

  if (!(await columnExists('Modifier', 'swapEnabled'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Modifier" ADD COLUMN "swapEnabled" BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('[migration-064] Added swapEnabled to Modifier')
  }

  if (!(await columnExists('Modifier', 'swapTargets'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Modifier" ADD COLUMN "swapTargets" JSONB
    `)
    console.log('[migration-064] Added swapTargets to Modifier')
  }

  if (!(await columnExists('Modifier', 'inventoryDeductionAmount'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Modifier" ADD COLUMN "inventoryDeductionAmount" DECIMAL(10,4)
    `)
    console.log('[migration-064] Added inventoryDeductionAmount to Modifier')
  }

  if (!(await columnExists('Modifier', 'inventoryDeductionUnit'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Modifier" ADD COLUMN "inventoryDeductionUnit" TEXT
    `)
    console.log('[migration-064] Added inventoryDeductionUnit to Modifier')
  }

  // --- OrderItemModifier ---

  if (!(await columnExists('OrderItemModifier', 'isCustomEntry'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "isCustomEntry" BOOLEAN NOT NULL DEFAULT false
    `)
    console.log('[migration-064] Added isCustomEntry to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'customEntryName'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "customEntryName" TEXT
    `)
    console.log('[migration-064] Added customEntryName to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'customEntryPrice'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "customEntryPrice" DECIMAL(10,2)
    `)
    console.log('[migration-064] Added customEntryPrice to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'swapTargetName'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "swapTargetName" TEXT
    `)
    console.log('[migration-064] Added swapTargetName to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'swapTargetItemId'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "swapTargetItemId" TEXT
    `)
    console.log('[migration-064] Added swapTargetItemId to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'swapPricingMode'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "swapPricingMode" TEXT
    `)
    console.log('[migration-064] Added swapPricingMode to OrderItemModifier')
  }

  if (!(await columnExists('OrderItemModifier', 'swapEffectivePrice'))) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "OrderItemModifier" ADD COLUMN "swapEffectivePrice" DECIMAL(10,2)
    `)
    console.log('[migration-064] Added swapEffectivePrice to OrderItemModifier')
  }
}

module.exports = { up }
