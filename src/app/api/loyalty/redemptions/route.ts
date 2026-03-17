import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/loyalty/redemptions — list redemptions for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_PAYMENT)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Build query ─────────────────────────────────────────────────
    const conditions: string[] = ['lr."locationId" = $1']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    const status = searchParams.get('status')
    if (status) {
      conditions.push(`lr."status" = $${paramIdx}`)
      params.push(status)
      paramIdx++
    }

    const customerId = searchParams.get('customerId')
    if (customerId) {
      conditions.push(`lr."customerId" = $${paramIdx}`)
      params.push(customerId)
      paramIdx++
    }

    const dateFrom = searchParams.get('dateFrom')
    if (dateFrom) {
      conditions.push(`lr."createdAt" >= $${paramIdx}::timestamp`)
      params.push(dateFrom)
      paramIdx++
    }

    const dateTo = searchParams.get('dateTo')
    if (dateTo) {
      conditions.push(`lr."createdAt" <= $${paramIdx}::timestamp`)
      params.push(dateTo)
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    const redemptions = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT
         lr.*,
         c."firstName" AS "customerFirstName",
         c."lastName" AS "customerLastName",
         rw."name" AS "rewardName",
         rw."rewardType" AS "rewardType"
       FROM "LoyaltyRedemption" lr
       LEFT JOIN "Customer" c ON c."id" = lr."customerId"
       LEFT JOIN "LoyaltyReward" rw ON rw."id" = lr."rewardId"
       WHERE ${whereClause}
       ORDER BY lr."createdAt" DESC`,
      ...params,
    )

    return NextResponse.json({ data: redemptions })
  } catch (error) {
    console.error('Failed to list loyalty redemptions:', error)
    return NextResponse.json({ error: 'Failed to list loyalty redemptions' }, { status: 500 })
  }
})
