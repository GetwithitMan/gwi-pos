import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET: Pour control analysis report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const locationId = params.get('locationId')
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const requestingEmployeeId = params.get('requestingEmployeeId') || params.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const conditions = [`"locationId" = $1`]
    const values: unknown[] = [locationId]
    let paramIdx = 2

    if (startDate) {
      conditions.push(`"pouredAt" >= $${paramIdx}::timestamp`)
      values.push(new Date(startDate))
      paramIdx++
    }
    if (endDate) {
      conditions.push(`"pouredAt" <= $${paramIdx}::timestamp`)
      values.push(new Date(endDate + 'T23:59:59'))
      paramIdx++
    }

    const whereClause = conditions.join(' AND ')

    // Per-employee breakdown
    const byEmployee = await db.$queryRawUnsafe<Array<{
      employeeId: string | null
      total_pours: bigint
      total_target: number
      total_actual: number
      over_pour_count: bigint
      total_waste_cost: number
    }>>(
      `SELECT
        "employeeId",
        COUNT(*) as total_pours,
        SUM("targetOz") as total_target,
        SUM("actualOz") as total_actual,
        COUNT(*) FILTER (WHERE "isOverPour" = true) as over_pour_count,
        COALESCE(SUM("wasteCost") FILTER (WHERE "isOverPour" = true), 0) as total_waste_cost
       FROM "PourLog" WHERE ${whereClause}
       GROUP BY "employeeId" ORDER BY over_pour_count DESC`,
      ...values,
    )

    // Per-item breakdown
    const byItem = await db.$queryRawUnsafe<Array<{
      menuItemId: string | null
      total_pours: bigint
      total_target: number
      total_actual: number
      total_variance: number
      total_waste_cost: number
    }>>(
      `SELECT
        "menuItemId",
        COUNT(*) as total_pours,
        SUM("targetOz") as total_target,
        SUM("actualOz") as total_actual,
        SUM("varianceOz") as total_variance,
        COALESCE(SUM("wasteCost"), 0) as total_waste_cost
       FROM "PourLog" WHERE ${whereClause}
       GROUP BY "menuItemId" ORDER BY total_waste_cost DESC`,
      ...values,
    )

    // Trend data: accuracy by day
    const dailyTrend = await db.$queryRawUnsafe<Array<{
      day: string
      total_pours: bigint
      avg_accuracy: number
      over_pour_count: bigint
    }>>(
      `SELECT
        DATE("pouredAt") as day,
        COUNT(*) as total_pours,
        AVG(CASE WHEN "targetOz" > 0 THEN ("actualOz" / "targetOz") * 100 ELSE 100 END) as avg_accuracy,
        COUNT(*) FILTER (WHERE "isOverPour" = true) as over_pour_count
       FROM "PourLog" WHERE ${whereClause}
       GROUP BY DATE("pouredAt") ORDER BY day DESC LIMIT 30`,
      ...values,
    )

    // Overall waste summary
    const wasteSummary = await db.$queryRawUnsafe<Array<{
      total_waste_oz: number
      total_waste_cost: number
    }>>(
      `SELECT
        COALESCE(SUM("varianceOz") FILTER (WHERE "isOverPour" = true), 0) as total_waste_oz,
        COALESCE(SUM("wasteCost") FILTER (WHERE "isOverPour" = true), 0) as total_waste_cost
       FROM "PourLog" WHERE ${whereClause}`,
      ...values,
    )

    return NextResponse.json({
      data: {
        byEmployee: byEmployee.map(e => ({
          employeeId: e.employeeId,
          totalPours: Number(e.total_pours),
          totalTarget: Math.round(Number(e.total_target) * 100) / 100,
          totalActual: Math.round(Number(e.total_actual) * 100) / 100,
          accuracyPercent: Number(e.total_target) > 0
            ? Math.round((Number(e.total_actual) / Number(e.total_target)) * 10000) / 100
            : 100,
          overPourCount: Number(e.over_pour_count),
          wasteCost: Math.round(Number(e.total_waste_cost) * 100) / 100,
        })),
        byItem: byItem.map(i => ({
          menuItemId: i.menuItemId,
          totalPours: Number(i.total_pours),
          totalExpected: Math.round(Number(i.total_target) * 100) / 100,
          totalPoured: Math.round(Number(i.total_actual) * 100) / 100,
          totalVariance: Math.round(Number(i.total_variance) * 100) / 100,
          costImpact: Math.round(Number(i.total_waste_cost) * 100) / 100,
        })),
        dailyTrend: dailyTrend.map(d => ({
          day: d.day,
          totalPours: Number(d.total_pours),
          avgAccuracy: Math.round(Number(d.avg_accuracy) * 100) / 100,
          overPourCount: Number(d.over_pour_count),
        })),
        wasteSummary: {
          totalWasteOz: Math.round(Number(wasteSummary[0]?.total_waste_oz ?? 0) * 100) / 100,
          totalWasteCost: Math.round(Number(wasteSummary[0]?.total_waste_cost ?? 0) * 100) / 100,
        },
      },
    })
  } catch (error) {
    console.error('[reports/pour-control/GET] Error:', error)
    return NextResponse.json({ error: 'Failed to load pour control report' }, { status: 500 })
  }
})
