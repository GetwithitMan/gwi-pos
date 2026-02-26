/**
 * Online Order Dispatch Worker
 *
 * Polls every 15 seconds for online orders with status 'received' (payment
 * approved on Vercel but not yet dispatched to kitchen/printers) and triggers
 * the normal send pipeline on the NUC so KDS screens and printers fire.
 *
 * WHY THIS EXISTS:
 *   Online checkout runs on Vercel (cloud), but KDS screens and kitchen printers
 *   are connected to the NUC via local Socket.io. Vercel can't reach the NUC
 *   directly (it's behind NAT). Instead, Vercel writes the paid order to the
 *   shared Neon DB with status 'received', and this worker picks it up within
 *   15 seconds and dispatches locally.
 *
 * OFFLINE-FIRST MODE:
 *   With local PG as primary DB, the NUC won't see online orders until they're
 *   pulled from Neon. This worker now queries Neon directly, upserts orders
 *   into local PG, then dispatches via the existing local endpoint.
 *
 * 15-second latency is acceptable — customers expect 15–30 min prep time.
 *
 * Only runs on NUC instances (requires POS_LOCATION_ID env var).
 * In cloud/Vercel mode, this worker does not start.
 */

import { neonClient, hasNeonConnection } from './neon-client'
import { masterClient } from './db'

let workerInterval: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 15_000

export function startOnlineOrderDispatchWorker(port: number): void {
  if (workerInterval) return

  const locationId = process.env.POS_LOCATION_ID
  if (!locationId) {
    // Cloud/Vercel mode — no local Socket.io dispatch possible, skip
    return
  }

  console.log('[OnlineOrderWorker] Started (15s polling interval)')

  workerInterval = setInterval(() => {
    void pollAndDispatch(port, locationId).catch((err) =>
      console.error('[OnlineOrderWorker] Poll cycle error:', err)
    )
  }, POLL_INTERVAL_MS)
}

export function stopOnlineOrderDispatchWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('[OnlineOrderWorker] Stopped')
  }
}

async function pollAndDispatch(port: number, locationId: string): Promise<void> {
  try {
    // If Neon is available, pull online orders from cloud first
    if (hasNeonConnection()) {
      await pullOnlineOrdersFromNeon(locationId)
    }

    // Then dispatch via existing local endpoint (reads from local PG)
    const res = await fetch(
      `http://localhost:${port}/api/internal/dispatch-online-order`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.PROVISION_API_KEY || '',
        },
        body: JSON.stringify({ locationId }),
      }
    )

    if (!res.ok) {
      console.error(`[OnlineOrderWorker] Dispatch endpoint returned ${res.status}`)
      return
    }

    const data = (await res.json()) as { dispatched: number; found: number; errors?: string[] }

    if (data.dispatched > 0) {
      console.log(`[OnlineOrderWorker] Dispatched ${data.dispatched} online order(s) to kitchen`)
    }
    if (data.errors?.length) {
      console.error('[OnlineOrderWorker] Dispatch errors:', data.errors)
    }
  } catch {
    // Server might not be ready yet on startup — silently ignore
  }
}

// ── Pull online orders from Neon into local PG ─────────────────────────────

/** Cached column data types for upsert type casts */
const upsertTypeCache = new Map<string, Map<string, string>>()

async function getColumnTypes(tableName: string): Promise<Map<string, string>> {
  if (upsertTypeCache.has(tableName)) return upsertTypeCache.get(tableName)!
  const cols = await masterClient.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
    tableName
  )
  const typeMap = new Map<string, string>()
  cols.forEach((c) => typeMap.set(c.column_name, c.data_type))
  upsertTypeCache.set(tableName, typeMap)
  return typeMap
}

function pgCast(dataType?: string): string {
  if (!dataType) return ''
  if (dataType.includes('timestamp')) return '::timestamptz'
  if (dataType === 'jsonb') return '::jsonb'
  if (dataType === 'json') return '::json'
  if (dataType === 'boolean') return '::boolean'
  return ''
}

function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'object') {
    if ((val as { constructor?: { name?: string } }).constructor?.name === 'Decimal') {
      return (val as { toString(): string }).toString()
    }
    return JSON.stringify(val)
  }
  return val
}

async function upsertRow(tableName: string, row: Record<string, unknown>): Promise<void> {
  const types = await getColumnTypes(tableName)
  const cols = Object.keys(row).filter((k) => row[k] !== undefined)
  const values = cols.map((c) => serializeValue(row[c]))
  const placeholders = cols.map((c, i) => `$${i + 1}${pgCast(types.get(c))}`).join(', ')
  const quotedCols = cols.map((c) => `"${c}"`).join(', ')
  const updateSet = cols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  await masterClient.$executeRawUnsafe(
    `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
    ...values
  )
}

async function pullOnlineOrdersFromNeon(locationId: string): Promise<void> {
  try {
    // Find received online orders in Neon
    const orders = await neonClient!.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Order" WHERE "locationId" = $1 AND status = 'received' AND source = 'online' AND "deletedAt" IS NULL LIMIT 20`,
      locationId
    )

    if (orders.length === 0) return

    console.log(`[OnlineOrderWorker] Found ${orders.length} online order(s) in Neon`)

    for (const { id: orderId } of orders) {
      try {
        // Claim the order in Neon (prevent double-pickup)
        const claimed = await neonClient!.$executeRawUnsafe(
          `UPDATE "Order" SET status = 'processing' WHERE id = $1 AND status = 'received'`,
          orderId
        )
        if (claimed === 0) continue // Already claimed

        // Get full order row from Neon
        const [orderRow] = await neonClient!.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM "Order" WHERE id = $1`,
          orderId
        )
        if (!orderRow) continue

        // Get order items
        const items = await neonClient!.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM "OrderItem" WHERE "orderId" = $1`,
          orderId
        )

        // Get modifiers for all items
        const itemIds = items.map((i) => i.id as string)
        let modifiers: Record<string, unknown>[] = []
        if (itemIds.length > 0) {
          modifiers = await neonClient!.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM "OrderItemModifier" WHERE "orderItemId" = ANY($1::text[])`,
            itemIds
          )
        }

        // Upsert into local PG (set status back to 'received' for local dispatch)
        orderRow.status = 'received'
        await upsertRow('Order', orderRow)

        for (const item of items) {
          await upsertRow('OrderItem', item)
        }
        for (const mod of modifiers) {
          await upsertRow('OrderItemModifier', mod)
        }

        console.log(
          `[OnlineOrderWorker] Pulled order ${orderId} (${items.length} items) from Neon`
        )
      } catch (err) {
        console.error(
          `[OnlineOrderWorker] Error pulling order ${orderId}:`,
          err instanceof Error ? err.message : err
        )
        // Revert claim in Neon on failure
        await neonClient!
          .$executeRawUnsafe(
            `UPDATE "Order" SET status = 'received' WHERE id = $1 AND status = 'processing'`,
            orderId
          )
          .catch(() => {})
      }
    }
  } catch (err) {
    console.error(
      '[OnlineOrderWorker] Neon pull error:',
      err instanceof Error ? err.message : err
    )
  }
}
