import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/internal/migrate-location-id
 *
 * Transactional FK migration endpoint for Phase 2 ID unification.
 * Updates locationId across ALL tables that reference it, plus the
 * Location.id itself, in a single atomic transaction.
 *
 * Protected by INTERNAL_API_KEY — only callable from NUC localhost
 * or provisioning tooling.
 */
export async function POST(request: NextRequest) {
  // Auth: require internal API key (consistent with other internal endpoints)
  const apiKey = request.headers.get('x-internal-api-key')
  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { oldLocationId, newLocationId } = await request.json()
  if (!oldLocationId || !newLocationId) {
    return NextResponse.json({ error: 'oldLocationId and newLocationId required' }, { status: 400 })
  }
  if (oldLocationId === newLocationId) {
    return NextResponse.json({ message: 'IDs already match, no migration needed' })
  }

  // Verify old location exists
  const oldLocation = await db.location.findUnique({ where: { id: oldLocationId } })
  if (!oldLocation) {
    return NextResponse.json({ error: `Location ${oldLocationId} not found` }, { status: 404 })
  }

  // Auto-generated from prisma/schema.prisma — 171 models with locationId FK
  // Excludes: Location (updated separately as PK change at the end)
  const tables = [
    'AuditLog',
    'BergDevice',
    'BergDispenseEvent',
    'BergPluMapping',
    'BottleProduct',
    'BottleServiceTier',
    'Break',
    'BridgeCheckpoint',
    'CardProfile',
    'CashTipDeclaration',
    'Category',
    'CfdSettings',
    'ChargebackCase',
    'CloudEventQueue',
    'ComboComponent',
    'ComboComponentOption',
    'ComboTemplate',
    'CompReason',
    'Coupon',
    'CouponRedemption',
    'CourseConfig',
    'Customer',
    'DailyPrepCount',
    'DailyPrepCountItem',
    'DailyPrepCountTransaction',
    'DigitalReceipt',
    'DiscountRule',
    'Drawer',
    'Employee',
    'EmployeeRole',
    'EntertainmentWaitlist',
    'ErrorLog',
    'Event',
    'EventPricingTier',
    'EventTableConfig',
    'FloorPlanElement',
    'FulfillmentEvent',
    'GiftCard',
    'GiftCardTransaction',
    'HardwareCommand',
    'HealthCheck',
    'HouseAccount',
    'HouseAccountTransaction',
    'Ingredient',
    'IngredientCategory',
    'IngredientCostHistory',
    'IngredientRecipe',
    'IngredientStockAdjustment',
    'IngredientSwapGroup',
    'InventoryCount',
    'InventoryCountEntry',
    'InventoryCountItem',
    'InventoryItem',
    'InventoryItemStorage',
    'InventoryItemTransaction',
    'InventorySettings',
    'InventoryTransaction',
    'Invoice',
    'InvoiceLineItem',
    'ItemBarcode',
    'KDSScreen',
    'KDSScreenStation',
    'MarginEdgeProductMapping',
    'MenuItem',
    'MenuItemIngredient',
    'MenuItemRecipe',
    'MenuItemRecipeIngredient',
    'MobileSession',
    'Modifier',
    'ModifierGroup',
    'ModifierGroupTemplate',
    'ModifierInventoryLink',
    'ModifierTemplate',
    'Order',
    'OrderCard',
    'OrderDiscount',
    'OrderEvent',
    'OrderItem',
    'OrderItemDiscount',
    'OrderItemIngredient',
    'OrderItemModifier',
    'OrderItemPizza',
    'OrderItemSnapshot',
    'OrderOwnership',
    'OrderOwnershipEntry',
    'OrderSnapshot',
    'OrderType',
    'OutageQueueEntry',
    'PaidInOut',
    'Payment',
    'PaymentReader',
    'PaymentReaderLog',
    'PayrollPeriod',
    'PayrollSettings',
    'PayStub',
    'PendingDeduction',
    'PizzaCheese',
    'PizzaConfig',
    'PizzaCrust',
    'PizzaSauce',
    'PizzaSize',
    'PizzaSpecialty',
    'PizzaTopping',
    'PmsChargeAttempt',
    'PrepItem',
    'PrepItemIngredient',
    'PrepStation',
    'PrepTrayConfig',
    'PricingOption',
    'PricingOptionGroup',
    'PricingOptionInventoryLink',
    'Printer',
    'PrintJob',
    'PrintRoute',
    'PrintRule',
    'QuickBarDefault',
    'QuickBarPreference',
    'ReasonAccess',
    'RecipeIngredient',
    'RefundLog',
    'RegisteredDevice',
    'RemoteVoidApproval',
    'Reservation',
    'Role',
    'Scale',
    'Schedule',
    'ScheduledShift',
    'Seat',
    'Section',
    'SectionAssignment',
    'ServerRegistrationToken',
    'SevenShiftsDailySalesPush',
    'Shift',
    'ShiftSwapRequest',
    'SpiritCategory',
    'SpiritModifierGroup',
    'SpiritUpsellEvent',
    'Station',
    'StockAlert',
    'StorageLocation',
    'SyncAuditEntry',
    'Table',
    'TaxRule',
    'Terminal',
    'Ticket',
    'TimeClockEntry',
    'TimedSession',
    'TipAdjustment',
    'TipDebt',
    'TipGroup',
    'TipGroupMembership',
    'TipGroupSegment',
    'TipGroupTemplate',
    'TipLedger',
    'TipLedgerEntry',
    'TipOutRule',
    'TipPool',
    'TipShare',
    'TipTransaction',
    'Vendor',
    'VendorOrder',
    'VendorOrderLineItem',
    'VoidLog',
    'VoidReason',
    'WalkoutRetry',
    'WasteLog',
    'WasteLogEntry',
  ]

  try {
    const result = await db.$transaction(async (tx) => {
      const counts: Record<string, number> = {}

      for (let i = 0; i < tables.length; i++) {
        const table = tables[i]
        try {
          const rowCount = await tx.$executeRawUnsafe(
            `UPDATE "${table}" SET "locationId" = $1 WHERE "locationId" = $2`,
            newLocationId, oldLocationId
          )
          counts[table] = rowCount
        } catch (err: any) {
          // Table might not exist yet (pending migration) or not have locationId — skip gracefully
          // 42P01 = undefined_table, 42703 = undefined_column
          if (err.code === '42P01' || err.code === '42703') {
            counts[table] = -1 // skipped
            continue
          }
          throw err
        }
      }

      // Update the Location record itself last (changes the PK)
      await tx.$executeRawUnsafe(
        `UPDATE "Location" SET "id" = $1 WHERE "id" = $2`,
        newLocationId, oldLocationId
      )
      counts['Location'] = 1

      return counts
    }, { timeout: 300_000 }) // 5 min timeout for large venues with millions of rows

    return NextResponse.json({ success: true, oldLocationId, newLocationId, counts: result })
  } catch (err: any) {
    console.error('[MigrateLocationId] Failed:', err)
    return NextResponse.json({ error: 'Migration failed', details: err.message }, { status: 500 })
  }
}
