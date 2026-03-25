import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { groupByVariation, computeVariationFingerprint } from '@/lib/domain/reports/variation-fingerprint'
import type { TransformedOrderItem } from '@/lib/domain/reports/variation-fingerprint'

// GET /api/reports/product-mix/[menuItemId]/variations
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
    const pricingOptionLabel = searchParams.get('pricingOptionLabel')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
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

    // Build date filter — timezone-aware (same pattern as parent PMix route)
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

    // Query order items for this specific menu item
    const orderItems = await db.orderItem.findMany({
      where: {
        menuItemId,
        status: 'active',
        deletedAt: null,
        order: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          isTraining: { not: true },
          parentOrderId: null,
          paidAt: dateFilter,
          deletedAt: null,
        },
        ...(pricingOptionLabel ? { pricingOptionLabel } : {}),
      },
      include: {
        order: {
          select: {
            paidAt: true,
            orderType: true,
          },
        },
        menuItem: {
          select: {
            name: true,
            cost: true,
            price: true,
            categoryId: true,
            category: {
              select: {
                name: true,
                categoryType: true,
              },
            },
          },
        },
        modifiers: {
          where: { deletedAt: null },
          select: {
            name: true,
            price: true,
            preModifier: true,
            spiritTier: true,
            isNoneSelection: true,
            isCustomEntry: true,
            customEntryName: true,
            swapTargetName: true,
            quantity: true,
            modifierId: true,
            linkedBottleProductId: true,
            linkedMenuItemName: true,
          },
        },
        ingredientModifications: {
          where: { deletedAt: null },
          select: {
            ingredientName: true,
            modificationType: true,
            swappedToModifierName: true,
            priceAdjustment: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (orderItems.length === 0) {
      return NextResponse.json({
        data: {
          menuItemId,
          menuItemName: '',
          categoryName: '',
          categoryType: '',
          totalSold: 0,
          totalRevenue: 0,
          totalCost: 0,
          variations: [],
          insights: null,
        },
      })
    }

    const menuItem = orderItems[0].menuItem
    const baseItemCost = Number(menuItem?.cost) || 0

    // Transform order items for fingerprinting
    const transformedItems: TransformedOrderItem[] = orderItems.map(oi => ({
      quantity: oi.quantity,
      itemTotal: Number(oi.itemTotal || oi.price),
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
      ingredientModifications: (oi.ingredientModifications || []).map(im => ({
        ingredientName: im.ingredientName,
        modificationType: im.modificationType,
        swappedToModifierName: im.swappedToModifierName,
      })),
      modifierPrices: oi.modifiers.map(m => ({
        name: m.name,
        price: Number(m.price),
        preModifier: m.preModifier,
        spiritTier: m.spiritTier,
      })),
    }))

    // Group by variation fingerprint
    const variations = groupByVariation(transformedItems, baseItemCost)

    const totalSold = variations.reduce((s, v) => s + v.quantitySold, 0)

    // Compute ounces per variation for liquor/drinks items
    const categoryType = menuItem?.category?.categoryType || ''
    const isLiquorOrDrinks = categoryType === 'liquor' || categoryType === 'drinks'
    const ouncesPerFingerprint = new Map<string, number>()
    if (isLiquorOrDrinks) {
      const basePourOz = 1.5
      for (let i = 0; i < transformedItems.length; i++) {
        const fp = computeVariationFingerprint(transformedItems[i])
        const multiplier = Number(orderItems[i].pourMultiplier) || 1.0
        const oz = basePourOz * multiplier * orderItems[i].quantity
        ouncesPerFingerprint.set(fp, (ouncesPerFingerprint.get(fp) || 0) + oz)
      }
    }

    // Add percentOfTotal and ounces to each variation
    const variationsWithPercent = variations.map(v => {
      const totalOunces = isLiquorOrDrinks
        ? Math.round((ouncesPerFingerprint.get(v.fingerprint) || 0) * 100) / 100
        : null
      return {
        ...v,
        percentOfTotal: totalSold > 0 ? Math.round((v.quantitySold / totalSold) * 1000) / 10 : 0,
        totalOunces,
        avgOuncesPerDrink: totalOunces != null && v.quantitySold > 0
          ? Math.round((totalOunces / v.quantitySold) * 100) / 100
          : null,
      }
    })

    // Compute insights
    const standardVariation = variations.find(v => v.fingerprint === 'standard')
    const insights = {
      mostPopularVariation: variations[0]?.fingerprint || 'standard',
      mostPopularLabel: variations[0]?.label || 'Standard (no modifications)',
      highestMarginVariation: [...variations].sort((a, b) => b.margin - a.margin)[0]?.fingerprint || 'standard',
      highestMarginLabel: [...variations].sort((a, b) => b.margin - a.margin)[0]?.label || 'Standard (no modifications)',
      lowestMarginVariation: [...variations].sort((a, b) => a.margin - b.margin)[0]?.fingerprint || 'standard',
      lowestMarginLabel: [...variations].sort((a, b) => a.margin - b.margin)[0]?.label || 'Standard (no modifications)',
      standardOrderPercent: standardVariation && totalSold > 0
        ? Math.round((standardVariation.quantitySold / totalSold) * 100)
        : 0,
      uniqueVariations: variations.length,
    }

    // Total ounces across all variations
    const totalOuncesPoured = isLiquorOrDrinks
      ? Math.round(variationsWithPercent.reduce((s, v) => s + (v.totalOunces || 0), 0) * 100) / 100
      : null

    return NextResponse.json({
      data: {
        menuItemId,
        menuItemName: menuItem?.name || '',
        categoryName: menuItem?.category?.name || '',
        categoryType: menuItem?.category?.categoryType || '',
        totalSold,
        totalRevenue: Math.round(variations.reduce((s, v) => s + v.totalRevenue, 0) * 100) / 100,
        totalCost: Math.round(variations.reduce((s, v) => s + v.totalCost, 0) * 100) / 100,
        totalOuncesPoured,
        variations: variationsWithPercent,
        insights,
        dateRange: {
          start: dateFilter.gte,
          end: dateFilter.lte || new Date(),
        },
      },
    })
  } catch (error) {
    console.error('Failed to generate product mix variations report:', error)
    return NextResponse.json(
      { error: 'Failed to generate product mix variations report' },
      { status: 500 }
    )
  }
})
