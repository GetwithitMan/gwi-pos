/**
 * GET /api/public/portal/[slug]/my-orders — List customer's cake orders
 *
 * Session-authenticated via 'portal_session' httpOnly cookie.
 * Returns safe order list (no internal notes, no POS IDs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }

    // ── Read session cookie ────────────────────────────────────────
    const sessionToken = request.cookies.get('portal_session')?.value
    if (!sessionToken) {
      return NextResponse.json(
        { error: 'Authentication required. Please log in.' },
        { status: 401 },
      )
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
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
      return NextResponse.json(
        { error: 'Session expired. Please log in again.' },
        { status: 401 },
      )
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

    return NextResponse.json({ orders: safeOrders })
  } catch (error) {
    console.error('[GET /api/public/portal/[slug]/my-orders] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 })
  }
}
