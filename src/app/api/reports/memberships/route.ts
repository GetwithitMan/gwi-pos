import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const locationId = sp.get('locationId')
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId ?? sp.get('requestingEmployeeId')
    const type = sp.get('type') || 'summary'
    const period = sp.get('period') || 'monthly'

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(employeeId, locationId, 'admin.view_membership_reports')
    if (!auth.authorized) return err(auth.error, auth.status)

    switch (type) {
      case 'summary':
        return ok(await getSummary(db, locationId))
      case 'revenue':
        return ok(await getRevenue(db, locationId, period))
      case 'declines':
        return ok(await getDeclines(db, locationId))
      case 'aging':
        return ok(await getAging(db, locationId))
      case 'by_plan':
        return ok(await getByPlan(db, locationId))
      default:
        return err('Invalid report type')
    }
  } catch (caughtErr) {
    console.error('[reports/memberships] error:', err)
    return err('Internal error', 500)
  }
})

async function getSummary(db: any, locationId: string) {
  const stats: any[] = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE "status" IN ('active', 'trial'))::int AS "activeCount",
      COUNT(*) FILTER (WHERE "billingStatus" = 'past_due')::int AS "pastDueCount",
      COUNT(*) FILTER (WHERE "status" = 'trial')::int AS "trialCount",
      COALESCE(SUM(
        CASE
          WHEN "status" = 'active' AND "billingCycle" = 'monthly' THEN "priceAtSignup"
          WHEN "status" = 'active' AND "billingCycle" = 'weekly' THEN "priceAtSignup" * 4.33
          WHEN "status" = 'active' AND "billingCycle" = 'annual' THEN "priceAtSignup" / 12
          ELSE 0
        END
      ), 0)::float AS "mrr"
    FROM "Membership"
    WHERE "locationId" = $1 AND "deletedAt" IS NULL
  `, locationId)

  // Churn: cancelled or expired in last 30 days / active at start of period
  const churn: any[] = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE "status" IN ('cancelled', 'expired') AND "endedAt" >= NOW() - interval '30 days')::int AS "churned",
      COUNT(*) FILTER (WHERE "createdAt" < NOW() - interval '30 days' AND "status" IN ('active', 'trial', 'cancelled', 'expired'))::int AS "periodStart"
    FROM "Membership"
    WHERE "locationId" = $1 AND "deletedAt" IS NULL
  `, locationId)

  const s = stats[0] || {}
  const c = churn[0] || {}
  const churnRate = c.periodStart > 0 ? (c.churned / c.periodStart * 100) : 0

  return {
    activeCount: s.activeCount ?? 0,
    trialCount: s.trialCount ?? 0,
    pastDueCount: s.pastDueCount ?? 0,
    mrr: Math.round((s.mrr ?? 0) * 100) / 100,
    arr: Math.round((s.mrr ?? 0) * 12 * 100) / 100,
    churnRate: Math.round(churnRate * 10) / 10,
    churned30d: c.churned ?? 0,
  }
}

async function getRevenue(db: any, locationId: string, period: string) {
  const trunc = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'

  const rows: any[] = await db.$queryRawUnsafe(`
    SELECT
      date_trunc($2, "processedAt") AS "period",
      COALESCE(SUM("totalAmount") FILTER (WHERE "status" = 'approved'), 0)::float AS "collected",
      COALESCE(SUM("totalAmount") FILTER (WHERE "status" = 'declined'), 0)::float AS "failed",
      COALESCE(SUM("totalAmount") FILTER (WHERE "status" = 'approved' AND "chargeType" = 'retry'), 0)::float AS "recovered",
      COUNT(*) FILTER (WHERE "status" = 'approved')::int AS "successCount",
      COUNT(*) FILTER (WHERE "status" = 'declined')::int AS "failCount"
    FROM "MembershipCharge"
    WHERE "locationId" = $1 AND "processedAt" IS NOT NULL AND "processedAt" >= NOW() - interval '12 months'
    GROUP BY date_trunc($2, "processedAt")
    ORDER BY "period" DESC
    LIMIT 60
  `, locationId, trunc)

  return { rows, period }
}

async function getDeclines(db: any, locationId: string) {
  const byReason: any[] = await db.$queryRawUnsafe(`
    SELECT "declineReason", COUNT(*)::int AS "count",
           SUM("totalAmount")::float AS "totalAmount"
    FROM "MembershipCharge"
    WHERE "locationId" = $1 AND "status" = 'declined' AND "processedAt" >= NOW() - interval '90 days'
    GROUP BY "declineReason"
    ORDER BY "count" DESC
  `, locationId)

  const byType: any[] = await db.$queryRawUnsafe(`
    SELECT "failureType", COUNT(*)::int AS "count"
    FROM "MembershipCharge"
    WHERE "locationId" = $1 AND "status" = 'declined' AND "processedAt" >= NOW() - interval '90 days'
    GROUP BY "failureType"
    ORDER BY "count" DESC
  `, locationId)

  const totals: any[] = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS "totalDeclines",
      COUNT(*) FILTER (WHERE "chargeType" = 'retry' AND "status" = 'approved')::int AS "retrySuccesses",
      COUNT(*) FILTER (WHERE "chargeType" = 'retry')::int AS "totalRetries"
    FROM "MembershipCharge"
    WHERE "locationId" = $1 AND "processedAt" >= NOW() - interval '90 days'
  `, locationId)

  const t = totals[0] || {}
  return {
    totalDeclines: t.totalDeclines ?? 0,
    retrySuccessRate: t.totalRetries > 0 ? Math.round(t.retrySuccesses / t.totalRetries * 100) : 0,
    byReason,
    byType,
  }
}

async function getAging(db: any, locationId: string) {
  const rows: any[] = await db.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE "lastFailedAt" >= NOW() - interval '3 days')::int AS "d1_3",
      COUNT(*) FILTER (WHERE "lastFailedAt" < NOW() - interval '3 days' AND "lastFailedAt" >= NOW() - interval '7 days')::int AS "d4_7",
      COUNT(*) FILTER (WHERE "lastFailedAt" < NOW() - interval '7 days' AND "lastFailedAt" >= NOW() - interval '14 days')::int AS "d8_14",
      COUNT(*) FILTER (WHERE "lastFailedAt" < NOW() - interval '14 days')::int AS "d14_plus",
      COALESCE(SUM("priceAtSignup") FILTER (WHERE "lastFailedAt" >= NOW() - interval '3 days'), 0)::float AS "amt1_3",
      COALESCE(SUM("priceAtSignup") FILTER (WHERE "lastFailedAt" < NOW() - interval '3 days' AND "lastFailedAt" >= NOW() - interval '7 days'), 0)::float AS "amt4_7",
      COALESCE(SUM("priceAtSignup") FILTER (WHERE "lastFailedAt" < NOW() - interval '7 days' AND "lastFailedAt" >= NOW() - interval '14 days'), 0)::float AS "amt8_14",
      COALESCE(SUM("priceAtSignup") FILTER (WHERE "lastFailedAt" < NOW() - interval '14 days'), 0)::float AS "amt14_plus"
    FROM "Membership"
    WHERE "locationId" = $1 AND "deletedAt" IS NULL AND "billingStatus" IN ('past_due', 'retry_scheduled', 'uncollectible')
  `, locationId)

  const r = rows[0] || {}
  return {
    buckets: [
      { label: '1-3 days', count: r.d1_3 ?? 0, amount: r.amt1_3 ?? 0 },
      { label: '4-7 days', count: r.d4_7 ?? 0, amount: r.amt4_7 ?? 0 },
      { label: '8-14 days', count: r.d8_14 ?? 0, amount: r.amt8_14 ?? 0 },
      { label: '14+ days', count: r.d14_plus ?? 0, amount: r.amt14_plus ?? 0 },
    ],
  }
}

async function getByPlan(db: any, locationId: string) {
  const rows: any[] = await db.$queryRawUnsafe(`
    SELECT
      "p"."id" AS "planId", "p"."name" AS "planName", "p"."price" AS "planPrice",
      COUNT("m"."id") FILTER (WHERE "m"."status" IN ('active', 'trial'))::int AS "activeCount",
      COUNT("m"."id") FILTER (WHERE "m"."status" IN ('cancelled', 'expired') AND "m"."endedAt" >= NOW() - interval '30 days')::int AS "churned30d",
      COALESCE(SUM(
        CASE
          WHEN "m"."status" = 'active' AND "m"."billingCycle" = 'monthly' THEN "m"."priceAtSignup"
          WHEN "m"."status" = 'active' AND "m"."billingCycle" = 'weekly' THEN "m"."priceAtSignup" * 4.33
          WHEN "m"."status" = 'active' AND "m"."billingCycle" = 'annual' THEN "m"."priceAtSignup" / 12
          ELSE 0
        END
      ), 0)::float AS "mrr"
    FROM "MembershipPlan" "p"
    LEFT JOIN "Membership" "m" ON "p"."id" = "m"."planId" AND "m"."deletedAt" IS NULL
    WHERE "p"."locationId" = $1 AND "p"."deletedAt" IS NULL
    GROUP BY "p"."id", "p"."name", "p"."price"
    ORDER BY "mrr" DESC
  `, locationId)

  return { plans: rows }
}
