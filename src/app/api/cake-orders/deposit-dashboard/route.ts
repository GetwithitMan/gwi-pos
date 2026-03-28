/**
 * GET /api/cake-orders/deposit-dashboard — Outstanding deposit dashboard
 *
 * Returns cake orders with balanceDue > 0 that are not in terminal or draft status.
 * Cursor-based pagination sorted by eventDate ASC. Includes customer details.
 *
 * Permission: cake.payment
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, 'cake.payment')
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Parse pagination ──────────────────────────────────────────────
    const cursor = searchParams.get('cursor')
    const take = Math.min(parseInt(searchParams.get('take') || '50', 10), 100)

    // ── Build query ───────────────────────────────────────────────────
    const conditions: string[] = [
      'co."locationId" = $1',
      'co."balanceDue" > 0',
      `co."status" NOT IN ('cancelled', 'completed', 'draft')`,
      'co."deletedAt" IS NULL',
    ]
    const params: unknown[] = [locationId]
    let paramIdx = 2

    // Cursor-based pagination: eventDate ASC, id ASC
    // Cursor format: "eventDate|id" (ISO date + order ID)
    if (cursor) {
      const [cursorDate, cursorId] = cursor.split('|')
      if (cursorDate && cursorId) {
        conditions.push(
          `(co."eventDate" > $${paramIdx}::date OR (co."eventDate" = $${paramIdx}::date AND co."id" > $${paramIdx + 1}))`,
        )
        params.push(cursorDate, cursorId)
        paramIdx += 2
      }
    }

    const whereClause = conditions.join(' AND ')

    // Fetch one extra to determine hasMore
    params.push(take + 1)
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         co."id",
         co."orderNumber",
         co."status",
         co."eventDate",
         co."eventTimeStart",
         co."eventType",
         co."deliveryType",
         co."totalAfterTax",
         co."depositRequired",
         co."depositPaid",
         co."balanceDue",
         co."source",
         co."createdAt",
         co."updatedAt",
         c."id" AS "customerId",
         c."firstName" AS "customerFirstName",
         c."lastName" AS "customerLastName",
         c."phone" AS "customerPhone",
         c."email" AS "customerEmail"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE ${whereClause}
       ORDER BY co."eventDate" ASC, co."id" ASC
       LIMIT $${paramIdx}`,
      ...params,
    )

    const hasMore = orders.length > take
    const page = hasMore ? orders.slice(0, take) : orders

    // Build next cursor from last item
    let nextCursor: string | null = null
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]
      const lastDate = last.eventDate instanceof Date
        ? last.eventDate.toISOString().split('T')[0]
        : String(last.eventDate)
      nextCursor = `${lastDate}|${last.id}`
    }

    return ok({
        orders: page,
        pagination: { nextCursor, hasMore },
      })
  } catch (error) {
    console.error('[cake-deposit-dashboard] Failed to list orders:', error)
    return err('Failed to load deposit dashboard', 500)
  }
})
