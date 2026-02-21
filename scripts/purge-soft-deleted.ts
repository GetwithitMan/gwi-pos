/**
 * purge-soft-deleted.ts
 * Hard-deletes ALL soft-deleted records across every table.
 * Order: children first, then parents, to respect foreign key constraints.
 *
 * Usage: dotenv -e .env.local -- tsx scripts/purge-soft-deleted.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type PurgeEntry = {
  label: string
  run: () => Promise<{ count: number }>
}

async function main() {
  console.log('=== Purging Soft-Deleted Records ===\n')

  const w = { where: { deletedAt: { not: null } } } as const

  const entries: PurgeEntry[] = [
    // Child / junction tables
    { label: 'MenuItemRecipeIngredient', run: () => prisma.menuItemRecipeIngredient.deleteMany(w) },
    { label: 'MenuItemRecipe', run: () => prisma.menuItemRecipe.deleteMany(w) },
    { label: 'MenuItemIngredient', run: () => prisma.menuItemIngredient.deleteMany(w) },
    { label: 'ModifierInventoryLink', run: () => prisma.modifierInventoryLink.deleteMany(w) },
    { label: 'OrderItemModifier', run: () => prisma.orderItemModifier.deleteMany(w) },
    { label: 'OrderItemIngredient', run: () => prisma.orderItemIngredient.deleteMany(w) },
    { label: 'OrderItemPizza', run: () => prisma.orderItemPizza.deleteMany(w) },
    { label: 'OrderDiscount', run: () => prisma.orderDiscount.deleteMany(w) },
    { label: 'OrderItem', run: () => prisma.orderItem.deleteMany(w) },
    { label: 'Payment', run: () => prisma.payment.deleteMany(w) },
    { label: 'IngredientStockAdjustment', run: () => prisma.ingredientStockAdjustment.deleteMany(w) },
    { label: 'IngredientRecipe', run: () => prisma.ingredientRecipe.deleteMany(w) },
    { label: 'PrepItemIngredient', run: () => prisma.prepItemIngredient.deleteMany(w) },
    { label: 'InventoryItemStorage', run: () => prisma.inventoryItemStorage.deleteMany(w) },
    { label: 'InventoryItemTransaction', run: () => prisma.inventoryItemTransaction.deleteMany(w) },
    { label: 'InventoryCountItem', run: () => prisma.inventoryCountItem.deleteMany(w) },
    { label: 'InventoryCount', run: () => prisma.inventoryCount.deleteMany(w) },
    { label: 'InventoryTransaction', run: () => prisma.inventoryTransaction.deleteMany(w) },
    { label: 'InvoiceLineItem', run: () => prisma.invoiceLineItem.deleteMany(w) },
    { label: 'DailyPrepCountItem', run: () => prisma.dailyPrepCountItem.deleteMany(w) },
    { label: 'DailyPrepCountTransaction', run: () => prisma.dailyPrepCountTransaction.deleteMany(w) },
    { label: 'DailyPrepCount', run: () => prisma.dailyPrepCount.deleteMany(w) },
    { label: 'HouseAccountTransaction', run: () => prisma.houseAccountTransaction.deleteMany(w) },
    { label: 'GiftCardTransaction', run: () => prisma.giftCardTransaction.deleteMany(w) },
    { label: 'CouponRedemption', run: () => prisma.couponRedemption.deleteMany(w) },
    { label: 'TipShare', run: () => prisma.tipShare.deleteMany(w) },
    { label: 'TipPoolEntry', run: () => prisma.tipPoolEntry.deleteMany(w) },
    { label: 'TipPool', run: () => prisma.tipPool.deleteMany(w) },
    { label: 'TipOutRule', run: () => prisma.tipOutRule.deleteMany(w) },
    { label: 'SpiritModifierGroup', run: () => prisma.spiritModifierGroup.deleteMany(w) },
    { label: 'RecipeIngredient', run: () => prisma.recipeIngredient.deleteMany(w) },
    { label: 'ComboComponentOption', run: () => prisma.comboComponentOption.deleteMany(w) },
    { label: 'ComboComponent', run: () => prisma.comboComponent.deleteMany(w) },
    { label: 'ComboTemplate', run: () => prisma.comboTemplate.deleteMany(w) },
    { label: 'KDSScreenStation', run: () => prisma.kDSScreenStation.deleteMany(w) },
    { label: 'PrintJob', run: () => prisma.printJob.deleteMany(w) },
    { label: 'PrintRule', run: () => prisma.printRule.deleteMany(w) },
    { label: 'SectionAssignment', run: () => prisma.sectionAssignment.deleteMany(w) },
    { label: 'EventPricingTier', run: () => prisma.eventPricingTier.deleteMany(w) },
    { label: 'EventTableConfig', run: () => prisma.eventTableConfig.deleteMany(w) },
    { label: 'Break', run: () => prisma.break.deleteMany(w) },
    { label: 'TimeClockEntry', run: () => prisma.timeClockEntry.deleteMany(w) },
    { label: 'ScheduledShift', run: () => prisma.scheduledShift.deleteMany(w) },
    { label: 'SyncAuditEntry', run: () => prisma.syncAuditEntry.deleteMany(w) },
    { label: 'UpsellEvent', run: () => prisma.upsellEvent.deleteMany(w) },
    { label: 'SpiritUpsellEvent', run: () => prisma.spiritUpsellEvent.deleteMany(w) },
    { label: 'VoidLog', run: () => prisma.voidLog.deleteMany(w) },
    { label: 'WasteLogEntry', run: () => prisma.wasteLogEntry.deleteMany(w) },
    { label: 'RemoteVoidApproval', run: () => prisma.remoteVoidApproval.deleteMany(w) },
    { label: 'StockAlert', run: () => prisma.stockAlert.deleteMany(w) },
    { label: 'PrepTrayConfig', run: () => prisma.prepTrayConfig.deleteMany(w) },
    { label: 'TimedSession', run: () => prisma.timedSession.deleteMany(w) },
    { label: 'EntertainmentWaitlist', run: () => prisma.entertainmentWaitlist.deleteMany(w) },
    // Mid-level — ingredients children first
    { label: 'Ingredient (children)', run: () => prisma.ingredient.deleteMany({ where: { deletedAt: { not: null }, parentIngredientId: { not: null } } }) },
    { label: 'Ingredient (parents)', run: () => prisma.ingredient.deleteMany(w) },
    { label: 'IngredientCategory', run: () => prisma.ingredientCategory.deleteMany(w) },
    { label: 'IngredientSwapGroup', run: () => prisma.ingredientSwapGroup.deleteMany(w) },
    { label: 'Modifier', run: () => prisma.modifier.deleteMany(w) },
    { label: 'ModifierGroup', run: () => prisma.modifierGroup.deleteMany(w) },
    { label: 'ModifierGroupTemplate', run: () => prisma.modifierGroupTemplate.deleteMany(w) },
    { label: 'MenuItem', run: () => prisma.menuItem.deleteMany(w) },
    { label: 'Category', run: () => prisma.category.deleteMany(w) },
    { label: 'Order', run: () => prisma.order.deleteMany(w) },
    { label: 'Shift', run: () => prisma.shift.deleteMany(w) },
    { label: 'Drawer', run: () => prisma.drawer.deleteMany(w) },
    { label: 'PaidInOut', run: () => prisma.paidInOut.deleteMany(w) },
    { label: 'Schedule', run: () => prisma.schedule.deleteMany(w) },
    { label: 'PayStub', run: () => prisma.payStub.deleteMany(w) },
    { label: 'PayrollPeriod', run: () => prisma.payrollPeriod.deleteMany(w) },
    { label: 'PayrollSettings', run: () => prisma.payrollSettings.deleteMany(w) },
    { label: 'InventorySettings', run: () => prisma.inventorySettings.deleteMany(w) },
    { label: 'Invoice', run: () => prisma.invoice.deleteMany(w) },
    { label: 'Vendor', run: () => prisma.vendor.deleteMany(w) },
    { label: 'StorageLocation', run: () => prisma.storageLocation.deleteMany(w) },
    { label: 'InventoryItem', run: () => prisma.inventoryItem.deleteMany(w) },
    { label: 'PrepItem', run: () => prisma.prepItem.deleteMany(w) },
    { label: 'PrepStation', run: () => prisma.prepStation.deleteMany(w) },
    { label: 'BottleProduct', run: () => prisma.bottleProduct.deleteMany(w) },
    { label: 'SpiritCategory', run: () => prisma.spiritCategory.deleteMany(w) },
    { label: 'Coupon', run: () => prisma.coupon.deleteMany(w) },
    { label: 'DiscountRule', run: () => prisma.discountRule.deleteMany(w) },
    { label: 'GiftCard', run: () => prisma.giftCard.deleteMany(w) },
    { label: 'HouseAccount', run: () => prisma.houseAccount.deleteMany(w) },
    { label: 'Customer', run: () => prisma.customer.deleteMany(w) },
    { label: 'Reservation', run: () => prisma.reservation.deleteMany(w) },
    { label: 'Event', run: () => prisma.event.deleteMany(w) },
    { label: 'UpsellConfig', run: () => prisma.upsellConfig.deleteMany(w) },
    // Infrastructure tables
    { label: 'FloorPlanElement', run: () => prisma.floorPlanElement.deleteMany(w) },
    { label: 'Seat', run: () => prisma.seat.deleteMany(w) },
    { label: 'Table', run: () => prisma.table.deleteMany(w) },
{ label: 'Section', run: () => prisma.section.deleteMany(w) },
    { label: 'Terminal', run: () => prisma.terminal.deleteMany(w) },
    { label: 'PaymentReader', run: () => prisma.paymentReader.deleteMany(w) },
    { label: 'Printer', run: () => prisma.printer.deleteMany(w) },
    { label: 'KDSScreen', run: () => prisma.kDSScreen.deleteMany(w) },
    { label: 'Station', run: () => prisma.station.deleteMany(w) },
    { label: 'OrderType', run: () => prisma.orderType.deleteMany(w) },
    { label: 'TaxRule', run: () => prisma.taxRule.deleteMany(w) },
    { label: 'CourseConfig', run: () => prisma.courseConfig.deleteMany(w) },
    { label: 'VoidReason', run: () => prisma.voidReason.deleteMany(w) },
    { label: 'AuditLog', run: () => prisma.auditLog.deleteMany(w) },
    { label: 'AvailabilityEntry', run: () => prisma.availabilityEntry.deleteMany(w) },
    { label: 'Ticket', run: () => prisma.ticket.deleteMany(w) },
    { label: 'PizzaTopping', run: () => prisma.pizzaTopping.deleteMany(w) },
    { label: 'PizzaCheese', run: () => prisma.pizzaCheese.deleteMany(w) },
    { label: 'PizzaSauce', run: () => prisma.pizzaSauce.deleteMany(w) },
    { label: 'PizzaCrust', run: () => prisma.pizzaCrust.deleteMany(w) },
    { label: 'PizzaSize', run: () => prisma.pizzaSize.deleteMany(w) },
    { label: 'PizzaSpecialty', run: () => prisma.pizzaSpecialty.deleteMany(w) },
    { label: 'PizzaConfig', run: () => prisma.pizzaConfig.deleteMany(w) },
    { label: 'Employee', run: () => prisma.employee.deleteMany(w) },
    { label: 'Role', run: () => prisma.role.deleteMany(w) },
  ]

  let totalDeleted = 0
  let tablesWithDeletions = 0
  let tablesWithErrors = 0

  for (const entry of entries) {
    try {
      const result = await entry.run()
      totalDeleted += result.count
      if (result.count > 0) {
        tablesWithDeletions++
        console.log('  + ' + entry.label + ': ' + result.count + ' deleted')
      }
    } catch (err: unknown) {
      tablesWithErrors++
      const message = err instanceof Error ? err.message : String(err)
      console.error('  X ' + entry.label + ': ERROR - ' + message)
    }
  }

  console.log('\n=== Summary ===')
  console.log('Tables processed: ' + entries.length)
  console.log('Tables with deletions: ' + tablesWithDeletions)
  console.log('Tables with errors: ' + tablesWithErrors)
  console.log('Total records purged: ' + totalDeleted)
}

main()
  .catch((e) => {
    console.error('Fatal error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
