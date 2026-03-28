/**
 * GET /api/public/cake-orders/wall-display — Token-authenticated wall display feed
 *
 * No auth. Token-based access validated against Location.settings.cakeOrdering.wallDisplayToken.
 * Returns only safe, non-PII fields for kitchen display.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, DEFAULT_CAKE_ORDERING } from '@/lib/settings'
import { parseCakeConfig } from '@/lib/cake-orders/schemas'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const token = searchParams.get('token')
    const locationId = searchParams.get('locationId')

    // ── Validate required params ──────────────────────────────────────────
    if (!token || !locationId) {
      return err('token and locationId are required')
    }

    // ── Validate token against location settings ─────────────────────────
    const locationRows = await db.$queryRawUnsafe<Array<{ settings: unknown }>>(
      `SELECT "settings" FROM "Location" WHERE "id" = $1 AND "isActive" = true LIMIT 1`,
      locationId,
    )

    if (locationRows.length === 0) {
      return notFound('Location not found')
    }

    const settings = parseSettings(locationRows[0].settings as Record<string, unknown> | null)
    const cakeSettings = settings.cakeOrdering
      ? { ...DEFAULT_CAKE_ORDERING, ...settings.cakeOrdering }
      : DEFAULT_CAKE_ORDERING

    if (!cakeSettings.enabled) {
      return forbidden('Cake ordering is not enabled')
    }

    if (!cakeSettings.wallDisplayToken || cakeSettings.wallDisplayToken !== token) {
      return forbidden('Invalid display token')
    }

    // ── Query active cake orders ─────────────────────────────────────────
    // ONLY safe fields: no customer PII, no financial data, no notes
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         co."id",
         co."orderNumber",
         co."eventDate",
         co."eventTimeStart",
         co."eventType",
         co."guestCount",
         co."status",
         co."cakeConfig",
         e."firstName" AS "assignedToFirstName"
       FROM "CakeOrder" co
       LEFT JOIN "Employee" e ON e."id" = co."assignedTo"
       WHERE co."locationId" = $1
         AND co."status" IN ('deposit_paid', 'in_production', 'ready')
         AND co."deletedAt" IS NULL
       ORDER BY co."eventDate" ASC, co."orderNumber" ASC`,
      locationId,
    )

    // ── Build safe response ──────────────────────────────────────────────
    const safeOrders = orders.map((order) => {
      // Build cake summary from cakeConfig
      const cakeConfig = parseCakeConfig(order.cakeConfig)
      const tierCount = cakeConfig.tiers.length
      const tierSizes = cakeConfig.tiers
        .map((t) => {
          // Extract size from menuItemName (e.g., '14" Round Cake' -> '14"')
          const sizeMatch = t.menuItemName.match(/(\d+["'\u2033])/)
          return sizeMatch ? sizeMatch[1] : t.menuItemName
        })
        .join('+')

      const cakeSummary =
        tierCount === 1
          ? tierSizes
          : `${tierCount}-Tier, ${tierSizes}`

      return {
        id: order.id,
        orderNumber: Number(order.orderNumber),
        eventDate: order.eventDate instanceof Date
          ? order.eventDate.toISOString().split('T')[0]
          : String(order.eventDate).split('T')[0],
        eventTimeStart: order.eventTimeStart ?? null,
        eventType: order.eventType,
        guestCount: order.guestCount != null ? Number(order.guestCount) : null,
        status: order.status,
        assignedToFirstName: order.assignedToFirstName ?? null,
        cakeSummary,
      }
    })

    return ok({ orders: safeOrders })
  } catch (error) {
    console.error('[wall-display] Failed to fetch cake orders:', error)
    return err('Failed to fetch cake orders', 500)
  }
}
