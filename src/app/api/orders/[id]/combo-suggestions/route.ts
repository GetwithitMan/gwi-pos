/**
 * GET /api/orders/[id]/combo-suggestions
 *
 * Check if current order items match any combo templates for savings.
 * Returns an array of suggestions with matched items and savings amounts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { findMatchingCombos, type MatcherComboTemplate, type MatcherOrderItem } from '@/lib/combo-matcher'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Load order with active items + location settings
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        status: true,
        location: {
          select: { settings: true },
        },
        items: {
          where: {
            deletedAt: null,
            status: 'active',
          },
          select: {
            id: true,
            menuItemId: true,
            name: true,
            price: true,
            quantity: true,
            status: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Check if combo auto-suggest is enabled (default: true)
    const settings = parseSettings(order.location?.settings)
    if (settings.comboAutoSuggest === false) {
      return NextResponse.json({ data: { suggestions: [] } })
    }

    // Need at least 2 items to form a combo
    if (order.items.length < 2) {
      return NextResponse.json({ data: { suggestions: [] } })
    }

    // Load active combo templates for this location
    const comboTemplates = await db.comboTemplate.findMany({
      where: {
        locationId: order.locationId,
        deletedAt: null,
        menuItem: {
          isActive: true,
          isAvailable: true,
          deletedAt: null,
        },
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
            isAvailable: true,
          },
        },
        components: {
          where: {
            deletedAt: null,
          },
          include: {
            options: {
              where: { deletedAt: null },
              select: { menuItemId: true },
            },
          },
        },
      },
    })

    if (comboTemplates.length === 0) {
      return NextResponse.json({ data: { suggestions: [] } })
    }

    // Map to matcher types
    const matcherItems: MatcherOrderItem[] = order.items.map(item => ({
      id: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      price: Number(item.price),
      quantity: item.quantity,
      status: item.status ?? 'active',
    }))

    const matcherTemplates: MatcherComboTemplate[] = comboTemplates.map(t => ({
      id: t.id,
      menuItemId: t.menuItemId,
      comboName: t.menuItem.name,
      basePrice: Number(t.basePrice),
      components: t.components.map(c => ({
        id: c.id,
        slotName: c.slotName,
        displayName: c.displayName,
        isRequired: c.isRequired,
        menuItemId: c.menuItemId,
        options: c.options.map(o => ({ menuItemId: o.menuItemId })),
      })),
    }))

    // Run the pure matcher
    const matches = findMatchingCombos(matcherItems, matcherTemplates)

    return NextResponse.json({
      data: {
        suggestions: matches.map(m => ({
          comboTemplateId: m.comboTemplateId,
          comboName: m.comboName,
          menuItemId: m.menuItemId,
          basePrice: m.basePrice,
          savings: m.savings,
          matchedItemIds: m.matchedItems.map(i => i.id),
          matchedItems: m.matchedItems.map(i => ({
            id: i.id,
            name: i.name,
            price: i.price,
          })),
        })),
      },
    })
  } catch (error) {
    console.error('[combo-suggestions] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to check combo suggestions' },
      { status: 500 }
    )
  }
})
