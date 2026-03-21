/**
 * DATA_CHANGED Handler Registry
 *
 * Maps domain names from DATA_CHANGED FleetCommands to specific
 * refresh actions. When a DATA_CHANGED command arrives, the handler
 * registry determines which tables to refresh and whether to trigger
 * an immediate downstream sync cycle.
 */

import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('data-changed-handler')

interface DataChangedPayload {
  domain?: string
  tables?: string[]
  action?: string
  entityId?: string
  entityType?: string
  source?: string
  syncJobId?: string
}

type HandlerFn = (payload: DataChangedPayload) => Promise<void> | void

const handlers = new Map<string, HandlerFn>()

/**
 * Register a handler for a DATA_CHANGED domain.
 */
export function registerDataChangedHandler(domain: string, handler: HandlerFn): void {
  handlers.set(domain, handler)
  log.info({ domain }, 'Registered DATA_CHANGED handler')
}

/**
 * Handle an incoming DATA_CHANGED payload. Looks up the domain handler
 * and executes it. Falls back to triggering a generic downstream sync
 * cycle if no specific handler is registered.
 */
export async function handleDataChanged(payload: DataChangedPayload): Promise<void> {
  const domain = payload.domain || 'unknown'
  const handler = handlers.get(domain)

  if (handler) {
    log.info({ domain, tables: payload.tables }, 'Dispatching to registered handler')
    await handler(payload)
  } else {
    // No specific handler — ALWAYS trigger immediate downstream sync.
    // Every cloud change must reach the NUC as fast as possible.
    log.info({ domain, tables: payload.tables }, 'Triggering immediate downstream sync')
    try {
      const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
      await triggerImmediateDownstreamSync(domain, payload.tables ?? undefined)
    } catch {
      // Downstream worker not available — will catch up on next poll
    }
  }
}

// Register default handlers for known domains
registerDataChangedHandler('menu', async (payload) => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  triggerImmediateDownstreamSync()
  log.info({ tables: payload.tables }, 'Menu change — triggered immediate downstream sync')
})

registerDataChangedHandler('employees', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  triggerImmediateDownstreamSync()
})

registerDataChangedHandler('settings', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  triggerImmediateDownstreamSync()
})

registerDataChangedHandler('floorplan', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  triggerImmediateDownstreamSync()
})

registerDataChangedHandler('order-types', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  triggerImmediateDownstreamSync()
})

registerDataChangedHandler('hardware', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Terminal', 'Printer', 'PrintRoute', 'PrintRule', 'KDSScreen', 'KDSScreenStation', 'KDSScreenLink', 'PaymentReader', 'Scale', 'Station'])
})

registerDataChangedHandler('pricing', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['PricingOptionGroup', 'PricingOption', 'PricingOptionInventoryLink', 'DiscountRule'])
})

registerDataChangedHandler('tax', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['TaxRule'])
})

registerDataChangedHandler('customers', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Customer', 'Coupon', 'GiftCard', 'HouseAccount'])
})

registerDataChangedHandler('inventory', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['InventoryItem', 'InventoryItemStorage', 'Ingredient', 'IngredientCategory', 'MenuItemRecipe', 'Vendor', 'StorageLocation', 'InventorySettings'])
})

registerDataChangedHandler('scheduling', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Schedule', 'ScheduledShift'])
})

registerDataChangedHandler('combos', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['ComboTemplate', 'ComboComponent', 'ComboComponentOption'])
})

registerDataChangedHandler('roles', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Role', 'EmployeeRole'])
})

registerDataChangedHandler('events', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Event', 'EventPricingTier', 'EventTableConfig'])
})

registerDataChangedHandler('reservations', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['Reservation'])
})

registerDataChangedHandler('cfd', async () => {
  const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
  await triggerImmediateDownstreamSync(undefined, ['CfdSettings'])
})
