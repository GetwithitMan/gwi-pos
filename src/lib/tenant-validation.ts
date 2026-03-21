import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('tenant-validation')

/**
 * Tenant Validation — Model Set Definitions
 *
 * Central source of truth for which Prisma models are tenant-scoped
 * and which lack soft-delete. Validated at boot against the actual
 * Prisma schema to catch stale entries.
 */

// ── Tenant-scoped models ─────────────────────────────────────────────────────
// Models that have a locationId column and should be automatically filtered
// by the current request's location.

export const TENANT_SCOPED_MODELS = new Set([
  // Core menu & inventory
  'MenuItem', 'Category', 'Modifier', 'ModifierGroup',
  'ModifierGroupTemplate', 'ModifierTemplate', 'ModifierInventoryLink',
  'InventoryItem', 'InventoryItemTransaction', 'InventoryCount',
  'InventoryCountItem', 'InventoryItemStorage', 'InventorySettings', 'InventoryTransaction',
  'ItemBarcode',
  'IngredientCostHistory', 'InventoryCountEntry', 'PendingDeduction',

  // Ingredients & recipes
  'Ingredient', 'IngredientCategory', 'IngredientRecipe',
  'IngredientStockAdjustment', 'IngredientSwapGroup',
  'MenuItemIngredient', 'MenuItemRecipe', 'MenuItemRecipeIngredient',
  'RecipeIngredient',

  // Liquor / bottle service
  'BottleProduct', 'BottleServiceTier',
  'SpiritCategory', 'SpiritModifierGroup', 'SpiritUpsellEvent',

  // Pizza builder
  'PizzaCheese', 'PizzaConfig', 'PizzaCrust', 'PizzaSauce',
  'PizzaSize', 'PizzaSpecialty', 'PizzaTopping',

  // Combos
  'ComboComponent', 'ComboComponentOption', 'ComboTemplate',

  // Pricing options
  'PricingOption', 'PricingOptionGroup', 'PricingOptionInventoryLink',

  // Orders & line items
  'Order', 'OrderItem', 'OrderItemModifier', 'OrderItemIngredient', 'OrderItemPizza',
  'OrderDiscount', 'OrderItemDiscount', 'OrderCard',
  'order_events', 'order_snapshots', 'order_item_snapshots',
  'OrderOwnership', 'OrderOwnershipEntry', 'OrderType',

  // Payments & financials
  'Payment', 'RefundLog', 'VoidLog', 'VoidReason',
  'RemoteVoidApproval', 'WalkoutRetry',
  'GiftCard', 'GiftCardTransaction',
  'HouseAccount', 'HouseAccountTransaction',
  'DigitalReceipt',

  // Discounts & coupons
  'DiscountRule', 'CompReason', 'Coupon', 'CouponRedemption',

  // Employees & roles
  'Employee', 'EmployeeRole', 'Role',
  'EmployeePermissionOverride',

  // Shifts & time clock
  'Shift', 'ShiftSwapRequest', 'TimeClockEntry', 'Break',
  'Schedule', 'ScheduledShift', 'SectionAssignment',

  // Payroll
  'PayrollPeriod', 'PayrollSettings', 'PayStub',

  // Tips
  'TipPool', 'TipOutRule', 'TipShare', 'TipLedger', 'TipLedgerEntry',
  'TipAdjustment', 'TipDebt', 'TipTransaction',
  'TipGroup', 'TipGroupMembership', 'TipGroupSegment', 'TipGroupTemplate',
  'CashTipDeclaration',

  // Floor plan & sections
  'Section', 'Table', 'Seat', 'FloorPlanElement',

  // Hardware & devices
  'Printer', 'PrintJob', 'PrintRoute', 'PrintRule',
  'Station', 'Terminal', 'Scale', 'PaymentReader', 'PaymentReaderLog',
  'RegisteredDevice', 'ServerRegistrationToken',
  'HardwareCommand',
  'BergDevice', 'BergPluMapping', 'BergDispenseEvent',

  // KDS
  'KDSScreen', 'KDSScreenLink', 'KDSScreenStation',

  // Kitchen prep
  'PrepItem', 'PrepItemIngredient', 'PrepStation', 'PrepTrayConfig',
  'CourseConfig',

  // Daily prep counts
  'DailyPrepCount', 'DailyPrepCountItem', 'DailyPrepCountTransaction',

  // Entertainment & timed sessions
  'EntertainmentWaitlist', 'TimedSession',
  'Event', 'EventPricingTier', 'EventTableConfig', 'Ticket',

  // Reservations
  'Reservation', 'ReservationBlock', 'ReservationDeposit', 'ReservationTable',
  'ReservationEvent',

  // Customers
  'Customer', 'CardProfile', 'MobileSession',

  // Cash & drawers
  'Drawer', 'PaidInOut',

  // Taxes
  'TaxRule',

  // Vendors & purchase orders
  'Vendor', 'VendorOrder', 'VendorOrderLineItem',
  'Invoice', 'InvoiceLineItem',
  'StorageLocation', 'StockAlert',

  // Settings & config
  'CfdSettings',
  'QuickBarDefault', 'QuickBarPreference', 'ReasonAccess',

  // Chargebacks
  'ChargebackCase',

  // Audit & logging
  'AuditLog', 'ErrorLog', 'HealthCheck',
  'VenueLog', 'WasteLog',

  // Cloud sync (@@map table names)
  'cloud_event_queue',

  // Sync & operational
  'SyncAuditEntry', 'SocketEventLog', 'SyncWatermark',
  'BridgeCheckpoint', 'FulfillmentEvent', 'OutageQueueEntry',

  // Integration mappings
  'MarginEdgeProductMapping', 'SevenShiftsDailySalesPush', 'PmsChargeAttempt',

  // Waste
  'WasteLogEntry',
])

// ── Models without soft-delete ───────────────────────────────────────────────
// Models that do NOT have a `deletedAt` column — skip soft-delete filtering.

export const NO_SOFT_DELETE_MODELS = new Set([
  'Organization', 'Location',
  // Tables without deletedAt column — must skip soft-delete filter or queries crash
  'BergDispenseEvent',
  'DeductionRun', 'PendingDeduction', 'IngredientCostHistory',
  'InventoryCountEntry',
  'PmsChargeAttempt', 'SevenShiftsDailySalesPush', 'WasteLog',
  'ReasonAccess',
  'OutageQueueEntry', 'FulfillmentEvent', 'BridgeCheckpoint',
  // locationId but no deletedAt (append-only logs)
  'ReservationEvent', 'VenueLog',
])

// ── Boot-time validation ─────────────────────────────────────────────────────

/**
 * Validate that all model names in our sets actually exist in the database.
 * Call at boot. Logs warnings for stale entries (model removed from schema
 * but still listed here).
 *
 * @param options.failOnStale — When true (production/staging), throws if any
 *   stale entries are found. When false (dev), logs a warning only.
 */
export async function validateTenantModelSets(
  db: { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> },
  options: { failOnStale?: boolean } = {}
): Promise<void> {
  try {
    const tables = await db.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    const tableNames = new Set(tables.map(t => t.table_name))

    const stale: string[] = []

    for (const model of TENANT_SCOPED_MODELS) {
      if (!tableNames.has(model)) {
        stale.push(`TENANT_SCOPED_MODELS: ${model}`)
      }
    }

    for (const model of NO_SOFT_DELETE_MODELS) {
      if (!tableNames.has(model)) {
        stale.push(`NO_SOFT_DELETE_MODELS: ${model}`)
      }
    }

    if (stale.length > 0) {
      const msg =
        `[tenant-validation] ${stale.length} stale model(s) in validation sets — ` +
        `remove from tenant-validation.ts:\n  ${stale.join('\n  ')}`

      if (options.failOnStale) {
        throw new Error(msg)
      }

      log.warn(msg)
    } else {
      log.info(`[tenant-validation] ✓ All model sets valid (${TENANT_SCOPED_MODELS.size} tenant-scoped, ${NO_SOFT_DELETE_MODELS.size} no-soft-delete)`
      )
    }
  } catch (err) {
    // Re-throw stale-entry errors so the caller (server.ts) can halt boot
    if (options.failOnStale) {
      throw err
    }
    log.warn('[tenant-validation] Validation failed:', err instanceof Error ? err.message : err)
  }
}
