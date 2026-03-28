/**
 * GET /api/public/portal/[slug]/my-orders — List customer's cake orders
 *
 * Session-authenticated via 'portal_session' httpOnly cookie.
 * Returns safe order list (no internal notes, no POS IDs).
 */

import { NextRequest } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return err('Venue slug is required')
    }

    // ── Read session cookie ────────────────────────────────────────
    const sessionToken = request.cookies.get('portal_session')?.value
    if (!sessionToken) {
      return unauthorized('Authentication required. Please log in.')
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const locationId = location.id

    // ── Validate session token ─────────────────────────────────────
    const sessions = await venueDb.$queryRawUnsafe<
      Array<{ id: string; customerId: string }>
    >(
      `SELECT "id", "customerId"
       FROM "CustomerPortalSession"
       WHERE "locationId" = $1
         AND "sessionToken" = $2
         AND "sessionExpiresAt" > NOW()
       LIMIT 1`,
      locationId,
      sessionToken,
    )

    if (sessions.length === 0) {
      return unauthorized('Session expired. Please log in again.')
    }

    const { customerId } = sessions[0]

    // ── Fetch customer's cake orders ───────────────────────────────
    const orders = await venueDb.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
        "id", "orderNumber", "status", "eventDate", "eventType",
        "total", "depositPaid", "balanceDue", "createdAt"
      FROM "CakeOrder"
      WHERE "customerId" = $1
        AND "locationId" = $2
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC`,
      customerId,
      locationId,
    )

    const safeOrders = orders.map((o) => ({
      id: o.id,
      orderNumber: Number(o.orderNumber),
      status: o.status,
      eventDate: o.eventDate,
      eventType: o.eventType,
      total: Number(o.total),
      depositPaid: Number(o.depositPaid),
      balanceDue: Number(o.balanceDue),
      createdAt: o.createdAt,
    }))

    return ok({ orders: safeOrders })
  } catch (error) {
    console.error('[GET /api/public/portal/[slug]/my-orders] Error:', error)
    return err('Failed to fetch orders', 500)
  }
}
