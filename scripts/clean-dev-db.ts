/**
 * clean-dev-db.ts
 *
 * Wipes all transactional data from the local dev database while preserving:
 *   - Menu (Category, MenuItem, ModifierGroup, Modifier, PricingOptionGroup, PricingOption,
 *     PricingOptionInventoryLink, ComboTemplate, ComboComponent, ComboComponentOption,
 *     CourseConfig, OrderType, KDSScreen, KDSScreenStation, Station, PrepStation)
 *   - Ingredients & recipes (IngredientCategory, Ingredient, IngredientSwapGroup,
 *     IngredientRecipe, MenuItemIngredient, MenuItemRecipe, MenuItemRecipeIngredient,
 *     RecipeIngredient, ModifierGroupTemplate, ModifierTemplate, ModifierInventoryLink)
 *   - Inventory reference (InventoryItem, InventoryItemStorage, PrepItem, PrepItemIngredient,
 *     StorageLocation, StockAlert, Vendor)
 *   - Liquor catalog (SpiritCategory, SpiritModifierGroup, BottleProduct, BottleServiceTier)
 *   - Pizza config (PizzaConfig, PizzaSize, PizzaCrust, PizzaSauce, PizzaCheese, PizzaTopping, PizzaSpecialty)
 *   - Location config (Organization, Location, Employee, EmployeeRole, Role, Section, Table, Seat,
 *     FloorPlanElement, TaxRule, DiscountRule, VoidReason, Terminal, PaymentReader,
 *     Printer, PrintRoute, PrintRule, InventorySettings, Scale,
 *     CfdSettings, RegisteredDevice, PayrollSettings)
 *
 * WIPED (all transactional / session / event data):
 *   Orders, Payments, Tips, Shifts, Events, Sessions, Audit logs,
 *   Inventory transactions, Gift cards, House accounts, Drawers, etc.
 *
 * Usage:
 *   npx tsx scripts/clean-dev-db.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 GWI Dev DB Clean — wiping transactional data...\n')

  // ──────────────────────────────────────────────────────────────────────────
  // WIPE ORDER: leaf tables first, then parents (respect FK constraints)
  // ──────────────────────────────────────────────────────────────────────────

  // --- Tip system ---
  console.log('  Wiping tip tables...')
  await prisma.tipPool.deleteMany({})
  await prisma.tipGroupMembership.deleteMany({})
  await prisma.tipGroupSegment.deleteMany({})
  await prisma.tipGroup.deleteMany({})
  await prisma.tipGroupTemplate.deleteMany({})
  await prisma.tipLedgerEntry.deleteMany({})
  await prisma.tipLedger.deleteMany({})
  await prisma.tipShare.deleteMany({})
  await prisma.tipAdjustment.deleteMany({})
  await prisma.tipDebt.deleteMany({})
  await prisma.tipOutRule.deleteMany({})
  await prisma.tipTransaction.deleteMany({})
  await prisma.cashTipDeclaration.deleteMany({})

  // --- Payment & cards ---
  console.log('  Wiping payment tables...')
  await prisma.refundLog.deleteMany({})
  await prisma.voidLog.deleteMany({})
  await prisma.remoteVoidApproval.deleteMany({})
  await prisma.chargebackCase.deleteMany({})
  await prisma.walkoutRetry.deleteMany({})
  await prisma.paymentReaderLog.deleteMany({})
  await prisma.orderCard.deleteMany({})
  await prisma.payment.deleteMany({})
  await prisma.cardProfile.deleteMany({})

  // --- Gift cards ---
  console.log('  Wiping gift card tables...')
  await prisma.giftCardTransaction.deleteMany({})
  await prisma.giftCard.deleteMany({})

  // --- House accounts ---
  console.log('  Wiping house account tables...')
  await prisma.houseAccountTransaction.deleteMany({})
  await prisma.houseAccount.deleteMany({})

  // --- Invoices ---
  console.log('  Wiping invoice tables...')
  await prisma.invoiceLineItem.deleteMany({})
  await prisma.invoice.deleteMany({})

  // --- Coupon redemptions ---
  console.log('  Wiping coupon redemptions...')
  await prisma.couponRedemption.deleteMany({})

  // --- Order snapshots & events (before orders) ---
  console.log('  Wiping order event/snapshot tables...')
  await prisma.orderItemSnapshot.deleteMany({})
  await prisma.orderSnapshot.deleteMany({})
  await prisma.orderEvent.deleteMany({})

  // --- Order items (leaf) ---
  console.log('  Wiping order item tables...')
  await prisma.orderItemIngredient.deleteMany({})
  await prisma.orderItemModifier.deleteMany({})
  await prisma.orderItemDiscount.deleteMany({})
  await prisma.orderItemPizza.deleteMany({})
  await prisma.orderItemSnapshot.deleteMany({})  // already done above — safe to repeat
  await prisma.orderItem.deleteMany({})

  // --- Order-level records ---
  console.log('  Wiping order tables...')
  await prisma.orderDiscount.deleteMany({})
  await prisma.orderOwnershipEntry.deleteMany({})
  await prisma.orderOwnership.deleteMany({})
  await prisma.sectionAssignment.deleteMany({})
  await prisma.digitalReceipt.deleteMany({})
  await prisma.order.deleteMany({})

  // --- Tickets / KDS history (not KDSScreen config, which is KEEP) ---
  console.log('  Wiping ticket history...')
  await prisma.ticket.deleteMany({})

  // --- Shifts, time clock, payroll ---
  console.log('  Wiping shift / time clock tables...')
  await prisma.payStub.deleteMany({})
  await prisma.payrollPeriod.deleteMany({})
  await prisma.break.deleteMany({})
  await prisma.timeClockEntry.deleteMany({})
  await prisma.shiftSwapRequest.deleteMany({})
  await prisma.shift.deleteMany({})

  // --- Scheduling ---
  console.log('  Wiping scheduling tables...')
  await prisma.scheduledShift.deleteMany({})
  await prisma.schedule.deleteMany({})

  // --- Sessions & auth ---
  console.log('  Wiping session tables...')
  await prisma.mobileSession.deleteMany({})
  await prisma.serverRegistrationToken.deleteMany({})

  // --- Inventory transactions (keep InventoryItem, InventoryItemStorage) ---
  console.log('  Wiping inventory transactions...')
  await prisma.inventoryCountItem.deleteMany({})
  await prisma.inventoryCount.deleteMany({})
  await prisma.inventoryItemTransaction.deleteMany({})
  await prisma.inventoryTransaction.deleteMany({})
  await prisma.ingredientStockAdjustment.deleteMany({})
  await prisma.dailyPrepCountItem.deleteMany({})
  await prisma.dailyPrepCountTransaction.deleteMany({})
  await prisma.dailyPrepCount.deleteMany({})
  await prisma.wasteLogEntry.deleteMany({})
  await prisma.prepTrayConfig.deleteMany({})

  // --- Cash drawers ---
  console.log('  Wiping drawer tables...')
  await prisma.paidInOut.deleteMany({})
  await prisma.drawer.deleteMany({})

  // --- Hardware & print jobs ---
  console.log('  Wiping hardware / print job tables...')
  await prisma.printJob.deleteMany({})
  await prisma.hardwareCommand.deleteMany({})
  await prisma.healthCheck.deleteMany({})

  // --- Sync & audit ---
  console.log('  Wiping sync / audit / error tables...')
  await prisma.cloudEventQueue.deleteMany({})
  await prisma.syncAuditEntry.deleteMany({})
  await prisma.auditLog.deleteMany({})
  await prisma.errorLog.deleteMany({})

  // --- Events / tickets / entertainment ---
  console.log('  Wiping events & entertainment tables...')
  await prisma.eventTableConfig.deleteMany({})
  await prisma.eventPricingTier.deleteMany({})
  await prisma.event.deleteMany({})
  await prisma.timedSession.deleteMany({})
  await prisma.entertainmentWaitlist.deleteMany({})

  // --- Spirit upsell events ---
  console.log('  Wiping spirit upsell event tables...')
  await prisma.spiritUpsellEvent.deleteMany({})

  // --- Reservations ---
  console.log('  Wiping reservations...')
  await prisma.reservation.deleteMany({})

  // --- Customers ---
  console.log('  Wiping customers...')
  await prisma.customer.deleteMany({})

  // ──────────────────────────────────────────────────────────────────────────
  // RESET SEQUENCES (PostgreSQL)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n  Resetting sequences...')
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      DECLARE
        seq RECORD;
      BEGIN
        FOR seq IN
          SELECT sequence_name
          FROM information_schema.sequences
          WHERE sequence_schema = 'public'
        LOOP
          EXECUTE 'ALTER SEQUENCE public.' || quote_ident(seq.sequence_name) || ' RESTART WITH 1';
        END LOOP;
      END $$;
    `)
    console.log('  Sequences reset.')
  } catch (e) {
    console.warn('  (No integer sequences found — using cuid/uuid IDs, skipping.)')
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n✅ Transactional data wiped. Menu, ingredients, and config preserved.')
  console.log('\nWhat was KEPT:')
  console.log('  • Organization, Location')
  console.log('  • Category, MenuItem, ModifierGroup, Modifier')
  console.log('  • PricingOptionGroup, PricingOption, CourseConfig, OrderType')
  console.log('  • ComboTemplate, ComboComponent, ComboComponentOption')
  console.log('  • IngredientCategory, Ingredient, IngredientSwapGroup')
  console.log('  • IngredientRecipe, MenuItemIngredient, MenuItemRecipe')
  console.log('  • InventoryItem, InventoryItemStorage, PrepItem, PrepItemIngredient')
  console.log('  • StorageLocation, StockAlert, Vendor')
  console.log('  • SpiritCategory, SpiritModifierGroup, BottleProduct, BottleServiceTier')
  console.log('  • PizzaConfig + all pizza sub-tables')
  console.log('  • Employee, EmployeeRole, Role')
  console.log('  • Section, Table, Seat, FloorPlanElement')
  console.log('  • TaxRule, DiscountRule, VoidReason')
  console.log('  • Terminal, PaymentReader, Printer, PrintRoute, PrintRule')
  console.log('  • InventorySettings, Scale, CfdSettings')
  console.log('  • Coupon (definitions only — redemptions wiped)')
  console.log('  • KDSScreen, KDSScreenStation, PrepStation, Station')
  console.log('\nWhat was WIPED:')
  console.log('  • All Orders, OrderItems, OrderEvents, OrderSnapshots')
  console.log('  • All Payments, Tips, Voids, Refunds, Chargebacks')
  console.log('  • All Shifts, TimeClockEntries, Payroll, Schedules')
  console.log('  • All Sessions, Audit logs, Error logs, Sync queues')
  console.log('  • All Drawers, Gift Cards, House Accounts, Invoices')
  console.log('  • All Inventory transactions and counts')
  console.log('  • All Events, Reservations, Customers')
  console.log('\nRun `npm run dev` — system is clean and ready for testing.')
}

main()
  .catch((e) => {
    console.error('\n❌ Error during clean:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
