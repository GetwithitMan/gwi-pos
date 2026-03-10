/**
 * Third-Party Delivery Orders — List API
 *
 * GET /api/third-party-orders?locationId=...&platform=...&status=...&startDate=...&endDate=...
 *
 * Lists third-party delivery orders with filters.
 * Includes linked POS order info if accepted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

interface ThirdPartyOrderRow {
  id: string
  locationId: string
  platform: string
  externalOrderId: string
  externalCustomerName: string | null
  externalCustomerPhone: string | null
  status: string
  orderId: string | null
  items: unknown
  subtotal: number | { toNumber?: () => number }
  tax: number | { toNumber?: () => number }
  deliveryFee: number | { toNumber?: () => number }
  tip: number | { toNumber?: () => number }
  total: number | { toNumber?: () => number }
  specialInstructions: string | null
  estimatedPickupAt: Date | null
  actualPickupAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toNum(val: unknown): number {
  if (typeof val === 'object' && val && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber()
  }
  return Number(val) || 0
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId') || searchParams.get('requestingEmployeeId')
    const platform = searchParams.get('platform')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = Math.min(Number(searchParams.get('limit') || 100), 500)
    const offset = Number(searchParams.get('offset') || 0)

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    // Permission check — reuse reports.view since this is an operational view
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build query with filters
    const conditions: string[] = ['"locationId" = $1', '"deletedAt" IS NULL']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    if (platform) {
      conditions.push(`"platform" = $${paramIdx}`)
      params.push(platform)
      paramIdx++
    }

    if (status) {
      conditions.push(`"status" = $${paramIdx}`)
      params.push(status)
      paramIdx++
    }

    if (startDate) {
      conditions.push(`"createdAt" >= $${paramIdx}`)
      params.push(new Date(startDate))
      paramIdx++
    }

    if (endDate) {
      conditions.push(`"createdAt" <= $${paramIdx}`)
      params.push(new Date(endDate))
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    // Count total
    const countResult = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "ThirdPartyOrder" WHERE ${whereClause}`,
      ...params,
    )
    const totalCount = Number(countResult[0]?.count || 0)

    // Fetch orders
    const rows = await db.$queryRawUnsafe<ThirdPartyOrderRow[]>(
      `SELECT "id", "locationId", "platform", "externalOrderId",
              "externalCustomerName", "externalCustomerPhone",
              "status", "orderId", "items",
              "subtotal", "tax", "deliveryFee", "tip", "total",
              "specialInstructions", "estimatedPickupAt", "actualPickupAt",
              "createdAt", "updatedAt"
       FROM "ThirdPartyOrder"
       WHERE ${whereClause}
       ORDER BY "createdAt" DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      ...params,
      limit,
      offset,
    )

    const data = rows.map(row => ({
      id: row.id,
      platform: row.platform,
      externalOrderId: row.externalOrderId,
      customerName: row.externalCustomerName,
      customerPhone: row.externalCustomerPhone,
      status: row.status,
      orderId: row.orderId,
      items: row.items,
      subtotal: toNum(row.subtotal),
      tax: toNum(row.tax),
      deliveryFee: toNum(row.deliveryFee),
      tip: toNum(row.tip),
      total: toNum(row.total),
      specialInstructions: row.specialInstructions,
      estimatedPickupAt: row.estimatedPickupAt?.toISOString() || null,
      actualPickupAt: row.actualPickupAt?.toISOString() || null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))

    return NextResponse.json({
      data,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    })
  } catch (error) {
    console.error('[GET /api/third-party-orders] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch third-party orders' }, { status: 500 })
  }
})
