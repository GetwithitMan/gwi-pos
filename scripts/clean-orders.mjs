#!/usr/bin/env node
/**
 * clean-orders.mjs
 *
 * Deletes all transactional/order data from the database while preserving:
 * - Menu items, categories, modifier groups, modifiers
 * - Ingredients, inventory items, recipes, inventory settings
 * - Employees, roles, customers
 * - Tables, sections, seats, floor plan elements
 * - Hardware (printers, KDS screens, terminals, payment readers, scales)
 * - Order types, tax rules, discount rules, coupons
 * - Location & organization config
 * - Pizza config, spirit categories, bottle products
 * - Scheduling templates, payroll settings
 * - Combo templates
 *
 * Usage:
 *   node scripts/clean-orders.mjs            # Dry run (shows what would be deleted)
 *   node scripts/clean-orders.mjs --confirm  # Actually deletes data
 */

// NOTE: Must run via `npx tsx` (not bare `node`) — Prisma 7 generated client is TypeScript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const isDryRun = !process.argv.includes('--confirm')

async function main() {
  console.log('='.repeat(60))
  console.log(isDryRun
    ? '🔍 DRY RUN — No data will be deleted'
    : '⚠️  LIVE RUN — Data WILL be permanently deleted')
  console.log('='.repeat(60))
  console.log()

  // Get all locations
  const locations = await prisma.location.findMany({
    select: { id: true, name: true, slug: true }
  })
  console.log(`Found ${locations.length} location(s):`)
  locations.forEach(l => console.log(`  • ${l.name} (${l.slug || l.id})`))
  console.log()

  // ========================================================================
  // DELETION ORDER: Children first, parents last (FK-safe)
  // ========================================================================
  // Tier 1: Deepest children (no dependents)
  // Tier 2: Mid-level (depend on Tier 3+)
  // Tier 3: Parents (Order, Shift, etc.)
  // ========================================================================

  const deletionSteps = [
    // ── Tier 1: Leaf-level records (deepest FK children) ──
    { model: 'orderItemIngredient', label: 'OrderItemIngredient (ingredient deductions per item)' },
    { model: 'orderItemPizza', label: 'OrderItemPizza (pizza configurations)' },
    { model: 'orderItemModifier', label: 'OrderItemModifier (modifiers on order items)' },
    { model: 'orderItemDiscount', label: 'OrderItemDiscount (item-level discounts)' },
    { model: 'remoteVoidApproval', label: 'RemoteVoidApproval (remote void approvals)' },
    { model: 'paymentReaderLog', label: 'PaymentReaderLog (payment reader activity)' },
    { model: 'refundLog', label: 'RefundLog (refund records)' },
    { model: 'chargebackCase', label: 'ChargebackCase (chargeback disputes)' },
    { model: 'cardProfile', label: 'CardProfile (card fingerprints)' },
    { model: 'walkoutRetry', label: 'WalkoutRetry (walkout recovery attempts)' },
    { model: 'digitalReceipt', label: 'DigitalReceipt (digital receipt records)' },
    { model: 'spiritUpsellEvent', label: 'SpiritUpsellEvent (spirit upsell tracking)' },
    { model: 'upsellEvent', label: 'UpsellEvent (upsell tracking)' },
    { model: 'orderOwnershipEntry', label: 'OrderOwnershipEntry (shared ownership entries)' },
    { model: 'tipLedgerEntry', label: 'TipLedgerEntry (tip ledger line items)' },
    { model: 'tipTransaction', label: 'TipTransaction (tip transactions)' },
    { model: 'tipDebt', label: 'TipDebt (tip debt records)' },
    { model: 'tipGroupMembership', label: 'TipGroupMembership (tip group members)' },
    { model: 'tipGroupSegment', label: 'TipGroupSegment (tip group segments)' },
    { model: 'tipAdjustment', label: 'TipAdjustment (tip adjustments)' },
    { model: 'cashTipDeclaration', label: 'CashTipDeclaration (cash tip declarations)' },
    { model: 'giftCardTransaction', label: 'GiftCardTransaction (gift card transactions)' },
    { model: 'houseAccountTransaction', label: 'HouseAccountTransaction (house account transactions)' },
    { model: 'couponRedemption', label: 'CouponRedemption (coupon redemptions)' },
    { model: 'inventoryTransaction', label: 'InventoryTransaction (inventory sale/waste deductions)' },
    { model: 'inventoryItemTransaction', label: 'InventoryItemTransaction (inventory item movements)' },
    { model: 'inventoryCountItem', label: 'InventoryCountItem (inventory count line items)' },
    { model: 'ingredientStockAdjustment', label: 'IngredientStockAdjustment (ingredient stock adjustments)' },
    { model: 'wasteLogEntry', label: 'WasteLogEntry (waste log entries)' },
    { model: 'invoiceLineItem', label: 'InvoiceLineItem (invoice line items)' },
    { model: 'dailyPrepCountTransaction', label: 'DailyPrepCountTransaction (prep count transactions)' },
    { model: 'dailyPrepCountItem', label: 'DailyPrepCountItem (prep count items)' },
    { model: 'shiftSwapRequest', label: 'ShiftSwapRequest (shift swap requests)' },
    { model: 'payStub', label: 'PayStub (pay stubs)' },
    { model: 'scheduledShift', label: 'ScheduledShift (scheduled shifts)' },
    { model: 'performanceLog', label: 'PerformanceLog (performance logs)' },
    { model: 'healthCheck', label: 'HealthCheck (health check records)' },
    { model: 'syncAuditEntry', label: 'SyncAuditEntry (sync audit trail)' },
    { model: 'cloudEventQueue', label: 'CloudEventQueue (cloud event queue)' },
    { model: 'hardwareCommand', label: 'HardwareCommand (hardware commands)' },
    { model: 'mobileSession', label: 'MobileSession (mobile sessions)' },

    // ── Tier 2: Mid-level (reference orders/items/shifts) ──
    { model: 'voidLog', label: 'VoidLog (void records)' },
    { model: 'orderCard', label: 'OrderCard (order card associations)' },
    { model: 'printJob', label: 'PrintJob (print job records)' },
    { model: 'errorLog', label: 'ErrorLog (error logs)' },
    { model: 'ticket', label: 'Ticket (event tickets)' },
    { model: 'timedSession', label: 'TimedSession (timed rental sessions)' },
    { model: 'entertainmentWaitlist', label: 'EntertainmentWaitlist (entertainment waitlist)' },
    { model: 'orderDiscount', label: 'OrderDiscount (order-level discounts)' },
    { model: 'orderOwnership', label: 'OrderOwnership (shared order ownership)' },
    { model: 'tipShare', label: 'TipShare (tip shares from shifts)' },
    { model: 'tipGroup', label: 'TipGroup (tip groups)' },
    { model: 'tipPool', label: 'TipPool (tip pools)' },
    { model: 'tipLedger', label: 'TipLedger (tip ledgers)' },
    { model: 'paidInOut', label: 'PaidInOut (paid in/out records)' },
    { model: 'inventoryCount', label: 'InventoryCount (inventory counts)' },
    { model: 'invoice', label: 'Invoice (invoices)' },
    { model: 'dailyPrepCount', label: 'DailyPrepCount (daily prep counts)' },
    { model: 'payrollPeriod', label: 'PayrollPeriod (payroll periods)' },
    { model: 'schedule', label: 'Schedule (schedules)' },
    { model: 'stockAlert', label: 'StockAlert (stock alerts)' },
    { model: 'auditLog', label: 'AuditLog (audit logs)' },

    // ── Tier 3: Order items (reference orders) ──
    { model: 'orderItem', label: 'OrderItem (line items on orders)' },

    // ── Tier 4: Payments (reference orders + shifts + drawers) ──
    { model: 'payment', label: 'Payment (payment records)' },

    // ── Tier 5: Orders (top-level parent, self-referencing splits) ──
    // Must clear parentOrderId first to break self-reference
    { model: 'order', label: 'Order (all orders)', preClear: true },

    // ── Tier 6: Shifts & Time Clock ──
    { model: 'shift', label: 'Shift (shift records)' },
    { model: 'timeClockEntry', label: 'TimeClockEntry (time clock entries)' },

    // ── Tier 7: Misc operational data ──
    { model: 'break', label: 'Break (break records)' },
  ]

  // ── Count phase ──
  console.log('📊 Counting records to delete...\n')
  let totalCount = 0

  for (const step of deletionSteps) {
    try {
      const count = await prisma[step.model].count()
      if (count > 0) {
        console.log(`  ${count.toString().padStart(8)} × ${step.label}`)
        totalCount += count
      }
    } catch (err) {
      console.log(`  ⚠️  Could not count ${step.label}: ${err.message}`)
    }
  }

  console.log()
  console.log(`  Total: ${totalCount} records to delete`)
  console.log()

  if (totalCount === 0) {
    console.log('✅ Database is already clean — nothing to delete.')
    return
  }

  if (isDryRun) {
    console.log('─'.repeat(60))
    console.log('This was a dry run. To actually delete, run:')
    console.log('  node scripts/clean-orders.mjs --confirm')
    console.log('─'.repeat(60))
    return
  }

  // ── Pre-cleanup: Clear FK references BEFORE deleting ──
  console.log('🔗 Clearing FK references that point to orders...\n')

  // Clear Seat.currentOrderItemId (points to OrderItem)
  try {
    const seatsCleared = await prisma.seat.updateMany({
      where: { currentOrderItemId: { not: null } },
      data: { currentOrderItemId: null }
    })
    if (seatsCleared.count > 0) console.log(`  ✅ Cleared ${seatsCleared.count} seat currentOrderItemId refs`)
  } catch { /* field may not exist */ }

  // Delete temp seats (created by POS, reference sourceOrderId)
  try {
    const tempSeatsDeleted = await prisma.seat.deleteMany({
      where: { isTemporary: true }
    })
    if (tempSeatsDeleted.count > 0) console.log(`  ✅ Deleted ${tempSeatsDeleted.count} temporary seats`)
  } catch { /* no temp seats */ }

  // Clear MenuItem.currentOrderId + currentOrderItemId
  try {
    const menuItemsCleared = await prisma.menuItem.updateMany({
      where: { currentOrderId: { not: null } },
      data: { currentOrderId: null, currentOrderItemId: null }
    })
    if (menuItemsCleared.count > 0) console.log(`  ✅ Cleared ${menuItemsCleared.count} menuItem order refs`)
  } catch { /* field may not exist */ }

  // Clear FloorPlanElement.currentOrderId
  try {
    const fpCleared = await prisma.floorPlanElement.updateMany({
      where: { currentOrderId: { not: null } },
      data: { currentOrderId: null }
    })
    if (fpCleared.count > 0) console.log(`  ✅ Cleared ${fpCleared.count} floorPlanElement order refs`)
  } catch { /* field may not exist */ }

  // Clear Reservation.orderId (reservations are config, but may point to orders)
  try {
    const resCleared = await prisma.reservation.updateMany({
      where: { orderId: { not: null } },
      data: { orderId: null }
    })
    if (resCleared.count > 0) console.log(`  ✅ Cleared ${resCleared.count} reservation order refs`)
  } catch { /* field may not exist */ }

  console.log()

  // ── Deletion phase ──
  console.log('🗑️  Deleting transactional data...\n')

  for (const step of deletionSteps) {
    try {
      if (step.preClear) {
        // Delete split children first (they reference parent via parentOrderId)
        const splitCount = await prisma.order.deleteMany({
          where: { parentOrderId: { not: null } }
        })
        if (splitCount.count > 0) {
          console.log(`  ✅ Deleted ${splitCount.count.toString().padStart(6)} × split/child orders`)
        }
        // Now delete remaining (parent) orders
        const parentCount = await prisma.order.deleteMany({})
        if (parentCount.count > 0) {
          console.log(`  ✅ Deleted ${parentCount.count.toString().padStart(6)} × parent/root orders`)
        }
        continue // skip the generic deleteMany below
      }

      const result = await prisma[step.model].deleteMany({})
      if (result.count > 0) {
        console.log(`  ✅ Deleted ${result.count.toString().padStart(6)} × ${step.label}`)
      }
    } catch (err) {
      console.error(`  ❌ Failed: ${step.label} — ${err.message}`)
    }
  }

  // ── Post-cleanup: Reset table statuses ──
  console.log('\n🔄 Resetting table statuses to "available"...')
  const tablesReset = await prisma.table.updateMany({
    where: { status: { not: 'available' } },
    data: { status: 'available' }
  })
  console.log(`  ✅ Reset ${tablesReset.count} tables to 'available'`)

  // ── Post-cleanup: Reset seat statuses ──
  console.log('\n🔄 Resetting seat statuses to "available"...')
  const seatsReset = await prisma.seat.updateMany({
    where: { status: { not: 'available' } },
    data: { status: 'available', lastOccupiedAt: null, lastOccupiedBy: null }
  })
  console.log(`  ✅ Reset ${seatsReset.count} seats to 'available'`)

  // ── Post-cleanup: Reset gift card balances to original ──
  // (Gift cards are config, but transactions were deleted — reset balance to loaded amount)
  console.log('\n🔄 Resetting gift card balances...')
  try {
    const giftCards = await prisma.giftCard.findMany({
      select: { id: true, initialBalance: true }
    })
    for (const gc of giftCards) {
      await prisma.giftCard.update({
        where: { id: gc.id },
        data: { currentBalance: gc.initialBalance, isActive: true }
      })
    }
    console.log(`  ✅ Reset ${giftCards.length} gift card balances`)
  } catch {
    console.log('  ⏭️  No gift cards to reset')
  }

  console.log()
  console.log('='.repeat(60))
  console.log('✅ Done! All transactional data has been deleted.')
  console.log('   Menu items, ingredients, inventory config, employees,')
  console.log('   tables, and all configuration data are preserved.')
  console.log('='.repeat(60))
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
