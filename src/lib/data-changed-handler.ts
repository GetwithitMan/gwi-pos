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
  } else if (payload.tables && payload.tables.length > 0) {
    // No specific handler — trigger downstream sync for the listed tables
    log.info({ domain, tables: payload.tables }, 'No handler registered — triggering generic downstream sync')
    // The downstream sync worker will pick this up on its next cycle
    // Signal it via the cloud relay trigger if available
    try {
      const { triggerImmediateDownstreamSync } = await import('@/lib/sync/downstream-sync-worker')
      triggerImmediateDownstreamSync()
    } catch {
      // Cloud relay not available — downstream worker will catch up on next poll
    }
  } else {
    log.warn({ domain, payload }, 'DATA_CHANGED with no handler and no tables — ignoring')
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
