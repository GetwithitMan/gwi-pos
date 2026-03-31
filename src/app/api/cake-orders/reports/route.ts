/**
 * GET /api/cake-orders/reports
 *
 * Cake order reports. Supports multiple report types:
 *   - top_flavors: Top 10 flavors by order count and revenue
 *   - deposit_liability: Outstanding deposit liability summary
 *   - production_demand: Orders per day by status for next 7 days
 *
 * Permission: cake.view
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { requireCakeFeature } from '@/lib/cake-orders/require-cake-feature'
import { err, ok } from '@/lib/api-response'

// ── Types ────────────────────────────────────────────────────────────────────

interface TopFlavorRow {
  modifierName: string
  orderCount: number
  totalRevenue: number
}

interface DepositLiabilityResult {
  totalLiability: number
  orderCount: number
}

interface ProductionDemandDay {
  date: string
  counts: {
    deposit_paid: number
    in_production: number
    ready: number
  }
}

const VALID_REPORT_TYPES = ['top_flavors', 'deposit_liability', 'production_demand'] as const
type ReportType = (typeof VALID_REPORT_TYPES)[number]

// ── Route Handler ────────────────────────────────────────────────────────────

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const reportType = searchParams.get('reportType') as ReportType | null
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!locationId) {
      return err('locationId is required')
    }
    if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
      return err(`reportType must be one of: ${VALID_REPORT_TYPES.join(', ')}`)
    }

    // ── Permission check ──────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || searchParams.get('employeeId')

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_VIEW)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Feature gate ────────────────────────────────────────────────────
    const gate = await requireCakeFeature(locationId)
    if (gate) return gate

    // ── Dispatch to report handler ────────────────────────────────────
    let data: unknown

    switch (reportType) {
      case 'top_flavors':
        data = await reportTopFlavors(locationId, dateFrom, dateTo)
        break
      case 'deposit_liability':
        data = await reportDepositLiability(locationId)
        break
      case 'production_demand':
        data = await reportProductionDemand(locationId)
        break
    }

    return ok({ data })
  } catch (error) {
    console.error('[cake-reports] Failed:', error)
    return err('Failed to generate cake report', 500)
  }
})

// ── Report: Top Flavors ──────────────────────────────────────────────────────

/**
 * Aggregates modifier selections where the modifier group type includes 'flavor'
 * from CakeOrder.cakeConfig JSONB. Groups by modifier name, counts orders, sums revenue.
 * Returns top 10.
 */
async function reportTopFlavors(
  locationId: string,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<{ flavors: TopFlavorRow[] }> {
  // Build date conditions
  const conditions: string[] = [
    'co."locationId" = $1',
    'co."deletedAt" IS NULL',
    `co."status" NOT IN ('draft', 'cancelled')`,
  ]
  const params: unknown[] = [locationId]
  let paramIdx = 2

  if (dateFrom) {
    conditions.push(`co."eventDate" >= $${paramIdx}::date`)
    params.push(dateFrom)
    paramIdx++
  }
  if (dateTo) {
    conditions.push(`co."eventDate" <= $${paramIdx}::date`)
    params.push(dateTo)
    paramIdx++
  }

  const whereClause = conditions.join(' AND ')

  // Use JSONB extraction to pull modifier selections from cakeConfig tiers
  // Each tier has a modifiers array; we flatten and filter by modifierGroupName ILIKE '%flavor%'
  const rows = await db.$queryRaw<
    Array<{ modifierName: string; orderCount: string | number; totalRevenue: string | number }>>`WITH tier_modifiers AS (
       SELECT
         co."id" AS order_id,
         co."total",
         tier_elem->'modifiers' AS modifiers
       FROM "CakeOrder" co,
         jsonb_array_elements(co."cakeConfig"->'tiers') AS tier_elem
       WHERE ${whereClause}
         AND co."cakeConfig" IS NOT NULL
     ),
     flat_mods AS (
       SELECT
         tm.order_id,
         tm."total",
         mod_elem->>'modifierName' AS "modifierName",
         mod_elem->>'modifierGroupName' AS "modifierGroupName",
         (mod_elem->>'price')::numeric AS mod_price
       FROM tier_modifiers tm,
         jsonb_array_elements(tm.modifiers) AS mod_elem
     )
     SELECT
       fm."modifierName",
       COUNT(DISTINCT fm.order_id)::int AS "orderCount",
       COALESCE(SUM(DISTINCT fm."total"), 0)::numeric AS "totalRevenue"
     FROM flat_mods fm
     WHERE LOWER(fm."modifierGroupName") LIKE '%flavor%'
       AND fm."modifierName" IS NOT NULL
     GROUP BY fm."modifierName"
     ORDER BY "orderCount" DESC, "totalRevenue" DESC
     LIMIT 10`

  return {
    flavors: rows.map(r => ({
      modifierName: r.modifierName,
      orderCount: Number(r.orderCount),
      totalRevenue: Number(r.totalRevenue),
    })),
  }
}

// ── Report: Deposit Liability ────────────────────────────────────────────────

/**
 * Sums balanceDue across all non-terminal, non-draft cake orders.
 * This represents the total outstanding financial obligation.
 */
async function reportDepositLiability(locationId: string): Promise<DepositLiabilityResult> {
  const rows = await db.$queryRaw<
    Array<{ totalLiability: string | number; orderCount: string | number }>>`SELECT
       COALESCE(SUM("balanceDue"), 0)::numeric AS "totalLiability",
       COUNT(*)::int AS "orderCount"
     FROM "CakeOrder"
     WHERE "locationId" = ${locationId}
       AND "deletedAt" IS NULL
       AND "status" NOT IN ('cancelled', 'completed', 'draft')`

  const row = rows[0]
  return {
    totalLiability: Number(row?.totalLiability ?? 0),
    orderCount: Number(row?.orderCount ?? 0),
  }
}

// ── Report: Production Demand ────────────────────────────────────────────────

/**
 * Counts cake orders per day for the next 7 days, broken down by status
 * (deposit_paid, in_production, ready). Useful for production planning.
 */
async function reportProductionDemand(locationId: string): Promise<{ days: ProductionDemandDay[] }> {
  const rows = await db.$queryRaw<
    Array<{
      event_date: Date | string
      deposit_paid: string | number
      in_production: string | number
      ready: string | number
    }>>`WITH date_series AS (
       SELECT generate_series(
         CURRENT_DATE,
         CURRENT_DATE + INTERVAL '6 days',
         INTERVAL '1 day'
       )::date AS d
     )
     SELECT
       ds.d AS event_date,
       COALESCE(SUM(CASE WHEN co."status" = 'deposit_paid' THEN 1 ELSE 0 END), 0)::int AS deposit_paid,
       COALESCE(SUM(CASE WHEN co."status" = 'in_production' THEN 1 ELSE 0 END), 0)::int AS in_production,
       COALESCE(SUM(CASE WHEN co."status" = 'ready' THEN 1 ELSE 0 END), 0)::int AS ready
     FROM date_series ds
     LEFT JOIN "CakeOrder" co
       ON co."eventDate" = ds.d
       AND co."locationId" = ${locationId}
       AND co."deletedAt" IS NULL
       AND co."status" IN ('deposit_paid', 'in_production', 'ready')
     GROUP BY ds.d
     ORDER BY ds.d ASC`

  const days: ProductionDemandDay[] = rows.map(r => {
    const dateStr =
      r.event_date instanceof Date
        ? r.event_date.toISOString().split('T')[0]
        : String(r.event_date).split('T')[0]
    return {
      date: dateStr,
      counts: {
        deposit_paid: Number(r.deposit_paid),
        in_production: Number(r.in_production),
        ready: Number(r.ready),
      },
    }
  })

  return { days }
}
