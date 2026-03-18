/**
 * Downstream Notification Pipeline
 *
 * Formalizes the fire-and-forget hooks that run after downstream sync
 * applies a row from Neon to local PG. Each handler is registered with
 * a name, model filter, error policy, and async handler function.
 *
 * Replaces inline void hooks in downstream-sync-worker.ts.
 */

type ErrorPolicy = 'log' | 'retry' | 'skip'

interface DownstreamHandler {
  name: string
  models: string[]
  condition?: (tableName: string, row: Record<string, unknown>) => boolean
  handler: (tableName: string, row: Record<string, unknown>, locationId: string) => Promise<void>
  errorPolicy: ErrorPolicy
}

const handlers: DownstreamHandler[] = []
const metrics = new Map<string, { success: number; failure: number }>()

export function registerDownstreamHandler(h: DownstreamHandler): void {
  handlers.push(h)
  metrics.set(h.name, { success: 0, failure: 0 })
}

export async function dispatchDownstreamNotifications(
  tableName: string,
  row: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  for (const h of handlers) {
    if (!h.models.includes(tableName)) continue
    if (h.condition && !h.condition(tableName, row)) continue
    try {
      await h.handler(tableName, row, locationId)
      metrics.get(h.name)!.success++
    } catch (err) {
      metrics.get(h.name)!.failure++
      if (h.errorPolicy === 'log') {
        console.error(`[DownstreamNotify] ${h.name} failed for ${tableName}:${row.id}:`, err instanceof Error ? err.message : err)
      }
      // 'skip' = silent, 'retry' = future enhancement
    }
  }
}

export function getNotificationHealth(): Array<{ name: string; success: number; failure: number }> {
  return [...metrics.entries()].map(([name, m]) => ({ name, ...m }))
}
