import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, ok } from '@/lib/api-response'

interface RulePerformanceRow {
  upsellRuleId: string
  ruleName: string
  timesShown: bigint
  timesAccepted: bigint
  timesDismissed: bigint
  revenueGenerated: string | null
}

interface OverallRow {
  totalShown: bigint
  totalAccepted: bigint
  totalDismissed: bigint
  totalRevenue: string | null
  uniqueOrders: bigint
}

// GET — Upsell analytics report with per-rule and overall metrics
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (locationId) {
      // Auth check
      const actor = await getActorFromRequest(request)
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
      if (!auth.authorized) return err(auth.error, auth.status)
    }
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Default to last 30 days
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date()

    // Per-rule performance
    const perRule = await db.$queryRaw<RulePerformanceRow[]>`
      SELECT
        e."upsellRuleId",
        r."name" as "ruleName",
        COUNT(*) FILTER (WHERE e."action" = 'shown') as "timesShown",
        COUNT(*) FILTER (WHERE e."action" = 'accepted') as "timesAccepted",
        COUNT(*) FILTER (WHERE e."action" = 'dismissed') as "timesDismissed",
        COALESCE(SUM(e."addedAmount") FILTER (WHERE e."action" = 'accepted'), 0) as "revenueGenerated"
      FROM "UpsellEvent" e
      JOIN "UpsellRule" r ON e."upsellRuleId" = r."id"
      WHERE e."locationId" = ${locationId}
        AND e."createdAt" >= ${start}
        AND e."createdAt" <= ${end}
        AND e."deletedAt" IS NULL
      GROUP BY e."upsellRuleId", r."name"
      ORDER BY "timesAccepted" DESC
    `

    // Overall metrics
    const overall = await db.$queryRaw<OverallRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE "action" = 'shown') as "totalShown",
        COUNT(*) FILTER (WHERE "action" = 'accepted') as "totalAccepted",
        COUNT(*) FILTER (WHERE "action" = 'dismissed') as "totalDismissed",
        COALESCE(SUM("addedAmount") FILTER (WHERE "action" = 'accepted'), 0) as "totalRevenue",
        COUNT(DISTINCT "orderId") FILTER (WHERE "action" = 'accepted') as "uniqueOrders"
      FROM "UpsellEvent"
      WHERE "locationId" = ${locationId}
        AND "createdAt" >= ${start}
        AND "createdAt" <= ${end}
        AND "deletedAt" IS NULL
    `

    const overallData = overall[0] || {
      totalShown: BigInt(0),
      totalAccepted: BigInt(0),
      totalDismissed: BigInt(0),
      totalRevenue: '0',
      uniqueOrders: BigInt(0),
    }

    const totalShown = Number(overallData.totalShown)
    const totalAccepted = Number(overallData.totalAccepted)

    return ok({
        dateRange: { start: start.toISOString(), end: end.toISOString() },
        overall: {
          totalShown,
          totalAccepted,
          totalDismissed: Number(overallData.totalDismissed),
          conversionRate: totalShown > 0 ? Math.round((totalAccepted / totalShown) * 10000) / 100 : 0,
          totalRevenue: Number(overallData.totalRevenue || 0),
          uniqueOrdersWithUpsell: Number(overallData.uniqueOrders),
        },
        byRule: perRule.map(r => {
          const shown = Number(r.timesShown)
          const accepted = Number(r.timesAccepted)
          return {
            ruleId: r.upsellRuleId,
            ruleName: r.ruleName,
            timesShown: shown,
            timesAccepted: accepted,
            timesDismissed: Number(r.timesDismissed),
            conversionRate: shown > 0 ? Math.round((accepted / shown) * 10000) / 100 : 0,
            revenueGenerated: Number(r.revenueGenerated || 0),
          }
        }),
      })
  } catch (error) {
    console.error('Failed to generate upsell analytics:', error)
    return err('Failed to generate upsell analytics', 500)
  }
})
