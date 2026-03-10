import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET: List pour logs with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const locationId = params.get('locationId')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const employeeId = params.get('employeeId')
    const menuItemId = params.get('menuItemId')
    const overPourOnly = params.get('overPourOnly') === 'true'
    const requestingEmployeeId = params.get('requestingEmployeeId') || params.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const conditions = [`p."locationId" = $1`]
    const values: unknown[] = [locationId]
    let paramIdx = 2

    if (startDate) {
      conditions.push(`p."pouredAt" >= $${paramIdx}::timestamp`)
      values.push(new Date(startDate))
      paramIdx++
    }
    if (endDate) {
      conditions.push(`p."pouredAt" <= $${paramIdx}::timestamp`)
      values.push(new Date(endDate + 'T23:59:59'))
      paramIdx++
    }
    if (employeeId) {
      conditions.push(`p."employeeId" = $${paramIdx}`)
      values.push(employeeId)
      paramIdx++
    }
    if (menuItemId) {
      conditions.push(`p."menuItemId" = $${paramIdx}`)
      values.push(menuItemId)
      paramIdx++
    }
    if (overPourOnly) {
      conditions.push(`p."isOverPour" = true`)
    }

    const whereClause = conditions.join(' AND ')

    // Fetch pour entries
    const entries = await db.$queryRawUnsafe<Array<{
      id: string
      menuItemId: string | null
      employeeId: string | null
      targetOz: number
      actualOz: number
      varianceOz: number
      isOverPour: boolean
      wasteCost: number
      tapId: string | null
      source: string
      pouredAt: Date
    }>>(
      `SELECT p.* FROM "PourLog" p WHERE ${whereClause} ORDER BY p."pouredAt" DESC LIMIT 1000`,
      ...values,
    )

    // Summary stats
    const summary = await db.$queryRawUnsafe<Array<{
      total_pours: bigint
      total_oz: number | null
      avg_pour: number | null
      over_pour_count: bigint
      total_waste_cost: number | null
    }>>(
      `SELECT
        COUNT(*) as total_pours,
        SUM("actualOz") as total_oz,
        AVG("actualOz") as avg_pour,
        COUNT(*) FILTER (WHERE "isOverPour" = true) as over_pour_count,
        SUM("wasteCost") FILTER (WHERE "isOverPour" = true) as total_waste_cost
       FROM "PourLog" p WHERE ${whereClause}`,
      ...values,
    )

    const s = summary[0]

    return NextResponse.json({
      data: {
        entries,
        summary: {
          totalPours: Number(s?.total_pours ?? 0),
          totalOz: Math.round((Number(s?.total_oz ?? 0)) * 100) / 100,
          avgPour: Math.round((Number(s?.avg_pour ?? 0)) * 100) / 100,
          overPourCount: Number(s?.over_pour_count ?? 0),
          totalWasteCost: Math.round((Number(s?.total_waste_cost ?? 0)) * 100) / 100,
        },
      },
    })
  } catch (error) {
    console.error('[pour-control/GET] Error:', error)
    return NextResponse.json({ error: 'Failed to load pour logs' }, { status: 500 })
  }
})

// POST: Record a pour event
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { menuItemId, employeeId, targetOz, actualOz, tapId, timestamp, locationId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (typeof targetOz !== 'number' || targetOz <= 0) {
      return NextResponse.json({ error: 'Valid targetOz is required' }, { status: 400 })
    }
    if (typeof actualOz !== 'number' || actualOz <= 0) {
      return NextResponse.json({ error: 'Valid actualOz is required' }, { status: 400 })
    }

    // Load settings for threshold
    const locationRows = await db.$queryRawUnsafe<Array<{ settings: Record<string, unknown> }>>(
      `SELECT "settings" FROM "Location" WHERE "id" = $1 LIMIT 1`,
      locationId,
    )
    const settings = locationRows[0]?.settings as Record<string, unknown> | undefined
    const pourSettings = settings?.pourControl as { overPourThresholdPercent?: number } | undefined
    const threshold = pourSettings?.overPourThresholdPercent ?? 15

    const varianceOz = actualOz - targetOz
    const isOverPour = actualOz > targetOz * (1 + threshold / 100)

    // Estimate waste cost from menu item cost if available
    let wasteCost = 0
    if (isOverPour && menuItemId) {
      const items = await db.$queryRawUnsafe<Array<{ cost: number | null }>>(
        `SELECT "cost" FROM "MenuItem" WHERE "id" = $1 LIMIT 1`,
        menuItemId,
      )
      const itemCost = Number(items[0]?.cost ?? 0)
      if (itemCost > 0 && targetOz > 0) {
        const costPerOz = itemCost / targetOz
        wasteCost = Math.round(varianceOz * costPerOz * 100) / 100
      }
    }

    const pouredAt = timestamp ? new Date(timestamp) : new Date()

    const result = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "PourLog" ("locationId", "menuItemId", "employeeId", "targetOz", "actualOz", "varianceOz", "isOverPour", "wasteCost", "tapId", "source", "pouredAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10)
       RETURNING "id"`,
      locationId,
      menuItemId || null,
      employeeId || null,
      targetOz,
      actualOz,
      varianceOz,
      isOverPour,
      wasteCost,
      tapId || null,
      pouredAt,
    )

    // Fire-and-forget: alert on over-pour
    if (isOverPour && pourSettings?.overPourThresholdPercent !== undefined) {
      void import('@/lib/alert-service').then(({ dispatchAlert }) => {
        dispatchAlert({
          severity: 'MEDIUM',
          errorType: 'over_pour',
          category: 'pour_control',
          message: `Over-pour detected: ${actualOz.toFixed(1)}oz / ${targetOz.toFixed(1)}oz target (+${varianceOz.toFixed(1)}oz, $${wasteCost.toFixed(2)} waste)`,
          locationId,
          employeeId: employeeId || undefined,
          groupId: `over-pour-${locationId}-${employeeId || 'unknown'}`,
        })
      }).catch(console.error)
    }

    return NextResponse.json({ data: { id: result[0]?.id, isOverPour, wasteCost, success: true } })
  } catch (error) {
    console.error('[pour-control/POST] Error:', error)
    return NextResponse.json({ error: 'Failed to record pour' }, { status: 500 })
  }
})
