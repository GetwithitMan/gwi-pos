/**
 * GET /api/reports/product-mix/[menuItemId]/variations/[fingerprint]
 *
 * Level 2 PMix modifier detail — returns per-modifier cost/frequency breakdown
 * for a specific variation (fingerprint) of a menu item.
 *
 * Called when the user clicks a variation row in the Level 1 PMix drilldown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import {
  computeVariationFingerprint,
  type TransformedOrderItem,
} from '@/lib/domain/reports/variation-fingerprint'

// Standard pre-modifier values — anything else is a custom pre-modifier
const STANDARD_PRE_MODIFIERS = new Set(['no', 'lite', 'extra', 'side'])

export const GET = withVenue(async (
  request: NextRequest,
  context: { params: Promise<{ menuItemId: string; fingerprint: string }> }
) => {
  try {
    const { menuItemId, fingerprint: requestedFingerprint } = await context.params
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    if (!menuItemId) {
      return NextResponse.json(
        { error: 'Menu item ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_PRODUCT_MIX)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Resolve venue timezone for correct date boundaries
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    // Build date filter — timezone-aware (same pattern as Level 1)
    const dateFilter: Record<string, Date> = {}
    if (startDate) {
      const range = dateRangeToUTC(startDate, endDate, timezone)
      dateFilter.gte = range.start
      if (endDate) {
        dateFilter.lte = range.end
      }
    } else {
      // Default to last 30 days
      dateFilter.gte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      if (endDate) {
        const range = dateRangeToUTC(endDate, null, timezone)
        dateFilter.lte = range.end
      }
    }

    // ── Step 1: Query all OrderItems for this menuItemId in the date range ──
    const orderItems = await db.orderItem.findMany({
      where: {
        menuItemId,
        order: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          isTraining: { not: true },
          parentOrderId: null,
          paidAt: dateFilter,
        },
        status: 'active',
      },
      include: {
        order: {
          select: {
            id: true,
            paidAt: true,
          },
        },
        menuItem: {
          select: {
            id: true,
            name: true,
            cost: true,
            category: {
              select: {
                id: true,
                name: true,
                categoryType: true,
              },
            },
          },
        },
        modifiers: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            price: true,
            preModifier: true,
            quantity: true,
            spiritTier: true,
            modifierId: true,
            linkedBottleProductId: true,
            linkedMenuItemName: true,
            isCustomEntry: true,
            customEntryName: true,
            isNoneSelection: true,
            swapTargetName: true,
          },
        },
        ingredientModifications: {
          select: {
            ingredientName: true,
            modificationType: true,
            swappedToModifierName: true,
          },
        },
      },
    })

    if (orderItems.length === 0) {
      return NextResponse.json({
        data: {
          fingerprint: requestedFingerprint,
          label: 'No data',
          quantitySold: 0,
          modifierDetails: [],
          salesByWeek: [],
        },
      })
    }

    const isLiquor = orderItems[0].menuItem.category.categoryType === 'liquor'
    const menuItemName = orderItems[0].menuItem.name

    // ── Step 2: Compute fingerprints for each item, filter to matching ──
    interface EnrichedItem {
      orderItem: typeof orderItems[number]
      fingerprint: string
    }
    const matchingItems: EnrichedItem[] = []

    for (const item of orderItems) {
      const transformed: TransformedOrderItem = {
        quantity: item.quantity,
        itemTotal: Number(item.itemTotal ?? 0),
        costAtSale: item.costAtSale != null ? Number(item.costAtSale) : null,
        pourSize: item.pourSize || null,
        modifiers: item.modifiers.map(m => ({
          name: m.name,
          preModifier: m.preModifier || null,
          spiritTier: m.spiritTier || null,
          isNoneSelection: m.isNoneSelection,
          isCustomEntry: m.isCustomEntry,
          customEntryName: m.customEntryName || null,
          swapTargetName: m.swapTargetName || null,
          quantity: m.quantity,
        })),
        ingredientModifications: item.ingredientModifications.map(i => ({
          ingredientName: i.ingredientName,
          modificationType: i.modificationType,
          swappedToModifierName: i.swappedToModifierName || null,
        })),
        modifierPrices: item.modifiers.map(m => ({
          name: m.name,
          price: Number(m.price) || 0,
          preModifier: m.preModifier || null,
          spiritTier: m.spiritTier || null,
        })),
      }

      const fp = computeVariationFingerprint(transformed)

      if (fp === requestedFingerprint) {
        matchingItems.push({
          orderItem: item,
          fingerprint: fp,
        })
      }
    }

    if (matchingItems.length === 0) {
      return NextResponse.json({
        data: {
          fingerprint: requestedFingerprint,
          label: 'Variation not found',
          quantitySold: 0,
          modifierDetails: [],
          salesByWeek: [],
        },
      })
    }

    // Build label from the first matching item's modifiers
    const firstItem = matchingItems[0].orderItem
    const labelParts: string[] = []
    if (firstItem.pourSize) labelParts.push(firstItem.pourSize.charAt(0).toUpperCase() + firstItem.pourSize.slice(1))
    for (const m of firstItem.modifiers) {
      if (m.isNoneSelection) continue
      const prefix = m.preModifier ? `${m.preModifier.charAt(0).toUpperCase() + m.preModifier.slice(1)} ` : ''
      const name = m.isCustomEntry ? (m.customEntryName || 'Custom') : m.name
      const tier = m.spiritTier ? ` (${m.spiritTier.replace('_', ' ')})` : ''
      const swap = m.swapTargetName ? ` sub ${m.swapTargetName}` : ''
      const qty = m.quantity > 1 ? ` x${m.quantity}` : ''
      labelParts.push(`${prefix}${name}${tier}${swap}${qty}`)
    }
    for (const im of firstItem.ingredientModifications) {
      if (im.modificationType === 'standard') continue
      const swap = im.swappedToModifierName ? ` for ${im.swappedToModifierName}` : ''
      labelParts.push(`${im.modificationType} ${im.ingredientName}${swap}`)
    }
    const variationLabel = labelParts.length === 0 ? 'Standard (no modifications)' : labelParts.join(', ')
    const quantitySold = matchingItems.reduce((sum, m) => sum + m.orderItem.quantity, 0)

    // ── Step 3: Collect all unique modifierIds for cost lookup ──
    const modifierIds = new Set<string>()
    const bottleProductIds = new Set<string>()
    for (const { orderItem } of matchingItems) {
      for (const mod of orderItem.modifiers) {
        if (mod.modifierId) modifierIds.add(mod.modifierId)
        if (mod.linkedBottleProductId) bottleProductIds.add(mod.linkedBottleProductId)
      }
    }

    // Batch-load Modifier records for cost data
    const modifierCostMap = new Map<string, number>()
    if (modifierIds.size > 0) {
      const modifiers = await db.modifier.findMany({
        where: { id: { in: [...modifierIds] } },
        select: { id: true, cost: true },
      })
      for (const m of modifiers) {
        modifierCostMap.set(m.id, m.cost ? Number(m.cost) : 0)
      }
    }

    // Batch-load BottleProduct records for pour cost data
    const bottleCostMap = new Map<string, { pourCost: number; name: string; tier: string }>()
    if (bottleProductIds.size > 0) {
      const bottles = await db.bottleProduct.findMany({
        where: { id: { in: [...bottleProductIds] } },
        select: { id: true, name: true, tier: true, pourCost: true },
      })
      for (const b of bottles) {
        bottleCostMap.set(b.id, {
          pourCost: b.pourCost ? Number(b.pourCost) : 0,
          name: b.name,
          tier: b.tier,
        })
      }
    }

    // ── Step 4: Aggregate per-modifier detail ──
    interface ModifierAgg {
      modifierName: string
      preModifier: string | null
      spiritTier: string | null
      totalPriceCharged: number
      totalCost: number
      frequency: number
      weekCounts: Map<string, number>
    }
    const modAggMap = new Map<string, ModifierAgg>()

    for (const { orderItem } of matchingItems) {
      for (const mod of orderItem.modifiers) {
        if (mod.isNoneSelection) continue

        // Build a composite key: name + preModifier + spiritTier
        const key = `${mod.name}|${mod.preModifier || ''}|${mod.spiritTier || ''}`
        const priceCharged = Number(mod.price) * mod.quantity
        const qty = mod.quantity

        // Determine cost per unit
        let costPerUnit = 0
        if (mod.linkedBottleProductId && bottleCostMap.has(mod.linkedBottleProductId)) {
          costPerUnit = bottleCostMap.get(mod.linkedBottleProductId)!.pourCost
        } else if (mod.modifierId && modifierCostMap.has(mod.modifierId)) {
          costPerUnit = modifierCostMap.get(mod.modifierId)!
        }

        // Compute ISO week start for trend
        const paidAt = orderItem.order.paidAt
        const weekStart = paidAt ? getISOWeekStart(new Date(paidAt)) : 'unknown'

        const existing = modAggMap.get(key)
        if (existing) {
          existing.totalPriceCharged += priceCharged
          existing.totalCost += costPerUnit * qty
          existing.frequency += qty
          existing.weekCounts.set(weekStart, (existing.weekCounts.get(weekStart) || 0) + qty)
        } else {
          const weekCounts = new Map<string, number>()
          weekCounts.set(weekStart, qty)
          modAggMap.set(key, {
            modifierName: mod.name,
            preModifier: mod.preModifier || null,
            spiritTier: mod.spiritTier || null,
            totalPriceCharged: priceCharged,
            totalCost: costPerUnit * qty,
            frequency: qty,
            weekCounts,
          })
        }
      }
    }

    // Build modifierDetails array
    const modifierDetails = Array.from(modAggMap.values())
      .map(agg => ({
        modifierName: agg.modifierName,
        preModifier: agg.preModifier,
        spiritTier: agg.spiritTier,
        avgPriceCharged: agg.frequency > 0
          ? Math.round((agg.totalPriceCharged / agg.frequency) * 100) / 100
          : 0,
        totalRevenue: Math.round(agg.totalPriceCharged * 100) / 100,
        estimatedCostPerUnit: agg.frequency > 0
          ? Math.round((agg.totalCost / agg.frequency) * 100) / 100
          : 0,
        totalCost: Math.round(agg.totalCost * 100) / 100,
        frequency: agg.frequency,
        frequencyPercent: quantitySold > 0
          ? Math.round((agg.frequency / quantitySold) * 1000) / 10
          : 0,
        trendByWeek: Array.from(agg.weekCounts.entries())
          .filter(([w]) => w !== 'unknown')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([weekStart, count]) => ({ weekStart, count })),
      }))
      .sort((a, b) => b.frequency - a.frequency)

    // ── Step 5: Liquor detail (if applicable) ──
    let liquorDetail: {
      pourSizeBreakdown: Array<{ pourSize: string; count: number; avgPrice: number; totalOunces: number; avgOuncesPerDrink: number }>
      totalOuncesPoured: number
      tierBreakdown: Array<{ tier: string; count: number; avgPrice: number; avgCost: number }>
      bottleUsage: Array<{ bottleName: string; count: number; estimatedPourCost: number }>
    } | undefined

    if (isLiquor) {
      // Pour size breakdown from OrderItem level
      const basePourOz = 1.5
      const pourMap = new Map<string, { count: number; totalPrice: number; totalOunces: number }>()
      for (const { orderItem } of matchingItems) {
        const ps = orderItem.pourSize || 'shot'
        const existing = pourMap.get(ps)
        const price = Number(orderItem.price)
        const multiplier = Number(orderItem.pourMultiplier) || 1.0
        const oz = basePourOz * multiplier * orderItem.quantity
        if (existing) {
          existing.count += orderItem.quantity
          existing.totalPrice += price * orderItem.quantity
          existing.totalOunces += oz
        } else {
          pourMap.set(ps, { count: orderItem.quantity, totalPrice: price * orderItem.quantity, totalOunces: oz })
        }
      }
      const pourSizeBreakdown = Array.from(pourMap.entries())
        .map(([pourSize, { count, totalPrice, totalOunces }]) => ({
          pourSize,
          count,
          avgPrice: count > 0 ? Math.round((totalPrice / count) * 100) / 100 : 0,
          totalOunces: Math.round(totalOunces * 100) / 100,
          avgOuncesPerDrink: count > 0 ? Math.round((totalOunces / count) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)
      const totalOuncesPoured = Math.round(pourSizeBreakdown.reduce((s, p) => s + p.totalOunces, 0) * 100) / 100

      // Tier breakdown from modifiers with spiritTier
      const tierMap = new Map<string, { count: number; totalPrice: number; totalCost: number }>()
      for (const { orderItem } of matchingItems) {
        for (const mod of orderItem.modifiers) {
          if (!mod.spiritTier) continue
          const tier = mod.spiritTier
          const price = Number(mod.price) * mod.quantity
          let cost = 0
          if (mod.linkedBottleProductId && bottleCostMap.has(mod.linkedBottleProductId)) {
            cost = bottleCostMap.get(mod.linkedBottleProductId)!.pourCost * mod.quantity
          }

          const existing = tierMap.get(tier)
          if (existing) {
            existing.count += mod.quantity
            existing.totalPrice += price
            existing.totalCost += cost
          } else {
            tierMap.set(tier, { count: mod.quantity, totalPrice: price, totalCost: cost })
          }
        }
      }
      const tierBreakdown = Array.from(tierMap.entries())
        .map(([tier, { count, totalPrice, totalCost }]) => ({
          tier,
          count,
          avgPrice: count > 0 ? Math.round((totalPrice / count) * 100) / 100 : 0,
          avgCost: count > 0 ? Math.round((totalCost / count) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.count - a.count)

      // Bottle usage from modifiers with linkedBottleProductId
      const bottleMap = new Map<string, { name: string; count: number; totalPourCost: number }>()
      for (const { orderItem } of matchingItems) {
        for (const mod of orderItem.modifiers) {
          if (!mod.linkedBottleProductId) continue
          const bottleInfo = bottleCostMap.get(mod.linkedBottleProductId)
          const bottleName = bottleInfo?.name || mod.linkedMenuItemName || mod.name
          const pourCost = bottleInfo?.pourCost || 0

          const existing = bottleMap.get(mod.linkedBottleProductId)
          if (existing) {
            existing.count += mod.quantity
            existing.totalPourCost += pourCost * mod.quantity
          } else {
            bottleMap.set(mod.linkedBottleProductId, {
              name: bottleName,
              count: mod.quantity,
              totalPourCost: pourCost * mod.quantity,
            })
          }
        }
      }
      const bottleUsage = Array.from(bottleMap.values())
        .map(b => ({
          bottleName: b.name,
          count: b.count,
          estimatedPourCost: Math.round(b.totalPourCost * 100) / 100,
        }))
        .sort((a, b) => b.count - a.count)

      liquorDetail = { pourSizeBreakdown, totalOuncesPoured, tierBreakdown, bottleUsage }
    }

    // ── Step 6: Sales by week (overall for this variation) ──
    const weekSalesMap = new Map<string, { quantity: number; revenue: number }>()
    for (const { orderItem } of matchingItems) {
      const paidAt = orderItem.order.paidAt
      if (!paidAt) continue
      const weekStart = getISOWeekStart(new Date(paidAt))
      const existing = weekSalesMap.get(weekStart)
      const revenue = Number(orderItem.itemTotal)
      if (existing) {
        existing.quantity += orderItem.quantity
        existing.revenue += revenue
      } else {
        weekSalesMap.set(weekStart, { quantity: orderItem.quantity, revenue })
      }
    }
    const salesByWeek = Array.from(weekSalesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, data]) => ({
        weekStart,
        quantity: data.quantity,
        revenue: Math.round(data.revenue * 100) / 100,
      }))

    // ── Build response ──
    const response: Record<string, unknown> = {
      fingerprint: requestedFingerprint,
      label: variationLabel,
      menuItemName,
      quantitySold,
      modifierDetails,
      salesByWeek,
    }

    if (liquorDetail) {
      response.liquorDetail = liquorDetail
    }

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to generate PMix modifier detail report:', error)
    return NextResponse.json(
      { error: 'Failed to generate PMix modifier detail report' },
      { status: 500 }
    )
  }
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the ISO week start (Monday) for a given date, formatted as YYYY-MM-DD.
 */
function getISOWeekStart(date: Date): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  // ISO week starts on Monday (1). Sunday (0) maps to the previous Monday.
  const diff = day === 0 ? 6 : day - 1
  d.setUTCDate(d.getUTCDate() - diff)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dayStr = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${dayStr}`
}
