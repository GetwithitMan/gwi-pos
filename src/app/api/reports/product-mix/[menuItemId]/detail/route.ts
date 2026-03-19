import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { computeVariationFingerprint, type TransformedOrderItem } from '@/lib/domain/reports/variation-fingerprint'

/**
 * Level 2 drilldown: modifier detail for a specific variation fingerprint of a menu item.
 * Returns per-modifier stats (frequency, price, cost impact) and weekly sparkline data.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ menuItemId: string }> }
) {
  try {
    const { menuItemId } = await params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const fingerprint = searchParams.get('fingerprint')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId || !fingerprint) {
      return NextResponse.json({ error: 'locationId and fingerprint are required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_PRODUCT_MIX)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    const dateFilter: Record<string, Date> = {}
    if (startDate) {
      const range = dateRangeToUTC(startDate, endDate, timezone)
      dateFilter.gte = range.start
      if (endDate) dateFilter.lte = range.end
    } else {
      dateFilter.gte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }

    const orderItems = await db.orderItem.findMany({
      where: {
        menuItemId,
        order: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          parentOrderId: null,
          paidAt: dateFilter,
        },
        status: 'active',
      },
      include: {
        order: { select: { paidAt: true } },
        menuItem: { select: { cost: true, price: true } },
        modifiers: {
          select: {
            name: true,
            preModifier: true,
            spiritTier: true,
            isNoneSelection: true,
            isCustomEntry: true,
            customEntryName: true,
            swapTargetName: true,
            quantity: true,
            price: true,
            modifierId: true,
            linkedMenuItemId: true,
          },
        },
        ingredientModifications: {
          select: { ingredientName: true, modificationType: true, swappedToModifierName: true },
        },
      },
    })

    // Build TransformedOrderItem for each and filter by fingerprint
    type OI = typeof orderItems[number]
    const matchingItems: OI[] = []

    for (const oi of orderItems) {
      const transformed: TransformedOrderItem = {
        quantity: oi.quantity,
        itemTotal: Number(oi.itemTotal ?? 0),
        costAtSale: oi.costAtSale != null ? Number(oi.costAtSale) : null,
        pourSize: oi.pourSize,
        modifiers: oi.modifiers.map(m => ({
          name: m.name,
          preModifier: m.preModifier,
          spiritTier: m.spiritTier,
          isNoneSelection: m.isNoneSelection ?? false,
          isCustomEntry: m.isCustomEntry ?? false,
          customEntryName: m.customEntryName,
          swapTargetName: m.swapTargetName,
          quantity: m.quantity || 1,
        })),
        ingredientModifications: oi.ingredientModifications.map(im => ({
          ingredientName: im.ingredientName,
          modificationType: im.modificationType,
          swappedToModifierName: im.swappedToModifierName,
        })),
        modifierPrices: oi.modifiers.map(m => ({
          name: m.name,
          price: Number(m.price) || 0,
          preModifier: m.preModifier,
          spiritTier: m.spiritTier,
        })),
      }

      const fp = computeVariationFingerprint(transformed)
      if (fp === fingerprint) {
        matchingItems.push(oi)
      }
    }

    if (matchingItems.length === 0) {
      return NextResponse.json({ data: { modifiers: [], weeklySparkline: [], liquor: null } })
    }

    // Batch-load modifier cost data
    const modifierIds = new Set<string>()
    for (const oi of matchingItems) {
      for (const mod of oi.modifiers) {
        if (mod.modifierId) modifierIds.add(mod.modifierId)
      }
    }
    const modCostMap = new Map<string, number>()
    if (modifierIds.size > 0) {
      const modRecords = await db.modifier.findMany({
        where: { id: { in: [...modifierIds] } },
        select: { id: true, cost: true },
      })
      for (const m of modRecords) {
        modCostMap.set(m.id, m.cost ? Number(m.cost) : 0)
      }
    }

    // ── Per-modifier aggregation ────────────────────────────────────────
    const modMap = new Map<string, {
      name: string
      preModifier: string | null
      spiritTier: string | null
      totalPrice: number
      totalCost: number
      count: number
      isLiquor: boolean
      pourSizes: Record<string, number>
      pourSizeOunces: Record<string, number>
      totalOunces: number
      weeklyBuckets: Record<string, number>
    }>()

    // Build weekly sparkline buckets
    const weeklyTotalBuckets: Record<string, number> = {}

    for (const oi of matchingItems) {
      const weekKey = oi.order.paidAt
        ? getWeekKey(new Date(oi.order.paidAt))
        : 'unknown'
      weeklyTotalBuckets[weekKey] = (weeklyTotalBuckets[weekKey] || 0) + oi.quantity

      const basePourOz = 1.5
      const pourMultiplier = Number(oi.pourMultiplier) || 1.0
      const itemOunces = basePourOz * pourMultiplier * oi.quantity

      for (const mod of oi.modifiers) {
        if (mod.isNoneSelection) continue
        const key = `${mod.name}|${mod.preModifier || ''}|${mod.spiritTier || ''}`
        const existing = modMap.get(key)
        const modPrice = Number(mod.price) || 0
        const modCost = mod.modifierId ? (modCostMap.get(mod.modifierId) || 0) : 0
        const isLiquor = mod.spiritTier != null

        if (existing) {
          existing.totalPrice += modPrice * oi.quantity
          existing.totalCost += modCost * oi.quantity
          existing.count += oi.quantity
          if (isLiquor && oi.pourSize) {
            existing.pourSizes[oi.pourSize] = (existing.pourSizes[oi.pourSize] || 0) + oi.quantity
            existing.pourSizeOunces[oi.pourSize] = (existing.pourSizeOunces[oi.pourSize] || 0) + itemOunces
          }
          if (isLiquor) existing.totalOunces += itemOunces
          existing.weeklyBuckets[weekKey] = (existing.weeklyBuckets[weekKey] || 0) + oi.quantity
        } else {
          const pourSizes: Record<string, number> = {}
          const pourSizeOunces: Record<string, number> = {}
          if (isLiquor && oi.pourSize) {
            pourSizes[oi.pourSize] = oi.quantity
            pourSizeOunces[oi.pourSize] = itemOunces
          }
          modMap.set(key, {
            name: mod.name,
            preModifier: mod.preModifier,
            spiritTier: mod.spiritTier,
            totalPrice: modPrice * oi.quantity,
            totalCost: modCost * oi.quantity,
            count: oi.quantity,
            isLiquor,
            pourSizes,
            pourSizeOunces,
            totalOunces: isLiquor ? itemOunces : 0,
            weeklyBuckets: { [weekKey]: oi.quantity },
          })
        }
      }
    }

    const totalCount = matchingItems.reduce((s, i) => s + i.quantity, 0)

    // Sort weeks chronologically
    const allWeeks = [...new Set([
      ...Object.keys(weeklyTotalBuckets),
      ...Array.from(modMap.values()).flatMap(m => Object.keys(m.weeklyBuckets)),
    ])].filter(w => w !== 'unknown').sort()

    const modifiers = Array.from(modMap.values())
      .map(m => ({
        name: m.name,
        preModifier: m.preModifier,
        spiritTier: m.spiritTier,
        avgPrice: m.count > 0 ? Math.round((m.totalPrice / m.count) * 100) / 100 : 0,
        avgCost: m.count > 0 ? Math.round((m.totalCost / m.count) * 100) / 100 : 0,
        frequency: m.count,
        frequencyPct: totalCount > 0 ? Math.round((m.count / totalCount) * 1000) / 10 : 0,
        isLiquor: m.isLiquor,
        pourSizes: m.isLiquor ? m.pourSizes : undefined,
        pourSizeOunces: m.isLiquor ? m.pourSizeOunces : undefined,
        totalOunces: m.isLiquor ? Math.round(m.totalOunces * 100) / 100 : undefined,
        weeklySparkline: allWeeks.map(w => m.weeklyBuckets[w] || 0),
      }))
      .sort((a, b) => b.frequency - a.frequency)

    // Liquor-specific: tier distribution
    const liquorMods = modifiers.filter(m => m.isLiquor)
    let liquor = null
    if (liquorMods.length > 0) {
      const tierCounts: Record<string, number> = {}
      for (const m of liquorMods) {
        const tier = m.spiritTier || 'well'
        tierCounts[tier] = (tierCounts[tier] || 0) + m.frequency
      }
      liquor = {
        tierDistribution: tierCounts,
        totalPours: liquorMods.reduce((s, m) => s + m.frequency, 0),
        totalOuncesPoured: Math.round(liquorMods.reduce((s, m) => s + (m.totalOunces || 0), 0) * 100) / 100,
      }
    }

    const weeklySparkline = allWeeks.map(w => ({
      week: w,
      count: weeklyTotalBuckets[w] || 0,
    }))

    return NextResponse.json({
      data: {
        modifiers,
        weeklySparkline,
        liquor,
        weekLabels: allWeeks,
      },
    })
  } catch (error) {
    console.error('Failed to fetch variation detail:', error)
    return NextResponse.json({ error: 'Failed to fetch variation detail' }, { status: 500 })
  }
})

function getWeekKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}
