import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err } from '@/lib/api-response'

// GET /api/loyalty/transactions — transaction history with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const conditions: string[] = ['lt."locationId" = $1']
    const params: unknown[] = [locationId]
    let paramIdx = 2

    // Optional filters
    const customerId = searchParams.get('customerId')
    if (customerId) {
      conditions.push(`lt."customerId" = $${paramIdx}`)
      params.push(customerId)
      paramIdx++
    }

    const type = searchParams.get('type')
    if (type) {
      conditions.push(`lt."type" = $${paramIdx}`)
      params.push(type)
      paramIdx++
    }

    const dateFrom = searchParams.get('dateFrom')
    if (dateFrom) {
      conditions.push(`lt."createdAt" >= $${paramIdx}::timestamp`)
      params.push(dateFrom)
      paramIdx++
    }

    const dateTo = searchParams.get('dateTo')
    if (dateTo) {
      conditions.push(`lt."createdAt" <= $${paramIdx}::timestamp`)
      params.push(dateTo)
      paramIdx++
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    const whereClause = conditions.join(' AND ')

    // Count total
    const countRows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS "count"
       FROM "LoyaltyTransaction" lt
       WHERE ${whereClause}`
    const total = Number(countRows[0]?.count ?? 0)

    // Fetch transactions (parameterized LIMIT/OFFSET)
    params.push(limit, offset)
    const transactions = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT lt.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName"
       FROM "LoyaltyTransaction" lt
       LEFT JOIN "Customer" c ON c."id" = lt."customerId"
       WHERE ${whereClause}
       ORDER BY lt."createdAt" DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`

    return NextResponse.json({
      data: transactions,
      pagination: { total, limit, offset },
    })
  } catch (error: any) {
    if (error?.message?.includes('does not exist') || error?.code === '42P01') {
      return err('Loyalty system not yet configured. Please run database migrations.', 503)
    }
    console.error('Failed to list loyalty transactions:', error)
    return err('Failed to list loyalty transactions', 500)
  }
})
