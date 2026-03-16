/**
 * POST /api/orders/[id]/apply-combo
 *
 * Convert matched individual order items into a combo item.
 * Removes individual items (status='removed') and adds a new combo OrderItem
 * at the combo's basePrice, preserving modifiers from the removed items.
 * Recalculates order totals and emits order events + socket dispatches.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import {
  calculateItemTotal,
  calculateOrderTotals,
  calculateOrderSubtotal,
  isItemTaxInclusive,
  recalculatePercentDiscounts,
  type LocationTaxSettings,
} from '@/lib/order-calculations'
import { calculateCardPrice } from '@/lib/pricing'
import { parseSettings } from '@/lib/settings'
import {
  dispatchOpenOrdersChanged,
  dispatchOrderTotalsUpdate,
  dispatchOrderSummaryUpdated,
  buildOrderSummary,
} from '@/lib/socket-dispatch'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { comboTemplateId, itemIds } = body as {
      comboTemplateId: string
      itemIds: string[]
    }

    if (!comboTemplateId || !itemIds?.length) {
      return NextResponse.json(
        { error: 'comboTemplateId and itemIds are required' },
        { status: 400 }
      )
    }

    const result = await db.$transaction(async (tx) => {
      // Lock the order row
      const [lockedOrder] = await tx.$queryRaw<any[]>`
        SELECT id, status, "locationId" FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `
      if (!lockedOrder) {
        throw new Error('ORDER_NOT_FOUND')
      }
      if (!['open', 'draft', 'in_progress', 'sent'].includes(lockedOrder.status)) {
        throw new Error('ORDER_NOT_MODIFIABLE')
      }

      // Load order with location settings
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          location: { select: { settings: true } },
          payments: {
            where: { deletedAt: null },
            select: { id: true, status: true },
          },
        },
      })

      // Block if active payments exist
      const hasActivePayment = order.payments?.some(
        p => p.status === 'completed' || p.status === 'pending'
      )
      if (hasActivePayment) {
        throw new Error('ORDER_HAS_PAYMENTS')
      }

      // Load the combo template
      const template = await tx.comboTemplate.findUnique({
        where: { id: comboTemplateId },
        include: {
          menuItem: {
            select: {
              id: true,
              name: true,
              price: true,
              isActive: true,
              isAvailable: true,
              itemType: true,
              category: { select: { categoryType: true } },
            },
          },
          components: {
            where: { deletedAt: null },
          },
        },
      })

      if (!template || !template.menuItem) {
        throw new Error('COMBO_NOT_FOUND')
      }
      if (!template.menuItem.isActive || !template.menuItem.isAvailable) {
        throw new Error('COMBO_UNAVAILABLE')
      }

      // Load the items to be replaced
      const itemsToReplace = await tx.orderItem.findMany({
        where: {
          id: { in: itemIds },
          orderId,
          deletedAt: null,
          status: 'active',
        },
        include: {
          modifiers: { where: { deletedAt: null } },
        },
      })

      if (itemsToReplace.length !== itemIds.length) {
        throw new Error('ITEMS_NOT_FOUND')
      }

      // Block if any item has been sent to kitchen
      const sentItem = itemsToReplace.find(i => i.kitchenStatus !== 'pending')
      if (sentItem) {
        throw new Error('ITEMS_ALREADY_SENT')
      }

      // Soft-delete the individual items (status='removed')
      const now = new Date()
      for (const item of itemsToReplace) {
        await tx.orderItemModifier.updateMany({
          where: { orderItemId: item.id },
          data: { deletedAt: now },
        })
        await tx.orderItem.update({
          where: { id: item.id },
          data: { deletedAt: now, status: 'removed' },
        })
      }

      // Collect modifiers from the removed items to carry onto the combo
      const carryModifiers = itemsToReplace.flatMap(item =>
        item.modifiers.map(m => ({
          locationId: order.locationId,
          modifierId: m.modifierId,
          name: m.name,
          price: m.price,
          quantity: m.quantity,
          preModifier: m.preModifier,
          depth: m.depth,
          spiritTier: m.spiritTier,
          linkedBottleProductId: m.linkedBottleProductId,
        }))
      )

      // Derive pricing settings
      const locSettings = parseSettings(order.location.settings)
      const dualPricingEnabled = locSettings?.dualPricing?.enabled ?? false
      const cashDiscountPct = locSettings?.dualPricing?.cashDiscountPercent ?? 4.0

      // Tax-inclusive check
      const catType = template.menuItem.category?.categoryType ?? null
      const [taxRules, allCategories] = await Promise.all([
        tx.taxRule.findMany({
          where: { locationId: order.locationId, isActive: true, isInclusive: true, deletedAt: null },
          select: { appliesTo: true, categoryIds: true },
        }),
        tx.category.findMany({
          where: { locationId: order.locationId, deletedAt: null },
          select: { id: true, categoryType: true },
        }),
      ])
      let taxInclusiveLiquor = false
      let taxInclusiveFood = false
      for (const rule of taxRules) {
        if (rule.appliesTo === 'all') { taxInclusiveLiquor = true; taxInclusiveFood = true; break }
        if (rule.appliesTo === 'category' && rule.categoryIds) {
          for (const cat of allCategories) {
            if ((rule.categoryIds as string[]).includes(cat.id)) {
              if (cat.categoryType && ['liquor', 'drinks'].includes(cat.categoryType)) taxInclusiveLiquor = true
              if (cat.categoryType && ['food', 'pizza', 'combos'].includes(cat.categoryType)) taxInclusiveFood = true
            }
          }
        }
      }
      const itemTaxInclusive = isItemTaxInclusive(catType ?? undefined, { taxInclusiveLiquor, taxInclusiveFood })

      // Create the combo OrderItem
      const comboPrice = Number(template.basePrice)
      const comboItemTotal = calculateItemTotal({
        price: comboPrice,
        quantity: 1,
        modifiers: carryModifiers.map(m => ({ price: Number(m.price) })),
      })

      const comboItem = await tx.orderItem.create({
        data: {
          orderId,
          locationId: order.locationId,
          menuItemId: template.menuItemId,
          name: template.menuItem.name,
          price: comboPrice,
          cardPrice: dualPricingEnabled ? calculateCardPrice(comboPrice, cashDiscountPct) : null,
          isTaxInclusive: itemTaxInclusive,
          categoryType: catType,
          quantity: 1,
          itemTotal: comboItemTotal,
          lastMutatedBy: 'local',
          modifiers: {
            create: carryModifiers.map(m => ({
              locationId: m.locationId,
              modifierId: m.modifierId,
              name: m.name,
              price: m.price,
              quantity: m.quantity,
              preModifier: m.preModifier,
              depth: m.depth,
              spiritTier: m.spiritTier,
              linkedBottleProductId: m.linkedBottleProductId,
            })),
          },
        },
        include: {
          modifiers: true,
        },
      })

      // Recalculate order totals from remaining active items
      const allActiveItems = await tx.orderItem.findMany({
        where: { orderId, deletedAt: null, status: 'active' },
        include: {
          modifiers: { where: { deletedAt: null } },
          ingredientModifications: true,
        },
      })

      const itemsForCalc = allActiveItems.map(i => ({
        ...i,
        price: Number(i.price),
        itemTotal: Number(i.itemTotal),
        commissionAmount: i.commissionAmount ? Number(i.commissionAmount) : undefined,
        weight: i.weight ? Number(i.weight) : undefined,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
        soldByWeight: i.soldByWeight ?? false,
        modifiers: i.modifiers.map(m => ({ ...m, price: Number(m.price) })),
        ingredientModifications: i.ingredientModifications.map(ing => ({
          ...ing,
          priceAdjustment: Number(ing.priceAdjustment),
        })),
      }))

      const newSubtotalForDiscounts = calculateOrderSubtotal(itemsForCalc)
      const updatedDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotalForDiscounts)

      const totals = calculateOrderTotals(
        itemsForCalc,
        order.location.settings as LocationTaxSettings | null,
        updatedDiscountTotal,
        Number(order.tipTotal) || 0,
        locSettings?.priceRounding ?? undefined,
        'card',
        order.isTaxExempt,
        Number(order.inclusiveTaxRate) || undefined
      )

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          taxFromInclusive: totals.taxFromInclusive,
          taxFromExclusive: totals.taxFromExclusive,
          total: totals.total,
          commissionTotal: totals.commissionTotal,
          itemCount: allActiveItems.reduce((sum, i) => sum + i.quantity, 0),
          version: { increment: 1 },
          lastMutatedBy: 'local',
        },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId: order.employeeId,
          action: 'combo_applied',
          entityType: 'order',
          entityId: orderId,
          details: {
            comboTemplateId,
            comboName: template.menuItem.name,
            replacedItems: itemsToReplace.map(i => ({ id: i.id, name: i.name, price: Number(i.price) })),
            comboItemId: comboItem.id,
            comboPrice,
            savings: itemsToReplace.reduce((sum, i) => sum + Number(i.price), 0) - comboPrice,
          },
        },
      })

      return {
        updatedOrder,
        comboItem,
        removedItems: itemsToReplace,
        locationId: order.locationId,
      }
    })

    // Fire-and-forget: emit order events
    void emitOrderEvents(result.locationId, orderId, [
      // ITEM_REMOVED for each replaced item
      ...result.removedItems.map(item => ({
        type: 'ITEM_REMOVED' as const,
        payload: { lineItemId: item.id },
      })),
      // ITEM_ADDED for the new combo item
      {
        type: 'ITEM_ADDED' as const,
        payload: {
          lineItemId: result.comboItem.id,
          menuItemId: result.comboItem.menuItemId,
          name: result.comboItem.name,
          priceCents: Math.round(Number(result.comboItem.price) * 100),
          quantity: result.comboItem.quantity,
          modifiersJson: result.comboItem.modifiers?.length
            ? JSON.stringify(result.comboItem.modifiers.map(m => ({
                id: m.id, modifierId: m.modifierId, name: m.name,
                price: Number(m.price), quantity: m.quantity,
              })))
            : null,
          isHeld: false,
          soldByWeight: false,
        },
      },
    ]).catch(console.error)

    // Socket dispatches (fire-and-forget)
    void dispatchOrderTotalsUpdate(result.locationId, orderId, {
      subtotal: Number(result.updatedOrder.subtotal),
      taxTotal: Number(result.updatedOrder.taxTotal),
      tipTotal: Number(result.updatedOrder.tipTotal),
      discountTotal: Number(result.updatedOrder.discountTotal),
      total: Number(result.updatedOrder.total),
      commissionTotal: Number(result.updatedOrder.commissionTotal || 0),
    }, { async: true }).catch(console.error)

    void dispatchOpenOrdersChanged(result.locationId, {
      trigger: 'voided',
      orderId,
    }, { async: true }).catch(console.error)

    void dispatchOrderSummaryUpdated(result.locationId, buildOrderSummary(result.updatedOrder), { async: true }).catch(console.error)

    return NextResponse.json({
      data: {
        success: true,
        comboItemId: result.comboItem.id,
        comboName: result.comboItem.name,
        comboPrice: Number(result.comboItem.price),
        savings: result.removedItems.reduce((sum, i) => sum + Number(i.price), 0) - Number(result.comboItem.price),
        removedItemIds: result.removedItems.map(i => i.id),
        newTotal: Number(result.updatedOrder.total),
      },
    })
  } catch (error) {
    console.error('[apply-combo] Failed:', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'ORDER_NOT_FOUND') {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (message === 'ORDER_NOT_MODIFIABLE') {
      return NextResponse.json(
        { error: 'Order cannot be modified' },
        { status: 409 }
      )
    }
    if (message === 'ORDER_HAS_PAYMENTS') {
      return NextResponse.json(
        { error: 'Cannot modify an order with existing payments' },
        { status: 400 }
      )
    }
    if (message === 'COMBO_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Combo template not found' },
        { status: 404 }
      )
    }
    if (message === 'COMBO_UNAVAILABLE') {
      return NextResponse.json(
        { error: 'This combo is no longer available' },
        { status: 400 }
      )
    }
    if (message === 'ITEMS_NOT_FOUND') {
      return NextResponse.json(
        { error: 'One or more items are no longer active on this order' },
        { status: 400 }
      )
    }
    if (message === 'ITEMS_ALREADY_SENT') {
      return NextResponse.json(
        { error: 'Cannot convert items that have already been sent to the kitchen' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to apply combo' },
      { status: 500 }
    )
  }
})
